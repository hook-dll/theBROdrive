import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { desertPaletteAt } from './gradient';
import { ROAD_MAX_HALF_WIDTH, type Road } from './road';
import type { RoadDistance } from './roaddistance';
import { CORRIDOR_OUTER, type Terrain } from './terrain';
import { terminusWeight } from './terminus';
import { laybyAsphaltCover, laybyNear } from './layby';


/** Side length of one absolute, deterministic desert tile. */
export const DESERT_TILE_SIZE = 240;
export const DESERT_TILE_CELLS = 80;
export const DESERT_TILE_VERTS = DESERT_TILE_CELLS + 1;
export const DESERT_TILE_STEP = DESERT_TILE_SIZE / DESERT_TILE_CELLS;

const DIST_LATTICE = 20;
const EXACT_DISTANCE_GATE = Math.max(CORRIDOR_OUTER, ROAD_MAX_HALF_WIDTH) + DIST_LATTICE * 2;
const FULL_RELIEF_DISTANCE = 200;
const PROP_TAG = 0x44535254;
/** How far the drawn ground sits under the road's asphalt at its edge, metres. */
const UNDER_ROAD_M = 0.1;
const MAX_TILE_PROPS = 5;

/**
 * The non-rendering inputs to an absolute tile build. The worker creates equivalent
 * instances from the seed and transferred road spine; the emergency path receives the
 * live instances. Keeping the loop here makes both paths byte-for-byte identical.
 */
export interface DesertTileGenerationContext {
  readonly seed: number;
  readonly road: Road;
  readonly terrain: Terrain;
  readonly roadDistance: RoadDistance;
  /**
   * Draw open desert at half the lattice (Very Low and Low, render/retro.ts). Heights,
   * normals and physics keep the full lattice; only the drawn triangles change.
   */
  readonly coarseAway?: boolean;
}

/**
 * Transferable result of one tile build. `propSurfaces[i]` is zero when candidate `i`
 * was rejected, otherwise the SurfaceType selected by Terrain.openSurfaceAt(). The
 * renderer resolves it to its live Three form without repeating road/grid/noise work.
 */
export interface DesertTileData {
  readonly heights: Float32Array;
  readonly positions: Float32Array;
  /** Fine relief removed by the tile shader as the vista takes over. */
  readonly detailOffsets: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  /** How much of `indices` is drawn; less than its length when drawn coarse. */
  readonly indexCount: number;
  readonly propSurfaces: Uint8Array;
}


export interface GroundHeightSample {
  height: number;
  detail: number;
}

/**
 * The exact drawn/collided ground height at a point. Exported because the lake surface
 * (render/lakewater.ts) has to bake its shoreline against the SAME height the tile
 * lattice will draw, not against a second opinion assembled from `Terrain` directly:
 * the corridor transition and the under-road offset below are part of that height, and
 * a shoreline cut a few centimetres off the sand is a visible seam.
 */
export function sampleGroundHeight(
  context: DesertTileGenerationContext,
  x: number,
  z: number,
  farFromRoad: boolean,
  out: GroundHeightSample,
  /**
   * An arclength NEAR this point, for the far-from-road path only.
   *
   * NO OWNER LOOKUP OUT HERE: paying `roadDistance.ownerAt` per sample measured
   * 17.8 ms in a single lake-search slice against a 3 ms budget. It is not needed for
   * the corridor either — every fade that starts at the asphalt edge is saturated at
   * this distance. It IS needed to find a lake basin (world/lakes.ts), which is
   * scheduled by arclength, so the caller passes the one it already has: a tile its
   * own nearest road branch, the water's own search the site it is searching.
   */
  hintS = 0,
): void {
  if (farFromRoad) {
    const detail = context.terrain.explorationDetailAt(x, z, FULL_RELIEF_DISTANCE, hintS);
    out.height = context.terrain.openBase(x, z, FULL_RELIEF_DISTANCE, hintS) + detail;
    out.detail = detail;
    return;
  }
  const approximate = context.roadDistance.distAt(x, z, DIST_LATTICE);
  if (approximate >= EXACT_DISTANCE_GATE) {
    const s = context.roadDistance.ownerAt(x, z, DIST_LATTICE);
    const detail = context.terrain.explorationDetailAt(x, z, approximate, s);
    out.height = context.terrain.openBase(x, z, approximate, s) + detail;
    out.detail = detail;
    return;
  }

  const hint = context.roadDistance.ownerAt(x, z, DIST_LATTICE);
  const projection = context.road.project(x, z, hint);
  const dist = Math.abs(projection.lateral);
  const detail = context.terrain.explorationDetailAt(x, z, projection.lateral, projection.s);
  const halfWidth = context.road.halfWidthAt(projection.s);
  const transitionInput = (dist - halfWidth) / (CORRIDOR_OUTER - halfWidth);
  const transition =
    transitionInput < 0 ? 0 : transitionInput > 1 ? 1 : transitionInput;
  // The road ribbon owns the contact surface in the corridor. This small offset avoids
  // z-fighting while the fade leaves no ledge at the edge of the graded verge.
  let underRoad = UNDER_ROAD_M * (1 - transition * transition * (3 - 2 * transition));
  // A lay-by's pad (world/laybymesh.ts) lies on the levelled ground out where the fade
  // has almost gone, so the ground under it and just round it takes the full offset.
  const layby = laybyNear(context.seed, projection.s);
  if (layby) {
    underRoad = Math.max(
      underRoad,
      UNDER_ROAD_M * laybyAsphaltCover(layby, projection.s, projection.lateral, halfWidth),
    );
  }
  out.height = context.terrain.baseFromFrame(x, z, projection.lateral, projection.s) + detail - underRoad;
  // `detail` carries the corridor landform (world/corridorshape.ts) as well as the
  // fine band, because everything that draws the corridor has to get it. What the
  // shader is allowed to fade out past DESERT_TILE_FADE_FULL is the SMALL-SCALE half
  // of that: fading a five-metre embankment away would lift the far tile surface
  // above the trough the near terrain mesh is drawing, and the tile would sink
  // through it as the player closed. Landform stays in the height and out of here.
  out.detail = detail - context.terrain.corridorShapeAt(x, z, dist, projection.s);
}

/** Every lattice cell as two triangles. Returns the index count. */
function writeFullIndices(indices: Uint32Array): number {
  let io = 0;
  for (let ix = 0; ix < DESERT_TILE_CELLS; ix++) {
    for (let iz = 0; iz < DESERT_TILE_CELLS; iz++) {
      const a = ix * DESERT_TILE_VERTS + iz;
      const b = (ix + 1) * DESERT_TILE_VERTS + iz;
      const c = a + 1;
      const d = b + 1;
      indices[io++] = a;
      indices[io++] = c;
      indices[io++] = b;
      indices[io++] = b;
      indices[io++] = c;
      indices[io++] = d;
    }
  }
  return io;
}

/**
 * Open desert beyond this distance from the road, metres, is drawn at half the lattice.
 * The corridor landform and the under-road offset end at `CORRIDOR_OUTER`; the rest is
 * the lattice's own error in `distAt` and half a block's diagonal, so no block that
 * shapes the verge is ever coarsened.
 */
const COARSE_CLEAR_M = EXACT_DISTANCE_GATE + DESERT_TILE_STEP * 1.5;
const BLOCKS = DESERT_TILE_CELLS / 2;

/**
 * Very Low's and Low's terrain: 2x2 cells merged into one block wherever the block is clear
 * of the road, a quarter of the triangles over open sand.
 *
 * WITHOUT A CRACK. A coarse block's side skips the lattice vertex in its middle, and a
 * neighbour that draws that vertex — a full-resolution block beside it, or whatever the
 * next tile decides — would leave a T-junction the sky shows through. So a coarse block
 * keeps the middle vertex on every side that borders a fine block or the tile's edge,
 * as a fan round its own centre; coarse against coarse shares the plain edge. The
 * winding matches the full lattice's.
 */
function writeCoarseIndices(
  context: DesertTileGenerationContext,
  indices: Uint32Array,
  startX: number,
  startZ: number,
  farFromRoad: boolean,
): number {
  const fine = new Uint8Array(BLOCKS * BLOCKS);
  if (!farFromRoad) {
    const blockSize = DESERT_TILE_STEP * 2;
    for (let bx = 0; bx < BLOCKS; bx++) {
      for (let bz = 0; bz < BLOCKS; bz++) {
        const x = startX + (bx + 0.5) * blockSize;
        const z = startZ + (bz + 0.5) * blockSize;
        fine[bx * BLOCKS + bz] = context.roadDistance.distAt(x, z, DIST_LATTICE) < COARSE_CLEAR_M ? 1 : 0;
      }
    }
  }
  const coarseAt = (bx: number, bz: number): boolean =>
    bx >= 0 && bz >= 0 && bx < BLOCKS && bz < BLOCKS && fine[bx * BLOCKS + bz] === 0;
  const vertex = (ix: number, iz: number): number => ix * DESERT_TILE_VERTS + iz;
  let io = 0;
  const ring: number[] = [];
  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      const ix = bx * 2;
      const iz = bz * 2;
      if (fine[bx * BLOCKS + bz] === 1) {
        for (let cx = ix; cx < ix + 2; cx++) {
          for (let cz = iz; cz < iz + 2; cz++) {
            const a = vertex(cx, cz);
            const b = vertex(cx + 1, cz);
            indices[io++] = a;
            indices[io++] = a + 1;
            indices[io++] = b;
            indices[io++] = b;
            indices[io++] = a + 1;
            indices[io++] = b + 1;
          }
        }
        continue;
      }
      const splitLowX = !coarseAt(bx - 1, bz);
      const splitHighZ = !coarseAt(bx, bz + 1);
      const splitHighX = !coarseAt(bx + 1, bz);
      const splitLowZ = !coarseAt(bx, bz - 1);
      const A = vertex(ix, iz);
      const B = vertex(ix + 2, iz);
      const C = vertex(ix, iz + 2);
      const D = vertex(ix + 2, iz + 2);
      if (!splitLowX && !splitHighZ && !splitHighX && !splitLowZ) {
        indices[io++] = A;
        indices[io++] = C;
        indices[io++] = B;
        indices[io++] = B;
        indices[io++] = C;
        indices[io++] = D;
        continue;
      }
      // Round the block A -> C -> D -> B, which is the full lattice's winding seen from
      // the centre, with each split side's middle vertex in its place.
      ring.length = 0;
      ring.push(A);
      if (splitLowX) ring.push(vertex(ix, iz + 1));
      ring.push(C);
      if (splitHighZ) ring.push(vertex(ix + 1, iz + 2));
      ring.push(D);
      if (splitHighX) ring.push(vertex(ix + 2, iz + 1));
      ring.push(B);
      if (splitLowZ) ring.push(vertex(ix + 1, iz));
      const M = vertex(ix + 1, iz + 1);
      for (let i = 0; i < ring.length; i++) {
        indices[io++] = M;
        indices[io++] = ring[i]!;
        indices[io++] = ring[(i + 1) % ring.length]!;
      }
    }
  }
  return io;
}

/**
 * Reuses `existing` when it is exactly the right length, otherwise allocates.
 *
 * Every tile shares one lattice, so in practice a recycled set always fits and a
 * steady-state drive allocates no tile buffers at all. The length check is what
 * makes that safe rather than assumed: a mismatched buffer is dropped, never
 * partially filled.
 */
function fit<T extends Float32Array | Uint32Array | Uint8Array>(
  existing: T | undefined,
  length: number,
  Kind: { new (length: number): T },
): T {
  return existing !== undefined && existing.length === length ? existing : new Kind(length);
}

/**
 * Generates all terrain/noise/grid-derived data for one tile without touching a scene.
 *
 * `into` is an optional set of buffers reclaimed from a tile that has already been
 * torn down. Tile buffers are the largest thing this system churns — roughly 440 KB per
 * tile, five tiles per row crossing — and recycling them is what keeps the
 * allocator from turning a boundary crossing into a collection pause. Every element
 * below is written before it is read, and `propSurfaces` is cleared explicitly
 * because only the accepted candidates assign into it.
 */
export function generateDesertTileData(
  context: DesertTileGenerationContext,
  tx: number,
  tz: number,
  farFromRoad: boolean,
  into?: DesertTileData | null,
): DesertTileData {
  const centreX = (tx + 0.5) * DESERT_TILE_SIZE;
  const centreZ = (tz + 0.5) * DESERT_TILE_SIZE;
  const startX = tx * DESERT_TILE_SIZE;
  const startZ = tz * DESERT_TILE_SIZE;
  const vertexCount = DESERT_TILE_VERTS * DESERT_TILE_VERTS;
  const heights = fit(into?.heights, vertexCount, Float32Array);
  const positions = fit(into?.positions, vertexCount * 3, Float32Array);
  const detailOffsets = fit(into?.detailOffsets, vertexCount, Float32Array);
  const normals = fit(into?.normals, vertexCount * 3, Float32Array);
  const colors = fit(into?.colors, vertexCount * 3, Float32Array);
  const ground = { height: 0, detail: 0 };
  const paletteDistance = farFromRoad
    ? Math.abs(centreZ)
    : context.roadDistance.ownerAt(centreX, centreZ, DIST_LATTICE);
  const palette = new THREE.Color(desertPaletteAt(paletteDistance).sand);
  // One lattice node for the whole tile: the far path needs an arclength only to find
  // a lake basin, and a basin is 860 m across, so the tile's own nearest branch is
  // exact enough. See `sampleGroundHeight`.
  const tileHintS = farFromRoad
    ? context.roadDistance.ownerAt(centreX, centreZ, DIST_LATTICE)
    : 0;
  for (let ix = 0; ix < DESERT_TILE_VERTS; ix++) {
    const worldX = startX + ix * DESERT_TILE_STEP;
    for (let iz = 0; iz < DESERT_TILE_VERTS; iz++) {
      const worldZ = startZ + iz * DESERT_TILE_STEP;
      const vi = ix * DESERT_TILE_VERTS + iz;
      sampleGroundHeight(context, worldX, worldZ, farFromRoad, ground, tileHintS);
      const y = ground.height;
      heights[vi] = y;
      detailOffsets[vi] = ground.detail;
      positions[vi * 3] = worldX - centreX;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = worldZ - centreZ;
      colors[vi * 3] = palette.r;
      colors[vi * 3 + 1] = palette.g;
      colors[vi * 3 + 2] = palette.b;
    }
  }

  for (let ix = 0; ix < DESERT_TILE_VERTS; ix++) {
    const x0 = Math.max(0, ix - 1);
    const x1 = Math.min(DESERT_TILE_CELLS, ix + 1);
    for (let iz = 0; iz < DESERT_TILE_VERTS; iz++) {
      const z0 = Math.max(0, iz - 1);
      const z1 = Math.min(DESERT_TILE_CELLS, iz + 1);
      const dhx =
        (heights[x1 * DESERT_TILE_VERTS + iz]! - heights[x0 * DESERT_TILE_VERTS + iz]!) /
        ((x1 - x0) * DESERT_TILE_STEP);
      const dhz =
        (heights[ix * DESERT_TILE_VERTS + z1]! - heights[ix * DESERT_TILE_VERTS + z0]!) /
        ((z1 - z0) * DESERT_TILE_STEP);
      const length = Math.hypot(dhx, 1, dhz);
      const ni = (ix * DESERT_TILE_VERTS + iz) * 3;
      normals[ni] = -dhx / length;
      normals[ni + 1] = 1 / length;
      normals[ni + 2] = -dhz / length;
    }
  }

  const indices = fit(into?.indices, DESERT_TILE_CELLS * DESERT_TILE_CELLS * 6, Uint32Array);
  const indexCount = context.coarseAway
    ? writeCoarseIndices(context, indices, startX, startZ, farFromRoad)
    : writeFullIndices(indices);

  const propSurfaces = fit(into?.propSurfaces, MAX_TILE_PROPS, Uint8Array);
  propSurfaces.fill(0);
  const requested = 2 + Math.floor(hash01(context.seed, PROP_TAG, tx, tz) * 4);
  for (let i = 0; i < requested; i++) {
    const localX = (0.08 + hash01(context.seed, PROP_TAG, tx, tz, i, 1) * 0.84) * DESERT_TILE_SIZE;
    const localZ = (0.08 + hash01(context.seed, PROP_TAG, tx, tz, i, 2) * 0.84) * DESERT_TILE_SIZE;
    const worldX = startX + localX;
    const worldZ = startZ + localZ;
    if (terminusWeight(worldX, worldZ) > 0) continue;
    // Roadside scatter owns the corridor. Once this tile is definitely far away, do
    // not ask the whole-road grid at all.
    if (!farFromRoad && context.roadDistance.distAt(worldX, worldZ, DIST_LATTICE) < 65) continue;
    propSurfaces[i] = context.terrain.openSurfaceAt(worldX, worldZ);
  }

  return { heights, positions, detailOffsets, normals, colors, indices, indexCount, propSurfaces };
}

/** The ground as the tiles draw it at one point: see `tileGroundSampler`. */
export interface DrawnGroundSample {
  height: number;
  /** The fine relief the tile shader lowers the ground by as the vista takes over. */
  detail: number;
  /** The tile's own interpolated vertex normal. */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * The ground AS THE TILES DRAW IT, anywhere near the road: their lattice nodes sampled
 * exactly as `generateDesertTileData` samples them, the same two triangles per cell
 * (split on the b-c diagonal, as its index buffer writes them), and the same central-
 * difference node normals, interpolated the way the GPU interpolates them. Between
 * nodes the drawn ground is a plane, centimetres to decimetres off the terrain
 * function, so anything laid ON the ground (the road shoulder) must ask this rather
 * than the function. Nodes are memoised for the sampler's life: make one per build.
 */
export function tileGroundSampler(
  context: DesertTileGenerationContext,
): (x: number, z: number, out: DrawnGroundSample) => void {
  const heights = new Map<number, number>();
  const details = new Map<number, number>();
  const sample: GroundHeightSample = { height: 0, detail: 0 };
  const key = (i: number, j: number): number => i * 1_000_003 + j;
  const height = (i: number, j: number): number => {
    const k = key(i, j);
    let h = heights.get(k);
    if (h === undefined) {
      sampleGroundHeight(context, i * DESERT_TILE_STEP, j * DESERT_TILE_STEP, false, sample);
      h = sample.height;
      heights.set(k, h);
      details.set(k, sample.detail);
    }
    return h;
  };
  const detail = (i: number, j: number): number => {
    height(i, j);
    return details.get(key(i, j))!;
  };
  // One node's normal, as generateDesertTileData writes it (a tile's own border nodes
  // use a one-sided difference there; interior nodes, which the road almost always
  // meets, are central).
  const normal = { x: 0, y: 0, z: 0 };
  const nodeNormal = (i: number, j: number): void => {
    const dhx = (height(i + 1, j) - height(i - 1, j)) / (2 * DESERT_TILE_STEP);
    const dhz = (height(i, j + 1) - height(i, j - 1)) / (2 * DESERT_TILE_STEP);
    const length = Math.hypot(dhx, 1, dhz);
    normal.x = -dhx / length;
    normal.y = 1 / length;
    normal.z = -dhz / length;
  };
  return (x, z, out) => {
    const fx = x / DESERT_TILE_STEP;
    const fz = z / DESERT_TILE_STEP;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    // Barycentric weights over the cell's triangle: (a, b, c) or (d, c, b).
    const lower = u + v <= 1;
    const i0 = lower ? i : i + 1;
    const j0 = lower ? j : j + 1;
    const w0 = lower ? 1 - u - v : u + v - 1;
    const wb = lower ? u : 1 - v;
    const wc = lower ? v : 1 - u;
    out.height = height(i0, j0) * w0 + height(i + 1, j) * wb + height(i, j + 1) * wc;
    out.detail = detail(i0, j0) * w0 + detail(i + 1, j) * wb + detail(i, j + 1) * wc;
    nodeNormal(i0, j0);
    let nx = normal.x * w0;
    let ny = normal.y * w0;
    let nz = normal.z * w0;
    nodeNormal(i + 1, j);
    nx += normal.x * wb;
    ny += normal.y * wb;
    nz += normal.z * wb;
    nodeNormal(i, j + 1);
    nx += normal.x * wc;
    ny += normal.y * wc;
    nz += normal.z * wc;
    const length = Math.hypot(nx, ny, nz);
    out.nx = nx / length;
    out.ny = ny / length;
    out.nz = nz / length;
  };
}

/** Buffers are moved from the worker; the main thread builds BufferAttributes over them. */
export function desertTileDataTransfers(data: DesertTileData): Transferable[] {
  return [
    data.heights.buffer as ArrayBuffer,
    data.positions.buffer as ArrayBuffer,
    data.detailOffsets.buffer as ArrayBuffer,
    data.normals.buffer as ArrayBuffer,
    data.colors.buffer as ArrayBuffer,
    data.indices.buffer as ArrayBuffer,
    data.propSurfaces.buffer as ArrayBuffer,
  ];
}
