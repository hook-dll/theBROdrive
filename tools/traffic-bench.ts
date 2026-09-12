import * as THREE from 'three';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import { loadCarModel } from '../src/render/carmodel';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { HazardIndex, type RoadHazard } from '../src/world/hazards';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { roadSurfaceY, SurfaceField } from '../src/world/roadsurface';
import { RoadTraffic } from '../src/world/traffic';
import { Terrain } from '../src/world/terrain';
import { TERMINUS_CENTRE_M, TERMINUS_PAD_M } from '../src/world/terminus';
import { lanesPerSideAt } from '../src/world/roadprofile';
import { installAssetShim } from './assetshim';

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

const SEED = Number(process.argv[2] ?? 42);
const PLAYER_S = 1_000;
const ROAD_FROM = 100;
/** Enough road for the streamed phase below to cruise at motorway pace. */
const ROAD_TO = 7_000;
/** Cruising pace for the streamed phase: the speed the distribution is judged at. */
const PLAYER_MPS = 25;
const ROAD_STEP = 2;
const RIBBON_HALF_WIDTH = ROAD_HALF_WIDTH + 3;
let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
}

/** First arclength where the carriageway offers two lanes each way. */
function findWideS(road: Road): number {
  for (let s = PLAYER_S; s < 400_000; s += 100) {
    if (lanesPerSideAt(SEED, s) === 2) return s;
  }
  throw new Error('no widened stretch on this seed');
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
traffic.setTargetCount(30);
traffic.setDaylightFactor(1);

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
for (let step = 0; step < Math.ceil(30 / FIXED_DT); step++) {
  traffic.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0);
  physics.step();
  traffic.postStep();
  sampleStoppedTraffic();
  largestCount = Math.max(largestCount, traffic.status.count);
  if (traffic.status.count > 0) smallestPopulated = Math.min(smallestPopulated, traffic.status.count);
  if (step % 6 === 0) await Bun.sleep(0);
}
const populated = traffic.status;
const catalogue = new Set(CAR_MODELS.map((model) => model.id));
check(
  'traffic stays within its thirty-car setting',
  largestCount <= 30 && populated.count <= 30,
  `largest ${largestCount}, live ${populated.count}`,
);
check(
  'traffic forms a frequent local stream',
  populated.count >= 9 && populated.nearestRoadDistance <= 300,
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
  'daylight traffic uses only low beam',
  populated.highBeams === 0 && populated.lowBeams === populated.count,
  `${populated.highBeams} high, ${populated.lowBeams} low / ${populated.count} cars`,
);
traffic.setDaylightFactor(0);
traffic.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0);
check(
  'night traffic keeps every low beam lit',
  traffic.status.highBeams === 0 && traffic.status.lowBeams === traffic.status.count,
  `${traffic.status.highBeams} high, ${traffic.status.lowBeams} low / ${traffic.status.count} cars`,
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
  traffic.fixedUpdate(FIXED_DT, movingPlayerS, 0, 0);
  physics.step();
  traffic.postStep();
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
const meanAhead = aheadSum / distributionSamples;
const meanLive = liveSum / distributionSamples;
const streamed = traffic.status;
check(
  'mixed traffic queues without collision',
  streamed.impacts === 0,
  `${streamed.impacts} impact(s), ${streamed.passes} pass(es), ${streamed.count} live`,
);
check(
  'traffic density varies below configured cap',
  largestCount <= 30 && smallestPopulated < largestCount,
  `${streamed.count} live, range ${smallestPopulated}-${largestCount}`,
);
check(
  'dense queues always resume',
  longestStop < 30,
  `longest continuous stop ${longestStop.toFixed(1)} s`,
);
// THE SETTING IS JUDGED BY WHAT IS IN FRONT, NOT BY `count`.
//
// Cars spawn ahead and are collected behind, and the player overtakes most of the
// stream, so the rear is where the quota goes to die: with a 700 m spawn band past
// the collision window and an 850 m rear tail, two thirds of thirty cars sat behind
// a cruising player and the road ahead held six. This fails if that returns.
check(
  'most of the quota stays where the player can see it',
  meanAhead >= 9 && meanAhead >= meanLive * 0.4,
  `${meanAhead.toFixed(1)} of ${meanLive.toFixed(1)} live ahead at ${(PLAYER_MPS * 3.6).toFixed(0)} km/h`,
);


// Beyond every range from where the stream actually ended, not from where it began:
// the forward tail reaches `DESPAWN_M` past the last driven position.
traffic.fixedUpdate(0.6, PLAYER_S + 120 * PLAYER_MPS + 4_000, 0, 0);
check(
  'cars despawn beyond the active range',
  traffic.status.count === 0,
  `${traffic.status.count} cars remain`,
);
traffic.setTargetCount(0);
check(
  'zero traffic setting leaves no live or pending traffic',
  traffic.status.count === 0 && !traffic.status.pending && !traffic.enabled,
  JSON.stringify(traffic.status),
);

// THE WIDENED ROAD CARRIES MORE CARS, AND STOPS THERE.
//
// The setting is the narrow road's number; a stretch with two lanes each way runs up
// to the configured maximum and no further, so a player who asked for twelve meets
// twelve on the ordinary road and up to thirty on a highway section.
{
  const wideS = findWideS(road);
  const wideTraffic = new RoadTraffic(
    physics,
    new GameWorld(newWorldState(SEED)),
    new THREE.Scene(),
    new WorldOrigin(),
    road,
    new HazardIndex(),
    loadCarModel,
    () => true,
  );
  wideTraffic.setTargetCount(12);
  wideTraffic.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0);
  const narrowTarget = wideTraffic.status.target;
  wideTraffic.fixedUpdate(FIXED_DT, wideS, 0, 0);
  const wideTarget = wideTraffic.status.target;
  check(
    'a widened stretch raises the density toward the cap',
    narrowTarget <= 12 && wideTarget > narrowTarget && wideTarget <= 30,
    `${narrowTarget} asked for on the narrow road, ${wideTarget} on the wide one (cap 30)`,
  );
  wideTraffic.dispose();
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
  blocked.setTargetCount(12);
  blocked.setDaylightFactor(1);
  const stopped = new Map<string, number>();
  let worstStop = 0;
  let passedTheRock = 0;
  const before = new Set<string>();
  for (let step = 0; step < Math.ceil(150 / FIXED_DT); step++) {
    blocked.fixedUpdate(FIXED_DT, PLAYER_S, 0, 0);
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
  ending.setTargetCount(12);
  ending.setDaylightFactor(1);
  const reachedEnd = new Set<string>();
  const cameBack = new Set<string>();
  let onPad = 0;
  let strandedOnPad = 0;
  const padTime = new Map<string, number>();
  const impactsBefore = ending.status.impacts;
  for (let i = 0; i < Math.ceil(180 / FIXED_DT); i++) {
    ending.fixedUpdate(FIXED_DT, endS, 0, 0);
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
traffic.dispose();

console.log(failures === 0 ? '\nall traffic checks passed' : `\n${failures} traffic check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
