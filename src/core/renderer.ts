import * as THREE from 'three';
import '../render/lightshader';
import { primeMaxAnisotropy } from '../render/texturequality';
import { AdaptiveResolutionController } from './adaptivequality';
import {
  DEFAULT_FIELD_OF_VIEW,
  DEFAULT_INK_STRENGTH,
  GRAPHICS_TIERS,
  RENDER_SCALES,
  shadowsFor,
  type GraphicsQuality,
  type RenderScale,
  type RenderScaleFraction,
} from '../game/settings';
import type { ShadeTint } from '../items/items';

/**
 * Renderer, scene and camera ownership.
 *
 * The far plane and fog are set up for the desert vista: the horizon runs to a few
 * kilometres and must still resolve, so the far plane is 4 km and fog is exponential
 * rather than linear. Linear fog over that range either erases the middle distance
 * or leaves the horizon looking like a flat card.
 */

/**
 * Far-plane floor in metres. The sky dome (DOME_RADIUS = 3000 in render/sky.ts)
 * needs at least this much reach, so `setViewDistance` never drops below it: the
 * drawn horizon may shrink, but the dome must keep resolving.
 */
export const CAMERA_FAR = 4000;
/**
 * Near-plane floor in metres. The hood camera sits a hand's width off the bonnet,
 * so this must clear the panel it is mounted on without slicing into it.
 * `setViewDistance` only ever raises this, never lowers it.
 */
export const CAMERA_NEAR = 0.08;
/** Exterior-camera near plane for a configured far plane. */
export function nearPlaneForFarPlane(far: number): number {
  return Math.max(CAMERA_NEAR, far / MAX_DEPTH_RATIO);
}

/**
 * Standoff margin, metres: the far plane is measured from the CAMERA, not from the
 * car, so it has to clear the draw distance by at least the chase arm's reach
 * (DIST_MAX in render/cameras.ts) or the camera clips the far edge of the desert it
 * can still see past the car. Rounded well clear of that 7 m arm.
 */
const CAMERA_STANDOFF_MARGIN = 32;

/** Far plane shared by the camera and the vista that closes its ground horizon. */
export function farPlaneForViewDistance(metres: number): number {
  return Math.max(CAMERA_FAR, metres + CAMERA_STANDOFF_MARGIN);
}

/**
 * Ceiling on the far/near ratio. A perspective camera spends its depth
 * precision on a 1/z budget and the near plane fixes how much of that budget
 * the near region (the car's own panels) receives, so when the far plane
 * stretches out for `vast` the near plane must rise with it or the panels lose
 * the depth resolution they had at the default 4 km far plane. 160000 is the
 * ratio, held well under the ~200000:1 point beyond which a 16-bit depth
 * buffer starts to z-fight on the panels, rather than sitting on that bound.
 */
const MAX_DEPTH_RATIO = 160000;

/**
 * A DISPLAY can never ask for more pixels than the rung allows, and that is the whole
 * of this file's resolution policy now.
 *
 * It used to be a display PERCENTAGE: `min(DPR x multiplier, DPR cap)`. On a screen whose
 * device-pixel-ratio is 1 — every 4K television, every monitor at 100% scaling — that
 * resolves to exactly 1.0 at every rung, so a mini-PC on a television and a workstation
 * on the same television were both asked to shade 8.29 megapixels. Measured across the
 * machines this game runs on, `standard` was the same load on an Intel N100 as on an RTX
 * 4090, and the only rung beneath it was a 5.8x cliff with nothing in between.
 *
 * An absolute ceiling per rung fixes that at the root: below the ceiling the display's
 * own sharpness still decides what to render, and above it a supersampling multiplier
 * lets the top rung spend headroom it is told it has. `GRAPHICS_TIERS` owns the numbers;
 * this is only the arithmetic that spends them.
 */
/** Ceiling on device-pixel-ratio, whatever a display claims: past 2 it is not sharpness. */
const MAX_PIXEL_RATIO = 2;

/**
 * The drawing-buffer scale for a rung on a display, as a pure function.
 *
 * Pure and exported because it is the whole of the resolution policy and it is the part
 * that was wrong: a policy reachable only through a live WebGL context is a policy nobody
 * checks, and the bug it carried — a display percentage that resolved to exactly 1.0 on
 * every ratio-1 screen, so a 4K television cost a mini-PC and a workstation the same
 * 8.29 megapixels — survived because the only way to see it was to own the television.
 * `tools/graphics-tiers.ts` drives this directly.
 */
export function renderScaleFor(
  quality: GraphicsQuality,
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  const ceiling = mobilePresentation ? tier.mobileMaxPixels : tier.maxPixels;
  // Three terms, each answering a different question: what the display wants (`dpr`),
  // what this rung is willing to supersample to (`supersample`), and what the rung's
  // absolute budget will pay for. The smallest wins, so a 4K television can never
  // exceed the budget and a small retina panel is never downscaled below its sharpness.
  return Math.min(
    devicePixelRatio * tier.supersample,
    MAX_PIXEL_RATIO,
    Math.sqrt(ceiling / Math.max(1, cssPixels)),
  );
}

/** Where dynamic resolution stops for a rung, as the same kind of scale. */
export function minimumScaleFor(
  quality: GraphicsQuality,
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  const floor = mobilePresentation ? tier.mobileMinPixels : tier.minPixels;
  const base = cssPixels * devicePixelRatio * devicePixelRatio;
  return Math.min(1, Math.sqrt(floor / Math.max(1, base)));
}

/**
 * The drawing-buffer scale a player's explicit render-scale choice asks for.
 *
 * A fraction of the DISPLAY, not of the rung. `renderScaleFor` above is a rung spending
 * its own budget; this is a player refusing that budget in either direction — down,
 * because three rungs on a 4K television are 1.44, 3.69 and 12.96 megapixels and a
 * machine is not three machines, and up, because supersampling was reachable only by
 * also buying a 25 km vista and eighteen headlamps. The DPR cap still applies before
 * the fraction, because past 2 it is not sharpness, it is arithmetic.
 *
 * The one thing it will not be is unbounded. The top rung's ceiling is the most this
 * game ever draws on purpose, so it bounds a manual choice too: without it, 150% on a
 * retina laptop asks for 20 megapixels, and a player who cannot reach ten frames a
 * second cannot reach the menu that would undo it either.
 */
export function manualRenderScale(
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
  fraction: number,
): number {
  const top = GRAPHICS_TIERS.blessing;
  const ceiling = mobilePresentation ? top.mobileMaxPixels : top.maxPixels;
  return Math.min(
    Math.min(devicePixelRatio, MAX_PIXEL_RATIO) * fraction,
    Math.sqrt(ceiling / Math.max(1, cssPixels)),
  );
}

/**
 * The offered fractions that actually differ on THIS display, plus whichever one the
 * player is already on.
 *
 * The bound in `manualRenderScale` is absolute, so it flattens the top of the row on a
 * large display: on a 4K television 125% and 150% both resolve to the top rung's
 * ceiling, and on a phone every choice from 100% up does — three buttons with one
 * outcome, which is a menu describing a resolution it cannot deliver. The row is built
 * from the display instead of from the list.
 *
 * `current` is retained whatever it resolves to, because a player who carried a stored
 * 150% to a 4K television must still see which button he is on.
 */
export function offeredRenderScales(
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
  current: RenderScale = null,
): readonly RenderScaleFraction[] {
  const offered: RenderScaleFraction[] = [];
  let previous = 0;
  for (const fraction of RENDER_SCALES) {
    const ratio = manualRenderScale(cssPixels, devicePixelRatio, mobilePresentation, fraction);
    if (ratio <= previous && fraction !== current) continue;
    offered.push(fraction);
    previous = Math.max(previous, ratio);
  }
  return offered;
}
/**
 * Four samples was the only useful multisampling level in measurement: 2x retained
 * almost all of the cost. Whether it is enabled is an independent display setting;
 * graphics tiers control resolution and shadows.
 */
const MSAA_SAMPLES = 4;

/** Touch plus a coarse pointer or phone-sized screen avoids classifying touch laptops. */
export function prefersMobilePresentation(): boolean {
  if (navigator.maxTouchPoints <= 0) return false;
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const phoneSized = Math.min(window.screen.width, window.screen.height) <= 600;
  return coarse || phoneSized;
}

// ---------------------------------------------------------------------------
// Heat haze: refraction through the hot layer over the sand, as a post pass.
//
// Shimmer is not a screen effect that happens near the horizon. It is what a sight
// line does when it spends a long way inside air whose refractive index is being
// stirred by convection, and everything below follows from that one sentence:
//
//   WHERE     the hot air is a shallow layer lying on the ground. For each pixel the
//             shader integrates that layer along the pixel's own world-space view ray,
//             FROM THE EYE TO THE SURFACE THE PIXEL SHOWS. Light from a pole 150 m
//             away has crossed 150 m of hot air, not the three kilometres that light
//             from the terrain behind it has, and it boils that much less; the old
//             integral ran every ray to infinity and only used depth as a gate, so a
//             nearby object on the horizon line shimmered exactly as hard as the far
//             desert. A steep ray leaves the layer at once and gets nothing, which is
//             why the sky is still. A grazing ray runs for hundreds of metres, which is
//             why the horizon boils. The road and nearby objects remain rigid because
//             their real depth never reaches the haze.
//
//             "The ground" is not the ground under the camera. It is a line fitted to
//             the terrain the view actually grazes, hundreds of metres out along the
//             look direction (render/heathaze.ts), supplied as a height over it and a
//             slope. From a crest thirty metres above a plain the eye is thirty metres
//             above the hot air, and the horizon over the valley barely moves; looking
//             up a dune field that rises toward the skyline, the line rises with it and
//             the distant crests stay inside the layer. That is what lets the layer
//             itself be thin, which is what keeps the shimmer out of the open sky.
//
//             Nothing about this is measured in screen rows, and that is the point:
//             the old version decayed from a computed horizon ROW, so pitching the
//             camera slid the whole band across the world and rolling it left the
//             band stubbornly horizontal. A path length through a slab is a property
//             of the ray, so it is automatically right at any attitude.
//
//   HOW MUCH  deflections accumulate along the path, so amplitude grows with it and
//             saturates. In ANGLE, not in pixels: converted through the live field of
//             view, so zooming in with the binoculars magnifies the boil exactly as
//             it magnifies everything else. The old fixed pixel amplitude did not,
//             and read as a distortion filter welded to the screen. The strength
//             itself follows how hot the ground is (render/heathaze.ts), not how high
//             the sun is: nothing at dawn, a peak in the early afternoon, gone before
//             the sun is down.
//
//   OF WHAT   a field of thin horizontal strata in DIRECTION space — azimuth round the
//             eye and elevation — not a field in world position. Pan, and the pattern
//             stays over the same part of the desert, because that is what looking at
//             the same air twice means. Translation is deliberately absent. The
//             coherent part of the perturbation is set by the far half of the ray,
//             hundreds of metres out, which does not change when the car moves thirty
//             metres; letting position in would smear the field past the eye at
//             v/cellSize — tens of Hz at road speed, which is scintillation, not
//             shimmer. All the motion comes from the field's own rise.
//
//   AND THE MIRROR  where the hot ground is flat and the sight line meets it more
//             steeply than nothing but less steeply than its critical angle, the
//             layer turns the ray back up: the ground a few hundred metres ahead shows
//             the sky above the horizon, upside down. That is the "wet road". It is
//             the one part of an inferior mirage that is ever big enough to see; the
//             other part, distant ground appearing sunk by a milliradian, is a
//             fraction of a pixel and is not drawn. (The old pass drew it anyway, as a
//             LIFT, and with the sign of a superior mirage: hot air below cool bends
//             the ray up, so the eye sees ground from above its true position and the
//             image sinks, it does not rise.)
// ---------------------------------------------------------------------------

/**
 * Scale height of the hot air over the sand, metres.
 *
 * NOT a hard-edged slab, and the difference matters. A slab clipped at head height is
 * geometrically exact over a flat plane and useless over this desert: measured on the
 * real pass (tools/haze-probe.ts), a hard slab put every last milliradian inside one
 * degree of the horizon and left a razor line. So the air thins with height instead
 * of stopping, `exp(-y / H)`, and the shader integrates that along the ray in closed
 * form.
 *
 * WAS EIGHT METRES, and eight was the problem. It was inflated to stand in for relief
 * — a dune four hundred metres away and fifteen tall had to stay inside the layer —
 * and the price was paid in the sky: a climbing ray kept most of its path for degrees
 * above the horizon, so the boil reached about five degrees up and under one down,
 * which is upside down. Relief is now the grazed-ground line's job (see WHERE above),
 * and two and a half metres is the depth of air a sunlit sand surface genuinely
 * stirs: a metre or so of superheated air plus the convective mixing just above it.
 * From a standing eye, half of full shimmer is then about 0.6 degrees above the
 * horizon and 0.5 below it; from a car's chase camera, three metres up, the ground
 * side is the larger of the two, as it should be (tools/haze-probe.ts measures both).
 */
const HAZE_SCALE_HEIGHT_M = 2.5;
/**
 * Path length inside the layer, metres, at which the shimmer is fully developed.
 *
 * Deflections along a stirred path add as a random walk, so the honest law is
 * `sqrt(L)`. It is not used raw. A random walk of tiny deflections is also a random
 * walk of tiny CELLS, and the fine structure a short path accumulates averages itself
 * away before it is large enough on screen to be seen at all — sqrt puts a fifth of
 * full shimmer on ground twenty metres away, which nobody sees in reality. The onset
 * below is therefore shaped: nothing for the first tens of metres, building through
 * the middle distance, saturated at the horizon. 250 m against the thinner layer
 * above puts full development on flat ground about 340 m out from a standing eye.
 */
const HAZE_REF_PATH_M = 250;
/** Scene geometry closer than this many metres remains completely free of shimmer. */
const HAZE_NEAR_CLEAR_M = 45;
/**
 * Scene distance by which the actual depth buffer may receive full path-based haze.
 *
 * Also the line for the silhouette test: a displaced sample may never land on a
 * surface nearer than this that is also well in front of the pixel being drawn. Light
 * that reached the eye along a ray which missed the car cannot have come FROM the car,
 * and taking its colour anyway is what drew a wobbling fringe of paint round every
 * nearby silhouette against the boiling horizon — tens of pixels of it under the
 * binoculars.
 */
const HAZE_NEAR_FULL_M = 140;
/**
 * A second, deliberately conservative ground-ray guard.
 *
 * Depth is authoritative for objects, but ground pixels are the one surface where an
 * unresolved/cleared depth sample is visually catastrophic: the road texture boils
 * under the player's feet. Keep descending rays rigid until their intersection with
 * the local ground plane is well into the middle distance. This is independent of
 * asphalt/gravel material and only backs up depth; its transition is too far away to
 * form the old moving foreground patch.
 */
const HAZE_GROUND_CLEAR_M = 70;
const HAZE_GROUND_FULL_M = 180;
/**
 * Peak angular displacement, milliradians, at full development.
 *
 * Under two pixels at 1080p and the default field of view. It was 3.6, and 7.2 before
 * that, on cells several degrees across, which read as jelly. On the fine strata below
 * a displacement larger than about half a stratum folds the image over itself and
 * stops reading as refraction at all, so the amplitude came down with the cells. The
 * real thing is smaller still — tenths of a milliradian — but real eyes resolve a
 * tenth of a milliradian and a 1080p frame does not.
 */
const HAZE_ANGLE_MRAD = 1.8;
/** Share of the displacement that is lateral. Stratified air bends light vertically. */
const HAZE_LATERAL_SHARE = 0.3;
/**
 * Angular size of the field's strata, milliradians, measured vertically.
 *
 * Two octaves on a direction-space lattice. The old cells were 1.3 and 3.2 DEGREES
 * and stretched upright, as if the air were a stack of rising plumes; at grazing
 * incidence it is the opposite, a layered medium whose eddies are flattened against
 * the ground, and the shimmer over a hot plain is fine, horizontal and ribbed. So
 * each stratum is `HAZE_STRIATION` times wider than it is tall: seven milliradians
 * is about six pixels at 1080p and the default field of view, 2.8 about two and a
 * half.
 */
const HAZE_BROAD_CELL_MRAD = 7;
const HAZE_FINE_CELL_MRAD = 2.8;
/** Width over height of a stratum. */
const HAZE_STRIATION = 4;
/**
 * How fast each octave climbs, strata per second.
 *
 * In strata rather than metres because what the eye sees is a flicker rate, and that
 * is the same at every range: about one hertz of slow boil with three of flicker
 * inside it.
 */
const HAZE_BROAD_RISE_HZ = 1.0;
const HAZE_FINE_RISE_HZ = 3.0;
/**
 * Distance band over which the fine octave takes over from the broad one, metres.
 *
 * The angular size of an eddy is its size over its range, so the same air seen from
 * further away ripples at a higher angular frequency: the ground two hundred metres
 * out swims in broad strata and the skyline three kilometres out shivers in fine ones.
 * Both octaves are fixed in angle and only their MIX follows the depth. Scaling one
 * lattice by depth instead would zoom it about its origin whenever the depth under a
 * pixel changed — which it does continuously while driving — and slide the whole
 * pattern at many strata per second.
 */
const HAZE_FINE_ONSET_M = 160;
const HAZE_FINE_FULL_M = 900;
/**
 * Critical grazing angle of the hot ground at full heat, milliradians.
 *
 * A ray that meets a layer whose refractive index falls by Δn toward the ground is
 * turned back up if it arrives flatter than `sqrt(2·Δn)`. Sand and asphalt thirty
 * degrees hotter than the air above them give Δn ≈ 3e-5, so about eight milliradians
 * — under half a degree. From a driver's eye that is the ground from about 150 m out;
 * from a standing player's, about 230 m. The angle grows with the square root of the
 * heating, so a mild morning mirage sits further off than an afternoon one.
 */
const HAZE_MIRAGE_CRITICAL_MRAD = 8;
/**
 * How much of the mirrored sky replaces the ground in the mirage band, at full heat.
 *
 * Not all of it. The reflection is total only for the rays that reach the hottest
 * few centimetres; the rest of the pixel's footprint is ordinary ground, and on a
 * rough desert surface it is patchy. Past about two thirds it reads as painted water.
 */
const HAZE_MIRAGE_BLEND = 0.55;
/**
 * Floor on the camera's height above the sand, metres.
 *
 * The camera can legitimately sit level with or below the ground it is looking across
 * — on a crest, inside a scoop, or with a bonnet view on a rise — and a zero or
 * negative height would put the eye outside the hot layer looking in, which switches
 * the effect off exactly where the desert is at its most open. Half a metre keeps the
 * eye inside the layer whatever the terrain does under it.
 */
const HAZE_MIN_EYE_ABOVE_M = 0.5;
/** Eye height assumed before the loop has supplied a real one: a standing player. */
const DEFAULT_EYE_HEIGHT_M = 1.6;
/**
 * Period of the rise phases, in strata. The lattice wraps its vertical index at this
 * count, so the phase can be reduced modulo it on the CPU and the shader only ever
 * sees a number below 256 — see `advanceHazePhase`.
 */
export const HAZE_PHASE_PERIOD = 256;
/**
 * Period of the pass's own clock, seconds. The grain seed steps at 12 Hz through 64
 * frames, and 1600 s is exactly 300 of those cycles, so the wrap is invisible.
 */
const HAZE_CLOCK_PERIOD_S = 1600;

export interface HeatMirageParameters {
  readonly scaleHeightM: number;
  readonly referencePathM: number;
  readonly nearClearM: number;
  readonly nearFullM: number;
  readonly groundClearM: number;
  readonly groundFullM: number;
  readonly angleMrad: number;
  readonly lateralShare: number;
  readonly broadCellMrad: number;
  readonly fineCellMrad: number;
  readonly striation: number;
  readonly broadRiseHz: number;
  readonly fineRiseHz: number;
  readonly fineOnsetM: number;
  readonly fineFullM: number;
  readonly mirageCriticalMrad: number;
  readonly mirageBlend: number;
  readonly minimumEyeHeightM: number;
}

export const DEFAULT_HEAT_MIRAGE: HeatMirageParameters = {
  scaleHeightM: HAZE_SCALE_HEIGHT_M,
  referencePathM: HAZE_REF_PATH_M,
  nearClearM: HAZE_NEAR_CLEAR_M,
  nearFullM: HAZE_NEAR_FULL_M,
  groundClearM: HAZE_GROUND_CLEAR_M,
  groundFullM: HAZE_GROUND_FULL_M,
  angleMrad: HAZE_ANGLE_MRAD,
  lateralShare: HAZE_LATERAL_SHARE,
  broadCellMrad: HAZE_BROAD_CELL_MRAD,
  fineCellMrad: HAZE_FINE_CELL_MRAD,
  striation: HAZE_STRIATION,
  broadRiseHz: HAZE_BROAD_RISE_HZ,
  fineRiseHz: HAZE_FINE_RISE_HZ,
  fineOnsetM: HAZE_FINE_ONSET_M,
  fineFullM: HAZE_FINE_FULL_M,
  mirageCriticalMrad: HAZE_MIRAGE_CRITICAL_MRAD,
  mirageBlend: HAZE_MIRAGE_BLEND,
  minimumEyeHeightM: HAZE_MIN_EYE_ABOVE_M,
};

/**
 * What the world tells the pass about the heat this frame. Produced by
 * render/heathaze.ts, which is the only thing that knows the terrain, the sun, the
 * air and the cloud shade at once.
 */
export interface HeatHazeFrame {
  /** Shimmer strength, 0..1. */
  readonly shimmer: number;
  /** Inferior-mirage strength, 0..1: heat, flat ground and sun on it. */
  readonly mirage: number;
  /** Eye height over the grazed-ground line, metres. */
  readonly eyeAboveM: number;
  /** Rise of that line per metre along the view. */
  readonly groundSlope: number;
}

/**
 * Advances one octave's rise phase by `dt` seconds, wrapped into the lattice period.
 *
 * The phase used to be `uTime * rate` in the shader, with uTime the page's uptime:
 * after a few hours of play that product is large enough that a float32 steps in
 * visible fractions of a stratum, and after a day the boil would stutter. Reducing it
 * here, in doubles, against a period the lattice itself repeats at, keeps the number
 * the GPU sees below 256 forever and makes the wrap seamless.
 */
export function advanceHazePhase(phase: number, dt: number, rateHz: number): number {
  const next = (phase + dt * rateHz) % HAZE_PHASE_PERIOD;
  return next < 0 ? next + HAZE_PHASE_PERIOD : next;
}

/** Strata round the full circle of azimuth: a whole number, so the lattice closes. */
function strataAround(cellMrad: number, striation: number): number {
  return Math.max(1, Math.round((2 * Math.PI * 1000) / (Math.max(0.1, cellMrad) * Math.max(0.1, striation))));
}

/** The pass's physical constants as uniform cells, one per shader name. */
export interface HeatMirageUniforms {
  readonly SCALE_HEIGHT_M: { value: number };
  readonly REF_PATH_M: { value: number };
  readonly NEAR_CLEAR_M: { value: number };
  readonly NEAR_FULL_M: { value: number };
  readonly GROUND_CLEAR_M: { value: number };
  readonly GROUND_FULL_M: { value: number };
  readonly ANGLE_RAD: { value: number };
  readonly LATERAL_SHARE: { value: number };
  readonly BROAD_AROUND: { value: number };
  readonly BROAD_UP: { value: number };
  readonly FINE_AROUND: { value: number };
  readonly FINE_UP: { value: number };
  readonly FINE_ONSET_M: { value: number };
  readonly FINE_FULL_M: { value: number };
  readonly MIRAGE_CRITICAL_RAD: { value: number };
  readonly MIRAGE_BLEND: { value: number };
}

/**
 * Fresh uniform cells for every material that compiles the production mirage pass.
 * The cells are spread into the material, so the object returned here stays the
 * live handle: `writeHeatMirageUniforms` on it retunes the compiled pass.
 */
export function createHeatMirageUniforms(
  parameters: HeatMirageParameters = DEFAULT_HEAT_MIRAGE,
): HeatMirageUniforms {
  const uniforms: HeatMirageUniforms = {
    SCALE_HEIGHT_M: { value: 0 },
    REF_PATH_M: { value: 0 },
    NEAR_CLEAR_M: { value: 0 },
    NEAR_FULL_M: { value: 0 },
    GROUND_CLEAR_M: { value: 0 },
    GROUND_FULL_M: { value: 0 },
    ANGLE_RAD: { value: 0 },
    LATERAL_SHARE: { value: 0 },
    BROAD_AROUND: { value: 0 },
    BROAD_UP: { value: 0 },
    FINE_AROUND: { value: 0 },
    FINE_UP: { value: 0 },
    FINE_ONSET_M: { value: 0 },
    FINE_FULL_M: { value: 0 },
    MIRAGE_CRITICAL_RAD: { value: 0 },
    MIRAGE_BLEND: { value: 0 },
  };
  writeHeatMirageUniforms(uniforms, parameters);
  return uniforms;
}

/**
 * The one place parameters become uniform values, shared by construction and the
 * lab's live edits so the two cannot disagree about a clamp or a unit.
 */
function writeHeatMirageUniforms(
  uniforms: HeatMirageUniforms,
  parameters: HeatMirageParameters,
): void {
  uniforms.SCALE_HEIGHT_M.value = Math.max(0.1, parameters.scaleHeightM);
  uniforms.REF_PATH_M.value = Math.max(1, parameters.referencePathM);
  const nearClear = Math.max(0, parameters.nearClearM);
  uniforms.NEAR_CLEAR_M.value = nearClear;
  uniforms.NEAR_FULL_M.value = Math.max(nearClear + 1, parameters.nearFullM);
  const groundClear = Math.max(0, parameters.groundClearM);
  uniforms.GROUND_CLEAR_M.value = groundClear;
  uniforms.GROUND_FULL_M.value = Math.max(groundClear + 1, parameters.groundFullM);
  uniforms.ANGLE_RAD.value = Math.max(0, parameters.angleMrad) / 1000;
  uniforms.LATERAL_SHARE.value = Math.min(1, Math.max(0, parameters.lateralShare));
  uniforms.BROAD_AROUND.value = strataAround(parameters.broadCellMrad, parameters.striation);
  uniforms.BROAD_UP.value = 1000 / Math.max(0.1, parameters.broadCellMrad);
  uniforms.FINE_AROUND.value = strataAround(parameters.fineCellMrad, parameters.striation);
  uniforms.FINE_UP.value = 1000 / Math.max(0.1, parameters.fineCellMrad);
  const fineOnset = Math.max(0, parameters.fineOnsetM);
  uniforms.FINE_ONSET_M.value = fineOnset;
  uniforms.FINE_FULL_M.value = Math.max(fineOnset + 1, parameters.fineFullM);
  uniforms.MIRAGE_CRITICAL_RAD.value = Math.max(0, parameters.mirageCriticalMrad) / 1000;
  uniforms.MIRAGE_BLEND.value = Math.min(1, Math.max(0, parameters.mirageBlend));
}

// ---------------------------------------------------------------------------
// Ink outlines: the second half of the drawn-landscape look, in the same pass.
// ---------------------------------------------------------------------------

/**
 * Relative luminance gradient that counts as an edge. Low enough to catch a dune
 * against the sky and the ground's own shading bands, high enough that the road's
 * aggregate texture and the stipple are not outlined dot by dot.
 */
const INK_THRESHOLD = 0.14;


/**
 * Fullscreen triangle: three clip-space vertices, one corner padded to cover the whole
 * frame. `uv` carries the screen UV (0 = bottom, 1 = top).
 *
 * Exported with the fragment shader below so tools/haze-probe.ts can measure the REAL
 * pass rather than a copy of it. A heat haze whose claims are all geometric is worth
 * checking geometrically, and a re-typed shader would only ever verify itself.
 */
export const HAZE_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;


const PHOTO_SEPIA_STRENGTH = 0.1;
const PHOTO_DAY_SATURATION = 0.9;
const PHOTO_NIGHT_SATURATION = 0.85;
const PHOTO_NIGHT_EXPOSURE_MIN_EV = 2;
const PHOTO_NIGHT_EXPOSURE_MAX_EV = 3;
const PHOTO_DAY_BLACK_LIFT = 0.018;

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Applies the camera's authored print look in display space. Exposure is applied
 * in linear light so each EV is a real doubling; the listed sepia, saturation,
 * and black-lift controls then follow in their requested order.
 */
function processPhotoPixels(data: Uint8ClampedArray, dayFactor: number): void {
  const day = Math.min(1, Math.max(0, dayFactor));
  const night = 1 - day;
  const exposureEv =
    night <= 0
      ? 0
      : PHOTO_NIGHT_EXPOSURE_MIN_EV +
        (PHOTO_NIGHT_EXPOSURE_MAX_EV - PHOTO_NIGHT_EXPOSURE_MIN_EV) * night;
  const exposure = 2 ** exposureEv;
  const saturation = PHOTO_DAY_SATURATION +
    (PHOTO_NIGHT_SATURATION - PHOTO_DAY_SATURATION) * night;
  const blackLift = PHOTO_DAY_BLACK_LIFT * day;

  for (let i = 0; i < data.length; i += 4) {
    let r = linearToSrgb(srgbToLinear(data[i]! / 255) * exposure);
    let g = linearToSrgb(srgbToLinear(data[i + 1]! / 255) * exposure);
    let b = linearToSrgb(srgbToLinear(data[i + 2]! / 255) * exposure);

    const sepiaR = r * 0.393 + g * 0.769 + b * 0.189;
    const sepiaG = r * 0.349 + g * 0.686 + b * 0.168;
    const sepiaB = r * 0.272 + g * 0.534 + b * 0.131;
    r += (sepiaR - r) * PHOTO_SEPIA_STRENGTH;
    g += (sepiaG - g) * PHOTO_SEPIA_STRENGTH;
    b += (sepiaB - b) * PHOTO_SEPIA_STRENGTH;

    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = luminance + (r - luminance) * saturation;
    g = luminance + (g - luminance) * saturation;
    b = luminance + (b - luminance) * saturation;

    const shadow = 1 - smoothstep(0.08, 0.4, luminance);
    r += blackLift * shadow;
    g += blackLift * shadow;
    b += blackLift * shadow;

    data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
  }
}

function drawPhotoMileage(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mileageKm: number,
): void {
  const fontSize = Math.max(15, Math.round(height * 0.052));
  const inset = Math.max(12, Math.round(width * 0.026));
  const label = `${Math.max(0, mileageKm).toFixed(1)} km`;
  context.save();
  context.font = `600 ${fontSize}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, fontSize * 0.14);
  context.strokeStyle = 'rgba(20, 16, 11, 0.72)';
  context.fillStyle = 'rgba(242, 233, 211, 0.94)';
  context.strokeText(label, width - inset, height - inset);
  context.fillText(label, width - inset, height - inset);
  context.restore();
}

export const HAZE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uStrength;
  uniform float uMirage;
  uniform float uDaylight;
  uniform float uEyeAbove;
  uniform float uGroundSlope;
  uniform vec2 uHazePhase;
  uniform float uHorizon;
  uniform mat3 uCameraRotation;
  uniform float uTanHalfFov;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uInkStrength;
  uniform float uInkThreshold;
  uniform vec3 uViewTint;
  uniform float uViewTintStrength;
  uniform float uBinoculars;
  uniform float uCameraViewfinder;

  uniform float SCALE_HEIGHT_M;
  uniform float REF_PATH_M;
  uniform float NEAR_CLEAR_M;
  uniform float NEAR_FULL_M;
  uniform float GROUND_CLEAR_M;
  uniform float GROUND_FULL_M;
  uniform float ANGLE_RAD;
  uniform float LATERAL_SHARE;
  uniform float BROAD_AROUND;
  uniform float BROAD_UP;
  uniform float FINE_AROUND;
  uniform float FINE_UP;
  uniform float FINE_ONSET_M;
  uniform float FINE_FULL_M;
  uniform float MIRAGE_CRITICAL_RAD;
  uniform float MIRAGE_BLEND;

  varying vec2 vUv;

  /** Strata the lattice repeats at vertically; see HAZE_PHASE_PERIOD. */
  const float PHASE_PERIOD = ${HAZE_PHASE_PERIOD.toFixed(1)};
  const float TURN = 6.28318530718;

  /** Unit view-space direction for a pixel. */
  vec3 cameraRay(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    return normalize(vec3(
      ndc.x * aspect * uTanHalfFov,
      ndc.y * uTanHalfFov,
      -1.0
    ));
  }

  /** Perspective depth-buffer value converted to negative view-space Z. */
  float perspectiveDepthToViewZ(float depth) {
    return (uCameraNear * uCameraFar) /
      ((uCameraFar - uCameraNear) * depth - uCameraFar);
  }

  /** Distance along a view ray to a surface at the given view-space Z. */
  float rayDistance(float viewZ, vec3 viewDir) {
    return min(uCameraFar, -viewZ / max(1e-4, -viewDir.z));
  }

  /**
   * Effective length of hot air on this ray, metres: the integral of the air's own
   * density profile from the eye to the surface the pixel shows.
   *
   * The hot air thins as exp(-a / H) with a the height above the grazed-ground line,
   * and along the ray a = h + climb·t, so the integral over the ray's first \`run\`
   * metres closes in one line:
   *
   *   (e^(-h/H) - e^(-a_end/H)) · H / climb        (level ray: e^(-h/H) · run)
   *
   * A descending ray is in the ground once it has fallen the eye height, so its run is
   * cut there whatever the depth says. That also keeps a_end >= 0, which is why the
   * form above is written with the END height rather than as e^(-h/H)·(1 - e^(-x)):
   * with x negative, as it is for every descending ray, that product overflows a
   * float from an eye a hundred metres up, and this one cannot.
   *
   * The depth truncation is the whole difference from the old pass, which ran every
   * ray to infinity: a mast 150 m out on the horizon line has crossed 150 m of hot
   * air, not the three kilometres the desert behind it has.
   */
  float layerPath(float climb, float distance) {
    float run = climb < 0.0 ? min(distance, uEyeAbove / -climb) : distance;
    float atEye = exp(-uEyeAbove / SCALE_HEIGHT_M);
    float x = climb * run / SCALE_HEIGHT_M;
    float endAbove = max(0.0, uEyeAbove + climb * run);
    float integral = abs(x) < 1e-3
      ? atEye * run
      : (atEye - exp(-endAbove / SCALE_HEIGHT_M)) * SCALE_HEIGHT_M / climb;
    return clamp(integral, 0.0, REF_PATH_M);
  }

  /** Hash of a lattice point to [0, 1). The inputs are whole numbers below ~600. */
  float strataHash(vec2 cell) {
    vec3 q = fract(cell.xyx * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  /**
   * Smooth value noise on a lattice in (azimuth, elevation), in [-1, 1].
   *
   * TWO dimensions, on the sphere's own coordinates rather than in the 3D space
   * around it: \`around\` strata close the circle of azimuth exactly and the vertical
   * index repeats at PHASE_PERIOD, so both wraps are seamless and every number the
   * hash sees is a small whole one. The azimuth lattice pinches toward the zenith,
   * where this field is never asked for — a ray there has no path through the layer.
   * Half the taps of the 3D lattice it replaces.
   */
  float strataNoise(vec2 p, float around) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 w = f * f * (3.0 - 2.0 * f);
    vec2 i0 = mod(i, vec2(around, PHASE_PERIOD));
    vec2 i1 = mod(i + 1.0, vec2(around, PHASE_PERIOD));
    float a = strataHash(i0);
    float b = strataHash(vec2(i1.x, i0.y));
    float c = strataHash(vec2(i0.x, i1.y));
    float d = strataHash(i1);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
  }

  /**
   * The stirred layer's refraction at a direction, as a displacement direction in
   * (lateral, vertical), each roughly in [-1, 1].
   *
   * Two octaves of flat strata climbing at their own rates. Which octave dominates is
   * a matter of range: the same eddies further off subtend less, so distant surfaces
   * ripple finely and the middle distance broadly. Only the MIX follows depth — see
   * HAZE_FINE_ONSET_M for why the lattices themselves may not. The same two noises
   * form both channels with swapped weights; a second pair for the small lateral part
   * would double the cost without adding visible structure.
   */
  vec2 hazeWarp(vec3 dir, float distance) {
    float around = atan(dir.x, dir.z) / TURN + 0.5;
    float broad = strataNoise(
      vec2(around * BROAD_AROUND, dir.y * BROAD_UP - uHazePhase.x),
      BROAD_AROUND
    );
    float fine = strataNoise(
      vec2(around * FINE_AROUND, dir.y * FINE_UP - uHazePhase.y),
      FINE_AROUND
    );
    float broadShare = mix(0.8, 0.3, smoothstep(FINE_ONSET_M, FINE_FULL_M, distance));
    return vec2(
      (1.0 - broadShare) * broad - broadShare * fine,
      broadShare * broad + (1.0 - broadShare) * fine
    );
  }

  /**
   * Ink outline strength at a pixel, from the colour gradient around it.
   *
   * A Sobel on the already-shaded image, not on a depth buffer, and deliberately:
   * the ground's own shading is banded (render/comic.ts), so its band boundaries ARE
   * the strata edges a pen would draw, and a colour edge detector inks both those and
   * every silhouette in one pass. It also survives MSAA, which sampling a depth
   * texture alongside a multisampled colour target does not.
   *
   * Full RGB distance rather than luminance: a tan dune against a blue sky is a
   * enormous HUE step and barely a brightness one, so a luminance-only detector left
   * the one edge that matters most — the skyline — undrawn.
   *
   * Taps are a pixel and a half out, so the line lands on the edge itself rather than
   * on the antialiasing gradient beside it.
   */
  float inkEdge(vec2 uv, vec2 texel) {
    vec2 d = texel * 1.5;
    vec3 c  = texture2D(tDiffuse, uv).rgb;
    vec3 cx = texture2D(tDiffuse, uv + vec2(d.x, 0.0)).rgb;
    vec3 cX = texture2D(tDiffuse, uv - vec2(d.x, 0.0)).rgb;
    vec3 cy = texture2D(tDiffuse, uv + vec2(0.0, d.y)).rgb;
    vec3 cY = texture2D(tDiffuse, uv - vec2(0.0, d.y)).rgb;
    // Central differences rather than a full 3x3 kernel: four taps instead of
    // eight, and on a banded image the diagonals add nothing but cost.
    float grad = max(length(cx - cX), length(cy - cY));
    // Relative, not absolute: a step of 0.05 matters in the shaded side of a dune
    // and is invisible across bright sand, so it is measured against local
    // brightness.
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float rel = grad / max(0.18, lum);
    return smoothstep(uInkThreshold, uInkThreshold * 2.6, rel);
  }

  void main() {
    vec2 uv = vUv;
    // One depth tap every pixel pays whatever happens: the veil, the ink gate and
    // the warp all read it.
    float ownViewZ = perspectiveDepthToViewZ(texture2D(tDepth, vUv).x);
    float airViewZ = ownViewZ;
    float mirageWeight = 0.0;
    vec2 mirrorUv = vUv;
    // A uniform branch, so every fragment takes the same side: at night and on the
    // cheapest tier nothing below is evaluated at all.
    if (uStrength > 0.0 || uMirage > 0.0) {
      vec3 viewDir = cameraRay(vUv);
      vec3 dir = normalize(uCameraRotation * viewDir);
      float distance = rayDistance(ownViewZ, viewDir);
      // The ray's climb over the grazed-ground line, per metre of ray: what decides
      // how long it stays in the hot air.
      float climb = dir.y - uGroundSlope * length(dir.xz);
      float path = layerPath(climb, distance) / REF_PATH_M;
      // Real first-surface depth keeps nearby geometry rigid wherever it is on screen.
      float depthClear = smoothstep(NEAR_CLEAR_M, NEAR_FULL_M, distance);
      // Ground is uniquely intolerant of a missing depth sample: one cleared texel at
      // an MSAA edge would otherwise make the road boil underfoot. A conservative
      // ray/line backup excludes descending rays whose ground intersection is nearby;
      // actual depth remains authoritative for every object and distant slope.
      float groundClear = climb < -1e-4
        ? smoothstep(GROUND_CLEAR_M, GROUND_FULL_M, uEyeAbove / -climb)
        : 1.0;
      float shimmerWeight =
        uStrength * path * path * (3.0 - 2.0 * path) * min(depthClear, groundClear);

      float aspect = uResolution.x / uResolution.y;
      float perRadian = 0.5 / uTanHalfFov;
      vec2 offset = vec2(0.0);
      // Most of the frame — steep sky, the road, the car — has no path through hot
      // air at all, and it skips the field and the second depth tap here.
      if (shimmerWeight > 1e-3) {
        vec2 warp = hazeWarp(dir, distance);
        // Angle to screen. A displacement of a radians spans a / (2*tan(halfFov)) of
        // the frame height, and the same over the width with the aspect divided out —
        // which is what makes the boil magnify correctly under the binoculars instead
        // of staying a fixed number of pixels wide.
        offset = vec2(
          (warp.x * LATERAL_SHARE * ANGLE_RAD * perRadian) / aspect,
          warp.y * ANGLE_RAD * perRadian
        ) * shimmerWeight;
        // The silhouette test. Light that reached the eye along a ray which missed the
        // car cannot have come from the car, so a displaced sample that lands on
        // anything the near gate keeps rigid is not taken: the pixel keeps its own
        // colour instead of a wobbling fringe of somebody's paint.
        vec2 candidate = clamp(vUv + offset, 0.0, 1.0);
        float candidateViewZ = perspectiveDepthToViewZ(texture2D(tDepth, candidate).x);
        float keep = smoothstep(
          NEAR_CLEAR_M,
          NEAR_FULL_M,
          rayDistance(candidateViewZ, viewDir)
        );
        offset *= keep;
        uv = clamp(vUv + offset, 0.0, 1.0);
        airViewZ = keep > 0.5 ? candidateViewZ : ownViewZ;
      }

      // The wet road. A ray arriving at the hot ground flatter than the critical angle
      // is turned back up and leaves as steeply as it came, so this pixel shows what
      // lies the same angle ABOVE the ground line: the sky and the far horizon, upside
      // down. The critical angle grows with the square root of the heating.
      float graze = -climb;
      float critical = MIRAGE_CRITICAL_RAD * sqrt(uMirage);
      if (graze > 0.0 && graze < critical) {
        // Only over ground that actually lies on the line: a ray stopped well short of
        // where the line says it lands has hit a dune face, a verge or a car.
        float onGround = smoothstep(0.6, 0.85, distance * graze / uEyeAbove);
        // World up as it runs across the screen at this camera roll; the mirrored
        // direction is 2·graze up it.
        vec3 up = vec3(uCameraRotation[0][1], uCameraRotation[1][1], uCameraRotation[2][1]);
        vec2 upScreen = vec2(up.x / aspect, up.y) / max(1e-3, length(up.xy));
        mirrorUv = clamp(vUv + upScreen * (2.0 * graze * perRadian) + offset, 0.0, 1.0);
        // What is mirrored must stand beyond the point of reflection: a car between the
        // eye and the hot patch is not in its reflection.
        float mirrored = rayDistance(
          perspectiveDepthToViewZ(texture2D(tDepth, mirrorUv).x),
          viewDir
        );
        mirageWeight = MIRAGE_BLEND * uMirage * onGround
          * smoothstep(critical, critical * 0.55, graze)
          * step(distance, mirrored);
      }
    }
    vec4 color = texture2D(tDiffuse, uv);
    if (mirageWeight > 0.0) {
      color.rgb = mix(color.rgb, texture2D(tDiffuse, mirrorUv).rgb, mirageWeight);
    }

    // Everything from here on is colour, not refraction. tools/haze-probe.ts reads the
    // SOURCE COORDINATE this pass sampled out of a coordinate-coded image, and any
    // colour operation — grade, grain, the lenses — would corrupt that measurement, so
    // it compiles the real pass with this one define and the rest skipped.
    #ifndef HAZE_MEASURE_SOURCE

    // ACES' toe is intentionally cinematic, but in a sunlit desert it crushed
    // backlit paint and props into the same near-black. A small display-space
    // expansion restores separation inside dark colours without lifting true
    // black, changing highlights, or touching the renderer's exposure.
    float sceneLum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float toeWeight = (1.0 - smoothstep(0.06, 0.42, sceneLum)) * uDaylight * 0.11;
    color.rgb = mix(color.rgb, sqrt(max(color.rgb, vec3(0.0))), toeWeight);

    // A thin sand veil where the sight line has crossed kilometres of desert air.
    // Real scene depth keeps the foreground, cabin and car untouched; a narrow fade
    // above the geometric horizon lets the suspended dust soften that boundary
    // without tinting the open sky. This complements the world's distance fog rather
    // than replacing it, so regional haze and view-distance settings remain sovereign.
    float airDistance = -airViewZ;
    float horizonAir =
      1.0 - smoothstep(uHorizon + 0.015, uHorizon + 0.14, vUv.y);
    float sandVeil =
      smoothstep(220.0, 1800.0, airDistance) * horizonAir * uDaylight * 0.032;
    color.rgb = mix(color.rgb, vec3(0.78, 0.69, 0.56), sandVeil);


    // ACES has already supplied the filmic shoulder and soft contrast in the scene
    // pass. This display-space finish stays deliberately smaller: a modest
    // luminance-preserving colour separation, then warm highlights against slightly
    // cooler shadows. It enriches the desert palette without installing a second
    // tone mapper or clipping the shoulder ACES just made.
    float gradeLum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(gradeLum), color.rgb, 1.055);
    float highlightWarmth = smoothstep(0.16, 0.82, gradeLum);
    color.rgb *= mix(
      vec3(0.993, 0.998, 1.006),
      vec3(1.012, 1.003, 0.985),
      highlightWarmth
    );
    color.rgb = clamp(color.rgb, 0.0, 1.0);

    // Ink is for surfaces, and "surface" is a depth question rather than a screen-height
    // one. The gate used to be a screen-height test against uHorizon, which kept the
    // outline pass off the sky and every star point — but it also left everything whose
    // silhouette rises above the horizon undrawn, so a tree got a line round its trunk
    // and none round its crown.
    //
    // The sky, the stars and the planets all render with depthWrite off, so they
    // leave depth at the far plane while real geometry does not. Testing the depth this
    // shader already samples excludes them by the property that actually distinguishes
    // them, and lets a canopy, a roof or a mast keep its outline against open sky.
    if (uInkStrength > 0.0 && airDistance < uCameraFar * 0.999) {
      float ink = inkEdge(uv, 1.0 / uResolution) * uInkStrength;
      // The line is the surface's own colour driven down, not a black overlay:
      // black lines on sand read as dirt, dark-sand lines read as ink.
      color.rgb = mix(color.rgb, color.rgb * 0.34, ink);
    }

    // Sub-code-value film grain: visible as texture in broad flat areas, never as
    // snow. The seed advances at 12 Hz rather than every display frame so a high
    // refresh-rate panel does not turn this tiny texture into rapid scintillation.
    float grainFrame = mod(floor(uTime * 12.0), 64.0);
    vec2 grainPixel = gl_FragCoord.xy + vec2(grainFrame * 17.0, grainFrame * 43.0);
    float grain =
      fract(52.9829189 * fract(dot(grainPixel, vec2(0.06711056, 0.00583715)))) - 0.5;
    float grainLum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float grainMask =
      smoothstep(0.015, 0.12, grainLum) * (1.0 - smoothstep(0.72, 1.0, grainLum));
    color.rgb = clamp(color.rgb + grain * grainMask * 0.08, 0.0, 1.0);

    // Worn shades are a coloured-glass transmission curve, not a flat alpha wash:
    // retained channels stay bright while the others are absorbed.
    color.rgb *= mix(vec3(1.0), uViewTint, uViewTintStrength);

    // Two separated circular ocular fields. Aspect correction makes lensUv square;
    // the small overlap preserves binocular fusion without reading as one wide oval.
    vec2 lensUv = vec2((vUv.x - 0.5) * uResolution.x / uResolution.y, vUv.y - 0.5);
    float leftEye = 1.0 - smoothstep(0.335, 0.35, length(lensUv - vec2(-0.27, 0.0)));
    float rightEye = 1.0 - smoothstep(0.335, 0.35, length(lensUv - vec2(0.27, 0.0)));
    float ocular = max(leftEye, rightEye);
    color.rgb *= mix(1.0, ocular, uBinoculars);

    // A broad, softly rounded eyecup vignette: unlike the binocular mask it keeps
    // one professional-camera frame, but the dark top, bottom and corners make the
    // eye-at-viewfinder state unmistakable.
    vec2 finder = abs(vUv * 2.0 - 1.0);
    float finderShape = pow(finder.x, 8.0) + pow(finder.y / 0.84, 8.0);
    float finderMask = 1.0 - smoothstep(0.82, 1.04, finderShape);
    color.rgb *= mix(1.0, finderMask, uCameraViewfinder);

    #endif

    gl_FragColor = color;
  }
`;

const MAX_PENDING_GPU_QUERIES = 8;

interface GpuTimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface PendingGpuQuery {
  readonly query: WebGLQuery;
  readonly eligible: boolean;
}



export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fog: THREE.FogExp2;
  // --- Heat-haze post pass ---
  /** Scene-pass target sampled by the fullscreen haze/ink pass on every tier. */
  private readonly hazeTarget: THREE.WebGLRenderTarget;
  /** Tiny scene holding the fullscreen triangle. */
  private readonly hazeScene = new THREE.Scene();
  /** Dummy camera for the fullscreen pass; the vertex shader ignores its matrices. */
  private readonly hazeCamera: THREE.OrthographicCamera;
  private readonly hazeMaterial: THREE.ShaderMaterial;
  private readonly hazeGeometry: THREE.BufferGeometry;
  /** Reused scratch vector for the drawing-buffer size. */
  private readonly _drawSize = new THREE.Vector2();
  /** Reused scratch for the camera's forward vector (horizon tracking). */
  private readonly _forward = new THREE.Vector3();
  /**
   * Camera height above the grazed-ground line, metres, for the hot-layer
   * integration. Defaulted to a standing eye so the very first frame is sensible
   * before the loop supplies one.
   */
  private hazeEyeHeight = DEFAULT_EYE_HEIGHT_M;
  private hazeMinimumEyeHeight = DEFAULT_HEAT_MIRAGE.minimumEyeHeightM;
  /** Live handle on the pass's physical constants; see createHeatMirageUniforms. */
  private readonly heatUniforms = createHeatMirageUniforms();
  /** Rise rates of the two strata octaves, strata per second. */
  private hazeBroadRiseHz = DEFAULT_HEAT_MIRAGE.broadRiseHz;
  private hazeFineRiseHz = DEFAULT_HEAT_MIRAGE.fineRiseHz;
  /** Wall clock of the previous frame, seconds; negative until the first one. */
  private hazeClockS = -1;
  /** What the pass was last told, kept for the depth-resolve decision. */
  private daylight = 0;
  private shimmerStrength = 0;
  private mirageStrength = 0;
  /** Hand torch projected from the rendered eye; disabled rather than recreated. */
  private readonly torchLight: THREE.SpotLight;
  private readonly torchTarget = new THREE.Object3D();
  /** Reused 2D target for compact photographs; created only when the shutter fires. */
  private photoCanvas: HTMLCanvasElement | null = null;
  private photoContext: CanvasRenderingContext2D | null = null;


  /**
   * The tier's cap, resolved against this display once. `adaptResolution` scales
   * THIS, not the raw cap: basing it on the cap meant that on any display below
   * the cap (a DPR 1.25 monitor, say) the controller's own "reduced" ratios were
   * still larger than the native ratio the constructor had chosen, so the first
   * step down quietly asked the weakest machines to draw MORE pixels.
   */
  private basePixelRatio: number;
  private quality: GraphicsQuality;
  private readonly adaptiveResolution: AdaptiveResolutionController;
  private readonly timerQueryGl: WebGL2RenderingContext | null;
  private readonly timerQueryExt: GpuTimerQueryExtension | null;
  private readonly pendingGpuQueries: PendingGpuQuery[] = [];
  private readonly completedGpuSamples: number[] = [];
  private readonly completedGpuSampleEligibility: boolean[] = [];
  private queryEligible = false;

  constructor(
    canvas: HTMLCanvasElement,
    quality: GraphicsQuality = 'standard',
    msaa = true,
    inkStrength = DEFAULT_INK_STRENGTH,
    private readonly mobilePresentation = prefersMobilePresentation(),
    /**
     * The player's fixed drawing-buffer fraction, or null for the rung's own budget
     * adapted by measurement. While it is set the controller is pinned: a named
     * resolution that still drifts is not a named resolution.
     */
    private renderScale: RenderScale = null,
    fieldOfView = DEFAULT_FIELD_OF_VIEW,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // NOT antialiased. Standard and Blessing draw scene pixels into
      // `hazeTarget`, whose MSAA sample count is controlled independently;
      // acceptable draws directly to the default framebuffer. A multisampled
      // backbuffer would allocate and resolve an image that cannot differ by one
      // pixel after the fullscreen pass.
      antialias: false,
      // Never ask a phone for its highest-performance configuration. On a desktop this
      // hint picks the discrete GPU, which is what it is for; on a phone there is only
      // one GPU, and asking for maximum performance is asking the driver and the power
      // governor for clocks the game does not need and the device cannot shed. The game
      // wants a phone that stays cool, and says so.
      powerPreference: this.mobilePresentation ? 'default' : 'high-performance',
    });
    primeMaxAnisotropy(this.renderer);
    this.adaptiveResolution = new AdaptiveResolutionController(quality);
    const context = this.renderer.getContext();
    if (
      typeof WebGL2RenderingContext !== 'undefined'
      && context instanceof WebGL2RenderingContext
    ) {
      this.timerQueryGl = context;
      this.timerQueryExt = context.getExtension(
        'EXT_disjoint_timer_query_webgl2',
      ) as GpuTimerQueryExtension | null;
    } else {
      this.timerQueryGl = null;
      this.timerQueryExt = null;
    }
    this.basePixelRatio = this.pixelRatioFor(quality);
    this.adaptiveResolution.setPinned(renderScale !== null);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = shadowsFor(quality, this.mobilePresentation);
    // PCFSoft's wider kernel costs extra texture taps for a blur that reads as
    // noise at this shadow resolution; plain PCF is visually near-identical and
    // materially cheaper on a low-end iGPU.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Draw statistics are accumulated by hand across BOTH passes of a frame.
    //
    // Three resets its counters at the start of every `render` call by default, so after
    // this renderer's two passes the counters describe only the second one — the single
    // fullscreen triangle. That is worse than no reading at all, because it looks like an
    // answer. With auto-reset off and an explicit reset at the top of the frame, the
    // counters describe the frame.
    this.renderer.info.autoReset = false;

    const viewportWidth = Math.max(1, canvas.clientWidth);
    const viewportHeight = Math.max(1, canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(
      fieldOfView,
      viewportWidth / viewportHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );

    // Density is retuned per frame from the sky gradient's haze value.
    this.fog = new THREE.FogExp2(0xd8c39a, 0.00035);
    this.scene.fog = this.fog;

    // Every tier renders into this colour-and-depth target, then uses the fullscreen
    // pass for authored colour, restrained film grain and ink. Acceptable suppresses
    // only the haze warp; standard and blessing sample the resolved depth so nearby
    // geometry never inherits a horizon-shaped screen mask.
    // The independent MSAA setting decides geometry-edge samples.
    const hazeDepth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    hazeDepth.minFilter = THREE.NearestFilter;
    hazeDepth.magFilter = THREE.NearestFilter;
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, {
      samples: msaa ? MSAA_SAMPLES : 0,
      depthTexture: hazeDepth,
    });
    this.hazeTarget.texture.colorSpace = THREE.SRGBColorSpace;

    this.hazeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hazeMaterial = new THREE.ShaderMaterial({
      vertexShader: HAZE_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      // No tone mapping, no colour conversion: pass 1 already produced final
      // sRGB pixels, so this pass only warps UVs and copies texels through.
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.hazeTarget.texture },
        tDepth: { value: this.hazeTarget.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uMirage: { value: 0 },
        uHazePhase: { value: new THREE.Vector2() },
        ...this.heatUniforms,
        uDaylight: { value: 0 },
        uEyeAbove: { value: DEFAULT_EYE_HEIGHT_M },
        uGroundSlope: { value: 0 },
        uHorizon: { value: 0.5 },
        uCameraRotation: { value: new THREE.Matrix3() },
        uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(fieldOfView) / 2) },
        uCameraNear: { value: CAMERA_NEAR },
        uCameraFar: { value: CAMERA_FAR },
        uInkStrength: { value: Math.min(1, Math.max(0, inkStrength)) },
        uInkThreshold: { value: INK_THRESHOLD },
        uViewTint: { value: new THREE.Color(1, 1, 1) },
        uViewTintStrength: { value: 0 },
        uBinoculars: { value: 0 },
        uCameraViewfinder: { value: 0 },
      },
    });
    this.hazeGeometry = new THREE.BufferGeometry();
    this.hazeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
    );
    this.hazeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const hazeMesh = new THREE.Mesh(this.hazeGeometry, this.hazeMaterial);
    hazeMesh.frustumCulled = false; // clip-space triangle spans far outside the frustum
    this.hazeScene.add(hazeMesh);

    this.torchLight = new THREE.SpotLight(0xffedbd, 150, 65, 0.32, 0.58, 1.7);
    this.torchLight.visible = false;
    this.torchLight.castShadow = false;
    this.torchLight.target = this.torchTarget;
    this.scene.add(this.torchLight, this.torchTarget);


    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.disposeGpuQueries();
    this.hazeTarget.dispose();
    this.hazeMaterial.dispose();
    this.hazeGeometry.dispose();
    this.scene.remove(this.torchLight, this.torchTarget);
    this.torchLight.dispose();
    this.renderer.dispose();
  }


  /**
   * Re-reads the canvas CSS viewport after an in-page display-mode change.
   * Browser resizes already call the same path through the window listener.
   */
  resizeViewport(): void {
    this.resize();
  }

  /**
   * Waits until both program variants used by the live two-pass frame are ready.
   *
   * The scene pass renders into `hazeTarget`, where Three disables renderer tone
   * mapping and uses the working colour space. Compiling it with the default target
   * instead builds a different canvas-output program; on a cold driver cache that
   * left the real scene programs compiling after the loading cover disappeared.
   */
  async waitForFrameShaders(): Promise<void> {
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.hazeTarget);
      const sceneReady = this.renderer.compileAsync(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      const postReady = this.renderer.compileAsync(this.hazeScene, this.hazeCamera);
      await Promise.all([sceneReady, postReady]);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * Waits until the GPU has completed every command submitted before this call.
   *
   * Shader linking alone does not cover the first texture uploads, shadow maps,
   * PMREM bake, render-target resolve, or fullscreen pass. A fence after the final
   * covered draw makes all of those part of the launch barrier as well.
   */
  async waitForSubmittedFrame(): Promise<void> {
    const context = this.renderer.getContext();
    if (
      typeof WebGL2RenderingContext === 'undefined'
      || !(context instanceof WebGL2RenderingContext)
    ) {
      context.finish();
      return;
    }

    const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence === null) throw new Error('could not create the launch GPU fence');
    context.flush();
    await new Promise<void>((resolve, reject) => {
      const poll = (): void => {
        const status = context.clientWaitSync(fence, 0, 0);
        if (status === context.TIMEOUT_EXPIRED) {
          setTimeout(poll, 8);
          return;
        }
        context.deleteSync(fence);
        if (status === context.WAIT_FAILED) {
          reject(new Error('the launch GPU fence failed'));
        } else {
          resolve();
        }
      };
      setTimeout(poll, 0);
    });
  }


  /** Updates inexpensive player-held/worn view effects without allocating. */
  setItemViewEffects(
    shades: ShadeTint | null,
    binoculars: boolean,
    torchlight: boolean,
    cameraViewfinder: boolean,
  ): void {
    const tint = this.hazeMaterial.uniforms.uViewTint.value as THREE.Color;
    if (shades === 'green') tint.setRGB(0.56, 0.86, 0.52);
    else if (shades === 'yellow') tint.setRGB(0.95, 0.78, 0.42);
    else if (shades === 'red') tint.setRGB(0.88, 0.42, 0.35);
    else tint.setRGB(1, 1, 1);
    this.hazeMaterial.uniforms.uViewTintStrength.value = shades === null ? 0 : 0.72;
    this.hazeMaterial.uniforms.uBinoculars.value = binoculars ? 1 : 0;
    this.hazeMaterial.uniforms.uCameraViewfinder.value = cameraViewfinder ? 1 : 0;

    this.torchLight.visible = torchlight;
    if (torchlight) {
      this.torchLight.position.copy(this.camera.position);
      this.camera.getWorldDirection(this._forward);
      this.torchTarget.position.copy(this.camera.position).addScaledVector(this._forward, 25);
      this.torchTarget.updateMatrixWorld();
    }
  }

  /**
   * The drawing-buffer ratio this display gets before adaptation: the rung's budget,
   * or the player's fraction when he has named one.
   */
  private pixelRatioFor(quality: GraphicsQuality): number {
    const canvas = this.renderer.domElement;
    const cssPixels = canvas.clientWidth * canvas.clientHeight;
    if (this.renderScale !== null) {
      return manualRenderScale(
        cssPixels,
        window.devicePixelRatio,
        this.mobilePresentation,
        this.renderScale,
      );
    }
    return renderScaleFor(quality, cssPixels, window.devicePixelRatio, this.mobilePresentation);
  }

  /**
   * Where dynamic resolution stops, as an ABSOLUTE pixel count rather than a fraction
   * of the ceiling.
   *
   * A fraction says nothing about the picture: 0.55 of a phone's budget and 0.55 of a
   * workstation's are different images entirely, and the one thing a floor has to
   * guarantee is the image below which the machine is no longer worth looking at. Every
   * rung used to answer this its own way — `acceptable` and both mobile paths in
   * absolute pixels, `standard` and `blessing` in ratios — so whether a rung had a real
   * floor depended on which rung it was.
   */
  private updateAdaptiveFloor(): void {
    const canvas = this.renderer.domElement;
    // `this.basePixelRatio`, never the renderer's live ratio: `setQuality` recomputes the
    // floor BEFORE it installs the new ratio, so reading it here would measure against the
    // rung the machine just left and quietly hand back that rung's floor.
    this.adaptiveResolution.setMinimumScale(
      minimumScaleFor(
        this.quality,
        canvas.clientWidth * canvas.clientHeight,
        this.basePixelRatio,
        this.mobilePresentation,
      ),
    );
  }

  private resize = (): void => {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.basePixelRatio = this.pixelRatioFor(this.quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio * this.adaptiveResolution.scale);
    this.renderer.setSize(width, height, false);
    this.resizeHazeTarget();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.pollGpuQueries();
    const query = this.beginGpuTimerQuery();
    try {
      this.drawFrame();
    } finally {
      if (query !== null) this.endGpuTimerQuery();
    }
  }

  /**
   * Captures the actual rendered view at a compact resolution, with eyepiece and
   * worn-glass effects removed. The ordinary render immediately after this restores
   * the player's viewfinder; only the photograph receives the clean optical image.
   * Mileage is burned into the print itself so saved and dropped photographs retain it.
   */
  capturePhoto(dayFactor: number, mileageKm: number): string | null {
    if (this.photoCanvas === null) {
      this.photoCanvas = document.createElement('canvas');
      this.photoContext = this.photoCanvas.getContext('2d', { alpha: false });
    }
    const target = this.photoCanvas;
    const context = this.photoContext;
    if (!target || !context) return null;

    const tintStrength = this.hazeMaterial.uniforms.uViewTintStrength.value as number;
    const binoculars = this.hazeMaterial.uniforms.uBinoculars.value as number;
    const viewfinder = this.hazeMaterial.uniforms.uCameraViewfinder.value as number;
    try {
      this.hazeMaterial.uniforms.uViewTintStrength.value = 0;
      this.hazeMaterial.uniforms.uBinoculars.value = 0;
      this.hazeMaterial.uniforms.uCameraViewfinder.value = 0;
      this.drawFrame();

      const source = this.renderer.domElement;
      const longest = Math.max(source.width, source.height, 1);
      const scale = Math.min(1, 640 / longest);
      target.width = Math.max(1, Math.round(source.width * scale));
      target.height = Math.max(1, Math.round(source.height * scale));
      context.drawImage(source, 0, 0, target.width, target.height);
      const pixels = context.getImageData(0, 0, target.width, target.height);
      processPhotoPixels(pixels.data, dayFactor);
      context.putImageData(pixels, 0, 0);
      drawPhotoMileage(context, target.width, target.height, mileageKm);
      return target.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    } finally {
      this.hazeMaterial.uniforms.uViewTintStrength.value = tintStrength;
      this.hazeMaterial.uniforms.uBinoculars.value = binoculars;
      this.hazeMaterial.uniforms.uCameraViewfinder.value = viewfinder;
    }
  }

  private drawFrame(): void {
    this.renderer.info.reset();
    // Real time, not game time: the strata climb at a flicker rate the eye knows,
    // which a time-scaled or paused game clock would slow or freeze. The phases are
    // integrated here in doubles and wrapped (see advanceHazePhase), and the clock
    // the grain reads is wrapped at a whole number of its own cycles, so no uniform
    // grows with uptime and the float32 the shader holds never loses the pattern.
    const nowS = performance.now() * 0.001;
    const dt = this.hazeClockS < 0 ? 0 : Math.min(0.1, Math.max(0, nowS - this.hazeClockS));
    this.hazeClockS = nowS;
    const phase = this.hazeMaterial.uniforms.uHazePhase.value as THREE.Vector2;
    phase.set(
      advanceHazePhase(phase.x, dt, this.hazeBroadRiseHz),
      advanceHazePhase(phase.y, dt, this.hazeFineRiseHz),
    );
    this.hazeMaterial.uniforms.uTime.value = nowS % HAZE_CLOCK_PERIOD_S;
    this.hazeMaterial.uniforms.uHorizon.value = this.horizonScreenY();
    this.hazeMaterial.uniforms.uEyeAbove.value = Math.max(
      this.hazeMinimumEyeHeight,
      this.hazeEyeHeight,
    );
    this.camera.updateWorldMatrix(true, false);
    (this.hazeMaterial.uniforms.uCameraRotation.value as THREE.Matrix3).setFromMatrix4(
      this.camera.matrixWorld,
    );
    this.hazeMaterial.uniforms.uTanHalfFov.value = Math.tan(
      THREE.MathUtils.degToRad(this.camera.fov) / 2,
    );
    this.hazeMaterial.uniforms.uCameraNear.value = this.camera.near;
    this.hazeMaterial.uniforms.uCameraFar.value = this.camera.far;
    // TWO PASSES ON EVERY TIER, and the reason is colour, not shimmer.
    //
    // Pass 1 renders into `hazeTarget`. Three writes the WORKING colour space
    // (linear) into a render target — only the canvas gets `outputColorSpace` —
    // and pass 2 copies those texels through untouched, so the frame reaches the
    // display linear-encoded and roughly a gamma darker than a direct render.
    // The whole game is lit and painted against that image.
    //
    // So this is deliberate, not an oversight: skipping the pass on the cheapest
    // tier made it the only correctly encoded tier, which read as washed out
    // beside the other two. Acceptable keeps the pass and drops the WARP instead
    // (see `setHeatHaze`), which is where the cost actually was.
    this.renderer.setRenderTarget(this.hazeTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.hazeScene, this.hazeCamera);
  }

  /**
   * Screen-space `uv.y` of the true horizon (0 = bottom of frame, 1 = top). Used by
   * the INK pass only — the shimmer works in world rays and needs no such row.
   *
   * A horizontal sight-line lands at NDC y = -tan(pitch) / tan(fovY / 2): look up
   * and the horizon slides down the frame, look down and it climbs. Reading it off
   * the camera's own forward vector rather than tracking pitch separately keeps it
   * correct through the camera rig's roll and spring, and clamping a little way
   * outside the frame keeps the falloff sensible when the horizon is off-screen.
   */
  private horizonScreenY(): number {
    this.camera.getWorldDirection(this._forward);
    const horizontal = Math.hypot(this._forward.x, this._forward.z);
    const pitch = Math.atan2(this._forward.y, horizontal);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const ndc = -Math.tan(pitch) / Math.tan(halfFov);
    return Math.min(1.6, Math.max(-0.6, 0.5 + 0.5 * ndc));
  }

  /** Updates every physical parameter in the production heat-mirage shader. */
  setHeatMirageParameters(parameters: HeatMirageParameters): void {
    writeHeatMirageUniforms(this.heatUniforms, parameters);
    this.hazeBroadRiseHz = parameters.broadRiseHz;
    this.hazeFineRiseHz = parameters.fineRiseHz;
    this.hazeMinimumEyeHeight = parameters.minimumEyeHeightM;
  }

  /**
   * How much of the day's light the colour finish should assume, 0..1: the sand
   * veil and the toe lift. Deliberately separate from the heat: the two used to be
   * one number, so the mirage lab's heat slider re-graded the whole picture.
   */
  setDaylight(dayFactor: number): void {
    this.daylight = Math.min(1, Math.max(0, dayFactor));
    this.hazeMaterial.uniforms.uDaylight.value = this.daylight;
    this.updateDepthResolve();
  }

  /**
   * This frame's heat: shimmer and mirage strength, and the grazed-ground line the
   * shader integrates the hot layer against (render/heathaze.ts).
   *
   * Both strengths are always zero on the cheapest tier. The procedural field is the
   * expensive half of this pass; Acceptable pays the copy and outlines, which define
   * the drawn look, and skips the heat: at zero strength the shader branches past it
   * on a uniform every fragment agrees on.
   */
  setHeatHaze(frame: HeatHazeFrame): void {
    const enabled = this.quality !== 'acceptable';
    this.shimmerStrength = enabled ? Math.min(1, Math.max(0, frame.shimmer)) : 0;
    this.mirageStrength = enabled ? Math.min(1, Math.max(0, frame.mirage)) : 0;
    this.hazeMaterial.uniforms.uStrength.value = this.shimmerStrength;
    this.hazeMaterial.uniforms.uMirage.value = this.mirageStrength;
    this.hazeEyeHeight = frame.eyeAboveM;
    this.hazeMaterial.uniforms.uGroundSlope.value = frame.groundSlope;
    this.updateDepthResolve();
  }

  private updateDepthResolve(): void {
    // THE WARP IS NOT THE ONLY THING THAT SAMPLES DEPTH, which is what this line
    // used to assume. `tDepth` also decides where the sand veil begins and — far
    // more visibly — which fragments the INK pass is allowed to outline: the sky,
    // the stars and the planets are excluded by sitting at the far plane, and
    // that test runs on every tier, every frame, warp or no warp.
    //
    // Leaving the multisampled depth unresolved therefore did not skip a sample
    // nobody read. It handed the outline gate an UNDEFINED texture — three
    // invalidates the attachment when the flag is off — for the whole night and
    // for the entire lifetime of the cheapest tier, so the drawn look either
    // vanished or spread into the sky depending on what the driver left behind.
    // The resolve is skipped only when nothing in the pass reads depth at all.
    const ink = this.hazeMaterial.uniforms.uInkStrength.value as number;
    this.hazeTarget.resolveDepthBuffer =
      this.shimmerStrength > 0 || this.mirageStrength > 0 || ink > 0 || this.daylight > 0;
  }

  /** Size the scene-pass target to the actual drawing buffer (CSS size × pixel ratio). */
  private resizeHazeTarget(): void {
    this.renderer.getDrawingBufferSize(this._drawSize);
    this.hazeTarget.setSize(this._drawSize.x, this._drawSize.y);
    this.hazeMaterial.uniforms.uResolution.value.set(this._drawSize.x, this._drawSize.y);
  }


  // --- Adaptive resolution ---

  /**
   * The live drawing-buffer scale, where 1 is the tier's full resolution. The
   * launch settles this under the loading cover, so the first frame the player
   * sees is already at the resolution the rest of the session will run at.
   */
  get resolutionScale(): number {
    return this.adaptiveResolution.scale;
  }

  /**
   * Pixels the scene is actually shaded at, both passes.
   *
   * A COUNT rather than a percentage, because a percentage needs a stated base and the
   * base moved: with a manual render scale the resolution is a fraction of the display
   * and `resolutionScale` stays at 1, so the old "% of ceiling" readout would report
   * full resolution at every setting the player chose.
   */
  get renderedPixels(): number {
    this.renderer.getDrawingBufferSize(this._drawSize);
    return this._drawSize.x * this._drawSize.y;
  }

  /** Whether this context can time the GPU. Without it the scale never moves. */
  get measuresGpuTime(): boolean {
    return this.timerQueryExt !== null;
  }

  /**
   * Draw calls submitted by the last frame, both passes together.
   *
   * The number that separates a frame which is slow because it FILLS a lot of pixels from
   * one which is slow because it ISSUES a lot of work. Those two have opposite fixes, and
   * the CPU cost of submitting a frame (`draw` in the profiler) is dominated by the second:
   * measured on a phone, cutting the pixel budget by nearly three times and the light slots
   * by three moved the draw cost by twenty per cent, which is the signature of per-call
   * overhead rather than fill rate.
   */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  /** Triangles submitted by the last frame, both passes together. */
  get drawnTriangles(): number {
    return this.renderer.info.render.triangles;
  }

  /**
   * Mean measured GPU duration of a frame, or null without timer queries.
   *
   * Development only in practice: it exists so the on-device frame report can say
   * whether the frame is waiting on the GPU or the CPU, which no other reading can
   * separate on a phone.
   */
  get gpuFrameMs(): number | null {
    return this.adaptiveResolution.averageGpuMs;
  }

  /** Whether the live scale has been measured long enough to stand on its own. */
  get resolutionSettled(): boolean {
    return this.adaptiveResolution.verdictReached(performance.now());
  }

  /**
   * Incorporates completed GPU timer results using this frame's safety policy.
   * With no completed GPU result (including unsupported/disjoint queries), the
   * controller gets a null sample and intentionally retains its current scale.
   */
  adaptResolution(eligible: boolean, allowUpscale: boolean): void {
    this.queryEligible = eligible;
    const now = performance.now();
    let changed = false;

    if (this.completedGpuSamples.length === 0) {
      changed = this.adaptiveResolution.sample(null, eligible, allowUpscale, now) !== null;
    } else {
      while (this.completedGpuSamples.length > 0) {
        const gpuMs = this.completedGpuSamples.shift();
        const sampleEligible = this.completedGpuSampleEligibility.shift();
        if (gpuMs === undefined || sampleEligible === undefined) break;
        changed = this.adaptiveResolution.sample(
          gpuMs,
          eligible && sampleEligible,
          allowUpscale,
          now,
        ) !== null || changed;
      }
    }

    if (!changed) return;
    // setPixelRatio re-sizes the drawing buffer around the current CSS size, so
    // the canvas layout never moves when the resolution changes.
    this.renderer.setPixelRatio(this.basePixelRatio * this.adaptiveResolution.scale);
    this.resizeHazeTarget();
  }

  private beginGpuTimerQuery(): WebGLQuery | null {
    const gl = this.timerQueryGl;
    const ext = this.timerQueryExt;
    if (gl === null || ext === null || this.pendingGpuQueries.length >= MAX_PENDING_GPU_QUERIES) {
      return null;
    }

    const query = gl.createQuery();
    if (query === null) return null;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.pendingGpuQueries.push({
      query,
      eligible: this.queryEligible,
    });
    return query;
  }

  private endGpuTimerQuery(): void {
    const gl = this.timerQueryGl;
    const ext = this.timerQueryExt;
    if (gl !== null && ext !== null) gl.endQuery(ext.TIME_ELAPSED_EXT);
  }

  /** Non-blockingly collects completed GPU timings in submission order. */
  private pollGpuQueries(): void {
    const gl = this.timerQueryGl;
    const ext = this.timerQueryExt;
    if (gl === null || ext === null) return;

    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.disposeGpuQueries();
      return;
    }

    while (this.pendingGpuQueries.length > 0) {
      const pending = this.pendingGpuQueries[0];
      if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) return;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.disposeGpuQueries();
        return;
      }

      this.pendingGpuQueries.shift();
      const result = gl.getQueryParameter(pending.query, gl.QUERY_RESULT);
      const gpuMs = typeof result === 'number' ? result / 1_000_000 : Number.NaN;
      gl.deleteQuery(pending.query);
      if (!Number.isFinite(gpuMs) || gpuMs < 0) continue;
      if (this.completedGpuSamples.length === MAX_PENDING_GPU_QUERIES) {
        this.completedGpuSamples.shift();
        this.completedGpuSampleEligibility.shift();
      }
      this.completedGpuSamples.push(gpuMs);
      this.completedGpuSampleEligibility.push(pending.eligible);
    }
  }

  private disposeGpuQueries(): void {
    if (this.timerQueryGl !== null) {
      for (const { query } of this.pendingGpuQueries) {
        this.timerQueryGl.deleteQuery(query);
      }
    }
    this.pendingGpuQueries.length = 0;
    this.completedGpuSamples.length = 0;
    this.completedGpuSampleEligibility.length = 0;
  }

  /**
   * Switches the resolution/shadow tier in place. MSAA is deliberately untouched:
   * it is an independent display preference.
   */
  setQuality(quality: GraphicsQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.adaptiveResolution.setQuality(quality);
    this.disposeGpuQueries();
    // Read from the table, never re-derived: this line used to test the tier name
    // directly, and a phone's shadow pass is now off on every rung, so a second copy of
    // the rule here would silently disagree with the one the constructor used.
    this.renderer.shadowMap.enabled = shadowsFor(quality, this.mobilePresentation);
    this.basePixelRatio = this.pixelRatioFor(quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
  }

  /**
   * Installs the player's render-scale choice, or returns the rung to automatic.
   *
   * The controller is RESET either way rather than kept: its cost slope and its live
   * average were measured at a different pixel count, and coming back to `Auto` holding
   * a reduction it earned before the change would hand the player a resolution he
   * cannot account for.
   */
  setRenderScale(scale: RenderScale): void {
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    this.adaptiveResolution.setPinned(scale !== null);
    this.disposeGpuQueries();
    this.basePixelRatio = this.pixelRatioFor(this.quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
  }

  /**
   * The CSS viewport the resolution policy is resolved against, for the menu.
   *
   * The menu cannot read `window.innerWidth`: cinema mode shortens the CANVAS, not the
   * window, so the two disagree by 180 pixels exactly while it is on — and a readout
   * that claims a resolution the game is not rendering is the drift this whole control
   * exists to remove.
   */
  viewport(): { readonly cssWidth: number; readonly cssHeight: number } {
    const canvas = this.renderer.domElement;
    return {
      cssWidth: Math.max(1, canvas.clientWidth),
      cssHeight: Math.max(1, canvas.clientHeight),
    };
  }

  /** Changes scene-target multisampling without changing resolution quality. */
  setMsaa(enabled: boolean): void {
    const samples = enabled ? MSAA_SAMPLES : 0;
    if (this.hazeTarget.samples === samples) return;
    this.hazeTarget.samples = samples;
    // Multisampling is allocation state; Three recreates the target on next bind.
    this.hazeTarget.dispose();
  }

  /** Changes post-process outline opacity without rebuilding the shader pass. */
  setInkStrength(strength: number): void {
    this.hazeMaterial.uniforms.uInkStrength.value = Math.min(1, Math.max(0, strength));
  }

  /**
   * Sets the draw distance in place, from the pause menu, with no reload.
   *
   * The far plane clears the draw distance by ORBIT_MARGIN (the far plane is
   * measured from the camera, which can stand that far past the car on the far
   * side of the desert it is looking at) and never drops below CAMERA_FAR, the
   * floor the sky dome and the orbit camera both depend on. The near plane rises
   * with it so the far/near ratio — and therefore the depth resolution spent on
   * the car up close — stays bounded; see MAX_DEPTH_RATIO.
   */
  setViewDistance(metres: number): void {
    const far = farPlaneForViewDistance(metres);
    this.camera.far = far;
    this.camera.near = nearPlaneForFarPlane(far);
    this.camera.updateProjectionMatrix();
  }
}
