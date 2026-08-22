import { Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from './road';
import { SurfaceField, roadSurfaceY } from './roadsurface';

/**
 * Terrain height is *derived from* the road, never independent of it.
 *
 * Inside the corridor the ground is the road surface itself (banking and surface
 * field included), sampled through the same shared function the road ribbon uses,
 * so the shoulder meets the verge flush. Outside, dune relief is added as a
 * *difference* from the relief at the corresponding centreline point, which keeps
 * the blend continuous — no ridge or cliff at the corridor boundary.
 */

/** Ground inside this lateral distance is pure road corridor. */
export const CORRIDOR_INNER = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
/** Beyond this lateral distance the terrain is open desert. */
export const CORRIDOR_OUTER = 30;

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
 * The basin rim: where the desert stops being flat and starts climbing out.
 *
 * The world needs an edge, and the honest options are an invisible wall, a kill
 * plane, or terrain you cannot drive up. This is the third: past
 * `RIM_START` the ground lifts into an escarpment that tops out beyond the solid
 * band, so the road runs along the floor of a basin whose walls are visible from
 * the tarmac and unclimbable long before the collider ends.
 *
 * A rim rather than rough ground is deliberate: the terrain mesh out there is
 * sampled every few tens of metres, so any short-wavelength roughness would alias
 * into nothing (or into launch ramps). A monotone lift is representable at any
 * resolution, reads as landscape, and its slope is exactly what the profile says.
 */
export const RIM_START = 400;
/** Lateral distance where the rim reaches full height. Past the solid band. */
const RIM_FULL = 750;
/** Height of the rim above the basin floor, metres. */
const RIM_HEIGHT = 120;

/**
 * Rim height added at a lateral distance. Smoothstep, so the foot of the rim is a
 * gentle bank (no lip to launch off) and the middle third is the steep face: with
 * the constants above the steepest point is around 33 degrees, past what a car can
 * pull with a finite grip budget and enough to defeat a run-up.
 */
function rimHeight(lateralDistance: number): number {
  if (lateralDistance <= RIM_START) return 0;
  const t0 = Math.min(1, (lateralDistance - RIM_START) / (RIM_FULL - RIM_START));
  return RIM_HEIGHT * t0 * t0 * (3 - 2 * t0);
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
   * Ground height at a world position.
   *
   * `hintS` is the caller's last known arclength; pass it for anything queried per
   * frame, since the underlying road projection is a search.
   */
  heightAt(x: number, z: number, hintS?: number): number {
    const p = this.road.project(x, z, hintS);
    const dist = Math.abs(p.lateral);
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, p.s, p.lateral, x, z);

    // Smoothstep the corridor floor out into open desert relief.
    const t0 = Math.min(1, (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER));
    const t = t0 * t0 * (3 - 2 * t0);

    // Relief expressed relative to the centreline keeps the seam continuous: as
    // dist approaches CORRIDOR_INNER the added relief tends to zero from both sides.
    const centre = this.road.sampleAt(p.s);
    const inner = this.shoulderHeight(p.s, Math.sign(p.lateral));
    return this.blend(x, z, centre.x, centre.z, p.height, inner, dist, t);
  }

  /**
   * Height for a point whose road frame is already known.
   *
   * Grid builders generate their points FROM the road frame (an `s` row and a
   * lateral column), so making them call `heightAt` throws that away and pays for
   * two road projections per vertex — measured at ~16 us a vertex, which is most of
   * a chunk's build time. Here the caller passes the frame it already has: the
   * centreline point for the row (one `sampleAt` per row, not per vertex) and the
   * column's lateral offset. Same formula as `heightAt`, no search.
   */
  heightFromFrame(
    x: number,
    z: number,
    lateral: number,
    centreX: number,
    centreZ: number,
    centreHeight: number,
    s: number,
  ): number {
    const dist = Math.abs(lateral);
    if (dist <= CORRIDOR_INNER) return roadSurfaceY(this.road, this.field, s, lateral, x, z);

    const t0 = Math.min(1, (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER));
    const t = t0 * t0 * (3 - 2 * t0);
    const inner = this.shoulderHeight(s, Math.sign(lateral));
    return this.blend(x, z, centreX, centreZ, centreHeight, inner, dist, t);
  }

  /**
   * Shared tail of both height paths: the shoulder anchor, open desert relief, and
   * the basin rim. Kept in one place because the grid builders' frame-based path
   * and the general query path MUST agree exactly — a difference here is a car
   * floating above, or sunk into, the ground it is drawn on.
   */
  private blend(
    x: number,
    z: number,
    centreX: number,
    centreZ: number,
    centreHeight: number,
    inner: number,
    dist: number,
    t: number,
  ): number {
    const delta = this.relief(x, z) - this.relief(centreX, centreZ);
    const outer = centreHeight + delta + rimHeight(dist);
    return inner + (outer - inner) * t;
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
