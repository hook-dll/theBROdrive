import { hash01 } from '../core/rng';

/**
 * How wide the road is at an arclength, and how many lanes that buys each direction.
 *
 * A pure function of (seed, s), exactly like every other road property. Nothing is
 * stored: the spine, its IndexedDB cache and the worker payload carry centreline
 * positions only and are untouched by this file, and a save restores the same
 * carriageway because it restores the same seed.
 *
 * THE SHAPE OF IT. Most of the road is what it always was: one lane each way,
 * 5.8 m of asphalt. Every so often — a third of the 5 km cells, and adjacent wide
 * cells merge into longer runs — it opens out to two lanes each way over a 260 m
 * taper, holds, and closes again. That is a real road's history rather than a
 * tumbler: the wide stretches are what is left of a highway somebody stopped
 * maintaining, so `gradient.ts` road condition and this profile are deliberately
 * independent fields sampled over the same distance.
 *
 * THE INNER LANE NEVER MOVES. Lane 0 is centred at ±1.45 m whatever the road is
 * doing, so widening adds a lane on the OUTSIDE and narrowing takes that one away.
 * Nothing driving the inner lane has to react to a taper at all; only a car in the
 * outer lane has to merge, and it has the whole taper to do it in.
 */

/** Width of one lane, metres. Two of them are the narrow road's whole asphalt. */
export const LANE_WIDTH = 2.9;
/** Half-width of the narrow (one lane each way) carriageway. */
export const NARROW_HALF_WIDTH = LANE_WIDTH;
/** Half-width where the road is fully open: two lanes each way. */
export const WIDE_HALF_WIDTH = LANE_WIDTH * 2;

/** Cell lattice the wide stretches are drawn on, metres. */
const CELL_M = 5_000;
/** Fraction of cells that open out. Adjacent wide cells merge into one long run. */
const WIDE_CHANCE = 0.32;
/** Length of the wedge where the outer lane is gained or lost, metres. */
const TAPER_M = 260;
/**
 * Wideness at which the outer lane is declared DRIVEABLE.
 *
 * Below it the wedge is still narrower than a lane, so a car placed in it would be
 * half on the shoulder; above it the outer lane is at least 2.6 m wide. Traffic and
 * the autopilot both read lane COUNT from this, so it is also the point a merge has
 * to be finished by — which is why it sits inside the taper rather than at its end.
 */
const LANE_OPEN = 0.9;
/**
 * The first kilometre is never widened.
 *
 * The homestead's driveway is a wedge that meets the asphalt EDGE (`house.ts`), the
 * runout is dead straight by construction, and the player's first five minutes are
 * authored against a two-lane road. A widening rolled onto cell 0 would put the
 * garage a lane's width short of the tarmac.
 */
const HOME_NARROW_M = 1_000;

const PROFILE_DOMAIN = 0x52575431; // 'RWT1'

function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function cellIsWide(seed: number, cell: number): boolean {
  if (cell < 0) return false;
  return hash01(seed, PROFILE_DOMAIN, cell) < WIDE_CHANCE;
}

/**
 * How far the road is opened out at `s`, 0 (narrow) to 1 (two lanes each way).
 *
 * Only the immediate neighbouring cells are consulted, which is exact because the
 * taper is far shorter than a cell: a wide cell beside another wide cell has no
 * wedge between them, so a run of them is one continuous carriageway.
 */
export function widenessAt(seed: number, s: number): number {
  const cell = Math.floor(s / CELL_M);
  if (!cellIsWide(seed, cell)) return 0;
  const fromStart = s - cell * CELL_M;
  const toEnd = (cell + 1) * CELL_M - s;
  const opening = cellIsWide(seed, cell - 1) ? 1 : smoothstep01(fromStart / TAPER_M);
  const closing = cellIsWide(seed, cell + 1) ? 1 : smoothstep01(toEnd / TAPER_M);
  // The home clamp is a wedge like any other, so a widening that starts inside the
  // first kilometre opens out of it rather than stepping a lane into existence.
  const home = smoothstep01((s - HOME_NARROW_M) / TAPER_M);
  return Math.min(opening, closing, home);
}

/** Half-width of the asphalt at an arclength, metres. */
export function halfWidthAt(seed: number, s: number): number {
  return LANE_WIDTH * (1 + widenessAt(seed, s));
}

/** Driveable lanes in ONE direction at an arclength: 1 or 2. */
export function lanesPerSideAt(seed: number, s: number): number {
  return widenessAt(seed, s) >= LANE_OPEN ? 2 : 1;
}

/**
 * Half the width of a lane's own band.
 *
 * Lane 0 is always a full lane; the outer one is whatever the widening has actually
 * laid down, which is a full lane on an open stretch and no less than 2.6 m at the
 * point it is first declared driveable. Anything deciding whether a body fits in a
 * lane asks this rather than assuming `LANE_WIDTH`.
 */
export function laneHalfWidthFor(halfWidth: number, lane: number): number {
  return lane <= 0 ? LANE_WIDTH * 0.5 : (halfWidth - LANE_WIDTH) * 0.5;
}
/**
 * Centre of a lane, as an unsigned distance from the crown. Lane 0 is the one beside
 * the centre line and never moves; lane 1 is the outer one, centred in whatever the
 * widening has actually laid down so it stays on the asphalt right through a taper.
 */
export function laneOffsetFor(halfWidth: number, lane: number): number {
  if (lane <= 0) return LANE_WIDTH * 0.5;
  return LANE_WIDTH + (halfWidth - LANE_WIDTH) * 0.5;
}
