import type * as THREE from 'three';
import { contractThing, type Item } from '../items/items';
import { thingBootFootprint, type BootFootprint } from '../items/things';
import { BONNET_SLOT_COUNT } from './bonnet';

/**
 * A body's boot grid: `columns` across the car, `rows` up, as the player sees it from
 * behind (vehicle/carmodels.ts `CarModelDef.trunkGrid`, game-design2.md §13.6).
 */
export interface TrunkGrid {
  readonly columns: number;
  readonly rows: number;
}

/** The largest boot any body has (the UAZ-2206's 4×4): the renderer's panel pool. */
export const TRUNK_MAX_CELL_COUNT = 16;
export const TRUNK_CELL_HEIGHT = 0.26;
export const TRUNK_GRID_DEPTH = 0.06;

const TRUNK_GRID_MAX_WIDTH = 1.6;
const TRUNK_GRID_BODY_FRACTION = 1.65;
/** Raised from bumper height to just below an on-foot player's eye line. */
const STORAGE_GRID_CENTRE_Y_FRACTION = 0.55;
/** The grid's top edge stays this far down the body's half height: below the roof. */
const STORAGE_GRID_TOP_Y_FRACTION = 0.8;
/** The grid's bottom edge stays this far below the centre, at most: above the sill. */
const STORAGE_GRID_BOTTOM_Y_FRACTION = -0.35;

export function trunkCellCount(grid: TrunkGrid): number {
  return grid.columns * grid.rows;
}

// ---------------------------------------------------------------------------
// Boot occupancy
//
// A thing may take several cells of the grid (items/things.ts `BootFootprint`): it is
// stored ONCE, in its ANCHOR cell — the top-left of the cells it takes, as the player
// sees the grid — and every other cell it covers holds null. What covers a cell is
// derived from the anchors (`bootOwner`), never stored, so a save holds the boot as it
// always did and nothing can disagree with it. Nothing is turned.
// ---------------------------------------------------------------------------

const ONE_CELL: BootFootprint = { columns: 1, rows: 1 };

/** The cells `item` takes in a boot, or null when it never rides in one (a teddy, the carpet). */
export function bootFootprint(item: Item): BootFootprint | null {
  return item.type === 'contract_cargo' ? thingBootFootprint(contractThing(item)) : ONE_CELL;
}

/** True when `footprint` anchored at `anchor` lies inside the grid. */
function inGrid(grid: TrunkGrid, anchor: number, footprint: BootFootprint): boolean {
  if (anchor < 0 || anchor >= trunkCellCount(grid)) return false;
  return anchor % grid.columns + footprint.columns <= grid.columns
    && Math.floor(anchor / grid.columns) + footprint.rows <= grid.rows;
}

/** True when `footprint` anchored at `anchor` covers `cell`. */
function covers(grid: TrunkGrid, anchor: number, footprint: BootFootprint, cell: number): boolean {
  const dc = cell % grid.columns - anchor % grid.columns;
  const dr = Math.floor(cell / grid.columns) - Math.floor(anchor / grid.columns);
  return dc >= 0 && dc < footprint.columns && dr >= 0 && dr < footprint.rows;
}

/** The anchor of the item covering `cell`, or -1 when the cell is free. */
export function bootOwner(storage: readonly (Item | null)[], grid: TrunkGrid, cell: number): number {
  for (let anchor = 0; anchor < storage.length; anchor++) {
    const item = storage[anchor];
    if (item && covers(grid, anchor, bootFootprint(item) ?? ONE_CELL, cell)) return anchor;
  }
  return -1;
}

/** True when `footprint` fits at `anchor`: inside the grid, every cell it takes free. */
export function bootFits(
  storage: readonly (Item | null)[],
  grid: TrunkGrid,
  anchor: number,
  footprint: BootFootprint,
): boolean {
  if (!inGrid(grid, anchor, footprint)) return false;
  for (let r = 0; r < footprint.rows; r++) {
    for (let c = 0; c < footprint.columns; c++) {
      if (bootOwner(storage, grid, anchor + r * grid.columns + c) >= 0) return false;
    }
  }
  return true;
}

/**
 * Where a thing of `footprint` goes when the player aims at `cell`: the anchor of the
 * first placement covering that cell that fits, trying the cell itself as the top-left
 * first and then shifting left and up. -1 when none covering it fits.
 */
export function bootAnchorAt(
  storage: readonly (Item | null)[],
  grid: TrunkGrid,
  cell: number,
  footprint: BootFootprint,
): number {
  const column = cell % grid.columns;
  const row = Math.floor(cell / grid.columns);
  for (let dr = 0; dr < footprint.rows; dr++) {
    for (let dc = 0; dc < footprint.columns; dc++) {
      if (column - dc < 0 || row - dr < 0) continue;
      const anchor = cell - dr * grid.columns - dc;
      if (bootFits(storage, grid, anchor, footprint)) return anchor;
    }
  }
  return -1;
}

/** The first anchor anywhere in the boot where `footprint` fits, or -1. */
export function bootFreeAnchor(storage: readonly (Item | null)[], grid: TrunkGrid, footprint: BootFootprint): number {
  for (let anchor = 0; anchor < trunkCellCount(grid); anchor++) {
    if (bootFits(storage, grid, anchor, footprint)) return anchor;
  }
  return -1;
}

/** True when a grid is big enough for `footprint` at all, empty. */
export function bootHolds(grid: TrunkGrid, footprint: BootFootprint): boolean {
  return footprint.columns <= grid.columns && footprint.rows <= grid.rows;
}

/**
 * A boot read from a save, made sound: an item that does not fit at its anchor (out of
 * the grid, over another, or a thing that never rides in a boot) is dropped, earlier
 * anchors first. Cells are kept in place, not moved.
 */
export function normalizeBoot(storage: (Item | null)[], grid: TrunkGrid): void {
  const kept = storage.slice();
  storage.fill(null);
  for (let anchor = 0; anchor < kept.length; anchor++) {
    const item = kept[anchor];
    const footprint = item ? bootFootprint(item) : null;
    if (item && footprint && bootFits(storage, grid, anchor, footprint)) storage[anchor] = item;
  }
}

export type StorageSide = 'trunk' | 'bonnet';

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
  /** The body's boot grid. */
  readonly trunkGrid: TrunkGrid;
}

/** Fixed-step trunk view handed from world interaction to the renderer: one car's grid. */
export interface TrunkViewState {
  readonly side: StorageSide;
  /** The car's id. */
  readonly id: string;
  readonly cells: readonly (Item | null)[];
  readonly selectedCell: number | null;
}

/**
 * What a drawn grid is laid out by, in its root's frame (render/trunkview.ts): a car's
 * compartment (`storageLayout`), or a grid of its own standing still in the world — a
 * card machine's opening (world/cardmachine.ts `MACHINE_GRID_LAYOUT`).
 */
export interface GridLayout {
  readonly count: number;
  /**
   * The grid a thing takes cells of by its footprint (`bootOwner`), its cells upright
   * and facing -Z; null for a bonnet's cells, one part each, lying flat in their rooms.
   */
  readonly grid: TrunkGrid | null;
  /** Writes one cell's box centre and full size without allocating; false when there is no such cell. */
  cellBox(cell: number, centre: THREE.Vector3, size: THREE.Vector3): boolean;
}

/** A car's compartment as a `GridLayout`, chassis-local. Allocates: build it once per shape. */
export function storageLayout(shape: StorageGridShape, side: StorageSide): GridLayout {
  return {
    count: storageCellCount(shape, side),
    grid: side === 'trunk' ? shape.trunkGrid : null,
    cellBox: (cell, centre, size) => storageCellBox(cell, shape, side, centre, size),
  };
}

/**
 * A grid standing still in the world, handed to the renderer while it is worked: a card
 * machine's opening (world/cardmachine.ts), the boot's twin.
 */
export interface FixedGridView {
  readonly layout: GridLayout;
  /** What lies in it, by anchor cell (`bootOwner`). */
  readonly cells: readonly (Item | null)[];
  readonly selectedCell: number | null;
  /** ABSOLUTE metres of the layout's origin, and the yaw its -Z front is turned by. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * A kit body's lids over each compartment, by rig channel (carkit/kit.ts `shellMotion`):
 * the bonnet, and the boot lid or tailgate behind (either leaf of a split one), whichever
 * the body has. A compartment's grid is reached only with one of its lids open.
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

export function storageCellCount(shape: StorageGridShape, side: StorageSide): number {
  return side === 'bonnet' ? BONNET_SLOT_COUNT : trunkCellCount(shape.trunkGrid);
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
  const { columns, rows } = shape.trunkGrid;
  if (cell < 0 || cell >= columns * rows) return false;
  const half = shape.halfExtents;
  const cellWidth = trunkGridWidth(half[0]) / columns;
  // Tall grids shrink their cells to stay between the sill and the roof line.
  const top = half[1] * STORAGE_GRID_TOP_Y_FRACTION;
  const bottom = half[1] * STORAGE_GRID_BOTTOM_Y_FRACTION;
  const cellHeight = Math.min(TRUNK_CELL_HEIGHT, (top - bottom) / rows);
  const gridHalf = rows * cellHeight * 0.5;
  const centreY = Math.min(Math.max(half[1] * STORAGE_GRID_CENTRE_Y_FRACTION, bottom + gridHalf), top - gridHalf);
  const column = cell % columns;
  const row = Math.floor(cell / columns);
  const x = -(column - (columns - 1) * 0.5) * cellWidth;
  const y = centreY + ((rows - 1) * 0.5 - row) * cellHeight;
  out.minX = x - cellWidth * 0.5;
  out.maxX = x + cellWidth * 0.5;
  out.minY = y - cellHeight * 0.5;
  out.maxY = y + cellHeight * 0.5;
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
  const count = storageCellCount(shape, side);
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
 * the ray enters wins: the bonnet's cells stand at different heights in the bay — but
 * a smaller cell the ray enters while still inside a bigger one wins over it, so a part
 * standing in another's room (an air filter on the engine) can be aimed at.
 */
export function intersectStorageGrid(
  eye: THREE.Vector3,
  direction: THREE.Vector3,
  shape: StorageGridShape,
  side: StorageSide,
  out: TrunkGridRayHit,
): boolean {
  const count = storageCellCount(shape, side);
  _hits.length = 0;
  for (let cell = 0; cell < count; cell++) {
    if (!cellBounds(cell, shape, side, _cell)) continue;
    const near = rayBox(eye, direction, _cell);
    if (!(near < Infinity) || !(near > 0)) continue;
    const volume = (_cell.maxX - _cell.minX) * (_cell.maxY - _cell.minY) * (_cell.maxZ - _cell.minZ);
    _hits.push({ cell, near, far: slabFar, volume });
  }
  if (_hits.length === 0) return false;
  _hits.sort((a, b) => a.near - b.near);
  let pick = _hits[0]!;
  for (let i = 1; i < _hits.length; i++) {
    const hit = _hits[i]!;
    if (hit.near < pick.far && hit.volume < pick.volume) pick = hit;
  }
  out.cell = pick.cell;
  out.distance = pick.near;
  return true;
}

const _hits: { cell: number; near: number; far: number; volume: number }[] = [];

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
