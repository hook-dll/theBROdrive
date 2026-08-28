import { GameWorld, newWorldState, type WorldState } from '../src/game/state';
import { installVehicleAutosave } from '../src/save/save';

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

const world = new GameWorld(newWorldState(1337));
let failure: unknown = null;
const stop = installVehicleAutosave(
  backend,
  world,
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

world.apply({ t: 'enter_car', carId: 'car:test' });
await Promise.resolve();
check('entering writes one autosave', calls.length === 1, `${calls.length} writes`);
check('enter state is captured', calls[0]?.state.player.drivingCarId === 'car:test', String(calls[0]?.state.player.drivingCarId));
check('autosave uses world slot', calls[0]?.id === 'slot-1337', calls[0]?.id ?? 'missing');

world.apply({ t: 'exit_car' });
// Interaction teleports after emitting exit_car. The queued autosave must observe this
// following move rather than snapshotting synchronously inside the exit listener.
world.apply({ t: 'player_move', x: 42, y: 3, z: -7, yaw: 0, pitch: 0, s: 900 });
await Promise.resolve();
check('exiting writes another autosave', calls.length === 2, `${calls.length} writes`);
check('exit state is captured', calls[1]?.state.player.drivingCarId === null, String(calls[1]?.state.player.drivingCarId));
check('exit position is captured', calls[1]?.state.player.x === 42 && calls[1]?.state.player.s === 900, `x ${calls[1]?.state.player.x}, s ${calls[1]?.state.player.s}`);
check('exit save name uses final position', calls[1]?.name === 'drive @ 900 m', calls[1]?.name ?? 'missing');
check('autosave reports no failure', failure === null, failure === null ? 'none' : String(failure));

stop();
world.apply({ t: 'enter_car', carId: 'car:test' });
await Promise.resolve();
check('unsubscribe stops autosaves', calls.length === 2, `${calls.length} writes`);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
