import type { SurfaceType } from '../core/surfaces';
import { roadConditionAt } from './gradient';
import { roadsideSlotNear, roadsideSlotsBetween } from './poislots';
import { LANE_WIDTH } from './roadprofile';
import {
  LAYBY_TAPER_M,
  roadHalf,
  roadsideStop,
  SERVICE_DEPTH_M,
  SETTLEMENT_HALF_LENGTH_M,
} from './settlement';

/**
 * LAY-BYS: the paved pull-in in front of every roadside dwelling.
 *
 * A lay-by is a widening of the carriageway on the building's side of the road, laid
 * in whatever the road is laid in at the stop (`surface`). From
 * `sEntry` the asphalt's outer edge leaves the road edge and eases out (`LAYBY_TAPER_M`)
 * to the pad's full width at `sPadStart`, holds it to `sPadEnd` across the building's
 * front, and eases back to the road edge at `sExit`. Both slips are the same shape, so
 * traffic in the other direction can use the lay-by on its own side from `sExit` to
 * `sEntry`. The pad stops `FRONT_CLEAR_M` short of the building's front wall line.
 *
 * Everything here is a PURE function of the seed and road-frame coordinates, and the
 * module imports nothing that pulls in three.js or Rapier: the terrain (world/terrain.ts)
 * flattens the ground under every lay-by, and the terrain is also built inside the
 * desert tile and vista workers. Callers pass the road's ACTUAL half-width wherever an
 * edge is involved (`Road.halfWidthAt`, curve widening included), because that is not
 * a function of the seed alone; the lay-by's own numbers are.
 *
 * Coordinates: `s` is arclength; `u` is the unsigned lateral distance from the centre
 * line on the lay-by's side (`side * lateral`); laterals handed back are signed in the
 * `Road.offsetPoint` frame.
 *
 * Masts get no lay-by: nobody pulls in at a relay mast. Every other roadside stop has
 * one, so it is attached to the stop rather than spawned on its own: loot, saves and
 * `Poi.index` are untouched by it. Its numbers are the stop's plan (world/settlement.ts):
 * a lone house's pad runs across its front; a settlement's is longer and always full
 * width, the service strip (post, parking, shop) along its outer edge and the houses on
 * this side at both ends of it.
 */
export interface Layby {
  /** `Poi.index` of the stop it serves. */
  readonly poiIndex: number;
  /** `Poi.s`. */
  readonly s: number;
  /** Sign of `Poi.lateral`, in the `Road.offsetPoint` frame. */
  readonly side: 1 | -1;
  /** Where the entry slip leaves the asphalt edge. */
  readonly sEntry: number;
  /** The pad is at full width from here... */
  readonly sPadStart: number;
  /** ...to here. */
  readonly sPadEnd: number;
  /** Where the exit slip rejoins the asphalt edge. */
  readonly sExit: number;
  /**
   * `u` of the pad's road-side edge: the farthest out the road's own asphalt edge comes
   * anywhere along the lay-by (widening and the curve-widening ceiling included). The
   * lay-by's asphalt fills from the actual road edge, so it starts at or inside this;
   * a line laid off `padInner` is off the carriageway everywhere.
   */
  readonly padInner: number;
  /** `u` of the pad's building-side edge. */
  readonly padOuter: number;
  /** `u` of the farthest wall on this side: the flattened site reaches past it. */
  readonly siteOuter: number;
  /** Half the along-road extent of the buildings on this side, about `s`. */
  readonly siteHalfAlong: number;
  /**
   * What the pad is laid in: the road's own surface at the stop (`roadConditionAt` at
   * `s`), so a gravel road's lay-by is gravel and a concrete road's is concrete, in the
   * drawn mesh (world/laybymesh.ts), its collider and the terrain's answer alike. One
   * value for the whole lay-by: a district boundary falling across a slip does not
   * split it.
   */
  readonly surface: SurfaceType;
}

/** Parking line: this far out from `padInner`, metres (a car's flank ~2 m off the road). */
const PARK_INSET_M = 3;
/** ...but never closer than this to the pad's outer edge. */
const PARK_OUTER_CLEAR_M = 1.6;
/**
 * Fall of the pad away from the road, metres per metre. Level along the road edge, so
 * the slips meet the road with no step, and a one-percent fall outward, so the pad
 * reads as laid rather than as the road's banking extruded across twenty metres.
 */
export const LAYBY_CROSSFALL = 0.01;
/** Level ground kept past the asphalt's outline and past the building, metres. */
const FLAT_MARGIN_M = 4;
const SITE_MARGIN_M = 3;
/**
 * Distance over which the levelled ground eases back into the desert, metres. The
 * whole flattened site plus this stays inside the 70 m the desert tiles sample with an
 * exact road projection (deserttiledata `EXACT_DISTANCE_GATE`): siteOuter is at most
 * 6.5 + 22 + 25 m, plus `SITE_MARGIN_M`, plus this, is 68.5 m.
 */
const FLAT_BLEND_M = 12;
/**
 * Farthest from `Layby.s` anything of a stop reaches along the road: a settlement's
 * outermost house, and the levelled ground's blend past the slips.
 */
const LAYBY_REACH_M = SETTLEMENT_HALF_LENGTH_M + FLAT_BLEND_M;

const laybyCache = new Map<number, Map<number, Layby | null>>();

/** The lay-by at a roadside slot, or null (empty slot, or a mast). Memoised per seed. */
function laybyAtSlot(seed: number, slot: number): Layby | null {
  let bySlot = laybyCache.get(seed);
  if (!bySlot) {
    bySlot = new Map();
    laybyCache.set(seed, bySlot);
  }
  const cached = bySlot.get(slot);
  if (cached !== undefined) return cached;
  const stop = roadsideStop(seed, slot);
  const pad = stop?.pad;
  const layby: Layby | null =
    stop && pad
      ? {
          poiIndex: stop.roll.index,
          s: stop.roll.s,
          side: stop.roll.side,
          sEntry: pad.sEntry,
          sPadStart: pad.sPadStart,
          sPadEnd: pad.sPadEnd,
          sExit: pad.sExit,
          padInner: pad.padInner,
          padOuter: pad.padOuter,
          siteOuter: pad.siteOuter,
          siteHalfAlong: pad.siteHalfAlong,
          surface: roadConditionAt(seed, stop.roll.s).surface,
        }
      : null;
  bySlot.set(slot, layby);
  return layby;
}

/** Every lay-by whose [sEntry, sExit] overlaps [fromS, toS). */
export function laybysBetween(seed: number, fromS: number, toS: number): Layby[] {
  const out: Layby[] = [];
  for (const slot of roadsideSlotsBetween(seed, fromS - LAYBY_REACH_M, toS + LAYBY_REACH_M)) {
    const layby = laybyAtSlot(seed, slot);
    if (layby && layby.sExit >= fromS && layby.sEntry < toS) out.push(layby);
  }
  return out;
}

/**
 * The lay-by whose levelled ground reaches arclength `s`, or null. A bracket lookup the
 * terrain's runs of neighbouring vertices mostly answer from the last one
 * (world/poststops.ts `postBracket`), which is what lets the terrain ask it per vertex.
 */
export function laybyNear(seed: number, s: number): Layby | null {
  const slot = roadsideSlotNear(seed, s, LAYBY_REACH_M);
  if (slot < 0) return null;
  const layby = laybyAtSlot(seed, slot);
  if (!layby || s < layby.sEntry - FLAT_BLEND_M || s > layby.sExit + FLAT_BLEND_M) return null;
  return layby;
}

/** 0 on the road beyond the slips, easing to 1 at full pad width. */
function laybyOpening(l: Layby, s: number): number {
  if (s <= l.sEntry || s >= l.sExit) return 0;
  let t: number;
  if (s < l.sPadStart) t = (s - l.sEntry) / LAYBY_TAPER_M;
  else if (s > l.sPadEnd) t = (l.sExit - s) / LAYBY_TAPER_M;
  else return 1;
  return t * t * (3 - 2 * t);
}

/** `u` of the lay-by asphalt's outer edge at `s`: `halfWidth` where there is none. */
export function laybyOuterAt(l: Layby, s: number, halfWidth: number): number {
  return halfWidth + Math.max(0, l.padOuter - halfWidth) * laybyOpening(l, s);
}

/** `u` of the parking line, a car's centre on the pad. */
function parkU(l: Layby): number {
  return Math.min(l.padInner + PARK_INSET_M, l.padOuter - PARK_OUTER_CLEAR_M);
}

/**
 * Signed lateral of the drive line through the lay-by, for `s` in [sEntry, sExit]: the
 * centre of the road's edge lane at either end, the parking line along the pad, and the
 * same ease as the asphalt's outline in between, so the line keeps at least 1.45 m of
 * asphalt outside it all the way.
 */
export function laybyDriveLateral(l: Layby, s: number, halfWidth: number): number {
  const lane = halfWidth - LANE_WIDTH * 0.5;
  return l.side * (lane + (parkU(l) - lane) * laybyOpening(l, s));
}

/** Signed lateral of the parking line on the pad. The drive line runs along it. */
export function laybyParkLateral(l: Layby): number {
  return l.side * parkU(l);
}

/** Whether a road-frame point is on the lay-by's own pad (not the road's carriageway). */
export function onLaybyPad(l: Layby, s: number, lateral: number, halfWidth: number): boolean {
  const u = lateral * l.side;
  return u > halfWidth && u <= laybyOuterAt(l, s, halfWidth);
}

/**
 * Whether a point is on any lay-by's asphalt or inside any roadside stop's building, or
 * within `margin` metres of either: the keep-clear verge furniture, scatter and ground
 * cover test before standing in it. A settlement's houses stand on both sides of the
 * road, so the far side is tested too.
 */
export function laybyKeepsClear(
  seed: number,
  s: number,
  lateral: number,
  halfWidth: number,
  margin: number,
): boolean {
  const slot = roadsideSlotNear(seed, s, LAYBY_REACH_M);
  if (slot < 0) return false;
  const stop = roadsideStop(seed, slot);
  if (!stop) return false;
  for (const house of stop.layout.houses) {
    const { along, across } = roadHalf(house.halfX, house.halfZ);
    if (Math.abs(s - house.s) <= along + margin && Math.abs(lateral - house.lateral) <= across + margin) return true;
  }
  const l = laybyAtSlot(seed, slot);
  if (!l || lateral * l.side <= 0) return false;
  if (s < l.sEntry - margin || s > l.sExit + margin) return false;
  const u = lateral * l.side;
  // A settlement's service strip: the sand past the pad where the post, the shop and
  // the rest stand.
  if (stop.layout.settlement && s >= l.sPadStart - margin && s <= l.sPadEnd + margin) {
    if (u <= l.padOuter + SERVICE_DEPTH_M + margin) return true;
  }
  const clamped = Math.min(l.sExit, Math.max(l.sEntry, s));
  return u <= laybyOuterAt(l, clamped, halfWidth) + margin;
}

/**
 * How far the desert under a point is levelled to the lay-by, 0..1.
 *
 * 1 over the asphalt and `FLAT_MARGIN_M` round it, and over the whole building site,
 * so the building stands on the same level ground the pad does; easing to 0 over
 * `FLAT_BLEND_M` past that. The site's reach shortens one-for-one past the building's
 * ends, so the level region has no corner the weight could jump at.
 */
export function laybyFlattenWeight(l: Layby, s: number, lateral: number, halfWidth: number): number {
  const u = lateral * l.side;
  if (u <= 0) return 0;
  const sc = Math.min(l.sExit, Math.max(l.sEntry, s));
  const along = Math.abs(s - sc);
  if (along >= FLAT_BLEND_M) return 0;
  const siteReach =
    l.siteOuter + SITE_MARGIN_M - Math.max(0, Math.abs(sc - l.s) - l.siteHalfAlong - SITE_MARGIN_M);
  const reach = Math.max(laybyOuterAt(l, sc, halfWidth) + FLAT_MARGIN_M, siteReach);
  const across = Math.max(0, u - reach);
  const e = Math.hypot(across, along) / FLAT_BLEND_M;
  if (e >= 1) return 0;
  return 1 - e * e * (3 - 2 * e);
}

/**
 * The lay-by's level at `u`, given the road's edge height at the same arclength: the
 * edge carried out level along the road and falling `LAYBY_CROSSFALL` away from it.
 * The pad mesh and the terrain both use this, so they are one surface.
 */
export function laybyLevel(edgeY: number, u: number, halfWidth: number): number {
  return edgeY - LAYBY_CROSSFALL * Math.max(0, u - halfWidth);
}

/**
 * How much of the drawn desert under a point is the lay-by's asphalt, 0..1: 1 on it
 * and half a metre round it, 0 two metres out. The desert tiles sink the ground by this
 * much of their under-road offset, so the pad never z-fights the sand it lies on.
 */
export function laybyAsphaltCover(l: Layby, s: number, lateral: number, halfWidth: number): number {
  const u = lateral * l.side;
  if (u <= 0) return 0;
  const sc = Math.min(l.sExit, Math.max(l.sEntry, s));
  const outside = Math.hypot(Math.max(0, u - laybyOuterAt(l, sc, halfWidth)), s - sc);
  if (outside <= 0.5) return 1;
  if (outside >= 2) return 0;
  const t = (outside - 0.5) / 1.5;
  return 1 - t * t * (3 - 2 * t);
}
