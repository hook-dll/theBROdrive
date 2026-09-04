import * as THREE from 'three';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { migrateState } from '../src/save/save';
import { Inventory, type BubbleGumItem } from '../src/items/items';
import { operateTrunkCell } from '../src/player/interaction';
import { CAR_MODELS, DEFAULT_CAR_MODEL_ID } from '../src/vehicle/carmodels';
import {
  intersectTrunkGrid,
  TRUNK_CELL_COUNT,
  trunkCellLocal,
  type TrunkGridRayHit,
} from '../src/vehicle/trunk';
import { COLD_SOAK_C } from '../src/vehicle/cooling';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
}

const state = newWorldState(1337);
const car: CarState = {
  id: 'car:test',
  modelId: DEFAULT_CAR_MODEL_ID,
  gizmos: {},
  headlightMode: 'off',
  taillightsOn: false,
  reverseLightsOn: false,
  stickers: [],
  fuelLitres: 10,
  dirt: 0,
  scratches: 0,
  waterLitres: 4,
  oilLitres: 4,
  engineTempC: COLD_SOAK_C,
  storage: new Array(TRUNK_CELL_COUNT).fill(null),
  odometer: 0,
  x: 0,
  y: 1,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
};
state.cars[car.id] = car;
const world = new GameWorld(state);

check(
  'every catalogue body has 4x2 trunk',
  CAR_MODELS.every((model) => model.storageCells === TRUNK_CELL_COUNT),
  `${CAR_MODELS.length} models at ${TRUNK_CELL_COUNT} cells`,
);

const oldSave = structuredClone(state);
oldSave.cars[car.id]!.storage.splice(
  0,
  oldSave.cars[car.id]!.storage.length,
  { type: 'bubble_gum', id: 'old:0', charges: 5 },
  null,
  { type: 'bubble_gum', id: 'old:2', charges: 4 },
);
oldSave.wreckStorage['wreck:test'] = [{ type: 'bubble_gum', id: 'wreck:0', charges: 3 }];
const migrated = migrateState(oldSave);
check(
  'old car storage expands without loss',
  migrated.cars[car.id]!.storage.length === 8 && migrated.cars[car.id]!.storage[2]?.id === 'old:2',
  `${migrated.cars[car.id]!.storage.length} cells`,
);
check(
  'wreck storage persists as eight cells',
  migrated.wreckStorage['wreck:test']?.length === 8 && migrated.wreckStorage['wreck:test']?.[0]?.id === 'wreck:0',
  `${migrated.wreckStorage['wreck:test']?.length ?? 0} cells`,
);

const half: readonly [number, number, number] = [0.9, 0.65, 2.1];
const centre = new THREE.Vector3();
const eye = new THREE.Vector3();
const direction = new THREE.Vector3(0, 0, 1);
const rayHit: TrunkGridRayHit = { cell: -1, distance: 0 };
let selectedAll = true;
for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
  trunkCellLocal(cell, half, centre);
  eye.copy(centre).addScaledVector(direction, -1);
  if (!intersectTrunkGrid(eye, direction, half, rayHit) || rayHit.cell !== cell) selectedAll = false;
}
check('aim ray selects all eight cells', selectedAll, selectedAll ? '0..7 exact' : `stopped at ${rayHit.cell}`);

const held: BubbleGumItem = { type: 'bubble_gum', id: 'held', charges: 5 };
const storedA: BubbleGumItem = { type: 'bubble_gum', id: 'stored:a', charges: 4 };
const storedB: BubbleGumItem = { type: 'bubble_gum', id: 'stored:b', charges: 3 };
car.storage[1] = storedA;
car.storage[6] = storedB;
const inventory = new Inventory();
inventory.add(held);
let result = operateTrunkCell(car.storage, 1, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: car.id, cell: 1, item: result.item });
check(
  'occupied cell retrieves while holding item',
  car.storage[1] === null && inventory.find(storedA.id) === storedA && inventory.find(held.id) === held,
  `${inventory.all.length} carried`,
);
result = operateTrunkCell(car.storage, 3, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: car.id, cell: 3, item: result.item });
check(
  'aimed empty cell receives held item',
  car.storage[3]?.id === held.id && inventory.find(held.id) === null,
  car.storage[3]?.id ?? 'empty',
);
result = operateTrunkCell(car.storage, 6, inventory.held, inventory);
world.apply({ t: 'car_storage', carId: car.id, cell: 6, item: result.item });
check(
  'second non-last item remains retrievable',
  car.storage[6] === null && inventory.find(storedB.id) === storedB,
  `${inventory.all.length} carried`,
);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
