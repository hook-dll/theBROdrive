/**
 * tools/frantic-pass.ts — a frantic driver held up on a long straight, deterministic.
 *
 * Two situations the stream bench meets too rarely to measure, built on purpose on the
 * REAL road: the game's road mesh with its graded shoulder strip (`LooseShoulder`), the
 * game's desert beside it, the real scatter props, real
 * `Vehicle` bodies under real `Autopilot`s, every driver deciding at the stream's own
 * control rate (`TRAFFIC_CONTROL_HZ`, 12 Hz) under 60 Hz physics, and a traffic field
 * in the coordinator's own frame (`RoadTraffic.fieldFor`).
 *
 *   queue  a frantic car behind six cars nose to tail at 58 km/h, the oncoming lane
 *          busy (a car every 70-110 m at 72 km/h), so the crossing never opens and the
 *          middle has a car in it: the verge is the only way past.
 *   one    the same with a single slow car, at 58 and at 80 km/h.
 *
 * Every car the frantic driver gets past is counted once, by the manoeuvre it was in
 * while it drew level (`pass-shoulder`, `pass-middle`, `pass-oncoming`). Also counted:
 * verge passes given up (`LateralCommitment.shoulderYielding` coming on), contacts over
 * 1.8 m/s (any car), a wheel on sand or rock (the desert past the strip: a road
 * departure), a body sideslip over 8 degrees above 10 m/s (a slide), and the closest the
 * frantic car's body came to a car it was level with.
 *
 * Each is driven twice: with the engine the stream fits a frantic car (the M30) and
 * with the car's stock one, which is the player's own car on the frantic autopilot.
 *
 *   bun tools/frantic-pass.ts [seed] [--scenario queue|one|all] [--engine m30|stock|all]
 *                             [--seconds N] [--trace]
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { createServiceableCarState, poseOnGround } from '../src/game/spawn';
import { GameWorld, newWorldState } from '../src/game/state';
import { carModelMeasure, carSpawnYAboveGround, loadCarModel, preloadCarModels } from '../src/render/carmodel';
import { Autopilot, type AutopilotMode } from '../src/vehicle/autopilot';
import type { TrafficField, TrafficNeighbour } from '../src/vehicle/trafficfield';
import { Vehicle } from '../src/vehicle/vehicle';
import { type ChunkContext } from '../src/world/chunks';
import { DesertTileStreamer, DESERT_TILE_SIZE } from '../src/world/deserttiles';
import { WorldOrigin } from '../src/world/origin';
import { InstanceBatches } from '../src/world/props/instancebatch';
import { ScatterProvider } from '../src/world/props/scatter';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { ReversedRoad } from '../src/world/reversedroad';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { SHOULDER_WIDTH_M } from '../src/world/roadprofile';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { Terrain } from '../src/world/terrain';
import { WorldWorkScheduler } from '../src/world/workqueue';
import { installAssetShim } from './assetshim';
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
installDocumentShim();

const args = process.argv.slice(2);
function flag(name: string, fallback: number): number {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? Number(args[index + 1]) : fallback;
}
const SEED = Number(args.find((a) => !a.startsWith('--') && Number.isFinite(Number(a))) ?? 1337);
const SCENARIO = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1]! : 'all';
const SECONDS = flag('seconds', 60);
const TRACE = args.includes('--trace');
/** `--engine m30|stock|all`: the frantic car's engine; see `engines` below. */
const ENGINE = args.includes('--engine') ? args[args.indexOf('--engine') + 1]! : 'all';
/** The stream's frantic body, and the engine the stream fits it with (`franticEngine`). */
const EGO_MODEL = 'sv_vaz2105r';
const FRANTIC_ENGINE = 'engine_bmw_m30';
const OTHER_MODEL = 'sv_vaz2105r';
/** As the stream: drivers decide at `TRAFFIC_CONTROL_HZ`, the physics runs at 60. */
const CONTROL_DT = 1 / 12;
/** `RoadTraffic.fieldFor` reports every car with these. */
const FIELD_HALF_WIDTH = 1.0;
const FIELD_HALF_LENGTH = 2.3;
/** Straight enough to be "a long straight": radius over 600 m for the whole stretch. */
const STRAIGHT_CURVATURE = 1 / 600;
const STRETCH_M = 2_400;
const CONTACT_MPS = 1.8;
const SLIDE_DEG = 8;

// ---------------------------------------------------------------- the world
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const physics = await PhysicsWorld.create();
const surface = new SurfaceField(SEED);
const world = new GameWorld(newWorldState(SEED));
const reverseRoad = new ReversedRoad(road);
const roadDistance = new RoadDistance(road);
const roadProvider = new RoadMeshProvider(SEED, roadDistance);
const scatter = new ScatterProvider();
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const desert = new DesertTileStreamer(SEED, road, terrain, roadDistance, physics, scene, origin, undefined, new WorldWorkScheduler(3), () => null);
let desertFrame = 1;
let desertTile = '';
function keepDesert(x: number, z: number, lateral: number): void {
  const tile = `${Math.floor(x / DESERT_TILE_SIZE)},${Math.floor(z / DESERT_TILE_SIZE)}`;
  if (tile === desertTile) return;
  desertTile = tile;
  desert.prime(x, z, lateral);
  desert.update(x, z, lateral, desertFrame++);
}
const builtChunks = new Set<number>();
function buildRoad(from: number, to: number): void {
  for (let index = Math.floor(from / CHUNK_LENGTH); index <= Math.ceil(to / CHUNK_LENGTH); index++) {
    if (builtChunks.has(index)) continue;
    builtChunks.add(index);
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
 * A long straight on one lane each way whose right-hand verge is a graded strip: the
 * place a verge pass is meant to be possible at all.
 */
function findStretch(): number {
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0, markings: 1 };
  for (let s = 30_000; s < road.length - STRETCH_M - 2_000; s += 100) {
    let fits = true;
    for (let x = s - 200; x <= s + STRETCH_M && fits; x += 20) {
      if (road.lanesPerSideAt(x) !== 1 || Math.abs(road.curvatureAt(x)) > STRAIGHT_CURVATURE) fits = false;
      road.conditionAt(x, condition);
      if (condition.surface === SurfaceType.Sand || condition.surface === SurfaceType.Rock) fits = false;
    }
    if (!fits) continue;
    buildRoad(s - 400, s + STRETCH_M + 400);
    return s;
  }
  throw new Error(`no clear straight on seed ${SEED}`);
}

await preloadCarModels([EGO_MODEL, OTHER_MODEL]);
await loadCarModel(EGO_MODEL);
await loadCarModel(OTHER_MODEL);
const START_S = findStretch();
{
  const start = road.sampleAt(START_S);
  keepDesert(start.x, start.z, 0);
}
physics.step();
const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0, markings: 1 };
road.conditionAt(START_S + 500, condition);
console.log(
  `frantic pass bench, seed ${SEED}, straight at s ${START_S} (${SurfaceType[condition.surface]}, ` +
    `half width ${road.halfWidthAt(START_S).toFixed(2)} m, shoulder ${SHOULDER_WIDTH_M.toFixed(1)} m), ` +
    `${SECONDS} s per run, drivers at ${(1 / CONTROL_DT).toFixed(0)} Hz`,
);

// ---------------------------------------------------------------- cars
interface Car {
  id: string;
  direction: 1 | -1;
  vehicle: Vehicle;
  autopilot: Autopilot;
  input: InputFrame;
  /** Forward-frame arclength, lateral and speed along the forward direction. */
  s: number;
  lateral: number;
  speed: number;
  accumulator: number;
  elapsed: number;
  /** Speed it is launched rolling at once landed, as the stream launches its spawns. */
  launch: number;
}
const position = new THREE.Vector3();

function fieldFor(owner: Car, cars: readonly Car[]): TrafficField {
  const buffer = { s: 0, lateral: 0, speed: 0, halfWidth: FIELD_HALF_WIDTH, halfLength: FIELD_HALF_LENGTH };
  return {
    forEachNear(ahead: number, behind: number, fn: (neighbour: TrafficNeighbour) => void): void {
      for (const car of cars) {
        if (car === owner) continue;
        const along = (car.s - owner.s) * owner.direction;
        const faced = Math.sign(along) * Math.max(0, Math.abs(along) - FIELD_HALF_LENGTH);
        if (faced > ahead || faced < -behind) continue;
        buffer.s = faced;
        buffer.lateral = car.lateral * owner.direction;
        buffer.speed = car.speed * owner.direction;
        fn(buffer);
      }
    },
  };
}

function placeCar(
  cars: Car[],
  id: string,
  s: number,
  direction: 1 | -1,
  mode: AutopilotMode,
  speed: number,
  cap: number,
  modelId: string,
  engineId?: string,
): Car {
  const lane = road.laneCentreAt(s, 0) * direction;
  const point = road.offsetPoint(s, lane);
  const heading = road.sampleAt(s).heading + (direction === 1 ? 0 : Math.PI);
  const measure = carModelMeasure(modelId);
  const pose = poseOnGround(measure.wheels, point.x, point.z, heading, (x, z) => {
    const p = road.project(x, z, s);
    return roadSurfaceY(road, surface, p.s, p.lateral, x, z);
  });
  const state = createServiceableCarState(
    id,
    modelId,
    point.x,
    carSpawnYAboveGround(measure, pose?.groundY ?? roadSurfaceY(road, surface, s, lane, point.x, point.z), 0),
    point.z,
    heading,
    engineId,
  );
  if (pose) {
    state.qx = pose.qx;
    state.qy = pose.qy;
    state.qz = pose.qz;
    state.qw = pose.qw;
  }
  world.state.cars[id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const autopilot = new Autopilot(direction === 1 ? road : reverseRoad, physics);
  autopilot.setPassingEnabled(true);
  autopilot.setMode(mode);
  autopilot.setSpeedCap(cap);
  const car: Car = {
    id,
    direction,
    vehicle,
    autopilot,
    input: emptyInput(),
    s,
    lateral: lane,
    speed: speed * direction,
    accumulator: (cars.length & 1) * CONTROL_DT * 0.5,
    elapsed: 0,
    launch: speed,
  };
  cars.push(car);
  autopilot.setTrafficField(fieldFor(car, cars));
  return car;
}

function measureCar(car: Car): void {
  car.vehicle.absoluteTranslation(position);
  const p = road.project(position.x, position.z, car.s);
  car.s = p.s;
  car.lateral = p.lateral;
  const v = car.vehicle.chassis.linvel();
  const heading = road.sampleAt(p.s).heading;
  car.speed = v.x * Math.sin(heading) + v.z * Math.cos(heading);
}

/** Every wheel's ground: `true` when one stands on the desert (sand or rock). */
interface WithController {
  readonly controller: RAPIER.DynamicRayCastVehicleController | null;
}
function wheelInDesert(vehicle: Vehicle): boolean {
  const controller = (vehicle as unknown as WithController).controller;
  if (!controller) return false;
  for (let i = 0; i < vehicle.wheelRide.length; i++) {
    if (!controller.wheelIsInContact(i)) continue;
    const ground = controller.wheelGroundObject(i);
    if (!ground) continue;
    const type = ground.shape.type;
    if (type !== physics.rapier.ShapeType.TriMesh && type !== physics.rapier.ShapeType.HeightField) continue;
    const surfaceType = physics.surfaces.lookupType(ground.handle);
    if (surfaceType === SurfaceType.Sand || surfaceType === SurfaceType.Rock) {
      if (TRACE) {
        const cp = controller.wheelContactPoint(i);
        if (cp) {
          const p = road.project(cp.x, cp.z);
          console.log(
            `      wheel ${i} on ${SurfaceType[surfaceType]}, ${(Math.abs(p.lateral) - road.halfWidthAt(p.s)).toFixed(2)} m past the paint at s ${p.s.toFixed(0)}`,
          );
        }
      }
      return true;
    }
  }
  return false;
}

interface RunResult {
  label: string;
  passed: number;
  byKind: Map<string, number>;
  ahead: number;
  givenUp: number;
  contacts: number;
  desert: number;
  desertSeconds: number;
  slides: number;
  maxSlipDeg: number;
  closest: number;
  meanSpeedKmh: number;
  firstPassS: number;
  allPassedS: number;
  vergeSeconds: number;
  vergeTopKmh: number;
}

/** `Autopilot.lateral` is private; the bench reads the verge-pass state nothing in the game publishes. */
interface LateralView {
  readonly lateral: { readonly shoulderYielding: boolean; readonly shoulderPassing: boolean };
}

async function runScenario(label: string, leaders: number, leaderSpeed: number, engine: string | undefined): Promise<RunResult> {
  const cars: Car[] = [];
  const ego = placeCar(cars, 'ego', START_S, 1, 'frantic', leaderSpeed, Infinity, EGO_MODEL, engine);
  const queue: Car[] = [];
  // Nose to tail at the sleeper's own following distance at that pace: about 1.6 s.
  const spacing = 4.4 + leaderSpeed * 1.6;
  for (let i = 0; i < leaders; i++) {
    queue.push(placeCar(cars, `q${i}`, START_S + 45 + i * spacing, 1, 'sleeper', leaderSpeed, leaderSpeed, OTHER_MODEL));
  }
  // A car every 70-110 m coming the other way, out past where the run can reach.
  let oncomingS = START_S + 50;
  let k = 0;
  const reach = START_S + 120 + SECONDS * (45 + 20);
  while (oncomingS < reach) {
    placeCar(cars, `o${k}`, oncomingS, -1, 'sleeper', 20, 20, OTHER_MODEL);
    oncomingS += 70 + ((k * 37) % 41);
    k++;
  }
  buildRoad(START_S - 200, reach + 200);
  physics.step();
  // Land on the brake, as the benches do, then roll at the launch speed.
  for (const car of cars) car.input.brake = 1;
  for (let i = 0; i < 90; i++) {
    for (const car of cars) car.vehicle.fixedUpdate(FIXED_DT, car.input);
    physics.step();
    for (const car of cars) car.vehicle.postStep();
  }
  for (const car of cars) {
    car.input.brake = 0;
    car.vehicle.launchRolling(car.launch);
    car.autopilot.setEngaged(true);
    measureCar(car);
  }

  const result: RunResult = {
    label,
    passed: 0,
    byKind: new Map(),
    ahead: leaders,
    givenUp: 0,
    contacts: 0,
    desert: 0,
    desertSeconds: 0,
    slides: 0,
    maxSlipDeg: 0,
    closest: Infinity,
    meanSpeedKmh: 0,
    firstPassS: Infinity,
    allPassedS: Infinity,
    vergeSeconds: 0,
    vergeTopKmh: 0,
  };
  const egoView: LateralView = ego.autopilot as unknown as LateralView;
  /** Per queue car: is it still ahead, and the pass kind seen while level. */
  const stillAhead = queue.map(() => true);
  const levelKind = queue.map(() => '');
  let wasYielding = false;
  let inDesert = false;
  let sliding = false;
  const startS = ego.s;
  const egoHalfWidth = ego.vehicle.modelMeasure.halfExtents[0];
  const steps = Math.ceil(SECONDS / FIXED_DT);
  for (let step = 0; step < steps; step++) {
    for (const car of cars) {
      car.accumulator += FIXED_DT;
      car.elapsed += FIXED_DT;
      if (car.accumulator >= CONTROL_DT) {
        const dt = car.elapsed;
        car.elapsed = 0;
        car.accumulator %= CONTROL_DT;
        car.autopilot.drive(dt, car.vehicle, car.input, 0, 0);
      }
      car.vehicle.fixedUpdate(FIXED_DT, car.input);
    }
    physics.step();
    for (const car of cars) {
      car.vehicle.postStep();
      measureCar(car);
      const impact = car.vehicle.lastImpact;
      if (impact && impact.severityMps > CONTACT_MPS && (car === ego || queue.includes(car))) result.contacts++;
    }
    ego.vehicle.absoluteTranslation(position);
    keepDesert(position.x, position.z, ego.lateral);
    const t = (step + 1) * FIXED_DT;
    const manoeuvre = ego.autopilot.manoeuvre;
    for (let i = 0; i < queue.length; i++) {
      const other = queue[i]!;
      const along = other.s - ego.s;
      if (Math.abs(along) < 4.6) {
        if (manoeuvre.startsWith('pass')) levelKind[i] = manoeuvre;
        result.closest = Math.min(
          result.closest,
          Math.abs(other.lateral - ego.lateral) - egoHalfWidth - other.vehicle.modelMeasure.halfExtents[0],
        );
      }
      if (stillAhead[i] && along < -4.6) {
        stillAhead[i] = false;
        result.passed++;
        const kind = levelKind[i] || 'other';
        result.byKind.set(kind, (result.byKind.get(kind) ?? 0) + 1);
        result.firstPassS = Math.min(result.firstPassS, t);
        if (TRACE) console.log(`    t=${t.toFixed(1)} past ${other.id} by ${kind}`);
      } else if (!stillAhead[i] && along > 4.6) {
        // Dropped back behind it again: that pass is undone.
        stillAhead[i] = true;
        result.passed--;
        const kind = levelKind[i] || 'other';
        result.byKind.set(kind, (result.byKind.get(kind) ?? 0) - 1);
      }
    }
    if (result.passed === leaders && result.allPassedS === Infinity) result.allPassedS = t;
    const yielding = egoView.lateral.shoulderYielding;
    if (yielding && !wasYielding) {
      result.givenUp++;
      if (TRACE) console.log(`    t=${t.toFixed(1)} verge pass given up`);
    }
    wasYielding = yielding;
    const desertNow = wheelInDesert(ego.vehicle);
    if (desertNow) result.desertSeconds += FIXED_DT;
    if (desertNow && !inDesert) result.desert++;
    inDesert = desertNow;
    const v = ego.vehicle.chassis.linvel();
    const rotation = ego.vehicle.chassis.rotation();
    const fx = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
    const fz = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
    const forward = Math.hypot(fx, fz) || 1;
    const along = (v.x * fx + v.z * fz) / forward;
    const across = (v.x * fz - v.z * fx) / forward;
    const speed = Math.hypot(v.x, v.z);
    const slip = speed > 10 && along > 0 ? (Math.atan2(Math.abs(across), along) * 180) / Math.PI : 0;
    result.maxSlipDeg = Math.max(result.maxSlipDeg, slip);
    if (slip > SLIDE_DEG && !sliding) result.slides++;
    sliding = slip > SLIDE_DEG ? true : slip < SLIDE_DEG / 2 ? false : sliding;
    if (Math.abs(ego.lateral) + egoHalfWidth > road.halfWidthAt(ego.s)) {
      result.vergeSeconds += FIXED_DT;
      result.vergeTopKmh = Math.max(result.vergeTopKmh, speed * 3.6);
    }
    if (TRACE && step % 30 === 0) {
      const a = ego.autopilot as unknown as Record<string, unknown>;
      const lead = queue.find((_, i) => stillAhead[i]);
      console.log(
        `    t=${t.toFixed(1)} lat ${ego.lateral.toFixed(2)} line ${ego.autopilot.commandedLine.toFixed(2)} ` +
          `${(speed * 3.6).toFixed(0)}>${(ego.autopilot.targetSpeed * 3.6).toFixed(0)} ${ego.autopilot.bindingSpeedLimit} ` +
          `${ego.autopilot.activity}/${ego.autopilot.lateralCommitment ?? '-'} ${manoeuvre} ` +
          `grant ${a.shoulderPassAllowed} on ${egoView.lateral.shoulderPassing} yield ${yielding} urge ${a.passUrgeValue} ` +
          `passed ${result.passed}${lead ? ` next ${lead.id} ${(lead.s - ego.s).toFixed(1)} m` : ''}` +
          `${desertNow ? ' DESERT' : ''}`,
      );
    }
  }
  result.ahead = stillAhead.filter(Boolean).length;
  result.meanSpeedKmh = ((ego.s - startS) / SECONDS) * 3.6;
  for (const car of cars) {
    car.vehicle.dispose();
    delete world.state.cars[car.id];
  }
  return result;
}

function report(r: RunResult): void {
  const kinds = ['pass-shoulder', 'pass-middle', 'pass-oncoming', 'other']
    .map((k) => `${k.replace('pass-', '')} ${r.byKind.get(k) ?? 0}`)
    .join(', ');
  const time = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} s` : '-');
  console.log(
    `  ${r.label.padEnd(26)} passed ${r.passed} (${kinds}), still ahead ${r.ahead}, ` +
      `first ${time(r.firstPassS)}, all ${time(r.allPassedS)}, verge given up ${r.givenUp}, ` +
      `contacts ${r.contacts}, wheels in the desert ${r.desert} (${r.desertSeconds.toFixed(1)} s), ` +
      `slides ${r.slides} (max ${r.maxSlipDeg.toFixed(1)} deg), closest level ${Number.isFinite(r.closest) ? r.closest.toFixed(2) + ' m' : '-'}, ` +
      `on the verge ${r.vergeSeconds.toFixed(1)} s up to ${r.vergeTopKmh.toFixed(0)} km/h, mean ${r.meanSpeedKmh.toFixed(0)} km/h`,
  );
}

const runs: [string, number, number][] = [];
if (SCENARIO === 'queue' || SCENARIO === 'all') runs.push(['queue of 6 at 58 km/h', 6, 16]);
if (SCENARIO === 'one' || SCENARIO === 'all') {
  runs.push(['one car at 58 km/h', 1, 16]);
  runs.push(['one car at 80 km/h', 1, 22]);
}
// The stream's frantic car carries the strongest engine its body takes; the player's
// own car on the frantic autopilot keeps its stock one.
const engines: [string, string | undefined][] = ENGINE === 'all'
  ? [['M30', FRANTIC_ENGINE], ['stock', undefined]]
  : ENGINE === 'stock' ? [['stock', undefined]] : [['M30', FRANTIC_ENGINE]];
const totals = { passed: 0, leaders: 0, givenUp: 0, contacts: 0, desert: 0, slides: 0 };
for (const [engineLabel, engine] of engines) {
  for (const [label, leaders, speed] of runs) {
    if (TRACE) console.log(`  ${label}, ${engineLabel}:`);
    const r = await runScenario(`${label}, ${engineLabel}`, leaders, speed, engine);
    report(r);
    totals.passed += r.passed;
    totals.leaders += leaders;
    totals.givenUp += r.givenUp;
    totals.contacts += r.contacts;
    totals.desert += r.desert;
    totals.slides += r.slides;
  }
}
console.log(
  `  total: passed ${totals.passed} of ${totals.leaders}, verge given up ${totals.givenUp}, contacts ${totals.contacts}, ` +
    `wheels in the desert ${totals.desert}, slides ${totals.slides}`,
);
