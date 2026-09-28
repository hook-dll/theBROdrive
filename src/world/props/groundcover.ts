import * as THREE from 'three';
import type { Impactor } from '../debris';
import type { WorldOrigin } from '../origin';
import type { WheelSpray } from '../../render/wheelspray';

/**
 * Ground cover the car bursts through: tufts, shrubs and rosettes go up in a puff of
 * dust and are gone, and the car barely notices — the tumbleweed's contract, for
 * thousands of props instead of four.
 *
 * NO RAPIER. A collider per tuft is thousands of broad-phase entries for something
 * that must not push back, and a sensor still pays the broad phase. Instead each chunk
 * hands over a flat list of discs in absolute XZ, bucketed once into a uniform grid
 * over the chunk's bounds (CSR arrays, built at chunk build). Per fixed step the field
 * rejects every chunk on its bounds, then reads the handful of cells under the car's
 * footprint and runs the same OBB-against-disc test the tumbleweed uses. Nothing here
 * allocates after a chunk is added.
 *
 * A burst prop stays gone for the session (by cell id), so driving back past the same
 * track after the chunk rebuilds does not regrow it. It is not saved: ground cover is
 * decoration, and a save that remembered every tuft the car ever touched would grow
 * without bound.
 */

/** Grid cell, metres. Larger than any cover disc, small enough that a car reads ~4. */
const GRID_CELL = 6;
/** Height band, relative to a prop's ground, the car's centre must be inside to hit it. */
const HIT_BELOW = -1;
const HIT_ABOVE = 2.6;
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** One prop, as the scatter hands it over. Positions are absolute world metres. */
export interface GroundCoverSpot {
  readonly id: number;
  readonly x: number;
  readonly groundY: number;
  readonly z: number;
  /** Hit radius, metres: the visible footprint, not the form's bounding sphere. */
  readonly radius: number;
  readonly mesh: THREE.InstancedMesh;
  readonly instance: number;
  /** Its contact shadow, when it has one. */
  readonly shadow: THREE.InstancedMesh | null;
  readonly shadowInstance: number;
}

/** A chunk's cover, bucketed. Returned by `add` so the owner can `forget` exactly it. */
export interface GroundCoverHandle {
  readonly spots: readonly GroundCoverSpot[];
  readonly burst: Uint8Array;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly cols: number;
  readonly rows: number;
  /** Spot indices by cell: cell c holds `items[cellStart[c] .. cellStart[c + 1])`. */
  readonly cellStart: Int32Array;
  readonly items: Int32Array;
}

export class GroundCoverField {
  private readonly chunks: GroundCoverHandle[] = [];
  private readonly broken = new Set<number>();

  constructor(
    private readonly spray: WheelSpray,
    private readonly origin: WorldOrigin,
  ) {}

  /** Whether this cell's prop was burst earlier in the session. */
  isBroken(id: number): boolean {
    return this.broken.has(id);
  }

  add(spots: readonly GroundCoverSpot[]): GroundCoverHandle | null {
    if (spots.length === 0) return null;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const s of spots) {
      if (s.x - s.radius < minX) minX = s.x - s.radius;
      if (s.z - s.radius < minZ) minZ = s.z - s.radius;
      if (s.x + s.radius > maxX) maxX = s.x + s.radius;
      if (s.z + s.radius > maxZ) maxZ = s.z + s.radius;
    }
    const cols = Math.max(1, Math.ceil((maxX - minX) / GRID_CELL));
    const rows = Math.max(1, Math.ceil((maxZ - minZ) / GRID_CELL));
    const cellOf = new Int32Array(spots.length);
    const cellStart = new Int32Array(cols * rows + 1);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const cx = Math.min(cols - 1, Math.floor((s.x - minX) / GRID_CELL));
      const cz = Math.min(rows - 1, Math.floor((s.z - minZ) / GRID_CELL));
      const c = cz * cols + cx;
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < cols * rows; c++) cellStart[c + 1] += cellStart[c];
    const fill = cellStart.slice(0, cols * rows);
    const items = new Int32Array(spots.length);
    for (let i = 0; i < spots.length; i++) items[fill[cellOf[i]]++] = i;
    const handle: GroundCoverHandle = {
      spots,
      burst: new Uint8Array(spots.length),
      minX,
      minZ,
      maxX,
      maxZ,
      cols,
      rows,
      cellStart,
      items,
    };
    this.chunks.push(handle);
    return handle;
  }

  forget(handle: GroundCoverHandle | null): void {
    if (!handle) return;
    const i = this.chunks.indexOf(handle);
    if (i < 0) return;
    this.chunks[i] = this.chunks[this.chunks.length - 1]!;
    this.chunks.pop();
  }

  /** Bursts whatever the car's footprint covers this step; returns how many. */
  update(car: Impactor): number {
    const reach = Math.hypot(car.halfLength, car.halfWidth) + 1;
    const speed = Math.hypot(car.vx, car.vz);
    let hits = 0;
    for (let k = 0; k < this.chunks.length; k++) {
      const h = this.chunks[k]!;
      if (car.x + reach < h.minX || car.x - reach > h.maxX) continue;
      if (car.z + reach < h.minZ || car.z - reach > h.maxZ) continue;
      const cx0 = Math.max(0, Math.floor((car.x - reach - h.minX) / GRID_CELL));
      const cx1 = Math.min(h.cols - 1, Math.floor((car.x + reach - h.minX) / GRID_CELL));
      const cz0 = Math.max(0, Math.floor((car.z - reach - h.minZ) / GRID_CELL));
      const cz1 = Math.min(h.rows - 1, Math.floor((car.z + reach - h.minZ) / GRID_CELL));
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cz * h.cols + cx;
          for (let j = h.cellStart[c]; j < h.cellStart[c + 1]; j++) {
            const i = h.items[j];
            if (h.burst[i]) continue;
            const s = h.spots[i]!;
            if (!this.touches(s, car)) continue;
            h.burst[i] = 1;
            this.broken.add(s.id);
            s.mesh.setMatrixAt(s.instance, ZERO_MATRIX);
            s.mesh.instanceMatrix.needsUpdate = true;
            if (s.shadow) {
              s.shadow.setMatrixAt(s.shadowInstance, ZERO_MATRIX);
              s.shadow.instanceMatrix.needsUpdate = true;
            }
            this.spray.emitBurst(
              s.x - this.origin.x,
              s.groundY + 0.05,
              s.z - this.origin.z,
              car.fx,
              car.fz,
              speed,
            );
            hits++;
          }
        }
      }
    }
    return hits;
  }

  /** The car's flat footprint (an OBB) against the prop's disc, inside a height band. */
  private touches(s: GroundCoverSpot, car: Impactor): boolean {
    const dy = car.y - s.groundY;
    if (dy < HIT_BELOW || dy > HIT_ABOVE) return false;
    const dx = s.x - car.x;
    const dz = s.z - car.z;
    const localX = dx * car.fz - dz * car.fx;
    const localZ = dx * car.fx + dz * car.fz;
    const edgeX = Math.max(0, Math.abs(localX) - car.halfWidth);
    const edgeZ = Math.max(0, Math.abs(localZ) - car.halfLength);
    return edgeX * edgeX + edgeZ * edgeZ <= s.radius * s.radius;
  }
}
