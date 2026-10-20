import * as THREE from 'three';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { migrateState } from '../src/save/save';
import { generateContractOffer, postStock } from '../src/contracts/offers';
import { Inventory, type BubbleGumItem } from '../src/items/items';
import { operateTrunkCell } from '../src/player/interaction';
import { CAR_MODELS, DEFAULT_CAR_MODEL_ID } from '../src/vehicle/carmodels';
import {
  intersectStorageGrid,
  storageCellBox,
  TRUNK_CELL_COUNT,
  type TrunkGridRayHit,
} from '../src/vehicle/trunk';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { emptyCabin } from '../src/vehicle/cabin';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
}

const state = newWorldState(1337);
const car: CarState = {
  id: 'car:test',
  modelId: DEFAULT_CAR_MODEL_ID,
  headlightMode: 'off',
  taillightsOn: false,
  reverseLightsOn: false,
  stickers: [],
  fuelLitres: 10,
  dirt: 0,
  scratches: 0,
  paint: null,
  damage: [],
  waterLitres: 4,
  oilLitres: 4,
  engineTempC: COLD_SOAK_C,
  storage: new Array(TRUNK_CELL_COUNT).fill(null),
  cabin: emptyCabin(),
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
// A save from the courier days: a wreck's trunk (gone with the wrecks) and a courier's
// eight-cell boot holding three of its offers and an envelope left behind.
Object.assign(oldSave, {
  wreckStorage: { 'wreck:test': [{ type: 'bubble_gum', id: 'wreck:0', charges: 3 }] },
  wreckBonnet: { 'wreck:test': [null, null, null, null] },
});
const oldOffers = [0, 2, 3].map((slot) => generateContractOffer(oldSave.seed, 4, slot));
oldSave.courierStorage['courier:4'] = [
  oldOffers[0]!, null, oldOffers[1]!, oldOffers[2]!,
  { type: 'sticker_envelope', id: 'courier:3:offer:0:signed:4', stickerKind: oldOffers[0]!.rewardStickerKind, completedContractId: 'courier:3:offer:0' },
  null, null, null,
];
const migrated = migrateState(oldSave);
check(
  'old car storage expands without loss',
  migrated.cars[car.id]!.storage.length === 8 && migrated.cars[car.id]!.storage[2]?.id === 'old:2',
  `${migrated.cars[car.id]!.storage.length} cells`,
);
const stock = postStock(migrated, migrated.seed, 4);
check(
  'courier-era save loads: wreck storage dropped, the boot reads as the post stock',
  !('wreckStorage' in migrated) && !('wreckBonnet' in migrated)
    && stock.offers.map((offer) => offer !== null).join() === 'true,false,true,true'
    && stock.strays.length === 1 && stock.strays[0]!.type === 'sticker_envelope',
  `offers ${stock.offers.map((offer) => (offer ? 'x' : '-')).join('')} · strays ${stock.strays.length}`,
);

const shape = { halfExtents: [0.9, 0.65, 2.1] as const };
const centre = new THREE.Vector3();
const size = new THREE.Vector3();
const eye = new THREE.Vector3();
const direction = new THREE.Vector3(0, 0, 1);
const rayHit: TrunkGridRayHit = { cell: -1, distance: 0 };
let selectedAll = true;
for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
  storageCellBox(cell, shape, 'trunk', centre, size);
  eye.copy(centre).addScaledVector(direction, -1);
  if (!intersectStorageGrid(eye, direction, shape, 'trunk', rayHit) || rayHit.cell !== cell) {
    selectedAll = false;
  }
}
check('aim ray selects all eight cells', selectedAll, selectedAll ? '0..7 exact' : `stopped at ${rayHit.cell}`);

// The trunk is read from behind the car, looking along chassis +Z, so the player's
// left is +X: cell 1 must sit there and each next cell further right (lower X).
const trunkXs: number[] = [];
for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
  storageCellBox(cell, shape, 'trunk', centre, size);
  trunkXs.push(centre.x);
}
const leftToRight = [0, 1, 2, 4, 5, 6].every((cell) => trunkXs[cell]! > trunkXs[cell + 1]!);
check('trunk cells count left to right from behind', leftToRight, trunkXs.map((x) => x.toFixed(2)).join(' '));

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
