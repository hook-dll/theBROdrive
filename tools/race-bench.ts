/**
 * The races at the tracks (race/): do the rules count laps right, does the money move
 * right, and does a whole race of a full field of real cars come out, every car home?
 *
 *   nice -n 15 bun tools/race-bench.ts [races = 3] [seed = 1337]
 *
 * Checked, not just printed:
 *
 *  - LAPS (race/laps.ts) on a track's own centreline, no physics: a clean run of
 *    `RACE_LAPS` laps counts them all; a lap that leaves the track area over a checkpoint's window does
 *    not count and is begun again; backing over the line after it undoes the lap; the
 *    grid's first crossing only starts lap 1; a car relocated back onto the lap (the
 *    return key, a rival's recovery) keeps its laps and crosses nothing. The player's
 *    outs (race/session.ts): 19 s off the track area is still a race, 21 s is out, and so
 *    is 160 m away.
 *  - THE STAKE (race/stake.ts) on a real `GameWorld`: refused with fewer than three
 *    shells; three taken and recorded, a second take refused; a win pays nine once and a
 *    second settle nothing; third place gets the stake back, fourth nothing; a save
 *    written mid-race (`migrateState` of its JSON) keeps the stake and drops the race's
 *    cars, and the refund gives the same count of shells back once. A save from before
 *    one kind of shell (version 9: a jar by kind, a stake as a list of kinds) loads with
 *    its totals.
 *  - THE FIELD (race/rival.ts): the candidates are the nearest by power to weight, a plan
 *    is a pure function of the seed, post and round, three rivals all at the top skill,
 *    as many different cars as the candidates allow, about a third of the rounds are
 *    trailer races.
 *  - THE SKILLS: the frantic racer alone in the player's car at skill 0, 0.5 and 1 (grip
 *    share and pace, race/rival.ts `driverFor`), one flying lap after a standing one: the
 *    lap times must come out in that order.
 *  - WHOLE RACES: on the first `races` tracks of the seed, FOUR cars from the grid: a
 *    stand-in for the player (the starting car, the frantic racer at skill 0.6) in the
 *    back box and the field drawn for round 0 in front of it, held through the lights,
 *    `RACE_LAPS` laps on the real collider with the chicanes' rock and log and the gates'
 *    posts (tools/racelapworld.ts), every car's laps counted by `RaceSession`, the rivals'
 *    recoveries as the director does them (race/recovery.ts; a put-back car is a ghost
 *    to the other racers for 3 s) and their wheel loop at the traffic's rate as the
 *    director runs it. The second race is run as a trailer race, every car towing the
 *    same load. The race is over the step the stand-in takes the flag (no waiting: a
 *    rival still running then has a projected time); the bench drives the rest on to
 *    their own flag, and every car must take it. The stake is taken before and settled
 *    for the stand-in's place after, and the jar must show it. The order, the times, the
 *    recoveries, and the cost of a step of four drivers are printed.
 */

import * as THREE from 'three';
import { emptyInput, type InputFrame } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { credit } from '../src/economy/economy';
import { createServiceableCarState } from '../src/game/spawn';
import { GameWorld, newWorldState, type TrailerState } from '../src/game/state';
import { carModelMeasure, carSpawnYAboveGround, preloadCarModels } from '../src/render/carmodel';
import { preloadTrailerModel } from '../src/render/trailermodel';
import { PLAYER_SLOT } from '../src/race/director';
import { raceRivalId, raceTrailerId } from '../src/race/ids';
import { LapCounter } from '../src/race/laps';
import { recoverAt, RecoveryWatch } from '../src/race/recovery';
import { carClassOf, classDistance, driverFor, fieldPlan, FIELD_SIZE, modelClassOf, nearestModels, RIVAL_SKILL } from '../src/race/rival';
import { AWAY_FORFEIT_M, RACE_LAPS, RaceSession } from '../src/race/session';
import { canStake, RACE_PRIZES, RACE_STAKE, racePrize, refundStake, settleStake, takeStake } from '../src/race/stake';
import { migrateState } from '../src/save/save';
import { Autopilot } from '../src/vehicle/autopilot';
import { CAR_MODELS, carModel, DEFAULT_CAR_MODEL_ID } from '../src/vehicle/carmodels';
import { Trailer, TRAILER_MODEL_FIT, TRAILER_SPAWN_HEIGHT } from '../src/vehicle/trailer';
import { Vehicle } from '../src/vehicle/vehicle';
import { TRAFFIC_WHEEL_SUBSTEPS } from '../src/vehicle/vehicletuning';
import { WorldOrigin } from '../src/world/origin';
import { TRACK_LIFT_M } from '../src/world/racetrack/mesh';
import { postHasTrack } from '../src/world/racetrack/site';
import type { RaceTrack, TrackPose } from '../src/world/racetrack/track';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { buildLapGround } from './racelapworld';

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

const RACES = Math.max(1, Number(process.argv[2] ?? 3));
const SEED = Number(process.argv[3] ?? 1337);
/** The player's stand-in: the starting car, the frantic racer at this skill. */
const PLAYER_MODEL = DEFAULT_CAR_MODEL_ID;
const PLAYER_SKILL = 0.6;
/** The whole race may take this long, simulated seconds. */
const RACE_LIMIT_S = 900;
const TRAILER_KG = 250;
/** The director's ghost rules (race/director.ts). */
const GHOST_S = 3;
const GHOST_CLEAR_M = 5;
const GHOST_MAX_S = 10;
const RACER_BIT = 0x0004;
const RACER_GROUPS = (RACER_BIT << 16) | 0xffff;
const GHOST_GROUPS = (RACER_BIT << 16) | (0xffff & ~RACER_BIT);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`);
}

const road = new Road(SEED);
void road.spine;
const terrain = new Terrain(SEED, road);
const tracks: RaceTrack[] = [];
for (let post = 0; post < 120 && tracks.length < Math.max(RACES, 1); post++) {
  if (!postHasTrack(SEED, post)) continue;
  const track = terrain.raceTracks.track(post);
  if (track) tracks.push(track);
}
console.log(`seed ${SEED}: ${tracks.length} tracks (${tracks.map((t) => `${t.id} ${t.lengthM.toFixed(0)} m`).join(', ')})`);

// ---------------------------------------------------------------------------
// Laps, on the centreline.
// ---------------------------------------------------------------------------
console.log('\nlaps (race/laps.ts), driven along the centreline in 4 m steps');
{
  const track = tracks[0]!;
  const point = { x: 0, y: 0, z: 0 };
  const grid = track.startGrid[PLAYER_SLOT]!;
  const drive = (counter: LapCounter, fromS: number, toS: number, lateral: (s: number) => number): number => {
    let counted = 0;
    for (let s = fromS; s <= toS; s += 4) {
      track.offsetPoint(s, lateral(s), point);
      counted += counter.update(0.1, point.x, point.z);
    }
    return counted;
  };
  // The grid stands short of the line at `grid.s`, near the END of the lap's arclength:
  // the first crossing (at `lengthM`) starts lap 1, each one after it ends a lap.
  const L = track.lengthM;
  const clean = new LapCounter(track);
  clean.reset(grid.x, grid.z);
  const cleanCounted = drive(clean, grid.s, L * (RACE_LAPS + 1) + 10, () => grid.lateral);
  check(`${RACE_LAPS} clean laps count ${RACE_LAPS}`, clean.completed === RACE_LAPS && cleanCounted === RACE_LAPS, `${clean.completed} completed (${cleanCounted} counted), lap ${clean.lap}`);

  // Out wide (past the run-off) over the whole window of the third checkpoint, on lap 1.
  const cut = new LapCounter(track);
  cut.reset(grid.x, grid.z);
  const third = track.checkpoints[2]!;
  const wide = track.halfWidth + track.runoffM + 15;
  drive(cut, grid.s, 2 * L + 10, (s) => {
    const at = track.wrap(s);
    return at > third - 10 && at < third + 50 ? wide : 0;
  });
  check('a lap off the track over a checkpoint does not count', cut.completed === 0 && cut.lap === 1, `${cut.completed} completed, on lap ${cut.lap}, next checkpoint ${cut.next}`);
  drive(cut, 2 * L + 10, 3 * L + 10, () => 0);
  check('...and the next clean one does', cut.completed === 1, `${cut.completed} completed after one more clean lap`);

  // Over the line, then back over it: the lap is undone; forward again counts it again.
  const back = new LapCounter(track);
  back.reset(grid.x, grid.z);
  drive(back, grid.s, 2 * L + 20, () => 0);
  const afterLap = back.completed;
  let undone = 0;
  for (let s = 20; s >= -20; s -= 4) {
    track.offsetPoint(s, 0, point);
    undone += back.update(0.1, point.x, point.z);
  }
  const afterBack = back.completed;
  drive(back, -20, 20, () => 0);
  check(
    'backing over the line undoes the lap, crossing again restores it',
    afterLap === 1 && afterBack === 0 && undone === -1 && back.completed === 1,
    `${afterLap} → ${afterBack} (undone ${undone}) → ${back.completed}`,
  );
  const grid1 = new LapCounter(track);
  grid1.reset(grid.x, grid.z);
  drive(grid1, grid.s, L + 30, () => 0);
  check('the first crossing from the grid starts lap 1 and counts nothing', grid1.lap === 1 && grid1.completed === 0, `lap ${grid1.lap}, ${grid1.completed} completed`);

  // Relocated back to its last checkpoint from far off the lap, mid-lap: nothing crossed, laps kept, the lap still counts.
  const moved = new LapCounter(track);
  moved.reset(grid.x, grid.z);
  const fourth = track.checkpoints[3]!;
  drive(moved, grid.s, L + fourth + 60, () => 0);
  const lapBefore = moved.lap;
  const nextBefore = moved.next;
  track.offsetPoint(fourth + 2, 0, point);
  moved.relocate(point.x, point.z, fourth + 2);
  const relocatedCounted = drive(moved, L + fourth + 2, 2 * L + 10, () => 0);
  check(
    'a car put back at its last checkpoint keeps its lap and the lap counts',
    moved.lap === lapBefore + 1 && nextBefore === 4 && relocatedCounted === 1,
    `lap ${lapBefore} (next ${nextBefore}) → ${moved.lap}, counted ${relocatedCounted}`,
  );

  // The outs: off the track area too long, and too far away. The rival stands still.
  const out = (lateral: number, seconds: number): RaceSession => {
    const session = new RaceSession(track, 2);
    const rival = track.startGrid[0]!;
    const xs = new Float64Array([grid.x, rival.x]);
    const zs = new Float64Array([grid.z, rival.z]);
    session.start(xs, zs);
    for (let t = 0; t < 3.1; t += 0.1) session.step(0.1, xs, zs);
    for (let s = grid.s, t = 0; t < 4; t += 0.1, s += 2) {
      track.offsetPoint(s, 0, point);
      xs[0] = point.x;
      zs[0] = point.z;
      session.step(0.1, xs, zs);
    }
    const at = track.wrap(grid.s + 80);
    for (let t = 0; t < seconds && session.end === null; t += 0.1) {
      track.offsetPoint(at, lateral, point);
      xs[0] = point.x;
      zs[0] = point.z;
      session.step(0.1, xs, zs);
    }
    return session;
  };
  // Outward, away from the infield (`turn` is the infield's side), so no other leg is nearer.
  const offRunoff = -track.turn * (track.halfWidth + track.runoffM + 5);
  const nineteen = out(offRunoff, 19);
  const twentyOne = out(offRunoff, 21);
  const away = out(-track.turn * (AWAY_FORFEIT_M + 10), 1);
  check(
    'outs: 20 s off the track area, or 150 m away',
    nineteen.end === null && twentyOne.end === 'off-track' && twentyOne.position(0) === 2 && away.end === 'away',
    `19 s off: ${nineteen.end ?? 'racing'}; 21 s off: ${twentyOne.end} (place ${twentyOne.position(0)}); ${AWAY_FORFEIT_M + 10} m out: ${away.end}`,
  );
}

// ---------------------------------------------------------------------------
// The stake.
// ---------------------------------------------------------------------------
console.log('\nthe stake (race/stake.ts)');
{
  const world = new GameWorld(newWorldState(SEED));
  credit(world, 2);
  check('fewer than three shells: no race', !canStake(world) && !takeStake(world, 7, 0) && world.state.raceStake === null, `jar ${world.state.player.shells}`);
  credit(world, 8);
  const before = world.state.player.shells;
  const took = takeStake(world, 7, 0);
  const second = takeStake(world, 7, 0);
  check(
    'the stake is taken once',
    took && !second && world.state.player.shells === before - RACE_STAKE && world.state.raceStake?.shells === RACE_STAKE,
    `jar ${before} → ${world.state.player.shells}, stake ${JSON.stringify(world.state.raceStake)}`,
  );
  const won = settleStake(world, 1);
  const again = settleStake(world, 1);
  check(
    `a win pays ${RACE_PRIZES[0]}, once`,
    won === RACE_PRIZES[0] && again === -1 && world.state.player.shells === before - RACE_STAKE + RACE_PRIZES[0]! && world.state.raceStake === null,
    `paid ${won}, then ${again}; jar ${world.state.player.shells}`,
  );
  const jarThird = world.state.player.shells;
  takeStake(world, 7, 1);
  const third = settleStake(world, 3);
  takeStake(world, 7, 1);
  const fourth = settleStake(world, 4);
  takeStake(world, 7, 1);
  const outPaid = settleStake(world, 0);
  check(
    'third gets the stake back, fourth and out nothing',
    third === RACE_STAKE && fourth === 0 && outPaid === 0 && racePrize(2) === RACE_PRIZES[1] && world.state.player.shells === jarThird - 2 * RACE_STAKE,
    `3rd ${third}, 4th ${fourth}, out ${outPaid}; jar ${jarThird} → ${world.state.player.shells}`,
  );

  // A save mid-race: two rivals and their trailers in state, the stake out.
  const jar = world.state.player.shells;
  takeStake(world, 7, 2);
  const rivalIds = [raceRivalId(7, 0), raceRivalId(7, 1)];
  for (const id of rivalIds) world.apply({ t: 'car_add', car: createServiceableCarState(id, PLAYER_MODEL, 0, 1, 0, 0) });
  const trailer: TrailerState = { id: raceTrailerId(7, 1), hitchedTo: rivalIds[1]!, cargoKg: 200, x: 0, y: 1, z: -4, qx: 0, qy: 0, qz: 0, qw: 1 };
  world.apply({ t: 'trailer_add', trailer });
  const loaded = new GameWorld(migrateState(JSON.parse(JSON.stringify(world.state))));
  check(
    'a save mid-race keeps the stake and drops the race',
    loaded.state.raceStake !== null && rivalIds.every((id) => loaded.state.cars[id] === undefined) && loaded.state.trailers[trailer.id] === undefined,
    `stake ${JSON.stringify(loaded.state.raceStake)}, rivals ${rivalIds.some((id) => loaded.state.cars[id]) ? 'kept' : 'dropped'}, trailer ${loaded.state.trailers[trailer.id] ? 'kept' : 'dropped'}`,
  );
  const back = refundStake(loaded);
  const twice = refundStake(loaded);
  check('...and the load refunds the same shells, once', back === RACE_STAKE && twice === -1 && loaded.state.player.shells === jar && loaded.state.raceStake === null, `refunded ${back}, then ${twice}; jar back to ${loaded.state.player.shells}`);

  // A save from before one kind of shell (version 9): its jar by kind and its stake as a
  // list of kinds load as their totals, nothing lost.
  const old = JSON.parse(JSON.stringify(newWorldState(SEED)));
  old.saveVersion = 9;
  old.player.shells = { scallop: 4, spiral: 7, horn: 2, cowrie: 5 };
  old.player.shellMint = 31;
  old.raceStake = { postIndex: 7, round: 2, shells: ['horn', 'scallop', 'cowrie'] };
  const migrated = migrateState(old);
  check(
    'an old save keeps its shells: 4+7+2+5 = 18 in the jar, a stake of 3',
    migrated.player.shells === 18 && migrated.raceStake?.shells === 3 && !('shellMint' in migrated.player),
    `jar ${JSON.stringify(migrated.player.shells)}, stake ${JSON.stringify(migrated.raceStake)}`,
  );
}

// ---------------------------------------------------------------------------
// The field.
// ---------------------------------------------------------------------------
console.log('\nthe field (race/rival.ts)');
const playerClass = carClassOf(createServiceableCarState('p', PLAYER_MODEL, 0, 0, 0, 0));
{
  const near = nearestModels(playerClass);
  const sorted = [...CAR_MODELS].sort((a, b) => classDistance(modelClassOf(a), playerClass) - classDistance(modelClassOf(b), playerClass));
  check(
    'the nearest classes are the candidates',
    near.every((def, i) => def.id === sorted[i]!.id),
    `${PLAYER_MODEL} (${((playerClass.powerKw * 1000) / playerClass.massKg).toFixed(1)} W/kg): ${near.map((d) => `${d.id} ${((modelClassOf(d).powerKw * 1000) / d.mass).toFixed(1)} W/kg`).join(', ')}`,
  );
  let trailerRounds = 0;
  let allTop = true;
  const rounds = 300;
  let pure = true;
  let shaped = true;
  let distinct = 0;
  for (let round = 0; round < rounds; round++) {
    const plan = fieldPlan(SEED, 9, round, playerClass);
    const again = fieldPlan(SEED, 9, round, playerClass);
    pure &&= JSON.stringify(plan) === JSON.stringify(again);
    shaped &&= plan.rivals.length === FIELD_SIZE;
    allTop &&= plan.rivals.every((r) => r.skill === RIVAL_SKILL && r.gripShare === 1 && r.pace === 1);
    distinct += new Set(plan.rivals.map((r) => r.modelId)).size;
    if (plan.trailer) trailerRounds++;
  }
  check(
    `plans are seeded, ${FIELD_SIZE} rivals all at the top skill, about a third trailer races`,
    pure && shaped && allTop && trailerRounds > rounds * 0.25 && trailerRounds < rounds * 0.42,
    `${trailerRounds} of ${rounds} trailer rounds`,
  );
  check(
    'a field is as varied as the candidates allow',
    distinct / rounds >= Math.min(FIELD_SIZE, near.length) - 0.01,
    `${(distinct / rounds).toFixed(2)} different cars per field of ${FIELD_SIZE} (${near.length} candidates)`,
  );
}

// ---------------------------------------------------------------------------
// Racing in the physics.
// ---------------------------------------------------------------------------
const plans = tracks.slice(0, RACES).map((track, i) => {
  const plan = fieldPlan(SEED, track.postIndex, 0, playerClass);
  return { track, plan: i === 1 ? { ...plan, trailer: true } : plan };
});
const modelIds = new Set<string>([PLAYER_MODEL]);
for (const { plan } of plans) for (const rival of plan.rivals) modelIds.add(rival.modelId);
await Promise.all([preloadCarModels([...modelIds]), preloadTrailerModel(TRAILER_MODEL_FIT)]);

/** A car standing still on the track at `s`, `lateral`, facing the lap: the director's `standOnTrack`, headless. */
function standOnTrack(car: Vehicle, modelId: string, track: RaceTrack, s: number, lateral: number, point: { x: number; y: number; z: number }): void {
  track.offsetPoint(s, lateral, point);
  const sample = track.road.sampleAt(s);
  const y = carSpawnYAboveGround(carModelMeasure(modelId), track.surfaceY(s, lateral) + TRACK_LIFT_M);
  car.rescueTo(point.x, y, point.z, sample.heading, sample.grade);
}

function setGroups(car: Vehicle, groups: number): void {
  for (const collider of car.collisionColliders) collider.setCollisionGroups(groups);
}

function upOf(car: Vehicle): number {
  const q = car.chassis.rotation();
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

// ---------------------------------------------------------------------------
// The skills: the racer alone, in the player's car.
// ---------------------------------------------------------------------------
console.log(`\nthe skills alone in ${PLAYER_MODEL} (standing lap / flying lap, s)`);
const skillTimes: Record<string, number[]> = { '0': [], '0.5': [], '1': [] };
for (const { track } of plans) {
  const row: string[] = [];
  for (const skill of [0, 0.5, 1]) {
    const physics = await PhysicsWorld.create();
    const origin = new WorldOrigin();
    const slot = track.startGrid[0]!;
    origin.reset(slot.x, slot.z);
    buildLapGround(physics, origin, track);
    const world = new GameWorld(newWorldState(SEED));
    const state = createServiceableCarState('solo', PLAYER_MODEL, slot.x, slot.y + 1.2, slot.z, slot.heading);
    world.state.cars[state.id] = state;
    const car = new Vehicle(physics, world, state, new THREE.Scene(), origin);
    const driver = driverFor(PLAYER_MODEL, skill);
    const pilot = new Autopilot(track.road, physics);
    pilot.setMode('frantic');
    pilot.setGripShare(driver.gripShare);
    pilot.setPace(driver.pace);
    const input = emptyInput();
    const settle = emptyInput();
    settle.handbrake = true;
    for (let i = 0; i < 120; i++) {
      car.fixedUpdate(FIXED_DT, settle);
      physics.step();
      car.postStep();
    }
    pilot.setEngaged(true);
    const counter = new LapCounter(track);
    const at = { x: 0, y: 0, z: 0 };
    car.absoluteTranslation(at);
    counter.reset(at.x, at.z);
    const times: number[] = [];
    let t = 0;
    let lapStart = 0;
    while (times.length < 2 && t < (2 * RACE_LIMIT_S) / RACE_LAPS) {
      pilot.drive(FIXED_DT, car, input, origin.x, origin.z);
      car.fixedUpdate(FIXED_DT, input);
      physics.step();
      car.postStep();
      t += FIXED_DT;
      car.absoluteTranslation(at);
      if (counter.update(FIXED_DT, at.x, at.z) === 1) {
        times.push(t - lapStart);
        lapStart = t;
      }
    }
    car.dispose();
    row.push(`skill ${skill} ${times.map((x) => x.toFixed(1)).join(' / ') || '—'}`);
    if (times.length === 2) skillTimes[String(skill)]!.push(times[1]!);
  }
  console.log(`  ${track.id} ${track.lengthM.toFixed(0)} m: ${row.join(';  ')}`);
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
check(
  'the skills are in order (flying laps)',
  skillTimes['0']!.length === plans.length && mean(skillTimes['0']!) > mean(skillTimes['0.5']!) * 1.01 && mean(skillTimes['0.5']!) > mean(skillTimes['1']!) * 1.01,
  `mean flying lap skill 0 ${mean(skillTimes['0']!).toFixed(1)} s, 0.5 ${mean(skillTimes['0.5']!).toFixed(1)} s, 1 ${mean(skillTimes['1']!).toFixed(1)} s`,
);

// ---------------------------------------------------------------------------
// Whole races: four cars.
// ---------------------------------------------------------------------------
console.log(`\nwhole races (${RACE_LAPS} laps, ${FIELD_SIZE + 1} cars; player stand-in ${PLAYER_MODEL} at skill ${PLAYER_SKILL} in the back box)`);

interface Racer {
  readonly name: string;
  readonly modelId: string;
  readonly car: Vehicle;
  readonly pilot: Autopilot;
  readonly input: InputFrame;
  readonly slot: TrackPose;
  readonly watch: RecoveryWatch;
  ghostS: number;
  ghostFor: number;
  recoveries: number;
}

for (const [raceIndex, { track, plan }] of plans.entries()) {
  // The first race knocks two rivals out of it on purpose: rival 1 thrown 12 m out into
  // the sand at 40 s, rival 2 put on its roof at 80 s. Both must come back and finish.
  const shove = raceIndex === 0;
  let shoved = false;
  let flipped = false;
  const physics = await PhysicsWorld.create();
  const origin = new WorldOrigin();
  origin.reset(track.startGrid[0]!.x, track.startGrid[0]!.z);
  buildLapGround(physics, origin, track);
  const world = new GameWorld(newWorldState(SEED));
  const scene = new THREE.Scene();
  credit(world, 10);
  const jarBefore = world.state.player.shells;
  const drivers = [driverFor(PLAYER_MODEL, PLAYER_SKILL), ...plan.rivals];
  const racers: Racer[] = drivers.map((driver, i) => {
    const slot = track.startGrid[i === 0 ? PLAYER_SLOT : i - 1]!;
    const id = i === 0 ? 'player' : raceRivalId(track.postIndex, i - 1);
    const state = createServiceableCarState(id, driver.modelId, slot.x, slot.y + 1.2, slot.z, slot.heading);
    world.state.cars[id] = state;
    const car = new Vehicle(physics, world, state, scene, origin);
    // The rivals' wheel loop at the traffic's rate, as the director runs it.
    if (i > 0) car.setWheelSubsteps(TRAFFIC_WHEEL_SUBSTEPS);
    setGroups(car, RACER_GROUPS);
    const pilot = new Autopilot(track.road, physics);
    pilot.setMode('frantic');
    pilot.setGripShare(driver.gripShare);
    pilot.setPace(driver.pace);
    return {
      name: i === 0 ? 'PLAYER' : driver.modelId,
      modelId: driver.modelId,
      car,
      pilot,
      input: emptyInput(),
      slot,
      watch: new RecoveryWatch(),
      ghostS: 0,
      ghostFor: 0,
      recoveries: 0,
    };
  });
  const trailers: Trailer[] = [];
  const settle = emptyInput();
  settle.handbrake = true;
  for (let i = 0; i < 120; i++) {
    for (const r of racers) r.car.fixedUpdate(FIXED_DT, settle);
    physics.step();
    for (const r of racers) r.car.postStep();
  }
  if (plan.trailer) {
    racers.forEach((r, i) => {
      const at = r.car.chassis.translation();
      const state: TrailerState = {
        id: raceTrailerId(track.postIndex, i === 0 ? 'player' : i - 1),
        hitchedTo: null,
        cargoKg: TRAILER_KG,
        cargoZ: 1,
        x: at.x + origin.x,
        y: at.y + TRAILER_SPAWN_HEIGHT,
        z: at.z + origin.z,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
      };
      world.state.trailers[state.id] = state;
      const trailer = new Trailer(physics, world, state, scene, origin);
      trailer.hitchTo(r.car, i === 0 ? 'player' : raceRivalId(track.postIndex, i - 1));
      trailers.push(trailer);
    });
  }
  const staked = takeStake(world, track.postIndex, 0);
  const jarStaked = world.state.player.shells;

  const session = new RaceSession(track, racers.length);
  const xs = new Float64Array(racers.length);
  const zs = new Float64Array(racers.length);
  const p = { x: 0, y: 0, z: 0 };
  const point = { x: 0, y: 0, z: 0 };
  const back = { s: 0, lateral: 0 };
  const positions = (): void => {
    racers.forEach((r, i) => {
      r.car.absoluteTranslation(p);
      xs[i] = p.x;
      zs[i] = p.z;
    });
  };
  positions();
  session.start(xs, zs);
  let lightsSeen = '';
  let movedInCountdown = 0;
  let driveMs = 0;
  let driveSteps = 0;
  let worstStepMs = 0;
  const started = performance.now();
  // The race is over the step the stand-in is done; the rivals still running are driven
  // on to their own flag (`flagAt`), which the game does not wait for.
  const flagAt = new Float64Array(racers.length).fill(Number.NaN);
  let overAt = Number.NaN;
  let projectedAtOver = '';
  const home = (i: number): boolean => !Number.isNaN(flagAt[i]!);
  // Every car's laps, in the race and on the run-on, from the green.
  const lapList: number[][] = racers.map(() => []);
  const lapAt = new Float64Array(racers.length);
  let runOnS = 0;
  while (!racers.every((_, i) => home(i)) && session.clock + runOnS < RACE_LIMIT_S) {
    const t0 = performance.now();
    racers.forEach((r, i) => {
      if (session.held) {
        r.car.fixedUpdate(FIXED_DT, settle);
        return;
      }
      if (!r.pilot.engaged) r.pilot.setEngaged(true);
      if (home(i) && r.pilot.mode !== 'sleeper') {
        // Home: the cool-down lap, a ghost to the cars still racing (the director's way).
        r.pilot.setMode('sleeper');
        r.pilot.setGripShare(1);
        r.pilot.setPace(0.6);
        r.pilot.setEngaged(true);
        setGroups(r.car, GHOST_GROUPS);
      }
      r.pilot.drive(FIXED_DT, r.car, r.input, origin.x, origin.z);
      r.car.fixedUpdate(FIXED_DT, r.input);
    });
    const stepMs = performance.now() - t0;
    if (!session.held) {
      driveMs += stepMs;
      driveSteps++;
      worstStepMs = Math.max(worstStepMs, stepMs);
    }
    for (const trailer of trailers) trailer.fixedUpdate(FIXED_DT);
    physics.step();
    for (const r of racers) r.car.postStep();
    for (const trailer of trailers) trailer.postStep();
    positions();
    const lights = String(session.lights);
    if (!lightsSeen.endsWith(lights)) lightsSeen += lights;
    if (session.held) for (const r of racers) movedInCountdown = Math.max(movedInCountdown, r.car.speedKmh);
    if (session.phase !== 'finished') {
      if (session.step(FIXED_DT, xs, zs)) {
        overAt = session.raceTime;
        projectedAtOver = session
          .standings()
          .filter((i) => !session.finished(i))
          .map((i) => `${racers[i]!.name} ~${session.projectedTime(i).toFixed(1)} s`)
          .join(', ');
        // The stand-in is done, finished or out: nothing more to wait for from it.
        if (!session.finished(0)) flagAt[0] = Number.POSITIVE_INFINITY;
      }
      racers.forEach((_, i) => {
        if (!home(i) && session.finished(i)) flagAt[i] = session.finishTimes[i]!;
      });
    } else {
      // Run on: the cars still out counted to their own flag on the session's counters.
      runOnS += FIXED_DT;
      racers.forEach((_, i) => {
        if (home(i)) return;
        const counter = session.counters[i]!;
        counter.update(FIXED_DT, xs[i]!, zs[i]!);
        if (counter.completed >= RACE_LAPS) flagAt[i] = overAt + runOnS;
      });
    }
    if (session.held) continue;
    const clock = session.raceTime + runOnS;
    racers.forEach((_, i) => {
      const done = session.counters[i]!.completed;
      if (done <= lapList[i]!.length || done > RACE_LAPS) return;
      lapList[i]!.push(clock - lapAt[i]!);
      lapAt[i] = clock;
    });
    if (shove && !shoved && session.raceTime > 40) {
      shoved = true;
      const c = session.counters[1]!;
      standOnTrack(racers[1]!.car, racers[1]!.modelId, track, c.s, -track.turn * (track.halfWidth + 12), point);
    }
    if (shove && !flipped && session.raceTime > 80) {
      flipped = true;
      racers[2]!.car.flipOver();
    }
    // Recoveries and ghosts, as the director has them (the bench has no camera: no wait for the view).
    racers.forEach((r, i) => {
      if (home(i)) return;
      if (r.ghostS > 0) {
        r.ghostFor += FIXED_DT;
        r.ghostS -= FIXED_DT;
        const crowded = racers.some((o, j) => j !== i && Math.hypot(xs[j]! - xs[i]!, zs[j]! - zs[i]!) < GHOST_CLEAR_M);
        if (r.ghostS <= 0 && crowded && r.ghostFor < GHOST_MAX_S) r.ghostS = FIXED_DT;
        else if (r.ghostS <= 0) setGroups(r.car, RACER_GROUPS);
      }
      const counter = session.counters[i]!;
      if (!r.watch.step(FIXED_DT, counter, upOf(r.car))) return;
      recoverAt(track, counter, r.slot, back);
      standOnTrack(r.car, r.modelId, track, back.s, back.lateral, point);
      session.relocate(i, point.x, point.z, back.s);
      setGroups(r.car, GHOST_GROUPS);
      r.ghostS = GHOST_S;
      r.ghostFor = 0;
      r.watch.reset();
      r.pilot.setEngaged(true);
      r.recoveries++;
    });
  }
  const place = session.position(0);
  const paid = settleStake(world, session.end === 'laps' ? place : 0);
  const jarAfter = world.state.player.shells;
  const wall = ((performance.now() - started) / 1000).toFixed(0);
  const allHome = racers.every((_, i) => Number.isFinite(flagAt[i]!));
  const laps = (i: number): string => lapList[i]!.map((t) => t.toFixed(1)).join(' / ') || '—';
  console.log(
    `  ${track.id} ${track.lengthM.toFixed(0)} m${plan.trailer ? `, TRAILERS ${TRAILER_KG} kg` : ''}: over at ${overAt.toFixed(1)} s, the stand-in ${session.end}; ` +
      `run on to ${(overAt + runOnS).toFixed(1)} s (${wall} s wall); ` +
      `${racers.length} drivers + cars ${(driveMs / Math.max(1, driveSteps)).toFixed(2)} ms a step (worst ${worstStepMs.toFixed(1)} ms)`,
  );
  console.log(`      results at the flag: ${projectedAtOver ? `still running ${projectedAtOver}` : 'everybody in'}`);
  for (const i of session.standings()) {
    const r = racers[i]!;
    const flag = flagAt[i]!;
    console.log(
      `      ${session.position(i)}. ${r.name.padEnd(16)} ${Number.isFinite(flag) ? flag.toFixed(1).padStart(6) : '   DNF'} s  laps ${laps(i)}  best ${Math.min(...lapList[i]!).toFixed(1)}  recoveries ${r.recoveries}  (${carModel(r.modelId).label})`,
    );
  }
  check(
    `${track.id}: lights red, red, red, green, everybody held`,
    lightsSeen.startsWith('1234') && movedInCountdown < 3,
    `lights ${lightsSeen}, fastest in the countdown ${movedInCountdown.toFixed(1)} km/h`,
  );
  check(
    `${track.id}: the results are up the step the stand-in is done`,
    session.phase === 'finished' && (session.end !== 'laps' || overAt === session.finishTimes[0]) && !projectedAtOver.includes('NaN'),
    `over at ${overAt.toFixed(1)} s, stand-in ${session.end} at ${session.finishTimes[0]!.toFixed(1)} s`,
  );
  check(`${track.id}: every car of the four takes the flag`, allHome, `${racers.filter((_, i) => Number.isFinite(flagAt[i]!)).length} of ${racers.length} home`);
  if (shove) {
    check(
      `${track.id}: a rival thrown off and one on its roof are put back and finish`,
      racers[1]!.recoveries >= 1 && racers[2]!.recoveries >= 1 && Number.isFinite(flagAt[1]!) && Number.isFinite(flagAt[2]!),
      `thrown: ${racers[1]!.recoveries} recoveries, ${Number.isFinite(flagAt[1]!) ? 'home' : 'not home'}; roof: ${racers[2]!.recoveries} recoveries, ${Number.isFinite(flagAt[2]!) ? 'home' : 'not home'}`,
    );
  }
  check(
    `${track.id}: the stake and the prize for place ${place}`,
    staked && jarStaked === jarBefore - RACE_STAKE && paid === racePrize(place) && jarAfter === jarStaked + racePrize(place) && world.state.raceStake === null,
    `jar ${jarBefore} → ${jarStaked} staked → ${jarAfter} (place ${place}, paid ${paid})`,
  );
  for (const trailer of trailers) trailer.dispose();
  for (const r of racers) r.car.dispose();
}

console.log(failures === 0 ? '\nall race checks passed' : `\n${failures} race check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
