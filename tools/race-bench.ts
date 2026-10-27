/**
 * The races at the tracks (race/): do the rules count laps right, does the money move
 * right, and does a whole race between two real cars come out?
 *
 *   nice -n 15 bun tools/race-bench.ts [races = 3] [seed = 1337]
 *
 * Checked, not just printed:
 *
 *  - LAPS (race/laps.ts) on a track's own centreline, no physics: a clean run of three
 *    laps counts three; a lap that leaves the track area over a checkpoint's window does
 *    not count and is begun again; backing over the line after it undoes the lap; the
 *    grid's first crossing only starts lap 1. The forfeits (race/session.ts): 9 s off the
 *    track area is still a race, 11 s is lost, and so is 160 m away.
 *  - THE STAKE (race/stake.ts) on a real `GameWorld`: refused with fewer than three
 *    shells; three taken and recorded, a second take refused; a win pays six once and a
 *    second settle nothing; a save written mid-race (`migrateState` of its JSON) keeps the
 *    stake and drops the race's cars, and the refund gives the same shells back once.
 *  - THE RIVAL (race/rival.ts): the matched class is the nearest by power to weight, the
 *    plan is a pure function of the seed, post and round, about a third of the rounds are
 *    trailer races.
 *  - WHOLE RACES: on the first `races` tracks of the seed, a stand-in for the player (the
 *    starting car, the `frantic` driver at 0.85 pace) races the rival drawn for round 0
 *    (its own level) from the grid, held through the lights, three laps on the real
 *    collider (tools/racelapworld.ts), both cars' laps counted by `RaceSession`; the
 *    second race is run as a trailer race whatever its round says, both cars towing the
 *    same loaded trailer. The stake is taken before and settled after, and the jar must
 *    show it. Lap times, the winner and the money are printed.
 */

import * as THREE from 'three';
import { emptyInput } from '../src/core/input';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { credit } from '../src/economy/economy';
import { purseTotal } from '../src/economy/shells';
import { createServiceableCarState } from '../src/game/spawn';
import { GameWorld, newWorldState, type TrailerState } from '../src/game/state';
import { preloadCarModels } from '../src/render/carmodel';
import { preloadTrailerModel } from '../src/render/trailermodel';
import { raceRivalId, raceTrailerId } from '../src/race/ids';
import { LapCounter } from '../src/race/laps';
import { carClassOf, classDistance, modelClassOf, nearestModels, RIVAL_MODES, rivalPlan } from '../src/race/rival';
import { AWAY_FORFEIT_M, RACE_LAPS, RaceSession } from '../src/race/session';
import { canStake, RACE_PRIZE, RACE_STAKE, refundStake, settleStake, takeStake } from '../src/race/stake';
import { migrateState } from '../src/save/save';
import { Autopilot } from '../src/vehicle/autopilot';
import { CAR_MODELS, DEFAULT_CAR_MODEL_ID } from '../src/vehicle/carmodels';
import { Trailer, TRAILER_MODEL_FIT, TRAILER_SPAWN_HEIGHT } from '../src/vehicle/trailer';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';
import { postHasTrack } from '../src/world/racetrack/site';
import type { RaceTrack } from '../src/world/racetrack/track';
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
/** The player's stand-in: the starting car, a racing driver a little off the pace. */
const PLAYER_MODEL = DEFAULT_CAR_MODEL_ID;
const PLAYER_PACE = 0.85;
/** The whole race may take this long, simulated seconds. */
const RACE_LIMIT_S = 900;
const TRAILER_KG = 250;

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
  const grid = track.startGrid[1];
  const drive = (counter: LapCounter, fromS: number, toS: number, lateral: (s: number) => number): number => {
    let counted = 0;
    for (let s = fromS; s <= toS; s += 4) {
      track.offsetPoint(s, lateral(s), point);
      counted += counter.update(0.1, point.x, point.z);
    }
    return counted;
  };
  // The grid stands 14 m short of the line at `grid.s`, near the END of the lap's arclength:
  // the first crossing (at `lengthM`) starts lap 1, each one after it ends a lap.
  const L = track.lengthM;
  const clean = new LapCounter(track);
  clean.reset(grid.x, grid.z);
  const cleanCounted = drive(clean, grid.s, L * (RACE_LAPS + 1) + 10, () => grid.lateral);
  check('three clean laps count three', clean.completed === RACE_LAPS && cleanCounted === RACE_LAPS, `${clean.completed} completed (${cleanCounted} counted), lap ${clean.lap}`);

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

  // The forfeits: off the track area too long, and too far away. The rival stands still.
  const forfeit = (lateral: number, seconds: number): RaceSession => {
    const session = new RaceSession(track);
    const rival = track.startGrid[0];
    session.start(grid.x, grid.z, rival.x, rival.z);
    for (let t = 0; t < 3.1; t += 0.1) session.step(0.1, grid.x, grid.z, rival.x, rival.z);
    for (let s = grid.s, t = 0; t < 4; t += 0.1, s += 2) {
      track.offsetPoint(s, 0, point);
      session.step(0.1, point.x, point.z, rival.x, rival.z);
    }
    const at = track.wrap(grid.s + 80);
    for (let t = 0; t < seconds && session.phase !== 'finished'; t += 0.1) {
      track.offsetPoint(at, lateral, point);
      session.step(0.1, point.x, point.z, rival.x, rival.z);
    }
    return session;
  };
  // Outward, away from the infield (`turn` is the infield's side), so no other leg is nearer.
  const offRunoff = -track.turn * (track.halfWidth + track.runoffM + 5);
  const nine = forfeit(offRunoff, 9);
  const eleven = forfeit(offRunoff, 11);
  const away = forfeit(-track.turn * (AWAY_FORFEIT_M + 10), 1);
  check(
    'forfeits: 10 s off the track area, or 150 m away',
    nine.phase === 'racing' && eleven.winner === 'rival' && eleven.end === 'off-track' && away.winner === 'rival' && away.end === 'away',
    `9 s off: ${nine.phase}; 11 s off: ${eleven.winner} by ${eleven.end}; ${AWAY_FORFEIT_M + 10} m out: ${away.winner} by ${away.end}`,
  );
}

// ---------------------------------------------------------------------------
// The stake.
// ---------------------------------------------------------------------------
console.log('\nthe stake (race/stake.ts)');
{
  const world = new GameWorld(newWorldState(SEED));
  credit(world, 2);
  check('fewer than three shells: no race', !canStake(world) && !takeStake(world, 7, 0) && world.state.raceStake === null, `jar ${purseTotal(world.state.player.shells)}`);
  credit(world, 8);
  const before = purseTotal(world.state.player.shells);
  const took = takeStake(world, 7, 0);
  const second = takeStake(world, 7, 0);
  check(
    'the stake is taken once',
    took && !second && purseTotal(world.state.player.shells) === before - RACE_STAKE && world.state.raceStake?.shells.length === RACE_STAKE,
    `jar ${before} → ${purseTotal(world.state.player.shells)}, stake ${JSON.stringify(world.state.raceStake)}`,
  );
  const won = settleStake(world, true);
  const again = settleStake(world, true);
  check(
    'a win pays six, once',
    won === RACE_PRIZE && again === -1 && purseTotal(world.state.player.shells) === before - RACE_STAKE + RACE_PRIZE && world.state.raceStake === null,
    `paid ${won}, then ${again}; jar ${purseTotal(world.state.player.shells)}`,
  );
  takeStake(world, 7, 1);
  const lost = settleStake(world, false);
  check('a loss pays nothing more', lost === 0 && world.state.raceStake === null, `jar ${purseTotal(world.state.player.shells)}`);

  // A save mid-race: the rival and both trailers in state, the stake out.
  const jar = { ...world.state.player.shells };
  takeStake(world, 7, 2);
  const rivalId = raceRivalId(7);
  world.apply({ t: 'car_add', car: createServiceableCarState(rivalId, PLAYER_MODEL, 0, 1, 0, 0) });
  const trailer: TrailerState = { id: raceTrailerId(7, 'rival'), hitchedTo: rivalId, cargoKg: 200, x: 0, y: 1, z: -4, qx: 0, qy: 0, qz: 0, qw: 1 };
  world.apply({ t: 'trailer_add', trailer });
  const loaded = new GameWorld(migrateState(JSON.parse(JSON.stringify(world.state))));
  check(
    'a save mid-race keeps the stake and drops the race',
    loaded.state.raceStake !== null && loaded.state.cars[rivalId] === undefined && loaded.state.trailers[trailer.id] === undefined,
    `stake ${JSON.stringify(loaded.state.raceStake)}, rival ${loaded.state.cars[rivalId] ? 'kept' : 'dropped'}, trailer ${loaded.state.trailers[trailer.id] ? 'kept' : 'dropped'}`,
  );
  const back = refundStake(loaded);
  const twice = refundStake(loaded);
  const same = Object.entries(jar).every(([kind, n]) => loaded.state.player.shells[kind as keyof typeof jar] === n);
  check('...and the load refunds the same shells, once', back === RACE_STAKE && twice === -1 && same && loaded.state.raceStake === null, `refunded ${back}, then ${twice}; jar back to ${JSON.stringify(loaded.state.player.shells)}`);
}

// ---------------------------------------------------------------------------
// The rival.
// ---------------------------------------------------------------------------
console.log('\nthe rival (race/rival.ts)');
{
  const playerClass = carClassOf(createServiceableCarState('p', PLAYER_MODEL, 0, 0, 0, 0));
  const near = nearestModels(playerClass);
  const sorted = [...CAR_MODELS].sort((a, b) => classDistance(modelClassOf(a), playerClass) - classDistance(modelClassOf(b), playerClass));
  check(
    'the nearest classes are the candidates',
    near.every((def, i) => def.id === sorted[i]!.id),
    `${PLAYER_MODEL} (${((playerClass.powerKw * 1000) / playerClass.massKg).toFixed(1)} W/kg): ${near.map((d) => `${d.id} ${((modelClassOf(d).powerKw * 1000) / d.mass).toFixed(1)} W/kg`).join(', ')}`,
  );
  let trailerRounds = 0;
  const levels = { steady: 0, fast: 0, wild: 0 };
  const rounds = 300;
  let pure = true;
  for (let round = 0; round < rounds; round++) {
    const plan = rivalPlan(SEED, 9, round, playerClass);
    const again = rivalPlan(SEED, 9, round, playerClass);
    pure &&= plan.modelId === again.modelId && plan.level === again.level && plan.trailer === again.trailer;
    if (plan.trailer) trailerRounds++;
    levels[plan.level]++;
  }
  check(
    'plans are seeded, about a third are trailer races',
    pure && trailerRounds > rounds * 0.25 && trailerRounds < rounds * 0.42,
    `${trailerRounds} of ${rounds} trailer rounds; levels ${JSON.stringify(levels)}`,
  );
}

// ---------------------------------------------------------------------------
// Whole races.
// ---------------------------------------------------------------------------
const modelIds = new Set<string>([PLAYER_MODEL]);
const playerClass = carClassOf(createServiceableCarState('p', PLAYER_MODEL, 0, 0, 0, 0));
const plans = tracks.slice(0, RACES).map((track, i) => {
  const plan = rivalPlan(SEED, track.postIndex, 0, playerClass);
  modelIds.add(plan.modelId);
  return { track, plan: i === 1 ? { ...plan, trailer: true } : plan };
});
await Promise.all([preloadCarModels([...modelIds]), preloadTrailerModel(TRAILER_MODEL_FIT)]);

// ---------------------------------------------------------------------------
// The levels: each driver alone, one flying lap after a standing one, in the player's car.
// ---------------------------------------------------------------------------
console.log(`\nthe levels alone in ${PLAYER_MODEL} (standing lap / flying lap, s)`);
const levelTimes: Record<string, number[]> = { steady: [], fast: [], wild: [] };
for (const { track } of plans) {
  const row: string[] = [];
  for (const level of ['steady', 'fast', 'wild'] as const) {
    const physics = await PhysicsWorld.create();
    const origin = new WorldOrigin();
    const slot = track.startGrid[0];
    origin.reset(slot.x, slot.z);
    buildLapGround(physics, origin, track);
    const world = new GameWorld(newWorldState(SEED));
    const state = createServiceableCarState('solo', PLAYER_MODEL, slot.x, slot.y + 1.2, slot.z, slot.heading);
    world.state.cars[state.id] = state;
    const car = new Vehicle(physics, world, state, new THREE.Scene(), origin);
    const pilot = new Autopilot(track.road, physics);
    pilot.setMode(RIVAL_MODES[level]);
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
    while (times.length < 2 && t < 2 * RACE_LIMIT_S / RACE_LAPS) {
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
    row.push(`${level} ${times.map((x) => x.toFixed(1)).join(' / ') || '—'}`);
    if (times.length === 2) levelTimes[level]!.push(times[1]!);
  }
  console.log(`  ${track.id} ${track.lengthM.toFixed(0)} m: ${row.join(';  ')}`);
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
check(
  'the levels are distinct and in order (flying laps)',
  mean(levelTimes.steady!) > mean(levelTimes.fast!) * 1.02 && mean(levelTimes.fast!) > mean(levelTimes.wild!) * 1.02,
  `mean flying lap steady ${mean(levelTimes.steady!).toFixed(1)} s, fast ${mean(levelTimes.fast!).toFixed(1)} s, wild ${mean(levelTimes.wild!).toFixed(1)} s`,
);
console.log(`\nwhole races (${RACE_LAPS} laps; player stand-in ${PLAYER_MODEL}, frantic at ${PLAYER_PACE})`);

for (const { track, plan } of plans) {
  const physics = await PhysicsWorld.create();
  const origin = new WorldOrigin();
  origin.reset(track.startGrid[0].x, track.startGrid[0].z);
  buildLapGround(physics, origin, track);
  const world = new GameWorld(newWorldState(SEED));
  const scene = new THREE.Scene();
  credit(world, 10);
  const jarBefore = purseTotal(world.state.player.shells);
  const make = (id: string, modelId: string, slot: (typeof track.startGrid)[number]): Vehicle => {
    const state = createServiceableCarState(id, modelId, slot.x, slot.y + 1.2, slot.z, slot.heading);
    world.state.cars[id] = state;
    return new Vehicle(physics, world, state, scene, origin);
  };
  const rivalId = raceRivalId(track.postIndex);
  const player = make('player', PLAYER_MODEL, track.startGrid[1]);
  const rival = make(rivalId, plan.modelId, track.startGrid[0]);
  const cars = [player, rival];
  const trailers: Trailer[] = [];
  const settle = emptyInput();
  settle.handbrake = true;
  for (let i = 0; i < 120; i++) {
    for (const car of cars) car.fixedUpdate(FIXED_DT, settle);
    physics.step();
    for (const car of cars) car.postStep();
  }
  if (plan.trailer) {
    for (const [who, car, carId] of [['player', player, 'player'], ['rival', rival, rivalId]] as const) {
      const at = car.chassis.translation();
      const state: TrailerState = {
        id: raceTrailerId(track.postIndex, who),
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
      trailer.hitchTo(car, carId);
      trailers.push(trailer);
    }
  }
  const staked = takeStake(world, track.postIndex, 0);
  const jarStaked = purseTotal(world.state.player.shells);

  const rivalMode = RIVAL_MODES[plan.level];
  const rivalPilot = new Autopilot(track.road, physics);
  rivalPilot.setMode(rivalMode);
  const playerPilot = new Autopilot(track.road, physics);
  playerPilot.setMode('frantic');
  playerPilot.setPace(PLAYER_PACE);
  const playerInput = emptyInput();
  const rivalInput = emptyInput();
  const session = new RaceSession(track);
  const p = { x: 0, y: 0, z: 0 };
  const r = { x: 0, y: 0, z: 0 };
  player.absoluteTranslation(p);
  rival.absoluteTranslation(r);
  session.start(p.x, p.z, r.x, r.z);
  let lightsSeen = '';
  let movedInCountdown = 0;
  let checkpointsTaken = 0;
  let lastNext = 0;
  const started = performance.now();
  while (session.phase !== 'finished' && session.clock < RACE_LIMIT_S) {
    if (session.held) {
      for (const car of cars) car.fixedUpdate(FIXED_DT, settle);
    } else {
      if (!playerPilot.engaged) {
        playerPilot.setEngaged(true);
        rivalPilot.setEngaged(true);
      }
      playerPilot.drive(FIXED_DT, player, playerInput, origin.x, origin.z);
      player.fixedUpdate(FIXED_DT, playerInput);
      rivalPilot.drive(FIXED_DT, rival, rivalInput, origin.x, origin.z);
      rival.fixedUpdate(FIXED_DT, rivalInput);
    }
    for (const trailer of trailers) trailer.fixedUpdate(FIXED_DT);
    physics.step();
    for (const car of cars) car.postStep();
    for (const trailer of trailers) trailer.postStep();
    player.absoluteTranslation(p);
    rival.absoluteTranslation(r);
    const lights = String(session.lights);
    if (!lightsSeen.endsWith(lights)) lightsSeen += lights;
    if (session.held) movedInCountdown = Math.max(movedInCountdown, player.speedKmh, rival.speedKmh);
    session.step(FIXED_DT, p.x, p.z, r.x, r.z);
    if (session.player.next > lastNext) checkpointsTaken += session.player.next - lastNext;
    lastNext = session.player.next;
  }
  const won = session.winner === 'player';
  const paid = settleStake(world, won);
  const jarAfter = purseTotal(world.state.player.shells);
  const laps = (times: Float64Array): string => [...times].map((t) => (Number.isFinite(t) ? t.toFixed(1) : '—')).join(' / ');
  const wall = ((performance.now() - started) / 1000).toFixed(0);
  console.log(
    `  ${track.id} ${track.lengthM.toFixed(0)} m${plan.trailer ? `, TRAILERS ${TRAILER_KG} kg` : ''}: rival ${plan.modelId} ${plan.level} ` +
      `(${rivalMode}) — ${session.winner ?? 'nobody'} wins by ${session.end ?? 'time-out'} at ${session.raceTime.toFixed(1)} s (${wall} s wall)`,
  );
  console.log(`      player laps ${laps(session.playerLaps)} s; rival laps ${laps(session.rivalLaps)} s`);
  check(
    `${track.id}: lights red, red, red, green, both held`,
    lightsSeen.startsWith('1234') && movedInCountdown < 3,
    `lights ${lightsSeen}, fastest in the countdown ${movedInCountdown.toFixed(1)} km/h`,
  );
  check(
    `${track.id}: decided on laps, every lap past all checkpoints`,
    session.end === 'laps' && checkpointsTaken >= track.checkpoints.length * (session.player.completed),
    `player ${session.player.completed} laps, rival ${session.rival.completed}; player took ${checkpointsTaken} checkpoints`,
  );
  check(
    `${track.id}: the stake and the prize`,
    staked && jarStaked === jarBefore - RACE_STAKE && paid === (won ? RACE_PRIZE : 0) && jarAfter === jarStaked + (won ? RACE_PRIZE : 0) && world.state.raceStake === null,
    `jar ${jarBefore} → ${jarStaked} staked → ${jarAfter} (${won ? `won ${paid}` : 'lost'})`,
  );
  for (const trailer of trailers) trailer.dispose();
  for (const car of cars) car.dispose();
}

console.log(failures === 0 ? '\nall race checks passed' : `\n${failures} race check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
