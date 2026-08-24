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
 * Lateral distance over which dune relief fades in, metres.
 *
 * Relief is an ABSOLUTE height now, not a difference from the centreline's own
 * relief, because a difference is a road-frame quantity and road-frame quantities
 * step where the frame folds — the whole disease landscape.ts describes. But the road
 * still has to sit on the ground rather than in a trench, so at the shoulder the
 * relief must be zero, and the only position-pure way to get that is to fade it in
 * with distance from the road. Do it over the corridor's own 25 m and a 17 m dune
 * arrives as a 70% bank; over this distance it arrives as a graded verge, which is
 * what a road cut through dunes actually looks like.
 */
const RELIEF_FULL = 130;

/** Width of the gravel verge outside the asphalt, in metres. */
const VERGE_WIDTH = 3.5;

/** Big dune amplitude and wavelength. */
const DUNE_AMPLITUDE = 7.5;
const DUNE_WAVELENGTH = 240;
/** Secondary ripples riding on the dunes. */
const RIPPLE_AMPLITUDE = 1.1;
const RIPPLE_WAVELENGTH = 52;
/** Fine grain, mostly so headlights have something to catch at night. */
const GRAIN_AMPLITUDE = 0.16;
const GRAIN_WAVELENGTH = 7;

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
  private readonly outcropNoise: Noise2D;
  private readonly field: SurfaceField;

  constructor(
    seed: number,
    private readonly road: Road,
  ) {
    this.duneNoise = new Noise2D(seed ^ 0xc2b2ae35);
    this.rippleNoise = new Noise2D(seed ^ 0x27d4eb2f);
    this.grainNoise = new Noise2D(seed ^ 0x165667b1);
    this.outcropNoise = new Noise2D(seed ^ 0xd3a2646c);
    this.field = new SurfaceField(seed);
  }

  /** Strength of the rock-outcrop field at a point, used for both height and material. */
  private outcropAt(x: number, z: number): number {
    return this.outcropNoise.fbm(x / OUTCROP_WAVELENGTH, z / OUTCROP_WAVELENGTH, 3, 2.1, 0.5);
  }

  /**
   * Open-desert relief at a point, ignoring the road entirely. Only meaningful as a
   * difference between two points — its absolute value is arbitrary.
   */
  private relief(x: number, z: number): number {
    let h =
      this.duneNoise.fbm(x / DUNE_WAVELENGTH, z / DUNE_WAVELENGTH, 4, 2.0, 0.5) * DUNE_AMPLITUDE;
    h +=
      this.rippleNoise.fbm(x / RIPPLE_WAVELENGTH, z / RIPPLE_WAVELENGTH, 2, 2.2, 0.45) *
      RIPPLE_AMPLITUDE;
    h += this.grainNoise.at(x / GRAIN_WAVELENGTH, z / GRAIN_WAVELENGTH) * GRAIN_AMPLITUDE;

    // Outcrops rise abruptly out of the sand rather than blending into it.
    const outcrop = this.outcropAt(x, z);
    if (outcrop > OUTCROP_THRESHOLD) {
      const t = (outcrop - OUTCROP_THRESHOLD) / (1 - OUTCROP_THRESHOLD);
      h += t * t * 9;
    }
    return h;
  }

  /**
   * Open-desert height at a point: the landscape field, dune relief graded in with
   * distance from the road, and the basin rim.
   *
   * Public because the far terrain mesh calls it directly. It is a pure function of
   * position and `dist`, so every chunk that reaches the same ground computes the
   * same height — the property that used to need an interpolated anchor lattice and
   * a two-branch blend to approximate, and now falls out of the construction.
   */
  openHeight(x: number, z: number, dist: number): number {
    const verge = smoothstep01((dist - CORRIDOR_INNER) / (RELIEF_FULL - CORRIDOR_INNER));
    return (
      this.road.landscape.heightAt(x, z) +
      this.relief(x, z) * verge +
      this.surroundHeight(dist, x, z)
    );
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
   */
  heightAt(x: number, z: number, hintS?: number): number {
    const p = this.road.project(x, z, hintS);
    const dist = Math.abs(p.lateral);
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, p.s, p.lateral, x, z);

    // Smoothstep the corridor floor out into open desert relief.
    const t0 = Math.min(1, (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER));
    const t = t0 * t0 * (3 - 2 * t0);

    // The seam is continuous because the shoulder anchor and the open field meet at
    // the same elevation: the road's own y is this field's value at the centreline.
    const inner = this.shoulderHeight(p.s, Math.sign(p.lateral));
    return inner + (this.openHeight(x, z, dist) - inner) * t;
  }

  /**
   * Height for a point whose road frame is already known.
   *
   * Grid builders generate their points FROM the road frame (an `s` row and a
   * lateral column), so making them call `heightAt` throws that away and pays for a
   * road projection per vertex — measured at ~16 us a vertex, which is most of a
   * chunk's build time. Here the caller passes the column's lateral offset and the
   * row's arclength. Same formula as `heightAt`, no search.
   */
  heightFromFrame(x: number, z: number, lateral: number, s: number): number {
    const dist = Math.abs(lateral);
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, s, lateral, x, z);

    const t0 = Math.min(1, (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER));
    const t = t0 * t0 * (3 - 2 * t0);
    const inner = this.shoulderHeight(s, Math.sign(lateral));
    return inner + (this.openHeight(x, z, dist) - inner) * t;
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
