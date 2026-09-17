import * as THREE from 'three';
import { hash01 } from '../core/rng';
import { maxAnisotropy } from './texturequality';

/**
 * Procedural weathered-asphalt textures for the road ribbon.
 *
 * The road used to be flat vertex-coloured geometry: one albedo per chunk and
 * nothing at all between the lane markings. At any speed that reads as poured
 * plastic, because real asphalt is almost entirely detail at the 1-30 cm scale —
 * exposed aggregate, bleached bitumen, sealed cracks, old patches — and none of it
 * survives a 1 m vertex spacing.
 *
 * So it is a texture, drawn once at startup rather than shipped as an image: the
 * whole world is procedural and a megabyte of PNG for one surface would be the only
 * asset in the project. Three things come out of here:
 *
 *  - ALBEDO, multiplied by the mesh's vertex colour, so the lane's own condition
 *    (asphalt / cracked / gravel, dust, sand cover) still comes from the geometry
 *    and this only adds the fine variation. Its mean luminance is exported so the
 *    caller can divide it out and keep the surface's average brightness unchanged.
 *  - NORMAL, derived from the same height field, so a low sun rakes across the
 *    wearing course instead of finding a mirror.
 *  - The height field itself never leaves this module.
 *
 * THE GRAIN IS WRAPPING GRADIENT NOISE, and that is a correction rather than a
 * preference. Two earlier versions were rejected by looking at the result:
 *
 *  - Quantised square chips, one flat tone per cell with per-pixel white noise on
 *    top. At 2.3 cm a texel that puts an axis-aligned 7 cm square on every stone, and
 *    the eye locks onto the grid: the road reads as pixel art, because 3-pixel
 *    squares ARE pixels. Filtering cannot save it — the squares are the signal.
 *  - Summed VALUE noise. Smooth, but its features sit on lattice points, so the
 *    surface came back as weakly rectangular blotches of plaster.
 *
 * Gradient noise has no preferred direction and no feature per cell, so minification
 * turns it into grain rather than into a grid. Octaves alternate their axes, which
 * costs nothing and stops four lattices from sharing one.
 *
 * Texel density is why the octaves stop where they do. 1024 across 24 m is 2.3 cm a
 * texel, so a 3 cm stone is a single texel and *cannot* be drawn as a stone — it can
 * only be a sample of a band-limited field, which is what the two high octaves are.
 * Promising shapes below the sampling limit is exactly the mistake the squares made.
 *
 * Only the handful of cracks and patches are still strokes, and each is drawn nine
 * times at ±tile offsets, which is what makes the tile seamless in both axes.
 */

/**
 * Tile size in world metres, both axes so the grain never stretches.
 *
 * RoadMesh writes U as absolute `lateral / ROAD_TILE_METRES`, not a fraction of the
 * local carriageway, so widening preserves aggregate scale. Lane paint remains mesh
 * geometry; this texture deliberately contains no line pattern to stretch or repeat.
 *
 * 24 m, not 8: at 8 m the same crack and the same patch came round every third car
 * length and the surface read as paving slabs. The repeat has to be longer than the
 * distance over which the eye can hold a pattern at driving speed.
 */
export const ROAD_TILE_METRES = 24;
/** Canvas resolution. 1024 across 24 m is 2.3 cm a pixel: one aggregate chip. */
const TEXTURE_SIZE = 1024;

/** Mid-grey the tile is drawn around, 0..255. */
const BASE_TONE = 190;
/** Peak tonal swing of the wearing course, in tone units. */
const COURSE_RANGE = 30;
/**
 * Octaves of the wearing course, as (lattice cells, gain, transposed). Chosen against
 * the 2.3 cm texel: 64 cells is 16 px (37 cm) and carries how a pour was mixed, 128 is
 * 8 px (18 cm) and is the octave the chips are cut from, 256 is 4 px and 512 is 2 px —
 * the grit inside and between the chips.
 *
 * MOST OF THE ENERGY IS IN THE TWO HIGH OCTAVES ON PURPOSE. A real asphalt mat is a
 * fairly uniform grey; what varies across a road is the wheel tracks and the dust,
 * which are geometry and vertex colour here, not the tile. Weighting the tile toward
 * its low frequencies is what produced half-metre blotches that read as noise — the
 * surface was LESS uniform than the thing it was imitating.
 */
const COURSE: readonly {
  readonly cells: number;
  readonly gain: number;
  readonly transposed: boolean;
  readonly tag: number;
}[] = [
  { cells: 64, gain: 0.22, transposed: false, tag: 0x1b873593 },
  { cells: 128, gain: 0.44, transposed: true, tag: 0xcc9e2d51 },
  { cells: 256, gain: 0.32, transposed: false, tag: 0x85ebca6b },
  { cells: 512, gain: 0.24, transposed: true, tag: 0x27d4eb2f },
];

/** Lattice cells of the bleaching field. 6 -> a 4 m blotch, over the whole mat. */
const BLOTCH_CELLS = 6;
/** Peak tonal swing of the bleaching field, in tone units. */
const BLOTCH_RANGE = 8;
/** Lattice cells of the ravelling field. 24 -> a 1 m patch. */
const RAVEL_CELLS = 24;
/**
 * Binder and aggregate are one surface, not an even mix: some patches are polished,
 * binder-rich and flat, others have lost the binder and stand up as pale, high-relief
 * chip. How much of that a pixel gets is `ravel`, and these two numbers say how far it
 * is allowed to swing the tone and the relief.
 */
const RAVEL_TONE = 4;
const RAVEL_RELIEF = 0.85;

/**
 * Eight unit gradients, the directions a hash picks from, plus the per-octave lattice
 * they are baked into.
 *
 * THE LATTICE IS PRECOMPUTED, and that is the whole difference between this being a
 * 600 ms and a 200 ms startup cost. A gradient-noise sample reads the four lattice
 * corners around it, and each corner is shared by every texel in its cell: at 64 cells
 * per tile a corner is hashed 256 times, at 6 cells (the bleaching field) about 29 000
 * times. Hashing per texel was doing the same work two hundred times over, so the
 * corners are hashed once into a table and the inner loop only reads it.
 */
interface GradientLattice {
  readonly cells: number;
  /** (gx, gy) per corner, row-major. */
  readonly g: Float32Array;
}

const GRAD_X = new Float64Array(8);
const GRAD_Y = new Float64Array(8);
for (let i = 0; i < 8; i++) {
  GRAD_X[i] = Math.cos((i * Math.PI) / 4);
  GRAD_Y[i] = Math.sin((i * Math.PI) / 4);
}

function buildLattice(cells: number, tag: number): GradientLattice {
  const g = new Float32Array(cells * cells * 2);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const pick = ((hash01(tag, cx, cy) * 8) | 0) & 7;
      const o = (cy * cells + cx) * 2;
      g[o] = GRAD_X[pick]!;
      g[o + 1] = GRAD_Y[pick]!;
    }
  }
  return { cells, g };
}

const COURSE_LATTICES: readonly GradientLattice[] = COURSE.map((o) => buildLattice(o.cells, o.tag));
const RAVEL_LATTICE = buildLattice(RAVEL_CELLS, 0x9e3779b1);
const BLOTCH_LATTICE = buildLattice(BLOTCH_CELLS, 0x165667b1);

interface RoadTextures {
  readonly map: THREE.Texture;
  /** Tangent-space normals of the wearing course. */
  readonly normal: THREE.Texture;
  /** Mean albedo luminance in linear space. Divide vertex colours by this. */
  readonly mean: number;
}

let cached: RoadTextures | null = null;

/** Deterministic 0..1 stream: `tag` separates streams, `i` walks one. */
function rnd(tag: number, i: number): number {
  return hash01(0x9e3779b9, tag, i);
}

/** Smooth (quintic) interpolant, so the field has no lattice creases. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Hermite ease, 0 below `a` and 1 above `b`, smooth at both ends. */
function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Wraps a lattice coordinate into the tile, either way. */
function wrapCell(i: number, cells: number): number {
  const t = i % cells;
  return t < 0 ? t + cells : t;
}

/**
 * Gradient (Perlin) noise on a wrapping lattice, so the left edge meets the right and
 * the top meets the bottom. `cells` must divide TEXTURE_SIZE evenly.
 *
 * `transposed` swaps the axes, which is a rotation of the lattice by 90 degrees and
 * costs nothing: octaves that share an axis share its alignment, and four octaves
 * sharing one is what puts a rectangle on a surface that has none.
 */
function wrapPerlin(l: GradientLattice, x: number, y: number, transposed = false): number {
  if (transposed) {
    const t = x;
    x = y;
    y = t;
  }
  const cells = l.cells;
  const g = l.g;
  const fx = (x / TEXTURE_SIZE) * cells;
  const fy = (y / TEXTURE_SIZE) * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const dx = fx - ix;
  const dy = fy - iy;
  const u = fade(dx);
  const v = fade(dy);

  const cx0 = wrapCell(ix, cells);
  const cy0 = wrapCell(iy, cells);
  const cx1 = wrapCell(ix + 1, cells);
  const cy1 = wrapCell(iy + 1, cells);
  const row0 = cy0 * cells * 2;
  const row1 = cy1 * cells * 2;
  const o00 = row0 + cx0 * 2;
  const o10 = row0 + cx1 * 2;
  const o01 = row1 + cx0 * 2;
  const o11 = row1 + cx1 * 2;

  const n00 = g[o00]! * dx + g[o00 + 1]! * dy;
  const n10 = g[o10]! * (dx - 1) + g[o10 + 1]! * dy;
  const n01 = g[o01]! * dx + g[o01 + 1]! * (dy - 1);
  const n11 = g[o11]! * (dx - 1) + g[o11 + 1]! * (dy - 1);

  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  // x1.6: the mean absolute value of this form is about 0.32, and the callers are
  // written against a field that reaches +-1.
  return (a + (b - a) * v) * 1.6;
}

/**
 * The wearing course at a pixel: a tone offset around zero, in tone units, and the
 * relief that tone is standing on, in arbitrary units the normal pass scales.
 *
 * ONE evaluation, two uses, deliberately: the tone a pixel gets and the height its
 * neighbours are differenced against have to be the same field, or the relief reads as
 * a separate material laid over the colour.
 *
 * The chip field is TERRACED, and that is what makes this aggregate rather than the
 * cloud of soft blobs two earlier versions produced. A wearing course is stones sitting
 * in binder: three plateaus — binder, mid chip, pale quartz chip — with the risers
 * between them only as soft as the sampling limit demands. The plateaus are the tones,
 * so the relief and the tone agree by construction. Their BOUNDARIES are iso-contours
 * of smooth gradient noise, so they are irregular and round; that is the whole
 * difference between this and the square chips the first version stamped.
 */
function wearingCourse(x: number, y: number, out: { tone: number; height: number }): void {
  // How polished this patch is. Zero is binder-rich and flat, one is loose chip.
  const ravel = smoothstep(-0.45, 0.45, wrapPerlin(RAVEL_LATTICE, x, y, true));
  let coarse = 0;
  let chipField = 0;
  for (let i = 0; i < COURSE.length; i++) {
    const octave = COURSE[i]!;
    const n = wrapPerlin(COURSE_LATTICES[i]!, x, y, octave.transposed);
    if (i === 0) coarse += n * octave.gain;
    else chipField += n * octave.gain;
  }
  // Three plateaus: 0 binder, 0.5 chip, 1 pale chip. The risers are narrow — a stone
  // edge is a shadow line, not a gradient — and the thresholds sit either side of the
  // field's mean so the three plateaus are all populated.
  const chip = 0.5 * (smoothstep(-0.34, -0.18, chipField) + smoothstep(0.0, 0.16, chipField));
  // Polished binder damps the chip and darkens; loose chip keeps all of it and
  // lightens. The two move together because they are one thing: what stands proud of
  // the binder is aggregate, and aggregate is pale.
  const relief = RAVEL_RELIEF + (1 - RAVEL_RELIEF) * ravel;
  out.tone =
    (chip - 0.5) * COURSE_RANGE * relief + coarse * COURSE_RANGE * 0.35 * (0.6 + 0.4 * ravel) +
    (ravel - 0.5) * RAVEL_TONE;
  // The relief keeps little of the coarse octave: a 24 cm swell in the surface is a
  // road profile, and the road profile is already drawn by the mesh, in metres.
  out.height = chip * relief + coarse * 0.22;
}

/**
 * Paints the albedo and fills the height field in one pass.
 *
 * The bleaching field is added here rather than as a separate overlay because the sun
 * does not fade an asphalt mat evenly: old surfaces are a patchwork of pours, and a
 * patch that has bleached has also lost its fine relief. So the same value lifts the
 * tone and damps the relief together.
 */
function paintCourse(ctx: CanvasRenderingContext2D, height: Float32Array): void {
  const img = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const data = img.data;
  const scratch = { tone: 0, height: 0 };
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const bleach = wrapPerlin(BLOTCH_LATTICE, x, y);
      wearingCourse(x, y, scratch);
      const relief = 1 - 0.35 * bleach;
      const tone = Math.max(
        0,
        Math.min(255, Math.round(BASE_TONE + scratch.tone * relief + bleach * BLOTCH_RANGE)),
      );
      // A whisper of independent warm/cool bias, so the surface is not monochrome
      // computer grey. Four tone units on an 8x8 lattice: colour, never grain.
      const tint = Math.round((hash01(0x6c8e9cf5, x >> 3, y >> 3) - 0.5) * 4);
      const o = (y * TEXTURE_SIZE + x) * 4;
      data[o] = Math.max(0, Math.min(255, tone + tint));
      data[o + 1] = tone;
      data[o + 2] = Math.max(0, Math.min(255, tone + 1 - tint * 0.65));
      data[o + 3] = 255;
      height[y * TEXTURE_SIZE + x] = scratch.height * relief;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Wraps a texel index into the tile, either way. */
function wrapIndex(i: number): number {
  const t = i % TEXTURE_SIZE;
  return t < 0 ? t + TEXTURE_SIZE : t;
}

/**
 * Tangent-space normals from the height field, by central differences on the wrapping
 * lattice so the map is seamless like the albedo.
 *
 * The field is low-passed first, and that is not a cosmetic blur: a normal map is the
 * DERIVATIVE of its height, and differentiating amplifies the one thing the tile's
 * noise still has that a road does not — the lattice the octaves sit on. One 1-2-1 pass
 * costs a millisecond and turns stone risers into the rounded edges a stone actually
 * has.
 *
 * `strength` is relief per texel step: at 2.3 cm a texel, a 1 mm step between
 * neighbours has to lean the normal about 2.5 degrees to be visible at all, and 0.45 is
 * set by looking at a 22-degree sun. Too high and the aggregate turns into puffed
 * plaster; too low and the road is the mirror this map exists to prevent.
 */
function paintNormals(raw: Float32Array): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas();
  const img = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const data = img.data;
  const strength = 0.45;
  const height = blurred(raw);
  const at = (x: number, y: number): number =>
    height[wrapIndex(y) * TEXTURE_SIZE + wrapIndex(x)]!;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // The surface tilts toward +x where the height falls, so the normal leans the
      // other way. Both channels are written in the OpenGL (green-up) convention.
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * TEXTURE_SIZE + x) * 4;
      data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * One separable 1-2-1 pass over the height field: horizontal into a scratch row buffer,
 * vertical back into the copy, wrapping at the tile edges so the blurred field is as
 * seamless as the raw one.
 */
function blurred(source: Float32Array): Float32Array {
  const size = TEXTURE_SIZE;
  const a = Float32Array.from(source);
  const b = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      b[row + x] =
        (a[row + wrapIndex(x - 1)]! + 2 * a[row + x]! + a[row + wrapIndex(x + 1)]!) * 0.25;
    }
  }
  for (let y = 0; y < size; y++) {
    const up = wrapIndex(y - 1) * size;
    const down = wrapIndex(y + 1) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      a[row + x] = (b[up + x]! + 2 * b[row + x]! + b[down + x]!) * 0.25;
    }
  }
  return a;
}

/** Draws `paint` nine times, offset by the tile in each direction: seamless. */
function wrapped(ctx: CanvasRenderingContext2D, paint: () => void): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * TEXTURE_SIZE, dy * TEXTURE_SIZE);
      paint();
      ctx.restore();
    }
  }
}

/** One meandering crack, walked in short segments with a wandering heading. */
function crackPath(ctx: CanvasRenderingContext2D, index: number, length: number): void {
  let x = rnd(4, index * 80) * TEXTURE_SIZE;
  let y = rnd(4, index * 80 + 1) * TEXTURE_SIZE;
  let heading = rnd(4, index * 80 + 2) * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  const steps = Math.round(length / 10);
  for (let k = 0; k < steps; k++) {
    heading += (rnd(4, index * 80 + 3 + k) - 0.5) * 0.9;
    x += Math.cos(heading) * 10;
    y += Math.sin(heading) * 10;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Cracks, and the tar poured into them.
 *
 * A bare crack reads as a scratch. What says "this has been patched for thirty
 * years" is the SEALANT: an overwide snake of bitumen brushed along the crack,
 * wandering where the crew's brush wandered. Each is drawn twice — a soft dark
 * snake, then a hairline inside it.
 *
 * TWO per 24 m tile, not six, and short. A crack every four metres of a repeating tile
 * is a pattern before it is damage, and the tile's own repeat is what the eye then locks
 * onto: long meandering loops are the most memorable thing a 24 m tile can carry, so
 * they are the first thing to go when the repeat starts showing. The road's real damage
 * budget is spent on potholes and ravelled edges, which are placed in world space and
 * never repeat.
 */
function drawCracks(ctx: CanvasRenderingContext2D, alpha: number): void {
  for (let i = 0; i < 2; i++) {
    const length = 120 + rnd(3, i) * 320;
    wrapped(ctx, () => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(${BASE_TONE - 60},${BASE_TONE - 62},${BASE_TONE - 64},${alpha})`;
      ctx.lineWidth = 2 + rnd(3, i + 100) * 2.5;
      crackPath(ctx, i, length);
      ctx.strokeStyle = `rgba(30,30,32,${Math.min(1, alpha * 1.3)})`;
      ctx.lineWidth = 1;
      crackPath(ctx, i, length);
    });
  }
}

/**
 * Repair patches: an area of newer, darker, finer mix.
 *
 * Soft-edged and shallow. Hard-edged dark rectangles in a tiling texture are not
 * patches, they are floor tiles, which is exactly how the first attempt looked.
 */
function drawPatches(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < 2; i++) {
    const x = rnd(5, i * 5) * TEXTURE_SIZE;
    const y = rnd(5, i * 5 + 1) * TEXTURE_SIZE;
    const w = 120 + rnd(5, i * 5 + 2) * 300;
    const h = 90 + rnd(5, i * 5 + 3) * 200;
    const tone = Math.round(BASE_TONE - 10 - rnd(5, i * 5 + 4) * 9);
    wrapped(ctx, () => {
      ctx.save();
      ctx.filter = 'blur(10px)';
      ctx.fillStyle = `rgba(${tone},${tone},${tone + 2},0.55)`;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    });
  }
}

/**
 * sRGB byte -> linear, as a table. The mean pass runs on a million samples and is the
 * only place a `pow` appears in this module; a table turns it into a lookup.
 */
const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Mean luminance of the canvas in the LINEAR working space, 0..1.
 *
 * Linear, not sRGB, because that is where the shader multiplies it against the
 * vertex colour: averaging the bytes gives 0.74 where the truth is 0.50, and the
 * road comes out a third too dark.
 */
function meanLuminance(data: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += SRGB_TO_LINEAR[data[i]!]!;
    n++;
  }
  return sum / n;
}

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/**
 * Builds every map once and caches them. Called from the first road chunk build, so
 * the cost lands during loading rather than mid-drive.
 */
export function roadTextures(): RoadTextures {
  if (cached) return cached;

  const albedo = makeCanvas();
  const height = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  paintCourse(albedo.ctx, height);
  drawPatches(albedo.ctx);
  drawCracks(albedo.ctx, 0.32);

  const mean = meanLuminance(
    albedo.ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data,
  );

  const map = new THREE.CanvasTexture(albedo.canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy();

  const normal = new THREE.CanvasTexture(paintNormals(height));
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  // Tangent-space normals are directions, not colour: they must not be sRGB-decoded.
  normal.colorSpace = THREE.NoColorSpace;
  normal.anisotropy = maxAnisotropy();

  cached = { map, normal, mean };
  return cached;
}
