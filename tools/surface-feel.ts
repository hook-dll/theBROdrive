/**
 * tools/surface-feel.ts
 *
 * What the CAR feels, as opposed to what a dragged point feels.
 *
 * `ride-bench.ts` and `desert-ride.ts` measure the ground: they drag a wheel over a
 * profile and report the vertical velocity step at each triangle edge. That is the
 * right measure of a SURFACE, and it is blind to three things that decide whether a
 * stretch of ground is pleasant or punishing to drive on:
 *
 *   - the suspension, which filters the profile before the driver feels any of it;
 *   - the tyre model, which turns a load fluctuation into lost grip;
 *   - traction control, which turns lost grip into a torque cut.
 *
 * So this drives a REAL `Vehicle` at the simulation's own fixed timestep over the
 * REAL road ribbon and the REAL desert chunk colliders, on the same route, with one
 * controller, and reports what the seat reports:
 *
 *   heave      RMS vertical acceleration of the chassis, in g. Comfort.
 *   jolt       99th-percentile vertical acceleration. The hits inside the comfort.
 *   contact    mean fraction of wheels touching the ground. Grip stability.
 *   speed      mean speed held, against the speed asked for.
 *
 *   npx tsx tools/surface-feel.ts [speedKmh]
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import { preloadCarModels } from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { carModel } from '../src/vehicle/carmodels';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { Vehicle } from '../src/vehicle/vehicle';
import { CHUNK_LENGTH, type ChunkContext, type ChunkContent } from '../src/world/chunks';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { roadSurfaceY, SURFACE_STEP, SurfaceField } from '../src/world/roadsurface';
import { Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';
import { installAssetShim } from './assetshim';

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
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
// Every catalogue model is an imported body now, so the bench loads real FBX files
// off disk rather than building its car in code.
installAssetShim();

const SEED = 42;
const MODEL_ID = 'st_mid_engine_v8';
/** Chunk span driven. Matches desert-ride.ts so the two benches describe one place. */
const FROM_CHUNK = 120;
const TO_CHUNK = 126;
const START_S = FROM_CHUNK * CHUNK_LENGTH + 60;
const END_S = TO_CHUNK * CHUNK_LENGTH - 60;
/** Lateral offset of the desert run, metres: outside the corridor, inside the detail field. */
const DESERT_LATERAL = 34;
/** Metres ahead the steering controller aims. */
const LOOKAHEAD = 8;
/** Settling steps before measurement starts. */
const SETTLE_STEPS = 240;

const speedKmh = Number(process.argv[2] ?? 60);
const targetSpeed = speedKmh / 3.6;

function carState(road: Road, lateral: number, groundY: number): CarState {
  const def = carModel(MODEL_ID);
  const engine = variant(def.engineId).engine;
  const p = road.sampleAt(START_S);
  const point = { x: 0, y: 0, z: 0 };
  road.offsetPoint(START_S, lateral, point);
  return {
    id: 'surface-feel',
    modelId: MODEL_ID,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: 40,
    fuelKind: engine?.fuel ?? null,
    dirt: 0,
    scratches: 0,
    waterLitres: 10,
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('surface-feel', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: point.x,
    y: groundY + 2,
    z: point.z,
    qx: 0,
    qy: Math.sin(p.heading / 2),
    qz: 0,
    qw: Math.cos(p.heading / 2),
  };
}

/**
 * The real asphalt ribbon, at the real cross-section.
 *
 * The lateral columns MUST match roadmesh.ts's own, because the pothole lattice is
 * anchored on them: a ribbon built from two edge vertices interpolates straight
 * across every hole in the road and measures a surface the game does not have.
 */
const RIBBON_LATERALS: readonly number[] = [
  -ROAD_HALF_WIDTH, -2.45, -2.0, -1.65, -1.2, -0.85, -0.4,
  0,
  0.4, 0.85, 1.2, 1.65, 2.0, 2.45, ROAD_HALF_WIDTH,
];

function addRoadCollider(physics: PhysicsWorld, road: Road): void {
  const field = new SurfaceField(road.seed);
  const step = SURFACE_STEP;
  const from = START_S - 40;
  const to = END_S + 40;
  const rows = Math.ceil((to - from) / step) + 1;
  const cols = RIBBON_LATERALS.length;
  const vertices = new Float32Array(rows * cols * 3);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = Math.min(to, from + row * step);
    for (let col = 0; col < cols; col++) {
      const lateral = RIBBON_LATERALS[col]!;
      road.offsetPoint(s, lateral, point);
      const i = (row * cols + col) * 3;
      vertices[i] = point.x;
      vertices[i + 1] = roadSurfaceY(road, field, s, lateral, point.x, point.z);
      vertices[i + 2] = point.z;
    }
  }
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  for (let row = 0, i = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[i++] = a; indices[i++] = c; indices[i++] = b;
      indices[i++] = b; indices[i++] = c; indices[i++] = d;
    }
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);
}

/** The real desert, built by the real provider straight into the real physics world. */
function addDesertColliders(physics: PhysicsWorld, road: Road, terrain: Terrain): ChunkContent[] {
  const provider = new TerrainMeshProvider(new RoadDistance(road));
  const built: ChunkContent[] = [];
  for (let chunkIndex = FROM_CHUNK - 1; chunkIndex <= TO_CHUNK + 1; chunkIndex++) {
    const ctx = {
      chunkIndex,
      sStart: chunkIndex * CHUNK_LENGTH,
      sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
      road,
      terrain,
      physics,
      hasPhysics: true,
      originX: 0,
      originZ: 0,
    } as unknown as ChunkContext;
    const content = provider.build(ctx);
    if (!content) continue;
    for (const collider of content.colliders) collider.setEnabled(true);
    built.push(content);
  }
  return built;
}

/**
 * A perfectly flat asphalt plane at the route's own elevation. The control: any
 * behaviour that survives here belongs to the car, not to the ground.
 */
function addFlatCollider(physics: PhysicsWorld, road: Road, groundY: number): void {
  const p = road.sampleAt(START_S);
  const half = 3000;
  const vertices = new Float32Array([
    p.x - half, groundY, p.z - half,
    p.x + half, groundY, p.z - half,
    p.x + half, groundY, p.z + half,
    p.x - half, groundY, p.z + half,
  ]);
  physics.addStaticTrimesh(vertices, new Uint32Array([0, 1, 2, 0, 2, 3]), SurfaceType.Asphalt);
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  road: Road;
  input: InputFrame;
  lateral: number;
  /** Mean absolute lateral offset held, so a run that slid onto the road is visible. */
  lateralSum: number;
  lateralN: number;
}

type Ground = 'road' | 'desert' | 'flat';

async function makeRig(lateral: number, ground: Ground): Promise<Rig> {
  const road = new Road(SEED);
  const terrain = new Terrain(SEED, road);
  const physics = await PhysicsWorld.create();
  const start = road.sampleAt(START_S);
  const spawnGroundY = terrain.heightAt(start.x, start.z, START_S);
  if (ground === 'flat') addFlatCollider(physics, road, spawnGroundY);
  else {
    // The desert rig gets the road as well. Without it the corridor the terrain fan
    // deliberately leaves empty (CORRIDOR_INNER, filled by the road mesh in the game)
    // is a hole, and a car that wanders into it falls out of the world.
    addRoadCollider(physics, road);
    if (ground === 'desert') addDesertColliders(physics, road, terrain);
  }
  const world = new GameWorld(newWorldState(SEED));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const spawn = { x: 0, y: 0, z: 0 };
  road.offsetPoint(START_S, lateral, spawn);
  const state = carState(
    road,
    lateral,
    ground === 'flat' ? spawnGroundY : terrain.heightAt(spawn.x, spawn.z, START_S),
  );
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const input = emptyInput();
  for (let i = 0; i < SETTLE_STEPS; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
  }
  return { physics, vehicle, road, input, lateral, lateralSum: 0, lateralN: 0 };
}

/** Arclength of the car's current position, walked forward from the last one. */
function advanceS(road: Road, s: number, x: number, z: number): number {
  let best = s;
  let bestD = Infinity;
  const point = { x: 0, y: 0, z: 0 };
  for (let probe = s - 6; probe <= s + 40; probe += 0.5) {
    road.offsetPoint(probe, 0, point);
    const d = (point.x - x) ** 2 + (point.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = probe;
    }
  }
  return best;
}

interface Result {
  label: string;
  metres: number;
  meanSpeed: number;
  heaveG: number;
  joltG: number;
  contact: number;
  heldLateral: number;
  tcsDuty: number;
  maxSpeed: number;
}

/**
 * Drives the route and measures. One controller for both surfaces: aim at a point
 * LOOKAHEAD metres up the same lateral line, and hold the target speed on a PI
 * throttle. Nothing here reads the surface, so a difference in the numbers is a
 * difference in the ground and in what the car does about it.
 */
function drive(rig: Rig, label: string): Result {
  const { vehicle, road, input } = rig;
  const aim = { x: 0, y: 0, z: 0 };
  let s = START_S;
  let integral = 0;
  let steps = 0;
  let tcsSteps = 0;
  let speedSum = 0;
  let maxSpeed = 0;
  let metres = 0;
  let lastVy = vehicle.chassis.linvel().y;
  const accels: number[] = [];
  let contactSum = 0;

  // A stall guard, because a car that spins out in the desert would otherwise sit at
  // full lock and full throttle until the step cap and report a meaningless mean.
  let stalledSteps = 0;

  const routeMetres = END_S - START_S;
  while (metres < routeMetres && steps < 120_000 && stalledSteps < 600) {
    const t = vehicle.chassis.translation();
    // Lookahead grows with speed: a fixed one oversteers at speed and understeers at
    // walking pace, and the difference would be charged to the surface.
    const v0 = vehicle.chassis.linvel();
    const reach = LOOKAHEAD + 0.35 * Math.hypot(v0.x, v0.z);
    s = advanceS(road, s, t.x, t.z);
    road.offsetPoint(s + reach, rig.lateral, aim);
    const held = road.project(t.x, t.z, s);
    rig.lateralSum += Math.abs(held.lateral);
    rig.lateralN++;

    // Heading error to the aim point, in the chassis frame.
    const q = vehicle.chassis.rotation();
    const heading = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.z * q.z),
    );
    const want = Math.atan2(aim.x - t.x, aim.z - t.z);
    let error = want - heading;
    while (error > Math.PI) error -= 2 * Math.PI;
    while (error < -Math.PI) error += 2 * Math.PI;
    input.steer = Math.max(-0.9, Math.min(0.9, -error * 2.2));

    const v = vehicle.chassis.linvel();
    const speed = Math.hypot(v.x, v.z);
    const speedError = targetSpeed - speed;
    integral = Math.max(-1, Math.min(1, integral + speedError * FIXED_DT * 0.5));
    const demand = speedError * 0.35 + integral;
    input.throttle = Math.max(0, Math.min(1, demand));
    input.brake = Math.max(0, Math.min(1, -demand * 0.5));

    vehicle.fixedUpdate(FIXED_DT, input);
    rig.physics.step();
    vehicle.postStep();

    const after = vehicle.chassis.linvel();
    const az = (after.y - lastVy) / FIXED_DT / 9.81;
    lastVy = after.y;
    accels.push(Math.abs(az));
    contactSum += vehicle.audio.wheelContactFraction;
    speedSum += speed;
    metres += speed * FIXED_DT;
    if (speed > maxSpeed) maxSpeed = speed;
    stalledSteps = speed < 1 ? stalledSteps + 1 : 0;
    if (vehicle.tcsActive) tcsSteps++;
    steps++;
  }

  const rms = Math.sqrt(accels.reduce((a, b) => a + b * b, 0) / Math.max(1, accels.length));
  const heldLateral = rig.lateralSum / Math.max(1, rig.lateralN);
  const sorted = [...accels].sort((a, b) => a - b);
  const jolt = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

  return {
    label,
    metres,
    meanSpeed: (speedSum / Math.max(1, steps)) * 3.6,
    heaveG: rms,
    joltG: jolt,
    contact: contactSum / Math.max(1, steps),
    heldLateral,
    tcsDuty: tcsSteps / Math.max(1, steps),
    maxSpeed: maxSpeed * 3.6,
  };
}

/** Flat-out from rest on the road: the acceleration and top-speed half of the report. */
function flatOut(rig: Rig, seconds: number): { to100s: number | null; topKmh: number; tcs: number } {
  const { vehicle, road, input } = rig;
  const aim = { x: 0, y: 0, z: 0 };
  let s = START_S;
  let to100: number | null = null;
  let top = 0;
  let tcsSteps = 0;
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const t = vehicle.chassis.translation();
    s = advanceS(road, s, t.x, t.z);
    road.offsetPoint(s + LOOKAHEAD, rig.lateral, aim);
    const q = vehicle.chassis.rotation();
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    let error = Math.atan2(aim.x - t.x, aim.z - t.z) - heading;
    while (error > Math.PI) error -= 2 * Math.PI;
    while (error < -Math.PI) error += 2 * Math.PI;
    input.steer = Math.max(-1, Math.min(1, -error * 2.2));
    input.throttle = 1;
    input.brake = 0;
    vehicle.fixedUpdate(FIXED_DT, input);
    rig.physics.step();
    vehicle.postStep();
    const v = vehicle.chassis.linvel();
    const kmh = Math.hypot(v.x, v.z) * 3.6;
    if (kmh > top) top = kmh;
    if (to100 === null && kmh >= 100) to100 = i * FIXED_DT;
    if (vehicle.tcsActive) tcsSteps++;
  }
  return { to100s: to100, topKmh: top, tcs: tcsSteps / steps };
}

function row(r: Result): string {
  return [
    r.label.padEnd(12),
    `${r.meanSpeed.toFixed(1)}`.padStart(7),
    `${r.heaveG.toFixed(3)}`.padStart(8),
    `${r.joltG.toFixed(3)}`.padStart(7),
    `${(r.contact * 100).toFixed(1)}%`.padStart(8),
    `${r.heldLateral.toFixed(0)}m`.padStart(6),
    `${(r.tcsDuty * 100).toFixed(1)}%`.padStart(7),
    `${r.metres.toFixed(0)} m`.padStart(9),
  ].join(' ');
}

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID]);
  console.log(
    `surface feel @ ${speedKmh} km/h asked, ${MODEL_ID}, seed ${SEED}, s ${START_S}..${END_S}`,
  );
  console.log('surface        speed    heave    jolt   contact   line     tcs  distance');

  console.log(row(drive(await makeRig(0, 'flat'), 'flat')));
  console.log(row(drive(await makeRig(0, 'road'), 'road')));
  console.log(row(drive(await makeRig(DESERT_LATERAL, 'desert'), `desert ${DESERT_LATERAL}m`)));

  console.log('\nflat out from rest, 30 s:');
  for (const ground of ['flat', 'road'] as const) {
    const sprint = flatOut(await makeRig(0, ground), 30);
    console.log(
      `  ${ground.padEnd(7)} 0-100 ${
        sprint.to100s === null ? '  never' : `${sprint.to100s.toFixed(1)} s`
      }, top ${sprint.topKmh.toFixed(1)} km/h, tcs lit ${(sprint.tcs * 100).toFixed(1)}%`,
    );
  }
}

await run();
