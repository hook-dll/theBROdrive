/**
 * Interface sounds: the small tonal family the menus speak in, and its own bus.
 *
 * Every navigation event is audible — a focus move, a value step, a slider tick, a
 * confirm, a back, a panel opening or closing, the gong that commits a drive, and the
 * dull thud of a refusal — because a menu that clicks silently reads as a prototype.
 *
 * Synthesised, not sampled, like the rest of the game (see mixer.ts): the project ships
 * no sample files, so there is no bank to load before the title screen can click, and
 * a dozen voices cover a family this small. It also lets the bank answer on the frame
 * of the key that caused it, with no decode on a cold cache.
 *
 * The level is the player's own `uiVolume` setting, written to this bank's gain node and
 * to nothing else. The bank owns its context and its compressor instead of being routed
 * through AudioMixer, because the title screen exists before the game audio does —
 * turning the engine down must not turn the menus down.
 */

/** Level before the settings module pushes `uiVolume`, and the ramp (seconds) level and mute fade with. */
const DEFAULT_VOLUME = 0.6;
const VOLUME_RAMP = 0.06;

/**
 * The bank's own ceiling: a held slider or a spun enum can fire `tick()` dozens of times
 * a second, and stacked blips are the one place menu audio clips. A fast compressor lets
 * a single sound through untouched and pulls the pile down. Threshold, knee, ratio, then
 * attack and release in seconds.
 */
const COMP_THRESHOLD_DB = -10;
const COMP_KNEE_DB = 12;
const COMP_RATIO = 8;
const COMP_ATTACK = 0.002;
const COMP_RELEASE = 0.12;

/** Length of the shared noise buffer, seconds. Long enough that each burst starts elsewhere in it. */
const NOISE_SECONDS = 0.5;

/** Attack of every mallet voice, seconds: quick enough to be a strike, slow enough not to click. */
const MALLET_ATTACK = 0.003;
/** The click transient: level relative to the body it decorates, then its static band, Q and length. */
const CLICK_GAIN_RATIO = 0.62;
const CLICK_HZ = 2100;
const CLICK_Q = 2.4;
const CLICK_DECAY = 0.022;
/** Low-pass Q for the deliberately dull voices: a gentle corner, not a resonant one. */
const TONE_Q = 0.7;

/**
 * The two-note gestures: the root note both start on (Hz), the gap before the second note
 * (seconds), and its level and decay. A perfect fifth is consonant on its own, so the rise
 * needs no third note to sound finished, and inverting it is the same gesture cancelled.
 */
const TWO_NOTE_HZ = 320;
const TWO_NOTE_GAP = 0.055;
const TWO_NOTE_GAIN = 0.16;
const TWO_NOTE_DECAY = 0.14;
const FIFTH_UP = 1.5;
const FIFTH_DOWN = 2 / 3;

/** The swish voice: a broad band (Q 0.9) swept between its two frequencies, 12 ms in, 130 ms out. */
const SWISH_LOW_HZ = 420;
const SWISH_HIGH_HZ = 2600;
const SWISH_GAIN = 0.16;
const SWISH_ATTACK = 0.004;
const SWISH_DECAY = 0.1;
const SWISH_Q = 0.6;

/**
 * The committing gong: a 98 Hz carrier frequency-modulated at 2.01x with a peak deviation of
 * 3.5x the carrier, collapsing in 90 ms — the metallic strike — then ringing out 500 ms.
 */
const GENERATE_HZ = 74;
const GENERATE_MOD_RATIO = 2.01;
const GENERATE_INDEX = 2.2;
const GENERATE_STRIKE = 0.09;
const GENERATE_ATTACK = 0.006;
const GENERATE_TAIL = 0.34;
const GENERATE_GAIN = 0.2;

/** One struck mallet voice: a pitched body, optionally with a click transient over it. */
type MalletVoice = {
  hz: number;
  /** Pitch to glide to across the decay; omit for a steady blip. */
  endHz?: number;
  gain: number;
  decay: number;
  /** Add the short filtered-noise transient that makes a blip read as a struck object. */
  click?: boolean;
  /** Low-pass corner (Hz) for a deliberately dull voice, such as the refusal. */
  tone?: number;
  /** Seconds from now to start; this is how a two-note gesture spaces its notes. */
  delay?: number;
};

/** One noise voice: the click under a mallet, or the air of a swish. */
type NoiseVoice = {
  gain: number;
  /** Band centre at the start of the burst, Hz. */
  hz: number;
  /** Band centre at the end of the burst; omit for a band that does not move. */
  endHz?: number;
  attack: number;
  decay: number;
  q: number;
  delay?: number;
};

/**
 * The mallet voices, quietest first: focus move, the two step directions, the slider detent at
 * two pitches, and the refusal, whose low-pass takes all the bite out of it.
 */
const MOVE: MalletVoice = { hz: 900, gain: 0.075, decay: 0.05, click: true };
const STEP_UP: MalletVoice = { hz: 1180, endHz: 1320, gain: 0.09, decay: 0.05, click: true };
const STEP_DOWN: MalletVoice = { hz: 940, endHz: 820, gain: 0.09, decay: 0.05, click: true };
const TICK: MalletVoice = { hz: 1450, gain: 0.045, decay: 0.035, click: true };
const TICK_ALT: MalletVoice = { ...TICK, hz: 1680 };
const DUD: MalletVoice = { hz: 190, endHz: 118, gain: 0.17, decay: 0.22, tone: 300 };

export class UiSounds {
  private ctx: AudioContext | null = null;
  /** The UI bus: every voice ends here, and the only gain `setVolume` touches. */
  private output: GainNode | null = null;
  /** Shared white noise, created with the context and reused by every click and swish. */
  private noise: AudioBuffer | null = null;

  private volume = DEFAULT_VOLUME;
  private enabled = true;
  private unlocked = false;
  /** No WebAudio here, or a context that was refused. Set once, never retried. */
  private unavailable = false;
  private disposed = false;
  /** Which of the two tick pitches is next; see TICK_ALT. */
  private tickHigh = false;

  constructor() {
    // Capture phase on purpose: the gesture has to be recorded before the menu handler
    // that is about to ask for the first sound, or the first click is the silent one.
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
  }

  /** The first user gesture is the only moment a browser lets a context start; one is enough. */
  private unlock = (): void => {
    this.unlocked = true;
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
    // A context suspended later (tab switch, phone call) may only resume inside a gesture.
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  };

  /** Removes the unlock listeners and closes the context, if one was ever built. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
    const ctx = this.ctx;
    this.ctx = null;
    this.output = null;
    this.noise = null;
    // Closing rejects if the context never ran; the bank is inert either way.
    if (ctx) void ctx.close().catch(() => undefined);
  }

  /** 0..1 level for the whole bank. Recorded before the context exists, applied to it after. */
  setVolume(volume01: number): void {
    const volume = Number.isFinite(volume01) ? Math.min(1, Math.max(0, volume01)) : this.volume;
    if (volume === this.volume) return;
    this.volume = volume;
    this.applyVolume();
  }

  /**
   * Silence or restore the bank. A mute, not a teardown: the context stays up so unmuting is
   * instant, and the bus ramps rather than stepping, because a stepped gain is a click in the
   * one bank that must never click.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.applyVolume();
  }

  /** Focus moved up or down a list: one short tap, the quietest sound in the bank. */
  move(): void {
    this.blip(MOVE);
  }

  /** One value step. Up glides upwards and sits above `MOVE`; down glides down and below it. */
  step(up: boolean): void {
    this.blip(up ? STEP_UP : STEP_DOWN);
  }

  /** A slider detent. Fires often, so it is the smallest and highest voice, alternating pitch. */
  tick(): void {
    this.tickHigh = !this.tickHigh;
    this.blip(this.tickHigh ? TICK : TICK_ALT);
  }

  /** The default action: two notes a fifth apart, rising. The loudest of the short sounds. */
  confirm(): void {
    this.twoNote(FIFTH_UP);
  }

  /** Cancelled, or one level up: the same two notes with the interval inverted. */
  back(): void {
    this.twoNote(FIFTH_DOWN);
  }

  /** A panel or screen opened: a band sweeping dark to bright, like air let in. */
  open(): void {
    this.swish(SWISH_LOW_HZ, SWISH_HIGH_HZ);
  }

  /** A panel closed: the same swish with the sweep reversed, so the pair is unmistakable. */
  close(): void {
    this.swish(SWISH_HIGH_HZ, SWISH_LOW_HZ);
  }

  /** Committing: a drive actually starts. A soft low gong with a tail, the one slow sound here. */
  generate(): void {
    const ctx = this.ensure();
    const output = this.output;
    if (!ctx || !output) return;
    const t = ctx.currentTime;

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(GENERATE_HZ, t);

    // Frequency modulation rather than a second voice: the strike is the modulator's depth,
    // and because only the depth collapses the pitch never wobbles — the brightness changes
    // and nothing else, which is how a struck metal body behaves.
    const modulator = ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = GENERATE_HZ * GENERATE_MOD_RATIO;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(GENERATE_HZ * GENERATE_INDEX, t);
    depth.gain.exponentialRampToValueAtTime(0.001, t + GENERATE_STRIKE);
    modulator.connect(depth).connect(carrier.frequency);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(GENERATE_GAIN, t + GENERATE_ATTACK);
    env.gain.exponentialRampToValueAtTime(0.0001, t + GENERATE_ATTACK + GENERATE_TAIL);
    carrier.connect(env).connect(output);

    carrier.start(t);
    modulator.start(t);
    modulator.stop(t + GENERATE_STRIKE + 0.05);
    carrier.stop(t + GENERATE_ATTACK + GENERATE_TAIL + 0.05);
  }

  /** Refused: an unavailable option, or input the game will not take. Low, short and dull. */
  dud(): void {
    this.blip(DUD);
  }

  /** Two notes from one gesture: the root, then the interval, `ratio` above or below it. */
  private twoNote(ratio: number): void {
    const root: MalletVoice = { hz: TWO_NOTE_HZ, gain: TWO_NOTE_GAIN, decay: TWO_NOTE_DECAY };
    this.blip(root);
    this.blip({ ...root, hz: TWO_NOTE_HZ * ratio, delay: TWO_NOTE_GAP });
  }

  /** Open and close are one swish with its band swept in opposite directions. */
  private swish(fromHz: number, toHz: number): void {
    this.noiseBurst({
      gain: SWISH_GAIN,
      hz: fromHz,
      endHz: toHz,
      attack: SWISH_ATTACK,
      decay: SWISH_DECAY,
      q: SWISH_Q,
    });
  }

  /**
   * A struck "felt mallet" note: a triangle body with a fast attack and an exponential release,
   * optionally dulled by a low-pass, plus a short filtered-noise transient when the sound should
   * read as a click.
   */
  private blip(voice: MalletVoice): void {
    const ctx = this.ensure();
    const output = this.output;
    if (!ctx || !output) return;
    const t = ctx.currentTime + (voice.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(voice.hz, t);
    if (voice.endHz !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.endHz), t + voice.decay);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(voice.gain, t + MALLET_ATTACK);
    env.gain.exponentialRampToValueAtTime(0.0001, t + MALLET_ATTACK + voice.decay);

    if (voice.tone === undefined) {
      osc.connect(env).connect(output);
    } else {
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = voice.tone;
      tone.Q.value = TONE_Q;
      osc.connect(tone).connect(env).connect(output);
    }

    osc.start(t);
    osc.stop(t + MALLET_ATTACK + voice.decay + 0.05);

    if (voice.click) {
      this.noiseBurst({
        gain: voice.gain * CLICK_GAIN_RATIO,
        hz: CLICK_HZ,
        attack: MALLET_ATTACK,
        decay: CLICK_DECAY,
        q: CLICK_Q,
        delay: voice.delay,
      });
    }
  }

  /**
   * A one-shot noise voice: the click under a mallet and the air of a swish. The band can sweep,
   * which is what makes open and close opposites out of one buffer.
   */
  private noiseBurst(voice: NoiseVoice): void {
    const ctx = this.ensure();
    const output = this.output;
    if (!ctx || !output) return;
    const buffer = this.noiseBuffer(ctx);
    const t = ctx.currentTime + (voice.delay ?? 0);
    const length = voice.attack + voice.decay;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(voice.hz, t);
    if (voice.endHz !== undefined) {
      band.frequency.exponentialRampToValueAtTime(Math.max(40, voice.endHz), t + length);
    }
    band.Q.value = voice.q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(voice.gain, t + voice.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(band).connect(env).connect(output);

    // A random offset stops the tick of a drag, or the same swish twice, phase-locking into one
    // recurring colour. It is the only randomness in the bank.
    const offset = Math.random() * Math.max(0, buffer.duration - length - 0.05);
    src.start(t, offset, length + 0.02);
    src.stop(t + length + 0.05);
  }

  /**
   * The context, built on the first sound asked for after a user gesture.
   *
   * Returns null — and therefore every voice returns without doing anything — before that
   * gesture, in a browser with no WebAudio, after a refused context, and once disposed. That
   * is the whole "is audio up yet" story: no voice contains such a branch.
   */
  private ensure(): AudioContext | null {
    if (this.disposed || this.unavailable || !this.enabled) return null;
    if (!this.ctx) {
      if (!this.unlocked) return null;
      if (typeof AudioContext === 'undefined') {
        this.unavailable = true;
        return null;
      }
      this.build();
    }
    const ctx = this.ctx;
    if (!ctx) return null;
    // A suspended context needs a gesture to resume, and this call is made from whatever
    // sound that gesture just triggered, which is inside one.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  /** Creates the context and the bus, or gives up on WebAudio for the rest of the session. */
  private build(): void {
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const output = ctx.createGain();
      // Opened straight at the stored level: nothing is sounding yet, so there is no step to
      // hear either way, and ramping from zero would fade in the first sound of the session.
      // Every change to this gain afterwards is a ramp (see applyVolume), the only place a
      // step would be audible.
      output.gain.value = this.volume;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = COMP_THRESHOLD_DB;
      compressor.knee.value = COMP_KNEE_DB;
      compressor.ratio.value = COMP_RATIO;
      compressor.attack.value = COMP_ATTACK;
      compressor.release.value = COMP_RELEASE;
      output.connect(compressor).connect(ctx.destination);
      this.ctx = ctx;
      this.output = output;
    } catch {
      // A context can be refused: no output device, too many contexts, an embedded browser.
      // The menus carry on and stay silent, and nothing is retried.
      this.unavailable = true;
      this.ctx = null;
      this.output = null;
    }
  }

  /**
   * Writes the current level to the bus. The mute ramps for the same reason the level does:
   * any step in the gain is a click.
   */
  private applyVolume(): void {
    const ctx = this.ctx;
    const output = this.output;
    if (!ctx || !output) return;
    output.gain.cancelScheduledValues(ctx.currentTime);
    output.gain.setTargetAtTime(this.enabled ? this.volume : 0, ctx.currentTime, VOLUME_RAMP);
  }

  /**
   * The one white-noise buffer this bank slices. Clicks, swishes and the tick all want
   * band-limited noise and differ only in their bands and envelopes, so one shared buffer
   * costs far less than one per voice.
   */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic (xorshift) rather than Math.random, like mixer.ts: the noise floor is part
    // of how the game sounds, so it should not change between runs.
    let state = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[i] = ((state >>> 0) / 0xffffffff) * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }
}
