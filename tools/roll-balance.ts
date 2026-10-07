/**
 * tools/roll-balance.ts
 *
 * Body roll, lateral load transfer and the handling balance they produce, measured the
 * way a chassis engineer measures them.
 *
 * 1. CONSTANT RADIUS (SAE J266). The car is held on a 50 m circle by a curvature loop
 *    on the steering while the speed climbs in steps of lateral acceleration. At each
 *    step: lateral g, the road-wheel angle, the body roll, the load transfer on each
 *    axle as the tyres see it, and the inside wheels' loads. On a constant radius the
 *    Ackermann angle is fixed, so the UNDERSTEER GRADIENT is the slope of road-wheel
 *    angle against lateral g (`US`, and `αUS` from the tyres' own slip angles, front
 *    less rear), and the ROLL GRADIENT the slope of roll against it — all fitted over
 *    the linear range (up to 0.45 g). The last steps show the balance at the limit
 *    (`limit°/g`, the last two steps): a steering angle that climbs ever faster is a
 *    car that runs out of front grip first (understeer); one that falls is a car whose
 *    tail is going.
 *
 *    `front LLTD` is the front axle's share of the total lateral load transfer, and
 *    `total/ideal` sums both axles' transfer as moments against `m · a_y · h`: what the
 *    tyres see has to add up to what the centre of mass asks for (a little over 1,
 *    because the leaning body also moves its own weight outboard). The `model` line is
 *    the textbook linear model of the same car from the numbers it was built with.
 *
 * 2. STEP STEER at 70 km/h to the angle the constant-radius run says gives 0.4 g there:
 *    the lateral acceleration's response and the roll's — peak, steady, overshoot, the
 *    crossings of the steady value after the peak — and the lightest inside wheel. Roll
 *    can only be as calm as the acceleration driving it.
 *
 * 3. ROLL RELEASE: straight at 60 km/h, the body leaned by the elastic roll moment of
 *    half a g and let go. Its swing past upright gives the roll mode's damping ratio,
 *    free of the steering and tyres, and the crossings are counted outside the road's
 *    own measured roll noise.
 *
 *   bun tools/roll-balance.ts [modelId ...] [--radius=50]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { preloadCarModels } from '../src/render/carmodel';
import { makeRig, drive, type Rig } from './handling-bench';

installAssetShim();
installDocumentShim();

const GRAVITY = 9.81;
const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? +hit.slice(name.length + 3) : fallback;
};
const ids = args.filter((a) => !a.startsWith('--'));
const models =
  ids.length > 0
    ? ids
    : ['sa_oka', 'sv_vaz2101', 'sv_vaz2106', 'gt_vaz2110', 'sa_uaz330364', 'sa_izh2715'];
const RADIUS = flag('radius', 50);
const LEVELS_G = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const LINEAR_MAX_G = 0.45;

interface WheelView {
  readonly isFront: boolean;
  readonly sideSign: number;
  readonly loadN: number;
  readonly staticLoadN: number;
  readonly slipAngleRad: number;
  readonly springRateNPerM: number;
  readonly barFraction: number;
  readonly rollCentreM: number;
}
interface Internals {
  wheels: WheelView[];
  steerAngle: number;
  rollLeverArm: number;
}

interface Sample {
  latG: number;
  deltaDeg: number;
  rollDeg: number;
  frontDF: number;
  rearDF: number;
  innerFront: number;
  innerRear: number;
  slipFDeg: number;
  slipRDeg: number;
}

const rad = (r: number): number => (r * 180) / Math.PI;

function rollOf(rig: Rig): number {
  const q = rig.vehicle.chassis.rotation();
  // Body +X lifted out of horizontal.
  return rad(Math.asin(Math.max(-1, Math.min(1, 2 * (q.x * q.y + q.w * q.z)))));
}

function speedOf(rig: Rig): number {
  const lv = rig.vehicle.chassis.linvel();
  return Math.hypot(lv.x, lv.z);
}

/** One instant of the axle loads, slip angles and inside-wheel fractions. */
function snapshot(rig: Rig): Omit<Sample, 'latG' | 'deltaDeg' | 'rollDeg'> {
  const internals = rig.vehicle as unknown as Internals;
  let fl = 0;
  let fr = 0;
  let rl = 0;
  let rr = 0;
  let fls = 0;
  let frs = 0;
  let rls = 0;
  let rrs = 0;
  let slipF = 0;
  let slipR = 0;
  let nf = 0;
  let nr = 0;
  for (const w of internals.wheels) {
    if (w.isFront) {
      slipF += Math.abs(w.slipAngleRad);
      nf++;
      if (w.sideSign < 0) {
        fl += w.loadN;
        fls += w.staticLoadN;
      } else {
        fr += w.loadN;
        frs += w.staticLoadN;
      }
    } else {
      slipR += Math.abs(w.slipAngleRad);
      nr++;
      if (w.sideSign < 0) {
        rl += w.loadN;
        rls += w.staticLoadN;
      } else {
        rr += w.loadN;
        rrs += w.staticLoadN;
      }
    }
  }
  return {
    frontDF: Math.abs(fl - fr) / 2,
    rearDF: Math.abs(rl - rr) / 2,
    innerFront: Math.min(fl / fls, fr / frs),
    innerRear: Math.min(rl / rls, rr / rrs),
    slipFDeg: rad(slipF / Math.max(1, nf)),
    slipRDeg: rad(slipR / Math.max(1, nr)),
  };
}

function slope(points: readonly Sample[], y: (s: Sample) => number): number {
  const n = points.length;
  if (n < 2) return NaN;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.latG;
    sy += y(p);
    sxx += p.latG * p.latG;
    sxy += p.latG * y(p);
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

function trackOf(rig: Rig, isFront: boolean): number {
  const xs = rig.vehicle.modelMeasure.wheels.filter((w) => w.isFront === isFront).map((w) => w.pos[0]);
  return Math.max(...xs) - Math.min(...xs);
}

function wheelbaseOf(rig: Rig): number {
  const ws = rig.vehicle.modelMeasure.wheels;
  const mean = (front: boolean): number => {
    const zs = ws.filter((w) => w.isFront === front).map((w) => w.pos[2]);
    return zs.reduce((a, b) => a + b, 0) / zs.length;
  };
  return Math.abs(mean(true) - mean(false));
}

interface CircleResult {
  samples: Sample[];
  limitReason: string;
}

/**
 * Constant radius: a curvature loop on the road-wheel angle, a speed loop on the
 * pedals, and a lateral-g ladder.
 */
function constantRadius(rig: Rig): CircleResult {
  const v = rig.vehicle;
  const internals = v as unknown as Internals;
  const wheelbase = wheelbaseOf(rig);
  const kappaTarget = 1 / RADIUS;
  let integral = 0;
  let targetSpeed = Math.sqrt(LEVELS_G[0]! * GRAVITY * RADIUS);
  let lastKappa = 0;

  const control = (f: Rig['input']): void => {
    const speed = speedOf(rig);
    const yaw = Math.abs(v.chassis.angvel().y);
    const kappa = speed > 1 ? yaw / speed : 0;
    lastKappa = kappa;
    const error = kappaTarget - kappa;
    integral = Math.max(-0.5, Math.min(0.5, integral + error * 3 * (1 / 60)));
    const angle = Math.max(0, wheelbase * kappaTarget + 2 * error + integral);
    f.steer = v.steeringInputForWheelAngle(angle);
    f.throttle = Math.max(0, Math.min(1, (targetSpeed - speed) * 0.5 + 0.2));
    f.brake = speed > targetSpeed + 1.5 ? 0.25 : 0;
  };

  // Up to the first level's speed straight, then onto the circle.
  drive(rig, 8, (_, f) => {
    const speed = speedOf(rig);
    f.steer = 0;
    f.throttle = Math.max(0, Math.min(1, (targetSpeed - speed) * 0.5 + 0.2));
  });
  drive(rig, 6, (_, f) => control(f));

  const samples: Sample[] = [];
  let limitReason = 'ladder complete';
  for (const g of LEVELS_G) {
    const from = targetSpeed;
    const to = Math.sqrt(g * GRAVITY * RADIUS);
    drive(rig, 3, (t, f) => {
      targetSpeed = from + (to - from) * Math.min(1, t / 2.5);
      control(f);
    });
    let n = 0;
    const acc: Sample = {
      latG: 0,
      deltaDeg: 0,
      rollDeg: 0,
      frontDF: 0,
      rearDF: 0,
      innerFront: 0,
      innerRear: 0,
      slipFDeg: 0,
      slipRDeg: 0,
    };
    let errorSum = 0;
    drive(rig, 3, (t, f) => {
      control(f);
      if (t < 1) return;
      const speed = speedOf(rig);
      acc.latG += (speed * Math.abs(v.chassis.angvel().y)) / GRAVITY;
      acc.deltaDeg += rad(Math.abs(internals.steerAngle));
      acc.rollDeg += Math.abs(rollOf(rig));
      const s = snapshot(rig);
      acc.frontDF += s.frontDF;
      acc.rearDF += s.rearDF;
      acc.innerFront += s.innerFront;
      acc.innerRear += s.innerRear;
      acc.slipFDeg += s.slipFDeg;
      acc.slipRDeg += s.slipRDeg;
      errorSum += (lastKappa - kappaTarget) / kappaTarget;
      n++;
    });
    for (const key of Object.keys(acc) as (keyof Sample)[]) acc[key] /= n;
    // The loop's mean miss over the window: a car that runs wide of the circle with the
    // steering wound on is out of front grip; one that tightens on to it is losing the
    // tail.
    const meanError = errorSum / n;
    if (Math.abs(meanError) > 0.04) {
      limitReason =
        `cannot hold ${RADIUS} m at ${g.toFixed(2)} g: ` +
        (meanError < 0
          ? `runs ${(-100 * meanError).toFixed(0)}% wide (front gone)`
          : `tightens ${(100 * meanError).toFixed(0)}% (rear gone)`);
      break;
    }
    samples.push(acc);
    // Holding the radius but not the speed: the tyres are scrubbing off more than the
    // engine can put back, which is the limit too.
    if (acc.latG < g - 0.05) {
      limitReason = `holds ${RADIUS} m but not the pace for ${g.toFixed(2)} g`;
      break;
    }
  }
  return { samples, limitReason };
}

interface Response {
  peak: number;
  steady: number;
  overshootPct: number;
  crossings: number;
  settleS: number;
}

/** Peak, steady value (last quarter), overshoot, crossings of steady after the peak, settle. */
function response(series: readonly number[], dt: number): Response {
  const tail = series.slice(Math.floor(series.length * 0.75));
  const steady = tail.reduce((a, b) => a + b, 0) / tail.length;
  let peakIndex = 0;
  for (let i = 0; i < series.length; i++) if (series[i]! > series[peakIndex]!) peakIndex = i;
  const band = 0.05 * steady;
  let crossings = 0;
  let side = Math.sign(series[peakIndex]! - steady);
  for (let i = peakIndex + 1; i < series.length; i++) {
    const d = series[i]! - steady;
    if (Math.abs(d) < band) continue;
    const s = Math.sign(d);
    if (s !== side) {
      crossings++;
      side = s;
    }
  }
  let settleIndex = 0;
  for (let i = 0; i < series.length; i++) {
    if (Math.abs(series[i]! - steady) > 0.1 * steady) settleIndex = i;
  }
  return {
    peak: series[peakIndex]!,
    steady,
    overshootPct: (100 * (series[peakIndex]! - steady)) / steady,
    crossings,
    settleS: (settleIndex + 1) * dt,
  };
}

interface StepResult {
  roll: Response;
  /** The lateral acceleration's own response: roll can only be as calm as its input. */
  accel: Response;
  innerMin: number;
}

/** Step steer at cruise to `angleRad` of road-wheel angle. */
function stepSteer(rig: Rig, kmh: number, angleRad: number): StepResult {
  const v = rig.vehicle;
  const target = kmh / 3.6;
  const pedals = (f: Rig['input']): void => {
    const speed = speedOf(rig);
    f.throttle = Math.max(0, Math.min(1, (target - speed) * 0.5 + 0.25));
    f.brake = speed > target + 2 ? 0.2 : 0;
  };
  drive(rig, 18, (_, f) => {
    f.steer = 0;
    pedals(f);
  });
  const rolls: number[] = [];
  const accels: number[] = [];
  let innerMin = Infinity;
  const seconds = 4;
  let previous = v.chassis.linvel();
  drive(rig, seconds, (t, f) => {
    // A 0.1 s ramp: a hand on a wheel, not a discontinuity.
    f.steer = v.steeringInputForWheelAngle(angleRad * Math.min(1, t / 0.1));
    pedals(f);
    rolls.push(Math.abs(rollOf(rig)));
    // The centre of mass' acceleration along the body's own lateral axis.
    const now = v.chassis.linvel();
    const q = v.chassis.rotation();
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const ry = 2 * (q.x * q.y + q.w * q.z);
    const rz = 2 * (q.x * q.z - q.w * q.y);
    const step = 1 / 60;
    accels.push(
      Math.abs(
        ((now.x - previous.x) * rx + (now.y - previous.y) * ry + (now.z - previous.z) * rz) / step,
      ) / GRAVITY,
    );
    previous = now;
    const s = snapshot(rig);
    innerMin = Math.min(innerMin, s.innerFront, s.innerRear);
  });
  const dt = seconds / rolls.length;
  // The acceleration is a difference of two velocities, so it is smoothed over 50 ms
  // before its peak is read; the roll angle needs no such help.
  const smooth = accels.map((_, i) => {
    const from = Math.max(0, i - 1);
    const to = Math.min(accels.length - 1, i + 1);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += accels[j]!;
    return sum / (to - from + 1);
  });
  return { roll: response(rolls, dt), accel: response(smooth, dt), innerMin };
}

interface ReleaseResult {
  heldDeg: number;
  /** The road's own roll noise at 60 km/h straight ahead, degrees peak. */
  noiseDeg: number;
  /** Largest swing past upright after release, as a fraction of the held lean. */
  overshoot: number;
  /** Damping ratio from that overshoot, `-ln(OS) / sqrt(pi² + ln²(OS))`. */
  zeta: number;
  crossings: number;
  settleS: number;
}

/**
 * Roll release: the car, rolling straight at 60 km/h, is leaned over by a steady roll
 * couple and let go. The only things acting on the roll after that are the springs,
 * bars and dampers, so this isolates the roll damping from the steering and tyre
 * dynamics a step steer folds in. Rolling rather than parked because a parked tyre's
 * static hold pins the contact patches, and a roll about a raised roll centre scrubs
 * them sideways: parked, the tyres would be the damper.
 */
function rollRelease(rig: Rig, couple: number): ReleaseResult {
  const v = rig.vehicle;
  const torque = { x: 0, y: 0, z: 0 };
  const target = 60 / 3.6;
  const lean = (t: number, f: Rig['input']): void => {
    const speed = speedOf(rig);
    f.steer = 0;
    f.throttle = Math.max(0, Math.min(1, (target - speed) * 0.5 + 0.2));
    if (t < 0) return;
    const q = v.chassis.rotation();
    // Body +Z (forward) in world space, scaled by the couple's impulse this step.
    const scale = couple / 60;
    torque.x = 2 * (q.x * q.z + q.w * q.y) * scale;
    torque.y = 2 * (q.y * q.z - q.w * q.x) * scale;
    torque.z = (1 - 2 * (q.x * q.x + q.y * q.y)) * scale;
    v.chassis.applyTorqueImpulse(torque, true);
  };
  drive(rig, 13, (_, f) => lean(-1, f));
  // The road's own noise floor, and the straight-ahead roll it is measured from (a
  // live axle's drive torque leans the body a little on its own).
  const quiet: number[] = [];
  drive(rig, 1, (_, f) => {
    lean(-1, f);
    quiet.push(rollOf(rig));
  });
  const baseline = quiet.reduce((a, b) => a + b, 0) / quiet.length;
  const noise = Math.max(...quiet.map((r) => Math.abs(r - baseline)));
  drive(rig, 2, (t, f) => lean(t, f));
  const held = rollOf(rig) - baseline;
  const series: number[] = [];
  drive(rig, 3, (_, f) => {
    lean(-1, f);
    series.push(rollOf(rig) - baseline);
  });
  const sign = Math.sign(held);
  let swing = 0;
  for (const r of series) swing = Math.max(swing, -sign * r);
  const overshoot = Math.max(0, swing / Math.abs(held));
  const ln = Math.log(Math.max(overshoot, 1e-6));
  const zeta = overshoot > 1e-4 ? -ln / Math.sqrt(Math.PI * Math.PI + ln * ln) : 1;
  // Crossings and settling are counted outside the road's own noise, or a car on a
  // textured road would never be "settled" at all.
  let crossings = 0;
  let side = sign;
  const band = Math.max(0.03 * Math.abs(held), 1.5 * noise);
  for (const r of series) {
    if (Math.abs(r) < band) continue;
    const s = Math.sign(r);
    if (s !== side) {
      crossings++;
      side = s;
    }
  }
  let settle = 0;
  const settleBand = Math.max(0.1 * Math.abs(held), 1.5 * noise);
  for (let i = 0; i < series.length; i++) if (Math.abs(series[i]!) > settleBand) settle = i;
  return { heldDeg: held, noiseDeg: noise, overshoot, zeta, crossings, settleS: (settle + 1) / 60 };
}

await preloadCarModels(models);
const summary: string[] = [];
for (const id of models) {
  console.log(`\n=== ${id}: constant radius ${RADIUS} m ===`);
  const rig = await makeRig(id);
  const v = rig.vehicle;
  const internals = v as unknown as Internals;
  const mass = v.chassis.mass();
  const h = internals.rollLeverArm;
  const tf = trackOf(rig, true);
  const tr = trackOf(rig, false);
  // The linear textbook model of the same car, from the numbers the vehicle was built
  // with: roll stiffness per axle `k (1 + bar) t² / 2`, roll axis through the two roll
  // centres, and the sprung mass' own lean (the gravity term) in the denominator. A
  // build without roll centres (the old one) reads them as the road.
  let rollAxis = 0;
  {
    const ws = internals.wheels;
    const front = ws.filter((w) => w.isFront);
    const rear = ws.filter((w) => !w.isFront);
    const statF = front.reduce((a, w) => a + w.staticLoadN, 0);
    const statR = rear.reduce((a, w) => a + w.staticLoadN, 0);
    const share = statF / (statF + statR);
    const kf = front[0]!.springRateNPerM * (1 + front[0]!.barFraction) * (tf * tf) / 2;
    const kr = rear[0]!.springRateNPerM * (1 + rear[0]!.barFraction) * (tr * tr) / 2;
    const hrf = front[0]!.rollCentreM ?? 0;
    const hrr = rear[0]!.rollCentreM ?? 0;
    const hra = hrf + (hrr - hrf) * (1 - share);
    rollAxis = hra;
    const moment = mass * GRAVITY * (h - hra);
    const rollPerG = rad(moment / (kf + kr - moment));
    const lltd = (share * hrf + (kf / (kf + kr)) * (h - hra)) / h;
    console.log(
      `  model: m ${mass.toFixed(0)} kg, h ${h.toFixed(3)} m, front ${(100 * share).toFixed(1)}%, ` +
        `track ${tf.toFixed(2)}/${tr.toFixed(2)} m, wheel rate ${(front[0]!.springRateNPerM / 1000).toFixed(1)}/` +
        `${(rear[0]!.springRateNPerM / 1000).toFixed(1)} kN/m, bar ${front[0]!.barFraction}/${rear[0]!.barFraction}, ` +
        `RC ${hrf}/${hrr} m -> roll axis ${hra.toFixed(3)} m, K ${((kf * Math.PI) / 180).toFixed(0)}/` +
        `${((kr * Math.PI) / 180).toFixed(0)} N·m/°: ${rollPerG.toFixed(2)}°/g, front LLTD ${(100 * lltd).toFixed(0)}%`,
    );
  }
  const { samples, limitReason } = constantRadius(rig);
  console.log(
    '  lat g   delta°   roll°   front dF   rear dF   front LLTD   total/ideal   inner F   inner R   slipF°  slipR°',
  );
  for (const s of samples) {
    const front = s.frontDF * tf;
    const rear = s.rearDF * tr;
    const ideal = mass * s.latG * GRAVITY * h;
    console.log(
      `  ${s.latG.toFixed(2).padStart(5)}  ${s.deltaDeg.toFixed(2).padStart(6)}  ${s.rollDeg.toFixed(2).padStart(6)}  ` +
        `${s.frontDF.toFixed(0).padStart(8)}  ${s.rearDF.toFixed(0).padStart(8)}   ` +
        `${((100 * front) / (front + rear)).toFixed(0).padStart(8)}%   ${((front + rear) / ideal).toFixed(2).padStart(10)}` +
        `   ${s.innerFront.toFixed(2).padStart(7)}   ${s.innerRear.toFixed(2).padStart(7)}` +
        `  ${s.slipFDeg.toFixed(2).padStart(6)}  ${s.slipRDeg.toFixed(2).padStart(6)}`,
    );
  }
  console.log(`  limit: ${limitReason}`);
  v.dispose();

  const linear = samples.filter((s) => s.latG <= LINEAR_MAX_G);
  const understeer = slope(linear, (s) => s.deltaDeg);
  // The same gradient read off the tyres: front slip angle less rear, per g. On a
  // bicycle model the two agree; this one is free of the steering's play and bump steer.
  const slipUndersteer = slope(linear, (s) => s.slipFDeg - s.slipRDeg);
  const rollGradient = slope(linear, (s) => s.rollDeg);
  const last = samples.slice(-2);
  const limitGradient = last.length === 2 ? slope(last, (s) => s.deltaDeg) : NaN;
  const top = samples[samples.length - 1];
  const mid = samples.find((s) => Math.abs(s.latG - 0.4) < 0.06) ?? top;
  const lltd = mid ? (100 * mid.frontDF * tf) / (mid.frontDF * tf + mid.rearDF * tr) : NaN;

  // Step steer at 70 km/h to the angle the circle says gives 0.4 g there.
  const kmh = 70;
  const speed = kmh / 3.6;
  const wheelbase = wheelbaseOf(rig);
  const angle =
    (wheelbase * 0.4 * GRAVITY) / (speed * speed) + ((Number.isFinite(understeer) ? understeer : 0) * 0.4 * Math.PI) / 180;
  const stepRig = await makeRig(id);
  const step = stepSteer(stepRig, kmh, angle);
  stepRig.vehicle.dispose();
  console.log(
    `  step steer ${kmh} km/h to ${rad(angle).toFixed(2)}°: lateral accel ${step.accel.steady.toFixed(2)} g ` +
      `(overshoot ${step.accel.overshootPct.toFixed(0)}%, ${step.accel.crossings} crossings, settle ` +
      `${step.accel.settleS.toFixed(2)} s); roll peak ${step.roll.peak.toFixed(2)}°, steady ` +
      `${step.roll.steady.toFixed(2)}° (overshoot ${step.roll.overshootPct.toFixed(0)}%, ${step.roll.crossings} ` +
      `crossings, settle ${step.roll.settleS.toFixed(2)} s); lightest inside wheel ${step.innerMin.toFixed(2)} of static`,
  );

  // Roll release at 60 km/h: leaned by the elastic roll moment half a g of cornering
  // puts on the springs — the centre of mass' height over that build's own roll axis —
  // then let go.
  const releaseRig = await makeRig(id);
  const release = rollRelease(releaseRig, 0.5 * mass * GRAVITY * (h - rollAxis));
  releaseRig.vehicle.dispose();
  console.log(
    `  roll release from ${release.heldDeg.toFixed(2)}° (road noise ±${release.noiseDeg.toFixed(2)}°): ` +
      `swings ${(100 * release.overshoot).toFixed(0)}% past upright (roll damping ratio ` +
      `${release.zeta.toFixed(2)}), ${release.crossings} crossings, settled in ${release.settleS.toFixed(2)} s`,
  );

  summary.push(
    `${id.padEnd(14)} ${rollGradient.toFixed(2).padStart(6)}  ${understeer.toFixed(2).padStart(6)}  ` +
      `${slipUndersteer.toFixed(2).padStart(6)}  ` +
      `${lltd.toFixed(0).padStart(5)}%  ${(top?.latG ?? 0).toFixed(2).padStart(5)}  ${limitGradient.toFixed(1).padStart(7)}  ` +
      `${top ? (top.slipFDeg - top.slipRDeg).toFixed(2).padStart(7) : '    n/a'}  ` +
      `${top ? Math.min(top.innerFront, top.innerRear).toFixed(2).padStart(6) : '   n/a'}  ` +
      `${step.roll.overshootPct.toFixed(0).padStart(5)}%  ${step.accel.overshootPct.toFixed(0).padStart(5)}%  ` +
      `${release.zeta.toFixed(2).padStart(5)}  ${String(release.crossings).padStart(4)}`,
  );
}

console.log('\n=== summary ===');
console.log(
  'model           roll°/g  US°/g  αUS°/g  F LLTD  top g  limit°/g  αf-αr°  inner  roll OS  a_y OS   ζroll  osc',
);
for (const line of summary) console.log(line);
