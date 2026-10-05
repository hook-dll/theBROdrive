/**
 * The per-tick driver. It walks the four places a contract cargo can be, finds each
 * one's carrying car, and lets the matching kind advance its progress.
 *
 * Progress lives on the item (`ContractProgress`), so this class is the only writer
 * and every read — the HUD label, the reward at delivery, the save — sees the same
 * record wherever the item happens to be. `lastPlace` is runtime-only: it exists to
 * notice a drop (a hand or a boot to the ground), which is a transition, not a state.
 *
 * The tick scans state rather than holding its own list of contracts, so an item
 * picked up, swapped into another boot or dropped is followed with no bookkeeping.
 * There are at most a handful of live contracts, and the per-item context object is
 * reused, so a tick allocates nothing beyond the car telemetry the composition root
 * hands back.
 */

import type { GameWorld } from '../game/state';
import type { ContractCargoItem, Item } from '../items/items';
import type { ContractGate } from './gates';
import { contractKindDef } from './registry';
import {
  defaultProgress,
  type ContractCarSnapshot,
  type ContractCarTelemetry,
  type ContractPlace,
} from './types';

export interface ContractTickInput {
  readonly dt: number;
  readonly timeOfDay: number;
  readonly dayLength: number;
  /** Air temperature now, degrees C (`ambientAirC`). */
  readonly ambientC: number;
  /** Live telemetry for a car by id, or null when it has no Vehicle. */
  readonly carTelemetry: (carId: string) => ContractCarTelemetry | null;
  /**
   * Live look at any car by id, for kinds that own a second car (a towed car, an
   * escort). Optional so a bench can tick without a world.
   */
  readonly carById?: (carId: string) => ContractCarSnapshot | null;
  /**
   * Every live cargo item, once per tick, with where it is and which car carries it.
   * The composition root uses it to keep the contract's own world objects (a loaded
   * trailer, a car to be transferred) spawned exactly once: the callback only fires
   * for cargo that exists, so a delivered one cannot be re-created.
   */
  readonly onContractItem?: (
    item: ContractCargoItem,
    place: ContractPlace,
    carId: string | null,
  ) => void;
  /** Optional one-line notice when a contract crosses into a lost-bonus state. */
  readonly onNotice?: (text: string) => void;
  /**
   * The gate sequence of a gate contract, or null. Rebuilt by the composition root
   * from the offer seed and the road geometry; see `ContractTickContext.gatesFor`.
   */
  readonly gatesFor?: (item: ContractCargoItem) => readonly ContractGate[] | null;
}

function isCargo(item: Item | null | undefined): item is ContractCargoItem {
  return item?.type === 'contract_cargo';
}

/** `ContractTickContext` with writable fields, so one instance can be reused. */
interface MutableTickContext {
  dt: number;
  nowS: number;
  item: ContractCargoItem;
  timeOfDay: number;
  dayLength: number;
  ambientC: number;
  place: ContractPlace;
  car: ContractCarTelemetry | null;
  droppedThisTick: boolean;
  carById: ((carId: string) => ContractCarSnapshot | null) | undefined;
  gatesFor: ((item: ContractCargoItem) => readonly ContractGate[] | null) | undefined;
}

/**
 * The context's `item` before the first `visit` assigns the real cargo. No kind reads
 * it outside `step`, which only ever runs for a real item, so this is never observed;
 * it exists so the reused context can be built without a cast.
 */
const IDLE_CARGO: ContractCargoItem = {
  type: 'contract_cargo',
  id: '',
  sourceCourierIndex: -1,
  contractKind: 'parcel',
  cargoName: '',
  rewardStickerKind: 'star',
  generatedSeed: 0,
  progress: defaultProgress(),
};

export class ContractRuntime {
  private readonly lastPlace = new Map<string, ContractPlace>();
  private readonly seen = new Set<string>();
  private readonly ctx: MutableTickContext = {
    dt: 0,
    nowS: 0,
    item: IDLE_CARGO,
    timeOfDay: 0,
    dayLength: 0,
    ambientC: 0,
    place: 'courier',
    car: null,
    droppedThisTick: false,
    carById: undefined,
    gatesFor: undefined,
  };

  constructor(private readonly world: GameWorld) {}

  tick(input: ContractTickInput): void {
    const state = this.world.state;
    this.seen.clear();

    for (const item of state.player.carried) {
      if (isCargo(item)) this.visit(item, 'hand', null, input);
    }
    for (const carId of Object.keys(state.cars)) {
      const car = state.cars[carId];
      if (!car) continue;
      for (const item of car.storage) {
        if (isCargo(item)) this.visit(item, 'car', carId, input);
      }
    }
    for (const key of Object.keys(state.looseItems)) {
      const item = state.looseItems[key]?.item;
      if (isCargo(item)) this.visit(item, 'loose', null, input);
    }
    for (const key of Object.keys(state.courierStorage)) {
      const cells = state.courierStorage[key];
      if (!cells) continue;
      for (const item of cells) {
        if (isCargo(item)) this.visit(item, 'courier', null, input);
      }
    }

    // Forget items that left the world (delivered, or consumed) so the map stays
    // the size of the live contracts.
    for (const id of this.lastPlace.keys()) {
      if (!this.seen.has(id)) this.lastPlace.delete(id);
    }
  }

  private visit(
    item: ContractCargoItem,
    place: ContractPlace,
    carId: string | null,
    input: ContractTickInput,
  ): void {
    const state = this.world.state;
    this.seen.add(item.id);
    const previous = this.lastPlace.get(item.id);
    const droppedThisTick = previous !== undefined && previous !== 'loose' && place === 'loose';
    this.lastPlace.set(item.id, place);

    // The kind's own world object (a contract trailer or car) is ensured by the
    // composition root before anything else reads the item; see `onContractItem`.
    input.onContractItem?.(item, place, carId);

    // A hand-made or very old item may lack the record; the runtime owns it.
    if (!item.progress) item.progress = defaultProgress();
    const progress = item.progress;
    if (!progress.started && place !== 'courier') {
      progress.started = true;
      progress.startedAtS = state.playedSeconds;
    }
    if (!progress.started) return;

    const ctx = this.ctx;
    ctx.dt = input.dt;
    ctx.nowS = state.playedSeconds;
    ctx.item = item;
    ctx.timeOfDay = input.timeOfDay;
    ctx.dayLength = input.dayLength;
    ctx.ambientC = input.ambientC;
    ctx.place = place;
    ctx.droppedThisTick = droppedThisTick;
    ctx.car = carId ? input.carTelemetry(carId) : null;
    ctx.carById = input.carById;
    ctx.gatesFor = input.gatesFor;

    const wasViolated = progress.violated;
    const wasLate = progress.late;
    contractKindDef(item.contractKind).step(progress, ctx);

    if (input.onNotice) {
      if (!wasViolated && progress.violated) input.onNotice(`${item.cargoName} — bonus lost`);
      else if (!wasLate && progress.late) {
        input.onNotice(`${item.cargoName} — too late for the bonus`);
      }
    }
  }
}
