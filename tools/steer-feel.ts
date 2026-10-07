/**
 * tools/steer-feel.ts
 *
 * What the player's steering does to the car, through the real `Vehicle`.
 *
 *   bun tools/steer-feel.ts [modelId ...]
 *
 * 1. KEY HOLD at 60/100/130 km/h: the keyboard's steering key held down (through the
 *    input layer's own ramp), speed held by a throttle governor. Reports the lateral g
 *    the car reaches, the rack angle as a share of lock, and the FRONT tyres' built slip
 *    angle against their own peak. The steering assist exists to put a held key at the
 *    front axle's peak: well under it is grip the player cannot reach, well past it is
 *    a plough.
 * 2. STEP: the time from the key going down to 63% and 90% of the yaw rate the hold
 *    settles at, 60 and 100 km/h.
 * 3. RELEASE: from that hold at 60 km/h the key comes up. Time for the rack to come back
 *    to a tenth of its held angle, and for the yaw rate to fall to a tenth: with the
 *    hands off, the tyres' aligning moment is what returns the wheel.
 * 4. YAW KICK: straight at 70 km/h, the body is given 1.2 rad/s of yaw (a clipped kerb,
 *    a shove) and either nobody touches the keys (`hands off`) or a keyboard driver
 *    steers back to the original heading with the keys alone (`keys`). Peak heading
 *    error, peak rear slip, and the time until the heading is back within 3° and the
 *    yaw rate under 3°/s, or `spun`.
 * 5. PAD at 100 km/h: the stick held full over, with the steering assist and without.
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { preloadCarModels } from '../src/render/carmodel';
import { FIXED_DT } from '../src/core/physics';
import { makeRig, drive, type Rig } from './handling-bench';
import { keySteerStep, type SteerMode } from '../src/core/input';

installAssetShim();
installDocumentShim();

const DEG = 180 / Math.PI;
const GRAVITY = 9.81;
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const models = ids.length > 0 ? ids : ['sv_vaz2106', 'gt_vaz2110'];

interface WheelView {
  readonly isFront: boolean;
  readonly grounded: boolean;
  readonly loadN: number;
  readonly slipAngleRad: number;
  readonly sidePeakTan: number;
}
interface Internals {
  readonly wheels: readonly WheelView[];
  readonly steerAngle: number;
}

function internals(rig: Rig): Internals {
  return rig.vehicle as unknown as Internals;
}

function speedOf(rig: Rig): number {
  const v = rig.vehicle.chassis.linvel();
  return Math.hypot(v.x, v.z);
}

function headingOf(rig: Rig): number {
  const q = rig.vehicle.chassis.rotation();
  // Body +Z taken into world space, then its compass angle.
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(fx, fz);
}

function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Load-weighted front built slip angle and the front tyres' own peak, radians. */
function frontSlip(rig: Rig): { slip: number; peak: number } {
  let slip = 0;
  let peak = 0;
  let load = 0;
  for (const w of internals(rig).wheels) {
    if (!w.isFront || !w.grounded) continue;
    slip += Math.abs(w.slipAngleRad) * w.loadN;
    peak += Math.atan(w.sidePeakTan) * w.loadN;
    load += w.loadN;
  }
  return load > 0 ? { slip: slip / load, peak: peak / load } : { slip: 0, peak: 0 };
}

function rearSlip(rig: Rig): number {
  let worst = 0;
  for (const w of internals(rig).wheels) {
    if (!w.isFront && w.grounded) worst = Math.max(worst, Math.abs(w.slipAngleRad));
  }
  return worst;
}

async function rolling(modelId: string, kmh: number): Promise<Rig> {
  const rig = await makeRig(modelId);
  drive(rig, 1, (_, f) => {
    f.throttle = 0;
    f.brake = 0;
    f.steer = 0;
  });
  rig.vehicle.launchRolling(kmh / 3.6);
  return rig;
}

function governor(rig: Rig, kmh: number): number {
  return Math.max(0, Math.min(1, (kmh / 3.6 - speedOf(rig)) * 0.5 + 0.35));
}

interface Hold {
  latG: number;
  speedKmh: number;
  lockShare: number;
  slipDeg: number;
  peakDeg: number;
  rearDeg: number;
  yawSteady: number;
  t63: number;
  t90: number;
}

/**
 * Holds one steering input (the keyboard key through its ramp, or the stick as a
 * position) for `holdS`, sampling yaw for the step response and averaging the last
 * second for the steady figures. Leaves the rig at the end of the hold.
 */
function hold(rig: Rig, kmh: number, mode: SteerMode, holdS: number): Hold {
  const lock = rig.vehicle.modelDef.steerLock;
  const yaws: number[] = [];
  let lat = 0;
  let spd = 0;
  let share = 0;
  let slip = 0;
  let peak = 0;
  let rear = 0;
  let n = 0;
  drive(rig, holdS, (t, f) => {
    f.steerMode = mode;
    f.steer = mode === 'keys' ? keySteerStep(f.steer, 1, FIXED_DT) : 1;
    f.throttle = governor(rig, kmh);
    f.brake = 0;
    const yaw = Math.abs(rig.vehicle.chassis.angvel().y);
    yaws.push(yaw);
    if (t >= holdS - 1) {
      const s = speedOf(rig);
      lat += (s * yaw) / GRAVITY;
      spd += s * 3.6;
      share += Math.abs(internals(rig).steerAngle) / lock;
      const fs = frontSlip(rig);
      slip += fs.slip;
      peak += fs.peak;
      rear += rearSlip(rig);
      n++;
    }
  });
  const steady = yaws.slice(-Math.round(1 / FIXED_DT)).reduce((a, b) => a + b, 0) / Math.round(1 / FIXED_DT);
  const t63 = yaws.findIndex((y) => y >= 0.63 * steady) * FIXED_DT;
  const t90 = yaws.findIndex((y) => y >= 0.9 * steady) * FIXED_DT;
  return {
    latG: lat / n,
    speedKmh: spd / n,
    lockShare: share / n,
    slipDeg: (slip / n) * DEG,
    peakDeg: (peak / n) * DEG,
    rearDeg: (rear / n) * DEG,
    yawSteady: steady,
    t63,
    t90,
  };
}

function release(rig: Rig, kmh: number, mode: SteerMode): { rackS: number; yawS: number } {
  const held = Math.abs(internals(rig).steerAngle);
  const heldYaw = Math.abs(rig.vehicle.chassis.angvel().y);
  let rackS = -1;
  let yawS = -1;
  drive(rig, 4, (t, f) => {
    f.steerMode = mode;
    f.steer = mode === 'keys' ? keySteerStep(f.steer, 0, FIXED_DT) : 0;
    f.throttle = governor(rig, kmh);
    if (rackS < 0 && Math.abs(internals(rig).steerAngle) < 0.1 * held) rackS = t;
    if (yawS < 0 && Math.abs(rig.vehicle.chassis.angvel().y) < 0.1 * heldYaw) yawS = t;
  });
  return { rackS, yawS };
}

interface Kick {
  peakErrDeg: number;
  peakRearDeg: number;
  recoverS: number;
}

/** Straight at 70 km/h, a yaw kick, then hands off or a keyboard driver. */
async function kick(modelId: string, driver: boolean): Promise<Kick> {
  const kmh = 70;
  const rig = await rolling(modelId, kmh);
  drive(rig, 0.5, (_, f) => {
    f.steerMode = 'keys';
    f.steer = 0;
    f.throttle = governor(rig, kmh);
  });
  const h0 = headingOf(rig);
  const w = rig.vehicle.chassis.angvel();
  rig.vehicle.chassis.setAngvel({ x: w.x, y: 1.2, z: w.z }, true);
  let peakErr = 0;
  let peakRear = 0;
  let recover = -1;
  let spun = false;
  drive(rig, 6, (t, f) => {
    const err = wrap(headingOf(rig) - h0);
    const r = rig.vehicle.chassis.angvel().y;
    peakErr = Math.max(peakErr, Math.abs(err));
    peakRear = Math.max(peakRear, rearSlip(rig));
    if (Math.abs(err) > Math.PI / 2) spun = true;
    if (recover < 0 && t > 0.3 && Math.abs(err) < 3 / DEG && Math.abs(r) < 3 / DEG) recover = t;
    f.steerMode = 'keys';
    // A keyboard driver: steer against the heading error plus a share of the yaw rate,
    // inside a dead band, with the key ramp the input layer gives every key. Positive
    // heading is a left turn, and a positive key is right.
    let want = 0;
    if (driver) {
      const demand = err + 0.35 * r;
      want = demand > 2 / DEG ? 1 : demand < -2 / DEG ? -1 : 0;
    }
    f.steer = keySteerStep(f.steer, want, FIXED_DT);
    f.throttle = 0;
    f.brake = 0;
  });
  rig.vehicle.dispose();
  return { peakErrDeg: peakErr * DEG, peakRearDeg: peakRear * DEG, recoverS: spun ? Infinity : recover };
}

await preloadCarModels(models);

const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : 'spun');
for (const id of models) {
  console.log(`\n== ${id}`);
  console.log('  key hold   km/h   lat g   lock%   front slip/peak deg   rear deg   t63 s   t90 s');
  for (const kmh of [60, 100, 130]) {
    const rig = await rolling(id, kmh);
    const h = hold(rig, kmh, 'keys', 3);
    console.log(
      `  ${String(kmh).padStart(8)} ${h.speedKmh.toFixed(0).padStart(6)} ${h.latG.toFixed(3).padStart(7)} ` +
        `${(h.lockShare * 100).toFixed(0).padStart(6)}%   ${h.slipDeg.toFixed(1).padStart(8)} / ${h.peakDeg.toFixed(1).padEnd(8)}` +
        `${h.rearDeg.toFixed(1).padStart(10)} ${h.t63.toFixed(2).padStart(7)} ${h.t90.toFixed(2).padStart(7)}`,
    );
    if (kmh === 60) {
      const r = release(rig, kmh, 'keys');
      console.log(`  release from 60: rack to 10% in ${fmt(r.rackS)} s, yaw to 10% in ${fmt(r.yawS)} s`);
    }
    rig.vehicle.dispose();
  }
  for (const driver of [false, true]) {
    const k = await kick(id, driver);
    console.log(
      `  yaw kick, ${driver ? 'keys    ' : 'hands off'}: peak heading ${k.peakErrDeg.toFixed(1)} deg, ` +
        `peak rear slip ${k.peakRearDeg.toFixed(1)} deg, recovered ${fmt(k.recoverS)} s`,
    );
  }
  for (const mode of ['analog', 'analogAssist'] as const) {
    const rig = await rolling(id, 100);
    const h = hold(rig, 100, mode, 3);
    console.log(
      `  pad ${mode.padEnd(12)} 100 km/h: lat ${h.latG.toFixed(3)} g, lock ${(h.lockShare * 100).toFixed(0)}%, ` +
        `front slip ${h.slipDeg.toFixed(1)}/${h.peakDeg.toFixed(1)} deg, rear ${h.rearDeg.toFixed(1)} deg, speed ${h.speedKmh.toFixed(0)}`,
    );
    rig.vehicle.dispose();
  }
}
