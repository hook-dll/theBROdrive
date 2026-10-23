import { FIXED_DT } from './physics';

/**
 * Fixed-timestep game loop with an explicit tick counter.
 *
 * Simulation advances in whole `FIXED_DT` steps; rendering happens once per frame
 * with an interpolation alpha. This is not merely tidy — a variable-dt vehicle
 * simulation changes its handling with frame rate, and prediction/reconciliation for
 * multiplayer is impossible without a canonical tick number.
 */

/**
 * Never simulate more than this many steps in one frame.
 *
 * Exported because it sets a FLOOR on any presentation cap: presenting at `f` frames a
 * second needs `simulationHz / f` whole steps per frame, and more than this many cannot be
 * caught up in one frame, so the simulation would fall behind the clock rather than run
 * slow. See the frame-rate bench, which holds the offered rates to it.
 */
export const MAX_STEPS_PER_FRAME = 5;

export interface LoopCallbacks {
  /** Advance simulation by exactly `FIXED_DT`. `tick` is monotonic from 0. */
  fixedUpdate(dt: number, tick: number): void;
  /**
   * Draw a frame. `alpha` is 0..1 between the previous and current sim state, for
   * interpolating render transforms. `frameDt` is real elapsed time, for UI only.
   */
  render(alpha: number, frameDt: number): void;
}

/**
 * How a presentation cap is being met, for the frame report.
 *
 *  - `uncapped`: no cap; every callback presents.
 *  - `display`: the cap is at or above the callback rate, so it cannot bind and every
 *    callback presents. The panel is the ceiling, not the cap.
 *  - `divisor`: the cap is a whole fraction of the callback rate (60 on 120 Hz, 72 on
 *    144 Hz, 30 on 60 Hz), so every `divisor`-th callback presents, locked to it.
 *  - `deadline`: any other ratio (60 on 144 Hz, 120 on 144 Hz). The cap's own deadlines,
 *    each presented at the callback nearest it, so the average is the cap and the
 *    cadence is as even as the two rates allow (2,3,2,3 callbacks for 60 on 144 Hz).
 *  - `unmeasured`: capped before the callback rate is known (the first callbacks after a
 *    start): the cap's deadlines with a fixed half-millisecond slack.
 */
export type PresentationMode = 'uncapped' | 'display' | 'divisor' | 'deadline' | 'unmeasured';

/** What the loop presents at and why; see `GameLoop.presentation`. */
export interface PresentationState {
  /** The cap asked for, frames a second, or null. */
  readonly capFps: number | null;
  /** The measured animation-callback rate, Hz: the display's refresh while it keeps up. */
  readonly callbackHz: number | null;
  readonly mode: PresentationMode;
  /** Callbacks per presented frame in `divisor` mode; 1 otherwise. */
  readonly divisor: number;
  /**
   * The rate the schedule presents at if every frame it asks for is drawn in time,
   * Hz: never above `callbackHz`, so a 144 cap on a 60 Hz panel reads 60, not 144.
   * A slower machine presents less; the frame profiler measures what it achieved.
   */
  readonly scheduledHz: number | null;
}

/**
 * How close a cap must be to a whole fraction of the callback rate to be locked to it,
 * as a fraction of the cap's interval. Wide enough for a 59.94 or 143.86 Hz panel under a
 * 60 or 144 cap (0.1%) and the estimate's noise; narrow enough that a locked rate is
 * never more than 2% above the cap asked for.
 */
const DIVISOR_LOCK_TOLERANCE = 0.02;

/** Weight of each in-band callback interval in the running estimate. */
const CALLBACK_PERIOD_WEIGHT = 0.1;
/** An interval this far from the estimate either way is a hitch or a rate change, not a sample. */
const CALLBACK_PERIOD_BAND = 0.3;
/**
 * Consecutive out-of-band intervals that mean the rate itself changed — a window moved
 * to another panel, a browser throttling a background tab, or a machine that now
 * consistently misses every other refresh — rather than a run of hitches: half a second
 * at 60 Hz. The estimate restarts from the newest interval.
 */
const CALLBACK_PERIOD_REACQUIRE = 30;
/** Intervals longer than this are a hidden tab or a stall, never a refresh. */
const CALLBACK_PERIOD_MAX_MS = 250;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private lastRenderTime = 0;
  private nextRenderTime = 0;
  private minimumRenderIntervalMs = 0;
  private capFps: number | null = null;
  /** Running estimate of the animation-callback interval, ms; 0 until measured. */
  private callbackPeriodMs = 0;
  private outOfBandIntervals = 0;
  /** The first callback after `start` measures part of an interval, never a whole one. */
  private measurePeriod = false;
  private mode: PresentationMode = 'uncapped';
  private divisor = 1;
  private rafHandle = 0;
  private running = false;
  private tickCount = 0;

  constructor(private readonly callbacks: LoopCallbacks) {}

  get tick(): number {
    return this.tickCount;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.lastRenderTime = this.lastTime;
    this.nextRenderTime = this.lastTime;
    this.measurePeriod = false;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  /**
   * Caps presentation without changing the fixed 60 Hz simulation. A ceiling only: a
   * machine that cannot draw at the cap presents what it can, and a cap above the
   * display's refresh presents at the refresh.
   */
  setRenderFps(fps: number | null): void {
    this.capFps = fps === null ? null : Math.max(1, fps);
    this.minimumRenderIntervalMs = this.capFps === null ? 0 : 1000 / this.capFps;
    const now = performance.now();
    this.lastRenderTime = now;
    this.nextRenderTime = now;
  }

  /** The cap, the measured callback rate and how one is being met against the other. */
  get presentation(): PresentationState {
    const callbackHz = this.callbackPeriodMs > 0 ? 1000 / this.callbackPeriodMs : null;
    let scheduledHz: number | null;
    if (this.mode === 'uncapped' || this.mode === 'display') scheduledHz = callbackHz;
    else if (this.mode === 'divisor') scheduledHz = callbackHz === null ? null : callbackHz / this.divisor;
    else scheduledHz = callbackHz === null ? this.capFps : Math.min(callbackHz, this.capFps ?? callbackHz);
    return { capFps: this.capFps, callbackHz, mode: this.mode, divisor: this.divisor, scheduledHz };
  }

  /** Folds one callback interval into `callbackPeriodMs`. */
  private measureCallback(intervalMs: number): void {
    if (!this.measurePeriod) {
      this.measurePeriod = true;
      return;
    }
    if (!(intervalMs > 0) || intervalMs > CALLBACK_PERIOD_MAX_MS) return;
    const period = this.callbackPeriodMs;
    if (period === 0 || Math.abs(intervalMs - period) <= period * CALLBACK_PERIOD_BAND) {
      this.callbackPeriodMs = period === 0 ? intervalMs : period + (intervalMs - period) * CALLBACK_PERIOD_WEIGHT;
      this.outOfBandIntervals = 0;
      return;
    }
    this.outOfBandIntervals += 1;
    if (this.outOfBandIntervals >= CALLBACK_PERIOD_REACQUIRE) {
      this.callbackPeriodMs = intervalMs;
      this.outOfBandIntervals = 0;
    }
  }

  /**
   * Whether this callback presents under the cap, advancing the cap's schedule if so.
   *
   * PHASE-STABLE, NOT MERELY AVERAGE-CORRECT. Deadlines alone (each the last plus the
   * interval, presented once `now` reaches it) give the right average but no lock: a
   * 144 cap on a panel that is 144.1 Hz runs its deadlines behind the callbacks by
   * 4 µs a frame, so one callback in every few hundred lands just short of its deadline
   * and is skipped — a doubled frame every few seconds at the panel's own rate. 60 on
   * 119.88 Hz drifts the other way and, once per drift cycle, presents two callbacks in
   * a row. Both are what the cap exists to remove, so a cap the display meets whole is
   * met by counting callbacks instead (`display`, `divisor`), which cannot drift, and
   * only a ratio no whole count fits keeps the deadlines (`deadline`), presented at the
   * callback nearest each so the slack is half a callback either way, not a fixed 0.5 ms.
   *
   * No mode presents a burst: one present per callback at most, a late callback skips
   * the deadlines it missed instead of owing them, and the simulation is not touched.
   */
  private presentsNow(now: number): boolean {
    const interval = this.minimumRenderIntervalMs;
    if (interval === 0) {
      this.mode = 'uncapped';
      this.divisor = 1;
      return true;
    }
    const period = this.callbackPeriodMs;
    if (period > 0) {
      const ratio = interval / period;
      if (ratio <= 1 + DIVISOR_LOCK_TOLERANCE) {
        this.mode = 'display';
        this.divisor = 1;
        this.nextRenderTime = now + interval;
        return true;
      }
      const divisor = Math.round(ratio);
      if (Math.abs(interval - divisor * period) <= interval * DIVISOR_LOCK_TOLERANCE) {
        this.mode = 'divisor';
        this.divisor = divisor;
        // Half a callback short of the count, so a timestamp's jitter never loses one.
        if (now - this.lastRenderTime < (divisor - 0.5) * period) return false;
        this.nextRenderTime = now + interval;
        return true;
      }
    }
    this.mode = period > 0 ? 'deadline' : 'unmeasured';
    this.divisor = 1;
    const slack = period > 0 ? period / 2 : 0.5;
    if (now + slack < this.nextRenderTime) return false;
    do {
      this.nextRenderTime += interval;
    } while (this.nextRenderTime <= now);
    return true;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.frame);

    const frameDt = (now - this.lastTime) / 1000;
    this.measureCallback(now - this.lastTime);
    this.lastTime = now;
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.fixedUpdate(FIXED_DT, this.tickCount++);
      this.accumulator -= FIXED_DT;
      steps++;
    }

    // A frame that used its whole step budget and still owes time cannot pay the
    // debt off later: the machine is not keeping up, and carrying the remainder
    // only defers it. Carrying it was visible, not merely untidy — leftover above
    // one step pins the render alpha at 1 (see below), so the car is drawn at the
    // newest step for as long as the debt lasts, and then snaps back to
    // mid-interval the frame the loop catches up. At 100 km/h one step is 0.46 m,
    // so that snap is a third of a metre of backwards motion: the forward-backward
    // twitch reported on slow hardware. Dropping the debt here means a stall costs
    // simulated time (the world briefly runs slow) but never rendered continuity.
    //
    // The old threshold only discarded a backlog once it exceeded the whole budget,
    // which is the worst of both: every stall short of that still lurched.
    if (steps === MAX_STEPS_PER_FRAME && this.accumulator > FIXED_DT) {
      this.accumulator = 0;
    }

    // A cap presents on some callbacks but simulates on every one; see `presentsNow`.
    if (!this.presentsNow(now)) return;
    const renderElapsedMs = now - this.lastRenderTime;
    this.lastRenderTime = now;
    this.callbacks.render(this.accumulator / FIXED_DT, renderElapsedMs / 1000);
  };
}
