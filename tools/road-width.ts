/**
 * The carriageway: how often it opens out, how it gets there, and what a driver is
 * standing on when it does.
 *
 * The width profile is a pure function of (seed, s) — nothing is stored in the spine,
 * its cache or the worker payload — so everything below is checked by walking the
 * function itself over hundreds of kilometres rather than by building a road.
 *
 *   npx tsx tools/road-width.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import {
  LANE_WIDTH,
  NARROW_HALF_WIDTH,
  WIDE_HALF_WIDTH,
  halfWidthAt,
  laneHalfWidthFor,
  laneOffsetFor,
  lanesPerSideAt,
  widenessAt,
} from '../src/world/roadprofile';

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
/** Road walked, metres, and the step. A 0.5 m step resolves a 260 m taper finely. */
const SCAN_M = 400_000;
const STEP_M = 0.5;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

// --- what the road does over 400 km -------------------------------------------
let narrowSteps = 0;
let wideSteps = 0;
let taperSteps = 0;
let worstJump = 0;
let worstJumpS = 0;
let previous = halfWidthAt(SEED, 0);
const runs: number[] = [];
let runStart = -1;
for (let s = STEP_M; s < SCAN_M; s += STEP_M) {
  const half = halfWidthAt(SEED, s);
  const lanes = lanesPerSideAt(SEED, s);
  const jump = Math.abs(half - previous);
  if (jump > worstJump) {
    worstJump = jump;
    worstJumpS = s;
  }
  previous = half;
  if (half <= NARROW_HALF_WIDTH + 1e-9) narrowSteps++;
  else if (half >= WIDE_HALF_WIDTH - 1e-9) wideSteps++;
  else taperSteps++;
  if (lanes === 2 && runStart < 0) runStart = s;
  if (lanes === 1 && runStart >= 0) {
    runs.push(s - runStart);
    runStart = -1;
  }
}

const total = narrowSteps + wideSteps + taperSteps;
console.log(
  `seed ${SEED}: ${(SCAN_M / 1000).toFixed(0)} km walked — ` +
    `${((narrowSteps / total) * 100).toFixed(1)}% one lane each way, ` +
    `${((wideSteps / total) * 100).toFixed(1)}% two, ` +
    `${((taperSteps / total) * 100).toFixed(1)}% in a taper`,
);
const longest = runs.length > 0 ? Math.max(...runs) : 0;
const shortest = runs.length > 0 ? Math.min(...runs) : 0;
console.log(
  `  ${runs.length} widened stretches, ${(shortest / 1000).toFixed(1)}–${(longest / 1000).toFixed(1)} km long, ` +
    `mean ${(runs.reduce((a, b) => a + b, 0) / Math.max(1, runs.length) / 1000).toFixed(1)} km`,
);

check(
  'the road is mostly the two-lane road it always was',
  narrowSteps / total > 0.5,
  `${((narrowSteps / total) * 100).toFixed(1)}% narrow`,
);
check(
  'and it does open out often enough to be a feature',
  runs.length >= 8,
  `${runs.length} widened stretches in ${(SCAN_M / 1000).toFixed(0)} km`,
);
// A 0.5 m step across a 260 m smoothstep taper can change the width by at most
// LANE_WIDTH * 1.5 * STEP / TAPER. Anything larger is a step in the asphalt edge.
check(
  'the edge never steps',
  worstJump < 0.02,
  `worst ${(worstJump * 1000).toFixed(1)} mm over ${STEP_M} m, at s=${worstJumpS.toFixed(0)}`,
);
check(
  'the homestead is on the narrow road',
  halfWidthAt(SEED, 0) === NARROW_HALF_WIDTH && halfWidthAt(SEED, 900) === NARROW_HALF_WIDTH,
  `${halfWidthAt(SEED, 0).toFixed(2)} m at the house, ${halfWidthAt(SEED, 900).toFixed(2)} m at 900 m`,
);

// --- a lane is a lane wherever it is offered -----------------------------------
let worstOuterLane = Infinity;
let narrowestLaneS = 0;
let offEdge = 0;
for (let s = 0; s < SCAN_M; s += STEP_M) {
  const lanes = lanesPerSideAt(SEED, s);
  const half = halfWidthAt(SEED, s);
  for (let lane = 0; lane < lanes; lane++) {
    const centre = laneOffsetFor(half, lane);
    // A lane's own band: the outer one is only as wide as the widening laid down.
    if (centre + laneHalfWidthFor(half, lane) > half + 1e-9) offEdge++;
  }
  if (lanes === 2) {
    // Width actually available to the outer lane: from the inner lane's edge out.
    const outer = half - LANE_WIDTH;
    if (outer < worstOuterLane) {
      worstOuterLane = outer;
      narrowestLaneS = s;
    }
  }
}
check(
  'no lane is ever offered off the asphalt',
  offEdge === 0,
  `${offEdge} lane-samples over the edge`,
);
check(
  'the outer lane is a lane, not a wedge, wherever it is offered',
  worstOuterLane >= LANE_WIDTH * 0.85,
  `narrowest ${worstOuterLane.toFixed(2)} m at s=${narrowestLaneS.toFixed(0)}`,
);
check(
  'the inner lane never moves',
  laneOffsetFor(NARROW_HALF_WIDTH, 0) === laneOffsetFor(WIDE_HALF_WIDTH, 0),
  `${laneOffsetFor(WIDE_HALF_WIDTH, 0).toFixed(2)} m from the crown, narrow and wide alike`,
);

// --- the merge has room --------------------------------------------------------
// Where the outer lane closes, how much road is there between "lane count drops to
// one" and "the asphalt is back to 5.8 m"? That distance is what a merging car has.
let worstMergeRoom = Infinity;
let worstMergeS = 0;
let wasTwo = lanesPerSideAt(SEED, 0) === 2;
for (let s = STEP_M; s < SCAN_M; s += STEP_M) {
  const two = lanesPerSideAt(SEED, s) === 2;
  if (wasTwo && !two) {
    // Walk on to where the widening has fully closed.
    let end = s;
    while (end < SCAN_M && widenessAt(SEED, end) > 1e-6) end += STEP_M;
    const room = end - s;
    if (room < worstMergeRoom) {
      worstMergeRoom = room;
      worstMergeS = s;
    }
  }
  wasTwo = two;
}
check(
  'a car losing its lane still has road to merge in',
  worstMergeRoom >= 40,
  `least ${worstMergeRoom.toFixed(0)} m of closing wedge, at s=${worstMergeS.toFixed(0)}`,
);

console.log(failures === 0 ? '\nthe carriageway holds together' : `\n${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
