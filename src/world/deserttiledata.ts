import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { CoverKind, Crop, MUD, newCoverSample, writeGroundWeights, type CoverSample } from './landcover';
import { canopyHeight } from './vistaground';
import { ROAD_MAX_HALF_WIDTH, type Road } from './road';
import type { RoadDistance } from './roaddistance';
import { CORRIDOR_OUTER, PEAT, type Terrain } from './terrain';
import { BASIN_OUTER_M, type BasinFootprint } from './lakes';
import { terminusWeight } from './terminus';
import { WAVE_TILE_METRES } from '../render/watermaterial';
import { TRACK_HALF_WIDTH_M, TRACK_MAX_LENGTH_M, trackAt, trackPossibleNear, type TrackSample } from './tracks';


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
 * Floats per water-surface vertex: x, y, z, the rgba the shoreline is baked in, then the
 * wave-field uv.
 *
 * THE UV IS NOT DECORATION. `STREAM_WATER` is `createWaterMaterial()` — a scrolled
 * `normalMap` over the surface (render/watermaterial.ts) — and a mesh with no `uv`
 * attribute samples texel (0,0) for every fragment, where the tangent frame built from
 * the derivatives has determinant zero and `perturbNormal` returns the unperturbed
 * normal. The scroll was invisible and every stream rendered as a flat mirror. It is
 * ABSOLUTE world position over the wave tile, as the lake's is, so the pattern neither
 * seams at tile edges nor slides when the floating origin moves.
 */
export const WATER_VERTEX_STRIDE = 9;
/**
 * Water's own colours, linear rgb, shallow and deep.
 *
 * Dark and green, not blue: a stream in this country runs under alder and willow, and
 * the sky only reaches it in patches. The deep tone clears the brightest ground there
 * is (a stubble field) by value, so a stream reads as water and not as wet earth.
 */
const WATER_SHALLOW: readonly [number, number, number] = [0.1, 0.145, 0.115];
const WATER_DEEP: readonly [number, number, number] = [0.028, 0.05, 0.046];
/** Depth over which the surface goes from translucent to nearly opaque, metres. */
const WATER_DEEP_FULL_M = 1.2;
/**
 * How deep the ground has to stand under a water surface before the surface is drawn
 * there. Shallow enough to keep the whole channel, deep enough that the few centimetres
 * of a bank the lattice rounds off do not become water.
 */
const WATER_MIN_DEPTH = 0.03;
/**
 * How far inside a basin's bowl nothing is planted, and how wide the shore band that is
 * planted with willows is, metres.
 *
 * The water's edge is the bowl's edge (`site.radius`), because the water fills the bowl to
 * its lip; the shore band straddles it, so the willows stand on the bank rather than in the
 * water. Silt is painted for `SILT_BAND_M` past the edge, which is the shallow bottom the
 * sheet is transparent over.
 */
const BASIN_KEEP_M = 1.5;
const SHORE_BAND_M = 12;
const SILT_BAND_M = 6;
/**
 * How far from a tile's centre a basin still has to be resolved, metres: a basin's dug
 * ground reaches 484 m from its centre, and a 240 m tile's corner is 170 m from the middle.
 * The lookup itself is a distance against a flat array of centres, so the margin is free.
 */
const BASIN_REACH_M = BASIN_OUTER_M + 190;

/**
 * Fills the scratch with the basins that reach a tile, and returns how many.
 *
 * THE HINT IS FREE HERE. `placementsNear` needs a nearby arclength, and getting one is the
 * expensive part of this whole mechanism: `RoadDistance` answers in microseconds where its
 * lattice is already dense and in one to three MILLISECONDS at a point nobody has asked
 * about — a road query a tile does not already make is a fresh neighbourhood, and 24 of them
 * across the diagonal measured 70 ms of a 20 ms tile. So the tile does not make one. Its
 * ground vertex loop already asks `distAt` for every vertex in order, and `ownerAt` at a
 * point whose `distAt` has just been read is one of the cheap ones (measured: 0.1 ms for 400
 * such pairs), so the fill happens at the FIRST vertex of the tile, on the distance the
 * colour pass has already paid for, and the planting reuses it.
 */
function fillTileBasins(context: DesertTileGenerationContext, x: number, z: number): number {
  basinReach = context.terrain.basins.placementsNear(
    x,
    z,
    context.roadDistance.ownerAt(x, z, DIST_LATTICE),
    BASIN_REACH_M,
    basinScratch,
  );
  return basinReach;
}

/** Which tile the scratch holds, so the planting does not fill it a second time. */
let basinTile = Number.NaN;

/** The identity of the tile the scratch was filled for. */
function tileKeyOf(tx: number, tz: number): number {
  return tx * 100003 + tz;
}

/**
 * Silt, linear rgb: the bottom of a lake or a pond, under a sheet of water.
 *
 * A bed painted with the mud used elsewhere — or worse with the peat of a bog — reads
 * through clear shallows as a black hole with water on top of it. This is what a bottom
 * actually is: grey-green, wet, and a little lighter than the water it lies under.
 */
const SILT: readonly [number, number, number] = [0.16, 0.16, 0.12];

/** Scratch for the basin footprints that reach one tile, and how many are in it. */
const basinScratch: BasinFootprint[] = [];
let basinReach = 0;

/**
 * How far INSIDE a basin's shore band a point stands, metres, or 0 outside it. The band
 * runs `SHORE_BAND_M` from the water's edge outward, so a value greater than
 * `SHORE_BAND_M - BASIN_KEEP_M` means the water: nothing woody is planted there.
 */
function shoreMargin(x: number, z: number): number {
  for (let i = 0; i < basinReach; i++) {
    const basin = basinScratch[i]!;
    const r = Math.hypot(x - basin.x, z - basin.z);
    if (r < basin.inner + SHORE_BAND_M) return basin.inner + SHORE_BAND_M - r;
  }
  return 0;
}
/**
 * Per-vertex water level for the tile being built. One buffer reused by every tile in
 * the worker: the generator is synchronous and single-threaded, and a tile is 6561
 * vertices.
 */
const waterLevels = new Float32Array(DESERT_TILE_VERTS * DESERT_TILE_VERTS);

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
  /**
   * Ground paint weights per vertex: meadow, crop, forest floor, bare earth
   * (render/groundpaint.ts).
   */
  readonly ground: Float32Array;
  /** `treeCount` trees of `TREE_STRIDE` floats each: see `TreeField`. */
  readonly trees: Float32Array;
  readonly treeCount: number;
  /**
   * The watercourses' surfaces for this tile: `waterVertexCount` vertices of
   * `[x, y, z, depth]` (metres above the bed, for the shoreline fade) and
   * `waterIndexCount` triangle indices. Empty on the great majority of tiles.
   */
  readonly water: Float32Array;
  readonly waterIndices: Uint32Array;
  readonly waterVertexCount: number;
  readonly waterIndexCount: number;
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
  /** Undergrowth: bracken and lady fern on the floor of spruce and mixed woods. */
  Fern = 11,
  /** Undergrowth: the bor's juniper. */
  Juniper = 12,
  /** The forest floor: a stump, old and grey or freshly cut. */
  Stump = 13,
  /** The forest floor: a fallen trunk, lying where it fell. */
  Log = 14,
  /** A pine grown in the open: crown from a third of its height, wide and low. */
  FieldPine = 15,
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
  TreeKind.Fern,
  TreeKind.Juniper,
  TreeKind.Stump,
  TreeKind.Log,
  TreeKind.FieldPine,
];

/**
 * Kinds from this one to `UNDERGROWTH_KIND_TO` are undergrowth and floor: fern, juniper,
 * stump, log. They live here rather than with the geometry (`world/props/trees.ts`)
 * because the far forest's worker needs them, and that module builds every tree.
 */
export const UNDERGROWTH_KIND_FROM = TreeKind.Fern;
export const UNDERGROWTH_KIND_TO = TreeKind.Log;

/**
 * Whether a kind is ever drawn as an impostor.
 *
 * The undergrowth is not, and never was meant to be: its models dissolve between 50 and
 * 110 m (`world/forest.ts`) and it is gone past that, while an impostor only appears from
 * 135 m — so the two never meet, and the sheet was baked with 240 cells of fern, juniper,
 * stump and log that nothing could ever sample as a tree. They were drawn all the same,
 * because the far forest plants every kind: a quarter of the atlas, and a quarter of the
 * far trees' quads, spent on floor plants that had already been faded out.
 */
export function isImpostorKind(kind: number): boolean {
  return !(kind >= UNDERGROWTH_KIND_FROM && kind <= UNDERGROWTH_KIND_TO);
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
export const MAX_TILE_TREES = TREE_CELLS * TREE_CELLS * 3;
const TREE_TAG = 0x54524545;
/**
 * Half-width of the willow band along a watercourse, in field units of the stream line
 * (`LINE_WAVELENGTH` 2600 m), so 0.014 is about 36 m from the centreline. The bed itself
 * is 9-33 m wide, so this is one thicket deep on each bank.
 */
const BANK_WILLOW_HALF = 0.014;
const UNDER_TAG = 0x554e4452;
/** Nothing is planted closer than this to the road's centreline: verge and ditch. */
const TREE_ROAD_KEEP = 9.5;
/** Past the asphalt edge: the verge and the ditch stay clear whatever the road's width. */
const TREE_VERGE_KEEP = 5.5;
/** Below this lattice distance a candidate's distance is measured exactly. */
const TREE_EXACT_GATE = TREE_ROAD_KEEP + DIST_LATTICE * 1.5;


export interface GroundHeightSample {
  height: number;
  detail: number;
  /**
   * Height of a watercourse's surface at this point, or NaN where there is none and
   * where the reach is dry (world/streams.ts). The tile builder draws a water quad
   * wherever the ground stands below this, so the stream is a surface standing in a bed
   * that `Terrain` dug, and never a sheet laid over a field. NaN and not 0: the world's
   * heights run to -200 m, so 0 is an ordinary surface height.
   */
  water: number;
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
    out.water = context.terrain.waterLevelAt(x, z);
    return;
  }
  const approximate = context.roadDistance.distAt(x, z, DIST_LATTICE);
  if (approximate >= EXACT_DISTANCE_GATE) {
    const s = context.roadDistance.ownerAt(x, z, DIST_LATTICE);
    const detail = context.terrain.explorationDetailAt(x, z, approximate, s);
    out.height = context.terrain.openBase(x, z, approximate, s) + detail;
    out.detail = detail;
    out.water = context.terrain.waterLevelAt(x, z);
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
  out.water = context.terrain.waterLevelAt(x, z);
}

/**
 * Reuses `existing` when it is exactly the right length, otherwise allocates.
 *
 * Every tile shares one lattice, so in practice a recycled set always fits and a
 * steady-state drive allocates no tile buffers at all. The length check is what
 * makes that safe rather than assumed: a mismatched buffer is dropped, never
 * partially filled.
 */
function smoothstepNumber(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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
  const groundPaint = fit(into?.ground, vertexCount * 4, Float32Array);
  const ground = { height: 0, detail: 0, water: 0 };
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
      waterLevels[vi] = ground.water;
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
      // The tile's basins, resolved on the distance this vertex has already asked for: see
      // `fillTileBasins`. Before this, the planting and the grass fill it themselves.
      if (basinTile !== tileKeyOf(tx, tz)) {
        basinTile = tileKeyOf(tx, tz);
        fillTileBasins(context, worldX, worldZ);
      }
      // A basin's bottom is SILT while the water is over it, and it takes precedence over
      // the bog's peat: a mire's peat under a lake is a black hole seen through the sheet.
      const shore = shoreMargin(worldX, worldZ);
      if (shore > SHORE_BAND_M - SILT_BAND_M) {
        const m = Math.min(1, (shore - (SHORE_BAND_M - SILT_BAND_M)) / SILT_BAND_M + 0.35);
        coverSample.r += (SILT[0] - coverSample.r) * m;
        coverSample.g += (SILT[1] - coverSample.g) * m;
        coverSample.b += (SILT[2] - coverSample.b) * m;
      }
      // A bog's ground is PEAT, and it is not a tuft of anything: the colour goes to the
      // peat's own, over the top of the meadow the cover field painted.
      const bog = shore > 0 ? 0 : context.terrain.bogAt(worldX, worldZ);
      if (bog > 0) {
        const m = Math.min(1, bog * 0.9);
        coverSample.r += (PEAT[0] - coverSample.r) * m;
        coverSample.g += (PEAT[1] - coverSample.g) * m;
        coverSample.b += (PEAT[2] - coverSample.b) * m;
      }
      writeGroundWeights(coverSample, wet, groundPaint, vi * 4);
      colors[vi * 3] = coverSample.r;
      colors[vi * 3 + 1] = coverSample.g;
      colors[vi * 3 + 2] = coverSample.b;
      // A WOOD DOES NOT STAND ON A MIRE OR IN A LAKE. The canopy height and colour are what
      // make a wood read as a mass from a distance, and they were painted wherever the cover
      // said forest — over the peat this very pass paints for a bog, and over a basin's water.
      // Up close the planting puts nothing woody inside a basin and only sparse, small trees
      // on a bog (`bog > 0.35`), so the wood OPENED on arrival: the far picture and the near
      // one were different places, which is the mirage the bog's peat was added for. Same
      // mask as the planting, applied to the mass.
      const overWater = shore > SHORE_BAND_M - BASIN_KEEP_M;
      const canopyForest = overWater ? 0 : coverSample.forest * (1 - Math.min(1, bog * 0.9));
      if (canopyForest > 0) {
        cover.canopyColour(worldX, worldZ, coverSample.birch, canopy, vi * 4);
        canopy[vi * 4 + 3] = canopyHeight(worldX, worldZ, canopyForest, coverSample.birch);
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

  // THE WATERCOURSES' SURFACES (`world/streams.ts`). A stream is water standing in a
  // bed, not a sheet laid on the ground, so the surface only exists where the ground
  // the tiles just built stands below the water level — which is what makes a culvert
  // read as a culvert: the graded embankment fills the bed, the ground rises above the
  // water, and the stream stops at the face of it and picks up on the far side.
  //
  // The vertices carry their own DEPTH, and the shoreline fades out on it. That is what
  // hides the lattice: the bed is only 3 m wide per cell, and a hard-edged sheet on a
  // 3 m lattice would be a staircase. Fading over the shallows costs nothing and reads
  // as a soft bank.
  let waterCells = 0;
  for (let ix = 0; ix < DESERT_TILE_CELLS; ix++) {
    for (let iz = 0; iz < DESERT_TILE_CELLS; iz++) {
      const a = ix * DESERT_TILE_VERTS + iz;
      const b = (ix + 1) * DESERT_TILE_VERTS + iz;
      const c = a + 1;
      const d = b + 1;
      if (
        waterLevels[a]! - heights[a]! > WATER_MIN_DEPTH ||
        waterLevels[b]! - heights[b]! > WATER_MIN_DEPTH ||
        waterLevels[c]! - heights[c]! > WATER_MIN_DEPTH ||
        waterLevels[d]! - heights[d]! > WATER_MIN_DEPTH
      ) {
        waterCells++;
      }
    }
  }
  const water = fit(into?.water, waterCells * 4 * WATER_VERTEX_STRIDE, Float32Array);
  const waterIndices = fit(into?.waterIndices, waterCells * 6, Uint32Array);
  let wp = 0;
  let wi = 0;
  if (waterCells > 0) {
    for (let ix = 0; ix < DESERT_TILE_CELLS; ix++) {
      for (let iz = 0; iz < DESERT_TILE_CELLS; iz++) {
        const corners = [
          ix * DESERT_TILE_VERTS + iz,
          (ix + 1) * DESERT_TILE_VERTS + iz,
          ix * DESERT_TILE_VERTS + iz + 1,
          (ix + 1) * DESERT_TILE_VERTS + iz + 1,
        ];
        // One level for the whole quad: the surface of a stream is flat across its own
        // section, and taking each corner's own level would tilt the sheet with the
        // noise instead. Seeded from -Infinity and NOT from 0, because 0 is a real
        // surface height in a world that reaches -200 m: with 0 as the seed the max
        // never rises above it and every sheet is drawn at sea level.
        let level = -Infinity;
        let deep = 0;
        for (const vi of corners) {
          if (waterLevels[vi]! > level) level = waterLevels[vi]!;
          const dpt = waterLevels[vi]! - heights[vi]!;
          if (dpt > deep) deep = dpt;
        }
        if (deep <= WATER_MIN_DEPTH || level === -Infinity) continue;
        const base = wp / WATER_VERTEX_STRIDE;
        for (let k = 0; k < 4; k++) {
          const vi = corners[k]!;
          const cix = vi / DESERT_TILE_VERTS | 0;
          const ciz = vi % DESERT_TILE_VERTS;
          const dpt = waterLevels[vi]! - heights[vi]!;
          const depth = dpt > 0 ? dpt : 0;
          // The shoreline fade lives in the vertex alpha: the bed is a few cells wide,
          // and a sheet with a hard edge on a 3 m lattice is a staircase.
          const deep = smoothstepNumber(0, WATER_DEEP_FULL_M, depth);
          const shore = smoothstepNumber(0.03, 0.3, depth);
          // Tile-CENTRE relative, like the ground's own positions: the tile's group
          // stands at the tile centre, and a sheet written in corner coordinates lands
          // half a tile away from its own bed.
          water[wp] = cix * DESERT_TILE_STEP - DESERT_TILE_SIZE * 0.5;
          water[wp + 1] = level;
          water[wp + 2] = ciz * DESERT_TILE_STEP - DESERT_TILE_SIZE * 0.5;
          water[wp + 3] = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * deep;
          water[wp + 4] = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * deep;
          water[wp + 5] = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * deep;
          water[wp + 6] = shore * (0.45 + 0.5 * deep);
          // Absolute world x/z over the wave tile, so the scrolled normal map is
          // continuous across tiles and does not slide when the origin moves.
          water[wp + 7] = (startX + cix * DESERT_TILE_STEP - DESERT_TILE_SIZE * 0.5) / WAVE_TILE_METRES;
          water[wp + 8] = (startZ + ciz * DESERT_TILE_STEP - DESERT_TILE_SIZE * 0.5) / WAVE_TILE_METRES;
          wp += WATER_VERTEX_STRIDE;
        }
        // Same winding as the ground lattice, so the sheet faces the same way up.
        waterIndices[wi++] = base;
        waterIndices[wi++] = base + 2;
        waterIndices[wi++] = base + 1;
        waterIndices[wi++] = base + 1;
        waterIndices[wi++] = base + 2;
        waterIndices[wi++] = base + 3;
      }
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

  return {
    heights,
    positions,
    detailOffsets,
    normals,
    colors,
    indices,
    propSurfaces,
    canopy,
    ground: groundPaint,
    trees,
    treeCount,
    water,
    waterIndices,
    waterVertexCount: waterCells * 4,
    waterIndexCount: waterCells * 6,
  };
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
  /**
   * Whether to plant the undergrowth too. The model tiles do; the impostor worker does
   * not: a fern or a hazel at a kilometre is a pixel for the price of a tree.
   */
  undergrowth = true,
): number {
  const startX = tx * DESERT_TILE_SIZE;
  const startZ = tz * DESERT_TILE_SIZE;
  const centreX = startX + DESERT_TILE_SIZE * 0.5;
  const centreZ = startZ + DESERT_TILE_SIZE * 0.5;
  const land = context.terrain.cover;
  const terrain = context.terrain;
  const seed = context.seed;
  let n = 0;
  /**
   * THE BASINS THAT REACH THIS TILE, and the reason the planting has to know about them
   * (see `BasinFootprint`): the water is drawn from the basin's own bowl, so a tree planted
   * inside the bowl is a tree standing in the lake — and the first version of this world
   * did exactly that, which read from a distance as a lake with trees in it and up close as
   * a walk under the water among trunks.
   */
  // The colour pass of `generateDesertTileData` has already filled this from a distance it
  // had paid for; a direct call to `plantTrees` (a test, a tool) fills it here instead.
  if (basinTile !== tileKeyOf(tx, tz)) {
    basinTile = tileKeyOf(tx, tz);
    basinReach = context.terrain.basins.placementsNear(
      centreX,
      centreZ,
      context.roadDistance.ownerAt(centreX, centreZ, DIST_LATTICE),
      BASIN_REACH_M,
      basinScratch,
    );
  }
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
    if (r < land.broadleafAt(x, z) * 0.3) return r5 < 0.4 ? TreeKind.Lime : r5 < 0.72 ? TreeKind.Oak : TreeKind.Maple;
    return r5 < 0.78 ? TreeKind.Birch : TreeKind.Aspen;
  };
  /**
   * Whether a wood here is a pine wood (bor). Pine grows on its own tracts of sandy
   * ground and holds them: a bor is pine with the odd birch, no spruce, no undergrowth
   * to speak of, and pine is not found as a lone tree or mixed through other woods.
   * The tract's edge is jittered per tree over a narrow band so it is not a ruled line.
   */
  const inBor = (x: number, z: number, r5: number): boolean => land.pineAt(x, z) > 0.35 + 0.3 * r5;
  /**
   * Whether a point is on a dirt track (world/tracks.ts), within `clear` metres of its
   * centreline: a projection is paid for only where a track can be.
   */
  const trackSample: TrackSample = { dist: Infinity, fade: 0 };
  const onTrack = (x: number, z: number, roadDist: number, clear: number): boolean => {
    if (roadDist > TRACK_MAX_LENGTH_M + 20) return false;
    const hint = context.roadDistance.ownerAt(x, z, DIST_LATTICE);
    if (!trackPossibleNear(seed, hint)) return false;
    const p = context.road.project(x, z, hint);
    trackAt(seed, p.s, p.lateral, context.road.halfWidthAt(p.s), trackSample);
    return trackSample.dist < clear && trackSample.fade > 0.2;
  };
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
      // A track is cut through the wood: the trees keep a lane either side of it.
      if (onTrack(x, z, roadDist, TRACK_HALF_WIDTH_M + 2.2)) continue;
      // Nothing stands IN a watercourse's bed (world/streams.ts). It is water and
      // gravel, and a birch growing out of the middle of a stream is the kind of thing
      // that reads as a bug rather than as a river.
      const stream = context.road.landscape.streams.at(x, z);
      if (stream.bed > 0 || stream.bowl > 0.15) continue;
      // A BOG HAS ITS OWN PLANTS, and almost nothing else: dwarf pine and stunted birch on
      // the tussocks, willow and juniper between them, no fern, and no timber — a wood
      // cannot stand in a mire, and the trees that are there are the ones a walker uses to
      // cross it.
      const bog = terrain.bogAt(x, z);
      const r = hash01(seed, TREE_TAG, gx, gz, 3);
      const r2 = hash01(seed, TREE_TAG, gx, gz, 4);
      const r3 = hash01(seed, TREE_TAG, gx, gz, 7);
      const r4 = hash01(seed, TREE_TAG, gx, gz, 8);
      const r5 = hash01(seed, TREE_TAG, gx, gz, 9);

      // A LAKE OR A POND. Nothing stands inside the bowl, and the bank carries the same
      // willows a stream's does: rakita and hazel with alder behind, in a band measured
      // from the water's edge outward.
      const shore = shoreMargin(x, z);
      if (shore > SHORE_BAND_M - BASIN_KEEP_M + 0.0001) continue;
      if (shore > 0) {
        if (r < 0.5) {
          const kind =
            r2 < 0.35 ? TreeKind.Willow : r2 < 0.62 ? TreeKind.Bush : r2 < 0.82 ? TreeKind.Alder : TreeKind.Birch;
          put(x, z, kind, 0.6 + 0.5 * r3, key);
        }
        continue;
      }
      if (bog > 0.35) {
        if (r < Math.min(0.5, bog * 0.5)) {
          const kind =
            r2 < 0.3 ? TreeKind.Pine : r2 < 0.58 ? TreeKind.Birch : r2 < 0.78 ? TreeKind.Willow : TreeKind.Juniper;
          // Small and slow: a pine on a bog is a third the height of one on sand.
          put(x, z, kind, (kind === TreeKind.Pine ? 0.34 : 0.42) + 0.22 * r3, key);
        }
        continue;
      }

      // Woods.
      const forest = land.forestAt(x, z, roadDist);
      if (forest > 0) {
        const bor = inBor(x, z, r5);
        if (r < forest * 0.93) {
          const birch = land.birchAt(x, z);
          // What the middle belt's woods are made of (Moscow region: birch 35%, spruce
          // 27%, pine 23%, aspen 9%, oak 2%, lime under 1%): the birch field picks
          // between spruce wood (ельник, at its low end) and birch-and-aspen wood, with
          // mixed wood between; and a wood's edge is birch and aspen far more than
          // spruce, which fills the interior.
          const interior = 0.35 + 0.65 * THREE.MathUtils.smoothstep(forest, 0.55, 0.95);
          const spruce = Math.pow(1 - birch, 1.4) * 0.88 * interior;
          let kind = bor
            ? r2 < 0.05 ? TreeKind.Birch : TreeKind.Pine
            : r2 < spruce ? TreeKind.Spruce : deciduous(x, z, r4, r5);
          // Wet ground in a wood is alder carr. Not in a bor: its sand is dry.
          if (!bor && r4 < 0.7 && terrain.wetnessAt(x, z) > 0.3) kind = TreeKind.Alder;
          // Mature interior, younger edge: size follows density, then a wide spread.
          const size = (0.55 + 0.45 * forest) * (0.72 + 0.56 * r3);
          put(x, z, kind, size, key);
          continue;
        }
        // The edge's undergrowth: hazel mostly, and rowan standing out of it. A bor has
        // next to none: now and then a rowan.
        if (bor) {
          if (forest < 0.8 && r2 < 0.04) put(x, z, TreeKind.Rowan, 0.6 + 0.3 * r3, key);
          continue;
        }
        if (forest < 0.8 && r2 < 0.45) {
          if (r5 < 0.22) put(x, z, TreeKind.Rowan, 0.7 + 0.4 * r3, key);
          else put(x, z, TreeKind.Bush, 0.6 + 0.7 * r3, key);
          continue;
        }
        continue;
      }

      // THE WATERCOURSE'S BANKS. The damp strip just outside the bed carries the
      // willows — rakita in clumps with the white willow standing out of them — and
      // alder behind, which is the band a bridge looks down into and the thing that says
      // "there is water down there" from three hundred metres when the water itself is
      // under the bank.
      if (stream.flood > 0.5 && stream.d < BANK_WILLOW_HALF && r < 0.42) {
        const kind =
          r2 < 0.42 ? TreeKind.Willow : r2 < 0.68 ? TreeKind.Bush : r2 < 0.9 ? TreeKind.Alder : TreeKind.Birch;
        put(x, z, kind, 0.55 + 0.55 * r3, key);
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

      // SHISHKIN'S "RYE": now and then a group of old pines stands in the open fields
      // by the road, left when the wood around them was cleared, crowns wide and low
      // from growing in the open. Rare: a few in a long drive.
      if (roadDist < 260) {
        const relic = land.copseAt(x * 0.7 + 1234, z * 0.7 - 777);
        // Only in a quarter of the 2 km districts: about one group every dozen km.
        const district = hash01(seed, TREE_TAG, Math.floor(x / 2000), Math.floor(z / 2000), 11);
        if (relic > 0.9 && district < 0.25 && land.farmlandAt(x, z) > 0.4) {
          // Five to nine of them over a patch forty to sixty metres across.
          if (r < 0.07) put(x, z, TreeKind.FieldPine, 1.0 + 0.3 * r3, key);
          continue;
        }
      }

      land.sample(x, z, roadDist, cover);
      if (cover.kind === CoverKind.Field) continue;

      // Copses in the open, and young birch coming up in fallow.
      const copse = land.copseAt(x, z);
      if (copse > 0) {
        if (r < copse * 0.85) {
          const kind = r2 < 0.2 ? TreeKind.Bush : r2 < 0.3 ? TreeKind.Spruce : deciduous(x, z, r4, r5);
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

  // UNDERGROWTH: the woods' middle and lower storeys, on a grid twice as fine. A wood
  // had its trees and a bare floor; the middle belt's woods stand in hazel, rowan and
  // young spruce, over bracken (docs/shishkin.md, the Moscow forest surveys). Spruce
  // and mixed woods: fern thickest where the wood is darkest, hazel and rowan where
  // light gets in, spruce seedlings under spruce. A bor: juniper and the odd young pine
  // on bare sand. Edges carry more shrubs than the interior.
  if (!undergrowth) return n;
  const UNDER_CELLS = TREE_CELLS * 2;
  const UNDER_CELL = DESERT_TILE_SIZE / UNDER_CELLS;
  for (let ci = 0; ci < UNDER_CELLS; ci++) {
    for (let cj = 0; cj < UNDER_CELLS; cj++) {
      const gx = tx * UNDER_CELLS + ci;
      const gz = tz * UNDER_CELLS + cj;
      const r = hash01(seed, UNDER_TAG, gx, gz, 3);
      // Most cells carry nothing: decide before paying for any field.
      if (r > 0.42) continue;
      const x = startX + (ci + 0.1 + hash01(seed, UNDER_TAG, gx, gz, 1) * 0.8) * UNDER_CELL;
      const z = startZ + (cj + 0.1 + hash01(seed, UNDER_TAG, gx, gz, 2) * 0.8) * UNDER_CELL;
      let roadDist = context.roadDistance.distAt(x, z, DIST_LATTICE);
      if (roadDist < TREE_EXACT_GATE) {
        const p = context.road.project(x, z, context.roadDistance.ownerAt(x, z, DIST_LATTICE));
        roadDist = Math.abs(p.lateral);
        if (roadDist < context.road.halfWidthAt(p.s) + TREE_VERGE_KEEP) continue;
      }
      if (roadDist < TREE_ROAD_KEEP) continue;
      if (terminusWeight(x, z) > 0) continue;
      if (onTrack(x, z, roadDist, TRACK_HALF_WIDTH_M + 0.6)) continue;
      const dug = context.road.landscape.streams.at(x, z);
      if (dug.bed > 0 || dug.bowl > 0.15) continue;
      if (shoreMargin(x, z) > SHORE_BAND_M - BASIN_KEEP_M + 0.0001) continue;
      const forest = land.forestAt(x, z, roadDist);
      const r2 = hash01(seed, UNDER_TAG, gx, gz, 4);
      const r3 = hash01(seed, UNDER_TAG, gx, gz, 7);
      // A key of its own, apart from the trees': yaw and tint hash off it.
      const key = ((gx * 83492791) ^ (gz * 2971215073)) + 0x55;
      if (forest < 0.15) {
        // SCRUB IN THE OPEN. Where a wood was cleared back for the road, the strip
        // between the ditch and the trees grows over with hazel, willow, rowan and
        // young birch; out in the meadows scrub stands in thickets. Never on a field.
        const cleared = land.forestAt(x, z, 1e6);
        const thicket = land.copseAt(x * 2.7 + 900, z * 2.7 - 400);
        const p = 0.13 * THREE.MathUtils.smoothstep(cleared, 0.1, 0.6) + 0.16 * thicket;
        if (r >= p) continue;
        land.sample(x, z, roadDist, cover);
        if (cover.kind === CoverKind.Field) continue;
        const kind = r2 < 0.55 ? TreeKind.Bush : r2 < 0.7 ? TreeKind.Willow : r2 < 0.8 ? TreeKind.Rowan : TreeKind.Birch;
        const size = kind === TreeKind.Bush ? 0.5 + 0.5 * r3 : 0.3 + 0.2 * r3;
        put(x, z, kind, size, key);
        continue;
      }
      const edge = 1 - THREE.MathUtils.smoothstep(forest, 0.55, 0.95);
      // The floor's dead wood (Shishkin paints it into every wood: stumps, windfall,
      // a trunk across the path): stumps where somebody has cut, fallen trunks where
      // the wood is old. Rare, and never at the road's edge of a wood.
      const deadwood = forest * (1 - edge);
      if (r > 0.4 && r < 0.4 + 0.012 * deadwood) {
        put(x, z, TreeKind.Stump, 0.8 + 0.5 * r3, key);
        continue;
      }
      if (r > 0.38 && r < 0.38 + 0.009 * deadwood) {
        put(x, z, TreeKind.Log, 0.8 + 0.4 * r3, key);
        continue;
      }
      if (inBor(x, z, r2)) {
        if (r < 0.035 * forest) put(x, z, TreeKind.Juniper, 0.7 + 0.6 * r3, key);
        else if (r < 0.05 * forest) put(x, z, TreeKind.Pine, 0.2 + 0.15 * r3, key);
        continue;
      }
      const spruce = Math.pow(1 - land.birchAt(x, z), 1.4);
      const pFern = forest * 0.3 * (0.35 + 0.65 * spruce);
      const pShrub = forest * (0.1 + 0.2 * edge) * (1 - 0.55 * spruce);
      const pSeedling = forest * 0.035 * spruce;
      const pBirch = forest * 0.02 * (1 - spruce) + 0.03 * edge;
      if (r < pFern) put(x, z, TreeKind.Fern, 0.75 + 0.55 * r3, key);
      else if (r < pFern + pShrub) put(x, z, r2 < 0.8 ? TreeKind.Bush : TreeKind.Rowan, (r2 < 0.8 ? 0.5 : 0.45) + 0.4 * r3, key);
      else if (r < pFern + pShrub + pSeedling) put(x, z, TreeKind.Spruce, 0.18 + 0.2 * r3, key);
      else if (r < pFern + pShrub + pSeedling + pBirch) put(x, z, TreeKind.Birch, 0.22 + 0.2 * r3, key);
    }
  }
  return n;
}

/**
 * Height of the ground AS THE TILES DRAW IT, anywhere: their lattice nodes, sampled
 * exactly as the tile builder samples them, and the same two triangles per cell (split
 * on the b-c diagonal, as the index buffer above writes them). Between nodes the drawn
 * ground is a plane, up to decimetres off the terrain function, so anything laid on the
 * ground (the shoulder, a track) must ask this rather than the function. Nodes are
 * memoised for the sampler's life: make one per build.
 */
export function tileSurfaceSampler(context: DesertTileGenerationContext): (x: number, z: number) => number {
  const nodes = new Map<number, number>();
  const sample: GroundHeightSample = { height: 0, detail: 0, water: 0 };
  const node = (i: number, j: number): number => {
    const key = i * 1_000_003 + j;
    let h = nodes.get(key);
    if (h === undefined) {
      sampleGroundHeight(context, i * DESERT_TILE_STEP, j * DESERT_TILE_STEP, false, sample);
      h = sample.height;
      nodes.set(key, h);
    }
    return h;
  };
  return (x, z) => {
    const fx = x / DESERT_TILE_STEP;
    const fz = z / DESERT_TILE_STEP;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    if (u + v <= 1) {
      const a = node(i, j);
      return a + (node(i + 1, j) - a) * u + (node(i, j + 1) - a) * v;
    }
    const d = node(i + 1, j + 1);
    return d + (node(i, j + 1) - d) * (1 - u) + (node(i + 1, j) - d) * (1 - v);
  };
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
    data.water.buffer as ArrayBuffer,
    data.waterIndices.buffer as ArrayBuffer,
    data.heights.buffer as ArrayBuffer,
    data.positions.buffer as ArrayBuffer,
    data.detailOffsets.buffer as ArrayBuffer,
    data.normals.buffer as ArrayBuffer,
    data.colors.buffer as ArrayBuffer,
    data.indices.buffer as ArrayBuffer,
    data.propSurfaces.buffer as ArrayBuffer,
    data.canopy.buffer as ArrayBuffer,
    data.ground.buffer as ArrayBuffer,
    data.trees.buffer as ArrayBuffer,
  ];
}
