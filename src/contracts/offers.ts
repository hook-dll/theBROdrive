/**
 * Post offer generation: four per post stop, drawn deterministically from the world
 * seed, ONE OF EACH TIER by slot (see `contractTier`): slot 0 an easy run, slot 1 a
 * race to the next post, slot 2 a race two posts on, slot 3 a big haul with a
 * trailer or a car. The kind is drawn by weight among the kinds the tier can carry.
 *
 * The offer is a plain `contract_cargo` item with its kind, name, destination, seed-random
 * reward (paid by kinds without a signature sticker) and fresh progress already on
 * it. A share of the parcels is REGISTERED: a six-digit PIN printed on the label, which
 * the receiving post asks for on its dial (world/post.ts).
 *
 * The post's stock — which of its four offers it still holds — lives here rather than in
 * `world/poststops.ts` on purpose: it is contract content, and `world/poststops.ts` must
 * stay free of contract imports. `kinds/*` reach the stop geometry through
 * `contracts/world.ts`, and a contract import in that leaf would close a module-init
 * cycle (measured: offers read a not-yet-initialised `CONTRACT_KINDS` depending on
 * import order).
 */

import { hash, hash01 } from '../core/rng';
import type { WorldState } from '../game/state';
import { isHaulKind, type ContractCargoItem, type Item } from '../items/items';
import { stickerKindForSeed } from '../items/stickercatalog';
import { placeNameAt } from '../world/placenames';
import { postId, postStop } from '../world/poststops';
import { CONTRACT_KINDS } from './registry';
import { defaultProgress, type ContractKindDef } from './types';

/** Offer draws stay on the courier domain the base system already used. */
const OFFER_DOMAIN = 0x4f464631; // 'OFF1'
const KIND_DOMAIN = 0x4f464b31; // 'OFK1'
const NAME_DOMAIN = 0x4f464e31; // 'OFN1'
const REGISTERED_DOMAIN = 0x4f465231; // 'OFR1'
/** Share of parcel offers sent registered, with a PIN to dial at the receiving post. */
const REGISTERED_SHARE = 0.15;
/** Offers a post holds: one per tier. */
export const POST_OFFER_COUNT = 4;

/**
 * Total offer weight, summed on the first draw rather than at module load.
 *
 * This module is reachable from `world/poi.ts`, and `CONTRACT_KINDS` reaches back
 * here through a kind module: reading the table in this module's BODY made the loop
 * an evaluation-order trap — `Cannot access 'CONTRACT_KINDS' before initialization`
 * whenever an entry point reached the registry first (measured with
 * tools/tow-bench.ts, whose own imports land in that order). A lazy sum is a few
 * additions per generated offer and cannot be observed.
 */
function totalWeight(haul: boolean): number {
  let total = 0;
  for (const def of CONTRACT_KINDS) if (isHaulKind(def.kind) === haul) total += def.weight;
  return total;
}

function pickKind(seed: number, courierIndex: number, slot: number, haul: boolean): ContractKindDef {
  // The first post's easy run is always a parcel: the drive's first job needs no
  // licence (economy/economy.ts `licenceFor`) and starts the parcel count.
  if (courierIndex === 0 && slot === 0) return CONTRACT_KINDS[0]!;
  let roll = hash01(seed, KIND_DOMAIN, courierIndex, slot) * totalWeight(haul);
  let last: ContractKindDef | null = null;
  for (const def of CONTRACT_KINDS) {
    if (isHaulKind(def.kind) !== haul) continue;
    last = def;
    roll -= def.weight;
    if (roll < 0) return def;
  }
  return last ?? CONTRACT_KINDS[0]!;
}

/** The race each slot is: none, one post on, two posts on, none (the haul). */
const SLOT_RACE_LEGS: readonly (1 | 2 | undefined)[] = [undefined, 1, 2, undefined];

/** The saved id of offer `slot` at post `index`. Saved: never changed. */
export function offerId(index: number, slot: number): string {
  return `courier:${index}:offer:${slot}`;
}

/** The post an offer is bound for: the next one, or the race's finish. */
export function offerDestinationIndex(item: ContractCargoItem): number {
  return item.sourceCourierIndex + (item.raceLegs ?? 1);
}

export function generateContractOffer(
  seed: number,
  courierIndex: number,
  slot: number,
): ContractCargoItem {
  const def = pickKind(seed, courierIndex, slot, slot === 3);
  const generatedSeed = hash(seed, OFFER_DOMAIN, courierIndex, slot);
  const nameIndex = Math.floor(hash01(seed, NAME_DOMAIN, courierIndex, slot) * def.offerNames.length);
  const massKg = def.massKg?.(generatedSeed);
  const raceLegs = SLOT_RACE_LEGS[slot];
  // The drive's very first job stays plain; any other parcel may go registered.
  const registered = def.kind === 'parcel'
    && !(courierIndex === 0 && slot === 0)
    && hash01(seed, REGISTERED_DOMAIN, courierIndex, slot) < REGISTERED_SHARE;
  const item: ContractCargoItem = {
    type: 'contract_cargo',
    id: offerId(courierIndex, slot),
    sourceCourierIndex: courierIndex,
    contractKind: def.kind,
    cargoName: def.offerNames[nameIndex]!,
    rewardStickerKind: stickerKindForSeed(generatedSeed),
    generatedSeed,
    destination: placeNameAt(seed, postStop(seed, courierIndex + (raceLegs ?? 1)).s),
    ...(registered ? { registeredPin: String(100_000 + Math.floor(hash01(generatedSeed, REGISTERED_DOMAIN) * 900_000)) } : {}),
    progress: defaultProgress(),
  };
  if (massKg !== undefined) item.massKg = massKg;
  if (raceLegs !== undefined) item.raceLegs = raceLegs;
  def.dressOffer?.(item);
  return item;
}

/** A post's stock as the machine reads it: its offers by slot, and anything else left in it. */
export interface PostStock {
  /** Offer per slot while it is still in the machine, null once released. */
  readonly offers: readonly (ContractCargoItem | null)[];
  /**
   * Things a save from the courier days left in the courier's boot (an envelope, a coin,
   * a stashed part): the machine gives them back through its tray.
   */
  readonly strays: readonly Item[];
}

/**
 * What post `index` still holds. Untouched (no `WorldState.courierStorage` entry), all
 * four offers. After the first release the saved cells own it: an offer is in stock
 * while its item is anywhere in the cells (a courier-era boot kept them in any cell, and
 * eight of them). The offers are generated fresh, so an old save's stock reads with
 * today's label (destination, PIN).
 */
export function postStock(state: WorldState, seed: number, index: number): PostStock {
  const saved = state.courierStorage[postId(index)];
  const offers: (ContractCargoItem | null)[] = [];
  for (let slot = 0; slot < POST_OFFER_COUNT; slot++) {
    const id = offerId(index, slot);
    offers.push(!saved || saved.some((cell) => cell?.id === id) ? generateContractOffer(seed, index, slot) : null);
  }
  const strays: Item[] = [];
  if (saved) {
    for (const cell of saved) {
      if (cell && !offers.some((offer) => offer?.id === cell.id)) strays.push(cell);
    }
  }
  return { offers, strays };
}
