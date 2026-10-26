/**
 * Dev-only breakdown of what a traffic step costs, and of the queries that make it.
 *
 * `FrameProfiler`'s `traffic` section says how much of a frame the stream takes; this says
 * which part of the stream: the coordinator's pairwise rules, the drivers' decisions, the
 * cars' own physics step or the rails, and how many shape queries, lane probes and corridor
 * candidates the drivers ask for to get there.
 *
 * One shared record, filled in place: no allocation per step. Off by default, and off it
 * costs one branch at each site. Switched on by the traffic bench (tools/traffic-bench.ts)
 * and from the console (`__bro.traffic.profile.enabled = true`, then read it back).
 *
 * The timings are of the stream's own calls (world/traffic.ts). The query counters live in
 * the driver (vehicle/autopilot.ts, vehicle/corridor.ts) and so also count a player's
 * autopilot when one drives.
 */

/**
 * Why a driven car is not on rails (world/traffic.ts `putOnRails`): the first rule that
 * refused it at its last lifetime sample, or what woke it since. `near` is split by how
 * far it was from the player along the road, metres; `fresh` has not been asked yet.
 */
export const RAILS_REFUSALS = [
  'fresh',
  'near<150',
  'near<300',
  'near<360',
  'settling',
  'turnaround',
  'holdoff',
  'layby',
  'bypass',
  'passUrge',
  'activity:pass',
  'activity:other',
  'slow',
  'tilted',
  'offLane',
  'roadEnd',
  'laneEnds',
  'oncoming',
  'foreignBody',
  'noGround',
  'woke:near',
  'woke:slow',
  'woke:heldUp',
  'woke:survey',
] as const;
/** Index into `RAILS_REFUSALS`, by name, for the call sites. */
export const REFUSAL = Object.fromEntries(RAILS_REFUSALS.map((name, i) => [name, i])) as Record<
  (typeof RAILS_REFUSALS)[number],
  number
>;

export interface TrafficProfile {
  enabled: boolean;
  /** `RoadTraffic.fixedUpdate` calls, and the milliseconds inside them. */
  steps: number;
  stepMs: number;
  /** Coordinator passes (`COORDINATION_INTERVAL_S`), and their milliseconds. */
  coordinations: number;
  coordinatorMs: number;
  /** `Autopilot.drive` calls made by the stream, and their milliseconds. */
  driveCalls: number;
  driveMs: number;
  /** `Vehicle.fixedUpdate` of the stream's driven cars, milliseconds. */
  vehicleMs: number;
  /** Survey and advance of cars on rails, milliseconds. */
  railsMs: number;
  /** Car-steps by state: driven (springs and a driver), on rails, settling after a spawn. */
  drivenCarSteps: number;
  railCarSteps: number;
  settlingCarSteps: number;
  /** Cars handed back from the rails to their springs and drivers. */
  railWakes: number;
  /** Driven car-steps by why the car is not on rails, indexed as `RAILS_REFUSALS`. */
  drivenWhy: number[];
  /** Driven car-steps with the tread casts gated off (`Vehicle.setTreadCastGate`). */
  treadGatedCarSteps: number;
  /**
   * Rapier shape queries: a driver's road bodies, its abeam neighbours, its blind
   * pull-out guard (`dynamicBodyAhead`), a rails survey.
   */
  roadBodyQueries: number;
  abeamQueries: number;
  bodyAheadQueries: number;
  railProbes: number;
  /** `Autopilot.laneProbe` calls: scans of the bodies the road-body query gathered. */
  laneProbes: number;
  /** Corridor solves, candidate lines evaluated, and obstacle tests over those lines. */
  corridorSolves: number;
  corridorCandidates: number;
  corridorObstacleTests: number;
}

export const trafficProfile: TrafficProfile = {
  enabled: false,
  steps: 0,
  stepMs: 0,
  coordinations: 0,
  coordinatorMs: 0,
  driveCalls: 0,
  driveMs: 0,
  vehicleMs: 0,
  railsMs: 0,
  drivenCarSteps: 0,
  railCarSteps: 0,
  settlingCarSteps: 0,
  railWakes: 0,
  drivenWhy: RAILS_REFUSALS.map(() => 0),
  treadGatedCarSteps: 0,
  roadBodyQueries: 0,
  abeamQueries: 0,
  bodyAheadQueries: 0,
  railProbes: 0,
  laneProbes: 0,
  corridorSolves: 0,
  corridorCandidates: 0,
  corridorObstacleTests: 0,
};

/** Zeroes every counter, leaving `enabled` as it is. */
export function resetTrafficProfile(): void {
  for (const key of Object.keys(trafficProfile) as (keyof TrafficProfile)[]) {
    if (key === 'enabled') continue;
    if (key === 'drivenWhy') trafficProfile.drivenWhy.fill(0);
    else trafficProfile[key] = 0;
  }
}
