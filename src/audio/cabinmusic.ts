/**
 * Music from other cars' cabins, heard through their shut windows.
 *
 * Nearly half the traffic has something playing, and what a driver plays LOUD on a
 * highway is a beat: house, techno, trance, drum and bass, hardcore, trap, dubstep,
 * eurodance, reggaeton, now and then synth-pop, rock, swing, an accordion tune or a
 * ballad's tune on an instrument. No speech and no singing: nobody plays a talk station
 * that loud, and a voice through a shut car is only a mumble.
 *
 * BAKED. The loops are synthesised by cabinsynth.ts once, at authoring time, and stored
 * as 16-bit mono WAVs at `CABIN_LOOP_RATE` in `public/audio/cabin/` (about 2.2 MB). The
 * game only fetches them and turns the samples into AudioBuffers at their own rate, one
 * file per task: no synthesis, no `decodeAudioData` resampling, so a loop's length is
 * exactly its pattern and it stays seamless.
 *
 * Which car plays what is fixed by its id (`cabinMusicFor`); trafficaudio.ts plays it
 * through the car's own voice, before its panner.
 */

/** The loops' sample rate: the shell leaves nothing above a couple of kHz. */
export const CABIN_LOOP_RATE = 16000;
/** The loops, in the order `cabinMusicFor` indexes them: `public/audio/cabin/<name>.wav`. */
export const CABIN_LOOP_NAMES: readonly string[] = [
  'house', 'techno', 'trance', 'dnb', 'hardcore', 'boom', 'wobble',
  'eurodance', 'dembow', 'synthpop', 'rock', 'swing', 'chanson', 'ballad',
];
/** Share of cars with music playing. */
const MUSIC_SHARE = 0.45;

const BASE = `${import.meta.env.BASE_URL}audio/cabin/`;

/** The samples of a 16-bit mono PCM WAV, as written by `encodeCabinWav`. */
function wavSamples(bytes: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes);
  // Walk the chunks to `data`: a writer may put others before it.
  let at = 12;
  while (at + 8 <= view.byteLength) {
    const id = view.getUint32(at, false);
    const size = view.getUint32(at + 4, true);
    if (id === 0x64617461) {
      const count = Math.floor(size / 2);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

/** `samples` as a 16-bit mono PCM WAV at `CABIN_LOOP_RATE`. */
export function encodeCabinWav(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CABIN_LOOP_RATE, true);
  view.setUint32(28, CABIN_LOOP_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  }
  return bytes;
}

/** The loaded loops, shared by every car's voice, and the music's level. */
export class CabinMusic {
  /** In CABIN_LOOP_NAMES order; a loop not loaded yet is absent, and its cars wait for it. */
  readonly loops: AudioBuffer[] = [];
  /** The Radio slider's gain: muting the radio mutes everyone's (GameAudio.applySettings). */
  level = 1;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      for (const name of CABIN_LOOP_NAMES) {
        const response = await fetch(`${BASE}${name}.wav`);
        if (!response.ok) throw new Error(`${name}.wav: ${response.status}`);
        const samples = wavSamples(await response.arrayBuffer());
        const buffer = new AudioBuffer({ numberOfChannels: 1, length: samples.length, sampleRate: CABIN_LOOP_RATE });
        buffer.copyToChannel(samples, 0);
        this.loops.push(buffer);
      }
    } catch (error: unknown) {
      console.warn('cabin music failed to load; traffic plays none from here on', error);
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

/** Fills `out` with the music car `id` plays and returns true, or false for a car with none. */
export function cabinMusicFor(id: string, out: CabinMusicPick): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  const rand = mulberry(h ^ 0x6d757369);
  if (rand() >= MUSIC_SHARE) return false;
  out.loop = Math.floor(rand() * CABIN_LOOP_NAMES.length);
  out.level = 0.8 + 0.2 * rand();
  out.offset = rand();
  out.rate = 0.97 + 0.06 * rand();
  return true;
}
