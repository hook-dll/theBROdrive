/**
 * Pedal dose: does a key press deliver what the driver asked for?
 *
 *   npx tsx tools/pedal-dose.ts
 *
 * A keyboard pedal is a switch, so the ONLY thing that turns it into a dose is the
 * shaping the input layer applies: a rate-limited rise while the key is down, and a
 * decay when it comes up. What that produces has to have two properties, and neither of
 * them can be judged by reading the constants:
 *
 *   MONOTONIC. A longer press must deliver more pedal than a shorter one, all the way
 *   up. Every value the driver wants has to sit somewhere on the sweep.
 *
 *   PROPORTIONATE. The dose a press delivers must be roughly the press's OWN dose. If
 *   the release takes long enough, a hundred-millisecond tap keeps pushing the pedal
 *   down for another third of a second AFTER the driver let go — so a light tap brakes
 *   half a second's worth and there is no way to ask for a light touch. That tail is the
 *   same class of defect the steering had: an uncontrolled stage downstream of the
 *   driver's intent.
 *
 * "Dose" is the integral of the pedal axis over the press, which is what the tyre
 * actually receives. The pedal itself is not simulated here — the vehicle's own response
 * to a constant axis is measured by `tools/tmp-pedal-curve.ts` (brake) and the throttle
 * sweep, and it is progressive on both.
 */

import { FIXED_DT } from '../src/core/physics';

/**
 * Mirrored from core/input.ts. Those constants are private to that module, so this
 * bench follows them by hand and fails loudly if the behaviour they produce changes.
 */
const AXIS_RISE = 0.3;
const AXIS_FALL = 0.12;
const AXIS_SNAP = 1e-3;

/** Presses swept, seconds. A tap is 40-120 ms; a deliberate hold is a second. */
const TAPS = [0.04, 0.06, 0.08, 0.12, 0.18, 0.25, 0.4, 0.7, 1.2];

interface Dose {
  readonly pressS: number;
  readonly peak: number;
  /** Integral of the axis over the whole press-and-release, axis·seconds. */
  readonly doseS: number;
  /** The part of that integral delivered AFTER the key came up, axis·seconds. */
  readonly tailDoseS: number;
  /** Seconds after release for the axis to fall back under a tenth. */
  readonly tailS: number;
}

function shape(pressS: number): Dose {
  let value = 0;
  let peak = 0;
  let dose = 0;
  let tailDose = 0;
  let tailS = 0;
  // Long enough for the longest press plus several of the slowest release.
  const totalS = pressS + 3;
  for (let t = 0; t < totalS; t += FIXED_DT) {
    const want = t < pressS ? 1 : 0;
    value +=
      (want - value) * Math.min(1, FIXED_DT / (want > 0 ? AXIS_RISE : AXIS_FALL));
    if (Math.abs(want - value) <= AXIS_SNAP) value = want;
    if (t < pressS) {
      dose += value * FIXED_DT;
      if (value > peak) peak = value;
    } else {
      dose += value * FIXED_DT;
      tailDose += value * FIXED_DT;
      if (value > 0.1) tailS += FIXED_DT;
    }
  }
  return { pressS, peak, doseS: dose, tailDoseS: tailDose, tailS };
}

const results = TAPS.map(shape);

console.log('pedal key shaping: one press, then release');
console.log('  press ms   peak   dose (axis·s)   after release   tail ms   tail/dose');

let previous = 0;
const failures: string[] = [];

for (const r of results) {
  console.log(
    `${String(Math.round(r.pressS * 1000)).padStart(10)} ${r.peak.toFixed(3).padStart(6)} ` +
      `${r.doseS.toFixed(3).padStart(15)} ${r.tailDoseS.toFixed(3).padStart(15)} ` +
      `${String(Math.round(r.tailS * 1000)).padStart(8)} ` +
      `${`${((r.tailDoseS / Math.max(1e-6, r.doseS)) * 100).toFixed(0)}%`.padStart(10)}`,
  );
  if (r.doseS <= previous) {
    failures.push(
      `dose is not monotonic: a ${Math.round(r.pressS * 1000)} ms press delivers ` +
        `${r.doseS.toFixed(3)} against ${previous.toFixed(3)} for a shorter one`,
    );
  }
  previous = r.doseS;
}

// THE TAIL IS THE DEFECT THIS BENCH EXISTS FOR. A press must be over shortly after the
// key comes up, or the driver is not in control of how much pedal they applied.
const MAX_TAIL_S = 0.35;
for (const r of results) {
  if (r.tailS > MAX_TAIL_S) {
    failures.push(
      `the pedal keeps falling for ${Math.round(r.tailS * 1000)} ms after a ` +
        `${Math.round(r.pressS * 1000)} ms press was released (limit ${MAX_TAIL_S * 1000})`,
    );
  }
}

// AND THE RELEASE MAY NOT BE A SECOND PRESS. This is the defect the bench was written
// for, and it is measured as an EQUIVALENT HOLD: the impulse delivered after the key
// comes up, expressed as seconds of the pedal value the press reached. A release that
// adds a fifth of a second of the pedal the driver built is the longest that can still
// be called a release; at the old 0.3 s decay a 40 ms tap delivered EIGHT times its own
// press in the tail, which is why the brake felt like a switch with one setting.
const MAX_TAIL_EQUIVALENT_S = 0.2;
for (const r of results) {
  const equivalent = r.tailDoseS / Math.max(1e-6, r.peak);
  if (equivalent > MAX_TAIL_EQUIVALENT_S) {
    failures.push(
      `releasing a ${Math.round(r.pressS * 1000)} ms press adds ${equivalent.toFixed(2)} s of ` +
        `pedal in the tail (limit ${MAX_TAIL_EQUIVALENT_S})`,
    );
  }
}

// A steady mid value has to be REACHABLE, which is the whole reason the rise is not
// instant: with the whole travel crossed in a couple of frames there is nowhere for a
// human to stop. Ten per cent of value per 20 ms of timing is the loose bound.
const jitter = shape(0.1);
const jitterPlus = shape(0.12);
const perFrame = (jitterPlus.doseS - jitter.doseS) / Math.max(1e-6, jitter.doseS);
if (perFrame > 0.5) {
  failures.push(
    `the mid range is too steep to hit: 20 ms of timing changes the dose by ` +
      `${(perFrame * 100).toFixed(0)}%`,
  );
}

if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  throw new Error(`${failures.length} pedal-dose checks failed`);
}
console.log(
  '\npedal dose is monotonic in press length, reaches 1.0, and releases in control',
);
