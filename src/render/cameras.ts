import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { nearPlaneForFarPlane } from '../core/renderer';
import {
  DEFAULT_FIELD_OF_VIEW,
  FIELD_OF_VIEW_MAX,
  FIELD_OF_VIEW_MIN,
  type CameraStyle,
} from '../game/settings';
import { WorldOrigin, type RebaseShift } from '../world/origin';

export type CameraMode = 'foot' | 'hood' | 'chase';

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speedKmh: number;
  /** Mean micro-bump amplitude under the loaded wheels, metres; 0 on foot. */
  surfaceRoughness: number;
  /** Fraction of the wheels on the ground, 0..1; 0 on foot. */
  wheelContact: number;
  /** Bonnet camera mount in chassis-local metres; see CarModelMeasure.hoodPoint. */
  hoodOffset: readonly [number, number, number];
  /**
   * Velocity in the float frame, X and Z, m/s. Zero on foot.
   *
   * Read only by the dynamic camera: its DIRECTION is what a slip angle is — the
   * angle between where the car points and where it is actually going — and its rate
   * of change, projected on the car's side axis, is the lateral acceleration the lean
   * is built from.
   */
  velocityX: number;
  velocityZ: number;
}

/* ---- tuning ---- */

/** Mouse pitch clamp, radians. Keeps the view from flipping over the poles. */
const PITCH_LIMIT = 1.45;
/** Standing eye height above the player position, metres. */
const EYE_HEIGHT = 1.62;
/** How far ahead of the eye the spring's look-at point sits. */
const LOOK_AHEAD = 12;
/**
 * Follow stiffness (rad/s). A critically damped first-order approach with
 * `exp(-omega*dt)` is frame-rate independent and can never overshoot — that is
 * what avoids rubber-banding behind a hard-braking car. (Naive `lerp` with a
 * constant factor changes its rate with frame rate and rings when overdriven.)
 */
const SPRING_OMEGA = 12;
/**
 * Re-centre ease rate (rad/s). A deliberate snap behind the car, but `exp`
 * decay eases in and out instead of teleporting — same frame-rate-independent
 * form as SPRING_OMEGA. Faster than the follow spring so a keypress reads as
 * instant, not as the camera slowly slinking around.
 */
const RECENTER_OMEGA = 8;
/** Yaw/pitch error (rad) below which a re-centre counts as done (~0.06 deg). */
const RECENTER_EPSILON = 1e-3;
/** Chase view waits this long after the last horizontal look input before following the car. */
const CHASE_RECENTER_IDLE_SECONDS = 6;
/** Automatic horizontal return is gentler than the explicit V-key snap. */
const CHASE_RECENTER_OMEGA = 2;
/** Ignore sub-pixel touch jitter when deciding whether horizontal look is active. */
const CHASE_LOOK_ACTIVITY_EPSILON = 1e-3;
/**
 * Log-distance added per wheel notch. Distance is `exp(logDistance)`, so a notch
 * always multiplies distance by a fixed factor, which keeps the near end of the
 * range from crawling while the far end teleports.
 */
const ZOOM_SENSITIVITY = 0.25;
const DIST_MIN = 1.5;
/** Furthest the chase arm may stand from the car, metres. */
const DIST_MAX = 7;
/**
 * Elevation of the arm over the car's centre, radians.
 *
 * This is the whole composition, because the arm always aims back at that centre: the eye's
 * height above it IS the view's depression angle, so the frame's horizon lands at
 * `(1 - tan(armPitch) / tan(fov / 2)) / 2` of the frame height from the top, whatever the
 * car or the ground under it does. At 0.189 the horizon sits at 35% at rest and 36% at
 * speed — the road fills the lower two thirds of the frame while the sky still reads as
 * sky. It was 0.22, which put the horizon at 32%: the frame was closer to looking down AT
 * the car than down the road. `tools/chase-framing.ts` drives a real car over real ground
 * and holds the band this sits in.
 */
const ARM_PITCH_BASE = 0.189;
/** How far short of an occluder to stop the chase camera, metres. */
const OCCLUSION_SKIN = 0.3;
/**
 * Ground clearance for the chase eye, metres, and the probe that finds the
 * ground beneath it.
 *
 * The probe starts just above the CAR (see liftAboveGround) and must stay under
 * any roof the car can drive under — the garage's walls are 2.7 m, so half a metre
 * over the body's own origin is the headroom this can afford. It reaches well down
 * so the arm can hang out over a dune's lee side and still find the sand.
 */
const GROUND_CLEARANCE = 0.45;
const GROUND_PROBE_UP = 0.5;
const GROUND_PROBE_DOWN = 40;
/**
 * Speed widening, degrees added to the resting FOV at `FOV_FULL_SPEED`.
 *
 * This was an absolute ceiling of 70 — `BASE_FOV + 14` before that, which is 79 degrees
 * vertical, 111 horizontal at 16:9, wider than the chase view of any racing game, and a
 * rectilinear projection stretches the picture along the frame's radius by
 * `1 / cos²(angle)`: 3.15x at the frame edge against the authored 65's 2.28x. Five
 * degrees is what carries the speed cue without the outer frame turning into a fisheye.
 * Measured: the car shrinks from 17% of the frame height at rest to 9% at 130 km/h with
 * the old ceiling and to ~10% with five — the widening and the arm's own speed lag
 * together, and this bounds the widening's share of it.
 *
 * RELATIVE rather than absolute now that the resting view is a player setting: an
 * absolute 70 would silently mean fourteen degrees of widening for someone at 56 and
 * none at all for someone at 85, so the speed cue would depend on a taste it has
 * nothing to do with.
 */
const FOV_SPEED_WIDENING = 5;
/**
 * Speed (km/h) at which the speed-FOV widening is fully applied. 160 rather than the 130
 * it was, because most cars top out between 130 and 170: at 130 the view stopped
 * changing for the whole top of the range.
 */
const FOV_FULL_SPEED = 160;
const FOV_OMEGA = 6;
/** Ten-power binoculars: the view is the resting FOV divided by this. */
const BINOCULAR_POWER = 10;
const FOV_EPSILON = 0.01;
const BOB_AMP = 0.035;
const BOB_FREQ = 9;
/**
 * THE SURGE: the chase arm stretches while the car gains speed and shortens while it
 * sheds it, then settles back once the speed holds.
 *
 * The follow spring alone cannot give this. It lags the car by `v / SPRING_OMEGA`, a
 * pure SPEED term, and its acceleration term is `a / SPRING_OMEGA²` — two centimetres at
 * a Lada's full-throttle 3 m/s². So the pull-back is written down explicitly, from the
 * speed's own rate of change, as a fraction of the arm the player zoomed to.
 *
 * It is a transient on purpose: a longer arm at steady speed is a smaller car and less
 * ground near the lens, which reads as SLOWER. Proportional to the arm so a close camera
 * surges as visibly as a far one.
 */
const SURGE_STRETCH_PER_MPS2 = 0.06;
/** Longest the surge may stretch the arm (+20%, 1.2 m at the default 6 m). */
const SURGE_PULL_MAX = 0.2;
/** Furthest braking may pull the arm in (-10%): a stamp on the brakes nods the view forward. */
const SURGE_PUSH_MAX = 0.1;
/**
 * How quickly the surge follows the measured acceleration (rad/s, tau ~0.4 s). Slow
 * enough that a gear change reads as a breath rather than a jolt, and that the speed's
 * fixed-step staircase under a faster presentation never reaches the camera.
 */
const SURGE_OMEGA = 2.5;
/** Measured accelerations past this (m/s²) are a crash or a teleport, not a surge. */
const SURGE_ACCEL_CLAMP = 12;
/**
 * THE SWAY: a slow float of the driving view at speed, which is what is left to say
 * "fast" once acceleration has settled — the wind and the dashes are then the only cues.
 *
 * It grows with the SQUARE of speed from `SHAKE_START_KMH`, is scaled by the roughness
 * under the wheels and by how many of them are on the ground (a car in the air does not
 * vibrate), and is a ROTATION of the view rather than a displacement of the eye: the same
 * angle moves every pixel of the frame, a displacement only the near ones. Three
 * incommensurate sines per axis keep it from ever reading as a period. It is applied
 * after the springs, to the camera only, so interaction rays still use the steady view.
 *
 * SLOW on purpose, 0.5 to 2 Hz. It began as a 3-13 Hz tremble, and there was no
 * amplitude at which that worked: big enough to see was a judder the eye flinched at,
 * small enough not to was invisible. A car at speed floats on its springs rather than
 * buzzing, and a slow motion reads at a fraction of the angle a fast one needs.
 */
const SHAKE_START_KMH = 60;
/**
 * Where the sway stops growing: 300 km/h, above anything a car reaches even with a
 * swapped engine down a long straight (the stock catalogue tops out at 170, but a swap
 * can pin the 200 km/h dial). Below it the sway keeps rising with the square of speed.
 */
const SHAKE_FULL_KMH = 300;
/**
 * Peak angles at `SHAKE_FULL_KMH` on a surface of gain 1, radians, per axis. The sway is
 * mostly a slow roll and yaw with a little pitch — the owner's tuning by eye. At 130 km/h
 * that is 0.031 / 0.076 / 0.081 degrees of pitch / yaw / roll; at 150, 0.052 / 0.126 /
 * 0.134; at 200, 0.125 / 0.307 / 0.326. (Tuned as a 360 km/h ceiling with 0.01 rad pitch
 * and 2.45 / 2.6 shares, which is the same curve below 300: `t²` scales by a constant
 * when the ceiling moves.)
 */
const SHAKE_PITCH_RAD = 0.0064;
const SHAKE_YAW_RAD = 0.01568;
const SHAKE_ROLL_RAD = 0.01664;
/**
 * Surface gain: `SHAKE_SMOOTH_GAIN` on a glass-smooth road, rising to 2 at
 * `SHAKE_ROUGH_FULL` of `SurfaceDef.roughness`. That spreads the real surfaces out —
 * concrete 0.68, asphalt 0.77, sand 1.3, cracked asphalt 1.44, gravel 1.86, rock 2 —
 * instead of saturating everything past cracked asphalt.
 */
const SHAKE_SMOOTH_GAIN = 0.6;
const SHAKE_ROUGH_FULL = 0.1;
/* ---- dynamic camera: `CameraStyle.dynamic`; zero effect in steady ---- */

/**
 * Share of the slip angle the chase heading follows, and its cap.
 *
 * A share rather than the whole angle: the camera should LOOK along the direction of
 * travel enough that oversteer reads in the frame, not so much that it becomes a
 * velocity vector shot. 0.4 of a 20-degree slide moves the view 8 degrees, which is
 * visible in the frame without the car leaving the third it occupies; the slip is
 * capped at 26 degrees first, so a spin never swings the view past about 10.
 */
const SLIP_LOOK_SHARE = 0.4;
const SLIP_LOOK_MAX_RAD = 0.45;
/**
 * Speed band over which the slip angle is trusted, m/s.
 *
 * Below `SLIP_MIN` the velocity heading is noise — a car creeping at 1 m/s has a
 * direction that flickers with the last centimetre of steering — so the term fades in
 * rather than switching on, and at a standstill it is exactly zero.
 */
const SLIP_MIN_SPEED_MPS = 2.5;
const SLIP_FULL_SPEED_MPS = 10;
/**
 * Follow stiffness of the dynamic chase heading, rad/s.
 *
 * Faster than the steady camera's automatic recentre (2) so the view is tracking the
 * car through the corner rather than arriving after it — the lag that makes the slide
 * visible is this omega's, not a timer's. Still well under the position spring's 12,
 * because a heading that snapped would show the slide as a cut.
 */
const DYNAMIC_FOLLOW_OMEGA = 3.4;
/**
 * Lateral eye offset per m/s² of measured lateral acceleration, metres, and its cap.
 *
 * The road's ordinary bends pull 1.5-2.5 m/s², so the gain is set for those: 0.05 m
 * per m/s² is 0.1 m in a bend (about a degree of the car's place in the frame at the
 * chase distance) and reaches the 0.35 m cap at 7 m/s², a hard corner. Less than that
 * and the lean is only there in a slide; a lean you cannot see is not a lean.
 */
const LEAN_PER_MPS2 = 0.05;
const LEAN_MAX_M = 0.35;
/**
 * The lean is a critically damped spring: position and velocity, closed form, so it is
 * exact at any frame rate and can never overshoot into a wobble.
 */
const LEAN_OMEGA = 5;
/** Measured accelerations past this are a crash or a teleport, not a corner. */
const LEAN_ACCEL_CLAMP = 14;
/**
 * Share of the body's roll the bonnet view takes, and its cap, radians.
 *
 * The mount is rigid, so it already inherits the roll's TRANSLATION; this is the part
 * of the rotation the steady view deliberately withholds (see `desiredHood`). Capped
 * well under a real body-roll angle, because a bonnet camera bolted to a rolling
 * chassis is nauseating at full fidelity.
 */
const HOOD_ROLL_SHARE = 0.6;
const HOOD_ROLL_MAX_RAD = 0.1;
/**
 * Look-into-corner: radians of view yaw at full lock, and the speed at which it is
 * gone (km/h).
 *
 * At walking pace the camera should point where the wheels point, because that is where
 * the car is about to go and the driver is watching the parking space rather than the
 * road. The moment the car is actually turning, the follow spring is doing that job, so
 * this hands over by `STEER_LOOK_FADE_KMH`.
 */
const STEER_LOOK_MAX_RAD = 0.2;
const STEER_LOOK_FADE_KMH = 40;

/** Death first turns the existing view down, then lifts it while the screen fades. */
const DEATH_LOOK_DOWN_SECONDS = 2.5;
const DEATH_RISE_SECONDS = 6.5;
const DEATH_TOTAL_SECONDS = DEATH_LOOK_DOWN_SECONDS + DEATH_RISE_SECONDS;
const DEATH_RISE_METRES = 40;

/* ---- module-level scratch: `update()` must not allocate ---- */
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _mA = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);
const _FORWARD = new THREE.Vector3(0, 0, 1);
const _rayOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: 0, z: 0 };
const _qB = new THREE.Quaternion();
const _eA = new THREE.Euler();
/** Output of `springStep`, written in place so the camera path allocates nothing. */
const _spring = { position: 0, velocity: 0 };

/**
 * One step of a critically damped spring from (`position`, `velocity`) toward
 * `target`, exact for any step because it is the closed form rather than an
 * integration: it can neither overshoot nor change its own rate with the frame rate.
 */
function springStep(
  position: number,
  velocity: number,
  target: number,
  omega: number,
  dt: number,
): void {
  const offset = position - target;
  const decay = Math.exp(-omega * dt);
  _spring.position = target + (offset + (velocity + omega * offset) * dt) * decay;
  _spring.velocity = (velocity - omega * (velocity + omega * offset) * dt) * decay;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

const LOG_MIN = Math.log(DIST_MIN);
const LOG_MAX = Math.log(DIST_MAX);


function wrapAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped > Math.PI
    ? wrapped - Math.PI * 2
    : wrapped < -Math.PI
      ? wrapped + Math.PI * 2
      : wrapped;
}

export class CameraRig {
  /** Driving-view selection survives a trip on foot; `mode` reports foot while walking. */
  private _mode: Exclude<CameraMode, 'foot'> = 'chase';
  private onFoot = true;

  private yawValue = 0;
  private pitch = 0;
  private logDistance = Math.log(6);
  /** Driving look survives while the shared yaw/pitch fields drive the foot camera. */
  private drivingYaw = 0;
  private drivingPitch = 0;
  /** Last non-vertical vehicle heading; used only for explicit view transitions/recentre. */
  private vehicleYaw = 0;

  /** Smoothed camera state — the only values exposed to the outside world. */
  private readonly eye = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  /**
   * The resting vertical FOV this rig returns to, and `tan` of its half — the divisor
   * that makes the arm's elevation coupling exact at the resting view.
   */
  private baseFov = DEFAULT_FIELD_OF_VIEW;
  private baseHalfTan = Math.tan((DEFAULT_FIELD_OF_VIEW * Math.PI) / 360);
  private fov = DEFAULT_FIELD_OF_VIEW;

  private bobTime = 0;
  /** True while a V re-centre ease runs; cancelled by any mouse look. */
  private recentering = false;
  /** World-space heading captured when an external-camera re-centre begins. */
  private recenterYaw = 0;
  /** Seconds since the last chase-camera horizontal look input. */
  private chaseLookIdle = 0;
  /** Hood view heading relative to the car; the mount turns with the chassis. */
  private hoodYawOffset = 0;
  /** Ten-power binocular view: a held-item effect, independent of the camera mode. */
  private binoculars = false;
  private deathActive = false;
  private deathElapsed = 0;
  private readonly deathStartEye = new THREE.Vector3();
  private readonly deathStartQuaternion = new THREE.Quaternion();
  private readonly deathDownQuaternion = new THREE.Quaternion();
  /** Smoothed rate of change of speed, m/s²; drives the chase arm's surge. */
  private surge = 0;
  /** Last frame's speed, m/s, for measuring `surge`. */
  private surgeSpeedMps = 0;
  /** Clock of the speed shake's sines, seconds. */
  private shakeTime = 0;
  /** `Settings.cameraShake`. */
  private shake = true;
  /** `Settings.cameraStyle`. Steady is what this rig has always been. */
  private style: CameraStyle = 'steady';
  /** Slip angle the chase heading follows, radians; zero in steady. */
  private slipAngle = 0;
  /** Low-passed measured lateral acceleration, m/s², along the car's local +X (its left). */
  private lateralAccel = 0;
  /**
   * Last solver velocity seen, m/s, and the render time since it changed, seconds; the
   * measurement above is its rate of change. NaN until the first sample of a drive.
   */
  private lastVelX = Number.NaN;
  private lastVelZ = Number.NaN;
  private velAge = 0;
  /** Lateral eye offset, metres (positive toward the car's local +X, its left), and its velocity. */
  private leanOffset = 0;
  private leanVelocity = 0;
  /** Look-into-corner yaw, radians; zero in steady. */
  private steerLook = 0;
  /** Body roll carried into the bonnet view, radians; zero in steady. */
  private hoodRoll = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    origin: WorldOrigin,
    fieldOfView = DEFAULT_FIELD_OF_VIEW,
  ) {
    this.setFieldOfView(fieldOfView);
    origin.register(this);
  }

  /**
   * Sets the resting vertical FOV, from the pause menu, with no reload.
   *
   * The live `fov` follows it by the same difference rather than snapping, so a slider
   * drag moves the view it is describing instead of jumping to rest: the speed widening
   * and the binocular view are both derived from the resting value, and a player
   * dragging this at 100 km/h keeps his widening while he does it.
   */
  setFieldOfView(degrees: number): void {
    const next = Math.min(FIELD_OF_VIEW_MAX, Math.max(FIELD_OF_VIEW_MIN, degrees));
    this.fov += next - this.baseFov;
    this.baseFov = next;
    this.baseHalfTan = Math.tan((next * Math.PI) / 360);
  }

  /** `Settings.cameraShake`: whether the driving view trembles at speed. */
  setShake(on: boolean): void {
    this.shake = on;
  }

  /**
   * `Settings.cameraStyle`. Applied in place, and entering `steady` clears every
   * dynamic term, so the steady camera is the camera this rig has always been rather
   * than one that has just stopped moving.
   */
  setStyle(style: CameraStyle): void {
    if (style === 'steady') this.resetDynamics();
    this.style = style;
  }

  /** Every measured term back to rest; see `setStyle` and the snap points below. */
  private resetDynamics(): void {
    this.slipAngle = 0;
    this.lateralAccel = 0;
    this.lastVelX = Number.NaN;
    this.lastVelZ = Number.NaN;
    this.velAge = 0;
    this.leanOffset = 0;
    this.leanVelocity = 0;
    this.steerLook = 0;
    this.hoodRoll = 0;
  }

  /**
   * Rebasable: shift every relative position this rig keeps across frames by the
   * frame step, so the camera stays glued to the world. Y is a height, untouched by
   * the origin.
   */
  rebase(shift: RebaseShift): void {
    this.eye.x -= shift.dx;
    this.eye.z -= shift.dz;
    this.lookAt.x -= shift.dx;
    this.lookAt.z -= shift.dz;
    this.deathStartEye.x -= shift.dx;
    this.deathStartEye.z -= shift.dz;
  }

  get mode(): CameraMode {
    return this.onFoot ? 'foot' : this._mode;
  }
  /** On-foot view heading (0 = +Z, + = +X); drives camera-relative movement. */
  get yaw(): number {
    return this.yawValue;
  }

  get eyePosition(): { x: number; y: number; z: number } {
    return { x: this.eye.x, y: this.eye.y, z: this.eye.z };
  }


  /** Unit view direction of the *smoothed* camera, for interaction raycasts. */
  get eyeDirection(): { x: number; y: number; z: number } {
    _vC.subVectors(this.lookAt, this.eye).normalize();
    return { x: _vC.x, y: _vC.y, z: _vC.z };
  }

  setBinoculars(active: boolean): void {
    this.binoculars = active;
  }

  setMode(mode: CameraMode): void {
    // Foot is derived from `onFoot`; retaining the driving selection is what makes
    // a chase view and its zoom still be there after re-entering a car.
    if (mode !== 'foot') this._mode = mode;
  }

  /**
   * Forces the view heading. Only for placing the player at game start — during
   * play the mouse owns yaw, and overriding it mid-frame would fight the input.
   */
  setYaw(yaw: number): void {
    this.yawValue = yaw;
  }

  /**
   * Captures the live view once. From here until reload, mouse input is deliberately
   * absent from the camera path; the sequence owns both position and orientation.
   */
  beginDeath(): void {
    if (this.deathActive) return;
    this.deathActive = true;
    this.deathElapsed = 0;
    this.deathStartEye.copy(this.eye);
    this.deathStartQuaternion.copy(this.camera.quaternion);
    this.binoculars = false;
    this.recentering = false;

    // A camera looks along local -Z. This orientation maps that axis exactly onto
    // world -Y, with -Z as its screen-up direction so the pole is unambiguous.
    _vA.set(0, 0, 0);
    _vB.set(0, -1, 0);
    _vC.set(0, 0, -1);
    _mA.lookAt(_vA, _vB, _vC);
    this.deathDownQuaternion.setFromRotationMatrix(_mA);
  }

  /**
   * Advances the complete death camera. Returns the black-fade fraction: zero while
   * turning down, then the same smooth 0..1 curve used by the upward flight.
   */
  updateDeath(dt: number, target: CameraTarget): number {
    if (!this.deathActive) this.beginDeath();
    const d = dt > 0 ? dt : 1 / 60;
    this.deathElapsed = Math.min(DEATH_TOTAL_SECONDS, this.deathElapsed + d);

    const lookT = clamp(this.deathElapsed / DEATH_LOOK_DOWN_SECONDS, 0, 1);
    const lookSmooth = lookT * lookT * (3 - 2 * lookT);
    const riseT = clamp(
      (this.deathElapsed - DEATH_LOOK_DOWN_SECONDS) / DEATH_RISE_SECONDS,
      0,
      1,
    );
    const riseSmooth = riseT * riseT * (3 - 2 * riseT);

    this.eye.set(
      this.deathStartEye.x + (target.x - this.deathStartEye.x) * riseSmooth,
      this.deathStartEye.y + DEATH_RISE_METRES * riseSmooth,
      this.deathStartEye.z + (target.z - this.deathStartEye.z) * riseSmooth,
    );
    this.camera.quaternion.slerpQuaternions(
      this.deathStartQuaternion,
      this.deathDownQuaternion,
      lookSmooth,
    );
    this.camera.position.copy(this.eye);
    _vD.set(0, 0, -LOOK_AHEAD).applyQuaternion(this.camera.quaternion);
    this.lookAt.copy(this.eye).add(_vD);
    this.updateFov(0, d);
    return riseSmooth;
  }

  get deathComplete(): boolean {
    return this.deathActive && this.deathElapsed >= DEATH_TOTAL_SECONDS;
  }

  /**
   * Scripted (cutscene) camera: the pose arrives already resolved, in the relative
   * frame, and no input, spring, occlusion or ground probe touches it.
   *
   * Same contract as `updateDeath` — this path OWNS position and orientation for as
   * long as it keeps being called — with one difference: a cutscene is composed, so
   * the field of view belongs to the shot instead of following the speed. `fovDeg`
   * overrides the resting view for this frame and is approached at the same rate the
   * driving view uses, so a cut from a wide shot to a long lens reads as a slow push
   * rather than a jump. The near plane is kept in step with the far plane exactly as
   * `updateFov` keeps it.
   *
   * Nothing latches: a cutscene that ends in a reload never hands the camera back, and
   * `deathActive` is deliberately left alone, so a death part-way through one still
   * has its own sequence to run.
   */
  updateScripted(dt: number, eye: THREE.Vector3, lookAt: THREE.Vector3, fovDeg: number): void {
    const d = dt > 0 ? dt : 1 / 60;
    this.eye.copy(eye);
    this.lookAt.copy(lookAt);
    // A zero-length look direction has no orientation; keep the previous heading by
    // pushing the target a metre ahead of the eye rather than letting lookAt() emit NaN.
    if (this.lookAt.distanceToSquared(this.eye) < 1e-8) this.lookAt.z = this.eye.z - 1;
    _mA.lookAt(this.eye, this.lookAt, _UP);
    this.camera.quaternion.setFromRotationMatrix(_mA);
    this.camera.position.copy(this.eye);

    this.fov += (fovDeg - this.fov) * (1 - Math.exp(-FOV_OMEGA * d));
    const targetNear = nearPlaneForFarPlane(this.camera.far);
    let projectionChanged = false;
    if (Math.abs(this.fov - this.camera.fov) > FOV_EPSILON) {
      this.camera.fov = this.fov;
      projectionChanged = true;
    }
    if (this.camera.near !== targetNear) {
      this.camera.near = targetNear;
      projectionChanged = true;
    }
    if (projectionChanged) this.camera.updateProjectionMatrix();
  }

  /**
   * C swaps the two driving views: the bonnet mount and the follow arm.
   *
   * Entering the hood view aims it down the car, because a bonnet camera left
   * pointing wherever the chase arm happened to be is disorienting: the mount is
   * rigid, so the mismatch reads as the car having spun rather than the view.
   */
  cycleDriving(): void {
    this._mode = this._mode === 'chase' ? 'hood' : 'chase';
    if (this._mode === 'hood') this.yawValue = this.vehicleYaw;
  }

  update(dt: number, input: InputFrame, target: CameraTarget, onFoot: boolean): void {
    const d = dt > 0 ? dt : 1 / 60;

    // Entering/exiting a vehicle is the one legitimate snap point: teleporting
    // between a vehicle and a standing pose must not spring-in (a fly-through).
    if (onFoot !== this.onFoot) {
      if (onFoot) {
        // `snapFoot` must reuse yaw/pitch for camera-relative walking, so retain the
        // driving heading first. Otherwise looking around on foot overwrites where
        // the chase camera was aimed even though its zoom survives.
        this.drivingYaw = this.yawValue;
        this.drivingPitch = this.pitch;
        this.onFoot = true;
        this.snapFoot(target);
      } else {
        this.onFoot = false;
        this.yawValue = this.drivingYaw;
        this.pitch = this.drivingPitch;
        this.snapDriving(target);
      }
    }

    const inputMode: CameraMode = onFoot ? 'foot' : this._mode;
    if (!onFoot) this.updateVehicleYaw(target);
    // The dynamic camera reads the car's own motion; steady leaves every term it
    // writes at zero, which is what keeps that camera exactly what it was.
    if (onFoot) this.resetDynamics();
    else if (this.style === 'dynamic') this.updateDynamics(d, input, target);

    // The hood mount turns with the car, so its heading is stored as an OFFSET from
    // the chassis and rebuilt against the live heading every frame. Keeping the raw
    // world yaw instead would leave the view pointing at the horizon it started on
    // while the car drove around underneath it.
    if (inputMode === 'hood') {
      this.yawValue = wrapAngle(this.vehicleYaw + this.hoodYawOffset);
    }

    // `input.lookYaw` is rightward mouse motion. Forward is (sin y, cos y) and up is
    // +Y, so right is forward x up = (-cos y, sin y): rotating rightward therefore
    // *decreases* yaw. Hence the subtraction — getting this sign wrong inverts look.
    this.yawValue -= input.lookYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, -PITCH_LIMIT, PITCH_LIMIT);

    // Chase yaw stays where the player left it for six seconds after meaningful
    // horizontal input, then eases toward the live vehicle heading. Touchscreens
    // can emit tiny coordinate noise after a drag; treating any non-zero float as
    // activity lets that noise postpone recentering forever.
    // Vertical look is independent: it neither recentres pitch nor resets this timer.
    const horizontalLookActive = Math.abs(input.lookYaw) >= CHASE_LOOK_ACTIVITY_EPSILON;
    if (inputMode === 'chase') {
      this.chaseLookIdle = horizontalLookActive ? 0 : this.chaseLookIdle + d;
    } else {
      this.chaseLookIdle = 0;
    }

    // Re-centre (V): level pitch and, in an external view, ease toward the
    // vehicle heading captured on the press frame so the car lands directly ahead.
    // It uses the same frame-rate-independent decay as the position springs and
    // never overshoots. Live mouse look cancels it so the ease cannot fight the
    // player; settling below RECENTER_EPSILON completes it. On foot yaw is the
    // movement basis (WASD is camera-relative, see player.ts), so there re-centre
    // only levels the horizon instead of spinning the player under them.
    //
    // The heading both paths follow is the car's own, plus the slip angle the dynamic
    // style shows; in steady the second term is exactly zero.
    const followYaw = wrapAngle(this.vehicleYaw + this.slipAngle);
    const followOmega = this.style === 'dynamic' ? DYNAMIC_FOLLOW_OMEGA : CHASE_RECENTER_OMEGA;
    if (this.recentering && (input.lookYaw !== 0 || input.lookPitch !== 0)) {
      this.recentering = false;
    }
    if (input.recenterCamera) {
      this.recentering = true;
      // Capture once: even a re-centre in progress must not inherit a wreck's spin.
      this.recenterYaw = onFoot ? 0 : followYaw;
    }
    if (this.recentering) {
      const k = 1 - Math.exp(-RECENTER_OMEGA * d);
      this.pitch += (0 - this.pitch) * k;
      if (!onFoot) this.yawValue += wrapAngle(this.recenterYaw - this.yawValue) * k;
      const yawError = wrapAngle(this.recenterYaw - this.yawValue);
      const settled =
        Math.abs(this.pitch) < RECENTER_EPSILON &&
        (onFoot || Math.abs(yawError) < RECENTER_EPSILON);
      if (settled) {
        this.pitch = 0;
        if (!onFoot) this.yawValue = this.recenterYaw;
        this.recentering = false;
      }
    }

    if (
      inputMode === 'chase' &&
      !this.recentering &&
      this.chaseLookIdle >= CHASE_RECENTER_IDLE_SECONDS
    ) {
      const yawError = wrapAngle(followYaw - this.yawValue);
      if (Math.abs(yawError) < RECENTER_EPSILON) {
        this.yawValue = followYaw;
      } else {
        const k = 1 - Math.exp(-followOmega * d);
        this.yawValue = wrapAngle(this.yawValue + yawError * k);
      }
    }

    // Whatever look, re-centre or snap did to the world yaw this frame is the hood
    // view's new offset from the car. Recording it here, once, is what keeps the two
    // representations from disagreeing on the next frame.
    if (inputMode === 'hood') {
      this.hoodYawOffset = wrapAngle(this.yawValue - this.vehicleYaw);
    }

    // Wobble phases. Bob only advances while moving, so it freezes at rest.
    const moveMag = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    if (moveMag > 1e-3) this.bobTime += d;

    // The surge measures the speed's own rate of change; see SURGE_STRETCH_PER_MPS2.
    // Speed is |forward|, so reversing harder surges the same way driving off does.
    const speedMps = target.speedKmh / 3.6;
    const accel = clamp(
      (speedMps - this.surgeSpeedMps) / d,
      -SURGE_ACCEL_CLAMP,
      SURGE_ACCEL_CLAMP,
    );
    this.surgeSpeedMps = speedMps;
    this.surge += (accel - this.surge) * (1 - Math.exp(-SURGE_OMEGA * d));
    this.shakeTime += d;

    // Zoom drives the chase arm only; the hood mount has no arm to lengthen.
    if (input.zoomDelta !== 0 && !onFoot && this._mode === 'chase') {
      this.logDistance = clamp(
        this.logDistance + input.zoomDelta * ZOOM_SENSITIVITY,
        LOG_MIN,
        LOG_MAX,
      );
    }

    const mode: CameraMode = onFoot ? 'foot' : this._mode;

    switch (mode) {
      case 'foot':
        this.desiredFoot(target, moveMag);
        break;
      case 'hood':
        this.desiredHood(target);
        break;
      case 'chase':
        this.desiredArm(target);
        this.applyOcclusion(target);
        this.liftAboveGround(target);
        break;
    }

    // The chase camera springs only its eye. Its look point is the current,
    // interpolated chassis centre: springing it by the same rule leaves it metres
    // behind a fast car, visibly pinning the view to the rear rather than its centre.
    // The foot camera springs both ends of its view ray.
    //
    // The hood camera springs NEITHER. It is bolted to the bonnet, so any lag turns
    // into the mount sliding around on a panel it is supposed to be bolted to.
    const k = 1 - Math.exp(-SPRING_OMEGA * d);
    if (mode === 'hood') {
      this.eye.copy(_vA);
      this.lookAt.copy(_vB);
    } else {
      this.eye.lerp(_vA, k);
      if (mode === 'chase') this.lookAt.copy(_vB);
      else this.lookAt.lerp(_vB, k);
    }

    _mA.lookAt(this.eye, this.lookAt, _UP);
    this.camera.quaternion.setFromRotationMatrix(_mA);
    // The dynamic style lets the bonnet view's horizon roll with the body, which is
    // the one thing the steady mount deliberately refuses (see `desiredHood`). Applied
    // about the view axis only, so the aim is untouched and just the frame turns.
    if (mode === 'hood' && this.hoodRoll !== 0) {
      this.camera.quaternion.multiply(_qB.setFromEuler(_eA.set(0, 0, this.hoodRoll, 'ZYX')));
    }
    if (mode !== 'foot' && this.shake) this.applyShake(target);
    // The camera sits in the relative scene graph, so its position is the relative
    // eye verbatim — no origin arithmetic here or at any consumer. The eye is built
    // from `target` (the car's or player's transform, already relative), and on a
    // rebase `rebase()` shifts eye and lookAt by the same frame step as the bodies,
    // so this copy stays correct with no conversion. `eyePosition` and
    // `eyeDirection` expose that same relative eye to interaction and spawn code,
    // which also live in the relative frame, so no absolute accessor is needed.
    this.camera.position.copy(this.eye);

    this.updateFov(target.speedKmh, d);
  }

  /* ---- desired pose per mode; each writes _vA = eye, _vB = look-at ---- */

  private desiredFoot(target: CameraTarget, moveMag: number): void {
    const bob = Math.sin(this.bobTime * BOB_FREQ) * BOB_AMP * moveMag;
    _vA.set(target.x, target.y + EYE_HEIGHT + bob, target.z);
    this.lookVector(_vD);
    _vB.copy(_vA).addScaledVector(_vD, LOOK_AHEAD);
  }

  /**
   * Bonnet mount: the eye rides the car's own hood point, rigidly.
   *
   * The mount POSITION inherits the full chassis rotation — that is what makes the
   * view rise over a crest and dip under braking — but the view DIRECTION is built
   * from yaw and pitch against world up, so the horizon never rolls with the body.
   * Rolling it is what makes an outside-mounted camera unreadable in a slide, and
   * unlike a driver's head there is no occupant here to justify the motion.
   */
  private desiredHood(target: CameraTarget): void {
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    _vC.set(target.hoodOffset[0], target.hoodOffset[1], target.hoodOffset[2]).applyQuaternion(_qA);
    _vA.set(target.x + _vC.x, target.y + _vC.y, target.z + _vC.z);
    this.lookVector(_vD);
    _vB.copy(_vA).addScaledVector(_vD, LOOK_AHEAD);
  }


  /**
   * Records a stable horizontal heading for explicit transitions. Near vertical,
   * the projected forward vector has no meaningful yaw, so keep the last good one.
   */
  private updateVehicleYaw(target: CameraTarget): void {
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    _vC.copy(_FORWARD).applyQuaternion(_qA);
    if (Math.hypot(_vC.x, _vC.z) > 1e-6) {
      this.vehicleYaw = Math.atan2(_vC.x, _vC.z);
    }
  }

  /**
   * The dynamic camera's read of the car: how far sideways it is really going, how
   * hard the tyres are pushing it there, and how far the body has rolled.
   *
   * All three are measurements of the CHASSIS, not of the driver's hands. That is the
   * point of the style: the framing shows what the car is doing, including the parts
   * nobody asked for — a slide the steering did not request is exactly the thing a
   * steady camera hides, because it holds the car's heading and not its path.
   *
   * The lateral acceleration is the world velocity's rate of change projected on the
   * body's side axis and low-passed, which is what a real accelerometer under the seat
   * would report; each sample is clamped first so a collision cannot fling the eye a
   * metre sideways for a frame.
   */
  private updateDynamics(dt: number, input: InputFrame, target: CameraTarget): void {
    const vx = target.velocityX;
    const vz = target.velocityZ;
    const speed = Math.hypot(vx, vz);
    // A slip angle at walking pace is noise, so the term fades in with speed instead
    // of switching on: the velocity heading of a car moving at 1 m/s is whichever way
    // the last centimetre of steering left it.
    const share = clamp(
      (speed - SLIP_MIN_SPEED_MPS) / (SLIP_FULL_SPEED_MPS - SLIP_MIN_SPEED_MPS),
      0,
      1,
    );
    this.slipAngle =
      clamp(wrapAngle(Math.atan2(vx, vz) - this.vehicleYaw), -SLIP_LOOK_MAX_RAD, SLIP_LOOK_MAX_RAD)
      * share * SLIP_LOOK_SHARE;

    // Body axes from the chassis quaternion. The car faces local +Z with +Y up, so its
    // local +X is the driver's LEFT; the lean below lives on that same axis.
    const qx = target.qx;
    const qy = target.qy;
    const qz = target.qz;
    const qw = target.qw;
    const sideX = 1 - 2 * (qy * qy + qz * qz);
    const sideZ = 2 * (qx * qz - qy * qw);
    // Acceleration is the WORLD velocity's rate of change projected on the side axis.
    // Differentiating the body-frame sideways speed instead reads zero in a steady
    // corner, because the centripetal part (speed × yaw rate) is exactly what turning
    // the axis with the car cancels. The velocity is the solver's, which only moves on
    // a physics step, so the difference is taken over the time since it last changed:
    // a render frame between steps is no measurement, not a zero one, and the result
    // is the same at any refresh rate.
    this.velAge += dt;
    if (Number.isNaN(this.lastVelX)) {
      this.lastVelX = vx;
      this.lastVelZ = vz;
      this.velAge = 0;
    } else if (vx !== this.lastVelX || vz !== this.lastVelZ) {
      const measured = clamp(
        ((vx - this.lastVelX) * sideX + (vz - this.lastVelZ) * sideZ) / this.velAge,
        -LEAN_ACCEL_CLAMP,
        LEAN_ACCEL_CLAMP,
      );
      this.lateralAccel += (measured - this.lateralAccel) * (1 - Math.exp(-LEAN_OMEGA * this.velAge));
      this.lastVelX = vx;
      this.lastVelZ = vz;
      this.velAge = 0;
    }

    // The eye leans OUT of the corner: the tyres push the car toward the turn's
    // centre, so the camera bolted to its outside edge travels the other way.
    springStep(
      this.leanOffset,
      this.leanVelocity,
      -clamp(this.lateralAccel * LEAN_PER_MPS2, -LEAN_MAX_M, LEAN_MAX_M),
      LEAN_OMEGA,
      dt,
    );
    this.leanOffset = _spring.position;
    this.leanVelocity = _spring.velocity;

    // Body roll against the horizon: the angle the car's own side axis makes with
    // level, which is the roll a passenger sees through the windscreen.
    const upY = 1 - 2 * (qx * qx + qz * qz);
    const sideY = 2 * (qx * qy + qz * qw);
    this.hoodRoll =
      clamp(-Math.atan2(sideY, upY), -HOOD_ROLL_MAX_RAD, HOOD_ROLL_MAX_RAD) * HOOD_ROLL_SHARE;

    this.steerLook =
      input.steer * STEER_LOOK_MAX_RAD * (1 - clamp(target.speedKmh / STEER_LOOK_FADE_KMH, 0, 1));
  }

  private desiredArm(target: CameraTarget): void {
    // External cameras use a WORLD-space view heading. The chassis contributes
    // position and speed only: yaw, pitch and roll can change arbitrarily during a
    // wreck without rotating the view. Mouse input is the sole continuous source
    // of external-camera orientation.
    //
    // Look-into-corner adds a bounded offset to that heading at low speed only; it is
    // exactly zero in steady and at any real speed, so the heading above is unchanged
    // there.
    const viewYaw = this.yawValue + this.steerLook;
    const viewX = Math.sin(viewYaw);
    const viewZ = Math.cos(viewYaw);

    // The chassis transform is the measured centre of the rendered model (see
    // render/carmodel.ts). Keep that point at the centre of the view at every
    // speed; leading the look target down the road made the chase camera appear
    // to pivot around one end of the car instead of around the car itself.
    _vB.set(target.x, target.y, target.z);

    // The arm points from the look target to the eye, opposite the view heading.
    // Pitch moves an orbiting eye opposite the requested look direction: mouse-up
    // lowers armPitch until the eye sits below the target and therefore looks up.
    const armPitch = this.armPitchForWidening() - this.pitch;
    const ca = Math.cos(armPitch);
    const sa = Math.sin(armPitch);
    _vD.set(-viewX * ca, sa, -viewZ * ca);

    const stretch = clamp(this.surge * SURGE_STRETCH_PER_MPS2, -SURGE_PUSH_MAX, SURGE_PULL_MAX);
    _vA.copy(_vB).addScaledVector(_vD, Math.exp(this.logDistance) * (1 + stretch));

    // The lean: sideways eye travel with the car's own body, out of the corner. The
    // offset is along the view's local +X horizontal (its left, as the car's), the same
    // axis the measurement was taken on; zero in steady and at rest.
    if (this.leanOffset !== 0) {
      _vA.x += this.leanOffset * Math.cos(viewYaw);
      _vA.z -= this.leanOffset * Math.sin(viewYaw);
    }
  }

  /** Turns the finished driving view by this frame's speed shake; see SHAKE_START_KMH. */
  private applyShake(target: CameraTarget): void {
    const t = clamp(
      (target.speedKmh - SHAKE_START_KMH) / (SHAKE_FULL_KMH - SHAKE_START_KMH),
      0,
      1,
    );
    if (t <= 0 || target.wheelContact <= 0) return;
    const rough = clamp(target.surfaceRoughness / SHAKE_ROUGH_FULL, 0, 1);
    const gain = SHAKE_SMOOTH_GAIN + (2 - SHAKE_SMOOTH_GAIN) * rough;
    const scale = t * t * gain * target.wheelContact;
    const w = this.shakeTime * Math.PI * 2;
    const pitch = 0.5 * Math.sin(w * 1.3) + 0.3 * Math.sin(w * 1.9 + 1.7) + 0.35 * Math.sin(w * 0.55 + 0.6);
    const yaw = 0.55 * Math.sin(w * 0.7 + 2.1) + 0.3 * Math.sin(w * 1.1 + 0.3) + 0.25 * Math.sin(w * 0.45 + 4.4);
    const roll = 0.5 * Math.sin(w * 0.9 + 4.0) + 0.3 * Math.sin(w * 1.7 + 2.6) + 0.3 * Math.sin(w * 0.6 + 1.1);
    _eA.set(pitch * SHAKE_PITCH_RAD * scale, yaw * SHAKE_YAW_RAD * scale, roll * SHAKE_ROLL_RAD * scale, 'YXZ');
    this.camera.quaternion.multiply(_qB.setFromEuler(_eA));
  }

  /**
   * Elevation of the arm for the FOV of the moment, radians.
   *
   * Where the horizon lands in the frame is `tan(armPitch) / tan(fov / 2)`, so a FIXED arm
   * elevation tilts the frame as the projection widens: over 65 to 70 degrees the horizon
   * drops from 35.0% to 36.3% from the top. Holding the RATIO constant instead keeps the
   * resting composition and spends the widening on the periphery, which is where a speed cue
   * belongs. It is small — the horizon's spread over a real drive is dominated by the ground
   * clearance probe lifting the eye, not by this — but it is exact and costs one multiply.
   *
   * Clamped so it only ever RAISES the arm. The binoculars drop the view to a tenth of the
   * resting FOV, and the exact form would sink the eye toward the car's own centre — a chase
   * view through the bodywork. Leaving the resting composition alone below the base FOV keeps
   * that effect exactly as it was; above it the FOV ceiling is the only bound.
   */
  private armPitchForWidening(): number {
    if (this.fov <= this.baseFov) return ARM_PITCH_BASE;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(this.fov) / 2);
    return Math.atan(Math.tan(ARM_PITCH_BASE) * (halfTan / this.baseHalfTan));
  }

  /**
   * Chase-only occlusion. Casts from the desired eye toward the car; static
   * geometry in between pulls the camera forward to just short of the hit.
   * The car's own (dynamic) collider is skipped — the rig has no car handle to
   * pass as `exclude`, so it filters by body type instead, which keeps the arm
   * from being permanently clamped to bumper distance.
   */
  private applyOcclusion(target: CameraTarget): void {
    _vC.set(target.x, target.y, target.z).sub(_vA);
    const dist = _vC.length();
    if (dist < 1e-6) return;
    _vC.divideScalar(dist);

    // `_vA` (the desired eye) is RELATIVE — it is built from the relative `target`
    // in desiredArm — and Rapier's bodies live in the same relative frame, so the
    // ray origin, the direction and the collider it may hit all agree with no
    // origin conversion. The same holds for the ground probe below.
    _rayOrigin.x = _vA.x;
    _rayOrigin.y = _vA.y;
    _rayOrigin.z = _vA.z;
    _rayDir.x = _vC.x;
    _rayDir.y = _vC.y;
    _rayDir.z = _vC.z;
    const hit = this.physics.raycast(_rayOrigin, _rayDir, dist);
    if (!hit) return;

    const collider = this.physics.world.getCollider(hit.colliderHandle);
    const body = collider.parent();
    if (body != null && !body.isFixed()) return; // the car / loose parts

    if (hit.toi > OCCLUSION_SKIN) {
      _vA.addScaledVector(_vC, hit.toi - OCCLUSION_SKIN);
    }
  }

  /**
   * Keeps the eye above the ground under it.
   *
   * `applyOcclusion` cannot do this: it casts along the arm TOWARD the car and
   * pulls the eye forward, so an eye that has dipped under the terrain gets pulled
   * to just under the terrain — still below it, and now looking out through the
   * inside of the ground. Pitching the chase camera down under the car did exactly
   * that, and the whole desert turned into a see-through shell.
   *
   * The probe therefore runs straight DOWN, which is the only direction that
   * answers "how low may I be here" — but it starts at the CAR's height, not above
   * the camera. Starting above the camera reads whatever is overhead as the floor:
   * measured in the garage, it found the roof and reported the ground 2.7 m above
   * the car, which would have flung the camera up through it. The car is known to
   * be standing in the space the camera belongs to, so its height is the one honest
   * place to start.
   *
   * Only fixed bodies count: the car and the loose parts are things to look at, not
   * floors to stand on. If the probe finds nothing — the camera is out past a crest
   * where the ground rises above the car — there is nothing to clamp to, and the
   * occlusion cast above has already dealt with that case.
   */
  private liftAboveGround(target: CameraTarget): void {
    _rayOrigin.x = _vA.x;
    _rayOrigin.y = target.y + GROUND_PROBE_UP;
    _rayOrigin.z = _vA.z;
    _rayDir.x = 0;
    _rayDir.y = -1;
    _rayDir.z = 0;

    const hit = this.physics.raycast(_rayOrigin, _rayDir, GROUND_PROBE_UP + GROUND_PROBE_DOWN);
    if (!hit) return;

    const collider = this.physics.world.getCollider(hit.colliderHandle);
    const body = collider.parent();
    if (body != null && !body.isFixed()) return;

    const floor = _rayOrigin.y - hit.toi + GROUND_CLEARANCE;
    if (_vA.y < floor) _vA.y = floor;
  }

  private updateFov(speedKmh: number, dt: number): void {
    const normalFov =
      this.baseFov + FOV_SPEED_WIDENING * clamp(speedKmh / FOV_FULL_SPEED, 0, 1);
    const targetFov = this.binoculars ? this.baseFov / BINOCULAR_POWER : normalFov;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-FOV_OMEGA * dt));
    const targetNear = nearPlaneForFarPlane(this.camera.far);
    let projectionChanged = false;
    if (Math.abs(this.fov - this.camera.fov) > FOV_EPSILON) {
      this.camera.fov = this.fov;
      projectionChanged = true;
    }
    if (this.camera.near !== targetNear) {
      this.camera.near = targetNear;
      projectionChanged = true;
    }
    if (projectionChanged) this.camera.updateProjectionMatrix();
  }

  /** Local-space look vector from yaw/pitch: 0 -> +Z, +pitch -> up, +yaw -> +X. */
  private lookVector(out: THREE.Vector3): void {
    const cp = Math.cos(this.pitch);
    out.set(Math.sin(this.yawValue) * cp, Math.sin(this.pitch), Math.cos(this.yawValue) * cp);
  }

  /** On exit: keep the driving view direction so the player steps out facing it. */
  private snapFoot(target: CameraTarget): void {
    _vC.subVectors(this.lookAt, this.eye);
    if (_vC.lengthSq() > 1e-8) {
      _vC.normalize();
      this.yawValue = Math.atan2(_vC.x, _vC.z);
      this.pitch = Math.asin(clamp(_vC.y, -1, 1));
    } else {
      this.pitch = 0;
    }
    this.eye.set(target.x, target.y + EYE_HEIGHT, target.z);
    this.lookAt.copy(this.eye).addScaledVector(_vC, LOOK_AHEAD);
    this.fov = this.baseFov;
    this.surge = 0;
    this.surgeSpeedMps = 0;
    // Stepping out ends the drive the dynamic terms were measuring; entering a car
    // must not start from the last one's lean.
    this.resetDynamics();
  }

  /** Snap into the remembered driving pose on entry, preserving its arm exactly. */
  private snapDriving(target: CameraTarget): void {
    this.updateVehicleYaw(target);
    this.surge = 0;
    this.surgeSpeedMps = target.speedKmh / 3.6;
    this.resetDynamics();
    if (this._mode === 'hood') {
      this.yawValue = wrapAngle(this.vehicleYaw + this.hoodYawOffset);
      this.desiredHood(target);
    } else {
      this.desiredArm(target);
      this.applyOcclusion(target);
      this.liftAboveGround(target);
    }
    this.eye.copy(_vA);
    this.lookAt.copy(_vB);
    this.fov = this.baseFov;
  }
}
