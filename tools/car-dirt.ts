/**
 * Deterministic car-body-condition harness: dirt and scratches, from the simulation
 * through authoritative state and the save.
 *
 * Builds private Rapier worlds and advances real Vehicles at FIXED_DT on the real
 * catalogue model. It defends against wear tied to the wrong surface or at the wrong
 * rate, condition lost or invented by a save round trip, and harmless contact marking
 * the paint. Headless Three compiles no shaders, so paint uniforms are left to the car
 * lab (`?car-lab`).
 *
 *   ~/.bun/bin/bun tools/car-dirt.ts
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { emptyInput, type InputFrame } from '../src/core/input';
import { SurfaceType } from '../src/core/surfaces';
import { createServiceableCarState } from '../src/game/spawn';
import { GameWorld, newWorldState } from '../src/game/state';
import { encodeSaveCode, decodeSaveCode, migrateState } from '../src/save/save';
import { preloadCarModels } from '../src/render/carmodel';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';

installAssetShim();

const MODEL_ID = 'gt_vaz2110';
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

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID]);

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
  sand.rig.vehicle.syncVisuals(1);
  check(
    'a wash of a parked car reaches the live condition',
    sand.rig.vehicle.bodyDirt === 0.05 && sand.rig.vehicle.bodyScratches === 0.08,
    `dirt=${sand.rig.vehicle.bodyDirt}, scratches=${sand.rig.vehicle.bodyScratches}`,
  );

  // --- Scratches from a real collision -------------------------------------
  const hard = await crash(20);
  check(
    'hard frontal crash scratches and reads as frontal',
    hard.rig.vehicle.bodyScratches > 0 && hard.strongest > 3 && hard.strongestLocalZ > 0.25,
    `scratches=${hard.rig.vehicle.bodyScratches.toFixed(3)}, severity=${hard.strongest.toFixed(2)} m/s, localZ=${hard.strongestLocalZ.toFixed(2)}`,
  );

  const saved = decodeSaveCode(encodeSaveCode(hard.rig.world.state));
  const savedCar = saved.cars[hard.rig.state.id]!;
  check(
    'save round trip preserves dirt and scratches',
    savedCar.dirt === hard.rig.state.dirt && savedCar.scratches === hard.rig.state.scratches,
    `dirt=${savedCar.dirt.toFixed(5)}, scratches=${savedCar.scratches.toFixed(3)}`,
  );

  const legacyRaw: unknown = JSON.parse(JSON.stringify(hard.rig.world.state));
  if (typeof legacyRaw === 'object' && legacyRaw !== null && 'cars' in legacyRaw) {
    const legacyCars = legacyRaw.cars;
    if (typeof legacyCars === 'object' && legacyCars !== null) {
      for (const car of Object.values(legacyCars)) {
        if (typeof car !== 'object' || car === null) continue;
        Reflect.deleteProperty(car, 'dirt');
        Reflect.deleteProperty(car, 'scratches');
        // Both removed damage systems wrote a list here; each must load as nothing.
        Reflect.set(car, 'dents', [{ x: 0, y: 0, z: 2, nx: 0, ny: 0, nz: -1, radius: 0.5, depth: 0.2 }]);
        Reflect.set(car, 'damage', [{ x: 0, y: 0, z: 1, nx: 0, ny: 0, nz: 1, radius: 0.2, strength: 1, type: 'dent', seed: 0 }]);
      }
    }
  }
  const legacyCar = migrateState(legacyRaw).cars[hard.rig.state.id]!;
  check(
    'an old save loads clean and straight',
    legacyCar.dirt === 0 && legacyCar.scratches === 0 && !('dents' in legacyCar) && !('damage' in legacyCar),
    `dirt=${legacyCar.dirt}, scratches=${legacyCar.scratches}, keys=${Object.keys(legacyCar).filter((k) => k === 'dents' || k === 'damage').join(',') || 'none'}`,
  );

  // --- Things that must NOT damage the car ----------------------------------
  const gentle = await crash(1);
  check(
    'a gentle roll into an obstacle does not scratch',
    gentle.rig.vehicle.bodyScratches === 0,
    `scratches=${gentle.rig.vehicle.bodyScratches}`,
  );
  const fall = await makeRig('free-fall', SurfaceType.Asphalt, MODEL_ID, 8);
  step(fall, 300);
  fall.vehicle.pushState();
  check(
    'a drop onto the wheels does not scratch',
    fall.vehicle.bodyScratches === 0,
    `scratches=${fall.vehicle.bodyScratches}`,
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
