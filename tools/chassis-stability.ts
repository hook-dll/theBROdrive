/**
 * tools/chassis-stability.ts
 *
 * The chassis' own behaviour away from the tyre's limit: the things a change to the
 * body's damping, its pitch reaction or the driveline can break without moving a
 * skidpad or a 0-100 figure. Every run drives the real `Vehicle.fixedUpdate` on
 * Rapier through the `handling-bench.ts` rig, on flat asphalt, automatic box.
 *
 *   park       10 s standing on its springs after the rig's settle: the largest body
 *              angular rate in the last 5 s and the lean it rests at. A body that
 *              never comes to rest, or rests tilted, is the low-speed flop.
 *   crawl      a full-lock slalom at walking pace (lock to lock every 2 s, 16 s,
 *              throttle held under 8 km/h): the worst lean and roll rate. The case the
 *              old whole-body angular damping was there for.
 *   straight   rack held at centre (`SteerMode` 'direct', steer 0) at 100 km/h for
 *              10 s after the run-up: the heading the car wandered off by and its
 *              sideways drift from the line it started on.
 *   pitch      the body's pitch, nose up positive, averaged over 0.5-2.5 s of a
 *              standing full-throttle start (squat) and over the fully developed part
 *              of a 100-0 full-pedal stop (dive), each against the settled attitude,
 *              and the deepest dive seen in that stop.
 *   tip-in     held in second (manual) at 30 km/h on a light throttle, the pedal stepped
 *              to 0.8: the time to reach 90% of the acceleration it holds 1.5 s later,
 *              the peak over that, and how many times the acceleration crosses its
 *              held value. Then the pedal lifted to 0: the same for the lift-off shunt.
 *              A single lag never overshoots; a two-mass driveline rings, and this is
 *              how much.
 *
 * Any non-finite pose or velocity anywhere fails the run (exit 1).
 *
 *   bun tools/chassis-stability.ts [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { FIXED_DT } from '../src/core/physics';
import { preloadCarModels } from '../src/render/carmodel';
import { drive, makeRig, type Rig } from './handling-bench';

installAssetShim();
installDocumentShim();

const DEG = 180 / Math.PI;
const args = process.argv.slice(2);
const models = args.length > 0 ? args : ['kit_vaz2101', 'kit_vaz2108', 'kit_vaz2121', 'kit_gaz24'];

interface Pose {
  /** Nose up positive, degrees. */
  pitch: number;
  /** Right side up positive, degrees. */
  roll: number;
  /** Heading, degrees. */
  heading: number;
  /** Lean of the body's up axis from world up, degrees. */
  lean: number;
}

function pose(rig: Rig): Pose {
  const q = rig.vehicle.chassis.rotation();
  // Body +Z (forward) and +X (right) rotated into the world.
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fy = 2 * (q.y * q.z - q.w * q.x);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const ry = 2 * (q.x * q.y + q.w * q.z);
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  return {
    pitch: Math.asin(Math.max(-1, Math.min(1, fy))) * DEG,
    roll: Math.asin(Math.max(-1, Math.min(1, ry))) * DEG,
    heading: Math.atan2(fx, fz) * DEG,
    lean: Math.acos(Math.max(-1, Math.min(1, upY))) * DEG,
  };
}

let nonFinite = 0;
function finite(rig: Rig): boolean {
  const t = rig.vehicle.chassis.translation();
  const v = rig.vehicle.chassis.linvel();
  const w = rig.vehicle.chassis.angvel();
  const ok = [t.x, t.y, t.z, v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite);
  if (!ok) nonFinite++;
  return ok;
}

function fwdMps(rig: Rig): number {
  return rig.vehicle.audio.forwardMps;
}

function wrapDeg(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** A light proportional throttle onto `kmh`. */
function hold(rig: Rig, kmh: number, gain = 0.08, base = 0.2): number {
  return Math.max(0, Math.min(1, base + (kmh - rig.vehicle.speedKmh) * gain));
}

async function park(id: string) {
  const rig = await makeRig(id);
  const rest = pose(rig);
  let maxRate = 0;
  let t = 0;
  drive(rig, 10, () => {
    t += FIXED_DT;
    finite(rig);
    const w = rig.vehicle.chassis.angvel();
    if (t > 5) maxRate = Math.max(maxRate, Math.hypot(w.x, w.y, w.z) * DEG);
  });
  const end = pose(rig);
  return { maxRateDegS: maxRate, leanDeg: end.lean, drift: Math.abs(end.lean - rest.lean) };
}

async function crawl(id: string) {
  const rig = await makeRig(id);
  let maxLean = 0;
  let maxRollRate = 0;
  drive(rig, 16, (t, f) => {
    f.steerMode = 'direct';
    f.steer = Math.floor(t / 2) % 2 === 0 ? 1 : -1;
    f.throttle = rig.vehicle.speedKmh < 6 ? 0.35 : rig.vehicle.speedKmh > 8 ? 0 : 0.15;
    finite(rig);
    const p = pose(rig);
    if (t > 1) maxLean = Math.max(maxLean, p.lean);
    const w = rig.vehicle.chassis.angvel();
    // Roll rate: the angular velocity along the body's forward axis.
    const q = rig.vehicle.chassis.rotation();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    maxRollRate = Math.max(maxRollRate, Math.abs(w.x * fx + w.y * fy + w.z * fz) * DEG);
  });
  return { maxLeanDeg: maxLean, maxRollRateDegS: maxRollRate };
}

async function straight(id: string) {
  const rig = await makeRig(id);
  drive(rig, 40, (_t, f) => {
    f.steerMode = 'direct';
    f.steer = 0;
    f.throttle = rig.vehicle.speedKmh < 100 ? 1 : hold(rig, 100);
    finite(rig);
  });
  const start = pose(rig);
  const p0 = rig.vehicle.chassis.translation();
  const x0 = p0.x;
  const z0 = p0.z;
  const h0 = start.heading / DEG;
  let yawSq = 0;
  let n = 0;
  drive(rig, 10, (_t, f) => {
    f.steerMode = 'direct';
    f.steer = 0;
    f.throttle = hold(rig, 100);
    finite(rig);
    const w = rig.vehicle.chassis.angvel();
    yawSq += (w.y * DEG) ** 2;
    n++;
  });
  const end = pose(rig);
  const p1 = rig.vehicle.chassis.translation();
  // Sideways offset from the starting line.
  const dx = p1.x - x0;
  const dz = p1.z - z0;
  const lateral = dx * Math.cos(h0) - dz * Math.sin(h0);
  return {
    kmh: rig.vehicle.speedKmh,
    headingDeg: wrapDeg(end.heading - start.heading),
    driftM: lateral,
    yawRmsDegS: Math.sqrt(yawSq / Math.max(1, n)),
  };
}

async function pitch(id: string) {
  const rig = await makeRig(id);
  const rest = pose(rig).pitch;
  let squat = 0;
  let squatN = 0;
  let t = 0;
  drive(rig, 3, (_t, f) => {
    t += FIXED_DT;
    f.throttle = 1;
    finite(rig);
    if (t > 0.5 && t < 2.5) {
      squat += pose(rig).pitch - rest;
      squatN++;
    }
  });
  drive(rig, 40, (_t, f) => {
    f.throttle = rig.vehicle.speedKmh < 100 ? 1 : 0;
    finite(rig);
  });
  let dive = 0;
  let diveN = 0;
  let peakDive = 0;
  let prev = fwdMps(rig);
  drive(rig, 8, (_t, f) => {
    f.throttle = 0;
    f.brake = 1;
    finite(rig);
    const v = fwdMps(rig);
    const decelG = (prev - v) / FIXED_DT / 9.81;
    prev = v;
    const p = pose(rig).pitch - rest;
    if (v > 3) peakDive = Math.min(peakDive, p);
    if (decelG > 0.5 && v > 3) {
      dive += p;
      diveN++;
    }
  });
  return {
    squatDeg: squatN ? squat / squatN : NaN,
    diveDeg: diveN ? dive / diveN : NaN,
    peakDiveDeg: peakDive,
  };
}

interface Shunt {
  riseS: number;
  overshoot: number;
  crossings: number;
  heldG: number;
  pitchSwingDeg: number;
}

/** The acceleration's response to one pedal step, recorded over 1.5 s. */
function step(rig: Rig, throttle: number): Shunt {
  const accel: number[] = [];
  const pitches: number[] = [];
  let prev = fwdMps(rig);
  drive(rig, 1.5, (_t, f) => {
    f.steerMode = 'direct';
    f.steer = 0;
    f.throttle = throttle;
    finite(rig);
    const v = fwdMps(rig);
    accel.push((v - prev) / FIXED_DT);
    prev = v;
    pitches.push(pose(rig).pitch);
  });
  // Held value: the mean of the last 0.25 s. Smoothed over three steps against the
  // tyres' own 60 Hz texture.
  const tail = accel.slice(-15);
  const held = tail.reduce((a, b) => a + b, 0) / tail.length;
  const smooth = accel.map((_, i) => {
    const a = accel[Math.max(0, i - 1)]!;
    const b = accel[i]!;
    const c = accel[Math.min(accel.length - 1, i + 1)]!;
    return (a + b + c) / 3;
  });
  const start = smooth[0]!;
  const span = held - start;
  let rise = NaN;
  let peak = 0;
  let crossings = 0;
  let side = 0;
  for (let i = 0; i < smooth.length; i++) {
    const rel = span !== 0 ? (smooth[i]! - start) / span : 0;
    if (Number.isNaN(rise) && rel >= 0.9) rise = (i + 1) * FIXED_DT;
    if (!Number.isNaN(rise)) {
      peak = Math.max(peak, rel);
      const s = Math.sign(smooth[i]! - held);
      if (s !== 0 && side !== 0 && s !== side && Math.abs(smooth[i]! - held) > 0.02 * Math.abs(span)) crossings++;
      if (s !== 0) side = s;
    }
  }
  return {
    riseS: rise,
    overshoot: peak - 1,
    crossings,
    heldG: held / 9.81,
    pitchSwingDeg: Math.max(...pitches) - Math.min(...pitches),
  };
}

async function tipIn(id: string) {
  const rig = await makeRig(id);
  // Manual, held in second: an automatic changes up inside the 1.5 s window on some
  // cars and the shift reads as a shunt. A settings delta, never a field write (see
  // `manualSprint`).
  rig.world.apply({ t: 'settings', settings: { ...rig.world.state.settings, gearboxMode: 'manual' } });
  let shifted = 0;
  drive(rig, 20, (_t, f) => {
    f.steerMode = 'direct';
    f.steer = 0;
    f.shift = 0;
    const gear = rig.vehicle.gearLabel;
    if (gear === 'N' && shifted === 0) {
      f.shift = 1;
      shifted = 1;
    } else if (gear === '1' && shifted === 1 && rig.vehicle.speedKmh > 18) {
      f.shift = 1;
      shifted = 2;
    }
    f.throttle = rig.vehicle.speedKmh < 30 ? 0.6 : hold(rig, 30, 0.05, 0.12);
    finite(rig);
  });
  // Settle on a constant light pedal so the step starts from steady state.
  drive(rig, 2, (_t, f) => {
    f.shift = 0;
    f.throttle = 0.15;
    finite(rig);
  });
  const gear = rig.vehicle.gearLabel;
  const on = step(rig, 0.8);
  const off = step(rig, 0);
  return { gear, on, off };
}

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pad = (s: string, n: number) => s.padStart(n);

await preloadCarModels(models);
console.log(
  'model           park°/s  lean°  crawl lean°  roll°/s   100 km/h: head°  drift m  yaw rms°/s   squat°  dive°  pk dive°',
);
const tipRows: string[] = [];
for (const id of models) {
  const p = await park(id);
  const c = await crawl(id);
  const s = await straight(id);
  const pt = await pitch(id);
  const tip = await tipIn(id);
  console.log(
    `${id.padEnd(15)} ${pad(f(p.maxRateDegS, 3), 7)} ${pad(f(p.leanDeg), 6)}  ${pad(f(c.maxLeanDeg), 11)} ${pad(f(c.maxRollRateDegS, 1), 8)}` +
      `   ${pad(f(s.headingDeg, 3), 14)} ${pad(f(s.driftM, 3), 8)} ${pad(f(s.yawRmsDegS, 3), 11)}` +
      `   ${pad(f(pt.squatDeg), 6)} ${pad(f(pt.diveDeg), 6)} ${pad(f(pt.peakDiveDeg), 9)}`,
  );
  tipRows.push(
    `${id.padEnd(15)} ${pad(tip.gear, 4)}  ` +
      `${pad(f(tip.on.riseS, 3), 7)} ${pad(f(tip.on.overshoot * 100, 0) + '%', 6)} ${pad(String(tip.on.crossings), 5)} ${pad(f(tip.on.heldG, 3), 7)} ${pad(f(tip.on.pitchSwingDeg), 7)}   ` +
      `${pad(f(tip.off.riseS, 3), 7)} ${pad(f(tip.off.overshoot * 100, 0) + '%', 6)} ${pad(String(tip.off.crossings), 5)} ${pad(f(tip.off.heldG, 3), 7)} ${pad(f(tip.off.pitchSwingDeg), 7)}`,
  );
}
console.log('\ntip-in in second at 30 km/h (0.15 -> 0.8) and lift-off (0.8 -> 0)');
console.log('model           gear   rise s    over  cross  held g  pitch°    rise s    over  cross  held g  pitch°');
for (const row of tipRows) console.log(row);
if (nonFinite > 0) {
  console.log(`\nFAIL: ${nonFinite} non-finite steps`);
  process.exit(1);
}
console.log('\nall poses finite');
