import type * as THREE from 'three';
import type { Item } from '../items/items';
import { BONNET_SLOT_COUNT } from './bonnet';

/** Every car and static roadside vehicle uses the same visible four-by-two trunk layout. */
export const TRUNK_COLUMNS = 4;
export const TRUNK_ROWS = 2;
export const TRUNK_CELL_COUNT = TRUNK_COLUMNS * TRUNK_ROWS;
export const TRUNK_CELL_HEIGHT = 0.26;
export const TRUNK_GRID_DEPTH = 0.06;

const TRUNK_GRID_MAX_WIDTH = 1.6;
const TRUNK_GRID_BODY_FRACTION = 1.65;
/** Raised from bumper height to just below an on-foot player's eye line. */
const STORAGE_GRID_CENTRE_Y_FRACTION = 0.55;

export type StorageSide = 'trunk' | 'bonnet';
export type StorageOwnerKind = 'car' | 'wreck' | 'courier';

/**
 * One bonnet cell lying flat in the engine bay, chassis-local metres: (x, z) the centre
 * of its floor rectangle, y the floor's height, `width` across the car (X), `depth` along
 * it (Z), `height` the clear room above the floor up to the closed bonnet's inner skin.
 */
export interface StorageCellRect {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

/**
 * What a compartment's grid is laid out against: the body box for the trunk's plane
 * behind the car, and the kit bay's measured cells for the bonnet. A `CarModelMeasure`
 * is one. Without `bonnetCells` (a body that is not a kit) the bonnet has no grid.
 */
export interface StorageGridShape {
  readonly halfExtents: readonly [number, number, number];
  /** In `BONNET_SLOT_KINDS` order. */
  readonly bonnetCells?: readonly StorageCellRect[];
}

/** Fixed-step trunk view handed from world interaction to the renderer. */
export interface TrunkViewState {
  readonly owner: StorageOwnerKind;
  readonly side: StorageSide;
  readonly id: string;
  readonly cells: readonly (Item | null)[];
  readonly selectedCell: number | null;
}

/**
 * A kit body's lids over each compartment, by rig channel (carkit/kit.ts `shellMotion`):
 * the bonnet, and the boot lid or tailgate behind (either leaf of a split one), whichever
 * the body has. A compartment's grid is reached only with one of its lids open, on a
 * driven car and on a roadside shell alike.
 */
export const STORAGE_LID_CHANNELS: Readonly<Record<StorageSide, readonly string[]>> = {
  // Forward-control vans expose their service bay through the cabin engine cover rather
  // than an exterior bonnet; other kit cars simply have no `engine_cover` channel.
  bonnet: ['bonnet', 'engine_cover'],
  trunk: ['boot', 'tailgate', 'tailgate_l', 'tailgate_r'],
};

/** The compartment a lid's channel covers, or null for a channel that is no lid. */
export function storageLidSide(channel: string): StorageSide | null {
  if (STORAGE_LID_CHANNELS.bonnet.includes(channel)) return 'bonnet';
  if (STORAGE_LID_CHANNELS.trunk.includes(channel)) return 'trunk';
  return null;
}

/** Width follows the body, capped so bus and truck cells stay small and readable. */
function trunkGridWidth(halfWidth: number): number {
  return Math.min(TRUNK_GRID_MAX_WIDTH, halfWidth * TRUNK_GRID_BODY_FRACTION);
}

export function storageCellCount(side: StorageSide): number {
  return side === 'bonnet' ? BONNET_SLOT_COUNT : TRUNK_CELL_COUNT;
}

/** Axis-aligned chassis-local box: min and max corners. */
interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * One cell's box in chassis-local space. A trunk cell is a flat panel in the plane
 * behind the car (zero depth); a bonnet cell is the room its part stands in. False
 * when the shape has no such cell.
 *
 * Trunk cells count left to right as the player sees them, read from behind the car
 * looking along +Z, where the player's left is +X.
 */
function cellBounds(cell: number, shape: StorageGridShape, side: StorageSide, out: Bounds): boolean {
  if (side === 'bonnet') {
    const rect = shape.bonnetCells?.[cell];
    if (!rect) return false;
    out.minX = rect.x - rect.width * 0.5;
    out.maxX = rect.x + rect.width * 0.5;
    out.minY = rect.y;
    out.maxY = rect.y + rect.height;
    out.minZ = rect.z - rect.depth * 0.5;
    out.maxZ = rect.z + rect.depth * 0.5;
    return true;
  }
  if (cell < 0 || cell >= TRUNK_CELL_COUNT) return false;
  const half = shape.halfExtents;
  const cellWidth = trunkGridWidth(half[0]) / TRUNK_COLUMNS;
  const column = cell % TRUNK_COLUMNS;
  const row = Math.floor(cell / TRUNK_COLUMNS);
  const x = -(column - (TRUNK_COLUMNS - 1) * 0.5) * cellWidth;
  const y = half[1] * STORAGE_GRID_CENTRE_Y_FRACTION + ((TRUNK_ROWS - 1) * 0.5 - row) * TRUNK_CELL_HEIGHT;
  out.minX = x - cellWidth * 0.5;
  out.maxX = x + cellWidth * 0.5;
  out.minY = y - TRUNK_CELL_HEIGHT * 0.5;
  out.maxY = y + TRUNK_CELL_HEIGHT * 0.5;
  out.minZ = out.maxZ = -half[2] - TRUNK_GRID_DEPTH;
  return true;
}

const _cell: Bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

/** Writes one cell's box centre and full size (chassis-local) without allocating; see `cellBounds`. */
export function storageCellBox(
  cell: number,
  shape: StorageGridShape,
  side: StorageSide,
  centre: THREE.Vector3,
  size: THREE.Vector3,
): boolean {
  if (!cellBounds(cell, shape, side, _cell)) return false;
  centre.set((_cell.minX + _cell.maxX) * 0.5, (_cell.minY + _cell.maxY) * 0.5, (_cell.minZ + _cell.maxZ) * 0.5);
  size.set(_cell.maxX - _cell.minX, _cell.maxY - _cell.minY, _cell.maxZ - _cell.minZ);
  return true;
}

const _bounds: Bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

/** Every cell's box together; false when the shape has no grid on that side. */
function gridBounds(shape: StorageGridShape, side: StorageSide, out: Bounds): boolean {
  out.minX = out.minY = out.minZ = Infinity;
  out.maxX = out.maxY = out.maxZ = -Infinity;
  const count = storageCellCount(side);
  let any = false;
  for (let cell = 0; cell < count; cell++) {
    if (!cellBounds(cell, shape, side, _cell)) continue;
    any = true;
    out.minX = Math.min(out.minX, _cell.minX);
    out.maxX = Math.max(out.maxX, _cell.maxX);
    out.minY = Math.min(out.minY, _cell.minY);
    out.maxY = Math.max(out.maxY, _cell.maxY);
    out.minZ = Math.min(out.minZ, _cell.minZ);
    out.maxZ = Math.max(out.maxZ, _cell.maxZ);
  }
  return any;
}

let slabNear = 0;
let slabFar = Infinity;

/** Narrows the running slab interval by one axis; false once the ray misses. */
function slab(origin: number, direction: number, lo: number, hi: number): boolean {
  if (Math.abs(direction) < 1e-9) return origin >= lo && origin <= hi;
  let t0 = (lo - origin) / direction;
  let t1 = (hi - origin) / direction;
  if (t0 > t1) {
    const t = t0;
    t0 = t1;
    t1 = t;
  }
  slabNear = Math.max(slabNear, t0);
  slabFar = Math.min(slabFar, t1);
  return slabNear <= slabFar;
}

/**
 * Distance along a chassis-local ray to where it enters a box (0 from inside), or
 * Infinity on a miss. A flat box (one size 0) is its plane's rectangle.
 */
function rayBox(eye: THREE.Vector3, direction: THREE.Vector3, b: Bounds): number {
  slabNear = 0;
  slabFar = Infinity;
  if (!slab(eye.x, direction.x, b.minX, b.maxX)) return Infinity;
  if (!slab(eye.y, direction.y, b.minY, b.maxY)) return Infinity;
  if (!slab(eye.z, direction.z, b.minZ, b.maxZ)) return Infinity;
  return slabNear;
}

export interface TrunkGridRayHit {
  cell: number;
  distance: number;
}

/**
 * Intersects a chassis-local aim ray with the exact cells drawn by a trunk or bonnet
 * visualizer. Cell selection and rendering therefore cannot drift. The nearest cell
 * the ray enters wins: the bonnet's cells stand at different heights in the bay.
 */
export function intersectStorageGrid(
  eye: THREE.Vector3,
  direction: THREE.Vector3,
  shape: StorageGridShape,
  side: StorageSide,
  out: TrunkGridRayHit,
): boolean {
  let best = Infinity;
  let bestCell = -1;
  const count = storageCellCount(side);
  for (let cell = 0; cell < count; cell++) {
    if (!cellBounds(cell, shape, side, _cell)) continue;
    const distance = rayBox(eye, direction, _cell);
    if (distance < best) {
      best = distance;
      bestCell = cell;
    }
  }
  if (bestCell < 0 || !(best > 0)) return false;
  out.cell = bestCell;
  out.distance = best;
  return true;
}

/**
 * Distance along a chassis-local ray to the whole grid padded by `margin` on every
 * side, or Infinity: the aim forgiveness that reveals a closed compartment before a
 * precise cell is under the crosshair.
 */
export function storageRevealDistance(
  eye: THREE.Vector3,
  direction: THREE.Vector3,
  shape: StorageGridShape,
  side: StorageSide,
  margin: number,
): number {
  if (!gridBounds(shape, side, _bounds)) return Infinity;
  _bounds.minX -= margin;
  _bounds.maxX += margin;
  _bounds.minY -= margin;
  _bounds.maxY += margin;
  // The trunk's plane keeps zero depth: it is revealed by a rectangle, not a box.
  if (side === 'bonnet') {
    _bounds.minZ -= margin;
    _bounds.maxZ += margin;
  }
  const distance = rayBox(eye, direction, _bounds);
  return distance > 0 ? distance : Infinity;
}

/** Writes the chassis-local centre of a whole grid; false when the shape has none there. */
export function storageGridCentreLocal(
  shape: StorageGridShape,
  side: StorageSide,
  out: THREE.Vector3,
): boolean {
  if (!gridBounds(shape, side, _bounds)) return false;
  out.set((_bounds.minX + _bounds.maxX) * 0.5, (_bounds.minY + _bounds.maxY) * 0.5, (_bounds.minZ + _bounds.maxZ) * 0.5);
  return true;
}
