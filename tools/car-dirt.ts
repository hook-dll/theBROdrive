/**
 * Deterministic car-body-condition harness: dirt, scratches and dents, from the
 * simulation through authoritative state and the save to the deformed shell.
 *
 * Builds private Rapier worlds and advances real Vehicles at FIXED_DT on the real
 * catalogue models. It defends against wear tied to the wrong surface or at the
 * wrong rate, one crash recorded as a stack of dents, dents lost or invented by a
 * save round trip, a dented panel folding through itself or into a wheel, and the
 * same save replaying to a different shell. Headless Three compiles no shaders, so
 * paint uniforms are left to the car lab (`?car-lab`); the dent geometry is plain
 * CPU work and is measured here directly.
 *
 *   ~/.bun/bin/bun tools/car-dirt.ts
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { emptyInput, type InputFrame } from '../src/core/input';
import { SurfaceType } from '../src/core/surfaces';
import { createServiceableCarState } from '../src/game/spawn';
import {
  GameWorld,
  MAX_BODY_DENT_DEPTH_M,
  MAX_BODY_DENTS,
  newWorldState,
  type BodyDent,
  type CarState,
} from '../src/game/state';
import { encodeSaveCode, decodeSaveCode, migrateState } from '../src/save/save';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { Vehicle } from '../src/vehicle/vehicle';
import { impactDent } from '../src/vehicle/vehicletuning';
import { WorldOrigin } from '../src/world/origin';

installAssetShim();

const MODEL_ID = 'gt_vaz2110';
/** One car from each source pack for the geometry checks. */
const PACK_MODELS = ['sv_vaz2101', 'sa_oka', 'gt_vaz2110'] as const;
const SETTLE_STEPS = 180;
const DIRT_RUN_STEPS = 1_200;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
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

async function makeRig(
  id: string,
  surface: SurfaceType,
  modelId: string = MODEL_ID,
  y = 1.2,
): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  addGround(physics, surface);
  const world = new GameWorld(newWorldState(41));
  const state = createServiceableCarState(id, modelId, 0, y, 0, 0);
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

async function dirtRun(surface: SurfaceType, id: string): Promise<{ rig: Rig; roadMetres: number }> {
  const rig = await makeRig(id, surface);
  const before = rig.vehicle.chassis.translation();
  step(rig, DIRT_RUN_STEPS, (_, input) => {
    input.throttle = 1;
  });
  return { rig, roadMetres: roadDistance(rig, before) };
}

function addObstacle(physics: PhysicsWorld, z: number): void {
  const body = physics.world.createRigidBody(physics.rapier.RigidBodyDesc.fixed().setTranslation(0, 1, z));
  physics.world.createCollider(
    physics.rapier.ColliderDesc.cuboid(3, 1, 0.35).setFriction(0.8).setRestitution(0),
    body,
  );
}

/**
 * Drives into a fixed wall UNDER POWER rather than injecting velocity, then lifts
 * and brakes at the first blow so the result is exactly one collision.
 *
 * `setLinvel` is itself an unexplained velocity change, and the detector is right to
 * report it: an external shove is exactly what it is built to notice.
 */
async function crash(speedMps: number): Promise<{ rig: Rig; strongest: number; strongestLocalZ: number }> {
  const rig = await makeRig(`crash:${speedMps}`, SurfaceType.Asphalt);
  const start = rig.vehicle.chassis.translation();
  addObstacle(rig.physics, start.z + 240);
  let strongest = 0;
  let strongestLocalZ = 0;
  let hit = false;
  step(rig, 1_800, (_, input) => {
    const speed = rig.vehicle.speedKmh / 3.6;
    input.throttle = !hit && speed < speedMps ? 1 : 0;
    input.brake = hit ? 1 : 0;
    const impact = rig.vehicle.lastImpact;
    if (!impact) return;
    hit = true;
    if (impact.severityMps > strongest) {
      strongest = impact.severityMps;
      strongestLocalZ = impact.localZ;
    }
  });
  rig.vehicle.pushState();
  return { rig, strongest, strongestLocalZ };
}

/** Renders nothing, but runs the visual sync that applies dents to the shell. */
function syncShell(rig: Rig): void {
  rig.vehicle.syncVisuals(1);
}

/** Every body vertex position of a car, in order, for replay comparison. */
function shellPositions(vehicle: Vehicle): number[] {
  const out: number[] = [];
  vehicle.root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) out.push(position.getX(i), position.getY(i), position.getZ(i));
  });
  return out;
}

/** A spread of the hardest dents a car can take, all round the body. */
function worstCaseDents(modelId: string): BodyDent[] {
  const measure = carModelMeasure(modelId);
  const half = measure.halfExtents;
  const floor = Math.max(-half[1], measure.wheels[0]!.pos[1]);
  const dents: BodyDent[] = [];
  for (let i = 0; i < MAX_BODY_DENTS; i++) {
    const angle = (i / MAX_BODY_DENTS) * Math.PI * 2 + 0.2;
    const fromX = Math.sin(angle);
    const fromZ = Math.cos(angle);
    const reach = Math.min(half[0] / Math.max(1e-6, Math.abs(fromX)), half[2] / Math.max(1e-6, Math.abs(fromZ)));
    const y = floor + (i % 3) * 0.3 * (half[1] - floor);
    const dent = impactDent(40, fromX * reach, y, fromZ * reach, -fromX, -fromZ);
    if (dent) dents.push(dent);
  }
  return dents;
}

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID, ...PACK_MODELS]);

  // --- Dirt ---------------------------------------------------------------
  const sand = await dirtRun(SurfaceType.Sand, 'sand');
  const gravel = await dirtRun(SurfaceType.Gravel, 'gravel');
  const asphalt = await dirtRun(SurfaceType.Asphalt, 'asphalt');
  const kmToFull = (run: { rig: Rig; roadMetres: number }): number =>
    run.roadMetres / run.rig.vehicle.bodyDirt / 1_000;
  check(
    'sand dirties the body far faster than asphalt',
    sand.rig.vehicle.bodyDirt > asphalt.rig.vehicle.bodyDirt * 8,
    `sand=${sand.rig.vehicle.bodyDirt.toFixed(5)}, asphalt=${asphalt.rig.vehicle.bodyDirt.toFixed(5)} over ${sand.roadMetres.toFixed(0)}/${asphalt.roadMetres.toFixed(0)} m`,
  );
  check(
    'sand: visibly dirty within a few km, not instantly',
    kmToFull(sand) >= 3 && kmToFull(sand) <= 10,
    `${kmToFull(sand).toFixed(2)} km to full (band 3-10 km)`,
  );
  check(
    'gravel: between sand and asphalt',
    kmToFull(gravel) > kmToFull(sand) && kmToFull(gravel) <= 16,
    `${kmToFull(gravel).toFixed(2)} km to full (band sand..16 km)`,
  );
  check(
    'asphalt: slow road film, not zero',
    asphalt.rig.vehicle.bodyDirt > 0 && kmToFull(asphalt) >= 60 && kmToFull(asphalt) <= 300,
    `${kmToFull(asphalt).toFixed(1)} km to full (band 60-300 km)`,
  );

  const sharedPhysics = await PhysicsWorld.create();
  addGround(sharedPhysics, SurfaceType.Sand);
  const sharedWorld = new GameWorld(newWorldState(42));
  const movingState = createServiceableCarState('shared:moving', MODEL_ID, -8, 1.2, 0, 0);
  const parkedState = createServiceableCarState('shared:parked', MODEL_ID, 8, 1.2, 0, 0);
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
    'same-model cars keep independent dirt (live and persisted)',
    moving.bodyDirt > parked.bodyDirt + 0.001 && movingState.dirt > parkedState.dirt + 0.001,
    `moving=${movingState.dirt.toFixed(5)}, parked=${parkedState.dirt.toFixed(5)}`,
  );
  check(
    'each car owns its paint materials',
    (moving.bodySurface?.paint.length ?? 0) > 0 &&
      moving.bodySurface?.paint.every((material) => !parked.bodySurface?.paint.includes(material)) === true,
    `${moving.bodySurface?.paint.length ?? 0} paint slot(s) per car, none shared`,
  );

  // A wash writes state directly; a parked car must adopt it without a fixed step.
  sand.rig.state.dirt = 0.05;
  sand.rig.state.scratches = 0.08;
  syncShell(sand.rig);
  check(
    'a wash of a parked car reaches the live condition',
    sand.rig.vehicle.bodyDirt === 0.05 && sand.rig.vehicle.bodyScratches === 0.08,
    `dirt=${sand.rig.vehicle.bodyDirt}, scratches=${sand.rig.vehicle.bodyScratches}`,
  );

  // --- Scratches and dents from a real collision ----------------------------
  const hard = await crash(20);
  const hardDents = hard.rig.state.dents;
  const half = carModelMeasure(MODEL_ID).halfExtents;
  check(
    'hard frontal crash scratches and reads as frontal',
    hard.rig.vehicle.bodyScratches > 0 && hard.strongest > 3 && hard.strongestLocalZ > 0.25,
    `scratches=${hard.rig.vehicle.bodyScratches.toFixed(3)}, severity=${hard.strongest.toFixed(2)} m/s, localZ=${hard.strongestLocalZ.toFixed(2)}`,
  );
  const dent = hardDents[0];
  check(
    'one collision records exactly one dent',
    hardDents.length === 1,
    `${hardDents.length} dent record(s)`,
  );
  check(
    'a square hit dents the middle of the nose, pushed rearward',
    dent !== undefined &&
      dent.z > half[2] * 0.8 &&
      Math.abs(dent.x) < half[0] * 0.3 &&
      dent.nz < -0.9 &&
      Math.abs(dent.ny) < 1e-9,
    dent ? `at (${dent.x.toFixed(2)}, ${dent.y.toFixed(2)}, ${dent.z.toFixed(2)}) of half-length ${half[2].toFixed(2)}, push (${dent.nx.toFixed(2)}, ${dent.nz.toFixed(2)})` : 'none',
  );
  const expected = impactDent(hard.strongest, 0, 0, 0, 0, -1);
  check(
    'dent size is the strongest step, not a sum of steps',
    dent !== undefined && expected !== null && Math.abs(dent.depth - expected.depth) < 1e-9 && Math.abs(dent.radius - expected.radius) < 1e-9,
    dent ? `depth=${dent.depth.toFixed(4)} m (expected ${expected?.depth.toFixed(4)}), radius=${dent.radius.toFixed(3)} m` : 'none',
  );

  syncShell(hard.rig);
  const stats = hard.rig.vehicle.bodySurface?.dentStats;
  check(
    'the dent deforms the shell',
    stats !== undefined && stats.movedVertices > 50 && stats.maxDisplacementM > 0.01 && stats.dentedMeshes > 0,
    stats ? `${stats.movedVertices} vertices in ${stats.dentedMeshes} meshes, max ${(stats.maxDisplacementM * 1000).toFixed(1)} mm` : 'no surface',
  );
  check(
    'the dented panel does not fold or reach a wheel',
    stats !== undefined && stats.minJacobian > 0.2 && stats.wheelPenetrationM < 0.002,
    stats ? `min Jacobian ${stats.minJacobian.toFixed(3)}, wheel penetration ${(stats.wheelPenetrationM * 1000).toFixed(2)} mm` : 'no surface',
  );

  const saved = decodeSaveCode(encodeSaveCode(hard.rig.world.state));
  const savedCar = saved.cars[hard.rig.state.id]!;
  check(
    'save round trip preserves dirt, scratches and dents',
    savedCar.dirt === hard.rig.state.dirt &&
      savedCar.scratches === hard.rig.state.scratches &&
      JSON.stringify(savedCar.dents) === JSON.stringify(hardDents),
    `dirt=${savedCar.dirt.toFixed(5)}, scratches=${savedCar.scratches.toFixed(3)}, dents=${savedCar.dents.length}`,
  );
  // The same save on a fresh load must rebuild the same shell, vertex for vertex.
  const replayPhysics = await PhysicsWorld.create();
  addGround(replayPhysics, SurfaceType.Asphalt);
  const replayWorld = new GameWorld(saved);
  const replay = new Vehicle(replayPhysics, replayWorld, savedCar, new THREE.Scene(), new WorldOrigin());
  replay.syncVisuals(1);
  const original = shellPositions(hard.rig.vehicle);
  const replayed = shellPositions(replay);
  const identical = original.length === replayed.length && original.every((value, i) => value === replayed[i]);
  check(
    'a loaded save replays the identical dented shell',
    identical && replay.bodySurface?.dentStats.movedVertices === stats?.movedVertices,
    `${original.length / 3} vertices compared`,
  );

  const legacyRaw: unknown = JSON.parse(JSON.stringify(hard.rig.world.state));
  if (typeof legacyRaw === 'object' && legacyRaw !== null && 'cars' in legacyRaw) {
    const legacyCars = legacyRaw.cars;
    if (typeof legacyCars === 'object' && legacyCars !== null) {
      for (const car of Object.values(legacyCars)) {
        if (typeof car !== 'object' || car === null) continue;
        Reflect.deleteProperty(car, 'dirt');
        Reflect.deleteProperty(car, 'scratches');
        Reflect.deleteProperty(car, 'dents');
        // The removed shader-mark system wrote this; it must be ignored, not revived.
        Reflect.set(car, 'damage', [{ x: 0, y: 0, z: 1, nx: 0, ny: 0, nz: 1, radius: 0.2, strength: 1, type: 'dent', seed: 0 }]);
      }
    }
  }
  const legacyCar = migrateState(legacyRaw).cars[hard.rig.state.id]!;
  check(
    'an old save loads clean and straight',
    legacyCar.dirt === 0 && legacyCar.scratches === 0 && legacyCar.dents.length === 0,
    `dirt=${legacyCar.dirt}, scratches=${legacyCar.scratches}, dents=${legacyCar.dents.length}`,
  );

  // --- The dent ring ---------------------------------------------------------
  const ringWorld = new GameWorld(newWorldState(43));
  const ringCar = createServiceableCarState('ring', MODEL_ID, 0, 0, 0, 0);
  ringWorld.state.cars[ringCar.id] = ringCar;
  for (let i = 0; i < MAX_BODY_DENTS + 2; i++) {
    ringWorld.apply({
      t: 'car_body_dent',
      carId: ringCar.id,
      dent: { x: -2 + i * 0.4, y: 0, z: half[2], nx: 0, ny: 0, nz: -1, radius: 0.25, depth: 0.05 },
    });
  }
  check(
    'the ring is bounded and forgets the oldest',
    ringCar.dents.length === MAX_BODY_DENTS && Math.abs(ringCar.dents[0]!.x - (-2 + 2 * 0.4)) < 1e-9,
    `count=${ringCar.dents.length}, oldest x=${ringCar.dents[0]!.x.toFixed(2)}`,
  );
  const mergeWorld = new GameWorld(newWorldState(44));
  const mergeCar = createServiceableCarState('merge', MODEL_ID, 0, 0, 0, 0);
  mergeWorld.state.cars[mergeCar.id] = mergeCar;
  for (let i = 0; i < 6; i++) {
    mergeWorld.apply({
      t: 'car_body_dent',
      carId: mergeCar.id,
      dent: { x: 0.02 * i, y: 0, z: half[2], nx: 0, ny: 0, nz: -1, radius: 0.3, depth: 0.06 },
    });
  }
  check(
    'repeat blows to one panel deepen one dent, to a ceiling',
    mergeCar.dents.length === 1 && mergeCar.dents[0]!.depth > 0.06 && mergeCar.dents[0]!.depth <= MAX_BODY_DENT_DEPTH_M,
    `count=${mergeCar.dents.length}, depth=${mergeCar.dents[0]!.depth.toFixed(3)} m`,
  );

  // --- Worst case on one car from every pack --------------------------------
  for (const modelId of PACK_MODELS) {
    const rig = await makeRig(`worst:${modelId}`, SurfaceType.Asphalt, modelId);
    syncShell(rig);
    check(
      `${modelId}: a clean car owns no dented geometry`,
      rig.vehicle.bodySurface?.dentStats.dentedMeshes === 0,
      `${rig.vehicle.bodySurface?.dentStats.dentedMeshes} dented meshes`,
    );
    for (const worst of worstCaseDents(modelId)) {
      rig.world.apply({ t: 'car_body_dent', carId: rig.state.id, dent: worst });
    }
    syncShell(rig);
    const worst = rig.vehicle.bodySurface?.dentStats;
    check(
      `${modelId}: ${rig.state.dents.length} hardest dents stay sane`,
      worst !== undefined &&
        worst.movedVertices > 0 &&
        worst.minJacobian > 0.2 &&
        worst.wheelPenetrationM < 0.002 &&
        worst.maxDisplacementM <= MAX_BODY_DENT_DEPTH_M * 1.5,
      worst ? `${worst.movedVertices} vertices, max ${(worst.maxDisplacementM * 1000).toFixed(0)} mm, min Jacobian ${worst.minJacobian.toFixed(3)}, wheel penetration ${(worst.wheelPenetrationM * 1000).toFixed(2)} mm` : 'no surface',
    );
  }

  // --- Things that must NOT damage the car ----------------------------------
  const gentle = await crash(1);
  check(
    'a gentle roll into an obstacle neither scratches nor dents',
    gentle.rig.vehicle.bodyScratches === 0 && gentle.rig.state.dents.length === 0,
    `scratches=${gentle.rig.vehicle.bodyScratches}, dents=${gentle.rig.state.dents.length}`,
  );
  const fall = await makeRig('free-fall', SurfaceType.Asphalt, MODEL_ID, 8);
  step(fall, 300);
  fall.vehicle.pushState();
  check(
    'a drop onto the wheels neither scratches nor dents',
    fall.vehicle.bodyScratches === 0 && fall.state.dents.length === 0,
    `scratches=${fall.vehicle.bodyScratches}, dents=${fall.state.dents.length}`,
  );
  const everyone = [sand.rig.vehicle, gravel.rig.vehicle, asphalt.rig.vehicle, moving, parked, hard.rig.vehicle];
  check(
    'live condition stays within 0..1',
    everyone.every((v) => v.bodyDirt >= 0 && v.bodyDirt <= 1 && v.bodyScratches >= 0 && v.bodyScratches <= 1),
    `${everyone.length} vehicles`,
  );

  console.log(failures === 0 ? 'car-dirt: all checks passed' : `car-dirt: ${failures} check(s) FAILED`);
  if (failures > 0) process.exitCode = 1;
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
