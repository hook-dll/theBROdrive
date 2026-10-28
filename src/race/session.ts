import type { RaceTrack } from '../world/racetrack/track';
import { LapCounter } from './laps';

/**
 * ONE RACE BETWEEN THE PLAYER AND A FIELD OF RIVALS, AS RULES: the start lights, the
 * laps, the standings, the finishing order and the times. No world objects: the director
 * (race/director.ts) hands it every racer's ABSOLUTE position a step, and
 * tools/race-bench.ts runs it on autopilot cars. Racer 0 is the player; 1.. the rivals.
 *
 *  - COUNTDOWN. The lights on the gantry come on red one at a time, `LIGHT_STEP_S` apart
 *    (`lights` 1, 2, 3), then all go green (`lights` 4) and the race is on. Every car is
 *    held meanwhile (the director's business): nothing is counted.
 *  - LAPS. `RACE_LAPS` laps, each counted by a `LapCounter` (race/laps.ts): only after
 *    the track's checkpoints in order, on the track area. The first forward crossing of
 *    the line, from the grid, starts lap 1. A lap's time is kept when it is counted.
 *  - STANDINGS. Finished racers by their finishing time; the rest by how far they have
 *    run (`LapCounter.score`); level, the lower index (the player first).
 *  - FINISH. A racer who completes `RACE_LAPS` is finished there and then, its time the
 *    race clock. The race is OVER when the player is finished (or out) and either every
 *    rival is finished or `FINISH_WAIT_S` has passed since; whoever is still running
 *    then is classified by distance, without a time.
 *  - OUT. The player out of the track area (`LapCounter.onTrack`) for more than
 *    `OFF_TRACK_FORFEIT_S`, or further than `AWAY_FORFEIT_M` from its centreline, is out
 *    of the race (`out`), and so is he for the director's own reasons (out of the car, the
 *    car gone or dead): last, no time. The rivals keep running to the end as above.
 *
 * Nothing is allocated per step.
 */

export const RACE_LAPS = 3;
/** Seconds between one red light and the next; the green comes one step after the third red. */
export const LIGHT_STEP_S = 1;
/** The lights before the green: red, red, red. */
export const RED_LIGHTS = 3;
/**
 * Seconds the player may be off the track area in one go before he is out. Long, since
 * the return key (race/director.ts) puts him back whenever he likes.
 */
export const OFF_TRACK_FORFEIT_S = 20;
/** Metres from the centreline past which the player has left the race. */
export const AWAY_FORFEIT_M = 150;
/** Seconds the race waits for the rivals still running once the player is done. */
export const FINISH_WAIT_S = 45;

export type RacePhase = 'countdown' | 'racing' | 'finished';
/** How the player's race ended. */
export type RaceEnd = 'laps' | 'off-track' | 'away' | 'left-car' | 'flipped' | 'wrecked' | 'dev';

export class RaceSession {
  phase: RacePhase = 'countdown';
  /** Seconds since the first red light. */
  clock = 0;
  /** Seconds since the green; frozen when the race is over. */
  raceTime = 0;
  readonly counters: readonly LapCounter[];
  /** How the player's race ended, or null while he is still racing. */
  end: RaceEnd | null = null;
  /** Per racer: its race time at the flag, NaN while running or when it never finished. */
  readonly finishTimes: Float64Array;
  /** Per racer, `RACE_LAPS` lap times in a row, seconds, NaN for a lap not run. */
  readonly lapTimes: Float64Array;
  /** Racer indices in finishing order (as they cross; `order` is the full classification). */
  private readonly finishers: number[] = [];
  private readonly lapStarts: Float64Array;
  /** Race time the player was done at, for `FINISH_WAIT_S`. */
  private playerDoneAt = Number.NaN;
  /** The classification, best first, rewritten by `standings`. */
  private readonly orderStore: number[];

  constructor(readonly track: RaceTrack, readonly racers: number) {
    this.counters = Array.from({ length: racers }, () => new LapCounter(track));
    this.finishTimes = new Float64Array(racers).fill(Number.NaN);
    this.lapTimes = new Float64Array(racers * RACE_LAPS).fill(Number.NaN);
    this.lapStarts = new Float64Array(racers);
    this.orderStore = Array.from({ length: racers }, (_, i) => i);
  }

  /** Puts every racer on the grid where it stands (`xs`, `zs` per racer) and starts the lights. */
  start(xs: ArrayLike<number>, zs: ArrayLike<number>): void {
    this.phase = 'countdown';
    this.clock = 0;
    this.raceTime = 0;
    this.end = null;
    this.playerDoneAt = Number.NaN;
    this.finishers.length = 0;
    this.finishTimes.fill(Number.NaN);
    this.lapTimes.fill(Number.NaN);
    this.lapStarts.fill(0);
    for (let i = 0; i < this.racers; i++) this.counters[i]!.reset(xs[i]!, zs[i]!);
  }

  /** Lights shown: 0 none, 1-3 that many red, 4 green. */
  get lights(): number {
    if (this.phase !== 'countdown') return this.phase === 'racing' ? RED_LIGHTS + 1 : 0;
    return Math.min(RED_LIGHTS, 1 + Math.floor(this.clock / LIGHT_STEP_S));
  }

  /** Every car is held: the lights have not gone green. */
  get held(): boolean {
    return this.phase === 'countdown';
  }

  /** Racer `i` has taken the flag. */
  finished(i: number): boolean {
    return Number.isFinite(this.finishTimes[i]!);
  }

  /** The player is done: finished, or out. */
  get playerDone(): boolean {
    return this.end !== null;
  }

  /** The lap the player is on, 1..RACE_LAPS, for the HUD. */
  get playerLap(): number {
    return Math.min(RACE_LAPS, Math.max(1, this.counters[0]!.lap));
  }

  /** Racer `i`'s time for lap `lap` (0-based), seconds, or NaN. */
  lapTime(i: number, lap: number): number {
    return this.lapTimes[i * RACE_LAPS + lap]!;
  }

  /** Racer `i`'s best lap, seconds, or NaN. */
  bestLap(i: number): number {
    let best = Number.NaN;
    for (let lap = 0; lap < RACE_LAPS; lap++) {
      const t = this.lapTimes[i * RACE_LAPS + lap]!;
      if (Number.isFinite(t) && !(t >= best)) best = t;
    }
    return best;
  }

  /**
   * The classification, best first: finishers in order, then the rest by distance run,
   * an out player last. The array is the session's own, rewritten by every call.
   */
  standings(): readonly number[] {
    const order = this.orderStore;
    for (let i = 0; i < this.racers; i++) order[i] = i;
    order.sort(this.byRank);
    return order;
  }

  /** 1-based place of racer `i`. */
  position(i: number): number {
    return this.standings().indexOf(i) + 1;
  }

  /** The standings' comparator, made once: the sort allocates nothing per step. */
  private readonly byRank = (a: number, b: number): number => this.rank(a) - this.rank(b) || a - b;

  /** Sort key: finishers by time, then the running by distance, an out player behind all. */
  private rank(i: number): number {
    const at = this.finishers.indexOf(i);
    if (at >= 0) return -1e12 + at;
    if (i === 0 && this.end !== null && this.end !== 'laps') return 1e12;
    return -this.counters[i]!.score;
  }

  /**
   * One step at every racer's position. During the countdown only the clock runs;
   * racing, the counters move and racers take the flag. Returns true on the step the
   * race became over (`phase` 'finished').
   */
  step(dt: number, xs: ArrayLike<number>, zs: ArrayLike<number>): boolean {
    if (this.phase === 'finished') return false;
    this.clock += dt;
    if (this.phase === 'countdown') {
      if (this.clock >= RED_LIGHTS * LIGHT_STEP_S) {
        this.phase = 'racing';
        this.lapStarts.fill(0);
      }
      return false;
    }
    this.raceTime += dt;
    for (let i = 0; i < this.racers; i++) {
      if (this.finished(i) || (i === 0 && this.end !== null)) continue;
      const counter = this.counters[i]!;
      if (counter.update(dt, xs[i]!, zs[i]!) === 1) {
        // Lap 1's time runs from the green, the grid's run to the line included.
        this.lapTimes[i * RACE_LAPS + counter.completed - 1] = this.raceTime - this.lapStarts[i]!;
        this.lapStarts[i] = this.raceTime;
        if (counter.completed >= RACE_LAPS) {
          this.finishTimes[i] = this.raceTime;
          this.finishers.push(i);
          if (i === 0) this.playerOut('laps');
        }
      }
    }
    if (this.end === null) {
      const player = this.counters[0]!;
      if (player.offTrackS > OFF_TRACK_FORFEIT_S) this.playerOut('off-track');
      else if (player.lateralDistance > AWAY_FORFEIT_M) this.playerOut('away');
    }
    if (this.end === null) return false;
    let running = 0;
    for (let i = 1; i < this.racers; i++) if (!this.finished(i)) running++;
    if (running > 0 && this.raceTime - this.playerDoneAt < FINISH_WAIT_S) return false;
    this.phase = 'finished';
    return true;
  }

  /** The player is done (finished, or out for `end`), unless he already is. Returns true when this call did it. */
  playerOut(end: RaceEnd): boolean {
    if (this.end !== null || this.phase === 'finished') return false;
    this.end = end;
    this.playerDoneAt = this.raceTime;
    return true;
  }

  /** Ends the race now, everyone classified as they stand (the dev tools, a call-off). */
  close(end: RaceEnd): void {
    this.playerOut(end);
    this.phase = 'finished';
  }

  /**
   * The dev tools' verdict: the race over now, the player first (`playerFirst`) or last of
   * the finishers, the rest classified as they stand.
   */
  devDecide(playerFirst: boolean): void {
    if (this.phase === 'finished') return;
    this.finishers.length = 0;
    if (playerFirst) this.finishers.push(0);
    for (let i = 1; i < this.racers; i++) this.finishers.push(i);
    if (!playerFirst) this.finishers.push(0);
    for (const i of this.finishers) this.finishTimes[i] = this.raceTime;
    this.close('dev');
  }

  /** Racer `i` was put back on the lap at (`x`, `z`), arclength `s`: counted on from there. */
  relocate(i: number, x: number, z: number, s: number): void {
    this.counters[i]!.relocate(x, z, s);
  }
}
