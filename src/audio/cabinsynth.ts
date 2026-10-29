/**
 * The cabin loops' SOURCE: how each of the traffic's cabin loops (cabinmusic.ts) is
 * synthesised. The game never runs this. The loops are baked once into
 * `public/audio/cabin/*.wav` from the car lab (`?car-lab`, «Записать лупы», dev only,
 * written by the `cabin-bake` dev middleware in vite.config.ts), and the game only
 * loads those files. Change a loop here, bake again, commit the WAVs.
 *
 * From outside a closed car none of it is music any more, only its bottom octaves and
 * its beat, so the loops are made that way: short (3-8 s), mono, at 16 kHz, each a few
 * bars of a style built from oscillators and noise, and the car's shell baked in (two
 * low-passes, a cabin boom, and the soft clipping of speakers driven past what they can
 * take). The bass-heavy ones push a deep boom (`boomHz`, `boomDb`) into that clipping.
 *
 * SEAMLESS. The pattern is time-invariant: each loop is rendered twice over and the
 * SECOND pass kept: it already carries the first pass's tails, exactly what its own end
 * hands to its start when it loops, and every filter has settled. No crossfade.
 */

import { CABIN_LOOP_NAMES, CABIN_LOOP_RATE } from './cabinmusic';

/**
 * Every loop is levelled on what is HEARD of it: its RMS above `AUDIBLE_FROM_HZ` is
 * -21 dBFS, peaks held under `LOOP_PEAK`. Levelled on the full band instead, a bass car's
 * loop spent its whole level on a 50 Hz sub that laptop speakers do not play, and came
 * out 12 dB under a talk station: the beats went unheard and only speech got through.
 */
const AUDIBLE_FROM_HZ = 150;
const LOOP_AUDIBLE_RMS = 0.09;
const LOOP_PEAK = 0.95;
/**
 * Ceiling on the WHOLE band's RMS (-11 dBFS): a loop whose sub carries far more than
 * its audible part is pulled down by it, so a bass car close by drones in the chest
 * instead of pressing on the ears.
 */
const LOOP_MAX_RMS = 0.28;

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

  /** A snare, clap or (high `tone`, short `decay`) a hat: a noise burst over a short body. */
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
    if (tone > 2500) return;
    const body = new OscillatorNode(this.ctx, { frequency: 185 });
    const bg = new GainNode(this.ctx, { gain: 0 });
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(gain * 0.6, t + 0.002);
    bg.gain.setTargetAtTime(0, t + 0.002, 0.025);
    body.connect(bg).connect(this.out);
    body.start(t);
    body.stop(t + 0.2);
  }

  /**
   * One bass note, `len` beats long, through its own low-pass. `detune` cents splits it
   * into two oscillators that beat against each other: the drum and bass reese.
   */
  bass(beat: number, len: number, midi: number, gain = 0.5, type: OscillatorType = 'sawtooth', cutoff = 380, detune = 0): void {
    const t = this.at(beat);
    const d = len * this.beat;
    const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: cutoff, Q: 1.2 });
    lp.connect(this.envelope(t, 0.006, d - 0.04, 0.04, gain));
    for (const cents of detune > 0 ? [-detune, detune] : [0]) {
      const osc = new OscillatorNode(this.ctx, { type, frequency: hz(midi), detune: cents });
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + d + 0.05);
    }
  }

  /** A wobble bass: a saw through a resonant low-pass swept by an LFO of `rate` per beat. */
  wobble(beat: number, len: number, midi: number, rate: number, gain = 0.5): void {
    const t = this.at(beat);
    const d = len * this.beat;
    const stop = t + d + 0.05;
    const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 260, Q: 7 });
    const lfo = new OscillatorNode(this.ctx, { frequency: rate / this.beat });
    const depth = new GainNode(this.ctx, { gain: 220 });
    lfo.connect(depth).connect(lp.frequency);
    lp.connect(this.envelope(t, 0.01, d - 0.04, 0.04, gain));
    for (const [type, cents] of [['sawtooth', -8], ['square', 8]] as const) {
      const osc = new OscillatorNode(this.ctx, { type, frequency: hz(midi), detune: cents });
      osc.connect(lp);
      osc.start(t);
      osc.stop(stop);
    }
    lfo.start(t);
    lfo.stop(stop);
  }

  /**
   * A chord, each note two oscillators `detune` cents apart (an accordion's wet
   * tuning, a brass section's spread, a trance supersaw); `tremolo` Hz shakes it.
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

  /** A melody, `[beat, beats, midi]` per note, on one detuned instrument. */
  tune(notes: readonly (readonly [number, number, number])[], options: Parameters<Notes['chord']>[3] = {}): void {
    for (const [b, len, midi] of notes) this.chord(b, len, [midi], options);
  }
}

export interface CabinLoopSpec {
  readonly name: string;
  readonly bpm: number;
  readonly beats: number;
  /** The shell's low-pass corner, Hz. */
  readonly cutoffHz: number;
  /** Level into the speakers' saturation: past ~1.5 the low end farts and rattles. */
  readonly drive: number;
  /** The cabin boom's centre, Hz, and its lift, dB: deep and big for a bass car. */
  readonly boomHz?: number;
  readonly boomDb?: number;
  readonly build: (n: Notes) => void;
}

/** Four on the floor across `beats`, a kick per beat. */
function fourOnTheFloor(n: Notes, beats: number, gain = 1, from = 110, to = 45, decay = 0.3): void {
  for (let b = 0; b < beats; b++) n.kick(b, gain, from, to, decay);
}

/** The loops, in `CABIN_LOOP_NAMES` order (cabinmusic.ts), which `cabinMusicFor` indexes. */
export const CABIN_LOOPS: readonly CabinLoopSpec[] = [
  {
    // House: the «тумц-тумц» from a passing car at night.
    name: 'house',
    bpm: 126,
    beats: 16,
    cutoffHz: 520,
    drive: 1.5,
    boomHz: 65,
    boomDb: 9,
    build(n) {
      const roots = [33, 33, 29, 31];
      fourOnTheFloor(n, 16);
      for (let b = 0; b < 16; b++) {
        if (b % 2 === 1) n.snare(b, 0.3, 0.1, 1300);
        n.snare(b + 0.5, 0.12, 0.05, 4000);
        n.bass(b + 0.5, 0.42, roots[b >> 2]!, 0.6, 'sawtooth', 300);
      }
      for (let bar = 0; bar < 4; bar++) n.chord(bar * 4 + 1.5, 0.35, [roots[bar]! + 24, roots[bar]! + 27, roots[bar]! + 31], { gain: 0.05, type: 'square' });
    },
  },
  {
    // Techno: a hard kick every beat and the rumble rolling off it in sixteenths.
    name: 'techno',
    bpm: 134,
    beats: 8,
    cutoffHz: 480,
    drive: 1.2,
    boomHz: 58,
    boomDb: 10,
    build(n) {
      fourOnTheFloor(n, 8, 1.1, 130, 42, 0.35);
      for (let b = 0; b < 8; b++) {
        for (const q of [0.25, 0.5, 0.75]) n.bass(b + q, 0.22, b < 6 ? 31 : 34, 0.35 * (1 - q * 0.5), 'sine', 200);
        n.snare(b + 0.5, 0.14, 0.06, 4500);
        if (b % 2 === 1) n.snare(b, 0.25, 0.09, 1500);
      }
    },
  },
  {
    // Trance: the rolling offbeat bass under supersaw stabs carrying the riff.
    name: 'trance',
    bpm: 138,
    beats: 16,
    cutoffHz: 620,
    drive: 1.4,
    boomHz: 70,
    boomDb: 7,
    build(n) {
      const roots = [33, 29, 36, 31];
      fourOnTheFloor(n, 16, 1, 120, 45, 0.28);
      for (let b = 0; b < 16; b++) {
        const root = roots[b >> 2]!;
        for (const q of [0.25, 0.5, 0.75]) n.bass(b + q, 0.2, root, 0.45, 'sawtooth', 340);
      }
      const riff = [0, 0.75, 1.5, 2, 2.75, 3.5];
      const steps = [12, 19, 15, 12, 19, 24];
      for (let bar = 0; bar < 4; bar++) {
        riff.forEach((q, i) => n.chord(bar * 4 + q, 0.4, [roots[bar]! + 24 + steps[i]!], { gain: 0.045, detune: 18, attack: 0.005, release: 0.06 }));
      }
    },
  },
  {
    // Drum and bass: a busy broken break at 174, ghost snares and fast hats on top, the
    // reese kept low under a pad. The shell opens wider than the others so the hats get out.
    name: 'dnb',
    bpm: 174,
    beats: 8,
    cutoffHz: 1400,
    drive: 1,
    boomHz: 70,
    boomDb: 4,
    build(n) {
      for (const b of [0, 1.75, 2.5, 4, 5.75, 6.5]) n.kick(b, 0.9, 140, 55, 0.18);
      for (const b of [1, 3, 5, 7]) n.snare(b, 0.6, 0.14, 1900);
      for (const b of [1.75, 3.25, 3.75, 5.5, 7.25, 7.75]) n.snare(b, 0.18, 0.06, 2100);
      for (let s = 0; s < 32; s++) n.snare(s / 4, s % 2 === 0 ? 0.22 : 0.13, 0.035, 3000);
      n.bass(0, 3.9, 38, 0.3, 'sawtooth', 320, 18);
      n.bass(4, 1.9, 41, 0.3, 'sawtooth', 320, 18);
      n.bass(6, 1.9, 36, 0.3, 'sawtooth', 320, 18);
      n.chord(0, 4, [62, 65, 69], { gain: 0.04, type: 'triangle', attack: 0.2, release: 0.3 });
      n.chord(4, 4, [60, 64, 67], { gain: 0.04, type: 'triangle', attack: 0.2, release: 0.3 });
      n.tune([[0, 1, 74], [1.5, 0.5, 72], [2, 1.5, 69], [4, 1, 72], [5.5, 0.5, 71], [6, 1.5, 67]], { gain: 0.06, type: 'square', detune: 8, attack: 0.01, release: 0.1 });
    },
  },
  {
    // Hardcore: a distorted kick on every beat at 180, the kick IS the tune.
    name: 'hardcore',
    bpm: 180,
    beats: 8,
    cutoffHz: 520,
    drive: 1.5,
    boomHz: 62,
    boomDb: 9,
    build(n) {
      fourOnTheFloor(n, 8, 1.3, 220, 48, 0.3);
      for (let b = 0; b < 8; b++) n.bass(b + 0.5, 0.35, b < 4 ? 33 : 31, 0.4, 'square', 420);
      n.chord(0, 3.8, [69, 72, 76], { gain: 0.03, type: 'square', detune: 15 });
      n.chord(4, 3.8, [67, 71, 74], { gain: 0.03, type: 'square', detune: 15 });
    },
  },
  {
    // The boom car, trap: a slow 808, a clap, hat rolls in triplets and a bell tune.
    name: 'boom',
    bpm: 75,
    beats: 8,
    cutoffHz: 1300,
    drive: 1.1,
    boomHz: 60,
    boomDb: 5,
    build(n) {
      for (const b of [0, 1.75, 4, 5.25]) n.kick(b, 0.8, 100, 45, 0.5);
      n.snare(2, 0.55, 0.18, 1500);
      n.snare(6, 0.55, 0.18, 1500);
      for (let e = 0; e < 16; e++) n.snare(e / 2, 0.2, 0.04, 3000);
      for (const start of [3, 7]) for (let k = 0; k < 6; k++) n.snare(start + k / 6, 0.14, 0.025, 3200);
      n.tune([[0, 0.5, 72], [0.5, 0.5, 75], [1, 0.5, 79], [1.5, 0.5, 75], [2, 0.5, 72], [2.5, 0.5, 70], [3, 1, 67],
        [4, 0.5, 72], [4.5, 0.5, 75], [5, 0.5, 79], [5.5, 0.5, 82], [6, 1, 79], [7, 1, 75]], { gain: 0.06, type: 'triangle', detune: 4, attack: 0.003, release: 0.15 });
    },
  },
  {
    // Dubstep: half-time drums with hats in sixteenths, a wobble in the mids, a lead on top.
    name: 'wobble',
    bpm: 140,
    beats: 16,
    cutoffHz: 1200,
    drive: 0.9,
    boomHz: 70,
    boomDb: 4,
    build(n) {
      for (const b of [0, 8, 10.5]) n.kick(b, 1, 120, 50, 0.3);
      for (const b of [4, 12]) n.snare(b, 0.7, 0.2, 1700);
      for (let s = 0; s < 64; s++) if (s % 4 !== 0) n.snare(s / 4, s % 2 === 0 ? 0.18 : 0.1, 0.03, 3000);
      n.wobble(0, 4, 38, 2, 0.3);
      n.wobble(4, 4, 38, 4, 0.3);
      n.wobble(8, 4, 41, 2, 0.3);
      n.wobble(12, 4, 36, 3, 0.3);
      n.tune([[0, 1, 74], [2, 1, 77], [3, 1, 76], [4, 2, 74], [8, 1, 72], [10, 1, 74], [11, 1, 76], [12, 3, 69]], { gain: 0.05, type: 'square', detune: 10, attack: 0.01, release: 0.12 });
    },
  },
  {
    // Eurodance: an octave bass on the offbeat and a square-wave hook.
    name: 'eurodance',
    bpm: 140,
    beats: 8,
    cutoffHz: 640,
    drive: 1.4,
    boomHz: 75,
    boomDb: 6,
    build(n) {
      fourOnTheFloor(n, 8, 1, 120, 46, 0.25);
      for (let b = 0; b < 8; b++) {
        if (b % 2 === 1) n.snare(b, 0.35, 0.1, 1500);
        const root = b < 4 ? 33 : 31;
        n.bass(b + 0.5, 0.4, root + 12, 0.45, 'sawtooth', 450);
      }
      n.tune([
        [0, 0.5, 69], [0.5, 0.5, 72], [1, 0.5, 76], [1.5, 1, 74], [3, 0.5, 72],
        [4, 0.5, 67], [4.5, 0.5, 71], [5, 0.5, 74], [5.5, 1, 72], [7, 0.5, 71],
      ], { gain: 0.06, type: 'square', detune: 10, attack: 0.005, release: 0.05 });
    },
  },
  {
    // Reggaeton: the dembow, a boom-ch-boom-chick over a sub held long.
    name: 'dembow',
    bpm: 96,
    beats: 8,
    cutoffHz: 500,
    drive: 0.9,
    boomHz: 55,
    boomDb: 10,
    build(n) {
      fourOnTheFloor(n, 8, 0.8, 100, 42, 0.45);
      for (let b = 0; b < 8; b++) {
        n.snare(b + 0.75, 0.35, 0.09, 1600);
        if (b % 2 === 1) n.snare(b + 0.5, 0.3, 0.09, 1600);
      }
      n.bass(0, 3.9, 28, 0.55, 'sine', 200);
      n.bass(4, 3.9, 31, 0.55, 'sine', 200);
      n.tune([[0.5, 0.5, 64], [1.5, 0.5, 67], [2.5, 1, 66], [4.5, 0.5, 64], [5.5, 0.5, 62], [6.5, 1, 64]], { gain: 0.05, type: 'triangle', detune: 6 });
    },
  },
  {
    // 80s synth-pop: an octave-jumping bass in eighths, a big gated snare.
    name: 'synthpop',
    bpm: 116,
    beats: 8,
    cutoffHz: 560,
    drive: 1.1,
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
    // Rock: palm-muted power chords in eighths over a straight beat.
    name: 'rock',
    bpm: 120,
    beats: 8,
    cutoffHz: 600,
    drive: 1.3,
    build(n) {
      for (const b of [0, 2, 2.5, 4, 6, 6.5]) n.kick(b, 0.9, 100, 50, 0.22);
      for (const b of [1, 3, 5, 7]) n.snare(b, 0.5, 0.15, 1400);
      for (let e = 0; e < 16; e++) {
        const root = e < 8 ? 40 : e < 12 ? 43 : 45;
        n.chord(e / 2, 0.4, [root, root + 7, root + 12], { gain: 0.06, attack: 0.004, release: 0.04, detune: 5 });
      }
    },
  },
  {
    // Swing: a walking bass, the ride's spang-a-lang, chords comped on the swung eighth.
    name: 'swing',
    bpm: 150,
    beats: 8,
    cutoffHz: 650,
    drive: 1,
    build(n) {
      const walk = [38, 41, 43, 44, 45, 43, 41, 40];
      for (let b = 0; b < 8; b++) {
        n.bass(b, 0.9, walk[b]!, 0.55, 'triangle', 600);
        n.snare(b, 0.12, 0.12, 3800);
        if (b % 2 === 1) n.snare(b + 2 / 3, 0.09, 0.08, 3800);
        if (b % 2 === 1) n.snare(b, 0.12, 0.06, 1800);
      }
      n.kick(0, 0.5, 90, 50, 0.2);
      n.kick(4, 0.5, 90, 50, 0.2);
      n.chord(1 + 2 / 3, 0.5, [53, 57, 60, 64], { gain: 0.03, type: 'triangle', detune: 4 });
      n.chord(3 + 2 / 3, 0.9, [55, 59, 62, 65], { gain: 0.03, type: 'triangle', detune: 4 });
      n.chord(5 + 2 / 3, 0.5, [52, 55, 59, 62], { gain: 0.03, type: 'triangle', detune: 4 });
    },
  },
  {
    // A slow chanson waltz: oom-pah-pah under an accordion with the bellows shaking.
    name: 'chanson',
    bpm: 100,
    beats: 12,
    cutoffHz: 650,
    drive: 1,
    build(n) {
      const bass = [45, 38, 40, 45];
      const chords = [[57, 60, 64], [57, 62, 65], [56, 59, 62, 64], [57, 60, 64]];
      for (let bar = 0; bar < 4; bar++) {
        n.bass(bar * 3, 0.9, bass[bar]!, 0.5, 'triangle', 500);
        for (const pah of [1, 2]) n.chord(bar * 3 + pah, 0.5, chords[bar]!, { gain: 0.05, detune: 12 });
      }
      n.tune([
        [0, 1.5, 64], [1.5, 0.5, 65], [2, 1, 64],
        [3, 1.5, 62], [4.5, 0.5, 64], [5, 1, 65],
        [6, 1, 68], [7, 1, 71], [8, 1, 68],
        [9, 2, 69], [11, 1, 64],
      ], { gain: 0.09, type: 'square', detune: 12, tremolo: 5.5, attack: 0.03 });
    },
  },
  {
    // A slow pop ballad: the tune on a soft lead over a pad, where a singer would be.
    name: 'ballad',
    bpm: 84,
    beats: 8,
    cutoffHz: 620,
    drive: 1.1,
    boomHz: 80,
    boomDb: 5,
    build(n) {
      for (const b of [0, 2.5, 4, 6.5]) n.kick(b, 0.8, 100, 45, 0.35);
      for (const b of [2, 6]) n.snare(b, 0.4, 0.2, 1300);
      n.chord(0, 4, [48, 55, 64], { gain: 0.04, type: 'triangle', attack: 0.2, release: 0.3 });
      n.chord(4, 4, [45, 52, 60], { gain: 0.04, type: 'triangle', attack: 0.2, release: 0.3 });
      n.bass(0, 3.9, 36, 0.45, 'sine', 300);
      n.bass(4, 3.9, 33, 0.45, 'sine', 300);
      n.tune([
        [0, 1.5, 64], [1.5, 0.5, 67], [2, 2, 69], [4, 1, 67], [5, 1, 64], [6, 1.8, 62],
      ], { gain: 0.08, type: 'triangle', detune: 6, tremolo: 5, attack: 0.04, release: 0.15 });
    },
  },
];

/** One pass's length in samples at the loop rate: the pattern is scheduled on it exactly. */
function loopSamples(spec: CabinLoopSpec): number {
  return Math.round(((spec.beats * 60) / spec.bpm) * CABIN_LOOP_RATE);
}

/**
 * Renders `passes` passes of a loop through its shell, raw (before levelling). The game
 * keeps the second of two (`CabinMusic`); more are for checking the seam.
 */
export async function renderCabinPasses(spec: CabinLoopSpec, passes: number): Promise<Float32Array> {
  const length = loopSamples(spec);
  const ctx = new OfflineAudioContext(1, length * passes, CABIN_LOOP_RATE);
  // The shell: a cabin boom, two low-passes, the speakers' soft clipping.
  const input = new GainNode(ctx, { gain: spec.drive });
  const low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 35, Q: 0.6 });
  const boom = new BiquadFilterNode(ctx, { type: 'peaking', frequency: spec.boomHz ?? 110, Q: 1, gain: spec.boomDb ?? 3 });
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
  const noise = ctx.createBuffer(1, length, CABIN_LOOP_RATE);
  const data = noise.getChannelData(0);
  const rand = mulberry(0x2f6b91d3);
  for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
  const beat = length / CABIN_LOOP_RATE / spec.beats;
  for (let pass = 0; pass < passes; pass++) spec.build(new Notes(ctx, input, noise, (pass * length) / CABIN_LOOP_RATE, beat));
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * RMS of `x` above `AUDIBLE_FROM_HZ`: two one-pole high-passes. What a laptop's speakers
 * and the ear in traffic noise actually get of a loop; the sub under it is felt, not heard.
 */
export function audibleRms(x: Float32Array): number {
  const a = Math.exp((-2 * Math.PI * AUDIBLE_FROM_HZ) / CABIN_LOOP_RATE);
  let y1 = 0;
  let x1 = 0;
  let y2 = 0;
  let x2 = 0;
  let energy = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    y1 = a * (y1 + v - x1);
    x1 = v;
    y2 = a * (y2 + y1 - x2);
    x2 = y1;
    energy += y2 * y2;
  }
  return Math.sqrt(energy / Math.max(1, x.length));
}

/** The second pass of two, levelled on its audible band (`LOOP_AUDIBLE_RMS`), its peak under LOOP_PEAK. */
async function renderCabinLoop(spec: CabinLoopSpec): Promise<Float32Array> {
  const length = loopSamples(spec);
  const loop = (await renderCabinPasses(spec, 2)).subarray(length);
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(loop[i]!));
    energy += loop[i]! * loop[i]!;
  }
  const full = Math.sqrt(energy / length);
  const scale = Math.min(
    LOOP_AUDIBLE_RMS / Math.max(audibleRms(loop), 1e-9),
    LOOP_MAX_RMS / Math.max(full, 1e-9),
    LOOP_PEAK / Math.max(peak, 1e-9),
  );
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = loop[i]! * scale;
  return out;
}

/** Every loop, rendered and levelled, by name, in `CABIN_LOOP_NAMES` order. */
export async function renderCabinLoops(): Promise<{ name: string; samples: Float32Array }[]> {
  const names = CABIN_LOOPS.map((spec) => spec.name);
  if (names.join() !== CABIN_LOOP_NAMES.join()) {
    throw new Error(`cabinsynth CABIN_LOOPS (${names.join()}) and cabinmusic CABIN_LOOP_NAMES (${CABIN_LOOP_NAMES.join()}) disagree`);
  }
  const out: { name: string; samples: Float32Array }[] = [];
  for (const spec of CABIN_LOOPS) out.push({ name: spec.name, samples: await renderCabinLoop(spec) });
  return out;
}
