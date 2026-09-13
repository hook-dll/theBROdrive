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

/**
 * WHY A RUNNING AVERAGE AND NOT A STREAK.
 *
 * This used to count consecutive samples: eight slow ones stepped down, and two
 * hundred and forty fast ones stepped back up — with a single sample anywhere in
 * the band BETWEEN the two thresholds resetting both counters. On the machines
 * this game is built for the band is where a healthy frame actually lives, so the
 * upward streak could never complete: the first launch transient (shader variants
 * for freshly streamed content, texture uploads, a GC) walked the scale down to
 * its floor, and nothing could ever walk it back. The player then drove a whole
 * session at 55% resolution, where the film grain is filtered away, the ink
 * outlines smear into a general darkening, and the surfaces lose their texture —
 * which reads exactly like "the shaders did not apply", and went away only on the
 * next launch because a warm cache produced fewer slow frames.
 *
 * An exponential average has no such cliff. A brief stall raises it for a moment
 * and it decays again; only cost that PERSISTS moves the scale, in either
 * direction. The two thresholds keep a dead band between them, so nothing
 * oscillates: a step down multiplies the cost by ~0.72 and a step up by ~1.17,
 * both of which land inside the band rather than back across the line.
 */
const SAMPLE_WEIGHT = 0.08;
/**
 * Samples discarded after every scale change. Resizing reallocates the scene
 * target (and its multisample and depth attachments), so the frames straddling
 * the change measure the reallocation rather than the new resolution.
 */
const RESIZE_DISCARD_SAMPLES = 8;
/**
 * Samples the average is given to converge on the new resolution before it may
 * order another change. At 60 Hz this is half a second of evidence.
 */
const SETTLE_SAMPLES = 30;
const SCALE_STEP_DOWN = 0.85;
/**
 * Recovery is deliberately slower per step than the drop, but it has to be able to
 * cross the whole range in a reasonable time: 0.55 to 1.0 is eight steps of 8%,
 * about twenty seconds of sustained headroom, against the sixty-odd a 3% step
 * would need.
 */
const SCALE_STEP_UP = 1.08;
const DOWN_COOLDOWN_MS = 1_500;
const UP_COOLDOWN_MS = 2_500;

/**
 * Applies conservative, GPU-measured dynamic-resolution adjustments for one quality
 * tier. Frames that are unsafe to judge are skipped rather than averaged in.
 */
export class AdaptiveResolutionController {
  private quality: GraphicsQuality;
  /** Running mean GPU cost in ms, or null until the first admissible sample. */
  private average: number | null = null;
  private samplesSinceChange = 0;
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

  /**
   * Exponential mean of the GPU durations measured so far, or null before any.
   *
   * Exposed for the development frame report, which is the only way to tell on a real
   * phone whether a hot frame is waiting on the GPU or on the CPU.
   */
  get averageGpuMs(): number | null {
    return this.average;
  }

  /**
   * Whether the current scale has been MEASURED rather than merely left alone.
   *
   * "Nothing changed recently" is not the same answer: a decision needs its
   * discarded resize frames, its half second of averaging and its cooldown, so a
   * launch that waits only for quiet leaves before the controller has said
   * anything at all — and then takes the steps it was going to take with the
   * player watching. The launch settle waits for this instead.
   */
  verdictReached(nowMs: number): boolean {
    return (
      this.samplesSinceChange >= RESIZE_DISCARD_SAMPLES + SETTLE_SAMPLES
      && nowMs - this.lastChangeMs >= DOWN_COOLDOWN_MS
    );
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this.minimumScale = DEFAULT_MIN_SCALE[quality];
    this._scale = 1;
    this.forget();
    this.lastChangeMs = -Infinity;
  }

  /** Sets the floor resolved from the current viewport's absolute pixel budget. */
  setMinimumScale(scale: number): void {
    this.minimumScale = Math.min(1, Math.max(0.1, scale));
    if (this._scale < this.minimumScale) {
      this._scale = this.minimumScale;
      this.forget();
    }
  }

  sample(
    gpuMs: number | null,
    eligible: boolean,
    allowUpscale: boolean,
    nowMs: number,
  ): 'down' | 'up' | null {
    // A frame with no usable measurement carries no evidence either way. It is
    // dropped, NOT counted as healthy and not used to forget what is known: a
    // driver that reports a timing every other frame must still be able to adapt.
    if (gpuMs === null || !eligible) return null;

    this.samplesSinceChange += 1;
    if (this.samplesSinceChange <= RESIZE_DISCARD_SAMPLES) return null;
    this.average =
      this.average === null ? gpuMs : this.average + (gpuMs - this.average) * SAMPLE_WEIGHT;
    if (this.samplesSinceChange < RESIZE_DISCARD_SAMPLES + SETTLE_SAMPLES) return null;

    if (this.average > SLOW_GPU_MS[this.quality]) {
      if (this._scale <= this.minimumScale) return null;
      if (nowMs - this.lastChangeMs < DOWN_COOLDOWN_MS) return null;
      this.applyScale(Math.max(this.minimumScale, this._scale * SCALE_STEP_DOWN), nowMs);
      return 'down';
    }

    if (allowUpscale && this.average < FAST_GPU_MS[this.quality]) {
      if (this._scale >= 1) return null;
      if (nowMs - this.lastChangeMs < UP_COOLDOWN_MS) return null;
      this.applyScale(Math.min(1, this._scale * SCALE_STEP_UP), nowMs);
      return 'up';
    }

    return null;
  }

  private applyScale(scale: number, nowMs: number): void {
    this._scale = scale;
    this.lastChangeMs = nowMs;
    this.forget();
  }

  /** Drops the evidence gathered at the previous resolution. */
  private forget(): void {
    this.average = null;
    this.samplesSinceChange = 0;
  }
}
