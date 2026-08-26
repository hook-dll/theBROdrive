/**
 * tools/desert-ride.ts
 *
 * Ride bench for the DESERT, and the counterpart to tools/ride-bench.ts.
 *
 * It answers the same question that one does — what does a wheel feel? — with the same
 * headline number, the KICK. A wheel does not feel the height field; it ray-casts
 * against a trimesh that is flat inside every triangle, so its vertical velocity is
 * `slope * speed` and it changes discontinuously at every triangle edge it crosses.
 * `kick = |slope_after - slope_before| * speed` is the vertical velocity step the
 * suspension is actually hit with, in m/s.
 *
 * The difference from the road bench is that the desert has no vertex rows to walk: a
 * car crosses the fan at any angle. So this builds the REAL chunks (no
 * re-implementation), buckets every triangle it drew into an XZ hash, and drags a wheel
 * along real paths through it — parallel to the road at a series of lateral offsets, and
 * straight out from the shoulder across all of them.
 *
 *   npx tsx tools/desert-ride.ts [speedKmh]
 *
 * Road reference at 60 km/h, from tools/ride-bench.ts: kick rms 0.18-0.31 m/s,
 * p99 0.50-0.89, max 1.5-2.5. The desert is meant to beat it, not match it.
 *
 * Nothing here is part of the game bundle.
 */

import type { BufferGeometry } from 'three';
import { SURFACES, SurfaceType } from '../src/core/surfaces';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { CORRIDOR_INNER, DETAIL_REACH, Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';

/** Chunk span sampled. 120 onwards keeps the road's own start out of it. */
const FROM_CHUNK = 120;
const TO_CHUNK = 127;
/** Path sampling step, metres. Well under the finest triangle. */
const PATH_STEP = 0.25;
/** Triangle hash cell, metres. */
const HASH_CELL = 4;
/** A slope change below this is floating-point noise inside one triangle, not an edge. */
const EDGE_EPSILON = 1e-4;
/** Lateral offsets a wheel is dragged along, metres. */
const ALONG_LATERALS = [8, 14, 22, 40, 70, 120, 300];
/** Seeds averaged; roughness must not be a seed lottery. */
const SEEDS = [1, 7, 42, 1337];

// --- standstill escape ----------------------------------------------------------
//
// "Drive into the desert, stop, and you cannot drive out again." That is a STATICS
// question, not a dynamics one, so it is answered here rather than by driving a car:
// a stopped car pulls away iff the tractive force its driven wheels can make exceeds
// the grade plus the rolling resistance. Every number below is the game's own.
//
// Duplicated from vehicle.ts on purpose, the same way ride-bench.ts duplicates the
// wheel paths: importing them would mean exporting private tuning constants for a
// tool. They are asserted against their source in the header line this prints.
/** LONGITUDINAL_GRIP_FRACTION: fraction of `frictionSlip` that is longitudinal mu. */
const LONGITUDINAL_GRIP_FRACTION = 0.38;
/** Wheelbase and track of a period saloon, metres: the footprint put on the ground. */
const WHEELBASE = 2.5;
const TRACK = 1.5;
/** Static rear-axle load share, and centre-of-mass height over wheelbase. */
const REAR_LOAD_SHARE = 0.48;
const COM_HEIGHT_OVER_WHEELBASE = 0.25;
const ESCAPE_HEADINGS = 16;
/** Widest lateral offset sampled: just inside the solid band's edge (PHYSICS_LATERAL). */
const ESCAPE_LATERAL = 560;

const speedKmh = Number(process.argv[2] ?? 60);
const speed = speedKmh / 3.6;

interface Mesh {
  /** Triangle corners, 9 floats each: ax ay az bx by bz cx cy cz. */
  readonly tris: Float64Array;
  readonly count: number;
  readonly buckets: Map<number, number[]>;
}

function bucketKey(ix: number, iz: number): number {
  // Both indices fit in 20 bits over the span this tool builds.
  return ix * 1_048_576 + iz;
}

/** Triangle corners the provider handed Rapier, in the same 9-floats-each layout. */
const colliderCorners: number[] = [];

/**
 * Stand-in for `PhysicsWorld`, exposing only what the provider touches. It captures the
 * trimesh instead of building one, so the collider path runs — index remapping, vertex
 * compaction and the lateral filter — with no wasm in the loop.
 */
const capturePhysics = {
  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array) {
    const vertexCount = vertices.length / 3;
    for (const v of indices) {
      if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
        throw new Error(`collider index ${v} outside 0..${vertexCount - 1}`);
      }
    }
    for (const value of vertices) {
      if (!Number.isFinite(value)) throw new Error('collider vertex is not finite');
    }
    for (let t = 0; t < indices.length; t += 3) {
      for (let n = 0; n < 3; n++) {
        const v = indices[t + n]!;
        colliderCorners.push(vertices[v * 3]!, vertices[v * 3 + 1]!, vertices[v * 3 + 2]!);
      }
    }
    return { parent: () => null };
  },
};

/** Bucket a flat list of triangle corners for point lookup. */
function toMesh(corners: readonly number[]): Mesh {
  const tris = Float64Array.from(corners);
  const count = tris.length / 9;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const minX = Math.min(tris[o]!, tris[o + 3]!, tris[o + 6]!);
    const maxX = Math.max(tris[o]!, tris[o + 3]!, tris[o + 6]!);
    const minZ = Math.min(tris[o + 2]!, tris[o + 5]!, tris[o + 8]!);
    const maxZ = Math.max(tris[o + 2]!, tris[o + 5]!, tris[o + 8]!);
    for (let ix = Math.floor(minX / HASH_CELL); ix <= Math.floor(maxX / HASH_CELL); ix++) {
      for (let iz = Math.floor(minZ / HASH_CELL); iz <= Math.floor(maxZ / HASH_CELL); iz++) {
        const key = bucketKey(ix, iz);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(i);
        else buckets.set(key, [i]);
      }
    }
  }
  return { tris, count, buckets };
}

interface Built {
  readonly road: Road;
  readonly terrain: Terrain;
  /** What is drawn. */
  readonly mesh: Mesh;
  /** What is solid: the trimesh the provider handed the physics world. */
  readonly solid: Mesh;
}

function buildMesh(seed: number): Built {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const provider = new TerrainMeshProvider(new RoadDistance(road));

  const corners: number[] = [];
  colliderCorners.length = 0;
  for (let chunkIndex = FROM_CHUNK; chunkIndex <= TO_CHUNK; chunkIndex++) {
    const ctx = {
      chunkIndex,
      sStart: chunkIndex * CHUNK_LENGTH,
      sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
      road,
      terrain,
      physics: capturePhysics,
      hasPhysics: true,
      originX: 0,
      originZ: 0,
    } as unknown as ChunkContext;
    const content = provider.build(ctx);
    if (!content) continue;
    // The provider's mesh is a THREE.Mesh; `children` is typed as the Object3D base,
    // which cannot express that. There is nothing to validate at runtime that a missing
    // `geometry` would not reveal one line later anyway.
    const mesh = content.group.children[0] as unknown as { geometry: BufferGeometry };
    const geometry = mesh.geometry;
    const pos = geometry.getAttribute('position');
    const idx = geometry.getIndex();
    if (!idx) continue;
    for (let t = 0; t < idx.count; t += 3) {
      for (let n = 0; n < 3; n++) {
        const v = idx.getX(t + n);
        corners.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      }
    }
    content.dispose?.();
  }

  return { road, terrain, mesh: toMesh(corners), solid: toMesh(colliderCorners) };
}

/** Surface height under (x, z), or NaN where the fan drew nothing. Highest wins. */
function heightAt(mesh: Mesh, x: number, z: number): number {
  const bucket = mesh.buckets.get(bucketKey(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL)));
  if (!bucket) return Number.NaN;
  let best = Number.NaN;
  for (const i of bucket) {
    const o = i * 9;
    const ax = mesh.tris[o]!;
    const az = mesh.tris[o + 2]!;
    const bx = mesh.tris[o + 3]!;
    const bz = mesh.tris[o + 5]!;
    const cx = mesh.tris[o + 6]!;
    const cz = mesh.tris[o + 8]!;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const y = u * mesh.tris[o + 1]! + v * mesh.tris[o + 4]! + w * mesh.tris[o + 7]!;
    if (Number.isNaN(best) || y > best) best = y;
  }
  return best;
}

interface Ride {
  metres: number;
  events: number;
  kickRms: number;
  kickP99: number;
  kickMax: number;
  slopeMax: number;
}

/** Kick statistics for one height profile sampled at PATH_STEP. */
function ride(heights: readonly number[]): Ride {
  const kicks: number[] = [];
  let slopeMax = 0;
  let metres = 0;
  for (let i = 1; i + 1 < heights.length; i++) {
    const h0 = heights[i - 1]!;
    const h1 = heights[i]!;
    const h2 = heights[i + 1]!;
    if (Number.isNaN(h0) || Number.isNaN(h1) || Number.isNaN(h2)) continue;
    metres += PATH_STEP;
    const before = (h1 - h0) / PATH_STEP;
    const after = (h2 - h1) / PATH_STEP;
    if (Math.abs(after) > slopeMax) slopeMax = Math.abs(after);
    const change = Math.abs(after - before);
    if (change > EDGE_EPSILON) kicks.push(change * speed);
  }
  kicks.sort((a, b) => a - b);
  const sumSq = kicks.reduce((acc, k) => acc + k * k, 0);
  return {
    metres,
    events: kicks.length,
    kickRms: kicks.length > 0 ? Math.sqrt(sumSq / kicks.length) : 0,
    kickP99: kicks.length > 0 ? kicks[Math.floor(kicks.length * 0.99)]! : 0,
    kickMax: kicks.length > 0 ? kicks[kicks.length - 1]! : 0,
    slopeMax,
  };
}

function mean(rides: readonly Ride[], pick: (r: Ride) => number): number {
  return rides.reduce((acc, r) => acc + pick(r), 0) / rides.length;
}

function row(label: string, rides: readonly Ride[]): void {
  const metres = mean(rides, (r) => r.metres);
  const events = mean(rides, (r) => r.events);
  console.log(
    `${label.padEnd(16)}${mean(rides, (r) => r.kickRms)
      .toFixed(3)
      .padStart(8)}${mean(rides, (r) => r.kickP99)
      .toFixed(3)
      .padStart(10)}${mean(rides, (r) => r.kickMax)
      .toFixed(3)
      .padStart(10)}${(mean(rides, (r) => r.slopeMax) * 100)
      .toFixed(0)
      .padStart(9)}%${(metres > 0 ? (events / metres) * 100 : 0).toFixed(0).padStart(11)}`,
  );
}

const built = SEEDS.map(buildMesh);

console.log(
  `desert ride bench @ ${speedKmh} km/h, chunks ${FROM_CHUNK}-${TO_CHUNK}, ` +
    `${built[0]!.mesh.count} triangles/seed, corridor ${CORRIDOR_INNER.toFixed(1)} m, ` +
    `detail reach ${DETAIL_REACH} m`,
);
console.log('path            kick rms  kick p99  kick max  max slope  edges/100m');

// Parallel to the road, one row per lateral offset: the excursion a car actually makes.
for (const lateral of ALONG_LATERALS) {
  const rides = built.map(({ road, mesh }) => {
    const heights: number[] = [];
    const s0 = FROM_CHUNK * CHUNK_LENGTH + 20;
    const s1 = (TO_CHUNK + 1) * CHUNK_LENGTH - 20;
    for (let s = s0; s <= s1; s += PATH_STEP) {
      const p = road.offsetPoint(s, lateral);
      heights.push(heightAt(mesh, p.x, p.z));
    }
    return ride(heights);
  });
  row(`along ${lateral} m`, rides);
}

// Straight out from the shoulder, which crosses every lateral band and every ring.
{
  const rides = built.map(({ road, mesh }) => {
    const heights: number[] = [];
    for (let k = 0; k < 40; k++) {
      const s = FROM_CHUNK * CHUNK_LENGTH + 40 + k * 37;
      const frame = road.sampleAt(s);
      const dirX = Math.cos(frame.heading);
      const dirZ = -Math.sin(frame.heading);
      for (let d = CORRIDOR_INNER; d <= DETAIL_REACH + 40; d += PATH_STEP) {
        heights.push(heightAt(mesh, frame.x + dirX * d, frame.z + dirZ * d));
      }
      heights.push(Number.NaN); // break the profile between runs
    }
    return ride(heights);
  });
  row('across 5-120 m', rides);
}

// The detail field on its own, sampled analytically: what the mesh is being asked to
// carry, independent of how well it carries it.
{
  const { terrain } = built[0]!;
  let sumSq = 0;
  let min = 0;
  let max = 0;
  let pitted = 0;
  let n = 0;
  for (let x = 0; x < 400; x += 0.5) {
    for (let z = 0; z < 400; z += 0.5) {
      const h = terrain.detailAt(x, z, 30);
      sumSq += h * h;
      if (h < min) min = h;
      if (h > max) max = h;
      if (h < -0.15) pitted++;
      n++;
    }
  }
  console.log(
    `detail field at 30 m: rms ${(Math.sqrt(sumSq / n) * 1000).toFixed(0)} mm, ` +
      `range ${(min * 1000).toFixed(0)}..${(max * 1000).toFixed(0)} mm, ` +
      `${((pitted / n) * 100).toFixed(1)}% of ground more than 150 mm down`,
  );
}

/**
 * Seam proof.
 *
 * The refined grid stitches onto the coarse rings at `DETAIL_REACH`: its outermost
 * column is supposed to land exactly on the coarse edge it subdivides, so a step
 * across that line would be a crack with sky or ground behind it.
 *
 * A step alone proves nothing — the ground is steep out there and any two points a
 * finite distance apart differ. So each line is straddled at two widths a decade
 * apart. A SLOPE's step shrinks by ten when the straddle does; a CRACK's does not.
 * Control lines either side of the seam say what an honest slope looks like there.
 */
{
  const probe = (lateral: number, half: number): { step: number; at: number; holes: number } => {
    let step = 0;
    let at = 0;
    let holes = 0;
    for (const { road, mesh } of built) {
      for (let s = FROM_CHUNK * CHUNK_LENGTH + 5; s < (TO_CHUNK + 1) * CHUNK_LENGTH - 5; s += 0.5) {
        for (const side of [-1, 1]) {
          const inner = road.offsetPoint(s, side * (lateral - half));
          const outer = road.offsetPoint(s, side * (lateral + half));
          const a = heightAt(mesh, inner.x, inner.z);
          const b = heightAt(mesh, outer.x, outer.z);
          if (Number.isNaN(a) || Number.isNaN(b)) {
            holes++;
            continue;
          }
          if (Math.abs(a - b) > step) {
            step = Math.abs(a - b);
            at = s;
          }
        }
      }
    }
    return { step, at, holes };
  };

  for (const lateral of [DETAIL_REACH - 10, DETAIL_REACH, DETAIL_REACH + 10]) {
    const wide = probe(lateral, 0.05);
    const narrow = probe(lateral, 0.005);
    console.log(
      `line ${lateral} m${lateral === DETAIL_REACH ? ' (seam)' : '       '}: ` +
        `worst step ${(wide.step * 1000).toFixed(1)} mm over 100 mm, ` +
        `${(narrow.step * 1000).toFixed(1)} mm over 10 mm, ` +
        `worst at s ${wide.at.toFixed(0)}, ${wide.holes + narrow.holes} undrawn`,
    );
  }
}

/**
 * Solid ground versus drawn ground.
 *
 * The collider is a FILTER over the drawn triangle list, so the invariant is exact and
 * worth testing exactly: every triangle handed to the physics world must be a triangle
 * that is on screen, corner for corner. Anything else is a wheel riding a bump nobody
 * can see, or falling through one everybody can.
 *
 * Tested structurally rather than by sampling heights, because sampling cannot tell a
 * defect from the fan's own legitimate double cover: the drawn mesh reaches 1500 m and
 * the collider stops at 600, so out there the drawn surface has sheets the collider was
 * never meant to carry.
 */
{
  const key = (tris: Float64Array, i: number): string => {
    const o = i * 9;
    let out = '';
    for (let n = 0; n < 9; n++) out += `${tris[o + n]!},`;
    return out;
  };
  let solidTriangles = 0;
  let unseen = 0;
  for (const { mesh, solid } of built) {
    const drawn = new Set<string>();
    for (let i = 0; i < mesh.count; i++) drawn.add(key(mesh.tris, i));
    solidTriangles += solid.count;
    for (let i = 0; i < solid.count; i++) {
      if (!drawn.has(key(solid.tris, i))) unseen++;
    }
  }
  console.log(
    `collider: ${solidTriangles} triangles over ${SEEDS.length} seeds, ` +
      `${unseen} of them not in the drawn mesh`,
  );
}

/**
 * Can a stopped car drive out again?
 *
 * The one thing a rough desert must not do is strand a road car. A stopped car pulls
 * away iff its driven wheels can make more force than the grade under them costs:
 *
 *     mu * drivenShare * cos(a)  >=  sin(a) + rollingResistance * cos(a)
 *
 * with `mu = frictionSlip * LONGITUDINAL_GRIP_FRACTION` and `drivenShare` including
 * the load the grade itself transfers onto (RWD) or off (FWD) the driven axle. The
 * grade is measured the way the car feels it: a wheelbase-by-track footprint set on
 * the real trimesh, a plane through its four contact points, and that plane's slope
 * along the heading.
 *
 * THE HEADING IS NOT A FREE CHOICE. A stopped car cannot steer: the wheels turn but
 * the car goes where it was pointing until it is rolling. So the pair that matters is
 * (spot, heading), and it is BLOCKED when the grade beats the tyres in the direction
 * the car faces — that is "I stopped and could not go on", which is the report. It is
 * STRANDED only when reverse fails too.
 *
 * Four wheels are assumed loaded, which is optimistic: a wheel hanging over the lip of
 * a scoop carries nothing, and on an open differential a lifted driven wheel takes the
 * torque with it. So these counts are a LOWER bound on the real thing.
 */
{
  const sand = SURFACES[SurfaceType.Sand];
  const climbs = (mu: number, rearDriven: boolean): number => {
    const share = rearDriven ? REAR_LOAD_SHARE : 1 - REAR_LOAD_SHARE;
    const sign = rearDriven ? 1 : -1;
    return (mu * share - sand.rollingResistance) / (1 - sign * mu * COM_HEIGHT_OVER_WHEELBASE);
  };

  // Grade under a footprint at every (spot, heading), gathered once: the sweep below
  // only changes the tyre's side of the inequality.
  const grades: number[] = [];
  let worstGrade = 0;
  for (const { road, mesh } of built) {
    for (let s = FROM_CHUNK * CHUNK_LENGTH + 20; s < (TO_CHUNK + 1) * CHUNK_LENGTH - 20; s += 5) {
      // The whole solid band, not just the refined part: the dune field's own faces
      // further out are longer but no gentler, and a car stops out there too.
      for (let lateral = -ESCAPE_LATERAL; lateral <= ESCAPE_LATERAL; lateral += 7) {
        if (Math.abs(lateral) <= CORRIDOR_INNER) continue;
        const centre = road.offsetPoint(s, lateral);
        for (let h = 0; h < ESCAPE_HEADINGS; h++) {
          const theta = (h / ESCAPE_HEADINGS) * Math.PI * 2;
          const fx = Math.sin(theta);
          const fz = Math.cos(theta);
          let momentAlong = 0;
          let ok = true;
          for (const along of [WHEELBASE / 2, -WHEELBASE / 2]) {
            for (const side of [TRACK / 2, -TRACK / 2]) {
              const y = heightAt(mesh, centre.x + fx * along - fz * side, centre.z + fz * along + fx * side);
              if (Number.isNaN(y)) ok = false;
              else momentAlong += y * along;
            }
          }
          if (!ok) continue;
          // Least-squares slope along the heading through four symmetric points:
          // sum(y*along) / sum(along^2), and sum(along^2) = 4*(WHEELBASE/2)^2.
          const grade = momentAlong / (WHEELBASE * WHEELBASE);
          grades.push(grade);
          if (Math.abs(grade) > worstGrade) worstGrade = Math.abs(grade);
        }
      }
    }
  }

  console.log(
    `standstill escape over ${grades.length} (spot, heading) pairs inside ${ESCAPE_LATERAL} m, ` +
      `worst footprint grade ${(worstGrade * 100).toFixed(0)}%:`,
  );
  for (const frictionSlip of [sand.frictionSlip, 1.15, 1.35, 1.55]) {
    const mu = frictionSlip * LONGITUDINAL_GRIP_FRACTION;
    const line: string[] = [];
    for (const rearDriven of [true, false]) {
      let blocked = 0;
      let stranded = 0;
      for (const grade of grades) {
        const forward = grade <= climbs(mu, rearDriven);
        const back = -grade <= climbs(mu, rearDriven);
        if (!forward) blocked++;
        if (!forward && !back) stranded++;
      }
      line.push(
        `${rearDriven ? 'RWD' : 'FWD'} climbs ${(climbs(mu, rearDriven) * 100).toFixed(0)}%, ` +
          `${((blocked / grades.length) * 100).toFixed(1)}% blocked / ` +
          `${((stranded / grades.length) * 100).toFixed(2)}% stranded`,
      );
    }
    const mark = frictionSlip === sand.frictionSlip ? ' <- shipped' : '';
    console.log(`  frictionSlip ${frictionSlip.toFixed(2)}: ${line.join('   ')}${mark}`);
  }
}
