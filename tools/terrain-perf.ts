/**
 * tools/terrain-perf.ts
 *
 * Chunk build cost for the terrain provider, so the ownership/world-height rules can be
 * checked against the streamer's budget (chunks.ts builds 2 per update), plus the cost of
 * one vista rebuild at each view-distance tier — the other thing that lands in a single
 * frame.
 *
 *   npx tsx tools/terrain-perf.ts
 *
 * Nothing here is part of the game bundle.
 */

import type * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { VIEW_DISTANCE_METRES } from '../src/game/settings';
import { VistaMesh } from '../src/render/vista';
import type { ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';

const road = new Road(1337);
const terrain = new Terrain(1337, road);
const roadDistance = new RoadDistance(road);
const provider = new TerrainMeshProvider(roadDistance);

function ctx(chunkIndex: number, physics?: PhysicsWorld): ChunkContext {
  return {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics,
    hasPhysics: physics !== undefined,
    // Without these every f32 coordinate the provider writes is NaN, the fold test
    // rejects every cell, and the measurement quietly skips the ownership lattice —
    // i.e. it measures a build that emits nothing.
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
}

// Warm the road's node cache first: integration is a separate, one-off cost.
for (let c = 100; c < 200; c++) road.sampleAt(c * CHUNK_LENGTH);

const times: number[] = [];
for (let c = 120; c < 160; c++) {
  const t0 = performance.now();
  const content = provider.build(ctx(c));
  times.push(performance.now() - t0);
  content?.dispose?.();
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(
  `terrain chunk build over ${times.length} chunks: mean ${mean.toFixed(2)} ms, ` +
    `median ${times[Math.floor(times.length / 2)]!.toFixed(2)} ms, worst ${times[times.length - 1]!.toFixed(2)} ms`,
);

// The same build WITH its collider. Inside PHYSICS_RADIUS every chunk pays this, and
// what it adds is not the sampling (already counted above) but Rapier's own trimesh
// construction — a QBVH over every triangle inside the solid band, which the refined
// near grid multiplied by about seven.
{
  const physics = await PhysicsWorld.create();
  const solidTimes: number[] = [];
  let triangles = 0;
  for (let c = 200; c < 220; c++) {
    const t0 = performance.now();
    const content = provider.build(ctx(c, physics));
    solidTimes.push(performance.now() - t0);
    for (const collider of content?.colliders ?? []) {
      const shape = collider.shape as unknown as { indices?: Uint32Array };
      triangles += (shape.indices?.length ?? 0) / 3;
    }
    for (const body of content?.bodies ?? []) physics.world.removeRigidBody(body);
    content?.dispose?.();
  }
  solidTimes.sort((a, b) => a - b);
  const solidMean = solidTimes.reduce((a, b) => a + b, 0) / solidTimes.length;
  console.log(
    `terrain chunk build WITH collider over ${solidTimes.length} chunks: ` +
      `mean ${solidMean.toFixed(2)} ms, median ${solidTimes[Math.floor(solidTimes.length / 2)]!.toFixed(2)} ms, ` +
      `worst ${solidTimes[solidTimes.length - 1]!.toFixed(2)} ms, ` +
      `${Math.round(triangles / solidTimes.length)} collider triangles/chunk`,
  );
}

// Vista rebuilds: a fresh disc at each tier, then a second one 250 m along, which is
// what the player actually pays for once the distance lattice has warmed.
const scene = { add() {}, remove() {} } as unknown as THREE.Scene;
const vista = new VistaMesh(scene, terrain, roadDistance);
for (const [tier, metres] of Object.entries(VIEW_DISTANCE_METRES)) {
  vista.setViewDistance(metres);
  const t0 = performance.now();
  vista.update(30_000, 0);
  const cold = performance.now() - t0;
  const t1 = performance.now();
  vista.update(30_250, 0);
  const warm = performance.now() - t1;
  console.log(
    `vista ${tier} (${metres} m): ${vista.vertexCount} verts, ` +
      `first build ${cold.toFixed(1)} ms, 250 m later ${warm.toFixed(1)} ms`,
  );
}
