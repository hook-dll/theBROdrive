// Road tiles: worn asphalt, the two seasonal overlays and packed snow.
//
// All four are 1024x2048 with u across the carriageway and v along the road, so
// the mesh advances v by one repeat per 24 m of road. u is not a tiling axis —
// it spans the carriageway exactly once, from one crumbling edge to the other
// (the material's alphaTest 0.75 cuts the carriageway out of the verge, and the
// terrain's gravel band underneath shows through the rag).
//
// Everything wrap-sensitive here is written wrap-aware on purpose: the noise is
// a wrapped lattice, the blurs and the RGB bleed carry their window across the
// v edge, and every scatter wraps. That is what makes the numeric seam check in
// `report` meaningful rather than an average over a heap of edge artefacts.

import path from 'node:path';
import {
  img, clone, loadImage, grey, saveWebp, stats,
  clamp01, mix, smoothstep, lum
} from './lib/image.mjs';
import { obtain, firstExisting, exists, OUTDIR } from './lib/util.mjs';

export const name = 'road';
export const order = 3;

const W = 1024;
const H = 2048;
const U_SPAN = 7; // metres across the carriageway
const V_SPAN = 24; // metres of road per v repeat

const ph = (id, map = 'diff', res = '1k') =>
  `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${res}/${id}/${id}_${map}_${res}.jpg`;
const ag = (id) => `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;

export const sources = [
  {
    id: 'worn_asphalt',
    provider: 'Poly Haven',
    url: ph('worn_asphalt'),
    license: 'CC0 1.0',
    usedFor: ['road_asphalt.webp', 'road_snow.webp'],
    note: 'coarse brown chip-seal aggregate; the base grain on the crown side of the cross-fade, and the wet-asphalt patches worn through the snow'
  },
  {
    id: 'asphalt_02',
    provider: 'Poly Haven',
    url: ph('asphalt_02'),
    license: 'CC0 1.0',
    usedFor: ['road_asphalt.webp'],
    note: 'grey gritty asphalt with a longitudinal fatigue crack — the crack is kept and lands in the left wheel path'
  },
  {
    id: 'road_damaged_clean',
    provider: 'Poly Haven',
    url: ph('road_damaged_clean'),
    license: 'CC0 1.0',
    usedFor: ['road_asphalt.webp', 'road_snow.webp'],
    note: 'brown dusty asphalt — the coarser dirt strip along the edges and the grit speckle in the snow ruts'
  },
  {
    id: 'road_damaged',
    provider: 'Poly Haven',
    url: ph('road_damaged'),
    license: 'CC0 1.0',
    usedFor: ['road_asphalt.webp'],
    note: 'worn pavement — the coarser, dirtier strip along the crown of the road'
  },
  {
    id: 'Asphalt026C',
    provider: 'ambientCG',
    url: ag('Asphalt026C'),
    license: 'CC0 1.0',
    usedFor: ['road_asphalt.webp'],
    note: 'dark tarred asphalt; its blurred blotches darken the whole tile into an aged black-grey'
  },
  {
    id: 'snow_02',
    provider: 'Poly Haven',
    url: ph('snow_02'),
    license: 'CC0 1.0',
    usedFor: ['road_snow.webp'],
    note: 'soft packed snow with faint scuffs — the main snow base'
  },
  {
    id: 'snow_03',
    provider: 'Poly Haven',
    url: ph('snow_03'),
    license: 'CC0 1.0',
    usedFor: ['road_snow.webp'],
    note: 'granular trampled snow — the crumbs the plough leaves along the edges'
  },
  {
    id: 'snow_floor',
    provider: 'Poly Haven',
    url: ph('snow_floor'),
    license: 'CC0 1.0',
    usedFor: ['road_snow.webp'],
    note: 'thin snow dusted over asphalt — the patches worn through to the tarmac'
  },
  {
    id: 'Snow010A',
    provider: 'ambientCG',
    url: ag('Snow010A'),
    license: 'CC0 1.0',
    usedFor: ['road_snow.webp'],
    note: 'smooth bluish wind-packed snow, cross-faded with snow_02 to break up the largest blobs; its displacement map supplies the fine crust grain'
  },
  {
    id: 'Grass004',
    provider: 'ambientCG',
    url: ag('Grass004'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_spring.webp'],
    note: 'green lawn close-up; its displacement map is the blade mask that cuts the tufts out'
  },
  {
    id: 'Moss003',
    provider: 'ambientCG',
    url: ag('Moss003'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_spring.webp'],
    note: 'moss cushion close-up; the streaks that creep into the wheel-track cracks'
  },
  {
    id: 'leaves_forest_ground',
    provider: 'Poly Haven',
    url: ph('leaves_forest_ground'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_autumn.webp'],
    note: 'whole orange and yellow leaves over grey litter — the carpet along the edges'
  },
  {
    id: 'ScatteredLeaves009',
    provider: 'ambientCG',
    url: ag('ScatteredLeaves009'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_autumn.webp'],
    note: 'dense dry yellow-brown leaf carpet, the second litter layer'
  },
  {
    id: 'ScatteredLeaves007',
    provider: 'ambientCG',
    url: ag('ScatteredLeaves007'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_autumn.webp'],
    note: 'large whole leaves shot on black — cut out one by one as the big species'
  },
  {
    id: 'ScatteredLeaves005',
    provider: 'ambientCG',
    url: ag('ScatteredLeaves005'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_autumn.webp'],
    note: 'small whole leaves on black — the small species'
  },
  {
    id: 'ScatteredLeaves006',
    provider: 'ambientCG',
    url: ag('ScatteredLeaves006'),
    license: 'CC0 1.0',
    usedFor: ['road_overlay_autumn.webp'],
    note: 'red-brown leaves on black — the third species'
  },
  {
    id: 'procedural',
    provider: 'generated',
    url: 'noise and structure written in tools/look/road.mjs (wrapped-lattice value noise, wheel paths, patch seams, plough edge, ragged alpha)',
    license: 'CC0 1.0',
    usedFor: ['road_asphalt.webp', 'road_overlay_spring.webp', 'road_overlay_autumn.webp', 'road_snow.webp'],
    note: 'geometry that a photograph cannot carry: the cross-road profile, the tyre paths at u=0.28/0.72 and the crumbling alpha edge'
  }
];

export const outputs = [
  {
    file: 'road_asphalt.webp',
    size: [W, H],
    channels: 'RGB + A(edge mask)',
    tiling_m: V_SPAN,
    uSpan_m: U_SPAN,
    role: 'road',
    note: 'aged black-grey chip-seal asphalt, polished darker wheel paths at u=0.28/0.72, crown-to-edge grade, two tar-seamed repair patches, one longitudinal crack per wheel path; A=1 over the carriageway, ragged crumb edge whose 0.75 contour sits ~1.4 % in from the mesh edge. v tiles every 24 m, u spans 7 m once'
  },
  {
    file: 'road_overlay_spring.webp',
    size: [W, H],
    channels: 'RGB + A(coverage)',
    tiling_m: V_SPAN,
    uSpan_m: U_SPAN,
    role: 'road_overlay',
    note: 'fresh moss and young grass creeping in from both edges (pairs of tufts, cut from Grass004 by its blade mask) plus thin moss in the wheel-track cracks; the crown stays clear. Coverage is measured to match the slowroads overlay'
  },
  {
    file: 'road_overlay_autumn.webp',
    size: [W, H],
    channels: 'RGB + A(coverage)',
    tiling_m: V_SPAN,
    uSpan_m: U_SPAN,
    role: 'road_overlay',
    note: 'fallen birch/aspen/oak leaves: three cut-out species scattered over a litter carpet, densest along both edges and in the wheel tracks, thin on the crown. Warm yellow-ochre-orange-brown aimed at the owner autumn-forest photograph'
  },
  {
    file: 'road_snow.webp',
    size: [W, H],
    channels: 'RGB + A(edge mask)',
    tiling_m: V_SPAN,
    uSpan_m: U_SPAN,
    role: 'road',
    note: 'pressed bluish-white snow with two polished tyre ruts, grit speckle, patches worn through to wet asphalt and plough crumbs along the edges; A is the same ragged edge mask as the asphalt, so the winter road crumbles into the verge the same way'
  }
];

/* ------------------------------------------------------------------ maths */

const TAU = Math.PI * 2;
const wrapIndex = (i, n) => ((i % n) + n) % n;
const sm = (t) => t * t * (3 - 2 * t);

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice that wraps every `freq` cells, so u,v in [0,1) tile. */
function noise2(u, v, freq, seed) {
  const x = u * freq;
  const y = v * freq;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = sm(x - x0);
  const fy = sm(y - y0);
  const a = hash2(wrapIndex(x0, freq), wrapIndex(y0, freq), seed);
  const b = hash2(wrapIndex(x0 + 1, freq), wrapIndex(y0, freq), seed);
  const c = hash2(wrapIndex(x0, freq), wrapIndex(y0 + 1, freq), seed);
  const d = hash2(wrapIndex(x0 + 1, freq), wrapIndex(y0 + 1, freq), seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function fbm2(u, v, freq, octaves, seed) {
  let sum = 0;
  let total = 0;
  let amp = 1;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(u, v, f, seed + o * 977);
    total += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / total;
}

/** Periodic 1-D noise, for anything that only varies along v. */
function fbm1(t, cells, octaves, seed) {
  let sum = 0;
  let total = 0;
  let amp = 1;
  let f = cells;
  for (let o = 0; o < octaves; o++) {
    const x = t * f;
    const x0 = Math.floor(x);
    const fx = sm(x - x0);
    const a = hash2(wrapIndex(x0, f), 0, seed + o * 613);
    const b = hash2(wrapIndex(x0 + 1, f), 0, seed + o * 613);
    sum += amp * mix(a, b, fx);
    total += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / total;
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ------------------------------------------------------- image utilities */

const px = (a, u, v, c) => a.data[(wrapIndex(Math.floor(v * a.h), a.h) * a.w + wrapIndex(Math.floor(u * a.w), a.w)) * a.ch + (a.ch === 1 ? 0 : Math.min(c, a.ch - 1))];

/** Fill with fn(u,v) -> number | [..channels]. */
function fill(w, h, ch, fn) {
  const out = img(w, h, ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fn((x + 0.5) / w, (y + 0.5) / h, x, y);
      const o = (y * w + x) * ch;
      if (typeof v === 'number') for (let c = 0; c < ch; c++) out.data[o + c] = v;
      else for (let c = 0; c < ch; c++) out.data[o + c] = v[c];
    }
  return out;
}

const mask = (w, h, fn) => fill(w, h, 1, fn);

/** Per-pixel RGB rewrite; alpha and the channel count survive. */
function mapRGB(a, fn) {
  const out = clone(a);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const o = (y * a.w + x) * a.ch;
      const c = fn(a.data[o], a.data[o + 1], a.data[o + 2], (x + 0.5) / a.w, (y + 0.5) / a.h);
      out.data[o] = c[0];
      out.data[o + 1] = c[1];
      out.data[o + 2] = c[2];
    }
  return out;
}

/** out = a*(1-w) + b*w, with w a number, fn(u,v) or a 1-channel image; b may be a constant triple. */
function blend(a, b, w, { channels = 3 } = {}) {
  const out = img(a.w, a.h, a.ch);
  const num = typeof w === 'number';
  const fn = typeof w === 'function';
  const isTriple = Array.isArray(b);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const o = (y * a.w + x) * a.ch;
      const k = num ? w : clamp01(fn ? w((x + 0.5) / a.w, (y + 0.5) / a.h) : w.data[y * a.w + x]);
      for (let c = 0; c < channels; c++) {
        const bv = isTriple ? b[c] : b.ch === 1 ? b.data[y * a.w + x] : b.data[o + c];
        out.data[o + c] = a.data[o + c] * (1 - k) + bv * k;
      }
      for (let c = channels; c < a.ch; c++) out.data[o + c] = a.data[o + c];
    }
  return out;
}

const scaleRGB = (a, fn) => mapRGB(a, (r, g, b, u, v) => {
  const k = fn(u, v);
  return [r * k, g * k, b * k];
});

/**
 * Wrap-aware separable box blur. The lib's blur goes through sharp, whose
 * border handling breaks the v wrap we promise in the manifest — this one
 * carries its window around the edge instead.
 */
/**
 * Repeat a square source along v at 1:1, so a source texel stays one output
 * texel. Stretching the photograph instead (2x over the same source) halves the
 * grain's gradient along the road: measured against slowroads' own base the
 * tile then reads as smeared lengthwise. Repeating it keeps the grain the same
 * shape on the card, at the price of a 12 m grain sub-repeat inside the 24 m
 * tile — slowroads' whole road base repeats every 7.4 m.
 */
function tileV(a, w, h, phase = 0) {
  for (const p of [w, h]) if (!Number.isInteger(p)) throw new Error('tileV wants integer sizes');
  const out = img(w, h, a.ch);
  const sy = a.h / h;
  for (let y = 0; y < h; y++) {
    const row = wrapIndex(Math.floor(y * sy + phase), a.h);
    for (let x = 0; x < w; x++) {
      const sx = Math.min(a.w - 1, Math.floor((x * a.w) / w));
      const o = (y * w + x) * out.ch;
      const i = (row * a.w + sx) * a.ch;
      for (let c = 0; c < a.ch; c++) out.data[o + c] = a.data[i + c];
    }
  }
  return out;
}

/**
 * Resample with the v axis wrapped and u clamped. sharp's resize clamps at the
 * border, which would put a real discontinuity on the v join of every tile we
 * build by stretching a square 1K source to 1024x2048.
 */
function stretch(a, w, h) {
  const out = img(w, h, a.ch);
  const sx = a.w / w;
  const sy = a.h / h;
  for (let y = 0; y < h; y++) {
    const fy0 = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(fy0);
    const ty = fy0 - y0;
    const ya = wrapIndex(y0, a.h);
    const yb = wrapIndex(y0 + 1, a.h);
    for (let x = 0; x < w; x++) {
      const fx0 = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(fx0);
      const tx = fx0 - x0;
      const xa = Math.min(a.w - 1, Math.max(0, x0));
      const xb = Math.min(a.w - 1, Math.max(0, x0 + 1));
      const d = (y * w + x) * out.ch;
      for (let c = 0; c < a.ch; c++) {
        const v00 = a.data[(ya * a.w + xa) * a.ch + c];
        const v10 = a.data[(ya * a.w + xb) * a.ch + c];
        const v01 = a.data[(yb * a.w + xa) * a.ch + c];
        const v11 = a.data[(yb * a.w + xb) * a.ch + c];
        out.data[d + c] = mix(mix(v00, v10, tx), mix(v01, v11, tx), ty);
      }
    }
  }
  return out;
}

function boxBlur(a, radius, passes = 2) {
  const { w, h, ch } = a;
  let src = clone(a);
  let dst = img(w, h, ch);
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += src.data[(row + wrapIndex(i, w)) * ch + c];
        for (let x = 0; x < w; x++) {
          dst.data[(row + x) * ch + c] = sum / (2 * r + 1);
          sum += src.data[(row + wrapIndex(x + r + 1, w)) * ch + c] - src.data[(row + wrapIndex(x - r, w)) * ch + c];
        }
      }
    }
    [src, dst] = [dst, src];
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        for (let j = -r; j <= r; j++) sum += src.data[(wrapIndex(j, h) * w + x) * ch + c];
        for (let y = 0; y < h; y++) {
          dst.data[(y * w + x) * ch + c] = sum / (2 * r + 1);
          sum += src.data[(wrapIndex(y + r + 1, h) * w + x) * ch + c] - src.data[(wrapIndex(y - r, h) * w + x) * ch + c];
        }
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/** Subtract the blurred copy and keep a fraction of it, wrap-aware. */
function highpass(a, radius, keep = 0.15, channels = 3) {
  const low = boxBlur(a, radius, 2);
  const out = clone(a);
  const n = a.w * a.h;
  const mean = new Float32Array(a.ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) mean[c] += a.data[i * a.ch + c];
  for (let c = 0; c < channels; c++) mean[c] /= n;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < channels; c++) {
      const d = low.data[i * a.ch + c] - mean[c];
      out.data[i * a.ch + c] = clamp01(a.data[i * a.ch + c] - d + keep * d);
    }
  return out;
}

/** Pull the colour towards its own luminance: asphalt's albedo is grey, not brown. */
function desaturate(a, k) {
  return mapRGB(a, (r, g, b) => {
    const l = lum(r, g, b);
    return [mix(l, r, k), mix(l, g, k), mix(l, b, k)];
  });
}

/** Move the RGB towards a target luminance mean/std without touching the hue ratios. */
function tone(rgb, { mean = 0.34, std = 0.10 } = {}) {
  let mL = 0;
  let mL2 = 0;
  const n = rgb.w * rgb.h;
  for (let i = 0; i < n; i++) {
    const o = i * rgb.ch;
    const l = lum(rgb.data[o], rgb.data[o + 1], rgb.data[o + 2]);
    mL += l;
    mL2 += l * l;
  }
  mL /= n;
  const sL = Math.max(1e-4, Math.sqrt(Math.max(0, mL2 / n - mL * mL)));
  const k = std / sL;
  return mapRGB(rgb, (r, g, b) => [(r - mL) * k + mean, (g - mL) * k + mean, (b - mL) * k + mean]);
}

/** Wrap-aware RGB bleed into transparent texels, so mips never mix in black. */
function bleedRGB(a, iterations = 6) {
  const { w, h, ch } = a;
  const out = clone(a);
  let known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = a.data[i * ch + 3] > 0.02 ? 1 : 0;
  let frontier = [];
  for (let i = 0; i < w * h; i++) if (known[i]) frontier.push(i);
  for (let it = 0; it < iterations; it++) {
    const next = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = wrapIndex(y + dy, h) * w + wrapIndex(x + dx, w);
        if (known[j] === 1) continue;
        for (let c = 0; c < 3; c++) out.data[j * ch + c] = out.data[i * ch + c] * 0.9 + out.data[j * ch + c] * 0.1;
        known[j] = 3;
        next.push(j);
      }
    }
    for (const j of next) known[j] = 1;
    for (let i = 0; i < w * h; i++) if (known[i] === 3) known[i] = 1;
    frontier = next;
    if (!frontier.length) break;
  }
  return out;
}

/**
 * Flood the texels that neither the bleed nor a sprite ever coloured. A sparse
 * overlay leaves most of its area at RGB 0, and a mip level averages that black
 * into the colour of a band that is only 10 % covered — the leaves and the grass
 * then darken with distance. Filling the void with the mean of the covered
 * texels keeps every mip level the right colour.
 */
function fillVoid(a) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    if (a.data[i * 4 + 3] < 0.25) continue;
    r += a.data[i * 4];
    g += a.data[i * 4 + 1];
    b += a.data[i * 4 + 2];
    n++;
  }
  if (!n) return a;
  r /= n;
  g /= n;
  b /= n;
  for (let i = 0; i < a.w * a.h; i++) {
    if (a.data[i * 4 + 3] > 0.02) continue;
    if (a.data[i * 4] + a.data[i * 4 + 1] + a.data[i * 4 + 2] > 0.06) continue;
    a.data[i * 4] = r;
    a.data[i * 4 + 1] = g;
    a.data[i * 4 + 2] = b;
  }
  return a;
}

/** Rebuild the average colour a partly covered texel should show (alpha-over). */
function over(dst, x, y, r, g, b, al) {
  const o = (wrapIndex(y, dst.h) * dst.w + wrapIndex(x, dst.w)) * dst.ch;
  const da = dst.data[o + 3];
  const na = al + da * (1 - al);
  const inv = 1 / Math.max(1e-6, na);
  dst.data[o] = (r * al + dst.data[o] * da * (1 - al)) * inv;
  dst.data[o + 1] = (g * al + dst.data[o + 1] * da * (1 - al)) * inv;
  dst.data[o + 2] = (b * al + dst.data[o + 2] * da * (1 - al)) * inv;
  dst.data[o + 3] = na;
}

/* ---------------------------------------------------------------- sprites */

/**
 * Box-downsample a wrapped region of one or more sources at once. Averaging is
 * what turns a 300 px lawn patch into a readable clump instead of aliased mush.
 * Every part must live on the same sampling lattice (same w/h) — the wrap is
 * taken from the lattice, not from each part.
 */
function boxSample(parts, sx, sy, sw, sh, tw, th) {
  for (const p of parts)
    if (p.w !== parts[0].w || p.h !== parts[0].h) throw new Error('boxSample: parts must share one lattice');
  const acc = parts.map((p) => new Float32Array(tw * th * p.ch));
  const cnt = new Float32Array(tw * th);
  for (let j = 0; j < sh; j++) {
    const y = wrapIndex(Math.floor(sy) + j, parts[0].h);
    const ty = Math.min(th - 1, Math.floor((j * th) / sh));
    for (let i = 0; i < sw; i++) {
      const x = wrapIndex(Math.floor(sx) + i, parts[0].w);
      const tx = Math.min(tw - 1, Math.floor((i * tw) / sw));
      const d = ty * tw + tx;
      cnt[d]++;
      for (let k = 0; k < parts.length; k++) {
        const p = parts[k];
        const s = (y * p.w + x) * p.ch;
        for (let c = 0; c < p.ch; c++) acc[k][d * p.ch + c] += p.data[s + c];
      }
    }
  }
  return parts.map((p, k) => {
    const out = img(tw, th, p.ch);
    for (let d = 0; d < tw * th; d++) {
      const n = cnt[d] || 1;
      for (let c = 0; c < p.ch; c++) out.data[d * p.ch + c] = acc[k][d * p.ch + c] / n;
    }
    return out;
  });
}

/** Sprite: colour, coverage, a 1 px dark rim and a blurred shadow copy of the coverage. */
function sprite(rgb3, al) {
  const { w, h } = al;
  const a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = clamp01(al.data[i]);
  const shadow = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) s += a[Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))];
      shadow[y * w + x] = (s / 25) * 0.95;
    }
  const rim = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let e = 1;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) e = Math.min(e, a[Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))]);
      rim[y * w + x] = clamp01(a[y * w + x] - e) * a[y * w + x];
    }
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++)
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = clamp01(rgb3.data[i * rgb3.ch + Math.min(c, rgb3.ch - 1)]);
  return { w, h, rgb, a, rim, shadow };
}

/**
 * Draw a sprite over a 1024x2048 layer. Positions wrap, so a leaf that hangs
 * over the v edge reappears on the other side and the tile closes.
 */
function drawSprite(dst, sp, cx, cy, size, angle, { coverage = 1, tone: tn = null, flat = null, shape = 'a', sizeY = null } = {}) {
  const longest = Math.max(sp.w, sp.h);
  const scale = size / longest;
  const scaleY = (sizeY ?? size) / longest;
  const rad = Math.ceil(Math.max(sp.w * scale, sp.h * scaleY) * 0.75) + 2;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const field = shape === 'shadow' ? sp.shadow : sp.a;
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++) {
      const lx = (dx * ca + dy * sa) / scale + sp.w / 2;
      const ly = (-dx * sa + dy * ca) / scaleY + sp.h / 2;
      if (lx < 0 || ly < 0 || lx > sp.w - 1 || ly > sp.h - 1) continue;
      const x0 = Math.floor(lx);
      const y0 = Math.floor(ly);
      const fx = lx - x0;
      const fy = ly - y0;
      let al = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let rm = 0;
      for (let j = 0; j <= 1; j++)
        for (let i = 0; i <= 1; i++) {
          const X = Math.min(sp.w - 1, x0 + i);
          const Y = Math.min(sp.h - 1, y0 + j);
          const k = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
          const p = Y * sp.w + X;
          al += k * field[p];
          rm += k * sp.rim[p];
          r += k * sp.rgb[p * 3];
          g += k * sp.rgb[p * 3 + 1];
          b += k * sp.rgb[p * 3 + 2];
        }
      al *= coverage;
      if (al <= 0.004) continue;
      const dk = 1 - 0.34 * rm;
      const cr = flat ? flat[0] : (tn ? r * tn[0] : r) * dk;
      const cg = flat ? flat[1] : (tn ? g * tn[1] : g) * dk;
      const cb = flat ? flat[2] : (tn ? b * tn[2] : b) * dk;
      const X = wrapIndex(cx + dx, dst.w);
      const Y = wrapIndex(cy + dy, dst.h);
      over(dst, X, Y, cr, cg, cb, al);
    }
}

/* ----------------------------------------------------------- ragged edge */

/**
 * The carriageway boundary. `base`/`amp` are fractions of the texture width;
 * the noise is periodic in v, so the rag closes exactly at the v edge, and its
 * 0.75 crossing never strays more than ~1 % of the width.
 */
function edgeAlpha(v, seed, { base = 0.016, amp = 0.009, fine = 0.0011, crumbs = 0.014 } = {}) {
  // five octaves, so the crumble has bites at every scale instead of one comb
  // frequency: tarmac breaks off in chunks, not in a sawtooth
  const wander = (fbm1(v, 11, 5, seed) - 0.5) * 2 * amp;
  const jitter = (fbm1(v, 420, 2, seed + 31) - 0.5) * 2 * fine;
  const c = base + wander + jitter;
  return { c, crumbs };
}

/** alpha for a signed distance s (fraction of width) inward from the mesh edge. */
function edgeRamp(s, c, crumbs, bits) {
  if (s >= c + 0.003) return 1;
  if (s >= c) return 0.75 + 0.25 * sm((s - c) / 0.003);
  if (s >= c - 0.004) return 0.55 + 0.2 * ((s - (c - 0.004)) / 0.004);
  const t = clamp01((s - (c - crumbs)) / (crumbs - 0.004));
  return 0.55 * t * t * (0.35 + 0.65 * bits);
}

/** Full alpha field: both edges, each with its own crumb noise. */
function carriagewayAlpha({ seed = 7, base = 0.016, amp = 0.0075, crumbs = 0.014, shadowBrush = 0 } = {}) {
  return mask(W, H, (u, v) => {
    const left = edgeAlpha(v, seed, { base, amp, crumbs });
    const right = edgeAlpha(1 - v, seed + 4111, { base, amp, crumbs });
    const bits = fbm2(u, v, 64, 3, seed + 77);
    let a = Math.min(edgeRamp(u, left.c, left.crumbs, bits), edgeRamp(1 - u, right.c, right.crumbs, fbm2(1 - u, v, 61, 3, seed + 91)));
    if (shadowBrush) a = mix(a, a * (0.6 + 0.4 * fbm2(u, v, 22, 2, seed + 5)), shadowBrush);
    return a;
  });
}

/* --------------------------------------------------------------- sources */

let S = null;

async function loadSources() {
  const pull = async (id) => {
    const e = sources.find((s) => s.id === id);
    const isZip = e.url.endsWith('.zip');
    const { dir, file } = await obtain({
      url: e.url,
      cache: isZip ? path.basename(new URL(e.url).searchParams.get('file')) : id + '.jpg',
      unpack: isZip ? id : undefined,
      quiet: true
    });
    return dir && isZip ? { dir, file } : { dir, file };
  };
  const agFile = async (id, names) => {
    const { dir } = await pull(id);
    return firstExisting(names.map((n) => path.join(dir, n)));
  };
  const phFile = async (id) => (await pull(id)).file;

  const [worn, a02, dust, dmg, tarF, s02, s03, sFloor, s010F, grassF, grassHF, mossF, mossHF, lfF, sl9F, sl7F, sl5F, sl6F] =
    await Promise.all([
      phFile('worn_asphalt'),
      phFile('asphalt_02'),
      phFile('road_damaged_clean'),
      phFile('road_damaged'),
      agFile('Asphalt026C', ['Asphalt026C_1K-JPG_Color.jpg', 'Asphalt026C_1K-JPG_Color.png']),
      phFile('snow_02'),
      phFile('snow_03'),
      phFile('snow_floor'),
      agFile('Snow010A', ['Snow010A_1K-JPG_Color.jpg']),
      agFile('Grass004', ['Grass004_1K-JPG_Color.jpg']),
      agFile('Grass004', ['Grass004_1K-JPG_Displacement.jpg']),
      agFile('Moss003', ['Moss003_1K-JPG_Color.jpg']),
      agFile('Moss003', ['Moss003_1K-JPG_Displacement.jpg']),
      phFile('leaves_forest_ground'),
      agFile('ScatteredLeaves009', ['ScatteredLeaves009_1K-JPG_Color.jpg']),
      agFile('ScatteredLeaves007', ['ScatteredLeaves007_1K-JPG_Color.jpg']),
      agFile('ScatteredLeaves005', ['ScatteredLeaves005_1K-JPG_Color.jpg']),
      agFile('ScatteredLeaves006', ['ScatteredLeaves006_1K-JPG_Color.jpg'])
    ]);

  const load = async (f, ch = 4) => tileV(await loadImage(f, { w: 1024, h: 1024, ch }), W, H);
  const load1024 = (f, ch = 4) => loadImage(f, { w: 1024, h: 1024, ch });

  S = {
    worn: await load(worn),
    a02: await load(a02),
    dust: await load(dust),
    dmg: await load(dmg),
    tarG: grey(await load1024(tarF, 3)),
    s02: await load(s02),
    s03: await load(s03),
    sFloor: await load(sFloor),
    s010: await load(s010F),
    s010H: tileV(await loadImage(await agFile('Snow010A', ['Snow010A_1K-JPG_Displacement.jpg']), { w: 1024, h: 1024, ch: 1 }), W, H),
    grass: await load1024(grassF, 3),
    grassH: await load1024(grassHF, 1),
    moss: await load1024(mossF, 3),
    mossH: await load1024(mossHF, 1),
    lf: await load(lfF),
    sl9: await load(sl9F),
    sl7: await load1024(sl7F, 3),
    sl5: await load1024(sl5F, 3),
    sl6: await load1024(sl6F, 3)
  };
}

/* --------------------------------------------------------------- asphalt */

async function buildAsphalt() {
  // Two asphalt photographs cross-faded along v: the weight has to be periodic,
  // otherwise the tile shows a bright seam where the halves meet.
  // asphalt_02 (grey, cracked, fine aggregate) carries the surface; worn_asphalt
  // only supplies the warm chip-seal grain that a country road shows
  const base = blend(S.worn, S.a02, (u, v) => 0.72 + 0.12 * Math.sin(TAU * v));
  let rgb = highpass(base, 26, 0.22);

  // Second longitudinal crack: the same fatigue crack out of asphalt_02, laid
  // into the right wheel path, where a real road cracks first.
  const crack = stretch(cropWrapped(S.a02, 392, 0, 144, H), 150, H); // u-only resample, v stays 1:1
  const crackMask = mask(150, H, (u) => sm(clamp01((0.5 - Math.abs(u - 0.5)) / 0.28)) * 0.62);
  const crackLayer = img(W, H, 4); // a 150 px band of the right wheel path
  for (let y = 0; y < H; y++)
    for (let x = 0; x < 150; x++) {
      const sx = Math.round(0.72 * W - 75 + x);
      const o = (y * W + wrapIndex(sx, W)) * 4;
      const si = (y * 150 + x) * 4;
      for (let c = 0; c < 3; c++) crackLayer.data[o + c] = crack.data[si + c];
      crackLayer.data[o + 3] = crackMask.data[y * 150 + x];
    }
  rgb = blend(rgb, crackLayer, (u, v) => px(crackLayer, u, v, 3));

  // Tar mottling: blurred tarred-asphalt blotches darken the whole tile into an
  // aged black-grey without repeating as one recognisable shape.
  const tarLow = highpass(fromGrey1(boxBlur(S.tarG, 6, 2)), 30, 0.25);
  rgb = mapRGB(rgb, (r, g, b, u, v) => {
    const t = px(tarLow, u, v, 0);
    const k = 0.78 + 0.42 * t;
    return [r * k, g * k, b * k];
  });

  // Repair patches with tar seams. Kept low-contrast: the whole tile repeats
  // every 24 m, so only a faint patch can repeat without telegraphing.
  rgb = repairPatch(rgb, base, { u0: 0.13, u1: 0.6, v0: 0.09, v1: 0.31, seam: 0.3, dark: 0.05, seed: 3 });
  rgb = repairPatch(rgb, base, { u0: 0.44, u1: 0.9, v0: 0.6, v1: 0.79, seam: 0.3, dark: 0.04, seed: 9 });
  rgb = transverseSeam(rgb, 0.47, { dark: 0.2, seed: 17 });
  rgb = transverseSeam(rgb, 0.02, { dark: 0.16, seed: 23 });

  // Wheel paths: polished, a touch darker and greyer, wandering slightly with v.
  const pathWander = (v) => (fbm1(v, 9, 2, 61) - 0.5) * 0.03;
  const pathMask = (u, v) => {
    const w = pathWander(v);
    const d1 = (u - (0.28 + w)) / 0.055;
    const d2 = (u - (0.72 + w)) / 0.055;
    return clamp01(Math.exp(-d1 * d1) + Math.exp(-d2 * d2));
  };
  const polished = boxBlur(rgb, 4, 2);
  rgb = blend(rgb, polished, (u, v) => pathMask(u, v) * 0.35);
  rgb = mapRGB(rgb, (r, g, b, u, v) => {
    const m = pathMask(u, v);
    const l = lum(r, g, b);
    const k = 1 - 0.22 * m;
    return [mix(r, l, m * 0.2) * k, mix(g, l, m * 0.2) * k, mix(b, l, m * 0.2) * k];
  });

  // Crown-to-edge grade plus the coarser, dirtier strip the verge throws up.
  const coarse = tileV(stretch(S.dust, 512, 1024), W, H);
  const dustMix = await Promise.all([S.dust, coarse]);
  rgb = blend(rgb, dustMix[1], (u, v) => {
    const e = Math.max(smoothstep(0.055, 0.0, u), smoothstep(0.945, 1.0, u));
    const crown = smoothstep(0.055, 0.0, Math.abs(u - 0.5));
    return clamp01(0.34 * e + 0.1 * crown);
  });
  rgb = blend(rgb, S.dmg, (u) => 0.14 * smoothstep(0.055, 0.0, Math.abs(u - 0.5)));
  rgb = scaleRGB(rgb, (u) => mix(1.0, 0.94, Math.pow(Math.abs(2 * u - 1), 1.4)));

  // Warm the grey photograph towards the brown-grey our palette expects, then
  // sit the luminance where slowroads' road_base sits (0.42 on the crown).
  // 1 px of blur: at 6.8 mm per texel the single-texel chippings alias into
  // white noise under minification, and slowroads' own base is smooth at 1:1
  rgb = desaturate(boxBlur(rgb, 1, 1), 0.4);
  const toned = tone(rgb, { mean: 0.4, std: 0.095 });
  rgb = mapRGB(toned, (r, g, b) => [clamp01(r * 1.025), g, clamp01(b * 0.975)]);
  const out = clone(rgb);
  const alpha = carriagewayAlpha({ seed: 7 });
  for (let i = 0; i < W * H; i++) out.data[i * 4 + 3] = alpha.data[i];
  const bled = bleedRGB(out, 7);
  await saveWebp(bled, 'road_asphalt.webp', { quality: 86, alphaQuality: 94 });
  record('road_asphalt.webp', bled, { alpha: stats(alpha, 0) });
  return bled;
}

const fromGrey1 = (g) => {
  const out = img(g.w, g.h, 1);
  out.data.set(g.data);
  return out;
};

const cropWrapped = (a, x, y, w, h) => {
  const out = img(w, h, a.ch);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = (wrapIndex(y + j, a.h) * a.w + wrapIndex(x + i, a.w)) * a.ch;
      const d = (j * w + i) * a.ch;
      for (let c = 0; c < a.ch; c++) out.data[d + c] = a.data[s + c];
    }
  return out;
};

/**
 * A rectangular repair patch with a tar seam around it. The patch is cut from
 * the road's own asphalt at another offset: sampling a different photograph
 * here leaves an obvious pane of foreign texture glued to the road.
 */
function repairPatch(rgb, layer, { u0, u1, v0, v1, dark = 0.05, seam = 0.25, seed }) {
  const x0 = Math.round(u0 * W);
  const y0 = Math.round(v0 * H);
  const w = Math.round((u1 - u0) * W);
  const h = Math.round((v1 - v0) * H);
  const src = cropWrapped(layer, (seed * 137) % W, (seed * 311) % H, w, h);
  // Tonal match: without it the patch's brightness depends on which part of the
  // photograph it happened to sample, and a patch that came out light reads as a
  // pane of glass glued to the road. The deliberate difference stays (dark).
  const meanOf = (im, ox, oy) => {
    let sum = 0;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const o = (wrapIndex(oy + j, im.h) * im.w + wrapIndex(ox + i, im.w)) * 4;
        sum += lum(im.data[o], im.data[o + 1], im.data[o + 2]);
      }
    return sum / (w * h);
  };
  const mSrc = meanOf(src, 0, 0);
  const mDst = meanOf(rgb, x0, y0);
  const match = mDst / Math.max(1e-3, mSrc);
  const inside = mask(w, h, (u, v) => {
    // a repair edge is a wavy rectangle, never a straight one
    const edge = Math.min(u, 1 - u, v, 1 - v) * w + (fbm2(u, v, 9, 3, seed * 31) - 0.5) * 9;
    return sm(clamp01((edge - 3) / 5));
  });
  const out = clone(rgb);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = inside.data[j * w + i];
      const d = (wrapIndex(y0 + j, H) * W + wrapIndex(x0 + i, W)) * 4;
      const s = (j * w + i) * 4;
      const mul = 1 - dark;
      for (let c = 0; c < 3; c++) out.data[d + c] = clamp01(mix(out.data[d + c], src.data[s + c] * mul * match, k * 0.6));
    }
  // the seam itself
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const edge = Math.min(i, j, w - 1 - i, h - 1 - j);
      const k = sm(clamp01((3 - edge) / 3));
      if (k <= 0) continue;
      const d = (wrapIndex(y0 + j, H) * W + wrapIndex(x0 + i, W)) * 4;
      for (let c = 0; c < 3; c++) out.data[d + c] = clamp01(out.data[d + c] * (1 - seam * k * 0.35));
    }
  return out;
}

/** A thin transverse tar seam across the whole carriageway, wandering with u. */
function transverseSeam(rgb, vAt, { dark = 0.25, seed = 17 } = {}) {
  const out = clone(rgb);
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W;
    const centre = (vAt + (fbm1(u, 12, 2, seed) - 0.5) * 0.006) * H;
    const width = 2.2 + 1.6 * fbm1(u, 20, 2, seed + 3);
    for (let j = -6; j <= 6; j++) {
      const k = sm(clamp01((width - Math.abs(j)) / width));
      const o = (wrapIndex(Math.round(centre) + j, H) * W + x) * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = clamp01(out.data[o + c] * (1 - dark * k));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- spring */

/**
 * Cut tufts and moss out of close-up photographs using the provider's
 * displacement map as the blade mask: a lawn photograph on its own has no
 * transparent gaps, and a drawn blob reads as paint.
 */
function clumpSprites(color, height, { count, box, gain }) {
  const rnd = mulberry(0x51ed + count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const sx = rnd() * 1024;
    const sy = rnd() * 1024;
    const sw = box * (0.7 + 0.6 * rnd());
    const sh = box * (0.7 + 0.6 * rnd());
    const tw = 96;
    const th = Math.round((tw * sh) / sw);
    const [c, hh] = boxSample([color, height], sx, sy, sw, sh, tw, th);
    // the mask is normalised against this clump's own histogram: a provider's
    // displacement map has no fixed scale, and a fixed threshold can leave a
    // tuft almost transparent because the lawn photograph happens to be dark
    const sorted = Array.from(hh.data).sort((a, b) => a - b);
    const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const p0 = pct(0.3);
    const p1 = pct(0.85);
    const al = mask(tw, th, (u, v, x, y) => {
      const k = clamp01((hh.data[y * tw + x] - p0) / Math.max(1e-3, p1 - p0));
      return clamp01(sm(k) * gain);
    });
    // irregular clump outline so the tuft does not read as a rectangle
    const outline = mask(tw, th, (u, v) => sm(clamp01((0.5 - Math.hypot(u - 0.5, v - 0.5) * 1.35 + (fbm2(u, v, 5, 3, 991) - 0.5) * 0.5) / 0.18)));
    for (let p = 0; p < tw * th; p++) al.data[p] = clamp01(al.data[p] * outline.data[p]);
    out.push(sprite(c, al));
  }
  return out;
}

async function buildSpring() {
  const tufts = clumpSprites(S.grass, S.grassH, { count: 30, box: 260, gain: 1.5 });
  const mossBalls = clumpSprites(S.moss, S.mossH, { count: 20, box: 160, gain: 1.6 });
  // the lawn photograph is late-summer dark; spring growth is lighter and yellower
  const fresh = [1.24, 1.22, 0.98];
  const out = img(W, H, 4);
  const rnd = mulberry(0xa11ce);
  const band = (u) => clamp01(smoothstep(0.17, 0.015, u) * 0.95 + smoothstep(0.83, 0.985, u) * 0.95);

  // Pairs of tufts along both edges: grass reaches the tarmac from the verge.
  // A tuft is drawn taller than it is wide, because at 6.8 mm per texel a single
  // blade is sub-pixel — the clump itself is the shape that has to read.
  for (let i = 0; i < 1000; i++) {
    const side = rnd() < 0.5 ? 0 : 1;
    const u = side === 0 ? Math.pow(rnd(), 2) * 0.17 : 1 - Math.pow(rnd(), 2) * 0.17;
    const v = rnd();
    if (rnd() > band(u) * (0.55 + 0.45 * fbm2(u, v, 9, 2, 41))) continue;
    const sp = tufts[(rnd() * tufts.length) | 0];
    const size = 34 + rnd() * 46;
    drawSprite(out, sp, Math.round(u * W), Math.round(v * H), size, (rnd() - 0.5) * 0.5, {
      coverage: 0.75 + 0.25 * rnd(),
      tone: fresh,
      sizeY: size * (1.2 + rnd() * 0.7)
    });
    if (rnd() < 0.65) {
      const u2 = clamp01(u + (rnd() - 0.5) * 0.045);
      const sp2 = tufts[(rnd() * tufts.length) | 0];
      const size2 = size * (0.6 + 0.4 * rnd());
      drawSprite(out, sp2, Math.round(u2 * W), Math.round((v + (rnd() - 0.5) * 0.02) * H), size2, (rnd() - 0.5) * 0.6, {
        coverage: 0.7 + 0.3 * rnd(),
        tone: fresh,
        sizeY: size2 * (1.1 + rnd() * 0.6)
      });
    }
  }
  // Thin moss in the wheel-track cracks: streaks along the road, not dots.
  for (let i = 0; i < 300; i++) {
    const u = rnd() < 0.5 ? 0.28 + (rnd() - 0.5) * 0.05 : 0.72 + (rnd() - 0.5) * 0.05;
    const m = mossBalls[(rnd() * mossBalls.length) | 0];
    const size = 14 + rnd() * 18;
    drawSprite(out, m, Math.round(u * W), Math.round(rnd() * H), size, (rnd() - 0.5) * 0.8, {
      coverage: 0.3 + 0.4 * rnd(),
      sizeY: size * (1.8 + rnd() * 1.6),
      tone: fresh
    });
  }
  for (let i = 0; i < 120; i++) {
    const u = rnd() < 0.5 ? Math.pow(rnd(), 1.4) * 0.1 : 1 - Math.pow(rnd(), 1.4) * 0.1;
    const sp = tufts[(rnd() * tufts.length) | 0];
    const sz = 20 + rnd() * 26;
    drawSprite(out, sp, Math.round(u * W), Math.round(rnd() * H), sz, (rnd() - 0.5) * 0.6, {
      coverage: 0.5 + 0.3 * rnd(),
      tone: fresh,
      sizeY: sz * (1.2 + rnd() * 0.7)
    });
  }

  const rgb = mapRGB(out, (r, g, b) => [clamp01(r * 1.0), clamp01(g * 1.0), b * 1.0]);
  const bled = fillVoid(bleedRGB(rgb, 12));
  await saveWebp(bled, 'road_overlay_spring.webp', { quality: 86, alphaQuality: 95 });
  record('road_overlay_spring.webp', bled, { bands: bands(bled) });
  return bled;
}

/* ---------------------------------------------------------------- autumn */

/** Connected components of a coverage mask, big enough to be a whole leaf. */
function components(field, { th = 0.4, minArea = 260, maxArea = 90000 } = {}) {
  const { w, h } = field;
  const seen = new Uint8Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || field.data[start] < th) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const pixels = [];
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (sp > 0) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (seen[j] || field.data[j] < th) continue;
          seen[j] = 1;
          stack[sp++] = j;
        }
    }
    if (pixels.length < minArea || pixels.length > maxArea) continue;
    comps.push({ x0, y0, x1, y1, area: pixels.length, pixels });
  }
  comps.sort((a, b) => b.area - a.area);
  return comps;
}

/**
 * Whole leaves cut out of a photograph — either leaves shot on black or whole
 * leaves lying on litter, where the warm hue separates them from the ground.
 * Only components that are leaf-shaped survive: a merged heap of leaves has the
 * wrong silhouette and reads as a petal.
 */
function leafSprites(color, { lo = 0.10, hi = 0.26, limit = 200, minArea = 400, minElong = 1.15, maxFill = 0.78, mode = 'black' } = {}) {
  const field = mask(color.w, color.h, (u, v, x, y) => {
    const o = (y * color.w + x) * color.ch;
    const r = color.data[o];
    const g = color.data[o + 1];
    const b = color.data[o + 2];
    const leafness =
      mode === 'chroma'
        ? (r - b) * 2.2 + Math.max(0, g - b) * 0.6 // a leaf on litter: the warm hue, not the brightness
        : (r - b) * 0.8 + (g - b) * 0.4 + lum(r, g, b) * 1.1; // a leaf on black
    return sm(clamp01((leafness - lo) / (hi - lo)));
  });
  const comps = components(field, { th: 0.35, minArea });
  const out = [];
  // one full-size scratch mask on the same lattice as the photograph: the cut
  // for each leaf is stamped into it, sampled, then stamped out again
  const local = img(color.w, color.h, 1);
  for (const c of comps.slice(0, limit * 3)) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    const elong = Math.max(w / h, h / w);
    const fill = c.area / (w * h);
    if (elong < minElong || fill > maxFill) continue;
    if (out.length >= limit) break;
    const pad = 2;
    const scale = Math.min(1, 72 / Math.max(w, h));
    const tw = Math.max(8, Math.round((w + pad * 2) * scale));
    const th = Math.max(8, Math.round((h + pad * 2) * scale));
    for (const i of c.pixels) local.data[i] = field.data[i];
    const [rgbS, alS] = boxSample([color, local], c.x0 - pad, c.y0 - pad, w + pad * 2, h + pad * 2, tw, th);
    for (const i of c.pixels) local.data[i] = 0;
    // feather the cut, then grow it a hair so the edge is not a hard stencil
    const alF = boxBlur(alS, 1, 1);
    const al2 = mask(tw, th, (u, v, x, y) => clamp01(alF.data[y * tw + x] * 1.25));
    out.push(sprite(rgbS, al2));
  }
  return out;
}

async function buildAutumn() {
  // Litter carpet from two photographs: the broken leaves and the ground shadow
  // that scattered whole leaves alone never give. Its coverage is a function,
  // not a scatter — a carpet is a sheet with holes, not a pile of sprites.
  const carpetA = tileV(S.lf, W, H);
  const carpetB = tileV(S.sl9, W, H);
  const carpet = blend(carpetA, carpetB, (u, v) => 0.5 + 0.35 * Math.sin(TAU * v + 1.1));
  const out = img(W, H, 4);
  const coverage = mask(W, H, (u, v) => {
    const fine = fbm2(u, v, 40, 4, 707);
    const patchy = 0.45 + 0.55 * clamp01((fbm2(u, v, 8, 3, 909) - 0.3) / 0.4);
    const edge = Math.max(smoothstep(0.17, 0.015, u), smoothstep(0.83, 0.985, u));
    const inner = Math.max(smoothstep(0.1, 0.0, u), smoothstep(0.9, 1.0, u));
    const track = Math.exp(-Math.pow((u - 0.28) / 0.05, 2)) + Math.exp(-Math.pow((u - 0.72) / 0.05, 2));
    return clamp01((1.4 * edge + 0.5 * inner + 0.28 * track + 0.08) * patchy * sm(clamp01((fine - 0.34) / 0.22)));
  });
  for (let i = 0; i < W * H; i++) {
    const a = coverage.data[i];
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = carpet.data[i * 4 + c];
    out.data[i * 4 + 3] = a;
  }

  const rnd = mulberry(0xbeef1);
  const density = (u, v) => {
    const edge = Math.max(smoothstep(0.16, 0.015, u), smoothstep(0.84, 0.985, u));
    const inner = Math.max(smoothstep(0.09, 0.0, u), smoothstep(0.91, 1.0, u));
    const track = Math.exp(-Math.pow((u - 0.28) / 0.05, 2)) + Math.exp(-Math.pow((u - 0.72) / 0.05, 2));
    return clamp01((1.05 * edge + 0.4 * inner + 0.22 * track + 0.1) * (0.55 + 0.45 * fbm2(u, v, 7, 3, 77)));
  };

  const species = [
    // the whole leaves lying on grey litter: the best silhouettes of the four
    { list: leafSprites(S.lf, { mode: 'chroma', lo: 0.2, hi: 0.42, limit: 150, minArea: 320, minElong: 1.25 }), size: [9, 22], tone: [1.0, 1.05, 0.88] },
    { list: leafSprites(S.sl7, { lo: 0.09, hi: 0.22, limit: 80, minElong: 1.2 }), size: [10, 24], tone: [1.05, 1.02, 0.72] },
    { list: leafSprites(S.sl5, { lo: 0.10, hi: 0.24, limit: 160 }), size: [6, 13], tone: [1.04, 1.05, 0.82] },
    { list: leafSprites(S.sl6, { lo: 0.08, hi: 0.20, limit: 80 }), size: [8, 18], tone: [1.08, 1.0, 0.72] }
  ];
  for (let i = 0; i < 7000; i++) {
    const u = rnd() < 0.36 ? Math.pow(rnd(), 2.2) * 0.19 : rnd() < 0.5 ? 1 - Math.pow(rnd(), 2.2) * 0.19 : rnd();
    const v = rnd();
    if (rnd() > density(u, v) * 1.15) continue;
    const kind = species[(rnd() * species.length) | 0];
    if (!kind.list.length) continue;
    const sp = kind.list[(rnd() * kind.list.length) | 0];
    const size = mix(kind.size[0], kind.size[1], rnd());
    const x = Math.round(u * W);
    const y = Math.round(v * H);
    // shadow, then the leaf, then the rim inside the leaf edge
    const sh = sp;
    drawSprite(out, sh, x + 1 + Math.round(rnd() * 2), y + 1 + Math.round(rnd() * 3), size * 1.05, rnd() * TAU, {
      shape: 'shadow',
      flat: [0.09, 0.07, 0.05],
      coverage: 0.34 + 0.2 * rnd()
    });
    const ang = rnd() * TAU;
    drawSprite(out, sp, x, y, size, ang, { coverage: 0.8 + 0.2 * rnd(), tone: kind.tone, sizeY: size * (0.55 + 0.4 * rnd()) });
  }

  // Towards the owner's autumn photograph (0.452 / 0.406 / 0.173): the leaf mix
  // comes out redder than a Russian birch floor, so the green channel is lifted.
  const rgb = mapRGB(out, (r, g, b) => [clamp01(r * 0.99), clamp01(g * 1.28), clamp01(b * 1.1)]);
  const bled = fillVoid(bleedRGB(rgb, 12));
  await saveWebp(bled, 'road_overlay_autumn.webp', { quality: 86, alphaQuality: 95 });
  record('road_overlay_autumn.webp', bled, { bands: bands(bled) });
  return bled;
}

/* ------------------------------------------------------------------ snow */

async function buildSnow() {
  const base = blend(S.s02, S.s010, (u, v) => 0.42 + 0.28 * Math.sin(TAU * v + 0.7));
  let rgb = highpass(base, 20, 0.3);
  rgb = blend(rgb, S.s03, (u, v) => {
    const e = Math.max(smoothstep(0.06, 0.0, u), smoothstep(0.94, 1.0, u));
    // a low everywhere-level of the granular photograph: snow crust is never smooth
    return clamp01(0.16 + e * (0.4 + 0.4 * fbm2(u, v, 26, 3, 313)));
  });

  // Fine crust grain out of the snow's own displacement map: without it the
  // packed surface reads as a soft blur, which is what snow photographs do when
  // they are stretched over 24 m.
  const hp = highpass(fromGrey1(S.s010H), 4, 0);
  const hs = stats(hp, 0);
  const grain = (v) => clamp01(1 + 0.055 * ((v - hs.mean) / Math.max(1e-4, hs.std)));
  rgb = mapRGB(rgb, (r, g, b, u, v) => {
    const k = grain(px(hp, u, v, 0));
    return [clamp01(r * k), clamp01(g * k), clamp01(b * k)];
  });

  // Two polished tyre ruts, wandering with v, with grit thrown into them.
  const pathWander = (v) => (fbm1(v, 7, 2, 71) - 0.5) * 0.035;
  const rut = (u, v) => {
    const w = pathWander(v);
    const d1 = (u - (0.28 + w)) / 0.05;
    const d2 = (u - (0.72 + w)) / 0.05;
    // the u frequency is raised sixfold, which stretches the noise along the
    // road: a tyre track is striated lengthwise, not a smooth grey band
    const broken = 0.45 + 0.55 * fbm2(u * 6, v, 40, 4, 511);
    return clamp01((Math.exp(-d1 * d1) + Math.exp(-d2 * d2)) * broken);
  };
  const polished = boxBlur(rgb, 5, 2);
  rgb = blend(rgb, polished, (u, v) => rut(u, v) * 0.6);
  rgb = mapRGB(rgb, (r, g, b, u, v) => {
    const m = rut(u, v);
    const l = lum(r, g, b);
    const k = 1 - 0.42 * m;
    return [mix(r, l, m * 0.24) * k, mix(g, l, m * 0.16) * k, mix(b, l, m * 0.06) * k];
  });
  // The ruts are not white snow: the traffic grinds grit and dust into them, so
  // the real asphalt photograph is mixed straight in there.
  rgb = mapRGB(rgb, (r, g, b, u, v) => {
    const m = rut(u, v);
    const d = px(S.dust, u, v, 0);
    const dg = px(S.dust, u, v, 1);
    const db = px(S.dust, u, v, 2);
    const k = m * (0.2 + 0.3 * fbm2(u, v, 34, 3, 811));
    return [mix(r, d * 1.05, k), mix(g, dg * 1.02, k), mix(b, db * 0.95, k)];
  });
  const grit = highpass(S.dust, 12, 0.2);
  rgb = mapRGB(rgb, (r, g, b, u, v) => {
    const gv = px(grit, u, v, 0);
    const k = rut(u, v) * clamp01((gv - 0.5) / 0.3) * 0.5;
    return [mix(r, gv * 0.92, k), mix(g, gv * 0.9, k), mix(b, gv * 0.8, k)];
  });

  // patches worn through to the tarmac / wet asphalt
  const rnd = mulberry(0x5e0a1);
  for (let i = 0; i < 18; i++) {
    const u = rnd() < 0.5 ? 0.28 + (rnd() - 0.5) * 0.09 : 0.72 + (rnd() - 0.5) * 0.09;
    const v = rnd();
    const src = rnd() < 0.5 ? S.sFloor : S.worn;
    const size = 30 + rnd() * 70;
    const sw = 30;
    const sh = Math.round(46 + rnd() * 34); // ruts wear through in long smears, not circles
    // sampled 1:1 — averaging an asphalt photograph down to 30 px turns it to mud
    const [c] = boxSample([src], rnd() * 900, rnd() * 900, sw, sh, sw, sh);
    const al = mask(sw, sh, (uu, vv) => {
      const d = Math.hypot((uu - 0.5) * 1.3, vv - 0.5) * 2;
      return sm(clamp01((0.75 - d + (fbm2(uu, vv, 4, 3, 700 + i) - 0.5) * 0.7) / 0.35));
    });
    const sp = sprite(c, al);
    drawSprite(rgb, sp, Math.round(u * W), Math.round(v * H), size, (rnd() - 0.5) * 0.5, { coverage: 0.55 + 0.35 * rnd() });
  }

  // A bluish-white cast, and brighter than slowroads' own winter road — theirs is
  // a slush road, ours is packed snow with the dirt kept in the ruts
  rgb = mapRGB(rgb, (r, g, b) => [clamp01(r * 1.008), g, clamp01(b * 1.005)]);
  const toned = tone(rgb, { mean: 0.72, std: 0.11 });
  const out = clone(toned);
  const alpha = carriagewayAlpha({ seed: 23, base: 0.021, amp: 0.009, crumbs: 0.017, shadowBrush: 0.25 });
  for (let i = 0; i < W * H; i++) out.data[i * 4 + 3] = alpha.data[i];
  const bled = bleedRGB(out, 7);
  await saveWebp(bled, 'road_snow.webp', { quality: 86, alphaQuality: 94 });
  record('road_snow.webp', bled, { alpha: stats(alpha, 0) });
  return bled;
}

/* ------------------------------------------------------------- reporting */

const REPORTS = [];

function record(file, image, extra = {}) {
  REPORTS.push({ file, seam: measureSeam(image), ...extra });
}

/** Coverage of the middle third and both edge fifths, as slowroads measures it. */
function bands(a) {
  const acc = [0, 0, 0];
  const cnt = [0, 0, 0];
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const u = (x + 0.5) / a.w;
      const bi = u < 0.2 ? 0 : u > 0.8 ? 2 : 1;
      acc[bi] += a.data[(y * a.w + x) * a.ch + 3];
      cnt[bi]++;
    }
  return acc.map((s, i) => s / cnt[i]).map((v) => +v.toFixed(3));
}

/**
 * Mean |difference| across the v join, against the median of every interior row
 * pair — a single interior pair is not a reference for a sparse scattering.
 */
function measureSeam(a) {
  const rowDiff = (y0, y1, c0, c1) => {
    let s = 0;
    for (let x = 0; x < a.w; x++) for (let c = c0; c < c1; c++) s += Math.abs(a.data[(y0 * a.w + x) * a.ch + c] - a.data[(y1 * a.w + x) * a.ch + c]);
    return s / (a.w * (c1 - c0));
  };
  const rgb = [];
  const alpha = [];
  for (let y = 0; y + 1 < a.h; y++) {
    rgb.push(rowDiff(y, y + 1, 0, 3));
    alpha.push(rowDiff(y, y + 1, 3, 4));
  }
  const median = (v) => {
    const s = [...v].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const vWrap = rowDiff(0, a.h - 1, 0, 3);
  const vWrapA = rowDiff(0, a.h - 1, 3, 4);
  const m = median(rgb);
  const ma = median(alpha);
  const rank = (v, list) => +(list.filter((x) => x < v).length / list.length).toFixed(2);
  const r4 = (v) => +v.toFixed(4);
  return {
    vWrap: r4(vWrap),
    vInner: r4(m),
    vRatio: +(vWrap / Math.max(1e-4, m)).toFixed(2),
    vRank: rank(vWrap, rgb),
    vWrapA: r4(vWrapA),
    vInnerA: r4(ma),
    vRatioA: +(vWrapA / Math.max(1e-4, ma)).toFixed(2),
    vRankA: rank(vWrapA, alpha)
  };
}

function report() {
  console.log('\n  seam check: mean |Δ| across the v join vs. the median of all interior row pairs');
  for (const r of REPORTS) {
    console.log(
      `    ${r.file.padEnd(26)} v RGB ${r.seam.vWrap} vs ${r.seam.vInner} (×${r.seam.vRatio}, p${r.seam.vRank})` +
        `  v A ${r.seam.vWrapA} vs ${r.seam.vInnerA} (×${r.seam.vRatioA}, p${r.seam.vRankA})` +
        (r.bands ? `  coverage u<0.2 / mid / u>0.8 ${r.bands.join(' / ')}` : '')
    );
  }
}

export async function build({ force = false } = {}) {
  REPORTS.length = 0;
  const files = outputs.map((o) => path.join(OUTDIR, o.file));
  const present = await Promise.all(files.map((f) => exists(f)));
  if (!force && present.every(Boolean)) {
    console.log('  road: all four outputs present — pass --force to rebuild');
    return;
  }
  console.log('  road: loading sources');
  await loadSources();
  await buildAsphalt();
  await buildSpring();
  await buildAutumn();
  await buildSnow();
  report();
}
