/**
 * tools/driveline.ts
 *
 * The driveline between crank and tyre: engine braking through the driven wheels and
 * the automatic clutch (vehicle/drivetrain.ts). Each check drives the real
 * `Vehicle.fixedUpdate` on a flat plane and reads what a test driver would:
 *
 *   coast     deceleration in 2nd/3rd/4th from 80 km/h, minus the same coast in
 *             neutral: the engine's own share
 *   lift      a steady 0.6 g bend, wheel angle frozen, throttle shut for a second:
 *             curvature and yaw against steady (a RWD car tucks in)
 *   loose     a shut throttle at 50 km/h in 2nd on gravel and sand: driven-wheel slip
 *   stop      braking to a standstill from 60 km/h in gear, manual and automatic:
 *             the crank must never fall below idle
 *   launch    0-100 km/h from rest: manual (first engaged at idle, clock on the
 *             pedal) and automatic (from neutral)
 *   shifts    the automatic 0-100's upshifts: the peak acceleration after each one
 *             against the settled acceleration in the new gear (a spike reads > 1)
 *   down      a shut-throttle manual downshift 4-3 at 90 and 3-2 at 70, and the
 *             automatic braking down through its gears: driven-wheel slip and peak g
 *
 * Exits non-zero when an invariant breaks: rpm under idle while stopping in gear, an
 * upshift spike over SPIKE_LIMIT, a sane downshift locking a driven wheel, or engine
 * braking missing in gear or present in neutral.
 *
 *   ~/.bun/bin/bun tools/driveline.ts [modelId ...]
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { preloadCarModels } from '../src/render/carmodel';
import { FIXED_DT } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { addGround, makeRig, drive, driveUntil, type Rig } from './handling-bench';
import type { InputFrame } from '../src/core/input';
import { fullThrottleUpshiftDue } from '../src/vehicle/drivetrain';
import { CAR_MODELS } from '../src/vehicle/carmodels';

installAssetShim();
installDocumentShim();

const GRAVITY = 9.81;
/** Peak post-shift acceleration over the settled figure that counts as a spike. */
const SPIKE_LIMIT = 1.15;
/** Slip ratio at or below which a driven wheel counts as locked (vehicle.ts LOCK_SLIP_RATIO). */
const LOCKED_SLIP = -0.5;
/** Seconds after a lift before a coast is measured: the driveline's slack, taken up. */
const COAST_SETTLE_S = 0.3;

// `--launch`: only the in-game standing start — automatic, from neutral at idle, the
// throttle floored — for every catalogue car (or the ids given).
const launchSurvey = process.argv.includes('--launch');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const models =
  ids.length > 0 ? ids : launchSurvey ? CAR_MODELS.map((m) => m.id) : ['sv_vaz2106', 'gt_vaz2110'];
const failures: string[] = [];

interface WheelView {
  readonly isFront: boolean;
  readonly slipRatio: number;
  readonly slipAngleRad: number;
}
/** The vehicle's private wheel state, read by the bench only. */
interface Internals {
  wheels: WheelView[];
  steerAngle: number;
  frontDrivenCount: number;
  rearDrivenCount: number;
  drivenRadius: number;
}

function internals(rig: Rig): Internals {
  return rig.vehicle as unknown as Internals;
}

function setMode(rig: Rig, mode: 'manual' | 'automatic'): void {
  rig.world.apply({ t: 'settings', settings: { ...rig.world.state.settings, gearboxMode: mode } });
}

/** Horizontal speed along the body's heading, m/s. */
function forwardSpeed(rig: Rig): number {
  const lv = rig.vehicle.chassis.linvel();
  const q = rig.vehicle.chassis.rotation();
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return lv.x * fx + lv.z * fz;
}

/** Mean slip ratio of the driven wheels, and the lowest one. */
function drivenSlip(rig: Rig): { mean: number; min: number } {
  const v = internals(rig);
  let sum = 0;
  let n = 0;
  let min = Infinity;
  for (const w of v.wheels) {
    const driven = w.isFront ? v.frontDrivenCount > 0 : v.rearDrivenCount > 0;
    if (!driven) continue;
    sum += w.slipRatio;
    n++;
    min = Math.min(min, w.slipRatio);
  }
  return { mean: n > 0 ? sum / n : 0, min: n > 0 ? min : 0 };
}

const idle = (f: InputFrame): void => {
  f.throttle = 0;
  f.brake = 0;
  f.steer = 0;
  f.shift = 0;
  f.reverse = false;
  f.handbrake = false;
};

/** Into `gear` (a label) in manual, one change at a time, each allowed to finish. */
function selectGear(rig: Rig, gear: string, shiftTime: number): void {
  for (let guard = 0; guard < 8 && rig.vehicle.gearLabel !== gear; guard++) {
    const now = rig.vehicle.gearLabel === 'N' ? 0 : Number(rig.vehicle.gearLabel);
    const dir = Number(gear) > now ? 1 : -1;
    drive(rig, shiftTime + 0.1, (t, f) => {
      idle(f);
      f.shift = t === 0 ? dir : 0;
    });
  }
}

/**
 * Mean deceleration over one second of coasting from `kmh` in `gear` ('N' for
 * neutral), the crank speed it started at and the driven wheels' mean slip ratio. The
 * gear is selected a little above `kmh` and held there on the throttle until the
 * clutch has closed, so the coast is measured in the gear and not in its shunt; the
 * window opens `COAST_SETTLE_S` after the lift, once the driveline's slack is taken up.
 */
async function coast(
  id: string,
  gear: string,
  kmh: number,
): Promise<{ decel: number; rpm: number; slip: number }> {
  const rig = await makeRig(id);
  setMode(rig, 'manual');
  const box = rig.vehicle.stats.gearbox;
  const hold = (kmh + 3) / 3.6;
  rig.vehicle.launchRolling(hold);
  selectGear(rig, gear, box.shiftTime);
  drive(rig, 1.5, (_, f) => {
    idle(f);
    f.throttle = Math.max(0, Math.min(1, (hold - forwardSpeed(rig)) * 0.5 + 0.3));
  });
  driveUntil(rig, 20, (_, f) => idle(f), () => forwardSpeed(rig) <= kmh / 3.6);
  drive(rig, COAST_SETTLE_S, (_, f) => idle(f));
  const v0 = forwardSpeed(rig);
  const rpm = rig.vehicle.rpm;
  let slip = 0;
  drive(rig, 1, (_, f) => {
    idle(f);
    slip += drivenSlip(rig).mean * FIXED_DT;
  });
  const decel = v0 - forwardSpeed(rig);
  rig.vehicle.dispose();
  return { decel, rpm, slip };
}

interface BendState {
  kappa: number;
  yaw: number;
  slipR: number;
}

function bendState(rig: Rig): BendState {
  const lv = rig.vehicle.chassis.linvel();
  const speed = Math.hypot(lv.x, lv.z);
  const yaw = Math.abs(rig.vehicle.chassis.angvel().y);
  let slipR = 0;
  let n = 0;
  for (const w of internals(rig).wheels) {
    if (w.isFront) continue;
    slipR += Math.abs(w.slipAngleRad);
    n++;
  }
  return { kappa: speed > 1 ? yaw / speed : 0, yaw, slipR: ((slipR / Math.max(1, n)) * 180) / Math.PI };
}

interface LiftResult {
  gear: string;
  steady: BendState;
  peakKappa: number;
  peakYaw: number;
  peakSlipR: number;
  drivenSlip: number;
  kmh: number;
}

async function lift(id: string, g: number, radius: number): Promise<LiftResult> {
  const rig = await makeRig(id);
  const v = rig.vehicle;
  const ws = v.modelMeasure.wheels;
  const zOf = (front: boolean): number => {
    const zs = ws.filter((w) => w.isFront === front).map((w) => w.pos[2]);
    return zs.reduce((a, b) => a + b, 0) / zs.length;
  };
  const wheelbase = Math.abs(zOf(true) - zOf(false));
  const target = Math.sqrt(g * GRAVITY * radius);
  const kappaTarget = 1 / radius;
  let integral = 0;
  const control = (f: InputFrame): void => {
    const s = bendState(rig);
    const speed = Math.hypot(v.chassis.linvel().x, v.chassis.linvel().z);
    const error = kappaTarget - s.kappa;
    integral = Math.max(-0.5, Math.min(0.5, integral + error * 3 * FIXED_DT));
    f.steer = v.steeringInputForWheelAngle(Math.max(0, wheelbase * kappaTarget + 2 * error + integral));
    f.throttle = Math.max(0, Math.min(1, (target - speed) * 0.5 + 0.2));
    f.brake = speed > target + 1.5 ? 0.25 : 0;
  };
  drive(rig, 8, (_, f) => {
    f.steer = 0;
    f.throttle = Math.max(0, Math.min(1, (target - forwardSpeed(rig)) * 0.5 + 0.2));
  });
  drive(rig, 10, (_, f) => control(f));
  let angle = 0;
  const steadyList: BendState[] = [];
  drive(rig, 1, (_, f) => {
    control(f);
    steadyList.push(bendState(rig));
    angle += internals(rig).steerAngle;
  });
  angle /= steadyList.length;
  const steady: BendState = {
    kappa: steadyList.reduce((a, s) => a + s.kappa, 0) / steadyList.length,
    yaw: steadyList.reduce((a, s) => a + s.yaw, 0) / steadyList.length,
    slipR: steadyList.reduce((a, s) => a + s.slipR, 0) / steadyList.length,
  };
  const gear = v.gearLabel;
  let peakKappa = 0;
  let peakYaw = 0;
  let peakSlipR = 0;
  let slipSum = 0;
  let slipN = 0;
  drive(rig, 1, (t, f) => {
    f.steer = v.steeringInputForWheelAngle(Math.abs(angle));
    f.throttle = 0;
    f.brake = 0;
    const s = bendState(rig);
    peakKappa = Math.max(peakKappa, s.kappa);
    peakYaw = Math.max(peakYaw, s.yaw);
    peakSlipR = Math.max(peakSlipR, s.slipR);
    if (t >= 0.2) {
      slipSum += drivenSlip(rig).mean;
      slipN++;
    }
  });
  const kmh = Math.hypot(v.chassis.linvel().x, v.chassis.linvel().z) * 3.6;
  v.dispose();
  return { gear, steady, peakKappa, peakYaw, peakSlipR, drivenSlip: slipSum / Math.max(1, slipN), kmh };
}

async function loose(id: string, surface: SurfaceType): Promise<{ slip: number; min: number; decel: number }> {
  const rig = await makeRig(id, (p) => addGround(p, surface));
  setMode(rig, 'manual');
  rig.vehicle.launchRolling(56 / 3.6);
  selectGear(rig, '2', rig.vehicle.stats.gearbox.shiftTime);
  driveUntil(rig, 20, (_, f) => idle(f), () => forwardSpeed(rig) <= 50 / 3.6);
  const v0 = forwardSpeed(rig);
  let sum = 0;
  let n = 0;
  let min = 0;
  drive(rig, 1, (t, f) => {
    idle(f);
    if (t >= 0.2) {
      const s = drivenSlip(rig);
      sum += s.mean;
      min = Math.min(min, s.min);
      n++;
    }
  });
  const decel = v0 - forwardSpeed(rig);
  rig.vehicle.dispose();
  return { slip: sum / Math.max(1, n), min, decel };
}

async function stop(
  id: string,
  mode: 'manual' | 'automatic',
): Promise<{ minRpm: number; idleRpm: number; distance: number; gear: string }> {
  const rig = await makeRig(id);
  setMode(rig, mode);
  rig.vehicle.launchRolling(60 / 3.6);
  const start = rig.vehicle.chassis.translation();
  let minRpm = Infinity;
  driveUntil(
    rig,
    20,
    (_, f) => {
      idle(f);
      f.brake = 0.6;
    },
    () => {
      minRpm = Math.min(minRpm, rig.vehicle.rpm);
      return Math.abs(forwardSpeed(rig)) < 0.05;
    },
  );
  drive(rig, 1.5, (_, f) => {
    idle(f);
    f.brake = 0.6;
    minRpm = Math.min(minRpm, rig.vehicle.rpm);
  });
  const end = rig.vehicle.chassis.translation();
  const result = {
    minRpm,
    idleRpm: rig.vehicle.audio.idleRpm,
    distance: Math.hypot(end.x - start.x, end.z - start.z),
    gear: rig.vehicle.gearLabel,
  };
  rig.vehicle.dispose();
  return result;
}

interface ShiftSpike {
  from: string;
  to: string;
  peak: number;
  settled: number;
  gap: number;
}

async function launch(
  id: string,
  mode: 'manual' | 'automatic',
): Promise<{ to100: number | null; splits: string; spikes: ShiftSpike[] }> {
  const rig = await makeRig(id);
  setMode(rig, mode);
  const box = rig.vehicle.stats.gearbox;
  const engine = rig.vehicle.stats.engine;
  const radius = internals(rig).drivenRadius;
  if (mode === 'manual') {
    drive(rig, box.shiftTime + 0.3, (t, f) => {
      idle(f);
      f.shift = t === 0 ? 1 : 0;
      f.brake = 1;
    });
  }
  const accel: number[] = [];
  const gears: string[] = [];
  let prev = forwardSpeed(rig);
  let t = 0;
  let reached: number | null = null;
  const splitKmh = [10, 30, 60];
  const splitTimes: number[] = [];
  driveUntil(
    rig,
    60,
    (_, f) => {
      idle(f);
      f.throttle = 1;
      if (mode === 'manual') {
        const gear = Number(rig.vehicle.gearLabel);
        if (gear >= 1 && gear < box.ratios.length) {
          const ratio = box.ratios[gear - 1]!;
          const rpm = ((Math.abs(forwardSpeed(rig)) / radius) * ratio * box.finalDrive * 60) / (2 * Math.PI);
          if (fullThrottleUpshiftDue(engine, rpm, ratio, box.ratios[gear]!)) f.shift = 1;
        }
      }
    },
    () => {
      t += FIXED_DT;
      const now = forwardSpeed(rig);
      accel.push((now - prev) / FIXED_DT);
      prev = now;
      gears.push(rig.vehicle.gearLabel);
      if (splitTimes.length < splitKmh.length && now * 3.6 >= splitKmh[splitTimes.length]) splitTimes.push(t);
      if (reached === null && now * 3.6 >= 100) reached = t;
      return now * 3.6 >= 110;
    },
  );
  rig.vehicle.dispose();
  // Smoothed over 5 ticks: a one-step blip of the solver is not a driveline spike.
  const smooth = accel.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(accel.length - 1, i + 2); k++) {
      s += accel[k];
      n++;
    }
    return s / n;
  });
  const spikes: ShiftSpike[] = [];
  const window = Math.round(0.8 / FIXED_DT);
  for (let i = 1; i < gears.length; i++) {
    if (gears[i] === gears[i - 1] || gears[i - 1] === 'N') continue;
    // The change starts here; it ends shiftTime later and the clutch is then closing.
    const end = i + Math.round(box.shiftTime / FIXED_DT);
    if (end + 2 * window >= smooth.length) continue;
    let peak = -Infinity;
    for (let k = end; k < end + window; k++) peak = Math.max(peak, smooth[k]);
    let settled = 0;
    for (let k = end + window; k < end + 2 * window; k++) settled += smooth[k];
    settled /= window;
    let gap = Infinity;
    for (let k = i; k < end; k++) gap = Math.min(gap, smooth[k]);
    spikes.push({ from: gears[i - 1], to: gears[i], peak, settled, gap });
  }
  const splits = splitTimes.map((s, i) => `${splitKmh[i]}: ${s.toFixed(2)}`).join('  ');
  return { to100: reached, splits, spikes };
}

async function downshift(
  id: string,
  from: string,
  to: string,
  kmh: number,
): Promise<{ minSlip: number; peakG: number }> {
  const rig = await makeRig(id);
  setMode(rig, 'manual');
  const box = rig.vehicle.stats.gearbox;
  rig.vehicle.launchRolling((kmh + 6) / 3.6);
  selectGear(rig, from, box.shiftTime);
  driveUntil(rig, 20, (_, f) => idle(f), () => forwardSpeed(rig) <= kmh / 3.6);
  let minSlip = 0;
  let peakG = 0;
  let prev = forwardSpeed(rig);
  drive(rig, box.shiftTime + 1.2, (t, f) => {
    idle(f);
    f.shift = t === 0 ? Number(to) - Number(from) : 0;
    minSlip = Math.min(minSlip, drivenSlip(rig).min);
    const now = forwardSpeed(rig);
    peakG = Math.max(peakG, (prev - now) / FIXED_DT / GRAVITY);
    prev = now;
  });
  rig.vehicle.dispose();
  return { minSlip, peakG };
}

async function autoBrakeDown(id: string): Promise<{ minSlip: number; peakG: number; gears: string }> {
  const rig = await makeRig(id);
  setMode(rig, 'automatic');
  rig.vehicle.launchRolling(90 / 3.6);
  let minSlip = 0;
  let peakG = 0;
  let prev = forwardSpeed(rig);
  const seen: string[] = [rig.vehicle.gearLabel];
  driveUntil(
    rig,
    30,
    (_, f) => {
      idle(f);
      f.brake = 0.25;
    },
    () => {
      minSlip = Math.min(minSlip, drivenSlip(rig).min);
      const now = forwardSpeed(rig);
      peakG = Math.max(peakG, (prev - now) / FIXED_DT / GRAVITY);
      prev = now;
      if (seen[seen.length - 1] !== rig.vehicle.gearLabel) seen.push(rig.vehicle.gearLabel);
      return now < 1;
    },
  );
  rig.vehicle.dispose();
  return { minSlip, peakG, gears: seen.join('>') };
}

// ---------------------------------------------------------------------------

const f2 = (x: number): string => x.toFixed(2);
const pct = (x: number, base: number): string => `${x >= base ? '+' : ''}${(((x - base) / base) * 100).toFixed(1)}%`;

await preloadCarModels(models);
if (launchSurvey) {
  for (const id of models) {
    const l = await launch(id, 'automatic');
    console.log(`${id.padEnd(16)} 0-100 ${l.to100?.toFixed(2) ?? 'never'} s   (${l.splits})`);
  }
  process.exit(0);
}
for (const id of models) {
  console.log(`=== ${id} ===`);

  // 80 km/h in 2nd puts the classics on their cut; 2nd from 70 is the same gear below it.
  for (const [kmh, gears] of [
    [80, ['2', '3', '4']],
    [70, ['2']],
  ] as const) {
    const neutral = (await coast(id, 'N', kmh)).decel;
    const parts: string[] = [];
    for (const gear of gears) {
      const c = await coast(id, gear, kmh);
      const engine = c.decel - neutral;
      parts.push(`${gear}: ${f2(c.decel)} (engine ${f2(engine)}, ${c.rpm.toFixed(0)} rpm, slip ${c.slip.toFixed(3)})`);
      if (engine < 0.05) failures.push(`${id} coast ${gear}: no engine braking (${f2(engine)} m/s²)`);
    }
    console.log(`coast ${kmh} km/h, m/s² over 1 s   N: ${f2(neutral)} | ${parts.join(' | ')}`);
  }

  const bend = await lift(id, 0.6, 50);
  console.log(
    `lift 0.6 g R50 in ${bend.gear}: curvature ${pct(bend.peakKappa, bend.steady.kappa)}  yaw ${pct(bend.peakYaw, bend.steady.yaw)}` +
      `  rear slip ${f2(bend.steady.slipR)} -> ${f2(bend.peakSlipR)} deg  driven slip ratio ${bend.drivenSlip.toFixed(3)}  end ${bend.kmh.toFixed(1)} km/h`,
  );

  for (const [name, surface] of [
    ['asphalt', SurfaceType.Asphalt],
    ['gravel', SurfaceType.Gravel],
    ['sand', SurfaceType.Sand],
  ] as const) {
    const l = await loose(id, surface);
    console.log(
      `closed throttle 50 km/h in 2 on ${name.padEnd(7)}: driven slip ratio mean ${l.slip.toFixed(3)} min ${l.min.toFixed(3)}  decel ${f2(l.decel)} m/s²`,
    );
  }

  for (const mode of ['manual', 'automatic'] as const) {
    const s = await stop(id, mode);
    console.log(
      `stop from 60 in gear (${mode}): min rpm ${s.minRpm.toFixed(0)} (idle ${s.idleRpm})  distance ${s.distance.toFixed(1)} m  ends in ${s.gear}`,
    );
    if (s.minRpm < s.idleRpm - 1) failures.push(`${id} stop (${mode}): rpm fell to ${s.minRpm.toFixed(0)}`);
  }

  for (const mode of ['manual', 'automatic'] as const) {
    const l = await launch(id, mode);
    console.log(`0-100 ${mode}: ${l.to100?.toFixed(2) ?? 'never'} s   (${l.splits})`);
    for (const s of l.spikes) {
      const ratio = s.settled > 0.1 ? s.peak / s.settled : 0;
      console.log(
        `  ${s.from}>${s.to}: gap min ${f2(s.gap)}  post-shift peak ${f2(s.peak)}  settled ${f2(s.settled)} m/s²  (${ratio.toFixed(2)})`,
      );
      if (mode === 'automatic' && ratio > SPIKE_LIMIT) {
        failures.push(`${id} ${s.from}>${s.to}: post-shift spike ${ratio.toFixed(2)}`);
      }
    }
  }

  for (const [from, to, kmh] of [
    ['4', '3', 90],
    ['3', '2', 70],
    ['2', '1', 50],
  ] as const) {
    const d = await downshift(id, from, to, kmh);
    console.log(`manual ${from}>${to} at ${kmh}, shut throttle: driven slip min ${d.minSlip.toFixed(3)}  peak ${d.peakG.toFixed(2)} g`);
    if (to !== '1' && d.minSlip <= LOCKED_SLIP) failures.push(`${id} ${from}>${to} at ${kmh}: driven wheel locked`);
  }
  const ab = await autoBrakeDown(id);
  console.log(`automatic braking 0.25 from 90: ${ab.gears}  driven slip min ${ab.minSlip.toFixed(3)}  peak ${ab.peakG.toFixed(2)} g`);
  if (ab.minSlip <= LOCKED_SLIP) failures.push(`${id} automatic downshifts: driven wheel locked`);
}

if (failures.length > 0) {
  console.log(`\nFAIL ${failures.length}:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall driveline invariants hold');
