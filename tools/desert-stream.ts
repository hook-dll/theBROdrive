import * as THREE from 'three';

import { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import { DesertTileStreamer, DESERT_TILE_SIZE } from '../src/world/deserttiles';
import { desertPropForms, type BreakableSink, type BreakableProp } from '../src/world/props';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { RoadDistance } from '../src/world/roaddistance';
import { Terrain } from '../src/world/terrain';

const seed = 1337;
const road = new Road(seed);
const terrain = new Terrain(seed, road);
const roadDistance = new RoadDistance(road);
const physics = await PhysicsWorld.create();
const scene = new THREE.Scene();
const origin = new WorldOrigin();

const startS = 20_000;
const start = road.offsetPoint(startS, 1500);
origin.reset(start.x, start.z);
const standing = new Map<number, BreakableProp>();
const breakables: BreakableSink = {
  isBroken: () => false,
  register: (prop) => standing.set(prop.id, prop),
  forget: (ids) => {
    for (const id of ids) standing.delete(id);
  },
};
const streamer = new DesertTileStreamer(
  seed,
  road,
  terrain,
  roadDistance,
  physics,
  scene,
  origin,
  breakables,
);
const formIdByGeometry = new Map<THREE.BufferGeometry, string>();
for (const surface of [SurfaceType.Sand, SurfaceType.Rock]) {
  for (const form of desertPropForms(surface)) formIdByGeometry.set(form.geometry, form.id);
}
const propCensus = (): { total: number; mix: string } => {
  const counts = new Map<string, number>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    const id = formIdByGeometry.get(object.geometry);
    if (id) counts.set(id, (counts.get(id) ?? 0) + object.count);
  });
  const entries = [...counts].sort(([a], [b]) => a.localeCompare(b));
  return {
    total: entries.reduce((sum, [, count]) => sum + count, 0),
    mix: entries.map(([id, count]) => `${id}:${count}`).join(','),
  };
};


const primeStart = performance.now();
streamer.prime(start.x, start.z, 1500);
const primeMs = performance.now() - primeStart;
if (streamer.visualTileCount !== 9 || streamer.physicsTileCount !== 9) {
  throw new Error(`prime set is ${streamer.visualTileCount} visual/${streamer.physicsTileCount} physical, expected 9/9`);
}
physics.step();
if (!streamer.hasPhysicsAt(start.x, start.z)) throw new Error('current tile is not physical after prime');

const centreTx = Math.floor(start.x / DESERT_TILE_SIZE);
const centreTz = Math.floor(start.z / DESERT_TILE_SIZE);
const tileStartX = centreTx * DESERT_TILE_SIZE;
const tileStartZ = centreTz * DESERT_TILE_SIZE;
let terrainHits = 0;
let worstRayError = 0;
for (let ix = 10; ix <= 70; ix += 15) {
  for (let iz = 10; iz <= 70; iz += 15) {
    const x = tileStartX + ix * 3;
    const z = tileStartZ + iz * 3;
    const drawn = streamer.heightAt(x, z);
    if (drawn === null) throw new Error('missing drawn height inside current tile');
    const hit = physics.raycast(
      { x: x - origin.x, y: drawn + 100, z: z - origin.z },
      { x: 0, y: -1, z: 0 },
      200,
    );
    if (!hit) throw new Error(`no physical ground at ${x}, ${z}`);
    const error = Math.abs(hit.point.y - drawn);
    // A sparse rock can legitimately be the first hit. Terrain hits must reproduce
    // the exact regular-lattice vertex shared by the renderer and heightfield.
    if (error < 0.25) {
      terrainHits++;
      if (error > worstRayError) worstRayError = error;
    }
  }
}
if (terrainHits < 20) throw new Error(`only ${terrainHits} terrain ray hits; heightfield may be transposed`);
if (worstRayError > 0.02) throw new Error(`render/physics height mismatch ${worstRayError.toFixed(4)} m`);

let operationWorst = 0;
let operationTotal = 0;
const settle = (x: number, z: number, lateral: number, firstFrame: number): number => {
  for (let step = 0; step < 40; step++) {
    const t0 = performance.now();
    streamer.update(x, z, lateral, firstFrame + step);
    const elapsed = performance.now() - t0;
    operationTotal += elapsed;
    if (elapsed > operationWorst) operationWorst = elapsed;
  }
  if (streamer.visualTileCount !== 25 || streamer.physicsTileCount !== 9) {
    throw new Error(`settled set is ${streamer.visualTileCount} visual/${streamer.physicsTileCount} physical, expected 25/9`);
  }
  return firstFrame + 40;
};

let frame = settle(start.x, start.z, 1500, 1);
const initialProps = propCensus();
const initialKinds = initialProps.mix === '' ? 0 : initialProps.mix.split(',').length;
if (initialKinds < 4 || !/(saguaro|barrel|deadstick|trunk|scrub):/.test(initialProps.mix)) {
  throw new Error(`open desert prop mix is still unvaried: ${initialProps.mix || 'empty'}`);
}
if (standing.size === 0) throw new Error('physical tiles registered no breakable desert props');
const initialBreakableIds = new Set(standing.keys());
for (const id of initialBreakableIds) {
  if (id > -1_000_000) throw new Error(`tile prop id overlaps road-owned ids: ${id}`);
}
const sampleX = tileStartX + 120;
const sampleZ = tileStartZ + 120;
const originalHeight = streamer.heightAt(sampleX, sampleZ);
if (originalHeight === null) throw new Error('missing deterministic sample before unload');

const farX = start.x + DESERT_TILE_SIZE * 8;
frame = settle(farX, start.z, 3500, frame);
if (streamer.heightAt(sampleX, sampleZ) !== null) throw new Error('old tile remained resident after leaving visual radius');
for (const id of initialBreakableIds) {
  if (standing.has(id)) throw new Error(`unloaded breakable prop ${id} remained registered`);
}
frame = settle(start.x, start.z, 1500, frame);
const rebuiltHeight = streamer.heightAt(sampleX, sampleZ);
if (rebuiltHeight !== originalHeight) {
  throw new Error(`rebuilt height changed: ${originalHeight} -> ${rebuiltHeight}`);
}
const rebuiltProps = propCensus();
if (rebuiltProps.total !== initialProps.total || rebuiltProps.mix !== initialProps.mix) {
  throw new Error(`rebuilt prop scatter changed: ${initialProps.mix} -> ${rebuiltProps.mix}`);
}

const shiftedX = farX + 3000;
const shift = origin.advance(shiftedX, start.z);
if (!shift) throw new Error('expected floating-origin shift');
physics.rebase(shift.dx, shift.dz);
streamer.rebase();
frame = settle(shiftedX, start.z, 6500, frame);
if (physics.maxBodyDistance() > 900) {
  throw new Error(`streamed body escaped floating-origin frame: ${physics.maxBodyDistance().toFixed(1)} m`);
}

console.log(
  `desert stream: prime ${primeMs.toFixed(1)} ms for 9 physical tiles; ` +
    `${terrainHits} terrain rays, worst mismatch ${(worstRayError * 1000).toFixed(2)} mm; ` +
    `settled ${streamer.visualTileCount} visual/${streamer.physicsTileCount} physical with ` +
    `${initialProps.total} props (${initialProps.mix}); ` +
    `worst streamed frame ${operationWorst.toFixed(1)} ms, aggregate ${operationTotal.toFixed(1)} ms; ` +
    `deterministic rebuild and floating-origin shift passed at frame ${frame}`,
);
