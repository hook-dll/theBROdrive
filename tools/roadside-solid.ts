/**
 * tools/roadside-solid.ts
 *
 * Are the roadside masts and monuments actually SOLID?
 *
 * `props.ts addStatic` returns every pole, sign, shrine, cairn and wreck-marker
 * collider DISABLED, and for a long time it was each provider's own job to switch its
 * own colliders back on once its chunk was complete. `ScatterProvider` and
 * `RoadMeshProvider` did. `PoleProvider` and `MonumentProvider` never did, so a car
 * drove through the entire lamppost line and every monument on the road — with the
 * bodies present, the surfaces registered and the meshes drawn, which is why it read
 * as "collision is broken" rather than as missing content.
 *
 * `ChunkStreamer.attachContent` owns the switch now: one call, on every path that
 * lands a contribution. This drives the real streamer with the real four providers
 * and then asks Rapier the only question that matters — does a ray aimed at each
 * collider hit that collider?
 *
 *   npx tsx tools/roadside-solid.ts
 *
 * Nothing here is part of the game bundle.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState } from '../src/game/state';
import {
  ChunkStreamer,
  type ChunkContent,
  type ChunkContext,
  type ChunkProvider,
} from '../src/world/chunks';
import { WorldOrigin } from '../src/world/origin';
import { monumentsBetween } from '../src/world/gradient';
import { MonumentProvider, PoleProvider, ScatterProvider } from '../src/world/props';
import { Road } from '../src/world/road';
import { RoadMeshProvider } from '../src/world/roadmesh';
import { Terrain } from '../src/world/terrain';
import { WorldWorkScheduler } from '../src/world/workqueue';
import { installDocumentShim } from './domshim';

const SEED = 1337;
/**
 * Monuments sit on exact 20 km multiples and only some of those roll one, so the start
 * is placed AT one rather than at a tidy round number — otherwise the monument checks
 * pass on an empty set. Poles run continuously and need no such care.
 */
const MONUMENT = monumentsBetween(SEED, 0, 400_000)[0];
if (!MONUMENT) throw new Error('seed 1337 has no monument in the first 400 km');
const START_S = MONUMENT.s + 10;
/** Frames of streaming allowed before the window is declared stuck. */
const MAX_FRAMES = 20_000;

/**
 * Wraps a provider and keeps every contribution it returns, so the check can ask
 * about the exact colliders the real provider built rather than scanning the world
 * and guessing which shape was a lamppost.
 */
class Capturing implements ChunkProvider {
  readonly id: string;
  readonly contents: ChunkContent[] = [];

  constructor(private readonly inner: ChunkProvider) {
    this.id = inner.id;
  }

  build(ctx: ChunkContext): ChunkContent | null {
    const content = this.inner.build(ctx);
    if (content) this.contents.push(content);
    return content;
  }
}

// The road ribbon paints its asphalt maps on a 2D canvas during its first build.
const restoreDocument = installDocumentShim();

const physics = await PhysicsWorld.create();
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const world = new GameWorld(newWorldState(SEED));
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const scheduler = new WorldWorkScheduler(3);

const start = road.sampleAt(START_S);
origin.reset(start.x, start.z);

const poles = new Capturing(new PoleProvider());
const monuments = new Capturing(new MonumentProvider());

const streamer = new ChunkStreamer(road, terrain, physics, world, scene, origin, scheduler);
streamer.register(new RoadMeshProvider(SEED));
streamer.register(new ScatterProvider());
streamer.register(poles);
streamer.register(monuments);

// A STATIONARY player: travel direction stays 0, so nothing is prefetched and nothing
// is torn down once the window is full. Every captured contribution is therefore still
// live when the checks run, and no collider handle has been recycled.
//
// `prime` only builds the chunk the player stands in; the rest of the physics window
// arrives one scheduler slice at a time, and `hasPending` is false until the first
// `update` queues that work — hence the unconditional first frame.
streamer.prime(START_S, 0);
let frames = 0;
do {
  frames++;
  streamer.update(START_S, frames, 0);
} while (scheduler.hasPending && frames < MAX_FRAMES);
physics.step();

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
}

console.log(`streamed the window around s=${START_S} in ${frames} frames`);

/**
 * Fires rays at a collider's own centre and reports whether that collider is what
 * stopped one of them. A disabled collider is invisible to Rapier's query pipeline,
 * which is exactly the failure this tool exists to catch.
 *
 * Four directions and two ranges, because a mast is not alone out there: a boulder or
 * a saguaro standing between the probe and the pole would answer the wrong question.
 * The short range is smaller than the gap any other prop could occupy around a
 * 0.14 m mast, so an unmatched result at 0.4 m means the mast itself is not solid.
 */
const PROBE_RANGES = [2.5, 0.4] as const;
function hitsItself(collider: RAPIER.Collider): boolean {
  const t = collider.translation();
  for (const range of PROBE_RANGES) {
    for (const axis of [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]) {
      const hit = physics.raycast(
        { x: t.x + axis.x * range, y: t.y, z: t.z + axis.z * range },
        { x: -axis.x, y: 0, z: -axis.z },
        range * 2,
      );
      if (hit?.colliderHandle === collider.handle) return true;
    }
  }
  return false;
}

for (const [label, captured] of [
  ['poles', poles],
  ['monuments', monuments],
] as const) {
  let total = 0;
  let enabled = 0;
  let solid = 0;
  let concrete = 0;
  for (const content of captured.contents) {
    for (const collider of content.colliders) {
      total++;
      if (collider.isEnabled()) enabled++;
      if (hitsItself(collider)) solid++;
      if (physics.surfaces.lookupType(collider.handle) !== SurfaceType.Asphalt) concrete++;
    }
  }
  check(`${label}: colliders built`, total > 0, `${total} across the physics window`);
  check(`${label}: every collider enabled`, total > 0 && enabled === total, `${enabled}/${total}`);
  check(`${label}: a ray hits every one`, total > 0 && solid === total, `${solid}/${total}`);
  check(`${label}: surfaces registered`, total > 0 && concrete === total, `${concrete}/${total}`);
}

// Nothing else in a streamed chunk may be left switched off either: the road slabs and
// the scatter went through the same choke point.
let worldTotal = 0;
let worldDisabled = 0;
physics.world.bodies.forEach((body) => {
  for (let i = 0; i < body.numColliders(); i++) {
    worldTotal++;
    if (!body.collider(i).isEnabled()) worldDisabled++;
  }
});
check(
  'no disabled collider anywhere',
  worldDisabled === 0,
  `${worldDisabled} disabled of ${worldTotal} in the world`,
);

restoreDocument();

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
