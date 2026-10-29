/**
 * How open a kit car's cabin is to the listener's two ears, from its doors, windows,
 * quarter vents and tailgate or rear doors (KitRig channels), the seat he sits in and where his head
 * is turned.
 *
 * Each opening lets a share of the outside in to the car's side it is on. A window
 * leaks steeply as it starts down (`leak`): a gap of a few centimetres is most of the
 * hiss of the road, and the rest of the travel only adds the body of it. Openings on the
 * listener's own row count fully, the other row's less, and an open door is the outside
 * itself. Several openings on a side combine as independent leaks. Each ear then hears
 * its own side and a share of the other (sound crosses the cabin), so one window by the
 * head is loud on that side and quieter on the other, and every window down sounds
 * like standing outside.
 */

import type { KitRig } from '../carkit/rig';
import { seatRow, type PlayerSeat } from '../game/state';

/** [channel, car side (+1 left, -1 right, 0 both), row (0 front, 1 rear), share at full open]. */
const OPENINGS: readonly (readonly [string, -1 | 0 | 1, 0 | 1, number])[] = [
  ['door_fl', 1, 0, 1],
  ['door_fr', -1, 0, 1],
  ['door_rl', 1, 1, 1],
  ['door_rr', -1, 1, 1],
  ['window_fl', 1, 0, 0.85],
  ['window_fr', -1, 0, 0.85],
  ['window_rl', 1, 1, 0.85],
  ['window_rr', -1, 1, 0.85],
  ['vent_fl', 1, 0, 0.3],
  ['vent_fr', -1, 0, 0.3],
  ['tailgate', 0, 1, 0.6],
  // A split tailgate's two leaves (the UAZ-2206's rear doors), each half of it.
  ['tailgate_l', 0, 1, 0.3],
  ['tailgate_r', 0, 1, 0.3],
];

/** An opening on the other row than the listener's counts this much. */
const OTHER_ROW = 0.6;
/** Share of the far side's openness an ear still hears across the cabin. */
const CROSS = 0.45;

/** A pane or panel's leak at `fraction` of its travel: steep at the start. */
function leak(fraction: number): number {
  const shut = 1 - Math.min(Math.max(fraction, 0), 1);
  return 1 - shut * shut * shut * shut;
}

/** Written by `cabinOpenness`: 0 (shut) .. 1 (as outside) per ear. */
export interface CabinOpenness {
  left: number;
  right: number;
}

/**
 * Fills `out` for a listener in `seat` of the car whose rig is `rig`. `earAlong` is the
 * dot of the listener's right ear axis with the car's own right: 1 facing forward, -1
 * turned round to look back, 0 looking out of a side window.
 */
export function cabinOpenness(rig: KitRig, seat: PlayerSeat, earAlong: number, out: CabinOpenness): void {
  const row = seatRow(seat);
  // Shut shares per car side, multiplied: what is left of the cabin's seal.
  let shutLeft = 1;
  let shutRight = 1;
  for (const [channel, side, openingRow, share] of OPENINGS) {
    const open = leak(rig.position(channel)) * share * (openingRow === row ? 1 : OTHER_ROW);
    if (open <= 0) continue;
    if (side >= 0) shutLeft *= 1 - open;
    if (side <= 0) shutRight *= 1 - open;
  }
  const carLeft = 1 - shutLeft;
  const carRight = 1 - shutRight;
  // Each ear's own side and a share of the far one.
  const sideLeft = 1 - (1 - carLeft) * (1 - CROSS * carRight);
  const sideRight = 1 - (1 - carRight) * (1 - CROSS * carLeft);
  // The head turned: the right ear swings from the car's right towards its left.
  const toRight = (1 + earAlong) / 2;
  out.right = sideRight * toRight + sideLeft * (1 - toRight);
  out.left = sideLeft * toRight + sideRight * (1 - toRight);
}
