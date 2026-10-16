import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import {
  CLOUD_BASE_M,
  CLOUD_COVER_EDGE,
  CLOUD_FIELD_GLSL,
  CLOUD_PERIOD_M,
  CLOUD_TOP_M,
  cloudFieldUniforms,
} from './cloudshadow';

/**
 * VOLUMETRIC CUMULUS: the sky's clouds as a raymarched slab, not a painted deck.
 *
 * Two earlier attempts drew the cumulus as a thresholded 2D field on the dome, shaded
 * by one sample toward the sun. They read as flat blobs, because nothing about them was
 * a cloud: no thickness for the light to die in, no flat base, no tops for the sun to
 * catch. This is the Nubis recipe (Schneider, Horizon Zero Dawn, 2015-17), cut down to
 * what a fair-weather desert sky needs.
 *
 * WHERE THE CLOUD IS. Between `CLOUD_BASE_M` and `CLOUD_TOP_M` above the eye. Its
 * footprint is the cloud-shadow field (render/cloudshadow.ts), the one the ground's
 * shade is drawn from, at the same pan, so every shadow on the sand has its cloud up the
 * sun's ray. That field is costly to evaluate (six lattice noises), so it is baked into
 * a `WEATHER_SIZE` map around the eye (`weatherTarget`) and rebaked only when the eye
 * and the wind have carried it `WEATHER_REBAKE_M`; the march reads the map.
 *
 * WHAT SHAPE. The footprint is the field above `CLOUD_COVER_EDGE`; the HEIGHT is the
 * field blurred over `HEIGHT_BLUR_M` (a second channel of the same map), so one cloud is
 * one smooth hill: low and flat when its footprint is small, tall only over a big core,
 * never a cone. The side draws in as it climbs, so the shoulders round into the top,
 * and the base is flat. A tiling 3D noise (`NOISE_SIZE` cubed, baked on the CPU at
 * startup: Perlin-Worley plus three Worley octaves) cuts the dome's surface into billows
 * at `SHAPE_TILE_M`, with a finer erosion at `DETAIL_TILE_M`: cauliflower over the
 * surface, a soft fray in the lowest 90 m, nothing ever below the base. Both tiles divide
 * the field's period, so the clouds stay continuous when the pan is reduced modulo it.
 *
 * HOW IT IS LIT. Beer-Lambert extinction along the view ray; at each sample a march of
 * six widening steps toward the sun (twice as long under a low sun) gives the light's
 * own extinction, three scattering octaves (Wrenninge's multiple-scattering
 * approximation) keep the interiors from going black, a dual-lobe Henyey-Greenstein
 * phase puts the silver lining round a cloud against the sun, and a light "powder" term
 * darkens the thinnest wisps seen with the sun behind. Ambient is the sky's own colours
 * by height in the cloud: ground bounce under the flat base, sky on the tops. At sunset
 * it comes from the zenith only, greyed toward slate, and the sun reaching a cloud's
 * lower half is dimmed, so a sunset cloud is a lit crown over a blue-grey body. Far
 * clouds sink into the air in front of them (the dusk sky, not the glow at the horizon),
 * and the whole layer fades out above the horizon band, which must stay pure gradient
 * because the fog colour is copied from it.
 *
 * WHAT IT COSTS. At most `TARGET_LINES` lines (a third of a 1080-line frame, a quarter
 * of 1440), up to `MAX_STEPS` steps with empty space skipped at double stride. The view
 * ray and the light march are jittered per pixel and frame on two separate sequences,
 * accumulated over frames with the history reprojected by view direction (the clouds
 * are kilometres off, so the eye's own travel within a frame is negligible). Measured
 * on an M2 Pro, 1.15-1.55 ms at 640x360. The dome (render/sky.ts) composites it where
 * the sky is visible; geometry draws over the dome, so the clouds are behind everything
 * by construction.
 *
 * TIERS. Only `standard` and `blessing` on a desktop presentation draw it. The rest
 * keep the dome's 2D deck, which is also what the environment probe bakes from, and
 * what a mirror sees in directions the main view does not cover.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Side of the tiling 3D noise, voxels. 64^3 RGBA8 is 1 MB. */
const NOISE_SIZE = 64;
/** Tile of the body noise, metres: 80 tiles to the field's period (billows 170-40 m). */
const SHAPE_TILE_M = CLOUD_PERIOD_M / 80;
/** Tile of the erosion noise, metres: 192 to the period (cells 70-17 m). */
const DETAIL_TILE_M = CLOUD_PERIOD_M / 192;
/** Half the side of the baked coverage map, metres. */
const WEATHER_HALF_M = 24_000;
const WEATHER_SIZE = 1024;
/**
 * Gaussian radius of the blurred field a cloud's height is read from, metres. The raw
 * field climbs about 0.1 a hundred metres at a cloud's edge, so a height read from it
 * rose a kilometre across three hundred metres: every cloud a cone. Blurred over 300 m
 * the height of one cloud is a smooth hill on its footprint, low where the footprint is
 * small, tall only over a big core, and its bilinear creases (47 m texels) are too
 * shallow to show in the lighting.
 */
const HEIGHT_BLUR_M = 300;
const BLUR_SIGMA_TEXELS = HEIGHT_BLUR_M / ((WEATHER_HALF_M * 2) / WEATHER_SIZE);
/** Taps each side of the centre, 1.5 texels apart (bilinear between), out to 3 sigma. */
const BLUR_TAP_TEXELS = 1.5;
const BLUR_TAPS = Math.ceil((3 * BLUR_SIGMA_TEXELS) / BLUR_TAP_TEXELS);
/**
 * Where the blurred field puts a column's height (`column`): 0.1 of the slab at
 * `HEIGHT_LOW`, the whole of it `HEIGHT_SPAN` above. Measured over the footprints of
 * four seeds, the blurred field runs 0.47 (5th percentile) to 0.74 (95th), 0.59 at the
 * median: a typical cloud 400 m thick, the small ones 120 m, the big cores 800 m.
 */
const HEIGHT_LOW = 0.45;
const HEIGHT_SPAN = 0.35;
/** How far the map's centre may fall behind the eye before it is baked again. */
const WEATHER_REBAKE_M = 3_000;
/**
 * Lines of the cloud picture: a third of the scene's, at most `TARGET_LINES`. The march
 * is the cost and it scales with these pixels, not with the frame's; past 360 lines the
 * soft edges of a cumulus gain nothing a player sees.
 */
const TARGET_DIVISOR = 3;
const TARGET_LINES = 360;
/** Share of the accumulated history kept each frame. */
const HISTORY_WEIGHT = 0.93;
const MAX_STEPS = 64;
/** Extinction of the densest cloud, per metre. */
const SIGMA_MAX = 0.045;

// ---------------------------------------------------------------------------
// The 3D noise, baked once on the CPU
// ---------------------------------------------------------------------------

/** Inverted F1 Worley on a lattice of `cells` per side, tiling over the cube. */
function worleyField(n: number, cells: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const points = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < points.length; i++) points[i] = rand();
  const out = new Float32Array(n * n * n);
  const scale = cells / n;
  let index = 0;
  for (let z = 0; z < n; z++) {
    const pz = (z + 0.5) * scale;
    const cz = Math.floor(pz);
    for (let y = 0; y < n; y++) {
      const py = (y + 0.5) * scale;
      const cy = Math.floor(py);
      for (let x = 0; x < n; x++) {
        const px = (x + 0.5) * scale;
        const cx = Math.floor(px);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) {
          const kz = cz + dz;
          const wz = (kz + cells) % cells;
          for (let dy = -1; dy <= 1; dy++) {
            const ky = cy + dy;
            const wy = (ky + cells) % cells;
            for (let dx = -1; dx <= 1; dx++) {
              const kx = cx + dx;
              const wx = (kx + cells) % cells;
              const p = ((wz * cells + wy) * cells + wx) * 3;
              const ex = kx + points[p]! - px;
              const ey = ky + points[p + 1]! - py;
              const ez = kz + points[p + 2]! - pz;
              const d = ex * ex + ey * ey + ez * ez;
              if (d < best) best = d;
            }
          }
        }
        out[index++] = 1 - Math.min(1, Math.sqrt(best));
      }
    }
  }
  return out;
}

/** Tiling 3D gradient noise, -1..1, on a lattice of `cells` per side. */
function perlinField(n: number, cells: number, seed: number, out: Float32Array, weight: number): void {
  const rand = mulberry32(seed);
  const grads = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < cells * cells * cells; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    grads[i * 3] = r * Math.cos(a);
    grads[i * 3 + 1] = r * Math.sin(a);
    grads[i * 3 + 2] = u;
  }
  const scale = cells / n;
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  let index = 0;
  for (let z = 0; z < n; z++) {
    const pz = (z + 0.5) * scale;
    const iz = Math.floor(pz);
    const fz = pz - iz;
    for (let y = 0; y < n; y++) {
      const py = (y + 0.5) * scale;
      const iy = Math.floor(py);
      const fy = py - iy;
      for (let x = 0; x < n; x++) {
        const px = (x + 0.5) * scale;
        const ix = Math.floor(px);
        const fx = px - ix;
        let sum = 0;
        for (let c = 0; c < 8; c++) {
          const ox = c & 1;
          const oy = (c >> 1) & 1;
          const oz = c >> 2;
          const g = ((((iz + oz) % cells) * cells + ((iy + oy) % cells)) * cells + ((ix + ox) % cells)) * 3;
          const dot = grads[g]! * (fx - ox) + grads[g + 1]! * (fy - oy) + grads[g + 2]! * (fz - oz);
          const w = (ox ? fade(fx) : 1 - fade(fx)) * (oy ? fade(fy) : 1 - fade(fy)) * (oz ? fade(fz) : 1 - fade(fz));
          sum += dot * w;
        }
        out[index++] += sum * weight;
      }
    }
  }
}

/** Spreads a channel over 0..1 so the eight bits hold its whole range. */
function normalise(values: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < values.length; i++) values[i] = (values[i]! - lo) * k;
}

/**
 * R: Perlin-Worley, the billowing body (Perlin dilated by low Worley, so its blobs are
 * round and joined). G, B, A: inverted Worley FBM at three rising frequencies, which the
 * shader both subtracts from the body and erodes the edges with.
 */
function bakeCloudNoise(): THREE.Data3DTexture {
  const n = NOISE_SIZE;
  const w4 = worleyField(n, 4, 0x434c5631);
  const w8 = worleyField(n, 8, 0x434c5632);
  const w16 = worleyField(n, 16, 0x434c5633);
  const w32 = worleyField(n, 32, 0x434c5634);
  const perlin = new Float32Array(n * n * n);
  perlinField(n, 4, 0x434c5635, perlin, 0.57);
  perlinField(n, 8, 0x434c5636, perlin, 0.29);
  perlinField(n, 16, 0x434c5637, perlin, 0.14);
  const count = n * n * n;
  const r = new Float32Array(count);
  const g = new Float32Array(count);
  const b = new Float32Array(count);
  const a = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const low = w4[i]! * 0.625 + w8[i]! * 0.25 + w16[i]! * 0.125;
    const p = Math.min(1, Math.max(0, perlin[i]! * 0.5 + 0.5));
    // remap(perlin, 0, 1, worley, 1): Perlin pushed up where the Worley cells are.
    r[i] = low + p * (1 - low);
    g[i] = low;
    b[i] = w8[i]! * 0.625 + w16[i]! * 0.25 + w32[i]! * 0.125;
    a[i] = w16[i]! * 0.75 + w32[i]! * 0.25;
  }
  normalise(r);
  normalise(g);
  normalise(b);
  normalise(a);
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = Math.round(r[i]! * 255);
    data[i * 4 + 1] = Math.round(g[i]! * 255);
    data[i * 4 + 2] = Math.round(b[i]! * 255);
    data[i * 4 + 3] = Math.round(a[i]! * 255);
  }
  const texture = new THREE.Data3DTexture(data, n, n, n);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** The coverage map, first pass: the shadow field's raw value round the map's centre. */
const WEATHER_FRAGMENT = /* glsl */ `
${CLOUD_FIELD_GLSL}
uniform vec2 uMapCentre;
varying vec2 vUv;
void main() {
  vec2 at = uMapCentre + (vUv - 0.5) * ${(WEATHER_HALF_M * 2).toFixed(1)};
  float field = clamp(cloudField(at, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(field, field, 0.0, 1.0);
}
`;

/**
 * The coverage map's two blur passes: R is carried through untouched, G is blurred along
 * `uBlurStep` (one texel across, then one down) with a Gaussian of `HEIGHT_BLUR_M`. The
 * blurred field is what a cloud's HEIGHT is read from (see `density`).
 */
const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uBlurStep;
varying vec2 vUv;
void main() {
  vec4 centre = texture2D(uSource, vUv);
  float sum = centre.g;
  float weight = 1.0;
  for (int i = 1; i <= ${BLUR_TAPS}; i++) {
    float x = float(i) * ${BLUR_TAP_TEXELS.toFixed(2)};
    float w = exp(-0.5 * x * x / ${(BLUR_SIGMA_TEXELS * BLUR_SIGMA_TEXELS).toFixed(3)});
    sum += w * (texture2D(uSource, vUv + uBlurStep * x).g + texture2D(uSource, vUv - uBlurStep * x).g);
    weight += 2.0 * w;
  }
  gl_FragColor = vec4(centre.r, sum / weight, 0.0, 1.0);
}
`;

const MARCH_FRAGMENT = /* glsl */ `
precision highp sampler3D;
uniform sampler2D uWeather;
uniform sampler3D uNoise;
uniform sampler2D uHistory;
uniform vec2 uMapCentre;
uniform vec2 uCloudPan;
uniform vec3 uEye;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform mat4 uPrevViewProj;
uniform float uHistoryWeight;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform float uStorm;
uniform float uCloudAmount;
uniform float uFrame;
uniform float uPixelAngle;
varying vec2 vUv;

#define BASE ${CLOUD_BASE_M.toFixed(1)}
#define TOP ${CLOUD_TOP_M.toFixed(1)}
#define THICK ${(CLOUD_TOP_M - CLOUD_BASE_M).toFixed(1)}
#define SIGMA ${SIGMA_MAX.toFixed(4)}

vec3 toLinear(vec3 c) { return sRGBTransferEOTF(vec4(max(c, 0.0), 1.0)).rgb; }

float remap(float v, float lo, float hi, float a, float b) {
  return a + (v - lo) / (hi - lo) * (b - a);
}

/**
 * The column at a field point: x how far inside its footprint the point stands, 0 at
 * the edge to 1 about 250 m in; y how high it builds above the base, metres. The height
 * comes from the BLURRED field (HEIGHT_BLUR_M), so across one cloud it is a smooth hill:
 * a small cloud a flat humilis a hundred metres thick, a big core a kilometre. A storm
 * lowers both edges until the deck closes and stands every column to the top.
 */
vec2 column(vec2 at) {
  vec2 q = (at - uMapCentre) / ${(WEATHER_HALF_M * 2).toFixed(1)};
  vec2 field = texture2D(uWeather, q + 0.5).rg;
  float edge = 1.0 - smoothstep(0.4, 0.5, max(abs(q.x), abs(q.y)));
  float threshold = ${CLOUD_COVER_EDGE.toFixed(3)} - 0.55 * uStorm;
  float inside = clamp((field.r - threshold) / 0.25, 0.0, 1.0) * edge;
  float u = clamp((field.g - ${HEIGHT_LOW.toFixed(3)} + 0.55 * uStorm) / ${HEIGHT_SPAN.toFixed(3)}, 0.0, 1.0);
  float top = THICK * mix(0.1 + 0.9 * pow(u, 1.2), 1.0, uStorm);
  return vec2(inside, top);
}

/**
 * Density at p = (field x, height above the eye, field z) in a column.
 *
 * The ENVELOPE is the column's own dome. Its side draws in as it climbs (a point must
 * stand further inside the footprint the higher it is, as the square of its height in
 * the column), so the shoulders round over into the top; and it fades out over the last
 * 400 m under the top. Deep inside it every voxel is cloud; toward its surface only the
 * crowns of the body noise's billows survive, so the surface is a heap of rounded lumps
 * that may stand up to 150 m proud of it. Nothing hangs below the base: under it the
 * density is zero, and the lowest 90 m are only frayed by the wispy erosion, never
 * extended. The billowed erosion works on the surface alone (1 - envelope), so a dome's
 * outline is cauliflower and its inside stays solid.
 */
float density(vec3 p, vec2 col, float lod, bool detail) {
  float hm = p.y - BASE;
  float top = col.y;
  if (col.x <= 0.0 || hm <= 0.0 || hm >= top + 150.0) return 0.0;
  float hn = clamp(hm / top, 0.0, 1.0);
  float rise = 0.7 * hn * hn;
  float env = smoothstep(rise, rise + 0.5, col.x) * smoothstep(top + 150.0, top - 250.0, hm);
  // The noise is read on an oblique lattice. Trilinear filtering creases at every voxel
  // plane, and with horizontal planes the steep remaps below turned those creases into
  // fine level lines across every cloud. Whole-number coefficients on x and z keep the
  // noise periodic on the field's period; the y coefficients only tilt the planes.
  vec3 q = vec3(p.x + 0.5 * p.y, p.x + p.y + p.z, p.z - 0.5 * p.y);
  vec4 n = textureLod(uNoise, q / ${SHAPE_TILE_M.toFixed(1)}, lod);
  float lowFbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float body = clamp(remap(n.r, lowFbm - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  float d = clamp((body - 1.0 + 1.3 * env) / 0.2, 0.0, 1.0) * smoothstep(0.0, 40.0, hm);
  if (detail && d > 0.0 && d < 0.9) {
    vec4 e = textureLod(uNoise, q / ${DETAIL_TILE_M.toFixed(1)} + vec3(0.0, 0.0, 0.37), lod + 0.5);
    float high = e.g * 0.625 + e.b * 0.25 + e.a * 0.125;
    // Wisps in the lowest 90 m, billows above.
    float lift = smoothstep(0.0, 90.0, hm);
    float erode = mix(high, 1.0 - high, lift) * (0.6 * (1.0 - env) + 0.3 * (1.0 - lift));
    d = clamp(remap(d, erode, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return d * mix(1.0, 1.6, uStorm);
}

/** Henyey-Greenstein, normalised so an isotropic medium scatters 1. */
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

float phase(float c, float k) {
  return mix(hg(c, -0.25 * k), hg(c, 0.72 * k), 0.45);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(uCamRot * (view.xyz / view.w));

  vec3 scattered = vec3(0.0);
  float transmit = 1.0;
  float fade = smoothstep(0.01, 0.085, dir.y) * uCloudAmount;
  if (fade > 0.0) {
    float t0 = BASE / dir.y;
    float horizontal = length(dir.xz);
    float t1 = min(TOP / dir.y, ${(WEATHER_HALF_M * 0.98).toFixed(1)} / max(horizontal, 1e-4));
    if (t1 > t0) {
      float span = t1 - t0;
      float dt = clamp(span / 48.0, 22.0, 260.0);
      // A per-pixel hash, stepped by the golden ratio in time: every pixel walks evenly
      // through all of its step phases, and what the history has not yet averaged away
      // is white noise rather than a pattern. (Interleaved gradient noise left each row's
      // phases correlated, and the history kept them as contour stripes.)
      vec3 h3 = fract(vec3(gl_FragCoord.xyx) * 0.1031);
      h3 += dot(h3, h3.yzx + 33.33);
      float hashed = fract((h3.x + h3.y) * h3.z);
      float ign = fract(hashed + uFrame * 0.61803399);
      // The light march's own jitter, on a second sequence (the plastic number's), so its
      // samples do not move in step with the view ray's: shared, the two together left a
      // hatched residue the history could not average away.
      float lightJitter = fract(hashed * 7.31 + uFrame * 0.75487767);
      float t = t0 + dt * ign;
      vec2 origin = uEye.xz + uCloudPan;

      vec3 sun = toLinear(uSunColor) * 1.1;
      vec3 zenith = toLinear(uZenith);
      vec3 horizonLin = toLinear(uHorizon);
      // 1 with the sun on the horizon, 0 from 20 degrees up.
      float lowSun = 1.0 - smoothstep(0.05, 0.35, uSunDir.y);
      // Sky light on the tops comes mostly from overhead, and at sunset only from
      // overhead: the bright horizon band is then the glow itself, and a cloud lit by it
      // glowed orange right through instead of standing dark against it. The shaded
      // underside sees the sand's warm bounce of a high sun, and at sunset the dim blue
      // of the sky over the other horizon, which is what makes a sunset cloud's base
      // blue-grey under its lit rim.
      vec3 skyAmbient = mix(zenith, horizonLin, 0.3 * (1.0 - lowSun)) * 0.5;
      vec3 groundAmbient = zenith * 0.22 + toLinear(vec3(0.85, 0.64, 0.38)) * max(uSunDir.y, 0.0) * 0.16;
      // A dusk zenith is a deep violet, and a cloud's shade lit by it alone came out as
      // saturated as the sky: real shade under a sunset is a slate grey with a cast.
      float greyShade = 0.45 * lowSun;
      skyAmbient = mix(skyAmbient, vec3(dot(skyAmbient, vec3(0.2126, 0.7152, 0.0722))), greyShade);
      groundAmbient = mix(groundAmbient, vec3(dot(groundAmbient, vec3(0.2126, 0.7152, 0.0722))), greyShade);
      float c = dot(dir, uSunDir);
      float ph1 = phase(c, 1.0);
      float ph2 = phase(c, 0.5);
      float ph3 = phase(c, 0.25);
      vec3 sunStep = normalize(uSunDir + vec3(0.0, 0.002, 0.0));
      // The light's march reaches 1.9 km, and twice that under a low sun, whose light
      // crosses whole clouds and their neighbours before it reaches a cloud's far side.
      float lightReach = mix(1.0, 2.0, lowSun);
      float depthSum = 0.0;
      float weightSum = 0.0;
      // Steps at fine stride left before empty space may be crossed at double stride again.
      int fine = 0;

      for (int i = 0; i < ${MAX_STEPS}; i++) {
        if (t > t1 || transmit < 0.015) break;
        vec2 at = origin + dir.xz * t;
        vec2 col = column(at);
        if (col.x <= 0.0) {
          t += fine > 0 ? dt : dt * 2.0;
          fine--;
          continue;
        }
        // Arrived at a footprint at double stride: step back and come in at the fine one.
        // Without this the entry point jumped a whole step wherever the count of skipped
        // steps changed parity, and the history kept those jumps as contour stripes.
        if (fine <= 0) {
          fine = 4;
          t -= dt;
          continue;
        }
        fine = 4;
        vec3 p = vec3(at.x, dir.y * t, at.y);
        float lod = log2(max(1.0, t * uPixelAngle * ${(NOISE_SIZE / SHAPE_TILE_M).toFixed(5)}));
        float d = density(p, col, lod, true);
        if (d > 0.0) {
          float sigma = d * SIGMA;
          // The light's own path toward the sun, in widening steps, every one scaled by
          // the pixel's jitter so the samples do not land at fixed distances.
          float od = 0.0;
          float along = 0.0;
          float seg = (36.0 + 18.0 * lightJitter) * lightReach;
          for (int j = 0; j < 6; j++) {
            along += seg * 0.5;
            vec3 q = p + sunStep * along;
            od += density(q, column(q.xz), lod + 1.0, false) * SIGMA * seg;
            along += seg * 0.5;
            seg *= 1.8;
          }
          // Height within this column: the top sees the sky, the base the ground.
          float hc = clamp((p.y - BASE) / max(col.y, 60.0), 0.0, 1.0);
          // A low sun's light reaches a cloud's lower half through more air and past the
          // clouds round it: under the lit crown, the body goes dim and red.
          float sunAt = mix(1.0, 0.3 + 0.7 * smoothstep(0.1, 0.9, hc), lowSun);
          // Three scattering octaves: each keeps more light and forgets more direction.
          float light = exp(-od) * ph1 + 0.3 * exp(-od * 0.25) * ph2 + 0.1 * exp(-od * 0.07) * ph3;
          // Powder: thin cloud has not yet built up its in-scatter, so seen with the sun
          // behind the eye its crevices and wisps go darker than the bulk.
          float powder = 1.0 - exp(-d * 20.0);
          light *= mix(1.0, powder, 0.35 * (0.5 - 0.5 * c));
          vec3 ambient = mix(groundAmbient, skyAmbient, smoothstep(0.0, 0.8, hc)) * (0.55 + 0.45 * exp(-d * 1.5));
          vec3 radiance = sun * (light * sunAt) + ambient;
          float stepT = exp(-sigma * dt);
          float absorbed = transmit * (1.0 - stepT);
          scattered += radiance * absorbed;
          depthSum += t * absorbed;
          weightSum += absorbed;
          transmit *= stepT;
        }
        t += dt;
      }
      // Far cloud sinks into the air in front of it. At sunset that air is not the glow
      // on the horizon (the sun's own light, which a cloud in front of it blocks) but the
      // dusk sky: far clouds toward the sun stand dark against the glow.
      float dist = weightSum > 0.0 ? depthSum / weightSum : t1;
      float air = 1.0 - exp(-dist / 22000.0);
      vec3 airCol = mix(horizonLin, zenith, 0.6 * lowSun);
      scattered = mix(scattered, airCol * (1.0 - transmit), air);
    }
    scattered *= fade;
    transmit = 1.0 - (1.0 - transmit) * fade;
  }
  vec4 result = vec4(scattered, transmit);

  if (uHistoryWeight > 0.0) {
    vec4 clip = uPrevViewProj * vec4(dir, 0.0);
    if (clip.w > 0.0) {
      vec2 prev = clip.xy / clip.w * 0.5 + 0.5;
      if (prev.x >= 0.0 && prev.y >= 0.0 && prev.x <= 1.0 && prev.y <= 1.0) {
        result = mix(result, texture2D(uHistory, prev), uHistoryWeight);
      }
    }
  }
  gl_FragColor = result;
}
`;

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** The sky's live uniform objects the march reads (render/sky.ts owns them). */
export interface CloudSkyUniforms {
  readonly uSunDir: { value: THREE.Vector3 };
  readonly uZenith: { value: THREE.Color };
  readonly uHorizon: { value: THREE.Color };
  readonly uSunColor: { value: THREE.Color };
  readonly uStorm: { value: number };
  readonly uCloudAmount: { value: number };
}

function fullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return geometry;
}

function passTarget(width: number, height: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
}

/**
 * Owns the noise, the coverage map, the two history targets and the march. Drawn by the
 * renderer before the scene pass (`Renderer.setSkyPass`); the dome reads `domeUniforms`.
 */
export class CloudVolume {
  /** Bound into the dome's uniforms: whether to read the volume, its picture, its view. */
  readonly domeUniforms = {
    uCloudVolume: { value: 0 },
    uCloudTex: { value: null as THREE.Texture | null },
    uCloudViewProj: { value: new THREE.Matrix4() },
  };
  /** The tier's switch (`Sky.setQuality`). */
  enabled = false;

  private readonly webgl: THREE.WebGLRenderer;
  private readonly noise: THREE.Data3DTexture;
  /** The coverage map the march reads: R the raw field, G the blurred one. */
  private readonly weatherTarget: THREE.WebGLRenderTarget;
  /** Between the two blur passes. */
  private readonly weatherBlurTarget: THREE.WebGLRenderTarget;
  private readonly history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private historyValid = false;
  private readonly geometry = fullscreenTriangle();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly weatherScene = new THREE.Scene();
  private readonly blurScene = new THREE.Scene();
  private readonly marchScene = new THREE.Scene();
  private readonly weatherMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly marchMaterial: THREE.ShaderMaterial;
  /** Map centre in field coordinates, and the salt it was baked with; NaN until baked. */
  private readonly mapCentre = new THREE.Vector2(Number.NaN, Number.NaN);
  private mapSalt = Number.NaN;
  private frame = 0;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly _viewRot = new THREE.Matrix4();
  private readonly _eye = new THREE.Vector3();
  /** The sky's cumulus visibility: zero skips the whole pass. */
  private readonly amount: { value: number };

  constructor(webgl: THREE.WebGLRenderer, sky: CloudSkyUniforms) {
    this.webgl = webgl;
    this.noise = bakeCloudNoise();
    const half =
      webgl.extensions.has('EXT_color_buffer_float') || webgl.extensions.has('EXT_color_buffer_half_float');
    const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
    // Half float where it renders: eight bits terraced the coverage, and the tops with it.
    this.weatherTarget = passTarget(WEATHER_SIZE, WEATHER_SIZE, type);
    this.weatherBlurTarget = passTarget(WEATHER_SIZE, WEATHER_SIZE, type);
    this.history = [passTarget(1, 1, type), passTarget(1, 1, type)];

    this.weatherMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: WEATHER_FRAGMENT,
      uniforms: {
        uCloudPan: cloudFieldUniforms.uCloudPan,
        uCloudSalt: cloudFieldUniforms.uCloudSalt,
        uMapCentre: { value: this.mapCentre },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      uniforms: {
        uSource: { value: this.weatherTarget.texture },
        uBlurStep: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.marchMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: MARCH_FRAGMENT,
      uniforms: {
        uWeather: { value: this.weatherTarget.texture },
        uNoise: { value: this.noise },
        uHistory: { value: this.history[1].texture },
        uMapCentre: { value: this.mapCentre },
        uCloudPan: cloudFieldUniforms.uCloudPan,
        uEye: { value: this._eye },
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uPrevViewProj: { value: this.prevViewProj },
        uHistoryWeight: { value: 0 },
        uSunDir: sky.uSunDir,
        uZenith: sky.uZenith,
        uHorizon: sky.uHorizon,
        uSunColor: sky.uSunColor,
        uStorm: sky.uStorm,
        uCloudAmount: sky.uCloudAmount,
        uFrame: { value: 0 },
        uPixelAngle: { value: 0.001 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.amount = sky.uCloudAmount;
    for (const [scene, material] of [
      [this.weatherScene, this.weatherMaterial],
      [this.blurScene, this.blurMaterial],
      [this.marchScene, this.marchMaterial],
    ] as const) {
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  /** Links the three programs, behind the loading cover (`Renderer.waitForFrameShaders`). */
  compile(): Promise<unknown> {
    const previous = this.webgl.getRenderTarget();
    try {
      this.webgl.setRenderTarget(this.history[0]);
      return Promise.all([
        this.webgl.compileAsync(this.weatherScene, this.camera),
        this.webgl.compileAsync(this.blurScene, this.camera),
        this.webgl.compileAsync(this.marchScene, this.camera),
      ]);
    } finally {
      this.webgl.setRenderTarget(previous);
    }
  }

  /**
   * One frame of cloud, for `camera` over a scene target of `width` x `height`. Leaves
   * the dome reading the 2D deck instead whenever the volume is off or invisible.
   */
  draw(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const dome = this.domeUniforms;
    if (!this.enabled || this.amount.value <= 0) {
      dome.uCloudVolume.value = 0;
      this.historyValid = false;
      return;
    }
    const h = Math.max(1, Math.min(TARGET_LINES, Math.ceil(height / TARGET_DIVISOR)));
    const w = Math.max(1, Math.round((width * h) / height));
    if (this.history[0].width !== w || this.history[0].height !== h) {
      this.history[0].setSize(w, h);
      this.history[1].setSize(w, h);
      this.historyValid = false;
    }

    const previousTarget = this.webgl.getRenderTarget();
    camera.updateMatrixWorld();
    this._eye.setFromMatrixPosition(camera.matrixWorld);
    const pan = cloudFieldUniforms.uCloudPan.value;
    const salt = cloudFieldUniforms.uCloudSalt.value;
    const atX = this._eye.x + pan.x;
    const atZ = this._eye.z + pan.y;
    if (
      salt !== this.mapSalt ||
      !(Math.abs(atX - this.mapCentre.x) < WEATHER_REBAKE_M && Math.abs(atZ - this.mapCentre.y) < WEATHER_REBAKE_M)
    ) {
      this.mapCentre.set(atX, atZ);
      this.mapSalt = salt;
      this.webgl.setRenderTarget(this.weatherTarget);
      this.webgl.render(this.weatherScene, this.camera);
      // The height channel's blur: across into the spare target, then down back again.
      const blur = this.blurMaterial.uniforms;
      blur.uSource!.value = this.weatherTarget.texture;
      (blur.uBlurStep!.value as THREE.Vector2).set(1 / WEATHER_SIZE, 0);
      this.webgl.setRenderTarget(this.weatherBlurTarget);
      this.webgl.render(this.blurScene, this.camera);
      blur.uSource!.value = this.weatherBlurTarget.texture;
      (blur.uBlurStep!.value as THREE.Vector2).set(0, 1 / WEATHER_SIZE);
      this.webgl.setRenderTarget(this.weatherTarget);
      this.webgl.render(this.blurScene, this.camera);
    }

    const u = this.marchMaterial.uniforms;
    (u.uInvProj!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamRot!.value as THREE.Matrix3).setFromMatrix4(camera.matrixWorld);
    this._viewRot.extractRotation(camera.matrixWorld).transpose();
    const viewProj = dome.uCloudViewProj.value.multiplyMatrices(camera.projectionMatrix, this._viewRot);
    u.uHistoryWeight!.value = this.historyValid ? HISTORY_WEIGHT : 0;
    u.uFrame!.value = this.frame;
    this.frame = (this.frame + 1) % 64;
    u.uPixelAngle!.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (camera.zoom * h);
    const read = this.history[this.current];
    this.current ^= 1;
    const write = this.history[this.current];
    u.uHistory!.value = read.texture;
    this.webgl.setRenderTarget(write);
    this.webgl.render(this.marchScene, this.camera);
    this.webgl.setRenderTarget(previousTarget);

    this.prevViewProj.copy(viewProj);
    this.historyValid = true;
    dome.uCloudTex.value = write.texture;
    dome.uCloudVolume.value = 1;
  }

  dispose(): void {
    this.noise.dispose();
    this.weatherTarget.dispose();
    this.weatherBlurTarget.dispose();
    this.history[0].dispose();
    this.history[1].dispose();
    this.geometry.dispose();
    this.weatherMaterial.dispose();
    this.blurMaterial.dispose();
    this.marchMaterial.dispose();
  }
}
