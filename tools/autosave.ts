import { GameWorld, newWorldState, type WorldState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { decodeSaveCode, encodeSaveCode, installVehicleAutosave } from '../src/save/save';
import { DEFAULT_CAR_MODEL_ID } from '../src/vehicle/carmodels';
import { TRUNK_CELL_COUNT } from '../src/vehicle/trunk';
import { COLD_SOAK_C } from '../src/vehicle/cooling';

interface SavedCall {
  id: string;
  name: string;
  state: WorldState;
}

const calls: SavedCall[] = [];
const backend = {
  async save(id: string, name: string, state: WorldState): Promise<void> {
    calls.push({ id, name, state: structuredClone(state) });
  },
};

const initial = newWorldState(1337);
initial.cars['car:test'] = {
  id: 'car:test',
  modelId: DEFAULT_CAR_MODEL_ID,
  stickers: [],
  headlightMode: 'off',
  taillightsOn: false,
  reverseLightsOn: false,
  fuelLitres: 20,
  dirt: 0,
  scratches: 0,
  dents: [],
  waterLitres: 4,
  oilLitres: 3,
  engineTempC: COLD_SOAK_C,
  storage: new Array<Item | null>(TRUNK_CELL_COUNT).fill(null),
  odometer: 50,
  x: 0,
  y: 1,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
};
initial.trailers['trailer:test'] = {
  id: 'trailer:test',
  hitchedTo: null,
  cargoKg: 120,
  x: 0,
  y: 1,
  z: -4,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
};

const world = new GameWorld(initial);
let failure: unknown = null;
let prepareCalls = 0;
const stateForSave = (): WorldState => {
  prepareCalls++;
  world.apply({
    t: 'car_transform',
    carId: 'car:test',
    x: 100 + prepareCalls,
    y: 2,
    z: 3,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  world.apply({
    t: 'trailer_transform',
    trailerId: 'trailer:test',
    x: 200 + prepareCalls,
    y: 2,
    z: -5,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  return world.state;
};
const stop = installVehicleAutosave(
  backend,
  world,
  stateForSave,
  (state) => `drive @ ${state.player.s.toFixed(0)} m`,
  (error) => {
    failure = error;
  },
);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${detail}`);
}

world.apply({ t: 'time_of_day', timeOfDay: 100 });
await Promise.resolve();
check('unrelated delta does not save', calls.length === 0, `${calls.length} writes`);

const wrench: Item = { type: 'tool', id: 'rt:trunk', tool: 'wrench', integrity: 0.8 };
world.apply({ t: 'car_storage', carId: 'car:test', cell: 3, item: wrench });
await Promise.resolve();
check('trunk mutation autosaves', calls.length === 1, `${calls.length} writes`);
check('trunk item is captured', calls[0]?.state.cars['car:test']?.storage[3]?.id === wrench.id, calls[0]?.state.cars['car:test']?.storage[3]?.id ?? 'missing');
check('car runtime state is flushed', calls[0]?.state.cars['car:test']?.x === 101, `x ${calls[0]?.state.cars['car:test']?.x}`);
check('trailer runtime state is flushed', calls[0]?.state.trailers['trailer:test']?.x === 201, `x ${calls[0]?.state.trailers['trailer:test']?.x}`);

world.apply({ t: 'trailer_hitch', trailerId: 'trailer:test', carId: 'car:test' });
await Promise.resolve();
check('trailer mutation autosaves', calls.length === 2, `${calls.length} writes`);
check('trailer hitch is captured', calls[1]?.state.trailers['trailer:test']?.hitchedTo === 'car:test', String(calls[1]?.state.trailers['trailer:test']?.hitchedTo));

world.apply({ t: 'enter_car', carId: 'car:test' });
await Promise.resolve();
check('entering writes one autosave', calls.length === 3, `${calls.length} writes`);
check('enter state is captured', calls[2]?.state.player.drivingCarId === 'car:test', String(calls[2]?.state.player.drivingCarId));
check('autosave uses world slot', calls[2]?.id === 'slot-1337', calls[2]?.id ?? 'missing');

world.apply({ t: 'exit_car' });
// Interaction teleports after emitting exit_car. The queued autosave must observe this
// following move rather than snapshotting synchronously inside the exit listener.
world.apply({ t: 'player_move', x: 42, y: 3, z: -7, yaw: 0, pitch: 0, s: 900 });
await Promise.resolve();
check('exiting writes another autosave', calls.length === 4, `${calls.length} writes`);
check('exit state is captured', calls[3]?.state.player.drivingCarId === null, String(calls[3]?.state.player.drivingCarId));
check('exit position is captured', calls[3]?.state.player.x === 42 && calls[3]?.state.player.s === 900, `x ${calls[3]?.state.player.x}, s ${calls[3]?.state.player.s}`);
check('exit save name uses final position', calls[3]?.name === 'drive @ 900 m', calls[3]?.name ?? 'missing');
check('autosave reports no failure', failure === null, failure === null ? 'none' : String(failure));

const roundTrip = decodeSaveCode(encodeSaveCode(calls[3]!.state));
check('save code keeps trunk item', roundTrip.cars['car:test']?.storage[3]?.id === wrench.id, roundTrip.cars['car:test']?.storage[3]?.id ?? 'missing');
check('save code keeps car pose', roundTrip.cars['car:test']?.x === 104, `x ${roundTrip.cars['car:test']?.x}`);
check('save code keeps trailer state', roundTrip.trailers['trailer:test']?.x === 204 && roundTrip.trailers['trailer:test']?.hitchedTo === 'car:test', `x ${roundTrip.trailers['trailer:test']?.x}, hitch ${roundTrip.trailers['trailer:test']?.hitchedTo}`);

// Body condition. Dust accumulates every tick and is not itself a save trigger, but the
// next save must carry it; a dent is saved the moment it is recorded, and a dent on a
// car the world does not keep (traffic runs in its own world) must not write at all.
world.apply({ t: 'car_body_condition', carId: 'car:test', dirt: 0.42, scratches: 0.17 });
await Promise.resolve();
check('dust alone does not save', calls.length === 4, `${calls.length} writes`);
const dent = { x: 0.1, y: 0.2, z: 2.1, nx: 0, ny: 0, nz: -1, radius: 0.5, depth: 0.2 };
world.apply({ t: 'car_body_dent', carId: 'car:test', dent });
await Promise.resolve();
check('a dent autosaves', calls.length === 5, `${calls.length} writes`);
const dented = calls[4]?.state.cars['car:test'];
check(
  'the autosave keeps dust and the dent',
  dented?.dirt === 0.42 && dented.scratches === 0.17 && dented.dents.length === 1 && dented.dents[0]?.depth === 0.2,
  `dirt ${dented?.dirt}, scratches ${dented?.scratches}, dents ${dented?.dents.length}`,
);
const bodyRoundTrip = decodeSaveCode(encodeSaveCode(calls[4]!.state)).cars['car:test'];
check(
  'save code keeps dust and the dent',
  bodyRoundTrip?.dirt === 0.42 &&
    bodyRoundTrip.dents.length === 1 &&
    JSON.stringify(bodyRoundTrip.dents[0]) === JSON.stringify(dent),
  JSON.stringify(bodyRoundTrip?.dents),
);
world.apply({ t: 'car_body_dent', carId: 'traffic:elsewhere', dent });
await Promise.resolve();
check('a dent on a car the world does not keep does not save', calls.length === 5, `${calls.length} writes`);

stop();
world.apply({
  t: 'car_lights',
  carId: 'car:test',
  headlightMode: 'high',
  taillightsOn: true,
  reverseLightsOn: true,
});
const lightRoundTrip = decodeSaveCode(encodeSaveCode(world.state));
check(
  'save code keeps all lamp states',
  lightRoundTrip.cars['car:test']?.headlightMode === 'high' &&
    lightRoundTrip.cars['car:test']?.taillightsOn === true &&
    lightRoundTrip.cars['car:test']?.reverseLightsOn === true,
  JSON.stringify(lightRoundTrip.cars['car:test']),
);
world.apply({ t: 'enter_car', carId: 'car:test' });
await Promise.resolve();
check('unsubscribe stops autosaves', calls.length === 5, `${calls.length} writes`);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
