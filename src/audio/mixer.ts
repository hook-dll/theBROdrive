/**
 * The audio device, and nothing else.
 *
 * Every sound in the game is synthesised at runtime (see vehicleaudio.ts, foley.ts,
 * ambience.ts and the engine worklet): there is not a single sample file in the
 * project. That is deliberate — a car engine is a pitch-and-load problem, not a
 * loop-crossfade problem, and a synthesised one tracks rpm exactly instead of
 * stepping between recorded bands.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so the context
 * is created suspended and resumed by the first click/keypress; until then every
 * voice runs into a muted graph rather than being conditionally absent, which
 * keeps the voices free of "is audio up yet" branches.
 *
 * NOISE. Every noise voice used to loop the SAME two-second white buffer, all started
 * on the same sample — so wind, tyres, skid and brakes were literally one signal
 * through different filters. Correlated layers do not add up to a richer sound, they
 * collapse into one, and a two-second loop is short enough to hear breathe. Now there
 * are three colours (white, pink, brown) of eight seconds each, and every source
 * starts at its own random offset and runs at its own slightly different rate, so no
 * two voices ever line up and the loop never repeats in phase with anything.
 */

import engineWorkletUrl from './engine-worklet.ts?worker&url';
import { SampleBank } from './samples';
import limiterWorkletUrl from './limiter-worklet.ts?worker&url';

/** Master ramp time for volume/pause changes, seconds. Short enough to feel instant. */
const MASTER_RAMP = 0.08;

/**
 * GAIN STAGING. Every voice was written against "1 is full", and a dozen of them at
 * once summed well past full scale, into a limiter that added gain of its own. The
 * game bus now carries a fixed trim so the procedural sound lands where broadcast
 * material does, and the radio a trim that brings a loud, mastered stream down to
 * sit beside it — so at 100 % on every slider nothing reaches the limiter except a
 * genuine spike. Measured with the dev meter (`__bro.audio.meter()`,
 * tools/sound/levels.mjs), K-weighted, the targets are:
 *   radio (a typical NTS stream)         about -20 LUFS
 *   car cruising, chase camera           about -21 LUFS; idle about -30
 *   world bed on a calm day              about -36 LUFS; rain about -27
 *   thunder, a near stroke               momentary about -14 LUFS, peaks under -3 dBFS
 */
export const GAME_TRIM = 0.32;
/**
 * Other traffic against the driven car. A passing car at the same distance is as loud
 * as your own, but it is only that close for a second; standing near a road the
 * procedural engines summed louder than the car being driven.
 */
export const TRAFFIC_TRIM = 0.5;
export const RADIO_TRIM = 0.42;

/**
 * Slider position (0..1) to amplitude. Loudness is heard in decibels, so a linear
 * slider does nothing over most of its travel and everything in its last tenth; a
 * square law is close to even in loudness and exactly 0 at the bottom. Every volume
 * in the game uses this one curve, so 50 % means the same on each.
 */
export function sliderGain(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return v * v;
}
/** Length of each shared noise loop, seconds. */
const NOISE_SECONDS = 8;
/** Length of the crackle (sparse grain) loop, seconds. */
const CRACKLE_SECONDS = 4;
/** Grains per second in the crackle loop at playback rate 1. */
const CRACKLE_DENSITY = 260;
/** World reverb tail, seconds: open country, a few reflections and a long sky. */
const REVERB_SECONDS = 2.6;

export type NoiseColour = 'white' | 'pink' | 'brown';

export type MeterBus = 'car' | 'world' | 'traffic' | 'game' | 'radio' | 'master' | 'out';

/** One bus's level over the last analyser window (~0.7 s): K-weighted loudness and peak. */
export interface MeterReading {
  lufs: number;
  peakDb: number;
}

/**
 * ITU-R BS.1770 K-weighting biquads for `sr`, [b0, b1, b2, a1, a2] per stage: the
 * +4 dB head shelf and the 38 Hz high-pass that turn a mean square into loudness.
 */
function kWeightStages(sr: number): number[][] {
  const K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const K1 = Math.tan((Math.PI * 38.13547087602444) / sr);
  const Q1 = 0.5003270373238773;
  const d = 1 + K1 / Q1 + K1 * K1;
  return [
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    [1, -2, 1, (2 * (K1 * K1 - 1)) / d, (1 - K1 / Q1 + K1 * K1) / d],
  ];
}

/** Deterministic xorshift32, so the noise floor is the same between runs. */
function xorshift(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/** The audio graph's own sample rate; see the AudioMixer constructor. */
const AUDIO_SAMPLE_RATE = 48_000;

export class AudioMixer {
  readonly ctx: AudioContext;
  /** Game audio (engine, wind, tyres, foley, the world). Under the master, with the radio. */
  readonly sfx: GainNode;
  /** Every radio's output. Under the master, beside the game sound. */
  readonly radio: GainNode;
  /** The car being driven. Its own share of `sfx`, set by the Car volume. */
  readonly car: GainNode;
  /** Air, weather, animals and other traffic. Its own share, set by the World volume. */
  readonly world: GainNode;
  /** Other cars, a part of `world` with its own trim (TRAFFIC_TRIM). */
  readonly traffic: GainNode;
  /**
   * Send into the shared world reverb. Voices that happen OUT in the world (thunder,
   * a gunshot, a crash, a bird) send a little here; the car's own drone does not.
   */
  readonly reverb: GainNode;
  /** The recorded sounds (samples.ts), fetched as voices first ask for them. */
  readonly samples: SampleBank;

  private readonly master: GainNode;
  /** After the limiter: what the speakers get. */
  private readonly output: GainNode;
  private meterTaps: Record<MeterBus, AnalyserNode> | null = null;
  private readonly noiseBuffers = new Map<NoiseColour, AudioBuffer>();
  private crackleBufferValue: AudioBuffer | null = null;
  private volume = 1;
  private suspendedByPause = false;
  private started = false;
  private disposed = false;
  private engineWorkletReady = false;
  private readonly engineWorkletWaiters: (() => void)[] = [];

  constructor() {
    // The rate is NAMED, not left to the device. Left to it, Chrome reported 48 kHz
    // through `sampleRate` while the context actually ran at the device's 44.1 kHz, so
    // the reverb impulses built at `sampleRate` were refused by their ConvolverNodes
    // ("buffer sample rate 48000 does not match the context rate of 44100") and the
    // game failed to start. A named rate is the rate the context runs at; the browser
    // resamples to the device.
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: AUDIO_SAMPLE_RATE });
    this.samples = new SampleBank(this.ctx);

    // master (volume, pause) -> limiter -> speakers. The limiter is a worklet and
    // arrives a moment after construction; until then (the context is still waiting for
    // a gesture anyway) the master goes straight out.
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.output = this.ctx.createGain();
    this.output.connect(this.ctx.destination);
    this.master.connect(this.output);
    void this.loadWorklet(limiterWorkletUrl)
      .then(() => {
        if (this.disposed) return;
        const limiter = new AudioWorkletNode(this.ctx, 'bro-limiter', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.master.disconnect();
        this.master.connect(limiter).connect(this.output);
      })
      .catch((error: unknown) => {
        console.warn('limiter worklet failed to load; the mix goes out unlimited', error);
      });

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = GAME_TRIM;
    this.sfx.connect(this.master);
    this.radio = this.ctx.createGain();
    this.radio.gain.value = RADIO_TRIM;
    this.radio.connect(this.master);
    this.car = this.ctx.createGain();
    this.car.connect(this.sfx);
    this.world = this.ctx.createGain();
    this.world.connect(this.sfx);
    this.traffic = this.ctx.createGain();
    this.traffic.gain.value = TRAFFIC_TRIM;
    this.traffic.connect(this.world);

    this.reverb = this.ctx.createGain();
    this.reverb.gain.value = 1;
    const convolver = this.ctx.createConvolver();
    convolver.normalize = true;
    convolver.buffer = this.buildReverbImpulse();
    const reverbReturn = this.ctx.createGain();
    reverbReturn.gain.value = 0.55;
    // The reverb is the open country itself, so it answers to the World volume.
    this.reverb.connect(convolver).connect(reverbReturn).connect(this.world);

    void this.loadWorklet(engineWorkletUrl)
      .then(() => {
        this.engineWorkletReady = true;
        for (const waiter of this.engineWorkletWaiters.splice(0)) waiter();
      })
      .catch((error: unknown) => {
        console.warn('engine audio worklet failed to load; engines will be silent', error);
      });

    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  /**
   * `audioWorklet` exists only in a secure context (https or localhost). A phone opening
   * the dev server by its LAN address (http://192.168.…) has none, and touching it
   * threw out of the constructor: "Cannot read properties of undefined (reading
   * 'addModule')" on New drive. Rejecting instead lets each caller's fallback run: an
   * unlimited mix and silent engines, the game itself unaffected.
   */
  private loadWorklet(url: string): Promise<void> {
    const worklet = this.ctx.audioWorklet as AudioWorklet | undefined;
    if (!worklet) return Promise.reject(new Error('AudioWorklet needs a secure context (https or localhost)'));
    return worklet.addModule(url);
  }

  /** Resumes the context on the first user gesture; a no-op afterwards. */
  private unlock = (): void => {
    if (this.disposed) return;
    void this.ctx.resume().then(() => {
      this.started = true;
      this.applyMasterGain();
    });
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
  };

  get now(): number {
    return this.ctx.currentTime;
  }

  /** True once the context is actually running, i.e. sound can be heard. */
  get running(): boolean {
    return this.started && this.ctx.state === 'running';
  }

  /** Runs `callback` once the engine worklet module is loaded (immediately if it is). */
  whenEngineReady(callback: () => void): void {
    if (this.engineWorkletReady) callback();
    else this.engineWorkletWaiters.push(callback);
  }

  /** 0..1 master slider: everything the game makes, the radio included. */
  setVolume(volume: number): void {
    this.volume = sliderGain(volume);
    this.applyMasterGain();
  }

  /** 0..1 sliders for the car, the world and the radio, each under the master. */
  setBusVolumes(car: number, world: number, radio: number): void {
    if (this.disposed) return;
    this.car.gain.setTargetAtTime(sliderGain(car), this.now, MASTER_RAMP);
    this.world.gain.setTargetAtTime(sliderGain(world), this.now, MASTER_RAMP);
    this.radio.gain.setTargetAtTime(RADIO_TRIM * sliderGain(radio), this.now, MASTER_RAMP);
  }

  /** Silences the graph while the pause menu is up, without tearing voices down. */
  setPaused(paused: boolean): void {
    if (this.suspendedByPause === paused) return;
    this.suspendedByPause = paused;
    this.applyMasterGain();
  }

  private applyMasterGain(): void {
    if (this.disposed) return;
    const target = this.suspendedByPause || !this.started ? 0 : this.volume;
    const g = this.master.gain;
    g.cancelScheduledValues(this.now);
    g.setTargetAtTime(target, this.now, MASTER_RAMP);
  }

  /**
   * The shared noise loop of one colour. White is flat; pink (-3 dB/octave) is what
   * wind, rain and road roar actually measure as; brown (-6 dB/octave) is rumble —
   * thunder, buffeting, the cabin's low road roar.
   */
  noiseBuffer(colour: NoiseColour = 'white'): AudioBuffer {
    const cached = this.noiseBuffers.get(colour);
    if (cached) return cached;
    const length = Math.floor(this.ctx.sampleRate * NOISE_SECONDS);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rand = xorshift(colour === 'white' ? 0x9e3779b9 : colour === 'pink' ? 0x85ebca6b : 0xc2b2ae35);
    if (colour === 'white') {
      for (let i = 0; i < length; i++) data[i] = rand();
    } else if (colour === 'pink') {
      // Paul Kellet's economy pink filter: three poles, within 0.5 dB of -3 dB/oct.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i++) {
        const w = rand();
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    } else {
      // Leaky integrator: brown noise that cannot wander off to DC.
      let y = 0;
      for (let i = 0; i < length; i++) {
        y = 0.996 * y + rand() * 0.06;
        data[i] = y * 1.9;
      }
    }
    // Remove the loop seam's step so the wrap does not click.
    const fade = Math.floor(this.ctx.sampleRate * 0.01);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[length - fade + i] = data[length - fade + i]! * (1 - t) + data[i]! * t;
    }
    this.noiseBuffers.set(colour, buffer);
    return buffer;
  }

  /**
   * Sparse grains: a stone flicked against the arch, a raindrop on the roof. Each
   * grain is a sub-millisecond click with its own heavy-tailed amplitude, so most
   * are small and a few are loud, the way real impacts distribute. Played faster
   * it gets denser AND brighter together, which is what a car speeding up on
   * gravel does.
   */
  crackleBuffer(): AudioBuffer {
    if (this.crackleBufferValue) return this.crackleBufferValue;
    const sr = this.ctx.sampleRate;
    const length = Math.floor(sr * CRACKLE_SECONDS);
    const buffer = this.ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);
    const rand = xorshift(0x27d4eb2f);
    const grains = Math.floor(CRACKLE_SECONDS * CRACKLE_DENSITY);
    for (let g = 0; g < grains; g++) {
      const start = Math.floor(((rand() + 1) / 2) * (length - sr * 0.008));
      const u = (rand() + 1) / 2;
      const amp = 0.08 + 0.92 * u ** 4;
      const decay = sr * (0.00025 + 0.0012 * ((rand() + 1) / 2));
      const len = Math.floor(decay * 5);
      for (let i = 0; i < len; i++) {
        data[start + i] = data[start + i]! + rand() * amp * Math.exp(-i / decay);
      }
    }
    this.crackleBufferValue = buffer;
    return buffer;
  }

  /**
   * A looping noise source, already started, decorrelated from every other one: its
   * own start offset and its own rate within ±6%. Callers own the returned node.
   */
  noiseSource(colour: NoiseColour = 'white'): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(colour);
    src.loop = true;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    src.start(0, Math.random() * NOISE_SECONDS);
    return src;
  }

  /** A looping crackle source, already started; `playbackRate` sets grain density. */
  crackleSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.crackleBuffer();
    src.loop = true;
    src.start(0, Math.random() * CRACKLE_SECONDS);
    return src;
  }

  /**
   * Two independent noise loops merged into one stereo signal: a sound that surrounds
   * the listener (wind, rain) instead of sitting as one point between the ears.
   */
  stereoNoise(colour: NoiseColour, sources: AudioBufferSourceNode[]): AudioNode {
    const merger = this.ctx.createChannelMerger(2);
    const left = this.noiseSource(colour);
    const right = this.noiseSource(colour);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    sources.push(left, right);
    return merger;
  }

  /** Stereo crackle, the same idea as `stereoNoise`. */
  stereoCrackle(sources: AudioBufferSourceNode[]): AudioNode {
    const merger = this.ctx.createChannelMerger(2);
    const left = this.crackleSource();
    const right = this.crackleSource();
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    sources.push(left, right);
    return merger;
  }

  /**
   * Open-air impulse response: a sparse cluster of early reflections (ground, a
   * nearby bank) and a diffuse tail that darkens as it decays, because air eats
   * high frequencies with distance. Stereo channels are independent noise.
   */
  private buildReverbImpulse(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const length = Math.floor(sr * REVERB_SECONDS);
    const buffer = this.ctx.createBuffer(2, length, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      const rand = xorshift(0x165667b1 + ch * 0x1000193);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / sr;
        // Low-pass coefficient closes over the tail: bright early, dull late.
        const k = 0.75 * Math.exp(-t * 1.6) + 0.05;
        lp += (rand() - lp) * k;
        const envelope = Math.exp(-t * 2.4) * Math.min(1, t / 0.012);
        data[i] = lp * envelope;
      }
      for (let r = 0; r < 7; r++) {
        const at = Math.floor(sr * (0.018 + ((rand() + 1) / 2) * 0.16));
        data[at] = data[at]! + rand() * 0.6 * Math.exp(-at / sr / 0.12);
      }
    }
    return buffer;
  }

  /**
   * A one-shot noise burst: the workhorse behind every impact, footstep, clunk and
   * gunshot. `attack`/`decay` shape it, the band-pass places it in the spectrum,
   * `delay` starts it later (for layered events), `send` feeds the world reverb.
   */
  burst(
    destination: AudioNode,
    options: {
      gain: number;
      frequency: number;
      q?: number;
      attack?: number;
      decay: number;
      type?: BiquadFilterType;
      colour?: NoiseColour;
      delay?: number;
      /** End frequency of the filter, swept exponentially over the decay. */
      endFrequency?: number;
      send?: number;
    },
  ): void {
    if (!this.running || options.gain <= 0) return;
    const t = this.now + (options.delay ?? 0);
    const buffer = this.noiseBuffer(options.colour);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // Random start offset so repeated bursts (footsteps, gravel) never phase-lock
    // into an audible pattern.
    const attack = options.attack ?? 0.002;
    const offset = Math.random() * (buffer.duration - attack - options.decay - 0.1);

    const filter = this.ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(options.frequency, t);
    if (options.endFrequency !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), t + attack + options.decay);
    }
    filter.Q.value = options.q ?? 1;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(options.gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + options.decay);

    src.connect(filter).connect(env).connect(destination);
    if (options.send) {
      const send = this.ctx.createGain();
      send.gain.value = options.send;
      env.connect(send).connect(this.reverb);
    }
    src.start(t, Math.max(0, offset), attack + options.decay + 0.02);
    src.stop(t + attack + options.decay + 0.05);
  }

  /** A one-shot pitched blip: mechanical clicks, gear engagement, dry-fire, ringing metal. */
  blip(
    destination: AudioNode,
    options: {
      gain: number;
      frequency: number;
      endFrequency?: number;
      decay: number;
      type?: OscillatorType;
      delay?: number;
      send?: number;
    },
  ): void {
    if (!this.running || options.gain <= 0) return;
    const t = this.now + (options.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = options.type ?? 'triangle';
    osc.frequency.setValueAtTime(options.frequency, t);
    if (options.endFrequency !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), t + options.decay);
    }
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(options.gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + options.decay);
    osc.connect(env).connect(destination);
    if (options.send) {
      const send = this.ctx.createGain();
      send.gain.value = options.send;
      env.connect(send).connect(this.reverb);
    }
    osc.start(t);
    osc.stop(t + options.decay + 0.05);
  }

  /**
   * Dev meter: loudness and peak of every bus over the analysers' last window. The
   * taps are made on first call, so a player's game never carries them. Bus levels are
   * after their slider and trim, i.e. as they contribute to the mix.
   */
  meter(): Record<MeterBus, MeterReading> {
    if (!this.meterTaps) {
      const tap = (node: AudioNode): AnalyserNode => {
        const a = this.ctx.createAnalyser();
        a.fftSize = 32768;
        node.connect(a);
        return a;
      };
      this.meterTaps = {
        car: tap(this.car),
        world: tap(this.world),
        traffic: tap(this.traffic),
        game: tap(this.sfx),
        radio: tap(this.radio),
        master: tap(this.master),
        out: tap(this.output),
      };
    }
    const stages = kWeightStages(this.ctx.sampleRate);
    const data = new Float32Array(32768);
    const out = {} as Record<MeterBus, MeterReading>;
    for (const [bus, analyser] of Object.entries(this.meterTaps) as [MeterBus, AnalyserNode][]) {
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      let energy = 0;
      const y = data.slice();
      for (const [b0, b1, b2, a1, a2] of stages) {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < y.length; i++) {
          const v = b0! * y[i]! + b1! * x1 + b2! * x2 - a1! * y1 - a2! * y2;
          x2 = x1;
          x1 = y[i]!;
          y2 = y1;
          y1 = v;
          y[i] = v;
        }
      }
      // Skip the filters' settling at the head of the window.
      for (let i = 2048; i < y.length; i++) energy += y[i]! * y[i]!;
      out[bus] = {
        // The analyser has already downmixed to mono; +3 dB puts a centred stereo
        // signal back where BS.1770's two-channel sum would.
        lufs: -0.691 + 3 + 10 * Math.log10(energy / (y.length - 2048) + 1e-20),
        peakDb: 20 * Math.log10(peak + 1e-12),
      };
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    void this.ctx.close();
  }
}

/** Smoothly drives an AudioParam towards a value; the only way voices set gains. */
export function ramp(param: AudioParam, value: number, now: number, tau = 0.05): void {
  param.setTargetAtTime(value, now, tau);
}

/** A source that moves further than this between two updates is snapped, not glided. */
const PANNER_SNAP_M = 40;

/**
 * Sets a spatial node's position, using the per-axis AudioParams every current
 * desktop and mobile browser ships and falling back to the deprecated
 * `setPosition()` method when they are absent.
 *
 * Some engines (older WebKit builds, embedded/WebView browsers) still implement
 * Web Audio's spatialisation without `PannerNode.positionX` at all, and the type
 * declarations claim it always exists — so reading `undefined.value` there is not
 * a degraded fallback, it is a hard crash the first time any spatial sound plays.
 */
export function setPannerPosition(
  panner: PannerNode,
  x: number,
  y: number,
  z: number,
  now: number,
  tau: number,
): void {
  if (panner.positionX) {
    // A jump no body makes in one frame is the world origin rebasing (or a
    // teleport). The listener snaps with it, so the source must too: gliding the
    // 1000 m back, the car would sit a kilometre from the ear and fall silent.
    const jump = Math.hypot(x - panner.positionX.value, y - panner.positionY.value, z - panner.positionZ.value);
    if (jump > PANNER_SNAP_M) {
      for (const [param, v] of [[panner.positionX, x], [panner.positionY, y], [panner.positionZ, z]] as const) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(v, now);
      }
      return;
    }
    panner.positionX.setTargetAtTime(x, now, tau);
    panner.positionY.setTargetAtTime(y, now, tau);
    panner.positionZ.setTargetAtTime(z, now, tau);
  } else {
    panner.setPosition(x, y, z);
  }
}

/** The context's one `AudioListener` pose, with the same fallback and for the same reason. */
export function setListenerPose(
  listener: AudioListener,
  x: number,
  y: number,
  z: number,
  forwardX: number,
  forwardY: number,
  forwardZ: number,
  upX: number,
  upY: number,
  upZ: number,
): void {
  if (listener.positionX) {
    listener.positionX.value = x;
    listener.positionY.value = y;
    listener.positionZ.value = z;
    listener.forwardX.value = forwardX;
    listener.forwardY.value = forwardY;
    listener.forwardZ.value = forwardZ;
    listener.upX.value = upX;
    listener.upY.value = upY;
    listener.upZ.value = upZ;
  } else {
    listener.setPosition(x, y, z);
    listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
  }
}
