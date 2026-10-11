/**
 * The per-tick walk over live contracts. It visits the four places a contract cargo
 * can be, marks the cargo started once it has left its source courier, and hands
 * each item to the composition root (world objects, race, delivery target).
 *
 * Nothing is scored on the way: no impacts, drops or tips are tracked. The tick scans
 * state rather than holding its own list of contracts, so an item picked up, swapped
 * into another boot or dropped is followed with no bookkeeping.
 */

import type { GameWorld } from '../game/state';
import type { ContractCargoItem, Item } from '../items/items';
import { defaultProgress, type ContractPlace } from './types';

/**
 * Called for every live cargo item, once per tick, with where it is and which car
 * carries it. The composition root uses it to keep the contract's own world objects
 * (a loaded trailer, a car to be transferred) spawned exactly once: the callback only
 * fires for cargo that exists, so a delivered one cannot be re-created.
 */
export type ContractItemVisitor = (item: ContractCargoItem, place: ContractPlace, carId: string | null) => void;

function isCargo(item: Item | null | undefined): item is ContractCargoItem {
  return item?.type === 'contract_cargo';
}

export class ContractRuntime {
  constructor(private readonly world: GameWorld) {}

  tick(onContractItem: ContractItemVisitor): void {
    const state = this.world.state;
    for (const item of state.player.carried) {
      if (isCargo(item)) this.visit(item, 'hand', null, onContractItem);
    }
    for (const carId of Object.keys(state.cars)) {
      const car = state.cars[carId];
      if (!car) continue;
      for (const item of car.storage) {
        if (isCargo(item)) this.visit(item, 'car', carId, onContractItem);
      }
    }
    for (const key of Object.keys(state.looseItems)) {
      const item = state.looseItems[key]?.item;
      if (isCargo(item)) this.visit(item, 'loose', null, onContractItem);
    }
    for (const key of Object.keys(state.courierStorage)) {
      const cells = state.courierStorage[key];
      if (!cells) continue;
      for (const item of cells) {
        if (isCargo(item)) this.visit(item, 'courier', null, onContractItem);
      }
    }
  }

  private visit(
    item: ContractCargoItem,
    place: ContractPlace,
    carId: string | null,
    onContractItem: ContractItemVisitor,
  ): void {
    // The kind's own world object (a contract trailer or car) is ensured before
    // anything else reads the item.
    onContractItem(item, place, carId);
    // A hand-made or very old item may lack the record; the runtime owns it.
    if (!item.progress) item.progress = defaultProgress();
    if (place !== 'courier') item.progress.started = true;
  }
}
