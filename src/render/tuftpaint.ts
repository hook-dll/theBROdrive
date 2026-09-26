import * as THREE from 'three';

/**
 * THE GRASS CARDS' PAINT: tufts drawn in code, one atlas row of `TUFT_KINDS` cells.
 *
 * A tuft is one camera-facing card (world/grass.ts). What makes it read as grass, and
 * as ours rather than a photo, is this painting: a fan of broad, tapering blades with
 * a dark root, a light tip and a thin darker rim, back blades duller than front ones.
 * It is painted as DATA, not colour, so the ground under each tuft still sets its hue
 * and a season stays a change of palette:
 *   R  shade    0 at the root .. 1 at a lit tip; the shader maps it root→tip colour
 *   G  accent   a flower head or an ear: the shader paints it the tuft's accent colour
 *   A  coverage
 *
 * Kinds, left to right: a meadow tuft, a loose tussock, tall grass with flower heads,
 * standing crop (stalks and ears); each painted `TUFT_VARIANTS` times, the cells of
 * kind k at k * TUFT_VARIANTS + variant.
 */

export const TUFT_KINDS = 4;
/** Paintings of each kind, from different seeds: one painting repeated reads as a stamp. */
export const TUFT_VARIANTS = 2;
const CELL = 256;

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

const shadeStyle = (shade: number, accent = 0): string =>
  `rgb(${Math.round(Math.min(1, Math.max(0, shade)) * 255)},${Math.round(accent * 255)},0)`;

/**
 * One blade from a root on the cell's floor: a curved, tapering leaf. `lean` is the
 * sideways reach of the tip, `bend` how far the tip droops back down (arching grass).
 */
function blade(
  ctx: CanvasRenderingContext2D,
  x: number,
  length: number,
  lean: number,
  bend: number,
  width: number,
  root: number,
  tip: number,
): void {
  const floor = CELL;
  // Kept inside the cell: the card's edge would cut a blade straight.
  const tx = Math.min(CELL - 12, Math.max(12, x + lean));
  const ty = Math.max(10, floor - length + bend);
  // Control point: up first, then over, so the blade rises before it leans.
  const cx = x + lean * 0.25;
  const cy = floor - length * 0.95;
  const path = (w: number): void => {
    ctx.beginPath();
    ctx.moveTo(x - w, floor);
    ctx.quadraticCurveTo(cx - w * 0.6, cy, tx, ty);
    ctx.quadraticCurveTo(cx + w * 0.6, cy, x + w, floor);
    ctx.closePath();
  };
  // The rim: the same leaf a little wider and dark, under the fill. A pinch of ink.
  path(width + 1.6);
  ctx.fillStyle = shadeStyle(root * 0.45);
  ctx.fill();
  path(width);
  const g = ctx.createLinearGradient(x, floor, tx, ty);
  g.addColorStop(0, shadeStyle(root));
  g.addColorStop(0.55, shadeStyle(root + (tip - root) * 0.7));
  g.addColorStop(1, shadeStyle(tip));
  ctx.fillStyle = g;
  ctx.fill();
}

function stem(ctx: CanvasRenderingContext2D, x: number, length: number, lean: number, shade: number): [number, number] {
  const tx = Math.min(CELL - 16, Math.max(16, x + lean));
  const ty = Math.max(28, CELL - length);
  ctx.strokeStyle = shadeStyle(shade * 0.5);
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(x, CELL);
  ctx.quadraticCurveTo(x + lean * 0.2, CELL - length * 0.6, tx, ty);
  ctx.stroke();
  ctx.strokeStyle = shadeStyle(shade);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  return [tx, ty];
}

/** A fan of blades: back ones first and duller, front ones last and lighter. */
function fan(ctx: CanvasRenderingContext2D, rnd: () => number, count: number, height: number, spread: number, arch: number): void {
  for (let i = 0; i < count; i++) {
    const depth = i / (count - 1);
    const x = CELL / 2 + (rnd() - 0.5) * CELL * 0.34;
    const side = (x - CELL / 2) / (CELL * 0.17) + (rnd() - 0.5) * 1.2;
    const length = height * (0.55 + rnd() * 0.45) * (1 - 0.25 * Math.abs(side) * 0.5);
    const lean = side * spread * (0.5 + rnd() * 0.6);
    const bend = rnd() < arch ? length * (0.15 + rnd() * 0.35) : 0;
    const light = 0.62 + depth * 0.3 + rnd() * 0.08;
    blade(ctx, x, length, lean, bend, 6 + rnd() * 5, 0.2 + depth * 0.12, light);
  }
}

function paintMeadowTuft(ctx: CanvasRenderingContext2D, seed: number): void {
  fan(ctx, mulberry(0x74756674 + seed), 17, CELL * 0.9, CELL * 0.2, 0.2);
}

function paintTussock(ctx: CanvasRenderingContext2D, seed: number): void {
  fan(ctx, mulberry(0x7475736b + seed), 12, CELL * 0.98, CELL * 0.3, 0.6);
}

function paintFlowering(ctx: CanvasRenderingContext2D, seed: number): void {
  const rnd = mulberry(0x666c6f77 + seed);
  fan(ctx, rnd, 10, CELL * 0.62, CELL * 0.2, 0.3);
  for (let i = 0; i < 4; i++) {
    const x = CELL / 2 + (rnd() - 0.5) * CELL * 0.5;
    const [hx, hy] = stem(ctx, x, CELL * (0.72 + rnd() * 0.24), (rnd() - 0.5) * CELL * 0.18, 0.6);
    // A head of petals round a darker eye.
    const r = 11 + rnd() * 5;
    ctx.fillStyle = shadeStyle(0.2, 0.55);
    ctx.beginPath();
    ctx.arc(hx, hy, r + 1.8, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd();
      ctx.fillStyle = shadeStyle(0.9, 1);
      ctx.beginPath();
      ctx.ellipse(hx + Math.cos(a) * r * 0.5, hy + Math.sin(a) * r * 0.5, r * 0.55, r * 0.32, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = shadeStyle(0.35, 0.5);
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintCrop(ctx: CanvasRenderingContext2D, seed: number): void {
  const rnd = mulberry(0x63726f70 + seed);
  for (let i = 0; i < 16; i++) {
    const depth = i / 15;
    const x = CELL * 0.1 + rnd() * CELL * 0.8;
    const length = CELL * (0.72 + rnd() * 0.2);
    const [hx, hy] = stem(ctx, x, length, (rnd() - 0.5) * 30, 0.45 + depth * 0.35);
    // The ear: a plump spindle along the stalk's top, lit on one side.
    const a = Math.atan2(hy - CELL, hx - x) + Math.PI / 2;
    ctx.save();
    ctx.translate(hx, hy + 14);
    ctx.rotate(a);
    ctx.fillStyle = shadeStyle(0.25, 0);
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shadeStyle(0.7 + depth * 0.25, 0.6);
    ctx.beginPath();
    ctx.ellipse(-1, 0, 5.5, 21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // A leaf or two off the stalk.
    if (rnd() < 0.7) blade(ctx, x + 2, length * 0.55, (rnd() - 0.5) * 60, length * 0.12, 4, 0.3, 0.65 + depth * 0.2);
  }
}

let atlas: THREE.Texture | null = null;

/** The tuft atlas, painted on first use. */
export function tuftAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * TUFT_KINDS * TUFT_VARIANTS;
  canvas.height = CELL;
  const ctx = canvas.getContext('2d')!;
  const painters = [paintMeadowTuft, paintTussock, paintFlowering, paintCrop];
  painters.forEach((paint, k) => {
    for (let v = 0; v < TUFT_VARIANTS; v++) {
      const cell = k * TUFT_VARIANTS + v;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cell * CELL, 0, CELL, CELL);
      ctx.clip();
      ctx.translate(cell * CELL, 0);
      paint(ctx, v * 7919);
      ctx.restore();
    }
  });
  // Coverage keeps a hard-ish edge through the mips: a soft one would thin every tuft
  // away with distance (the shader also widens coverage as it minifies).
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  atlas = texture;
  return texture;
}
