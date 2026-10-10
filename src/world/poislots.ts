import { hash, hash01 } from '../core/rng';
import { GAMEPLAY_CONFIG } from '../config';
import { isCourierPoiSlot } from './couriers';
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
 * Metres of arclength between POI slots: 7.7 km, from `config/gameplay.json`. Not a
 * player setting any more; a slider that re-rolled every stop on the road was a debug
 * knob, and it moved `Poi.index`, which the looted flags are keyed by.
 */
export const POI_SPACING = GAMEPLAY_CONFIG.poiSpacingMetres;
/** Fraction of roadside slots that contain a POI; the rest read as empty desert. */
const POI_OCCUPANCY = 0.55;
/** Domain tag for the POI hash stream, distinct from every other subsystem. */
const POI_DOMAIN = 0x504f4931; // 'POI1'

/**
 * Where the roadside population's identities live in `lootedPois`; see
 * `DESERT_INDEX_BASE` in world/poi.ts for why both are offset.
 */
const ROADSIDE_INDEX_BASE = 50_000_000;

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

/** The three masts built from the POI kit; they come first in `POI_STRUCTURES`. */
export const MAST_IDS = ['standing-tower', 'fallen-tower', 'relay-cluster'] as const;
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
 * What a stop leaves outside for the player, in the terms the world used when every
 * building was one of them: a forecourt's `fuel`, a shop's `store` of tools, a `home`'s
 * medicine, a scrapyard's `salvage` field of cars, a wreck's `scrap` and a mast's
 * maintenance kit.
 */
export type PoiStock = 'fuel' | 'store' | 'home' | 'salvage' | 'scrap' | 'mast';

/**
 * A dwelling's stock, by weight. The weights are the old catalogue's building counts
 * per kind — five petrol stations, five shops, six houses, three container yards, four
 * wrecks — so a stop pays out, on average, exactly what a stop paid out before the
 * buildings were replaced. Masts keep the mast stock.
 */
const DWELLING_STOCK: readonly { readonly stock: PoiStock; readonly weight: number }[] = [
  { stock: 'fuel', weight: 5 },
  { stock: 'store', weight: 5 },
  { stock: 'home', weight: 6 },
  { stock: 'salvage', weight: 3 },
  { stock: 'scrap', weight: 4 },
];
const DWELLING_STOCK_TOTAL = DWELLING_STOCK.reduce((sum, entry) => sum + entry.weight, 0);

/**
 * Which building, and what it holds. There is deliberately no progression to learn:
 * both are hashes of the slot, so having seen fuel outside one izba tells a player
 * nothing about the next one.
 */
export function rollStructure(seed: number, domain: number, key: number): { structure: number; stock: PoiStock } {
  const structure = Math.min(STRUCTURE_COUNT - 1, Math.floor(hash01(seed, domain, key, 1) * STRUCTURE_COUNT));
  if (structureIsMast(structure)) return { structure, stock: 'mast' };
  let cursor = hash01(seed, domain, key, 5) * DWELLING_STOCK_TOTAL;
  for (const entry of DWELLING_STOCK) {
    cursor -= entry.weight;
    if (cursor < 0) return { structure, stock: entry.stock };
  }
  return { structure, stock: DWELLING_STOCK[DWELLING_STOCK.length - 1]!.stock };
}

/**
 * Whether a roadside slot has a building: null rolls read as empty desert. A courier
 * slot always has one, because the courier parks beside it.
 */
function roadsideOccupied(seed: number, slot: number, spacing: number): boolean {
  return hash01(seed, POI_DOMAIN, slot) < POI_OCCUPANCY || isCourierPoiSlot(seed, slot, spacing);
}

/** Stops of the drive whose car field always has a car to take (see `Poi.guaranteedCar`). */
const GUARANTEED_CAR_STOPS = 2;

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
  readonly stock: PoiStock;
  readonly variantSeed: number;
  readonly guaranteedCar: boolean;
}

/** The roadside slot's roll, or null when the slot is empty desert or off the road. */
export function roadsideSlot(seed: number, slot: number, spacing: number): RoadsideSlot | null {
  const s = slot * spacing;
  if (slot < 1 || s > ROAD_LENGTH) return null;
  if (!roadsideOccupied(seed, slot, spacing)) return null;
  let earlier = 0;
  for (let k = 1; k < slot && earlier < GUARANTEED_CAR_STOPS; k++) {
    if (roadsideOccupied(seed, k, spacing)) earlier++;
  }
  const { structure, stock } = rollStructure(seed, POI_DOMAIN, slot);
  return {
    slot,
    index: ROADSIDE_INDEX_BASE + slot,
    s,
    side: hash01(seed, POI_DOMAIN, slot, 2) < 0.5 ? -1 : 1,
    verge: VARIANT_SETBACK_MIN_M + hash01(seed, POI_DOMAIN, slot, 3) * VARIANT_SETBACK_SPAN_M,
    structure,
    stock,
    variantSeed: hash(seed, POI_DOMAIN, slot, 4),
    guaranteedCar: earlier < GUARANTEED_CAR_STOPS,
  };
}
