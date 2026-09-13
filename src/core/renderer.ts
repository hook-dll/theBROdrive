import * as THREE from 'three';
import { AdaptiveResolutionController } from './adaptivequality';
import { DEFAULT_INK_STRENGTH, type GraphicsQuality } from '../game/settings';
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
 * Resting vertical field of view, degrees, for every camera mode — on foot and in
 * the car alike. 65 matches The Long Drive, and it matters more than it sounds: FOV
 * sets the apparent scale of the whole world, so a couple of degrees changes how big
 * the car feels and how fast the road appears to move.
 *
 * `Cameras` owns the speed-scaled widening on top of this; this is the value every
 * mode settles back to, and it lives here so the initial camera and the camera rig
 * cannot drift apart the way a duplicated literal did.
 */
export const CAMERA_BASE_FOV = 65;

/**
 * Acceptable uses an absolute pixel budget rather than a display percentage. A
 * 1080p monitor therefore starts near 1600x900, a 720p panel remains native, and
 * a 4K television cannot accidentally ask a 6 W iGPU to shade millions of pixels.
 */
const ACCEPTABLE_MAX_PIXELS = 1600 * 900;
const ACCEPTABLE_MIN_PIXELS = 1280 * 720;
/**
 * Phone screens make raw DPR a poor quality target: their small pixels invite the
 * browser to render several million scene pixels before MSAA and the post pass. Keep
 * the same tier ordering, shaders and geometry under an absolute portable budget.
 */
const MOBILE_MAX_PIXELS: Record<GraphicsQuality, number> = {
  acceptable: 960 * 540,
  standard: 1280 * 720,
  blessing: 1600 * 900,
};
const MOBILE_MIN_PIXELS: Record<GraphicsQuality, number> = {
  acceptable: 640 * 360,
  standard: 960 * 540,
  blessing: 1280 * 720,
};
const PIXEL_RATIO_SCALE: Record<GraphicsQuality, number> = {
  acceptable: 1,
  standard: 1,
  blessing: 1.25,
};
/** Absolute guard against pathological browser DPR values and oversized targets. */
const MAX_PIXEL_RATIO: Record<GraphicsQuality, number> = {
  acceptable: 1,
  standard: 2,
  blessing: 2.5,
};
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

/** Never spend a phone's 90/120 Hz refresh budget on duplicate 60 Hz simulation states. */
export function presentationFpsFor(
  quality: GraphicsQuality,
  mobilePresentation = prefersMobilePresentation(),
): number | null {
  if (quality === 'acceptable') return 30;
  return mobilePresentation ? 60 : null;
}
// ---------------------------------------------------------------------------
// Heat haze: refraction through the hot layer over the sand, as a post pass.
//
// Shimmer is not a screen effect that happens near the horizon. It is what a sight
// line does when it spends a long way inside air whose refractive index is being
// stirred by convection, and everything below follows from that one sentence:
//
//   WHERE     the hot air is a shallow layer lying on the ground. For each pixel the
//             shader integrates that layer along the pixel's own world-space view ray.
//             The scene depth then limits the effect to light that has actually
//             travelled far enough through it. A steep ray leaves the layer at once
//             and gets nothing, which is why the sky is still. A grazing ray runs for
//             hundreds of metres, which is why the horizon boils. The road and nearby
//             objects remain rigid because their real depth never reaches the haze.
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
//             and read as a distortion filter welded to the screen.
//
//   OF WHAT   a field of convection cells sampled on a sphere of fixed radius around
//             the eye — the "constant range around the player". A DIRECTION, not a
//             position: pan, and the pattern stays over the same part of the desert,
//             because that is what looking at the same air twice means. Translation
//             is deliberately absent. The coherent part of the perturbation is set by
//             the far half of the ray, hundreds of metres out, which does not change
//             when the car moves thirty metres; letting position in would smear the
//             field past the eye at v/cellSize — tens of Hz at road speed, which is
//             scintillation, not shimmer. All the motion comes from the field's own
//             convection, which is where a real one's comes from too.
// ---------------------------------------------------------------------------

/**
 * Scale height of the hot air over the sand, metres.
 *
 * NOT a hard-edged slab, and the difference matters. A slab clipped at head height is
 * geometrically exact over a flat plane and useless over this desert: the sight line to
 * a dune four hundred metres away and fifteen metres tall leaves a two-metre slab in
 * the first hundred, so the one thing in the frame that should boil hardest would get
 * nothing at all. Measured on the real pass (tools/haze-probe.ts), a hard slab put
 * every last milliradian inside one degree of the horizon and left a razor line.
 *
 * So the air thins with height instead of stopping, `exp(-y / H)`, and the shader
 * integrates that along the ray in closed form. Eight metres is the height over which
 * "close to hot ground" stops being true out here — a few metres of genuinely
 * superheated air, plus the tens of metres of relief the ground itself has, which is
 * what keeps a distant dune crest inside the hot air all the way to the eye.
 */
const HAZE_SCALE_HEIGHT_M = 8.0;
/**
 * Path length inside the layer, metres, at which the shimmer is fully developed.
 *
 * Deflections along a stirred path add as a random walk, so the honest law is
 * `sqrt(L)`. It is not used raw. A random walk of tiny deflections is also a random
 * walk of tiny CELLS, and the fine structure a short path accumulates averages itself
 * away before it is large enough on screen to be seen at all — sqrt puts a fifth of
 * full shimmer on ground twenty metres away, which nobody sees in reality. The onset
 * below is therefore shaped: nothing for the first tens of metres, building through
 * the middle distance, saturated at the horizon.
 */
const HAZE_REF_PATH_M = 350;
/** Scene geometry closer than this many metres remains completely free of shimmer. */
const HAZE_NEAR_CLEAR_M = 45;
/** Scene distance by which the actual depth buffer may receive full path-based haze. */
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
const HAZE_GROUND_CLEAR_M = 90;
const HAZE_GROUND_FULL_M = 220;
/**
 * Peak angular displacement, milliradians, at full development.
 *
 * The previous 7.2 mrad peak was reported as a very strong displacement wave in the
 * shipped desert. Halving the physical angle preserves the path/depth behavior while
 * removing the gelatinous motion; binocular tuning can then amplify this controlled
 * atmosphere rather than an already excessive base.
 */
const HAZE_ANGLE_MRAD = 3.6;
/**
 * Upward bias, milliradians at full development: the inferior mirage.
 *
 * Hot air below cool bends a ray upward, so distant ground appears RAISED and
 * vertically squeezed toward the horizon. It scales with the shimmer reduction above
 * so the whole refractive movement becomes quieter without changing its shape.
 */
const HAZE_LIFT_MRAD = 0.88;
/**
 * Radius of the sphere the convection field is sampled on, metres, and the cell sizes
 * on it.
 *
 * The pair sets the ANGULAR size of a cell — `size / range` — and that is the only
 * thing the screen sees: 1.1 m at 20 m is 3.2 degrees, 0.45 m is 1.3. Both are broad,
 * soft blobs rather than texture, which is what refraction through metre-scale eddies
 * looks like.
 */
const HAZE_SAMPLE_RANGE_M = 20;
const HAZE_CELL_BROAD_M = 1.1;
const HAZE_CELL_FINE_M = 0.45;
/**
 * How fast each scale of the field rises, m/s. Convective plumes over hot ground climb
 * at around a metre a second, and small eddies live and die faster than large ones —
 * so the fine scale is given the quicker drift. Against the cell sizes above that is
 * roughly 1 Hz of slow boil with 4 Hz of flicker inside it, which is the rate a real
 * one flickers at.
 */
const HAZE_RISE_BROAD_MPS = 1.1;
const HAZE_RISE_FINE_MPS = 1.9;
/** Vertical stretch of the cells: rising plumes are taller than they are wide. */
const HAZE_PLUME_STRETCH = 1.7;
/** Share of the displacement that is lateral. Stratified air bends light vertically. */
const HAZE_LATERAL_SHARE = 0.34;
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
export interface HeatMirageParameters {
  readonly scaleHeightM: number;
  readonly referencePathM: number;
  readonly nearClearM: number;
  readonly nearFullM: number;
  readonly groundClearM: number;
  readonly groundFullM: number;
  readonly angleMrad: number;
  readonly liftMrad: number;
  readonly sampleRangeM: number;
  readonly broadCellM: number;
  readonly fineCellM: number;
  readonly broadRiseMps: number;
  readonly fineRiseMps: number;
  readonly plumeStretch: number;
  readonly lateralShare: number;
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
  liftMrad: HAZE_LIFT_MRAD,
  sampleRangeM: HAZE_SAMPLE_RANGE_M,
  broadCellM: HAZE_CELL_BROAD_M,
  fineCellM: HAZE_CELL_FINE_M,
  broadRiseMps: HAZE_RISE_BROAD_MPS,
  fineRiseMps: HAZE_RISE_FINE_MPS,
  plumeStretch: HAZE_PLUME_STRETCH,
  lateralShare: HAZE_LATERAL_SHARE,
  minimumEyeHeightM: HAZE_MIN_EYE_ABOVE_M,
};

/** Fresh uniform cells for every material that compiles the production mirage pass. */
export function createHeatMirageUniforms(
  parameters: HeatMirageParameters = DEFAULT_HEAT_MIRAGE,
): Record<string, { value: number }> {
  return {
    SCALE_HEIGHT_M: { value: parameters.scaleHeightM },
    REF_PATH_M: { value: parameters.referencePathM },
    NEAR_CLEAR_M: { value: parameters.nearClearM },
    NEAR_FULL_M: { value: parameters.nearFullM },
    GROUND_CLEAR_M: { value: parameters.groundClearM },
    GROUND_FULL_M: { value: parameters.groundFullM },
    ANGLE_RAD: { value: parameters.angleMrad / 1000 },
    LIFT_RAD: { value: parameters.liftMrad / 1000 },
    SAMPLE_RANGE_M: { value: parameters.sampleRangeM },
    CELL_BROAD: { value: parameters.broadCellM },
    CELL_FINE: { value: parameters.fineCellM },
    RISE_BROAD: { value: parameters.broadRiseMps },
    RISE_FINE: { value: parameters.fineRiseMps },
    PLUME_STRETCH: { value: parameters.plumeStretch },
    LATERAL_SHARE: { value: parameters.lateralShare },
  };
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
  uniform float uDaylight;
  uniform float uEyeAbove;
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
  uniform float ANGLE_RAD;
  uniform float LIFT_RAD;
  uniform float SAMPLE_RANGE_M;
  uniform float CELL_BROAD;
  uniform float CELL_FINE;
  uniform float RISE_BROAD;
  uniform float RISE_FINE;
  uniform float PLUME_STRETCH;
  uniform float LATERAL_SHARE;

  varying vec2 vUv;
  uniform float GROUND_CLEAR_M;
  uniform float GROUND_FULL_M;

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

  /** Actual distance from the eye to the first rendered surface on this pixel ray. */
  float sceneDistance(vec2 uv, vec3 viewDir) {
    float viewZ = perspectiveDepthToViewZ(texture2D(tDepth, uv).x);
    return min(uCameraFar, -viewZ / max(1e-4, -viewDir.z));
  }

  /**
   * Effective length of hot air on this ray, metres: the integral of the air's own
   * density profile along it.
   *
   * The hot air thins as exp(-y / H) above the sand, with y measured from the ground
   * under the eye, so what the ray accumulates is the integral of that from the eye to
   * wherever the ray ends. Both cases close in one exponential:
   *
   *   climbing   the ray never lands, and the tail integrates to  (H / dy)·e^(-y0/H)
   *   descending it lands at y = 0, and the run integrates to  (H / |dy|)·(1 - e^(-y0/H))
   *
   * Level rays diverge, which is correct — they graze the hot air forever — so the
   * result is clamped at REF_PATH_M, the distance past which the fog has taken the
   * scene anyway.
   *
   * The near-zero guard on dy is not cosmetic: the level ray divides by it, and its
   * path is the one that matters most.
   */
  float layerPath(vec3 dir) {
    float dy = abs(dir.y) < 1e-4 ? (dir.y >= 0.0 ? 1e-4 : -1e-4) : dir.y;
    float atEye = exp(-uEyeAbove / SCALE_HEIGHT_M);
    float span = SCALE_HEIGHT_M / abs(dy);
    float integral = dy > 0.0 ? span * atEye : span * (1.0 - atEye);
    return clamp(integral, 0.0, REF_PATH_M);
  }

  /** Hash of an integer lattice point to [0, 1). */
  float cellHash(vec3 p) {
    vec3 q = fract(p * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y + q.z) * q.z);
  }

  /**
   * Smooth 3D value noise, in [-1, 1].
   *
   * THREE dimensions, where the previous version projected the sphere of view
   * directions onto a plane and sampled 2D. That projection folds: two directions on
   * opposite sides of the sky map to the same place, so panning far enough replayed
   * the same cells mirrored. A field on a sphere has to be sampled in the space the
   * sphere lives in.
   */
  float cellNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 w = f * f * (3.0 - 2.0 * f);
    float c000 = cellHash(i);
    float c100 = cellHash(i + vec3(1.0, 0.0, 0.0));
    float c010 = cellHash(i + vec3(0.0, 1.0, 0.0));
    float c110 = cellHash(i + vec3(1.0, 1.0, 0.0));
    float c001 = cellHash(i + vec3(0.0, 0.0, 1.0));
    float c101 = cellHash(i + vec3(1.0, 0.0, 1.0));
    float c011 = cellHash(i + vec3(0.0, 1.0, 1.0));
    float c111 = cellHash(i + vec3(1.0, 1.0, 1.0));
    float x00 = mix(c000, c100, w.x);
    float x10 = mix(c010, c110, w.x);
    float x01 = mix(c001, c101, w.x);
    float x11 = mix(c011, c111, w.x);
    return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z) * 2.0 - 1.0;
  }

  /**
   * The convection field, sampled on a sphere of fixed radius around the eye and
   * animated by its own rise. Returns a displacement direction in (lateral, vertical),
   * each roughly in [-1, 1].
   *
   * Cells are stretched vertically because a plume is. The same two decorrelated
   * scales form both channels with different weights; evaluating two more 3D fields
   * for the much smaller lateral component doubled the full-screen cost without adding
   * visible structure.
   */
  vec2 hazeWarp(vec3 dir) {
    vec3 p = dir * SAMPLE_RANGE_M;
    vec3 broadP = vec3(p.x, p.y / PLUME_STRETCH - uTime * RISE_BROAD, p.z) / CELL_BROAD;
    vec3 fineP = vec3(p.x, p.y / PLUME_STRETCH - uTime * RISE_FINE, p.z) / CELL_FINE;
    float broad = cellNoise(broadP);
    float fine = cellNoise(fineP);
    float vertical = broad * 0.72 + fine * 0.28;
    float lateral = broad * 0.28 - fine * 0.72;
    return vec2(lateral, vertical);
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
    // The warp is skipped outright when shimmer is off. This is a uniform branch, so
    // every fragment takes the same side and the field is not evaluated at all on the
    // cheapest graphics tier or at night.
    vec2 uv = vUv;
    float shimmerWeight = 0.0;
    if (uStrength > 0.0) {
      vec3 viewDir = cameraRay(vUv);
      vec3 dir = normalize(uCameraRotation * viewDir);
      // Everything the pixel gets follows from how far its ray runs through hot air.
      float path = layerPath(dir) / REF_PATH_M;
      // The former mask relied only on ray elevation and a flat ground plane. The
      // scene pass now supplies the real first-surface depth, keeping nearby geometry
      // rigid regardless of where it appears on screen.
      float depthClear = smoothstep(
        NEAR_CLEAR_M,
        NEAR_FULL_M,
        sceneDistance(vUv, viewDir)
      );
      // Ground is uniquely intolerant of a missing depth sample: one cleared texel at
      // an MSAA edge would otherwise make the road boil underfoot. A conservative
      // ray/plane backup excludes only descending rays whose ground intersection is
      // nearby; actual depth remains authoritative for every object and distant slope.
      float groundClear = 1.0;
      if (dir.y < -1e-4) {
        float groundDistance = uEyeAbove / -dir.y;
        groundClear = smoothstep(GROUND_CLEAR_M, GROUND_FULL_M, groundDistance);
      }
      // Shaped atmospheric onset plus both real-depth and ground safeguards.
      shimmerWeight =
        uStrength * path * path * (3.0 - 2.0 * path) * min(depthClear, groundClear);
      vec2 warp = hazeWarp(dir);

      // Angle to screen. A displacement of a radians spans a / (2*tan(halfFov)) of
      // the frame height, and the same over the width with the aspect divided out —
      // which is what makes the boil magnify correctly under the binoculars instead of
      // staying a fixed number of pixels wide.
      float aspect = uResolution.x / uResolution.y;
      float perRadian = 0.5 / uTanHalfFov;
      float vertical = warp.y * ANGLE_RAD - LIFT_RAD;
      vec2 offset = vec2(
        (warp.x * LATERAL_SHARE * ANGLE_RAD * perRadian) / aspect,
        vertical * perRadian
      ) * shimmerWeight;
      uv = clamp(vUv + offset, 0.0, 1.0);
    }
    vec4 color = texture2D(tDiffuse, uv);

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
    float airDistance = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x);
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
   * Camera height above the ground, metres, for the hot-layer integration. Defaulted
   * to a standing eye so the very first frame is sensible before the loop supplies one.
   */
  private hazeEyeHeight = DEFAULT_EYE_HEIGHT_M;
  private hazeMinimumEyeHeight = DEFAULT_HEAT_MIRAGE.minimumEyeHeightM;
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
      powerPreference: 'high-performance',
    });
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
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = quality !== 'acceptable';
    // PCFSoft's wider kernel costs extra texture taps for a blur that reads as
    // noise at this shadow resolution; plain PCF is visually near-identical and
    // materially cheaper on a low-end iGPU.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const viewportWidth = Math.max(1, canvas.clientWidth);
    const viewportHeight = Math.max(1, canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_BASE_FOV,
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
        ...createHeatMirageUniforms(),
        uDaylight: { value: 0 },
        uEyeAbove: { value: DEFAULT_EYE_HEIGHT_M },
        uHorizon: { value: 0.5 },
        uCameraRotation: { value: new THREE.Matrix3() },
        uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(CAMERA_BASE_FOV) / 2) },
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

  private pixelRatioFor(quality: GraphicsQuality): number {
    const dpr = window.devicePixelRatio;
    const canvas = this.renderer.domElement;
    const cssPixels = Math.max(1, canvas.clientWidth * canvas.clientHeight);
    const desired = quality === 'acceptable'
      ? Math.min(dpr, Math.sqrt(ACCEPTABLE_MAX_PIXELS / cssPixels))
      : Math.min(dpr * PIXEL_RATIO_SCALE[quality], MAX_PIXEL_RATIO[quality]);
    if (!this.mobilePresentation) return desired;
    return Math.min(desired, Math.sqrt(MOBILE_MAX_PIXELS[quality] / cssPixels));
  }

  private updateAdaptiveFloor(): void {
    const minimumPixels = this.mobilePresentation
      ? MOBILE_MIN_PIXELS[this.quality]
      : this.quality === 'acceptable'
        ? ACCEPTABLE_MIN_PIXELS
        : null;
    if (minimumPixels === null) return;
    const canvas = this.renderer.domElement;
    const basePixels =
      canvas.clientWidth * canvas.clientHeight * this.basePixelRatio * this.basePixelRatio;
    this.adaptiveResolution.setMinimumScale(
      Math.min(1, Math.sqrt(minimumPixels / Math.max(1, basePixels))),
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
    // Seconds. The field's drift rates are metres per second in its own sampled
    // space, so time here has to be real time and nothing else.
    this.hazeMaterial.uniforms.uTime.value = performance.now() * 0.001;
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
    // (see `setHazeStrength`), which is where the cost actually was.
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
    const uniforms = this.hazeMaterial.uniforms;
    uniforms.SCALE_HEIGHT_M.value = Math.max(0.1, parameters.scaleHeightM);
    uniforms.REF_PATH_M.value = Math.max(1, parameters.referencePathM);
    uniforms.NEAR_CLEAR_M.value = Math.max(0, parameters.nearClearM);
    uniforms.NEAR_FULL_M.value = Math.max(uniforms.NEAR_CLEAR_M.value + 1, parameters.nearFullM);
    uniforms.GROUND_CLEAR_M.value = Math.max(0, parameters.groundClearM);
    uniforms.GROUND_FULL_M.value = Math.max(
      uniforms.GROUND_CLEAR_M.value + 1,
      parameters.groundFullM,
    );
    uniforms.ANGLE_RAD.value = Math.max(0, parameters.angleMrad) / 1000;
    uniforms.LIFT_RAD.value = parameters.liftMrad / 1000;
    uniforms.SAMPLE_RANGE_M.value = Math.max(0.1, parameters.sampleRangeM);
    uniforms.CELL_BROAD.value = Math.max(0.01, parameters.broadCellM);
    uniforms.CELL_FINE.value = Math.max(0.01, parameters.fineCellM);
    uniforms.RISE_BROAD.value = parameters.broadRiseMps;
    uniforms.RISE_FINE.value = parameters.fineRiseMps;
    uniforms.PLUME_STRETCH.value = Math.max(0.1, parameters.plumeStretch);
    uniforms.LATERAL_SHARE.value = Math.min(1, Math.max(0, parameters.lateralShare));
    this.hazeMinimumEyeHeight = parameters.minimumEyeHeightM;
  }
  /**
   * How far the camera is above the ground it is looking across, metres. Supplied by
   * the composition root, which is the only thing that knows both the camera and the
   * terrain; the shader turns it into the ray's path through the hot layer.
   */
  setHazeEyeHeight(metres: number): void {
    this.hazeEyeHeight = metres;
  }

  /**
   * Heat-haze strength, clamped to 0..1, and always zero on the cheapest tier.
   *
   * The procedural grains are the expensive half of this pass. Acceptable pays
   * the copy and outlines, which define the drawn look, and skips the shimmer:
   * at zero strength the shader branches past the warp on a uniform every fragment
   * agrees on.
   */
  setHazeStrength(strength: number): void {
    const daylight = Math.min(1, Math.max(0, strength));
    this.hazeMaterial.uniforms.uDaylight.value = daylight;
    const wanted = this.quality === 'acceptable' ? 0 : daylight;
    const active = Math.min(1, Math.max(0, wanted));
    this.hazeMaterial.uniforms.uStrength.value = active;
    // A disabled warp never samples depth, so do not resolve the multisampled depth
    // buffer at night or on Acceptable.
    this.hazeTarget.resolveDepthBuffer = active > 0;
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

  /** Whether this context can time the GPU. Without it the scale never moves. */
  get measuresGpuTime(): boolean {
    return this.timerQueryExt !== null;
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
    this.renderer.shadowMap.enabled = quality !== 'acceptable';
    this.basePixelRatio = this.pixelRatioFor(quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
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
