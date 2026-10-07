/**
 * The courier air dancer, heard: a fabric tube on a blower.
 *
 * Two layers through one panner, both noise, both driven by the simulation rather
 * than a loop, so the sound is the motion you are watching:
 *
 * - FLAP: the nylon slapping and rustling as the tube whips. Mid-band noise whose level
 *   follows how fast the tube's top is moving, with a little bite added on fast swings.
 * - WUFF: the soft, wet "hlyup" of the tube losing and regaining its air. Low-passed
 *   noise that swells with how fast the pressure is changing — the choke and the
 *   re-inflation — and is silent while the tube just stands and dances.
 *
 * Quiet on purpose and short-ranged: it is something you hear walking up to the
 * courier, not from the road. It sits on the World bus, so the World slider governs it.
 */

import { AudioMixer, ramp, setPannerPosition } from './mixer';

/** Whole-voice level into the World bus. */
const DANCER_GAIN = 0.16;
/** Top speed, m/s, at which the flap layer is at full level. */
const FLAP_FULL_MPS = 4;
/** Rate of pressure change, 1/s, at which the wuff is at full level. */
const WUFF_FULL_RATE = 3;

export class DancerVoice {
  private readonly out: GainNode;
  private readonly panner: PannerNode;
  private readonly flapFilter: BiquadFilterNode;
  private readonly flapGain: GainNode;
  private readonly wuffGain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  private disposed = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.world);
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 3,
      rolloffFactor: 1.6,
      maxDistance: 90,
    });
    this.panner.connect(this.out);

    this.flapFilter = ctx.createBiquadFilter();
    this.flapFilter.type = 'bandpass';
    this.flapFilter.frequency.value = 900;
    this.flapFilter.Q.value = 0.8;
    this.flapGain = ctx.createGain();
    this.flapGain.gain.value = 0;
    const flap = mixer.noiseSource('pink');
    flap.connect(this.flapFilter).connect(this.flapGain).connect(this.panner);

    const wuffFilter = ctx.createBiquadFilter();
    wuffFilter.type = 'lowpass';
    wuffFilter.frequency.value = 220;
    wuffFilter.Q.value = 2.2;
    this.wuffGain = ctx.createGain();
    this.wuffGain.gain.value = 0;
    const wuff = mixer.noiseSource('brown');
    wuff.connect(wuffFilter).connect(this.wuffGain).connect(this.panner);

    this.sources.push(flap, wuff);
    ramp(this.out.gain, DANCER_GAIN, mixer.now, 0.4);
  }

  /**
   * `x,y,z` is the tube's top in the listener's (relative) frame; `flapMps` how fast
   * it is moving; `airRate` how fast its pressure is changing, 1/s.
   */
  update(x: number, y: number, z: number, flapMps: number, airRate: number): void {
    if (this.disposed) return;
    const now = this.mixer.now;
    setPannerPosition(this.panner, x, y, z, now, 0.05);
    const flap = Math.min(1, flapMps / FLAP_FULL_MPS);
    ramp(this.flapGain.gain, 0.15 + 0.85 * flap * flap, now, 0.06);
    // Faster swings are a sharper snap of the fabric.
    this.flapFilter.frequency.setTargetAtTime(700 + 900 * flap, now, 0.06);
    const wuff = Math.min(1, airRate / WUFF_FULL_RATE);
    ramp(this.wuffGain.gain, 2.2 * wuff, now, 0.05);
  }

  /** Fades out, then tears down. */
  release(): void {
    if (this.disposed) return;
    ramp(this.out.gain, 0, this.mixer.now, 0.2);
    window.setTimeout(() => this.dispose(), 800);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const src of this.sources) src.stop();
    this.out.disconnect();
    this.panner.disconnect();
  }
}
