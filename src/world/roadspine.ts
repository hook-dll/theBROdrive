import { NODE_SPACING, RoadCurvature, stepNode, type NodeState } from './roadcurve';

/**
 * The road spine: two small tables that make an arbitrarily long road affordable.
 *
 * THE PROBLEM. The centreline is a random walk — heading is the integral of
 * curvature — so node N cannot be computed without nodes 0..N-1. `Road` used to
 * answer that by integrating from s = 0 and keeping every node it had ever touched
 * in four growing arrays. At 400 km that is 100 000 nodes and 3.2 MB, paid in 31 ms
 * once per session. Nothing about it survives being made a hundred times longer:
 * 10 million nodes, 320 MB that is never freed, and 2.1 s of blocking integration
 * before the first frame — every session, because the cache was never persisted.
 * A save at 39 000 km paid the whole walk to draw the first chunk.
 *
 * THE FIX, and it is two tables from ONE walk:
 *
 *  - CHECKPOINTS every `CHECKPOINT_SPACING` metres: the exact `(x, z, heading)` the
 *    sequential walk had at that node. Any node in the road can then be reached by
 *    integrating forward from the nearest checkpoint — at most 2500 steps, half a
 *    millisecond — so `Road` keeps a bounded LRU of blocks instead of everything.
 *    Elevation is absent on purpose: it is read from the landscape per node and
 *    carries no state, and it is also the expensive half (150 ms per million nodes
 *    against 59 ms for the curvature and XZ), so leaving it out is what makes the
 *    walk cheap enough to do at load.
 *
 *  - A COARSE POSITION INDEX every `COARSE_SPACING` metres. `RoadDistance` needs the
 *    whole road indexed to answer "which pass of the road is nearest this patch of
 *    desert", and `Road.project` needs it to answer "where am I" with no hint. Both
 *    used to get there by calling `sampleAt` across the entire road, which forced the
 *    full integration and defeated any windowing. Reading a flat table instead costs
 *    no integration at all.
 *
 * BIT-IDENTICAL OR NOTHING. A block integrated from checkpoint `b` must produce the
 * same doubles as a walk from s = 0. It does, because the checkpoints are snapshots
 * OF that walk and `stepNode` is the only recurrence: same inputs, same IEEE ops,
 * same result. That is why the recurrence lives in `roadcurve.ts` rather than being
 * written out twice. If it were ever copied and one copy drifted, the road drawn
 * around the player would differ from the road drawn one chunk away, and the seam
 * between them would step.
 */

/** Metres between checkpoints. 10 km = 2500 nodes to replay, ~0.5 ms. */
export const CHECKPOINT_SPACING = 10_000;
/** Metres between coarse position samples. Matches `RoadDistance`'s own coarse step. */
export const COARSE_SPACING = 200;

/** Format tag for the persisted cache. Bump on any change to the tables' meaning. */
export const SPINE_FORMAT = 1;

export interface RoadSpine {
  /** Road length the tables were built for, metres. */
  readonly length: number;
  /** Checkpoint state, one entry per `CHECKPOINT_SPACING`, index 0 at s = 0. */
  readonly checkpointX: Float64Array;
  readonly checkpointZ: Float64Array;
  readonly checkpointHeading: Float64Array;
  /** Centreline position every `COARSE_SPACING`, index 0 at s = 0. */
  readonly coarseX: Float64Array;
  readonly coarseZ: Float64Array;
}

/** Nodes replayed to cross one checkpoint interval. */
export const CHECKPOINT_NODES = CHECKPOINT_SPACING / NODE_SPACING;

/**
 * Walks the whole centreline once and snapshots both tables.
 *
 * Roughly 59 ms per million nodes, so 0.6 s for 40 000 km — which is why this runs in
 * a worker at load and is then persisted (see `spinecache.ts`). Allocation-free inside
 * the loop: one mutable `NodeState`, no per-node objects.
 *
 * The coarse index is sampled AT NODES, not at exact multiples of `COARSE_SPACING`
 * interpolated between them. `COARSE_SPACING` is a whole multiple of `NODE_SPACING`,
 * so those are the same points, and taking the node avoids a Hermite evaluation
 * whose only job would be to reproduce a value we already have exactly.
 */
export function buildSpine(seed: number, length: number): RoadSpine {
  const curvature = new RoadCurvature(seed);
  const lastNode = Math.floor(length / NODE_SPACING);
  const coarseStride = COARSE_SPACING / NODE_SPACING;

  const checkpointCount = Math.floor(lastNode / CHECKPOINT_NODES) + 1;
  const coarseCount = Math.floor(lastNode / coarseStride) + 1;

  const checkpointX = new Float64Array(checkpointCount);
  const checkpointZ = new Float64Array(checkpointCount);
  const checkpointHeading = new Float64Array(checkpointCount);
  const coarseX = new Float64Array(coarseCount);
  const coarseZ = new Float64Array(coarseCount);

  const node: NodeState = { x: 0, z: 0, heading: 0 };
  // Node 0 is the origin, and it is both checkpoint 0 and coarse sample 0.
  for (let i = 1; i <= lastNode; i++) {
    stepNode(node, curvature, i - 1);
    if (i % CHECKPOINT_NODES === 0) {
      const k = i / CHECKPOINT_NODES;
      checkpointX[k] = node.x;
      checkpointZ[k] = node.z;
      checkpointHeading[k] = node.heading;
    }
    if (i % coarseStride === 0) {
      const k = i / coarseStride;
      coarseX[k] = node.x;
      coarseZ[k] = node.z;
    }
  }

  return { length, checkpointX, checkpointZ, checkpointHeading, coarseX, coarseZ };
}
