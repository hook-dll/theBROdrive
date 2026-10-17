/**
 * A toilet's progress, and its save projection (docs/toilet-poi-design.md, "Save
 * contract"): only the variant, the scenario, the state and completion metadata are
 * kept, never geometry. Geometry is rebuilt from the catalogue and the progress applied
 * to it (rig.ts `ToiletRig.pose`), so a completed toilet comes back healthy.
 *
 * NOT YET IN THE GAME SAVE. The world places no toilets, so nothing writes these records
 * into `WorldState` (save/save.ts); the gallery round-trips them through
 * `encodeToiletProgress` / `decodeToiletProgress` to prove the projection. Wiring them
 * into the save needs the placed POI's stable id and a save migration.
 */

import { toiletVariant } from './catalog';
import { TOILET_STATES, type ToiletScenarioId, type ToiletState, type ToiletVariant } from './types';

export interface ToiletCompletion {
  /** Times the toilet has been brought to healthy. */
  readonly count: number;
  /** The world day of the last completion, or null where there is no game clock (the gallery). */
  readonly lastDay: number | null;
}

export interface ToiletProgress {
  readonly variantId: string;
  readonly scenarioId: ToiletScenarioId;
  readonly state: ToiletState;
  readonly completion: ToiletCompletion | null;
}

/** The saved form: the progress with a version tag. */
export interface ToiletSaveRecord extends ToiletProgress {
  readonly v: 1;
}

/** A toilet as the player first finds it. */
export function newToiletProgress(variant: ToiletVariant): ToiletProgress {
  return { variantId: variant.id, scenarioId: variant.scenario, state: 'arrived', completion: null };
}

/** Moves to `state`; completion is kept, so a re-broken toilet still remembers. */
export function withToiletState(progress: ToiletProgress, state: ToiletState): ToiletProgress {
  return { ...progress, state };
}

/** Healthy, and counted. */
export function completeToilet(progress: ToiletProgress, day: number | null): ToiletProgress {
  return {
    ...progress,
    state: 'healthy',
    completion: { count: (progress.completion?.count ?? 0) + 1, lastDay: day },
  };
}

export function encodeToiletProgress(progress: ToiletProgress): ToiletSaveRecord {
  return {
    v: 1,
    variantId: progress.variantId,
    scenarioId: progress.scenarioId,
    state: progress.state,
    completion: progress.completion ? { count: progress.completion.count, lastDay: progress.completion.lastDay } : null,
  };
}

/**
 * Reads a saved record back. Throws on anything malformed or on a variant the catalogue
 * no longer has, rather than inventing progress.
 */
export function decodeToiletProgress(raw: unknown): ToiletProgress {
  if (typeof raw !== 'object' || raw === null) throw new Error('Toilet record is not an object');
  const record = raw as Record<string, unknown>;
  if (record.v !== 1) throw new Error(`Toilet record has unknown version ${String(record.v)}`);
  if (typeof record.variantId !== 'string') throw new Error('Toilet record has no variant');
  const variant = toiletVariant(record.variantId);
  if (record.scenarioId !== variant.scenario) {
    throw new Error(`Toilet record for ${variant.id} names scenario ${String(record.scenarioId)}, not ${variant.scenario}`);
  }
  const state = TOILET_STATES.find((candidate) => candidate === record.state);
  if (!state) throw new Error(`Toilet record for ${variant.id} has unknown state ${String(record.state)}`);
  let completion: ToiletCompletion | null = null;
  if (record.completion !== null) {
    const saved = record.completion as Record<string, unknown> | undefined;
    const count = saved?.count;
    const lastDay = saved?.lastDay;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || (lastDay !== null && typeof lastDay !== 'number')) {
      throw new Error(`Toilet record for ${variant.id} has malformed completion`);
    }
    completion = { count, lastDay };
  }
  return { variantId: variant.id, scenarioId: variant.scenario, state, completion };
}
