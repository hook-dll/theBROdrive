import { hashUnit2, hashUnit3 } from '../core/rng';

/**
 * THE VARIETY DIRECTOR: what happens to the view, and how often.
 *
 * The desert's generators each answer a different question — what the road is made of,
 * how wide it is, what colour the sand is — and every one of them was written with its
 * own private cadence. Measured end to end (`tools/road-variety.ts`, and the writeup in
 * `road_variety_current.md`) the result is a road on which the only thing that changes
 * inside three kilometres is a POI sign: surfaces turn over every 6.2 km, monuments are
 * a metronome at exactly 20, mirages average 43, and the horizon — the largest part of
 * the screen — is the same for fifty kilometres at a time.
 *
 * Adding more generators with more private cadences does not fix that; it is how the
 * problem was built. So the schedule is a thing in itself, and it is here:
 *
 *   - Three CHANNELS, one per depth the eye actually reads: the horizon, the verge
 *     rushing past, and the surface under the wheels. They are independent because
 *     they are independent to look at — a cut through a ridge and a patch of new
 *     bitumen are not competing for the same attention.
 *   - Each channel is a lattice of fixed WINDOWS, one event per window, the event
 *     JITTERED inside its window. A window guarantees the cadence; the jitter is what
 *     keeps the guarantee from sounding like the 20 km monument bell.
 *   - Inside a channel an event never repeats the kind before it, so the same feature
 *     cannot land twice in a row.
 *
 * The cadence therefore has a floor that is arithmetic rather than hope. The surface
 * channel alone puts an event every 1500 m of lattice with the centre inside the middle
 * 40% of its window, so the widest possible gap between two surface events is
 * 1500 + 0.4 * 1500 = 2100 m, and the horizon and verge channels only ever narrow it.
 * `tools/variety-timeline.ts` measures the real distribution and fails the build if that
 * bound is ever exceeded.
 *
 * Everything here is a pure function of the seed and the arclength — no state, no
 * streaming, no registration order. A feature asks what is happening where it is
 * standing and gets the same answer every time it asks, which is the only reason a
 * chunk can be unloaded and rebuilt.
 */

export const enum VarietyChannel {
  /** Skyline and silhouette: read at 200 m and beyond. */
  Horizon = 0,
  /** The strip rushing past at 5-30 m. */
  Verge = 1,
  /** The road surface itself. */
  Surface = 2,
}

export type VarietyKind =
  // Horizon
  | 'cut'
  | 'embankment'
  | 'outcrop'
  | 'weather'
  // Verge
  | 'delineators'
  | 'sidetrack'
  | 'poleAnomaly'
  // Surface
  | 'patches'
  | 'skid'
  | 'markings'
  | 'sandTongue';

/**
 * Window length per channel, metres.
 *
 * Not one shared number, because the channels do not cost the same. A cut through a
 * ridge is terrain heights, a collider and a horizon; a bitumen patch is vertex colour
 * on geometry that was going to be built anyway. The expensive channel is allowed to be
 * the sparse one precisely because the cheap channel is dense enough to carry the floor.
 */
const WINDOW_M: readonly number[] = [4000, 3000, 1500];

/** Fraction of its window an event's centre may occupy: the middle 40%. */
const JITTER_LOW = 0.3;
const JITTER_SPAN = 0.4;

/** Hash domains. Distinct from every other system's, and from each other. */
const TAG_KIND = 0x56445231; // 'VDR1'
const TAG_PLACE = 0x56445232; // 'VDR2'
const TAG_SIDE = 0x56445233; // 'VDR3'
const TAG_DRAW = 0x56445234; // 'VDR4'

interface KindDef {
  readonly kind: VarietyKind;
  readonly channel: VarietyChannel;
  /** Relative frequency inside its own channel. */
  readonly weight: number;
  /** Span of road the feature occupies, metres. */
  readonly minLength: number;
  readonly maxLength: number;
  /**
   * Metres at each end over which a CONTINUOUS feature fades in and out.
   *
   * Terrain heights and surface colour must not step, so anything a chunk samples
   * per-vertex reads `varietyWeightAt` rather than a boolean, and this is the width of
   * that ramp. Discrete features (a side track, one cluster of poles) leave it at zero.
   */
  readonly ramp: number;
}

/**
 * Every kind, its channel and how much road it takes.
 *
 * The lengths are bounded by their own window: a centre inside the middle 40% plus a
 * half-length of at most 0.3 of the window keeps every span strictly inside the window
 * that owns it. That is what lets `varietyEventAt` answer from ONE window index instead
 * of scanning neighbours, which matters because terrain asks it per vertex.
 */
const KINDS: readonly KindDef[] = [
  // -- Horizon ---------------------------------------------------------------
  /** The road drops into a prism cut through a low ridge: the sky narrows. */
  { kind: 'cut', channel: VarietyChannel.Horizon, weight: 0.3, minLength: 180, maxLength: 420, ramp: 70 },
  /** The road rides up onto a bank above the plain: the view opens and the verge falls away. */
  { kind: 'embankment', channel: VarietyChannel.Horizon, weight: 0.3, minLength: 200, maxLength: 500, ramp: 80 },
  /** A belt where the rock shelves crowd in to the corridor instead of staying out in the open. */
  { kind: 'outcrop', channel: VarietyChannel.Horizon, weight: 0.25, minLength: 250, maxLength: 600, ramp: 120 },
  /** Something far out doing something: virga, a dust wall, a smoke column. */
  { kind: 'weather', channel: VarietyChannel.Horizon, weight: 0.15, minLength: 900, maxLength: 1200, ramp: 300 },

  // -- Verge -----------------------------------------------------------------
  /** A run of reflector posts. Daytime punctuation; at night, an avenue. */
  { kind: 'delineators', channel: VarietyChannel.Verge, weight: 0.4, minLength: 400, maxLength: 1200, ramp: 0 },
  /** A graded track leaving the road for the desert, with the ruts to prove it. */
  { kind: 'sidetrack', channel: VarietyChannel.Verge, weight: 0.32, minLength: 40, maxLength: 40, ramp: 0 },
  /** A few poles doing something other than standing there. */
  { kind: 'poleAnomaly', channel: VarietyChannel.Verge, weight: 0.28, minLength: 120, maxLength: 260, ramp: 0 },

  // -- Surface ---------------------------------------------------------------
  /** Bitumen patching: a repair somebody made and nobody finished. */
  { kind: 'patches', channel: VarietyChannel.Surface, weight: 0.3, minLength: 60, maxLength: 220, ramp: 12 },
  /** Rubber: a lock-up, a turn-around arc, a burnout scar. */
  { kind: 'skid', channel: VarietyChannel.Surface, weight: 0.22, minLength: 20, maxLength: 60, ramp: 4 },
  /** The paint changes its mind: double solid, nothing at all, an edge rumble line. */
  { kind: 'markings', channel: VarietyChannel.Surface, weight: 0.26, minLength: 250, maxLength: 800, ramp: 40 },
  /** Sand tongues reaching across a lane from the windward shoulder. */
  { kind: 'sandTongue', channel: VarietyChannel.Surface, weight: 0.22, minLength: 40, maxLength: 160, ramp: 18 },
];

/** Kind definitions grouped by channel, in `KINDS` order. Built once. */
const CHANNEL_KINDS: readonly (readonly KindDef[])[] = [
  KINDS.filter((k) => k.channel === VarietyChannel.Horizon),
  KINDS.filter((k) => k.channel === VarietyChannel.Verge),
  KINDS.filter((k) => k.channel === VarietyChannel.Surface),
];

/** Kind name to its definition. Static table, so a record rather than a Map. */
const KIND_INDEX = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<
  VarietyKind,
  KindDef
>;

export interface VarietyEvent {
  readonly kind: VarietyKind;
  readonly channel: VarietyChannel;
  /** Window index. `(channel, index)` identifies this event for the life of the seed. */
  readonly index: number;
  /** Centre of the feature, metres of arclength. */
  readonly s: number;
  /** Half the span it occupies. `s - halfLength` to `s + halfLength` is the feature. */
  readonly halfLength: number;
  /** Ramp width at each end for continuous features; 0 for discrete ones. */
  readonly ramp: number;
  /** Which side of the road one-sided features take. -1 is right of travel. */
  readonly side: -1 | 1;
  /** The feature's own roll in [0, 1): depth, height, species, whatever it needs. */
  readonly draw: number;
}

// ---------------------------------------------------------------------------
// Kind chain
// ---------------------------------------------------------------------------

/**
 * Windows per chain block, and the reason there are blocks at all.
 *
 * "Never the same kind twice in a row" is a dependency on the previous window, and a
 * dependency on the previous window with no end to it is a walk back to window zero.
 * The chain is therefore TRUNCATED into blocks: a block's first window draws with no
 * history, the rest of the block chains forward from it. The only observable cost is
 * that one join in every eight may repeat a kind, which is a fair price for an O(1)
 * lookup in a function terrain calls per vertex. `roadcharacter.ts` makes the same
 * trade for the same reason.
 */
const WINDOWS_PER_BLOCK = 8;

/** Per-channel block cache: one block of kind indices, plus the key it was built for. */
const blockKinds: Int8Array[] = [
  new Int8Array(WINDOWS_PER_BLOCK),
  new Int8Array(WINDOWS_PER_BLOCK),
  new Int8Array(WINDOWS_PER_BLOCK),
];
const blockKey: number[] = [Number.NaN, Number.NaN, Number.NaN];
const blockSeed: number[] = [Number.NaN, Number.NaN, Number.NaN];

/**
 * Weighted draw from a channel's kinds, refusing `exclude`.
 *
 * The excluded kind's weight is removed from the total rather than redistributed by
 * hand, so the remaining kinds keep their relative frequencies exactly.
 */
function drawKind(seed: number, channel: VarietyChannel, window: number, exclude: number): number {
  const kinds = CHANNEL_KINDS[channel]!;
  let total = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i !== exclude) total += kinds[i]!.weight;
  }
  let r = hashUnit3(seed ^ TAG_KIND, channel, window) * total;
  for (let i = 0; i < kinds.length; i++) {
    if (i === exclude) continue;
    r -= kinds[i]!.weight;
    if (r < 0) return i;
  }
  // Float slop at the very top of the range: the last allowed kind is the answer.
  for (let i = kinds.length - 1; i >= 0; i--) if (i !== exclude) return i;
  return 0;
}

function blockFor(seed: number, channel: VarietyChannel, block: number): Int8Array {
  const cached = blockKinds[channel]!;
  if (blockKey[channel] === block && blockSeed[channel] === seed) return cached;
  let previous = -1;
  for (let i = 0; i < WINDOWS_PER_BLOCK; i++) {
    previous = drawKind(seed, channel, block * WINDOWS_PER_BLOCK + i, previous);
    cached[i] = previous;
  }
  blockKey[channel] = block;
  blockSeed[channel] = seed;
  return cached;
}

function kindAt(seed: number, channel: VarietyChannel, window: number): KindDef {
  // Floor division that is still correct for the negative windows behind the start.
  const block = Math.floor(window / WINDOWS_PER_BLOCK);
  const offset = window - block * WINDOWS_PER_BLOCK;
  return CHANNEL_KINDS[channel]![blockFor(seed, channel, block)[offset]!]!;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * One-entry-per-channel memo for `varietyEventAt`.
 *
 * Terrain builds its rows in ascending arclength and asks per vertex, so consecutive
 * questions land in the same window overwhelmingly often. Without this the cost is four
 * hashes and a weighted walk per vertex; with it, a comparison.
 */
const memoEvent: (VarietyEvent | null)[] = [null, null, null];
const memoWindow: number[] = [Number.NaN, Number.NaN, Number.NaN];
const memoSeed: number[] = [Number.NaN, Number.NaN, Number.NaN];

function buildEvent(seed: number, channel: VarietyChannel, window: number): VarietyEvent {
  const def = kindAt(seed, channel, window);
  const w = WINDOW_M[channel]!;
  const place = hashUnit3(seed ^ TAG_PLACE, channel, window);
  const draw = hashUnit3(seed ^ TAG_DRAW, channel, window);
  const length = def.minLength + (def.maxLength - def.minLength) * hashUnit2(seed ^ TAG_DRAW, window * 31 + channel);
  return {
    kind: def.kind,
    channel,
    index: window,
    s: (window + JITTER_LOW + JITTER_SPAN * place) * w,
    halfLength: length * 0.5,
    ramp: def.ramp,
    side: hashUnit3(seed ^ TAG_SIDE, channel, window) < 0.5 ? -1 : 1,
    draw,
  };
}

/** The event that owns a window, whether or not `s` is inside its span. */
export function varietyEventOfWindow(
  seed: number,
  channel: VarietyChannel,
  window: number,
): VarietyEvent {
  if (memoSeed[channel] === seed && memoWindow[channel] === window) {
    const hit = memoEvent[channel];
    if (hit) return hit;
  }
  const event = buildEvent(seed, channel, window);
  memoEvent[channel] = event;
  memoWindow[channel] = window;
  memoSeed[channel] = seed;
  return event;
}

/** Window index a given arclength falls in, for one channel. */
export function varietyWindowAt(channel: VarietyChannel, s: number): number {
  return Math.floor(s / WINDOW_M[channel]!);
}

/** Metres per window in a channel. */
export function varietyWindowLength(channel: VarietyChannel): number {
  return WINDOW_M[channel]!;
}

/**
 * The event of `channel` covering `s`, or null between features.
 *
 * Every span is strictly inside its own window (see `KINDS`), so one window index is
 * the whole search — no neighbour scan, no sorted list, no allocation on a hit.
 */
export function varietyEventAt(
  seed: number,
  channel: VarietyChannel,
  s: number,
): VarietyEvent | null {
  const event = varietyEventOfWindow(seed, channel, varietyWindowAt(channel, s));
  const reach = event.halfLength + event.ramp;
  return Math.abs(s - event.s) <= reach ? event : null;
}

/**
 * Every event whose span (ramps included) meets `[fromS, toS]`, ascending by centre.
 *
 * Allocates, and is the right call for anything asking once per chunk. Anything asking
 * per vertex wants `varietyWeightAt` or `varietyEventAt`.
 */
export function varietyEventsBetween(seed: number, fromS: number, toS: number): VarietyEvent[] {
  const out: VarietyEvent[] = [];
  for (let channel = 0; channel < WINDOW_M.length; channel++) {
    const w = WINDOW_M[channel]!;
    const first = Math.floor(fromS / w) - 1;
    const last = Math.floor(toS / w) + 1;
    for (let window = first; window <= last; window++) {
      const event = buildEvent(seed, channel as VarietyChannel, window);
      const reach = event.halfLength + event.ramp;
      if (event.s + reach < fromS || event.s - reach > toS) continue;
      out.push(event);
    }
  }
  out.sort((a, b) => a.s - b.s);
  return out;
}

/**
 * How strongly `kind` applies at `s`, in [0, 1].
 *
 * 1 across the feature's own span, smoothstepped to 0 across its ramp, and exactly 0
 * everywhere else — including everywhere a DIFFERENT kind of the same channel is
 * running. This is the form terrain and the road mesh want: a weight they can multiply
 * a displacement or a colour by, with no step at either end and no branch on identity.
 */
export function varietyWeightAt(seed: number, kind: VarietyKind, s: number): number {
  const def = KIND_INDEX[kind];
  const event = varietyEventOfWindow(seed, def.channel, varietyWindowAt(def.channel, s));
  if (event.kind !== kind) return 0;
  const d = Math.abs(s - event.s);
  if (d <= event.halfLength) return 1;
  if (event.ramp <= 0) return 0;
  const t = 1 - (d - event.halfLength) / event.ramp;
  if (t <= 0) return 0;
  return t * t * (3 - 2 * t);
}

/**
 * The event a weight came from, for callers that need its roll or its side as well.
 * Returns null unless `s` is inside that kind's span or ramp.
 */
export function varietyEventOfKindAt(
  seed: number,
  kind: VarietyKind,
  s: number,
): VarietyEvent | null {
  const def = KIND_INDEX[kind];
  const event = varietyEventAt(seed, def.channel, s);
  return event && event.kind === kind ? event : null;
}

/** Every kind the director knows, for tooling and exhaustiveness checks. */
export function varietyKinds(): readonly VarietyKind[] {
  return KINDS.map((k) => k.kind);
}
