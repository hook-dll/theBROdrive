/**
 * The drivable car: a Rapier dynamic chassis + ray-cast wheels + the drivetrain
 * simulation, with Three.js meshes as pure derived views.
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
import type { PhysicsWorld, Vec3 } from '../core/physics';
import type { InputFrame } from '../core/input';
import { MicroRelief, RoadTexture, SURFACES, SurfaceType } from '../core/surfaces';
import { hash01 } from '../core/rng';
import { WorldOrigin, type Rebasable, type RebaseShift } from '../world/origin';
import {
  DAY_LENGTH,
  type BodyDent,
  type CarState,
  type GameWorld,
} from '../game/state';
import {
  OIL_LOSS_LPH,
  oilCapacity,
  variant,
  type CarStats,
  type EngineSpec,
} from '../parts/registry';
import { itemMass } from '../items/items';
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
  bonnetCanRun,
  bonnetPart,
  bonnetRadiator,
  destroyedEngineSpec,
  engineFailureReason,
  stockBonnetVariants,
} from './bonnet';
import {
  EngineCoolingSystem,
  ambientAirC,
  type CoolingState,
  type EngineTempReadout,
} from './cooling';
import { Drivetrain } from './drivetrain';
import {
  STEERING_WHEEL_NODE,
  carModelMeasure,
  createCarModel,
  type CarModelMeasure,
} from '../render/carmodel';
import type { CarBodySurface } from '../render/carsurface';
import type { ContactPatchField } from '../render/contactpatches';
import { patchOpacity } from '../render/contactpatches';
import type { VehicleLightRig } from '../render/vehiclelights';

import {
  AIR_DENSITY,
  ANTI_DIVE_FRACTION,
  ANTI_ROLL_FRONT_FRACTION,
  ANTI_ROLL_REAR_FRACTION,
  ANTI_SQUAT_FRACTION,
  AUTO_DIRECTION_RELEASE_MPS,
  type AxleGeometry,
  BODY_CONDITION_EMIT_INTERVAL,
  BODY_DIRT_ROAD_FILM,
  BODY_DIRT_TYRE_METRES_TO_FULL,
  BOUNCE_AMPLITUDE_METRES,
  BOUNCE_HOP_HZ,
  BOUNCE_SQUASH_MAX,
  BUMP_STEER_FULL_ROUGHNESS,
  BUMP_STEER_TAU,
  BUMP_STOP_FRACTION,
  BUMP_STOP_PEAK,
  CARRIED_MASS_EPSILON_KG,
  CHASSIS_ANGULAR_DAMPING,
  COM_DROP_FRACTION,
  CONTACT_PATCH_M,
  COUNTERSTEER_RELEASE_FULL_DEG,
  COUNTERSTEER_RELEASE_START_DEG,
  DEFORMATION_DRAG_FULL_MPS,
  DEFORMATION_DRAG_START_MPS,
  DENT_IMPACT_THRESHOLD_MPS,
  DESTROYED_ENGINE_SPEED_CAP_MPS,
  DIG_FIRM_MU,
  DIG_FIRM_RR,
  DIG_FULL_MPS,
  DIG_GONE_MPS,
  DIG_SURFACES,
  DRAG_CD,
  DRIVELINE_LAG_S,
  ELLIPSE_LATERAL_FLOOR,
  FLUID_DENSITY_OIL,
  FOOT_BRAKE_GRIP_RATIO,
  FOOT_BRAKE_MAX_DECEL,
  FOOT_BRAKE_REAR_BIAS,
  FUEL_EMIT_INTERVAL,
  GRAVITY,
  GRIP_MASS_EXPONENT,
  GRIP_REFERENCE_MASS,
  HANDLING_PROFILES,
  type HandlingTuning,
  IMPACT_UNEXPLAINED_FLOOR_MPS,
  INERTIA_PITCH_YAW_GAIN,
  INERTIA_ROLL_GAIN,
  LATERAL_STATIC_SPEED_MPS,
  LOAD_SENSITIVITY,
  LOAD_SENSITIVITY_MAX,
  LOAD_SENSITIVITY_MIN,
  LOCKED_SIDE_GRIP,
  LOCK_SLIP_RATIO,
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
  REAR_AXLE_SIDE_GRIP,
  ROLL_ACCEL_MAX,
  ROLL_ACCEL_TAU,
  ROLL_COUPLE_GAIN,
  ROLL_LIMIT_DEG,
  ROLL_RATE_DAMPING,
  SCRATCH_IMPACT_THRESHOLD_MPS,
  SCRATCH_PER_IMPACT_CAP,
  SCRATCH_PER_SEVERITY_MPS,
  SHOVE_BRAKE_FRACTION,
  SHOVE_RAMP_SECONDS,
  SHOVE_RELEASE_SECONDS,
  SHOVE_SPEED_CAP,
  SLIDE_CONE_THRESHOLD,
  SLIDE_CURVE_GAIN,
  SLIDE_MIN_MPS,
  SLIDE_ONSET_TAU,
  SLIDE_RECOVER_TAU,
  SLIDING_GRIP_FRACTION,
  SLIP_ANGLE_REF_MPS,
  SLIP_CURVE_SHARPNESS,
  SLIP_FULL_FRONT_DEG,
  SLIP_FULL_REAR_DEG,
  SLIP_PLATEAU_FRONT,
  SLIP_PLATEAU_REAR,
  SLIP_REFERENCE_MPS,
  STEERING_WHEEL_HALF_LOCK_RAD,
  STEER_CASTER_RETURN_RAD_S,
  STEER_FULL_LOCK_KMH,
  STEER_PLAY_RAD,
  STEER_RATE_CURVE,
  STEER_REDUCED_KMH,
  SUSPENSION_FORCE_HEADROOM,
  TANH_SHARPNESS,
  TRANSFORM_EMIT_INTERVAL,
  TWO_PI,
  TYRE_COMPOUNDS,
  TYRE_COOLING_AIRFLOW_GAIN,
  TYRE_COOLING_STILL_W_PER_K,
  TYRE_DAMPING_RATIO,
  TYRE_MAX_C,
  TYRE_ROLLING_HEAT_SHARE,
  TYRE_SLIP_HEAT_SHARE,
  TYRE_TREAD_CAPACITY_J_PER_K,
  WHEEL_LOAD_TAU,
  WHEEL_MASS_KG,
  WHEEL_REFERENCE_RADIUS,
  clamp,
  fuelDensity,
  impactDent,
  rotateVector,
  stockRadiatorWater,
  tyreTemperatureGrip,
  tyreVerticalRate,
  unsprungMass,
} from './vehicletuning';
import { VehicleLamps, type HeadlightMode, type IndicatorSide } from './vehiclelamps';

interface WheelVisual {
  index: number;
  isFront: boolean;
  /** Sign of the wheel's chassis-local lateral position; left=-1, right=+1. */
  sideSign: number;
  radius: number;
  /** Geometry this wheel was built with, metres (see `rebuild`). */
  restLengthM: number;
  maxTravelM: number;
  /** Static spring compression this corner settles at, metres. */
  sagM: number;
  /** What this corner carries when the car is parked and level, newtons. */
  staticLoadN: number;
  /**
   * This corner's SPRING and DAMPER, in absolute SI units — N/m and N·s/m.
   *
   * Absolute rather than per-kilogram on purpose: Rapier multiplies the rate it is
   * given by the chassis mass, so a per-kilogram figure makes an unloaded car and a
   * loaded one settle at the same ride height. These do not change with load, so the
   * load does. `reloadSprings` divides by the current mass at the boundary.
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
  /** Reused per-frame buffer for wheelChassisConnectionPointCs. */
  scratchCp: { x: number; y: number; z: number };
  /** Friction-slip budget set for this wheel this step, i.e. its cone size. */
  frictionSlip: number;
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
  /** Longitudinal slip ratio, (ωr - v)/max(|v|, ref). Negative under lock-up. */
  slipRatio: number;
  /** Low-passed normal load (N) reported by the suspension. */
  loadN: number;
  /** Spring compression from rest this step, metres; negative in droop. */
  compressionM: number;
  /**
   * Slip angle the CARCASS has actually built, radians, lagged behind the geometric
   * one by the relaxation length. This is the angle the side-force curve is read at.
   */
  slipAngleRad: number;
  /**
   * Share of this tyre's longitudinal capacity the last step spent, 0..1. Feeds the
   * friction ellipse that decides what is left for cornering.
   */
  /**
   * Lateral force capacity (N) and the fraction of it this tyre's built slip angle
   * asks for, plus the wheel-plane right vector and the contact's sideways speed.
   * Resolved in the setup pass and consumed by the tyre pass, so neither recomputes
   * the other's geometry.
   */
  lateralCapacityN: number;
  lateralShape: number;
  lateralRightX: number;
  lateralRightY: number;
  lateralRightZ: number;
  lateralSpeed: number;
  /** Drive torque (N·m) commanded to this wheel this step. */
  driveTorqueNm: number;
  /** Brake force (N) commanded to this wheel this step. */
  brakeForceN: number;
  /** Wheel forward tangent in world space; projected onto steep contact surfaces. */
  forwardDir: { x: number; y: number; z: number };
  /** Contact point, normal and chassis-frame velocity; all reused every step. */
  contactPoint: { x: number; y: number; z: number };
  contactNormal: { x: number; y: number; z: number };
  contactVel: { x: number; y: number; z: number };
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
  /** Friction-circle saturation, 0..1. */
  slideT: number;
  /** Chassis forward speed, m/s (signed). */
  forwardSpeed: number;
}

/**
 * Per-wheel RIDE state, as opposed to the spray's per-wheel contact state.
 *
 * This is the only window onto the suspension anything outside this file has, and it
 * exists because the three things that decide whether a car rides like a car —
 * where its weight sits, how far the springs are compressed, and how much of the
 * travel is left — are otherwise invisible: Rapier keeps them inside the controller
 * and the game only ever sees the chassis pose that results.
 *
 * Written in place once per fixed step; nothing here allocates.
 */
export interface WheelRideState {
  readonly isFront: boolean;
  /** left = -1, right = +1. */
  readonly sideSign: number;
  inContact: boolean;
  /** Low-passed normal load (N) this wheel is carrying. */
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

export class Vehicle implements Rebasable {
  private readonly physics: PhysicsWorld;
  private readonly world: GameWorld;
  private readonly car: CarState;
  private readonly model: CarModelDef;
  /** Shared immutable tuning selected once from the catalogue's mechanical family. */
  private readonly handling: HandlingTuning;
  private readonly measure: CarModelMeasure;
  /** Axle positions, wheel counts and weight distribution; measured once, in `measureAxles`. */
  private readonly axleGeometry: AxleGeometry;
  private readonly scene: THREE.Scene;
  private readonly origin: WorldOrigin;
  /** Removes this runtime from floating-origin notifications when it despawns. */
  private originDisposer: (() => void) | null = null;
  private disposed = false;


  private readonly chassisBody: RAPIER.RigidBody;
  private readonly chassisCollider: RAPIER.Collider;
  private controller: RAPIER.DynamicRayCastVehicleController | null = null;
  private readonly drivetrain: Drivetrain;

  private statsValue: CarStats;
  /**
   * Mass the driver is carrying, kg, pushed in by the composition root.
   *
   * The pack is the player's, not the car's, so `Vehicle` cannot read it; see
   * `setCarriedMass`. Kept as a field rather than folded into `computeStats` so the
   * mass only refreshes when the number actually moves.
   */
  private carriedMassKg = 0;

  private readonly rootGroup = new THREE.Group();
  /** Per-car phase offset (turns) so traffic does not hop in unison; see `BOUNCE_HOP_HZ`. */
  private readonly bouncePhase: number;
  /** The body-and-trim subtree alone, for `BOUNCE_SQUASH_MAX`; wheels are siblings. */
  private bodyGroup: THREE.Object3D | null = null;
  /** This car's paint and dents, created with its visuals; see render/carsurface.ts. */
  private surface: CarBodySurface | null = null;
  /**
   * `bodyGroup`'s scale AT REST, captured once in `buildVisuals`. `buildTemplate`
   * (render/carmodel.ts) bakes each model's own unit-correction factor into this
   * scale — for one catalogue car it is ~0.0107, not 1 — so the squash MUST multiply
   * this rather than assign an absolute value: overwriting it with something near 1
   * once inflated a body to roughly 100x its size instead of squashing it by 20%.
   */
  private readonly bodyRestScale = new THREE.Vector3(1, 1, 1);

  private wheels: WheelVisual[] = [];
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
  /** This car's lamps: beam mode, indicator, lens materials and the beams they cast. */
  private readonly lamps: VehicleLamps;
  /** One selected compound for every wheel; standard preserves existing handling. */
  private tyreCompoundIndex = 1;
  /** Measured full-pedal braking authority, m/s²; see `measuredBrakeDecel`. */
  private measuredBrakeDecelValue = 0;

  /**
   * Seconds the dashboard's warning lamp still owes the player.
   */

  private readonly dragCoeff: number;

  // Axle bookkeeping for torque splitting and the drivetrain input.
  private frontWheelCount = 0;
  private rearWheelCount = 0;
  private frontDrivenCount = 0;
  private rearDrivenCount = 0;
  private drivenRadius = 0.35;

  // Steering state. `steerCommand` is what the box has been turned to (rate
  // limited); `steerAngle` is what the tyres are actually at, which lags it by the
  // backlash in STEER_PLAY_RAD.
  private steerCommand = 0;
  private steerAngle = 0;
  /** Load-sensitive front bump-steer disturbance, filtered in fixedUpdate. */
  private bumpSteerAngle = 0;
  private appliedDriveTorqueNm = 0;
  /**
   * Parking hold is armed by the fixed update and applied after Rapier has stepped.
   * Freezing after the step removes the tiny gravity displacement that a ray-cast
   * wheel brake otherwise accumulates while a car is stopped on a slope.
   */
  private parkingHoldRequested = false;
  private parkingHoldActive = false;
  /**
   * Seconds of shove left before the parking hold re-latches. Counted down in `settle`,
   * so it only ever matters on a car nobody is driving.
   */
  private shoveTimer = 0;
  /**
   * Service-brake demand from the last driven step, 0..1. Read by a coupled
   * trailer so its brakes come on with the car's pedal.
   */
  private serviceBrakeCommand = 0;
  /** Literal backward/brake control, retained while an automatic uses it as reverse throttle. */
  private brakeLightCommand = 0;
  // Relative (Rapier frame): read from the body when the hold first latches, then
  // re-applied every step. Shifted by `rebase` alongside the interpolation
  // snapshots, so a held car does not snap a kilometre when the origin moves.
  private readonly parkingHoldPos = { x: 0, y: 0, z: 0 };
  private readonly parkingHoldRot = { x: 0, y: 0, z: 0, w: 1 };

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
  private bodyConditionEmitTimer = 0;
  private lastAuthOil: number;
  private fluidEmitTimer = 0;

  // Odometer and transform emission.
  private odoAccum = 0;
  private odoEmitTimer = 0;
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
  /**
   * The dent the collision in progress is making. One crash is classified as an
   * impact on several consecutive steps while the solver works the car's momentum
   * off; recording each as its own dent would deepen one blow by however many steps
   * the solver needed. The strongest step stands for the whole collision, and the
   * dent is recorded once the blows stop (or the car is saved mid-crash).
   */
  private pendingDent: BodyDent | null = null;
  private pendingDentSeverityMps = 0;
  private readonly contactScratch = { x: 0, y: 0, z: 0 };
  private readonly contactNormalScratch = { x: 0, y: 0, z: 0 };
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
  /**
   * The sub-collider ground profile this car drives over. Seeded from the WORLD, not
   * from the car, so every vehicle in the same desert is thrown by the same ripple.
   */
  private readonly microRelief: MicroRelief;
  /** The sealed-surface texture field, seeded from the same world (see `RoadTexture`). */
  private readonly roadTexture: RoadTexture;
  private readonly invRotationScratch = { x: 0, y: 0, z: 0, w: 1 };
  private readonly localVelScratch = { x: 0, y: 0, z: 0 };
  private readonly localAngScratch = { x: 0, y: 0, z: 0 };
  private readonly leanScratch = { x: 0, y: 0, z: 0 };
  private readonly wheelRightScratch = { x: 0, y: 0, z: 0 };
  /**
   * Rear-axle slip angle (radians, unsigned) measured on the previous step. Read one
   * tick later by the steering limiter, which runs before the wheels are looked at:
   * at 60 Hz that is 17 ms of lag on a signal that takes tenths of a second to
   * build, and it is what keeps this a single-pass update instead of two.
   */
  private rearSlipRad = 0;
  /**
   * Custom tyre-force passes suppressed after the floating origin moves.
   *
   * Rapier's vehicle controller caches each wheel's world-space contact point and
   * refreshes it one controller update AFTER a body teleport. The floating origin is
   * such a teleport. On the first tick after a rebase, `updateWheelDynamics` therefore
   * received a point still expressed in the old origin and applied an ordinary tyre
   * impulse roughly one kilometre from the chassis: measured angular velocity jumped
   * from 0.05 to 19.8 rad/s inside that method alone — the distance-triggered
   * "invisible bump" that could spin a car in place.
   *
   * Suspension still updates on that tick, which refreshes the controller's contact
   * cache. Suppressing one 16.7 ms custom tyre pass is imperceptible and means the next
   * one applies at a contact point beside the wheel rather than a kilometre away.
   */
  private skipTyreDynamicsSteps = 0;
  // Roll-couple state: low-passed lateral acceleration and its lever arm.
  private prevLatVel = 0;
  private rollAccel = 0;
  private rollPrimed = false;
  private rollLeverArm = 0.5;
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
    gearLabel: 'N',
    wheelContactFraction: 0,
    surfaceRoughness: 0,
    lateralSlipMps: 0,
    landingImpactMps: 0,
    frontLockT: 0,
    rearLockT: 0,
  };
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
    this.measure = carModelMeasure(carState.modelId);
    this.axleGeometry = this.measureAxles();
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

  get tyreCompoundLabel(): string {
    return TYRE_COMPOUNDS[this.tyreCompoundIndex].label;
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeedMps()) * 3.6;
  }

  /**
   * Where the RIM is, as a fraction of full lock, positive to the left.
   *
   * This is `steerCommand` and not `steerAngle`, and the two are different on purpose.
   * `steerAngle` is what the road wheels present after the steering box's backlash,
   * which is the right number for the physics and the wrong one for a driver: it lags
   * the input by the play and by the rack rate, so a needle reading it would move in
   * two steps per correction — once when the slack is taken up and once when the
   * backlash opens again — and would show the tyres wandering while the driver holds
   * the wheel still. A real car's rim is rigidly connected to the driver's hands, and
   * that is the whole reason a driver can feel where the wheels are pointing without
   * looking at them. The rim's angle is what the hands need; the tyre's angle is what
   * the tyre model needs.
   *
   * Normalised by this model's own lock, so a car with a slow rack and a car with a
   * quick one both fill the indicator at full lock. Divided rather than clamped at the
   * source: `targetSteer` is already bounded by `steerLock`, so the quotient lands in
   * -1..1 on its own, and the clamp in `Hud.updateSteerStrip` is the only one needed.
   *
   * A front-driven car's power steer and this car's caster return both move it, which
   * is the point — the driver is looking at a rubber band being stretched.
   */
  get steeringFraction(): number {
    return this.model.steerLock > 0 ? this.steerCommand / this.model.steerLock : 0;
  }
  /**
   * Stable peak lateral acceleration available to an autonomous speed planner.
   *
   * Uses the same model, tyre, mass, surface and tyre temperature as the live tyre
   * pass, but not transient load transfer or slip. The controller applies its own
   * safety margin before treating this as a cornering budget.
   *
   * It reads the WORST wheel's temperature rather than assuming a cold tyre, because a
   * planner that believes in grip the tyres have already lost is planning corners its
   * own car cannot take — which is exactly the state a long, hard drive puts it in.
   */
  estimatedLateralAccel(surfaceType: SurfaceType, _speedMps: number): number {
    let worstTyreGrip = 1;
    for (const w of this.wheels) worstTyreGrip = Math.min(worstTyreGrip, w.tyreGrip);
    const compound = TYRE_COMPOUNDS[this.tyreCompoundIndex];
    return (
      GRAVITY *
      SURFACES[surfaceType].lateralMu *
      this.handling.tyreLateralScale *
      this.statsValue.wheelGrip *
      Math.pow(GRIP_REFERENCE_MASS / this.statsValue.mass, GRIP_MASS_EXPONENT) *
      compound.side *
      worstTyreGrip *
      this.handling.rearAxleSideGrip
    );
  }

  /**
   * Deceleration a floored foot brake really produced authority for on the last
   * physics step, m/s². Zero until the first wheel pass has run, so a caller with no
   * measurement yet falls back to `estimatedBrakeDecel`.
   */
  get measuredBrakeDecel(): number {
    return this.measuredBrakeDecelValue;
  }

  /** Stable straight-line braking capacity on a named surface, in m/s². */
  estimatedBrakeDecel(surfaceType: SurfaceType): number {
    const compound = TYRE_COMPOUNDS[this.tyreCompoundIndex];
    const longitudinalGrip =
      this.statsValue.wheelGrip * (this.model.longitudinalGripScale ?? 1);
    return Math.min(
      FOOT_BRAKE_MAX_DECEL,
      FOOT_BRAKE_GRIP_RATIO *
        SURFACES[surfaceType].longitudinalMu *
        longitudinalGrip *
        compound.grip *
        GRAVITY,
    );
  }

  /**
   * Inverts this vehicle's exact steering profile for the ordinary shaped input path.
   * Autonomy uses it instead of maintaining a stale copy of each handling family.
   */
  steeringInputForWheelAngle(wheelAngle: number, speedMps: number): number {
    const magnitude = Math.abs(wheelAngle);
    const speedT = clamp(
      (Math.abs(speedMps) * 3.6 - STEER_FULL_LOCK_KMH) /
        (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
      0,
      1,
    );
    const slideRelease = clamp(
      ((this.rearSlipRad * 180) / Math.PI - COUNTERSTEER_RELEASE_START_DEG) /
        (COUNTERSTEER_RELEASE_FULL_DEG - COUNTERSTEER_RELEASE_START_DEG),
      0,
      1,
    );
    const speedFactor =
      1 -
      (1 - this.handling.steerHighSpeedFraction) *
        Math.pow(speedT, this.handling.steerLockCurve);
    const effectiveLock = Math.max(
      this.model.steerLock * (speedFactor + (1 - speedFactor) * slideRelease),
      0.1,
    );
    const play = this.handling.steerPlay * (1 - slideRelease);
    if (magnitude <= play * 0.12) return 0;
    const targetAngle = Math.min(magnitude + play, effectiveLock);
    const normalized = Math.pow(targetAngle / effectiveLock, 1 / this.handling.steerInputExponent);
    return clamp(-Math.sign(wheelAngle) * normalized, -1, 1);
  }


  /**
   * The fuel/parts gate, plus the overheat stall. A critically hot engine is NOT
   * running: it has nipped up on its own oil film and will not turn again until the
   * coolant is back under the warning line, which is the only reason a temperature
   * gauge is worth watching.
   */
  get engineRunning(): boolean {
    return (
      !this.overheatStalled && bonnetCanRun(this.car.bonnet, this.localFuel, this.car.fuelKind)
    );
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

  toggleIndicator(side: Exclude<IndicatorSide, 'off'>): void {
    this.lamps.toggleIndicator(side);
  }

  get indicator(): IndicatorSide {
    return this.lamps.indicator;
  }

  setHeadlightEnvironmentFactor(factor: number): void {
    this.lamps.setEnvironmentFactor(factor);
  }

  /**
   * Bald -> standard -> experimental -> experimental2 -> bald, applied to every wheel
   * on the next step. Not persisted: a reload or a change of car is back on standard.
   */
  cycleTyreCompound(): void {
    this.tyreCompoundIndex = (this.tyreCompoundIndex + 1) % TYRE_COMPOUNDS.length;
  }

  /** Rebuilds stats, drivetrain, controller and meshes from the model and its parts. */
  rebuild(): void {
    if (this.controller) {
      this.controller.free();
      this.controller = null;
    }
    this.clearVisuals();
    this.wheels = [];
    this.steerCommand = 0;
    this.steerAngle = 0;
    this.bumpSteerAngle = 0;
    this.frontWheelCount = 0;
    this.rearWheelCount = 0;
    this.frontDrivenCount = 0;
    this.rearDrivenCount = 0;
    this.drivenRadius = 0.35;

    this.statsValue = this.computeStats();
    const stats = this.statsValue;

    this.drivetrain.reconfigure(this.drivetrainEngine(), stats.gearbox);
    // Rebinds the cooling hardware in the same breath as the drivetrain, because
    // both answer to the same four bonnet cells: swapping the radiator or the engine
    // takes effect on the next tick with no other bookkeeping. The water level is
    // re-clamped through `setWater` because a smaller core cannot hold what a larger
    // one did — the litres that do not fit are spilled, exactly as they would be.
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
    this.applyChassisMass(stats.mass);

    const rapier = this.physics.rapier;
    this.controller = new rapier.DynamicRayCastVehicleController(
      this.chassisBody,
      this.physics.world.broadPhase,
      this.physics.world.narrowPhase,
      this.physics.world.bodies,
      this.physics.world.colliders,
    );
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    const frontDriveShare = 1 - this.model.rearDriveBias;
    const rearDriveShare = this.model.rearDriveBias;
    const suspension = this.model.suspension;
    const axles = this.axleGeometry;

    // Factory ground clearance is a geometric dimension, not a spring consequence.
    // Place each axle mount so its settled tyre contact patch lies this far below
    // the body box, independent of axle sag and the source mesh's authored stance.
    const halfHeight = this.measure.halfExtents[1];
    const contactY = -halfHeight - this.model.factory.clearance;

    // Roll lever: how far the centre of mass sits above the tyre contact plane. This
    // is the arm the missing roll couple acts on (see applyRollCouple).
    const comY = -COM_DROP_FRACTION * halfHeight;
    this.rollLeverArm = Math.max(0.1, comY - contactY);
    this.contactPlaneY = contactY;
    this.buildVisuals();

    const weightN = stats.mass * GRAVITY;
    for (const wheel of this.measure.wheels) {
      const index = this.controller.numWheels();

      // This corner's share of the parked car's weight, from the weight distribution
      // and the model's own axle geometry. Everything below is derived from it: the
      // spring that gives this axle its frequency AT THIS LOAD, the damper that gives
      // it its ratio, and the load the tyre model calls "normal".
      const axleShare = wheel.isFront ? axles.frontWeightShare : 1 - axles.frontWeightShare;
      const axleCount = wheel.isFront ? axles.frontCount : axles.rearCount;
      const cornerShare = axleShare / Math.max(1, axleCount);
      const staticLoadN = Math.max(1, weightN * cornerShare);
      const hz = wheel.isFront ? suspension.frontHz : suspension.rearHz;
      // Sized at the KERB load so a stock car reproduces its preset exactly; the load
      // it is actually carrying then decides the sag and the frequency (`reloadSprings`).
      const designCornerMass = this.model.mass * cornerShare;
      const sag = staticLoadN / wheelSpringRateAbs(hz, designCornerMass);
      // Travel is sized around that sag so a soft spring gets the room it needs
      // instead of riding on Rapier's clamp (see the travel note in carmodels.ts). The
      // bump stop below catches the last of it progressively.
      const maxTravel = sag + suspension.bumpTravel;
      const restLength = sag + MOUNT_ABOVE_WHEEL_CENTRE;

      // The mount is placed so a settled wheel centre lands exactly one radius above
      // the chosen contact plane, per axle. Two axles with different sag therefore sit
      // the car LEVEL rather than raked, and the model's track and wheelbase are
      // untouched.
      this.controller.addWheel(
        { x: wheel.pos[0], y: contactY + wheel.radius + MOUNT_ABOVE_WHEEL_CENTRE, z: wheel.pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        restLength,
        wheel.radius,
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
      // Rapier's ray-cast suspension multiplies the spring force by the chassis mass
      // internally (`force * chassis_mass` in update_suspension), so the rates it is
      // handed are per kilogram while the ones stored here are absolute. The division
      // is the boundary, and it is what makes load sag the car — see `reloadSprings`.
      this.controller.setWheelSuspensionStiffness(index, springRateNPerM / stats.mass);
      this.controller.setWheelSuspensionCompression(index, compressionRateNsPerM / stats.mass);
      this.controller.setWheelSuspensionRelaxation(index, relaxationRateNsPerM / stats.mass);
      this.controller.setWheelMaxSuspensionTravel(index, maxTravel);
      this.controller.setWheelMaxSuspensionForce(index, SUSPENSION_FORCE_HEADROOM * staticLoadN);

      const mesh = this.wheelMeshes.get(wheel.id);
      if (!mesh) throw new Error(`Car model "${this.model.id}" is missing wheel ${wheel.id}`);
      mesh.name = wheel.id;
      mesh.rotation.order = 'YXZ';
      this.rootGroup.add(mesh);

      this.wheels.push({
        index,
        isFront: wheel.isFront,
        sideSign: Math.sign(wheel.pos[0]) || 1,
        radius: wheel.radius,
        restLengthM: restLength,
        maxTravelM: maxTravel,
        sagM: sag,
        staticLoadN,
        springRateNPerM,
        compressionRateNsPerM,
        relaxationRateNsPerM,
        rideHz: hz,
        tyreTempC: ambientAirC(this.world.state.timeOfDay, DAY_LENGTH),
        tyreGrip: 1,
        bumpStopN: 0,
        tyreRateN: tyreVerticalRate(wheel.radius),
        profileHeight: 0,
        profileRate: 0,
        hopZ: 0,
        hopV: 0,
        mesh,
        scratchCp: { x: 0, y: 0, z: 0 },
        frictionSlip: 0,
        digWeight: 0,
        longitudinalCapacityN: 0,
        longitudinalForceN: 0,
        groundSurface: SurfaceType.Asphalt,
        grounded: false,
        slideT: 0,
        slipAngleRad: 0,
        locked: false,
        spinRadS: 0,
        drawnSpin: 0,
        slipRatio: 0,
        loadN: 0,
        compressionM: 0,
        lateralCapacityN: 0,
        lateralShape: 0,
        lateralRightX: 1,
        lateralRightY: 0,
        lateralRightZ: 0,
        lateralSpeed: 0,
        driveTorqueNm: 0,
        brakeForceN: 0,
        forwardDir: { x: 0, y: 0, z: 1 },
        contactPoint: { x: 0, y: 0, z: 0 },
        contactNormal: { x: 0, y: 1, z: 0 },
        contactVel: { x: 0, y: 0, z: 0 },
      });

      if (wheel.isFront) {
        this.frontWheelCount++;
        if (frontDriveShare > 0) this.frontDrivenCount++;
      } else {
        this.rearWheelCount++;
        if (rearDriveShare > 0) this.rearDrivenCount++;
      }
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
        slideT: 0,
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
   * Suspension-only step for a car nobody is driving.
   *
   * Rapier's ray-cast suspension is not a constraint that persists between steps —
   * it is a force recomputed inside `updateVehicle`, and it is the *only* thing
   * holding the chassis off the ground. A vehicle that never gets `updateVehicle`
   * therefore has no springs at all: gravity pulls the chassis down until its own
   * box collider lands on the terrain, and because the wheel meshes are positioned
   * chassis-locally at `connectionPoint - suspensionLength`, they end up buried
   * under the road while the body sits on its belly. That was exactly the "parked
   * car lies on its floor" bug, and it applied to every car the moment the player
   * stepped out of it.
   *
   * So every vehicle is stepped every tick. The driven one goes through
   * `fixedUpdate`; the rest come through here, which does the minimum: no engine
   * force, no steering, and enough brake to hold the car still on a slope.
   *
   * Cost is four ray-casts per parked car per step, which is what a parked car
   * standing on its wheels is worth.
   */
  settle(dt: number): void {
    const controller = this.controller;
    if (!controller) return;
    this.lamps.adoptLiveState();
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
    // Being shoved suspends the hold, not the brake. The hold is a teleport — it
    // re-places the chassis at `parkingHoldPos` every step — so with it active no
    // impulse from anywhere can move the car at all.
    //
    // Crucially, a newly spawned car is NOT held yet. The old unconditional request
    // latched its first airborne transform before gravity could land it; every menu
    // and POI spawn therefore remained floating forever.
    const shoved = this.shoveTimer > 0;
    if (shoved) this.shoveTimer = Math.max(0, this.shoveTimer - dt);
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
    const parkedSteer = this.steerAngle;
    // Parking brake: same impulse units as the foot brake (see the braking note
    // above), spread over every wheel. Sized to hold, not to stop.
    const decel = shoved ? PARK_BRAKE_DECEL * SHOVE_BRAKE_FRACTION : PARK_BRAKE_DECEL;
    const impulse = (decel * this.statsValue.mass * dt) / n;
    for (const w of this.wheels) {
      controller.setWheelEngineForce(w.index, 0);
      controller.setWheelSteering(w.index, w.isFront ? parkedSteer : 0);
      controller.setWheelBrake(w.index, impulse);
    }
    // Keep the controller's wheel pose aligned with the retained angle so the render
    // path and the parked physics path observe the same state.

    controller.updateVehicle(dt);
    // Latch only after suspension contact and vertical settlement. Two contacts let
    // a car parked across a crest hold normally; an already-held car remains held.
    let contacts = 0;
    for (const w of this.wheels) {
      if (controller.wheelIsInContact(w.index)) contacts++;
    }
    const verticalSpeed = Math.abs(this.chassisBody.linvel().y);
    this.parkingHoldRequested =
      !shoved &&
      (
        this.parkingHoldActive ||
        (this.snapshotPrimed && contacts >= 2 && verticalSpeed < PARK_HOLD_SPEED_MPS)
      );
  }

  /**
   * Somebody is leaning on this car. Push it, grudgingly.
   *
   * `Shoveable`, implemented for the player's character controller (player.ts). It is a
   * REQUEST rather than an impulse applied from outside for one reason: a parked car pins
   * its own chassis every step, and only the car can lift that pin. It also owns the
   * arithmetic, which wants the car's mass — a 1200 kg hatchback and a 7 t truck should
   * both creep, not one be immovable and the other slide.
   *
   * The cap is a target SPEED, not a force: it takes the velocity the body already has
   * along the push axis and only supplies the impulse needed to close the gap to
   * SHOVE_SPEED_CAP, scaled so that gap closes over SHOVE_RAMP_SECONDS. That is what makes
   * the same call reasonable on a parked saloon and harmless on a wreck: nothing can be
   * accelerated past a walking shove however long it is leaned on.
   */
  shove(dirX: number, dirZ: number, seconds: number): void {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-4 || seconds <= 0) return;
    const nx = dirX / len;
    const nz = dirZ / len;

    const v = this.chassisBody.linvel();
    const along = v.x * nx + v.z * nz;
    const gap = SHOVE_SPEED_CAP - along;
    // Already going that way at least as fast as a shove can push: nothing to add. This
    // is also what stops a shove helping a rolling car along indefinitely.
    if (gap <= 0) {
      this.shoveTimer = SHOVE_RELEASE_SECONDS;
      return;
    }

    const mass = this.statsValue.mass;
    const impulse = Math.min(gap, (SHOVE_SPEED_CAP * seconds) / SHOVE_RAMP_SECONDS) * mass;
    // Horizontal only. A player walking into a bumper must never lift a car or press it
    // into the ground, and the wheel ray-casts are unforgiving about both.
    this.chassisBody.applyImpulse({ x: nx * impulse, y: 0, z: nz * impulse }, true);
    this.shoveTimer = SHOVE_RELEASE_SECONDS;
  }


  /**
   * Push fallback for the player's capsule. Character-controller collision reports
   * can disappear at a raised rear edge when autostep owns the contact; testing the
   * same capsule sphere against the chassis OBB keeps the boot side shoulderable.
   * Returns true only while the player is touching and moving into the body.
   */
  tryShoveFromSphere(
    x: number,
    y: number,
    z: number,
    radius: number,
    moveX: number,
    moveZ: number,
    seconds: number,
  ): boolean {
    if (!this.sphereTouchesBody(x, y, z, radius)) return false;
    const pushX = -this.contactNormal.x;
    const pushZ = -this.contactNormal.z;
    if (moveX * pushX + moveZ * pushZ <= 0) return false;
    this.shove(pushX, pushZ, seconds);
    return true;
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
    this.shoveTimer = SHOVE_RELEASE_SECONDS;
    this.primeTransform();
    this.snapshotPrimed = false;
  }

  /**
   * Sphere/OBB overlap in chassis-local space. On success `contactNormal` points
   * horizontally out of the car toward the sphere and is reused by the shove path.
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
    this.flushPendingDent();

    if (this.odoAccum > 0) {
      this.world.apply({ t: 'car_odometer', carId: this.car.id, metres: this.odoAccum });
      this.odoAccum = 0;
    }
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
    const controller = this.controller;
    if (!controller) return;
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
    // handbrake is on, at whatever pose it took, which is the point of a parking brake.
    //
    // `w.loadN` is last step's smoothed suspension load, like everything else the wheel
    // pass publishes, and it is the right signal rather than `w.grounded`: a ray
    // reaching the ground says nothing about whether the car is resting on it. A car
    // still in the air holds its wheels at full droop against long rays and reports
    // every one of them grounded with the springs carrying nothing.
    let holdLoadN = 0;
    for (const w of this.wheels) holdLoadN += w.loadN;
    const onWheels = holdLoadN > PARK_HOLD_MIN_LOAD_FRACTION * stats.mass * GRAVITY;
    this.parkingHoldRequested =
      input.handbrake &&
      (this.parkingHoldActive || (Math.abs(fwd) < PARK_HOLD_SPEED_MPS && onWheels));

    // Manual shift request; with driver assist on this is a +/- gate — the
    // request applies now and the next automatic decision may override it.
    if (input.shift !== 0) this.drivetrain.shift(input.shift);

    // The pedal opposite an ENGAGED drive direction remains the service brake
    // until the car is nearly stopped. Neutral is different: drive may engage
    // during a slow rollback so engine torque, rather than the brakes, arrests it.
    const automatic = this.world.state.settings.gearboxMode === 'automatic' || this.drivetrain.isPhysicallyAutomatic;
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
    const throttle = this.engineRunning ? throttleInput : 0;
    // Crank speed comes from ROAD speed, not the wheel's own rotation. Gearing it to
    // the wheel is the physically complete answer, and it was measured: it bounds
    // wheelspin properly (a slipping tyre revs the engine out), but with thrust still
    // coming from Rapier's engine force a slipping wheel then pinned the engine at its
    // redline, where torque is cut — full throttle in 1st settled at 26 km/h and 50%
    // slip. That coupling belongs with the tyre force model, not before it; until then
    // wheelspin is bounded by the gear's own redline ceiling (maxDrivenWheelSpinRadS).
    const drive = this.drivetrain.update(
      dt,
      throttle,
      fwd / this.drivenRadius,
      this.drivenRadius,
      automatic,
      input.reverse,
      input.throttle,
    );
    // Keep an already-latched parking hold through the gearbox's launch interruption.
    // Releasing the handbrake and pressing throttle on a steep grade used to drop the
    // car for the whole shift time before first gear delivered one newton. The hold
    // releases on the first tick real drive torque exists; it never propels the car.
    if (
      this.parkingHoldActive &&
      !input.handbrake &&
      throttle > 0 &&
      drive.driveTorqueNm === 0
    ) {
      this.parkingHoldRequested = true;
    }
    const brake = reverseDrive
      ? 0
      : Math.max(input.brake, brakingForDirectionChange ? input.throttle : 0);
    // S is a brake request in neutral/forward gears, but reverse throttle once R
    // has engaged. The same physical key must not command propulsion and brake lamps.
    this.brakeLightCommand =
      this.drivetrain.gearLabel !== 'R' && input.reverse ? 1 : 0;

    // Consume fuel locally and emit throttled absolute deltas.
    if (drive.fuelBurnLitres > 0) {
      this.localFuel = Math.max(0, this.localFuel - drive.fuelBurnLitres);
      this.fuelEmitTimer += dt;
      if (this.fuelEmitTimer >= FUEL_EMIT_INTERVAL) {
        this.fuelEmitTimer = 0;
        this.lastAuthFuel = this.localFuel;
        this.world.apply({ t: 'car_fuel', carId: this.car.id, litres: this.localFuel });
      }
    }

    // COOLING. The thermal model is a separate module (vehicle/cooling.ts) and this
    // is its only driver: everything it needs about the car this tick is the four
    // numbers below, so it can be exercised without a physics world.
    //
    // Ambient comes from the game clock rather than a weather system, which does not
    // exist; `ambientAirC` documents why a cosine is enough.
    this.cooling.setWater(this.localWater);
    this.cooling.update(dt, {
      load: throttle,
      revs: stats.engine.redlineRpm > 0 ? this.drivetrain.rpm / stats.engine.redlineRpm : 0,
      speedMps: fwd,
      ambientC: ambientAirC(this.world.state.timeOfDay, DAY_LENGTH),
      engineRunning: this.engineRunning,
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

    // Steering: precise control preserves its linear wheel axis; standard control
    // uses the selected car's input curve. Both retain speed-scaled lock, the physical
    // rack rate, steering-box play and caster return below.
    //
    // The negation converts our basis into Rapier's steering sign. Forward is +Z and
    // the axle is set to (-1, 0, 0), and with that pairing a POSITIVE steering angle
    // yaws the car left, while `input.steer` is positive for "the player pressed
    // right". Measured: without this negation, holding right rotated the car +1.74
    // rad (left) over two seconds.
    const speedKmh = Math.abs(fwd) * 3.6;
    this.updateBumpSteer(dt, speedKmh);
    const steerT = clamp(
      (speedKmh - STEER_FULL_LOCK_KMH) / (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
      0,
      1,
    );
    const steerInput = input.preciseSteering
      ? input.steer
      : Math.sign(input.steer) * Math.pow(Math.abs(input.steer), this.handling.steerInputExponent);
    // How far out is the tail? (See the countersteer note above.) Both the lock
    // ceiling and the rate limit are faded back toward their parking-speed values by
    // this, so a driver catching a slide has the lock and the hand-speed the car
    // physically has, and loses them again as the slide is gathered up.
    const slideRelease = clamp(
      ((this.rearSlipRad * 180) / Math.PI - COUNTERSTEER_RELEASE_START_DEG) /
        (COUNTERSTEER_RELEASE_FULL_DEG - COUNTERSTEER_RELEASE_START_DEG),
      0,
      1,
    );
    // fraction = 1 - (1-floor) * t^k: full lock up to STEER_FULL_LOCK_KMH, then a
    // fast collapse right above it and a gentle slide to the floor.
    const speedFactor =
      1 -
      (1 - this.handling.steerHighSpeedFraction) *
        Math.pow(steerT, this.handling.steerLockCurve);
    const targetSteer =
      -steerInput * this.model.steerLock * (speedFactor + (1 - speedFactor) * slideRelease);
    const steerRate =
      this.handling.steerRateHighway +
      (this.handling.steerRatePark - this.handling.steerRateHighway) *
        Math.max(Math.pow(1 - steerT, STEER_RATE_CURVE), slideRelease);
    const maxDelta = steerRate * dt;
    this.steerCommand += clamp(targetSteer - this.steerCommand, -maxDelta, maxDelta);

    // Caster first, then backlash. Inside the window the tyres are not held by the
    // box at all, so the road returns them toward straight
    // (STEER_CASTER_RETURN_RAD_S); the backlash operator then drags them out of the
    // window whenever the command has moved beyond it. Order matters: centring
    // before the operator means a held input settles on the window's trailing edge
    // (slack taken up in the direction of load) instead of drifting off it.
    //
    // THE PLAY FADES OUT DURING A SLIDE, on the same `slideRelease` the lock ceiling
    // and the rate limit use — and it is the most honest of the three. Catching a
    // slide is a sequence of REVERSALS, and every reversal crosses the whole window:
    // 1.03 degrees each way, so 2.06 degrees of dead travel per correction, arriving
    // late every single time. That is a driver-induced oscillation generator, and it
    // is exactly the rocking left and right that ends in the scenery.
    //
    // Physically it is also what a real box does. Backlash is only there when the
    // gear teeth are unloaded; a driver countersteering against a sliding rear is
    // holding the wheel hard against the load, so the slack is already taken up on
    // that side and there is nothing to cross. The vagueness belongs to cruising on
    // centre, which is where it is left untouched.
    const play = this.handling.steerPlay * (1 - slideRelease);
    const caster = this.handling.casterReturn * dt;
    this.steerAngle -= clamp(this.steerAngle, -caster, caster);
    if (this.steerCommand > this.steerAngle + play) {
      this.steerAngle = this.steerCommand - play;
    } else if (this.steerCommand < this.steerAngle - play) {
      this.steerAngle = this.steerCommand + play;
    }

    // Driveline slack and compliance: torque arrives late (DRIVELINE_LAG_S). One
    // pole, so a stab of throttle builds over ~0.3 s instead of hitting the tyres
    // on the same tick the pedal moved.
    const driveBlend = dt / (this.handling.drivelineLag + dt);
    this.appliedDriveTorqueNm += (drive.driveTorqueNm - this.appliedDriveTorqueNm) * driveBlend;
    // The brake pedal overrides what is left of the drive.
    //
    // With the throttle shut the drivetrain still hands out idle torque, and through
    // a low gear that is hundreds of Nm at the wheel. Braking against it wrecked the
    // stop: the driven axle's brake force was cancelled to the point that the RWD
    // cars needed 86 m from 100 km/h instead of 60, and their rear tyres never even
    // reached their friction limit, so a rear-biased brake could not step the tail
    // out. Real cars do creep against the brakes at idle in gear, but not at speed
    // and not against a firm pedal.
    const appliedTorque = this.appliedDriveTorqueNm * (1 - brake);

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

    // Compound first: the pedal's demand is sized against the grip the tyres have,
    // so it has to know which tyres are fitted before it can ask for anything.
    const compound = TYRE_COMPOUNDS[this.tyreCompoundIndex];
    const tyreGrip = compound.grip;

    // Total longitudinal capacity the vehicle is standing on, in newtons: the same
    // per-wheel capacity the tyre model uses in updateWheelDynamics, summed.
    //
    // Both inputs are one step old — `loadN` is the low-passed suspension force from
    // the last step and `groundSurface` was resolved in the last wheel pass — which is
    // 16 ms of lag on a quantity that barely moves (the sum is near mg whatever the
    // car is doing). Reading it here rather than mid-pass keeps ONE demand for the
    // whole vehicle, which is what preserves the brake bias as the thing that decides
    // which axle lets go. Airborne wheels contribute nothing, so a car with its wheels
    // off the ground has no brakes to over-ask with.
    const longitudinalGrip =
      stats.wheelGrip * (this.model.longitudinalGripScale ?? 1);
    let brakeCapacityN = 0;
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      brakeCapacityN +=
        SURFACES[w.groundSurface].longitudinalMu *
        longitudinalGrip *
        tyreGrip *
        w.loadN;
    }
    const footBrakeDemandN = Math.min(
      FOOT_BRAKE_MAX_DECEL * mass,
      FOOT_BRAKE_GRIP_RATIO * brakeCapacityN,
    );
    const footBrakeForce = brakeDenom > 0 ? footBrakeDemandN / brakeDenom : 0;
    // WHAT A FLOORED PEDAL WILL REALLY PRODUCE, as an acceleration, published for the
    // autonomous speed planner.
    //
    // `estimatedBrakeDecel` is an idealisation: nominal grip, nominal mass, no load
    // history. This is the demand the pedal is actually scaled against this step, over
    // the mass it has to stop, so it carries the low-passed wheel loads, the surface
    // each wheel is standing on, an airborne wheel contributing nothing, and the tyre
    // fitted. Measured on the boxed-in bench: the planner believed 4.0 m/s² of capped
    // pedal and the car delivered 2.46, arrived at a rock it had braked for from 34 m
    // still doing 5 m/s, and hit it.
    this.measuredBrakeDecelValue = mass > 0 ? footBrakeDemandN / mass : 0;
    const parkingBrakeForce = input.handbrake
      ? (PARK_BRAKE_DECEL * mass) / Math.max(1, this.wheels.length)
      : 0;

    const wheelCount = this.wheels.length;
    const totalDrivenCount = this.frontDrivenCount + this.rearDrivenCount;
    let rollingResistanceSum = 0;
    let roughnessSum = 0;
    let contactCount = 0;
    let drivenContactCount = 0;
    // Same for every wheel. `gripBudgetFactor` sizes Rapier's own cone, which now
    // bounds nothing it applies — its lateral and longitudinal channels are both
    // switched off — but the number is still what the spray and audio read as this
    // tyre's budget, so it keeps its meaning.
    const gripBudgetFactor =
      longitudinalGrip *
      tyreGrip *
      this.handling.lateralGripFraction *
      Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);
    // What the car brings to every contact patch, before the ground does: its own
    // tyre quality, its handling profile, and the mass scaling — road tyres are sized
    // to the chassis rather than with it, so a laden truck corners worse per kilogram
    // than a hatchback. The SURFACE's own coefficient is applied per wheel below,
    // because with four wheels on as many surfaces it is no longer one number.
    const lateralCarFactor =
      this.handling.tyreLateralScale *
      stats.wheelGrip *
      Math.pow(GRIP_REFERENCE_MASS / mass, GRIP_MASS_EXPONENT);
    // The load μ(Fz) is measured against THIS WHEEL parked: `w.staticLoadN`, from the
    // weight distribution and the axle geometry (see AxleGeometry). It is per-wheel
    // now, which is the point — referencing a front tyre against a quarter of the
    // car's weight told a front-drive hatchback that its nose tyres were permanently
    // overloaded and its rears permanently light, and the load-sensitivity term then
    // handed the grip to the wrong end. A heavier car still gets no free advantage
    // from sitting harder on its tyres; that is what GRIP_MASS_EXPONENT is for.

    // The air the tyres are cooling against, sampled once for the whole car.
    const ambientC = ambientAirC(this.world.state.timeOfDay, DAY_LENGTH);

    // Slip angles are read off the CONTACT PATCH velocity measured on the previous
    // step (updateWheelDynamics fills `contactVel`/`forwardDir`), so the whole
    // curve costs one dot product and one atan per wheel and no extra ray casts.
    this.chassisBody.rotation(this.rotationScratch);
    let rearSlipMax = 0;

    for (const w of this.wheels) {
      // Surface under this wheel drives traction and rolling resistance. The type is
      // kept alongside its properties because the spray needs the identity, not just
      // the numbers.
      const ground = controller.wheelGroundObject(w.index);
      const surfaceType = this.physics.surfaces.lookupType(ground ? ground.handle : null);
      const surface = SURFACES[surfaceType];

      // A tyre spending its friction budget on stopping or accelerating has none
      // left for cornering (see the friction-circle note above). The rear parking
      // cable still marks the rear wheels locked for tyre visuals and skid audio.
      // Holding force itself is distributed across every wheel below, because a
      // rear-only cable cannot reliably hold the vehicle's mass on this game's
      // steep, uneven roads.
      const handbraked = input.handbrake && !w.isFront;
      // Locked: the parking cable is immediate, because it is a cable pulling shoes
      // onto drums. The foot brake earns its lock from the wheel's own rotation,
      // measured by updateWheelDynamics after the step that delivered the torque.
      //
      // The friction ellipse is NOT applied here. It used to be — a cone reduction
      // computed from last step's longitudinal usage, folded into the constraint gain
      // — but the lateral force is now built in the tyre pass, which applies the
      // ellipse against the force it is computing on the same tick. Leaving it here
      // too charged a tyre twice for one shared budget.
      const locked = handbraked || w.locked;
      const lockGrip = locked ? LOCKED_SIDE_GRIP : 1;
      // The rear axle is a live axle on leaf springs and never had the front's
      // cornering power (REAR_AXLE_SIDE_GRIP).
      const axleGrip = w.isFront ? 1 : this.handling.rearAxleSideGrip;

      // Slip angle of this tyre: the angle between where the contact patch is going
      // and where the wheel is pointing. The wheel's own right-hand direction is the
      // chassis' +X yawed by this wheel's steering angle, so a steered front wheel is
      // measured in ITS plane, not the body's — which is the difference between
      // "the car is sideways" and "the tyre is slipping".
      const steer = this.wheelSteerAngle(w);
      rotateVector(
        this.wheelRightScratch,
        this.rotationScratch,
        Math.cos(steer),
        0,
        -Math.sin(steer),
      );
      const latSpeed =
        w.contactVel.x * this.wheelRightScratch.x +
        w.contactVel.y * this.wheelRightScratch.y +
        w.contactVel.z * this.wheelRightScratch.z;
      const fwdSpeed =
        w.contactVel.x * w.forwardDir.x +
        w.contactVel.y * w.forwardDir.y +
        w.contactVel.z * w.forwardDir.z;
      const slipRad = Math.atan2(
        Math.abs(latSpeed),
        Math.max(Math.abs(fwdSpeed), SLIP_ANGLE_REF_MPS),
      );
      // Relaxation: the carcass follows the geometric angle over a rolling DISTANCE,
      // so the blend is per metre travelled and a parked wheel builds nothing.
      const rollDistance = Math.abs(fwdSpeed) * dt;
      w.slipAngleRad +=
        (slipRad - w.slipAngleRad) *
        (1 - Math.exp(-rollDistance / this.handling.tyreRelaxationLength));
      // The limiter reads the BUILT angle, not the geometric one: countersteer has to
      // respond to the slide the tyres are actually carrying.
      if (!w.isFront && w.grounded) rearSlipMax = Math.max(rearSlipMax, w.slipAngleRad);

      // The side-force CURVE, read at the built angle: rising as a quarter sine to a
      // peak at the axle's peak angle, then fading to its plateau. This is the shape
      // that decides how much slip the car runs, and it is why the number comes out
      // where a period car's does — at 0.7 g a tyre needs 0.7/LATERAL_MU of its peak,
      // which the sine reaches around five degrees.
      const peakDeg = w.isFront
        ? this.handling.slipPeakFrontDeg
        : this.handling.slipPeakRearDeg;
      const fullDeg = w.isFront ? SLIP_FULL_FRONT_DEG : SLIP_FULL_REAR_DEG;
      const plateau = w.isFront ? SLIP_PLATEAU_FRONT : SLIP_PLATEAU_REAR;
      const slipDeg = (w.slipAngleRad * 180) / Math.PI;
      const fadeT = clamp((slipDeg - peakDeg) / (fullDeg - peakDeg), 0, 1);
      const risen =
        Math.tanh(SLIP_CURVE_SHARPNESS * Math.min(slipDeg / peakDeg, 1)) / TANH_SHARPNESS;
      const shape = risen * (1 - (1 - plateau) * fadeT * fadeT * (3 - 2 * fadeT));

      // μ(Fz). Exactly 1 at this wheel's static share of the car's weight, so the
      // calibrated straight-line figures stand and only TRANSFER changes anything.
      const loadFactor = clamp(
        1 - LOAD_SENSITIVITY * (w.loadN / w.staticLoadN - 1),
        LOAD_SENSITIVITY_MIN,
        LOAD_SENSITIVITY_MAX,
      );

      const frictionSlip = surface.longitudinalMu * gripBudgetFactor * loadFactor;
      controller.setWheelFrictionSlip(w.index, frictionSlip);
      // ZERO. Rapier's lateral channel is a velocity-cancelling constraint scaled by
      // this gain, and a constraint is a ceiling with no curve under it: side force
      // rose linearly with slip until it hit the cone, so the car ran 1.2-1.4 degrees
      // of slip at the limit where the model's own constants say 4-6. Everything the
      // authored pipeline used to feed into this gain now sizes a real force below.
      controller.setWheelSideFrictionStiffness(w.index, 0);
      w.tyreGrip = tyreTemperatureGrip(w.tyreTempC);
      w.lateralCapacityN =
        surface.lateralMu *
        lateralCarFactor *
        compound.side *
        w.tyreGrip *
        axleGrip *
        lockGrip *
        loadFactor *
        w.loadN;
      w.lateralShape = shape;
      w.lateralRightX = this.wheelRightScratch.x;
      w.lateralRightY = this.wheelRightScratch.y;
      w.lateralRightZ = this.wheelRightScratch.z;
      w.lateralSpeed = latSpeed;

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
      // The sum is then ENVELOPED over the contact patch. A tyre stands on 160 mm of
      // road and cannot see anything shorter, so the filter is a low-pass over
      // DISTANCE TRAVELLED, not over time: the same ripple is equally sharp at 40 and
      // at 100 km/h, and detail below the patch length is attenuated at both.
      const profileTarget =
        ground && w.grounded
          ? surface.microRelief *
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
              )
          : 0;
      const rolled = Math.abs(fwdSpeed) * dt;
      const envelope = 1 - Math.exp(-rolled / CONTACT_PATCH_M);
      const beforeProfile = w.profileHeight;
      w.profileHeight += (profileTarget - w.profileHeight) * envelope;
      w.profileRate = w.grounded ? (w.profileHeight - beforeProfile) / dt : 0;

      const axleShare = w.isFront ? frontShare : rearShare;
      const axleCount = w.isFront ? this.frontDrivenCount : this.rearDrivenCount;
      const driven = axleShare > 0 && axleCount > 0;

      // Rapier applies NO longitudinal force any more: both of its channels are
      // zeroed and the tyre model in updateWheelDynamics owns drive and brake. Its
      // engine-force path could never brake and drive the same wheel anyway (a
      // Bullet port: any non-zero engine force skips the braking branch outright),
      // and its cone only ever scaled force down — it could not represent a tyre
      // past its peak, which is exactly what a locked or spinning one is.
      let brakeForce = brake > 0 ? brake * footBrakeForce * (w.isFront ? brakeFrontShare : brakeRearShare) : 0;
      // A latched parking cable takes precedence across every wheel: it is strong
      // enough to hold the car on this road network's grades.
      if (input.handbrake) brakeForce = parkingBrakeForce;

      controller.setWheelBrake(w.index, 0);
      controller.setWheelEngineForce(w.index, 0);

      w.driveTorqueNm = driven ? (appliedTorque * axleShare) / axleCount : 0;
      w.brakeForceN = brakeForce;
      w.frictionSlip = frictionSlip;
      w.groundSurface = surfaceType;
      w.grounded = ground !== null;

      controller.setWheelSteering(w.index, this.wheelSteerAngle(w));

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
        // it and the honest 0.16 eats your speed.
        rollingResistanceSum +=
          surface.rollingResistance -
          (surface.rollingResistance - DIG_FIRM_RR) * this.digWeightCar;
        roughnessSum += surface.roughness;
        if (driven) drivenContactCount++;
      }
    }
    // Handed to next step's steering limiter (see the countersteer note above).
    this.rearSlipRad = rearSlipMax;

    controller.updateVehicle(dt);

    // Wheel rotation, before the telemetry pass that reads it: each wheel is
    // integrated from its own drive and brake torque against what its contact can
    // actually transmit, so lock-up and wheelspin are outcomes, not timers.
    //
    // One pass is deliberately omitted after a floating-origin rebase; see
    // `skipTyreDynamicsSteps`. `longitudinalForceSum` must be cleared on that path or
    // anti-pitch would reuse the previous tick's force even though no tyre force was
    // applied this tick.
    if (this.skipTyreDynamicsSteps > 0) {
      this.skipTyreDynamicsSteps--;
      this.longitudinalForceSum = 0;
      this.ownTyreCapacityN = 0;
      // No tyre pass ran, so nothing dug this step either. Leaving the last value would
      // hand the chassis firm sand's rolling resistance on a step with no wheels on it.
      this.digWeightCar = 0;
      for (const w of this.wheels) w.digWeight = 0;
      // No tyre pass ran, so no aligning moment was earned. Leaving a stale one would
      // apply the previous tick's yaw damping to a step that had no tyre forces at all.
      this.alignTorqueImpulse = 0;
    } else {
      this.updateWheelDynamics(dt, longitudinalGrip, tyreGrip, fwd, ambientC);
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
    this.applyRollCouple(dt, mass, contactCount);
    this.applyAntiPitch(dt, contactCount);

    // Rolling resistance (∝ weight) + quadratic aerodynamic drag, opposing
    // horizontal motion. Drag always applies; rolling resistance fades with the
    // fraction of wheels still on the ground.
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
        const rr = rollingResistanceSum / contactCount;
        retarding += rr * mass * GRAVITY * (contactCount / wheelCount);
      }
      const dragRollingForce = retarding;

      // Engine braking: closed-throttle crank drag carried through the gearbox
      // to a wheel force, applied as a longitudinal chassis impulse — the same
      // mechanism as the drag/rolling resistance above, so it never saturates at
      // a tyre-lockup clamp the way setWheelBrake does.
      //
      // Only with the throttle shut, only while a gear is engaged (the drivetrain
      // reports zero brake torque in neutral and mid-shift), and scaled by the
      // fraction of driven wheels still in contact so airborne driven wheels
      // don't brake the car through thin air.
      if (
        throttle <= 0 &&
        drive.engineBrakeTorqueNm > 0 &&
        totalDrivenCount > 0 &&
        drivenContactCount > 0
      ) {
        retarding +=
          (drive.engineBrakeTorqueNm / this.drivenRadius) *
          (drivenContactCount / totalDrivenCount);
      }

      // Never let one tick's retarding impulse reverse the car; cap it at the
      // impulse that would bring horizontal motion exactly to rest.
      const impulse = Math.min(retarding * dt, hSpeed * mass);
      this.ownDragRollingDeltaMps = Math.min(dragRollingForce * dt, impulse) / mass;
      const inv = 1 / hSpeed;
      this.forceScratch.x = -impulse * this.linvel.x * inv;
      this.forceScratch.y = 0;
      this.forceScratch.z = -impulse * this.linvel.z * inv;
      this.chassisBody.applyImpulse(this.forceScratch, false);
    }

    // Audio telemetry. Written after the vehicle step and the roll couple, so the
    // slip and contact numbers describe the tick that just ran; `localVelScratch`
    // holds the body-frame velocity applyRollCouple already computed, so the side
    // slip costs nothing extra. A landing is however much downward speed the
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
    audio.gearLabel = this.drivetrain.gearLabel;
    audio.wheelContactFraction = wheelCount > 0 ? contactCount / wheelCount : 0;
    audio.surfaceRoughness = contactCount > 0 ? roughnessSum / contactCount : 0;
    audio.lateralSlipMps = Math.abs(this.localVelScratch.x);
    const vy = this.linvel.y;
    audio.landingImpactMps =
      contactCount > 0 ? Math.max(0, -this.prevVerticalVel - Math.max(0, -vy)) : 0;
    this.prevVerticalVel = vy;

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
        if (severityMps > DENT_IMPACT_THRESHOLD_MPS) this.recordDentBlow(severityMps);
      }
    }
    // The collision is over once a step passes without a dent-worthy blow.
    if (!this.impactThisStep || this.impactState.severityMps <= DENT_IMPACT_THRESHOLD_MPS) {
      this.flushPendingDent();
    }

    // Odometer: metres travelled forward this tick, emitted in throttled batches.
    if (fwd > 0) {
      this.odoAccum += fwd * dt;
      this.odoEmitTimer += dt;
      if (this.odoEmitTimer >= ODOMETER_EMIT_INTERVAL) {
        this.odoEmitTimer = 0;
        const metres = this.odoAccum;
        this.odoAccum = 0;
        if (metres > 0) this.world.apply({ t: 'car_odometer', carId: this.car.id, metres });
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
    if (this.parkingHoldRequested) {
      if (!this.parkingHoldActive) {
        this.chassisBody.translation(this.parkingHoldPos);
        this.chassisBody.rotation(this.parkingHoldRot);
        this.parkingHoldActive = true;
      } else {
        this.chassisBody.setTranslation(this.parkingHoldPos, true);
        this.chassisBody.setRotation(this.parkingHoldRot, true);
        this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
    // The wheel contact scratch is in the same relative world frame as the chassis.
    // Shift the last good value for spray telemetry, then omit the first custom tyre
    // pass while Rapier refreshes its own internal copy (see the field comment).
    for (const wheel of this.wheels) {
      wheel.contactPoint.x -= shift.dx;
      wheel.contactPoint.z -= shift.dz;
    }
    this.skipTyreDynamicsSteps = Math.max(this.skipTyreDynamicsSteps, 1);
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

  /**
   * Turns one classified blow into the collision's dent: where the chassis box was
   * struck, pushed along the direction the blow travelled.
   *
   * The point comes from the contact the solver actually resolved against this
   * car's box — a corner clipped on a rock dents the corner — ignoring near-vertical
   * contacts, which are a rolled car resting on the ground rather than what hit it.
   * Without a usable contact (the blow came from a shove, not a collider) the blow's
   * own direction is followed out from the box centre to its surface instead.
   */
  private recordDentBlow(severityMps: number): void {
    const fromX = this.impactState.localX;
    const fromZ = this.impactState.localZ;
    const horizontal = Math.hypot(fromX, fromZ);
    if (!(horizontal > 1e-6)) return;
    const pushX = -fromX / horizontal;
    const pushZ = -fromZ / horizontal;
    if (
      this.pendingDent &&
      this.pendingDent.nx * pushX + this.pendingDent.nz * pushZ < 0.5
    ) {
      this.flushPendingDent();
    }
    if (this.pendingDent && severityMps <= this.pendingDentSeverityMps) return;

    const half = this.measure.halfExtents;
    const offset = this.chassisCollider.translationWrtParent() ?? { x: 0, y: 0, z: 0 };
    const point = this.contactScratch;
    const normal = this.contactNormalScratch;
    // The manifold that took the most impulse, at its impulse-weighted centre: a
    // square hit on a wall touches all four nose corners of the box and dents the
    // middle, a rock clipped with one corner dents that corner.
    let bestImpulse = 0;
    this.physics.world.contactPairsWith(this.chassisCollider, (other) => {
      this.physics.world.contactPair(this.chassisCollider, other, (manifold, flipped) => {
        if (manifold.numSolverContacts() === 0) return;
        manifold.normal(normal);
        if (Math.abs(normal.y) > 0.7) return;
        let total = 0;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (let i = 0; i < manifold.numContacts(); i++) {
          const impulse = manifold.contactImpulse(i);
          if (!(impulse > 0)) continue;
          const local = flipped
            ? manifold.localContactPoint2(i, normal)
            : manifold.localContactPoint1(i, normal);
          if (!local) continue;
          total += impulse;
          sx += local.x * impulse;
          sy += local.y * impulse;
          sz += local.z * impulse;
        }
        if (total <= bestImpulse) return;
        bestImpulse = total;
        point.x = sx / total + offset.x;
        point.y = sy / total + offset.y;
        point.z = sz / total + offset.z;
      });
    });
    if (bestImpulse <= 0) {
      const reach = Math.min(
        Math.abs(fromX) > 1e-6 ? half[0] / Math.abs(fromX / horizontal) : Infinity,
        Math.abs(fromZ) > 1e-6 ? half[2] / Math.abs(fromZ / horizontal) : Infinity,
      );
      point.x = (fromX / horizontal) * reach;
      point.y = offset.y;
      point.z = (fromZ / horizontal) * reach;
    }

    this.pendingDentSeverityMps = severityMps;
    this.pendingDent = impactDent(severityMps, point.x, point.y, point.z, pushX, pushZ);
  }

  /** Records the collision in progress as one dent in authoritative state. */
  private flushPendingDent(): void {
    if (!this.pendingDent) return;
    this.world.apply({ t: 'car_body_dent', carId: this.car.id, dent: this.pendingDent });
    this.pendingDent = null;
    this.pendingDentSeverityMps = 0;
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

  /** This car's body-condition renderer; null until its visuals are built. */
  get bodySurface(): CarBodySurface | null {
    return this.surface;
  }

  syncVisuals(alpha: number): void {
    const controller = this.controller;
    if (!controller) return;

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

    // Uniform writes only when a value moved, and a dent pass only when the ring
    // changed; both are no-ops on an ordinary frame. Dirt comes from the live
    // accumulator, so fresh road dust lands on the shell this frame rather than at
    // the next throttled state emit. The resync first is for a PARKED car being
    // washed: nothing runs its fixed step, and the sponge writes state directly.
    this.resyncBodyCondition();
    this.surface?.setCondition(this.localBodyDirt, this.localBodyScratches);
    this.surface?.setDents(this.car.dents);

    this.lamps.applyRearLightState();

    // Wheels are chassis-local: suspension travel and spin are small, smooth and
    // already snapped to the same step, so they need no second interpolation.
    for (const w of this.wheels) {
      const cp = controller.wheelChassisConnectionPointCs(w.index, w.scratchCp);
      const susp = controller.wheelSuspensionLength(w.index);
      const steer = controller.wheelSteering(w.index);
      if (cp) w.mesh.position.set(cp.x, cp.y - (susp ?? 0), cp.z);
      w.mesh.rotation.set(w.drawnSpin % TWO_PI, steer ?? 0, 0);
    }

    // The rim follows the steering-box command, before rack backlash: the driver
    // turns the wheel even while play delays the tyres. Every model reaches the same
    // authored 970-degree lock-to-lock rim travel despite different tyre locks.
    //
    // Sign: `steerCommand` is positive to the LEFT, and the wheel's own axis (its
    // node's local Y, before the rake in the same Euler) points back at the driver,
    // so a positive rotation about it turns the rim anticlockwise as the driver sees
    // it — left. The two agree, so the angle is added, not negated.
    if (this.steeringWheel) {
      this.steeringWheel.rotation.y =
        this.steeringWheelRest +
        (this.steerCommand / this.model.steerLock) * STEERING_WHEEL_HALF_LOCK_RAD;
    }
  }

  /**
   * True while any lamp on this vehicle is emitting. Lets the caller skip dark
   * vehicles entirely and order the lit ones before they claim rig slots.
   */
  get hasLitLamps(): boolean {
    return this.lamps.anyLit();
  }

  /**
   * Offers this vehicle's LIT lamps to the shared rig. The beams, their mounts, the
   * distance fade and the reason a dark lamp claims no slot all live in
   * vehiclelamps.ts, which owns the state this reads.
   */
  syncProjectedLights(rig: VehicleLightRig, gain: number): void {
    this.lamps.syncProjectedLights(rig, gain);
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
   * implicitly. It has to be: at 60 Hz the explicit gain is ~20-50, so an explicit
   * step oscillates and then explodes.
   */
  private updateWheelDynamics(
    dt: number,
    wheelGrip: number,
    tyreGrip: number,
    vehicleForwardSpeed: number,
    airC: number,
  ): void {
    const controller = this.controller;
    if (!controller || dt <= 0) return;
    this.longitudinalForceSum = 0;
    this.ownTyreCapacityN = 0;
    let carDigWeight = 0;

    this.chassisBody.rotation(this.rotationScratch);
    const loadBlend = dt / (WHEEL_LOAD_TAU + dt);
    // Grip leaves slowly and comes back quickly: see SLIDE_ONSET_TAU.
    const slideOnsetBlend = dt / (SLIDE_ONSET_TAU + dt);
    const slideRecoverBlend = dt / (SLIDE_RECOVER_TAU + dt);

    const spinCeiling = this.drivetrain.maxDrivenWheelSpinRadS;
    // The crank and flywheel a driven wheel has to drag round with it, geared up by
    // the square of the ratio. See `Drivetrain.drivenWheelInertiaKgM2`: without it a
    // driven wheel is a bare disc and every dip in load is an instant wheelspin.
    const drivelineInertia = this.drivetrain.drivenWheelInertiaKgM2(
      this.frontDrivenCount + this.rearDrivenCount,
    );
    // Each wheel's own parked load (`w.staticLoadN`, set in `rebuild`) is the reference
    // both the μ(Fz) factor and the traction-control load gate are measured against.
    // It varies across the axles, because the weight does.

    for (const w of this.wheels) {
      const driven = w.isFront ? this.frontDrivenCount > 0 : this.rearDrivenCount > 0;
      const driveDirection = w.driveTorqueNm >= 0 ? 1 : -1;
      const driveProgressSpeed = Math.max(0, vehicleForwardSpeed * driveDirection);
      const steer = controller.wheelSteering(w.index) ?? 0;
      // Wheel-plane forward: chassis +Z yawed by the steering angle — the same
      // basis the wheel mesh is drawn in — taken into world space.
      rotateVector(w.forwardDir, this.rotationScratch, Math.sin(steer), 0, Math.cos(steer));

      // The ground this wheel is standing on, resolved ONCE for the whole wheel: the
      // capacity, the aid and the force curve all need it, and it used to be looked up
      // separately at each of them.
      const wheelGround = controller.wheelGroundObject(w.index);
      const surfaceType = this.physics.surfaces.lookupType(wheelGround ? wheelGround.handle : null);
      const surface = SURFACES[surfaceType];

      const inContact = controller.wheelIsInContact(w.index);
      let contactSpeed = 0;
      if (inContact) {
        // The rolling direction is the wheel plane projected onto the surface. On
        // flat ground this is unchanged. On a steep pothole wall it gains the
        // vertical component the contact patch actually travels along, so slip is
        // measured in the plane the tyre really works in.
        const normal = controller.wheelContactNormal(w.index, w.contactNormal);
        if (normal) {
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
        }
        const cp = controller.wheelContactPoint(w.index, w.contactPoint);
        if (cp) {
          this.chassisBody.velocityAtPoint(cp, w.contactVel);
          contactSpeed =
            w.contactVel.x * w.forwardDir.x +
            w.contactVel.y * w.forwardDir.y +
            w.contactVel.z * w.forwardDir.z;
        }
      }

      // Ray-cast suspension load spikes over trimesh seams, so it is low-passed
      // before it is allowed to size a friction budget.
      const rawLoad = inContact ? Math.max(0, controller.wheelSuspensionForce(w.index) ?? 0) : 0;
      w.loadN += (rawLoad - w.loadN) * loadBlend;

      // A wheel is a disc, and a bigger wheel is a heavier one: mass scales with
      // radius², inertia with mass·radius². A DRIVEN wheel also has to turn the
      // engine, which through the gears is the larger half of the total in the low
      // gears — and the reason a bump cannot flick it into a spin.
      const wheelMass = WHEEL_MASS_KG * (w.radius / WHEEL_REFERENCE_RADIUS) ** 2;
      const inertia = 0.5 * wheelMass * w.radius * w.radius + (driven ? drivelineInertia : 0);

      // The longitudinal capacity, from the load this corner is carrying and the
      // coefficient of the ground under it. It sizes both the force the tyre may make
      // and, on loose ground, the dig.
      let capacityN = 0;
      // Cleared before the capacity block rather than inside it: a wheel that has left
      // the ground has no dig on it, and the last value would otherwise keep firm sand's
      // rolling resistance under a wheel that is not touching anything.
      w.digWeight = 0;
      if (w.loadN > 0) {
        const loadFactor = clamp(
          1 - LOAD_SENSITIVITY * (w.loadN / w.staticLoadN - 1),
          LOAD_SENSITIVITY_MIN,
          LOAD_SENSITIVITY_MAX,
        );
        let longitudinalMu = surface.longitudinalMu * wheelGrip * tyreGrip * loadFactor;
        // THE DIG — see the block comment on `DIG_FIRM_MU`. Sand only, and driven wheels
        // only: on a car with a driven front axle the dig firms both, which is the same
        // concession applied to the wheels doing the work.
        //
        // Gate on the CAR'S SPEED, not the wheel's. `driveProgressSpeed` is the car's
        // own speed along the intended direction of travel, floored at zero, so a car
        // being dragged backwards down a dune still counts as stopped and still digs.
        if (driven && w.driveTorqueNm !== 0 && DIG_SURFACES.has(surfaceType)) {
          const fadeT = clamp(
            (driveProgressSpeed - DIG_FULL_MPS) / (DIG_GONE_MPS - DIG_FULL_MPS),
            0,
            1,
          );
          const digWeight = 1 - fadeT * fadeT * (3 - 2 * fadeT);
          longitudinalMu = Math.max(longitudinalMu, DIG_FIRM_MU * digWeight * loadFactor);
          w.digWeight = digWeight;
          if (digWeight > carDigWeight) carDigWeight = digWeight;
        }
        // THE LOW RANGE — see the block comment on `LOW_RANGE_MU`. The road deck only, and
        // driven wheels only. Applied AFTER the dig, and below its 1.6, so on loose ground
        // the dig's own figure still governs and sand is unchanged to the digit.
        if (driven && w.driveTorqueNm !== 0 && LOW_RANGE_SURFACES.has(surfaceType)) {
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
        if (inContact) this.ownTyreCapacityN += capacityN;
      }

      // Drive torque spins the wheel up. Nothing is taken away from it: the tyre model
      // below decides what the contact can actually transmit, and a wheel that spins
      // past its peak simply makes less force — see the slip curve. There is no traction
      // control here, deliberately; see the note where its constants used to be.
      let spin = w.spinRadS + (dt * w.driveTorqueNm) / inertia;

      const brakeDelta = (dt * w.brakeForceN * w.radius) / inertia;
      if (Math.abs(spin) <= brakeDelta) spin = 0;
      else spin -= Math.sign(spin) * brakeDelta;

      let longitudinalForce = 0;
      let gripUsage = 0;
      if (capacityN > 0) {
        const reference = Math.max(Math.abs(contactSpeed), SLIP_REFERENCE_MPS);

        // Shape: a peak that decays to a SLIDING PLATEAU, not to nothing.
        //
        // The first version was the tidy 2u/(1+u²), which decays like 1/u. Measured,
        // that car could not pull away at all (0 km/h after 20 s of full throttle): a
        // standing start runs slip ≈ 3, i.e. u ≈ 25, where that curve delivers 8% of
        // the tyre's grip. A sliding tyre keeps roughly three quarters of its peak,
        // so the plateau term carries the force once the peak term has decayed.
        // The surface's OWN peak-slip ratio, not one constant for the world. On sand
        // that is 0.3 against asphalt's 0.12: the same tyre, shearing a material that
        // has to move a great deal further before it pushes back.
        const optimalSlip = surface.optimalSlip;
        const slipOf = (omega: number): number => (omega * w.radius - contactSpeed) / reference;
        const forceOf = (slip: number): number => {
          const u = slip / optimalSlip;
          const peak = (2 * u) / (1 + u * u);
          const slide = Math.tanh(SLIDE_CURVE_GAIN * u);
          return capacityN * ((1 - SLIDING_GRIP_FRACTION) * peak + SLIDING_GRIP_FRACTION * slide);
        };

        // Damping uses the curve's own slope, clamped to the rising side: past the
        // peak it goes negative, and feeding that back drives the wheel away from
        // equilibrium instead of toward it.
        const u0 = slipOf(spin) / optimalSlip;
        const th = Math.tanh(SLIDE_CURVE_GAIN * u0);
        const slopeU =
          (1 - SLIDING_GRIP_FRACTION) * ((2 * (1 - u0 * u0)) / ((1 + u0 * u0) * (1 + u0 * u0))) +
          SLIDING_GRIP_FRACTION * SLIDE_CURVE_GAIN * (1 - th * th);
        const stiffness =
          (capacityN * Math.max(0, slopeU) * w.radius) / (optimalSlip * reference);

        const spin0 = spin;
        const force0 = forceOf(slipOf(spin0));
        let delta = -(dt * force0 * w.radius) / (inertia + dt * stiffness * w.radius);

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
        // action and reaction equal on the step the projection binds — which is
        // exactly the step where a gripping tyre is transmitting everything the
        // engine sent it, and where deriving the force from the post-step slip would
        // instead report zero.
        longitudinalForce = clamp((-inertia * delta) / (dt * w.radius), -capacityN, capacityN);
        spin = spin0 - (longitudinalForce * dt * w.radius) / inertia;
        gripUsage = Math.abs(longitudinalForce) / capacityN;
      }

      // Geared to the engine, so it cannot outrun the engine's redline.
      if (driven && spinCeiling !== Infinity) spin = clamp(spin, -spinCeiling, spinCeiling);

      w.spinRadS = spin;
      w.drawnSpin += spin * dt;
      w.longitudinalCapacityN = capacityN;
      w.longitudinalForceN = longitudinalForce;

      const reference = Math.max(Math.abs(contactSpeed), SLIP_REFERENCE_MPS);
      w.slipRatio = (spin * w.radius - contactSpeed) / reference;
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
      // what the longitudinal channel has left over — a real friction ellipse on this
      // tyre's own usage, so drive and brake take their share of one budget.
      //
      // The ellipse is the real one, read against the force this SAME tick's
      // longitudinal pass just computed — which is why `gripUsage` above is a local
      // rather than the wheel's published field. Its lateral term is floored at
      // ELLIPSE_LATERAL_FLOOR purely so a locked wheel is not a numerical castor; see
      // the constant.
      //
      // Applied at the contact patch's POSITION but at the centre of mass' HEIGHT, and
      // that is deliberate. The yaw geometry is what matters for balance and it is
      // exact either way; the roll lever is not, because this suspension has almost no
      // roll stiffness of its own — measured, the full moment at the patch rolled a
      // 33 km/h turn to 81 degrees and laid the car on its side. Roll therefore stays
      // with the calibrated couple in `applyRollCouple`, which exists for exactly this
      // reason and is now the only thing supplying it.
      let lateralForceN = 0;
      if (inContact && w.lateralCapacityN > 0) {
        const ellipse = Math.max(
          ELLIPSE_LATERAL_FLOOR,
          Math.sqrt(Math.max(0, 1 - gripUsage * gripUsage)),
        );
        const capacityImpulse = w.lateralCapacityN * ellipse * dt;
        const curveImpulse = capacityImpulse * w.lateralShape;
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
        // Below LATERAL_STATIC_SPEED_MPS the tyre is therefore allowed to spend its
        // whole remaining capacity on simply stopping the slide, which is what static
        // friction does. It is still bounded by that capacity, so a hard enough shove
        // still slides the car.
        const staticBlend = clamp(1 - Math.abs(contactSpeed) / LATERAL_STATIC_SPEED_MPS, 0, 1);
        const staticImpulse = Math.min(capacityImpulse, stopImpulse) * staticBlend;
        const magnitude = Math.min(stopImpulse, Math.max(curveImpulse, staticImpulse));
        lateralForceN = magnitude / dt;
        const impulse = -Math.sign(w.lateralSpeed) * magnitude;
        if (impulse !== 0) {
          this.tyreImpulse.x = w.lateralRightX * impulse;
          this.tyreImpulse.y = w.lateralRightY * impulse;
          this.tyreImpulse.z = w.lateralRightZ * impulse;
          this.lateralPoint.x = w.contactPoint.x;
          // The CENTRE OF MASS' height, not the body origin's. `translation()` is the
          // origin, which sits COM_DROP_FRACTION of the half-height ABOVE the centre of
          // mass — so applying the side force there gave every corner a roll moment
          // INTO the turn worth `m · a · 0.45 · halfHeight`, cancelling nearly half of
          // the couple `applyRollCouple` had just been asked to restore. Measured: 2.6
          // degrees of lean at 0.6 g where the roll stiffness says 5.8. At the centre
          // of mass the side force carries no roll moment at all, which is the whole
          // point of applying it here: the roll couple is then the only thing supplying
          // one, and it is calibrated.
          this.lateralPoint.y = this.chassisBody.worldCom().y;
          this.lateralPoint.z = w.contactPoint.z;
          this.chassisBody.applyImpulseAtPoint(this.tyreImpulse, this.lateralPoint, false);
          // Aligning moment. The force acts PNEUMATIC_TRAIL_M behind the contact
          // centre, so it carries a moment about the vertical of exactly
          // -trail * impulse — the cross product collapses to that because forward and
          // right are orthogonal unit vectors in the ground plane. Summed over the
          // wheels this is the car's yaw damping.
          this.alignTorqueImpulse -= PNEUMATIC_TRAIL_M * impulse;
        }

        // LOOSE-SURFACE PLOUGHING. Cornering grip stays low on sand, but a tyre
        // travelling substantially sideways builds a bank of material against its
        // sidewall. That force is drag, not extra steering grip: it wakes only at
        // large lateral speed and cannot reverse the slide within this step.
        //
        // Apply it at the real contact patch rather than the COM-height point above.
        // The low application point is the trip mechanism of a broadside sand skid:
        // the vehicle sheds energy quickly and the body can carry on over the tyres.
        const deformationDrag = SURFACES[w.groundSurface].deformationDrag;
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
      if (inContact && w.loadN > 0) {
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
      } else {
        // Airborne: the carcass relaxes towards free length rather than storing the
        // last bump until the landing.
        w.hopZ *= 0.5;
        w.hopV *= 0.5;
      }

      // BUMP STOP. Rapier's travel limit is a rigid clamp; a real stop is rubber that
      // starts taking load before the end and stiffens as it crushes (see
      // BUMP_STOP_FRACTION). Without it the soft springs this car now runs would hand
      // every big hit to the solver as a step.
      const length = controller.wheelSuspensionLength(w.index) ?? w.restLengthM;
      w.compressionM = w.restLengthM - length;
      // The stop lives in the BUMP travel — the compression available past static sag
      // — and not in the total. Measured against the total it sat below the sag of
      // every soft car in the catalogue, so a parked Zhiguli rested on its bump stops
      // and rang at 1.76 Hz instead of the 1.10 its springs were cut for.
      const bumpTravel = w.maxTravelM - w.sagM;
      const stopBegins = w.sagM + bumpTravel * (1 - BUMP_STOP_FRACTION);
      w.bumpStopN = 0;
      if (inContact && w.compressionM > stopBegins) {
        const into = Math.min(1, (w.compressionM - stopBegins) / (w.maxTravelM - stopBegins));
        w.bumpStopN = BUMP_STOP_PEAK * w.staticLoadN * into * into;
        rotateVector(this.microUp, this.rotationScratch, 0, w.bumpStopN * dt, 0);
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
      // power dissipated at the contact patch, against the heat the air takes away.
      //
      // `spin` is the post-force wheel rate, so a locked wheel reports the full road
      // speed as slip and a rolling one reports almost none — which is exactly the
      // difference between a tyre being dragged and one being driven.
      const slipSpeedLong = Math.abs(spin * w.radius - contactSpeed);
      const rollingForceN = w.loadN * SURFACES[w.groundSurface].rollingResistance;
      const slipPowerW =
        (Math.abs(longitudinalForce) * slipSpeedLong +
          lateralForceN * Math.abs(w.lateralSpeed)) *
          TYRE_SLIP_HEAT_SHARE +
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

    this.digWeightCar = carDigWeight;

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
      s.slideT = w.slideT;
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
    if (this.controller) {
      this.controller.free();
      this.controller = null;
    }
    this.physics.removeBody(this.chassisBody);
    this.clearVisuals();
    this.scene.remove(this.rootGroup);
  }

  // ---------------------------------------------------------------------------
  // Internals.
  // ---------------------------------------------------------------------------

  /**
   * The car's mass, as its own kerb weight plus everything that has since changed.
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
   */
  private computeStats(): CarStats {
    const installedEngine = bonnetPart(this.car.bonnet, 0);
    const engine = installedEngine
      ? variant(installedEngine.variantId).engine ?? modelEngine(this.model)
      : modelEngine(this.model);

    const stock = stockBonnetVariants(
      this.model.engineId,
      this.model.bodyClass,
      this.model.tankLitres,
    );
    let mass = this.model.mass;

    // Service parts. Cell order is engine, turbine, radiator, tank; the turbine's
    // factory state is EMPTY, so anything fitted there is pure addition.
    const stockByCell = [stock.engine, null, stock.radiator, stock.tank] as const;
    for (let cell = 0; cell < BONNET_SLOT_COUNT; cell++) {
      const part = bonnetPart(this.car.bonnet, cell);
      const fitted = part ? variant(part.variantId).mass : 0;
      const stockId = stockByCell[cell];
      mass += fitted - (stockId === null ? 0 : variant(stockId).mass);
    }

    // Fuel, water and oil, measured against full reservoirs. `fuelKind` decides the
    // density, and a mixture weighs as the heavier of the two it could be.
    mass += (this.car.fuelLitres - this.model.tankLitres) * fuelDensity(this.car.fuelKind);
    mass += this.car.waterLitres - stockRadiatorWater(stock.radiator);
    mass += (this.car.oilLitres - oilCapacity(engine)) * FLUID_DENSITY_OIL;

    // Cargo: the boot's own cells, and whatever the driver brought with them.
    for (const item of this.car.storage) if (item) mass += itemMass(item);
    mass += this.carriedMassKg;

    return {
      mass: Math.max(1, mass),
      engine,
      gearbox: modelGearbox(this.model),
      fuel: engine.fuel,
      tankCapacity: this.model.tankLitres,
      wheelCount: this.measure.wheels.length,
      wheelGrip: this.model.wheelGrip,
      hasHeadlights: true,
    };
  }

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
   * A full `rebuild` would also work and would also free and recreate the vehicle
   * controller, the drivetrain binding and every mesh — which is far too much to do
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
    this.applyChassisMass(this.statsValue.mass);
    this.reloadSprings();
  }

  /**
   * Re-sizes every spring and damper for the mass the car is now carrying.
   *
   * THE RATES ARE ABSOLUTE, and that is the whole reason a load is felt at all.
   * Rapier's ray-cast spring is `stiffness * compression * chassis_mass`, so a
   * per-kilogram figure — which is what the catalogue's ride frequencies convert to —
   * gives a car that sags to exactly the same ride height whether it is empty or
   * carrying four hundred kilograms of engine. The spring rate a real car has does not
   * change when you put something in the boot, so the rate is stored in newtons per
   * metre and divided by the mass here: the same spring, now carrying more, sits lower
   * and rings slower, and the bump stop arrives correspondingly sooner.
   *
   * The rates themselves come from the ride frequency at the KERB mass, so a stock car
   * still sits and rides exactly where its preset says.
   */
  private reloadSprings(): void {
    if (!this.controller) return;
    const stats = this.statsValue;
    const weightN = stats.mass * GRAVITY;
    const suspension = this.model.suspension;
    const axles = this.axleGeometry;

    for (const w of this.wheels) {
      const axleShare = w.isFront ? axles.frontWeightShare : 1 - axles.frontWeightShare;
      const axleCount = w.isFront ? axles.frontCount : axles.rearCount;
      const cornerShare = axleShare / Math.max(1, axleCount);
      const hz = w.isFront ? suspension.frontHz : suspension.rearHz;
      const compressionRatio = suspension.compressionRatio;
      const reboundRatio = suspension.reboundRatio;

      // Sized at the kerb load, then asked to carry the real one.
      const designCornerMass = this.model.mass * cornerShare;
      const staticLoadN = Math.max(1, weightN * cornerShare);
      w.staticLoadN = staticLoadN;
      w.springRateNPerM = wheelSpringRateAbs(hz, designCornerMass);
      w.compressionRateNsPerM = wheelDampingRateAbs(hz, compressionRatio, designCornerMass);
      w.relaxationRateNsPerM = wheelDampingRateAbs(hz, reboundRatio, designCornerMass);

      // Ride frequency is no longer a preset constant once the car is loaded, so it is
      // measured rather than assumed: this is what an instrument would read.
      const cornerMass = staticLoadN / GRAVITY;
      w.rideHz = Math.sqrt(w.springRateNPerM / Math.max(1, cornerMass)) / (2 * Math.PI);
      w.sagM = staticLoadN / w.springRateNPerM;
      w.maxTravelM = w.sagM + suspension.bumpTravel;

      this.controller.setWheelSuspensionStiffness(w.index, w.springRateNPerM / stats.mass);
      this.controller.setWheelSuspensionCompression(
        w.index,
        w.compressionRateNsPerM / stats.mass,
      );
      this.controller.setWheelSuspensionRelaxation(
        w.index,
        w.relaxationRateNsPerM / stats.mass,
      );
      this.controller.setWheelMaxSuspensionTravel(w.index, w.maxTravelM);
      this.controller.setWheelSuspensionRestLength(
        w.index,
        w.sagM + MOUNT_ABOVE_WHEEL_CENTRE,
      );
      this.controller.setWheelMaxSuspensionForce(
        w.index,
        SUSPENSION_FORCE_HEADROOM * staticLoadN,
      );
    }
  }

  /**
   * Returns the steering angle a wheel actually presents to the road. Bump-steer is
   * asymmetric by wheel side; the rack angle remains the driver's commanded state.
   */
  private wheelSteerAngle(w: WheelVisual): number {
    return w.isFront ? this.steerAngle + w.sideSign * this.bumpSteerAngle : 0;
  }

  /**
   * Lets the road talk through the worn front end. A load difference across the front
   * axle means one wheel has climbed or dropped relative to the other. The disturbance
   * is stronger on rough surfaces and at speed, where a small toe change becomes a
   * visible lateral lurch. It is filtered in time, not replaced with random steering,
   * so the same pothole produces the same correction and a smooth road stays calm.
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
      const roughFactor = clamp(
        roughness / roughWheels / BUMP_STEER_FULL_ROUGHNESS,
        0.25,
        1.4,
      );
      const speedFactor = clamp((speedKmh - 12) / 73, 0, 1);
      target = loadImbalance * this.handling.bumpSteer * roughFactor * speedFactor;
    }
    const blend = 1 - Math.exp(-dt / BUMP_STEER_TAU);
    this.bumpSteerAngle += (target - this.bumpSteerAngle) * blend;
  }

  /**
   * The anti-roll bars (see ANTI_ROLL_FRONT_FRACTION).
   *
   * A bar is a torsion spring between the two wheels of one axle, so it is loaded by
   * their DIFFERENCE in travel and by nothing else: it adds roll stiffness without
   * adding ride stiffness, which is exactly what a soft-sprung car needs to corner
   * without running its outer springs into the bump stops.
   *
   * Implemented as the pair of equal and opposite vertical forces the real bar applies
   * at the two wheels, so nothing about it is a torque fudge: the more compressed side
   * is pushed down and the other pulled up, at the contact points, and the moment that
   * results is the bar's own. It carries no damping, because a bar has none worth
   * modelling.
   *
   * Runs after `updateWheelDynamics`, which is where `compressionM` is read off the
   * controller. An axle with a wheel in the air contributes nothing — a bar needs both
   * ends on the ground to have a difference worth resisting.
   */
  private applyAntiRollBars(dt: number): void {
    for (let axle = 0; axle < 2; axle++) {
      const front = axle === 0;
      let leftSum = 0;
      let rightSum = 0;
      let leftCount = 0;
      let rightCount = 0;
      let groundedBoth = true;
      let rate = 0;
      for (const w of this.wheels) {
        if (w.isFront !== front) continue;
        if (!w.grounded) groundedBoth = false;
        if (w.sideSign < 0) {
          leftSum += w.compressionM;
          leftCount++;
        } else {
          rightSum += w.compressionM;
          rightCount++;
        }
        // The bar is sized against its own axle's wheel rate, in N/m.
        rate = w.springRateNPerM;
      }
      if (!groundedBoth || leftCount === 0 || rightCount === 0) continue;
      const leftMean = leftSum / leftCount;
      const rightMean = rightSum / rightCount;
      if (leftMean === rightMean) continue;

      const fraction = front ? ANTI_ROLL_FRONT_FRACTION : ANTI_ROLL_REAR_FRACTION;
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
        rotateVector(this.microUp, this.rotationScratch, 0, gain * (own - other) * dt, 0);
        this.chassisBody.applyImpulseAtPoint(this.microUp, w.contactPoint, false);
      }
    }
  }

  /**
   * Puts the cornering roll couple back (see the ROLL_COUPLE_GAIN note above).
   *
   * Lateral acceleration is measured in the car's own frame, and it needs BOTH
   * terms: the change in body-frame sideways velocity *and* the centripetal term
   * `yawRate * forwardSpeed`. Differencing alone reads ~0 in a steady circle —
   * body-frame sideways velocity is constant there while the world velocity vector
   * swings around — so a car would lean into a corner and then stand back up
   * mid-bend. With the centripetal term it holds its lean as long as it holds the
   * radius, which is what a real one does.
   *
   * The result is low-passed, clamped, and applied as a torque impulse about the
   * car's forward axis with the centre of mass' height above the contact plane as
   * the lever. Sign follows the physics: accelerating towards +X (left) rolls the
   * body to the right, a positive rotation about +Z.
   *
   * Skipped with no wheel on the ground — an airborne car has nothing to lean
   * against.
   */
  private applyRollCouple(dt: number, mass: number, contactCount: number): void {
    this.chassisBody.linvel(this.linvel);
    this.chassisBody.rotation(this.rotationScratch);

    // Body-frame velocity: rotate the world velocity by the inverse rotation.
    this.invRotationScratch.x = -this.rotationScratch.x;
    this.invRotationScratch.y = -this.rotationScratch.y;
    this.invRotationScratch.z = -this.rotationScratch.z;
    this.invRotationScratch.w = this.rotationScratch.w;
    rotateVector(
      this.localVelScratch,
      this.invRotationScratch,
      this.linvel.x,
      this.linvel.y,
      this.linvel.z,
    );
    const latVel = this.localVelScratch.x;
    const fwdVel = this.localVelScratch.z;

    // Yaw rate in the body frame, for the centripetal term.
    const angvel = this.chassisBody.angvel();
    rotateVector(this.localAngScratch, this.invRotationScratch, angvel.x, angvel.y, angvel.z);
    const yawRate = this.localAngScratch.y;

    if (!this.rollPrimed) {
      this.rollPrimed = true;
      this.prevLatVel = latVel;
      return;
    }
    const rawAccel = (latVel - this.prevLatVel) / dt + yawRate * fwdVel;
    this.prevLatVel = latVel;
    const k = 1 - Math.exp(-dt / ROLL_ACCEL_TAU);
    this.rollAccel += (rawAccel - this.rollAccel) * k;

    if (contactCount === 0) return;

    // Current lean: the body's own left axis tilted out of horizontal. Positive
    // means the left side is up, i.e. the car is leaning right.
    rotateVector(this.leanScratch, this.rotationScratch, 1, 0, 0);
    const leanSin = clamp(this.leanScratch.y, -1, 1);
    const limitSin = Math.sin((ROLL_LIMIT_DEG * Math.PI) / 180);
    const accel = clamp(this.rollAccel, -ROLL_ACCEL_MAX * GRAVITY, ROLL_ACCEL_MAX * GRAVITY);

    // Fade the couple out as the lean approaches the limit, but only in the
    // direction that would deepen it: a car already leaning hard must still be able
    // to be pushed back upright by the opposite corner.
    const deepening = Math.sign(accel) === Math.sign(leanSin) || leanSin === 0;
    const fade = deepening ? Math.max(0, 1 - Math.abs(leanSin) / limitSin) : 1;

    const half = this.measure.halfExtents;
    const rollInertia = INERTIA_ROLL_GAIN * (mass / 3) * (half[0] * half[0] + half[1] * half[1]);
    const rollRate = this.localAngScratch.z;
    const torque =
      (mass * accel * this.rollLeverArm * ROLL_COUPLE_GAIN * fade -
        rollInertia * ROLL_RATE_DAMPING * rollRate) *
      dt;
    rotateVector(this.forceScratch, this.rotationScratch, 0, 0, torque);
    this.chassisBody.applyTorqueImpulse(this.forceScratch, true);
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
   * Front is +Z (the controller's forward axis), so `frontZ` is the mean mount Z of
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

  private applyChassisMass(mass: number): void {
    const half = this.measure.halfExtents;
    const hx = half[0];
    const hy = half[1];
    const hz = half[2];
    // Solid-box principal inertias about the centre, scaled by mass and then by the
    // gains above: x is pitch, y is yaw, z is roll.
    const inertia = {
      x: INERTIA_PITCH_YAW_GAIN * (mass / 3) * (hy * hy + hz * hz),
      y: INERTIA_PITCH_YAW_GAIN * (mass / 3) * (hx * hx + hz * hz),
      z: INERTIA_ROLL_GAIN * (mass / 3) * (hx * hx + hy * hy),
    };
    // WHERE THE MASS SITS ALONG THE CAR. A front weight fraction f puts the centre of
    // mass f of the way from the rear axle to the front one, which is the definition
    // of the fraction and the only placement that makes the axle loads come out at
    // f and 1-f. Front-drive cars therefore genuinely carry their nose, and the
    // static loads every grip calculation is referenced against are the real ones.
    const axles = this.axleGeometry;
    const comZ = axles.rearZ + axles.frontWeightShare * (axles.frontZ - axles.rearZ);
    this.chassisBody.setAdditionalMassProperties(
      mass,
      { x: 0, y: -COM_DROP_FRACTION * hy, z: comZ },
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
    // Make mass() current immediately so the vehicle controller's suspension
    // (which reads chassis.mass() each step) sees the new value on the next tick.
    this.chassisBody.recomputeMassPropertiesFromColliders();
  }

  /**
   * Instantiates the model: body into the chassis group, wheels held aside for
   * `rebuild` to register with the controller.
   */
  private buildVisuals(): void {
    const instance = createCarModel(this.model.id, this.car.id);
    this.rootGroup.add(instance.body);
    this.bodyGroup = instance.body;
    this.bodyRestScale.copy(instance.body.scale);

    // The body subtree is cloned per vehicle, so this node belongs to this car and
    // turning it cannot turn anybody else's wheel.
    this.steeringWheel = instance.body.getObjectByName(STEERING_WHEEL_NODE) ?? null;
    this.steeringWheelRest = this.steeringWheel?.rotation.y ?? 0;

    this.wheelMeshes.clear();
    for (const [id, mesh] of instance.wheels) this.wheelMeshes.set(id, mesh);

    this.lamps.build(this.measure.halfExtents, this.contactPlaneY);

    // After the lamp mounts on purpose: beams are aimed from the authored lamp
    // bounds, so a crumpled nose bends its lamps without swinging its beams.
    this.surface = instance.surface;
    this.surface.setCondition(this.localBodyDirt, this.localBodyScratches);
    this.surface.setDents(this.car.dents);
  }

  /** Releases per-instance lamp materials and detaches the model-owned visual tree. */
  private clearVisuals(): void {
    this.lamps.clear();
    this.surface?.dispose();
    this.surface = null;
    for (const child of this.rootGroup.children.slice()) this.rootGroup.remove(child);
    this.bodyGroup = null;
    this.bodyRestScale.set(1, 1, 1);
    this.wheelMeshes.clear();
    this.steeringWheel = null;
    this.steeringWheelRest = 0;
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
