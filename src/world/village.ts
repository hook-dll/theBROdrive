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
export const VILLAGE_SLOT_M = 8500;
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
/**
 * Ground the street's span covers beyond the outermost houses, metres. The gap to the next
 * village is 6-11 km, so this is a margin and not a share of the slot.
 */
const STREET_MARGIN_M = 30;

/**
 * The pond: how big, how deep, and how far its WATER stands from the centreline.
 *
 * Measured off the water's EDGE, not its centre, and that is the whole point. The bowl is
 * dug where the edge says, so what a house has to clear is the edge; placing the centre at
 * a fixed lateral let a 62 m bowl reach 7 m PAST the centreline, and it put houses in the
 * water: over 300 km of road, 8 of 337 houses stood inside a pond's bowl and 4 of them had
 * their ground below the pond's own level, the closest 14 m inside it. The edge is now
 * behind the outer house line (`STREET_LATERAL_MIN + STREET_LATERAL_SPAN`) plus a bank, so
 * no house and no stretch of street can be inside a pond however the two rolls fall.
 */
const POND_EDGE_MIN = 42;
const POND_EDGE_SPAN = 30;
/** Radius of the bowl, and its depth below the surrounding grade. */
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

/**
 * Where a village's street lies, without building the village: what the HEADING needs.
 *
 * `RoadHeading.at()` asks whether a village covers an arclength, and that is the hottest
 * question in the world — the spine walk, the block replay, `curvatureAt` inside every
 * `terrain.heightAt`. Going through `villageAt` for it built a whole Village per sample:
 * five to twenty house objects, the pond, sixty hashes. Measured over 2000 km of spine,
 * `buildSpine` cost 3.70-3.80 s against 0.09-0.12 s while the heading did its own work,
 * and `terrain.heightAt` near the road 156.7 µs against 6.4. Hence this: the SAME hashes,
 * the same `from`/`to`, and no allocation.
 */
export interface VillageSpan {
  readonly index: number;
  /** Arclength whose street covers it, pond included. */
  readonly from: number;
  readonly to: number;
}

/**
 * Memo of the last slot's span. The heading asks about the same slot for thousands of
 * consecutive samples (a slot is 8.5 km of road), so one entry is what makes the lookup
 * free in the walk rather than merely small.
 */
let spanMemoSeed = -1;
let spanMemoIndex = -1;
let spanMemo: VillageSpan | null = null;

/**
 * The street span of a slot, or null where that slot is empty country.
 *
 * The frame of a village and nothing else, so it can be asked thousands of times a frame.
 * `villageAt` builds on THIS, which is what keeps the two from ever disagreeing about where
 * a village is.
 */
export function villageSpanAt(seed: number, index: number): VillageSpan | null {
  if (index === spanMemoIndex && seed === spanMemoSeed) return spanMemo;
  spanMemoSeed = seed;
  spanMemoIndex = index;
  spanMemo = null;
  if (hash01(seed, TAG, index, 1) < ODDS) {
    const base = index * VILLAGE_SLOT_M;
    const s = base + JITTER_M + hash01(seed, TAG, index, 2) * (VILLAGE_SLOT_M - 2 * JITTER_M);
    if (s >= FIRST_S) {
      const houses = HOUSES_MIN + Math.floor(hash01(seed, TAG, index, 4) * HOUSES_SPAN);
      const pitch = PITCH_MIN + hash01(seed, TAG, index, 5) * PITCH_SPAN;
      const half = ((houses - 1) * pitch) / 2;
      spanMemo = { index, from: s - half - STREET_MARGIN_M, to: s + half + STREET_MARGIN_M };
    }
  }
  return spanMemo;
}

/**
 * The span covering an arclength, or null — the heading's own lookup.
 *
 * Only the slots either side of `s` are asked, so it stays O(1); `STREET_MARGIN_M` is far
 * inside a slot (8.5 km), so a street is never missed by the two-slot window.
 */
export function villageSpanCovering(seed: number, s: number): VillageSpan | null {
  const slot = Math.floor(s / VILLAGE_SLOT_M);
  for (let index = slot - 1; index <= slot + 1; index++) {
    if (index < 0) continue;
    const span = villageSpanAt(seed, index);
    if (span && s >= span.from && s <= span.to) return span;
  }
  return null;
}

/**
 * The village whose street covers an arclength, or null.
 *
 * For callers that need the houses — the chunk builders. The heading uses
 * `villageSpanCovering`, which builds nothing.
 */
export function villageCovering(seed: number, s: number): Village | null {
  const span = villageSpanCovering(seed, s);
  return span === null ? null : villageAt(seed, span.index);
}

/** The village in a slot, or null where the slot is empty country. */
export function villageAt(seed: number, index: number): Village | null {
  const span = villageSpanAt(seed, index);
  if (span === null) return null;
  const base = index * VILLAGE_SLOT_M;
  const s = base + JITTER_M + hash01(seed, TAG, index, 2) * (VILLAGE_SLOT_M - 2 * JITTER_M);
  const side: -1 | 1 = hash01(seed, TAG, index, 3) < 0.5 ? -1 : 1;
  const houses = HOUSES_MIN + Math.floor(hash01(seed, TAG, index, 4) * HOUSES_SPAN);
  const pitch = PITCH_MIN + hash01(seed, TAG, index, 5) * PITCH_SPAN;
  const length = (houses - 1) * pitch;
  // The street's own span comes from the slot's span, so the frame the heading reads and
  // the frame the houses are built on cannot drift apart.
  const from = span.from + STREET_MARGIN_M;
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
  const pondRadius = POND_RADIUS_MIN + hash01(seed, TAG, index, 11) * POND_RADIUS_SPAN;
  const pond: VillagePond = {
    s: s + (hash01(seed, TAG, index, 8) * 2 - 1) * length * 0.55,
    // The edge first, the centre derived from it: see POND_EDGE_MIN.
    lateral: pondSide * (POND_EDGE_MIN + hash01(seed, TAG, index, 9) * POND_EDGE_SPAN + pondRadius),
    radius: pondRadius,
    depth: POND_DEPTH_MIN + hash01(seed, TAG, index, 12) * POND_DEPTH_SPAN,
  };
  return { index, s, from: span.from, to: span.to, side, houses: street, pond };
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
  const first = Math.max(0, Math.floor((fromS - VILLAGE_SLOT_M) / VILLAGE_SLOT_M));
  const last = Math.floor((toS + VILLAGE_SLOT_M) / VILLAGE_SLOT_M);
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
  const count = Math.ceil(roadLength / VILLAGE_SLOT_M);
  for (let index = 0; index < count; index++) {
    const village = villageAt(seed, index);
    if (village) out.push(village);
  }
  return out;
}
