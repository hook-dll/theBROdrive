import * as THREE from 'three';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { carModelMeasure, loadCarModel } from '../src/render/carmodel';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import type { Autopilot } from '../src/vehicle/autopilot';
import type { Vehicle } from '../src/vehicle/vehicle';
import { HazardIndex, type RoadHazard } from '../src/world/hazards';
import {
  laybyCourierLateral,
  laybyLevel,
  laybyParkLateral,
  laybysBetween,
  type Layby,
} from '../src/world/layby';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { RoadTraffic, type RivalPose } from '../src/world/traffic';
import { RivalRace } from '../src/contracts/race';
import type { ContractCargoItem } from '../src/items/items';
import { couriersBetween } from '../src/world/couriers';
import { Terrain } from '../src/world/terrain';
import { TERMINUS_CENTRE_M, TERMINUS_PAD_M } from '../src/world/terminus';
import { widenessAt } from '../src/world/roadprofile';
import { ROAD_PHYSICS_REACH_M } from '../src/world/ranges';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
installAssetShim();
installDocumentShim();

const SEED = Number(process.argv[2] ?? 42);
const PLAYER_S = 1_000;
const ROAD_FROM = 100;
/** Enough road for the streamed phase below to cruise at motorway pace. */
const ROAD_TO = 7_000;
/** Cruising pace for the streamed phase: the speed the distribution is judged at. */
const PLAYER_MPS = 25;
const ROAD_STEP = 2;
const RIBBON_HALF_WIDTH = ROAD_HALF_WIDTH + 3;
/** Road paved either side of the lay-by scenario's stop: past the stream's whole reach. */
const LAYBY_ROAD_REACH_M = 900;
/** How long the lay-by scenario watches: a stop is a quarter of the cars passing, one at a time. */
const LAYBY_WATCH_S = 600;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

/** Select a uniform density band, not just a narrow/wide point under the player. */
function findUniformS(road: Road, wideness: 0 | 1): number {
  for (let s = PLAYER_S; s < Math.min(road.length - ROAD_PHYSICS_REACH_M, 400_000); s += 100) {
    let uniform = true;
    for (let offset = 0; offset <= ROAD_PHYSICS_REACH_M; offset += 10) {
      if (widenessAt(SEED, s + offset) !== wideness) {
        uniform = false;
        break;
      }
    }
    if (uniform) return s;
  }
  throw new Error(`no uniform ${wideness === 0 ? 'narrow' : 'wide'} density band on this seed`);
}

function addRoadCollider(physics: PhysicsWorld, road: Road): void {
  const surface = new SurfaceField(road.seed);
  const rows = Math.ceil((ROAD_TO - ROAD_FROM) / ROAD_STEP) + 1;
  const vertices = new Float32Array(rows * 6);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = Math.min(ROAD_TO, ROAD_FROM + row * ROAD_STEP);
    for (let side = 0; side < 2; side++) {
      const lateral = side === 0 ? -RIBBON_HALF_WIDTH : RIBBON_HALF_WIDTH;
      road.offsetPoint(s, lateral, point);
      const index = (row * 2 + side) * 3;
      vertices[index] = point.x;
      vertices[index + 1] = roadSurfaceY(road, surface, s, lateral, point.x, point.z);
      vertices[index + 2] = point.z;
    }
  }
  const indices = new Uint32Array((rows - 1) * 6);
  for (let row = 0, index = 0; row < rows - 1; row++) {
    const a = row * 2;
    indices[index++] = a;
    indices[index++] = a + 2;
    indices[index++] = a + 1;
    indices[index++] = a + 2;
    indices[index++] = a + 3;
    indices[index++] = a + 1;
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);
}

/**
 * The road round one lay-by, paved out over its pad: the road's own surface to the
 * asphalt edge and the pad's level (`laybyLevel`) past it on the lay-by's side, so the
 * slips meet the road with no step. Wider than the lay-by along the road, so the stream
 * that drives past it has its lane.
 */
function addLaybyCollider(physics: PhysicsWorld, road: Road, layby: Layby): void {
  const surface = new SurfaceField(road.seed);
  const from = layby.s - LAYBY_ROAD_REACH_M;
  const rows = Math.ceil((2 * LAYBY_ROAD_REACH_M) / ROAD_STEP) + 1;
  const columns: number[] = [];
  for (let u = -(ROAD_HALF_WIDTH + 6); u <= layby.padOuter + 3; u += 1) columns.push(u);
  const vertices = new Float32Array(rows * columns.length * 3);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = from + row * ROAD_STEP;
    const halfWidth = road.halfWidthAt(s);
    road.offsetPoint(s, layby.side * halfWidth, point);
    const edgeY = roadSurfaceY(road, surface, s, layby.side * halfWidth, point.x, point.z);
    for (let column = 0; column < columns.length; column++) {
      const u = columns[column]!;
      road.offsetPoint(s, layby.side * u, point);
      const index = (row * columns.length + column) * 3;
      vertices[index] = point.x;
      vertices[index + 1] = u <= halfWidth
        ? roadSurfaceY(road, surface, s, layby.side * u, point.x, point.z)
        : laybyLevel(edgeY, u, halfWidth);
      vertices[index + 2] = point.z;
    }
  }
  const indices = new Uint32Array((rows - 1) * (columns.length - 1) * 6);
  // The columns run out from the lay-by's side, so for a lay-by on the right they run
  // the opposite way to `addRoadCollider`'s and the winding turns with them.
  const flip = layby.side < 0;
  for (let row = 0, index = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns.length - 1; column++) {
      const a = row * columns.length + column;
      const b = a + columns.length;
      indices[index++] = a;
      indices[index++] = flip ? a + 1 : b;
      indices[index++] = flip ? b : a + 1;
      indices[index++] = b;
      indices[index++] = flip ? a + 1 : b + 1;
      indices[index++] = flip ? b + 1 : a + 1;
    }
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);
}

console.log('world traffic bench: bounded, transient physical cars on the real road');
const road = new Road(SEED);
const physics = await PhysicsWorld.create();
addRoadCollider(physics, road);
const world = new GameWorld(newWorldState(SEED));
const traffic = new RoadTraffic(
  physics,
  world,
  new THREE.Scene(),
  new WorldOrigin(),
  road,
  new HazardIndex(),
  loadCarModel,
  () => true,
);

let largestCount = 0;
let smallestPopulated = Infinity;
const stoppedFor = new Map<string, number>();
let longestStop = 0;
function sampleStoppedTraffic(): void {
  const live = new Set<string>();
  traffic.forEachVehicle((id, vehicle) => {
    live.add(id);
    const duration = vehicle.speedKmh < 2 ? (stoppedFor.get(id) ?? 0) + FIXED_DT : 0;
    stoppedFor.set(id, duration);
    longestStop = Math.max(longestStop, duration);
  });
  for (const id of stoppedFor.keys()) {
    if (!live.has(id)) stoppedFor.delete(id);
  }
}
// Observe dt delivered to real controllers, including their staggered first calls.
// A car on rails is not driven: its clock restarts when it wakes, so its elapsed time
// is re-synced after every step it spends on them (`syncRailClocks`).
type ClockCar = { settleFor: number; autopilot: Autopilot; vehicle: Vehicle; modelId: string; forwardS: number; rails: unknown };
// Bench-only access to the live records; controls are still the real Autopilots.
const clockTraffic = traffic as unknown as { carList: ClockCar[] };
const clocks = new Map<ClockCar, { elapsed: number; delivered: number }>();
let clockCalls = 0;
let clockError = 0;
function observeControlClocks(): void {
  for (const car of clockTraffic.carList) {
    let clock = clocks.get(car);
    if (!clock) {
      clock = { elapsed: 0, delivered: 0 };
      clocks.set(car, clock);
      const observed = clock;
      const drive = car.autopilot.drive.bind(car.autopilot);
      car.autopilot.drive = (...args: Parameters<Autopilot['drive']>) => {
        observed.delivered += args[0];
        clockCalls++;
        clockError = Math.max(clockError, Math.abs(observed.delivered - observed.elapsed));
        return drive(...args);
      };
    }
    if (car.settleFor <= 0) clock.elapsed += FIXED_DT;
  }
}
function syncRailClocks(): void {
  for (const car of clockTraffic.carList) {
    const clock = clocks.get(car);
    if (clock && car.rails) clock.elapsed = clock.delivered;
  }
}
let unsupportedSamples = 0;
let supportSamples = 0;
function sampleTrafficSupport(playerS: number): void {
  const position = { x: 0, y: 0, z: 0 };
  for (const car of clockTraffic.carList) {
    car.vehicle.absoluteTranslation(position);
    const s = road.project(position.x, position.z, car.forwardS).s;
    const half = carModelMeasure(car.modelId).halfExtents;
    if (Math.abs(s - playerS) + Math.hypot(...half) >= ROAD_PHYSICS_REACH_M) unsupportedSamples++;
    supportSamples++;
  }
}
for (let step = 0; step < Math.ceil(30 / FIXED_DT); step++) {
  observeControlClocks();
  traffic.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0, 0);
  syncRailClocks();
  physics.step();
  traffic.postStep();
  sampleTrafficSupport(PLAYER_S);
  sampleStoppedTraffic();
  largestCount = Math.max(largestCount, traffic.status.count);
  if (traffic.status.count > 0) smallestPopulated = Math.min(smallestPopulated, traffic.status.count);
  if (step % 6 === 0) await Bun.sleep(0);
}
check(
  'controller elapsed time never counts scheduler remainder twice',
  clockCalls > 0 && clockError < 1e-9,
  `${clockCalls} calls, maximum elapsed error ${clockError.toExponential(2)} s`,
);
const populated = traffic.status;
const catalogue = new Set(CAR_MODELS.map((model) => model.id));
check(
  'traffic stays within its wide-road cap',
  largestCount <= 24 && populated.count <= 24,
  `largest ${largestCount}, live ${populated.count}, cap ${populated.cap}`,
);
check(
  'traffic forms a frequent local stream',
  populated.count >= 3 && populated.nearestRoadDistance <= 300,
  `${populated.count} live, nearest ${populated.nearestRoadDistance.toFixed(0)} m away`,
);
check(
  'both directions are populated',
  populated.sameDirection > 0 && populated.oncoming > 0,
  `${populated.sameDirection} same-direction, ${populated.oncoming} oncoming`,
);
check(
  'traffic contains cautious, normal and passing-capable drivers',
  populated.sleeper > 0 && populated.hurried > 0 && populated.cautious > 0,
  `${populated.sleeper} sleeper, ${populated.hurried} hurried, ${populated.cautious} cautious`,
);
check(
  'traffic runs on low beam and never on high',
  populated.highBeams === 0 && populated.lowBeams === populated.count,
  `${populated.highBeams} high, ${populated.lowBeams} low / ${populated.count} cars`,
);
check(
  'both directions actually drive',
  populated.movingSameDirection > 0 && populated.movingOncoming > 0,
  `${populated.movingSameDirection} same-direction and ${populated.movingOncoming} oncoming moved`,
);
check(
  'random traffic draws only from the full catalogue',
  populated.modelIds.length > 0 && populated.modelIds.every((id) => catalogue.has(id)),
  populated.modelIds.join(', '),
);
check(
  'temporary traffic never enters the player save',
  Object.keys(world.state.cars).length === 0,
  `${Object.keys(world.state.cars).length} persistent traffic cars`,
);
// Keep the stream moving through several generations. Passing has a dedicated,
// authored playground scenario; this random stream owns the collision-free queue.
let aheadSum = 0;
let liveSum = 0;
let distributionSamples = 0;
for (let step = 0; step < Math.ceil(120 / FIXED_DT); step++) {
  const movingPlayerS = PLAYER_S + step * FIXED_DT * PLAYER_MPS;
  traffic.fixedUpdate(FIXED_DT, movingPlayerS, 0, 0, 0);
  physics.step();
  traffic.postStep();
  sampleTrafficSupport(movingPlayerS);
  sampleStoppedTraffic();
  const sample = traffic.status;
  largestCount = Math.max(largestCount, sample.count);
  if (sample.count > 0) smallestPopulated = Math.min(smallestPopulated, sample.count);
  // The first seconds still carry the stationary phase's layout.
  if (step * FIXED_DT > 20) {
    aheadSum += sample.ahead;
    liveSum += sample.count;
    distributionSamples++;
  }
  if (step % 12 === 0) await Bun.sleep(0);
}
check(
  'active traffic bodies stay within guaranteed physical support',
  supportSamples > 0 && unsupportedSamples === 0,
  `${unsupportedSamples} unsupported / ${supportSamples} live-body samples`,
);
const meanAhead = aheadSum / distributionSamples;
const meanLive = liveSum / distributionSamples;
const streamed = traffic.status;
check(
  'mixed traffic queues without collision',
  streamed.impacts === 0,
  `${streamed.impacts} impact(s), ${streamed.passes} pass(es), ${streamed.count} live`,
);
check(
  'traffic density varies within the catalogue-wide ceiling',
  largestCount <= 24 && smallestPopulated < largestCount,
  `${streamed.count} live, range ${smallestPopulated}-${largestCount}, cap ${streamed.cap.toFixed(0)}`,
);
check(
  'dense queues always resume',
  longestStop < 30,
  `longest continuous stop ${longestStop.toFixed(1)} s`,
);
// THE STREAM IS JUDGED BY WHAT IS IN FRONT, NOT BY `count`.
//
// Cars spawn ahead and are collected behind, and the player overtakes most of the
// stream, so the rear is where the quota goes to die: with a 700 m spawn band past
// the collision window and an 850 m rear tail, two thirds of the cars sat behind a
// cruising player and the road ahead held six. This fails if that returns.
//
// The floor is a FRACTION of what is live rather than a fixed number of cars: the quota
// is the road's now, and a narrow stretch legitimately holds a quarter of what a widened
// one does, so a fixed nine would be asserting the width of the road rather than where
// the stream sits on it.
check(
  'most of the live stream stays where the player can see it',
  meanAhead >= 3 && meanAhead >= meanLive * 0.4,
  `${meanAhead.toFixed(1)} of ${meanLive.toFixed(1)} live ahead at ${(PLAYER_MPS * 3.6).toFixed(0)} km/h`,
);


// Beyond every range from where the stream actually ended, not from where it began:
// the active body must remain inside the guaranteed physics window.
traffic.fixedUpdate(0.6, PLAYER_S + 120 * PLAYER_MPS + 4_000, 0, 0, 0);
check(
  'cars despawn beyond the active range',
  traffic.status.count === 0,
  `${traffic.status.count} cars remain`,
);
// THE STREAM IS SIZED BY THE ROAD, NOT BY A SETTING.
//
// A two-lane stretch holds twelve cars and a four-lane one twenty-four, with the taper
// between them interpolated. This is the property the menu slider used to stand in for,
// and it is now the road's own answer.
{
  const wideS = findUniformS(road, 1);
  const narrowS = findUniformS(road, 0);
  const narrowTraffic = new RoadTraffic(
    physics,
    new GameWorld(newWorldState(SEED)),
    new THREE.Scene(),
    new WorldOrigin(),
    road,
    new HazardIndex(),
    loadCarModel,
    () => true,
  );
  narrowTraffic.fixedUpdate(FIXED_DT, narrowS, 0, 0, 0);
  const narrowCap = narrowTraffic.status.cap;
  const narrowTarget = narrowTraffic.status.target;
  narrowTraffic.fixedUpdate(FIXED_DT, wideS, 0, 0, 0);
  const wideCap = narrowTraffic.status.cap;
  const wideTarget = narrowTraffic.status.target;
  check(
    'a two-lane stretch limits replenishment to twelve',
    Math.abs(narrowCap - 12) < 0.01,
    `cap ${narrowCap.toFixed(2)}`,
  );
  check(
    'a four-lane stretch limits replenishment to twenty-four',
    Math.abs(wideCap - 24) < 0.01,
    `cap ${wideCap.toFixed(2)}`,
  );
  check(
    'density targets stay between the floor and replenishment cap',
    narrowTarget >= Math.ceil(12 * 0.35) && narrowTarget <= 12 && wideTarget >= Math.ceil(24 * 0.35) && wideTarget <= 24,
    `${narrowTarget} of ${narrowCap.toFixed(0)} narrow, ${wideTarget} of ${wideCap.toFixed(0)} wide`,
  );
  narrowTraffic.dispose();
  check(
    'disposing the stream leaves nothing live or pending',
    narrowTraffic.status.count === 0 && !narrowTraffic.status.pending,
    JSON.stringify(narrowTraffic.status),
  );
}

// A longitudinal overlap belongs to both protection windows, in either direction.
{
  const fieldWorld = new GameWorld(newWorldState(SEED));
  fieldWorld.state.player.drivingCarId = 'field-bench-player';
  const fieldTraffic = new RoadTraffic(
    physics, fieldWorld, new THREE.Scene(), new WorldOrigin(), road,
    new HazardIndex(), loadCarModel, () => false,
  );
  const owner: { forwardS: number; direction: 1 | -1 } = { forwardS: PLAYER_S, direction: 1 };
  const field = fieldTraffic.fieldFor(owner, 'field-bench-observer');
  let cases = 0;
  let correct = true;
  for (const direction of [1, -1] as const) {
    owner.direction = direction;
    for (const offset of [-3, -2.3, -1, 0, 1, 2.3, 3]) {
      fieldTraffic.fixedUpdate(FIXED_DT, PLAYER_S + offset, 0, 0, 0);
      const along = offset * direction;
      const expected = Math.sign(along) * Math.max(0, Math.abs(along) - 2.3);
      for (const [ahead, behind] of [[5, 0], [0, 5], [0, 0]]) {
        let hits = 0;
        field.forEachNear(ahead!, behind!, (other) => {
          hits++;
          correct &&= Math.abs(other.s - expected) < 1e-9;
        });
        correct &&= hits === (expected <= ahead! && expected >= -behind! ? 1 : 0);
        cases++;
      }
    }
  }
  check('overlap remains in both forward and rear protection queries', correct, `${cases} boundary/direction queries`);
  fieldTraffic.dispose();
}

// Interleaving two lanes in longitudinal order must not send reverse requests
// sideways, or hide the actual bumper-to-bumper follower behind that other lane.
{
  const coordinator = new RoadTraffic(
    physics, new GameWorld(newWorldState(SEED)), new THREE.Scene(), new WorldOrigin(),
    road, new HazardIndex(), loadCarModel, () => false,
  );
  type QueueCar = {
    forwardS: number;
    roadLateral: number;
    roadHalfWidth: number;
    autopilot: { needsReverseRoom: boolean; setYieldReverse(enabled: boolean): void };
  };
  // Isolated coordinator fixture: no physical bodies needed for this road-frame rule.
  const queueCoordinator = coordinator as unknown as {
    assignReverseRoomInQueue(queue: readonly QueueCar[]): void;
  };
  let correct = true;
  for (const direction of [1, -1]) {
    const make = (s: number, lateral: number, reversing = false): QueueCar => ({
      forwardS: s * direction, roadLateral: lateral, roadHalfWidth: 1,
      autopilot: {
        needsReverseRoom: reversing,
        setYieldReverse(enabled) { this.needsReverseRoom = enabled; },
      },
    });
    const head = make(100, -4, true);
    const adjacent = make(97, -1);
    const follower = make(93, -4);
    const tail = make(86, -4);
    queueCoordinator.assignReverseRoomInQueue([head, adjacent, follower, tail]);
    correct &&= !adjacent.autopilot.needsReverseRoom
      && follower.autopilot.needsReverseRoom && tail.autopilot.needsReverseRoom;
  }
  check('reverse requests stay in overlapping lanes and propagate in one tick', correct, 'both travel directions, interleaved adjacent lane');
  coordinator.dispose();
}

// Nominal lane ids survive merges/tapers; spawn safety follows the actual body.
{
  const coordinator = new RoadTraffic(
    physics, new GameWorld(newWorldState(SEED)), new THREE.Scene(), new WorldOrigin(),
    road, new HazardIndex(), loadCarModel, () => false,
  );
  const s = findUniformS(road, 1);
  const follower = {
    direction: 1 as 1 | -1, lane: 0, forwardS: s - 26.4,
    roadLateral: 0, roadHalfWidth: 1, bodyRadius: 2.6, forwardSpeed: 21.08,
    autopilot: { mode: 'sleeper' as const },
    vehicle: { estimatedBrakeDecel: () => 6 },
  };
  // Isolate the selection/re-check predicate; no fake car enters physical update.
  const spawnCoordinator = coordinator as unknown as {
    carList: typeof follower[];
    forwardLaneCentreAt(s: number, direction: 1 | -1, lane: number): number;
    roadGapClear(s: number, direction: 1 | -1, lane: number): boolean;
  };
  spawnCoordinator.carList.push(follower);
  let correct = true;
  for (const direction of [1, -1] as const) {
    follower.direction = direction;
    const spawnLateral = spawnCoordinator.forwardLaneCentreAt(s, direction, 1);
    follower.roadLateral = spawnLateral + 0.15;
    follower.forwardS = s - 26.4 * direction;
    follower.forwardSpeed = 21.08 * direction;
    correct &&= !spawnCoordinator.roadGapClear(s, direction, 1);
    // A fixed 70m rule is insufficient for a faster follower.
    follower.forwardS = s - 100 * direction;
    follower.forwardSpeed = 40 * direction;
    correct &&= !spawnCoordinator.roadGapClear(s, direction, 1);
    follower.roadLateral = spawnLateral + 3;
    correct &&= spawnCoordinator.roadGapClear(s, direction, 1);
    follower.roadLateral = spawnLateral;
    follower.forwardSpeed = 0;
    correct &&= spawnCoordinator.roadGapClear(s, direction, 1);
  }
  check('spawns respect physical-lane followers and their stopping room', correct, 'stale lane id, fast approach, separate lane, stopped follower; both directions');
  spawnCoordinator.carList.length = 0;
  coordinator.dispose();
}

// THE DENSITY ACTUALLY ROTATES, AND THE ROTATION IS THE POINT.
//
// A single draw held for 36-72 s means the range has to be wide enough to reach both
// "you own the road" and "you are in company" within a drive, which is what the old
// two-thirds floor prevented. Sampled over many re-rolls rather than one, because one
// draw proves nothing about a distribution.
{
  const rotating = new RoadTraffic(
    physics,
    new GameWorld(newWorldState(SEED)),
    new THREE.Scene(),
    new WorldOrigin(),
    road,
    new HazardIndex(),
    loadCarModel,
    () => true,
  );
  let lowest = Infinity;
  let highest = 0;
  // 900 s of driving, sampled per step: a re-roll is 36-72 s apart, so a short window
  // proves nothing about a distribution — 200 s caught four consecutive draws inside a
  // third of the range and read as a stuck rotation when the rotation was working.
  for (let step = 0; step < Math.ceil(900 / FIXED_DT); step++) {
    rotating.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0, 0);
    const target = rotating.status.target;
    if (target > 0) {
      lowest = Math.min(lowest, target);
      highest = Math.max(highest, target);
    }
  }
  const cap = rotating.status.cap;
  check(
    'the density rotates over a long drive',
    lowest <= cap * 0.6 && highest >= cap * 0.8,
    `${lowest}-${highest} against a cap of ${cap.toFixed(0)}`,
  );
  rotating.dispose();
}

// A PROP IN THE ROAD MUST NOT STOP THE WORLD.
//
// Reported from play: a rock in one lane, a queue behind it, an opposing queue that
// had drawn level with its head, and nothing moving for five minutes. Both streams
// are stopped, so nobody's own sensors call it anything but "traffic ahead" — the
// coordinator has to see the standoff and hand one head right of way.
{
  const blockS = PLAYER_S + 260;
  const blockedHazards = new HazardIndex();
  const rock: RoadHazard = { s: blockS, lateral: -1.45, radius: 1.2, breakable: false };
  blockedHazards.add('traffic-bench-block', rock);
  const rockPoint = road.offsetPoint(rock.s, rock.lateral);
  const rockBody = physics.world.createRigidBody(
    physics.rapier.RigidBodyDesc.fixed().setTranslation(rockPoint.x, rockPoint.y + 1, rockPoint.z),
  );
  physics.world.createCollider(
    physics.rapier.ColliderDesc.cylinder(1, rock.radius).setFriction(0.9),
    rockBody,
  );
  const blocked = new RoadTraffic(
    physics,
    new GameWorld(newWorldState(SEED)),
    new THREE.Scene(),
    new WorldOrigin(),
    road,
    blockedHazards,
    loadCarModel,
    () => true,
  );
  const stopped = new Map<string, number>();
  let worstStop = 0;
  let passedTheRock = 0;
  const before = new Set<string>();
  for (let step = 0; step < Math.ceil(150 / FIXED_DT); step++) {
    blocked.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0, 0);
    physics.step();
    blocked.postStep();
    const live = new Set<string>();
    blocked.forEachVehicle((id, vehicle) => {
      live.add(id);
      const held = vehicle.speedKmh < 2 ? (stopped.get(id) ?? 0) + FIXED_DT : 0;
      stopped.set(id, held);
      // Settle time and the first seconds of a spawn are not a standoff.
      if (step * FIXED_DT > 8) worstStop = Math.max(worstStop, held);
      const position = vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
      const s = road.project(position.x, position.z, blockS).s;
      if (s < blockS - 20) before.add(id);
      else if (s > blockS + 20 && before.has(id)) {
        before.delete(id);
        passedTheRock++;
      }
    });
    for (const id of stopped.keys()) if (!live.has(id)) stopped.delete(id);
    if (step % 12 === 0) await Bun.sleep(0);
  }
  check(
    'a rock in the road never deadlocks both streams',
    worstStop < 22,
    `longest continuous stop ${worstStop.toFixed(1)} s of 150 s (nothing may stand for 22)`,
  );
  check(
    'and traffic keeps getting past it',
    // Two in two and a half minutes is not much, and a lane with a rock in it is not
    // much of a lane: what this defends is that the number is not zero.
    passedTheRock >= 2,
    `${passedTheRock} cars went from before the rock to past it`,
  );
  blocked.dispose();
  physics.world.removeRigidBody(rockBody);
}
// THE ROAD'S END TURNS CARS ROUND INSTEAD OF EATING THEM.
//
// Oncoming traffic used to drive to s = 0, sit against the clamp its reversed road view
// collapses to, and be recycled out of sight. There is a turning circle there now
// (`world/terminus.ts` paves it, `world/turnaround.ts` is the line round it), so what
// this measures is the whole handover: a car arrives, loops, and leaves in the other
// direction under its own power, having touched nothing.
{
  const terrain = new Terrain(SEED, road);
  const step = 1.5;
  const x0 = -40;
  const x1 = 40;
  const z0 = -40;
  const z1 = ROAD_FROM + 20;
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const vertices = new Float32Array(nx * nz * 3);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      const i = (ix * nz + iz) * 3;
      vertices[i] = x;
      vertices[i + 1] = terrain.heightAt(x, z, Math.max(0, z));
      vertices[i + 2] = z;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  for (let ix = 0, o = 0; ix < nx - 1; ix++) {
    for (let iz = 0; iz < nz - 1; iz++) {
      const a = ix * nz + iz;
      const b = (ix + 1) * nz + iz;
      indices[o++] = a; indices[o++] = a + 1; indices[o++] = b;
      indices[o++] = b; indices[o++] = a + 1; indices[o++] = b + 1;
    }
  }
  physics.addStaticTrimesh(vertices, indices, SurfaceType.Asphalt);

  const endS = 220;
  const ending = new RoadTraffic(
    physics,
    new GameWorld(newWorldState(SEED)),
    new THREE.Scene(),
    new WorldOrigin(),
    road,
    new HazardIndex(),
    loadCarModel,
    () => true,
  );
  const reachedEnd = new Set<string>();
  const cameBack = new Set<string>();
  let onPad = 0;
  let strandedOnPad = 0;
  const padTime = new Map<string, number>();
  const impactsBefore = ending.status.impacts;
  for (let i = 0; i < Math.ceil(180 / FIXED_DT); i++) {
    ending.fixedUpdate(FIXED_DT, endS, 0, 0, 0);
    physics.step();
    ending.postStep();
    ending.forEachVehicle((id, vehicle) => {
      const p = vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
      const r = Math.hypot(p.x, p.z + TERMINUS_CENTRE_M);
      if (r <= TERMINUS_PAD_M) {
        if (!padTime.has(id)) onPad++;
        const held = (padTime.get(id) ?? 0) + FIXED_DT;
        padTime.set(id, held);
        // A turn takes twenty seconds; a minute on the paving is a car that is stuck
        // on it, which is the failure this whole handover could plausibly produce.
        if (held > 60) strandedOnPad++;
      }
      const s = road.project(p.x, p.z, 60).s;
      if (s < 40) reachedEnd.add(id);
      else if (s > 150 && reachedEnd.has(id)) cameBack.add(id);
    });
    if (i % 12 === 0) await Bun.sleep(0);
  }
  check(
    'cars that reach the end of the road turn round in the bulb',
    cameBack.size >= 2 && onPad >= cameBack.size,
    `${onPad} car(s) used the turning circle, ${cameBack.size} drove back out past 150 m in 180 s`,
  );
  check(
    'and none of them is left standing on the paving',
    strandedOnPad === 0,
    `${strandedOnPad} car-tick(s) over a minute on the pad, ${padTime.size} visitor(s) counted`,
  );
  check(
    'the turn costs no collisions',
    ending.status.impacts === impactsBefore,
    `${ending.status.impacts - impactsBefore} impact(s) while turning`,
  );
  ending.dispose();
}
// A ROADSIDE STOP'S LAY-BY IS USED, AND LEFT, WITHOUT TOUCHING ANYTHING.
//
// Now and then a car passing a lay-by on its own side pulls in, parks on the pad and
// rejoins (`assignLaybyStops` in world/traffic.ts). The player stands at the stop, so
// the whole stream drives past it; this counts the stops that reach their place and
// come back out into the lane, and holds them to the pad and to the bodies round them.
{
  const layby = laybysBetween(SEED, ROAD_TO + LAYBY_ROAD_REACH_M, ROAD_TO + 100_000).find(
    (candidate) => !candidate.courier || Math.abs(laybyCourierLateral(candidate) - laybyParkLateral(candidate)) >= 2.8,
  );
  if (!layby) throw new Error('no usable lay-by on this seed');
  addLaybyCollider(physics, road, layby);
  const stops = new RoadTraffic(
    physics,
    new GameWorld(newWorldState(SEED)),
    new THREE.Scene(),
    new WorldOrigin(),
    road,
    new HazardIndex(),
    loadCarModel,
    () => true,
  );
  // Bench-only access to the live records, to follow each stop through its phases.
  type StopCar = { id: string; roadLateral: number; vehicle: Vehicle; layby: { phase: string } | null };
  const stopCars = stops as unknown as { carList: StopCar[] };
  const lastPhase = new Map<string, string>();
  const parkLateral = laybyParkLateral(layby);
  let ended = 0;
  let parkedSamples = 0;
  let parkedAstray = 0;
  let worstParkedOffset = 0;
  const impactsBefore = stops.status.impacts;
  for (let i = 0; i < Math.ceil(LAYBY_WATCH_S / FIXED_DT); i++) {
    stops.fixedUpdate(FIXED_DT, layby.s, 0, 0, 0);
    physics.step();
    stops.postStep();
    for (const car of stopCars.carList) {
      const phase = car.layby?.phase;
      if (phase === undefined) {
        if (lastPhase.delete(car.id)) ended++;
        continue;
      }
      // Settled on its place: on the parking line and standing (the stuck speed, 2 km/h).
      if (phase === 'parked' && lastPhase.get(car.id) === 'parked') {
        parkedSamples++;
        const offset = Math.abs(car.roadLateral - parkLateral);
        worstParkedOffset = Math.max(worstParkedOffset, offset);
        if (offset > 1 || car.vehicle.speedKmh > 2) parkedAstray++;
      }
      lastPhase.set(car.id, phase);
    }
    if (i % 12 === 0) await Bun.sleep(0);
  }
  const status = stops.status;
  console.log(
    `  lay-by at ${layby.s.toFixed(0)} m (side ${layby.side}, pad ${layby.padInner.toFixed(1)}-${layby.padOuter.toFixed(1)} m)`,
  );
  check(
    'traffic pulls into a lay-by, parks and rejoins the road',
    status.laybyStops >= 2 && status.laybyRejoins >= 2,
    `${status.laybyStops} stop(s) parked, ${status.laybyRejoins} back in the lane in ${LAYBY_WATCH_S} s`,
  );
  check(
    'a parked car stands on the pad, on its line',
    parkedSamples > 0 && parkedAstray === 0,
    `${parkedAstray} astray of ${parkedSamples} parked samples, worst ${worstParkedOffset.toFixed(2)} m off the line`,
  );
  check(
    'every stop that ends, ends back in the lane',
    ended === status.laybyRejoins,
    `${ended} ended, ${status.laybyRejoins} rejoined`,
  );
  check(
    'lay-by stops cost no collisions',
    status.impacts === impactsBefore,
    `${status.impacts - impactsBefore} impact(s)`,
  );
  stops.dispose();
}
// A RIVAL HANDS IN AT THE COURIER'S LAY-BY, AND FINISHES ITS RUN AFTER THE RACE.
//
// A race to the courier at a lay-by on each side of the road (the rivals drive the
// road forward, so a left-hand lay-by is across the oncoming lane). The player stands
// just past the finish. Every live rival must pull in, stand beside the courier car for
// its short hand-in, pull out and be back in its lane before the race hands it back to
// the stream, touching nothing — the courier car is a fixed body here. On the right-hand
// lay-by the player wins at once, so the rivals measured there all finish after the
// race was decided.
{
  const paved = new Set<number>([laybysBetween(SEED, ROAD_TO + LAYBY_ROAD_REACH_M, ROAD_TO + 100_000)[0]!.poiIndex]);
  for (const side of [-1, 1] as const) {
    const layby = laybysBetween(SEED, ROAD_TO + LAYBY_ROAD_REACH_M, ROAD_TO + 100_000).find(
      (candidate) => candidate.side === side && couriersBetween(SEED, candidate.s - 1, candidate.s + 1).length > 0,
    );
    if (!layby) throw new Error(`no courier lay-by on side ${side} on this seed`);
    const courier = couriersBetween(SEED, layby.s - 1, layby.s + 1)[0]!;
    if (!paved.has(layby.poiIndex)) addLaybyCollider(physics, road, layby);
    paved.add(layby.poiIndex);
    const courierPoint = road.offsetPoint(layby.s, laybyCourierLateral(layby));
    const heading = road.headingAt(layby.s);
    const courierBody = physics.world.createRigidBody(
      physics.rapier.RigidBodyDesc.fixed()
        .setTranslation(courierPoint.x, courierPoint.y + 0.75, courierPoint.z)
        .setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }),
    );
    physics.world.createCollider(physics.rapier.ColliderDesc.cuboid(0.9, 0.75, 2.2), courierBody);
    const stream = new RoadTraffic(
      physics,
      new GameWorld(newWorldState(SEED)),
      new THREE.Scene(),
      new WorldOrigin(),
      road,
      new HazardIndex(),
      loadCarModel,
      () => true,
    );
    const pose: RivalPose = { s: 0, speed: 0, handIn: 'none' };
    const toasts: string[] = [];
    let releasedEarly = 0;
    const released = new Set<string>();
    const race = new RivalRace(
      SEED,
      road,
      {
        spawnRival: (spec) => stream.spawnRival(spec),
        rivalPose: (id, out) => stream.rivalPose(id, out),
        setRivalSpeedCap: (id, mps) => stream.setRivalSpeedCap(id, mps),
        rivalHandIn: (id, courierS, standS, parkS) => stream.rivalHandIn(id, courierS, standS, parkS),
        reserveHandIn: (courierS, reserved) => stream.reserveHandIn(courierS, reserved),
        releaseRival: (id) => {
          // Back to the stream only once it is back in its lane.
          if (!stream.rivalPose(id, pose) || pose.handIn !== 'clear') releasedEarly++;
          released.add(id);
          stream.releaseRival(id);
        },
      },
      loadCarModel,
      (text) => toasts.push(text),
    );
    const item = {
      id: `bench-race-${side}`,
      sourceCourierIndex: courier.index - 1,
      raceLegs: 1,
      generatedSeed: 7 + side,
      cargoName: 'parcel',
      type: 'contract_cargo',
      contractKind: 'parcel',
      massKg: 6,
      progress: {},
    } as unknown as ContractCargoItem;
    race.observe(item, 'hand', layby.s - 2200);
    const playerS = layby.s + 150;
    if (side === -1) {
      race.winCoins(item.id);
      race.playerDelivered(item.id);
    }
    type RivalCar = {
      id: string;
      rival: boolean;
      forwardS: number;
      roadLateral: number;
      vehicle: Vehicle;
      handIn: string;
      layby: { phase: string; enterS: number } | null;
    };
    const cars = stream as unknown as { carList: RivalCar[] };
    const parkedFrom = new Map<string, number>();
    const stands: string[] = [];
    const badStands: string[] = [];
    const cleared = new Set<string>();
    const parkLateral = laybyParkLateral(layby);
    const impactsBefore = stream.status.impacts;
    let crossedWhileOncoming = 0;
    for (let i = 0; i < Math.ceil(300 / FIXED_DT); i++) {
      const t = i * FIXED_DT;
      race.fixedUpdate(FIXED_DT, playerS);
      stream.fixedUpdate(FIXED_DT, playerS, 0, 0, 0);
      physics.step();
      stream.postStep();
      for (const car of cars.carList) {
        if (!car.id.startsWith('rival:')) continue;
        const phase = car.layby?.phase;
        if (phase === 'parked' && !parkedFrom.has(car.id)) parkedFrom.set(car.id, t);
        if (phase === 'out' && parkedFrom.has(car.id) && !stands.some((s) => s.startsWith(car.id))) {
          const stood = t - parkedFrom.get(car.id)!;
          const along = car.forwardS - layby.s;
          const across = car.roadLateral - parkLateral;
          const line = `${car.id} ${stood.toFixed(2)} s at ${along.toFixed(1)} m along, ${across.toFixed(2)} m off the line`;
          stands.push(line);
          if (stood < 1.5 || stood > 3 || Math.abs(along) > 3 || Math.abs(across) > 1) badStands.push(line);
        }
        if (car.handIn === 'clear') {
          const lane = road.laneCentreAt(car.forwardS, road.lanesPerSideAt(car.forwardS) - 1);
          if (Math.abs(car.roadLateral - lane) < 1) cleared.add(car.id);
        }
        // Across the oncoming lane on the way in: nobody coming the other way within 60 m.
        if (side === 1 && phase === 'in' && car.roadLateral > 0 && car.roadLateral < road.halfWidthAt(car.forwardS)) {
          for (const other of cars.carList) {
            const ahead = other.forwardS - car.forwardS;
            if (other !== car && other.roadLateral > 0 && ahead > 0 && ahead < 60 && other.vehicle.speedKmh > 10) {
              crossedWhileOncoming++;
            }
          }
        }
      }
      if (i % 12 === 0) await Bun.sleep(0);
    }
    const where = side === -1 ? 'own-side' : 'far-side';
    console.log(`  ${where} courier lay-by at ${layby.s.toFixed(0)} m: ${toasts.slice(1).join(' | ')}`);
    check(
      `${where}: rivals stand beside the courier 1.5-3 s`,
      stands.length >= 2 && badStands.length === 0,
      stands.join('; ') || 'no stand',
    );
    check(
      `${where}: every rival that pulled in is back in its lane before it is released`,
      released.size >= 2 && releasedEarly === 0 && [...parkedFrom.keys()].every((id) => cleared.has(id) && released.has(id)),
      `${parkedFrom.size} pulled in, ${cleared.size} back in the lane, ${released.size} released, ${releasedEarly} released early`,
    );
    check(
      `${where}: hand-ins cost no collisions`,
      stream.status.impacts === impactsBefore && crossedWhileOncoming === 0,
      `${stream.status.impacts - impactsBefore} impact(s), ${crossedWhileOncoming} sample(s) crossing ahead of oncoming traffic`,
    );
    if (side === -1) {
      check(
        'after a player win the rivals still hand in, and are placed',
        toasts.filter((text) => /handed in — (2nd|3rd|4th)/.test(text)).length >= 2,
        toasts.join(' | '),
      );
    }
    stream.dispose();
    physics.world.removeRigidBody(courierBody);
  }
}
traffic.dispose();

console.log(failures === 0 ? '\nall traffic checks passed' : `\n${failures} traffic check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
