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
 * So elevation is this field, and the field is Lipschitz by construction. Each band
 * is one octave of value noise over its own lattice, and `MAX_SLOPE` is the sum of
 * the bands' individual bounds — arithmetic about the constants in this file, not a
 * hope. Everything downstream inherits it: the road's grade is this field's slope
 * along the road's own tangent, and the open desert is this field plus bounded dune
 * relief.
 *
 * The bands are spread over two decades of wavelength. The 45 km band carries most
 * of the altitude and almost none of the slope, which gives the road long cinematic
 * climbs and descents. The 2.5 km band supplies the sustained grade a driver feels;
 * the 420 m band still supplies crests and brows without turning the route into an
 * obstacle course.
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
 * `hilliness` gates a band by the regional hilliness field. Only the 1800 m band is
 * gated: gating the 420 m band too took mean road grade from 2.7-3.1% down to
 * 1.8-2.8% (tools/road-profile.ts), because that band is where most of the slope
 * budget lives, and it made flat country read as ironed rather than open. `home`
 * ramps a band in around the homestead, so the concrete pad and the driveway have
 * level ground under them.
 */
interface Band {
  readonly amplitude: number;
  readonly wavelength: number;
  readonly hilliness: boolean;
  readonly home: boolean;
}

const BANDS: readonly Band[] = [
  /** Continental: broad altitude changes, almost no slope. */
  { amplitude: 140, wavelength: 45_000, hilliness: false, home: false },
  /** Regional: basins and divides, several minutes of driving across. */
  { amplitude: 70, wavelength: 10_000, hilliness: false, home: false },
  /** Hills: a climb or descent that lasts long enough to choose a gear. */
  { amplitude: 58, wavelength: 2500, hilliness: true, home: true },
  /** Rolls: the crest-and-dip rhythm under the bonnet. */
  { amplitude: 18, wavelength: 420, hilliness: false, home: true },
];

/** How far you drive before flat country becomes hill country, metres. */
const HILLINESS_WAVELENGTH = 9000;
/**
 * Fraction of the gated band kept in the flattest country. Not small: even the flat
 * stretches should breathe, or the contrast makes them read as broken rather than
 * flat.
 */
const HILLINESS_FLOOR = 0.45;

/**
 * Level ground around the origin: fully flat inside `HOME_FLAT_RADIUS`, ramping to
 * full landscape over `HOME_RAMP` beyond it.
 *
 * The homestead's concrete pad spans 4 to 20 m of lateral offset and its driveway
 * ramps from the pad down to the asphalt in 5 m, so ground that tilts under the
 * footprint becomes a lip the starting car has to climb to leave the garage. Only the
 * two short bands are ramped; the long ones are already under 2% here, which is 0.3 m
 * across the pad. The ramp is long because it costs slope of its own —
 * `sum(home amplitudes) * 1.5 / HOME_RAMP` — and a short one would be a hill in
 * itself.
 */
const HOME_FLAT_RADIUS = 200;
const HOME_RAMP = 1200;

/**
 * The steepest this field can be, as a fraction: every band's own bound plus the
 * homestead ramp's. Unlike the old grade clamp this is reached, not merely respected —
 * `+-1` lattice values make the peak case common — so `tools/relief-probe.ts` finds
 * slopes within a factor of two of it rather than a factor of twenty.
 */
export const MAX_SLOPE =
  BANDS.reduce((sum, b) => sum + (b.amplitude * 2 * FADE_PEAK_SLOPE) / b.wavelength, 0) +
  (BANDS.reduce((sum, b) => sum + (b.home ? b.amplitude : 0), 0) * FADE_PEAK_SLOPE) / HOME_RAMP;

/** Total half-range of the field, metres: no ground is further than this from datum. */
export const MAX_RELIEF = BANDS.reduce((sum, b) => sum + b.amplitude, 0);

/**
 * The mountains, which are NOT part of `heightAt` and are the reason the horizon has
 * anything on it.
 *
 * The bands above are sized so a car can drive anywhere in them, which caps them at
 * around 140 m of half-range. That is the right answer for ground you drive on and the
 * wrong one for ground you look at: 140 m at 20 km subtends a fifth of a degree, so a
 * desert built only from them has a horizon that is a straight line however far you can
 * see. What makes a vista is landforms measured in thousands of metres.
 *
 * So they live in their own field, and `Terrain` only lets them in past a couple of
 * kilometres of lateral distance from the road (see MOUNTAIN_START there). That gating is
 * the whole trick: the drivable band never sees them, so nothing about the road's grade or
 * the desert's slope budget changes, while everything past the collider's edge gets a
 * mountain range to be a horizon.
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
  /** One hash tag per band, plus hilliness and the mountains. */
  private readonly tags: readonly number[];
  private readonly hillTag: number;
  private readonly mountainTags: readonly number[];
  /** Field value at the origin, subtracted so the homestead sits at y = 0. */
  private readonly datum: number;

  constructor(seed: number) {
    const base = seed >>> 0;
    this.tags = BANDS.map((_, i) => (base ^ 0x7f4a7c15) + i * 0x9e3779b9);
    this.hillTag = base ^ 0x1b873593;
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

  /** Ground elevation at a world position, metres, relative to the homestead. */
  heightAt(x: number, z: number): number {
    let hilliness = -1;
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
      h += b.amplitude * band(this.tags[i]!, x / b.wavelength, z / b.wavelength) * weight;
    }
    return h - this.datum;
  }
}
