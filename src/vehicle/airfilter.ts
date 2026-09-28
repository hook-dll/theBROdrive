/**
 * The air filter: how fast it clogs and what a clogged one costs the engine.
 *
 * Wear is DISTANCE, not time: a filter passes air in proportion to how much the engine
 * breathes, and over a drive that is the kilometres. Clear desert air wears one out in
 * `AIR_FILTER_LIFE_KM`; a dust storm puts more sand through it per kilometre, so the
 * same distance driven inside one costs up to `STORM_WEAR_FACTOR` times as much. The
 * haze of fine suspended dust adds a little.
 *
 * What the player feels is the engine's breath. Nothing at all for the first half of
 * the filter's life, a few per cent by the time it is due, and then a steep fall once
 * it is past due: at `clog` 1 the engine makes 70% of its power and it keeps falling,
 * so an ignored filter ends the drive rather than merely slowing it.
 *
 * Pure functions over plain numbers: the Vehicle owns the accumulation and the state
 * write, the harness can drive these without one.
 */

/** Kilometres of clear-air driving that wear a fresh element out (clog 0 -> 1). */
export const AIR_FILTER_LIFE_KM = 1800;
/** Extra wear per kilometre inside a full dust storm (`weather.dust` = 1). */
const STORM_WEAR_FACTOR = 1.5;
/** Extra wear per kilometre in thick haze (`weather.haze` = 1). */
const HAZE_WEAR_FACTOR = 0.3;
/** Clog at which the engine first notices. */
const FREE_BREATHING_CLOG = 0.5;
/** Clog at which the filter is due: the check-engine lamp lights from here. */
export const AIR_FILTER_DUE_CLOG = 0.85;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Clog added by driving `metres` through air carrying this much dust and haze (0..1). */
export function airFilterWear(metres: number, dust: number, haze: number): number {
  if (!(metres > 0)) return 0;
  const air = 1 + STORM_WEAR_FACTOR * clamp(dust, 0, 1) + HAZE_WEAR_FACTOR * clamp(haze, 0, 1);
  return (metres / 1000 / AIR_FILTER_LIFE_KM) * air;
}

/**
 * Share of full-throttle torque the engine can make through a filter this clogged.
 *
 *   clog 0.00-0.50  1.00   (a filter half through its life is invisible)
 *   clog 0.85       0.95   (due: felt on a climb, not on the flat)
 *   clog 1.00       0.70   (overdue: the car is plainly sick)
 *   clog 1.30       0.35   (a floor; the engine still limps to the next stop)
 */
export function airFilterBreath(clog: number): number {
  const c = Number.isFinite(clog) ? Math.max(0, clog) : 0;
  if (c <= FREE_BREATHING_CLOG) return 1;
  if (c <= AIR_FILTER_DUE_CLOG) {
    return 1 - 0.05 * ((c - FREE_BREATHING_CLOG) / (AIR_FILTER_DUE_CLOG - FREE_BREATHING_CLOG));
  }
  if (c <= 1) return 0.95 - 0.25 * ((c - AIR_FILTER_DUE_CLOG) / (1 - AIR_FILTER_DUE_CLOG));
  return Math.max(0.35, 0.7 - (c - 1) * (0.35 / 0.3));
}
