// Image toolkit for the look-asset builders.
//
// Everything works on a plain `img` object: { w, h, ch, data: Float32Array }.
// Float keeps the arithmetic readable (blend maths, high-pass, normal build) and
// only the final encode quantises. Sharp does load/save/resize/blur; the pixel
// loops here do the rest.
//
// Channel conventions used across public/look:
//   ground tiles  RGB = albedo, A = height (0 base .. 1 crest); grey tiles are
//                 R=G=B so the shader can tint them;
//   sprites       RGB = colour (or greyscale), A = cutout;
//   normal maps   RGB = tangent-space normal, OpenGL convention (+Y up, +Z out
//                 of the surface toward the viewer).

import sharp from 'sharp';
import path from 'node:path';
import { OUTDIR, ensureDirs } from './util.mjs';

export const img = (w, h, ch = 4, fill = 0) => {
  const data = new Float32Array(w * h * ch);
  if (fill) data.fill(fill);
  return { w, h, ch, data };
};

export const clone = (a) => ({ w: a.w, h: a.h, ch: a.ch, data: Float32Array.from(a.data) });

export function channelCount(img) {
  return img.ch;
}

/** Load any image sharp understands, optionally resized (stretch) to w×h, as float 0..1. */
export async function loadImage(file, { w, h, ch = 4 } = {}) {
  let s = sharp(file, { unlimited: true }).rotate();
  if (w && h) s = s.resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const out = img(W, H, ch);
  const n = info.channels;
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < ch; c++) out.data[i * ch + c] = (n > c ? data[i * n + c] : 1) / 255;
  }
  return out;
}

/** Load just one channel (0=r,1=g,2=b,3=a) as a 1-channel float image. */
export async function loadChannel(file, index, { w, h } = {}) {
  const full = await loadImage(file, { w, h, ch: 4 });
  return pick(full, index);
}

export const pick = (a, c) => {
  const out = img(a.w, a.h, 1);
  for (let i = 0; i < a.w * a.h; i++) out.data[i] = a.data[i * a.ch + c];
  return out;
};

export function setChannel(a, c, src) {
  for (let i = 0; i < a.w * a.h; i++) a.data[i * a.ch + c] = src.data[i];
  return a;
}

/** Copy `src` into `dst` at (x, y), keeping dst's channel count. */
export function paste(dst, src, x, y, { chMap = null } = {}) {
  for (let j = 0; j < src.h; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.w) continue;
      for (let c = 0; c < dst.ch; c++) {
        const sc = chMap ? chMap[c] : Math.min(c, src.ch - 1);
        dst.data[(dy * dst.w + dx) * dst.ch + c] = src.data[(j * src.w + i) * src.ch + sc];
      }
    }
  }
  return dst;
}

export function crop(a, x, y, w, h) {
  const out = img(w, h, a.ch);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const sx = ((x + i) % a.w + a.w) % a.w;
      const sy = ((y + j) % a.h + a.h) % a.h;
      for (let c = 0; c < a.ch; c++) out.data[(j * w + i) * out.ch + c] = a.data[(sy * a.w + sx) * a.ch + c];
    }
  return out;
}

/** Wrap-around crop (no clamping) — used to make a source tile at an arbitrary offset. */
export const wrapCrop = crop;

export function resizeRaw(a, w, h) {
  const out = img(w, h, a.ch);
  for (let j = 0; j < h; j++) {
    const sy = ((j + 0.5) * a.h) / h - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(a.h - 1, y0 + 1);
    const fy = sy - y0;
    for (let i = 0; i < w; i++) {
      const sx = ((i + 0.5) * a.w) / w - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(a.w - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < a.ch; c++) {
        const at = (x, y) => a.data[(y * a.w + x) * a.ch + c];
        const v00 = at(x0, y0);
        const v10 = at(x1, y0);
        const v01 = at(x0, y1);
        const v11 = at(x1, y1);
        out.data[(j * w + i) * out.ch + c] =
          (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
      }
    }
  }
  return out;
}

const sharpOf = (a) => sharp(Buffer.from(toU8(a).buffer, 0, a.w * a.h * a.ch), { raw: { width: a.w, height: a.h, channels: a.ch } });

export const toU8 = (a) => {
  const out = new Uint8ClampedArray(a.w * a.h * a.ch);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(a.data[i] * 255);
  return out;
};

const fromU8 = (buf, w, h, ch) => {
  const out = img(w, h, ch);
  for (let i = 0; i < w * h * ch; i++) out.data[i] = buf[i] / 255;
  return out;
};

/** Gaussian blur via sharp (sigma in pixels). */
export async function blur(a, sigma) {
  const { data, info } = await sharpOf(a).blur(sigma).raw().toBuffer({ resolveWithObject: true });
  return fromU8(data, info.width, info.height, info.channels);
}

/** Resample via sharp (lanczos). */
export async function resample(a, w, h, kernel = 'lanczos3') {
  const { data, info } = await sharpOf(a).resize(w, h, { fit: 'fill', kernel }).raw().toBuffer({ resolveWithObject: true });
  return fromU8(data, info.width, info.height, info.channels);
}

export async function saveWebp(a, name, { quality = 82, alphaQuality = 90, lossless = false } = {}) {
  await ensureDirs();
  const file = path.join(OUTDIR, name);
  await sharpOf(a)
    .webp({ quality, alphaQuality, lossless, effort: 6 })
    .toFile(file);
  return file;
}

export async function savePng(a, file) {
  await sharpOf(a).png({ compressionLevel: 9 }).toFile(file);
  return file;
}

/** Write any img to webp on disk (used for the Blender out-of-band intermediates). */
export async function saveWebpTo(a, file, opts = {}) {
  await sharpOf(a).webp({ quality: 88, alphaQuality: 95, effort: 4, ...opts }).toFile(file);
  return file;
}

export const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Greyscale luminance of an RGB image as a 1-channel img. */
export function grey(a) {
  const out = img(a.w, a.h, 1);
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * a.ch;
    out.data[i] = a.ch >= 3 ? lum(a.data[o], a.data[o + 1], a.data[o + 2]) : a.data[o];
  }
  return out;
}

/** Broadcast a 1-channel image into the RGB of a new 3/4-channel image. */
export function fromGrey(g, ch = 3, alpha = null) {
  const out = img(g.w, g.h, ch);
  for (let i = 0; i < g.w * g.h; i++) {
    const v = g.data[i];
    out.data[i * ch] = v;
    out.data[i * ch + 1] = v;
    out.data[i * ch + 2] = v;
    if (ch === 4) out.data[i * ch + 3] = alpha ? alpha.data[i] : 1;
  }
  return out;
}

/**
 * Kill the low frequencies that make a tiled texture read as a pattern: subtract
 * a heavily blurred copy and re-add the mean. `sigma` is the feature size in
 * pixels above which detail is considered "big unique blotch".
 */
export async function highpass(a, sigma, { keep = 0.15 } = {}) {
  const low = await blur(a, sigma);
  const out = clone(a);
  const per = [];
  for (let c = 0; c < a.ch; c++) {
    let mean = 0;
    for (let i = 0; i < a.w * a.h; i++) mean += a.data[i * a.ch + c];
    per.push(mean / (a.w * a.h));
  }
  for (let i = 0; i < a.w * a.h; i++)
    for (let c = 0; c < a.ch; c++) {
      const v = a.data[i * a.ch + c];
      const l = low.data[i * a.ch + c];
      out.data[i * a.ch + c] = clamp01(v - (l - per[c]) + keep * (l - per[c]));
    }
  return out;
}

/** Per-channel affine remap to a target mean/std (a=0..1 domain). */
export function equalise(a, { mean = 0.5, std = 0.16, channels = [0, 1, 2], lo = 0, hi = 1 } = {}) {
  const stats = [];
  for (const c of channels) {
    let m = 0;
    for (let i = 0; i < a.w * a.h; i++) m += a.data[i * a.ch + c];
    m /= a.w * a.h;
    let v = 0;
    for (let i = 0; i < a.w * a.h; i++) v += (a.data[i * a.ch + c] - m) ** 2;
    stats.push({ m, s: Math.max(1e-5, Math.sqrt(v / (a.w * a.h))) });
  }
  const out = clone(a);
  channels.forEach((c, k) => {
    const { m, s } = stats[k];
    for (let i = 0; i < a.w * a.h; i++)
      out.data[i * a.ch + c] = clamp01(((a.data[i * a.ch + c] - m) / s) * std + mean);
  });
  return out;
}

/** Rescale one channel to [0,1] over its own min/max (optionally clipped percentiles). */
export function normaliseChannel(a, c, { lo = 0, hi = 1, out = null } = {}) {
  const dst = out ?? clone(a);
  const vals = [];
  for (let i = 0; i < a.w * a.h; i++) vals.push(a.data[i * a.ch + c]);
  vals.sort((x, y) => x - y);
  const p0 = vals[Math.floor(lo * (vals.length - 1))];
  const p1 = vals[Math.floor(hi * (vals.length - 1))];
  const k = 1 / Math.max(1e-5, p1 - p0);
  for (let i = 0; i < a.w * a.h; i++) dst.data[i * a.ch + c] = clamp01((a.data[i * a.ch + c] - p0) * k);
  return dst;
}

/**
 * Bleed the RGB of visible texels into fully transparent ones, so bilinear/mip
 * filtering never mixes a black background into the alpha edge (dark fringes).
 * Repeated dilation over the whole image; `iterations` sets the bleed width.
 */
export function dilateRGB(a, { alphaChannel = 3, iterations = 8 } = {}) {
  const { w, h, ch } = a;
  const known = new Uint8Array(w * h);
  const out = clone(a);
  for (let i = 0; i < w * h; i++) known[i] = a.data[i * ch + alphaChannel] > 0.02 ? 1 : 0;
  let frontier = [];
  for (let i = 0; i < w * h; i++) if (known[i]) frontier.push(i);
  for (let it = 0; it < iterations; it++) {
    const next = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (known[j]) continue;
        for (let c = 0; c < 3; c++) out.data[j * ch + c] = out.data[i * ch + c];
        out.data[j * ch + alphaChannel] = 0;
        known[j] = 2;
        next.push(j);
      }
    }
    for (const j of next) known[j] = 1;
    frontier = next;
    if (!frontier.length) break;
  }
  return out;
}

/** Slight extra bleed so the outermost ring is not an exact copy (kills halo edges). */
export function erodeAlpha(a, { alphaChannel = 3, radius = 1, keep = 0.55 } = {}) {
  const { w, h, ch } = a;
  const out = clone(a);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = 1;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          best = Math.min(best, a.data[(ny * w + nx) * ch + alphaChannel]);
        }
      const j = y * w + x;
      out.data[j * ch + alphaChannel] = Math.max(0, a.data[j * ch + alphaChannel] * keep + best * (1 - keep));
    }
  return out;
}

/**
 * Tangent-space normal map from a height field (1-channel img). `scale` is the
 * height amplitude relative to the pixel footprint; >1 exaggerates relief.
 */
export function normalFromHeight(height, { scale = 1.6, out = null } = {}) {
  const { w, h } = height;
  const dst = out ?? img(w, h, 3);
  const at = (x, y) => height.data[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * scale * 0.5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * scale * 0.5;
      let nx = -dx;
      let ny = dy; // +Y up in texture space
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const j = (y * w + x) * 3;
      dst.data[j] = nx * 0.5 + 0.5;
      dst.data[j + 1] = ny * 0.5 + 0.5;
      dst.data[j + 2] = nz * 0.5 + 0.5;
    }
  return dst;
}

/** Flat tangent-space normal image of the given colour (used as atlas background). */
export const flatNormal = (w, h, r = 0.5, g = 0.5, b = 1) => {
  const out = img(w, h, 3);
  for (let i = 0; i < w * h; i++) {
    out.data[i * 3] = r;
    out.data[i * 3 + 1] = g;
    out.data[i * 3 + 2] = b;
  }
  return out;
};

/** Statistics of one channel, for reporting in the manifest. */
export function stats(a, c = 0) {
  let m = 0;
  let mn = 1;
  let mx = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const v = a.data[i * a.ch + c];
    m += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  m /= a.w * a.h;
  let v = 0;
  for (let i = 0; i < a.w * a.h; i++) v += (a.data[i * a.ch + c] - m) ** 2;
  return { mean: m, min: mn, max: mx, std: Math.sqrt(v / (a.w * a.h)) };
}
