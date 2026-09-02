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
 *    is a regional envelope plus a fine patch, so a pristine stretch is possible at
 *    39 000 km and a ruined one at 200 km; the desert palette (and the dust, haze
 *    and sky tint that track it) cycles with a fixed period, so a driver who
 *    covers a full cycle sees every colour and then begins again.
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
 * Period of the desert colour cycle, metres. Exactly 4 000 km.
 *
 * A driver who covers this distance sees the whole palette and then begins again.
 * The cyclic sky channels (dust, haze, sky tint) share this period so they move
 * with the colour; the remoteness channels deliberately do not.
 */
export const PALETTE_CYCLE_M = 4_000_000;

// ---------------------------------------------------------------------------
// Road decay
// ---------------------------------------------------------------------------

export interface RoadCondition {
  /** Dominant surface of the driving lanes at this distance. */
  readonly surface: SurfaceType;
  /** 0 = pristine, 1 = the desert has almost taken it. Drives cracks and patches. */
  readonly decay: number;
  /** Fraction of the lane width buried under drifted sand, 0..1. */
  readonly sandCover: number;
  /** Whether painted lane markings are still visible. */
  readonly markings: number;
}

/** Distance over which local decay varies, so decay is patchy rather than uniform. */
const DECAY_PATCH_WAVELENGTH = 900;

const decayNoise = new Noise1D(0x51ed270b);

/**
 * Wavelength of the REGIONAL envelope, metres. 300 km of road sits inside roughly
 * one "region"; the envelope drifts slowly between kept-up and abandoned districts
 * over a few hundred kilometres. That is what makes a stretch read as "this part
 * of the desert is maintained" rather than as a difficulty knob. Two octaves is
 * enough at this wavelength: the envelope only needs broad regions, and the fine
 * texture is the patch noise's job.
 */
const DECAY_ENVELOPE_WAVELENGTH = 300_000;

/** Fixed seed (not the world seed) so the envelope is identical in every world. */
const envelopeNoise = new Noise1D(0x4f9d3b7e);

/**
 * The maintained opening out of the house, in metres.
 *
 * Twenty-five kilometres, held pristine for the first five and eased into whatever
 * the region says by the last. It was three kilometres, and the road-condition table
 * showed why that is not enough: with quality stationary rather than ramped, the
 * region the house happens to sit in is whatever the envelope says, and it says 0.83.
 * So at three kilometres the player left the garage, drove for ninety seconds and
 * arrived on ruined gravel with no lane markings — a legible opening turned into the
 * roughest thing in the game before they had shifted into third.
 *
 * Twenty-five kilometres is about seventeen minutes at 90 km/h: long enough to learn
 * the car, meet a fuel stop and see the road in good condition before it starts to
 * break up, and 0.06% of the road, so it costs the stationary design nothing. The
 * five-kilometre flat start matters as much as the length — a blend that begins
 * immediately still puts visible decay in the first minute.
 */
const GARAGE_RAMP_M = 25_000;
/** Held fully maintained before the blend begins, metres. */
const GARAGE_FLAT_M = 5000;

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
 * cracked 35%, gravel 25%, concrete 10% — the mix the old thresholds were retuned for
 * — so the bumpiest surface still never dominates a drive.
 *
 * Written into a module scratch array rather than returned: a block fill draws four
 * times and `roadConditionAt` is called per road-mesh vertex row.
 */
const districtWeights = new Float64Array(4);

function weighDistrict(regional: number): number {
  districtWeights[0] = Math.max(0, 1.5 - 1.9 * regional);
  districtWeights[1] = 0.3 + 0.45 * regional;
  districtWeights[2] = Math.max(0, 1.5 * regional - 0.3);
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
 * Regional mean decay: the slow absolute-distance drift between maintained and
 * abandoned districts. fbm (never a sine) so regions never repeat on a schedule.
 */
function regionalDecay(s: number): number {
  const env = envelopeNoise.fbm(s / DECAY_ENVELOPE_WAVELENGTH, 2, 2.1, 0.5);
  return 0.45 + env * 0.55;
}

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
function blockRegional(b: number): number {
  return regionalDecay((b + 0.5) * DISTRICTS_PER_BLOCK * DISTRICT_NOMINAL_M);
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
 * Road condition at a distance.
 *
 * Two independent things, and keeping them independent is the point:
 *
 *  - MATERIAL comes from the 5-7 km surface districts above, weighted by the region.
 *  - DECAY is stationary in absolute distance, not a one-way ramp: the regional
 *    envelope summed with fine patch noise, so a pristine stretch is possible at
 *    39 000 km and a ruined one at 200 km. The garage ramp holds it pristine for the
 *    first five kilometres and eases into the region by twenty-five, so the player
 *    always learns the car on a maintained road.
 *
 * A gravel district at low decay is a well-kept gravel road and an asphalt district at
 * high decay is a ruined one; both are things a desert road actually is, and neither
 * was reachable while the material WAS a threshold on the decay.
 */
export function roadConditionAt(s: number): RoadCondition {
  // Garage ramp: hold the regional mean at pristine for GARAGE_FLAT_M, then blend it
  // up to whatever the region says by GARAGE_RAMP_M. Cubic smoothstep, so the join is
  // C1 at both ends and there is no distance at which the road visibly steps.
  const rampT = Math.min(
    1,
    Math.max(0, (s - GARAGE_FLAT_M) / (GARAGE_RAMP_M - GARAGE_FLAT_M)),
  );
  const ramp = rampT * rampT * (3 - 2 * rampT);
  const envelope = 0.05 + (regionalDecay(s) - 0.05) * ramp;

  // Fine patch: the existing 3-octave fbm, unchanged. It no longer moves the material
  // (districts own that), so it is purely how broken this stretch is.
  const patch = decayNoise.fbm(s / DECAY_PATCH_WAVELENGTH, 3, 2.1, 0.45) * 0.28;

  const decay = Math.min(1, Math.max(0, envelope + patch));
  const surface = districtSurface(districtIndex(s));

  return {
    surface,
    decay,
    // Sand only starts drifting across the lanes once the surface is breaking up.
    sandCover: Math.min(0.85, Math.max(0, (decay - 0.45) * 1.6)),
    // Nothing paints an unsealed road, however well kept it is.
    markings:
      surface === SurfaceType.Gravel ? 0 : Math.max(0, 1 - decay * 1.9),
  };
}

// ---------------------------------------------------------------------------
// Roadside pole eras
// ---------------------------------------------------------------------------

/**
 * Poles come in design generations. Crossing between eras is the clearest possible
 * signal that you have travelled somewhere genuinely different, because the
 * silhouette on the horizon changes.
 */
export type PoleEra = 'timber' | 'lattice' | 'concrete' | 'none';

export interface PoleCondition {
  readonly era: PoleEra;
  /** Metres between poles. Later eras space them further apart. */
  readonly spacing: number;
  /** 0 = upright and intact, 1 = collapsed. */
  readonly dilapidation: number;
  /** Probability a given pole still carries its wire span. */
  readonly wireChance: number;
  /** Probability a given lamp still works after dark. */
  readonly lampChance: number;
}

/**
 * Pole eras are absolute-distance bands about 1 000 km long, not fractions of the
 * road, so a 4 000 km drive crosses three or four generations and a 40 000 km
 * drive crosses ~40. Each band's era is drawn from a fixed hash stream rather than
 * a repeating literal list, so the order never reads as a loop.
 */
const POLE_ERA_BAND_M = 1_000_000;

/** Domain tag separating the pole-era-band hash stream from every other hash01 use. */
const POLE_ERA_TAG = 0x0e7a5e;

/** Metres between poles in each maintained era. 'none' has no poles at all. */
const POLE_SPACING: Record<Exclude<PoleEra, 'none'>, number> = {
  timber: 44,
  lattice: 62,
  concrete: 85,
};

/** The era a band gets, from the fixed hash stream. Roughly one band in four is
 * 'none': a long stretch with no poles at all is what makes their return startling. */
function poleEraForBand(band: number): PoleEra {
  if (hash01(POLE_ERA_TAG, band) < 0.25) return 'none';
  const pick = hash01(POLE_ERA_TAG, band, 1);
  if (pick < 0.25) return 'timber';
  if (pick < 0.6) return 'lattice';
  return 'concrete';
}

interface PoleEraBand {
  readonly start: number;
  readonly end: number;
  readonly era: PoleEra;
  readonly spacing: number;
}

let poleEraBands: readonly PoleEraBand[] | null = null;

/** The pole era schedule, so props.ts stops rediscovering it by probing. */
export function poleEraSegments(): readonly PoleEraBand[] {
  if (poleEraBands) return poleEraBands;
  const count = Math.ceil(ROAD_LENGTH / POLE_ERA_BAND_M);
  const bands: PoleEraBand[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * POLE_ERA_BAND_M;
    const end = Math.min((i + 1) * POLE_ERA_BAND_M, ROAD_LENGTH);
    const era = poleEraForBand(i);
    bands.push({ start, end, era, spacing: era === 'none' ? 0 : POLE_SPACING[era] });
  }
  poleEraBands = bands;
  return bands;
}

export function poleConditionAt(s: number): PoleCondition {
  const band = poleBandAt(s);
  if (band.era === 'none') {
    return { era: 'none', spacing: 0, dilapidation: 1, wireChance: 0, lampChance: 0 };
  }

  // Dilapidation resets at each era boundary: a new era means newer infrastructure.
  const within = (s - band.start) / (band.end - band.start);

  return {
    era: band.era,
    spacing: band.spacing,
    dilapidation: Math.min(1, within * 1.15),
    wireChance: Math.max(0, 1 - within * 1.3),
    // Lamps die well before the poles fall over.
    lampChance: Math.max(0, 1 - within * 2.2),
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

/** Hue/saturation/lightness (hue circular, all 0..1) -> packed 0xRRGGBB. Plain
 * numbers so this module does not depend on three.js. */
function hslToHex(h: number, s: number, l: number): number {
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
  return (Math.round((r + m) * 255) << 16) |
         (Math.round((g + m) * 255) << 8) |
         Math.round((b + m) * 255);
}

/**
 * THE SAND THE DRIVE OPENS ON: `#d29459`, expressed as HSL because the whole cycle is
 * built in HSL and this is the one point on it that is pinned to an exact colour.
 *
 * A pastel version of this was tried twice and rejected both times. Desaturating it
 * gave a bleached grey-beige, which is a colour a desert can be at noon in a
 * photograph and is not the colour anyone means by "sand". So the cycle is no longer
 * uniformly pastel: it is pinned WARM here and relaxes into pastel as the hue travels
 * away, which is what `warmth` below interpolates. The strange hues out in the cycle
 * still need the pastel treatment — a saturated violet desert is what started all
 * this — but the sand at kilometre zero does not.
 *
 * The hue also decides where the cycle starts, so it does double duty: it is both the
 * colour of the opening and the phase offset that puts the opening here.
 */
const PALETTE_START_HUE = 0.0812672;
const SAND_WARM_SAT = 0.573;
const SAND_WARM_LIGHT = 0.586;
/**
 * The sand at the far side of the wheel: pale and soft, because that is where the hues
 * are ones no desert has and the eye needs them muted to accept them at all.
 */
const SAND_COOL_SAT = 0.2;
const SAND_COOL_LIGHT = 0.71;
/**
 * Rock and gravel as offsets from whatever the sand is doing — a fixed saturation
 * RATIO and a fixed lightness DROP, so their contrast against the sand is identical at
 * every phase of the cycle. That constancy is the whole trick to "a boulder always
 * reads darker than the ground it sits on": pinning them to absolute values instead
 * lets the gap collapse wherever the sand happens to be dark.
 */
const ROCK_SAT_RATIO = 0.79;
const ROCK_LIGHT_DROP = 0.26;
const GRAVEL_SAT_RATIO = 0.54;
const GRAVEL_LIGHT_DROP = 0.12;
/**
 * How far thrown sand is lifted toward full lightness, as a fraction of the HEADROOM
 * above the ground's own lightness.
 *
 * Proportional rather than a fixed offset, so it behaves at both ends of the cycle: the
 * warm sand starts dark (lightness 0.586) and needs a real lift to separate from the
 * ground, while the pastel phases are already light (0.71) and a fixed offset would
 * push them to nearly white. At 0.45 the spray is always clearly brighter than the
 * ground and never blows out.
 */
const SPRAY_LIGHT_LIFT = 0.45;
/**
 * How sharply the warm sand gives way to pastel, as an exponent on the cosine falloff.
 * Six spends the warm treatment inside roughly the first thousand kilometres of the
 * cycle; see the note in `desertPaletteAt` for what a gentler value looked like.
 */
const WARM_FALLOFF_POWER = 6;

/**
 * The desert's colour at a distance. Pure, C1 in `s`, exact period PALETTE_CYCLE_M.
 *
 * A hue that travels the full circle once per period, NOT a keyframed interpolation
 * (linear segments leave visible creases at the knots). Hue is a circle, so the wrap
 * at the period boundary is invisible: hue 1 IS hue 0.
 *
 * WARM AT THE START, PASTEL AWAY FROM IT. `warmth` is 1 at `PALETTE_START_HUE` and 0
 * at the opposite side of the wheel, and both saturation and lightness are interpolated
 * along it. So s = 0 is exactly `#d29459` — real sand, warm and reasonably saturated —
 * and the further round the cycle goes the softer and paler it gets. A uniformly
 * pastel cycle was tried and it made the opening a bleached grey-beige; a uniformly
 * saturated one was the original bug, and it made the desert at 39 000 km a flat
 * violet. The eye forgives a saturated warm ground and does not forgive a saturated
 * cool one, so the two ends genuinely need different treatment.
 *
 * The two modulations exist to stop the sweep being mechanical, and BOTH are phased to
 * vanish at `PALETTE_START_HUE` — that is what makes the opening land on the pinned
 * colour exactly rather than approximately. They use different harmonics so they never
 * peak together.
 *
 * Called once per terrain mesh ROW, not per vertex, so allocating a fresh object here
 * is irrelevant — do not 'optimise' it into a shared buffer.
 */
export function desertPaletteAt(s: number): DesertPalette {
  const t = s / PALETTE_CYCLE_M + PALETTE_START_HUE;
  const hue = t - Math.floor(t);

  // Distance round the wheel from the pinned sand, as 1 (at it) to 0 (opposite).
  //
  // Raised to a power, and that exponent is the whole difference between "sand at the
  // start" and "a saturated cycle". A plain cosine falls off far too slowly: it left
  // warmth above 0.7 a full 500 km in, which came out `0xbcd56e` — a vivid
  // yellow-green desert, no more plausible than the violet that started all this. At
  // the sixth power the warm treatment is spent within roughly the first thousand
  // kilometres of the cycle and the remaining three thousand are pastel, which is the
  // shape actually asked for: real sand where the drive begins, soft strange colours
  // out where the drive goes. It comes back up symmetrically on the approach, so the
  // cycle closes on sand as smoothly as it opened on it.
  const offset = hue - PALETTE_START_HUE;
  const warmth = (0.5 + 0.5 * Math.cos(2 * Math.PI * offset)) ** WARM_FALLOFF_POWER;

  // Zero at the start hue, so they perturb everywhere except the one pinned point.
  const lightMod = 0.04 * Math.sin(2 * Math.PI * offset);
  const satMod = 0.03 * Math.sin(4 * Math.PI * offset);

  const sandSat = SAND_COOL_SAT + (SAND_WARM_SAT - SAND_COOL_SAT) * warmth + satMod;
  const sandLight = SAND_COOL_LIGHT + (SAND_WARM_LIGHT - SAND_COOL_LIGHT) * warmth + lightMod;

  return {
    sand: hslToHex(hue, sandSat, sandLight),
    rock: hslToHex(hue, sandSat * ROCK_SAT_RATIO, sandLight - ROCK_LIGHT_DROP),
    gravel: hslToHex(hue, sandSat * GRAVEL_SAT_RATIO, sandLight - GRAVEL_LIGHT_DROP),
    spray: hslToHex(hue, sandSat, sandLight + (1 - sandLight) * SPRAY_LIGHT_LIFT),
  };
}

// ---------------------------------------------------------------------------
// Monuments
// ---------------------------------------------------------------------------

export type MonumentKind =
  | 'distance_sign'
  | 'ornament_shrine'
  | 'cairn'
  | 'wrecked_marker';

export interface Monument {
  /** Arclength of the monument. */
  readonly s: number;
  /** Lateral offset from the centreline; negative is left of travel. */
  readonly lateral: number;
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

    // Signs dominate early; shrines and cairns take over as the road ages.
    let kind: MonumentKind;
    if (roll < 0.45) kind = 'distance_sign';
    else if (roll < 0.7) kind = 'cairn';
    else if (roll < 0.9) kind = 'ornament_shrine';
    else kind = 'wrecked_marker';

    result.push({
      s,
      // Alternate sides so the road does not develop a lopsided rhythm.
      lateral: (i % 2 === 0 ? 1 : -1) * (6.5 + hash01(seed, i, 7) * 2.5),
      kind,
      variantSeed: (seed ^ (i * 0x9e3779b9)) >>> 0,
      text: kind === 'distance_sign' ? `${km} km` : '',
    });
  }

  return result;
}
