const DAY_MILLISECONDS = 86_400_000;

/** Fixed observer: Laayoune, Western Sahara. World +X is east and +Z is north. */
export const OBSERVER_LATITUDE_DEG = 27.15;
export const OBSERVER_LONGITUDE_DEG = -13.2;
export const OBSERVER_ELEVATION_M = 70;

const SOLAR_OFFSET_MILLISECONDS =
  (OBSERVER_LONGITUDE_DEG / 360) * DAY_MILLISECONDS;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date at Laayoune's local mean-solar longitude for a real instant. */
export function localSolarDateAt(realMilliseconds = Date.now()): string {
  return new Date(realMilliseconds + SOLAR_OFFSET_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

/** Strictly parse the persisted YYYY-MM-DD epoch. */
export function parseCalendarEpoch(epoch: string): number {
  const match = ISO_DATE.exec(epoch);
  if (!match) throw new Error('calendarEpoch must be an ISO date (YYYY-MM-DD)');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(milliseconds).toISOString().slice(0, 10);
  if (roundTrip !== epoch) throw new Error('calendarEpoch is not a real calendar date');
  return milliseconds;
}

/**
 * Convert the accelerated game clock (local mean solar time) into the UTC instant
 * consumed by the ephemeris. Longitude is negative west, hence UTC is later here.
 */
export function astronomicalDate(
  epoch: string,
  dayIndex: number,
  timeOfDay: number,
  dayLength: number,
): Date {
  const localMidnight = parseCalendarEpoch(epoch) + dayIndex * DAY_MILLISECONDS;
  const localClock = (timeOfDay / dayLength) * DAY_MILLISECONDS;
  return new Date(localMidnight + localClock - SOLAR_OFFSET_MILLISECONDS);
}
