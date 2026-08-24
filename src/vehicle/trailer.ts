import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld, TrailerState } from '../game/state';
import type { Vehicle, WheelSprayState } from './vehicle';
import { createTrailerModel, type TrailerFit } from '../render/trailermodel';

/**
 * A towed trailer, and the drawbar hitch that couples it to any car.
 *
 * Deliberately not a `Vehicle`: no engine, gearbox, steering or driver. What it
 * shares with a car is the part that matters — Rapier's ray-cast suspension, via
 * its own `DynamicRayCastVehicleController` with two unpowered wheels. That is
 * what makes it behave like a trailer rather than a sliding crate: the wheels
 * resist sideways motion, so the thing tracks behind you, and when it stops
 * tracking you feel it in the car.
 *
 * The hitch is the interesting design decision. No car model in the catalogue has
 * a tow hook, and finding a bumper on an arbitrary GLB is guesswork — but every
 * car's REAR AXLE is measured off its mesh (`modelMeasure.wheels`, `isFront` false),
 * so that is the anchor. The trailer then grows a drawbar long enough to clear
 * whatever hangs behind that axle:
 *
 *     drawbar = (halfExtents.z + rearAxleZ) + HITCH_GAP        [rear overhang + gap]
 *
 * which is computed per coupling, so a long-tailed van and a stubby coupe both get
 * a hitch that sits in free air behind them instead of inside their own bodywork.
 * The drawbar mesh is scaled to match, so the visual never lies about the joint.
 *
 * Coupling is a spherical impulse joint: three free rotations, no relative
 * translation. That is a tow ball, and it gives yaw (following), pitch (cresting a
 * rise) and roll (one wheel over a rock) for free. Tongue weight transfers to the
 * car's rear axle through the joint rather than being faked by adding mass to the
 * car — which is the whole point of doing it with a real constraint.
 */

/** Bed half-extents, metres: a 1.8 x 0.7 x 2.8 m flatbed. */
const BED_HALF: readonly [number, number, number] = [0.9, 0.35, 1.4];
const WHEEL_RADIUS = 0.32;
/** Axle sits slightly behind the bed centre, which is what makes it track. */
const AXLE_Z = -0.2;
const TRACK_HALF = 0.95;
/** Tow-ball height above the ground, metres. Ordinary for a light trailer. */
const HITCH_HEIGHT = 0.45;
/** Clearance between the car's rear face and the bed's front face, metres. */
const HITCH_GAP = 0.35;
/** Shortest drawbar, for cars with almost no rear overhang. */
const DRAWBAR_MIN = 0.9;
/** Empty mass, kg. */
export const TRAILER_TARE_KG = 320;
/** Most it will carry, kg. Enough to ruin the handling of a 900 kg car. */
export const TRAILER_CAPACITY_KG = 700;

/**
 * Trailer brakes, and why a trailer needs its own.
 *
 * Without them a trailer is two free-rolling wheels: park it on any grade and it
 * rolls away, and under tow the car's brakes have to stop the trailer's mass too,
 * through the ball, which is what shunts a car around when it slows.
 *
 * These are in the same units as the car's (see the braking note in vehicle.ts):
 * Rapier's `setWheelBrake` takes a maximum braking IMPULSE (N·s), so holding a
 * deceleration `a` across `n` wheels for one step needs `a * mass * dt / n` each.
 * Sizing them off the trailer's OWN mass is the point of a braked trailer: it
 * stops itself instead of leaning on the tow ball.
 */
const SERVICE_BRAKE_DECEL = 9.6;
/**
 * Parking deceleration. Larger than the service brake because it has one job —
 * hold on any grade the road network can produce — and, unlike a moving stop, it
 * never has to share the tyre with cornering.
 */
const PARK_BRAKE_DECEL = 12.0;
/**
 * Rolling resistance, m/s². Always present on a coupled trailer, and the reason
 * the drawbar stops juddering.
 *
 * A trailer with literally zero longitudinal contact force is a mass on the end of
 * a spherical joint with NOTHING to damp it: the joint's positional error is
 * corrected softly over several steps, and with no ground friction in the loop that
 * correction rings instead of settling. Measured live at 60-90 km/h, unbraked, as
 * the distance between the ball's two anchor points (which should be coincident):
 *
 *   rolling resistance      mean error     95th pct
 *   0 (free-wheeling)         82 mm         401 mm
 *   0.2 m/s²                  27 mm         176 mm
 *   0.8 m/s²                  64 mm         321 mm
 *
 * So it is not "more is better": 0.2 damps the ringing, while 0.8 is enough retard
 * to start its own stick-slip against the tyre model. The same measurement is why
 * the effect was reported as juddering under power but rock-steady on the brakes —
 * braking locks the wheels, which is this damping taken to its limit (95th
 * percentile error on the brakes: 0.2 mm).
 *
 * 0.2 m/s² is ~2% of weight, the right order for an unloaded box trailer on rough
 * asphalt, and costs 0.02 g of drag — under a km/h of top speed.
 */
const ROLLING_RESISTANCE_DECEL = 0.2;

/**
 * Suspension, in the same per-kilogram units the car catalogue uses — see the
 * suspension note in carmodels.ts for why a rate is per kilogram and why TRAVEL vs
 * SAG is the load-bearing relationship.
 *
 * A trailer carries its whole mass on TWO wheels, so the same ride as a car needs
 * twice a car's rate: the body frequency is sqrt(wheels * stiffness), and 32 on two
 * wheels is 8.0 rad/s against the road car's 8.25 on four. The first attempt used a
 * car-like 20 with only 0.22 m of travel, which settled with 32 mm of compression
 * left (`tools/trailer-bench.mjs`) — so any hummock taller than that pushed the
 * spring onto its clamp, and Rapier both draws AND simulates a clamped wheel at the
 * clamp while the ground goes on rising. That is what put one wheel under the
 * terrain with the other sitting correctly on it: not an asymmetric trailer, an
 * exhausted spring under whichever wheel found the bump. The bench measures 166 mm
 * of reserve here, which swallows a 200 mm step under one wheel with both tyres
 * still on the ground.
 */
const SUSPENSION = {
  stiffness: 32,
  // Critical damping at k=32 is 11.31; these are 0.35 and 0.45 of it, the same
  // compression/rebound split the cars use.
  compression: 3.96,
  relaxation: 5.09,
  restLength: 0.3,
  maxTravel: 0.3,
  maxForce: 26000,
} as const;

/**
 * How far a settled wheel hangs below its mount, metres — MEASURED coupled and
 * empty on the bench in `tools/trailer-bench.mjs`, not derived from
 * `g / (wheels * stiffness)`. Rapier's ray-cast spring settles about a third
 * stiffer than that formula predicts (0.134 m of compression at k=32, not 0.153 m),
 * and this number is not free tuning: MOUNT_Y, the collider floor and
 * TRAILER_MODEL_FIT all key off it, so being wrong here rides the whole trailer at
 * the wrong height with its wheels tucked up into the arches.
 *
 * Re-measure with `node tools/trailer-bench.mjs 32 0.3 0.3 <hang>` after any change
 * to the spring above: the bench prints the settled bed height against the height
 * the art expects (0.670 m), and the two have to agree. They do at 0.166.
 */
const WHEEL_HANG = 0.166;
/** Wheel mount height in bed-local space, so a settled wheel centre sits at the bed underside. */
const MOUNT_Y = -BED_HALF[1] + WHEEL_HANG;
/** Ground level in bed-local space when settled. */
const GROUND_Y = -BED_HALF[1] - WHEEL_RADIUS;
/** Hitch anchor height in bed-local space. */
const HITCH_LOCAL_Y = GROUND_Y + HITCH_HEIGHT;

/**
 * The physics dimensions `render/trailermodel.ts` fits the GLB to. The art is the
 * variable here, not the physics: the bed, wheels and hitch above are authoritative
 * and the model is scaled, turned and slid until it agrees with them.
 */
export const TRAILER_MODEL_FIT: TrailerFit = {
  wheelRadius: WHEEL_RADIUS,
  axleZ: AXLE_Z,
  axleY: MOUNT_Y - WHEEL_HANG,
} as const;

/**
 * How high the bed centre sits above the ground once settled — the trailer's
 * analogue of a car's measured `spawnHeight`, used by the dev spawn tool to drop it
 * onto its wheels instead of through them.
 */
export const TRAILER_SPAWN_HEIGHT = BED_HALF[1] + WHEEL_RADIUS;

/** Bed half-length, metres: what a spawn has to clear to land behind the player. */
export const TRAILER_HALF_LENGTH = BED_HALF[2];

/**
 * The prop stand under the drawbar, and why a trailer needs one.
 *
 * Both wheels sit BEHIND the bed's centre of mass (AXLE_Z), which is what makes a
 * trailer track instead of snake, and it means the tongue is heavy: uncoupled, there
 * is nothing ahead of the axle holding the nose up, so the whole thing pivots onto
 * its drawbar and stands 18 degrees nose-down (measured, `tools/trailer-bench.mjs`,
 * the "standing" case). Real trailers answer this with a jockey wheel or a prop
 * stand, and so does this one: a leg from the drawbar to the ground, whose collider
 * and mesh exist only while the trailer is standing on its own.
 *
 * Wound down it takes the tongue weight and the bed stands level. Coupled, it is
 * gone entirely — a leg left down would drag over every crest and fight the ball for
 * the nose weight the car is supposed to be carrying.
 */
const PROP_Z = BED_HALF[2] + 0.45;
const PROP_LEG_HALF: readonly [number, number, number] = [0.04, (HITCH_LOCAL_Y - GROUND_Y) / 2, 0.04];
const PROP_LEG_CENTRE_Y = (HITCH_LOCAL_Y + GROUND_Y) / 2;
const PROP_FOOT_HALF: readonly [number, number, number] = [0.1, 0.02, 0.1];

/** Cargo crate, drawn on the bed and carrying the payload's centre of mass. */
const CRATE_HALF: readonly [number, number, number] = [0.7, 0.45, 1.1];
const CRATE_CENTRE_Y = BED_HALF[1] + CRATE_HALF[1];

/** Wheel spin is kept inside one turn, so a long haul cannot lose float precision. */
const TWO_PI = Math.PI * 2;

/**
 * Hitch drift correction.
 *
 * A tow ball does not stretch, but a spherical impulse joint does. Measured live at
 * 46-76 km/h, inside the fixed step, as the distance between the ball's two anchor
 * points (which are the same point by definition):
 *
 *   median            0.00006 m   <- exact almost always
 *   90th percentile   0.180 m
 *   99th percentile   0.403 m
 *   worst             0.874 m     <- 17% of steps over 0.10 m
 *
 * That is the reported judder, and it is not a convergence problem: quadrupling
 * `numSolverIterations` moved the 90th percentile only from 0.249 m to 0.197 m, and
 * Rapier pulls joint POSITION error back softly over many steps with no ERP knob
 * exposed for joints. It is also why the trailer was steady under braking (locked
 * wheels stop the drift accumulating) and why rolling resistance alone only cut the
 * mean: neither addresses recovery.
 *
 * So the coupling is enforced directly after each step: cancel the relative speed
 * at the ball along the error, with equal and opposite impulses so momentum is
 * conserved and nothing is pumped, then move both bodies back together, split
 * inverse to mass so the pair's centre of mass is preserved. The joint still owns
 * all three rotations — this only removes stretch, which the ball never had.
 *
 * Correcting POSITION alone was tried first and was visibly wrong in a way worth
 * recording: the trailer stopped juddering against the car and the whole car-trailer
 * pair started juddering together instead, because every uncorrected velocity
 * mismatch was left for the solver to react to on the next step.
 */
const HITCH_TOLERANCE = 0.002;
/**
 * Above this the coupling is not drifting, something has been teleported — a save
 * being loaded, the fall-out-of-world rescue, a dev spawn. Yanking the car toward a
 * trailer that is half a world away is how you launch both into the sky, so the
 * correction stands down and lets `hitchTo` re-seat the pair instead.
 */
const HITCH_MAX_CORRECTION = 1.5;


/**
 * Rotates a body-local offset into world axes by a quaternion, returning plain
 * numbers. Allocation-free at the call sites that matter is not worth a scratch
 * object here: `enforceHitch` needs two of these live at the same time, and the
 * shared `vScratch` cannot hold both.
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

const matSteel = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.6, metalness: 0.5 });
const matCrate = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.9, metalness: 0 });
/** Trailer local forward, for turning body rotation into a world heading. */
const FORWARD_LOCAL = { x: 0, y: 0, z: 1 } as const;
/**
 * Slip-speed floor, m/s. Mirrors main.ts's SPRAY_REF_SPEED and the tyre model's
 * reference: without it a stationary trailer with turning wheels reports infinite
 * slip.
 */
const SPRAY_SLIP_REFERENCE = 1.5;

export class Trailer {
  /**
   * One spray report per wheel, written in place every fixed step and read by the
   * renderer's dust pool. Mirrors Vehicle's contract exactly so the emitter cannot
   * tell a trailer wheel from a car wheel.
   */
  private readonly sprayStates: WheelSprayState[] = [];
  /** Reused contact-point receiver, so the spray refresh never allocates. */
  private readonly contactScratch = { x: 0, y: 0, z: 0 };
  /** Previous wheel rotation (rad), for differentiating into a spin rate. */
  private readonly prevWheelRotation: number[] = [];
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly root = new THREE.Group();
  private readonly wheelMeshes: THREE.Mesh[] = [];
  private readonly drawbar: THREE.Mesh;
  private readonly crate: THREE.Mesh;
  /** Prop stand: one collider and two meshes, all live only while uncoupled. */
  private readonly propCollider: RAPIER.Collider;
  private readonly propMeshes: THREE.Mesh[] = [];
  private readonly disposables: THREE.BufferGeometry[] = [];

  private joint: RAPIER.ImpulseJoint | null = null;
  /** Drawbar length of the current coupling, for the visual and for re-hitching. */
  private drawbarLength = DRAWBAR_MIN;
  /**
   * The towing chassis and both local anchors, held only while coupled. Needed by
   * `enforceHitch`, which runs every step and must not re-derive the geometry.
   */
  private hitchBody: RAPIER.RigidBody | null = null;
  private carAnchor: { x: number; y: number; z: number } | null = null;
  private trailerAnchor: { x: number; y: number; z: number } | null = null;

  /** Render interpolation snapshots, mirroring Vehicle's scheme. */
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly stepPos = new THREE.Vector3();
  private readonly stepQuat = new THREE.Quaternion();
  private snapshotPrimed = false;

  private readonly vScratch = new THREE.Vector3();
  private readonly qScratch = new THREE.Quaternion();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly state: TrailerState,
    private readonly scene: THREE.Scene,
  ) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(state.x, state.y, state.z)
      .setRotation({ x: state.qx, y: state.qy, z: state.qz, w: state.qw })
      .setAngularDamping(0.2)
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(desc);

    // Collider floor raised to the wheel-centre line, exactly as the car's is, so
    // the bed does not catch on the ground before the suspension has any travel.
    const colliderHalfY = (BED_HALF[1] - MOUNT_Y) / 2;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BED_HALF[0], colliderHalfY, BED_HALF[2])
        .setTranslation(0, MOUNT_Y + colliderHalfY, 0)
        .setDensity(0)
        .setFriction(0.5)
        .setRestitution(0.02),
      this.body,
    );

    // Prop stand (see PROP_Z above). A plain collider rather than a third ray-cast
    // wheel: it is a leg, not a spring, and the difference is what stops the parked
    // trailer bouncing on its nose. High friction, because a stand that slides is a
    // trailer that walks itself down a slope.
    this.propCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(PROP_LEG_HALF[0], PROP_LEG_HALF[1], PROP_LEG_HALF[2])
        .setTranslation(0, PROP_LEG_CENTRE_Y, PROP_Z)
        .setDensity(0)
        .setFriction(1.2)
        .setRestitution(0),
      this.body,
    );

    this.controller = new physics.rapier.DynamicRayCastVehicleController(
      this.body,
      physics.world.broadPhase,
      physics.world.narrowPhase,
      physics.world.bodies,
      physics.world.colliders,
    );
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    for (const side of [-1, 1]) {
      const index = this.controller.numWheels();
      this.controller.addWheel(
        { x: side * TRACK_HALF, y: MOUNT_Y, z: AXLE_Z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        SUSPENSION.restLength,
        WHEEL_RADIUS,
      );
      this.controller.setWheelSuspensionStiffness(index, SUSPENSION.stiffness);
      this.controller.setWheelSuspensionCompression(index, SUSPENSION.compression);
      this.controller.setWheelSuspensionRelaxation(index, SUSPENSION.relaxation);
      this.controller.setWheelMaxSuspensionTravel(index, SUSPENSION.maxTravel);
      this.controller.setWheelMaxSuspensionForce(index, SUSPENSION.maxForce);
      // Pre-allocated alongside the wheel, so the per-step refresh never allocates.
      this.sprayStates.push({
        contactX: 0,
        contactY: 0,
        contactZ: 0,
        forwardX: 0,
        forwardZ: 1,
        // A trailer wheel is never driven. The emitter no longer gates on this
        // (dust comes from SLIP, which is the whole reason a braked trailer throws
        // sand), but the field is part of the shared contract.
        driven: false,
        dust: 0,
        slipRatio: 0,
        slideT: 0,
        forwardSpeed: 0,
      });
      this.prevWheelRotation.push(0);
    }

    // --- Visuals -----------------------------------------------------------
    // Body and wheels come from the fitted GLB (render/trailermodel.ts). Their
    // geometry and materials are shared with every other trailer in the world, so
    // they are never disposed here — only the procedural drawbar and crate below
    // own geometry of their own.
    const model = createTrailerModel();
    this.root.add(model.body);

    // Unit-length bar along +Z, scaled per coupling so the drawn tongue always
    // reaches exactly to the joint.
    const barGeo = new THREE.BoxGeometry(0.09, 0.09, 1);
    this.disposables.push(barGeo);
    this.drawbar = new THREE.Mesh(barGeo, matSteel);
    this.drawbar.castShadow = true;
    this.root.add(this.drawbar);

    // The controller indexes wheels right (-1) first, so the visual list must be
    // built in the same order or syncVisuals reads the wrong side's suspension.
    model.rightWheel.position.set(-TRACK_HALF, MOUNT_Y - WHEEL_HANG, AXLE_Z);
    model.leftWheel.position.set(TRACK_HALF, MOUNT_Y - WHEEL_HANG, AXLE_Z);
    this.root.add(model.rightWheel);
    this.root.add(model.leftWheel);
    this.wheelMeshes.push(model.rightWheel, model.leftWheel);

    const crateGeo = new THREE.BoxGeometry(CRATE_HALF[0] * 2, CRATE_HALF[1] * 2, CRATE_HALF[2] * 2);
    this.disposables.push(crateGeo);
    this.crate = new THREE.Mesh(crateGeo, matCrate);
    this.crate.position.set(0, CRATE_CENTRE_Y, 0);
    this.crate.castShadow = true;
    this.root.add(this.crate);

    // The prop stand's leg and foot, matching the collider above.
    const legGeo = new THREE.BoxGeometry(PROP_LEG_HALF[0] * 2, PROP_LEG_HALF[1] * 2, PROP_LEG_HALF[2] * 2);
    const footGeo = new THREE.BoxGeometry(PROP_FOOT_HALF[0] * 2, PROP_FOOT_HALF[1] * 2, PROP_FOOT_HALF[2] * 2);
    this.disposables.push(legGeo, footGeo);
    const leg = new THREE.Mesh(legGeo, matSteel);
    leg.position.set(0, PROP_LEG_CENTRE_Y, PROP_Z);
    const foot = new THREE.Mesh(footGeo, matSteel);
    foot.position.set(0, GROUND_Y + PROP_FOOT_HALF[1], PROP_Z);
    for (const mesh of [leg, foot]) {
      mesh.castShadow = true;
      this.propMeshes.push(mesh);
      this.root.add(mesh);
    }

    scene.add(this.root);

    this.setDrawbarVisual(DRAWBAR_MIN);
    // A trailer restored from a save may already be coupled; the second pass in
    // TrailerField re-hitches it, but until then the stand matches its state.
    this.setPropStand(this.state.hitchedTo === null);
    this.applyMass();
    this.syncVisuals(1);
  }

  get id(): string {
    return this.state.id;
  }

  get rigidBody(): RAPIER.RigidBody {
    return this.body;
  }

  get hitchedTo(): string | null {
    return this.state.hitchedTo;
  }

  get cargoKg(): number {
    return this.state.cargoKg;
  }

  /** Total mass on the road: tare plus whatever is on the bed. */
  get massKg(): number {
    return TRAILER_TARE_KG + this.state.cargoKg;
  }

  /**
   * Loads or empties the bed. Mass and centre of mass are the only things cargo
   * changes — there is no fragility, no lashing, no spoilage. A heavy load rides
   * high on the bed, so it raises the combined centre of mass and the trailer
   * starts wanting to swap ends; that is the entire difficulty of hauling.
   */
  setCargo(cargoKg: number): void {
    const clamped = Math.min(Math.max(0, cargoKg), TRAILER_CAPACITY_KG);
    if (clamped === this.state.cargoKg) return;
    this.world.apply({ t: 'trailer_cargo', trailerId: this.state.id, cargoKg: clamped });
    this.applyMass();
  }

  /**
   * Couples to a car, computing the drawbar from that car's own measurements and
   * teleporting the trailer into place first.
   *
   * The teleport is not cosmetic: a spherical joint whose anchors start metres
   * apart is resolved by the solver as an explosion, so the trailer must already be
   * standing where the constraint wants it before the joint exists.
   */
  hitchTo(vehicle: Vehicle, carId: string): void {
    this.unhitch();

    const measure = vehicle.modelMeasure;
    const rear = measure.wheels.filter((w) => !w.isFront);
    if (rear.length === 0) return;
    let rearZ = 0;
    for (const w of rear) rearZ += w.pos[2];
    rearZ /= rear.length;

    // Rear overhang: how much bodywork sits behind the axle we are hooking to.
    const overhang = Math.max(0, measure.halfExtents[2] + rearZ);
    this.drawbarLength = Math.max(DRAWBAR_MIN, overhang + HITCH_GAP);

    // Tow-ball height. Both ends measure HITCH_HEIGHT up from THEIR OWN settled
    // ground plane, which is the only way a ball on one body and a socket on
    // another end up at the same height — and a coupling whose two anchors sit at
    // different heights is a spherical joint holding the drawbar up or down, i.e. a
    // trailer that stands nose-up on level ground.
    //
    // The car's plane comes from `contactPlaneLocalY`, not from its measured wheel
    // mounts: Vehicle corrects a model's ride height when it builds the suspension
    // (RIDE_LIFT_MAX, up to 0.15 m), so `wheels[].pos[1] - radius` is not where that
    // car's tyres actually meet the road. Using it is what tilted the trailer.
    const carAnchor = { x: 0, y: vehicle.contactPlaneLocalY + HITCH_HEIGHT, z: rearZ };
    const trailerAnchor = { x: 0, y: HITCH_LOCAL_Y, z: BED_HALF[2] + this.drawbarLength };

    // Place the trailer so its anchor already coincides with the car's, facing the
    // same way. The car's rotation carries pitch and roll too, so a car parked on a
    // slope gets a trailer on the same slope rather than one buried in the hill.
    const t = vehicle.chassis.translation();
    const r = vehicle.chassis.rotation();
    this.qScratch.set(r.x, r.y, r.z, r.w);
    const anchorWorld = this.vScratch
      .set(carAnchor.x, carAnchor.y, carAnchor.z)
      .applyQuaternion(this.qScratch)
      .add(new THREE.Vector3(t.x, t.y, t.z));
    const backFromAnchor = new THREE.Vector3(
      trailerAnchor.x,
      trailerAnchor.y,
      trailerAnchor.z,
    ).applyQuaternion(this.qScratch);
    const origin = anchorWorld.clone().sub(backFromAnchor);

    this.body.setTranslation({ x: origin.x, y: origin.y, z: origin.z }, true);
    this.body.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snapshotPrimed = false;

    this.joint = this.physics.world.createImpulseJoint(
      RAPIER.JointData.spherical(carAnchor, trailerAnchor),
      vehicle.chassis,
      this.body,
      true,
    );
    // Kept for the post-step hitch correction below: the body on the other end and
    // both local anchors, so the coupling can be checked every step without
    // re-deriving the geometry or reaching back into the Vehicle.
    this.hitchBody = vehicle.chassis;
    this.carAnchor = carAnchor;
    this.trailerAnchor = trailerAnchor;
    // The drawbar reaches under the car's tail; without this the two colliders
    // fight the joint and the trailer jitters against the bumper.
    this.joint.setContactsEnabled(false);

    this.setDrawbarVisual(this.drawbarLength);
    // Stand wound up: the ball has the nose weight now.
    this.setPropStand(false);
    this.world.apply({ t: 'trailer_hitch', trailerId: this.state.id, carId });
    this.pushTransform();
  }

  /**
   * Drops the coupling. The trailer stays exactly where it is, standing on its own
   * wheels and its prop stand — which goes back down here, because the tongue weight
   * has nowhere else to go the moment the ball is gone.
   */
  unhitch(): void {
    if (this.joint) {
      this.physics.world.removeImpulseJoint(this.joint, true);
      this.joint = null;
    }
    // The correction must stop the instant the coupling does, or it would keep
    // dragging a dropped trailer toward a car that has driven away.
    this.hitchBody = null;
    this.carAnchor = null;
    this.trailerAnchor = null;
    this.setPropStand(true);
    if (this.state.hitchedTo !== null) {
      this.world.apply({ t: 'trailer_hitch', trailerId: this.state.id, carId: null });
    }
  }

  /** True while a joint exists, i.e. the coupling is live in the solver. */
  get coupled(): boolean {
    return this.joint !== null;
  }

  /**
   * Suspension and brakes.
   *
   * `carBrake` is the towing car's SERVICE brake demand, 0..1 — the pedal, not the
   * handbrake. A real light trailer's brakes are actuated by the drawbar, so they
   * come on with the car's and let go with it; mirroring the pedal is that
   * behaviour without inventing an overrun mechanism the player cannot see.
   *
   * Uncoupled, the brakes are simply ON. That is the whole answer to a trailer
   * parked on a grade rolling away: a real one is left with its handbrake wound on,
   * and since a trailer with no car attached is by definition parked, there is no
   * state to track and nothing for the player to remember. Dropping a trailer
   * therefore leaves it exactly where it was dropped.
   */
  fixedUpdate(dt: number, carBrake = 0): void {
    const wheels = this.controller.numWheels();
    if (wheels > 0) {
      // Coupled: the pedal, but never less than rolling resistance — the tyres are
      // always dragging a little, and that little is what keeps the ball quiet.
      const decel = this.coupled
        ? Math.max(
            ROLLING_RESISTANCE_DECEL,
            Math.min(1, Math.max(0, carBrake)) * SERVICE_BRAKE_DECEL,
          )
        : PARK_BRAKE_DECEL;
      // Impulse per wheel for this step: see the brake note at the top of the file.
      const impulse = (decel * this.massKg * dt) / wheels;
      for (let i = 0; i < wheels; i++) this.controller.setWheelBrake(i, impulse);
    }
    this.controller.updateVehicle(dt);
    this.refreshSpray(dt);
  }

  /**
   * Copies per-wheel contact, slip and surface data into `sprayStates` for the dust
   * pool. Never allocates.
   *
   * A trailer wheel has no drive and no tyre model of its own, so its slip is
   * differentiated from Rapier's own integrated wheel rotation: the controller
   * spins a rolling wheel from the contact point's speed, and a braked one stops
   * turning, so `omega*r - v` is exactly the slip that throws sand. That is the
   * same quantity the car reports, arrived at from the other direction.
   */
  private refreshSpray(dt: number): void {
    const n = this.sprayStates.length;
    if (n === 0 || dt <= 0) return;
    const rot = this.body.rotation();
    // Trailer forward is its local +Z (the drawbar points forward along +Z).
    const fwd = rotateLocal(FORWARD_LOCAL, rot);
    const fLen = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fLen;
    const fz = fwd.z / fLen;
    const lv = this.body.linvel();
    const forwardSpeed = lv.x * fx + lv.z * fz;

    for (let i = 0; i < n; i++) {
      const s = this.sprayStates[i];
      const spin = ((this.controller.wheelRotation(i) ?? 0) - this.prevWheelRotation[i]) / dt;
      this.prevWheelRotation[i] = this.controller.wheelRotation(i) ?? 0;

      if (!this.controller.wheelIsInContact(i)) {
        s.dust = 0;
        s.slipRatio = 0;
        s.slideT = 0;
        continue;
      }
      const cp = this.controller.wheelContactPoint(i, this.contactScratch);
      if (cp) {
        s.contactX = cp.x;
        s.contactY = cp.y;
        s.contactZ = cp.z;
      }
      s.forwardX = fx;
      s.forwardZ = fz;
      s.forwardSpeed = forwardSpeed;
      const ground = this.controller.wheelGroundObject(i);
      s.dust = this.physics.surfaces.lookup(ground ? ground.handle : null).dust;
      const reference = Math.max(Math.abs(forwardSpeed), SPRAY_SLIP_REFERENCE);
      s.slipRatio = (spin * WHEEL_RADIUS - forwardSpeed) / reference;
      // No friction circle to report: a trailer tyre is only ever sliding
      // longitudinally (locked) or dragged sideways, and the longitudinal term
      // above already carries the locked case.
      s.slideT = 0;
    }
  }

  /** One spray report per wheel; same contract as Vehicle's. */
  get wheelSpray(): readonly WheelSprayState[] {
    return this.sprayStates;
  }

  /**
   * Pulls the drawbar eye back onto the tow ball. See HITCH_TOLERANCE above for the
   * measurements and for why the joint alone is not enough.
   *
   * Runs after the step and before the render snapshots are latched, so the drawn
   * pose is the corrected one and there is no visual seam.
   */
  private enforceHitch(): void {
    const car = this.hitchBody;
    const ca = this.carAnchor;
    const ta = this.trailerAnchor;
    if (!this.joint || !car || !ca || !ta) return;

    const ct = car.translation();
    const cr = car.rotation();
    const tt = this.body.translation();
    const trot = this.body.rotation();

    // Both anchors in world space. The rotated offsets are kept as plain numbers
    // rather than in the shared scratch vectors, because both are needed at once
    // (the velocity terms below use omega x r for each end).
    const bl = rotateLocal(ca, cr);
    const ballX = ct.x + bl.x, ballY = ct.y + bl.y, ballZ = ct.z + bl.z;
    const el = rotateLocal(ta, trot);
    const eyeX = tt.x + el.x, eyeY = tt.y + el.y, eyeZ = tt.z + el.z;

    const dx = ballX - eyeX, dy = ballY - eyeY, dz = ballZ - eyeZ;
    const err = Math.hypot(dx, dy, dz);
    if (err <= HITCH_TOLERANCE || err > HITCH_MAX_CORRECTION) return;

    const mC = car.mass();
    const mT = this.body.mass();
    if (!(mC > 0) || !(mT > 0)) return;

    // Everything below moves the TRAILER and never the car.
    //
    // Sharing the correction between both bodies was tried, mass-weighted, with
    // equal and opposite impulses so momentum was conserved. It was much worse:
    // the pair juddered together, harder the faster you went. Two reasons, and both
    // matter more than the momentum bookkeeping. The car is what the camera is
    // locked to, so a millimetre of car correction is more visible than a
    // centimetre of trailer correction; and the car is simultaneously being driven
    // by its own tyre model, which reacts to being moved, so the two fought and the
    // exchange grew with speed.
    //
    // Leaving the car alone is also the better physics of the two. The reaction a
    // 320 kg trailer's drift would put through the ball is small next to a 1240 kg
    // car on four loaded tyres, and the real load transfer — tongue weight, the
    // trailer braking the car — still goes through the joint, which is untouched.
    const nx = dx / err, ny = dy / err, nz = dz / err;
    const cv = car.linvel(), cw = car.angvel();
    const tv = this.body.linvel(), tw = this.body.angvel();
    // Velocity at each anchor: v + omega x r.
    const vbx = cv.x + (cw.y * bl.z - cw.z * bl.y);
    const vby = cv.y + (cw.z * bl.x - cw.x * bl.z);
    const vbz = cv.z + (cw.x * bl.y - cw.y * bl.x);
    const vex = tv.x + (tw.y * el.z - tw.z * el.y);
    const vey = tv.y + (tw.z * el.x - tw.x * el.z);
    const vez = tv.z + (tw.x * el.y - tw.y * el.x);
    // Drift RATE along the error. Cancelling it is what stops the correction from
    // being re-earned every step, which is the difference between a coupling that
    // settles and one that rings.
    const vRel = (vbx - vex) * nx + (vby - vey) * ny + (vbz - vez) * nz;
    if (Number.isFinite(vRel) && vRel !== 0) {
      this.body.setLinvel(
        { x: tv.x + nx * vRel, y: tv.y + ny * vRel, z: tv.z + nz * vRel },
        true,
      );
    }

    this.body.setTranslation({ x: tt.x + dx, y: tt.y + dy, z: tt.z + dz }, true);
  }

  postStep(): void {
    this.enforceHitch();
    const t = this.body.translation();
    const r = this.body.rotation();
    if (!this.snapshotPrimed) {
      this.prevPos.set(t.x, t.y, t.z);
      this.prevQuat.set(r.x, r.y, r.z, r.w);
      this.snapshotPrimed = true;
    } else {
      this.prevPos.copy(this.stepPos);
      this.prevQuat.copy(this.stepQuat);
    }
    this.stepPos.set(t.x, t.y, t.z);
    this.stepQuat.set(r.x, r.y, r.z, r.w);
  }

  syncVisuals(alpha: number): void {
    if (!this.snapshotPrimed) {
      const t = this.body.translation();
      const r = this.body.rotation();
      this.root.position.set(t.x, t.y, t.z);
      this.root.quaternion.set(r.x, r.y, r.z, r.w);
    } else {
      this.root.position.lerpVectors(this.prevPos, this.stepPos, alpha);
      this.root.quaternion.slerpQuaternions(this.prevQuat, this.stepQuat, alpha);
    }

    // Wheels ride their suspension and turn with the road. Both come off the
    // controller, so the drawn wheel is the one the solver used.
    //
    // The spin is Rapier's own `wheelRotation`, integrated from the contact point's
    // forward speed. A car cannot use that (it owns wheel torque, lock-up and
    // wheelspin, so it integrates its own `drawnSpin`) but a trailer wheel has no
    // drive and no brake: its rotation IS the ground's, and reading it back is both
    // free and exactly right. Without this the wheels were drawn stationary while
    // the trailer rolled — the one part of a trailer nobody can help watching.
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const suspension = this.controller.wheelSuspensionLength(i) ?? SUSPENSION.restLength;
      const mesh = this.wheelMeshes[i];
      mesh.position.y = MOUNT_Y - suspension;
      mesh.rotation.x = (this.controller.wheelRotation(i) ?? 0) % TWO_PI;
    }

    this.crate.visible = this.state.cargoKg > 0;
  }

  /** Pushes the current pose into state, so a save puts the trailer back here. */
  pushTransform(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.world.apply({
      t: 'trailer_transform',
      trailerId: this.state.id,
      x: t.x,
      y: t.y,
      z: t.z,
      qx: r.x,
      qy: r.y,
      qz: r.z,
      qw: r.w,
    });
  }

  dispose(): void {
    this.unhitch();
    this.controller.free();
    this.physics.removeBody(this.body);
    this.scene.remove(this.root);
    for (const geo of this.disposables) geo.dispose();
  }

  /** Stretches the drawn tongue to the coupling's real length. */
  private setDrawbarVisual(length: number): void {
    this.drawbar.scale.z = length;
    this.drawbar.position.set(0, HITCH_LOCAL_Y, BED_HALF[2] + length / 2);
  }

  /**
   * Winds the prop stand down (standing) or up (coupled). One collider and two
   * meshes, switched together — the leg has to disappear from the solver as well as
   * from the screen, or a towed trailer drags a steel post over every crest.
   */
  private setPropStand(down: boolean): void {
    this.propCollider.setEnabled(down);
    for (const mesh of this.propMeshes) mesh.visible = down;
  }

  /**
   * Mass, centre of mass and inertia for the current load.
   *
   * The empty bed's mass sits low, as a trailer's does; cargo sits on top of it at
   * the crate's centre. Blending the two by mass is what makes a full trailer roll
   * and a light one dart, using nothing but the two numbers the design allows.
   */
  private applyMass(): void {
    const cargo = this.state.cargoKg;
    const mass = TRAILER_TARE_KG + cargo;
    const tareComY = -0.35 * BED_HALF[1];
    const comY = (TRAILER_TARE_KG * tareComY + cargo * CRATE_CENTRE_Y) / mass;

    const hx = BED_HALF[0];
    const hy = BED_HALF[1] + (cargo > 0 ? CRATE_HALF[1] : 0);
    const hz = BED_HALF[2];
    this.body.setAdditionalMassProperties(
      mass,
      { x: 0, y: comY, z: 0 },
      {
        x: (mass / 3) * (hy * hy + hz * hz),
        y: (mass / 3) * (hx * hx + hz * hz),
        z: (mass / 3) * (hx * hx + hy * hy),
      },
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
    this.body.recomputeMassPropertiesFromColliders();
  }
}

/**
 * Every trailer in the world, and the collider map that lets the aim ray name one.
 *
 * Mirrors `LoosePartField`: `WorldState.trailers` is authoritative, the bodies and
 * meshes here are derived views, and every mutation records into state first. A
 * trailer is NOT chunk-owned — it moves, so it must outlive the chunk it was found
 * in, exactly like a car does.
 */
export class TrailerField {
  private readonly trailers = new Map<string, Trailer>();
  private readonly colliderToTrailerId = new Map<number, string>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
  ) {}

  /** Records a trailer into state and materialises it. Idempotent per id. */
  spawn(state: TrailerState): Trailer | null {
    if (this.trailers.has(state.id)) return this.trailers.get(state.id) ?? null;
    this.world.apply({ t: 'trailer_add', trailer: state });
    return this.materialise(this.world.state.trailers[state.id] ?? state);
  }

  /**
   * Rebuilds every trailer from a loaded save, then restores the couplings. The
   * caller supplies the vehicle lookup because `Vehicle` instances are owned by the
   * composition root, not here.
   */
  restoreFromState(vehicleFor: (carId: string) => Vehicle | null): void {
    // Which trailer was coupled to which car, read BEFORE anything is torn down.
    //
    // This has to be snapshotted first: `dispose` calls `unhitch`, and `unhitch`
    // records the uncoupling into authoritative state. Tearing the old trailers
    // down therefore erased the very couplings this method is about to restore, so
    // loading a save always dropped the trailer you were towing — it came back
    // standing on its prop stand a few metres behind the car.
    const couplings: Record<string, string> = {};
    for (const state of Object.values(this.world.state.trailers)) {
      if (state.hitchedTo !== null) couplings[state.id] = state.hitchedTo;
    }

    for (const trailer of this.trailers.values()) trailer.dispose();
    this.trailers.clear();
    this.colliderToTrailerId.clear();

    for (const state of Object.values(this.world.state.trailers)) {
      this.materialise(state);
    }
    // Second pass: a coupling needs both ends to exist.
    for (const [trailerId, carId] of Object.entries(couplings)) {
      const trailer = this.trailers.get(trailerId);
      const vehicle = vehicleFor(carId);
      // A save whose towing car has gone leaves the trailer standing where it is
      // rather than refusing to load.
      if (trailer && vehicle) trailer.hitchTo(vehicle, carId);
      else if (trailer) trailer.unhitch();
    }
  }

  get(id: string): Trailer | null {
    return this.trailers.get(id) ?? null;
  }

  trailerIdForCollider(colliderHandle: number): string | null {
    return this.colliderToTrailerId.get(colliderHandle) ?? null;
  }

  /** The trailer coupled to this car, if any. */
  hitchedTo(carId: string): Trailer | null {
    for (const trailer of this.trailers.values()) {
      if (trailer.hitchedTo === carId) return trailer;
    }
    return null;
  }

  /**
   * Suspension and brake step for every trailer, towed or standing.
   *
   * `brakeForCar` reports a car's service-brake demand (0..1) by id. It is a lookup
   * rather than a single number because each coupled trailer follows the pedal of
   * the car it is actually attached to, not the one the player happens to be in.
   */
  fixedUpdate(dt: number, brakeForCar: (carId: string) => number): void {
    for (const trailer of this.trailers.values()) {
      const carId = trailer.hitchedTo;
      trailer.fixedUpdate(dt, carId === null ? 0 : brakeForCar(carId));
    }
  }

  postStep(): void {
    for (const trailer of this.trailers.values()) trailer.postStep();
  }

  syncVisuals(alpha: number): void {
    for (const trailer of this.trailers.values()) trailer.syncVisuals(alpha);
  }

  /**
   * Visits every trailer wheel's spray report. A callback rather than a collected
   * array so nothing allocates per frame; trailers are few and the dust emitter is
   * the only caller.
   */
  forEachSpray(visit: (state: WheelSprayState) => void): void {
    for (const trailer of this.trailers.values()) {
      for (const state of trailer.wheelSpray) visit(state);
    }
  }

  /** Records every trailer's pose, so a save puts them all back. */
  pushTransforms(): void {
    for (const trailer of this.trailers.values()) trailer.pushTransform();
  }

  private materialise(state: TrailerState): Trailer {
    const trailer = new Trailer(this.physics, this.world, state, this.scene);
    this.trailers.set(state.id, trailer);
    const body = trailer.rigidBody;
    for (let i = 0; i < body.numColliders(); i++) {
      this.colliderToTrailerId.set(body.collider(i).handle, state.id);
    }
    return trailer;
  }
}
