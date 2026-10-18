/**
 * tools/traffic-blocker.ts — one car standing in its own lane, the densest stream driving round it.
 *
 * Reported by the owner: at the top traffic setting a car stopped in its lane gathers a
 * monstrous queue behind it, and nobody goes round. This bench is that scene on the
 * REAL road and nothing else: the rig of `tools/traffic-road.ts` (real `Road`,
 * `Terrain`, road mesh and scatter colliders, the game's desert, the shipped
 * `RoadTraffic`), with the ego car — the player's car, `drivingCarId` set, so the stream
 * sees him exactly as it does in play — put down on its own lane centre and held there on
 * the brake and the handbrake for the whole run. No autopilot drives it.
 *
 * The stream is pinned at its ceiling: `trafficDensity` 'high' (48 cars) and the density
 * draw, which otherwise re-rolls between 35% and 100% of the cap every minute or so,
 * held at 100% from the private side.
 *
 * WHAT IS MEASURED is what the player would watch in his mirror:
 *   - same-direction cars that got past him (behind -> ahead by more than a body), per
 *     minute, and oncoming cars that drove past his position;
 *   - the queue: same-direction cars within 300 m behind him standing (< 2 km/h), mean
 *     and max, and the longest the head of it stood;
 *   - the HEAD of the queue (nearest same-direction car within 40 m behind), second by
 *     second: rails or driven, activity, manoeuvre, what it senses ahead, what its
 *     planner wants, whether it wants to pass and which gate refused it, whether the
 *     coordinator let it cross and whether it ever got a bottleneck turn;
 *   - cars the stream recycled while stuck, and contacts involving the ego or the queue.
 *
 * Usage:
 *   bun tools/traffic-blocker.ts [seed] [--minutes N] [--start S] [--cap N] [--trace-head]
 *                                [--warmup S] [--lanes 1|2]
 */

import * as THREE from 'three';

import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { poseOnGround } from '../src/game/spawn';
import { GameWorld, newWorldState } from '../src/game/state';
import { TRAFFIC_CAPS } from '../src/game/settings';
import { carModelMeasure, carSpawnYAboveGround, loadCarModel, preloadCarModels } from '../src/render/carmodel';
import { benchCarState } from './benchcar';
import type { Autopilot } from '../src/vehicle/autopilot';
import { Vehicle } from '../src/vehicle/vehicle';
import { installAssetShim } from './assetshim';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { RoadDistance } from '../src/world/roaddistance';
import { DesertTileStreamer, DESERT_TILE_SIZE } from '../src/world/deserttiles';
import { WorldWorkScheduler } from '../src/world/workqueue';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { ScatterProvider } from '../src/world/props/scatter';
import { Terrain } from '../src/world/terrain';
import { type ChunkContext } from '../src/world/chunks';
import { InstanceBatches } from '../src/world/props/instancebatch';
import { CHUNK_LENGTH, TRAFFIC_REACH_M } from '../src/world/ranges';
import { installDocumentShim } from './domshim';
import { RoadTraffic } from '../src/world/traffic';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable = false;
  readonly loaded = 0;
  readonly total = 0;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
  }
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
installAssetShim();
installDocumentShim();

// ---------------------------------------------------------------- configuration
const args = process.argv.slice(2);
function flag(name: string, fallback: number): number {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] !== undefined) return Number(args[index + 1]);
  return fallback;
}
const SEED = Number(args.find((a) => !a.startsWith('--') && Number.isFinite(Number(a)) && args[args.indexOf(a) - 1]?.startsWith('--') !== true) ?? 1337);
const START_S = flag('start', 40_000);
const MEASURE_S = flag('minutes', 5) * 60;
const WARMUP_S = flag('warmup', 30);
const CAP = Math.min(48, flag('cap', TRAFFIC_CAPS.high));
const TRACE_HEAD = args.includes('--trace-head');
/**
 * `--lanes N`: lanes per side the ego must stand on (default 1, the two-lane road most
 * of the route is, where going round means borrowing the oncoming lane). The stand is
 * the first clear point at or past `--start` with that many lanes 400 m either side.
 */
const LANES = flag('lanes', 1);
const EGO_MODEL = 'sv_vaz2105r';
const BODY_LENGTH_M = 4.4;
const STOPPED_KMH = 2;
const QUEUE_REACH_M = 300;
const HEAD_REACH_M = 40;
/** Hysteresis and continuity for "behind -> ahead": a respawn under the same id is not a pass. */
const CONTINUITY_M = 25;

console.log(
  `blocker bench, seed ${SEED}, --start ${START_S}, ${LANES} lane(s) per side, cap ${CAP}, warm-up ${WARMUP_S} s, ` +
    `${(MEASURE_S / 60).toFixed(1)} measured min`,
);

// ---------------------------------------------------------------- the world
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const physics = await PhysicsWorld.create();
const surface = new SurfaceField(SEED);
const world = new GameWorld(newWorldState(SEED));
world.state.settings.trafficDensity = 'high';

/** First s at or past START_S with `LANES` lanes per side for 400 m either way. */
function laneStart(from: number): number {
  const uniform = (s: number): boolean => {
    for (let t = s - 400; t <= s + 400; t += 25) if (road.lanesPerSideAt(t) !== LANES) return false;
    return true;
  };
  for (let s = from; s < from + 20_000; s += 25) if (uniform(s)) return s;
  throw new Error(`no stretch with ${LANES} lane(s) per side within 20 km of s ${from}`);
}
const SEARCH_S = laneStart(START_S);

const hazards = new HazardIndex();
const roadDistance = new RoadDistance(road);
const roadProvider = new RoadMeshProvider(SEED, roadDistance);
const scatter = new ScatterProvider(undefined, hazards);
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const desert = new DesertTileStreamer(SEED, road, terrain, roadDistance, physics, scene, origin, undefined, new WorldWorkScheduler(3), () => null);
{
  // The ego stands within 2 km of SEARCH_S (`clearStart`); the stream lives TRAFFIC_REACH_M round it.
  const first = Math.floor((SEARCH_S - TRAFFIC_REACH_M - 200) / CHUNK_LENGTH);
  const last = Math.ceil((SEARCH_S + 2_000 + TRAFFIC_REACH_M + 200) / CHUNK_LENGTH);
  for (let index = first; index <= last; index++) {
    const sStart = index * CHUNK_LENGTH;
    const context: ChunkContext = {
      chunkIndex: index,
      sStart: Math.max(0, sStart),
      sEnd: Math.min(road.length, sStart + CHUNK_LENGTH),
      road,
      terrain,
      physics,
      world,
      hasPhysics: true,
      originX: 0,
      originZ: 0,
      batches: new InstanceBatches({ x: 0, z: 0 }),
    };
    for (const provider of [roadProvider, scatter]) {
      const content = provider.build(context);
      if (!content) continue;
      for (const collider of content.colliders) collider.setEnabled(true);
    }
  }
}

/**
 * A stand with no prop on the carriageway within 20 m either side, as traffic-road picks
 * it, and still `LANES` lanes per side for 300 m either way.
 */
function clearStart(): number {
  const HAZARD_GAP_M = 20;
  for (let s = SEARCH_S; s < SEARCH_S + 2_000; s += 10) {
    if (road.lanesPerSideAt(s - 300) !== LANES || road.lanesPerSideAt(s + 300) !== LANES) continue;
    let blocked = false;
    hazards.forEachAhead(s - HAZARD_GAP_M, HAZARD_GAP_M * 2, (hazard) => {
      if (Math.abs(hazard.lateral) - hazard.radius < road.halfWidthAt(hazard.s) + 2) blocked = true;
    });
    if (!blocked) return s;
  }
  return SEARCH_S;
}
const EGO_START_S = clearStart();
const EGO_LANE_LATERAL = road.laneCentreAt(EGO_START_S, 0);
{
  const start = road.sampleAt(EGO_START_S);
  desert.prime(start.x, start.z, EGO_LANE_LATERAL);
  desert.update(start.x, start.z, EGO_LANE_LATERAL, 1);
}
physics.step();

// ---------------------------------------------------------------- the standing car
await preloadCarModels();
await loadCarModel(EGO_MODEL);
const egoPoint = road.offsetPoint(EGO_START_S, EGO_LANE_LATERAL);
const egoHeading = road.sampleAt(EGO_START_S).heading;
const groundAt = (x: number, z: number): number => {
  const p = road.project(x, z, EGO_START_S);
  return roadSurfaceY(road, surface, p.s, p.lateral, x, z);
};
const egoPose = poseOnGround(carModelMeasure(EGO_MODEL).wheels, egoPoint.x, egoPoint.z, egoHeading, groundAt);
const egoCarState = benchCarState(EGO_MODEL, {
  id: 'ego',
  x: egoPoint.x,
  y: carSpawnYAboveGround(carModelMeasure(EGO_MODEL), egoPose?.groundY ?? groundAt(egoPoint.x, egoPoint.z), 0),
  z: egoPoint.z,
  heading: egoHeading,
});
if (egoPose) {
  egoCarState.qx = egoPose.qx;
  egoCarState.qy = egoPose.qy;
  egoCarState.qz = egoPose.qz;
  egoCarState.qw = egoPose.qw;
}
world.state.cars[egoCarState.id] = egoCarState;
const ego = new Vehicle(physics, world, egoCarState, scene, origin);
// The player is IN the car: this is what puts him in the stream's field and rules.
world.state.player.drivingCarId = egoCarState.id;
// Held still for the whole run, the way a player sitting on the brake and handbrake would.
const egoInput: InputFrame = emptyInput();
egoInput.brake = 1;
egoInput.handbrake = true;
for (let i = 0; i < 180; i++) {
  ego.fixedUpdate(FIXED_DT, egoInput);
  physics.step();
  ego.postStep();
}
const egoPosition = { x: 0, y: 0, z: 0 };
ego.absoluteTranslation(egoPosition);
let egoS = road.project(egoPosition.x, egoPosition.z, EGO_START_S).s;
let egoLateral = road.project(egoPosition.x, egoPosition.z, EGO_START_S).lateral;
const egoSettledS = egoS;
const egoSettledLateral = egoLateral;
console.log(
  `  ego stands at s ${EGO_START_S} (${EGO_START_S - START_S} m past --start), lateral ${egoLateral.toFixed(2)} ` +
    `(lane centre ${EGO_LANE_LATERAL.toFixed(2)}), half width ${road.halfWidthAt(EGO_START_S).toFixed(2)} m, ` +
    `${road.lanesPerSideAt(EGO_START_S)} lane(s) per side`,
);

// ---------------------------------------------------------------- the stream
const traffic = new RoadTraffic(physics, world, scene, origin, road, hazards, loadCarModel, (x, z, radius) => {
  const dx = x - egoPosition.x;
  const dz = z - egoPosition.z;
  return dx * dx + dz * dz > radius * radius;
});
traffic.cap = CAP;

interface StreamCar {
  id: string;
  forwardS: number;
  direction: number;
  style: string;
  lane: number;
  roadLateral: number;
  forwardSpeed: number;
  settleFor: number;
  stoppedFor: number;
  headWait: number;
  holdS: number | null;
  turnS: number;
  layby: unknown;
  vehicle: Vehicle;
  autopilot: Autopilot;
  rails: { speed: number; heldUp: number } | null;
}
interface TrafficPrivate {
  carList: StreamCar[];
  densityFraction: number;
  densityTimer: number;
  bottleneckTurns: Map<string, { startS: number; age: number }>;
  removeAt(index: number): void;
}
const inner = traffic as unknown as TrafficPrivate;
const cars = inner.carList;
/** Max traffic for the whole run: the density draw held at the cap. */
function pinDensity(): void {
  inner.densityFraction = 1;
  inner.densityTimer = 1e9;
}
pinDensity();

// Every removal, and which of them were the stuck recycle (a car standing > 18 s).
let recycledStuck = 0;
let recycledStuckBehind = 0;
let removedTotal = 0;
let measuring = false;
const recycleNotes: string[] = [];
{
  const removeAt = inner.removeAt.bind(traffic);
  inner.removeAt = (index: number) => {
    const car = cars[index]!;
    if (measuring) {
      removedTotal++;
      if (car.stoppedFor > 18) {
        recycledStuck++;
        const rel = car.forwardS - egoS;
        if (car.direction === 1 && rel < 0) recycledStuckBehind++;
        if (recycleNotes.length < 12) {
          recycleNotes.push(
            `${car.id} dir ${car.direction > 0 ? '+' : '-'} at ${rel.toFixed(0)} m from ego, stood ${car.stoppedFor.toFixed(0)} s`,
          );
        }
      }
    }
    removeAt(index);
  };
}

// ---------------------------------------------------------------- measurement
interface Private {
  passUrgeValue: boolean;
  passShopping: boolean;
  lastMayCross: boolean;
  passSecondsValue: number;
  lastCrossingRefused: boolean;
  lastRearClear: boolean;
  corridorFeasible: boolean;
  passingEnabled: boolean;
  yieldingFor: number;
  planLine: number;
  corridorBlockDistance: number;
  corridorBlockSpeed: number;
  corridorLaneBlockDistance: number;
  corridorLaneBlockSpeed: number;
  lastOncomingGap: number;
  holdDistance: number;
  deadlockPermission: boolean;
  homeLaneValue: number;
  /** Nose ray gap to a dynamic body (`axisScan`); under MUST_STOP_GAP_M the pedal is vetoed. */
  bodyScanGap: number;
  /** The stall timer that starts recovery, and the recovery in progress. */
  stoppedFor: number;
  recoveryPhase: string;
}
function reason(p: Private): string {
  if (!p.passUrgeValue) return 'no urge';
  if (!p.lastMayCross) return 'crown closed';
  if (!Number.isFinite(p.passSecondsValue)) return 'no slot';
  if (!p.lastRearClear) return 'rear';
  if (p.lastCrossingRefused) return 'oncoming';
  return 'not chosen';
}
const histograms = new Map<string, Map<string, number>>();
function count(dimension: string, value: string): void {
  let h = histograms.get(dimension);
  if (!h) histograms.set(dimension, (h = new Map()));
  h.set(value, (h.get(value) ?? 0) + FIXED_DT);
}
function bucket(value: number, edges: number[], unit: string): string {
  if (!Number.isFinite(value)) return 'none';
  for (const edge of edges) if (value < edge) return `< ${edge} ${unit}`;
  return `>= ${edges[edges.length - 1]} ${unit}`;
}
const m = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '-');
let measuredSeconds = 0;
/** Same-direction order against the ego; `levelLateral` is where the body was while level with it. */
const order = new Map<string, { rel: number; side: number; levelLateral: number; level: boolean }>();
const oncomingOrder = new Map<string, number>();
const passesByMinute: number[] = [];
let sameDirPasses = 0;
let oncomingPasses = 0;
const passNotes: string[] = [];
const passVia = new Map<string, number>();
let queueSum = 0;
let queueMax = 0;
let queueSamples = 0;
const queueByMinute: { sum: number; n: number; max: number }[] = [];
let headId: string | null = null;
let headStill = 0;
let longestHeadWait = 0;
let longestHeadWaitId = '';
let headSeconds = 0;
const headsSeen = new Set<string>();
const turnsEver = new Set<string>();
const turnNotes: string[] = [];
let egoImpacts = 0;
let queueImpacts = 0;
const impactNotes: string[] = [];
let egoMaxDrift = 0;
let egoMaxSpeedKmh = 0;
let traceTicks = 0;
let liveSum = 0;
/** The head's planned side of the ego, and how often it swapped oncoming lane <-> verge. */
let headPlanId = '';
let headPlanSide = '';
let headPlanFlips = 0;

function measure(): void {
  measuredSeconds += FIXED_DT;
  const minute = Math.floor((measuredSeconds - FIXED_DT / 2) / 60);
  liveSum += cars.length;
  egoMaxDrift = Math.max(egoMaxDrift, Math.hypot(egoS - egoSettledS, egoLateral - egoSettledLateral));
  egoMaxSpeedKmh = Math.max(egoMaxSpeedKmh, ego.speedKmh);
  if (ego.lastImpact && ego.lastImpact.severityMps > 1.8) {
    egoImpacts++;
    if (impactNotes.length < 12) impactNotes.push(`ego hit at ${measuredSeconds.toFixed(1)} s, ${ego.lastImpact.severityMps.toFixed(1)} m/s`);
  }
  for (const [id] of inner.bottleneckTurns) {
    if (!turnsEver.has(id)) {
      turnsEver.add(id);
      const car = cars.find((c) => c.id === id);
      if (car && turnNotes.length < 12) {
        turnNotes.push(`${id} dir ${car.direction > 0 ? '+' : '-'} at ${(car.forwardS - egoS).toFixed(0)} m from ego, t ${measuredSeconds.toFixed(0)} s`);
      }
    }
  }

  let queue = 0;
  let head: StreamCar | null = null;
  for (const car of cars) {
    if (car.settleFor > 0) continue;
    const rel = car.forwardS - egoS;
    if (car.direction === 1) {
      // Behind -> ahead by more than a body, across a continuous change.
      const side = rel > BODY_LENGTH_M ? 1 : rel < -BODY_LENGTH_M ? -1 : 0;
      const previous = order.get(car.id);
      if (side !== 0) {
        if (previous && previous.side === -1 && side === 1 && Math.abs(rel - previous.rel) < CONTINUITY_M) {
          sameDirPasses++;
          passesByMinute[minute] = (passesByMinute[minute] ?? 0) + 1;
          // Where the body was while level with the ego: which way round it went.
          const level = previous.levelLateral;
          const halfWidth = road.halfWidthAt(egoS);
          const via = level > 0 ? 'oncoming lane' : level < -halfWidth ? 'verge / sand (right)' : 'own side, squeezed past';
          passVia.set(via, (passVia.get(via) ?? 0) + 1);
          if (passNotes.length < 12) {
            passNotes.push(`${car.id} (${car.style}) at t ${measuredSeconds.toFixed(0)} s, level at lateral ${level.toFixed(1)} (${via}), now ${car.autopilot.activity}`);
          }
        }
        order.set(car.id, { rel, side, levelLateral: car.roadLateral, level: false });
      } else if (previous) {
        // Level with the ego: keep the lateral furthest from it. `side` stays what it was before.
        previous.rel = rel;
        if (!previous.level || Math.abs(car.roadLateral - egoLateral) > Math.abs(previous.levelLateral - egoLateral)) {
          previous.levelLateral = car.roadLateral;
        }
        previous.level = true;
      }
      if (rel < 0 && rel > -QUEUE_REACH_M && car.vehicle.speedKmh < STOPPED_KMH) queue++;
      if (rel < -1 && rel > -HEAD_REACH_M && (!head || rel > head.forwardS - egoS)) head = car;
      if (rel < 0 && rel > -QUEUE_REACH_M && car.vehicle.lastImpact && car.vehicle.lastImpact.severityMps > 1.8) {
        queueImpacts++;
        if (impactNotes.length < 12) {
          impactNotes.push(`${car.id} ${(rel).toFixed(0)} m behind, ${car.vehicle.lastImpact.severityMps.toFixed(1)} m/s, ${car.autopilot.activity}`);
        }
      }
    } else {
      const previous = oncomingOrder.get(car.id);
      if (previous !== undefined && previous > 0 && rel <= 0 && previous - rel < CONTINUITY_M) oncomingPasses++;
      oncomingOrder.set(car.id, rel);
    }
  }
  queueSum += queue;
  queueSamples++;
  queueMax = Math.max(queueMax, queue);
  const qm = (queueByMinute[minute] ??= { sum: 0, n: 0, max: 0 });
  qm.sum += queue;
  qm.n++;
  qm.max = Math.max(qm.max, queue);

  if (!head) {
    count('head', 'no car within 40 m behind');
    headId = null;
    headStill = 0;
    return;
  }
  const car: StreamCar = head;
  headSeconds += FIXED_DT;
  headsSeen.add(car.id);
  if (car.id !== headId) {
    headId = car.id;
    headStill = 0;
  }
  headStill = car.vehicle.speedKmh < STOPPED_KMH ? headStill + FIXED_DT : 0;
  if (headStill > longestHeadWait) {
    longestHeadWait = headStill;
    longestHeadWaitId = car.id;
  }
  const p = car.autopilot as unknown as Private;
  const ap = car.autopilot;
  const rel = car.forwardS - egoS;
  const laneCentre = road.laneCentreAt(car.forwardS, car.lane);
  const gapToEgo = -rel - BODY_LENGTH_M;
  count('head', 'present');
  count('state', car.rails ? 'rails' : car.settleFor > 0 ? 'settling' : 'driven');
  count('activity', ap.activity);
  count('manoeuvre', String(ap.manoeuvre));
  count('recoveryPhase', p.recoveryPhase);
  count('speed', bucket(car.vehicle.speedKmh, [2, 8, 20, 40], 'km/h'));
  count('centre gap to ego - 4.4 m', bucket(gapToEgo, [0, 2, 5, 10, 20], 'm'));
  count('lateral offset from ego', bucket(Math.abs(car.roadLateral - egoLateral), [0.6, 1.2, 1.8, 2.4], 'm'));
  count('bodyScanGap (nose rays; < 4 m = mustStop)', bucket(p.bodyScanGap, [4, 8, 18], 'm'));
  count('binding speed limit', String(ap.bindingSpeedLimit));
  const sensed = ap.obstacleGap;
  count('obstacleGap (lane probes clamp at 4 m)', bucket(sensed, [4.01, 8, 20, 60], 'm'));
  count('obstacleSpeed', Number.isFinite(sensed) ? bucket(ap.obstacleSpeed * 3.6, [1, 5, 20], 'km/h') : 'none');
  count('laneBlockDistance', bucket(ap.laneBlockDistance, [4.01, 8, 20, 60], 'm'));
  count('laneBlockSpeed (private corridorLaneBlockSpeed)', bucket(p.corridorLaneBlockSpeed * 3.6, [1, 5, 20], 'km/h'));
  count('reason (followReason)', reason(p));
  count('passUrge', String(p.passUrgeValue));
  count('passShopping', String(p.passShopping));
  count('mayCross', String(p.lastMayCross));
  count('rearClear', String(p.lastRearClear));
  count('crossingRefused (oncoming)', String(p.lastCrossingRefused));
  count('passingEnabled (coordinator)', String(p.passingEnabled));
  count('corridorFeasible', String(p.corridorFeasible));
  count('corridorBlock', bucket(p.corridorBlockDistance, [5, 10, 20, 60], 'm'));
  const lineOff = Math.abs(p.planLine - laneCentre);
  count('planLine vs own lane', lineOff > 0.8 ? 'wants across (> 0.8 m)' : lineOff > 0.25 ? 'nudged (0.25-0.8 m)' : 'own lane');
  // Head drives the road's own sense, so its frame is the road's: + is toward the crown.
  const halfWidth = road.halfWidthAt(car.forwardS);
  const side = p.planLine > 0.5 ? 'oncoming lane (left)' : p.planLine < -(halfWidth - 0.9) ? 'verge (right)' : 'own side of crown';
  count('planLine side', side);
  // Every gate on a fresh crossing open at once (coordinator, crown permission, rear, room):
  // the oncoming lane was a line the planner could have taken this step.
  const gatesOpen = p.passingEnabled && p.lastMayCross && p.lastRearClear && !p.lastCrossingRefused;
  count('oncoming lane admissible (all gates open)', String(gatesOpen));
  count(`planLine side | gates ${gatesOpen ? 'open' : 'shut'}`, side);
  if (car.id === headPlanId && side !== headPlanSide && side !== 'own side of crown' && headPlanSide !== 'own side of crown') {
    headPlanFlips++;
  }
  if (car.id !== headPlanId || side !== 'own side of crown') {
    headPlanId = car.id;
    headPlanSide = side;
  }
  count('commandedLine vs own lane', Math.abs(ap.commandedLine - laneCentre) > 0.8 ? 'across' : 'own lane');
  if (inner.bottleneckTurns.has(car.id)) {
    let oncomingHeld = 0;
    let oncomingNear = 0;
    for (const other of cars) {
      if (other.direction !== -1) continue;
      const ahead = other.forwardS - egoS;
      if (ahead < -20 || ahead > 250) continue;
      oncomingNear++;
      if (other.holdS !== null) oncomingHeld++;
    }
    count('turn owner: planLine side', side);
    count('turn owner: oncoming cars (-20..250 m) held', oncomingNear === 0 ? 'none near' : oncomingHeld === 0 ? 'none held' : 'some held');
  }
  count('headWait (coordinator)', bucket(car.headWait, [0.01, 4], 's'));
  count('holdS', car.holdS === null ? 'none' : 'held');
  count('bottleneck turn', inner.bottleneckTurns.has(car.id) ? 'HAS TURN' : turnsEver.has(car.id) ? 'had one' : 'never');
  count('deadlockPermission', String(p.deadlockPermission));
  count('yieldingFor', bucket(p.yieldingFor, [0.01, 5, 20], 's'));
  count('oncoming gap', bucket(p.lastOncomingGap, [50, 100, 200, 400], 'm'));
  if (TRACE_HEAD && ++traceTicks % Math.round(0.5 / FIXED_DT) === 0) {
    console.log(
      `  t ${measuredSeconds.toFixed(1).padStart(5)} ${car.id.padEnd(12)} ${car.style.padEnd(8)} ${car.rails ? 'rails ' : 'driven'} ` +
        `rel ${rel.toFixed(1)} lat ${car.roadLateral.toFixed(2)} v ${car.vehicle.speedKmh.toFixed(0)} ` +
        `${ap.activity}/${ap.manoeuvre} obs ${m(sensed)}@${(ap.obstacleSpeed * 3.6).toFixed(0)} ` +
        `laneBlk ${m(ap.laneBlockDistance)}@${(p.corridorLaneBlockSpeed * 3.6).toFixed(0)} ` +
        `urge ${p.passUrgeValue ? 1 : 0} shop ${p.passShopping ? 1 : 0} may ${p.lastMayCross ? 1 : 0} rear ${p.lastRearClear ? 1 : 0} ` +
        `ref ${p.lastCrossingRefused ? 1 : 0} pe ${p.passingEnabled ? 1 : 0} feas ${p.corridorFeasible ? 1 : 0} ` +
        `blk ${m(p.corridorBlockDistance)} plan ${p.planLine.toFixed(2)} lane ${laneCentre.toFixed(2)} cmd ${ap.commandedLine.toFixed(2)} ` +
        `hw ${car.headWait.toFixed(1)} hold ${car.holdS === null ? '-' : (car.holdS - car.forwardS).toFixed(0)} ` +
        `turn ${inner.bottleneckTurns.has(car.id) ? 1 : 0} yield ${p.yieldingFor.toFixed(0)} onc ${m(p.lastOncomingGap)} ` +
        `scan ${m(p.bodyScanGap)} lim ${ap.bindingSpeedLimit} stall ${p.stoppedFor.toFixed(1)} rec ${p.recoveryPhase}`,
    );
  }
}

let ticks = 0;
async function tick(): Promise<void> {
  pinDensity();
  traffic.fixedUpdate(FIXED_DT, egoS, egoLateral, 0, 0);
  ego.fixedUpdate(FIXED_DT, egoInput);
  physics.step();
  ego.postStep();
  traffic.postStep();
  ego.absoluteTranslation(egoPosition);
  const projection = road.project(egoPosition.x, egoPosition.z, egoS);
  egoS = projection.s;
  egoLateral = projection.lateral;
  // A spawn waits on a model-load promise; a fully synchronous loop never lets it land.
  if (++ticks % 6 === 0) await Bun.sleep(0);
}

const wallStart = Date.now();
for (let i = 0; i < Math.ceil(WARMUP_S / FIXED_DT); i++) await tick();
console.log(`  after warm-up: ${cars.length} live, target ${traffic.status.target}`);
measuring = true;
for (let i = 0; i < Math.ceil(MEASURE_S / FIXED_DT); i++) {
  await tick();
  measure();
}
measuring = false;

// ---------------------------------------------------------------- findings
const minutes = measuredSeconds / 60;
console.log('');
console.log(`measured ${measuredSeconds.toFixed(0)} s in ${((Date.now() - wallStart) / 1000).toFixed(0)} s wall; mean live ${(liveSum / queueSamples).toFixed(1)} cars`);
console.log(`ego: drift ${egoMaxDrift.toFixed(3)} m from its settled pose, top speed ${egoMaxSpeedKmh.toFixed(2)} km/h, final lateral ${egoLateral.toFixed(2)}`);
console.log('');
console.log(`got past the ego (same direction): ${sameDirPasses} (${(sameDirPasses / minutes).toFixed(2)}/min); per minute ${Array.from({ length: Math.ceil(minutes) }, (_, i) => passesByMinute[i] ?? 0).join(' ')}`);
for (const note of passNotes) console.log(`    ${note}`);
console.log(`  went by on: ${[...passVia.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`oncoming cars past the ego's position: ${oncomingPasses} (${(oncomingPasses / minutes).toFixed(2)}/min)`);
console.log(
  `queue (same direction, standing, within ${QUEUE_REACH_M} m behind): mean ${(queueSum / queueSamples).toFixed(1)}, max ${queueMax}; ` +
    `per minute mean/max ${queueByMinute.map((q) => `${(q.sum / q.n).toFixed(1)}/${q.max}`).join(' ')}`,
);
console.log(`longest queue-head standstill: ${longestHeadWait.toFixed(1)} s (${longestHeadWaitId}); distinct heads ${headsSeen.size}; head present ${headSeconds.toFixed(0)} s`);
console.log(`head's planned side swapped oncoming lane <-> verge ${headPlanFlips} times (${(headPlanFlips / Math.max(headSeconds / 60, 1e-9)).toFixed(1)} per head-minute)`);
console.log(`bottleneck turns ever assigned (any car): ${turnsEver.size}`);
for (const note of turnNotes) console.log(`    ${note}`);
console.log(`removed cars: ${removedTotal}; of them stuck recycles (stood > 18 s): ${recycledStuck}, behind the ego same direction: ${recycledStuckBehind}`);
for (const note of recycleNotes) console.log(`    ${note}`);
console.log(`contacts: ego ${egoImpacts}, queue (within ${QUEUE_REACH_M} m behind) ${queueImpacts}`);
for (const note of impactNotes) console.log(`    ${note}`);
console.log('');
console.log(`queue head (nearest same-direction car < ${HEAD_REACH_M} m behind), share of the time a head was present ('head': of all measured time):`);
for (const [dimension, h] of histograms) {
  const total = dimension === 'head' ? measuredSeconds : headSeconds;
  const parts = [...h.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v / Math.max(total, 1e-9)) * 100).toFixed(0)}%`);
  console.log(`  ${dimension.padEnd(46)} ${parts.join(', ')}`);
}
