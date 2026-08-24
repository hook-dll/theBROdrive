/**
 * tools/relief-probe.ts
 *
 * Proves the height FIELD has no cliffs in it.
 *
 * The desert's height is `Landscape` plus dune relief plus the basin rim, and every
 * one of those has an arithmetic slope bound (see landscape.ts). This walks the REAL
 * generators through `Terrain.heightAt` and reports the bound alongside the value
 * actually reached, plus the two things the old road-derived height field got wrong:
 * how far the road wanders in altitude, and whether it ever passes close to itself at
 * a different height.
 *
 * One caveat, and it is the reason the escarpment row reads high. `heightAt` finds
 * its lateral distance with a LOCAL projection from the caller's arclength hint, so
 * where the road folds back the hint can flip between two local minima and the
 * distance jumps — and past RIM_START distance drives the rim. The drawn and collided
 * surface does not do that: `TerrainMeshProvider` interpolates a global
 * nearest-branch distance off an absolute lattice, and `tools/terrain-audit.ts`
 * measures the steepest edge of the mesh itself (19-20% on the basin floor, 34-47%
 * across the escarpment). Trust that one for what is on screen; trust this one for
 * the field.
 *
 *   npx tsx tools/relief-probe.ts
 *
 * Nothing here is part of the game bundle.
 */

import { MAX_RELIEF, MAX_SLOPE } from '../src/world/landscape';
import { MIN_CORNER_RADIUS, Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';

/** Lateral sampling step for the slope scan, metres. Fine enough to catch a step. */
const STEP = 5;
/** How much of the road each seed is scanned over, metres. */
const SCAN_LENGTH = 60_000;
/** Widest lateral offset scanned: the edge of the solid band. */
const SCAN_LATERAL = 600;
/** Lateral offset inside which the basin floor is flat by design (RIM_START). */
const FLOOR_LATERAL = 400;

console.log(
  `budget: landscape slope <= ${(MAX_SLOPE * 100).toFixed(1)}%, ` +
    `landscape relief +-${MAX_RELIEF.toFixed(0)} m, min corner radius ${MIN_CORNER_RADIUS.toFixed(0)} m`,
);

for (const seed of [1, 2, 7, 42, 1337, 90210]) {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);

  // --- road altitude, and whether it ever meets itself ---------------------------
  const step = 20;
  const n = Math.floor(road.length / step) + 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  let minY = Infinity;
  let maxY = -Infinity;
  let minHeading = Infinity;
  let maxHeading = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = road.sampleAt(i * step);
    xs[i] = c.x;
    ys[i] = c.y;
    zs[i] = c.z;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
    if (c.heading < minHeading) minHeading = c.heading;
    if (c.heading > maxHeading) maxHeading = c.heading;
  }

  // Altitude spread inside any 3 km window: what one chunk's fan can straddle.
  let worstWindow = 0;
  const win = Math.floor(3000 / step);
  for (let i = 0; i + win < n; i += 5) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = i; k <= i + win; k++) {
      if (ys[k]! < lo) lo = ys[k]!;
      if (ys[k]! > hi) hi = ys[k]!;
    }
    if (hi - lo > worstWindow) worstWindow = hi - lo;
  }

  // Bucket the centreline on a 250 m grid and rank pairs that are far apart in
  // arclength but close in plan by the slope implied between them.
  const CELL = 250;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(xs[i]! / CELL) * 100003 + Math.floor(zs[i]! / CELL);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  }
  let worstPair = { dxz: 1, dy: 0, s0: 0, s1: 0 };
  let pairs = 0;
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]!;
        const j = list[b]!;
        if (Math.abs(i - j) * step < 2000) continue;
        const dxz = Math.hypot(xs[i]! - xs[j]!, zs[i]! - zs[j]!);
        if (dxz > 1200) continue;
        pairs++;
        const dy = Math.abs(ys[i]! - ys[j]!);
        if (dy / Math.max(dxz, 1) > worstPair.dy / worstPair.dxz) {
          worstPair = { dxz: Math.max(dxz, 1), dy, s0: i * step, s1: j * step };
        }
      }
    }
  }

  // --- worst slope of the collidable height field --------------------------------
  // Reported in two bands: the basin floor (where the rim contributes nothing and
  // the numbers are the landscape's and the dunes'), and the whole solid band out to
  // PHYSICS_LATERAL, which includes the escarpment's own deliberate face.
  let floor = { slope: 0, s: 0, lateral: 0 };
  let solid = { slope: 0, s: 0, lateral: 0 };
  let profileRange = 0;
  for (let s = 200; s < SCAN_LENGTH; s += 200) {
    const c = road.sampleAt(s);
    const rx = Math.cos(c.heading);
    const rz = -Math.sin(c.heading);
    let lo = Infinity;
    let hi = -Infinity;
    let prev = 0;
    for (let lat = -SCAN_LATERAL; lat <= SCAN_LATERAL; lat += STEP) {
      const h = terrain.heightAt(c.x + rx * lat, c.z + rz * lat, s);
      if (Math.abs(lat) <= FLOOR_LATERAL) {
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      if (lat > -SCAN_LATERAL) {
        const slope = Math.abs(h - prev) / STEP;
        if (slope > solid.slope) solid = { slope, s, lateral: lat };
        if (Math.abs(lat) <= FLOOR_LATERAL && slope > floor.slope) floor = { slope, s, lateral: lat };
      }
      prev = h;
    }
    if (hi - lo > profileRange) profileRange = hi - lo;
  }

  console.log(`seed ${seed}`);
  console.log(
    `  heading ${((minHeading * 180) / Math.PI).toFixed(0)}..${((maxHeading * 180) / Math.PI).toFixed(0)} deg; ` +
      `road y ${minY.toFixed(0)}..${maxY.toFixed(0)} m; worst spread in any 3 km window ${worstWindow.toFixed(0)} m`,
  );
  console.log(
    `  first ${SCAN_LENGTH / 1000} km: basin floor (+-${FLOOR_LATERAL} m) worst slope ` +
      `${(floor.slope * 100).toFixed(0)}% (${((Math.atan(floor.slope) * 180) / Math.PI).toFixed(0)} deg) ` +
      `at s ${floor.s} lat ${floor.lateral}; cross-section range ${profileRange.toFixed(0)} m`,
  );
  console.log(
    `  solid band (+-${SCAN_LATERAL} m, escarpment included) worst slope ` +
      `${(solid.slope * 100).toFixed(0)}% (${((Math.atan(solid.slope) * 180) / Math.PI).toFixed(0)} deg) ` +
      `at s ${solid.s} lat ${solid.lateral}`,
  );
}
