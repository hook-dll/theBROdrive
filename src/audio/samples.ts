/**
 * Recorded sounds, and the few ways the game plays them.
 *
 * THE SPLIT. What follows a continuous number exactly — the engine's rpm, the gear
 * mesh, the brake rub — stays synthesised: a recording can only step between takes.
 * What is a THING in the world — thunder, rain, wind in grass, birds, insects, stones
 * under a tyre, a door, a footstep, a shot — is recorded: every synthesis of those is
 * heard as a synthesiser. The recordings are CC0 (public/audio/CREDITS.md), cut and
 * levelled by tools/sound/build.mjs into small mono Ogg Opus files, and given their
 * width, distance and variety here, at play time.
 *
 * LOADING. Nothing is fetched until a voice first asks for it, so a clear day never
 * downloads a thunderstorm. Until a buffer has arrived the voice is simply silent: every
 * caller treats "not loaded yet" as "not audible yet", never as an error.
 */

import type { AudioMixer } from './mixer';
import { ramp } from './mixer';

/** Every recording the game ships. Keep in step with tools/sound/manifest.json. */
export type SampleName =
  | 'thunder-near-1' | 'thunder-near-2' | 'thunder-near-3'
  | 'thunder-far-1' | 'thunder-far-2' | 'thunder-far-3' | 'thunder-far-4'
  | 'rain' | 'rain-roof' | 'wind-grass' | 'wind-strong'
  | 'grasshoppers' | 'crickets-night'
  | 'raven' | 'hawk' | 'sparrow' | 'swallows'
  | 'flock-1' | 'flock-2'
  | 'gravel-roll' | 'skid'
  | 'crash-1' | 'crash-2' | 'crash-3'
  | 'door-open' | 'door-close'
  | 'step-gravel' | 'step-soft' | 'step-hard'
  | 'rifle' | 'shotgun' | 'bolt' | 'shutter'
  | 'handbrake-on' | 'handbrake-off';

const BASE = `${import.meta.env.BASE_URL}audio/`;

export class SampleBank {
  private readonly buffers = new Map<SampleName, AudioBuffer>();
  private readonly pending = new Map<SampleName, Promise<AudioBuffer | null>>();
  /** Slices (onset, length) of a take holding several hits, e.g. footsteps. */
  private readonly slices = new Map<SampleName, readonly [number, number][]>();

  constructor(private readonly ctx: BaseAudioContext) {}

  /** The buffer if it has arrived; otherwise starts fetching it and returns null. */
  get(name: SampleName): AudioBuffer | null {
    const buffer = this.buffers.get(name);
    if (buffer) return buffer;
    void this.load(name);
    return null;
  }

  load(name: SampleName): Promise<AudioBuffer | null> {
    const existing = this.pending.get(name);
    if (existing) return existing;
    const promise = fetch(`${BASE}${name}.ogg`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buffer) => {
        this.buffers.set(name, buffer);
        return buffer;
      })
      .catch((error: unknown) => {
        console.warn(`sound ${name} failed to load`, error);
        return null;
      });
    this.pending.set(name, promise);
    return promise;
  }

  /**
   * Hits inside a take of several (footsteps, caws): onsets found once from the
   * envelope, each running to the next onset. A take is cut by tools/sound/build.mjs
   * with silence between hits, so a simple threshold finds them.
   */
  hits(name: SampleName): readonly [number, number][] | null {
    const cached = this.slices.get(name);
    if (cached) return cached;
    const buffer = this.get(name);
    if (!buffer) return null;
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const hop = Math.floor(sr * 0.005);
    const env: number[] = [];
    let peak = 0;
    for (let s = 0; s + hop <= data.length; s += hop) {
      let e = 0;
      for (let i = s; i < s + hop; i++) e = Math.max(e, Math.abs(data[i]!));
      env.push(e);
      peak = Math.max(peak, e);
    }
    const on = peak * 0.25;
    const off = peak * 0.02;
    const onsets: number[] = [];
    let armed = true;
    let quiet = 0;
    env.forEach((e, i) => {
      if (armed && e > on) {
        // Back up to where this hit starts rising, so its attack is not clipped.
        let j = i;
        while (j > 0 && env[j - 1]! > off && i - j < 8) j--;
        onsets.push((j * hop) / sr);
        armed = false;
        quiet = 0;
      } else if (!armed) {
        quiet = e < off ? quiet + 1 : 0;
        // Re-arm after 180 ms of quiet: build.mjs lays 250 ms of silence between hits,
        // while a long call (a hawk's scream) has shorter dips inside it.
        if (quiet > 36) armed = true;
      }
    });
    const slices = onsets.map((t, i): [number, number] => [t, (onsets[i + 1] ?? buffer.duration) - t]);
    this.slices.set(name, slices);
    return slices;
  }
}

/**
 * A recorded bed that runs for as long as the voice exists: a loop played at a random
 * point, twice, a few seconds apart and panned apart, so a mono take becomes a wide
 * one and nothing in it repeats in step. `gain` is driven by the caller.
 */
export class Bed {
  readonly gain: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private started = false;
  private rate = 1;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SampleBank,
    private readonly name: SampleName,
    destination: AudioNode,
    private readonly width = 0.7,
  ) {
    this.gain = mixer.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(destination);
  }

  /** Sets the level; starts the loop on the first audible call once it has loaded. */
  set(level: number, now: number, tau: number): void {
    if (!this.started && level > 0.0005) this.start();
    ramp(this.gain.gain, level, now, tau);
  }

  /** Playback rate of both layers: a denser, brighter bed when > 1. */
  setRate(rate: number, now: number, tau = 0.1): void {
    this.rate = rate;
    for (const src of this.sources) src.playbackRate.setTargetAtTime(rate, now, tau);
  }

  private start(): void {
    const buffer = this.bank.get(this.name);
    if (!buffer) return;
    this.started = true;
    const ctx = this.mixer.ctx;
    for (const side of [-1, 1]) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = this.rate * (1 + side * 0.012);
      const pan = new StereoPannerNode(ctx, { pan: side * this.width });
      src.connect(pan).connect(this.gain);
      src.start(0, Math.random() * buffer.duration);
      this.sources.push(src);
    }
  }

  dispose(): void {
    for (const src of this.sources) src.stop();
    this.sources = [];
    this.gain.disconnect();
  }
}

/**
 * Plays one recorded sound (or one hit of a take) once. Returns false if it has not
 * loaded yet. `rate` shifts pitch and speed together, the cheapest honest variation
 * a recording has; `detune` is a random spread around it.
 */
export function playOnce(
  mixer: AudioMixer,
  bank: SampleBank,
  name: SampleName,
  destination: AudioNode,
  options: {
    gain: number;
    rate?: number;
    spread?: number;
    delay?: number;
    pan?: number;
    /** Low-pass corner, Hz, for distance or a closed cabin. */
    lowpass?: number;
    send?: number;
    /** Play one hit of a multi-hit take (see SampleBank.hits), chosen at random. */
    hit?: boolean;
    offset?: number;
    duration?: number;
  },
): boolean {
  const buffer = bank.get(name);
  if (!buffer || !mixer.running || options.gain <= 0) return false;
  const ctx = mixer.ctx;
  const t = mixer.now + (options.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = (options.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (options.spread ?? 0));
  let node: AudioNode = src;
  if (options.lowpass !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = options.lowpass;
    lp.Q.value = 0.6;
    node = node.connect(lp);
  }
  const level = ctx.createGain();
  level.gain.value = options.gain;
  node = node.connect(level);
  if (options.pan !== undefined) node = node.connect(new StereoPannerNode(ctx, { pan: options.pan }));
  node.connect(destination);
  if (options.send) {
    const send = ctx.createGain();
    send.gain.value = options.send;
    level.connect(send).connect(mixer.reverb);
  }
  let offset = options.offset ?? 0;
  let duration = options.duration;
  if (options.hit) {
    const hits = bank.hits(name);
    if (hits && hits.length > 0) {
      const [at, length] = hits[Math.floor(Math.random() * hits.length)]!;
      offset = at;
      duration = length;
    }
  }
  if (duration !== undefined) {
    // A short fade at the cut, so a hit taken from a take never ends in a click.
    const end = t + duration / src.playbackRate.value;
    level.gain.setValueAtTime(options.gain, Math.max(t, end - 0.02));
    level.gain.linearRampToValueAtTime(0, end);
    src.start(t, offset, duration + 0.01);
  } else {
    src.start(t, offset);
  }
  src.onended = () => level.disconnect();
  return true;
}
