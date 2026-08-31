import type { GraphicsQuality } from '../game/settings';

const MIN_SCALE: Record<GraphicsQuality, number> = {
  acceptable: 0.5,
  standard: 0.85,
  blessing: 1,
};
const SLOW_GPU_MS = 19;
const FAST_GPU_MS = 13;
const SLOW_SAMPLE_COUNT = 24;
const FAST_SAMPLE_COUNT = 120;
const SCALE_STEP_DOWN = 0.8;
const SCALE_STEP_UP = 1.05;
const CHANGE_COOLDOWN_MS = 2_000;

/**
 * Applies conservative, GPU-measured dynamic-resolution adjustments for one quality
 * tier. CPU work and frames that are unsafe to judge deliberately reset its evidence.
 */
export class AdaptiveResolutionController {
  private quality: GraphicsQuality;
  private downStreak = 0;
  private upStreak = 0;
  private lastChangeMs = -Infinity;
  private _scale = 1;

  constructor(quality: GraphicsQuality) {
    this.quality = quality;
  }

  get scale(): number {
    return this._scale;
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this._scale = 1;
    this.resetStreaks();
    this.lastChangeMs = -Infinity;
  }

  sample(
    gpuMs: number | null,
    eligible: boolean,
    allowUpscale: boolean,
    nowMs: number,
  ): 'down' | 'up' | null {
    if (gpuMs === null || !eligible || this.quality === 'blessing') {
      this.resetStreaks();
      return null;
    }

    const floor = MIN_SCALE[this.quality];
    if (gpuMs > SLOW_GPU_MS) {
      this.downStreak += 1;
      this.upStreak = 0;
      if (
        this.downStreak >= SLOW_SAMPLE_COUNT
        && this._scale > floor
        && nowMs - this.lastChangeMs >= CHANGE_COOLDOWN_MS
      ) {
        this._scale = Math.max(floor, this._scale * SCALE_STEP_DOWN);
        this.lastChangeMs = nowMs;
        this.resetStreaks();
        return 'down';
      }
      return null;
    }

    if (gpuMs < FAST_GPU_MS) {
      this.upStreak += 1;
      this.downStreak = 0;
      if (
        allowUpscale
        && this.upStreak >= FAST_SAMPLE_COUNT
        && this._scale < 1
        && nowMs - this.lastChangeMs >= CHANGE_COOLDOWN_MS
      ) {
        this._scale = Math.min(1, this._scale * SCALE_STEP_UP);
        this.lastChangeMs = nowMs;
        this.resetStreaks();
        return 'up';
      }
      return null;
    }

    this.resetStreaks();
    return null;
  }

  private resetStreaks(): void {
    this.downStreak = 0;
    this.upStreak = 0;
  }
}
