/**
 * The last thing before the speakers: a transparent look-ahead peak limiter.
 *
 * WHY NOT DynamicsCompressorNode. The browser's compressor applies its own automatic
 * make-up gain, derived from threshold and ratio and not switchable off. The one this
 * replaced (-9 dB threshold, 5:1) lifted the whole mix by about +4 dB before it
 * reached the output, so a mix that was already near full scale was driven into the
 * destination's hard clip — the "everything at 100% sounds clipped" of 2026-09-28.
 *
 * WHAT THIS DOES. It only ever turns the signal DOWN, and only as far as needed to
 * keep every sample under `CEILING`. The gain it needs is found `LOOKAHEAD` ahead of
 * the audio it applies to (the audio is delayed by that much), held at its minimum
 * over the window, released slowly, and box-smoothed over the window — which lands the
 * gain exactly at the required depth by the time the peak arrives, with no overshoot
 * and no distortion from gain changing faster than the signal. Stereo-linked, so a
 * peak on one side does not pull the image across.
 *
 * With the buses staged so the mix sits well below it (mixer.ts), this almost never
 * acts: it is the net for a crash under thunder at the redline, not a loudness tool.
 */

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  constructor(options?: unknown);
}

/** Output ceiling, linear: -1 dBFS, headroom for the codec and the DAC's reconstruction. */
const CEILING = 0.891;
/** Look-ahead, seconds. Long enough for a smooth attack, short enough not to be heard. */
const LOOKAHEAD = 0.004;
/** Release time constant, seconds. */
const RELEASE = 0.18;

class LimiterProcessor extends AudioWorkletProcessor {
  private readonly window: number;
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  /** Monotonic deque of (index, gain) for the running minimum over the window. */
  private readonly dqGain: Float32Array;
  private readonly dqIndex: Float64Array;
  private dqHead = 0;
  private dqTail = 0;
  /** Box filter over the released gain. */
  private readonly box: Float32Array;
  private boxSum: number;
  private readonly releaseCoef: number;
  private released = 1;
  private n = 0;

  constructor() {
    super();
    this.window = Math.max(1, Math.round(LOOKAHEAD * sampleRate));
    this.delayL = new Float32Array(this.window);
    this.delayR = new Float32Array(this.window);
    this.dqGain = new Float32Array(this.window + 2);
    this.dqIndex = new Float64Array(this.window + 2);
    this.box = new Float32Array(this.window).fill(1);
    this.boxSum = this.window;
    this.releaseCoef = 1 - Math.exp(-1 / (RELEASE * sampleRate));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0]!;
    const outL = output[0]!;
    const outR = output[1] ?? outL;
    const inL = input?.[0];
    const inR = input?.[1] ?? inL;
    const w = this.window;
    const cap = this.dqGain.length;
    for (let i = 0; i < outL.length; i++) {
      const l = inL ? inL[i]! : 0;
      const r = inR ? inR[i]! : 0;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const need = peak > CEILING ? CEILING / peak : 1;

      // Running minimum of `need` over the last `w + 1` samples (a monotonic deque). The
      // audio leaves the delay `w` samples late and the box below averages the `w` most
      // recent gains, so a peak entering now must stay in the minimum for w + 1 samples
      // for every gain in the box that meets it to be at or below what it needs.
      const n = this.n++;
      while (this.dqTail !== this.dqHead && this.dqGain[(this.dqTail - 1 + cap) % cap]! >= need) {
        this.dqTail = (this.dqTail - 1 + cap) % cap;
      }
      this.dqGain[this.dqTail] = need;
      this.dqIndex[this.dqTail] = n;
      this.dqTail = (this.dqTail + 1) % cap;
      while (this.dqIndex[this.dqHead]! < n - w) this.dqHead = (this.dqHead + 1) % cap;
      const held = this.dqGain[this.dqHead]!;

      // Instant down, slow back up.
      this.released = held < this.released ? held : this.released + (held - this.released) * this.releaseCoef;

      // Box-smooth over the window: reaches `held` exactly as the peak leaves the delay.
      const slot = n % w;
      this.boxSum += this.released - this.box[slot]!;
      this.box[slot] = this.released;
      const gain = Math.min(1, this.boxSum / w);

      const dl = this.delayL[slot]!;
      const dr = this.delayR[slot]!;
      this.delayL[slot] = l;
      this.delayR[slot] = r;
      outL[i] = dl * gain;
      if (outR !== outL) outR[i] = dr * gain;
    }
    // Float drift in the running sum, re-anchored now and then.
    if ((this.n & 0xffff) < outL.length) {
      let s = 0;
      for (let k = 0; k < w; k++) s += this.box[k]!;
      this.boxSum = s;
    }
    return true;
  }
}

registerProcessor('bro-limiter', LimiterProcessor);
