import { hash01 } from '../core/rng';
import { DWELLING_HALF_EXTENTS } from './dwellings/bounds';
import { DWELLINGS } from './dwellings/list';
import { dwellingFootprint, MAST_IDS, POI_SPACING, roadsideSlot, structureIsMast, type RoadsideSlot } from './poislots';
import { CURVE_WIDENING_M, halfWidthAt } from './roadprofile';
import type { Poi } from './poi';
import type { Road } from './road';

/**
 * THE ROADSIDE STOP'S PLAN: where its buildings stand, how long and how wide its lay-by
 * is, and where the services go. Every courier/post stop is a SETTLEMENT (game-design2.md
 * §6): four to seven houses of the stop's one dwelling type on both sides of the road,
 * and on the lay-by's side one long pad with the post, a parking place, the shop and
 * sometimes a barrel stand, a car for sale or a trailer. Every other roadside stop is one
 * house in front of its own short lay-by.
 *
 * PURE: a function of the seed and the slot, with no road or terrain sampling beyond
 * `halfWidthAt`, which is itself a function of the seed. Two worlds read it: world/poi.ts
 * builds the stop, and world/layby.ts derives the lay-by and its levelled site from it,
 * inside the desert tile and vista workers as well as on the main thread. So nothing here
 * imports three.js; a house's size is its MEASURED size written down
 * (dwellings/bounds.ts), which tools/poi-placement.ts holds to the built house.
 *
 * Coordinates are the road frame: `s` arclength, `lateral` signed in the
 * `Road.offsetPoint` frame, `u` the unsigned distance on the lay-by's side. A spot's `yaw`
 * is RELATIVE to the road heading at its own `s` (`spotPose` makes it absolute).
 *
 * What the pure plan cannot know is the ground: a house that lands on a landform, a mesa,
 * a lake basin or another pass of the road is dropped where the stop is built
 * (world/poi.ts `standingHouses`). The services stand on the levelled lay-by site and
 * are never dropped.
 */

/**
 * A place in the road frame. `yaw` is relative to the road heading at `s`: absolute is
 * `heading + yaw`. For anything authored with its front at local -Z (houses, the vending
 * machine, boards) it turns that front to the road, the convention of `faceRoadYaw`; for
 * `lot` and `trailer` it is the vehicle's own heading offset (0: parked along travel).
 */
export interface SettlementSpot {
  readonly s: number;
  readonly lateral: number;
  readonly yaw: number;
}

/** One building of a stop: which structure, and its measured half extents in its own frame. */
export interface SettlementHouse extends SettlementSpot {
  readonly structure: number;
  readonly variantSeed: number;
  /** Along its front (local X), metres. */
  readonly halfX: number;
  /** Its depth (local Z), metres. */
  readonly halfZ: number;
}

export interface SettlementLayout {
  readonly poiIndex: number;
  /** True at every courier/post stop; false for a lone roadside building. */
  readonly settlement: boolean;
  /** The lay-by's and services' side, as a signed-lateral sign. */
  readonly side: 1 | -1;
  /** The one structure every building of the stop is. */
  readonly structure: number;
  readonly houses: readonly SettlementHouse[];
  /** On the sand just past the pad's edge, facing the road. Settlements only. */
  readonly post: SettlementSpot | null;
  /** Ditto. Settlements only. */
  readonly shop: SettlementSpot | null;
  /** Half the settlements and a fifth of the lone houses; faces the road. */
  readonly barrels: SettlementSpot | null;
  /**
   * The car for sale's centre, parked along the road; about 2.3 m of sand between the pad
   * edge and its road-side flank is kept for its price board and key box. Settlements only.
   */
  readonly lot: SettlementSpot | null;
  /** A trailer left on the strip (`TRAILER_CHANCE` of settlements). */
  readonly trailer: SettlementSpot | null;
}

/** The lay-by's numbers, in the road frame: see world/layby.ts for what each one shapes. */
export interface StopPad {
  readonly sEntry: number;
  readonly sPadStart: number;
  readonly sPadEnd: number;
  readonly sExit: number;
  readonly padInner: number;
  readonly padOuter: number;
  /** `u` of the farthest wall on the lay-by's side: the levelled site reaches past it. */
  readonly siteOuter: number;
  /** Half the along-road extent of the buildings on the lay-by's side, about `Layby.s`. */
  readonly siteHalfAlong: number;
}

export interface RoadsideStop {
  readonly roll: RoadsideSlot;
  readonly layout: SettlementLayout;
  /** Null for a mast: nobody pulls in at a relay mast. */
  readonly pad: StopPad | null;
}

/** Arclength of a lone house's pad at full width either side of the stop, metres. */
export const PAD_HALF_LENGTH_M = 22;
/**
 * A settlement's pad, either side of the stop, metres: the service strip (post, parking,
 * shop, barrels, car for sale, trailer) and the signpost at its start.
 */
export const SETTLEMENT_PAD_HALF_M = 30;
/** Length of each slip: road edge to full pad width, metres. */
export const LAYBY_TAPER_M = 36;
/** Clear sand left between the pad and a building's front wall line, metres. */
const FRONT_CLEAR_M = 2;
/**
 * Widest the pad is past `padInner`, metres: two cars side by side with room to open a
 * door. A lone house set 22 m back is not fronted by 20 m of asphalt; the pad stays a
 * lay-by and the sand runs on to the building. A settlement's pad is always this wide.
 */
const PAD_MAX_WIDTH_M = 8.5;

/** Depth of the service strip past the pad's outer edge, metres. */
export const SERVICE_DEPTH_M = 6;
/** Clear ground between the service strip and any house, metres. */
const SERVICE_HOUSE_GAP_M = 2.5;
/** Farthest from the stop any of a settlement's houses reaches along the road, metres. */
export const SETTLEMENT_HALF_LENGTH_M = 75;
/** Clear ground between neighbouring houses along the road: least, and rolled span. */
export const HOUSE_GAP_MIN_M = 5;
const HOUSE_GAP_SPAN_M = 5;
/** Verge between the asphalt edge and a settlement house's front, metres. */
const VERGE_MIN_M = 10;
const VERGE_SPAN_M = 12;
/** Largest yaw wobble a house is turned off square to the road, radians either way. */
const HOUSE_WOBBLE = 0.08;

/** Fraction of settlements with a barrel stand, and of lone houses. */
const SETTLEMENT_BARRELS_CHANCE = 0.5;
const LONE_BARRELS_CHANCE = 0.2;
/** Fraction of settlements with a car for sale. */
const LOT_CHANCE = 0.3;
/**
 * Fraction of settlements with a trailer left on the strip: what a stop had before, when
 * the fuel stops (5 of 23 by weight) left one 45% of the time.
 */
const TRAILER_CHANCE = 0.1;

/**
 * The service strip, along the pad from the stop (`s`), metres, and out past the pad's
 * edge (`u`), to each thing's centre. The signpost (world/signposts.ts) stands at the
 * pad's start, 26 m short of the stop; the courier parks on the pad at the stop itself.
 */
const LOT_ALONG_M = -16;
const LOT_OUT_M = 4.3;
const POST_ALONG_M = -6;
const POST_OUT_M = 1.0;
const SHOP_ALONG_M = 6;
const SHOP_OUT_M = 0.9;
const BARRELS_ALONG_M = 14;
const BARRELS_OUT_M = 1.4;
const TRAILER_ALONG_M = 23;
const TRAILER_OUT_M = 2.2;
/** A lone house's barrel stand: clear sand between it and the end of the front wall, metres. */
const LONE_BARRELS_GAP_M = 1.5;
const LONE_BARRELS_OUT_M = 1.4;

/**
 * Half sizes (along the road, across it) each service is kept clear by, metres. The
 * placement bench (tools/poi-placement.ts) measures houses, the lay-by and one another
 * against these.
 */
export const SERVICE_HALF: Readonly<Record<'post' | 'shop' | 'barrels' | 'lot' | 'trailer', readonly [number, number]>> = {
  post: [1.0, 0.6],
  shop: [0.6, 0.5],
  barrels: [1.8, 1.0],
  // The car and, on its road-side flank, its board and key box.
  lot: [2.7, 2.6],
  trailer: [2.5, 1.1],
};

/** The masts' authored footprints (world/poi-variants.ts), halved: they have no measured table. */
const MAST_HALF: Readonly<Record<string, readonly [number, number]>> = {
  'standing-tower': [5, 5],
  'relay-cluster': [11.5, 8],
};

const DOMAIN = 0x53544c31; // 'STL1'

/** A structure's half extents in its own frame. */
export function structureHalfExtents(structure: number): readonly [number, number] {
  if (structureIsMast(structure)) {
    const half = MAST_HALF[MAST_IDS[structure]!];
    if (!half) throw new RangeError(`No size for mast ${structure}`);
    return half;
  }
  const id = DWELLINGS[structure - MAST_IDS.length]?.id;
  const half = id === undefined ? undefined : DWELLING_HALF_EXTENTS[id];
  if (!half) throw new RangeError(`No measured size for POI structure ${structure}`);
  return half;
}

/** The yaw that turns a front (local -Z) to the road, relative to the heading. */
function faceRoad(side: number, wobble: number): number {
  return (side >= 0 ? Math.PI / 2 : -Math.PI / 2) + wobble;
}

/** A house's wobble off square to the road, from its seed: `faceRoadYaw`'s. */
function houseWobble(variantSeed: number): number {
  return (hash01(variantSeed, 7) - 0.5) * 2 * HOUSE_WOBBLE;
}

/**
 * Road-frame half extents of a house turned `wobble` off square: what it covers along the
 * road and across it, whatever its corners do. With the largest wobble it bounds any
 * house of that size; the lay-by's keep-clear and the placement bench read it that way.
 */
export function roadHalf(halfX: number, halfZ: number, wobble = HOUSE_WOBBLE): { along: number; across: number } {
  const c = Math.cos(wobble);
  const s = Math.abs(Math.sin(wobble));
  return { along: halfX * c + halfZ * s, across: halfZ * c + halfX * s };
}

/** Widest the asphalt is over an arclength range, metres. */
function widestHalfWidth(seed: number, from: number, to: number, step: number): number {
  let edge = 0;
  for (let s = from; s <= to; s += step) edge = Math.max(edge, halfWidthAt(seed, s));
  return Math.max(edge, halfWidthAt(seed, to));
}

function spot(s: number, side: number, u: number, yaw: number): SettlementSpot {
  return { s, lateral: side * u, yaw };
}

function loneStop(seed: number, roll: RoadsideSlot): RoadsideStop {
  const [halfX, halfZ] = structureHalfExtents(roll.structure);
  // The building's centre: the half width plus the verge plus its AUTHORED half size,
  // which contains the measured one (tools/poi-placement.ts). Unchanged from before the
  // settlements, so a lone house stands where it always stood.
  const authored = dwellingFootprint(roll.structure);
  const authoredHalf = Math.max(halfX, halfZ, authored ? Math.max(authored[0], authored[1]) / 2 : 0);
  const lateral = roll.side * (halfWidthAt(seed, roll.s) + roll.verge + authoredHalf);
  const house: SettlementHouse = {
    s: roll.s,
    lateral,
    yaw: faceRoad(roll.side, houseWobble(roll.variantSeed)),
    structure: roll.structure,
    variantSeed: roll.variantSeed,
    halfX,
    halfZ,
  };
  const mast = structureIsMast(roll.structure);
  let pad: StopPad | null = null;
  let barrels: SettlementSpot | null = null;
  if (!mast) {
    const sEntry = roll.s - PAD_HALF_LENGTH_M - LAYBY_TAPER_M;
    const sExit = roll.s + PAD_HALF_LENGTH_M + LAYBY_TAPER_M;
    const padInner = widestHalfWidth(seed, sEntry, sExit, 6) + CURVE_WIDENING_M;
    const front = halfWidthAt(seed, roll.s) + roll.verge;
    const padOuter = Math.min(front - FRONT_CLEAR_M, padInner + PAD_MAX_WIDTH_M);
    pad = {
      sEntry,
      sPadStart: roll.s - PAD_HALF_LENGTH_M,
      sPadEnd: roll.s + PAD_HALF_LENGTH_M,
      sExit,
      padInner,
      padOuter,
      siteOuter: front + 2 * authoredHalf,
      siteHalfAlong: authoredHalf,
    };
    if (hash01(roll.variantSeed, DOMAIN, 1) < LONE_BARRELS_CHANCE) {
      // Past one end of the front wall, on the sand between the pad and the wall line.
      const along = roadHalf(halfX, halfZ, HOUSE_WOBBLE).along;
      const dir = hash01(roll.variantSeed, DOMAIN, 2) < 0.5 ? -1 : 1;
      const s = roll.s + dir * (along + LONE_BARRELS_GAP_M + SERVICE_HALF.barrels[0]);
      barrels = spot(s, roll.side, padOuter + LONE_BARRELS_OUT_M, faceRoad(roll.side, 0));
    }
  }
  return {
    roll,
    pad,
    layout: {
      poiIndex: roll.index,
      settlement: false,
      side: roll.side,
      structure: roll.structure,
      houses: [house],
      post: null,
      shop: null,
      barrels,
      lot: null,
      trailer: null,
    },
  };
}

interface Placing {
  s: number;
  u: number;
  along: number;
  across: number;
  variantSeed: number;
}

function settlementStop(seed: number, roll: RoadsideSlot): RoadsideStop {
  const side = roll.side;
  const s0 = roll.s;
  const structure = roll.structure;
  const [halfX, halfZ] = structureHalfExtents(structure);

  const sPadStart = s0 - SETTLEMENT_PAD_HALF_M;
  const sPadEnd = s0 + SETTLEMENT_PAD_HALF_M;
  const sEntry = sPadStart - LAYBY_TAPER_M;
  const sExit = sPadEnd + LAYBY_TAPER_M;
  const padInner = widestHalfWidth(seed, sEntry, sExit, 6) + CURVE_WIDENING_M;
  const padOuter = padInner + PAD_MAX_WIDTH_M;
  const stripOuter = padOuter + SERVICE_DEPTH_M;

  const roll01 = (...keys: number[]): number => hash01(roll.variantSeed, DOMAIN, ...keys);
  const count = 4 + Math.min(3, Math.floor(roll01(3) * 4));
  const nearCount = Math.floor(count / 2);

  /** One house's roll: its wobble, road-frame size, verge and the gap after it. */
  const rollHouse = (k: number): Placing & { verge: number; gap: number } => {
    const variantSeed = Math.floor(roll01(10, k) * 0x7fffffff);
    const wobble = houseWobble(variantSeed);
    const { along, across } = roadHalf(halfX, halfZ, wobble);
    return {
      s: 0,
      u: 0,
      along,
      across,
      variantSeed,
      verge: VERGE_MIN_M + roll01(11, k) * VERGE_SPAN_M,
      gap: HOUSE_GAP_MIN_M + roll01(12, k) * HOUSE_GAP_SPAN_M,
    };
  };

  const houses: SettlementHouse[] = [];
  const nearPlaced: Placing[] = [];
  const add = (p: Placing, sideSign: 1 | -1): void => {
    houses.push({
      s: p.s,
      lateral: sideSign * p.u,
      yaw: faceRoad(sideSign, houseWobble(p.variantSeed)),
      structure,
      variantSeed: p.variantSeed,
      halfX,
      halfZ,
    });
  };

  // THE LAY-BY'S SIDE: houses at both ends of the service strip, alternating, each set
  // back past the pad's outline wherever the lay-by runs beside it.
  let before = sPadStart - SERVICE_HOUSE_GAP_M;
  let after = sPadEnd + SERVICE_HOUSE_GAP_M;
  for (let k = 0; k < nearCount; k++) {
    const h = rollHouse(k);
    const atStart = k % 2 === 0;
    const s = atStart ? before - h.along : after + h.along;
    if (Math.abs(s - s0) + h.along > SETTLEMENT_HALF_LENGTH_M) continue;
    // Beside the lay-by (slips included) the front clears the pad's widest outline.
    const besideLayby = s + h.along > sEntry - FRONT_CLEAR_M && s - h.along < sExit + FRONT_CLEAR_M;
    const edge = widestHalfWidth(seed, s - h.along, s + h.along, 4);
    const front = Math.max(edge + h.verge, besideLayby ? padOuter + FRONT_CLEAR_M : 0);
    const u = front + h.across;
    const placed = { ...h, s, u };
    add(placed, side);
    nearPlaced.push(placed);
    if (atStart) before = s - h.along - h.gap;
    else after = s + h.along + h.gap;
  }

  // THE FAR SIDE: one row across from the stop, as many as fit the settlement's length.
  const far: (Placing & { verge: number; gap: number })[] = [];
  for (let k = 0; k < count - nearCount; k++) far.push(rollHouse(100 + k));
  const rowLength = (row: typeof far): number =>
    row.reduce((sum, h, i) => sum + 2 * h.along + (i > 0 ? row[i - 1]!.gap : 0), 0);
  while (far.length > 1 && rowLength(far) > 2 * SETTLEMENT_HALF_LENGTH_M - 10) far.pop();
  const slack = 2 * SETTLEMENT_HALF_LENGTH_M - rowLength(far);
  let cursor = s0 - rowLength(far) / 2 + (roll01(4) - 0.5) * Math.min(slack, 20);
  for (const h of far) {
    const s = cursor + h.along;
    const u = widestHalfWidth(seed, s - h.along, s + h.along, 4) + h.verge + h.across;
    add({ ...h, s, u }, side > 0 ? -1 : 1);
    cursor = s + h.along + h.gap;
  }

  // The services, along the strip in the order a driver reaches them.
  const face = faceRoad(side, 0);
  const lot = roll01(5) < LOT_CHANCE ? spot(s0 + LOT_ALONG_M, side, padOuter + LOT_OUT_M, 0) : null;
  const barrels = roll01(6) < SETTLEMENT_BARRELS_CHANCE ? spot(s0 + BARRELS_ALONG_M, side, padOuter + BARRELS_OUT_M, face) : null;
  const trailer = roll01(7) < TRAILER_CHANCE ? spot(s0 + TRAILER_ALONG_M, side, padOuter + TRAILER_OUT_M, 0) : null;

  let siteOuter = stripOuter;
  let siteHalfAlong = SETTLEMENT_PAD_HALF_M;
  for (const p of nearPlaced) {
    siteOuter = Math.max(siteOuter, p.u + p.across);
    siteHalfAlong = Math.max(siteHalfAlong, Math.abs(p.s - s0) + p.along);
  }

  return {
    roll,
    pad: { sEntry, sPadStart, sPadEnd, sExit, padInner, padOuter, siteOuter, siteHalfAlong },
    layout: {
      poiIndex: roll.index,
      settlement: true,
      side,
      structure,
      houses,
      post: spot(s0 + POST_ALONG_M, side, padOuter + POST_OUT_M, face),
      shop: spot(s0 + SHOP_ALONG_M, side, padOuter + SHOP_OUT_M, face),
      barrels,
      lot,
      trailer,
    },
  };
}

const stopCache = new Map<number, Map<number, RoadsideStop | null>>();

/** The roadside stop at a slot, or null when the slot is empty desert. Memoised per seed. */
export function roadsideStop(seed: number, slot: number): RoadsideStop | null {
  let bySlot = stopCache.get(seed);
  if (!bySlot) {
    bySlot = new Map();
    stopCache.set(seed, bySlot);
  }
  const cached = bySlot.get(slot);
  if (cached !== undefined) return cached;
  const roll = roadsideSlot(seed, slot, POI_SPACING);
  const stop = roll === null ? null : roll.settlement ? settlementStop(seed, roll) : loneStop(seed, roll);
  bySlot.set(slot, stop);
  return stop;
}

/** A roadside POI's layout: its buildings and services. Pure and memoised. */
export function settlementLayout(seed: number, poi: Poi): SettlementLayout {
  if (poi.desert) throw new Error(`settlementLayout: POI ${poi.index} is out in the desert`);
  const stop = roadsideStop(seed, Math.round(poi.s / POI_SPACING));
  if (!stop || stop.layout.poiIndex !== poi.index) throw new Error(`settlementLayout: no roadside stop for POI ${poi.index}`);
  return stop.layout;
}

/** A spot's absolute world position and yaw on the road it was laid out along. */
export function spotPose(road: Road, at: SettlementSpot): { x: number; z: number; yaw: number } {
  const p = road.offsetPoint(at.s, at.lateral);
  return { x: p.x, z: p.z, yaw: road.headingAt(at.s) + at.yaw };
}
