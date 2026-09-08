/** Fixed-step road follower. Inputs remain ordinary InputFrame commands. */
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { ROAD_HALF_WIDTH, type Road } from '../world/road';
import { HazardIndex, type RoadHazard } from '../world/hazards';
import type { Vehicle } from './vehicle';

export type AutopilotMode = 'sleeper' | 'frantic';

interface ModeConfig {
  readonly cruiseMps: number;
  readonly lateralAccel: number;
  readonly brakeAccel: number;
  readonly lookaheadBase: number;
  readonly lookaheadSpeed: number;
  readonly hazardMargin: number;
  readonly brakeLead: number;
  readonly curveLead: number;
}

/**
 * Period tyres can sustain more than this, but using roughly half their envelope
 * gives the car time to settle before a bend instead of arriving on the limit.
 * Frantic remains faster through every curve while retaining a useful safety margin.
 */
const MODES: Record<AutopilotMode, ModeConfig> = {
  sleeper: { cruiseMps: 20, lateralAccel: 3.6, brakeAccel: 4.2, lookaheadBase: 11, lookaheadSpeed: 1.35, hazardMargin: 1.4, brakeLead: 18, curveLead: 30 },
  frantic: { cruiseMps: 28, lateralAccel: 5.0, brakeAccel: 6.4, lookaheadBase: 9, lookaheadSpeed: 1.0, hazardMargin: 0.45, brakeLead: 7, curveLead: 24 },
};
/**
 * Steering is geometric. `Vehicle` interprets input as a fraction of the model's
 * steering lock, so a preview heading error cannot be sent directly as normalized
 * input. Pure pursuit computes the curvature of a waypoint and converts it to the
 * actual front-wheel angle before normalizing it.
 */
const DEFAULT_WHEELBASE_M = 2.6;
const MIN_PURSUIT_DISTANCE_SQ = 9;
/**
 * How much of a bend may be previewed, radians of arc, and the shortest preview the
 * steering stays stable with. See the cap in `drive`.
 */
const LOOKAHEAD_ARC_RAD = 0.5;
const MIN_LOOKAHEAD_M = 6;
// These mirror Vehicle's input-to-road-wheel path. Pure pursuit must cross the
// steering-box play window without turning a small, valid curvature into full lock.
const STEER_INPUT_EXPONENT = 1.35;
const STEER_PLAY_RAD = 0.024;
const STEER_FULL_LOCK_KMH = 20;
const STEER_REDUCED_KMH = 100;
const STEER_HIGH_SPEED_FRACTION = 0.5;
const STEER_LOCK_CURVE = 0.161;
/**
 * Half the widest catalogue body, metres, plus a little. Used only to decide whether
 * a hazard is in this car's corridor; a per-model figure would make the decision
 * differ between cars for no gain, and being slightly pessimistic is free.
 */
const CAR_HALF_WIDTH_M = 1.05;
/** Keeps the avoidance line until the whole vehicle has cleared the prop. */
const CAR_HALF_LENGTH_M = 3;
/**
 * Extra metres the middle avoidance rung asks for beyond bare body clearance, and the
 * fraction of that clearance the braking corridor is measured at. Together they
 * guarantee that a line the planner picks is outside the corridor that caused the
 * braking, which is what stops the two from deadlocking.
 */
const AVOID_HYSTERESIS_M = 0.4;
/** A valid indexed detour must keep rolling or its rate-limited line can never finish. */
const AVOIDANCE_CRAWL_MPS = 3.5;
/** Physics rays begin ahead of the chassis, so their range differs from road-frame s. */
const INDEXED_RAY_MATCH_M = 4;
const BLOCK_CORRIDOR_FRACTION = 0.8;
const CENTERLINE_PULL = 0.4;
const TURN_CURVATURE_SAMPLES = 8;
const TURN_COAST_CURVATURE = 0.004;
const TURN_COAST_STEER = 0.12;
const TURN_COAST_MIN_SPEED_MPS = 5;
/**
 * Metres the commanded line may move per metre travelled. 0.09 spends about 40 m of
 * road moving a full lane across, which is what a driver does when they see a rock
 * early — and slow enough that a replan cannot present the loop with a step.
 */
const LINE_SHIFT_PER_METRE = 0.09;
/**
 * VERGE the autopilot is allowed to put a wheel on, metres beyond the asphalt.
 *
 * The road lost its gravel shoulders when it was narrowed to its old side markings,
 * and taking the shoulder out of these two numbers with it was a mistake: the graded
 * desert immediately outside the asphalt is solid drivable ground, but the planner
 * treated the paint as a wall. A rock of 1.5 m radius near the centreline then had no
 * detour that fitted, so `mustStop` latched and the car sat in front of it — measured
 * by tools/autopilot-bench.ts, which went from a 17 m/s cruise to 1.1 m/s, and seen
 * in play as an autopilot that stopped dead on an empty road.
 *
 * 1.2 m is one wheel plus a little: enough to squeeze past a boulder, not enough to
 * count as leaving the road, and the terrain there is flush with the asphalt edge
 * (world/terrain.ts) so a pass costs nothing but grip.
 */
const PASSING_VERGE_M = 1.2;
const PASSING_EDGE = ROAD_HALF_WIDTH + PASSING_VERGE_M;
const OFFROAD_RECOVERY_EDGE = PASSING_EDGE;
const OFFROAD_RECOVERY_LINE = ROAD_HALF_WIDTH - CAR_HALF_WIDTH_M - 0.2;
const OFFROAD_SPEED_MPS = 8;
const OFFROAD_BRAKE_MAX = 0.35;
const STUCK_SPEED_MPS = 1 / 3.6;
const STUCK_AFTER_S = 3;
const RECOVERY_REVERSE_S = 2;
const DYNAMIC_RANGE = 18;

export class Autopilot {
  private modeValue: AutopilotMode = 'sleeper';
  private engagedValue = false;
  private hintS = 0;
  private stoppedFor = 0;
  private reverseFor = 0;
  /** Alternates when stuck on the centreline; off-centre recovery turns toward escape. */
  private recoverySteer = 1;
  private hazard: RoadHazard | null = null;
  private hazardDistance = Infinity;
  private dynamicDistance = Infinity;
  /**
   * The hazard currently being avoided and the line chosen for it.
   *
   * Latched, and that is the whole point. Replanning every tick made the car swerve
   * continuously on a real road: in-asphalt scatter is frequent, so the NEAREST
   * hazard changed every few seconds, the side preference flipped with it, and the
   * moment one was passed the target snapped back to the centreline — into the line
   * of the next one. A plan is kept until its hazard is behind the car.
   */
  private plannedHazard: RoadHazard | null = null;
  private plannedLateral = 0;
  /** Line actually commanded, rate-limited toward `plannedLateral`. */
  private appliedLateral = 0;
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  /** Car lateral at the time of the scan; a hazard off to one side is not a hazard. */
  private scanLateral = 0;
  private readonly visitHazard = (hazard: RoadHazard): void => {
    const distance = hazard.s - this.hintS;
    if (distance >= this.hazardDistance) return;
    // The intended line matters as much as the current line: after avoiding one prop,
    // the next prop may be on the detour rather than on the centreline.
    const reach = hazard.radius + CAR_HALF_WIDTH_M + AVOID_HYSTERESIS_M;
    const inCurrentPath = Math.abs(hazard.lateral - this.scanLateral) < reach;
    const inPlannedPath = Math.abs(hazard.lateral - this.plannedLateral) < reach;
    if (!inCurrentPath && !inPlannedPath) return;
    this.hazard = hazard;
    this.hazardDistance = distance;
  };
  /** Clears the nearest-hazard result before a scan. See the note in `drive`. */
  private beginHazardScan(lateral: number): void {
    this.hazard = null;
    this.hazardDistance = Infinity;
    this.scanLateral = lateral;
  }


  constructor(
    private readonly road: Road,
    private readonly hazards: HazardIndex,
    /** Optional only until Vehicle exposes its PhysicsWorld; main passes the shared world. */
    private readonly physics?: PhysicsWorld,
  ) {}

  get mode(): AutopilotMode { return this.modeValue; }
  setMode(mode: AutopilotMode): void { this.modeValue = mode; }
  get engaged(): boolean { return this.engagedValue; }
  setEngaged(engaged: boolean): void {
    this.engagedValue = engaged;
    this.stoppedFor = 0;
    this.reverseFor = 0;
    if (!engaged) {
      this.plannedHazard = null;
      this.plannedLateral = 0;
      this.appliedLateral = 0;
    }
  }

  /** Writes controls in-place using a geometric pure-pursuit waypoint. */
  drive(dt: number, vehicle: Vehicle, out: InputFrame, originX: number, originZ: number): void {
    if (!this.engagedValue) return;
    const config = MODES[this.modeValue];
    vehicle.absoluteTranslation(this.position);
    const projection = this.road.project(this.position.x, this.position.z, this.hintS);
    this.hintS = projection.s;
    const offRoad = Math.abs(projection.lateral) > OFFROAD_RECOVERY_EDGE;
    if (offRoad) {
      // A previous obstacle plan is no longer useful after an impact or flight into
      // the desert. Road recovery takes priority and starts from the nearest safe
      // road-edge line instead of trying to continue the old detour.
      this.plannedHazard = null;
      this.plannedLateral = 0;
      this.appliedLateral = 0;
    }
    const velocity = vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    // Pure pursuit aims at a point `lookahead` metres along the road. In a bend the
    // chord to that point cuts the apex, so a preview longer than the corner itself
    // steers the car inside the entry and then wide of the exit: measured on
    // tools/playground-lap.ts, a 30 m hairpin taken with 24 m of preview put a wheel
    // 1.1 m past the asphalt. Half a radian of arc is the most that can be previewed
    // before the chord stops describing the curve, so the preview is capped at
    // `0.5 / curvature` — no effect on a straight or a sweeper, decisive in a hairpin.
    const lookahead = Math.max(
      MIN_LOOKAHEAD_M,
      Math.min(
        config.lookaheadBase + speed * config.lookaheadSpeed,
        LOOKAHEAD_ARC_RAD / Math.max(Math.abs(this.road.curvatureAt(this.hintS)), 1e-4),
      ),
    );
    const target = this.road.sampleAt(this.hintS + lookahead);
    const rotation = vehicle.chassis.rotation();
    const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
    const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);


    this.beginHazardScan(projection.lateral);
    this.hazards.forEachAhead(
      this.hintS,
      Math.max(lookahead + 8, config.brakeLead + (speed * speed) / (2 * config.brakeAccel)),
      this.visitHazard,
    );
    this.dynamicDistance = this.dynamicObstacleDistance(vehicle, originX, originZ);
    const hazard = this.hazard;

    // Indexed road props are known much farther ahead than the short physics rays.
    // Include their distance in the same braking envelope so steering has time to
    // establish the detour before the car reaches the object.
    const obstacleDistance = Math.min(this.dynamicDistance, this.hazardDistance);
    let mustStop = this.dynamicDistance < 4;

    // Retire only after the REAR of the car has passed the far edge of the prop.
    // The old subtraction retired at the near edge, exactly while the car was
    // alongside it, and centreline guidance then steered back through the obstacle.
    const planned = this.plannedHazard;
    if (planned && planned.s + planned.radius + CAR_HALF_LENGTH_M < this.hintS) {
      this.plannedHazard = null;
      this.plannedLateral = 0;
    }
    if (!offRoad && hazard && (this.plannedHazard === null || hazard.s < this.plannedHazard.s)) {
      // Pick the smallest safe detour first, then decide about braking separately.
      // A full sleeper margin before the compact clearance pushed centre-lane rocks
      // to the road edge even when a modest lane change was enough.
      const bodyClearance = hazard.radius + CAR_HALF_WIDTH_M;
      const roadEdge = PASSING_EDGE - CAR_HALF_WIDTH_M;
      let line: number | null = null;
      const clearanceLevels = [
        bodyClearance + Math.min(config.hazardMargin, AVOID_HYSTERESIS_M),
        bodyClearance + config.hazardMargin,
        bodyClearance,
      ];
      for (const clearance of clearanceLevels) {
        const left = hazard.lateral + clearance;
        const right = hazard.lateral - clearance;
        const leftFits = Math.abs(left) <= roadEdge;
        const rightFits = Math.abs(right) <= roadEdge;
        if (!leftFits && !rightFits) continue;
        // Whichever side needs the smaller move from the line already being held,
        // so an off-centre hazard is passed without crossing the whole road and a
        // plan in progress is not thrown away for its mirror image.
        line =
          leftFits &&
          (!rightFits || Math.abs(left - this.appliedLateral) <= Math.abs(right - this.appliedLateral))
            ? left
            : right;
        break;
      }
      if (line === null) {
        mustStop = true;
      } else {
        this.plannedHazard = hazard;
        this.plannedLateral = line;
      }
    }
    const hasIndexedDetour = hazard !== null && this.plannedHazard === hazard;
    const rayMatchesIndexedHazard =
      hasIndexedDetour &&
      this.dynamicDistance < Infinity &&
      Math.abs(this.dynamicDistance - this.hazardDistance) <= INDEXED_RAY_MATCH_M;
    if (rayMatchesIndexedHazard) {
      // The short ray is seeing the same prop for which a clear line already exists.
      // Do not convert a controlled crawl into a full stop before the lateral move.
      mustStop = false;
    }

    // Ease onto the planned line instead of jumping to it. The waypoint itself is
    // shifted by the rate-limited line, so obstacle avoidance and road following use
    // one stable controller rather than fighting over the steering input.
    const lineRate = LINE_SHIFT_PER_METRE * Math.max(speed * dt, 0);
    this.appliedLateral += clamp(this.plannedLateral - this.appliedLateral, -lineRate, lineRate);
    const targetLateral = offRoad
      ? Math.sign(projection.lateral || 1) * OFFROAD_RECOVERY_LINE
      : this.plannedHazard === null
        ? this.appliedLateral + clamp(-projection.lateral * CENTERLINE_PULL, -1.5, 1.5)
        : this.appliedLateral;
    const waypointX = target.x + Math.cos(target.heading) * targetLateral;
    const waypointZ = target.z - Math.sin(target.heading) * targetLateral;
    const relativeX = waypointX - this.position.x;
    const relativeZ = waypointZ - this.position.z;
    // Positive road lateral is the same signed side used by the vehicle's steering
    // input after the vehicle applies its internal steering-angle negation.
    const waypointRight = relativeX * forwardZ - relativeZ * forwardX;
    const waypointDistanceSq = Math.max(
      relativeX * relativeX + relativeZ * relativeZ,
      MIN_PURSUIT_DISTANCE_SQ,
    );
    const pursuitCurvature = (2 * waypointRight) / waypointDistanceSq;
    const wheelAngle = Math.atan(wheelbaseOf(vehicle) * pursuitCurvature);
    // Vehicle applies its speed-dependent lock, input exponent and backlash after
    // receiving this value. Pre-compensate those three stages so the requested
    // geometric angle is what reaches the tyres, not a command hidden inside slack.
    out.steer = steeringInputForWheelAngle(wheelAngle, vehicle.modelDef.steerLock, speed);

    // Look beyond the physical braking distance for the bend's peak curvature.
    // `curveLead` provides setup distance before braking becomes mandatory; keeping
    // it separate from obstacle `brakeLead` avoids making prop stops unnecessarily
    // early. Extra samples retain roughly the old spatial resolution over the
    // longer preview.
    const turnLookahead = Math.max(
      lookahead,
      config.curveLead + config.brakeLead + (speed * speed) / (2 * config.brakeAccel),
    );
    let upcomingCurvature = Math.abs(target.curvature);
    for (let i = 1; i <= TURN_CURVATURE_SAMPLES; i++) {
      upcomingCurvature = Math.max(
        upcomingCurvature,
        Math.abs(this.road.curvatureAt(this.hintS + (turnLookahead * i) / TURN_CURVATURE_SAMPLES)),
      );
    }
    let targetSpeed = Math.min(
      config.cruiseMps,
      Math.sqrt(config.lateralAccel / Math.max(upcomingCurvature, 1e-4)),
    );
    targetSpeed = Math.max(3, targetSpeed - Math.max(0, target.grade) * 4);
    if (hazard?.breakable) targetSpeed = Math.min(targetSpeed, 8);
    // A prop the COMMANDED LINE already clears is scenery to drive past, not an
    // obstacle to brake for.
    //
    // Braking for it anyway is what made a littered road crawl: in-asphalt scatter
    // arrives every few tens of metres, so the next prop was always inside the
    // braking envelope and the target speed never climbed out of it — measured at
    // 6.4 m/s against a 20 m/s cruise, with the steering calm and a clear line
    // through the whole field the entire time. The envelope keeps a planned prop
    // only while the car is still moving onto the line that passes it.
    // Two ways a planned prop leaves the braking envelope: the line already passes
    // it, or there is still room to GET onto that line before reaching it. The line
    // moves at `LINE_SHIFT_PER_METRE` of road, so the distance the move needs is
    // arithmetic; the 1.5 factor and the body length are the margin for arriving
    // established rather than still moving across.
    const shiftNeeded =
      (Math.abs(this.plannedLateral - this.appliedLateral) / LINE_SHIFT_PER_METRE) * 1.5
      + CAR_HALF_LENGTH_M;
    const lineClearsHazard =
      hazard !== null &&
      hasIndexedDetour &&
      (Math.abs(this.appliedLateral - hazard.lateral) >= hazard.radius + CAR_HALF_WIDTH_M
        || this.hazardDistance >= shiftNeeded);
    const brakingDistance = lineClearsHazard
      ? // The short ray sees the same prop, so it goes with it; anything else the ray
        // found is unplanned and still stops the car.
        (rayMatchesIndexedHazard ? Infinity : this.dynamicDistance)
      : obstacleDistance;
    if (brakingDistance < Infinity) {
      const brakingSpeed = Math.sqrt(
        Math.max(0, 2 * config.brakeAccel * Math.max(0, brakingDistance - config.brakeLead)),
      );
      const indexedDetourControlsSpeed =
        hasIndexedDetour &&
        (this.hazardDistance <= this.dynamicDistance || rayMatchesIndexedHazard);
      targetSpeed = Math.min(
        targetSpeed,
        indexedDetourControlsSpeed ? Math.max(AVOIDANCE_CRAWL_MPS, brakingSpeed) : brakingSpeed,
      );
    }
    if (offRoad) targetSpeed = Math.min(targetSpeed, OFFROAD_SPEED_MPS);
    if (mustStop) targetSpeed = 0;

    // A failed forward attempt is different from normal corner braking: if the engine
    // is asking for motion but the car remains under 1 km/h for several seconds, it is
    // wedged, facing a prop, or resting on bad ground. Give it a deliberate recovery
    // manoeuvre instead of continuing to feed throttle into the same failure.
    const tryingToMove =
      vehicle.engineRunning &&
      targetSpeed > 1 &&
      speed < STUCK_SPEED_MPS;
    const blockedAtStandstill =
      speed < STUCK_SPEED_MPS &&
      (mustStop || obstacleDistance < 2.5);
    if (tryingToMove || blockedAtStandstill) this.stoppedFor += dt;
    else if (speed > STUCK_SPEED_MPS * 1.5 || targetSpeed <= 1) this.stoppedFor = 0;

    if (this.stoppedFor >= STUCK_AFTER_S && this.reverseFor <= 0) {
      this.reverseFor = RECOVERY_REVERSE_S;
      this.stoppedFor = 0;
      const lateralSide = Math.sign(projection.lateral);
      this.recoverySteer = lateralSide === 0 ? -this.recoverySteer : -lateralSide;
    }
    if (this.reverseFor > 0) {
      this.reverseFor -= dt;
      out.throttle = 0;
      // In automatic mode, reverse=true selects R at rest and brake becomes reverse
      // throttle on the following tick. The fixed two-second window gives the car time
      // to pull its rear clear before forward demand is restored.
      out.brake = 0.72;
      out.reverse = true;
      out.steer = this.recoverySteer * 0.75;
      out.handbrake = false;
      return;
    }

    const speedError = targetSpeed - speed;
    out.reverse = false;
    out.handbrake = false;
    out.throttle = speedError > 0 ? clamp(speedError / 4, 0.2, 1) : 0;
    out.brake = speedError < 0 ? clamp(-speedError / 4, 0, 1) : 0;
    const enteringCurve =
      upcomingCurvature >= TURN_COAST_CURVATURE ||
      Math.abs(out.steer) >= TURN_COAST_STEER;
    // Coast while HOLDING a bend at its limit, not merely while in one.
    //
    // The gate used to be a fixed 5 m/s: any curve tighter than 250 m, or any steer
    // past 0.12, cut the throttle at every speed above it. The car then coasted down
    // to 5 m/s, got its throttle back, crept over the threshold, and lost it again —
    // stabilising at exactly 18 km/h for the whole corner however fast the corner
    // could actually be taken. Measured on tools/playground-lap.ts: 18 km/h through a
    // 110 m radius whose lateral limit is 85 km/h, and the same rule is what made an
    // obstacle-strewn road crawl at 6 m/s, because avoidance steer sits past 0.12.
    //
    // `targetSpeed` already carries the grip limit (`lateralAccel / curvature`), the
    // grade and every obstacle decision, so it is the honest thing to compare
    // against: no power within a tenth of the limit, full use of the road below it.
    // The floor remains, so a hairpin can always be pulled out of.
    const coastSpeed = Math.max(TURN_COAST_MIN_SPEED_MPS, targetSpeed * 0.9);
    if (!offRoad && speed >= coastSpeed && enteringCurve) {
      out.throttle = 0;
    }
    if (offRoad && speed > OFFROAD_SPEED_MPS) {
      out.throttle = 0;
      out.brake = Math.max(
        out.brake,
        clamp((speed - OFFROAD_SPEED_MPS) / 6, 0.05, OFFROAD_BRAKE_MAX),
      );
    }
  }

  private dynamicObstacleDistance(vehicle: Vehicle, originX: number, originZ: number): number {
    if (!this.physics) return Infinity;
    const body = vehicle.chassis;
    const r = body.rotation();
    const forwardX = 2 * (r.x * r.z + r.w * r.y);
    const forwardZ = 1 - 2 * (r.x * r.x + r.y * r.y);
    let nearest = Infinity;
    for (let lateral = -0.32; lateral <= 0.32; lateral += 0.32) {
      // Position is durable absolute state; only the ray passed to Rapier is relative.
      this.rayOrigin.x = this.position.x - originX + forwardX * 1.5 - forwardZ * lateral;
      this.rayOrigin.y = this.position.y + 0.55;
      this.rayOrigin.z = this.position.z - originZ + forwardZ * 1.5 + forwardX * lateral;
      this.rayDirection.x = forwardX;
      this.rayDirection.y = 0;
      this.rayDirection.z = forwardZ;
      const hit = this.physics.raycast(this.rayOrigin, this.rayDirection, DYNAMIC_RANGE, body);
      const collider = hit ? this.physics.world.getCollider(hit.colliderHandle) : null;
      if (hit && collider?.parent()?.isDynamic() && hit.toi < nearest) nearest = hit.toi;
    }
    return nearest;
  }
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function wheelbaseOf(vehicle: Vehicle): number {
  let frontZ = -Infinity;
  let rearZ = Infinity;
  for (const wheel of vehicle.modelMeasure.wheels) {
    if (wheel.isFront) frontZ = Math.max(frontZ, wheel.pos[2]);
    else rearZ = Math.min(rearZ, wheel.pos[2]);
  }
  return Number.isFinite(frontZ) && Number.isFinite(rearZ)
    ? Math.max(frontZ - rearZ, 1.5)
    : DEFAULT_WHEELBASE_M;
}
function steeringInputForWheelAngle(
  wheelAngle: number,
  modelSteerLock: number,
  speedMps: number,
): number {
  const magnitude = Math.abs(wheelAngle);
  if (magnitude <= STEER_PLAY_RAD * 0.55) return 0;
  const speedKmh = speedMps * 3.6;
  const speedT = clamp(
    (speedKmh - STEER_FULL_LOCK_KMH) / (STEER_REDUCED_KMH - STEER_FULL_LOCK_KMH),
    0,
    1,
  );
  const lockFactor = 1 - (1 - STEER_HIGH_SPEED_FRACTION) * Math.pow(speedT, STEER_LOCK_CURVE);
  const effectiveLock = Math.max(modelSteerLock * lockFactor, 0.1);
  const targetAngle = Math.min(magnitude + STEER_PLAY_RAD, effectiveLock);
  const normalized = Math.pow(targetAngle / effectiveLock, 1 / STEER_INPUT_EXPONENT);
  // Vehicle negates normalized input when converting it to a wheel angle.
  return clamp(-Math.sign(wheelAngle) * normalized, -1, 1);
}
