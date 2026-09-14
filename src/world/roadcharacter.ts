import { hashUnit2, hashUnit3 } from '../core/rng';

/**
 * WHAT KIND OF ROAD THIS IS, and why it is a district rather than a noise field.
 *
 * The road used to have exactly one character everywhere: a corner every kilometre,
 * turning 25-60 degrees, at a radius drawn from 85-140 m, with slow route noise under
 * it. Measured over forty kilometres of the shipped road that reads as almost no road
 * at all — a median radius of 3 km, a p90 of 322 m, and a geometric speed limit of
 * 350 km/h at the median. There is nothing to drive and nothing to remember, because
 * every kilometre is the average of every other one.
 *
 * A NOISE FIELD CANNOT FIX THAT, and this is the reason for the shape of this file.
 * Blending the parameters continuously would give the road a gradient of averages: a
 * bit twistier here, a bit straighter there, and never a stretch with a name. What a
 * drive needs is places — forty kilometres of mountain switchbacks, then a hundred of
 * dead-straight pan, then rolling sweepers — so the character is a DISTRICT, drawn
 * once, held for its whole length, and crossfaded only over the join.
 *
 * THE LENGTH IS SET BY COVERAGE, and that is arithmetic rather than taste. The
 * requirement is that a player meets every kind of road inside two to three thousand
 * kilometres. Drawing one of `CHARACTERS.length` kinds per district, with the
 * predecessor excluded, the expected distance to have seen them all is the coupon
 * collector's `n * H(n)` districts — about 15 for six kinds. At `DISTRICT_NOMINAL_M`
 * that is some 750 km for the full set, so a 2500 km drive sees everything and sees
 * most of it three or four times. Making districts twice as long would still cover it
 * but leave no repeats; half as long and a district stops being a place.
 *
 * Everything here is a pure function of (seed, s), like every other road property: no
 * state, no tables, and the same road after a reload.
 */

/** Nominal district length, metres. See the coverage arithmetic above. */
const DISTRICT_NOMINAL_M = 50_000;
/** Peak-to-peak jitter of a boundary, metres, so a length is never a round number. */
const DISTRICT_JITTER_M = 12_000;
/** Metres the character crossfades over at a join, so no geometry steps. */
const BLEND_M = 1_200;
/** Hash domains, kept apart from every other `hash` use in the world. */
const DISTRICT_TAG = 0x52434831; // 'RCH1'
const DRAW_TAG = 0x52434832; // 'RCH2'

/**
 * The first district is always the calm one. The homestead, its driveway and the
 * player's first minutes are authored against a straight road, and a switchback
 * district rolled onto kilometre zero would put a hairpin in the garage exit.
 */
const HOME_DISTRICT_LENGTH_M = 30_000;

/**
 * One kind of road.
 *
 * `cornerSpacing` is how much road one corner event owns, so it sets cadence; the
 * radius range sets what that corner is; `straightShare` is how much of the section
 * is held on the new bearing before the next event begins, which is what makes a pan
 * road a pan road rather than a slow wiggle. `deviation` scales the slow route noise
 * that wanders the whole road, and it is what separates "straight" from "sweeping".
 */
export interface RoadCharacter {
  readonly name: string;
  /** Metres of road per corner event. */
  readonly cornerSpacing: number;
  /** Peak corner radius drawn per event, metres. */
  readonly radiusMin: number;
  readonly radiusMax: number;
  /** Heading change per event, radians, before the alternating sign. */
  readonly headingMin: number;
  readonly headingMax: number;
  /** Amplitude of the slow route wander, radians. */
  readonly deviation: number;
  /**
   * Share of a section held on its new bearing. 1 spends the whole section turning,
   * 0.75 leaves three quarters of it straight.
   */
  readonly straightShare: number;
  /**
   * How much superelevation this road was built with, as a share of the design
   * figure. A maintained highway is fully banked; a desert pan road is nearly flat
   * whatever its corners ask for, and that is a real difference to drive.
   */
  readonly bankShare: number;
  /**
   * The speed this road was BUILT for, km/h, which is what its banking is sized from
   * (`e + f = V² / 127R`). It is a property of the road rather than of a driver: a
   * highway corner is banked for highway speed whoever is driving it.
   */
  readonly designSpeedKmh: number;
  /**
   * Relative frequency of this kind in the draw.
   *
   * NOT equal shares, and that is both realistic and measured. A road network is
   * mostly the easy kinds with the hard ones as occasional country; equal sixths put
   * 27% of a drive in the tightest district, and on that road the stream jams — seed
   * 1337 came out at 29 km/h of a 68 km/h road with 34% of car-time crawling. The
   * weights below put about a tenth of the drive in the hardest kind, which is enough
   * for it to be a place you remember and few enough that it is not the road.
   *
   * Coverage survives it: the rarest kind at 0.08 of the deck is expected inside a
   * dozen districts, which is some 600 km — well inside the drive this world is
   * supposed to show everything in.
   */
  readonly weight: number;
}

/**
 * The six kinds, and they are deliberately far apart. A set whose members differ by
 * twenty per cent is one character with noise on it; these differ by a factor of
 * twenty in corner radius and a factor of eight in cadence, so a district announces
 * itself within a few hundred metres of entering it.
 *
 * THE ONE HARD CONSTRAINT IS THE NO-CROSSING BOUND. Total heading is the route wander
 * plus the corner bearing, and forward progress along the road is only strictly
 * positive while that stays under 90 degrees — the road must never double back on
 * itself, or the spine self-intersects and `project` has two answers. So every
 * character below keeps `deviation + headingMax <= 1.45 rad` (83 degrees), which is
 * the budget the single old character used. Switchbacks spend theirs on the corner
 * and leave the wander small; a pan road spends almost nothing on either.
 */
export const CHARACTERS: readonly RoadCharacter[] = [
  {
    // The pan: a horizon-to-horizon straight with a kink every few kilometres. This is
    // the one that makes the others mean something.
    name: 'pan',
    weight: 0.22,
    designSpeedKmh: 110,
    cornerSpacing: 4_000,
    radiusMin: 600,
    radiusMax: 1_400,
    headingMin: 0.1,
    headingMax: 0.28,
    deviation: 0.25,
    straightShare: 0.82,
    bankShare: 0.2,
  },
  {
    // Open highway: long fast sweepers, the pace a catalogue saloon is happiest at.
    name: 'highway',
    weight: 0.22,
    designSpeedKmh: 110,
    cornerSpacing: 2_200,
    radiusMin: 320,
    radiusMax: 800,
    headingMin: 0.18,
    headingMax: 0.45,
    deviation: 0.55,
    straightShare: 0.6,
    bankShare: 1,
  },
  {
    // Rolling country: the old default, kept because it is a good road — a corner a
    // kilometre at a radius that asks for a lift rather than a brake.
    name: 'rolling',
    weight: 0.24,
    designSpeedKmh: 80,
    cornerSpacing: 1_100,
    radiusMin: 140,
    radiusMax: 320,
    headingMin: 0.22,
    headingMax: 0.52,
    deviation: 0.93,
    straightShare: 0.45,
    bankShare: 0.75,
  },
  {
    // Switchbacks: mountain road. The tightest, most relentless district, and the
    // only one where a catalogue saloon works through the gears on the flat.
    //
    // THE RADII ARE THE CONTROLLER'S ENVELOPE, NOT THE MOUNTAIN'S. 60-120 m at a
    // corner every 300 m was built and measured first, and the stream cannot drive it:
    // on seed 1337 the ego made 13 km/h of a 82 km/h road with 67% of its time off the
    // asphalt, the stream took 11 contacts, two bodies were thrown out of the world and
    // the longest stop was 92 s. Curve widening recovered most of the excursions (zero
    // ejections, zero ego contacts, 25 km/h) but not the pace: a stream of ordinary
    // saloons queues and jams in continuous 90 m bends.
    //
    // What holds up is the envelope the lane-keeping was proven on. 110-200 m is still
    // a district nobody mistakes for any other — it is half the radius of the esses and
    // a sixth of the highway's — and the tighter road becomes available the day the
    // corner-speed calibration on loose surfaces is done, which is the AI work this
    // measurement names.
    name: 'switchback',
    weight: 0.1,
    designSpeedKmh: 55,
    // A corner every 380 m is nearly back-to-back: the transition a 155 m radius
    // through 0.85 rad needs is about 250 m, so the straight between corners is a
    // breath rather than a rest.
    cornerSpacing: 380,
    radiusMin: 110,
    radiusMax: 200,
    headingMin: 0.45,
    headingMax: 0.85,
    deviation: 0.45,
    straightShare: 0.2,
    bankShare: 0.9,
  },
  {
    // Esses: a rhythm rather than a sequence of events — alternating medium corners
    // with almost no straight between them.
    name: 'esses',
    weight: 0.14,
    designSpeedKmh: 70,
    // One size up from the switchbacks and with less angle: a 200 m radius through
    // 0.8 rad winds on over about 300 m, so 500 m of section is a continuous rhythm
    // rather than a sequence of events.
    cornerSpacing: 500,
    radiusMin: 150,
    radiusMax: 260,
    headingMin: 0.35,
    headingMax: 0.6,
    deviation: 0.7,
    straightShare: 0.15,
    bankShare: 0.85,
  },
  {
    // Derelict: a road that was never surveyed, only bulldozed. Sharp kinks joined by
    // long crooked straights, and no banking at all.
    name: 'derelict',
    weight: 0.08,
    designSpeedKmh: 60,
    cornerSpacing: 1_600,
    radiusMin: 80,
    radiusMax: 180,
    headingMin: 0.4,
    headingMax: 0.8,
    deviation: 0.6,
    straightShare: 0.55,
    bankShare: 0,
  },
];

/** Where district `k` begins, metres. Exported for the corner sequence's layout. */
export function districtStartOf(seed: number, k: number): number {
  return districtStart(k, seed);
}

function districtStart(k: number, seed: number): number {
  if (k <= 0) return 0;
  return (
    HOME_DISTRICT_LENGTH_M +
    (k - 1) * DISTRICT_NOMINAL_M +
    (hashUnit2(seed ^ DISTRICT_TAG, k) - 0.5) * DISTRICT_JITTER_M
  );
}

/**
 * The district an arclength falls in. The jitter is bounded well below the nominal
 * length, so the answer is the nominal bucket or one of its neighbours and this is
 * three hashes rather than a search.
 */
function districtIndex(seed: number, s: number): number {
  const k = Math.max(0, Math.floor((s - HOME_DISTRICT_LENGTH_M) / DISTRICT_NOMINAL_M) + 1);
  if (s < districtStart(k, seed)) return k - 1;
  if (s >= districtStart(k + 1, seed)) return k + 1;
  return k;
}

/**
 * The district an arclength falls in, with its bounds, written into caller storage.
 *
 * Exported because the CORNER SEQUENCE has to be quantised to it. Sections cannot be
 * laid out on a continuously blended cadence: blending `cornerSpacing` moves every
 * section boundary as the character crossfades, the bearing a section is turning
 * towards jumps when the boundary slides past, and the heading field acquires a step.
 * Measured on seed 1337 over 2500 km with a blended cadence: a p1 corner radius of
 * five metres, which is a corner no road has. Sections belong to a district, a
 * district boundary IS a section boundary, and continuity is then carried by each
 * section starting from its predecessor's bearing.
 */
export interface DistrictSpan {
  index: number;
  start: number;
  end: number;
}

export function districtAt(seed: number, s: number, out: DistrictSpan): void {
  const k = districtIndex(seed, s);
  out.index = k;
  out.start = districtStart(k, seed);
  out.end = districtStart(k + 1, seed);
}

export function newDistrictBuffer(): DistrictSpan {
  return { index: 0, start: 0, end: 0 };
}

/**
 * Which character district `k` drew.
 *
 * THE PREDECESSOR IS EXCLUDED, which is what turns a coin toss into a sequence: two
 * identical districts in a row is a hundred kilometres of the same road, and at six
 * kinds that would happen at every sixth boundary. Excluding it is also what bounds
 * the coverage argument above, because every boundary is then guaranteed to be a
 * change.
 *
 * A chain has to start somewhere, and walking it back to the homestead would make a
 * height query O(distance). So districts are drawn in BLOCKS, exactly as the surface
 * districts in `gradient.ts` are: inside a block the chain is exact, and the block's
 * first district rejects the previous block's last as computed by an unchained pass
 * over that block. Only every fourth boundary can therefore repeat a character, and a
 * repeat is two districts rather than a region.
 */
const DISTRICTS_PER_BLOCK = 4;

function drawCharacter(seed: number, k: number, exclude: number): number {
  if (k <= 0) return 0;
  let total = 0;
  for (let i = 0; i < CHARACTERS.length; i++) {
    if (i !== exclude) total += CHARACTERS[i]!.weight;
  }
  let pick = hashUnit2(seed ^ DRAW_TAG, k) * total;
  for (let i = 0; i < CHARACTERS.length; i++) {
    if (i === exclude) continue;
    pick -= CHARACTERS[i]!.weight;
    if (pick <= 0) return i;
  }
  return exclude === 0 ? 1 : 0;
}

/**
 * The last character of block `b`, drawn WITHOUT knowing what came before the block.
 * This truncation is what keeps the chain O(1).
 */
function blockTail(seed: number, b: number): number {
  const first = b * DISTRICTS_PER_BLOCK;
  let previous = -1;
  let character = 0;
  for (let i = 0; i < DISTRICTS_PER_BLOCK; i++) {
    character = drawCharacter(seed, first + i, previous);
    previous = character;
  }
  return character;
}

/**
 * Characters of one block's districts, cached two blocks deep.
 *
 * Not an optimisation of a slow function but of a REPEATED one: the heading field asks
 * about the same district for tens of thousands of consecutive nodes, and two slots
 * make all but the first free. Safe to cache because a block is a pure function of
 * (seed, index) — the same answer in the spine worker and on the main thread.
 */
const blockCache: [Int8Array, Int8Array] = [new Int8Array(DISTRICTS_PER_BLOCK), new Int8Array(DISTRICTS_PER_BLOCK)];
const blockCacheKey: [number, number] = [Number.NaN, Number.NaN];
const blockCacheSeed: [number, number] = [Number.NaN, Number.NaN];
let blockCacheNext = 0;

function blockCharacters(seed: number, b: number): Int8Array {
  if (blockCacheKey[0] === b && blockCacheSeed[0] === seed) return blockCache[0];
  if (blockCacheKey[1] === b && blockCacheSeed[1] === seed) return blockCache[1];
  const slot = blockCacheNext;
  blockCacheNext = 1 - blockCacheNext;
  const out = blockCache[slot]!;
  const first = b * DISTRICTS_PER_BLOCK;
  let previous = b <= 0 ? -1 : blockTail(seed, b - 1);
  for (let i = 0; i < DISTRICTS_PER_BLOCK; i++) {
    const character = drawCharacter(seed, first + i, previous);
    out[i] = character;
    previous = character;
  }
  blockCacheKey[slot] = b;
  blockCacheSeed[slot] = seed;
  return out;
}

export function characterOf(seed: number, k: number): RoadCharacter {
  if (k <= 0) return CHARACTERS[0]!;
  const block = Math.floor(k / DISTRICTS_PER_BLOCK);
  return CHARACTERS[blockCharacters(seed, block)[k - block * DISTRICTS_PER_BLOCK]!]!;
}

/**
 * Character at an arclength, crossfaded across a district join.
 *
 * Written into caller storage: this is read per corner event and per road-mesh row,
 * and a fresh object per call would be an allocation in both hot paths.
 */
export function characterAt(seed: number, s: number, out: MutableCharacter): void {
  const k = districtIndex(seed, s);
  const here = characterOf(seed, k);
  const start = districtStart(k, seed);
  const end = districtStart(k + 1, seed);
  // Only one join can be inside the blend at a time: the blend is two orders of
  // magnitude shorter than a district.
  const fromStart = (s - start) / BLEND_M;
  const toEnd = (end - s) / BLEND_M;
  if (fromStart >= 1 && toEnd >= 1) {
    copyCharacter(here, 1, here, out);
    return;
  }
  if (fromStart < toEnd) {
    const t = Math.max(0, fromStart) * 0.5 + 0.5;
    copyCharacter(characterOf(seed, k - 1), t, here, out);
    return;
  }
  const t = Math.max(0, toEnd) * 0.5 + 0.5;
  copyCharacter(characterOf(seed, k + 1), t, here, out);
}

/** A character with writable fields, for the crossfade's output. */
export interface MutableCharacter {
  name: string;
  cornerSpacing: number;
  radiusMin: number;
  radiusMax: number;
  headingMin: number;
  headingMax: number;
  deviation: number;
  straightShare: number;
  bankShare: number;
  designSpeedKmh: number;
}

export function newCharacterBuffer(): MutableCharacter {
  return { ...CHARACTERS[0]! };
}

/**
 * `out = mix(other, here, t)`, with `t` the weight of `here`. The NAME follows
 * whichever side is dominant, because a name is a label rather than a quantity and
 * half of "switchback" is not a road.
 */
function copyCharacter(
  other: RoadCharacter,
  t: number,
  here: RoadCharacter,
  out: MutableCharacter,
): void {
  const smooth = t * t * (3 - 2 * t);
  const u = 1 - smooth;
  out.name = smooth >= 0.5 ? here.name : other.name;
  out.cornerSpacing = here.cornerSpacing * smooth + other.cornerSpacing * u;
  out.radiusMin = here.radiusMin * smooth + other.radiusMin * u;
  out.radiusMax = here.radiusMax * smooth + other.radiusMax * u;
  out.headingMin = here.headingMin * smooth + other.headingMin * u;
  out.headingMax = here.headingMax * smooth + other.headingMax * u;
  out.deviation = here.deviation * smooth + other.deviation * u;
  out.straightShare = here.straightShare * smooth + other.straightShare * u;
  out.bankShare = here.bankShare * smooth + other.bankShare * u;
  out.designSpeedKmh = here.designSpeedKmh * smooth + other.designSpeedKmh * u;
}

/**
 * A per-district draw in `[0, 1)` for anything that wants to vary with the district
 * without being part of its character — the passing-window density, for instance.
 */
export function districtDraw(seed: number, s: number, tag: number): number {
  return hashUnit3(seed ^ DRAW_TAG, districtIndex(seed, s), tag);
}
