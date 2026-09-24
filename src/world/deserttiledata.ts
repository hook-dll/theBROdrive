import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { CoverKind, Crop, newCoverSample, type CoverSample } from './landcover';
import { canopyHeight } from './vistaground';
import { ROAD_MAX_HALF_WIDTH, type Road } from './road';
import type { RoadDistance } from './roaddistance';
import { CORRIDOR_OUTER, type Terrain } from './terrain';
import { terminusWeight } from './terminus';


/** Side length of one absolute, deterministic desert tile. */
export const DESERT_TILE_SIZE = 240;
export const DESERT_TILE_CELLS = 80;
export const DESERT_TILE_VERTS = DESERT_TILE_CELLS + 1;
export const DESERT_TILE_STEP = DESERT_TILE_SIZE / DESERT_TILE_CELLS;

const DIST_LATTICE = 20;
const EXACT_DISTANCE_GATE = Math.max(CORRIDOR_OUTER, ROAD_MAX_HALF_WIDTH) + DIST_LATTICE * 2;
const FULL_RELIEF_DISTANCE = 200;
const PROP_TAG = 0x44535254;
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
  readonly propSurfaces: Uint8Array;
  /**
   * Canopy blanket per vertex: linear rgb of the crowns, then their height over the
   * ground (world/vistaground.ts). The tile shader raises it past `CANOPY_FROM_M`.
   */
  readonly canopy: Float32Array;
  /** `treeCount` trees of `TREE_STRIDE` floats each: see `TreeField`. */
  readonly trees: Float32Array;
  readonly treeCount: number;
}

/** Kinds of planted thing, stored as a float in a tree record. */
export const enum TreeKind {
  Birch = 0,
  Spruce = 1,
  Bush = 2,
}

/**
 * One tree record: local x, ground y, local z, scale, yaw, kind, tint. Local x/z are
 * relative to the tile centre, like the tile's own positions.
 */
export const TREE_STRIDE = 7;
/** Candidate spacing in a wood, metres. One candidate per cell, jittered. */
const TREE_CELL = 6.5;
const TREE_CELLS = Math.floor(DESERT_TILE_SIZE / TREE_CELL);
/** A candidate can yield one tree and one bush. */
export const MAX_TILE_TREES = TREE_CELLS * TREE_CELLS * 2;
const TREE_TAG = 0x54524545;
/** Nothing is planted closer than this to the road's centreline: verge and ditch. */
const TREE_ROAD_KEEP = 9.5;
/** Past the asphalt edge: the verge and the ditch stay clear whatever the road's width. */
const TREE_VERGE_KEEP = 5.5;
/** Below this lattice distance a candidate's distance is measured exactly. */
const TREE_EXACT_GATE = TREE_ROAD_KEEP + DIST_LATTICE * 1.5;


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
  const detail = context.terrain.explorationDetailAt(x, z, dist, projection.s);
  const halfWidth = context.road.halfWidthAt(projection.s);
  const transitionInput = (dist - halfWidth) / (CORRIDOR_OUTER - halfWidth);
  const transition =
    transitionInput < 0 ? 0 : transitionInput > 1 ? 1 : transitionInput;
  // The road ribbon owns the contact surface in the corridor. This small offset avoids
  // z-fighting while the fade leaves no ledge at the edge of the graded verge.
  const underRoad = 0.1 * (1 - transition * transition * (3 - 2 * transition));
  out.height = context.terrain.baseFromFrame(x, z, projection.lateral, projection.s) + detail - underRoad;
  // `detail` carries the corridor landform (world/corridorshape.ts) as well as the
  // fine band, because everything that draws the corridor has to get it. What the
  // shader is allowed to fade out past DESERT_TILE_FADE_FULL is the SMALL-SCALE half
  // of that: fading a five-metre embankment away would lift the far tile surface
  // above the trough the near terrain mesh is drawing, and the tile would sink
  // through it as the player closed. Landform stays in the height and out of here.
  out.detail = detail - context.terrain.corridorShapeAt(x, z, dist, projection.s);
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
  const canopy = fit(into?.canopy, vertexCount * 4, Float32Array);
  const ground = { height: 0, detail: 0 };
  const paletteDistance = farFromRoad
    ? Math.abs(centreZ)
    : context.roadDistance.ownerAt(centreX, centreZ, DIST_LATTICE);
  void paletteDistance;
  const cover = context.terrain.cover;
  const coverSample = newCoverSample();
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
      // Ground colour is the land cover's. The road distance is the shared lattice
      // interpolation: a colour needs to be right to a metre, not to a centimetre.
      const roadDist = farFromRoad ? 1e6 : context.roadDistance.distAt(worldX, worldZ, DIST_LATTICE);
      cover.sample(worldX, worldZ, roadDist, coverSample);
      colors[vi * 3] = coverSample.r;
      colors[vi * 3 + 1] = coverSample.g;
      colors[vi * 3 + 2] = coverSample.b;
      if (coverSample.forest > 0) {
        cover.canopyColour(worldX, worldZ, coverSample.birch, canopy, vi * 4);
        canopy[vi * 4 + 3] = canopyHeight(worldX, worldZ, coverSample.forest, coverSample.birch);
      } else {
        canopy[vi * 4] = coverSample.r;
        canopy[vi * 4 + 1] = coverSample.g;
        canopy[vi * 4 + 2] = coverSample.b;
        canopy[vi * 4 + 3] = 0;
      }
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
    // Countryside: the desert's lone cacti and boulders are gone, and what stands
    // on open ground is planted by `plantTrees` instead.
    void worldX;
    void worldZ;
  }

  const trees = fit(into?.trees, MAX_TILE_TREES * TREE_STRIDE, Float32Array);
  const treeCount = plantTrees(context, tx, tz, farFromRoad, heights, trees, coverSample);

  return { heights, positions, detailOffsets, normals, colors, indices, propSurfaces, canopy, trees, treeCount };
}

/**
 * Plants the tile's trees into `out` and returns how many.
 *
 * A jittered candidate per `TREE_CELL`, kept with probability equal to the wood's
 * density there, so a wood's edge thins out on its own rather than stopping at a line.
 * What is not a tree may be a bush: undergrowth along a wood's edge, willow scrub in
 * the roadside ditch, a lone birch in a meadow, a young birch in a field nobody
 * ploughs any more — the one sight that says "Russian back country" before anything
 * else does.
 */
function plantTrees(
  context: DesertTileGenerationContext,
  tx: number,
  tz: number,
  farFromRoad: boolean,
  heights: Float32Array,
  out: Float32Array,
  cover: CoverSample,
): number {
  const startX = tx * DESERT_TILE_SIZE;
  const startZ = tz * DESERT_TILE_SIZE;
  const centreX = startX + DESERT_TILE_SIZE * 0.5;
  const centreZ = startZ + DESERT_TILE_SIZE * 0.5;
  const land = context.terrain.cover;
  const seed = context.seed;
  let n = 0;
  const put = (x: number, z: number, kind: TreeKind, scale: number, key: number): void => {
    const lx = x - startX;
    const lz = z - startZ;
    const o = n * TREE_STRIDE;
    out[o] = x - centreX;
    out[o + 1] = tileHeightAt(heights, lx, lz);
    out[o + 2] = z - centreZ;
    out[o + 3] = scale;
    out[o + 4] = hash01(seed, TREE_TAG, key, 5) * Math.PI * 2;
    out[o + 5] = kind;
    out[o + 6] = 0.84 + hash01(seed, TREE_TAG, key, 6) * 0.32;
    n++;
  };
  for (let ci = 0; ci < TREE_CELLS; ci++) {
    for (let cj = 0; cj < TREE_CELLS; cj++) {
      const gx = tx * TREE_CELLS + ci;
      const gz = tz * TREE_CELLS + cj;
      const key = (gx * 73856093) ^ (gz * 19349663);
      const x = startX + (ci + 0.1 + hash01(seed, TREE_TAG, gx, gz, 1) * 0.8) * TREE_CELL;
      const z = startZ + (cj + 0.1 + hash01(seed, TREE_TAG, gx, gz, 2) * 0.8) * TREE_CELL;
      if (terminusWeight(x, z) > 0) continue;
      let roadDist = farFromRoad ? 1e6 : context.roadDistance.distAt(x, z, DIST_LATTICE);
      // The lattice distance is only good to about its own spacing, and a bush 4 m out
      // stands on the carriageway. Near the road, ask the road itself.
      if (roadDist < TREE_EXACT_GATE) {
        const p = context.road.project(x, z, context.roadDistance.ownerAt(x, z, DIST_LATTICE));
        roadDist = Math.abs(p.lateral);
        if (roadDist < context.road.halfWidthAt(p.s) + TREE_VERGE_KEEP) continue;
      }
      if (roadDist < TREE_ROAD_KEEP) continue;
      const forest = land.forestAt(x, z, roadDist);
      const r = hash01(seed, TREE_TAG, gx, gz, 3);
      const r2 = hash01(seed, TREE_TAG, gx, gz, 4);
      if (r < forest * 0.93) {
        const birch = land.birchAt(x, z);
        const kind = r2 < birch * 0.9 + 0.05 ? TreeKind.Birch : TreeKind.Spruce;
        // Edge trees are younger and shorter; the interior is a mature stand.
        put(x, z, kind, (0.62 + 0.5 * hash01(seed, TREE_TAG, gx, gz, 7)) * (0.7 + 0.3 * forest), key);
        continue;
      }
      if (forest > 0.02 && forest < 0.75 && r2 < 0.4) {
        put(x, z, TreeKind.Bush, 0.7 + 0.6 * hash01(seed, TREE_TAG, gx, gz, 7), key);
        continue;
      }
      if (roadDist < 20 && r2 < 0.07) {
        put(x, z, TreeKind.Bush, 0.6 + 0.5 * hash01(seed, TREE_TAG, gx, gz, 7), key);
        continue;
      }
      if (forest === 0 && r2 < 0.05) {
        land.sample(x, z, roadDist, cover);
        if (cover.crop === Crop.Fallow && r2 < 0.045) {
          put(x, z, TreeKind.Birch, 0.3 + 0.3 * hash01(seed, TREE_TAG, gx, gz, 7), key);
        } else if (cover.kind === CoverKind.Meadow && r2 < 0.0035) {
          put(x, z, TreeKind.Birch, 0.85 + 0.35 * hash01(seed, TREE_TAG, gx, gz, 7), key);
        } else if (cover.kind === CoverKind.Meadow && r2 < 0.012) {
          put(x, z, TreeKind.Bush, 0.8 + 0.5 * hash01(seed, TREE_TAG, gx, gz, 7), key);
        }
      }
    }
  }
  return n;
}

/** Bilinear height on the tile's regular lattice, local metres from its corner. */
function tileHeightAt(heights: Float32Array, localX: number, localZ: number): number {
  const fx = Math.min(DESERT_TILE_CELLS, Math.max(0, localX / DESERT_TILE_STEP));
  const fz = Math.min(DESERT_TILE_CELLS, Math.max(0, localZ / DESERT_TILE_STEP));
  const ix = Math.min(DESERT_TILE_CELLS - 1, Math.floor(fx));
  const iz = Math.min(DESERT_TILE_CELLS - 1, Math.floor(fz));
  const u = fx - ix;
  const v = fz - iz;
  const a = heights[ix * DESERT_TILE_VERTS + iz]!;
  const b = heights[(ix + 1) * DESERT_TILE_VERTS + iz]!;
  const c = heights[ix * DESERT_TILE_VERTS + iz + 1]!;
  const d = heights[(ix + 1) * DESERT_TILE_VERTS + iz + 1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
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
    data.canopy.buffer as ArrayBuffer,
    data.trees.buffer as ArrayBuffer,
  ];
}
