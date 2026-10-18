/**
 * THE POLICE, HEADLESS (src/world/police.ts on the real RoadTraffic and physics).
 *
 * The player is a marker driven along his lane at a scripted speed: the traffic field
 * carries him, so the police car follows him as it would the real car, but nothing
 * physical stands where he is (the stop's stand is the police's own hold line). Three
 * runs, each from a dev post on the shoulder 300 m ahead:
 *
 *  1. Past it at 108 km/h, then a stop: the car pulls out, catches him, stops behind him;
 *     the papers are handed over and the speeding fine leaves the pack; he drives off and
 *     the car goes back to the stream.
 *  2. Past it at 126 km/h and on, the flight rolled to give up: it does, a few km on.
 *  3. The same, rolled to escalate: the heat rises to 1.
 *
 * `nice -n 15 bun tools/police-bench.ts [seed]`
 */
import * as THREE from 'three';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { createServiceableCarState } from '../src/game/spawn';
import { GameWorld, newWorldState } from '../src/game/state';
import { coinsHeld } from '../src/economy/economy';
import { Inventory } from '../src/items/items';
import { loadCarModel } from '../src/render/carmodel';
import { roadPaceCeiling } from '../src/vehicle/autopilot';
import { WorldOrigin } from '../src/world/origin';
import { POLICE_MODEL_ID, PolicePatrol } from '../src/world/police';
import { Road } from '../src/world/road';
import { WIDE_HALF_WIDTH } from '../src/world/roadprofile';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { RoadTraffic, type PolicePose } from '../src/world/traffic';
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
const ROAD_FROM = 100;
const ROAD_TO = 26_000;
const ROAD_STEP = 2;
/** Past the widest asphalt and the shoulder the police park on (flat, unlike the game's). */
const RIBBON_HALF_WIDTH = WIDE_HALF_WIDTH + 3;
const PLAYER_CAR = 'bench:player';
/** The flights' pace: over the limit, within the police UAZ's reach. */
const FLEE_MPS = 28;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
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

await loadCarModel(POLICE_MODEL_ID);
console.log(`police bench: seed ${SEED}`);
const road = new Road(SEED);
const physics = await PhysicsWorld.create();
addRoadCollider(physics, road);
const world = new GameWorld(newWorldState(SEED));
world.state.cars[PLAYER_CAR] = createServiceableCarState(PLAYER_CAR, 'kit_vaz1111', 0, 0, 0, 0);
world.state.cars[PLAYER_CAR]!.papers = true;
world.state.player.drivingCarId = PLAYER_CAR;
const inventory = new Inventory();
inventory.setListener(() => world.apply({ t: 'inventory', items: inventory.all, selected: Math.max(0, inventory.selectedIndex) }));
inventory.add({ type: 'coin', id: 'bench:coins', value: 20 });
const traffic = new RoadTraffic(physics, world, new THREE.Scene(), new WorldOrigin(), road, loadCarModel, () => true);
const toasts: string[] = [];
const police = new PolicePatrol(world, road, traffic, inventory, (text) => {
  toasts.push(text);
  console.log(`        · ${text}`);
});

let playerS = 2_500;
let speed = 0;
const pose: PolicePose = { s: 0, lateral: 0, speed: 0, direction: 1, posted: true };
let clock = 0;

const condition = { surface: SurfaceType.Asphalt, decay: 0, sandCover: 0, markings: 0 };
/** What a hurried driver takes the road here at, looking 150 m ahead: the marker drives no faster. */
function roadPace(s: number): number {
  let pace = Infinity;
  for (let d = 0; d <= 150; d += 25) {
    road.conditionAt(s + d, condition);
    const ceiling = roadPaceCeiling('hurried', condition, road.curvatureAt(s + d));
    pace = Math.min(pace, Math.sqrt(ceiling * ceiling + 2 * 2.5 * d));
  }
  return pace;
}

/** One step: the player's marker moves on at `target` m/s (road permitting, changed at 4 m/s²), then traffic, police, physics. */
function step(target: number): void {
  speed += Math.max(-4 * FIXED_DT, Math.min(4 * FIXED_DT, Math.min(target, roadPace(playerS)) - speed));
  playerS += speed * FIXED_DT;
  world.state.playedSeconds += FIXED_DT;
  clock += FIXED_DT;
  const lateral = -road.halfWidthAt(playerS) + 1.45;
  traffic.fixedUpdate(FIXED_DT, playerS, lateral, 0, 0);
  police.fixedUpdate(FIXED_DT, { s: playerS, lateral, carId: PLAYER_CAR, speedKmh: speed * 3.6 });
  physics.step();
  traffic.postStep();
}

/** Steps at `target` until `done` (true) or `limitS` seconds pass (false). */
async function runUntil(target: number | (() => number), done: () => boolean, limitS: number): Promise<boolean> {
  const end = clock + limitS;
  let n = 0;
  while (clock < end) {
    step(typeof target === 'number' ? target : target());
    if (done()) return true;
    if (++n % 30 === 0) await Bun.sleep(0);
  }
  return false;
}

const phase = (): string | null => police.snapshot().chase?.phase ?? null;

// 1. Speeding, a stop, the fine.
console.log('1. past a shoulder post at 108 km/h, then a stop');
speed = 30;
await runUntil(30, () => false, 1);
const post = police.devPost('shoulder', 300);
check('a dev shoulder post is made', post !== null, String(post));
const live = await runUntil(30, () => police.snapshot().posts.some((p) => p.key === post && p.state === 'live'), 5);
check('the police car stands on its post', live, police.snapshot().posts.map((p) => `${p.key}:${p.state}`).join(' '));
const liveCar = police.snapshot().posts.find((p) => p.key === post)?.carId ?? '';
if (traffic.policePose(liveCar, pose)) {
  const edge = road.halfWidthAt(pose.s);
  check('it stands on the shoulder, off the asphalt lane', -pose.lateral > edge - 0.2, `lateral ${pose.lateral.toFixed(2)}, edge ${edge.toFixed(2)}`);
}
const chased = await runUntil(30, () => phase() !== null, 30);
check('speeding past it starts a chase', chased, `phase ${phase()} at s ${playerS.toFixed(0)}`);
check('the grounds are speeding', police.snapshot().chase?.grounds.speedingKmh !== null, JSON.stringify(police.snapshot().chase?.grounds));
await runUntil(30, () => false, 8);
const stopAt = playerS;
const stopped = await runUntil(0, () => phase() === 'stopped', 90);
const chaseCar = police.snapshot().chase?.carId ?? '';
const posed = traffic.policePose(chaseCar, pose);
const gap = playerS - pose.s;
check('it pulls over and stands behind him', stopped && posed && gap > 4 && gap < 20, `phase ${phase()}, gap ${gap.toFixed(1)} m, slowed from s ${stopAt.toFixed(0)}`);
check('it stands on his line', posed && Math.abs(pose.lateral - (-road.halfWidthAt(playerS) + 1.45)) < 1.2, `lateral ${pose.lateral.toFixed(2)}`);
const coinsBefore = coinsHeld(world.state);
const result = police.handOver();
const coinsAfter = coinsHeld(world.state);
check('the papers are handed over', result !== null, JSON.stringify(result));
check('the speeding fine leaves the pack', result !== null && result.fine > 0 && coinsBefore - coinsAfter === result.fine, `${coinsBefore} → ${coinsAfter} coins`);
const released = await runUntil(20, () => phase() === null, 30);
check('he drives off and the car goes back to the stream', released, `phase ${phase()}`);

// 2. A flight that gives up.
console.log(`2. past a post at ${(FLEE_MPS * 3.6).toFixed(0)} km/h and on: the police give up`);
police.devFlight(true);
playerS += 1500;
await runUntil(FLEE_MPS, () => false, 1);
const post2 = police.devPost('shoulder', 400);
await runUntil(FLEE_MPS, () => police.snapshot().posts.some((p) => p.key === post2 && p.state === 'live'), 8);
const chased2 = await runUntil(FLEE_MPS, () => phase() !== null, 40);
check('a second chase starts', chased2, `phase ${phase()} at s ${playerS.toFixed(0)}`);
let closest = Infinity;
let tailGap = Infinity;
const tailCar = police.snapshot().chase?.carId ?? '';
let leftPostAt = Infinity;
const fled = await runUntil(FLEE_MPS, () => {
  if (traffic.policePose(tailCar, pose)) {
    if (!pose.posted && leftPostAt === Infinity) leftPostAt = clock;
    // Its closest once it has had ten seconds on the road to come up behind him.
    if (clock > leftPostAt + 10) closest = Math.min(closest, playerS - pose.s);
    tailGap = playerS - pose.s;
  }
  return police.snapshot().chase?.fled === true || phase() === null;
}, 90);
check('it catches him up and tails him', closest > 12 && tailGap < 45, `closest ${closest.toFixed(1)} m, at the flight ${tailGap.toFixed(1)} m`);
check('ignoring the lights is a flight', fled, `phase ${phase()} at s ${playerS.toFixed(0)}`);
const over2 = await runUntil(FLEE_MPS, () => phase() === null, 300);
check('the chase ends', over2, `phase ${phase()} at s ${playerS.toFixed(0)}`);
check('they gave up', toasts.some((t) => t.includes('gave up')), toasts.slice(-2).join(' | '));
check('a give-up adds no heat', world.state.player.police.heat === 0, `heat ${world.state.player.police.heat}`);

// 3. A flight that escalates.
console.log('3. the same, rolled to escalate');
police.devFlight(false);
playerS += 1500;
await runUntil(FLEE_MPS, () => false, 1);
const post3 = police.devPost('shoulder', 400);
const live3 = await runUntil(FLEE_MPS, () => police.snapshot().posts.some((p) => p.key === post3 && p.state === 'live'), 8);
check('a third post is manned', live3, `${police.snapshot().posts.map((p) => `${p.key}:${p.state}@${p.s.toFixed(0)}`).join(' ')}, player s ${playerS.toFixed(0)}`);
const chased3 = await runUntil(FLEE_MPS, () => phase() !== null, 40);
check('a third chase starts', chased3, `phase ${phase()}`);
await runUntil(FLEE_MPS, () => police.snapshot().chase?.fled === true || phase() === null, 90);
check('the flight escalates: wanted level 1', world.state.player.police.heat === 1, `heat ${world.state.player.police.heat}, until ${world.state.player.police.heatUntil.toFixed(0)}`);

console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
