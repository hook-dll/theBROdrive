// Comparison sheets: ours over slowroads, both flattened onto rgb(90,130,190) at
// the same width — the sign-off this pipeline uses (README, "Checking a rebuild").
//
//   node tools/look/cmp.mjs            # every sheet, into /tmp/omp-shots/veg2-*.jpg
//   node tools/look/cmp.mjs conifer    # only the sheets whose name contains this
//
// Not part of the build: nothing here is loaded by the game, and the sheets land
// in /tmp so they never join the repository. The slowroads build is a read-only
// reference at /tmp/slowroads (see docs/slowroads-steam/notes/SrTrees.md §2).

import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const sharp = createRequire(import.meta.url)('sharp');
const SR = '/tmp/slowroads/app/build/_app/immutable/assets';
const LOOK = 'public/look';
const OUT = '/tmp/omp-shots';
const FILTER = process.argv[2] ?? '';

/** The hashed slowroads asset that starts with `stem` (`summer_trees_0` → …webp). */
const sr = (stem) => {
  const f = readdirSync(SR).find((x) => x.startsWith(stem + '.'));
  if (!f) throw new Error(`missing the slowroads reference ${stem}`);
  return path.join(SR, f);
};

/**
 * Panels of one sheet, top to bottom. Each is a file (ours under public/look, the
 * reference through `sr()`), an optional crop, and the alpha to combine it with:
 * the conifer atlas keeps colour and cutout in two files, every other sheet is
 * RGBA already.
 */
const SHEETS = {
  'conifer-summer': [
    { file: `${LOOK}/trees_conifer_summer_m.webp`, alpha: `${LOOK}/trees_conifer_summer_a.webp` },
    { file: sr('summer_trees_1_m'), alpha: sr('summer_trees_1_a') }
  ],
  'conifer-winter': [
    { file: `${LOOK}/trees_conifer_winter_m.webp`, alpha: `${LOOK}/trees_conifer_winter_a.webp` },
    { file: sr('winter_trees_1_m'), alpha: sr('winter_trees_1_a') }
  ],
  'conifer-imposters': [
    { file: `${LOOK}/imposters_conifer_summer_d.webp` },
    { file: sr('summer_imposters_1_d'), rect: { x: 0, y: 512, w: 4096, h: 512 } }
  ],
  'deciduous-summer': [{ file: `${LOOK}/trees_deciduous_summer.webp` }, { file: sr('summer_trees_0') }],
  'deciduous-winter': [{ file: `${LOOK}/trees_deciduous_winter.webp` }, { file: sr('winter_trees_0') }],
  'imposters-summer': [
    { file: `${LOOK}/imposters_deciduous_summer_d.webp` },
    { file: sr('summer_imposters_0_d') }
  ],
  'imposters-autumn': [
    { file: `${LOOK}/imposters_deciduous_autumn_d.webp` },
    { file: sr('autumn_imposters_0_d') }
  ],
  'imposters-winter': [
    { file: `${LOOK}/imposters_deciduous_winter_d.webp` },
    { file: sr('winter_imposters_0_d') }
  ],
  'imposters-normals': [
    { file: `${LOOK}/imposters_deciduous_summer_n.webp` },
    { file: sr('summer_imposters_0_n') }
  ],
  // the four columns' bark strips, ours (birch, aspen, oak, lime) over slowroads'
  // (ash, sycamore, birch, beech): row 2 of theirs is the birch
  bark: [
    { file: `${LOOK}/trees_deciduous_summer.webp`, rect: { x: 0, y: 768, w: 4096, h: 256 } },
    { file: sr('summer_trees_0'), rect: { x: 0, y: 768, w: 4096, h: 256 } }
  ],
  'bush-summer': [{ file: `${LOOK}/bush_summer.webp` }, { file: sr('summer_bushes') }],
  'bush-winter': [{ file: `${LOOK}/bush_winter.webp` }, { file: sr('winter_bushes') }],
  'bush-autumn': [{ file: `${LOOK}/bush_autumn.webp` }, { file: sr('autumn_bushes') }]
};

/** Flatten one panel onto the blue background at `width`, as `{px, h}`. */
async function panel(spec, width) {
  let img = sharp(spec.file, { unlimited: true });
  if (spec.rect) img = img.extract({ left: spec.rect.x, top: spec.rect.y, width: spec.rect.w, height: spec.rect.h });
  if (spec.alpha) {
    const colour = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = colour;
    const { data: a, info: ai } = await sharp(spec.alpha, { unlimited: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (ai.width !== info.width || ai.height !== info.height) throw new Error(`alpha size mismatch for ${spec.file}`);
    // the cutout map is greyscale: its red channel is the mask
    for (let i = 0; i < data.length; i += 4) data[i + 3] = a[i * ai.channels];
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
  const meta = await img.metadata();
  const w = spec.rect ? spec.rect.w : meta.width;
  const h = spec.rect ? spec.rect.h : meta.height;
  const height = Math.max(1, Math.round((h / w) * width));
  const buf = await img.resize({ width, height, kernel: 'lanczos3', fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const al = buf[i * 4 + 3] / 255;
    px[i * 3] = Math.max(0, Math.min(255, Math.round(buf[i * 4] * al + 90 * (1 - al))));
    px[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(buf[i * 4 + 1] * al + 130 * (1 - al))));
    px[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(buf[i * 4 + 2] * al + 190 * (1 - al))));
  }
  return { px, height };
}

/** Alpha coverage inside a sprite's own bounding box, for the numbers in the log. */
export async function coverage(file, alpha) {
  let img = sharp(file, { unlimited: true });
  if (alpha) img = img.composite([{ input: alpha, blend: 'dest-in' }]);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, x1 = -1, y0 = H, y1 = -1, cov = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > 127) {
        cov++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { bbox: { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, coverage: cov / ((x1 - x0 + 1) * (y1 - y0 + 1)) };
}

for (const [name, panels] of Object.entries(SHEETS)) {
  if (FILTER && !name.includes(FILTER)) continue;
  const width = 1600;
  const gap = 6;
  const parts = await Promise.all(panels.map((p) => panel(p, width)));
  const total = parts.reduce((s, p) => s + p.height, 0) + gap * (parts.length - 1);
  const canvas = Buffer.alloc(width * total * 3, 24);
  let y = 0;
  for (const p of parts) {
    p.px.copy(canvas, y * width * 3);
    y += p.height + gap;
  }
  const file = `${OUT}/veg2-${name}.jpg`;
  await sharp(canvas, { raw: { width, height: total, channels: 3 } }).jpeg({ quality: 92 }).toFile(file);
  console.log(`${file}  ${width}x${total}`);
}
