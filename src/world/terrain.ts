import { Crop, LandCover, newCoverSample } from './landcover';
import { Noise2D } from '../core/rng';
import { LakeBasins } from './lakes';
import { corridorBatterAt, outcropBeltAt } from './corridorshape';
import { SurfaceType } from '../core/surfaces';
import { ROAD_HALF_WIDTH, ROAD_MAX_HALF_WIDTH, type Road } from './road';
import { SurfaceField, roadSurfaceY } from './roadsurface';
import { onTerminusPad, terminusWeight } from './terminus';

/**
 * Terrain height is the `Landscape` field plus bounded dune relief. The road is not
 * in it — the road lies on the same field (see road.ts), which is what makes the two
 * agree without either one deriving from the other.
 *
 * That is a reversal. Terrain height used to BE the road's: the ground took the
 * elevation of the nearest centreline point, plus relief expressed as a difference
 * from the relief at that point. It is a tempting construction, and it guarantees a
 * flush corridor, but it also guarantees that wherever the nearest-centreline map
 * folds — every corner tighter than its own offset distance, every fold, every
 * self-crossing — the ground STEPS by the altitude difference between two passes of
 * a road whose altitude was a random walk. landscape.ts has the measurements.
 *
 * What survives is the corridor: inside `CORRIDOR_INNER` the ground is the road
 * surface itself (banking and surface field included), sampled through the same
 * shared function the road ribbon uses. At its edge the asphalt meets the desert
 * terrain flush; from there to `CORRIDOR_OUTER` the ground smoothsteps into the open
 * field. The road's own elevation is that field's, so the blend differs only by
 * camber and centimetre-scale surface detail.
 */

/** Narrow-road reference edge; local corridor edges come from `Road.halfWidthAt(s)`. */
export const CORRIDOR_INNER = ROAD_HALF_WIDTH;
/** Beyond this lateral distance the terrain is open desert. */
export const CORRIDOR_OUTER = 30;
/**
 * Large dune relief fades in from the maintained road cut. The full-height point
 * is deliberately broad: the tallest landforms can rise more than fifty metres,
 * and introducing that height over the old 130 m span made the fade itself a bank.
 */
const RELIEF_FULL = 160;

/** Moraine hummocks: rounded, isotropic, a few metres tall. */
const MORAINE_WAVELENGTH = 240;
const MORAINE_AMPLITUDE = 4.5;
/** Past the asphalt edge, where the moraine starts to rise and over how far. */
const MORAINE_CLEAR = 8;
const MORAINE_ONSET = 70;
/** Hummocks: metre-scale unevenness from just beyond the ditch. */
const HUMMOCK_WAVELENGTH = 28;
const HUMMOCK_AMPLITUDE = 1.1;
const HUMMOCK_CLEAR = 7;
const HUMMOCK_ONSET = 12;

/**
 * The roadside ditch (kyuvet): a shallow drain either side, just past the verge. Its
 * depth wanders along the road and in places it has silted up to nothing.
 */
const DITCH_FROM = 4.2;
const DITCH_WIDTH = 4.6;
const DITCH_DEPTH = 0.85;

/**
 * Ravines. `RAVINE_HALF_WIDTH` is in units of the line field, so the cut's real width
 * is about `RAVINE_HALF_WIDTH * RAVINE_WAVELENGTH * 2` — around 35 m lip to lip, 6 m
 * deep. They never reach the road: `RAVINE_CLEAR` metres outside the asphalt they
 * have not started, and they deepen over the following eighty.
 */
const RAVINE_WAVELENGTH = 420;
const RAVINE_HALF_WIDTH = 0.045;
const RAVINE_DEPTH = 6;
const RAVINE_WARP = 70;
const RAVINE_CLEAR = 14;
/** Metres over which a ravine deepens once it has started. */
const RAVINE_ONSET = 45;
const RAVINE_PATCH_WAVELENGTH = 2600;
const RAVINE_PATCH_THRESHOLD = -0.1;

/** Width of the loose verge outside the asphalt, in metres. */
const VERGE_WIDTH = 3.5;

/**
 * What a wheel standing on the verge is standing on.
 *
 * NOT `Gravel`. The verge is the spoil the grader pushed off the road: loose,
 * uncompacted and never driven on, where a gravel DISTRICT is a packed surface course
 * somebody maintains and drives briskly. They measure differently enough to be
 * different materials — see `SurfaceType.LooseShoulder` — and the verge is where a
 * mistake on this deliberately narrow road puts you, so it has to be the honest one.
 */
const VERGE_SURFACE = SurfaceType.LooseShoulder;

/**
 * Prevailing-wind basis for every dune band. Stretching noise along one fixed axis
 * produces connected ridges and long lee faces; isotropic four-octave FBM produced
 * the crumpled-blanket surface this replaces.
 */
const DUNE_AXIS_X = 0.8192;
const DUNE_AXIS_Z = 0.5736;
const DUNE_WARP_WAVELENGTH = 1600;
const DUNE_WARP_AMPLITUDE = 180;

/** Regional dune ridges: sparse, kilometre-long landforms visible from the road. */
const MEGADUNE_AMPLITUDE = 34;
const MEGADUNE_LENGTH = 1800;
const MEGADUNE_WIDTH = 620;
const MEGADUNE_THRESHOLD = -0.45;

/** The smaller dune field riding between the regional ridges. */
const DUNE_AMPLITUDE = 20;
const DUNE_LENGTH = 850;
const DUNE_WIDTH = 240;
const DUNE_THRESHOLD = -0.35;

/**
 * Low sand ripples provide a little surface scale without changing the silhouette.
 * They are directional too; isotropic two-metre ripples were the visible crumpling.
 */
const RIPPLE_AMPLITUDE = 0;
const RIPPLE_LENGTH = 260;
const RIPPLE_WIDTH = 75;
const RIPPLE_FULL = 55;

/**
 * THE FINE BAND: the ground the driver's spine reads.
 *
 * The shipped desert is the player-centred tile lattice (`deserttiles.ts`), a
 * heightfield with 3 m cells, so nothing below about 7.5 m of wavelength can be
 * geometry at all — below that it aliases into a seed lottery, and it belongs to the
 * per-wheel profile in core/surfaces.ts instead (`microRelief`, `hummock`).
 *
 * Above that floor there are two layers:
 *
 *  1. CORRUGATION. Long-crested transverse ridges about 10 m apart, a hundred metres
 *     of crest, a quarter of a metre tall. Ten metres is 1.7 Hz at 60 km/h and 2.5 at
 *     90 — the primary-ride band, which is what "the car starts to sway and bounce"
 *     actually means, and the band impact deleted when it cut the old isotropic chop
 *     from 0.95 m to 0.3 m and threw the pits away.
 *
 *     It is ORGANISED rather than isotropic, and that is the whole design. The same
 *     energy as isotropic FBM is the crumpled blanket this branch got rid of; laid out
 *     as parallel ridges on the dune band's own axis, bent by `CORRUGATION_BEND` so
 *     they are not a comb, it is a wind-ripple field — which is what a dune field
 *     actually looks like. Hillshading the field at a low sun shows corduroy.
 *
 *     MEASURED, and worth knowing before tuning it: in the game's own renderer it is
 *     invisible either way. `TERRAIN_MATERIAL` runs the comic ground shading over a
 *     hemisphere plus one direct light, and a 2% slope over ten metres does not move
 *     that shading at any hour — screenshots at 09:00 and 17:40 are indistinguishable
 *     from the flat desert. So the ripple layout buys insurance rather than beauty,
 *     and amplitude here is bounded by RIDE and ESCAPABILITY, not by looks.
 *
 *  2. CHOP. A little isotropic 20/10 m noise so the corrugation is not the only thing
 *     in the band and the grain never reads as machined.
 *
 * WAVELENGTH IS TWICE THE CONSTANT. `Noise2D` interpolates between lattice values one
 * unit apart, so a crest and the next trough are one unit and a full cycle is TWO:
 * `CORRUGATION_SPACING = 5` is a ten-metre wave, not a five-metre one. The first cut
 * of this band used 9 and produced an 18 m wave — half the intended excitation
 * frequency and a third of the kick.
 *
 * `CORRUGATION_PATCH_*` is what keeps it from being a uniform texture: corrugation
 * develops where wind has a fetch of loose sand, so its amplitude is modulated by a
 * kilometre-scale field down to `CORRUGATION_PATCH_FLOOR`. Some flats hammer, some
 * are quiet, and which is which is a property of the place.
 *
 * Numbers this band is set by, all at 60 km/h from `tools/desert-washboard.ts` and an
 * in-game drive at 66-68 km/h:
 *
 *                         mesh kick rms/p99    body heave rms/p95 (g)
 *   road (reference)        0.18-0.31 / 0.5-0.9      0.101 / -
 *   desert before           0.095 / 0.32             0.317 / 0.61
 *   desert, 0.24 m         0.300 / 1.09             0.707 / 1.38
 *   desert, 0.36 m         0.40-0.44 / 1.52-1.75       - / -
 */
const CORRUGATION_SPACING = 5;
const CORRUGATION_COHERENCE = 48;
const CORRUGATION_AMPLITUDE = 0.05;
const CORRUGATION_BEND_WAVELENGTH = 420;
const CORRUGATION_BEND = 26;
const CORRUGATION_PATCH_LENGTH = 1500;
const CORRUGATION_PATCH_WIDTH = 430;
const CORRUGATION_PATCH_FLOOR = 0.4;

const CHOP_WAVELENGTH = 20;
const CHOP_AMPLITUDE = 0.22;

/**
 * SCOOPS: the discrete events, and the reason an excursion has a worst moment rather
 * than an average one. Blowout hollows a few metres across, carved where a smooth
 * field crosses a threshold, so they are a pure function of world position rather
 * than a lattice of identical dishes.
 *
 * THE FIELD IS FRACTAL AND THAT IS NOT DECORATION. A single value-noise octave
 * thresholded on a square lattice draws SQUARE contours: hillshading the old
 * construction showed rounded rectangles and L-shapes lying in the sand, axis-aligned
 * across the whole world, which is exactly the machined look this branch set out to
 * get rid of. Three octaves break the contour up into an outline nothing recognises
 * as a lattice.
 *
 * Depth is bounded by ESCAPABILITY, not by looks: a scoop is the one part of this
 * band that makes a basin, so it sets the worst grade a stopped car finds under its
 * wheels. Sand traction is calibrated against the real wheel model rather than the
 * surface coefficient alone: `runInclineLaunchCheck` requires a stock VAZ-2106 to
 * pull away on a five-degree sandy incline. The depth and threshold keep the steeper
 * scoop faces sparse. `tools/desert-washboard.ts` still reports the wider
 * blocked/stranded census that bounds them.
 */
const SCOOP_WAVELENGTH = 26;
const SCOOP_THRESHOLD = 0.5;
const SCOOP_DEPTH = 0.18;

/**
 * Lateral distance at which the fine band is fully in. Short on purpose: the player
 * feels this layer the moment two wheels are off the asphalt, and that is the whole
 * reason it is split out of `relief` — the dunes have to arrive slowly, the
 * corrugation does not.
 */
const DETAIL_FADE_IN = 10;
/**
 * Lateral distance past which the fine band starts giving way to the coarse mesh, and
 * the outer limit of the corridor landform in `corridorshape.ts`: inside it, the two
 * detail functions below are the same function, which is what lets that landform ride
 * in both without the tile lattice and the road-fan disagreeing about it.
 */
export const DETAIL_HOLD = 62;
/**
 * The refined terrain grid ends here, so this layer must be exactly zero at the
 * boundary to keep its collider and the coarse mesh watertight.
 */
export const DETAIL_REACH = 80;

/** Sparse rock shelves and broad dry washes interrupt the sand without shredding it. */
const OUTCROP_WAVELENGTH = 260;
const OUTCROP_THRESHOLD = 0.56;
const OUTCROP_AMPLITUDE = 0;
/**
 * What the director's `outcrop` belt does to the rock field it is standing on, and the
 * reason the threshold moves as far as it does.
 *
 * A belt is a ribbon: 250 to 600 m of road by the 50 m of ground this feature reaches,
 * and the rock field's wavelength is 260 m. Only 2.4% of the plain is over the open
 * field's 0.56, so a belt that merely lifted that ground left two events in three with
 * NOTHING IN THEM — measured, 3 belts of 12. A scheduled kind that does not appear is
 * the schedule lying, so the belt's threshold is set from the other end: over 101 real
 * belts on four seeds the highest the field reaches inside one is -0.085 at worst, and
 * -0.4 is the threshold that still stands 1.8 m of rock up in THAT belt. About
 * three quarters of a belt is then above it, which is the difference between a rock
 * district and a boulder: the ground is up on rock for the length of the event, sand
 * stays in the low ground between the shelves, and the shelves have an edge because
 * the height uses `t * (2 - t)` rather than the open field's rounded `t * t`.
 */
const OUTCROP_BELT_AMPLITUDE = 0;
const OUTCROP_BELT_THRESHOLD = -0.4;

const WASH_WAVELENGTH_X = 700;
const WASH_WAVELENGTH_Z = 1600;
const WASH_THRESHOLD = 0.48;
const WASH_DEPTH = 2.5;
/** Wetness past which the ground is mud. */
const MUD_WETNESS = 0.55;
const WASH_FULL = 220;

/**
 * The world's edge, in two pieces that do two different jobs.
 *
 * THE BERM is the bank. The solid ground stops at `PHYSICS_LATERAL` (600 m,
 * terrainmesh.ts) and something has to discourage driving off it. This is a short steep
 * rise just inside that edge, cresting just outside it, so a car meets its worst gradient
 * while it still has ground under it.
 *
 * It is DELIBERATELY LOW, and that is the whole change from the escarpment it replaces.
 * That was 78-100 m tall starting 400 m out, and from the driver's seat it covered
 * everything below ten degrees of elevation: a basin wall a few hundred metres away was
 * the entire horizon, and the desert read as a corridor rather than as somewhere vast. At
 * 26 m and 580 m out this one subtends about three degrees.
 *
 * THE HONEST COST, measured: the old escarpment was un-crestable, and this is only very
 * hard. Driven straight at it flat out from 400 m of run-up, the starting saloon reached
 * the crest at 32 km/h having lost 26 km/h on the face, crossed the collider's edge and
 * was towed back to the road by `main.ts`. So the guarantee changed from "you cannot leave
 * the world" to "leaving it takes a deliberate run and puts you back on the road". That is
 * the price of the horizon, and `BERM_HEIGHT` is the one constant that buys it back.
 *
 * THE MOUNTAINS are the horizon, and they are what a low bank buys. `Landscape.mountainAt`
 * carries ranges over a kilometre tall; this ramps them in from `MOUNTAIN_START` so the
 * drivable band never contains any of them and the slope budget in landscape.ts is
 * untouched.
 *
 * The arithmetic that makes the pair work: the berm crest sits at about three degrees of
 * elevation from the road, so anything taller than `tan(3 deg) * range` clears it — 630 m
 * at 12 km, 1310 m at 25 km, both inside what the mountain field reaches. Raise the berm
 * and you lose the far horizon first and the near one after.
 */
export const BERM_START = 545;
/** Lateral distance where the berm reaches its crest. Just past the solid band's edge. */
export const BERM_CREST = 620;
/**
 * Height of the crest above the basin floor, metres. With the 75 m face above it the peak
 * gradient is `HEIGHT * ragged * 1.5 / run`, about 68% or 34 degrees. The first attempt
 * spread 22 m over 140 m and measured 20 degrees, which a car on sand pulls up without
 * noticing.
 */
const BERM_HEIGHT = 26;
/** Lateral distance by which the berm has fallen back to nothing. */
export const BERM_FADE = 1100;
/** Crest height varies by this fraction of BERM_HEIGHT along the bank. */
const BERM_RAGGED = 0.3;
/** Wavelength of that variation, metres. Long: a skyline, not a saw. */
const BERM_RAGGED_WAVELENGTH = 900;
/**
 * Lateral distance at which the mountains start, and the distance over which they reach
 * full height. `BERM_FADE` must stay below the start: between the two the ground is the
 * plain landscape, and nothing about the world's edge is left standing for the mountains
 * to have to be taller than.
 *
 * The ramp was 14 km first and that was the wrong answer visually: it put every range
 * inside sixteen kilometres at a fraction of its height, so a 1400 m range at 8 km drew
 * 490 m tall and the horizon read as a low plateau band rather than as mountains. At 7 km
 * a range is full height by 9.5 km, where 1.4 km subtends eight degrees. The cost is the
 * ramp's own gradient — `amplitude * 1.5 / ramp`, about 30% — which is a mountain's foot
 * slope, several kilometres outside anything solid.
 */
const MOUNTAIN_START = 2500;
const MOUNTAIN_RAMP = 7000;

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Converts a signed directional field into a sparse rounded dune above a flat floor. */
function duneRise(value: number, threshold: number): number {
  const t = smoothstep01((value - threshold) / (1 - threshold));
  return t * t;
}

/** The rock threshold at a belt strength: the open field's when there is no belt. */
function beltRockThreshold(belt: number): number {
  return OUTCROP_THRESHOLD + (OUTCROP_BELT_THRESHOLD - OUTCROP_THRESHOLD) * belt;
}

export class Terrain {
  private readonly duneNoise: Noise2D;
  private readonly rippleNoise: Noise2D;
  private readonly chopNoise: Noise2D;
  private readonly corrugationNoise: Noise2D;
  private readonly corrugationBendNoise: Noise2D;
  private readonly corrugationPatchNoise: Noise2D;
  private readonly scoopNoise: Noise2D;
  private readonly outcropNoise: Noise2D;
  private readonly washNoise: Noise2D;
  private readonly field: SurfaceField;
  /**
   * The world seed, kept because the variety director is asked per detail sample which
   * horizon feature is running here (see `corridorshape.ts`). Every noise above has
   * already folded the seed into its own hash; the director has not.
   */
  private readonly seed: number;

  constructor(
    seed: number,
    private readonly road: Road,
  ) {
    this.seed = seed;
    this.duneNoise = new Noise2D(seed ^ 0xc2b2ae35);
    this.rippleNoise = new Noise2D(seed ^ 0x27d4eb2f);
    this.chopNoise = new Noise2D(seed ^ 0x9e3779b9);
    this.corrugationNoise = new Noise2D(seed ^ 0x165667b1);
    this.corrugationBendNoise = new Noise2D(seed ^ 0x85ebca6b);
    this.corrugationPatchNoise = new Noise2D(seed ^ 0xff51afd7);
    this.scoopNoise = new Noise2D(seed ^ 0xc4ceb9fe);
    this.outcropNoise = new Noise2D(seed ^ 0xd3a2646c);
    this.washNoise = new Noise2D(seed ^ 0x94d049bb);
    this.field = new SurfaceField(seed);
    this.cover = new LandCover(seed);
    this.basins = new LakeBasins(road, seed);
    // The grade a basin is cut into is the open desert at its centre, which is this
    // object's own height function minus the basins themselves. Handing it over
    // rather than letting `LakeBasins` call back into `openBase` is what keeps the
    // two from recursing.
    this.basins.setGradeReader((x, z) => this.undugOpen(x, z, RELIEF_FULL, 0));
  }

  /** Lake basins dug into this terrain, and the schedule they come from. */
  readonly basins: LakeBasins;
  /** What grows where: wood, field, meadow (world/landcover.ts). */
  readonly cover: LandCover;

  /** Strength of the rock-outcrop field at a point, used for both height and material. */
  private outcropAt(x: number, z: number): number {
    return this.outcropNoise.fbm(x / OUTCROP_WAVELENGTH, z / OUTCROP_WAVELENGTH, 3, 2.1, 0.5);
  }

  /**
   * Open-desert landforms at a point. Every term is a pure function of world
   * position; `dist` only grades the maintained corridor into the dune field.
   */
  private relief(x: number, z: number, dist: number, inner: number): number {
    // The moraine is not held back for a graded corridor any more: a back road runs
    // through the land as it lies, and the ground beside it rises and falls from the
    // far side of the ditch.
    const fade = smoothstep01((dist - inner - MORAINE_CLEAR) / MORAINE_ONSET);
    const nearFade = smoothstep01((dist - inner - HUMMOCK_CLEAR) / HUMMOCK_ONSET);

    // Hummocks: tussock mounds and old spoil, a metre or so, the unevenness a walker
    // feels and a car rolls over. Right from beyond the ditch.
    let h = this.corrugationPatchNoise.fbm(x / HUMMOCK_WAVELENGTH, z / HUMMOCK_WAVELENGTH, 2, 2.3, 0.5) *
      HUMMOCK_AMPLITUDE * nearFade;

    // Moraine: the rounded, directionless hummocking an ice sheet leaves behind.
    // Isotropic on purpose — the dune axis was wind, and there is no wind in this.
    h += this.duneNoise.fbm(x / MORAINE_WAVELENGTH, z / MORAINE_WAVELENGTH, 3, 2.1, 0.45) *
      MORAINE_AMPLITUDE * fade;

    // Ravines (ovragi): narrow, meandering V-cuts where the zero set of a warped
    // noise field runs. `patch` switches whole districts of them on and off, so
    // some country is dissected and some is not.
    const ravine = this.ravineAt(x, z);
    if (ravine > 0) {
      // `t * t * (3 - 2t)` rounds the lip and the floor; the flanks stay steep.
      h -= ravine * ravine * (3 - 2 * ravine) * RAVINE_DEPTH *
        smoothstep01((dist - inner - RAVINE_CLEAR) / RAVINE_ONSET);
    }

    // Lowlands: broad shallow hollows where water stands in spring. Kept from the
    // desert's washes, which were the same shape for a different reason.
    const wash = this.washNoise.fbm(x / WASH_WAVELENGTH_X, z / WASH_WAVELENGTH_Z, 2, 1.8, 0.55);
    if (wash > WASH_THRESHOLD) {
      const t = (wash - WASH_THRESHOLD) / (1 - WASH_THRESHOLD);
      const washFade = smoothstep01((dist - inner) / (WASH_FULL - inner));
      h -= t * t * WASH_DEPTH * washFade;
    }
    return h;
  }

  /**
   * How deep into a ravine a point is, 0 (none, or outside its lip) .. 1 (its floor),
   * before the road-clearance fade. Public because the planting reads it: a ravine is
   * where the scrub and the alder grow.
   */
  ravineAt(x: number, z: number): number {
    const patch = this.washNoise.at(x / RAVINE_PATCH_WAVELENGTH, z / RAVINE_PATCH_WAVELENGTH);
    if (patch <= RAVINE_PATCH_THRESHOLD) return 0;
    const wx = x + this.rippleNoise.at(x / 380, z / 380) * RAVINE_WARP;
    const wz = z + this.rippleNoise.at(z / 380 + 17, x / 380 - 9) * RAVINE_WARP;
    const line = Math.abs(this.chopNoise.fbm(wx / RAVINE_WAVELENGTH, wz / RAVINE_WAVELENGTH, 2, 2.2, 0.35));
    if (line >= RAVINE_HALF_WIDTH) return 0;
    return (1 - line / RAVINE_HALF_WIDTH) * smoothstep01((patch - RAVINE_PATCH_THRESHOLD) / 0.15);
  }

  /**
   * The fine band at a point, UNFADED: corrugation, chop and scoops (see the
   * constants above). One function so the shipped tile lattice and the legacy road
   * fan cannot carry different ground, and so the two fades below are the only
   * difference between them.
   */
  private fineRelief(x: number, z: number): number {
    // The dune band's own axis, so the ripples run WITH the ridges. `across` is the
    // direction the crests are counted along; `along` is a crest's own length.
    const along = x * DUNE_AXIS_X + z * DUNE_AXIS_Z;
    const across = -x * DUNE_AXIS_Z + z * DUNE_AXIS_X;

    // Bending `across` rather than rotating the basis buys the same curved crest
    // lines for one noise sample and no trigonometry.
    const bend =
      this.corrugationBendNoise.at(
        along / CORRUGATION_BEND_WAVELENGTH,
        across / CORRUGATION_BEND_WAVELENGTH,
      ) * CORRUGATION_BEND;
    const patch = this.corrugationPatchNoise.at(
      along / CORRUGATION_PATCH_LENGTH,
      across / CORRUGATION_PATCH_WIDTH,
    );
    const strength =
      CORRUGATION_PATCH_FLOOR + (1 - CORRUGATION_PATCH_FLOOR) * smoothstep01(patch * 0.5 + 0.5);
    let h =
      this.corrugationNoise.at((across + bend) / CORRUGATION_SPACING, along / CORRUGATION_COHERENCE) *
      CORRUGATION_AMPLITUDE *
      strength;

    h += this.chopNoise.fbm(x / CHOP_WAVELENGTH, z / CHOP_WAVELENGTH, 2, 2, 0.5) * CHOP_AMPLITUDE;

    // `t * (2 - t)` gives the hollow a flattish floor and steep walls instead of the
    // cone a linear ramp leaves, so a wheel drops into it and climbs out again.
    const scoop = this.scoopNoise.fbm(x / SCOOP_WAVELENGTH, z / SCOOP_WAVELENGTH, 3, 2.3, 0.5);
    if (scoop > SCOOP_THRESHOLD) {
      const t = (scoop - SCOOP_THRESHOLD) / (1 - SCOOP_THRESHOLD);
      h -= t * (2 - t) * SCOOP_DEPTH;
    }
    return h;
  }

  /**
   * The fine band for the legacy road-aligned refined grid, plus the corridor
   * landform. It fades to exactly zero at both of that mesh's seams; large-scale dune
   * shape remains in `relief`.
   */
  detailAt(x: number, z: number, dist: number, s: number): number {
    const inner = this.road.halfWidthAt(s);
    if (dist <= inner || dist >= DETAIL_REACH) return 0;
    const paved = terminusWeight(x, z);
    if (paved >= 1) return 0;
    const fade =
      smoothstep01((dist - inner) / (DETAIL_FADE_IN - inner)) *
      (1 - smoothstep01((dist - DETAIL_HOLD) / (DETAIL_REACH - DETAIL_HOLD)));
    if (fade <= 0) return 0;
    // The corridor landform is added UNFADED, and it is safe to do that here because
    // it is zero outside `CORRIDOR_KEEP_M`..`DETAIL_HOLD` by its own profile. The fade
    // either side of it is a RESOLUTION fade for wheel-scale relief; multiplying a
    // seven-metre crest by it would have thinned the crest over exactly the twenty
    // metres it is supposed to climb, and cut its outer flank off at 62 m mid-air.
    return (
      (this.fineRelief(x, z) * fade + this.corridorShape(x, z, dist, s, inner)) * (1 - paved)
    );
  }

  /** Fine band and corridor landform for the player-centred tile lattice. */
  explorationDetailAt(x: number, z: number, dist: number, s: number): number {
    const inner = this.road.halfWidthAt(s);
    if (dist <= inner) return 0;
    // Wheel-scale relief is faded out under the turning circle's paving, so the pad is
    // a pad rather than a flat height with sand ripples standing on it.
    const paved = terminusWeight(x, z);
    if (paved >= 1) return 0;
    const fade = smoothstep01((dist - inner) / (DETAIL_FADE_IN - inner));
    return (
      (this.fineRelief(x, z) * fade + this.corridorShape(x, z, dist, s, inner)) * (1 - paved)
    );
  }

  /**
   * THE CORRIDOR LANDFORM at a point, in metres of ground movement: the director's
   * cut, embankment and outcrop-belt events, which are the only scheduled thing in the
   * terrain. See `corridorshape.ts` for the shape and for why it rides in the detail
   * layer rather than in the base field.
   *
   * Public because two callers outside this file need the term on its own. The desert
   * tile builder has to keep it out of the `detailOffsets` its shader fades away with
   * distance — landform is not wheel-scale relief, and fading a five-metre embankment
   * out would put the far tile surface above the trough the near mesh is drawing —
   * and `tools/corridor-shape.ts` measures it: a crest can only be checked against the
   * height it is supposed to reach by subtracting the desert it is standing on.
   */
  corridorShapeAt(x: number, z: number, dist: number, s: number): number {
    return this.corridorShape(x, z, dist, s, this.road.halfWidthAt(s));
  }

  /**
   * The same, for a caller that already has the local asphalt half-width. One
   * `varietyEventAt` per kind, both memoised on the window, and the rock field is
   * sampled only where a belt is actually running.
   */
  private corridorShape(x: number, z: number, dist: number, s: number, inner: number): number {
    let h = corridorBatterAt(this.seed, s, dist, inner);
    const toEdge = dist - inner;
    if (toEdge > DITCH_FROM && toEdge < DITCH_FROM + DITCH_WIDTH) {
      const t = (toEdge - DITCH_FROM) / DITCH_WIDTH;
      const depth = smoothstep01(0.5 + this.washNoise.at(s / 260 + 91, 3));
      h -= Math.sin(Math.PI * t) ** 1.6 * DITCH_DEPTH * depth;
    }
    const belt = outcropBeltAt(this.seed, s, dist, inner);
    if (belt > 0) {
      const threshold = beltRockThreshold(belt);
      const outcrop = this.outcropAt(x, z);
      if (outcrop > threshold) {
        const t = (outcrop - threshold) / (1 - threshold);
        // `t * (2 - t)` where the open field uses `t * t`: flat-topped, so the belt is
        // shelves and slabs with an edge to them. The open field's rounded cones are
        // right at a kilometre and read as heaps of spoil at thirty metres.
        h += t * (2 - t) * OUTCROP_BELT_AMPLITUDE * belt;
      }
    }
    return h;
  }

  /**
   * Open-desert height without wheel-scale detail. This is now the driveable field:
   * no berm and no road-distance mountain wall. Horizon mountains are applied only
   * by `horizonHeight`, in the camera-centred vista where they remain unreachable.
   */
  openBase(x: number, z: number, dist: number, s: number): number {
    const open = this.undugOpen(x, z, dist, s);
    // Lake basins are DUG: they are part of the collided ground, in the mesh and in
    // the tile worker, so the water in `render/lakewater.ts` stands in a real hollow
    // (see world/lakes.ts). Away from a basin this returns `open` untouched.
    return this.basins.shape(x, z, open, s);
  }

  /** The open desert before any basin is cut into it. */
  private undugOpen(x: number, z: number, dist: number, s: number): number {
    return this.road.landscape.heightAt(x, z) + this.relief(x, z, dist, this.road.halfWidthAt(s));
  }

  /** Legacy road-fan height, retaining its finite detail seam for tooling. */
  openHeight(x: number, z: number, dist: number, s: number): number {
    return this.openBase(x, z, dist, s) + this.detailAt(x, z, dist, s);
  }

  /** Fine open terrain used by the player-centred desert tiles. */
  explorationHeight(x: number, z: number, dist: number, s: number): number {
    return this.openBase(x, z, dist, s) + this.explorationDetailAt(x, z, dist, s);
  }

  /** Base landscape for distant meshes that deliberately omit dune relief. */
  baseHeight(x: number, z: number, _dist: number): number {
    return this.road.landscape.heightAt(x, z);
  }

  /**
   * The corridor grading, base only: the road-edge elevation smoothstepped out into
   * the open field between `CORRIDOR_INNER` and `CORRIDOR_OUTER`.
   *
   * The seam is continuous because the edge anchor and open field share the road's
   * centreline field elevation.
   *
   * Past `CORRIDOR_OUTER` this returns the open field directly. That skips a
   * `roadEdgeHeight` sample which would otherwise be computed and discarded.
   */
  private gradedBase(x: number, z: number, dist: number, s: number, side: number): number {
    const open = this.openBase(x, z, dist, s);
    if (dist >= CORRIDOR_OUTER) return open;
    const innerWidth = this.road.halfWidthAt(s);
    const t0 = (dist - innerWidth) / (CORRIDOR_OUTER - innerWidth);
    const t = t0 * t0 * (3 - 2 * t0);
    const inner = this.roadEdgeHeight(s, side);
    return inner + (open - inner) * t;
  }

  /**
   * Ground height at a world position.
   *
   * `hintS` is the caller's last known arclength; pass it for anything queried per
   * frame, since the underlying road projection is a search.
   *
   * NOT the surface that is drawn or collided past a few tens of metres of lateral
   * offset, and the difference is the berm. `Road.project` refines from the hint, so
   * where the road folds back it can settle on either of two local minima and the
   * distance it returns jumps — which past BERM_START jumps the berm with it.
   * `TerrainMeshProvider` avoids that by interpolating a GLOBAL nearest-branch
   * distance off an absolute lattice, and the mesh's own vertices are what the
   * collider is built from. Everything that queries this far off the road (the
   * rescue check, bird cruise altitude) only wants a number within a few metres;
   * props scatter stays inside 42 m, where the rim is zero and the two agree.
   *
   * The detail layer is added OUTSIDE the corridor grading, not inside the field it
   * grades. Inside, the grading's own weight is 0.10 at ten metres off the road edge,
   * which is where the chop is most wanted and where it was being multiplied away.
   * `detailAt` is zero at `CORRIDOR_INNER` by its own fade, so the seam onto the
   * asphalt is continuous without the grading's help.
   */
  heightAt(x: number, z: number, hintS?: number): number {
    const p = this.road.project(x, z, hintS);
    const dist = Math.abs(p.lateral);
    const base =
      dist <= this.road.halfWidthAt(p.s)
        ? roadSurfaceY(this.road, this.field, p.s, p.lateral, x, z)
        : this.gradedBase(x, z, dist, p.s, Math.sign(p.lateral));
    return this.levelForTerminus(x, z, base) + this.explorationDetailAt(x, z, dist, p.s);
  }

  /**
   * Height for a point whose road frame is already known, detail layer left out.
   *
   * Grid builders generate their points FROM the road frame (an `s` row and a
   * lateral column), so making them call `heightAt` throws that away and pays for a
   * road projection per vertex — measured at ~16 us a vertex, which is most of a
   * chunk's build time. Here the caller passes the column's lateral offset and the
   * row's arclength. Same formula as `heightAt`, no search.
   *
   * Base only because its one caller is the terrain mesh's sparse field lattice,
   * which must not sample the detail layer at all (see `detailAt`).
   */
  baseFromFrame(x: number, z: number, lateral: number, s: number): number {
    const dist = Math.abs(lateral);
    const base =
      dist <= this.road.halfWidthAt(s)
        ? roadSurfaceY(this.road, this.field, s, lateral, x, z)
        : this.gradedBase(x, z, dist, s, Math.sign(lateral));
    return this.levelForTerminus(x, z, base);
  }

  /**
   * The turning circle's paving is LEVEL, and this is the only place the terrain says
   * so. Blended, not switched: the weight is 1 over the whole disc and eases to 0 by
   * the rim, so the pad is a pad and the desert around it is still the desert.
   *
   * Applied once, at the base, with the detail layers faded to nothing by the same
   * weight. Every consumer - the drawn mesh, the collider baked from it, the tile
   * worker, the rescue check - therefore gets one number, and the pad in
   * `world/terminuspad.ts` can be built flat and sit exactly on it.
   */
  private levelForTerminus(x: number, z: number, height: number): number {
    const w = terminusWeight(x, z);
    if (w === 0) return height;
    return height + (this.terminusSurfaceY(x, z) - height) * w;
  }

  /**
   * The paving's own height: the road's surface field read at the START of the road,
   * carried back across the apron.
   *
   * Not a constant plane. Using the road's own field means the pad meets the asphalt at
   * the mouth with no step to measure - the two are the same function at s = 0 - and the
   * pad keeps the surface's wheel-scale texture instead of reading as a poured slab. The
   * lateral term is dropped (0, not `x`) so the edge-break groove that belongs to a
   * 5.8 m ribbon does not get extruded across a 34 m disc.
   *
   * `world/terminuspad.ts` builds its mesh from this, so the drawn asphalt and the
   * collided ground are one surface.
   */
  terminusSurfaceY(x: number, z: number): number {
    return roadSurfaceY(this.road, this.field, 0, 0, x, z);
  }

  /** Fine driveable height for a caller that already owns the exact road frame. */
  explorationHeightFromFrame(x: number, z: number, lateral: number, s: number): number {
    return this.baseFromFrame(x, z, lateral, s) + this.explorationDetailAt(x, z, Math.abs(lateral), s);
  }

  /** Legacy finite-detail frame sample used by road-fan tooling. */
  heightFromFrame(x: number, z: number, lateral: number, s: number): number {
    return this.baseFromFrame(x, z, lateral, s) + this.detailAt(x, z, Math.abs(lateral), s);
  }

  /** Mountain contribution actually drawn at a camera-relative vista distance. */
  private horizonMountainHeight(x: number, z: number, distanceFromCamera: number): number {
    if (distanceFromCamera <= MOUNTAIN_START) return 0;
    return (
      this.road.landscape.mountainAt(x, z) *
      smoothstep01((distanceFromCamera - MOUNTAIN_START) / MOUNTAIN_RAMP)
    );
  }

  /**
   * Camera-centred horizon height. `distanceFromCamera` rather than distance from
   * the road makes mountain ranges permanent horizon scenery. `reliefWeight` is a
   * continuous vista fade; a boolean cutoff would turn a tall dune into a ring cliff.
   */
  horizonHeight(
    x: number,
    z: number,
    distanceFromCamera: number,
    reliefWeight: number,
  ): number {
    let h = this.road.landscape.heightAt(x, z);
    if (reliefWeight > 0) {
      h += this.relief(x, z, RELIEF_FULL, ROAD_MAX_HALF_WIDTH) * Math.min(1, reliefWeight);
    }
    h += this.horizonMountainHeight(x, z, distanceFromCamera);
    return h;
  }

  /**
   * Road-surface height at one asphalt edge (`side` = ±1). At the local half-width,
   * both road and desert meshes sample this exact value.
   */
  private roadEdgeHeight(s: number, side: number): number {
    const halfWidth = this.road.halfWidthAt(s);
    const p = this.road.offsetPoint(s, side * halfWidth);
    return roadSurfaceY(this.road, this.field, s, side * halfWidth, p.x, p.z);
  }

  /** `surfaceAt` for a caller that already knows the lateral offset. */
  surfaceFromFrame(x: number, z: number, lateral: number, s: number): SurfaceType {
    const inner = this.road.halfWidthAt(s);
    const dist = Math.abs(lateral);
    const toEdge = dist - inner;
    // Inside the paint the ROAD collider owns the contact and this answer is only
    // reachable if a wheel has slipped through the ribbon, so it keeps the district
    // material as a harmless default. Outside it is the shoulder, and past that the
    // open desert.
    if (toEdge <= 0) return SurfaceType.Gravel;
    if (toEdge <= VERGE_WIDTH) return VERGE_SURFACE;
    return this.coverSurface(x, z, dist);
  }

  /** Countryside ground: bare soil on ploughland, turf everywhere else. */
  private coverSurface(x: number, z: number, roadDist: number): SurfaceType {
    if (this.wetnessAt(x, z) > MUD_WETNESS) return SurfaceType.Mud;
    this.cover.sample(x, z, roadDist, this.coverScratch);
    return this.coverScratch.crop === Crop.Ploughed ? SurfaceType.Soil : SurfaceType.Grass;
  }

  /**
   * How wet the ground is, 0..1: the floor of a lowland or a ravine, and scattered
   * hollows where the water stands after rain. Past `MUD_WETNESS` it is mud underfoot,
   * and the ground is painted with it (world/deserttiledata.ts).
   */
  wetnessAt(x: number, z: number): number {
    let w = 0;
    const wash = this.washNoise.fbm(x / WASH_WAVELENGTH_X, z / WASH_WAVELENGTH_Z, 2, 1.8, 0.55);
    if (wash > WASH_THRESHOLD) w = Math.max(w, (wash - WASH_THRESHOLD) / (1 - WASH_THRESHOLD) * 1.6);
    const ravine = this.ravineAt(x, z);
    if (ravine > 0.55) w = Math.max(w, (ravine - 0.55) / 0.45);
    // Puddled hollows: a sparse, blotchy field of a few tens of metres.
    const hollow = this.scoopNoise.fbm(x / 60 + 11, z / 60 - 7, 2, 2.1, 0.5);
    if (hollow > 0.42) w = Math.max(w, (hollow - 0.42) / 0.2);
    return Math.min(1, w);
  }

  private readonly coverScratch = newCoverSample();

  /**
   * Surface material beyond the graded road corridor, without a road projection.
   *
   * No belt term, and it does not need one: its only caller is the desert tile prop
   * pass, which skips every candidate inside 65 m of the road — outside
   * `CORRIDOR_REACH_M`, where a belt is already zero.
   */
  openSurfaceAt(x: number, z: number): SurfaceType {
    return this.coverSurface(x, z, 1e6);
  }

  /** Surface material of the open ground at a point. The road itself is separate. */
  surfaceAt(x: number, z: number, hintS?: number): SurfaceType {
    // The turning circle is paved, and the terrain has to agree with the pad's own
    // collider about that or a wheel that crosses the seam changes surface twice.
    if (onTerminusPad(x, z)) return SurfaceType.Asphalt;
    const p = this.road.project(x, z, hintS);
    const inner = this.road.halfWidthAt(p.s);
    const dist = Math.abs(p.lateral);
    const toEdge = dist - inner;
    if (toEdge <= 0) return SurfaceType.Gravel;
    if (toEdge <= VERGE_WIDTH) return VERGE_SURFACE;
    return this.coverSurface(x, z, dist);
  }

  /**
   * Upward normal at a point, by central difference. `eps` should match the mesh
   * resolution being shaded, or the normals will disagree with the geometry.
   */
  normalAt(x: number, z: number, eps = 1, hintS?: number): { x: number; y: number; z: number } {
    const dhx = this.heightAt(x + eps, z, hintS) - this.heightAt(x - eps, z, hintS);
    const dhz = this.heightAt(x, z + eps, hintS) - this.heightAt(x, z - eps, hintS);
    const nx = -dhx / (2 * eps);
    const nz = -dhz / (2 * eps);
    const len = Math.hypot(nx, 1, nz);
    return { x: nx / len, y: 1 / len, z: nz / len };
  }
}
