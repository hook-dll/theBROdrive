import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { hash01, Noise1D, Noise2D } from '../core/rng';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { ROAD_TILE_METRES, roadTextures } from '../render/roadtexture';
import { applyComicShading, applyGroundSpotlightNormals } from '../render/comic';
import { applyCloudShadow } from '../render/cloudshadow';
import { markShelter } from '../render/rainocclusion';
import { GRAVEL_TILE_M, gravelTexture } from '../render/gravelpaint';
import { applySnowCover, applyWetness } from '../render/season';
import { varietyEventOfKindAt, varietyWeightAt, type VarietyEvent } from './director';
import { desertPaletteAt, roadConditionAt } from './gradient';
import { ROAD_HALF_WIDTH, type Road } from './road';
import { tileSurfaceSampler } from './deserttiledata';
import type { RoadDistance } from './roaddistance';
import { shoulderWidthAt } from './shoulder';
import { buildStreamCrossings, STREAM_CROSSING_MATERIAL } from './streamcrossings';
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
const MARKING_HALF_WIDTH = 0.12;
const MARKING_MIN = 0.03;

/**
 * Weathering of the driving surface, as three things a photograph of an old road
 * shows and this road did not.
 *
 *  1. WHEEL PATHS. Tyres polish two strips per lane and grind dust out of them.
 *     Each lane supplies its own pair, so opening a lane extends the traffic story
 *     rather than scaling narrow-road tracks across empty asphalt.
 *  2. A DUSTY CROWN AND ROAD EDGE. Between the wheel paths and out at the edges
 *     nothing sweeps the surface, so wind-blown dust settles and bitumen bleaches.
 *  3. DIRT AT THE EDGE OF THE MAT. The outer half metre ravels into the verge before
 *     the asphalt ends rather than stopping in a hard visual line.
 *
 * All three are applied to the vertex colour, on top of the tiled asphalt texture
 * (render/roadtexture.ts) that carries aggregate, cracks and patches.
 */
/**
 * The inherited polished pair is centred 0.2 m outward of each nominal lane centre:
 * it preserves the narrow road's ±0.85/±2.45 m tracks while carrying that real-world
 * camber bias into every added lane.
 */
const WHEEL_TRACK_LANE_BIAS = 0.2;
/** A 1.6 m tyre track places each path 0.8 m either side of its lane centre. */
const WHEEL_TRACK_HALF = 0.8;
/** Half-width of a polished strip, metres. */
const WHEEL_PATH_HALF = 0.5;
/** Darkening at the centre of a wheel path, as a fraction of the lane colour. */
const WHEEL_PATH_DARKEN = 0.16;
/** Lightening of the dusty, unswept surface between and beside the wheel paths. */
const DUST_LIGHTEN = 0.11;
/** How much of that dust reads as colour rather than brightness (towards gravel). */
const DUST_TINT = 0.3;
/** Width of the ravelled band inside the mat's edge, metres. */
const EDGE_RAVEL = 0.55;
/** Fraction of the way to gravel colour the very edge of the mat reaches. */
const EDGE_RAVEL_MIX = 0.4;
/** Wavelength (m) of the coarse tonal mottling applied per vertex. */
const MOTTLE_WAVELENGTH = 7;
/** Peak brightness swing of that mottling. */
const MOTTLE_AMOUNT = 0.07;

/**
 * Paint wear. Nothing repaints this road, so the markings are chalky rather than
 * white, they thin out in patches, and whole dashes are simply gone.
 */
const PAINT_COLOR = 0xd9d4c6;
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
const PATCH_LINEAR = new THREE.Color(0x2b2925);
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
const RUBBER_LINEAR = new THREE.Color(0x14130f);
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

/**
 * Static albedos, pre-converted to the linear working colour space. Sand, rock and
 * gravel are palette-driven (see `desertPaletteAt`), so only the sealed-lane
 * surfaces remain here.
 */
const SURFACE_LINEAR: Partial<Record<SurfaceType, THREE.Color>> = {
  [SurfaceType.Asphalt]: new THREE.Color(SURFACES[SurfaceType.Asphalt].color),
  [SurfaceType.CrackedAsphalt]: new THREE.Color(SURFACES[SurfaceType.CrackedAsphalt].color),
  [SurfaceType.Concrete]: new THREE.Color(SURFACES[SurfaceType.Concrete].color),
};

/**
 * Palette scratch colours, updated once per arclength row and reused across the
 * row's vertices so no palette lookup allocates. Gravel tints weathered asphalt;
 * sand colours wind-blown cover at the edge.
 */
const gravelLinear = new THREE.Color();
const sandLinear = new THREE.Color();
/** Chalky, sun-dulled paint. Fresh white is what made the markings look printed. */
const PAINT_LINEAR = new THREE.Color(PAINT_COLOR);
/**
 * Base colour a ghost line is mixed from, for the one case the marking pass has no
 * `SURFACE_LINEAR` entry: gravel, whose colour comes from the regional palette.
 */
const paintBase = new THREE.Color();

// Shared across every chunk; never disposed by the streamer. The maps are built on
// the first chunk build (they need a canvas, so not at module load) and the vertex
// colours are divided by the albedo's mean so the surface keeps its old brightness.
// Cloud shadow is the outermost wrap on all three, so it captures the ground-spotlight
// patch each of them already carries instead of hiding it. A cloud crossing the road is
// most of the effect: the ribbon is the one surface always in view.
// In the rain the asphalt goes dark and shines back the grey sky (render/season.ts).
const roadMaterial = applyWetness(applyCloudShadow(
  applyGroundSpotlightNormals(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
    }),
  ),
), 0.38, 0.32);
/** Dark, weathered aggregate exposed only where the sand falls below the mat edge. */
const roadBedMaterial = applyCloudShadow(
  applyGroundSpotlightNormals(
    new THREE.MeshStandardMaterial({
      color: 0x25231f,
      roughness: 1,
      metalness: 0,
    }),
  ),
);
/** The country's bare shoulder (world/shoulder.ts). */
const COUNTRY_SHOULDER = true;
/**
 * Lit as the ground is, so the strip is the ground's own colour where it meets it.
 *
 * RESOLVED ON FIRST USE, not at import. `gravelTexture()` paints its map onto a 2D canvas,
 * which needs a DOM — so building the material at module scope made importing this file
 * depend on a canvas existing first, which is an ordering dependency between a headless
 * bench's import list and a texture. The painter is already memoised; this is the same
 * laziness one level up, and `render/stickers.ts` does it this way for the same reason.
 */
let shoulderMat: THREE.MeshStandardMaterial | null = null;
function shoulderMaterial(): THREE.MeshStandardMaterial {
  return (shoulderMat ??= applyWetness(applySnowCover(applyCloudShadow(
    applyComicShading(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        // Crushed stone in earth (render/gravelpaint.ts), shade over the vertex colour.
        map: gravelTexture(),
        roughness: 0.95,
        metalness: 0,
        // It lies on the ground a few centimetres up; this keeps it on top where the
        // tiles' interpolation brings them level with it.
        polygonOffset: true,
        // Units only: a slope factor would pull the tucked edge back out of the ground.
        polygonOffsetFactor: 0,
        polygonOffsetUnits: -2,
      }),
      { lightingStrength: 0, shadowWarmth: 0, reliefShadeStrength: 0, contourStrength: 0, stippleStrength: 0, spotlightNormals: 'smooth' },
    ),
  ), 0.92), 0.3, null));
}
const shoulderEarth = new THREE.Color(0xb3a48c);
const shoulderGravel = new THREE.Color(0xbcb7ab);
const shoulderColour = new THREE.Color();
let textureGain = 1;
let texturesAttached = false;

function attachRoadTextures(): void {
  if (texturesAttached) return;
  texturesAttached = true;
  const { map, normal, mean } = roadTextures();
  roadMaterial.map = map;
  // Tangent-space normals of the wearing course, baked from the same height field as
  // the albedo. Flat strength: the relief is the aggregate, and a low sun is the only
  // light that reads it, so half strength is already a visible rake on the road.
  roadMaterial.normalMap = normal;
  roadMaterial.normalScale.set(0.5, 0.5);
  roadMaterial.needsUpdate = true;
  textureGain = 1 / Math.max(0.2, mean);
}

/** Shared road finish for small paved features outside the ribbon. */
export function roadAsphaltMaterial(): THREE.MeshStandardMaterial {
  attachRoadTextures();
  return roadMaterial;
}

/** Texture-brightness-corrected vertex colour for the road's start condition. */
export function roadAsphaltVertexColorAtStart(out: THREE.Color): THREE.Color {
  attachRoadTextures();
  return out.copy(SURFACE_LINEAR[roadConditionAt(0).surface]!).multiplyScalar(textureGain);
}

const markingMaterial = applyCloudShadow(
  applyGroundSpotlightNormals(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      // Markings sit 2 mm above the road: enough to avoid coplanar depth fighting
      // while remaining visually flush with the asphalt under a tyre.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  ),
);

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
  private buildShoulder(ctx: ChunkContext, positions: Float32Array, sCount: number, latCount: number): { mesh: THREE.Mesh; vertices: Float32Array; indices: Uint32Array } {
    const { sStart, road } = ctx;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const COLS = 4;
    const ACROSS = [0, 0.3, 0.65, 1];
    const verts = sCount * 2 * COLS;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    // The gravel tiles in road coordinates, from a base that is a whole number of
    // tiles, so neighbouring chunks meet in phase and no float grows large.
    const GRAVEL_BASE_M = GRAVEL_TILE_M * 200;
    const uvBase = Math.floor(sStart / GRAVEL_BASE_M) * GRAVEL_BASE_M;
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
          // Trodden earth with gravel in it, in patches along the road; the outer
          // edge a little darker where the grass roots start.
          const g = 0.5 + 0.5 * this.mottleNoise.at(s / 3.1 + sign * 17, t * 1.3);
          shoulderColour.copy(shoulderEarth).lerp(shoulderGravel, g * 0.8).multiplyScalar(1 - 0.12 * t);
          uv[vi * 2] = (halfWidth + width * t) / GRAVEL_TILE_M;
          uv[vi * 2 + 1] = (s - uvBase) / GRAVEL_TILE_M;
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
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // Lit straight up, as the road and the ground beside it are: a strip lit by its own
    // slope read as a stripe.
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geometry, shoulderMaterial());
    mesh.receiveShadow = true;
    return { mesh, vertices: pos, indices: index };
  }


  *buildSteps(ctx: ChunkContext): Iterator<void, ChunkContent | null> {
    const { sStart, sEnd, road, physics, hasPhysics } = ctx;
    if (sEnd <= sStart) return null;
    attachRoadTextures();
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
    const indices = new Uint32Array((sCount - 1) * (latCount - 1) * 6);

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
        (((sStart % ROAD_TILE_METRES) + ROAD_TILE_METRES) % ROAD_TILE_METRES) /
        ROAD_TILE_METRES;

      for (let si = 0; si < sCount; si++) {
        // Endpoint-exact rows: si * (sEnd - sStart) / (sCount - 1) makes the shared
        // boundary row bit-identical in both neighbours, keeping the seam watertight
        // at the denser resolution.
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        // Every consumer of this row gets this one local width. In particular the
        // collider is indexed from these same fixed-count rows as the visible mat.
        const halfWidth = road.halfWidthAt(s);
        const cond = roadConditionAt(s);
        const laneBase = SURFACE_LINEAR[cond.surface] ?? null;
        // Palette colour is a function of arclength alone: sample once per row, so
        // neighbouring chunks share the seam row and a rebuild is identical.
        const palette = desertPaletteAt(s);
        sandLinear.setHex(palette.sand);
        gravelLinear.setHex(palette.gravel);

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

          // Absolute lateral / 24 m is world-scale texture space: widening neither
          // stretches aggregate nor bakes lane paint into this texture.
          uvs[vi * 2] = lateral / ROAD_TILE_METRES;
          uvs[vi * 2 + 1] = textureVStart + (s - sStart) / ROAD_TILE_METRES;

          const a = Math.abs(lateral);
          // One shoulder only: `side` is the windward one, and the other side keeps
          // the district's own uniform cover with nothing added.
          color.lerpColors(
            laneBase ?? gravelLinear,
            sandLinear,
            sandFactor(a, halfWidth, cond.sandCover, lateral * tongueSide > 0 ? tongueReach : 0),
          );
          this.weather(color, gravelLinear, s, lateral, a, halfWidth, cond.decay);
          // Repair and rubber go on AFTER the weathering, in the order the road got
          // them: the district wears, then somebody patches it, then somebody locks
          // a wheel up on the patch.
          if (patchRow.weight > 0) {
            const coverage = this.patchCoverageAt(s, lateral, a, halfWidth);
            if (coverage > 0) {
              color.lerp(PATCH_LINEAR, coverage * PATCH_MIX);
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
                color.lerp(RUBBER_LINEAR, skidRow.ink * t * t * (3 - 2 * t) * edge * SKID_MIX);
              }
            }
          }
          color.multiplyScalar(textureGain);
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
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      // The road uses the same upward lighting basis as the desert. Actual slope
      // normals made it read as a dark shadow strip on grades.
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

      const roadMesh = new THREE.Mesh(geometry, roadMaterial);
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
      const bedMesh = new THREE.Mesh(bedGeometry, roadBedMaterial);
      bedMesh.receiveShadow = true;
      group.add(bedMesh);
      if (COUNTRY_SHOULDER && this.roadDistance) {
        const shoulder = this.buildShoulder(ctx, positions, sCount, latCount);
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
        const crossingMesh = new THREE.Mesh(crossings.geometry, STREAM_CROSSING_MATERIAL);
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

      const markings = yield* this.buildMarkingsSteps(
        road, sStart, sEnd, sCount, ox, oz,
      );
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
   * Wears the lane colour at one vertex: polished wheel paths, dust on the crown and
   * verge side, a ravelled outer edge, and coarse tonal mottling on top. See the
   * WHEEL_PATH_* block for why these three and not others.
   *
   * Everything scales with `decay` in the direction the desert takes it: an
   * abandoned road loses its polished tracks (nothing drives it) and gains dust.
   */
  private weather(
    color: THREE.Color,
    gravel: THREE.Color,
    s: number,
    lateral: number,
    a: number,
    halfWidth: number,
    decay: number,
  ): void {
    let track = 0;
    if (halfWidth === HW) {
      // Keep the original literal centres, rather than reconstructing them through
      // arithmetic, so the narrow road's weather field remains bit-identical.
      for (const centre of [-2.45, -0.85, 0.85, 2.45]) {
        const t = 1 - Math.min(1, Math.abs(lateral - centre) / WHEEL_PATH_HALF);
        if (t > track) track = t;
      }
    } else {
      for (const side of [-1, 1]) {
        for (let lane = 0; lane < 2; lane++) {
          const centre = side * (laneOffsetFor(halfWidth, lane) + WHEEL_TRACK_LANE_BIAS);
          for (const wheel of [-WHEEL_TRACK_HALF, WHEEL_TRACK_HALF]) {
            const t = 1 - Math.min(1, Math.abs(lateral - (centre + wheel)) / WHEEL_PATH_HALF);
            if (t > track) track = t;
          }
        }
      }
    }
    const smoothTrack = track * track * (3 - 2 * track);
    const polish = smoothTrack * WHEEL_PATH_DARKEN * (1 - decay * 0.7);
    const dust = (1 - smoothTrack) * DUST_LIGHTEN * (0.5 + decay);

    color.multiplyScalar(1 - polish + dust);
    if (dust > 0) color.lerp(gravel, dust * DUST_TINT);

    // Ravelled edge: the mat frays into the verge rather than ending at a line.
    const intoEdge = 1 - Math.min(1, (halfWidth - a) / EDGE_RAVEL);
    if (intoEdge > 0) {
      const t = intoEdge * intoEdge;
      color.lerp(gravel, t * EDGE_RAVEL_MIX * (0.6 + decay * 0.4));
    }

    // Coarse mottling: patchy pours and old repairs at a scale the tiled texture
    // cannot carry, since the tile repeats every ROAD_TILE_METRES.
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
      const outermost = halfWidth - PATCH_CRACK_HALF - EDGE_RAVEL;
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
    // The outer half metre is already ravelling into the verge. Bitumen laid over it
    // restores the hard visual line that EDGE_RAVEL exists to break, so the repair
    // stops where the mat starts fraying — which is also where a real one stops,
    // because there is nothing solid out there to lay it on.
    const edge = (halfWidth - a) / EDGE_RAVEL;
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
    road: Road,
    sStart: number,
    sEnd: number,
    sCount: number,
    ox: number,
    oz: number,
  ): Generator<void, THREE.Mesh | null> {
    let geometry: THREE.BufferGeometry | null = null;
    let completed = false;

    try {
      const positions: number[] = [];
      const colors: number[] = [];
      const point = { x: 0, y: 0, z: 0 };
      const color = new THREE.Color();

      // Marking quads are emitted per surface step so their corners coincide with
      // mesh vertices rather than floating across a bump or pothole.
      for (let si = 0; si < sCount - 1; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const s1 = s + SURFACE_STEP;
        const condition = roadConditionAt(s);
        const laneBase = SURFACE_LINEAR[condition.surface];
        const mode = this.markingModeAt(s);
        const halfWidth0 = road.halfWidthAt(s);
        const halfWidth1 = road.halfWidthAt(s1);
        if (mode === MarkingMode.Ghost) {
          // One chalky crown stripe, solid, at a coverage far under a fresh coat.
          // Emitted OUTSIDE the `condition.markings` gate on purpose: that gate is
          // the road's own rule, and this event exists precisely to break it.
          const base = laneBase ?? paintBase.setHex(desertPaletteAt(s).gravel);
          color.lerpColors(base, PAINT_LINEAR, GHOST_COVERAGE);
          this.emitMarkingQuad(
            road, 0, 0, s, s1, MARKING_HALF_WIDTH,
            ox, oz, point, color, positions, colors,
          );
        } else if (mode !== MarkingMode.None && condition.markings >= MARKING_MIN && laneBase) {
          for (const line of MARKING_LINES) {
            // Keep the old crown cadence exactly. The dividers use their own two-metre
            // phase and only paint a complete step inside an on dash, never a stretched
            // half dash. They also require both ends to be genuinely two-lane.
            const dividerOn0 = (Math.floor((s + 2) / 8) & 1) === 0;
            const dividerOn1 = (Math.floor((s1 + 2) / 8) & 1) === 0;
            // A double centre line is SOLID: the dash cadence is what it replaces.
            if (
              line.kind === 'crown' &&
              mode !== MarkingMode.DoubleSolid &&
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
                  [-(halfWidth0 - MARKING_HALF_WIDTH), -(halfWidth1 - MARKING_HALF_WIDTH)],
                  [halfWidth0 - MARKING_HALF_WIDTH, halfWidth1 - MARKING_HALF_WIDTH],
                ]
                : line.kind === 'divider'
                  ? [[-LANE_WIDTH, -LANE_WIDTH], [LANE_WIDTH, LANE_WIDTH]]
                  : mode === MarkingMode.DoubleSolid
                    ? [[-DOUBLE_SOLID_GAP, -DOUBLE_SOLID_GAP], [DOUBLE_SOLID_GAP, DOUBLE_SOLID_GAP]]
                    : [[0, 0]];
            for (const [lateral0, lateral1] of laterals) {
              const wear = this.paintNoise.fbm(
                (s + lateral0 * 130) / PAINT_WEAR_WAVELENGTH,
                2,
                2.3,
                0.5,
              );
              const coverage = condition.markings * (0.72 + wear * 0.55);
              if (coverage < PAINT_GONE) continue;
              color.lerpColors(laneBase, PAINT_LINEAR, Math.min(1, coverage));
              this.emitMarkingQuad(
                road, lateral0, lateral1, s, s1, MARKING_HALF_WIDTH,
                ox, oz, point, color, positions, colors,
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
            color.lerpColors(laneBase, RUMBLE_LINEAR, RUMBLE_MIX);
            for (const sign of [-1, 1]) {
              this.emitMarkingQuad(
                road,
                sign * (halfWidth0 - RUMBLE_INSET),
                sign * (halfWidth1 - RUMBLE_INSET),
                s, s1, RUMBLE_HALF_WIDTH,
                ox, oz, point, color, positions, colors,
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
      geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colors), 3));
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      const markings = new THREE.Mesh(geometry, markingMaterial);
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
    positions: number[],
    colors: number[],
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
      colors.push(color.r, color.g, color.b);
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
