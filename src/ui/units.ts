/**
 * Distance and speed as the player reads them.
 *
 * The simulation is metres and km/h everywhere; this is the one place that turns those
 * numbers into words, so the HUD, the pause screen, the save list and the settings cannot
 * disagree about what a kilometre is. Only two units exist, and both are a factor on the
 * same number — see `DISTANCE_UNITS_PER_METRE`.
 */

import {
  DISTANCE_UNITS_PER_METRE,
  SPEED_UNITS_PER_KMH,
  type Units,
} from '../game/settings';
import type { StringKey } from './i18n';

/** A distance, in the chosen unit, with `digits` after the point. */
export function formattedDistance(metres: number, units: Units, digits: number): string {
  return (metres * DISTANCE_UNITS_PER_METRE[units]).toFixed(digits);
}

/** A speed, in the chosen unit, rounded — the road does not care about decimals. */
export function formattedSpeed(kmh: number, units: Units): string {
  return String(Math.round(kmh * SPEED_UNITS_PER_KMH[units]));
}

/** The distance unit's own name, for the label under a number. */
export function distanceUnitKey(units: Units): StringKey {
  return units === 'mi' ? 'hud.unit.mi' : 'hud.unit.km';
}

/** The speed unit's own name. */
export function speedUnitKey(units: Units): StringKey {
  return units === 'mi' ? 'hud.unit.mph' : 'hud.unit.kmh';
}
