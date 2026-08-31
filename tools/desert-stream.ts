import * as THREE from 'three';

import { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import {
  DesertTileStreamer,
  DESERT_TILE_CELLS,
  DESERT_TILE_SIZE,
} from '../src/world/deserttiles';
import { generateDesertTileData } from '../src/world/deserttiledata';
import { desertPropForms, type BreakableSink, type BreakableProp } from '../src/world/props';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';
import { WorldWorkScheduler } from '../src/world/workqueue';

const seed = 1337;
const road = new Road(seed);
const terrain = new Terrain(seed, road);

const roadDistance = new RoadDistance(road);
const physics = await PhysicsWorld.create();

function bodyCount(): number {
  let count = 0;
  physics.world.bodies.forEach(() => {
    count++;
  });
  return count;
}
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const scheduler = new WorldWorkScheduler(3);

const startS = 20_000;
const start = road.offsetPoint(startS, 1500);
origin.reset(start.x, start.z);
const standing = new Map<number, BreakableProp>();
const breakables: BreakableSink = {
  isBroken: () => false,
  register: (prop) => standing.set(prop.id, prop),
  forget: (ids) => {
    for (const id of ids) standing.delete(id);
  },
};
const streamer = new DesertTileStreamer(
  seed,
  road,
  terrain,
  roadDistance,
  physics,
  scene,
  origin,
  breakables,
  scheduler,
);
try {
  const formIdByGeometry = new Map<THREE.BufferGeometry, string>();
  for (const surface of [SurfaceType.Sand, SurfaceType.Rock]) {
    for (const form of desertPropForms(surface)) formIdByGeometry.set(form.geometry, form.id);
  }
  const propCensus = (): { total: number; mix: string } => {
    const counts = new Map<string, number>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const id = formIdByGeometry.get(object.geometry);
      if (id) counts.set(id, (counts.get(id) ?? 0) + object.count);
    });
    const entries = [...counts].sort(([a], [b]) => a.localeCompare(b));
    return {
      total: entries.reduce((sum, [, count]) => sum + count, 0),
      mix: entries.map(([id, count]) => `${id}:${count}`).join(','),
    };
  };

  const primeStart = performance.now();
  streamer.prime(start.x, start.z, 1500);
  const primeMs = performance.now() - primeStart;
  if (streamer.visualTileCount !== 9 || streamer.physicsTileCount !== 9) {
    throw new Error(`prime set is ${streamer.visualTileCount} visual/${streamer.physicsTileCount} physical, expected 9/9`);
  }
  physics.step();
  if (!streamer.hasPhysicsAt(start.x, start.z)) throw new Error('current tile is not physical after prime');

  const centreTx = Math.floor(start.x / DESERT_TILE_SIZE);
  const centreTz = Math.floor(start.z / DESERT_TILE_SIZE);
  const tileStartX = centreTx * DESERT_TILE_SIZE;
  const tileStartZ = centreTz * DESERT_TILE_SIZE;
  let terrainHits = 0;
  let worstRayError = 0;
  for (let ix = 10; ix <= 70; ix += 15) {
    for (let iz = 10; iz <= 70; iz += 15) {
      const x = tileStartX + ix * 3;
      const z = tileStartZ + iz * 3;
      const drawn = streamer.heightAt(x, z);
      if (drawn === null) throw new Error('missing drawn height inside current tile');
      const hit = physics.raycast(
        { x: x - origin.x, y: drawn + 100, z: z - origin.z },
        { x: 0, y: -1, z: 0 },
        200,
      );
      if (!hit) throw new Error(`no physical ground at ${x}, ${z}`);
      const error = Math.abs(hit.point.y - drawn);
      // A sparse rock can legitimately be the first hit. Terrain hits must reproduce
      // the exact regular-lattice vertex shared by the renderer and heightfield.
      if (error < 0.25) {
        terrainHits++;
        if (error > worstRayError) worstRayError = error;
      }
    }
  }
  if (terrainHits < 20) throw new Error(`only ${terrainHits} terrain ray hits; heightfield may be transposed`);
  if (worstRayError > 0.02) throw new Error(`render/physics height mismatch ${worstRayError.toFixed(4)} m`);

  const frameDistance = 12;
  const drainTimeoutMs = 10_000;
  let frameId = 1;
  let maxSchedulerWorkMs = 0;
  let boundaryCrossings = 0;
  let lastTx = Math.floor(start.x / DESERT_TILE_SIZE);
  let lastTz = Math.floor(start.z / DESERT_TILE_SIZE);
  let pendingWorkDrained = false;
  const runFrame = (x: number, z: number, lateral: number): void => {
    scheduler.beginFrame(frameId);
    streamer.update(x, z, lateral, frameId);
    maxSchedulerWorkMs = Math.max(maxSchedulerWorkMs, scheduler.frameWorkMs);

    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    boundaryCrossings += Math.abs(tx - lastTx) + Math.abs(tz - lastTz);
    lastTx = tx;
    lastTz = tz;
    frameId++;
  };
  const yieldToWorker = async (): Promise<void> => {
    await Bun.sleep(0);
  };
  const drain = async (x: number, z: number, lateral: number, label: string): Promise<void> => {
    const deadline = performance.now() + drainTimeoutMs;
    while (scheduler.hasPending) {
      if (performance.now() >= deadline) {
        throw new Error(
          `desert work did not drain after ${label} within ${drainTimeoutMs} ms ` +
            `(last job: ${scheduler.lastJobTag ?? 'none'})`,
        );
      }
      await yieldToWorker();
      runFrame(x, z, lateral);
    }
    pendingWorkDrained = true;
  };
  const settle = async (x: number, z: number, lateral: number, label: string): Promise<void> => {
    runFrame(x, z, lateral);
    await drain(x, z, lateral, label);
    if (streamer.visualTileCount !== 25 || streamer.physicsTileCount !== 9) {
      throw new Error(`settled set is ${streamer.visualTileCount} visual/${streamer.physicsTileCount} physical, expected 25/9`);
    }
  };

  let probeX = start.x;
  let probeZ = start.z;
  const traverseTo = async (targetX: number, targetZ: number, lateral: number, label: string): Promise<void> => {
    while (Math.hypot(targetX - probeX, targetZ - probeZ) > frameDistance) {
      const dx = targetX - probeX;
      const dz = targetZ - probeZ;
      const distance = Math.hypot(dx, dz);
      probeX += (dx / distance) * frameDistance;
      probeZ += (dz / distance) * frameDistance;
      runFrame(probeX, probeZ, lateral);
    }
    probeX = targetX;
    probeZ = targetZ;
    await settle(probeX, probeZ, lateral, label);
  };
  const traverseLateral = async (targetLateral: number, label: string): Promise<void> => {
    const target = road.offsetPoint(startS, targetLateral);
    while (Math.hypot(target.x - probeX, target.z - probeZ) > frameDistance) {
      const dx = target.x - probeX;
      const dz = target.z - probeZ;
      const distance = Math.hypot(dx, dz);
      probeX += (dx / distance) * frameDistance;
      probeZ += (dz / distance) * frameDistance;
      runFrame(probeX, probeZ, road.project(probeX, probeZ).lateral);
    }
    probeX = target.x;
    probeZ = target.z;
    await settle(probeX, probeZ, targetLateral, label);
  };

  await settle(probeX, probeZ, 1500, 'initial prime');
  const initialProps = propCensus();
  const initialKinds = initialProps.mix === '' ? 0 : initialProps.mix.split(',').length;
  if (initialKinds < 4 || !/(saguaro|barrel|deadstick|trunk|scrub):/.test(initialProps.mix)) {
    throw new Error(`open desert prop mix is still unvaried: ${initialProps.mix || 'empty'}`);
  }
  if (standing.size === 0) throw new Error('physical tiles registered no breakable desert props');
  const initialBreakableIds = new Set(standing.keys());
  for (const id of initialBreakableIds) {
    if (id > -1_000_000) throw new Error(`tile prop id overlaps road-owned ids: ${id}`);
  }
  const sampleX = tileStartX + 120;
  const sampleZ = tileStartZ + 120;
  const originalHeight = streamer.heightAt(sampleX, sampleZ);
  if (originalHeight === null) throw new Error('missing deterministic sample before unload');

  const traversalStart = performance.now();
  const farX = start.x + DESERT_TILE_SIZE * 8;
  await traverseTo(farX, start.z, 3500, 'outbound traversal');
  if (streamer.heightAt(sampleX, sampleZ) !== null) throw new Error('old tile remained resident after leaving visual radius');
  for (const id of initialBreakableIds) {
    if (standing.has(id)) throw new Error(`unloaded breakable prop ${id} remained registered`);
  }
  await traverseTo(start.x, start.z, 1500, 'return traversal');
  const rebuiltHeight = streamer.heightAt(sampleX, sampleZ);
  if (rebuiltHeight !== originalHeight) {
    throw new Error(`rebuilt height changed: ${originalHeight} -> ${rebuiltHeight}`);
  }
  const rebuiltProps = propCensus();
  if (rebuiltProps.total !== initialProps.total || rebuiltProps.mix !== initialProps.mix) {
    throw new Error(`rebuilt prop scatter changed: ${initialProps.mix} -> ${rebuiltProps.mix}`);
  }
  const assertCurrentMode = (farFromRoad: boolean, label: string): void => {
    const centreTx = Math.floor(probeX / DESERT_TILE_SIZE);
    const centreTz = Math.floor(probeZ / DESERT_TILE_SIZE);
    // Rapier's query pipeline is refreshed by `world.step()`, so colliders promoted
    // since the last step are invisible to a raycast. The prime sweep above steps
    // first for the same reason; a transition promotes new tiles, so step again.
    physics.step();
    // Same acceptance rule as the prime-time ray sweep above: a sparse rock or a
    // road overlay can legitimately be the first thing a ray meets, so a hit only
    // counts as a TERRAIN hit when it lands near the drawn lattice vertex, and the
    // qualifying hits are what must agree to within 2 cm.
    let terrainHits = 0;
    let worstRayError = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = centreTx + dx;
        const tz = centreTz + dz;
        const expected = generateDesertTileData(
          { seed, road, terrain, roadDistance },
          tx,
          tz,
          farFromRoad,
        );
        const tileStartX = tx * DESERT_TILE_SIZE;
        const tileStartZ = tz * DESERT_TILE_SIZE;
        for (let ix = 10; ix <= 70; ix += 15) {
          for (let iz = 10; iz <= 70; iz += 15) {
            const index = ix * (DESERT_TILE_CELLS + 1) + iz;
            const expectedHeight = expected.heights[index]!;
            const x = tileStartX + ix * 3;
            const z = tileStartZ + iz * 3;
            const drawn = streamer.heightAt(x, z);
            if (drawn === null || Math.abs(drawn - expectedHeight) > 1e-5) {
              throw new Error(`${label} current-mode height is not deterministic at ${tx},${tz}`);
            }
            const hit = physics.raycast(
              { x: x - origin.x, y: drawn + 100, z: z - origin.z },
              { x: 0, y: -1, z: 0 },
              200,
            );
            if (!hit) continue;
            const error = Math.abs(hit.point.y - drawn);
            if (error < 0.25) {
              terrainHits++;
              if (error > worstRayError) worstRayError = error;
            }
          }
        }
      }
    }
    if (terrainHits < 20) {
      throw new Error(`${label} produced only ${terrainHits} terrain ray hits`);
    }
    if (worstRayError > 0.02) {
      throw new Error(`${label} render/physics height mismatch ${worstRayError.toFixed(4)} m`);
    }
  };

  await traverseLateral(850, 'near-road transition with directional prefetch');
  assertCurrentMode(false, 'near-road transition');
  await traverseLateral(1500, 'open-field transition with directional prefetch');
  assertCurrentMode(true, 'open-field transition');
  await traverseLateral(850, 'near-road deterministic replay');
  assertCurrentMode(false, 'near-road deterministic replay');
  await traverseLateral(1500, 'open-field restoration');


  const shiftedX = farX + 3000;
  await traverseTo(shiftedX, start.z, 6500, 'floating-origin traversal');
  const shift = origin.advance(shiftedX, start.z);
  if (!shift) throw new Error('expected floating-origin shift');
  physics.rebase(shift.dx, shift.dz);
  streamer.rebase();
  await settle(shiftedX, start.z, 6500, 'floating-origin rebase');
  if (physics.maxBodyDistance() > 900) {
    throw new Error(`streamed body escaped floating-origin frame: ${physics.maxBodyDistance().toFixed(1)} m`);
  }
  const bodiesBeforeWorkerFailure = bodyCount();
  const failureScene = new THREE.Scene();
  const failureScheduler = new WorldWorkScheduler(3);
  const queuedWorkerRequests: Array<{
    readonly requestId: number;
    readonly tx: number;
    readonly tz: number;
    readonly farFromRoad: boolean;
  }> = [];
  const failureWorker: {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessageerror: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown): void;
    terminate(): void;
  } = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message: unknown): void {
      const request = message as {
        readonly type?: string;
        readonly requestId?: number;
        readonly tx?: number;
        readonly tz?: number;
        readonly farFromRoad?: boolean;
      };
      if (
        request.type !== 'tile' ||
        request.requestId === undefined ||
        request.tx === undefined ||
        request.tz === undefined ||
        request.farFromRoad === undefined
      ) {
        return;
      }
      queuedWorkerRequests.push({
        requestId: request.requestId,
        tx: request.tx,
        tz: request.tz,
        farFromRoad: request.farFromRoad,
      });
    },
    terminate(): void {},
  };
  const failureStreamer = new DesertTileStreamer(
    seed,
    road,
    terrain,
    roadDistance,
    physics,
    failureScene,
    origin,
    undefined,
    failureScheduler,
    () => failureWorker as unknown as Worker,
  );
  try {
    failureStreamer.prime(start.x, start.z, 1500);
    failureWorker.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
    failureScheduler.beginFrame(1);
    failureStreamer.update(start.x, start.z, 1500, 1);
    const oldModeRequest = queuedWorkerRequests.at(-1);
    if (!oldModeRequest || !oldModeRequest.farFromRoad) {
      throw new Error('controlled worker did not receive an open-field request');
    }

    failureScheduler.beginFrame(2);
    failureStreamer.update(start.x, start.z, 850, 2);
    const replacementRequest = queuedWorkerRequests.at(-1);
    if (
      !replacementRequest ||
      replacementRequest.requestId === oldModeRequest.requestId ||
      replacementRequest.farFromRoad
    ) {
      throw new Error('road-mode transition did not replace the in-flight worker request');
    }

    const oldData = generateDesertTileData(
      { seed, road, terrain, roadDistance },
      oldModeRequest.tx,
      oldModeRequest.tz,
      true,
    );
    failureWorker.onmessage?.({
      data: {
        type: 'tile',
        requestId: oldModeRequest.requestId,
        tx: oldModeRequest.tx,
        tz: oldModeRequest.tz,
        data: oldData,
      },
    } as MessageEvent);
    const staleX = oldModeRequest.tx * DESERT_TILE_SIZE + DESERT_TILE_SIZE * 0.5;
    const staleZ = oldModeRequest.tz * DESERT_TILE_SIZE + DESERT_TILE_SIZE * 0.5;
    if (failureStreamer.heightAt(staleX, staleZ) !== null) {
      throw new Error('late open-field worker result attached after the road-mode transition');
    }

    failureWorker.onerror?.({} as Event);
    const failureDeadline = performance.now() + drainTimeoutMs;
    let failureFrame = 3;
    while (failureScheduler.hasPending) {
      if (performance.now() >= failureDeadline) {
        throw new Error('degraded desert stream did not drain after worker failure');
      }
      failureScheduler.beginFrame(failureFrame);
      failureStreamer.update(start.x, start.z, 850, failureFrame);
      failureFrame++;
    }
    if (failureStreamer.visualTileCount !== 25 || failureStreamer.physicsTileCount !== 9) {
      throw new Error(
        `degraded set is ${failureStreamer.visualTileCount} visual/${failureStreamer.physicsTileCount} physical, expected 25/9`,
      );
    }
  } finally {
    failureStreamer.dispose();
  }
  if (failureScene.children.length !== 0 || bodyCount() !== bodiesBeforeWorkerFailure) {
    throw new Error('worker-failure desert streamer disposal leaked scene or physics resources');
  }

  if (boundaryCrossings < 3) throw new Error(`only ${boundaryCrossings} continuous tile-boundary crossings completed`);
  const traversalWallMs = performance.now() - traversalStart;

  console.log(
    `desert stream: prime ${primeMs.toFixed(1)} ms for 9 physical tiles; ` +
      `${terrainHits} terrain rays, worst mismatch ${(worstRayError * 1000).toFixed(2)} mm; ` +
      `${boundaryCrossings} continuous boundary crossings; max scheduler frame work ${maxSchedulerWorkMs.toFixed(1)} ms; ` +
      `aggregate traversal wall ${traversalWallMs.toFixed(1)} ms; pending work drained: ${pendingWorkDrained}; ` +
      `settled ${streamer.visualTileCount} visual/${streamer.physicsTileCount} physical with ` +
      `${initialProps.total} props (${initialProps.mix}); deterministic rebuild, current-mode terrain/collision, stale worker-result rejection, and floating-origin shift passed at frame ${frameId - 1}`,
  );
} finally {
  streamer.dispose();
}
