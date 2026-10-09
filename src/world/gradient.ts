import { hash01, Noise1D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH } from './road';

/**
 * Every property that changes over a long drive is a function of arclength and
 * lives here, but arclength now plays TWO different roles:
 *
 *  - `drift(s)` accumulates 0..1 over the whole road and drives only REMOTENESS:
 *    star density, the galactic band, the aurora. Distance from home must not come
 *    back around.
 *  - Road quality and colour are stationary or cyclic in ABSOLUTE distance. Decay
 *    ALTERNATES in 3-5 km wear bands (new, tired, abandoned, in turn) plus a fine
 *    patch, and never grows with distance; the desert palette (and the dust, haze
 *    and sky tint that track it) cycles with a fixed period, so a driver who
 *    covers a full cycle sees every colour and then begins again. Wear stops at
 *    MAX_WEAR rather than running to ruin.
 *
 * Nothing else may hardcode a distance threshold. Road decay, pole design eras,
 * sky and monument placement all read from this module, which means the whole feel
 * of "km 900 is not km 9" can be retuned in one file.
 */

/**
 * Monotonic 0..1 over the whole road. ONLY for cues that must accumulate with
 * total distance. Road quality and colour deliberately no longer use it.
 */
export function drift(s: number): number {
  return Math.min(1, Math.max(0, s / ROAD_LENGTH));
}

/**
 * Period of the desert colour cycle, metres.
 *
 * A driver who covers this distance has seen the whole palette and begins again. The
 * cyclic sky channels (dust, haze, sky tint) share this period so they move with the
 * colour; the remoteness channels deliberately do not.
 *
 * It was 4 000 km, which is the one figure in this file that nobody could ever have
 * reached: it meant a 2 500 km drive saw five eighths of the palette and never the
 * rest. Then 2 000 km, one full turn inside a drive of that length. It is 1 000 km
 * now, with twice as many deserts on the ring: a long drive goes round it more than
 * twice, and a desert still holds pure for 16-25 km, ten to fifteen minutes at road
 * speed, so consecutive stretches look like the same country rather than a slideshow.
 */
export const PALETTE_CYCLE_M = 1_000_000;

// ---------------------------------------------------------------------------
// Road decay
// ---------------------------------------------------------------------------

export interface RoadCondition {
  /** Dominant surface of the driving lanes at this distance. */
  readonly surface: SurfaceType;
  /** 0 = pristine, MAX_WEAR = as broken as the desert is ever allowed to leave it. */
  readonly decay: number;
  /** Fraction of the lane width buried under drifted sand, 0..1. */
  readonly sandCover: number;
  /** Whether painted lane markings are still visible. */
  readonly markings: number;
}
/** Caller-owned storage for hot-path condition sampling without per-tick allocation. */
export interface RoadConditionBuffer {
  surface: SurfaceType;
  decay: number;
  sandCover: number;
  markings: number;
}

/** Distance over which local decay varies, so decay is patchy rather than uniform. */
const DECAY_PATCH_WAVELENGTH = 900;

/**
 * THE DEEPEST WEAR THE WORLD IS EVER SHOWN, on any dial that ages with distance.
 *
 * Beyond it the road stops being a road: sand buries the lanes, the paint is gone, the
 * potholes stop being a surface and become an obstacle course, the mat ravels into the
 * verge, and the poles are lying in the sand. That is a wreck, not a drive, and a
 * player who meets it reads the world as broken rather than as old — the desert is
 * supposed to be worn, not unusable.
 *
 * Measured on the shipped road (200 000 samples, tools/road-condition.ts): raw decay
 * runs 0.00..1.00 with a median of 0.49, and 31.9% of the road is above this ceiling.
 * Those stretches now all read as the same deeply-worn road, which is the point: the
 * ceiling is a state the generator clamps to, not a scale it compresses, so every
 * stretch that was already inside 0..0.6 keeps exactly the condition it had.
 *
 * Read by `roadConditionAt` and `poleConditionAt`, and by the tools that have to be
 * able to construct the worst case.
 */
export const MAX_WEAR = 0.6;

const decayNoise = new Noise1D(0x51ed270b);

/**
 * WEAR BANDS: how kept-up the road is, ALTERNATING along the whole drive.
 *
 * There is deliberately no distance ramp and no slow regional envelope any more. A
 * 300 km envelope made whole sessions abandoned and whole sessions pristine, and the
 * owner's call is that the road is never "worse the further you go": new, middling and
 * abandoned stretches take turns everywhere, in measure.
 *
 * So the road is cut into bands of 3-5 km, and each band draws a wear LEVEL from a
 * small deck that excludes its predecessor's level, so two neighbouring bands always
 * differ. Levels are blended over WEAR_BLEND_M either side of a boundary, and the fine
 * patch noise on top keeps a band from reading as one flat value.
 */
const WEAR_BAND_M = 4000;
const WEAR_BAND_JITTER_M = 1800;
const WEAR_TAG = 0x77ea12;
/** Half-width of the blend between two bands' levels, metres. */
const WEAR_BLEND_M = 350;
/** Wear levels (0 fresh .. MAX_WEAR abandoned) and how often each is drawn. */
const WEAR_LEVELS: readonly number[] = [0.03, 0.17, 0.3, 0.44, 0.58];
const WEAR_WEIGHTS: readonly number[] = [0.22, 0.24, 0.24, 0.18, 0.12];

/** One weighted draw from the level deck, with `exclude` removed (-1 for none). */
function drawWearLevel(roll: number, exclude: number): number {
  let total = 0;
  for (let i = 0; i < WEAR_WEIGHTS.length; i++) if (i !== exclude) total += WEAR_WEIGHTS[i]!;
  let pick = roll * total;
  for (let i = 0; i < WEAR_WEIGHTS.length; i++) {
    if (i === exclude) continue;
    pick -= WEAR_WEIGHTS[i]!;
    if (pick <= 0) return i;
  }
  return WEAR_WEIGHTS.length - 1 === exclude ? 0 : WEAR_WEIGHTS.length - 1;
}

/**
 * The level index of band `k` under tag `tag`. The first band is always fresh (the
 * drive opens on a maintained road). A band rejects its predecessor's UNCHAINED draw,
 * which keeps this O(1); a repeat is therefore rare and at most two bands long.
 */
function wearLevelIndex(tag: number, k: number): number {
  if (k <= 0) return 0;
  const raw = (j: number): number => (j <= 0 ? 0 : drawWearLevel(hash01(tag, j, 1), -1));
  return drawWearLevel(hash01(tag, k, 2), raw(k - 1));
}

/**
 * Banded wear at `s` for the band scheme (`tag`, nominal length, jitter), blended
 * smoothly across boundaries.
 */
function bandedWear(s: number, tag: number, nominal: number, jitter: number, blend: number): number {
  const start = (k: number): number => k * nominal + (hash01(tag, k, 0) - 0.5) * jitter;
  let k = Math.floor(s / nominal);
  if (s < start(k)) k -= 1;
  else if (s >= start(k + 1)) k += 1;
  const here = WEAR_LEVELS[wearLevelIndex(tag, k)]!;
  const toStart = s - start(k);
  const toEnd = start(k + 1) - s;
  if (toStart >= blend && toEnd >= blend) return here;
  const nearStart = toStart < toEnd;
  const other = WEAR_LEVELS[wearLevelIndex(tag, nearStart ? k - 1 : k + 1)]!;
  const u = 1 - Math.min(toStart, toEnd) / blend;
  const t = 0.5 * u * u * (3 - 2 * u);
  return here + (other - here) * t;
}

/** The wear level the band scheme gives the road at `s`, before the fine patch. */
export function roadWearLevelAt(s: number): number {
  return bandedWear(s, WEAR_TAG, WEAR_BAND_M, WEAR_BAND_JITTER_M, WEAR_BLEND_M);
}

/**
 * SURFACE DISTRICTS: which MATERIAL the lanes are made of, and the fix for a road
 * that changed surface twice and then held one for a hundred kilometres.
 *
 * THE OLD MODEL WAS THRESHOLDS ON DECAY, and that is why it failed. Surface was
 * `decay < 0.38 ? asphalt : decay < 0.64 ? cracked : gravel`, so the material was a
 * SLICE of a field whose regional envelope moves over 300 km. Wherever the envelope
 * sat far from a threshold, the ±0.28 patch noise could not reach one and the surface
 * could not change: measured on the shipped road, gravel held for 170 km and asphalt
 * for 110 km. The first two changes then landed almost on top of the garage ramp —
 * decay is held flat to 5 km and rises after it, so the first crossing of 0.38
 * happened just past 5.0 km, which reads as a scripted event at a round number.
 *
 * So material is no longer derived from decay at all. The road is cut into DISTRICTS
 * of 5-7 km, each district draws its own material, and decay keeps the job it is good
 * at: how broken that material is (cracks, patches, bumps, sand cover, paint).
 *
 * Boundaries are `k * NOMINAL + jitter(k)` with the jitter bounded below half the
 * nominal, which buys two things: a district's length is `NOMINAL + jitter(k+1) -
 * jitter(k)`, i.e. 5-7 km and never a round number, and any `s` lies in district
 * `floor(s / NOMINAL)` plus or minus one, so the lookup is three hashes and no search.
 *
 * The DRAW is weighted by the region, so a maintained district is probably sealed and
 * an abandoned one is probably gravel — the regional character survives — but no
 * region can suppress turnover, because every district draws again from a deck that
 * EXCLUDES its predecessor's material. Adjacent districts therefore differ and a run
 * of one surface is one district long.
 *
 * The chain has to start somewhere, and walking it back to the garage would make a
 * height query O(distance). So districts are drawn in BLOCKS of four: inside a block
 * the chain is exact, and the block's first district rejects the previous block's last
 * as computed by an unchained pass over that block. Only every fourth boundary can
 * therefore repeat a material, and a repeat is two districts (about 12 km), never a
 * region. `tools/road-condition.ts` reports the run-length census that bounds it: the
 * thresholds it replaces measured a 170 km run of gravel and a 110 km run of asphalt.
 */
const DISTRICT_NOMINAL_M = 6000;
/** Peak-to-peak jitter of a boundary, metres: district lengths land in 5-7 km. */
const DISTRICT_JITTER_M = 1000;
/** Hash domain for the boundary jitter and the material draws. */
const DISTRICT_TAG = 0x5ce7a1;

/**
 * The materials a district can be made of, and how the region weights them.
 *
 * Concrete has no field of its own any more. It used to be a separate 8 km noise
 * gated on decay, which is one more thing to keep in step with the rest; as a deck
 * member it inherits the district length and the regional weighting for free, and its
 * share is now this weight rather than a threshold tuned against a distribution.
 */
const DISTRICT_SURFACES: readonly SurfaceType[] = [
  SurfaceType.Asphalt,
  SurfaceType.CrackedAsphalt,
  SurfaceType.Gravel,
  SurfaceType.Concrete,
];

/**
 * Weights, in `DISTRICT_SURFACES` order, as a function of the region's mean decay.
 *
 * Asphalt and gravel are the ends of the same axis and cross over around a regional
 * decay of 0.45; cracked asphalt is the everywhere surface and rises with decay;
 * concrete is old maintained motorway, so it fades out as the region is abandoned.
 * Tuned against the census in `tools/road-condition.ts` to land near asphalt 30%,
 * cracked 35%, gravel 25%, concrete 10%.
 *
 * THE GLOBAL SHARE WAS NEVER THE PROBLEM; THE LOCAL ONE WAS. Those figures are what
 * the full road measures, and it does: gravel is 25.8% of forty thousand kilometres.
 * But the regional envelope moves over 300 km, and the weights above let it take the
 * sealed surfaces to ZERO — asphalt at a regional 0.79, concrete at 0.77 — so an
 * abandoned region drew nothing but gravel and cracked asphalt for its whole length.
 * Measured per 40 km window, which is about a session's driving: a median of 28% hard
 * going, a p90 of 48% and a worst of 64%. The bench's own stretch at s 40 000 is one
 * of those: 48% gravel, and the stream's pace there is a third below what the road
 * elsewhere allows.
 *
 * So the region still decides the CHARACTER — a kept-up region is mostly sealed, an
 * abandoned one is mostly broken — but it no longer decides the surface outright. The
 * sealed floor keeps a good district available in the worst region, and the gravel
 * ceiling stops it from taking the whole deck in the worst one. Hard going stays what
 * it is meant to be: a quarter of the road, met as an event rather than as a carpet.
 *
 * Written into a module scratch array rather than returned: a block fill draws four
 * times and `roadConditionAt` is called per road-mesh vertex row.
 */
const districtWeights = new Float64Array(4);
/** Weight the sealed surfaces keep however abandoned the region is. */
const SEALED_WEIGHT_FLOOR = 0.35;
/** And the weight gravel may never exceed, so it cannot own a region's whole deck. */
const GRAVEL_WEIGHT_CEILING = 0.65;

function weighDistrict(regional: number): number {
  districtWeights[0] = Math.max(SEALED_WEIGHT_FLOOR, 1.5 - 1.9 * regional);
  districtWeights[1] = 0.3 + 0.45 * regional;
  districtWeights[2] = Math.min(GRAVEL_WEIGHT_CEILING, Math.max(0, 1.5 * regional - 0.3));
  districtWeights[3] = 0.24 * Math.max(0, 1 - 1.3 * regional);
  return districtWeights[0]! + districtWeights[1]! + districtWeights[2]! + districtWeights[3]!;
}

/** Where district `k` begins, metres. */
function districtStart(k: number): number {
  return k * DISTRICT_NOMINAL_M + (hash01(DISTRICT_TAG, k) - 0.5) * DISTRICT_JITTER_M;
}

/**
 * The district a distance falls in. The jitter is bounded well below the nominal
 * length, so the answer is the nominal bucket or one of its neighbours and this stays
 * three hashes rather than a search.
 */
function districtIndex(s: number): number {
  const k = Math.floor(s / DISTRICT_NOMINAL_M);
  if (s < districtStart(k)) return k - 1;
  if (s >= districtStart(k + 1)) return k + 1;
  return k;
}

/**
 * The mix the material deck is weighed at. It used to follow a 300 km regional
 * envelope, which let a whole session's region be gravel; now every district draws
 * from the same mix, so sealed and broken surfaces alternate everywhere.
 */
const DISTRICT_MIX = 0.45;

/**
 * One weighted draw for district `k`, with `exclude` removed from the deck (-1 for
 * none). District 0 and anything before it is always sealed asphalt: it holds the
 * garage opening, and it terminates the chain.
 */
function drawDistrict(k: number, regional: number, exclude: number): SurfaceType {
  if (k <= 0) return SurfaceType.Asphalt;
  let total = weighDistrict(regional);
  if (exclude >= 0) {
    for (let i = 0; i < DISTRICT_SURFACES.length; i++) {
      if (DISTRICT_SURFACES[i] === exclude) {
        total -= districtWeights[i]!;
        districtWeights[i] = 0;
      }
    }
  }
  let pick = hash01(DISTRICT_TAG, k) * total;
  for (let i = 0; i < DISTRICT_SURFACES.length; i++) {
    pick -= districtWeights[i]!;
    if (pick <= 0) return DISTRICT_SURFACES[i]!;
  }
  return SurfaceType.CrackedAsphalt;
}

/** Districts per drawn block. Four keeps the fill to four draws and one envelope. */
const DISTRICTS_PER_BLOCK = 4;

/**
 * The regional weighting is sampled ONCE per block, at its centre, not once per
 * district. The envelope's wavelength is 300 km and a block is 24 km, so the two
 * differ by under a hundredth — and it turns four fbm evaluations into one.
 */
function blockRegional(_b: number): number {
  return DISTRICT_MIX;
}

/**
 * The last material of block `b`, drawn WITHOUT knowing what came before the block.
 * This is the truncation that keeps the chain O(1): it is what the next block's first
 * district rejects, and it is why one boundary in four can still repeat a material.
 */
function blockTail(b: number): SurfaceType {
  const regional = blockRegional(b);
  const first = b * DISTRICTS_PER_BLOCK;
  let prev = -1;
  let material = SurfaceType.Asphalt;
  for (let i = 0; i < DISTRICTS_PER_BLOCK; i++) {
    material = drawDistrict(first + i, regional, prev);
    prev = material;
  }
  return material;
}

/**
 * Materials of the four districts in one block, cached two blocks deep.
 *
 * The cache is not an optimisation of a slow function so much as of a REPEATED one:
 * every road-mesh vertex row, every collider row and every terrain query near the road
 * asks about the same block, and a two-slot cache makes all but the first free. It is
 * safe to cache because a block is a pure function of its index — same seedless
 * hashes, same answer, in the worker and on the main thread alike.
 */
const blockCache: [Int8Array, Int8Array] = [new Int8Array(4), new Int8Array(4)];
const blockCacheIndex: [number, number] = [Number.NaN, Number.NaN];
let blockCacheNext = 0;

function blockMaterials(b: number): Int8Array {
  if (blockCacheIndex[0] === b) return blockCache[0];
  if (blockCacheIndex[1] === b) return blockCache[1];
  const slot = blockCacheNext;
  blockCacheNext = 1 - blockCacheNext;
  const out = blockCache[slot]!;
  const regional = blockRegional(b);
  const first = b * DISTRICTS_PER_BLOCK;
  let prev: number = b <= 0 ? SurfaceType.Asphalt : blockTail(b - 1);
  for (let i = 0; i < DISTRICTS_PER_BLOCK; i++) {
    const material = drawDistrict(first + i, regional, prev);
    out[i] = material;
    prev = material;
  }
  blockCacheIndex[slot] = b;
  return out;
}

/** The material of district `k`. */
function districtSurface(k: number): SurfaceType {
  const b = Math.floor(k / DISTRICTS_PER_BLOCK);
  return blockMaterials(b)[k - b * DISTRICTS_PER_BLOCK]! as SurfaceType;
}

/**
 * HOW FAR A MATERIAL JOIN IS FEATHERED, metres.
 *
 * A district's material is a STEP of arclength, and so was every amplitude read from
 * it — most visibly `BUMP_AMP` in `roadsurface.ts`, where the deck's short-scale
 * roughness changed by up to 3 cm between one sample and the next at a join and left a
 * crease right across the road, exactly where two pieces of road meet. The surface
 * field feathers that amplitude over this half-width instead, so two materials meet
 * over 80 m of road rather than at a line. The COLOUR still changes at the boundary: a
 * new course of bitumen is a visible thing, and it is the roughness that must not step.
 */
export const SURFACE_JOIN_BLEND_M = 40;

/** Caller-owned storage for `surfaceJoinAt`; the surface field asks per vertex. */
export interface SurfaceJoinBuffer {
  /** Material on the other side of the nearer district boundary. */
  neighbour: SurfaceType;
  /** 0 away from a boundary, 0.5 exactly at it: how much of the neighbour applies. */
  t: number;
}

/**
 * The material join at `s`: the neighbour across the nearer district boundary and how
 * far the blend has moved toward it, smoothstepped so the amplitude is C1 in `s`.
 * District 0 has asphalt on both sides (it IS asphalt), so the road's beginning is not
 * a join.
 */
export function surfaceJoinAt(s: number, out: SurfaceJoinBuffer): void {
  const k = districtIndex(s);
  const start = k > 0 ? districtStart(k) : 0;
  const end = districtStart(k + 1);
  const distance = Math.min(s - start, end - s);
  if (distance >= SURFACE_JOIN_BLEND_M) {
    out.neighbour = districtSurface(k);
    out.t = 0;
    return;
  }
  const u = 1 - distance / SURFACE_JOIN_BLEND_M;
  out.t = 0.5 * u * u * (3 - 2 * u);
  out.neighbour =
    s - start <= end - s
      ? k > 0
        ? districtSurface(k - 1)
        : districtSurface(0)
      : districtSurface(k + 1);
}

/**
 * Road condition at a distance.
 *
 * Two independent things, and keeping them independent is the point:
 *
 *  - MATERIAL comes from the 5-7 km surface districts above, weighted by the region.
 *  - DECAY alternates in wear bands (see WEAR_LEVELS): fresh, tired and abandoned
 *    stretches take turns along the whole road, with a small patch noise on top. The
 *    first band is always fresh.
 *
 * Decay is clamped to MAX_WEAR, so the broken half of that range stops at the worst
 * road the world is willing to show. Everything downstream — sand cover, markings,
 * bump amplitude, pothole density, the weather on the vertex colours — is a function of
 * the clamped value, so the ceiling is one decision rather than eight.
 *
 * A gravel district at low decay is a well-kept gravel road and an asphalt district at
 * high decay is a worn one; both are things a desert road actually is, and neither
 * was reachable while the material WAS a threshold on the decay.
 */
export function roadConditionAt(s: number, out?: RoadConditionBuffer): RoadCondition {
  // The band's level, then the fine patch: how broken this particular stretch is.
  const patch = decayNoise.fbm(s / DECAY_PATCH_WAVELENGTH, 3, 2.1, 0.45) * 0.12;
  const decay = Math.min(MAX_WEAR, Math.max(0, roadWearLevelAt(s) + patch));
  const surface = districtSurface(districtIndex(s));
  const condition = out ?? { surface, decay, sandCover: 0, markings: 0 };
  condition.surface = surface;
  condition.decay = decay;
  // Sand only starts drifting across the lanes once the surface is breaking up.
  condition.sandCover = Math.min(0.85, Math.max(0, (decay - 0.45) * 1.6));
  // Nothing paints an unsealed road, however well kept it is.
  condition.markings =
    surface === SurfaceType.Gravel ? 0 : Math.max(0, 1 - decay * 1.9);
  return condition;
}

// ---------------------------------------------------------------------------
// Roadside pole eras
// ---------------------------------------------------------------------------

/**
 * Poles come in design generations. Crossing between eras is the clearest possible
 * signal that you have travelled somewhere genuinely different, because the
 * silhouette on the horizon changes: timber, then steel, then concrete. Inside an era
 * the line is rebuilt in sections of its own design (`poleSections`,
 * world/props/poles.ts), so the era names the material and the section the pole.
 */
export type PoleEra = 'timber' | 'steel' | 'concrete';

export interface PoleCondition {
  readonly era: PoleEra;
  /** 0 = upright and intact, MAX_WEAR = as far gone as the world ever shows one. */
  readonly dilapidation: number;
  /** Probability a given wire of a span is still up. */
  readonly wireChance: number;
}

/**
 * Pole eras are absolute-distance bands, not fractions of the road, so the order
 * never reads as a loop and each band's era is drawn from a fixed hash stream.
 *
 * THE LENGTH IS A COVERAGE FIGURE. At 1 000 km a 2 500 km drive crossed two or three
 * bands and met two eras — measured on seed 1337: concrete and lattice, nothing else,
 * so part of the roadside the world can build was content a player would never see.
 * At 300 km a 2 500 km drive crosses eight bands, which meets all three eras and still
 * gives each one three or four hours of driving to be the world's normal.
 */
const POLE_ERA_BAND_M = 300_000;

/** Domain tag separating the pole-era-band hash stream from every other hash01 use. */
const POLE_ERA_TAG = 0x0e7a5e;

/**
 * Every band has a line. There used to be a band in four with no poles at all; the
 * owner's call is that the road is never without them, so that roll is gone and the
 * era is drawn from the same channel it always was.
 */
function poleEraForBand(band: number): PoleEra {
  const pick = hash01(POLE_ERA_TAG, band, 1);
  if (pick < 0.25) return 'timber';
  if (pick < 0.6) return 'steel';
  return 'concrete';
}

export interface PoleEraBand {
  readonly start: number;
  readonly end: number;
  readonly era: PoleEra;
}

let poleEraBands: readonly PoleEraBand[] | null = null;

/** The pole era schedule, so world/props/poles.ts stops rediscovering it by probing. */
export function poleEraSegments(): readonly PoleEraBand[] {
  if (poleEraBands) return poleEraBands;
  const count = Math.ceil(ROAD_LENGTH / POLE_ERA_BAND_M);
  const bands: PoleEraBand[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * POLE_ERA_BAND_M;
    const end = Math.min((i + 1) * POLE_ERA_BAND_M, ROAD_LENGTH);
    bands.push({ start, end, era: poleEraForBand(i) });
  }
  poleEraBands = bands;
  return bands;
}

/**
 * Pole wear alternates on its own bands (7-11 km), exactly like the road's: a new
 * line, a tired one and a half-fallen one take turns everywhere, and nothing gets
 * worse with distance. Its own tag and length, so a fresh road can run beside an old
 * line and the other way round.
 */
const POLE_WEAR_TAG = 0x901e5;
const POLE_WEAR_BAND_M = 9000;
const POLE_WEAR_JITTER_M = 4000;

export function poleConditionAt(s: number): PoleCondition {
  const band = poleBandAt(s);
  const wear = bandedWear(s, POLE_WEAR_TAG, POLE_WEAR_BAND_M, POLE_WEAR_JITTER_M, 400);
  return {
    era: band.era,
    // Clamped like road decay: a line ends leaning, not lying in the sand.
    dilapidation: Math.min(MAX_WEAR, wear),
    // Most of the wire is up on a kept line and most of it gone on an abandoned one.
    wireChance: Math.max(0, Math.min(1, 1.05 - wear * 1.45)),
  };
}

function poleBandAt(s: number): PoleEraBand {
  const bands = poleEraSegments();
  for (const b of bands) {
    if (s < b.end) return b;
  }
  return bands[bands.length - 1]!;
}

// ---------------------------------------------------------------------------
// Sky: cyclic colour channels and monotonic remoteness
// ---------------------------------------------------------------------------

export interface SkyGradient {
  /** Atmospheric dust load, 0..1. Reddens and lengthens sunsets. */
  readonly dust: number;
  /** Multiplier on visible star count. Rises with distance from anywhere. */
  readonly starDensity: number;
  /** Visibility of the galactic band, 0..1. */
  readonly galaxy: number;
  /** Aurora intensity, 0..1. Has no business over a desert, which is the point. */
  readonly aurora: number;
  /** Daytime sky tint, shifting slowly away from familiar blue. */
  readonly skyHueShift: number;
  /** Fog density multiplier, so distance haze thickens with dust. */
  readonly haze: number;
  /**
   * How much of the sky the cirrus deck covers, 0..1.
   *
   * Weather, not geology, so it moves on a much shorter cycle than the palette: bands
   * of thickening and thinning high cloud a few hundred kilometres wide. It never
   * reaches 0 or 1 — a desert sky is rarely either swept clean or shut in, and the
   * deck is what gives the sky something to do at noon.
   */
  readonly cloudCover: number;
}

/** Drift at which the aurora begins to appear at all. */
const AURORA_ONSET = 0.55;

/**
 * Sky is split in two so colour and remoteness no longer share one ramp:
 *
 *  - CYCLIC channels move with the desert colour on PALETTE_CYCLE_M and come back
 *    around with it: `dust`, `haze`, `skyHueShift`.
 *  - MONOTONIC channels accumulate with `drift(s)` and never come back around:
 *    `starDensity`, `galaxy`, `aurora`. Distance from home must not repeat.
 *
 * ALL THREE CYCLIC CHANNELS ARE AT THEIR MINIMUM AT s = 0, and that is deliberate
 * rather than a coincidence. `dust` used to PEAK there — `0.5 + 0.5cos` is 1 at
 * t = 0 — so a new drive opened on the single most turbid sky in the whole cycle,
 * with the pale blue horizon dragged 35% toward the turbid tan and the fog at its
 * thickest. The opening is supposed to be the clean, familiar desert sky for the same
 * reason the sand at s = 0 is the familiar ochre.
 *
 * They are decorrelated by HARMONIC rather than by phase, which is the only way to
 * have all three start low and still not move together: first harmonic for dust,
 * second for haze, third for the hue shift. So they leave the opening in step and
 * immediately drift apart.
 */
export function skyGradientAt(s: number): SkyGradient {
  const p = drift(s);
  const t = s / PALETTE_CYCLE_M;
  return {
    dust: 0.5 - 0.5 * Math.cos(2 * Math.PI * t),
    starDensity: 1 + p * 3.5,
    galaxy: Math.min(1, Math.max(0, (p - 0.18) * 1.8)),
    aurora: Math.min(1, Math.max(0, (p - AURORA_ONSET) / (1 - AURORA_ONSET)) ** 1.6),
    skyHueShift: 0.14 * (0.5 - 0.5 * Math.cos(6 * Math.PI * t)),
    haze: 1 + 2.2 * (0.5 - 0.5 * Math.cos(4 * Math.PI * t)),
    // Ten cycles per palette cycle — 400 km bands, so cloud is weather and reads on
    // the scale of an afternoon's driving rather than of a region. Sine rather than
    // the shifted cosines above because this one must NOT start at an extreme: the
    // opening sky wants its normal amount of cirrus, not a swept-clean one.
    cloudCover: 0.55 + 0.2 * Math.sin(2 * Math.PI * 10 * t),
  };
}

// ---------------------------------------------------------------------------
// Desert palette
// ---------------------------------------------------------------------------

export interface DesertPalette {
  /** Open sand albedo, 0xRRGGBB. */
  readonly sand: number;
  /**
   * The region's second sand, 0xRRGGBB: what the ground shader's broad patches move
   * toward (`setDesertGroundArclength` in terrainmesh.ts). The same material in another
   * state — pale gypsum crust, the lighter dust on a Martian plain, grey ash on lava.
   */
  readonly accent: number;
  /** Rock outcrop albedo, 0xRRGGBB. Always darker than `sand`. */
  readonly rock: number;
  /** Road shoulder / verge gravel albedo, 0xRRGGBB. Sits between the other two. */
  readonly gravel: number;
  /**
   * Sand thrown into the air by a wheel, 0xRRGGBB. The SAME hue and saturation as
   * `sand`, at a higher lightness — because it is the same material, only lit from
   * every side instead of shadowed by its neighbours.
   *
   * It lives here rather than being derived at the particle system because deriving
   * it there got it wrong: lifting the sand toward WHITE is a lift of all three
   * channels toward each other, so it desaturates as it brightens and `#d29459` came
   * out `#e5ccb5`, a neutral cream that no longer looked like the ground it left.
   * Raising lightness inside HSL keeps the colour recognisably that desert's sand at
   * every phase of the cycle, which is the whole point of the spray matching.
   */
  readonly spray: number;
}

/**
 * The palette works in UNQUANTISED sRGB triples (0..1) and packs to 0xRRGGBB exactly
 * once, at the end. Packing the blended sand first and deriving rock, gravel and spray
 * from the 8-bit result rounded twice: the HSL lightness drop amplifies a one-level
 * sand step into two in the rock, and that is a visible seam between two chunks. Plain
 * numbers so this module does not depend on three.js.
 */
type Rgb = [number, number, number];

function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Hue/saturation/lightness (hue circular, all 0..1) -> sRGB triple. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h - Math.floor(h)) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/** sRGB triple -> HSL (hue circular, all 0..1), written into `out`. */
function rgbToHsl(rgb: Rgb, out: { h: number; s: number; l: number }): void {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  out.l = l;
  if (d === 0) {
    out.h = 0;
    out.s = 0;
    return;
  }
  out.s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  out.h = h / 6;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Relative luminance (linear, Rec. 709) of an sRGB triple. */
function luminanceOf(rgb: Rgb): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/** Scales an sRGB triple in LINEAR light by `k` (same chromaticity, less of it) and packs it. */
function packScaled(rgb: Rgb, k: number): number {
  const channel = (c: number): number => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round((k >= 1 ? v : linearToSrgb(srgbToLinear(v) * k)) * 255);
  };
  return (channel(rgb[0]) << 16) | (channel(rgb[1]) << 8) | channel(rgb[2]);
}

type Lab = [number, number, number];

/** Packed 0xRRGGBB -> OKLab. */
function hexToOklab(hex: number): Lab {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The OKLab mix `a + (b - a)·w` as an sRGB triple, clamped into the gamut. */
function mixOklab(a: Lab, b: Lab, w: number): Rgb {
  const L = a[0] + (b[0] - a[0]) * w;
  const A = a[1] + (b[1] - a[1]) * w;
  const B = a[2] + (b[2] - a[2]) * w;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const channel = (v: number): number => linearToSrgb(Math.min(1, Math.max(0, v)));
  return [
    channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * One desert on the cycle: its sand, its second sand (see `DesertPalette.accent`), how
 * long it holds pure, and how long it takes to become the next one.
 *
 * THE CYCLE IS A RING OF DESERTS, NOT A HUE SWEEP. It used to walk the hue once round
 * the wheel at pastel saturation, and measured in OKLab that spent 400-1 000 km at a
 * chroma of 2-3 — grey — moving under 1.5 ΔE per 100 km: six hundred kilometres of one
 * grey-mint that nobody could tell apart. Real deserts are not evenly spaced round a
 * colour wheel, so these are authored, and ordered so neighbours blend through
 * something plausible: rust darkens into black glass, black glass weathers to basalt
 * grey, basalt grey pales into regolith.
 *
 * The first entry is the sand the drive opens on, `#d29459`, and it is exact. A pastel
 * or desaturated opening was tried twice and read as bleached grey-beige; the eye
 * forgives a saturated warm ground and not a saturated cool one, which is why the
 * strange hues further round are the pale ones.
 *
 * Kilometres are relative weights: they are scaled together to fill PALETTE_CYCLE_M,
 * and they sum to exactly 1 000 so they read as kilometres of the cycle.
 * A BLEND IS SIZED TO ITS DISTANCE. tools/road-condition.ts holds every channel to
 * one 8-bit step per 200 m chunk, and smootherstep's peak slope is 1.875 times the
 * mean, so a blend across `d` channel levels needs at least 0.375·d km; the accent is
 * held to the same step. The long ones below are the big jumps into and out of the
 * black and across the pale-to-saturated edges of the cool deserts.
 */
interface Desert {
  readonly sand: number;
  readonly accent: number;
  readonly holdKm: number;
  readonly blendKm: number;
}

const DESERTS: readonly Desert[] = [
  // The opening ochre. Accent: sunlit crests.
  { sand: 0xd29459, accent: 0xdfaa70, holdKm: 25, blendKm: 19 },
  // Golden erg — the Sahara of postcards. Accent: the shadowed troughs between dunes.
  { sand: 0xd9ad6b, accent: 0xc9975a, holdKm: 18, blendKm: 21 },
  // Saffron dunes, a paler butter-gold. Accent: cream wind-sorted crests.
  { sand: 0xdcbb7e, accent: 0xe2cc98, holdKm: 18, blendKm: 15 },
  // Gypsum flats. Accent: fresh white crust.
  { sand: 0xd4c9ad, accent: 0xe6dfcb, holdKm: 20, blendKm: 11 },
  // Peach-blush sand. Accent: pale shell-pink crust.
  { sand: 0xdcae96, accent: 0xe8c6b2, holdKm: 18, blendKm: 11 },
  // Coral-pink dunes. Accent: paler wind-sorted crests.
  { sand: 0xd6937a, accent: 0xe3ae98, holdKm: 18, blendKm: 17 },
  // Apricot erg. Accent: lighter sunlit ripples.
  { sand: 0xcc7a52, accent: 0xdc9670, holdKm: 18, blendKm: 26 },
  // Namib / Wadi Rum red. Accent: darker iron-rich streaks.
  { sand: 0xc0673f, accent: 0xa85534, holdKm: 20, blendKm: 21 },
  // Madder-rose canyon floor. Accent: a softer pink dust.
  { sand: 0xb06450, accent: 0xc47c66, holdKm: 18, blendKm: 14 },
  // Mars: rust plains under a butterscotch dust. Accent: that dust, drifted.
  { sand: 0x9e4d2e, accent: 0xbf7a52, holdKm: 25, blendKm: 24 },
  // Plum cinder, the oxidised rim of the lava field. Accent: rosier scoria.
  { sand: 0x683c3e, accent: 0x86524c, holdKm: 18, blendKm: 22 },
  // Black lava — cooled magma, glassy and faintly violet. Accent: grey ash drifts.
  { sand: 0x34313a, accent: 0x57514f, holdKm: 25, blendKm: 19 },
  // Indigo slate tuff. Accent: paler blue-grey ash.
  { sand: 0x4a4a5e, accent: 0x63637a, holdKm: 18, blendKm: 17 },
  // Weathered basalt. Accent: darker gravel pans.
  { sand: 0x6c6762, accent: 0x5a5551, holdKm: 16, blendKm: 17 },
  // Lilac pumice. Accent: darker vesicled grit.
  { sand: 0x857d88, accent: 0x746c78, holdKm: 18, blendKm: 9 },
  // The Moon: regolith, a faintly warm grey — a neutral one read as snow under the
  // blue sky fill. Accent: dark mare dust.
  { sand: 0x969088, accent: 0x77726b, holdKm: 25, blendKm: 13 },
  // Lichen sage. Accent: darker crusted soil.
  { sand: 0x9fa286, accent: 0x8a8d70, holdKm: 18, blendKm: 16 },
  // Olivine sand. Accent: darker, greener grains.
  { sand: 0x9b9760, accent: 0x868550, holdKm: 18, blendKm: 16 },
  // Pistachio flats. Accent: deeper green grit.
  { sand: 0xa9b77e, accent: 0x96a468, holdKm: 18, blendKm: 28 },
  // The strange ones out on the cycle: mint...
  { sand: 0x9dba9f, accent: 0xb5ccb3, holdKm: 18, blendKm: 11 },
  // ...seafoam...
  { sand: 0x8fb8b4, accent: 0xa9cbc6, holdKm: 18, blendKm: 13 },
  // ...pale sky...
  { sand: 0xa0b5c9, accent: 0xbccad8, holdKm: 18, blendKm: 9 },
  // ...periwinkle...
  { sand: 0xa5a8d0, accent: 0xbcbedd, holdKm: 18, blendKm: 11 },
  // ...lavender...
  { sand: 0xb3a0c8, accent: 0xc8b9d8, holdKm: 18, blendKm: 9 },
  // ...orchid...
  { sand: 0xc49cbd, accent: 0xd5b4cf, holdKm: 18, blendKm: 23 },
  // ...dusty rose...
  { sand: 0xcf9a9c, accent: 0xcf9e98, holdKm: 18, blendKm: 24 },
  // ...rose brick...
  { sand: 0xc98170, accent: 0xb66a5a, holdKm: 18, blendKm: 23 },
  // ...and salmon apricot, which closes the ring back onto the ochre.
  { sand: 0xd08a62, accent: 0xdea27c, holdKm: 18, blendKm: 7 },
];

const DESERT_SAND_LAB = DESERTS.map((d) => hexToOklab(d.sand));
const DESERT_ACCENT_LAB = DESERTS.map((d) => hexToOklab(d.accent));
const DESERT_KM = DESERTS.reduce((sum, d) => sum + d.holdKm + d.blendKm, 0);
/** Each desert's hold end and blend end, in metres of the cycle. */
const DESERT_SPANS = (() => {
  const scale = PALETTE_CYCLE_M / DESERT_KM;
  const spans: { holdEnd: number; end: number }[] = [];
  let at = 0;
  for (const d of DESERTS) {
    const holdEnd = at + d.holdKm * scale;
    at = holdEnd + d.blendKm * scale;
    spans.push({ holdEnd, end: at });
  }
  return spans;
})();

/**
 * Rock and gravel as offsets from whatever the sand is doing — a fixed saturation
 * RATIO and a lightness DROP, so their contrast against the sand holds at every phase
 * of the cycle. That constancy is the whole trick to "a boulder always reads darker
 * than the ground it sits on".
 *
 * The drop is capped at a FRACTION of the sand's own lightness, because the black lava
 * has no 0.26 of lightness to give: the fixed drop clamped its rock to pure black. Half
 * of what there is keeps obsidian boulders visibly blacker than the black sand; above
 * a lightness of 0.52 the cap is inactive.
 */
const ROCK_SAT_RATIO = 0.79;
const ROCK_LIGHT_DROP = 0.26;
const ROCK_DROP_FRACTION = 0.5;
const GRAVEL_SAT_RATIO = 0.54;
const GRAVEL_LIGHT_DROP = 0.12;
const GRAVEL_DROP_FRACTION = 0.3;
/**
 * How far thrown sand is lifted toward full lightness, as a fraction of the HEADROOM
 * above the ground's own lightness. Proportional rather than a fixed offset, so a
 * dark sand gets a real lift and a pale one is not pushed to white.
 */
const SPRAY_LIGHT_LIFT = 0.45;

/**
 * THE GROUND MAY NOT OUTSHINE THE SAND IT STARTED AS.
 *
 * HSL lightness is not brightness, and a pale gypsum or mint carries far more light
 * than the ochre at the same lightness; under the noon sun, which is exposed for the
 * ochre, it blew out to a near-white that hurt to drive across. So every phase is
 * capped at this much of the opening sand's luminance, by scaling its LINEAR light:
 * hue and chroma are kept, only the amount of light comes down. Solving HSL lightness
 * down to the cap was tried first and went the other way — a darker HSL colour at the
 * same saturation is a MORE saturated one, and the pale greens came out mustard.
 *
 * Only a ceiling: the dark deserts are below it and stay as authored. Rock, gravel and
 * spray take the sand's factor, so every contrast against the ground is unchanged. The
 * accent takes it too — capping it on its own flattened every pale crest into the sand
 * beneath it — and then its own, looser ceiling (ACCENT_LUMINANCE_CAP).
 */
const SAND_LUMINANCE_CAP = luminanceOf(hexToRgb(DESERTS[0]!.sand)) * 1.12;
/** Crests and crust may be a little brighter than any open sand, never glaring. */
const ACCENT_LUMINANCE_CAP = SAND_LUMINANCE_CAP * 1.22;

/** Quintic smoothstep of an already-normalised 0..1: zero slope AND curvature at both ends. */
function smootherstep01(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const paletteHsl = { h: 0, s: 0, l: 0 };

/**
 * The desert's colour at a distance. Pure, C2 in `s`, exact period PALETTE_CYCLE_M.
 *
 * HOLD, THEN BLEND. Each desert of `DESERTS` stands pure for its hold, then becomes the
 * next along a quintic smootherstep — zero slope at both knots, so there is no crease
 * where a blend starts or stops (an earlier keyframed palette used linear segments,
 * which crease). The mix is in OKLab rather than HSL or sRGB: rust into black and
 * ochre into gypsum pass through what the eye takes as the midpoint, not through a
 * muddy grey or a detour round the hue wheel.
 *
 * s = 0 is the first hold, so the drive opens on exactly `#d29459`.
 *
 * Called once per mesh ROW, not per vertex, so allocating a fresh object here is
 * irrelevant — do not 'optimise' it into a shared buffer.
 */
export function desertPaletteAt(s: number): DesertPalette {
  const cycle = s - Math.floor(s / PALETTE_CYCLE_M) * PALETTE_CYCLE_M;
  let i = 0;
  while (i < DESERT_SPANS.length - 1 && cycle >= DESERT_SPANS[i]!.end) i++;
  const span = DESERT_SPANS[i]!;
  const next = (i + 1) % DESERTS.length;
  const w = cycle <= span.holdEnd
    ? 0
    : smootherstep01(Math.min(1, (cycle - span.holdEnd) / (span.end - span.holdEnd)));

  let sand: Rgb;
  let accent: Rgb;
  if (w === 0) {
    sand = hexToRgb(DESERTS[i]!.sand);
    accent = hexToRgb(DESERTS[i]!.accent);
  } else {
    sand = mixOklab(DESERT_SAND_LAB[i]!, DESERT_SAND_LAB[next]!, w);
    accent = mixOklab(DESERT_ACCENT_LAB[i]!, DESERT_ACCENT_LAB[next]!, w);
  }

  rgbToHsl(sand, paletteHsl);
  const { h, s: sat, l } = paletteHsl;
  const rockL = l - Math.min(ROCK_LIGHT_DROP, l * ROCK_DROP_FRACTION);
  const gravelL = l - Math.min(GRAVEL_LIGHT_DROP, l * GRAVEL_DROP_FRACTION);
  // See SAND_LUMINANCE_CAP. Exactly 1 at the opening, so s = 0 stays `#d29459`.
  const light = Math.min(1, SAND_LUMINANCE_CAP / luminanceOf(sand));
  const accentLight = Math.min(light, ACCENT_LUMINANCE_CAP / luminanceOf(accent));

  return {
    sand: packScaled(sand, light),
    accent: packScaled(accent, accentLight),
    rock: packScaled(hslToRgb(h, sat * ROCK_SAT_RATIO, rockL), light),
    gravel: packScaled(hslToRgb(h, sat * GRAVEL_SAT_RATIO, gravelL), light),
    spray: packScaled(hslToRgb(h, sat, l + (1 - l) * SPRAY_LIGHT_LIFT), light),
  };
}

// ---------------------------------------------------------------------------
// Monuments
// ---------------------------------------------------------------------------

/**
 * A distance sign, or one of the four artefacts nobody on this road made
 * (`world/props/artifacts.ts`), which replaced the cairn, the chrome shrine and the
 * snapped sign.
 */
export type MonumentKind = 'distance_sign' | 'monolith' | 'orbit' | 'bloom' | 'gate';

export interface Monument {
  /** Arclength of the monument. */
  readonly s: number;
  /** Which side of the road it stands on: -1 is right of travel, +1 left. */
  readonly side: -1 | 1;
  /**
   * Metres from the ASPHALT EDGE, not from the centreline.
   *
   * This module knows nothing about how wide the road is there (`roadprofile.ts`
   * owns that), and a monument authored at a fixed lateral stood on the paint of a
   * widened stretch. The consumer adds the local half width.
   */
  readonly setback: number;
  readonly kind: MonumentKind;
  /** Deterministic per-monument variation seed. */
  readonly variantSeed: number;
  /** Text for signs. Empty for other kinds. */
  readonly text: string;
}

/** Monuments appear on this cadence, in metres. */
const MONUMENT_INTERVAL = 20_000;

/**
 * Monuments at fixed round distances, so their spacing is legible: passing one
 * means a specific number of kilometres, not an arbitrary landmark.
 *
 * Pure in (seed, fromS, toS): no game state reaches this. A personal-record
 * marker used to be grafted on here from `recordS`, which put a monument to the
 * player exactly where a resumed save left off. Distance travelled is now
 * recorded on the car itself, in stickers earned by hauling.
 */
export function monumentsBetween(seed: number, fromS: number, toS: number): Monument[] {
  const result: Monument[] = [];
  const firstIndex = Math.ceil(fromS / MONUMENT_INTERVAL);
  const lastIndex = Math.floor(toS / MONUMENT_INTERVAL);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const s = i * MONUMENT_INTERVAL;
    if (s <= 0 || s > ROAD_LENGTH) continue;
    // 0x4d4f4e55 is 'MONU': a domain tag keeping this hash stream distinct from others.
    const roll = hash01(seed, 0x4d4f4e55, i);
    const km = Math.round(s / 1000);

    // Signs are two in five; the artefacts share the rest evenly.
    let kind: MonumentKind;
    if (roll < 0.4) kind = 'distance_sign';
    else if (roll < 0.55) kind = 'monolith';
    else if (roll < 0.7) kind = 'orbit';
    else if (roll < 0.85) kind = 'bloom';
    else kind = 'gate';

    result.push({
      s,
      // Alternate sides so the road does not develop a lopsided rhythm.
      side: i % 2 === 0 ? 1 : -1,
      setback: 3.6 + hash01(seed, i, 7) * 2.5,
      kind,
      variantSeed: (seed ^ (i * 0x9e3779b9)) >>> 0,
      text: kind === 'distance_sign' ? `${km} km` : '',
    });
  }

  return result;
}
