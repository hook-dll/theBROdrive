import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { CAR_FIELD_OF_VIEW, FOOT_FIELD_OF_VIEW, nearPlaneForFarPlane } from '../core/renderer';
import type { CameraStyle } from '../game/settings';
import { WorldOrigin, type RebaseShift } from '../world/origin';

export type CameraMode = 'foot' | 'cabin' | 'chase';

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speedKmh: number;
  /**
   * The steering rim's share of lock, positive LEFT (`Vehicle.steeringFraction`); 0 on
   * foot. The look into a corner reads the wheel and not the input, because a key is
   * only a direction: the wheel it has wound in is the thing to look along.
   */
  steering: number;
  /** Mean micro-bump amplitude under the loaded wheels, metres; 0 on foot. */
  surfaceRoughness: number;
  /** Fraction of the wheels on the ground, 0..1; 0 on foot. */
  wheelContact: number;
  /** The seated player's eye in chassis-local metres, the cabin view's mount; see vehicle/cabincamera.ts. */
  cabinOffset: readonly [number, number, number];
  /** On foot, how far a crouch has lowered the eye below `EYE_HEIGHT`, metres (`Player.interpolatedEyeDrop`); 0 in a car. */
  eyeDrop: number;
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
  /**
   * Vertical velocity in the float frame, m/s; 0 on foot. Read only by the driver's head
   * (`HEAD_MOTION`): the seat's heave, whose every change the head on its neck answers.
   */
  velocityY: number;
  /**
   * The car is being driven by the autopilot: the cabin view then never turns back to
   * the road on its own, since the player is a passenger looking about.
   */
  autopilot: boolean;
}

/* ---- tuning ---- */

/** Mouse pitch clamp, radians. Keeps the view from flipping over the poles. */
const PITCH_LIMIT = 1.45;
/** Standing eye height above the player position, metres: a grown man's, 1.78 m. */
const EYE_HEIGHT = 1.78;
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
/**
 * The cabin view waits this long after the last look input before facing the road again
 * (owner, 2026-10-17: one second came back before a glance was finished). Never while
 * the autopilot drives (`CameraTarget.autopilot`).
 */
const CABIN_RECENTER_IDLE_SECONDS = 2;
/**
 * Cabin-view near plane, metres. The eye sits 5-10 cm from the roof lining, the pillar
 * and the head restraint as the head turns, and `CAMERA_NEAR` (0.08) cut through them
 * to the sky. 2 cm keeps trim in front of the eye. On the reversed float depth buffer
 * (render/depthconvention.ts) that costs nothing. On the ordinary 24-bit one the depth
 * steps are 4x coarser across the scene: a 1 mm gap fights beyond ~13 m instead of
 * ~26 m, which from the seat is the world outside, not the cabin.
 */
const CABIN_NEAR = 0.02;
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
/** `tan` of half the driving views' resting FOV: the divisor of `armPitchForWidening`. */
const CAR_HALF_TAN = Math.tan((CAR_FIELD_OF_VIEW * Math.PI) / 360);
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
 * Acceleration widening, degrees added to the resting FOV per m/s² of the smoothed
 * surge (`surge`, SURGE_OMEGA), capped at FOV_ACCEL_MAX: +7.5° at a 3 m/s² pull. It
 * follows the speed's rate of change, not the speed, so the view widens while the car
 * gains speed and returns to rest once the speed holds — a cruise at any speed rests at
 * the player's own FOV. Driving views only; on foot, in a death and through the
 * binoculars the view rests.
 *
 * RELATIVE to the resting view, which is a player setting: the cue then means the same
 * whatever FOV he picked. The cap bounds the rectilinear stretch at the frame edge
 * (`1 / cos²(angle)`, 2.28x at the authored 65) during the short time it is reached.
 */
const FOV_ACCEL_DEG_PER_MPS2 = 2.5;
const FOV_ACCEL_MAX = 10;
/**
 * Braking narrows the view by FOV_BRAKE_DEG_PER_MPS2 per m/s² of deceleration, at most
 * FOV_BRAKE_MAX degrees: a third of the old 2°/m/s² widening rate, so a stamp on the
 * brakes reads as a lurch forward without the frame zooming in.
 */
const FOV_BRAKE_DEG_PER_MPS2 = 2 / 3;
const FOV_BRAKE_MAX = 2;
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

/* ---- the driver's head: `Settings.cameraShake`; nothing at all with it off ---- */

/**
 * THE DRIVER'S HEAD ON ITS NECK. The cabin eye used to be bolted to the chassis: every
 * motion the view made was the rigid body's. A real head is a mass on a spring on top
 * of a seat, and what it does is the car's ACCELERATION, not its pose: it leans out of
 * a corner, nods forward under braking, sinks back into the seat when the car pulls
 * away, and bobs once each time the springs or a wheel hand the body a jolt. Nothing
 * here moves the car — only the eye, relative to its seat.
 *
 * All of it is read off the chassis velocity, as the dynamic camera's lean is (the
 * difference between solver steps, over the time since the velocity last changed, in
 * the car's own axes), so it is the same at any refresh rate. Lean, surge, nod and sink
 * are critically damped springs toward a target proportional to the acceleration:
 * they can never overshoot into a wobble. The vertical jolt is the one with a bounce in
 * it — a lightly damped neck mode, kicked by each change of the seat's vertical speed —
 * because a jolt that did not bob would read as a frame drop. Every term is clamped,
 * and small: a few centimetres and a couple of degrees, under the 0.1 m and 3° where
 * the view starts to feel like a ride. Kids ride in this seat.
 *
 * Mutable so it can be tuned live from the console as `__bro.headMotion`
 * (app/devtools.ts); off with Settings → Camera shake.
 *
 *   leanPerMps2, leanMaxM      sideways eye travel per m/s² of lateral acceleration
 *   surgePerMps2, surgeMaxM    fore-aft: forward under braking, back under power
 *   nodRadPerMps2, nodMaxRad   view pitch per m/s² along: down braking, up accelerating
 *   sinkPerMps2, sinkMaxM      the drop into the seat under power
 *   omega                      the follow rate of the four above, rad/s
 *   joltGain                   metres per second of head speed per m/s of seat heave change
 *   joltHz, joltDamping        the neck's vertical mode and its damping ratio
 *   joltMaxM                   clamp on the vertical bob
 *   pitchHz, pitchDamping      the neck's PITCH mode: the head is held to the body's pitch
 *                              by its neck, so a body that pitches fast leaves the gaze
 *                              behind for a moment and the head catches up
 *   pitchPerHeave              rad/s of head pitch rate per m/s of seat heave change: the
 *                              head's mass sits ahead of the neck, so a seat kicked up
 *                              nods it down
 *   pitchMaxRad                clamp on the head's pitch against the body
 *   chaseShare                 the share of the jolt and nod the chase camera takes
 *   bodyShare                  the share of the body's own pitch and roll the CHASE
 *                              camera takes, as one hung off the car would
 *   bodyOmega                  how fast that share follows the body, rad/s: slow enough
 *                              that a dive or a roll shows against the camera first
 *   bodyMaxRad                 the body tilt read at most, so a wreck cannot turn the view
 *
 * The neck's modes sit at 2-3 Hz and near critical [E: a seated head on its neck, in
 * the 2-3 Hz band the owner asked for; damped enough that it settles in one bob]. The
 * chase share is a third with a ~1/3 s lag [E: enough to show the body move on its
 * springs without the horizon swimming].
 */
export const HEAD_MOTION = {
  leanPerMps2: 0.006,
  leanMaxM: 0.05,
  surgePerMps2: 0.005,
  surgeMaxM: 0.045,
  nodRadPerMps2: 0.0035,
  nodMaxRad: 0.035,
  sinkPerMps2: 0.002,
  sinkMaxM: 0.012,
  omega: 6,
  joltGain: 0.12,
  joltHz: 2.2,
  joltDamping: 0.7,
  joltMaxM: 0.035,
  pitchHz: 2.5,
  pitchDamping: 0.7,
  pitchPerHeave: 0.4,
  pitchMaxRad: 0.03,
  chaseShare: 0.35,
  bodyShare: 0.35,
  bodyOmega: 3,
  bodyMaxRad: 0.17,
};
/** Head accelerations past this are a crash or a teleport, not driving, m/s². */
const HEAD_ACCEL_CLAMP = 14;
/** A seat heave change past this in one solver step is a teleport or a wreck, m/s. */
const HEAD_JOLT_CLAMP_MPS = 4;

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
/** The cabin view's up: the chassis's own, so the horizon rolls with the car around the driver. */
const _cabinUp = new THREE.Vector3(0, 1, 0);
/** The chase view's up: world up tilted by its share of the body's (`HEAD_MOTION.bodyShare`). */
const _chaseUp = new THREE.Vector3(0, 1, 0);
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
   * The live vertical FOV: the resting one of the view (`FOOT_FIELD_OF_VIEW` on foot,
   * `CAR_FIELD_OF_VIEW` in the chase and cabin views) plus the acceleration widening.
   */
  private fov = FOOT_FIELD_OF_VIEW;

  private bobTime = 0;
  /** True while a V re-centre ease runs; cancelled by any mouse look. */
  private recentering = false;
  /** World-space heading captured when an external-camera re-centre begins. */
  private recenterYaw = 0;
  /** Seconds since the last chase-camera horizontal look input. */
  private chaseLookIdle = 0;
  /**
   * The chase arm as it was left for the cabin view (`showCabin`), put back by
   * `showChase`: its heading as an offset from the car, which may have turned meanwhile,
   * its pitch, and how long the player had left it alone (the automatic return keeps
   * counting from there).
   */
  private chaseYawOffset = 0;
  private chasePitch = 0;
  private chaseLookIdleKept = 0;
  /** Set by `showChase`: the next frame places the chase eye on its arm instead of springing it out of the seat. */
  private snapChaseEye = false;
  /** Cabin view heading relative to the car: where the driver has turned his head. */
  private cabinYawOffset = 0;
  /** Seconds since the player last turned the head in the cabin view. */
  private cabinLookIdle = 0;
  /** The hand is on a fitting the mouse works (the inside mirror): the head stays where it looks. */
  private cabinLookHeld = false;
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
  /**
   * THE HEAD (`HEAD_MOTION`): its own last solver velocity and the time since it
   * changed (the head runs in either style, so it does not share the dynamic camera's),
   * the low-passed acceleration along the car's side and forward axes, and the head's
   * offsets from its seat with their rates — lateral (+ toward the car's left), along
   * (+ forward), vertical (+ up) and the nod (+ looking up).
   */
  private headVelX = Number.NaN;
  private headVelY = 0;
  private headVelZ = 0;
  private headVelAge = 0;
  private headAccelSide = 0;
  private headAccelAlong = 0;
  private headSide = 0;
  private headSideRate = 0;
  private headAlong = 0;
  private headAlongRate = 0;
  private headSink = 0;
  private headSinkRate = 0;
  private headNod = 0;
  private headNodRate = 0;
  private headJolt = 0;
  private headJoltRate = 0;
  /**
   * The head's own pitch, radians, and its rate: held to the body's by the neck
   * (`HEAD_MOTION.pitchHz`), so `headPitch − body pitch` is how far the gaze is left
   * behind. NaN until the first frame of a drive.
   */
  private headPitch = Number.NaN;
  private headPitchRate = 0;
  /** That lag, radians, + looking up against the car; clamped to `pitchMaxRad`. */
  private headPitchLag = 0;
  /**
   * The chase camera's share of the body's tilt: the world-horizontal components of
   * the chassis's up axis (`HEAD_MOTION.bodyShare`), each with its rate.
   */
  private bodyTiltX = 0;
  private bodyTiltXRate = 0;
  private bodyTiltZ = 0;
  private bodyTiltZRate = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    origin: WorldOrigin,
  ) {
    this.camera.fov = FOOT_FIELD_OF_VIEW;
    origin.register(this);
  }

  /** `Settings.cameraShake`: whether the driving view trembles at speed. */
  setShake(on: boolean): void {
    this.shake = on;
    if (!on) this.resetHead();
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
    this.resetHead();
  }

  /** The head back on its seat, at rest; see `HEAD_MOTION`. */
  private resetHead(): void {
    this.headVelX = Number.NaN;
    this.headVelAge = 0;
    this.headAccelSide = 0;
    this.headAccelAlong = 0;
    this.headSide = 0;
    this.headSideRate = 0;
    this.headAlong = 0;
    this.headAlongRate = 0;
    this.headSink = 0;
    this.headSinkRate = 0;
    this.headNod = 0;
    this.headNodRate = 0;
    this.headJolt = 0;
    this.headJoltRate = 0;
    this.headPitch = Number.NaN;
    this.headPitchRate = 0;
    this.headPitchLag = 0;
    this.bodyTiltX = 0;
    this.bodyTiltXRate = 0;
    this.bodyTiltZ = 0;
    this.bodyTiltZRate = 0;
  }

  /**
   * Rebasable: shift every relative position this rig keeps across frames by the
   * frame step, so the camera stays glued to the world. Y is a height, untouched by
   * the origin. The rendered camera moves too: it is rewritten only in `update`, which
   * runs after the cars are posed, and until then the frame reads it as the eye
   * (`Vehicle.viewFrom`). Left a kilometre behind, the occupied car's cabin stood past
   * its 25 m detail range for that one frame and vanished: a flash of the painted
   * shell in front of the eyes on every rebase.
   */
  rebase(shift: RebaseShift): void {
    this.eye.x -= shift.dx;
    this.eye.z -= shift.dz;
    this.lookAt.x -= shift.dx;
    this.lookAt.z -= shift.dz;
    this.deathStartEye.x -= shift.dx;
    this.deathStartEye.z -= shift.dz;
    this.camera.position.x -= shift.dx;
    this.camera.position.z -= shift.dz;
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

  /** While true the cabin view does not turn back to the road (main.ts: F held on the mirror). */
  setCabinLookHeld(held: boolean): void {
    this.cabinLookHeld = held;
  }

  setMode(mode: CameraMode): void {
    // Foot is derived from `onFoot`. The driving selection is kept across a walk, the
    // chase's zoom with it; main.ts selects the cabin as the player gets in from foot, and
    // the entry snap (`snapDriving`) then faces it down the car.
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
    this.updateFov(d, false);
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
    this.updateProjection();
  }

  /**
   * C switches the driving views: the follow arm and the driver's seat. Entering the
   * cabin aims it down the car (`showCabin`), because a seat's view left pointing
   * wherever the chase arm happened to be reads as the car having spun. Leaving it puts
   * the arm back where it was (`showChase`).
   */
  cycleDriving(): void {
    if (this._mode === 'chase') this.showCabin();
    else this.showChase();
  }

  /** Switches to the cabin view looking straight ahead, unless it is already showing. */
  showCabin(): void {
    if (this._mode === 'cabin') return;
    if (!this.onFoot) {
      this.chaseYawOffset = wrapAngle(this.yawValue - this.vehicleYaw);
      this.chasePitch = this.pitch;
      this.chaseLookIdleKept = this.chaseLookIdle;
    }
    this._mode = 'cabin';
    this.cabinYawOffset = 0;
    this.pitch = 0;
    this.yawValue = this.vehicleYaw;
  }

  /**
   * Back to the chase view, the arm where `showCabin` left it: the same angle round the
   * car and pitch, the same zoom (which the cabin never touches), and the eye placed on
   * it at once rather than flying out of the seat.
   */
  private showChase(): void {
    this._mode = 'chase';
    if (this.onFoot) return;
    this.yawValue = wrapAngle(this.vehicleYaw + this.chaseYawOffset);
    this.pitch = this.chasePitch;
    this.chaseLookIdle = this.chaseLookIdleKept;
    this.recentering = false;
    this.snapChaseEye = true;
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
    // The driver's head, and the chase camera's share of the body's tilt, ride in
    // either style, and only with the shake setting on.
    if (!onFoot && this.shake) {
      this.updateHead(d, target);
      this.updateBodyTilt(d, target);
    }

    // The cabin turns with the car, so its heading is stored as an OFFSET from the
    // chassis and rebuilt against the live heading every frame. Keeping the raw world
    // yaw instead would leave the view pointing at the horizon it started on while the
    // car drove around underneath it.
    if (inputMode === 'cabin') this.yawValue = wrapAngle(this.vehicleYaw + this.cabinYawOffset);

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
    // The seat's head is turned by either axis, so either keeps it where it is.
    const lookActive = horizontalLookActive || Math.abs(input.lookPitch) >= CHASE_LOOK_ACTIVITY_EPSILON;
    this.cabinLookIdle = inputMode === 'cabin' && !lookActive && !this.cabinLookHeld ? this.cabinLookIdle + d : 0;

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
    // The cabin view turns back to the road `CABIN_RECENTER_IDLE_SECONDS` after the
    // player stops looking about: the head eases to straight ahead and level at the
    // chase view's gentle automatic rate, and any look input stops it at once. Not on
    // autopilot: nobody needs the road ahead then, and the head stays where it was left.
    if (
      inputMode === 'cabin' && !target.autopilot && !this.recentering
      && this.cabinLookIdle >= CABIN_RECENTER_IDLE_SECONDS
    ) {
      const k = 1 - Math.exp(-CHASE_RECENTER_OMEGA * d);
      const yawError = wrapAngle(this.vehicleYaw - this.yawValue);
      this.yawValue = Math.abs(yawError) < RECENTER_EPSILON ? this.vehicleYaw : wrapAngle(this.yawValue + yawError * k);
      this.pitch = Math.abs(this.pitch) < RECENTER_EPSILON ? 0 : this.pitch * (1 - k);
    }

    // Whatever look, re-centre or snap did to the world yaw this frame is the cabin
    // view's new offset from the car. Recording it here, once, is what keeps the two
    // representations from disagreeing on the next frame.
    if (inputMode === 'cabin') this.cabinYawOffset = wrapAngle(this.yawValue - this.vehicleYaw);

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

    // Zoom drives the chase arm only; the seat has no arm to lengthen.
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
      case 'cabin':
        this.desiredCabin(target);
        break;
      case 'chase':
        this.desiredArm(target);
        // A share of the head's bob and nod, as a camera hung off the car would take
        // them (`HEAD_MOTION.chaseShare`); the lean is the dynamic camera's own.
        _vA.y += this.headJolt * HEAD_MOTION.chaseShare;
        _vB.y += this.headNod * HEAD_MOTION.chaseShare * _vA.distanceTo(_vB);
        // And its share of the body's own pitch and roll, late (`HEAD_MOTION.bodyShare`):
        // the arm swung about the car's centre by the pitch along the view — a dive
        // lifts an eye behind the car — and the roll across it tilting the view's up.
        // Both zero with the shake setting off.
        _vA.y += HEAD_MOTION.bodyShare * (this.bodyTiltX * (_vB.x - _vA.x) + this.bodyTiltZ * (_vB.z - _vA.z));
        _chaseUp.set(HEAD_MOTION.bodyShare * this.bodyTiltX, 1, HEAD_MOTION.bodyShare * this.bodyTiltZ).normalize();
        this.applyOcclusion(target);
        this.liftAboveGround(target);
        break;
    }

    // The chase camera springs only its eye. Its look point is the current,
    // interpolated chassis centre: springing it by the same rule leaves it metres
    // behind a fast car, visibly pinning the view to the rear rather than its centre.
    // The foot camera springs both ends of its view ray.
    //
    // The cabin eye springs NEITHER: it is the driver's head in his seat, rigid with the
    // car, and any lag would slide it about the cabin.
    const k = 1 - Math.exp(-SPRING_OMEGA * d);
    if (mode === 'cabin' || (mode === 'chase' && this.snapChaseEye)) {
      this.eye.copy(_vA);
      this.lookAt.copy(_vB);
    } else {
      this.eye.lerp(_vA, k);
      if (mode === 'chase') this.lookAt.copy(_vB);
      else this.lookAt.lerp(_vB, k);
    }
    this.snapChaseEye = false;

    _mA.lookAt(this.eye, this.lookAt, mode === 'cabin' ? _cabinUp : mode === 'chase' ? _chaseUp : _UP);
    this.camera.quaternion.setFromRotationMatrix(_mA);
    // The sway shakes a camera hung off the car; from the driver's seat the cabin
    // around the eye would visibly swim, so the cabin view does not take it.
    if (mode !== 'foot' && mode !== 'cabin' && this.shake) this.applyShake(target);
    // The camera sits in the relative scene graph, so its position is the relative
    // eye verbatim — no origin arithmetic here or at any consumer. The eye is built
    // from `target` (the car's or player's transform, already relative), and on a
    // rebase `rebase()` shifts eye and lookAt by the same frame step as the bodies,
    // so this copy stays correct with no conversion. `eyePosition` and
    // `eyeDirection` expose that same relative eye to interaction and spawn code,
    // which also live in the relative frame, so no absolute accessor is needed.
    this.camera.position.copy(this.eye);

    this.updateFov(d, mode !== 'foot');
  }

  /* ---- desired pose per mode; each writes _vA = eye, _vB = look-at ---- */

  private desiredFoot(target: CameraTarget, moveMag: number): void {
    const bob = Math.sin(this.bobTime * BOB_FREQ) * BOB_AMP * moveMag;
    _vA.set(target.x, target.y + EYE_HEIGHT - target.eyeDrop + bob, target.z);
    this.lookVector(_vD);
    _vB.copy(_vA).addScaledVector(_vD, LOOK_AHEAD);
  }

  /**
   * Driver's seat: the eye and the whole view ride the chassis. The view DIRECTION is
   * the car's too — yaw and pitch are the driver's head turned against the car, and up
   * is the car's up — because the cabin fills the frame: a horizon held level while the
   * dashboard rolls round it reads as the car coming apart.
   */
  private desiredCabin(target: CameraTarget): void {
    _qA.set(target.qx, target.qy, target.qz, target.qw);
    // The eye is the seat's, plus where the head has swayed on its neck (`HEAD_MOTION`).
    _vC.set(
      target.cabinOffset[0] + this.headSide,
      target.cabinOffset[1] + this.headJolt - this.headSink,
      target.cabinOffset[2] + this.headAlong,
    ).applyQuaternion(_qA);
    _vA.set(target.x + _vC.x, target.y + _vC.y, target.z + _vC.z);
    const pitch = this.pitch + this.headNod + this.headPitchLag;
    const cp = Math.cos(pitch);
    _vD.set(Math.sin(this.cabinYawOffset) * cp, Math.sin(pitch), Math.cos(this.cabinYawOffset) * cp)
      .applyQuaternion(_qA);
    _vB.copy(_vA).addScaledVector(_vD, LOOK_AHEAD);
    _cabinUp.copy(_UP).applyQuaternion(_qA);
  }

  /**
   * THE DRIVER'S HEAD (`HEAD_MOTION`), one frame: the car's acceleration in its own
   * axes, measured between solver steps, moves the head on its neck. Lean, surge, nod
   * and sink follow critically damped toward their targets; each change of the seat's
   * vertical speed kicks the head's the other way, and the neck's lightly damped mode
   * brings it back. A velocity that did not change since the last frame is no
   * measurement, as in `updateDynamics`.
   */
  private updateHead(dt: number, target: CameraTarget): void {
    const m = HEAD_MOTION;
    const qx = target.qx;
    const qy = target.qy;
    const qz = target.qz;
    const qw = target.qw;
    const vx = target.velocityX;
    const vy = target.velocityY;
    const vz = target.velocityZ;
    this.headVelAge += dt;
    if (Number.isNaN(this.headVelX)) {
      this.headVelX = vx;
      this.headVelY = vy;
      this.headVelZ = vz;
      this.headVelAge = 0;
    } else if (vx !== this.headVelX || vy !== this.headVelY || vz !== this.headVelZ) {
      const dvx = vx - this.headVelX;
      const dvy = vy - this.headVelY;
      const dvz = vz - this.headVelZ;
      const age = this.headVelAge;
      // The car's own axes: +X its left, +Y its up, +Z its nose.
      const side = dvx * (1 - 2 * (qy * qy + qz * qz)) + dvy * 2 * (qx * qy + qz * qw) + dvz * 2 * (qx * qz - qy * qw);
      const up = dvx * 2 * (qx * qy - qz * qw) + dvy * (1 - 2 * (qx * qx + qz * qz)) + dvz * 2 * (qy * qz + qx * qw);
      const along = dvx * 2 * (qx * qz + qy * qw) + dvy * 2 * (qy * qz - qx * qw) + dvz * (1 - 2 * (qx * qx + qy * qy));
      const blend = 1 - Math.exp(-m.omega * age);
      this.headAccelSide += (clamp(side / age, -HEAD_ACCEL_CLAMP, HEAD_ACCEL_CLAMP) - this.headAccelSide) * blend;
      this.headAccelAlong += (clamp(along / age, -HEAD_ACCEL_CLAMP, HEAD_ACCEL_CLAMP) - this.headAccelAlong) * blend;
      // The seat rose by `up`; the head, on its neck, is left behind by its share of it,
      // and its mass, ahead of the neck, nods it down.
      const heave = clamp(up, -HEAD_JOLT_CLAMP_MPS, HEAD_JOLT_CLAMP_MPS);
      this.headJoltRate -= heave * m.joltGain;
      this.headPitchRate -= heave * m.pitchPerHeave;
      this.headVelX = vx;
      this.headVelY = vy;
      this.headVelZ = vz;
      this.headVelAge = 0;
    }

    // Out of the corner, forward under braking and back under power, the view nodding
    // down and up with it, and a little drop into the seat as the car pulls away.
    springStep(this.headSide, this.headSideRate, clamp(-this.headAccelSide * m.leanPerMps2, -m.leanMaxM, m.leanMaxM), m.omega, dt);
    this.headSide = _spring.position;
    this.headSideRate = _spring.velocity;
    springStep(this.headAlong, this.headAlongRate, clamp(-this.headAccelAlong * m.surgePerMps2, -m.surgeMaxM, m.surgeMaxM), m.omega, dt);
    this.headAlong = _spring.position;
    this.headAlongRate = _spring.velocity;
    springStep(this.headNod, this.headNodRate, clamp(this.headAccelAlong * m.nodRadPerMps2, -m.nodMaxRad, m.nodMaxRad), m.omega, dt);
    this.headNod = _spring.position;
    this.headNodRate = _spring.velocity;
    springStep(this.headSink, this.headSinkRate, clamp(this.headAccelAlong * m.sinkPerMps2, 0, m.sinkMaxM), m.omega, dt);
    this.headSink = _spring.position;
    this.headSinkRate = _spring.velocity;

    // The neck's vertical mode, stepped implicitly so a long frame cannot ring it up,
    // and held inside its clamp: a head at the end of its travel stops there.
    const w = 2 * Math.PI * m.joltHz;
    this.headJoltRate =
      (this.headJoltRate - dt * w * w * this.headJolt) / (1 + 2 * m.joltDamping * w * dt + w * w * dt * dt);
    this.headJolt += this.headJoltRate * dt;
    if (Math.abs(this.headJolt) > m.joltMaxM) {
      this.headJolt = Math.sign(this.headJolt) * m.joltMaxM;
      this.headJoltRate = 0;
    }

    // The neck's PITCH mode: the head's own pitch held to the body's by a spring and a
    // damper, stepped implicitly like the jolt. What the view shows is the difference —
    // a body that pitches fast leaves the gaze behind for a moment, then the head
    // catches up — clamped, and dragged along with the body once at the clamp.
    const bodyPitch = Math.asin(clamp(2 * (qy * qz - qx * qw), -1, 1));
    if (Number.isNaN(this.headPitch)) {
      this.headPitch = bodyPitch;
      this.headPitchRate = 0;
    }
    const wp = 2 * Math.PI * m.pitchHz;
    this.headPitchRate =
      (this.headPitchRate + dt * wp * wp * (bodyPitch - this.headPitch)) /
      (1 + 2 * m.pitchDamping * wp * dt + wp * wp * dt * dt);
    this.headPitch += this.headPitchRate * dt;
    this.headPitchLag = clamp(this.headPitch - bodyPitch, -m.pitchMaxRad, m.pitchMaxRad);
    this.headPitch = bodyPitch + this.headPitchLag;
  }

  /**
   * The chase camera's share of the body's tilt (`HEAD_MOTION.bodyShare`), one frame:
   * the chassis's up axis, its horizontal part read at most `bodyMaxRad` and followed
   * by a critically damped spring at `bodyOmega`. A car on its side or roof is a wreck,
   * not a lean, and the target there is level.
   */
  private updateBodyTilt(dt: number, target: CameraTarget): void {
    const m = HEAD_MOTION;
    const qx = target.qx;
    const qy = target.qy;
    const qz = target.qz;
    const qw = target.qw;
    let tiltX = 2 * (qx * qy - qw * qz);
    let tiltZ = 2 * (qy * qz + qw * qx);
    const upY = 1 - 2 * (qx * qx + qz * qz);
    const tilt = Math.hypot(tiltX, tiltZ);
    const maxTilt = Math.sin(m.bodyMaxRad);
    if (upY < 0.5) {
      tiltX = 0;
      tiltZ = 0;
    } else if (tilt > maxTilt) {
      tiltX *= maxTilt / tilt;
      tiltZ *= maxTilt / tilt;
    }
    springStep(this.bodyTiltX, this.bodyTiltXRate, tiltX, m.bodyOmega, dt);
    this.bodyTiltX = _spring.position;
    this.bodyTiltXRate = _spring.velocity;
    springStep(this.bodyTiltZ, this.bodyTiltZRate, tiltZ, m.bodyOmega, dt);
    this.bodyTiltZ = _spring.position;
    this.bodyTiltZRate = _spring.velocity;
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

    this.steerLook =
      -target.steering * STEER_LOOK_MAX_RAD * (1 - clamp(target.speedKmh / STEER_LOOK_FADE_KMH, 0, 1));
  }

  private desiredArm(target: CameraTarget): void {
    // External cameras use a WORLD-space view heading. The chassis contributes
    // position and speed here: yaw, pitch and roll can change arbitrarily during a
    // wreck without rotating the view. Mouse input is the sole continuous source
    // of external-camera heading; the body's pitch and roll reach the view only as
    // the bounded, late share `update` adds after this (`HEAD_MOTION.bodyShare`).
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
    if (this.fov <= CAR_FIELD_OF_VIEW) return ARM_PITCH_BASE;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(this.fov) / 2);
    return Math.atan(Math.tan(ARM_PITCH_BASE) * (halfTan / CAR_HALF_TAN));
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

  /**
   * Steps the live FOV toward its target: the resting view plus the acceleration
   * widening when `widen` (FOV_ACCEL_DEG_PER_MPS2), a tenth of it through the binoculars.
   */
  private updateFov(dt: number, widen: boolean): void {
    const s = this.surge;
    const cue = !widen ? 0
      : s >= 0 ? Math.min(s * FOV_ACCEL_DEG_PER_MPS2, FOV_ACCEL_MAX)
      : Math.max(s * FOV_BRAKE_DEG_PER_MPS2, -FOV_BRAKE_MAX);
    const resting = this.onFoot ? FOOT_FIELD_OF_VIEW : CAR_FIELD_OF_VIEW;
    const targetFov = this.binoculars ? resting / BINOCULAR_POWER : resting + cue;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-FOV_OMEGA * dt));
    this.updateProjection();
  }

  /**
   * Hands the live FOV and the near plane to the camera, and rebuilds its projection
   * only when one of them changed. Outside the cabin the near plane is kept in step
   * with the far one; in the cabin view it drops to `CABIN_NEAR`, so the headliner,
   * pillars and head restraints a hand's width from the eye are drawn, not sliced open.
   */
  private updateProjection(): void {
    const targetNear = this._mode === 'cabin' ? CABIN_NEAR : nearPlaneForFarPlane(this.camera.far, this.camera.reversedDepth);
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
    this.eye.set(target.x, target.y + EYE_HEIGHT - target.eyeDrop, target.z);
    this.lookAt.copy(this.eye).addScaledVector(_vC, LOOK_AHEAD);
    this.fov = FOOT_FIELD_OF_VIEW;
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
    if (this._mode === 'cabin') {
      // Sitting down faces the windscreen, whatever the walk-up looked at.
      this.cabinYawOffset = 0;
      this.pitch = 0;
      this.yawValue = this.vehicleYaw;
      this.desiredCabin(target);
    } else {
      this.desiredArm(target);
      this.applyOcclusion(target);
      this.liftAboveGround(target);
    }
    this.eye.copy(_vA);
    this.lookAt.copy(_vB);
    this.fov = CAR_FIELD_OF_VIEW;
  }
}
