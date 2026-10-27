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
 * The body origin (and `position`) is the STANDING capsule's centre, crouched or not:
 * `EYE_OFFSET` is the eye height above that centre, `FEET_OFFSET` the distance from it
 * down to the feet — the camera and interaction code build on these. A crouch shortens
 * the collider and slides it down its body (`setCrouchShape`), so the feet, the body
 * origin and the save never move; only the eye lowers (`interpolatedEyeDrop`).
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
 * The crouch. C toggles it (`InputFrame.toggleCrouch`); the capsule shortens at once,
 * the eye follows over `CROUCH_SECONDS`, and the player crouch-walks at `CROUCH_SPEED`.
 */
const CROUCH_SPEED = 1.5;
/** Half-height of the crouched capsule's cylinder: 1.1 m tall overall, against 1.9 m standing. */
const CROUCH_HALF_HEIGHT = 0.2;
/** How far the collider's centre drops down its body when it shortens, so the feet stay put. */
const CROUCH_CENTRE_DROP = CAPSULE_HALF_HEIGHT - CROUCH_HALF_HEIGHT;
/**
 * How far the eye drops in a full crouch: the camera's standing 1.78 m (render/cameras.ts,
 * `EYE_HEIGHT`) comes down to a squat's 0.95 m, under the crouched capsule's 1.1 m top.
 */
const CROUCH_EYE_DROP = 0.83;
/** Seconds for the eye to travel the whole way down or up. */
const CROUCH_SECONDS = 0.25;
/**
 * The headroom probe: the space the standing capsule adds above the crouched one, which
 * must be empty to stand up. It starts 0.6 m above the feet, clear of the ground, a kerb
 * (`STEP_HEIGHT`) and the steepest slope under its own radius, and stops a centimetre
 * under the standing head; it is a little narrower than the capsule so the wall it is
 * crouched against does not count as a ceiling.
 */
const HEADROOM_FLOOR = 0.6;
const HEADROOM_TOP = 2 * (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS) - 0.01;
const HEADROOM_RADIUS = CAPSULE_RADIUS - 0.03;
const HEADROOM_HALF_HEIGHT = (HEADROOM_TOP - HEADROOM_FLOOR) / 2 - HEADROOM_RADIUS;
/** Probe centre above the body origin (the standing capsule's centre). */
const HEADROOM_CENTRE_RISE = (HEADROOM_TOP + HEADROOM_FLOOR) / 2 - (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);

/**
 * How fast a leaned-on loose body is allowed to get (m/s). A shove is a TARGET
 * SPEED, not a force: a raw force launches a 5 kg jerry can at walk speed, while
 * capping the *speed* nudges a can and a crate alike. Vehicles are not shoved at
 * all (`IMMOVABLE`).
 */
const PUSH_TARGET_SPEED = 0.4;
/**
 * Seconds of leaning to reach `PUSH_TARGET_SPEED` from rest, ignoring the body's
 * own rolling resistance, so a nudge builds instead of kicking.
 */
const PUSH_RAMP_SECONDS = 1.5;
/** Acceleration a lean applies to an unowned dynamic body: the target spread over the ramp. */
const PUSH_ACCEL = PUSH_TARGET_SPEED / PUSH_RAMP_SECONDS;

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * A body the player can shove that owns its own response to the push (a football).
 * Bodies with no owner (loose parts, jerry cans) fall through to the direct impulse
 * in `fixedUpdate`.
 */
export interface Shoveable {
  /** `speedMps` lets a light prop distinguish a walking nudge from a sprinting kick. */
  shove(dirX: number, dirZ: number, seconds: number, speedMps: number): void;
}

/**
 * Lookup answer for a dynamic body the player walks into but never moves: a car. The
 * capsule stops against it; nothing is applied to it.
 */
export const IMMOVABLE = 'immovable';
export type ShoveOwner = Shoveable | typeof IMMOVABLE | null;

export class Player implements Rebasable {
  /** Standing eye height above the body origin (the standing capsule's centre), metres: 1.78 m over the feet. */
  static readonly EYE_OFFSET = 0.83;
  /** Distance from the body origin (the standing capsule's centre) down to the feet, metres. */
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
  /** The player asked to be down (C toggles it); standing waits for headroom. */
  private crouchWanted = false;
  /** The collider is the short crouched capsule. */
  private crouchShape = false;
  /** Eye travel into the crouch, 0 standing .. 1 down; snapshotted per step like the position. */
  private crouchAmount = 0;
  private prevCrouch = 0;
  private curCrouch = 0;

  /** Maps a struck body's handle to its owner; null gets a direct impulse. */
  private shoveLookup: (bodyHandle: number) => ShoveOwner = () => null;
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
  // Crouch scratch: the collider's offset down its body, and the headroom probe.
  private readonly offsetScratch = { x: 0, y: 0, z: 0 };
  private readonly headroomPos = { x: 0, y: 0, z: 0 };
  private readonly headroomRot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly headroomShape = new RAPIER.Capsule(HEADROOM_HALF_HEIGHT, HEADROOM_RADIUS);
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
   * Installs the lookup mapping a struck body's handle to its `Shoveable` owner, or
   * `IMMOVABLE`. Defaults to null (no owner), so this file stands alone and every
   * dynamic body gets the direct impulse; `main.ts` wires vehicles and footballs in.
   */
  setShoveLookup(lookup: (bodyHandle: number) => ShoveOwner): void {
    this.shoveLookup = lookup;
  }

  /**
   * Body origin — the standing capsule's centre, crouched or not — RELATIVE to the
   * floating origin. Use this for anything compared against a Rapier body or written
   * into the relative scene graph; `absolutePosition` is the same point in absolute
   * world coordinates.
   */
  get position(): { x: number; y: number; z: number } {
    const t = this.body.translation(this.posScratch);
    return { x: t.x, y: t.y, z: t.z };
  }

  /**
   * Body origin (the standing capsule's centre) in ABSOLUTE world coordinates, for
   * consumers that sample the world (terrain height, rescue). `position` stays relative
   * so nobody has to un-rebase a Rapier translation to do a distance check against a body.
   */
  get absolutePosition(): { x: number; y: number; z: number } {
    const t = this.body.translation(this.posScratch);
    return { x: t.x + this.origin.x, y: t.y, z: t.z + this.origin.z };
  }

  /**
   * Latches the capsule position and the crouch after the physics step that moved
   * them. Call once per fixed step, after `physics.step()`.
   */
  postStep(): void {
    const t = this.body.translation(this.posScratch);
    if (!this.snapshotPrimed) {
      this.prevStep.x = t.x;
      this.prevStep.y = t.y;
      this.prevStep.z = t.z;
      this.prevCrouch = this.crouchAmount;
      this.snapshotPrimed = true;
    } else {
      this.prevStep.x = this.curStep.x;
      this.prevStep.y = this.curStep.y;
      this.prevStep.z = this.curStep.z;
      this.prevCrouch = this.curCrouch;
    }
    this.curStep.x = t.x;
    this.curStep.y = t.y;
    this.curStep.z = t.z;
    this.curCrouch = this.crouchAmount;
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
   * How far below standing the eye is at render time, metres: 0 standing, 0.67 in a
   * full crouch, interpolated between the last two fixed steps and eased so the head
   * settles into the squat rather than stopping dead. The camera's foot mode takes it
   * off its standing eye height, and interaction picks from the camera's eye, so reach
   * and aim follow the lowered head.
   */
  interpolatedEyeDrop(alpha: number): number {
    const t = this.prevCrouch + (this.curCrouch - this.prevCrouch) * alpha;
    return t * t * (3 - 2 * t) * CROUCH_EYE_DROP;
  }

  /** The collider is the short crouched capsule (the eye may still be on its way down or up). */
  get crouched(): boolean {
    return this.crouchShape;
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

  /** Capsule collider used to enumerate actual post-solver impacts while on foot. */
  get collisionCollider(): RAPIER.Collider {
    return this.collider;
  }

  /** Removes the capsule from the world while seated in a car (and restores it on foot). */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.body.setEnabled(enabled);
    if (enabled) this.verticalVelocity = 0;
    // Sitting down in a car ends a crouch; the player steps out standing.
    else this.standNow();
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
    // The spot was chosen for a standing player (a car exit, a rescue): arrive standing.
    this.standNow();
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

  /**
   * Swaps the collider between the standing and the crouched capsule. The short one
   * hangs `CROUCH_CENTRE_DROP` down its body, so both share the feet and the body origin
   * never moves. The collider's world pose is written too: Rapier only re-derives an
   * attached collider's pose from its offset inside the next step, and the character
   * controller runs before that step.
   */
  private setCrouchShape(crouched: boolean): void {
    this.crouchShape = crouched;
    const drop = crouched ? CROUCH_CENTRE_DROP : 0;
    this.collider.setHalfHeight(crouched ? CROUCH_HALF_HEIGHT : CAPSULE_HALF_HEIGHT);
    this.offsetScratch.y = -drop;
    this.collider.setTranslationWrtParent(this.offsetScratch);
    const t = this.body.translation(this.posScratch);
    t.y -= drop;
    this.collider.setTranslation(t);
  }

  /** Nothing solid in the space the standing capsule adds above the crouched one. */
  private headroomClear(): boolean {
    const t = this.body.translation(this.posScratch);
    this.headroomPos.x = t.x;
    this.headroomPos.y = t.y + HEADROOM_CENTRE_RISE;
    this.headroomPos.z = t.z;
    return (
      this.physics.world.intersectionWithShape(
        this.headroomPos,
        this.headroomRot,
        this.headroomShape,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        this.body,
      ) === null
    );
  }

  /** Up at once, no headroom asked: entering a car and teleports (see their callers). */
  private standNow(): void {
    this.crouchWanted = false;
    if (this.crouchShape) this.setCrouchShape(false);
    this.crouchAmount = 0;
    this.prevCrouch = 0;
    this.curCrouch = 0;
  }

  fixedUpdate(dt: number, input: InputFrame, cameraYaw: number): void {
    if (!this.enabled) return;

    // The camera owns yaw on foot; the player mirrors it. Pitch is accumulated
    // here because the CameraRig does not expose it.
    this.yaw = cameraYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, -1.55, 1.55);

    // C toggles the crouch; Space while crouched asks to stand instead of jumping. Going
    // down is always possible, standing up only with headroom: under a low roof the
    // player stays down and rises by himself once he has walked out from under it.
    if (input.toggleCrouch) this.crouchWanted = !this.crouchWanted;
    let jump = input.jump;
    if (jump && this.crouchWanted) {
      this.crouchWanted = false;
      jump = false;
    }
    if (this.crouchWanted !== this.crouchShape && (this.crouchWanted || this.headroomClear())) {
      this.setCrouchShape(this.crouchWanted);
    }
    const crouchStep = dt / CROUCH_SECONDS;
    this.crouchAmount = this.crouchShape
      ? Math.min(1, this.crouchAmount + crouchStep)
      : Math.max(0, this.crouchAmount - crouchStep);

    // Carried mass slows the player; a full pack halves the walk speed. A crouch walks
    // at its own pace whatever Shift says.
    const speedScale = 1 - this.carryRatio * 0.45;
    const speed =
      (this.crouchShape ? CROUCH_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED) * speedScale;

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

    if (jump && this.groundedFlag && !this.crouchShape) {
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

    this.controller.computeColliderMovement(this.collider, mv);

    // Shove the loose bodies the capsule is leaning into. The controller's built-in
    // impulse path is off (see the constructor); this is the only push, driven
    // explicitly so the speed can be capped per body.
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
      // Vehicles are never pushed by the player; footballs answer with their own kick.
      const owner = this.shoveLookup(body.handle);
      if (owner === IMMOVABLE) continue;
      if (owner) {
        owner.shove(px, pz, dt, Math.hypot(moveX, moveZ));
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
      // heavy crate and a light can creep at the same rate.
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
