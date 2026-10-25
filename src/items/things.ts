/**
 * THE BOY'S THINGS (game-design2.md §7.3): everything a post sends is one of these, a
 * thing from the boy's room and his life. A contract item names its thing by id
 * (`ContractCargoItem.thing`), and everything else about it — what it is called, its
 * tags, its mass, where it rides, its base pay and which card of the post offers it —
 * is read from here.
 *
 * WHERE IT RIDES (`place`):
 * - `cells`: in a boot, taking `boot` cells of its grid (vehicle/trunk.ts); `seat` things
 *   (the cushions) may also lie on a seat instead;
 * - `bench`: across the whole rear bench and nowhere else (the carpet);
 * - `seats`: passengers on the passenger seats (the teddies, contracts/kinds/teddyPassengers.ts);
 * - `trailer`, `tow`, `transfer`: a haul (contracts/world.ts) — the load on a contract
 *   trailer, a broken toy car pulled to the repair on the bar, a toy car driven to a
 *   friend. No item stands for it: the trailer or the car is the job (§7.8).
 *
 * Ids are saved on items: never rename one.
 */

import type { ContractKind } from '../contracts/types';

/**
 * A thing's constant tags. Urgency is the post's, not the thing's. `special` and `relic`
 * things are the boy's dearest (game-design2.md §12): only the fifth card offers them,
 * relics only from `RELIC_STICKERS` (economy/economy.ts).
 */
export type ThingTag = 'ordinary' | 'bulky' | 'fragile' | 'special' | 'relic';

export type ThingId =
  | 'pencils'
  | 'globe'
  | 'cushions'
  | 'table_lamp'
  | 'tea_service'
  | 'record_player'
  | 'tool_box'
  | 'fishing_rods'
  | 'sledge'
  | 'carpet'
  | 'tv_set'
  | 'aquarium'
  | 'wardrobe'
  | 'piano'
  | 'sofa'
  | 'bed'
  | 'broken_toy_car'
  | 'toy_car'
  | 'teddies'
  | 'grandpa_radio'
  | 'stamp_album'
  | 'music_box'
  | 'old_camera'
  | 'chess_set'
  | 'model_plane'
  | 'grandpa_medals'
  | 'photo_album'
  | 'first_toy_car';

export type ThingPlace = 'cells' | 'bench' | 'seats' | 'trailer' | 'tow' | 'transfer';

/** Boot cells a thing takes: `columns` across the grid by `rows` up, never turned. */
export interface BootFootprint {
  readonly columns: number;
  readonly rows: number;
}

/** One of the boy's things. Its model is drawn by its id (render/thingmesh.ts), whole and broken. */
export interface ThingDef {
  readonly id: ThingId;
  /** What the card, the prompts and the HUD call it. */
  readonly name: string;
  readonly tags: readonly ThingTag[];
  /** Its own mass, kg: what the boot, the seat or the trailer's bed carries. 0 for a car. */
  readonly massKg: number;
  /** Base pay of its delivery at home (km index 1), rubles: `deliveryPay`. */
  readonly pay: number;
  readonly place: ThingPlace;
  /** Boot cells, for a `cells` thing. */
  readonly boot?: BootFootprint;
  /** A `cells` thing that may lie on a seat instead (the cushions). */
  readonly seat?: true;
}

const ONE: BootFootprint = { columns: 1, rows: 1 };
const TWO: BootFootprint = { columns: 2, rows: 1 };
const STRIP: BootFootprint = { columns: 4, rows: 1 };
const SQUARE: BootFootprint = { columns: 2, rows: 2 };

export const THINGS: readonly ThingDef[] = [
  { id: 'pencils', name: 'box of pencils', tags: ['ordinary'], massKg: 0.5, pay: 20, place: 'cells', boot: ONE },
  { id: 'globe', name: 'school globe', tags: ['fragile'], massKg: 1.5, pay: 40, place: 'cells', boot: ONE },
  { id: 'cushions', name: 'sofa cushions', tags: ['ordinary'], massKg: 2, pay: 30, place: 'cells', boot: TWO, seat: true },
  { id: 'table_lamp', name: 'table lamp', tags: ['fragile'], massKg: 2.5, pay: 50, place: 'cells', boot: TWO },
  { id: 'tea_service', name: 'tea service', tags: ['fragile'], massKg: 7, pay: 60, place: 'cells', boot: TWO },
  { id: 'record_player', name: 'record player', tags: ['fragile'], massKg: 6, pay: 60, place: 'cells', boot: TWO },
  { id: 'tool_box', name: "dad's tool box", tags: ['ordinary'], massKg: 30, pay: 50, place: 'cells', boot: TWO },
  { id: 'fishing_rods', name: 'fishing rods', tags: ['bulky'], massKg: 3, pay: 40, place: 'cells', boot: STRIP },
  { id: 'sledge', name: 'sledge', tags: ['bulky'], massKg: 5, pay: 40, place: 'cells', boot: STRIP },
  { id: 'carpet', name: 'carpet', tags: ['bulky'], massKg: 12, pay: 50, place: 'bench' },
  { id: 'tv_set', name: 'old TV set', tags: ['bulky', 'fragile'], massKg: 25, pay: 90, place: 'cells', boot: SQUARE },
  { id: 'aquarium', name: 'aquarium', tags: ['bulky', 'fragile'], massKg: 18, pay: 90, place: 'cells', boot: SQUARE },
  { id: 'wardrobe', name: 'wardrobe', tags: ['bulky'], massKg: 110, pay: 90, place: 'trailer' },
  { id: 'piano', name: 'piano', tags: ['bulky'], massKg: 230, pay: 110, place: 'trailer' },
  { id: 'sofa', name: 'sofa', tags: ['bulky'], massKg: 70, pay: 90, place: 'trailer' },
  // The long load: longer than the trailer's bed, it overhangs both ends (contracts/world.ts).
  { id: 'bed', name: 'bed', tags: ['bulky'], massKg: 90, pay: 100, place: 'trailer' },
  { id: 'broken_toy_car', name: 'broken toy car', tags: [], massKg: 0, pay: 90, place: 'tow' },
  { id: 'toy_car', name: 'toy car', tags: [], massKg: 0, pay: 90, place: 'transfer' },
  // Per teddy: a party is one teddy item each.
  { id: 'teddies', name: 'teddy passengers', tags: [], massKg: 0.6, pay: 30, place: 'seats' },
  // The fifth card's (§12): about twice an ordinary thing's pay, relics twice that again.
  { id: 'grandpa_radio', name: "grandpa's radio", tags: ['fragile', 'special'], massKg: 6, pay: 140, place: 'cells', boot: TWO },
  { id: 'stamp_album', name: 'stamp album', tags: ['ordinary', 'special'], massKg: 1.2, pay: 110, place: 'cells', boot: ONE },
  { id: 'music_box', name: "mum's music box", tags: ['fragile', 'special'], massKg: 1, pay: 130, place: 'cells', boot: ONE },
  { id: 'old_camera', name: 'old camera', tags: ['fragile', 'special'], massKg: 1.2, pay: 130, place: 'cells', boot: ONE },
  { id: 'chess_set', name: 'chess set', tags: ['ordinary', 'special'], massKg: 2, pay: 110, place: 'cells', boot: ONE },
  { id: 'model_plane', name: 'model plane', tags: ['fragile', 'special'], massKg: 0.8, pay: 140, place: 'cells', boot: TWO },
  { id: 'grandpa_medals', name: "grandpa's medals", tags: ['fragile', 'relic'], massKg: 0.6, pay: 240, place: 'cells', boot: ONE },
  { id: 'photo_album', name: 'family photo album', tags: ['fragile', 'relic'], massKg: 2, pay: 220, place: 'cells', boot: ONE },
  { id: 'first_toy_car', name: 'his first toy car', tags: ['fragile', 'relic'], massKg: 0.4, pay: 260, place: 'cells', boot: ONE },
];

const BY_ID = new Map<string, ThingDef>(THINGS.map((def) => [def.id, def]));

export function isThingId(value: unknown): value is ThingId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function thingDef(id: ThingId): ThingDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown thing "${id}"`);
  return def;
}

export function hasTag(def: ThingDef, tag: ThingTag): boolean {
  return def.tags.includes(tag);
}

/** A haul: a trailer, a towed car or a driven car, handed in by reversing it into a post's bay. */
export function isHaulThing(def: ThingDef): boolean {
  return def.place === 'trailer' || def.place === 'tow' || def.place === 'transfer';
}

/**
 * Whether the thing has a condition (game-design2.md §11.1). Teddies do not: what they
 * feel is their ride (contracts/kinds/teddyPassengers.ts `passengerQuality`). Nor does a
 * haul this far: the load is not scored.
 */
export function thingWears(def: ThingDef): boolean {
  return def.place !== 'seats' && !isHaulThing(def);
}

/**
 * The share of a fragile thing's wear any other thing takes: it wears 4–5× slower, so
 * the ride and a drop barely mark it and only a crash shows (a 5 m/s shunt, 4% in a
 * comfort-3 car).
 */
const ORDINARY_WEAR_SHARE = 0.22;

/** How much of a fragile thing's wear this thing takes (contracts/runtime.ts). */
export function thingWearShare(def: ThingDef): number {
  return hasTag(def, 'fragile') ? 1 : ORDINARY_WEAR_SHARE;
}

/** The contract machinery the thing rides on (contracts/registry.ts). */
export function thingKind(def: ThingDef): ContractKind {
  switch (def.place) {
    case 'cells':
    case 'bench':
      return 'thing';
    case 'seats':
      return 'teddy_passengers';
    case 'trailer':
      return 'trailer';
    case 'tow':
      return 'towing';
    case 'transfer':
      return 'car_transfer';
  }
}

/** The boot cells the thing's item takes, or null when it never rides in a boot. */
export function thingBootFootprint(def: ThingDef): BootFootprint | null {
  return def.place === 'cells' ? def.boot ?? ONE : null;
}

/**
 * The four cards of a post (§7.2), one per property: an ordinary thing, a fragile
 * thing, a bulky thing or a haul, the teddies. A bulky thing that is fragile too (the
 * TV, the aquarium) is a bulky card's. The fifth card, `special`, offers the special
 * things and relics, and only to a car with stickers (§12, contracts/offers.ts
 * `SPECIAL_SLOT`).
 */
export type PostCard = 'ordinary' | 'fragile' | 'bulky' | 'teddies' | 'special';
export const POST_CARDS: readonly PostCard[] = ['ordinary', 'fragile', 'bulky', 'teddies'];

export function thingCard(def: ThingDef): PostCard {
  if (hasTag(def, 'special') || hasTag(def, 'relic')) return 'special';
  if (def.place === 'seats') return 'teddies';
  if (isHaulThing(def) || hasTag(def, 'bulky')) return 'bulky';
  if (hasTag(def, 'fragile')) return 'fragile';
  return 'ordinary';
}

const CARD_THINGS: Readonly<Record<PostCard, readonly ThingDef[]>> = {
  ordinary: THINGS.filter((def) => thingCard(def) === 'ordinary'),
  fragile: THINGS.filter((def) => thingCard(def) === 'fragile'),
  bulky: THINGS.filter((def) => thingCard(def) === 'bulky'),
  teddies: THINGS.filter((def) => thingCard(def) === 'teddies'),
  special: THINGS.filter((def) => hasTag(def, 'special')),
};
const SPECIAL_AND_RELICS = THINGS.filter((def) => thingCard(def) === 'special');

/** The things a card draws from, in catalogue order. */
export function cardThings(card: PostCard): readonly ThingDef[] {
  return CARD_THINGS[card];
}

/** The fifth card's things: the special ones, and the relics too when `relics`. */
export function specialThings(relics: boolean): readonly ThingDef[] {
  return relics ? SPECIAL_AND_RELICS : CARD_THINGS.special;
}
