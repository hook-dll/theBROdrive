/**
 * tools/boot-warmup.ts
 *
 * Is the world FINISHED when the loading cover leaves?
 *
 * Streaming is amortized at one bounded job per rendered frame, which is right while
 * driving and wrong at boot: `prime` guarantees only the chunk the player stands in
 * plus the nine-tile desert patch, so a resumed save that was already rolling used to
 * start over unbuilt road — the colliders ahead did not exist yet and the car drove
 * off the built ground and under the terrain.
 *
 * `boot()` therefore builds the whole live window under the loading cover with a
 * widened scheduler budget. This drives the REAL streamers and the real providers
 * through that same sequence and asks Rapier the only question that matters: is there
 * fixed support under every metre of road the first fixed step can reach?
 *
 *   bun run tools/boot-warmup.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import { PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, ChunkStreamer } from '../src/world/chunks';
import { DesertTileStreamer } from '../src/world/deserttiles';
import { HomesteadProvider } from '../src/world/house';
import { WorldOrigin } from '../src/world/origin';
import { MonumentProvider, PoleProvider, ScatterProvider } from '../src/world/props';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { Terrain } from '../src/world/terrain';
import { WorldWorkScheduler } from '../src/world/workqueue';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';

const SEED = 1337;
/** Far enough along that the drive is ordinary road rather than the homestead. */
const START_S = 12_000;
/** Chunks either side of the player carry colliders; see PHYSICS_RADIUS in chunks.ts. */
const PHYSICS_REACH_M = 2 * CHUNK_LENGTH;
const SAMPLE_STEP_M = 25;
/** The production boot budget and its ceiling (see main.ts BOOT_STREAM_*). */
const BOOT_BUDGET_MS = 12;
const BOOT_JOBS_PER_FRAME = 64;
const BOOT_CALLS_PER_PASS = 8;
const BOOT_LIMIT_MS = 25_000;

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

const restoreDocument = installDocumentShim();
installAssetShim();

const physics = await PhysicsWorld.create();
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const roadDistance = new RoadDistance(road);
const world = new GameWorld(newWorldState(SEED));
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const scheduler = new WorldWorkScheduler(3, 1);

const start = road.sampleAt(START_S);
origin.reset(start.x, start.z);

const desert = new DesertTileStreamer(
  SEED,
  road,
  terrain,
  roadDistance,
  physics,
  scene,
  origin,
  undefined,
  scheduler,
);
const streamer = new ChunkStreamer(road, terrain, physics, world, scene, origin, scheduler);
streamer.register(new RoadMeshProvider(SEED));
streamer.register(new HomesteadProvider());
streamer.register(new ScatterProvider());
streamer.register(new PoleProvider());
streamer.register(new MonumentProvider());

/**
 * Road-centreline samples across the collider window, asked exactly as a rolling car
 * meets them: a short ray straight down must land on a FIXED body. A dynamic hit or no
 * hit at all is a hole the car falls through.
 */
function unsupportedRoadSamples(): number {
  physics.step();
  let missing = 0;
  for (let ds = -PHYSICS_REACH_M; ds <= PHYSICS_REACH_M; ds += SAMPLE_STEP_M) {
    const point = road.sampleAt(START_S + ds);
    const hit = physics.raycast(
      { x: point.x - origin.x, y: point.y + 6, z: point.z - origin.z },
      { x: 0, y: -1, z: 0 },
      30,
    );
    const supported = hit
      ? (physics.world.getCollider(hit.colliderHandle)?.parent()?.isFixed() ?? false)
      : false;
    if (!supported) missing++;
  }
  return missing;
}

console.log('boot warm-up: the live window is complete before the loop starts');

let frameId = 0;
scheduler.beginFrame(frameId);
const projection = road.project(start.x, start.z, START_S);
desert.prime(start.x, start.z, projection.lateral);
streamer.prime(projection.s, projection.lateral);

const primedRoad = streamer.readiness;
const missingAfterPrime = unsupportedRoadSamples();

// The production warm-up, replicated: a widened budget, several streamer calls per
// pass, and one macrotask between passes so the desert worker can answer.
scheduler.setFrameBudget(BOOT_BUDGET_MS, BOOT_JOBS_PER_FRAME);
const started = performance.now();
let passes = 0;
let complete = false;
while (performance.now() - started < BOOT_LIMIT_MS) {
  frameId++;
  scheduler.beginFrame(frameId);
  for (let call = 0; call < BOOT_CALLS_PER_PASS; call++) {
    streamer.update(projection.s, frameId, projection.lateral);
  }
  desert.update(start.x, start.z, projection.lateral, frameId);
  passes++;
  const roadWindow = streamer.readiness;
  const sandWindow = desert.readiness;
  complete =
    !scheduler.hasPending &&
    roadWindow.ready >= roadWindow.wanted &&
    sandWindow.ready >= sandWindow.wanted;
  if (complete) break;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
const warmMs = performance.now() - started;
scheduler.setFrameBudget(3, 1);

const roadWindow = streamer.readiness;
const sandWindow = desert.readiness;
const missingAfterWarm = unsupportedRoadSamples();

check(
  'prime alone leaves the window incomplete',
  primedRoad.ready < primedRoad.wanted,
  `${primedRoad.ready}/${primedRoad.wanted} chunks, ${missingAfterPrime} unsupported road samples`,
);
check(
  'warm-up reports the whole window ready',
  complete && roadWindow.ready === roadWindow.wanted && sandWindow.ready === sandWindow.wanted,
  `${roadWindow.ready}/${roadWindow.wanted} chunks, ${sandWindow.ready}/${sandWindow.wanted} tiles`,
);
check(
  'every metre of the collider window is solid',
  missingAfterWarm === 0,
  `${missingAfterWarm} unsupported road samples`,
);
check(
  'warm-up finishes well inside its ceiling',
  warmMs < BOOT_LIMIT_MS,
  `${warmMs.toFixed(0)} ms over ${passes} pass(es)`,
);

streamer.dispose();
desert.dispose();
restoreDocument();

console.log(failures === 0 ? '\nall boot warm-up checks passed' : `\n${failures} boot warm-up check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
