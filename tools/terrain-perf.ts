/**
 * tools/terrain-perf.ts
 *
 * Chunk build cost for the terrain provider, so the ownership/world-height rules
 * can be checked against the streamer's budget (chunks.ts builds 2 per update).
 *
 *   npx tsx tools/terrain-perf.ts
 *
 * Nothing here is part of the game bundle.
 */

import type { ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';

const road = new Road(1337);
const terrain = new Terrain(1337, road);
const provider = new TerrainMeshProvider();

function ctx(chunkIndex: number): ChunkContext {
  return {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    hasPhysics: false,
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
