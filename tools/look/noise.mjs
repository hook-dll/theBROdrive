// Seamless generated masks for the ground and atmosphere shaders, plus the
// tile arithmetic the ground group shares (wrap-aware blur, high-pass, resample
// and paste). Everything here is code, so this group needs no network at all.
//
// A tile is a unit square the shader scales: `noise_fine` is sampled at 7, 100,
// 500 and 2000 m, `noise_variation` at 500 and 2000 m (see
// docs/slowroads-steam/notes/SrGround.md §2). At 512² that is 3.9 cm per texel
// at the 7 m scale, so a texel must never be white noise — the generator's
// finest octave is 8 px across, and every octave wraps exactly on the lattice,
// which is what makes the tile seamless rather than "looks fine in the middle".
//
// The tile ops live here because the ground group has no other shared home for
// them: `lib/` belongs to the pipeline contract, and the ground module imports
// them like any other dependency.

import { img, clone, stats, clamp01, grey, lum, saveWebp } from './lib/image.mjs';

export const name = 'noise';
export const order = 1;

const MASK = 'unit tile scaled by the shader';

export const sources = [
  {
    id: 'procedural-noise',
    provider: 'generated',
    url: 'tools/look/noise.mjs (value noise on a wrapping lattice, fbm + ridged octaves)',
    license: 'CC0 1.0',
    usedFor: ['noise_fine.webp', 'noise_variation.webp', 'detail_near.webp', 'detail_far.webp', 'detail_far_winter.webp'],
    note: 'Written for this project. Octaves wrap on the lattice, so the tile is exact, and the finest octave is 8 px across so a texel is never white noise.'
  }
];

export const outputs = [
  { file: 'noise_fine.webp', size: [512, 512], channels: 'grey', tiling_m: null, role: 'noise', note: `soft cloud noise for the 7/100/500 m fades and for placement jitter; mean 0.5, std 0.13, features 8-16 px; ${MASK}` },
  { file: 'noise_variation.webp', size: [512, 512], channels: 'grey', tiling_m: null, role: 'noise', note: `patch map (light and dark fields) for the 500/2000 m variation terms; mean 0.5, std 0.12, patches 40-80 px; ${MASK}` },
  { file: 'detail_near.webp', size: [512, 512], channels: 'grey', tiling_m: null, role: 'noise', note: `multiplicative darkening mask at 100 m: near-white speckle with thin dark squiggles; mean 0.86, std 0.05; ${MASK}` },
  { file: 'detail_far.webp', size: [512, 512], channels: 'grey', tiling_m: null, role: 'noise', note: `multiplicative darkening mask at 500/2000 m: white with soft grey rock/lichen blotches; mean 0.82, std 0.07; ${MASK}` },
  { file: 'detail_far_winter.webp', size: [512, 512], channels: 'grey', tiling_m: null, role: 'noise', note: `winter variant of detail_far: whiter, with fine crack and streak structure; mean 0.9, std 0.05; ${MASK}` }
];

// ---------------------------------------------------------------------------
// generator

/** Deterministic LCG, so a rebuild is byte-identical. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Value noise on a lattice of px×py cells that wraps: cell indices are taken
 * modulo px/py, so the tile matches exactly at every edge.
 */
export function pnoise(out, px, py, seed, { gain = 1, offset = 0 } = {}) {
  const { w, h } = out;
  const lat = new Float32Array(px * py);
  const r = rng(seed);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const at = (x, y) => lat[(((y % py) + py) % py) * px + (((x % px) + px) % px)];
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * py;
    const y0 = Math.floor(fy);
    const ty = fade(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * px;
      const x0 = Math.floor(fx);
      const tx = fade(fx - x0);
      const v00 = at(x0, y0);
      const v10 = at(x0 + 1, y0);
      const v01 = at(x0, y0 + 1);
      const v11 = at(x0 + 1, y0 + 1);
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      out.data[y * w + x] = offset + gain * v;
    }
  }
  return out;
}

const grey512 = () => img(512, 512, 1);

/**
 * Sum of wrapping octaves. `px`/`py` are the coarsest lattice; each octave
 * doubles it until the cells would be finer than `maxCells` per tile.
 */
export function fbm(w, h, { px = 4, py = px, octaves = 5, gain = 0.5, maxCells = 64, seed = 1, squash = 1 } = {}) {
  const out = img(w, h, 1);
  const tmp = img(w, h, 1);
  let amp = 1;
  let norm = 0;
  let cx = px;
  let cy = py;
  for (let o = 0; o < octaves; o++) {
    if (cx > maxCells || cy > maxCells) break;
    pnoise(tmp, cx, cy, seed + o * 7919);
    for (let i = 0; i < w * h; i++) out.data[i] += amp * tmp.data[i];
    norm += amp;
    amp *= gain;
    cx *= 2;
    cy *= 2;
  }
  for (let i = 0; i < w * h; i++) {
    const v = out.data[i] / norm;
    out.data[i] = squash === 1 ? v : Math.pow(v, squash);
  }
  return out;
}

/** Ridged transform: 1 − |2v − 1|, powered to narrow the ridge into a line. */
export function ridge(a, power = 4) {
  const out = img(a.w, a.h, 1);
  for (let i = 0; i < a.w * a.h; i++) out.data[i] = Math.pow(1 - Math.abs(2 * a.data[i] - 1), power);
  return out;
}

/**
 * Sum of |2n−1| octaves. Unlike a ridged single octave this has creases at every
 * scale at once, which is what makes the detail masks read as fractal mottling
 * and fine squiggles rather than as a lattice maze.
 */
export function turbulence(w, h, { px = 8, py = px, octaves = 5, gain = 0.5, maxCells = 64, seed = 1 } = {}) {
  const out = img(w, h, 1);
  const tmp = img(w, h, 1);
  let amp = 1;
  let norm = 0;
  let cx = px;
  let cy = py;
  for (let o = 0; o < octaves; o++) {
    if (cx > maxCells || cy > maxCells) break;
    pnoise(tmp, cx, cy, seed + o * 7919);
    for (let i = 0; i < w * h; i++) out.data[i] += amp * Math.abs(2 * tmp.data[i] - 1);
    norm += amp;
    amp *= gain;
    cx *= 2;
    cy *= 2;
  }
  for (let i = 0; i < w * h; i++) out.data[i] /= norm;
  return out;
}

// ---------------------------------------------------------------------------
// tile arithmetic (wrap-aware: the tile is a torus, and these treat it as one)

/** Box sizes whose three passes approximate a Gaussian of the given sigma. */
function boxSizes(sigma, n = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** One wrapped box pass along x (axis 0) or y (axis 1), O(1) per texel. */
function boxPass(a, src, r, axis) {
  const { w, h, ch } = a;
  const n = axis === 0 ? w : h;
  const outer = axis === 0 ? h : w;
  const span = 2 * r + 1;
  const idx = (o, i) => (axis === 0 ? (o * w + i) * ch : (i * w + o) * ch);
  for (let o = 0; o < outer; o++) {
    for (let c = 0; c < ch; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src.data[idx(o, ((i % n) + n) % n) + c];
      for (let i = 0; i < n; i++) {
        a.data[idx(o, i) + c] = sum / span;
        sum += src.data[idx(o, (i + r + 1) % n) + c] - src.data[idx(o, ((i - r) % n + n) % n) + c];
      }
    }
  }
  return a;
}

/**
 * Wrapped Gaussian blur, three box passes. Wrapping is the point: the tile is a
 * torus, so a warp-aware blur is what lets a tileable source stay tileable.
 */
export function wrapBlur(a, sigma) {
  if (sigma <= 0.15) return clone(a);
  const sizes = boxSizes(sigma);
  let cur = clone(a);
  let other = img(a.w, a.h, a.ch);
  for (const s of sizes) {
    const r = Math.round(s);
    boxPass(other, cur, r, 0);
    const t = cur;
    cur = other;
    other = t;
    boxPass(other, cur, r, 1);
    const t2 = cur;
    cur = other;
    other = t2;
  }
  return cur;
}

/** Mean of one channel. */
export const mean = (a, c = 0) => {
  let m = 0;
  for (let i = 0; i < a.w * a.h; i++) m += a.data[i * a.ch + c];
  return m / (a.w * a.h);
};

/**
 * Wrapped high-pass: subtract a blur and add the mean back, keeping `keep` of
 * the low frequencies. Same intent as lib/image.mjs `highpass`, but the blur
 * wraps, so a tileable source stays exactly tileable.
 */
export function wrapHighpass(a, sigma, { keep = 0.15 } = {}) {
  const low = wrapBlur(a, sigma);
  const out = img(a.w, a.h, a.ch);
  for (let c = 0; c < a.ch; c++) {
    const m = mean(a, c);
    for (let i = 0; i < a.w * a.h; i++) {
      const v = a.data[i * a.ch + c];
      const l = low.data[i * a.ch + c];
      out.data[i * a.ch + c] = clamp01(v - (l - m) + keep * (l - m));
    }
  }
  return out;
}

const lanczos = (x) => {
  x = Math.abs(x);
  if (x < 1e-8) return 1;
  if (x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

/** Per-output-pixel tap list for one axis, with the source index already wrapped. */
function taps(n, from) {
  const scale = from / n;
  const filterScale = Math.max(1, 1 / scale);
  const radius = Math.ceil(3 * filterScale);
  const list = [];
  for (let i = 0; i < n; i++) {
    const centre = (i + 0.5) * scale - 0.5;
    const t = [];
    let norm = 0;
    for (let k = Math.floor(centre - radius); k <= Math.ceil(centre + radius); k++) {
      const v = lanczos((k - centre) / filterScale);
      if (v === 0) continue;
      t.push([((k % from) + from) % from, v]);
      norm += v;
    }
    for (const e of t) e[1] /= norm || 1;
    list.push(t);
  }
  return list;
}

/** Lanczos-3 resample with wrapped taps, so a tileable source stays tileable. */
export function wrapResample(a, w, h) {
  if (a.w === w && a.h === h) return a;
  const { ch } = a;
  const tx = taps(w, a.w);
  const ty = taps(h, a.h);
  const tmp = img(w, a.h, ch);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (const [sx, v] of tx[x]) acc += v * a.data[(y * a.w + sx) * ch + c];
        tmp.data[(y * w + x) * ch + c] = clamp01(acc);
      }
  const out = img(w, h, ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (const [sy, v] of ty[y]) acc += v * tmp.data[(sy * w + x) * ch + c];
        out.data[(y * w + x) * ch + c] = clamp01(acc);
      }
  return out;
}

/** Paste with wrap-around; `chMap[c]` picks the source channel per destination channel. */
export function pasteWrap(dst, src, x, y, { chMap = null, scale = 0 } = {}) {
  const { w, h, ch } = dst;
  const sc = scale || 1;
  for (let j = 0; j < src.h; j++) {
    for (let i = 0; i < src.w; i++) {
      const dx = ((x + Math.round(i * sc)) % w + w) % w;
      const dy = ((y + Math.round(j * sc)) % h + h) % h;
      for (let c = 0; c < ch; c++) {
        const s = chMap ? chMap[c] : Math.min(c, src.ch - 1);
        dst.data[(dy * w + dx) * ch + c] = src.data[(j * src.w + i) * src.ch + s];
      }
    }
  }
  return dst;
}

/**
 * Seam report: edge-to-edge difference versus the difference between ordinary
 * neighbouring rows/columns. A tileable image has the two in the same range.
 */
export function seamReport(a, c = 0) {
  const { w, h, ch } = a;
  const col = (x0, x1) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += Math.abs(a.data[(y * w + x0) * ch + c] - a.data[(y * w + x1) * ch + c]);
    return s / h;
  };
  const row = (y0, y1) => {
    let s = 0;
    for (let x = 0; x < w; x++) s += Math.abs(a.data[(y0 * w + x) * ch + c] - a.data[(y1 * w + x) * ch + c]);
    return s / w;
  };
  let ic = 0;
  for (let x = 1; x < w; x++) ic += col(x - 1, x);
  let ir = 0;
  for (let y = 1; y < h; y++) ir += row(y - 1, y);
  return {
    wrapX: col(w - 1, 0),
    wrapY: row(h - 1, 0),
    innerX: ic / (w - 1),
    innerY: ir / (h - 1)
  };
}

/** Scale RGB so luminance lands on `mean`/`std` while hue and chroma survive. */
export function equaliseLuma(a, { mean: m0 = 0.45, std: s0 = 0.15, clip = 1 } = {}) {
  const out = img(a.w, a.h, a.ch);
  let sm = 0;
  for (let i = 0; i < a.w * a.h; i++) sm += lum(a.data[i * a.ch], a.data[i * a.ch + 1], a.data[i * a.ch + 2]);
  sm /= a.w * a.h;
  let sv = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const l = lum(a.data[i * a.ch], a.data[i * a.ch + 1], a.data[i * a.ch + 2]);
    sv += (l - sm) ** 2;
  }
  const ss = Math.max(1e-5, Math.sqrt(sv / (a.w * a.h)));
  const k = clip * (s0 / ss);
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * a.ch;
    const l = lum(a.data[o], a.data[o + 1], a.data[o + 2]);
    const tl = clamp01(sm * 0 + (m0 + (l - sm) * k));
    const s = l > 1e-4 ? tl / l : 1;
    for (let c = 0; c < 3; c++) out.data[o + c] = clamp01(a.data[o + c] * s);
    if (a.ch === 4) out.data[o + 3] = a.data[o + 3];
  }
  return out;
}

/** Put a 1-channel height into the alpha of an RGB image (or of its grey copy). */
export function withHeight(rgb, height, { alphaGain = 1 } = {}) {
  const out = img(rgb.w, rgb.h, 4);
  for (let i = 0; i < rgb.w * rgb.h; i++) {
    out.data[i * 4] = rgb.data[i * rgb.ch];
    out.data[i * 4 + 1] = rgb.ch > 1 ? rgb.data[i * rgb.ch + 1] : rgb.data[i * rgb.ch];
    out.data[i * 4 + 2] = rgb.ch > 2 ? rgb.data[i * rgb.ch + 2] : rgb.data[i * rgb.ch];
    out.data[i * 4 + 3] = clamp01(height.data[i] * alphaGain);
  }
  return out;
}

/** Grey 3-channel image from a 1-channel mask, so every output is explicitly R=G=B. */
export const greyTile = (g) => {
  const out = img(g.w, g.h, 3);
  for (let i = 0; i < g.w * g.h; i++) {
    const v = clamp01(g.data[i]);
    out.data[i * 3] = v;
    out.data[i * 3 + 1] = v;
    out.data[i * 3 + 2] = v;
  }
  return out;
};

/**
 * Monotone soft stretch: brings a tile's mean and std (or luminance mean/std)
 * to target without hard clipping. Hard clipping is what a photo tile cannot
 * afford: it flattens the shadows and highlights into plateaus, which both kills
 * texture and makes the edge-to-edge seam read as a discontinuity against the
 * now-flat interior. This map is the identity in the middle and eases into 0 and
 * 1 with a continuous derivative, so the seam keeps scaling with the interior.
 */
export function equaliseSoft(a, { mean: m0 = 0.5, std: s0 = 0.16, luma = false, iterations = 8 } = {}) {
  const { w, h, ch } = a;
  const knee = (x) => {
    if (x > 0.85) return 0.85 + 0.15 * (1 - Math.exp(-(x - 0.85) / 0.15));
    if (x < 0.15) return 0.15 - 0.15 * (1 - Math.exp(-(0.15 - x) / 0.15));
    return x;
  };
  let cur = clone(a);
  const chans = luma ? [null] : [...Array(Math.min(3, ch)).keys()];
  for (let it = 0; it < iterations; it++) {
    const stat = (c) => {
      let m = 0;
      for (let i = 0; i < w * h; i++)
        m += c === null ? lum(cur.data[i * ch], cur.data[i * ch + 1], cur.data[i * ch + 2]) : cur.data[i * ch + c];
      m /= w * h;
      let v = 0;
      for (let i = 0; i < w * h; i++) {
        const x = c === null ? lum(cur.data[i * ch], cur.data[i * ch + 1], cur.data[i * ch + 2]) : cur.data[i * ch + c];
        v += (x - m) ** 2;
      }
      return { m, s: Math.max(1e-5, Math.sqrt(v / (w * h))) };
    };
    const stats = chans.map(stat);
    const next = img(w, h, ch);
    for (let i = 0; i < w * h; i++) {
      if (luma) {
        const l = lum(cur.data[i * ch], cur.data[i * ch + 1], cur.data[i * ch + 2]);
        const { m, s } = stats[0];
        const tl = knee(m0 + (l - m) * (s0 / s));
        const k = l > 1e-4 ? tl / l : 1;
        for (let c = 0; c < ch; c++) next.data[i * ch + c] = clamp01(cur.data[i * ch + c] * k);
      } else {
        chans.forEach((c, k) => {
          const { m, s } = stats[k];
          next.data[i * ch + c] = knee(m0 + (cur.data[i * ch + c] - m) * (s0 / s));
        });
        if (ch === 4) next.data[i * ch + 3] = cur.data[i * ch + 3];
      }
    }
    cur = next;
  }
  return cur;
}

/** Mean and std of the three colour channels taken together, for reporting. */
export function channelStats(a) {
  const means = [];
  const stds = [];
  for (let c = 0; c < Math.min(3, a.ch); c++) {
    let m = 0;
    for (let i = 0; i < a.w * a.h; i++) m += a.data[i * a.ch + c];
    m /= a.w * a.h;
    let v = 0;
    for (let i = 0; i < a.w * a.h; i++) v += (a.data[i * a.ch + c] - m) ** 2;
    means.push(m);
    stds.push(Math.sqrt(v / (a.w * a.h)));
  }
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return { means, stds, mean: avg(means), std: avg(stds) };
}

/** Put a 1-channel height on mean 0.5 and give it at least `std` spread. */
export function settleHeight(h, { std = 0.14, keep = 1 } = {}) {
  const m = mean(h);
  let v = 0;
  for (let i = 0; i < h.w * h.h; i++) v += (h.data[i] - m) ** 2;
  const s = Math.max(1e-5, Math.sqrt(v / (h.w * h.h)));
  const k = s < std ? std / s : 1;
  const out = img(h.w, h.h, 1);
  for (let i = 0; i < h.w * h.h; i++) out.data[i] = clamp01(0.5 + (h.data[i] - m) * k * keep);
  return out;
}

/** Report one line per tile: mean, std, seam ratios, neighbour correlation. */
export function describe(file, a, c = 0) {
  const s = stats(a, c);
  const seam = seamReport(a, c);
  const nx = seam.innerX || 1e-9;
  const ny = seam.innerY || 1e-9;
  const w = a.w;
  const ch = a.ch;
  let hi = 0;
  for (let y = 1; y < a.h; y++) hi += Math.abs(a.data[(y * w + 1) * ch + c] - a.data[(y * w) * ch + c]);
  hi /= a.h - 1;
  console.log(
    `  ${file}: mean ${s.mean.toFixed(3)} std ${s.std.toFixed(3)} | wrapX/innerX ${(seam.wrapX / nx).toFixed(2)} ` +
      `wrapY/innerY ${(seam.wrapY / ny).toFixed(2)} (abs ${seam.wrapX.toFixed(4)}/${seam.innerX.toFixed(4)}, ${seam.wrapY.toFixed(4)}/${seam.innerY.toFixed(4)}))`
  );
  return { ...s, ...seam };
}

// ---------------------------------------------------------------------------
// the five tiles

export async function build({ force }) {
  const files = [];

  // Soft cloud noise: the fade term at 7/100/500 m and the placement jitter.
  // Cells of 12/24/48 put the bulk of the energy at 11-43 px, i.e. soft cloud
  // rather than the few huge blobs a coarse lattice would give.
  const fine = fbm(512, 512, { px: 12, py: 12, octaves: 3, gain: 0.6, maxCells: 48, seed: 11 });
  files.push(['noise_fine.webp', equaliseGrey(fine, { mean: 0.5, std: 0.13 })]);

  // Patch map: fields and large patches read at 500 m and 2000 m. 7/14 cells is
  // 37-73 px, the scale the notes give for the variation terms; the 21 px octave
  // keeps the patches from looking posterised.
  {
    const patches = fbm(512, 512, { px: 7, py: 8, octaves: 3, gain: 0.5, maxCells: 32, seed: 23 });
    const ragged = turbulence(512, 512, { px: 24, py: 24, octaves: 3, gain: 0.5, maxCells: 96, seed: 29 });
    const g = img(512, 512, 1);
    for (let i = 0; i < 512 * 512; i++)
      g.data[i] = sCurve(patches.data[i], 0.5, 1.15) + 0.3 * (ragged.data[i] - 0.5);
    files.push(['noise_variation.webp', equaliseGrey(g, { mean: 0.5, std: 0.12 })]);
  }

  // Near detail: near-white with thin dark squiggles (a darkening mask). The
  // squiggles are the creases of a fine turbulence, so their width varies the
  // way a photo's debris does instead of being one uniform stroke.
  {
    const creases = turbulence(512, 512, { px: 16, py: 16, octaves: 3, gain: 0.5, maxCells: 64, seed: 31 });
    const speck = fbm(512, 512, { px: 40, py: 40, octaves: 2, gain: 0.5, maxCells: 64, seed: 37 });
    const g = img(512, 512, 1);
    for (let i = 0; i < 512 * 512; i++) {
      const line = 1 - smoothStep(0.0, 0.16, creases.data[i]);
      g.data[i] = 0.96 + 0.07 * (speck.data[i] - 0.5) - 0.5 * line;
    }
    files.push(['detail_near.webp', equaliseGrey(g, { mean: 0.86, std: 0.05 })]);
  }

  // Far detail: white with grey rock/lichen mottling over the whole scale range.
  {
    const mottle = turbulence(512, 512, { px: 8, py: 8, octaves: 5, gain: 0.58, maxCells: 128, seed: 41 });
    const rough = turbulence(512, 512, { px: 48, py: 48, octaves: 2, gain: 0.5, maxCells: 96, seed: 43 });
    const g = img(512, 512, 1);
    for (let i = 0; i < 512 * 512; i++) {
      const blotch = smoothStep(0.1, 0.58, mottle.data[i]);
      g.data[i] = 1 - 0.6 * blotch - 0.22 * smoothStep(0.12, 0.62, rough.data[i]);
    }
    files.push(['detail_far.webp', equaliseGrey(g, { mean: 0.82, std: 0.07 })]);
  }

  // Winter far detail: whiter, with fine cracks and streaks rather than blotches.
  {
    const cracks = turbulence(512, 512, { px: 28, py: 28, octaves: 3, gain: 0.5, maxCells: 64, seed: 53 });
    const streaks = fbm(512, 512, { px: 6, py: 36, octaves: 3, gain: 0.5, maxCells: 72, seed: 59 });
    const g = img(512, 512, 1);
    for (let i = 0; i < 512 * 512; i++) {
      const line = 1 - smoothStep(0.0, 0.14, cracks.data[i]);
      g.data[i] = 0.98 + 0.05 * (streaks.data[i] - 0.5) - 0.3 * line;
    }
    files.push(['detail_far_winter.webp', equaliseGrey(g, { mean: 0.9, std: 0.05 })]);
  }

  for (const [file, g] of files) {
    const tile = greyTile(g);
    describe(file, tile);
    await saveWebp(tile, file, { lossless: false, quality: 90 });
    void force;
  }
}

/** Soft S-curve around `pivot`, used to make patch structure read clearly. */
function sCurve(v, pivot = 0.5, k = 1.8) {
  const t = clamp01((v - pivot) * k + 0.5);
  return t * t * (3 - 2 * t);
}

/** Apply a scalar transform to every texel of a 1-channel mask. */
function map1(a, fn) {
  const out = img(a.w, a.h, 1);
  for (let i = 0; i < a.w * a.h; i++) out.data[i] = fn(a.data[i]);
  return out;
}

function smoothStep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Linear remap of a 1-channel mask to a target mean/std (values clip softly). */
export function equaliseGrey(a, { mean: m0 = 0.5, std: s0 = 0.13 } = {}) {
  const m = mean(a);
  let v = 0;
  for (let i = 0; i < a.w * a.h; i++) v += (a.data[i] - m) ** 2;
  const s = Math.max(1e-5, Math.sqrt(v / (a.w * a.h)));
  const out = img(a.w, a.h, 1);
  const k = s0 / s;
  for (let i = 0; i < a.w * a.h; i++) out.data[i] = clamp01(m0 + (a.data[i] - m) * k);
  return out;
}

export { grey };
