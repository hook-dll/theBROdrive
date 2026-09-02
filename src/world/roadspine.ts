import { NODE_SPACING, RoadHeading, stepNode, type NodeState } from './roadcurve';

/**
 * The road spine: two small tables that make an arbitrarily long road affordable.
 *
 * The centreline has ten million 4 m nodes, and retaining them all would be 240 MB
 * before elevation or headings. Nothing about that survives a forty-thousand-
 * kilometre road, so the spine is two sparse tables from one sequential walk:
 *
 *  - CHECKPOINTS every `CHECKPOINT_SPACING` metres: exact `(x, z)` snapshots. Any
 *    node can be reached by replaying at most 2500 steps from one, so `Road` keeps a
 *    bounded LRU of blocks instead of the whole centreline.
 *
 *  - A COARSE POSITION INDEX every `COARSE_SPACING` metres. `RoadDistance` and
 *    hintless `Road.project` need the whole road spatially searchable without
 *    forcing those blocks into memory.
 *
 * Heading is absent now for a stronger reason than elevation. Elevation is read
 * from the landscape and heading from `RoadHeading`; both are pure functions of
 * position/arclength rather than recurrence state. A checkpoint therefore stores
 * only the two values that genuinely accumulate.
 *
 * BIT-IDENTICAL OR NOTHING. A block replayed from checkpoint `b` must produce the
 * same doubles as a walk from zero. `stepNode` is the only recurrence and heading
 * is analytic, so the replay has exactly the same inputs and IEEE operations. A
 * copied or divergent recurrence would show up as a step across a chunk seam.
 */

/** Metres between checkpoints. 10 km = 2500 nodes to replay, ~0.5 ms. */
export const CHECKPOINT_SPACING = 10_000;
/** Metres between coarse position samples. Matches `RoadDistance`'s own coarse step. */
export const COARSE_SPACING = 200;

/**
 * Format tag for the persisted cache. Bump on any change to the tables' MEANING —
 * which includes any change to the heading field, because a cached checkpoint is a
 * position the new field would not integrate to. 5: replace gated corner noise with
 * guaranteed, seeded turn sequences.
 */
export const SPINE_FORMAT = 5;

export interface RoadSpine {
  /** Road length the tables were built for, metres. */
  readonly length: number;
  /** Checkpoint position every `CHECKPOINT_SPACING`, index 0 at s = 0. */
  readonly checkpointX: Float64Array;
  readonly checkpointZ: Float64Array;
  /** Centreline position every `COARSE_SPACING`, index 0 at s = 0. */
  readonly coarseX: Float64Array;
  readonly coarseZ: Float64Array;
}

/** Nodes replayed to cross one checkpoint interval. */
export const CHECKPOINT_NODES = CHECKPOINT_SPACING / NODE_SPACING;

/**
 * Walks the whole centreline once and snapshots both tables.
 *
 * Runs in a worker at load and is persisted by `spinecache.ts`. Allocation-free
 * inside the ten-million-step loop: one mutable `NodeState`, no per-node objects.
 *
 * The coarse index is sampled AT NODES. `COARSE_SPACING` is a whole multiple of
 * `NODE_SPACING`, so those are exact multiples already and need no interpolation.
 */
export function buildSpine(seed: number, length: number): RoadSpine {
  const heading = new RoadHeading(seed);
  const lastNode = Math.floor(length / NODE_SPACING);
  const coarseStride = COARSE_SPACING / NODE_SPACING;

  const checkpointCount = Math.floor(lastNode / CHECKPOINT_NODES) + 1;
  const coarseCount = Math.floor(lastNode / coarseStride) + 1;

  const checkpointX = new Float64Array(checkpointCount);
  const checkpointZ = new Float64Array(checkpointCount);
  const coarseX = new Float64Array(coarseCount);
  const coarseZ = new Float64Array(coarseCount);

  const node: NodeState = { x: 0, z: 0 };
  // Node 0 is the origin, and it is both checkpoint 0 and coarse sample 0.
  for (let i = 1; i <= lastNode; i++) {
    stepNode(node, heading, i - 1);
    if (i % CHECKPOINT_NODES === 0) {
      const k = i / CHECKPOINT_NODES;
      checkpointX[k] = node.x;
      checkpointZ[k] = node.z;
    }
    if (i % coarseStride === 0) {
      const k = i / coarseStride;
      coarseX[k] = node.x;
      coarseZ[k] = node.z;
    }
  }

  return { length, checkpointX, checkpointZ, coarseX, coarseZ };
}
