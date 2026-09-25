const DAY_MILLISECONDS = 86_400_000;

/**
 * Fixed observer: the middle belt, near Vladimir. World +X is east and +Z is north.
 *
 * It was Laayoune (27° N) for the desert. At 56° the sun stands 34° lower at a summer
 * noon and barely 30° in autumn: the long shadows and the warm slanting light of the
 * painted woods (docs/shishkin.md) come from the latitude, not from a grade.
 */
export const OBSERVER_LATITUDE_DEG = 56.13;
export const OBSERVER_LONGITUDE_DEG = 40.4;
export const OBSERVER_ELEVATION_M = 150;

const SOLAR_OFFSET_MILLISECONDS =
  (OBSERVER_LONGITUDE_DEG / 360) * DAY_MILLISECONDS;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date at the observer's local mean-solar longitude for a real instant. */
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
