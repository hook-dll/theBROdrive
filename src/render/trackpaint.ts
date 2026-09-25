import * as THREE from 'three';

import { TRACK_HALF_WIDTH_M, TRACK_RUT_HALF_M, TRACK_RUT_OFFSET_M } from '../world/tracks';

/**
 * A DIRT TRACK'S PAINT: across the track (u 0..1 over its whole width), along it
 * (v, one tile per `TRACK_TILE_M`), wrapping along only.
 *
 * Two ruts of bare, packed earth, tread-pressed and a little puddled, with ragged
 * edges where grass leans in; between them and outside them nothing (alpha 0), so the
 * tile's own meadow and the grass cards show there: the strip of grass down the middle
 * of a Russian dirt road is the real grass, not a picture of it. Shade in rgb over the
 * ribbon's earth vertex colour, coverage in alpha.
 */

export const TRACK_TILE_M = 4;
const W = 256;
const H = 512;

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

let texture: THREE.Texture | null = null;

export function trackTexture(): THREE.Texture {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry(0x72757473);
  const px = (m: number): number => ((m + TRACK_HALF_WIDTH_M) / (2 * TRACK_HALF_WIDTH_M)) * W;
  const grey = (v: number, a = 1): string => {
    const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return `rgba(${g},${g},${g},${a})`;
  };
  for (const centre of [-TRACK_RUT_OFFSET_M, TRACK_RUT_OFFSET_M]) {
    const half = (TRACK_RUT_HALF_M / (2 * TRACK_HALF_WIDTH_M)) * W;
    const cx = px(centre);
    // The rut as a ragged band down the tile: its edge wanders, periodically in v so the
    // tile wraps. Painted in rows.
    const phase = rnd() * 6.28;
    for (let y = 0; y < H; y++) {
      const t = (y / H) * Math.PI * 2;
      const wob = Math.sin(t * 3 + phase) * 2.5 + Math.sin(t * 7 + phase * 2) * 1.5;
      const left = cx - half - 3 + wob + Math.sin(t * 11 + phase) * 2;
      const right = cx + half + 3 + wob + Math.sin(t * 13 - phase) * 2;
      // Soft edge: a few pixels of partial coverage either side.
      const grad = ctx.createLinearGradient(left - 5, 0, right + 5, 0);
      grad.addColorStop(0, grey(0.9, 0));
      grad.addColorStop(0.12, grey(0.92, 1));
      grad.addColorStop(0.5, grey(0.8, 1));
      grad.addColorStop(0.88, grey(0.92, 1));
      grad.addColorStop(1, grey(0.9, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(left - 5, y, right - left + 10, 1);
    }
    // Tread: faint bars across the rut, broken, not a ladder.
    for (let k = 0; k < 70; k++) {
      if (rnd() < 0.4) continue;
      const y = (k / 70) * H + rnd() * 3;
      const w = half * (0.6 + rnd() * 0.7);
      ctx.fillStyle = grey(0.72, 0.4);
      ctx.fillRect(cx - w / 2 + (rnd() - 0.5) * 3, y, w, 1.4);
    }
    // Damp, darker stretches along the rut: long, soft, irregular, two or three a tile.
    const damp = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < damp; k++) {
      const y = rnd() * H;
      const len = 40 + rnd() * 90;
      for (let j = 0; j < 5; j++) {
        // Drawn at each vertical wrap with the SAME numbers, so the tile meets itself.
        const ex = cx + (rnd() - 0.5) * half * 0.6;
        const ey = y + (j - 2) * len * 0.18;
        const rx = half * (0.45 + rnd() * 0.35);
        const ry = len * (0.18 + rnd() * 0.1);
        for (const dy of [-H, 0, H]) {
          ctx.fillStyle = grey(0.7, 0.35);
          ctx.beginPath();
          ctx.ellipse(ex, ey + dy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.premultiplyAlpha = false;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  texture = t;
  return t;
}
