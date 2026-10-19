import { DREAMS, type TripSummary } from './dream';

/**
 * Which dreams the player has finished, and how well: kept apart from the drive saves,
 * in browser storage like the preferences (game/settings.ts), because a dream is never
 * saved and its record belongs to the player, not to any one drive.
 *
 * Each dream keeps its best result per measure, each measure on its own: the fastest
 * time, the smoothest ride and the best-kept parcel need not be the same night.
 */

const PROGRESS_KEY = 'brodrive-dreams-v1';

export interface DreamBest {
  readonly seconds: number;
  readonly comfort: number;
  readonly parcel: number;
  readonly times: number;
}

export type DreamProgress = Readonly<Record<string, DreamBest>>;

function isBest(value: unknown): value is DreamBest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['seconds', 'comfort', 'parcel', 'times'].every((key) => typeof v[key] === 'number' && Number.isFinite(v[key]));
}

/** The stored record; anything unreadable counts as nothing done. */
export function loadDreamProgress(): DreamProgress {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, DreamBest> = {};
    for (const [id, best] of Object.entries(raw)) if (isBest(best)) out[id] = best;
    return out;
  } catch {
    return {};
  }
}

/** Folds one arrival into the record and stores it. */
export function recordDream(id: string, trip: TripSummary): void {
  const progress = { ...loadDreamProgress() };
  const old = progress[id];
  progress[id] = old
    ? {
        seconds: Math.min(old.seconds, trip.seconds),
        comfort: Math.max(old.comfort, trip.comfort),
        parcel: Math.max(old.parcel, trip.parcel),
        times: old.times + 1,
      }
    : { seconds: trip.seconds, comfort: trip.comfort, parcel: trip.parcel, times: 1 };
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Private browsing or a full quota: the arrival still showed; only the record is lost.
  }
}

/** A dream is open once the one before it in the campaign is done; the first always is. */
export function dreamOpen(id: string, progress: DreamProgress): boolean {
  const index = DREAMS.findIndex((dream) => dream.id === id);
  return index === 0 || (index > 0 && progress[DREAMS[index - 1]!.id] !== undefined);
}
