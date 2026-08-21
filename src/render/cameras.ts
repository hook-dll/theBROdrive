import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';

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
const BASE_FOV = 68;
const MAX_FOV = 82;
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
const ROLL_STEER = 0.06;

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

    switch (mode) {
      case 'foot':
        this.desiredFoot(target, moveMag);
        break;
      case 'interior':
        this.desiredInterior(target);
        break;
      case 'chase':
        this.desiredArm(target);
        this.applyOcclusion(target);
        break;
      case 'orbit':
        this.desiredArm(target);
        break;
    }

    const k = 1 - Math.exp(-SPRING_OMEGA * d);
    this.eye.lerp(_vA, k);
    this.lookAt.lerp(_vB, k);

    _mA.lookAt(this.eye, this.lookAt, _UP);
    this.camera.quaternion.setFromRotationMatrix(_mA);
    if (mode === 'interior') {
      // A tiny roll against the steer: the cabin banks like a real car leaning
      // outward in a corner. Kept small so it never reads as nausea.
      _qB.setFromAxisAngle(_FORWARD, -input.steer * ROLL_STEER);
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

  private desiredInterior(target: CameraTarget): void {
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    _vC.set(target.eyeOffset[0], target.eyeOffset[1], target.eyeOffset[2]).applyQuaternion(_qA);
    _vA.set(target.x, target.y, target.z).add(_vC);

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
    // Negate yaw so yaw increase (mouse right) orbits the camera to the right.
    const sy = Math.sin(this.yawValue);
    const cy = Math.cos(this.yawValue);
    const armPitch = this.pitch + ORBIT_PITCH_BASE;
    const ca = Math.cos(armPitch);
    const sa = Math.sin(armPitch);
    const armHx = -fhx * cy + fhz * sy;
    const armHz = -fhx * sy - fhz * cy;
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
