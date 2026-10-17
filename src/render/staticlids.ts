/**
 * A roadside shell's lids (render/carmodel.ts `createStaticCarModel`): a kit body's bonnet
 * and boot lid or tailgate hung on their hinges as on the driven car, worked by the player
 * (player/interaction.ts) through the same rig channels and eased by `update`. Nothing
 * else on the shell moves. Its cabin, bay and boot (`inside`) draw only while a lid is off
 * its stop, so a shut shell costs what it did before it had lids.
 */

import type * as THREE from 'three';
import { KitRig, type KitControl } from '../carkit/rig';
import { storageLidSide, type StorageSide } from '../vehicle/trunk';

export class StaticCarLids {
  readonly rig: KitRig;
  /** Each lid's pose as last written into its pivot's matrix. */
  private readonly applied: number[];

  constructor(
    model: THREE.Object3D,
    /** Each lid's control, its channel the control's id; `pivots` in the same order. */
    readonly controls: readonly KitControl[],
    /** The lids' hinge nodes: what the eye ray is tested against to work one. */
    readonly pivots: readonly THREE.Object3D[],
    private readonly inside: THREE.Object3D,
  ) {
    this.rig = new KitRig(model, false);
    this.applied = controls.map(() => 0);
  }

  /** Whether the shell has a lid over `side`. */
  has(side: StorageSide): boolean {
    for (const control of this.controls) if (storageLidSide(control.id) === side) return true;
    return false;
  }

  /**
   * Eases the lids towards their targets. A shell built with its chunk has frozen
   * matrices (world/chunks.ts `freezeStaticSubtree`), so a pivot that moved recomposes
   * its own.
   */
  update(dt: number): void {
    this.rig.update(dt);
    let open = false;
    for (let i = 0; i < this.controls.length; i++) {
      const pose = this.rig.position(this.controls[i]!.id);
      if (pose > 0) open = true;
      if (pose === this.applied[i]) continue;
      this.applied[i] = pose;
      this.pivots[i]!.updateMatrix();
    }
    this.inside.visible = open;
  }
}
