/**
 * tools/twilight-ramp.ts
 *
 * Proves the scene's LIGHT BUDGET has no cliffs in it.
 *
 * The desert's brightness is not a palette lookup: it is two lights whose
 * intensities are real illuminance times an analytic exposure (see the exposure
 * block in render/sky.ts). Anything that makes that illuminance discontinuous —
 * or that clamps the exposure with a corner — turns dawn and dusk into a switch,
 * and the switch is the same width in DEGREES OF SOLAR ALTITUDE whatever the day
 * length is set to, which is why a slower clock never made it any less abrupt.
 *
 * The bug this exists to catch: the twilight sky bounce used to be
 * `smoothstep(-6, 6, altitude) * 2000` lux, which is EXACTLY zero below -6
 * degrees, with only a 0.001 lux epsilon beneath it. Since the exposure divides
 * by the illuminance, the scene held full daylight brightness down to -6 degrees
 * and collapsed to black inside the quarter-degree the smoothstep took to reach
 * zero — one second at the default 24-minute day.
 *
 * This walks the REAL AstronomySystem minute by minute through a full day at the
 * game's own latitude, rebuilds the exact intensities sky.ts hands to the two
 * lights, and reports the largest change either of them makes across one second
 * of wall clock at the default day length. A smooth cycle changes by a few per
 * cent a second through twilight; the old model changed by a factor of 2000.
 *
 *   npx tsx tools/twilight-ramp.ts
 *
 * Nothing here is part of the game bundle.
 */

import { AstronomySystem } from '../src/render/astronomy';
import { ADAPTATION_FLOOR, EXPOSURE_TARGET } from '../src/render/sky';
import { DAY_LENGTH } from '../src/game/state';

/** An equinox, so the sun crosses the horizon at its steepest for this latitude. */
const EPOCH = '2024-03-20';

/** The two lights, as sky.ts writes them, for one instant of the clock. */
interface Budget {
  readonly altitudeDeg: number;
  readonly key: number;
  readonly diffuse: number;
}

/**
 * What counts as a step, per second of wall clock at the default day length.
 *
 * Two measures, because a light can jump in two different ways and only one of
 * them is a ratio:
 *
 *  - TOTAL. How much light the scene has altogether. This is the one the eye
 *    reads as "the desert got darker", and it has to be judged as a ratio,
 *    because a tenth of the budget lost at dusk matters as much as half of it
 *    lost at noon. Real twilight compressed into a 24-minute day fades at about
 *    25% a second at its steepest, so 1.6x is a comfortable margin over honest
 *    physics and still far below the 2000x collapse this exists to catch.
 *
 *  - SHARE. How much of that total each light is carrying. Judged in absolute
 *    units of the budget, NOT as a ratio: the key light climbs out of nothing at
 *    sunrise, so its own ratio is unbounded and meaningless while it is still
 *    delivering a thousandth of the frame. What matters is the moment the split
 *    itself lurches — light moving from an even sky bounce into a hard low sun
 *    changes every shadow in view.
 */
const MAX_TOTAL_RATIO_PER_SECOND = 1.6;
const MAX_SHARE_STEP_PER_SECOND = 0.5;

function budgetAt(sky: AstronomySystem, timeOfDay: number): Budget {
  const frame = sky.update(EPOCH, 0, timeOfDay);
  const illuminance =
    frame.keyIlluminanceLux / 40_000 + frame.diffuseIlluminanceLux / 10_000;
  const exposure = EXPOSURE_TARGET / (illuminance + ADAPTATION_FLOOR);
  return {
    altitudeDeg: frame.sun.altitudeDeg,
    key: (frame.keyIlluminanceLux / 40_000) * exposure,
    diffuse: (frame.diffuseIlluminanceLux / 10_000) * exposure,
  };
}

const astronomy = new AstronomySystem();
// One in-game second at the default clock. The sun moves about a quarter of a
// degree in it, which is the width the old collapse hid inside.
const STEP_SECONDS = 1;
let worstTotal = { value: 1, altitudeDeg: 0, from: 0, to: 0 };
let worstShare = { value: 0, altitudeDeg: 0, from: 0, to: 0, light: 'key' };
let previous = budgetAt(astronomy, 0);

for (let t = STEP_SECONDS; t <= DAY_LENGTH; t += STEP_SECONDS) {
  const current = budgetAt(astronomy, t);

  const before = previous.key + previous.diffuse;
  const after = current.key + current.diffuse;
  const totalRatio = Math.max(before, after) / Math.max(Math.min(before, after), 1e-9);
  if (totalRatio > worstTotal.value) {
    worstTotal = { value: totalRatio, altitudeDeg: current.altitudeDeg, from: before, to: after };
  }

  const keyStep = Math.abs(current.key - previous.key);
  const diffuseStep = Math.abs(current.diffuse - previous.diffuse);
  const light = keyStep >= diffuseStep ? 'key' : 'diffuse';
  const shareStep = Math.max(keyStep, diffuseStep);
  if (shareStep > worstShare.value) {
    worstShare = {
      value: shareStep,
      altitudeDeg: current.altitudeDeg,
      from: light === 'key' ? previous.key : previous.diffuse,
      to: light === 'key' ? current.key : current.diffuse,
      light,
    };
  }

  previous = current;
}

console.log(`day length             ${DAY_LENGTH} s`);
console.log(`sampled                every ${STEP_SECONDS} s of the in-game clock`);
console.log(
  `steepest total fade    ${worstTotal.value.toFixed(3)}x ` +
    `(${worstTotal.from.toFixed(3)} -> ${worstTotal.to.toFixed(3)}) ` +
    `at solar altitude ${worstTotal.altitudeDeg.toFixed(2)} deg ` +
    `[budget ${MAX_TOTAL_RATIO_PER_SECOND.toFixed(2)}x]`,
);
console.log(
  `steepest split lurch   ${worstShare.value.toFixed(3)} on the ${worstShare.light} light ` +
    `(${worstShare.from.toFixed(3)} -> ${worstShare.to.toFixed(3)}) ` +
    `at solar altitude ${worstShare.altitudeDeg.toFixed(2)} deg ` +
    `[budget ${MAX_SHARE_STEP_PER_SECOND.toFixed(2)}]`,
);

// The dusk itself, as a table, because the numbers above only say where it broke.
console.log('\naltitude    key  diffuse   total');
let previousAltitude = Number.POSITIVE_INFINITY;
for (let t = 0; t <= DAY_LENGTH; t += 4) {
  const b = budgetAt(astronomy, t);
  const descending = b.altitudeDeg < previousAltitude;
  previousAltitude = b.altitudeDeg;
  if (!descending || b.altitudeDeg > 6 || b.altitudeDeg < -20) continue;
  console.log(
    `${b.altitudeDeg.toFixed(2).padStart(8)}  ${b.key.toFixed(3).padStart(5)}  ` +
      `${b.diffuse.toFixed(3).padStart(7)}  ${(b.key + b.diffuse).toFixed(3).padStart(6)}`,
  );
}

if (
  worstTotal.value > MAX_TOTAL_RATIO_PER_SECOND ||
  worstShare.value > MAX_SHARE_STEP_PER_SECOND
) {
  console.error('\nFAIL: the light budget steps rather than fades.');
  process.exitCode = 1;
} else {
  console.log('\nOK: every second of the cycle is a fade.');
}
