/**
 * THE SEASON ALONG THE ROAD.
 *
 * The year is laid out along the road like the desert's sand colour once was: a pure
 * function of arclength, so driving is travelling through the calendar. The drive
 * opens on the day the world was made (its `calendarEpoch`) and every
 * `YEAR_M / 365` metres of road is one more day. A year is 1 200 km — a season is
 * hours of driving, and the turn from one to the next is spread over a hundred-odd
 * kilometres, so it is never seen happening, only found to have happened.
 *
 * WHAT THE SEASON IS. Not a switch but a handful of smooth channels, each 0..1, each
 * a function of the day of the year:
 *
 *   turn   the leaves colour: birch gold, aspen and maple red, oak brown
 *   dry    the ground goes over: meadow to khaki straw, fields to stubble, the
 *          wood floor to leaf litter
 *   bare   the broad-leaved trees stand leafless
 *   snow   snow lies
 *   fresh  the first bright green of late spring
 *
 * Every renderer reads the channels as uniforms (render/season.ts) and recolours its
 * summer colours in the shader, so nothing is rebuilt as the season moves and a
 * tile made an hour ago agrees with one made now. The vista, which is rebuilt as the
 * camera moves anyway, recolours on the CPU with the same numbers (`seasonGround`,
 * `seasonCanopy` below), so the two agree where they meet.
 *
 * Pure: no three.js, the workers can import it.
 */

/** Metres of road per calendar year. */
export const YEAR_M = 1_200_000;
const DAYS = 365;
const M_PER_DAY = YEAR_M / DAYS;

export interface SeasonState {
  /** Day of the year, 0 = 1 January, fractional. */
  day: number;
  turn: number;
  dry: number;
  bare: number;
  snow: number;
  fresh: number;
}

export function newSeasonState(): SeasonState {
  return { day: 0, turn: 0, dry: 0, bare: 0, snow: 0, fresh: 0 };
}

/** Day of the year (0-based) of an ISO `YYYY-MM-DD` date; 180 if it will not parse. */
export function dayOfYear(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 180;
  const y = +m[1]!;
  const start = Date.UTC(y, 0, 1);
  return Math.round((Date.UTC(y, +m[2]! - 1, +m[3]!) - start) / 86_400_000);
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * A channel that rises over [riseFrom, riseTo], holds, and falls over
 * [fallFrom, fallTo], in days of the year; any span may wrap past new year.
 */
function band(day: number, riseFrom: number, riseTo: number, fallFrom: number, fallTo: number): number {
  const wrap = (d: number): number => ((d % DAYS) + DAYS) % DAYS;
  const x = wrap(day - riseFrom);
  const rise = wrap(riseTo - riseFrom);
  const hold = wrap(fallFrom - riseTo);
  const fall = wrap(fallTo - fallFrom);
  if (x < rise) return smooth(x / rise);
  if (x < rise + hold) return 1;
  if (x < rise + hold + fall) return 1 - smooth((x - rise - hold) / fall);
  return 0;
}

/**
 * The calendar of the middle belt, in days of the year. `turn` falls back to zero in
 * March, while `bare` still hides every leaf, so the spring leaves come out green.
 */
export function seasonOfDay(day: number, out: SeasonState = newSeasonState()): SeasonState {
  const d = ((day % DAYS) + DAYS) % DAYS;
  out.day = d;
  out.turn = band(d, 243, 283, 59, 60); // 1 Sep .. 10 Oct, gone with the leaves
  out.dry = band(d, 231, 293, 109, 144); // 20 Aug .. 20 Oct; green again 20 Apr .. 25 May
  out.bare = band(d, 277, 308, 114, 139); // 5 Oct .. 5 Nov; leaf out 25 Apr .. 20 May
  out.snow = band(d, 313, 334, 83, 104); // 10 Nov .. 1 Dec; melts 25 Mar .. 15 Apr
  out.fresh = band(d, 120, 144, 160, 190); // May's green, gone by early July
  return out;
}

/**
 * DEV: a day of the year to hold the season at instead of the road's, or null.
 * Set from the console as `__bro.seasonDay(280)`.
 */
export const SEASON_OVERRIDE: { day: number | null } = { day: null };

/** The season at arclength `s` of a drive that opened on day `startDay`. */
export function seasonAt(s: number, startDay: number, out: SeasonState = newSeasonState()): SeasonState {
  return seasonOfDay(startDay + s / M_PER_DAY, out);
}

// ---------------------------------------------------------------------------
// Colours. Authored sRGB, used linear. The shader (render/season.ts) is generated
// from these same tables.
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearHex(v: number): Rgb {
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)];
}

export function luma(c: Rgb | Float32Array | number[]): number {
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/**
 * THE AUTUMN GROUND, per painted layer (render/groundpaint.ts: meadow, crop, forest
 * floor, earth). Each is paired with the summer colour it replaces, and the summer
 * ground is recoloured by brightness against that reference: a lush patch and a dry
 * one, a mottle and a wet hollow keep their light and dark, only the colour changes.
 */
export const AUTUMN_GROUND = {
  /** Khaki going brown. Keeps a share of its summer colour: a meadow is never all straw. */
  meadow: linearHex(0x9d9468),
  meadowRef: linearHex(0x929861),
  meadowKeep: 0.28,
  /** Stubble and harvested ground. */
  crop: linearHex(0xc2ad7c),
  cropRef: linearHex(0xdcca86),
  /** Leaf litter. */
  floor: linearHex(0x8f7550),
  floorRef: linearHex(0x86785a),
  /** Earth only darkens: autumn is wet. */
  earthShade: 0.9,
} as const;

/**
 * AUTUMN LEAVES, per tree kind (world/deserttiledata.ts `TreeKind` order). Two
 * colours a kind: each tree takes its own point between them. `ref` is the summer
 * leaf colour the brightness is measured against (the middle shade of the kind's
 * summer palette, world/props/trees.ts). `late` delays a kind's turn, as a share of
 * the `turn` channel: birch goes first, oak last. The conifers never turn.
 */
export interface AutumnLeaf {
  readonly a: Rgb;
  readonly b: Rgb;
  readonly ref: Rgb;
  readonly late: number;
  /** 0 for a conifer: it stays as it is. */
  readonly turns: number;
}

const leaf = (a: number, b: number, ref: number, late: number, turns = 1): AutumnLeaf => ({
  a: linearHex(a),
  b: linearHex(b),
  ref: linearHex(ref),
  late,
  turns,
});

export const AUTUMN_LEAVES: readonly AutumnLeaf[] = [
  leaf(0xcfa645, 0xc4b25c, 0xa3a962, 0.0), // birch: gold to straw
  leaf(0x557552, 0x557552, 0x557552, 0, 0), // spruce
  leaf(0xb39447, 0x96683a, 0x7a8a4f, 0.1), // bush: hazel yellow, willow rust
  leaf(0xc4a446, 0xa99243, 0x829a52, 0.12), // lime
  leaf(0x61744a, 0x61744a, 0x61744a, 0, 0), // pine
  leaf(0xcf8f3c, 0xb0553a, 0x9ba673, 0.05), // aspen: amber to brick
  leaf(0x9a7a3c, 0x827a45, 0x68803f, 0.3), // oak: ochre, olive brown, and late
  leaf(0xd08236, 0xb34e33, 0x92a64e, 0.08), // maple: orange to brick red
  leaf(0x6f8243, 0x7f7f40, 0x5e7644, 0.25), // alder: drops its leaves nearly green
  leaf(0xb8b274, 0xa9a064, 0xabb18e, 0.2), // willow: yellowing silver
  leaf(0xc2663a, 0xa44536, 0x8a9e55, 0.02), // rowan: rust to brick
  leaf(0xb07a3c, 0x9a6634, 0x7d9448, 0.3), // fern: bracken goes rust
  leaf(0x55684c, 0x55684c, 0x55684c, 0, 0), // juniper
  leaf(0x6e7a46, 0x6e7a46, 0x6e7a46, 0, 0), // stump: moss does not turn
  leaf(0x6e7a46, 0x6e7a46, 0x6e7a46, 0, 0), // log
];

/**
 * A wood's canopy from far off (world/landcover.ts `canopyColour`): its spruce and
 * birch ends in summer, and what the birch end becomes. The birch share of a canopy
 * colour is recovered from its chromaticity, so the blanket needs no extra attribute.
 */
export const CANOPY = {
  spruce: linearHex(0x364b36),
  birch: linearHex(0x6b7a3e),
  birchAutumn: linearHex(0x94813f),
} as const;

/**
 * Recolours a linear summer ground colour for the season. `w` are the four ground
 * paint weights (meadow, crop, forest floor, earth), not necessarily normalised.
 * Mirrors `seasonGround` in render/season.ts.
 */
export function seasonGround(rgb: Float32Array | number[], at: number, w0: number, w1: number, w2: number, w3: number, season: SeasonState): void {
  const k = season.dry;
  if (k <= 0) return;
  const sum = w0 + w1 + w2 + w3;
  if (sum < 0.01) { w0 = 1; w1 = w2 = w3 = 0; } else { w0 /= sum; w1 /= sum; w2 /= sum; w3 /= sum; }
  const G = AUTUMN_GROUND;
  const l = 0.2126 * rgb[at]! + 0.7152 * rgb[at + 1]! + 0.0722 * rgb[at + 2]!;
  const m = l / luma(G.meadowRef);
  const c = l / luma(G.cropRef);
  const f = l / luma(G.floorRef);
  for (let i = 0; i < 3; i++) {
    const col = rgb[at + i]!;
    const meadow = G.meadow[i]! * m + (col - G.meadow[i]! * m) * G.meadowKeep;
    const autumn = meadow * w0 + G.crop[i]! * c * w1 + G.floor[i]! * f * w2 + col * G.earthShade * w3;
    rgb[at + i] = col + (autumn - col) * k;
  }
}

/** How far the woods as a whole have turned, from the `turn` channel. */
export function canopyTurn(turn: number): number {
  return smooth((turn - 0.1) / 0.8);
}

/**
 * Recolours a wood's far canopy colour of birch share `birch`. Mirrors
 * `seasonCanopy` in render/season.ts, which recovers the share itself.
 */
export function seasonCanopy(rgb: Float32Array | number[], at: number, birch: number, season: SeasonState): void {
  const t = canopyTurn(season.turn);
  if (t <= 0 || birch <= 0) return;
  // Per channel, as a ratio: the canopy colour carries a per-crown brightness that the
  // ratio keeps.
  for (let i = 0; i < 3; i++) {
    const summer = CANOPY.spruce[i]! + (CANOPY.birch[i]! - CANOPY.spruce[i]!) * birch;
    const autumn = CANOPY.spruce[i]! + (CANOPY.birchAutumn[i]! - CANOPY.spruce[i]!) * birch;
    rgb[at + i] = rgb[at + i]! * (1 + (autumn / summer - 1) * t);
  }
}
