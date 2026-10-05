/**
 * The car-to-car tow bar: an immobilised car dragged on a rigid link behind a
 * working one. Contract kind 17 is its user, but nothing here knows about
 * contracts — it is an ordinary world coupling between two `Vehicle`s.
 *
 * WHY A BAR AND NOT A ROPE.
 *
 * A rope is a maximum-distance constraint. It is slack whenever the towed car
 * closes on the tower — under braking, downhill, or over any bump — and then snaps
 * taut again, which is the classic way a tow goes wrong: the slack phase lets the
 * two chassis touch, and the taut phase delivers the whole stored momentum as one
 * impulse the moment the slack is gone. A rigid bar keeps the pair at a known
 * distance in compression AND tension, so there is no slack phase, no chassis to
 * chassis contact and no snap; braking is a compression the bar simply carries,
 * exactly like a real recovery bar.
 *
 * The joint is a Rapier spherical joint with the two anchors coincident — the
 * coupling the game already ships for trailers (`vehicle/trailer.ts`), and the one
 * this file's direct stretch correction was measured against. The bar's LENGTH is
 * made by the anchor offsets inside each body (tower rear face to towed front
 * face), and the joint leaves all three rotations free, which is what a bar with a
 * ball at each end transmits. One coupled-body model in the codebase, with the
 * coupling's measured drift behaviour already known.
 *
 * WHY THE TOWED CAR BRAKES WITH THE TOWER.
 *
 * A free-rolling towed car pushes its whole mass into the tower through the
 * fixed-length joint, and the solver's positional error under that load is exactly
 * the judder the trailer's `enforceHitch` was written to remove (the measurement at
 * the top of trailer.ts: 90th-percentile drift 0.18 m, 99th 0.40 m, while braking,
 * because uncorrected velocity mismatch is left to the solver). Letting the towed
 * car's service brakes follow the tower's pedal — the coupling a truck's air line
 * makes, and the one trailer.ts already models — keeps the pair's relative speed
 * near zero under the hardest input and leaves the bar carrying tongue weight and
 * cornering load instead of every deceleration.
 *
 * The towed car still has no engine: it is stepped by `fixedUpdate` with no
 * throttle and no gear command, only a passive caster steer, so it rolls, steers
 * and brakes but never drives.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { WorldOrigin } from '../world/origin';
import type { Vehicle } from './vehicle';

/** Tow height above the car's own contact plane, m. The trailer's ball height. */
const HITCH_HEIGHT = 0.45;
/**
 * Each car's bumper face to the bar's eye, m. The joint's anchors sit at these
 * points, so the two bumpers end up `2 * COUPLER_OFFSET` apart — a 1.1 m bar,
 * which is the length of a real rigid recovery bar.
 */
const COUPLER_OFFSET = 0.55;
/**
 * Drift tolerance, m. The trailer's HITCH_TOLERANCE, for the same reason: a bar
 * does not stretch, so anything above this is the solver's positional error and is
 * removed directly after the step.
 */
const TOW_TOLERANCE = 0.002;
/**
 * Above this the coupling is not drifting, something was teleported — a save
 * loading, the fall-out-of-world rescue, a dev spawn. The correction stands down
 * and `hitch` re-seats the pair instead of yanking a car across the world.
 */
const TOW_MAX_CORRECTION = 1.6;
/**
 * Overstretch at which the bar SNAPS, m. Between TOW_TOLERANCE and this the pair is
 * pulled back together; above it the towed car is held by something (a snag, a
 * wall, a body jammed under it) and a real bar shears, so the coupling is dropped
 * and the towed car left standing where it is.
 *
 * Reachable only because the correction below is RATE-LIMITED — see the note there.
 * A correction that teleports the towed car onto its eye every step is unbreakable
 * by construction: measured in the bench, a towed car pinned every step was dragged
 * 47 m at 0.0 mm of stretch, which is not a bar.
 */
const TOW_BREAK_M = 1.2;
/**
 * Sustained-load break: eye stretch, m, and the seconds it must persist.
 *
 * A rigid bar cannot drag a snagged car through the world — the correction that
 * keeps the eye together is rate-limited (below), so a held car simply STALLS the
 * whole rig, which the bench measures: the tower's speed falls to 2.6 km/h, it
 * makes no progress, and the eye settles at a steady 25 mm of stretch instead of
 * the sub-millimetre it holds while free. That steady stretch IS the load: the bar
 * is carrying the tower's whole drive and nothing is moving. TOW_LOAD_M is 46x the
 * worst stretch ordinary towing measured (0.43 mm through the bend), so a bump or a
 * kerb cannot reach it, and 1.5 s makes sure a transient cannot either.
 */
const TOW_LOAD_M = 0.02;
const TOW_SNAG_S = 1.5;
/**
 * How fast the bar removes residual stretch, m/s, and the hardest tug it puts
 * through the towed car, m/s².
 *
 * A real bar is a strut: it can drag the car along, but it cannot move it through
 * the world it is jammed against. Both caps sit far above anything ordinary towing
 * needs — the measured residual with the correction on is sub-millimetre, and the
 * relative speed to cancel is a few cm/s — so normal towing is unaffected, while a
 * held car accumulates stretch at the tower's own speed minus these caps and
 * reaches TOW_BREAK_M in a fraction of a second.
 */
const TOW_CORRECTION_SPEED = 0.6;
const TOW_CORRECTION_ACCEL = 40;
/**
 * Yaw damper at the bar, s^-1: share of the two cars' relative yaw rate removed per
 * second, applied to the TOWED car alone.
 *
 * MEASURED, and the reason it exists: the coupling is a length constraint, and a
 * length constraint cannot see the one mode that actually kills a two-car tow. The
 * pair SNAKES — a yaw oscillation between the two bodies at a nearly constant eye
 * distance — and the bench found its critical speed at about 54 km/h: the straight
 * held 0.006 m/s of relative speed up to 54 km/h and then diverged inside two
 * seconds, with the bar's own stretch under 2 mm throughout, so the positional
 * correction never had anything to grip. A real flat tow suppresses the snake with
 * the towed car's self-aligning steering and nose weight; here the towed car's rack
 * holds whatever angle it is given, so the bar carries a friction damper instead. It
 * models nothing away — a bar transmits no yaw torque — it only removes the
 * oscillation.
 */
const TOW_YAW_DAMP = 16;
/** Below this the passive caster steer is not applied, m/s. */
const CASTER_MIN_SPEED_MPS = 0.8;
/** Share of the steering lock the caster correction may ask for. */
const CASTER_MAX_SHARE = 0.6;
const BAR_RADIUS = 0.05;
const EYE_RADIUS = 0.075;
/** Above this the bar-dropped car is still rolling and brakes itself, m/s. */
const COAST_SPEED_MPS = 0.6;
/** Give up on the coast after this long; the car is on its own brakes by then. */
const COAST_MAX_S = 12;

const matBar = new THREE.MeshStandardMaterial({
  color: 0x3f4145,
  roughness: 0.45,
  metalness: 0.75,
});

/** Local +Z: the bar's axis once the cylinder geometry is rotated onto it. */
const BAR_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * How far apart the two eyes may be and still be offered as a hitch, m. Larger than
 * the bar itself (the eyes COINCIDE once coupled, so an uncoupled pair can stand
 * nearly a bar-length apart), small enough that two cars merely parked near each
 * other do not qualify.
 */
export const TOW_COUPLE_RANGE_M = 2.4;

/**
 * Rotates a body-local offset into world axes by a quaternion. Plain numbers, not a
 * scratch object: the correction needs two of these live at once.
 */
function rotateLocal(
  p: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * p.z - q.z * p.y);
  const ty = 2 * (q.z * p.x - q.x * p.z);
  const tz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: p.x + q.w * tx + (q.y * tz - q.z * ty),
    y: p.y + q.w * ty + (q.z * tx - q.x * tz),
    z: p.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotates a world vector into a body's own frame by the conjugate of `q`. */
function rotateInverseLocal(
  v: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number } {
  const tx = 2 * (-q.y * v.z + q.z * v.y);
  const ty = 2 * (-q.z * v.x + q.x * v.z);
  const tz = 2 * (-q.x * v.y + q.y * v.x);
  return {
    x: v.x + q.w * tx + (-q.y * tz + q.z * ty),
    y: v.y + q.w * ty + (-q.z * tx + q.x * tz),
    z: v.z + q.w * tz + (-q.x * ty + q.y * tx),
  };
}

/** One live bar. */
interface TowLink {
  readonly towerId: string;
  readonly towedId: string;
  readonly joint: RAPIER.ImpulseJoint;
  readonly towerBody: RAPIER.RigidBody;
  readonly towedBody: RAPIER.RigidBody;
  readonly towerAnchor: { x: number; y: number; z: number };
  readonly towedAnchor: { x: number; y: number; z: number };
  readonly bar: THREE.Group;
  /** Reused frame for the towed car's own fixed step. */
  readonly input: InputFrame;
  /** Seconds the eye has been under sustained load; see TOW_LOAD_M. */
  loadFor: number;
}

/**
 * The bar's eyes, in each body's own frame.
 *
 * Rear of the tower and front of the towed car, because a towed car sits nose to
 * tail pointing the same way as the car pulling it. `contactPlaneLocalY` differs
 * between models, so each eye is at ITS OWN car's hitch height and the difference
 * is carried by the towed car's front suspension, exactly as a bar dictates the
 * nose height of the car behind.
 */
function towerAnchorOf(vehicle: Vehicle): { x: number; y: number; z: number } {
  return {
    x: 0,
    y: vehicle.contactPlaneLocalY + HITCH_HEIGHT,
    z: -vehicle.modelMeasure.halfExtents[2] - COUPLER_OFFSET,
  };
}

function towedAnchorOf(vehicle: Vehicle): { x: number; y: number; z: number } {
  return {
    x: 0,
    y: vehicle.contactPlaneLocalY + HITCH_HEIGHT,
    z: vehicle.modelMeasure.halfExtents[2] + COUPLER_OFFSET,
  };
}

/** Scratch for the chassis translation inside `towEyeWorld`; see its contract. */
const eyeScratch = { x: 0, y: 0, z: 0 };

/**
 * A car's tow eye in Rapier's own frame — the hitch point the prompt measures
 * between, and the point the bar's joint holds. The chassis translation there is
 * RELATIVE, which is all the prompt needs: both cars share the frame, so distances
 * between two eyes are the same as in absolute coordinates.
 *
 * `out` is the caller's receiver, so the prompt's per-tick test allocates nothing.
 */
export function towEyeWorld(
  vehicle: Vehicle,
  end: 'front' | 'rear',
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const t = vehicle.chassis.translation(eyeScratch);
  const local = end === 'rear' ? towerAnchorOf(vehicle) : towedAnchorOf(vehicle);
  const r = rotateLocal(local, vehicle.chassis.rotation());
  out.x = t.x + r.x;
  out.y = t.y + r.y;
  out.z = t.z + r.z;
  return out;
}

export class CarTowField {
  /** Live bars, keyed by the TOWED car's id — the one `CarState.towedBy` names. */
  private readonly links = new Map<string, TowLink>();
  /**
   * Cars whose bar has just been dropped while they were still rolling, and the
   * seconds they have left to brake themselves to a halt. `settle` PINS a car to the
   * spot it stands on, so handing a bar-dropped car straight to it would stop a car
   * doing 60 km/h in one step. They are stepped here with full service brake until
   * they stop, then become ordinary parked cars.
   */
  private readonly coasting = new Map<string, { input: InputFrame; remaining: number }>();
  /** Invisible holder that compiles the bar's program from boot; see the rule. */
  private readonly warmup = new THREE.Group();
  private readonly barGeometry: THREE.CylinderGeometry;
  private readonly eyeGeometry: THREE.SphereGeometry;
  private readonly vScratch = new THREE.Vector3();
  private readonly qScratch = new THREE.Quaternion();
  private readonly aScratch = new THREE.Vector3();
  private readonly bScratch = new THREE.Vector3();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly vehicleFor: (carId: string) => Vehicle | null,
    /** Called once when a live bar snaps under overstretch, for the toast. */
    private readonly onBreak: (towedCarId: string, towerCarId: string) => void,
  ) {
    // Cylinder axis along local +Z, so scaling z lengths the bar.
    this.barGeometry = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, 1, 8);
    this.barGeometry.rotateX(Math.PI / 2);
    this.eyeGeometry = new THREE.SphereGeometry(EYE_RADIUS, 6, 5);
    // One invisible instance of each shared material is enough for Three's
    // `compile` walk (traverse, not traverseVisible) to link the program at boot.
    const bar = new THREE.Mesh(this.barGeometry, matBar);
    bar.visible = false;
    this.warmup.add(bar);
    const eye = new THREE.Mesh(this.eyeGeometry, matBar);
    eye.visible = false;
    this.warmup.add(eye);
    scene.add(this.warmup);
  }

  /** True while this car is being pulled on a live bar. */
  isTowed(carId: string): boolean {
    return this.links.has(carId);
  }

  /**
   * True while this field is stepping the car — on a bar, or braking off one. The
   * composition root leaves these out of its `settle` loop.
   */
  stepping(carId: string): boolean {
    return this.links.has(carId) || this.coasting.has(carId);
  }

  /**
   * Couples `towed` behind `tower`, seating the towed car so the two eyes already
   * coincide before the joint exists — a joint whose anchors start apart is resolved
   * by the solver as an explosion. Records the coupling in state, so the bar
   * outlives a save, a chunk unload and the session.
   */
  hitch(tower: Vehicle, towerId: string, towed: Vehicle, towedId: string): void {
    this.drop(towedId, true);
    const towerAnchor = towerAnchorOf(tower);
    const towedAnchor = towedAnchorOf(towed);

    // Place the towed car so ITS eye lands on the tower's, carrying the tower's
    // rotation too: a pair put on the bar on a slope stands on the same slope.
    const r = tower.chassis.rotation();
    this.qScratch.set(r.x, r.y, r.z, r.w);
    const t = tower.chassis.translation();
    this.aScratch.set(t.x, t.y, t.z);
    this.bScratch.set(towerAnchor.x, towerAnchor.y, towerAnchor.z).applyQuaternion(this.qScratch);
    this.aScratch.add(this.bScratch);
    this.bScratch.set(towedAnchor.x, towedAnchor.y, towedAnchor.z).applyQuaternion(this.qScratch);
    this.aScratch.sub(this.bScratch);

    towed.chassis.setTranslation({ x: this.aScratch.x, y: this.aScratch.y, z: this.aScratch.z }, true);
    towed.chassis.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w }, true);
    towed.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    towed.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);

    const joint = this.physics.world.createImpulseJoint(
      this.physics.rapier.JointData.spherical(towerAnchor, towedAnchor),
      tower.chassis,
      towed.chassis,
      true,
    );
    // The bodies are a bar length apart, so contacts can stay on and stop one
    // chassis passing through the other in a jackknife or a reversing impact.
    joint.setContactsEnabled(true);

    const bar = new THREE.Group();
    const shaft = new THREE.Mesh(this.barGeometry, matBar);
    shaft.castShadow = true;
    shaft.receiveShadow = false;
    bar.add(shaft);
    for (const eye of [-0.5, 0.5]) {
      const ball = new THREE.Mesh(this.eyeGeometry, matBar);
      ball.position.z = eye;
      bar.add(ball);
    }
    this.scene.add(bar);
    const link: TowLink = {
      towerId,
      towedId,
      joint,
      towerBody: tower.chassis,
      towedBody: towed.chassis,
      towerAnchor,
      towedAnchor,
      bar,
      input: emptyInput(),
      loadFor: 0,
    };
    this.links.set(towedId, link);
    this.coasting.delete(towedId);
    this.world.apply({ t: 'car_tow', carId: towedId, towerId });
    this.placeBar(link);
  }

  /**
   * Drops the bar on `towedCarId`, leaving the towed car exactly where it stands.
   */
  unhitch(towedCarId: string, record = true): void {
    this.drop(towedCarId, record);
  }

  private drop(towedCarId: string, record: boolean): void {
    const link = this.links.get(towedCarId);
    if (!link) return;
    this.links.delete(towedCarId);
    this.physics.world.removeImpulseJoint(link.joint, true);
    this.scene.remove(link.bar);
    // Still rolling when the bar went? It brakes itself to a halt rather than being
    // pinned where it stands; see `coasting`.
    const vehicle = this.vehicleFor(towedCarId);
    if (vehicle && Math.hypot(vehicle.chassis.linvel().x, vehicle.chassis.linvel().z) > COAST_SPEED_MPS) {
      this.coasting.set(towedCarId, { input: emptyInput(), remaining: COAST_MAX_S });
    }
    if (record && this.world.state.cars[towedCarId]?.towedBy != null) {
      this.world.apply({ t: 'car_tow', carId: towedCarId, towerId: null });
    }
  }

  /**
   * Reconciles the live bars with authoritative state, once a frame after the cars
   * have been materialised. State is the coupling: a car whose `towedBy` names a car
   * with no live body gets no joint, and a live joint whose state no longer claims a
   * coupling is dropped. This is what rebuilds a coupling after a reload and what
   * keeps a bar off a car whose tower left the active set.
   */
  syncFromState(): void {
    for (const carId of Object.keys(this.world.state.cars)) {
      const car = this.world.state.cars[carId];
      if (!car) continue;
      const towerId = car.towedBy ?? null;
      const existing = this.links.get(carId) ?? null;
      if (towerId === null) {
        if (existing) this.drop(carId, false);
        continue;
      }
      const tower = this.vehicleFor(towerId);
      const towed = this.vehicleFor(carId);
      if (!tower || !towed) {
        if (existing) this.drop(carId, false);
        continue;
      }
      if (existing && existing.towerId === towerId) continue;
      if (existing) this.drop(carId, false);
      this.hitch(tower, towerId, towed, carId);
    }
  }

  /**
   * The towed car's own step: suspension, wheels, brakes and cooling through the
   * ordinary vehicle path, with no throttle, no gear command and a caster steer.
   *
   * `brakeForCar` reports the TOWER's service-brake demand (0..1); the towed car's
   * brakes follow it, the coupling argued for at the top of the file.
   */
  fixedUpdate(dt: number, brakeForCar: (carId: string) => number): void {
    for (const link of this.links.values()) {
      const vehicle = this.vehicleFor(link.towedId);
      if (!vehicle) continue;
      const input = link.input;
      input.throttle = 0;
      input.reverse = false;
      input.handbrake = false;
      input.shift = 0;
      input.brake = Math.min(1, Math.max(0, brakeForCar(link.towerId)));
      input.steer = this.casterSteer(vehicle);
      vehicle.fixedUpdate(dt, input);
    }
    // Cars just off a bar: full service brake, straight wheels, until stopped.
    for (const [carId, coast] of this.coasting) {
      const vehicle = this.vehicleFor(carId);
      if (!vehicle) {
        this.coasting.delete(carId);
        continue;
      }
      const speed = Math.hypot(vehicle.chassis.linvel().x, vehicle.chassis.linvel().z);
      coast.remaining -= dt;
      if (coast.remaining <= 0 || speed < COAST_SPEED_MPS) {
        this.coasting.delete(carId);
        continue;
      }
      coast.input.brake = 1;
      coast.input.throttle = 0;
      coast.input.reverse = false;
      coast.input.handbrake = false;
      coast.input.steer = this.casterSteer(vehicle);
      vehicle.fixedUpdate(dt, coast.input);
    }
  }

  /**
   * The front-wheel angle that rolls the tyres along the direction the car is being
   * dragged, as a driver input. Frame-independent: the velocity is rotated into the
   * car's own frame and the angle from its forward axis is the wheel angle wanted,
   * so no steering sign convention has to be guessed in world space.
   */
  private casterSteer(vehicle: Vehicle): number {
    const lv = vehicle.chassis.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (speed < CASTER_MIN_SPEED_MPS) return 0;
    const local = rotateInverseLocal(lv, vehicle.chassis.rotation());
    // Not backwards: a car being dragged backwards must not steer to 180 degrees.
    if (local.z <= 0) return 0;
    const lock = vehicle.modelDef.steerLock;
    const wanted = Math.max(
      -lock * CASTER_MAX_SHARE,
      Math.min(lock * CASTER_MAX_SHARE, Math.atan2(local.x, local.z)),
    );
    return vehicle.steeringInputForWheelAngle(wanted, speed);
  }

  /**
   * Pulls the towed car's eye back onto the tower's ball, or drops the bar when the
   * overstretch is a snag rather than drift. Runs after the physics step and before
   * the vehicles' own post-step latches, so the corrected pose and speed are the
   * ones the renderer and the impact classifier see.
   *
   * The correction is RATE-LIMITED, which is what makes the break reachable: a bar
   * can pull a car along but cannot move it through something it is jammed against,
   * so a held towed car accumulates the whole of the tower's motion as stretch
   * instead of being teleported along at full strength.
   */
  postStep(dt: number): void {
    const refused: string[] = [];
    const maxMove = TOW_CORRECTION_SPEED * Math.max(dt, 0);
    const maxDeltaV = TOW_CORRECTION_ACCEL * Math.max(dt, 0);
    for (const link of this.links.values()) {
      const ct = link.towerBody.translation();
      const cr = link.towerBody.rotation();
      const tt = link.towedBody.translation();
      const tr = link.towedBody.rotation();
      const bl = rotateLocal(link.towerAnchor, cr);
      const el = rotateLocal(link.towedAnchor, tr);
      const dx = ct.x + bl.x - (tt.x + el.x);
      const dy = ct.y + bl.y - (tt.y + el.y);
      const dz = ct.z + bl.z - (tt.z + el.z);
      const err = Math.hypot(dx, dy, dz);

      // The yaw damper runs every step, not only when there is stretch to remove:
      // the snake it exists for happens at a millimetre of eye error. See TOW_YAW_DAMP.
      const cv0 = link.towerBody.angvel();
      const tv0 = link.towedBody.angvel();
      const wRel = cv0.y - tv0.y;
      const share = Math.min(1, TOW_YAW_DAMP * Math.max(dt, 0));
      if (share > 0 && Number.isFinite(wRel) && wRel !== 0) {
        link.towedBody.setAngvel(
          { x: tv0.x, y: tv0.y + wRel * share, z: tv0.z },
          true,
        );
      }

      if (!Number.isFinite(err) || err <= TOW_TOLERANCE) {
        link.loadFor = 0;
        continue;
      }
      if (err > TOW_BREAK_M) {
        refused.push(link.towedId);
        continue;
      }
      // Sustained load: the bar is carrying the rig and nothing is moving. See
      // TOW_LOAD_M — the eye settles at a steady stretch instead of the two bodies
      // separating, which is what a stalled tow actually looks like.
      link.loadFor = err >= TOW_LOAD_M ? link.loadFor + dt : 0;
      if (link.loadFor >= TOW_SNAG_S) {
        refused.push(link.towedId);
        continue;
      }
      if (err > TOW_MAX_CORRECTION) continue;

      // Cancel the drift: remove the towed car's velocity along the error, then move
      // the TOWED car alone back onto the eye, both at a bounded rate. The tower is
      // never moved — it is the car the camera is locked to and is simultaneously
      // being driven by its own tyre model, so moving it would fight the driver.
      // trailer.ts measured that choice for the same reason.
      const nx = dx / err;
      const ny = dy / err;
      const nz = dz / err;
      const cv = link.towerBody.linvel();
      const cw = link.towerBody.angvel();
      const tv = link.towedBody.linvel();
      const tw = link.towedBody.angvel();
      const vbx = cv.x + (cw.y * bl.z - cw.z * bl.y);
      const vby = cv.y + (cw.z * bl.x - cw.x * bl.z);
      const vbz = cv.z + (cw.x * bl.y - cw.y * bl.x);
      const vex = tv.x + (tw.y * el.z - tw.z * el.y);
      const vey = tv.y + (tw.z * el.x - tw.x * el.z);
      const vez = tv.z + (tw.x * el.y - tw.y * el.x);
      const vRel = (vbx - vex) * nx + (vby - vey) * ny + (vbz - vez) * nz;
      if (Number.isFinite(vRel) && vRel !== 0) {
        const dv = Math.max(-maxDeltaV, Math.min(maxDeltaV, vRel));
        link.towedBody.setLinvel(
          { x: tv.x + nx * dv, y: tv.y + ny * dv, z: tv.z + nz * dv },
          true,
        );
      }
      const move = Math.min(err, maxMove);
      link.towedBody.setTranslation(
        { x: tt.x + nx * move, y: tt.y + ny * move, z: tt.z + nz * move },
        true,
      );
    }
    for (const towedId of refused) {
      const link = this.links.get(towedId);
      if (!link) continue;
      this.onBreak(towedId, link.towerId);
      this.drop(towedId, true);
    }
  }

  /**
   * Places the drawn bar between the two bumper faces, which is where a real bar is
   * bolted (the joint's coincident point is its middle). Reads the live bodies, so
   * the bar is drawn on the corrected pose; the origin is added because the scene is
   * in absolute coordinates and the bodies are not.
   */
  private placeBar(link: TowLink): void {
    const ct = link.towerBody.translation();
    const cr = link.towerBody.rotation();
    const tt = link.towedBody.translation();
    const tr = link.towedBody.rotation();
    const rear = rotateLocal({ x: 0, y: link.towerAnchor.y, z: -link.towerAnchor.z - COUPLER_OFFSET }, cr);
    const front = rotateLocal({ x: 0, y: link.towedAnchor.y, z: link.towedAnchor.z - COUPLER_OFFSET }, tr);
    this.aScratch.set(ct.x + rear.x, ct.y + rear.y, ct.z + rear.z);
    this.bScratch.set(tt.x + front.x, tt.y + front.y, tt.z + front.z);
    this.bScratch.sub(this.aScratch);
    const length = Math.max(0.05, this.bScratch.length());
    this.bScratch.multiplyScalar(1 / length);
    const bar = link.bar;
    bar.position.set(
      this.aScratch.x + (this.bScratch.x * length) / 2 + this.origin.x,
      this.aScratch.y + (this.bScratch.y * length) / 2,
      this.aScratch.z + (this.bScratch.z * length) / 2 + this.origin.z,
    );
    this.qScratch.setFromUnitVectors(BAR_AXIS, this.bScratch);
    bar.quaternion.copy(this.qScratch);
    bar.scale.set(1, 1, length);
  }

  /** Draws every bar on this frame's corrected pose. */
  syncVisuals(): void {
    for (const link of this.links.values()) this.placeBar(link);
  }

  /** Drops every bar on this car, as either end. */
  remove(carId: string): void {
    const asTower: string[] = [];
    for (const link of this.links.values()) {
      if (link.towerId === carId) asTower.push(link.towedId);
    }
    for (const towedId of asTower) this.drop(towedId, false);
    this.drop(carId, false);
    this.coasting.delete(carId);
  }

  /** Releases every bar and the warm-up node while retaining authoritative state. */
  dispose(): void {
    for (const link of this.links.values()) {
      this.physics.world.removeImpulseJoint(link.joint, true);
      this.scene.remove(link.bar);
    }
    this.links.clear();
    this.coasting.clear();
    this.scene.remove(this.warmup);
    this.warmup.clear();
    this.barGeometry.dispose();
    this.eyeGeometry.dispose();
  }
}
