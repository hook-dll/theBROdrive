/**
 * WHAT THE OTHER CARS ARE DOING, IN THE ROAD'S FRAME, WITHOUT ASKING THE PHYSICS.
 *
 * A driver's own sensing is physical and stays that way: rays find scenery, debris and
 * anything the coordinator does not know about, and the first static hit is an honest
 * line of sight. But for OTHER TRAFFIC the road already holds the answer exactly —
 * `RoadTraffic` updates every car's arclength, lateral and speed once a step for its
 * own coordinator — and a ray is a bad way to rediscover it:
 *
 *   - a chord is only the lane while the bend is gentle, and it is never the PROFILE.
 *     Three separate attempts at "is somebody catching me up in the next lane" were
 *     built and measured against rays, and all three failed on the same physics: a
 *     50 m look back over a wavy road either dives into the surface or passes over the
 *     car. Measured on seed 545124, the rearward probe answered 29 m with a car at
 *     12 m, and Infinity on the ticks where the answer decided the manoeuvre;
 *   - it costs. Measured with the shipped stream: 105.6 ray queries per physics step
 *     with eleven live cars, essentially all of them from the autopilot.
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
