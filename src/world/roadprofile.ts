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

/**
 * PASSING PLACES, NOT A SECOND ROAD.
 *
 * The widening used to be drawn on 5 km cells with a third of them open and adjacent
 * open cells merging, which is a coin toss over long distances rather than a road:
 * measured on seed 1337, forty kilometres held TWO wide stretches, the longer of them
 * 4.6 km, and 22.9% of the road. A driver therefore met the second lane roughly once
 * an hour and then lived in it for minutes.
 *
 * Road engineering builds the opposite shape for exactly this problem. Where a
 * two-lane road cannot offer the sight distance an overtake needs — and ours cannot,
 * a third of it has under 150 m of it — the answer is a short climbing or overtaking
 * lane repeated often: sections of a kilometre or so every five to eight kilometres,
 * so a queue is released regularly instead of once. That is what this lattice now
 * draws: one window per cell, its length and position hashed, with the taper short
 * enough that the window holds real full-width road in the middle of it.
 */
const CELL_M = 6_500;
/** Shortest and longest a window is, metres, before its tapers are taken off. */
const WINDOW_MIN_M = 900;
const WINDOW_MAX_M = 1_600;
/** Length of the wedge where the outer lane is gained or lost, metres. */
const TAPER_M = 200;
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

/** Where the passing window inside a cell begins and ends, metres of arclength. */
function windowOf(seed: number, cell: number, out: { start: number; end: number }): void {
  const length =
    WINDOW_MIN_M + hash01(seed, PROFILE_DOMAIN, cell) * (WINDOW_MAX_M - WINDOW_MIN_M);
  // Placed anywhere in the cell that leaves the whole window, taper included, inside
  // it: neighbouring cells then never interact and the answer stays two hashes.
  const room = CELL_M - length - TAPER_M * 2;
  const start =
    cell * CELL_M + TAPER_M + hash01(seed, PROFILE_DOMAIN ^ 0x9e37, cell) * Math.max(room, 0);
  out.start = start;
  out.end = start + length;
}

/** Scratch for `widenessAt`, which is called per road-mesh vertex row. */
const windowScratch = { start: 0, end: 0 };

/**
 * How far the road is opened out at `s`, 0 (narrow) to 1 (two lanes each way).
 *
 * One window per cell, tapered at both ends. Only the cell `s` falls in is consulted,
 * because a window plus its tapers is placed wholly inside its own cell.
 */
export function widenessAt(seed: number, s: number): number {
  const cell = Math.floor(s / CELL_M);
  if (cell < 0) return 0;
  windowOf(seed, cell, windowScratch);
  const opening = smoothstep01((s - windowScratch.start) / TAPER_M + 1);
  const closing = smoothstep01((windowScratch.end - s) / TAPER_M + 1);
  // The home clamp is a wedge like any other, so a widening that starts inside the
  // first kilometre opens out of it rather than stepping a lane into existence.
  const home = smoothstep01((s - HOME_NARROW_M) / TAPER_M);
  return Math.min(opening, closing, home);
}

/**
 * CURVE WIDENING: extra half-width a tight corner is built with, metres.
 *
 * Real roads are widened on small radii, for two reasons that both apply here: a long
 * body tracks a wider path than its own width through a bend, and a driver's lateral
 * error grows with how hard the corner is working the steering. Measured when the
 * tight districts arrived: on a switchback stretch the lane-keeping RMS went from
 * 0.08 m to 0.28 m with peaks past 2 m, and on a 2.9 m lane with oncoming traffic at
 * its own 1.45 m that leaves under a metre between passing bodies — which is where the
 * contacts came from. Seven tenths of a metre each side gives the error room to exist
 * without becoming a collision, and it disappears by the radius at which the steering
 * stops working for it.
 */
const CURVE_WIDENING_M = 0.7;
const CURVE_WIDENING_FULL_RADIUS = 120;
const CURVE_WIDENING_NONE_RADIUS = 320;

export function curveWidening(curvature: number): number {
  const magnitude = Math.abs(curvature);
  if (magnitude < 1e-5) return 0;
  const radius = 1 / magnitude;
  if (radius <= CURVE_WIDENING_FULL_RADIUS) return CURVE_WIDENING_M;
  if (radius >= CURVE_WIDENING_NONE_RADIUS) return 0;
  const t =
    (CURVE_WIDENING_NONE_RADIUS - radius) /
    (CURVE_WIDENING_NONE_RADIUS - CURVE_WIDENING_FULL_RADIUS);
  return CURVE_WIDENING_M * t * t * (3 - 2 * t);
}

/** Half-width of the asphalt at an arclength, metres, before curve widening. */
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
