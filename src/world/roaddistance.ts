import type { Road } from './road';

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

/** Spacing of the whole-road coarse index, metres. */
const COARSE_STEP = 200;
/** Coarse samples per bounding circle, for pruning the global search. */
const COARSE_SEGMENT = 16;
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
  /** Coarse index of the entire road: one sample every COARSE_STEP metres. */
  private coarseS: Float64Array | null = null;
  private coarseX = new Float64Array(0);
  private coarseZ = new Float64Array(0);
  /** Bounding circles over runs of COARSE_SEGMENT coarse samples, for pruning. */
  private coarseSegX = new Float64Array(0);
  private coarseSegZ = new Float64Array(0);
  private coarseSegR = new Float64Array(0);
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
   * Indexes the whole road once, coarsely.
   *
   * 2001 samples over 400 km, measured at 30 ms including the road's own node
   * integration, paid once when the first caller asks.
   */
  private ensureCoarse(): void {
    if (this.coarseS) return;
    const road = this.road;
    const count = Math.floor(road.length / COARSE_STEP) + 1;
    const s = new Float64Array(count);
    const x = new Float64Array(count);
    const z = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      const sk = k * COARSE_STEP;
      const c = road.sampleAt(sk);
      s[k] = sk;
      x[k] = c.x;
      z[k] = c.z;
    }
    const segs = Math.ceil(count / COARSE_SEGMENT);
    const segX = new Float64Array(segs);
    const segZ = new Float64Array(segs);
    const segR = new Float64Array(segs);
    for (let g = 0; g < segs; g++) {
      const from = g * COARSE_SEGMENT;
      const to = Math.min(count, from + COARSE_SEGMENT);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = from; k < to; k++) {
        minX = Math.min(minX, x[k]!);
        maxX = Math.max(maxX, x[k]!);
        minZ = Math.min(minZ, z[k]!);
        maxZ = Math.max(maxZ, z[k]!);
      }
      segX[g] = (minX + maxX) * 0.5;
      segZ[g] = (minZ + maxZ) * 0.5;
      segR[g] = Math.hypot(maxX - minX, maxZ - minZ) * 0.5;
    }
    this.coarseS = s;
    this.coarseX = x;
    this.coarseZ = z;
    this.coarseSegX = segX;
    this.coarseSegZ = segZ;
    this.coarseSegR = segR;
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
   * Coarse pass over the whole road with circle pruning, then a fine pass over the 20 m
   * samples around the coarse winner. There used to be a second pass looking for the
   * nearest OTHER branch, because two passes of the road claimed the desert between them
   * at two different elevations and taking the nearer alone left a cliff. Elevation no
   * longer comes from the road, so the second branch has nothing left to say: the ground
   * between two passes is simply the landscape between them.
   */
  private nearestBranch(x: number, z: number): void {
    this.ensureCoarse();
    const cs = this.coarseS!;
    const segs = this.coarseSegR.length;

    let bestK = 0;
    let bestD = Infinity;
    for (let g = 0; g < segs; g++) {
      const bound =
        Math.hypot(this.coarseSegX[g]! - x, this.coarseSegZ[g]! - z) - this.coarseSegR[g]!;
      if (bound > 0 && bound * bound >= bestD) continue;
      const from = g * COARSE_SEGMENT;
      const to = Math.min(cs.length, from + COARSE_SEGMENT);
      for (let k = from; k < to; k++) {
        const dx = this.coarseX[k]! - x;
        const dz = this.coarseZ[k]! - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestK = k;
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
