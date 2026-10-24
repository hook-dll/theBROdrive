/**
 * Post offer generation: four per post stop, drawn deterministically from the world
 * seed, ONE CARD PER PROPERTY by slot (game-design2.md §7.2, items/things.ts
 * `POST_CARDS`): slot 0 an ordinary thing, slot 1 a fragile thing, slot 2 a bulky thing
 * or a haul (a trailer, a towed car, a car to drive over), slot 3 teddy passengers. The
 * thing is drawn evenly among the things its card offers.
 *
 * The offer is a plain `contract_cargo` item with its thing, destination, seed-random
 * reward (paid by kinds without a signature sticker) and fresh progress already on it.
 * RACE is a modifier on top: an ordinary, fragile or teddy offer is a race to the next
 * post or the one after with `RACE_SHARE` chance, drawn per offer (contracts/race.ts).
 * Bulky things and hauls never race: the rivals' boot copy would not hold them. The
 * drive's very first offer is a plain ordinary thing, never a race.
 *
 * A post never runs dry: an offer taken out is replaced in its slot by the next ROUND of
 * that slot (`nextOffer`), drawn the same way, so the machine always shows one offer of
 * each property. The post's stock — which round each slot stands at — lives here rather
 * than in `world/poststops.ts` on purpose: it is contract content, and
 * `world/poststops.ts` must stay free of contract imports. `kinds/*` reach the stop
 * geometry through `contracts/world.ts`, and a contract import in that leaf would close
 * a module-init cycle.
 */

import { hash, hash01 } from '../core/rng';
import type { WorldState } from '../game/state';
import type { ContractCargoItem, Item } from '../items/items';
import { stickerKindForSeed } from '../items/stickercatalog';
import { cardThings, POST_CARDS, type ThingId } from '../items/things';
import { placeNameAt } from '../world/placenames';
import { postId, postStop } from '../world/poststops';
import { dressContractOffer } from './registry';
import { defaultProgress } from './types';

/** Offer draws stay on the courier domain the base system already used. */
const OFFER_DOMAIN = 0x4f464631; // 'OFF1'
const THING_DOMAIN = 0x4f464b31; // 'OFK1'
const RACE_DOMAIN = 0x4f465231; // 'OFR1'
/** Share of the ordinary, fragile and teddy offers that are a race. */
const RACE_SHARE = 0.3;
/** Offers a post holds: one per card. */
export const POST_OFFER_COUNT = POST_CARDS.length;

/** The draw key of round `round` of `slot`. */
function drawKey(slot: number, round: number): number {
  return slot + round * POST_OFFER_COUNT;
}

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

/**
 * A fresh contract for `thing` sent from post `courierIndex` to the next one (or a
 * race's finish `raceLegs` posts on), under `id`, its draws from `generatedSeed`. The
 * one way an offer is made: the post's slots and the dev tools (app/devtools.ts).
 */
export function makeContract(
  seed: number,
  id: string,
  courierIndex: number,
  thing: ThingId,
  generatedSeed: number,
  raceLegs?: 1 | 2,
): ContractCargoItem {
  const item: ContractCargoItem = {
    type: 'contract_cargo',
    id,
    sourceCourierIndex: courierIndex,
    thing,
    rewardStickerKind: stickerKindForSeed(generatedSeed),
    generatedSeed,
    destination: placeNameAt(seed, postStop(seed, courierIndex + (raceLegs ?? 1)).s),
    progress: defaultProgress(),
  };
  if (raceLegs !== undefined) item.raceLegs = raceLegs;
  dressContractOffer(item);
  return item;
}

export function generateContractOffer(
  seed: number,
  courierIndex: number,
  slot: number,
  round = 0,
): ContractCargoItem {
  const key = drawKey(slot, round);
  const card = POST_CARDS[slot] ?? 'ordinary';
  const pool = cardThings(card);
  const thing = pool[Math.min(pool.length - 1, Math.floor(hash01(seed, THING_DOMAIN, courierIndex, key) * pool.length))]!;
  const first = courierIndex === 0 && key === 0;
  const raceRoll = hash01(seed, RACE_DOMAIN, courierIndex, key);
  const raceLegs = card === 'bulky' || first || raceRoll >= RACE_SHARE
    ? undefined
    : raceRoll < RACE_SHARE / 2 ? 1 : 2;
  return makeContract(
    seed,
    offerId(courierIndex, slot, round),
    courierIndex,
    thing.id,
    hash(seed, OFFER_DOMAIN, courierIndex, key),
    raceLegs,
  );
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
   * Things a save from the courier days left in the courier's boot (an envelope, a
   * stashed part): the machine gives them back through its tray.
   */
  readonly strays: readonly Item[];
}

/**
 * What post `index` holds. Untouched (no `WorldState.courierStorage` entry), round 0 of
 * every slot. After the first release the saved cells own it: a slot stands at the round
 * of its offer found anywhere in the cells (a courier-era boot kept them in any cell, and
 * eight of them), and at round 1 when none is there (a save from before the rounds,
 * whose taken offer left its slot empty). The offers are generated fresh, so a saved
 * stock reads with today's label (thing, destination).
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
