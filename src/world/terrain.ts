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
 * The basin rim: where the desert stops being flat and starts climbing out.
 *
 * The world needs an edge, and the honest options are an invisible wall, a kill
 * plane, or terrain you cannot drive up. This is the third: past `RIM_START` the
 * ground lifts into an escarpment that tops out beyond the solid band, so the road
 * runs along the floor of a basin whose walls are visible from the tarmac and
 * unclimbable long before the collider ends.
 *
 * It is a RIDGE, not a plateau, and that distinction is the whole reason this looks
 * like landscape instead of a bug. A rim that climbs to full height and then stays
 * there puts a horizontal plane a hundred metres above the player, stretching to
 * the draw distance: from inside the basin its top surface covers the entire sky
 * above its near edge, and because the mesh is sampled every few tens of metres out
 * there it arrives as one enormous flat brown slab with straight edges. So past the
 * crest the ground falls away again, and the crest itself is modulated by the dune
 * field so the skyline is ragged rather than a drawn line.
 *
 * The lift stays monotone up to the crest for the same reason it always did: at
 * that sampling density any short-wavelength roughness would alias into nothing, or
 * into launch ramps.
 */
export const RIM_START = 400;
/** Lateral distance where the rim reaches its crest. Past the solid band. */
const RIM_FULL = 780;
/** Height of the crest above the basin floor, metres. */
const RIM_HEIGHT = 78;
/** Lateral distance by which the far slope has fallen back to its floor fraction. */
const RIM_FAR = 1400;
/** Fraction of crest height the ground keeps out at RIM_FAR. */
const RIM_FAR_FRACTION = 0.25;
/** Crest height varies by this fraction of RIM_HEIGHT along the ridge. */
const RIM_RAGGED = 0.28;
/** Wavelength of that variation, metres. Long: a skyline, not a saw. */
const RIM_RAGGED_WAVELENGTH = 900;

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
      this.rimHeight(dist, x, z)
    );
  }

  /**
   * Ground height at a world position.
   *
   * `hintS` is the caller's last known arclength; pass it for anything queried per
   * frame, since the underlying road projection is a search.
   *
   * NOT the surface that is drawn or collided past a few tens of metres of lateral
   * offset, and the difference is the rim. `Road.project` refines from the hint, so
   * where the road folds back it can settle on either of two local minima and the
   * distance it returns jumps — which past RIM_START jumps the rim with it.
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
   * Height the basin rim adds at a lateral distance (see the RIM_* block above).
   *
   * Climbs from nothing at RIM_START to a crest at RIM_FULL, then falls away towards
   * RIM_FAR so the far side reads as the back of a ridge rather than the top of a
   * table. The crest height is modulated by the dune field at a long wavelength,
   * which is what keeps the skyline from being a ruled line drawn across the view.
   *
   * It is now the steepest and tallest thing in the world by a wide margin, which is
   * intentional but worth stating plainly: `tools/relief-probe.ts` measures 28-39
   * degrees on its face against 13-16 for the basin floor, and 78-100 m of crest
   * against the floor's ~50 m of variation over 3 km. That is the point — the world
   * needs an edge a car cannot pull — but if the basin walls ever read as a canyon
   * rather than as a horizon, RIM_HEIGHT and RIM_START are the two knobs, and nothing
   * else in the terrain depends on them.
   */
  private rimHeight(dist: number, x: number, z: number): number {
    if (dist <= RIM_START) return 0;

    const ragged =
      1 +
      RIM_RAGGED *
        this.duneNoise.at(x / RIM_RAGGED_WAVELENGTH, z / RIM_RAGGED_WAVELENGTH);
    const crest = RIM_HEIGHT * ragged;

    const rise = smoothstep01((dist - RIM_START) / (RIM_FULL - RIM_START));
    const fall =
      dist <= RIM_FULL
        ? 1
        : 1 - (1 - RIM_FAR_FRACTION) * smoothstep01((dist - RIM_FULL) / (RIM_FAR - RIM_FULL));
    return crest * rise * fall;
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
