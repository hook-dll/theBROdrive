/**
 * Deterministic real-autopilot road-driving harness.
 *
 * This defends the fixed-step contract between Autopilot, Road and Vehicle: a
 * controller that merely writes plausible inputs, but cannot keep a real car on a
 * curved road, make progress, respect an obstacle, or release human controls fails.
 * The collider is a procedural strip sampled from the real Road and its real surface
 * field, rather than a flat plane: that keeps the car on the same grade and curve the
 * controller projects against without requiring browser-only road texture canvases.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  preloadCarModels,
} from '../src/render/carmodel';
import { benchCarState } from './benchcar';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from '../src/vehicle/autopilot';
import { carModel } from '../src/vehicle/carmodels';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import type { DriveRoad } from '../src/world/road';
import { forceWeather, updateWeather, weather } from '../src/world/weather';

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
// Every catalogue model is an imported body now, so the bench loads real FBX files
// off disk rather than building its car in code. Constructing a `Vehicle` also paints
// its boot's sticker decals, which needs a 2D canvas context to exist.
installAssetShim();
installDocumentShim();

const MODEL_ID = new URL(import.meta.url).searchParams.get('model') ?? 'sv_vaz2105r';
const START_S = 1_000;
const ROUTE_METRES = 3_600;
const ROAD_STEP = 1;
/**
 * How far past the asphalt the collider ribbon has to support the outer wheels: the
 * graded shoulder a pass on the right or a road return may use.
 */
const STATIC_AVOID_EDGE = ROAD_HALF_WIDTH + 4;
const PLANNED_CLEARANCE_M = 1.05 + 0.4;
/**
 * Outer edge of the outer tyre's contact patch, from the car's centreline: what has
 * to stay on the asphalt. The body is wider than the track, so a saloon may hang a
 * few centimetres of wing over the paint with all four tyres still on it.
 */
const WHEEL_HALF_TRACK_M =
  (carModel(MODEL_ID).factory.frontTrack + carModel(MODEL_ID).factory.tyreWidth) * 0.5;
const RIBBON_HALF_WIDTH = STATIC_AVOID_EDGE + 1;
// The tuning is the shipped table, never a copy: this bench's own numbers had
// drifted to a lateral budget 40% above the autopilot's, so every corner-speed
// check was passing against a limit the car never used.
const MODES = AUTOPILOT_MODES;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

function carState(road: Road, startS: number, lateral = 0, modelId = MODEL_ID): CarState {
  const p = lateral === 0 ? road.sampleAt(startS) : road.offsetPoint(startS, lateral);
  return benchCarState(modelId, {
    id: 'autopilot-bench',
    // The SAME placement the world uses for a spawned car, with no clear air under
    // it. A hand-picked 1.2 m of drop put the wheels above their own suspension
    // travel, so the chassis met the ribbon itself: Rapier resolved that penetration
    // by throwing the car off the road at up to 200 km/h, at a handful of road
    // positions that moved whenever the ribbon was retessellated.
    x: p.x,
    y: carSpawnYAboveGround(carModelMeasure(modelId), p.y, 0),
    z: p.z,
    heading: road.sampleAt(startS).heading,
  });
}

/** Builds only the real, narrow asphalt ribbon needed by this run; no visual mesh needed. */
function addRoadCollider(physics: PhysicsWorld, road: Road, from: number, to: number): void {
  const field = new SurfaceField(road.seed);
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  const chunkMetres = 100;
  const point = { x: 0, y: 0, z: 0 };
  for (let chunkFrom = from; chunkFrom < to; chunkFrom += chunkMetres) {
    const chunkTo = Math.min(to, chunkFrom + chunkMetres);
    const rows = Math.ceil((chunkTo - chunkFrom) / ROAD_STEP) + 1;
    const vertices = new Float32Array(rows * 6);
    for (let row = 0; row < rows; row++) {
      const s = Math.min(chunkTo, chunkFrom + row * ROAD_STEP);
      for (let side = 0; side < 2; side++) {
        // The ribbon reaches PAST the asphalt on purpose. The autopilot is allowed a
        // wheel on the verge to squeeze past a stopped car (PASSING_VERGE_M in
        // autopilot.ts), and in the game the desert collider is flush with the asphalt
        // edge; a bench ribbon that stopped at the paint dropped every excursion into
        // the void and reported it as an autopilot that could not hold a line.
        const lateral = side === 0 ? -RIBBON_HALF_WIDTH : RIBBON_HALF_WIDTH;
        road.offsetPoint(s, lateral, point);
        const i = (row * 2 + side) * 3;
        vertices[i] = point.x;
        vertices[i + 1] = roadSurfaceY(road, field, s, lateral, point.x, point.z);
        vertices[i + 2] = point.z;
      }
    }
    const indices = new Uint32Array((rows - 1) * 6);
    for (let row = 0, i = 0; row < rows - 1; row++) {
      const a = row * 2;
      indices[i++] = a; indices[i++] = a + 2; indices[i++] = a + 1;
      indices[i++] = a + 2; indices[i++] = a + 3; indices[i++] = a + 1;
    }
    road.conditionAt((chunkFrom + chunkTo) * 0.5, condition);
    physics.addStaticTrimesh(vertices, indices, condition.surface);
  }
}

interface Rig { physics: PhysicsWorld; vehicle: Vehicle; road: Road; autopilot: Autopilot; input: InputFrame; }

async function makeRig(
  startS = START_S,
  routeMetres = ROUTE_METRES,
  modelId = MODEL_ID,
): Promise<Rig> {
  const road = new Road(42);
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, startS - 40, startS + routeMetres + 400);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const state = carState(road, startS, 0, modelId);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const autopilot = new Autopilot(road, physics);
  const input = emptyInput();
  // LAND FIRST, THEN PIN.
  //
  // The car is placed 1.2 m over the road so no wheel starts inside the ribbon, and
  // it has to come down before anything is measured. The handbrake cannot do that:
  // `Vehicle` latches a parking hold the moment the lever is on below walking pace,
  // which pinned the body in mid-air for the whole settle. The drop then happened on
  // the first driven frame instead, into a mesh the wheels were already overlapping,
  // and Rapier resolved that penetration by throwing the car off the road at 90 km/h
  // — reported, for two modes, as an autopilot that could not traverse gravel.
  //
  // So: the foot brake while it falls and stops, then the handbrake to hold it on the
  // gradient until the first measured frame.
  input.brake = 1;
  for (let i = 0; i < 120; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.brake = 0;
  input.handbrake = true;
  for (let i = 0; i < 60; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.handbrake = false;
  return { physics, vehicle, road, autopilot, input };
}

function step(rig: Rig): void {
  rig.autopilot.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
  rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
  rig.physics.step();
  rig.vehicle.postStep();
}

function speed(vehicle: Vehicle): number {
  const v = vehicle.chassis.linvel();
  return Math.hypot(v.x, v.z);
}

interface DriveMetrics { meanSpeed: number; peakSpeed: number; meanLateral: number; maxLateral: number; maxOverhang: number; rmsLateral: number; signChangesPerKm: number; lineCrossingsPerKm: number; lineRms: number; progress: number; monotonic: boolean; tightRadius: number; tightSpeed: number; }

/**
 * A haboob's WIND across the road: the weather's own gusty wind (world/weather.ts) at
 * the car, its mean turned square to the road each step so the whole route is a
 * crosswind, blowing toward the road's right (`side` +1) or left (-1). The dust is
 * cleared: in it the driver shelters (vehicle/weatherpace.ts), and this is about the
 * wind; `checkShelter` is about the dust.
 */
const HABOOB_HOLD = 0.45;
const blowAt = { x: 0, y: 0, z: 0 };
function blowAcross(rig: Rig, clockS: number, s: number, side: number): void {
  const at = rig.vehicle.absoluteTranslation(blowAt);
  updateWeather(rig.road.seed, clockS, FIXED_DT, at.x, at.z, 0);
  const heading = rig.road.sampleAt(s).heading;
  weather.windX = -side * Math.cos(heading);
  weather.windZ = side * Math.sin(heading);
  weather.dust = 0;
}

/** Still air again: a 'clear' frame, written at once (see `forceWeather`). */
function calm(rig: Rig): void {
  forceWeather('clear', 0.5);
  updateWeather(rig.road.seed, 0, FIXED_DT, 0, 0, 0);
  forceWeather(null);
}

async function measureMode(mode: AutopilotMode, modelId = MODEL_ID, crosswind = 0): Promise<DriveMetrics> {
  const rig = await makeRig(START_S, ROUTE_METRES, modelId);
  if (crosswind !== 0) {
    updateWeather(rig.road.seed, 0, FIXED_DT, 0, 0, 0);
    forceWeather('haboob', HABOOB_HOLD, 1e6);
  }
  rig.autopilot.setMode(mode);
  rig.autopilot.setEngaged(true);
  let previousS = -Infinity;
  let monotonic = true;
  let startS = 0;
  let sumSpeed = 0;
  let sumLateralSq = 0;
  let sumLateral = 0;
  let maxLateral = 0;
  /**
   * Worst the OUTER TYRE hung past the asphalt edge, measured at its own arclength.
   *
   * The bound used to be the narrow road's half width, which said "the car sits in
   * the lane beside the crown" — true only while that was the lane every driver was
   * given. Drivers keep to the outermost lane now, so on a widened stretch a correct
   * line is 4.2 m out and the old bound scored it as leaving the road. What the check
   * exists for is whether the car is driving on the asphalt, and that is this.
   */
  let maxOverhang = -Infinity;
  let samples = 0;
  let signChanges = 0;
  let previousSign = 0;
  let tightCurvature = 0;
  let tightSpeed = 0;
  /**
   * Weave WITHIN the lane: the car against the line it is steering to, not against the
   * centreline. A car swinging a metre either side of its own lane never changes the
   * sign of its centre offset, so the check above could not see the GAZ-21 doing
   * exactly that at 32 crossings per km. Measured after the engagement transient.
   */
  let lineCrossings = 0;
  let previousLineSign = 0;
  let lineSumSq = 0;
  let lineSamples = 0;
  let lineFromS = NaN;
  const settleSteps = Math.round(8 / FIXED_DT);
  let peakSpeed = 0;
  const maxSteps = Math.ceil(360 / FIXED_DT);
  for (let i = 0; i < maxSteps; i++) {
    if (crosswind !== 0) blowAcross(rig, i * FIXED_DT, previousS < 0 ? START_S : previousS, crosswind);
    step(rig);
    const p = rig.road.project(rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 }).x, rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 }).z, previousS < 0 ? START_S : previousS);
    if (i === 0) startS = p.s;
    if (p.s + 0.03 < previousS) monotonic = false;
    previousS = p.s;
    const lateral = Math.abs(p.lateral);
    const sign = Math.abs(p.lateral) > 0.15 ? Math.sign(p.lateral) : 0;
    if (sign && previousSign && sign !== previousSign) signChanges++;
    if (sign) previousSign = sign;
    const v = speed(rig.vehicle);
    sumSpeed += v; sumLateral += lateral; sumLateralSq += p.lateral * p.lateral; maxLateral = Math.max(maxLateral, lateral); samples++;
    peakSpeed = Math.max(peakSpeed, v);
    if (i >= settleSteps) {
      if (Number.isNaN(lineFromS)) lineFromS = p.s;
      const lineError = p.lateral - rig.autopilot.commandedLine;
      const lineSign = Math.abs(lineError) > 0.1 ? Math.sign(lineError) : 0;
      if (lineSign && previousLineSign && lineSign !== previousLineSign) lineCrossings++;
      if (lineSign) previousLineSign = lineSign;
      lineSumSq += lineError * lineError;
      lineSamples++;
    }
    maxOverhang = Math.max(maxOverhang, lateral + WHEEL_HALF_TRACK_M - rig.road.halfWidthAt(p.s));
    const curvature = Math.abs(rig.road.sampleAt(p.s).curvature);
    if (curvature > tightCurvature) { tightCurvature = curvature; tightSpeed = v; }
    if (p.s >= START_S + ROUTE_METRES) break;
  }
  if (crosswind !== 0) calm(rig);
  const progress = previousS - startS;
  const lineKm = Math.max((previousS - lineFromS) / 1000, 0.001);
  return { meanSpeed: sumSpeed / samples, peakSpeed, meanLateral: sumLateral / samples, maxLateral, maxOverhang, rmsLateral: Math.sqrt(sumLateralSq / samples), signChangesPerKm: signChanges / Math.max(progress / 1000, 0.001), lineCrossingsPerKm: lineCrossings / lineKm, lineRms: Math.sqrt(lineSumSq / Math.max(lineSamples, 1)), progress, monotonic, tightRadius: 1 / Math.max(tightCurvature, 1e-9), tightSpeed };
}

/**
 * The slowest-yawing car in the catalogue, whatever `MODEL_ID` is: a GAZ-21 on
 * cross-plies and 0.95 Hz springs answers the wheel twice as late as a Zhiguli, which
 * is what turned a lane hold with no rate damping into a ±1 m weave (see
 * LANE_HOLD_LEAD_S in autopilot.ts).
 */
const SLOW_YAW_MODEL_ID = 'sv_gaz21';

/** Weave bounds: a real crossing every 200 m at most, and a tenth of a lane of RMS. */
const LINE_CROSSINGS_PER_KM_MAX = 5;
const LINE_RMS_MAX_M = 0.15;

function checkLineHold(label: string, result: DriveMetrics): void {
  check(
    `${label}: holds its own line without weaving`,
    result.lineCrossingsPerKm <= LINE_CROSSINGS_PER_KM_MAX && result.lineRms <= LINE_RMS_MAX_M,
    `${result.lineCrossingsPerKm.toFixed(1)} crossings/km, ${result.lineRms.toFixed(3)} m RMS off the commanded line`,
  );
}

/**
 * Traffic in a haboob's crosswind: the same route with the weather's own gusty wind
 * at full strength (17 m/s mean, gusts σ 20% of it), turned square to the road and
 * blowing toward either side, for the default car and the slowest-yawing one. The
 * side force and its yaw moment are real now (`Vehicle.applyAero`), so the driver
 * has to hold a correction and answer the gusts.
 *
 * What it must still do is drive in its lane: every tyre on the asphalt, and no weave
 * across its line. It is NOT held to the still-air RMS bound, and the RMS is printed
 * instead. The sleeper and hurried drivers steer on their lateral error alone (no
 * `curvatureTrim`), so a steady side force is held with a steady offset downwind, the
 * way a driver without a correction already wound in holds it: measured, 0.13-0.14 m
 * for the rally 2105 and 0.36-0.41 m for the GAZ-21, which needs the most steering.
 */
async function checkCrosswind(): Promise<void> {
  for (const modelId of [MODEL_ID, SLOW_YAW_MODEL_ID]) {
    for (const side of [1, -1]) {
      const result = await measureMode('hurried', modelId, side);
      const label = `${carModel(modelId).label} hurried, haboob from the ${side > 0 ? 'left' : 'right'}`;
      check(
        `${label}: stays on asphalt`,
        result.maxOverhang <= carModel(modelId).factory.tyreWidth,
        `worst lateral ${result.maxLateral.toFixed(2)} m, worst tyre past the asphalt ${result.maxOverhang.toFixed(3)} m`,
      );
      check(
        `${label}: no weave`,
        result.lineCrossingsPerKm <= LINE_CROSSINGS_PER_KM_MAX,
        `${result.lineCrossingsPerKm.toFixed(1)} crossings/km, ${result.lineRms.toFixed(3)} m RMS off the commanded line`,
      );
    }
  }
}

/**
 * Inside the dust: the driver pulls to the edge of the asphalt on its own side, stops
 * with the hazards on and stays there (vehicle/weatherpace.ts). Every mode does; hurried
 * is the race rivals' mode, so the ghosts' shelter has a live counterpart.
 */
async function checkShelter(): Promise<void> {
  const rig = await makeRig(START_S, ROUTE_METRES, MODEL_ID);
  updateWeather(rig.road.seed, 0, FIXED_DT, 0, 0, 0);
  forceWeather('haboob', HABOOB_HOLD, 1e6);
  rig.autopilot.setMode('hurried');
  rig.autopilot.setEngaged(true);
  const at = { x: 0, y: 0, z: 0 };
  let s = START_S;
  let maxOverhang = -Infinity;
  const steps = Math.round(60 / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    rig.vehicle.absoluteTranslation(at);
    updateWeather(rig.road.seed, i * FIXED_DT, FIXED_DT, at.x, at.z, 0);
    step(rig);
    const p = rig.road.project(rig.vehicle.absoluteTranslation(at).x, at.z, s);
    s = p.s;
    maxOverhang = Math.max(maxOverhang, Math.abs(p.lateral) + WHEEL_HALF_TRACK_M - rig.road.halfWidthAt(p.s));
  }
  const p = rig.road.project(rig.vehicle.absoluteTranslation(at).x, at.z, s);
  const edgeGap = rig.road.halfWidthAt(p.s) - Math.abs(p.lateral) - 1.05;
  calm(rig);
  const label = `${carModel(MODEL_ID).label} hurried, in a haboob's dust`;
  check(
    `${label}: shelters`,
    rig.autopilot.sheltering && speed(rig.vehicle) < 0.3 && rig.vehicle.indicator === 'hazard',
    `${(speed(rig.vehicle) * 3.6).toFixed(1)} km/h after 60 s, indicator ${rig.vehicle.indicator}`,
  );
  check(
    `${label}: at the edge, on the asphalt`,
    edgeGap < 0.8 && maxOverhang <= carModel(MODEL_ID).factory.tyreWidth,
    `flank ${edgeGap.toFixed(2)} m inside the edge, worst tyre past it ${maxOverhang.toFixed(3)} m`,
  );
}

const LOOSE_ROUTE_METRES = 1_000;

/**
 * First arclength at or after `from` whose whole route is gravel, with 60 m of gravel
 * behind it so the car lands on it too.
 *
 * Found, not written down: the district used to start at 12 250 m on seed 42 and the
 * road generator has since moved it (that arclength is asphalt now), which turned
 * both gravel checks into checks about asphalt — `allGravel` false and an asphalt
 * cruise judged against a loose-surface ceiling.
 */
function gravelStart(road: Road, from: number, routeMetres: number): number {
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  for (let s = from; s < from + 100_000; s += 50) {
    let gravel = true;
    for (let x = s - 60; x <= s + routeMetres + 40; x += 10) {
      road.conditionAt(x, condition);
      if (condition.surface !== SurfaceType.Gravel) {
        gravel = false;
        break;
      }
    }
    if (gravel) return s;
  }
  throw new Error(`no ${routeMetres} m gravel district after ${from} m`);
}
const LOOSE_START_S = gravelStart(new Road(42), 0, LOOSE_ROUTE_METRES);

interface LooseSurfaceMetrics {
  meanSpeed: number;
  peakSpeed: number;
  maxLateral: number;
  progress: number;
  monotonic: boolean;
  allGravel: boolean;
}

async function measureLooseSurface(mode: AutopilotMode): Promise<LooseSurfaceMetrics> {
  const rig = await makeRig(LOOSE_START_S, LOOSE_ROUTE_METRES);
  rig.autopilot.setMode(mode);
  rig.autopilot.setEngaged(true);
  const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 };
  let previousS = LOOSE_START_S;
  let startS = LOOSE_START_S;
  let sumSpeed = 0;
  let peakSpeed = 0;
  let maxLateral = 0;
  let samples = 0;
  let monotonic = true;
  let allGravel = true;
  for (let i = 0; i < Math.ceil(180 / FIXED_DT); i++) {
    step(rig);
    const position = rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    const projection = rig.road.project(position.x, position.z, previousS);
    if (i === 0) startS = projection.s;
    if (i >= 2 / FIXED_DT && projection.s + 0.25 < previousS) monotonic = false;
    previousS = projection.s;
    rig.road.conditionAt(projection.s, condition);
    allGravel &&= condition.surface === SurfaceType.Gravel;
    maxLateral = Math.max(maxLateral, Math.abs(projection.lateral));
    if (i >= 5 / FIXED_DT) {
      const currentSpeed = speed(rig.vehicle);
      sumSpeed += currentSpeed;
      peakSpeed = Math.max(peakSpeed, currentSpeed);
      samples++;
    }
    if (projection.s >= LOOSE_START_S + LOOSE_ROUTE_METRES) break;
  }
  return {
    meanSpeed: sumSpeed / Math.max(samples, 1),
    peakSpeed,
    maxLateral,
    progress: previousS - startS,
    monotonic,
    allGravel,
  };
}

/**
 * First arclength at or after `from` whose whole drive stays one lane each way.
 *
 * Scenarios about a narrow road have to say so: the widening lattice draws a passing
 * window in every cell, and a scenario anchored on a fixed arclength silently becomes
 * a scenario about a dual carriageway when one lands there.
 */
function narrowStart(road: Road, from: number, routeMetres: number): number {
  for (let s = from; s < from + 40_000; s += 50) {
    let narrow = true;
    for (let x = s - 40; x <= s + routeMetres; x += 20) {
      if (road.lanesPerSideAt(x) > 1) {
        narrow = false;
        break;
      }
    }
    if (narrow) return s;
  }
  return from;
}

function checkHandover(): void {
  const road = new Road(42);
  const autopilot = new Autopilot(road);
  const input = { ...emptyInput(), throttle: 0.37, brake: 0.19, reverse: true, steer: -0.42, handbrake: true, shift: 1 };
  const before = JSON.stringify(input);
  autopilot.drive(FIXED_DT, {} as Vehicle, input, 0, 0);
  check('disengaged autopilot leaves human frame untouched', JSON.stringify(input) === before, JSON.stringify(input));
}
async function checkAutomaticLights(): Promise<void> {
  const rig = await makeRig();
  rig.autopilot.setMode('sleeper');
  rig.autopilot.setEngaged(true);

  rig.autopilot.setOncomingGap(Infinity);
  step(rig);
  const emptyRoad = rig.vehicle.headlights;
  rig.autopilot.setOncomingGap(180);
  step(rig);
  const oncomingTraffic = rig.vehicle.headlights;
  check(
    'autonomous car runs on low beam whatever is coming',
    emptyRoad === 'low' && oncomingTraffic === 'low',
    `${emptyRoad}/${oncomingTraffic}`,
  );

  // The switch is the driver's once pressed: main beam stays main beam with a car
  // 60 m away, because nothing dips it any more.
  rig.autopilot.releaseAutomaticHeadlights();
  rig.vehicle.setHeadlights('high');
  rig.autopilot.setOncomingGap(60);
  step(rig);
  check(
    "the driver's main beam is left alone under autopilot",
    rig.vehicle.headlights === 'high',
    rig.vehicle.headlights,
  );
  rig.vehicle.setIndicator('left');
  rig.autopilot.setEngaged(false);
  check(
    'handover clears an autonomous indicator',
    rig.vehicle.indicator === 'off',
    rig.vehicle.indicator,
  );
}

/**
 * WEDGED OFF THE ASPHALT. A player nosing a car into a roadside pole and then
 * engaging the autopilot used to get full throttle until the engine cooked: the
 * road-return manoeuvre only steers, and the stall detector — the thing that backs
 * a wedged car out — refused to look at a car that was off the road, on the theory
 * that the return WAS its manoeuvre. Being stuck is a lack of progress, and the
 * verge is where the things to get stuck on live.
 */
async function checkWedgedOffRoad(): Promise<void> {
  const lateral = -(ROAD_HALF_WIDTH + 3.2);
  const road = new Road(42);
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, START_S - 40, START_S + 200);
  const world = new GameWorld(newWorldState(42));
  const state = carState(road, START_S, lateral);
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const autopilot = new Autopilot(road, physics);
  const input = emptyInput();
  // The pole: fixed, slim, and four metres up the same off-road line.
  const pole = road.offsetPoint(START_S + 4.2, lateral);
  const poleBody = physics.world.createRigidBody(
    physics.rapier.RigidBodyDesc.fixed().setTranslation(pole.x, pole.y + 2, pole.z),
  );
  physics.world.createCollider(physics.rapier.ColliderDesc.cylinder(2.5, 0.35), poleBody);

  input.handbrake = true;
  for (let i = 0; i < 180; i++) {
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.handbrake = false;
  // Drive into it the way a player would, then hand over.
  for (let i = 0; i < 240; i++) {
    input.throttle = 0.35;
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
  }
  input.throttle = 0;
  const start = vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
  const startX = start.x;
  const startZ = start.z;
  autopilot.setMode('sleeper');
  autopilot.setEngaged(true);
  let fullThrottleSeconds = 0;
  let reverseSeconds = 0;
  let escaped = 0;
  for (let i = 0; i < Math.ceil(30 / FIXED_DT); i++) {
    autopilot.drive(FIXED_DT, vehicle, input, 0, 0);
    vehicle.fixedUpdate(FIXED_DT, input); physics.step(); vehicle.postStep();
    if (input.throttle > 0.9) fullThrottleSeconds += FIXED_DT;
    if (input.reverse) reverseSeconds += FIXED_DT;
    const p = vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    escaped = Math.max(escaped, Math.hypot(p.x - startX, p.z - startZ));
  }
  check(
    'a car wedged on the verge backs itself out',
    reverseSeconds >= 0.5 && escaped >= 5,
    `${reverseSeconds.toFixed(1)} s reversing, ${escaped.toFixed(1)} m from the pole`,
  );
  check(
    'a wedged car does not sit at full throttle',
    fullThrottleSeconds <= 15,
    `${fullThrottleSeconds.toFixed(1)} s of 30 at full throttle`,
  );
  vehicle.dispose();
  physics.world.free();
}

/**
 * Keep sensor targets physical, but remove road curvature and surface variation so
 * these checks isolate which target owns emergency braking and passing pace.
 */
async function checkPassingSafety(): Promise<void> {
  const rig = await makeRig();
  const flat: DriveRoad = {
    length: 100_000,
    conditionAt(_s, out) { Object.assign(out, { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0 }); },
    sampleAt(s) { return { s, x: 0, y: 0, z: s, heading: 0, grade: 0, curvature: 0 }; },
    headingAt() { return 0; },
    curvatureAt() { return 0; },
    bankingAt() { return 0; },
    sightDistanceAt(_s, limit) { return limit; },
    project(x, z) { return { s: z, lateral: x, height: 0 }; },
    offsetPoint(s, lateral, out = { x: 0, y: 0, z: 0 }) {
      return Object.assign(out, { x: lateral, y: 0, z: s });
    },
    halfWidthAt() { return 2.9; },
    lanesPerSideAt() { return 1; },
    laneCentreAt() { return -1.45; },
  };
  const body = (x: number, z: number, speedMps: number) => {
    const other = rig.physics.addDynamicBox(
      { x: 0.9, y: 0.8, z: 2.3 }, { x, y: 1, z }, 1_000,
    ).body;
    other.setGravityScale(0, true);
    other.setLinearDamping(0);
    other.setLinvel({ x: 0, y: 0, z: speedMps }, true);
    return other;
  };
  const lead = body(-1.45, 1012.3, 20);
  const oncoming = body(1.45, 1022.3, -20);
  const placeEgo = (): void => {
    rig.vehicle.rescueTo(1.45, 1, 1_000, 0);
    rig.vehicle.chassis.setGravityScale(0, true);
    rig.vehicle.chassis.setLinvel({ x: 0, y: 0, z: 20 }, true);
  };
  placeEgo();
  const emergency = new Autopilot(flat, rig.physics);
  emergency.setMode('hurried');
  emergency.setSpeedCap(20);
  emergency.setEngaged(true);
  for (let i = 0; i < 2; i++) {
    rig.physics.step();
    emergency.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
    console.log(
      `  emergency t=${((i + 1) * FIXED_DT).toFixed(3)} gap=${emergency.obstacleGap.toFixed(2)} ` +
        `obs=${emergency.obstacleSpeed.toFixed(2)} target=${emergency.targetSpeed.toFixed(2)} ` +
        `activity=${emergency.activity} limit=${emergency.bindingSpeedLimit} ` +
        `brake=${rig.input.brake.toFixed(2)} throttle=${rig.input.throttle.toFixed(2)}`,
    );
  }
  // FULL emergency braking is the car's THRESHOLD pedal, not a floored one: since the
  // brakes reach the tyres the autopilot brakes at the pedal share that peaks the
  // first axle (`Vehicle.thresholdBrakePedal`), and every pedal it sends is scaled by
  // it. A floored 1.0 would lock the wheels. Ordinary speed control for this driver
  // stops at `brakeCeiling` (0.8) of that.
  const fullPedal = rig.vehicle.thresholdBrakePedal;
  check(
    'a closer home-lane leader cannot mask oncoming emergency braking',
    rig.input.brake >= fullPedal - 1e-6 && rig.input.throttle === 0,
    `brake ${rig.input.brake.toFixed(2)} of a ${fullPedal.toFixed(2)} threshold pedal, throttle ${rig.input.throttle.toFixed(2)}`,
  );

  rig.physics.removeBody(oncoming);

  const wide: DriveRoad = {
    ...flat,
    halfWidthAt() { return 5.8; },
    lanesPerSideAt() { return 2; },
    laneCentreAt(_s, lane) { return -1.45 - 2.9 * lane; },
  };
  rig.vehicle.rescueTo(-2.3, 1, 1_000, 0);
  rig.vehicle.chassis.setLinvel({ x: 0, y: 0, z: 17 }, true);
  lead.setTranslation({ x: -1.45, y: 1, z: 1027.3 }, true);
  lead.setLinvel({ x: 0, y: 0, z: 10 }, true);
  const rear = body(-4.35, 970, 35);
  const merging = new Autopilot(wide, rig.physics);
  merging.setMode('frantic');
  merging.setSpeedCap(30);
  merging.setTrafficField({
    forEachNear(ahead, behind, visit) {
      const along = rear.translation().z - rig.vehicle.chassis.translation().z;
      const s = Math.sign(along) * Math.max(0, Math.abs(along) - 2.3);
      if (s > ahead || s < -behind) return;
      visit({ s, lateral: -4.35, speed: rear.linvel().z, halfWidth: 0.9, halfLength: 2.3 });
    },
  });
  merging.setEngaged(true);
  let furthestRight = -2.3;
  for (let i = 0; i < 60; i++) {
    rig.physics.step();
    merging.drive(FIXED_DT, rig.vehicle, rig.input, 0, 0);
    furthestRight = Math.min(furthestRight, merging.commandedLine);
  }
  check(
    'a faster rear neighbour blocks lattice entries into its lane',
    furthestRight >= -4.35 + 0.9 + 1.05 - 1e-6,
    `furthest commanded line ${furthestRight.toFixed(2)} m, rear lane -4.35 m`,
  );
  rig.vehicle.dispose();
  rig.physics.world.free();
}

interface OvertakeMetrics {
  crossed: boolean;
  completed: boolean;
  straddleSeconds: number;
  clearanceWhileLevel: number;
  indicatorChanges: number;
  /** Steps out past the crown with the passed car still ahead and a pass attempt live. */
  committedSteps: number;
  /** Of those, steps whose target is over the cap with the throttle open. */
  kickdownSteps: number;
  peakCommittedTarget: number;
}

/**
 * OVERTAKING A SLOWER CAR WITH THE OPPOSING LANE EMPTY, with a second real car on
 * the road: the only scenario in which the driver's own line
 * leaves its lane while a moving body stays in it, and every fault this defends
 * against came from measuring that body against the moving line. Seen in play
 * before this check existed: the car went to the centre of the road, flashed both
 * indicators, and pushed the car it was trying to pass along in front of it.
 */
async function driveOvertake(chaserMode: AutopilotMode, chaserCap: number): Promise<OvertakeMetrics> {
  const leadAhead = 45;
  const leadCap = 12;
  const seconds = 30;
  const road = new Road(42);
  const startS = narrowStart(road, START_S, 2_400);
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, startS - 60, startS + 2_400);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const lane = -ROAD_HALF_WIDTH / 2;
  const chaserState = { ...carState(road, startS, lane), id: 'overtake-chaser' };
  const leadState = { ...carState(road, startS + leadAhead, lane), id: 'overtake-lead' };
  world.state.cars[chaserState.id] = chaserState;
  world.state.cars[leadState.id] = leadState;
  const chaser = new Vehicle(physics, world, chaserState, scene, origin);
  const lead = new Vehicle(physics, world, leadState, scene, origin);
  const chaserPilot = new Autopilot(road, physics);
  const leadPilot = new Autopilot(road, physics);
  const chaserInput = emptyInput();
  const leadInput = emptyInput();
  chaserInput.handbrake = true;
  leadInput.handbrake = true;
  for (let i = 0; i < 180; i++) {
    chaser.fixedUpdate(FIXED_DT, chaserInput);
    lead.fixedUpdate(FIXED_DT, leadInput);
    physics.step();
    chaser.postStep();
    lead.postStep();
  }
  chaserInput.handbrake = false;
  leadInput.handbrake = false;
  chaserPilot.setMode(chaserMode);
  chaserPilot.setSpeedCap(chaserCap);
  leadPilot.setMode('sleeper');
  chaserPilot.setEngaged(true);
  leadPilot.setEngaged(true);
  let indicatorChanges = 0;
  let previousIndicator = chaser.indicator;
  let straddleSeconds = 0;
  let clearanceWhileLevel = Infinity;
  let crossed = false;
  let completed = false;
  let committedSteps = 0;
  let kickdownSteps = 0;
  let peakCommittedTarget = 0;
  const chaserPosition = new THREE.Vector3();
  const leadPosition = new THREE.Vector3();
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    leadPilot.setSpeedCap(leadCap);
    chaserPilot.drive(FIXED_DT, chaser, chaserInput, 0, 0);
    leadPilot.drive(FIXED_DT, lead, leadInput, 0, 0);
    chaser.fixedUpdate(FIXED_DT, chaserInput);
    lead.fixedUpdate(FIXED_DT, leadInput);
    physics.step();
    chaser.postStep();
    lead.postStep();
    if (chaser.indicator !== previousIndicator) {
      indicatorChanges++;
      previousIndicator = chaser.indicator;
    }
    chaser.absoluteTranslation(chaserPosition);
    lead.absoluteTranslation(leadPosition);
    const chaserRoad = road.project(chaserPosition.x, chaserPosition.z);
    const leadRoad = road.project(leadPosition.x, leadPosition.z);
    const along = leadRoad.s - chaserRoad.s;
    if (chaserRoad.lateral > 0.9) crossed = true;
    // Straddling: the body spans the centre line with the other car still ahead.
    if (Math.abs(chaserRoad.lateral) < 0.8 && along > 0) straddleSeconds += FIXED_DT;
    // Level: bumpers overlapping, which is where a clearance actually matters.
    if (Math.abs(along) < 4.6) {
      clearanceWhileLevel = Math.min(
        clearanceWhileLevel,
        Math.abs(chaserRoad.lateral - leadRoad.lateral) - PLANNED_CLEARANCE_M,
      );
    }
    if (along < -8) completed = true;
    if (chaserPilot.passAttempt && chaserRoad.lateral > 0.9 && along > 0) {
      committedSteps++;
      peakCommittedTarget = Math.max(peakCommittedTarget, chaserPilot.targetSpeed);
      if (chaserPilot.targetSpeed > chaserCap && chaserInput.throttle > 0) kickdownSteps++;
    }
  }
  chaser.dispose();
  lead.dispose();
  physics.world.free();
  return {
    crossed,
    completed,
    straddleSeconds,
    clearanceWhileLevel,
    indicatorChanges,
    committedSteps,
    kickdownSteps,
    peakCommittedTarget,
  };
}

async function checkOvertake(): Promise<void> {
  const { crossed, completed, straddleSeconds, clearanceWhileLevel, indicatorChanges } =
    await driveOvertake('frantic', Infinity);
  check(
    'frantic overtakes a slower car and gets back in',
    crossed && completed,
    `crossed=${crossed}, cleared by 8 m=${completed}`,
  );
  check(
    'an overtake never parks on the centre line',
    straddleSeconds <= 2.5,
    `${straddleSeconds.toFixed(1)} s of 30 straddling the centre with a car ahead`,
  );
  check(
    'an overtake keeps its clearance and one indicator story',
    clearanceWhileLevel > 0 && indicatorChanges <= 8,
    `clearance ${
      Number.isFinite(clearanceWhileLevel) ? clearanceWhileLevel.toFixed(2) + ' m' : 'never level'
    }, ${indicatorChanges} indicator changes`,
  );
  // THE KICKDOWN, ON A PASS THAT WAS REALLY DRIVEN. A hurried driver capped at 20 m/s,
  // the same 12 m/s car ahead: once it is out past the crown with the pass live, it is
  // to be asking for more than its cap with the throttle open, because the crossing
  // was sized on that kicked-down pace (`PASS_KICKDOWN_SHARE`).
  //
  // This used to be a sensor-only frame — a freshly engaged pilot placed in the
  // oncoming lane and read after eight steps — which no longer describes a pass: a
  // driver is barred from passing for `WAKE_CAUTION_S` after it engages, and a car
  // out there with no crossing behind it is priced home behind the leader.
  const kickdownCap = 20;
  const hurried = await driveOvertake('hurried', kickdownCap);
  check(
    'a clear committed overtake keeps its kickdown allowance',
    hurried.crossed && hurried.completed && hurried.kickdownSteps > 0,
    `crossed=${hurried.crossed}, cleared=${hurried.completed}, ${hurried.kickdownSteps} of ${hurried.committedSteps} committed step(s) over the ${kickdownCap} m/s cap on throttle, peak target ${hurried.peakCommittedTarget.toFixed(2)} m/s`,
  );
}

/**
 * PASSING ON THE RIGHT WHEN THE OPPOSING LANE IS TAKEN: the frantic driver on a
 * narrow, straight, paved stretch behind a slower car, with a car always coming the
 * other way. It must neither cross the crown nor sit behind for good: out onto the
 * verge with the left wheels near the asphalt edge, past at a modest advantage,
 * clear of the passed car's flank, and back into its lane.
 */
async function checkShoulderPass(): Promise<void> {
  const leadAhead = 40;
  const leadCap = 14;
  const seconds = 30;
  const road = new Road(42);
  let startS = -1;
  for (let s = START_S; s < START_S + 60_000 && startS < 0; s += 50) {
    let fits = true;
    for (let x = s - 40; x <= s + 900; x += 10) {
      if (road.lanesPerSideAt(x) > 1 || Math.abs(road.curvatureAt(x)) > 0.004) {
        fits = false;
        break;
      }
    }
    if (fits) startS = s;
  }
  if (startS < 0) {
    check('frantic passes on the right with the opposing lane taken', false, 'no straight narrow stretch on seed 42');
    return;
  }
  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, startS - 60, startS + 1_200);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const lane = -ROAD_HALF_WIDTH / 2;
  const chaserState = { ...carState(road, startS, lane), id: 'shoulder-chaser' };
  const leadState = { ...carState(road, startS + leadAhead, lane), id: 'shoulder-lead' };
  world.state.cars[chaserState.id] = chaserState;
  world.state.cars[leadState.id] = leadState;
  const chaser = new Vehicle(physics, world, chaserState, scene, origin);
  const lead = new Vehicle(physics, world, leadState, scene, origin);
  const chaserPilot = new Autopilot(road, physics);
  const leadPilot = new Autopilot(road, physics);
  const chaserInput = emptyInput();
  const leadInput = emptyInput();
  chaserInput.handbrake = true;
  leadInput.handbrake = true;
  for (let i = 0; i < 180; i++) {
    chaser.fixedUpdate(FIXED_DT, chaserInput);
    lead.fixedUpdate(FIXED_DT, leadInput);
    physics.step();
    chaser.postStep();
    lead.postStep();
  }
  chaserInput.handbrake = false;
  leadInput.handbrake = false;
  const chaserPosition = new THREE.Vector3();
  const leadPosition = new THREE.Vector3();
  const halfWidth = lead.modelMeasure.halfExtents[0];
  // The traffic field as the coordinator gives it: the real lead car, plus a car that
  // is always 45 m up the opposing lane and coming at 20 m/s, so the crown never opens.
  chaserPilot.setTrafficField({
    forEachNear(ahead, behind, visit) {
      const c = road.project(chaserPosition.x, chaserPosition.z);
      const l = road.project(leadPosition.x, leadPosition.z);
      const along = l.s - c.s;
      const s = Math.sign(along) * Math.max(0, Math.abs(along) - 2.3);
      if (s <= ahead && s >= -behind) {
        visit({ s, lateral: l.lateral, speed: lead.chassis.linvel().z * Math.cos(road.sampleAt(l.s).heading) + lead.chassis.linvel().x * Math.sin(road.sampleAt(l.s).heading), halfWidth, halfLength: 2.3 });
      }
      if (45 <= ahead) visit({ s: 45, lateral: -lane, speed: -20, halfWidth: 0.9, halfLength: 2.3 });
    },
  });
  chaserPilot.setMode('frantic');
  leadPilot.setMode('sleeper');
  chaserPilot.setEngaged(true);
  leadPilot.setEngaged(true);
  let crossed = false;
  let completed = false;
  let wentOut = false;
  let maxOverhang = 0;
  let clearanceWhileLevel = Infinity;
  let fastestAdvantage = -Infinity;
  let offroad = false;
  let backHome = false;
  let leadCruise = 0;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    chaser.absoluteTranslation(chaserPosition);
    lead.absoluteTranslation(leadPosition);
    leadPilot.setSpeedCap(leadCap);
    chaserPilot.drive(FIXED_DT, chaser, chaserInput, 0, 0);
    leadPilot.drive(FIXED_DT, lead, leadInput, 0, 0);
    chaser.fixedUpdate(FIXED_DT, chaserInput);
    lead.fixedUpdate(FIXED_DT, leadInput);
    physics.step();
    chaser.postStep();
    lead.postStep();
    chaser.absoluteTranslation(chaserPosition);
    lead.absoluteTranslation(leadPosition);
    const c = road.project(chaserPosition.x, chaserPosition.z);
    const l = road.project(leadPosition.x, leadPosition.z);
    const along = l.s - c.s;
    if (along > 12) leadCruise = speed(lead);
    const edge = road.halfWidthAt(c.s);
    if (c.lateral > 0) crossed = true;
    if (process.env.TRACE_SHOULDER && i % 15 === 0) {
      console.log(`    t=${(i * FIXED_DT).toFixed(1)} lat=${c.lateral.toFixed(2)} along=${along.toFixed(1)} v=${speed(chaser).toFixed(1)} lead=${speed(lead).toFixed(1)} ${chaserPilot.activity} line=${chaserPilot.commandedLine.toFixed(2)} ` + (() => { const a = chaserPilot as unknown as Record<string, unknown>; return `grant=${a.shoulderPassAllowed} on=${a.shoulderPassing} urge=${a.passUrgeValue} det=${a.detouring} lbd=${(a.corridorLaneBlockDistance as number).toFixed(1)} lbs=${(a.corridorLaneBlockSpeed as number).toFixed(1)} ldr=${(a.shoulderLeaderGap as number).toFixed(1)}`; })());
    }
    if (chaserPilot.activity === 'offroad') offroad = true;
    // The inner (left) tyre's outer edge past the asphalt edge: 0 while it is on it.
    const innerTyre = -c.lateral - WHEEL_HALF_TRACK_M;
    maxOverhang = Math.max(maxOverhang, innerTyre - edge);
    if (-c.lateral + halfWidth > edge + 0.3) wentOut = true;
    if (Math.abs(along) < 4.6) {
      clearanceWhileLevel = Math.min(clearanceWhileLevel, Math.abs(c.lateral - l.lateral) - 2 * halfWidth);
      // Against the passed car's cruise, not its momentary speed: a driver with a car
      // coming up on its verge lifts, and that is not the passer going faster.
      fastestAdvantage = Math.max(fastestAdvantage, speed(chaser) - leadCruise);
    }
    if (along < -8) completed = true;
    if (completed && Math.abs(c.lateral - lane) < 0.5) backHome = true;
  }
  check(
    'frantic passes on the right with the opposing lane taken',
    wentOut && completed && backHome && !crossed,
    `out on the verge=${wentOut}, cleared by 8 m=${completed}, back in lane=${backHome}, crossed the crown=${crossed}`,
  );
  check(
    'a pass on the right keeps the left wheels at the edge',
    maxOverhang <= 0.35 && !offroad,
    `left tyre at most ${maxOverhang.toFixed(2)} m past the asphalt, road departure=${offroad}`,
  );
  check(
    'a pass on the right keeps its distance and its pace',
    clearanceWhileLevel >= 0.3 && fastestAdvantage <= 6 + 1.5,
    `${Number.isFinite(clearanceWhileLevel) ? clearanceWhileLevel.toFixed(2) + ' m' : 'never level'} between bodies while level, ` +
      `${fastestAdvantage.toFixed(1)} m/s over the passed car's cruise`,
  );
  chaser.dispose();
  lead.dispose();
  physics.world.free();
}

/**
 * GETTING PAST A SLOWER CAR WITHOUT CROSSING THE CROWN, on a stretch with two lanes
 * each way.
 *
 * The same geometry as the overtake above, moved to a widened section. Both cars start
 * in the outer lane: the slow one belongs there and stays, and the fast one belongs in
 * the lane beside the crown (`INNER_LANE_PACE_MPS`), so it should get there, go by,
 * and never touch the oncoming carriageway or ask for the oncoming-clearance gate. On
 * the narrow road none of this is available, which is what the check above measures.
 */
async function checkLanePass(): Promise<void> {
  const leadAhead = 45;
  const leadCap = 12;
  const seconds = 30;
  const road = new Road(42);
  let wideS = -1;
  for (let s = 5_000; s < 400_000 && wideS < 0; s += 50) {
    // Room for the whole manoeuvre inside the open section, not across its taper.
    if (road.lanesPerSideAt(s) === 2 && road.lanesPerSideAt(s + 900) === 2) wideS = s + 100;
  }
  if (wideS < 0) throw new Error('no widened stretch on this seed');

  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, wideS - 60, wideS + 1_200);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const inner = road.laneCentreAt(wideS, 0);
  const outer = road.laneCentreAt(wideS, 1);
  const chaserState = { ...carState(road, wideS, outer), id: 'lane-chaser' };
  const leadState = { ...carState(road, wideS + leadAhead, outer), id: 'lane-lead' };
  world.state.cars[chaserState.id] = chaserState;
  world.state.cars[leadState.id] = leadState;
  const chaser = new Vehicle(physics, world, chaserState, scene, origin);
  const lead = new Vehicle(physics, world, leadState, scene, origin);
  const chaserPilot = new Autopilot(road, physics);
  const leadPilot = new Autopilot(road, physics);
  const chaserInput = emptyInput();
  const leadInput = emptyInput();
  chaserInput.handbrake = true;
  leadInput.handbrake = true;
  for (let i = 0; i < 180; i++) {
    chaser.fixedUpdate(FIXED_DT, chaserInput);
    lead.fixedUpdate(FIXED_DT, leadInput);
    physics.step();
    chaser.postStep();
    lead.postStep();
  }
  chaserInput.handbrake = false;
  leadInput.handbrake = false;
  chaserPilot.setMode('frantic');
  leadPilot.setMode('sleeper');
  chaserPilot.setEngaged(true);
  leadPilot.setEngaged(true);

  let reachedInnerLane = false;
  let crossedCrown = false;
  let completed = false;
  let worstCrownSide = 0;
  let clearanceWhileLevel = Infinity;
  const chaserPosition = new THREE.Vector3();
  const leadPosition = new THREE.Vector3();
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    leadPilot.setSpeedCap(leadCap);
    chaserPilot.drive(FIXED_DT, chaser, chaserInput, 0, 0);
    leadPilot.drive(FIXED_DT, lead, leadInput, 0, 0);
    chaser.fixedUpdate(FIXED_DT, chaserInput);
    lead.fixedUpdate(FIXED_DT, leadInput);
    physics.step();
    chaser.postStep();
    lead.postStep();
    chaser.absoluteTranslation(chaserPosition);
    lead.absoluteTranslation(leadPosition);
    const chaserRoad = road.project(chaserPosition.x, chaserPosition.z);
    const leadRoad = road.project(leadPosition.x, leadPosition.z);
    const along = leadRoad.s - chaserRoad.s;
    // Lane centres are negative here; the inner lane is the less negative of the two.
    if (chaserRoad.lateral >= inner - 0.6) reachedInnerLane = true;
    if (chaserRoad.lateral > 0) crossedCrown = true;
    worstCrownSide = Math.max(worstCrownSide, chaserRoad.lateral);
    if (Math.abs(along) < 4.6) {
      clearanceWhileLevel = Math.min(
        clearanceWhileLevel,
        Math.abs(chaserRoad.lateral - leadRoad.lateral) - PLANNED_CLEARANCE_M,
      );
    }
    if (along < -8) completed = true;
  }
  check(
    'a slower car is passed in the next lane, not the oncoming one',
    reachedInnerLane && completed && !crossedCrown,
    `inner lane=${reachedInnerLane}, cleared by 8 m=${completed}, worst lateral toward the crown ${worstCrownSide.toFixed(2)} m`,
  );
  check(
    'the lane pass keeps its clearance',
    clearanceWhileLevel > 0,
    Number.isFinite(clearanceWhileLevel) ? `${clearanceWhileLevel.toFixed(2)} m` : 'never level',
  );
  chaser.dispose();
  lead.dispose();
  physics.world.free();
}

/**
 * A CAR ALONGSIDE IS NOT A GAP.
 *
 * The forward lane probes start four metres ahead of the bumper, so a car level
 * with the door is invisible to every sensor the planner had. Seen in play on a
 * widened stretch: the driver indicated, moved into the next lane, and drove into
 * the car that was already in it — after which the two travelled locked together.
 *
 * The scenario reproduces exactly that geometry: a slow leader in the driver's own
 * lane, giving it every reason to move out, and a second car holding the next lane
 * beside it. Both cars keep to the outer lane by character, so the neighbour has the
 * mirror-image reason to move into the chaser — and neither may.
 */
async function checkSideBySide(): Promise<void> {
  const seconds = 25;
  const road = new Road(42);
  let wideS = -1;
  for (let s = 5_000; s < 400_000 && wideS < 0; s += 50) {
    if (road.lanesPerSideAt(s) === 2 && road.lanesPerSideAt(s + 900) === 2) wideS = s + 100;
  }
  if (wideS < 0) throw new Error('no widened stretch on this seed');

  const physics = await PhysicsWorld.create();
  addRoadCollider(physics, road, wideS - 60, wideS + 1_200);
  const world = new GameWorld(newWorldState(42));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const inner = road.laneCentreAt(wideS, 0);
  const outer = road.laneCentreAt(wideS, 1);
  const chaserState = { ...carState(road, wideS, outer), id: 'side-chaser' };
  const leadState = { ...carState(road, wideS + 32, outer), id: 'side-lead' };
  // Level with the chaser's door, in the lane it wants.
  const neighbourState = { ...carState(road, wideS + 1, inner), id: 'side-neighbour' };
  for (const state of [chaserState, leadState, neighbourState]) world.state.cars[state.id] = state;
  const chaser = new Vehicle(physics, world, chaserState, scene, origin);
  const lead = new Vehicle(physics, world, leadState, scene, origin);
  const neighbour = new Vehicle(physics, world, neighbourState, scene, origin);
  const pilots = [
    new Autopilot(road, physics),
    new Autopilot(road, physics),
    new Autopilot(road, physics),
  ] as const;
  const inputs = [emptyInput(), emptyInput(), emptyInput()] as const;
  const cars = [chaser, lead, neighbour] as const;
  for (const input of inputs) input.handbrake = true;
  for (let i = 0; i < 180; i++) {
    for (let k = 0; k < cars.length; k++) cars[k]!.fixedUpdate(FIXED_DT, inputs[k]!);
    physics.step();
    for (const car of cars) car.postStep();
  }
  for (const input of inputs) input.handbrake = false;
  pilots[0].setMode('frantic');
  pilots[1].setMode('sleeper');
  pilots[2].setMode('sleeper');
  for (const pilot of pilots) {
    pilot.setEngaged(true);
  }

  let impacts = 0;
  let closest = Infinity;
  let closestLateralGap = Infinity;
  let worstMoment = '';
  const chaserPosition = new THREE.Vector3();
  const neighbourPosition = new THREE.Vector3();
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    pilots[1].setSpeedCap(10);
    pilots[2].setSpeedCap(11);
    for (let k = 0; k < cars.length; k++) {
      pilots[k]!.drive(FIXED_DT, cars[k]!, inputs[k]!, 0, 0);
      cars[k]!.fixedUpdate(FIXED_DT, inputs[k]!);
    }
    physics.step();
    for (const car of cars) car.postStep();
    for (const car of cars) {
      const impact = car.lastImpact;
      if (impact && impact.severityMps > 1.2) impacts++;
    }
    chaser.absoluteTranslation(chaserPosition);
    neighbour.absoluteTranslation(neighbourPosition);
    const chaserRoad = road.project(chaserPosition.x, chaserPosition.z);
    const neighbourRoad = road.project(neighbourPosition.x, neighbourPosition.z);
    closest = Math.min(closest, chaserPosition.distanceTo(neighbourPosition));
    // Only while they are actually level: once one is clear of the other, the lane
    // is legitimately free and the gap is meaningless.
    if (Math.abs(chaserRoad.s - neighbourRoad.s) < 5) {
      const gap = Math.abs(chaserRoad.lateral - neighbourRoad.lateral);
      if (gap < closestLateralGap) {
        closestLateralGap = gap;
        worstMoment =
          `t=${(i * FIXED_DT).toFixed(1)}s chaser lat ${chaserRoad.lateral.toFixed(2)} ` +
          `line ${(pilots[0] as unknown as { appliedLateral: number }).appliedLateral.toFixed(2)} ` +
          `act ${pilots[0].activity}; neighbour lat ${neighbourRoad.lateral.toFixed(2)} ` +
          `line ${(pilots[2] as unknown as { appliedLateral: number }).appliedLateral.toFixed(2)} ` +
          `act ${pilots[2].activity}; lanes ${road.lanesPerSideAt(chaserRoad.s)}`;
      }
    }
  }
  check(
    'a car in the next lane is not driven into',
    impacts === 0 && closest > 2.2,
    `${impacts} impact(s), closest ${closest.toFixed(2)} m centre to centre`,
  );
  check(
    'the driver keeps a body width while they are level',
    closestLateralGap > 2.1,
    Number.isFinite(closestLateralGap)
      ? `${closestLateralGap.toFixed(2)} m of lateral gap while level [${worstMoment}]`
      : 'never level',
  );
  for (const car of cars) car.dispose();
  physics.world.free();
}

async function checkPedestrianObstacle(): Promise<void> {
  const rig = await makeRig();
  rig.autopilot.setEngaged(true);
  const pedestrianS = START_S + 120;
  const pedestrianLateral = rig.road.laneCentreAt(pedestrianS, 0);
  const pedestrian = rig.road.offsetPoint(pedestrianS, pedestrianLateral);
  let hint = START_S;
  let sawObstacle = false;
  let passed = false;
  let closestLateral = Infinity;
  let closestDistance = Infinity;

  for (let i = 0; i < Math.ceil(45 / FIXED_DT); i++) {
    rig.autopilot.setPedestrianObstacle(pedestrian.x, pedestrian.z, 0, 0);
    step(rig);
    const position = rig.vehicle.absoluteTranslation({ x: 0, y: 0, z: 0 });
    const projection = rig.road.project(position.x, position.z, hint);
    hint = projection.s;
    sawObstacle ||= rig.autopilot.obstacleGap < Infinity;
    const distance = Math.hypot(position.x - pedestrian.x, position.z - pedestrian.z);
    closestDistance = Math.min(closestDistance, distance);
    if (Math.abs(projection.s - pedestrianS) <= 3) {
      closestLateral = Math.min(
        closestLateral,
        Math.abs(projection.lateral - pedestrianLateral),
      );
    }
    if (projection.s > pedestrianS + 12) {
      passed = true;
      break;
    }
  }

  check(
    'traffic sees and clears a stationary pedestrian',
    sawObstacle && passed && closestDistance >= 1.25 && closestLateral >= 1.25,
    `seen/passed=${sawObstacle}/${passed}, centre clearance ${closestDistance.toFixed(2)} m, lateral ${closestLateral.toFixed(2)} m`,
  );

  rig.autopilot.clearPedestrianObstacle();
  step(rig);
  check(
    'seated player is removed as a separate obstacle',
    rig.autopilot.obstacleGap === Infinity,
    `remaining gap ${rig.autopilot.obstacleGap}`,
  );
  rig.vehicle.dispose();
  rig.physics.world.free();
}

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID, SLOW_YAW_MODEL_ID]);
  console.log(`autopilot bench: real Road surface collider, ${carModel(MODEL_ID).label}, fixed 60 Hz`);
  checkHandover();
  await checkAutomaticLights();
  await checkPassingSafety();
  if (typeof process !== 'undefined' && process.argv.includes('--passes')) {
    await checkOvertake();
    await checkShoulderPass();
    await checkLanePass();
    await checkSideBySide();
    if (failures) process.exitCode = 1;
    return;
  }
  if (typeof process !== 'undefined' && process.argv.includes('--weather')) {
    await checkCrosswind();
    await checkShelter();
    if (failures) process.exitCode = 1;
    return;
  }
  if (typeof process !== 'undefined' && process.argv.includes('--traffic-behavior')) {
    await checkOvertake();
    await checkPedestrianObstacle();
    if (failures && typeof process !== 'undefined') process.exitCode = 1;
    return;
  }
  const sleeper = await measureMode('sleeper');
  const frantic = await measureMode('frantic');
  for (const [mode, result] of [['sleeper', sleeper], ['frantic', frantic]] as const) {
    const config = MODES[mode];
    const cornerLimit = Math.sqrt(config.lateralAccel * result.tightRadius);
    // A TYRE'S WIDTH, not zero, and not the 1.2 m verge the controller is allowed to
    // use. Keep-right puts the driver beside the road edge instead of beside another
    // lane, so the lane-keeping error that used to land on asphalt now lands near the
    // paint: measured on this route, sleeper keeps every tyre inside it and frantic —
    // which spends a deliberate half-metre of wander at 130 km/h — touches the verge
    // with 2.5 cm of one contact patch on the worst bend. A car actually driving the
    // verge is an order of magnitude past this.
    check(`${mode}: stays on asphalt`, result.maxOverhang <= carModel(MODEL_ID).factory.tyreWidth, `mean/RMS/worst lateral ${result.meanLateral.toFixed(2)}/${result.rmsLateral.toFixed(2)}/${result.maxLateral.toFixed(2)} m, worst tyre past the asphalt ${result.maxOverhang.toFixed(3)} m`);
    check(`${mode}: does not oscillate across lane`, result.signChangesPerKm < 18, `${result.signChangesPerKm.toFixed(1)} sign changes/km (18 bound: a correction every 56 m)`);
    checkLineHold(mode, result);
    // The route loop breaks ON reaching the target, so the last sample lands a metre
    // or two short of it by construction.
    check(`${mode}: makes monotonic road progress`, result.monotonic && result.progress >= ROUTE_METRES - 5, `${result.progress.toFixed(0)} m, monotonic=${result.monotonic}`);
    // A racing driver has no cruise of its own (`AUTOPILOT_MODES.frantic.cruiseMps` is
    // out of every car's reach), so its pace is judged against the fastest the car it
    // is driving actually went on this route.
    const pace = config.racingLine ? result.peakSpeed : config.cruiseMps;
    check(`${mode}: holds useful cruise speed`, result.meanSpeed >= pace * 0.55 && result.meanSpeed <= config.cruiseMps * 1.15, `${result.meanSpeed.toFixed(2)} m/s vs ${pace.toFixed(0)} m/s ${config.racingLine ? 'car peak' : 'target'}`);
    check(`${mode}: slows for tightest corner`, result.tightSpeed <= cornerLimit + 3, `radius ${result.tightRadius.toFixed(1)} m, ${result.tightSpeed.toFixed(2)} m/s vs ${cornerLimit.toFixed(2)} m/s limit`);
  }
  check('frantic is materially faster than sleeper', frantic.meanSpeed >= sleeper.meanSpeed + 3, `${frantic.meanSpeed.toFixed(2)} vs ${sleeper.meanSpeed.toFixed(2)} m/s`);
  for (const mode of ['sleeper', 'hurried'] as const) {
    checkLineHold(`${carModel(SLOW_YAW_MODEL_ID).label} ${mode}`, await measureMode(mode, SLOW_YAW_MODEL_ID));
  }
  await checkCrosswind();
  await checkShelter();
  const looseSleeper = await measureLooseSurface('sleeper');
  const looseFrantic = await measureLooseSurface('frantic');
  for (const [mode, result] of [
    ['sleeper', looseSleeper],
    ['frantic', looseFrantic],
  ] as const) {
    const config = MODES[mode];
    // Against the asphalt pace this driver actually has: its cruise, or for a racing
    // driver the car's own peak on the asphalt route above — and a racing driver spends
    // more of what gravel leaves (measured: a GAZ-21 peaks at 96 km/h on this district
    // against 126 on asphalt), so its ceiling is 0.8 of that peak, not 0.75.
    const asphaltPace = config.racingLine ? (mode === 'frantic' ? frantic : sleeper).peakSpeed : config.cruiseMps;
    const looseCeiling = config.racingLine ? 0.8 : 0.75;
    check(
      `${mode}: traverses the real gravel district`,
      result.allGravel &&
        result.monotonic &&
        result.progress >= LOOSE_ROUTE_METRES - 5 &&
        result.maxLateral <= ROAD_HALF_WIDTH,
      `${result.progress.toFixed(0)} m, worst lateral ${result.maxLateral.toFixed(2)} m, monotonic=${result.monotonic}`,
    );
    check(
      `${mode}: respects loose-surface pace`,
      result.peakSpeed <= asphaltPace * looseCeiling &&
        result.meanSpeed >= asphaltPace * 0.3,
      `mean/peak ${(result.meanSpeed * 3.6).toFixed(0)}/${(result.peakSpeed * 3.6).toFixed(0)} km/h vs ${(asphaltPace * 3.6).toFixed(0)} km/h asphalt ${config.racingLine ? 'peak' : 'cruise'}`,
    );
  }
  // ON PEAK, NOT ON MEAN.
  //
  // This district climbs at up to 11%, and on those grades a catalogue saloon is
  // flat out at about 40 km/h whoever is driving: the mean over the route is then a
  // measure of the engine, not of the driver, and it converged as soon as the
  // careful driver stopped crawling on the flat parts (33 against 42 km/h, from 24
  // against 44). Where the car is NOT the limit the two are still completely
  // different cars, which is what this is asserting.
  check(
    'driver styles remain distinct on gravel',
    looseFrantic.peakSpeed >= looseSleeper.peakSpeed + 3,
    `peak ${(looseFrantic.peakSpeed * 3.6).toFixed(0)} vs ${(looseSleeper.peakSpeed * 3.6).toFixed(0)} km/h`,
  );
  await checkWedgedOffRoad();
  await checkOvertake();
  await checkShoulderPass();
  await checkLanePass();
  await checkSideBySide();
  await checkPedestrianObstacle();
  if (failures && typeof process !== 'undefined') process.exitCode = 1;
}

void run();
