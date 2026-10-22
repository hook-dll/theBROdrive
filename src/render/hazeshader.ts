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

import { DISPLAY_CURVE_GLSL, SCENE_FROM_SCREEN_GLSL } from './displaytransform';

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
export const DEFAULT_EYE_HEIGHT_M = 1.6;
/**
 * Period of the rise phases, in strata. The lattice wraps its vertical index at this
 * count, so the phase can be reduced modulo it on the CPU and the shader only ever
 * sees a number below 256 — see `advanceHazePhase`.
 */
export const HAZE_PHASE_PERIOD = 256;

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
export function writeHeatMirageUniforms(
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
export const HAZE_FRAGMENT = /* glsl */ `
  ${DISPLAY_CURVE_GLSL}
  ${SCENE_FROM_SCREEN_GLSL}
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uStrength;
  uniform float uMirage;
  uniform float uDaylight;
  uniform float uEyeAbove;
  uniform float uGroundSlope;
  uniform vec2 uHazePhase;
  uniform float uHorizon;
  uniform mat3 uCameraRotation;
  uniform float uTanHalfFov;
  /**
   * Panini strength d of the cinema lens (core/renderer.ts \`panini\`); 0 is the plain
   * rectilinear frame, and is what every frame outside cinema mode has. The scene is
   * rendered rectilinear; the lens shows it fitted to the same horizontal coverage, so
   * the edges stop stretching and the centre comes up larger. A uniform, not a define:
   * toggling or tuning the lens never builds a program.
   */
  uniform float uPanini;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uInkStrength;
  uniform float uInkThreshold;
  uniform float uFxaa;
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

  // --- Weather (world/weather.ts) ---
  /** Distance to an approaching haboob wall, metres upwind; negative when none. */
  uniform float uWallM;
  /** Inside a haboob: the dust's density per metre from the camera; 0 outside. */
  uniform float uDustInside;
  /** Unit horizontal direction the wind blows toward (world x, z). */
  uniform vec2 uWindDir;
  /** The camera's absolute position along the wall, reduced to one noise period. */
  uniform float uWallPan;
  uniform float uWallTime;
  /** Direction to the sun, world space; the sun's display colour; the sky's horizon. */
  uniform vec3 uSunDirW;
  uniform vec3 uSunCol;
  uniform vec3 uWallAir;
  /** The dust's own colour: the sand here, carried round the palette (render/desertdust.ts). */
  uniform vec3 uDustAlbedo;
  /** The thin horizon sand veil's colour, following the sand the same way. */
  uniform vec3 uSandVeil;
  /** How thick the air is (dust, heavy haze), 0..1. */
  uniform float uAirThick;
  /** The FogExp2 density the dust storm adds this frame (sky.dustFogDensity). */
  uniform float uFogDensity;
  /** Colour separation of the grade: >1 scrubbed air, <1 haze and dust. */
  uniform float uGradeSat;
  /** The look's display-space S-curve, 0 (none) .. 1 (full smoothstep). */
  uniform float uContrast;
  /**
   * Suspended haze from the first tens of metres out. The scene fog is exponential-
   * squared, which is right for distance and leaves the near world spotless; real
   * mgla or rain takes the contrast off the NEAR ground too, and that flat, milky
   * foreground is most of what makes it read as weather rather than as far fog.
   */
  uniform float uVeil;

  varying vec2 vUv;

  /** Strata the lattice repeats at vertically; see HAZE_PHASE_PERIOD. */
  const float PHASE_PERIOD = ${HAZE_PHASE_PERIOD.toFixed(1)};
  /**
   * Graze below the ground line past which a ray's shimmer boils in place instead of
   * rising (\`strataLayer\`): 4 mrad meets flat ground about 800 m out from a 3 m eye,
   * so everything nearer stands still and only the far rim keeps the climb.
   */
  const float BOIL_GRAZE_RAD = 0.004;
  /** Lattice rows between two boil slices: far enough apart to be unrelated fields. */
  const float BOIL_SLICE_SHIFT = 37.0;
  const float TURN = 6.28318530718;

  /** Unit view-space direction for a pixel of the rectilinear scene image. */
  vec3 cameraRay(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    return normalize(vec3(
      ndc.x * aspect * uTanHalfFov,
      ndc.y * uTanHalfFov,
      -1.0
    ));
  }

  /**
   * Where in the rectilinear scene image a Panini-projected screen pixel looks.
   *
   * The output keeps the frame's full horizontal coverage (the rectilinear edge maps to
   * the screen edge), with one scale for both axes, so the middle of the frame is
   * magnified and the top and bottom lose a little. Inverse of Sharpless' Panini:
   * screen (x, y) -> longitude, latitude -> rectilinear tangent plane.
   */
  vec2 paniniSource(vec2 uv) {
    float aspect = uResolution.x / uResolution.y;
    float tx = uTanHalfFov * aspect;
    float d = uPanini;
    float edge = atan(tx);
    float xMax = (d + 1.0) * sin(edge) / (d + cos(edge));
    float scale = xMax / tx;
    vec2 ndc = uv * 2.0 - 1.0;
    float x = ndc.x * tx * scale;
    float y = ndc.y * uTanHalfFov * scale;
    float k = x * x / ((d + 1.0) * (d + 1.0));
    float dscr = max(0.0, k * k * d * d - (k + 1.0) * (k * d * d - 1.0));
    float clon = (-k * d + sqrt(dscr)) / (k + 1.0);
    float s = (d + 1.0) / (d + clon);
    float lon = atan(x, s * clon);
    float lat = atan(y, s);
    vec2 plane = vec2(tan(lon), tan(lat) / cos(lon));
    return clamp(vec2(plane.x / tx, plane.y / uTanHalfFov) * 0.5 + 0.5, 0.0, 1.0);
  }

  /**
   * Catmull-Rom bicubic sample of the scene in nine bilinear taps. The lens magnifies
   * the centre past the scene target's own texel grid, and a bilinear tap there is a
   * soft picture.
   */
  vec4 sceneSample(sampler2D tex, vec2 uv) {
    vec2 samplePos = uv * uResolution;
    vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
    vec2 f = samplePos - texPos1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / w12;
    vec2 texPos0 = (texPos1 - 1.0) / uResolution;
    vec2 texPos3 = (texPos1 + 2.0) / uResolution;
    vec2 texPos12 = (texPos1 + offset12) / uResolution;
    vec4 result = vec4(0.0);
    result += texture2D(tex, vec2(texPos0.x, texPos0.y)) * w0.x * w0.y;
    result += texture2D(tex, vec2(texPos12.x, texPos0.y)) * w12.x * w0.y;
    result += texture2D(tex, vec2(texPos3.x, texPos0.y)) * w3.x * w0.y;
    result += texture2D(tex, vec2(texPos0.x, texPos12.y)) * w0.x * w12.y;
    result += texture2D(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
    result += texture2D(tex, vec2(texPos3.x, texPos12.y)) * w3.x * w12.y;
    result += texture2D(tex, vec2(texPos0.x, texPos3.y)) * w0.x * w3.y;
    result += texture2D(tex, vec2(texPos12.x, texPos3.y)) * w12.x * w3.y;
    result += texture2D(tex, vec2(texPos3.x, texPos3.y)) * w3.x * w3.y;
    // Catmull-Rom overshoots at high-contrast edges; a negative colour channel is meaningless.
    return max(result, vec4(0.0));
  }

  /**
   * The scene's colour at \`uv\`: one bilinear tap, or Catmull-Rom while the lens is on.
   * The retro rung keeps its tap even under the lens: its pixels are the look.
   */
  vec4 sceneTap(vec2 uv) {
    #ifndef RETRO
    if (uPanini > 0.0) return sceneSample(tDiffuse, uv);
    #endif
    return texture2D(tDiffuse, uv);
  }

  /**
   * Scene radiance to the display: the tone curve (render/displaytransform.ts), then
   * the sRGB encode. The scene target is linear HDR (core/renderer.ts
   * \`sceneTargetType\`), and this pass is where the picture is mapped to the display,
   * ONCE, after the haze, the mirage, the dust and the veils have worked on radiance.
   * Everything after it — the grade, the ink, the retro dither — works on the encoded picture
   * the eye sees, and FXAA and the ink measure their steps through it (\`fxaaLuma\`,
   * \`inkEdge\`).
   *
   * \`linearToOutputTexel\` is Three's output encode: sRGB for this pass, drawn to the
   * canvas; the identity where tools/haze-probe.ts draws the same source into a target.
   */
  vec3 toDisplay(vec3 radiance) {
    return linearToOutputTexel(vec4(displayCurve(radiance), 1.0)).rgb;
  }

  /**
   * The scene's colour at \`uv\` near enough to how the display shows it for measuring a
   * step: FXAA and the ink take thirty taps a pixel, and the exact transform in each
   * cost a tenth of the frame at 3 Mpx. The curve is the identity below its shoulder,
   * and a square root is the sRGB encode within a few code values.
   */
  vec3 displayTap(vec2 uv) {
    return sqrt(clamp(texture2D(tDiffuse, uv).rgb, 0.0, 1.0));
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
   * One octave of the strata at an (azimuth, elevation), as the field looks after
   * \`phase\` strata of drift.
   *
   * RISING is the strata climbing the sky, which is what hot air over the horizon
   * does. But a stratum is a band of constant ELEVATION, and on flat ground a band of
   * constant elevation below the horizon is a circle round the camera: as it climbs,
   * that circle runs out across the desert to the horizon and is gone. One strong
   * stratum was the wide thin ring the player saw now and then, travelling away from
   * him and vanishing (reported from play, seen about once a week).
   *
   * BOILING is the same lattice evolving in place instead: two time slices of it,
   * crossfaded, so nothing travels. \`boil\` is how much of a ground-grazing ray takes
   * that form (\`hazeWarp\`); the sky and the horizon keep rising.
   */
  float strataLayer(float azimuth, float elevation, float around, float up, float phase, float boil) {
    float rising = boil >= 1.0 ? 0.0 : strataNoise(vec2(azimuth * around, elevation * up - phase), around);
    if (boil <= 0.0) return rising;
    float slice = floor(phase);
    float t = phase - slice;
    t = t * t * (3.0 - 2.0 * t);
    float a = strataNoise(vec2(azimuth * around, elevation * up + slice * BOIL_SLICE_SHIFT), around);
    float b = strataNoise(vec2(azimuth * around, elevation * up + (slice + 1.0) * BOIL_SLICE_SHIFT), around);
    // A crossfade of two independent fields is quieter halfway; rescale so the
    // boil does not pulse once a slice.
    float boiling = mix(a, b, t) / sqrt(t * t + (1.0 - t) * (1.0 - t));
    return mix(rising, boiling, boil);
  }

  /**
   * The stirred layer's refraction at a direction, as a displacement direction in
   * (lateral, vertical), each roughly in [-1, 1].
   *
   * Two octaves of flat strata at their own rates. Which octave dominates is a matter
   * of range: the same eddies further off subtend less, so distant surfaces ripple
   * finely and the middle distance broadly. Only the MIX follows depth — see
   * HAZE_FINE_ONSET_M for why the lattices themselves may not. The same two noises
   * form both channels with swapped weights; a second pair for the small lateral part
   * would double the cost without adding visible structure. Rays that meet the ground
   * steeper than BOIL_GRAZE_RAD boil in place rather than rise (\`strataLayer\`).
   */
  vec2 hazeWarp(vec3 dir, float distance, float climb) {
    float around = atan(dir.x, dir.z) / TURN + 0.5;
    float boil = smoothstep(0.0, BOIL_GRAZE_RAD, -climb);
    float broad = strataLayer(around, dir.y, BROAD_AROUND, BROAD_UP, uHazePhase.x, boil);
    float fine = strataLayer(around, dir.y, FINE_AROUND, FINE_UP, uHazePhase.y, boil);
    float broadShare = mix(0.8, 0.3, smoothstep(FINE_ONSET_M, FINE_FULL_M, distance));
    return vec2(
      (1.0 - broadShare) * broad - broadShare * fine,
      broadShare * broad + (1.0 - broadShare) * fine
    );
  }

  /** Value noise for the dust wall. Arguments stay within a few hundred cells. */
  float wallNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(strataHash(i), strataHash(i + vec2(1.0, 0.0)), w.x),
      mix(strataHash(i + vec2(0.0, 1.0)), strataHash(i + vec2(1.0, 1.0)), w.x),
      w.y
    );
  }

  float wallFbm(vec2 p) {
    return wallNoise(p) * 0.55 + wallNoise(p * 2.13 + 17.0) * 0.3 + wallNoise(p * 4.37 + 41.0) * 0.15;
  }

  /**
   * THE HABOOB WALL, as what it is: a slab of dust standing on a line across the wind,
   * a kilometre high, marching downwind. Every pixel's ray is intersected with the
   * wall's face; if it enters the dust before it reaches the surface the pixel shows,
   * the rest of the ray inside the dust is what hides that surface. So the wall rises
   * behind the dunes and in front of the sky, swallows the road as it comes, and when
   * it is fifty metres away the whole world beyond fifty metres is inside it — with
   * no geometry, no sorting and one branch nobody pays for on a clear day.
   *
   * Returns rgb and opacity.
   */
  vec4 dustWall(vec3 dir, float sceneDistance) {
    float toward = -dot(dir.xz, uWindDir);
    // Cut exactly where the distance fade below reaches zero, never before it.
    if (toward * 22000.0 <= uWallM) return vec4(0.0);
    float entry = uWallM / toward;
    if (entry >= sceneDistance) return vec4(0.0);
    vec3 at = dir * entry;
    float height = at.y + uEyeAbove;
    float along = dot(at.xz, vec2(-uWindDir.y, uWindDir.x)) + uWallPan;
    // Seen along its own length the wall recedes for tens of kilometres; there its
    // fine billows would be sub-pixel noise, so detail gives way to the broad shape.
    float far = smoothstep(2500.0, 14000.0, entry);
    // Crest: towers up to a kilometre and a half along a ragged line, rolling up and
    // over as they come. The billow is advected upward in height, which is how the
    // leading edge of a density current actually churns.
    float crest = mix(mix(560.0, 1450.0, wallFbm(vec2(along / 1300.0, 3.1))), 950.0, far);
    float billow = mix(wallFbm(vec2(along / 210.0, height / 180.0 - uWallTime * 0.05)), 0.5, far);
    float edge = crest + (billow - 0.5) * 520.0;
    float body = smoothstep(edge + 25.0, edge - 150.0, height);
    float path = min(sceneDistance, 60000.0) - entry;
    // Far along its own length the wall thins into the air instead of ending.
    float opacity = body * (1.0 - exp(-path / 40.0)) * (1.0 - smoothstep(6000.0, 22000.0, entry));
    // Light. The face we see points downwind; it is lit when the sun is on our side
    // of it and a silhouette with a burning crest when the sun is behind it.
    vec2 sunFlat = uSunDirW.xz / max(1e-3, length(uSunDirW.xz));
    float frontLit = clamp(0.5 + 0.5 * dot(uWindDir, sunFlat), 0.0, 1.0);
    float rise = clamp(height / max(edge, 1.0), 0.0, 1.0);
    // The face is not a curtain: lobes of denser dust bulge out of it and catch the
    // light, with darker hollows between, and it is streaked where it drags the ground.
    float lobes = mix(wallFbm(vec2(along / 320.0, height / 140.0 - uWallTime * 0.03) + 5.0), 0.5, far);
    float puff = smoothstep(0.25, 0.8, billow) * 0.5 + smoothstep(0.3, 0.75, lobes) * 0.5;
    vec3 albedo = uDustAlbedo;
    vec3 lit = uSunCol * (0.15 + 0.8 * frontLit) * mix(0.25, 0.95, pow(rise, 1.3)) * (0.75 + 0.4 * puff);
    vec3 col = albedo * (uWallAir * 0.45 * (0.85 + 0.25 * puff) + lit);
    // Crest rim when the sun is behind: a thin bright fringe along the edge.
    float rim = smoothstep(edge - 140.0, edge - 10.0, height) * (1.0 - frontLit);
    col += uSunCol * vec3(1.0, 0.72, 0.42) * rim * 0.45;
    // Aerial perspective: tens of kilometres of air turn it into a stain.
    // Aerial perspective: the dust the storm itself has thrown ahead of the wall, by
    // the same law the scene's fog applies to the land, so near arrival a ridge and
    // the wall behind it fade together instead of the ridge standing as a pale
    // cut-out. The clear-air base fog is left out: in clean air a haboob is seen from
    // tens of kilometres, far more sharply than the land in front of it.
    float fogged = 1.0 - exp(-uFogDensity * uFogDensity * entry * entry);
    col = mix(col, uWallAir, max(fogged, 1.0 - exp(-entry / 16000.0)));
    return vec4(col, opacity);
  }

  /**
   * Ink outline strength at a pixel, from the colour gradient around it.
   *
   * A Sobel on the already-shaded image, not on a depth buffer, and deliberately:
   * the ground's own shading is banded (render/comic.ts), so its band boundaries ARE
   * the strata edges a pen would draw, and a colour edge detector inks both those and
   * every silhouette in one pass.
   *
   * Full RGB distance rather than luminance: a tan dune against a blue sky is a
   * enormous HUE step and barely a brightness one, so a luminance-only detector left
   * the one edge that matters most — the skyline — undrawn.
   *
   * Taps are a pixel and a half out, so the line lands on the edge itself rather than
   * on the antialiasing gradient beside it. Measured on the displayed picture
   * (\`displayTap\`): an edge is a step the eye sees, and in radiance the same dune
   * edge is a step ten times larger at noon than at dusk.
   */
  float inkEdge(vec2 uv, vec2 texel) {
    vec2 d = texel * 1.5;
    vec3 c  = displayTap(uv);
    vec3 cx = displayTap(uv + vec2(d.x, 0.0));
    vec3 cX = displayTap(uv - vec2(d.x, 0.0));
    vec3 cy = displayTap(uv + vec2(0.0, d.y));
    vec3 cY = displayTap(uv - vec2(0.0, d.y));
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

  /** FXAA's edge thresholds: the contrast below which a pixel is left alone, absolute and
   *  relative to its brightest neighbour. FXAA 3.11's own "high quality" pair: the
   *  stricter "extreme" one three's FXAAShader uses also softens the road's aggregate and
   *  the stipple, which are texture, not jaggies. */
  #define FXAA_CONTRAST 0.0625
  #define FXAA_RELATIVE 0.125
  /** How much of the sub-pixel blend is taken; 1 is the full blur of a lone bright texel. */
  #define FXAA_SUBPIXEL 0.75
  #define FXAA_STEPS 6
  #define FXAA_GUESS 8.0
  /** Pixels per step of the walk along an edge, after the first. */
  const float FXAA_STEP[FXAA_STEPS] = float[FXAA_STEPS](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);

  /** Luma of the picture as the display shows it: what the eye sees as a step. */
  float fxaaLuma(vec2 uv) {
    return dot(displayTap(uv), vec3(0.299, 0.587, 0.114));
  }

  /**
   * The picture at \`uv\` through FXAA (Lottes' algorithm, in the form three ships as
   * FXAAShader): a pixel on a luma edge is sampled a fraction of a pixel across it, by
   * how far along the edge's run it stands, so a stair of whole pixels becomes a ramp.
   * Five taps decide that a pixel is flat, and most of a frame is.
   *
   * It replaces four-sample MSAA, which had to resolve the colour and the depth target
   * every frame. FXAA works on the shaded picture, so it smooths what MSAA never could
   * (the edges inside alpha-tested leaves and in the banded shading) and is blind to a
   * sub-pixel wire, which MSAA saw. The ink is drawn after it, from the same picture.
   */
  vec4 fxaaSample(vec2 uv) {
    vec2 px = 1.0 / uResolution;
    float m = fxaaLuma(uv);
    float n = fxaaLuma(uv + vec2(0.0, px.y));
    float e = fxaaLuma(uv + vec2(px.x, 0.0));
    float s = fxaaLuma(uv - vec2(0.0, px.y));
    float w = fxaaLuma(uv - vec2(px.x, 0.0));
    float highest = max(max(max(max(n, e), s), w), m);
    float lowest = min(min(min(min(n, e), s), w), m);
    float contrast = highest - lowest;
    if (contrast < max(FXAA_CONTRAST, FXAA_RELATIVE * highest)) return sceneTap(uv);
    float ne = fxaaLuma(uv + px);
    float nw = fxaaLuma(uv + vec2(-px.x, px.y));
    float se = fxaaLuma(uv + vec2(px.x, -px.y));
    float sw = fxaaLuma(uv - px);

    // Sub-pixel: how far the centre stands from its neighbourhood's weighted mean.
    float mean = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
    float sub = smoothstep(0.0, 1.0, clamp(abs(mean - m) / contrast, 0.0, 1.0));
    sub = sub * sub * FXAA_SUBPIXEL;

    // The edge's direction, and the side of this pixel it runs along.
    float horizontal = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
    float vertical = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
    bool isHorizontal = horizontal >= vertical;
    float pLuma = isHorizontal ? n : e;
    float nLuma = isHorizontal ? s : w;
    float pGradient = abs(pLuma - m);
    float nGradient = abs(nLuma - m);
    float across = isHorizontal ? px.y : px.x;
    float opposite = pLuma;
    float gradient = pGradient;
    if (pGradient < nGradient) {
      across = -across;
      opposite = nLuma;
      gradient = nGradient;
    }

    // Walk the edge both ways to where it ends.
    vec2 edgeUv = uv;
    vec2 along = isHorizontal ? vec2(px.x, 0.0) : vec2(0.0, px.y);
    if (isHorizontal) edgeUv.y += across * 0.5;
    else edgeUv.x += across * 0.5;
    float edgeLuma = (m + opposite) * 0.5;
    float threshold = gradient * 0.25;
    vec2 pUv = edgeUv + along * FXAA_STEP[0];
    float pDelta = fxaaLuma(pUv) - edgeLuma;
    bool pEnd = abs(pDelta) >= threshold;
    for (int i = 1; i < FXAA_STEPS && !pEnd; i++) {
      pUv += along * FXAA_STEP[i];
      pDelta = fxaaLuma(pUv) - edgeLuma;
      pEnd = abs(pDelta) >= threshold;
    }
    if (!pEnd) pUv += along * FXAA_GUESS;
    vec2 nUv = edgeUv - along * FXAA_STEP[0];
    float nDelta = fxaaLuma(nUv) - edgeLuma;
    bool nEnd = abs(nDelta) >= threshold;
    for (int i = 1; i < FXAA_STEPS && !nEnd; i++) {
      nUv -= along * FXAA_STEP[i];
      nDelta = fxaaLuma(nUv) - edgeLuma;
      nEnd = abs(nDelta) >= threshold;
    }
    if (!nEnd) nUv -= along * FXAA_GUESS;

    float pDistance = isHorizontal ? pUv.x - uv.x : pUv.y - uv.y;
    float nDistance = isHorizontal ? uv.x - nUv.x : uv.y - nUv.y;
    bool pNearer = pDistance <= nDistance;
    float shortest = pNearer ? pDistance : nDistance;
    bool deltaSign = (pNearer ? pDelta : nDelta) >= 0.0;
    // Blended only on the side of the edge where the run ends: the other side is the edge's
    // inside, already the right colour.
    float edgeBlend = deltaSign == (m - edgeLuma >= 0.0) ? 0.0 : 0.5 - shortest / (pDistance + nDistance);
    float blend = max(sub, edgeBlend);
    if (isHorizontal) uv.y += across * blend;
    else uv.x += across * blend;
    return sceneTap(uv);
  }

  void main() {
    // The scene image's coordinate this screen pixel shows: itself, or through the
    // cinema lens. Everything that reads the scene uses it; the screen overlays
    // (binocular eyes, viewfinder) stay on vUv.
    vec2 sceneUv = uPanini > 0.0 ? paniniSource(vUv) : vUv;
    vec2 uv = sceneUv;
    // One depth tap every pixel pays whatever happens: the veil, the ink gate and
    // the warp all read it.
    float ownViewZ = perspectiveDepthToViewZ(texture2D(tDepth, sceneUv).x);
    float airViewZ = ownViewZ;
    float mirageWeight = 0.0;
    vec2 mirrorUv = sceneUv;
    // A uniform branch, so every fragment takes the same side: at night and on the
    // cheapest tier nothing below is evaluated at all.
    if (uStrength > 0.0 || uMirage > 0.0) {
      vec3 viewDir = cameraRay(sceneUv);
      vec3 dir = normalize(uCameraRotation * viewDir);
      float distance = rayDistance(ownViewZ, viewDir);
      // The ray's climb over the grazed-ground line, per metre of ray: what decides
      // how long it stays in the hot air.
      float climb = dir.y - uGroundSlope * length(dir.xz);
      float path = layerPath(climb, distance) / REF_PATH_M;
      // Real first-surface depth keeps nearby geometry rigid wherever it is on screen.
      float depthClear = smoothstep(NEAR_CLEAR_M, NEAR_FULL_M, distance);
      // Ground is uniquely intolerant of a missing depth sample: one cleared texel at
      // a silhouette would otherwise make the road boil underfoot. A conservative
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
        vec2 warp = hazeWarp(dir, distance, climb);
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
        vec2 candidate = clamp(sceneUv + offset, 0.0, 1.0);
        float candidateViewZ = perspectiveDepthToViewZ(texture2D(tDepth, candidate).x);
        float keep = smoothstep(
          NEAR_CLEAR_M,
          NEAR_FULL_M,
          rayDistance(candidateViewZ, viewDir)
        );
        offset *= keep;
        uv = clamp(sceneUv + offset, 0.0, 1.0);
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
        mirrorUv = clamp(sceneUv + upScreen * (2.0 * graze * perRadian) + offset, 0.0, 1.0);
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
    // A uniform branch: every fragment agrees, and with FXAA off this is the one tap.
    vec4 color = uFxaa > 0.5 ? fxaaSample(uv) : sceneTap(uv);
    if (mirageWeight > 0.0) {
      color.rgb = mix(color.rgb, sceneTap(mirrorUv).rgb, mirageWeight);
    }

    // Everything from here on is colour, not refraction. tools/haze-probe.ts reads the
    // SOURCE COORDINATE this pass sampled out of a coordinate-coded image, and any
    // colour operation — grade, dither, the lenses — would corrupt that measurement, so
    // it compiles the real pass with this one define and the rest skipped.
    #ifndef HAZE_MEASURE_SOURCE

    if (uWallM >= 0.0 || uDustInside > 0.0) {
      vec3 wallView = cameraRay(sceneUv);
      float sceneD = -ownViewZ >= uCameraFar * 0.999 ? 1e7 : rayDistance(ownViewZ, wallView);
      if (uWallM >= 0.0) {
        vec4 wall = dustWall(normalize(uCameraRotation * wallView), sceneD);
        color.rgb = mix(color.rgb, sceneFromScreen(wall.rgb), wall.a);
      }
      // Inside the storm: the wall's own dust, lit as its foot is (low on the face, so
      // little of the sun), hiding every pixel by its distance. The sky counts as 2 km,
      // so it goes under in the thick of it and comes back as the storm thins.
      if (uDustInside > 0.0) {
        vec2 sunFlat = uSunDirW.xz / max(1e-3, length(uSunDirW.xz));
        float frontLit = clamp(0.5 + 0.5 * dot(uWindDir, sunFlat), 0.0, 1.0);
        vec3 inside = uDustAlbedo * (uWallAir * 0.45 + uSunCol * (0.15 + 0.8 * frontLit) * 0.25);
        float k = uDustInside * min(sceneD, 2000.0);
        color.rgb = mix(color.rgb, sceneFromScreen(inside), 1.0 - exp(-k * k));
      }
    }

    // A thin sand veil where the sight line has crossed kilometres of desert air.
    // Real scene depth keeps the foreground, cabin and car untouched; a narrow fade
    // above the geometric horizon lets the suspended dust soften that boundary
    // without tinting the open sky. This complements the world's distance fog rather
    // than replacing it, so regional haze and view-distance settings remain sovereign.
    float airDistance = -airViewZ;
    float horizonAir =
      1.0 - smoothstep(uHorizon + 0.015, uHorizon + 0.14, sceneUv.y);
    float sandVeil =
      smoothstep(220.0, 1800.0, airDistance) * horizonAir * uDaylight * 0.032;
    // In thick air the veil is that air, or it draws a pale band along the skyline.
    color.rgb = mix(color.rgb, sceneFromScreen(mix(uSandVeil, uWallAir, uAirThick)), sandVeil);
    if (uVeil > 0.0 && airDistance < uCameraFar * 0.999) {
      color.rgb = mix(color.rgb, sceneFromScreen(uWallAir), uVeil * (1.0 - exp(-airDistance / 320.0)));
    }
    // The one display transform of the frame. Everything above worked on radiance —
    // the dust, the veils, the mirage are light added and taken away, as the scene's
    // own fog is — and everything below works on the picture the display shows.
    color.rgb = toDisplay(color.rgb);

    // A small finish on the displayed picture: a luminance-preserving colour
    // separation, then warm highlights against slightly cooler shadows. It enriches
    // the desert palette without being a second tone curve. The separation is the
    // art direction's: 1.5 keeps the desert the saturated ochre it was painted against
    // a frame shown a gamma dark, where every colour's channel ratios reached the screen
    // squared; the authored palette through the encoded frame alone reads pale.
    float gradeLum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(gradeLum), color.rgb, 1.5 * uGradeSat);
    float highlightWarmth = smoothstep(0.16, 0.82, gradeLum);
    color.rgb *= mix(
      vec3(0.993, 0.998, 1.006),
      vec3(1.012, 1.003, 0.985),
      highlightWarmth
    );
    color.rgb = clamp(color.rgb, 0.0, 1.0);
    // The look's contrast: a smoothstep S on the displayed values, black and white
    // held. The game was painted against a frame shown a gamma dark, which read as hard
    // noon contrast; the encoded frame is right and flatter, and this is where the art
    // direction puts the punch back, after the tone curve and before the ink.
    color.rgb = mix(color.rgb, color.rgb * color.rgb * (3.0 - 2.0 * color.rgb), uContrast);

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

    #ifdef RETRO
    // The retro rung's ORDERED dither onto a short palette: a fixed 4x4 Bayer pattern
    // stays put on the screen and turns every gradient — the sky, the sand falling away
    // into fog — into the stepped bands of a period framebuffer.
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    vec2 cellLow = mod(cell, 2.0);
    vec2 cellHigh = floor(cell * 0.5);
    float bayer = (
      4.0 * mod(2.0 * cellLow.x + 3.0 * cellLow.y, 4.0)
      + mod(2.0 * cellHigh.x + 3.0 * cellHigh.y, 4.0)
    ) / 16.0;
    color.rgb = clamp(floor(color.rgb * RETRO_LEVELS + bayer) / RETRO_LEVELS, 0.0, 1.0);
    #endif

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
