import type { RaceTrack } from '../world/racetrack/track';
import { LapCounter } from './laps';

/**
 * ONE RACE BETWEEN THE PLAYER AND THE RIVAL, AS RULES: the start lights, the laps, the
 * standings and who won. No world objects: the director (race/director.ts) hands it two
 * ABSOLUTE positions a step, and tools/race-bench.ts runs it on two autopilot cars.
 *
 *  - COUNTDOWN. The lights on the gantry come on red one at a time, `LIGHT_STEP_S` apart
 *    (`lights` 1, 2, 3), then all go green (`lights` 4) and the race is on. Both cars are
 *    held meanwhile (the director's business): nothing is counted.
 *  - LAPS. `RACE_LAPS` laps, each counted by a `LapCounter` (race/laps.ts): only after
 *    the track's checkpoints in order, on the track area. The first forward crossing of
 *    the line, from the grid, starts lap 1. A lap's time is kept when it is counted.
 *  - STANDINGS. Whoever has run further (`LapCounter.score`) is first; level, the player.
 *  - FINISH. The first to complete `RACE_LAPS` wins, there and then; the other's run is
 *    not waited for.
 *  - FORFEIT. The player out of the track area (`LapCounter.onTrack`) for more than
 *    `OFF_TRACK_FORFEIT_S`, or further than `AWAY_FORFEIT_M` from its centreline, loses;
 *    the director forfeits him for the rest (out of the car, flipped, the car gone), and
 *    the dev tools decide a race outright (`decide`).
 *
 * Nothing is allocated per step.
 */

export const RACE_LAPS = 3;
/** Seconds between one red light and the next; the green comes one step after the third red. */
export const LIGHT_STEP_S = 1;
/** The lights before the green: red, red, red. */
export const RED_LIGHTS = 3;
/** Seconds the player may be off the track area in one go before the race is his to lose. */
export const OFF_TRACK_FORFEIT_S = 10;
/** Metres from the centreline past which the player has left the race. */
export const AWAY_FORFEIT_M = 150;

export type RacePhase = 'countdown' | 'racing' | 'finished';
export type Racer = 'player' | 'rival';
/** How a race was decided. */
export type RaceEnd = 'laps' | 'off-track' | 'away' | 'left-car' | 'flipped' | 'wrecked' | 'dev';

export class RaceSession {
  phase: RacePhase = 'countdown';
  /** Seconds since the first red light. */
  clock = 0;
  /** Seconds since the green; frozen at the finish. */
  raceTime = 0;
  readonly player: LapCounter;
  readonly rival: LapCounter;
  winner: Racer | null = null;
  end: RaceEnd | null = null;
  /** Each racer's lap times, seconds, as counted; NaN for a lap not run. */
  readonly playerLaps = new Float64Array(RACE_LAPS).fill(Number.NaN);
  readonly rivalLaps = new Float64Array(RACE_LAPS).fill(Number.NaN);
  private playerLapStart = 0;
  private rivalLapStart = 0;

  constructor(readonly track: RaceTrack) {
    this.player = new LapCounter(track);
    this.rival = new LapCounter(track);
  }

  /** Puts both on the grid where they stand and starts the lights. */
  start(playerX: number, playerZ: number, rivalX: number, rivalZ: number): void {
    this.phase = 'countdown';
    this.clock = 0;
    this.raceTime = 0;
    this.winner = null;
    this.end = null;
    this.playerLaps.fill(Number.NaN);
    this.rivalLaps.fill(Number.NaN);
    this.player.reset(playerX, playerZ);
    this.rival.reset(rivalX, rivalZ);
  }

  /** Lights shown: 0 none, 1-3 that many red, 4 green. */
  get lights(): number {
    if (this.phase !== 'countdown') return this.phase === 'racing' ? RED_LIGHTS + 1 : 0;
    return Math.min(RED_LIGHTS, 1 + Math.floor(this.clock / LIGHT_STEP_S));
  }

  /** Both cars are held: the lights have not gone green. */
  get held(): boolean {
    return this.phase === 'countdown';
  }

  /** 1 when the player leads, 2 when the rival does. */
  get playerPosition(): 1 | 2 {
    return this.rival.score > this.player.score ? 2 : 1;
  }

  /** The lap the player is on, 1..RACE_LAPS, for the HUD. */
  get playerLap(): number {
    return Math.min(RACE_LAPS, Math.max(1, this.player.lap));
  }

  /**
   * One step. During the countdown only the clock runs; racing, both counters move and
   * the race may be decided (`winner`, `end`). Returns true on the step it was decided.
   */
  step(dt: number, playerX: number, playerZ: number, rivalX: number, rivalZ: number): boolean {
    if (this.phase === 'finished') return false;
    this.clock += dt;
    if (this.phase === 'countdown') {
      if (this.clock >= RED_LIGHTS * LIGHT_STEP_S) {
        this.phase = 'racing';
        this.playerLapStart = 0;
        this.rivalLapStart = 0;
      }
      return false;
    }
    this.raceTime += dt;
    if (this.player.update(dt, playerX, playerZ) === 1) {
      // Lap 1's time runs from the green, the grid's 14 m to the line included.
      this.playerLaps[this.player.completed - 1] = this.raceTime - this.playerLapStart;
      this.playerLapStart = this.raceTime;
    }
    if (this.rival.update(dt, rivalX, rivalZ) === 1) {
      this.rivalLaps[this.rival.completed - 1] = this.raceTime - this.rivalLapStart;
      this.rivalLapStart = this.raceTime;
    }
    if (this.player.completed >= RACE_LAPS) return this.decide('player', 'laps');
    if (this.rival.completed >= RACE_LAPS) return this.decide('rival', 'laps');
    if (this.player.offTrackS > OFF_TRACK_FORFEIT_S) return this.decide('rival', 'off-track');
    if (this.player.lateralDistance > AWAY_FORFEIT_M) return this.decide('rival', 'away');
    return false;
  }

  /** Decides the race for `winner`, unless it already is. Returns true when this call decided it. */
  decide(winner: Racer, end: RaceEnd): boolean {
    if (this.phase === 'finished') return false;
    this.phase = 'finished';
    this.winner = winner;
    this.end = end;
    return true;
  }
}
