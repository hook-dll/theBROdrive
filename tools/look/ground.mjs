// Ground tiles for stage 2 (docs/renderer-v2.md, "Этап 2. Земля").
//
// All thirteen are 1024² tiles: RGB is albedo, A is height (0 base .. 1 crest).
// The pipeline is the same for every one of them, and it is what makes a photo
// read like slowroads' ground rather than like a repeated photograph:
//
//   1. the CC0 source is taken at 1K and never resized (both providers ship
//      1024², so a resize would only cost sharpness);
//   2. its large-scale uniqueness is killed — a wrapped high-pass at sigma 60-90
//      keeps only 10-15 % of the low frequencies, because a dark blotch that
//      repeats every 7 m is the one thing the eye catches immediately
//      (docs/slowroads-steam/notes/SrGround.md §2);
//   3. brightness is equalised so the shader's four-tint palette dominates and
//      no tile is brighter than its neighbours;
//   4. height goes into the alpha from the provider's displacement map where
//      there is one (all ambientCG materials ship one) and from blurred
//      luminance where there is not (Poly Haven ships normals only, and
//      integrating a normal map back into a height field invents structure).
//
// Everything is wrap-aware on purpose: the tiles are advertised as seamless, so
// a blur or resample that treated the edge as an edge would break the claim.
// `describe()` prints, per tile, the edge-to-edge difference against the
// difference between ordinary neighbouring rows and columns.

import { img, clone, loadImage, grey, crop, saveWebp, stats, clamp01, mix, lum } from './lib/image.mjs';
import { obtain, fetchTo, listFiles } from './lib/util.mjs';
import {
  rng,
  fbm,
  turbulence,
  wrapBlur,
  wrapResample,
  wrapHighpass,
  equaliseSoft,
  settleHeight,
  channelStats,
  withHeight,
  greyTile,
  mean,
  describe
} from './noise.mjs';

export const name = 'ground';
export const order = 2;

const S = 1024;
const ACG = (id) => `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;
const PH = (id) => `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_diff_1k.jpg`;

export const sources = [
  // --- grass ---------------------------------------------------------------
  { id: 'Grass004', provider: 'ambientCG', url: ACG('Grass004'), license: 'CC0 1.0', usedFor: ['grass.webp', 'grass_snow.webp'], note: 'dense garden grass with individual blades 2-6 px wide and 20-60 px long at 1024² — the greyscale luminance for the 7 m grass tile. The blades have to survive the pipeline: a high-pass at sigma 70 turned them into 3-6 px speckle, sigma 128 with keep 0.3 keeps them' },
  { id: 'Snow005', provider: 'ambientCG', url: ACG('Snow005'), license: 'CC0 1.0', usedFor: ['grass_snow.webp'], note: 'flat clean snow (Snow006, looked at first, carries footprints that turned into black blobs once stretched): the white that fills the grass in winter, plus the snow mounds in the height' },
  // --- forest floor --------------------------------------------------------
  { id: 'Ground082S', provider: 'ambientCG', url: ACG('Ground082S'), license: 'CC0 1.0', usedFor: ['forest_summer.webp', 'forest_spring.webp', 'forest_winter.webp'], note: 'rich brown forest soil with litter — base of the needle-litter tile' },
  { id: 'Ground023', provider: 'ambientCG', url: ACG('Ground023'), license: 'CC0 1.0', usedFor: ['forest_summer.webp', 'forest_spring.webp', 'forest_winter.webp'], note: 'dark fine litter and needles on earth — the litter half of the forest floor' },
  { id: 'Ground072', provider: 'ambientCG', url: ACG('Ground072'), license: 'CC0 1.0', usedFor: ['forest_summer.webp', 'stubble.webp'], note: 'dense dry straw/needle mat: needle-like strands in the forest floor and the straw stubs of the stubble field' },
  { id: 'Moss001', provider: 'ambientCG', url: ACG('Moss001'), license: 'CC0 1.0', usedFor: ['forest_summer.webp', 'forest_spring.webp'], note: 'moss with soil and leaf litter — the green patches in the summer floor and the fresh green of spring' },
  { id: 'Moss003', provider: 'ambientCG', url: ACG('Moss003'), license: 'CC0 1.0', usedFor: ['forest_spring.webp', 'rock.webp'], note: 'pure green moss — spring growth, and the moss in rock crevices' },
  { id: 'Snow011', provider: 'ambientCG', url: ACG('Snow011'), license: 'CC0 1.0', usedFor: ['forest_winter.webp'], note: 'snow ground with dirt speckle — the frost speckle in the hollows of the frozen litter' },
  { id: 'Ground048', provider: 'ambientCG', url: ACG('Ground048'), license: 'CC0 1.0', usedFor: ['soil.webp'], note: 'plain brown cloddy earth — bare ploughed soil' },
  // --- autumn litter -------------------------------------------------------
  { id: 'ScatteredLeaves008', provider: 'ambientCG', url: ACG('ScatteredLeaves008'), license: 'CC0 1.0', usedFor: ['forest_autumn.webp'], note: 'dense yellow-brown fallen leaves — the base of the autumn litter' },
  { id: 'ScatteredLeaves009', provider: 'ambientCG', url: ACG('ScatteredLeaves009'), license: 'CC0 1.0', usedFor: ['forest_autumn.webp'], note: 'browner, finer leaf litter — mixed in so the autumn floor is not one flat yellow' },
  { id: 'ScatteredLeaves006', provider: 'ambientCG', url: ACG('ScatteredLeaves006'), license: 'CC0 1.0', usedFor: ['forest_autumn.webp'], note: 'single leaves on black: cut out (alpha from luminance) and pasted as whole leaves' },
  { id: 'Leaf001', provider: 'ambientCG', url: ACG('Leaf001'), license: 'CC0 1.0', usedFor: ['forest_autumn.webp'], note: 'whole broadleaf on black — pasted large, tinted to autumn' },
  // --- peat, gravel, rock, sand -------------------------------------------
  { id: 'brown_mud_03', provider: 'Poly Haven', url: PH('brown_mud_03'), license: 'CC0 1.0', usedFor: ['peat.webp'], note: 'dark wet mud with clumps — the peat base (Poly Haven ships no displacement, so its height comes from blurred luminance)' },
  { id: 'Ground031', provider: 'ambientCG', url: ACG('Ground031'), license: 'CC0 1.0', usedFor: ['peat.webp'], note: 'cracked dry earth crust — only its crack network is multiplied into the peat, and its displacement deepens those cracks' },
  { id: 'Gravel003', provider: 'ambientCG', url: ACG('Gravel003'), license: 'CC0 1.0', usedFor: ['gravel.webp'], note: 'fine grained gravel with a dust matrix — the verge gravel base' },
  { id: 'gravel', provider: 'Poly Haven', url: PH('gravel'), license: 'CC0 1.0', usedFor: ['gravel.webp'], note: 'warmer brown fine gravel — blended in patches so the verge is grey-brown rather than beige' },
  { id: 'Rock051', provider: 'ambientCG', url: ACG('Rock051'), license: 'CC0 1.0', usedFor: ['rock.webp', 'rock_height.webp'], note: 'grey-brown layered fractured rock with moss bands — the cutting rock; its ambient-occlusion map darkens the crevices and its dark fracture lines give the crack map (Rock030 was tried first and dropped: its structure is 200-400 px across, so at a 9 m repeat it read as one blotch)' },
  { id: 'Ground089', provider: 'ambientCG', url: ACG('Ground089'), license: 'CC0 1.0', usedFor: ['sand.webp'], note: 'smooth warm ochre sand — mixed into the shore base for its colour' },
  { id: 'coast_sand_02', provider: 'Poly Haven', url: PH('coast_sand_02'), license: 'CC0 1.0', usedFor: ['sand.webp'], note: 'warm grey-brown shore sand with fine grain; Poly Haven ships a displacement map for it, so the shore height is a real one (…_disp_1k.jpg)' },
  { id: 'Gravel001', provider: 'ambientCG', url: ACG('Gravel001'), license: 'CC0 1.0', usedFor: ['sand.webp'], note: 'washed small stones — cut out as the pebbles at the waterline' },
];

export const outputs = [
  {
    file: 'grass.webp',
    size: [S, S],
    channels: 'RGB grey + A(height)',
    tiling_m: 7,
    role: 'ground',
    note: 'neutral grey grass luminance, bright blade tips and dark bases, seamless; desaturated so R=G=B exactly (the shader supplies the green and the dry-peak tints). Height from the Grass004 displacement map.'
  },
  {
    file: 'grass_snow.webp',
    size: [S, S],
    channels: 'RGB grey + A(height)',
    tiling_m: 7,
    role: 'ground',
    note: 'winter grass: nearly white (mean 0.72) with faint dry-stalk structure and soft snow mounds. Height mixes the snow displacement (mounds) with the grass displacement (stalks).'
  },
  {
    file: 'forest_summer.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 9,
    role: 'ground',
    note: 'brown needle and twig litter with moss patches. Height from the Ground082S displacement blended with Ground023.'
  },
  {
    file: 'forest_spring.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 9,
    role: 'ground',
    note: 'same litter family as summer with much more moss and fresh green growth over last year needles; clearly greener, not merely brighter. Height from the same displacement blend.'
  },
  {
    file: 'forest_autumn.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 9,
    role: 'ground',
    note: 'broadleaf litter: dense leaf floor plus whole leaves cut from photo sources and pasted with wrap-around, each with a contact shadow and a darkened rim. Height from the leaf base displacement, raised where a whole leaf lies.'
  },
  {
    file: 'forest_winter.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 9,
    role: 'ground',
    note: 'frozen and thawed litter: dull grey-brown soil and needles, frost speckle in the hollows, bright (mean 0.58) but not white. Height as summer, with frost filling the lows.'
  },
  {
    file: 'soil.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 8,
    role: 'ground',
    note: 'bare ploughed earth: matte mid-brown clods. Height from the Ground048 displacement map (clods read in the alpha).'
  },
  {
    file: 'stubble.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 6,
    role: 'ground',
    note: 'harvested grain field: dry soil with broken straw, short straw stubs standing in rows. All structure comes from photo sources (Ground102 soil, Ground072 straw), nothing drawn. Height from the soil displacement plus the straw ridges.'
  },
  {
    file: 'peat.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 8,
    role: 'ground',
    note: 'wet dark peat: very dark brown clumps (mean luminance 0.26), a spider-web crack network taken from Ground031, standing water in the lowest spots of the height. Height from the mud luminance blended with the crack displacement.'
  },
  {
    file: 'gravel.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 5,
    role: 'ground',
    note: 'the verge strip: fine washed grey-brown gravel with a dust matrix, stones 2-10 px. Height from the Gravel003 displacement map.'
  },
  {
    file: 'rock.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 9,
    role: 'ground',
    note: 'cutting and ravine rock: grey-brown fractured layered rock with moss and dirt in the crevices (moss masked by the displacement lows). Height is the same crack map as rock_height.'
  },
  {
    file: 'rock_height.webp',
    size: [S, S],
    channels: 'grey',
    tiling_m: 9,
    role: 'ground',
    note: 'the crack and bump map: white crest, black cracks, std >= 0.18, from the Rock030 displacement map with its large blotches removed. Used as a height-blend weight and a bump input.'
  },
  {
    file: 'sand.webp',
    size: [S, S],
    channels: 'RGB + A(height)',
    tiling_m: 6,
    role: 'ground',
    note: 'silt and sand shore: warm grey-ochre with fine ripples, small pebbles cut from Gravel001 where the height is lowest, dark waterline staining in the same lows. Height from the Ground083 displacement.'
  }
];

// ---------------------------------------------------------------------------
// sources and heights

const memo = new Map();
const acgZip = (id) => ({ url: ACG(id), cache: `${id}_1K-JPG.zip`, unpack: id });

/** One channel-`ch` 1024² image from an ambientCG material (cc0, 1K). */
async function acg(id, { ch = 3, map = 'Color' } = {}) {
  const key = `acg:${id}:${map}:${ch}`;
  if (memo.has(key)) return memo.get(key);
  const { dir } = await obtain(acgZip(id));
  const files = await listFiles(dir, new RegExp(`_${map}\\.jpg$`, 'i'));
  if (!files.length) throw new Error(`${id}: no *_${map}.jpg in ${dir}`);
  const loaded = await loadImage(files.sort()[0], { ch });
  const out = loaded.w === S && loaded.h === S ? loaded : wrapResample(loaded, S, S);
  memo.set(key, out);
  return out;
}

/** One channel-`ch` 1024² image from a Poly Haven diffuse (cc0, 1K). */
async function ph(id, { ch = 3 } = {}) {
  const key = `ph:${id}:${ch}`;
  if (memo.has(key)) return memo.get(key);
  const file = await fetchTo(PH(id), `ph_${id}_diff_1k.jpg`);
  const loaded = await loadImage(file, { ch });
  const out = loaded.w === S && loaded.h === S ? loaded : wrapResample(loaded, S, S);
  memo.set(key, out);
  return out;
}

const PH_IDS = new Set(['brown_mud_03', 'gravel', 'coast_sand_02']);
const colorOf = (id) => (PH_IDS.has(id) ? ph(id) : acg(id, { ch: 3 }));

/** Poly Haven displacement, where the asset ships one (…_disp_1k.jpg). */
async function phDisp(id) {
  const key = `phdisp:${id}`;
  if (memo.has(key)) return memo.get(key);
  const file = await fetchTo(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_disp_1k.jpg`, `ph_${id}_disp_1k.jpg`);
  const loaded = await loadImage(file, { ch: 1 });
  const out = loaded.w === S && loaded.h === S ? loaded : wrapResample(loaded, S, S);
  memo.set(key, out);
  return out;
}

/** Height source: the provider's displacement map when it ships one. */
async function dispOf(id) {
  return PH_IDS.has(id) ? phDisp(id) : acg(id, { map: 'Displacement', ch: 1 });
}

/**
 * Height channel: centred on 0.5 with a chosen spread, then wrapped-blurred.
 * Displacement maps are already a monotone field; luminance is a stand-in where
 * the provider ships no displacement, and the note on the output says which.
 */
async function height(a, { std = 0.22, sigma = 1.2 } = {}) {
  const m = mean(a);
  let v = 0;
  for (let i = 0; i < a.w * a.h; i++) v += (a.data[i] - m) ** 2;
  const s = Math.max(1e-5, Math.sqrt(v / (a.w * a.h)));
  const out = img(a.w, a.h, 1);
  for (let i = 0; i < a.w * a.h; i++) out.data[i] = clamp01(0.5 + (a.data[i] - m) * (std / s));
  return sigma > 0.15 ? wrapBlur(out, sigma) : out;
}

const heightFromLuma = (rgb, opts) => height(grey(rgb), opts);

/**
 * Build a 1-channel composite to an exact mean and std from parts of unknown
 * brightness. Composing in raw 0..1 and equalising afterwards is what turns a
 * faint source (snow's own std is 0.05) into a 10x-amplified blotch pattern.
 */
function compose(parts, { mean: m0 = 0.5, std: s0 = 0.1 } = {}) {
  const n = parts[0].img.w * parts[0].img.h;
  const stats = parts.map(({ img: im }) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += im.data[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (im.data[i] - m) ** 2;
    return { m, s: Math.max(1e-5, Math.sqrt(v / n)) };
  });
  const norm = Math.hypot(...parts.map((p) => p.w));
  const out = img(parts[0].img.w, parts[0].img.h, 1);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    parts.forEach((p, k) => {
      const z = (p.img.data[i] - stats[k].m) / stats[k].s;
      acc += p.w * Math.max(-2.5, Math.min(2.5, z));
    });
    out.data[i] = clamp01(m0 + (acc / norm) * s0);
  }
  return out;
}

/** Pull chroma out toward each pixel's own luminance. */
function desaturate(a, t) {
  const out = clone(a);
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * a.ch;
    const l = lum(a.data[o], a.data[o + 1], a.data[o + 2]);
    for (let c = 0; c < 3; c++) out.data[o + c] = clamp01(mix(a.data[o + c], l, t));
  }
  return out;
}

/** Blend two images of the same size, per channel. */
function blend(a, b, t) {
  const out = clone(a);
  for (let i = 0; i < a.w * a.h; i++)
    for (let c = 0; c < a.ch; c++)
      out.data[i * a.ch + c] = a.data[i * a.ch + c] * (1 - t) + b.data[i * a.ch + c] * t;
  return out;
}

/** dst = mix(dst, src, mask·gain), optionally keeping dst's luminance. */
function patch(dst, src, mask, { gain = 1, keepLuma = true } = {}) {
  const out = clone(dst);
  for (let i = 0; i < dst.w * dst.h; i++) {
    const t = clamp01(mask.data[i] * gain);
    if (t <= 0) continue;
    const o = i * dst.ch;
    const l0 = keepLuma ? lum(dst.data[o], dst.data[o + 1], dst.data[o + 2]) : 0;
    let r = dst.data[o] * (1 - t) + src.data[i * src.ch] * t;
    let g = dst.data[o + 1] * (1 - t) + src.data[i * src.ch + 1] * t;
    let bl = dst.data[o + 2] * (1 - t) + src.data[i * src.ch + 2] * t;
    if (keepLuma) {
      const l1 = lum(r, g, bl);
      const k = l1 > 1e-4 ? l0 / l1 : 1;
      r *= k;
      g *= k;
      bl *= k;
    }
    out.data[o] = clamp01(r);
    out.data[o + 1] = clamp01(g);
    out.data[o + 2] = clamp01(bl);
  }
  return out;
}

/** Darken (or brighten) where height is low: `strength` at the bottom, 0 at `top`. */
function stain(rgb, h, { strength = 0.4, top = 0.35, tint = [0.7, 0.72, 0.8] } = {}) {
  const out = clone(rgb);
  for (let i = 0; i < rgb.w * rgb.h; i++) {
    const t = clamp01(1 - h.data[i] / top) * strength;
    if (t <= 0) continue;
    const o = i * rgb.ch;
    for (let c = 0; c < 3; c++) out.data[o + c] = clamp01(mix(rgb.data[o + c], rgb.data[o + c] * tint[c], t));
  }
  return out;
}

/** Wrap-aware grey copy of a colour image (drops colour, keeps the structure). */
const greyOf = (rgb) => greyTile(grey(rgb));

/** Wrap-aware low-frequency mask in 0..1 from fbm, centred on `pivot`. */
function patchMask(seed, { px = 8, octaves = 3, maxCells = 64, gain = 0.5 } = {}, { lo = 0.45, hi = 0.6 } = {}) {
  const n = fbm(S, S, { px, py: px, octaves, gain, maxCells, seed });
  const m = img(S, S, 1);
  for (let i = 0; i < S * S; i++) {
    const t = clamp01((n.data[i] - lo) / (hi - lo));
    m.data[i] = t * t * (3 - 2 * t);
  }
  return m;
}

// ---------------------------------------------------------------------------
// cut-outs (whole leaves, straw stubs, pebbles)

/** Alpha from luminance over a black background, with a one-pixel-soft ramp. */
function alphaFromBlack(rgb, { lo = 0.06, hi = 0.16 } = {}) {
  const l = grey(rgb);
  const a = img(rgb.w, rgb.h, 1);
  for (let i = 0; i < l.w * l.h; i++) {
    const t = clamp01((l.data[i] - lo) / (hi - lo));
    a.data[i] = t * t * (3 - 2 * t);
  }
  return a;
}

/** Connected components of an alpha mask, so each leaf is pasted on its own. */
function components(alpha, { minPixels = 500 } = {}) {
  const { w, h } = alpha;
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || alpha.data[i] < 0.5) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    let area = 0;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w;
      const y = (j / w) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (!seen[k] && alpha.data[k] >= 0.5) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (area >= minPixels) out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area });
  }
  return out;
}

/** Cut-out: RGB plus its alpha, cropped from a component with a margin. */
function cutOut(rgb, alpha, box, pad = 6) {
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(rgb.w, box.x1 + pad);
  const y1 = Math.min(rgb.h, box.y1 + pad);
  return { rgb: crop(rgb, x0, y0, x1 - x0, y1 - y0), alpha: crop(alpha, x0, y0, x1 - x0, y1 - y0), box };
}

/** Recolour a cut-out along its own luminance, keeping its shape and shading. */
function tint(cut, [r, g, b], { gain = 1 } = {}) {
  const a = cut.alpha;
  const rgb = img(cut.rgb.w, cut.rgb.h, 3);
  for (let i = 0; i < a.w * a.h; i++) {
    const k = gain * (0.35 + 0.9 * a.data[i]);
    rgb.data[i * 3] = clamp01(r * k);
    rgb.data[i * 3 + 1] = clamp01(g * k);
    rgb.data[i * 3 + 2] = clamp01(b * k);
  }
  return { rgb, alpha: a, box: cut.box };
}

const sampleBilinear = (a, c, x, y) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx, yy) => {
    const cx = Math.min(a.w - 1, Math.max(0, xx));
    const cy = Math.min(a.h - 1, Math.max(0, yy));
    return a.data[(cy * a.w + cx) * a.ch + c];
  };
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
};

/**
 * Paste a cut-out with a rotation and a scale, wrap-around, with a soft contact
 * shadow underneath and a darkened rim: that is what stops a pasted leaf from
 * reading as a sticker.
 */
function pasteCut(dst, cut, { x, y, angle = 0, scale = 1, shadow = 0.45, rim = 0.3 } = {}) {
  const { w, h, ch } = dst;
  const cw = cut.rgb.w;
  const chh = cut.rgb.h;
  const sw = Math.ceil(cw * scale);
  const sh = Math.ceil(chh * scale);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ix = 1 / scale;
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const px = (i - sw / 2) * ix + cw / 2;
      const py = (j - sh / 2) * ix + chh / 2;
      const sx = (px - cw / 2) * cos + (py - chh / 2) * sin + cw / 2;
      const sy = -(px - cw / 2) * sin + (py - chh / 2) * cos + chh / 2;
      if (sx < 0 || sy < 0 || sx >= cw - 1 || sy >= chh - 1) continue;
      const iw = ((x + i) % w + w) % w;
      const jh = ((y + j) % h + h) % h;
      const o = (jh * w + iw) * ch;
      // contact shadow: the same leaf, offset down-right and softened
      const sa = sampleBilinear(cut.alpha, 0, sx - 6 * ix, sy - 7 * ix) * shadow;
      if (sa > 0) for (let c = 0; c < 3; c++) dst.data[o + c] = clamp01(dst.data[o + c] * (1 - sa));
      const a = sampleBilinear(cut.alpha, 0, sx, sy);
      if (a <= 0.002) continue;
      // 1 px darkened rim so the leaf has an edge instead of a cut line
      const edge = clamp01(a - sampleBilinear(cut.alpha, 0, sx - 1.4 * ix, sy - 1.4 * ix)) * rim;
      for (let c = 0; c < 3; c++) {
        const base = dst.data[o + c] * (1 - edge);
        dst.data[o + c] = clamp01(base * (1 - a) + sampleBilinear(cut.rgb, c, sx, sy) * a);
      }
    }
  }
  return dst;
}

/** Feathered round paste for stubs and pebbles: no rectangular edge can show. */
function pasteSoft(dst, src, { x, y, angle = 0, scale = 1, feather = 0.45, mask = null, weight = 1 }) {
  const { w, h, ch } = dst;
  const sw = Math.ceil(src.w * scale);
  const sh = Math.ceil(src.h * scale);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ix = 1 / scale;
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const u = (i + 0.5) / sw - 0.5;
      const v = (j + 0.5) / sh - 0.5;
      const rr = Math.hypot(u, v) / 0.5;
      const a = 1 - clamp01((rr - (1 - feather)) / feather);
      const wgt = a * a * (3 - 2 * a) * weight;
      if (wgt <= 0.002) continue;
      const px = (i - sw / 2) * ix + src.w / 2;
      const py = (j - sh / 2) * ix + src.h / 2;
      const sx = (px - src.w / 2) * cos + (py - src.h / 2) * sin + src.w / 2;
      const sy = -(px - src.w / 2) * sin + (py - src.h / 2) * cos + src.h / 2;
      if (sx < 0 || sy < 0 || sx >= src.w - 1 || sy >= src.h - 1) continue;
      const iw = ((x + i) % w + w) % w;
      const jh = ((y + j) % h + h) % h;
      const o = (jh * w + iw) * ch;
      if (mask) mask.data[jh * w + iw] = clamp01(mask.data[jh * w + iw] + wgt);
      for (let c = 0; c < 3; c++)
        dst.data[o + c] = clamp01(dst.data[o + c] * (1 - wgt) + sampleBilinear(src, c, sx, sy) * wgt);
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// the thirteen tiles

async function grassTile() {
  const c = await acg('Grass004', { ch: 3 });
  const g = greyOf(c);
  // sigma 128, keep 0.3: a tighter high-pass removes the blade structure itself
  // and leaves speckle, which reads as gravel rather than grass under the tint
  // (docs/slowroads-steam/notes/SrGround.md §1 needs dark bases and bright tips).
  const hp = wrapHighpass(g, 128, { keep: 0.3 });
  const rgb = equaliseSoft(hp, { mean: 0.5, std: 0.16 });
  const h = await height(await dispOf('Grass004'), { std: 0.2 });
  return withHeight(rgb, h);
}

async function grassSnowTile() {
  const grass = await acg('Grass004', { ch: 3 });
  const snow = await acg('Snow005', { ch: 3 });
  const g = wrapBlur(grey(grass), 0.8);
  const s = grey(snow);
  // Nearly white with faint stalks on it: slowroads' winter grass tile is
  // almost flat (std 0.007), so the structure here has to be measured in, not
  // left to whatever the two sources happen to add up to.
  const coloured = compose(
    [
      { img: s, w: 1 },
      { img: g, w: 0.45 }
    ],
    { mean: 0.72, std: 0.045 }
  );
  const mounds = await height(await dispOf('Snow005'), { std: 0.26, sigma: 10 });
  const stalks = await height(await dispOf('Grass004'), { std: 0.15 });
  const h = img(S, S, 1);
  for (let i = 0; i < S * S; i++)
    h.data[i] = clamp01(0.5 + (mounds.data[i] - 0.5) + (stalks.data[i] - 0.5) * 0.25);
  return withHeight(greyTile(coloured), h);
}

/** Shared forest-floor base: brown litter and needles, moss left out. */
async function forestBase() {
  const soil = await acg('Ground082S', { ch: 3 });
  const litter = await acg('Ground023', { ch: 3 });
  const straw = await acg('Ground072', { ch: 3 });
  let rgb = blend(soil, litter, 0.42);
  rgb = blend(rgb, straw, 0.18);
  rgb = wrapHighpass(rgb, 85, { keep: 0.13 });
  return equaliseSoft(rgb, { mean: 0.26, std: 0.18, luma: true });
}

async function forestFloorHeight() {
  const a = await height(await dispOf('Ground082S'), { std: 0.22 });
  const b = await height(await dispOf('Ground023'), { std: 0.22 });
  const out = img(S, S, 1);
  for (let i = 0; i < S * S; i++) out.data[i] = clamp01(0.5 + (a.data[i] - 0.5) * 0.6 + (b.data[i] - 0.5) * 0.4);
  return out;
}

async function forestSummerTile() {
  const base = await forestBase();
  const moss = await acg('Moss001', { ch: 3 });
  const mask = patchMask(101, { px: 5, octaves: 3, maxCells: 32 }, { lo: 0.55, hi: 0.75 });
  const rgb = patch(base, moss, mask, { gain: 0.55 });
  return withHeight(rgb, await forestFloorHeight());
}

async function forestSpringTile() {
  const base = await forestBase();
  const moss = await acg('Moss001', { ch: 3 });
  const green = await acg('Moss003', { ch: 3 });
  // Spring is the same floor with the moss well up over it: more coverage, and a
  // second, brighter moss mixed in at the top of the mask.
  const mask = patchMask(202, { px: 5, octaves: 3, maxCells: 32 }, { lo: 0.3, hi: 0.6 });
  let rgb = patch(base, moss, mask, { gain: 0.85 });
  const over = patchMask(203, { px: 7, octaves: 2, maxCells: 28 }, { lo: 0.5, hi: 0.72 });
  rgb = patch(rgb, green, over, { gain: 0.7 });
  rgb = equaliseSoft(rgb, { mean: 0.3, std: 0.18, luma: true });
  return withHeight(rgb, await forestFloorHeight());
}

async function forestAutumnTile() {
  const dense = await acg('ScatteredLeaves008', { ch: 3 });
  const brown = await acg('ScatteredLeaves009', { ch: 3 });
  const below = await acg('Ground023', { ch: 3 });
  let rgb = blend(dense, brown, 0.3);
  // a little bare litter between the leaves: the owner's photo is a carpet with
  // holes in it, not an unbroken sheet
  rgb = blend(rgb, below, 0.12);
  rgb = wrapHighpass(rgb, 85, { keep: 0.13 });
  rgb = equaliseSoft(rgb, { mean: 0.32, std: 0.18, luma: true });
  // The owner's photo of a birch wood has G/R 0.9 and R/B 2.6; the leaf sources
  // are warmer (more orange) than that, so chroma comes out here and on the
  // tinted cut-outs below.

  // Whole leaves on top. Their alpha comes from the source's own black
  // background, so the shapes and their shading are the photographed ones; only
  // the colour is ours, because a green summer leaf does not tile an autumn
  // floor. At 9 m per tile a birch leaf is 4-8 px, so these go on at 10-30 px —
  // large enough to read as a leaf, small enough not to read as a collage.
  const r = rng(4242);
  const cutSources = [
    {
      rgb: await acg('ScatteredLeaves006', { ch: 3 }),
      min: 120,
      px: [10, 22],
      repeat: 2,
      colours: [[0.7, 0.6, 0.26], [0.6, 0.51, 0.22], [0.52, 0.43, 0.19], [0.76, 0.66, 0.3]]
    },
    {
      rgb: await acg('Leaf001', { ch: 3 }),
      min: 3000,
      px: [16, 30],
      repeat: 1,
      colours: [[0.68, 0.57, 0.24], [0.6, 0.5, 0.2], [0.74, 0.64, 0.3]]
    }
  ];
  for (const src of cutSources) {
    const alpha = alphaFromBlack(src.rgb, { lo: 0.07, hi: 0.18 });
    const boxes = components(alpha, { minPixels: src.min });
    for (let pass = 0; pass < src.repeat; pass++) {
      for (const box of boxes) {
        const cut = cutOut(src.rgb, alpha, box, 5);
        const col = src.colours[Math.floor(r() * src.colours.length)];
        const bright = 0.72 + r() * 0.5;
        const tinted = tint(cut, col, { gain: bright });
        const want = src.px[0] + r() * (src.px[1] - src.px[0]);
        pasteCut(rgb, tinted, {
          x: Math.floor(r() * S),
          y: Math.floor(r() * S),
          angle: r() * Math.PI * 2,
          scale: want / Math.max(cut.rgb.w, cut.rgb.h),
          shadow: 0.3,
          rim: 0.3
        });
      }
    }
  }
  rgb = equaliseSoft(rgb, { mean: 0.32, std: 0.18, luma: true, iterations: 2 });

  const h = await height(await dispOf('ScatteredLeaves008'), { std: 0.22 });
  const leaf = greyTile(grey(rgb));
  const out = img(S, S, 1);
  for (let i = 0; i < S * S; i++)
    out.data[i] = clamp01(h.data[i] * 0.75 + 0.25 * clamp01((leaf.data[i * 3] - 0.42) / 0.3));
  return withHeight(rgb, wrapBlur(out, 1));
}

async function forestWinterTile() {
  const base = await forestBase();
  const l = grey(base);
  const desat = img(S, S, 3);
  for (let i = 0; i < S * S; i++) {
    // Grey it down but keep a third of the litter's brown: frozen ground is
    // dull, not neutral.
    const v = clamp01(0.62 + (l.data[i] - 0.45) * 0.85);
    for (let c = 0; c < 3; c++) desat.data[i * 3 + c] = clamp01(base.data[i * 3 + c] * 0.3 + v * 0.7);
  }
  const snow = await acg('Snow011', { ch: 3 });
  const h = await forestFloorHeight();
  // frost settles in the hollows, so the mask is the low half of the height
  const frost = img(S, S, 1);
  for (let i = 0; i < S * S; i++) frost.data[i] = clamp01((0.5 - h.data[i]) / 0.22) * 0.5;
  let rgb = patch(desat, snow, frost, { gain: 0.8 });
  rgb = equaliseSoft(rgb, { mean: 0.55, std: 0.17, luma: true });
  const warmed = img(S, S, 3);
  for (let i = 0; i < S * S; i++) {
    warmed.data[i * 3] = clamp01(rgb.data[i * 3] * 1.04);
    warmed.data[i * 3 + 1] = rgb.data[i * 3 + 1];
    warmed.data[i * 3 + 2] = clamp01(rgb.data[i * 3 + 2] * 0.93);
  }
  rgb = warmed;
  const out = img(S, S, 1);
  for (let i = 0; i < S * S; i++) out.data[i] = clamp01(0.5 + (h.data[i] - 0.5) * 0.8 + (frost.data[i] - 0.25) * 0.5);
  return withHeight(rgb, wrapBlur(out, 1));
}

async function soilTile() {
  const c = await acg('Ground048', { ch: 3 });
  const rgb = equaliseSoft(wrapHighpass(c, 80, { keep: 0.14 }), { mean: 0.36, std: 0.18, luma: true });
  return withHeight(rgb, await height(await dispOf('Ground048'), { std: 0.24 }));
}

async function stubbleTile() {
  const soil = await acg('Ground102', { ch: 3 });
  const straw = await acg('Ground072', { ch: 3 });
  let rgb = blend(soil, straw, 0.4);
  rgb = wrapHighpass(rgb, 75, { keep: 0.14 });
  rgb = equaliseSoft(rgb, { mean: 0.45, std: 0.17, luma: true });

  const strawLuma = grey(straw);
  // The stubs are the stalks the straw photo already contains, lifted out of the
  // mat by a band pass and put back only inside the rows: no drawn lines, no
  // pasted clumps.
  const stalk = wrapHighpass(strawLuma, 6, { keep: 0.25 });
  const band = fbm(S, S, { px: 12, py: 3, octaves: 2, gain: 0.5, maxCells: 24, seed: 909 });
  const grain = turbulence(S, S, { px: 24, py: 24, octaves: 3, gain: 0.5, maxCells: 96, seed: 911 });
  const stubMask = img(S, S, 1);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const p = ((y / S) * 26 + (band.data[i] - 0.5) * 0.35) % 1;
      const inRow = 1 - clamp01(Math.abs(p - 0.5) / 0.34);
      const m = inRow * inRow * (3 - 2 * inRow) * clamp01(0.45 + 1.5 * (grain.data[i] - 0.45));
      stubMask.data[i] = m * clamp01(0.25 + 0.9 * stalk.data[i]);
    }
  }
  // rows read as rows because the stubs are both lighter and higher there
  const rows = img(S, S, 3);
  for (let i = 0; i < S * S; i++) {
    const m = stubMask.data[i];
    for (let c = 0; c < 3; c++) rows.data[i * 3 + c] = clamp01(rgb.data[i * 3 + c] * (0.95 + 0.14 * m));
  }
  rgb = patch(rgb, rows, stubMask, { gain: 0.8 });

  const base = await height(await dispOf('Ground102'), { std: 0.18 });
  const out = img(S, S, 1);
  for (let i = 0; i < S * S; i++) out.data[i] = clamp01(base.data[i] * 0.72 + stubMask.data[i] * 0.22);
  return withHeight(rgb, wrapBlur(out, 1));
}

async function peatTile() {
  const mud = await colorOf('brown_mud_03');
  let rgb = wrapHighpass(mud, 80, { keep: 0.13 });
  rgb = equaliseSoft(rgb, { mean: 0.24, std: 0.15, luma: true });

  const crack = await acg('Ground031', { ch: 3 });
  const crackLuma = grey(crack);
  const crackMask = img(S, S, 1);
  for (let i = 0; i < S * S; i++) crackMask.data[i] = clamp01(1 - crackLuma.data[i] / 0.3) * 0.6;
  rgb = patch(rgb, crack, crackMask, { gain: 1, keepLuma: false });

  const h = img(S, S, 1);
  const hMud = await heightFromLuma(mud, { std: 0.16, sigma: 2 });
  const hCrack = await height(await dispOf('Ground031'), { std: 0.2 });
  for (let i = 0; i < S * S; i++) h.data[i] = clamp01(0.5 + (hMud.data[i] - 0.5) * 0.7 + (hCrack.data[i] - 0.5) * 0.5);
  // standing water in the lowest spots: darker, cooler, a little flatter
  const wet = img(S, S, 1);
  for (let i = 0; i < S * S; i++) wet.data[i] = clamp01((0.42 - h.data[i]) / 0.16);
  const blurred = wrapBlur(wet, 3);
  // The equalisation has to come after the water darkening, or the pools pull
  // the tile below the target luminance.
  const stained = equaliseSoft(stain(rgb, blurred, { strength: 0.62, top: 1, tint: [0.62, 0.66, 0.82] }), {
    mean: 0.24,
    std: 0.15,
    luma: true
  });
  const out = img(S, S, 1);
  for (let i = 0; i < S * S; i++) out.data[i] = clamp01(h.data[i] * (1 - 0.25 * blurred.data[i]));
  return withHeight(stained, wrapBlur(out, 1));
}

async function gravelTile() {
  const a = await acg('Gravel003', { ch: 3 });
  const b = await colorOf('gravel');
  const mask = patchMask(303, { px: 9, octaves: 3, maxCells: 48 }, { lo: 0.45, hi: 0.65 });
  let rgb = patch(a, b, mask, { gain: 0.4, keepLuma: true });
  rgb = wrapHighpass(rgb, 40, { keep: 0.1 });
  // slowroads' verge gravel is smooth (std 0.043) with the stones just visible;
  // ours keeps more contrast so the 3-10 px stones read, but not the 0.15 of a
  // grass tile.
  rgb = equaliseSoft(rgb, { mean: 0.4, std: 0.18, luma: true });
  // The stone grain is what matters, not the handful of big lumps the 1K
  // displacement carries, so cut its lows before it becomes height.
  const centred = await height(await dispOf('Gravel003'), { std: 0.22, sigma: 1.2 });
  return withHeight(rgb, equaliseSoft(wrapHighpass(centred, 25, { keep: 0.06 }), { mean: 0.5, std: 0.18 }));
}

/**
 * The rock crack map, shared by rock.webp and rock_height.webp: the albedo's own
 * dark lines are the cracks, and they align with the colour by construction. The
 * displacement map adds the bedding planes underneath.
 */
async function rockCrackMap() {
  const colour = await acg('Rock051', { ch: 3 });
  const dark = img(S, S, 1);
  for (let i = 0; i < S * S; i++)
    dark.data[i] = clamp01((1 - lum(colour.data[i * 3], colour.data[i * 3 + 1], colour.data[i * 3 + 2])) * 1.35);
  const darkH = await height(dark, { std: 0.3, sigma: 0.8 });
  const d = await height(await dispOf('Rock051'), { std: 0.3, sigma: 1.2 });
  const mixed = img(S, S, 1);
  for (let i = 0; i < S * S; i++) mixed.data[i] = clamp01(0.75 * darkH.data[i] + 0.25 * d.data[i]);
  const hp = wrapHighpass(mixed, 120, { keep: 0.15 });
  // a mild lift so the cracks are thin and dark on a light field, the way the
  // slowroads bump map reads, while the channel still sits on 0.5 as a height
  const lifted = img(S, S, 1);
  for (let i = 0; i < S * S; i++) lifted.data[i] = clamp01(Math.pow(hp.data[i], 1.5));
  return equaliseSoft(lifted, { mean: 0.5, std: 0.2 });
}

async function rockTile(crack) {
  const c = await acg('Rock051', { ch: 3 });
  const ao = await acg('Rock051', { map: 'AmbientOcclusion', ch: 1 });
  // A 180 px high-pass: the strata are 40-150 px and carry the look, but the
  // tile must not bring one enormous blotch around every 9 m.
  let rgb = wrapHighpass(c, 180, { keep: 0.22 });
  rgb = equaliseSoft(rgb, { mean: 0.44, std: 0.18, luma: true });
  // The provider's own ambient occlusion darkens the crevices. Without it the
  // rock reads as a flat sheet no matter how much contrast the albedo is given;
  // with it the crags come back without inventing a single line.
  const shaded = img(S, S, 3);
  for (let i = 0; i < S * S; i++) {
    const k = 0.45 + 0.55 * (0.35 + 1.1 * ao.data[i]);
    rgb.data[i * 3] *= 1.06 * k;
    rgb.data[i * 3 + 1] *= k;
    rgb.data[i * 3 + 2] *= 0.94 * k;
    for (let ch = 0; ch < 3; ch++) shaded.data[i * 3 + ch] = clamp01(rgb.data[i * 3 + ch]);
  }
  rgb = equaliseSoft(shaded, { mean: 0.4, std: 0.18, luma: true });
  return withHeight(rgb, crack);
}

async function sandTile() {
  const coarse = await colorOf('coast_sand_02');
  const warm = await acg('Ground089', { ch: 3 });
  let rgb = blend(coarse, warm, 0.45);
  // A 40 px high-pass: the shore has ripples and pebbles, not the 100 px dark
  // patches the two photos bring with them.
  rgb = wrapHighpass(rgb, 25, { keep: 0.04 });
  // Smooth next to the grass tile, the way slowroads' sand tile is (its std is
  // 0.04 against 0.17 for the grass).
  rgb = equaliseSoft(rgb, { mean: 0.55, std: 0.15, luma: true });
  const h0 = await height(await dispOf('coast_sand_02'), { std: 0.22, sigma: 1.5 });
  // the shore is ripples, so the displacement's own big soft lumps come out
  const h = equaliseSoft(wrapHighpass(h0, 60, { keep: 0.1 }), { mean: 0.5, std: 0.18 });

  const pebbles = await acg('Gravel001', { ch: 3 });
  const r = rng(606);
  const pebbleMask = img(S, S, 1);
  // pebbles wash up where the ground is lowest (the waterline)
  for (let n = 0; n < 120; n++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    if (h.data[y * S + x] > 0.3 + r() * 0.08) continue;
    const size = 16 + Math.floor(r() * 22);
    const piece = crop(pebbles, Math.floor(r() * (S - size)), Math.floor(r() * (S - size)), size, size);
    pasteSoft(rgb, piece, { x, y, angle: r() * 6.28, scale: 0.6 + r() * 0.5, feather: 0.7, weight: 0.3, mask: pebbleMask });
  }
  const stained = stain(rgb, h, { strength: 0.26, top: 0.24, tint: [0.72, 0.72, 0.78] });
  const out = img(S, S, 1);
  for (let i = 0; i < S * S; i++) out.data[i] = clamp01(h.data[i] + pebbleMask.data[i] * 0.22);
  return withHeight(stained, wrapBlur(out, 1));
}

export async function build({ force }) {
  void force;
  const done = [];
  const write = async (file, tile, quality = 84) => {
    if (tile.ch === 4) {
      const a = img(tile.w, tile.h, 1);
      for (let i = 0; i < tile.w * tile.h; i++) a.data[i] = tile.data[i * 4 + 3];
      const settled = settleHeight(a);
      for (let i = 0; i < tile.w * tile.h; i++) tile.data[i * 4 + 3] = settled.data[i];
    }
    const s = channelStats(tile);
    describe(file + ' RGB', tile, 0);
    if (tile.ch === 4) describe(file + ' A  ', tile, 3);
    console.log(
      `    ${file}: channels [${s.means.map((m) => m.toFixed(3)).join(' ')}] avg ${s.mean.toFixed(3)} ` +
        `std ${s.std.toFixed(3)}${tile.ch === 4 ? ` | height std ${stats(tile, 3).std.toFixed(3)}` : ''}`
    );
    await saveWebp(tile, file, { quality });
    done.push(file);
  };

  await write('grass.webp', await grassTile());
  await write('grass_snow.webp', await grassSnowTile());
  await write('forest_summer.webp', await forestSummerTile());
  await write('forest_spring.webp', await forestSpringTile());
  await write('forest_autumn.webp', await forestAutumnTile());
  await write('forest_winter.webp', await forestWinterTile());
  await write('soil.webp', await soilTile());
  await write('stubble.webp', await stubbleTile());
  await write('peat.webp', await peatTile());
  await write('gravel.webp', await gravelTile());
  const crack = await rockCrackMap();
  await write('rock.webp', await rockTile(crack));
  await write('rock_height.webp', greyTile(crack));
  await write('sand.webp', await sandTile());

  console.log(`--- ground: ${done.length} tiles`);
}
