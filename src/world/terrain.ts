import { Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_HALF_WIDTH, type Road } from './road';
import { SurfaceField, roadSurfaceY } from './roadsurface';

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

/** Asphalt edge and inner boundary of the desert terrain. */
export const CORRIDOR_INNER = ROAD_HALF_WIDTH;
/** Beyond this lateral distance the terrain is open desert. */
export const CORRIDOR_OUTER = 30;
/**
 * Large dune relief fades in from the maintained road cut. The full-height point
 * is deliberately broad: the tallest landforms can rise more than fifty metres,
 * and introducing that height over the old 130 m span made the fade itself a bank.
 */
const RELIEF_FULL = 200;

/** Width of the gravel verge outside the asphalt, in metres. */
const VERGE_WIDTH = 3.5;

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
const RIPPLE_AMPLITUDE = 0.55;
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
 *   desert now              0.300 / 1.09             0.707 / 1.38
 */
const CORRUGATION_SPACING = 5;
const CORRUGATION_COHERENCE = 48;
const CORRUGATION_AMPLITUDE = 0.24;
const CORRUGATION_BEND_WAVELENGTH = 420;
const CORRUGATION_BEND = 26;
const CORRUGATION_PATCH_LENGTH = 1500;
const CORRUGATION_PATCH_WIDTH = 430;
const CORRUGATION_PATCH_FLOOR = 0.4;

const CHOP_WAVELENGTH = 20;
const CHOP_AMPLITUDE = 0.3;

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
 * wheels. Sand's `frictionSlip` is 1.15 now (it was 1.35 when the old 0.55 m pits
 * were measured), which buys a 15% pull-away grade for a two-wheel-drive saloon, so
 * the depth came down with it and the threshold went up to make them sparser.
 * `tools/desert-washboard.ts` reports the blocked/stranded census that bounds both.
 */
const SCOOP_WAVELENGTH = 26;
const SCOOP_THRESHOLD = 0.5;
const SCOOP_DEPTH = 0.32;

/**
 * Lateral distance at which the fine band is fully in. Short on purpose: the player
 * feels this layer the moment two wheels are off the asphalt, and that is the whole
 * reason it is split out of `relief` — the dunes have to arrive slowly, the
 * corrugation does not.
 */
const DETAIL_FADE_IN = 10;
const DETAIL_HOLD = 62;
/**
 * The refined terrain grid ends here, so this layer must be exactly zero at the
 * boundary to keep its collider and the coarse mesh watertight.
 */
export const DETAIL_REACH = 80;

/** Sparse rock shelves and broad dry washes interrupt the sand without shredding it. */
const OUTCROP_WAVELENGTH = 260;
const OUTCROP_THRESHOLD = 0.56;
const OUTCROP_AMPLITUDE = 7;
const WASH_WAVELENGTH_X = 700;
const WASH_WAVELENGTH_Z = 1600;
const WASH_THRESHOLD = 0.48;
const WASH_DEPTH = 4.5;
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

  constructor(
    seed: number,
    private readonly road: Road,
  ) {
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
  }

  /** Strength of the rock-outcrop field at a point, used for both height and material. */
  private outcropAt(x: number, z: number): number {
    return this.outcropNoise.fbm(x / OUTCROP_WAVELENGTH, z / OUTCROP_WAVELENGTH, 3, 2.1, 0.5);
  }

  /**
   * Open-desert landforms at a point. Every term is a pure function of world
   * position; `dist` only grades the maintained corridor into the dune field.
   */
  private relief(x: number, z: number, dist: number): number {
    const duneFade = smoothstep01(
      (dist - CORRIDOR_INNER) / (RELIEF_FULL - CORRIDOR_INNER),
    );
    const along = x * DUNE_AXIS_X + z * DUNE_AXIS_Z;
    const across = -x * DUNE_AXIS_Z + z * DUNE_AXIS_X;
    const warp =
      this.rippleNoise.fbm(
        along / DUNE_WARP_WAVELENGTH,
        across / DUNE_WARP_WAVELENGTH,
        2,
        2,
        0.45,
      ) * DUNE_WARP_AMPLITUDE;
    const warpedAcross = across + warp;

    const megadune = duneRise(
      this.duneNoise.fbm(
        (along + 3100) / MEGADUNE_LENGTH,
        (warpedAcross - 1900) / MEGADUNE_WIDTH,
        2,
        2,
        0.42,
      ),
      MEGADUNE_THRESHOLD,
    );
    const dune = duneRise(
      this.duneNoise.fbm(
        (along - 1700) / DUNE_LENGTH,
        (warpedAcross + 900) / DUNE_WIDTH,
        2,
        2.05,
        0.4,
      ),
      DUNE_THRESHOLD,
    );
    let h =
      (megadune * MEGADUNE_AMPLITUDE + dune * DUNE_AMPLITUDE) *
      duneFade;

    h +=
      this.rippleNoise.fbm(
        (along + 800) / RIPPLE_LENGTH,
        (warpedAcross - 400) / RIPPLE_WIDTH,
        2,
        2,
        0.35,
      ) *
      RIPPLE_AMPLITUDE *
      smoothstep01((dist - CORRIDOR_INNER) / (RIPPLE_FULL - CORRIDOR_INNER));

    const outcrop = this.outcropAt(x, z);
    if (outcrop > OUTCROP_THRESHOLD) {
      const t = (outcrop - OUTCROP_THRESHOLD) / (1 - OUTCROP_THRESHOLD);
      h += t * t * OUTCROP_AMPLITUDE * duneFade;
    }
    const wash = this.washNoise.fbm(
      x / WASH_WAVELENGTH_X,
      z / WASH_WAVELENGTH_Z,
      2,
      1.8,
      0.55,
    );
    if (wash > WASH_THRESHOLD) {
      const t = (wash - WASH_THRESHOLD) / (1 - WASH_THRESHOLD);
      const washFade = smoothstep01((dist - CORRIDOR_INNER) / (WASH_FULL - CORRIDOR_INNER));
      h -= t * t * WASH_DEPTH * washFade;
    }
    return h;
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
   * The fine band for the legacy road-aligned refined grid. It fades to exactly zero
   * at both of that mesh's seams; large-scale dune shape remains in `relief`.
   */
  detailAt(x: number, z: number, dist: number): number {
    if (dist <= CORRIDOR_INNER || dist >= DETAIL_REACH) return 0;
    const fade =
      smoothstep01((dist - CORRIDOR_INNER) / (DETAIL_FADE_IN - CORRIDOR_INNER)) *
      (1 - smoothstep01((dist - DETAIL_HOLD) / (DETAIL_REACH - DETAIL_HOLD)));
    if (fade <= 0) return 0;
    return this.fineRelief(x, z) * fade;
  }

  /** The fine band for the shipped tile lattice, which has no outer seam. */
  private explorationDetailAt(x: number, z: number, dist: number): number {
    if (dist <= CORRIDOR_INNER) return 0;
    const fade = smoothstep01((dist - CORRIDOR_INNER) / (DETAIL_FADE_IN - CORRIDOR_INNER));
    return this.fineRelief(x, z) * fade;
  }

  /**
   * Open-desert height without wheel-scale detail. This is now the driveable field:
   * no berm and no road-distance mountain wall. Horizon mountains are applied only
   * by `horizonHeight`, in the camera-centred vista where they remain unreachable.
   */
  openBase(x: number, z: number, dist: number): number {
    return this.road.landscape.heightAt(x, z) + this.relief(x, z, dist);
  }

  /** Legacy road-fan height, retaining its finite detail seam for tooling. */
  openHeight(x: number, z: number, dist: number): number {
    return this.openBase(x, z, dist) + this.detailAt(x, z, dist);
  }

  /** Fine open terrain used by the player-centred desert tiles. */
  explorationHeight(x: number, z: number, dist: number): number {
    return this.openBase(x, z, dist) + this.explorationDetailAt(x, z, dist);
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
    const open = this.openBase(x, z, dist);
    if (dist >= CORRIDOR_OUTER) return open;
    const t0 = (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER);
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
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, p.s, p.lateral, x, z);
    return this.gradedBase(x, z, dist, p.s, Math.sign(p.lateral)) + this.explorationDetailAt(x, z, dist);
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
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, s, lateral, x, z);
    return this.gradedBase(x, z, dist, s, Math.sign(lateral));
  }

  /** Fine driveable height for a caller that already owns the exact road frame. */
  explorationHeightFromFrame(x: number, z: number, lateral: number, s: number): number {
    return this.baseFromFrame(x, z, lateral, s) + this.explorationDetailAt(x, z, Math.abs(lateral));
  }

  /** Legacy finite-detail frame sample used by road-fan tooling. */
  heightFromFrame(x: number, z: number, lateral: number, s: number): number {
    return this.baseFromFrame(x, z, lateral, s) + this.detailAt(x, z, Math.abs(lateral));
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
      h += this.relief(x, z, RELIEF_FULL) * Math.min(1, reliefWeight);
    }
    if (distanceFromCamera > MOUNTAIN_START) {
      h +=
        this.road.landscape.mountainAt(x, z) *
        smoothstep01((distanceFromCamera - MOUNTAIN_START) / MOUNTAIN_RAMP);
    }
    return h;
  }

  /**
   * Road-surface height at one asphalt edge (`side` = ±1). At
   * `dist = CORRIDOR_INNER`, both road and desert meshes sample this exact value.
   */
  private roadEdgeHeight(s: number, side: number): number {
    const p = this.road.offsetPoint(s, side * CORRIDOR_INNER);
    return roadSurfaceY(this.road, this.field, s, side * CORRIDOR_INNER, p.x, p.z);
  }

  /** `surfaceAt` for a caller that already knows the lateral offset. */
  surfaceFromFrame(x: number, z: number, lateral: number): SurfaceType {
    if (Math.abs(lateral) <= CORRIDOR_INNER + VERGE_WIDTH) return SurfaceType.Gravel;
    return this.outcropAt(x, z) > OUTCROP_THRESHOLD ? SurfaceType.Rock : SurfaceType.Sand;
  }
  /** Surface material beyond the graded road corridor, without a road projection. */
  openSurfaceAt(x: number, z: number): SurfaceType {
    return this.outcropAt(x, z) > OUTCROP_THRESHOLD ? SurfaceType.Rock : SurfaceType.Sand;
  }


  /** Surface material of the open ground at a point. The road itself is separate. */
  surfaceAt(x: number, z: number, hintS?: number): SurfaceType {
    const p = this.road.project(x, z, hintS);
    if (Math.abs(p.lateral) <= CORRIDOR_INNER + VERGE_WIDTH) return SurfaceType.Gravel;
    return this.outcropAt(x, z) > OUTCROP_THRESHOLD ? SurfaceType.Rock : SurfaceType.Sand;
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
