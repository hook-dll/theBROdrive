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
   * Consecutive sections that turn the SAME way, 1 or more.
   *
   * Alternating every section is a ribbon of bends and nothing else — which is what a
   * country road is, so 1 is the common value. But a road following a valley flank or
   * skirting an upland runs ONE way for a kilometre or more, and a generator that can
   * only alternate has no such thing in it: `tools/road-selfcross.ts` requires the
   * longest one-way run of a drive to be at least 1.5 km, and with every kind at 1 the
   * best any seed managed was 580 m. A regional road is where that belongs, and 4-6
   * sections of it is a sweep you feel.
   */
  readonly signRun: number;
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
 * THE FOUR KINDS, and they are what a middle-belt road is instead of what a desert was.
 *
 * The old set had a 'pan' (a horizon-to-horizon straight, 12.6 km median radius) and a
 * 'highway' (2.2 km), and those two were 44% of the deck; every drive also OPENED with
 * 28-36 km of pan, because the home district is `CHARACTERS[0]`. Measured on the owner's
 * drive, the whole-road median radius was 3-4 km. A road like that is not a Russian
 * просёлок, and the owner said so: "дорога стала значительно более прямой и не петляет
 * так, как в пустыне".
 *
 * WHAT A REAL ONE MEASURES. No Russian GIS survey of road curvature could be found, so
 * the reference is the two large measured sets that do exist: the Czech national survey
 * of secondary roads (9 980 km, 42 752 curves, ROCA toolbox) and a Norwegian laser-scan
 * survey of rural two-lane roads (63 969 curves). They agree closely:
 *
 *   curves                     4-5 per km
 *   share of length in curves  36-43%
 *   curve length               about 100 m (mean 98 m)
 *   straight between curves    mean 90-130 m
 *   peak radius                mostly 50-250 m; >40% of curves under 200 m
 *   turning                    94 deg/km median, 224 deg/km mean
 *   radius of the designed new road  >= 3000 m (SP 34.13330.2021) -> which is why a
 *                                    REBUILT road is straight and an old one is not
 *
 * So a bend every 200-340 m, 100-140 m of it turning, and 15-25 degrees of heading per
 * bend. That is 3.5-5 curves per kilometre, which is the number this table is built to
 * and `tools/road-variety.ts` measures.
 *
 * THE ONE HARD CONSTRAINT IS STILL THE NO-CROSSING BOUND. Total heading is the route
 * wander plus the corner bearing, and forward progress along the road is only strictly
 * positive while that stays under 90 degrees — the road must never double back on
 * itself, or the spine self-intersects and `project` has two answers. Every kind below
 * keeps `deviation + headingMax <= 1.45 rad` (83 degrees), which was the old budget
 * exactly; what changed is how the budget is SPENT. A straight road spends almost none
 * of it, and the corners here are tighter and far more frequent, so the spend per
 * kilometre is what went up.
 */
export const CHARACTERS: readonly RoadCharacter[] = [
  {
    // ПРОСЁЛОК: the country road itself, and the FIRST kind — which makes it the home
    // district, so the drive leaves the house on a road that winds. 220 m a bend, 130 m
    // of it turning, a 150-300 m radius: 4.5 curves per kilometre.
    name: 'proselok',
    weight: 0.34,
    designSpeedKmh: 70,
    cornerSpacing: 190,
    radiusMin: 170,
    radiusMax: 320,
    headingMin: 0.26,
    headingMax: 0.44,
    deviation: 0.8,
    straightShare: 0.35,
    signRun: 2,
    bankShare: 0.7,
  },
  {
    // РЕГИОНАЛЬНАЯ: the maintained one — a bend every 340 m with a longer radius, and
    // half the section on the new bearing. Still nothing like the old 'highway': a
    // designed regional road straightens to kilometres, and this is a road that has been
    // resurfaced, not re-cut.
    name: 'region',
    weight: 0.16,
    designSpeedKmh: 90,
    cornerSpacing: 620,
    radiusMin: 300,
    radiusMax: 700,
    headingMin: 0.16,
    headingMax: 0.3,
    deviation: 0.5,
    straightShare: 0.45,
    signRun: 5,
    bankShare: 1,
  },
  {
    // ПОЛЕВАЯ: the road that turns with the field edges — a bend every 260 m, tighter
    // than the просёлок and through a larger angle, which is what a dogleg round a plot
    // corner is.
    name: 'field',
    weight: 0.22,
    designSpeedKmh: 72,
    cornerSpacing: 220,
    radiusMin: 150,
    radiusMax: 280,
    headingMin: 0.28,
    headingMax: 0.52,
    deviation: 0.7,
    straightShare: 0.34,
    signRun: 1,
    bankShare: 0.65,
  },
  {
    // ЛЕСНАЯ: through woodland, where the road threads between the trunks and there is
    // no straight at all — a bend every 180 m with almost no bearing held.
    name: 'wood',
    weight: 0.28,
    designSpeedKmh: 70,
    cornerSpacing: 160,
    radiusMin: 160,
    radiusMax: 300,
    headingMin: 0.22,
    headingMax: 0.42,
    deviation: 0.85,
    straightShare: 0.22,
    signRun: 1,
    bankShare: 0.6,
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
