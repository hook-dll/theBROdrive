/**
 * tools/terrain-overlap.ts
 *
 * Is the drawn desert a single surface?
 *
 * Every chunk fans terrain out to FAR_LATERAL either side of ITS OWN 200 m of
 * road, the streamer keeps chunks alive 1200 m of road each way, and the road
 * turns on radii as tight as 170 m — so chunks routinely fan across each other.
 * Where two of them claim the same ground at different heights, the loser is
 * drawn as a sheet hanging in the air: the brown beams, lines and slabs in the
 * mid-distance.
 *
 * This measures it WITHOUT trusting any height function: it buckets every drawn
 * vertex of every live chunk into a coarse XZ grid and reports the vertical
 * spread inside buckets that hold vertices from more than one chunk. A single
 * surface has a spread of centimetres (its own slope across the bucket); two
 * surfaces have tens of metres.
 *
 *   npx tsx tools/terrain-overlap.ts
 *
 * Nothing here is part of the game bundle.
 */

import type { BufferGeometry } from 'three';
import type { ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';

/** Same as chunks.ts VISUAL_RADIUS; kept local so the audit needs no export. */
const VISUAL_RADIUS = 6;
/** XZ bucket size, metres. Coarser than the near rings, finer than the far ones. */
const BUCKET = 25;
/** Height a bucket may disagree by, once the surface's own slope is allowed for. */
const SPREAD_LIMIT = 8;
/**
 * Height per metre of horizontal separation that a single continuous surface is allowed.
 * The steepest thing in the drawn world is the berm's face at 69% (tools/terrain-audit.ts),
 * so anything under that could be one surface and anything over it cannot.
 */
const SURFACE_SLOPE_ALLOWANCE = 0.7;

export interface OverlapReport {
  seed: number;
  cameraS: number;
  vertices: number;
  /** Buckets holding vertices from more than one chunk. */
  sharedBuckets: number;
  /** Of those, how many disagree vertically by more than SPREAD_LIMIT. */
  conflicts: number;
  worstSpreadM: number;
  worstAtLateralM: number;
  worstDistFromCameraM: number;
  /** Conflicts inside 600 m of the camera — the ones that fill the screen. */
  nearConflicts: number;
}

function fakeContext(chunkIndex: number, road: Road, terrain: Terrain): ChunkContext {
  return {
    chunkIndex,
    sStart: Math.max(0, chunkIndex * CHUNK_LENGTH),
    sEnd: Math.min(road.length, (chunkIndex + 1) * CHUNK_LENGTH),
    road,
    terrain,
    hasPhysics: false,
  } as unknown as ChunkContext;
}

export function overlapAt(seed: number, cameraS: number): OverlapReport {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const provider = new TerrainMeshProvider(new RoadDistance(road));
  interface Bucket {
    chunks: Set<number>;
    minY: number;
    maxY: number;
    x: number;
    z: number;
    verts: { c: number; x: number; y: number; z: number }[];
  }
  const centre = road.sampleAt(cameraS);
  const centreChunk = Math.floor(cameraS / CHUNK_LENGTH);
  const buckets = new Map<string, Bucket>();
  let vertices = 0;

  for (let c = centreChunk - VISUAL_RADIUS; c <= centreChunk + VISUAL_RADIUS; c++) {
    const content = provider.build(fakeContext(c, road, terrain));
    if (!content) continue;
    const mesh = content.group.children[0] as unknown as { geometry: BufferGeometry };
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    if (!idx) continue;
    const used = new Set<number>();
    for (let i = 0; i < idx.count; i++) used.add(idx.getX(i));

    for (const vi of used) {
      const x = pos.getX(vi);
      const y = pos.getY(vi);
      const z = pos.getZ(vi);
      vertices++;
      const key = `${Math.floor(x / BUCKET)}:${Math.floor(z / BUCKET)}`;
      const b = buckets.get(key);
      if (b) {
        b.chunks.add(c);
        b.minY = Math.min(b.minY, y);
        b.maxY = Math.max(b.maxY, y);
        b.verts.push({ c, x, y, z });
      } else {
        buckets.set(key, { chunks: new Set([c]), minY: y, maxY: y, x, z, verts: [{ c, x, y, z }] });
      }
    }
    content.dispose?.();
  }

  const report: OverlapReport = {
    seed,
    cameraS,
    vertices,
    sharedBuckets: 0,
    conflicts: 0,
    worstSpreadM: 0,
    worstAtLateralM: 0,
    worstDistFromCameraM: 0,
    nearConflicts: 0,
  };

  for (const b of buckets.values()) {
    if (b.chunks.size < 2) continue;
    report.sharedBuckets++;
    const spread = crossChunkResidual(b.verts);
    if (spread <= SPREAD_LIMIT) continue;
    report.conflicts++;
    const dist = Math.hypot(b.x - centre.x, b.z - centre.z);
    if (dist < 600) report.nearConflicts++;
    if (spread > report.worstSpreadM) {
      report.worstSpreadM = +spread.toFixed(1);
      report.worstAtLateralM = +Math.abs(road.project(b.x, b.z).lateral).toFixed(0);
      report.worstDistFromCameraM = +dist.toFixed(0);
    }
  }
  // Worst offender in detail: which chunks, which heights, and how far each vertex
  // really is from the road. Brute-force nearest s, because Road.project's coarse
  // sweep is not trustworthy for a point half a kilometre off a wandering road.
  let worst: Bucket | null = null;
  let worstResidual = 0;
  for (const b of buckets.values()) {
    if (b.chunks.size < 2) continue;
    const residual = crossChunkResidual(b.verts);
    if (!worst || residual > worstResidual) {
      worst = b;
      worstResidual = residual;
    }
  }
  if (worst && worstResidual > SPREAD_LIMIT) {
    const trueFrame = (x: number, z: number): { s: number; lateral: number } => {
      let bestS = 0;
      let bestD = Infinity;
      for (let s = Math.max(0, cameraS - 6000); s <= cameraS + 6000; s += 5) {
        const p = road.sampleAt(s);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          bestS = s;
        }
      }
      return { s: bestS, lateral: Math.sqrt(bestD) };
    };
    console.log(`  worst bucket at (${worst.x.toFixed(0)}, ${worst.z.toFixed(0)}), chunks ${[...worst.chunks].join(',')}`);
    for (const v of worst.verts.slice(0, 8)) {
      const f = trueFrame(v.x, v.z);
      console.log(
        `    chunk ${v.c} y ${v.y.toFixed(1)} — true nearest road s ${f.s.toFixed(0)} (chunk ${Math.floor(f.s / CHUNK_LENGTH)}), lateral ${f.lateral.toFixed(0)} m`,
      );
    }
  }
  return report;
}

/**
 * Worst genuine disagreement between two chunks over the same ground, metres.
 *
 * Not the bucket's vertical spread, which is what this measured first and which stopped
 * meaning anything the moment the world's edge became a 34-degree bank: a single continuous
 * surface at that gradient rises 17 m across a 25 m bucket, so every bucket on the berm
 * reported a conflict and the number the tool exists to produce became noise. The berm
 * buckets it flagged held vertices from two chunks agreeing to the decimetre at identical
 * XZ — there was nothing wrong with them at all.
 *
 * So it compares vertices from DIFFERENT chunks pairwise and subtracts the height the
 * surface is entitled to over the horizontal distance between them. What is left is the
 * part no slope explains, which is the part that draws as a sheet in the sky.
 */
function crossChunkResidual(verts: readonly { c: number; x: number; y: number; z: number }[]): number {
  let worst = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    for (let j = i + 1; j < verts.length; j++) {
      const b = verts[j]!;
      if (a.c === b.c) continue;
      const run = Math.hypot(a.x - b.x, a.z - b.z);
      const residual = Math.abs(a.y - b.y) - run * SURFACE_SLOPE_ALLOWANCE;
      if (residual > worst) worst = residual;
    }
  }
  return worst;
}

for (const seed of [1337, 42, 7]) {
  for (const s of [25000, 25400]) {
    const r = overlapAt(seed, s);
    console.log(
      `seed ${r.seed} @ ${r.cameraS} m: ${r.vertices} drawn verts, ${r.sharedBuckets} shared buckets, ` +
        `${r.conflicts} disagreeing by >8 m (worst ${r.worstSpreadM} m, ${r.worstDistFromCameraM} m from camera), ` +
        `${r.nearConflicts} of them inside 600 m`,
    );
  }
}
