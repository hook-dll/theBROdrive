import { hash01 } from '../core/rng';

/**
 * FIELD AND FOREST TRACKS: the dirt roads that leave the asphalt for a field, a wood
 * or nowhere in particular. Two ruts worn to earth with a strip of grass between them,
 * the most common line in the Russian countryside after the road itself, and in half
 * of Shishkin ("Rye", "Rain in an oak forest", "Pines sunlit").
 *
 * A track is a curve in the ROAD's frame: it leaves the asphalt edge at `s0` on one
 * side and runs out to `length` metres, its along-road position wandering by a sine as
 * it goes. So "where is the track" is answered from a point's arclength and lateral
 * offset alone, the same numbers every system already has near the road: the ribbon
 * that draws it (world/trackmesh.ts), the grass that keeps off its ruts
 * (world/grass.ts), the trees and undergrowth that do not grow on it
 * (world/deserttiledata.ts).
 *
 * Pure: the seed and the road frame, nothing else.
 */

export interface Track {
  /** Arclength where it leaves the road. */
  readonly s0: number;
  /** -1 left, 1 right. */
  readonly side: number;
  /** Metres from the asphalt edge to where it fades out. */
  readonly length: number;
  /** Along-road wander, metres, and its wavelength in metres out. */
  readonly bend: number;
  readonly wave: number;
  /** A steady lean along the road per metre out, so a track is not always square to it. */
  readonly lean: number;
}

/** One chance of a track per this many metres of road, per side. */
const TRACK_SEGMENT_M = 650;
const TRACK_ODDS = 0.5;
export const TRACK_MAX_LENGTH_M = 220;
/** Half-width of the whole track, ruts and verges, metres. */
export const TRACK_HALF_WIDTH_M = 1.7;
/** Centre of each rut from the centreline, and a rut's half-width. */
export const TRACK_RUT_OFFSET_M = 0.8;
export const TRACK_RUT_HALF_M = 0.28;
/** Metres over which a track fades out at its far end. */
const TRACK_FADE_M = 40;
const TAG = 0x7472636b;

/** The track leaving side `side` in segment `seg`, or null. */
export function trackOf(seed: number, seg: number, side: number): Track | null {
  if (hash01(seed, TAG, seg, side, 1) > TRACK_ODDS) return null;
  const length = 90 + hash01(seed, TAG, seg, side, 3) * (TRACK_MAX_LENGTH_M - 90);
  return {
    s0: (seg + 0.1 + 0.8 * hash01(seed, TAG, seg, side, 2)) * TRACK_SEGMENT_M,
    side,
    length,
    bend: (hash01(seed, TAG, seg, side, 4) - 0.5) * 50,
    wave: length * (0.9 + hash01(seed, TAG, seg, side, 5) * 0.8),
    lean: (hash01(seed, TAG, seg, side, 6) - 0.5) * 0.5,
  };
}

/** Along-road position of a track's centreline `t` metres out from the asphalt edge. */
export function trackAlong(track: Track, t: number): number {
  return track.s0 + track.lean * t + track.bend * Math.sin((t / track.wave) * Math.PI);
}

/** d(along)/dt: how steeply the centreline runs along the road at `t`. */
function trackSlope(track: Track, t: number): number {
  return track.lean + track.bend * (Math.PI / track.wave) * Math.cos((t / track.wave) * Math.PI);
}

/** 0..1 how present a track is `t` metres out: full, then fading at its end. */
export function trackFade(track: Track, t: number): number {
  const f = Math.min(1, Math.max(0, (track.length - t) / TRACK_FADE_M));
  return f * f * (3 - 2 * f);
}

/** Every track whose junction lies in [sFrom, sTo). */
export function tracksBetween(seed: number, sFrom: number, sTo: number): Track[] {
  const out: Track[] = [];
  for (let seg = Math.floor(sFrom / TRACK_SEGMENT_M) - 1; seg <= Math.floor(sTo / TRACK_SEGMENT_M); seg++) {
    for (const side of [-1, 1]) {
      const track = trackOf(seed, seg, side);
      if (track && track.s0 >= sFrom && track.s0 < sTo) out.push(track);
    }
  }
  return out;
}

/** What a point near the road knows about the nearest track. */
export interface TrackSample {
  /** Metres from the nearest track's centreline, or Infinity. */
  dist: number;
  /** 0..1 how present that track is there (it fades at its end). */
  fade: number;
}

/**
 * The nearest track to a point given in the road frame: `s` its arclength, `lateral`
 * its signed offset, `edge` the asphalt's half-width there. Cheap enough per grass
 * texel: the tracks are found by segment, not searched.
 */
export function trackAt(seed: number, s: number, lateral: number, edge: number, out: TrackSample): TrackSample {
  out.dist = Infinity;
  out.fade = 0;
  const t = Math.abs(lateral) - edge;
  if (t < -0.5 || t > TRACK_MAX_LENGTH_M) return out;
  const side = lateral < 0 ? -1 : 1;
  const seg = Math.floor(s / TRACK_SEGMENT_M);
  for (let k = seg - 1; k <= seg + 1; k++) {
    const track = trackOf(seed, k, side);
    if (!track || t > track.length) continue;
    const tt = Math.max(0, t);
    const off = Math.abs(s - trackAlong(track, tt)) / Math.sqrt(1 + trackSlope(track, tt) ** 2);
    if (off < out.dist) {
      out.dist = off;
      out.fade = trackFade(track, tt);
    }
  }
  return out;
}

/**
 * Whether a track can be anywhere near arclength `s` on either side: the cheap test
 * a caller makes before paying for a projection.
 */
export function trackPossibleNear(seed: number, s: number): boolean {
  const seg = Math.floor(s / TRACK_SEGMENT_M);
  for (let k = seg - 1; k <= seg + 1; k++) {
    for (const side of [-1, 1]) {
      const track = trackOf(seed, k, side);
      if (track && Math.abs(s - track.s0) < Math.abs(track.bend) + Math.abs(track.lean) * track.length + 60) return true;
    }
  }
  return false;
}
