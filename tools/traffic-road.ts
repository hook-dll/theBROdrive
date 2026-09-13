/**
 * tools/traffic-road.ts
 *
 * THE AMBIENT STREAM, MEASURED ON A REAL STRETCH OF THE REAL ROAD.
 *
 * `traffic-bench.ts` owns the stream's plumbing — spawning, despawning, the turning
 * circle, the deadlock coordinator — and builds its cars against an EMPTY hazard index,
 * because each of those checks wants one controlled thing in front of the car. That is
 * the right shape for plumbing and the wrong shape for behaviour: the complaints this
 * bench exists for are about a road with real props on it, real districts under it and a
 * real stream of other cars, and none of those can be judged from a motorway made of
 * deliberately-placed rocks.
 *
 * So this drives the real `Terrain`, the real `RoadMeshProvider` surfaces and the real
 * `ScatterProvider` output over a long run of the road at the seed's own districts, and
 * asks the five questions a player actually asks of traffic:
 *
 *  1. DOES IT HOLD A LINE? Commanded-line direction reversals per kilometre, split by
 *     what the driver was doing. A car whose line oscillates while simply following is
 *     the "cars darting between lanes" a player sees, and it is measurable without
 *     anybody looking at a video.
 *  2. IS IT MOVING? Speed percentiles across the whole stream, and how much time the
 *     road ahead is empty.
 *  3. DOES IT GET WHERE IT IS GOING? Progress per car and the longest any car stands
 *     still.
 *  4. DOES IT HIT THINGS? Contacts between traffic cars.
 *  5. IS IT A ROAD OR A CONVEYOR? The spread of speeds and the range the density
 *     rotation reaches.
 *
 *   bun tools/traffic-road.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { loadCarModel } from '../src/render/carmodel';
import { installAssetShim } from './assetshim';
import { HazardIndex } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
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

const SEED = Number(process.argv[2] ?? 1337);
/** Where the measured drive begins. Past the garage ramp so the road is its own. */
const START_S = 40_000;
/** How long the stream is left alone to fill before anything is measured. */
const WARMUP_S = 120;
/** The measured run: twenty minutes of road at the player's pace. */
const MEASURE_S = 1_200;
/** The player's pace, 90 km/h. */
const PLAYER_MPS = 25;
const PLAYER_LATERAL = -ROAD_HALF_WIDTH * 0.5;
const RIBBON_HALF_WIDTH = ROAD_HALF_WIDTH * 2 + 4;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

console.log(`real-road traffic bench, seed ${SEED}, s ${START_S} onward`);

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const physics = await PhysicsWorld.create();
const surface = new SurfaceField(SEED);

/** The real ribbon, wide enough for every lane the profile opens. */
function addRibbon(from: number, to: number): void {
  const step = 2;
  const rows = Math.ceil((to - from) / step) + 1;
  const vertices = new Float32Array(rows * 6);
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row < rows; row++) {
    const s = Math.min(to, from + row * step);
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
/** Rapier's broad-phase only knows a collider once the world has stepped. */
function settle(): void {
  physics.step();
}

const world = new GameWorld(newWorldState(SEED));
const lastS = Math.min(road.length - CHUNK_LENGTH, START_S + MEASURE_S * PLAYER_MPS + 2_000);
addRibbon(START_S - 400, lastS);
settle();

// THE REAL PROPS, IN THEIR REAL PLACES.
//
// The scatter provider is the one the game streams, driven here over the measured
// stretch instead of chunk by chunk as the player arrives. Its output goes into the
// stream's hazard index and into the physics world, so the traffic meets exactly the
// rocks, mounds and trunks the player meets at this seed — which is the whole point of
// measuring on a real stretch rather than on an empty one.
const hazards = new HazardIndex();
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
    scatter.build(context);
  }
}
settle();

const traffic = new RoadTraffic(
  physics,
  world,
  new THREE.Scene(),
  new WorldOrigin(),
  road,
  hazards,
  loadCarModel,
  () => true,
);
traffic.setDaylightFactor(1);

interface StreamCar {
  id: string;
  forwardS: number;
  direction: number;
  style: string;
  lane: number;
  modelId: string;
  vehicle: { speedKmh: number };
  autopilot: { commandedLine: number; activity: string };
}
const cars = (traffic as unknown as { carList: readonly StreamCar[] }).carList;

let ticks = 0;
/**
 * One step of the world. Yields periodically: a spawn waits on a model-load promise, so
 * a fully synchronous loop never lets `finishSpawn` run and measures a road that cannot
 * fill.
 */
async function tick(playerS: number): Promise<void> {
  traffic.fixedUpdate(FIXED_DT, playerS, 0, 0);
  physics.step();
  traffic.postStep();
  if (++ticks % 6 === 0) await Bun.sleep(0);
}

/** Per-car accumulator, keyed by id so a recycled car starts clean. */
interface Track {
  s: number;
  line: number;
  lastDir: number;
  travelLateral: number;
  roadKm: number;
  stoppedFor: number;
  longestStop: number;
  worstOffRoad: number;
  style: string;
}
const tracks = new Map<string, Track>();
/** Commanded-line reversals, split by what the driver was doing at the time. */
const reversalsByActivity = new Map<string, number>();
const kmByActivity = new Map<string, number>();
const speedSamples: number[] = [];
const liveSamples: number[] = [];
const models = new Set<string>();
const styles = new Set<string>();
let sameDirectionGapEmpty = 0;
let anyDirectionGapEmpty = 0;
let measuredSeconds = 0;
/** Distinct cars that got past one fixed arclength: throughput, not population. */
const PASS_LINE_M = START_S + 2_000;
const passedTheLine = new Set<string>();
const passedTheLineBoth = new Set<string>();

async function drive(seconds: number, record: boolean): Promise<void> {
  let playerS = playerCursor;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    playerS += PLAYER_MPS * FIXED_DT;
    await tick(playerS);
    if (!record) continue;
    measuredSeconds += FIXED_DT;
    let nearest = Infinity;
    let nearestSame = Infinity;
    for (const car of cars) {
      const gap = car.forwardS - playerS;
      if (gap >= 0 && gap < nearest) nearest = gap;
      if (car.direction === 1 && gap >= 0 && gap < nearestSame) nearestSame = gap;
    }
    if (!(nearest <= 300)) anyDirectionGapEmpty += FIXED_DT;
    if (!(nearestSame <= 300)) sameDirectionGapEmpty += FIXED_DT;
    liveSamples.push(cars.length);
    for (const car of cars) {
      models.add(car.modelId);
      styles.add(car.style);
      speedSamples.push(car.vehicle.speedKmh);
      const activity = car.autopilot.activity;
      const line = car.autopilot.commandedLine;
      let track = tracks.get(car.id);
      if (!track) {
        track = {
          s: car.forwardS,
          line,
          lastDir: 0,
          travelLateral: 0,
          roadKm: 0,
          stoppedFor: 0,
          longestStop: 0,
          worstOffRoad: 0,
          style: car.style,
        };
        tracks.set(car.id, track);
        continue;
      }
      const travelled = car.forwardS - track.s;
      if (Math.abs(travelled) > 0.5) {
        track.roadKm += travelled / 1000;
        kmByActivity.set(activity, (kmByActivity.get(activity) ?? 0) + travelled / 1000);
        const delta = line - track.line;
        track.travelLateral += Math.abs(delta);
        const direction = Math.abs(delta) > 1e-4 ? Math.sign(delta) : 0;
        if (direction && track.lastDir && direction !== track.lastDir) {
          reversalsByActivity.set(activity, (reversalsByActivity.get(activity) ?? 0) + 1);
        }
        if (direction) track.lastDir = direction;
        track.line = line;
        track.s = car.forwardS;
      }
      const lateral = Math.abs(car.forwardS >= 0 ? 0 : 0);
      void lateral;
      // How far out of the carriageway the body ever got, in metres past the edge.
      const ownHalf = road.halfWidthAt(car.forwardS);
      // `roadLateral` is not on the interface, so the body's own position is the honest
      // source; it is already projected by the stream each step.
      const roadLateral = (car as unknown as { roadLateral: number }).roadLateral;
      track.worstOffRoad = Math.max(track.worstOffRoad, Math.abs(roadLateral) - ownHalf);
      if (car.vehicle.speedKmh < 2) {
        track.stoppedFor += FIXED_DT;
        track.longestStop = Math.max(track.longestStop, track.stoppedFor);
      } else {
        track.stoppedFor = 0;
      }
      if (car.direction === 1) {
        if (car.forwardS >= PASS_LINE_M) passedTheLine.add(car.id);
      }
      if (car.forwardS >= PASS_LINE_M || car.forwardS <= PASS_LINE_M) passedTheLineBoth.add(car.id);
    }
  }
  playerCursor = playerS;
}

let playerCursor = START_S;
await drive(WARMUP_S, false);
const afterWarmup = { live: cars.length, target: traffic.status.target };

await drive(MEASURE_S, true);

// ------------------------------------------------------------------ findings
const kmTotal = [...kmByActivity.values()].reduce((a, b) => a + b, 0);
const reversalsTotal = [...reversalsByActivity.values()].reduce((a, b) => a + b, 0);
speedSamples.sort((a, b) => a - b);
const percentile = (p: number): number =>
  speedSamples[Math.min(speedSamples.length - 1, Math.floor(p * speedSamples.length))] ?? 0;
liveSamples.sort((a, b) => a - b);
const livePercentile = (p: number): number =>
  liveSamples[Math.min(liveSamples.length - 1, Math.floor(p * liveSamples.length))] ?? 0;

const measured = [...tracks.values()].filter((t) => t.roadKm > 0.3);
const longestStop = measured.reduce((worst, t) => Math.max(worst, t.longestStop), 0);
const worstOffRoad = measured.reduce((worst, t) => Math.max(worst, t.worstOffRoad), 0);
const meanLateralTravel =
  measured.reduce((sum, t) => sum + t.travelLateral / Math.max(t.roadKm, 1e-3), 0) /
  Math.max(measured.length, 1);

console.log('');
console.log(
  `measured ${(measuredSeconds / 60).toFixed(1)} min at 90 km/h, ${measured.length} cars tracked,` +
    ` ${kmTotal.toFixed(0)} car-km`,
);
console.log(
  `  pace, km/h: p10 ${percentile(0.1).toFixed(0)}  p25 ${percentile(0.25).toFixed(0)}` +
    `  median ${percentile(0.5).toFixed(0)}  p75 ${percentile(0.75).toFixed(0)}  p90 ${percentile(0.9).toFixed(0)}`,
);
console.log(
  `  live cars: p25 ${livePercentile(0.25)}  median ${livePercentile(0.5)}` +
    `  p75 ${livePercentile(0.75)}  max ${liveSamples[liveSamples.length - 1]}; cap ${traffic.status.cap.toFixed(0)}`,
);
console.log(
  `  road ahead empty: nothing within 300 m ${((anyDirectionGapEmpty / measuredSeconds) * 100).toFixed(0)}%` +
    ` of the time, same direction ${((sameDirectionGapEmpty / measuredSeconds) * 100).toFixed(0)}%`,
);
console.log(
  `  steering: ${(reversalsTotal / Math.max(kmTotal, 1e-3)).toFixed(1)} commanded-line direction reversals per car-km,` +
    ` ${meanLateralTravel.toFixed(0)} m of lateral travel per car-km`,
);
for (const [activity, count] of [...reversalsByActivity].sort((a, b) => b[1] - a[1])) {
  const km = kmByActivity.get(activity) ?? 0;
  if (km <= 0.1) continue;
  console.log(`      ${activity.padEnd(9)} ${(count / km).toFixed(1)}/km over ${km.toFixed(1)} car-km`);
}
console.log(
  `  progress: longest any car stood still ${longestStop.toFixed(1)} s;` +
    ` furthest past the asphalt ${worstOffRoad >= 0 ? '+' : ''}${worstOffRoad.toFixed(2)} m`,
);
console.log(
  `  variety: ${models.size} models, ${[...styles].sort().join('/')},` +
    ` speed spread p75-p25 ${(percentile(0.75) - percentile(0.25)).toFixed(0)} km/h`,
);
console.log(`  throughput: ${passedTheLine.size} distinct cars crossed one arclength in the run`);
console.log(
  `  contacts ${traffic.status.impacts}, passes ${traffic.status.passes},` +
    ` warm-up left ${afterWarmup.live} live of ${afterWarmup.target} target`,
);

// ------------------------------------------------------------------ the properties
check(
  'the stream holds its line while following',
  (reversalsByActivity.get('follow') ?? 0) / Math.max(kmByActivity.get('follow') ?? 1, 1e-3) <= 3,
  `${((reversalsByActivity.get('follow') ?? 0) / Math.max(kmByActivity.get('follow') ?? 1, 1e-3)).toFixed(1)} reversals/km in follow`,
);
check(
  'the stream is not slow',
  percentile(0.5) >= 55,
  `median ${percentile(0.5).toFixed(0)} km/h`,
);
check(
  'the stream is not one speed',
  percentile(0.75) - percentile(0.25) >= 18,
  `p75-p25 spread ${(percentile(0.75) - percentile(0.25)).toFixed(0)} km/h`,
);
check(
  'no car is left standing',
  longestStop <= 25,
  `longest stop ${longestStop.toFixed(1)} s`,
);
check(
  'traffic meets traffic without contact',
  traffic.status.impacts === 0,
  `${traffic.status.impacts} contact(s) in ${kmTotal.toFixed(0)} car-km`,
);
check(
  'the road ahead is populated',
  sameDirectionGapEmpty / measuredSeconds <= 0.35,
  `same-direction road empty for ${((sameDirectionGapEmpty / measuredSeconds) * 100).toFixed(0)}% of the run`,
);
check(
  'the stream is more than one kind of car',
  models.size >= 6 && styles.size >= 3,
  `${models.size} models, ${styles.size} styles`,
);

console.log('');
console.log(failures === 0 ? 'all real-road traffic checks passed' : `${failures} real-road traffic check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
traffic.dispose();
