/**
 * The drivable car: a Rapier dynamic chassis on tyre-profile wheel contacts
 * (vehicle/tyrecontact.ts) + the drivetrain simulation, with Three.js meshes as pure
 * derived views.
 *
 * The car itself is ONE complete visual and physics model (vehicle/carmodels.ts):
 * collider, suspension mounts and wheel radii are measured from its geometry.
 * Drivability comes from the four typed service cells under the bonnet: engine and
 * fuel tank are required, water and oil protect the engine, turbine is optional.
 *
 * Ownership rules (see game/state.ts): the authoritative state lives in
 * `GameWorld` / `CarState`. This class reads `carState`, reads/writes the
 * chassis rigid body (the physics-derived view), and emits throttled deltas
 * through `world.apply`. It never mutates `CarState` directly.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { StickerState } from '../game/state';
import { GRAPHICS_CONFIG } from '../config';
import type { PhysicsWorld, Vec3 } from '../core/physics';
import type { InputFrame } from '../core/input';
import { MicroRelief, RoadTexture, SURFACES, SurfaceType, sinkageShare, subColliderShare } from '../core/surfaces';
import { hash01 } from '../core/rng';
import { WorldOrigin, type Rebasable, type RebaseShift } from '../world/origin';
import { DAY_LENGTH, MIRROR_FIELD, type CarState, type GameWorld } from '../game/state';
import type { KitMirror } from '../carkit/names';
import {
  FUEL_RESERVE_FRACTION,
  OIL_LOSS_LPH,
  oilCapacity,
  variant,
  type CarStats,
  type EngineSpec,
  type GearboxSpec,
} from '../parts/registry';
import { itemMass, type Item } from '../items/items';
import { CabinCargoView } from './cabincargo';
import type { CabinRooms } from './cabin';
import {
  carModel,
  frontWeightFraction,
  modelEngine,
  modelGearbox,
  wheelDampingRateAbs,
  wheelSpringRateAbs,
  type CarModelDef,
} from './carmodels';
import {
  BONNET_SLOT_COUNT,
  bonnetAirFilter,
  bonnetCanRun,
  bonnetHasTurbo,
  bonnetPart,
  bonnetRadiator,
  destroyedEngineSpec,
  engineFailureReason,
  stockBonnetVariants,
} from './bonnet';
import type { StorageGridShape } from './trunk';
import { AIR_FILTER_DUE_CLOG, airFilterBreath, airFilterWear } from './airfilter';
import {
  EngineCoolingSystem,
  ambientAirC,
  type CoolingState,
  type EngineTempReadout,
} from './cooling';
import { Drivetrain, matchGearbox } from './drivetrain';
import {
  STEERING_WHEEL_NODE,
  carModelFarGeometry,
  carModelShadowHull,
  carModelMeasure,
  createCarModel,
  type CarMidInstance,
  type CarModelMeasure,
} from '../render/carmodel';
import type { CarBodySurface } from '../render/carsurface';
import {
  FAR_CAR_ENTER_M,
  FAR_CAR_EXIT_M,
  MID_CAR_ENTER_M,
  MID_CAR_EXIT_M,
  type FarCarField,
} from '../render/farcars';
import { carPaintSeenFromAfar } from '../render/materials';
import { carPaintColor, type CarPaint } from './carpaint';
import type { ContactPatchField } from '../render/contactpatches';
import { patchOpacity } from '../render/contactpatches';
import type { VehicleLightRig } from '../render/vehiclelights';
import { SPOT_REACH_ALL } from '../render/lightshader';
import { SWING_REACH_M } from '../render/kitdraw';
import { KitRig } from '../carkit/rig';
import { KIT_DOME_LAMP_NODE } from '../carkit/interior';

import {
  AIR_DENSITY,
  ANTI_DIVE_FRACTION,
  ANTI_SQUAT_FRACTION,
  AUTO_DIRECTION_RELEASE_MPS,
  AXLE_ROLL_LIMIT_RAD,
  type AxleGeometry,
  BEAM_AXLE_GYRATION_SQ,
  BODY_CONDITION_EMIT_INTERVAL,
  BODY_DIRT_ROAD_FILM,
  BODY_DIRT_TYRE_METRES_TO_FULL,
  BOUNCE_AMPLITUDE_METRES,
  BOUNCE_HOP_HZ,
  BOUNCE_SQUASH_MAX,
  BUMP_STEER_FULL_ROUGHNESS,
  BUMP_STEER_SUSTAINED_TAU,
  BUMP_STEER_TAU,
  BUMP_STOP_FRACTION,
  BUMP_STOP_PEAK,
  CAMBER_GRIP_LOSS_PER_DEG,
  CAMBER_STIFFNESS_CROSSPLY,
  CAMBER_STIFFNESS_RADIAL,
  CARRIED_MASS_EPSILON_KG,
  CHASSIS_ANGULAR_DAMPING,
  COM_DROP_FRACTION,
  CONTACT_PATCH_M,
  DAMPER_BLEED_GAIN,
  DAMPER_BLEED_KNEE_MPS,
  DEFORMATION_DRAG_FULL_MPS,
  DEFORMATION_DRAG_START_MPS,
  DESTROYED_ENGINE_SPEED_CAP_MPS,
  DIG_FIRM_MU,
  DIG_FIRM_RR,
  DIG_FULL_MPS,
  DIG_GONE_MPS,
  DIG_SURFACES,
  DRAG_CD,
  DRIVELINE_LAG_S,
  FLUID_DENSITY_OIL,
  FOOT_BRAKE_GRIP_RATIO,
  FOOT_BRAKE_REAR_BIAS,
  FUEL_EMIT_INTERVAL,
  GRAVITY,
  GRIP_MASS_EXPONENT,
  GRIP_REFERENCE_MASS,
  HANDLING_PROFILES,
  tyreCurve,
  brushPeakTan,
  combinedLateral,
  combinedLongitudinal,
  combinedLongitudinalSlope,
  longitudinalPeakShare,
  longitudinalSlipUnit,
  slidingFloor,
  slidingRatio,
  type TyreCurve,
  type HandlingTuning,
  IMPACT_UNEXPLAINED_FLOOR_MPS,
  BODY_SHELL_MASS_FRACTION,
  ENGINE_ABOVE_CRANK_M,
  ENGINE_HEIGHT_M,
  ENGINE_LENGTH_M,
  ENGINE_WIDTH_M,
  GEARBOX_LENGTH_M,
  GEARBOX_SECTION_M,
  LONGITUDINAL_ENGINE_BEHIND_FRONT_AXLE_M,
  TRANSFER_BOX_LENGTH_M,
  TRANSVERSE_ENGINE_AHEAD_OF_FRONT_AXLE_M,
  thinBoxShellMoment,
  LATERAL_STATIC_SPEED_MPS,
  LOAD_BED_BEHIND_REAR_AXLE,
  LOAD_BOOT_BEHIND_REAR_AXLE,
  LOAD_CARGO_HALF_HEIGHT,
  LOAD_ENGINE_ABOVE_FLOOR,
  LOAD_FLOOR_FRACTION,
  LOAD_SEAT_ABOVE_FLOOR,
  LOAD_SEAT_BEHIND_FRONT_AXLE,
  LOAD_TANK_AHEAD_OF_REAR_AXLE,
  LOAD_TANK_BELOW_FLOOR,
  LOAD_SENSITIVITY,
  LOAD_SENSITIVITY_MAX,
  LOAD_SENSITIVITY_MIN,
  LOCK_SLIP_RATIO,
  LONGITUDINAL_RELAXATION_FLOOR_MPS,
  LOW_RANGE_FULL_MPS,
  LOW_RANGE_GONE_MPS,
  LOW_RANGE_MU,
  LOW_RANGE_SURFACES,
  MOUNT_ABOVE_WHEEL_CENTRE,
  ODOMETER_EMIT_INTERVAL,
  OIL_STARVE_SECONDS,
  PARK_BRAKE_DECEL,
  PARK_HOLD_MIN_LOAD_FRACTION,
  PARK_HOLD_SPEED_MPS,
  PNEUMATIC_TRAIL_M,
  pneumaticTrailShape,
  aligningMomentPeak,
  REAR_AXLE_SIDE_GRIP,
  SCRATCH_IMPACT_THRESHOLD_MPS,
  SCRATCH_PER_IMPACT_CAP,
  SCRATCH_PER_SEVERITY_MPS,
  FLIP_HOLD_RELEASE_SECONDS,
  SLIDE_CONE_THRESHOLD,
  SLIDE_MIN_MPS,
  SLIDE_ONSET_TAU,
  SLIDE_RECOVER_TAU,
  SLIP_ANGLE_REF_MPS,
  SLIP_REFERENCE_MPS,
  STEERING_WHEEL_HALF_LOCK_RAD,
  STEER_ASSIST_SLIP_MARGIN,
  STEER_FREE_TAU_S,
  SUSPENSION_FORCE_HEADROOM,
  TRANSFORM_EMIT_INTERVAL,
  TWO_PI,
  TYRE_COOLING_AIRFLOW_GAIN,
  TYRE_COOLING_STILL_W_PER_K,
  TYRE_DAMPING_RATIO,
  TYRE_MAX_C,
  TYRE_ROLLING_HEAT_SHARE,
  TYRE_SLIP_HEAT_SHARE,
  TYRE_TREAD_CAPACITY_J_PER_K,
  WHEEL_SUBSTEPS,
  WHEEL_MASS_KG,
  WHEEL_REFERENCE_RADIUS,
  clamp,
  FUEL_DENSITY,
  rotateVector,
  stockRadiatorWater,
  tyreTemperatureGrip,
  tyreVerticalRate,
  unsprungMass,
  KEYS_IN_RATE_RAD_S,
  KEYS_OUT_RATE_RAD_S,
  KEYS_RETURN_SETTLE_RAD,
  KEYS_RETURN_TAU_S,
  KEYS_RAMP_S,
  KEYS_START_RATE_RAD_S,
  KEYS_RATE_REF_MPS,
  ABS_MIN_KMH,
  ABS_MIN_SCALE,
  ABS_RECOVER_S,
  ABS_RELEASE,
  TCS_MIN_SCALE,
  TCS_RECOVER_S,
  TCS_REF_MPS,
  TCS_RELEASE,
  TCS_SLIP,
} from './vehicletuning';
import { VehicleLamps, type BeamGroup, type HeadlightMode, type IndicatorSide } from './vehiclelamps';
import { TyreContacts, type TyreContact } from './tyrecontact';
import { weather, weatherGrip, weatherSoftness, windAt } from '../world/weather';

const KIT_MIRRORS: readonly KitMirror[] = ['inner', 'left', 'right'];
/** Each mirror's rig channel prefix: `<prefix>_yaw`, `<prefix>_pitch`. */
const KIT_MIRROR_CHANNEL: Readonly<Record<KitMirror, string>> = { inner: 'mirror', left: 'mirror_l', right: 'mirror_r' };

/**
 * Crossflow drag coefficient of a body's flank, on its measured side box (length ×
 * body height). A car broadside to the air is a bluff body: about 1.0 on the side
 * profile, which fills some 85% of the box. It is the side force at large aerodynamic
 * yaw (a crosswind at walking pace, a car sliding sideways); at small yaw the
 * `AeroSpec.sideSlope` term dominates.
 */
const CROSSFLOW_CD = 0.85;
/**
 * Height of the aerodynamic centre (where the drag and the side force act) as a
 * fraction of the body box above its floor: the frontal area's centroid sits a little
 * below the box's middle, because the glasshouse is narrower than the body under it.
 */
const AERO_CENTRE_HEIGHT_FRACTION = 0.45;
/** Read-only zero for Rapier setters; never written. */
const ZERO_VECTOR: Readonly<{ x: number; y: number; z: number }> = { x: 0, y: 0, z: 0 };

/**
 * The rear axle's share of the foot brake at equal line pressure: FOOT_BRAKE_REAR_BIAS
 * per wheel, over the wheels each axle has. Below a rear regulator's knee this is the
 * whole split; past it the regulator takes the rear's share down (`rearValvePressure`).
 */
function rearAxleBrakeShare(frontWheels: number, rearWheels: number): number {
  const rear = rearWheels * FOOT_BRAKE_REAR_BIAS;
  const total = frontWheels * (1 - FOOT_BRAKE_REAR_BIAS) + rear;
  return total > 0 ? rear / total : 0;
}

/**
 * Rear line pressure out of a load-sensing regulator, both as shares of a floored
 * pedal's master-cylinder pressure: equal to the master cylinder's up to the knee, then
 * `slope` of every further rise (`CarModelDef.rearBrakeValve`). A car without one has an
 * infinite knee.
 */
function rearValvePressure(pedal: number, knee: number, slope: number): number {
  return pedal <= knee ? pedal : knee + slope * (pedal - knee);
}

/**
 * Straight-line threshold deceleration, g: the most the car stops at before either axle
 * asks its tyres for more than `peakMu` of their load. The axle loads are the steady
 * transfer `n = n0 ± χ·z` (χ = CoM height / wheelbase) with the tyre's LOAD_SENSITIVITY,
 * and the pedal is shared between the axles as the brakes share it: `rearShare` of the
 * force up to the regulator's knee, less past it. The knee itself rides on the rear
 * springs, which see the transfer the links do not carry (ANTI_DIVE_FRACTION):
 * `kneeParked · (1 − (1 − ANTI_DIVE_FRACTION)·χ·z / rear0)`.
 *
 * Bisection on z, because the knee moves with the deceleration it decides: each trial
 * deceleration fixes the rear load and so the knee, the pedal that produces that total
 * follows in closed form, and the trial holds if both axles' share fits their tyres
 * and the pedal is not past the floor.
 */
function thresholdBrakeG(
  peakMu: number,
  transfer: number,
  front0: number,
  rearShare: number,
  fullG: number,
  kneeParked: number,
  slope: number,
): number {
  const rear0 = 1 - front0;
  const frontShare = 1 - rearShare;
  let lo = 0;
  let hi = fullG;
  for (let i = 0; i < 24; i++) {
    const z = 0.5 * (lo + hi);
    const unload = 1 - ((1 - ANTI_DIVE_FRACTION) * transfer * z) / Math.max(1e-6, rear0);
    const knee = kneeParked === Infinity ? Infinity : kneeParked * Math.max(0, unload);
    const pedal =
      knee * fullG >= z ? z / fullG : (z / fullG - rearShare * knee * (1 - slope)) / (frontShare + rearShare * slope);
    const frontForce = fullG * frontShare * pedal;
    const rearForce = z - frontForce;
    const nFront = front0 + transfer * z;
    const nRear = Math.max(0, rear0 - transfer * z);
    const frontCap = front0 > 0 ? peakMu * nFront * (1 - LOAD_SENSITIVITY * (nFront / front0 - 1)) : 0;
    const rearCap = rear0 > 0 ? peakMu * nRear * (1 - LOAD_SENSITIVITY * (nRear / rear0 - 1)) : 0;
    if (pedal <= 1 && frontForce <= frontCap && rearForce <= rearCap) lo = z;
    else hi = z;
  }
  return lo;
}

/**
 * Both ends of a beam axle are on the ground with load on them: the condition under
 * which the wheel pass hands the pair to `stepBeamAxleHop` instead of stepping each
 * wheel's hop alone. One predicate, so the two can never disagree about a pair.
 */
function beamAxleDown(a: WheelVisual, b: WheelVisual): boolean {
  return a.inContact && a.loadN > 0 && b.inContact && b.loadN > 0;
}

interface WheelVisual {
  index: number;
  /** Where this tyre touches the ground, and its spring and damper (vehicle/tyrecontact.ts). */
  tyre: TyreContact;
  isFront: boolean;
  /** Sign of the wheel's chassis-local lateral position; left=-1, right=+1. */
  sideSign: number;
  radius: number;
  /**
   * The suspension's GEOMETRY, metres (see `rebuild`).
   *
   * A spring does not grow longer because the boot is full: its free length is what it
   * was cut to, and the travel is the gap between the top mount and the bump stop. Both
   * are cut once from the KERB design and never re-derived from the load — what the
   * load changes is only WHERE IN THAT TRAVEL the car settles. Re-deriving them per
   * load is what used to cancel the sag and leave nothing but the softness.
   */
  restLengthM: number;
  maxTravelM: number;
  /** The sag the KERB load settles at, metres: the stance the geometry was cut for. */
  designSagM: number;
  /** Bump travel past that stance before the stop is fully crushed, metres. */
  bumpTravelM: number;
  /**
   * What this corner's bump stop makes when fully crushed, newtons.
   *
   * A cut of the RUBBER, like the spring rate and the travel: `BUMP_STOP_PEAK` times
   * the corner load the car was designed at. Multiplying the load it is carrying
   * instead makes a heavy car's stop stronger than a light one's, which is what threw
   * a loaded car at every bump it met.
   */
  bumpStopPeakN: number;
  /**
   * The static compression the load asks of the spring, metres: what this corner would
   * settle at if the travel were long enough to allow it. Where it actually settles is
   * `compressionM`, which is short of this whenever the bump stop is carrying part of
   * the corner — which is what an overloaded corner does.
   */
  sagM: number;
  /** What this corner carries when the car is parked and level, newtons. */
  staticLoadN: number;
  /**
   * This corner's SPRING and DAMPER, in absolute SI units — N/m and N·s/m.
   *
   * Absolute rather than per-kilogram on purpose: a per-kilogram figure multiplied by
   * the chassis mass makes an unloaded car and a loaded one settle at the same ride
   * height. These do not change with load, so the load does. `tyre` carries the same
   * figures (`reloadSprings`).
   */
  springRateNPerM: number;
  compressionRateNsPerM: number;
  relaxationRateNsPerM: number;
  /** Ride frequency this corner currently heaves at, Hz, at the mass it is carrying. */
  rideHz: number;
  /**
   * Tread temperature, degrees C, and the grip multiplier it currently implies.
   *
   * The only tyre STATE in the model: it is what the three things that heat a tyre —
   * slip power, drive torque and the sun — accumulate into, and what the grip budget
   * is finally read against. See the thermal block above the constants.
   */
  tyreTempC: number;
  tyreGrip: number;
  /** Progressive bump-stop force applied this step, newtons. */
  bumpStopN: number;
  /**
   * The damper's low-speed bleed force this step (N), positive pushing the body up:
   * what the damper makes beyond the contact's linear part (see `DAMPER_BLEED_GAIN`).
   */
  bleedN: number;
  /**
   * Anti-roll bar force on this corner (N), positive pushing the body up — the outer
   * wheel's share of the roll the bar resists. Applied to the body at the contact patch,
   * so the TYRE carries it too; see where it is added to `loadN`.
   */
  barN: number;
  /** This axle's anti-roll bar, as a fraction of its wheel rate (see `SuspensionTuning`). */
  barFraction: number;
  /**
   * This axle's ROLL CENTRE, as the chassis-local height the side force is handed to
   * the body at, and as its height above the road (see `SuspensionTuning`). The first is
   * the contact plane plus the second, fixed to the body, so the roll axis rolls with it.
   */
  rollCentreLocalY: number;
  rollCentreM: number;
  /** This axle's track, metres: the lever the link-borne transfer is spread across. */
  axleTrackM: number;
  /**
   * The wheel's alignment, resolved to this corner from its axle's `SuspensionTuning`
   * and expressed along the chassis' +X, so no left/right convention can flip it. A
   * positive steer angle heads the wheel toward +X, and a positive axle roll is the body
   * leaning toward +X (that side's springs compressed):
   *
   *   toeRad       static steer: the toe-in, in this side's sign
   *   leanRad      static camber, as the top of the tyre leaning toward +X
   *   rollCamber   share of the axle's roll the wheel leans with (0 for a beam)
   *   rollSteer    steer per unit of axle roll, signed so a positive preset
   *                coefficient understeers on either axle
   */
  toeRad: number;
  leanRad: number;
  rollCamber: number;
  rollSteer: number;
  /**
   * The wheel at the other end of this one's BEAM AXLE (`SuspensionTuning.frontAxle` /
   * `rearAxle`), or null on an independent axle. A beam's two wheels share one unsprung
   * body (`stepBeamAxleHop`) and one camber, the axle's own tilt (`beamLeanRad`).
   */
  beamPartner: WheelVisual | null;
  /**
   * A beam wheel's camber this step from the AXLE'S tilt against the ground under this
   * wheel, radians, leaning toward +X (see `toeRad`). Zero on a flat road whatever the
   * body does; on an independent axle it stays zero and `rollCamber` is read instead.
   */
  beamLeanRad: number;
  /**
   * Side force this tyre put through the links last step, newtons, resolved onto the
   * body's own +X: the input to the axle's GEOMETRIC load transfer.
   */
  sideForceBodyXN: number;
  /**
   * The GEOMETRIC load transfer on this corner (N), positive loading the tyre: the share
   * of the axle's cornering moment the links carry straight to the road without rolling
   * the body, `side force · roll-centre height / track`. It loads the tyre and not the
   * body, so it is added to `loadN` and never applied as an impulse.
   */
  linkN: number;
  /** This tyre's vertical carcass rate, N/m. Nothing to do with the springs. */
  tyreRateN: number;
  /**
   * Enveloped sub-collider ground height under this wheel (m) and its rate (m/s).
   * "Enveloped" because a tyre cannot see detail shorter than the patch it stands on:
   * the profile is low-passed over CONTACT_PATCH_M of TRAVEL before it gets here, so
   * the filter is in metres and does not soften with speed.
   */
  profileHeight: number;
  profileRate: number;
  /** Wheel-hop state: unsprung deflection (m) and its rate (m/s). See the tyre block. */
  hopZ: number;
  hopV: number;
  mesh: THREE.Object3D;
  /**
   * How far into THE DIG this wheel is, 0..1 — see the block comment on `DIG_FIRM_MU`.
   *
   * One step old by the time the setup pass reads it, like every other ground quantity
   * a wheel publishes, and that is what lets the same number drive both halves of the
   * concession: the friction floor in the tyre force and the rolling resistance the
   * chassis drags against.
   */
  digWeight: number;
  /**
   * This step's longitudinal capacity and the force the tyre actually took from it,
   * newtons.
   *
   * Published because what a tyre does on a loose surface is a conversation between
   * three numbers — what the ground offers, what the aid allows and what the wheel
   * asks for — and no bench could see any of them. `tools/climb-sweep.ts` reads these
   * to explain WHY a grade is or is not climbable, rather than only reporting that it
   * is not.
   */
  longitudinalCapacityN: number;
  longitudinalForceN: number;
  /** Registered surface under this wheel this step; read by the spray. */
  groundSurface: SurfaceType;
  /** Did this wheel find a collider this step? Read by the spray. */
  grounded: boolean;
  /** Smoothed slide amount, 0 = inside the friction cone, 1 = fully saturated. */
  slideT: number;
  /** Locked and sliding: emergent from the wheel's rotation, or the handbrake on a rear. */
  locked: boolean;
  /** Physical wheel speed (rad/s), integrated by updateWheelDynamics. */
  spinRadS: number;
  /** Accumulated spin (radians) for rendering. A stalled wheel stops accumulating. */
  drawnSpin: number;
  /**
   * The wheel's drawn pose (spin, suspension length, steer) at the last two fixed
   * steps, interpolated at render like the chassis. Drawn raw at 100 fps over a 60 Hz
   * step, a wheel advanced by one step on one frame, two on the next and none on the
   * third: a visible stutter on every car alongside.
   */
  spinPrev: number;
  spinStep: number;
  suspPrev: number;
  suspStep: number;
  steerPrev: number;
  steerStep: number;
  /** Longitudinal slip ratio, (ωr - v)/max(|v|, ref). Negative under lock-up. */
  slipRatio: number;
  /**
   * The slip ratio the CARCASS has built, lagged behind `slipRatio` by the tyre's
   * longitudinal relaxation length (LONGITUDINAL_RELAXATION_RATIO). The drive and brake
   * force, and the longitudinal half of combined slip, are read at this.
   */
  carcassSlip: number;
  /**
   * Normal load (N) the tyre carries this step: the spring and damper, bump stop,
   * damper bleed and anti-roll bar of this step's travel, and the links' share of last
   * step's side force (`linkN`).
   */
  loadN: number;
  /** Spring compression from rest this step, metres; negative in droop. */
  compressionM: number;
  /**
   * Slip angle the CARCASS has actually built, radians, lagged behind the geometric
   * one by the relaxation length. This is the angle the side-force curve is read at.
   */
  slipAngleRad: number;
  /**
   * The geometric slip angle this step's patch velocity asks for, radians, and the
   * share of the way to it the carcass winds in one substep — its rolling distance in
   * the substep over the relaxation length: read once a step, and relaxed toward per
   * substep into `slipAngleRad`.
   */
  geometricSlipRad: number;
  slipRelaxBlend: number;
  /**
   * Lateral force capacity (N), the wheel-plane right vector and the contact's sideways
   * speed, plus the side-force curve as this tyre stands this step: its normalised side
   * slip σy (`sideSlip`, tan of the built angle over the peak's tangent) and the curve
   * arguments `combinedLateral` reads it with (the fade ones on loose ground only). The
   * curve and the capacity are sized in the setup pass; the patch's geometry, the
   * camber's share of the capacity and the side slip in the tyre pass, off this step's
   * contact.
   */
  lateralCapacityN: number;
  sideSlip: number;
  sidePeakTan: number;
  sideFadePeakDeg: number;
  sideFullDeg: number;
  sidePlateau: number;
  /**
   * How the patch slides on the ground under it this step (`SurfaceProps.slide`): on
   * loose ground the placeholder curves with `slideFloor` the constant sliding share;
   * on a paved surface the brush with `slideFloor` the μ_k / μ_p the sliding ratio
   * decays to (`slidingFloor`), read per substep at the patch's sliding speed.
   */
  slideLoose: boolean;
  slideFloor: number;
  lateralRightX: number;
  lateralRightY: number;
  lateralRightZ: number;
  lateralSpeed: number;
  /**
   * The camber thrust's horizontal shift this step, as extra steer in the wheel's own
   * sign (`camberStiffness · lean`): what the steering assist adds to the geometry to
   * know which rack angle puts the tyre at its peak.
   */
  camberSteerRad: number;
  /**
   * The tyre's moment about its steering axis last step, N·m, in the rack's sign
   * (positive turns the wheel toward +X): side force times pneumatic plus mechanical
   * trail. Front wheels only; the steering sums it (`STEER_FREE_TAU_S`).
   */
  kingpinMomentNm: number;
  /** Mechanical trail of a front wheel's caster, metres; 0 at the rear. */
  casterTrailM: number;
  /**
   * Where this tyre's aligning moment peaks (`aligningMomentPeak`): the normalised
   * slip, and the moment there as a share of capacity · PNEUMATIC_TRAIL_M. The
   * steering-lightness cue measures the moment against it.
   */
  alignPeakZ: number;
  alignPeakShape: number;
  /** The patch's combined normalised slip σ last step: the trail collapses with it. */
  alignSlip: number;
  /** Drive torque (N·m) commanded to this wheel this step. */
  driveTorqueNm: number;
  /** Brake force (N) commanded to this wheel this step. */
  brakeForceN: number;
  /** Held still by the handbrake's cable this step, whatever the tyre asks of it. */
  cableLocked: boolean;
  /** Wheel forward tangent in world space; projected onto steep contact surfaces. */
  forwardDir: { x: number; y: number; z: number };
  /** Contact point, normal and chassis-frame velocity; all reused every step. */
  contactPoint: { x: number; y: number; z: number };
  contactNormal: { x: number; y: number; z: number };
  contactVel: { x: number; y: number; z: number };
  /**
   * The step's contact, read ONCE from `tyre` and the body before the wheel
   * substeps (`WHEEL_SUBSTEPS`) and held through all of them: whether the tyre touches,
   * the surface under it, the patch's speed along the wheel plane, the bare wheel's
   * inertia (the crank's share is added per substep, because the clutch can lock or
   * slip between them), the longitudinal coefficient before the dig and the low range,
   * and the surface's slip scale.
   */
  inContact: boolean;
  contactSurface: SurfaceType;
  contactSpeed: number;
  discInertia: number;
  longitudinalMu: number;
  longitudinalLoadFactor: number;
  slipScale: number;
  /**
   * Means over the step's substeps, each substep weighted by its share of the step:
   * the share of the longitudinal capacity used, the side-force curve's value as a share
   * of the lateral capacity, the share of that capacity the static hold may spend, and
   * the longitudinal slip power, watts. The step's force is `longitudinalForceN`.
   */
  gripUsage: number;
  sideCurveShare: number;
  sideStaticShare: number;
  longitudinalSlipPowerW: number;
}

/**
 * Everything the audio layer needs to voice this car, written in place once per
 * fixed step. It is telemetry, not a sound description: the simulation reports
 * rpm, load, slip and surface, and src/audio/vehicleaudio.ts decides what that
 * sounds like. Nothing here is allocated per tick.
 */
export interface VehicleAudioState {
  rpm: number;
  idleRpm: number;
  redlineRpm: number;
  cylinders: number;
  /** Applied throttle, 0..1 — already zeroed by an empty tank. */
  throttle: number;

  brake: number;
  handbrake: boolean;
  /** Signed forward speed, m/s. */
  forwardMps: number;
  engineRunning: boolean;
  engineDestroyed: boolean;
  /** Coolant temperature, degrees C: a hot block ticks as it cools, a cooked one boils. */
  engineTempC: number;
  /** Stalled by overheating: the radiator is boiling over. */
  overheatStalled: boolean;
  gearLabel: string;
  /** Wheels on the ground / total wheels. */
  wheelContactFraction: number;
  /** Mean micro-bump amplitude of the surfaces under the loaded wheels, metres. */
  surfaceRoughness: number;
  /** Body-frame sideways speed, m/s: the tyres' side slip. */
  lateralSlipMps: number;
  /** Downward speed killed by the ground this step, m/s. 0 when nothing landed. */
  landingImpactMps: number;
  /**
   * Mean lock-up per axle, 0..1 (see BRAKE_LOCK_* above). A tyre dragged along
   * without turning howls even in a straight line, which lateral slip alone never
   * reports — so the skid voice needs this to sound a no-ABS stop.
   */
  frontLockT: number;
  rearLockT: number;

  // --- engine character: what the engine IS, for the voice to be built from ---
  /**
   * Swept volume estimate, litres. Not in the catalogue, so it is read off the torque:
   * a naturally aspirated petrol makes ~85 Nm a litre. Only the audio uses it, to size
   * the exhaust and the pulse.
   */
  displacementL: number;
  /** A turbocharger is fitted under the bonnet. */
  turbo: boolean;
  /** Stable per-engine number, 0..1: every copy of one engine sounds the same. */
  engineSeed: number;

  // --- ground ---
  /** The surface under most of the loaded wheels. */
  surface: SurfaceType;

  // --- events, ACCUMULATED: the largest since the audio layer last consumed them ---
  /**
   * Fastest suspension compression since last consumed, m/s. A pothole, a joint, a
   * rock: the chassis jolts through the springs. The audio layer zeroes it on read.
   */
  bumpMps: number;
  /** Largest unexplained horizontal speed loss (a collision), m/s. Zeroed on read. */
  impactMps: number;
}

/**
 * A collision the chassis velocity change cannot be explained by its own tyres and
 * drag. Direction points from the object into the chassis, in chassis-local space.
 */
export interface VehicleImpact {
  /** Speed the chassis lost this step that its own tyre and drag forces cannot explain, m/s. */
  readonly severityMps: number;
  /** Unit direction the blow came FROM, in chassis-local space (+Z forward, +X right, +Y up). */
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
}

/**
 * Per-wheel telemetry consumed by the pooled ground effects: where the tyre is, which
 * way it points, the ground plane, and how hard it is disturbing that ground. Written
 * in place once per fixed step; nothing here is allocated per tick.
 */
export interface WheelSprayState {
  /**
   * Contact patch position RELATIVE to the floating origin, metres — the same frame
   * Rapier and the scene graph use, so `emitSpray` can drop it straight into the
   * particle buffer. Consumers that sample the world (road projection, terrain
   * surface) must use `absoluteContactX/Z` instead: sampling a noise field at a
   * rebased coordinate silently changes the ground's shape.
   */
  contactX: number;
  contactY: number;
  contactZ: number;
  /** Contact patch position in ABSOLUTE world coordinates (X and Z; Y never shifts). */
  absoluteContactX: number;
  absoluteContactZ: number;
  /**
   * Wheel-plane forward direction in world space, unit length.
   *
   * All three components, because the contact patch's long axis is this direction
   * PROJECTED INTO THE GROUND PLANE, and the projection needs the component along the
   * normal to remove. With Y dropped, a patch on a 20-degree slope came out rotated by
   * about fifteen degrees against the tyre that cast it.
   */
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  /** Terrain contact normal in world axes, unit length. */
  normalX: number;
  normalY: number;
  normalZ: number;
  /**
   * Is this wheel touching anything? A wheel in the air reports whatever slip its
   * free spin produces, and `surface` falls back to asphalt when there is no
   * collider — which is a SMOKING surface, so without this a launched car would
   * trail smoke through the air.
   */
  inContact: boolean;
  /**
   * Registered surface of the collider under this wheel. The spray reads it to
   * decide between thrown grit and tyre smoke; see `emitSpray` in main.ts, which
   * refines it against the terrain's own surface field off the road.
   */
  surface: SurfaceType;
  /** Longitudinal slip ratio this tick. */
  slipRatio: number;
  /**
   * Longitudinal slip ratio PAST the slip that counts as one on this surface, 0 while
   * the tyre is still working (`longitudinalSlipUnit`: the peak on loose ground, the
   * whole patch sliding on a paved one). What spray and dark tracks show:
   * a hard launch at the tyre's best is not a wheelspin and throws nothing.
   */
  slideSlip: number;
  /** Chassis forward speed, m/s (signed). */
  forwardSpeed: number;
}

/**
 * Per-wheel RIDE state, as opposed to the spray's per-wheel contact state.
 *
 * This is the only window onto the suspension anything outside this file has, and it
 * exists because the three things that decide whether a car rides like a car —
 * where its weight sits, how far the springs are compressed, and how much of the
 * travel is left — are otherwise invisible: the contacts keep them per wheel and the
 * game only ever sees the chassis pose that results.
 *
 * Written in place once per fixed step; nothing here allocates.
 */
export interface WheelRideState {
  readonly isFront: boolean;
  /** left = -1, right = +1. */
  readonly sideSign: number;
  inContact: boolean;
  /** Normal load (N) this wheel is carrying (`WheelVisual.loadN`). */
  loadN: number;
  /** What it carries PARKED (N), from the axle geometry and the weight distribution. */
  staticLoadN: number;
  /** Spring compression from rest, metres. Negative while the wheel hangs in droop. */
  compressionM: number;
  /** Compression still available before the bump stop is fully shut, metres. */
  reserveM: number;
  /** Force the bump stop is contributing (N), 0 until the spring runs out of travel. */
  bumpStopN: number;
  /** Tyre carcass deflection from the sub-collider profile, metres (see WheelHop). */
  tyreDeflectionM: number;
  /**
   * Tread temperature, degrees C, and the grip multiplier it currently implies.
   *
   * Published because a driver cannot feel them through a keyboard and they are a
   * real, live part of how the car behaves: cold tyres are a little off, hot ones are
   * at their best, and abused ones are greasy. See `tyreTemperatureGrip` for the
   * curve these two are the two ends of.
   */
  tyreTempC: number;
  tyreGrip: number;
}

/**
 * One mass that is not the kerb body, and where it sits. Chassis-local metres: x
 * right, y up, z forward, origin at the measured body box centre.
 *
 * `massKg` is signed. Every load is a DELTA from the state `model.mass` describes —
 * a complete car with its reservoirs full — so a half-empty tank is a negative mass
 * at the tank, and one that still carries a full tank is no load at all.
 */
export interface LoadPoint {
  /** What it is, for a bench or a readout: "fuel", "boot cargo", "engine bay". */
  readonly label: string;
  readonly massKg: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where each load anchor sits, all four cut once from the measured geometry. */
interface LoadAnchors {
  readonly tank: { readonly y: number; readonly z: number };
  readonly engine: { readonly y: number; readonly z: number };
  readonly hold: { readonly y: number; readonly z: number };
  readonly seat: { readonly y: number; readonly z: number };
}

/** `CarStats` plus the load sheet: the masses outside the kerb body and where they are. */
interface VehicleStats extends CarStats {
  readonly loads: readonly LoadPoint[];
}

/**
 * A car's root that does not walk its subtree's world matrices while hidden.
 *
 * Three's `updateMatrixWorld` visits every descendant every frame, shown or not, and a
 * kit car is some 260 objects: with the far traffic hidden behind the far field, its
 * cars were most of the scene's 6000 objects and the walk was the largest single cost in
 * the frame's script after the draws. Hidden, only the root's own matrix is kept, so
 * anything placing itself from the car's pose still reads it; the frame it shows again
 * its moved matrix forces the whole subtree. A descendant asked for its world position
 * meanwhile updates its parents itself (`getWorldPosition`).
 */
class HiddenStillGroup extends THREE.Group {
  override updateMatrixWorld(force?: boolean): void {
    if (this.visible) {
      super.updateMatrixWorld(force);
      return;
    }
    this.updateWorldMatrix(false, false);
    this.matrixWorldNeedsUpdate = true;
  }
}

/** No cabin places: a car whose model is not built yet. */
const NO_CABIN_ROOMS: CabinRooms = [];

/** What lies in a cabin weighs, kg. */
function cabinMass(cabin: readonly (Item | null)[]): number {
  let mass = 0;
  for (const item of cabin) if (item) mass += itemMass(item);
  return mass;
}

/** Where this frame is seen from (scene frame) and its length; see `Vehicle.viewFrom`. */
const kitEye = new THREE.Vector3();
let kitEyeKnown = false;
/** The car the player sits in, any seat (`Vehicle.viewFrom`): its cabin's fine detail always draws. */
let kitOccupied: Vehicle | null = null;
let kitFrameDt = 1 / 60;
const kitEyeLocal = new THREE.Vector3();

/**
 * A near traffic car this close to the eye casts its own meshes; further out its far mesh
 * casts for it (`castNearShadows`). In the sun's near cascade (render/sky.ts
 * `sunNearLight`, 1.6 cm a texel) the far mesh's shadow shows what it is: wheels that do
 * not steer, lenses and trim that cast, gaps that close. In the wide map (7 cm) the two
 * are the same picture. Coming in at the cascade's half side, out 2 m further, so a car
 * holding its distance does not swap every frame.
 */
const SELF_SHADOW_ENTER_M = GRAPHICS_CONFIG.shadowCascadeHalfSize;
const SELF_SHADOW_EXIT_M = SELF_SHADOW_ENTER_M + 2;

/**
 * A Zhiguli's oil pressure, kgf/cm²: about 2 hot at idle, 4.5 from 3000 rpm up (the
 * relief valve holds it there). Below 40% of the sump the pickup draws air and it falls
 * away. The warning lamp's switch closes under 0.5.
 */
const OIL_IDLE_KGF = 2;
const OIL_REVS_KGF = 4.5;
const OIL_REVS_RPM = 3000;
const OIL_STARVE_FRACTION = 0.4;
const OIL_LAMP_KGF = 0.5;
/**
 * Volts on the cluster: a rested battery with the key on, the regulator's 13.5 at idle
 * rising to 14.2 once the alternator is spun past 1500 rpm, and up to 0.4 V lost to the
 * headlamps (most of it while the alternator idles).
 */
const BATTERY_V = 12.4;
const CHARGE_IDLE_V = 13.5;
const CHARGE_FULL_V = 14.2;
const CHARGE_FULL_RPM = 1500;
const HEADLAMP_DROP_V = 0.4;
/**
 * The courtesy lamp's light on the cabin: a festoon bulb's warm 5 W behind a milky lens,
 * spread over a wide cone and fading out just past the floor. Inverse-linear rather than
 * square, so the seat cushions are not lost to the bright patch on the headliner's rim.
 * Set by eye at 23:00 on a 2107: 1.6 was invisible against the night ambient; 8 over
 * 2.2 m shows the seats, wheel and pedals without washing out the cluster.
 */
const DOME_TINT = 0xffd9a8;
const DOME_INTENSITY = 8;
const DOME_RANGE_M = 2.2;
const DOME_ANGLE = 1.25;
/**
 * Slack on the sphere a spot slot's reach is tested against (`syncSpotReach`), metres:
 * the body's bounce, squash, roll and pitch under the root, and the root not being the
 * measured box's centre to the millimetre.
 */
const SPOT_REACH_MARGIN_M = 0.5;

export class Vehicle implements Rebasable {
  private readonly physics: PhysicsWorld;
  private readonly world: GameWorld;
  private readonly car: CarState;
  private readonly model: CarModelDef;
  /** Shared immutable tuning selected once from the catalogue's mechanical family. */
  private readonly handling: HandlingTuning;
  /** The side-force curve: the car's own tyre's, or its profile's. */
  private readonly tyre: TyreCurve;
  private readonly measure: CarModelMeasure;
  /** The boot and bonnet grids' layout: the measured body and the model's boot grid. */
  readonly storageShape: StorageGridShape;
  /** The chassis box's half extents (x across, y up, z along the body), metres. */
  get bodyHalfExtents(): readonly [number, number, number] {
    return this.measure.halfExtents;
  }
  /** Axle positions, wheel counts and weight distribution; measured once, in `measureAxles`. */
  private readonly axleGeometry: AxleGeometry;
  /** Where fuel, cargo, the engine bay and the seat are; measured once, in `measureLoadAnchors`. */
  private readonly loadAnchors: LoadAnchors;
  private readonly scene: THREE.Scene;
  private readonly origin: WorldOrigin;
  /** Removes this runtime from floating-origin notifications when it despawns. */
  private originDisposer: (() => void) | null = null;
  private disposed = false;


  private readonly chassisBody: RAPIER.RigidBody;
  private readonly chassisCollider: RAPIER.Collider;
  private tyres: TyreContacts | null = null;
  private readonly drivetrain: Drivetrain;

  private statsValue: VehicleStats;
  /**
   * Share of the parked weight on the FRONT axle at the car's real centre of mass,
   * 0..1, as `applyChassisMass` last resolved it. Not the catalogue's kerb figure:
   * that one is the design point the springs are cut against, and this one is what
   * the car is actually carrying right now — a crate in the boot moves it.
   */
  private parkedFrontShare = 0;
  /**
   * Mass the driver is carrying, kg, pushed in by the composition root.
   *
   * The pack is the player's, not the car's, so `Vehicle` cannot read it; see
   * `setCarriedMass`. Kept as a field rather than folded into `computeStats` so the
   * mass only refreshes when the number actually moves.
   */
  private carriedMassKg = 0;

  private readonly rootGroup = new HiddenStillGroup();
  /** Per-car phase offset (turns) so traffic does not hop in unison; see `BOUNCE_HOP_HZ`. */
  private readonly bouncePhase: number;
  /** The body-and-trim subtree alone, for `BOUNCE_SQUASH_MAX`; wheels are siblings. */
  private bodyGroup: THREE.Object3D | null = null;
  /** This car's paint, created with its visuals; see render/carsurface.ts. */
  private surface: CarBodySurface | null = null;
  /**
   * The body's shadow hull (render/carshadowhull.ts) under the root, casting while the
   * car casts as itself; a car the far, mid or stand-in meshes draw casts it from the
   * shadow-only field instead (`castHull`).
   */
  private shadowHull: THREE.Mesh | null = null;
  /**
   * `bodyGroup`'s scale AT REST, captured once in `buildVisuals`. `buildTemplate`
   * (render/carmodel.ts) bakes each model's own unit-correction factor into this
   * scale — for one catalogue car it is ~0.0107, not 1 — so the squash MUST multiply
   * this rather than assign an absolute value: overwriting it with something near 1
   * once inflated a body to roughly 100x its size instead of squashing it by 20%.
   */
  private readonly bodyRestScale = new THREE.Vector3(1, 1, 1);

  private wheels: WheelVisual[] = [];
  /** Each beam axle's two wheels, the −X one first (see `beamPartner`). */
  private beamAxles: [WheelVisual, WheelVisual][] = [];
  /** One spray report per wheel, written in place every fixed step. */
  private wheelSprayStates: WheelSprayState[] = [];
  /** One ride report per wheel, written in place every fixed step. */
  private wheelRideStates: WheelRideState[] = [];
  /** Wheel objects taken from the instantiated model, keyed by wheel id. */
  private readonly wheelMeshes = new Map<string, THREE.Object3D>();
  /**
   * The cabin's steering wheel, turned to match the rack every frame.
   *
   * `steeringWheelRest` is the node's AUTHORED rotation about its own axis, which
   * the spin is added to rather than replacing: the wheel's rake lives in the same
   * Euler and overwriting it lays the rim flat.
   */
  private steeringWheel: THREE.Object3D | null = null;
  private steeringWheelRest = 0;
  /**
   * A kit body's moving parts (doors, lids, wheel, pedals, needles): built with the
   * visuals, posed every rendered frame from the driving state (`driveKit`). Its lenses
   * are left to `lamps`, which binds them like any other model's.
   */
  private kitRig: KitRig | null = null;
  /** The pedals as the driver's feet hold them, latched in the fixed step for `driveKit`. */
  private kitThrottle = 0;
  private kitHandbrake = 0;
  /**
   * The ignition is on: somebody drives this car (the player or the traffic), latched in
   * the fixed step. A parked car's oil gauge and voltmeter rest on their pins and its
   * warning lamps are dark, but for the lamps of the lights themselves (indicators, side
   * lights, main beam): those circuits need no key.
   */
  private kitIgnition = false;
  /** The kit courtesy lamp's node, which the cabin's light hangs from (`syncDomeLight`). */
  private kitDome: THREE.Object3D | null = null;
  /** What lies on the seats and floor of a kit car's cabin, drawn (vehicle/cabincargo.ts). */
  private cabinView: CabinCargoView | null = null;
  private readonly domeSource = new THREE.Vector3();
  private readonly domeTarget = new THREE.Vector3();
  /** This car's lamps: beam mode, indicator, lens materials and the beams they cast. */
  private readonly lamps: VehicleLamps;
  /** Threshold-pedal braking authority, m/s²; see `measuredBrakeDecel`. */
  private measuredBrakeDecelValue = 0;
  /** Pedal share at which the first axle reaches its tyres' peak; see `thresholdBrakePedal`. */
  private thresholdBrakePedalValue = 1;
  /**
   * The rear brake regulator (`CarModelDef.rearBrakeValve`), resolved in
   * `applyChassisMass`: the pedal share at which it closes with the rear springs at
   * their KERB compression (Infinity: the car has none), and the share of every further
   * rise in line pressure it passes to the rear brakes past that knee.
   */
  private rearValveKerbKnee = Infinity;
  private rearValveSlope = 1;
  /**
   * The parked rear spring load over the kerb load the springs were cut for: what the
   * regulator's lever reads standing still. The planner's estimate takes the knee from
   * it (`estimatedBrakeDecel`); the step reads the springs themselves.
   */
  private parkedRearSpringRatio = 1;

  /**
   * Seconds the dashboard's warning lamp still owes the player.
   */

  private readonly dragCoeff: number;
  /** ½·ρ·A·CLf and ½·ρ·A·CLr, N per (m/s)²: each axle's lift, wind-tunnel split (`AeroSpec`). */
  private readonly liftFrontCoeff: number;
  private readonly liftRearCoeff: number;
  /** ½·ρ·A·dCY/dβ, N per (m/s)² per radian: the side force's small-yaw slope. */
  private readonly sideSlopeCoeff: number;
  /** ½·ρ·CROSSFLOW_CD·side box, N per (m/s)²: the flank's drag at large yaw. */
  private readonly crossflowCoeff: number;
  /** How far ahead of the wheelbase's midpoint the small-yaw side force acts, metres. */
  private readonly sideCentreAheadM: number;
  /** Body-local height of the aerodynamic centre, metres (AERO_CENTRE_HEIGHT_FRACTION). */
  private readonly aeroCentreY: number;
  /** The wind at the car, m/s, from `windAt`. */
  private readonly windScratch = { x: 0, z: 0 };
  /** Body axes and an application point for `applyAero`; never allocated per tick. */
  private readonly aeroForward = { x: 0, y: 0, z: 0 };
  private readonly aeroRight = { x: 0, y: 0, z: 0 };
  private readonly aeroUp = { x: 0, y: 0, z: 0 };
  private readonly aeroPoint = { x: 0, y: 0, z: 0 };
  private readonly aeroOrigin = { x: 0, y: 0, z: 0 };

  // Axle bookkeeping for torque splitting and the drivetrain input.
  private frontWheelCount = 0;
  private rearWheelCount = 0;
  private frontDrivenCount = 0;
  private rearDrivenCount = 0;
  private drivenRadius = 0.35;

  // Steering state: the rack's angle, where the driver's hands have put it (rate limited
  // to the rack speed), or anywhere the tyres' aligning moment swings it when no hand is
  // on the wheel. The road wheels hang off it with no play, so it is also the rim's.
  private steerAngle = 0;
  /**
   * The load the tyres' load sensitivity and peak angle are referenced at, N: the car's
   * mean corner load (weight over the wheel count). One tyre all round, so the nose of
   * a nose-heavy car runs its tyres further up their load curve than its tail does.
   */
  private tyreReferenceLoadN = 1;
  /**
   * KEYBOARD STEERING (`SteerMode` 'keys', vehicletuning.ts): the steering wheel's angle,
   * radians at the rim and positive to the left like the rack.
   */
  private keysRimRad = 0;
  /** Seconds the current steering key has been held, and which way it points (−1/0/1). */
  private keysPressS = 0;
  private keysPressKey = 0;
  /**
   * The player drives this car from the driver's seat with their own hands, which is
   * what turns the driver aids on (ABS, traction control): see `setPlayerDriven`.
   */
  private playerDriven = false;
  /** Wheel-loop substeps per fixed step: `WHEEL_SUBSTEPS`, or the traffic's own count. */
  private wheelSubsteps = WHEEL_SUBSTEPS;
  /** See `setTreadCastGate`. */
  private treadCastGate = false;
  /** The driver aids' pedal scales, 1 when idle (`Settings.abs`, `Settings.tractionControl`). */
  private absScale = 1;
  private tcsScale = 1;
  /** Load-sensitive front bump-steer disturbance, filtered in fixedUpdate. */
  private bumpSteerAngle = 0;
  /** The front axle's sustained load difference, which is roll and not a bump. */
  private sustainedImbalance = 0;
  /**
   * Each axle's roll against the road, radians, positive with the body leaning toward
   * +X: the travel difference across the axle over its track (`updateAxleRoll`).
   */
  private frontRollRad = 0;
  private rearRollRad = 0;
  /** The suspension's share of true Ackermann, and the wheelbase it is drawn on. */
  private ackermann = 0;
  private wheelbaseM = 1;
  /** This car's tyre camber stiffness over its cornering stiffness, per radian. */
  private camberStiffness = CAMBER_STIFFNESS_RADIAL;
  private appliedDriveTorqueNm = 0;
  /**
   * Direction the driven wheels are PUSHING the car this step: the gear's direction
   * while the engine drives through it, 0 while it coasts or engine-brakes. The dig
   * and the low range answer to propulsion only.
   */
  private propulsionDirection = 0;
  /**
   * What the driveline did over the last step's substeps: whether any of them sent
   * drive torque to the hubs, and the fuel they burnt, litres.
   */
  private stepDriveTorque = false;
  private stepFuelBurnLitres = 0;
  /**
   * Parking hold is armed by the fixed update and applied after Rapier has stepped.
   * Freezing after the step removes the tiny gravity displacement that an impulse
   * wheel brake otherwise accumulates while a car is stopped on a slope.
   */
  private parkingHoldRequested = false;
  private parkingHoldActive = false;
  /** Distant traffic moved along its lane instead of driven; see `enterRails`. */
  private railsActive = false;
  private readonly railTranslation = { x: 0, y: 0, z: 0 };
  private readonly railVelocity = { x: 0, y: 0, z: 0 };
  private readonly railRotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly railAngvel = { x: 0, y: 0, z: 0 };
  /**
   * Seconds left before the parking hold may re-latch after `flipOver`. Counted down in
   * `settle`, so it only ever matters on a car nobody is driving.
   */
  private holdReleaseTimer = 0;
  /**
   * Service-brake demand from the last driven step, 0..1. Read by a coupled
   * trailer so its brakes come on with the car's pedal.
   */
  private serviceBrakeCommand = 0;
  /** Literal backward/brake control, retained while an automatic uses it as reverse throttle. */
  private brakeLightCommand = 0;
  // Relative (Rapier frame): read from the body when the hold first latches, then
  // re-applied every step — horizontal position and heading only; see `postStep`.
  // Shifted by `rebase` alongside the interpolation snapshots, so a held car does not
  // snap a kilometre when the origin moves.
  private readonly parkingHoldPos = { x: 0, y: 0, z: 0 };
  private parkingHoldYaw = 0;
  private readonly holdTranslation = { x: 0, y: 0, z: 0 };
  private readonly holdRotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly holdVelocity = { x: 0, y: 0, z: 0 };

  // Fuel: a local mirror of car.fuelLitres, resynced on external changes.
  private localFuel: number;
  private lastAuthFuel: number;
  private fuelEmitTimer = 0;
  /**
   * Water and oil, mirrored locally for the same reason fuel is: the authoritative
   * value is in state, but a per-tick round trip through `world.apply` for a number
   * that changes in the fourth decimal place is waste. Resynced whenever something
   * external (a poured can, a swapped radiator) moves the authority.
   */
  private localWater: number;
  private localOil: number;
  private lastAuthWater: number;
  /**
   * The engine's cooling system: temperature, the fitted radiator, its water.
   *
   * One per Vehicle and therefore one per car, which is what keeps two cars'
   * temperatures independent. `localTemp` mirrors it into authority on the fluid
   * cadence exactly as water and oil do.
   */
  private readonly cooling: EngineCoolingSystem;
  private localTemp: number;
  private lastAuthTemp: number;
  /**
   * Latched at the critical temperature and released only once the engine is back
   * below its warning line. Without the latch a critically hot engine would restart
   * on the tick after it stalled, hunt against the temperature and sound like a
   * misfire; with it, an overheat is a stop.
   */
  private overheatStalled = false;
  /**
   * Seconds this engine has been RUN with no oil in it, decayed while it has oil.
   * See the destruction block in `fixedUpdate`.
   */
  private oilStarvedSeconds = 0;
  /**
   * Which block is currently bolted in. A different one is a DIFFERENT ENGINE: it
   * has not been cooked, it has not been run dry, and it did not arrive at the
   * temperature the last one left behind. `rebuild` compares this and hands a fresh
   * engine a fresh thermal state.
   */
  private fittedEngineId: string | null = null;

  // Cosmetic shell condition is mirrored locally so dust and scratches do not write
  // authoritative state every 16.7 ms; washing resyncs through the same authority check.
  private localBodyDirt: number;
  private localBodyScratches: number;
  private lastAuthBodyDirt: number;
  private lastAuthBodyScratches: number;
  /** The respray last written into the paint; null means the factory colour. */
  private appliedPaint: CarPaint | null = null;
  private readonly paintScratch = new THREE.Color();
  /** Past the far line from the eye at the last frame; see `drawFar`. */
  private farSide = false;
  private readonly farPaint = new THREE.Color();
  /** This car's mid-range parts (render/carmodel.ts), from its visuals; null for none. */
  private midParts: CarMidInstance | null = null;
  /** A kit car's four wheels drawn as one mesh (render/kitdraw.ts); null for any other model. */
  private wheelDraw: THREE.SkinnedMesh | null = null;
  /** Past the mid line from the eye at the last frame; see `drawMid`. */
  private midSide = false;
  /** The mid parts stand in for the body and wheels; see `showMid`. */
  private midShown = false;
  /**
   * The near meshes this car stopped casting from while its far mesh casts for it in the
   * shadow-only field (`castNearShadows`); empty while they cast themselves.
   */
  private readonly shadowMuted: THREE.Mesh[] = [];
  private nearCasting = true;
  /** Inside the self-shadow line from the eye at the last frame; see `castsOwnShadow`. */
  private selfShadowSide = false;
  private bodyConditionEmitTimer = 0;
  private lastAuthOil: number;
  private fluidEmitTimer = 0;

  // Odometer and transform emission.
  private odoAccum = 0;
  private odoEmitTimer = 0;
  /**
   * Air filter wear driven since it was last written to state (vehicle/airfilter.ts),
   * and the filter it belongs to: a filter swapped at the roadside starts clean of it.
   */
  private filterWearAccum = 0;
  private filterWearPartId: string | null = null;
  private transformEmitTimer = 0;

  // Scratch buffers reused across fixedUpdate (no per-tick allocation).
  private readonly linvel = { x: 0, y: 0, z: 0 };

  /**
   * The prior controller pass's maximum legitimate deceleration. It bounds tyres
   * plus rolling/aero drag before the next solver result is classified as a blow.
   */
  private ownTyreCapacityN = 0;
  private ownDragRollingDeltaMps = 0;
  private previousStepContactCount = 0;
  private impactVelocityPrimed = false;
  private readonly previousStepLinvel = { x: 0, y: 0, z: 0 };
  private readonly stepStartLinvel = { x: 0, y: 0, z: 0 };
  private previousOwnTyreCapacityN = 0;
  private previousOwnDragRollingDeltaMps = 0;
  private impactThisStep = false;
  private readonly impactState = { severityMps: 0, localX: 0, localY: 0, localZ: 0 };
  private readonly rotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  /** Reused application point for the lateral impulse; see the note where it is used. */
  private readonly lateralPoint = { x: 0, y: 0, z: 0 };
  private readonly forwardScratch = { x: 0, y: 0, z: 0 };
  /** Aligning moment summed over the wheels this step, N·m·s about world up. */
  private alignTorqueImpulse = 0;
  /**
   * Whether the CAR is digging, as opposed to any one wheel — see DIG_FIRM_RR.
   *
   * A trench is a property of the car, not of a corner: once the driven wheels have cut
   * through, all four are standing on the same firm layer. One step old when the setup
   * pass reads it, which is the same lag every other ground quantity here carries.
   */
  private digWeightCar = 0;
  private readonly forceScratch = { x: 0, y: 0, z: 0 };
  /** Per-wheel tyre impulse, applied at the contact patch. */
  private readonly tyreImpulse = { x: 0, y: 0, z: 0 };
  /** Reused micro-relief impulse, applied along the suspension axis at the contact. */
  private readonly microUp = { x: 0, y: 0, z: 0 };
  /** Reused by `updateBeamLean`: a beam axle's axis in the world. */
  private readonly beamAxis = { x: 0, y: 0, z: 0 };
  /**
   * The sub-collider ground profile this car drives over. Seeded from the WORLD, not
   * from the car, so every vehicle in the same desert is thrown by the same ripple.
   */
  private readonly microRelief: MicroRelief;
  /** The sealed-surface texture field, seeded from the same world (see `RoadTexture`). */
  private readonly roadTexture: RoadTexture;
  private readonly invRotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  private readonly localVelScratch = { x: 0, y: 0, z: 0 };
  private readonly bodyRightScratch = { x: 0, y: 0, z: 0 };
  private readonly bodyUpScratch = { x: 0, y: 0, z: 0 };
  private readonly wheelRightScratch = { x: 0, y: 0, z: 0 };
  /** Body forward axis in world space, for the steering assist's front-axle velocity. */
  private readonly bodyForwardScratch = { x: 0, y: 0, z: 0 };
  /**
   * How much of its linear aligning moment the front axle has lost, 0..1: see
   * `steeringLightness`. Written by the steering step from the last tyre pass.
   */
  private steerLightnessValue = 0;
  /**
   * Height of the centre of mass above the contact plane, metres: the arm the
   * longitudinal tyre forces pitch the body on (see `applyAntiPitch`).
   */
  private rollLeverArm = 0.5;
  /** The chassis' roll inertia about its centre of mass, kg·m² (`applyChassisMass`). */
  private rollInertiaKgM2 = 1;
  /**
   * Total longitudinal tyre force applied to the chassis this step, newtons. Signed:
   * positive drives, negative brakes. Summed in `updateWheelDynamics` and consumed by
   * `applyAntiPitch`, which needs the force that was actually DELIVERED rather than
   * the one the pedals asked for — the tyre model routinely delivers less.
   */
  private longitudinalForceSum = 0;
  /**
   * The tyre contact plane in chassis-local metres: where the ground is when the
   * car stands at its published factory clearance. `rebuild` places each suspension
   * mount so the settled wheel centre lands exactly one radius above this plane,
   * independent of spring frequency and static sag.
   */
  private contactPlaneY = -0.5;
  // Audio telemetry, written every fixed step and read by the audio layer at frame
  // rate. One object for the life of the vehicle; never reallocated.
  private readonly audioState: VehicleAudioState = {
    rpm: 0,
    idleRpm: 0,
    redlineRpm: 1,
    cylinders: 4,
    throttle: 0,
    brake: 0,
    handbrake: false,
    forwardMps: 0,
    engineRunning: false,
    engineDestroyed: false,
    engineTempC: 20,
    overheatStalled: false,
    gearLabel: 'N',
    wheelContactFraction: 0,
    surfaceRoughness: 0,
    lateralSlipMps: 0,
    landingImpactMps: 0,
    frontLockT: 0,
    rearLockT: 0,
    displacementL: 1.5,
    turbo: false,
    engineSeed: 0,
    surface: SurfaceType.Asphalt,
    bumpMps: 0,
    impactMps: 0,
  };
  /** Per-surface loaded-wheel count for the step, for `audioState.surface`. */
  private readonly surfaceVotes = new Uint8Array(8);
  /** Previous step's vertical velocity, for detecting a landing. */
  private prevVerticalVel = 0;
  // Render-frame scratch.
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  /** Shared scratch for player-contact and bubble-flip queries. */
  private readonly contactPoint = new THREE.Vector3();
  private readonly contactNormal = new THREE.Vector3();

  // Fixed-step transform snapshots for render interpolation. The simulation steps
  // at exactly 60 Hz while frames arrive whenever the GPU is done, so a frame that
  // draws the newest physics transform draws a body that has advanced by 1, 2 or 3
  // steps since the last frame — the car visibly surges and stalls even though the
  // physics is perfectly regular. Rendering between the last two steps at the
  // loop's leftover-accumulator alpha turns that staircase back into constant
  // velocity, at the cost of being one step (16.7 ms) behind the sim.
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly stepPos = new THREE.Vector3();
  private readonly stepQuat = new THREE.Quaternion();
  private snapshotPrimed = false;

  constructor(
    physics: PhysicsWorld,
    world: GameWorld,
    carState: CarState,
    scene: THREE.Scene,
    origin: WorldOrigin,
  ) {
    this.physics = physics;
    this.world = world;
    this.car = carState;
    this.scene = scene;
    this.origin = origin;
    this.microRelief = new MicroRelief(world.seed);
    this.roadTexture = new RoadTexture(world.seed);
    this.model = carModel(carState.modelId);
    this.handling = HANDLING_PROFILES[this.model.handlingProfile];
    this.tyre = tyreCurve(this.model.tyre, this.handling);
    this.measure = carModelMeasure(carState.modelId);
    this.storageShape = {
      halfExtents: this.measure.halfExtents,
      bonnetCells: this.measure.bonnetCells,
      trunkGrid: this.model.trunkGrid,
    };
    this.axleGeometry = this.measureAxles();
    this.loadAnchors = this.measureLoadAnchors();
    this.lamps = new VehicleLamps({
      rootGroup: this.rootGroup,
      model: this.model,
      car: this.car,
      world: this.world,
      brakeCommand: () => this.brakeLightCommand,
      reversing: () => this.drivetrain.gearLabel === 'R',
    });
    this.bouncePhase = hash01(...Array.from(carState.id, (c) => c.charCodeAt(0)));

    const half = this.measure.halfExtents;
    // Drag area is Cd·A, m². Authored where the real car's is known, because
    // neither factor survives the fallback: the box is not the frontal area (it is
    // the full width times full height, ~25% more than the real projection) and one
    // shared DRAG_CD cannot cover a 1956 Volga and an aerodynamic 1984 hatchback.
    // The two errors happen to cancel for a mid-70s saloon, which is the shape the
    // fallback was calibrated on; everything boxier than that came out too slippery.
    const dragArea = this.model.dragArea ?? DRAG_CD * (4 * half[0] * half[1]);
    this.dragCoeff = 0.5 * AIR_DENSITY * dragArea;
    // The rest of the body's aerodynamics (see `AeroSpec` and `applyAero`).
    const aero = this.model.aero;
    const q = 0.5 * AIR_DENSITY;
    this.liftFrontCoeff = q * aero.frontalArea * aero.liftFront;
    this.liftRearCoeff = q * aero.frontalArea * aero.liftRear;
    this.sideSlopeCoeff = q * aero.frontalArea * aero.sideSlope;
    this.crossflowCoeff = q * CROSSFLOW_CD * (4 * half[1] * half[2]);
    const wheelbase = Math.max(0.5, this.axleGeometry.frontZ - this.axleGeometry.rearZ);
    this.sideCentreAheadM = (aero.yawSlope / aero.sideSlope) * wheelbase;
    this.aeroCentreY = -half[1] + AERO_CENTRE_HEIGHT_FRACTION * 2 * half[1];

    // `carState.x/z` are absolute (from the save); Rapier holds relative positions.
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(carState.x - this.origin.x, carState.y, carState.z - this.origin.z)
      .setRotation({ x: carState.qx, y: carState.qy, z: carState.qz, w: carState.qw })
      .setAngularDamping(CHASSIS_ANGULAR_DAMPING)
      .setCanSleep(false);

    this.chassisBody = physics.world.createRigidBody(desc);

    // The chassis box carries zero collider mass; all mass and the low/rearward
    // centre of gravity come from setAdditionalMassProperties in rebuild().
    //
    // Its FLOOR is raised to the wheel-centre line rather than the bottom of the
    // body box. A car's underside must not touch down before its tyres do: with the
    // full box, anything with a high floor and a tall silhouette — the buggy, with
    // its roll cage — grounded its collider on a dune crest, the solver held the
    // chassis up, and the ray-cast wheels kept reaching for terrain that was now
    // above their contact point. On screen that is a car whose wheels sink into the
    const floor = Math.max(-half[1], this.measure.wheels[0].pos[1]);
    const colliderHalfY = (half[1] - floor) / 2;
    this.chassisCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], colliderHalfY, half[2])
        .setTranslation(0, floor + colliderHalfY, 0)
        .setDensity(0)
        .setFriction(0.4)
        .setRestitution(0.05),
      this.chassisBody,
    );

    this.scene.add(this.rootGroup);
    this.primeTransform();

    this.statsValue = this.computeStats();
    this.drivetrain = new Drivetrain(
      this.drivetrainEngine(),
      this.statsValue.gearbox,
      this.model.rearDriveBias,
    );

    this.localFuel = carState.fuelLitres;
    this.lastAuthFuel = carState.fuelLitres;
    this.localWater = carState.waterLitres;
    this.lastAuthWater = carState.waterLitres;
    this.localBodyDirt = clamp(carState.dirt, 0, 1);
    this.lastAuthBodyDirt = this.localBodyDirt;
    this.localBodyScratches = clamp(carState.scratches, 0, 1);
    this.lastAuthBodyScratches = this.localBodyScratches;
    this.localOil = carState.oilLitres;
    this.lastAuthOil = carState.oilLitres;
    this.localTemp = carState.engineTempC;
    this.lastAuthTemp = carState.engineTempC;
    // Seeded from authority before `rebuild` binds the radiator, so a car loaded
    // hot is hot on its first tick rather than starting from a default and jumping.
    this.cooling = new EngineCoolingSystem(carState.engineTempC);
    this.cooling.setTemperature(carState.engineTempC);
    // The engine already in the slot is not a replacement: recording it here is what
    // stops the first `rebuild` from treating a loaded car as a fresh-engine fit and
    // throwing away the temperature it was saved with.
    this.fittedEngineId = bonnetPart(carState.bonnet, 0)?.id ?? null;
    this.rebuild();
    this.originDisposer = this.origin.register(this);
  }

  get stats(): CarStats {
    return this.statsValue;
  }

  get chassis(): RAPIER.RigidBody {
    return this.chassisBody;
  }

  /** Chassis collider used to enumerate actual post-solver impacts for the driver. */
  get collisionCollider(): RAPIER.Collider {
    return this.chassisCollider;
  }

  /** Non-null only during the fixed step that classified the previous solve as a collision. */
  get lastImpact(): VehicleImpact | null {
    return this.impactThisStep ? this.impactState : null;
  }

  /** Live cosmetic shell dirt, including unflushed fixed-step accumulation. */
  get bodyDirt(): number {
    return this.localBodyDirt;
  }

  /** Live cosmetic shell scratches, including unflushed fixed-step accumulation. */
  get bodyScratches(): number {
    return this.localBodyScratches;
  }


  /**
   * Absolute chassis position, for consumers that sample the world (road projection,
   * terrain height). Rapier holds the relative position; add the origin here so no
   * caller does origin arithmetic on a body translation. `chassis.translation()` is
   * the same point in the relative frame, for anything compared against a body.
   */
  absoluteTranslation(out: Vec3): Vec3 {
    this.chassisBody.translation(out);
    out.x += this.origin.x;
    out.z += this.origin.z;
    return out;
  }

  get root(): THREE.Object3D {
    return this.rootGroup;
  }

  /** The catalogue entry behind this car. */
  get modelDef(): CarModelDef {
    return this.model;
  }

  /**
   * This car's kit rig (`carkit/rig.ts`): its doors, bonnet, boot or tailgate, flap and
   * cabin fittings as channels (`door_fl` … 0 shut, 1 open; `kit.get` reads the target,
   * `KitRig.controlOf` + `kit.activate` work a picked part). Null for a model that is not
   * a kit body. A new rig on every `rebuild` takes over the old one's channels. The
   * vehicle poses it every rendered frame (`syncVisuals`), driving inputs included.
   */
  get kit(): KitRig | null {
    return this.kitRig;
  }

  /**
   * Each cabin place's room on this car (vehicle/cabin.ts), metres; null where it has
   * none, all null until its model is built.
   */
  get cabinRooms(): CabinRooms {
    return this.cabinView?.rooms ?? NO_CABIN_ROOMS;
  }

  /** The cabin place a ray hit on this car's drawn cabin cargo belongs to, or -1. */
  cabinPlaceOf(object: THREE.Object3D): number {
    return this.cabinView?.placeOf(object) ?? -1;
  }

  /**
   * Where this frame is seen from (the camera, scene frame) and its length in seconds,
   * given once per rendered frame before the vehicles' `syncVisuals`: kit cars ease
   * their parts by it and draw their cabins only near it. `occupied` is the car the
   * player sits in, if any: its cabin keeps its fine detail from every camera (the chase
   * camera stands about `KIT_FINE_M` behind). Never given (a lab), every kit car counts
   * as near and frames as 1/60 s.
   */
  static viewFrom(eye: THREE.Vector3, frameDt: number, occupied: Vehicle | null): void {
    kitEye.copy(eye);
    kitEyeKnown = true;
    kitFrameDt = Math.min(Math.max(frameDt, 0), 0.1);
    kitOccupied = occupied;
  }

  /** Measurements taken off the model's GLB (chassis-local metres). */
  get modelMeasure(): CarModelMeasure {
    return this.measure;
  }
  /** True when a world ray hit this vehicle's cheap interaction collider. */
  isChassisCollider(colliderHandle: number): boolean {
    return this.chassisCollider.handle === colliderHandle;
  }


  /**
   * Where the ground is in chassis-local metres when this car stands on its own
   * suspension (see `contactPlaneY`). Anything mounted at a real-world height off
   * the road — the trailer's tow ball — measures from here, not from the model's
   * measured wheel mounts.
   */
  get contactPlaneLocalY(): number {
    return this.contactPlaneY;
  }

  get rpm(): number {
    return this.drivetrain.rpm;
  }

  get gearLabel(): string {
    return this.drivetrain.gearLabel;
  }

  /** A forward pull cannot come from the gears right now (N, R or mid-shift); see `Drivetrain`. */
  get forwardDriveInterrupted(): boolean {
    return this.drivetrain.isForwardDriveInterrupted;
  }

  /** Reverse is in and driving (no shift under way): the brake pedal is reverse throttle; see `Drivetrain`. */
  get reverseDriveEngaged(): boolean {
    return this.drivetrain.isReverseDriveEngaged;
  }

  /** Pedal for `forceN` of drive at the wheels at the current speed; see `Drivetrain.throttleForWheelForce`. */
  throttleForDriveForce(forceN: number, reverse = false): number {
    return this.drivetrain.throttleForWheelForce(forceN, this.forwardSpeedMps(), this.drivenRadius, reverse);
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeedMps()) * 3.6;
  }

  /**
   * Where the RIM is, as a fraction of full lock, positive to the left: the rack over
   * this model's own lock, so a car with a slow rack and a car with a quick one both
   * fill the indicator at full lock. Divided rather than clamped at the source: the
   * rack is already bounded by `steerLock`, so the quotient lands in -1..1 on its own,
   * and the clamp in `Hud.updateSteerStrip` is the only one needed.
   *
   * With no hand on the wheel the rim turns with the tyres, so a released key shows the
   * wheel unwinding under its own aligning moment — the point being that the driver is
   * looking at the steering, not at the key.
   */
  get steeringFraction(): number {
    return this.model.steerLock > 0 ? this.steerAngle / this.model.steerLock : 0;
  }

  /**
   * The steering going LIGHT, 0..1: the share of its linear aligning moment the front
   * axle has lost while it is working, read off the last tyre pass. Near 0 in ordinary
   * cornering; it climbs as the front tyres pass their peak and the pneumatic trail
   * collapses, which is the cue a real wheel gives in the hands before the nose washes
   * wide. The pad's rumble carries it (main.ts); nothing in the physics reads it.
   */
  get steeringLightness(): number {
    return this.steerLightnessValue;
  }
  /**
   * Stable peak lateral acceleration available to an autonomous speed planner, at
   * `speedMps`.
   *
   * Uses the same model, tyre, mass, surface and tyre temperature as the live tyre
   * pass, but not transient load transfer or slip. The controller applies its own
   * safety margin before treating this as a cornering budget.
   *
   * It reads the WORST wheel's temperature rather than assuming a cold tyre, because a
   * planner that believes in grip the tyres have already lost is planning corners its
   * own car cannot take — which is exactly the state a long, hard drive puts it in.
   *
   * AND THE AIR'S LIFT ON THE AXLE THAT LOSES MOST OF ITS LOAD TO IT. The live pass
   * lifts each axle by `½ρA·CL·v²` (`applyAero`), and the axle with the larger share of
   * its static load gone sets the stable limit: on the Zhiguli saloons that is the
   * rear, so the car lets go at the tail. The estimate used to be one figure at every
   * speed. Measured on a flat skidpad, a rally VAZ-2105 held 10.1 m/s² at 15 m/s and
   * 7.2 at 42 against a constant 12.4, and a frantic driver planned a 180 km/h sweeper
   * on the low-speed figure and spun in it.
   */
  estimatedLateralAccel(surfaceType: SurfaceType, speedMps: number): number {
    const weightN = this.statsValue.mass * GRAVITY;
    const frontLoadN = weightN * this.parkedFrontShare;
    const rearLoadN = weightN - frontLoadN;
    const airSq = speedMps * speedMps;
    const frontKept = frontLoadN > 0 ? 1 - (this.liftFrontCoeff * airSq) / frontLoadN : 1;
    const rearKept = rearLoadN > 0 ? 1 - (this.liftRearCoeff * airSq) / rearLoadN : 1;
    // The heavier axle's tyres are the further over their reference load
    // (`tyreReferenceLoadN`), so its coefficient is the one the car corners on.
    const axles = this.axleGeometry;
    const frontCorner = frontLoadN / Math.max(1, axles.frontCount);
    const rearCorner = rearLoadN / Math.max(1, axles.rearCount);
    const axleMu = Math.min(this.tyreLoadFactor(frontCorner), this.tyreLoadFactor(rearCorner));
    return (
      GRAVITY *
      SURFACES[surfaceType].mu *
      weatherGrip(surfaceType) *
      this.handling.tyreLateralScale *
      this.tyreCarGrip(this.statsValue.mass) *
      this.worstTyreTemperatureGrip() *
      this.handling.rearAxleSideGrip *
      axleMu *
      clamp(Math.min(frontKept, rearKept), 0, 1)
    );
  }

  /**
   * μ(Fz), the tyre's load sensitivity (`LOAD_SENSITIVITY`): exactly 1 at this car's
   * mean corner load (`tyreReferenceLoadN`), less on a tyre pressed harder.
   */
  private tyreLoadFactor(loadN: number): number {
    return clamp(
      1 - LOAD_SENSITIVITY * (loadN / this.tyreReferenceLoadN - 1),
      LOAD_SENSITIVITY_MIN,
      LOAD_SENSITIVITY_MAX,
    );
  }

  /**
   * Deceleration the THRESHOLD pedal (`thresholdBrakePedal`) produced authority for on
   * the last physics step, m/s²: the most the car stops at without locking a wheel.
   * Zero until the first wheel pass has run, so a caller with no measurement yet falls
   * back to `estimatedBrakeDecel`.
   */
  get measuredBrakeDecel(): number {
    return this.measuredBrakeDecelValue;
  }

  /**
   * The share of a floored pedal, 0..1, at which the first axle reached its tyres'
   * longitudinal peak on the last step: past it, a wheel locks. 1 where the brakes
   * give out before the tyres do. Only the autopilot reads it — it is a driver who
   * brakes at the threshold — and the player's pedal is never scaled by it.
   */
  get thresholdBrakePedal(): number {
    return this.thresholdBrakePedalValue;
  }

  /**
   * Stable straight-line THRESHOLD braking on a named surface, in m/s²: the most the
   * car stops at without locking a wheel, which is what `thresholdBrakePedal` asks for
   * and the autopilot brakes on. The car's own brakes where they give out first.
   *
   * The split is fixed (FOOT_BRAKE_REAR_BIAS) up to the rear regulator's knee and
   * braking moves weight forward, so the axle that limits is often the light rear one:
   * summing the four tyres' grip, as this used to, promised a front-driven Samara 1.1 g
   * where a threshold stop holds 0.7. Each axle is held to its own tyres here, with the
   * steady load transfer `h/L · a`, the tyre's load sensitivity and the regulator's
   * knee riding on the rear springs (`thresholdBrakeG`); the deceleration at which the
   * first of them runs out is the threshold. It cannot pass what a floored pedal makes.
   */
  estimatedBrakeDecel(surfaceType: SurfaceType): number {
    const peakMu =
      FOOT_BRAKE_GRIP_RATIO *
      longitudinalPeakShare(SURFACES[surfaceType].slide, weather.wet) *
      SURFACES[surfaceType].mu *
      weatherGrip(surfaceType) *
      this.tyreCarGrip(this.statsValue.mass) *
      this.worstTyreTemperatureGrip();
    const knee =
      this.rearValveKerbKnee === Infinity ? Infinity : this.rearValveKerbKnee * this.parkedRearSpringRatio;
    return (
      thresholdBrakeG(
        peakMu,
        this.rollLeverArm / this.wheelbaseM,
        this.parkedFrontShare,
        rearAxleBrakeShare(this.frontWheelCount, this.rearWheelCount),
        this.model.brakeDecelG,
        knee,
        this.rearValveSlope,
      ) * GRAVITY
    );
  }

  /**
   * What this car's tyres bring to every contact patch before the ground and the
   * temperature do, in every direction alike: the catalogue `wheelGrip`, scaled
   * down for mass because road tyres are sized to the chassis rather than with it, so a
   * laden truck grips worse per kilogram than a hatchback.
   */
  private tyreCarGrip(mass: number): number {
    return this.statsValue.wheelGrip * Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);
  }

  /**
   * The worst wheel's temperature factor. A planner that believes in grip the tyres
   * have already lost is planning corners and stops its own car cannot make — which is
   * exactly the state a long, hard drive puts it in.
   */
  private worstTyreTemperatureGrip(): number {
    let worst = 1;
    for (const w of this.wheels) worst = Math.min(worst, w.tyreGrip);
    return worst;
  }

  /**
   * The `steer` that holds the road wheels at `wheelAngle` (the rack's bicycle-model
   * angle, positive yawing the car left) in `SteerMode` 'direct': a share of this car's
   * lock. Autonomy and the tow bar use it instead of keeping their own copy of the car's
   * steering.
   */
  steeringInputForWheelAngle(wheelAngle: number): number {
    return clamp(-wheelAngle / this.model.steerLock, -1, 1);
  }


  /**
   * The fuel/parts gate, plus the overheat stall. A critically hot engine is NOT
   * running: it has nipped up on its own oil film and will not turn again until the
   * coolant is back under the warning line, which is the only reason a temperature
   * gauge is worth watching.
   */
  get engineRunning(): boolean {
    return !this.overheatStalled && bonnetCanRun(this.car.bonnet, this.localFuel);
  }

  /** The live cooling state: dashboard readout, prompts and the harness read this. */
  get coolingState(): CoolingState {
    return this.cooling.getState();
  }

  /** What the dashboard paints, or null when no engine is fitted. */
  get engineTemperature(): EngineTempReadout | null {
    return this.cooling.readout();
  }

  get engineDestroyed(): boolean {
    return bonnetPart(this.car.bonnet, 0)?.destroyed === true;
  }

  /**
   * Live audio telemetry. Returns the vehicle's own buffer, refreshed each fixed
   * step: callers read it and must not retain or mutate it.
   */
  get audio(): VehicleAudioState {
    return this.audioState;
  }

  /**
   * Live per-wheel spray telemetry. Returns the vehicle's own buffer, refreshed
   * each fixed step: callers read it and must not retain or mutate it. Parked
   * cars are never refreshed, but only the driven car is ever asked.
   */
  get wheelSpray(): readonly WheelSprayState[] {
    return this.wheelSprayStates;
  }

  /**
   * Live per-wheel RIDE telemetry: loads, spring compression and what the tyre is
   * doing about the road. Same contract as `wheelSpray` — the vehicle's own buffer,
   * refreshed each fixed step, not to be retained or mutated.
   */
  get wheelRide(): readonly WheelRideState[] {
    return this.wheelRideStates;
  }

  /** Off -> dipped beam -> high beam -> off. */
  cycleHeadlights(): void {
    this.lamps.cycleHeadlights();
  }
  /** Sets an exact beam state; autonomous drivers use this instead of cycling UI state. */
  setHeadlights(mode: HeadlightMode): void {
    this.lamps.setHeadlights(mode);
  }

  get headlights(): HeadlightMode {
    return this.lamps.mode;
  }
  /** Sets an exact indicator state; autonomous drivers must not use toggle semantics. */
  setIndicator(side: IndicatorSide): void {
    this.lamps.setIndicator(side);
  }

  toggleIndicator(side: 'left' | 'right'): void {
    this.lamps.toggleIndicator(side);
  }

  get indicator(): IndicatorSide {
    return this.lamps.indicator;
  }

  /** Whether any wheel on the ground is locked and sliding this step. */
  get wheelLocked(): boolean {
    for (const w of this.wheels) if (w.grounded && w.locked) return true;
    return false;
  }

  /** Yaw of the chassis' forward axis about world up, radians: `atan2(forward.x, forward.z)`. */
  get heading(): number {
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.forwardScratch, this.rotationScratch, 0, 0, 1);
    return Math.atan2(this.forwardScratch.x, this.forwardScratch.z);
  }

  setHeadlightEnvironmentFactor(factor: number): void {
    this.lamps.setEnvironmentFactor(factor);
  }

  /** Rebuilds stats, drivetrain, wheel contacts and meshes from the model and its parts. */
  rebuild(): void {
    this.tyres = null;
    const previousKit = this.kitRig;
    this.clearVisuals();
    this.wheels = [];
    this.beamAxles = [];
    this.steerAngle = 0;
    this.keysRimRad = 0;
    this.keysPressS = 0;
    this.keysPressKey = 0;
    this.bumpSteerAngle = 0;
    this.sustainedImbalance = 0;
    this.frontRollRad = 0;
    this.rearRollRad = 0;
    this.frontWheelCount = 0;
    this.rearWheelCount = 0;
    this.frontDrivenCount = 0;
    this.rearDrivenCount = 0;
    this.drivenRadius = 0.35;

    this.statsValue = this.computeStats();
    const stats = this.statsValue;

    this.drivetrain.reconfigure(this.drivetrainEngine(), stats.gearbox);
    // Rebinds the cooling hardware in the same breath as the drivetrain, because
    // both answer to the same bonnet cells: swapping the radiator or the engine
    // takes effect on the next tick with no other bookkeeping. The water level is
    // re-clamped through `setWater`, so a car with no radiator holds none.
    this.cooling.configure(this.drivetrainEngine(), bonnetRadiator(this.car.bonnet));
    this.cooling.setWater(this.localWater);
    this.localWater = this.cooling.waterLitres;

    // A DIFFERENT block in the engine slot is a different engine, and it must not
    // inherit the last one's history. Without this the state that killed the old
    // engine outlived it: the car kept the seized engine's temperature, so a fresh
    // block dropped into a cooked car started life above its own maximum and was
    // destroyed again within seconds, and the `overheatStalled` latch meant it would
    // not even idle in the meantime. A replacement now starts at air temperature
    // with both damage timers and the stall latch cleared, which is what fitting a
    // new engine is supposed to buy.
    const engineId = bonnetPart(this.car.bonnet, 0)?.id ?? null;
    if (engineId !== this.fittedEngineId) {
      this.fittedEngineId = engineId;
      this.cooling.reset(ambientAirC(this.world.state.timeOfDay, DAY_LENGTH));
      this.localTemp = this.cooling.temperature;
      this.lastAuthTemp = this.localTemp;
      this.overheatStalled = false;
      this.oilStarvedSeconds = 0;
      this.world.apply({ t: 'car_engine_temp', carId: this.car.id, celsius: this.localTemp });
    }

    // Fitted parts change the drivetrain AND the mass; the drivetrain is rebound just
    // above, and the load these figures represent goes onto the springs here.
    this.applyChassisMass(stats);

    const tyres = new TyreContacts(this.physics, this.chassisBody);
    this.tyres = tyres;
    tyres.setTreadCastGate(this.treadCastGate);

    const frontDriveShare = 1 - this.model.rearDriveBias;
    const rearDriveShare = this.model.rearDriveBias;
    const suspension = this.model.suspension;
    const axles = this.axleGeometry;

    // Factory ground clearance is a geometric dimension, not a spring consequence.
    // Place each axle mount so its settled tyre contact patch lies this far below
    // the body box, independent of axle sag and the source mesh's authored stance.
    const halfHeight = this.measure.halfExtents[1];
    const contactY = -halfHeight - this.model.factory.clearance;

    // The roll lever — how far the centre of mass sits above the contact plane — is
    // resolved in `applyChassisMass` above, from the car's real centre of mass rather
    // than the kerb one, so a load that raises it lengthens the arm too.
    this.contactPlaneY = contactY;
    this.buildVisuals(previousKit);

    const weightN = stats.mass * GRAVITY;
    this.tyreReferenceLoadN = weightN / Math.max(1, axles.frontCount + axles.rearCount);
    // Each axle's roll geometry: the preset's, or the model's own where its linkage is
    // not the preset family's (see `CarModelDef.rollCentre` and `antiRoll`).
    const rollCentre = this.model.rollCentre ?? {
      front: suspension.frontRollCentreM,
      rear: suspension.rearRollCentreM,
    };
    const bars = this.model.antiRoll ?? { front: suspension.frontBar, rear: suspension.rearBar };
    const trackOf = (front: boolean): number => {
      let min = Infinity;
      let max = -Infinity;
      for (const w of this.measure.wheels) {
        if (w.isFront !== front) continue;
        min = Math.min(min, w.pos[0]);
        max = Math.max(max, w.pos[0]);
      }
      return max > min ? max - min : 0;
    };
    const frontTrack = trackOf(true);
    const rearTrack = trackOf(false);
    // Steering and wheel geometry (see `SuspensionTuning.ackermann` on). The camber
    // stiffness is the carcass': a cross-ply leans into a bend harder than a radial.
    this.ackermann = clamp(suspension.ackermann, 0, 1);
    this.wheelbaseM = Math.max(0.5, axles.frontZ - axles.rearZ);
    this.camberStiffness =
      this.model.tyre?.construction === 'crossply' ? CAMBER_STIFFNESS_CROSSPLY : CAMBER_STIFFNESS_RADIAL;
    const degToRad = Math.PI / 180;
    for (const wheel of this.measure.wheels) {
      const index = tyres.wheels.length;

      // This corner's share of the parked car's weight. TWO shares, because there are
      // two different questions behind it:
      //
      //   - the DESIGN share is the catalogue's kerb distribution, and it sizes the
      //     spring, the damper and the bump stop. A spring is a cut of the car, so it
      //     is cut against the car as it left the factory and never re-cut.
      //   - the LIVE share is where the mass actually is now, from the real centre of
      //     mass `applyChassisMass` resolved. It is the load the tyre model calls
      //     "normal" and the figure the sag follows, so a crate in the boot shows up
      //     as less on the nose and more on the tail.
      //
      // A stock car has them equal, and then everything below is exactly what it was.
      const designShare = wheel.isFront ? axles.frontWeightShare : 1 - axles.frontWeightShare;
      const liveShare = wheel.isFront ? this.parkedFrontShare : 1 - this.parkedFrontShare;
      const axleCount = wheel.isFront ? axles.frontCount : axles.rearCount;
      const cornerShare = liveShare / Math.max(1, axleCount);
      const staticLoadN = Math.max(1, weightN * cornerShare);
      const hz = wheel.isFront ? suspension.frontHz : suspension.rearHz;
      // THE FREE LENGTH AND THE TRAVEL ARE THE CAR'S, NOT THE LOAD'S. A spring does
      // not grow longer because the boot is full, so both are cut here from the KERB
      // design and left alone for the life of the car — `reloadSprings` only re-reads
      // the load. What the load decides is where in that travel the car
      // settles: a heavier corner compresses the same spring further and sits lower,
      // which is the whole point of an absolute rate. Sizing them from the load
      // instead (as this did) makes the free length follow the load, which cancels the
      // sag exactly and leaves only a car that is softer than it was.
      const designCornerMass = this.model.mass * (designShare / Math.max(1, axleCount));
      const designLoadN = Math.max(1, designCornerMass * GRAVITY);
      const sag = designLoadN / wheelSpringRateAbs(hz, designCornerMass);
      // Travel is sized around that stance so a soft spring gets the room it needs
      // instead of riding on the travel clamp (see the travel note in carmodels.ts). The
      // bump stop below catches the last of it progressively.
      const maxTravel = sag + suspension.bumpTravel;
      const restLength = sag + MOUNT_ABOVE_WHEEL_CENTRE;

      // The mount is placed so a settled wheel centre lands exactly one radius above
      // the chosen contact plane, per axle. Two axles with different sag therefore sit
      // the car LEVEL rather than raked, and the model's track and wheelbase are
      // untouched.
      const tyre = tyres.add(
        { x: wheel.pos[0], y: contactY + wheel.radius + MOUNT_ABOVE_WHEEL_CENTRE, z: wheel.pos[2] },
        restLength,
        wheel.radius,
        this.model.factory.tyreWidth,
      );

      const springRateNPerM = wheelSpringRateAbs(hz, designCornerMass);
      const compressionRateNsPerM = wheelDampingRateAbs(
        hz,
        suspension.compressionRatio,
        designCornerMass,
      );
      const relaxationRateNsPerM = wheelDampingRateAbs(
        hz,
        suspension.reboundRatio,
        designCornerMass,
      );
      tyre.springRateNPerM = springRateNPerM;
      tyre.compressionRateNsPerM = compressionRateNsPerM;
      tyre.relaxationRateNsPerM = relaxationRateNsPerM;
      tyre.maxTravelM = maxTravel;
      tyre.maxForceN = SUSPENSION_FORCE_HEADROOM * staticLoadN;

      const mesh = this.wheelMeshes.get(wheel.id);
      if (!mesh) throw new Error(`Car model "${this.model.id}" is missing wheel ${wheel.id}`);
      mesh.name = wheel.id;
      mesh.rotation.order = 'YXZ';
      this.rootGroup.add(mesh);

      // Alignment along +X (see `toeRad`): toe-in heads each wheel toward the
      // centreline, so the +X wheel steers toward -X; positive camber leans each tyre
      // out over its own side. Roll steer is signed per axle so that, with the body
      // leaning toward the outside of the bend, the front wheels steer out of it and
      // the rear axle into it — understeer at both ends for a positive coefficient.
      const side = Math.sign(wheel.pos[0]) || 1;
      const toeDeg = wheel.isFront ? suspension.frontToeDeg : suspension.rearToeDeg;
      const camberDeg = wheel.isFront ? suspension.frontCamberDeg : suspension.rearCamberDeg;
      // The caster's mechanical trail: the patch sits this far behind where the steering
      // axis meets the road (`SuspensionTuning.frontCasterDeg`), and with it the slip at
      // which this tyre's aligning moment peaks (`aligningMomentPeak`).
      const casterTrailM = wheel.isFront
        ? wheel.radius * Math.tan((suspension.frontCasterDeg * Math.PI) / 180)
        : 0;
      const alignPeak = aligningMomentPeak(casterTrailM / PNEUMATIC_TRAIL_M);
      this.wheels.push({
        index,
        tyre,
        isFront: wheel.isFront,
        sideSign: side,
        radius: wheel.radius,
        restLengthM: restLength,
        maxTravelM: maxTravel,
        designSagM: sag,
        bumpTravelM: suspension.bumpTravel,
        bumpStopPeakN: BUMP_STOP_PEAK * designLoadN,
        sagM: sag,
        staticLoadN,
        springRateNPerM,
        compressionRateNsPerM,
        relaxationRateNsPerM,
        rideHz: hz,
        tyreTempC: ambientAirC(this.world.state.timeOfDay, DAY_LENGTH),
        tyreGrip: 1,
        bumpStopN: 0,
        bleedN: 0,
        barN: 0,
        barFraction: wheel.isFront ? bars.front : bars.rear,
        rollCentreLocalY: contactY + (wheel.isFront ? rollCentre.front : rollCentre.rear),
        rollCentreM: wheel.isFront ? rollCentre.front : rollCentre.rear,
        axleTrackM: wheel.isFront ? frontTrack : rearTrack,
        toeRad: -side * toeDeg * degToRad,
        leanRad: side * camberDeg * degToRad,
        rollCamber: wheel.isFront ? suspension.frontRollCamber : suspension.rearRollCamber,
        rollSteer: wheel.isFront ? suspension.frontRollSteer : -suspension.rearRollSteer,
        beamPartner: null,
        beamLeanRad: 0,
        sideForceBodyXN: 0,
        linkN: 0,
        tyreRateN: tyreVerticalRate(wheel.radius),
        profileHeight: 0,
        profileRate: 0,
        hopZ: 0,
        hopV: 0,
        mesh,
        digWeight: 0,
        longitudinalCapacityN: 0,
        longitudinalForceN: 0,
        groundSurface: SurfaceType.Asphalt,
        grounded: false,
        slideT: 0,
        slipAngleRad: 0,
        geometricSlipRad: 0,
        slipRelaxBlend: 0,
        locked: false,
        spinRadS: 0,
        drawnSpin: 0,
        spinPrev: 0,
        spinStep: 0,
        suspPrev: 0,
        suspStep: 0,
        steerPrev: 0,
        steerStep: 0,
        slipRatio: 0,
        carcassSlip: 0,
        loadN: 0,
        compressionM: 0,
        lateralCapacityN: 0,
        sideSlip: 0,
        sidePeakTan: 1,
        sideFadePeakDeg: 1,
        sideFullDeg: 2,
        sidePlateau: 1,
        slideLoose: false,
        slideFloor: 1,
        lateralRightX: 1,
        lateralRightY: 0,
        lateralRightZ: 0,
        lateralSpeed: 0,
        camberSteerRad: 0,
        kingpinMomentNm: 0,
        casterTrailM,
        alignPeakZ: alignPeak.z,
        alignPeakShape: alignPeak.shape,
        alignSlip: 0,
        driveTorqueNm: 0,
        brakeForceN: 0,
        cableLocked: false,
        forwardDir: { x: 0, y: 0, z: 1 },
        contactPoint: { x: 0, y: 0, z: 0 },
        contactNormal: { x: 0, y: 1, z: 0 },
        contactVel: { x: 0, y: 0, z: 0 },
        inContact: false,
        contactSurface: SurfaceType.Asphalt,
        contactSpeed: 0,
        discInertia: 0,
        longitudinalMu: 0,
        longitudinalLoadFactor: 1,
        slipScale: 1,
        gripUsage: 0,
        sideCurveShare: 0,
        sideStaticShare: 0,
        longitudinalSlipPowerW: 0,
      });

      if (wheel.isFront) {
        this.frontWheelCount++;
        if (frontDriveShare > 0) this.frontDrivenCount++;
      } else {
        this.rearWheelCount++;
        if (rearDriveShare > 0) this.rearDrivenCount++;
      }
    }

    // Pair each BEAM axle's two wheels. A beam is one rigid axle between exactly two
    // wheels; an axle measured with any other count keeps independent wheels.
    for (const front of [true, false]) {
      if ((front ? suspension.frontAxle : suspension.rearAxle) !== 'beam') continue;
      const axle = this.wheels.filter((w) => w.isFront === front);
      const minus = axle.find((w) => w.sideSign < 0);
      const plus = axle.find((w) => w.sideSign > 0);
      if (axle.length !== 2 || !minus || !plus) continue;
      minus.beamPartner = plus;
      plus.beamPartner = minus;
      this.beamAxles.push([minus, plus]);
    }

    // One spray report per wheel, filled in place every fixed step (never
    // reallocated); sized here so it tracks the wheel count through a rebuild.
    this.wheelSprayStates = [];
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheelSprayStates.push({
        contactX: 0,
        contactY: 0,
        contactZ: 0,
        absoluteContactX: 0,
        absoluteContactZ: 0,
        forwardX: 0,
        forwardY: 0,
        forwardZ: 1,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        inContact: false,
        surface: SurfaceType.Asphalt,
        slipRatio: 0,
        slideSlip: 0,
        forwardSpeed: 0,
      });
    }

    // One ride report per wheel, on the same terms: allocated here, written in place.
    this.wheelRideStates = [];
    for (const w of this.wheels) {
      this.wheelRideStates.push({
        isFront: w.isFront,
        sideSign: w.sideSign,
        inContact: false,
        loadN: 0,
        staticLoadN: w.staticLoadN,
        compressionM: 0,
        reserveM: w.maxTravelM - w.sagM,
        bumpStopN: 0,
        tyreDeflectionM: 0,
        tyreTempC: w.tyreTempC,
        tyreGrip: w.tyreGrip,
      });
    }

    // Wheel-angular-speed input uses the primary driven axle's radius.
    const primaryRear = this.model.rearDriveBias >= 0.5;
    if (primaryRear && this.rearWheelCount > 0) {
      this.drivenRadius = this.averageWheelRadius(false);
    } else if (this.frontWheelCount > 0) {
      this.drivenRadius = this.averageWheelRadius(true);
    }
  }

  /**
   * Sets a car that has just been placed on the road rolling at `speedMps` along its
   * own heading: the body, every wheel turning to match, and the gearbox in the gear
   * that speed wants. For traffic that joins the stream from somewhere up the road
   * rather than standing up out of it; see `RoadTraffic`.
   */
  launchRolling(speedMps: number): void {
    // The settle that put the car down latched the parking hold, and `postStep` would
    // zero this velocity on the very step it is set: measured, every rolling spawn
    // (traffic and race rivals alike) stood up from 0 km/h after its settle.
    this.parkingHoldRequested = false;
    this.parkingHoldActive = false;
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.forwardScratch, this.rotationScratch, 0, 0, 1);
    const across = Math.hypot(this.forwardScratch.x, this.forwardScratch.z) || 1;
    this.chassisBody.setLinvel(
      { x: (this.forwardScratch.x / across) * speedMps, y: 0, z: (this.forwardScratch.z / across) * speedMps },
      true,
    );
    this.rollWheelsAt(speedMps);
  }

  /** Every wheel turning at `speedMps` of road speed, and the gearbox in the gear it wants. */
  private rollWheelsAt(speedMps: number): void {
    let radius = 0;
    for (const w of this.wheels) {
      w.spinRadS = speedMps / w.radius;
      w.slipRatio = 0;
      w.carcassSlip = 0;
      w.locked = false;
      radius += w.radius;
    }
    if (this.wheels.length > 0) {
      this.drivetrain.engageAtWheelSpeed(speedMps / (radius / this.wheels.length));
    }
    this.impactVelocityPrimed = false;
  }

  /**
   * DISTANT TRAFFIC RIDES ON RAILS.
   *
   * A traffic car far enough from the player that nothing about its springs, tyres or
   * driver can be seen is moved along its lane by `RoadTraffic` instead of driven: no
   * suspension, no tyre model, no autopilot. Those are nine tenths of what a
   * traffic car costs, and most of the stream is that far away.
   *
   * The body stays dynamic and keeps its colliders, so every sensor, query and
   * neighbour still finds it where it is drawn. Gravity is off and the pose is tracked
   * by velocity (`railStep`), so it arrives exactly where it is put and reports the
   * speed it is moving at. The suspension holds the lengths it had, which is how a
   * cruising car sits, and the wheels point straight ahead.
   */
  enterRails(): void {
    if (this.railsActive) return;
    this.railsActive = true;
    this.chassisBody.setGravityScale(0, true);
    this.chassisBody.setAngvel(ZERO_VECTOR, true);
    this.parkingHoldRequested = false;
    this.impactVelocityPrimed = false;
    this.steerAngle = 0;
    for (const w of this.wheels) w.tyre.steerRad = 0;
  }

  /** True between `enterRails` and `leaveRails`. */
  get onRails(): boolean {
    return this.railsActive;
  }

  /**
   * One fixed step on rails: the chassis is sent to the absolute pose given, yawed to
   * `heading`, pitched to `grade` (rise over run along it) and rolled to `crossfall`
   * (rise over run toward the car's right: the deck's banking under it), by the
   * velocity that lands it there at the end of the coming physics step.
   */
  railStep(
    dt: number,
    x: number,
    y: number,
    z: number,
    heading: number,
    grade: number,
    crossfall: number,
    speedMps: number,
    braking: boolean,
  ): void {
    this.lamps.adoptLiveState();
    this.kitIgnition = true;
    const t = this.chassisBody.translation(this.railTranslation);
    const v = this.railVelocity;
    v.x = (x - this.origin.x - t.x) / dt;
    v.y = (y - t.y) / dt;
    v.z = (z - this.origin.z - t.z) / dt;
    this.chassisBody.setLinvel(v, true);
    // Yaw about world up, then pitch about the car's own right axis (see `rescueTo`),
    // then roll about its own forward axis, so the body sits square to a banked deck:
    // level on rails it woke with one side's springs a bank's height short and threw
    // itself off them.
    //
    // The body's +x is its LEFT (up × forward), and a positive turn about forward lifts
    // +x, so a deck that rises to the right is a NEGATIVE roll. Rolled the other way,
    // every car on rails on a banked deck rode with one side 6-15 cm inside the road and
    // the other as far above it, and 46 of 823 wakes over a ten-stretch bench run loaded
    // their springs to 2-3 times their weight in the first half second.
    const halfYaw = heading / 2;
    const halfPitch = -Math.atan(grade) / 2;
    const halfRoll = -Math.atan(crossfall) / 2;
    const cy = Math.cos(halfYaw);
    const sy = Math.sin(halfYaw);
    const cp = Math.cos(halfPitch);
    const sp = Math.sin(halfPitch);
    const cr = Math.cos(halfRoll);
    const sr = Math.sin(halfRoll);
    const ax = cy * sp;
    const ay = sy * cp;
    const az = -sy * sp;
    const aw = cy * cp;
    const q = this.railRotation;
    q.x = ax * cr + ay * sr;
    q.y = ay * cr - ax * sr;
    q.z = aw * sr + az * cr;
    q.w = aw * cr - az * sr;
    this.chassisBody.setRotation(q, true);
    this.chassisBody.setAngvel(ZERO_VECTOR, true);
    for (const w of this.wheels) {
      w.spinRadS = speedMps / w.radius;
      w.drawnSpin += w.spinRadS * dt;
    }
    this.brakeLightCommand = braking ? 1 : 0;
    this.serviceBrakeCommand = braking ? 1 : 0;
    // What a distant listener hears follows the road speed; the engine note keeps the
    // gear it had. The vertical speed is primed so the first driven step hears no landing.
    this.audioState.forwardMps = speedMps;
    this.audioState.brake = this.serviceBrakeCommand;
    this.prevVerticalVel = v.y;
    // Nothing this step does is a collision, and the detector must not take the first
    // driven step after the rails for one either.
    this.impactVelocityPrimed = false;
    this.transformEmitTimer += dt;
    if (this.transformEmitTimer >= TRANSFORM_EMIT_INTERVAL) this.pushTransform();
    this.lamps.advance(dt);
  }

  /**
   * Hands the car back to its springs and its driver at `speedMps`, turning at
   * `yawRate` (rad/s about world up, positive to the left) — the rate the road it was
   * riding bends at. The body keeps the velocity the rails gave it, which already
   * follows the road's grade; gravity, the wheels' spin, the gear, the yaw and the
   * steering that holds that yaw are restored together. Woken straight in a bend, the
   * body went on in a line while the road turned away: the tyres had to find the whole
   * corner's side force from nothing in the first steps, and a car woken at 105 km/h in
   * a 128 m bend loaded its outer springs to three times their weight and slid.
   */
  leaveRails(speedMps: number, yawRate: number): void {
    if (!this.railsActive) return;
    this.railsActive = false;
    this.chassisBody.setGravityScale(1, true);
    this.railAngvel.y = yawRate;
    this.chassisBody.setAngvel(this.railAngvel, true);
    this.brakeLightCommand = 0;
    // The rack at the angle that holds the bend (positive rack is a left turn), so the
    // front tyres carry their share of the corner from the first step.
    const lock = this.model.steerLock;
    const rack = speedMps > 1 ? clamp(Math.atan((this.wheelbaseM * yawRate) / speedMps), -lock, lock) : 0;
    this.steerAngle = rack;
    for (const w of this.wheels) w.tyre.steerRad = this.wheelSteerAngle(w);
    this.rollWheelsAt(speedMps);
  }

  /**
   * Suspension-only step for a car nobody is driving.
   *
   * The suspension is not a constraint that persists between steps — it is a force
   * recomputed by `TyreContacts.update`, and it is the *only* thing holding the
   * chassis off the ground. A vehicle that never gets one therefore has no springs at
   * all: gravity pulls the chassis down until its own box collider lands on the
   * terrain, and because the wheel meshes are positioned chassis-locally at
   * `mount - suspension length`, they end up buried under the road while the body
   * sits on its belly. That was exactly the "parked car lies on its floor" bug, and it
   * applied to every car the moment the player stepped out of it.
   *
   * So every vehicle is stepped every tick. The driven one goes through
   * `fixedUpdate`; the rest come through here, which does the minimum: the springs,
   * the steering it was left with, and enough brake to hold the car still on a slope.
   *
   * Cost is one tyre-profile cast per wheel per step, which is what a parked car
   * standing on its wheels is worth.
   */
  settle(dt: number): void {
    const tyres = this.tyres;
    if (!tyres) return;
    this.lamps.adoptLiveState();
    this.kitIgnition = false;
    // Nobody is driving this one, so no step of its own explains its velocity. Leaving
    // the impact detector primed across that gap would report the whole standing
    // interval as one collision the moment the player got back in.
    this.impactVelocityPrimed = false;

    // A parked car's engine cools toward air temperature. It is one arithmetic step
    // per car per tick, and without it a car left hot would still be hot an hour
    // later — and, worse, a car the player cooked and walked away from would never
    // release its overheat stall.
    this.cooling.setWater(this.localWater);
    this.cooling.update(dt, {
      load: 0,
      revs: 0,
      speedMps: 0,
      ambientC: ambientAirC(this.world.state.timeOfDay, DAY_LENGTH),
      engineRunning: false,
      boost: 0,
    });
    this.localTemp = this.cooling.temperature;
    if (this.overheatStalled && !this.cooling.getState().overheating) this.overheatStalled = false;
    this.fluidEmitTimer += dt;
    if (this.fluidEmitTimer >= FUEL_EMIT_INTERVAL) {
      this.fluidEmitTimer = 0;
      this.lastAuthTemp = this.localTemp;
      this.world.apply({ t: 'car_engine_temp', carId: this.car.id, celsius: this.localTemp });
    }
    const n = this.wheels.length;
    // The hold is a teleport — it re-places the chassis at `parkingHoldPos` every step —
    // so it stays off for a moment after `flipOver`, until the dropped car has landed.
    //
    // Crucially, a newly spawned car is NOT held yet. The old unconditional request
    // latched its first airborne transform before gravity could land it; every menu
    // and POI spawn therefore remained floating forever.
    const released = this.holdReleaseTimer > 0;
    if (released) this.holdReleaseTimer = Math.max(0, this.holdReleaseTimer - dt);
    this.parkingHoldRequested = false;
    // Nobody is driving, so there is no pedal. A trailer left coupled to a parked
    // car holds on its own brakes (uncoupled or not, it is not being towed).
    this.serviceBrakeCommand = 0;
    this.brakeLightCommand = 0;
    this.lamps.advance(dt);
    if (n === 0) return;

    // A parked car keeps the road-wheel angle it had when the driver stepped out.
    // Do not feed zero here: that would visually straighten the car on the first
    // parked tick and lose the driver's last steering position.
    for (const w of this.wheels) w.tyre.steerRad = this.wheelSteerAngle(w);
    tyres.update(dt);
    // Parking brake: an impulse per wheel, spread over every wheel. Sized to hold, not
    // to stop.
    tyres.holdBrake(dt, (PARK_BRAKE_DECEL * this.statsValue.mass * dt) / n);
    // Latch only after suspension contact and vertical settlement. Two contacts let
    // a car parked across a crest hold normally; an already-held car remains held.
    let contacts = 0;
    for (const w of this.wheels) {
      if (w.tyre.inContact) contacts++;
    }
    const verticalSpeed = Math.abs(this.chassisBody.linvel().y);
    this.parkingHoldRequested =
      !released &&
      (
        this.parkingHoldActive ||
        (this.snapshotPrimed && contacts >= 2 && verticalSpeed < PARK_HOLD_SPEED_MPS)
      );
  }

  /** True when a world-space sphere touches the chassis body box. */
  touchesSphere(x: number, y: number, z: number, radius: number): boolean {
    return this.sphereTouchesBody(x, y, z, radius);
  }

  /**
   * Toggles the car between wheels-down and roof-down while preserving its heading.
   * The expanding bubble hides this deliberately cheap teleport; snapping is more
   * reliable than an impulse on dunes and cannot leave a heavy bus balanced on edge.
   */
  flipOver(): void {
    const rotation = this.chassisBody.rotation();
    const forward = this.contactPoint
      .set(0, 0, 1)
      .applyQuaternion(this.quat.set(rotation.x, rotation.y, rotation.z, rotation.w));
    const heading = Math.atan2(forward.x, forward.z);
    const halfHeading = heading * 0.5;
    const sin = Math.sin(halfHeading);
    const cos = Math.cos(halfHeading);
    const upY = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
    const t = this.chassisBody.translation();
    const lift = Math.max(0.65, this.measure.halfExtents[1] * 1.25);

    this.chassisBody.setTranslation({ x: t.x, y: t.y + lift, z: t.z }, true);
    this.chassisBody.setRotation(
      upY >= 0
        ? { x: sin, y: 0, z: cos, w: 0 }
        : { x: 0, y: sin, z: 0, w: cos },
      true,
    );
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.parkingHoldRequested = false;
    this.parkingHoldActive = false;
    this.holdReleaseTimer = FLIP_HOLD_RELEASE_SECONDS;
    this.primeTransform();
    this.snapshotPrimed = false;
  }

  /**
   * Sphere/OBB overlap in chassis-local space. On success `contactNormal` points
   * horizontally out of the car toward the sphere.
   */
  private sphereTouchesBody(x: number, y: number, z: number, radius: number): boolean {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this.quat.set(r.x, r.y, r.z, r.w).invert();
    const local = this.contactPoint.set(x - t.x, y - t.y, z - t.z).applyQuaternion(this.quat);
    const half = this.measure.halfExtents;
    const floor = Math.max(-half[1], this.measure.wheels[0].pos[1]);
    const closestX = clamp(local.x, -half[0], half[0]);
    const closestY = clamp(local.y, floor, half[1]);
    const closestZ = clamp(local.z, -half[2], half[2]);
    const dx = local.x - closestX;
    const dy = local.y - closestY;
    const dz = local.z - closestZ;
    if (dx * dx + dy * dy + dz * dz > radius * radius) return false;

    let nx = dx;
    let nz = dz;
    if (nx * nx + nz * nz < 1e-8) {
      const gapX = half[0] - Math.abs(local.x);
      const gapZ = half[2] - Math.abs(local.z);
      if (gapX < gapZ) nx = local.x < 0 ? -1 : 1;
      else nz = local.z < 0 ? -1 : 1;
    }
    const horizontalLength = Math.hypot(nx, nz);
    if (horizontalLength < 1e-4) return false;
    this.contactNormal
      .set(nx / horizontalLength, 0, nz / horizontalLength)
      .applyQuaternion(this.quat.invert());
    const worldHorizontalLength = Math.hypot(this.contactNormal.x, this.contactNormal.z);
    if (worldHorizontalLength < 1e-4) return false;
    this.contactNormal.x /= worldHorizontalLength;
    this.contactNormal.y = 0;
    this.contactNormal.z /= worldHorizontalLength;
    return true;
  }

  /**
   * Service-brake demand, 0..1 — the pedal only, never the handbrake. Exposed so a
   * coupled trailer's brakes can follow the car that is towing it.
   */
  get brakeCommand(): number {
    return this.serviceBrakeCommand;
  }

  /**
   * Flushes every runtime-owned value into serialisable state before a save.
   *
   * External pours update `CarState` first and are accepted here instead of being
   * overwritten by an older local mirror. Consumption goes the other direction:
   * while the authoritative value still matches the last emitted value, the local
   * mirror contains the newer level and is pushed now.
   */
  pushState(): void {
    if (this.car.fuelLitres !== this.lastAuthFuel) {
      this.localFuel = this.car.fuelLitres;
    } else if (this.localFuel !== this.car.fuelLitres) {
      this.world.apply({ t: 'car_fuel', carId: this.car.id, litres: this.localFuel });
    }
    this.lastAuthFuel = this.localFuel;
    this.fuelEmitTimer = 0;

    if (this.car.waterLitres !== this.lastAuthWater) {
      this.localWater = this.car.waterLitres;
    } else if (this.localWater !== this.car.waterLitres) {
      this.world.apply({
        t: 'car_fluid',
        carId: this.car.id,
        fluid: 'water',
        litres: this.localWater,
      });
    }
    this.lastAuthWater = this.localWater;

    if (this.car.oilLitres !== this.lastAuthOil) {
      this.localOil = this.car.oilLitres;
    } else if (this.localOil !== this.car.oilLitres) {
      this.world.apply({ t: 'car_fluid', carId: this.car.id, fluid: 'oil', litres: this.localOil });
    }
    this.lastAuthOil = this.localOil;

    if (this.car.engineTempC !== this.lastAuthTemp) {
      this.localTemp = this.car.engineTempC;
      this.cooling.setTemperature(this.localTemp);
    } else if (this.localTemp !== this.car.engineTempC) {
      this.world.apply({ t: 'car_engine_temp', carId: this.car.id, celsius: this.localTemp });
    }
    this.lastAuthTemp = this.localTemp;
    this.fluidEmitTimer = 0;

    if (
      this.car.dirt !== this.lastAuthBodyDirt ||
      this.car.scratches !== this.lastAuthBodyScratches
    ) {
      this.localBodyDirt = clamp(this.car.dirt, 0, 1);
      this.localBodyScratches = clamp(this.car.scratches, 0, 1);
    } else if (
      this.localBodyDirt !== this.car.dirt ||
      this.localBodyScratches !== this.car.scratches
    ) {
      this.world.apply({
        t: 'car_body_condition',
        carId: this.car.id,
        dirt: this.localBodyDirt,
        scratches: this.localBodyScratches,
      });
    }
    this.lastAuthBodyDirt = this.localBodyDirt;
    this.lastAuthBodyScratches = this.localBodyScratches;
    this.bodyConditionEmitTimer = 0;

    if (this.odoAccum > 0) {
      this.world.apply({ t: 'car_odometer', carId: this.car.id, metres: this.odoAccum });
      this.odoAccum = 0;
    }
    this.flushAirFilterWear();
    this.odoEmitTimer = 0;
    this.pushTransform();
    this.lamps.adoptLiveState();
    this.lamps.applyRearLightState();
    this.lamps.pushState();
  }

  /** Pushes the current chassis pose into state immediately. */
  pushTransform(): void {
    this.transformEmitTimer = 0;
    this.chassisBody.translation(this.pos);
    this.chassisBody.rotation(this.quat);
    // The save stores absolute world coordinates; `pos` is relative.
    this.world.apply({
      t: 'car_transform',
      carId: this.car.id,
      x: this.pos.x + this.origin.x,
      y: this.pos.y,
      z: this.pos.z + this.origin.z,
      qx: this.quat.x,
      qy: this.quat.y,
      qz: this.quat.z,
      qw: this.quat.w,
    });
  }

  fixedUpdate(dt: number, input: InputFrame): void {
    const tyres = this.tyres;
    if (!tyres) return;
    this.lamps.adoptLiveState();

    const stats = this.statsValue;

    // Resync if an external system (pouring a can) changed the authoritative value.
    if (this.car.fuelLitres !== this.lastAuthFuel) {
      this.localFuel = this.car.fuelLitres;
      this.lastAuthFuel = this.car.fuelLitres;
    }
    if (this.car.waterLitres !== this.lastAuthWater) {
      this.localWater = this.car.waterLitres;
      this.lastAuthWater = this.car.waterLitres;
    }
    if (this.car.oilLitres !== this.lastAuthOil) {
      this.localOil = this.car.oilLitres;
      this.lastAuthOil = this.car.oilLitres;
    }
    if (this.car.engineTempC !== this.lastAuthTemp) {
      this.localTemp = this.car.engineTempC;
      this.lastAuthTemp = this.car.engineTempC;
      this.cooling.setTemperature(this.localTemp);
    }

    this.resyncBodyCondition();

    // The solver runs between fixedUpdate calls. Sampling here therefore compares
    // its completed result against the velocity cached before the prior solve.
    this.chassisBody.linvel(this.stepStartLinvel);
    this.impactThisStep = false;

    let fwd = this.forwardSpeedMps();
    let bodyConditionChanged = false;
    if (this.engineRunning && this.engineDestroyed && Math.abs(fwd) > DESTROYED_ENGINE_SPEED_CAP_MPS) {
      this.capDestroyedEngineSpeed(fwd);
      fwd = Math.sign(fwd) * DESTROYED_ENGINE_SPEED_CAP_MPS;
    }
    // A hold may only LATCH on a car standing on its wheels — see
    // PARK_HOLD_MIN_LOAD_FRACTION. Once latched it stays latched for as long as the
    // handbrake is on, where it took, which is the point of a parking brake.
    //
    // `w.loadN` is last step's suspension load, like everything else the wheel pass
    // publishes, and it is the right signal rather than `w.grounded`: a tyre reaching
    // the ground says nothing about whether the car is resting on it. A car still in
    // the air holds its wheels at full droop and reports every one of them grounded
    // with the springs carrying nothing.
    //
    // And only on a car that has actually STOPPED: the whole horizontal velocity and the
    // yaw, not the forward component. `fwd` is the speed along the nose, which a car
    // sliding broadside on the handbrake carries almost none of, and which passes
    // through zero whenever the slide's heading swings past square to its path — as a
    // glancing touch on another car's flank makes it do. Gated on `fwd` alone, that
    // instant latched the hold, and the hold re-placed the car where it stood and
    // zeroed its horizontal velocity every step after: a car sliding at 40 km/h
    // touched a traffic car and stopped dead, without a bounce, for as long as the
    // lever stayed up. The yaw is measured at the axles (half the wheelbase out), so a
    // car pirouetting on the spot is not frozen mid-turn either.
    let holdLoadN = 0;
    for (const w of this.wheels) holdLoadN += w.loadN;
    const onWheels = holdLoadN > PARK_HOLD_MIN_LOAD_FRACTION * stats.mass * GRAVITY;
    const yawRate = this.chassisBody.angvel(this.holdVelocity).y;
    const stopped =
      Math.hypot(this.stepStartLinvel.x, this.stepStartLinvel.z) < PARK_HOLD_SPEED_MPS &&
      Math.abs(yawRate) * 0.5 * this.wheelbaseM < PARK_HOLD_SPEED_MPS;
    this.parkingHoldRequested =
      input.handbrake && (this.parkingHoldActive || (stopped && onWheels));

    // Manual shift request; with driver assist on this is a +/- gate — the
    // request applies now and the next automatic decision may override it.
    if (input.shift !== 0) this.drivetrain.shift(input.shift);

    // The pedal opposite an ENGAGED drive direction remains the service brake
    // until the car is nearly stopped. Neutral is different: drive may engage
    // during a slow rollback so engine torque, rather than the brakes, arrests it.
    const automatic =
      input.autoShift ||
      this.world.state.settings.gearboxMode === 'automatic' ||
      this.drivetrain.isPhysicallyAutomatic;
    const brakingForDirectionChange =
      automatic &&
      ((input.reverse && fwd > AUTO_DIRECTION_RELEASE_MPS) ||
        (!input.reverse &&
          fwd < -AUTO_DIRECTION_RELEASE_MPS &&
          this.drivetrain.isReverseDriveEngaged));
    const reverseDrive =
      automatic &&
      input.reverse &&
      fwd <= AUTO_DIRECTION_RELEASE_MPS &&
      this.drivetrain.isReverseDriveEngaged;
    const throttleInput = reverseDrive
      ? input.brake
      : brakingForDirectionChange
        ? 0
        : input.throttle;
    // DRIVER AIDS on the player's own car (`Settings.abs`, `Settings.tractionControl`),
    // off by default: each scales its pedal down while the wheels it watches are past
    // their grip, and gives it back over a moment once they roll (vehicletuning.ts).
    const aids = this.playerDriven ? this.world.state.settings : null;
    let drivenSurface = 0;
    let drivenCount = 0;
    for (const w of this.wheels) {
      if (!w.grounded || (w.isFront ? this.frontDrivenCount === 0 : this.rearDrivenCount === 0)) continue;
      drivenSurface += w.spinRadS * w.radius;
      drivenCount++;
    }
    const wheelspin =
      drivenCount > 0 ? (drivenSurface / drivenCount - fwd) / Math.max(Math.abs(fwd), TCS_REF_MPS) : 0;
    const spinning = aids?.tractionControl === true && throttleInput > 0 && wheelspin > TCS_SLIP;
    this.tcsScale = spinning
      ? Math.max(TCS_MIN_SCALE, this.tcsScale * TCS_RELEASE)
      : Math.min(1, this.tcsScale + dt / TCS_RECOVER_S);
    const throttle = this.engineRunning ? throttleInput * this.tcsScale : 0;
    this.kitThrottle = throttleInput;
    this.kitHandbrake = input.handbrake ? 1 : 0;
    this.kitIgnition = true;
    // The intake, read from the bonnet every step: a turbo bolted on or a filter
    // swapped at the roadside is felt on the next tick, and the filter's breath
    // includes the wear driven since its last write.
    const filter = bonnetAirFilter(this.car.bonnet);
    this.drivetrain.setInduction(
      bonnetHasTurbo(this.car.bonnet),
      filter ? airFilterBreath((filter.clog ?? 0) + this.filterWearAccum) : 1,
    );
    const pedalBrake = reverseDrive
      ? 0
      : Math.max(input.brake, brakingForDirectionChange ? input.throttle : 0);
    const locking =
      aids?.abs === true && pedalBrake > 0 && !input.handbrake && this.speedKmh > ABS_MIN_KMH && this.wheelLocked;
    this.absScale = locking
      ? Math.max(ABS_MIN_SCALE, this.absScale * ABS_RELEASE)
      : Math.min(1, this.absScale + dt / ABS_RECOVER_S);
    const brake = pedalBrake * this.absScale;
    // S is a brake request in neutral/forward gears, but reverse throttle once R
    // has engaged. The same physical key must not command propulsion and brake lamps.
    this.brakeLightCommand =
      this.drivetrain.gearLabel !== 'R' && input.reverse ? 1 : 0;

    // COOLING. The thermal model is a separate module (vehicle/cooling.ts) and this
    // is its only driver: everything it needs about the car this tick is the four
    // numbers below, so it can be exercised without a physics world.
    //
    // Ambient is the game clock's daily curve moved by the weather; see `ambientAirC`.
    this.cooling.setWater(this.localWater);
    this.cooling.update(dt, {
      load: throttle,
      revs: stats.engine.redlineRpm > 0 ? this.drivetrain.rpm / stats.engine.redlineRpm : 0,
      speedMps: fwd,
      ambientC: ambientAirC(this.world.state.timeOfDay, DAY_LENGTH),
      engineRunning: this.engineRunning,
      boost: this.drivetrain.boost,
    });
    this.localWater = this.cooling.waterLitres;
    this.localTemp = this.cooling.temperature;
    const cooling = this.cooling.getState();

    // Heat reaches the drivetrain as a torque scale and a rev ceiling, applied at the
    // one place torque is produced, so nothing else in the vehicle needs to know that
    // temperature exists. A stalled-hot engine cannot be restarted until the coolant
    // is back under the warning line: that latch is `overheatStalled`.
    this.drivetrain.setThermalLimits(cooling.performance, cooling.revLimit);
    if (cooling.critical) this.overheatStalled = true;
    else if (this.overheatStalled && !cooling.overheating) this.overheatStalled = false;

    // Oil seeps while the engine turns. It is not consumed by work like fuel is —
    // the rate is flat per running second, which is why this only asks whether the
    // engine is alive. Water is not here: the cooling system above owns its loss,
    // because how fast water leaves depends on how hot the engine is being run.
    //
    // Mirrored locally and emitted on the same throttled cadence as fuel, for the
    // same reason: a delta per tick for a number that moves by 0.0004 L would be
    // three hundred pointless state writes a second.
    if (this.engineRunning) {
      this.localOil = Math.max(0, this.localOil - (OIL_LOSS_LPH / 3600) * dt);
    }
    this.fluidEmitTimer += dt;
    if (this.fluidEmitTimer >= FUEL_EMIT_INTERVAL) {
      this.fluidEmitTimer = 0;
      this.lastAuthWater = this.localWater;
      this.lastAuthOil = this.localOil;
      this.lastAuthTemp = this.localTemp;
      this.world.apply({
        t: 'car_fluid',
        carId: this.car.id,
        fluid: 'water',
        litres: this.localWater,
      });
      this.world.apply({ t: 'car_fluid', carId: this.car.id, fluid: 'oil', litres: this.localOil });
      this.world.apply({
        t: 'car_engine_temp',
        carId: this.car.id,
        celsius: this.localTemp,
      });
    }

    // An engine is wrecked by being RUN wrecked, never by one bad moment.
    //
    // A dry sump used to destroy the block outright, which meant the oil lamp and
    // the destruction arrived in the same instant and there was nothing to react to.
    // Now running with no oil accumulates seconds, exactly as running past the
    // maximum temperature does (`SEIZE_SECONDS`, vehicle/cooling.ts), and the block
    // is only lost once it has been run like that for `OIL_STARVE_SECONDS`. It
    // remains fitted and running after that, with its drivetrain spec collapsed to
    // limp-home torque.
    //
    // The timer DECAYS rather than resets, at half rate, so nursing a dry engine in
    // short bursts still adds up while a single scare followed by a proper fill does
    // not carry a hidden death sentence.
    const starving = this.engineRunning
      && engineFailureReason(this.car.bonnet, this.localOil) === 'oil';
    if (starving) this.oilStarvedSeconds += dt;
    else if (this.oilStarvedSeconds > 0) {
      this.oilStarvedSeconds = Math.max(0, this.oilStarvedSeconds - dt * 0.5);
    }
    const starved = this.oilStarvedSeconds >= OIL_STARVE_SECONDS;
    if (starved) this.oilStarvedSeconds = 0;
    // `takeSeizure` is consumed once, so one overheat cannot destroy two engines.
    if (starved || this.cooling.takeSeizure()) {
      const engineItem = this.car.bonnet[0];
      if (engineItem?.type === 'part' && !engineItem.part.destroyed) {
        const destroyed = {
          ...engineItem,
          part: { ...engineItem.part, destroyed: true },
        };
        this.world.apply({ t: 'car_bonnet', carId: this.car.id, cell: 0, item: destroyed });
        this.drivetrain.reconfigure(this.drivetrainEngine(), stats.gearbox);
        this.appliedDriveTorqueNm = 0;
      }
    }

    // Steering: the driver's rack target, the rack speed and the tyres'
    // own aligning moment (`updateSteering`). Bump steer and axle roll first, because
    // the assist reads the wheels' geometry off them.
    const speedKmh = Math.abs(fwd) * 3.6;
    this.updateBumpSteer(dt, speedKmh);
    this.updateAxleRoll();
    this.updateSteering(dt, input, fwd);

    // The drive at the hubs as the driveline's last substep left it (it is stepped with
    // the wheels, in `updateWheelDynamics`), with the pedal's override applied: the
    // overrun the threshold pedal below has to leave room for.
    const appliedTorque =
      this.propulsionDirection !== 0 ? this.appliedDriveTorqueNm * (1 - brake) : this.appliedDriveTorqueNm;

    // Brake FORCES (N) at the contact, distributed so the total matches the target
    // deceleration. They are demands: the tyre model decides what is delivered, and
    // a demand past what the contact can transmit is what locks the wheel.
    const mass = stats.mass;
    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
    const brakeFrontShare = 1 - FOOT_BRAKE_REAR_BIAS;
    const brakeRearShare = FOOT_BRAKE_REAR_BIAS;
    const brakeDenom =
      this.frontWheelCount * brakeFrontShare + this.rearWheelCount * brakeRearShare;

    // The tyre's own coefficient, shared by drive, braking and cornering: see
    // `tyreCarGrip`, and the note on `SurfaceProps.mu` for why there is one.
    const tyreCarGrip = this.tyreCarGrip(mass);

    // THE PEDAL ASKS THE BRAKES, AND ONLY THE BRAKES. A floored pedal is
    // `brakeDecelG` of the car's own drums and discs, split on the fixed bias up to the
    // rear regulator's knee; the tyre then delivers what its contact can carry, and a
    // demand past its peak locks the wheel. It used to be `min(brakeDecelG, 0.99 × the
    // summed tyre capacity)`, which was two faults at once: on dry asphalt `brakeDecelG`
    // (sized to 0.42-0.6 g) sat below the tyres, so a held pedal never reached them — 74 m
    // from 100 km/h in a Zhiguli with no wheel locking, 0.52 g, where the factory norm is
    // 43.2 m from 80 fully laden — and where the tyres gave out first the cap made the
    // pedal an aggregate anti-lock brake. None of these cars had one.
    const footBrakeDemandN = this.model.brakeDecelG * GRAVITY * mass;
    const footBrakeForce = brakeDenom > 0 ? footBrakeDemandN / brakeDenom : 0;

    // THE REAR BRAKE REGULATOR (`CarModelDef.rearBrakeValve`). Its lever is linked to the
    // rear axle, so the force holding its valve open is the rear springs' compression:
    // the knee rises with a loaded boot and falls as braking lifts the tail, and with the
    // axle hanging it is gone. It reads nothing else — not the tyres, not their slip, not
    // the wheel speeds — so it is a pressure split, not an anti-lock brake: a hard enough
    // pedal on a slippery enough road still locks the rears.
    let rearValveKnee = this.rearValveKerbKnee;
    if (rearValveKnee !== Infinity) {
      let springShare = 0;
      for (const w of this.wheels) {
        if (!w.isFront) springShare += Math.max(0, w.compressionM) / w.designSagM;
      }
      rearValveKnee *= this.rearWheelCount > 0 ? springShare / this.rearWheelCount : 0;
    }
    const rearPressure = rearValvePressure(brake, rearValveKnee, this.rearValveSlope);

    // THE THRESHOLD PEDAL: the share of a floored pedal at which the first axle reaches
    // its tyres' longitudinal peak (less `FOOT_BRAKE_GRIP_RATIO`), from the same
    // per-wheel capacity and load sensitivity the tyre pass uses. It is what a driver
    // who feels the lock coming would press, and the autopilot brakes on it
    // (`Autopilot.modulateBrake`); the player's pedal is never scaled by it.
    //
    // Both inputs are one step old — `loadN` is the tyre load from the last step's
    // the last step and `groundSurface` was resolved in the last wheel pass. Per AXLE,
    // not summed, because the bias is fixed: the axle asked for more than its share of
    // the grip is the one that locks, whatever the other one has left. Airborne wheels
    // contribute nothing.
    let frontCapacityN = 0;
    let rearCapacityN = 0;
    for (const w of this.wheels) {
      if (!w.grounded || w.loadN <= 0) continue;
      const loadFactor = this.tyreLoadFactor(w.loadN);
      // The tyre's longitudinal peak on this ground and in this weather
      // (`longitudinalPeakShare`), not its capacity: on a paved surface the brush peaks
      // a little under it, by how much the rubber's sliding friction has fallen.
      const capacityN =
        SURFACES[w.groundSurface].mu *
        weatherGrip(w.groundSurface) *
        longitudinalPeakShare(SURFACES[w.groundSurface].slide, weather.wet) *
        tyreCarGrip *
        w.tyreGrip *
        loadFactor *
        w.loadN;
      if (w.isFront) frontCapacityN += capacityN;
      else rearCapacityN += capacityN;
    }
    // The engine's overrun drag reaches the driven wheels through the same contact and
    // is not overridden by the pedal (see `appliedTorque`), so what it already takes is
    // not there for the brakes: without it a rear-driven car on the threshold still
    // locked its rears for a quarter of a stop (a VAZ-2104, 28%) and a UAZ for 63%.
    const overrunN =
      appliedTorque * fwd < 0 && this.drivenRadius > 0 ? Math.abs(appliedTorque) / this.drivenRadius : 0;
    const frontAvailableN = Math.max(0, FOOT_BRAKE_GRIP_RATIO * frontCapacityN - overrunN * frontShare);
    const rearAvailableN = Math.max(0, FOOT_BRAKE_GRIP_RATIO * rearCapacityN - overrunN * rearShare);
    const frontAxleDemandN = footBrakeForce * brakeFrontShare * this.frontWheelCount;
    const rearAxleDemandN = footBrakeForce * brakeRearShare * this.rearWheelCount;
    // The rear's limit is a LINE PRESSURE share, and the regulator puts it at a pedal
    // further down once past its knee.
    const rearLimitPressure = rearAxleDemandN > 0 ? rearAvailableN / rearAxleDemandN : 1;
    const rearLimitPedal =
      rearLimitPressure <= rearValveKnee
        ? rearLimitPressure
        : this.rearValveSlope > 0
          ? rearValveKnee + (rearLimitPressure - rearValveKnee) / this.rearValveSlope
          : Infinity;
    this.thresholdBrakePedalValue = Math.min(
      1,
      frontAxleDemandN > 0 ? frontAvailableN / frontAxleDemandN : 1,
      rearLimitPedal,
    );
    // WHAT THE THRESHOLD PEDAL WILL REALLY PRODUCE, as an acceleration, published for
    // the autonomous speed planner.
    //
    // `estimatedBrakeDecel` is an idealisation: nominal grip, nominal mass, no load
    // history. This carries the low-passed wheel loads, the surface each wheel is
    // standing on, an airborne wheel contributing nothing, and the tyre fitted.
    // Measured on the boxed-in bench: the planner believed 4.0 m/s² of capped pedal and
    // the car delivered 2.46, arrived at a rock it had braked for from 34 m still doing
    // 5 m/s, and hit it.
    this.measuredBrakeDecelValue =
      mass > 0
        ? (this.thresholdBrakePedalValue * frontAxleDemandN +
            rearValvePressure(this.thresholdBrakePedalValue, rearValveKnee, this.rearValveSlope) * rearAxleDemandN) /
          mass
        : 0;
    const wheelCount = this.wheels.length;
    let rollingResistanceSum = 0;
    let sinkageSum = 0;
    let roughnessSum = 0;
    let contactCount = 0;
    this.surfaceVotes.fill(0);
    // Same for every wheel. `gripBudgetFactor` sizes the parked hold's grip cone
    // (`TyreContacts.holdBrake`), which bounds nothing the tyre model applies.
    const gripBudgetFactor = tyreCarGrip * this.handling.lateralGripFraction;
    // What the car brings to every contact patch sideways, before the ground does: the
    // tyre's own coefficient and the handling profile's cornering scale. The SURFACE's
    // own coefficient is applied per wheel below, because with four wheels on as many
    // surfaces it is no longer one number.
    const lateralCarFactor = this.handling.tyreLateralScale * tyreCarGrip;
    // The load μ(Fz) is measured against THIS WHEEL parked: `w.staticLoadN`, from the
    // weight distribution and the axle geometry (see AxleGeometry). It is per-wheel
    // now, which is the point — referencing a front tyre against a quarter of the
    // car's weight told a front-drive hatchback that its nose tyres were permanently
    // overloaded and its rears permanently light, and the load-sensitivity term then
    // handed the grip to the wrong end. A heavier car still gets no free advantage
    // from sitting harder on its tyres; that is what GRIP_MASS_EXPONENT is for.

    // The air the tyres are cooling against, sampled once for the whole car.
    const ambientC = ambientAirC(this.world.state.timeOfDay, DAY_LENGTH);

    // The patch's sideways geometry (slip angle, camber thrust) is read in
    // `updateWheelDynamics`, off the contact velocity of THIS step, after the
    // suspension has pushed: see `geometricSlipRad`.
    this.chassisBody.rotation(this.rotationScratch);

    for (const w of this.wheels) {
      // Surface under this wheel drives traction and rolling resistance. The type is
      // kept alongside its properties because the spray needs the identity, not just
      // the numbers.
      const ground = w.tyre.ground;
      const surfaceType = this.physics.surfaces.lookupType(ground ? ground.handle : null);
      const surface = SURFACES[surfaceType];

      // A tyre spending its friction budget on stopping or accelerating has less left
      // for cornering, and one spending it on cornering has less for the pedals (see
      // COMBINED SLIP in vehicletuning.ts). Neither is applied here: the tyre pass
      // builds the slip angle and the slip ratio together, substep by substep, and
      // splits the budget between them as it goes.
      //
      // THE HANDBRAKE LOCKS THE REAR WHEELS, AND THAT IS ALL IT DOES. It used to be a
      // 12 m/s² brake force shared across the four wheels, which never locked anything:
      // each tyre sat at its peak slip, so pulling it was a perfect ABS stop at 0.95 g
      // with full steering, from 50 km/h in under two seconds. A cable holds the wheel
      // still whatever the tyre asks of it (`cableLocked`, applied in the wheel pass), so
      // the rear slides on locked tyres, at their sliding grip, while the fronts still
      // roll and steer. Rear only, because every car in the catalogue has its cable on
      // the rear drums (the UAZ's transmission brake holds the rear propshaft): it was a
      // lock on all four, which stopped the car straight instead of turning it.
      // A stopped car is held by the parking hold (`parkingHoldRequested`), not by this.
      // A locked tyre's side grip is no constant either: at a slip ratio of -1 combined
      // slip leaves the side force a share that grows with slip angle, the way a
      // sliding patch's force turns with its direction of travel.
      //
      // The rear axle is a live axle on leaf springs and never had the front's
      // cornering power (REAR_AXLE_SIDE_GRIP).
      const axleGrip = w.isFront ? 1 : this.handling.rearAxleSideGrip;

      // The patch's speed along the wheel, as the last wheel pass left it: the road
      // profile below rolls by it.
      const fwdSpeed =
        w.contactVel.x * w.forwardDir.x +
        w.contactVel.y * w.forwardDir.y +
        w.contactVel.z * w.forwardDir.z;

      // The side-force curve, read at the built angle: the brush tyre rising steeply to
      // its peak and falling to the rubber's sliding friction, or on loose ground the
      // placeholder's fade by angle to the tyre's plateau (COMBINED SLIP, SLIDING
      // FRICTION in vehicletuning.ts). What is handed on is the curve and the slip
      // measured in units of its peak; the wheel substeps read the force once they know
      // how much of the patch the slip ratio has taken and how fast it slides.
      // μ(Fz) against the car's mean corner load (`tyreReferenceLoadN`): the same tyre
      // all round, so a nose-heavy car's front tyres sit further up their load curve
      // than its rear ones, before any transfer.
      const loadFactor = this.tyreLoadFactor(w.loadN);

      // The brush tyre's peak moves with load (`brushPeakTan`). The loose placeholder's
      // fade starts at that peak, held a degree short of its full angle.
      const staticPeakDeg = w.isFront ? this.tyre.peakFrontDeg : this.tyre.peakRearDeg;
      const fullDeg = w.isFront ? this.tyre.fullFrontDeg : this.tyre.fullRearDeg;
      const plateau = w.isFront ? this.tyre.plateauFront : this.tyre.plateauRear;
      const peakTan = brushPeakTan(staticPeakDeg, w.loadN / this.tyreReferenceLoadN, loadFactor);
      const fadePeakDeg = Math.min((Math.atan(peakTan) * 180) / Math.PI, fullDeg - 1);

      w.tyre.frictionSlip = surface.mu * weatherGrip(surfaceType) * gripBudgetFactor * loadFactor;
      w.tyreGrip = tyreTemperatureGrip(w.tyreTempC);
      // Before the camber: the tyre pass lays `camberGrip` on once it knows which way
      // this step's patch is sliding.
      w.lateralCapacityN =
        surface.mu *
        weatherGrip(surfaceType) *
        lateralCarFactor *
        w.tyreGrip *
        axleGrip *
        loadFactor *
        w.loadN;
      w.sidePeakTan = peakTan;
      w.sideFadePeakDeg = fadePeakDeg;
      w.sideFullDeg = fullDeg;
      w.sidePlateau = plateau;

      // THE GROUND THE COLLIDER DOES NOT HAVE.
      //
      // Two fields, both sampled at the wheel's own ABSOLUTE contact position so the
      // same ripple is under the same patch of world for every car and across every
      // floating-origin rebase:
      //
      //   microRelief  the desert's own wind-blown corrugation, centimetres, with a
      //                grain: crossing it hammers and running with it settles.
      //   hummock      the 3-6 m band under the terrain heightfield's own 3 m cells:
      //                the long swell a car HEAVES on once it leaves the asphalt, as
      //                opposed to the buzz above. Loose surfaces only.
      //   texture      what a SEALED surface has instead — millimetres of chip and
      //                crack, isotropic, and the reason a road is not glass. Asphalt
      //                used to have exactly zero of this, which is why a smooth
      //                stretch reported no road feel at all: the collider's own rows
      //                are 1.33 m apart and there was nothing between them.
      //
      // A fresh sealed deck carries half of all three, rising to all of it as the road
      // wears (`subColliderShare`): on a new mat it is texture, not bumps.
      //
      // The sum is then ENVELOPED over the contact patch. A tyre stands on 160 mm of
      // road and cannot see anything shorter, so the filter is a low-pass over
      // DISTANCE TRAVELLED, not over time: the same ripple is equally sharp at 40 and
      // at 100 km/h, and detail below the patch length is attenuated at both.
      const profileTarget =
        ground && w.grounded
          ? subColliderShare(surfaceType, this.physics.surfaces.lookupWear(ground.handle)) *
            (surface.microRelief *
              this.microRelief.at(
                w.contactPoint.x + this.origin.x,
                w.contactPoint.z + this.origin.z,
              ) +
              surface.hummock *
                this.microRelief.hummockAt(
                  w.contactPoint.x + this.origin.x,
                  w.contactPoint.z + this.origin.z,
                ) +
              surface.texture *
                this.roadTexture.at(
                  w.contactPoint.x + this.origin.x,
                  w.contactPoint.z + this.origin.z,
                ))
          : 0;
      const rolled = Math.abs(fwdSpeed) * dt;
      const envelope = 1 - Math.exp(-rolled / CONTACT_PATCH_M);
      const beforeProfile = w.profileHeight;
      w.profileHeight += (profileTarget - w.profileHeight) * envelope;
      w.profileRate = w.grounded ? (w.profileHeight - beforeProfile) / dt : 0;

      // The tyre model in updateWheelDynamics owns drive and brake; the contacts only
      // hold the body up (vehicle/tyrecontact.ts).
      const brakeForce =
        brake > 0 ? footBrakeForce * (w.isFront ? brake * brakeFrontShare : rearPressure * brakeRearShare) : 0;

      w.brakeForceN = brakeForce;
      w.cableLocked = input.handbrake && !w.isFront;
      w.groundSurface = surfaceType;
      w.grounded = ground !== null;

      w.tyre.steerRad = this.wheelSteerAngle(w);

      if (ground) {
        contactCount++;
        // The dig firms the ground the CAR is standing on, and firm ground is easier to
        // roll on as well as grippier — see DIG_FIRM_RR. It follows `digWeightCar` and
        // not this wheel's own dig weight, and that is the whole of why it works: the
        // driven axle is the only one that excavates, but a car in a trench has all four
        // wheels on the bottom of it, and the undriven pair's rolling resistance is most
        // of what a two-wheel-drive car on a sand slope is fighting.
        //
        // `digWeightCar` is zero on every surface but sand, so every other surface costs
        // nothing here. And it is zero the moment the driver lifts off, which is what
        // keeps sand what it is: power through it and the car is on firm ground, coast in
        // it and the honest loose figure eats your speed.
        rollingResistanceSum +=
          surface.rollingResistance -
          (surface.rollingResistance - DIG_FIRM_RR) * this.digWeightCar;
        // The speed-grown half of soft sand (`SurfaceProps.sinkage`) goes the same way:
        // a car down on the firm layer is not ploughing the loose one.
        sinkageSum += surface.sinkage * (1 - this.digWeightCar);
        roughnessSum += surface.roughness;
        this.surfaceVotes[surfaceType]++;
      }
    }

    tyres.update(dt);
    // This step's travel, and the forces that hang off it besides the spring's.
    this.resolveTravel(dt);

    // Wheel rotation and the driveline turning it, before the telemetry pass that reads
    // them: each wheel is integrated from its own drive and brake torque against what
    // its contact can actually transmit, so lock-up and wheelspin are outcomes, not
    // timers.
    this.updateWheelDynamics(dt, tyreCarGrip, fwd, ambientC, throttle, automatic, brake, input);

    // Keep an already-latched parking hold through the gearbox's launch interruption.
    // Releasing the handbrake and pressing throttle on a steep grade used to drop the
    // car for the whole shift time before first gear delivered one newton. The hold
    // releases on the first tick real drive torque exists; it never propels the car.
    if (this.parkingHoldActive && !input.handbrake && throttle > 0 && !this.stepDriveTorque) {
      this.parkingHoldRequested = true;
    }

    // Consume fuel locally and emit throttled absolute deltas.
    if (this.stepFuelBurnLitres > 0) {
      this.localFuel = Math.max(0, this.localFuel - this.stepFuelBurnLitres);
      this.fuelEmitTimer += dt;
      if (this.fuelEmitTimer >= FUEL_EMIT_INTERVAL) {
        this.fuelEmitTimer = 0;
        this.lastAuthFuel = this.localFuel;
        this.world.apply({ t: 'car_fuel', carId: this.car.id, litres: this.localFuel });
      }
    }
    this.refreshWheelSpray(fwd);

    // Each grounded wheel contributes its travelled tyre-track on its reported
    // surface. A spinning or sliding contact carries more loose material up the
    // body than a rolling one, hence the bounded slip multiplier in the scale above.
    const wheelDistance = Math.abs(fwd) * dt;
    let dirtGain = 0;
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      dirtGain +=
        (wheelDistance *
          Math.max(BODY_DIRT_ROAD_FILM, SURFACES[w.groundSurface].dust) *
          (1 + clamp(Math.abs(w.slipRatio), 0, 2) + w.slideT)) /
        BODY_DIRT_TYRE_METRES_TO_FULL;
    }
    if (dirtGain > 0) {
      this.localBodyDirt = clamp(this.localBodyDirt + dirtGain, 0, 1);
      bodyConditionChanged = true;
    }

    // Slide, lock and the friction-circle usage that costs a working tyre its side
    // grip are all computed inside updateWheelDynamics now, from the tyre's own
    // force against its own capacity. Rapier's forward impulse used to stand in for
    // that, and with its longitudinal channel zeroed it reads zero. What is left
    // here is the per-axle mean the audio layer voices.
    let frontSlideSum = 0;
    let rearSlideSum = 0;
    const speedAbs = Math.abs(fwd);
    for (const w of this.wheels) {
      // A locked wheel is sliding by definition; no need to infer it from the cone.
      const reported = w.locked && speedAbs > SLIDE_MIN_MPS ? 1 : w.slideT;
      if (w.isFront) frontSlideSum += reported;
      else rearSlideSum += reported;
    }
    this.audioState.frontLockT =
      this.frontWheelCount > 0 ? frontSlideSum / this.frontWheelCount : 0;
    this.audioState.rearLockT = this.rearWheelCount > 0 ? rearSlideSum / this.rearWheelCount : 0;

    this.applyAntiRollBars(dt);
    this.applyAntiPitch(dt, contactCount);

    // Rolling resistance (∝ weight) + quadratic aerodynamic drag in still air, opposing
    // horizontal motion, at the centre of mass. Drag always applies; rolling resistance
    // fades with the fraction of wheels still on the ground. `applyAero` then adds the
    // wind's share, the drag's height, the lift and the side force.
    //
    // This MUST be an impulse, not `addForce`: Rapier's force accumulator is
    // persistent — a force added here would be re-applied on every subsequent step
    // until `resetForces`, so adding one per tick accumulates without bound and
    // strangles the car to a standstill within a couple of seconds.
    this.ownDragRollingDeltaMps = 0;
    this.chassisBody.linvel(this.linvel);
    const hSpeedSq = this.linvel.x * this.linvel.x + this.linvel.z * this.linvel.z;
    const hSpeed = Math.sqrt(hSpeedSq);
    if (hSpeed > 0.01) {
      let retarding = this.dragCoeff * hSpeedSq;
      if (contactCount > 0 && wheelCount > 0) {
        const rr =
          (rollingResistanceSum + sinkageSum * sinkageShare(hSpeed)) / contactCount;
        retarding += rr * mass * GRAVITY * (contactCount / wheelCount);
      }

      // Never let one tick's retarding impulse reverse the car; cap it at the
      // impulse that would bring horizontal motion exactly to rest.
      const impulse = Math.min(retarding * dt, hSpeed * mass);
      this.ownDragRollingDeltaMps = impulse / mass;
      const inv = 1 / hSpeed;
      this.forceScratch.x = -impulse * this.linvel.x * inv;
      this.forceScratch.y = 0;
      this.forceScratch.z = -impulse * this.linvel.z * inv;
      this.chassisBody.applyImpulse(this.forceScratch, false);
    }
    this.applyAero(dt, contactCount);

    // Audio telemetry. Written after the vehicle step, so the slip and contact numbers
    // describe the tick that just ran. A landing is however much downward speed the
    // ground took away this step, which is exactly what should be heard as a thump.
    const audio = this.audioState;
    const engine = stats.engine;
    audio.rpm = this.drivetrain.rpm;
    audio.idleRpm = engine ? engine.idleRpm : 0;
    audio.redlineRpm = engine ? engine.redlineRpm : 1;
    audio.cylinders = engine ? engine.cylinders : 4;
    audio.throttle = throttle;
    audio.brake = brake;
    // Same number a coupled trailer's brakes follow (see vehicle/trailer.ts). It is
    // the SERVICE brake only: the handbrake is the driver's own parking decision
    // and does not reach down the drawbar.
    this.serviceBrakeCommand = brake;
    audio.handbrake = input.handbrake;
    audio.forwardMps = fwd;
    audio.engineRunning = this.engineRunning;
    audio.engineDestroyed = this.engineDestroyed;
    audio.engineTempC = this.localTemp;
    audio.overheatStalled = this.overheatStalled;
    audio.gearLabel = this.drivetrain.gearLabel;
    audio.wheelContactFraction = wheelCount > 0 ? contactCount / wheelCount : 0;
    audio.surfaceRoughness = contactCount > 0 ? roughnessSum / contactCount : 0;
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.bodyRightScratch, this.rotationScratch, 1, 0, 0);
    audio.lateralSlipMps = Math.abs(
      this.linvel.x * this.bodyRightScratch.x +
        this.linvel.y * this.bodyRightScratch.y +
        this.linvel.z * this.bodyRightScratch.z,
    );
    const vy = this.linvel.y;
    // Accumulated rather than overwritten: a render frame can see several fixed steps
    // or none, and the audio layer zeroes it once voiced, so a landing is heard once.
    audio.landingImpactMps = Math.max(
      audio.landingImpactMps,
      contactCount > 0 ? Math.max(0, -this.prevVerticalVel - Math.max(0, -vy)) : 0,
    );
    this.prevVerticalVel = vy;
    if (engine) {
      audio.displacementL = Math.max(0.5, engine.peakTorqueNm / 85);
      audio.turbo = bonnetHasTurbo(this.car.bonnet);
      audio.engineSeed =
        ((engine.peakTorqueNm * 7919 + engine.idleRpm * 104729 + engine.redlineRpm * 31) % 1000) / 1000;
    }
    let bestVotes = 0;
    for (let i = 0; i < this.surfaceVotes.length; i++) {
      if (this.surfaceVotes[i]! > bestVotes) {
        bestVotes = this.surfaceVotes[i]!;
        audio.surface = i as SurfaceType;
      }
    }

    // What hit the car, derived rather than asked for: Rapier has no event queue here
    // (see core/physics.ts), and the vertical channel above already shows that a
    // velocity delta across one solve is a usable signal.
    //
    // HORIZONTAL ONLY, and that is the load-bearing decision. A suspension absorbing
    // a landing puts several m/s of legitimate vertical delta through the chassis
    // that no tyre or drag term explains, so including Y reported every touchdown as
    // a crash — measured: an ordinary drop scratched the paint. Collisions with rocks,
    // walls and other cars are horizontal; potholes and landings are vertical and
    // belong to `landingImpactMps`. Gravity leaves the equation with the same stroke.
    //
    // The allowance is what the car itself could have done: every contacting tyre's
    // full longitudinal capacity plus the drag and rolling-resistance impulse actually
    // applied. On asphalt that is around 0.17 m/s a step, so hard cornering (Rapier's
    // lateral constraint, ~0.15 m/s a step at 0.9 g) stays under it and a shunt does
    // not.
    if (this.impactVelocityPrimed && this.previousStepContactCount > 0 && contactCount > 0) {
      const deltaX = this.stepStartLinvel.x - this.previousStepLinvel.x;
      const deltaZ = this.stepStartLinvel.z - this.previousStepLinvel.z;
      const deltaMps = Math.hypot(deltaX, deltaZ);
      const ownDeltaMps =
        (this.previousOwnTyreCapacityN * dt) / mass + this.previousOwnDragRollingDeltaMps;
      const severityMps = deltaMps - ownDeltaMps - IMPACT_UNEXPLAINED_FLOOR_MPS;
      if (severityMps > 0 && deltaMps > 1e-4) {
        this.chassisBody.rotation(this.rotationScratch);
        this.invRotationScratch.x = -this.rotationScratch.x;
        this.invRotationScratch.y = -this.rotationScratch.y;
        this.invRotationScratch.z = -this.rotationScratch.z;
        this.invRotationScratch.w = this.rotationScratch.w;
        // The blow came FROM the direction the velocity change points away from.
        rotateVector(
          this.localVelScratch,
          this.invRotationScratch,
          -deltaX / deltaMps,
          0,
          -deltaZ / deltaMps,
        );
        this.impactState.severityMps = severityMps;
        audio.impactMps = Math.max(audio.impactMps, severityMps);
        this.impactState.localX = this.localVelScratch.x;
        this.impactState.localY = this.localVelScratch.y;
        this.impactState.localZ = this.localVelScratch.z;
        this.impactThisStep = true;

        // Above 1.8 m/s, 0.06 per unexplained m/s reaches the 0.3 cap at 6.8 m/s;
        // capping there keeps even a high-speed single crash below a full repaint.
        const scratchGain = Math.min(
          SCRATCH_PER_IMPACT_CAP,
          Math.max(0, severityMps - SCRATCH_IMPACT_THRESHOLD_MPS) *
            SCRATCH_PER_SEVERITY_MPS,
        );
        if (scratchGain > 0) {
          this.localBodyScratches = clamp(this.localBodyScratches + scratchGain, 0, 1);
          bodyConditionChanged = true;
        }
      }
    }

    // Odometer: metres travelled forward this tick, emitted in throttled batches.
    if (fwd > 0) {
      this.odoAccum += fwd * dt;
      // The filter breathes only while the engine does; a car coasting dead or being
      // pushed puts no air through it.
      if (this.engineRunning) {
        const filter = bonnetAirFilter(this.car.bonnet);
        if (filter && filter.id !== this.filterWearPartId) {
          this.filterWearPartId = filter.id;
          this.filterWearAccum = 0;
        }
        this.filterWearAccum += airFilterWear(fwd * dt, weather.dust, weather.haze);
      }
      this.odoEmitTimer += dt;
      if (this.odoEmitTimer >= ODOMETER_EMIT_INTERVAL) {
        this.odoEmitTimer = 0;
        const metres = this.odoAccum;
        this.odoAccum = 0;
        if (metres > 0) this.world.apply({ t: 'car_odometer', carId: this.car.id, metres });
        this.flushAirFilterWear();
      }
    }

    if (bodyConditionChanged) this.bodyConditionEmitTimer += dt;
    if (
      this.bodyConditionEmitTimer >= BODY_CONDITION_EMIT_INTERVAL &&
      (this.localBodyDirt !== this.car.dirt || this.localBodyScratches !== this.car.scratches)
    ) {
      this.bodyConditionEmitTimer = 0;
      this.lastAuthBodyDirt = this.localBodyDirt;
      this.lastAuthBodyScratches = this.localBodyScratches;
      this.world.apply({
        t: 'car_body_condition',
        carId: this.car.id,
        dirt: this.localBodyDirt,
        scratches: this.localBodyScratches,
      });
    }

    // Cache before the next Rapier solve; fixedUpdate is the controller half of the
    // fixed step, and the following call begins after physics has advanced the body.
    //
    // `previousStepLinvel` is read AFTER this method's own impulses (drag, rolling
    // resistance, the tyre forces) have gone in, so the delta the next step measures
    // is exactly what the SOLVER did: gravity, contacts, and Rapier's lateral
    // constraint. That is the only quantity a collision can hide in.
    this.previousOwnTyreCapacityN = this.ownTyreCapacityN;
    this.previousOwnDragRollingDeltaMps = this.ownDragRollingDeltaMps;
    this.chassisBody.linvel(this.previousStepLinvel);
    this.previousStepContactCount = contactCount;
    this.impactVelocityPrimed = true;

    // Transform deltas, a few times per second.
    this.transformEmitTimer += dt;
    if (this.transformEmitTimer >= TRANSFORM_EMIT_INTERVAL) this.pushTransform();
    this.lamps.advance(dt);
  }

  /**
   * Latches the chassis transform after the physics step that produced it. Must be
   * called once per fixed step, after `physics.step()` — never from render, whose
   * rate is unrelated.
   */
  postStep(): void {
    // THE HOLD PINS WHERE THE CAR STANDS AND WHICH WAY IT FACES — NOT HOW IT SITS.
    //
    // A parking brake stops the car rolling; it does nothing to its springs. The hold
    // used to re-place the WHOLE pose it latched, every step, and it latches the moment
    // the car is below `PARK_HOLD_SPEED_MPS` — which after a hard stop is with the nose
    // still down: measured from 50 km/h, pinned 1.52° nose-down (free rest 0.24°), the
    // front springs carrying 5.8 kN against 3.8 kN at the rear, for as long as the
    // handbrake stayed on. Reported from play as the car freezing in time with its
    // suspension still compressed. So only the horizontal position and the heading are
    // held; height, pitch and roll are the springs', and the body settles on them.
    // That is also all that has to be held on a grade: a car that cannot move across
    // the ground cannot run down it.
    if (this.parkingHoldRequested) {
      const q = this.chassisBody.rotation(this.holdRotation);
      const yaw = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      if (!this.parkingHoldActive) {
        this.chassisBody.translation(this.parkingHoldPos);
        this.parkingHoldYaw = yaw;
        this.parkingHoldActive = true;
      } else {
        const t = this.chassisBody.translation(this.holdTranslation);
        t.x = this.parkingHoldPos.x;
        t.z = this.parkingHoldPos.z;
        this.chassisBody.setTranslation(t, true);
        // Turn the body back to the held heading about the world vertical, leaving its
        // pitch and roll as the springs have them.
        let turn = this.parkingHoldYaw - yaw;
        if (turn > Math.PI) turn -= Math.PI * 2;
        else if (turn < -Math.PI) turn += Math.PI * 2;
        const s = Math.sin(turn * 0.5);
        const c = Math.cos(turn * 0.5);
        const x = c * q.x + s * q.z;
        const y = c * q.y + s * q.w;
        const z = c * q.z - s * q.x;
        const w = c * q.w - s * q.y;
        q.x = x;
        q.y = y;
        q.z = z;
        q.w = w;
        this.chassisBody.setRotation(q, true);
        const v = this.chassisBody.linvel(this.holdVelocity);
        v.x = 0;
        v.z = 0;
        this.chassisBody.setLinvel(v, true);
        const a = this.chassisBody.angvel(this.holdVelocity);
        a.y = 0;
        this.chassisBody.setAngvel(a, true);
      }
    } else {
      this.parkingHoldActive = false;
    }

    if (!this.snapshotPrimed) {
      // First step, or the first after a teleport: both ends of the interpolation are
      // the current transform, so the car does not lerp in from wherever it was.
      this.primeTransform();
      this.snapshotPrimed = true;
      return;
    }
    this.prevPos.copy(this.stepPos);
    this.prevQuat.copy(this.stepQuat);
    this.chassisBody.translation(this.stepPos);
    this.chassisBody.rotation(this.stepQuat);
    this.latchWheelPoses(false);
  }

  /** Shifts the wheels' drawn poses one step on (or primes both ends to now). */
  private latchWheelPoses(prime: boolean): void {
    for (const w of this.wheels) {
      const susp = w.tyre.lengthM;
      const steer = w.tyre.steerRad;
      w.spinPrev = prime ? w.drawnSpin : w.spinStep;
      w.suspPrev = prime ? susp : w.suspStep;
      w.steerPrev = prime ? steer : w.steerStep;
      w.spinStep = w.drawnSpin;
      w.suspStep = susp;
      w.steerStep = steer;
    }
  }

  /**
   * Chassis transform at render time, interpolated between the last two fixed
   * steps. The camera target and the car's own visuals must read exactly the same
   * pose, or the camera chases a car that is drawn somewhere else.
   */
  /**
   * Both ends of the interpolation, and the drawn group, set to where the body IS.
   *
   * Called at construction and after every teleport, not merely left for the next
   * `postStep`. A FRAME CAN ARRIVE BEFORE A STEP DOES: the loop only runs a fixed step
   * when the accumulator has filled, so above 60 fps there are frames with no step in
   * them at all - and an ambient car is created from a model-load callback, between
   * frames. With the snapshots still at their zeroed default, that frame drew the car
   * at the floating origin. Reported from play as bodies flickering at the road's
   * start, which is exactly where the origin sits while the player is at the homestead.
   */
  private primeTransform(): void {
    this.chassisBody.translation(this.stepPos);
    this.chassisBody.rotation(this.stepQuat);
    this.prevPos.copy(this.stepPos);
    this.prevQuat.copy(this.stepQuat);
    this.rootGroup.position.copy(this.stepPos);
    this.rootGroup.quaternion.copy(this.stepQuat);
    this.latchWheelPoses(true);
  }

  interpolatedTransform(alpha: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    outPos.lerpVectors(this.prevPos, this.stepPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.stepQuat, alpha);
  }

  /**
   * Shifts every relative position this car caches across steps when the floating
   * origin moves: the parking-hold latch and the interpolation snapshots. Without
   * this the renderer lerps the chassis across the whole origin step for one frame,
   * and a held car snaps a kilometre sideways the next `postStep`.
   */
  rebase(shift: RebaseShift): void {
    this.parkingHoldPos.x -= shift.dx;
    this.parkingHoldPos.z -= shift.dz;
    this.prevPos.x -= shift.dx;
    this.prevPos.z -= shift.dz;
    this.stepPos.x -= shift.dx;
    this.stepPos.z -= shift.dz;
    // The wheel contact scratch is in the same relative world frame as the chassis,
    // and an airborne wheel keeps its last one: the bump stop and the anti-roll bar
    // push at it until the ray finds ground again.
    for (const wheel of this.wheels) {
      wheel.contactPoint.x -= shift.dx;
      wheel.contactPoint.z -= shift.dz;
    }
  }

  /**
   * Places the chassis at rest on a world position, pitched to the ground's own
   * grade. For the fall-out-of-world rescue only: velocities are cleared so the car
   * does not arrive carrying the speed of its fall, and the interpolation snapshots
   * are re-primed so the renderer does not draw a streak from wherever it fell to.
   *
   * `grade` is rise over run along `heading` (`Road.sampleAt().grade`). A level body
   * on a slope stands on one axle: at this world's 22% ceiling that is half a metre
   * of penetration over a wheelbase, which the solver answers by shoving the car
   * back out of the ground.
   */
  rescueTo(x: number, y: number, z: number, heading: number, grade = 0): void {
    // x/z arrive absolute (road.sampleAt); Rapier holds relative positions.
    this.chassisBody.setTranslation({ x: x - this.origin.x, y, z: z - this.origin.z }, true);
    // Yaw about world up, then pitch about the car's OWN right axis: the product of
    // the two quaternions, written out because only two components of each are
    // non-zero. This model's forward is +Z, so its right axis is -X and a nose-up
    // pitch is a NEGATIVE rotation about local +X — measured, the other sign doubles
    // the error it is there to remove (57 cm of bumper inside a 14% grade instead of
    // none).
    const halfYaw = heading / 2;
    const halfPitch = -Math.atan(grade) / 2;
    const cy = Math.cos(halfYaw);
    const sy = Math.sin(halfYaw);
    const cp = Math.cos(halfPitch);
    const sp = Math.sin(halfPitch);
    this.chassisBody.setRotation(
      { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp },
      true,
    );
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.spinRadS = 0;
      w.slipRatio = 0;
      w.carcassSlip = 0;
      w.locked = false;
    }
    this.impactVelocityPrimed = false;
    // Release the parking hold, or this does nothing at all on a car nobody is
    // driving: `postStep` re-teleports a held chassis to `parkingHoldPos` every
    // step, so the move would be silently undone one tick later. Clearing the flag
    // makes the next `postStep` re-latch the hold at wherever we just put it.
    this.parkingHoldActive = false;
    this.primeTransform();
    this.snapshotPrimed = false;
  }

  /** Adopts a shell condition some other system (the brush and sponge) wrote into state. */
  private resyncBodyCondition(): void {
    if (
      this.car.dirt === this.lastAuthBodyDirt &&
      this.car.scratches === this.lastAuthBodyScratches
    ) {
      return;
    }
    this.localBodyDirt = clamp(this.car.dirt, 0, 1);
    this.localBodyScratches = clamp(this.car.scratches, 0, 1);
    this.lastAuthBodyDirt = this.localBodyDirt;
    this.lastAuthBodyScratches = this.localBodyScratches;
  }

  /**
   * Writes the car's respray into its paint when it moved. A spray can writes state
   * directly, stroke by stroke, so this is what makes a held can visibly work.
   */
  private syncPaint(): void {
    const paint = this.car.paint;
    const applied = this.appliedPaint;
    if (paint === null || !this.surface) return;
    if (
      applied !== null &&
      applied.base === paint.base &&
      applied.coat === paint.coat &&
      applied.cover === paint.cover
    ) {
      return;
    }
    this.surface.setPaint(carPaintColor(paint, this.paintScratch));
    this.appliedPaint = { ...paint };
  }

  /** This car's body-condition renderer; null until its visuals are built. */
  get bodySurface(): CarBodySurface | null {
    return this.surface;
  }

  /**
   * Poses the visual root at this frame's interpolated pose. `far` and `mid`, given for
   * traffic only, let a car beyond `FAR_CAR_ENTER_M` of the eye be drawn as an instance of
   * its model's far mesh instead, and one between `MID_CAR_ENTER_M` and that as its mid
   * parts (render/farcars.ts); the car the player sits in is never that far from the camera.
   * `shadow`, also traffic only, is the shadow-only field: a car drawn near casts its
   * shadows as its far mesh there instead of from its own ~40 casting meshes.
   */
  syncVisuals(
    alpha: number,
    far: FarCarField | null = null,
    mid: FarCarField | null = null,
    shadow: FarCarField | null = null,
  ): void {
    if (!this.tyres) return;

    this.interpolatedTransform(alpha, this.pos, this.quat);
    this.rootGroup.position.copy(this.pos);
    this.rootGroup.quaternion.copy(this.quat);

    if (this.world.state.settings.bouncyCars) {
      const turns = performance.now() * 0.001 * BOUNCE_HOP_HZ + this.bouncePhase;
      const bounce01 = Math.abs(Math.sin(turns * Math.PI));
      this.rootGroup.position.y += BOUNCE_AMPLITUDE_METRES * bounce01;
      if (this.bodyGroup) {
        const squash = BOUNCE_SQUASH_MAX * (1 - bounce01);
        this.bodyGroup.scale.set(
          this.bodyRestScale.x * (1 + squash * 0.5),
          this.bodyRestScale.y * (1 - squash),
          this.bodyRestScale.z * (1 + squash * 0.5),
        );
      }
    } else if (this.bodyGroup) {
      this.bodyGroup.scale.copy(this.bodyRestScale);
    }

    // Uniform writes only when a value moved, so an ordinary frame is a no-op. Dirt
    // comes from the live accumulator, so fresh road dust lands on the shell this
    // frame rather than at the next throttled state emit. The resync first is for a
    // PARKED car being washed: nothing runs its fixed step, and the sponge writes
    // state directly.
    this.resyncBodyCondition();
    this.syncPaint();
    this.surface?.setCondition(this.localBodyDirt, this.localBodyScratches);
    this.lamps.setGrime(this.localBodyDirt);

    this.lamps.applyRearLightState();

    // Drawn far, the root hides and nothing below is seen: wheels, steering wheel, the
    // kit rig. Drawn mid, the body and wheels hide behind the mid parts. The pose above
    // stays current, since the light pool projects this car's beams from it either way.
    const drawnFar = far !== null && this.drawFar(far);
    this.rootGroup.visible = !drawnFar;
    // Far, the near parts are put back, which is what a car coming in past the far line
    // starts from and what the far field's draw estimate counts.
    const drawnMid = !drawnFar && mid !== null && this.drawMid(mid);
    this.showMid(drawnMid);
    // Mid, the wheels and the rig stand where they were: the mid parts are baked shut,
    // and a door that opens sends the car back near (`drawMid`) before it moves.
    if (drawnFar || drawnMid) {
      this.castNearShadows(true);
      this.castHull(shadow);
      return;
    }
    // NEAR SHADOWS FROM THE FAR MESH. A shut near car's casters are nearly the far mesh:
    // the shell, its glass and its wheels (carmodel.ts `prepareMaterials`: the cabin, bay,
    // boot and underbody cast nothing), so one shared draw per model and shadow pass
    // replaces its own. Not inside the self-shadow line (SELF_SHADOW_ENTER_M), where the
    // sun's near cascade is sharp enough to tell them apart, and not with a door, lid or
    // pane off its stop, which the far mesh does not have: then the car casts itself.
    const standIn = shadow !== null && !this.castsOwnShadow() && this.addStandIn(shadow);
    this.castNearShadows(!standIn);
    this.castHull(standIn ? shadow : null);

    // Wheels are chassis-local, and interpolated between the last two steps exactly as
    // the chassis is (see `spinPrev`).
    for (const w of this.wheels) {
      const mount = w.tyre.mountLocal;
      const susp = w.suspPrev + (w.suspStep - w.suspPrev) * alpha;
      const steer = w.steerPrev + (w.steerStep - w.steerPrev) * alpha;
      const spin = w.spinPrev + (w.spinStep - w.spinPrev) * alpha;
      w.mesh.position.set(mount.x, mount.y - susp, mount.z);
      w.mesh.rotation.set(spin % TWO_PI, steer, 0);
    }

    // The rim turns with the rack. Every model reaches the same authored 970-degree
    // lock-to-lock rim travel despite different tyre locks.
    //
    // Sign: `steerAngle` is positive to the LEFT, and the wheel's own axis (its
    // node's local Y, before the rake in the same Euler) points back at the driver,
    // so a positive rotation about it turns the rim anticlockwise as the driver sees
    // it — left. The two agree, so the angle is added, not negated.
    if (this.steeringWheel) {
      this.steeringWheel.rotation.y =
        this.steeringWheelRest +
        (this.steerAngle / this.model.steerLock) * STEERING_WHEEL_HALF_LOCK_RAD;
    }
    if (this.kitRig) this.driveKit(this.kitRig);
    this.cabinView?.sync(this.car.cabin);
  }

  /**
   * Adds this car to `far` if it stands beyond the far line from the eye: out past
   * `FAR_CAR_ENTER_M`, back in inside `FAR_CAR_EXIT_M`. False while it is nearer, before
   * the first eye is known, before its model's far mesh is built, or when the field
   * turns it away; it is then drawn in full.
   */
  private drawFar(far: FarCarField): boolean {
    if (!kitEyeKnown || !this.surface) return false;
    const distance = this.rootGroup.position.distanceTo(kitEye);
    this.farSide = distance > (this.farSide ? FAR_CAR_EXIT_M : FAR_CAR_ENTER_M);
    if (!this.farSide) return false;
    const geometry = carModelFarGeometry(this.model.id);
    if (!geometry) return false;
    carPaintSeenFromAfar(this.surface.paint, this.localBodyDirt, this.farPaint);
    return far.add(geometry, this.rootGroup.position, this.rootGroup.quaternion, this.farPaint, this.lamps);
  }

  /**
   * Adds this car's mid parts to `mid` if it stands past the mid line from the eye: out
   * past `MID_CAR_ENTER_M`, back in inside `MID_CAR_EXIT_M`. False while it is nearer,
   * before the first eye is known, for a model without mid parts, while any door, pane,
   * lid or flap of a kit body is off its stop (the parts are baked shut), or when the
   * field turns it away; it is then drawn in full.
   */
  private drawMid(mid: FarCarField): boolean {
    const parts = this.midParts;
    if (!kitEyeKnown || !parts) return false;
    const distance = this.rootGroup.position.distanceTo(kitEye);
    this.midSide = distance > (this.midSide ? MID_CAR_EXIT_M : MID_CAR_ENTER_M);
    if (!this.midSide || (this.kitRig !== null && !this.kitRig.shut)) return false;
    return mid.addMid(parts.rest, parts.wheels, this.rootGroup.position, this.rootGroup.quaternion, this.lamps);
  }

  /**
   * Adds this car to `field` as its model's far mesh, wherever it stands: the shadow-only
   * field's caster (`syncVisuals`) and the live mirrors' stand-in (render/carmirrors.ts).
   * False when the far mesh is not what the car shows: no far mesh yet, or a kit body
   * with a door, lid, pane or flap off its stop. Also false when the field is full.
   */
  addStandIn(field: FarCarField): boolean {
    if (!this.surface || (this.kitRig !== null && !this.kitRig.shut)) return false;
    const geometry = carModelFarGeometry(this.model.id);
    if (!geometry) return false;
    carPaintSeenFromAfar(this.surface.paint, this.localBodyDirt, this.farPaint);
    return field.add(geometry, this.rootGroup.position, this.rootGroup.quaternion, this.farPaint, this.lamps);
  }

  /**
   * Inside the self-shadow line from the eye: in past `SELF_SHADOW_ENTER_M`, out past
   * `SELF_SHADOW_EXIT_M`. False before the first eye is known.
   */
  private castsOwnShadow(): boolean {
    if (!kitEyeKnown) return false;
    const distance = this.rootGroup.position.distanceTo(kitEye);
    this.selfShadowSide = distance < (this.selfShadowSide ? SELF_SHADOW_EXIT_M : SELF_SHADOW_ENTER_M);
    return this.selfShadowSide;
  }

  /**
   * Lets the near meshes cast their own shadows, or stops them while the far mesh casts
   * for them. Only on the frames it changes, and only the meshes it stopped are restored,
   * so a part that never cast is never made to.
   */
  private castNearShadows(on: boolean): void {
    if (on === this.nearCasting) return;
    this.nearCasting = on;
    if (on) {
      for (const mesh of this.shadowMuted) mesh.castShadow = true;
      this.shadowMuted.length = 0;
      return;
    }
    for (const part of this.nearParts) {
      part.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !node.castShadow) return;
        node.castShadow = false;
        this.shadowMuted.push(node);
      });
    }
  }

  /**
   * Casts the shadow hull from `field` when one is given and takes it, else as this car's
   * own hull mesh (hidden with the root when the car is drawn far).
   */
  private castHull(field: FarCarField | null): void {
    const hull = this.shadowHull;
    if (!hull) return;
    const geometry = field ? carModelShadowHull(this.model.id) : null;
    hull.visible = !(field && geometry && field.addCaster(geometry, this.rootGroup.position, this.rootGroup.quaternion));
  }

  /**
   * Shows the mid paint and glass in place of the body and wheels, or puts them back.
   * Visibility only, on the frames it changes: every program is the near car's or the far
   * field's. The rig is not driven while mid (`syncVisuals` returns first), so it is posed
   * far here: the mid panes are the car's own glass, and a car never seen near would show
   * them at the template's clear opacity.
   */
  private showMid(shown: boolean): void {
    if (shown === this.midShown) return;
    this.midShown = shown;
    if (this.bodyGroup) this.bodyGroup.visible = !shown;
    for (const w of this.wheels) w.mesh.visible = !shown;
    if (this.wheelDraw) this.wheelDraw.visible = !shown;
    if (this.midParts) {
      this.midParts.paint.visible = shown;
      if (this.midParts.glass) this.midParts.glass.visible = shown;
    }
    if (shown) this.kitRig?.setDetail(Infinity);
  }

  /** DEV: drawn as mid parts this frame (`__bro.midCars`). */
  get drawnMid(): boolean {
    return this.midShown;
  }

  /**
   * DEV: the parts a near car draws, shown or not (render/farcars.ts `nearDrawEstimate`):
   * the body and the wheels.
   */
  get nearParts(): THREE.Object3D[] {
    const parts: THREE.Object3D[] = this.bodyGroup ? [this.bodyGroup] : [];
    for (const w of this.wheels) parts.push(w.mesh);
    if (this.wheelDraw) parts.push(this.wheelDraw);
    return parts;
  }

  /** DEV: the mid paint's and glass's draws in the scene pass (one per material); 0 without them. */
  get midOwnDraws(): number {
    const parts = this.midParts;
    if (!parts) return 0;
    return (Array.isArray(parts.paint.material) ? parts.paint.material.length : 1) + (parts.glass ? 1 : 0);
  }

  /**
   * Poses a kit body from the driving state: wheel, pedals, gear lever, handbrake,
   * needles, warning lamps, light switch, stalk and hazard button follow the car, then
   * the rig eases everything (doors included) by this frame's length and draws its cabin
   * only near the eye (`viewFrom`). The rig's own lenses stay dark: `lamps` lights this car.
   */
  private driveKit(kit: KitRig): void {
    kit.set('steer', this.model.steerLock > 0 ? this.steerAngle / this.model.steerLock : 0);
    kit.set('throttle', this.kitThrottle);
    kit.set('brake', this.serviceBrakeCommand);
    kit.set('clutch', this.drivetrain.clutchPedal);
    kit.set('handbrake', this.kitHandbrake);
    kit.set('gear', this.drivetrain.gearIndex);
    kit.set('speed', this.speedKmh);
    kit.set('rpm', this.drivetrain.rpm);
    const fuel = this.model.tankLitres > 0 ? this.localFuel / this.model.tankLitres : 0;
    kit.set('fuel', fuel);
    kit.set('temp', this.cooling.gaugeFraction);
    const beam = this.lamps.mode;
    kit.set('lights', beam === 'high' ? 2 : beam === 'low' ? 1 : 0);
    const side = this.lamps.indicator;
    kit.set('blinker', side === 'left' ? -1 : side === 'right' ? 1 : 0);
    kit.set('hazard', side === 'hazard' ? 1 : 0);

    // The electrical gauges and the cluster's lamps, from the key, the engine and the sump.
    const key = this.kitIgnition;
    const engine = this.statsValue.engine;
    const turning = key && this.engineRunning;
    const revs = this.drivetrain.rpm;
    const capacity = oilCapacity(engine);
    const sump = capacity > 0 ? clamp(this.localOil / (capacity * OIL_STARVE_FRACTION), 0, 1) : 0;
    const lift = clamp((revs - engine.idleRpm) / (OIL_REVS_RPM - engine.idleRpm), 0, 1);
    const oil = turning ? (OIL_IDLE_KGF + (OIL_REVS_KGF - OIL_IDLE_KGF) * lift) * sump : 0;
    kit.set('oil', oil);
    const charge = clamp((revs - engine.idleRpm) / (CHARGE_FULL_RPM - engine.idleRpm), 0, 1);
    const lampDrop = beam === 'off' ? 0 : HEADLAMP_DROP_V * (beam === 'high' ? 1 : 0.75) * (turning ? 1 - 0.7 * charge : 1);
    kit.set('volts', key ? (turning ? CHARGE_IDLE_V + (CHARGE_FULL_V - CHARGE_IDLE_V) * charge : BATTERY_V) - lampDrop : 0);
    // Manifold vacuum, as the economy meter reads it: most with the throttle shut, more
    // still on the overrun at revs, none with it wide open.
    const shut = 1 - clamp(this.kitThrottle, 0, 1);
    kit.set('vacuum', turning ? clamp(shut * (0.75 + 0.2 * lift), 0, 1) : 0);
    kit.set('tell_turn', this.lamps.blinkerLit ? 1 : 0);
    kit.set('tell_side', beam === 'off' ? 0 : 1);
    kit.set('tell_beam', beam === 'high' ? 1 : 0);
    kit.set('tell_fuel', key && fuel < FUEL_RESERVE_FRACTION ? 1 : 0);
    kit.set('tell_oil', key && oil < OIL_LAMP_KGF ? 1 : 0);
    kit.set('tell_charge', key && !turning ? 1 : 0);
    kit.set('tell_brake', key && this.kitHandbrake > 0 ? 1 : 0);
    kit.set('tell_check', key && this.checkEngine ? 1 : 0);

    // The car the player sits in is always within the detail range, and keeps its fine
    // detail; with no eye given yet (the first frame), everything draws. An eye inside
    // the measured body (the cabin view of whoever sits in it) sees out through all but
    // clear glass.
    let inside = false;
    if (kitEyeKnown) {
      const local = this.rootGroup.worldToLocal(kitEyeLocal.copy(kitEye));
      const half = this.measure.halfExtents;
      inside = Math.abs(local.x) < half[0] && Math.abs(local.y) < half[1] && Math.abs(local.z) < half[2];
    }
    kit.setDetail(kitEyeKnown ? this.rootGroup.position.distanceTo(kitEye) : 0, inside, kitOccupied === this);
    kit.update(kitFrameDt);
  }

  /**
   * The check-engine lamp: the engine management telling the driver something is wrong
   * under the bonnet: no engine, no oil, no air filter, or a filter due for replacement.
   */
  get checkEngine(): boolean {
    const bonnet = this.car.bonnet;
    const filter = bonnetAirFilter(bonnet);
    return bonnetPart(bonnet, 0) === null || this.localOil <= 0 || filter === null || (filter.clog ?? 0) >= AIR_FILTER_DUE_CLOG;
  }

  /** Pool lights the courtesy lamp asks for: one while it is switched on, none off. */
  get domeBeamCount(): number {
    return this.kitDome !== null && this.kitRig !== null && this.kitRig.get('dome') > 0.5 ? 1 : 0;
  }

  /**
   * Lights the cabin from the courtesy lamp: a wide warm cone straight down from the
   * headliner, reaching the seats and the floor and no further. Only the car the player
   * sits in is offered this (main.ts); everyone else's lamp only glows. The caller has
   * secured its slot (`domeBeamCount`); `gain` is the slot's handover share.
   */
  syncDomeLight(rig: VehicleLightRig, gain: number): void {
    const node = this.kitDome;
    if (!node || this.domeBeamCount === 0) return;
    const source = node.getWorldPosition(this.domeSource);
    const target = this.domeTarget.set(0, -1, 0).applyQuaternion(this.rootGroup.quaternion).add(source);
    rig.addBeam(source, target, DOME_TINT, DOME_INTENSITY * gain, DOME_RANGE_M, DOME_ANGLE, 1, 1);
  }

  /**
   * Tells this car's body and glass which spot slots can light it this frame
   * (render/vehiclelights.ts `spotReachMask`; call after the rig's `endFrame`), or with
   * no rig, every slot. A kit car's alone: any other model's materials ignore it. The
   * sphere is the measured body with its doors and lids swung out (render/kitdraw.ts
   * `SWING_REACH_M`), which is all its body and glass draw.
   */
  syncSpotReach(rig: VehicleLightRig | null): void {
    const surface = this.surface;
    if (!surface) return;
    if (rig === null) {
      surface.setSpotReach(SPOT_REACH_ALL);
      return;
    }
    const radius = Math.hypot(...this.measure.halfExtents) + SWING_REACH_M + SPOT_REACH_MARGIN_M;
    surface.setSpotReach(rig.spotReachMask(this.rootGroup.position, radius));
  }

  /**
   * True while any lamp on this vehicle is emitting. Lets the caller skip dark
   * vehicles entirely and order the lit ones before they claim rig slots.
   */
  get hasLitLamps(): boolean {
    return this.lamps.anyLit();
  }

  /** Pool spotlights one of this vehicle's lamp groups needs while lit (vehiclelamps.ts). */
  beamCount(group: BeamGroup, shadowed = false): number {
    return this.lamps.beamCount(group, shadowed);
  }

  /**
   * Saves each mirror's aim the occupant has turned by hand: the inside mirror
   * (kit `mirror_yaw`/`mirror_pitch`) and the door mirrors (`mirror_l_*`, `mirror_r_*`).
   */
  storeMirrorAim(): void {
    const rig = this.kitRig;
    if (!rig) return;
    for (const mirror of KIT_MIRRORS) {
      const yaw = rig.get(`${KIT_MIRROR_CHANNEL[mirror]}_yaw`);
      const pitch = rig.get(`${KIT_MIRROR_CHANNEL[mirror]}_pitch`);
      const saved = this.car[MIRROR_FIELD[mirror]];
      if (saved ? saved[0] === yaw && saved[1] === pitch : yaw === 0 && pitch === 0) continue;
      this.world.apply({ t: 'car_mirror', carId: this.car.id, mirror, yaw, pitch });
    }
  }

  /**
   * Offers one LIT lamp group to the shared rig. The beams and their mounts live in
   * vehiclelamps.ts, which owns the state this reads.
   */
  syncProjectedLights(
    rig: VehicleLightRig,
    group: BeamGroup,
    gain: number,
    shadowed: boolean,
  ): void {
    this.lamps.syncProjectedLights(rig, group, gain, shadowed);
  }

  /**
   * Offers this car's tyres to the shared contact-patch field, one per grounded wheel.
   *
   * `gain` is the same distance fade the projected lights use and for the same reason:
   * a patch is worth having on the car being driven and on the traffic near enough to
   * read, and worth nothing on a car two hundred metres away, where dropping it saves
   * three vertices in a pool something else can use.
   *
   * The tyre's own width sizes the patch across and its radius sizes it along, so a
   * truck's footprint is a truck's and a microcar's is not.
   */
  syncContactPatches(field: ContactPatchField, gain: number): void {
    if (!(gain > 0)) return;
    const halfWidth = Math.max(0.06, this.model.factory.tyreWidth * 0.62);
    for (let i = 0; i < this.wheels.length; i++) {
      const spray = this.wheelSpray[i];
      const ride = this.wheelRide[i];
      if (!spray.inContact || !ride.inContact) continue;
      field.add(
        spray.contactX,
        spray.contactY,
        spray.contactZ,
        spray.forwardX,
        spray.forwardY,
        spray.forwardZ,
        spray.normalX,
        spray.normalY,
        spray.normalZ,
        halfWidth,
        // A tyre's footprint is about as long as it is wide — length is set by load and
        // pressure, not by radius — and the first version took it from the radius at
        // 0.95 of it, which made a patch 0.56 by 0.21 m on a Zhiguli: three to four
        // times too long, a stripe rather than a footprint, and a stripe reads as a
        // smeared shadow or a tyre mark rather than as a wheel standing on the ground.
        // 0.35 of the radius is a real contact patch's half-length.
        Math.max(0.1, this.wheels[i].radius * 0.35),
        patchOpacity(ride.loadN, ride.staticLoadN, gain),
      );
    }
  }

  /**
   * Wheel rotational dynamics: the state whose absence made lock-up a timer.
   *
   * The tyre owns longitudinal force. Drive torque spins the wheel up, brake torque
   * slows it (never past a standstill), and the contact makes a force from the SLIP
   * that results — peaking at the surface's own optimal slip and decaying past it, so a locked or
   * spinning tyre transmits less than one held at optimal slip. That force is what
   * accelerates and stops the car: it is applied to the chassis at the contact
   * point, which also gives the pitch couple (dive and squat) for free.
   *
   * The wheel's own equation is solved with the contact force linearised and taken
   * implicitly. It has to be: a wheel against its tyre has a time constant of its
   * inertia over the tyre's slip stiffness — a few milliseconds at speed and under one
   * at a crawl — so an explicit step at any rate the game can afford oscillates and
   * then explodes.
   *
   * THE WHEELS, THEIR CARCASSES AND THE DRIVELINE ARE STEPPED `WHEEL_SUBSTEPS` TIMES A
   * FIXED STEP, against a contact read once: where each patch is, how fast the body
   * moves it and what it is loaded with. The body is Rapier's and moves once a step, so
   * it is held; what it receives is each tyre's force averaged over the substeps, as
   * one impulse, which is exactly the momentum the tyre transmitted. Every wheel is
   * read before any tyre pushes, so no wheel sees another's impulse of the same step
   * and the order the wheels are listed in decides nothing.
   */
  private updateWheelDynamics(
    dt: number,
    /** The car's own tyre coefficient, before the ground does. */
    tyreGrip: number,
    vehicleForwardSpeed: number,
    airC: number,
    /** The engine's pedal this step (zero with the engine off), and the gearbox mode. */
    throttle: number,
    automatic: boolean,
    /** The service brake pedal, which overrides what is left of the drive. */
    brake: number,
    input: InputFrame,
  ): void {
    this.stepDriveTorque = false;
    this.stepFuelBurnLitres = 0;
    if (!this.tyres || dt <= 0) return;
    this.longitudinalForceSum = 0;
    this.ownTyreCapacityN = 0;

    this.chassisBody.rotation(this.rotationScratch);
    // The body's own axes and origin, for the roll-centre height and the side force's
    // body-frame component (see the lateral force below).
    rotateVector(this.bodyUpScratch, this.rotationScratch, 0, 1, 0);
    rotateVector(this.bodyRightScratch, this.rotationScratch, 1, 0, 0);
    const bodyOrigin = this.chassisBody.translation();
    const bodyMass = this.chassisBody.mass();
    this.updateBeamLean();
    // Grip leaves slowly and comes back quickly: see SLIDE_ONSET_TAU.
    const slideOnsetBlend = dt / (SLIDE_ONSET_TAU + dt);
    const slideRecoverBlend = dt / (SLIDE_RECOVER_TAU + dt);
    // The wheel loop's substep, here because the slip relaxation below is sized on it.
    const substeps = this.wheelSubsteps;
    const h = dt / substeps;

    // Each wheel's own parked load (`w.staticLoadN`, set in `rebuild`) is the reference
    // both the μ(Fz) factor and the traction-control load gate are measured against.
    // It varies across the axles, because the weight does.

    // THE CONTACT, read once for the step and held through the substeps.
    for (const w of this.wheels) {
      const steer = w.tyre.steerRad;
      // Wheel-plane forward: chassis +Z yawed by the steering angle — the same
      // basis the wheel mesh is drawn in — taken into world space.
      rotateVector(w.forwardDir, this.rotationScratch, Math.sin(steer), 0, Math.cos(steer));

      // The ground this wheel is standing on, resolved ONCE for the whole wheel: the
      // capacity, the aid and the force curve all need it, and it used to be looked up
      // separately at each of them.
      const wheelGround = w.tyre.ground;
      const surfaceType = this.physics.surfaces.lookupType(wheelGround ? wheelGround.handle : null);
      const surface = SURFACES[surfaceType];

      const inContact = w.tyre.inContact;
      let contactSpeed = 0;
      if (inContact) {
        // The rolling direction is the wheel plane projected onto the surface. On
        // flat ground this is unchanged. On a steep pothole wall it gains the
        // vertical component the contact patch actually travels along, so slip is
        // measured in the plane the tyre really works in.
        const normal = w.contactNormal;
        normal.x = w.tyre.normal.x;
        normal.y = w.tyre.normal.y;
        normal.z = w.tyre.normal.z;
        const normalComponent =
          w.forwardDir.x * normal.x +
          w.forwardDir.y * normal.y +
          w.forwardDir.z * normal.z;
        const tangentX = w.forwardDir.x - normal.x * normalComponent;
        const tangentY = w.forwardDir.y - normal.y * normalComponent;
        const tangentZ = w.forwardDir.z - normal.z * normalComponent;
        const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
        if (tangentLength > 1e-4) {
          w.forwardDir.x = tangentX / tangentLength;
          w.forwardDir.y = tangentY / tangentLength;
          w.forwardDir.z = tangentZ / tangentLength;
        }
        w.contactPoint.x = w.tyre.point.x;
        w.contactPoint.y = w.tyre.point.y;
        w.contactPoint.z = w.tyre.point.z;
        this.chassisBody.velocityAtPoint(w.contactPoint, w.contactVel);
        contactSpeed =
          w.contactVel.x * w.forwardDir.x +
          w.contactVel.y * w.forwardDir.y +
          w.contactVel.z * w.forwardDir.z;
      }

      // Slip angle of this tyre: the angle between where the contact patch is going
      // and where the wheel is pointing. The wheel's own right-hand direction is the
      // chassis' +X yawed by this wheel's steering angle, so a steered front wheel is
      // measured in ITS plane, not the body's — which is the difference between
      // "the car is sideways" and "the tyre is slipping". The angle includes the
      // wheel's geometry: Ackermann, toe and roll steer (`wheelSteerAngle`).
      //
      // Read off THIS step's patch velocity. It used to be the velocity the previous
      // step's wheel pass had seen, before the solver moved the body: every tyre
      // answered the car's yaw and sideslip one fixed step late, and because each
      // wheel's reading also caught the impulses of the wheels listed before it, the
      // rear axle answered sooner than the front.
      rotateVector(this.wheelRightScratch, this.rotationScratch, Math.cos(steer), 0, -Math.sin(steer));
      const wheelLatSpeed =
        w.contactVel.x * this.wheelRightScratch.x +
        w.contactVel.y * this.wheelRightScratch.y +
        w.contactVel.z * this.wheelRightScratch.z;
      const fwdSpeed =
        w.contactVel.x * w.forwardDir.x +
        w.contactVel.y * w.forwardDir.y +
        w.contactVel.z * w.forwardDir.z;
      // CAMBER, read the way the Magic Formula reads it: a horizontal shift of the
      // curve by `ratio · camber` (CAMBER_STIFFNESS_*). The tyre's lean against the
      // road is its static camber plus the share of its axle's roll the linkage lets
      // it take. Leaning toward +X it pushes toward +X, which is what steering toward
      // +X does to a tyre rolling forward, so the shift is that much extra steer in the
      // direction of travel — the patch's sideways speed measured against the wheel
      // turned by it. The curve, the friction budget and the stop cap below then all
      // see one angle, and the force still acts along the wheel's own axis.
      // A beam axle's wheels lean with the axle itself (`updateBeamLean`), not with
      // the body.
      const lean =
        w.leanRad +
        (w.beamPartner !== null
          ? w.beamLeanRad
          : w.rollCamber * (w.isFront ? this.frontRollRad : this.rearRollRad));
      const camberSteer = this.camberStiffness * lean * Math.sign(fwdSpeed);
      w.camberSteerRad = camberSteer;
      const latSpeed = wheelLatSpeed * Math.cos(camberSteer) - fwdSpeed * Math.sin(camberSteer);
      // A tyre tipped AWAY from the force it is making stands on its shoulder and
      // loses some of its peak (CAMBER_GRIP_LOSS_PER_DEG). The force opposes `latSpeed`,
      // so a lean along it is the adverse one.
      const adverseLeanDeg = (lean * Math.sign(latSpeed) * 180) / Math.PI;
      w.lateralCapacityN *= 1 - CAMBER_GRIP_LOSS_PER_DEG * Math.max(0, adverseLeanDeg);
      w.geometricSlipRad = Math.atan2(Math.abs(latSpeed), Math.max(Math.abs(fwdSpeed), SLIP_ANGLE_REF_MPS));
      w.slipRelaxBlend = 1 - Math.exp(-(Math.abs(fwdSpeed) * h) / this.tyre.relaxationM);
      w.lateralRightX = this.wheelRightScratch.x;
      w.lateralRightY = this.wheelRightScratch.y;
      w.lateralRightZ = this.wheelRightScratch.z;
      w.lateralSpeed = latSpeed;

      // THE LOAD, of this step. The spring is not the only thing between body and road.
      // The bump stop, the damper's low-speed bleed and the anti-roll bar push the body
      // up at this contact patch as well, so the tyre carries their force too: a bar
      // that resisted the roll without loading its outer tyre would take load transfer
      // AWAY from its own axle — the balance lever backwards, measured as 44% front on
      // a Zhiguli with a front bar twice the rear's (tools/roll-balance.ts). All are read
      // off this step's travel (`resolveTravel`). The links carry the GEOMETRIC transfer,
      // the part of the cornering moment below the roll centre, straight to the tyre
      // (`linkN`): that one is last step's side force, which this step's grip is sized
      // from. No filter: the contact is the tyre's own profile (vehicle/tyrecontact.ts),
      // so an edge or a seam reaches it as the rise a wheel rolling over it makes, not
      // as a step.
      w.loadN = inContact
        ? Math.max(0, w.tyre.forceN + w.bumpStopN + w.bleedN + w.barN + w.linkN)
        : 0;

      w.inContact = inContact;
      w.contactSurface = surfaceType;
      w.contactSpeed = contactSpeed;

      // A wheel is a disc, and a bigger wheel is a heavier one: mass scales with
      // radius², inertia with mass·radius². The engine a DRIVEN wheel turns is added
      // per substep (`substepWheel`), because the clutch can lock or let go between them.
      const wheelMass = WHEEL_MASS_KG * (w.radius / WHEEL_REFERENCE_RADIUS) ** 2;
      w.discInertia = 0.5 * wheelMass * w.radius * w.radius;

      // The coefficient of the ground under this corner, at the load it is carrying:
      // the same coefficient the side force is sized from (see `SurfaceProps.mu`),
      // warmed or cooled by this tyre's own temperature. The dig and the low range are
      // laid over it per substep, because they answer to propulsion.
      w.longitudinalLoadFactor = this.tyreLoadFactor(w.loadN);
      w.longitudinalMu =
        surface.mu * weatherGrip(surfaceType) * tyreGrip * w.tyreGrip * w.longitudinalLoadFactor;
      // COMBINED SLIP (vehicletuning.ts): the slip ratio in units of this surface's own
      // (`longitudinalSlipUnit`), beside the side slip the substeps build in units of
      // the tyre's, and how the patch slides on this ground in this weather.
      w.slipScale = 1 / longitudinalSlipUnit(surface);
      w.slideLoose = surface.slide.kind === 'loose';
      w.slideFloor = slidingFloor(surface.slide, weather.wet);
      w.longitudinalForceN = 0;
      w.gripUsage = 0;
      w.sideCurveShare = 0;
      w.sideStaticShare = 0;
      w.longitudinalSlipPowerW = 0;
    }

    // THE SUBSTEPS: the driveline, then every wheel against the contact read above.
    const share = 1 / substeps;
    const frontShare = 1 - this.model.rearDriveBias;
    const rearShare = this.model.rearDriveBias;
    const drivenCount = this.frontDrivenCount + this.rearDrivenCount;
    const roadWheelSpeed = vehicleForwardSpeed / this.drivenRadius;
    // Driveline slack and compliance: torque arrives late (DRIVELINE_LAG_S). One
    // pole, so a stab of throttle builds over ~0.3 s instead of hitting the tyres
    // on the same tick the pedal moved. Engine braking is the same torque with the
    // other sign, so it takes the same path through the same slack.
    const driveBlend = h / (this.handling.drivelineLag + h);
    let carDigWeight = 0;
    for (let step = 0; step < substeps; step++) {
      // The crank turns with the DRIVEN wheels (their mean, which is what an open
      // differential gives it), so a tyre breaking loose revs the engine towards its
      // cut, loses torque there and is bounded by it, and the driver hears it. The
      // gearbox decides on the faster of the two speeds: see `Drivetrain.update`. Until the tyre
      // model owned the thrust this could not be done — with Rapier's engine force
      // pushing the car, a slipping wheel pinned the engine at its redline and full
      // throttle in first settled at 26 km/h.
      let drivenSpinSum = 0;
      let drivenWheels = 0;
      for (const w of this.wheels) {
        if (w.isFront ? this.frontDrivenCount === 0 : this.rearDrivenCount === 0) continue;
        drivenSpinSum += w.spinRadS;
        drivenWheels++;
      }
      const drive = this.drivetrain.update(
        h,
        throttle,
        roadWheelSpeed,
        drivenWheels > 0 ? drivenSpinSum / drivenWheels : roadWheelSpeed,
        this.drivenRadius,
        automatic,
        input.reverse,
        input.throttle,
      );
      if (drive.driveTorqueNm !== 0) this.stepDriveTorque = true;
      this.stepFuelBurnLitres += drive.fuelBurnLitres;
      this.appliedDriveTorqueNm += (drive.driveTorqueNm - this.appliedDriveTorqueNm) * driveBlend;
      const gearDirection = this.drivetrain.gearDirection;
      this.propulsionDirection = this.appliedDriveTorqueNm * gearDirection > 0 ? gearDirection : 0;
      // The brake pedal overrides what is left of the DRIVE. Braking against a driving
      // torque through a low gear cancelled the driven axle's brake force: the RWD cars
      // needed 86 m from 100 km/h instead of 60, and their rear tyres never reached
      // their friction limit, so a rear-biased brake could not step the tail out. The
      // overrun drag is not overridden: it adds to the brakes, as it does on a real car.
      const appliedTorque =
        this.propulsionDirection !== 0 ? this.appliedDriveTorqueNm * (1 - brake) : this.appliedDriveTorqueNm;
      for (const w of this.wheels) {
        const axleShare = w.isFront ? frontShare : rearShare;
        const axleCount = w.isFront ? this.frontDrivenCount : this.rearDrivenCount;
        w.driveTorqueNm = axleShare > 0 && axleCount > 0 ? (appliedTorque * axleShare) / axleCount : 0;
      }
      const spinCeiling = this.drivetrain.maxDrivenWheelSpinRadS;
      // The crank and flywheel a driven wheel has to drag round with it, geared up by
      // the square of the ratio. See `Drivetrain.drivenWheelInertiaKgM2`: without it a
      // driven wheel is a bare disc and every dip in load is an instant wheelspin.
      const drivelineInertia = this.drivetrain.drivenWheelInertiaKgM2(drivenCount);
      this.applyDifferentials(h, drivelineInertia);
      carDigWeight = 0;
      for (const w of this.wheels) {
        const dig = this.substepWheel(w, h, dt, share, vehicleForwardSpeed, drivelineInertia, spinCeiling);
        if (dig > carDigWeight) carDigWeight = dig;
      }
    }
    this.digWeightCar = carDigWeight;

    // THE BODY: each tyre's step, as impulses.
    for (const w of this.wheels) {
      const inContact = w.inContact;
      const contactSpeed = w.contactSpeed;
      const slipScale = w.slipScale;
      const longitudinalForce = w.longitudinalForceN;
      const gripUsage = w.gripUsage;
      if (inContact) this.ownTyreCapacityN += w.longitudinalCapacityN;

      // Only a moving car can have a locked wheel; a stopped one is just stopped.
      w.locked = Math.abs(contactSpeed) > SLIDE_MIN_MPS && w.slipRatio <= LOCK_SLIP_RATIO;

      // Drive the chassis with it, at the contact patch. Applying it there is what
      // produces the pitch couple (dive and squat) for free — and, because Rapier has
      // no suspension geometry to react any of it, produces ALL of it. `applyAntiPitch`
      // below takes back the share real links would have carried, so the running total
      // is accumulated here rather than recomputed from the pedals.
      if (longitudinalForce !== 0) {
        const impulse = longitudinalForce * dt;
        this.tyreImpulse.x = w.forwardDir.x * impulse;
        this.tyreImpulse.y = w.forwardDir.y * impulse;
        this.tyreImpulse.z = w.forwardDir.z * impulse;
        this.chassisBody.applyImpulseAtPoint(this.tyreImpulse, w.contactPoint, false);
        this.longitudinalForceSum += longitudinalForce;
      }

      // LATERAL FORCE, ours now. Three things decide it: the capacity the setup pass
      // sized from load and surface, the slip-angle curve read at the BUILT angle, and
      // what the longitudinal slip has taken of the patch — COMBINED SLIP, read at the
      // carcass slip ratio and the built angle of each substep (`sideCurveShare`), so
      // drive and brake take their share of one budget and the slip angle took its
      // share of theirs. With no slip ratio it is the pure side-force curve.
      //
      // Applied at the contact patch's POSITION but at the axle's ROLL-CENTRE HEIGHT,
      // because that is where the links hand it to the body. The body therefore feels
      // the side force times the centre of mass' height above the roll axis — the
      // ELASTIC transfer, which rolls it onto its springs and bars — and nothing of the
      // part below the roll centre, which the links carry straight to the tyres
      // (`linkN`, resolved per axle after this loop). The two add up to the whole
      // `m · a · h`, and the split between them is set by the linkage, not by a gain.
      let lateralForceN = 0;
      w.sideForceBodyXN = 0;
      w.kingpinMomentNm = 0;
      // The patch's combined slip σ (the COMBINED SLIP block): how much of it slides.
      w.alignSlip = Math.hypot(w.sideSlip, w.carcassSlip * slipScale);
      if (inContact && w.lateralCapacityN > 0) {
        const capacityImpulse = w.lateralCapacityN * dt;
        const curveImpulse = capacityImpulse * w.sideCurveShare;
        // Friction opposes the slip and never reverses it inside one step: cap the
        // impulse at what brings this contact's sideways speed exactly to zero, with
        // the wheel's share of the mass taken from the load it is carrying. Without
        // that cap a stiff tyre at 60 Hz overshoots and the car shivers on its axles.
        const shareMass = w.loadN / GRAVITY;
        const stopImpulse = Math.abs(w.lateralSpeed) * shareMass;
        // STATIC HOLD. A slip-angle curve is a rolling tyre's law, and a car at
        // walking pace is not rolling enough to have one: the angle collapses, the
        // curve asks for almost nothing, and the car creeps sideways down a camber —
        // which Rapier's velocity-cancelling constraint used to prevent for free.
        // Below LATERAL_STATIC_SPEED_MPS the tyre is therefore allowed to spend what its
        // longitudinal force has left of its capacity (the friction circle, in force,
        // which is what static friction obeys) on simply stopping the slide. It is still
        // bounded by that capacity, so a hard enough shove still slides the car.
        //
        // The hold is all four tyres stopping the same sideways motion in the same step,
        // so its share is of the mass the PATCHES see together, which is less than the
        // car's: the impulses go in at the roll centres, below the centre of mass, so
        // they roll the body as well as shoving it, and the patches — further below
        // again — move by both. Sized as the plain share the hold overshot by up to half
        // every step, and a parked Oka sat buzzing on its tyres at ±2 kN a corner.
        const arm = this.rollLeverArm;
        const holdImpulse =
          stopImpulse /
          (1 + (bodyMass * (arm - w.rollCentreM) * arm) / this.rollInertiaKgM2);
        const staticBlend = clamp(1 - Math.abs(contactSpeed) / LATERAL_STATIC_SPEED_MPS, 0, 1);
        const staticImpulse = Math.min(capacityImpulse * w.sideStaticShare, holdImpulse) * staticBlend;
        const magnitude = Math.min(stopImpulse, Math.max(curveImpulse, staticImpulse));
        lateralForceN = magnitude / dt;
        const impulse = -Math.sign(w.lateralSpeed) * magnitude;
        if (impulse !== 0) {
          this.tyreImpulse.x = w.lateralRightX * impulse;
          this.tyreImpulse.y = w.lateralRightY * impulse;
          this.tyreImpulse.z = w.lateralRightZ * impulse;
          // The roll centre is fixed to the body (`rollCentreLocalY`), so the point is
          // the contact patch moved along the body's own up axis to that height. Body
          // frame, not world: a rolled body carries its roll axis with it.
          const up = this.bodyUpScratch;
          const localY =
            (w.contactPoint.x - bodyOrigin.x) * up.x +
            (w.contactPoint.y - bodyOrigin.y) * up.y +
            (w.contactPoint.z - bodyOrigin.z) * up.z;
          const lift = w.rollCentreLocalY - localY;
          this.lateralPoint.x = w.contactPoint.x + up.x * lift;
          this.lateralPoint.y = w.contactPoint.y + up.y * lift;
          this.lateralPoint.z = w.contactPoint.z + up.z * lift;
          const right = this.bodyRightScratch;
          w.sideForceBodyXN =
            (this.tyreImpulse.x * right.x +
              this.tyreImpulse.y * right.y +
              this.tyreImpulse.z * right.z) /
            dt;
          this.chassisBody.applyImpulseAtPoint(this.tyreImpulse, this.lateralPoint, false);
          // ALIGNING MOMENT. The force acts the pneumatic trail behind the contact
          // centre along the direction the tyre is ROLLING, so on the body it carries a
          // moment about the vertical of exactly -trail * impulse (forward and right are
          // orthogonal unit vectors in the ground plane, so the cross product collapses to
          // that). The trail collapses as the patch slides (`pneumaticTrailShape`), so a
          // sliding tyre's force acts where the patch is. The steering feels the same
          // force about its own axis, which meets the road the caster's mechanical trail
          // ahead of the patch whichever way the car is rolling (`STEER_FREE_TAU_S`).
          const pneumaticTrail =
            (contactSpeed < 0 ? -PNEUMATIC_TRAIL_M : PNEUMATIC_TRAIL_M) * pneumaticTrailShape(w.alignSlip);
          this.alignTorqueImpulse -= pneumaticTrail * impulse;
          w.kingpinMomentNm = (-(pneumaticTrail + w.casterTrailM) * impulse) / dt;
        }

        // LOOSE-SURFACE PLOUGHING. Cornering grip stays low on sand, but a tyre
        // travelling substantially sideways builds a bank of material against its
        // sidewall. That force is drag, not extra steering grip: it wakes only at
        // large lateral speed and cannot reverse the slide within this step.
        //
        // Apply it at the real contact patch rather than the COM-height point above.
        // The low application point is the trip mechanism of a broadside sand skid:
        // the vehicle sheds energy quickly and the body can carry on over the tyres.
        const deformationDrag =
          SURFACES[w.groundSurface].deformationDrag * weatherSoftness(w.groundSurface);
        if (deformationDrag > 0 && magnitude < stopImpulse) {
          const deformationT = clamp(
            (Math.abs(w.lateralSpeed) - DEFORMATION_DRAG_START_MPS) /
              (DEFORMATION_DRAG_FULL_MPS - DEFORMATION_DRAG_START_MPS),
            0,
            1,
          );
          const smoothDeformationT =
            deformationT * deformationT * (3 - 2 * deformationT);
          const deformationMagnitude = Math.min(
            stopImpulse - magnitude,
            w.loadN * deformationDrag * smoothDeformationT * dt,
          );
          const deformationImpulse =
            -Math.sign(w.lateralSpeed) * deformationMagnitude;
          if (deformationImpulse !== 0) {
            this.tyreImpulse.x = w.lateralRightX * deformationImpulse;
            this.tyreImpulse.y = w.lateralRightY * deformationImpulse;
            this.tyreImpulse.z = w.lateralRightZ * deformationImpulse;
            this.chassisBody.applyImpulseAtPoint(
              this.tyreImpulse,
              w.contactPoint,
              false,
            );
          }
        }
      }

      // THE ROAD, through the tyre. See the TYRE AS A SPRING block above for why this
      // is not the suspension's job.
      //
      // `w.profileHeight` is the enveloped ground the collider does not carry, under
      // this wheel, in metres. The wheel is a mass on the tyre's carcass rate with the
      // suspension between it and the body:
      //
      //   m_u * z_u'' = k_t (h - z_u) + c_t (h' - z_u') - k_s z_u - c_s z_u'
      //   F_body      = k_s z_u + c_s z_u'
      //
      // Both spring terms are relative to the body, which is treated as still over the
      // 10-14 Hz the hop mode lives at — the body's own motion is Rapier's problem and
      // it is already solving it against the smooth collider. Integrated semi-implicitly
      // so the stiff tyre rate is stable at 60 Hz.
      //
      // A BEAM axle with both wheels down is one unsprung body, stepped after this loop
      // (`stepBeamAxleHop`); with one end in the air, the end still down rides alone.
      const beamHop = w.beamPartner !== null && beamAxleDown(w, w.beamPartner);
      if (!beamHop && inContact && w.loadN > 0) {
        const mUnsprung = unsprungMass(w.radius);
        const kSusp = w.springRateNPerM;
        const cSusp = w.hopV > 0 ? w.compressionRateNsPerM : w.relaxationRateNsPerM;
        const cTyre = 2 * TYRE_DAMPING_RATIO * Math.sqrt(w.tyreRateN * mUnsprung);

        // Solved for the new velocity with BOTH springs and BOTH dampers evaluated at
        // it. The tyre rate is 165 kN/m against 38 kg, i.e. a 10.5 Hz mode at 60 Hz
        // steps: an explicit step would ring at that rate and a symplectic one would
        // mistune it, so the whole pair goes in the denominator and the solve is
        // unconditionally stable.
        const kTotal = kSusp + w.tyreRateN;
        const cTotal = cSusp + cTyre;
        const drive = w.tyreRateN * w.profileHeight + cTyre * w.profileRate;
        w.hopV =
          (mUnsprung * w.hopV + dt * (drive - kTotal * w.hopZ)) /
          (mUnsprung + dt * cTotal + dt * dt * kTotal);
        w.hopZ += w.hopV * dt;

        // The suspension force that moving wheel makes on the body. A road can take a
        // wheel's load away and it can push, but it cannot PULL the car down: bounding
        // the force at minus this wheel's own load is the tyre leaving the ground, and
        // it is the physical bound the old 0.9-of-static force cap stood in for.
        let bodyForce = kSusp * w.hopZ + cSusp * w.hopV;
        if (bodyForce < -w.loadN) bodyForce = -w.loadN;
        if (bodyForce !== 0) {
          rotateVector(this.microUp, this.rotationScratch, 0, bodyForce * dt, 0);
          this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
        }
      } else if (!beamHop) {
        // Airborne: the carcass relaxes towards free length rather than storing the
        // last bump until the landing.
        w.hopZ *= 0.5;
        w.hopV *= 0.5;
      }

      // The bump stop and the damper's bleed, sized off this step's travel in
      // `resolveTravel`, pushed in at the contact patch.
      if (w.bumpStopN !== 0) {
        rotateVector(this.microUp, this.rotationScratch, 0, w.bumpStopN * dt, 0);
        this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
      }
      if (w.bleedN !== 0) {
        rotateVector(this.microUp, this.rotationScratch, 0, w.bleedN * dt, 0);
        this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
      }

      // Friction-circle usage: how much of THIS tyre's force capacity the
      // longitudinal channel is eating, which is what it has no longer got left for
      // cornering.
      //
      // It must be a force ratio. The first version divided slip by the peak ratio,
      // which is unbounded and reads 1.0 at a slip of 0.12 — and a car at full
      // throttle cruises at 0.28-0.34. So every driven wheel sat pinned at "fully
      // sliding" whenever the throttle was open, cutting its side grip to the
      // ellipse's floor and never giving it back. On a rear-driven car that is the
      // tail letting go the moment you use the engine, with no recovery: reported as
      // the fastback going straight on and refusing to steer at speed.
      const slideTarget =
        Math.abs(contactSpeed) > SLIDE_MIN_MPS
          ? clamp((gripUsage - SLIDE_CONE_THRESHOLD) / (1 - SLIDE_CONE_THRESHOLD), 0, 1)
          : 0;
      w.slideT +=
        (slideTarget - w.slideT) *
        (slideTarget > w.slideT ? slideOnsetBlend : slideRecoverBlend);

      // TYRE TEMPERATURE. Everything above has already computed the two forces and the
      // two slip speeds, so the energy balance is four reads and no new state: the
      // power dissipated at the contact patch, against the heat the air takes away. The
      // longitudinal half is the substeps' own (`longitudinalSlipPowerW`).
      const rollingForceN = w.loadN * SURFACES[w.groundSurface].rollingResistance;
      const slipPowerW =
        (w.longitudinalSlipPowerW + lateralForceN * Math.abs(w.lateralSpeed)) * TYRE_SLIP_HEAT_SHARE +
        rollingForceN * Math.abs(contactSpeed) * TYRE_ROLLING_HEAT_SHARE;
      const airflow = Math.abs(contactSpeed);
      const coolingW =
        (TYRE_COOLING_STILL_W_PER_K + TYRE_COOLING_AIRFLOW_GAIN * Math.sqrt(airflow)) *
        (w.tyreTempC - airC);
      // Bounded at both ends: the air is the floor (a tyre in this sun is never cooler
      // than the air it stands in) and the model's own ceiling is the top, past which
      // the tread compound is beyond anything this represents.
      w.tyreTempC = clamp(
        w.tyreTempC + ((slipPowerW - coolingW) * dt) / TYRE_TREAD_CAPACITY_J_PER_K,
        airC,
        TYRE_MAX_C,
      );
    }

    this.stepBeamAxleHop(dt);
    this.resolveLinkTransfer();

    // One torque impulse for the whole axle set. Applied after the loop so the four
    // aligning moments are summed rather than four separate solver touches, and about
    // WORLD up rather than the body's: at any lean the yaw axis a car is disturbed
    // about is the vertical one, not its own tilted Y.
    if (this.alignTorqueImpulse !== 0) {
      this.forceScratch.x = 0;
      this.forceScratch.y = this.alignTorqueImpulse;
      this.forceScratch.z = 0;
      this.chassisBody.applyTorqueImpulse(this.forceScratch, false);
      this.alignTorqueImpulse = 0;
    }
  }

  /**
   * One wheel through one substep of `updateWheelDynamics`: the drive torque this
   * substep's driveline left on it and the brake, against the contact the step read.
   * Adds the substep's share into the wheel's step means and returns its dig weight.
   */
  private substepWheel(
    w: WheelVisual,
    h: number,
    dt: number,
    share: number,
    vehicleForwardSpeed: number,
    drivelineInertia: number,
    spinCeiling: number,
  ): number {
    const driven = w.isFront ? this.frontDrivenCount > 0 : this.rearDrivenCount > 0;
    // Pushing the car, not holding it back on the overrun: the dig and the low range
    // answer to propulsion only.
    const propelled = driven && this.propulsionDirection !== 0 && w.driveTorqueNm !== 0;
    const driveProgressSpeed = Math.max(0, vehicleForwardSpeed * this.propulsionDirection);
    const surfaceType = w.contactSurface;
    const contactSpeed = w.contactSpeed;
    const loadFactor = w.longitudinalLoadFactor;

    // The longitudinal capacity, from the load this corner is carrying and the
    // coefficient of the ground under it. It sizes both the force the tyre may make
    // and, on loose ground, the dig.
    let capacityN = 0;
    // Cleared before the capacity block rather than inside it: a wheel that has left
    // the ground has no dig on it, and the last value would otherwise keep firm sand's
    // rolling resistance under a wheel that is not touching anything.
    w.digWeight = 0;
    if (w.loadN > 0) {
      let longitudinalMu = w.longitudinalMu;
      // THE DIG — see the block comment on `DIG_FIRM_MU`. Sand only, and driven wheels
      // only: on a car with a driven front axle the dig firms both, which is the same
      // concession applied to the wheels doing the work.
      //
      // Gate on the CAR'S SPEED, not the wheel's. `driveProgressSpeed` is the car's
      // own speed along the intended direction of travel, floored at zero, so a car
      // being dragged backwards down a dune still counts as stopped and still digs.
      if (propelled && DIG_SURFACES.has(surfaceType)) {
        const fadeT = clamp(
          (driveProgressSpeed - DIG_FULL_MPS) / (DIG_GONE_MPS - DIG_FULL_MPS),
          0,
          1,
        );
        const digWeight = 1 - fadeT * fadeT * (3 - 2 * fadeT);
        longitudinalMu = Math.max(longitudinalMu, DIG_FIRM_MU * digWeight * loadFactor);
        w.digWeight = digWeight;
      }
      // THE LOW RANGE — see the block comment on `LOW_RANGE_MU`. The road deck only, and
      // driven wheels only. Applied AFTER the dig, and below its 1.6, so on loose ground
      // the dig's own figure still governs and sand is unchanged to the digit.
      if (propelled && LOW_RANGE_SURFACES.has(surfaceType)) {
        const fadeT = clamp(
          (driveProgressSpeed - LOW_RANGE_FULL_MPS) /
            (LOW_RANGE_GONE_MPS - LOW_RANGE_FULL_MPS),
          0,
          1,
        );
        const lowRangeWeight = 1 - fadeT * fadeT * (3 - 2 * fadeT);
        longitudinalMu = Math.max(
          longitudinalMu,
          LOW_RANGE_MU * lowRangeWeight * loadFactor,
        );
      }
      capacityN = longitudinalMu * w.loadN;
    }

    // A DRIVEN wheel also has to turn the engine, which through the gears is the larger
    // half of the total in the low gears — and the reason a bump cannot flick it into
    // a spin.
    const inertia = w.discInertia + (driven ? drivelineInertia : 0);

    // Drive torque spins the wheel up. Nothing is taken away from it: the tyre model
    // below decides what the contact can actually transmit, and a wheel that spins
    // past its peak simply makes less force — see the slip curve. There is no traction
    // control here, deliberately; see the note where its constants used to be.
    let spin = w.spinRadS + (h * w.driveTorqueNm) / inertia;

    const brakeDelta = (h * w.brakeForceN * w.radius) / inertia;
    if (Math.abs(spin) <= brakeDelta) spin = 0;
    else spin -= Math.sign(spin) * brakeDelta;

    // The slip ratio is measured against the road speed, floored so it stays finite
    // at rest, and the force is read at the CARCASS's slip, not the wheel's: the
    // carcass winds up over a rolling distance (`longitudinalRelaxationM`), wound by
    // the faster of the road and the tread, floored so a car stood on its brakes
    // still lets its tyre's force change (LONGITUDINAL_RELAXATION_FLOOR_MPS).
    const reference = Math.max(Math.abs(contactSpeed), SLIP_REFERENCE_MPS);
    const carcassBlend =
      1 -
      Math.exp(
        -(
          Math.max(Math.abs(contactSpeed), Math.abs(spin * w.radius), LONGITUDINAL_RELAXATION_FLOOR_MPS) *
          h
        ) / this.tyre.longitudinalRelaxationM,
      );
    const slipScale = w.slipScale;
    // Relaxation: the carcass follows the geometric angle over a rolling DISTANCE,
    // so the blend is per metre travelled and a parked wheel builds nothing. What is
    // handed on is the built angle in units of the side curve's peak (COMBINED SLIP).
    w.slipAngleRad += (w.geometricSlipRad - w.slipAngleRad) * w.slipRelaxBlend;
    w.sideSlip = Math.tan(Math.min(w.slipAngleRad, 1.4)) / w.sidePeakTan;
    const sideSlip = w.inContact ? w.sideSlip : 0;
    // How fast the patch slides over the road, m/s, as the previous substep left the
    // wheel: sideways and along together. On a paved surface the brush's sliding zone
    // holds the rubber's friction at that speed (`slidingRatio`, SLIDING FRICTION in
    // vehicletuning.ts); on loose ground the placeholder keeps its constant share.
    const slide = w.slideLoose
      ? w.slideFloor
      : slidingRatio(w.slideFloor, Math.hypot(w.lateralSpeed, w.spinRadS * w.radius - contactSpeed));

    let longitudinalForce = 0;
    let gripUsage = 0;
    if (capacityN > 0) {
      // Shape: the brush tyre on a paved surface, rising to its peak and falling to
      // the rubber's sliding friction once the whole patch slides, so a spinning or
      // locked tyre keeps what rubber sliding at its speed holds; on loose ground the
      // placeholder curve and its constant sliding share (`looseLongitudinalShape`).
      // Either is read in the surface's OWN slip unit (`longitudinalSlipUnit`), not one
      // constant for the world. On sand the peak is at 0.3 against asphalt's 0.12: the
      // same tyre, shearing a material that has to move a great deal further before it
      // pushes back.
      //
      // Under slip angle the same curve is read at the COMBINED slip and only the
      // longitudinal share of it kept, so a tyre that is cornering has less to drive
      // and brake with — and with no slip angle it is the pure curve to the digit.
      if (w.cableLocked) {
        // A WHEEL THE CABLE HOLDS DOES NOT TURN, so its force is the tyre's at zero
        // spin — the sliding friction, or less once the patch is nearly still — and the
        // drum reacts the torque. It cannot be read out of the wheel's change like a
        // free wheel's, because there is none: that reading is capped by the wheel's
        // own inertia, a hundred newtons at a walk, which is why a car rolling back
        // down 8 degrees used to keep rolling with the handbrake on. Bounded instead by
        // what brings this wheel's share of the car to rest within the BODY's step (the
        // whole `dt`: the body moves once a step), so the friction stops the slide and
        // never reverses it.
        const carcass = w.carcassSlip + (-contactSpeed / reference - w.carcassSlip) * carcassBlend;
        const stopN = ((w.loadN / GRAVITY) * Math.abs(contactSpeed)) / dt;
        longitudinalForce = clamp(
          capacityN * combinedLongitudinal(carcass * slipScale, sideSlip, w.slideLoose, slide),
          -stopN,
          stopN,
        );
        spin = 0;
        gripUsage = Math.abs(longitudinalForce) / capacityN;
      } else {
        // The wheel and its carcass are solved TOGETHER, implicitly: the carcass slip
        // at the end of the substep is where it would get to with the wheel unchanged,
        // plus the blend's share of whatever the contact does to the wheel. That is
        // the existing implicit wheel step with the tyre's stiffness scaled by the
        // blend — at speed the blend is nearly 1 and nothing changes; at a crawl the
        // carcass is the slow half and the wheel moves more freely against it. Solved
        // any other way the wheel and the lagging carcass ring at ~20 Hz.
        //
        // Damping uses the curve's own slope, clamped to the rising side: past the
        // peak it goes negative, and feeding that back drives the wheel away from
        // equilibrium instead of toward it.
        //
        // The substep is linearised where its torques have put the wheel. A light
        // wheel — one the clutch is slipping behind, with no crank geared to it — can be
        // kicked by its drive torque past the tyre's peak in one substep (a launch's
        // 650 N·m spins a 0.6 kg·m² wheel up 4 rad/s in 1/240 s), where the slope is zero
        // and the force is the sliding friction: linearised there it can only ever pull
        // back the sliding force and spins up for good under a torque the tyre's peak holds
        // easily. When the kick has crossed the peak from a tyre still on its rising
        // side, the substep is linearised where the tyre STARTED instead, which is where
        // the solution is.
        const spin0 = spin;
        const carcass0 =
          w.carcassSlip + ((spin0 * w.radius - contactSpeed) / reference - w.carcassSlip) * carcassBlend;
        const slope0 = combinedLongitudinalSlope(carcass0 * slipScale, sideSlip, w.slideLoose, slide);
        const carcassStart =
          w.carcassSlip + ((w.spinRadS * w.radius - contactSpeed) / reference - w.carcassSlip) * carcassBlend;
        const slopeStart =
          slope0 > 0 ? 0 : combinedLongitudinalSlope(carcassStart * slipScale, sideSlip, w.slideLoose, slide);
        const fromStart = slopeStart > 0;
        const stiffness =
          (capacityN *
            Math.max(0, fromStart ? slopeStart : slope0) *
            slipScale *
            carcassBlend *
            w.radius) /
          reference;
        let delta: number;
        if (fromStart) {
          const forceStart =
            capacityN * combinedLongitudinal(carcassStart * slipScale, sideSlip, w.slideLoose, slide);
          const kick = spin0 - w.spinRadS;
          delta =
            (inertia * kick - h * forceStart * w.radius) / (inertia + h * stiffness * w.radius) - kick;
        } else {
          const force0 = capacityN * combinedLongitudinal(carcass0 * slipScale, sideSlip, w.slideLoose, slide);
          delta = -(h * force0 * w.radius) / (inertia + h * stiffness * w.radius);
        }

        // Friction reduces sliding; it never reverses it within one step. Without
        // this projection the wheel shot straight past synchronous speed every tick
        // — once the tyre is past its peak the damping slope is zero, so nothing held
        // the step back — and the force alternated sign from tick to tick. Measured
        // like that: 23.8 km/h after twenty seconds of full throttle, and 0.06 g of
        // braking.
        const toSync = contactSpeed / w.radius - spin0;
        delta =
          delta >= 0 ? Math.min(delta, Math.max(0, toSync)) : Math.max(delta, Math.min(0, toSync));

        // Read the force back OUT of the wheel's actual change: whatever torque the
        // contact took from the wheel is what the tyre put into the road. That keeps
        // action and reaction equal on the substep the projection binds — which is
        // exactly where a gripping tyre is transmitting everything the engine sent it,
        // and where deriving the force from the post-step slip would instead report zero.
        longitudinalForce = clamp((-inertia * delta) / (h * w.radius), -capacityN, capacityN);
        spin = spin0 - (longitudinalForce * h * w.radius) / inertia;
        gripUsage = Math.abs(longitudinalForce) / capacityN;
      }
    }
    if (w.cableLocked) spin = 0;

    // Geared to the engine, so it cannot outrun the engine's redline.
    if (driven && spinCeiling !== Infinity) spin = clamp(spin, -spinCeiling, spinCeiling);

    w.spinRadS = spin;
    w.drawnSpin += spin * h;
    w.longitudinalCapacityN = capacityN;

    w.slipRatio = (spin * w.radius - contactSpeed) / reference;
    // The carcass follows the wheel by the blend the solve assumed. A tyre carrying
    // nothing is not wound up at all.
    w.carcassSlip =
      capacityN > 0 ? w.carcassSlip + (w.slipRatio - w.carcassSlip) * carcassBlend : 0;

    // The substep's share of the step. The slip power reads `spin` after the force, so
    // a locked wheel reports the full road speed as slip and a rolling one almost none —
    // which is exactly the difference between a tyre being dragged and one being driven.
    w.longitudinalForceN += longitudinalForce * share;
    w.gripUsage += gripUsage * share;
    w.longitudinalSlipPowerW +=
      Math.abs(longitudinalForce) * Math.abs(spin * w.radius - contactSpeed) * share;
    if (w.inContact && w.lateralCapacityN > 0) {
      // The side-force curve read at the carcass slip ratio this substep left (COMBINED
      // SLIP), and the friction circle's remainder the static hold may spend.
      w.sideCurveShare +=
        combinedLateral(
          w.sideSlip,
          w.carcassSlip * slipScale,
          w.sidePeakTan,
          w.sideFadePeakDeg,
          w.sideFullDeg,
          w.sidePlateau,
          w.slideLoose,
          slide,
        ) * share;
      w.sideStaticShare += Math.sqrt(Math.max(0, 1 - gripUsage * gripUsage)) * share;
    }
    return w.digWeight;
  }

  /**
   * Copies per-wheel contact, orientation, slip and surface data into the pre-allocated
   * ground-effect states, and load/travel into `wheelRideStates`. Runs once per fixed
   * step after wheel dynamics finalise, and never allocates.
   */
  private refreshWheelSpray(forwardSpeed: number): void {
    const n = this.wheels.length;
    for (let i = 0; i < n; i++) {
      const w = this.wheels[i];
      const s = this.wheelSprayStates[i];
      s.contactX = w.contactPoint.x;
      s.contactY = w.contactPoint.y;
      s.contactZ = w.contactPoint.z;
      s.absoluteContactX = w.contactPoint.x + this.origin.x;
      s.absoluteContactZ = w.contactPoint.z + this.origin.z;
      s.forwardX = w.forwardDir.x;
      s.forwardY = w.forwardDir.y;
      s.forwardZ = w.forwardDir.z;
      s.normalX = w.contactNormal.x;
      s.normalY = w.contactNormal.y;
      s.normalZ = w.contactNormal.z;
      s.inContact = w.grounded;
      s.surface = w.groundSurface;
      s.slipRatio = w.slipRatio;
      s.slideSlip = Math.max(
        0,
        Math.abs(w.slipRatio) - longitudinalSlipUnit(SURFACES[w.groundSurface]),
      );
      s.forwardSpeed = forwardSpeed;

      const r = this.wheelRideStates[i];
      r.inContact = w.grounded;
      r.loadN = w.loadN;
      r.staticLoadN = w.staticLoadN;
      r.compressionM = w.compressionM;
      r.reserveM = w.maxTravelM - w.compressionM;
      r.bumpStopN = w.bumpStopN;
      r.tyreDeflectionM = w.profileHeight - w.hopZ;
      r.tyreTempC = w.tyreTempC;
      r.tyreGrip = w.tyreGrip;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.originDisposer?.();
    this.originDisposer = null;
    this.tyres = null;
    this.physics.removeBody(this.chassisBody);
    this.clearVisuals();
    this.scene.remove(this.rootGroup);
  }

  // ---------------------------------------------------------------------------
  // Internals.
  // ---------------------------------------------------------------------------

  /**
   * The car's mass sheet: its own kerb weight, plus everything that has since changed,
   * each item carrying where it SITS as well as what it weighs.
   *
   * `model.mass` IS the kerb weight: a complete car with its stock engine, radiator
   * and tank, ALL RESERVOIRS FULL. That is what a factory figure means, and taking it
   * as the reference is what lets a stock car weigh exactly what the catalogue says
   * while still feeling everything the player does to it. So each term below is a
   * DELTA from that state rather than an addition to it:
   *
   *   - fitted service parts, against the ones this model left the factory with;
   *   - fuel, against a full tank — so a dry car is 45 kg lighter than kerb;
   *   - water and oil, against their full capacities;
   *   - cargo in the boot, and whatever the driver is carrying.
   *
   * Adding these outright instead would double-count the stock parts and the full
   * fluids, and every car would start life tens of kilograms above its own published
   * weight with its springs already part-compressed.
   *
   * A stock car therefore returns an EMPTY sheet, and the kerb body on its own is the
   * whole car — which is what keeps an unloaded car exactly where it always was. Every
   * delta that is not zero is a point mass at its own anchor (`measureLoadAnchors`),
   * and `applyChassisMass` combines them with the kerb point. Without the positions a
   * boot crate would be carried by the car's own centre of mass, and the nose of a
   * front-drive hatchback would take 62% of a load that is sitting over its back axle.
   */
  private computeStats(): VehicleStats {
    const installedEngine = bonnetPart(this.car.bonnet, 0);
    const installedSpec = installedEngine ? variant(installedEngine.variantId).engine : undefined;
    const engine = installedSpec ?? modelEngine(this.model);

    const stock = stockBonnetVariants(this.model.engineId);
    const anchors = this.loadAnchors;
    const loads: LoadPoint[] = [];
    /** Records one load at its anchor and returns its mass, so the sum reads as one line. */
    const load = (label: string, massKg: number, at: { y: number; z: number }): number => {
      if (massKg !== 0) loads.push({ label, massKg, x: 0, y: at.y, z: at.z });
      return massKg;
    };
    let mass = this.model.mass;

    // Service parts, cell by cell against the factory fit. The turbocharger's factory
    // state is EMPTY, so anything fitted there is pure addition. Every cell is under
    // the bonnet, so the whole delta is one load in the engine bay.
    let parts = 0;
    for (let cell = 0; cell < BONNET_SLOT_COUNT; cell++) {
      const part = bonnetPart(this.car.bonnet, cell);
      const fitted = part ? variant(part.variantId).mass : 0;
      const stockId = stock[cell] ?? null;
      parts += fitted - (stockId === null ? 0 : variant(stockId).mass);
    }
    mass += load('engine bay', parts, anchors.engine);

    // Fuel, water and oil, measured against full reservoirs — and placed where each of
    // them actually is: the tank under the rear seat, the fluids with the engine.
    mass += load(
      'fuel',
      (this.car.fuelLitres - this.model.tankLitres) * FUEL_DENSITY,
      anchors.tank,
    );
    mass += load('water', this.car.waterLitres - stockRadiatorWater(stock[2]!), anchors.engine);
    mass += load(
      'oil',
      (this.car.oilLitres - oilCapacity(engine)) * FLUID_DENSITY_OIL,
      anchors.engine,
    );

    // Cargo: the hold's own cells behind the rear axle, and what the driver is
    // carrying, which rides in the seat with him, as does what lies in the cabin.
    let cargo = 0;
    for (const item of this.car.storage) if (item) cargo += itemMass(item);
    mass += load('cargo', cargo, anchors.hold);
    mass += load('carried', this.carriedMassKg + cabinMass(this.car.cabin), anchors.seat);

    return {
      mass: Math.max(1, mass),
      loads,
      engine,
      gearbox: this.gearboxFor(engine),
      tankCapacity: this.model.tankLitres,
      wheelCount: this.measure.wheels.length,
      wheelGrip: this.model.wheelGrip,
      hasHeadlights: true,
    };
  }

  /**
   * The gearbox that came with the engine in cell 0 (`matchGearbox`), re-derived only
   * when that engine changes so a fuel-level `refreshLoad` neither allocates nor hands
   * the drivetrain a new object.
   */
  private gearboxFor(engine: EngineSpec): GearboxSpec {
    if (this.matchedGearboxEngine !== engine || this.matchedGearboxSpec === null) {
      this.matchedGearboxEngine = engine;
      this.matchedGearboxSpec = matchGearbox(
        modelGearbox(this.model),
        modelEngine(this.model),
        engine,
        SURFACES[SurfaceType.Asphalt].rollingResistance * this.model.mass * GRAVITY,
        this.dragCoeff,
      );
    }
    return this.matchedGearboxSpec;
  }
  private matchedGearboxEngine: EngineSpec | null = null;
  private matchedGearboxSpec: GearboxSpec | null = null;

  /**
   * Mass the driver is carrying, kg, pushed in by the composition root.
   *
   * The three hand slots are physically in the car with whoever is sitting in it, so
   * they are part of what the springs carry. `Vehicle` cannot read them itself — the
   * pack belongs to the player, not to the car — so `main` reports it, and this
   * refreshes the load only when the number actually moves.
   */
  setCarriedMass(kilograms: number): void {
    const next = Math.max(0, kilograms);
    if (Math.abs(next - this.carriedMassKg) < CARRIED_MASS_EPSILON_KG) return;
    this.carriedMassKg = next;
    this.refreshLoad();
  }

  /**
   * Puts a changed mass on the road without rebuilding anything, for the changes that
   * happen while the car exists: filling the tank, loading the boot, dropping the
   * throttle on a lighter car.
   *
   * A full `rebuild` would also work and would also recreate the wheel contacts, the
   * drivetrain binding and every mesh — which is far too much to do
   * for a fuel level. Everything a load actually changes is reachable directly: the
   * chassis mass and its inertia, each wheel's static load, and the spring, damper,
   * travel and bump stop that hang off that load.
   */
  refreshLoad(): void {
    const previous = this.statsValue.mass;
    this.statsValue = this.computeStats();
    // The total is published every time — a caller reading `stats.mass` must never see
    // a stale figure — but the two things that cost real work only run when the change
    // is worth feeling. A tank drains a few grams a second, so an exact comparison here
    // would re-solve four springs and rewrite the chassis inertia on EVERY tick, for a
    // change no instrument could detect.
    if (Math.abs(this.statsValue.mass - previous) < CARRIED_MASS_EPSILON_KG) return;
    this.applyChassisMass(this.statsValue);
    this.reloadSprings();
  }

  /**
   * Whether the player drives this car from the driver's seat with their own hands (not
   * the autopilot). It gates the driver aids and nothing else: ABS and traction control
   * (`Settings.abs`, `Settings.tractionControl`) act on the player's pedals only; the
   * physics is the same whoever drives. Called every fixed step for every car, before
   * the physics step, so getting in or out takes effect on the next one.
   */
  setPlayerDriven(playerDriven: boolean): void {
    this.playerDriven = playerDriven;
  }

  /**
   * Wheel-loop substeps per fixed step (vehicletuning.ts `WHEEL_SUBSTEPS`). The traffic
   * sets its cars to `TRAFFIC_WHEEL_SUBSTEPS` once, at spawn.
   */
  setWheelSubsteps(substeps: number): void {
    this.wheelSubsteps = Math.max(1, Math.round(substeps));
  }

  /**
   * Lets this car's wheels skip the tread cast where it cannot matter
   * (vehicle/tyrecontact.ts, THE TREAD CAST CAN BE GATED). The traffic sets it every
   * step for each of its driven cars; the player's car never has it.
   */
  setTreadCastGate(open: boolean): void {
    this.treadCastGate = open;
    this.tyres?.setTreadCastGate(open);
  }

  /**
   * Re-loads every corner for the mass the car is now carrying.
   *
   * THE RATES ARE ABSOLUTE, and that is the whole reason a load is felt at all. A
   * per-kilogram rate multiplied by the chassis mass — which is what the catalogue's
   * ride frequencies convert to — gives a car that sags to exactly the same ride
   * height whether it is empty or carrying four hundred kilograms of engine. The
   * spring rate a real car has does not change when you put something in the boot, so
   * the rate is in newtons per metre: the same spring, now carrying more, sits lower
   * and rings slower, and the bump stop arrives correspondingly sooner.
   *
   * WHAT MAY NOT MOVE WITH THE LOAD IS THE GEOMETRY. The free length the wheel hangs
   * on, the travel it is allowed and where the bump stop begins are all cuts of the
   * car, made once against the KERB design in `rebuild`. Only what depends on what the
   * corner is carrying is re-derived here: its static load, the force cap that rides
   * on it, and the sag the load asks for. Those are the whole of what "loaded" means.
   *
   * The rates themselves come from the ride frequency at the KERB mass, so a stock car
   * still sits and rides exactly where its preset says.
   */
  private reloadSprings(): void {
    if (!this.tyres) return;
    const stats = this.statsValue;
    const weightN = stats.mass * GRAVITY;
    this.tyreReferenceLoadN = weightN / Math.max(1, this.axleGeometry.frontCount + this.axleGeometry.rearCount);
    const suspension = this.model.suspension;
    const axles = this.axleGeometry;

    for (const w of this.wheels) {
      // The DESIGN share sizes the spring; the LIVE share is what the corner is
      // carrying now. `applyChassisMass` resolved it from the car's real centre of
      // mass, so a crate in the boot has already shifted it off the nose by the time
      // these springs are asked to carry it — see `rebuild` for the full split.
      const designShare = w.isFront ? axles.frontWeightShare : 1 - axles.frontWeightShare;
      const liveShare = w.isFront ? this.parkedFrontShare : 1 - this.parkedFrontShare;
      const axleCount = w.isFront ? axles.frontCount : axles.rearCount;
      const hz = w.isFront ? suspension.frontHz : suspension.rearHz;
      const compressionRatio = suspension.compressionRatio;
      const reboundRatio = suspension.reboundRatio;

      // Sized at the kerb load, then asked to carry the real one.
      const designCornerMass = this.model.mass * (designShare / Math.max(1, axleCount));
      const staticLoadN = Math.max(1, weightN * (liveShare / Math.max(1, axleCount)));
      w.staticLoadN = staticLoadN;
      w.springRateNPerM = wheelSpringRateAbs(hz, designCornerMass);
      w.compressionRateNsPerM = wheelDampingRateAbs(hz, compressionRatio, designCornerMass);
      w.relaxationRateNsPerM = wheelDampingRateAbs(hz, reboundRatio, designCornerMass);

      // Ride frequency is no longer a preset constant once the car is loaded, so it is
      // measured rather than assumed: this is what an instrument would read.
      const cornerMass = staticLoadN / GRAVITY;
      w.rideHz = Math.sqrt(w.springRateNPerM / Math.max(1, cornerMass)) / (2 * Math.PI);
      // THE SAG IS A CONSEQUENCE, NOT A SETTING. The same spring, compressed by
      // `load / rate`, settles this corner that far below its free length, so the car
      // sits lower, rings slower and runs out of bump travel sooner. The geometry it
      // compresses INTO — free length, travel and the bump stop — was cut once from the
      // kerb design in `rebuild` and is not touched here; a corner whose load asks for
      // more sag than it has travel rests on its stop, which is what an overloaded car
      // does. Re-deriving the free length here instead is the bug this replaced: it
      // moved the spring's free length with the load, which cancels the sag exactly
      // (`rest - length` stays at the mount height whatever the load) and leaves a car
      // that is only softer.
      w.sagM = staticLoadN / w.springRateNPerM;

      w.tyre.springRateNPerM = w.springRateNPerM;
      w.tyre.compressionRateNsPerM = w.compressionRateNsPerM;
      w.tyre.relaxationRateNsPerM = w.relaxationRateNsPerM;
      w.tyre.maxForceN = SUSPENSION_FORCE_HEADROOM * staticLoadN;
    }
  }

  /**
   * The steering for one step: where the driver's hands want the rack (`SteerMode`),
   * the rack speed, and the tyres' own aligning moment.
   *
   * WHERE THE FRONT TYRES ARE GOING. Each front tyre's patch is travelling in some
   * direction; the rack angle at which that tyre would roll exactly along it is the
   * patch's direction less what the tyre's geometry (Ackermann, toe, roll and bump
   * steer) and camber thrust already add to the rack's. Weighted by load across the
   * axle, that is the TRAVEL angle: no side force at all, and no aligning moment.
   *
   * THE KEYS move a steering-wheel position (KEYBOARD STEERING in vehicletuning.ts):
   * a held key gathering speed like a hand, slower winding into a turn near the limit
   * and quicker against it, by the lateral acceleration; let go, it eases back to
   * centre. The rack target is the rim over the steering ratio.
   *
   * THE MOUSE (mouse driving, core/input.ts) is a rim angle the player put there, sent
   * `direct`: the rack is held at it, so nothing here — no assist, no caster return —
   * turns the wheel away from where the mouse left it.
   *
   * THE PAD'S ASSIST. A stick with the assist on is a position against a reach: the
   * front tyres' own peak (`sidePeakTan`, their brush peak at their current load) plus
   * `STEER_ASSIST_SLIP_MARGIN`, measured from where the front axle is going, so the
   * stick's edge runs the front axle at its peak at any speed and the stick the tail is
   * stepping toward reaches past the travel angle without a special case — that is a
   * countersteer. It never asks for less than the same share of the KINEMATIC angle of
   * the tightest circle the front axle's grip can hold at this speed, `atan(L · a / v²)`,
   * which is the whole lock at parking speeds, where the slip angle cannot get near its
   * peak. Backwards or airborne there is nothing to measure and the reach is the lock.
   *
   * HANDS ON AND OFF. No hand on the wheel — a stick at exactly 0, or the keys up with
   * the rim come round to where the caster takes it — leaves the rack free: the tyres
   * swing toward their travel angle on their aligning moment (`STEER_FREE_TAU_S`), never
   * past it, and the rim follows them. A hand on the wheel moves the rack at the rack
   * speed and holds it there.
   *
   * The negation converts our basis into Rapier's steering sign. Forward is +Z and the
   * axle is set to (-1, 0, 0), and with that pairing a POSITIVE steering angle yaws the
   * car left, while `input.steer` is positive for "the player pressed right". Measured:
   * without this negation, holding right rotated the car +1.74 rad (left) over two
   * seconds.
   */
  private updateSteering(dt: number, input: InputFrame, fwd: number): void {
    const lock = this.model.steerLock;
    const steer = clamp(input.steer, -1, 1);
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.bodyRightScratch, this.rotationScratch, 1, 0, 0);
    rotateVector(this.bodyForwardScratch, this.rotationScratch, 0, 0, 1);
    const right = this.bodyRightScratch;
    const forward = this.bodyForwardScratch;
    const rolling = fwd < 0 ? -1 : 1;

    // One pass over the front tyres as the last step left them: the moment about the
    // steering axes and the one it is measured against (`STEER_FREE_TAU_S`), the travel
    // angle and the peak, and the steering-lightness cue.
    const staticCapacityPerN =
      SURFACES[SurfaceType.Asphalt].mu * this.handling.tyreLateralScale * this.tyreCarGrip(this.statsValue.mass);
    let moment = 0;
    let referenceMoment = 0;
    let travel = 0;
    let peak = 0;
    let lightness = 0;
    let load = 0;
    let capacity = 0;
    let staticLoad = 0;
    let rearSlide = 0;
    let rearLoad = 0;
    let rearForce = 0;
    for (const w of this.wheels) {
      if (!w.isFront) {
        if (w.grounded && w.loadN > 0) {
          rearSlide += w.loadN * w.sideSlip;
          rearLoad += w.loadN;
          rearForce += w.sideForceBodyXN;
        }
        continue;
      }
      moment += w.kingpinMomentNm;
      referenceMoment += staticCapacityPerN * w.staticLoadN * PNEUMATIC_TRAIL_M;
      if (!w.grounded || w.loadN <= 0) continue;
      const along =
        w.contactVel.x * right.x + w.contactVel.y * right.y + w.contactVel.z * right.z;
      const ahead =
        w.contactVel.x * forward.x + w.contactVel.y * forward.y + w.contactVel.z * forward.z;
      // The patch's line of travel, either way along it, on the tyre model's own slip
      // floor (`SLIP_ANGLE_REF_MPS`), less the steer the tyre's geometry adds.
      travel +=
        w.loadN *
        (Math.atan2(along * rolling, Math.max(Math.abs(ahead), SLIP_ANGLE_REF_MPS)) -
          (this.wheelSteerAngle(w) - this.steerAngle) -
          w.camberSteerRad);
      peak += w.loadN * Math.atan(w.sidePeakTan);
      // Past the moment's own peak, the share of it the tyre has lost.
      const peakMoment = w.lateralCapacityN * PNEUMATIC_TRAIL_M * w.alignPeakShape;
      if (w.alignSlip > w.alignPeakZ && peakMoment > 0) {
        lightness += w.loadN * clamp(1 - Math.abs(w.kingpinMomentNm) / peakMoment, 0, 1);
      }
      load += w.loadN;
      capacity += w.lateralCapacityN;
      staticLoad += w.staticLoadN;
    }
    this.steerLightnessValue = load > 0 ? lightness / load : 0;
    const centre = load > 0 ? travel / load : this.steerAngle;
    // How far the rear axle's side slip is past its own peak (σy = 1), 0..1: by twice
    // the peak angle the tail is gone.
    const tailOut = rearLoad > 0 ? clamp(rearSlide / rearLoad - 1, 0, 1) : 0;

    // Positive rack is a left turn and positive input a right one.
    let target: number;
    let handsOff = steer === 0 && input.steerMode !== 'direct';
    if (input.steerMode === 'keys') {
      // KEYBOARD STEERING (vehicletuning.ts): the rim is a position a held key moves,
      // from a slow start up to its full rate, slower the faster the car goes, easing
      // back to centre when let go. The rim is signed like the rack, positive to the
      // left; input is positive right.
      const ratio = STEERING_WHEEL_HALF_LOCK_RAD / lock;
      const rim = this.keysRimRad;
      const key = Math.sign(-steer);
      let want: number;
      let rate: number;
      if (key !== this.keysPressKey) {
        this.keysPressKey = key;
        this.keysPressS = 0;
      } else if (key !== 0) {
        this.keysPressS += dt;
      }
      if (steer === 0) {
        // Both keys down hold the rim; none lets it ease back to centre: a share of what
        // is left each step (KEYS_RETURN_TAU_S), never quicker than KEYS_IN_RATE_RAD_S,
        // and settled once inside KEYS_RETURN_SETTLE_RAD so the hands come off.
        want = input.steerBothHeld ? rim : 0;
        rate = Math.min(KEYS_IN_RATE_RAD_S, (Math.abs(rim) * (1 - Math.exp(-dt / KEYS_RETURN_TAU_S))) / dt);
        if (!input.steerBothHeld && Math.abs(rim) < KEYS_RETURN_SETTLE_RAD) rate = KEYS_IN_RATE_RAD_S;
      } else {
        want = -steer * STEERING_WHEEL_HALF_LOCK_RAD;
        // A press gathers speed (rule 1): KEYS_START_RATE_RAD_S up to the full rate,
        // linearly over KEYS_RAMP_S, all of it falling as KEYS_RATE_REF_MPS / speed.
        const gathered = Math.min(this.keysPressS / KEYS_RAMP_S, 1);
        rate = KEYS_START_RATE_RAD_S + (KEYS_OUT_RATE_RAD_S - KEYS_START_RATE_RAD_S) * gathered;
        const speed = Math.abs(fwd);
        if (speed > KEYS_RATE_REF_MPS) rate *= KEYS_RATE_REF_MPS / speed;
      }
      const reach = rate * dt;
      this.keysRimRad = rim + clamp(want - rim, -reach, reach);
      handsOff = steer === 0 && !input.steerBothHeld && this.keysRimRad === 0;
      target = clamp(this.keysRimRad / ratio, -lock, lock);
    } else {
      this.keysRimRad = 0;
      this.keysPressS = 0;
      this.keysPressKey = 0;
      if (input.steerMode === 'analogAssist') {
        const side = steer > 0 ? -1 : 1;
        const share = Math.abs(steer);
        let reach = share * lock;
        if (load > 0 && fwd > 0) {
          const tyrePeak = (peak / load) * (1 + STEER_ASSIST_SLIP_MARGIN);
          const gripAccel = staticLoad > 0 ? (capacity * GRAVITY) / staticLoad : 0;
          const kinematic = Math.atan((this.wheelbaseM * gripAccel) / (fwd * fwd));
          // A position against the reach, the front tyres' peak past where the front axle
          // is travelling or the kinematic angle of the tightest circle their grip holds,
          // whichever goes further; with the tail out, the turn-side stick gives way to
          // the travel angle (`tailOut`).
          const held = share * Math.max(side * centre + tyrePeak, kinematic);
          const turning = side * rearForce > 0 ? 1 - tailOut : 1;
          reach = turning * held + (1 - turning) * share * side * centre;
        }
        target = side * clamp(reach, -lock, lock);
      } else {
        target = -steer * lock;
      }
    }

    if (handsOff) {
      // No hand on the wheel: the tyres swing toward the travel angle on their own
      // moment, never past it, over the column's damping (`STEER_FREE_TAU_S`).
      const gap = centre - this.steerAngle;
      const swingLimit =
        referenceMoment > 0 ? (Math.abs(moment) / (STEER_FREE_TAU_S * referenceMoment)) * dt : 0;
      this.steerAngle = clamp(this.steerAngle + clamp(gap, -swingLimit, swingLimit), -lock, lock);
      return;
    }
    const maxDelta = this.handling.steerRackSpeed * dt;
    this.steerAngle = clamp(this.steerAngle + clamp(target - this.steerAngle, -maxDelta, maxDelta), -lock, lock);
  }

  /**
   * The steering angle a wheel actually presents to the road: the rack's angle shared
   * out by the Ackermann geometry, the worn front end's bump disturbance, the static toe
   * and the roll steer. The rear wheels get the last two. `steerAngle` stays the rack's
   * — the bicycle-model angle of the axle's centreline, which is what `steerLock`, the
   * HUD and the autopilot's inverse are written in.
   */
  private wheelSteerAngle(w: WheelVisual): number {
    const roll = w.isFront ? this.frontRollRad : this.rearRollRad;
    const geometry = w.toeRad + w.rollSteer * roll;
    if (!w.isFront) return geometry;
    return this.ackermannAngle(w) + w.sideSign * this.bumpSteerAngle + geometry;
  }

  /**
   * ACKERMANN. Rolling without scrub needs both front wheels square to one centre on the
   * rear axle's line, at `R = L / tan δ` for the rack's centreline angle δ, so the inner
   * wheel turns to `atan(L / (R − t/2))` and the outer only to `atan(L / (R + t/2))`.
   * The trapezoid delivers `ackermann` of that difference and the rest is parallel. The
   * two straddle δ, so the car's centreline turns on the same circle as before and the
   * factory turning circles `steerLock` was cut to stand; what goes is the inner tyre
   * dragged sideways at full lock and the outer one under-steered beside it.
   */
  private ackermannAngle(w: WheelVisual): number {
    const delta = this.steerAngle;
    if (this.ackermann === 0 || delta === 0) return delta;
    const L = this.wheelbaseM;
    const tanDelta = Math.tan(Math.abs(delta));
    // Steering toward +X puts the turn centre on the +X side: that wheel is the inner.
    const halfTrack = (w.sideSign * delta > 0 ? -0.5 : 0.5) * w.axleTrackM;
    const ideal = Math.atan2(L * tanDelta, L + halfTrack * tanDelta);
    return Math.sign(delta) * (Math.abs(delta) + this.ackermann * (ideal - Math.abs(delta)));
  }

  /**
   * Each axle's roll against the road: the difference in suspension travel across it
   * over its track, positive with the +X side compressed (the body leaning toward +X).
   * Read from last step's travel, which is the geometry the wheels are standing in
   * now. It drives the roll steer and the roll camber, so it is the RELATIVE angle the
   * links see — a beam axle's own tilt on a cambered road is not in it.
   */
  private updateAxleRoll(): void {
    this.frontRollRad = this.axleRoll(true);
    this.rearRollRad = this.axleRoll(false);
  }

  private axleRoll(front: boolean): number {
    let plus = 0;
    let plusCount = 0;
    let minus = 0;
    let minusCount = 0;
    let track = 0;
    for (const w of this.wheels) {
      if (w.isFront !== front) continue;
      track = w.axleTrackM;
      if (w.sideSign > 0) {
        plus += w.compressionM;
        plusCount++;
      } else {
        minus += w.compressionM;
        minusCount++;
      }
    }
    if (plusCount === 0 || minusCount === 0 || track <= 0) return 0;
    return clamp(
      (plus / plusCount - minus / minusCount) / track,
      -AXLE_ROLL_LIMIT_RAD,
      AXLE_ROLL_LIMIT_RAD,
    );
  }

  /**
   * Lets the road talk through the worn front end. A CHANGE in the load difference
   * across the front axle means one wheel has climbed or dropped relative to the other.
   * The disturbance is stronger on rough surfaces and at speed, where a small toe change
   * becomes a visible lateral lurch. It is filtered in time, not replaced with random
   * steering, so the same pothole produces the same correction and a smooth road stays
   * calm. The sustained difference of a steady bend is subtracted: that is roll, and the
   * kinematic roll steer already answers it (BUMP_STEER_SUSTAINED_TAU).
   */
  private updateBumpSteer(dt: number, speedKmh: number): void {
    let leftLoad = 0;
    let rightLoad = 0;
    let roughness = 0;
    let roughWheels = 0;
    for (const w of this.wheels) {
      if (!w.isFront) continue;
      if (w.sideSign < 0) leftLoad += w.loadN;
      else rightLoad += w.loadN;
      if (w.grounded) {
        roughness += SURFACES[w.groundSurface].roughness;
        roughWheels++;
      }
    }

    let target = 0;
    if (roughWheels > 0) {
      const staticWheelLoadN = Math.max(1, (this.statsValue.mass * GRAVITY) / this.wheels.length);
      const loadImbalance = clamp((rightLoad - leftLoad) / staticWheelLoadN, -1, 1);
      this.sustainedImbalance +=
        (loadImbalance - this.sustainedImbalance) * (1 - Math.exp(-dt / BUMP_STEER_SUSTAINED_TAU));
      const roughFactor = clamp(
        roughness / roughWheels / BUMP_STEER_FULL_ROUGHNESS,
        0.25,
        1.4,
      );
      const speedFactor = clamp((speedKmh - 12) / 73, 0, 1);
      target =
        (loadImbalance - this.sustainedImbalance) * this.handling.bumpSteer * roughFactor * speedFactor;
    }
    const blend = 1 - Math.exp(-dt / BUMP_STEER_TAU);
    this.bumpSteerAngle += (target - this.bumpSteerAngle) * blend;
  }

  /**
   * THE BODY IN THE AIR. Every force here is taken from the air's velocity relative to
   * the car: the weather's wind where this car is (`windAt`, gusts and all) minus the
   * car's own velocity, resolved on the body's axes — u_F along it (negative driving
   * into still air), u_R across it. q = ½ρ(u_F² + u_R²).
   *
   *   drag      ½ρ·CdA·|u|·u_F along the body, acting at the aerodynamic centre's
   *             height (AERO_CENTRE_HEIGHT_FRACTION). The step above applied the
   *             still-air drag at the centre of mass; the difference — the wind's
   *             share and the drag's pitching moment about the centre of mass — is
   *             added here.
   *   lift      q·A·CLf at the front axle and q·A·CLr at the rear, along body-up, so
   *             speed unloads the springs and the tyres (load sensitivity reads the
   *             lighter axle). The catalogue's split is the wind tunnel's, which holds
   *             the car at the road and so already contains the drag's moment about
   *             it; since the drag acts at its own height here, that moment is taken
   *             back out of the split (`pitchShare`), or it would be counted twice.
   *   side      ½ρ·A·dCY/dβ·|u_F|·u_R, the small-yaw side force (q·A·CY at yaw β,
   *             since |u_F|·u_R = |u|²·sinβ·cosβ), acting `sideCentreAheadM` ahead of
   *             the wheelbase's midpoint: a crosswind turns the nose downwind and
   *             asks for a steady correction, as on every real car. Plus the flank's
   *             crossflow drag ½ρ·CROSSFLOW_CD·side box·|u_R|·u_R at the box's middle,
   *             which is second order at road speed and the whole of it broadside.
   *             Both act at the aerodynamic centre's height, so a crosswind also
   *             leans the body. The force is bounded by the physics, not a cap: the
   *             strongest wind the weather makes is a haboob's gusts.
   *
   * Only with a wheel on the ground: an airborne car turned by a gust would only ever
   * read as a physics bug, and the vertical terms matter only on the springs.
   */
  private applyAero(dt: number, contactCount: number): void {
    if (contactCount === 0) return;
    const body = this.chassisBody;
    body.linvel(this.linvel);
    const origin = body.translation(this.aeroOrigin);
    windAt(origin.x + this.origin.x, origin.z + this.origin.z, this.windScratch);
    const ux = this.windScratch.x - this.linvel.x;
    const uy = -this.linvel.y;
    const uz = this.windScratch.z - this.linvel.z;
    const rotation = body.rotation(this.rotationScratch);
    const fwd = this.aeroForward;
    const right = this.aeroRight;
    const up = this.aeroUp;
    rotateVector(fwd, rotation, 0, 0, 1);
    rotateVector(right, rotation, 1, 0, 0);
    rotateVector(up, rotation, 0, 1, 0);
    const uF = ux * fwd.x + uy * fwd.y + uz * fwd.z;
    const uR = ux * right.x + uy * right.y + uz * right.z;
    const airSq = uF * uF + uR * uR;
    if (airSq < 1) return;
    const air = Math.sqrt(airSq);
    const mass = body.mass();

    const drag = this.dragCoeff * air * uF;
    const slender = this.sideSlopeCoeff * Math.abs(uF) * uR;
    const side = slender + this.crossflowCoeff * Math.abs(uR) * uR;
    const axles = this.axleGeometry;
    const wheelbase = axles.frontZ - axles.rearZ;
    const roadY = -this.measure.halfExtents[1] - this.model.factory.clearance;
    const pitchShare = (drag * (this.aeroCentreY - roadY)) / wheelbase;
    const liftFront = this.liftFrontCoeff * airSq + pitchShare;
    const liftRear = this.liftRearCoeff * airSq - pitchShare;

    // Drag: what the still-air drag at the centre of mass left out, then its height.
    const hSpeed = Math.hypot(this.linvel.x, this.linvel.z);
    const impulse = this.forceScratch;
    impulse.x = (drag * fwd.x + this.dragCoeff * hSpeed * this.linvel.x) * dt;
    impulse.y = drag * fwd.y * dt;
    impulse.z = (drag * fwd.z + this.dragCoeff * hSpeed * this.linvel.z) * dt;
    let delivered = Math.hypot(impulse.x, impulse.y, impulse.z);
    body.applyImpulse(impulse, false);
    const comY = roadY + this.rollLeverArm;
    rotateVector(impulse, rotation, (this.aeroCentreY - comY) * drag * dt, 0, 0);
    body.applyTorqueImpulse(impulse, false);

    // Side force, at the two terms' combined centre.
    if (side !== 0) {
      const ahead = (axles.frontZ + axles.rearZ) / 2 - Math.sign(uF) * this.sideCentreAheadM;
      this.applyAeroAt(this.aeroCentreY, (slender / side) * ahead, right, side * dt);
      delivered += Math.abs(side) * dt;
    }
    // Lift, at each axle.
    this.applyAeroAt(0, axles.frontZ, up, liftFront * dt);
    this.applyAeroAt(0, axles.rearZ, up, liftRear * dt);
    delivered += (Math.abs(liftFront) + Math.abs(liftRear)) * dt;
    // The air's push is the car's own, not a blow (see `ownDragRollingDeltaMps`).
    this.ownDragRollingDeltaMps += delivered / mass;
  }

  /** Impulse `amount` along world `axis` at body-local (0, y, z); `aeroOrigin` must be current. */
  private applyAeroAt(y: number, z: number, axis: Vec3, amount: number): void {
    const point = this.aeroPoint;
    rotateVector(point, this.rotationScratch, 0, y, z);
    point.x += this.aeroOrigin.x;
    point.y += this.aeroOrigin.y;
    point.z += this.aeroOrigin.z;
    this.forceScratch.x = axis.x * amount;
    this.forceScratch.y = axis.y * amount;
    this.forceScratch.z = axis.z * amount;
    this.chassisBody.applyImpulseAtPoint(this.forceScratch, point, false);
  }

  /**
   * LIMITED-SLIP DIFFERENTIALS, where the model has one (`frontDiff` / `rearDiff`).
   *
   * An open differential is what the rest of this file already is: each driven wheel
   * gets an equal share of the torque, and a wheel that breaks loose spins up on its
   * own while the other keeps what it had. A limited-slip one resists the two wheels of
   * its axle turning at different speeds, and in resisting it moves torque from the
   * faster wheel to the slower: the unloaded inside wheel stops flaring on the way out
   * of a bend and the loaded outside one pushes, which is the whole of what one does.
   *
   * The resisting torque is capped by the unit's own ability (preload plus lock times
   * the torque through it), and by what would bring the two wheels to one speed within
   * this step with nothing else acting — a friction coupling slows slipping, it never
   * reverses it. Half of that, because the tyres are acting too and the full figure
   * would overshoot into the next step's opposite correction.
   */
  private applyDifferentials(dt: number, drivelineInertia: number): void {
    for (let axle = 0; axle < 2; axle++) {
      const front = axle === 0;
      const diff = front ? this.model.frontDiff : this.model.rearDiff;
      if (!diff || (front ? this.frontDrivenCount : this.rearDrivenCount) === 0) continue;
      let left: WheelVisual | null = null;
      let right: WheelVisual | null = null;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        if (w.sideSign < 0) left = w;
        else right = w;
      }
      if (!left || !right) continue;
      const cap = diff.preloadNm + diff.lock * Math.abs(left.driveTorqueNm + right.driveTorqueNm);
      const slip = left.spinRadS - right.spinRadS;
      if (cap <= 0 || slip === 0) continue;
      const radius = 0.5 * (left.radius + right.radius);
      const wheelMass = WHEEL_MASS_KG * (radius / WHEEL_REFERENCE_RADIUS) ** 2;
      const inertia = 0.5 * wheelMass * radius * radius + drivelineInertia;
      const sync = (Math.abs(slip) * inertia) / (2 * dt);
      const transfer = Math.sign(slip) * Math.min(cap, 0.5 * sync);
      left.driveTorqueNm -= transfer;
      right.driveTorqueNm += transfer;
    }
  }

  /**
   * A BEAM AXLE'S CAMBER (`beamLeanRad`). Both wheels are square to the one axle, so
   * each leans against the ground under it by exactly the angle between the axle and
   * that ground — not by any share of the body's roll.
   *
   * The axle runs hub to hub. In the body's frame each hub is its mount less its
   * suspension length; taken into the world, the line is compared with each grounded
   * wheel's contact normal. On any plane, cambered or not and however the body leans
   * on its springs, the hub-to-hub line is parallel to the road and both leans are
   * zero, which is what a beam's roll camber of 0 always stood for. Put one wheel on a
   * kerb, a rut's edge or the shoulder's drop and the axle tilts: BOTH wheels lean, by
   * its tilt against their own ground, and the wheel that did not move is cambered by
   * the one that did.
   *
   * Below the collider the ground has no normal, only a height under each patch
   * (`profileHeight`), and the swell in it is metres long: the patches ride it and the
   * road under them tilts with it. So there the axle is measured against the line
   * between the two patches, which leaves each hub's hop less the ground it stands on —
   * its tyre's deflection. A hummock under one wheel tilts axle and road together and
   * cambers nothing; the axle's tramp against its tyres does.
   *
   * Read off this step's contacts and profile and last step's hop, before any tyre is
   * resolved. A wheel in the air has no ground to lean against and keeps its static
   * camber alone.
   */
  private updateBeamLean(): void {
    for (const [minus, plus] of this.beamAxles) {
      minus.beamLeanRad = 0;
      plus.beamLeanRad = 0;
      const mountMinus = minus.tyre.mountLocal;
      const mountPlus = plus.tyre.mountLocal;
      const hubMinusY = mountMinus.y - minus.tyre.lengthM + (minus.hopZ - minus.profileHeight);
      const hubPlusY = mountPlus.y - plus.tyre.lengthM + (plus.hopZ - plus.profileHeight);
      const axis = this.beamAxis;
      rotateVector(
        axis,
        this.rotationScratch,
        mountPlus.x - mountMinus.x,
        hubPlusY - hubMinusY,
        mountPlus.z - mountMinus.z,
      );
      const length = Math.hypot(axis.x, axis.y, axis.z);
      if (!(length > 0)) continue;
      for (let end = 0; end < 2; end++) {
        const w = end === 0 ? minus : plus;
        if (!w.tyre.inContact) continue;
        const n = w.tyre.normal;
        // The axle rising toward +X against this ground tips the wheel's top toward −X.
        // Read no further than the independent axles' geometry is (`AXLE_ROLL_LIMIT_RAD`):
        // past it the tyre is landing or on its sidewall, and the camber terms are
        // measured for a few degrees.
        const rise = (axis.x * n.x + axis.y * n.y + axis.z * n.z) / length;
        w.beamLeanRad = clamp(-Math.asin(clamp(rise, -1, 1)), -AXLE_ROLL_LIMIT_RAD, AXLE_ROLL_LIMIT_RAD);
      }
    }
  }

  /**
   * THE BEAM AXLE'S UNSPRUNG BODY: the wheel-hop state of a beam's two wheels (see the
   * road-through-the-tyre block in the wheel pass), stepped as the one rigid axle they
   * are bolted to rather than as two quarter-cars.
   *
   * The axle heaves and rolls. Written in the two wheels' own displacements `z_−, z_+`
   * (the hub heights `hopZ`, rigidly tied: the axle's heave is their mean and its roll
   * their difference over the track), its mass `m` — the two corners' unsprung mass —
   * and roll inertia `ρ² m (t/2)²` (`BEAM_AXLE_GYRATION_SQ`) give the mass matrix
   *
   *   M = m/2 · [1 + ρ²   1 − ρ²]
   *             [1 − ρ²   1 + ρ²]
   *
   * and the springs, which sit at the spring seats `s` apart rather than at the wheels,
   * give `K_s = k/2 · [1 + σ², 1 − σ²; 1 − σ², 1 + σ²]` with `σ² = (s/t)²`. That is the
   * figure the axle's bar already carries (`SuspensionTuning.rearBar`: a leaf-sprung
   * beam's negative bar IS `(s/t)² − 1`, and any real bar on a beam adds to it), so the
   * axle rolls on its springs here with the stiffness the body rolls on them above. The
   * tyres (`tyreRateN`, carcass damping) act at each wheel, as do the dampers, which
   * the body layer has at the wheels too.
   *
   * In HEAVE — both wheels driven alike — the rows sum to `m` and `k`, and the axle is
   * exactly the two quarter-cars it replaced: the ride on a straight swell, the hop
   * frequency and every flat-road figure are untouched. Only the DIFFERENCE between the
   * wheels sees the beam: a ripple under one wheel moves the other one, at once
   * through the axle's mass (a centre-heavy axle pivots inside the far wheel, pressing
   * it down) and then through its roll mode, and the body is pushed at both seats.
   *
   * The same semi-implicit step as the quarter-car, with the 2×2 system solved
   * outright: `(M + dt C + dt² K) v' = M v + dt (f − K z)` is symmetric positive
   * definite for any ρ², σ² > 0, so it is unconditionally stable. A pair with one wheel
   * in the air is not stepped here (`beamAxleDown`): the grounded end rides alone and
   * the airborne one relaxes, as on an independent axle.
   */
  private stepBeamAxleHop(dt: number): void {
    const gyrationSq = BEAM_AXLE_GYRATION_SQ;
    for (const [a, b] of this.beamAxles) {
      if (!beamAxleDown(a, b)) continue;
      const massA = unsprungMass(a.radius);
      const massB = unsprungMass(b.radius);
      const mass = 0.5 * (massA + massB);
      const massSelf = 0.5 * mass * (1 + gyrationSq);
      const massCross = 0.5 * mass * (1 - gyrationSq);
      const spacingSq = Math.max(0, 1 + a.barFraction);
      const spring = 0.5 * (a.springRateNPerM + b.springRateNPerM);
      const springSelf = 0.5 * spring * (1 + spacingSq);
      const springCross = 0.5 * spring * (1 - spacingSq);
      const damperA = a.hopV > 0 ? a.compressionRateNsPerM : a.relaxationRateNsPerM;
      const damperB = b.hopV > 0 ? b.compressionRateNsPerM : b.relaxationRateNsPerM;
      const tyreDampA = 2 * TYRE_DAMPING_RATIO * Math.sqrt(a.tyreRateN * massA);
      const tyreDampB = 2 * TYRE_DAMPING_RATIO * Math.sqrt(b.tyreRateN * massB);
      const stiffA = springSelf + a.tyreRateN;
      const stiffB = springSelf + b.tyreRateN;

      const s11 = massSelf + dt * (damperA + tyreDampA) + dt * dt * stiffA;
      const s22 = massSelf + dt * (damperB + tyreDampB) + dt * dt * stiffB;
      const s12 = massCross + dt * dt * springCross;
      const r1 =
        massSelf * a.hopV +
        massCross * b.hopV +
        dt * (a.tyreRateN * a.profileHeight + tyreDampA * a.profileRate - stiffA * a.hopZ - springCross * b.hopZ);
      const r2 =
        massCross * a.hopV +
        massSelf * b.hopV +
        dt * (b.tyreRateN * b.profileHeight + tyreDampB * b.profileRate - springCross * a.hopZ - stiffB * b.hopZ);
      const det = s11 * s22 - s12 * s12;
      a.hopV = (r1 * s22 - s12 * r2) / det;
      b.hopV = (s11 * r2 - s12 * r1) / det;
      a.hopZ += a.hopV * dt;
      b.hopZ += b.hopV * dt;

      // What each seat and damper hands the body, at that wheel's patch, bounded as the
      // quarter-car's is: the road can unload a tyre but never pull the car down.
      for (let end = 0; end < 2; end++) {
        const w = end === 0 ? a : b;
        let bodyForce =
          end === 0
            ? springSelf * a.hopZ + springCross * b.hopZ + damperA * a.hopV
            : springCross * a.hopZ + springSelf * b.hopZ + damperB * b.hopV;
        if (bodyForce < -w.loadN) bodyForce = -w.loadN;
        if (bodyForce !== 0) {
          rotateVector(this.microUp, this.rotationScratch, 0, bodyForce * dt, 0);
          this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
        }
      }
    }
  }

  /**
   * The anti-roll bars, and every other roll stiffness an axle has beyond its ride
   * springs (`barFraction`, from `SuspensionTuning.frontBar`/`rearBar`).
   *
   * A bar is a torsion spring between the two wheels of one axle, so it is loaded by
   * their DIFFERENCE in travel and by nothing else: it adds roll stiffness without
   * adding ride stiffness, which is exactly what a soft-sprung car needs to corner
   * without running its outer springs into the bump stops. A negative fraction is the
   * opposite case, a beam axle whose leaves sit inboard of its wheels and so resist
   * roll less than their ride rate says.
   *
   * Implemented as the pair of equal and opposite vertical forces the real bar applies
   * at the two wheels, so nothing about it is a torque fudge: the more compressed side
   * is pushed down and the other pulled up, at the contact points, and the moment that
   * results is the bar's own. It carries no damping, because a bar has none worth
   * modelling: roll is damped by the dampers alone.
   *
   * Sized in `resolveTravel` from this step's travel, and pushed in here, after the
   * tyres have read their patches.
   */
  private applyAntiRollBars(dt: number): void {
    for (const w of this.wheels) {
      if (w.barN === 0) continue;
      rotateVector(this.microUp, this.rotationScratch, 0, w.barN * dt, 0);
      this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
    }
  }

  /**
   * This step's travel and the forces besides the spring's that hang off it: the bump
   * stop, the damper's bleed and the anti-roll bars. Run straight after the contacts,
   * so the load each tyre is handed (`loadN`) is all of THIS step's; their impulses go
   * in with the tyres' (`updateWheelDynamics`, `applyAntiRollBars`).
   */
  private resolveTravel(dt: number): void {
    for (const w of this.wheels) {
      const inContact = w.tyre.inContact;
      const previousCompressionM = w.compressionM;
      w.compressionM = w.restLengthM - w.tyre.lengthM;
      // The jolt the audio hears: compression speed while the tyre stayed on the
      // ground. A landing is the other channel's; the first contact after air is not
      // a bump, and neither is the settle from the zero a fresh wheel starts at.
      if (inContact && previousCompressionM > 0 && dt > 0) {
        const joltMps = (w.compressionM - previousCompressionM) / dt;
        if (joltMps > this.audioState.bumpMps) this.audioState.bumpMps = joltMps;
      }

      // BUMP STOP. The travel limit is a rigid clamp; a real stop is rubber that starts
      // taking load before the end and stiffens as it crushes (see BUMP_STOP_FRACTION).
      // Without it the soft springs this car now runs would hand every big hit to the
      // solver as a step.
      //
      // The stop lives in the BUMP travel — the compression available past the stance
      // the geometry was cut for — and not in the total. Measured against the total it
      // sat below the sag of every soft car in the catalogue, so a parked Zhiguli
      // rested on its bump stops and rang at 1.76 Hz instead of the 1.10 its springs
      // were cut for.
      //
      // Anchored on the KERB stance, like the travel it lives in: the rubber is bolted
      // to the car and does not move because the boot is full. A loaded car settles
      // further into the same stop, which is what "riding on the stops" means — and
      // anchoring it on the load's own sag instead (as this did) pushed the knee past
      // the end of the travel for any load that sagged more than 40% of the bump
      // travel, so the stop never engaged at all and every big hit went to the rigid
      // clamp instead.
      const stopBegins = w.designSagM + w.bumpTravelM * (1 - BUMP_STOP_FRACTION);
      w.bumpStopN = 0;
      if (inContact && w.compressionM > stopBegins) {
        const into = Math.min(1, (w.compressionM - stopBegins) / (w.maxTravelM - stopBegins));
        w.bumpStopN = w.bumpStopPeakN * into * into;
      }

      // THE DAMPER'S BLEED (see DAMPER_BLEED_GAIN): below the knee the damper is
      // `gain` times its valve-stack rate, and the contact has already applied the
      // valve stack's. Read off the same compression the bump stop uses, so it is this
      // step's piston speed.
      w.bleedN = 0;
      if (inContact && dt > 0) {
        const pistonMps = (w.compressionM - previousCompressionM) / dt;
        const rate = pistonMps > 0 ? w.compressionRateNsPerM : w.relaxationRateNsPerM;
        w.bleedN =
          (DAMPER_BLEED_GAIN - 1) *
          rate *
          clamp(pistonMps, -DAMPER_BLEED_KNEE_MPS, DAMPER_BLEED_KNEE_MPS);
      }
      w.barN = 0;
    }

    // THE BARS. An axle with a wheel in the air contributes nothing — a bar needs both
    // ends on the ground to have a difference worth resisting.
    for (let axle = 0; axle < 2; axle++) {
      const front = axle === 0;
      let leftSum = 0;
      let rightSum = 0;
      let leftCount = 0;
      let rightCount = 0;
      let groundedBoth = true;
      let rate = 0;
      let fraction = 0;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        if (!w.tyre.inContact) groundedBoth = false;
        if (w.sideSign < 0) {
          leftSum += w.compressionM;
          leftCount++;
        } else {
          rightSum += w.compressionM;
          rightCount++;
        }
        // The bar is sized against its own axle's wheel rate, in N/m.
        rate = w.springRateNPerM;
        fraction = w.barFraction;
      }
      if (fraction === 0 || !groundedBoth || leftCount === 0 || rightCount === 0) continue;
      const leftMean = leftSum / leftCount;
      const rightMean = rightSum / rightCount;
      if (leftMean === rightMean) continue;

      // Each wheel is pushed by the bar in proportion to how much MORE compressed its
      // own side is than the other. The two are equal and opposite by construction, so
      // a bar can never lift or drop the car — only untwist it. Written this way rather
      // than from `sideSign` because the force follows the measured travel, and no
      // left/right convention can get it backwards.
      const gain = fraction * rate * 0.5;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        const own = w.sideSign < 0 ? leftMean : rightMean;
        const other = w.sideSign < 0 ? rightMean : leftMean;
        // Up on the compressed side: that is the bar unloading the outer spring.
        w.barN = gain * (own - other);
      }
    }
  }

  /**
   * The GEOMETRIC half of each axle's lateral load transfer (see `linkN`).
   *
   * The side force reaches the body at the roll centre, so the body only feels — and
   * the springs and bars only carry — the moment of it ABOVE the roll axis. The rest,
   * the axle's side force times the roll centre's height over its track, the links take
   * straight from the tyres to the road: the outer tyre is loaded by it and the inner
   * unloaded, and the body never rolls for it. Summed per axle rather than per wheel, so
   * an axle whose outer tyre is doing most of the work does not jack the body up on top
   * of it: a live axle on a Panhard rod does not, and the strut and wishbone axles here
   * have roll centres too low for it to matter.
   *
   * Sign: a side force towards body +X loads the wheels on the −X side.
   */
  private resolveLinkTransfer(): void {
    for (let axle = 0; axle < 2; axle++) {
      const front = axle === 0;
      let force = 0;
      let leftCount = 0;
      let rightCount = 0;
      let perNewton = 0;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        force += w.sideForceBodyXN;
        if (w.sideSign < 0) leftCount++;
        else rightCount++;
        perNewton = w.axleTrackM > 0 ? w.rollCentreM / w.axleTrackM : 0;
      }
      const ok = leftCount > 0 && rightCount > 0;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        w.linkN = ok
          ? (-w.sideSign * force * perNewton) / (w.sideSign < 0 ? leftCount : rightCount)
          : 0;
      }
    }
  }

  /**
   * Takes back the share of the longitudinal pitch couple that real suspension
   * geometry would carry through the links (see ANTI_SQUAT_FRACTION).
   *
   * The couple exists because the tyre force is applied at the CONTACT PATCH while the
   * centre of mass is `rollLeverArm` above it: a forward force of F therefore makes a
   * nose-up moment of F times that arm, and Rapier applies every newton of it to the
   * springs because it has no wishbones to react any of it. Removing a fixed fraction
   * is the whole model — it is what an anti-squat percentage MEANS, so there is nothing
   * to tune beyond the two fractions.
   *
   * Sign: forward is body +Z and the contact patch is below the centre of mass, so a
   * driving force gives a NEGATIVE moment about body +X (nose up). The correction is
   * therefore positive about +X under power and negative under braking, which falls out
   * of the sign of the force without a branch — only the FRACTION differs by direction,
   * because a car has more anti-squat available at the back than anti-dive at the front.
   *
   * Skipped with nothing on the ground: an airborne car has no contact patch for the
   * couple to have come from, so there is none to take back.
   */
  private applyAntiPitch(dt: number, contactCount: number): void {
    if (contactCount === 0 || this.longitudinalForceSum === 0) return;
    const fraction =
      this.longitudinalForceSum >= 0 ? ANTI_SQUAT_FRACTION : ANTI_DIVE_FRACTION;
    const torque = this.longitudinalForceSum * this.rollLeverArm * fraction * dt;
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.forceScratch, this.rotationScratch, torque, 0, 0);
    this.chassisBody.applyTorqueImpulse(this.forceScratch, true);
  }

  /**
   * The axle geometry and weight distribution, measured once from the model.
   *
   * Front is +Z (the body's forward axis), so `frontZ` is the mean mount Z of
   * the front wheels and `rearZ` the rear's. Multi-axle vehicles (the six-wheel
   * semi, the twelve-wheel loader) collapse to two groups, which is what `isFront`
   * already means everywhere else in this file.
   */
  private measureAxles(): AxleGeometry {
    let frontZ = 0;
    let rearZ = 0;
    let frontCount = 0;
    let rearCount = 0;
    for (const wheel of this.measure.wheels) {
      if (wheel.isFront) {
        frontZ += wheel.pos[2];
        frontCount++;
      } else {
        rearZ += wheel.pos[2];
        rearCount++;
      }
    }
    frontZ = frontCount > 0 ? frontZ / frontCount : this.measure.halfExtents[2];
    rearZ = rearCount > 0 ? rearZ / rearCount : -this.measure.halfExtents[2];
    return {
      frontZ,
      rearZ,
      frontCount: Math.max(1, frontCount),
      rearCount: Math.max(1, rearCount),
      frontWeightShare: frontWeightFraction(this.model),
    };
  }

  /**
   * Where the loads that are not the kerb body sit, cut once from the measured
   * geometry. See the `LOAD_*` block in vehicletuning.ts for what each anchor is and
   * why it is derived rather than authored.
   *
   * The two axle lines and the length of the tail behind the rear one are the only
   * inputs beyond the box itself, which is what lets one rule span the catalogue: a
   * 3.2 m Oka's hold is 0.48 m of tail and a 4.5 m flatbed's bed is 0.93 m, and both
   * come out of the same three numbers.
   */
  private measureLoadAnchors(): LoadAnchors {
    const half = this.measure.halfExtents;
    const axles = this.axleGeometry;
    const wheelbase = Math.max(0.5, axles.frontZ - axles.rearZ);
    // One floor pan for the cabin, the boot and a truck's bed: a fraction of the way
    // up the measured box, which is the only floor line the geometry has.
    const floorY = -half[1] + LOAD_FLOOR_FRACTION * 2 * half[1];
    // How much car there is behind the rear axle line: exactly the region a boot or a
    // bed occupies, measured rather than assumed, so a short hatch and a long saloon
    // both put their cargo where they can actually carry it.
    const tail = Math.max(0, half[2] + axles.rearZ);
    const holdBehind = this.model.bodyClass === 'car'
      ? LOAD_BOOT_BEHIND_REAR_AXLE
      : LOAD_BED_BEHIND_REAR_AXLE;
    return {
      tank: {
        y: floorY - LOAD_TANK_BELOW_FLOOR,
        z: axles.rearZ + LOAD_TANK_AHEAD_OF_REAR_AXLE * wheelbase,
      },
      engine: {
        y: floorY + LOAD_ENGINE_ABOVE_FLOOR,
        z: axles.frontZ,
      },
      hold: {
        y: floorY + LOAD_CARGO_HALF_HEIGHT,
        z: axles.rearZ - holdBehind * tail,
      },
      seat: {
        y: floorY + LOAD_SEAT_ABOVE_FLOOR,
        z: axles.frontZ - LOAD_SEAT_BEHIND_FRONT_AXLE * wheelbase,
      },
    };
  }

  /**
   * Puts the car's mass where it actually is: the kerb car summed from its parts, plus
   * every load since as a point mass at its own anchor.
   *
   * The kerb car is its components (the chassis-mass block in vehicletuning.ts): an
   * unsprung mass at each wheel centre, the engine and gearbox from the part registry
   * laid out by the drive, the full tank's fuel, and the body — a thin shell over the
   * measured box plus the fittings between the axles — whose centroid is solved so the
   * whole kerb car's centre of mass sits at the catalogue's weight split and
   * `COM_DROP_FRACTION`'s height. Every part carries its own small inertia and `m·d²`
   * about the combined centre: the parallel-axis theorem, which is also the whole of what
   * a load changes. A crate behind the rear axle lengthens the yaw lever, and it is the
   * yaw lever that decides how quickly the back steps out. Player and autopilot drive the
   * same tensor.
   *
   * A stock car at a full tank has NO loads: all six terms are deltas from the state
   * `model.mass` already describes, so the combined centre of mass and every static load
   * come out exactly at the catalogue's figures.
   */
  private applyChassisMass(stats: VehicleStats): void {
    const half = this.measure.halfExtents;
    const hx = half[0];
    const hy = half[1];
    const hz = half[2];
    // WHERE THE KERB CAR'S CENTRE OF MASS IS. A front weight fraction f puts it f of the
    // way from the rear axle to the front one, which is the definition of the fraction
    // and the only placement that makes the axle loads come out at f and 1-f. Front-drive
    // cars therefore genuinely carry their nose, and the static loads every grip
    // calculation is referenced against are the real ones.
    const axles = this.axleGeometry;
    const kerbZ = axles.rearZ + axles.frontWeightShare * (axles.frontZ - axles.rearZ);
    const kerbY = -COM_DROP_FRACTION * hy;
    let kerbMass = stats.mass;
    for (const load of stats.loads) kerbMass -= load.massKg;

    // Every mass goes into one sum: its own inertia about its own centre, and its first
    // and second moments about the chassis origin. The move to the combined centre of
    // mass is taken once at the end (the parallel-axis theorem over the whole sum).
    // Products of inertia are left out: every part is on the centreline or mirrored
    // across it, and the body's principal axes are the chassis' as they always were.
    let sumMass = 0;
    let firstX = 0;
    let firstY = 0;
    let firstZ = 0;
    let secondX = 0;
    let secondY = 0;
    let secondZ = 0;
    let ownX = 0;
    let ownY = 0;
    let ownZ = 0;
    const add = (m: number, x: number, y: number, z: number, ix: number, iy: number, iz: number): void => {
      sumMass += m;
      firstX += m * x;
      firstY += m * y;
      firstZ += m * z;
      secondX += m * x * x;
      secondY += m * y * y;
      secondZ += m * z * z;
      ownX += ix;
      ownY += iy;
      ownZ += iz;
    };
    /** A solid box of full sizes lx, ly, lz along the chassis axes. */
    const addBox = (m: number, y: number, z: number, lx: number, ly: number, lz: number): void => {
      add(m, 0, y, z, (m * (ly * ly + lz * lz)) / 12, (m * (lx * lx + lz * lz)) / 12, (m * (lx * lx + ly * ly)) / 12);
    };

    // Unsprung, at each wheel centre: a disc of the wheel's radius about its axle.
    let halfTrack = 0;
    let crankY = 0;
    let frontWheels = 0;
    for (const w of this.measure.wheels) {
      const m = unsprungMass(w.radius);
      const r2 = w.radius * w.radius;
      add(m, w.pos[0], w.pos[1], w.pos[2], 0.5 * m * r2, 0.25 * m * r2, 0.25 * m * r2);
      halfTrack += Math.abs(w.pos[0]) / this.measure.wheels.length;
      if (w.isFront) {
        crankY += w.pos[1];
        frontWheels++;
      }
    }
    // The crank runs at the front wheel centres' height.
    crankY /= frontWheels;

    // The powertrain. A car that drives its rear axle has a propshaft, so a longitudinal
    // engine set back behind the front axle, the gearbox bolted on behind it, and on
    // four-wheel drive the transfer box behind that; a front-drive car has a transverse
    // engine just ahead of the front axle and its transaxle on the axle line.
    const engineMass = variant(this.model.engineId).mass;
    const gearboxMass = variant(this.model.gearboxId).mass;
    const engineY = crankY + ENGINE_ABOVE_CRANK_M;
    if (this.model.rearDriveBias > 0) {
      const engineZ = axles.frontZ - LONGITUDINAL_ENGINE_BEHIND_FRONT_AXLE_M;
      const gearboxLength = GEARBOX_LENGTH_M + (this.model.rearDriveBias < 1 ? TRANSFER_BOX_LENGTH_M : 0);
      addBox(engineMass, engineY, engineZ, ENGINE_WIDTH_M, ENGINE_HEIGHT_M, ENGINE_LENGTH_M);
      addBox(
        gearboxMass,
        crankY,
        engineZ - 0.5 * (ENGINE_LENGTH_M + gearboxLength),
        GEARBOX_SECTION_M,
        GEARBOX_SECTION_M,
        gearboxLength,
      );
    } else {
      const engineZ = axles.frontZ + TRANSVERSE_ENGINE_AHEAD_OF_FRONT_AXLE_M;
      addBox(engineMass, engineY, engineZ, ENGINE_LENGTH_M, ENGINE_HEIGHT_M, ENGINE_WIDTH_M);
      addBox(gearboxMass, crankY, axles.frontZ, GEARBOX_LENGTH_M, GEARBOX_SECTION_M, GEARBOX_SECTION_M);
    }

    // A full tank's fuel at the tank: a point, since a liquid does not turn with its tank.
    const tank = this.loadAnchors.tank;
    add(this.model.tankLitres * FUEL_DENSITY, 0, tank.y, tank.z, 0, 0, 0);

    // The body: the shell over the measured box and the fittings between the axles, at
    // the one centroid that puts the whole kerb car's centre of mass on (0, kerbY, kerbZ).
    const shellMass = BODY_SHELL_MASS_FRACTION * kerbMass;
    const bodyMass = kerbMass - sumMass;
    const fittingsMass = bodyMass - shellMass;
    const fittingsHalfZ = 0.5 * (axles.frontZ - axles.rearZ);
    add(
      bodyMass,
      -firstX / bodyMass,
      (kerbMass * kerbY - firstY) / bodyMass,
      (kerbMass * kerbZ - firstZ) / bodyMass,
      thinBoxShellMoment(shellMass, hx, hy, hz) + (fittingsMass / 3) * (hy * hy + fittingsHalfZ * fittingsHalfZ),
      thinBoxShellMoment(shellMass, hy, hz, hx) + (fittingsMass / 3) * (halfTrack * halfTrack + fittingsHalfZ * fittingsHalfZ),
      thinBoxShellMoment(shellMass, hz, hx, hy) + (fittingsMass / 3) * (halfTrack * halfTrack + hy * hy),
    );

    // Every load: a point at its anchor. All are on the centreline, so the combined
    // centre of mass stays on x = 0 by construction rather than by omission.
    for (const load of stats.loads) add(load.massKg, load.x, load.y, load.z, 0, 0, 0);

    const mass = Math.max(1, stats.mass);
    const comX = firstX / sumMass;
    const comY = firstY / sumMass;
    const comZ = firstZ / sumMass;
    // x is pitch, y is yaw, z is roll.
    const spreadX = secondX - sumMass * comX * comX;
    const spreadY = secondY - sumMass * comY * comY;
    const spreadZ = secondZ - sumMass * comZ * comZ;
    const inertia = {
      x: ownX + spreadY + spreadZ,
      y: ownY + spreadX + spreadZ,
      z: ownZ + spreadX + spreadY,
    };

    this.chassisBody.setAdditionalMassProperties(
      mass,
      { x: comX, y: comY, z: comZ },
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
    // Make mass() current immediately: the tyres' parked hold and the solver read it
    // on the next tick.
    this.chassisBody.recomputeMassPropertiesFromColliders();

    // The lever IS this centre of mass' height above the contact plane, so it follows
    // the load: a crate that raises the centre of mass raises it above the roll axis
    // and the pitch couple's arm with it, which is the whole reason a tall load leans.
    const contactY = -hy - this.model.factory.clearance;
    this.rollLeverArm = Math.max(0.1, comY - contactY);
    this.rollInertiaKgM2 = inertia.z;

    // And the parked weight split, which is what the springs are solved against. Taken
    // as the catalogue figure plus the loads' own moment, so a stock car is bit-for-bit
    // the number `frontWeightFraction` returned rather than a round trip through comZ.
    const wheelbase = axles.frontZ - axles.rearZ;
    this.parkedFrontShare =
      wheelbase > 1e-3
        ? clamp(axles.frontWeightShare + (comZ - kerbZ) / wheelbase, 0, 1)
        : axles.frontWeightShare;

    // THE REAR BRAKE REGULATOR'S SETTING (`CarModelDef.rearBrakeValve`). The factory sets
    // it on the kerb car — the VAZ-2108's lever with the car "в снаряженном состоянии",
    // the Zhiguli's with its lever just touching the piston — so it is resolved from the
    // kerb geometry and the design weight split, never from the load. What a load changes
    // is how hard the rear springs then press the lever, which the step reads off them
    // and the planner off `parkedRearSpringRatio`.
    this.parkedRearSpringRatio =
      ((1 - this.parkedFrontShare) * mass) / Math.max(1e-6, (1 - axles.frontWeightShare) * this.model.mass);
    const valve = this.model.rearBrakeValve;
    this.rearValveKerbKnee = Infinity;
    this.rearValveSlope = 1;
    if (valve?.kind === 'bench') {
      this.rearValveKerbKnee = valve.kneePedal;
      this.rearValveSlope = valve.slope;
    } else if (valve?.kind === 'idealKnee' && wheelbase > 1e-3) {
      // The kerb car's IDEAL distribution — both axles at the same share of their load —
      // gives the rear axle `z·(r0 − χ·z)` of the weight at a deceleration of z g (r0 its
      // static share, χ the CoM height over the wheelbase) and the front `z·(f0 + χ·z)`;
      // the fixed split gives the rear `b·z`. The two meet at z_k = (r0 − b)/χ: below it
      // the rear is under-braked, above it over-braked, so that is where the valve must
      // close.
      //
      // The lever reads the rear SPRINGS, and they unload by the transfer the links do not
      // carry, (1 − ANTI_DIVE_FRACTION)·χ·z of the weight, so standing at the kerb it is
      // set to close at `z_k / (B·(1 − u·z_k))` of the pedal (B = `brakeDecelG`, u that
      // unloading over r0), which the tail rising by z_k brings down to exactly z_k/B.
      //
      // The slope past it puts a FLOORED pedal back on the ideal curve: the front's own
      // full-pedal force `(1 − b)·B` is its ideal share at z_f, the root of
      // `χ·z² + f0·z = (1 − b)·B`; the rear's ideal there is `z_f − (1 − b)·B`, a line
      // pressure of p = that over `b·B`, and the knee has dropped to k = x_k·(1 − u·z_f),
      // so the slope is (p − k)/(1 − k). Between the two points the rear runs under the
      // ideal curve, which is concave: the kerb car's fronts lock first.
      const rearShare = rearAxleBrakeShare(axles.frontCount, axles.rearCount);
      const rear0 = 1 - axles.frontWeightShare;
      const front0 = axles.frontWeightShare;
      const chi = (kerbY - contactY) / wheelbase;
      const unloadPerG = ((1 - ANTI_DIVE_FRACTION) * chi) / Math.max(1e-6, rear0);
      const fullG = this.model.brakeDecelG;
      const kneeG = Math.max(0, (rear0 - rearShare) / chi);
      const frontFullG = (1 - rearShare) * fullG;
      const idealFullG = (-front0 + Math.sqrt(front0 * front0 + 4 * chi * frontFullG)) / (2 * chi);
      if (kneeG < idealFullG && rearShare > 0) {
        const knee = kneeG / (fullG * (1 - unloadPerG * kneeG));
        const fullPressure = (idealFullG - frontFullG) / (rearShare * fullG);
        const fullKnee = knee * (1 - unloadPerG * idealFullG);
        this.rearValveKerbKnee = knee;
        this.rearValveSlope = clamp((fullPressure - fullKnee) / (1 - fullKnee), 0, 1);
      }
    }
  }

  /**
   * Instantiates the model: body into the chassis group, wheels held aside for
   * `rebuild` to set on their contacts. A kit body's new rig takes over
   * `previousKit`'s channels, so a rebuild leaves an open door open.
   */
  private buildVisuals(previousKit: KitRig | null): void {
    const instance = createCarModel(this.model.id, this.car.id);
    this.rootGroup.add(instance.body);
    this.bodyGroup = instance.body;
    this.bodyRestScale.copy(instance.body.scale);

    if (this.model.kit) {
      // The rig turns a kit body's wheel itself (channel `steer`, `driveKit`); its node
      // carries the same name, and two writers would fight over it.
      this.kitRig = new KitRig(instance.body, false);
      if (previousKit) this.kitRig.adopt(previousKit);
      else {
        for (const mirror of KIT_MIRRORS) {
          const saved = this.car[MIRROR_FIELD[mirror]];
          if (!saved) continue;
          this.kitRig.set(`${KIT_MIRROR_CHANNEL[mirror]}_yaw`, saved[0], true);
          this.kitRig.set(`${KIT_MIRROR_CHANNEL[mirror]}_pitch`, saved[1], true);
        }
      }
      this.kitDome = instance.body.getObjectByName(KIT_DOME_LAMP_NODE) ?? null;
      this.cabinView = new CabinCargoView(instance.body);
    } else {
      // The body subtree is cloned per vehicle, so this node belongs to this car and
      // turning it cannot turn anybody else's wheel.
      this.steeringWheel = instance.body.getObjectByName(STEERING_WHEEL_NODE) ?? null;
      this.steeringWheelRest = this.steeringWheel?.rotation.y ?? 0;
    }

    this.wheelMeshes.clear();
    for (const [id, mesh] of instance.wheels) this.wheelMeshes.set(id, mesh);
    // Beside the wheels, which `rebuild` hangs under the root: it draws them as they stand.
    this.wheelDraw = instance.wheelDraw;
    if (instance.wheelDraw) this.rootGroup.add(instance.wheelDraw);

    this.lamps.build(this.measure.halfExtents, this.contactPlaneY);
    // After the lamps bind theirs, so no lens walk ever meets it; hidden until `showMid`.
    this.midParts = instance.mid;
    if (instance.mid) this.rootGroup.add(instance.mid.paint);
    if (instance.mid?.glass) this.rootGroup.add(instance.mid.glass);
    // Chassis-local like the mid parts; `castHull` decides each frame who casts it.
    this.shadowHull = instance.shadowHull;
    if (instance.shadowHull) this.rootGroup.add(instance.shadowHull);

    this.surface = instance.surface;
    this.surface.setCondition(this.localBodyDirt, this.localBodyScratches);
    this.surface.setStickers(this.car.stickers);
    this.appliedPaint = null;
    this.syncPaint();
  }

  /** Re-prints the car's stickers after one was placed; the model may still be loading. */
  refreshStickers(): void {
    this.surface?.setStickers(this.car.stickers);
  }

  /** Prints the sticker being tried on over the placed ones, or clears it (null). */
  previewSticker(sticker: StickerState | null): void {
    this.surface?.setStickers(this.car.stickers, sticker);
  }

  /** The "stick it here" glow on the paint, 0..1. */
  setStickerHighlight(value: number): void {
    this.surface?.setHighlight(value);
  }

  /** A key-fob wink of the blinkers. */
  wink(): void {
    this.lamps.wink();
  }

  /** Releases per-instance lamp materials and detaches the model-owned visual tree. */
  private clearVisuals(): void {
    this.lamps.clear();
    this.surface?.dispose();
    this.surface = null;
    this.cabinView?.dispose();
    this.cabinView = null;
    for (const child of this.rootGroup.children.slice()) this.rootGroup.remove(child);
    this.bodyGroup = null;
    // Its materials are the paint's and glass's, which the surface disposed; its geometry is the model's.
    this.midParts = null;
    this.midShown = false;
    this.shadowHull = null;
    // The muted meshes leave with the tree; the next one casts until told otherwise.
    this.shadowMuted.length = 0;
    this.nearCasting = true;
    this.bodyRestScale.set(1, 1, 1);
    this.wheelMeshes.clear();
    this.wheelDraw = null;
    this.steeringWheel = null;
    this.steeringWheelRest = 0;
    this.kitRig = null;
    this.kitDome = null;
  }

  /** Writes the air filter wear driven since the last write into the fitted filter. */
  private flushAirFilterWear(): void {
    const wear = this.filterWearAccum;
    this.filterWearAccum = 0;
    const filter = bonnetAirFilter(this.car.bonnet);
    if (wear <= 0 || !filter || filter.id !== this.filterWearPartId) return;
    this.world.apply({ t: 'car_air_filter', carId: this.car.id, clog: (filter.clog ?? 0) + wear });
  }

  private drivetrainEngine(): EngineSpec | null {
    const part = bonnetPart(this.car.bonnet, 0);
    if (!part) return null;
    const engine = variant(part.variantId).engine ?? null;
    return engine && part.destroyed ? destroyedEngineSpec(engine) : engine;
  }

  private capDestroyedEngineSpeed(forwardMps: number): void {
    const excess = forwardMps - Math.sign(forwardMps) * DESTROYED_ENGINE_SPEED_CAP_MPS;
    this.linvel.x -= this.forwardScratch.x * excess;
    this.linvel.z -= this.forwardScratch.z * excess;
    this.chassisBody.setLinvel(this.linvel, true);
  }

  private forwardSpeedMps(): number {
    this.chassisBody.linvel(this.linvel);
    this.chassisBody.rotation(this.rotationScratch);
    rotateVector(this.forwardScratch, this.rotationScratch, 0, 0, 1);
    return (
      this.linvel.x * this.forwardScratch.x +
      this.linvel.y * this.forwardScratch.y +
      this.linvel.z * this.forwardScratch.z
    );
  }

  private averageWheelRadius(isFront: boolean): number {
    let sum = 0;
    let count = 0;
    for (const w of this.wheels) {
      if (w.isFront === isFront) {
        sum += w.radius;
        count++;
      }
    }
    return count > 0 ? sum / count : 0.35;
  }
}
