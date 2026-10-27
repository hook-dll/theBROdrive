import type { RaceTrack, TrackProjection } from '../world/racetrack/track';

/**
 * ONE CAR'S LAPS ROUND A `RaceTrack` (world/racetrack/track.ts), from where it is.
 *
 * Each step the car's ABSOLUTE XZ is projected onto the lap (`RaceTrack.project`, hinted
 * with the last answer so a hairpin's other leg is never taken for this one), giving its
 * arclength `s` (0 at the line, wrapping at `lengthM`) and its lateral.
 *
 * A LAP COUNTS ONLY AFTER THE CHECKPOINTS, IN ORDER. The track has six (`checkpoints`,
 * evenly round the lap; the line is not one). Checkpoint `next` is taken when the car is
 * ON THE TRACK AREA — within the asphalt's half width plus the run-off of the centreline —
 * anywhere in the `CHECKPOINT_WINDOW_M` past it. Crossing the line forward with all six
 * taken counts the lap; crossing it without them does not, and the lap is begun again
 * from the first checkpoint. The first forward crossing, from the grid 14 m behind the
 * line, only starts lap 1.
 *
 * THE LINE BACKWARDS UNDOES THE LAST CROSSING FORWARD (a car that rolls back over it
 * after the flag, or spins across it): what that crossing counted is put back, and the
 * next forward crossing decides again. A backward crossing with nothing to undo (rolled
 * back off the grid) leaves the car a line behind, and the next forward crossing only
 * returns it. A line crossing is a step from the last `LINE_WINDOW_M` of the lap into its
 * first ones or back; a projection that jumped (a re-acquired car) crosses nothing.
 *
 * WHERE IT IS FOR THE STANDINGS (`score`): (lap − 1 − behind) · lengthM + s, metres of
 * race run — −14 on the grid, 0 at the first crossing. A lap that did not count drops the
 * car a whole lap in the standings, which is what it is.
 *
 * OFF THE TRACK. Outside the track area the car's `offTrackS` runs (the director forfeits
 * a player past ~10 s); further than `REACQUIRE_LATERAL_M` the hinted projection may be
 * on the wrong leg altogether (a short cut over the infield), so every `REACQUIRE_S` the
 * whole lap is searched instead and the hint moves to the answer. The checkpoints
 * skipped on the way are simply not taken. `lateralDistance` is how far from the
 * centreline the car is, metres, for the director's ~150 m forfeit.
 *
 * No allocation per step: the projection is written into the counter's own storage.
 */

/** A checkpoint is taken anywhere this far past it, on the track area, metres. */
export const CHECKPOINT_WINDOW_M = 40;
/** The line is crossed between the last and first this many metres of the lap. */
const LINE_WINDOW_M = 60;
/** Laterals past this are re-acquired by a full search, metres beyond the run-off. */
const REACQUIRE_LATERAL_M = 25;
/** A full search runs this often while the car is that far out, seconds. */
const REACQUIRE_S = 0.5;

export class LapCounter {
  /** Arclength on the lap, 0 at the line. */
  s = 0;
  lateral = 0;
  /** The lap being driven: 0 on the grid before the line, 1..; `completed` is one less. */
  lap = 0;
  /** Index of the next checkpoint to take; `checkpoints.length` when all are taken. */
  next = 0;
  /** Seconds outside the track area since last on it. */
  offTrackS = 0;
  /** Forward line crossings still owed after backward ones with nothing to undo. */
  private behind = 0;
  /** What the last forward crossing changed, while it may still be undone. */
  private undoLap = -1;
  private undoNext = 0;
  private reacquireIn = 0;
  private readonly at: TrackProjection = { s: 0, lateral: 0, height: 0 };

  constructor(private readonly track: RaceTrack) {}

  /** Laps completed and counted. */
  get completed(): number {
    return Math.max(0, this.lap - 1);
  }

  /** Metres of race run, for the standings; see the header. */
  get score(): number {
    return (this.lap - 1 - this.behind) * this.track.lengthM + this.s;
  }

  /** Within the asphalt's half width plus the run-off. */
  get onTrack(): boolean {
    return Math.abs(this.lateral) <= this.track.halfWidth + this.track.runoffM;
  }

  /** Metres from the centreline, whichever side. */
  get lateralDistance(): number {
    return Math.abs(this.lateral);
  }

  /** Starts at (`x`, `z`) on the grid: lap 0, nothing taken. */
  reset(x: number, z: number): void {
    const at = this.track.project(x, z, undefined, this.at);
    this.s = at.s;
    this.lateral = at.lateral;
    this.lap = 0;
    this.next = 0;
    this.offTrackS = 0;
    this.behind = 0;
    this.undoLap = -1;
    this.undoNext = 0;
    this.reacquireIn = 0;
  }

  /**
   * One step at (`x`, `z`), ABSOLUTE. Returns 1 when this step counted a lap, −1 when it
   * undid one, 0 otherwise.
   */
  update(dt: number, x: number, z: number): -1 | 0 | 1 {
    const track = this.track;
    const length = track.lengthM;
    const previous = this.s;
    const at = track.project(x, z, previous, this.at);
    let jumped = false;
    if (Math.abs(at.lateral) > track.halfWidth + track.runoffM + REACQUIRE_LATERAL_M) {
      this.reacquireIn -= dt;
      if (this.reacquireIn <= 0) {
        this.reacquireIn = REACQUIRE_S;
        const lateral = at.lateral;
        const hinted = at.s;
        track.project(x, z, undefined, at);
        if (Math.abs(at.lateral) >= Math.abs(lateral)) {
          // The hinted leg was the nearest after all.
          track.project(x, z, hinted, at);
        } else {
          jumped = true;
        }
      }
    } else {
      this.reacquireIn = 0;
    }
    const s = at.s;
    this.s = s;
    this.lateral = at.lateral;
    this.offTrackS = this.onTrack ? 0 : this.offTrackS + dt;

    let counted: -1 | 0 | 1 = 0;
    if (!jumped && previous > length - LINE_WINDOW_M && s < LINE_WINDOW_M) counted = this.crossForward();
    else if (!jumped && previous < LINE_WINDOW_M && s > length - LINE_WINDOW_M) counted = this.crossBackward();

    const checkpoints = track.checkpoints;
    if (this.behind === 0 && this.lap > 0 && this.next < checkpoints.length && this.onTrack) {
      const from = checkpoints[this.next]!;
      if (s >= from && s <= from + CHECKPOINT_WINDOW_M) this.next++;
    }
    return counted;
  }

  private crossForward(): 0 | 1 {
    if (this.behind > 0) {
      this.behind--;
      return 0;
    }
    this.undoLap = this.lap;
    this.undoNext = this.next;
    const valid = this.lap === 0 || this.next === this.track.checkpoints.length;
    if (valid) this.lap++;
    this.next = 0;
    return valid && this.lap > 1 ? 1 : 0;
  }

  private crossBackward(): -1 | 0 {
    if (this.undoLap < 0) {
      this.behind++;
      return 0;
    }
    const undid = this.lap > this.undoLap && this.undoLap > 0;
    this.lap = this.undoLap;
    this.next = this.undoNext;
    this.undoLap = -1;
    return undid ? -1 : 0;
  }
}
