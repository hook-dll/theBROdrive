import type * as THREE from 'three';
import type { Item } from '../items/items';

/** Every car and static wreck uses the same visible four-by-two trunk layout. */
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
export type StorageOwnerKind = 'car' | 'wreck';

/** Fixed-step trunk view handed from world interaction to the renderer. */
export interface TrunkViewState {
  readonly owner: StorageOwnerKind;
  readonly side: StorageSide;
  readonly id: string;
  readonly cells: readonly (Item | null)[];
  readonly selectedCell: number | null;
}

/** Width follows the body, capped so bus and truck cells stay small and readable. */
export function trunkGridWidth(halfWidth: number): number {
  return Math.min(TRUNK_GRID_MAX_WIDTH, halfWidth * TRUNK_GRID_BODY_FRACTION);
}

export function storageGridCentreY(halfHeight: number): number {
  return halfHeight * STORAGE_GRID_CENTRE_Y_FRACTION;
}

export function storageGridRows(side: StorageSide): number {
  return side === 'bonnet' ? 1 : TRUNK_ROWS;
}

/** Writes one cell centre in chassis-local space without allocating. */
export function storageCellLocal(
  cell: number,
  halfExtents: readonly [number, number, number],
  side: StorageSide,
  out: THREE.Vector3,
): THREE.Vector3 {
  const width = trunkGridWidth(halfExtents[0]);
  const cellWidth = width / TRUNK_COLUMNS;
  const column = cell % TRUNK_COLUMNS;
  const row = Math.floor(cell / TRUNK_COLUMNS);
  const rows = storageGridRows(side);
  out.set(
    (column - (TRUNK_COLUMNS - 1) * 0.5) * cellWidth,
    storageGridCentreY(halfExtents[1]) + ((rows - 1) * 0.5 - row) * TRUNK_CELL_HEIGHT,
    side === 'bonnet'
      ? halfExtents[2] + TRUNK_GRID_DEPTH
      : -halfExtents[2] - TRUNK_GRID_DEPTH,
  );
  return out;
}

export interface TrunkGridRayHit {
  cell: number;
  distance: number;
}

/**
 * Intersects a chassis-local aim ray with the exact rectangle drawn by a trunk
 * or bonnet visualizer. Cell selection and rendering therefore cannot drift.
 */
export function intersectStorageGrid(
  eye: THREE.Vector3,
  direction: THREE.Vector3,
  halfExtents: readonly [number, number, number],
  side: StorageSide,
  out: TrunkGridRayHit,
): boolean {
  if (Math.abs(direction.z) < 1e-5) return false;
  const planeZ = side === 'bonnet'
    ? halfExtents[2] + TRUNK_GRID_DEPTH
    : -halfExtents[2] - TRUNK_GRID_DEPTH;
  const distance = (planeZ - eye.z) / direction.z;
  if (distance <= 0) return false;

  const x = eye.x + direction.x * distance;
  const y = eye.y + direction.y * distance;
  const width = trunkGridWidth(halfExtents[0]);
  const rows = storageGridRows(side);
  const height = rows * TRUNK_CELL_HEIGHT;
  const centreY = storageGridCentreY(halfExtents[1]);
  if (x < -width * 0.5 || x > width * 0.5 || y < centreY - height * 0.5 || y > centreY + height * 0.5) {
    return false;
  }

  const column = Math.min(TRUNK_COLUMNS - 1, Math.floor(((x + width * 0.5) / width) * TRUNK_COLUMNS));
  const row = Math.min(rows - 1, Math.floor(((centreY + height * 0.5 - y) / height) * rows));
  out.cell = row * TRUNK_COLUMNS + column;
  out.distance = distance;
  return true;
}
