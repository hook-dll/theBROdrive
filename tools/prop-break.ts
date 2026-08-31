/**
 * tools/prop-break.ts
 *
 * Knocks a low dirt pile down, end to end, with the REAL pieces: the real
 * `ScatterProvider` building a real chunk against a real Rapier world, the real
 * `DebrisField` deciding what got hit, and the real `GameWorld` recording it.
 *
 * It checks the break transaction and lifecycle details that a screenshot cannot show:
 *
 *   registered   only chunks with physics hand over breakable props
 *   transaction  the standing instance and collider change with the break
 *   flight       pieces carry the impact and leave their spawn transforms
 *   retirement   moving/nearby, young, or briefly sleeping pieces cannot disappear;
 *                distant, settled pieces release scene and physics ownership
 *   record       `state.flattenedProps` survives debris retirement and chunk rebuilds
 *   sweep + cap  a high-speed chassis still breaks props and debris never exceeds 48
 *
 *   npx tsx tools/prop-break.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContext, type ChunkContent } from '../src/world/chunks';
import { DebrisField, type Impactor } from '../src/world/debris';
import { WorldOrigin } from '../src/world/origin';
import { ScatterProvider, propPieces, type BreakableProp } from '../src/world/props';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';

const SEED = 1337;
const CHUNK = 130;

const physics = await PhysicsWorld.create();
const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const origin = new WorldOrigin();
const world = new GameWorld(newWorldState(SEED));
const scene = new THREE.Scene();

const debris = new DebrisField(physics, world, scene, origin);
const provider = new ScatterProvider(debris);

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
  const spyProvider = new ScatterProvider(spy);
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
  check('dirt pile has pieces', (propPieces('scrub')?.length ?? 0) === 3, `${propPieces('scrub')?.length} pieces`);
  check('boulders do not break', propPieces('boulder') === null, 'no pieces');
}

// --- transaction + flight + record --------------------------------------------
const content = buildChunk(true);

// Find a standing breakable by asking the field itself: register a spy alongside so we
// know one prop's full pose. Cheaper: rebuild through a capturing sink.
let target: BreakableProp | null = null;
{
  const capture = {
    isBroken: (id: number) => debris.isBroken(id),
    register: (prop: BreakableProp) => {
      if (!target && prop.pieces === propPieces('scrub')) target = prop;
    },
    forget: () => {},
  };
  const captureProvider = new ScatterProvider(capture);
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
  if (target) debris.register(target);
  captured.dispose?.();
}

if (!target) {
  console.log('  FAIL  no breakable prop found in chunk');
  failures++;
} else {
  const prop = target;
  const bodiesBefore = physics.world.bodies.len();
  const existingBodies = new Set<number>();
  physics.world.forEachRigidBody((body) => existingBodies.add(body.handle));

  const advanceFixedSteps = (steps: number, observerX: number, observerZ: number): void => {
    for (let i = 0; i < steps; i++) {
      physics.step();
      debris.update(null, FIXED_DT, observerX, observerZ);
    }
    debris.syncVisuals();
  };

  // Contact breaks the pile even with no vehicle speed. There is deliberately no
  // velocity threshold: a chassis already pressing into one must not leave it standing.
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
    vz: 0,
  };

  debris.update(impactor, FIXED_DT, prop.x, prop.z);
  check('zero-speed contact disables pile', !prop.collider.isEnabled(), 'disabled');
  check('recorded in state', world.state.flattenedProps.includes(prop.id), `id ${prop.id}`);

  const matrix = new THREE.Matrix4();
  prop.mesh.getMatrixAt(prop.instance, matrix);
  const scale = new THREE.Vector3().setFromMatrixScale(matrix);
  check('instance blanked', scale.length() < 1e-6, `scale ${scale.length().toFixed(3)}`);

  const spawned = physics.world.bodies.len() - bodiesBefore;
  check('three pile pieces spawned', spawned === 3, `${spawned} bodies`);
  check('live count tracks spawned pieces', debris.liveCount === 3, `${debris.liveCount} live`);

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
  check('pile pieces leave on impact', moved === 3, `${moved} of ${scene.children.length} moved`);

  // Moving pieces near the observer must remain. Then force Rapier's settled state so
  // retirement timing is deterministic rather than dependent on a terrain landing.
  advanceFixedSteps(60, prop.x, prop.z);
  check(
    'moving nearby pieces remain live',
    debris.liveCount === 3 && physics.world.bodies.len() === bodiesBefore + 3,
    `${debris.liveCount} live, ${physics.world.bodies.len() - bodiesBefore} added bodies`,
  );
  physics.world.forEachRigidBody((body) => {
    if (!existingBodies.has(body.handle)) body.sleep();
  });

  advanceFixedSteps(90, prop.x, prop.z);
  check('sleep gate delays retirement', debris.liveCount === 3, `${debris.liveCount} live after 1.5 s asleep`);
  advanceFixedSteps(31, prop.x, prop.z);
  check('age gate delays retirement', debris.liveCount === 3, `${debris.liveCount} live before age threshold`);
  advanceFixedSteps(121, prop.x, prop.z);
  check('aged nearby pieces remain live', debris.liveCount === 3, `${debris.liveCount} live after both time gates`);

  // Walk the observer outward in small fixed-step increments. The nearby probe stays
  // comfortably inside the retirement radius despite each piece's own flight path.
  for (let distance = 10; distance <= 100; distance += 10) {
    advanceFixedSteps(1, prop.x + distance, prop.z);
  }
  check('settled pieces remain inside 120 m', debris.liveCount === 3, `${debris.liveCount} live nearby`);
  for (let distance = 101; distance <= 140; distance++) {
    advanceFixedSteps(1, prop.x + distance, prop.z);
  }
  advanceFixedSteps(4, prop.x + 140, prop.z);
  check('distant settled pieces retire', debris.liveCount === 0, `${debris.liveCount} live`);
  check('retirement removes debris meshes', scene.children.length === 0, `${scene.children.length} scene meshes`);
  check(
    'retirement removes physics bodies',
    physics.world.bodies.len() === bodiesBefore,
    `${physics.world.bodies.len()} bodies, started at ${bodiesBefore}`,
  );
  check('flattened record outlives debris', world.state.flattenedProps.includes(prop.id), `id ${prop.id}`);
  check('retired prop remains broken', debris.isBroken(prop.id), `id ${prop.id}`);

  // A sweep across a narrow prop must break it even when neither fixed-step endpoint
  // overlaps. This also proves the new update arguments preserve impact handling.
  const sweptId = prop.id + 1_000_000;
  const sweptProp: BreakableProp = { ...prop, id: sweptId };
  debris.register(sweptProp);
  debris.update(
    { ...impactor, x: sweptProp.x - 5, y: sweptProp.y + 0.6, z: sweptProp.z, fx: 1, fz: 0 },
    FIXED_DT,
    sweptProp.x - 5,
    sweptProp.z,
  );
  debris.update(
    { ...impactor, x: sweptProp.x + 5, y: sweptProp.y + 0.6, z: sweptProp.z, fx: 1, fz: 0 },
    FIXED_DT,
    sweptProp.x + 5,
    sweptProp.z,
  );
  check('high-speed sweep breaks prop', world.state.flattenedProps.includes(sweptId), `id ${sweptId}`);

  // Repeated real-piece spawns must evict the oldest immediately rather than growing
  // past the hard budget. The cloned records model distinct props while keeping the
  // captured production piece geometry, materials, and collision setup.
  const capBodiesBefore = physics.world.bodies.len();
  const capLiveBefore = debris.liveCount;
  for (let i = 0; i < 17; i++) {
    const id = sweptId + i + 1;
    debris.register({ ...prop, id });
    debris.update({ ...impactor, x: prop.x, y: prop.y + 0.6, z: prop.z }, FIXED_DT, prop.x, prop.z);
  }
  check('hard debris cap holds', debris.liveCount === 48, `${debris.liveCount} live`);
  check(
    'cap evicts excess physics bodies',
    physics.world.bodies.len() === capBodiesBefore + 48 - capLiveBefore,
    `${physics.world.bodies.len() - capBodiesBefore} cap-test bodies after ${capLiveBefore} live`,
  );
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
  const rebuilt = new ScatterProvider(spy).build({
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
