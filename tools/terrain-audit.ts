/**
 * tools/terrain-audit.ts
 *
 * Geometry audit for the streamed desert. It builds the REAL terrain chunks
 * (`TerrainMeshProvider`, no re-implementation) for a seed and reports every
 * triangle that cannot be ground:
 *
 *   inverted   XZ winding opposite the grid's own convention — a folded quad,
 *              which draws as a sheet standing across the view
 *   sliver     aspect ratio past `ASPECT_LIMIT` — the brown beams and lines
 *   giant      an edge longer than `EDGE_LIMIT` metres, i.e. a triangle that
 *              spans a sizeable fraction of the visible world
 *
 * Node-only; Rapier is never touched because colliders are skipped.
 *
 *   npx tsx tools/terrain-audit.ts
 *
 * Nothing here is part of the game bundle.
 */

import type { BufferGeometry } from 'three';
import type { ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';

/** Longest / shortest edge past which a triangle is a sliver, not terrain. */
const ASPECT_LIMIT = 40;
/** Edge length (m) past which a triangle spans the world rather than sitting in it. */
const EDGE_LIMIT = 900;

export interface BadTriangle {
  chunkIndex: number;
  kind: 'inverted' | 'sliver' | 'giant';
  aspect: number;
  longestEdgeM: number;
  /** Triangle centroid, world XZ, and its height. */
  x: number;
  z: number;
  y: number;
  /** Lateral distance of the centroid from the road centreline, metres. */
  lateralM: number;
}

export interface AuditResult {
  seed: number;
  chunks: number;
  triangles: number;
  inverted: number;
  slivers: number;
  giants: number;
  worst: BadTriangle[];
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

export function auditTerrain(seed: number, fromChunk: number, toChunk: number): AuditResult {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const provider = new TerrainMeshProvider();

  let triangles = 0;
  let inverted = 0;
  let slivers = 0;
  let giants = 0;
  const worst: BadTriangle[] = [];

  for (let chunkIndex = fromChunk; chunkIndex <= toChunk; chunkIndex++) {
    const content = provider.build(fakeContext(chunkIndex, road, terrain));
    if (!content) continue;
    const mesh = content.group.children[0] as unknown as { geometry: BufferGeometry };
    const geometry = mesh.geometry;
    const pos = geometry.getAttribute('position');
    const idx = geometry.getIndex();
    if (!idx) continue;
    // The grid emits every triangle with the same intended winding, so the
    // majority sign IS the convention; anything against it is folded.
    const signs: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const ax = pos.getX(a);
      const az = pos.getZ(a);
      const cross =
        (pos.getX(b) - ax) * (pos.getZ(c) - az) - (pos.getZ(b) - az) * (pos.getX(c) - ax);
      signs.push(Math.sign(cross));
    }
    let plus = 0;
    for (const s of signs) if (s > 0) plus++;
    const convention = plus * 2 >= signs.length ? 1 : -1;

    for (let t = 0, k = 0; t < idx.count; t += 3, k++) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const px = [pos.getX(a), pos.getX(b), pos.getX(c)];
      const py = [pos.getY(a), pos.getY(b), pos.getY(c)];
      const pz = [pos.getZ(a), pos.getZ(b), pos.getZ(c)];
      const e = [
        Math.hypot(px[1]! - px[0]!, pz[1]! - pz[0]!),
        Math.hypot(px[2]! - px[1]!, pz[2]! - pz[1]!),
        Math.hypot(px[0]! - px[2]!, pz[0]! - pz[2]!),
      ];
      const longest = Math.max(...e);
      const shortest = Math.max(1e-6, Math.min(...e));
      const aspect = longest / shortest;

      let kind: BadTriangle['kind'] | null = null;
      if (signs[k] !== 0 && signs[k] !== convention) kind = 'inverted';
      else if (longest > EDGE_LIMIT) kind = 'giant';
      else if (aspect > ASPECT_LIMIT) kind = 'sliver';
      if (!kind) {
        triangles++;
        continue;
      }

      if (kind === 'inverted') inverted++;
      else if (kind === 'giant') giants++;
      else slivers++;
      triangles++;

      const cx = (px[0]! + px[1]! + px[2]!) / 3;
      const cz = (pz[0]! + pz[1]! + pz[2]!) / 3;
      const cy = (py[0]! + py[1]! + py[2]!) / 3;
      worst.push({
        chunkIndex,
        kind,
        aspect: +aspect.toFixed(1),
        longestEdgeM: +longest.toFixed(1),
        x: +cx.toFixed(1),
        z: +cz.toFixed(1),
        y: +cy.toFixed(1),
        lateralM: +Math.abs(road.project(cx, cz, chunkIndex * CHUNK_LENGTH).lateral).toFixed(0),
      });
    }
    content.dispose?.();
  }

  worst.sort((p, q) => q.longestEdgeM - p.longestEdgeM);
  return { seed, chunks: toChunk - fromChunk + 1, triangles, inverted, slivers, giants, worst: worst.slice(0, 12) };
}

const seeds = [1337, 42, 7, 90210];
for (const seed of seeds) {
  const r = auditTerrain(seed, 120, 145);
  console.log(
    `seed ${seed}: ${r.triangles} tris over ${r.chunks} chunks -> inverted ${r.inverted}, slivers ${r.slivers}, giants ${r.giants}`,
  );
  for (const w of r.worst.slice(0, 6)) {
    console.log(
      `   ${w.kind} chunk ${w.chunkIndex} aspect ${w.aspect} longest ${w.longestEdgeM} m at lateral ${w.lateralM} m, y ${w.y}`,
    );
  }
}
