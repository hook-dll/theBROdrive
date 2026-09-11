import { hashUnit3 } from '../core/rng';

/**
 * The landscape: the ground's own elevation, as a function of world position and
 * nothing else.
 *
 * This is the field the road lies ON, and it is the reason the road exists at the
 * height it does rather than the other way round. That direction is load-bearing.
 *
 * The road used to carry the elevation itself: a grade was drawn from noise at each
 * arclength and integrated forward, and the desert took its height from the road
 * point nearest it. Integrating a zero-mean grade is a random walk, so over 400 km
 * the road wandered 1.5-2.3 km in altitude, ~300 m inside any 3 km window, and it
 * crossed its own path (metres apart in plan) with as much as 1.1 km of vertical
 * separation. Every one of those numbers arrived on screen, because the desert's
 * height was "whichever pass of the road is nearest": at every fold of the
 * nearest-point map the ground STEPPED by the altitude difference between two
 * branches. Measured on seed 90210 at s = 47750, a 25.5 m vertical wall inside 5 m of
 * lateral distance — a 511% slope, one sample apart. Those were the skyscraper
 * mountains, the tall canyons and the ravines beside the road.
 *
 * No amount of blending fixes that, because it is not a smoothing problem. If the
 * road genuinely is 600 m higher here than it is 300 m away, then ground that must
 * meet the road in both places genuinely has a cliff in it. The only fix is to stop
 * the road being in two places at two heights: elevation has to be a function of
 * POSITION.
 *
 * So elevation is this field, and the field is Lipschitz by construction. Each band is one octave of value noise over its own lattice, and `MAX_SLOPE` is the sum of the bands' individual bounds — arithmetic about the constants in this file, not a hope. Everything downstream inherits it: the road's grade is this field's slope along its own tangent, and the open desert is this field plus bounded dune relief.
 *
 * The bands are spread over two decades of wavelength. In this relief experiment
 * both altitude and horizontal scale are multiplied by five: the 225 km band carries
 * most of the altitude and almost none of the slope, the 12.5 km band supplies the
 * sustained grade a driver feels, and the 2.1 km band still supplies crests and brows.
 * Climbs become much taller and longer without becoming steeper.
 */

/**
 * Interpolation, and why it is not the `Noise2D` every other field in the world uses.
 *
 * A gentle maximum is useless if the typical slope is a twentieth of it: the road
 * would be dead flat everywhere and terrifying in one place per seed. So the number
 * that decides whether this design can carry hills at all is mean slope over peak
 * slope, and `tools/slope-ratio.ts` measures it for the candidates:
 *
 *   quintic fade, lattice values uniform in [-1,1]   mean/peak 0.27   <- Noise2D
 *   cubic fade,   lattice values uniform in [-1,1]   mean/peak 0.32
 *   cubic fade,   lattice values +-1                 mean/peak 0.53
 *
 * Two independent factors, and both are about wasting less of the range. The quintic
 * fade's derivative peaks at 1.875 to buy C2 continuity that nothing here needs —
 * terrain normals are first derivatives — where the cubic peaks at 1.5. And uniform
 * lattice values put most neighbouring pairs far short of the full 2 apart, so the
 * peak-defining case is rare; +-1 values make every non-flat edge the peak case, and
 * the peak becomes something the field REACHES rather than an unreachable bound.
 *
 * Twice the mean slope for the same maximum is the difference between a 1.4% road and
 * a 2.8% road under the same no-cliff guarantee. Saturating the band values with a
 * gain, which is what the old grade generator did, was tried here and measured worse:
 * gain multiplies mean and peak alike, and the plateaus it creates have no slope at
 * all, so the ratio falls.
 */
const FADE_PEAK_SLOPE = 1.5;

/**
 * Experimental macro-relief multiplier. Amplitude and every horizontal control
 * distance use the same factor, so possible height/depth grow fivefold while the
 * derivative — and therefore the road's maximum grade — stays unchanged.
 */
const RELIEF_SCALE = 5;

/** Cubic smoothstep, used as the lattice fade. Derivative peaks at 1.5. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * One band's value at a point, in [-1, 1]. Lattice values are +-1, hashed from the
 * band's seed so the field is seed-pure and carries no state. Written out flat and
 * with `hashUnit3` because it runs four times per road node over 100k nodes.
 */
function band(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = fade(x - ix);
  const tz = fade(z - iz);
  const v00 = hashUnit3(seed, ix, iz) < 0.5 ? -1 : 1;
  const v10 = hashUnit3(seed, ix + 1, iz) < 0.5 ? -1 : 1;
  const v01 = hashUnit3(seed, ix, iz + 1) < 0.5 ? -1 : 1;
  const v11 = hashUnit3(seed, ix + 1, iz + 1) < 0.5 ? -1 : 1;
  const near = v00 + (v10 - v00) * tx;
  const far = v01 + (v11 - v01) * tx;
  return near + (far - near) * tz;
}

/**
 * The bands, longest first.
 *
 * `amplitude` is metres of half-range and `wavelength` metres of lattice spacing, so
 * a band's steepest slope is `amplitude * 2 * FADE_PEAK_SLOPE / wavelength` — the
 * lattice values it interpolates differ by at most 2. Slope adds linearly across
 * bands but mean slope adds in quadrature, so the budget is deliberately lopsided:
 * most of it goes to the shortest band, where it is felt, and the long bands buy
 * altitude at almost no cost in steepness.
 *
 * TEMPO, and why the two long bands do not have it. `RELIEF_SCALE` multiplies every
 * amplitude AND every wavelength, and that is what buys the world its +-1430 m of
 * range — of which +-1050 m lives in the 225 km and 50 km bands. Those two are the
 * mountains, the basins and the far horizon, and nothing here touches them.
 *
 * The problem is the OTHER two. Stretched fivefold, every climb a driver meets lasts
 * kilometres, so the road has exactly one pace: measured, the grade changes sign
 * every 2.1 km and the whole world reads as "always tilted somewhere" instead of as
 * hills. Long drags are wanted SOMETIMES, not always. So each felt band carries a
 * SHORT alternative and a regional tempo field crossfades between them:
 *
 *   band    long tempo             short tempo          slope long/short
 *   hills   +-290 m / 12.5 km      +-90 m / 6 km         6.96% / 4.50%
 *   rolls   +- 90 m /  2.1 km      +-14 m / 250 m       12.86% / 16.80%
 *
 * A pair contributes `(1 - w) * long + w * short` with ONE shared `w`, so the two
 * tempos never mix their worst cases and the field's bound is the worse of the two
 * endpoints — 22.9% at the long end, 24.3% at the short one.
 *
 * LATTICE SPACING IS NOT FEATURE LENGTH, and this is the whole reason the numbers
 * look small. Value noise with +-1 lattice values gives neighbouring cells the same
 * value half the time, and a matching pair is a plateau with no slope, so features
 * run two cells long on average. Measured crest-to-crest in short-tempo country:
 *
 *   +-40 m / 700 m  ->  1574 m (63 s at road speed)
 *   +-30 m / 500 m  ->  1205 m (48 s)
 *   +-22 m / 350 m  ->   881 m (35 s)
 *   +-14 m / 250 m  ->   690 m (28 s)   <- chosen
 *
 * WHY NOT KEEP THE HEIGHT AT THE SHORT WAVELENGTH. +-90 m over 700 m is a 38% grade,
 * and even the +-55 m compromise is 23.6%; band bounds ADD, and this field really does
 * reach its bound (p100 over 2400 km came out at 22.4% of a 22.85% budget). The
 * weakest catalogue car leaves a standstill at 18% and holds 12% indefinitely while
 * towing (tools/climb-limit.ts), and a run-up does not rescue it: 60 km/h is worth
 * 14 m of climb where a 350 m pitch at 30% asks for 105 m. So the short tempo spends
 * its budget on FREQUENCY, and takes the amplitude it needs from the hills band
 * rather than stacking on top: p100 came out at 21.9%, marginally gentler than the
 * version this replaces, while the felt pace ranges from a 3.4 km drag to a crest
 * every 690 m depending on where you are.
 *
 * `hilliness` gates the hills band in both tempos. `home` ramps both felt bands in
 * around the homestead, so the concrete pad and the driveway have level ground.
 */
interface Band {
  readonly amplitude: number;
  readonly wavelength: number;
  readonly hilliness: boolean;
  readonly home: boolean;
  /**
   * The same feature at a shorter pace, crossfaded in by `tempoAt`. Absent on the
   * two long bands: they are the world's altitude range and hold one pace.
   */
  readonly short?: { readonly amplitude: number; readonly wavelength: number };
}

const BANDS: readonly Band[] = [
  /** Continental: broad altitude changes, almost no slope. */
  { amplitude: 140 * RELIEF_SCALE, wavelength: 45_000 * RELIEF_SCALE, hilliness: false, home: false },
  /** Regional: basins and divides, several minutes of driving across. */
  { amplitude: 70 * RELIEF_SCALE, wavelength: 10_000 * RELIEF_SCALE, hilliness: false, home: false },
  /** Hills: a climb or descent that lasts long enough to choose a gear. */
  {
    amplitude: 58 * RELIEF_SCALE,
    wavelength: 2500 * RELIEF_SCALE,
    hilliness: true,
    home: true,
    short: { amplitude: 90, wavelength: 6000 },
  },
  /** Rolls: the crest-and-dip rhythm under the bonnet. */
  {
    amplitude: 18 * RELIEF_SCALE,
    wavelength: 420 * RELIEF_SCALE,
    hilliness: false,
    home: true,
    short: { amplitude: 14, wavelength: 250 },
  },
];

/** How far you drive before flat country becomes hill country, metres. */
const HILLINESS_WAVELENGTH = 9000 * RELIEF_SCALE;
/**
 * Fraction of the gated band kept in the flattest country. Not small: even the flat
 * stretches should breathe, or the contrast makes them read as broken rather than
 * flat.
 */
const HILLINESS_FLOOR = 0.45;

/**
 * Wavelength of the tempo field, metres: how far you drive before the road's pace
 * changes. 15 km is ten minutes at road speed — long enough to register as country
 * with a character, short enough that one drive crosses several of them.
 *
 * Its own slope contribution is real but tiny: the crossfade moves at most the
 * difference between the two tempos' amplitudes over its own wavelength, which is
 * under 0.03 of the field's budget, so it stays out of MAX_SLOPE as hilliness does.
 */
const TEMPO_WAVELENGTH = 15_000;

/**
 * Level ground around the origin: fully flat inside `HOME_FLAT_RADIUS`, ramping to
 * full landscape over `HOME_RAMP` beyond it.
 *
 * The homestead's concrete pad spans 4 to 20 m of lateral offset and its driveway
 * ramps from the pad down to the asphalt in 5 m, so ground that tilts under the
 * footprint becomes a lip the starting car has to climb to leave the garage. Only the
 * two short bands are ramped; the longest bands are gentle across the pad. The ramp is
 * long because it costs slope of its own — `sum(home amplitudes) * 1.5 / HOME_RAMP` —
 * and a short one would be a hill in itself.
 */
const HOME_FLAT_RADIUS = 200 * RELIEF_SCALE;
const HOME_RAMP = 1200 * RELIEF_SCALE;

/**
 * A band's steepest slope at a given tempo. ONE tempo drives every paired band, so
 * the bounds must be evaluated at a shared `tempo` rather than maximised per band:
 * the short rolls and the long hills never coexist, and pretending they might would
 * quote a 27% budget for a field that reaches 21.4%.
 *
 * Both quantities are linear in `tempo`, so the extremes are at 0 and 1 and there is
 * nothing to search.
 */
function slopeAtTempo(b: Band, tempo: number): number {
  const long = (b.amplitude * 2 * FADE_PEAK_SLOPE) / b.wavelength;
  if (!b.short) return long;
  const short = (b.short.amplitude * 2 * FADE_PEAK_SLOPE) / b.short.wavelength;
  return long * (1 - tempo) + short * tempo;
}

function reliefAtTempo(b: Band, tempo: number): number {
  if (!b.short) return b.amplitude;
  return b.amplitude * (1 - tempo) + b.short.amplitude * tempo;
}

function sumOverBands(tempo: number, per: (b: Band, tempo: number) => number): number {
  return BANDS.reduce((sum, b) => sum + per(b, tempo), 0);
}

/**
 * The steepest this field can be, as a fraction: the worst tempo's band sum plus the
 * homestead ramp's own contribution.
 */
export const MAX_SLOPE =
  Math.max(sumOverBands(0, slopeAtTempo), sumOverBands(1, slopeAtTempo)) +
  (BANDS.reduce((sum, b) => sum + (b.home ? b.amplitude : 0), 0) * FADE_PEAK_SLOPE) / HOME_RAMP;

/** Total half-range of the field, metres, in the tempo that reaches highest. */
export const MAX_RELIEF = Math.max(sumOverBands(0, reliefAtTempo), sumOverBands(1, reliefAtTempo));

/**
 * How far BELOW THE GROUND a body has to be to count as having escaped the world.
 *
 * An ABSOLUTE altitude cannot express this. The field's half-range is `MAX_RELIEF`
 * (+-1430 m), so whole basins — over a hundred kilometres of road at a time on
 * ordinary seeds — sit below any fixed line drawn for the purpose. A car driving down
 * into one then satisfies the test on solid asphalt, is "rescued" onto the road, and
 * satisfies it again on the next step, for good.
 *
 * The margin only has to clear how far real ground can sit below this field: the wash
 * and scoop hollows in `world/terrain.ts`, about five metres between them. Sixty
 * leaves an order of magnitude and is still a fall nothing survives by accident.
 */
export const UNDERWORLD_DROP_M = 60;

/**
 * Has this position left the world? True for a body far under the ground at its own
 * x/z, and for any non-finite coordinate — a NaN pose is exactly the collider edge
 * case the rescue exists for, and it compares false against every threshold.
 */
export function hasEscapedWorld(
  landscape: Landscape,
  x: number,
  y: number,
  z: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return true;
  return y < landscape.heightAt(x, z) - UNDERWORLD_DROP_M;
}

/**
 * The mountains, which are NOT part of `heightAt` and are the reason the horizon has
 * anything on it.
 *
 * The ordinary bands are sized so a car can drive anywhere in them. The experimental
 * relief multiplier above makes their vertical range comparable to the mountain field,
 * but these mountains still stay separate because they are scenery: `Terrain` only lets
 * them in past a couple of kilometres of lateral distance from the road (see
 * MOUNTAIN_START there). That gating keeps them out of the road's grade and the
 * driveable desert's slope budget while preserving a distinct far skyline.
 *
 * `MOUNTAIN_THRESHOLD` is what makes them a RANGE rather than a plateau. Without it the
 * field's mean is half its amplitude, so the whole world lifts 700 m and the horizon is a
 * straight line again, just higher up. Cutting the low end away leaves plain between the
 * ranges, and smoothstepping rather than clamping the cut keeps the foot of each range a
 * curve rather than a crease.
 */
const MOUNTAIN_BANDS: readonly { readonly amplitude: number; readonly wavelength: number }[] = [
  /**
   * The ranges themselves. A crest every ~7 km, 1.3 km at the peak.
   *
   * The wavelength is set by how often you should be able to SEE one, not by geology. At
   * 20 km the ranges were 10 km apart and half the world was plain, so the nearest one was
   * routinely twenty kilometres off, where 1.4 km subtends three degrees and reads as a
   * pale swell rather than as mountains. At 14 km there is usually something inside ten,
   * where the same height is eight degrees.
   */
  { amplitude: 1300, wavelength: 14_000 },
  /** Spurs and saddles, so a range is not one smooth mound. */
  { amplitude: 340, wavelength: 5000 },
];
/** Field value below which there is no mountain at all. Fraction of the band's range. */
const MOUNTAIN_THRESHOLD = 0.15;

/** Tallest the mountain field can reach, metres. */
export const MAX_MOUNTAIN = MOUNTAIN_BANDS.reduce((sum, b) => sum + b.amplitude, 0);

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export class Landscape {
  /** One hash tag per band tempo, plus hilliness, tempo and the mountains. */
  private readonly tags: readonly number[];
  private readonly shortTags: readonly number[];
  private readonly hillTag: number;
  private readonly tempoTag: number;
  private readonly mountainTags: readonly number[];
  /** Field value at the origin, subtracted so the homestead sits at y = 0. */
  private readonly datum: number;

  constructor(seed: number) {
    const base = seed >>> 0;
    this.tags = BANDS.map((_, i) => (base ^ 0x7f4a7c15) + i * 0x9e3779b9);
    this.hillTag = base ^ 0x1b873593;
    // The short tempo is its OWN noise stream, not the long one resampled: sharing a
    // tag would put both tempos' crests in the same places, and the crossfade would
    // read as one hill breathing rather than as two different countries.
    this.shortTags = BANDS.map((_, i) => (base ^ 0x5bf03635) + i * 0x9e3779b9);
    this.tempoTag = base ^ 0x27d4eb2f;
    this.mountainTags = MOUNTAIN_BANDS.map((_, i) => (base ^ 0x2545f491) + i * 0x85ebca6b);
    this.datum = 0;
    this.datum = this.heightAt(0, 0);
  }

  /**
   * Height of the mountain field at a point, metres, 0 on the plain between ranges.
   *
   * Not added to `heightAt` and not part of MAX_SLOPE: this is scenery, and `Terrain`
   * decides where it is allowed to exist. Read the MOUNTAIN_BANDS block for why it is a
   * separate field at all.
   */
  mountainAt(x: number, z: number): number {
    let h = 0;
    for (let i = 0; i < MOUNTAIN_BANDS.length; i++) {
      const b = MOUNTAIN_BANDS[i]!;
      const n = band(this.mountainTags[i]!, x / b.wavelength, z / b.wavelength);
      // The band is in [-1, 1]; take the top of that range and stretch it back to a
      // full 0..1, so a range rises out of plain instead of the plain rising with it.
      h += b.amplitude * smoothstep01((n - MOUNTAIN_THRESHOLD) / (1 - MOUNTAIN_THRESHOLD));
    }
    return h;
  }

  /**
   * How hilly the country is at a point, HILLINESS_FLOOR..1. Its own band, five times
   * longer than the hills it gates, so the landscape has regions rather than one
   * uniform roughness. Its slope contribution is under 0.4% of the gated amplitude,
   * which is why it does not appear in the budget.
   */
  hillinessAt(x: number, z: number): number {
    const n = band(this.hillTag, x / HILLINESS_WAVELENGTH, z / HILLINESS_WAVELENGTH);
    const t = smoothstep01(0.5 + n * 0.7);
    return HILLINESS_FLOOR + (1 - HILLINESS_FLOOR) * t;
  }

  /**
   * The road's PACE at a point, 0..1: 0 is the long tempo (kilometres per climb, the
   * mountain pass), 1 is the short one (a crest every few hundred metres).
   *
   * Its own field, independent of hilliness, so how BIG the country is and how FAST
   * it changes are separate questions. That gives four kinds of place instead of two:
   * long climbs in tall country, long climbs in flat country, quick rollers in tall
   * country, quick rollers in flat country.
   *
   * The 0.7 gain inside the smoothstep is hilliness', and for the same reason: it
   * pushes the field past both ends of the ramp often enough that a fully long and a
   * fully short region genuinely occur instead of everything hovering near a blend.
   */
  tempoAt(x: number, z: number): number {
    const n = band(this.tempoTag, x / TEMPO_WAVELENGTH, z / TEMPO_WAVELENGTH);
    return smoothstep01(0.5 + n * 0.7);
  }

  /** Ground elevation at a world position, metres, relative to the homestead. */
  heightAt(x: number, z: number): number {
    let hilliness = -1;
    let tempo = -1;
    let home = -1;
    let h = 0;
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i]!;
      let weight = 1;
      if (b.home) {
        if (home < 0) {
          home = smoothstep01((Math.sqrt(x * x + z * z) - HOME_FLAT_RADIUS) / HOME_RAMP);
        }
        weight = home;
      }
      if (b.hilliness) {
        if (hilliness < 0) hilliness = this.hillinessAt(x, z);
        weight *= hilliness;
      }
      if (weight === 0) continue;
      if (b.short) {
        if (tempo < 0) tempo = this.tempoAt(x, z);
        const long = b.amplitude * band(this.tags[i]!, x / b.wavelength, z / b.wavelength);
        const short =
          b.short.amplitude *
          band(this.shortTags[i]!, x / b.short.wavelength, z / b.short.wavelength);
        h += (long * (1 - tempo) + short * tempo) * weight;
        continue;
      }
      h += b.amplitude * band(this.tags[i]!, x / b.wavelength, z / b.wavelength) * weight;
    }
    return h - this.datum;
  }
}
