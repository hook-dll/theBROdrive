import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import type { InputFrame } from '../core/input';
import type { GameWorld } from '../game/state';
import type { Road } from '../world/road';

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

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export class Player {
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
  private enabled = true;
  private emitTimer = 0;

  private readonly moveScratch = { x: 0, y: 0, z: 0 };
  private readonly appliedScratch = { x: 0, y: 0, z: 0 };
  private readonly posScratch = { x: 0, y: 0, z: 0 };
  // Fixed-step position snapshots, for the same reason as the car: the camera and
  // the eye must move at constant velocity between steps, not jump by however many
  // steps happened to run before this frame.
  private readonly prevStep = { x: 0, y: 0, z: 0 };
  private readonly curStep = { x: 0, y: 0, z: 0 };
  private readonly interp = { x: 0, y: 0, z: 0 };
  private snapshotPrimed = false;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
  ) {
    this.controller = physics.world.createCharacterController(0.01);
    // Push dynamic bodies (cars) when walking into them, with a plausible mass.
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(75);
    this.controller.enableAutostep(STEP_HEIGHT, 0.2, true);
    this.controller.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB);
    this.controller.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE);
    this.controller.setSlideEnabled(true);
    this.controller.enableSnapToGround(0.3);

    const p = world.state.player;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );
    this.arcS = p.s;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
  }

  /** The shared `Road` instance, needed to maintain the arclength `s`. */
  setRoad(road: Road): void {
    this.road = road;
  }

  /** `carriedMass / massLimit` from the inventory; slows movement when heavy. */
  setCarriedRatio(ratio: number): void {
    this.carryRatio = clamp(ratio, 0, 1);
  }

  /** Capsule centre, in world space. */
  get position(): { x: number; y: number; z: number } {
    const t = this.body.translation(this.posScratch);
    return { x: t.x, y: t.y, z: t.z };
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

  /** Maintained arclength along the road. */
  get s(): number {
    return this.arcS;
  }

  get grounded(): boolean {
    return this.groundedFlag;
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
   * The arclength hint must be re-established here, and a hinted projection only
   * searches locally. That is fine for a short hop, but not when the player steps
   * out of a car 100 km down the road: `arcS` is frozen at wherever they got in,
   * because the on-foot update does not run while seated. A local search from a
   * stale hint would return nonsense, streaming the wrong chunks and dropping the
   * player through the world. So when the destination is far from the hint, pay for
   * one unhinted sweep — rare, and the only correct option.
   */
  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y: y + Player.FEET_OFFSET, z }, true);
    this.verticalVelocity = 0;
    // A teleport is a discontinuity: interpolating across it would fly the camera
    // from the old spot to the new one over a frame.
    this.snapshotPrimed = false;
    if (!this.road) return;
    const near = this.road.sampleAt(this.arcS);
    const driftSq = (near.x - x) ** 2 + (near.z - z) ** 2;
    this.arcS =
      driftSq > TELEPORT_REHOME_DISTANCE * TELEPORT_REHOME_DISTANCE
        ? this.road.project(x, z).s
        : this.road.project(x, z, this.arcS).s;
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

    this.controller.computeColliderMovement(this.collider, mv);
    const applied = this.controller.computedMovement(this.appliedScratch);
    const pos = this.body.translation(this.posScratch);
    this.body.setNextKinematicTranslation({
      x: pos.x + applied.x,
      y: pos.y + applied.y,
      z: pos.z + applied.z,
    });

    this.groundedFlag = this.controller.computedGrounded();

    if (this.road) {
      // Always pass the previous arc hint: without it, project sweeps the road.
      this.arcS = this.road.project(pos.x, pos.z, this.arcS).s;
    }

    this.emitTimer += dt;
    if (this.emitTimer >= MOVE_EMIT_INTERVAL) {
      this.emitTimer = 0;
      this.world.apply({
        t: 'player_move',
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: this.yaw,
        pitch: this.pitch,
        s: this.arcS,
      });
    }
  }
}
