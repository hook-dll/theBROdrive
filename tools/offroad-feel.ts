/**
 * tools/offroad-feel.ts
 *
 * What the CAR feels off the asphalt, on the ground the GAME builds there.
 *
 * `surface-feel.ts` drives the road and one desert line laid by `TerrainMeshProvider`,
 * which only road-lab streams. The game's off-road ground is three colliders that meet
 * at the verge: the road chunk's graded shoulder strip (`LooseShoulder`), the chunk's
 * collider-only verge skirt (`SKIRT_ACROSS_M`, Sand) and the desert tile heightfield
 * under both (`DesertTileStreamer`, Sand, 3 m cells). This builds exactly those —
 * `RoadMeshProvider` with the road-distance field as `main.ts` gives it, and the
 * streamer kept physical round the car as `main.ts` keeps it — with the world origin
 * rebased to the run, and drives a REAL `Vehicle` over them.
 *
 * Three families of run:
 *
 *   seam      lane -> shoulder -> embankment -> desert on a straight line leaving the
 *             lane at a shallow angle and at 30 degrees, at several places on the seed.
 *             The window is the turn-in to SEAM_END_M of lateral: the verge, the skirt,
 *             the embankment's foot.
 *   along     the road's own lane as the control, then the desert alongside it at a
 *             fixed lateral over a few kilometres: the deliberate waves.
 *   open      the rest of the desert: straight lines leaving the road square to it and
 *             at 45 degrees, and a line parallel to it OPEN_FAR_M out. Driving away from
 *             the road has to stay easier than driving beside it.
 *   geometry  no car: the waves themselves along the same lines (see `geometryRuns`).
 *
 * Per run, what the seat and the car report:
 *
 *   speed        mean km/h held (asked in the label)
 *   heave        RMS vertical acceleration of the chassis, g
 *   jolt99/maxg  99th percentile and worst vertical acceleration, g
 *   load99/mx    most-loaded wheel's raw contact force (spring+damper+bump stop) over
 *                its static load: the spikes a hit makes
 *   air%         share of steps with NO wheel on the ground; 2off% two or more off
 *   roll/pitch   p99 and worst body rate, deg/s, in the chassis frame
 *   flips        rollovers (chassis up below 0.3): the run is put back on its line
 *   body/km      steps the chassis' own collider touched static ground, per km
 *   hitsw        (seam) collider changes under one wheel per crossing, and how many of
 *                them came back to the previous collider within 10 steps (chatter)
 *   surfsw       (seam) surface-type changes per wheel per crossing, and the chatter
 *   offline      mean/worst distance from the line asked for: a run that wandered shows
 *   gnd-rate99   the ground's vertical speed under a contact, m/s; kink99 its step
 *                change between fixed steps (a triangle edge the ray-cast wheel follows
 *                instantly)
 *
 * DIAG=1 adds, per run: the share of 1 g jolts with a wheel at the suspension's travel clamp,
 * with the chassis box on the ground and with a bump stop engaged, and the body force
 * on those steps split by source (spring, damper, bump stop, tyre hop, bleed, rest);
 * what each wheel stood on (surface / road chunk or tile); where on the box the body
 * touched; and every launch (all four wheels off) and tip (roll over TIP_DEG_S)
 * attributed to what happened in the CAUSE_STEPS before it. TRACE=1 prints the car
 * every half second. BODY_RAISE=m lifts the chassis box's floor by m (an experiment).
 *
 *   bun tools/offroad-feel.ts                 everything
 *   ONLY=seam|along|open|geometry  SEAMS=n (crossing sites, default 6)  ALONG_M=n (default 2500)
 *   MODEL=id (default sv_vaz2105r)  GEOMETRY_S=s GEOMETRY_LATERALS=a,b,.. (geometry lines)
 *
 * Heavy: builds real road chunks and desert tiles. Run alone, under `nice -n 15`.
 * Nothing here is part of the game bundle.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { emptyInput } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SURFACES, SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { preloadCarModels } from '../src/render/carmodel';
import { SUSPENSION_FORCE_HEADROOM } from '../src/vehicle/vehicletuning';
import type { TyreContact } from '../src/vehicle/tyrecontact';
import { Vehicle } from '../src/vehicle/vehicle';
import { type ChunkContext } from '../src/world/chunks';
import { DESERT_TILE_SIZE, DesertTileStreamer } from '../src/world/deserttiles';
import { WorldOrigin } from '../src/world/origin';
import { CHUNK_LENGTH } from '../src/world/ranges';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { Terrain } from '../src/world/terrain';
import { WorldWorkScheduler } from '../src/world/workqueue';
import { installAssetShim } from './assetshim';
import { benchCarState } from './benchcar';
import { installDocumentShim } from './domshim';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable = false;
  readonly loaded = 0;
  readonly total = 0;
}
if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;
installAssetShim();
installDocumentShim();

const SEED = 42;
const MODEL_ID = process.env.MODEL ?? 'sv_vaz2105r';
/** The lane the seam runs leave from (the same right-lane line surface-feel drives). */
const LANE_LATERAL = 1.65;
/** First seam site, and the spacing between sites, metres of arclength. */
const SEAM_FIRST_S = 24_100;
const SEAM_SPACING_S = 900;
const SEAM_SITES = Number(process.env.SEAMS ?? 6);
/** Lateral at which a seam window closes: past the skirt (20 m beyond the strip). */
const SEAM_END_M = 28;
/** Metres past the turn-in after which a crossing that never got out is abandoned. */
const SEAM_MAX_M = 400;
/** Metres of lane driving at speed before the turn-in. */
const LEAD_IN_M = 50;
const ALONG_START_S = 24_100;
const ALONG_METRES = Number(process.env.ALONG_M ?? 2500);
const SETTLE_STEPS = 90;
/** Chassis up-vector Y below which the car counts as rolled over. */
const FLIP_UP_Y = 0.3;
/** Steps a collider change must revert within to count as chatter. */
const CHATTER_STEPS = 10;
/** Steps after a rollover's recovery that are not measured: the drop back onto the ground. */
const RECOVER_HOLD_STEPS = 90;
/** Vertical acceleration, g, at which a step counts as a jolt for the spike anatomy. */
const SPIKE_G = 1;
/** Steps before a launch or tip searched for its cause. */
const CAUSE_STEPS = 20;
/** Roll rate, deg/s, a tip is counted at. */
const TIP_DEG_S = 150;
/** Steps stopped (under 1 m/s) with the throttle down before a run counts as stuck. */
const STUCK_STEPS = 180;
/** Bump stop load over static load at which a stop counts as crushed. */
const CRUSH_LOAD = 3;

/** The private parts of a Vehicle a bench reads but the game never should. */
interface WheelInternals {
  compressionM: number;
  maxTravelM: number;
  contactNormal: { y: number };
  /** World contact point (relative to the origin), as the tyre contact last reported it. */
  contactPoint: { y: number };
  bleedN: number;
  hopZ: number;
  hopV: number;
  springRateNPerM: number;
  compressionRateNsPerM: number;
  relaxationRateNsPerM: number;
  tyre: TyreContact;
}
interface VehicleInternals {
  chassisCollider: RAPIER.Collider;
  wheels: WheelInternals[];
}

/** Mean vertical force by source over the jolt steps, g; see SPIKE ANATOMY in `drive`. */
interface Anatomy {
  steps: number;
  clamped: number;
  body: number;
  bump: number;
  rapier: number;
  /** The spring's share of `rapier` (the tyre contact's force); the rest is its damper. */
  spring: number;
  bumpStop: number;
  hop: number;
  bleed: number;
  residual: number;
}

interface Ground {
  physics: PhysicsWorld;
  origin: WorldOrigin;
  road: Road;
  terrain: Terrain;
  roadProvider: RoadMeshProvider;
  desert: DesertTileStreamer;
  built: Set<number>;
  desertTile: string;
  frame: number;
  /** Every road chunk collider (strip, skirt, ribbon). */
  roadHandles: Set<number>;
}

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const roadDistance = new RoadDistance(road);

async function makeGround(absX: number, absZ: number): Promise<Ground> {
  const physics = await PhysicsWorld.create();
  const origin = new WorldOrigin();
  origin.reset(absX, absZ);
  const desert = new DesertTileStreamer(
    SEED,
    road,
    terrain,
    roadDistance,
    physics,
    new THREE.Scene(),
    origin,
    undefined,
    new WorldWorkScheduler(3),
    () => null,
  );
  return {
    physics,
    origin,
    road,
    terrain,
    roadProvider: new RoadMeshProvider(SEED, roadDistance),
    desert,
    built: new Set(),
    desertTile: '',
    frame: 1,
    roadHandles: new Set(),
  };
}

/** Road chunks round `s` and the desert's physical square round the car, as main.ts keeps them. */
function keepGround(g: Ground, absX: number, absZ: number, s: number, lateral: number): void {
  const centre = Math.floor(s / CHUNK_LENGTH);
  for (let index = centre - 2; index <= centre + 3; index++) {
    if (index < 0 || g.built.has(index)) continue;
    g.built.add(index);
    const sStart = index * CHUNK_LENGTH;
    const ctx = {
      chunkIndex: index,
      sStart,
      sEnd: Math.min(g.road.length, sStart + CHUNK_LENGTH),
      road: g.road,
      terrain: g.terrain,
      physics: g.physics,
      hasPhysics: true,
      originX: g.origin.x,
      originZ: g.origin.z,
    } as unknown as ChunkContext;
    const content = g.roadProvider.build(ctx);
    if (!content) continue;
    for (const collider of content.colliders) {
      collider.setEnabled(true);
      g.roadHandles.add(collider.handle);
    }
  }
  const tile = `${Math.floor(absX / DESERT_TILE_SIZE)},${Math.floor(absZ / DESERT_TILE_SIZE)}`;
  if (tile !== g.desertTile) {
    g.desertTile = tile;
    g.desert.prime(absX, absZ, lateral);
  }
  g.desert.update(absX, absZ, lateral, g.frame++);
}

/** A straight line to steer down, in absolute XZ. */
interface Line {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

interface Stats {
  label: string;
  metres: number;
  steps: number;
  speedSum: number;
  /** Sum and worst of the distance from the asked line: a run that wandered is visible. */
  offLineSum: number;
  offLineMax: number;
  accels: number[];
  loads: number[];
  /**
   * The ground under each contact: its vertical rate as the wheel rolls (m/s), and the
   * step change of that rate between fixed steps (m/s) — a triangle edge or a seam is
   * a velocity STEP the ray-cast wheel follows instantly.
   */
  groundRates: number[];
  groundKinks: number[];
  rollRates: number[];
  pitchRates: number[];
  airSteps: number;
  twoOffSteps: number;
  flips: number;
  bodySteps: number;
  crossings: number;
  colliderSwitches: number;
  colliderChatter: number;
  surfaceSwitches: number;
  surfaceChatter: number;
  /** Wheel-steps in contact, and of those at the end of the suspension's travel. */
  wheelContactSteps: number;
  wheelClampSteps: number;
  anatomy: Anatomy;
  /** Wheel-steps by what the wheel's ray stood on: surface label / road chunk or tile. */
  standing: Record<string, number>;
  /** Body-contact steps by where on the box (nose / belly / tail). */
  bodyWhere: Record<string, number>;
  /** Launches and tips by attributed cause. */
  events: Record<string, number>;
}

function newStats(label: string): Stats {
  return {
    label,
    metres: 0,
    steps: 0,
    speedSum: 0,
    offLineSum: 0,
    offLineMax: 0,
    accels: [],
    loads: [],
    groundRates: [],
    groundKinks: [],
    rollRates: [],
    pitchRates: [],
    airSteps: 0,
    twoOffSteps: 0,
    flips: 0,
    bodySteps: 0,
    crossings: 0,
    colliderSwitches: 0,
    colliderChatter: 0,
    surfaceSwitches: 0,
    surfaceChatter: 0,
    wheelContactSteps: 0,
    wheelClampSteps: 0,
    anatomy: { steps: 0, clamped: 0, body: 0, bump: 0, rapier: 0, spring: 0, bumpStop: 0, hop: 0, bleed: 0, residual: 0 },
    standing: {},
    bodyWhere: {},
    events: {},
  };
}

/** Per-wheel history of what its ray stands on, for the switch and chatter counts. */
interface WheelTrack {
  handle: number;
  previousHandle: number;
  handleAt: number;
  surface: SurfaceType;
  previousSurface: SurfaceType;
  surfaceAt: number;
  /** Last contact height and its rate, for the ground-rate figures; NaN after air. */
  groundY: number;
  groundRate: number;
}

interface Car {
  vehicle: Vehicle;
  internals: VehicleInternals;
  tracks: WheelTrack[];
}

function spawn(g: Ground, absX: number, absZ: number, heading: number, speed: number, s: number, lateral: number): Car {
  keepGround(g, absX, absZ, s, lateral);
  const rx = absX - g.origin.x;
  const rz = absZ - g.origin.z;
  const hit = g.physics.raycast({ x: rx, y: 2000, z: rz }, { x: 0, y: -1, z: 0 }, 4000);
  const groundY = hit ? hit.point.y : g.terrain.heightAt(absX, absZ, s);
  const world = new GameWorld(newWorldState(SEED));
  const state = benchCarState(MODEL_ID, { id: 'offroad-feel', x: absX, y: groundY + 1.2, z: absZ, heading });
  world.state.cars[state.id] = state;
  const vehicle = new Vehicle(g.physics, world, state, new THREE.Scene(), g.origin);
  const input = emptyInput();
  for (let i = 0; i < SETTLE_STEPS; i++) {
    vehicle.fixedUpdate(FIXED_DT, input);
    g.physics.step();
    vehicle.postStep();
  }
  vehicle.launchRolling(speed);
  const internals = vehicle as unknown as VehicleInternals;
  // EXPERIMENT `BODY_RAISE=m`: lift the chassis box's floor by m, so the overhangs clear
  // the waves. Not a fix; a test of how much of the trouble is the box digging in.
  const raise = Number(process.env.BODY_RAISE ?? 0);
  if (raise > 0) {
    const box = internals.chassisCollider;
    const half = box.halfExtents()!;
    const at = box.translationWrtParent()!;
    box.setHalfExtents({ x: half.x, y: half.y - raise / 2, z: half.z });
    box.setTranslationWrtParent({ x: at.x, y: at.y + raise / 2, z: at.z });
  }
  const tracks: WheelTrack[] = vehicle.wheelRide.map(() => ({
    handle: -1,
    previousHandle: -1,
    handleAt: -1000,
    surface: SurfaceType.Asphalt,
    previousSurface: SurfaceType.Asphalt,
    surfaceAt: -1000,
    groundY: Number.NaN,
    groundRate: Number.NaN,
  }));
  return { vehicle, internals, tracks };
}

interface DriveOptions {
  speed: number;
  /** Where to aim: writes an absolute XZ point `reach` metres ahead into `out`. */
  aim: (absX: number, absZ: number, s: number, reach: number, out: { x: number; z: number }) => void;
  /** Whether this step counts. */
  measure: (s: number, lateral: number) => boolean;
  /** Whether the run is over. */
  done: (s: number, lateral: number, metres: number) => boolean;
  /** Put a rolled car back on its line, upright, at speed. */
  recover: (car: Car, s: number) => void;
  /** How far the chassis is from the line it was asked to hold, metres. */
  offLine: (absX: number, absZ: number, lateral: number) => number;
  /** Count wheel collider/surface switches. */
  seam: boolean;
}

const scratchAbs = { x: 0, y: 0, z: 0 };
/** The aim callbacks' own scratch: `scratchAbs` holds the chassis while they run. */
const scratchPoint = { x: 0, y: 0, z: 0 };
const scratchQuat = new THREE.Quaternion();
const scratchVec = new THREE.Vector3();

function drive(g: Ground, car: Car, startS: number, stats: Stats, o: DriveOptions): void {
  const { vehicle, internals } = car;
  const input = emptyInput();
  let s = startS;
  let integral = 0;
  let lastVy = vehicle.chassis.linvel().y;
  let metres = 0;
  let steps = 0;
  let stalled = 0;
  const aim = { x: 0, z: 0 };
  let measuring = false;
  let hold = 0;
  let lastBody = -1000;
  let lastCrush = -1000;
  let lastClamp = -1000;
  let wasAirborne = false;
  let wasTipping = false;
  while (steps < 60_000) {
    const abs = vehicle.absoluteTranslation(scratchAbs);
    const projection = g.road.project(abs.x, abs.z, s);
    s = projection.s;
    const lateral = projection.lateral;
    if (o.done(s, lateral, metres)) break;
    keepGround(g, abs.x, abs.z, s, lateral);

    const v0 = vehicle.chassis.linvel();
    const speed = Math.hypot(v0.x, v0.z);
    o.aim(abs.x, abs.z, s, 8 + 0.35 * speed, aim);
    const q = vehicle.chassis.rotation();
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    let error = Math.atan2(aim.x - abs.x, aim.z - abs.z) - heading;
    while (error > Math.PI) error -= 2 * Math.PI;
    while (error < -Math.PI) error += 2 * Math.PI;
    input.steer = Math.max(-0.9, Math.min(0.9, -error * 2.2));
    const speedError = o.speed - speed;
    integral = Math.max(-1, Math.min(1, integral + speedError * FIXED_DT * 0.5));
    const demand = speedError * 0.35 + integral;
    input.throttle = Math.max(0, Math.min(1, demand));
    input.brake = Math.max(0, Math.min(1, -demand * 0.5));

    vehicle.fixedUpdate(FIXED_DT, input);
    g.physics.step();
    vehicle.postStep();
    steps++;

    const after = vehicle.chassis.linvel();
    const az = (after.y - lastVy) / FIXED_DT / 9.81;
    lastVy = after.y;
    const rot = vehicle.chassis.rotation();
    scratchQuat.set(rot.x, rot.y, rot.z, rot.w);
    const upY = scratchVec.set(0, 1, 0).applyQuaternion(scratchQuat).y;
    if (process.env.TRACE && steps % 30 === 0) {
      const under: string[] = [];
      for (let i = 0; i < vehicle.wheelRide.length; i++) {
        const tyre = internals.wheels[i]!.tyre;
        const ground = tyre.inContact ? tyre.ground : null;
        under.push(ground ? SURFACES[g.physics.surfaces.lookupType(ground.handle)].label : 'air');
      }
      console.log(
        `  t ${(steps * FIXED_DT).toFixed(1)} s ${s.toFixed(0)} lat ${lateral.toFixed(1)} ` +
          `${(speed * 3.6).toFixed(0)} km/h ${vehicle.gearLabel} upY ${upY.toFixed(2)} on ${under.join('|')}`,
      );
    }
    stalled = speed < 1 && hold === 0 ? stalled + 1 : 0;
    const stuck = stalled >= STUCK_STEPS;
    if (upY < FLIP_UP_Y || stuck) {
      if (measuring && !stuck) stats.flips++;
      if (measuring && stuck) {
        // Stopped dead with the throttle down: against a prop's collider (the body is
        // touching fixed ground) or by the ground alone. Counted, then put back on the
        // line past it, so one rock does not decide the run's mean speed.
        const key = steps - lastBody <= STUCK_STEPS ? 'stuck<-body' : 'stuck<-ground';
        stats.events[key] = (stats.events[key] ?? 0) + 1;
      }
      if (process.env.TRACE) {
        console.log(`  ${stuck ? 'STUCK' : 'FLIP'} at s ${s.toFixed(0)} lat ${lateral.toFixed(1)} ${(speed * 3.6).toFixed(0)} km/h`);
      }
      stalled = 0;
      o.recover(car, s);
      lastVy = vehicle.chassis.linvel().y;
      hold = RECOVER_HOLD_STEPS;
      for (const t of car.tracks) {
        t.handle = -1;
        t.handleAt = -1000;
        t.surfaceAt = -1000;
        t.groundY = Number.NaN;
        t.groundRate = Number.NaN;
      }
      continue;
    }
    metres += speed * FIXED_DT;
    if (hold > 0) {
      hold--;
      continue;
    }

    measuring = o.measure(s, lateral);
    if (!measuring) continue;
    stats.steps++;
    stats.metres += speed * FIXED_DT;
    stats.speedSum += speed;
    const offLine = o.offLine(abs.x, abs.z, lateral);
    stats.offLineSum += offLine;
    stats.offLineMax = Math.max(stats.offLineMax, offLine);
    stats.accels.push(Math.abs(az));
    const w = vehicle.chassis.angvel();
    scratchVec.set(w.x, w.y, w.z).applyQuaternion(scratchQuat.invert());
    // Chassis frame: +z forward, so roll is about z and pitch about x.
    stats.rollRates.push(Math.abs(scratchVec.z) * (180 / Math.PI));
    stats.pitchRates.push(Math.abs(scratchVec.x) * (180 / Math.PI));

    let off = 0;
    let load = 0;
    let clamped = false;
    let bumping = false;
    let rapierN = 0;
    let springN = 0;
    let bumpN = 0;
    let hopN = 0;
    let bleedN = 0;
    const ride = vehicle.wheelRide;
    for (let i = 0; i < ride.length; i++) {
      const r = ride[i]!;
      const wheel = internals.wheels[i]!;
      const contact = wheel.tyre.inContact;
      const track = car.tracks[i]!;
      if (!contact) {
        off++;
        track.groundY = Number.NaN;
        track.groundRate = Number.NaN;
      } else {
        const groundY = wheel.contactPoint.y;
        const rate = (groundY - track.groundY) / FIXED_DT;
        if (Number.isFinite(rate)) {
          stats.groundRates.push(Math.abs(rate));
          if (Number.isFinite(track.groundRate)) stats.groundKinks.push(Math.abs(rate - track.groundRate));
        }
        track.groundY = groundY;
        track.groundRate = rate;
        const suspension = wheel.tyre.forceN;
        // What the body is actually handed through this tyre: the spring's force and the stop.
        const raw = suspension + r.bumpStopN;
        if (r.staticLoadN > 0) load = Math.max(load, raw / r.staticLoadN);
        stats.wheelContactSteps++;
        if (wheel.compressionM >= wheel.maxTravelM - 1e-3) {
          clamped = true;
          stats.wheelClampSteps++;
        }
        if (r.bumpStopN > 0) bumping = true;
        const up = wheel.contactNormal.y;
        const applied = Math.min(suspension, SUSPENSION_FORCE_HEADROOM * r.staticLoadN);
        rapierN += applied * up;
        // The spring term is k·(rest − length); the rest of the force is the damper.
        springN += Math.min(applied, wheel.springRateNPerM * wheel.compressionM) * up;
        bumpN += r.bumpStopN;
        bleedN += wheel.bleedN;
        const cSusp = wheel.hopV > 0 ? wheel.compressionRateNsPerM : wheel.relaxationRateNsPerM;
        hopN += Math.max(-r.loadN, wheel.springRateNPerM * wheel.hopZ + cSusp * wheel.hopV);
      }
      const ground = contact ? wheel.tyre.ground : null;
      if (!ground) continue;
      const handle = ground.handle;
      const surface = g.physics.surfaces.lookupType(handle);
      const where = `${SURFACES[surface].label}${g.roadHandles.has(handle) ? '/road' : '/tile'}`;
      stats.standing[where] = (stats.standing[where] ?? 0) + 1;
      if (!o.seam) continue;
      const t = car.tracks[i]!;
      if (t.handle >= 0 && handle !== t.handle) {
        stats.colliderSwitches++;
        if (handle === t.previousHandle && steps - t.handleAt <= CHATTER_STEPS) stats.colliderChatter++;
        t.previousHandle = t.handle;
        t.handleAt = steps;
      }
      t.handle = handle;
      if (t.surfaceAt > -1000 && surface !== t.surface) {
        stats.surfaceSwitches++;
        if (surface === t.previousSurface && steps - t.surfaceAt <= CHATTER_STEPS) stats.surfaceChatter++;
        t.previousSurface = t.surface;
        t.surfaceAt = steps;
      } else if (t.surfaceAt === -1000) {
        t.surfaceAt = -999;
      }
      t.surface = surface;
    }
    stats.loads.push(load);
    if (off === ride.length) stats.airSteps++;
    if (off >= 2) stats.twoOffSteps++;
    let body = false;
    g.physics.world.contactPairsWith(internals.chassisCollider, (other) => {
      if (body || !other.parent()?.isFixed()) return;
      g.physics.world.contactPair(internals.chassisCollider, other, (manifold, flipped) => {
        if (manifold.numContacts() === 0) return;
        body = true;
        // Where on the box: the chassis-local point on the chassis collider's side.
        const local = flipped ? manifold.localContactPoint2(0) : manifold.localContactPoint1(0);
        if (!local) return;
        const where = local.z > 1 ? 'nose' : local.z < -1 ? 'tail' : 'belly';
        stats.bodyWhere[where] = (stats.bodyWhere[where] ?? 0) + 1;
      });
    });
    if (body) {
      stats.bodySteps++;
      lastBody = steps;
    }
    // LAUNCHES AND TIPS, attributed: what happened in the CAUSE_STEPS before a car left
    // the ground on all four wheels, or before its roll rate first crossed TIP_DEG_S.
    const crushed = ride.some((r) => r.staticLoadN > 0 && r.bumpStopN / r.staticLoadN > CRUSH_LOAD);
    if (crushed) lastCrush = steps;
    if (clamped) lastClamp = steps;
    const rollRate = stats.rollRates[stats.rollRates.length - 1] ?? 0;
    const launch = off === ride.length && !wasAirborne;
    const tip = rollRate > TIP_DEG_S && !wasTipping;
    wasAirborne = off === ride.length;
    wasTipping = rollRate > TIP_DEG_S;
    if (launch || tip) {
      const cause =
        steps - lastBody <= CAUSE_STEPS
          ? 'body'
          : steps - lastCrush <= CAUSE_STEPS
            ? 'crushed stop'
            : steps - lastClamp <= CAUSE_STEPS
              ? 'travel clamp'
              : 'springs';
      const key = `${launch ? 'launch' : 'tip'}<-${cause}`;
      stats.events[key] = (stats.events[key] ?? 0) + 1;
    }
    // SPIKE ANATOMY: on a step whose vertical acceleration is a jolt, the body's
    // vertical force split by source, in g of the car's weight. What the wheels'
    // sources do not explain (chassis on the ground, tyre forces on a slope) is
    // the residual.
    if (Math.abs(az) >= SPIKE_G) {
      const weight = vehicle.chassis.mass() * 9.81;
      const a = stats.anatomy;
      a.steps++;
      if (clamped) a.clamped++;
      if (body) a.body++;
      if (bumping) a.bump++;
      a.rapier += rapierN / weight;
      a.spring += springN / weight;
      a.bumpStop += bumpN / weight;
      a.hop += hopN / weight;
      a.bleed += bleedN / weight;
      a.residual += az + 1 - (rapierN + bumpN + hopN + bleedN) / weight;
    }
  }
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

const HEADER =
  'run                       speed  heave  jolt99   maxg  load99 loadmx  air%  2off%  roll99 rollmx pitch99 pitchmx flips body/km  hitsw(chat)  surfsw(chat)   metres  offline mean/max  gnd-rate99 kink99';

function row(st: Stats): string {
  const n = Math.max(1, st.steps);
  const rms = Math.sqrt(st.accels.reduce((a, b) => a + b * b, 0) / n);
  const perCrossing = (v: number): string =>
    st.crossings > 0 ? (v / st.crossings / 4).toFixed(1) : '-';
  return [
    st.label.padEnd(24),
    ((st.speedSum / n) * 3.6).toFixed(1).padStart(6),
    rms.toFixed(3).padStart(6),
    pct(st.accels, 0.99).toFixed(3).padStart(7),
    pct(st.accels, 1).toFixed(2).padStart(6),
    pct(st.loads, 0.99).toFixed(2).padStart(7),
    pct(st.loads, 1).toFixed(2).padStart(6),
    ((st.airSteps / n) * 100).toFixed(2).padStart(5),
    ((st.twoOffSteps / n) * 100).toFixed(1).padStart(6),
    pct(st.rollRates, 0.99).toFixed(0).padStart(7),
    pct(st.rollRates, 1).toFixed(0).padStart(6),
    pct(st.pitchRates, 0.99).toFixed(0).padStart(7),
    pct(st.pitchRates, 1).toFixed(0).padStart(7),
    String(st.flips).padStart(5),
    (st.bodySteps / Math.max(0.001, st.metres / 1000)).toFixed(1).padStart(7),
    `${perCrossing(st.colliderSwitches)}(${perCrossing(st.colliderChatter)})`.padStart(12),
    `${perCrossing(st.surfaceSwitches)}(${perCrossing(st.surfaceChatter)})`.padStart(13),
    st.metres.toFixed(0).padStart(8),
    `${(st.offLineSum / n).toFixed(1)}/${st.offLineMax.toFixed(1)}`.padStart(10),
    pct(st.groundRates, 0.99).toFixed(2).padStart(11),
    pct(st.groundKinks, 0.99).toFixed(2).padStart(7),
  ].join(' ');
}

/** Where the jolts came from: see SPIKE ANATOMY in `drive`. */
function anatomyRow(st: Stats): string {
  const a = st.anatomy;
  const k = Math.max(1, a.steps);
  const share = (v: number): string => `${((v / k) * 100).toFixed(0)}%`;
  const total = Object.values(st.standing).reduce((sum, n) => sum + n, 0);
  const standing = Object.entries(st.standing)
    .sort((x, y) => y[1] - x[1])
    .map(([where, n]) => `${where} ${((n / Math.max(1, total)) * 100).toFixed(1)}%`)
    .join(', ');
  return (
    `  ${''.padEnd(22)} clamp ${((st.wheelClampSteps / Math.max(1, st.wheelContactSteps)) * 100).toFixed(1)}% of wheel-steps;` +
    ` ${a.steps} jolts >=${SPIKE_G} g: clamped ${share(a.clamped)} body ${share(a.body)} bumpstop ${share(a.bump)};` +
    ` mean g: spring ${(a.spring / k).toFixed(2)} damper ${((a.rapier - a.spring) / k).toFixed(2)} stop ${(a.bumpStop / k).toFixed(2)}` +
    ` hop ${(a.hop / k).toFixed(2)} bleed ${(a.bleed / k).toFixed(2)} rest ${(a.residual / k).toFixed(2)}\n` +
    `  ${''.padEnd(22)} on: ${standing}\n` +
    `  ${''.padEnd(22)} body at: ${JSON.stringify(st.bodyWhere)}  launches/tips: ${JSON.stringify(st.events)}`
  );
}

/** Puts the car back on `line` at the point nearest arclength `s`, upright, moving. */
function lineRecover(g: Ground, line: Line, speed: number) {
  return (car: Car, s: number): void => {
    const abs = car.vehicle.absoluteTranslation(scratchAbs);
    const along = (abs.x - line.x) * line.dx + (abs.z - line.z) * line.dz + 10;
    const x = line.x + line.dx * along;
    const z = line.z + line.dz * along;
    const hit = g.physics.raycast({ x: x - g.origin.x, y: 2000, z: z - g.origin.z }, { x: 0, y: -1, z: 0 }, 4000);
    const heading = Math.atan2(line.dx, line.dz);
    car.vehicle.rescueTo(x, (hit ? hit.point.y : g.terrain.heightAt(x, z, s)) + 1, z, heading);
    car.vehicle.launchRolling(speed);
  };
}

async function seamRuns(): Promise<void> {
  const configs: { angleDeg: number; kmh: number }[] = [
    { angleDeg: 6, kmh: 40 },
    { angleDeg: 6, kmh: 80 },
    { angleDeg: 30, kmh: 40 },
    { angleDeg: 30, kmh: 80 },
  ];
  const stats = configs.map((c) => newStats(`seam ${c.angleDeg}deg ${c.kmh}`));
  const lane = { x: 0, y: 0, z: 0 };
  const ahead = { x: 0, y: 0, z: 0 };
  const out = { x: 0, y: 0, z: 0 };
  for (let site = 0; site < SEAM_SITES; site++) {
    const s0 = SEAM_FIRST_S + site * SEAM_SPACING_S;
    road.offsetPoint(s0, LANE_LATERAL, lane);
    const g = await makeGround(lane.x, lane.z);
    road.offsetPoint(s0 + 1, LANE_LATERAL, ahead);
    road.offsetPoint(s0, LANE_LATERAL + 1, out);
    const fLen = Math.hypot(ahead.x - lane.x, ahead.z - lane.z);
    const fx = (ahead.x - lane.x) / fLen;
    const fz = (ahead.z - lane.z) / fLen;
    const nx = out.x - lane.x;
    const nz = out.z - lane.z;
    for (let c = 0; c < configs.length; c++) {
      const { angleDeg, kmh } = configs[c]!;
      const speed = kmh / 3.6;
      const a = (angleDeg * Math.PI) / 180;
      const line: Line = {
        x: lane.x,
        z: lane.z,
        dx: Math.cos(a) * fx + Math.sin(a) * nx,
        dz: Math.cos(a) * fz + Math.sin(a) * nz,
      };
      const startS = s0 - LEAD_IN_M;
      const start = { x: 0, y: 0, z: 0 };
      road.offsetPoint(startS, LANE_LATERAL, start);
      const car = spawn(g, start.x, start.z, road.sampleAt(startS).heading, speed, startS, LANE_LATERAL);
      const laneSign = Math.sign(LANE_LATERAL);
      let turned = false;
      drive(g, car, startS, stats[c]!, {
        speed,
        seam: true,
        aim: (x, z, s, reach, into) => {
          if (!turned && s >= s0) turned = true;
          if (!turned) {
            road.offsetPoint(s + reach, LANE_LATERAL, scratchPoint);
            into.x = scratchPoint.x;
            into.z = scratchPoint.z;
            return;
          }
          const along = (x - line.x) * line.dx + (z - line.z) * line.dz + reach;
          into.x = line.x + line.dx * along;
          into.z = line.z + line.dz * along;
        },
        measure: () => turned,
        done: (_s, lateral, metres) =>
          turned && (lateral * laneSign > SEAM_END_M || metres > LEAD_IN_M + SEAM_MAX_M),
        offLine: (x, z) => Math.abs((x - line.x) * line.dz - (z - line.z) * line.dx),
        recover: lineRecover(g, line, speed),
      });
      stats[c]!.crossings++;
      car.vehicle.dispose();
    }
  }
  for (const st of stats) print(st);
}

/** One run's row, and with DIAG=1 where its jolts came from. */
function print(st: Stats): void {
  console.log(row(st));
  if (process.env.DIAG) console.log(anatomyRow(st));
}

/**
 * The road's own lane first, as the control on the same stretch and the same metric
 * (the asphalt must not move), then the desert alongside.
 */
async function alongRuns(): Promise<void> {
  for (const lateral of [LANE_LATERAL, 20, 40, 60]) {
    const start = { x: 0, y: 0, z: 0 };
    road.offsetPoint(ALONG_START_S, lateral, start);
    const g = await makeGround(start.x, start.z);
    for (const kmh of [60, 90]) {
      const speed = kmh / 3.6;
      const st = newStats(lateral === LANE_LATERAL ? `road lane ${kmh}` : `along ${lateral}m ${kmh}`);
      const car = spawn(g, start.x, start.z, road.sampleAt(ALONG_START_S).heading, speed, ALONG_START_S, lateral);
      drive(g, car, ALONG_START_S, st, {
        speed,
        seam: false,
        aim: (_x, _z, s, reach, into) => {
          road.offsetPoint(s + reach, lateral, scratchPoint);
          into.x = scratchPoint.x;
          into.z = scratchPoint.z;
        },
        measure: (s) => s > ALONG_START_S + 40,
        done: (s) => s > ALONG_START_S + 40 + ALONG_METRES,
        offLine: (_x, _z, held) => Math.abs(held - lateral),
        recover: (c, s) => {
          road.offsetPoint(s + 10, lateral, scratchPoint);
          const sample = road.sampleAt(s + 10);
          const x = scratchPoint.x;
          const z = scratchPoint.z;
          const hit = g.physics.raycast({ x: x - g.origin.x, y: 2000, z: z - g.origin.z }, { x: 0, y: -1, z: 0 }, 4000);
          c.vehicle.rescueTo(x, (hit ? hit.point.y : terrain.heightAt(x, z, s)) + 1, z, sample.heading);
          c.vehicle.launchRolling(speed);
        },
      });
      car.vehicle.dispose();
      print(st);
    }
  }
}

/** Sites the open-desert lines start from, their spacing, and the far line's lateral. */
const OPEN_SITES = 3;
const OPEN_SPACING_S = 1500;
const OPEN_START_LATERAL = 12;
const OPEN_LENGTH_M = 900;
/** Metres of an open line not measured: the car settling from its launch speed. */
const OPEN_SETTLE_M = 150;
const OPEN_FAR_M = 300;

/**
 * The desert away from the road: square to it, at 45 degrees, and parallel to it far
 * out. Straight lines from the right-hand side of the road, so the road's own curves
 * cannot steer the run.
 */
async function openRuns(): Promise<void> {
  const configs = [
    { label: 'perpendicular', angleDeg: 90, lateral: OPEN_START_LATERAL },
    { label: 'diagonal 45', angleDeg: 45, lateral: OPEN_START_LATERAL },
    { label: `far ${OPEN_FAR_M}m`, angleDeg: 0, lateral: OPEN_FAR_M },
  ];
  for (const c of configs) {
    for (const kmh of [60, 90]) {
      const speed = kmh / 3.6;
      const st = newStats(`${c.label} ${kmh}`);
      for (let site = 0; site < OPEN_SITES; site++) {
        const s0 = ALONG_START_S + site * OPEN_SPACING_S;
        const start = { x: 0, y: 0, z: 0 };
        const ahead = { x: 0, y: 0, z: 0 };
        const out = { x: 0, y: 0, z: 0 };
        road.offsetPoint(s0, c.lateral, start);
        road.offsetPoint(s0 + 1, c.lateral, ahead);
        road.offsetPoint(s0, c.lateral + 1, out);
        const fLen = Math.hypot(ahead.x - start.x, ahead.z - start.z);
        const fx = (ahead.x - start.x) / fLen;
        const fz = (ahead.z - start.z) / fLen;
        const a = (c.angleDeg * Math.PI) / 180;
        const line: Line = {
          x: start.x,
          z: start.z,
          dx: Math.cos(a) * fx + Math.sin(a) * (out.x - start.x),
          dz: Math.cos(a) * fz + Math.sin(a) * (out.z - start.z),
        };
        const g = await makeGround(start.x, start.z);
        const car = spawn(g, start.x, start.z, Math.atan2(line.dx, line.dz), speed, s0, c.lateral);
        let metres = 0;
        drive(g, car, s0, st, {
          speed,
          seam: false,
          aim: (x, z, _s, reach, into) => {
            const along = (x - line.x) * line.dx + (z - line.z) * line.dz;
            metres = along;
            into.x = line.x + line.dx * (along + reach);
            into.z = line.z + line.dz * (along + reach);
          },
          measure: () => metres > OPEN_SETTLE_M,
          done: () => metres > OPEN_LENGTH_M,
          offLine: (x, z) => Math.abs((x - line.x) * line.dz - (z - line.z) * line.dx),
          recover: lineRecover(g, line, speed),
        });
        car.vehicle.dispose();
      }
      print(st);
    }
  }
}

/**
 * THE GROUND ITSELF, for a terrain-side fix: the collider's height along each `along`
 * line, sampled by ray every GEOMETRY_STEP_M, split into the long swell a body on its
 * springs simply follows (a ±GEOMETRY_SWELL_M centred mean) and the WAVES left over,
 * which the suspension has to swallow.
 *
 *   wave99 / waverms  height of the waves about the swell, m: what the travel must absorb
 *   slope99           ground slope, rise over run (the wheel's vertical speed is this x v)
 *   curv99            wave curvature over a tyre-and-body scale (GEOMETRY_CURVE_M), 1/m
 *   lift-off          speed at which a body following that curvature would need more than
 *                     1 g downward over a crest: v = sqrt(g / curv99). Above it the car
 *                     leaves the ground whatever the suspension does.
 */
const GEOMETRY_STEP_M = 0.5;
const GEOMETRY_SWELL_M = 15;
const GEOMETRY_CURVE_M = 2.5;

async function geometryRuns(): Promise<void> {
  // GEOMETRY_S / GEOMETRY_LATERALS move the lines, e.g. to the inside of a tight bend.
  const startS = Number(process.env.GEOMETRY_S ?? ALONG_START_S);
  const laterals = (process.env.GEOMETRY_LATERALS ?? '20,40,60').split(',').map(Number);
  console.log(`\nground geometry along the lines from s ${startS} (collider, by ray):`);
  console.log('line       wave99  waverms  slope99  curv99  lift-off  fn-dev99/max');
  const point = { x: 0, y: 0, z: 0 };
  for (const lateral of laterals) {
    road.offsetPoint(startS, lateral, point);
    const g = await makeGround(point.x, point.z);
    const heights: number[] = [];
    // How far the collider sits from the height FUNCTION every other consumer reads
    // (`Terrain.heightAt`): the crests a wheel feels against the ones drawn and placed on.
    const deviations: number[] = [];
    let kept = Number.NEGATIVE_INFINITY;
    for (let s = startS; s <= startS + ALONG_METRES; s += GEOMETRY_STEP_M) {
      road.offsetPoint(s, lateral, point);
      if (s - kept >= 50) {
        keepGround(g, point.x, point.z, s, lateral);
        // A query sees new colliders only after the world has stepped once.
        g.physics.step();
        kept = s;
      }
      const hit = g.physics.raycast(
        { x: point.x - g.origin.x, y: 2000, z: point.z - g.origin.z },
        { x: 0, y: -1, z: 0 },
        4000,
      );
      heights.push(hit ? hit.point.y : Number.NaN);
      // Props (rocks, cacti) register as Rock; the ground is Sand.
      if (hit && g.physics.surfaces.lookupType(hit.colliderHandle) === SurfaceType.Sand) {
        deviations.push(Math.abs(hit.point.y - g.terrain.heightAt(point.x, point.z, s)));
      }
    }
    const swell = Math.round(GEOMETRY_SWELL_M / GEOMETRY_STEP_M);
    const curve = Math.round(GEOMETRY_CURVE_M / GEOMETRY_STEP_M);
    const waves: number[] = [];
    const slopes: number[] = [];
    const residual: number[] = [];
    for (let i = swell; i < heights.length - swell; i++) {
      let mean = 0;
      for (let j = i - swell; j <= i + swell; j++) mean += heights[j]!;
      mean /= 2 * swell + 1;
      const r = heights[i]! - mean;
      residual.push(r);
      waves.push(Math.abs(r));
      slopes.push(Math.abs(heights[i + 1]! - heights[i - 1]!) / (2 * GEOMETRY_STEP_M));
    }
    const curvatures: number[] = [];
    for (let i = curve; i < residual.length - curve; i++) {
      curvatures.push(
        Math.abs(residual[i + curve]! - 2 * residual[i]! + residual[i - curve]!) / GEOMETRY_CURVE_M ** 2,
      );
    }
    const rms = Math.sqrt(residual.reduce((a, b) => a + b * b, 0) / Math.max(1, residual.length));
    const curv99 = pct(curvatures, 0.99);
    console.log(
      [
        `${lateral} m`.padEnd(9),
        pct(waves, 0.99).toFixed(3).padStart(7),
        rms.toFixed(3).padStart(8),
        pct(slopes, 0.99).toFixed(3).padStart(8),
        curv99.toFixed(4).padStart(7),
        `${(Math.sqrt(9.81 / curv99) * 3.6).toFixed(0)} km/h`.padStart(9),
        `${pct(deviations, 0.99).toFixed(3)}/${pct(deviations, 1).toFixed(3)}`.padStart(13),
      ].join(' '),
    );
  }
}

await preloadCarModels([MODEL_ID]);
if (process.env.ONLY === 'geometry') {
  await geometryRuns();
} else {
  console.log(`offroad feel, ${MODEL_ID}, seed ${SEED}; game colliders (strip + skirt + desert tiles)`);
  console.log(HEADER);
  if (process.env.ONLY !== 'along' && process.env.ONLY !== 'open') await seamRuns();
  if (process.env.ONLY !== 'seam' && process.env.ONLY !== 'open') await alongRuns();
  if (!process.env.ONLY || process.env.ONLY === 'open') await openRuns();
  if (!process.env.ONLY) await geometryRuns();
}
