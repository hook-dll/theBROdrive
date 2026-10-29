/**
 * The toy box's gates that need no browser (world/toybox.ts, world/toystand.ts):
 *
 *   nice -n 15 ~/.bun/bin/bun tools/toybox-check.ts
 *
 *  1. the bay: a point is in it by its own frame, however it is turned, and its margin
 *     grows it all round; a rectangle reaches into it only when it does, alongside or
 *     turned across;
 *  2. TAKE OUT's rules (`readBaySwap`): never from the wheel, never with the player in the
 *     bay or within its margin, the player's car in the bay goes in (the last driven one
 *     first), a car of his only half in is told to drive in, and anyone else's car or a
 *     trailer reaching in refuses it; `boxRefusal` still holds for the car that goes in;
 *  3. the stands: every variant builds headless, keeps its solids and controls inside the
 *     footprint `SERVICE_HALF.toybox` keeps clear, and has its moving parts apart from
 *     the merged ones; the whole toy box (stand, bay, fixture) builds at a real post;
 *  4. the catalogue: every car of the game once, cheapest first; BUY takes the price out
 *     of the jar and puts a new car of his, in the paint its model showed, into the box,
 *     takes nothing when the jar is short, never reuses an id, and the bought car survives
 *     a save code; seeds are random uint32s, printed.
 *
 * What still needs the browser: the look, the wheel following the cursor, the model's
 * die-cast arriving from the worker, and no shader program linked mid-drive.
 */

import * as THREE from 'three';
import type { CarState, TrailerState, WorldState } from '../src/game/state';
import { GameWorld, newWorldState } from '../src/game/state';
import { debit, carShells } from '../src/economy/economy';
import { decodeSaveCode, encodeSaveCode } from '../src/save/save';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { factoryPaintHex, visiblePaintHex } from '../src/vehicle/carpaint';
import type { ChunkContext } from '../src/world/chunks';
import { TOY_STANDS } from '../src/world/devlook';
import type { ParkingSlot } from '../src/world/haulbay';
import { postSlot } from '../src/world/poislots';
import { roadsideStop, SERVICE_HALF } from '../src/world/settlement';
import {
  BAY_HALF_LENGTH_M,
  BAY_HALF_WIDTH_M,
  BAY_PLAYER_MARGIN_M,
  buildToyBox,
  catalogueCarId,
  inToyBay,
  orderCatalogueCar,
  overlapsToyBay,
  readBaySwap,
  TOY_CATALOGUE,
  type BayFootprint,
  type BayWorld,
} from '../src/world/toybox';
import { buildToyStand, STAND_HALF_D, STAND_HALF_W } from '../src/world/toystand';

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// 1. THE BAY: turned a little off the axes, as one on a curve is.
const bay: ParkingSlot = { x: 100, z: -40, yaw: 0.3, halfWidth: BAY_HALF_WIDTH_M, halfDepth: BAY_HALF_LENGTH_M, s: 0 };
/** A point `along` the bay's length and `across` it (toward its local +X), absolute. */
const at = (along: number, across: number): { x: number; z: number } => ({
  x: bay.x + Math.sin(bay.yaw) * along + Math.cos(bay.yaw) * across,
  z: bay.z + Math.cos(bay.yaw) * along - Math.sin(bay.yaw) * across,
});
{
  const p = at(0, 0);
  check(inToyBay(bay, p.x, p.z), 'the bay holds its own middle');
  const nose = at(BAY_HALF_LENGTH_M - 0.05, BAY_HALF_WIDTH_M - 0.05);
  check(inToyBay(bay, nose.x, nose.z), 'the bay holds a point just inside its corner');
  const past = at(BAY_HALF_LENGTH_M + 0.05, 0);
  check(!inToyBay(bay, past.x, past.z), 'a point past its end is outside the bay');
  const beside = at(0, BAY_HALF_WIDTH_M + 0.05);
  check(!inToyBay(bay, beside.x, beside.z), 'a point past its side is outside the bay');
  check(inToyBay(bay, beside.x, beside.z, 0.1), 'the margin grows the bay');
}
/** A car-sized rectangle, its middle at (`along`, `across`) of the bay, turned `yaw` off it. */
const footprint = (along: number, across: number, yaw = 0, halfWidth = 0.85, halfLength = 2.3): BayFootprint => ({
  ...at(along, across),
  yaw: bay.yaw + yaw,
  halfWidth,
  halfLength,
});
check(overlapsToyBay(bay, footprint(0, 0)), 'a car in the middle reaches into the bay');
check(!overlapsToyBay(bay, footprint(0, BAY_HALF_WIDTH_M + 0.85 + 0.1)), 'a car alongside, 0.1 m off the paint, does not');
check(overlapsToyBay(bay, footprint(0, BAY_HALF_WIDTH_M + 0.85 - 0.1)), 'a car alongside, 0.1 m over the paint, does');
check(!overlapsToyBay(bay, footprint(BAY_HALF_LENGTH_M + 0.85 + 0.1, 0, Math.PI / 2)), 'a car across the end, 0.1 m off, does not');
check(overlapsToyBay(bay, footprint(BAY_HALF_LENGTH_M + 0.85 - 0.1, 0, Math.PI / 2)), 'a car across the end, its flank 0.1 m in, does');
// Turned 45° just off the corner: the corners' boxes overlap, the rectangles do not.
check(!overlapsToyBay(bay, footprint(BAY_HALF_LENGTH_M + 1.75, BAY_HALF_WIDTH_M + 1.75, Math.PI / 4, 0.5, 0.5)), 'a box turned off the corner stays clear');

// 2. TAKE OUT'S RULES.
const MODEL = 'kit_vaz2101';
function car(id: string, papers: boolean): CarState {
  return { id, modelId: MODEL, papers, storage: [], cabin: [], x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } as unknown as CarState;
}
interface Scene {
  readonly state: WorldState;
  readonly where: Map<string, BayFootprint>;
  readonly world: BayWorld;
}
function scene(player: { along: number; across: number }): Scene {
  const state = newWorldState(1);
  const p = at(player.along, player.across);
  state.player.x = p.x;
  state.player.z = p.z;
  state.player.drivingCarId = null;
  state.cars = {};
  state.trailers = {};
  const where = new Map<string, BayFootprint>();
  return { state, where, world: { car: (id) => where.get(id) ?? null, trailer: (id) => where.get(id) ?? null } };
}
/** The player by the stand, outside the bay's margin. */
const STANDING = { along: 0, across: -(BAY_HALF_WIDTH_M + BAY_PLAYER_MARGIN_M + 0.3) };
{
  const { state, world } = scene(STANDING);
  const swap = readBaySwap(state, bay, world);
  check(swap.inCarId === null && swap.refusal === null, `an empty bay swaps nothing in and takes a car out (${swap.refusal})`);
}
{
  const { state, world } = scene(STANDING);
  state.player.drivingCarId = 'mine';
  check(readBaySwap(state, bay, world).refusal === 'step out of the car first', 'from the wheel it refuses');
}
for (const across of [0, -(BAY_HALF_WIDTH_M + BAY_PLAYER_MARGIN_M - 0.1)]) {
  const { state, world } = scene({ along: 1, across });
  check(readBaySwap(state, bay, world).refusal === 'step out of the bay', `the player ${across.toFixed(2)} m across the bay is told to step out of it`);
}
{
  const { state, where, world } = scene(STANDING);
  state.cars.mine = car('mine', true);
  state.cars.spare = car('spare', true);
  state.player.lastDrivenCarId = 'mine';
  where.set('mine', footprint(0.8, 0.1));
  where.set('spare', footprint(-0.2, 0));
  const swap = readBaySwap(state, bay, world);
  check(swap.inCarId === 'mine', `the last driven car goes in (${swap.inCarId})`);
  check(swap.refusal?.startsWith('move your ') === true, `a second car of his in the bay is moved out first (${swap.refusal})`);
}
{
  const { state, where, world } = scene(STANDING);
  state.cars.mine = car('mine', true);
  where.set('mine', footprint(0.3, -0.2));
  const swap = readBaySwap(state, bay, world);
  check(swap.inCarId === 'mine' && swap.refusal === null, `his car in the bay goes in (${swap.inCarId}, ${swap.refusal})`);
}
{
  const { state, where, world } = scene(STANDING);
  state.cars.mine = car('mine', true);
  where.set('mine', footprint(BAY_HALF_LENGTH_M + 1.5, 0));
  const swap = readBaySwap(state, bay, world);
  check(swap.inCarId === null && swap.refusal?.startsWith('drive the ') === true, `his car half in is told to drive in (${swap.refusal})`);
}
{
  const { state, where, world } = scene(STANDING);
  state.cars.lot = car('lot', false);
  where.set('lot', footprint(0, BAY_HALF_WIDTH_M + 0.5));
  const swap = readBaySwap(state, bay, world);
  check(swap.refusal?.startsWith('the bay is taken: a ') === true, `someone else's car reaching in refuses it (${swap.refusal})`);
}
{
  const { state, where, world } = scene(STANDING);
  state.trailers.t = { id: 't', hitchedTo: null, cargoKg: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } as TrailerState;
  where.set('t', footprint(-BAY_HALF_LENGTH_M - 0.9, 0, 0, 0.8, 2.0));
  check(readBaySwap(state, bay, world).refusal === 'the bay is taken: a trailer stands in it', 'a trailer reaching in refuses it');
}
{
  const { state, where, world } = scene(STANDING);
  state.cars.mine = car('mine', true);
  where.set('mine', footprint(0, 0));
  state.trailers.t = { id: 't', hitchedTo: 'mine', cargoKg: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } as TrailerState;
  const swap = readBaySwap(state, bay, world);
  check(swap.inCarId === 'mine' && swap.refusal?.startsWith('unhitch the ') === true, `a hitched car is refused by boxRefusal (${swap.refusal})`);
}

// 3. THE STANDS.
const flat = { heightAt: () => 0 };
const headless = { terrain: flat, originX: 0, originZ: 0, hasPhysics: false } as unknown as ChunkContext;
const [alongHalf, acrossHalf] = SERVICE_HALF.toybox;
check(alongHalf >= STAND_HALF_W && acrossHalf >= STAND_HALF_D, `SERVICE_HALF.toybox ${alongHalf} x ${acrossHalf} keeps the stand's footprint clear`);
for (const stand of TOY_STANDS) {
  const group = new THREE.Group();
  const disposers: Array<() => void> = [];
  const parts = buildToyStand(headless, 0, 0, 0, 0, stand, group, [], [], disposers);
  check(parts.root.parent === group, `${stand}: the stand is in the chunk's group`);
  for (const part of [parts.wheel, parts.buttonCap, parts.turntable]) {
    check(part.parent === parts.root && part.children.length > 0, `${stand}: the ${part.name || 'moving part'} is its own node, with its meshes`);
  }
  const box = new THREE.Box3().setFromObject(parts.root);
  check(box.min.x >= -STAND_HALF_W - 0.02 && box.max.x <= STAND_HALF_W + 0.02, `${stand}: ${box.min.x.toFixed(2)}…${box.max.x.toFixed(2)} m across, inside ±${STAND_HALF_W}`);
  check(box.min.z >= -STAND_HALF_D - 0.02 && box.max.z <= STAND_HALF_D + 0.02, `${stand}: ${box.min.z.toFixed(2)}…${box.max.z.toFixed(2)} m deep, inside ±${STAND_HALF_D}`);
  for (const { c, h } of parts.layout.solids) {
    check(Math.abs(c[0]) + h[0] <= STAND_HALF_W + 0.02 && Math.abs(c[2]) + h[2] <= STAND_HALF_D + 0.02, `${stand}: a solid at ${c.join(', ')} reaches out of the footprint`);
  }
  const layout = parts.layout;
  check(layout.reach > layout.ride + layout.inner, `${stand}: the model has room between its pole and its reach`);
  let draws = 0;
  parts.root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) draws++;
  });
  check(draws <= 24, `${stand}: ${draws} meshes after the merge`);
  for (const dispose of disposers) dispose();
  console.log(`  ${stand}: ${draws} meshes, ${(box.max.x - box.min.x).toFixed(2)} x ${(box.max.z - box.min.z).toFixed(2)} x ${box.max.y.toFixed(2)} m`);
}
{
  const seed = 1337;
  const stop = roadsideStop(seed, postSlot(3));
  check(stop?.layout.toybox != null, 'post 3 has a toy box');
  if (stop?.layout.toybox) {
    // A straight road along +Z, laterals to its left: enough for the pure plan to stand on.
    const road = {
      offsetPoint: (s: number, lateral: number) => ({ x: lateral, y: 0, z: s }),
      headingAt: () => 0,
    };
    const ctx = { ...headless, road, world: new GameWorld(newWorldState(seed)) } as unknown as ChunkContext;
    const group = new THREE.Group();
    const disposers: Array<() => void> = [];
    buildToyBox(ctx, { index: 3, s: stop.roll.s }, stop.layout.toybox, group, [], [], { register: () => '' } as never, [], disposers);
    check(group.getObjectByName('toy-bay') !== undefined, 'the toy box paints its bay');
    for (const dispose of disposers) dispose();
  }
}

// 4. THE CATALOGUE.
{
  const ids = CAR_MODELS.map((def) => def.id);
  check(TOY_CATALOGUE.length === ids.length && ids.every((id) => TOY_CATALOGUE.includes(id)), `the catalogue holds every car of the game once (${TOY_CATALOGUE.length}/${ids.length})`);
  check(TOY_CATALOGUE.every((id, i) => i === 0 || carShells(TOY_CATALOGUE[i - 1]!) <= carShells(id)), 'the catalogue runs cheapest first');
  const seeds = Array.from({ length: 3 }, () => Math.floor(Math.random() * 0x100000000) >>> 0);
  console.log(`  catalogue seeds ${seeds.join(', ')}`);
  for (const seed of seeds) {
    const world = new GameWorld(newWorldState(seed));
    const modelId = TOY_CATALOGUE[Math.floor(Math.random() * TOY_CATALOGUE.length)]!;
    const price = carShells(modelId);
    world.apply({ t: 'shells', shells: price - 1 });
    check(orderCatalogueCar(world, modelId, (count) => debit(world, count)) === null, `${seed}: one shell short, BUY refuses`);
    check(world.state.player.shells === price - 1 && Object.keys(world.state.toyBox).length === 0, `${seed}: a refused BUY takes nothing and boxes nothing`);
    world.apply({ t: 'shells', shells: price * 2 + 3 });
    const shown = factoryPaintHex(modelId, catalogueCarId(seed, world.state, modelId));
    const first = orderCatalogueCar(world, modelId, (count) => debit(world, count));
    const bought = first ? world.state.toyBox[first] : undefined;
    check(bought?.papers === true && bought.modelId === modelId && !world.state.cars[first!], `${seed}: the bought ${modelId} is his, in the box`);
    check(world.state.player.shells === price + 3, `${seed}: BUY took ${price} shells (${world.state.player.shells} left of ${price * 2 + 3})`);
    check(bought !== undefined && visiblePaintHex(bought.paint, modelId, bought.id) === shown, `${seed}: the bought car wears the paint its model showed`);
    const second = orderCatalogueCar(world, modelId, (count) => debit(world, count));
    check(second !== null && second !== first && Object.keys(world.state.toyBox).length === 2, `${seed}: a second one is a second car (${first}, ${second})`);
    check(world.state.player.shells === 3, `${seed}: the second took its price too (${world.state.player.shells} left)`);
    const loaded = decodeSaveCode(encodeSaveCode(world.state));
    check(loaded.toyBox[first!]?.papers === true && loaded.toyBox[second!]?.papers === true, `${seed}: the bought cars load boxed and his`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} toy box checks failed`);
}
console.log('\nthe bay keeps the player and the cars apart, and every stand builds');
