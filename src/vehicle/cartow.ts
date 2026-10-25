/**
 * The car-to-car tow bar: an immobilised car dragged behind a working one on an
 * A-FRAME. Contract kind `towing` is its user, but nothing here knows about contracts
 * — it is an ordinary world coupling between two `Vehicle`s.
 *
 * WHAT A REAL TOW WITH NOBODY IN THE TOWED CAR IS.
 *
 * Russian traffic law allows a towed car with nobody at its wheel on ONE coupling
 * only: a rigid one "whose construction makes the towed vehicle follow the tower's
 * track" (ПДД РФ 20.1; 20.3 keeps the cars at most 4 m apart on it, 4-6 m on a rope;
 * 10.4 limits any tow of a car to 50 km/h). A rope, and a plain rigid bar with an eye
 * pinned at each end, both need a driver in the towed car: they pass force only ALONG
 * themselves, so nothing but a hand on its wheel keeps the towed car's nose on the
 * tower's line. The coupling that follows by construction is the A-frame (the
 * triangle bar, US "flat towing"): two arms bolted to the towed car's front, meeting
 * at a coupler on the tower's tow ball.
 *
 * Measured, not argued (`tools/tow-bench.ts`, `rope`): the same pairs on a 5 m rope
 * with nobody at the towed car's wheel or pedal, braking from 57 km/h, roll into the
 * tower's bumper (the Oka pair at 34 km/h, the Volga behind a UAZ at 30), and in the
 * road's tightest corner at 60 km/h the towed car runs 7.6-19 m off the tower's line
 * and swaps ends. So the bar is not optional — with nobody in the towed car it is the
 * only tow that works — and it has to be an A-frame, not a pinned bar.
 *
 * THE MODEL, PIECE BY PIECE, AND WHY.
 *
 *   The ball.  The tower's own tow ball, where `vehicle/trailer.ts` couples a
 *              trailer: `TOW_BALL_OFFSET` behind the measured rear face, at
 *              `HITCH_HEIGHT`. The bar used to pivot 0.55 m behind the bumper, which
 *              lengthened the lever the towed car's side force has about the tower's
 *              rear axle by that much and put the tower into a spin on the road's
 *              corners (the bench's `before` column).
 *   The arms.  Rigid in YAW against the towed car: the coupler's sideways place is
 *              fixed in the towed car's frame, so the towed nose goes where the ball
 *              goes and the car tracks. FREE in height: the arms are pinned to the
 *              towed car's front on a cross pin, so the frame swings up and down and
 *              each car rides its own springs. The first version held the towed nose
 *              to the ball's height as well, a stiff vertical link between two sprung
 *              cars that lifted the tower's rear axle by 380 N standing and rang it by
 *              ±1.2 kN on the move — grip taken off the very axle that has to carry
 *              the tow. A Rapier GENERIC joint is exactly this: the two horizontal
 *              axes of the towed car's frame locked at the coupler, its vertical and
 *              all three rotations free.
 *   The steering. FREE, as a flat-towed car's has to be: the castored front wheels
 *              swing to the line the front axle is travelling along, so they carry no
 *              side force and the towed car rolls behind on its rear axle like a
 *              trailer on its axle. The old caster aimed the wheels along the CHASSIS
 *              centre's travel, capped at 60% of lock — in a bend that is the wrong
 *              line, so the front tyres scrubbed sideways against the bar. Rolling
 *              backwards the wheels are held straight: a castored wheel reversing
 *              flips round, which is why every A-frame maker says not to back up far.
 *   The brakes. The towed car's service brakes follow the tower's pedal, the
 *              supplementary braking every flat-towed car over a light weight needs.
 *              Without them the tower's brakes stop both cars, at equal masses about
 *              half the deceleration, and the towed car's mass pushes the tower's tail
 *              through the ball in a braked corner. (A trailer is light enough to go
 *              without: `vehicle/trailer.ts`.)
 *
 * WHAT IS GONE. A yaw "damper" that copied the tower's yaw rate onto the towed car
 * at 16 s⁻¹ and gave the tower no reaction. It hid the wrong caster on the straight,
 * and in a corner it swung the towed car round its own centre instead of letting it
 * follow, which is the push that spun the tower. Nothing replaces it: with the right
 * caster and ball the snake it was written against decays on its own (the bench's
 * `kick`).
 *
 * WHAT IS STILL TRUE AND IS NOT A BUG. A car of the tower's own mass on the ball is a
 * trailer that puts about a third of its side force on the tower's tail — a light
 * trailer puts a tenth. The rig therefore loses its tail well below the tower's solo
 * cornering speed: in the road's tightest corner (85 m), which every tower holds alone
 * at 68 km/h, an Oka pair still holds at 62 (as fast as it gets there), a Zhiguli
 * pulling a VAZ-2110 lets go above 61 and a UAZ pulling a Volga above 58; the 140 m
 * corners hold at the 63-66 km/h the towers reach (`tools/tow-bench.ts`, `sweep`
 * and SWEEP). That is the reason for the law's 50 km/h, and it is left for the player
 * to feel.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { WorldOrigin } from '../world/origin';
import type { Vehicle } from './vehicle';

/**
 * Tow-ball height above the car's own contact plane, m, and the ball's place behind
 * the measured rear face: the trailer's ball (`vehicle/trailer.ts`), the same part.
 */
const HITCH_HEIGHT = 0.45;
const TOW_BALL_OFFSET = 0.12;
/**
 * The A-frame's reach, m: the towed car's front face to the coupler. With the ball's
 * own offset the bumpers stand 1.1 m apart, inside the law's 4 m (ПДД РФ 20.3) and
 * the length of a real car A-frame.
 */
const A_FRAME_REACH = 0.98;
/** Half the spread of the arms' feet on the towed car's front, m. */
const A_FRAME_HALF_SPAN = 0.32;
/**
 * Drift tolerance, m. The trailer's HITCH_TOLERANCE, for the same reason: a bar
 * does not stretch, so anything above this is the solver's positional error and is
 * removed directly after the step.
 */
const TOW_TOLERANCE = 0.002;
/**
 * Above this the coupling is not drifting, something was teleported — the
 * fall-out-of-world rescue, a dev jump. No snag gets here: a held towed car stretches
 * the eye a few centimetres a step and the bar snaps at TOW_BREAK_M on the way, while a
 * teleport opens the whole gap in one step. The correction stands down and `hitch`
 * re-seats the pair instead of yanking a car across the world or dropping the bar.
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
 * whole rig and the eye settles at a steady stretch of a few centimetres instead of
 * the sub-millimetre it holds while free. That steady stretch IS the load: the bar is
 * carrying the tower's whole drive and nothing is moving. 1.5 s makes sure a bump or
 * a kerb cannot reach it.
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
/** Below this the castored wheels are not steered, m/s: at a walk they stay put. */
const CASTER_MIN_SPEED_MPS = 0.8;
const BAR_RADIUS = 0.03;
const EYE_RADIUS = 0.06;
/** Above this the bar-dropped car is still rolling and brakes itself, m/s. */
const COAST_SPEED_MPS = 0.6;
/** Give up on the coast after this long; the car is on its own brakes by then. */
const COAST_MAX_S = 12;

const matBar = new THREE.MeshStandardMaterial({
  color: 0x3f4145,
  roughness: 0.45,
  metalness: 0.75,
});

/** Local +Z: an arm's axis once the cylinder geometry is rotated onto it. */
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
  /** The towed car's front axle, metres forward of its body centre: the caster's point. */
  readonly frontAxleZ: number;
  /** The coupler at the ball and the two arms, placed in world space every frame. */
  readonly bar: THREE.Group;
  readonly arms: readonly [THREE.Mesh, THREE.Mesh];
  readonly coupler: THREE.Mesh;
  /** Reused frame for the towed car's own fixed step. */
  readonly input: InputFrame;
  /** Seconds the eye has been under sustained load; see TOW_LOAD_M. */
  loadFor: number;
}

/**
 * The coupling points, in each body's own frame: the ball behind the tower's rear
 * face, the A-frame's coupler ahead of the towed car's front face. A towed car sits
 * nose to tail pointing the same way as the car pulling it. Each is at its OWN car's
 * hitch height; the A-frame's cross pin takes up the difference (see the file note).
 */
function towerAnchorOf(vehicle: Vehicle): { x: number; y: number; z: number } {
  return {
    x: 0,
    y: vehicle.contactPlaneLocalY + HITCH_HEIGHT,
    z: -vehicle.modelMeasure.halfExtents[2] - TOW_BALL_OFFSET,
  };
}

function towedAnchorOf(vehicle: Vehicle): { x: number; y: number; z: number } {
  return {
    x: 0,
    y: vehicle.contactPlaneLocalY + HITCH_HEIGHT,
    z: vehicle.modelMeasure.halfExtents[2] + A_FRAME_REACH,
  };
}

/** The front axle's place along the body, metres: the mean of the front wheels' mounts. */
function frontAxleZOf(vehicle: Vehicle): number {
  let sum = 0;
  let count = 0;
  for (const wheel of vehicle.modelMeasure.wheels) {
    if (!wheel.isFront) continue;
    sum += wheel.pos[2];
    count++;
  }
  return count > 0 ? sum / count : 0;
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
  private readonly coasting = new Map<string, { input: InputFrame; remaining: number; frontAxleZ: number }>();
  /** Invisible holder that compiles the bar's program from boot; see the rule. */
  private readonly warmup = new THREE.Group();
  private readonly barGeometry: THREE.CylinderGeometry;
  private readonly eyeGeometry: THREE.SphereGeometry;
  private readonly qScratch = new THREE.Quaternion();
  /** Per-step receivers for `postStep`'s snapped and teleported bars. */
  private readonly refused: string[] = [];
  private readonly reseat: string[] = [];
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
    // Cylinder axis along local +Z, so scaling z lengths the arm.
    this.barGeometry = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, 1, 8);
    this.barGeometry.rotateX(Math.PI / 2);
    this.eyeGeometry = new THREE.SphereGeometry(EYE_RADIUS, 6, 5);
    // One invisible instance of each shared material is enough for Three's
    // `compile` walk (traverse, not traverseVisible) to link the program at boot.
    // The arms cast shadows and the coupler does not, and the anchors copy that.
    const bar = new THREE.Mesh(this.barGeometry, matBar);
    bar.castShadow = true;
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

    // The A-frame (see the file note): the joint's X axis is the towed car's up, and
    // the two axes across it — the car's own sideways and fore-aft — are locked at the
    // coupler. Height and every rotation stay free. The towed car is the joint's first
    // body, so the locked axes are ITS axes, the frame the arms are bolted to.
    const rapier = this.physics.rapier;
    const joint = this.physics.world.createImpulseJoint(
      rapier.JointData.generic(
        towedAnchor,
        towerAnchor,
        { x: 0, y: 1, z: 0 },
        rapier.JointAxesMask.LinY | rapier.JointAxesMask.LinZ,
      ),
      towed.chassis,
      tower.chassis,
      true,
    );
    // The bodies are a bar length apart, so contacts can stay on and stop one
    // chassis passing through the other in a jackknife or a reversing impact.
    joint.setContactsEnabled(true);

    const bar = new THREE.Group();
    const arm = (): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.barGeometry, matBar);
      mesh.castShadow = true;
      bar.add(mesh);
      return mesh;
    };
    const arms: [THREE.Mesh, THREE.Mesh] = [arm(), arm()];
    const coupler = new THREE.Mesh(this.eyeGeometry, matBar);
    bar.add(coupler);
    this.scene.add(bar);
    const link: TowLink = {
      towerId,
      towedId,
      joint,
      towerBody: tower.chassis,
      towedBody: towed.chassis,
      towerAnchor,
      towedAnchor,
      frontAxleZ: frontAxleZOf(towed),
      bar,
      arms,
      coupler,
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
      this.coasting.set(towedCarId, { input: emptyInput(), remaining: COAST_MAX_S, frontAxleZ: link.frontAxleZ });
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
   * ordinary vehicle path, with no throttle, no gear command and castored steering.
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
      input.steer = this.casterSteer(vehicle, link.frontAxleZ);
      vehicle.fixedUpdate(dt, input);
    }
    // Cars just off a bar: full service brake, castored wheels, until stopped.
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
      coast.input.steer = this.casterSteer(vehicle, coast.frontAxleZ);
      vehicle.fixedUpdate(dt, coast.input);
    }
  }

  /**
   * CASTOR: the rack angle that rolls the front tyres along the line the front axle
   * is travelling — the chassis velocity plus its yaw carried out to the axle — as a
   * `direct` steering input. Frame-independent: the axle's velocity is rotated into
   * the car's own frame and its angle from the forward axis is the wheel angle wanted,
   * so no steering sign convention has to be guessed in world space. Rolling
   * backwards, or at a walk, the wheels are held straight.
   */
  private casterSteer(vehicle: Vehicle, frontAxleZ: number): number {
    const body = vehicle.chassis;
    const q = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    const arm = rotateLocal({ x: 0, y: 0, z: frontAxleZ }, q);
    const local = rotateInverseLocal(
      {
        x: v.x + (w.y * arm.z - w.z * arm.y),
        y: v.y + (w.z * arm.x - w.x * arm.z),
        z: v.z + (w.x * arm.y - w.y * arm.x),
      },
      q,
    );
    if (Math.hypot(local.x, local.z) < CASTER_MIN_SPEED_MPS || local.z <= 0) return 0;
    const lock = vehicle.modelDef.steerLock;
    return vehicle.steeringInputForWheelAngle(Math.max(-lock, Math.min(lock, Math.atan2(local.x, local.z))));
  }

  /**
   * Pulls the towed car's coupler back onto the tower's ball, or drops the bar when
   * the overstretch is a snag rather than drift. Runs after the physics step and
   * before the vehicles' own post-step latches, so the corrected pose and speed are
   * the ones the renderer and the impact classifier see.
   *
   * Only the error ACROSS the towed car's up axis is a stretch: along it the A-frame
   * swings on its pin, so that difference is the joint's free axis, not drift.
   *
   * The correction is RATE-LIMITED, which is what makes the break reachable: a bar
   * can pull a car along but cannot move it through something it is jammed against,
   * so a held towed car accumulates the whole of the tower's motion as stretch
   * instead of being teleported along at full strength.
   */
  postStep(dt: number): void {
    const refused = this.refused;
    const reseat = this.reseat;
    refused.length = 0;
    reseat.length = 0;
    const maxMove = TOW_CORRECTION_SPEED * Math.max(dt, 0);
    const maxDeltaV = TOW_CORRECTION_ACCEL * Math.max(dt, 0);
    for (const link of this.links.values()) {
      const ct = link.towerBody.translation();
      const cr = link.towerBody.rotation();
      const tt = link.towedBody.translation();
      const tr = link.towedBody.rotation();
      const bl = rotateLocal(link.towerAnchor, cr);
      const el = rotateLocal(link.towedAnchor, tr);
      const up = rotateLocal({ x: 0, y: 1, z: 0 }, tr);
      let dx = ct.x + bl.x - (tt.x + el.x);
      let dy = ct.y + bl.y - (tt.y + el.y);
      let dz = ct.z + bl.z - (tt.z + el.z);
      const swing = dx * up.x + dy * up.y + dz * up.z;
      dx -= up.x * swing;
      dy -= up.y * swing;
      dz -= up.z * swing;
      const err = Math.hypot(dx, dy, dz);

      if (!Number.isFinite(err) || err <= TOW_TOLERANCE) {
        link.loadFor = 0;
        continue;
      }
      if (err > TOW_MAX_CORRECTION) {
        reseat.push(link.towedId);
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
    for (const towedId of reseat) {
      const link = this.links.get(towedId);
      if (!link) continue;
      const tower = this.vehicleFor(link.towerId);
      const towed = this.vehicleFor(towedId);
      if (tower && towed) this.hitch(tower, link.towerId, towed, towedId);
    }
  }

  /**
   * Draws the A-frame on the live bodies: the coupler on the tower's ball and an arm
   * from it to each foot on the towed car's front face. The scene is in absolute
   * coordinates and the bodies are not, so the origin is added; the group itself
   * stays at the scene origin and only its children move.
   */
  private placeBar(link: TowLink): void {
    const ct = link.towerBody.translation();
    const cr = link.towerBody.rotation();
    const tt = link.towedBody.translation();
    const tr = link.towedBody.rotation();
    const ball = rotateLocal(link.towerAnchor, cr);
    const ballX = ct.x + ball.x + this.origin.x;
    const ballY = ct.y + ball.y;
    const ballZ = ct.z + ball.z + this.origin.z;
    link.coupler.position.set(ballX, ballY, ballZ);
    const footZ = link.towedAnchor.z - A_FRAME_REACH;
    for (let i = 0; i < 2; i++) {
      const foot = rotateLocal({ x: i === 0 ? -A_FRAME_HALF_SPAN : A_FRAME_HALF_SPAN, y: link.towedAnchor.y, z: footZ }, tr);
      this.aScratch.set(tt.x + foot.x + this.origin.x, tt.y + foot.y, tt.z + foot.z + this.origin.z);
      this.bScratch.set(ballX, ballY, ballZ).sub(this.aScratch);
      const length = Math.max(0.05, this.bScratch.length());
      this.bScratch.multiplyScalar(1 / length);
      const arm = link.arms[i]!;
      arm.position.copy(this.aScratch).addScaledVector(this.bScratch, length / 2);
      arm.quaternion.setFromUnitVectors(BAR_AXIS, this.bScratch);
      arm.scale.set(1, 1, length);
    }
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
