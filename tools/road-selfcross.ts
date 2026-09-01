/**
 * tools/road-selfcross.ts
 *
 * Does the road come back over itself, and did preventing that ruin its corners?
 *
 * This is the acceptance test for the bounded-heading spine. It walks the REAL
 * `buildSpine` tables over several seeds and asks, for every 200 m centreline sample,
 * how near the closest sample at least 5 km away in arclength came:
 *
 *   merged   within 1100 m — the two corridors are one basin floor
 *   tube     within 2500 m — the mountain-free tubes overlap
 *   closest  nearest distant pass at all
 *
 * It also reads the canonical `RoadHeading` over the first 400 km for the road's
 * character: tightest radius, direction changes per kilometre, longest single-sign
 * bend and total heading deviation. Self-avoidance bought by turning the road into a
 * ruler would pass the first half and fail the second.
 *
 *   npx tsx tools/road-selfcross.ts
 *
 * Nothing here is part of the game bundle.
 */

import { RoadHeading, MIN_CORNER_RADIUS, NODE_SPACING } from '../src/world/roadcurve';
import { buildSpine, COARSE_SPACING } from '../src/world/roadspine';
import { ROAD_LENGTH } from '../src/world/road';

const SEEDS = [1, 7, 42, 1337];
/** Samples closer than this in arclength are the same local road, not a revisit. */
const FAR_S = 5000;
const MERGED_DISTANCE = 1100;
const TUBE_DISTANCE = 2500;
/** Road span whose curvature character is measured. */
const FEEL_SPAN = 400_000;

/** Packing for 2.5 km spatial cells; supports far beyond the road's coordinate range. */
const CELL_BIAS = 1_000_000;
const CELL_STRIDE = 2_000_000;

function cellKey(ix: number, iz: number): number {
  return (ix + CELL_BIAS) * CELL_STRIDE + (iz + CELL_BIAS);
}

interface Separation {
  merged: number;
  tube: number;
  closest: number;
  samples: number;
  netKm: number;
  spanXKm: number;
  spanZKm: number;
}

function separation(seed: number): Separation {
  const spine = buildSpine(seed, ROAD_LENGTH);
  const xs = spine.coarseX;
  const zs = spine.coarseZ;
  const grid = new Map<number, number[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const z = zs[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    const key = cellKey(Math.floor(x / TUBE_DISTANCE), Math.floor(z / TUBE_DISTANCE));
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const farSamples = Math.ceil(FAR_S / COARSE_SPACING);
  let merged = 0;
  let tube = 0;
  let closest = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const z = zs[i]!;
    const cx = Math.floor(x / TUBE_DISTANCE);
    const cz = Math.floor(z / TUBE_DISTANCE);
    let nearest = Infinity;
    // Any point inside TUBE_DISTANCE is in this cell or one of its eight neighbours.
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const bucket = grid.get(cellKey(cx + ox, cz + oz));
        if (!bucket) continue;
        for (const j of bucket) {
          if (Math.abs(j - i) < farSamples) continue;
          const d = Math.hypot(xs[j]! - x, zs[j]! - z);
          if (d < nearest) nearest = d;
        }
      }
    }
    if (nearest < MERGED_DISTANCE) merged++;
    if (nearest < TUBE_DISTANCE) tube++;
    if (nearest < closest) closest = nearest;
  }

  return {
    merged,
    tube,
    closest,
    samples: xs.length,
    netKm: Math.hypot(xs[xs.length - 1]!, zs[zs.length - 1]!) / 1000,
    spanXKm: (maxX - minX) / 1000,
    spanZKm: (maxZ - minZ) / 1000,
  };
}

interface Feel {
  minRadius: number;
  flipsPerKm: number;
  longestRun: number;
  maxDeviationDeg: number;
  minForwardCos: number;
}

function feel(seed: number): Feel {
  const heading = new RoadHeading(seed);
  const steps = Math.floor(FEEL_SPAN / NODE_SPACING);
  let sign = 0;
  let flips = 0;
  let runStart = 0;
  let longestRun = 0;
  let maxCurvature = 0;
  let maxDeviation = 0;
  let minForwardCos = 1;
  for (let i = 1; i <= steps; i++) {
    const s = i * NODE_SPACING;
    const h = heading.at(s);
    const curvature = heading.curvatureAt(s);
    const absCurvature = Math.abs(curvature);
    if (absCurvature > maxCurvature) maxCurvature = absCurvature;
    if (Math.abs(h) > maxDeviation) maxDeviation = Math.abs(h);
    const forwardCos = Math.cos(h);
    if (forwardCos < minForwardCos) minForwardCos = forwardCos;
    const nextSign = curvature > 0 ? 1 : curvature < 0 ? -1 : sign;
    if (sign !== 0 && nextSign !== sign) {
      flips++;
      const run = s - runStart;
      if (run > longestRun) longestRun = run;
      runStart = s;
    }
    sign = nextSign;
  }
  return {
    minRadius: 1 / maxCurvature,
    flipsPerKm: flips / (FEEL_SPAN / 1000),
    longestRun,
    maxDeviationDeg: (maxDeviation * 180) / Math.PI,
    minForwardCos,
  };
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
}

for (const seed of SEEDS) {
  const sep = separation(seed);
  const roadFeel = feel(seed);
  console.log(
    `seed ${seed}: ${(sep.merged / sep.samples * 100).toFixed(3)}% merged, ` +
      `${(sep.tube / sep.samples * 100).toFixed(3)}% inside 2.5 km, ` +
      `closest ${Number.isFinite(sep.closest) ? `${(sep.closest / 1000).toFixed(2)} km` : 'none'}, ` +
      `span ${sep.spanXKm.toFixed(0)} x ${sep.spanZKm.toFixed(0)} km, net ${sep.netKm.toFixed(0)} km`,
  );
  check('no distant pass merges corridors', sep.merged === 0, `${sep.merged}/${sep.samples} samples`);
  check('mountain-free tubes do not overlap', sep.tube === 0, `${sep.tube}/${sep.samples} samples`);
  check('heading always makes progress', roadFeel.minForwardCos > 0, `minimum cos ${roadFeel.minForwardCos.toFixed(3)}`);
  check(
    // A FLOOR, not a target: the field is allowed to beat the authored radius in a
    // pathological alignment of route and corner derivatives, but not by much, or the
    // terrain fans on the inside of the bend start folding (see world/terrainmesh.ts).
    'corner radius respects authored floor',
    roadFeel.minRadius >= MIN_CORNER_RADIUS * 0.8,
    `${roadFeel.minRadius.toFixed(0)} m (floor ${(MIN_CORNER_RADIUS * 0.8).toFixed(0)} m, target ${MIN_CORNER_RADIUS} m)`,
  );
  check(
    // Raised from 1.6 with the corner rebudget, deliberately. 1.6 direction changes
    // per kilometre IS the boring road: it was a bound written to keep an earlier,
    // twitchy attempt in check, and it also outlawed any section that corners
    // continuously. The gate still keeps those sections occasional; this only has to
    // catch a road that has become a slalom everywhere.
    'direction changes stay driveable',
    roadFeel.flipsPerKm <= 9,
    `${roadFeel.flipsPerKm.toFixed(2)} / km`,
  );
  check('long sweepers survive', roadFeel.longestRun >= 1500, `${roadFeel.longestRun.toFixed(0)} m`);
  check('heading stays under the guarantee', roadFeel.maxDeviationDeg < 89, `${roadFeel.maxDeviationDeg.toFixed(1)} degrees`);
}

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
