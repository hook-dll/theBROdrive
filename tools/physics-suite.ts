/**
 * tools/physics-suite.ts
 *
 * The yardstick for the car physics: one fixed set of instrumented tests per car, the
 * results written as JSON so a later build can be measured against an earlier one and
 * both against the published figures in `docs/physics-references.md`.
 *
 * Every test drives the real `Vehicle.fixedUpdate` on Rapier through the
 * `handling-bench.ts` rig, on flat asphalt, at kerb mass plus the test load
 * (`--load`, default 150 kg: driver and passenger, the condition VAZ's manuals state).
 * Nothing is random, so a run is exactly repeatable; "flaky" here means a result that
 * is sensitive to the driver model rather than one that changes between runs.
 *
 *   sprint     0-60/80/100 km/h, manual box, revs raised on the brake, power-optimal
 *              changes (`manualSprint`, the same procedure `reality.ts` uses)
 *   top        flat-out plateau on a 20 km plate, automatic (`measureTopSpeed`)
 *   brake      100-0 and 80-0 km/h with the pedal floored from the first step, no
 *              reaction time; distance scaled to the nominal entry speed by v², plus
 *              the ECE R13-H mean fully developed deceleration (0.8 v0 to 0.1 v0), the
 *              first axle to lock, and the yaw and drift the stop picked up
 *   skidpad    constant 40 m radius, both directions. A path-following driver holds
 *              the circle while the target lateral acceleration ramps 0.025 g/s from
 *              0.15 g; the limit is the best 1 s mean lateral g while the car is still
 *              within 1.5 m of the circle and under 12° body slip. The understeer
 *              gradient is the slope of (δ − L/R) against lateral g between 0.1 and
 *              0.4 g, δ being the rack's bicycle-model road-wheel angle (SAE J266 /
 *              ISO 4138 constant-radius method)
 *   dlc        ISO 3888-1 double lane change (track per ISO 3888-1:2018 Table 1; the
 *              3.5 m offset taken between the right-hand cone lines, lane 5/6 sharing
 *              lane 1's right-hand line). Speed held on the throttle through the course,
 *              a pure-pursuit driver with yaw-rate damping on a line through the lanes'
 *              slack; from 40 km/h in 2.5 km/h steps, a speed passes if any of
 *              `DLC_LINES` gets every corner of the body through the gated lanes, and the
 *              result is the top of the unbroken run of passes. DRIVER-LIMITED: compare
 *              builds with it, not real cars
 *   coast      50 km/h to rest in neutral, distance and time (stop = 0.5 km/h)
 *   turn       full right lock at 9-11 km/h: the diameter of the circle the outer
 *              front contact patch draws (least-squares fit), which is how a factory
 *              "turning circle by the outer wheel" is defined, and the turn-centre
 *              radius `bench` reports (forward speed / yaw rate)
 *
 *   bun tools/physics-suite.ts run [--label baseline] [--cars a,b] [--tests sprint,top,...] [--load 150]
 *       -> build/physics-suite/<label>.json and .md
 *   bun tools/physics-suite.ts compare <before.json> [after.json] [--refs docs/physics-references.md] [--out file.md]
 *       -> car × test: reference, before, after, error %
 *
 * Heavy: run under `nice -n 15`, one at a time. Nothing here is part of the game bundle.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { FIXED_DT } from '../src/core/physics';
import { CAR_MODELS, carModel } from '../src/vehicle/carmodels';
import { preloadCarModels } from '../src/render/carmodel';
import {
  addLongGround,
  drive,
  driveUntil,
  makeRig,
  manualSprint,
  measureTopSpeed,
  type Rig,
} from './handling-bench';

installAssetShim();
installDocumentShim();

const G = 9.81;
const DEG = 180 / Math.PI;
const OUT_DIR = 'build/physics-suite';
const DEFAULT_REFS = 'docs/physics-references.md';

const TESTS = ['sprint', 'top', 'brake', 'skidpad', 'dlc', 'coast', 'turn'] as const;
type TestName = (typeof TESTS)[number];

// ---- result shapes ---------------------------------------------------------------

interface SprintResult {
  t60: number | null;
  t80: number | null;
  t100: number | null;
}
interface TopResult {
  kmh: number;
  spikeKmh: number;
  reachedPlateau: boolean;
}
interface BrakeResult {
  fromKmh: number;
  enteredKmh: number;
  /** Distance scaled to `fromKmh` by (from / entered)². */
  distM: number;
  /** ECE R13-H mean fully developed deceleration, g. */
  mfddG: number;
  /** First axle past 0.9 lock: 'front', 'rear', or 'none'. */
  firstLock: 'front' | 'rear' | 'none';
  yawDeg: number;
  driftM: number;
}
interface SkidpadRun {
  /** +1 a left-hand (anticlockwise) circle, -1 right-hand. */
  dir: 1 | -1;
  maxLatG: number;
  speedAtMaxKmh: number;
  understeerDegPerG: number | null;
  /** Coefficient of determination of that fit. */
  fitR2: number | null;
  fitPoints: number;
  /** What ended the run: 'radius' (washed out), 'slip' (let go), 'lock', 'time'. */
  limit: 'radius' | 'slip' | 'lock' | 'time';
}
interface SkidpadResult {
  radiusM: number;
  maxLatG: number;
  understeerDegPerG: number | null;
  runs: SkidpadRun[];
}
interface DlcRun {
  kmh: number;
  pass: boolean;
  reason: string;
}
interface DlcResult {
  maxEntryKmh: number | null;
  widthM: number;
  runs: DlcRun[];
  /** A pass above the first failed speed: the line search, not the car, decided it. */
  nonMonotonic: boolean;
  /** The search stopped where the run-up could no longer hold the entry speed. */
  speedLimited: boolean;
}
interface CoastResult {
  distM: number;
  timeS: number;
  reachedRest: boolean;
}
interface TurnResult {
  diameterM: number;
  centreRadiusM: number;
}
interface CarResult {
  id: string;
  label: string;
  drive: 'RWD' | 'FWD' | '4WD';
  kerbKg: number;
  testKg: number;
  wheelbaseM: number;
  sprint?: SprintResult;
  top?: TopResult;
  brake100?: BrakeResult | null;
  brake80?: BrakeResult | null;
  skidpad?: SkidpadResult;
  dlc?: DlcResult;
  coast?: CoastResult | null;
  turn?: TurnResult;
  /** Driver-model warnings: results that depend on the test driver, not the car. */
  flags: string[];
  wallS: number;
}
interface SuiteFile {
  label: string;
  createdAt: string;
  conditions: { loadKg: number; surface: 'asphalt'; dt: number; tests: TestName[] };
  wallS: number;
  cars: Record<string, CarResult>;
}

// ---- rig helpers -----------------------------------------------------------------

function release(rig: Rig): void {
  rig.vehicle.dispose();
  rig.physics.world.free();
}

async function loadedRig(id: string, loadKg: number, longGround = false): Promise<Rig> {
  const rig = longGround ? await makeRig(id, addLongGround) : await makeRig(id);
  if (loadKg > 0) rig.vehicle.setCarriedMass(loadKg);
  return rig;
}

function horizKmh(rig: Rig): number {
  const v = rig.vehicle.chassis.linvel();
  return Math.hypot(v.x, v.z) * 3.6;
}

/**
 * The car's plan pose. Forward is `(sin ψ, cos ψ)` in (x, z) and, with +Y up, left is
 * `(cos ψ, −sin ψ)`; a positive yaw rate (`angvel.y`) is a left turn, and a positive
 * `InputFrame.steer` is a right one (vehicle.ts `updateSteering`).
 */
interface Pose {
  x: number;
  z: number;
  psi: number;
  fx: number;
  fz: number;
  lx: number;
  lz: number;
}
function pose(rig: Rig): Pose {
  const p = rig.vehicle.chassis.translation();
  const psi = rig.vehicle.heading;
  const fx = Math.sin(psi);
  const fz = Math.cos(psi);
  return { x: p.x, z: p.z, psi, fx, fz, lx: fz, lz: -fx };
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Axle geometry off the loaded model: wheelbase and the rear axle's chassis-local z. */
function axles(rig: Rig): { wheelbase: number; rearZ: number; frontZ: number } {
  const wheels = rig.vehicle.modelMeasure.wheels;
  const mean = (front: boolean): number => {
    const set = wheels.filter((w) => w.isFront === front);
    return set.reduce((s, w) => s + w.pos[2], 0) / set.length;
  };
  const frontZ = mean(true);
  const rearZ = mean(false);
  return { wheelbase: Math.abs(frontZ - rearZ), rearZ, frontZ };
}

/** A throttle-only speed holder: PI on the speed error, no brake. */
class SpeedHold {
  private integral = 0.4;
  constructor(
    private readonly kp = 0.25,
    private readonly ki = 0.4,
  ) {}
  throttle(targetKmh: number, kmh: number): number {
    const err = (targetKmh - kmh) / 3.6;
    this.integral = Math.max(0, Math.min(1, this.integral + this.ki * err * FIXED_DT));
    return Math.max(0, Math.min(1, this.integral + this.kp * err));
  }
}

/** Straight run-up to `kmh` and a settled hold on it; false if the car never gets there. */
function runUp(rig: Rig, kmh: number, limitS = 60): boolean {
  const reached = driveUntil(
    rig,
    limitS,
    (_, f) => {
      f.throttle = 1;
      f.brake = 0;
      f.steer = 0;
    },
    () => horizKmh(rig) >= kmh - 0.5,
  );
  if (!reached) return false;
  const hold = new SpeedHold();
  let steady = 0;
  return driveUntil(
    rig,
    10,
    (_, f) => {
      f.throttle = hold.throttle(kmh, horizKmh(rig));
      f.brake = 0;
      f.steer = 0;
    },
    () => {
      steady = Math.abs(horizKmh(rig) - kmh) < 0.7 ? steady + FIXED_DT : 0;
      return steady >= 1;
    },
  );
}

/** Algebraic (Kåsa) least-squares circle through plan points. */
function fitCircle(xs: number[], zs: number[]): { cx: number; cz: number; r: number } {
  // Minimise Σ(x² + z² + a x + b z + c)²: a 3×3 normal system.
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, n = 0;
  let sxw = 0, szw = 0, sw = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const z = zs[i]!;
    const w = x * x + z * z;
    sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; n++;
    sxw += x * w; szw += z * w; sw += w;
  }
  const m = [
    [sxx, sxz, sx],
    [sxz, szz, sz],
    [sx, sz, n],
  ];
  const rhs = [-sxw, -szw, -sw];
  const det = (a: number[][]): number =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  const col = (k: number): number[][] => m.map((row, i) => row.map((v, j) => (j === k ? rhs[i]! : v)));
  const a = det(col(0)) / d;
  const b = det(col(1)) / d;
  const c = det(col(2)) / d;
  const cx = -a / 2;
  const cz = -b / 2;
  return { cx, cz, r: Math.sqrt(Math.max(0, cx * cx + cz * cz - c)) };
}

function linearFit(xs: number[], ys: number[]): { slope: number; r2: number } | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0) return null;
  return { slope: sxy / sxx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 };
}

const round = (v: number, digits: number): number => +v.toFixed(digits);

// ---- the tests -------------------------------------------------------------------

async function testSprint(id: string, loadKg: number): Promise<SprintResult> {
  const rig = await loadedRig(id, loadKg);
  const [t60, t80, t100] = manualSprint(rig, id, [60, 80, 100]);
  release(rig);
  const r = (t: number | null | undefined): number | null => (t == null ? null : round(t, 2));
  return { t60: r(t60), t80: r(t80), t100: r(t100) };
}

async function testTop(id: string, loadKg: number): Promise<TopResult> {
  const rig = await loadedRig(id, loadKg, true);
  const top = measureTopSpeed(rig, 9000);
  release(rig);
  return { kmh: round(top.plateauKmh, 1), spikeKmh: round(top.spikeKmh, 1), reachedPlateau: top.reachedPlateau };
}

async function testBrake(id: string, loadKg: number, fromKmh: number): Promise<BrakeResult | null> {
  const rig = await loadedRig(id, loadKg);
  const reached = driveUntil(
    rig,
    60,
    (_, f) => {
      f.throttle = 1;
      f.brake = 0;
      f.steer = 0;
    },
    () => horizKmh(rig) >= fromKmh,
  );
  if (!reached) {
    release(rig);
    return null;
  }
  const start = pose(rig);
  const entered = horizKmh(rig);
  let at80: number | null = null;
  let at10: number | null = null;
  let v80 = 0;
  let v10 = 0;
  let firstLock: BrakeResult['firstLock'] = 'none';
  let travelled = 0;
  let last = { x: start.x, z: start.z };
  driveUntil(
    rig,
    25,
    (_, f) => {
      f.throttle = 0;
      f.brake = 1;
      f.steer = 0;
    },
    () => {
      const p = rig.vehicle.chassis.translation();
      travelled += Math.hypot(p.x - last.x, p.z - last.z);
      last = { x: p.x, z: p.z };
      const kmh = horizKmh(rig);
      if (at80 === null && kmh <= 0.8 * entered) {
        at80 = travelled;
        v80 = kmh;
      }
      if (at10 === null && kmh <= 0.1 * entered) {
        at10 = travelled;
        v10 = kmh;
      }
      if (firstLock === 'none') {
        const a = rig.vehicle.audio;
        if (a.frontLockT > 0.9) firstLock = 'front';
        else if (a.rearLockT > 0.9) firstLock = 'rear';
      }
      return kmh < 0.5;
    },
  );
  const end = pose(rig);
  release(rig);
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const along = dx * start.fx + dz * start.fz;
  const drift = dx * start.lx + dz * start.lz;
  const mfdd =
    at80 !== null && at10 !== null && at10 > at80 ? (v80 * v80 - v10 * v10) / (25.92 * (at10 - at80)) / G : 0;
  return {
    fromKmh,
    enteredKmh: round(entered, 2),
    distM: round(along * (fromKmh / entered) ** 2, 2),
    mfddG: round(mfdd, 3),
    firstLock,
    yawDeg: round(Math.abs(wrapAngle(end.psi - start.psi)) * DEG, 1),
    driftM: round(drift, 2),
  };
}

const SKIDPAD_RADIUS_M = 40;
const SKID_START_G = 0.15;
const SKID_RAMP_G_PER_S = 0.025;
const SKID_HOLD_M = 1.5;
const SKID_SLIP_DEG = 12;

async function skidpadRun(id: string, loadKg: number, dir: 1 | -1): Promise<SkidpadRun> {
  const rig = await loadedRig(id, loadKg);
  const lock = rig.vehicle.modelDef.steerLock;
  const { wheelbase, rearZ } = axles(rig);
  const R = SKIDPAD_RADIUS_M;
  const out: SkidpadRun = {
    dir,
    maxLatG: 0,
    speedAtMaxKmh: 0,
    understeerDegPerG: null,
    fitR2: null,
    fitPoints: 0,
    limit: 'time',
  };
  if (!runUp(rig, Math.sqrt(SKID_START_G * G * R) * 3.6)) {
    release(rig);
    return out;
  }
  // The circle: centre R to the turn side of where the car stands now.
  const p0 = pose(rig);
  const cx = p0.x + dir * p0.lx * R;
  const cz = p0.z + dir * p0.lz * R;

  const hold = new SpeedHold();
  let integral = 0;
  let prevV = rig.vehicle.chassis.linvel();
  let prev = { x: prevV.x, z: prevV.z };
  // Half-second windows of the steady-state quantities.
  const win = { n: 0, ay: 0, delta: 0, v: 0, r: 0, worstErr: 0, worstSlip: 0 };
  const windows: { ay: number; delta: number; v: number; radius: number; holding: boolean }[] = [];
  const windowSteps = Math.round(0.5 / FIXED_DT);
  let wideS = 0;
  let slipS = 0;
  let lockS = 0;
  let t = 0;

  driveUntil(
    rig,
    60,
    (_, f) => {
      const ps = pose(rig);
      const kmh = horizKmh(rig);
      const targetG = SKID_START_G + SKID_RAMP_G_PER_S * t;
      f.throttle = hold.throttle(Math.sqrt(targetG * G * R) * 3.6, kmh);
      f.brake = 0;
      // Pure pursuit from the rear axle to a point on the circle Ld ahead, plus an
      // integral on the radius error so a steady under- or oversteer is held on the line.
      const rx = ps.x + ps.fx * rearZ;
      const rz = ps.z + ps.fz * rearZ;
      const theta = Math.atan2(rz - cz, rx - cx);
      const ld = Math.max(6, (0.5 * kmh) / 3.6);
      // Anticlockwise in plan (x, z) is a right turn here: left is (cos ψ, −sin ψ).
      const ahead = theta - dir * (ld / R);
      const tx = cx + R * Math.cos(ahead) - rx;
      const tz = cz + R * Math.sin(ahead) - rz;
      const xf = tx * ps.fx + tz * ps.fz;
      const yl = tx * ps.lx + tz * ps.lz;
      const err = Math.hypot(ps.x - cx, ps.z - cz) - R;
      integral = Math.max(-0.1, Math.min(0.1, integral + 0.004 * err * FIXED_DT));
      const deltaLeft = Math.atan((wheelbase * 2 * yl) / (xf * xf + yl * yl)) + dir * integral;
      f.steer = Math.max(-1, Math.min(1, -deltaLeft / lock));
    },
    () => {
      t += FIXED_DT;
      const ps = pose(rig);
      const lv = rig.vehicle.chassis.linvel();
      const ax = (lv.x - prev.x) / FIXED_DT;
      const az = (lv.z - prev.z) / FIXED_DT;
      prev = { x: lv.x, z: lv.z };
      const ay = (dir * (ax * ps.lx + az * ps.lz)) / G;
      const fwd = Math.abs(rig.vehicle.audio.forwardMps);
      const slip = fwd > 0.5 ? Math.atan2(Math.abs(rig.vehicle.audio.lateralSlipMps), fwd) * DEG : 0;
      const err = Math.hypot(ps.x - cx, ps.z - cz) - R;
      const deltaDeg = dir * rig.vehicle.steeringFraction * lock * DEG;
      win.n++;
      win.ay += ay;
      win.delta += deltaDeg;
      win.v += Math.hypot(lv.x, lv.z);
      win.r += dir * rig.vehicle.chassis.angvel().y;
      win.worstErr = Math.max(win.worstErr, Math.abs(err));
      win.worstSlip = Math.max(win.worstSlip, slip);
      if (win.n >= windowSteps) {
        const v = win.v / win.n;
        const r = win.r / win.n;
        windows.push({
          ay: win.ay / win.n,
          delta: win.delta / win.n,
          v,
          radius: r > 1e-3 ? v / r : Infinity,
          holding: win.worstErr <= SKID_HOLD_M && win.worstSlip <= SKID_SLIP_DEG,
        });
        win.n = win.ay = win.delta = win.v = win.r = win.worstErr = win.worstSlip = 0;
      }
      // Entry transient: the first two seconds settle onto the circle.
      if (t < 2) return false;
      wideS = Math.abs(err) > 2.5 ? wideS + FIXED_DT : 0;
      slipS = slip > SKID_SLIP_DEG ? slipS + FIXED_DT : 0;
      lockS = Math.abs(rig.vehicle.steeringFraction) >= 0.999 ? lockS + FIXED_DT : 0;
      if (wideS >= 1) out.limit = 'radius';
      else if (slipS >= 0.4) out.limit = 'slip';
      else if (lockS >= 1) out.limit = 'lock';
      else return false;
      return true;
    },
  );
  release(rig);

  // Limit: the best 1 s mean (two consecutive held half-second windows).
  for (let i = 4; i < windows.length; i++) {
    const a = windows[i - 1]!;
    const b = windows[i]!;
    if (!a.holding || !b.holding) continue;
    const g = (a.ay + b.ay) / 2;
    if (g > out.maxLatG) {
      out.maxLatG = round(g, 3);
      out.speedAtMaxKmh = round(((a.v + b.v) / 2) * 3.6, 1);
    }
  }
  // Gradient: (δ − L/R) against lateral g over the linear range.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of windows.slice(4)) {
    if (!w.holding || w.ay < 0.1 || w.ay > 0.4 || !Number.isFinite(w.radius)) continue;
    xs.push(w.ay);
    ys.push(w.delta - (wheelbase / w.radius) * DEG);
  }
  const fit = linearFit(xs, ys);
  out.fitPoints = xs.length;
  if (fit) {
    out.understeerDegPerG = round(fit.slope, 2);
    out.fitR2 = round(fit.r2, 3);
  }
  return out;
}

async function testSkidpad(id: string, loadKg: number): Promise<SkidpadResult> {
  const runs = [await skidpadRun(id, loadKg, 1), await skidpadRun(id, loadKg, -1)];
  const mean = (vs: (number | null)[]): number | null => {
    const ok = vs.filter((v): v is number => v !== null);
    return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
  };
  const us = mean(runs.map((r) => r.understeerDegPerG));
  return {
    radiusM: SKIDPAD_RADIUS_M,
    maxLatG: round(mean(runs.map((r) => r.maxLatG)) ?? 0, 3),
    understeerDegPerG: us === null ? null : round(us, 2),
    runs,
  };
}

/** One test driver's line through the lane change: see `dlcCourse`. */
interface DlcLine {
  /** Metres the lane-change windows are stretched past the gates (negative: shrunk). */
  stretch: number;
  /** Share of each lane's slack the line uses at the gates, 0 (lane centres) to 1. */
  edge: number;
  /** Pure-pursuit preview, seconds of travel. */
  previewS: number;
}

/**
 * The attempts a test driver gets at each speed, most promising first. ISO 3888-1
 * leaves the driver free to choose the line and repeat a run, so a speed counts as
 * passed if any of these lines gets through clean.
 */
const DLC_LINES: readonly DlcLine[] = [0.6, 0.45, 0.8].flatMap((previewS) =>
  [0.8, 0.4].flatMap((edge) => [1, 2, 3, 0, 4].map((stretch) => ({ stretch, edge, previewS }))),
);

/**
 * ISO 3888-1:2018 Table 1, in course metres from the gate at the start of section 1,
 * and the driver's line for the car's CENTRE. A lane gates the whole body: a lane
 * change starts as the tail clears the lane behind (centre `half` past its end) and is
 * done as the nose reaches the next (centre `half` short of its start), each window
 * stretched by `line.stretch` metres at both ends — longer and gentler, at the price
 * of a yawed body at the gate. At the gates the line sits `line.edge` of the way from
 * the lane centre to the side toward the change, which is where the slack is.
 */
function dlcCourse(
  width: number,
  half: number,
  line: DlcLine,
): {
  lanes: { from: number; to: number; lo: number; hi: number }[];
  ref: (s: number) => number;
} {
  const w1 = 1.1 * width + 0.25;
  const w3 = 1.2 * width + 0.25;
  const w5 = 1.3 * width + 0.25;
  const right = -w1 / 2;
  const y3 = right + 3.5 + w3 / 2;
  const y5 = right + w5 / 2;
  const lanes = [
    { from: 0, to: 15, lo: right, hi: right + w1 },
    { from: 45, to: 70, lo: right + 3.5, hi: right + 3.5 + w3 },
    { from: 95, to: 125, lo: right, hi: right + w5 },
  ];
  const yA = (line.edge * (w1 - width)) / 2;
  const yB = y3 - (line.edge * (w3 - width)) / 2;
  const yC = y5 + (line.edge * (w5 - width)) / 2;
  const s1 = 15 + half - line.stretch;
  const s2 = 45 - half + line.stretch;
  const s3 = 70 + half - line.stretch;
  const s4 = 95 - half + line.stretch;
  // Piecewise cosine easing through the knots: drift to the slack side of lane 1, over
  // to the near side of lane 3, hold, over to the near side of lane 5, then its centre.
  const knots: [number, number][] = [
    [0, 0],
    [Math.max(1, s1 - 8), 0],
    [s1, yA],
    [s2, yB],
    [s3, yB],
    [s4, yC],
    [s4 + 15, y5],
  ];
  const ref = (s: number): number => {
    if (s <= knots[0]![0]) return knots[0]![1];
    for (let i = 1; i < knots.length; i++) {
      const [sb, yb] = knots[i]!;
      if (s > sb) continue;
      const [sa, ya] = knots[i - 1]!;
      const u = (s - sa) / (sb - sa);
      return ya + (yb - ya) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
    return knots[knots.length - 1]![1];
  };
  return { lanes, ref };
}

/** One attempt at `kmh` on `line`: '' when clean, else what went wrong. */
async function dlcRun(id: string, loadKg: number, kmh: number, line: DlcLine): Promise<string> {
  const rig = await loadedRig(id, loadKg);
  const lock = rig.vehicle.modelDef.steerLock;
  const { wheelbase } = axles(rig);
  const [hx, , hz] = rig.vehicle.modelMeasure.halfExtents;
  const course = dlcCourse(2 * hx, hz, line);
  if (!runUp(rig, kmh)) {
    release(rig);
    return DLC_UNREACHED;
  }
  const o = pose(rig);
  // Course origin: the front bumper at the gate.
  const ox = o.x + o.fx * hz;
  const oz = o.z + o.fz * hz;
  const toCourse = (x: number, z: number): [number, number] => {
    const dx = x - ox;
    const dz = z - oz;
    return [dx * o.fx + dz * o.fz, dx * o.lx + dz * o.lz];
  };
  const hold = new SpeedHold();
  let reason = '';
  driveUntil(
    rig,
    30,
    (_, f) => {
      const ps = pose(rig);
      const v = horizKmh(rig);
      f.throttle = hold.throttle(kmh, v);
      f.brake = 0;
      // Pure pursuit from the body centre: the line is the centre's.
      const [s] = toCourse(ps.x, ps.z);
      const ts = s + Math.max(5, Math.min(25, line.previewS * (v / 3.6)));
      const ty = course.ref(ts);
      const tx = ox + o.fx * ts + o.lx * ty - ps.x;
      const tz = oz + o.fz * ts + o.lz * ty - ps.z;
      const xf = tx * ps.fx + tz * ps.fz;
      const yl = tx * ps.lx + tz * ps.lz;
      const kappa = (2 * yl) / (xf * xf + yl * yl);
      const yawErr = (v / 3.6) * kappa - rig.vehicle.chassis.angvel().y;
      const deltaLeft = Math.atan(wheelbase * kappa) + DLC_YAW_DAMPING_S * yawErr;
      f.steer = Math.max(-1, Math.min(1, -deltaLeft / lock));
    },
    () => {
      const ps = pose(rig);
      const [sc] = toCourse(ps.x, ps.z);
      if (Math.abs(wrapAngle(ps.psi - o.psi)) > Math.PI / 4) {
        reason = `spun at s=${sc.toFixed(0)}`;
        return true;
      }
      for (const [cfx, cly] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const x = ps.x + ps.fx * hz * cfx + ps.lx * hx * cly;
        const z = ps.z + ps.fz * hz * cfx + ps.lz * hx * cly;
        const [s, y] = toCourse(x, z);
        for (const lane of course.lanes) {
          if (s < lane.from || s > lane.to) continue;
          if (y < lane.lo || y > lane.hi) {
            reason = `cone at s=${s.toFixed(0)} (${y < lane.lo ? 'right' : 'left'})`;
            return true;
          }
        }
      }
      return sc > 125 + 2 * hz;
    },
  );
  release(rig);
  return reason;
}

const DLC_FROM_KMH = 40;
const DLC_STEP_KMH = 2.5;
/**
 * Steer added per rad/s of yaw rate short of the pursuit curvature's (`v·κ`). Without
 * it a pure-pursuit driver lets the car's yaw overshoot each change and clips the far
 * cones; with it, as a driver's hands do, the overshoot is caught. Swept on the
 * VAZ-2101: 0 → 65 km/h, 0.03 → 70, 0.06-0.3 → 82.5 (flat), so it sits mid-plateau.
 */
const DLC_YAW_DAMPING_S = 0.15;
const DLC_UNREACHED = 'entry speed not reached';

/**
 * Up from 40 km/h in 2.5 km/h steps, each speed passed if any of `DLC_LINES` gets
 * through (the last line that passed is tried first), until two speeds in a row fail.
 * The result is the top of the unbroken run of passes from 40.
 */
async function testDlc(id: string, loadKg: number): Promise<DlcResult> {
  const probe = await loadedRig(id, loadKg);
  const widthM = round(2 * probe.vehicle.modelMeasure.halfExtents[0], 3);
  release(probe);
  const runs: DlcRun[] = [];
  let fails = 0;
  let lastGood: DlcLine | null = null;
  let speedLimited = false;
  for (let kmh = DLC_FROM_KMH; kmh <= 150 && fails < 2; kmh += DLC_STEP_KMH) {
    const order: DlcLine[] = lastGood ? [lastGood, ...DLC_LINES.filter((l) => l !== lastGood)] : [...DLC_LINES];
    let passed: DlcLine | null = null;
    let firstReason = '';
    let unreached = false;
    for (const line of order) {
      const reason = await dlcRun(id, loadKg, kmh, line);
      if (reason === '') {
        passed = line;
        break;
      }
      if (reason === DLC_UNREACHED) {
        unreached = true;
        break;
      }
      firstReason ||= reason;
    }
    if (unreached) {
      // The run-up cannot hold this speed; nothing above it is reachable either.
      runs.push({ kmh, pass: false, reason: DLC_UNREACHED });
      speedLimited = true;
      break;
    }
    runs.push({
      kmh,
      pass: passed !== null,
      reason: passed
        ? `clean (preview ${passed.previewS} s, edge ${passed.edge}, stretch ${passed.stretch} m)`
        : `all ${order.length} lines failed; first: ${firstReason}`,
    });
    if (passed) lastGood = passed;
    fails = passed ? 0 : fails + 1;
  }
  let best: number | null = null;
  for (const r of runs) {
    if (!r.pass) break;
    best = r.kmh;
  }
  // A pass above the first failed speed: the line search, not the car, decided it.
  const firstFail = runs.find((r) => !r.pass)?.kmh ?? Infinity;
  const nonMonotonic = runs.some((r) => r.pass && r.kmh > firstFail);
  return { maxEntryKmh: best, widthM, runs, nonMonotonic, speedLimited };
}

async function testCoast(id: string, loadKg: number): Promise<CoastResult | null> {
  const rig = await loadedRig(id, loadKg);
  manualSprint(rig, id, [53]);
  let step = 0;
  const neutral = driveUntil(
    rig,
    3,
    (_, f) => {
      f.throttle = 0;
      f.brake = 0;
      f.steer = 0;
      f.shift = step++ % 2 === 0 && rig.vehicle.gearLabel !== 'N' ? -1 : 0;
    },
    () => rig.vehicle.gearLabel === 'N',
  );
  if (!neutral || horizKmh(rig) < 50) {
    release(rig);
    return null;
  }
  driveUntil(
    rig,
    10,
    (_, f) => {
      f.throttle = 0;
      f.shift = 0;
    },
    () => horizKmh(rig) <= 50,
  );
  const start = rig.vehicle.chassis.translation();
  let t = 0;
  const reachedRest = driveUntil(
    rig,
    300,
    (_, f) => {
      f.throttle = 0;
      f.brake = 0;
      f.shift = 0;
      f.steer = 0;
    },
    () => {
      t += FIXED_DT;
      return horizKmh(rig) < 0.5;
    },
  );
  const end = rig.vehicle.chassis.translation();
  release(rig);
  return { distM: round(Math.hypot(end.x - start.x, end.z - start.z), 1), timeS: round(t, 1), reachedRest };
}

async function testTurn(id: string, loadKg: number): Promise<TurnResult> {
  const rig = await loadedRig(id, loadKg);
  driveUntil(
    rig,
    15,
    (_, f) => {
      f.throttle = horizKmh(rig) < 10 ? 1 : 0;
      f.steer = 0;
    },
    () => horizKmh(rig) >= 9.5,
  );
  const front = rig.vehicle.wheelRide.map((w, i) => (w.isFront ? i : -1)).filter((i) => i >= 0);
  const xs: number[][] = front.map(() => []);
  const zs: number[][] = front.map(() => []);
  let radiusSum = 0;
  let samples = 0;
  drive(rig, 18, (t, f) => {
    // A narrow governor holds the circle at 9-11 km/h, above the tyre model's slip floor.
    const kmh = horizKmh(rig);
    f.throttle = kmh < 9 ? 0.35 : kmh > 11 ? 0 : 0.15;
    f.brake = 0;
    f.steer = 1;
    if (t < 4) return;
    const spray = rig.vehicle.wheelSpray;
    front.forEach((wi, k) => {
      xs[k]!.push(spray[wi]!.absoluteContactX);
      zs[k]!.push(spray[wi]!.absoluteContactZ);
    });
    const fwd = Math.abs(rig.vehicle.audio.forwardMps);
    const yaw = Math.abs(rig.vehicle.chassis.angvel().y);
    if (fwd > 1 && yaw > 0.01) {
      radiusSum += fwd / yaw;
      samples++;
    }
  });
  release(rig);
  const outer = Math.max(...front.map((_, k) => fitCircle(xs[k]!, zs[k]!).r));
  return { diameterM: round(2 * outer, 2), centreRadiusM: samples ? round(radiusSum / samples, 2) : 0 };
}

// ---- run mode --------------------------------------------------------------------

function driveOf(id: string): CarResult['drive'] {
  const bias = carModel(id).rearDriveBias;
  return bias >= 0.99 ? 'RWD' : bias <= 0.01 ? 'FWD' : '4WD';
}

async function runCar(id: string, loadKg: number, tests: readonly TestName[]): Promise<CarResult> {
  const t0 = performance.now();
  const def = carModel(id);
  const probe = await loadedRig(id, loadKg);
  const wheelbaseM = round(axles(probe).wheelbase, 3);
  release(probe);
  const r: CarResult = {
    id,
    label: def.label,
    drive: driveOf(id),
    kerbKg: def.mass,
    testKg: def.mass + loadKg,
    wheelbaseM,
    flags: [],
    wallS: 0,
  };
  const has = (t: TestName): boolean => tests.includes(t);
  if (has('sprint')) r.sprint = await testSprint(id, loadKg);
  if (has('top')) {
    r.top = await testTop(id, loadKg);
    if (!r.top.reachedPlateau) r.flags.push('top: no plateau within 9 km');
  }
  if (has('brake')) {
    r.brake100 = await testBrake(id, loadKg, 100);
    r.brake80 = await testBrake(id, loadKg, 80);
  }
  if (has('skidpad')) {
    r.skidpad = await testSkidpad(id, loadKg);
    for (const run of r.skidpad.runs) {
      const side = run.dir > 0 ? 'left' : 'right';
      if (run.fitPoints < 6) r.flags.push(`skidpad ${side}: only ${run.fitPoints} points in 0.1-0.4 g`);
      if (run.limit === 'time') r.flags.push(`skidpad ${side}: no limit reached in 60 s`);
    }
    // A small gradient (FWD cars, ~0.5 °/g) fits with a low r² on step noise alone, so
    // the test of a trustworthy gradient is that both directions agree.
    const [a, b] = r.skidpad.runs;
    if (a && b && Math.abs(a.maxLatG - b.maxLatG) > 0.05) {
      r.flags.push(`skidpad: left/right differ ${a.maxLatG}/${b.maxLatG} g`);
    }
    if (a?.understeerDegPerG != null && b?.understeerDegPerG != null && Math.abs(a.understeerDegPerG - b.understeerDegPerG) > 0.3) {
      r.flags.push(`skidpad: left/right gradient differ ${a.understeerDegPerG}/${b.understeerDegPerG} °/g`);
    }
  }
  if (has('dlc')) {
    r.dlc = await testDlc(id, loadKg);
    if (r.dlc.nonMonotonic) r.flags.push('dlc: a pass above the first failed speed (driver-sensitive)');
    if (r.dlc.speedLimited) r.flags.push('dlc: search ended at the highest entry speed the run-up holds');
    if (r.dlc.maxEntryKmh === null) r.flags.push('dlc: no clean run at any speed');
  }
  if (has('coast')) {
    r.coast = await testCoast(id, loadKg);
    if (r.coast === null) r.flags.push('coast: could not reach neutral at 50 km/h');
    else if (!r.coast.reachedRest) r.flags.push('coast: still rolling after 300 s');
  }
  if (has('turn')) r.turn = await testTurn(id, loadKg);
  r.wallS = round((performance.now() - t0) / 1000, 1);
  return r;
}

const fmt = (v: number | null | undefined, digits = 1): string => (v == null ? '—' : v.toFixed(digits));

function suiteMarkdown(suite: SuiteFile): string {
  const lines = [
    `# Physics suite: ${suite.label}`,
    '',
    `${suite.createdAt}; load +${suite.conditions.loadKg} kg; flat asphalt; tests ${suite.conditions.tests.join(', ')}; wall ${suite.wallS.toFixed(0)} s.`,
    '',
    '| car | drive | test kg | 0-60 s | 0-80 s | 0-100 s | top km/h | 100-0 m | 80-0 m | MFDD100 g | lock | yaw100 ° | skidpad g | US °/g | DLC km/h | coast50 m | turn Ø m |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of Object.values(suite.cars)) {
    lines.push(
      `| ${c.id} | ${c.drive} | ${c.testKg} | ${fmt(c.sprint?.t60)} | ${fmt(c.sprint?.t80)} | ${fmt(c.sprint?.t100)} | ` +
        `${fmt(c.top?.kmh, 0)} | ${fmt(c.brake100?.distM)} | ${fmt(c.brake80?.distM)} | ${fmt(c.brake100?.mfddG, 2)} | ` +
        `${c.brake100?.firstLock ?? '—'} | ${fmt(c.brake100?.yawDeg)} | ${fmt(c.skidpad?.maxLatG, 2)} | ${fmt(c.skidpad?.understeerDegPerG, 2)} | ` +
        `${fmt(c.dlc?.maxEntryKmh)} | ${fmt(c.coast?.distM, 0)} | ${fmt(c.turn?.diameterM, 2)} |`,
    );
  }
  const flagged = Object.values(suite.cars).filter((c) => c.flags.length > 0);
  if (flagged.length) {
    lines.push('', '## Driver / measurement flags', '');
    for (const c of flagged) lines.push(`- ${c.id}: ${c.flags.join('; ')}`);
  }
  lines.push(
    '',
    'DLC (ISO 3888-1, max clean entry speed, throttle held) is limited by the bench driver: compare builds with it, not real cars.  ',
    'US °/g: understeer gradient on a 40 m circle, mean of both directions, (δ − L/R) vs a_y over 0.1-0.4 g (δ = road-wheel angle).  ',
    'MFDD100: ECE R13-H mean fully developed deceleration of the 100-0 stop; lock: first axle to lock.  ',
    'Coast50: 50 km/h to rest in neutral.  Turn Ø: outer front contact patch circle at full lock, 10 km/h.',
    '',
  );
  return lines.join('\n');
}

function parseArgs(argv: string[]): { positional: string[]; opts: Record<string, string> } {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      opts[k!] = v ?? argv[++i] ?? '';
    } else positional.push(a);
  }
  return { positional, opts };
}

function writeOut(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function runMode(opts: Record<string, string>): Promise<void> {
  const label = opts.label ?? 'run';
  const loadKg = Number(opts.load ?? 150);
  const ids = opts.cars ? opts.cars.split(',') : CAR_MODELS.map((m) => m.id);
  const tests = (opts.tests ? opts.tests.split(',') : [...TESTS]) as TestName[];
  for (const t of tests) if (!TESTS.includes(t)) throw new Error(`unknown test "${t}" (${TESTS.join(', ')})`);
  for (const id of ids) carModel(id);
  await preloadCarModels(ids);
  const t0 = performance.now();
  const suite: SuiteFile = {
    label,
    createdAt: new Date().toISOString(),
    conditions: { loadKg, surface: 'asphalt', dt: FIXED_DT, tests },
    wallS: 0,
    cars: {},
  };
  const jsonPath = `${OUT_DIR}/${label}.json`;
  for (const id of ids) {
    const r = await runCar(id, loadKg, tests);
    suite.cars[id] = r;
    suite.wallS = round((performance.now() - t0) / 1000, 1);
    // Written after every car, so a long run that is stopped keeps what it measured.
    writeOut(jsonPath, JSON.stringify(suite, null, 2));
    console.log(
      `${id.padEnd(14)} ${r.wallS.toFixed(1).padStart(5)} s  0-100 ${fmt(r.sprint?.t100)}  top ${fmt(r.top?.kmh, 0)}  ` +
        `100-0 ${fmt(r.brake100?.distM)}  80-0 ${fmt(r.brake80?.distM)}  skid ${fmt(r.skidpad?.maxLatG, 2)} g ` +
        `US ${fmt(r.skidpad?.understeerDegPerG, 2)}  dlc ${fmt(r.dlc?.maxEntryKmh)}  coast ${fmt(r.coast?.distM, 0)}  ` +
        `turn ${fmt(r.turn?.diameterM, 2)}${r.flags.length ? '  ! ' + r.flags.join('; ') : ''}`,
    );
  }
  const md = suiteMarkdown(suite);
  writeOut(`${OUT_DIR}/${label}.md`, md);
  console.log(`\n${jsonPath} and .md written; ${ids.length} cars in ${suite.wallS.toFixed(0)} s`);
}

// ---- compare mode ----------------------------------------------------------------

/** Reference figure keys, as `docs/physics-references.md` writes them, and where they read. */
const KEYS: readonly { key: string; label: string; read: (c: CarResult) => number | null | undefined }[] = [
  { key: '0-80', label: '0-80 s', read: (c) => c.sprint?.t80 },
  { key: '0-100', label: '0-100 s', read: (c) => c.sprint?.t100 },
  { key: 'top', label: 'top km/h', read: (c) => c.top?.kmh },
  { key: 'brake100', label: '100-0 m', read: (c) => c.brake100?.distM },
  { key: 'brake80', label: '80-0 m', read: (c) => c.brake80?.distM },
  { key: 'skidpad_g', label: 'skidpad g', read: (c) => c.skidpad?.maxLatG },
  { key: 'understeer', label: 'US °/g', read: (c) => c.skidpad?.understeerDegPerG },
  { key: 'dlc', label: 'DLC km/h', read: (c) => c.dlc?.maxEntryKmh },
  { key: 'coast50', label: 'coast50 m', read: (c) => c.coast?.distM },
  { key: 'turn_circle', label: 'turn Ø m', read: (c) => c.turn?.diameterM },
];

/**
 * What a reference row is, from the qualifier in its figure cell: a road test, the
 * factory's claim, arithmetic on a measured figure, a different variant's figure, or a
 * bound — `ceiling` an upper one (type-approval "не более"), `floor` a lower one (the
 * factory coastdown minimum).
 */
type RefKind = 'measured' | 'passport' | 'derived' | 'sibling' | 'ceiling' | 'floor' | 'other';
interface RefRow {
  key: string;
  figure: string;
  value: number;
  range: [number, number] | null;
  kind: RefKind;
  source: string;
}

/** Per-car tables of `| figure | value | conditions | source | confidence |` under `## <car id> …`. */
function parseRefs(path: string): Map<string, RefRow[]> {
  const out = new Map<string, RefRow[]>();
  if (!existsSync(path)) return out;
  let car: string | null = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const heading = /^#{2,3}\s+(\S+)/.exec(line);
    if (heading) {
      car = heading[1]!.replace(/[`*]/g, '');
      continue;
    }
    if (!car || !line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const figure = cells[0]!.replace(/[`*]/g, '');
    const key = figure.split(/\s+/)[0]!;
    if (!KEYS.some((k) => k.key === key)) continue;
    const nums = (cells[1]!.replace(/,/g, '.').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (nums.length === 0) continue;
    const range: [number, number] | null = nums.length >= 2 && /[–—-]/.test(cells[1]!) ? [nums[0]!, nums[1]!] : null;
    const value = range ? (range[0] + range[1]) / 2 : nums[0]!;
    const lower = figure.toLowerCase();
    const kind: RefKind =
      (['ceiling', 'floor', 'sibling', 'measured', 'passport', 'derived'] as const).find((k) => lower.includes(k)) ??
      'other';
    const rows = out.get(car) ?? [];
    rows.push({ key, figure, value, range, kind, source: cells[3] ?? '' });
    out.set(car, rows);
  }
  return out;
}

const KIND_RANK: Record<RefKind, number> = {
  measured: 0,
  passport: 1,
  derived: 2,
  other: 3,
  sibling: 4,
  ceiling: 5,
  floor: 5,
};

function pickRef(rows: RefRow[] | undefined, key: string): RefRow | null {
  const match = (rows ?? []).filter((r) => r.key === key).sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return match[0] ?? null;
}

function errText(sim: number | null | undefined, ref: RefRow | null): string {
  if (sim == null || ref === null) return '—';
  const over = (((sim - ref.value) / ref.value) * 100).toFixed(1);
  if (ref.kind === 'ceiling') return sim <= ref.value ? 'ok' : `+${over}%`;
  if (ref.kind === 'floor') return sim >= ref.value ? 'ok' : `${over}%`;
  const e = ((sim - ref.value) / ref.value) * 100;
  return `${e >= 0 ? '+' : ''}${e.toFixed(1)}%`;
}

function refText(ref: RefRow | null): string {
  if (ref === null) return '—';
  const v = ref.range ? `${ref.range[0]}–${ref.range[1]}` : String(ref.value);
  if (ref.kind === 'ceiling') return `≤${v}`;
  if (ref.kind === 'floor') return `≥${v}`;
  const tag = { measured: 'm', passport: 'p', derived: 'd', sibling: 's', other: '' }[ref.kind];
  return tag ? `${v} (${tag})` : v;
}

function compareMode(positional: string[], opts: Record<string, string>): void {
  const [beforePath, afterPath] = positional;
  if (!beforePath) throw new Error('compare needs <before.json> [after.json]');
  const before = JSON.parse(readFileSync(beforePath, 'utf8')) as SuiteFile;
  const after = afterPath ? (JSON.parse(readFileSync(afterPath, 'utf8')) as SuiteFile) : null;
  const refsPath = opts.refs ?? DEFAULT_REFS;
  const refs = parseRefs(refsPath);
  const ids = [...new Set([...Object.keys(before.cars), ...Object.keys(after?.cars ?? {})])];
  const lines = [
    `# Physics suite compare: ${before.label}${after ? ` → ${after.label}` : ''}`,
    '',
    `References: ${existsSync(refsPath) ? refsPath : `${refsPath} (missing)`}. (m) measured road test, (p) factory passport, (d) derived from a measured figure, (s) sibling car; ≤ ceiling and ≥ floor are bounds ("ok" when inside, else the % past the bound).`,
    '',
    after
      ? '| car | test | ref | before | after | err before | err after |'
      : '| car | test | ref | value | err |',
    after ? '|---|---|---|---|---|---|---|' : '|---|---|---|---|---|',
  ];
  for (const id of ids) {
    const b = before.cars[id];
    const a = after?.cars[id];
    for (const k of KEYS) {
      const ref = pickRef(refs.get(id), k.key);
      const bv = b ? k.read(b) : null;
      const av = a ? k.read(a) : null;
      if (bv == null && av == null && ref === null) continue;
      lines.push(
        after
          ? `| ${id} | ${k.label} | ${refText(ref)} | ${fmt(bv, 2)} | ${fmt(av, 2)} | ${errText(bv, ref)} | ${errText(av, ref)} |`
          : `| ${id} | ${k.label} | ${refText(ref)} | ${fmt(bv, 2)} | ${errText(bv, ref)} |`,
      );
    }
  }
  const md = lines.join('\n') + '\n';
  const outPath = opts.out ?? `${OUT_DIR}/compare-${before.label}${after ? `-${after.label}` : ''}.md`;
  writeOut(outPath, md);
  console.log(md);
  console.log(`written ${outPath}`);
}

// ---- entry -----------------------------------------------------------------------

const { positional, opts } = parseArgs(process.argv.slice(2));
const mode = positional.shift() ?? 'run';
if (mode === 'run') await runMode(opts);
else if (mode === 'compare') compareMode(positional, opts);
else throw new Error(`unknown mode "${mode}": run | compare`);
