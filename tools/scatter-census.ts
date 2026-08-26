/**
 * tools/scatter-census.ts
 *
 * What the desert is actually furnished with, and what it costs.
 *
 * Builds the REAL `ScatterProvider` over a span of chunks and counts what comes out:
 * how many of each form, where they sit laterally, how many triangles they add per
 * chunk and across the streamer's whole visual window, and how many static colliders
 * the physics chunks carry. Physics is captured rather than simulated, so this runs in
 * Node with no wasm.
 *
 *   npx tsx tools/scatter-census.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import type { ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';
import { ScatterProvider } from '../src/world/props';

/** Chunks kept alive either side of the player, from chunks.ts VISUAL_RADIUS. */
const VISUAL_RADIUS = 6;
/** Chunks carrying colliders, from chunks.ts PHYSICS_RADIUS. */
const PHYSICS_RADIUS = 2;

const FROM_CHUNK = 120;
const TO_CHUNK = 139;

const physics = await PhysicsWorld.create();

const road = new Road(1337);
const terrain = new Terrain(1337, road);
// Warm the road's node cache first: lazy spine integration is a separate, one-off
// cost, and without this the timing below is mostly that (measured: 75 ms/chunk cold
// against 8 ms warm). tools/terrain-perf.ts does the same for the same reason.
for (let c = FROM_CHUNK - 4; c <= TO_CHUNK + 4; c++) {
  for (let k = 0; k < CHUNK_LENGTH; k += 8) road.sampleAt(c * CHUNK_LENGTH + k);
}
const roadDistance = new RoadDistance(road);
const provider = new ScatterProvider(roadDistance);
let colliderCount = 0;

interface FormStat {
  instances: number;
  triangles: number;
}

const perForm = new Map<string, FormStat>();
let chunks = 0;
let totalInstances = 0;
let totalTriangles = 0;
let buildMs = 0;
const lateralHistogram = new Map<number, number>();
let deadStickCount = 0;
let deadStickHits = 0;
let trunkCount = 0;
let trunkHits = 0;
const instanceMatrix = new THREE.Matrix4();
const instancePosition = new THREE.Vector3();
const instanceScale = new THREE.Vector3();
const geometrySize = new THREE.Vector3();

for (let chunkIndex = FROM_CHUNK; chunkIndex <= TO_CHUNK; chunkIndex++) {
  const ctx = {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics,
    world: { seed: 1337 },
    hasPhysics: true,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;

  const t0 = performance.now();
  const content = provider.build(ctx);
  buildMs += performance.now() - t0;
  physics.step();
  chunks++;
  colliderCount += content.colliders?.length ?? 0;
  for (const child of content.group.children) {
    // Every scatter child is an InstancedMesh; `children` is typed as the Object3D
    // base, which cannot express that.
    const mesh = child as unknown as InstancedMesh;
    const index = mesh.geometry.getIndex();
    const triangles = ((index ? index.count : mesh.geometry.getAttribute('position').count) / 3) * mesh.count;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox!.getSize(geometrySize);
    const isDeadStick = geometrySize.y > 1.5 && geometrySize.x < 0.7;
    const isTrunk = geometrySize.x > 2.5 && geometrySize.y < 1;
    const key = `${mesh.geometry.getAttribute('position').count}v`;
    const stat = perForm.get(key) ?? { instances: 0, triangles: 0 };
    stat.instances += mesh.count;
    stat.triangles += triangles;
    perForm.set(key, stat);
    totalInstances += mesh.count;
    totalTriangles += triangles;

    // Lateral offset of each instance, bucketed, from its own matrix translation.
    for (let i = 0; i < mesh.count; i++) {
      const m = mesh.instanceMatrix.array as unknown as Float32Array;
      const x = m[i * 16 + 12]!;
      const z = m[i * 16 + 14]!;
      const lateral = Math.abs(road.project(x, z, chunkIndex * CHUNK_LENGTH).lateral);
      const bucket = Math.floor(lateral / 50) * 50;
      lateralHistogram.set(bucket, (lateralHistogram.get(bucket) ?? 0) + 1);
      if (isDeadStick || isTrunk) {
        instanceMatrix.fromArray(mesh.instanceMatrix.array, i * 16);
        instancePosition.setFromMatrixPosition(instanceMatrix);
        instanceScale.setFromMatrixScale(instanceMatrix);
        const scale = instanceScale.x;
        if (isDeadStick) {
          deadStickCount++;
          const hit = physics.raycast(
            { x: instancePosition.x - 0.5 * scale, y: instancePosition.y + 0.75 * scale, z: instancePosition.z },
            { x: 1, y: 0, z: 0 },
            scale,
          );
          if (hit && physics.surfaces.lookupType(hit.colliderHandle) === SurfaceType.Rock) deadStickHits++;
        } else {
          trunkCount++;
          const hit = physics.raycast(
            { x: instancePosition.x, y: instancePosition.y + 2 * scale, z: instancePosition.z },
            { x: 0, y: -1, z: 0 },
            3 * scale,
          );
          if (hit && physics.surfaces.lookupType(hit.colliderHandle) === SurfaceType.Rock) trunkHits++;
        }
      }
    }

  }
  for (const body of content.bodies ?? []) physics.world.removeRigidBody(body);
  content.dispose?.();
}

const visualChunks = VISUAL_RADIUS * 2 + 1;
const physicsChunks = PHYSICS_RADIUS * 2 + 1;

console.log(`scatter census over ${chunks} chunks (seed 1337)`);
console.log(
  `  ${(totalInstances / chunks).toFixed(1)} props/chunk, ` +
    `${Math.round(totalTriangles / chunks)} triangles/chunk, ` +
    `build ${(buildMs / chunks).toFixed(2)} ms/chunk`,
);
console.log(
  `  streamer totals: ${Math.round((totalInstances / chunks) * visualChunks)} props and ` +
    `${Math.round((totalTriangles / chunks) * visualChunks)} triangles over ${visualChunks} visual chunks; ` +
    `${Math.round((colliderCount / chunks) * physicsChunks)} static colliders over ${physicsChunks} physics chunks`,
);
console.log('  props by lateral distance from the centreline:');
for (const bucket of [...lateralHistogram.keys()].sort((a, b) => a - b)) {
  const n = lateralHistogram.get(bucket)!;
  const perChunk = n / chunks;
  console.log(
    `    ${String(bucket).padStart(4)}-${String(bucket + 50).padEnd(4)} m: ` +
      `${perChunk.toFixed(1).padStart(6)} /chunk  ${'#'.repeat(Math.max(1, Math.round(perChunk)))}`,
  );
}

const woodOk =
  deadStickCount > 0 &&
  trunkCount > 0 &&
  deadStickHits === deadStickCount &&
  trunkHits === trunkCount;
console.log(
  `  wooden prop collision: dead sticks ${deadStickHits}/${deadStickCount}, ` +
    `fallen trunks ${trunkHits}/${trunkCount}`,
);
if (!woodOk) process.exitCode = 1;
