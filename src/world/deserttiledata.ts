import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { desertPaletteAt } from './gradient';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import { CORRIDOR_OUTER, type Terrain } from './terrain';

/** Side length of one absolute, deterministic desert tile. */
export const DESERT_TILE_SIZE = 240;
export const DESERT_TILE_CELLS = 80;
export const DESERT_TILE_VERTS = DESERT_TILE_CELLS + 1;
export const DESERT_TILE_STEP = DESERT_TILE_SIZE / DESERT_TILE_CELLS;

const DIST_LATTICE = 20;
const EXACT_DISTANCE_GATE = CORRIDOR_OUTER + DIST_LATTICE * 2;
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
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  readonly propSurfaces: Uint8Array;
}


function groundHeight(
  context: DesertTileGenerationContext,
  x: number,
  z: number,
  farFromRoad: boolean,
): number {
  if (farFromRoad) return context.terrain.explorationHeight(x, z, FULL_RELIEF_DISTANCE);
  const approximate = context.roadDistance.distAt(x, z, DIST_LATTICE);
  if (approximate >= EXACT_DISTANCE_GATE) {
    return context.terrain.explorationHeight(x, z, approximate);
  }

  const hint = context.roadDistance.ownerAt(x, z, DIST_LATTICE);
  const projection = context.road.project(x, z, hint);
  const dist = Math.abs(projection.lateral);
  const y = context.terrain.explorationHeightFromFrame(x, z, projection.lateral, projection.s);
  const transitionInput = dist / CORRIDOR_OUTER;
  const transition =
    transitionInput < 0 ? 0 : transitionInput > 1 ? 1 : transitionInput;
  // The road ribbon owns the contact surface in the corridor. This small offset avoids
  // z-fighting while the fade leaves no ledge at the edge of the graded verge.
  const underRoad = 0.1 * (1 - transition * transition * (3 - 2 * transition));
  return y - underRoad;
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
 * torn down. Tile buffers are the largest thing this system churns — ~413 KB per
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
  const normals = fit(into?.normals, vertexCount * 3, Float32Array);
  const colors = fit(into?.colors, vertexCount * 3, Float32Array);
  const paletteDistance = farFromRoad
    ? Math.abs(centreZ)
    : context.roadDistance.ownerAt(centreX, centreZ, DIST_LATTICE);
  const palette = new THREE.Color(desertPaletteAt(paletteDistance).sand);
  for (let ix = 0; ix < DESERT_TILE_VERTS; ix++) {
    const worldX = startX + ix * DESERT_TILE_STEP;
    for (let iz = 0; iz < DESERT_TILE_VERTS; iz++) {
      const worldZ = startZ + iz * DESERT_TILE_STEP;
      const vi = ix * DESERT_TILE_VERTS + iz;
      const y = groundHeight(context, worldX, worldZ, farFromRoad);
      heights[vi] = y;
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
    // Roadside scatter owns the corridor. Once this tile is definitely far away, do
    // not ask the whole-road grid at all.
    if (!farFromRoad && context.roadDistance.distAt(worldX, worldZ, DIST_LATTICE) < 65) continue;
    propSurfaces[i] = context.terrain.openSurfaceAt(worldX, worldZ);
  }

  return { heights, positions, normals, colors, indices, propSurfaces };
}

/** Buffers are moved from the worker; the main thread builds BufferAttributes over them. */
export function desertTileDataTransfers(data: DesertTileData): Transferable[] {
  return [
    data.heights.buffer as ArrayBuffer,
    data.positions.buffer as ArrayBuffer,
    data.normals.buffer as ArrayBuffer,
    data.colors.buffer as ArrayBuffer,
    data.indices.buffer as ArrayBuffer,
    data.propSurfaces.buffer as ArrayBuffer,
  ];
}
