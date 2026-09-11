import * as THREE from 'three';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { loadCarModel } from '../src/render/carmodel';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { RoadTraffic } from '../src/world/traffic';
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
installAssetShim();

const SEED = Number(process.argv[2] ?? 42);
const PLAYER_S = 1_000;
const ROAD_FROM = 100;
const ROAD_TO = 3_200;
const ROAD_STEP = 2;
const RIBBON_HALF_WIDTH = ROAD_HALF_WIDTH + 3;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

function addRoadCollider(physics: PhysicsWorld, road: Road): void {
  const surface = new SurfaceField(road.seed);
  const rows = Math.ceil((ROAD_TO - ROAD_FROM) / ROAD_STEP) + 1;
  const vertices = new Float32Array(rows * 6);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = Math.min(ROAD_TO, ROAD_FROM + row * ROAD_STEP);
    for (let side = 0; side < 2; side++) {
      const lateral = side === 0 ? -RIBBON_HALF_WIDTH : RIBBON_HALF_WIDTH;
      road.offsetPoint(s, lateral, point);
      const index = (row * 2 + side) * 3;
      vertices[index] = point.x;
      vertices[index + 1] = roadSurfaceY(road, surface, s, lateral, point.x, point.z);
      vertices[index + 2] = point.z;
    }
  }
  const indices = new Uint32Array((rows - 1) * 6);
  for (let row = 0, index = 0; row < rows - 1; row++) {
    const a = row * 2;
    indices[index++] = a;
    indices[index++] = a + 2;
    indices[index++] = a + 1;
    indices[index++] = a + 2;
    indices[index++] = a + 3;
    indices[index++] = a + 1;
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);
}

console.log('world traffic bench: bounded, transient physical cars on the real road');
const road = new Road(SEED);
const physics = await PhysicsWorld.create();
addRoadCollider(physics, road);
const world = new GameWorld(newWorldState(SEED));
const traffic = new RoadTraffic(
  physics,
  world,
  new THREE.Scene(),
  new WorldOrigin(),
  road,
  new HazardIndex(),
  loadCarModel,
  () => true,
);
traffic.setTargetCount(30);
traffic.setDaylightFactor(0);

let largestCount = 0;
let smallestPopulated = Infinity;
const stoppedFor = new Map<string, number>();
let longestStop = 0;
function sampleStoppedTraffic(): void {
  const live = new Set<string>();
  traffic.forEachVehicle((id, vehicle) => {
    live.add(id);
    const duration = vehicle.speedKmh < 2 ? (stoppedFor.get(id) ?? 0) + FIXED_DT : 0;
    stoppedFor.set(id, duration);
    longestStop = Math.max(longestStop, duration);
  });
  for (const id of stoppedFor.keys()) {
    if (!live.has(id)) stoppedFor.delete(id);
  }
}
for (let step = 0; step < Math.ceil(30 / FIXED_DT); step++) {
  traffic.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0);
  physics.step();
  traffic.postStep();
  sampleStoppedTraffic();
  largestCount = Math.max(largestCount, traffic.status.count);
  if (traffic.status.count > 0) smallestPopulated = Math.min(smallestPopulated, traffic.status.count);
  if (step % 6 === 0) await Bun.sleep(0);
}
const populated = traffic.status;
const catalogue = new Set(CAR_MODELS.map((model) => model.id));
check(
  'traffic stays within its thirty-car setting',
  largestCount <= 30 && populated.count <= 30,
  `largest ${largestCount}, live ${populated.count}`,
);
check(
  'traffic forms a frequent local stream',
  populated.count >= 9 && populated.nearestRoadDistance <= 300,
  `${populated.count} live, nearest ${populated.nearestRoadDistance.toFixed(0)} m away`,
);
check(
  'both directions are populated',
  populated.sameDirection > 0 && populated.oncoming > 0,
  `${populated.sameDirection} same-direction, ${populated.oncoming} oncoming`,
);
check(
  'traffic contains cautious, normal and passing-capable drivers',
  populated.sleeper > 0 && populated.hurried > 0 && populated.cautious > 0,
  `${populated.sleeper} sleeper, ${populated.hurried} hurried, ${populated.cautious} cautious`,
);
check(
  'night traffic uses only low beam',
  populated.highBeams === 0 && populated.lowBeams > 0,
  `${populated.highBeams} high, ${populated.lowBeams} low`,
);
check(
  'both directions actually drive',
  populated.movingSameDirection > 0 && populated.movingOncoming > 0,
  `${populated.movingSameDirection} same-direction and ${populated.movingOncoming} oncoming moved`,
);
check(
  'random traffic draws only from the full catalogue',
  populated.modelIds.length > 0 && populated.modelIds.every((id) => catalogue.has(id)),
  populated.modelIds.join(', '),
);
check(
  'temporary traffic never enters the player save',
  Object.keys(world.state.cars).length === 0,
  `${Object.keys(world.state.cars).length} persistent traffic cars`,
);
// Keep the stream moving through several generations. Passing has a dedicated,
// authored playground scenario; this random stream owns the collision-free queue.
for (let step = 0; step < Math.ceil(120 / FIXED_DT); step++) {
  const movingPlayerS = PLAYER_S + step * FIXED_DT * 12;
  traffic.fixedUpdate(FIXED_DT, movingPlayerS, 0, 0);
  physics.step();
  traffic.postStep();
  sampleStoppedTraffic();
  largestCount = Math.max(largestCount, traffic.status.count);
  if (traffic.status.count > 0) smallestPopulated = Math.min(smallestPopulated, traffic.status.count);
  if (step % 12 === 0) await Bun.sleep(0);
}
const streamed = traffic.status;
check(
  'mixed traffic queues without collision',
  streamed.impacts === 0,
  `${streamed.impacts} impact(s), ${streamed.passes} pass(es), ${streamed.count} live`,
);
check(
  'traffic density varies below configured cap',
  largestCount <= 30 && smallestPopulated < largestCount,
  `${streamed.count} live, range ${smallestPopulated}-${largestCount}`,
);
check(
  'dense queues always resume',
  longestStop < 30,
  `longest continuous stop ${longestStop.toFixed(1)} s`,
);


traffic.fixedUpdate(0.6, PLAYER_S + 4_000, 0, 0);
check(
  'cars despawn beyond the active range',
  traffic.status.count === 0,
  `${traffic.status.count} cars remain`,
);
traffic.setTargetCount(0);
check(
  'zero traffic setting leaves no live or pending traffic',
  traffic.status.count === 0 && !traffic.status.pending && !traffic.enabled,
  JSON.stringify(traffic.status),
);
traffic.dispose();

console.log(failures === 0 ? '\nall traffic checks passed' : `\n${failures} traffic check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
