/**
 * THE FAR ROAD: the mirror world's road, as one low-poly ribbon.
 *
 * A mirror never needs the near road's material detail — its skirt, shoulder, paint,
 * aggregate and per-chunk seams. It needs the same line on the ground, far enough that a
 * following car sits on something. This is the analogues of a car's far mesh: one mesh,
 * one material, one draw, following the road for `FAR_ROAD_BEHIND_M` behind and
 * `FAR_ROAD_AHEAD_M` ahead of the player, rebuilt only when the player has moved
 * `FAR_ROAD_REBUILD_M`.
 *
 * It lives on `FAR_WORLD_LAYER`, so the main camera never draws it; the mirror's world
 * camera enables the layer. The near road chunks are tagged `mirrorSkip` and hidden for
 * the mirror pass (roadmesh.ts), so the two never overlap. The road does not cast a
 * shadow, which is why replacing it cannot leave a shadow without its object.
 */

import * as THREE from 'three';
import type { Road } from '../world/road';
import { makeFlatMaterial } from './materials';

/** The layer of the world that only a mirror draws: the far road (and, later, far props). */
export const FAR_WORLD_LAYER = 4;

/** Metres between rows: enough for a curve at the size a mirror shows. */
const STEP_M = 12;
const BEHIND_M = 700;
const AHEAD_M = 700;
/** Rebuild once the player has moved this far; only a handful of times a kilometre. */
const REBUILD_M = 60;
const ROWS = Math.floor((BEHIND_M + AHEAD_M) / STEP_M) + 1;
const HALF_WIDTH_SLACK_M = 0.05;

const _right = { x: 0, y: 0, z: 0 };
const _left = { x: 0, y: 0, z: 0 };

export class FarRoad {
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly mesh: THREE.Mesh;
  private lastS = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  constructor(
    private readonly road: Road,
    scene: THREE.Scene,
  ) {
    this.positions = new Float32Array(ROWS * 2 * 3);
    const normals = new Float32Array(ROWS * 2 * 3);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const indices = new Uint32Array((ROWS - 1) * 6);
    for (let row = 0; row < ROWS - 1; row++) {
      const r0 = row * 2;
      const l0 = r0 + 1;
      const r1 = r0 + 2;
      const l1 = r0 + 3;
      const at = row * 6;
      indices[at] = r0;
      indices[at + 1] = l0;
      indices[at + 2] = r1;
      indices[at + 3] = l0;
      indices[at + 4] = l1;
      indices[at + 5] = r1;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.mesh = new THREE.Mesh(this.geometry, makeFlatMaterial(0x3d352d, 0.95));
    this.mesh.name = 'far-road';
    this.mesh.layers.set(FAR_WORLD_LAYER);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Public for the mirror pass: only the mirror shows it. */
  setVisible(on: boolean): void {
    this.mesh.visible = on;
  }

  /**
   * Follows the player along the road: `s` is the player's arclength, the origin the
   * floating origin the vertices are written in. A no-op until the player has moved
   * `REBUILD_M` or the origin rebased.
   */
  update(s: number, originX: number, originZ: number): void {
    if (
      Number.isFinite(this.lastS) &&
      Math.abs(s - this.lastS) < REBUILD_M &&
      originX === this.lastOriginX &&
      originZ === this.lastOriginZ
    ) {
      return;
    }
    this.lastS = s;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;
    const positions = this.positions;
    for (let row = 0; row < ROWS; row++) {
      const si = Math.min(Math.max(s - BEHIND_M + row * STEP_M, 0), this.road.length);
      const half = Math.max(0.1, this.road.halfWidthAt(si) + HALF_WIDTH_SLACK_M);
      this.road.offsetPoint(si, half, _right);
      this.road.offsetPoint(si, -half, _left);
      const at = row * 6;
      positions[at] = _right.x - originX;
      positions[at + 1] = _right.y;
      positions[at + 2] = _right.z - originZ;
      positions[at + 3] = _left.x - originX;
      positions[at + 4] = _left.y;
      positions[at + 5] = _left.z - originZ;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
  }
}
