import * as THREE from 'three';
import { createItemMesh, disposeItemMeshResources, setPocketWatchState } from './partmesh';
import { setPartCondition } from './materials';
import type { Vehicle } from '../vehicle/vehicle';
import {
  bonnetGridOnLid,
  storageCellBox,
  storageCellCount,
  TRUNK_CELL_COUNT,
  type StorageGridShape,
  type TrunkViewState,
} from '../vehicle/trunk';
import { carModelMeasure } from './carmodel';
import type { WorldOrigin } from '../world/origin';
import type { WreckTrunk } from '../world/wrecktrunks';
import type { CourierTrunk } from '../world/couriers';

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
 * kept for every viewpoint; flat items (photograph, pocket watch, postcard) keep their
 * authored +Z face square-ish to the eye instead.
 */
const POSE_GENERIC = new THREE.Euler(0.22, 0.52 - Math.PI, 0.08);
const POSE_FLAT = new THREE.Euler(0.22, 0.52, 0.08);

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

/**
 * World-space storage cells with real item meshes and no labels: the trunk's 4x2 plane
 * behind the car, or the bonnet's cells lying in the engine bay at their parts' places.
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
  private readonly borderMaterial = new THREE.LineBasicMaterial({ color: 0xd9c8ad, transparent: true, opacity: 0.8 });
  private readonly selectedBorderMaterial = new THREE.LineBasicMaterial({ color: 0xffbad7 });
  private readonly panels: THREE.Mesh[] = [];
  private readonly borders: THREE.LineLoop[] = [];
  private readonly itemHolders: THREE.Group[] = [];
  private readonly pocketWatches: THREE.Object3D[] = [];
  private readonly posePosition = new THREE.Vector3();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly cellPosition = new THREE.Vector3();
  private readonly cellSize = new THREE.Vector3();

  private itemSignature = '';
  /** What the panels were last laid out for; any change lays them out again. */
  private layoutShape: StorageGridShape | null = null;
  private layoutSide: TrunkViewState['side'] | null = null;
  private layoutOnLid = false;
  /** Which panels the last layout placed: a bonnet has fewer cells than the trunk. */
  private readonly laidOut: boolean[] = new Array<boolean>(TRUNK_CELL_COUNT).fill(false);

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'vehicle-storage-grid';
    this.root.visible = false;
    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
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
    fixed: WreckTrunk | CourierTrunk | null,
    alpha: number,
    origin: WorldOrigin,
    timeOfDay: number,
    dayFactor: number,
    eye: THREE.Vector3,
  ): void {
    if (!view) {
      this.root.visible = false;
      return;
    }

    let shape: StorageGridShape;
    if (view.owner === 'car') {
      if (!vehicle) {
        this.root.visible = false;
        return;
      }
      shape = vehicle.modelMeasure;
      vehicle.interpolatedTransform(alpha, this.posePosition, this.poseQuaternion);
    } else {
      if (!fixed) {
        this.root.visible = false;
        return;
      }
      // The shell's own model measure: it carries the bay's cells once the model has
      // loaded, which it has by the time the shell is drawn.
      shape = carModelMeasure(fixed.modelId);
      this.posePosition.set(fixed.x - origin.x, fixed.y, fixed.z - origin.z);
      this.poseQuaternion.set(fixed.qx, fixed.qy, fixed.qz, fixed.qw);
    }

    this.root.visible = true;
    this.root.position.copy(this.posePosition);
    this.root.quaternion.copy(this.poseQuaternion);
    const onLid = view.side === 'bonnet' && bonnetGridOnLid(view.owner);
    if (shape !== this.layoutShape || view.side !== this.layoutSide || onLid !== this.layoutOnLid) {
      this.layoutShape = shape;
      this.layoutSide = view.side;
      this.layoutOnLid = onLid;
      this.layout(shape, view.side, onLid);
      this.itemSignature = '';
    }

    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
      const visible = this.laidOut[cell]! && cell < view.cells.length;
      this.panels[cell]!.visible = visible;
      this.borders[cell]!.visible = visible;
      const selected = visible && cell === view.selectedCell;
      this.panels[cell]!.material = selected ? this.selectedPanelMaterial : this.panelMaterial;
      this.borders[cell]!.material = selected ? this.selectedBorderMaterial : this.borderMaterial;
    }

    const itemSignature = view.cells.map((item) =>
      item?.type === 'part'
        ? `${item.id}:${item.part.destroyed ? 1 : 0}:${item.part.dirt}:${item.part.rust}`
        : item?.id ?? '',
    ).join('|');
    if (itemSignature !== this.itemSignature) {
      this.itemSignature = itemSignature;
      this.rebuildItems(view, shape, onLid);
    }
    for (const watch of this.pocketWatches) {
      setPocketWatchState(watch, timeOfDay, dayFactor);
    }
    if (view.side === 'bonnet') return;
    // `lookAt` resolves the parent's world transform itself, so a holder under the
    // tilted car still aims straight at the eye with world up kept up.
    this.root.updateMatrixWorld();
    for (const holder of this.itemHolders) holder.lookAt(eye);
  }

  /**
   * Places every cell's panel and border: upright in the trunk's plane facing the
   * player behind the car, or flat in a bonnet cell facing up out of the bay, the panel
   * on its floor and the outline round its top.
   */
  private layout(shape: StorageGridShape, side: TrunkViewState['side'], onLid: boolean): void {
    const count = storageCellCount(side);
    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
      const placed = cell < count && storageCellBox(cell, shape, side, onLid, this.cellPosition, this.cellSize);
      this.laidOut[cell] = placed;
      if (!placed) continue;
      const panel = this.panels[cell]!;
      const border = this.borders[cell]!;
      if (side === 'bonnet') {
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

  private rebuildItems(view: TrunkViewState, shape: StorageGridShape, onLid: boolean): void {
    this.clearItems();
    const bonnet = view.side === 'bonnet';
    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
      const item = view.cells[cell];
      if (!item) continue;
      if (!storageCellBox(cell, shape, view.side, onLid, this.cellPosition, this.cellSize)) continue;
      const mesh = createItemMesh(item);
      if (item.type === 'part') setPartCondition(mesh, item.part);
      const holder = new THREE.Group();
      holder.add(mesh);
      if (bonnet) {
        this.fitToCell(mesh, holder);
      } else {
        const flat = item.type === 'photograph' || item.type === 'pocket_watch' || item.type === 'postcard';
        mesh.rotation.copy(flat ? POSE_FLAT : POSE_GENERIC);
        if (item.type === 'pocket_watch') this.pocketWatches.push(mesh);
        _box.setFromObject(mesh).getSize(_size);
        _box.getCenter(_centre);
        mesh.position.sub(_centre);
        const longest = Math.max(_size.x, _size.y, _size.z, 1e-4);
        holder.scale.setScalar((Math.min(this.cellSize.x, this.cellSize.y) * ITEM_FIT) / longest);
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
