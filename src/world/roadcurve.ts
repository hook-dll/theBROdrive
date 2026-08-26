import { Noise1D } from '../core/rng';

/**
 * The road's curvature field and the one node recurrence that integrates it.
 *
 * This exists as its own module for a single reason: THREE things integrate the
 * road and they must produce bit-identical doubles. `Road` integrates a block at a
 * time around the player, `buildSpine` integrates the whole road once to snapshot
 * checkpoints, and the spine worker does the same off the main thread. A copy of
 * the recurrence in any of them is a copy that drifts, and a drifted copy means the
 * road built from a checkpoint is a different road from the one built by walking —
 * which shows up as a step in the middle of a chunk seam, not as a compile error.
 *
 * So the recurrence lives here, once, and everything calls it.
 */

/** Spacing between integration nodes. Small enough that 4 m chords read as curved. */
export const NODE_SPACING = 4;
/** Tightest corner radius in metres. Sets the curvature amplitude. */
export const MIN_CORNER_RADIUS = 170;
/** Distance over which curvature varies. Long = sweeping, short = twitchy. */
const CURVATURE_WAVELENGTH = 520;
/** First stretch out of the house is dead straight, for the garage exit. */
const STRAIGHT_RUNOUT = 260;

/**
 * Curvature at arclength s, radians per metre. Ramped in over the runout so the road
 * leaves the house straight, then blends into noise-driven corners.
 */
export class RoadCurvature {
  private readonly noise: Noise1D;

  constructor(seed: number) {
    this.noise = new Noise1D((seed >>> 0) ^ 0x9e3779b9);
  }

  at(s: number): number {
    const ramp = Math.min(1, Math.max(0, (s - STRAIGHT_RUNOUT) / STRAIGHT_RUNOUT));
    return (this.noise.fbm(s / CURVATURE_WAVELENGTH, 3, 2.1, 0.42) / MIN_CORNER_RADIUS) * ramp;
  }
}

/**
 * One integration node, carried between steps. Mutated in place by `stepNode`, which
 * is called ten million times for a 40 000 km spine walk and must not allocate.
 */
export interface NodeState {
  x: number;
  z: number;
  heading: number;
}

/**
 * Advances `node` from integration index `i` to `i + 1`.
 *
 * Midpoint rule: sampling curvature at the segment centre keeps the integrated
 * heading second-order accurate, which matters over ten million nodes. Only XZ is
 * integrated — elevation is READ from the landscape at the node's own position, so it
 * carries no state and cannot drift, and a checkpoint therefore never has to store it.
 */
export function stepNode(node: NodeState, curvature: RoadCurvature, i: number): void {
  const sMid = i * NODE_SPACING + NODE_SPACING * 0.5;
  const heading = node.heading + curvature.at(sMid) * NODE_SPACING;
  const midHeading = (node.heading + heading) * 0.5;
  node.x += Math.sin(midHeading) * NODE_SPACING;
  node.z += Math.cos(midHeading) * NODE_SPACING;
  node.heading = heading;
}
