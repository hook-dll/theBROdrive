import { hash01 } from '../core/rng';
import { POI_VARIANTS } from './poi-variants';

/**
 * VILLAGES: where the country is inhabited, and how.
 *
 * The middle belt's villages are not a scatter of buildings. They are a LINE along the
 * road — one street, houses on both sides, most of them on one — with a pond, a shop if
 * the place is big enough, kitchen gardens behind the houses, and a few timber poles
 * carrying the line down off the road. Measured against the census of rural settlements,
 * any settlement is one per 6-17 km² and a living one (over fifty people) is one per
 * 37-122 km², which along a road works out at a village every 6-11 km and a bigger one
 * every fifteen or twenty; the research is in `docs/research-2026-09-26-landscape.md`.
 *
 * WHY A SCHEDULE AND NOT A FIELD. Every other feature that stands in this world is a
 * function of position, because the ground has to agree with it about where it is. A
 * village does not: it is a DECISION somebody made about a piece of road, so it is
 * scheduled by arclength like the POIs and the lakes, and the ground is dug to meet it
 * (the pond is a basin in `world/lakes.ts`, the same machinery the lakes use).
 *
 * WHAT IS NOT HERE. The houses are the catalogue's own — the same five country houses and
 * the same shop that stand alone along the road today — so a village is a RHYTHM and not
 * yet a different architecture. Half-abandoned houses (boarded windows, a fallen roof) do
 * not exist in the catalogue, and the kitchen gardens are fenced strips of ordinary cover
 * rather than planted beds. Both are named in the plan.
 */

/** Arclength between village slots, metres, and how far inside a slot one may sit. */
const SLOT_M = 8500;
const JITTER_M = 1700;
/** Fraction of slots with a village: the gaps between them are then 6-11 km. */
const ODDS = 0.85;
/** Nothing is built within sight of the homestead. */
const FIRST_S = 3200;
const TAG = 0x56494c31; // 'VIL1'

/** Five to twenty houses, 19-32 m apart along the street. */
const HOUSES_MIN = 5;
const HOUSES_SPAN = 16;
const PITCH_MIN = 19;
const PITCH_SPAN = 13;
/** How far the house line stands off the centreline, and how much it wanders. */
const STREET_LATERAL_MIN = 21;
const STREET_LATERAL_SPAN = 14;
/** Odds that a house faces the road from the village's main side. */
const MAIN_SIDE_SHARE = 0.62;
/** Odds that one house in a village is the shop instead. */
const SHOP_CHANCE = 0.55;

/** The pond: how far out, how big and how deep. */
const POND_LATERAL_MIN = 55;
const POND_LATERAL_SPAN = 60;
const POND_RADIUS_MIN = 40;
const POND_RADIUS_SPAN = 22;
const POND_DEPTH_MIN = 1.8;
const POND_DEPTH_SPAN = 1;

/** The catalogue's houses and shops, resolved once: a village is built from these. */
export const HOUSE_VARIANTS: readonly number[] = POI_VARIANTS.map((variant, index) =>
  variant.category === 'house' ? index : -1,
).filter((index) => index >= 0);
export const SHOP_VARIANTS: readonly number[] = POI_VARIANTS.map((variant, index) =>
  variant.category === 'shop' ? index : -1,
).filter((index) => index >= 0);

export interface VillageHouse {
  /** Position in the street, 0..n-1: with the village index it is the loot identity. */
  readonly number: number;
  readonly s: number;
  readonly lateral: number;
  readonly variant: number;
  readonly variantSeed: number;
}

export interface VillagePond {
  readonly s: number;
  readonly lateral: number;
  readonly radius: number;
  readonly depth: number;
}

export interface Village {
  readonly index: number;
  readonly s: number;
  /** Arclength span the street occupies, pond included. */
  readonly from: number;
  readonly to: number;
  readonly side: -1 | 1;
  readonly houses: readonly VillageHouse[];
  readonly pond: VillagePond;
}

/** The village in a slot, or null where the slot is empty country. */
export function villageAt(seed: number, index: number): Village | null {
  if (hash01(seed, TAG, index, 1) >= ODDS) return null;
  const base = index * SLOT_M;
  const s = base + JITTER_M + hash01(seed, TAG, index, 2) * (SLOT_M - 2 * JITTER_M);
  if (s < FIRST_S) return null;
  const side: -1 | 1 = hash01(seed, TAG, index, 3) < 0.5 ? -1 : 1;
  const houses = HOUSES_MIN + Math.floor(hash01(seed, TAG, index, 4) * HOUSES_SPAN);
  const pitch = PITCH_MIN + hash01(seed, TAG, index, 5) * PITCH_SPAN;
  const length = (houses - 1) * pitch;
  const from = s - length / 2;
  const to = s + length / 2;
  const shopHouse = Math.floor(hash01(seed, TAG, index, 6) * houses);

  const street: VillageHouse[] = [];
  for (let k = 0; k < houses; k++) {
    const mainSide = hash01(seed, TAG, index, 10 + k) < MAIN_SIDE_SHARE;
    const houseSide = mainSide ? side : -side;
    const lateral = houseSide * (STREET_LATERAL_MIN + hash01(seed, TAG, index, 40 + k) * STREET_LATERAL_SPAN);
    const isShop = k === shopHouse && hash01(seed, TAG, index, 7) < SHOP_CHANCE && SHOP_VARIANTS.length > 0;
    const catalog = isShop ? SHOP_VARIANTS : HOUSE_VARIANTS;
    const pick = Math.min(
      catalog.length - 1,
      Math.floor(hash01(seed, TAG, index, 70 + k) * catalog.length),
    );
    street.push({
      number: k,
      s: from + k * pitch,
      lateral,
      variant: catalog[pick]!,
      variantSeed: Math.floor(hash01(seed, TAG, index, 100 + k) * 0xffffff),
    });
  }

  const pondSide: -1 | 1 = side === 1 ? -1 : 1;
  const pond: VillagePond = {
    s: s + (hash01(seed, TAG, index, 8) * 2 - 1) * length * 0.55,
    lateral: pondSide * (POND_LATERAL_MIN + hash01(seed, TAG, index, 9) * POND_LATERAL_SPAN),
    radius: POND_RADIUS_MIN + hash01(seed, TAG, index, 11) * POND_RADIUS_SPAN,
    depth: POND_DEPTH_MIN + hash01(seed, TAG, index, 12) * POND_DEPTH_SPAN,
  };
  return { index, s, from: from - 30, to: to + 30, side, houses: street, pond };
}

/**
 * Every village whose ground meets an arclength range.
 *
 * Slot-addressed like `poisBetween` and for the same reason: the road is forty thousand
 * kilometres long, so a schedule that has to be walked from the start cannot be read by a
 * chunk. The range is widened by a slot at each end because a village's arclength sits
 * anywhere inside its slot.
 */
export function villagesBetween(seed: number, fromS: number, toS: number): Village[] {
  const out: Village[] = [];
  const first = Math.max(0, Math.floor((fromS - SLOT_M) / SLOT_M));
  const last = Math.floor((toS + SLOT_M) / SLOT_M);
  for (let index = first; index <= last; index++) {
    const village = villageAt(seed, index);
    if (!village) continue;
    if (village.to < fromS || village.from > toS) continue;
    out.push(village);
  }
  return out;
}

/** Every village along a road, for the schedules that need the pond list. */
export function villagesAlongRoad(seed: number, roadLength: number): Village[] {
  const out: Village[] = [];
  const count = Math.ceil(roadLength / SLOT_M);
  for (let index = 0; index < count; index++) {
    const village = villageAt(seed, index);
    if (village) out.push(village);
  }
  return out;
}
