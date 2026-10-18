/**
 * The police siren (world/police.ts), heard from the chasing car: a two-tone yelp.
 *
 * One square-ish oscillator swept between `LOW_HZ` and `HIGH_HZ` by a triangle at
 * `YELP_HZ`, through a band-pass that is the horn's throat, into a panner. Loud and long-
 * ranged on purpose: it is meant to be heard over the engine from well behind. It sits on
 * the World bus, so the World slider governs it.
 */

import { AudioMixer, ramp, setPannerPosition } from './mixer';

/** Whole-voice level into the World bus. */
const SIREN_GAIN = 0.32;
const LOW_HZ = 650;
const HIGH_HZ = 1450;
/** Sweeps a second, up and down. */
const YELP_HZ = 1.6;

export class SirenVoice {
  private readonly out: GainNode;
  private readonly panner: PannerNode;
  private readonly tone: OscillatorNode;
  private readonly sweep: OscillatorNode;
  private disposed = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.world);
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 12,
      rolloffFactor: 1.1,
      maxDistance: 900,
    });
    this.panner.connect(this.out);
    const throat = ctx.createBiquadFilter();
    throat.type = 'bandpass';
    throat.frequency.value = 1100;
    throat.Q.value = 0.7;
    throat.connect(this.panner);
    this.tone = ctx.createOscillator();
    this.tone.type = 'sawtooth';
    this.tone.frequency.value = (LOW_HZ + HIGH_HZ) / 2;
    this.tone.connect(throat);
    this.sweep = ctx.createOscillator();
    this.sweep.type = 'triangle';
    this.sweep.frequency.value = YELP_HZ;
    const depth = ctx.createGain();
    depth.gain.value = (HIGH_HZ - LOW_HZ) / 2;
    this.sweep.connect(depth).connect(this.tone.frequency);
    this.tone.start();
    this.sweep.start();
    ramp(this.out.gain, SIREN_GAIN, mixer.now, 0.3);
  }

  /** The car's position in the listener's (relative) frame. */
  update(x: number, y: number, z: number): void {
    if (this.disposed) return;
    setPannerPosition(this.panner, x, y, z, this.mixer.now, 0.05);
  }

  /** Fades out, then tears down. */
  release(): void {
    if (this.disposed) return;
    ramp(this.out.gain, 0, this.mixer.now, 0.25);
    window.setTimeout(() => this.dispose(), 1000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tone.stop();
    this.sweep.stop();
    this.out.disconnect();
    this.panner.disconnect();
  }
}
