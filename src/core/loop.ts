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
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
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

    // After a stall (tab switch, chunk build) discard the backlog instead of
    // fast-forwarding through it, which would teleport the car.
    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.callbacks.render(this.accumulator / FIXED_DT, frameDt);
  };
}
