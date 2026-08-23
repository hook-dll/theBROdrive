import * as THREE from 'three';
import { hash01 } from '../core/rng';

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
 * asset in the project. Two maps come out of here:
 *
 *  - ALBEDO, multiplied by the mesh's vertex colour, so the lane's own condition
 *    (asphalt / cracked / gravel, dust, sand cover) still comes from the geometry
 *    and this only adds the fine variation. Its mean luminance is exported so the
 *    caller can divide it out and keep the surface's average brightness unchanged.
 *  - BUMP, the same grain at much higher contrast, so a low sun rakes across the
 *    aggregate instead of finding a mirror.
 *
 * The grain is written PER PIXEL into an ImageData rather than drawn as canvas
 * shapes. The first version stamped 110k ellipses per map and startup never
 * finished: a software canvas does perhaps a few thousand path fills a second, while
 * a million-pixel loop is a few tens of milliseconds. Only the handful of cracks and
 * patches are still strokes, and each is drawn nine times at ±tile offsets, which is
 * what makes the tile seamless in both axes.
 */

/**
 * Tile size in world metres, both axes so the grain never stretches.
 *
 * 24 m, not 8: at 8 m the same crack and the same patch came round every third car
 * length and the surface read as paving slabs. The repeat has to be longer than the
 * distance over which the eye can hold a pattern at driving speed.
 */
export const ROAD_TILE_METRES = 24;
/** Canvas resolution. 1024 across 24 m is 2.3 cm a pixel: one aggregate chip. */
const TEXTURE_SIZE = 1024;
/** Chip size in pixels: a 5-7 cm stone, which is what a wearing course shows. */
const CHIP_PIXELS = 3;
/** Lattice cells across the tile for the bleaching field. 8 -> a 3 m blotch. */
const BLOTCH_CELLS = 8;

/** Mid-grey the tile is drawn around, 0..255. */
const BASE_TONE = 190;
/** Peak tonal swing of the bleaching field, in tone units. */
const BLOTCH_RANGE = 13;

interface RoadTextures {
  readonly map: THREE.Texture;
  readonly bump: THREE.Texture;
  /** Mean albedo luminance in linear space. Divide vertex colours by this. */
  readonly mean: number;
}

let cached: RoadTextures | null = null;

/** Deterministic 0..1 stream: `tag` separates streams, `i` walks one. */
function rnd(tag: number, i: number): number {
  return hash01(0x9e3779b9, tag, i);
}

/** Smooth (quintic) interpolant, so the bleaching field has no lattice creases. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise on a wrapping integer lattice, so the left edge meets the right.
 * `cells` must divide the texture evenly for the wrap to be exact.
 */
function wrapNoise(x: number, y: number, cells: number, tag: number): number {
  const fx = (x / TEXTURE_SIZE) * cells;
  const fy = (y / TEXTURE_SIZE) * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fade(fx - ix);
  const ty = fade(fy - iy);
  const at = (cx: number, cy: number): number =>
    hash01(tag, ((cx % cells) + cells) % cells, ((cy % cells) + cells) % cells) * 2 - 1;
  const a = at(ix, iy);
  const b = at(ix + 1, iy);
  const c = at(ix, iy + 1);
  const d = at(ix + 1, iy + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * The grain itself, written straight into an ImageData.
 *
 *  - Chips: the surface quantised into CHIP_PIXELS cells, each cell a stone of its
 *    own shade. Two thirds pale (quartz), one third dark (basalt), which is roughly
 *    what a desert wearing course looks like once the bitumen has worn back.
 *  - Per-pixel jitter on top, so a chip is not a flat square.
 *  - Bleaching: a smooth low-frequency field, because the sun does not fade an
 *    asphalt mat evenly and old surfaces are a patchwork of pours.
 *
 * `contrast` is the chip range in tone units: low for the albedo (or the road reads
 * as camouflage) and high for the bump map (or the relief does nothing).
 */
function paintGrain(ctx: CanvasRenderingContext2D, contrast: number, blotch: number): void {
  const img = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const data = img.data;
  const chipCells = Math.ceil(TEXTURE_SIZE / CHIP_PIXELS);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const cx = (x / CHIP_PIXELS) | 0;
      const cy = (y / CHIP_PIXELS) | 0;
      const chip = hash01(0x5bd1e995, cx % chipCells, cy % chipCells);
      // Pale chips sit above the mean, dark ones further below it.
      const chipTone = chip > 0.34 ? (chip - 0.34) * 1.5 * contrast : -(0.34 - chip) * 2.2 * contrast;
      const grit = (hash01(0x27d4eb2f, x, y) - 0.5) * contrast * 0.55;
      const bleach = wrapNoise(x, y, BLOTCH_CELLS, 0x165667b1) * blotch;
      const tone = Math.max(0, Math.min(255, Math.round(BASE_TONE + chipTone + grit + bleach)));
      const o = (y * TEXTURE_SIZE + x) * 4;
      data[o] = tone;
      data[o + 1] = tone;
      data[o + 2] = tone + 1 > 255 ? 255 : tone + 1;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
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
 * Six per 24 m tile at low alpha. More, or darker, and the tile's repetition becomes
 * the thing the eye locks onto.
 */
function drawCracks(ctx: CanvasRenderingContext2D, alpha: number): void {
  for (let i = 0; i < 6; i++) {
    const length = 200 + rnd(3, i) * 700;
    wrapped(ctx, () => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(${BASE_TONE - 60},${BASE_TONE - 62},${BASE_TONE - 64},${alpha})`;
      ctx.lineWidth = 4 + rnd(3, i + 100) * 6;
      crackPath(ctx, i, length);
      ctx.strokeStyle = `rgba(30,30,32,${Math.min(1, alpha * 1.3)})`;
      ctx.lineWidth = 1.2;
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
  for (let i = 0; i < 3; i++) {
    const x = rnd(5, i * 5) * TEXTURE_SIZE;
    const y = rnd(5, i * 5 + 1) * TEXTURE_SIZE;
    const w = 90 + rnd(5, i * 5 + 2) * 260;
    const h = 70 + rnd(5, i * 5 + 3) * 180;
    const tone = Math.round(BASE_TONE - 12 - rnd(5, i * 5 + 4) * 10);
    wrapped(ctx, () => {
      ctx.save();
      ctx.filter = 'blur(8px)';
      ctx.fillStyle = `rgba(${tone},${tone},${tone + 2},0.7)`;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    });
  }
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
    const v = data[i]! / 255;
    sum += v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
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
 * Builds both maps once and caches them. Called from the first road chunk build, so
 * the cost lands during loading rather than mid-drive.
 */
export function roadTextures(): RoadTextures {
  if (cached) return cached;

  const albedo = makeCanvas();
  paintGrain(albedo.ctx, 26, BLOTCH_RANGE);
  drawPatches(albedo.ctx);
  drawCracks(albedo.ctx, 0.35);

  const mean = meanLuminance(
    albedo.ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data,
  );

  const map = new THREE.CanvasTexture(albedo.canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const relief = makeCanvas();
  paintGrain(relief.ctx, 90, 0);
  drawCracks(relief.ctx, 0.5);
  const bump = new THREE.CanvasTexture(relief.canvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;

  cached = { map, bump, mean };
  return cached;
}
