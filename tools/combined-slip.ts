/**
 * tools/combined-slip.ts
 *
 * Combined slip: what a tyre doing two jobs at once has left for each, and what that
 * does to a car in a bend.
 *
 *   tyre    the model itself (vehicletuning.ts `combinedLateral`/`combinedLongitudinal`),
 *           on asphalt with the VAZ-2106's front tyre at its static load: side force
 *           against slip ratio at fixed slip angles, drive force against slip angle at
 *           fixed slip ratios, and the side grip a locked wheel keeps — each beside the
 *           one-way friction ellipse it replaced (`old`), which trimmed only the side
 *           force and floored it at 0.05, and cut a locked wheel's to 0.22.
 *   power   a steady 40 m corner at 0.5 and 0.65 g held by a curvature loop, then the
 *           road-wheel angle frozen and full throttle for 1.5 s. The change in front and
 *           rear slip angle, in body slip and in path curvature (yaw rate over speed),
 *           averaged over the last half second. A rear-drive car should grow its rear
 *           slip and tighten (oversteer onset); a front-drive one grow its front slip
 *           and run wide (understeer).
 *   trail   the same corner, throttle shut and the brake at 0.4 for one second with the
 *           wheel angle frozen: the peak path curvature and yaw rate against the steady
 *           values — the rotation braking into a bend buys — and the rear slip angle
 *           growth.
 *
 * Straight-line braking and acceleration are reality.ts's `brake` and `0-100` columns.
 *
 *   bun tools/combined-slip.ts [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { preloadCarModels } from '../src/render/carmodel';
import { carModel } from '../src/vehicle/carmodels';
import { SURFACES, SurfaceType } from '../src/core/surfaces';
import {
  HANDLING_PROFILES,
  LONGITUDINAL_PEAK_U,
  combinedLateral,
  combinedLongitudinal,
  longitudinalShape,
  sideForceShape,
  tyreCurve,
} from '../src/vehicle/vehicletuning';
import { addGround, makeRig, drive, type Rig } from './handling-bench';

installAssetShim();
installDocumentShim();

const GRAVITY = 9.81;
const RADIUS = 40;
/** The bends: asphalt up to near the classics' limit, and gravel, where they can spin a wheel. */
const CASES: readonly { name: string; surface: SurfaceType; g: number }[] = [
  { name: 'asphalt', surface: SurfaceType.Asphalt, g: 0.5 },
  { name: 'asphalt', surface: SurfaceType.Asphalt, g: 0.65 },
  { name: 'asphalt', surface: SurfaceType.Asphalt, g: 0.72 },
  { name: 'gravel', surface: SurfaceType.Gravel, g: 0.4 },
];
type Case = (typeof CASES)[number];
const ids = process.argv.slice(2);
const models = ids.length > 0 ? ids : ['sv_vaz2106', 'gt_vaz2110'];

const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------
// tyre: the model on its own
// ---------------------------------------------------------------------------

function tyreTables(): void {
  const def = carModel('sv_vaz2106');
  const curve = tyreCurve(def.tyre, HANDLING_PROFILES[def.handlingProfile]);
  const peakDeg = curve.peakFrontDeg;
  const peakTan = Math.tan(rad(peakDeg));
  const fadeDeg = Math.min(peakDeg, curve.fullFrontDeg - 1);
  const optimal = SURFACES[SurfaceType.Asphalt].optimalSlip;
  const pureSide = (alphaDeg: number): number =>
    sideForceShape(rad(alphaDeg), peakTan, fadeDeg, curve.fullFrontDeg, curve.plateauFront, true);
  const sideSlip = (alphaDeg: number): number => Math.tan(rad(alphaDeg)) / peakTan;
  const longSlip = (kappa: number): number => kappa / (optimal * LONGITUDINAL_PEAK_U);
  const newSide = (alphaDeg: number, kappa: number): number =>
    combinedLateral(
      sideSlip(alphaDeg),
      longSlip(kappa),
      peakTan,
      fadeDeg,
      curve.fullFrontDeg,
      curve.plateauFront,
      true,
    );
  const oldSide = (alphaDeg: number, kappa: number): number => {
    const usage = Math.abs(longitudinalShape(kappa / optimal));
    const ellipse = Math.max(0.05, Math.sqrt(Math.max(0, 1 - usage * usage)));
    return pureSide(alphaDeg) * ellipse * (kappa <= -0.5 ? 0.22 : 1);
  };

  console.log(
    `--- tyre: VAZ-2106 front (peak ${peakDeg.toFixed(1)} deg), asphalt (optimal slip ${optimal}) ---`,
  );
  console.log('side force / capacity against slip ratio, new (old)');
  const kappas = [0, 0.03, 0.06, 0.1, 0.2, 0.5, -0.06, -0.15, -1];
  console.log(`  alpha  ${kappas.map((k) => `k=${k}`.padStart(13)).join('')}`);
  for (const a of [2, 4, 8, 15]) {
    console.log(
      `  ${String(a).padStart(3)} deg${kappas
        .map((k) => `${newSide(a, k).toFixed(2)} (${oldSide(a, k).toFixed(2)})`.padStart(13))
        .join('')}`,
    );
  }

  console.log('drive/brake force / capacity against slip angle, new (old: none)');
  const alphas = [0, 2, 4, 8, 15];
  console.log(`  kappa  ${alphas.map((a) => `${a} deg`.padStart(13)).join('')}`);
  for (const k of [0.03, 0.06, 0.1, 0.2, -0.06, -0.15]) {
    const pure = longitudinalShape(k / optimal);
    console.log(
      `  ${k.toFixed(2).padStart(5)}  ${alphas
        .map(
          (a) =>
            `${combinedLongitudinal(longSlip(k), sideSlip(a)).toFixed(2)} (${pure.toFixed(2)})`.padStart(13),
        )
        .join('')}`,
    );
  }

  // The low-slip limit: the stiffnesses pure slip calibrated must survive unchanged.
  const h = 1e-5;
  const cxPure = longitudinalShape(h / optimal) / h;
  const cxNew = combinedLongitudinal(longSlip(h), 0) / h;
  const cyPure = pureSide(deg(h)) / h;
  const cyNew = newSide(deg(h), 0) / h;
  console.log(
    `low-slip stiffness: longitudinal ${cxNew.toFixed(3)} vs pure ${cxPure.toFixed(3)}, ` +
      `lateral ${cyNew.toFixed(3)} vs pure ${cyPure.toFixed(3)} (per unit slip, /capacity)`,
  );
  console.log(
    `locked wheel (k = -1) side grip: ${[3, 5, 10, 20, 40]
      .map((a) => `${a} deg ${newSide(a, -1).toFixed(2)} (${oldSide(a, -1).toFixed(2)})`)
      .join(', ')}`,
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// power / trail: the car in a bend
// ---------------------------------------------------------------------------

interface WheelView {
  readonly isFront: boolean;
  readonly slipAngleRad: number;
}
interface Internals {
  wheels: WheelView[];
  steerAngle: number;
}

interface State {
  speed: number;
  yaw: number;
  kappa: number;
  slipF: number;
  slipR: number;
  beta: number;
}

function stateOf(rig: Rig): State {
  const v = rig.vehicle;
  const internals = v as unknown as Internals;
  const lv = v.chassis.linvel();
  const q = v.chassis.rotation();
  // Body +Z and +X in world, horizontal components.
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const rz = 2 * (q.x * q.z - q.w * q.y);
  const speed = Math.hypot(lv.x, lv.z);
  const yaw = Math.abs(v.chassis.angvel().y);
  let slipF = 0;
  let slipR = 0;
  let nf = 0;
  let nr = 0;
  for (const w of internals.wheels) {
    if (w.isFront) {
      slipF += Math.abs(w.slipAngleRad);
      nf++;
    } else {
      slipR += Math.abs(w.slipAngleRad);
      nr++;
    }
  }
  return {
    speed,
    yaw,
    kappa: speed > 1 ? yaw / speed : 0,
    slipF: deg(slipF / Math.max(1, nf)),
    slipR: deg(slipR / Math.max(1, nr)),
    beta: Math.abs(deg(Math.atan2(lv.x * rx + lv.z * rz, lv.x * fx + lv.z * fz))),
  };
}

function mean(list: readonly State[]): State {
  const out: State = { speed: 0, yaw: 0, kappa: 0, slipF: 0, slipR: 0, beta: 0 };
  for (const s of list) for (const k of Object.keys(out) as (keyof State)[]) out[k] += s[k];
  for (const k of Object.keys(out) as (keyof State)[]) out[k] /= Math.max(1, list.length);
  return out;
}

/** Onto the circle at `g` and held there; returns the wheel angle and steady state. */
function settle(rig: Rig, g: number): { angle: number; steady: State } {
  const v = rig.vehicle;
  const internals = v as unknown as Internals;
  const ws = v.modelMeasure.wheels;
  const zOf = (front: boolean): number => {
    const zs = ws.filter((w) => w.isFront === front).map((w) => w.pos[2]);
    return zs.reduce((a, b) => a + b, 0) / zs.length;
  };
  const wheelbase = Math.abs(zOf(true) - zOf(false));
  const target = Math.sqrt(g * GRAVITY * RADIUS);
  const kappaTarget = 1 / RADIUS;
  let integral = 0;
  const control = (f: Rig['input']): void => {
    const s = stateOf(rig);
    const error = kappaTarget - s.kappa;
    integral = Math.max(-0.5, Math.min(0.5, integral + error * 3 * (1 / 60)));
    const angle = Math.max(0, wheelbase * kappaTarget + 2 * error + integral);
    f.steer = v.steeringInputForWheelAngle(angle);
    f.throttle = Math.max(0, Math.min(1, (target - s.speed) * 0.5 + 0.2));
    f.brake = s.speed > target + 1.5 ? 0.25 : 0;
  };
  drive(rig, 8, (_, f) => {
    const s = stateOf(rig);
    f.steer = 0;
    f.throttle = Math.max(0, Math.min(1, (target - s.speed) * 0.5 + 0.2));
  });
  drive(rig, 10, (_, f) => control(f));
  const window: State[] = [];
  let angle = 0;
  drive(rig, 1, (_, f) => {
    control(f);
    window.push(stateOf(rig));
    angle += internals.steerAngle;
  });
  return { angle: angle / window.length, steady: mean(window) };
}

interface PowerResult {
  steady: State;
  end: State;
}

async function power(id: string, c: Case): Promise<PowerResult> {
  const rig = await makeRig(id, (physics) => addGround(physics, c.surface));
  const { angle, steady } = settle(rig, c.g);
  const tail: State[] = [];
  drive(rig, 1, (t, f) => {
    f.steer = rig.vehicle.steeringInputForWheelAngle(Math.abs(angle));
    f.throttle = 1;
    f.brake = 0;
    if (t >= 0.5) tail.push(stateOf(rig));
  });
  rig.vehicle.dispose();
  return { steady, end: mean(tail) };
}

interface TrailResult {
  steady: State;
  braking: State;
  peakKappa: number;
  peakYaw: number;
  peakSlipR: number;
  endSpeed: number;
}

async function trail(id: string, c: Case): Promise<TrailResult> {
  const rig = await makeRig(id, (physics) => addGround(physics, c.surface));
  const { angle, steady } = settle(rig, c.g);
  let peakKappa = 0;
  let peakYaw = 0;
  let peakSlipR = 0;
  let endSpeed = 0;
  const window: State[] = [];
  drive(rig, 1, (t, f) => {
    const s = stateOf(rig);
    f.steer = rig.vehicle.steeringInputForWheelAngle(Math.abs(angle));
    f.throttle = 0;
    f.brake = 0.4;
    peakKappa = Math.max(peakKappa, s.kappa);
    peakYaw = Math.max(peakYaw, s.yaw);
    peakSlipR = Math.max(peakSlipR, s.slipR);
    endSpeed = s.speed;
    if (t >= 0.3) window.push(s);
  });
  rig.vehicle.dispose();
  return { steady, braking: mean(window), peakKappa, peakYaw, peakSlipR, endSpeed };
}

const signed = (x: number, digits = 2): string => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
/** Lateral acceleration, g, from speed and yaw rate. */
const ayOf = (s: State): number => (s.speed * s.yaw) / GRAVITY;
/** Slip angle per g of lateral acceleration, so the speed a test gains or loses does not read as balance. */
const perG = (slipDeg: number, s: State): number => slipDeg / Math.max(0.05, ayOf(s));
/** Understeer gradient off the tyres, deg/g: front slip less rear slip, per g. */
const gradient = (s: State): number => perG(s.slipF - s.slipR, s);

tyreTables();
await preloadCarModels(models);
console.log(`--- power: steady ${RADIUS} m corner, wheel angle frozen, full throttle, 0.5-1.0 s in ---`);
console.log('slip angles per g of lateral acceleration (deg/g), steady -> on power; K = (front - rear)/g');
console.log(
  'model          drive  bend           front/g        rear/g         K              d K     d beta  curvature  speed',
);
for (const id of models) {
  const def = carModel(id);
  const layout = def.rearDriveBias >= 1 ? 'RWD' : def.rearDriveBias <= 0 ? 'FWD' : 'AWD';
  for (const c of CASES) {
    const { steady: s, end: e } = await power(id, c);
    const arrow = (a: number, b: number): string => `${a.toFixed(2)} -> ${b.toFixed(2)}`.padEnd(14);
    console.log(
      `${id.padEnd(14)} ${layout}   ${c.name.padEnd(7)} ${c.g.toFixed(2)}   ${arrow(perG(s.slipF, s), perG(e.slipF, e))} ` +
        `${arrow(perG(s.slipR, s), perG(e.slipR, e))} ${arrow(gradient(s), gradient(e))} ` +
        `${signed(gradient(e) - gradient(s)).padStart(6)}  ${signed(e.beta - s.beta).padStart(6)}  ` +
        `${signed((100 * (e.kappa - s.kappa)) / s.kappa, 1).padStart(7)}%   ${signed((e.speed - s.speed) * 3.6, 1)} km/h`,
    );
  }
}
console.log('');
console.log(`--- trail: steady ${RADIUS} m corner, wheel angle frozen, brake 0.4 for 1 s ---`);
console.log('K over 0.3-1.0 s of braking against steady (deg/g); peaks over the whole second');
console.log('model          bend          K steady  K braking  d K     peak curvature  peak yaw  slipR -> peak  speed lost');
for (const id of models) {
  for (const c of CASES) {
    const r = await trail(id, c);
    console.log(
      `${id.padEnd(14)} ${c.name.padEnd(7)} ${c.g.toFixed(2)}  ${gradient(r.steady).toFixed(2).padStart(8)}  ${gradient(r.braking).toFixed(2).padStart(9)}  ` +
        `${signed(gradient(r.braking) - gradient(r.steady)).padStart(6)}  ` +
        `${signed((100 * (r.peakKappa - r.steady.kappa)) / r.steady.kappa, 1).padStart(10)}%     ` +
        `${signed((100 * (r.peakYaw - r.steady.yaw)) / r.steady.yaw, 1).padStart(6)}%  ` +
        `${r.steady.slipR.toFixed(2).padStart(5)} -> ${r.peakSlipR.toFixed(2).padEnd(5)}  ` +
        `${((r.steady.speed - r.endSpeed) * 3.6).toFixed(1).padStart(6)} km/h`,
    );
  }
}
