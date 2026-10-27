/**
 * Music from other cars' cabins, heard through their shut windows.
 *
 * A third of the traffic has something playing: the thump of a dance track, an
 * accordion waltz, somebody's tape of estrada, a talk station. From outside a closed
 * car none of it is music any more, only its bottom octaves and its beat, so the loops
 * are made that way: short (4-8 s), mono, at 16 kHz, each a few bars of a style built
 * from oscillators and noise, and the car's shell baked in (two low-passes at 420-700
 * Hz, a cabin boom at 110 Hz and a soft saturation of the little speakers). Nothing is
 * loaded: `CabinMusic` renders the eight with OfflineAudioContext at startup, one after
 * another, off the main thread (about 3 MB of samples).
 *
 * SEAMLESS. Every sound is a note started and ended inside the pattern, so the pattern
 * is time-invariant. Each loop is rendered twice over and the SECOND pass kept: it
 * already carries the first pass's tails, exactly what its own end hands to its start
 * when it loops, and every filter has settled. No crossfade.
 *
 * Which car plays what is fixed by its id (`cabinMusicFor`); trafficaudio.ts plays it
 * through the car's own voice, before its panner.
 */

/** The loops' sample rate: the shell leaves nothing above a couple of kHz. */
const LOOP_RATE = 16000;
/** Every loop's RMS after rendering (-18 dBFS); peaks are held under `LOOP_PEAK`. */
const LOOP_RMS = 0.125;
const LOOP_PEAK = 0.95;
/** Share of cars with music playing. */
const MUSIC_SHARE = 0.35;

type Vowel = 'a' | 'o' | 'u' | 'e' | 'm';
/** First three formants, Hz, of a male voice; `m` is a hum through the nose. */
const FORMANTS: Record<Vowel, readonly [number, number, number]> = {
  a: [750, 1150, 2600],
  o: [500, 850, 2500],
  u: [350, 650, 2400],
  e: [520, 1750, 2500],
  m: [260, 1100, 2300],
};
const VOWELS: readonly Vowel[] = ['a', 'o', 'u', 'e'];

function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Schedules one pass of a loop's pattern from `t0`, in beats of `beat` seconds. */
class Notes {
  constructor(
    private readonly ctx: OfflineAudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly t0: number,
    readonly beat: number,
  ) {}

  private at(beats: number): number {
    return this.t0 + beats * this.beat;
  }

  /** A gain with a linear attack, a hold to `len` and a release after it. */
  private envelope(t: number, attack: number, len: number, release: number, peak: number): GainNode {
    const g = new GainNode(this.ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, len));
    g.gain.linearRampToValueAtTime(0, t + Math.max(attack, len) + release);
    g.connect(this.out);
    return g;
  }

  /** A bass drum: a sine falling from `from` to `to` Hz, dying over `decay` s. */
  kick(beat: number, gain = 1, from = 110, to = 45, decay = 0.3): void {
    const t = this.at(beat);
    const osc = new OscillatorNode(this.ctx, { frequency: from });
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.08);
    const g = new GainNode(this.ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay / 3);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + decay * 2.5);
  }

  /** A snare or clap: a noise burst round `tone` Hz over a short body. */
  snare(beat: number, gain = 0.4, decay = 0.13, tone = 1500): void {
    const t = this.at(beat);
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise, loop: true });
    const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: tone, Q: 0.8 });
    const g = new GainNode(this.ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, decay / 3);
    src.connect(band).connect(g).connect(this.out);
    src.start(t, 0.37);
    src.stop(t + decay * 2.5);
    const body = new OscillatorNode(this.ctx, { frequency: 185 });
    const bg = new GainNode(this.ctx, { gain: 0 });
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(gain * 0.6, t + 0.002);
    bg.gain.setTargetAtTime(0, t + 0.002, 0.025);
    body.connect(bg).connect(this.out);
    body.start(t);
    body.stop(t + 0.2);
  }

  /** One bass note, `len` beats long, through its own low-pass. */
  bass(beat: number, len: number, midi: number, gain = 0.5, type: OscillatorType = 'sawtooth', cutoff = 380): void {
    const t = this.at(beat);
    const d = len * this.beat;
    const osc = new OscillatorNode(this.ctx, { type, frequency: hz(midi) });
    const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: cutoff, Q: 1.2 });
    osc.connect(lp).connect(this.envelope(t, 0.006, d - 0.04, 0.04, gain));
    osc.start(t);
    osc.stop(t + d + 0.05);
  }

  /**
   * A chord, each note two oscillators `detune` cents apart (an accordion's wet
   * tuning, a brass section's spread); `tremolo` Hz shakes it like bellows.
   */
  chord(
    beat: number,
    len: number,
    midis: readonly number[],
    { gain = 0.08, type = 'sawtooth' as OscillatorType, attack = 0.01, release = 0.08, detune = 7, tremolo = 0 } = {},
  ): void {
    const t = this.at(beat);
    const d = len * this.beat;
    const env = this.envelope(t, attack, d - release, release, 1);
    let into: AudioNode = env;
    const stop = t + d + release + 0.02;
    if (tremolo > 0) {
      const shake = new GainNode(this.ctx, { gain: 0.85 });
      const lfo = new OscillatorNode(this.ctx, { frequency: tremolo });
      const depth = new GainNode(this.ctx, { gain: 0.15 });
      lfo.connect(depth).connect(shake.gain);
      shake.connect(env);
      lfo.start(t);
      lfo.stop(stop);
      into = shake;
    }
    for (const midi of midis) {
      for (const cents of [-detune, detune]) {
        const osc = new OscillatorNode(this.ctx, { type, frequency: hz(midi), detune: cents });
        const g = new GainNode(this.ctx, { gain });
        osc.connect(g).connect(into);
        osc.start(t);
        osc.stop(stop);
      }
    }
  }

  /** A sung note: a buzz with vibrato through the vowel's three formants. */
  sing(beat: number, len: number, midi: number, vowel: Vowel, gain = 0.45): void {
    this.voice(this.at(beat), len * this.beat, hz(midi), hz(midi), vowel, gain, 5.3, 0.06, 0.12);
  }

  /** A spoken syllable: no vibrato, the pitch sliding from `f0` to `f1`, a short burst before it. */
  syllable(t: number, len: number, f0: number, f1: number, vowel: Vowel, gain: number, consonant: boolean): void {
    const at = this.t0 + t;
    if (consonant) {
      const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise, loop: true });
      const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: 2400, Q: 1 });
      src.connect(band).connect(this.envelope(at - 0.03, 0.004, 0.02, 0.01, gain * 0.5));
      src.start(at - 0.03, 1.1 + (t % 1));
      src.stop(at + 0.01);
    }
    this.voice(at, len, f0, f1, vowel, gain, 0, 0.02, 0.04);
  }

  private voice(t: number, d: number, f0: number, f1: number, vowel: Vowel, gain: number, vibratoHz: number, attack: number, release: number): void {
    const osc = new OscillatorNode(this.ctx, { type: 'sawtooth', frequency: f0 });
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f1, t + d);
    const stop = t + d + release + 0.02;
    if (vibratoHz > 0) {
      const lfo = new OscillatorNode(this.ctx, { frequency: vibratoHz });
      const depth = new GainNode(this.ctx, { gain: f0 * 0.007 });
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(stop);
    }
    const env = this.envelope(t, attack, d - release, release, gain);
    const [f1Hz, f2Hz, f3Hz] = FORMANTS[vowel];
    for (const [f, level, bw] of [[f1Hz, 1, 90], [f2Hz, 0.5, 110], [f3Hz, 0.25, 150]] as const) {
      const band = new BiquadFilterNode(this.ctx, { type: 'bandpass', frequency: f, Q: f / bw });
      const g = new GainNode(this.ctx, { gain: level * 4 });
      osc.connect(band).connect(g).connect(env);
    }
    osc.start(t);
    osc.stop(stop);
  }
}

export interface CabinLoopSpec {
  readonly name: string;
  readonly bpm: number;
  readonly beats: number;
  /** The shell's low-pass corner, Hz. */
  readonly cutoffHz: number;
  /** A small radio's band: nothing under 250 Hz. */
  readonly radio?: boolean;
  /** Level into the speakers' saturation. */
  readonly drive: number;
  readonly build: (n: Notes) => void;
}

/** The loops, in the order `cabinMusicFor` indexes them. */
export const CABIN_LOOPS: readonly CabinLoopSpec[] = [
  {
    // Four on the floor: the «тумц-тумц» from a passing car at night.
    name: 'tumts',
    bpm: 128,
    beats: 16,
    cutoffHz: 520,
    drive: 0.9,
    build(n) {
      const roots = [33, 33, 29, 31];
      for (let b = 0; b < 16; b++) {
        n.kick(b, 1);
        if (b % 2 === 1) n.snare(b, 0.3, 0.1, 1300);
        n.bass(b + 0.5, 0.42, roots[b >> 2]!, 0.55, 'sawtooth', 300);
      }
      for (let bar = 0; bar < 4; bar++) n.chord(bar * 4 + 1.5, 0.35, [roots[bar]! + 24, roots[bar]! + 27, roots[bar]! + 31], { gain: 0.05, type: 'square' });
    },
  },
  {
    // A slow chanson waltz: oom-pah-pah under an accordion with the bellows shaking.
    name: 'chanson',
    bpm: 100,
    beats: 12,
    cutoffHz: 650,
    drive: 0.8,
    build(n) {
      const bass = [45, 38, 40, 45];
      const chords = [[57, 60, 64], [57, 62, 65], [56, 59, 62, 64], [57, 60, 64]];
      for (let bar = 0; bar < 4; bar++) {
        n.bass(bar * 3, 0.9, bass[bar]!, 0.5, 'triangle', 500);
        for (const pah of [1, 2]) n.chord(bar * 3 + pah, 0.5, chords[bar]!, { gain: 0.05, detune: 12 });
      }
      const tune: readonly (readonly [number, number, number])[] = [
        [0, 1.5, 64], [1.5, 0.5, 65], [2, 1, 64],
        [3, 1.5, 62], [4.5, 0.5, 64], [5, 1, 65],
        [6, 1, 68], [7, 1, 71], [8, 1, 68],
        [9, 2, 69], [11, 1, 64],
      ];
      for (const [b, len, midi] of tune) n.chord(b, len, [midi], { gain: 0.09, type: 'square', detune: 12, tremolo: 5.5, attack: 0.03 });
    },
  },
  {
    // Somebody singing along: a hummed, sung line over a soft pad.
    name: 'hum',
    bpm: 80,
    beats: 8,
    cutoffHz: 600,
    drive: 0.8,
    build(n) {
      n.chord(0, 4, [48, 55, 64], { gain: 0.05, type: 'triangle', attack: 0.3, release: 0.4 });
      n.chord(4, 4, [45, 52, 60], { gain: 0.05, type: 'triangle', attack: 0.3, release: 0.4 });
      n.bass(0, 3.9, 36, 0.3, 'sine', 300);
      n.bass(4, 3.9, 33, 0.3, 'sine', 300);
      const line: readonly (readonly [number, number, number, Vowel])[] = [
        [0, 1.5, 64, 'm'], [1.5, 0.5, 67, 'o'], [2, 2, 69, 'a'], [4, 1, 67, 'o'], [5, 1, 64, 'u'], [6, 1.8, 62, 'm'],
      ];
      for (const [b, len, midi, vowel] of line) n.sing(b, len, midi, vowel, 0.5);
    },
  },
  {
    // 80s synth-pop: an octave-jumping bass in eighths, a big gated snare.
    name: 'synthpop',
    bpm: 116,
    beats: 8,
    cutoffHz: 560,
    drive: 0.9,
    build(n) {
      for (let b = 0; b < 8; b++) {
        if (b % 2 === 0) n.kick(b, 0.9);
        else n.snare(b, 0.45, 0.22, 1200);
      }
      for (let e = 0; e < 16; e++) {
        const root = e < 8 ? 28 : e < 12 ? 24 : 26;
        n.bass(e / 2, 0.45, root + (e % 2 === 1 ? 12 : 0), 0.4, 'square', 500);
      }
      n.chord(0, 4, [52, 55, 59], { gain: 0.035, attack: 0.05, release: 0.1 });
      n.chord(4, 2, [48, 52, 55], { gain: 0.035, attack: 0.05, release: 0.1 });
      n.chord(6, 2, [50, 54, 57], { gain: 0.035, attack: 0.05, release: 0.1 });
    },
  },
  {
    // A talk station: a man's voice, phrases and pauses, through a small speaker.
    name: 'talk',
    bpm: 60,
    beats: 6,
    cutoffHz: 700,
    radio: true,
    drive: 0.8,
    build(n) {
      const rand = mulberry(0x7a1c3e55);
      for (const [start, end] of [[0.15, 2.6], [3.15, 5.55]] as const) {
        let t = start;
        while (t < end - 0.15) {
          const along = (t - start) / (end - start);
          const f0 = 138 - 34 * along + (rand() - 0.5) * 16;
          const len = 0.1 + rand() * 0.13;
          const vowel = VOWELS[Math.floor(rand() * VOWELS.length)]!;
          n.syllable(t, len, f0, f0 * (0.93 + rand() * 0.05), vowel, 0.5 + rand() * 0.3, rand() < 0.6);
          // Words of two or three syllables, then a short gap.
          t += len + (rand() < 0.35 ? 0.09 + rand() * 0.08 : 0.025);
        }
      }
    },
  },
  {
    // Soviet estrada: a walking bass, brass stabs on the off-beats and a singer.
    name: 'estrada',
    bpm: 104,
    beats: 8,
    cutoffHz: 620,
    drive: 0.85,
    build(n) {
      const walk = [45, 49, 52, 49, 50, 54, 57, 52];
      for (let b = 0; b < 8; b++) {
        if (b % 2 === 0) n.kick(b, 0.8);
        else n.snare(b, 0.35, 0.12, 1600);
        n.bass(b, 0.9, walk[b]!, 0.45, 'triangle', 600);
        n.chord(b + 0.5, 0.25, b < 4 ? [57, 61, 64] : [57, 62, 66], { gain: 0.04, attack: 0.01, release: 0.05 });
      }
      const line: readonly (readonly [number, number, number, Vowel])[] = [
        [0, 1, 64, 'a'], [1, 1, 66, 'e'], [2, 2, 69, 'a'], [4, 1.5, 69, 'o'], [5.5, 0.5, 71, 'e'], [6, 1.8, 69, 'a'],
      ];
      for (const [b, len, midi, vowel] of line) n.sing(b, len, midi, vowel, 0.4);
    },
  },
  {
    // The boom car: long 808 kicks, a slow snare, nothing else gets out.
    name: 'boom',
    bpm: 75,
    beats: 8,
    cutoffHz: 420,
    drive: 1,
    build(n) {
      for (const b of [0, 1.75, 4, 5.25, 5.75]) n.kick(b, 1, 90, 42, 0.9);
      n.snare(2, 0.4, 0.2, 1100);
      n.snare(6, 0.4, 0.2, 1100);
      n.chord(0, 7.8, [45, 52, 57], { gain: 0.03, type: 'triangle', attack: 0.5, release: 0.15 });
    },
  },
  {
    // Rock: palm-muted power chords in eighths over a straight beat.
    name: 'rock',
    bpm: 120,
    beats: 8,
    cutoffHz: 600,
    drive: 1.2,
    build(n) {
      for (const b of [0, 2, 2.5, 4, 6, 6.5]) n.kick(b, 0.9, 100, 50, 0.22);
      for (const b of [1, 3, 5, 7]) n.snare(b, 0.5, 0.15, 1400);
      for (let e = 0; e < 16; e++) {
        const root = e < 8 ? 40 : e < 12 ? 43 : 45;
        n.chord(e / 2, 0.4, [root, root + 7, root + 12], { gain: 0.06, attack: 0.004, release: 0.04, detune: 5 });
      }
    },
  },
];

/** One pass's length in samples at the loop rate: the pattern is scheduled on it exactly. */
function loopSamples(spec: CabinLoopSpec): number {
  return Math.round(((spec.beats * 60) / spec.bpm) * LOOP_RATE);
}

/**
 * Renders `passes` passes of a loop through its shell, raw (before levelling). The game
 * keeps the second of two (`CabinMusic`); more are for checking the seam.
 */
export async function renderCabinPasses(spec: CabinLoopSpec, passes: number): Promise<Float32Array> {
  const length = loopSamples(spec);
  const ctx = new OfflineAudioContext(1, length * passes, LOOP_RATE);
  // The shell: a cabin boom, two low-passes, the small speakers' soft clipping.
  const input = new GainNode(ctx, { gain: spec.drive });
  const low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: spec.radio ? 250 : 35, Q: 0.6 });
  const boom = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 110, Q: 1, gain: 3 });
  const lp1 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: spec.cutoffHz, Q: 0.7 });
  const lp2 = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: spec.cutoffHz * 1.25, Q: 0.6 });
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
  }
  const speakers = new WaveShaperNode(ctx, { curve });
  input.connect(low).connect(boom).connect(lp1).connect(lp2).connect(speakers).connect(ctx.destination);
  // One noise loop for every burst, a pass long so each pass hears the same noise.
  const noise = ctx.createBuffer(1, length, LOOP_RATE);
  const data = noise.getChannelData(0);
  const rand = mulberry(0x2f6b91d3);
  for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
  const beat = length / LOOP_RATE / spec.beats;
  for (let pass = 0; pass < passes; pass++) spec.build(new Notes(ctx, input, noise, (pass * length) / LOOP_RATE, beat));
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/** The second pass of two, levelled to LOOP_RMS with its peak under LOOP_PEAK. */
async function renderCabinLoop(spec: CabinLoopSpec): Promise<AudioBuffer> {
  const length = loopSamples(spec);
  const loop = (await renderCabinPasses(spec, 2)).subarray(length);
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    energy += loop[i]! * loop[i]!;
    peak = Math.max(peak, Math.abs(loop[i]!));
  }
  const rms = Math.sqrt(energy / length);
  const scale = Math.min(LOOP_RMS / Math.max(rms, 1e-9), LOOP_PEAK / Math.max(peak, 1e-9));
  const buffer = new AudioBuffer({ numberOfChannels: 1, length, sampleRate: LOOP_RATE });
  const out = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) out[i] = loop[i]! * scale;
  return buffer;
}

/** The rendered loops, shared by every car's voice, and the music's level. */
export class CabinMusic {
  /** In CABIN_LOOPS order; a loop not rendered yet is absent, and its cars wait for it. */
  readonly loops: AudioBuffer[] = [];
  /** The Radio slider's gain: muting the radio mutes everyone's (GameAudio.applySettings). */
  level = 1;

  constructor() {
    void this.render();
  }

  private async render(): Promise<void> {
    try {
      for (const spec of CABIN_LOOPS) this.loops.push(await renderCabinLoop(spec));
    } catch (error: unknown) {
      console.warn('cabin music failed to render; traffic plays none', error);
    }
  }
}

/** What one car plays: which loop, how loud (0..1), from where in it (0..1), how fast. */
export interface CabinMusicPick {
  loop: number;
  level: number;
  offset: number;
  rate: number;
}

/** Fills `out` with the music car `id` plays and returns true, or false for a car with none. */
export function cabinMusicFor(id: string, out: CabinMusicPick): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  const rand = mulberry(h ^ 0x6d757369);
  if (rand() >= MUSIC_SHARE) return false;
  out.loop = Math.floor(rand() * CABIN_LOOPS.length);
  out.level = 0.55 + 0.45 * rand();
  out.offset = rand();
  out.rate = 0.97 + 0.06 * rand();
  return true;
}
