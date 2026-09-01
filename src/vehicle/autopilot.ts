/** Fixed-step road follower. Inputs remain ordinary InputFrame commands. */
import type { InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from '../world/road';
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
}

/**
 * 0.7–0.8 g is the measured period-tyre envelope in Vehicle. Sleeper reserves it to
 * 0.52 g (about 70% of the low end); frantic uses 0.68 g (about 91%). The remainder
 * is deliberate room for grade, steering backlash and obstacle corrections.
 */
const MODES: Record<AutopilotMode, ModeConfig> = {
  sleeper: { cruiseMps: 20, lateralAccel: 5.1, brakeAccel: 4.2, lookaheadBase: 9, lookaheadSpeed: 1.3, hazardMargin: 1.4, brakeLead: 18 },
  frantic: { cruiseMps: 28, lateralAccel: 6.7, brakeAccel: 6.4, lookaheadBase: 6, lookaheadSpeed: 0.95, hazardMargin: 0.45, brakeLead: 7 },
};
/**
 * Stanley cross-track gain, and why it is not small.
 *
 * Measured: at 0.72 the controller settled 3.4 m off the centreline at 68 km/h and
 * STAYED there, holding a steady 0.13 of steering input. That is not an unstable
 * loop, it is a dead one — `tools/handling-bench.ts` reports a 0.17 input dead zone
 * (steering-box play plus the input exponent), so 0.13 commands exactly nothing and
 * the error it was correcting became the equilibrium.
 *
 * 3.4 raises the correction for a half-metre error at 20 m/s from 0.02 to 0.09, and
 * the slack compensation below carries what is left across the dead band. The atan
 * still saturates gracefully, so a large error asks for full lock and no more.
 */
const STANLEY_GAIN = 3.4;
const STANLEY_SPEED_FLOOR = 2.5;
/**
 * Input magnitude below which the steering box does nothing at all, as measured by
 * the handling bench. Every non-zero steer command is lifted over it: a human driver
 * learns to turn the wheel past the slack, and an autopilot that does not is a driver
 * with no hands below a tenth of lock.
 */
const STEER_SLACK_INPUT = 0.18;
/**
 * Command magnitude over which the slack lift fades in. Small enough that a real
 * correction is carried immediately, large enough that centimetre-scale errors do
 * not command a tenth of lock: at 20 m/s this is a cross-track error of ~0.3 m.
 */
const STEER_SLACK_BLEND = 0.05;
/**
 * Half the widest catalogue body, metres, plus a little. Used only to decide whether
 * a hazard is in this car's corridor; a per-model figure would make the decision
 * differ between cars for no gain, and being slightly pessimistic is free.
 */
const CAR_HALF_WIDTH_M = 1.05;
/**
 * Extra metres the middle avoidance rung asks for beyond bare body clearance, and the
 * fraction of that clearance the braking corridor is measured at. Together they
 * guarantee that a line the planner picks is outside the corridor that caused the
 * braking, which is what stops the two from deadlocking.
 */
const AVOID_HYSTERESIS_M = 0.4;
const BLOCK_CORRIDOR_FRACTION = 0.8;
const STOPPED_MPS = 0.35;
const REVERSE_AFTER_S = 1.4;
const REVERSE_FOR_S = 1.1;
const DYNAMIC_RANGE = 18;

export class Autopilot {
  private modeValue: AutopilotMode = 'sleeper';
  private engagedValue = false;
  private hintS = 0;
  private stoppedFor = 0;
  private reverseFor = 0;
  private hazard: RoadHazard | null = null;
  private hazardDistance = Infinity;
  private dynamicDistance = Infinity;
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly visitHazard = (hazard: RoadHazard): void => {
    const distance = hazard.s - this.hintS;
    if (distance < this.hazardDistance) {
      this.hazard = hazard;
      this.hazardDistance = distance;
    }
  };
  /** Clears the nearest-hazard result before a scan. See the note in `drive`. */
  private beginHazardScan(): void {
    this.hazard = null;
    this.hazardDistance = Infinity;
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
  }

  /** Writes controls in-place. Stanley feedback avoids assuming Vehicle's shaped, rate-limited rack is linear. */
  drive(dt: number, vehicle: Vehicle, out: InputFrame, originX: number, originZ: number): void {
    if (!this.engagedValue) return;
    const config = MODES[this.modeValue];
    vehicle.absoluteTranslation(this.position);
    const projection = this.road.project(this.position.x, this.position.z, this.hintS);
    this.hintS = projection.s;
    const velocity = vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    const lookahead = config.lookaheadBase + speed * config.lookaheadSpeed;
    const target = this.road.sampleAt(this.hintS + lookahead);
    const rotation = vehicle.chassis.rotation();
    const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
    const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
    const heading = Math.atan2(forwardX, forwardZ);
    const headingError = wrapAngle(target.heading - heading);

    // The scan resets inside a method rather than here: clearing `this.hazard` in
    // this scope narrows it to `null` for the rest of the method, and the closure
    // that fills it back in is invisible to that analysis.
    this.beginHazardScan();
    this.hazards.forEachAhead(
      this.hintS,
      Math.max(lookahead + 8, config.brakeLead + (speed * speed) / (2 * config.brakeAccel)),
      this.visitHazard,
    );
    this.dynamicDistance = this.dynamicObstacleDistance(vehicle, originX, originZ);

    let desiredLateral = 0;
    let obstacleDistance = this.dynamicDistance;
    let mustStop = this.dynamicDistance < 4;
    const hazard = this.hazard;
    if (hazard && !hazard.breakable) {
      // Pick a line past it, then decide about braking SEPARATELY. Measured, the two
      // used to be one: the hazard fed the braking-distance limiter unconditionally,
      // so the car planned a detour, drove to it, and still crawled to a halt 18 m
      // short of a rock it was no longer pointed at. Braking is for a hazard that is
      // still in the car's own corridor.
      //
      // The line is chosen down a LADDER, asphalt first. A line that spends the
      // shoulder is a line that spends whatever is actually out there — measured, a
      // 1.2 m rock plus the full comfort margin put the car 0.35 m past the asphalt
      // edge, off the road mesh, and 22 m into the desert. The shoulder is a last
      // resort before stopping, not the first thing the margin eats.
      const bodyClearance = hazard.radius + CAR_HALF_WIDTH_M;
      const asphaltEdge = ROAD_HALF_WIDTH - CAR_HALF_WIDTH_M;
      const shoulderEdge = ROAD_HALF_WIDTH + SHOULDER_WIDTH - CAR_HALF_WIDTH_M;
      let line: number | null = null;
      // Rungs: comfortable, then merely clear-with-hysteresis, then bare clearance.
      // The hysteresis rung is not cosmetic. A line at EXACTLY `bodyClearance` sits on
      // the same threshold the corridor test below uses, and the two deadlocked: the
      // car braked because the rock was in its corridor, reached the line at 2.20 m
      // against a 2.25 m threshold, and then sat there forever — stopped, so no
      // steering authority to finish the move, and still "blocked" so no throttle.
      for (const clearance of [
        bodyClearance + config.hazardMargin,
        bodyClearance + AVOID_HYSTERESIS_M,
        bodyClearance,
      ]) {
        for (const edge of [asphaltEdge, shoulderEdge]) {
          const left = hazard.lateral + clearance;
          const right = hazard.lateral - clearance;
          const leftFits = left <= edge;
          const rightFits = right >= -edge;
          if (!leftFits && !rightFits) continue;
          // Whichever side needs the smaller move, so a hazard on the verge is passed
          // without crossing the whole road to do it.
          line =
            leftFits &&
            (!rightFits ||
              Math.abs(left - projection.lateral) <= Math.abs(right - projection.lateral))
              ? left
              : right;
          break;
        }
        if (line !== null) break;
      }
      if (line === null) mustStop = true;
      else desiredLateral = line;
      // Braking applies only while the hazard is still inside the car's corridor, and
      // that corridor is deliberately NARROWER than any line the ladder picks.
      if (Math.abs(projection.lateral - hazard.lateral) < bodyClearance * BLOCK_CORRIDOR_FRACTION) {
        obstacleDistance = Math.min(obstacleDistance, this.hazardDistance - hazard.radius);
      }
    }

    const lateralError = projection.lateral - desiredLateral;
    const stanley = Math.atan((STANLEY_GAIN * lateralError) / Math.max(speed, STANLEY_SPEED_FLOOR));
    const curvatureInput = target.curvature * Math.max(3.4, Math.min(10, speed * 0.42));
    // Input + is right while road lateral + is left, so both the heading error and the
    // curvature feed-forward enter negated.
    const command = clamp(stanley - headingError - curvatureInput, -1, 1);
    // Slack compensation, applied LAST so nothing rescales it away. The lift fades in
    // over a small window instead of switching on: a fixed offset on every non-zero
    // command made a straight road dither between +/-0.18 lock, because a millimetre
    // of cross-track error asked for the whole dead band. Faded, a tiny error asks for
    // a tiny input (which the box swallows, correctly — the error is tiny) and a real
    // one gets carried across the slack.
    const magnitude = Math.abs(command);
    const lift = Math.min(1, magnitude / STEER_SLACK_BLEND);
    out.steer =
      Math.sign(command) * (STEER_SLACK_INPUT * lift + (1 - STEER_SLACK_INPUT) * magnitude);

    let targetSpeed = Math.min(config.cruiseMps, Math.sqrt(config.lateralAccel / Math.max(Math.abs(target.curvature), 1e-4)));
    targetSpeed = Math.max(3, targetSpeed - Math.max(0, target.grade) * 4);
    if (hazard?.breakable) targetSpeed = Math.min(targetSpeed, 8);
    if (obstacleDistance < Infinity) targetSpeed = Math.min(targetSpeed, Math.sqrt(Math.max(0, 2 * config.brakeAccel * Math.max(0, obstacleDistance - config.brakeLead))));
    if (mustStop) targetSpeed = 0;

    if (speed < STOPPED_MPS && (mustStop || obstacleDistance < 2.5)) this.stoppedFor += dt;
    else this.stoppedFor = 0;
    if (this.stoppedFor >= REVERSE_AFTER_S) {
      this.reverseFor = REVERSE_FOR_S;
      this.stoppedFor = 0;
    }
    if (this.reverseFor > 0) {
      this.reverseFor -= dt;
      out.throttle = 0;
      out.brake = 0.72;
      out.reverse = true;
      out.steer = -out.steer;
      out.handbrake = false;
      return;
    }

    const speedError = targetSpeed - speed;
    out.reverse = false;
    out.handbrake = false;
    out.throttle = speedError > 0 ? clamp(speedError / 4, 0.2, 1) : 0;
    out.brake = speedError < 0 ? clamp(-speedError / 4, 0, 1) : 0;
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
function wrapAngle(angle: number): number { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
