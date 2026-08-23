/**
 * The audio device, and nothing else.
 *
 * Every sound in the game is synthesised at runtime (see vehicleaudio.ts and
 * foley.ts): there is not a single sample file in the project, and the whole
 * soundscape costs a handful of oscillators and one shared noise buffer. That is
 * deliberate — a car engine is a pitch-and-load problem, not a loop-crossfade
 * problem, and a synthesised one tracks rpm exactly instead of stepping between
 * recorded bands.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so the context
 * is created suspended and resumed by the first click/keypress; until then every
 * voice runs into a muted graph rather than being conditionally absent, which
 * keeps the voices free of "is audio up yet" branches.
 */

/** Master ramp time for volume/pause changes, seconds. Short enough to feel instant. */
const MASTER_RAMP = 0.08;
/** Length of the shared white-noise loop, seconds. Long enough to hide the seam. */
const NOISE_SECONDS = 2;

export class AudioMixer {
  readonly ctx: AudioContext;
  /** Procedural game audio (engine, wind, tyres, foley). The radio bypasses this. */
  readonly sfx: GainNode;

  private readonly master: GainNode;
  private noiseBufferValue: AudioBuffer | null = null;
  private volume = 1;
  private suspendedByPause = false;
  private started = false;
  private disposed = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
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

  /** 0..1 master volume for everything on the sfx bus. */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyMasterGain();
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
   * The one white-noise buffer every noise voice loops. Tyres, wind, footsteps and
   * impacts all want band-limited noise, and they differ only in their filters and
   * envelopes — sharing the source keeps the memory cost at a single 2 s buffer.
   */
  noiseBuffer(): AudioBuffer {
    if (this.noiseBufferValue) return this.noiseBufferValue;
    const length = Math.floor(this.ctx.sampleRate * NOISE_SECONDS);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic (xorshift) rather than Math.random: the noise floor is part of
    // how the game sounds, and it should not differ between runs.
    let state = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[i] = ((state >>> 0) / 0xffffffff) * 2 - 1;
    }
    this.noiseBufferValue = buffer;
    return buffer;
  }

  /** A looping noise source, already started. Callers own the returned node. */
  noiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    src.start();
    return src;
  }

  /**
   * A one-shot noise burst: the workhorse behind every impact, footstep, clunk and
   * gunshot. `attack`/`decay` shape it, the band-pass places it in the spectrum.
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
    },
  ): void {
    if (!this.running || options.gain <= 0) return;
    const t = this.now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    // Random start offset so repeated bursts (footsteps, gravel) never phase-lock
    // into an audible pattern.
    const offset = Math.random() * (this.noiseBuffer().duration - options.decay - 0.05);

    const filter = this.ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.value = options.frequency;
    filter.Q.value = options.q ?? 1;

    const env = this.ctx.createGain();
    const attack = options.attack ?? 0.002;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(options.gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + options.decay);

    src.connect(filter).connect(env).connect(destination);
    src.start(t, Math.max(0, offset), attack + options.decay + 0.02);
    src.stop(t + attack + options.decay + 0.05);
  }

  /** A one-shot pitched blip: mechanical clicks, gear engagement, dry-fire. */
  blip(
    destination: AudioNode,
    options: { gain: number; frequency: number; endFrequency?: number; decay: number; type?: OscillatorType },
  ): void {
    if (!this.running || options.gain <= 0) return;
    const t = this.now;
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
    osc.start(t);
    osc.stop(t + options.decay + 0.05);
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
