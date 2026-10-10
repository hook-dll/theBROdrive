import { isCourierPoiSlot } from './couriers';
import { dwellingFootprint, POI_SPACING, roadsideSlot } from './poislots';
import { CURVE_WIDENING_M, halfWidthAt, LANE_WIDTH } from './roadprofile';

/**
 * LAY-BYS: the paved pull-in in front of every roadside dwelling.
 *
 * A lay-by is a widening of the asphalt on the building's side of the road. From
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
 * `Poi.index` are untouched by it.
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
  /** `u` of the building's far wall: the flattened site reaches past it. */
  readonly siteOuter: number;
  /** Half the building's authored size along the road. */
  readonly siteHalfAlong: number;
  /** Whether a courier car parks on this pad (`laybyCourierLateral`, at `s`). */
  readonly courier: boolean;
}

/** Arclength of the pad at full width either side of the stop, metres. */
const PAD_HALF_LENGTH_M = 22;
/** Length of each slip: road edge to full pad width, metres. */
export const LAYBY_TAPER_M = 36;
/** Clear sand left between the pad and the building's front wall line, metres. */
const FRONT_CLEAR_M = 2;
/**
 * Widest the pad is past `padInner`, metres: two cars side by side with room to open a
 * door. A stop set 22 m back is not fronted by 20 m of asphalt; the pad stays a lay-by
 * and the sand runs on to the building.
 */
const PAD_MAX_WIDTH_M = 8.5;
/** Parking line: this far out from `padInner`, metres (a car's flank ~2 m off the road). */
const PARK_INSET_M = 3;
/** ...but never closer than this to the pad's outer edge. */
const PARK_OUTER_CLEAR_M = 1.6;
/** A courier car parks this far in from the pad's outer edge. */
const COURIER_INSET_M = 1.4;
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
/** Farthest from `Layby.s` anything of a lay-by reaches, along the road. */
const LAYBY_REACH_M = PAD_HALF_LENGTH_M + LAYBY_TAPER_M + FLAT_BLEND_M;

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
  const roll = roadsideSlot(seed, slot, POI_SPACING);
  const footprint = roll ? dwellingFootprint(roll.structure) : null;
  let layby: Layby | null = null;
  if (roll && footprint) {
    const half = Math.max(footprint[0], footprint[1]) / 2;
    const sEntry = roll.s - PAD_HALF_LENGTH_M - LAYBY_TAPER_M;
    const sExit = roll.s + PAD_HALF_LENGTH_M + LAYBY_TAPER_M;
    let edge = 0;
    for (let s = sEntry; s <= sExit; s += 6) edge = Math.max(edge, halfWidthAt(seed, s));
    const padInner = edge + CURVE_WIDENING_M;
    // The front wall line: world/poi.ts stands the building's centre at the half width
    // plus the verge plus its half size, and its depth is never more than that size.
    const front = halfWidthAt(seed, roll.s) + roll.verge;
    const padOuter = Math.min(front - FRONT_CLEAR_M, padInner + PAD_MAX_WIDTH_M);
    layby = {
      poiIndex: roll.index,
      s: roll.s,
      side: roll.side,
      sEntry,
      sPadStart: roll.s - PAD_HALF_LENGTH_M,
      sPadEnd: roll.s + PAD_HALF_LENGTH_M,
      sExit,
      padInner,
      padOuter,
      siteOuter: front + 2 * half,
      siteHalfAlong: half,
      courier: isCourierPoiSlot(seed, roll.slot, POI_SPACING),
    };
  }
  bySlot.set(slot, layby);
  return layby;
}

/** Every lay-by whose [sEntry, sExit] overlaps [fromS, toS). */
export function laybysBetween(seed: number, fromS: number, toS: number): Layby[] {
  const out: Layby[] = [];
  const first = Math.max(1, Math.floor((fromS - LAYBY_REACH_M) / POI_SPACING));
  const last = Math.ceil((toS + LAYBY_REACH_M) / POI_SPACING);
  for (let slot = first; slot <= last; slot++) {
    const layby = laybyAtSlot(seed, slot);
    if (layby && layby.sExit >= fromS && layby.sEntry < toS) out.push(layby);
  }
  return out;
}

/**
 * The lay-by whose levelled ground reaches arclength `s`, or null. One rounding and one
 * comparison on the ~99% of the road nowhere near one, which is what lets the terrain
 * ask it per vertex.
 */
export function laybyNear(seed: number, s: number): Layby | null {
  const slot = Math.round(s / POI_SPACING);
  if (slot < 1 || Math.abs(s - slot * POI_SPACING) > LAYBY_REACH_M) return null;
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

/** Signed lateral a courier car parks at, on the pad's building side, at `l.s`. */
export function laybyCourierLateral(l: Layby): number {
  return l.side * (l.padOuter - COURIER_INSET_M);
}

/** Whether a road-frame point is on the lay-by's own asphalt (not the road's). */
export function onLaybyAsphalt(l: Layby, s: number, lateral: number, halfWidth: number): boolean {
  const u = lateral * l.side;
  return u > halfWidth && u <= laybyOuterAt(l, s, halfWidth);
}

/**
 * Whether a point is on any lay-by's asphalt, or within `margin` metres of its outline:
 * the keep-clear verge furniture, scatter and ground cover test before standing in it.
 */
export function laybyKeepsClear(
  seed: number,
  s: number,
  lateral: number,
  halfWidth: number,
  margin: number,
): boolean {
  const l = laybyNear(seed, s);
  if (!l || lateral * l.side <= 0) return false;
  if (s < l.sEntry - margin || s > l.sExit + margin) return false;
  const clamped = Math.min(l.sExit, Math.max(l.sEntry, s));
  return lateral * l.side <= laybyOuterAt(l, clamped, halfWidth) + margin;
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
