/**
 * Deterministic car-body-condition harness.
 *
 * This builds private Rapier worlds and advances real Vehicles at FIXED_DT. It
 * defends against cosmetic wear being tied to the wrong surface, persisted too
 * late, or shared by cars that happen to use the same rendered model. Headless
 * Three has no material inspection, so the sharing case intentionally asserts
 * the Vehicle getters and authoritative CarState rather than render materials.
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { emptyInput, type InputFrame } from '../src/core/input';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { encodeSaveCode, decodeSaveCode, migrateState } from '../src/save/save';
import { preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

// The catalogue is all imported models now, so this harness loads real FBX bodies
// off disk rather than building one in code.
installAssetShim();

const MODEL_ID = 'st_big_saloon';
const SETTLE_STEPS = 180;
const DIRT_RUN_STEPS = 1_200;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
}

function conditionState(id: string, x = 0, z = 0, y = 1.2): CarState {
  const def = carModel(MODEL_ID);
  return {
    id,
    modelId: MODEL_ID,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: 40,
    fuelKind: 'petrol',
    dirt: 0,
    scratches: 0,
    coolantLitres: 10,
    oilLitres: 10,
    storage: new Array(def.storageCells).fill(null),
    bonnet: createBonnetStorage(id, def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x,
    y,
    z,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

interface Rig {
  physics: PhysicsWorld;
  world: GameWorld;
  vehicle: Vehicle;
  state: CarState;
  input: InputFrame;
}

function addGround(physics: PhysicsWorld, surface: SurfaceType): void {
  physics.addHeightfield(
    1,
    1,
    new Float32Array(4),
    { x: 8_000, y: 1, z: 8_000 },
    { x: 0, y: 0, z: 0 },
    surface,
  );
}

async function makeRig(id: string, surface: SurfaceType, x = 0, z = 0, y = 1.2): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  addGround(physics, surface);
  const world = new GameWorld(newWorldState(41));
  const state = conditionState(id, x, z, y);
  world.state.cars[id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const rig = { physics, world, vehicle, state, input: emptyInput() };
  step(rig, SETTLE_STEPS);
  return rig;
}

function step(rig: Rig, steps: number, beforeStep?: (index: number, input: InputFrame) => void): void {
  for (let i = 0; i < steps; i++) {
    beforeStep?.(i, rig.input);
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.physics.step();
    rig.vehicle.postStep();
  }
}

function roadDistance(rig: Rig, before: { x: number; z: number }): number {
  const after = rig.vehicle.chassis.translation();
  return Math.hypot(after.x - before.x, after.z - before.z);
}

async function dirtRun(surface: SurfaceType, id: string): Promise<{ rig: Rig; roadMetres: number; tyreMetres: number }> {
  const rig = await makeRig(id, surface);
  const before = rig.vehicle.chassis.translation();
  step(rig, DIRT_RUN_STEPS, (_, input) => {
    input.throttle = 1;
    input.brake = 0;
    input.steer = 0;
    input.handbrake = false;
  });
  const roadMetres = roadDistance(rig, before);
  return { rig, roadMetres, tyreMetres: roadMetres * 4 };
}

function addObstacle(physics: PhysicsWorld, z: number): void {
  const body = physics.world.createRigidBody(physics.rapier.RigidBodyDesc.fixed().setTranslation(0, 1, z));
  physics.world.createCollider(
    physics.rapier.ColliderDesc.cuboid(3, 1, 0.35).setFriction(0.8).setRestitution(0),
    body,
  );
}

/**
 * Drives into a fixed wall UNDER POWER rather than injecting velocity.
 *
 * `setLinvel` is itself an unexplained velocity change, and the detector is right to
 * report it: an external shove is exactly what it is built to notice. Accelerating
 * into the obstacle is both the honest scenario and the only one whose strongest
 * impact is the collision.
 */
async function crash(speedMps: number): Promise<{ scratches: number; impacts: Array<{ severity: number; localZ: number }> }> {
  const rig = await makeRig(`crash:${speedMps}`, SurfaceType.Asphalt);
  const start = rig.vehicle.chassis.translation();
  // Room to reach the target speed, then the wall. 20 m/s needs a few seconds.
  addObstacle(rig.physics, start.z + 240);
  const impacts: Array<{ severity: number; localZ: number }> = [];
  step(rig, 1_800, (_, input) => {
    // Held, not latched: coasting 200 m from 20 m/s bleeds most of the speed to drag
    // and rolling resistance, and the wall then gets a nudge instead of a crash.
    const speed = rig.vehicle.speedKmh / 3.6;
    input.throttle = speed < speedMps ? 1 : 0;
    input.brake = 0;
    input.steer = 0;
    input.handbrake = false;
    const impact = rig.vehicle.lastImpact;
    if (impact) impacts.push({ severity: impact.severityMps, localZ: impact.localZ });
  });
  return { scratches: rig.vehicle.bodyScratches, impacts };
}

async function freeFall(): Promise<number> {
  const rig = await makeRig('free-fall', SurfaceType.Asphalt, 0, 0, 8);
  step(rig, 300, (_, input) => {
    input.throttle = 0;
    input.brake = 0;
    input.steer = 0;
  });
  return rig.vehicle.bodyScratches;
}

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID]);

  const sand = await dirtRun(SurfaceType.Sand, 'sand');
  const asphalt = await dirtRun(SurfaceType.Asphalt, 'asphalt');
  const sandPerKm = sand.rig.vehicle.bodyDirt / sand.roadMetres * 1_000;
  const asphaltPerKm = asphalt.rig.vehicle.bodyDirt / asphalt.roadMetres * 1_000;
  const metresToFull = sand.roadMetres / sand.rig.vehicle.bodyDirt;
  check(
    'surface-driven accumulation',
    sand.rig.vehicle.bodyDirt > 0.0001 && asphalt.rig.vehicle.bodyDirt < sand.rig.vehicle.bodyDirt * 0.01,
    `sand=${sand.rig.vehicle.bodyDirt.toFixed(6)}, asphalt=${asphalt.rig.vehicle.bodyDirt.toFixed(6)}, tyre-metres=${sand.tyreMetres.toFixed(1)}`,
  );
  // Four tyres nominally reach full dirt around 25 km; this 10–100 km band catches
  // unit-scale regressions without making one short off-road excursion instantly opaque.
  check(
    'sand rate becomes visible within a drive, not instantly',
    metresToFull >= 10_000 && metresToFull <= 100_000,
    `${(metresToFull / 1_000).toFixed(1)} km to full (asserted band 10–100 km)`,
  );

  const sharedPhysics = await PhysicsWorld.create();
  addGround(sharedPhysics, SurfaceType.Sand);
  const sharedWorld = new GameWorld(newWorldState(42));
  const movingState = conditionState('shared:moving', -8, 0);
  const parkedState = conditionState('shared:parked', 8, 0);
  sharedWorld.state.cars[movingState.id] = movingState;
  sharedWorld.state.cars[parkedState.id] = parkedState;
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const moving = new Vehicle(sharedPhysics, sharedWorld, movingState, scene, origin);
  const parked = new Vehicle(sharedPhysics, sharedWorld, parkedState, scene, origin);
  const sharedInput = emptyInput();
  for (let i = 0; i < SETTLE_STEPS + DIRT_RUN_STEPS; i++) {
    sharedInput.throttle = i >= SETTLE_STEPS ? 1 : 0;
    moving.fixedUpdate(FIXED_DT, sharedInput);
    parked.fixedUpdate(FIXED_DT, emptyInput());
    sharedPhysics.step();
    moving.postStep();
    parked.postStep();
  }
  moving.pushState();
  parked.pushState();
  check(
    'same-model cars retain independent live dirt',
    moving.bodyDirt > parked.bodyDirt + 0.0001,
    `moving=${moving.bodyDirt.toFixed(6)}, parked=${parked.bodyDirt.toFixed(6)}`,
  );
  check(
    'same-model cars persist independent dirt',
    movingState.dirt > parkedState.dirt + 0.0001,
    `moving=${movingState.dirt.toFixed(6)}, parked=${parkedState.dirt.toFixed(6)}`,
  );

  sand.rig.vehicle.pushState();
  const roundTrip = decodeSaveCode(encodeSaveCode(sand.rig.world.state));
  const savedSand = roundTrip.cars[sand.rig.state.id]!;
  check(
    'save-code round trip preserves body condition',
    savedSand.dirt === sand.rig.state.dirt && savedSand.scratches === sand.rig.state.scratches,
    `dirt=${savedSand.dirt.toFixed(6)}, scratches=${savedSand.scratches.toFixed(6)}`,
  );
  const legacyRaw = structuredClone(sand.rig.world.state) as unknown as Record<string, unknown>;
  const legacyCar = (legacyRaw.cars as Record<string, Record<string, unknown>>)[sand.rig.state.id]!;
  delete legacyCar.dirt;
  delete legacyCar.scratches;
  const legacy = migrateState(legacyRaw);
  check(
    'old save without body-condition fields defaults clean',
    legacy.cars[sand.rig.state.id]!.dirt === 0 && legacy.cars[sand.rig.state.id]!.scratches === 0,
    `dirt=${legacy.cars[sand.rig.state.id]!.dirt}, scratches=${legacy.cars[sand.rig.state.id]!.scratches}`,
  );

  const hardCrash = await crash(20);
  const strongest = hardCrash.impacts.reduce((best, impact) => impact.severity > best.severity ? impact : best, { severity: 0, localZ: 0 });
  check(
    'hard frontal obstacle impact reports a scratch-worthy impact',
    hardCrash.scratches > 0 && strongest.severity > 2.5 && strongest.localZ > 0.25,
    `scratches=${hardCrash.scratches.toFixed(6)}, severity=${strongest.severity.toFixed(3)}, localZ=${strongest.localZ.toFixed(3)}`,
  );
  const gentleCrash = await crash(1);
  check(
    'gentle obstacle roll does not scratch',
    gentleCrash.scratches === 0,
    `scratches=${gentleCrash.scratches.toFixed(6)}`,
  );
  const fallScratches = await freeFall();
  check('free fall and ordinary landing do not scratch', fallScratches === 0, `scratches=${fallScratches.toFixed(6)}`);
  const conditions = [sand.rig.vehicle, asphalt.rig.vehicle, moving, parked];
  check(
    'all live and persisted values stay clamped to 0..1',
    conditions.every((vehicle) => vehicle.bodyDirt >= 0 && vehicle.bodyDirt <= 1 && vehicle.bodyScratches >= 0 && vehicle.bodyScratches <= 1) &&
      Object.values(sharedWorld.state.cars).every((state) => state.dirt >= 0 && state.dirt <= 1 && state.scratches >= 0 && state.scratches <= 1),
    'checked live Vehicle getters and pushed CarState values',
  );
  console.log(`dirt per km: sand=${sandPerKm.toFixed(6)}, asphalt=${asphaltPerKm.toFixed(6)}`);
  if (failures > 0) process.exitCode = 1;
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
