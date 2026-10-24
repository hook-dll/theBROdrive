/**
 * Boot grid checks: every model's grid is a rectangle the aim ray resolves cell by
 * cell, cells count left to right from behind, and the boy's things take their
 * footprint's cells (vehicle/trunk.ts): a 2×2 TV blocks four cells of a 4×2 boot, comes
 * out whole from any of them, is refused by a 2×2 Oka boot with something already in
 * it, and a save keeps it at its anchor while dropping a thing that no longer fits.
 *
 *   bun tools/trunk-grid.ts
 */
import * as THREE from 'three';
import { GameWorld, newWorldState } from '../src/game/state';
import { createServiceableCarState } from '../src/game/spawn';
import { migrateState } from '../src/save/save';
import { makeContract } from '../src/contracts/offers';
import { Inventory, type BubbleGumItem } from '../src/items/items';
import { operateTrunkCell } from '../src/player/interaction';
import { CAR_MODELS, carModel } from '../src/vehicle/carmodels';
import {
  bootOwner,
  intersectStorageGrid,
  storageCellBox,
  trunkCellCount,
  type TrunkGridRayHit,
} from '../src/vehicle/trunk';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
}

check(
  'every catalogue body has a rectangular boot of 4..16',
  CAR_MODELS.every((model) => trunkCellCount(model.trunkGrid) >= 4 && trunkCellCount(model.trunkGrid) <= 16),
  CAR_MODELS.map((model) => `${model.id.replace('kit_', '')} ${model.trunkGrid.columns}x${model.trunkGrid.rows}`).join(' '),
);

const centre = new THREE.Vector3();
const size = new THREE.Vector3();
const eye = new THREE.Vector3();
const direction = new THREE.Vector3(0, 0, 1);
const rayHit: TrunkGridRayHit = { cell: -1, distance: 0 };
for (const modelId of ['kit_vaz2110', 'kit_vaz1111', 'kit_uaz2206']) {
  const grid = carModel(modelId).trunkGrid;
  const shape = { halfExtents: [0.9, 0.65, 2.1] as const, trunkGrid: grid };
  const count = trunkCellCount(grid);
  let selectedAll = true;
  const xs: number[] = [];
  for (let cell = 0; cell < count; cell++) {
    storageCellBox(cell, shape, 'trunk', centre, size);
    xs.push(centre.x);
    eye.copy(centre).addScaledVector(direction, -1);
    if (!intersectStorageGrid(eye, direction, shape, 'trunk', rayHit) || rayHit.cell !== cell) selectedAll = false;
  }
  check(`${modelId}: aim ray selects every cell`, selectedAll, `${count} cells`);
  // Read from behind the car looking along +Z the player's left is +X: each next cell
  // of a row further right (lower X).
  let leftToRight = true;
  for (let cell = 0; cell < count; cell++) {
    if ((cell + 1) % grid.columns !== 0 && !(xs[cell]! > xs[cell + 1]!)) leftToRight = false;
  }
  check(`${modelId}: cells count left to right from behind`, leftToRight, xs.map((x) => x.toFixed(2)).join(' '));
}

const state = newWorldState(1337);
const wide = createServiceableCarState('car:2110', 'kit_vaz2110', 0, 1, 0, 0);
const oka = createServiceableCarState('car:oka', 'kit_vaz1111', 10, 1, 0, 0);
state.cars[wide.id] = wide;
state.cars[oka.id] = oka;
const world = new GameWorld(state);
const wideGrid = carModel(wide.modelId).trunkGrid;
const okaGrid = carModel(oka.modelId).trunkGrid;
check('2110 boot is 4x2, Oka 2x2', wideGrid.columns === 4 && wideGrid.rows === 2 && okaGrid.columns === 2 && okaGrid.rows === 2, `${wideGrid.columns}x${wideGrid.rows}, ${okaGrid.columns}x${okaGrid.rows}`);

const inventory = new Inventory();
const tv = makeContract(state.seed, 'test:tv', 0, 'tv_set', 11);
inventory.add(tv);
// Aimed at the bottom-right cell of columns 2..3: the TV anchors up and left of it.
let result = operateTrunkCell(wide.storage, wideGrid, 7, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: wide.id, cell: result.cell, item: result.item });
const covered = [2, 3, 6, 7].every((cell) => bootOwner(wide.storage, wideGrid, cell) === 2);
const free = [0, 1, 4, 5].every((cell) => bootOwner(wide.storage, wideGrid, cell) === -1);
check('TV stows at the anchor covering the aimed cell', result.action === 'stored' && result.cell === 2 && wide.storage[2] === tv, `${result.action} at ${result.cell}`);
check('TV blocks its four cells and only them', covered && free, wide.storage.map((item) => item?.id ?? '-').join(' '));

const gum: BubbleGumItem = { type: 'bubble_gum', id: 'gum', charges: 5 };
inventory.add(gum);
result = operateTrunkCell(wide.storage, wideGrid, 6, inventory.held, inventory);
check('a cell the TV covers gives the TV back, whole', result.action === 'retrieved' && result.cell === 2, `${result.action} at ${result.cell}`);
world.apply({ t: 'car_storage', carId: wide.id, cell: result.cell, item: result.item });
check('the boot is empty after', wide.storage.every((item) => item === null) && inventory.find(tv.id) === tv, `${inventory.all.length} carried`);

// The Oka: a gum in one cell leaves no 2x2 anywhere.
inventory.remove(tv.id);
result = operateTrunkCell(oka.storage, okaGrid, 0, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: oka.id, cell: result.cell, item: result.item });
inventory.add(tv);
result = operateTrunkCell(oka.storage, okaGrid, 3, inventory.held, inventory);
check('Oka with a gum inside refuses the TV', result.action === 'refused' && inventory.find(tv.id) === tv, result.action);
// Empty, the Oka takes it.
oka.storage.fill(null);
result = operateTrunkCell(oka.storage, okaGrid, 3, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: oka.id, cell: result.cell, item: result.item });
check('empty Oka takes the TV across its whole boot', result.action === 'stored' && result.cell === 0, `${result.action} at ${result.cell}`);

// Fishing rods take a strip of four: never in a two-wide boot.
const rods = makeContract(state.seed, 'test:rods', 0, 'fishing_rods', 12);
inventory.add(rods);
oka.storage.fill(null);
result = operateTrunkCell(oka.storage, okaGrid, 0, inventory.held, inventory);
check('Oka refuses the 1x4 fishing rods', result.action === 'refused', result.action);
result = operateTrunkCell(wide.storage, wideGrid, 5, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: wide.id, cell: result.cell, item: result.item });
check('2110 takes the rods across its bottom row', result.action === 'stored' && result.cell === 4, `${result.action} at ${result.cell}`);

// A save keeps the rods at their anchor and drops what overlaps them.
const saved = structuredClone(state);
saved.cars[wide.id]!.storage[5] = { type: 'bubble_gum', id: 'overlap', charges: 1 };
saved.cars[wide.id]!.storage[0] = { type: 'bubble_gum', id: 'fine', charges: 1 };
const loaded = migrateState(saved);
const boot = loaded.cars[wide.id]!.storage;
check(
  'save keeps anchors, drops an overlapping item',
  boot[4]?.id === rods.id && boot[5] === null && boot[0]?.id === 'fine',
  boot.map((item) => item?.id ?? '-').join(' '),
);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
