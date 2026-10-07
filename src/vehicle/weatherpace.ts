/**
 * WHEN WEATHER STOPS A DRIVER. Every driver the game runs reads this one place — the
 * live autopilot and the race's ghost rivals — so nobody is the only one braving it.
 *
 * Only a full haboob does it, and it does it to everybody alike, frantic included:
 * inside the dust there is a hundred metres of sight and a gust front that, measured
 * on the 2106 at 100 km/h (tools/aero.ts cross), drifts a car 4.7 m in two seconds
 * hands off. The driver SHELTERS: pulls to the edge of the asphalt on its own side,
 * stops, pulls the handbrake, runs the hazards and waits for the dust to thin, which
 * is what drivers are told to do in one.
 *
 * Nothing short of that changes a driver's pace. A road where every car brakes by its
 * own reading of the wind is a road of sudden, uneven slowdowns, and those are what
 * cause pile-ups; all-or-nothing is one event every driver meets together.
 *
 * The dust is the frame's (world/weather.ts, sampled at the player): within the few
 * kilometres any of these drivers lives in, a haboob is one weather.
 */

import { weather } from '../world/weather';

/** Dust at which every driver pulls over: the haboob's wall is on them. */
const SHELTER_DUST = 0.8;
/** Dust below which they drive on again; lower, so a thinning wall does not start and stop the road. */
const SHELTER_RELEASE_DUST = 0.6;

/** Whether a driver should be stopped and waiting out the dust, given its current answer. */
export function shouldShelter(sheltering: boolean): boolean {
  return weather.dust >= (sheltering ? SHELTER_RELEASE_DUST : SHELTER_DUST);
}
