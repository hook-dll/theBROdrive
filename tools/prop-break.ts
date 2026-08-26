/**
 * tools/prop-break.ts
 *
 * Knocks a cactus down, end to end, with the REAL pieces: the real `ScatterProvider`
 * building a real chunk against a real Rapier world, the real `DebrisField` deciding
 * what got hit, and the real `GameWorld` recording it.
 *
 * It checks the five things a break has to get right, none of which a screenshot can
 * show:
 *
 *   registered   the chunk hands its breakable props over, and only from a chunk that
 *                carries physics — nothing far away can be hit
 *   transaction  the standing prop's instance is blanked and its collider switched off
 *                in the same step its pieces enter the world
 *   flight       the pieces are dynamic and actually leave, carrying the impact
 *   record       `state.flattenedProps` gets the cell id
 *   guard        a rebuilt chunk does NOT stand it back up, which is the whole reason
 *                the record exists
 *
 *   npx tsx tools/prop-break.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContext, type ChunkContent } from '../src/world/chunks';
import { DebrisField, type Impactor } from '../src/world/debris';
import { WorldOrigin } from '../src/world/origin';
import { ScatterProvider, propPieces } from '../src/world/props';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';

const SEED = 1337;
const CHUNK = 130;

const physics = await PhysicsWorld.create();
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const roadDistance = new RoadDistance(road);
const origin = new WorldOrigin();
const world = new GameWorld(newWorldState(SEED));
const scene = new THREE.Scene();

const debris = new DebrisField(physics, world, scene, origin);
const provider = new ScatterProvider(roadDistance, debris);

function buildChunk(hasPhysics: boolean): ChunkContent {
  const ctx = {
    chunkIndex: CHUNK,
    sStart: CHUNK * CHUNK_LENGTH,
    sEnd: (CHUNK + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics,
    world,
    hasPhysics,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
  return provider.build(ctx);
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${detail}`);
}

// --- registered ---------------------------------------------------------------
// The field is private, so registration is observed the way the game observes it: a
// chunk with physics offers props to break, one without offers none.
let registeredIds: number[] = [];
{
  const spy = {
    isBroken: (id: number) => debris.isBroken(id),
    register: (prop: { id: number }) => registeredIds.push(prop.id),
    forget: () => {},
  };
  const spyProvider = new ScatterProvider(roadDistance, spy);
  const ctx = (hasPhysics: boolean) =>
    ({
      chunkIndex: CHUNK,
      sStart: CHUNK * CHUNK_LENGTH,
      sEnd: (CHUNK + 1) * CHUNK_LENGTH,
      road,
      terrain,
      physics,
      world,
      hasPhysics,
      originX: 0,
      originZ: 0,
    }) as unknown as ChunkContext;

  const withPhysics = spyProvider.build(ctx(true));
  const breakableCount = registeredIds.length;
  for (const body of withPhysics.bodies) physics.world.removeRigidBody(body);
  withPhysics.dispose?.();

  registeredIds = [];
  const withoutPhysics = spyProvider.build(ctx(false));
  const farCount = registeredIds.length;
  withoutPhysics.dispose?.();

  check('breakables in a physics chunk', breakableCount > 0, `${breakableCount} registered`);
  check('none in a scenery-only chunk', farCount === 0, `${farCount} registered`);
  check('saguaro has pieces', (propPieces('saguaro')?.length ?? 0) === 5, `${propPieces('saguaro')?.length} pieces`);
  check('barrel cactus has pieces', (propPieces('barrel')?.length ?? 0) === 3, `${propPieces('barrel')?.length} pieces`);
  check('boulders do not break', propPieces('boulder') === null, 'no pieces');
}

// --- transaction + flight + record --------------------------------------------
const content = buildChunk(true);

// Find a standing breakable by asking the field itself: register a spy alongside so we
// know one prop's full pose. Cheaper: rebuild through a capturing sink.
let target: {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  collider: { isEnabled(): boolean };
  mesh: THREE.InstancedMesh;
  instance: number;
} | null = null;
{
  const capture = {
    isBroken: (id: number) => debris.isBroken(id),
    register: (prop: typeof target) => {
      if (!target) target = prop;
    },
    forget: () => {},
  };
  const captureProvider = new ScatterProvider(roadDistance, capture);
  const captured = captureProvider.build({
    chunkIndex: CHUNK,
    sStart: CHUNK * CHUNK_LENGTH,
    sEnd: (CHUNK + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics,
    world,
    hasPhysics: true,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext);
  // Hand the captured prop to the real field, then throw the duplicate chunk's bodies
  // away — the prop's own collider is the one being tested, so it must stay.
  if (target) debris.register(target as never);
  captured.dispose?.();
}

if (!target) {
  console.log('  FAIL  no breakable prop found in chunk');
  failures++;
} else {
  const prop = target;
  const bodiesBefore = physics.world.bodies.len();

  // A car barely pressing into the plant nose-on at 0.02 m/s.
  const impactor: Impactor = {
    x: prop.x,
    y: prop.y + 0.6,
    z: prop.z,
    fx: 0,
    fz: 1,
    halfWidth: 0.9,
    halfLength: 2.1,
    vx: 0,
    vy: 0,
    vz: 0.02,
  };

  // Resting beside a plant is harmless; any actual vehicle movement through it breaks.
  debris.update({ ...impactor, vz: 0 });
  check('a parked car breaks nothing', prop.collider.isEnabled(), 'collider still on');

  debris.update(impactor);
  check('a crawl switches collider off', !prop.collider.isEnabled(), 'disabled');

  check('recorded in state', world.state.flattenedProps.includes(prop.id), `id ${prop.id}`);

  const matrix = new THREE.Matrix4();
  prop.mesh.getMatrixAt(prop.instance, matrix);
  const scale = new THREE.Vector3().setFromMatrixScale(matrix);
  check('instance blanked', scale.length() < 1e-6, `scale ${scale.length().toFixed(3)}`);

  const spawned = physics.world.bodies.len() - bodiesBefore;
  check('pieces spawned', spawned === 5, `${spawned} bodies`);

  // Fly: step the world and confirm the pieces moved off their spawn points.
  const before: [number, number, number][] = [];
  scene.children.forEach((c) => before.push([c.position.x, c.position.y, c.position.z]));
  for (let i = 0; i < 30; i++) physics.step();
  debris.syncVisuals();
  let moved = 0;
  scene.children.forEach((c, i) => {
    const p = before[i]!;
    if (Math.hypot(c.position.x - p[0], c.position.y - p[1], c.position.z - p[2]) > 0.1) moved++;
  });
  check('pieces left the plant', moved === 5, `${moved} of ${scene.children.length} moved`);
}

// --- guard --------------------------------------------------------------------
{
  for (const body of content.bodies) physics.world.removeRigidBody(body);
  content.dispose?.();
  let standingAgain = false;
  const spy = {
    isBroken: (id: number) => debris.isBroken(id),
    register: (prop: { id: number }) => {
      if (target && prop.id === target.id) standingAgain = true;
    },
    forget: () => {},
  };
  const rebuilt = new ScatterProvider(roadDistance, spy).build({
    chunkIndex: CHUNK,
    sStart: CHUNK * CHUNK_LENGTH,
    sEnd: (CHUNK + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics,
    world,
    hasPhysics: true,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext);
  for (const body of rebuilt.bodies) physics.world.removeRigidBody(body);
  rebuilt.dispose?.();
  check('stays down after a rebuild', !standingAgain, 'not re-registered');
}

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
