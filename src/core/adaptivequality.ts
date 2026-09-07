import type { GraphicsQuality } from '../game/settings';

const DEFAULT_MIN_SCALE: Record<GraphicsQuality, number> = {
  acceptable: 0.8,
  standard: 0.55,
  blessing: 0.7,
};
// Acceptable deliberately targets a stable 30 Hz presentation. Its extra frame
// budget buys image resolution on small integrated GPUs; simulation remains 60 Hz.
const SLOW_GPU_MS: Record<GraphicsQuality, number> = {
  acceptable: 26,
  standard: 11,
  blessing: 11,
};
const FAST_GPU_MS: Record<GraphicsQuality, number> = {
  acceptable: 19,
  standard: 7,
  blessing: 7,
};
const SLOW_SAMPLE_COUNT = 8;
const FAST_SAMPLE_COUNT = 240;
const SCALE_STEP_DOWN = 0.85;
const SCALE_STEP_UP = 1.03;
const CHANGE_COOLDOWN_MS = 1_500;

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
  private minimumScale: number;

  constructor(quality: GraphicsQuality) {
    this.quality = quality;
    this.minimumScale = DEFAULT_MIN_SCALE[quality];
  }

  get scale(): number {
    return this._scale;
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this.minimumScale = DEFAULT_MIN_SCALE[quality];
    this._scale = 1;
    this.resetStreaks();
    this.lastChangeMs = -Infinity;
  }

  /** Sets the floor resolved from the current viewport's absolute pixel budget. */
  setMinimumScale(scale: number): void {
    this.minimumScale = Math.min(1, Math.max(0.1, scale));
    if (this._scale < this.minimumScale) this._scale = this.minimumScale;
  }

  sample(
    gpuMs: number | null,
    eligible: boolean,
    allowUpscale: boolean,
    nowMs: number,
  ): 'down' | 'up' | null {
    if (gpuMs === null || !eligible) {
      this.resetStreaks();
      return null;
    }

    const floor = this.minimumScale;
    if (gpuMs > SLOW_GPU_MS[this.quality]) {
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

    if (gpuMs < FAST_GPU_MS[this.quality]) {
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
