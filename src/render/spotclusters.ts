import * as THREE from 'three';
import {
  SPOT_CLUSTER_MAX_LIGHTS,
  SPOT_CLUSTER_NEAR_M,
  SPOT_CLUSTER_SLICES,
  SPOT_CLUSTER_SLICES_PER_OCTAVE,
  SPOT_CLUSTER_TILES_X,
  SPOT_CLUSTER_TILES_Y,
  SPOT_LIGHT_LIVE_MIN,
  spotClusterGrid,
  spotClusterMap,
} from './lightshader';

/**
 * The CPU half of the clustered spot loop (render/lightshader.ts `installClusteredSpotLoop`):
 * before the scene pass draws, each live clustered beam is tested against every cell of
 * the camera's frustum grid it could touch, and the cell's word gets the beam's bit.
 *
 * The test is render/vehiclelights.ts `spotReaches` on the cell's bounding sphere, done in
 * view space: exact where three's light is exactly zero (out of `distance`, outside the
 * OUTER cone, behind the lamp), conservative everywhere else. A cell is the frustum between
 * a tile's pixel edges (widened by a pixel) and a slice's depth edges (widened by a tenth
 * of a per cent), so a fragment always falls inside the cell its shader reads.
 *
 * The grid is only switched on for the game's own scene pass and camera (core/renderer.ts
 * `drawFrame`) and off again after it: a mirror, the ending or a photograph from another
 * camera reads `spotClusterGrid.x` 0 and shades every clustered slot. It also stays off
 * for a frame in which the bits cannot be trusted: a spotlight in the scene that is not
 * one of `lights` (bits would name the wrong slot), a beam with no range, or one that
 * reaches past the last slice.
 */
const FAR_M = SPOT_CLUSTER_NEAR_M * 2 ** (SPOT_CLUSTER_SLICES / SPOT_CLUSTER_SLICES_PER_OCTAVE);
const CELLS = SPOT_CLUSTER_TILES_X * SPOT_CLUSTER_TILES_Y * SPOT_CLUSTER_SLICES;
/** A slice's depth edges are widened by this share each way. */
const DEPTH_MARGIN = 1e-3;

function sliceOf(depth: number): number {
  return Math.floor(Math.log2(depth / SPOT_CLUSTER_NEAR_M) * SPOT_CLUSTER_SLICES_PER_OCTAVE);
}

export class SpotClusterPass {
  /** Per cell, view space: centre x, y, z and radius. */
  private readonly cells = new Float64Array(CELLS * 4);
  private readonly words = spotClusterMap.image.data as Uint32Array;
  private cellKey = '';
  private readonly lightView = new THREE.Vector3();
  private readonly targetView = new THREE.Vector3();
  /** Whether the last `begin` left a clustered slot to shade: one lit, or bits untrusted. */
  private lit = false;
  /** Milliseconds the last `begin` spent, for the dev frame report. */
  lastBuildMs = 0;

  /**
   * @param lights the clustered spotlights in three's order: bit `b` is `lights[b]`, the
   *   shader's spot `SPOT_FIXED_LIGHTS + b`.
   * @param trusted whether `lights` are the only clustered spotlights the scene draws.
   */
  constructor(
    private readonly lights: readonly THREE.SpotLight[],
    private readonly trusted: () => boolean,
  ) {
    if (lights.length > SPOT_CLUSTER_MAX_LIGHTS) {
      throw new Error(`${lights.length} clustered spotlights; a cell word names ${SPOT_CLUSTER_MAX_LIGHTS}`);
    }
  }

  /** Builds the grid for `camera` drawing into a `width` x `height` target and switches it on. */
  begin(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const started = performance.now();
    const state = this.build(camera, width, height);
    if (state === 'on') {
      spotClusterGrid[0] = SPOT_CLUSTER_TILES_X / width;
      spotClusterGrid[1] = SPOT_CLUSTER_TILES_Y / height;
      spotClusterGrid[2] = SPOT_CLUSTER_SLICES_PER_OCTAVE;
      spotClusterGrid[3] = -Math.log2(SPOT_CLUSTER_NEAR_M) * SPOT_CLUSTER_SLICES_PER_OCTAVE;
    } else {
      spotClusterGrid[0] = state === 'dark' ? -1 : 0;
    }
    this.lit = state !== 'dark';
    this.lastBuildMs = performance.now() - started;
  }

  /**
   * For another camera on the same scene and frame (a live mirror): no grid, so every
   * clustered slot, or none at all when the last `begin` found none lit.
   */
  beginOther(): void {
    spotClusterGrid[0] = this.lit ? 0 : -1;
  }

  /** Switches the grid off: every other pass shades every clustered slot. */
  end(): void {
    spotClusterGrid[0] = 0;
  }

  /**
   * Fills and uploads the words. @returns `on` with the grid built, `dark` when no
   * clustered beam is lit (nothing to upload), `off` when the bits cannot be trusted.
   */
  private build(camera: THREE.PerspectiveCamera, width: number, height: number): 'on' | 'dark' | 'off' {
    if (!(width > 0 && height > 0) || !this.trusted()) return 'off';
    const view = camera.matrixWorldInverse;
    const words = this.words;
    let cellsReady = false;
    let any = false;
    for (let b = 0; b < this.lights.length; b++) {
      const light = this.lights[b];
      const color = light.color;
      if (!(Math.max(color.r, color.g, color.b) * light.intensity >= SPOT_LIGHT_LIVE_MIN)) continue;
      const range = light.distance;
      if (!(range > 0)) return 'off';
      const p = this.lightView.copy(light.position).applyMatrix4(view);
      if (p.length() + range > FAR_M) return 'off';
      if (!cellsReady) {
        this.ensureCells(camera, width, height);
        words.fill(0);
        cellsReady = true;
      }
      any = true;
      const t = this.targetView.copy(light.target.position).applyMatrix4(view);
      let ax = t.x - p.x;
      let ay = t.y - p.y;
      let az = t.z - p.z;
      const axisLength = Math.hypot(ax, ay, az);
      const omni = !(axisLength > 1e-6) || !(light.angle < Math.PI / 2);
      const cosA = Math.cos(light.angle);
      const sinA = Math.sin(light.angle);
      if (!omni) {
        ax /= axisLength;
        ay /= axisLength;
        az /= axisLength;
      }
      // The lit volume (a sector of the range sphere) inside one ball: through the apex
      // and the cap's rim when that is the smaller, else the range sphere itself.
      let cx = p.x;
      let cy = p.y;
      let cz = p.z;
      let rho = range;
      if (!omni) {
        const h = range / (2 * cosA);
        if (h < range) {
          cx += ax * h;
          cy += ay * h;
          cz += az * h;
          rho = h;
        }
      }
      const dMax = -cz + rho;
      if (dMax <= 0) continue;
      const dMin = -cz - rho;
      const s0 = dMin <= SPOT_CLUSTER_NEAR_M ? 0 : Math.min(SPOT_CLUSTER_SLICES - 1, Math.max(0, sliceOf(dMin)));
      const s1 = Math.min(SPOT_CLUSTER_SLICES - 1, Math.max(0, sliceOf(dMax)));
      let tx0 = 0;
      let tx1 = SPOT_CLUSTER_TILES_X - 1;
      let ty0 = 0;
      let ty1 = SPOT_CLUSTER_TILES_Y - 1;
      if (dMin > camera.near) {
        // The ball's screen extent, from its view-space box at both depth ends.
        const e = camera.projectionMatrix.elements;
        const x0 = cx - rho;
        const x1 = cx + rho;
        const y0 = cy - rho;
        const y1 = cy + rho;
        const ndcX0 = Math.min(x0 / dMin, x0 / dMax) * e[0] - e[8];
        const ndcX1 = Math.max(x1 / dMin, x1 / dMax) * e[0] - e[8];
        const ndcY0 = Math.min(y0 / dMin, y0 / dMax) * e[5] - e[9];
        const ndcY1 = Math.max(y1 / dMin, y1 / dMax) * e[5] - e[9];
        tx0 = Math.max(0, Math.floor((ndcX0 + 1) * 0.5 * SPOT_CLUSTER_TILES_X - 1e-3));
        tx1 = Math.min(SPOT_CLUSTER_TILES_X - 1, Math.floor((ndcX1 + 1) * 0.5 * SPOT_CLUSTER_TILES_X + 1e-3));
        ty0 = Math.max(0, Math.floor((ndcY0 + 1) * 0.5 * SPOT_CLUSTER_TILES_Y - 1e-3));
        ty1 = Math.min(SPOT_CLUSTER_TILES_Y - 1, Math.floor((ndcY1 + 1) * 0.5 * SPOT_CLUSTER_TILES_Y + 1e-3));
        if (tx0 > tx1 || ty0 > ty1) continue;
      }
      const bit = 1 << b;
      const reach = range;
      const cells = this.cells;
      for (let s = s0; s <= s1; s++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          const row = (s * SPOT_CLUSTER_TILES_Y + ty) * SPOT_CLUSTER_TILES_X;
          for (let tx = tx0; tx <= tx1; tx++) {
            const index = row + tx;
            const o = index * 4;
            const r = cells[o + 3];
            const dx = cells[o] - p.x;
            const dy = cells[o + 1] - p.y;
            const dz = cells[o + 2] - p.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq > r * r) {
              const far = reach + r;
              if (distanceSq > far * far) continue;
              if (!omni) {
                const along = dx * ax + dy * ay + dz * az;
                if (along < -r) continue;
                const across = Math.sqrt(Math.max(0, distanceSq - along * along));
                if (cosA * across - sinA * along > r) continue;
              }
            }
            words[index] |= bit;
          }
        }
      }
    }
    if (!any) return 'dark';
    spotClusterMap.needsUpdate = true;
    return 'on';
  }

  /** The cells' bounding spheres for this projection and target size; kept until either changes. */
  private ensureCells(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const e = camera.projectionMatrix.elements;
    const key = `${e[0]},${e[5]},${e[8]},${e[9]},${camera.near},${width},${height}`;
    if (key === this.cellKey) return;
    this.cellKey = key;
    // On the view plane z = -1 a point at NDC (x, y) is ((x + e8) / e0, (y + e9) / e5).
    const marginX = 2 / width;
    const marginY = 2 / height;
    const cells = this.cells;
    for (let s = 0; s < SPOT_CLUSTER_SLICES; s++) {
      const near = s === 0
        ? Math.min(camera.near, SPOT_CLUSTER_NEAR_M)
        : SPOT_CLUSTER_NEAR_M * 2 ** (s / SPOT_CLUSTER_SLICES_PER_OCTAVE);
      const d0 = near * (1 - DEPTH_MARGIN);
      const d1 = SPOT_CLUSTER_NEAR_M * 2 ** ((s + 1) / SPOT_CLUSTER_SLICES_PER_OCTAVE) * (1 + DEPTH_MARGIN);
      for (let ty = 0; ty < SPOT_CLUSTER_TILES_Y; ty++) {
        const y0 = (-1 + (2 * ty) / SPOT_CLUSTER_TILES_Y - marginY + e[9]) / e[5];
        const y1 = (-1 + (2 * (ty + 1)) / SPOT_CLUSTER_TILES_Y + marginY + e[9]) / e[5];
        for (let tx = 0; tx < SPOT_CLUSTER_TILES_X; tx++) {
          const x0 = (-1 + (2 * tx) / SPOT_CLUSTER_TILES_X - marginX + e[8]) / e[0];
          const x1 = (-1 + (2 * (tx + 1)) / SPOT_CLUSTER_TILES_X + marginX + e[8]) / e[0];
          // Centre: the mean of the eight corners; radius: the farthest corner.
          const sx = (x0 + x1) * 0.5;
          const sy = (y0 + y1) * 0.5;
          const cx = sx * (d0 + d1) * 0.5;
          const cy = sy * (d0 + d1) * 0.5;
          const cz = -(d0 + d1) * 0.5;
          let radiusSq = 0;
          for (let corner = 0; corner < 8; corner++) {
            const d = corner & 4 ? d1 : d0;
            const qx = (corner & 1 ? x1 : x0) * d - cx;
            const qy = (corner & 2 ? y1 : y0) * d - cy;
            const qz = -d - cz;
            radiusSq = Math.max(radiusSq, qx * qx + qy * qy + qz * qz);
          }
          const o = ((s * SPOT_CLUSTER_TILES_Y + ty) * SPOT_CLUSTER_TILES_X + tx) * 4;
          cells[o] = cx;
          cells[o + 1] = cy;
          cells[o + 2] = cz;
          cells[o + 3] = Math.sqrt(radiusSq) * (1 + 1e-6) + 1e-6;
        }
      }
    }
  }
}
