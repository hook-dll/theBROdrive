import { hash, hash01 } from '../core/rng';
import { POST_GAP_MIN_M, postBracket, postS } from './poststops';
import { DWELLINGS } from './dwellings/list';
import { ROAD_LENGTH } from './road';

/**
 * The roadside stops' PURE ROLLS: which slots are occupied, by which building, on
 * which side and how far back from the asphalt. Nothing here builds, samples the road or
 * imports three.js, because two worlds read it: world/poi.ts, which builds the stops,
 * and world/layby.ts, whose lay-bys the terrain flattens in the desert tile and vista
 * workers as well as on the main thread. Both reading this one roll is what keeps the
 * paved lay-by in front of the building it serves.
 */

/**
 * THE ROADSIDE SLOTS follow the post network (world/poststops.ts): slot `2k + 1` is post
 * stop `k`, always a settlement; slot `2k + 2` is the gap after it, where a lone house
 * may stand when the gap is long enough to keep it `POST_GAP_MIN_M` from both
 * settlements. So no two roadside stops are ever closer than that, the first one is the
 * first post, and a slot's arclength comes from the seed alone.
 */
/** Fraction of long gaps that hold a lone house; the rest read as empty desert. */
const LONE_OCCUPANCY = 0.55;
/** Domain tag for the POI hash stream, distinct from every other subsystem. */
const POI_DOMAIN = 0x504f4931; // 'POI1'

/**
 * Where the roadside population's identities live in `lootedPois`; see
 * `DESERT_INDEX_BASE` in world/poi.ts for why both are offset. Moved on from 50 000 000
 * when the slots stopped being a fixed lattice: an index from before names another stop.
 */
const ROADSIDE_INDEX_BASE = 70_000_000;
/** Slot of post stop 0, the start settlement. */
const START_SLOT = 1;

/** The post stop a slot is (or follows, for a gap slot). */
export function slotPost(slot: number): number {
  return (slot - 1) >> 1;
}

/** The roadside slot behind a roadside `Poi.index`. */
export function roadsideSlotOfIndex(poiIndex: number): number {
  return poiIndex - ROADSIDE_INDEX_BASE;
}

/** Gap-house arclengths per seed and slot, NaN for none: the terrain asks constantly. */
const gapCache = new Map<number, Map<number, number>>();

/**
 * Arclength of roadside slot `slot`, or NaN when it is a gap too short for a house or
 * does not roll one. Pure in (seed, slot).
 */
export function roadsideSlotS(seed: number, slot: number): number {
  if (slot < 1) return NaN;
  const k = slotPost(slot);
  if (slot % 2 === 1) return postS(seed, k);
  let bySlot = gapCache.get(seed);
  if (!bySlot) {
    bySlot = new Map();
    gapCache.set(seed, bySlot);
  }
  const cached = bySlot.get(slot);
  if (cached !== undefined) return cached;
  const at = postS(seed, k);
  const next = postS(seed, k + 1);
  const room = (next - at) / 2 - POST_GAP_MIN_M;
  const s = room < 0 || hash01(seed, POI_DOMAIN, slot) >= LONE_OCCUPANCY
    ? NaN
    : (at + next) / 2 + (hash01(seed, POI_DOMAIN, slot, 5) - 0.5) * 2 * room;
  bySlot.set(slot, s);
  return s;
}

/** Occupied roadside slots whose arclength falls in [fromS, toS), in order. */
export function roadsideSlotsBetween(seed: number, fromS: number, toS: number): number[] {
  const out: number[] = [];
  // From the gap before the first post at or past `fromS`: its house may stand inside.
  for (let k = Math.max(0, postBracket(seed, fromS).before); ; k++) {
    if (postS(seed, k) >= toS) {
      // The gap before this post may still hold a house inside the range.
      const gapS = k > 0 ? roadsideSlotS(seed, 2 * k) : NaN;
      if (gapS >= fromS && gapS < toS) out.push(2 * k);
      break;
    }
    for (const slot of [2 * k, 2 * k + 1]) {
      if (slot < 1) continue;
      const s = roadsideSlotS(seed, slot);
      if (s >= fromS && s < toS && s <= ROAD_LENGTH) out.push(slot);
    }
  }
  return out;
}

/**
 * The occupied roadside slot nearest arclength `s` if it is within `reach` metres, else
 * -1. Constant work: the posts either side and the gap house between them.
 */
export function roadsideSlotNear(seed: number, s: number, reach: number): number {
  const { before, after } = postBracket(seed, s);
  let best = -1;
  let bestD = reach;
  const consider = (slot: number): void => {
    const d = Math.abs(roadsideSlotS(seed, slot) - s);
    if (d <= bestD) {
      best = slot;
      bestD = d;
    }
  };
  if (before >= 0) consider(2 * before + 1);
  consider(2 * after + 1);
  if (before >= 0) consider(2 * after);
  return best;
}

/**
 * Clear verge between the ASPHALT EDGE and a building's nearest wall, metres.
 *
 * Measured from the edge rather than from the centreline because the road widens: one
 * fixed offset from the crown is 12 m of clearance on a two-lane stretch and 6 m on a
 * four-lane one, which is how a kiosk ends up at the paint. `halfWidthAt` is usable
 * there because it is a pure function of the seed and the arclength — no road sampling —
 * so the placement stays as pure and as cheap as it was.
 */
const VARIANT_SETBACK_MIN_M = 10;
const VARIANT_SETBACK_SPAN_M = 12;

/**
 * The masts built from the POI kit; they come first in `POI_STRUCTURES`. The fallen
 * tower is not among them: it stays in the POI gallery (world/poi-variants.ts) only.
 */
export const MAST_IDS = ['standing-tower', 'relay-cluster'] as const;
/** Masts, then every dwelling: the length of world/poistructures.ts `POI_STRUCTURES`. */
const STRUCTURE_COUNT = MAST_IDS.length + DWELLINGS.length;

/** Whether a structure index is one of the masts rather than a dwelling. */
export function structureIsMast(structure: number): boolean {
  return structure < MAST_IDS.length;
}

/** A dwelling's authored `[x, z]` footprint, or null for a mast. */
export function dwellingFootprint(structure: number): readonly [number, number] | null {
  if (structureIsMast(structure)) return null;
  const definition = DWELLINGS[structure - MAST_IDS.length];
  if (!definition) throw new RangeError(`Unknown POI structure ${structure}`);
  return definition.footprint;
}

/**
 * Which building stands at a slot: a hash of the slot, so having seen an izba at one
 * stop tells a player nothing about the next one.
 */
export function rollStructure(seed: number, domain: number, key: number): number {
  return Math.min(STRUCTURE_COUNT - 1, Math.floor(hash01(seed, domain, key, 1) * STRUCTURE_COUNT));
}

/** Structure indices of the dwellings people still live in: what a settlement is built of. */
const LIVED_IN: readonly number[] = DWELLINGS.flatMap((definition, index) =>
  definition.abandoned ? [] : [MAST_IDS.length + index],
);

/**
 * A settlement's one dwelling type: the slot's own roll, unless that is a mast or a ruin,
 * which nobody runs a post and a shop out of; then another draw among the lived-in ones.
 */
function rollSettlement(seed: number, slot: number): number {
  const rolled = rollStructure(seed, POI_DOMAIN, slot);
  if (LIVED_IN.includes(rolled)) return rolled;
  return LIVED_IN[Math.floor(hash01(seed, POI_DOMAIN, slot, 6) * LIVED_IN.length)]!;
}

/** One occupied roadside slot, rolled: everything about the stop except its lateral. */
export interface RoadsideSlot {
  readonly slot: number;
  /** `Poi.index`: identity in `WorldState.lootedPois`, stable forever. */
  readonly index: number;
  /** Arclength of the stop, metres from the house. */
  readonly s: number;
  /** Which side of the road it stands on, in the road frame's lateral sign. */
  readonly side: 1 | -1;
  /** Clear ground between the asphalt edge (`halfWidthAt`) and the building, metres. */
  readonly verge: number;
  readonly structure: number;
  readonly variantSeed: number;
  /** A courier/post stop: a settlement of `structure` houses (world/settlement.ts). */
  readonly settlement: boolean;
}

/** The roadside slot's roll, or null when the slot is empty desert or off the road. */
export function roadsideSlot(seed: number, slot: number): RoadsideSlot | null {
  const s = roadsideSlotS(seed, slot);
  if (!(s <= ROAD_LENGTH)) return null;
  // A post slot is a settlement with its «ПОЧТА» machine; a gap slot is one house.
  const settlement = slot % 2 === 1;
  const structure = settlement ? rollSettlement(seed, slot) : rollStructure(seed, POI_DOMAIN, slot);
  return {
    slot,
    index: ROADSIDE_INDEX_BASE + slot,
    s,
    // The start (post 0) is on the right, the power poles' side (world/props/poles.ts):
    // the player begins beside the road the game drives, not across it.
    side: slot === START_SLOT || hash01(seed, POI_DOMAIN, slot, 2) < 0.5 ? -1 : 1,
    verge: VARIANT_SETBACK_MIN_M + hash01(seed, POI_DOMAIN, slot, 3) * VARIANT_SETBACK_SPAN_M,
    structure,
    variantSeed: hash(seed, POI_DOMAIN, slot, 4),
    settlement,
  };
}
