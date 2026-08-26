import { hash01, Noise1D, Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { NODE_SPACING, type Road } from './road';
import { roadConditionAt } from './gradient';

/**
 * The road's actual driving surface, shared between the road ribbon and the
 * terrain that meets it.
 *
 * The ribbon and the desert verge are two separate meshes, but they must agree in
 * height along the shoulder edge or the road reads as a floating strip above a
 * trench. Everything that raises or lowers the road — corner banking and the
 * layered surface field — lives here, and `roadSurfaceY` is the one function both
 * meshes sample, so they cannot drift apart.
 */

/**
 * How strongly the road banks into corners. `drop = curvature * CAMBER_SCALE *
 * lateral`.
 */
const CAMBER_SCALE = 3;

/**
 * Longitudinal sub-samples per road node. The mesh is densified 3x (a 1.333 m
 * vertex step instead of NODE_SPACING's 4 m) so bumps and potholes are actually
 * representable by the trimesh the wheels ray-cast against. NODE_SPACING itself
 * stays 4 m — it is the road curve's integration step and other systems depend on
 * it; this only sub-samples inside the provider.
 */
export const SUB_DIVISIONS = 3;
/** Longitudinal vertex/collider step in metres. */
export const SURFACE_STEP = NODE_SPACING / SUB_DIVISIONS;

/**
 * Short bump layer, two octaves: 6.7 m plus a 3.33 m octave.
 *
 * Both were one octave lower (8.3 / 4.17 m). 8 m is long enough that a car at
 * 60-100 km/h reads it as the road breathing rather than as texture — it arrives
 * at 2-3 Hz, which is body-frequency, so the springs absorb it and the driver
 * feels a wallow. 3-7 m arrives at 2.5-8 Hz: the band where the wheel starts
 * working and the body starts being told about it. 3.33 m is 2.5 vertex steps, so
 * it is the shortest wave the 1.333 m collider still resolves as a shape rather
 * than as noise; anything shorter aliases into seed-dependent spikes.
 */
const ROUGH_FREQ = 0.15;
const ROUGH_FREQ_HI = 0.3;
/** Relative amplitude of the 3.33 m octave. */
const ROUGH_HI_GAIN = 0.6;
/**
 * Bump amplitude per surface type, metres. Constant along the whole road: the bump
 * layer does NOT scale with decay.
 *
 * It used to. Amplitude was `floor + 0.5 * decay * surfaceRoughness`, which tied
 * the road's texture to a progress curve — so the first hundred kilometres were
 * near-glass and only the far end had any life in it. Decay still drives the things
 * decay should drive (which surface you are on, how many potholes there are, the
 * long undulation), but how bumpy a given surface feels is now a property of the
 * material, not of how far you have driven. The first kilometre reads like the
 * three-hundredth.
 *
 * These are 2x the previous floors. Cracked asphalt is highest because broken
 * tarmac is rutted; loose gravel stays comparatively even; concrete is the one
 * genuinely smooth surface. At 90 km/h the asphalt figure is a 0.9 m/s velocity
 * step at the wheel on the sharpest slope change (tools/ride-bench.ts) — busy
 * enough to keep both hands on the wheel, well short of anything that unloads a
 * tyre.
 */
const BUMP_AMP: Record<SurfaceType, number> = {
  [SurfaceType.Asphalt]: 0.09,
  [SurfaceType.CrackedAsphalt]: 0.16,
  [SurfaceType.Gravel]: 0.08,
  [SurfaceType.Sand]: 0.076,
  [SurfaceType.Rock]: 0.1,
  [SurfaceType.Concrete]: 0.028,
};

/** Long undulation: wavelength (m) of its first octave — gentle rolling, not hills. */
const UND_WAVELENGTH = 30;
/** Undulation amplitude at decay = 1 (m). */
const UND_AMP = 0.024;
/** Fraction of the amplitude kept even on pristine road; glass is boring. */
const UND_FLOOR = 0.35;

/** Metres between pothole candidate slots. */
const POTH_SLOT = 4;
/** Per-slot occupancy at decay = 1, before the burst multiplier. */
const POTH_DENSITY = 0.22;
/**
 * Occupancy keeps this fraction even at decay = 0, so maintained asphalt still
 * throws holes; quadratic decay growth stacks on top of the floor. Measured by
 * tools/ride-bench.ts: a pristine stretch lands 1.4 holes/km in each wheel path
 * (~10/km across the whole mat) and a ruined one 4.3/km per path. The old floor of
 * 0.075 put ZERO holes in a wheel path over 3 km of the first 200 km of road —
 * they were both too rare and centred off the lines a tyre tracks.
 */
const POTH_DECAY_FLOOR = 0.28;
/**
 * Depth keeps this fraction of its cap even on pristine road. High, because decay
 * already controls how MANY holes there are; see `potholeAtSlot`.
 */
const POTH_DEPTH_FLOOR = 0.45;
/** Pothole diameter range in metres. */
const POTH_MIN_D = 0.4;
const POTH_MAX_D = 1.2;
/** Depth cap (m): never a hole deep enough to swallow a wheel. */
const POTH_MAX_DEPTH = 0.11;
/**
 * Depth/diameter cap. The cosine profile's steepest slope is pi*depth/diameter at
 * r = D/4; 0.16 keeps that under ~27 degrees, so a wheel never meets a kerb-like
 * wall. The mesh is much shallower again: a pothole spans one vertex row, so the
 * felt ramp is depth/1.333 m — under 5 degrees even at the 0.11 m cap.
 */
const POTH_SLOPE_CAP = 0.16;
/**
 * Lateral lines (m) a pothole may centre on.
 *
 * These MUST be columns of the road mesh's own cross-section (roadmesh.ts
 * LATERALS) or the profile's deepest point falls between vertices and is never
 * sampled — the hole is drawn and collided shallower than it is. The old lattice
 * (+/-1.1, +/-2.2) was on no column at all, and missed both wheel paths besides:
 * a 0.4 m hole centred at 1.1 m does not reach a tyre tracking 0.85 m.
 *
 * +/-0.85 and +/-2.45 ARE the wheel paths (roadmesh.ts WHEEL_PATH_LATERALS), which
 * is also where real holes form, because that is where the load is. +/-1.65 and 0
 * are the unloaded crown and lane centre: holes there are seen and swerved around
 * rather than hit, which is what stops the lattice reading as a rumble strip.
 */
const POTH_LATERALS: readonly number[] = [-2.45, -1.65, -0.85, 0, 0.85, 1.65, 2.45];

// Hash tags keep each pothole property's random stream independent.
const TAG_POTH_BURST = 0x50d4b7;
const TAG_POTH_OCCUPANCY = 0x0a11ce;
const TAG_POTH_OFFSET = 0x0ffee;
const TAG_POTH_LATERAL = 0x1a7a1;
const TAG_POTH_DIAMETER = 0xd1a4;
const TAG_POTH_DEPTH = 0xdee7;

interface Pothole {
  /** Arclength of the pothole centre. Always a vertex row, so it is exactly sampled. */
  readonly s: number;
  /** Lateral of the pothole centre. Always a lattice line, so it is exactly sampled. */
  readonly lateral: number;
  /** Diameter across the cosine profile, metres. */
  readonly diameter: number;
  /** Centre depth in metres, after decay and jitter scaling. */
  readonly depth: number;
}

/**
 * Shape of the pothole candidate at `slot`, before the decay-scaled occupancy
 * test. Deterministic in (seed, slot), so neighbouring chunks agree across seams.
 */
function potholeForSlot(seed: number, slot: number): Pick<Pothole, 's' | 'lateral' | 'diameter'> {
  const off = Math.floor(hash01(seed, slot, TAG_POTH_OFFSET) * SUB_DIVISIONS);
  return {
    s: POTH_SLOT * slot + off * SURFACE_STEP,
    lateral: POTH_LATERALS[Math.floor(hash01(seed, slot, TAG_POTH_LATERAL) * POTH_LATERALS.length)]!,
    diameter: POTH_MIN_D + (POTH_MAX_D - POTH_MIN_D) * hash01(seed, slot, TAG_POTH_DIAMETER),
  };
}

/**
 * The pothole anchored at `slot`, if its decay-scaled occupancy test passes.
 * Occupancy rises quadratically with decay and is bursty (0.35..1 multiplier), so
 * holes cluster on ruined stretches and almost vanish from maintained ones.
 */
function potholeAtSlot(seed: number, slot: number, decay: number): Pothole | null {
  const burst = 0.35 + 0.65 * hash01(seed, slot, TAG_POTH_BURST);
  // Floor + quadratic decay growth: pristine road still gets the odd patched hole,
  // ruined road gets plenty.
  const decayFactor = POTH_DECAY_FLOOR + (1 - POTH_DECAY_FLOOR) * decay * decay;
  if (hash01(seed, slot, TAG_POTH_OCCUPANCY) >= POTH_DENSITY * decayFactor * burst) return null;
  const shape = potholeForSlot(seed, slot);
  // Decay drives HOW MANY holes there are (above), not how shallow each one is. A
  // hole in maintained tarmac is a hole — the old double taper (this factor times
  // another `0.5 + 0.5 * decay`) left the early road's holes 10-20 mm deep, which
  // at a 1.333 m vertex step is a wheel-sized ripple nobody feels. One taper, with
  // a high floor: rare but real.
  const depthFactor = POTH_DEPTH_FLOOR + (1 - POTH_DEPTH_FLOOR) * decay;
  const depth =
    Math.min(POTH_MAX_DEPTH, POTH_SLOPE_CAP * shape.diameter) *
    depthFactor *
    (0.5 + 0.5 * hash01(seed, slot, TAG_POTH_DEPTH));
  return { s: shape.s, lateral: shape.lateral, diameter: shape.diameter, depth };
}

/**
 * Pothole displacement (m, negative = down) at a road point, or 0. Anchors sit on
 * vertex rows, so the cosine profile's centre is always exactly sampled; the
 * 1.333 m grid cannot resolve anything smaller anyway.
 */
function potholeAt(seed: number, s: number, lateral: number, decay: number): number {
  // The +1e-9 guards a float-boundary trap: row s = 3j * (4/3) rounds to just
  // BELOW 4j, so floor(s / 4) alone would look up slot j-1 and silently drop every
  // pothole anchored at a slot start. The epsilon is far below any real feature.
  const hole = potholeAtSlot(seed, Math.floor(s / POTH_SLOT + 1e-9), decay);
  if (!hole) return 0;
  const ds = s - hole.s;
  const dl = lateral - hole.lateral;
  const half = hole.diameter * 0.5;
  if (Math.abs(ds) > half || Math.abs(dl) > half) return 0;
  const r = Math.sqrt(ds * ds + dl * dl);
  // Cosine profile: deepest at the centre, zero slope at the rim (C1).
  return -hole.depth * Math.cos((Math.PI * r) / hole.diameter) ** 2;
}

/**
 * The layered surface field: long undulation + short bumps + discrete potholes.
 * Everything is a pure function of (seed, s, lateral), so rebuilds reproduce
 * exactly and chunk seams stay watertight.
 */
export class SurfaceField {
  private readonly seed: number;
  private readonly undulationNoise: Noise1D;
  private readonly bumpNoise: Noise2D;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    // Separate seeds keep the layers decorrelated; the bump seed is the one the
    // old single-octave roughness used, so existing worlds keep the same bumps.
    this.undulationNoise = new Noise1D(seed ^ 0x2d5f3e71);
    this.bumpNoise = new Noise2D(seed ^ 0x72e5c0a1);
  }

  /**
   * Total displacement (m, positive up) at a road point. `x`/`z` are the point's
   * world position (the bump layer is 2D world noise), `decay` the road condition
   * at this s (undulation and potholes only), `surface` the surface type, which is
   * the bump layer's ONLY input besides the noise.
   */
  displacement(
    s: number,
    lateral: number,
    x: number,
    z: number,
    decay: number,
    surface: SurfaceType,
  ): number {
    const und =
      UND_AMP * (UND_FLOOR + (1 - UND_FLOOR) * decay) *
      this.undulationNoise.fbm(s / UND_WAVELENGTH, 2, 2, 0.5);
    const bump =
      BUMP_AMP[surface] * this.bumpNoise.fbm(x * ROUGH_FREQ, z * ROUGH_FREQ, 2, 2, ROUGH_HI_GAIN);
    return und + bump + potholeAt(this.seed, s, lateral, decay);
  }
}

/**
 * The single height the road surface has at (s, lateral): centreline elevation,
 * minus corner banking, plus the layered surface field. This is the shared height
 * function — the road ribbon samples it for every vertex and collider, and the
 * terrain samples it at the shoulder edge so the two surfaces meet flush.
 */
export function roadSurfaceY(
  road: Road,
  field: SurfaceField,
  s: number,
  lateral: number,
  x: number,
  z: number,
): number {
  const sample = road.sampleAt(s);
  const cond = roadConditionAt(s);
  return (
    sample.y -
    sample.curvature * CAMBER_SCALE * lateral +
    field.displacement(s, lateral, x, z, cond.decay, cond.surface)
  );
}
