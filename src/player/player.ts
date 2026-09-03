import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, type PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import type { InputFrame } from '../core/input';
import type { GameWorld } from '../game/state';
import type { Road } from '../world/road';
import { WorldOrigin, type Rebasable, type RebaseShift } from '../world/origin';

/**
 * The on-foot player, a kinematic character controller over a capsule collider.
 *
 * A kinematic body (rather than a dynamic one) is load-bearing here: a dynamic
 * capsule would fight the vehicles' dynamic bodies and the ground contact solver,
 * while a kinematic body + Rapier's character controller gives clean walking,
 * stepping, slope sliding and grounding without ever being pushed by a car.
 *
 * The capsule origin (and `position`) is the capsule centre. `EYE_OFFSET` is the
 * eye height above that centre, `FEET_OFFSET` the distance from the centre down to
 * the feet — the camera and interaction code build on these.
 */

const WALK_SPEED = 3.4;
const SPRINT_SPEED = 6.2;
const JUMP_SPEED = 4.2;
const GRAVITY = 9.81;
const CAPSULE_HALF_HEIGHT = 0.6;
const CAPSULE_RADIUS = 0.35;
/** Kerb / garage-lip height the character steps over automatically. */
const STEP_HEIGHT = 0.35;
/** Steepest slope (radians) the character climbs; steeper dunes become walls. */
const MAX_SLOPE_CLIMB = 0.85;
/** Shallowest slope (radians) that slides the character down instead of sticking. */
const MIN_SLOPE_SLIDE = 0.6;
/** `player_move` deltas are emitted a few times a second, never per tick. */
const MOVE_EMIT_INTERVAL = 0.15;
const TERMINAL_VELOCITY = 30;
/**
 * A teleport further than this from the current arclength hint forces a full
 * unhinted road projection. Comfortably wider than the hinted search window, so a
 * short hop stays cheap while a cross-map jump stays correct.
 */
const TELEPORT_REHOME_DISTANCE = 150;

/**
 * How fast a leaned-on dynamic body is allowed to get (m/s). A shove is a
 * TARGET SPEED, not a force: a raw force that creeps a 1200 kg car is ~320 N,
 * which launches a 5 kg jerry can at over 60 m/s. Capping the *speed* means the
 * same lean nudges a can and creeps a truck alike. 0.4 m/s is a fast walking
 * elbow — the car is plainly heavy and only grudgingly gives ground. At walk
 * speed (3.4 m/s) the car read as weightless and was flung like the cans.
 */
const PUSH_TARGET_SPEED = 0.4;
/**
 * Seconds of leaning to reach `PUSH_TARGET_SPEED` from rest, ignoring the body's
 * own rolling resistance. 1.5 s makes the first moments nearly motionless — the
 * car resists, then slowly yields — which is what "heavy" feels like. 0.2 s felt
 * like an elastic shove, not a push.
 */
const PUSH_RAMP_SECONDS = 1.5;
/** Acceleration a lean applies to ANY dynamic body: the target spread over the ramp. */
const PUSH_ACCEL = PUSH_TARGET_SPEED / PUSH_RAMP_SECONDS;

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * A body the player can shove that owns its own response to the push. A parked
 * car pins its chassis every step — its parking hold re-teleports it and zeroes
 * its velocity after Rapier has stepped — so only the car itself can lift that
 * and creep; an impulse applied from outside is silently undone one tick later.
 * Owned bodies answer a shove request instead. Bodies with no owner (loose
 * parts, jerry cans, wrecks) fall through to the direct impulse below.
 */
export interface Shoveable {
  shove(dirX: number, dirZ: number, seconds: number): void;
}

export class Player implements Rebasable {
  /** Eye height above the capsule centre, metres. */
  static readonly EYE_OFFSET = 0.7;
  /** Distance from the capsule centre down to the feet, metres. */
  static readonly FEET_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;

  private road: Road | null = null;
  private carryRatio = 0;
  private verticalVelocity = 0;
  private yaw = 0;
  private pitch = 0;
  private arcS = 0;
  private groundedFlag = false;
  private groundSurfaceFlag = SurfaceType.Asphalt;
  private enabled = true;
  private emitTimer = 0;

  /** Maps a struck body's handle to its owner, or null; null gets a direct impulse. */
  private shoveLookup: (bodyHandle: number) => Shoveable | null = () => null;
  /**
   * Contact fallback for owned bodies at character-controller autostep edges.
   * Returns the body handle it shoved so the computed-collision path does not
   * apply the same request twice.
   */
  private nearbyShove: (
    x: number,
    y: number,
    z: number,
    radius: number,
    moveX: number,
    moveZ: number,
    seconds: number,
  ) => number | null = () => null;
  private readonly moveScratch = { x: 0, y: 0, z: 0 };
  private readonly appliedScratch = { x: 0, y: 0, z: 0 };
  private readonly posScratch = { x: 0, y: 0, z: 0 };
  // Fixed-step position snapshots, for the same reason as the car: the camera and
  // the eye must move at constant velocity between steps, not jump by however many
  // steps happened to run before this frame.
  private readonly prevStep = { x: 0, y: 0, z: 0 };
  private readonly curStep = { x: 0, y: 0, z: 0 };
  private readonly interp = { x: 0, y: 0, z: 0 };
  // Shove scratch, reused every fixed step (see the push loop in fixedUpdate).
  private readonly pushCollision = new RAPIER.CharacterCollision();
  private readonly pushImpulse = { x: 0, y: 0, z: 0 };
  private readonly bodyVelScratch = { x: 0, y: 0, z: 0 };
  private snapshotPrimed = false;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly origin: WorldOrigin,
  ) {
    this.controller = physics.world.createCharacterController(0.01);
    // The built-in impulse path is off: it derives its impulse from the tiny
    // `offset` gap the shape cast stops short by, not from the player's momentum,
    // and it drives whatever it hits toward the character's full velocity with no
    // mass-scaled cap — so a jerry can launches at walk speed. The explicit shove
    // in `fixedUpdate` replaces it; leaving it on would count every push twice.
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.enableAutostep(STEP_HEIGHT, 0.2, true);
    this.controller.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB);
    this.controller.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE);
    this.controller.setSlideEnabled(true);
    this.controller.enableSnapToGround(0.3);

    // `computedCollision` reuses whatever Vector objects are already on the
    // collision scratch, so pre-fill them once and the push loop allocates
    // nothing per step.
    this.pushCollision.normal1 = { x: 0, y: 0, z: 0 };
    this.pushCollision.normal2 = { x: 0, y: 0, z: 0 };
    this.pushCollision.translationDeltaApplied = { x: 0, y: 0, z: 0 };
    this.pushCollision.translationDeltaRemaining = { x: 0, y: 0, z: 0 };
    this.pushCollision.witness1 = { x: 0, y: 0, z: 0 };
    this.pushCollision.witness2 = { x: 0, y: 0, z: 0 };

    const p = world.state.player;
    // `p.x/z` are absolute (from the save); Rapier holds relative positions.
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        p.x - this.origin.x,
        p.y,
        p.z - this.origin.z,
      ),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );
    this.arcS = p.s;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.origin.register(this);
  }

  /** The shared `Road` instance, needed to maintain the arclength `s`. */
  setRoad(road: Road): void {
    this.road = road;
  }

  /** `carriedMass / massLimit` from the inventory; slows movement when heavy. */
  setCarriedRatio(ratio: number): void {
    this.carryRatio = clamp(ratio, 0, 1);
  }

  /**
   * Installs the lookup mapping a struck body's handle to its `Shoveable` owner.
   * Defaults to null (no owner), so this file stands alone and every dynamic body
   * gets the direct impulse; `main.ts` wires cars and any other owned body in.
   */
  setShoveLookup(lookup: (bodyHandle: number) => Shoveable | null): void {
    this.shoveLookup = lookup;
  }

  setNearbyShove(
    shove: (
      x: number,
      y: number,
      z: number,
      radius: number,
      moveX: number,
      moveZ: number,
      seconds: number,
    ) => number | null,
  ): void {
    this.nearbyShove = shove;
  }

  /**
   * Capsule centre, RELATIVE to the floating origin. Use this for anything compared
   * against a Rapier body or written into the relative scene graph; `absolutePosition`
   * is the same point in absolute world coordinates.
   */
  get position(): { x: number; y: number; z: number } {
    const t = this.body.translation(this.posScratch);
    return { x: t.x, y: t.y, z: t.z };
  }

  /**
   * Capsule centre in ABSOLUTE world coordinates, for consumers that sample the
   * world (terrain height, rescue). `position` stays relative so nobody has to
   * un-rebase a Rapier translation to do a distance check against a body.
   */
  get absolutePosition(): { x: number; y: number; z: number } {
    const t = this.body.translation(this.posScratch);
    return { x: t.x + this.origin.x, y: t.y, z: t.z + this.origin.z };
  }

  /**
   * Latches the capsule position after the physics step that moved it. Call once
   * per fixed step, after `physics.step()`.
   */
  postStep(): void {
    const t = this.body.translation(this.posScratch);
    if (!this.snapshotPrimed) {
      this.prevStep.x = t.x;
      this.prevStep.y = t.y;
      this.prevStep.z = t.z;
      this.snapshotPrimed = true;
    } else {
      this.prevStep.x = this.curStep.x;
      this.prevStep.y = this.curStep.y;
      this.prevStep.z = this.curStep.z;
    }
    this.curStep.x = t.x;
    this.curStep.y = t.y;
    this.curStep.z = t.z;
  }

  /**
   * Capsule centre at render time, interpolated between the last two fixed steps.
   * Returns an internal buffer; callers must not retain it across frames.
   */
  interpolatedPosition(alpha: number): { x: number; y: number; z: number } {
    const p = this.interp;
    p.x = this.prevStep.x + (this.curStep.x - this.prevStep.x) * alpha;
    p.y = this.prevStep.y + (this.curStep.y - this.prevStep.y) * alpha;
    p.z = this.prevStep.z + (this.curStep.z - this.prevStep.z) * alpha;
    return p;
  }

  /**
   * Shifts the fixed-step interpolation snapshots when the floating origin moves.
   * `prevStep`/`curStep` are relative positions held across steps; if they are not
   * shifted the renderer lerps the capsule across the whole origin step for a frame.
   * `arcS` is an arclength and is deliberately left alone.
   */
  rebase(shift: RebaseShift): void {
    this.prevStep.x -= shift.dx;
    this.prevStep.z -= shift.dz;
    this.curStep.x -= shift.dx;
    this.curStep.z -= shift.dz;
  }

  /** Maintained arclength along the road. */
  get s(): number {
    return this.arcS;
  }

  get grounded(): boolean {
    return this.groundedFlag;
  }

  /** Registered material of the collider currently supporting the capsule. */
  get groundSurface(): SurfaceType {
    return this.groundSurfaceFlag;
  }

  /**
   * Horizontal speed over the last fixed step, m/s. Derived from the step
   * snapshots rather than the requested velocity, so it reports what the character
   * controller actually achieved — walking into a wall is standing still, which is
   * exactly what the footstep audio needs to know.
   */
  get groundSpeed(): number {
    if (!this.snapshotPrimed) return 0;
    const dx = this.curStep.x - this.prevStep.x;
    const dz = this.curStep.z - this.prevStep.z;
    return Math.hypot(dx, dz) / FIXED_DT;
  }

  /**
   * The kinematic capsule body, so collision queries (interaction rays, camera
   * occlusion) can exclude the player's own body. The eye origin sits inside the
   * capsule, and `castRayAndGetNormal(..., solid = true)` reports a zero-distance
   * self-hit unless callers exclude this body.
   */
  get rigidBody(): RAPIER.RigidBody {
    return this.body;
  }

  /** Removes the capsule from the world while seated in a car (and restores it on foot). */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.body.setEnabled(enabled);
    if (enabled) this.verticalVelocity = 0;
  }

  /**
   * Teleports the player so their feet rest at (x, y, z).
   *
   * A vehicle exit supplies its already-tracked road arclength. That is more
   * reliable than projecting an exit point in XZ where a distant road loop can
   * overlap the current one and select the wrong branch.
   */
  teleport(x: number, y: number, z: number, knownRoadS?: number): void {
    // x/z arrive absolute (spawn, rescue, car exit). Rapier and the step snapshots
    // hold relative positions, so rebase them here; the road projection below still
    // samples absolute coordinates.
    const cy = y + Player.FEET_OFFSET;
    const rx = x - this.origin.x;
    const rz = z - this.origin.z;
    this.body.setTranslation({ x: rx, y: cy, z: rz }, true);
    this.verticalVelocity = 0;
    // A teleport is a discontinuity: the fixed-step render interpolation reads
    // prevStep/curStep, and those are only refreshed by postStep() *after* the
    // next physics step. Car exit and rescue both run later in their fixed step
    // than postStep() does, so leaving the old snapshots in place would keep
    // them at the entry/fall spot for the rest of that step — the camera snaps
    // to the stale spot and then the foot spring flies it across the gap, the
    // "slide" seen when stepping out of a car. Seed both snapshots to the new
    // capsule centre now so the very next rendered frame draws the player here.
    this.prevStep.x = rx;
    this.prevStep.y = cy;
    this.prevStep.z = rz;
    this.curStep.x = rx;
    this.curStep.y = cy;
    this.curStep.z = rz;
    this.snapshotPrimed = true;
    if (!this.road) return;
    if (knownRoadS !== undefined) {
      this.arcS = Math.min(this.road.length, Math.max(0, knownRoadS));
      return;
    }
    const near = this.road.sampleAt(this.arcS);
    const driftSq = (near.x - x) ** 2 + (near.z - z) ** 2;
    this.arcS =
      driftSq > TELEPORT_REHOME_DISTANCE * TELEPORT_REHOME_DISTANCE
        ? this.road.project(x, z).s
        : this.road.project(x, z, this.arcS).s;
  }

  /** Immediately mirrors a teleport into world state so the next save cannot revive it. */
  pushState(): void {
    const p = this.absolutePosition;
    this.world.apply({
      t: 'player_move',
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: this.yaw,
      pitch: this.pitch,
      s: this.arcS,
    });
  }

  fixedUpdate(dt: number, input: InputFrame, cameraYaw: number): void {
    if (!this.enabled) return;

    // The camera owns yaw on foot; the player mirrors it. Pitch is accumulated
    // here because the CameraRig does not expose it.
    this.yaw = cameraYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, -1.55, 1.55);

    // Carried mass slows the player; a full pack halves the walk speed.
    const speedScale = 1 - this.carryRatio * 0.45;
    const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * speedScale;

    let moveX = 0;
    let moveZ = 0;
    const len = Math.hypot(input.moveX, input.moveZ);
    if (len > 1e-4) {
      const nx = input.moveX / len;
      const nz = input.moveZ / len;
      // Heading 0 = +Z, so forward is (sin, cos). With +Y up, right is
      // forward x up = (-cos, sin) — NOT (cos, -sin), which is its negation and
      // silently inverts strafing.
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      moveX = (sin * nz - cos * nx) * speed;
      moveZ = (cos * nz + sin * nx) * speed;
    }

    if (input.jump && this.groundedFlag) {
      this.verticalVelocity = JUMP_SPEED;
      this.groundedFlag = false;
    }

    this.verticalVelocity -= GRAVITY * dt;
    // While grounded, cancel the downward drift so the controller keeps the capsule
    // pinned instead of fighting gravity each tick.
    if (this.groundedFlag && this.verticalVelocity < 0) this.verticalVelocity = 0;
    if (this.verticalVelocity < -TERMINAL_VELOCITY) this.verticalVelocity = -TERMINAL_VELOCITY;

    const mv = this.moveScratch;
    mv.x = moveX * dt;
    mv.y = this.verticalVelocity * dt;
    mv.z = moveZ * dt;

    // The raised rear edge of some chassis boxes is eligible for autostep, which
    // can omit it from computedCollision even though the capsule is pressed against
    // the boot. Let the vehicle OBB provide that one missing contact report.
    let nearbyShovedHandle: number | null = null;
    if (moveX * moveX + moveZ * moveZ > 1e-8) {
      const p = this.body.translation(this.posScratch);
      nearbyShovedHandle = this.nearbyShove(
        p.x,
        p.y,
        p.z,
        CAPSULE_RADIUS + 0.03,
        moveX,
        moveZ,
        dt,
      );
    }

    this.controller.computeColliderMovement(this.collider, mv);

    // Shove the dynamic bodies the capsule is leaning into. The controller's
    // built-in impulse path is off (see the constructor); this is the only push,
    // driven explicitly so the speed can be capped per body.
    const numCollisions = this.controller.numComputedCollisions();
    let supportNormalY = 0;
    let supportHandle: number | null = null;
    for (let i = 0; i < numCollisions; i++) {
      const collision = this.controller.computedCollision(i, this.pushCollision);
      if (!collision) continue;
      const collider = collision.collider;
      // normal1 points out of the struck collider. The strongest upward normal is
      // the support under the capsule; walls and ceilings cannot win this test.
      if (collider && collision.normal1.y > supportNormalY) {
        supportNormalY = collision.normal1.y;
        supportHandle = collider.handle;
      }
      const body = collider?.parent();
      if (!body || !body.isDynamic()) continue;

      // Push axis is opposite the contact normal, flattened: a bumper is shoved
      // sideways, never lifted or pressed into the road.
      const ax = -collision.normal1.x;
      const az = -collision.normal1.z;
      const axisLen = Math.hypot(ax, az);
      if (axisLen < 1e-4) continue; // vertical face (roof / ground): nothing to shove
      const px = ax / axisLen;
      const pz = az / axisLen;

      // Only while actually moving into the body: standing still or sliding
      // along it reports a collision but must not push.
      const approach = moveX * px + moveZ * pz;
      if (approach <= 0) continue;
      if (body.handle === nearbyShovedHandle) continue;

      // Owned bodies (cars) answer a shove request: they know their own mass and
      // lift their own parking hold, which no outside impulse could move.
      const owner = this.shoveLookup(body.handle);
      if (owner) {
        owner.shove(px, pz, dt);
        continue;
      }

      // No owner: push it directly. Cap the body's speed along the push axis.
      // Only the impulse needed to approach PUSH_TARGET_SPEED is applied, so a
      // light body is nudged, never launched, and a body already rolling faster
      // is left alone.
      body.linvel(this.bodyVelScratch);
      const speedAlongAxis = this.bodyVelScratch.x * px + this.bodyVelScratch.z * pz;
      if (speedAlongAxis >= PUSH_TARGET_SPEED) continue;
      const dv = Math.min(PUSH_ACCEL * dt, PUSH_TARGET_SPEED - speedAlongAxis);

      // Impulse = mass * Δv: the force scales with the struck body's mass, so a
      // heavy truck and a light hatchback creep at the same rate instead of the
      // truck being immovable and the hatchback flying.
      const impulse = body.mass() * dv;
      this.pushImpulse.x = px * impulse;
      this.pushImpulse.y = 0;
      this.pushImpulse.z = pz * impulse;
      // wakeUp = true: loose parts and jerry cans spawn asleep and ignore
      // impulses until woken.
      body.applyImpulse(this.pushImpulse, true);
    }

    // `pos` is the relative capsule centre; `applied` is a relative per-step
    // displacement, so this read-then-write pair needs no origin conversion.
    const applied = this.controller.computedMovement(this.appliedScratch);
    const pos = this.body.translation(this.posScratch);
    this.body.setNextKinematicTranslation({
      x: pos.x + applied.x,
      y: pos.y + applied.y,
      z: pos.z + applied.z,
    });

    this.groundedFlag = this.controller.computedGrounded();
    if (this.groundedFlag && supportHandle !== null) {
      this.groundSurfaceFlag = this.physics.surfaces.lookupType(supportHandle);
    }

    const ox = this.origin.x;
    const oz = this.origin.z;
    if (this.road) {
      // The road samples absolute world coordinates; `pos` is relative.
      // Always pass the previous arc hint: without it, project sweeps the road.
      this.arcS = this.road.project(pos.x + ox, pos.z + oz, this.arcS).s;
    }

    this.emitTimer += dt;
    if (this.emitTimer >= MOVE_EMIT_INTERVAL) {
      this.emitTimer = 0;
      // The save stores absolute world coordinates; add the origin back here.
      this.world.apply({
        t: 'player_move',
        x: pos.x + ox,
        y: pos.y,
        z: pos.z + oz,
        yaw: this.yaw,
        pitch: this.pitch,
        s: this.arcS,
      });
    }
  }
}
