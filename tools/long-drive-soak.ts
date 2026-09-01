import * as THREE from 'three';

import { roadTextures } from '../src/render/roadtexture';
import { PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState } from '../src/game/state';
import { ChunkStreamer, CHUNK_LENGTH } from '../src/world/chunks';
import { DesertTileStreamer, DESERT_TILE_SIZE } from '../src/world/deserttiles';
import { WorldOrigin } from '../src/world/origin';
import { MonumentProvider, PoleProvider, ScatterProvider } from '../src/world/props';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { Terrain } from '../src/world/terrain';
import { WorldWorkScheduler } from '../src/world/workqueue';
import { installDocumentShim } from './domshim';

const SEED = 1337;
const START_S = 1_000;
const FORWARD_METRES = 50_000;
const REVERSE_METRES = 5_000;
const FRAME_STEP_METRES = 1;
const DRAIN_TIMEOUT_MS = 15_000;
const GROUND_SAMPLE_INTERVAL_METRES = 500;
const PLATEAU_SAMPLE_INTERVAL_METRES = 250;

interface Telemetry {
  readonly distance: number;
  readonly bodies: number;
  readonly sceneChildren: number;
}

interface DeterministicTileSample {
  readonly s: number;
  readonly x: number;
  readonly z: number;
  readonly height: number;
}

function bodyCount(physics: PhysicsWorld): number {
  let count = 0;
  physics.world.bodies.forEach(() => {
    count++;
  });
  return count;
}

function fail(distance: number, frame: number, invariant: string): never {
  throw new Error(`distance ${distance} m, frame ${frame}: ${invariant}`);
}

function plateauRange(samples: readonly number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample);
    max = Math.max(max, sample);
  }
  return { min, max };
}

function assertSteadyStatePlateau(
  telemetry: readonly Telemetry[],
  key: 'bodies' | 'sceneChildren',
  distance: number,
  frame: number,
): void {
  if (telemetry.length < 8) {
    fail(distance, frame, `only ${telemetry.length} settled ${key} samples; cannot establish a steady-state plateau`);
  }

  const midpoint = Math.floor(telemetry.length / 2);
  const early = plateauRange(telemetry.slice(0, midpoint).map((sample) => sample[key]));
  const late = plateauRange(telemetry.slice(midpoint).map((sample) => sample[key]));
  // Procedural chunks have different prop mixes, so their exact counts legitimately
  // vary. Compare the later steady-state window to the earlier observed window rather
  // than pinning an implementation count; a leaked live set grows far beyond this span.
  const allowedLateMax = early.max + Math.max(8, (early.max - early.min) * 4);
  if (late.max > allowedLateMax) {
    fail(
      distance,
      frame,
      `${key} did not plateau: early ${early.min}-${early.max}, late ${late.min}-${late.max}, allowed late maximum ${allowedLateMax}`,
    );
  }
}

const restoreDocument = installDocumentShim();
// Match production boot: texture canvas generation is a loading-phase cost, not
// scheduler work charged to the first streamed road chunk.
roadTextures();

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const roadDistance = new RoadDistance(road);
const physics = await PhysicsWorld.create();
const world = new GameWorld(newWorldState(SEED));
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const scheduler = new WorldWorkScheduler(3);
const baselineBodies = bodyCount(physics);
const baselineSceneChildren = scene.children.length;

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
streamer.register(new ScatterProvider());
streamer.register(new PoleProvider());
streamer.register(new MonumentProvider());

let frameId = 1;
let distanceTravelled = 0;
let currentS = START_S;
let maxSchedulerWorkMs = 0;
let maxSchedulerWorkTag: string | null = null;
let maxSchedulerWorkFrame = frameId;
let maxSchedulerWorkDistance = distanceTravelled;
/** Slice budget the streaming systems aim for, milliseconds. */
const SLICE_BUDGET_MS = Number(process.env.SOAK_SLICE_BUDGET_MS ?? 12);
/** No streaming unit may ever cost this much: that is unsliced work, not a pause. */
const SLICE_CEILING_MS = 25;
/** Budget overruns tolerated across the whole route before they read as systematic. */
const MAX_BUDGET_OUTLIERS = 4;
/** Slices over budget, for reporting the outlier shape rather than one maximum. */
const outliers: { tag: string; ms: number; frame: number; distance: number }[] = [];
let maxBodies = baselineBodies;
let maxSceneChildren = baselineSceneChildren;
let roadBoundaryCrossings = 0;
let desertBoundaryCrossings = 0;
let rebaseCount = 0;
let groundSamples = 0;
let lastRoadChunk = Math.floor(START_S / CHUNK_LENGTH);
let lastDesertTileX = Math.floor(start.x / DESERT_TILE_SIZE);
let lastDesertTileZ = Math.floor(start.z / DESERT_TILE_SIZE);
const settledTelemetry: Telemetry[] = [];
const deterministicSamples = new Map<number, DeterministicTileSample>();

try {
  streamer.prime(START_S, 0);
  desert.prime(start.x, start.z, 0);
  physics.step();
  if (!desert.hasPhysicsAt(start.x, start.z)) {
    fail(0, frameId, 'prime did not establish physical desert ground at the route start');
  }

  const sampleGround = (s: number, x: number, z: number): void => {
    if (!desert.hasPhysicsAt(x, z)) {
      fail(distanceTravelled, frameId, `physical desert ground is missing under route arclength ${s}`);
    }
    if (distanceTravelled % GROUND_SAMPLE_INTERVAL_METRES !== 0) return;

    const drawnHeight = desert.heightAt(x, z);
    if (drawnHeight === null) {
      fail(distanceTravelled, frameId, `drawn desert height is missing under route arclength ${s}`);
    }
    const hit = physics.raycast(
      { x: x - origin.x, y: drawnHeight + 100, z: z - origin.z },
      { x: 0, y: -1, z: 0 },
      200,
    );
    if (!hit) {
      fail(distanceTravelled, frameId, `collision ray found no physical ground under route arclength ${s}`);
    }
    const heightError = Math.abs(hit.point.y - drawnHeight);
    if (heightError > 1) {
      fail(
        distanceTravelled,
        frameId,
        `drawn/collision ground mismatch ${heightError.toFixed(3)} m under route arclength ${s}`,
      );
    }
    groundSamples++;
  };

  const recordTelemetry = (): void => {
    const bodies = bodyCount(physics);
    const sceneChildren = scene.children.length;
    maxBodies = Math.max(maxBodies, bodies);
    maxSceneChildren = Math.max(maxSceneChildren, sceneChildren);
    if (!scheduler.hasPending && distanceTravelled >= 5_000 && distanceTravelled % PLATEAU_SAMPLE_INTERVAL_METRES === 0) {
      settledTelemetry.push({ distance: distanceTravelled, bodies, sceneChildren });
    }
  };

  const runFrame = async (s: number): Promise<void> => {
    const position = road.sampleAt(s);
    currentS = s;

    // This is the production frame order. Both streamers see one stable frame id and
    // consume from the same three-millisecond scheduler budget before physics advances.
    scheduler.beginFrame(frameId);
    streamer.update(s, frameId, 0);
    desert.update(position.x, position.z, 0, frameId);
    const frameSchedulerWorkMs = scheduler.frameWorkMs;
    if (frameSchedulerWorkMs > maxSchedulerWorkMs) {
      maxSchedulerWorkMs = frameSchedulerWorkMs;
      maxSchedulerWorkTag = scheduler.lastJobTag;
      maxSchedulerWorkFrame = frameId;
      maxSchedulerWorkDistance = distanceTravelled;
    }
    // Every slice over the budget, not just the worst one. A single outlier says
    // nothing about its cause; the SHAPE of the outlier set does. Systematic
    // unsliced work clusters on one tag at every chunk boundary, while allocator
    // pauses land on whatever tag happened to be running.
    if (frameSchedulerWorkMs > SLICE_BUDGET_MS && outliers.length < 64) {
      outliers.push({
        tag: scheduler.lastJobTag ?? 'none',
        ms: frameSchedulerWorkMs,
        frame: frameId,
        distance: distanceTravelled,
      });
    }

    physics.step();
    const shift = origin.advance(position.x, position.z);
    if (shift) {
      physics.rebase(shift.dx, shift.dz);
      streamer.rebase();
      desert.rebase();
      rebaseCount++;
      if (physics.maxBodyDistance() > 4_000) {
        fail(distanceTravelled, frameId, `rebased streamed body is ${physics.maxBodyDistance().toFixed(1)} m from origin`);
      }
    }

    const roadChunk = Math.floor(s / CHUNK_LENGTH);
    roadBoundaryCrossings += Math.abs(roadChunk - lastRoadChunk);
    lastRoadChunk = roadChunk;
    const desertTileX = Math.floor(position.x / DESERT_TILE_SIZE);
    const desertTileZ = Math.floor(position.z / DESERT_TILE_SIZE);
    desertBoundaryCrossings += Math.abs(desertTileX - lastDesertTileX) + Math.abs(desertTileZ - lastDesertTileZ);
    lastDesertTileX = desertTileX;
    lastDesertTileZ = desertTileZ;

    sampleGround(s, position.x, position.z);
    recordTelemetry();
    frameId++;
    if ((frameId - 1) % 8 === 0) await Bun.sleep(0);
  };

  await runFrame(START_S);
  const reverseStartS = START_S + FORWARD_METRES - REVERSE_METRES;
  const deterministicArclengths = [reverseStartS, reverseStartS + 400];

  for (let moved = FRAME_STEP_METRES; moved <= FORWARD_METRES; moved += FRAME_STEP_METRES) {
    distanceTravelled = moved;
    const s = START_S + moved;
    await runFrame(s);
    if (deterministicArclengths.includes(s)) {
      const position = road.sampleAt(s);
      const height = desert.heightAt(position.x, position.z);
      if (height === null) fail(distanceTravelled, frameId - 1, `missing deterministic tile sample at arclength ${s}`);
      deterministicSamples.set(s, { s, x: position.x, z: position.z, height });
    }
  }

  if (deterministicSamples.size !== deterministicArclengths.length) {
    fail(distanceTravelled, frameId - 1, 'forward route did not capture every deterministic tile sample');
  }
  for (const sample of deterministicSamples.values()) {
    if (desert.heightAt(sample.x, sample.z) !== null) {
      fail(distanceTravelled, frameId - 1, `tile at arclength ${sample.s} never unloaded before the reverse leg`);
    }
  }

  for (let moved = FRAME_STEP_METRES; moved <= REVERSE_METRES; moved += FRAME_STEP_METRES) {
    distanceTravelled = FORWARD_METRES + moved;
    const s = START_S + FORWARD_METRES - moved;
    await runFrame(s);
    const sample = deterministicSamples.get(s);
    if (!sample) continue;
    const rebuilt = desert.heightAt(sample.x, sample.z);
    if (rebuilt === null) fail(distanceTravelled, frameId - 1, `rebuilt tile missing at arclength ${s}`);
    if (rebuilt !== sample.height) {
      fail(
        distanceTravelled,
        frameId - 1,
        `tile rebuild at arclength ${s} changed height ${sample.height} -> ${rebuilt}`,
      );
    }
  }

  const drainDeadline = performance.now() + DRAIN_TIMEOUT_MS;
  while (scheduler.hasPending) {
    if (performance.now() >= drainDeadline) {
      fail(
        distanceTravelled,
        frameId,
        `shared world work did not drain within ${DRAIN_TIMEOUT_MS} ms (last job ${scheduler.lastJobTag ?? 'none'})`,
      );
    }
    await runFrame(currentS);
  }

  if (outliers.length > 0) {
    console.log(
      `slices over ${SLICE_BUDGET_MS} ms: ${outliers.length}` +
        (outliers.length >= 64 ? '+ (capped)' : '') +
        ' — ' +
        outliers
          .slice(0, 16)
          .map((o) => `${o.tag}@${o.distance}m=${o.ms.toFixed(1)}ms`)
          .join(' '),
    );
  }
  // TWO INVARIANTS, because there are two failure modes and only one of them is
  // this code's to prevent.
  //
  // A reintroduced indivisible unit — a whole-chunk trimesh, an unsliced geometry
  // build, a lazily-initialised catalogue — costs tens of milliseconds AT EVERY
  // BOUNDARY, so it shows up as both a high ceiling and a large population. The
  // runtime's collector, by contrast, hands a rare pause to whichever slice happens
  // to be running: bounded in count, and not something a work budget can promise
  // away. Measured here: two marginal outliers in ~55 000 frames.
  if (maxSchedulerWorkMs > SLICE_CEILING_MS) {
    fail(
      maxSchedulerWorkDistance,
      maxSchedulerWorkFrame,
      `scheduler job ${maxSchedulerWorkTag ?? 'none'} took ${maxSchedulerWorkMs.toFixed(2)} ms, ` +
        `over the ${SLICE_CEILING_MS} ms ceiling: streaming work is no longer sliced`,
    );
  }
  if (outliers.length > MAX_BUDGET_OUTLIERS) {
    fail(
      maxSchedulerWorkDistance,
      maxSchedulerWorkFrame,
      `${outliers.length} slices exceeded the ${SLICE_BUDGET_MS} ms budget ` +
        `(at most ${MAX_BUDGET_OUTLIERS} expected from allocator pauses alone)`,
    );
  }
  if (roadBoundaryCrossings < FORWARD_METRES / CHUNK_LENGTH) {
    fail(distanceTravelled, frameId - 1, `only ${roadBoundaryCrossings} road chunk-boundary crossings completed`);
  }
  if (desertBoundaryCrossings === 0) {
    fail(distanceTravelled, frameId - 1, 'the gradual route crossed no desert tile boundaries');
  }
  if (groundSamples < 1 + Math.floor((FORWARD_METRES + REVERSE_METRES) / GROUND_SAMPLE_INTERVAL_METRES)) {
    fail(distanceTravelled, frameId - 1, `only ${groundSamples} route ground samples completed`);
  }

  assertSteadyStatePlateau(settledTelemetry, 'bodies', distanceTravelled, frameId - 1);
  assertSteadyStatePlateau(settledTelemetry, 'sceneChildren', distanceTravelled, frameId - 1);

  const finalBodies = bodyCount(physics);
  const finalSceneChildren = scene.children.length;
  console.log(
    `long drive soak: ${FORWARD_METRES / 1000} km forward + ${REVERSE_METRES / 1000} km reverse ` +
      `(${distanceTravelled / 1000} km total) over ${frameId - 1} frames; ` +
      `${roadBoundaryCrossings} road and ${desertBoundaryCrossings} desert boundary crossings; ` +
      `max scheduler work ${maxSchedulerWorkMs.toFixed(2)} ms ` +
      `(job ${maxSchedulerWorkTag ?? 'none'}, frame ${maxSchedulerWorkFrame}, distance ${maxSchedulerWorkDistance} m); ` +
      `physics bodies max/final ${maxBodies}/${finalBodies}; ` +
      `scene children max/final ${maxSceneChildren}/${finalSceneChildren}; ` +
      `final desert tiles ${desert.visualTileCount} visual/${desert.physicsTileCount} physical; ` +
      `${groundSamples} collision samples, ${rebaseCount} origin rebases, ${settledTelemetry.length} settled plateau samples`,
  );
} finally {
  try {
    streamer.dispose();
    desert.dispose();
    const remainingBodies = bodyCount(physics);
    const remainingSceneChildren = scene.children.length;
    if (remainingBodies !== baselineBodies || remainingSceneChildren !== baselineSceneChildren) {
      fail(
        distanceTravelled,
        frameId - 1,
        `disposal did not restore ownership baseline: bodies ${remainingBodies}/${baselineBodies}, scene children ${remainingSceneChildren}/${baselineSceneChildren}`,
      );
    }
    if (scheduler.hasPending) {
      fail(distanceTravelled, frameId - 1, 'disposal left shared world work pending');
    }
  } finally {
    restoreDocument();
  }
}
