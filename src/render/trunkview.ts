import * as THREE from 'three';
import { createItemMesh, disposeItemMeshResources, setPocketWatchState } from './partmesh';
import { setPartCondition } from './materials';
import { isBrokenThing, type Item } from '../items/items';
import type { Vehicle } from '../vehicle/vehicle';
import {
  bootFootprint,
  bootOwner,
  storageLayout,
  TRUNK_MAX_CELL_COUNT,
  type FixedGridView,
  type GridLayout,
  type StorageGridShape,
  type TrunkViewState,
} from '../vehicle/trunk';

const CELL_INSET = 0.9;
const ITEM_FIT = 0.68;
const ITEM_FORWARD = 0.045;
/**
 * A bonnet part fills its cell: it stands where the real one does, so it is drawn at
 * the size the room allows rather than as a thumbnail.
 */
const BONNET_ITEM_FIT = 0.92;
/** A bonnet cell's panel lies on the cell's floor, lifted off whatever is under it. */
const BONNET_PANEL_LIFT = 0.006;
/**
 * A bonnet cell's outline rides this far under the cell's top, not on its floor: down
 * there it lay under the part it frames and against the bay's dark floor, and the grid
 * could not be seen at all with the bonnet up. At the top it rings the opening the eye
 * looks down into.
 */
const BONNET_BORDER_DROP = 0.01;
const CONDITION_PROGRAM_KEY = 'condition-rust-dirt-v1';
/**
 * Display pose inside a holder whose +Z points at the eye (Euler XYZ). The generic
 * pose is the three-quarter view the trunk always showed from behind the car, now
 * kept for every viewpoint; flat items (photograph, pocket watch) and the boy's things
 * (their face: the TV's screen, the radio's dial) keep their authored +Z face
 * square-ish to the eye instead.
 */
const POSE_GENERIC = new THREE.Euler(0.22, 0.52 - Math.PI, 0.08);
const POSE_FLAT = new THREE.Euler(0.22, 0.52, 0.08);

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * World-space storage cells with real item meshes and no labels: the trunk's grid plane
 * behind the car, or the bonnet's cells lying in the engine bay at their parts' places.
 * One instance draws one grid at a time; a card machine's opening (world/cardmachine.ts)
 * is drawn by an instance of its own (`updateFixed`), in the same panels and the same
 * item poses, so it reads as the boot does.
 */
export class TrunkView {
  private readonly root = new THREE.Group();
  private readonly panelGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly borderGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
  ]);
  private readonly panelMaterial = new THREE.MeshBasicMaterial({
    color: 0x17120f,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly selectedPanelMaterial = new THREE.MeshBasicMaterial({
    color: 0xe58bb0,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Both borders share one program (transparent, as the plain one), so the first aimed
  // cell links nothing mid-drive: an opaque selected border was a program of its own.
  private readonly borderMaterial = new THREE.LineBasicMaterial({ color: 0xd9c8ad, transparent: true, opacity: 0.8 });
  private readonly selectedBorderMaterial = new THREE.LineBasicMaterial({ color: 0xffbad7, transparent: true, opacity: 1 });
  private readonly panels: THREE.Mesh[] = [];
  private readonly borders: THREE.LineLoop[] = [];
  private readonly itemHolders: THREE.Group[] = [];
  private readonly pocketWatches: THREE.Object3D[] = [];
  private readonly posePosition = new THREE.Vector3();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly cellPosition = new THREE.Vector3();
  private readonly cellSize = new THREE.Vector3();
  private readonly farPosition = new THREE.Vector3();
  private readonly farSize = new THREE.Vector3();

  private itemSignature = '';
  /** The car shape and side `carLayout` was built for; a change builds it again. */
  private carShape: StorageGridShape | null = null;
  private carSide: TrunkViewState['side'] | null = null;
  private carLayout: GridLayout | null = null;
  /** What the panels were last laid out for; any change lays them out again. */
  private laidFor: GridLayout | null = null;
  /** Which panels the last layout placed: a bonnet has fewer cells than the trunk. */
  private readonly laidOut: boolean[] = new Array<boolean>(TRUNK_MAX_CELL_COUNT).fill(false);

  constructor(private readonly scene: THREE.Scene, name = 'vehicle-storage-grid') {
    this.root.name = name;
    this.root.visible = false;
    for (let cell = 0; cell < TRUNK_MAX_CELL_COUNT; cell++) {
      const panel = new THREE.Mesh(this.panelGeometry, this.panelMaterial);
      panel.renderOrder = 4;
      const border = new THREE.LineLoop(this.borderGeometry, this.borderMaterial);
      border.renderOrder = 5;
      this.panels.push(panel);
      this.borders.push(border);
      this.root.add(panel, border);
    }
    scene.add(this.root);
  }

  /**
   * @param eye World-space camera position. Every trunk item turns inside its cell to
   *   face it, so the contents read the same from behind, beside or above the car; a
   *   bonnet part stands square in the bay, as the real one is bolted in.
   */
  update(
    view: TrunkViewState | null,
    vehicle: Vehicle | null,
    alpha: number,
    timeOfDay: number,
    dayFactor: number,
    eye: THREE.Vector3,
  ): void {
    if (!view || !vehicle) {
      this.root.visible = false;
      return;
    }

    const shape: StorageGridShape = vehicle.storageShape;
    vehicle.interpolatedTransform(alpha, this.posePosition, this.poseQuaternion);
    if (shape !== this.carShape || view.side !== this.carSide || !this.carLayout) {
      this.carShape = shape;
      this.carSide = view.side;
      this.carLayout = storageLayout(shape, view.side);
    }
    this.draw(this.carLayout, view.cells, view.selectedCell, timeOfDay, dayFactor, eye);
  }

  /**
   * A grid standing still in the world (a card machine's opening), or null to hide it.
   * `originX`/`originZ`: the floating origin its ABSOLUTE place is drawn against.
   */
  updateFixed(
    view: FixedGridView | null,
    originX: number,
    originZ: number,
    timeOfDay: number,
    dayFactor: number,
    eye: THREE.Vector3,
  ): void {
    if (!view) {
      this.root.visible = false;
      return;
    }
    this.posePosition.set(view.x - originX, view.y, view.z - originZ);
    this.poseQuaternion.setFromAxisAngle(UP, view.yaw);
    this.draw(view.layout, view.cells, view.selectedCell, timeOfDay, dayFactor, eye);
  }

  /** Draws `cells` laid out by `layout` at the pose in `posePosition`/`poseQuaternion`. */
  private draw(
    layout: GridLayout,
    cells: readonly (Item | null)[],
    selectedCell: number | null,
    timeOfDay: number,
    dayFactor: number,
    eye: THREE.Vector3,
  ): void {
    this.root.visible = true;
    this.root.position.copy(this.posePosition);
    this.root.quaternion.copy(this.poseQuaternion);
    if (layout !== this.laidFor) {
      this.laidFor = layout;
      this.layout(layout);
      this.itemSignature = '';
    }

    // A thing of several boot cells lights all of them when one is aimed at.
    const grid = layout.grid;
    const selectedOwner = grid && selectedCell !== null ? bootOwner(cells, grid, selectedCell) : -1;
    for (let cell = 0; cell < TRUNK_MAX_CELL_COUNT; cell++) {
      const visible = this.laidOut[cell]! && cell < cells.length;
      this.panels[cell]!.visible = visible;
      this.borders[cell]!.visible = visible;
      const selected = visible && (cell === selectedCell
        || (grid !== null && selectedOwner >= 0 && bootOwner(cells, grid, cell) === selectedOwner));
      this.panels[cell]!.material = selected ? this.selectedPanelMaterial : this.panelMaterial;
      this.borders[cell]!.material = selected ? this.selectedBorderMaterial : this.borderMaterial;
    }

    const itemSignature = cells.map((item) =>
      item?.type === 'part'
        ? `${item.id}:${item.part.destroyed ? 1 : 0}:${item.part.dirt}:${item.part.rust}`
        : `${item?.id ?? ''}${isBrokenThing(item) ? ':broken' : ''}`,
    ).join('|');
    if (itemSignature !== this.itemSignature) {
      this.itemSignature = itemSignature;
      this.rebuildItems(cells, layout);
    }
    for (const watch of this.pocketWatches) {
      setPocketWatchState(watch, timeOfDay, dayFactor);
    }
    if (grid === null) return;
    // `lookAt` resolves the parent's world transform itself, so a holder under the
    // tilted car still aims straight at the eye with world up kept up.
    this.root.updateMatrixWorld();
    for (const holder of this.itemHolders) holder.lookAt(eye);
  }

  /**
   * Places every cell's panel and border: upright in the grid's plane facing the player
   * (a boot behind the car, a machine's opening), or flat in a bonnet cell facing up out
   * of the bay, the panel on its floor and the outline round its top.
   */
  private layout(layout: GridLayout): void {
    const flat = layout.grid === null;
    for (let cell = 0; cell < TRUNK_MAX_CELL_COUNT; cell++) {
      const placed = cell < layout.count && layout.cellBox(cell, this.cellPosition, this.cellSize);
      this.laidOut[cell] = placed;
      if (!placed) continue;
      const panel = this.panels[cell]!;
      const border = this.borders[cell]!;
      if (flat) {
        border.position.copy(this.cellPosition);
        border.position.y += this.cellSize.y * 0.5 - BONNET_BORDER_DROP;
        border.rotation.set(-Math.PI / 2, 0, 0);
        border.scale.set(this.cellSize.x * CELL_INSET, this.cellSize.z * CELL_INSET, 1);
        this.cellPosition.y -= this.cellSize.y * 0.5 - BONNET_PANEL_LIFT;
        panel.position.copy(this.cellPosition);
        panel.rotation.set(-Math.PI / 2, 0, 0);
        panel.scale.set(this.cellSize.x * CELL_INSET, this.cellSize.z * CELL_INSET, 1);
      } else {
        panel.position.copy(this.cellPosition);
        panel.rotation.set(0, 0, 0);
        panel.scale.set(this.cellSize.x * CELL_INSET, this.cellSize.y * CELL_INSET, 1);
        border.position.copy(this.cellPosition);
        border.position.z -= 0.002;
        border.rotation.set(0, 0, 0);
        border.scale.set(this.cellSize.x * CELL_INSET, this.cellSize.y * CELL_INSET, 1);
      }
    }
  }

  private rebuildItems(cells: readonly (Item | null)[], layout: GridLayout): void {
    this.clearItems();
    const grid = layout.grid;
    for (let cell = 0; cell < cells.length; cell++) {
      const item = cells[cell];
      if (!item) continue;
      if (!layout.cellBox(cell, this.cellPosition, this.cellSize)) continue;
      // A thing of several boot cells is drawn once, across all of them: its anchor cell
      // (the top-left) joined with the far corner of its footprint. A grid without that
      // corner (a card machine's one cell) draws it in its one cell.
      const footprint = grid ? bootFootprint(item) : null;
      const far = grid !== null && footprint !== null && (footprint.columns > 1 || footprint.rows > 1)
        ? cell + (footprint.rows - 1) * grid.columns + footprint.columns - 1
        : -1;
      const spans = far >= 0 && layout.cellBox(far, this.farPosition, this.farSize);
      if (spans) {
        const minX = Math.min(this.cellPosition.x - this.cellSize.x / 2, this.farPosition.x - this.farSize.x / 2);
        const maxX = Math.max(this.cellPosition.x + this.cellSize.x / 2, this.farPosition.x + this.farSize.x / 2);
        const minY = Math.min(this.cellPosition.y - this.cellSize.y / 2, this.farPosition.y - this.farSize.y / 2);
        const maxY = Math.max(this.cellPosition.y + this.cellSize.y / 2, this.farPosition.y + this.farSize.y / 2);
        this.cellPosition.set((minX + maxX) / 2, (minY + maxY) / 2, this.cellPosition.z);
        this.cellSize.set(maxX - minX, maxY - minY, this.cellSize.z);
      }
      const mesh = createItemMesh(item);
      if (item.type === 'part') setPartCondition(mesh, item.part);
      const holder = new THREE.Group();
      holder.add(mesh);
      if (!grid) {
        this.fitToCell(mesh, holder);
      } else {
        const flat = item.type === 'photograph' || item.type === 'pocket_watch' || item.type === 'contract_cargo';
        mesh.rotation.copy(flat ? POSE_FLAT : POSE_GENERIC);
        if (item.type === 'pocket_watch') this.pocketWatches.push(mesh);
        _box.setFromObject(mesh).getSize(_size);
        _box.getCenter(_centre);
        mesh.position.sub(_centre);
        // One cell: the longest side to the cell's smaller one, as every item always was;
        // a span: as large as its width and height both allow.
        const scale = spans
          ? Math.min(this.cellSize.x / Math.max(_size.x, 1e-4), this.cellSize.y / Math.max(_size.y, 1e-4))
          : Math.min(this.cellSize.x, this.cellSize.y) / Math.max(_size.x, _size.y, _size.z, 1e-4);
        holder.scale.setScalar(scale * ITEM_FIT);
        holder.position.copy(this.cellPosition);
        holder.position.z -= ITEM_FORWARD;
      }
      this.itemHolders.push(holder);
      this.root.add(holder);
    }
  }

  /**
   * Stands a bonnet part on its cell's floor (`cellPosition`/`cellSize`, the cell's box),
   * as large as the room allows. It is turned square to the car whichever way round
   * fills the cell better, so a long engine lies along a long cell.
   */
  private fitToCell(mesh: THREE.Object3D, holder: THREE.Group): void {
    const size = this.cellSize;
    let bestScale = 0;
    let bestYaw = 0;
    for (const yaw of [0, Math.PI / 2]) {
      mesh.rotation.set(0, yaw, 0);
      _box.setFromObject(mesh).getSize(_size);
      const scale = Math.min(
        size.x / Math.max(_size.x, 1e-4),
        size.y / Math.max(_size.y, 1e-4),
        size.z / Math.max(_size.z, 1e-4),
      );
      if (scale > bestScale) {
        bestScale = scale;
        bestYaw = yaw;
      }
    }
    mesh.rotation.set(0, bestYaw, 0);
    _box.setFromObject(mesh);
    _box.getCenter(_centre);
    // Centred over the floor, its lowest point on it.
    mesh.position.x -= _centre.x;
    mesh.position.y -= _box.min.y;
    mesh.position.z -= _centre.z;
    const scale = bestScale * BONNET_ITEM_FIT;
    holder.scale.setScalar(scale);
    holder.position.copy(this.cellPosition);
    holder.position.y -= size.y * 0.5 - BONNET_PANEL_LIFT;
  }

  private clearItems(): void {
    for (const holder of this.itemHolders) {
      holder.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (material.customProgramCacheKey() === CONDITION_PROGRAM_KEY) material.dispose();
        }
      });
      disposeItemMeshResources(holder);
      this.root.remove(holder);
    }
    this.itemHolders.length = 0;
    this.pocketWatches.length = 0;
  }

  dispose(): void {
    this.clearItems();
    this.scene.remove(this.root);
    this.panelGeometry.dispose();
    this.borderGeometry.dispose();
    this.panelMaterial.dispose();
    this.selectedPanelMaterial.dispose();
    this.borderMaterial.dispose();
    this.selectedBorderMaterial.dispose();
  }
}
