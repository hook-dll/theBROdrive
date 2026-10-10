import { hash01, hashUnit3, Noise1D, Noise2D } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { NODE_SPACING, type Road } from './road';
import {
  MAX_WEAR,
  roadConditionAt,
  surfaceJoinAt,
  type RoadConditionBuffer,
  type SurfaceJoinBuffer,
} from './gradient';
import { laneHalfWidthFor, NARROW_HALF_WIDTH } from './roadprofile';

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
 * SUPERELEVATION: how far a corner is banked, and it is now the road-design relation
 * rather than a constant times curvature.
 *
 * The old law was `drop = curvature * 3 * lateral`, which at a 100 m radius is a 3%
 * cross-slope — a third of what a real road of that radius is built with, and it was
 * the same everywhere whatever the road was. Road design sizes it from the speed the
 * corner is FOR: the point-mass relation is
 *
 *     e + f = V² / (127 R)        (V in km/h, R in metres)
 *
 * so the banking is what the corner needs beyond the side friction a driver is
 * expected to spend. `E_MAX` caps it the way a real standard does — 8% is the usual
 * figure where ice is not a consideration — and the district's own `bankShare` says
 * how much of that a road of this kind was actually built with: a maintained highway
 * all of it, a bulldozed desert track none.
 *
 * A banked corner is worth the trouble twice over: it raises the speed the geometry
 * allows, and `Autopilot` is told about it (see `bankingAt`), so the traffic actually
 * uses the extra grip instead of leaving it on the table.
 */

/**
 * Longitudinal sub-samples per road node. The mesh is densified 3x (a 1.333 m
 * vertex step instead of NODE_SPACING's 4 m) so bumps and potholes are actually
 * representable by the trimesh the wheels ray-cast against. NODE_SPACING itself
 * stays 4 m — it is the road curve's integration step and other systems depend on
 * it; this only sub-samples inside the provider. These are the BASE rows; a gap
 * between two of them that holds a road event gets its own extra rows on top (see
 * ROAD EVENTS below).
 */
export const SUB_DIVISIONS = 3;
/** Longitudinal vertex/collider step in metres. */
export const SURFACE_STEP = NODE_SPACING / SUB_DIVISIONS;

const HW = NARROW_HALF_WIDTH;

/**
 * THE CROSS-SECTION: the lateral columns every road row is sampled on, left to right.
 *
 * Part of the surface's definition rather than of the mesh, because the road events
 * below are laid out on these columns: an event's lateral shape is a weight per
 * column, linear between them, which is exactly what a triangle strip over these
 * columns can carry — so the analytic surface (`roadSurfaceY`) and the collider agree
 * on an event to the vertex, wherever the wheel crosses it.
 *
 * The narrow and open templates have exactly the same count, so quad strips and
 * collider slabs cannot tear in a taper. The narrow literals preserve the old ribbon
 * bit-for-bit; the wide literals retain dense wheel/edge samples and hit the outer
 * pothole catalogue's fixed laterals.
 */
const SECTION_LATERALS: readonly number[] = [
  -HW, -2.45, -2, -1.65, -1.2, -0.85, -0.4,
  0,
  0.4, 0.85, 1.2, 1.65, 2, 2.45, HW,
];
const WIDE_SECTION_LATERALS: readonly number[] = [
  -5.8, -5.25, -4.85, -4.05, -3.25, -2.45, -0.85,
  0,
  0.85, 2.45, 3.25, 4.05, 4.85, 5.25, 5.8,
];
/** Columns in a road row. */
export const SECTION_COLUMNS = SECTION_LATERALS.length;

/** Lateral of section column `column` on a road this wide. */
export function sectionLateral(halfWidth: number, column: number): number {
  const narrowLateral = SECTION_LATERALS[column]!;
  if (halfWidth === HW) return narrowLateral;
  const wideLateral = WIDE_SECTION_LATERALS[column]!;
  if (halfWidth === HW * 2) return wideLateral;
  // The outer lane's own half-width is the added asphalt. Interpolating its
  // lane-defined taper between fixed endpoint templates preserves the column count
  // while letting terrain's outer-lane potholes land on real mesh vertices.
  const widening = laneHalfWidthFor(halfWidth, 1) / laneHalfWidthFor(HW * 2, 1);
  return narrowLateral + (wideLateral - narrowLateral) * widening;
}

/**
 * Short bump layer: the 3-10 m band, as a first difference.
 *
 * The collider and the mesh share these samples, and the collider is flat between
 * vertex rows SURFACE_STEP apart — so what a WHEEL gets from this layer is not the
 * smooth wave, it is a slope change at every row. `tools/ride-bench.ts` measures the
 * vertical velocity step that produces (the kick) and, since the boat, the RMS per
 * wavelength band.
 *
 * ---- why it is a difference and not a noise ----
 *
 * It used to be two octaves of value noise, 6.7 m and 3.33 m lattices, at 6 cm on
 * asphalt. Value noise is WHITE below its lattice frequency: the random lattice values
 * put as much amplitude into a 15 m wave as into a 7 m one. Measured on the mesh
 * (ride-bench, asphalt): 15.6 mm RMS in the 10-40 m band against 6.1 mm in 3-10 m and
 * 0.7 mm under 3 m. 10-40 m is exactly where a body on 1.1-1.3 Hz springs is driven at
 * its own resonance between 60 and 100 km/h, so the whole road was a slow swell the
 * car rode like a boat, and almost nothing a wheel could hit. The lower octave alone
 * was most of it: its 6.7 m lattice makes waves of 13-20 m.
 *
 * Now: one octave on the 3.33 m lattice, minus itself ROUGH_COMB metres back. A first
 * difference is a high-pass that rises 6 dB an octave, so it keeps the 3-7 m pitch and
 * heave band — above the body's resonance at any driving speed, where the springs
 * work and the body is told about it without swimming — and drops the white low end.
 * Same amplitude scale, a fraction of the float: on asphalt 4.6 mm in 3-10 m and 2.7 mm
 * in 10-40 m per 2 cm of `BUMP_AMP`.
 *
 * In the ROAD frame (s, lateral), because the difference has to be taken along the
 * road; it is as much a pure function of position as world noise was.
 *
 * ---- why the amplitudes are low ----
 *
 * At 110 mm, long ago, the measured profile was 36-63 mm RMS with a 99th-percentile
 * kick of 1.0-1.6 m/s and a worst case of 2.9 m/s at 90 km/h: an ISO class E farm
 * track drawn as a highway, which forced stiff springs, which stopped the car feeling
 * anything at all (see carmodels.ts). The road is not smooth now — the long
 * undulation below, this band, the edge break, potholes, the ROAD EVENTS and the
 * sub-collider texture in core/surfaces.ts are each a different band. What went away
 * is a metre-scale swell nobody would build a road with.
 */
const ROUGH_FREQ = 0.3;
/** Metres between the two samples of the first difference. */
const ROUGH_COMB = 1;
/**
 * Bump amplitude per surface type, metres, in units of the first difference. Cracked
 * asphalt stays rougher than the starting mat but not by much: what makes a broken
 * road broken is its EVENTS (EVENT_MIX), not a taller wave.
 */
const BUMP_AMP: Record<SurfaceType, number> = {
  [SurfaceType.Asphalt]: 0.03,
  [SurfaceType.CrackedAsphalt]: 0.038,
  // The loose surfaces keep more of it: a gravel track and a rock shelf really are
  // this uneven at a few metres of wavelength, and it is what makes them read as a
  // track rather than a painted road.
  [SurfaceType.Gravel]: 0.05,
  [SurfaceType.Sand]: 0.038,
  [SurfaceType.Rock]: 0.062,
  [SurfaceType.Concrete]: 0.025,
  // Between the district's packed course and the open desert: the grader's spoil is
  // coarser than the road it came off and nothing has ever rolled it flat.
  [SurfaceType.LooseShoulder]: 0.05,
};

/**
 * Long undulation: the road's own SHAPE, a rise and fall the car follows rather than
 * rides. One octave on a 30 m lattice, so its waves are 50 m and longer — under
 * 0.6 Hz at 100 km/h, well below any body's resonance. It used to carry a second
 * octave on a 15 m lattice, whose 25-30 m waves landed right ON the body's 1 Hz at
 * highway speed: gentle to look at, a boat to drive.
 */
const UND_WAVELENGTH = 30;
/** Long undulation amplitude at decay = 1 (m). One octave, so it is the old first octave's. */
const UND_AMP = 0.05;
/** Fraction of the amplitude kept even on pristine road; glass is boring. */
const UND_FLOOR = 0.55;
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
 * 0.055 puts the worst kick at 2.75 m/s at 90 km/h — the cap everything on the road
 * lives under. The road events (ROAD EVENTS below) are held to 2.5 m/s inside it, so a
 * hole is still the hardest single thing on the road and still audibly a hole, but the
 * tyre stays on the ground and keeps making force.
 */
const POTH_MAX_RAMP = 0.055;
/**
 * Absolute depth ceiling (m), so a hole wide enough to escape the ramp cap is still
 * never a wheel-swallowing trench.
 */
const POTH_MAX_DEPTH = 0.12;
/**
 * Lateral lines (m) a pothole may centre on. The narrow catalogue stays separate so
 * every existing one-lane slot retains its exact random choice; wider asphalt adds
 * only outside columns.
 */
const POTH_LATERALS: readonly number[] = [-2.45, -1.65, -0.85, 0, 0.85, 1.65, 2.45];
const WIDE_POTH_LATERALS: readonly number[] = [
  -5.25, -4.85, -4.05, -3.25,
  ...POTH_LATERALS,
  3.25, 4.05, 4.85, 5.25,
];
/** Do not seed an outer-path hole until its centre is actually on the taper. */
const WIDE_POTHOLE_MIN_HALF_WIDTH = 5.25;

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
function potholeForSlot(
  seed: number,
  slot: number,
  halfWidth: number,
): Pick<Pothole, 's' | 'lateral' | 'diameter'> {
  const off = Math.floor(hash01(seed, slot, TAG_POTH_OFFSET) * SUB_DIVISIONS);
  const laterals = halfWidth < WIDE_POTHOLE_MIN_HALF_WIDTH ? POTH_LATERALS : WIDE_POTH_LATERALS;
  return {
    s: POTH_SLOT * slot + off * SURFACE_STEP,
    lateral: laterals[Math.floor(hash01(seed, slot, TAG_POTH_LATERAL) * laterals.length)]!,
    diameter: POTH_MIN_D + (POTH_MAX_D - POTH_MIN_D) * hash01(seed, slot, TAG_POTH_DIAMETER),
  };
}

/**
 * The pothole anchored at `slot`, if its decay-scaled occupancy test passes.
 * Occupancy rises quadratically with decay and is bursty (0.35..1 multiplier), so
 * holes cluster on ruined stretches and almost vanish from maintained ones.
 */
function potholeAtSlot(seed: number, slot: number, decay: number, halfWidth: number): Pothole | null {
  const burst = 0.35 + 0.65 * hash01(seed, slot, TAG_POTH_BURST);
  // Floor + quadratic decay growth: pristine road still gets the odd patched hole,
  // ruined road gets plenty.
  const decayFactor = POTH_DECAY_FLOOR + (1 - POTH_DECAY_FLOOR) * decay * decay;
  if (hash01(seed, slot, TAG_POTH_OCCUPANCY) >= POTH_DENSITY * decayFactor * burst) return null;
  const shape = potholeForSlot(seed, slot, halfWidth);
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
function potholeAt(
  seed: number,
  s: number,
  lateral: number,
  decay: number,
  halfWidth: number,
): number {
  // The +1e-9 guards a float-boundary trap: row s = 3j * (4/3) rounds to just
  // BELOW 4j, so floor(s / 4) alone would look up slot j-1 and silently drop every
  // pothole anchored at a slot start. The epsilon is far below any real feature.
  const hole = potholeAtSlot(seed, Math.floor(s / POTH_SLOT + 1e-9), decay, halfWidth);
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
 * ROAD EVENTS: the small, one-off, peaky irregularities a real road is mostly made of.
 *
 * Measured before they existed (tools/ride-bench.ts, wheel path, 60 km/h): the road
 * had 15-20 mm RMS of 10-40 m swell, under 1 mm below 3 m, and 1.4 single-row dips a
 * kilometre. A car on it floated: everything it met was a wave, and nothing was a HIT.
 * What a driver actually meets is a short hump in the wheel track, the rim of a
 * pothole, a patch sitting proud of the mat, a sealed crack, a frost heave, a concrete
 * joint — met once, felt as a jolt, gone.
 *
 * ---- where they live: inside one gap ----
 *
 * Every event sits strictly INSIDE one gap between two base rows (SURFACE_STEP), at
 * least EVENT_MARGIN clear of both, so it is at most EVENT_MAX_LENGTH long. That one
 * rule buys everything else:
 *
 *   - The base rows never move. An event is zero on them, so the ribbon's base
 *     vertices, its colours, the shoulder, the terrain's flush edge and every chunk
 *     seam are exactly what they were; nothing outside the gap can tear.
 *   - The collider can carry it. The gap gets its own extra rows at the event's knots
 *     (`eventRows`), so a 0.5 m hump is five rows of real triangles the wheel's ray
 *     lands on, not a wave the 1.333 m lattice silently drops.
 *   - The profile along the road IS the knots, linear between them, and across the
 *     road it is a weight per section column, linear between them. That is exactly
 *     what the triangles can represent, so `roadSurfaceY` and the collider agree on
 *     an event to the vertex. The extra rows interpolate the base rows' surface and
 *     add only the event, so outside an event the gap is the same plane it was.
 *
 * Lateral weights are zero on the two edge columns, so an event never reaches the
 * asphalt edge the shoulder and terrain meet.
 *
 * ---- how hard they may hit ----
 *
 * The 60 Hz ray samples a ramp, not a height: Rapier projects the chassis velocity on
 * the hit normal, so the damper is handed `slope * speed` for the step the ray landed
 * on. And an event is shorter than the distance a car covers in one or two steps, so
 * the ray can land on ANY two of its segments in consecutive steps: what the damper can
 * be hit with is not the slope change at one knot, it is the event's whole SWING, its
 * steepest climb minus its steepest descent. That is capped at EVENT_MAX_SWING, which
 * is 2.5 m/s at 90 km/h — under the cap the road already lives under (the worst
 * pothole, 2.75 m/s: POTH_MAX_RAMP), with the bump layer's own slope as headroom. A
 * gap within reach of one of those potholes holds no event, so the two never stack.
 *
 * Every event's height is clamped to the cap from its own knot geometry, so a short
 * event is a shallow one — which is also what a tyre does to it: a 30 cm hole is
 * mostly bridged. Measured (tools/ride-bench.ts) the worst step any wheel path is
 * handed is 2.5 m/s at 90 km/h, and a real car's wheel load (tools/surface-feel.ts)
 * peaks under 2.5x static with all four wheels kept on the ground.
 *
 * ---- how many ----
 *
 * A rate per kilometre of road per surface, from new (decay 0) to as broken as a road
 * gets (MAX_WEAR), clustered by a slow noise so bad patches come in stretches. New
 * asphalt and concrete have a few a kilometre; cracked asphalt and gravel tens. Most
 * sit in the wheel tracks (section columns 1, 5, 9, 13 on either road width) and the
 * outer track is the one nearest the edge, as on a real road; cracks, heaves and
 * joints run across a lane or the whole carriageway.
 */
const enum RoadEventKind {
  /** A short raised hump in a wheel track: shoving, a root, a stone under the mat. */
  Hump,
  /** A sharp-rimmed hole: steep walls, flat bottom. */
  Pothole,
  /** An open transverse crack: a short V across a lane or the road. */
  Crack,
  /** A sealed or heaved crack: a low, narrow ridge across a lane or the road. */
  Ridge,
  /** A patch sitting proud of (or sunk into) the mat, with a seam step at each end. */
  Patch,
  /** A frost heave: a broad hump across a lane or the road, often cracked at the crest. */
  Heave,
  /** A concrete slab joint: a shallow spalled notch every JOINT_GAPS gaps. */
  Joint,
}

/** How an event marks the paint of the mat over it (roadmesh.ts colours it). */
export const enum RoadEventTint {
  None,
  /** Broken base course and sand in the bottom of a hole. */
  Hole,
  /** Fresh bitumen of a repair. */
  Patch,
  /** A dark line: an open or sealed crack, a joint. */
  Line,
}

/** Clearance from each base row an event keeps, metres. */
const EVENT_MARGIN = 0.04;
/** Longest event, metres: what fits in a gap with its margins. */
const EVENT_MAX_LENGTH = SURFACE_STEP - 2 * EVENT_MARGIN;
/**
 * Largest slope swing (steepest climb minus steepest descent) an event may present;
 * see "how hard they may hit". 0.1 is 2.5 m/s of damper input at 90 km/h.
 */
const EVENT_MAX_SWING = 0.1;
/** Most knots any event shape has; `eventRows` writes at most this many rows per gap. */
export const EVENT_MAX_KNOTS = 5;
/** Concrete slabs are this many gaps long (5.33 m), with a joint in the first. */
const JOINT_GAPS = 4;
/** Metres of the noise that clusters events into bad stretches. */
const EVENT_CLUSTER_WAVELENGTH = 120;
/** Cluster multiplier range, mean 1. */
const EVENT_CLUSTER_SWING = 0.55;

/**
 * Events per kilometre of road (both directions, all laterals) at decay 0 and at
 * MAX_WEAR, and the mix of kinds, by surface. A car's two wheel paths see about 0.55
 * of the rate between them.
 */
interface EventMix {
  readonly rateNew: number;
  readonly rateWorn: number;
  readonly hump: number;
  readonly pothole: number;
  readonly crack: number;
  readonly ridge: number;
  readonly patch: number;
  readonly heave: number;
}
const EVENT_MIX: Record<SurfaceType, EventMix> = {
  [SurfaceType.Asphalt]: { rateNew: 3, rateWorn: 30, hump: 0.3, pothole: 0.25, crack: 0.15, ridge: 0.1, patch: 0.15, heave: 0.05 },
  [SurfaceType.CrackedAsphalt]: { rateNew: 30, rateWorn: 90, hump: 0.2, pothole: 0.3, crack: 0.2, ridge: 0.1, patch: 0.15, heave: 0.05 },
  // Slabs crack and spall at the joints, which are their own channel (JOINT_GAPS).
  [SurfaceType.Concrete]: { rateNew: 3, rateWorn: 20, hump: 0.1, pothole: 0.35, crack: 0.3, ridge: 0.05, patch: 0.2, heave: 0 },
  // Loose ground has no seams: stones, ruts and scoured holes.
  [SurfaceType.Gravel]: { rateNew: 50, rateWorn: 130, hump: 0.6, pothole: 0.4, crack: 0, ridge: 0, patch: 0, heave: 0 },
  [SurfaceType.Sand]: { rateNew: 10, rateWorn: 25, hump: 0.7, pothole: 0.3, crack: 0, ridge: 0, patch: 0, heave: 0 },
  [SurfaceType.Rock]: { rateNew: 60, rateWorn: 120, hump: 0.75, pothole: 0.25, crack: 0, ridge: 0, patch: 0, heave: 0 },
  [SurfaceType.LooseShoulder]: { rateNew: 30, rateWorn: 60, hump: 0.5, pothole: 0.5, crack: 0, ridge: 0, patch: 0, heave: 0 },
};
/** Upper bound on any gap's occupancy (the highest `rateWorn`), so most gaps are rejected on one hash. */
const EVENT_P_MAX = (130 * (1 + EVENT_CLUSTER_SWING) * SURFACE_STEP) / 1000;

/**
 * Lateral column spans (inclusive, weight 1 inside, linear to zero on the next column
 * out). The wheel tracks are columns 1, 5, 9 and 13 on both road widths: the narrow
 * road's 0.85/2.45 m and the wide road's 2.45/5.25 m lines (roadmesh.ts wheel paths).
 */
const TRACK_COLUMNS: readonly number[] = [9, 13, 5, 1];
const RIGHT_LANE: readonly [number, number] = [8, 13];
const LEFT_LANE: readonly [number, number] = [1, 6];
const FULL_WIDTH: readonly [number, number] = [1, 13];

// Hash tags keep each event property's random stream independent.
const TAG_EVENT_OCCUPANCY = 0x3e7e47;
const TAG_EVENT_KIND = 0x4b1d;
const TAG_EVENT_LATERAL = 0x1a7e2a;
const TAG_EVENT_SIDE = 0x51de;
const TAG_EVENT_LENGTH = 0x1e6;
const TAG_EVENT_SIZE = 0x512e;
const TAG_EVENT_PLACE = 0x91ace;
const TAG_EVENT_SIGN = 0x5160;

/** The event a gap holds: knots along the road, a column span across it. */
interface RoadEvent {
  kind: RoadEventKind;
  tint: RoadEventTint;
  colFrom: number;
  colTo: number;
  knotCount: number;
  /** Absolute arclength of each knot. */
  readonly knotS: Float64Array;
  /** Height of each knot, metres, signed. */
  readonly knotH: Float64Array;
  /** Paint strength of each knot, 0..1. */
  readonly knotTint: Float64Array;
}

/** Knots of a raised-cosine bump of `segments` chords, unit height, into the event. */
function cosineKnots(event: RoadEvent, segments: number): void {
  event.knotCount = segments + 1;
  for (let k = 0; k <= segments; k++) {
    event.knotS[k] = k / segments;
    event.knotH[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / segments);
  }
}

/** Knots of a flat-bottomed (or flat-topped) plate with `ramp` of the length at each end. */
function plateKnots(event: RoadEvent, ramp: number): void {
  event.knotCount = 4;
  event.knotS[0] = 0; event.knotS[1] = ramp; event.knotS[2] = 1 - ramp; event.knotS[3] = 1;
  event.knotH[0] = 0; event.knotH[1] = 1; event.knotH[2] = 1; event.knotH[3] = 0;
}

/**
 * The layered surface field: long undulation + short bumps + discrete potholes, and the
 * road events inside the gaps.
 * Everything is a pure function of (seed, s, lateral), so rebuilds reproduce
 * exactly and chunk seams stay watertight.
 */
export class SurfaceField {
  private readonly seed: number;
  private readonly undulationNoise: Noise1D;
  private readonly bumpNoise: Noise2D;
  private readonly clusterNoise: Noise1D;
  /** Scratch for the material join, read once per displacement. */
  private readonly join: SurfaceJoinBuffer = { neighbour: SurfaceType.Asphalt, t: 0 };
  /** Scratch for the condition of an event's gap. */
  private readonly gapCondition: RoadConditionBuffer = {
    surface: SurfaceType.Asphalt,
    decay: 0,
    sandCover: 0,
    markings: 0,
  };
  /**
   * The last gap resolved and its event. A ribbon row asks for one gap fifteen times
   * across, so one entry is the whole cache; nothing here allocates after construction.
   */
  private memoGap = Number.NaN;
  private memoLive = false;
  private readonly event: RoadEvent = {
    kind: RoadEventKind.Hump,
    tint: RoadEventTint.None,
    colFrom: 0,
    colTo: 0,
    knotCount: 0,
    knotS: new Float64Array(EVENT_MAX_KNOTS),
    knotH: new Float64Array(EVENT_MAX_KNOTS),
    knotTint: new Float64Array(EVENT_MAX_KNOTS),
  };

  /**
   * The material every event gap reads instead of the road's own district, or null.
   * A bench seam (tools/ride-bench.ts forces one surface over the whole road); the
   * game never sets it.
   */
  private readonly surfaceOverride: SurfaceType | null;

  constructor(seed: number, surfaceOverride: SurfaceType | null = null) {
    this.seed = seed >>> 0;
    this.surfaceOverride = surfaceOverride;
    // Separate seeds keep the layers decorrelated; the bump seed is the one the
    // old single-octave roughness used, so existing worlds keep the same bumps.
    this.undulationNoise = new Noise1D(seed ^ 0x2d5f3e71);
    this.bumpNoise = new Noise2D(seed ^ 0x72e5c0a1);
    this.clusterNoise = new Noise1D(seed ^ 0x6c0de5);
  }

  /**
   * Total displacement (m, positive up) at a road point. `x`/`z` are the point's
   * world position (the edge break is 2D world noise), `decay` the road condition
   * at this s (undulation, edge and potholes), `surface` the surface type, which sets
   * the bump layer's amplitude — together with the material across the nearest
   * district join, which it is feathered toward. Road events read their own gap's
   * condition, so one event is one shape whichever of its rows asks.
   */
  displacement(
    s: number,
    lateral: number,
    x: number,
    z: number,
    decay: number,
    surface: SurfaceType,
    halfWidth: number,
  ): number {
    const und =
      UND_AMP * (UND_FLOOR + (1 - UND_FLOOR) * decay) * this.undulationNoise.at(s / UND_WAVELENGTH);
    // The material owns the bump amplitude, and a material is a district — a step of
    // arclength. Feathering the amplitude across the join is what stops the deck
    // stepping there; see SURFACE_JOIN_BLEND_M. Away from a join `t` is 0 and this is
    // exactly `BUMP_AMP[surface]`.
    surfaceJoinAt(this.seed, s, this.join);
    const amp =
      BUMP_AMP[surface]! +
      (BUMP_AMP[this.join.neighbour]! - BUMP_AMP[surface]!) * this.join.t;
    const bump =
      amp *
      (this.bumpNoise.at(s * ROUGH_FREQ, lateral * ROUGH_FREQ) -
        this.bumpNoise.at((s - ROUGH_COMB) * ROUGH_FREQ, lateral * ROUGH_FREQ));
    const edgeT = Math.max(
      0,
      Math.min(1, (Math.abs(lateral) - (halfWidth - EDGE_BREAK_WIDTH)) / EDGE_BREAK_WIDTH),
    );
    const edgeBreak =
      EDGE_BREAK_DEPTH *
      decay *
      Math.sin(Math.PI * edgeT) *
      Math.max(0, this.bumpNoise.at(x * 0.08 + 19.7, z * 0.08 - 7.3));
    return (
      und +
      bump -
      edgeBreak +
      potholeAt(this.seed, s, lateral, decay, halfWidth) +
      this.eventAt(s, lateral, halfWidth)
    );
  }

  /**
   * The extra rows the gap starting at base row `gapStart` needs: its event's knots,
   * absolute arclengths in increasing order, written to `out` from `offset`. Returns
   * how many (0 for an empty gap, at most EVENT_MAX_KNOTS). Every one is strictly
   * inside the gap.
   */
  eventRows(gapStart: number, out: Float64Array, offset: number): number {
    if (!this.resolveGap(Math.round(gapStart / SURFACE_STEP))) return 0;
    const event = this.event;
    for (let k = 0; k < event.knotCount; k++) out[offset + k] = event.knotS[k]!;
    return event.knotCount;
  }

  /**
   * The event's height along the road at `s` (metres, signed), before its lateral
   * weight; 0 outside an event. Linear between knots, as the collider is.
   */
  eventHeight(s: number): number {
    if (!this.resolveGap(Math.floor(s / SURFACE_STEP))) return 0;
    const { knotS, knotH, knotCount } = this.event;
    if (s <= knotS[0]! || s >= knotS[knotCount - 1]!) return 0;
    let k = 1;
    while (s > knotS[k]!) k++;
    const t = (s - knotS[k - 1]!) / (knotS[k]! - knotS[k - 1]!);
    return knotH[k - 1]! + (knotH[k]! - knotH[k - 1]!) * t;
  }

  /** Paint strength of the event at `s`, 0..1, linear between knots; see `eventTint`. */
  eventTintStrength(s: number): number {
    if (!this.resolveGap(Math.floor(s / SURFACE_STEP))) return 0;
    const { knotS, knotTint, knotCount } = this.event;
    if (s <= knotS[0]! || s >= knotS[knotCount - 1]!) return 0;
    let k = 1;
    while (s > knotS[k]!) k++;
    const t = (s - knotS[k - 1]!) / (knotS[k]! - knotS[k - 1]!);
    return knotTint[k - 1]! + (knotTint[k]! - knotTint[k - 1]!) * t;
  }

  /** How the event in `s`'s gap marks the mat, or None. */
  eventTint(s: number): RoadEventTint {
    return this.resolveGap(Math.floor(s / SURFACE_STEP)) ? this.event.tint : RoadEventTint.None;
  }

  /** The lateral weight of the event in `s`'s gap on section column `column`, 0 or 1. */
  eventColumnWeight(s: number, column: number): number {
    if (!this.resolveGap(Math.floor(s / SURFACE_STEP))) return 0;
    return column >= this.event.colFrom && column <= this.event.colTo ? 1 : 0;
  }

  /**
   * The event's displacement at a road point (metres, signed): its height along the
   * road times its column weight interpolated across, which is the collider's own
   * shape. Zero on every base row and on both edge columns.
   */
  eventAt(s: number, lateral: number, halfWidth: number): number {
    const height = this.eventHeight(s);
    if (height === 0) return 0;
    const { colFrom, colTo } = this.event;
    const outerLeft = sectionLateral(halfWidth, colFrom - 1);
    const outerRight = sectionLateral(halfWidth, colTo + 1);
    if (lateral <= outerLeft || lateral >= outerRight) return 0;
    const innerLeft = sectionLateral(halfWidth, colFrom);
    if (lateral < innerLeft) return (height * (lateral - outerLeft)) / (innerLeft - outerLeft);
    const innerRight = sectionLateral(halfWidth, colTo);
    if (lateral > innerRight) return (height * (outerRight - lateral)) / (outerRight - innerRight);
    return height;
  }

  /** Resolves gap `g`'s event into `this.event`; false if the gap is empty. */
  private resolveGap(g: number): boolean {
    if (g === this.memoGap) return this.memoLive;
    this.memoGap = g;
    this.memoLive = false;
    const seed = this.seed;
    const joint = g % JOINT_GAPS === 0;
    const roll = hashUnit3(seed, g, TAG_EVENT_OCCUPANCY);
    if (!joint && roll >= EVENT_P_MAX) return false;

    const gapStart = g * SURFACE_STEP;
    const condition = roadConditionAt(seed, gapStart + SURFACE_STEP * 0.5, this.gapCondition);
    const surface = this.surfaceOverride ?? condition.surface;
    const wear = Math.min(1, condition.decay / MAX_WEAR);
    const event = this.event;
    const size = hashUnit3(seed, g, TAG_EVENT_SIZE) * (0.6 + 0.4 * wear);
    const side = hashUnit3(seed, g, TAG_EVENT_SIDE) < 0.5;
    const lateralRoll = hashUnit3(seed, g, TAG_EVENT_LATERAL);
    let length: number;
    let height: number;

    if (joint && surface === SurfaceType.Concrete) {
      // Every slab has its joint, and it spalls and opens as the road ages.
      event.kind = RoadEventKind.Joint;
      length = 0.35;
      height = -(0.0015 + 0.0035 * wear);
      this.setColumns(FULL_WIDTH[0], FULL_WIDTH[1]);
    } else {
      const mix = EVENT_MIX[surface];
      const cluster =
        1 + EVENT_CLUSTER_SWING * this.clusterNoise.at(gapStart / EVENT_CLUSTER_WAVELENGTH);
      const rate = mix.rateNew + (mix.rateWorn - mix.rateNew) * wear * Math.sqrt(wear);
      if (roll >= (rate * cluster * SURFACE_STEP) / 1000) return false;
      // The road's own potholes are cosine bowls up to POTH_MAX_D across, anchored on
      // rows; an event inside one would stack two caps (see "how hard they may hit").
      const reach = POTH_MAX_D * 0.5;
      const lastSlot = Math.floor((gapStart + SURFACE_STEP + reach) / POTH_SLOT + 1e-9);
      for (let slot = Math.floor((gapStart - reach) / POTH_SLOT - 1); slot <= lastSlot; slot++) {
        const hole = potholeAtSlot(seed, slot, condition.decay, NARROW_HALF_WIDTH);
        if (
          hole &&
          hole.s + hole.diameter * 0.5 > gapStart &&
          hole.s - hole.diameter * 0.5 < gapStart + SURFACE_STEP
        ) return false;
      }
      const total = mix.hump + mix.pothole + mix.crack + mix.ridge + mix.patch + mix.heave;
      let pick = hashUnit3(seed, g, TAG_EVENT_KIND) * total;
      const lengthRoll = hashUnit3(seed, g, TAG_EVENT_LENGTH);
      if ((pick -= mix.hump) < 0) {
        event.kind = RoadEventKind.Hump;
        length = 0.5 + 0.75 * lengthRoll;
        height = 0.012 + 0.02 * size;
        this.setTrack(lateralRoll, 0.25, side);
      } else if ((pick -= mix.pothole) < 0) {
        event.kind = RoadEventKind.Pothole;
        length = 0.45 + 0.8 * lengthRoll;
        height = -(0.015 + 0.02 * size);
        this.setTrack(lateralRoll, 0.2, side);
      } else if ((pick -= mix.crack) < 0) {
        event.kind = RoadEventKind.Crack;
        length = 0.25 + 0.15 * lengthRoll;
        height = -(0.004 + 0.006 * size);
        this.setAcross(lateralRoll, 0.5, side);
      } else if ((pick -= mix.ridge) < 0) {
        event.kind = RoadEventKind.Ridge;
        length = 0.3 + 0.2 * lengthRoll;
        height = 0.004 + 0.005 * size;
        this.setAcross(lateralRoll, 0.5, side);
      } else if ((pick -= mix.patch) < 0) {
        event.kind = RoadEventKind.Patch;
        length = 0.6 + 0.65 * lengthRoll;
        // Most patches sit proud of the mat they were laid on; the rest have settled.
        const sign = hashUnit3(seed, g, TAG_EVENT_SIGN) < 0.65 ? 1 : -1;
        height = sign * (0.006 + 0.012 * size);
        if (lateralRoll < 0.6) this.setTrack(lateralRoll / 0.6, 0.5, side);
        else this.setLane(side);
      } else {
        event.kind = RoadEventKind.Heave;
        length = 1 + 0.25 * lengthRoll;
        height = 0.02 + 0.015 * size;
        this.setAcross(lateralRoll, 0.45, side);
      }
    }
    length = Math.min(EVENT_MAX_LENGTH, length);

    // Unit shape over [0, 1], then its tint. Humps, heaves and ridges are four-chord
    // cosines — a tent with a rounded crest, which is the most height the swing cap
    // allows over a given length (L/40).
    const tints = event.knotTint;
    switch (event.kind) {
      case RoadEventKind.Hump:
        cosineKnots(event, 4);
        event.tint = RoadEventTint.None;
        tints.fill(0);
        break;
      case RoadEventKind.Heave:
        cosineKnots(event, 4);
        // Heaves crack along the crest.
        event.tint = RoadEventTint.Line;
        tints.fill(0);
        tints[2] = 0.6;
        break;
      case RoadEventKind.Ridge:
        cosineKnots(event, 4);
        event.tint = RoadEventTint.Line;
        tints.fill(0);
        tints[1] = 0.5; tints[2] = 1; tints[3] = 0.5;
        break;
      case RoadEventKind.Pothole:
        // Steep walls over 35% of the length each side: a hole has a rim.
        plateKnots(event, 0.35);
        event.tint = RoadEventTint.Hole;
        tints.fill(0);
        tints[1] = 1; tints[2] = 1;
        break;
      case RoadEventKind.Patch:
        // The seam step: a short ramp each end of a flat plate.
        plateKnots(event, Math.min(0.35, 0.25 / length));
        event.tint = RoadEventTint.Patch;
        tints.fill(0);
        tints[1] = 1; tints[2] = 1;
        break;
      default:
        // Crack and joint: a V.
        event.knotCount = 3;
        event.knotS[0] = 0; event.knotS[1] = 0.5; event.knotS[2] = 1;
        event.knotH[0] = 0; event.knotH[1] = 1; event.knotH[2] = 0;
        event.tint = RoadEventTint.Line;
        tints.fill(0);
        tints[1] = 1;
        break;
    }

    // Clamp the height to the swing cap from the shape's own unit slopes; the road
    // either side of an event is slope 0, so that counts as one of its slopes.
    let climb = 0;
    let descent = 0;
    for (let k = 1; k < event.knotCount; k++) {
      const slope = (event.knotH[k]! - event.knotH[k - 1]!) / ((event.knotS[k]! - event.knotS[k - 1]!) * length);
      if (slope > climb) climb = slope;
      if (slope < descent) descent = slope;
    }
    const magnitude = Math.min(Math.abs(height), EVENT_MAX_SWING / (climb - descent));
    const signed = Math.sign(height) * magnitude;

    const start =
      gapStart + EVENT_MARGIN + (EVENT_MAX_LENGTH - length) * hashUnit3(seed, g, TAG_EVENT_PLACE);
    for (let k = 0; k < event.knotCount; k++) {
      event.knotS[k] = start + event.knotS[k]! * length;
      event.knotH[k] = event.knotH[k]! * signed;
    }
    this.memoLive = true;
    return true;
  }

  private setColumns(from: number, to: number): void {
    this.event.colFrom = from;
    this.event.colTo = to;
  }

  /** One wheel track, or (with probability `wide`) it and its inboard neighbour. */
  private setTrack(roll: number, wide: number, right: boolean): void {
    const column = TRACK_COLUMNS[(right ? 0 : 2) + (roll < 0.5 ? 0 : 1)]!;
    const widen = (roll % 0.5) * 2 < wide;
    // Inboard is towards the crown, column 7.
    if (!widen) this.setColumns(column, column);
    else if (column > 7) this.setColumns(column - 1, column);
    else this.setColumns(column, column + 1);
  }

  private setLane(right: boolean): void {
    const lane = right ? RIGHT_LANE : LEFT_LANE;
    this.setColumns(lane[0], lane[1]);
  }

  /** Across one lane, or (with probability `full`) the whole carriageway. */
  private setAcross(roll: number, full: number, right: boolean): void {
    if (roll < full) this.setColumns(FULL_WIDTH[0], FULL_WIDTH[1]);
    else this.setLane(right);
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
  const cond = roadConditionAt(road.seed, s);
  // Banking is the cross-slope times the queried lateral: widening changes where the
  // edge is, not the banking law of a given point on the mat.
  return (
    sample.y -
    road.bankingAt(s) * lateral +
    field.displacement(s, lateral, x, z, cond.decay, cond.surface, road.halfWidthAt(s))
  );
}
