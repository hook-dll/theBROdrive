import type { RaceTrack, TrackPose } from '../world/racetrack/track';
import { CHECKPOINT_WINDOW_M, type LapCounter } from './laps';

/**
 * A RIVAL KNOCKED OFF OR STUCK IS PUT BACK ON THE LAP: the rule, shared by the director
 * (race/director.ts), which does it in the world, and tools/race-bench.ts, which races
 * whole fields headless with it.
 *
 * `RecoveryWatch` says when: off the track area `RECOVER_OFF_S` in one go, on its roof
 * `RECOVER_FLIPPED_S`, or `RECOVER_STUCK_S` without `RECOVER_STUCK_M` of progress in
 * the race (`LapCounter.score`, so a car going round backwards or circling in the sand
 * is stuck too). `recoverAt` says where: on the centreline a few metres short of where
 * its counter has it, never past the window of the checkpoint it has yet to take (the lap
 * would not count), and its own grid box before it has crossed the line at all.
 */

export const RECOVER_OFF_S = 2.5;
export const RECOVER_FLIPPED_S = 1.5;
export const RECOVER_STUCK_S = 6;
const RECOVER_STUCK_M = 4;
/** The up vector's y under this is on its roof (or its side). */
export const FLIPPED_UP = 0.3;

export class RecoveryWatch {
  private offS = 0;
  private flippedS = 0;
  private stuckS = 0;
  private bestScore = -Infinity;

  reset(): void {
    this.offS = 0;
    this.flippedS = 0;
    this.stuckS = 0;
    this.bestScore = -Infinity;
  }

  /** One step of a racing car: its counter (already updated this step) and its up vector's y. True while a recovery is due. */
  step(dt: number, counter: LapCounter, upY: number): boolean {
    this.offS = counter.onTrack ? 0 : this.offS + dt;
    this.flippedS = upY < FLIPPED_UP ? this.flippedS + dt : 0;
    if (counter.score > this.bestScore + RECOVER_STUCK_M) {
      this.bestScore = counter.score;
      this.stuckS = 0;
    } else {
      this.stuckS += dt;
    }
    return this.offS > RECOVER_OFF_S || this.flippedS > RECOVER_FLIPPED_S || this.stuckS > RECOVER_STUCK_S;
  }
}

/** Where a car is put back: arclength and lateral (see the header). `slot` is its grid box. */
export function recoverAt(track: RaceTrack, counter: LapCounter, slot: TrackPose, out: { s: number; lateral: number }): { s: number; lateral: number } {
  if (counter.lap === 0) {
    out.s = slot.s;
    out.lateral = slot.lateral;
    return out;
  }
  const checkpoints = track.checkpoints;
  const from = counter.next > 0 ? checkpoints[counter.next - 1]! : 0;
  const to = counter.next < checkpoints.length ? checkpoints[counter.next]! + CHECKPOINT_WINDOW_M - 5 : track.lengthM;
  const ahead = track.wrap(counter.s - 5 - from);
  out.s = from + (ahead < track.wrap(to - from) ? ahead : 2);
  out.lateral = 0;
  return out;
}
