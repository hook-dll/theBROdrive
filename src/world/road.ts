import { Landscape } from './landscape';
import { MIN_CORNER_RADIUS, NODE_SPACING, RoadHeading, stepNode, type NodeState } from './roadcurve';
import {
  buildSpine,
  CHECKPOINT_NODES,
  COARSE_SPACING,
  type RoadSpine,
} from './roadspine';

/**
 * The road is the spine of the world.
 *
 * It is an arclength-parameterised curve. A bounded, smooth heading is sampled at
 * each segment midpoint and XZ is integrated forward from the house; elevation is
 * not road state at all, but the `Landscape` field under the centreline. Everything
 * else in the world is indexed by the same `s`.
 *
 * Consequences worth knowing:
 *  - the heading stays below 90 degrees from the trunk bearing, so the road's +Z
 *    projection is strictly increasing and it cannot self-intersect
 *  - route-scale noise supplies broad sweepers; seeded turn sequences guarantee
 *    regular 25-60 degree corners with straights between them
 *  - the road's grade is whatever the landscape does along its tangent; there is
 *    no grade noise and no elevation state that could drift
 *  - the road has a real end at `length`, reached only after a very long drive
 *  - generation is pure: same seed, same road, on any machine
 *
 * `roadcurve.ts` documents the heading budget and turn construction;
 * `tools/road-selfcross.ts` enforces separation.
 *
 * NODES ARE NOT KEPT. The `RoadSpine` holds a position checkpoint every 10 km and
 * this class keeps a small LRU of replayed 10 km blocks, so memory stays constant.
 * Heading is analytic now and checkpoints no longer carry it.
 */

export { NODE_SPACING, MIN_CORNER_RADIUS };

/** Half-width of the asphalt. 2.9 m puts each edge at the former side marking. */
export const ROAD_HALF_WIDTH = 2.9;
/**
 * Total road length in metres. Forty thousand kilometres — a circumnavigation, and at
 * 90 km/h about 450 hours of driving, so it is measured in sessions rather than in an
 * afternoon.
 *
 * It was 400 km, and raising it by a hundred times is not a constant change. Three
 * things had to be built first, and each one is load-bearing:
 *
 *  - THE SPINE (`roadspine.ts`). Ten million nodes cannot remain resident: the old
 *    design kept every one, 320 MB and seconds of blocking work. Sparse position
 *    checkpoints plus a block cache make it under 4 MB and one worker walk per seed.
 *  - THE FLOATING ORIGIN (`origin.ts`). The traversing centreline finishes about
 *    35 500 km from (0, 0), where a float32 step is metres and Rapier's suspension
 *    would no longer exist. Every rendered and simulated coordinate is rebased into
 *    the live few-kilometre frame before it touches f32.
 *  - DISTANCE-DRIVEN CONTENT (`gradient.ts`). Every gradient used to be a fraction of
 *    this constant, so raising it would have stretched the whole game a hundredfold:
 *    4000 km of flawless asphalt, one pole era for 5600 km. Road quality is now
 *    stationary in absolute distance and the palette cycles every 4000 km.
 */
export const ROAD_LENGTH = 40_000_000;

/**
 * Blocks of nodes kept live. Each is one checkpoint interval — 2501 nodes across four
 * Float64Arrays, 80 KB — so eight of them is 640 KB, constant for any road length.
 *
 * Eight rather than one, and this is the number that matters. A window would be
 * enough if every query were near the player, but `RoadDistance` asks about the
 * branch nearest a patch of desert, and that branch is routinely kilometres away in
 * arclength from the one under the car. With a single window those two queries
 * alternate and every one of them pays a full replay; with eight, both regions stay
 * resident and the replay happens once. Measured against the vista's lattice, which
 * interleaves near and far branches by design.
 */
const BLOCK_CACHE = 8;

export interface RoadSample {
  /** Arclength, clamped into the road's extent. */
  readonly s: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Tangent direction in the XZ plane, radians. Forward is (sin h, cos h). */
  readonly heading: number;
  /** Rise over run along the road's own tangent. */
  readonly grade: number;
  /** Signed curvature, radians per metre. */
  readonly curvature: number;
}

export interface RoadProjection {
  /** Arclength of the closest centreline point. */
  readonly s: number;
  /** Signed lateral offset; positive is LEFT of travel (see `offsetPoint`). */
  readonly lateral: number;
  /** Centreline elevation there. */
  readonly height: number;
}

/** One replayed run of nodes, `CHECKPOINT_NODES + 1` long so a segment never straddles. */
interface Block {
  /** Checkpoint index, or -1 for an empty slot. */
  index: number;
  /** Monotonic counter for LRU eviction. */
  used: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly zs: Float64Array;
  readonly headings: Float64Array;
}

export class Road {
  readonly length = ROAD_LENGTH;
  readonly seed: number;

  /** The elevation field the road lies on. Public: the terrain reads the same one. */
  readonly landscape: Landscape;

  private readonly headingField: RoadHeading;
  private readonly lastNode: number;

  /** Checkpoint and coarse tables. Injected at load, or built on first use. */
  private spineTables: RoadSpine | null;

  private readonly blocks: Block[] = [];
  private useClock = 0;
  /** Scratch node for block replay; never allocated per node. */
  private readonly replay: NodeState = { x: 0, z: 0 };
  /**
   * Arclengths of the coarse candidates a hintless `project` will refine. Preallocated
   * because rescue can fire on a fixed step, and capped at 16 because that is already
   * far more branches than converge anywhere on this road — see `project`.
   */
  private readonly candidates = new Float64Array(16);

  /**
   * `spine` is optional so every dev tool can still write `new Road(seed)` and every
   * caller that does not care about load time gets the tables built synchronously on
   * first use. The game passes a worker-built, IndexedDB-cached one (see
   * `spinecache.ts`) so the walk never lands on the main thread.
   */
  constructor(seed: number, spine?: RoadSpine) {
    this.seed = seed >>> 0;
    this.landscape = new Landscape(this.seed);
    this.headingField = new RoadHeading(this.seed);
    this.lastNode = Math.floor(this.length / NODE_SPACING);
    if (spine && spine.length !== this.length) {
      throw new Error(`Road spine is for a ${spine.length} m road, not ${this.length} m`);
    }
    this.spineTables = spine ?? null;
  }

  /** The checkpoint and coarse tables, built on demand if none was injected. */
  get spine(): RoadSpine {
    this.spineTables ??= buildSpine(this.seed, this.length);
    return this.spineTables;
  }

  /**
   * Curvature at arclength s, radians per metre. Ramped in over the runout so the
   * road leaves the house straight, then blends into noise-driven corners.
   */
  curvatureAt(s: number): number {
    return this.headingField.curvatureAt(s);
  }

  /**
   * How hilly the country is at `s`, 0..1. Delegates to the landscape, because
   * hilliness is a property of the ground the road crosses, not of the arclength.
   */
  hillinessAt(s: number): number {
    const c = this.sampleAt(s);
    return this.landscape.hillinessAt(c.x, c.z);
  }

  /**
   * The block holding integration node `i`, replaying it from its checkpoint if it is
   * not resident. Eviction is least-recently-used over a fixed set of slots, so this
   * never grows.
   */
  private blockFor(i: number): Block {
    const index = Math.floor(i / CHECKPOINT_NODES);
    let victim: Block | null = null;
    for (const block of this.blocks) {
      if (block.index === index) {
        block.used = ++this.useClock;
        return block;
      }
      if (!victim || block.used < victim.used) victim = block;
    }

    if (!victim || this.blocks.length < BLOCK_CACHE) {
      victim = {
        index: -1,
        used: 0,
        xs: new Float64Array(CHECKPOINT_NODES + 1),
        ys: new Float64Array(CHECKPOINT_NODES + 1),
        zs: new Float64Array(CHECKPOINT_NODES + 1),
        headings: new Float64Array(CHECKPOINT_NODES + 1),
      };
      this.blocks.push(victim);
    }

    const spine = this.spine;
    const first = index * CHECKPOINT_NODES;
    const node = this.replay;
    node.x = spine.checkpointX[index]!;
    node.z = spine.checkpointZ[index]!;

    victim.xs[0] = node.x;
    victim.zs[0] = node.z;
    victim.headings[0] = this.headingField.at(first * NODE_SPACING);
    victim.ys[0] = this.landscape.heightAt(node.x, node.z);
    for (let k = 1; k <= CHECKPOINT_NODES; k++) {
      stepNode(node, this.headingField, first + k - 1);
      victim.xs[k] = node.x;
      victim.zs[k] = node.z;
      victim.headings[k] = this.headingField.at((first + k) * NODE_SPACING);
      victim.ys[k] = this.landscape.heightAt(node.x, node.z);
    }

    victim.index = index;
    victim.used = ++this.useClock;
    return victim;
  }

  /**
   * Centreline state at arclength `s`, clamped to the road's extent.
   *
   * Position is interpolated with a cubic Hermite between nodes using the node
   * headings as tangents, so the sampled curve is C1 even though the underlying
   * nodes are 4 m apart. Linear interpolation here shows up as visible faceting.
   */
  sampleAt(s: number): RoadSample {
    const clamped = Math.min(Math.max(s, 0), this.length);
    const fi = clamped / NODE_SPACING;
    const i = Math.min(Math.floor(fi), this.lastNode - 1);
    const t = fi - i;

    const block = this.blockFor(i);
    const k = i - block.index * CHECKPOINT_NODES;

    const h0 = block.headings[k]!;
    const h1 = block.headings[k + 1]!;
    const y0 = block.ys[k]!;
    const y1 = block.ys[k + 1]!;

    // Hermite basis over the unit interval, tangents scaled to segment length.
    const t2 = t * t;
    const t3 = t2 * t;
    const b0 = 2 * t3 - 3 * t2 + 1;
    const m0 = t3 - 2 * t2 + t;
    const b1 = -2 * t3 + 3 * t2;
    const m1 = t3 - t2;

    return {
      s: clamped,
      x:
        b0 * block.xs[k]! +
        m0 * Math.sin(h0) * NODE_SPACING +
        b1 * block.xs[k + 1]! +
        m1 * Math.sin(h1) * NODE_SPACING,
      y: y0 + (y1 - y0) * t,
      z:
        b0 * block.zs[k]! +
        m0 * Math.cos(h0) * NODE_SPACING +
        b1 * block.zs[k + 1]! +
        m1 * Math.cos(h1) * NODE_SPACING,
      heading: h0 + (h1 - h0) * t,
      // The grade the driver actually rides: the slope of the interpolated y, which
      // is linear across the segment. Differencing the nodes is therefore exact.
      grade: (y1 - y0) / NODE_SPACING,
      curvature: this.headingField.curvatureAt(clamped),
    };
  }

  /**
   * A point offset laterally from the centreline.
   *
   * CONVENTION, and it is a trap: positive `lateral` is to the **left** of the
   * travel direction, not the right. Forward is (sin h, cos h) and up is +Y, so true
   * right is forward x up = (-cos h, sin h); the vector used below is its negation.
   * The sign is kept this way deliberately because the road ribbon and terrain grids
   * are built by walking `lateral` and their triangle winding depends on it —
   * flipping it here inverts every road normal. Anything that cares which side of
   * the road it sits on must negate, as the pole line does.
   */
  offsetPoint(s: number, lateral: number, out?: { x: number; y: number; z: number }) {
    const c = this.sampleAt(s);
    const target = out ?? { x: 0, y: 0, z: 0 };
    target.x = c.x + Math.cos(c.heading) * lateral;
    target.y = c.y;
    target.z = c.z - Math.sin(c.heading) * lateral;
    return target;
  }

  /**
   * Finds the closest centreline point to a world XZ position.
   *
   * `hintS` should be the previous result for the same entity; the search then costs a
   * handful of samples and descends from where the entity already was.
   *
   * WITHOUT a hint this reads the spine's coarse table rather than sampling the road.
   * It used to sweep `sampleAt` across the whole road at 250 m — 1600 calls at 400 km,
   * 160 000 at 40 000 km, and because each one could extend the node cache, a cold
   * hintless call also paid the entire integration. The coarse table is a flat scan of
   * doubles that were computed once, so the same answer costs no integration at all.
   *
   * It keeps several candidates rather than trusting the single nearest sample.
   * With the bounded-heading spine distant branches cannot converge anymore, so this
   * is now a cheap robustness net rather than routine arbitration. The bound remains
   * exact: the true nearest point lies within half a coarse step of some sample, so
   * that sample's distance is at most the true distance plus half a step. Every
   * candidate branch therefore has a sample within one full step of the best sample's
   * distance. Refining all of those protects the query if the spacing or routing
   * guarantee is changed again without reintroducing the historical single-winner bug.
   */
  project(x: number, z: number, hintS?: number): RoadProjection {
    let bestS: number;
    let bestDist: number;

    if (hintS === undefined) {
      const { coarseX, coarseZ } = this.spine;
      let bestCoarse = Infinity;
      for (let k = 0; k < coarseX.length; k++) {
        const dx = coarseX[k]! - x;
        const dz = coarseZ[k]! - z;
        const d = dx * dx + dz * dz;
        if (d < bestCoarse) bestCoarse = d;
      }

      const limit = Math.sqrt(bestCoarse) + COARSE_SPACING;
      const limitSq = limit * limit;
      const candidates = this.candidates;
      let count = 0;
      for (let k = 0; k < coarseX.length && count < candidates.length; k++) {
        const dx = coarseX[k]! - x;
        const dz = coarseZ[k]! - z;
        if (dx * dx + dz * dz <= limitSq) candidates[count++] = k * COARSE_SPACING;
      }

      bestS = candidates[0]!;
      bestDist = Infinity;
      for (let i = 0; i < count; i++) {
        const s = this.descend(x, z, candidates[i]!, COARSE_SPACING);
        const c = this.sampleAt(s);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestS = s;
        }
      }
    } else {
      bestS = this.descend(x, z, Math.min(Math.max(hintS, 0), this.length), 90);
    }

    const c = this.sampleAt(bestS);
    return {
      s: bestS,
      // Same basis as `offsetPoint`, so positive is LEFT of travel. See its comment.
      lateral: (x - c.x) * Math.cos(c.heading) + (z - c.z) * -Math.sin(c.heading),
      height: c.y,
    };
  }

  /**
   * Local descent to the nearest centreline point, starting at `fromS` and halving
   * `window` until it is under the refinement floor. Purely local: it finds the
   * bottom of the valley it starts in, which is why the caller has to start it in the
   * right valley.
   */
  private descend(x: number, z: number, fromS: number, window: number): number {
    let bestS = fromS;
    const start = this.sampleAt(bestS);
    let bestDist = (start.x - x) ** 2 + (start.z - z) ** 2;
    let span = window;
    while (span > 0.05) {
      for (const s of [bestS - span, bestS + span]) {
        if (s < 0 || s > this.length) continue;
        const c = this.sampleAt(s);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestS = s;
        }
      }
      span *= 0.5;
    }
    return bestS;
  }
}
