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
/**
 * How much of the slow threshold the PREDICTED cost of the next rung up may take.
 *
 * There is no second, lower threshold any more, and that is the fix: the old pair
 * asked the frame to become cheap in absolute terms (7 ms on `standard`) before it
 * would hand a single pixel back, while the frame only had to exceed 11 ms to lose
 * them. Between the two lies the band a healthy frame on these machines actually
 * occupies, so any load that pushed the scale down — a night of lit lamps, the
 * dawn that switches the heat-mirage warp and its depth resolve back on, a burst
 * of freshly streamed shader variants — left it down for the rest of the session.
 * The player then drove a whole day at the floor, which reads as "the shaders did
 * not apply" (see the grain/ink note below).
 *
 * A rung is now judged by what it would COST, not by an unrelated number: the step
 * is geometric and its inverse is the step back up, so climbing multiplies the
 * pixel count by exactly what the drop divided it by, and the cost of the rung is
 * predicted from the slope MEASURED across the last two rungs (see `observe`).
 * Until there is a slope to use, the prediction assumes the whole frame is fill,
 * which is the pessimistic end of the real curve and so can only be too cautious.
 */
const UP_PREDICTION_MARGIN = 0.9;

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
 * direction.
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
/**
 * One geometric rung, applied as a multiply going down and as a divide coming back
 * up, so the ladder a machine descends is the same one it climbs. 0.88 is 22% of
 * the pixels per rung: 1.0 down to a 0.625 floor is four of them, and the up
 * cooldown makes recovering that ground about ten seconds of proven headroom.
 *
 * Inverse steps are what makes the margin above safe from oscillation. A drop from
 * just above the threshold lands at 0.774 of the cost, and the climb back is
 * predicted at 0.774 x 1.292 = 1.0 of it — above the margin, so the controller
 * refuses to undo a reduction it just made and settles on the rung instead.
 */
const SCALE_STEP = 0.88;
const DOWN_COOLDOWN_MS = 1_500;
const UP_COOLDOWN_MS = 2_500;
/**
 * The saving a reduction must be predicted to deliver, as a fraction of the slow
 * threshold, before the image is asked to pay for it.
 *
 * A frame is `fixed + fill x pixels`, and the game's own measurements say the fixed
 * half is the larger one: cutting a phone's pixel budget by nearly three times moved
 * the cost of submitting a frame by twenty per cent, which is per-call work, not fill
 * rate. A controller that assumes the whole frame is fill therefore answers a
 * draw-call-bound stall by spending every rung it has — the picture is halved, the
 * stall is still there, and nothing measures that it did not help.
 *
 * So a reduction now has to be worth taking: roughly a twelfth of the budget, which
 * is the smallest saving that could plausibly close an overload of any size.
 */
const FUTILE_SAVING = 0.08;
/**
 * How far the frame may drift from the cost the slope was measured at, either way,
 * before that slope is discarded as describing a different frame.
 *
 * Both directions matter and for opposite reasons. Dearer: a slope of zero refuses
 * every reduction, and refusing every reduction produces no second measurement to
 * correct it, so the model could lock. Cheaper: the slope measured across a night's
 * lit lamps is far too steep for the morning, and left in place it would price every
 * rung back out of reach — the frame would stay at the resolution the night drove it
 * to for the rest of the drive, which is the exact complaint this controller exists
 * to not produce.
 *
 * Discarding means falling back to assuming the whole frame is fill, which is the
 * safest thing to assume while unmeasured, and one rung's worth of movement is
 * enough to measure it again.
 */
const MODEL_STALE_RATIO = 1.25;

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
  /**
   * The settled cost of the rung the controller last left, and the scale it was
   * measured at. Every rung change produces one of these, so the pair of them is a
   * two-point measurement of the SAME frame at two pixel counts — which is the only
   * honest way to know how much of the cost is fill and how much is not.
   */
  private observedScale: number | null = null;
  private observedAverage = 0;
  /**
   * Measured milliseconds per unit of scale², or null while the frame has only ever
   * been seen at one resolution. Null means "assume it is all fill", the most
   * expensive and therefore the safest assumption a prediction can make.
   */
  private fillSlope: number | null = null;

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
    // A rung change rewrites the frame itself — shadows, view distance, the pixel
    // ceiling — so the cost slope measured on the old one describes nothing here.
    this.observedScale = null;
    this.observedAverage = 0;
    this.fillSlope = null;
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
    // The first actionable average after a change is this rung's measurement. Taken
    // once, at a fixed amount of evidence, so consecutive rungs are comparable.
    if (this.samplesSinceChange === RESIZE_DISCARD_SAMPLES + SETTLE_SAMPLES) {
      this.observe(this.average);
    }

    const slow = SLOW_GPU_MS[this.quality];
    // A frame that costs materially more or materially less than the one the slope
    // was measured on is not that frame. Forget the slope rather than reason from it.
    if (
      this.fillSlope !== null
      && (this.average > this.observedAverage * MODEL_STALE_RATIO
        || this.average * MODEL_STALE_RATIO < this.observedAverage)
    ) {
      this.fillSlope = null;
    }

    if (
      this.average > slow
      && this._scale > this.minimumScale
      && nowMs - this.lastChangeMs >= DOWN_COOLDOWN_MS
    ) {
      const next = Math.max(this.minimumScale, this._scale * SCALE_STEP);
      // Resolution is spent only where resolution is the problem. On a frame whose
      // cost the pixel count barely moves, this is what stops the controller from
      // walking the picture down to its floor against a stall it cannot reach.
      // Refusing falls THROUGH to the rung test below rather than returning: a
      // measurement that says these pixels are free says it in both directions.
      if (this.average - this.predictedCost(next) >= slow * FUTILE_SAVING) {
        this.applyScale(next, nowMs);
        return 'down';
      }
    }

    if (allowUpscale && this._scale < 1 && nowMs - this.lastChangeMs >= UP_COOLDOWN_MS) {
      const next = Math.min(1, this._scale / SCALE_STEP);
      const predicted = this.predictedCost(next);
      // Two ways to earn a rung. Either its PREDICTED cost still leaves the margin —
      // so the machine is never asked to prove anything about a resolution it is not
      // currently rendering — or the rung is MEASURABLY free, which is the only
      // honest answer for a frame whose cost the pixel count does not move: hold it
      // at the sharpest resolution its cost is indifferent to.
      const affordable = predicted <= slow * UP_PREDICTION_MARGIN;
      const free = predicted - this.average < slow * FUTILE_SAVING;
      if (!affordable && !free) return null;
      this.applyScale(next, nowMs);
      return 'up';
    }

    return null;
  }

  /**
   * Records this rung's settled cost and, against the previous rung's, the slope of
   * cost against pixel count. Two points on the same frame is the whole model.
   */
  private observe(average: number): void {
    const previousScale = this.observedScale;
    const previousAverage = this.observedAverage;
    this.observedScale = this._scale;
    this.observedAverage = average;
    if (previousScale === null) return;
    const pixelDelta = previousScale * previousScale - this._scale * this._scale;
    // Same rung (a floor clamp can produce one): no second point, nothing to learn.
    if (Math.abs(pixelDelta) < 1e-6) return;
    const pixels = this._scale * this._scale;
    // Bounded at both ends by what a frame can physically be. Below: fewer pixels
    // never cost more, so a negative reading is noise and means "resolution buys
    // nothing here". Above: the fill half cannot exceed the whole measured cost,
    // since the rest of the frame cannot take less than no time — which is also the
    // clamp that contains the one way two points can lie, a workload that changed
    // between them. Attributing a dusk, a stall or a streamed chunk to the pixel
    // count would otherwise leave the controller convinced that a rung it can
    // easily afford is out of reach.
    const slope = (previousAverage - average) / pixelDelta;
    this.fillSlope = Math.min(Math.max(0, slope), average / Math.max(1e-6, pixels));
  }

  /**
   * What the frame would cost at `scale`, from the live average at the current one.
   *
   * The level comes from the live average and only the DIFFERENCE comes from the
   * model, so a workload that gets cheaper or dearer moves the prediction with it
   * immediately; a stale slope can only ever mis-estimate the step, never the
   * baseline.
   */
  private predictedCost(scale: number): number {
    const average = this.average ?? 0;
    const pixels = this._scale * this._scale;
    const slope = this.fillSlope ?? average / Math.max(1e-6, pixels);
    return Math.max(0, average + slope * (scale * scale - pixels));
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
