import { Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from './road';

/**
 * Terrain height is *derived from* the road, never independent of it.
 *
 * Inside the corridor the ground tracks the road centreline height, sunk slightly,
 * so the road's own trimesh collider is always what wheels hit and the heightfield
 * can never poke through it. Outside, dune relief is added as a *difference* from
 * the relief at the corresponding centreline point, which keeps the blend
 * continuous — no ridge or cliff at the corridor boundary.
 */

/** Ground inside this lateral distance is pure road corridor. */
export const CORRIDOR_INNER = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
/** Beyond this lateral distance the terrain is open desert. */
export const CORRIDOR_OUTER = 30;
/** How far the terrain sits below the road surface inside the corridor. */
export const ROAD_SINK = 0.16;

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

export class Terrain {
  private readonly duneNoise: Noise2D;
  private readonly rippleNoise: Noise2D;
  private readonly grainNoise: Noise2D;
  private readonly outcropNoise: Noise2D;

  constructor(
    seed: number,
    private readonly road: Road,
  ) {
    this.duneNoise = new Noise2D(seed ^ 0xc2b2ae35);
    this.rippleNoise = new Noise2D(seed ^ 0x27d4eb2f);
    this.grainNoise = new Noise2D(seed ^ 0x165667b1);
    this.outcropNoise = new Noise2D(seed ^ 0xd3a2646c);
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
    if (dist <= CORRIDOR_INNER) return p.height - ROAD_SINK;

    // Smoothstep the corridor floor out into open desert relief.
    const t0 = Math.min(1, (dist - CORRIDOR_INNER) / (CORRIDOR_OUTER - CORRIDOR_INNER));
    const t = t0 * t0 * (3 - 2 * t0);

    // Relief expressed relative to the centreline keeps the seam continuous: as
    // dist approaches CORRIDOR_INNER the added relief tends to zero from both sides.
    const centre = this.road.sampleAt(p.s);
    const delta = this.relief(x, z) - this.relief(centre.x, centre.z);
    return p.height - ROAD_SINK * (1 - t) + delta * t;
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
