import type { Road } from './road';
import { COARSE_SPACING } from './roadspine';

/**
 * How far any point in the world is from the nearest pass of the road, and which pass
 * that is.
 *
 * Two things need this and they need it to AGREE. The chunked terrain mesh needs it
 * because the berm and the mountains are functions of lateral distance, and because a
 * cell has to know which chunk owns it; the vista mesh needs it out to twenty-five
 * kilometres for the mountains alone. Answering it independently in two places is how a
 * seam appears: the same ground would get two distances and therefore two heights.
 *
 * Everything here is keyed on ABSOLUTE arclength or ABSOLUTE world lattice indices and
 * searched over the WHOLE road, never over a window. That is the load-bearing property.
 * A windowed search gives each caller a different "nearest" for the same ground — the
 * branch nearest a patch of desert is routinely kilometres away in arclength — and a
 * per-caller lattice lets two callers round the same point differently.
 */

/**
 * Spacing of the whole-road coarse index, metres. Taken from the spine rather than
 * declared here: the spine's coarse table IS this index, so a second constant is a
 * second thing to keep in step, and if the two ever disagreed every arclength this
 * class reports would be wrong by the difference.
 */
const COARSE_STEP = COARSE_SPACING;
/**
 * Side of a spatial-grid cell, metres.
 *
 * The road is a curve, so it only occupies a thin ribbon of cells: at 2 km the whole
 * 40 000 km centreline lands in roughly 20 000 occupied cells of about ten coarse
 * samples each, and a query almost always resolves inside the first ring or two. Much
 * smaller and the empty-cell bookkeeping dominates; much larger and each cell holds
 * enough samples to be a linear scan again.
 */
const CELL_SIZE = 2000;
/** Spacing of the fine centreline samples the coarse winner is refined against. */
const FINE_STEP = 20;
/** Cached fine samples before the cache is dropped (values are position-pure). */
const FINE_CACHE_LIMIT = 40_000;
/** Cached lattice nodes, across all lattices, before they are dropped. */
const NODE_CACHE_LIMIT = 240_000;
/** Lattice-index packing for the node cache keys. */
const NODE_BIAS = 4_194_304;
const NODE_STRIDE = 8_388_608;

interface Lattice {
  readonly spacing: number;
  /** Nearest-branch distance at each node. */
  readonly dist: Map<number, number>;
  /** Arclength of the branch owning each node. */
  readonly owner: Map<number, number>;
}

export class RoadDistance {
  /**
   * Coarse index of the entire road: one sample every COARSE_STEP metres.
   *
   * `coarseX`/`coarseZ` are the spine's own arrays, aliased rather than copied — the
   * spine already holds exactly these values and it outlives this class. The buffer
   * type is left open because a spine restored from IndexedDB or moved out of the
   * worker arrives as a view over a transferred buffer, not over a fresh one.
   */
  private coarseS: Float64Array | null = null;
  private coarseX: Float64Array<ArrayBufferLike> = new Float64Array(0);
  private coarseZ: Float64Array<ArrayBufferLike> = new Float64Array(0);
  /**
   * Uniform spatial grid over the coarse samples, in CSR form: `cellStart[c]` is where
   * cell `c`'s run of sample indices begins in `cellItems`.
   *
   * This replaced a list of bounding circles over runs of 16 consecutive samples, and
   * the reason is scaling. Circle pruning still VISITS every run, so its cost is linear
   * in road length: at 400 km that was 125 circles and free, and at 40 000 km it is
   * 12 501 and a measured 0.907 ms for a single query. A terrain chunk touches hundreds
   * of fresh lattice nodes, so that is hundreds of milliseconds in one frame — the
   * sudden stutter, and a pure regression from making the road longer.
   *
   * A grid is keyed on ABSOLUTE world cells, so it keeps the property the whole class
   * rests on: the answer is a function of position alone and every caller agrees. This
   * is NOT a windowed search. It returns the same exhaustive nearest sample as before;
   * it just stops walking road that cannot possibly win.
   */
  private cellSize = 0;
  private cellMinX = 0;
  private cellMinZ = 0;
  private cellsX = 0;
  private cellsZ = 0;
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);
  /** Fine centreline samples at absolute multiples of FINE_STEP. */
  private readonly fine = new Map<number, { x: number; z: number }>();
  /**
   * One lattice per spacing a caller asks for. There are two in practice — 50 m for the
   * chunked mesh, 800 m for the vista — and they are separate rather than one fine
   * lattice shared, because a vista covering a 50 km disc at 50 m spacing is a million
   * nodes and each node is a global search.
   */
  private readonly lattices = new Map<number, Lattice>();
  private nodeCount = 0;
  /** Scratch for the nearest-branch result; callers are allocation-free. */
  private readonly near = { index: 0, dist: 0 };

  constructor(private readonly road: Road) {}

  /**
   * Distance to the nearest pass of the road, bilinearly interpolated on a lattice of
   * `spacing` metres.
   *
   * Interpolating is safe in a way that interpolating an elevation was not: distance is
   * 1-Lipschitz, so the interpolant can never overshoot by more than the cell size, and
   * both things that read it — the berm's rise and the mountains' 14 km ramp — are gentle
   * functions of it. It has a crease along the road itself and along the medial axis
   * between two passes, and the interpolation rounds both off; neither is anywhere the
   * player can stand on the answer.
   */
  distAt(x: number, z: number, spacing: number): number {
    const lattice = this.lattice(spacing);
    const fx = x / spacing;
    const fz = z / spacing;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = this.node(lattice, ix, iz);
    const b = this.node(lattice, ix + 1, iz);
    const c = this.node(lattice, ix, iz + 1);
    const d = this.node(lattice, ix + 1, iz + 1);
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /**
   * Arclength of the road branch owning the ground at a point, on the nearest node of the
   * `spacing` lattice. Used to decide which chunk draws a cell, so it must be the same
   * answer for every chunk that asks — hence the shared lattice rather than a fresh
   * search per caller.
   */
  ownerAt(x: number, z: number, spacing: number): number {
    const lattice = this.lattice(spacing);
    const ix = Math.round(x / spacing);
    const iz = Math.round(z / spacing);
    this.node(lattice, ix, iz);
    return lattice.owner.get(key(ix, iz)) ?? 0;
  }

  private lattice(spacing: number): Lattice {
    let lattice = this.lattices.get(spacing);
    if (!lattice) {
      lattice = { spacing, dist: new Map(), owner: new Map() };
      this.lattices.set(spacing, lattice);
    }
    return lattice;
  }

  private node(lattice: Lattice, ix: number, iz: number): number {
    const k = key(ix, iz);
    const hit = lattice.dist.get(k);
    if (hit !== undefined) return hit;

    this.nearestBranch(ix * lattice.spacing, iz * lattice.spacing);
    if (this.nodeCount > NODE_CACHE_LIMIT) {
      // Values are a pure function of position, so dropping them is free: anything
      // needed again is recomputed identically.
      for (const l of this.lattices.values()) {
        l.dist.clear();
        l.owner.clear();
      }
      this.nodeCount = 0;
    }
    lattice.dist.set(k, this.near.dist);
    lattice.owner.set(k, this.near.index * FINE_STEP);
    this.nodeCount++;
    return this.near.dist;
  }

  /**
   * Indexes the whole road once, coarsely — by READING the spine, not by walking.
   *
   * This used to call `road.sampleAt` at every coarse step: 2001 samples over 400 km,
   * 30 ms including the road's own node integration. The integration was the problem,
   * not the 30 ms. Sampling the whole road forced every node of it into memory, which
   * is 320 MB and 2.1 s at 40 000 km and made a windowed node cache pointless — this
   * one caller would fault the entire road in on the first query. The spine's coarse
   * table holds exactly these positions, computed once by a single walk and persisted,
   * so the index is now a copy of two flat arrays and forces no integration at all.
   */
  private ensureCoarse(): void {
    if (this.coarseS) return;
    const spine = this.road.spine;
    const x = spine.coarseX;
    const z = spine.coarseZ;
    const count = x.length;
    const s = new Float64Array(count);
    for (let k = 0; k < count; k++) s[k] = k * COARSE_STEP;

    // Grid bounds from the samples themselves. The road wanders wherever its curvature
    // takes it, so nothing else knows how far out it reaches.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < count; k++) {
      const px = x[k]!;
      const pz = z[k]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    const cellMinX = Math.floor(minX / CELL_SIZE);
    const cellMinZ = Math.floor(minZ / CELL_SIZE);
    const cellsX = Math.floor(maxX / CELL_SIZE) - cellMinX + 1;
    const cellsZ = Math.floor(maxZ / CELL_SIZE) - cellMinZ + 1;

    // Counting sort into CSR. Two passes over the samples and one over the cells, so
    // building the index is linear and allocates exactly twice.
    const cellCount = cellsX * cellsZ;
    const start = new Int32Array(cellCount + 1);
    for (let k = 0; k < count; k++) {
      const cx = Math.floor(x[k]! / CELL_SIZE) - cellMinX;
      const cz = Math.floor(z[k]! / CELL_SIZE) - cellMinZ;
      start[cz * cellsX + cx + 1]++;
    }
    for (let c = 0; c < cellCount; c++) start[c + 1] += start[c];
    const items = new Int32Array(count);
    const cursor = new Int32Array(cellCount);
    for (let k = 0; k < count; k++) {
      const cx = Math.floor(x[k]! / CELL_SIZE) - cellMinX;
      const cz = Math.floor(z[k]! / CELL_SIZE) - cellMinZ;
      const c = cz * cellsX + cx;
      items[start[c]! + cursor[c]!] = k;
      cursor[c]!++;
    }

    this.coarseS = s;
    this.coarseX = x;
    this.coarseZ = z;
    this.cellSize = CELL_SIZE;
    this.cellMinX = cellMinX;
    this.cellMinZ = cellMinZ;
    this.cellsX = cellsX;
    this.cellsZ = cellsZ;
    this.cellStart = start;
    this.cellItems = items;
  }

  /** A fine centreline sample at `index * FINE_STEP`, cached across callers. */
  private fineSample(index: number): { x: number; z: number } {
    const hit = this.fine.get(index);
    if (hit) return hit;
    const s = Math.min(Math.max(index * FINE_STEP, 0), this.road.length);
    const c = this.road.sampleAt(s);
    const sample = { x: c.x, z: c.z };
    if (this.fine.size > FINE_CACHE_LIMIT) this.fine.clear();
    this.fine.set(index, sample);
    return sample;
  }

  /**
   * The road branch nearest a world XZ, written into `this.near`.
   *
   * Grid pass to find the nearest COARSE sample, then a fine pass over the 20 m samples
   * around it. There used to be a second pass looking for the nearest OTHER branch,
   * because two passes of the road claimed the desert between them at two different
   * elevations and taking the nearer alone left a cliff. Elevation no longer comes from
   * the road, so the second branch has nothing left to say: the ground between two
   * passes is simply the landscape between them.
   *
   * The grid pass walks rings of cells outward from the query and stops as soon as the
   * NEXT ring cannot contain anything closer. That bound is what makes this exact
   * rather than approximate: a ring at radius r is everywhere at least (r - 1) cells
   * away, so once that distance exceeds the best found, no unvisited cell can win. In
   * practice it terminates on the first or second ring, because the road is a curve and
   * the ground being asked about is nearly always beside it.
   */
  private nearestBranch(x: number, z: number): void {
    this.ensureCoarse();
    const cs = this.coarseS!;
    const size = this.cellSize;
    const cx = Math.floor(x / size) - this.cellMinX;
    const cz = Math.floor(z / size) - this.cellMinZ;
    const cellsX = this.cellsX;
    const cellsZ = this.cellsZ;
    const start = this.cellStart;
    const items = this.cellItems;

    let bestK = 0;
    let bestD = Infinity;
    const maxRing = Math.max(cellsX, cellsZ);

    for (let ring = 0; ring <= maxRing; ring++) {
      // Everything in this ring and beyond is at least this far away. Checked BEFORE
      // the ring is scanned, so a hit in ring 0 usually ends the search at ring 1.
      if (ring > 0) {
        const floorDist = (ring - 1) * size;
        if (floorDist > 0 && floorDist * floorDist >= bestD) break;
      }

      const x0 = cx - ring;
      const x1 = cx + ring;
      const z0 = cz - ring;
      const z1 = cz + ring;
      for (let iz = z0; iz <= z1; iz++) {
        if (iz < 0 || iz >= cellsZ) continue;
        // Only the ring's perimeter is new; its interior was covered by earlier rings.
        const edgeRow = iz === z0 || iz === z1;
        const rowBase = iz * cellsX;
        for (let ix = x0; ix <= x1; ix++) {
          if (ix < 0 || ix >= cellsX) continue;
          if (!edgeRow && ix !== x0 && ix !== x1) continue;
          const c = rowBase + ix;
          const from = start[c]!;
          const to = start[c + 1]!;
          for (let i = from; i < to; i++) {
            const k = items[i]!;
            const dx = this.coarseX[k]! - x;
            const dz = this.coarseZ[k]! - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) {
              bestD = d;
              bestK = k;
            }
          }
        }
      }
    }

    this.near.index = this.refine(x, z, cs[bestK]!);
    const best = this.fineSample(this.near.index);
    this.near.dist = Math.hypot(best.x - x, best.z - z);
  }

  /** Nearest fine-sample index within one coarse step of `aroundS`. */
  private refine(x: number, z: number, aroundS: number): number {
    const span = Math.ceil(COARSE_STEP / FINE_STEP);
    const centre = Math.round(aroundS / FINE_STEP);
    let bestIndex = centre;
    let bestD = Infinity;
    for (let i = centre - span; i <= centre + span; i++) {
      const sample = this.fineSample(i);
      const dx = sample.x - x;
      const dz = sample.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}

function key(ix: number, iz: number): number {
  return (ix + NODE_BIAS) * NODE_STRIDE + (iz + NODE_BIAS);
}
