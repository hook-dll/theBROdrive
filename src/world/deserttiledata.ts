import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { CoverKind, Crop, MUD, newCoverSample, type CoverSample } from './landcover';
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

/**
 * Kinds of planted thing, stored as a float in a tree record. The trees of the central
 * Russian belt: what grows where is `plantTrees`' business, how each looks is
 * world/props/trees.ts'.
 */
export const enum TreeKind {
  Birch = 0,
  Spruce = 1,
  /** Hazel and willow scrub. */
  Bush = 2,
  Lime = 3,
  Pine = 4,
  Aspen = 5,
  Oak = 6,
  Maple = 7,
  Alder = 8,
  Willow = 9,
  Rowan = 10,
}

/** Every kind, in enum order: the index of per-kind tables. */
export const TREE_KINDS: readonly TreeKind[] = [
  TreeKind.Birch,
  TreeKind.Spruce,
  TreeKind.Bush,
  TreeKind.Lime,
  TreeKind.Pine,
  TreeKind.Aspen,
  TreeKind.Oak,
  TreeKind.Maple,
  TreeKind.Alder,
  TreeKind.Willow,
  TreeKind.Rowan,
];

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
      // Wet ground darkens toward mud, fully where it is mud underfoot.
      const wet = roadDist < 7 ? 0 : context.terrain.wetnessAt(worldX, worldZ);
      if (wet > 0) {
        const m = Math.min(1, wet * 1.4) * 0.85;
        coverSample.r += (MUD[0] - coverSample.r) * m;
        coverSample.g += (MUD[1] - coverSample.g) * m;
        coverSample.b += (MUD[2] - coverSample.b) * m;
      }
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
  const treeCount = plantTrees(
    context,
    tx,
    tz,
    (localX, localZ) => tileHeightAt(heights, localX, localZ),
    trees,
    coverSample,
  );

  return { heights, positions, detailOffsets, normals, colors, indices, propSurfaces, canopy, trees, treeCount };
}

/**
 * Plants a tile's trees into `out` and returns how many.
 *
 * TREES DO NOT GROW AT RANDOM, and the rules below are the whole of that sentence:
 *
 *   WOODS      the land cover's forest density, one candidate per `TREE_CELL`, kept
 *              with that probability so an edge thins out on its own. Mixed: spruce
 *              against deciduous by the birch share, deciduous split into birch and
 *              broadleaf (lime, aspen, alder). A wood's edge carries undergrowth and
 *              younger, shorter trees — the ecotone, not a wall.
 *   COPSES     clumps of a few dozen trees standing out in meadow and fallow.
 *   BELTS      rows along some field boundaries in farmland (world/landcover.ts).
 *   RAVINES    alder, willow and scrub down a ravine's sides and floor.
 *   DITCHES    willow scrub in clumps along the roadside, never a spaced row.
 *   FALLOW     young birch coming up in patches on fields nobody ploughs.
 *   LONE TREES very rare: an old birch or lime at a field corner.
 *
 * A pure function of the seed and the tile: it does not depend on where the player
 * is, so the same ground always carries the same trees, near or far.
 */
export function plantTrees(
  context: DesertTileGenerationContext,
  tx: number,
  tz: number,
  heightAt: (localX: number, localZ: number, worldX: number, worldZ: number) => number,
  out: Float32Array,
  cover: CoverSample,
): number {
  const startX = tx * DESERT_TILE_SIZE;
  const startZ = tz * DESERT_TILE_SIZE;
  const centreX = startX + DESERT_TILE_SIZE * 0.5;
  const centreZ = startZ + DESERT_TILE_SIZE * 0.5;
  const land = context.terrain.cover;
  const terrain = context.terrain;
  const seed = context.seed;
  let n = 0;
  const put = (x: number, z: number, kind: TreeKind, scale: number, key: number): void => {
    if (n >= MAX_TILE_TREES) return;
    const o = n * TREE_STRIDE;
    out[o] = x - centreX;
    out[o + 1] = heightAt(x - startX, z - startZ, x, z);
    out[o + 2] = z - centreZ;
    out[o + 3] = scale;
    out[o + 4] = hash01(seed, TREE_TAG, key, 5) * Math.PI * 2;
    out[o + 5] = kind;
    out[o + 6] = 0.84 + hash01(seed, TREE_TAG, key, 6) * 0.32;
    n++;
  };
  /**
   * A deciduous tree of the kind the place favours: in broad-leaved country lime, oak
   * and maple; elsewhere the small-leaved pair, birch and its companion aspen.
   */
  const deciduous = (x: number, z: number, r: number, r5: number): TreeKind => {
    if (r < land.broadleafAt(x, z) * 0.7) return r5 < 0.4 ? TreeKind.Lime : r5 < 0.72 ? TreeKind.Oak : TreeKind.Maple;
    return r5 < 0.72 ? TreeKind.Birch : TreeKind.Aspen;
  };
  /** A conifer: pine on its tracts, spruce everywhere else. */
  const conifer = (x: number, z: number, r5: number): TreeKind => (r5 < land.pineAt(x, z) * 0.9 ? TreeKind.Pine : TreeKind.Spruce);
  for (let ci = 0; ci < TREE_CELLS; ci++) {
    for (let cj = 0; cj < TREE_CELLS; cj++) {
      const gx = tx * TREE_CELLS + ci;
      const gz = tz * TREE_CELLS + cj;
      const key = (gx * 73856093) ^ (gz * 19349663);
      const x = startX + (ci + 0.1 + hash01(seed, TREE_TAG, gx, gz, 1) * 0.8) * TREE_CELL;
      const z = startZ + (cj + 0.1 + hash01(seed, TREE_TAG, gx, gz, 2) * 0.8) * TREE_CELL;
      if (terminusWeight(x, z) > 0) continue;
      let roadDist = context.roadDistance.distAt(x, z, DIST_LATTICE);
      // The lattice distance is only good to about its own spacing, and a bush 4 m out
      // stands on the carriageway. Near the road, ask the road itself.
      if (roadDist < TREE_EXACT_GATE) {
        const p = context.road.project(x, z, context.roadDistance.ownerAt(x, z, DIST_LATTICE));
        roadDist = Math.abs(p.lateral);
        if (roadDist < context.road.halfWidthAt(p.s) + TREE_VERGE_KEEP) continue;
      }
      if (roadDist < TREE_ROAD_KEEP) continue;
      const r = hash01(seed, TREE_TAG, gx, gz, 3);
      const r2 = hash01(seed, TREE_TAG, gx, gz, 4);
      const r3 = hash01(seed, TREE_TAG, gx, gz, 7);
      const r4 = hash01(seed, TREE_TAG, gx, gz, 8);
      const r5 = hash01(seed, TREE_TAG, gx, gz, 9);

      // Woods.
      const forest = land.forestAt(x, z, roadDist);
      if (forest > 0) {
        if (r < forest * 0.93) {
          const birch = land.birchAt(x, z);
          let kind = r2 < birch * 0.85 + 0.08 ? deciduous(x, z, r4, r5) : conifer(x, z, r5);
          // Wet ground in a wood is alder carr.
          if (kind !== TreeKind.Pine && r4 < 0.7 && terrain.wetnessAt(x, z) > 0.3) kind = TreeKind.Alder;
          // Mature interior, younger edge: size follows density, then a wide spread.
          const size = (0.55 + 0.45 * forest) * (0.72 + 0.56 * r3);
          put(x, z, kind, size, key);
          continue;
        }
        // The edge's undergrowth: hazel mostly, and rowan standing out of it.
        if (forest < 0.8 && r2 < 0.45) {
          if (r5 < 0.22) put(x, z, TreeKind.Rowan, 0.7 + 0.4 * r3, key);
          else put(x, z, TreeKind.Bush, 0.6 + 0.7 * r3, key);
          continue;
        }
        continue;
      }

      // Ravines grow over with scrub and alder along the floor, in a continuous ribbon.
      // Thin odds over the whole flank dotted lone trees in lines across the meadow.
      const ravine = terrain.ravineAt(x, z);
      if (ravine > 0.15) {
        if (r < THREE.MathUtils.smoothstep(ravine, 0.45, 0.8) * 0.8) {
          // Scrub, alder and willow: the trees that follow water.
          const kind = r2 < 0.45 ? TreeKind.Bush : r2 < 0.8 ? TreeKind.Alder : TreeKind.Willow;
          put(x, z, kind, 0.55 + 0.55 * r3, key);
        }
        continue;
      }

      // Shelter belts: dense rows of the planted kinds — birch, oak, maple, lime.
      const belt = land.beltAt(x, z);
      if (belt > 0.5) {
        if (r < 0.92) {
          const broad = land.broadleafAt(x, z) > 0.5;
          const kind =
            r2 < 0.15
              ? TreeKind.Bush
              : broad
                ? r5 < 0.4 ? TreeKind.Oak : r5 < 0.7 ? TreeKind.Maple : TreeKind.Lime
                : r5 < 0.8 ? TreeKind.Birch : TreeKind.Maple;
          // Full-grown and close: a belt reads as one dark line, crowns touching.
          put(x, z, kind, 0.85 + 0.35 * r3, key);
        }
        continue;
      }

      // Roadside scrub in the ditch, clumped by a slow field along the road, with a
      // young willow (rakita) standing out of it here and there.
      if (roadDist < 22) {
        const clump = land.copseAt(x * 3.1 + 500, z * 3.1 - 700);
        if (r < clump * 0.7) {
          if (r5 < 0.25) put(x, z, TreeKind.Willow, 0.5 + 0.3 * r3, key);
          else put(x, z, TreeKind.Bush, 0.55 + 0.6 * r3, key);
        }
        continue;
      }

      land.sample(x, z, roadDist, cover);
      if (cover.kind === CoverKind.Field) continue;

      // Copses in the open, and young birch coming up in fallow.
      const copse = land.copseAt(x, z);
      if (copse > 0) {
        if (r < copse * 0.85) {
          const kind = r2 < 0.2 ? TreeKind.Bush : r2 < 0.3 ? conifer(x, z, r5) : deciduous(x, z, r4, r5);
          put(x, z, kind, (0.5 + 0.5 * copse) * (0.7 + 0.5 * r3), key);
        }
        continue;
      }
      // Fallow goes back to birch first, with aspen among it.
      if (cover.crop === Crop.Fallow) {
        const thicket = land.copseAt(x * 1.9 - 300, z * 1.9 + 900);
        if (r < thicket * 0.6) put(x, z, r5 < 0.8 ? TreeKind.Birch : TreeKind.Aspen, 0.28 + 0.3 * r3, key);
        continue;
      }
      // The exception: an old tree on its own where plots meet — most often an oak.
      // Rare enough that an open plain shows one or two, not a scatter: at 0.0012 a
      // square kilometre of meadow carried ten, and they read as sticks on an empty
      // horizon.
      if (r < 0.0003 && cover.plot < 0.5) {
        const kind = r2 < 0.45 ? TreeKind.Oak : r2 < 0.75 ? TreeKind.Birch : r2 < 0.9 ? TreeKind.Lime : TreeKind.Willow;
        put(x, z, kind, 0.95 + 0.3 * r3, key);
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
