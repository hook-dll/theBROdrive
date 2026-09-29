import * as THREE from 'three';
import { hash01 } from '../../core/rng';
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

// ---------------------------------------------------------------------------
// Density along the road
// ---------------------------------------------------------------------------
//
// A desert does not carpet every metre of a forty-thousand-kilometre road: runoff
// collects here, the wind scours there, and cover comes and goes in stretches longer
// than one look ahead. `groundCoverDensity` is that, as one pure function of the seed
// and a road arclength — the same shape as everything else in the world, so a chunk
// rebuilt out of order, or after a rebase, gets the identical answer.

const TAG_COVER_STRETCH = 0x7f6c0f;
/** Stretch length range, metres. Long enough that a sparse stretch is a place. */
const COVER_STRETCH_MIN = 300;
const COVER_STRETCH_MAX = 5000;
/**
 * Stretches come in complementary PAIRS: the two lengths of a pair sum to
 * `COVER_STRETCH_PAIR`, so a cycle of `COVER_STRETCH_PAIRS` pairs is exactly
 * `COVER_CYCLE` long however the rolls fall. Any chunk then finds its own stretch by
 * division and a couple of hashes, instead of walking the road from kilometre zero and
 * making chunk content depend on build order. `ROAD_HAZARD_CYCLE` in `scatter.ts` uses
 * the same trick for the same reason. Two pairs per 10.6 km cycle, so stretches run a
 * mean of 2.65 km and a cycle is short enough that the level mix below evens out
 * over a few tens of kilometres of driving.
 */
const COVER_STRETCH_PAIR = COVER_STRETCH_MIN + COVER_STRETCH_MAX;
const COVER_STRETCH_PAIRS = 2;
const COVER_STRETCHES_PER_CYCLE = COVER_STRETCH_PAIRS * 2;
const COVER_CYCLE = COVER_STRETCH_PAIR * COVER_STRETCH_PAIRS;
/**
 * The mix, as a share of ROAD LENGTH rather than of stretch count: level is drawn on
 * hash channels the lengths never touch, so length and level are independent and this
 * long run of a drive is the measured share. Two fifths of the road keeps exactly the
 * field that was signed off, a third drops to a scattering — enough tufts left that the
 * verge still reads as verge, which is why sparse has a floor rather than fading to
 * nothing — and the last quarter is bare sand, undisturbed by any prop at all.
 *
 * Measured by sampling the function every metre: over 200 km, 39% full / 38% thinned /
 * 23% bare (seed 1337) and 47 / 20 / 33 (seed 24601); over 2,000 km both seeds settle
 * at 39-41 / 35-37 / 24. Stretch lengths came out 372-4,928 m with a 2.65 km median,
 * and every thinned stretch between 0.11 and 0.35 of full. Because the draw is per
 * stretch, two stretches of the same kind can meet rather than always alternating: the
 * longest bare run in the 200 km above was 14.3 km (three bare stretches in a row).
 * That is the shape a desert has, and it is the knob to turn — lowering the bare share
 * shortens the dead ground far more than it thins anything else.
 */
const COVER_FULL_SHARE = 0.4;
const COVER_SPARSE_SHARE = 0.35;
const COVER_SPARSE_MIN = 0.1;
const COVER_SPARSE_MAX = 0.35;
/**
 * Metres a stretch takes to ramp in from the level of the one before it. The ramp is the
 * HEAD of the entering stretch, never a band across the boundary, so the far side of a
 * boundary is at full level immediately — and a bare stretch is genuinely bare for
 * everything past its first `COVER_RAMP_M`. Every stretch is longer than the ramp
 * (`COVER_STRETCH_MIN`), so no ramp is ever cut short by the next boundary and the
 * level never has a hard step: the transition is spread over 100 m, which at speed is
 * still gone in a couple of seconds and reads as cover thinning, not as a line.
 */
const COVER_RAMP_M = 100;

/** Length of one stretch of a cycle, metres. */
function coverStretchLength(seed: number, cycle: number, index: number): number {
  const first =
    COVER_STRETCH_MIN +
    hash01(seed, TAG_COVER_STRETCH, cycle, index >> 1) * (COVER_STRETCH_MAX - COVER_STRETCH_MIN);
  return (index & 1) === 0 ? first : COVER_STRETCH_PAIR - first;
}

/** One stretch's level: today's density, the sparse share of it, or nothing. */
function coverStretchLevel(seed: number, cycle: number, index: number): number {
  const roll = hash01(seed, TAG_COVER_STRETCH, cycle, index, 1);
  if (roll < COVER_FULL_SHARE) return 1;
  if (roll < COVER_FULL_SHARE + COVER_SPARSE_SHARE) {
    return (
      COVER_SPARSE_MIN +
      hash01(seed, TAG_COVER_STRETCH, cycle, index, 2) * (COVER_SPARSE_MAX - COVER_SPARSE_MIN)
    );
  }
  return 0;
}

/**
 * Share of the local ground-cover density at road arclength `s`, 0..1. Exactly 1 leaves
 * the field as it was, 0 leaves bare desert, and in between is a thinned field.
 *
 * `scatter.ts` multiplies its own verge/open-desert density by this and then throws the
 * candidate away when the SAME roll that got it this far fails against the product, so
 * the props that survive a sparse stretch are props of the full stretch in exactly the
 * places they always stood — nothing about the thinning reshuffles a position. It is
 * called only for candidates that already passed the unthinned density, and at ~28 M
 * calls/s that is microseconds per chunk build, which buys evaluating it at the
 * candidate's own arclength rather than at a quantised guess.
 */
export function groundCoverDensity(s: number, seed: number): number {
  const cycle = Math.floor(s / COVER_CYCLE);
  let within = s - cycle * COVER_CYCLE;
  let index = 0;
  // The lengths of one cycle sum to `COVER_CYCLE`, so the last stretch takes the
  // remainder rather than being walked to.
  while (index < COVER_STRETCHES_PER_CYCLE - 1) {
    const length = coverStretchLength(seed, cycle, index);
    if (within < length) break;
    within -= length;
    index++;
  }
  const level = coverStretchLevel(seed, cycle, index);
  if (within >= COVER_RAMP_M) return level;
  const previous =
    index === 0
      ? coverStretchLevel(seed, cycle - 1, COVER_STRETCHES_PER_CYCLE - 1)
      : coverStretchLevel(seed, cycle, index - 1);
  const w = within / COVER_RAMP_M;
  return previous + (level - previous) * w * w * (3 - 2 * w);
}
