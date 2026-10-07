/**
 * tools/aero.ts
 *
 * The body in the air: lift, the drag's pitch, the crosswind and the gusts.
 *
 *   loads   axle loads at a held 30, 100, 130 and 160 km/h on a 7% downgrade (the
 *           grade is what lets a 70 hp car hold 160), as the change from the same
 *           car at 30 km/h on the same grade: what lift and drag take off or put on
 *           each axle at speed. Steady speed, so the tyres' own drive or brake force
 *           balances the drag at the road, exactly as a wind tunnel's wheel pads do.
 *   cross   a straight at 100 km/h held by a lane controller, then a steady crosswind
 *           across the road (toward +X, the body's right as vehicle.ts names it) at
 *           10 and 15 m/s, and 24 m/s — a haboob's 17 m/s with a two-sigma gust, the
 *           strongest the weather makes — switched on. Hands off (the steering frozen
 *           where the calm run had it): lateral drift and heading after 1, 2 and 3 s,
 *           against the same run in still air. Lane held (the controller left on): the
 *           extra road-wheel angle the wind takes and the worst lateral excursion.
 *           Plus the side load and yaw acceleration in the first tick of the gust.
 *   gusts   the gust field (world/weather.ts `windAt`) in a held 'wind' episode and a
 *           haboob, sampled standing and driving across the wind at 100 km/h: σu/U
 *           and σv/U against the intensity the weather asked for, the 3 s peak gust
 *           over the mean (the anemometer's gust factor), the integral time scale, the
 *           share of the variance above ~2 Hz (what is left after a quarter-second
 *           running mean: buzz, not push), and that the field is a pure function of
 *           the seed. These are checked.
 *
 *   bun tools/aero.ts [loads|cross|gusts] [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { FIXED_DT } from '../src/core/physics';
import { SURFACES, SurfaceType } from '../src/core/surfaces';
import { preloadCarModels } from '../src/render/carmodel';
import { forceWeather, updateWeather, weather, windAt } from '../src/world/weather';
import { addGround, addInclineGround, makeRig, drive, type Rig } from './handling-bench';

installAssetShim();
installDocumentShim();
// A glass road. Asphalt's sub-collider profile (microRelief, hummock, texture) reaches
// the body as a separate hop force that `loadN` does not include, and over a few hundred
// metres it moves an axle's mean `loadN` by 100-300 N: more than the lift being measured.
// Without it the four wheel loads sum to the car's weight to the newton at every speed.
Object.assign(SURFACES[SurfaceType.Asphalt], { microRelief: 0, hummock: 0, texture: 0 });

const GRAVITY = 9.81;
const deg = (r: number): number => (r * 180) / Math.PI;

const args = process.argv.slice(2);
const SECTIONS = ['loads', 'cross', 'gusts'];
const sections = args.filter((a) => SECTIONS.includes(a));
const ids = args.filter((a) => !SECTIONS.includes(a));
const run = (name: string): boolean => sections.length === 0 || sections.includes(name);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

/** A steady wind toward (dirX, dirZ), no gusts. */
function setWind(mps: number, dirX: number, dirZ: number): void {
  weather.windX = dirX;
  weather.windZ = dirZ;
  weather.windMps = mps;
  weather.windMeanMps = mps;
  weather.gustIntensity = 0;
}

interface Pose {
  x: number;
  heading: number;
  speed: number;
  yawRate: number;
  /** Velocity across the body, +right (+X at heading 0). */
  vRight: number;
  /** Rapier's chassis mass, kg. */
  mass: number;
}

function pose(rig: Rig): Pose {
  const body = rig.vehicle.chassis;
  const p = body.translation();
  const q = body.rotation();
  const lv = body.linvel();
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const rz = 2 * (q.x * q.z - q.w * q.y);
  return {
    x: p.x,
    heading: Math.atan2(fx, fz),
    speed: Math.hypot(lv.x, lv.z),
    yawRate: body.angvel().y,
    vRight: lv.x * rx + lv.z * rz,
    mass: body.mass(),
  };
}

interface Internals {
  steerAngle: number;
}

/**
 * Sign that turns a positive "turn toward +X" command into the road-wheel angle
 * `steeringInputForWheelAngle` takes. Probed, not assumed.
 */
let turnSign = 0;
async function probeTurnSign(): Promise<void> {
  const rig = await makeRig('sv_vaz2106');
  drive(rig, 4, (_, f) => {
    f.throttle = Math.max(0, Math.min(1, (6 - pose(rig).speed) * 0.5));
    f.steer = 0;
  });
  const before = pose(rig).heading;
  drive(rig, 1, (_, f) => {
    f.steer = rig.vehicle.steeringInputForWheelAngle(0.08);
  });
  turnSign = pose(rig).heading > before ? 1 : -1;
  rig.vehicle.dispose();
}

/** Speed hold: PI on throttle, the same signal's other half on the brake. */
function speedHold(): (rig: Rig, f: Rig['input'], targetMps: number) => number {
  let integral = 0;
  return (rig, f, target) => {
    const s = pose(rig).speed;
    const error = target - s;
    integral = Math.max(-1, Math.min(1, integral + error * FIXED_DT * 0.05));
    const u = 0.15 * error + integral;
    f.throttle = Math.max(0, Math.min(1, u));
    f.brake = Math.max(0, Math.min(1, -0.5 * u));
    return error;
  };
}

/** Lane hold onto x = 0, heading 0: heading loop inside a lateral loop with integral. */
function laneHold(): (rig: Rig, f: Rig['input']) => void {
  let integral = 0;
  return (rig, f) => {
    const s = pose(rig);
    integral = Math.max(-20, Math.min(20, integral + s.x * FIXED_DT));
    const headingCmd = -(0.025 * s.x + 0.006 * integral);
    const turn = 0.12 * (headingCmd - s.heading) - 0.03 * s.yawRate;
    f.steer = rig.vehicle.steeringInputForWheelAngle(turnSign * turn);
  };
}

// ---------------------------------------------------------------------------
// loads
// ---------------------------------------------------------------------------

const GRADE_DEG = -4;
const LOAD_SPEEDS_KMH = [30, 100, 130, 160];

function axleLoads(rig: Rig): { front: number; rear: number } {
  let front = 0;
  let rear = 0;
  for (const w of rig.vehicle.wheelRide) {
    if (w.isFront) front += w.loadN;
    else rear += w.loadN;
  }
  return { front, rear };
}

async function loads(id: string): Promise<void> {
  const rig = await makeRig(id, (p) => addInclineGround(p, GRADE_DEG, SurfaceType.Asphalt, 4000));
  setWind(0, 1, 0);
  let staticFront = 0;
  let staticRear = 0;
  for (const w of rig.vehicle.wheelRide) {
    if (w.isFront) staticFront += w.staticLoadN;
    else staticRear += w.staticLoadN;
  }
  const hold = speedHold();
  const lane = laneHold();
  const rows: ({ front: number; rear: number } | null)[] = [];
  for (const kmh of LOAD_SPEEDS_KMH) {
    const target = kmh / 3.6;
    let steady = 0;
    let elapsed = 0;
    let sumF = 0;
    let sumR = 0;
    let n = 0;
    let done = false;
    while (!done && elapsed < 90) {
      drive(rig, FIXED_DT, (_, f) => {
        const error = hold(rig, f, target);
        lane(rig, f);
        steady = Math.abs(error) < 0.3 ? steady + FIXED_DT : 0;
        if (steady > 4) {
          const l = axleLoads(rig);
          sumF += l.front;
          sumR += l.rear;
          n++;
          if (steady > 7) done = true;
        }
      });
      elapsed += FIXED_DT;
    }
    rows.push(done ? { front: sumF / n, rear: sumR / n } : null);
  }
  rig.vehicle.dispose();
  const ref = rows[0];
  const cell = (r: { front: number; rear: number } | null): string => {
    if (!r || !ref) return '            —            '.padStart(30);
    const df = r.front - ref.front;
    const dr = r.rear - ref.rear;
    return (
      `${df >= 0 ? '+' : ''}${df.toFixed(0)} (${((df / staticFront) * 100).toFixed(1)}%) / ` +
      `${dr >= 0 ? '+' : ''}${dr.toFixed(0)} (${((dr / staticRear) * 100).toFixed(1)}%)`
    ).padStart(30);
  };
  console.log(
    `${id.padEnd(14)} ${staticFront.toFixed(0).padStart(5)}/${staticRear.toFixed(0).padEnd(5)}` +
      rows.slice(1).map(cell).join(''),
  );
}

// ---------------------------------------------------------------------------
// cross
// ---------------------------------------------------------------------------

const CROSS_KMH = 100;
const CROSS_WINDS = [10, 15, 24];

interface CrossRun {
  /** Lateral offset and heading change at +1, +2, +3 s, frozen steering. */
  drift: { x: number; heading: number }[];
  /** First-tick side load, g, and yaw acceleration, rad/s². */
  onsetG: number;
  onsetYawAcc: number;
  /** Extra road-wheel angle the lane hold settles on, deg; worst |x| after onset, m. */
  steerDeg: number;
  worstX: number;
}

async function crossRun(id: string, windMps: number): Promise<CrossRun> {
  // Shared approach: lane held, speed held, in still air.
  const approach = async (): Promise<Rig> => {
    const rig = await makeRig(id, (p) => addGround(p, SurfaceType.Asphalt));
    setWind(0, 1, 0);
    const hold = speedHold();
    const lane = laneHold();
    drive(rig, 40, (_, f) => {
      hold(rig, f, CROSS_KMH / 3.6);
      lane(rig, f);
    });
    return rig;
  };

  // Hands off: steering frozen at the calm hold's last input, speed still held.
  const handsOff = async (wind: number): Promise<{ x: number; heading: number }[]> => {
    const rig = await approach();
    const hold = speedHold();
    const steer = rig.input.steer;
    const start = pose(rig);
    setWind(wind, 1, 0);
    const out: { x: number; heading: number }[] = [];
    for (let s = 0; s < 3; s++) {
      drive(rig, 1, (_, f) => {
        hold(rig, f, CROSS_KMH / 3.6);
        f.steer = steer;
      });
      const p = pose(rig);
      out.push({ x: p.x - start.x, heading: p.heading - start.heading });
    }
    rig.vehicle.dispose();
    setWind(0, 1, 0);
    return out;
  };
  const calm = await handsOff(0);
  const windy = await handsOff(windMps);
  const drift = windy.map((w, i) => ({ x: w.x - calm[i]!.x, heading: w.heading - calm[i]!.heading }));

  // Onset: one tick of still air, one tick of wind, lateral and yaw acceleration.
  const rig = await approach();
  const hold = speedHold();
  const lane = laneHold();
  const internals = rig.vehicle as unknown as Internals;
  const tick = (): void =>
    drive(rig, FIXED_DT, (_, f) => {
      hold(rig, f, CROSS_KMH / 3.6);
      lane(rig, f);
    });
  const p0 = pose(rig);
  tick();
  const p1 = pose(rig);
  setWind(windMps, 1, 0);
  tick();
  const p2 = pose(rig);
  const calmAcc = (p1.vRight - p0.vRight) / FIXED_DT;
  const windAcc = (p2.vRight - p1.vRight) / FIXED_DT;
  const calmYaw = (p1.yawRate - p0.yawRate) / FIXED_DT;
  const windYaw = (p2.yawRate - p1.yawRate) / FIXED_DT;

  // Lane held through it: calm angle before, settled angle after, worst excursion.
  let calmAngle = 0;
  let worstX = 0;
  const startX = pose(rig).x;
  // The calm angle is the approach's own, sampled over its last second in a twin.
  {
    const twin = await approach();
    const tw = twin.vehicle as unknown as Internals;
    const th = speedHold();
    const tl = laneHold();
    let n = 0;
    drive(twin, 2, (_, f) => {
      th(twin, f, CROSS_KMH / 3.6);
      tl(twin, f);
      calmAngle += tw.steerAngle;
      n++;
    });
    calmAngle /= n;
    twin.vehicle.dispose();
    setWind(windMps, 1, 0);
  }
  let settled = 0;
  let n = 0;
  drive(rig, 14, (t, f) => {
    hold(rig, f, CROSS_KMH / 3.6);
    lane(rig, f);
    worstX = Math.max(worstX, Math.abs(pose(rig).x - startX));
    if (t >= 12) {
      settled += internals.steerAngle;
      n++;
    }
  });
  settled /= n;
  rig.vehicle.dispose();
  setWind(0, 1, 0);
  return {
    drift,
    onsetG: (windAcc - calmAcc) / GRAVITY,
    onsetYawAcc: windYaw - calmYaw,
    steerDeg: deg(Math.abs(settled - calmAngle)),
    worstX,
  };
}

async function cross(id: string): Promise<void> {
  for (const wind of CROSS_WINDS) {
    const r = await crossRun(id, wind);
    const drift = r.drift
      .map((d) => `${d.x.toFixed(2).padStart(5)} m ${deg(d.heading).toFixed(2).padStart(5)}°`)
      .join('  ');
    console.log(
      `${id.padEnd(14)} ${String(wind).padStart(2)} m/s  ${drift}   ` +
        `${r.onsetG.toFixed(3)} g ${r.onsetYawAcc.toFixed(3).padStart(6)} rad/s²   ` +
        `${r.steerDeg.toFixed(2)}° ${r.worstX.toFixed(2)} m`,
    );
  }
}

// ---------------------------------------------------------------------------
// gusts
// ---------------------------------------------------------------------------

const GUST_DT = 0.05;
const GUST_SECONDS = 1200;

interface GustSeries {
  along: Float64Array;
  across: Float64Array;
  intensity: number;
  mean: number;
}

/**
 * The wind a point sees over GUST_SECONDS of a held episode: the component along the
 * frame's mean direction and the one across it. `speedMps` > 0 moves the point across
 * the mean wind at that speed, as a car on a road at right angles to it.
 */
function gustSeries(seed: number, kind: 'wind' | 'haboob', hold: number, speedMps: number): GustSeries {
  updateWeather(seed, 0, GUST_DT, 0, 0);
  forceWeather(kind, hold, 1e6);
  const n = Math.round(GUST_SECONDS / GUST_DT);
  const along = new Float64Array(n);
  const across = new Float64Array(n);
  const out = { x: 0, z: 0 };
  let x = 1500;
  let z = -2500;
  let intensity = 0;
  let mean = 0;
  // Ten seconds for the channels' fade-in, then the record.
  for (let i = -Math.round(10 / GUST_DT); i < n; i++) {
    const t = 10 + i * GUST_DT;
    updateWeather(seed, t, GUST_DT, x, z);
    windAt(x, z, out);
    if (i >= 0) {
      along[i] = out.x * weather.windX + out.z * weather.windZ;
      across[i] = out.z * weather.windX - out.x * weather.windZ;
      intensity += weather.gustIntensity / n;
      mean += weather.windMeanMps / n;
    }
    x += -weather.windZ * speedMps * GUST_DT;
    z += weather.windX * speedMps * GUST_DT;
  }
  forceWeather(null);
  return { along, across, intensity, mean };
}

function stats(a: Float64Array): { mean: number; sigma: number } {
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  let variance = 0;
  for (const v of a) variance += (v - mean) * (v - mean);
  return { mean, sigma: Math.sqrt(variance / a.length) };
}

/** Integral time scale: the autocorrelation integrated to its first zero, seconds. */
function integralScale(a: Float64Array): number {
  const { mean, sigma } = stats(a);
  let sum = 0;
  for (let lag = 0; lag < a.length / 4; lag++) {
    let c = 0;
    for (let i = 0; i + lag < a.length; i++) c += (a[i]! - mean) * (a[i + lag]! - mean);
    const rho = c / ((a.length - lag) * sigma * sigma);
    if (rho <= 0) break;
    sum += rho * GUST_DT;
  }
  return sum;
}

/** Highest 3 s running mean over the record's mean: the gust factor an anemometer reports. */
function gustFactor(a: Float64Array): number {
  const w = Math.round(3 / GUST_DT);
  let run = 0;
  let peak = -Infinity;
  for (let i = 0; i < a.length; i++) {
    run += a[i]!;
    if (i >= w) run -= a[i - w]!;
    if (i >= w - 1) peak = Math.max(peak, run / w);
  }
  return peak / stats(a).mean;
}

/**
 * Share of the variance a quarter-second running mean removes: what the series holds
 * above ~2 Hz (the boxcar's half-power point; its first null is at 4 Hz).
 */
function highShare(a: Float64Array): number {
  const w = Math.round(0.25 / GUST_DT);
  const residual = new Float64Array(a.length - w);
  let run = 0;
  for (let i = 0; i < w; i++) run += a[i]!;
  for (let i = w; i < a.length; i++) {
    // The window is a[i - w] .. a[i - 1]; its middle sample is a[i - ceil(w / 2)].
    residual[i - w] = a[i - Math.ceil(w / 2)]! - run / w;
    run += a[i]! - a[i - w]!;
  }
  return stats(residual).sigma ** 2 / stats(a).sigma ** 2;
}

function gusts(): void {
  const cases = [
    { kind: 'wind' as const, hold: 0.5, label: "'wind' episode" },
    { kind: 'haboob' as const, hold: 0.45, label: 'haboob' },
  ];
  for (const c of cases) {
    for (const speed of [0, CROSS_KMH / 3.6]) {
      const s = gustSeries(7, c.kind, c.hold, speed);
      const u = stats(s.along);
      const v = stats(s.across);
      const iu = u.sigma / u.mean;
      const iv = v.sigma / u.mean;
      const share = highShare(s.along);
      const where = speed > 0 ? `driving ${CROSS_KMH} km/h` : 'standing';
      console.log(
        `${c.label.padEnd(15)} ${where.padEnd(17)} mean ${u.mean.toFixed(1)} m/s (asked ${s.mean.toFixed(1)})  ` +
          `σu/U ${iu.toFixed(3)} σv/U ${iv.toFixed(3)} (asked ${s.intensity.toFixed(3)}, ${(0.75 * s.intensity).toFixed(3)})  ` +
          `gust factor ${gustFactor(s.along).toFixed(2)}  T ${integralScale(s.along).toFixed(2)} s  ` +
          `above 2 Hz ${(share * 100).toFixed(1)}%`,
      );
      check(
        `${c.label}, ${where}: σu, σv on the asked intensity`,
        Math.abs(iu / s.intensity - 1) < 0.25 && Math.abs(iv / (0.75 * s.intensity) - 1) < 0.3,
        `${iu.toFixed(3)} / ${s.intensity.toFixed(3)}, ${iv.toFixed(3)} / ${(0.75 * s.intensity).toFixed(3)}`,
      );
      check(`${c.label}, ${where}: a push, not a buzz`, share < 0.05, `${(share * 100).toFixed(1)}% of σ² above ~2 Hz`);
    }
  }
  const a = gustSeries(7, 'wind', 0.5, 20);
  const b = gustSeries(7, 'wind', 0.5, 20);
  const c = gustSeries(8, 'wind', 0.5, 20);
  let same = true;
  let differs = 0;
  for (let i = 0; i < a.along.length; i++) {
    if (a.along[i] !== b.along[i] || a.across[i] !== b.across[i]) same = false;
    if (Math.abs(a.along[i]! - c.along[i]!) > 0.5) differs++;
  }
  check('same seed, same gusts', same, 'two runs bit for bit');
  check('another seed, other gusts', differs > a.along.length / 4, `${differs} of ${a.along.length} samples apart by > 0.5 m/s`);
  setWind(0, 1, 0);
}

// ---------------------------------------------------------------------------

const LOAD_MODELS = ['sv_gaz21', 'sv_vaz2106', 'sv_vaz2102', 'sv_vaz2108', 'sv_niva', 'sa_oka', 'sa_uaz330364', 'sa_izh2715', 'gt_vaz2110'];
const CROSS_MODELS = ['sv_gaz21', 'sv_vaz2106', 'sv_vaz2108', 'sa_oka', 'sa_uaz330364', 'sa_izh2715', 'gt_vaz2110'];

const loadModels = ids.length > 0 ? ids : LOAD_MODELS;
const crossModels = ids.length > 0 ? ids : CROSS_MODELS;
await preloadCarModels([...new Set([...loadModels, ...crossModels, 'sv_vaz2106'])]);
await probeTurnSign();

if (run('loads')) {
  console.log(
    `--- loads: axle load change from 30 km/h, front / rear, N (% of static), ${-GRADE_DEG}° downgrade ---`,
  );
  console.log(
    `model          static F/R  ${LOAD_SPEEDS_KMH.slice(1).map((k) => `${k} km/h`.padStart(30)).join('')}`,
  );
  for (const id of loadModels) await loads(id);
}

if (run('cross')) {
  console.log(`\n--- cross: ${CROSS_KMH} km/h, steady crosswind toward +X (+ = downwind, nose downwind) ---`);
  console.log('model          wind     hands off: drift, heading at +1 / +2 / +3 s          onset load, yaw acc   lane held: extra steer, worst x');
  for (const id of crossModels) await cross(id);
}

if (run('gusts')) {
  console.log('\n--- gusts: the field at a point, 20 minutes of a held episode, seed 7 ---');
  gusts();
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
