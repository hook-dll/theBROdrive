/**
 * Tap response: what one light tap of a steering key actually does to the car.
 *
 *   npx tsx tools/tap-response.ts [modelId] [speedKmh]
 *
 * The keyboard is how most players steer this game: they hold a key for a fraction of a
 * second, let go, and hold the other one to take it back. That makes the mapping from
 * TAP LENGTH to ROAD-WHEEL ANGLE the whole of the control system that matters most, and
 * it is not something that can be judged by reading the code — two soft-centre terms sit
 * in series (the input layer's smoothing and the vehicle's shaping exponent), and whether
 * they add up to a usable curve or a dead zone is only visible by measurement.
 *
 * WHAT THIS DEFENDS. A tap has to do something, and a longer tap has to do more. Those
 * two properties are what "light taps to correct the car" means, and both of them have
 * been broken here before: a steering-box free play of 0.024 rad at the road wheel meant
 * every tap under 100 ms produced literally no wheel angle at all, and the response then
 * jumped from nothing to over a degree between one 40 ms step and the next. See
 * STEER_PLAY_RAD in vehicle.ts for the measurement that found it.
 */

import { SurfaceType } from '../src/core/surfaces';
import { installAssetShim } from './assetshim';
import { addInclineGround, makeRig } from './handling-bench';
import { preloadCarModels } from '../src/render/carmodel';
import { FIXED_DT } from '../src/core/physics';

installAssetShim();

const DEG = 180 / Math.PI;
const model = process.argv[2] ?? 'sv_vaz2101';
const speedKmh = Number(process.argv[3] ?? 60);
const speedMps = speedKmh / 3.6;

/**
 * The keyboard input layer's own shaping, mirrored from core/input.ts: a binary key
 * target smoothed with an asymmetric time constant. Those two constants are private to
 * that module, so if they move this bench follows them by hand.
 */
const STEER_RISE = 0.45;
const STEER_RETURN = 0.32;

/** Tap lengths swept, seconds. The short end is a real tap, not a minimum hold. */
const TAPS = [0.04, 0.06, 0.08, 0.12, 0.16, 0.22, 0.3, 0.45, 0.7];
/** Taps whose whole point is that they must produce a measurable, small correction. */
const FINE_TAPS = [0.04, 0.06, 0.08];

interface TapResult {
  readonly tapS: number;
  readonly input: number;
  readonly steerDeg: number;
  readonly yawDegS: number;
  readonly latG: number;
}

await preloadCarModels([model]);

/**
 * One tap from the given speed.
 *
 * The car is put at the test speed once and then coasts: clamping the velocity every
 * step would hold the operating point perfectly, but it would also hold the yaw at zero
 * and report a car that cannot turn. Coasting for the second a tap lasts costs about
 * 3 km/h to rolling resistance, which is far smaller than the effect being measured.
 */
async function tap(tapS: number): Promise<TapResult> {
  const rig = await makeRig(
    model,
    (physics) => addInclineGround(physics, 0, SurfaceType.Asphalt),
    false,
  );
  const body = rig.vehicle.chassis;
  body.setLinvel({ x: 0, y: 0, z: -speedMps }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);

  let f = 0;
  let steerDeg = 0;
  let yawDegS = 0;
  let latG = 0;
  let input = 0;

  const steps = Math.round(3 / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * FIXED_DT;
    const want = t >= 1 && t < 1 + tapS ? 1 : 0;
    f += (want - f) * Math.min(1, FIXED_DT / (want === 0 ? STEER_RETURN : STEER_RISE));

    rig.input.throttle = t < 1 ? 0.25 : 0;
    rig.input.brake = 0;
    rig.input.reverse = false;
    rig.input.steer = f;
    rig.input.handbrake = false;
    rig.input.preciseSteering = false;

    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.physics.step();
    rig.vehicle.postStep();

    if (t < 1) continue;
    const angle = Math.abs(rig.vehicle.steerAngle);
    if (angle > steerDeg) steerDeg = angle;
    const yaw = Math.abs(body.angvel().y) * DEG;
    if (yaw > yawDegS) yawDegS = yaw;
    const vel = body.linvel();
    const g = (Math.abs(vel.x) * 9.81) / Math.max(0.1, Math.abs(vel.z));
    if (g > latG) latG = g;
    if (Math.abs(f) > input) input = Math.abs(f);
  }
  rig.vehicle.dispose();
  return {
    tapS,
    input,
    steerDeg: steerDeg * DEG,
    yawDegS,
    latG,
  };
}

const results: TapResult[] = [];
for (const t of TAPS) results.push(await tap(t));

console.log(`${model} at ${speedKmh} km/h on asphalt: one steering tap, held for the given time`);
console.log('  tap ms   input   steer deg   yaw deg/s    lat g   x previous');

let previous = 0;
for (const r of results) {
  const ratio = previous > 0 ? r.steerDeg / previous : 0;
  console.log(
    `${String(Math.round(r.tapS * 1000)).padStart(7)} ${r.input.toFixed(3).padStart(8)} ` +
      `${r.steerDeg.toFixed(2).padStart(11)} ${r.yawDegS.toFixed(1).padStart(11)} ` +
      `${r.latG.toFixed(3).padStart(8)} ${ratio.toFixed(2).padStart(11)}`,
  );
  previous = r.steerDeg;
}

const failures: string[] = [];

// A FINE TAP MUST DO SOMETHING. This is the assertion the dead zone used to fail: with
// 0.024 rad of free play, a 40 ms tap produced 0.00 degrees of road-wheel angle and the
// car did not deviate at all.
for (const r of results) {
  if (!FINE_TAPS.includes(r.tapS)) continue;
  if (r.steerDeg < 0.25) {
    failures.push(`a ${Math.round(r.tapS * 1000)} ms tap steers ${r.steerDeg.toFixed(2)} deg (expected at least 0.25)`);
  }
  if (r.steerDeg > 6) {
    failures.push(`a ${Math.round(r.tapS * 1000)} ms tap steers ${r.steerDeg.toFixed(2)} deg — too much for a fine correction`);
  }
}

// AND A LONGER TAP MUST DO MORE, all the way up. A response that is not monotonic in tap
// length cannot be learned, whatever its absolute size.
for (let i = 1; i < results.length; i++) {
  const previousResult = results[i - 1]!;
  const current = results[i]!;
  if (current.steerDeg < previousResult.steerDeg * 0.98) {
    failures.push(
      `the response is not monotonic: ${Math.round(previousResult.tapS * 1000)} ms gives ` +
        `${previousResult.steerDeg.toFixed(2)} deg but a longer ` +
        `${Math.round(current.tapS * 1000)} ms gives ${current.steerDeg.toFixed(2)}`,
    );
  }
}

// AND THERE MUST BE NO CLIFF: no single step of the sweep may multiply the response by
// more than three, or the finest correction available to the player lands on the wrong
// side of a discontinuity. Ratios are around 1.3-1.9 when the chain is healthy.
for (let i = 1; i < results.length; i++) {
  const previousResult = results[i - 1]!;
  const current = results[i]!;
  if (previousResult.steerDeg > 0.1 && current.steerDeg > previousResult.steerDeg * 3) {
    failures.push(
      `cliff between ${Math.round(previousResult.tapS * 1000)} ms and ` +
        `${Math.round(current.tapS * 1000)} ms: ${previousResult.steerDeg.toFixed(2)} to ` +
        `${current.steerDeg.toFixed(2)} deg`,
    );
  }
}

if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  throw new Error(`${failures.length} tap-response checks failed`);
}
console.log('\ntap response is smooth, monotonic, and a fine tap is a fine correction');
