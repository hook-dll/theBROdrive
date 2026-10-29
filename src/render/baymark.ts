import * as THREE from 'three';
import { fitGround } from '../world/footprint';
import { PAINT_PROUD, type ParkingSlot } from '../world/haulbay';
import type { Terrain } from '../world/terrain';
import { SELECTED_BORDER_COLOR, SELECTED_CELL_COLOR, SELECTED_CELL_OPACITY } from './trunkview';

/** The mark's cells: this many across a slot, and along it as near square as the depth allows. */
const MARK_COLS = 4;
/** Each cell's outline this share of its pitch, the gaps between them the grid's lines (trunkview.ts `CELL_INSET`). */
const MARK_INSET = 0.9;
/** A cell's outline, m wide. */
const MARK_LINE_W = 0.045;
/**
 * The mark's height over the fitted ground, m: over the white paint's top (world/haulbay.ts
 * `PAINT_PROUD`) by a little, so neither the asphalt nor the lines fight it; the fit's own
 * residual on top.
 */
const MARK_LIFT = PAINT_PROUD + 0.025;
/** The panels are fainter than the boot's selected cell: a tint on the asphalt, not a sheet over it. */
const MARK_PANEL_OPACITY = SELECTED_CELL_OPACITY * 0.5;
const MARK_BORDER_OPACITY = 0.75;

/**
 * THE MARK ON A HAND-IN SLOT (contracts/haulbays.ts `markedSlots`): a grid of pink cells on
 * the ground over the slot a taken haul is bound for, in the boot and bonnet grids'
 * selected-cell look (render/trunkview.ts): a faint pink panel per cell inside a light pink
 * outline, unlit and translucent, so it tints the asphalt and is no lamp of its own. It
 * lies `MARK_LIFT` over the ground fitted under the slot (the paint's own `fitGround`),
 * drawn without writing depth and pulled forward by a polygon offset: no fight with the
 * asphalt or the lines, and a car standing in the slot still hides it.
 *
 * Both materials share the trunk grid's panel program (MeshBasic, transparent, both
 * sides); the hidden anchor built with the mark keeps it linked from the boot
 * (.omp/rules/shader-variants.md).
 */
export class BayMark {
  private readonly root = new THREE.Group();
  private readonly panelMaterial = new THREE.MeshBasicMaterial({
    color: SELECTED_CELL_COLOR,
    transparent: true,
    opacity: MARK_PANEL_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly borderMaterial = new THREE.MeshBasicMaterial({
    color: SELECTED_BORDER_COLOR,
    transparent: true,
    opacity: MARK_BORDER_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly anchorGeometry = new THREE.BufferGeometry();
  /** Each marked slot's grid, built once while it stays marked. */
  private readonly marks = new Map<ParkingSlot, THREE.Group>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.root.name = 'bay-mark';
    const anchor = new THREE.Group();
    anchor.visible = false;
    this.anchorGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
    anchor.add(new THREE.Mesh(this.anchorGeometry, this.panelMaterial), new THREE.Mesh(this.anchorGeometry, this.borderMaterial));
    this.root.add(anchor);
    scene.add(this.root);
  }

  /** Shows `slots` marked and no other, placed for the floating origin at (`originX`, `originZ`). */
  update(slots: readonly ParkingSlot[], originX: number, originZ: number): void {
    for (const [slot, mark] of this.marks) {
      if (slots.includes(slot)) continue;
      this.root.remove(mark);
      for (const child of mark.children) (child as THREE.Mesh).geometry.dispose();
      this.marks.delete(slot);
    }
    for (const slot of slots) {
      let mark = this.marks.get(slot);
      if (!mark) {
        mark = this.build(slot);
        this.marks.set(slot, mark);
        this.root.add(mark);
      }
      mark.position.set(slot.x - originX, 0, slot.z - originZ);
    }
  }

  /** One slot's grid in its own frame (X across, +Z out of the opening), heights on the fitted ground. */
  private build(slot: ParkingSlot): THREE.Group {
    const w = slot.halfWidth;
    const d = slot.halfDepth;
    const plane = fitGround(this.terrain, slot.x, slot.z, slot.yaw, w, d, slot.s);
    const lift = MARK_LIFT + plane.residual;
    const rows = Math.max(1, Math.round((MARK_COLS * d) / w));
    const pitchX = (2 * w) / MARK_COLS;
    const pitchZ = (2 * d) / rows;
    const panels: number[] = [];
    const borders: number[] = [];
    // A quad on the ground from (x0, z0) to (x1, z1), two triangles.
    const quad = (out: number[], x0: number, z0: number, x1: number, z1: number): void => {
      const y00 = plane.yAt(x0, z0) + lift;
      const y10 = plane.yAt(x1, z0) + lift;
      const y11 = plane.yAt(x1, z1) + lift;
      const y01 = plane.yAt(x0, z1) + lift;
      out.push(x0, y00, z0, x1, y11, z1, x1, y10, z0, x0, y00, z0, x0, y01, z1, x1, y11, z1);
    };
    const hx = (pitchX * MARK_INSET) / 2;
    const hz = (pitchZ * MARK_INSET) / 2;
    const l = MARK_LINE_W;
    for (let i = 0; i < MARK_COLS; i++) {
      for (let j = 0; j < rows; j++) {
        const cx = -w + (i + 0.5) * pitchX;
        const cz = -d + (j + 0.5) * pitchZ;
        quad(panels, cx - hx + l, cz - hz + l, cx + hx - l, cz + hz - l);
        quad(borders, cx - hx, cz - hz, cx + hx, cz - hz + l);
        quad(borders, cx - hx, cz + hz - l, cx + hx, cz + hz);
        quad(borders, cx - hx, cz - hz + l, cx - hx + l, cz + hz - l);
        quad(borders, cx + hx - l, cz - hz + l, cx + hx, cz + hz - l);
      }
    }
    const mesh = (positions: number[], material: THREE.Material, order: number): THREE.Mesh => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();
      const m = new THREE.Mesh(geometry, material);
      m.renderOrder = order;
      return m;
    };
    const mark = new THREE.Group();
    mark.name = 'bay-mark-slot';
    mark.rotation.y = slot.yaw;
    mark.add(mesh(panels, this.panelMaterial, 4), mesh(borders, this.borderMaterial, 5));
    return mark;
  }

  dispose(): void {
    this.update([], 0, 0);
    this.scene.remove(this.root);
    this.anchorGeometry.dispose();
    this.panelMaterial.dispose();
    this.borderMaterial.dispose();
  }
}
