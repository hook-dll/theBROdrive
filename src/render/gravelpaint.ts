import * as THREE from 'three';

/**
 * THE SHOULDER'S PAINT: crushed stone packed into earth, drawn in code and tiled along
 * the bare shoulder (world/roadmesh.ts, world/shoulder.ts).
 *
 * Shade, not colour, as the other paints are: the strip's vertex colour sets the earth
 * and the stone, this only says where a stone sits and how the light takes it. Stones
 * of a few centimetres, each lit on its upper side with a dark shadow under it, some
 * half sunk, over earth mottled darker where it is packed. One tile is `GRAVEL_TILE_M`
 * of road; it wraps on both axes.
 */

export const GRAVEL_TILE_M = 2;
/**
 * Coarse on purpose: the asphalt beside it is a soft texture, and a crisp stone at every
 * texel read as a photo pasted next to a painting.
 */
const SIZE = 256;

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

const grey = (v: number): string => {
  const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${g},${g},${g})`;
};

/** Draws `draw` at every wrap of (x, y) that touches the tile, so it tiles seamlessly. */
function wrapped(x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || px - r > SIZE || py + r < 0 || py - r > SIZE) continue;
      draw(px, py);
    }
  }
}

let texture: THREE.Texture | null = null;

export function gravelTexture(): THREE.Texture {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry(0x67726176);
  ctx.fillStyle = grey(0.78);
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Packed earth: soft darker blotches.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const r = 6 + rnd() * 20;
    const shade = 0.62 + rnd() * 0.14;
    const squash = 0.5 + rnd() * 0.5;
    const a = rnd() * Math.PI;
    wrapped(x, y, r, (px, py) => {
      ctx.fillStyle = grey(shade);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * squash, a, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
  // Stones: shadow under, body, lit top. Many small, a few big.
  for (let i = 0; i < 420; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const big = rnd() < 0.08;
    const r = big ? 3.5 + rnd() * 3 : 1.4 + rnd() * 2.2;
    const a = rnd() * Math.PI;
    const squash = 0.55 + rnd() * 0.4;
    const body = 0.74 + rnd() * 0.18;
    wrapped(x, y, r + 3, (px, py) => {
      ctx.fillStyle = grey(0.6);
      ctx.beginPath();
      ctx.ellipse(px + r * 0.25, py + r * 0.35, r * 1.1, r * squash * 1.1, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grey(body);
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * squash, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grey(Math.min(1, body + 0.1));
      ctx.beginPath();
      ctx.ellipse(px - r * 0.25, py - r * 0.2, r * 0.5, r * squash * 0.45, a, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  texture = t;
  return t;
}
