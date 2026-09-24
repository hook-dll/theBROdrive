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
export const DEFAULT_EYE_HEIGHT_M = 1.6;
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
export const HAZE_CLOCK_PERIOD_S = 1600;

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

    float airDistance = -airViewZ;

    // AERIAL PERSPECTIVE: the plain's depth. With no mesas to measure by, what tells
    // the eye a far ridge is far is that it is paler and bluer than the near one; each
    // wooded rise behind the last steps back into the haze. Real depth only (the sky
    // sits at the far plane and is left alone), exponential in distance, capped so the
    // farthest ground keeps a silhouette.
    if (airDistance < uCameraFar * 0.999) {
      float veil = (1.0 - exp(-airDistance * 0.00035)) * 0.8 * uDaylight;
      color.rgb = mix(color.rgb, vec3(0.70, 0.77, 0.84), veil);
    }

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
