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
 * A post never runs dry: an offer taken out is replaced in its slot by the next ROUND of
 * that slot (`nextOffer`), drawn the same way, so the machine always shows one offer of
 * each tier. The post's stock — which round each slot stands at — lives here rather than in
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

/** The draw key of round `round` of `slot`: round 0 keeps the key the offers always had. */
function drawKey(slot: number, round: number): number {
  return slot + round * POST_OFFER_COUNT;
}

function pickKind(seed: number, courierIndex: number, key: number, haul: boolean): ContractKindDef {
  // The first post's first easy run is always a parcel: the drive's first job starts the
  // parcel count.
  if (courierIndex === 0 && key === 0) return CONTRACT_KINDS[0]!;
  let roll = hash01(seed, KIND_DOMAIN, courierIndex, key) * totalWeight(haul);
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

/**
 * The saved id of round `round` of offer `slot` at post `index`. Saved: never changed;
 * round 0 has the id the offers always had.
 */
export function offerId(index: number, slot: number, round = 0): string {
  return round === 0 ? `courier:${index}:offer:${slot}` : `courier:${index}:offer:${slot}:${round}`;
}

/** The (slot, round) an offer id of post `index` names, or null for any other id. */
function parseOfferId(index: number, id: string): { slot: number; round: number } | null {
  const match = /^courier:(\d+):offer:(\d+)(?::(\d+))?$/.exec(id);
  if (!match || Number(match[1]) !== index) return null;
  return { slot: Number(match[2]), round: match[3] === undefined ? 0 : Number(match[3]) };
}

/** The post an offer is bound for: the next one, or the race's finish. */
export function offerDestinationIndex(item: ContractCargoItem): number {
  return item.sourceCourierIndex + (item.raceLegs ?? 1);
}

export function generateContractOffer(
  seed: number,
  courierIndex: number,
  slot: number,
  round = 0,
): ContractCargoItem {
  const key = drawKey(slot, round);
  const def = pickKind(seed, courierIndex, key, slot === 3);
  const generatedSeed = hash(seed, OFFER_DOMAIN, courierIndex, key);
  const nameIndex = Math.floor(hash01(seed, NAME_DOMAIN, courierIndex, key) * def.offerNames.length);
  const massKg = def.massKg?.(generatedSeed);
  const raceLegs = SLOT_RACE_LEGS[slot];
  // The drive's very first job stays plain; any other parcel may go registered.
  const registered = def.kind === 'parcel'
    && !(courierIndex === 0 && key === 0)
    && hash01(seed, REGISTERED_DOMAIN, courierIndex, key) < REGISTERED_SHARE;
  const item: ContractCargoItem = {
    type: 'contract_cargo',
    id: offerId(courierIndex, slot, round),
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

/** The offer that replaces `offer` in its slot once it is taken out: the next round. */
export function nextOffer(seed: number, offer: ContractCargoItem): ContractCargoItem {
  const at = parseOfferId(offer.sourceCourierIndex, offer.id);
  if (!at) throw new Error(`nextOffer: ${offer.id} is not a post offer`);
  return generateContractOffer(seed, offer.sourceCourierIndex, at.slot, at.round + 1);
}

/** A post's stock as the machine reads it: its offers by slot, and anything else left in it. */
export interface PostStock {
  /** The offer standing in each slot: always one, whichever round the slot is at. */
  readonly offers: readonly ContractCargoItem[];
  /**
   * Things a save from the courier days left in the courier's boot (an envelope, a coin,
   * a stashed part): the machine gives them back through its tray.
   */
  readonly strays: readonly Item[];
}

/**
 * What post `index` holds. Untouched (no `WorldState.courierStorage` entry), round 0 of
 * every slot. After the first release the saved cells own it: a slot stands at the round
 * of its offer found anywhere in the cells (a courier-era boot kept them in any cell, and
 * eight of them), and at round 1 when none is there (a save from before the rounds,
 * whose taken offer left its slot empty). The offers are generated fresh, so an old
 * save's stock reads with today's label (destination, PIN).
 */
export function postStock(state: WorldState, seed: number, index: number): PostStock {
  const saved = state.courierStorage[postId(index)];
  const rounds = new Array<number>(POST_OFFER_COUNT).fill(saved ? 1 : 0);
  const isOffer = new Set<Item>();
  for (const cell of saved ?? []) {
    const at = cell ? parseOfferId(index, cell.id) : null;
    if (!cell || !at || at.slot >= POST_OFFER_COUNT) continue;
    rounds[at.slot] = at.round;
    isOffer.add(cell);
  }
  const offers = rounds.map((round, slot) => generateContractOffer(seed, index, slot, round));
  const strays = (saved ?? []).filter((cell): cell is Item => cell !== null && !isOffer.has(cell));
  return { offers, strays };
}
