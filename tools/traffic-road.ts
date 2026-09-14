/**
 * tools/traffic-road.ts — the ambient stream, measured on a REAL stretch of the REAL road.
 *
 * Not a circuit, not a flat plane, not a synthetic obstacle course: the same `Road`,
 * `Terrain`, `SurfaceField` and `ScatterProvider` the game streams at this seed, a real
 * physics ribbon under it, real `Vehicle` bodies, the shipped `RoadTraffic`, and an EGO
 * car — a real Vehicle under a real Autopilot — driving the stretch inside the stream
 * rather than a scalar arclength pretending to be the player. Traffic therefore has a
 * body to queue behind, to be overtaken by, and to meet head-on.
 *
 * WHAT IS MEASURED IS WHAT THE EYE SEES, AND THAT IS THE WHOLE POINT OF THIS FILE.
 *
 * The previous revision counted direction reversals of the COMMANDED LINE — the
 * planner's opinion — with a 0.1 mm deadband, and divided them by a car-km figure that
 * subtracted oncoming traffic from same-direction traffic because it accumulated signed
 * `forwardS` deltas. Both halves of the ratio were wrong, so the number it printed could
 * not be reasoned about at all.
 *
 * So:
 *   - distance is each car's own progress ALONG ITS OWN DIRECTION, never signed s;
 *   - weave is measured on the CHASSIS: the lateral error against the line that car
 *     itself commanded, counted as peak-to-peak reversals above an amplitude that is
 *     visible (0.15 m), not above numerical noise;
 *   - pace is per car over its life, so one stopped car cannot outvote a moving stream
 *     by contributing sixty samples a second;
 *   - conflict is contact, near-contact and time spent over the crown with something
 *     coming;
 *   - a jam is car-seconds lost below walking pace, and the longest single stop.
 *
 * Usage:
 *   bun tools/traffic-road.ts [seed] [--minutes N] [--start S] [--trace]
 */

import * as THREE from 'three';

import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { variant } from '../src/parts/registry';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  loadCarModel,
  preloadCarModels,
} from '../src/render/carmodel';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { Autopilot, type AutopilotMode } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { installAssetShim } from './assetshim';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { RoadDistance } from '../src/world/roaddistance';
import { TerrainMeshProvider } from '../src/world/terrainmesh';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { ScatterProvider } from '../src/world/props';
import { Terrain } from '../src/world/terrain';
import { RoadTraffic } from '../src/world/traffic';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { installDocumentShim } from './domshim';

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
// The road ribbon paints its asphalt maps on a canvas; the shim lets the REAL provider
// run headless rather than measuring a stand-in surface.
installDocumentShim();

// ---------------------------------------------------------------- configuration
const args = process.argv.slice(2);
function flag(name: string, fallback: number): number {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] !== undefined) return Number(args[index + 1]);
  return fallback;
}
const SEED = Number(args.find((a) => !a.startsWith('--') && Number.isFinite(Number(a))) ?? 1337);
/** Where the measured drive begins. Past the garage ramp, so the road is its own. */
const START_S = flag('start', 40_000);
/** Minutes of measured traffic; the warm-up before it is not measured. */
const MEASURE_S = flag('minutes', 10) * 60;
const WARMUP_S = flag('warmup', 90);
const TRACE = args.includes('--trace');
/**
 * Diagnostic: run the ego driver down the same real stretch, with the same real props,
 * and NO stream at all. What is left is the road; what the stream adds is the
 * difference between the two runs.
 */
const SOLO = args.includes('--solo');
/** The ego driver's character. It is the player's own autopilot, at its middle setting. */
const EGO_MODE: AutopilotMode = 'hurried';
const EGO_MODEL = 'sv_vaz2105r';
/** Room the ribbon keeps past the widest carriageway, for verges and excursions. */
const RIBBON_HALF_WIDTH = ROAD_HALF_WIDTH * 2 + 4;
/**
 * Amplitude, metres, a lateral excursion has to reach before it counts as a weave
 * rather than as lane keeping. A tenth of a lane: below it nothing is visible from
 * outside the car, above it the body is visibly moving across its own line.
 */
const WEAVE_AMPLITUDE_M = 0.15;
/** Same, for the commanded line, and for the steering command as a fraction of lock. */
const LINE_CHURN_AMPLITUDE_M = 0.15;
const STEER_REVERSAL_AMPLITUDE = 0.08;
/**
 * How far the commanded line may sit from the lane centre and still count as "this
 * driver is holding its lane". Wider than lane-keeping wander, far narrower than any
 * deliberate move: a detour worth making is most of a car width.
 */
const LANE_HOLD_TOLERANCE_M = 0.25;
/** Seconds the line must have been home before the body is judged on holding it. */
const LANE_HOLD_SETTLE_S = 1.5;
/** And the body within this of its lane centre, before the judging starts. */
const LANE_HOLD_ENTRY_M = 0.35;
/** Below this a car is not making progress, whatever its reason. */
const CRAWL_KMH = 8;
/** And below this it is not moving at all, which is a different fault from a queue. */
const STOPPED_KMH = 2;
/** Bumper-to-bumper distance below which two cars in a lane count as a near miss. */
const NEAR_MISS_M = 1.2;
const BODY_LENGTH_M = 4.4;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
}

console.log(
  `real-road traffic bench, seed ${SEED}, s ${START_S}, ${(MEASURE_S / 60).toFixed(0)} measured min`,
);

// ---------------------------------------------------------------- the world
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const physics = await PhysicsWorld.create();
const surface = new SurfaceField(SEED);
const world = new GameWorld(newWorldState(SEED));

/** Rapier's broad-phase only knows a collider once the world has stepped. */
function settle(): void {
  physics.step();
}

/**
 * How much road to build. Sized from an optimistic ego pace so the stretch never runs
 * out under the car, and bounded by the road itself.
 */
const REACH_M = Math.min(
  road.length - CHUNK_LENGTH - START_S - 400,
  (MEASURE_S + WARMUP_S) * 28 + 2_000,
);
const lastS = START_S + REACH_M;

// THE REAL ROAD, THE REAL DESERT AND THE REAL PROPS, FROM THE REAL PROVIDERS.
//
// Every earlier revision of this bench laid its own asphalt: one flat ribbon a couple
// of car widths wider than the carriageway, tagged `Asphalt` from edge to edge, with
// nothing at all beyond it. Three things were wrong with that, and all three decide
// the behaviour this bench exists to measure:
//
//   - the SHOULDER had asphalt grip, so easing round a boulder onto the verge was
//     free. It is sand, and it is meant to be a decision;
//   - past the ribbon there was a void. Cars that left the road fell into it and were
//     thrown back out at three hundred km/h, which the run then scored as autopilot
//     excursions and contacts;
//   - the road's own crown, camber and edge came from a two-column strip rather than
//     from the mesh the game builds.
//
// `RoadMeshProvider` and `TerrainMeshProvider` are the shipped providers. They build
// their colliders disabled, exactly as the streamer requires, so the bench enables
// them itself — the one thing `ChunkStreamer` would otherwise do here.
const hazards = new HazardIndex();
const roadProvider = new RoadMeshProvider(SEED);
const terrainProvider = new TerrainMeshProvider(new RoadDistance(road));
const scatter = new ScatterProvider(undefined, hazards);
{
  const first = Math.floor((START_S - 400) / CHUNK_LENGTH);
  const last = Math.ceil(lastS / CHUNK_LENGTH);
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
    };
    for (const provider of [terrainProvider, roadProvider, scatter]) {
      const content = provider.build(context);
      if (!content) continue;
      for (const collider of content.colliders) collider.setEnabled(true);
    }
  }
}
settle();

// ---------------------------------------------------------------- the ego car
await preloadCarModels([EGO_MODEL]);

/**
 * WHERE THE EGO CAR STARTS, and why it is not simply `START_S`.
 *
 * The stream validates every spawn against the hazard index before it puts a body
 * down; the bench used to drop its own car on a fixed arclength and hope. On seed
 * 545124 that arclength has a scatter prop on it: the ego spawned inside a rock, never
 * moved for the whole four minutes, and the run then scored the traffic that piled up
 * around a permanently stopped player as thirty contacts and a jam. A degenerate start
 * is not a measurement.
 */
function clearStart(): number {
  const HAZARD_GAP_M = 20;
  for (let s = START_S; s < START_S + 2_000; s += 10) {
    let blocked = false;
    hazards.forEachAhead(s - HAZARD_GAP_M, HAZARD_GAP_M * 2, (hazard) => {
      if (Math.abs(hazard.lateral) - hazard.radius < road.halfWidthAt(hazard.s) + 2) blocked = true;
    });
    if (!blocked) return s;
  }
  return START_S;
}
const EGO_START_S = clearStart();
if (EGO_START_S !== START_S) {
  console.log(`  ego starts at s ${EGO_START_S} — ${EGO_START_S - START_S} m past the first clear point`);
}

function egoState(): CarState {
  const def = carModel(EGO_MODEL);
  const engine = variant(def.engineId).engine;
  const sample = road.sampleAt(EGO_START_S);
  const point = road.offsetPoint(EGO_START_S, road.laneCentreAt(EGO_START_S, 0));
  return {
    id: 'ego',
    modelId: EGO_MODEL,
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: 40,
    fuelKind: engine?.fuel ?? null,
    dirt: 0,
    scratches: 0,
    damage: [],
    waterLitres: 10,
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('ego', def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: point.x,
    // THE HEIGHT OF THE COLLIDER, NOT THE HEIGHT OF THE SPINE.
    //
    // `offsetPoint` returns the road's centreline geometry; the slab the wheels
    // actually touch is `roadSurfaceY`, which adds the crown, the camber and the
    // surface's own bumps on top of it. Where that is higher than the spine the car
    // spawns INSIDE the mesh, and Rapier resolves the penetration by pinning it:
    // measured on seed 545124 as an ego that sat on its own lane centre, with a clear
    // corridor and nothing in front of it, for the whole four-minute run.
    y: carSpawnYAboveGround(
      carModelMeasure(EGO_MODEL),
      roadSurfaceY(road, surface, EGO_START_S, road.laneCentreAt(EGO_START_S, 0), point.x, point.z),
      0,
    ),
    z: point.z,
    qx: 0,
    qy: Math.sin(sample.heading / 2),
    qz: 0,
    qw: Math.cos(sample.heading / 2),
  };
}

const egoCarState = egoState();
// The stream treats the player's car as a real participant: it keeps its spawns clear
// of it and reports it to oncoming drivers. A bench whose ego is not the driven car
// measures a stream that cannot see the thing it is supposed to be driving around.

world.state.cars[egoCarState.id] = egoCarState;
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const ego = new Vehicle(physics, world, egoCarState, scene, origin);
const egoAutopilot = new Autopilot(road, hazards, physics);
world.state.player.drivingCarId = egoCarState.id;
const egoInput: InputFrame = emptyInput();
// Land before anything is measured, on the brake: three seconds of suspension settle
// without a pedal rolls the car down the local grade.
egoInput.brake = 1;
for (let i = 0; i < 180; i++) {
  ego.fixedUpdate(FIXED_DT, egoInput);
  physics.step();
  ego.postStep();
}
egoInput.brake = 0;
egoAutopilot.setMode(EGO_MODE);
egoAutopilot.setEngaged(true);

const egoPosition = { x: 0, y: 0, z: 0 };
let egoS = EGO_START_S;
let egoLateral = 0;

// ---------------------------------------------------------------- the stream
const traffic = new RoadTraffic(
  physics,
  world,
  scene,
  origin,
  road,
  hazards,
  loadCarModel,
  (x: number, z: number, radius: number) => {
    const dx = x - egoPosition.x;
    const dz = z - egoPosition.z;
    return dx * dx + dz * dz > radius * radius;
  },
);
traffic.setDaylightFactor(1);

interface StreamCar {
  id: string;
  forwardS: number;
  direction: number;
  style: string;
  lane: number;
  modelId: string;
  roadLateral: number;
  settleFor: number;
  vehicle: Vehicle;
  autopilot: Autopilot;
}
const cars = (traffic as unknown as { carList: readonly StreamCar[] }).carList;

// ---------------------------------------------------------------- measurement
/**
 * A peak counter, not a sign counter.
 *
 * Counting sign changes of a signal answers "did this number ever go the other way",
 * which every physical signal does constantly. What is wanted is "did the thing move
 * one way and then visibly back": a reversal is only counted once the signal has
 * retraced `amplitude` from its own last extreme, and the extreme travels with it.
 */
class PeakCounter {
  private extreme: number;
  private direction = 0;
  count = 0;
  constructor(
    private readonly amplitude: number,
    start: number,
  ) {
    this.extreme = start;
  }
  push(value: number): void {
    if (this.direction === 0) {
      if (Math.abs(value - this.extreme) >= this.amplitude) {
        this.direction = Math.sign(value - this.extreme);
        this.extreme = value;
      }
      return;
    }
    if (Math.sign(value - this.extreme) === this.direction) {
      this.extreme = value;
      return;
    }
    if (Math.abs(value - this.extreme) >= this.amplitude) {
      this.count++;
      this.direction = -this.direction;
      this.extreme = value;
    }
  }
}

interface Track {
  id: string;
  style: string;
  direction: number;
  modelId: string;
  /** Metres of road covered in this car's own direction of travel. */
  progress: number;
  seconds: number;
  lastS: number;
  samples: number;
  /**
   * LANE KEEPING IS MEASURED ONLY WHILE THE DRIVER IS KEEPING ITS LANE.
   *
   * A car easing round a boulder or crossing to overtake is SUPPOSED to be off its
   * lane centre, and its body is supposed to lag the rate-limited line it is being
   * given. Counting those metres as lane-keeping error measures the manoeuvre, not the
   * controller — and manoeuvres are judged by contacts, pace and jams, which are
   * separate numbers below. So these accumulate only while the commanded line IS the
   * lane the driver was given.
   */
  holding: boolean;
  holdDwell: number;
  holdProgress: number;
  holdSamples: number;
  holdSumErrSq: number;
  holdMaxErr: number;
  holdSumHeadingSq: number;
  weave: PeakCounter;
  lineChurn: PeakCounter;
  steer: PeakCounter;
  crawlSeconds: number;
  stoppedFor: number;
  longestStop: number;
  longestStopWhy: string;
  worstOffRoad: number;
  worstOffRoadWhy: string;
  activitySeconds: Map<string, number>;
}
const tracks = new Map<string, Track>();
const speedByCarSecond: number[] = [];
const liveSamples: number[] = [];
let measuredSeconds = 0;
let sameDirectionEmpty = 0;
let anyDirectionEmpty = 0;
let nearMisses = 0;
let crownExposureSeconds = 0;
let minSameLaneGap = Infinity;
let egoImpacts = 0;
const contacts: string[] = [];
const passedTheLine = new Set<string>();
const PASS_LINE_M = EGO_START_S + 1_500;
const history = new Map<string, string[]>();

const position = { x: 0, y: 0, z: 0 };

function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function bodyHeading(vehicle: Vehicle): number {
  const rotation = vehicle.chassis.rotation();
  const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
  const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
  return Math.atan2(forwardX, forwardZ);
}

function trackOf(
  id: string,
  style: string,
  direction: number,
  modelId: string,
  s: number,
  line: number,
  steer: number,
): Track {
  let track = tracks.get(id);
  if (!track) {
    track = {
      id,
      style,
      direction,
      modelId,
      progress: 0,
      seconds: 0,
      lastS: s,
      samples: 0,
      holding: false,
      holdDwell: 0,
      holdProgress: 0,
      holdSamples: 0,
      holdSumErrSq: 0,
      holdMaxErr: 0,
      holdSumHeadingSq: 0,
      weave: new PeakCounter(WEAVE_AMPLITUDE_M, 0),
      lineChurn: new PeakCounter(LINE_CHURN_AMPLITUDE_M, line),
      steer: new PeakCounter(STEER_REVERSAL_AMPLITUDE, steer),
      crawlSeconds: 0,
      stoppedFor: 0,
      longestStop: 0,
      longestStopWhy: "",
      worstOffRoad: 0,
      worstOffRoadWhy: "",
      activitySeconds: new Map(),
    };
    tracks.set(id, track);
  }
  return track;
}

/**
 * One driver, one measured step. `direction` is +1 for a car driving the road's own
 * sense and -1 for one driving it backwards; everything the driver believes about
 * itself is expressed in ITS frame, so the base-frame lateral is mirrored into that
 * frame before it is compared with the lane it was given.
 */
function sampleCar(
  id: string,
  style: string,
  modelId: string,
  direction: number,
  lane: number,
  vehicle: Vehicle,
  autopilot: Autopilot,
  s: number,
  baseLateral: number,
): void {
  const line = autopilot.commandedLine;
  const steer = vehicle.steeringFraction;
  const track = trackOf(id, style, direction, modelId, s, line, steer);
  const localLateral = baseLateral * direction;
  const laneCentre = road.laneCentreAt(s, lane);
  const laneError = localLateral - laneCentre;
  const advance = (s - track.lastS) * direction;
  track.lastS = s;
  const moved = advance > 0 && advance < 20 ? advance : 0;
  track.progress += moved;
  track.seconds += FIXED_DT;
  const speedKmh = vehicle.speedKmh;
  track.samples++;
  const roadHeading = road.sampleAt(s).heading + (direction < 0 ? Math.PI : 0);
  const headingError = wrapAngle(bodyHeading(vehicle) - roadHeading);
  const activity = autopilot.activity;
  // SETTLED IN ITS LANE, AS A LATCHED STATE.
  //
  // A manoeuvre releases the commanded line the moment its reason is behind the
  // bumper, and the body is still out there at that point; charging those metres to
  // lane keeping measures the manoeuvre's tail. So the driver has to arrive — line
  // home, body in the lane, for `LANE_HOLD_SETTLE_S` — before it is judged. And once
  // it has arrived, it STAYS judged however far it then wanders, because wandering is
  // the thing being measured.
  const lineHome =
    (activity === 'cruise' || activity === 'follow') &&
    Math.abs(line - laneCentre) <= LANE_HOLD_TOLERANCE_M;
  if (!lineHome) {
    track.holding = false;
    track.holdDwell = 0;
  } else if (!track.holding) {
    track.holdDwell = Math.abs(laneError) <= LANE_HOLD_ENTRY_M ? track.holdDwell + FIXED_DT : 0;
    if (track.holdDwell >= LANE_HOLD_SETTLE_S) track.holding = true;
  }
  if (track.holding) {
    track.holdProgress += moved;
    track.holdSamples++;
    track.holdSumErrSq += laneError * laneError;
    track.holdMaxErr = Math.max(track.holdMaxErr, Math.abs(laneError));
    track.holdSumHeadingSq += headingError * headingError;
    track.weave.push(laneError);
  }
  track.lineChurn.push(line);
  track.steer.push(steer);
  track.activitySeconds.set(activity, (track.activitySeconds.get(activity) ?? 0) + FIXED_DT);
  // A QUEUE AND A WEDGE ARE DIFFERENT FAULTS. Crawling is traffic being traffic;
  // standing still is a driver that has stopped being one.
  if (speedKmh < CRAWL_KMH) track.crawlSeconds += FIXED_DT;
  if (speedKmh < STOPPED_KMH) {
    track.stoppedFor += FIXED_DT;
    if (track.stoppedFor > track.longestStop) {
      track.longestStop = track.stoppedFor;
      // WHY, not just how long. The controller's own verdicts are private, and a stop
      // is exactly the moment they matter: a driver waiting for a gap, a driver that
      // believes it has no corridor at all, and a driver forbidden to cross by the
      // stream coordinator are three different faults that look identical from outside.
      const inner = autopilot as unknown as Partial<{
        corridorFeasible: boolean;
        passingEnabled: boolean;
        yieldingFor: number;
        planLine: number;
        hazardDistance: number;
        corridorBlockDistance: number;
        lastOncomingGap: number;
        lastRearClear: boolean;
        lastMayCross: boolean;
      }>;
      const metres = (value: number | undefined): string =>
        value === undefined || value === Infinity ? '-' : value.toFixed(0);
      track.longestStopWhy =
        `${activity} at lateral ${localLateral.toFixed(1)}, ` +
        `${autopilot.obstacleGap === Infinity ? 'nothing ahead' : `${autopilot.obstacleGap.toFixed(0)} m ahead at ${(autopilot.obstacleSpeed * 3.6).toFixed(0)} km/h`}` +
        `, line ${(inner.planLine ?? 0).toFixed(1)}` +
        `, ${inner.corridorFeasible ? 'corridor ok' : 'no corridor'}` +
        `, block ${metres(inner.corridorBlockDistance)}` +
        `, hazard ${metres(inner.hazardDistance)}` +
        `, ${inner.passingEnabled ? 'crossing allowed' : 'crossing barred'}` +
        `, yielded ${(inner.yieldingFor ?? 0).toFixed(0)} s` +
        `, may cross ${inner.lastMayCross ?? '?'}` +
        `, oncoming ${metres(inner.lastOncomingGap)}` +
        `, rear ${inner.lastRearClear ?? '?'}`;
    }
  } else {
    track.stoppedFor = 0;
  }
  // THE SIX SECONDS BEFORE A CONTACT, which is the only place the cause of one is
  // visible. A contact line says two cars touched; it cannot say whether the driver
  // was tracking the other car the whole way in and never lifted, or never saw it at
  // all, or was in a lane the other one then moved into. Those are three different
  // defects. Kept only under `--trace`, where the run is already being read rather
  // than counted.
  if (TRACE) {
    let log = history.get(id);
    if (!log) {
      log = [];
      history.set(id, log);
    }
    const inner = autopilot as unknown as {
      corridorBlockDistance: number;
      corridorBlockSpeed: number;
      planLine: number;
      appliedLateral: number;
      corridorFeasible: boolean;
    };
    log.push(
      `s${(s - START_S).toFixed(0)} lat${localLateral.toFixed(1)} v${speedKmh.toFixed(0)} ` +
        `${activity} gap${autopilot.obstacleGap === Infinity ? '-' : autopilot.obstacleGap.toFixed(0)}` +
        `@${(autopilot.obstacleSpeed * 3.6).toFixed(0)}` +
        ` blk${inner.corridorBlockDistance === Infinity ? '-' : inner.corridorBlockDistance.toFixed(0)}` +
        `@${(inner.corridorBlockSpeed * 3.6).toFixed(0)}` +
        ` ln${inner.planLine.toFixed(1)}/${inner.appliedLateral.toFixed(1)}` +
        `${inner.corridorFeasible ? '' : ' NOWAY'}`,
    );
    if (log.length > 360) log.shift();
  }
  // A CONTACT IS THE ONE EVENT WORTH A SENTENCE OF ITS OWN.
  //
  // A counter says the stream crashes; it cannot say whether it rear-ends its own
  // queue, meets oncoming traffic head-on, or drives into the scenery. Every one of
  // those is a different defect with a different fix, so each contact is recorded with
  // what the driver was doing when it happened — INCLUDING what it could see. A
  // follower that hit the car in front while tracking it at a sensible distance is a
  // braking fault; one that hit it with nothing in its corridor at all is a sensing
  // fault, and the two share no code.
  const impact = vehicle.lastImpact;
  if (impact && impact.severityMps > 1.8) {
    contacts.push(
      `${id} (${style}, dir ${direction > 0 ? '+' : '-'}) ${activity} at ${speedKmh.toFixed(0)} km/h, ` +
        `${impact.severityMps.toFixed(1)} m/s, lateral ${localLateral.toFixed(1)} m, s ${(s - START_S).toFixed(0)}` +
        `, saw ${
          autopilot.obstacleGap === Infinity
            ? 'nothing'
            : `${autopilot.obstacleGap.toFixed(0)} m at ${(autopilot.obstacleSpeed * 3.6).toFixed(0)} km/h`
        }`,
    );
    const log = history.get(id);
    if (log && log.length) {
      contacts.push(`      before it: ${log.filter((_, i) => i % 20 === 0).join(' | ')}`);
    }
  }
  // Off the asphalt, and by how much — with who and what they were doing, because one
  // number cannot tell a wheel on the verge from a car out in the desert.
  const pastEdge = Math.abs(baseLateral) - road.halfWidthAt(s);
  if (pastEdge > track.worstOffRoad) {
    track.worstOffRoad = pastEdge;
    track.worstOffRoadWhy = `${activity} at ${speedKmh.toFixed(0)} km/h, s ${(s - START_S).toFixed(0)}`;
  }
  speedByCarSecond.push(speedKmh);
  // Over the crown, in this car's own sense: positive local lateral is to its left.
  if (localLateral > 0.55) crownExposureSeconds += FIXED_DT;
}

let ticks = 0;
async function tick(): Promise<void> {
  // The game feeds the player's own autopilot the stream's nearest approaching car
  // every step (`main.ts`), and the crown-crossing gate reads it. A bench that skips
  // it measures a driver with no idea what is coming.
  egoAutopilot.setLightingConditions(1, traffic.nearestOncomingDistance(egoS, 1));
  egoAutopilot.drive(FIXED_DT, ego, egoInput, 0, 0);
  ego.fixedUpdate(FIXED_DT, egoInput);
  if (!SOLO) traffic.fixedUpdate(FIXED_DT, egoS, 0, 0);
  physics.step();
  ego.postStep();
  traffic.postStep();
  if (ego.lastImpact && ego.lastImpact.severityMps > 1.8) egoImpacts++;
  ego.absoluteTranslation(egoPosition);
  const projection = road.project(egoPosition.x, egoPosition.z, egoS);
  egoS = projection.s;
  egoLateral = projection.lateral;
  // A spawn waits on a model-load promise, so a fully synchronous loop never lets
  // `finishSpawn` run and measures a road that cannot fill.
  if (++ticks % 6 === 0) await Bun.sleep(0);
}

async function run(seconds: number, record: boolean): Promise<void> {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    await tick();
    if (!record) continue;
    measuredSeconds += FIXED_DT;
    liveSamples.push(cars.length);
    sampleCar('ego', 'ego', EGO_MODEL, 1, 0, ego, egoAutopilot, egoS, egoLateral);

    let nearestAhead = Infinity;
    let nearestSameAhead = Infinity;
    for (const car of cars) {
      if (car.settleFor > 0) continue;
      const gap = car.forwardS - egoS;
      if (gap >= 0 && gap < nearestAhead) nearestAhead = gap;
      if (car.direction === 1 && gap >= 0 && gap < nearestSameAhead) nearestSameAhead = gap;
      sampleCar(
        car.id,
        car.style,
        car.modelId,
        car.direction,
        car.lane,
        car.vehicle,
        car.autopilot,
        car.forwardS,
        car.roadLateral,
      );
      if (car.forwardS >= PASS_LINE_M && car.direction === 1) passedTheLine.add(car.id);
    }
    if (!(nearestAhead <= 300)) anyDirectionEmpty += FIXED_DT;
    if (!(nearestSameAhead <= 300)) sameDirectionEmpty += FIXED_DT;
    // Closest same-direction pair, bumper to bumper, over all pairs sharing a lane.
    for (let a = 0; a < cars.length; a++) {
      const first = cars[a]!;
      if (first.settleFor > 0) continue;
      for (let b = a + 1; b < cars.length; b++) {
        const second = cars[b]!;
        if (second.settleFor > 0 || second.direction !== first.direction) continue;
        if (Math.abs(first.roadLateral - second.roadLateral) > 1.6) continue;
        const gap = Math.abs(first.forwardS - second.forwardS) - BODY_LENGTH_M;
        if (gap < minSameLaneGap) minSameLaneGap = gap;
        if (gap < NEAR_MISS_M) nearMisses++;
      }
    }
  }
}

const buildEnd = Date.now();
await run(WARMUP_S, false);
const afterWarmup = { live: cars.length, target: traffic.status.target };
await run(MEASURE_S, true);

// ---------------------------------------------------------------- findings
const measured = [...tracks.values()].filter((t) => t.id !== 'ego' && t.progress > 200);
const egoTrack = tracks.get('ego')!;
const totalKm = measured.reduce((sum, t) => sum + t.progress, 0) / 1000;
const carSeconds = measured.reduce((sum, t) => sum + t.seconds, 0);

function per(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}
/** A car's own mean pace over its life: km/h of road actually covered. */
const paceByCar = measured.map((t) => (t.progress / Math.max(t.seconds, 1e-3)) * 3.6);
const holdKm = measured.reduce((sum, t) => sum + t.holdProgress, 0) / 1000;
const weavePerKm =
  measured.reduce((sum, t) => sum + t.weave.count, 0) / Math.max(holdKm, 1e-3);
const churnPerKm =
  measured.reduce((sum, t) => sum + t.lineChurn.count, 0) / Math.max(totalKm, 1e-3);
const steerPerKm =
  measured.reduce((sum, t) => sum + t.steer.count, 0) / Math.max(totalKm, 1e-3);
const laneErrRms = Math.sqrt(
  measured.reduce((sum, t) => sum + t.holdSumErrSq, 0) /
    Math.max(measured.reduce((sum, t) => sum + t.holdSamples, 0), 1),
);
const headingRms =
  (Math.sqrt(
    measured.reduce((sum, t) => sum + t.holdSumHeadingSq, 0) /
      Math.max(measured.reduce((sum, t) => sum + t.holdSamples, 0), 1),
  ) *
    180) /
  Math.PI;
const worstLaneErr = measured.reduce((worst, t) => Math.max(worst, t.holdMaxErr), 0);
const longestStop = measured.reduce((worst, t) => Math.max(worst, t.longestStop), 0);
const worstOffRoad = measured.reduce((worst, t) => Math.max(worst, t.worstOffRoad), 0);
const crawlShare = measured.reduce((sum, t) => sum + t.crawlSeconds, 0) / Math.max(carSeconds, 1e-3);
const models = new Set(measured.map((t) => t.modelId));
const styles = new Set(measured.map((t) => t.style));
const activity = new Map<string, number>();
for (const track of measured) {
  for (const [name, seconds] of track.activitySeconds) {
    activity.set(name, (activity.get(name) ?? 0) + seconds);
  }
}

const paceByStyle = new Map<string, number[]>();
for (const track of measured) {
  const list = paceByStyle.get(track.style) ?? [];
  list.push((track.progress / Math.max(track.seconds, 1e-3)) * 3.6);
  paceByStyle.set(track.style, list);
}

console.log('');
console.log(
  `measured ${(measuredSeconds / 60).toFixed(1)} min, ${measured.length} cars, ` +
    `${totalKm.toFixed(1)} car-km, ${(carSeconds / 60).toFixed(0)} car-min ` +
    `(build+run ${((Date.now() - buildEnd) / 1000).toFixed(0)} s wall)`,
);
console.log(
  `  stability: ${weavePerKm.toFixed(1)} body weaves/km (>${WEAVE_AMPLITUDE_M} m), ` +
    `lane error RMS ${laneErrRms.toFixed(2)} m worst ${worstLaneErr.toFixed(2)} m, ` +
    `heading RMS ${headingRms.toFixed(2)}deg`,
);
console.log(
  `  control:   ${churnPerKm.toFixed(1)} commanded-line reversals/km, ` +
    `${steerPerKm.toFixed(1)} steering reversals/km`,
);
console.log(
  `  pace/car, km/h: p10 ${per(paceByCar, 0.1).toFixed(0)}  p25 ${per(paceByCar, 0.25).toFixed(0)}` +
    `  median ${per(paceByCar, 0.5).toFixed(0)}  p75 ${per(paceByCar, 0.75).toFixed(0)}` +
    `  p90 ${per(paceByCar, 0.9).toFixed(0)}`,
);
for (const [style, list] of [...paceByStyle].sort()) {
  console.log(
    `      ${style.padEnd(9)} ${list.length.toString().padStart(3)} cars, ` +
      `median ${per(list, 0.5).toFixed(0)} km/h, spread ${per(list, 0.1).toFixed(0)}-${per(list, 0.9).toFixed(0)}`,
  );
}
console.log(
  `  density:   live p25 ${per(liveSamples, 0.25)} median ${per(liveSamples, 0.5)}` +
    ` p75 ${per(liveSamples, 0.75)} max ${per(liveSamples, 1)}; cap ${traffic.status.cap.toFixed(0)};` +
    ` road ahead empty ${((sameDirectionEmpty / measuredSeconds) * 100).toFixed(0)}% same-direction,` +
    ` ${((anyDirectionEmpty / measuredSeconds) * 100).toFixed(0)}% either`,
);
console.log(
  `  conflict:  ${traffic.status.impacts} stream contacts, ${egoImpacts} ego contacts, ` +
    `${nearMisses} near-miss car-ticks, closest same-lane gap ${minSameLaneGap.toFixed(1)} m, ` +
    `${traffic.status.passes} passes, crown time ${(crownExposureSeconds / Math.max(carSeconds, 1e-3) * 100).toFixed(1)}%`,
);
console.log(
  `  progress:  longest stop ${longestStop.toFixed(1)} s, ` +
    `${(crawlShare * 100).toFixed(1)}% of car-time under ${CRAWL_KMH} km/h, ` +
    `furthest past the asphalt ${worstOffRoad >= 0 ? '+' : ''}${worstOffRoad.toFixed(2)} m, ` +
    `${passedTheLine.size} cars past one arclength`,
);
console.log(
  `  variety:   ${models.size} models, ${[...styles].sort().join('/')}, ` +
    `pace spread p75-p25 ${(per(paceByCar, 0.75) - per(paceByCar, 0.25)).toFixed(0)} km/h`,
);
console.log(
  `  activity:  ` +
    [...activity]
      .sort((a, b) => b[1] - a[1])
      .map(([name, seconds]) => `${name} ${((seconds / Math.max(carSeconds, 1e-3)) * 100).toFixed(0)}%`)
      .join('  '),
);
console.log(
  `  ego:       ${((egoTrack.progress / Math.max(egoTrack.seconds, 1e-3)) * 3.6).toFixed(0)} km/h mean over ` +
    `${(egoTrack.progress / 1000).toFixed(1)} km, ` +
    `${(egoTrack.weave.count / Math.max(egoTrack.holdProgress / 1000, 1e-3)).toFixed(1)} weaves/km, ` +
    `${(egoTrack.lineChurn.count / Math.max(egoTrack.progress / 1000, 1e-3)).toFixed(1)} line/km, ` +
    `lane error RMS ${Math.sqrt(egoTrack.holdSumErrSq / Math.max(egoTrack.holdSamples, 1)).toFixed(2)} m ` +
    `worst ${egoTrack.holdMaxErr.toFixed(2)} m, longest stop ${egoTrack.longestStop.toFixed(1)} s, ` +
    [...egoTrack.activitySeconds]
      .sort((a, b) => b[1] - a[1])
      .map(([name, seconds]) => `${name} ${((seconds / Math.max(egoTrack.seconds, 1e-3)) * 100).toFixed(0)}%`)
      .join(' '),
);
console.log(`  warm-up left ${afterWarmup.live} live of ${afterWarmup.target} target`);

if (TRACE) {
  console.log('');
  console.log('  contact and jam detail:');
  console.log(`  contacts (${contacts.length}):`);
  for (const line of contacts.slice(0, 14)) console.log(`    ${line}`);
  console.log('');
  console.log('  longest stops:');
  for (const track of [...tracks.values()]
    .filter((t) => t.longestStop > 5)
    .sort((a, b) => b.longestStop - a.longestStop)
    .slice(0, 10)) {
    console.log(
      `    ${track.id.padEnd(14)} ${track.style.padEnd(9)} dir ${track.direction > 0 ? '+' : '-'} ` +
        `${track.longestStop.toFixed(1)} s  ${track.longestStopWhy}`,
    );
  }
  console.log('');
  console.log('  furthest off the asphalt:');
  for (const track of [...tracks.values()]
    .filter((t) => t.worstOffRoad > 0.5)
    .sort((a, b) => b.worstOffRoad - a.worstOffRoad)
    .slice(0, 6)) {
    console.log(
      `    ${track.id.padEnd(14)} ${track.style.padEnd(9)} dir ${track.direction > 0 ? '+' : '-'} ` +
        `+${track.worstOffRoad.toFixed(2)} m  ${track.worstOffRoadWhy}`,
    );
  }
  console.log('');
  console.log('  worst weavers (weaves per km over their own distance):');
  const worst = [...measured]
    .map((t) => ({ track: t, rate: t.weave.count / Math.max(t.holdProgress / 1000, 1e-3) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8);
  for (const { track, rate } of worst) {
    const top = [...track.activitySeconds].sort((a, b) => b[1] - a[1])[0];
    console.log(
      `    ${track.id.padEnd(14)} ${track.style.padEnd(9)} dir ${track.direction > 0 ? '+' : '-'} ` +
        `${(track.progress / 1000).toFixed(2)} km  ${rate.toFixed(0)}/km  ` +
        `line ${(track.lineChurn.count / Math.max(track.progress / 1000, 1e-3)).toFixed(0)}/km  ` +
        `err RMS ${Math.sqrt(track.holdSumErrSq / Math.max(track.holdSamples, 1)).toFixed(2)}  ` +
        `mostly ${top ? top[0] : '?'}`,
    );
  }
}

// ---------------------------------------------------------------- the properties
console.log('');
check(
  'cars hold their line',
  weavePerKm <= 4,
  `${weavePerKm.toFixed(1)} weaves/km, lane error RMS ${laneErrRms.toFixed(2)} m`,
);
check(
  'the line the planner asks for is steady',
  churnPerKm <= 6,
  `${churnPerKm.toFixed(1)} commanded-line reversals/km`,
);
check('the stream is not slow', per(paceByCar, 0.5) >= 60, `median ${per(paceByCar, 0.5).toFixed(0)} km/h`);
check(
  'the stream is not one speed',
  per(paceByCar, 0.75) - per(paceByCar, 0.25) >= 15,
  `p75-p25 ${(per(paceByCar, 0.75) - per(paceByCar, 0.25)).toFixed(0)} km/h`,
);
check(
  'traffic meets traffic without contact',
  traffic.status.impacts === 0 && egoImpacts === 0,
  `${traffic.status.impacts} stream, ${egoImpacts} ego`,
);
check(
  'nobody is left standing',
  longestStop <= 20 && crawlShare <= 0.05,
  `longest stop ${longestStop.toFixed(1)} s, ${(crawlShare * 100).toFixed(1)}% crawling`,
);
check(
  'the stream stays on the asphalt',
  worstOffRoad <= 0.8,
  `furthest past the edge ${worstOffRoad.toFixed(2)} m`,
);
check(
  'the road ahead is populated',
  sameDirectionEmpty / measuredSeconds <= 0.35,
  `empty ${((sameDirectionEmpty / measuredSeconds) * 100).toFixed(0)}% of the run`,
);
check(
  'the stream is more than one kind of car',
  models.size >= 6 && styles.size >= 3,
  `${models.size} models, ${styles.size} styles`,
);
check(
  'the ego driver gets down the road',
  (egoTrack.progress / Math.max(egoTrack.seconds, 1e-3)) * 3.6 >= 55,
  `${((egoTrack.progress / Math.max(egoTrack.seconds, 1e-3)) * 3.6).toFixed(0)} km/h over ${(egoTrack.progress / 1000).toFixed(1)} km`,
);

console.log('');
console.log(
  failures === 0 ? 'all real-road traffic checks passed' : `${failures} real-road traffic check(s) FAILED`,
);
if (failures > 0) process.exitCode = 1;
traffic.dispose();
