import { hash01, Noise1D, Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { NODE_SPACING, ROAD_HALF_WIDTH, type Road } from './road';
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
 * The collider and the mesh share these samples, and the collider is flat between
 * vertex rows SURFACE_STEP apart — so what a WHEEL gets from this layer is not the
 * smooth wave, it is a slope change at every row. `tools/ride-bench.ts` measures the
 * vertical velocity step that produces (the kick), and that is the number these
 * amplitudes have to be set by.
 *
 * ---- why they came down by a factor of four ----
 *
 * At 110 mm on asphalt the measured profile was 36-63 mm RMS with a 99th-percentile
 * kick of 1.0-1.6 m/s and a worst case of 2.9 m/s at 90 km/h. For scale, the pothole
 * cap two blocks below exists to keep the worst SINGLE HOLE on the road under
 * 2.8 m/s — so the ordinary road surface was hitting as hard as a pothole, several
 * times a second. Measured consequences with a real car (tools/surface-feel.ts): 0.95 g
 * RMS of vertical acceleration at 90 km/h, a car unable to hold 90 at all, and a top
 * speed 20 km/h below the same friction on flat ground. A real asphalt highway runs
 * 2-8 mm RMS over this band; this was an ISO class E farm track drawn as a highway.
 *
 * It was also self-reinforcing: a road that rough forces stiff springs to keep the
 * body on the ground, and stiff springs are what stopped the car feeling anything at
 * all (see carmodels.ts). Cutting the waviness is what pays for the soft springs.
 *
 * The road is not smooth now — the long undulation below, the edge break, the
 * potholes and the sub-collider texture in core/surfaces.ts all remain, and each is a
 * different band. What went away is a metre-scale wave nobody would build a road with.
 */
const ROUGH_FREQ = 0.15;
const ROUGH_FREQ_HI = 0.3;
/** Relative amplitude of the 3.33 m octave. */
const ROUGH_HI_GAIN = 0.78;
/** Bump amplitude per surface type, metres. */
const BUMP_AMP: Record<SurfaceType, number> = {
  [SurfaceType.Asphalt]: 0.028,
  [SurfaceType.CrackedAsphalt]: 0.075,
  // The loose surfaces keep more of it: a gravel track and a rock shelf really are
  // this uneven at a few metres of wavelength, and it is what makes them read as a
  // track rather than a painted road.
  [SurfaceType.Gravel]: 0.06,
  [SurfaceType.Sand]: 0.05,
  [SurfaceType.Rock]: 0.09,
  [SurfaceType.Concrete]: 0.014,
};

/** Long undulation: broad enough to pitch the car over a visible rise and fall. */
const UND_WAVELENGTH = 30;
/** Long undulation amplitude at decay = 1 (m). */
const UND_AMP = 0.04;
/** Fraction of the amplitude kept even on pristine road; glass is boring. */
const UND_FLOOR = 0.35;
/** Physical breakup across the outer asphalt strip. Zero at both strip boundaries. */
const EDGE_BREAK_WIDTH = 0.8;
const EDGE_BREAK_DEPTH = 0.075;

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
const POTH_MIN_D = 0.8;
const POTH_MAX_D = 2.0;
/**
 * Steepest ramp, as a gradient, that a pothole is allowed to present to a WHEEL.
 *
 * The wheel never meets the analytic cosine bowl. It meets the trimesh, which is flat
 * between vertex rows SURFACE_STEP apart, and no hole in this catalogue is as wide as
 * two of those rows — so every one of them is rendered as a single-row V-notch of the
 * full depth, whatever its nominal diameter. The horizontal distance the tyre climbs
 * out over is therefore `max(radius, SURFACE_STEP)`, and the vertical velocity step it
 * delivers is `2 · ramp · speed`, which is what the suspension is actually hit with
 * (tools/ride-bench.ts calls it the kick).
 *
 * At 0.16 m of depth that ramp was 0.12 and a 90 km/h wheel took a 5.5 m/s kick —
 * enough to throw the whole car off the ground. Measured on the real collider with a
 * real car (tools/surface-feel.ts): driven wheels below a third of their static load
 * for half the run, all four unloaded at a time, traction control lit for 68% of a
 * standing start, and 0-100 km/h taking 14.8 s against 8.6 s on flat asphalt of the
 * same friction. That is not a rough road, it is a jump ramp every few hundred metres.
 *
 * 0.055 puts the worst kick at 2.8 m/s at 90 km/h, just above the bump layer's own
 * 2.2 — so a hole is still the hardest single thing on the road and still audibly a
 * hole, but the tyre stays on the ground and keeps making force.
 */
const POTH_MAX_RAMP = 0.055;
/**
 * Absolute depth ceiling (m), so a hole wide enough to escape the ramp cap is still
 * never a wheel-swallowing trench.
 */
const POTH_MAX_DEPTH = 0.12;
/**
 * Lateral lines (m) a pothole may centre on.
 *
 * These MUST be columns of the road mesh's own cross-section (roadmesh.ts
 * LATERALS), so the deeper point is sampled by the collider. Wheel paths and the
 * spaces between them are both eligible: a driver can choose a line, not just absorb
 * a rumble strip.
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
  // The climb-out is over the hole's radius, or over one collider row when the hole is
  // narrower than the lattice can resolve — which, at these diameters, is all of them.
  const reach = Math.max(shape.diameter * 0.5, SURFACE_STEP);
  const depth =
    Math.min(POTH_MAX_DEPTH, POTH_MAX_RAMP * reach) *
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
    const edgeT = Math.max(
      0,
      Math.min(1, (Math.abs(lateral) - (ROAD_HALF_WIDTH - EDGE_BREAK_WIDTH)) / EDGE_BREAK_WIDTH),
    );
    const edgeBreak =
      EDGE_BREAK_DEPTH *
      decay *
      Math.sin(Math.PI * edgeT) *
      Math.max(0, this.bumpNoise.at(x * 0.08 + 19.7, z * 0.08 - 7.3));
    return und + bump - edgeBreak + potholeAt(this.seed, s, lateral, decay);
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
