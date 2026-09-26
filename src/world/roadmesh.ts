import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { hash01, Noise1D, Noise2D } from '../core/rng';
import { SURFACES, SurfaceType } from '../core/surfaces';
import {
  ROAD_SURFACE_TINT,
  ROAD_TILE_M,
  roadAlbedoTint,
  roadMaterials,
  SHOULDER_LEVEL,
} from '../render/look/roadsurface';
import { markShelter } from '../render/rainocclusion';
import { varietyEventOfKindAt, varietyWeightAt, type VarietyEvent } from './director';
import { roadConditionAt } from './gradient';
import type { LandCover } from './landcover';
import { ROAD_HALF_WIDTH, type Road } from './road';
import { tileSurfaceSampler } from './deserttiledata';
import type { RoadDistance } from './roaddistance';
import { shoulderWidthAt } from './shoulder';
import { buildStreamCrossings } from './streamcrossings';
import { LANE_WIDTH, laneHalfWidthFor, laneOffsetFor } from './roadprofile';
import { SUB_DIVISIONS, SURFACE_STEP, SurfaceField, roadSurfaceY } from './roadsurface';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';

/**
 * The asphalt ribbon, banked into corners and displaced by a layered surface field —
 * broad undulation, wheel-scale bumps, broken edges and discrete potholes. The desert
 * terrain begins directly beneath each asphalt edge. Surface type owns ordinary bump
 * amplitude; decay increases undulation, edge breakup and pothole occurrence. The
 * same vertices feed the visible mesh and trimesh collider, so the car feels the
 * shape the driver sees.
 */

const HW = ROAD_HALF_WIDTH;

/**
 * Cross-section lateral offsets, left to right. The narrow and open templates have
 * exactly the same count, so quad strips and collider slabs cannot tear in a taper.
 * The narrow literals preserve the old ribbon bit-for-bit; the wide literals retain
 * dense wheel/edge samples and hit the outer pothole catalogue's fixed laterals.
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

function sectionLateral(halfWidth: number, column: number): number {
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
 * Longitudinal rows of quads per collider slab.
 *
 * The visible ribbon is one mesh, but its collider is built in slabs so no single
 * `RAPIER.ColliderDesc.trimesh` call — an uninterruptible native BVH build — can
 * own a frame. Fifteen rows is ~540 triangles, about a millisecond, which fits
 * inside the streaming scheduler's slice with room for the surrounding work.
 */
const COLLIDER_SLAB_QUADS = 15;
/**
 * Rendered depth of the sealed mat. The terrain overlaps the upper edge, while this
 * skirt continues well below it so low viewpoints never expose a zero-thickness sheet.
 */
const ROAD_BED_DEPTH = 0.35;

const MARKING_LIFT = 0.002;
/**
 * A painted line's half-width, metres: 16 cm across, which is GOST's 1.5 centre dash and
 * 1.2 edge line (10-15 cm) with a margin for the wear that thins them. It used to be
 * 24 cm, which reads as a hand-painted slab of a stripe from the driver's eye and was
 * twice the width of the same line in the reference frames.
 */
const MARKING_HALF_WIDTH = 0.08;
/**
 * How far inside the asphalt's edge an edge line is painted, metres.
 *
 * In the reference frames the edge line has a strip of asphalt outside it and then the
 * crumb; ours ran its outer edge along the mat's own edge, which reads as the road being
 * outlined rather than marked. 25 cm is the upper end of the 15-30 cm a rural road's edge
 * line is set in at.
 */
const MARKING_EDGE_INSET = 0.25;
const MARKING_MIN = 0.03;

/**
 * Weathering of the driving surface that the PHOTOGRAPH cannot carry.
 *
 * It used to be three things, per vertex: polished wheel paths, a dusty crown, and a
 * ravel into the verge. All three are in `road_asphalt.webp` now — the file was made
 * with wheel paths, a crown-to-edge grade and a crumb edge whose own alpha ends the mat
 * — so applying them here as well would have doubled every one of them and, worse, put
 * the wheel paths at this mesh's laterals instead of the photograph's. What is left is
 * the one thing a 24 m repeat cannot say: that this stretch of road is darker than the
 * last one. Where the district's own surface ends and the worn mat begins is the texture
 * job; how worn the DISTRICT is, is the palette's (`ROAD_SURFACE_TINT`).
 */
/**
 * The inherited polished pair is centred 0.2 m outward of each nominal lane centre:
 * it preserves the narrow road's ±0.85/±2.45 m tracks while carrying that real-world
 * camber bias into every added lane. The rubber the director lays uses it as its frame.
 */
const WHEEL_TRACK_LANE_BIAS = 0.2;
/** A 1.6 m tyre track places each path 0.8 m either side of its lane centre. */
const WHEEL_TRACK_HALF = 0.8;
/** Wavelength (m) of the coarse tonal mottling applied per vertex. */
const MOTTLE_WAVELENGTH = 7;
/** Peak brightness swing of that mottling. */
const MOTTLE_AMOUNT = 0.07;
/** Scratch for the shoulder's own vertex colour: no allocation per vertex. */
const shoulderColour = new THREE.Color();
/**
 * Width of the frayed rim the photograph ends the mat with, metres: `road_asphalt.webp`'s
 * 0.75 alpha contour sits about 1.4 % of its span inside the mesh edge, which is 8 cm of
 * a 5.8 m carriageway. Nothing is laid over that band — the asphalt is not there — so a
 * repair and a rubber mark both stop short of it.
 */
const MAT_CRUMB_M = 0.09;
/**
 * How far outside the asphalt's edge the canopy that shades the road is sampled, metres.
 * The trees stand further out than this (the planting keeps a verge); what is wanted is
 * the wood the road is running through, which is a property of the land cover here and
 * not of where a particular trunk landed.
 */
const ROAD_SHADE_REACH_M = 1.5;

/**
 * THE SIGHT RULE'S OWN NUMBERS, for the solid crown line (see `centreLineSolidAt`).
 *
 *  - `SIGHT_LIMIT_M` is how far the profile is marched: past this everything a country
 *    road does to a driver's view has already happened, and the march costs 15 road
 *    samples either way.
 *  - `SOLID_SIGHT_M` is where a stretched line gives way to a solid one. Road practice
 *    draws a solid centre line under the stopping distance for the road's speed, which
 *    for a 2-lane country road at 90 km/h is around 130-160 m of sight; 190 m is a
 *    shade generous, so a solid line means a crest or a bend and not every rise.
 *  - `CURVE_CLEARANCE_M` is the lateral clearance the chord through a bend is taken
 *    over — the verge plus the first metre of whatever stands on the inside of it.
 *  - `CURVE_CANOPY_MIN` is how much wood has to be standing on the inside for that
 *    chord to be the limit at all: a bend across an open field is seen through, and
 *    only a bend with something to hide behind is a bend you cannot read.
 *  - `SIGHT_OPEN_M` / `SIGHT_WOODS_M` are what the road's edge canopy holds the sight
 *    to: open country does not limit it, a closed wood holds it under 90 m.
 */
const SIGHT_LIMIT_M = 400;
const SOLID_SIGHT_M = 190;
const CURVE_CLEARANCE_M = 1.2;
const CURVE_CANOPY_MIN = 0.25;
const SIGHT_OPEN_M = 400;
const SIGHT_WOODS_M = 90;

/**
 * Paint wear. Nothing repaints this road, so the markings are chalky rather than white,
 * they thin out in patches, and whole dashes are simply gone.
 *
 * NEUTRAL, and that is a correction: it used to be a warm off-white (0xd9d4c6) that was
 * mixed INTO the lane's own colour, so it inherited the surface's coolness. As a layer
 * of its own over the photograph it kept the warmth and the reference frames' lines are
 * white — a road marked in cream reads as a different road.
 */
const PAINT_COLOR = 0xdee0dd;
/** Wavelength (m) over which paint coverage varies. */
const PAINT_WEAR_WAVELENGTH = 11;
/** Coverage below which a marking quad is not drawn at all. */
const PAINT_GONE = 0.34;

/**
 * SURFACE VARIETY: the four things world/director.ts is allowed to do to the asphalt.
 *
 * All four are COLOUR, on vertices that already exist. The mat's vertices ARE the
 * collider the car drives on (see the slab loop in `buildSteps`), so a feature that
 * moved one to make a picture would move the road under the wheels, and the collider
 * is indexed straight off the fixed row/column counts, so a feature that added one
 * would tear the indexing. Every number below scales a coverage which is itself
 * multiplied by `varietyWeightAt` — exactly 0 everywhere the feature is not running,
 * so off-feature the arithmetic is bit-for-bit the road that was here before it
 * (tools/surface-paint.ts carries the checksum that proves that, not an argument).
 *
 * The Surface channel runs ONE kind per window, so a patch, a skid, a marking change
 * and a sand tongue can never overlap each other: each block below has to compose
 * with the district's own weathering and with nothing else.
 */

/** Fresh bitumen: near black with the faintest warm cast. Tar, not paint. */
const PATCH_ALBEDO = new THREE.Color(0x2b2925);
/** The same colour as a VERTEX TINT: what the multiplier is for the photograph to reach it. */
const PATCH_TINT = roadAlbedoTint(PATCH_ALBEDO, new THREE.Color());
/**
 * How far a fully covered vertex goes towards it. Short of 1 deliberately: a patch is
 * a skin poured over the district's surface, and at 1 the repair read as a hole cut
 * in the road rather than a layer laid on it, because the material underneath
 * stopped showing at the rim.
 */
const PATCH_MIX = 0.62;
/** Extra multiplicative darkening at full coverage: new binder looks wet. */
const PATCH_GLOSS = 0.1;
/** Wavelength of the blob field, metres: shovel-and-rake sized repairs. */
const PATCH_BLOB_WAVELENGTH = 3.4;
/**
 * Where the blob field starts laying bitumen, and over how much of its range it
 * reaches full cover. A hard threshold put the rim wherever the 1.33 m row grid
 * happened to fall and rendered as a staircase; the soft band is also what lets the
 * district's own material read through at the edge of the repair.
 */
const PATCH_BLOB_ON = 0.06;
const PATCH_BLOB_SOFT = 0.26;
/** Half-width of a sealed crack line, how far it wanders, and over what. */
const PATCH_CRACK_HALF = 0.34;
const PATCH_CRACK_WANDER = 1.5;
const PATCH_CRACK_WAVELENGTH = 26;
/** Length of one cut-and-fill cell, metres, and the share of cells holding a repair. */
const PATCH_CUT_CELL = 9;
const PATCH_CUT_DENSITY = 0.55;
/** Hash domain for the cut-and-fill cells, distinct from every other stream here. */
const PATCH_TAG = 0x50544348; // 'PTCH'

/** Laid rubber. Blue-black, because tyre smoke is not brown. */
const RUBBER_ALBEDO = new THREE.Color(0x14130f);
const RUBBER_TINT = roadAlbedoTint(RUBBER_ALBEDO, new THREE.Color());
/** How far towards it a full-strength streak takes the surface. */
const SKID_MIX = 0.72;
/**
 * Half-width of one streak, metres. Wider than a contact patch on purpose: the
 * section columns around a wheel path are 0.35-0.45 m apart, so a tyre-width streak
 * would fall between two of them and disappear. This is the narrowest mark the mesh
 * can carry, and it is still narrower than the polished path it sits in.
 */
const SKID_HALF = 0.42;
/**
 * Distance from the mat edge over which a streak fades out, metres. Ravelled
 * aggregate at the lip holds no rubber, and a mark that ran off the asphalt would be
 * the one thing that gives away where the ribbon's edge actually is.
 */
const SKID_EDGE_FADE = 0.35;

/**
 * Sand tongues: extra reach INWARD from one shoulder, on top of whatever uniform
 * cover `roadConditionAt` already gives the district.
 *
 * Visual only, and deliberately so. `RoadCondition.sandCover` is read by the
 * autopilot's pace model (vehicle/autopilot.ts), so wiring the tongue into it would
 * slow every AI car for free — but it would slow them for the whole ROW and for both
 * sides, because sandCover has no lateral term at all. Grip is left alone for the
 * same shape of reason: the surface registry is per collider slab, and a tongue is
 * thinner than a slab is long.
 */
const TONGUE_MAX_REACH = LANE_WIDTH * 1.15;
/**
 * Drifted sand is the surface palette's own sand, as a tint (`core/surfaces.ts` is where
 * a sand's colour is decided, and physics already reads the same row for its grip). The
 * wind-blown cover this paints is dust off the verge, which is paler and warmer than
 * weathered bitumen by a great deal — and it is laid on by `sandFactor`, which is zero
 * on a road whose own decay says there is no sand to drift.
 */
const DUST_TINT = roadAlbedoTint(new THREE.Color(SURFACES[SurfaceType.Sand].color), new THREE.Color());
/**
 * Metres between tongues, and how much of a cell the tongue's own centre may wander
 * inside — so the spacing varies from about 5 m to 25 m rather than metronoming.
 *
 * A cell grid, not a noise threshold. The first attempt windowed an fbm and it is the
 * wrong instrument for a feature that MUST appear: the shortest sandTongue span the
 * director schedules is 40 m, and a threshold high enough to make a sharp finger was
 * crossed in none of those 40 m about half the time. The event fired and the road did
 * not change. One tongue per cell is a promise: even the shortest span carries two.
 */
const TONGUE_SPACING = 15;
const TONGUE_JITTER = 0.7;
/**
 * Windward nose and downwind tail of one tongue, metres. Asymmetric because drifting
 * sand is: it piles into a steep face and then feathers away for metres downwind.
 */
const TONGUE_NOSE_M = 2.5;
const TONGUE_TAIL_M = 8;
/** Hash domain for the tongue cells, distinct from every other stream here. */
const TONGUE_TAG = 0x544e4745; // 'TNGE'
/**
 * Share of the half-width a tongue may never pass. Sand reaching across A LANE is a
 * detail; sand over the crown is a road nobody can drive, and the asphalt wins.
 */
const TONGUE_MAX_SHARE = 0.95;

/** What the paint is doing at an arclength. */
const enum MarkingMode {
  /** The road's own rule, untouched. */
  Normal = 0,
  /** Two solid lines either side of the crown. */
  DoubleSolid = 1,
  /** Nothing painted at all. */
  None = 2,
  /** The normal lines, plus a rumbled band inside the edge line. */
  Rumble = 3,
  /** A chalk centre line on a road whose own rule paints none. */
  Ghost = 4,
}

/**
 * Where a marking change happens, and why it is a HARD edge and not a fade.
 *
 * Every other variety feature multiplies by `varietyWeightAt` and smoothsteps over
 * the event's ramp. Paint cannot. Coverage between 0 and 1 is already spoken for by
 * `paintNoise`: partial coverage is what WEAR looks like on this road. Fading a
 * double line up over 40 m would therefore read as "this stretch is less worn", not
 * as "the markings change here". A crew starts painting at a point and stops at one.
 *
 * So the ramp is spent differently — as the slack that lets the hard edge move to a
 * place the paint would plausibly stop, which is a dash boundary. Both cadences on
 * this road (the 4 m crown dash, the 8 m divider dash) start ON at every multiple of
 * 16 m, so snapping the span's ends to that grid puts each switch exactly where one
 * dash ends and the next would have begun, and moves it by at most 8 m: a fifth of
 * the 40 m ramp the director already set aside for this event.
 */
const MARKING_SNAP_M = 16;
/**
 * Coverage below which this road is painted in name only.
 *
 * `MARKING_MIN` lets a marking through at 0.03, but `PAINT_GONE` then throws away
 * every quad whose worn coverage lands under 0.34 — so under roughly 0.47 nothing is
 * actually drawn, whatever the gate says. Deciding the variant on MARKING_MIN put
 * double lines on two stretches that drew no paint at all: the event fired, the mode
 * changed, and the road did not (tools/surface-paint.ts measured 0% of both spans).
 */
const PAINT_EFFECTIVE = PAINT_GONE / 0.72;
/** Offset of each line of a double centre line from the crown, metres. */
const DOUBLE_SOLID_GAP = 0.17;
/** Centre of the rumble band, measured in from the mat edge, and its half-width. */
const RUMBLE_INSET = 0.52;
const RUMBLE_HALF_WIDTH = 0.22;
/** Ground-out grooves, and how far the band goes towards them. */
const RUMBLE_LINEAR = new THREE.Color(0x1d1b18);
const RUMBLE_MIX = 0.55;
/** Coverage a ghost line is painted at: above PAINT_GONE, far below a fresh coat. */
const GHOST_COVERAGE = 0.46;

/**
 * One-entry memo for the marking mode, keyed by the event's own centre. The marking
 * pass walks rows in ascending arclength, so consecutive rows inside one event hit
 * it, and the alternative was a `roadConditionAt` — two fbm fields — per row across
 * up to 800 m of every window. Deterministic: the key and the value are both pure
 * functions of the event, so a rebuilt chunk reads the same answer, memo or no memo.
 */
let markingModeAtS = Number.NaN;
let markingModeValue = MarkingMode.Normal;

/** Chalky, sun-dulled paint. Fresh white is what made the markings look printed. */
const PAINT_LINEAR = new THREE.Color(PAINT_COLOR);
/**
 * The carriageway's vertex tint for the road's start condition — what the terminus pad
 * (world/terminuspad.ts) draws its own asphalt with, so the pad and the ribbon it is
 * attached to are the same surface. `roadConditionAt(0)` is the garage's own district.
 */
export function roadAsphaltVertexColorAtStart(out: THREE.Color): THREE.Color {
  return out.copy(ROAD_SURFACE_TINT[roadConditionAt(0).surface]);
}

/** 1 inside [lo, hi], 0 outside, smoothstepped over `soft` metres at either end. */
function softBand(v: number, lo: number, hi: number, soft: number): number {
  const a = (v - lo) / soft;
  const b = (hi - v) / soft;
  const t = Math.min(1, Math.max(0, Math.min(a, b)));
  return t * t * (3 - 2 * t);
}

/**
 * Fraction of sand covering a point at |lateral| = a.
 *
 * TWO wedges, and they are shaped differently on purpose.
 *
 * The district's own `sandCover` from `roadConditionAt` is a LINEAR wedge in from both
 * edges — thin dust that thickens towards the shoulder, which is what a road that is
 * slowly losing its edges looks like. Passing `tongueReach` 0 reproduces it exactly,
 * including the no-sand case, and that is what keeps the off-feature road identical.
 *
 * The director's tongue is a DRIFT: something the wind piled up. A drift is opaque
 * over nearly all of its reach and feathers only at the very tip, so its profile is a
 * square root rather than a line. Built linear first, it measured as a 1.7 m reach
 * that only became visible over the last 0.9 m of it — a gradient across the lane
 * rather than a tongue lying on it.
 */
function sandFactor(a: number, halfWidth: number, sandCover: number, tongueReach: number): number {
  const districtTip = halfWidth * (1 - sandCover);
  let cover =
    a <= districtTip || districtTip >= halfWidth
      ? 0
      : a >= halfWidth
        ? 1
        : (a - districtTip) / (halfWidth - districtTip);
  if (tongueReach > 0) {
    const tongueTip = halfWidth - tongueReach;
    if (a > tongueTip) {
      const drift = Math.sqrt(Math.min(1, (a - tongueTip) / tongueReach));
      if (drift > cover) cover = drift;
    }
  }
  return cover;
}

interface MarkingLine {
  readonly kind: 'edge' | 'crown' | 'divider';
  readonly dashed: boolean;
}

const MARKING_LINES: readonly MarkingLine[] = [
  { kind: 'edge', dashed: false },
  { kind: 'crown', dashed: true },
  { kind: 'divider', dashed: true },
];

/**
 * Row state for the two features that need more than a weight: which repair or which
 * mark this event is, and where its geometry sits at THIS arclength. Module-level
 * scratch for the same reason `roadprofile` keeps a window scratch — a fresh object
 * per row would be one garbage allocation every 1.33 m of every chunk built.
 */
const patchRow = {
  /** 0 blob field, 1 sealed crack line, 2 squared cut-and-fill. */
  variant: 0,
  /** The director's ramp. Zero means no repair on this row at all. */
  weight: 0,
  /** Lateral centre and half-width of the crack line or the cut, metres. */
  centre: 0,
  half: 0,
  /** How much of this row the cut covers longitudinally, 0..1. */
  along: 0,
};

const skidRow = {
  /** Lateral centres of the two streaks, metres. */
  left: 0,
  right: 0,
  /** Half-width of each streak at this row, metres. */
  half: SKID_HALF,
  /** Rubber laid at this row, 0..1, the director's ramp included. */
  ink: 0,
};

/**
 * Where the pair of streaks is, and how black, at one arclength.
 *
 * All three marks use LANE 0's wheel pair as their frame. The outer lane's paths fall
 * between section columns on a widened row — its centres are +/-3.75 and +/-5.35 m
 * against columns at 3.25, 4.05, 4.85 and 5.25 — so an outer-lane mark would render
 * as a smear across two columns. Lane 0's are the +/-0.85 and +/-2.45 m columns, and
 * those exist on every row of every width, narrow or open.
 */
function skidRowAt(s: number, halfWidth: number, event: VarietyEvent, weight: number): void {
  const span = event.halfLength * 2;
  const u = Math.min(1, Math.max(0, (s - (event.s - event.halfLength)) / span));
  const lane = laneOffsetFor(halfWidth, 0) + WHEEL_TRACK_LANE_BIAS;
  let centre: number;
  let ink: number;
  let half = SKID_HALF;
  if (event.draw < 0.45) {
    // LOCK-UP. Two straight streaks that blacken as the rubber goes down and then
    // stop dead, where the car did. The director's 4 m ramp is the only softening on
    // that end, and at any speed this road is driven at, 4 m is a tenth of a second.
    centre = event.side * lane;
    ink = 0.35 + 0.65 * u * u;
  } else if (event.draw < 0.75) {
    // TURN-AROUND. The pair sweeps from one carriageway's wheel path to the other's.
    // Smoothstep rather than a straight sweep, because a car turning round lays most
    // of its rubber at the two ends of the arc and crosses the crown quickly — which
    // is also why the ink still sits in wheel paths on average (surface-paint.ts
    // measures the share). The pair straddles the centre, so even mid-arc the crown
    // itself stays clean: the streaks are 0.8 m either side of a centre passing zero.
    const t = u * u * (3 - 2 * u);
    centre = event.side * lane * (1 - 2 * t);
    ink = 0.75;
  } else {
    // BURNOUT. One place, both tyres, long enough for the car to squirm: the pair
    // wanders, and the scar is widest and blackest in the middle of the span.
    centre = event.side * lane + Math.sin(s * 0.9) * 0.22;
    ink = 4 * u * (1 - u);
    half = SKID_HALF * 1.35;
  }
  skidRow.left = centre - WHEEL_TRACK_HALF;
  skidRow.right = centre + WHEEL_TRACK_HALF;
  skidRow.half = half;
  skidRow.ink = ink * weight;
}

export class RoadMeshProvider implements ChunkProvider {
  readonly id = 'road';

  private readonly field: SurfaceField;
  /** Coarse tonal mottling of the mat, and the paint's wear pattern. */
  private readonly mottleNoise: Noise2D;
  private readonly paintNoise: Noise1D;
  /**
   * Shape of a bitumen repair. Its own stream: driving it off `mottleNoise` would put
   * every patch exactly where the mat is already dark, which reads as the mottling
   * getting stronger rather than as somebody having repaired something.
   */
  private readonly patchNoise: Noise2D;
  /** The world seed. The director is asked per row and per marking quad. */
  private readonly seed: number;
  /**
   * The road and the land cover of the chunk being built, for the sight rule below.
   * Set on entry to `buildSteps` rather than held as a reference: a provider outlives
   * the world it was made for (the road lab builds one per run), and a stale land cover
   * would answer with the wrong country's woods.
   */
  private road: Road | null = null;
  private cover: LandCover | null = null;
  /** Memo for `centreLineSolidAt`: the cell and the answer it produced. */
  private solidAtCell = Number.NaN;
  private solidAtValue = false;
  private readonly sightPoint = { x: 0, y: 0, z: 0 };

  /**
   * `roadDistance` lets the bare shoulder find the ground as the tiles draw it; without
   * it (the labs) there is no shoulder.
   */
  constructor(seed: number, private readonly roadDistance: RoadDistance | null = null) {
    this.seed = seed;
    this.field = new SurfaceField(seed);
    this.mottleNoise = new Noise2D(seed ^ 0x5bf03635);
    this.paintNoise = new Noise1D(seed ^ 0x2545f491);
    this.patchNoise = new Noise2D(seed ^ 0x1f9a3c77);
  }

  build(ctx: ChunkContext): ChunkContent | null {
    const iterator = this.buildSteps(ctx);
    let result = iterator.next();
    while (!result.done) result = iterator.next();
    return result.value;
  }

  /**
   * The bare shoulder either side (world/shoulder.ts): a compacted ramp from the
   * asphalt's edge down onto the ground, tucked under it at its outer edge.
   *
   * THE GROUND BESIDE THE ROAD IS NOT WHERE THE TERRAIN FUNCTION SAYS. The tiles are
   * sunk 10 cm under the corridor (world/deserttiledata.ts `sampleGroundHeight`) and
   * drawn from a 3 m lattice, so between their nodes the ground is a plane, not the
   * function. Laid on the function, the strip floated up to 15 cm over the grass, with
   * an inked rim along it and a wheel sinking through it. So it is laid on the tiles'
   * own triangles (`visibleGroundY`), it has a collider, and its last column goes
   * 4 cm under the ground so the grass cuts its edge.
   */
  private buildShoulder(ctx: ChunkContext, positions: Float32Array, roadShade: Float32Array, sCount: number, latCount: number): { mesh: THREE.Mesh; vertices: Float32Array; indices: Uint32Array } {
    const { sStart, road } = ctx;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const COLS = 4;
    const ACROSS = [0, 0.3, 0.65, 1];
    const verts = sCount * 2 * COLS;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    // The canopy density at this side of the verge: the shade the strip is lit in, and
    // the reason a wooded shoulder is dark while a field one is not.
    const shade = new Float32Array(verts);
    const index = new Uint32Array((sCount - 1) * 2 * (COLS - 1) * 6);
    const p = new THREE.Vector3();
    const ground = tileSurfaceSampler({ seed: this.seed, road: ctx.road, terrain: ctx.terrain, roadDistance: this.roadDistance! });
    let w = 0;
    for (let si = 0; si < sCount; si++) {
      const s = sStart + si * SURFACE_STEP;
      const halfWidth = road.halfWidthAt(s);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        // Ragged where the grass meets it: a jitter per row on top of the slow wander.
        const width = shoulderWidthAt(s, sign) + (hash01(this.seed, 0x5d, si + Math.round(sStart / SURFACE_STEP), side) - 0.5) * 0.3;
        // The asphalt's own outermost vertex: the strip starts exactly on its edge.
        const edge = (si * latCount + (side === 0 ? 0 : latCount - 1)) * 3;
        const edgeY = positions[edge + 1]!;
        const edgeGround = ground(positions[edge]! + ox, positions[edge + 2]! + oz);
        for (let c = 0; c < COLS; c++) {
          const t = ACROSS[c]!;
          const vi = (si * 2 + side) * COLS + c;
          if (c === 0) {
            pos[vi * 3] = positions[edge]!;
            pos[vi * 3 + 1] = edgeY - 0.004;
            pos[vi * 3 + 2] = positions[edge + 2]!;
          } else {
            road.offsetPoint(s, sign * (halfWidth + width * t), p);
            const g = ground(p.x, p.z);
            // Down from the asphalt's edge to 2.5 cm over the ground by two thirds of the
            // way, then under it.
            const ramp = Math.max(0, 1 - t / 0.65);
            pos[vi * 3] = p.x - ox;
            pos[vi * 3 + 1] = c === COLS - 1 ? g - 0.04 : g + 0.025 + (edgeY - edgeGround - 0.025) * ramp * ramp;
            pos[vi * 3 + 2] = p.z - oz;
          }
          // The strip's own level and mottle, darkening slightly outward where the
          // grass roots start. The colour itself is the palette's gravel tint and the
          // photograph is the ground's own (render/look/roadsurface.ts), so this number
          // is only how trodden THIS metre of verge is.
          const mottle = 0.5 + 0.5 * this.mottleNoise.at(s / 3.1 + sign * 17, t * 1.3);
          shoulderColour.setScalar(SHOULDER_LEVEL * (0.88 + 0.24 * mottle) * (1 - 0.08 * t));
          shade[vi] = roadShade[si * 2 + (sign > 0 ? 1 : 0)]!;
          col[vi * 3] = shoulderColour.r;
          col[vi * 3 + 1] = shoulderColour.g;
          col[vi * 3 + 2] = shoulderColour.b;
        }
      }
    }
    for (let si = 0; si < sCount - 1; si++) {
      for (let side = 0; side < 2; side++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = (si * 2 + side) * COLS + c;
          const b = ((si + 1) * 2 + side) * COLS + c;
          index.set([a, b, a + 1, a + 1, b, b + 1], w);
          w += 6;
        }
      }
    }
    // Wind every triangle to face up: which way a row runs depends on the road's side.
    for (let t = 0; t < w; t += 3) {
      const i0 = index[t]! * 3;
      const i1 = index[t + 1]! * 3;
      const i2 = index[t + 2]! * 3;
      const ux = pos[i1]! - pos[i0]!;
      const uz = pos[i1 + 2]! - pos[i0 + 2]!;
      const vx = pos[i2]! - pos[i0]!;
      const vz = pos[i2 + 2]! - pos[i0 + 2]!;
      // y of (u x v); counter-clockwise seen from above is up-facing.
      if (uz * vx - ux * vz < 0) {
        const keep = index[t + 1]!;
        index[t + 1] = index[t + 2]!;
        index[t + 2] = keep;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aRoadShade', new THREE.BufferAttribute(shade, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // Lit straight up, as the road and the ground beside it are: a strip lit by its own
    // slope read as a stripe.
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geometry, roadMaterials().shoulder);
    mesh.receiveShadow = true;
    return { mesh, vertices: pos, indices: index };
  }


  *buildSteps(ctx: ChunkContext): Iterator<void, ChunkContent | null> {
    const { sStart, sEnd, road, physics, hasPhysics } = ctx;
    if (sEnd <= sStart) return null;
    this.road = road;
    // Absent in the benches that build the ribbon without a world (`tools/*.ts`): there
    // is then no land cover to ask, and both the shade and the sight rule fall back to
    // what they can still answer — the road's own profile.
    this.cover = ctx.terrain?.cover ?? null;
    // The floating origin, frozen at build time. Sampling stays absolute — the road
    // surface's 2D bump noise is a function of world position — and the subtraction
    // happens only where a coordinate is about to live in f32.
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const latCount = SECTION_LATERALS.length;
    // One surface type per chunk drives the collider friction profile. Visual colour
    // is sampled per row below because a material-district boundary can cross a chunk.
    const surface = roadConditionAt((sStart + sEnd) / 2).surface;

    const sCount = Math.round((sEnd - sStart) / SURFACE_STEP) + 1;
    const vertexCount = sCount * latCount;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    // The corridor's own per-vertex block (render/look/roadsurface.ts):
    // (canopy shade at this side, unsealed district, wear).
    const look = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array((sCount - 1) * (latCount - 1) * 6);

    // THE CANOPY AT THE ROAD'S EDGE, per row and per side.
    //
    // This is slowroads' `shadowLeft/Right` annotation (SrRoad §6), computed the way
    // stage 2 computes every other ground attribute: from the land cover's own wood
    // density at a point — the SAME field the tiles read for their forest floor and
    // their baked shade — rather than from a shadow map, which never reaches far enough
    // down a country road to dim it. It is what makes a forest road dark under its own
    // trees, and it is what gates the autumn litter and the spring moss on the mat.
    const roadShade = new Float32Array(sCount * 2);
    if (this.cover) {
      const cover = this.cover;
      const p = { x: 0, y: 0, z: 0 };
      // Side 0 (the even slots) is the negative-lateral edge, side 1 the positive one:
      // the same pairing `buildShoulder` walks with its own `side` index.
      for (let si = 0; si < sCount; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const reach = road.halfWidthAt(s) + ROAD_SHADE_REACH_M;
        road.offsetPoint(s, -reach, p);
        roadShade[si * 2] = cover.forestAt(p.x, p.z, reach);
        road.offsetPoint(s, reach, p);
        roadShade[si * 2 + 1] = cover.forestAt(p.x, p.z, reach);
      }
    }

    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const disposables: THREE.BufferGeometry[] = [];
    let completed = false;

    try {
      const point = { x: 0, y: 0, z: 0 };
      const color = new THREE.Color();
      // Keep texture coordinates close to zero before they enter Float32. Using
      // absolute `s / tile` loses the fractional UV at long-distance road positions:
      // the aggregate then advances in visible blocks as the camera moves, which looks
      // exactly like heat haze on high-contrast gravel. The modulo preserves the
      // world-space tile phase; the local delta remains continuous through this chunk.
      const textureVStart =
        (((sStart % ROAD_TILE_M) + ROAD_TILE_M) % ROAD_TILE_M) / ROAD_TILE_M;

      for (let si = 0; si < sCount; si++) {
        // Endpoint-exact rows: si * (sEnd - sStart) / (sCount - 1) makes the shared
        // boundary row bit-identical in both neighbours, keeping the seam watertight
        // at the denser resolution.
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        // Every consumer of this row gets this one local width. In particular the
        // collider is indexed from these same fixed-count rows as the visible mat.
        const halfWidth = road.halfWidthAt(s);
        const cond = roadConditionAt(s);
        // The district's own surface tint, and how much of this row is unsealed: both
        // are functions of arclength alone, so neighbouring chunks share the seam row.
        const tint = ROAD_SURFACE_TINT[cond.surface];
        const unsealed = cond.surface === SurfaceType.Gravel ? 1 : 0;
        const shadeLow = roadShade[si * 2]!;
        const shadeHigh = roadShade[si * 2 + 1]!;

        // The director's surface features, resolved once for the whole row. Three
        // probes rather than three searches: these kinds share the Surface channel,
        // so at most one of them can be live here, and each call is a memo hit on
        // the window the previous row already looked up. Everything that depends on
        // `s` alone finishes here; the column loop does distance arithmetic only.
        const patchEvent = varietyEventOfKindAt(this.seed, 'patches', s);
        if (patchEvent) {
          this.patchRowAt(s, halfWidth, patchEvent, varietyWeightAt(this.seed, 'patches', s));
        } else {
          patchRow.weight = 0;
        }
        const skidEvent = varietyEventOfKindAt(this.seed, 'skid', s);
        if (skidEvent) {
          skidRowAt(s, halfWidth, skidEvent, varietyWeightAt(this.seed, 'skid', s));
        } else {
          skidRow.ink = 0;
        }
        const tongueEvent = varietyEventOfKindAt(this.seed, 'sandTongue', s);
        const tongueReach = tongueEvent
          ? this.tongueReachAt(s, halfWidth, tongueEvent.draw) *
            varietyWeightAt(this.seed, 'sandTongue', s)
          : 0;
        const tongueSide = tongueEvent ? tongueEvent.side : 0;

        for (let li = 0; li < latCount; li++) {
          const lateral = sectionLateral(halfWidth, li);
          road.offsetPoint(s, lateral, point);
          // Shared height function: the desert terrain adopts this exact surface at
          // the asphalt edge, so the two meshes stay flush.
          const y = roadSurfaceY(road, this.field, s, lateral, point.x, point.z);

          const vi = si * latCount + li;
          positions[vi * 3] = point.x - ox;
          positions[vi * 3 + 1] = y;
          positions[vi * 3 + 2] = point.z - oz;

          // u runs ACROSS the carriageway, 0 at one edge and 1 at the other, so the
          // photograph's ragged rim — and both overlays', which share its layout —
          // lands exactly on the mat's edge at every width. A widened road therefore
          // stretches the aggregate by the same few per cent rather than gaining a
          // second rim and a hole in the middle of the surface.
          uvs[vi * 2] = 0.5 + lateral / (2 * halfWidth);
          uvs[vi * 2 + 1] = textureVStart + (s - sStart) / ROAD_TILE_M;
          // The two edges' canopies meet under the crown: a road running between a wood
          // and a field is shaded from the wood's side first, and by the middle of the
          // carriageway it is under the wood.
          const shadeMix = Math.min(1, Math.max(0, (lateral + 1.2) / 2.4));
          look[vi * 3] = shadeLow + (shadeHigh - shadeLow) * shadeMix;
          look[vi * 3 + 1] = unsealed;
          look[vi * 3 + 2] = cond.decay;

          const a = Math.abs(lateral);
          color.copy(tint);
          // One shoulder only: `side` is the windward one, and the other side keeps
          // the district's own uniform cover with nothing added.
          const drift = sandFactor(a, halfWidth, cond.sandCover, lateral * tongueSide > 0 ? tongueReach : 0);
          if (drift > 0) color.lerp(DUST_TINT, drift);
          this.weather(color, s, lateral, cond.decay);
          // Repair and rubber go on AFTER the weathering, in the order the road got
          // them: the district wears, then somebody patches it, then somebody locks
          // a wheel up on the patch.
          if (patchRow.weight > 0) {
            const coverage = this.patchCoverageAt(s, lateral, a, halfWidth);
            if (coverage > 0) {
              color.lerp(PATCH_TINT, coverage * PATCH_MIX);
              color.multiplyScalar(1 - coverage * PATCH_GLOSS);
            }
          }
          if (skidRow.ink > 0) {
            const d = Math.min(
              Math.abs(lateral - skidRow.left),
              Math.abs(lateral - skidRow.right),
            );
            if (d < skidRow.half) {
              const t = 1 - d / skidRow.half;
              const edge = Math.min(1, (halfWidth - a) / SKID_EDGE_FADE);
              if (edge > 0) {
                color.lerp(RUBBER_TINT, skidRow.ink * t * t * (3 - 2 * t) * edge * SKID_MIX);
              }
            }
          }
          colors[vi * 3] = color.r;
          colors[vi * 3 + 1] = color.g;
          colors[vi * 3 + 2] = color.b;
        }
        yield;
      }

      let ii = 0;
      for (let si = 0; si < sCount - 1; si++) {
        for (let li = 0; li < latCount - 1; li++) {
          const a = si * latCount + li;
          const b = a + latCount;
          const c = a + 1;
          const d = b + 1;
          indices[ii++] = a;
          indices[ii++] = b;
          indices[ii++] = c;
          indices[ii++] = b;
          indices[ii++] = d;
          indices[ii++] = c;
        }
        yield;
      }

      const geometry = new THREE.BufferGeometry();
      disposables.push(geometry);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('aRoadLook', new THREE.BufferAttribute(look, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      // The road uses the same upward lighting basis as the desert. Actual slope
      // normals made it read as a dark shadow strip on grades.
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

      const roadMesh = new THREE.Mesh(geometry, roadMaterials().road);
      // The whole asphalt surface receives the same vehicle contact shadow as the
      // surrounding desert without casting into the map.
      roadMesh.receiveShadow = true;
      group.add(roadMesh);

      // Close both open edges down into the terrain. This is deliberately visual-only:
      // tyres still collide with the exact top ribbon, and the skirt remains buried
      // wherever the sand meets the asphalt at its intended height.
      const bedPositions = new Float32Array(sCount * 4 * 3);
      const bedIndices = new Uint32Array((sCount - 1) * 12);
      for (let si = 0; si < sCount; si++) {
        const rightTop = si * latCount;
        const leftTop = rightTop + latCount - 1;
        const row = si * 12;

        bedPositions[row] = positions[rightTop * 3]!;
        bedPositions[row + 1] = positions[rightTop * 3 + 1]!;
        bedPositions[row + 2] = positions[rightTop * 3 + 2]!;
        bedPositions[row + 3] = bedPositions[row]!;
        bedPositions[row + 4] = bedPositions[row + 1]! - ROAD_BED_DEPTH;
        bedPositions[row + 5] = bedPositions[row + 2]!;

        bedPositions[row + 6] = positions[leftTop * 3]!;
        bedPositions[row + 7] = positions[leftTop * 3 + 1]!;
        bedPositions[row + 8] = positions[leftTop * 3 + 2]!;
        bedPositions[row + 9] = bedPositions[row + 6]!;
        bedPositions[row + 10] = bedPositions[row + 7]! - ROAD_BED_DEPTH;
        bedPositions[row + 11] = bedPositions[row + 8]!;
      }
      let bi = 0;
      for (let si = 0; si < sCount - 1; si++) {
        const row = si * 4;
        const next = row + 4;
        // Negative-lateral edge: outward normal points right.
        bedIndices[bi++] = row;
        bedIndices[bi++] = row + 1;
        bedIndices[bi++] = next;
        bedIndices[bi++] = next;
        bedIndices[bi++] = row + 1;
        bedIndices[bi++] = next + 1;
        // Positive-lateral edge: outward normal points left.
        bedIndices[bi++] = row + 2;
        bedIndices[bi++] = next + 2;
        bedIndices[bi++] = row + 3;
        bedIndices[bi++] = next + 2;
        bedIndices[bi++] = next + 3;
        bedIndices[bi++] = row + 3;
      }
      const bedGeometry = new THREE.BufferGeometry();
      disposables.push(bedGeometry);
      bedGeometry.setAttribute('position', new THREE.BufferAttribute(bedPositions, 3));
      bedGeometry.setIndex(new THREE.BufferAttribute(bedIndices, 1));
      bedGeometry.computeVertexNormals();
      const bedMesh = new THREE.Mesh(bedGeometry, roadMaterials().bed);
      bedMesh.receiveShadow = true;
      group.add(bedMesh);
      if (this.roadDistance) {
        const shoulder = this.buildShoulder(ctx, positions, roadShade, sCount, latCount);
        disposables.push(shoulder.mesh.geometry);
        group.add(shoulder.mesh);
        // Solid: the wheels ride the strip they see, not the sunk ground under it.
        if (hasPhysics) {
          const collider = physics.addStaticTrimesh(shoulder.vertices, shoulder.indices, SurfaceType.Gravel);
          collider.setEnabled(false);
          colliders.push(collider);
          const body = collider.parent();
          if (body) bodies.push(body);
        }
      }
      // Bridges and culverts (world/streamcrossings.ts): the structure the ground half
      // of the crossing leaves to be built. One merged geometry for the whole chunk,
      // and only on the chunks that stand over water.
      const crossings = buildStreamCrossings(road, this.field, sStart, sEnd, ox, oz);
      if (crossings) {
        disposables.push(crossings.geometry);
        const crossingMesh = new THREE.Mesh(crossings.geometry, roadMaterials().crossing);
        crossingMesh.receiveShadow = true;
        // A deck and its parapets are a roof over the water: rain and snow stop at them
        // (render/rainocclusion.ts), which is what standing under a bridge should be.
        markShelter(crossingMesh);
        group.add(crossingMesh);
        // The parapets are solid and nothing else is: a car that leaves the road on a
        // bridge hits a wall, and a culvert's headwall is eight metres out in the verge
        // where nothing is expected to arrive at speed anyway.
        if (hasPhysics && crossings.solidIndices.length > 0) {
          const collider = physics.addStaticTrimesh(crossings.solidVertices, crossings.solidIndices, SurfaceType.Concrete);
          collider.setEnabled(false);
          colliders.push(collider);
          const body = collider.parent();
          if (body) bodies.push(body);
        }
      }
      yield;

      if (hasPhysics) {
        // ONE TRIMESH PER SLAB, not one per chunk. Rapier builds a BVH inside
        // `trimesh`, and for a whole 200 m chunk (5400 triangles) that is a single
        // 10-50 ms native call no generator yield can interrupt — measured as the
        // last remaining streaming hitch. Row slabs are the same vertices in the
        // same order, so the collided surface is bit-identical; adjacent slabs share
        // their boundary row, so there is no seam to fall through.
        //
        // `positions` is already origin-relative (subtracted at the write site
        // above); subtracting again here would double-apply the offset and drop the
        // collider a whole chunk's origin away from the mesh.
        for (let q0 = 0; q0 < sCount - 1; q0 += COLLIDER_SLAB_QUADS) {
          const q1 = Math.min(q0 + COLLIDER_SLAB_QUADS, sCount - 1);
          const slabVertices = positions.subarray(q0 * latCount * 3, (q1 + 1) * latCount * 3);
          const slabIndices = new Uint32Array((q1 - q0) * (latCount - 1) * 6);
          let si2 = 0;
          for (let si = q0; si < q1; si++) {
            for (let li = 0; li < latCount - 1; li++) {
              const a = (si - q0) * latCount + li;
              const b = a + latCount;
              const c = a + 1;
              const d = b + 1;
              slabIndices[si2++] = a;
              slabIndices[si2++] = b;
              slabIndices[si2++] = c;
              slabIndices[si2++] = b;
              slabIndices[si2++] = d;
              slabIndices[si2++] = c;
            }
          }
          const collider = physics.addStaticTrimesh(slabVertices, slabIndices, surface);
          collider.setEnabled(false);
          colliders.push(collider);
          const body = collider.parent();
          if (body) bodies.push(body);
          yield;
        }
      }

      const markings = yield* this.buildMarkingsSteps(ctx, roadShade, sCount);
      if (markings) {
        disposables.push(markings.geometry);
        group.add(markings);
      }
      yield;

      // The trimeshes are created disabled and switched on by ChunkStreamer once the
      // whole contribution is attached (see ChunkContent.colliders).
      completed = true;
      return {
        group,
        bodies,
        colliders,
        dispose: () => {
          for (const g of disposables) g.dispose();
        },
      };
    } finally {
      if (!completed) {
        for (const body of bodies) physics.removeBody(body);
        for (const g of disposables) g.dispose();
        group.removeFromParent();
        group.clear();
      }
    }
  }

  /**
   * The one thing the tiled photograph cannot say: that THIS stretch of road is greyer,
   * dirtier or darker than the last one.
   *
   * A 24 m photograph repeated forty thousand times is, at any distance, one surface —
   * and the district's own decay already changes the tint between districts. This is the
   * third scale, coarse tonal mottling at a wavelength several times the tile, so the
   * repetition never lines up with anything the eye can hold on to. It is multiplied in
   * as a TINT now rather than painted as an albedo: the photograph decides what the
   * surface looks like, and this decides how washed it is.
   */
  private weather(color: THREE.Color, s: number, lateral: number, decay: number): void {
    const mottle = this.mottleNoise.fbm(
      s / MOTTLE_WAVELENGTH,
      lateral / MOTTLE_WAVELENGTH,
      2,
      2.1,
      0.5,
    );
    color.multiplyScalar(1 + mottle * MOTTLE_AMOUNT * (0.7 + decay));
  }

  /**
   * Picks which repair this patching event is, and resolves everything about it that
   * depends on arclength alone. Called once per row; `patchCoverageAt` reads the
   * result across the row's fifteen columns.
   *
   * The three variants are the mix a maintained-then-abandoned road shows: most
   * repairs are a shovel and a rake, crack sealing is the next most common, and a
   * squared cut-and-fill is the rare one somebody was paid properly for.
   */
  private patchRowAt(s: number, halfWidth: number, event: VarietyEvent, weight: number): void {
    patchRow.weight = weight;
    patchRow.variant = event.draw < 0.44 ? 0 : event.draw < 0.76 ? 1 : 2;
    patchRow.along = 1;
    if (patchRow.variant === 1) {
      // A sealed crack wanders about the lane it started in. It does not run down
      // the crown, because a crack THERE is the joint between the two pours, and
      // sealing the joint is a different, straighter job than sealing a crack.
      //
      // Clamped to the mat, and that clamp is load-bearing: unclamped, the wander
      // took the line up to 3.15 m out on a 2.9 m half-width, where the repair's own
      // edge taper faded it to nothing — a crack-sealing event that darkened its
      // lane by 0.46% against 15% for a blob repair, i.e. an event that fired and
      // showed nothing (tools/surface-paint.ts, seed 7).
      const lane = laneOffsetFor(halfWidth, 0) + WHEEL_TRACK_LANE_BIAS;
      const wander =
        this.patchNoise.fbm(s / PATCH_CRACK_WAVELENGTH, 17.3, 2, 2.1, 0.5) * PATCH_CRACK_WANDER;
      const outermost = halfWidth - PATCH_CRACK_HALF - MAT_CRUMB_M;
      patchRow.centre =
        event.side * Math.min(outermost, Math.max(PATCH_CRACK_HALF + 0.1, lane + wander));
      patchRow.half = PATCH_CRACK_HALF;
      return;
    }
    if (patchRow.variant === 2) {
      // Cut-and-fill: rectangles squared to the road frame, about half the cells
      // used. The cell index comes off ABSOLUTE arclength, never off the event's own
      // start, so a rebuilt chunk lays the same rectangles in the same places.
      const cell = Math.floor(s / PATCH_CUT_CELL);
      if (hash01(PATCH_TAG, cell, this.seed) >= PATCH_CUT_DENSITY) {
        patchRow.along = 0;
        return;
      }
      // A repair is dug out lane-wide, so the rectangle is sized and centred off a
      // real lane: that keeps it on the asphalt at every width, through a taper.
      const band = hash01(PATCH_TAG ^ 0x11, cell, this.seed);
      const lane = halfWidth > HW + 0.5 && band < 0.4 ? 1 : 0;
      patchRow.centre = event.side * laneOffsetFor(halfWidth, lane);
      patchRow.half = laneHalfWidthFor(halfWidth, lane) * (0.5 + 0.45 * band);
      // Squared ends too, but softened over one row: the 1.33 m grid cannot place a
      // true step, and an unsoftened one aliases along the row it lands on.
      const length = PATCH_CUT_CELL * (0.35 + 0.45 * hash01(PATCH_TAG ^ 0x22, cell, this.seed));
      const centreS = (cell + 0.5) * PATCH_CUT_CELL;
      patchRow.along = softBand(s, centreS - length * 0.5, centreS + length * 0.5, SURFACE_STEP);
      return;
    }
    patchRow.centre = 0;
    patchRow.half = 0;
  }

  /** How much bitumen covers one vertex, 0..1, ramp included. */
  private patchCoverageAt(s: number, lateral: number, a: number, halfWidth: number): number {
    let coverage: number;
    if (patchRow.variant === 0) {
      // The only per-VERTEX noise the features add, and it is paid for only inside a
      // patching event — at most 220 m of every 1500 m window, and only when that
      // window drew 'patches' at all.
      const n = this.patchNoise.fbm(
        s / PATCH_BLOB_WAVELENGTH,
        lateral / PATCH_BLOB_WAVELENGTH,
        2,
        2.1,
        0.5,
      );
      const t = (n - PATCH_BLOB_ON) / PATCH_BLOB_SOFT;
      if (t <= 0) return 0;
      coverage = t >= 1 ? 1 : t * t * (3 - 2 * t);
    } else {
      if (patchRow.along <= 0) return 0;
      coverage =
        softBand(
          lateral,
          patchRow.centre - patchRow.half,
          patchRow.centre + patchRow.half,
          patchRow.variant === 1 ? PATCH_CRACK_HALF : SURFACE_STEP,
        ) * patchRow.along;
      if (coverage <= 0) return 0;
    }
    // The rim the photograph ends the mat with is already crumbling into the gravel.
    // Bitumen laid over it would restore the hard visual line that crumb exists to
    // break, so the repair stops short of it — which is also where a real one stops,
    // because there is nothing solid out there to lay it on.
    const edge = (halfWidth - a) / MAT_CRUMB_M;
    if (edge < 1) coverage *= Math.max(0, edge);
    return coverage * patchRow.weight;
  }

  /**
   * Metres of extra sand reach at this arclength, before the director's ramp.
   *
   * Separate fingers with bare asphalt between them, one per TONGUE_SPACING cell.
   * Two cells are examined, not one, because a tail is longer than a cell: the tongue
   * upwind of this one can still be feathering across here.
   *
   * The cell index comes off ABSOLUTE arclength, so a rebuilt chunk puts the same
   * tongues in the same places — which is the whole reason this is a hash grid and
   * not anything that accumulates along the road.
   */
  private tongueReachAt(s: number, halfWidth: number, draw: number): number {
    const cell = Math.floor(s / TONGUE_SPACING);
    let strongest = 0;
    for (let k = cell - 1; k <= cell; k++) {
      const centre =
        (k + 0.15 + TONGUE_JITTER * hash01(TONGUE_TAG, k, this.seed)) * TONGUE_SPACING;
      const d = s - centre;
      const profile = d < 0 ? 1 + d / TONGUE_NOSE_M : 1 - d / TONGUE_TAIL_M;
      if (profile <= 0) continue;
      const shaped =
        profile * profile * (3 - 2 * profile) *
        (0.55 + 0.45 * hash01(TONGUE_TAG ^ 0x11, k, this.seed));
      if (shaped > strongest) strongest = shaped;
    }
    if (strongest <= 0) return 0;
    return Math.min(
      halfWidth * TONGUE_MAX_SHARE,
      TONGUE_MAX_REACH * (0.55 + 0.45 * draw) * strongest,
    );
  }

  /**
   * What the paint does at this arclength. See MARKING_SNAP_M for why the ends are
   * hard edges snapped to a dash boundary instead of the usual ramp.
   */
  /**
   * Whether the crown line is SOLID at this arclength, because there is no sight
   * through the road here.
   *
   * This is the notes' rule (SrRoad §3): a centre line goes solid where a driver cannot
   * see far enough to overtake, which road engineering states as a sight distance and
   * slowroads computes from the turn, the canopy, the lateral gradient and the crests.
   * This world already has the whole of it:
   *
   *   - the road's own available sight distance (`road.sightDistanceAt`), which marches
   *     the vertical profile at eye and object height — the crests;
   *   - the CURVATURE, turned into the chord a bend of that radius allows across
   *     `CURVE_CLEARANCE_M` of clearance — but only where something is standing on the
   *     inside of the bend to hide behind, which is the canopy;
   *   - the canopy at the road's edge, which closes the view even where the profile is
   *     open — a forest road is short-sighted by nature.
   *
   * Decided once per `MARKING_SNAP_M` cell, not per row, and therefore held for 16 m at
   * a time: a rule evaluated per 1.33 m row would flicker between dash and solid
   * wherever the sight distance sat on the threshold, and paint does not do that. The
   * cell is keyed off absolute arclength and memoised, so a rebuilt chunk and its
   * neighbours agree.
   */
  private centreLineSolidAt(s: number): boolean {
    const cell = Math.floor(s / MARKING_SNAP_M);
    if (cell === this.solidAtCell) return this.solidAtValue;
    this.solidAtCell = cell;
    const centre = (cell + 0.5) * MARKING_SNAP_M;
    const road = this.road!;
    let sight = Math.min(
      road.sightDistanceAt(centre, SIGHT_LIMIT_M, 1),
      road.sightDistanceAt(centre, SIGHT_LIMIT_M, -1),
    );
    const cover = this.cover;
    const halfWidth = road.halfWidthAt(centre);
    const reach = halfWidth + ROAD_SHADE_REACH_M;
    const p = this.sightPoint;
    let canopy = 0;
    if (cover) {
      road.offsetPoint(centre, -reach, p);
      canopy = cover.forestAt(p.x, p.z, reach);
      road.offsetPoint(centre, reach, p);
      canopy = Math.max(canopy, cover.forestAt(p.x, p.z, reach));
    }
    const curvature = Math.abs(road.curvatureAt(centre));
    if (canopy > CURVE_CANOPY_MIN && curvature > 1e-5) {
      // The chord through a bend of radius 1/κ with `m` of clearance on the inside:
      // what a driver can see across the corner rather than around it.
      sight = Math.min(sight, Math.sqrt((CURVE_CLEARANCE_M * 8) / curvature));
    }
    sight = Math.min(sight, SIGHT_OPEN_M + (SIGHT_WOODS_M - SIGHT_OPEN_M) * Math.min(1, canopy * 1.6));
    this.solidAtValue = sight < SOLID_SIGHT_M;
    return this.solidAtValue;
  }

  private markingModeAt(s: number): MarkingMode {
    const event = varietyEventOfKindAt(this.seed, 'markings', s);
    if (!event) return MarkingMode.Normal;
    const from = Math.round((event.s - event.halfLength) / MARKING_SNAP_M) * MARKING_SNAP_M;
    const to = Math.round((event.s + event.halfLength) / MARKING_SNAP_M) * MARKING_SNAP_M;
    if (s < from || s >= to) return MarkingMode.Normal;
    if (markingModeAtS !== event.s) {
      markingModeAtS = event.s;
      // A road with no paint on it cannot change its markings, and an event that
      // fires and shows nothing makes the director's cadence a lie. So on an
      // unpainted stretch the event runs the other way and puts a line BACK: the
      // chalk ghost of the seal this gravel used to be, or the one coat somebody came
      // out and laid. Either one is a change where the director promised one.
      //
      // Decided ONCE, at the event's centre, and deliberately not per row: decay
      // drifts across an 800 m span, so a per-row decision let the paint flip between
      // variants several times inside a single event — several boundaries where the
      // feature promises exactly one. Measured as 53% of a 'none' span with 217 m of
      // slop at its edge (tools/surface-paint.ts).
      markingModeValue =
        roadConditionAt(event.s).markings < PAINT_EFFECTIVE
          ? MarkingMode.Ghost
          : event.draw < 0.34
            ? MarkingMode.DoubleSolid
            : event.draw < 0.67
              ? MarkingMode.None
              : MarkingMode.Rumble;
    }
    return markingModeValue;
  }

  private *buildMarkingsSteps(
    ctx: ChunkContext,
    roadShade: Float32Array,
    sCount: number,
  ): Generator<void, THREE.Mesh | null> {
    const { road, sStart, sEnd, originX: ox, originZ: oz } = ctx;
    let geometry: THREE.BufferGeometry | null = null;
    let completed = false;

    try {
      const positions: number[] = [];
      const colors: number[] = [];
      const shades: number[] = [];
      const point = { x: 0, y: 0, z: 0 };
      const color = new THREE.Color();

      // Marking quads are emitted per surface step so their corners coincide with
      // mesh vertices rather than floating across a bump or pothole.
      for (let si = 0; si < sCount - 1; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const s1 = s + SURFACE_STEP;
        const condition = roadConditionAt(s);
        // A line's own albedo is the paint, and its COVERAGE is the vertex alpha: the
        // coat thins until the aggregate shows through it, which is what worn paint is.
        // The road under it is already drawn, so the alpha blends rather than cuts.
        const mode = this.markingModeAt(s);
        // The crown line is SOLID where a driver cannot see far enough to pass
        // (`centreLineSolidAt`): the road's own rule, from the notes, and this world has
        // the data for it — the road's own sight distance, its curvature and the canopy
        // at its edge, all of them already sampled for the road itself.
        //
        // ONLY ON A STRETCH THE DIRECTOR HAS NOT RE-MARKED. An event is somebody coming
        // out and painting this stretch, and what they painted is the whole mark on it;
        // letting the road's own rule also draw there would put a second, contradictory
        // line inside a span whose one job is to be a pattern of its own.
        const solidCentre = mode === MarkingMode.Normal && this.centreLineSolidAt(s);
        const halfWidth0 = road.halfWidthAt(s);
        const halfWidth1 = road.halfWidthAt(s1);
        // The paint is under the same canopy the road is, so it is lit in the same
        // shade: a bright line through a dark wood was the one thing that gave away
        // that the shade was baked rather than cast.
        const shade = Math.max(roadShade[si * 2]!, roadShade[si * 2 + 1]!);
        // Wear: how much of a coat is left at this arclength and this lateral. The
        // wavelength is longer than the 4 m dash so a line thins along its length in
        // patches rather than dash by dash.
        const wearAt = (lateral: number): number => this.paintNoise.fbm(
          (s + lateral * 130) / PAINT_WEAR_WAVELENGTH,
          2,
          2.3,
          0.5,
        );
        if (mode === MarkingMode.Ghost) {
          // One chalky crown stripe, solid, at a coverage far under a fresh coat.
          // Emitted OUTSIDE the `condition.markings` gate on purpose: that gate is
          // the road's own rule, and this event exists precisely to break it.
          color.copy(PAINT_LINEAR);
          this.emitMarkingQuad(
            road, 0, 0, s, s1, MARKING_HALF_WIDTH,
            ox, oz, point, color, GHOST_COVERAGE * (0.75 + wearAt(0) * 0.5), shade,
            positions, colors, shades,
          );
        } else if (mode !== MarkingMode.None && condition.markings >= MARKING_MIN) {
          for (const line of MARKING_LINES) {
            // Keep the old crown cadence exactly. The dividers use their own two-metre
            // phase and only paint a complete step inside an on dash, never a stretched
            // half dash. They also require both ends to be genuinely two-lane.
            const dividerOn0 = (Math.floor((s + 2) / 8) & 1) === 0;
            const dividerOn1 = (Math.floor((s1 + 2) / 8) & 1) === 0;
            // A double centre line is SOLID — the dash cadence is what it replaces —
            // and so is a crown line through a stretch with no sight through it.
            if (
              line.kind === 'crown' &&
              mode !== MarkingMode.DoubleSolid &&
              !solidCentre &&
              ((si / SUB_DIVISIONS) | 0) & 1
            ) continue;
            if (
              line.kind === 'divider' &&
              (!dividerOn0 || !dividerOn1 ||
                road.lanesPerSideAt(s) !== 2 || road.lanesPerSideAt(s1) !== 2)
            ) continue;

            const laterals: readonly [number, number][] =
              line.kind === 'edge'
                ? [
                  [-(halfWidth0 - MARKING_EDGE_INSET - MARKING_HALF_WIDTH),
                    -(halfWidth1 - MARKING_EDGE_INSET - MARKING_HALF_WIDTH)],
                  [halfWidth0 - MARKING_EDGE_INSET - MARKING_HALF_WIDTH,
                    halfWidth1 - MARKING_EDGE_INSET - MARKING_HALF_WIDTH],
                ]
                : line.kind === 'divider'
                  ? [[-LANE_WIDTH, -LANE_WIDTH], [LANE_WIDTH, LANE_WIDTH]]
                  : mode === MarkingMode.DoubleSolid
                    ? [[-DOUBLE_SOLID_GAP, -DOUBLE_SOLID_GAP], [DOUBLE_SOLID_GAP, DOUBLE_SOLID_GAP]]
                    : [[0, 0]];
            for (const [lateral0, lateral1] of laterals) {
              const wear = wearAt(lateral0);
              const coverage = condition.markings * (0.72 + wear * 0.55);
              if (coverage < PAINT_GONE) continue;
              color.copy(PAINT_LINEAR);
              // The stripe's own width wanders with the same field, over about ten
              // metres: a line that was painted by hand and then worn is not a
              // constant-width band, and a constant width is what reads as printed.
              this.emitMarkingQuad(
                road, lateral0, lateral1, s, s1,
                MARKING_HALF_WIDTH * (0.82 + 0.36 * wear),
                ox, oz, point, color, Math.min(1, coverage), shade,
                positions, colors, shades,
              );
            }
          }
          if (mode === MarkingMode.Rumble) {
            // A rumbled edge. The real thing is 0.3 m ribs, and marking quads are
            // emitted one per SURFACE_STEP — 1.33 m — so ribs are four times finer
            // than anything this mesh can carry and would alias into a flicker as
            // the camera moved. What survives at the distance a driver reads it from
            // is the strip's TONE, so it is drawn as one continuous dark band inside
            // the edge line, which is what the ribbing looks like from a seat anyway.
            color.copy(RUMBLE_LINEAR);
            for (const sign of [-1, 1]) {
              this.emitMarkingQuad(
                road,
                sign * (halfWidth0 - RUMBLE_INSET),
                sign * (halfWidth1 - RUMBLE_INSET),
                s, s1, RUMBLE_HALF_WIDTH,
                ox, oz, point, color, RUMBLE_MIX, shade,
                positions, colors, shades,
              );
            }
          }
        }
        yield;
      }

      if (positions.length === 0) {
        completed = true;
        return null;
      }

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colors), 4));
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      // The same shade channel the carriageway carries, per vertex: the paint is lit in
      // the shade of the canopy it stands under.
      geometry.setAttribute('aRoadShade', new THREE.BufferAttribute(Float32Array.from(shades), 1));
      const markings = new THREE.Mesh(geometry, roadMaterials().marking);
      markings.receiveShadow = true;
      completed = true;
      return markings;
    } finally {
      if (!completed) geometry?.dispose();
    }
  }

  private emitMarkingQuad(
    road: Road,
    lateral0: number,
    lateral1: number,
    s0: number,
    s1: number,
    /** Half-width of this stripe. A painted line and a rumble band differ only here. */
    half: number,
    ox: number,
    oz: number,
    point: { x: number; y: number; z: number },
    color: THREE.Color,
    /** How much of this quad is painted, 0..1: the rest is the road showing through. */
    coverage: number,
    /** The canopy shade at this row, which the marking material lights the paint with. */
    shade: number,
    positions: number[],
    colors: number[],
    shades: number[],
  ): void {
    const l00 = lateral0 - half;
    const l01 = lateral0 + half;
    const l10 = lateral1 - half;
    const l11 = lateral1 + half;
    // Four corners [c00, c01, c10, c11]; emit triangles c00,c10,c01 and c10,c11,c01.
    this.markingCorner(road, s0, l00, ox, oz, point);
    const x00 = point.x; const y00 = point.y; const z00 = point.z;
    this.markingCorner(road, s0, l01, ox, oz, point);
    const x01 = point.x; const y01 = point.y; const z01 = point.z;
    this.markingCorner(road, s1, l10, ox, oz, point);
    const x10 = point.x; const y10 = point.y; const z10 = point.z;
    this.markingCorner(road, s1, l11, ox, oz, point);
    const x11 = point.x; const y11 = point.y; const z11 = point.z;

    const order = [0, 2, 1, 2, 3, 1];
    const xs = [x00, x01, x10, x11];
    const ys = [y00, y01, y10, y11];
    const zs = [z00, z01, z10, z11];
    for (const i of order) {
      positions.push(xs[i]!, ys[i]!, zs[i]!);
      colors.push(color.r, color.g, color.b, coverage);
      shades.push(shade);
    }
  }

  private markingCorner(
    road: Road,
    s: number,
    lateral: number,
    ox: number,
    oz: number,
    out: { x: number; y: number; z: number },
  ): void {
    // Absolute in, relative out: `roadSurfaceY` feeds the surface field's 2D bump
    // noise with this point's world position, so it must see the absolute x/z. The
    // subtraction happens only after the height is resolved, on the way into the
    // marking's Float32Array.
    road.offsetPoint(s, lateral, out);
    out.y = roadSurfaceY(road, this.field, s, lateral, out.x, out.z) + MARKING_LIFT;
    out.x -= ox;
    out.z -= oz;
  }
}
