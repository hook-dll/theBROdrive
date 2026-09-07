import { FIXED_DT } from './physics';

/**
 * Fixed-timestep game loop with an explicit tick counter.
 *
 * Simulation advances in whole `FIXED_DT` steps; rendering happens once per frame
 * with an interpolation alpha. This is not merely tidy — a variable-dt vehicle
 * simulation changes its handling with frame rate, and prediction/reconciliation for
 * multiplayer is impossible without a canonical tick number.
 */

/** Never simulate more than this many steps in one frame. */
const MAX_STEPS_PER_FRAME = 5;

export interface LoopCallbacks {
  /** Advance simulation by exactly `FIXED_DT`. `tick` is monotonic from 0. */
  fixedUpdate(dt: number, tick: number): void;
  /**
   * Draw a frame. `alpha` is 0..1 between the previous and current sim state, for
   * interpolating render transforms. `frameDt` is real elapsed time, for UI only.
   */
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private lastRenderTime = 0;
  private nextRenderTime = 0;
  private minimumRenderIntervalMs = 0;
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
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  /** Caps presentation without changing the fixed 60 Hz simulation. */
  setRenderFps(fps: number | null): void {
    this.minimumRenderIntervalMs = fps === null ? 0 : 1000 / Math.max(1, fps);
    const now = performance.now();
    this.lastRenderTime = now;
    this.nextRenderTime = now;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.frame);

    const frameDt = (now - this.lastTime) / 1000;
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

    // Acceptable presents at at most 30 Hz but continues to simulate on every
    // callback. Deadlines, rather than elapsed-time resets, matter here: a 40 Hz
    // callback stream must produce ~30 renders, not accidentally halve to 20.
    if (
      this.minimumRenderIntervalMs > 0
      && now + 0.5 < this.nextRenderTime
    ) {
      return;
    }
    if (this.minimumRenderIntervalMs > 0) {
      do {
        this.nextRenderTime += this.minimumRenderIntervalMs;
      } while (this.nextRenderTime <= now);
    } else {
      this.nextRenderTime = now;
    }
    const renderElapsedMs = now - this.lastRenderTime;
    this.lastRenderTime = now;
    this.callbacks.render(this.accumulator / FIXED_DT, renderElapsedMs / 1000);
  };
}
