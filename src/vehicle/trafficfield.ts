/**
 * WHAT THE OTHER CARS ARE DOING, IN THE ROAD'S FRAME, AS THE COORDINATOR KNOWS IT.
 *
 * A driver's own sensing is physical: every dynamic body within reach, projected onto
 * the road (`Autopilot.collectRoadBodies`). That sees a parked car, a trailer, a car in
 * a playground or a bench that no coordinator runs — but only within its reach, and it
 * knows nothing a body does not show. `RoadTraffic` already updates every car's
 * arclength, lateral and speed once a step for its own coordinator, so for the cars of
 * the stream and for the player it can answer further out than any sensor reach —
 * the 300-400 m a racer sizes a pass over — and do it without asking the physics:
 *
 *   - a rearward look over a wavy road was the question rays could not answer. Three
 *     separate attempts at "is somebody catching me up in the next lane" were built
 *     and measured against them, and all three failed on the same physics: a 50 m look
 *     back either dives into the surface or passes over the car. Measured on seed
 *     545124, the rearward probe answered 29 m with a car at 12 m, and Infinity on the
 *     ticks where the answer decided the manoeuvre;
 *   - it costs nothing per driver beyond a loop over the stream.
 *
 * So this field carries the traffic, and only the traffic. It is a READER: the
 * coordinator owns the data and nothing here writes back, which is why a driver can
 * consult it without any of the ordering problems that shared mutable state has.
 */

/** One other vehicle, expressed in the asking driver's own road frame. */
export interface TrafficNeighbour {
  /**
   * Road metres from the asking driver's centre to the other's near longitudinal
   * face; negative is behind. Overlap is zero, included in both front/rear queries.
   */
  readonly s: number;
  /** Signed lateral in the asking driver's frame: positive is to its left. */
  readonly lateral: number;
  /** Speed along the asking driver's direction of travel; negative is oncoming. */
  readonly speed: number;
  readonly halfWidth: number;
  readonly halfLength: number;
}

/**
 * Every vehicle near one driver, in that driver's frame.
 *
 * The visitor is handed a buffer the field owns and reuses, exactly like the road's
 * condition and sample buffers: read it, never retain it.
 */
export interface TrafficField {
  /** Inclusive ranges: zero-distance overlap is visited even when either range is zero. */
  forEachNear(ahead: number, behind: number, fn: (neighbour: TrafficNeighbour) => void): void;
}
