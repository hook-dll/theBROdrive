import { Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from './road';
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
 * shared function the road ribbon uses, so the shoulder meets the verge flush. From
 * there out to `CORRIDOR_OUTER` it smoothsteps into the open field. The seam is
 * continuous because the road's own elevation IS the field's, so the two ends of the
 * blend differ only by camber and centimetre-scale surface detail.
 */

/** Ground inside this lateral distance is pure road corridor. */
export const CORRIDOR_INNER = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
/** Beyond this lateral distance the terrain is open desert. */
export const CORRIDOR_OUTER = 30;
/**
 * Lateral distance over which the DUNE band fades in, metres.
 *
 * Relief is an ABSOLUTE height now, not a difference from the centreline's own
 * relief, because a difference is a road-frame quantity and road-frame quantities
 * step where the frame folds — the whole disease landscape.ts describes. But the road
 * still has to sit on the ground rather than in a trench, so at the shoulder the
 * relief must be zero, and the only position-pure way to get that is to fade it in
 * with distance from the road. Do it over the corridor's own 25 m and a 17 m dune
 * arrives as a 70% bank; over this distance it arrives as a graded verge, which is
 * what a road cut through dunes actually looks like.
 *
 * ONE FADE PER BAND, not one fade for all of them. This distance is sized by the
 * TALLEST term, and applying it to the short ones as well is what kept the near
 * desert glassy: at 20 m off the shoulder it scales everything by 0.06, so the
 * ripple's 1.8 m arrived as 11 cm and the grain's 0.5 m as 3 cm. The first thirty
 * metres of desert — which is exactly where a car leaves the road — therefore had
 * almost no relief in it at all.
 *
 * Each band now fades over its own distance, sized so that the slope the FADE itself
 * adds stays a verge grade rather than a bank: the bound is `amplitude * 1.5 / span`,
 * which is 9.0% for the dunes, 6.7% for the ripples and 3.9% for the grain.
 */
const RELIEF_FULL = 130;

/** Width of the gravel verge outside the asphalt, in metres. */
const VERGE_WIDTH = 3.5;

/** Big dune amplitude and wavelength. */
const DUNE_AMPLITUDE = 7.5;
const DUNE_WAVELENGTH = 240;
/**
 * Secondary ripples riding on the dunes. Two octaves — 52 m and its 23.6 m
 * harmonic (lacunarity 2.2) — so both sit above the terrain mesh's coarse
 * resolution floor and resolve as real slopes, not alias noise. Up from 1.1 m
 * so the verge reads as washboard instead of smooth sand, while staying well
 * under the 7.5 m dunes so the ripple still reads as texture ON the dune
 * rather than as the dune itself. Peak slope it adds is 17.8% in the absolute
 * worst case and ~4.8% typically.
 */
const RIPPLE_AMPLITUDE = 1.8;
const RIPPLE_WAVELENGTH = 52;
/** Lateral distance over which the ripple band reaches full amplitude. */
const RIPPLE_FULL = 45;
/**
 * Fine grain: the shortest wave the COARSE field lattice can represent.
 *
 * The field lattice samples along the road at S_STEP = 8 m, so a wave needs at
 * least 2.5 samples per wavelength to resolve as a shape — 20 m — exactly the
 * ratio the road's own collider uses for its 3.33 m shortest bump against its
 * 1.333 m step. The old 7 m grain sat below that floor: at ~1.1 samples per
 * wavelength the collider saw seed-dependent spikes, not the intended ground.
 *
 * Anything shorter than this belongs to `detailAt` below, which is sampled on the
 * refined near grid instead and is the layer that carries wheel-scale roughness.
 */
const GRAIN_AMPLITUDE = 0.5;
const GRAIN_WAVELENGTH = 20;
/** Lateral distance over which the grain band reaches full amplitude. */
const GRAIN_FULL = 24;

/**
 * FINE DETAIL: the chop and the holes, and the one relief layer the coarse field
 * lattice is not allowed to carry.
 *
 * Everything above is sampled on the terrain mesh's field lattice — 8 m along the
 * road, geometric rings across it — and that lattice sets a 20 m floor on wavelength.
 * Twenty metres is a body-frequency wallow: at 60 km/h it is under one hertz, and no
 * amplitude makes it read as "rough". What makes ground feel rough is the wheel-rate
 * band, and the road already proves it — its worst bump is 16 cm on a 3.33 m octave,
 * and it is the thing the desert had to beat and did not.
 *
 * So `TerrainMeshProvider` refines the near desert to a uniform lattice (see
 * `DETAIL_REACH` / FINE_STEP there) and adds THIS on top of the interpolated coarse
 * field. The split is what makes it affordable: the coarse bands cost four fractal
 * fields a sample and stay on the sparse lattice, while the detail layer costs one
 * two-octave field plus one noise lookup and is the only thing paid for per refined
 * vertex.
 *
 * CHOP is the washboard: 13 m and its 6.5 m octave. 6.5 m against the 2.5 m refined
 * step is 2.6 samples per wavelength — the same ratio the road's shortest octave has
 * against its own step, so it reaches the trimesh as geometry rather than as spikes.
 *
 * PITS are the holes. Not the road's discrete cosine bowls: those are anchored to
 * vertex rows so their centres are sampled exactly, and a road-frame anchor is
 * precisely the construction the top of this file explains the desert cannot have.
 * Carving them out of a threshold crossing of a smooth field instead keeps the whole
 * layer a pure function of world position — chunks and branches agree on it by
 * construction — and the pits come out as irregular scoops 4-8 m across rather than
 * as a lattice of identical dishes.
 */
const CHOP_WAVELENGTH = 14;
/**
 * Chop amplitude, metres.
 *
 * Set by the KICK it produces, not by how it looks in a height plot:
 * `tools/desert-ride.ts` drags a wheel along the real trimesh and reports the
 * vertical-velocity step the suspension is hit with at every triangle edge, which is
 * the same number `tools/ride-bench.ts` reports for the road. The road at 60 km/h is
 * 0.22 m/s rms and 0.87 p99; the desert verge at this amplitude is about 0.85 and 3.3,
 * i.e. four times the road, which is where "leaves the road and it gets much rougher"
 * lands. Amplitude and kick are proportional at a fixed wavelength, so this is the one
 * knob for it.
 */
const CHOP_AMPLITUDE = 0.95;
/** Wavelength of the pit field, metres: the spacing scoops end up at. */
const PIT_WAVELENGTH = 11;
/** Field value above which a pit is carved. Higher = fewer, smaller holes. */
const PIT_THRESHOLD = 0.42;
/**
 * Depth of a fully developed pit, metres.
 *
 * Bounded by escapability, not by looks. A scoop is the one part of this layer that
 * makes a BASIN — chop you cross, a hole you sit in — so it sets the worst grade a
 * stopped car ever finds under its wheels, and that has to stay inside what sand's
 * forward traction can pull away on (20% for a two-wheel-drive saloon; the budget is
 * derived in core/surfaces.ts). At 0.8 m the worst footprint grade in the near desert
 * measured 46% and 0.7% of all (spot, heading) pairs were a direction a stopped car
 * could not leave in. This is deep enough to drop a wheel into and swallow a sill, and
 * shallow enough that the way out is never steeper than the way in.
 *
 * The road's own cap is 0.11 m, for the opposite reason: a road is maintained.
 */
const PIT_DEPTH = 0.55;
/**
 * Lateral distance at which the detail layer is fully in, and the distance at which
 * it starts tapering back out.
 *
 * The fade-in is short — five metres past the shoulder — because the player feels this
 * layer the moment two wheels are off the asphalt, and that is the whole point of
 * splitting it out of `relief`: the dunes have to arrive slowly, the chop does not.
 * The cost is the slope the fade itself adds, `amplitude * 1.5 / span`, about 28% over
 * those five metres — steep for a verge, but it is a verge dropping into rough ground
 * rather than a bank, and the corridor grading under it is still nearly flat there.
 *
 * The fade-out is long, and for the opposite reason: it has to reach exactly zero at
 * `DETAIL_REACH`, and a short taper there would draw a smooth stripe eighty metres out
 * running the length of the world — which from the driver's seat reads as a second
 * road. Eighteen metres of taper is invisible.
 */
const DETAIL_FADE_IN = 10;
const DETAIL_HOLD = 62;
/**
 * Lateral distance at which the detail layer has faded to exactly zero.
 *
 * Exported because it is a CONTRACT with the terrain mesh, not a tuning knob: that is
 * where the refined near grid ends and stitches back onto the coarse rings, and a
 * non-zero detail term at the seam would be a crack. `TerrainMeshProvider` forces a
 * ring here for the same reason.
 */
export const DETAIL_REACH = 80;

/** Rock outcrops appear where this field exceeds the threshold. */
const OUTCROP_WAVELENGTH = 170;
const OUTCROP_THRESHOLD = 0.42;

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

export class Terrain {
  private readonly duneNoise: Noise2D;
  private readonly rippleNoise: Noise2D;
  private readonly grainNoise: Noise2D;
  private readonly chopNoise: Noise2D;
  private readonly pitNoise: Noise2D;
  private readonly outcropNoise: Noise2D;
  private readonly field: SurfaceField;

  constructor(
    seed: number,
    private readonly road: Road,
  ) {
    this.duneNoise = new Noise2D(seed ^ 0xc2b2ae35);
    this.rippleNoise = new Noise2D(seed ^ 0x27d4eb2f);
    this.grainNoise = new Noise2D(seed ^ 0x165667b1);
    this.chopNoise = new Noise2D(seed ^ 0x9e3779b9);
    this.pitNoise = new Noise2D(seed ^ 0x85ebca6b);
    this.outcropNoise = new Noise2D(seed ^ 0xd3a2646c);
    this.field = new SurfaceField(seed);
  }

  /** Strength of the rock-outcrop field at a point, used for both height and material. */
  private outcropAt(x: number, z: number): number {
    return this.outcropNoise.fbm(x / OUTCROP_WAVELENGTH, z / OUTCROP_WAVELENGTH, 3, 2.1, 0.5);
  }

  /**
   * Open-desert relief at a point, ignoring the road entirely except for the per-band
   * fades (see RELIEF_FULL). Only meaningful as a difference between two points — its
   * absolute value is arbitrary.
   */
  private relief(x: number, z: number, dist: number): number {
    const dune = smoothstep01((dist - CORRIDOR_INNER) / (RELIEF_FULL - CORRIDOR_INNER));
    let h =
      this.duneNoise.fbm(x / DUNE_WAVELENGTH, z / DUNE_WAVELENGTH, 4, 2.0, 0.5) *
      DUNE_AMPLITUDE *
      dune;
    h +=
      this.rippleNoise.fbm(x / RIPPLE_WAVELENGTH, z / RIPPLE_WAVELENGTH, 2, 2.2, 0.45) *
      RIPPLE_AMPLITUDE *
      smoothstep01((dist - CORRIDOR_INNER) / (RIPPLE_FULL - CORRIDOR_INNER));
    h +=
      this.grainNoise.at(x / GRAIN_WAVELENGTH, z / GRAIN_WAVELENGTH) *
      GRAIN_AMPLITUDE *
      smoothstep01((dist - CORRIDOR_INNER) / (GRAIN_FULL - CORRIDOR_INNER));

    // Outcrops rise abruptly out of the sand rather than blending into it. They ride
    // the dune fade because they are the tallest thing in the field, not the shortest.
    const outcrop = this.outcropAt(x, z);
    if (outcrop > OUTCROP_THRESHOLD) {
      const t = (outcrop - OUTCROP_THRESHOLD) / (1 - OUTCROP_THRESHOLD);
      h += t * t * 9 * dune;
    }
    return h;
  }

  /**
   * Wheel-scale desert roughness at a point: chop plus pits, faded in from the
   * shoulder and back out to nothing by `DETAIL_REACH` (see the constants above).
   *
   * Split out of `relief` and out of `openBase` because it is the one band whose
   * wavelength is below what the terrain mesh's coarse field lattice can carry. The
   * mesh samples the coarse bands sparsely and interpolates them under the refined
   * near grid; THIS it samples at every refined vertex. Add it to an interpolated
   * coarse height, never to a coarsely sampled one, or it aliases into spikes.
   *
   * Exactly zero outside `CORRIDOR_INNER..DETAIL_REACH`, which is what lets the
   * refined grid stitch onto the road ribbon at one end and the coarse rings at the
   * other with no crack at either.
   */
  detailAt(x: number, z: number, dist: number): number {
    if (dist <= CORRIDOR_INNER || dist >= DETAIL_REACH) return 0;
    const fade =
      smoothstep01((dist - CORRIDOR_INNER) / (DETAIL_FADE_IN - CORRIDOR_INNER)) *
      (1 - smoothstep01((dist - DETAIL_HOLD) / (DETAIL_REACH - DETAIL_HOLD)));
    if (fade <= 0) return 0;

    let h =
      this.chopNoise.fbm(x / CHOP_WAVELENGTH, z / CHOP_WAVELENGTH, 2, 2.0, 0.5) * CHOP_AMPLITUDE;

    // A pit is the part of the field that pokes above the threshold, turned upside
    // down. `t * (2 - t)` gives the scoop a flat-ish floor and steep walls instead of
    // the cone a linear ramp would leave, so a wheel drops into it and climbs out.
    const pit = this.pitNoise.at(x / PIT_WAVELENGTH, z / PIT_WAVELENGTH);
    if (pit > PIT_THRESHOLD) {
      const t = (pit - PIT_THRESHOLD) / (1 - PIT_THRESHOLD);
      h -= t * (2 - t) * PIT_DEPTH;
    }
    return h * fade;
  }

  /**
   * Open-desert height at a point WITHOUT the fine detail layer: the landscape field,
   * relief graded in with distance from the road, and the basin rim.
   *
   * This is what the terrain mesh samples on its coarse field lattice, and what the
   * refined near grid interpolates before adding `detailAt`. Public for that reason
   * alone. It is a pure function of position and `dist`, so every chunk that reaches
   * the same ground computes the same height — the property that used to need an
   * interpolated anchor lattice and a two-branch blend to approximate, and now falls
   * out of the construction.
   */
  openBase(x: number, z: number, dist: number): number {
    return (
      this.road.landscape.heightAt(x, z) + this.relief(x, z, dist) + this.surroundHeight(dist, x, z)
    );
  }

  /**
   * Open-desert height at a point, detail layer included. What every consumer that
   * wants "where is the ground" should ask: props stand on it, the rescue check
   * measures against it, and the vista mesh samples it (out there the detail term is
   * zero, so the two agree in the overlap by construction).
   */
  openHeight(x: number, z: number, dist: number): number {
    return this.openBase(x, z, dist) + this.detailAt(x, z, dist);
  }

  /**
   * Ground height with the dune relief left out: the landscape and the world's edge only.
   *
   * For the vista mesh, past a few kilometres. Relief is four fractal noise fields and
   * about sixty percent of a height sample's cost, and at that range its 9 m dunes are
   * well under a pixel — spending most of the build budget on detail that quantises away.
   * Inside that range the vista uses `openHeight` like everything else, because it has to
   * agree with the chunked mesh where the two overlap.
   */
  baseHeight(x: number, z: number, dist: number): number {
    return this.road.landscape.heightAt(x, z) + this.surroundHeight(dist, x, z);
  }

  /**
   * The corridor grading, base only: the shoulder's own elevation smoothstepped out
   * into the open field between `CORRIDOR_INNER` and `CORRIDOR_OUTER`.
   *
   * The seam is continuous because the shoulder anchor and the open field meet at the
   * same elevation: the road's own y is this field's value at the centreline.
   *
   * Past `CORRIDOR_OUTER` it returns the open field directly rather than blending
   * towards it with weight 1. That is not a shortcut, it is the same number — and it
   * skips a `shoulderHeight`, which is a road offset point plus a full road-surface
   * sample, measured at 0.7 us. Every terrain vertex outside 30 m used to pay it and
   * throw it away.
   */
  private gradedBase(x: number, z: number, dist: number, s: number, side: number): number {
    const open = this.openBase(x, z, dist);
    if (dist >= CORRIDOR_OUTER) return open;
    const t0 = (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER);
    const t = t0 * t0 * (3 - 2 * t0);
    const inner = this.shoulderHeight(s, side);
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
   * grades. Inside, the grading's own weight is 0.10 at ten metres off the shoulder,
   * which is where the chop is most wanted and where it was being multiplied away.
   * `detailAt` is zero at `CORRIDOR_INNER` by its own fade, so the seam onto the
   * asphalt is continuous without the grading's help.
   */
  heightAt(x: number, z: number, hintS?: number): number {
    const p = this.road.project(x, z, hintS);
    const dist = Math.abs(p.lateral);
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, p.s, p.lateral, x, z);
    return this.gradedBase(x, z, dist, p.s, Math.sign(p.lateral)) + this.detailAt(x, z, dist);
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

  /** `baseFromFrame` with the detail layer, i.e. `heightAt` without the search. */
  heightFromFrame(x: number, z: number, lateral: number, s: number): number {
    return this.baseFromFrame(x, z, lateral, s) + this.detailAt(x, z, Math.abs(lateral));
  }

  /**
   * Height the world's edge adds at a lateral distance: the berm, then the mountains
   * (see the BERM_* / MOUNTAIN_* block above).
   *
   * The berm climbs from nothing at BERM_START to its crest at BERM_CREST, then falls all
   * the way back to zero by BERM_FADE — all the way, not to a fraction of the crest as the
   * escarpment this replaces did, because anything it leaves standing out there is
   * something the mountains have to be taller than. Its crest is modulated by the dune
   * field at a long wavelength, which is what keeps the bank from being a ruled line drawn
   * across the view.
   *
   * The mountains then ramp in over 14 km. `dist` reaches this from two places: the mesh
   * builders interpolate it on a lattice, and `heightAt` gets it from a local road
   * projection that can jump where the road folds. Both are why the ramp is long.
   */
  private surroundHeight(dist: number, x: number, z: number): number {
    let h = 0;
    if (dist > BERM_START && dist < BERM_FADE) {
      const ragged =
        1 + BERM_RAGGED * this.duneNoise.at(x / BERM_RAGGED_WAVELENGTH, z / BERM_RAGGED_WAVELENGTH);
      const rise = smoothstep01((dist - BERM_START) / (BERM_CREST - BERM_START));
      const fall = 1 - smoothstep01((dist - BERM_CREST) / (BERM_FADE - BERM_CREST));
      h += BERM_HEIGHT * ragged * rise * fall;
    }
    if (dist > MOUNTAIN_START) {
      h +=
        this.road.landscape.mountainAt(x, z) *
        smoothstep01((dist - MOUNTAIN_START) / MOUNTAIN_RAMP);
    }
    return h;
  }

  /**
   * The road surface height at the shoulder edge on one side (`side` = ±1). This
   * is the anchor the blend hangs off: at `dist = CORRIDOR_INNER` the terrain
   * equals the road's shoulder vertex exactly, because both sample roadSurfaceY.
   */
  private shoulderHeight(s: number, side: number): number {
    const p = this.road.offsetPoint(s, side * CORRIDOR_INNER);
    return roadSurfaceY(this.road, this.field, s, side * CORRIDOR_INNER, p.x, p.z);
  }

  /** `surfaceAt` for a caller that already knows the lateral offset. */
  surfaceFromFrame(x: number, z: number, lateral: number): SurfaceType {
    if (Math.abs(lateral) <= CORRIDOR_INNER + VERGE_WIDTH) return SurfaceType.Gravel;
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
