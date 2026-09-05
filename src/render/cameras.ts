import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { CAMERA_BASE_FOV, nearPlaneForFarPlane } from '../core/renderer';
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
  /** Bonnet camera mount in chassis-local metres; see CarModelMeasure.hoodPoint. */
  hoodOffset: readonly [number, number, number];
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
/** Constant elevation folded into the arm pitch so the car hides no road. */
const ARM_PITCH_BASE = 0.22;
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
/** Ten-power binoculars: magnification is the resting FOV divided by ten. */
const BINOCULAR_FOV = BASE_FOV / 10;
const FOV_EPSILON = 0.01;
const BOB_AMP = 0.035;
const BOB_FREQ = 9;

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
  private fov = BASE_FOV;

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

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    origin: WorldOrigin,
  ) {
    origin.register(this);
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
    if (this.recentering && (input.lookYaw !== 0 || input.lookPitch !== 0)) {
      this.recentering = false;
    }
    if (input.recenterCamera) {
      this.recentering = true;
      // Capture once: even a re-centre in progress must not inherit a wreck's spin.
      this.recenterYaw = onFoot ? 0 : this.vehicleYaw;
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
      const yawError = wrapAngle(this.vehicleYaw - this.yawValue);
      if (Math.abs(yawError) < RECENTER_EPSILON) {
        this.yawValue = this.vehicleYaw;
      } else {
        const k = 1 - Math.exp(-CHASE_RECENTER_OMEGA * d);
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

  private desiredArm(target: CameraTarget): void {
    // External cameras use a WORLD-space view heading. The chassis contributes
    // position and speed only: yaw, pitch and roll can change arbitrarily during a
    // wreck without rotating the view. Mouse input is the sole continuous source
    // of external-camera orientation.
    const viewX = Math.sin(this.yawValue);
    const viewZ = Math.cos(this.yawValue);

    // The chassis transform is the measured centre of the rendered model (see
    // render/carmodel.ts). Keep that point at the centre of the view at every
    // speed; leading the look target down the road made the chase camera appear
    // to pivot around one end of the car instead of around the car itself.
    _vB.set(target.x, target.y, target.z);

    // The arm points from the look target to the eye, opposite the view heading.
    // Pitch moves an orbiting eye opposite the requested look direction: mouse-up
    // lowers armPitch until the eye sits below the target and therefore looks up.
    const armPitch = ARM_PITCH_BASE - this.pitch;
    const ca = Math.cos(armPitch);
    const sa = Math.sin(armPitch);
    _vD.set(-viewX * ca, sa, -viewZ * ca);

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
      BASE_FOV + (MAX_FOV - BASE_FOV) * clamp(speedKmh / FOV_FULL_SPEED, 0, 1);
    const targetFov = this.binoculars ? BINOCULAR_FOV : normalFov;
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
    this.fov = BASE_FOV;
  }

  /** Snap into the remembered driving pose on entry, preserving its arm exactly. */
  private snapDriving(target: CameraTarget): void {
    this.updateVehicleYaw(target);
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
    this.fov = BASE_FOV;
  }
}
