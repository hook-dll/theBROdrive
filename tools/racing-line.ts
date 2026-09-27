/**
 * The racing line's geometry: does it actually take bends outside-apex-outside?
 *
 *   bun tools/racing-line.ts
 *
 * `vehicle/racingline.ts` is a quadratic program over road offsets, and every way it
 * can be wrong looks like a plausible line: a sign slip apexes on the OUTSIDE of every
 * bend, a slack band puts the car on the sand, a lost home pull leaves it carrying the
 * last apex's offset down the next straight in the opposing lane. None of those shows
 * in a lap time until it is a crash, so the line is checked on a road whose answer is
 * known: a straight, a left-hander, a straight, a sharper right-hander, a straight.
 */

import { RacingLine, RACING_LINE_STEP_M } from '../src/vehicle/racingline';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

/** Positive curvature turns toward positive (left) offset, as on the real road. */
const LEFT = { from: 200, to: 320, curvature: 1 / 90 };
const RIGHT = { from: 380, to: 430, curvature: -1 / 60 };
const road = {
  curvatureAt(s: number): number {
    if (s > LEFT.from && s < LEFT.to) return LEFT.curvature;
    if (s > RIGHT.from && s < RIGHT.to) return RIGHT.curvature;
    return 0;
  },
};
const EDGE = 2.3;
const HOME = -1.45;
const START = -1.5;
const band = (_s: number, _distance: number, out: [number, number, number]): void => {
  out[0] = -EDGE;
  out[1] = EDGE;
  out[2] = HOME;
};

const line = new RacingLine();
line.solve(road, 0, 700, START, 0, band);

let worstBand = 0;
for (let s = 0; s <= 700; s += RACING_LINE_STEP_M) {
  worstBand = Math.max(worstBand, Math.abs(line.offsetAt(s)) - EDGE);
}
check('the line never leaves its band', worstBand <= 1e-9, `worst ${Math.max(0, worstBand).toFixed(4)} m past a ${EDGE} m edge`);
check('it starts where the car is', Math.abs(line.offsetAt(0) - START) < 1e-9, `${line.offsetAt(0).toFixed(3)} m against ${START} m`);

const midLeft = (LEFT.from + LEFT.to) / 2;
const midRight = (RIGHT.from + RIGHT.to) / 2;
check(
  'a left-hander is entered from the right and apexed on the left',
  line.offsetAt(LEFT.from - 40) < -1.5 && line.offsetAt(midLeft) > 1.5,
  `${line.offsetAt(LEFT.from - 40).toFixed(2)} m on entry, ${line.offsetAt(midLeft).toFixed(2)} m at the apex`,
);
check(
  'a right-hander is apexed on the right',
  line.offsetAt(midRight) < -1.5,
  `${line.offsetAt(midRight).toFixed(2)} m at the apex`,
);

let peakRight = 0;
for (let s = RIGHT.from - 60; s <= RIGHT.to + 60; s += 1) {
  peakRight = Math.max(peakRight, Math.abs(line.pathCurvatureAt(s)));
}
check(
  'the line is straighter than the road through a short bend',
  peakRight < Math.abs(RIGHT.curvature) * 0.8,
  `${(peakRight * 1000).toFixed(1)} against the road's ${(Math.abs(RIGHT.curvature) * 1000).toFixed(1)} mrad/m`,
);
check(
  'and goes home on the straight after it',
  Math.abs(line.offsetAt(690) - HOME) < 0.5,
  `${line.offsetAt(690).toFixed(2)} m, 260 m past the last bend, against a ${HOME} m home lane`,
);

// A shut band — the home lane only, as the driver uses beyond what it can vouch for —
// is obeyed exactly.
const shut = new RacingLine();
shut.solve(road, 0, 700, HOME, 0, (_s, _d, out) => {
  out[0] = HOME;
  out[1] = HOME;
  out[2] = HOME;
});
let shutWorst = 0;
for (let s = 0; s <= 700; s += RACING_LINE_STEP_M) shutWorst = Math.max(shutWorst, Math.abs(shut.offsetAt(s) - HOME));
check('a shut band holds the home lane', shutWorst < 1e-9, `worst ${shutWorst.toFixed(4)} m off it`);

if (failures > 0) {
  console.log(`\n${failures} racing-line check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log('\nthe racing line takes both bends outside, apex, outside, inside its band');
}
