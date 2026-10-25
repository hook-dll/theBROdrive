import { hash01 } from '../core/rng';
import { DWELLING_HALF_EXTENTS } from './dwellings/bounds';
import { DWELLINGS } from './dwellings/list';
import { dwellingFootprint, MAST_IDS, roadsideSlot, roadsideSlotOfIndex, structureIsMast, type RoadsideSlot } from './poislots';
import { CURVE_WIDENING_M, halfWidthAt } from './roadprofile';
import type { Poi } from './poi';
import type { Road } from './road';

/**
 * THE ROADSIDE STOP'S PLAN: where its buildings stand, how long and how wide its lay-by
 * is, and where the services go. Every courier/post stop is a SETTLEMENT (game-design2.md
 * §6): four to seven houses of the stop's one dwelling type on both sides of the road,
 * and on the lay-by's side one long pad with its service band (§6.3): the signpost, the
 * teddy shelter, the post, the toy box, the parking row of three angled slots (a haul's
 * load waits in the first, hauls are handed in in the second, a car for sale sometimes
 * stands in the third), the shop and sometimes the pumps. Every other roadside
 * stop is one house in front of its own short lay-by.
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
 * (world/poi.ts `standingHouses`). The services stand on the lay-by's own asphalt and
 * are never dropped.
 */

/**
 * A place in the road frame. `yaw` is relative to the road heading at `s`: absolute is
 * `heading + yaw`. For anything authored with its front at local -Z (houses, the vending
 * machine, boards) it turns that front to the road, the convention of `faceRoadYaw`; for
 * `parking` it is the heading offset of a car standing nose out in the middle slot.
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
  /** On the pad's service band, its back to the asphalt's outer edge, facing the road. Settlements only. */
  readonly post: SettlementSpot | null;
  /** Ditto. Settlements only. */
  readonly shop: SettlementSpot | null;
  /** The toy box (world/toybox.ts), between the post and the stop; its car comes out on the pad in front of it. Settlements only. */
  readonly toybox: SettlementSpot | null;
  /**
   * The teddy shelter (world/shelter.ts, game-design2.md §10), its open front to the pad.
   * Settlements only.
   */
  readonly shelter: SettlementSpot | null;
  /**
   * THE PARKING ROW (world/haulbay.ts `postParkingSlots`, §6.3, §7.8): the middle one of
   * three slots side by side at `PARKING_SLOT_ANGLE` to the road on the pad's service
   * band, `yaw` the nose-out heading of a car reversed into it. Settlements only.
   */
  readonly parking: SettlementSpot | null;
  /**
   * The pumps' island (world/pumps.ts) at half the settlements (§6.3, §9): petrol, oil
   * and water in a row along the pad. Faces the road. Settlements only.
   */
  readonly pumps: SettlementSpot | null;
  /** The parking row's third slot holds a car for sale (world/poi.ts `buildLot`). Settlements only. */
  readonly forSale: boolean;
}

/** The lay-by's numbers, in the road frame: see world/layby.ts for what each one shapes. */
export interface StopPad {
  readonly sEntry: number;
  readonly sPadStart: number;
  readonly sPadEnd: number;
  readonly sExit: number;
  readonly padInner: number;
  readonly padOuter: number;
  /** `u` where a settlement's service band starts: its furniture stands past it, its parking slots reach in across it. `padOuter` for a lone house. */
  readonly serviceInner: number;
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
 * A settlement's pad, either side of the stop, metres: the service band (game-design2.md
 * §6.3) and the signpost at its start.
 */
export const SETTLEMENT_PAD_HALF_M = 30;
/** Length of each slip: road edge to full pad width, metres. */
export const LAYBY_TAPER_M = 36;
/** Clear sand left between the pad and a building's front wall line, metres. */
const FRONT_CLEAR_M = 2;
/**
 * Widest the pad is past `padInner`, metres: two cars side by side with room to open a
 * door. A lone house set 22 m back is not fronted by 20 m of asphalt; the pad stays a
 * lay-by and the sand runs on to the building.
 */
const PAD_MAX_WIDTH_M = 8.5;
/**
 * A settlement's pad is wider by its SERVICE BAND, metres: the post's furniture stands on
 * the asphalt along the outer edge, not on the sand past it (owner, 2026-10-25: all of
 * the post's furniture on the asphalt), and the parking row's slots reach into it. 3.5 m
 * holds the machines' 1.6 m depth with their backs 0.4 m in from the edge, and puts the
 * slots' nearest corners 0.5 m clear of a car on the parking line (world/layby.ts).
 */
const SERVICE_BAND_M = 3.5;
/** Clear ground between the pad's ends and any house, metres. */
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

/** Fraction of settlements with pumps. */
const PUMPS_CHANCE = 0.5;
/** Fraction of settlements with a car for sale in the parking row's third slot. */
const LOT_CHANCE = 0.3;

/**
 * The service band (game-design2.md §6.3 table), along the pad from the stop (`s`),
 * metres, and in from the pad's outer edge (`u`), to each thing's centre: each stands
 * with its back about 0.4 m in from the asphalt's edge. The signpost
 * (world/signposts.ts) stands on the sand at the pad's start, 26 m short of the stop;
 * the courier parks on the pad at the stop itself.
 *
 * `s` is the road's arclength, so on the inside of a curve the band is shorter than the
 * numbers: measured over 1 174 settlements, two spots 2.5 m apart come up to 12% closer.
 * The post and the toy box stand 2.9 m apart so the two machines keep a metre between
 * them everywhere. The parking row is laid straight along the road's tangent at its
 * middle (world/haulbay.ts), 17 m of it, so the toy box before it and the shop after it
 * stand 12 m from its middle: 2.9 m clear on a straight, still 1.4 m on the tightest
 * inside of a curve.
 */
const SHELTER_ALONG_M = -9.8;
const SHELTER_IN_M = 1.05;
const POST_ALONG_M = -5.6;
const POST_IN_M = 1.2;
const TOYBOX_ALONG_M = -2.7;
const TOYBOX_IN_M = 1.2;
/** The parking row's middle slot, along the road: the row spans about +1…+18. */
const PARKING_ALONG_M = 9.5;
const SHOP_ALONG_M = 21.5;
const SHOP_IN_M = 1.2;
/** The pumps' island, +24…+28. */
const PUMPS_ALONG_M = 26;
const PUMPS_IN_M = 1.0;

/**
 * THE PARKING ROW'S SLOTS (§6.3, §7.8): inside, half a slot's width and half its depth,
 * metres. 3.5 m holds the widest car (1.9 m) with room to walk between two parked side
 * by side and open a door; 6.6 m holds the KMZ trailer with its drawbar, or the
 * longest car, the GAZ-31029's 4.88 m, with room to spare.
 */
export const PARKING_SLOT_HALF_WIDTH_M = 1.75;
export const PARKING_SLOT_HALF_DEPTH_M = 3.3;
/**
 * The slots' angle to the road, radians: a herringbone row `/ / /` (seen from the road)
 * leaning with the lay-by's direction of travel, so a car arriving turns in nose first
 * at 45° without stopping. A haul's load is handed in reversed in (§7.8): the trailer
 * backs in against the travel, its drawbar to the opening, and leaves nose first; its
 * waiting load stands the same way, ready to hitch.
 */
export const PARKING_SLOT_ANGLE = Math.PI / 4;
/** Between neighbouring slots' middles along the row, metres: their sides touch. */
export const PARKING_SLOT_PITCH_M = (2 * PARKING_SLOT_HALF_WIDTH_M) / Math.sin(PARKING_SLOT_ANGLE);
/** Half a slot's reach in the road frame, along the road and across it alike at 45°, metres. */
export const PARKING_SLOT_REACH_M =
  PARKING_SLOT_HALF_DEPTH_M * Math.sin(PARKING_SLOT_ANGLE) + PARKING_SLOT_HALF_WIDTH_M * Math.cos(PARKING_SLOT_ANGLE);
/**
 * The row's middle in from the pad's outer edge, metres: the slots' back corners 0.5 m
 * short of it, room for the paint and for the row's ends wandering out on a curve.
 */
const PARKING_IN_M = 0.5 + PARKING_SLOT_REACH_M;

/**
 * The signpost (world/signposts.ts) on every pad: along from the pad's start and out
 * past its outer edge, to the board's centre.
 */
export const SIGNPOST_ALONG_M = 4;
export const SIGNPOST_OUT_M = 1.0;

/**
 * Half sizes (along the road, across it) each service is kept clear by, metres. The
 * placement bench (tools/poi-placement.ts) measures houses, the lay-by and one another
 * against these.
 */
export const SERVICE_HALF: Readonly<Record<'post' | 'shop' | 'toybox' | 'pumps' | 'shelter', readonly [number, number]>> = {
  // The card machines (world/cardmachine.ts): the crank's knob past one flank, the tray
  // standing out of the front.
  post: [0.75, 0.8],
  shop: [0.75, 0.8],
  toybox: [0.75, 0.8],
  // The island under the three pumps (world/pumps.ts).
  pumps: [2.0, 0.6],
  // The teddy shelter's canopy, 3.5 x 1.3 m (world/shelter.ts): a bench under a lean-to
  // roof on two posts, no longer a 3.8 x 2 m three-walled box (owner, 2026-10-25). It
  // stands on the service band, its back 0.4 m in from the asphalt's edge.
  shelter: [1.75, 0.65],
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
      serviceInner: padOuter,
      siteOuter: front + 2 * authoredHalf,
      siteHalfAlong: authoredHalf,
    };
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
      toybox: null,
      shelter: null,
      parking: null,
      pumps: null,
      forSale: false,
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
  const padOuter = padInner + PAD_MAX_WIDTH_M + SERVICE_BAND_M;

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

  // THE LAY-BY'S SIDE: houses at both ends of the pad, alternating, each set
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

  // The services along the pad's service band (the `*_ALONG_M` table above).
  const face = faceRoad(side, 0);
  const pumps = roll01(6) < PUMPS_CHANCE ? spot(s0 + PUMPS_ALONG_M, side, padOuter - PUMPS_IN_M, face) : null;
  // Nose out of a slot: against the lay-by's traffic (-s on side -1) and in toward the road.
  const noseOut = Math.atan2(-side * Math.sin(PARKING_SLOT_ANGLE), side * Math.cos(PARKING_SLOT_ANGLE));

  // Everything of the stop's own stands on the pad; the houses on this side reach past it.
  let siteOuter = padOuter;
  let siteHalfAlong = SETTLEMENT_PAD_HALF_M;
  for (const p of nearPlaced) {
    siteOuter = Math.max(siteOuter, p.u + p.across);
    siteHalfAlong = Math.max(siteHalfAlong, Math.abs(p.s - s0) + p.along);
  }

  return {
    roll,
    pad: { sEntry, sPadStart, sPadEnd, sExit, padInner, padOuter, serviceInner: padOuter - SERVICE_BAND_M, siteOuter, siteHalfAlong },
    layout: {
      poiIndex: roll.index,
      settlement: true,
      side,
      structure,
      houses,
      post: spot(s0 + POST_ALONG_M, side, padOuter - POST_IN_M, face),
      shop: spot(s0 + SHOP_ALONG_M, side, padOuter - SHOP_IN_M, face),
      toybox: spot(s0 + TOYBOX_ALONG_M, side, padOuter - TOYBOX_IN_M, face),
      shelter: spot(s0 + SHELTER_ALONG_M, side, padOuter - SHELTER_IN_M, face),
      parking: spot(s0 + PARKING_ALONG_M, side, padOuter - PARKING_IN_M, noseOut),
      pumps,
      forSale: roll01(5) < LOT_CHANCE,
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
  const roll = roadsideSlot(seed, slot);
  const stop = roll === null ? null : roll.settlement ? settlementStop(seed, roll) : loneStop(seed, roll);
  bySlot.set(slot, stop);
  return stop;
}

/** A roadside POI's layout: its buildings and services. Pure and memoised. */
export function settlementLayout(seed: number, poi: Poi): SettlementLayout {
  if (poi.desert) throw new Error(`settlementLayout: POI ${poi.index} is out in the desert`);
  const stop = roadsideStop(seed, roadsideSlotOfIndex(poi.index));
  if (!stop || stop.layout.poiIndex !== poi.index) throw new Error(`settlementLayout: no roadside stop for POI ${poi.index}`);
  return stop.layout;
}

/** A spot's absolute world position and yaw on the road it was laid out along. */
export function spotPose(road: Road, at: SettlementSpot): { x: number; z: number; yaw: number } {
  const p = road.offsetPoint(at.s, at.lateral);
  return { x: p.x, z: p.z, yaw: road.headingAt(at.s) + at.yaw };
}
