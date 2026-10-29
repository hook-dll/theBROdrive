/**
 * The contract kind registry. One entry per kind, from its own module under
 * `kinds/`; adding a kind means importing its definition here and nowhere else. The
 * helper functions are what the post machine (world/post.ts), the haul bays
 * (contracts/haulbays.ts), the teddy shelters (contracts/shelters.ts), the interaction
 * prompts and the runtime call.
 */

import type { WorldState } from '../game/state';
import { contractKindOf, contractThing, isBrokenThing, type ContractCargoItem, type Item } from '../items/items';
import { carTransferKind } from './kinds/carTransfer';
import { thingKind } from './kinds/thing';
import { towingKind } from './kinds/towing';
import { teddyPassengersKind } from './kinds/teddyPassengers';
import { trailerKind } from './kinds/trailer';
import { CONTRACT_KIND_IDS, type ContractKind, type ContractKindDef, type DeliveryProbe } from './types';

/** At most this many contracts are active at once, anywhere (game-design2.md §7.4). */
export const ACTIVE_CONTRACT_LIMIT = 3;

/** At most this many of the active contracts are hauls (trailer, towing, car transfer; §7.4). */
export const ACTIVE_HAUL_LIMIT = 1;

/**
 * A contract item whose contract is closed: broken (`isBrokenThing`), or its id already
 * among the completed or returned (`completedContractIds`). It is only a
 * souvenir: no post pays for it, it is not counted against the limit, and any post's
 * grid takes it to be rid of it.
 */
export function isContractClosed(item: ContractCargoItem, completedIds: readonly string[]): boolean {
  return isBrokenThing(item) || completedIds.includes(item.id);
}

/**
 * THE definition of an active contract (game-design2.md §7.4): a thing's contract item out
 * of a post's stock — in the hands or the pack, in any car's boot or cabin, lying loose,
 * or given into a post machine's grid and not taken out yet — that is not closed
 * (`isContractClosed`), and every haul taken and not yet
 * handed in or returned (`WorldState.hauls`: a haul has no item, its load is the
 * contract). Each teddy taken off a shelter's bench is a contract of its own. Returns
 * the active contracts' ids (the item's id), all of them and the hauls among them: their
 * sizes are what `ACTIVE_CONTRACT_LIMIT` and `ACTIVE_HAUL_LIMIT` cap.
 */
export function activeContracts(state: WorldState): { all: Set<string>; hauls: Set<string> } {
  const all = new Set<string>();
  const hauls = new Set<string>();
  const consider = (item: Item | null | undefined): void => {
    if (item?.type !== 'contract_cargo' || isContractClosed(item, state.completedContractIds)) return;
    all.add(item.id);
  };
  state.player.carried.forEach(consider);
  for (const car of Object.values(state.cars)) {
    car.storage.forEach(consider);
    car.cabin.forEach(consider);
  }
  for (const loose of Object.values(state.looseItems)) consider(loose.item);
  for (const grid of Object.values(state.machineGrids)) grid.forEach(consider);
  for (const id of Object.keys(state.hauls)) {
    all.add(id);
    hauls.add(id);
  }
  return { all, hauls };
}

const CONTRACT_KINDS: readonly ContractKindDef[] = [
  thingKind,
  trailerKind,
  towingKind,
  carTransferKind,
  teddyPassengersKind,
];

const BY_KIND = Object.fromEntries(
  CONTRACT_KINDS.map((def) => [def.kind, def]),
) as Partial<Record<ContractKind, ContractKindDef>>;

/**
 * The module for an item's kind. A defensive fallback to the plain thing: every kind
 * has a module, so this only covers a future id without one.
 */
function contractKindDef(item: ContractCargoItem): ContractKindDef {
  return BY_KIND[contractKindOf(item)] ?? thingKind;
}

/** True for every declared kind id, so a saved item's kind can be validated. */
export function isContractKind(value: unknown): value is ContractKind {
  return typeof value === 'string' && CONTRACT_KIND_IDS[value as ContractKind] === true;
}

/**
 * Why post `postIndex` is not the cargo's destination, or null when it is: a post never
 * signs for cargo from itself or one further down the road. The one rule of where a
 * thing or a haul is handed in; anywhere else it goes back as a return to sender.
 */
export function contractDestinationRefusal(item: ContractCargoItem, postIndex: number): string | null {
  return postIndex <= item.sourceCourierIndex ? 'this post cannot sign for its own things' : null;
}

/** The kind's own reason the contract may not be handed in now (`ContractKindDef.acceptRefusal`), or null. */
export function contractKindRefusal(item: ContractCargoItem, probe: DeliveryProbe): string | null {
  return contractKindDef(item).acceptRefusal?.(item, probe) ?? null;
}

/**
 * Why this post's grid may not sign for the thing as a delivery, or null. A broken
 * thing's contract is closed and no post signs for it; otherwise the destination rule
 * (`contractDestinationRefusal`) and the kind's own. A thing it will not sign for any
 * post takes back as a return to sender, with no pay.
 *
 * `probe` is the world at the accepting post, built by the post machine and
 * handed to the prompt and the commit alike.
 */
export function contractAcceptRefusal(
  item: ContractCargoItem,
  probe: DeliveryProbe,
): string | null {
  if (isBrokenThing(item)) return `the ${contractThing(item).name} is broken: no post will sign for it`;
  return contractDestinationRefusal(item, probe.targetPostIndex) ?? contractKindRefusal(item, probe);
}
