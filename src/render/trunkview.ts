import * as THREE from 'three';
import { createItemMesh } from './partmesh';
import type { Vehicle } from '../vehicle/vehicle';
import {
  TRUNK_CELL_COUNT,
  TRUNK_CELL_HEIGHT,
  TRUNK_COLUMNS,
  trunkCellLocal,
  trunkGridWidth,
  type TrunkViewState,
} from '../vehicle/trunk';
import type { WorldOrigin } from '../world/origin';
import type { WreckTrunk } from '../world/wrecktrunks';

const CELL_INSET = 0.9;
const ITEM_FIT = 0.68;
const ITEM_FORWARD = 0.045;
const CONDITION_PROGRAM_KEY = 'condition-rust-dirt-v1';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

/** World-space 4x2 trunk cells with real miniature item meshes and no labels. */
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
  private readonly posePosition = new THREE.Vector3();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly cellPosition = new THREE.Vector3();

  private itemSignature = '';
  private layoutSignature = '';

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'trunk-grid';
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

  update(
    view: TrunkViewState | null,
    vehicle: Vehicle | null,
    wreck: WreckTrunk | null,
    alpha: number,
    origin: WorldOrigin,
  ): void {
    if (!view) {
      this.root.visible = false;
      return;
    }

    let halfExtents: readonly [number, number, number];
    if (view.owner === 'car') {
      if (!vehicle) {
        this.root.visible = false;
        return;
      }
      halfExtents = vehicle.modelMeasure.halfExtents;
      vehicle.interpolatedTransform(alpha, this.posePosition, this.poseQuaternion);
    } else {
      if (!wreck) {
        this.root.visible = false;
        return;
      }
      halfExtents = wreck.halfExtents;
      this.posePosition.set(wreck.x - origin.x, wreck.y, wreck.z - origin.z);
      this.poseQuaternion.set(wreck.qx, wreck.qy, wreck.qz, wreck.qw);
    }

    this.root.visible = true;
    this.root.position.copy(this.posePosition);
    this.root.quaternion.copy(this.poseQuaternion);
    const layoutSignature = `${halfExtents[0]}|${halfExtents[1]}|${halfExtents[2]}`;
    if (layoutSignature !== this.layoutSignature) {
      this.layoutSignature = layoutSignature;
      this.layout(halfExtents);
      this.itemSignature = '';
    }

    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
      const selected = cell === view.selectedCell;
      this.panels[cell]!.material = selected ? this.selectedPanelMaterial : this.panelMaterial;
      this.borders[cell]!.material = selected ? this.selectedBorderMaterial : this.borderMaterial;
    }

    const itemSignature = view.cells.map((item) => item?.id ?? '').join('|');
    if (itemSignature !== this.itemSignature) {
      this.itemSignature = itemSignature;
      this.rebuildItems(view, halfExtents);
    }
  }

  private layout(halfExtents: readonly [number, number, number]): void {
    const cellWidth = trunkGridWidth(halfExtents[0]) / TRUNK_COLUMNS;
    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
      trunkCellLocal(cell, halfExtents, this.cellPosition);
      const panel = this.panels[cell]!;
      panel.position.copy(this.cellPosition);
      panel.scale.set(cellWidth * CELL_INSET, TRUNK_CELL_HEIGHT * CELL_INSET, 1);
      const border = this.borders[cell]!;
      border.position.copy(this.cellPosition);
      border.position.z -= 0.002;
      border.scale.set(cellWidth * CELL_INSET, TRUNK_CELL_HEIGHT * CELL_INSET, 1);
    }
  }

  private rebuildItems(view: TrunkViewState, halfExtents: readonly [number, number, number]): void {
    this.clearItems();
    const cellWidth = trunkGridWidth(halfExtents[0]) / TRUNK_COLUMNS;
    const target = Math.min(cellWidth, TRUNK_CELL_HEIGHT) * ITEM_FIT;
    for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
      const item = view.cells[cell];
      if (!item) continue;
      const mesh = createItemMesh(item);
      mesh.rotation.set(-0.22, 0.52, 0.08);
      mesh.updateMatrixWorld(true);
      _box.setFromObject(mesh).getSize(_size);
      _box.getCenter(_centre);
      mesh.position.sub(_centre);
      const holder = new THREE.Group();
      holder.add(mesh);
      const longest = Math.max(_size.x, _size.y, _size.z, 1e-4);
      holder.scale.setScalar(target / longest);
      trunkCellLocal(cell, halfExtents, holder.position);
      holder.position.z -= ITEM_FORWARD;
      this.itemHolders.push(holder);
      this.root.add(holder);
    }
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
      this.root.remove(holder);
    }
    this.itemHolders.length = 0;
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
