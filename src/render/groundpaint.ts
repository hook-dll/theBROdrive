import * as THREE from 'three';

import { injectSeason } from './season';
import { maxAnisotropy } from './texturequality';

/**
 * THE GROUND'S PAINT: what the land looks like close up, drawn in code.
 *
 * The land cover gives every vertex a colour; on its own that is felt, a flat colour
 * with nothing for the eye to hold. slowroads gets its ground from small tiling
 * textures layered by weights stored in the vertices. This is the same foundation in
 * our own language: no photographs, but brush strokes painted into a texture at boot,
 * grey, so the palette (and with it the season) stays the land cover's.
 *
 * One RGBA texture, one pattern per channel:
 *   R  meadow        short strokes every which way: a sward seen from a car
 *   G  crop          dense strokes along one axis with faint rows
 *   B  forest floor  soft litter blotches and dark specks
 *   A  bare earth    broad soft clods and light grit: ploughland, mud
 * A vertex's `aGround` holds the weights of the four (zeros read as meadow, so a mesh
 * without the attribute is simply grass). The pattern is sampled at two scales and two
 * angles so its repeat never lines up, and a second, smooth texture mottles the colour
 * over tens of metres. Mipmaps take the strokes to their mean, which is neutral, so the
 * far ground is exactly the land cover's colour and nothing shimmers there.
 */

const PAINT_SIZE = 512;
const VARY_SIZE = 256;
/**
 * Metres one repeat of the paint covers, at the two scales it is sampled at, and of the
 * mottling. The paint is sampled at origin-relative positions, so every period divides
 * the origin's rebase step (world/origin.ts, 1000 m) — the far scale's too after its
 * 0.8/0.6 turn — or the whole ground would jump under the car at each rebase.
 */
const SCALE_NEAR_M = 4;
/**
 * How much a closed wood darkens its own floor: the forest's shade, baked. Sun shadows
 * are drawn only near the camera (render/lightshader.ts); this is the shade of a wood
 * at every distance, as slowroads bakes its tree shadow into the terrain. Grass under
 * the trees takes the same (world/grass.ts).
 */
export const FOREST_SHADE = 0.34;
const SCALE_FAR_M = 12.5;
const VARY_M = 125;

/** Small deterministic PRNG: the paint must be the same on every boot. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lays one elongated brush dab over a wrapping float canvas, as paint does: `value`
 * covers what was there, fully inside the stroke and fading only over its last
 * `1 / hardness` of radius. `len` runs along `angle`, `wid` across it.
 */
function dab(canvas: Float32Array, size: number, cx: number, cy: number, angle: number, len: number, wid: number, value: number, hardness = 3): void {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const reach = Math.ceil(Math.max(len, wid)) + 1;
  const px = Math.round(cx);
  const py = Math.round(cy);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const u = (dx * ca + dy * sa) / len;
      const v = (-dx * sa + dy * ca) / wid;
      const d = Math.sqrt(u * u + v * v);
      if (d >= 1) continue;
      const a = Math.min(1, (1 - d) * hardness);
      const x = (((px + dx) % size) + size) % size;
      const y = (((py + dy) % size) + size) % size;
      const i = y * size + x;
      canvas[i] = canvas[i]! + (value - canvas[i]!) * a;
    }
  }
}

/**
 * A blade: a tapering stroke from its root outward, darker at the root and lighter at
 * the tip, drawn as a row of shrinking dabs.
 */
function blade(canvas: Float32Array, size: number, x: number, y: number, angle: number, length: number, width: number, root: number, tip: number): void {
  const steps = Math.max(3, Math.round(length / (width * 0.8)));
  for (let k = 0; k < steps; k++) {
    const t = k / (steps - 1);
    const w = width * (1 - 0.65 * t);
    dab(canvas, size, x + Math.cos(angle) * length * t, y + Math.sin(angle) * length * t, angle, w * 1.3, w, root + (tip - root) * t, 4);
  }
}

/**
 * Pulls a canvas to a few soft value steps: the posterised look of the comic light,
 * and what keeps the strokes reading as painted rather than photographed.
 */
function posterise(canvas: Float32Array, levels: number, softness: number): void {
  for (let i = 0; i < canvas.length; i++) {
    const v = canvas[i]! * levels;
    const f = v - Math.floor(v);
    const step = Math.floor(v) + Math.min(1, Math.max(0, (f - 0.5) / softness + 0.5));
    canvas[i] = step / levels;
  }
}

/** Rescales a canvas to 0..1 around its own mean, which lands on 0.5. */
function normalise(canvas: Float32Array, contrast: number): void {
  let mean = 0;
  for (const v of canvas) mean += v;
  mean /= canvas.length;
  let dev = 0;
  for (const v of canvas) dev += (v - mean) * (v - mean);
  dev = Math.sqrt(dev / canvas.length) || 1;
  for (let i = 0; i < canvas.length; i++) {
    canvas[i] = Math.min(1, Math.max(0, 0.5 + ((canvas[i]! - mean) / dev) * contrast));
  }
}

export function paintMeadow(size: number): Float32Array {
  const c = new Float32Array(size * size).fill(0.3);
  const rnd = mulberry(0x6d656164);
  // Tussock patches first: the ground between them stays dark.
  for (let i = 0; i < 120; i++) dab(c, size, rnd() * size, rnd() * size, rnd() * Math.PI, 30 + rnd() * 50, 22 + rnd() * 30, 0.36 + rnd() * 0.16, 1.5);
  // Tufts: fans of blades from one root, painted over each other.
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const lean = rnd() * Math.PI * 2;
    const blades = 4 + Math.floor(rnd() * 5);
    const light = 0.55 + rnd() * 0.3;
    for (let k = 0; k < blades; k++) {
      const a = lean + (rnd() - 0.5) * 1.6;
      blade(c, size, x, y, a, 18 + rnd() * 26, 2.6 + rnd() * 1.6, light * 0.62, light + rnd() * 0.12);
    }
  }
  posterise(c, 6, 0.35);
  normalise(c, 0.2);
  return c;
}

export function paintCrop(size: number): Float32Array {
  const c = new Float32Array(size * size).fill(0.35);
  const rnd = mulberry(0x63726f70);
  // Stalks standing in drill rows: long strokes along the rows, the gaps between rows
  // left a little darker so the lines read at a glance but do not stripe.
  const rows = 22;
  for (let i = 0; i < 5200; i++) {
    const row = Math.floor(rnd() * rows);
    const y = ((row + 0.5 + (rnd() - 0.5) * 0.55) / rows) * size;
    const x = rnd() * size;
    const a = (rnd() - 0.5) * 0.35;
    blade(c, size, x, y, a, 14 + rnd() * 16, 2.2 + rnd() * 1.2, 0.5 + rnd() * 0.15, 0.72 + rnd() * 0.2);
  }
  posterise(c, 6, 0.35);
  normalise(c, 0.17);
  return c;
}

export function paintForestFloor(size: number): Float32Array {
  const c = new Float32Array(size * size).fill(0.45);
  const rnd = mulberry(0x666f7265);
  for (let i = 0; i < 260; i++) dab(c, size, rnd() * size, rnd() * size, rnd() * Math.PI, 16 + rnd() * 34, 10 + rnd() * 22, 0.3 + rnd() * 0.35, 1.5);
  // Leaf litter: small flat leaves, lit and shaded.
  for (let i = 0; i < 1800; i++) dab(c, size, rnd() * size, rnd() * size, rnd() * Math.PI, 4 + rnd() * 5, 2.2 + rnd() * 2, 0.38 + rnd() * 0.22, 3);
  posterise(c, 6, 0.35);
  normalise(c, 0.18);
  return c;
}

export function paintEarth(size: number): Float32Array {
  const c = new Float32Array(size * size).fill(0.45);
  const rnd = mulberry(0x65617274);
  for (let i = 0; i < 200; i++) dab(c, size, rnd() * size, rnd() * size, rnd() * Math.PI, 20 + rnd() * 40, 14 + rnd() * 26, 0.32 + rnd() * 0.3, 1.5);
  // Clods: a lit top over a shaded underside, like the furrow's own relief.
  for (let i = 0; i < 520; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 5 + rnd() * 9;
    const a = (rnd() - 0.5) * 0.8;
    dab(c, size, x, y + r * 0.35, a, r * 1.4, r * 0.6, 0.34, 2);
    dab(c, size, x, y - r * 0.15, a, r * 1.2, r * 0.5, 0.52 + rnd() * 0.1, 2);
  }
  posterise(c, 6, 0.35);
  normalise(c, 0.17);
  return c;
}

/** Smooth wrapping value noise, two octaves, 0..1. */
function smoothNoise(size: number, cells: number, seed: number): Float32Array {
  const rnd = mulberry(seed);
  const out = new Float32Array(size * size);
  for (const [n, amp] of [[cells, 0.65], [cells * 3, 0.35]] as const) {
    const grid = new Float32Array(n * n).map(() => rnd());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * n;
        const gy = (y / size) * n;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (ix: number, iy: number): number => grid[(iy % n) * n + (ix % n)]!;
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * size + x]! += (top + (bottom - top) * sy) * amp;
      }
    }
  }
  return out;
}

function pack(size: number, channels: readonly Float32Array[]): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    for (let k = 0; k < 4; k++) data[i * 4 + k] = Math.round((channels[k]?.[i] ?? 0.5) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

let paint: THREE.DataTexture | null = null;
let vary: THREE.DataTexture | null = null;

function textures(): { paint: THREE.DataTexture; vary: THREE.DataTexture } {
  if (!paint) {
    paint = pack(PAINT_SIZE, [paintMeadow(PAINT_SIZE), paintCrop(PAINT_SIZE), paintForestFloor(PAINT_SIZE), paintEarth(PAINT_SIZE)]);
    paint.anisotropy = maxAnisotropy();
  }
  if (!vary) {
    vary = pack(VARY_SIZE, [smoothNoise(VARY_SIZE, 5, 0x76617279), smoothNoise(VARY_SIZE, 7, 0x68756573)]);
  }
  return { paint, vary };
}

/**
 * The ground's slow mottling, and the metres one repeat of it covers: grass samples it
 * at a tuft's root so the tuft is the colour of the ground it grows from.
 */
export function groundVary(): { texture: THREE.DataTexture; metres: number } {
  return { texture: textures().vary, metres: VARY_M };
}

/** Marks where the season has recoloured a ground vertex; later patches insert after it. */
export const SEASON_GROUND_MARK = '/* season-ground */';

/**
 * Paints a comic ground material (render/comic.ts: it relies on `vComicWorld` and
 * `vViewPosition`). Chains onto the material's existing `onBeforeCompile`; call it
 * after every other patch that replaces `color_fragment`, and before cloud shadow.
 */
export function applyGroundPaint<T extends THREE.Material>(material: T, options: { season?: boolean } = {}): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    // The season recolours the vertex colour by the same weights (render/season.ts).
    // Meshes whose colours are made for the season on the CPU (the vista) opt out.
    if (options.season) {
      injectSeason(shader);
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_COLOR
vColor.rgb = seasonGround( vColor.rgb, aGround );
#endif
${SEASON_GROUND_MARK}`,
      );
    }
    // Painted on first compile, not at import: the terrain materials are built at module
    // load, before the renderer has told us its anisotropy.
    const { paint: paintTexture, vary: varyTexture } = textures();
    shader.uniforms.uGroundPaint = { value: paintTexture };
    shader.uniforms.uGroundVary = { value: varyTexture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aGround;
varying vec4 vGround;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGround = aGround;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uGroundPaint;
uniform sampler2D uGroundVary;
varying vec4 vGround;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 groundAt = vComicWorld.xz;
  float groundSum = vGround.x + vGround.y + vGround.z + vGround.w;
  vec4 groundW = groundSum < 0.01 ? vec4( 1.0, 0.0, 0.0, 0.0 ) : vGround / groundSum;
  vec4 paintNear = texture2D( uGroundPaint, groundAt / ${SCALE_NEAR_M.toFixed(2)} );
  vec4 paintFar = texture2D( uGroundPaint, mat2( 0.8, -0.6, 0.6, 0.8 ) * groundAt / ${SCALE_FAR_M.toFixed(2)} + 0.37 );
  float strokes = dot( groundW, paintNear ) * 0.6 + dot( groundW, paintFar ) * 0.4;
  diffuseColor.rgb *= 1.0 + ( strokes - 0.5 ) * 1.1;
  diffuseColor.rgb *= 1.0 - ${FOREST_SHADE.toFixed(2)} * groundW.z;
  // Mottling over tens of metres: lighter and darker, and on grass warmer and cooler.
  vec4 groundVary = texture2D( uGroundVary, groundAt / ${VARY_M.toFixed(1)} );
  diffuseColor.rgb *= 0.88 + 0.24 * groundVary.r;
  float groundWarm = ( groundVary.g - 0.5 ) * 2.0 * ( groundW.x + groundW.y );
  diffuseColor.rgb *= mix( vec3( 1.0 ), groundWarm > 0.0 ? vec3( 1.06, 1.01, 0.86 ) : vec3( 0.93, 1.02, 1.02 ), abs( groundWarm ) * 0.6 );
}`);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:ground-paint-v3${options.season ? '-season' : ''}`;
  return material;
}
