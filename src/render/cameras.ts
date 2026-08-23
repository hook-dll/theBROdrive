import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { CAMERA_BASE_FOV } from '../core/renderer';

export type CameraMode = 'foot' | 'interior' | 'chase' | 'orbit';

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speedKmh: number;
  /** Driver eye point in body-local space, used by the interior camera. */
  eyeOffset: readonly [number, number, number];
}

/* ---- tuning ---- */

/** Mouse pitch clamp, radians. Keeps the view from flipping over the poles. */
const PITCH_LIMIT = 1.45;
/** Standing eye height above the player position, metres. */
const EYE_HEIGHT = 1.62;
/** How far ahead of the eye the spring's look-at point sits (foot/interior). */
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
/**
 * Log-distance added per wheel notch. Distance is `exp(logDistance)`, so a
 * notch always multiplies distance by a fixed factor. That is the only way one
 * gesture can span 1.5 m to 300 m with even perceptual speed — linear zoom over
 * that range is either uselessly slow up close or teleports the far view.
 */
const ZOOM_SENSITIVITY = 0.25;
const DIST_MIN = 1.5;
const DIST_MAX = 300;
/** Upper chase distance; zooming past it hands the arm over to orbit. */
const CHASE_MAX = 14;
/** Constant elevation folded into the orbit pitch so the car hides no road. */
const ORBIT_PITCH_BASE = 0.22;
/** How far short of an occluder to stop the chase camera, metres. */
const OCCLUSION_SKIN = 0.3;
/**
 * Ground clearance for the chase/orbit eye, metres, and the probe that finds the
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
 * Resting FOV, shared with the initial camera in renderer.ts so the two cannot
 * disagree. 65 degrees on foot and in the car, matching The Long Drive.
 */
const BASE_FOV = CAMERA_BASE_FOV;
/**
 * Speed-widened ceiling. Kept at the same +14 degrees over the resting value that
 * it was before, so lowering the base changes where the camera sits at rest without
 * altering how much the view stretches when moving. Drop this to BASE_FOV to switch
 * the speed effect off entirely.
 */
const MAX_FOV = BASE_FOV + 14;
/** Speed (km/h) at which the speed-FOV widening is fully applied. */
const FOV_FULL_SPEED = 130;
const FOV_OMEGA = 6;
const FOV_EPSILON = 0.01;
/** Look-ahead lead per km/h; the look target drifts ahead of a fast car. */
const LEAD_PER_KMH = 0.02;
const LEAD_MAX = 6;
/** Lead fades in across this speed band so parking doesn't yaw the camera. */
const LEAD_FADE_START = 6;
const LEAD_FADE_END = 30;
const BOB_AMP = 0.035;
const BOB_FREQ = 9;
const SHAKE_MAX = 0.012;
/**
 * Interior g-force sway tuning. The eye must stay inside the cabin at all
 * times, so this is a small bounded offset from the body's fixed `eyePoint`
 * — never an integration of velocity or acceleration, which is what could
 * walk the eye out through the back of the cabin under sustained throttle.
 * Acceleration (not velocity) drives it because that is what inertia
 * actually is: a car holding a steady 100 km/h has zero g-force on the
 * driver, so keying the sway off speed/velocity would keep swaying on a
 * flat-out cruise and has no natural zero to decay back to; acceleration is
 * exactly zero at rest and at constant speed, which is what makes the
 * offset settle to zero instead of drifting.
 */
/** Sway offset clamp, metres, in any axis. About one seat-cushion's worth of
 *  lean — enough to read as weight transfer, never enough to reach the
 *  headrest or leave the cabin (the bug this replaces). */
const SWAY_MAX = 0.06;
/** Sway low-pass time constant, seconds. Long enough to smooth a kerb strike
 *  or gear-shift jolt out of the finite-differenced accel estimate; short
 *  enough that a real swerve or hard brake is still felt within a couple of
 *  frames. */
const SWAY_TAU = 0.2;
const SWAY_OMEGA = 1 / SWAY_TAU;
/** Acceleration, m/s^2, that fully saturates the clamp: ~0.5-0.6 g, i.e. a
 *  hard brake or a hard launch in this game's tuning. Ordinary hard driving
 *  should reach the full bounded sway, not require motorsport-grade g-force
 *  to ever be felt. */
const SWAY_ACCEL_FULL = 6;
const SWAY_GAIN = SWAY_MAX / SWAY_ACCEL_FULL;
/** Counter-roll clamp, radians (~2.9 deg) — a few degrees of bank into hard
 *  cornering, same "never reads as nausea" ceiling the old steer-based roll
 *  used. Driven by the same lateral-g estimate as the eye sway rather than
 *  steering angle, so holding full lock while parked doesn't lean the cabin. */
const SWAY_ROLL_MAX = 0.05;
const SWAY_ROLL_GAIN = SWAY_ROLL_MAX / SWAY_ACCEL_FULL;

const LOG_MIN = Math.log(DIST_MIN);
const LOG_MAX = Math.log(DIST_MAX);
const LOG_CHASE_MAX = Math.log(CHASE_MAX);

/* ---- module-level scratch: `update()` must not allocate ---- */
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _mA = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);
const _FORWARD = new THREE.Vector3(0, 0, 1);
const _rayOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: 0, z: 0 };

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class CameraRig {
  private _mode: CameraMode = 'foot';
  private onFoot = true;

  private yawValue = 0;
  private pitch = 0;
  private logDistance = Math.log(6);

  /** Smoothed camera state — the only values exposed to the outside world. */
  private readonly eye = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private fov = BASE_FOV;

  private bobTime = 0;
  private shakeTime = 0;
  /** True while a V re-centre ease runs; cancelled by any mouse look. */
  private recentering = false;

  /**
   * Interior sway state: previous frame's chassis position/local speeds for
   * the finite-difference accel estimate, the low-pass-filtered accel, and
   * the resulting bounded roll. `swayPrimed` skips the first post-reset
   * frame so a fresh finite difference is never taken against a stale (or
   * just-reset) previous position.
   */
  private readonly swayPrevPos = new THREE.Vector3();
  private swayPrevFwdSpeed = 0;
  private swayPrevLatSpeed = 0;
  private swayAccelLong = 0;
  private swayAccelLat = 0;
  private swayRoll = 0;
  private swayPrimed = false;
  /** True while the driving view was 'interior' last frame; edge-detects entry. */
  private wasInterior = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
  ) {}

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

  setMode(mode: CameraMode): void {
    this._mode = mode;
  }

  /**
   * Forces the view heading. Only for placing the player at game start — during
   * play the mouse owns yaw, and overriding it mid-frame would fight the input.
   */
  setYaw(yaw: number): void {
    this.yawValue = yaw;
  }

  /** interior -> chase -> orbit -> interior. Never snaps; the spring eases it. */
  cycleDriving(): void {
    this._mode =
      this._mode === 'interior' ? 'chase' : this._mode === 'chase' ? 'orbit' : 'interior';
  }

  update(dt: number, input: InputFrame, target: CameraTarget, onFoot: boolean): void {
    const d = dt > 0 ? dt : 1 / 60;

    // Entering/exiting a vehicle is the one legitimate snap point: teleporting
    // between a cabin and a standing pose must not spring-in (a fly-through).
    if (onFoot !== this.onFoot) {
      this.onFoot = onFoot;
      if (onFoot) {
        this._mode = 'foot';
        this.snapFoot(target);
      } else {
        if (this._mode === 'foot') this._mode = 'interior';
        this.snapInterior(target);
      }
    }

    // `input.lookYaw` is rightward mouse motion. Forward is (sin y, cos y) and up is
    // +Y, so right is forward x up = (-cos y, sin y): rotating rightward therefore
    // *decreases* yaw. Hence the subtraction — getting this sign wrong inverts look.
    this.yawValue -= input.lookYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, -PITCH_LIMIT, PITCH_LIMIT);

    // Re-centre (V): ease yaw/pitch back to 0 so chase/orbit lands directly
    // behind the car. Same exp(-omega*dt) decay the springs use — frame-rate
    // independent, never overshoots. Two conditions cancel an in-progress ease:
    // live mouse look (an ease must never fight the player; the press frame's
    // own deltas were already applied above, and any *further* motion stops it)
    // and a remaining error below RECENTER_EPSILON. On foot yaw is the movement
    // basis (WASD is camera-relative, see player.ts), so there re-centre only
    // levels the horizon — snapping foot yaw would spin the player under them.
    if (this.recentering && (input.lookYaw !== 0 || input.lookPitch !== 0)) {
      this.recentering = false;
    }
    if (input.recenterCamera) this.recentering = true;
    if (this.recentering) {
      const k = 1 - Math.exp(-RECENTER_OMEGA * d);
      this.pitch += (0 - this.pitch) * k;
      if (!onFoot) this.yawValue += (0 - this.yawValue) * k;
      const settled =
        Math.abs(this.pitch) < RECENTER_EPSILON &&
        (onFoot || Math.abs(this.yawValue) < RECENTER_EPSILON);
      if (settled) {
        this.pitch = 0;
        if (!onFoot) this.yawValue = 0;
        this.recentering = false;
      }
    }

    // Wobble phases. Bob only advances while moving, so it freezes at rest.
    const moveMag = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    if (moveMag > 1e-3) this.bobTime += d;
    this.shakeTime += d;

    // Zoom drives the orbit arm only (foot and interior have no arm).
    const driving: CameraMode = onFoot ? 'foot' : this._mode;
    if (input.zoomDelta !== 0 && (driving === 'chase' || driving === 'orbit')) {
      this.logDistance += input.zoomDelta * ZOOM_SENSITIVITY;
      if (this._mode === 'chase' && this.logDistance > LOG_CHASE_MAX) {
        this._mode = 'orbit'; // one gesture crosses from bumper-cam to landscape
      }
      this.logDistance = clamp(this.logDistance, LOG_MIN, LOG_MAX);
      if (this._mode === 'chase') {
        this.logDistance = Math.min(this.logDistance, LOG_CHASE_MAX);
      }
    }

    const mode: CameraMode = onFoot ? 'foot' : this._mode;

    // Entering interior view — whether by stepping into the car or cycling
    // views back to it — must start the sway from a clean zero. Otherwise a
    // finite-difference position from seconds ago (or a different vehicle)
    // turns into a single spurious velocity spike on the first frame back.
    if (mode === 'interior' && !this.wasInterior) this.resetSway(target);
    this.wasInterior = mode === 'interior';

    switch (mode) {
      case 'foot':
        this.desiredFoot(target, moveMag);
        break;
      case 'interior':
        this.desiredInterior(target, d);
        break;
      case 'chase':
        this.desiredArm(target);
        this.applyOcclusion(target);
        this.liftAboveGround(target);
        break;
      case 'orbit':
        this.desiredArm(target);
        this.liftAboveGround(target);
        break;
    }

    // The hood camera is BOLTED to the car, so it must not be sprung toward its
    // desired pose: a first-order follow at SPRING_OMEGA lags by v/omega, which is
    // a metre at 45 km/h and 2.5 m at highway speed — enough for the eye to sink
    // back through the windscreen into the cabin and to swim forward under braking.
    // Its softness comes from the bounded g-sway and shake instead. Every other
    // mode is a camera following the car through the air, and does spring.
    if (mode === 'interior') {
      this.eye.copy(_vA);
      this.lookAt.copy(_vB);
    } else {
      const k = 1 - Math.exp(-SPRING_OMEGA * d);
      this.eye.lerp(_vA, k);
      this.lookAt.lerp(_vB, k);
    }

    _mA.lookAt(this.eye, this.lookAt, _UP);
    this.camera.quaternion.setFromRotationMatrix(_mA);
    if (mode === 'interior') {
      // Counter-roll from the same lateral g-force estimate as the eye sway
      // (see desiredInterior): the cabin banks a few degrees into hard
      // cornering, the way real body roll leans the driver outward. Driven
      // by measured lateral accel rather than steering angle so holding full
      // lock at parking speed doesn't lean the view at all.
      _qB.setFromAxisAngle(_FORWARD, this.swayRoll);
      this.camera.quaternion.multiply(_qB);
    }
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

  private desiredInterior(target: CameraTarget, dt: number): void {
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    _vC.set(target.eyeOffset[0], target.eyeOffset[1], target.eyeOffset[2]).applyQuaternion(_qA);
    _vA.set(target.x, target.y, target.z).add(_vC);

    // G-force sway: a bounded offset around the fixed eye point above,
    // derived from the chassis' own finite-differenced acceleration — see
    // the SWAY_* block for why acceleration (not velocity) drives this.
    // World velocity from the position delta, then rotated into the body
    // frame (conjugate of a unit quaternion is its inverse) so it splits
    // cleanly into forward and lateral components.
    _vD.set(
      target.x - this.swayPrevPos.x,
      target.y - this.swayPrevPos.y,
      target.z - this.swayPrevPos.z,
    ).divideScalar(dt);
    this.swayPrevPos.set(target.x, target.y, target.z);
    _qB.copy(_qA).conjugate();
    _vD.applyQuaternion(_qB);
    const fwdSpeed = _vD.z;
    const latSpeed = _vD.x;

    if (this.swayPrimed) {
      const rawLong = (fwdSpeed - this.swayPrevFwdSpeed) / dt;
      const rawLat = (latSpeed - this.swayPrevLatSpeed) / dt;
      const k = 1 - Math.exp(-SWAY_OMEGA * dt);
      this.swayAccelLong += (rawLong - this.swayAccelLong) * k;
      this.swayAccelLat += (rawLat - this.swayAccelLat) * k;
    } else {
      this.swayPrimed = true; // first frame after a reset: nothing to difference against yet
    }
    this.swayPrevFwdSpeed = fwdSpeed;
    this.swayPrevLatSpeed = latSpeed;

    // Offset opposes the car's acceleration, like a body pressed back into
    // its seat under throttle or thrown sideways under braking/cornering.
    // The clamp below is the guarantee: however large swayAccelLong/Lat get,
    // the offset added to the eye can never exceed SWAY_MAX.
    const offsetZ = clamp(-this.swayAccelLong * SWAY_GAIN, -SWAY_MAX, SWAY_MAX);
    const offsetX = clamp(-this.swayAccelLat * SWAY_GAIN, -SWAY_MAX, SWAY_MAX);
    this.swayRoll = clamp(-this.swayAccelLat * SWAY_ROLL_GAIN, -SWAY_ROLL_MAX, SWAY_ROLL_MAX);
    _vD.set(offsetX, 0, offsetZ).applyQuaternion(_qA);
    _vA.add(_vD);

    // Speed-scaled shake from incommensurate sines: pseudo-random, never a throb.
    const amp = SHAKE_MAX * clamp(target.speedKmh / FOV_FULL_SPEED, 0, 1);
    const t = this.shakeTime;
    _vA.x += (Math.sin(t * 23.1) + Math.sin(t * 41.7) * 0.7) * amp * 0.5;
    _vA.y += (Math.sin(t * 17.3) + Math.cos(t * 31.9) * 0.7) * amp;
    _vA.z += (Math.cos(t * 19.7) + Math.sin(t * 37.3) * 0.7) * amp * 0.5;

    // View direction = car orientation applied to the local look vector.
    this.lookVector(_vC);
    _vD.copy(_vC).applyQuaternion(_qA);
    _vB.copy(_vA).addScaledVector(_vD, LOOK_AHEAD);
  }

  /**
   * Clears the interior sway's running state. Called whenever the driving
   * view enters 'interior' — stepping into the car or cycling views back to
   * it — so a finite-difference position from long ago (or a different
   * vehicle) never turns into a one-frame velocity spike.
   */
  private resetSway(target: CameraTarget): void {
    this.swayPrevPos.set(target.x, target.y, target.z);
    this.swayPrevFwdSpeed = 0;
    this.swayPrevLatSpeed = 0;
    this.swayAccelLong = 0;
    this.swayAccelLat = 0;
    this.swayRoll = 0;
    this.swayPrimed = false;
  }

  private desiredArm(target: CameraTarget): void {
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    _vC.copy(_FORWARD).applyQuaternion(_qA); // full 3D forward (includes grade)

    // Horizontal forward so the orbit stays level while the car pitches.
    let fhx = _vC.x;
    let fhz = _vC.z;
    const flen = Math.hypot(fhx, fhz);
    if (flen > 1e-6) {
      fhx /= flen;
      fhz /= flen;
    } else {
      fhx = 0;
      fhz = 1;
    }

    // Look-at leads the car in its direction of travel, fading out at parking
    // speed so a stationary car doesn't keep the camera aimed past it.
    const lead =
      Math.min(LEAD_MAX, target.speedKmh * LEAD_PER_KMH) *
      smoothstep(LEAD_FADE_START, LEAD_FADE_END, target.speedKmh);
    _vB.set(target.x, target.y, target.z).addScaledVector(_vC, lead);

    // Arm direction: behind the car, orbit by yaw, then elevate by pitch.
    // The arm points FROM the car TO the camera, i.e. it is the negation of the
    // view direction. The free-look cameras build the view as (sin y, cos y),
    // where yaw increase (mouse left) swings the view left — `update` subtracts
    // lookYaw for exactly that reason. So here the view must rotate by -yaw
    // (`R(-yaw)` applied to the car's forward), and the arm is that view
    // negated: arm = -R(-yaw)*fh. Mirroring the components of `lookVector`
    // blindly would orbit the camera the wrong way round the car and invert
    // left/right in chase/orbit, which is exactly the bug this sign pair fixes.
    const sy = Math.sin(this.yawValue);
    const cy = Math.cos(this.yawValue);
    const armPitch = this.pitch + ORBIT_PITCH_BASE;
    const ca = Math.cos(armPitch);
    const sa = Math.sin(armPitch);
    const armHx = -fhx * cy - fhz * sy;
    const armHz = fhx * sy - fhz * cy;
    _vD.set(armHx * ca, sa, armHz * ca);

    _vA.copy(_vB).addScaledVector(_vD, Math.exp(this.logDistance));
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
    const targetFov =
      BASE_FOV + (MAX_FOV - BASE_FOV) * clamp(speedKmh / FOV_FULL_SPEED, 0, 1);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-FOV_OMEGA * dt));
    // Only touch the projection matrix when the value actually moved; calling
    // updateProjectionMatrix every frame is needless CPU for a slow-changing value.
    if (Math.abs(this.fov - this.camera.fov) > FOV_EPSILON) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Local-space look vector from yaw/pitch: 0 -> +Z, +pitch -> up, +yaw -> +X. */
  private lookVector(out: THREE.Vector3): void {
    const cp = Math.cos(this.pitch);
    out.set(Math.sin(this.yawValue) * cp, Math.sin(this.pitch), Math.cos(this.yawValue) * cp);
  }

  /** On exit: keep the cabin view direction so the player steps out facing it. */
  private snapFoot(target: CameraTarget): void {
    _vC.subVectors(this.lookAt, this.eye);
    if (_vC.lengthSq() > 1e-8) {
      _vC.normalize();
      this.yawValue = Math.atan2(_vC.x, _vC.z);
      this.pitch = Math.asin(clamp(_vC.y, -1, 1));
    } else {
      this.yawValue = 0;
      this.pitch = 0;
    }
    this.eye.set(target.x, target.y + EYE_HEIGHT, target.z);
    this.lookAt.copy(this.eye).addScaledVector(_vC, LOOK_AHEAD);
    this.fov = BASE_FOV;
  }

  /** On entry: look straight ahead in the cabin; snap, don't fly through. */
  private snapInterior(target: CameraTarget): void {
    this.yawValue = 0;
    this.pitch = 0;
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    _vC.set(target.eyeOffset[0], target.eyeOffset[1], target.eyeOffset[2]).applyQuaternion(_qA);
    this.eye.set(target.x, target.y, target.z).add(_vC);
    _vD.copy(_FORWARD).applyQuaternion(_qA);
    this.lookAt.copy(this.eye).addScaledVector(_vD, LOOK_AHEAD);
    this.fov = BASE_FOV;
  }
}
