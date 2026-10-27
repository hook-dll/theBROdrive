/**
 * JELLY BODY (`Settings.jellyBody`): the car's body flexes like early BeamNG — it
 * leans and squats behind the chassis with a springy overshoot, rocks over rough
 * ground as the suspension articulates, and shivers after a knock or a landing.
 * Drawn only: nothing in the simulation reads anything here.
 *
 * HOW IT IS DRAWN. One affine matrix on the car's body subtree (vehicle.ts `bodyGroup`,
 * everything render/carmodel.ts `createCarModel` cloned except the wheels), composed
 * over the body's own rest transform each frame. No shader, material, geometry or draw
 * is added: the program count is unchanged, and so is every material key (see
 * .omp/rules/shader-variants.md). That rules the alternatives out rather than the other
 * way round:
 * - a vertex-shader bend needs PER-CAR uniforms on every material a body draws, and a
 *   body's trim, chrome, lenses, steering wheel and cabin cargo are materials SHARED by
 *   every car of the model (only paint, glass and sticker decals are per car): either
 *   each of those is cloned per car, or the trim stays rigid while the paint bends
 *   under it. Every car material family would also gain a patched variant to compile.
 * - front/rear pivot groups would need the body cut in two, and `buildTemplate` merges
 *   it into a few meshes that run nose to tail (`mergeStaticBodyMeshes`, the kit's one
 *   skinned mesh per material).
 * Everything a body carries rides the matrix with it, so nothing slides: the sticker
 * decals hang under the body node (render/stickerdecals.ts `DecalLayer`), as do the
 * glass, the lenses, a kit car's doors and bones, the steering wheel and the cabin
 * cargo. The wheels are children of the car's root, not of the body, so they stay round
 * on their hubs and the body moves over them like more suspension travel.
 *
 * WHAT AN AFFINE MATRIX CAN BEND. About a pivot on the floor of the body at the
 * chassis centre (so the sills stay over the wheels and the roof does the moving), in
 * chassis metres with q the point relative to that pivot:
 *
 *     x' = (1 + sx) x + shearX qy + skew qz      roof sways sideways; nose swings
 *     y' = (1 + sy) qy + roll x  + pitch qz      a side or an end dips; squash
 *     z' = (1 + sz) qz + shearZ qy               roof surges fore and aft
 *
 * A TRUE TORSION — front rolled one way, rear the other — is y += t·x·z, which no
 * matrix holds. The diagonal suspension travel is still read (`sampleStep`), and drives
 * a roll of its own at a quicker rate than the cornering lean: the body rocks onto the
 * diagonal the rear axle is carrying, which is the part of the twist the chase camera,
 * sitting behind the car, would see. Rough ground reads as the body working on its
 * springs.
 *
 * THE SPRINGS. Each channel is one under-damped spring chasing a target derived from
 * the chassis, stepped in CLOSED FORM (`advanceSpring`): for a target held over the
 * frame the result is exact at any frame length, so a 30 fps and a 144 fps machine
 * draw the same wobble. Targets are sampled once per fixed physics step, from the
 * interpolation snapshots the car already keeps (no extra physics query); impulses —
 * a landing, a knock — are added straight to a spring's velocity.
 *
 * - lean (`lagX`, `lagZ`): the chassis's own acceleration in its frame, in g, low-passed
 *   over `accelSmoothS` and clamped. The roof lags behind it (shear), the outside of a
 *   turn and the nose under braking dip (roll, pitch). Faded out in the air, where the
 *   acceleration is gravity's and a lean would be a drift.
 * - yaw skew: the yaw acceleration, so a flick of the wheel throws the nose and tail
 *   the other way for a moment.
 * - twist: see above.
 * - heave: the vertical acceleration — squashed by a bump, stretched in free fall —
 *   plus a kick on landing.
 * - shiver: a fast, lightly damped squash-and-stretch kicked by impacts and landings.
 *
 * All outputs are clamped twice, the spring state and the final shape, so no input —
 * a crash at speed, a teleport, a frame hitch — can fold a car in on itself.
 *
 * WHO GETS ONE. Cars drawn near only (vehicle.ts `syncVisuals`): a car drawn mid or
 * far is not sampled, and its body goes back to its rest matrix. Seen from inside the
 * car (the eye within the body's measured box: the cabin view, the bonnet view) the
 * flex fades to `cabinGain`, because the camera is fixed to the rigid chassis and a
 * cabin swaying around a still eye is seasickness, not jelly. Off is one boolean per
 * car per frame: the body's matrix goes back to auto-update and nothing here runs.
 *
 * `__bro.jelly` (dev) is `JELLY_TUNING` itself: every number below can be changed live.
 */

import * as THREE from 'three';

/** Standard gravity, m/s², for the accelerations in g. */
const G = 9.81;

/**
 * Every gain, rate and clamp of the flex, mutable for the dev handle (`__bro.jelly`).
 * Rates in Hz with a damping ratio ζ (critical is 1; 0.25 overshoots ~44% once and
 * rings two or three times). Kick gains are the PEAK they produce, so a tuner reads
 * "per m/s" directly instead of "per m/s divided by the spring's ω".
 */
export const JELLY_TUNING = {
  /** Master gain on the whole shape; 0 draws the rest body (the setting is the real off). */
  gain: 1,
  /** What the flex fades to while the eye is inside the car's own body. */
  cabinGain: 0,
  /** Seconds the fade between the two takes. */
  cabinFadeS: 0.3,

  /** Low-pass on the chassis acceleration before it becomes a target, seconds. */
  accelSmoothS: 0.05,
  /** Lean springs: the body's lag behind the chassis. */
  lagHz: 1.6,
  lagDamping: 0.26,
  /** Largest acceleration a lean target follows, g; the state may overshoot to 1.5×. */
  lagMaxG: 1.2,
  /** Roof sideways shift per metre of height per g, and fore/aft. */
  shearPerG: 0.05,
  longShearPerG: 0.035,
  /** Side dip (y per metre across) per g of lateral, and end dip per g of longitudinal. */
  rollPerG: 0.03,
  pitchPerG: 0.022,
  /** Lean kick per m/s of an impact's unexplained speed change, as peak g. */
  impactLeanPerMps: 0.25,

  /** Yaw skew spring: nose and tail thrown wide by a flick. */
  yawHz: 2.2,
  yawDamping: 0.25,
  /** Skew (x per metre along) per rad/s² of yaw acceleration. */
  skewPerRadS2: 0.008,
  skewMax: 0.03,

  /** Twist spring: the rock onto the loaded diagonal. */
  twistHz: 2.8,
  twistDamping: 0.2,
  /** Side dip per metre of diagonal suspension travel difference. */
  twistPerM: 0.35,
  twistMax: 0.035,

  /** Heave spring: squash under a bump, stretch in the air. */
  heaveHz: 3.2,
  heaveDamping: 0.3,
  /** Height fraction per g of vertical acceleration (negative squashes). */
  heavePerG: 0.035,
  heaveMax: 0.08,
  /** Landing: the fall speed at touchdown below which it does not kick, m/s. */
  landingFloorMps: 0.6,
  /** Squash peak per m/s of landing past the floor. */
  landingSquashPerMps: 0.018,

  /** Shiver: the fast decaying wobble after a knock or a landing. */
  shiverHz: 7.5,
  shiverDamping: 0.09,
  /** Shiver peak per m/s of an impact's severity or a landing past the floor. */
  shiverPerMps: 0.008,
  shiverMax: 0.05,
};

/** One spring: state, its velocity, and what it chases. */
interface Spring {
  x: number;
  v: number;
  target: number;
}

function spring(): Spring {
  return { x: 0, v: 0, target: 0 };
}

/**
 * Steps `s` by `dt` toward its target in closed form: the exact solution of
 * x'' = −ω²(x − target) − 2ζω x' with the target held over the step. ζ must be < 1.
 * `limit` clamps the state, and a velocity still pushing past the clamp is dropped.
 */
function advanceSpring(s: Spring, dt: number, hz: number, zeta: number, limit: number): void {
  const w = Math.PI * 2 * hz;
  const z = Math.min(Math.max(zeta, 0), 0.99);
  const wd = w * Math.sqrt(1 - z * z);
  const decay = Math.exp(-z * w * dt);
  const c = Math.cos(wd * dt);
  const sn = Math.sin(wd * dt);
  const e = s.x - s.target;
  const v = s.v;
  s.x = s.target + decay * (e * c + ((v + z * w * e) / wd) * sn);
  s.v = decay * (v * c - ((z * w * v + w * w * e) / wd) * sn);
  if (s.x > limit) {
    s.x = limit;
    if (s.v > 0) s.v = 0;
  } else if (s.x < -limit) {
    s.x = -limit;
    if (s.v < 0) s.v = 0;
  }
}

/** Adds a kick whose free response peaks near `peak` (v = peak·ω). */
function kick(s: Spring, peak: number, hz: number): void {
  s.v += peak * Math.PI * 2 * hz;
}

function clamp(value: number, limit: number): number {
  return value > limit ? limit : value < -limit ? -limit : value;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _w = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const _prevInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();

/** No samples for this long (a parked car whose step stopped): the targets let go. */
const STALE_SAMPLE_S = 0.15;

/** One car's flex. Owned by its `Vehicle`; see the module comment. */
export class JellyBody {
  private readonly lagX = spring();
  private readonly lagZ = spring();
  private readonly yaw = spring();
  private readonly twist = spring();
  private readonly heave = spring();
  private readonly shiver = spring();
  /** Last step's chassis velocity (world) and body-frame yaw rate; valid once primed. */
  private readonly lastVel = new THREE.Vector3();
  private lastYawRate = 0;
  private primed = false;
  /** Low-passed body-frame acceleration, m/s², and yaw acceleration, rad/s². */
  private readonly accel = new THREE.Vector3();
  private yawAccel = 0;
  private sinceSample = 0;
  /**
   * The fastest the chassis fell while every wheel was off the ground, m/s; spent on the
   * first step a wheel touches. A landing is soaked up by the springs over several
   * steps, so no single step's speed change measures it.
   */
  private fallMps = 0;
  /** The eased inside-the-car fade, 0..1 of the full flex. */
  private view = 1;

  /** Back to rest, with no memory of the last motion: after a teleport or going far. */
  reset(): void {
    for (const s of [this.lagX, this.lagZ, this.yaw, this.twist, this.heave, this.shiver]) {
      s.x = 0;
      s.v = 0;
      s.target = 0;
    }
    this.primed = false;
    this.accel.set(0, 0, 0);
    this.yawAccel = 0;
    this.sinceSample = 0;
    this.fallMps = 0;
  }

  /**
   * Reads one fixed step: the chassis's two latched poses either side of it (`prevPos`
   * → `pos`, world metres), the share of wheels on the ground, the diagonal suspension
   * travel difference (metres, see vehicle.ts `sampleJelly`), and the step's impact if
   * the car was hit (severity m/s and the unit chassis-frame direction it came FROM).
   */
  sampleStep(
    dt: number,
    prevPos: THREE.Vector3,
    pos: THREE.Vector3,
    prevQuat: THREE.Quaternion,
    quat: THREE.Quaternion,
    grounded: number,
    diagonalM: number,
    impact: { readonly severityMps: number; readonly localX: number; readonly localZ: number } | null,
  ): void {
    const t = JELLY_TUNING;
    this.sinceSample = 0;
    _inv.copy(quat).invert();
    const vel = _v.subVectors(pos, prevPos).divideScalar(dt);
    // Body-frame angular velocity from the step's rotation, small-angle: 2·dq.xyz / dt.
    _dq.multiplyQuaternions(quat, _prevInv.copy(prevQuat).invert());
    const sign = _dq.w < 0 ? -2 : 2;
    const yawRate = _w.set(_dq.x * sign, _dq.y * sign, _dq.z * sign).divideScalar(dt).applyQuaternion(_inv).y;
    if (!this.primed) {
      this.lastVel.copy(vel);
      this.lastYawRate = yawRate;
      this.primed = true;
      return;
    }
    const a = _a.subVectors(vel, this.lastVel).divideScalar(dt).applyQuaternion(_inv);
    const rawYawAccel = (yawRate - this.lastYawRate) / dt;
    this.lastVel.copy(vel);
    this.lastYawRate = yawRate;

    // A landing kicks rather than leans, so the raw vertical feeding the heave target is
    // clamped harder than the horizontal.
    let landingMps = 0;
    if (grounded === 0) {
      this.fallMps = Math.max(this.fallMps, -vel.y);
    } else if (this.fallMps > 0) {
      landingMps = this.fallMps - t.landingFloorMps;
      this.fallMps = 0;
    }
    const k = t.accelSmoothS > 0 ? 1 - Math.exp(-dt / t.accelSmoothS) : 1;
    this.accel.x += (clamp(a.x, 3 * G) - this.accel.x) * k;
    this.accel.y += (clamp(a.y, 1.5 * G) - this.accel.y) * k;
    this.accel.z += (clamp(a.z, 3 * G) - this.accel.z) * k;
    this.yawAccel += (clamp(rawYawAccel, 20) - this.yawAccel) * k;

    this.lagX.target = clamp(this.accel.x / G, t.lagMaxG) * grounded;
    this.lagZ.target = clamp(this.accel.z / G, t.lagMaxG) * grounded;
    this.yaw.target = clamp(-t.skewPerRadS2 * this.yawAccel, t.skewMax) * grounded;
    // Rear-led: a compressed rear wheel lifts its own side (see the module comment).
    this.twist.target = clamp(-t.twistPerM * diagonalM, t.twistMax);
    this.heave.target = clamp(-t.heavePerG * (this.accel.y / G), t.heaveMax);

    if (landingMps > 0) {
      kick(this.heave, -t.landingSquashPerMps * landingMps, t.heaveHz);
      kick(this.shiver, -t.shiverPerMps * landingMps, t.shiverHz);
    }
    if (impact) {
      // The chassis was knocked AWAY from where the blow came from: the lean the
      // acceleration would have built over a spring period arrives in one step.
      const lean = t.impactLeanPerMps * impact.severityMps;
      kick(this.lagX, -lean * impact.localX, t.lagHz);
      kick(this.lagZ, -lean * impact.localZ, t.lagHz);
      kick(this.shiver, -t.shiverPerMps * impact.severityMps, t.shiverHz);
    }
  }

  /**
   * Steps every spring by the frame's `dt`, eases the inside-the-car fade toward
   * `inside`, and writes the deformation about the floor pivot (`pivotY`, chassis
   * metres) into `out`, in the frame of the body's parent (the car's root).
   */
  advance(dt: number, inside: boolean, pivotY: number, out: THREE.Matrix4): THREE.Matrix4 {
    const t = JELLY_TUNING;
    this.sinceSample += dt;
    if (this.sinceSample > STALE_SAMPLE_S) {
      // Nothing is stepping this car: let go of the last motion instead of holding it.
      this.lagX.target = this.lagZ.target = this.yaw.target = this.twist.target = this.heave.target = 0;
      this.primed = false;
    }
    const lagLimit = t.lagMaxG * 1.5;
    advanceSpring(this.lagX, dt, t.lagHz, t.lagDamping, lagLimit);
    advanceSpring(this.lagZ, dt, t.lagHz, t.lagDamping, lagLimit);
    advanceSpring(this.yaw, dt, t.yawHz, t.yawDamping, t.skewMax * 1.5);
    advanceSpring(this.twist, dt, t.twistHz, t.twistDamping, t.twistMax * 1.5);
    advanceSpring(this.heave, dt, t.heaveHz, t.heaveDamping, t.heaveMax * 1.5);
    this.shiver.target = 0;
    advanceSpring(this.shiver, dt, t.shiverHz, t.shiverDamping, t.shiverMax);

    const fadeTo = inside ? t.cabinGain : 1;
    const step = t.cabinFadeS > 0 ? dt / t.cabinFadeS : 1;
    this.view += clamp(fadeTo - this.view, step);
    const gain = t.gain * this.view;

    // The lean's signs are frame-free: a chassis accelerating toward +x leaves its roof
    // toward −x (shear), and lifts the side it accelerates toward (y += k·a·x), which
    // is the outside of a turn dipping; the same along z dips the nose under braking.
    const shearLimit = t.shearPerG * lagLimit;
    const shearX = clamp(-t.shearPerG * this.lagX.x, shearLimit) * gain;
    const shearZ = clamp(-t.longShearPerG * this.lagZ.x, shearLimit) * gain;
    const roll = clamp(t.rollPerG * this.lagX.x + this.twist.x, t.rollPerG * lagLimit + t.twistMax) * gain;
    const pitch = clamp(t.pitchPerG * this.lagZ.x, t.pitchPerG * lagLimit) * gain;
    const skew = this.yaw.x * gain;
    const sy = clamp(this.heave.x + this.shiver.x, t.heaveMax + t.shiverMax) * gain;
    const sxz = -0.5 * sy;

    // Rows of the linear part, then the translation that keeps the pivot (0, pivotY, 0)
    // where it is: t = P − A·P, and only A's y column meets P.
    const a11 = 1 + sy;
    out.set(
      1 + sxz, shearX, skew, -shearX * pivotY,
      roll, a11, pitch, pivotY - a11 * pivotY,
      0, shearZ, 1 + sxz, -shearZ * pivotY,
      0, 0, 0, 1,
    );
    return out;
  }
}
