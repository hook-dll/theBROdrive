/**
 * tools/surface-feel.ts
 *
 * What the CAR feels, as opposed to what a dragged point feels.
 *
 * `ride-bench.ts` and `desert-ride.ts` measure the ground: they drag a wheel over a
 * profile and report the vertical velocity step at each triangle edge. That is the
 * right measure of a SURFACE, and it is blind to three things that decide whether a
 * stretch of ground is pleasant or punishing to drive on:
 *
 *   - the suspension, which filters the profile before the driver feels any of it;
 *   - the tyre model, which turns a load fluctuation into lost grip;
 *   - traction control, which turns lost grip into a torque cut.
 *
 * So this drives a REAL `Vehicle` at the simulation's own fixed timestep over the
 * REAL road chunks (`RoadMeshProvider`, the same rows, event rows and collider slabs
 * the game streams) and the REAL desert chunk colliders, with one controller, in the
 * right lane, and reports what the seat reports:
 *
 *   heave      RMS vertical acceleration of the chassis, in g. Comfort.
 *   floatg/sharpg  the same split at ~2 Hz: body motion against jolts and buzz.
 *   boatmm/pitch°  body heave over the road centreline and body pitch, 0.3-2.5 Hz,
 *              RMS: the slow rise and fall that reads as floating.
 *   jolt99/maxg    99th-percentile and worst vertical acceleration.
 *   load99/loadmx  most-loaded wheel over its static load: the spikes a hit makes.
 *   bump99/bumpmx  suspension compression speed, m/s (the audio bump channel).
 *   hit/km     compressions over 0.5 m/s: discrete things the wheels struck.
 *   contact    mean fraction of wheels touching the ground. Grip stability.
 *   speed      mean speed held, against the speed asked for.
 *
 * The road rows are the home stretch (chunks 120-126), then one six-chunk stretch of
 * each district surface — straight-ish, narrow, the first one this seed has.
 *
 *   bun tools/surface-feel.ts [speedKmh]     NO_DESERT=1 / NO_SPRINT=1 skip those runs
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { preloadCarModels } from '../src/render/carmodel';
import { benchCarState } from './benchcar';
import { Vehicle } from '../src/vehicle/vehicle';
import { type ChunkContext, type ChunkContent } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { WorldOrigin } from '../src/world/origin';
import { roadConditionAt } from '../src/world/gradient';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { Terrain } from '../src/world/terrain';
import { TerrainMeshProvider } from '../src/world/terrainmesh';
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
// Every catalogue model is an imported body now, so the bench loads real FBX files
// off disk rather than building its car in code.
installAssetShim();
// Building a `Vehicle` paints its boot's sticker decals, which needs a 2D canvas
// context to exist before any rig can be constructed headless.
installDocumentShim();

const SEED = 42;
const MODEL_ID = 'sv_vaz2105r';
/** Chunk span driven. Matches desert-ride.ts so the two benches describe one place. */
const FROM_CHUNK = 120;
const TO_CHUNK = 126;
/** Lateral offset of the desert run, metres: outside the corridor, inside the detail field. */
const DESERT_LATERAL = 34;
/**
 * Lateral of the road runs: the right lane's centre, where a driver and the traffic
 * actually are, so the wheels run down the worn wheel paths (0.85 and 2.45 m) rather
 * than astride the crown.
 */
const LANE_LATERAL = 1.65;
/** Metres ahead the steering controller aims. */
const LOOKAHEAD = 8;
/** Settling steps before measurement starts. */
const SETTLE_STEPS = 240;
/** Chunks in a per-surface road run. */
const SURFACE_RUN_CHUNKS = 6;

const speedKmh = Number(process.argv[2] ?? 60);
const targetSpeed = speedKmh / 3.6;

/** Where a run happens: a chunk range of the real road, and the metres driven inside it. */
interface Span {
  label: string;
  fromChunk: number;
  toChunk: number;
  startS: number;
  endS: number;
  /** Mean road decay over the driven metres. */
  decay: number;
}

function spanOf(label: string, fromChunk: number, toChunk: number): Span {
  const startS = fromChunk * CHUNK_LENGTH + 60;
  const endS = toChunk * CHUNK_LENGTH - 60;
  let decay = 0;
  let n = 0;
  for (let s = startS; s <= endS; s += 10, n++) decay += roadConditionAt(SEED, s).decay;
  return { label, fromChunk, toChunk, startS, endS, decay: decay / n };
}

/** Tightest corner a per-surface run may contain, 1/m: the bench measures ride, not cornering. */
const SURFACE_RUN_MAX_CURVATURE = 1 / 400;

/**
 * The first stretch of this seed's road that is `surface` for SURFACE_RUN_CHUNKS whole
 * chunks — the real district, built by the real provider, rather than a material forced
 * over somebody else's geometry. Narrow and gentle, so the wheel paths are the
 * catalogue's and the controller is not what is being measured.
 */
function surfaceSpan(road: Road, surface: SurfaceType, label: string): Span | null {
  let run = 0;
  for (let chunk = 2; chunk < 20_000; chunk++) {
    let pure = true;
    for (let s = chunk * CHUNK_LENGTH; s <= (chunk + 1) * CHUNK_LENGTH; s += 20) {
      if (
        roadConditionAt(SEED, s).surface !== surface ||
        road.halfWidthAt(s) > ROAD_HALF_WIDTH + 0.05 ||
        Math.abs(road.curvatureAt(s)) > SURFACE_RUN_MAX_CURVATURE
      ) {
        pure = false;
        break;
      }
    }
    run = pure ? run + 1 : 0;
    if (run === SURFACE_RUN_CHUNKS) return spanOf(label, chunk - run + 1, chunk + 1);
  }
  return null;
}

/**
 * The real road, built by the real provider: the same rows, columns, event rows and
 * collider slabs the game streams, so the bench drives exactly what a player does.
 */
function addRoadColliders(physics: PhysicsWorld, road: Road, span: Span): void {
  const provider = new RoadMeshProvider(SEED);
  for (let chunkIndex = span.fromChunk - 1; chunkIndex <= span.toChunk; chunkIndex++) {
    const ctx = {
      chunkIndex,
      sStart: chunkIndex * CHUNK_LENGTH,
      sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
      road,
      physics,
      hasPhysics: true,
      originX: 0,
      originZ: 0,
    } as unknown as ChunkContext;
    const content = provider.build(ctx);
    if (!content) continue;
    for (const collider of content.colliders) collider.setEnabled(true);
  }
}

/** The real desert, built by the real provider straight into the real physics world. */
function addDesertColliders(physics: PhysicsWorld, road: Road, terrain: Terrain, span: Span): ChunkContent[] {
  const provider = new TerrainMeshProvider(new RoadDistance(road));
  const built: ChunkContent[] = [];
  for (let chunkIndex = span.fromChunk - 1; chunkIndex <= span.toChunk; chunkIndex++) {
    const ctx = {
      chunkIndex,
      sStart: chunkIndex * CHUNK_LENGTH,
      sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
      road,
      terrain,
      physics,
      hasPhysics: true,
      originX: 0,
      originZ: 0,
    } as unknown as ChunkContext;
    const content = provider.build(ctx);
    if (!content) continue;
    for (const collider of content.colliders) collider.setEnabled(true);
    built.push(content);
  }
  return built;
}

/**
 * A perfectly flat asphalt plane at the route's own elevation. The control: any
 * behaviour that survives here belongs to the car, not to the ground.
 */
function addFlatCollider(physics: PhysicsWorld, road: Road, groundY: number, span: Span): void {
  const p = road.sampleAt(span.startS);
  const half = 3000;
  const vertices = new Float32Array([
    p.x - half, groundY, p.z - half,
    p.x + half, groundY, p.z - half,
    p.x + half, groundY, p.z + half,
    p.x - half, groundY, p.z + half,
  ]);
  physics.addStaticTrimesh(vertices, new Uint32Array([0, 1, 2, 0, 2, 3]), SurfaceType.Asphalt);
}

interface Rig {
  physics: PhysicsWorld;
  vehicle: Vehicle;
  road: Road;
  input: InputFrame;
  lateral: number;
  span: Span;
  /** Mean absolute lateral offset held, so a run that slid onto the road is visible. */
  lateralSum: number;
  lateralN: number;
}

type Ground = 'road' | 'desert' | 'flat';

async function makeRig(lateral: number, ground: Ground, span: Span): Promise<Rig> {
  const road = new Road(SEED);
  const terrain = new Terrain(SEED, road);
  const physics = await PhysicsWorld.create();
  const start = road.sampleAt(span.startS);
  const spawnGroundY = terrain.heightAt(start.x, start.z, span.startS);
  if (ground === 'flat') addFlatCollider(physics, road, spawnGroundY, span);
  else {
    // The desert rig gets the road as well. Without it the corridor the terrain fan
    // deliberately leaves empty (CORRIDOR_INNER, filled by the road mesh in the game)
    // is a hole, and a car that wanders into it falls out of the world.
    addRoadColliders(physics, road, span);
    if (ground === 'desert') addDesertColliders(physics, road, terrain, span);
  }
  const world = new GameWorld(newWorldState(SEED));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const spawn = { x: 0, y: 0, z: 0 };
  road.offsetPoint(span.startS, lateral, spawn);
  const state = benchCarState(MODEL_ID, {
    id: 'surface-feel',
    x: spawn.x,
    y: (ground === 'flat' ? spawnGroundY : terrain.heightAt(spawn.x, spawn.z, span.startS)) + 2,
    z: spawn.z,
    heading: road.sampleAt(span.startS).heading,
  });
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const input = emptyInput();
  for (let i = 0; i < SETTLE_STEPS; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    physics.step();
    vehicle.postStep();
  }
  return { physics, vehicle, road, input, lateral, span, lateralSum: 0, lateralN: 0 };
}

/** Arclength of the car's current position, walked forward from the last one. */
function advanceS(road: Road, s: number, x: number, z: number): number {
  let best = s;
  let bestD = Infinity;
  const point = { x: 0, y: 0, z: 0 };
  for (let probe = s - 6; probe <= s + 40; probe += 0.5) {
    road.offsetPoint(probe, 0, point);
    const d = (point.x - x) ** 2 + (point.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = probe;
    }
  }
  return best;
}

interface Result {
  label: string;
  metres: number;
  meanSpeed: number;
  heaveG: number;
  /**
   * RMS of the vertical acceleration below ~2 Hz (a 0.4 s centred mean), g, and what
   * is left above it: the jolts and the buzz.
   */
  floatG: number;
  sharpG: number;
  /**
   * THE BOAT: body heave relative to the road's own centreline, band-passed to
   * 0.3-2.5 Hz (a 0.4 s mean minus a 3 s mean), RMS in mm — the slow rise and fall a
   * car does on its springs, with the road's grade taken out. And the same band of
   * body pitch, RMS in degrees.
   */
  floatMm: number;
  pitchDeg: number;
  joltG: number;
  /** Worst single step of vertical acceleration, g. */
  maxG: number;
  /** Wheel load over its static load: 99th percentile and worst, of the most-loaded wheel. */
  loadP99: number;
  loadMax: number;
  /** Suspension compression speed: 99th percentile and worst, m/s (audio's bump channel). */
  bumpP99: number;
  bumpMax: number;
  /** Compression hits over BUMP_HIT_MPS, per km: discrete jolts the springs took. */
  hitsPerKm: number;
  contact: number;
  heldLateral: number;
  maxSpeed: number;
}

/**
 * A compression faster than this, m/s, counts as one discrete hit (see `hitsPerKm`).
 * Above the continuous wash a wavy road gives the springs (its p99 is 0.4-0.7 m/s at
 * 60 km/h), so what it counts is a thing the wheel HIT rather than rode over.
 */
const BUMP_HIT_MPS = 0.5;
/** Steps a discrete hit must be clear of the last one to count again. */
const BUMP_HIT_GAP_STEPS = 12;
/** Centred-mean half window, steps, that splits the float band from the jolts. */
const FLOAT_HALF_WINDOW = 12;
/** Centred-mean half window, steps, of the slow trend the float band is measured against. */
const TREND_HALF_WINDOW = 90;

/**
 * Drives the route and measures. One controller for both surfaces: aim at a point
 * LOOKAHEAD metres up the same lateral line, and hold the target speed on a PI
 * throttle. Nothing here reads the surface, so a difference in the numbers is a
 * difference in the ground and in what the car does about it.
 */
function drive(rig: Rig, label: string): Result {
  const { vehicle, road, input } = rig;
  const aim = { x: 0, y: 0, z: 0 };
  let s = rig.span.startS;
  let integral = 0;
  let steps = 0;
  let speedSum = 0;
  let maxSpeed = 0;
  let metres = 0;
  let lastVy = vehicle.chassis.linvel().y;
  // The settle's landing is still sitting in the audio bump channel; it is not road.
  vehicle.audio.bumpMps = 0;
  const accels: number[] = [];
  const signedAccels: number[] = [];
  const loads: number[] = [];
  const bumps: number[] = [];
  /** Body height over the road centreline, and body pitch (rad), per step. */
  const relHeight: number[] = [];
  const pitch: number[] = [];
  let hits = 0;
  let lastHit = -BUMP_HIT_GAP_STEPS;
  let contactSum = 0;

  // A stall guard, because a car that spins out in the desert would otherwise sit at
  // full lock and full throttle until the step cap and report a meaningless mean.
  let stalledSteps = 0;

  const routeMetres = rig.span.endS - rig.span.startS;
  while (metres < routeMetres && steps < 120_000 && stalledSteps < 600) {
    const t = vehicle.chassis.translation();
    // Lookahead grows with speed: a fixed one oversteers at speed and understeers at
    // walking pace, and the difference would be charged to the surface.
    const v0 = vehicle.chassis.linvel();
    const reach = LOOKAHEAD + 0.35 * Math.hypot(v0.x, v0.z);
    s = advanceS(road, s, t.x, t.z);
    road.offsetPoint(s + reach, rig.lateral, aim);
    const held = road.project(t.x, t.z, s);
    rig.lateralSum += Math.abs(held.lateral);
    rig.lateralN++;

    // Heading error to the aim point, in the chassis frame.
    const q = vehicle.chassis.rotation();
    const heading = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.z * q.z),
    );
    const want = Math.atan2(aim.x - t.x, aim.z - t.z);
    let error = want - heading;
    while (error > Math.PI) error -= 2 * Math.PI;
    while (error < -Math.PI) error += 2 * Math.PI;
    input.steer = Math.max(-0.9, Math.min(0.9, -error * 2.2));

    const v = vehicle.chassis.linvel();
    const speed = Math.hypot(v.x, v.z);
    const speedError = targetSpeed - speed;
    integral = Math.max(-1, Math.min(1, integral + speedError * FIXED_DT * 0.5));
    const demand = speedError * 0.35 + integral;
    input.throttle = Math.max(0, Math.min(1, demand));
    input.brake = Math.max(0, Math.min(1, -demand * 0.5));

    vehicle.fixedUpdate(FIXED_DT, input);
    rig.physics.step();
    vehicle.postStep();

    const after = vehicle.chassis.linvel();
    const az = (after.y - lastVy) / FIXED_DT / 9.81;
    lastVy = after.y;
    accels.push(Math.abs(az));
    signedAccels.push(az);
    let load = 0;
    for (const w of vehicle.wheelRide) {
      if (w.staticLoadN > 0) load = Math.max(load, w.loadN / w.staticLoadN);
    }
    loads.push(load);
    // The bench is the consumer of the audio bump channel: read it and zero it.
    const bump = vehicle.audio.bumpMps;
    vehicle.audio.bumpMps = 0;
    bumps.push(bump);
    const body = vehicle.chassis.translation();
    relHeight.push(body.y - road.sampleAt(s).y);
    const pose = vehicle.chassis.rotation();
    pitch.push(Math.asin(Math.max(-1, Math.min(1, 2 * (pose.y * pose.z - pose.w * pose.x)))));
    if (bump > BUMP_HIT_MPS && steps - lastHit >= BUMP_HIT_GAP_STEPS) {
      hits++;
      lastHit = steps;
    }
    contactSum += vehicle.audio.wheelContactFraction;
    speedSum += speed;
    metres += speed * FIXED_DT;
    if (speed > maxSpeed) maxSpeed = speed;
    stalledSteps = speed < 1 ? stalledSteps + 1 : 0;
    steps++;
  }

  const rms = Math.sqrt(accels.reduce((a, b) => a + b * b, 0) / Math.max(1, accels.length));
  const heldLateral = rig.lateralSum / Math.max(1, rig.lateralN);
  const sorted = [...accels].sort((a, b) => a - b);
  const jolt = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  let floatSq = 0;
  let sharpSq = 0;
  let bandN = 0;
  for (let i = FLOAT_HALF_WINDOW; i < signedAccels.length - FLOAT_HALF_WINDOW; i++) {
    let mean = 0;
    for (let j = i - FLOAT_HALF_WINDOW; j <= i + FLOAT_HALF_WINDOW; j++) mean += signedAccels[j]!;
    mean /= 2 * FLOAT_HALF_WINDOW + 1;
    floatSq += mean * mean;
    sharpSq += (signedAccels[i]! - mean) ** 2;
    bandN++;
  }
  const pct = (values: number[], p: number): number => {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  };
  /** RMS of a series' 0.3-2.5 Hz band: its short centred mean minus its long one. */
  const floatBand = (series: number[]): number => {
    let sq = 0;
    let n = 0;
    for (let i = TREND_HALF_WINDOW; i < series.length - TREND_HALF_WINDOW; i++) {
      let short = 0;
      for (let j = i - FLOAT_HALF_WINDOW; j <= i + FLOAT_HALF_WINDOW; j++) short += series[j]!;
      let long = 0;
      for (let j = i - TREND_HALF_WINDOW; j <= i + TREND_HALF_WINDOW; j++) long += series[j]!;
      const band = short / (2 * FLOAT_HALF_WINDOW + 1) - long / (2 * TREND_HALF_WINDOW + 1);
      sq += band * band;
      n++;
    }
    return Math.sqrt(sq / Math.max(1, n));
  };

  return {
    label,
    metres,
    meanSpeed: (speedSum / Math.max(1, steps)) * 3.6,
    heaveG: rms,
    floatG: Math.sqrt(floatSq / Math.max(1, bandN)),
    sharpG: Math.sqrt(sharpSq / Math.max(1, bandN)),
    floatMm: floatBand(relHeight) * 1000,
    pitchDeg: (floatBand(pitch) * 180) / Math.PI,
    joltG: jolt,
    maxG: sorted[sorted.length - 1] ?? 0,
    loadP99: pct(loads, 0.99),
    loadMax: pct(loads, 1),
    bumpP99: pct(bumps, 0.99),
    bumpMax: pct(bumps, 1),
    hitsPerKm: hits / Math.max(0.001, metres / 1000),
    contact: contactSum / Math.max(1, steps),
    heldLateral,
    maxSpeed: maxSpeed * 3.6,
  };
}

/** Flat-out from rest on the road: the acceleration and top-speed half of the report. */
function flatOut(rig: Rig, seconds: number): { to100s: number | null; topKmh: number } {
  const { vehicle, road, input } = rig;
  const aim = { x: 0, y: 0, z: 0 };
  let s = rig.span.startS;
  let to100: number | null = null;
  let top = 0;
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const t = vehicle.chassis.translation();
    s = advanceS(road, s, t.x, t.z);
    road.offsetPoint(s + LOOKAHEAD, rig.lateral, aim);
    const q = vehicle.chassis.rotation();
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    let error = Math.atan2(aim.x - t.x, aim.z - t.z) - heading;
    while (error > Math.PI) error -= 2 * Math.PI;
    while (error < -Math.PI) error += 2 * Math.PI;
    input.steer = Math.max(-1, Math.min(1, -error * 2.2));
    input.throttle = 1;
    input.brake = 0;
    vehicle.fixedUpdate(FIXED_DT, input);
    rig.physics.step();
    vehicle.postStep();
    const v = vehicle.chassis.linvel();
    const kmh = Math.hypot(v.x, v.z) * 3.6;
    if (kmh > top) top = kmh;
    if (to100 === null && kmh >= 100) to100 = i * FIXED_DT;
  }
  return { to100s: to100, topKmh: top };
}

function row(r: Result): string {
  return [
    r.label.padEnd(15),
    `${r.meanSpeed.toFixed(1)}`.padStart(6),
    `${r.heaveG.toFixed(3)}`.padStart(7),
    `${r.floatG.toFixed(3)}`.padStart(7),
    `${r.sharpG.toFixed(3)}`.padStart(7),
    `${r.floatMm.toFixed(1)}`.padStart(6),
    `${r.pitchDeg.toFixed(2)}`.padStart(6),
    `${r.joltG.toFixed(3)}`.padStart(7),
    `${r.maxG.toFixed(2)}`.padStart(6),
    `${r.loadP99.toFixed(2)}`.padStart(6),
    `${r.loadMax.toFixed(2)}`.padStart(6),
    `${r.bumpP99.toFixed(2)}`.padStart(6),
    `${r.bumpMax.toFixed(2)}`.padStart(6),
    `${r.hitsPerKm.toFixed(1)}`.padStart(6),
    `${(r.contact * 100).toFixed(1)}%`.padStart(7),
    `${r.heldLateral.toFixed(1)}m`.padStart(6),
    `${r.metres.toFixed(0)} m`.padStart(8),
  ].join(' ');
}

/** The district surfaces, each driven on its own first stretch of this seed's road. */
const DISTRICTS: readonly [SurfaceType, string][] = [
  [SurfaceType.Asphalt, 'asphalt'],
  [SurfaceType.CrackedAsphalt, 'cracked'],
  [SurfaceType.Gravel, 'gravel'],
  [SurfaceType.Concrete, 'concrete'],
];

async function run(): Promise<void> {
  await preloadCarModels([MODEL_ID]);
  const home = spanOf('road', FROM_CHUNK, TO_CHUNK);
  console.log(
    `surface feel @ ${speedKmh} km/h asked, ${MODEL_ID}, seed ${SEED}; road runs in the right lane (${LANE_LATERAL} m)`,
  );
  console.log(
    'surface          speed   heave  floatg  sharpg  boatmm pitch°  jolt99   maxg  load99 loadmx bump99 bumpmx hit/km contact  line  distance  where',
  );
  const where = (span: Span): string =>
    `  s ${span.startS}..${span.endS}, decay ${span.decay.toFixed(2)}`;

  console.log(row(drive(await makeRig(0, 'flat', home), 'flat')));
  console.log(row(drive(await makeRig(LANE_LATERAL, 'road', home), 'road')) + where(home));
  for (const [surface, name] of DISTRICTS) {
    const span = surfaceSpan(new Road(SEED), surface, name);
    if (!span) {
      console.log(`${name.padEnd(15)} no ${SURFACE_RUN_CHUNKS}-chunk stretch on seed ${SEED}`);
      continue;
    }
    console.log(row(drive(await makeRig(LANE_LATERAL, 'road', span), `road ${name}`)) + where(span));
  }
  if (!process.env.NO_DESERT) {
    console.log(
      row(drive(await makeRig(DESERT_LATERAL, 'desert', home), `desert ${DESERT_LATERAL}m`)),
    );
  }
  if (process.env.NO_SPRINT) return;

  console.log('\nflat out from rest, 30 s:');
  for (const ground of ['flat', 'road'] as const) {
    const sprint = flatOut(await makeRig(ground === 'road' ? LANE_LATERAL : 0, ground, home), 30);
    console.log(
      `  ${ground.padEnd(7)} 0-100 ${
        sprint.to100s === null ? '  never' : `${sprint.to100s.toFixed(1)} s`
      }, top ${sprint.topKmh.toFixed(1)} km/h`,
    );
  }
}

await run();
