/**
 * tools/road-scale.ts
 *
 * The acceptance instrument for rescaling the road from 400 km to 40 000 km. It
 * answers one question with measurements, not estimates: what does making the road
 * longer actually cost, and which of those costs break which budget?
 *
 * The road is now a spine (see roadspine.ts): one XZ walk snapshots a checkpoint
 * every CHECKPOINT_SPACING metres and a coarse position every COARSE_SPACING metres,
 * and `Road` replays 10 km blocks from checkpoints through an 8-block LRU. So the
 * numbers that decide the rescale are:
 *
 *   1. buildSpine — the one-time XZ walk, linear in length, plus the constant cost of
 *      replaying one block (which adds the landscape heightAt the spine deliberately
 *      skips). Resident memory is the two flat spine tables plus a fixed 640 KB block
 *      cache, not the old growing node arrays.
 *
 *   2. The float32 step at the furthest coordinate. The world runs through Rapier as
 *      float32, so as the road winds out to tens of kilometres the smallest
 *      representable step grows until it eats the suspension's travel and the ride is
 *      destroyed. This decides when the floating origin has to kick in.
 *
 *   3. The hintless `project()` scan. Without a hint this scans the coarse table,
 *      whose length is linear in the road, before refining several candidate branches.
 *
 * The tool prints a verdict block against fixed budgets. The spine already turns the
 * resident-memory and main-thread-load budgets green; the float32 step and the
 * hintless scan are what the floating-origin work has left to fix.
 *
 *   npx tsx tools/road-scale.ts [km]
 *
 * Nothing here is part of the game bundle.
 */

import { NODE_SPACING, RoadCurvature, stepNode, type NodeState } from '../src/world/roadcurve';
import { buildSpine, CHECKPOINT_NODES, CHECKPOINT_SPACING, COARSE_SPACING } from '../src/world/roadspine';
import { ROAD_LENGTH, Road } from '../src/world/road';
import { REBASE_RADIUS } from '../src/world/origin';

/**
 * Fixed seed so the report is reproducible. The headline figures are per-node and
 * per-coordinate, so they hold for any seed to within noise; the constant just makes
 * a re-run print identical numbers.
 */
const SEED = 1337;

const kmArg = (() => {
  const n = Number(process.argv[2] ?? 40_000);
  return Number.isFinite(n) && n > 0 ? n : 40_000;
})();
const LENGTH_M = kmArg * 1000;

/* ---- section 2 milestones ----
 *
 * Fixed report rows, filtered to the configured length so `npx tsx tools/road-scale.ts 400`
 * prints only the 400 km row and not four rows of zero-length walks.
 */
const ALL_MILESTONES_KM = [400, 4000, 10_000, 20_000, 40_000];

/* ---- budgets for the verdict ----
 *
 * Stated once here so the verdict line and its PASS/FAIL are arithmetic over the same
 * constants. These are unchanged targets: the spine's job is to meet the resident
 * budget, and the floating-origin work's job is to meet the other three.
/** The one-time spine walk, in a Web Worker and persisted, must stay under this. */
const BUDGET_BUILD_MS = 2000;
/** Main-thread blocking work at load (spine read + one block replay) must fit one frame. */
const BUDGET_LOAD_MS = 16;
/** The spine tables plus block cache must stay under 8 MiB resident. */
const BUDGET_RESIDENT_BYTES = 8 * 1024 * 1024;
/**
 * The float32 ULP the LIVE world is held to, in metres.
 *
 * Measured against the rebased bound, not against the raw walk. The raw walk's 46 mm
 * at 40 000 km is still printed in section 2, because it is the number that motivates
 * the floating origin — but it is no longer what the game exposes to f32, so grading
 * against it would report a failure the code does not have. `world/origin.ts` bounds
 * the live world, and an in-game drive with rebasing active measured 1878 m of relative
 * extent, a 0.224 mm step.
 */
const BUDGET_FLOAT32_STEP_M = 0.001;
/**
 * A hintless `project()` must fit one frame.
 *
 * TIME, not sample count. The count was the budget first and it was the wrong metric:
 * 200 001 samples sounds alarming and measures 3.1 ms, because the scan is a flat pass
 * over two Float64Arrays with no integration and no allocation behind it. What matters
 * is that a rescue or a load never drops a frame, and that is a duration.
 */
const BUDGET_HINTLESS_MS = 16;

/**
 * Fixed resident cost of the node block cache. Eight blocks (road.ts BLOCK_CACHE), each
 * CHECKPOINT_NODES + 1 nodes across four Float64Arrays. Constant for any road length,
 * which is the whole point of the spine.
 */
const BLOCK_CACHE_BYTES = 8 * 4 * (CHECKPOINT_NODES + 1) * 8;
/**
 * Largest absolute coordinate any f32 can hold once the floating origin exists.
 *
 * The origin stays put until the anchor strays past REBASE_RADIUS (1500 m), and the
 * alive world extends VISUAL_RADIUS chunks past the player — 6 x CHUNK_LENGTH = 1200 m,
 * "only ±1200 m of world is ever alive" (see chunks.ts and origin.ts). So the furthest
 * f32 coordinate is 1500 + 1200 = 2.7 km, and origin.ts states the step there: 0.32 mm,
 * three orders of magnitude under the suspension travel it must not quantise. This is
 * constant no matter how long the road is — the property the floating origin buys.
 */
const REBASED_MAX_COORD = REBASE_RADIUS + 6 * 200;

/**
 * Smallest representable float32 step near a coordinate of magnitude `coord`, metres.
 *
 * A float32 has 23 mantissa bits, so the ULP of a value `v` is the next power of two
 * above it scaled by 2^-23; `v * 2^-23` is that step to within a factor of 2, which is
 * all the verdict needs.
 *
 * This is the number that decides the floating origin, not the coordinate itself.
 * Rapier's ray-cast suspension measures spring compression as a small difference
 * between two large world coordinates — the mount's world position and the ground a
 * decimetre or two below it. As the step approaches the suspension's ~0.3 m of travel
 * (see carmodels.ts SUSP_CAR `maxTravel`), that difference quantises away and the ride
 * turns into steps instead of springs. 1 mm is the budget here, well before that.
 */
function float32Step(coord: number): number {
  return coord * 2 ** -23;
}

/** Number of coarse table entries a `lengthM` road produces: one every COARSE_SPACING, plus s = 0. */
function coarseCount(lengthM: number): number {
  // COARSE_SPACING is a whole multiple of NODE_SPACING, so this equals buildSpine's
  // floor(lastNode / stride) + 1.
  return Math.floor(lengthM / COARSE_SPACING) + 1;
}

/**
 * Resident cost of a `lengthM` road: three checkpoint arrays and two coarse arrays
 * (all Float64Array, 8 B per entry) plus the fixed block cache.
 */
function residentBytes(lengthM: number): { checkpoints: number; coarse: number; bytes: number } {
  const lastNode = Math.floor(lengthM / NODE_SPACING);
  const checkpoints = Math.floor(lastNode / CHECKPOINT_NODES) + 1;
  const coarse = coarseCount(lengthM);
  const bytes = (3 * checkpoints + 2 * coarse) * 8 + BLOCK_CACHE_BYTES;
  return { checkpoints, coarse, bytes };
}

interface MilestoneRow {
  km: number;
  /** Largest absolute X or Z coordinate reached so far, metres. */
  maxAbs: number;
  /** Furthest straight-line distance from the origin so far, metres. */
  maxDist: number;
  /** Arclength where that furthest point happened, kilometres. */
  maxDistKm: number;
}

/**
 * Walks the centreline out to `lengthM` metres and reports coordinate extent at the
 * milestones, using the canonical `stepNode` recurrence so the numbers are bit-identical
 * to what the road actually is. XZ only: `heightAt` is never called.
 *
 * The walk is XZ only for two reasons, and the second is the load-bearing one. Elevation
 * is a function of POSITION, not arclength — it is not part of the centreline state and
 * cannot be integrated, and it is bounded by MAX_RELIEF (~142 m), so it cannot contribute
 * to a growing-coordinate problem. Only XZ grows without bound as the road winds, so only
 * XZ decides the float32 step. Calling `heightAt` here would double a ten-million-step
 * walk to buy a number that is pinned under 150 m by construction.
 */
function measureExtent(seed: number, lengthM: number): {
  milestones: MilestoneRow[];
  finalMaxAbs: number;
  finalMaxDist: number;
  finalMaxDistKm: number;
} {
  const steps = Math.floor(lengthM / NODE_SPACING);
  const km = ALL_MILESTONES_KM.filter((k) => k <= lengthM / 1000);
  const milestoneSteps = km.map((k) => (k * 1000) / NODE_SPACING);
  const milestones: MilestoneRow[] = km.map((m) => ({ km: m, maxAbs: 0, maxDist: 0, maxDistKm: 0 }));

  // Hoisted: one mutable NodeState and no allocation inside the loop — stepNode mutates
  // in place, which is the contract that makes a ten-million-step walk cheap.
  const curvature = new RoadCurvature(seed);
  const node: NodeState = { x: 0, z: 0, heading: 0 };
  let maxAbs = 0;
  let maxDist2 = 0;
  let maxDistS = 0;
  let mi = 0;

  for (let i = 0; i < steps; i++) {
    stepNode(node, curvature, i);

    const ax = node.x < 0 ? -node.x : node.x;
    const az = node.z < 0 ? -node.z : node.z;
    if (ax > maxAbs) maxAbs = ax;
    if (az > maxAbs) maxAbs = az;

    const d2 = node.x * node.x + node.z * node.z;
    if (d2 > maxDist2) {
      maxDist2 = d2;
      maxDistS = (i + 1) * NODE_SPACING;
    }

    if (mi < milestoneSteps.length && i + 1 === milestoneSteps[mi]) {
      milestones[mi]!.maxAbs = maxAbs;
      milestones[mi]!.maxDist = Math.sqrt(maxDist2);
      milestones[mi]!.maxDistKm = maxDistS / 1000;
      mi++;
    }
  }

  return { milestones, finalMaxAbs: maxAbs, finalMaxDist: Math.sqrt(maxDist2), finalMaxDistKm: maxDistS / 1000 };
}

/* ---- formatting helpers ---- */

function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function fmtMm(m: number): string {
  const mm = m * 1000;
  return mm >= 10 ? `${mm.toFixed(1)} mm` : `${mm.toFixed(2)} mm`;
}

function fmtMiB(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib.toFixed(1)} MiB`;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(1)} ms`;
}

function pass(ok: boolean): string {
  return ok ? 'PASS' : 'FAIL';
}

/* ========================== section 1: spine & block cache cost ========================== */

const cfgNodes = Math.floor(LENGTH_M / NODE_SPACING);

const tBuild0 = performance.now();
const spineCfg = buildSpine(SEED, LENGTH_M);
const buildMs = performance.now() - tBuild0;

// A spine matching the one real Road there is (ROAD_LENGTH), for the block-replay and
// project measurements. For a 400 km run this is the same walk already timed above.
const spine400 = LENGTH_M === ROAD_LENGTH ? spineCfg : buildSpine(SEED, ROAD_LENGTH);

// Main-thread load cost: construct a Road from an already-built spine and sample one
// deep point, which replays a single block. This is what a returning player pays on the
// main thread — the spine cache read (a flat-array deserialise) plus one block replay —
// so the measured construct + first sampleAt is the blocking proxy for that.
const tLoad0 = performance.now();
const coldRoad = new Road(SEED, spine400);
coldRoad.sampleAt(ROAD_LENGTH * 0.5);
const loadMs = performance.now() - tLoad0;

// The sampleAt above is a single first-run shot, before V8 optimises the replay loop.
// Walk several blocks to warm it, then replay a non-resident block for the steady-state
// per-node cost, used only to show heightAt's share of the replay.
for (let s = 0; s < 8 * CHECKPOINT_SPACING; s += CHECKPOINT_SPACING) coldRoad.sampleAt(s);
const tWarmBlock0 = performance.now();
coldRoad.sampleAt(ROAD_LENGTH * 0.5);
const warmBlockMs = performance.now() - tWarmBlock0;

const resident = residentBytes(LENGTH_M);

console.log('road scale @ ' + kmArg.toLocaleString('en-US') + ' km');
console.log('');
console.log('1. SPINE & BLOCK CACHE COST');
console.log(
  '   buildSpine(seed, ' + LENGTH_M.toLocaleString('en-US') + ' m) -> ' + cfgNodes.toLocaleString('en-US') + ' nodes   ' +
    fmtMs(buildMs) + '   ' + ((buildMs * 1000) / Math.max(1, cfgNodes)).toFixed(3) + ' us/node   [off main thread]',
);
console.log(
  '   main-thread load (new Road + 1 block replay): ' + fmtMs(loadMs),
);
console.log(
  '     replay warm steady-state: ' + fmtMs(warmBlockMs) + ', ~' +
    ((warmBlockMs * 1000 / CHECKPOINT_NODES) / Math.max(1e-9, (buildMs * 1000) / Math.max(1, cfgNodes))).toFixed(1) +
    'x the XZ walk (the extra is Landscape.heightAt)',
);
console.log(
  '   resident: ' + resident.checkpoints.toLocaleString('en-US') + ' checkpoints + ' + resident.coarse.toLocaleString('en-US') +
    ' coarse samples + 640 KB block cache = ' + fmtMiB(resident.bytes),
);
/* ==================== section 2: coordinate extent and float32 precision ==================== */

const extent0 = performance.now();
const extent = measureExtent(SEED, LENGTH_M);
const extentMs = performance.now() - extent0;

console.log('');
console.log(
  '2. COORDINATE EXTENT & FLOAT32 PRECISION  (XZ only, ' +
    cfgNodes.toLocaleString('en-US') + ' nodes, walked in ' + extentMs.toFixed(0) + ' ms)',
);
console.log('   km        max |x|/|z|    max distance from origin      float32 step');
for (const row of extent.milestones) {
  console.log(
    '   ' + String(row.km).padStart(5) +
      '      ' + fmtKm(row.maxAbs).padStart(11) +
      '    ' + fmtKm(row.maxDist).padStart(10) + ' (at ' + row.maxDistKm.toFixed(1) + ' km)' +
      '    ' + fmtMm(float32Step(row.maxAbs)).padStart(9),
  );
}
console.log(
  '   final: max |x|/|z| ' + fmtKm(extent.finalMaxAbs) +
    ', max distance ' + fmtKm(extent.finalMaxDist) + ' (at ' + extent.finalMaxDistKm.toFixed(1) + ' km)',
);
console.log(
  '   with floating origin: live world bounded to ' + fmtKm(REBASED_MAX_COORD) +
    ' -> float32 step ' + fmtMm(float32Step(REBASED_MAX_COORD)),
);

/* ========================== section 3: hintless project() cost ========================== */

console.log('');
console.log('3. HINTLESS project() COST');
console.log('   hintless scan reads the coarse table: floor(length / COARSE_SPACING) + 1 entries');
for (const km of [400, 4000, 40_000]) {
  console.log(
    '     ' + String(km).padStart(5) + ' km -> ' + coarseCount(km * 1000).toLocaleString('en-US') + ' coarse samples',
  );
}

// A point genuinely on the road, so `project` has a real closest point to find.
const probe = new Road(SEED, spine400);
probe.sampleAt(ROAD_LENGTH * 0.5);
const target = probe.sampleAt(ROAD_LENGTH * 0.5);

// Cold: a fresh Road with no injected spine pays the spine build once (the .spine
// getter), then the coarse scan + refinement. It no longer pays integration per coarse
// sample — that was the old sweep, which the flat table replaced.
const cold2 = new Road(SEED);
const tCold0 = performance.now();
cold2.project(target.x, target.z);
const coldMs = performance.now() - tCold0;

// Warm: the coarse scan + refinement alone, spine already built.
const tWarm0 = performance.now();
probe.project(target.x, target.z);
const warmMs = performance.now() - tWarm0;

console.log(
  '   measured against a point from sampleAt (s = ' + (ROAD_LENGTH * 0.5).toLocaleString('en-US') + ' m):',
);
console.log('     cold (incl. one spine build): ' + fmtMs(coldMs));
console.log('     warm (scan + refine only):    ' + fmtMs(warmMs));

/* ==================================== section 4: verdict ==================================== */

const cfgResident = resident.bytes;
const cfgStep = float32Step(extent.finalMaxAbs);
const cfgHintless = coarseCount(LENGTH_M);

console.log('');
console.log('VERDICT @ ' + kmArg.toLocaleString('en-US') + ' km');
console.log(
  '  first-ever build (off main thread): ' + fmtMs(buildMs) + '  ' + pass(buildMs < BUDGET_BUILD_MS) +
    '  (>' + BUDGET_BUILD_MS + ' ms)',
);
console.log(
  '  main-thread load (spine + 1 block):  ' + fmtMs(loadMs) + '  ' + pass(loadMs < BUDGET_LOAD_MS) +
    '  (>' + BUDGET_LOAD_MS + ' ms)',
);
console.log(
  '  resident: ' + fmtMiB(cfgResident) + '  ' + pass(cfgResident < BUDGET_RESIDENT_BYTES) +
    '  (>' + fmtMiB(BUDGET_RESIDENT_BYTES) + ')',
);
{
  const rebasedStep = float32Step(REBASED_MAX_COORD);
  console.log(
    '  float32 step (floating origin): ' + fmtMm(rebasedStep) + '  ' +
      pass(rebasedStep < BUDGET_FLOAT32_STEP_M) + '  (>' + BUDGET_FLOAT32_STEP_M * 1000 + ' mm)' +
      '   [' + fmtMm(cfgStep) + ' if the origin never moved]',
  );
}
console.log(
  '  hintless project: ' + fmtMs(warmMs) + ' warm over ' +
    cfgHintless.toLocaleString('en-US') + ' samples  ' +
    pass(warmMs < BUDGET_HINTLESS_MS) + '  (>' + BUDGET_HINTLESS_MS + ' ms)',
);
