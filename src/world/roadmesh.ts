import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { hash01, Noise1D, Noise2D } from '../core/rng';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { ROAD_TILE_METRES, roadTextures } from '../render/roadtexture';
import { applyGroundSpotlightNormals } from '../render/comic';
import { applyCloudShadow } from '../render/cloudshadow';
import { applyGroundLight } from '../render/groundlight';
import { applyCleanSurface } from '../render/cleanstyle';
import {
  applyRoadLook,
  setRoadDetailMap,
  WHEEL_TRACK_HALF,
  WHEEL_TRACK_LANE_BIAS,
} from '../render/roadlook';
import { varietyEventOfKindAt, varietyWeightAt, type VarietyEvent } from './director';
import { tileGroundSampler, type DrawnGroundSample } from './deserttiledata';
import {
  COURSE_AGED_ALBEDO,
  desertPaletteAt,
  roadConditionAt,
  roadCourseAt,
  ROAD_START_SURFACE,
  type RoadCondition,
  type RoadCourseBuffer,
} from './gradient';
import { ROAD_HALF_WIDTH, type Road } from './road';
import type { RoadDistance } from './roaddistance';
import {
  embankmentDropAt,
  LANE_WIDTH,
  laneHalfWidthFor,
  laneOffsetFor,
  SHOULDER_WIDTH_M,
  shoulderFringeM,
} from './roadprofile';
import {
  EVENT_MAX_KNOTS,
  RoadEventTint,
  SECTION_COLUMNS,
  SUB_DIVISIONS,
  SURFACE_STEP,
  SurfaceField,
  roadSurfaceY,
  sectionLateral,
} from './roadsurface';
import { terminusWeight } from './terminus';
import { laybyNear, laybyOuterAt } from './layby';
import { DESERT_SHOULDER_MATERIAL, TERRAIN_COLLIDER_SURFACE } from './terrainmesh';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';

/**
 * The asphalt ribbon, banked into corners and displaced by a layered surface field —
 * broad undulation, wheel-scale bumps, broken edges, discrete potholes and the road
 * events (humps, rimmed holes, cracks, patches, heaves, joints). The desert terrain
 * begins beneath each asphalt edge and falls away on the road's low embankment, and a
 * shoulder strip (SHOULDER_STYLE) is that embankment's graded top. Surface type owns ordinary bump amplitude and the event
 * mix; decay increases undulation, edge breakup, pothole and event occurrence. The
 * same vertices feed the visible mesh and trimesh collider, so the car feels the
 * shape the driver sees.
 *
 * ROWS. The base rows are SURFACE_STEP apart and come first in the vertex buffer, in
 * the layout the ribbon has always had (the shoulder, the bed skirt and the tools read
 * them by index). A gap holding a road event gets its extra rows APPENDED after them
 * (`SurfaceField.eventRows`); the gap's quads are split through those rows, in the
 * mesh and in every collider slab alike. An extra row is its gap's base quad,
 * interpolated, plus the event — so it is the same plane wherever the event is zero.
 */

const HW = ROAD_HALF_WIDTH;

/**
 * Longitudinal rows of quads per collider slab.
 *
 * The visible ribbon is one mesh, but its collider is built in slabs so no single
 * `RAPIER.ColliderDesc.trimesh` call — an uninterruptible native BVH build — can
 * own a frame. Fifteen rows is ~540 triangles, about a millisecond, which fits
 * inside the streaming scheduler's slice with room for the surrounding work. Road
 * events add their rows to the slab they sit in: a slab of broken road averages two
 * or three events, a concrete one a joint every four rows, so the worst slabs carry
 * about twice the base count.
 */
const COLLIDER_SLAB_QUADS = 15;

/**
 * The quads of base gap `si`, split through its road-event rows, from index `at`;
 * returns the next index. Base row `r` is vertex row `r - baseShift`, extra row `e` is
 * vertex row `extraRow0 + e - extraShift`, so one routine serves the whole ribbon and
 * every collider slab. Two triangles per column, wound as the ribbon always was.
 */
function gapQuads(
  out: Uint32Array,
  at: number,
  si: number,
  gapRows: Int32Array,
  latCount: number,
  baseShift: number,
  extraRow0: number,
  extraShift: number,
): number {
  let rowA = si - baseShift;
  const last = gapRows[si + 1]!;
  for (let e = gapRows[si]!; e <= last; e++) {
    const rowB = e < last ? extraRow0 + e - extraShift : si + 1 - baseShift;
    for (let li = 0; li < latCount - 1; li++) {
      const a = rowA * latCount + li;
      const b = rowB * latCount + li;
      out[at++] = a;
      out[at++] = b;
      out[at++] = a + 1;
      out[at++] = b;
      out[at++] = b + 1;
      out[at++] = a + 1;
    }
    rowA = rowB;
  }
  return at;
}

/**
 * Rendered depth of the sealed mat. The terrain overlaps the upper edge, while this
 * skirt continues well below it so low viewpoints never expose a zero-thickness sheet.
 */
const ROAD_BED_DEPTH = 0.35;

const MARKING_LIFT = 0.002;
const MARKING_HALF_WIDTH = 0.12;
const MARKING_MIN = 0.03;

/**
 * THE SHOULDER: the road's graded shoulder either side, from the asphalt's edge down
 * its own embankment onto the desert (`roadprofile.embankmentDropAt`), so the road
 * stands a little above the ground instead of lying on it like a mat.
 *
 * Its first `SHOULDER_WIDTH_M` is the formation itself, built from the asphalt edge's
 * own height and the profile's fall (6% at the lip steepening to 15%), the same on
 * every row: the width a verge pass is sized on, and nothing narrows it. Past it the
 * FRINGE (`shoulderFringeM`) carries on down the top of the batter, wandering, worn
 * narrower and ragged, and its last column tucks under the drawn ground so the sand
 * itself cuts the edge. The ground the desert tiles draw under the formation is the
 * same profile less their 0.1 m under-road offset, and their 3 m lattice chords it from
 * below; where the ground is higher than the formation all the same (a lay-by's
 * levelled site, terrain climbing beside a cutting) the strip lies on it instead
 * (`SHOULDER_LIFT`). Measured by `tools/verge-profile.ts`: 2.55 m drivable on every row,
 * ground over the strip on 0.3% of rows and never by more than 4 cm. Its only texture is
 * grit in the ground's own ink (DESERT_SHOULDER_MATERIAL), thinning out into the sand.
 *
 * A DARK CRUSHED-STONE BAND, then sand (owner, 2026-10-16: the old title screen's dark,
 * rough gravel shoulder against orange sand is the reference). Neutral grey stone, NOT
 * tinted by the desert: a band in the sand's hue at a lower value is what read as shadow
 * patches when a darker verge was once painted into the terrain (terrainmesh.ts), and
 * an earlier pale grey strip vanished against the saturated palettes. A different
 * material reads as one by its hue and its grain, so the band carries the strongest grit
 * in the game, pale stones on dark (`aShoulderGrit`). The desert's sand meets it in ONE
 * soft line that meanders along the road (`SHOULDER_SAND_*`), never nearer the asphalt
 * than `SHOULDER_SAND_CLEAN_M`.
 *
 * Its collider is its own triangles (LooseShoulder, the verge surface the handling
 * already models), fringe included: one grip across the whole strip, and the wheels
 * stand on exactly the surface that is drawn.
 */
interface ShoulderStyle {
  /** Linear luminance of the band's stone; 0 takes the road's own (palette) gravel. */
  readonly stone: number;
  /** Grit stipple strength over the stone, 0..1. */
  readonly grit: number;
}

/**
 * Colour, and nothing else: the strip's WIDTH and fall are the road's cross-section and
 * live in `roadprofile.ts` (`SHOULDER_WIDTH_M`, `shoulderFringeM`, `embankmentDropAt`),
 * because the verge is drivable ground and the autopilot sizes a pass on the same
 * numbers this draws. Where the sand meets the band is the same on every surface
 * (`SHOULDER_SAND_*`).
 */
const SHOULDER_STYLE: Partial<Record<SurfaceType, ShoulderStyle>> = {
  // A highway's crushed-stone shoulder, about an aged mat's value (0.14).
  [SurfaceType.Asphalt]: { stone: 0.13, grit: 1 },
  // Older and a shade paler.
  [SurfaceType.CrackedAsphalt]: { stone: 0.14, grit: 0.9 },
  // Concrete roads were built wide and pale, with cement dust in the verge.
  [SurfaceType.Concrete]: { stone: 0.2, grit: 0.7 },
  // The grader's windrow: the road's own gravel pushed off to the sides.
  [SurfaceType.Gravel]: { stone: 0, grit: 1 },
};
const DEFAULT_SHOULDER_STYLE = SHOULDER_STYLE[SurfaceType.Asphalt]!;
/**
 * The crushed stone's hue, scaled to `stone`: a warm grey-brown of its own, the same on
 * every palette. Neutral grey read as a concrete strip under the blue sky's fill.
 */
const SHOULDER_STONE_LINEAR = new THREE.Color(0x6b6158);
/**
 * WHERE THE SAND MEETS THE BAND (owner, 2026-10-17): one soft line along each verge,
 * meandering on long waves, with clean dark gravel between it and the asphalt and plain
 * sand beyond. Its middle (the colour half way) lies `SHOULDER_SAND_LINE_M` from the
 * asphalt's edge, swung by up to `SHOULDER_SAND_SWING_M` on three sines of 53, 29 and
 * 17 m wavelength, each verge on its own phase; the change from stone to sand takes
 * `SHOULDER_BAND_SOFT`. So the stone is never sand within `SHOULDER_SAND_CLEAN_M` (0.8 m)
 * of the asphalt, and the sand is whole by 2.4 m, inside the formation's 2.5 m: the
 * ragged fringe past it is sand on sand and cannot show as a comb.
 *
 * Not per row and not per pixel: an earlier edge took a per-row hash (1.33 m) and a
 * per-pixel drift of tongues and fans once crossed the band; both read as an endless
 * comb along the road (owner's screenshots, 2026-10-16 and -17).
 */
const SHOULDER_SAND_CLEAN_M = 0.8;
const SHOULDER_BAND_SOFT = 0.6;
const SHOULDER_SAND_SWING_M = 0.5;
const SHOULDER_SAND_LINE_M = SHOULDER_SAND_CLEAN_M + SHOULDER_BAND_SOFT * 0.5 + SHOULDER_SAND_SWING_M;
/** Share of a windrow's gravel colour a gravel road's band is drawn at: spoil in shade. */
const SHOULDER_WINDROW_TONE = 0.8;
/**
 * Columns of the guaranteed shoulder, metres past the asphalt edge. The formation's
 * fall steepens across it, and these chords sit within 2 mm of the curve.
 */
const SHOULDER_ACROSS_M: readonly number[] = [0, 0.12, 0.6, 1.25, 1.9, SHOULDER_WIDTH_M];
/** The fringe's two columns past it: its middle, and its ragged edge under the sand. */
const SHOULDER_COLUMNS = SHOULDER_ACROSS_M.length + 2;
/** Height of the strip over drawn ground it has to lie on, and its tuck under it, metres. */
const SHOULDER_LIFT = 0.02;
const SHOULDER_TUCK = 0.04;
/** Row jitter of the fringe's outer edge, metres: ragged where the sand takes over. */
const SHOULDER_RAGGED = 0.3;
/** Least fringe a row keeps, metres, so its two columns never fold onto each other. */
const SHOULDER_FRINGE_MIN = 0.08;
/**
 * Asphalt-to-ground drops, measured under the asphalt edge itself, beyond which a row
 * has no shoulder: the ground is not where a verge could meet it (a cut, a pad, a
 * streaming disagreement), and a strip hung down to it would be a curtain. Normally
 * the drop is the tiles' 0.1 m under-road plus their 3 m lattice's chord across the
 * embankment's top, under 0.35 m.
 */
const SHOULDER_MAX_DROP = 0.6;
const SHOULDER_MAX_RISE = 0.25;
/** Brightness swing of the strip's own mottling, fading out to the sand. */
const SHOULDER_MOTTLE = 0.05;
/** Darkening of the crumbs right at the asphalt edge (column 0 only). */
const SHOULDER_CRUMB = 0.12;

/**
 * Weathering of the driving surface, as the things a photograph of an old road shows.
 *
 *  1. COURSES AND WHEEL TRACKS. Fresh and bleached stretches meeting at seams, polished
 *     wheel paths and an oil strip down each lane. They need edges finer than these
 *     vertices, so they are drawn per pixel (render/roadlook.ts) from what each vertex
 *     says about them (`aRoadCourse`, `aRoadEdge`); see `buildSteps`.
 *  2. DUST. Nothing sweeps a decaying road, so wind-blown dust settles over it and
 *     greys the bitumen towards the desert's stone.
 *  3. DIRT AT THE EDGE OF THE MAT. The outer half metre ravels into the verge before
 *     the asphalt ends rather than stopping in a hard visual line.
 *
 * All of it rides on the tiled asphalt texture (render/roadtexture.ts) that carries
 * aggregate, tar-sealed cracks and patches, and its chip-seal detail.
 */
/** Lightening of a fully decayed surface by settled dust. */
const DUST_LIGHTEN = 0.14;
/** How much of that dust reads as colour rather than brightness (towards gravel). */
const DUST_TINT = 0.3;
/** Width of the ravelled band inside the mat's edge, metres. */
const EDGE_RAVEL = 0.55;
/** Fraction of the way to the shoulder's stone the very edge of the mat reaches. */
const EDGE_RAVEL_MIX = 0.4;
/** Wavelength (m) of the coarse tonal mottling applied per vertex. */
const MOTTLE_WAVELENGTH = 7;
/** Peak brightness swing of that mottling. */
const MOTTLE_AMOUNT = 0.07;
/**
 * The linear albedo the asphalt surfaces' own colours (core/surfaces.ts) are drawn at,
 * texture gain included: a course's albedo divided by this is its shade. Both surfaces
 * are an aged mat; CrackedAsphalt the older and paler.
 */
const COURSE_BASE_ALBEDO: Partial<Record<SurfaceType, number>> = {
  [SurfaceType.Asphalt]: (COURSE_AGED_ALBEDO[0] + COURSE_AGED_ALBEDO[1]) * 0.5,
  [SurfaceType.CrackedAsphalt]: COURSE_AGED_ALBEDO[1],
};
/**
 * Metres from a seam inside which a row carries both of its courses. Further out the
 * row carries its own course twice, which is what lets the next seam take over halfway
 * between two without a phantom seam where the reference changes (render/roadlook.ts).
 */
const SEAM_REACH_M = 8;
/** Wheel-track strength by surface: asphalt polishes, concrete a little, gravel not. */
const TRACK_STRENGTH: Partial<Record<SurfaceType, number>> = {
  [SurfaceType.Asphalt]: 1,
  [SurfaceType.CrackedAsphalt]: 1,
  [SurfaceType.Concrete]: 0.5,
};

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
 * SURFACE VARIETY: the three things world/director.ts is allowed to do to the asphalt.
 *
 * All three are COLOUR, on vertices that already exist. The mat's vertices ARE the
 * collider the car drives on (see the slab loop in `buildSteps`), so a feature that
 * moved one to make a picture would move the road under the wheels, and the collider
 * is indexed straight off the fixed row/column counts, so a feature that added one
 * would tear the indexing. Every number below scales a coverage which is itself
 * multiplied by `varietyWeightAt` — exactly 0 everywhere the feature is not running,
 * so off-feature the arithmetic is bit-for-bit the road that was here before it
 * (tools/surface-paint.ts carries the checksum that proves that, not an argument).
 *
 * The Surface channel runs ONE kind per window, so a patch, a skid and a marking
 * change can never overlap each other: each block below has to compose with the
 * district's own weathering and with nothing else.
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
/**
 * ROAD EVENT PAINT. A road event (roadsurface.ts) is geometry first; this makes it
 * readable from the seat, and it costs only its own extra rows' vertex colours — no
 * texture, no decal mesh, no new program. A hole's floor goes towards the palette's
 * gravel (broken base course and blown sand) in the shade of its rim; a patch is the
 * repair bitumen above; a crack, a sealed seam or a joint is a dark line.
 */
const HOLE_MIX = 0.55;
const HOLE_SHADE = 0.72;
const EVENT_LINE_DARKEN = 0.45;
/** Scratch: the tint target of the event row being coloured. */
const eventTintColor = new THREE.Color();
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

/** The row's course and seam (gradient.ts `roadCourseAt`), reused every row. */
const courseRow: RoadCourseBuffer = { seam: 0, before: 0, after: 0 };


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
 * row's vertices so no palette lookup allocates. Gravel tints weathered asphalt
 * and is a gravel district's own lane.
 */
const gravelLinear = new THREE.Color();
/** Chalky, sun-dulled paint. Fresh white is what made the markings look printed. */
const PAINT_LINEAR = new THREE.Color(PAINT_COLOR);
/**
 * Base colour a ghost line is mixed from, for the one case the marking pass has no
 * `SURFACE_LINEAR` entry: gravel, whose colour comes from the regional palette.
 */
const paintBase = new THREE.Color();
/** Shoulder scratch: the row's sand and stone, and one vertex's colour. */
const shoulderSand = new THREE.Color();
const shoulderStone = new THREE.Color();
const shoulderColour = new THREE.Color();
const shoulderGround: DrawnGroundSample = { height: 0, detail: 0, nx: 0, ny: 1, nz: 0 };

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * VERGE SKIRT: collider-only ground beside the shoulder, out to `SKIRT_ACROSS_M` past
 * its outer edge, on the tiles' own drawn ground (`tileGroundSampler`).
 *
 * Solid ground beside the road used to be the desert streamer's business alone, and
 * its physical tiles end 480-720 m from the player while road chunks — and the traffic
 * on them — carry physics to `ROAD_PHYSICS_REACH_M` (world/ranges.ts) (800 m). In between, a car that put a
 * wheel a metre past the shoulder fell off the world, hung nose-down on the shoulder's
 * edge and was found standing on end with the desert built through it. The skirt makes
 * "ground beside the road" part of the road chunk, so it exists exactly as far as the
 * road's own physics does, whatever radius the tiles keep. Where a physical tile lies
 * under it too, both are the same surface to within the skirt's coarser chord; the
 * column a metre out follows the embankment's foot, where that chord is sharpest.
 */
const SKIRT_ACROSS_M: readonly number[] = [0, 1, 3, 7, 12, 16, 20];

/** The shoulder's drawn strip and its collider source, both origin-relative. */
interface ShoulderBuild {
  readonly geometry: THREE.BufferGeometry;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  /** Vertices per arclength row (both sides). */
  readonly rowVertices: number;
  /** Indices per quad row (both sides). */
  readonly rowIndices: number;
  /** The verge skirt (`SKIRT_ACROSS_M`), collider only, rows matching the strip's. */
  readonly skirtVertices: Float32Array;
  readonly skirtIndices: Uint32Array;
  readonly skirtRowVertices: number;
  readonly skirtRowIndices: number;
}

// Shared across every chunk; never disposed by the streamer. The maps are built on
// the first chunk build (they need a canvas, so not at module load) and the vertex
// colours are divided by the albedo's mean so the surface keeps its old brightness.
// Cloud shadow wraps all three around the ground-spotlight patch each of them already
// carries, so it captures that patch instead of hiding it. A cloud crossing the road is
// most of the effect: the ribbon is the one surface always in view. The ground light
// (render/groundlight.ts) replaces their physical lobe, and nothing on the road reflects:
// no glint, no wet sheen, no headlamp streaks (owner, 2026-10-16: asphalt in the desert
// is matt, and a road dries in minutes after rain). The per-pixel look (render/
// roadlook.ts: courses, wheel tracks, chips) works on the albedo after the
// vertex colour. The surface's Clean branch (render/cleanstyle.ts) goes outermost on
// the ribbon: it only changes how its two maps are read.
const roadMaterial = applyCleanSurface(applyRoadLook(applyGroundLight(applyCloudShadow(
  applyGroundSpotlightNormals(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
    }),
  ),
))));
/** Dark, weathered aggregate exposed only where the sand falls below the mat edge. */
const roadBedMaterial = applyGroundLight(applyCloudShadow(
  applyGroundSpotlightNormals(
    new THREE.MeshStandardMaterial({
      color: 0x25231f,
      roughness: 1,
      metalness: 0,
    }),
  ),
));
let textureGain = 1;
let texturesAttached = false;

function attachRoadTextures(): void {
  if (texturesAttached) return;
  texturesAttached = true;
  const { map, normal, detail, mean } = roadTextures();
  setRoadDetailMap(detail);
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
  return out.copy(SURFACE_LINEAR[ROAD_START_SURFACE]!).multiplyScalar(textureGain);
}

/**
 * The road ribbon's undecorated lane colour for `surface` at arclength `s`, texture
 * gain included: the sealed surfaces' static albedo, or the regional palette's gravel
 * for a gravel road, exactly as the ribbon's row at `s` starts from (lay-bys).
 */
export function roadLaneVertexColor(out: THREE.Color, surface: SurfaceType, s: number): THREE.Color {
  const base = SURFACE_LINEAR[surface];
  if (base) out.copy(base);
  else out.setHex(desertPaletteAt(s).gravel);
  return out.multiplyScalar(roadVertexColorGain());
}

/**
 * The factor every road vertex colour is multiplied by, so the albedo texture's mean
 * does not darken it: a colour mixed into the asphalt (dust on a lay-by) takes it too.
 */
export function roadVertexColorGain(): number {
  attachRoadTextures();
  return textureGain;
}

const markingMaterial = applyGroundLight(applyCloudShadow(
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
));

/** 1 inside [lo, hi], 0 outside, smoothstepped over `soft` metres at either end. */
function softBand(v: number, lo: number, hi: number, soft: number): number {
  const a = (v - lo) / soft;
  const b = (hi - v) / soft;
  const t = Math.min(1, Math.max(0, Math.min(a, b)));
  return t * t * (3 - 2 * t);
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
   * Lets the shoulder find the ground as the desert tiles draw it. Absent in the labs
   * and benches that build the ribbon without the tile ground: there is then nothing
   * for a shoulder to lie on, and none is built.
   */
  private readonly roadDistance: RoadDistance | null;

  constructor(seed: number, roadDistance: RoadDistance | null = null) {
    this.seed = seed;
    this.roadDistance = roadDistance;
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
   * Both shoulders of one chunk (see SHOULDER_STYLE), hung off the ribbon's own edge
   * vertices so the strip starts exactly where the asphalt ends. Rows are the ribbon's
   * rows, so the seam row is shared with the neighbouring chunk bit for bit.
   */
  private *buildShoulderSteps(
    ctx: ChunkContext,
    positions: Float32Array,
    sCount: number,
    latCount: number,
  ): Generator<void, ShoulderBuild | null> {
    if (!this.roadDistance) return null;
    const { sStart, sEnd, road } = ctx;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const cols = SHOULDER_COLUMNS;
    const guaranteedCols = SHOULDER_ACROSS_M.length;
    const rowVertices = 2 * cols;
    const verts = sCount * rowVertices;
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const detail = new Float32Array(verts);
    const grit = new Float32Array(verts);
    const ground = tileGroundSampler({ seed: this.seed, road, terrain: ctx.terrain, roadDistance: this.roadDistance });
    const g = shoulderGround;
    const point = { x: 0, y: 0, z: 0 };
    // Arclength row index, so the ragged edge is a function of the road, not the chunk.
    const rowBase = Math.round(sStart / SURFACE_STEP);
    const skirtCols = SKIRT_ACROSS_M.length;
    const skirtRowVertices = 2 * skirtCols;
    const skirt = new Float32Array(sCount * skirtRowVertices * 3);

    for (let si = 0; si < sCount; si++) {
      const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
      const halfWidth = road.halfWidthAt(s);
      const cond = roadConditionAt(this.seed, s);
      const style = SHOULDER_STYLE[cond.surface] ?? DEFAULT_SHOULDER_STYLE;
      const palette = desertPaletteAt(s);
      shoulderSand.setHex(palette.sand);
      if (style.stone > 0) {
        shoulderStone.copy(SHOULDER_STONE_LINEAR).multiplyScalar(style.stone / luminance(SHOULDER_STONE_LINEAR));
      } else {
        shoulderStone.setHex(palette.gravel).multiplyScalar(SHOULDER_WINDROW_TONE);
      }
      // A worn road's verge has less grit showing and a narrower fringe.
      const wear = Math.max(cond.decay, cond.sandCover);
      const gritLevel = style.grit * (1 - 0.3 * wear);
      // The fringe past the guaranteed shoulder: the surface's own, narrowed by wear.
      const fringeMean = shoulderFringeM(cond.surface) * (1 - 0.4 * wear);
      // A lay-by's asphalt widens this edge from its entry slip to its exit slip
      // (world/laybymesh.ts). The strip on that side hangs off the lay-by's OUTER edge
      // instead, so it walks out with the slip and back: one verge round the whole
      // outline, with nothing between the asphalt and the sand at the slip's thin end.
      const layby = laybyNear(this.seed, s);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        // Each side's fringe wanders on its own, slow and a little faster on top.
        const k = side === 0 ? 1.7 : 4.3;
        const wander = 1 + 0.55 * Math.sin(s / 23 + k) + 0.3 * Math.sin(s / 7.3 + 2.1 * k);
        const ragged = (hash01(this.seed, 0x5d, rowBase + si, side) - 0.5) * SHOULDER_RAGGED;
        const fringe = Math.max(SHOULDER_FRINGE_MIN, fringeMean * wander + ragged);
        // Where the sand meets the stone (SHOULDER_SAND_*): long waves, each verge its own.
        const sandLine =
          SHOULDER_SAND_LINE_M +
          SHOULDER_SAND_SWING_M *
            (0.55 * Math.sin(s / 8.4 + 2 * k) + 0.3 * Math.sin(s / 4.6 + 3.1 * k) + 0.15 * Math.sin(s / 2.7 + 5.3 * k));
        const reach = SHOULDER_WIDTH_M + fringe;
        // The asphalt's outer edge on this side: the ribbon's own edge vertex, or the
        // lay-by's where it has widened the asphalt (the same point and height its mesh
        // has, `Terrain.laybySurfaceY`).
        const inner = layby?.side === sign ? laybyOuterAt(layby, s, halfWidth) : halfWidth;
        let ex: number;
        let ey: number;
        let ez: number;
        if (inner > halfWidth) {
          road.offsetPoint(s, sign * inner, point);
          ex = point.x - ox;
          ey = ctx.terrain.laybySurfaceY(s, sign * inner, sign);
          ez = point.z - oz;
        } else {
          const edge = (si * latCount + (side === 0 ? 0 : latCount - 1)) * 3;
          ex = positions[edge]!;
          ey = positions[edge + 1]!;
          ez = positions[edge + 2]!;
        }
        ground(ex + ox, ez + oz, g);
        const edgeGround = g.height;
        const drop = ey - edgeGround;
        const collapsed =
          drop > SHOULDER_MAX_DROP || drop < -SHOULDER_MAX_RISE || terminusWeight(ex + ox, ez + oz) > 0;
        // Outward across the road, flat: the direction the formation falls in.
        road.offsetPoint(s, sign * (inner + 1), point);
        const outX = point.x - ox - ex;
        const outZ = point.z - oz - ez;
        const outLength = Math.hypot(outX, outZ) || 1;

        for (let c = 0; c < cols; c++) {
          const d =
            c < guaranteedCols ? SHOULDER_ACROSS_M[c]! : c === guaranteedCols ? SHOULDER_WIDTH_M + fringe * 0.5 : reach;
          const t = d / reach;
          const vi = (si * 2 + side) * cols + c;
          if (c === 0 || collapsed) {
            // On the asphalt's edge, just under its lip; a collapsed row folds the
            // whole strip under it, so its neighbours taper into nothing.
            pos[vi * 3] = ex;
            pos[vi * 3 + 1] = ey - (c === 0 ? 0.004 : SHOULDER_TUCK * 2);
            pos[vi * 3 + 2] = ez;
            nor[vi * 3] = 0;
            nor[vi * 3 + 1] = 1;
            nor[vi * 3 + 2] = 0;
            detail[vi] = 0;
          } else {
            road.offsetPoint(s, sign * (inner + d), point);
            ground(point.x, point.z, g);
            const formation = ey - embankmentDropAt(d);
            pos[vi * 3] = point.x - ox;
            pos[vi * 3 + 2] = point.z - oz;
            if (c === cols - 1 || g.height + SHOULDER_LIFT > formation) {
              // The ragged edge under the sand, or ground standing higher than the
              // formation (a lay-by's levelled site, a ripple): lit and faded like it.
              pos[vi * 3 + 1] =
                c === cols - 1 ? Math.min(formation, g.height) - SHOULDER_TUCK : g.height + SHOULDER_LIFT;
              nor[vi * 3] = g.nx;
              nor[vi * 3 + 1] = g.ny;
              nor[vi * 3 + 2] = g.nz;
              // The tiles drop their fine relief into the vista far off; so does this.
              detail[vi] = g.detail;
            } else {
              pos[vi * 3 + 1] = formation;
              const fall = (embankmentDropAt(d + 0.05) - embankmentDropAt(d - 0.05)) / 0.1;
              const nx = (fall * outX) / outLength;
              const nz = (fall * outZ) / outLength;
              const nl = Math.hypot(nx, 1, nz);
              nor[vi * 3] = nx / nl;
              nor[vi * 3 + 1] = 1 / nl;
              nor[vi * 3 + 2] = nz / nl;
              detail[vi] = 0;
            }
          }

          // Colour: the crushed-stone band from the edge, then the sand itself, which at
          // the last column is exactly the tile's colour there.
          const stoneOut =
            c === cols - 1 ? 1 : smoothstep(sandLine - SHOULDER_BAND_SOFT * 0.5, sandLine + SHOULDER_BAND_SOFT * 0.5, d);
          const mottle =
            1 + SHOULDER_MOTTLE * (1 - stoneOut) * this.mottleNoise.fbm(s / 3.1 + sign * 17, t * 1.3, 2, 2, 0.5);
          shoulderColour
            .copy(shoulderStone)
            .multiplyScalar(mottle * (c === 0 ? 1 - SHOULDER_CRUMB : 1))
            .lerp(shoulderSand, stoneOut);
          col[vi * 3] = shoulderColour.r;
          col[vi * 3 + 1] = shoulderColour.g;
          col[vi * 3 + 2] = shoulderColour.b;
          grit[vi] = gritLevel * (1 - stoneOut);
        }
        // The skirt starts on the strip's own outer vertex, so the two share an edge.
        const outer = ((si * 2 + side) * cols + cols - 1) * 3;
        const outerLateral = inner + reach;
        for (let c = 0; c < skirtCols; c++) {
          const k = ((si * 2 + side) * skirtCols + c) * 3;
          if (c === 0) {
            skirt[k] = pos[outer]!;
            skirt[k + 1] = pos[outer + 1]!;
            skirt[k + 2] = pos[outer + 2]!;
            continue;
          }
          road.offsetPoint(s, sign * (outerLateral + SKIRT_ACROSS_M[c]!), point);
          ground(point.x, point.z, g);
          skirt[k] = point.x - ox;
          skirt[k + 1] = g.height;
          skirt[k + 2] = point.z - oz;
        }
      }
      if ((si & 7) === 7) yield;
    }

    const rowIndices = 2 * (cols - 1) * 6;
    const index = new Uint32Array((sCount - 1) * rowIndices);
    let w = 0;
    for (let si = 0; si < sCount - 1; si++) {
      for (let side = 0; side < 2; side++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = (si * 2 + side) * cols + c;
          const b = a + rowVertices;
          // Up-facing on both sides: which way a quad runs depends on the side.
          if (side === 0) index.set([a, a + 1, b, a + 1, b + 1, b], w);
          else index.set([a, b, a + 1, a + 1, b, b + 1], w);
          w += 6;
        }
      }
    }
    const skirtRowIndices = 2 * (skirtCols - 1) * 6;
    const skirtIndex = new Uint32Array((sCount - 1) * skirtRowIndices);
    w = 0;
    for (let si = 0; si < sCount - 1; si++) {
      for (let side = 0; side < 2; side++) {
        for (let c = 0; c < skirtCols - 1; c++) {
          const a = (si * 2 + side) * skirtCols + c;
          const b = a + skirtRowVertices;
          if (side === 0) skirtIndex.set([a, a + 1, b, a + 1, b + 1, b], w);
          else skirtIndex.set([a, b, a + 1, a + 1, b, b + 1], w);
          w += 6;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aTerrainDetail', new THREE.BufferAttribute(detail, 1));
    geometry.setAttribute('aShoulderGrit', new THREE.BufferAttribute(grit, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return {
      geometry,
      vertices: pos,
      indices: index,
      rowVertices,
      rowIndices,
      skirtVertices: skirt,
      skirtIndices: skirtIndex,
      skirtRowVertices,
      skirtRowIndices,
    };
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
    const latCount = SECTION_COLUMNS;
    // One surface type per chunk drives the collider friction profile. Visual colour
    // is sampled per row below because a material-district boundary can cross a chunk.
    const surface = roadConditionAt(this.seed, (sStart + sEnd) / 2).surface;

    const sCount = Math.round((sEnd - sStart) / SURFACE_STEP) + 1;
    // The road events' extra rows, gap by gap: `eventS` holds their arclengths and
    // gap `si`'s run is eventS[gapRows[si] .. gapRows[si + 1]). Their vertices follow
    // the base rows, extra row `e` at vertex row `sCount + e`.
    const gapRows = new Int32Array(sCount);
    const eventS = new Float64Array((sCount - 1) * EVENT_MAX_KNOTS);
    let extraCount = 0;
    for (let si = 0; si < sCount - 1; si++) {
      gapRows[si] = extraCount;
      const sA = sStart + (si * (sEnd - sStart)) / (sCount - 1);
      const sB = sStart + ((si + 1) * (sEnd - sStart)) / (sCount - 1);
      const n = this.field.eventRows(sA, eventS, extraCount);
      // Chunks are whole multiples of the step, so a gap is always the field's own; a
      // gap that somehow is not keeps its plain quad rather than fold over itself.
      if (n > 0 && eventS[extraCount]! > sA && eventS[extraCount + n - 1]! < sB) extraCount += n;
    }
    gapRows[sCount - 1] = extraCount;
    const rowCount = sCount + extraCount;
    const vertexCount = rowCount * latCount;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    // The per-pixel look's inputs (render/roadlook.ts), every one linear along a row
    // and across it, so the extra rows below interpolate them like the colour.
    const course = new Float32Array(vertexCount * 3);
    const edges = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array((rowCount - 1) * (latCount - 1) * 6);

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
        const cond = roadConditionAt(this.seed, s);
        const laneBase = SURFACE_LINEAR[cond.surface] ?? null;
        // Palette colour is a function of arclength alone: sample once per row, so
        // neighbouring chunks share the seam row and a rebuild is identical.
        const palette = desertPaletteAt(s);
        gravelLinear.setHex(palette.gravel);

        // The asphalt course this row lies on, and the seam near it (see SEAM_REACH_M).
        const baseAlbedo = COURSE_BASE_ALBEDO[cond.surface];
        let seamD = 1;
        let shadeBefore = 1;
        let shadeAfter = 1;
        if (baseAlbedo !== undefined) {
          roadCourseAt(this.seed, s, courseRow);
          seamD = s - courseRow.seam;
          shadeBefore = courseRow.before / baseAlbedo;
          shadeAfter = courseRow.after / baseAlbedo;
          if (Math.abs(seamD) >= SEAM_REACH_M) {
            if (seamD < 0) shadeAfter = shadeBefore;
            else shadeBefore = shadeAfter;
          }
        }
        const trackBase = (TRACK_STRENGTH[cond.surface] ?? 0) * (1 - 0.6 * cond.decay);

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
          color.copy(laneBase ?? gravelLinear);
          this.weather(color, gravelLinear, laneBase ? SHOULDER_STONE_LINEAR : gravelLinear, s, lateral, a, halfWidth, cond.decay);
          // How much of this vertex is bare asphalt, for the course shade and tracks.
          let bare = 1;
          // Repair and rubber go on AFTER the weathering, in the order the road got
          // them: the district wears, then somebody patches it, then somebody locks
          // a wheel up on the patch.
          if (patchRow.weight > 0) {
            const coverage = this.patchCoverageAt(s, lateral, a, halfWidth);
            if (coverage > 0) {
              color.lerp(PATCH_LINEAR, coverage * PATCH_MIX);
              color.multiplyScalar(1 - coverage * PATCH_GLOSS);
              bare *= 1 - coverage * PATCH_MIX;
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

          course[vi * 3] = seamD;
          course[vi * 3 + 1] = 1 + (shadeBefore - 1) * bare;
          course[vi * 3 + 2] = 1 + (shadeAfter - 1) * bare;
          edges[vi * 2] = halfWidth - a;
          edges[vi * 2 + 1] = trackBase * bare;
        }
        yield;
      }

      // The road events' extra rows: each is its gap's base quad interpolated, plus the
      // event and its paint (see ROWS above). Base rows are complete, so both ends of
      // every gap are already written.
      for (let si = 0; si < sCount - 1; si++) {
        const e1 = gapRows[si + 1]!;
        let e = gapRows[si]!;
        if (e === e1) continue;
        const sA = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const sB = sStart + ((si + 1) * (sEnd - sStart)) / (sCount - 1);
        const tint = this.field.eventTint(eventS[e]!);
        if (tint === RoadEventTint.Hole) {
          eventTintColor.setHex(desertPaletteAt(sA).gravel).multiplyScalar(HOLE_SHADE * textureGain);
        } else if (tint === RoadEventTint.Patch) {
          eventTintColor.copy(PATCH_LINEAR).multiplyScalar(textureGain);
        }
        for (; e < e1; e++) {
          const sx = eventS[e]!;
          const t = (sx - sA) / (sB - sA);
          const height = this.field.eventHeight(sx);
          const paint = this.field.eventTintStrength(sx);
          for (let li = 0; li < latCount; li++) {
            const a = si * latCount + li;
            const b = a + latCount;
            const v = (sCount + e) * latCount + li;
            for (let k = 0; k < 3; k++) {
              positions[v * 3 + k] = positions[a * 3 + k]! + (positions[b * 3 + k]! - positions[a * 3 + k]!) * t;
              colors[v * 3 + k] = colors[a * 3 + k]! + (colors[b * 3 + k]! - colors[a * 3 + k]!) * t;
              course[v * 3 + k] = course[a * 3 + k]! + (course[b * 3 + k]! - course[a * 3 + k]!) * t;
            }
            for (let k = 0; k < 2; k++) {
              edges[v * 2 + k] = edges[a * 2 + k]! + (edges[b * 2 + k]! - edges[a * 2 + k]!) * t;
            }
            uvs[v * 2] = uvs[a * 2]! + (uvs[b * 2]! - uvs[a * 2]!) * t;
            uvs[v * 2 + 1] = uvs[a * 2 + 1]! + (uvs[b * 2 + 1]! - uvs[a * 2 + 1]!) * t;
            const weight = this.field.eventColumnWeight(sx, li);
            if (weight === 0) continue;
            positions[v * 3 + 1] += height * weight;
            const ink = paint * weight;
            if (ink <= 0 || tint === RoadEventTint.None) continue;
            if (tint === RoadEventTint.Line) {
              const dark = 1 - EVENT_LINE_DARKEN * ink;
              for (let k = 0; k < 3; k++) colors[v * 3 + k] = colors[v * 3 + k]! * dark;
              continue;
            }
            const mix = (tint === RoadEventTint.Hole ? HOLE_MIX : PATCH_MIX) * ink;
            const gloss = tint === RoadEventTint.Patch ? 1 - PATCH_GLOSS * ink : 1;
            colors[v * 3] = (colors[v * 3]! + (eventTintColor.r - colors[v * 3]!) * mix) * gloss;
            colors[v * 3 + 1] = (colors[v * 3 + 1]! + (eventTintColor.g - colors[v * 3 + 1]!) * mix) * gloss;
            colors[v * 3 + 2] = (colors[v * 3 + 2]! + (eventTintColor.b - colors[v * 3 + 2]!) * mix) * gloss;
          }
        }
        yield;
      }

      let ii = 0;
      for (let si = 0; si < sCount - 1; si++) {
        ii = gapQuads(indices, ii, si, gapRows, latCount, 0, sCount, 0);
        yield;
      }

      const geometry = new THREE.BufferGeometry();
      disposables.push(geometry);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('aRoadCourse', new THREE.BufferAttribute(course, 3));
      geometry.setAttribute('aRoadEdge', new THREE.BufferAttribute(edges, 2));
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
      yield;

      const shoulder = yield* this.buildShoulderSteps(ctx, positions, sCount, latCount);
      if (shoulder) {
        disposables.push(shoulder.geometry);
        const shoulderMesh = new THREE.Mesh(shoulder.geometry, DESERT_SHOULDER_MATERIAL);
        shoulderMesh.receiveShadow = true;
        group.add(shoulderMesh);
        if (hasPhysics) {
          // Slabs, as the ribbon's: rows of the same vertices, sharing boundary rows. The
          // drawn strip is loose shoulder; the skirt beyond it is the tiles' own ground.
          const parts = [
            [shoulder.vertices, shoulder.indices, shoulder.rowVertices, shoulder.rowIndices, SurfaceType.LooseShoulder],
            [shoulder.skirtVertices, shoulder.skirtIndices, shoulder.skirtRowVertices, shoulder.skirtRowIndices, TERRAIN_COLLIDER_SURFACE],
          ] as const;
          for (const [vertices, indices, rowVertices, rowIndices, surface] of parts) {
            for (let q0 = 0; q0 < sCount - 1; q0 += COLLIDER_SLAB_QUADS) {
              const q1 = Math.min(q0 + COLLIDER_SLAB_QUADS, sCount - 1);
              const slabVertices = vertices.subarray(q0 * rowVertices * 3, (q1 + 1) * rowVertices * 3);
              const slabIndices = indices.slice(q0 * rowIndices, q1 * rowIndices);
              const rebase = q0 * rowVertices;
              for (let i = 0; i < slabIndices.length; i++) slabIndices[i] = slabIndices[i]! - rebase;
              const collider = physics.addStaticTrimesh(slabVertices, slabIndices, surface);
              collider.setEnabled(false);
              colliders.push(collider);
              const body = collider.parent();
              if (body) bodies.push(body);
              yield;
            }
          }
        }
      }

      if (hasPhysics) {
        // ONE TRIMESH PER SLAB, not one per chunk. Rapier builds a BVH inside
        // `trimesh`, and for a whole 200 m chunk (5400 triangles) that is a single
        // 10-50 ms native call no generator yield can interrupt — measured as the
        // last remaining streaming hitch. Row slabs are the same vertices in the
        // same order, so the collided surface is bit-identical; adjacent slabs share
        // their boundary row, so there is no seam to fall through. A slab whose gaps
        // hold road events carries their extra rows after its base rows, split the
        // same way as the mesh.
        //
        // `positions` is already origin-relative (subtracted at the write site
        // above); subtracting again here would double-apply the offset and drop the
        // collider a whole chunk's origin away from the mesh.
        for (let q0 = 0; q0 < sCount - 1; q0 += COLLIDER_SLAB_QUADS) {
          const q1 = Math.min(q0 + COLLIDER_SLAB_QUADS, sCount - 1);
          const e0 = gapRows[q0]!;
          const e1 = gapRows[q1]!;
          const baseRows = q1 - q0 + 1;
          const baseVertices = positions.subarray(q0 * latCount * 3, (q1 + 1) * latCount * 3);
          let slabVertices = baseVertices;
          if (e1 > e0) {
            slabVertices = new Float32Array((baseRows + e1 - e0) * latCount * 3);
            slabVertices.set(baseVertices, 0);
            slabVertices.set(
              positions.subarray((sCount + e0) * latCount * 3, (sCount + e1) * latCount * 3),
              baseRows * latCount * 3,
            );
          }
          const slabIndices = new Uint32Array((q1 - q0 + e1 - e0) * (latCount - 1) * 6);
          let si2 = 0;
          for (let si = q0; si < q1; si++) {
            si2 = gapQuads(slabIndices, si2, si, gapRows, latCount, q0, baseRows, e0);
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
        road, sStart, sEnd, sCount, gapRows, eventS, ox, oz,
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
   * Wears the lane colour at one vertex: settled dust, a ravelled outer edge, and
   * coarse tonal mottling on top (see DUST_LIGHTEN). The wheel tracks are per pixel
   * (render/roadlook.ts), because their edges are finer than these columns.
   *
   * Everything scales with `decay` in the direction the desert takes it: an
   * abandoned road gains dust and frays at the edge. `ravel` is what the edge frays
   * into: the shoulder's stone beside a sealed road, the road's own beside gravel.
   */
  private weather(
    color: THREE.Color,
    gravel: THREE.Color,
    ravel: THREE.Color,
    s: number,
    lateral: number,
    a: number,
    halfWidth: number,
    decay: number,
  ): void {
    const dust = DUST_LIGHTEN * decay;
    color.multiplyScalar(1 + dust);
    if (dust > 0) color.lerp(gravel, dust * DUST_TINT);

    // Ravelled edge: the mat frays into the verge rather than ending at a line.
    const intoEdge = 1 - Math.min(1, (halfWidth - a) / EDGE_RAVEL);
    if (intoEdge > 0) {
      const t = intoEdge * intoEdge;
      color.lerp(ravel, t * EDGE_RAVEL_MIX * (0.6 + decay * 0.4));
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
        roadConditionAt(this.seed, event.s).markings < PAINT_EFFECTIVE
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
    gapRows: Int32Array,
    eventS: Float64Array,
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
      // mesh vertices rather than floating across a bump or pothole — and split at a
      // gap's road-event rows, so a line runs down into a hole and over a hump with
      // the mat instead of bridging it.
      for (let si = 0; si < sCount - 1; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const s1 = s + SURFACE_STEP;
        const e0 = gapRows[si]!;
        const e1 = gapRows[si + 1]!;
        const condition = roadConditionAt(this.seed, s);
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
            road, 0, 0, s, s1, MARKING_HALF_WIDTH, eventS, e0, e1,
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
                road, lateral0, lateral1, s, s1, MARKING_HALF_WIDTH, eventS, e0, e1,
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
                s, s1, RUMBLE_HALF_WIDTH, eventS, e0, e1,
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

  /**
   * One stripe across the gap `s0`..`s1`, as one quad per stretch between the gap's
   * rows: the base rows at its ends and the road-event rows `eventS[e0..e1)` inside.
   */
  private emitMarkingQuad(
    road: Road,
    lateral0: number,
    lateral1: number,
    s0: number,
    s1: number,
    /** Half-width of this stripe. A painted line and a rumble band differ only here. */
    half: number,
    eventS: Float64Array,
    e0: number,
    e1: number,
    ox: number,
    oz: number,
    point: { x: number; y: number; z: number },
    color: THREE.Color,
    positions: number[],
    colors: number[],
  ): void {
    let sa = s0;
    let la = lateral0;
    for (let e = e0; e <= e1; e++) {
      const sb = e < e1 ? eventS[e]! : s1;
      const lb = lateral0 + ((lateral1 - lateral0) * (sb - s0)) / (s1 - s0);
      // Four corners [c00, c01, c10, c11]; emit triangles c00,c10,c01 and c10,c11,c01.
      this.markingCorner(road, sa, la - half, s0, s1, ox, oz, point);
      const x00 = point.x; const y00 = point.y; const z00 = point.z;
      this.markingCorner(road, sa, la + half, s0, s1, ox, oz, point);
      const x01 = point.x; const y01 = point.y; const z01 = point.z;
      this.markingCorner(road, sb, lb - half, s0, s1, ox, oz, point);
      const x10 = point.x; const y10 = point.y; const z10 = point.z;
      this.markingCorner(road, sb, lb + half, s0, s1, ox, oz, point);
      const x11 = point.x; const y11 = point.y; const z11 = point.z;

      const order = [0, 2, 1, 2, 3, 1];
      const xs = [x00, x01, x10, x11];
      const ys = [y00, y01, y10, y11];
      const zs = [z00, z01, z10, z11];
      for (const i of order) {
        positions.push(xs[i]!, ys[i]!, zs[i]!);
        colors.push(color.r, color.g, color.b);
      }
      sa = sb;
      la = lb;
    }
  }

  /**
   * A marking corner at (s, lateral), in the gap `gapA`..`gapB`. On a base row it is
   * the shared surface; between them it is what the ribbon's extra row there is — the
   * gap's two base rows interpolated, plus the road event — so paint and mat agree.
   */
  private markingCorner(
    road: Road,
    s: number,
    lateral: number,
    gapA: number,
    gapB: number,
    ox: number,
    oz: number,
    out: { x: number; y: number; z: number },
  ): void {
    // Absolute in, relative out: `roadSurfaceY` feeds the surface field's 2D edge
    // noise with this point's world position, so it must see the absolute x/z. The
    // subtraction happens only after the height is resolved, on the way into the
    // marking's Float32Array.
    if (s === gapA || s === gapB) {
      road.offsetPoint(s, lateral, out);
      out.y = roadSurfaceY(road, this.field, s, lateral, out.x, out.z) + MARKING_LIFT;
    } else {
      const t = (s - gapA) / (gapB - gapA);
      road.offsetPoint(gapA, lateral, out);
      const ax = out.x;
      const az = out.z;
      const ay = roadSurfaceY(road, this.field, gapA, lateral, ax, az);
      road.offsetPoint(gapB, lateral, out);
      const by = roadSurfaceY(road, this.field, gapB, lateral, out.x, out.z);
      out.x = ax + (out.x - ax) * t;
      out.z = az + (out.z - az) * t;
      out.y =
        ay + (by - ay) * t + this.field.eventAt(s, lateral, road.halfWidthAt(s)) + MARKING_LIFT;
    }
    out.x -= ox;
    out.z -= oz;
  }
}
