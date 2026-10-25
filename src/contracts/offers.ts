/**
 * Post offer generation: three per post stop, drawn deterministically from the world
 * seed, ONE CARD PER PROPERTY by slot (game-design2.md §7.2, items/things.ts
 * `POST_CARDS`): slot 0 an ordinary thing, slot 1 a fragile thing, slot 2 a bulky thing
 * or a haul (a trailer, a towed car, a car to drive over). The thing is drawn evenly
 * among the things its card offers. A fourth slot, `SPECIAL_SLOT`, holds a special
 * thing (§12, items/things.ts `specialThings`), relics among them when asked; the post
 * shows it only to a car with stickers (world/post.ts), and its round is kept while it
 * is hidden. The teddies are no card's: they wait in the shelter (contracts/shelters.ts),
 * whose party is made here too (`makeContract`).
 *
 * The offer is a plain `contract_cargo` item with its thing, destination, seed and fresh
 * progress already on it.
 * RACE is a modifier on top: an ordinary, fragile or bulky offer, or a trailer haul, is a
 * race to the next post or the one after with `RACE_SHARE` chance, drawn per offer
 * (contracts/race.ts); the rivals carry the cargo as its weight, so footprint does not
 * matter. A tow or a car to drive over never races: there is one car in the job, and no
 * rival can bring its own copy of it. The drive's very first offer is a plain ordinary
 * thing, never a race.
 * URGENT is the other modifier, on any card: `URGENT_SHARE` of the offers (never the
 * drive's first) carry a clock (`urgentDeadlineS`) in simulation seconds from TAKE.
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
import { cardThings, POST_CARDS, specialThings, type ThingId } from '../items/things';
import { placeNameAt } from '../world/placenames';
import { postId, postStop } from '../world/poststops';
import { dressContractOffer } from './registry';
import { defaultProgress } from './types';

/** Offer draws stay on the courier domain the base system already used. */
const OFFER_DOMAIN = 0x4f464631; // 'OFF1'
const THING_DOMAIN = 0x4f464b31; // 'OFK1'
const RACE_DOMAIN = 0x4f465231; // 'OFR1'
/** Share of the offers that may race (all but tows, drives and the special card) that are a race. */
const RACE_SHARE = 0.3;
const URGENT_DOMAIN = 0x4f465531; // 'OFU1'
/** Share of the offers, any card, that are urgent (game-design2.md §7.5). */
const URGENT_SHARE = 0.25;
/**
 * The urgent clock: the road distance to the destination at `URGENT_KMH`, a brisk but
 * fair average with the stops and the bends in it, plus `URGENT_SLACK_S` for loading and
 * the walk to the tray, rounded up to ten seconds. A 3 km hop is 6:00.
 */
const URGENT_KMH = 45;
const URGENT_SLACK_S = 120;
/** Offers a post holds by property: one per card. */
export const POST_OFFER_COUNT = POST_CARDS.length;
/** The bulky card's slot: its offer may be a haul, whose load waits in the bay (§7.8). */
export const HAUL_SLOT = POST_CARDS.indexOf('bulky');
/** The slot after the three: the special thing (§12). */
export const SPECIAL_SLOT = POST_OFFER_COUNT;
/** Slots a post's stock keeps a round for: the three and the special one. */
const POST_SLOT_COUNT = POST_OFFER_COUNT + 1;

/** The draw key of round `round` of `slot`. */
function drawKey(slot: number, round: number): number {
  return slot + round * POST_SLOT_COUNT;
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

/** An urgent contract's clock from post `source` to post `destination`, seconds; see `URGENT_KMH`. */
export function urgentDeadlineS(seed: number, source: number, destination: number): number {
  const km = Math.max(0, postStop(seed, destination).s - postStop(seed, source).s) / 1000;
  return Math.ceil((km / URGENT_KMH * 3600 + URGENT_SLACK_S) / 10) * 10;
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
  urgent = false,
): ContractCargoItem {
  const item: ContractCargoItem = {
    type: 'contract_cargo',
    id,
    sourceCourierIndex: courierIndex,
    thing,
    generatedSeed,
    destination: placeNameAt(seed, postStop(seed, courierIndex + (raceLegs ?? 1)).s),
    progress: defaultProgress(),
  };
  if (urgent) item.urgentS = urgentDeadlineS(seed, courierIndex, courierIndex + (raceLegs ?? 1));
  if (raceLegs !== undefined) item.raceLegs = raceLegs;
  dressContractOffer(item);
  return item;
}

/**
 * Round `round` of offer `slot` at post `courierIndex`. The special slot draws among
 * the special things, and among the relics too when `relics`: the same round may show
 * a relic to a car with enough stickers and a special thing to one without.
 */
export function generateContractOffer(
  seed: number,
  courierIndex: number,
  slot: number,
  round = 0,
  relics = false,
): ContractCargoItem {
  const key = drawKey(slot, round);
  const special = slot === SPECIAL_SLOT;
  const card = POST_CARDS[slot] ?? 'ordinary';
  const pool = special ? specialThings(relics) : cardThings(card);
  const thing = pool[Math.min(pool.length - 1, Math.floor(hash01(seed, THING_DOMAIN, courierIndex, key) * pool.length))]!;
  const first = courierIndex === 0 && key === 0;
  const raceRoll = hash01(seed, RACE_DOMAIN, courierIndex, key);
  // A special thing never races: it is the boy's own, not one of three copies. Nor does
  // a tow or a drive: the one car in the job cannot be copied.
  const raceLegs = thing.place === 'tow' || thing.place === 'transfer' || special || first || raceRoll >= RACE_SHARE
    ? undefined
    : raceRoll < RACE_SHARE / 2 ? 1 : 2;
  const urgent = !first && hash01(seed, URGENT_DOMAIN, courierIndex, key) < URGENT_SHARE;
  return makeContract(
    seed,
    offerId(courierIndex, slot, round),
    courierIndex,
    thing.id,
    hash(seed, OFFER_DOMAIN, courierIndex, key),
    raceLegs,
    urgent,
  );
}

/** The offer that replaces `offer` in its slot once it is taken out: the next round (`relics`: see `generateContractOffer`). */
export function nextOffer(seed: number, offer: ContractCargoItem, relics = false): ContractCargoItem {
  const at = parseOfferId(offer.sourceCourierIndex, offer.id);
  if (!at) throw new Error(`nextOffer: ${offer.id} is not a post offer`);
  return generateContractOffer(seed, offer.sourceCourierIndex, at.slot, at.round + 1, relics);
}

/** `offer` drawn again in its slot and round, relics allowed or not: the special card when the lay-by car changes. */
export function redrawOffer(seed: number, offer: ContractCargoItem, relics: boolean): ContractCargoItem {
  const at = parseOfferId(offer.sourceCourierIndex, offer.id);
  if (!at) throw new Error(`redrawOffer: ${offer.id} is not a post offer`);
  return generateContractOffer(seed, offer.sourceCourierIndex, at.slot, at.round, relics);
}

/** The shelter's party draws, apart from every card's. */
const SHELTER_DOMAIN = 0x53484c31; // 'SHL1'

/**
 * The contract id of round `round` of post `index`'s teddy shelter party: every teddy of
 * it carries it (`CargoParty.id`). Saved: never changed.
 */
export function shelterPartyId(index: number, round: number): string {
  return `shelter:${index}:${round}`;
}

/** The (post, round) a shelter party's id names, or null for any other id. */
export function parseShelterPartyId(id: string): { index: number; round: number } | null {
  const match = /^shelter:(\d+):(\d+)$/.exec(id);
  return match ? { index: Number(match[1]), round: Number(match[2]) } : null;
}

/**
 * Round `round` of the teddy party waiting in post `courierIndex`'s shelter (§10): 1–3
 * teddies (kinds/teddyPassengers.ts `dressOffer`), bound for the next post or a race's
 * finish, urgent or not, at the cards' shares. The drive's very first party is plain.
 */
export function shelterParty(seed: number, courierIndex: number, round: number): ContractCargoItem {
  const first = courierIndex === 0 && round === 0;
  const raceRoll = hash01(seed, RACE_DOMAIN, SHELTER_DOMAIN, courierIndex, round);
  const raceLegs = first || raceRoll >= RACE_SHARE ? undefined : raceRoll < RACE_SHARE / 2 ? 1 : 2;
  const urgent = !first && hash01(seed, URGENT_DOMAIN, SHELTER_DOMAIN, courierIndex, round) < URGENT_SHARE;
  return makeContract(
    seed,
    shelterPartyId(courierIndex, round),
    courierIndex,
    'teddies',
    hash(seed, OFFER_DOMAIN, SHELTER_DOMAIN, courierIndex, round),
    raceLegs,
    urgent,
  );
}

/** A post's stock as the machine reads it: its offers by slot, and anything else left in it. */
export interface PostStock {
  /**
   * The offer standing in each slot, whichever round it is at: the three, then the
   * special one (`SPECIAL_SLOT`).
   */
  readonly offers: readonly ContractCargoItem[];
  /**
   * Things a save from the courier days left in the courier's boot (an envelope, a
   * stashed part): the machine gives them back through its tray.
   */
  readonly strays: readonly Item[];
}

/**
 * What post `index` holds, the special slot drawn with or without `relics`. Untouched
 * (no `WorldState.courierStorage` entry), round 0 of every slot. After the first release
 * the saved cells own it: a slot stands at the round of its offer found anywhere in the
 * cells (a courier-era boot kept them in any cell, and eight of them), and at round 1
 * when none is there (a save from before the rounds, whose taken offer left its slot
 * empty). The offers are generated fresh, so a saved stock reads with today's label
 * (thing, destination).
 */
export function postStock(state: WorldState, seed: number, index: number, relics: boolean): PostStock {
  const saved = state.courierStorage[postId(index)];
  const rounds = new Array<number>(POST_SLOT_COUNT).fill(saved ? 1 : 0);
  const isOffer = new Set<Item>();
  for (const cell of saved ?? []) {
    const at = cell ? parseOfferId(index, cell.id) : null;
    if (!cell || !at || at.slot >= POST_SLOT_COUNT) continue;
    rounds[at.slot] = at.round;
    isOffer.add(cell);
  }
  const offers = rounds.map((round, slot) => generateContractOffer(seed, index, slot, round, relics));
  const strays = (saved ?? []).filter((cell): cell is Item => cell !== null && !isOffer.has(cell));
  return { offers, strays };
}
