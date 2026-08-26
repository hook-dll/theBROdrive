/**
 * tools/spine-verify.ts
 *
 * Proves the one property the road spine is built on: a node replayed from a
 * checkpoint is BIT-IDENTICAL to the same node reached by walking from s = 0.
 *
 * This is not a nicety. Chunk meshes are built independently and meet at shared
 * vertex rows; the road ribbon and the terrain corridor sample the same height
 * function and must agree along the shoulder. All of that holds because two callers
 * asking for the same `s` get the same doubles. Replaying from a checkpoint changes
 * HOW those doubles are reached, so it has to be shown that it does not change WHAT
 * they are — `!==` on the raw values, never an epsilon, because an epsilon here would
 * pass a road that has a half-millimetre step in the middle of every chunk seam.
 *
 * It also checks the two things that would silently corrupt positions: that the
 * checkpoint table really holds the walk's own values, and that the coarse index
 * really holds the centreline.
 *
 *   npx tsx tools/spine-verify.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import { NODE_SPACING, RoadHeading, stepNode, type NodeState } from '../src/world/roadcurve';
import { Road, ROAD_LENGTH } from '../src/world/road';
import { buildSpine, CHECKPOINT_NODES, CHECKPOINT_SPACING, COARSE_SPACING } from '../src/world/roadspine';

const seed = Number(process.argv[2] ?? 1337);
const spine = buildSpine(seed, ROAD_LENGTH);
const lastNode = Math.floor(ROAD_LENGTH / NODE_SPACING);

let failures = 0;
const fail = (message: string): void => {
  failures++;
  console.log(`  FAIL ${message}`);
};

// --- 1. The checkpoint table is the walk's own state ------------------------
//
// Walk from the origin exactly as `buildSpine` does and compare every checkpoint and
// every coarse sample against it. Same recurrence, so this must match exactly; if it
// does not, `buildSpine`'s bookkeeping is off by a node and every position downstream
// is shifted.
{
  const heading = new RoadHeading(seed);
  const node: NodeState = { x: 0, z: 0 };
  const coarseStride = COARSE_SPACING / NODE_SPACING;
  let checkpointsChecked = 0;
  let coarseChecked = 0;

  for (let i = 1; i <= lastNode; i++) {
    stepNode(node, heading, i - 1);
    if (i % CHECKPOINT_NODES === 0) {
      const k = i / CHECKPOINT_NODES;
      if (spine.checkpointX[k] !== node.x) fail(`checkpoint ${k} x`);
      if (spine.checkpointZ[k] !== node.z) fail(`checkpoint ${k} z`);
      checkpointsChecked++;
    }
    if (i % coarseStride === 0) {
      const k = i / coarseStride;
      if (spine.coarseX[k] !== node.x) fail(`coarse ${k} x`);
      if (spine.coarseZ[k] !== node.z) fail(`coarse ${k} z`);
      coarseChecked++;
    }
  }
  console.log(
    `checkpoints match the sequential walk: ${checkpointsChecked} checked, ` +
      `coarse samples: ${coarseChecked} checked`,
  );
}

// --- 2. sampleAt matches an independent sequential walk (near half) ---------
//
// The road under test uses checkpoint replay and an eight-block LRU. The reference
// walks every node from the origin and Hermite-interpolates by hand, which is what
// `Road` did before the spine existed. Sampling in a deliberately SCATTERED order
// forces block eviction and re-replay, so a block that is rebuilt differently from
// how it was first built shows up here.
//
// Bounded to `VERIFY_SPAN`, because holding every node of a 40 000 km road is three
// Float64Arrays of ten million entries — 240 MB, which is exactly the cost the spine
// exists to avoid, and it would be absurd to pay it inside the tool that proves the
// spine works. Section 3 covers the far end without the arrays.
const VERIFY_SPAN = Math.min(ROAD_LENGTH, 2_000_000);
{
  const road = new Road(seed, spine);
  const heading = new RoadHeading(seed);
  const spanNodes = Math.floor(VERIFY_SPAN / NODE_SPACING);
  const xs = new Float64Array(spanNodes + 1);
  const zs = new Float64Array(spanNodes + 1);
  const hs = new Float64Array(spanNodes + 1);
  const node: NodeState = { x: 0, z: 0 };
  for (let i = 1; i <= spanNodes; i++) {
    stepNode(node, heading, i - 1);
    xs[i] = node.x;
    zs[i] = node.z;
    hs[i] = heading.at(i * NODE_SPACING);
  }

  const landscape = road.landscape;
  const reference = (s: number) => {
    const fi = s / NODE_SPACING;
    const i = Math.min(Math.floor(fi), spanNodes - 1);
    const t = fi - i;
    const h0 = hs[i]!;
    const h1 = hs[i + 1]!;
    const t2 = t * t;
    const t3 = t2 * t;
    const b0 = 2 * t3 - 3 * t2 + 1;
    const m0 = t3 - 2 * t2 + t;
    const b1 = -2 * t3 + 3 * t2;
    const m1 = t3 - t2;
    const y0 = landscape.heightAt(xs[i]!, zs[i]!);
    const y1 = landscape.heightAt(xs[i + 1]!, zs[i + 1]!);
    return {
      x: b0 * xs[i]! + m0 * Math.sin(h0) * NODE_SPACING + b1 * xs[i + 1]! + m1 * Math.sin(h1) * NODE_SPACING,
      y: y0 + (y1 - y0) * t,
      z: b0 * zs[i]! + m0 * Math.cos(h0) * NODE_SPACING + b1 * zs[i + 1]! + m1 * Math.cos(h1) * NODE_SPACING,
      heading: h0 + (h1 - h0) * t,
      grade: (y1 - y0) / NODE_SPACING,
    };
  };

  // A scatter order that is hostile to an LRU: step by a prime number of checkpoint
  // intervals so no two consecutive queries share a block, and alternate ends.
  const probes: number[] = [];
  for (let k = 0; k < 1000; k++) {
    probes.push((k * 7 * CHECKPOINT_SPACING + 1234.5) % VERIFY_SPAN);
    probes.push(VERIFY_SPAN - ((k * 13 * CHECKPOINT_SPACING + 777.25) % VERIFY_SPAN));
  }
  probes.push(0, VERIFY_SPAN / 2, CHECKPOINT_SPACING, CHECKPOINT_SPACING - NODE_SPACING);

  let checked = 0;
  for (const s of probes) {
    const got = road.sampleAt(s);
    const want = reference(s);
    if (got.x !== want.x) fail(`sampleAt(${s}).x  ${got.x} !== ${want.x}`);
    if (got.y !== want.y) fail(`sampleAt(${s}).y  ${got.y} !== ${want.y}`);
    if (got.z !== want.z) fail(`sampleAt(${s}).z  ${got.z} !== ${want.z}`);
    if (got.heading !== want.heading) fail(`sampleAt(${s}).heading`);
    if (got.grade !== want.grade) fail(`sampleAt(${s}).grade`);
    checked++;
  }
  console.log(
    `sampleAt bit-identical over the first ${(VERIFY_SPAN / 1000).toFixed(0)} km: ` +
      `${checked} scattered probes`,
  );
}

// --- 3. The far end, without holding the road in memory --------------------
//
// The interesting failure is at the END of a long road: the last checkpoints are the
// ones with the most accumulated integration behind them, and a block replayed out
// there is the one a saved game at 39 000 km depends on. Verified with ONE streaming
// walk that keeps no arrays — targets are visited in ascending order and compared as
// the walk passes them, so the memory cost is a single node.
{
  const road = new Road(seed, spine);
  const heading = new RoadHeading(seed);
  const landscape = road.landscape;

  // Deep targets, ascending, each landing mid-segment so the Hermite is exercised.
  const targets: number[] = [];
  for (let k = 1; k <= 12; k++) targets.push((ROAD_LENGTH * k) / 13 + 1234.5);

  const node: NodeState = { x: 0, z: 0 };
  let prevX = 0;
  let prevZ = 0;
  let nextTarget = 0;
  let checked = 0;
  for (let i = 1; i <= lastNode && nextTarget < targets.length; i++) {
    prevX = node.x;
    prevZ = node.z;
    stepNode(node, heading, i - 1);

    // Node i-1 .. i is the segment [ (i-1)*NODE_SPACING, i*NODE_SPACING ].
    while (nextTarget < targets.length && targets[nextTarget]! < i * NODE_SPACING) {
      const s = targets[nextTarget]!;
      const t = s / NODE_SPACING - (i - 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const b0 = 2 * t3 - 3 * t2 + 1;
      const m0 = t3 - 2 * t2 + t;
      const b1 = -2 * t3 + 3 * t2;
      const m1 = t3 - t2;
      const h0 = heading.at((i - 1) * NODE_SPACING);
      const h1 = heading.at(i * NODE_SPACING);
      const wantX =
        b0 * prevX + m0 * Math.sin(h0) * NODE_SPACING + b1 * node.x + m1 * Math.sin(h1) * NODE_SPACING;
      const wantZ =
        b0 * prevZ + m0 * Math.cos(h0) * NODE_SPACING + b1 * node.z + m1 * Math.cos(h1) * NODE_SPACING;
      const y0 = landscape.heightAt(prevX, prevZ);
      const y1 = landscape.heightAt(node.x, node.z);
      const wantY = y0 + (y1 - y0) * t;

      const got = road.sampleAt(s);
      if (got.x !== wantX) fail(`deep sampleAt(${s.toFixed(0)}).x  ${got.x} !== ${wantX}`);
      if (got.y !== wantY) fail(`deep sampleAt(${s.toFixed(0)}).y  ${got.y} !== ${wantY}`);
      if (got.z !== wantZ) fail(`deep sampleAt(${s.toFixed(0)}).z  ${got.z} !== ${wantZ}`);
      checked++;
      nextTarget++;
    }
  }
  console.log(
    `sampleAt bit-identical at the far end: ${checked} deep probes, ` +
      `deepest ${(targets[targets.length - 1]! / 1000).toFixed(0)} km`,
  );
}

// --- 3. Repeat sampling is stable across eviction --------------------------
//
// The same `s` asked twice, with enough traffic in between to evict its block, must
// give the same answer. This is the property a chunk relies on when it is unloaded
// and rebuilt: a rebuilt chunk has to be the chunk that left.
{
  const road = new Road(seed, spine);
  const target = 123_456.75;
  const first = road.sampleAt(target);
  for (let k = 0; k < 64; k++) road.sampleAt((k * 5 * CHECKPOINT_SPACING) % ROAD_LENGTH);
  const again = road.sampleAt(target);
  if (first.x !== again.x || first.y !== again.y || first.z !== again.z) {
    fail('sampleAt is not stable across block eviction');
  }
  console.log('sampleAt stable across block eviction');
}

// --- 4. Hintless project never returns a worse point than the hinted search ---
//
// NOT "the same branch". The road random-walks and crosses near its own path, so a
// point 12 m from the branch it was generated on can be genuinely nearer to a
// different branch — measured on seed 42, where a point 12 m out from s = 175 610 sits
// 1.19 m from another pass of the road. Both answers are correct nearest points to
// different branches; the nearer one is the better answer, and it is the one a cold
// search should find. The hinted search cannot find it by design, because it descends
// from where the entity already was, which is the whole point of a hint.
//
// So the invariant is the one that actually matters for a rescue: a cold search must
// never come back with a point FURTHER away than the hinted search would have. That
// is what the multi-candidate scan buys, and what a single-winner scan broke.
{
  const road = new Road(seed, spine);
  let worstExcess = 0;
  let branchDisagreements = 0;
  const probes = 40;
  for (let k = 1; k <= probes; k++) {
    const s = (k / (probes + 1)) * ROAD_LENGTH;
    const off = road.offsetPoint(s, 12);
    const hinted = road.project(off.x, off.z, s);
    const cold = road.project(off.x, off.z);
    // Distance from the queried point to each answer's centreline point.
    const hintedAt = road.sampleAt(hinted.s);
    const coldAt = road.sampleAt(cold.s);
    const hintedD = Math.hypot(hintedAt.x - off.x, hintedAt.z - off.z);
    const coldD = Math.hypot(coldAt.x - off.x, coldAt.z - off.z);
    worstExcess = Math.max(worstExcess, coldD - hintedD);
    if (Math.abs(cold.s - hinted.s) > 1) branchDisagreements++;
    // The hinted search must still land on the branch it was given, to the refinement
    // floor. If this fails the descent itself is broken, not the candidate selection.
    if (Math.abs(hinted.lateral - 12) > 0.05) {
      fail(`hinted project at s=${s.toFixed(0)} reports lateral ${hinted.lateral.toFixed(3)}, not 12`);
    }
  }
  // A hair of slack for the refinement floor: both searches stop halving at 0.05 m.
  if (worstExcess > 0.05) {
    fail(`hintless project returned a point ${worstExcess.toFixed(3)} m further than the hinted one`);
  }
  console.log(
    `hintless project never worse than hinted: worst excess ${worstExcess.toFixed(4)} m ` +
      `(${branchDisagreements}/${probes} probes found a nearer branch than the hint)`,
  );
}

// --- 5. Resident cost -----------------------------------------------------
{
  const checkpointBytes = spine.checkpointX.byteLength * 3;
  const coarseBytes = spine.coarseX.byteLength * 2;
  console.log(
    `spine tables: ${spine.checkpointX.length} checkpoints (${(checkpointBytes / 1024).toFixed(0)} KB) + ` +
      `${spine.coarseX.length} coarse samples (${(coarseBytes / 1024).toFixed(0)} KB)`,
  );
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
