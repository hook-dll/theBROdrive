// Bush atlases (per season) and the crossed-card bush model, built from Blender
// renders of CC0 Poly Haven plants. See tools/look/README.md.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LOOK, CACHE, OUTDIR, ensureDirs, exists, hasFlag } from './lib/util.mjs';
import { asset, extraTexture } from './lib/polyhaven.mjs';

const run = promisify(execFile);
const sharp = createRequire(import.meta.url)('sharp');
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SLOTS = 4;
const SLOT_PX = 512;

const MODELS = {
  nettle_plant: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp'],
  weed_plant_02: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp'],
  shrub_01: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp', 'bush_winter.webp'],
  shrub_03: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp', 'bush_winter.webp'],
  celandine_01: ['bush_spring.webp'],
  dandelion_01: ['bush_summer.webp'],
  fern_02: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp'],
  shrub_02: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp', 'bush_winter.webp'],
  shrub_04: ['bush_spring.webp', 'bush_summer.webp'],
  dry_branches_medium_01: ['bush_winter.webp']
};

export const name = 'bush';
export const order = 4;

export const slotNames = [
  'hazel / wild-rose scrub',
  'tall roadside umbellifers: nettle and weed_plant_02 foliage under generated white umbel heads, with spring celandine or summer dandelion',
  'bracken',
  'juniper / willow scrub (shrub_02 + shrub_04 + shrub_03; dead branches in winter)'
];

export const sources = [
  ...Object.entries(MODELS).map(([id, usedFor]) => ({
    id,
    provider: 'Poly Haven',
    url: `https://polyhaven.com/a/${id}`,
    license: 'CC0 1.0',
    usedFor,
    note: 'real 3D plant (gltf 1k) rendered into the bush sprite cells'
  })),
  {
    id: 'plants.py bush render',
    provider: 'Blender render',
    url: 'tools/look/blender/plants.py — 4 slots x 4 seasons, 512 px, unlit photo colour with a season grade',
    license: 'CC0 1.0',
    usedFor: SEASONS.map((s) => `bush_${s}.webp`)
  },
  {
    id: 'plants.py generated umbel head',
    provider: 'Blender render',
    url: 'tools/look/blender/plants.py — umbel_head_texture(): 150 white florets scattered over a shallow dome on transparent, 256 px',
    license: 'CC0 1.0',
    usedFor: ['bush_spring.webp', 'bush_summer.webp', 'bush_autumn.webp'],
    note: 'Poly Haven has no CC0 umbellifer, and зонтичные is what a central-Russian verge is made of in June: the heads are generated and hung on thin procedural stems over real CC0 foliage'
  },
  {
    id: 'plants.py crossed-card bush mesh',
    provider: 'Blender render',
    url: 'tools/look/blender/plants.py — four crossed cards, UVs over the first atlas column',
    license: 'CC0 1.0',
    usedFor: ['bush.glb']
  }
];

const layout = {
  slots: SLOTS,
  slot_px: SLOT_PX,
  slot_world_m: 1.6,
  slot_contents: slotNames,
  uv_per_slot: 'u = (slot + i) / 4, v = 0 at the slot bottom, which is the plants\' own ground contact (z = 0 in the render), so an instance is placed with its base on the terrain',
  note: 'the four slots keep their meaning in every season, so placement never has to change; only the render changes. A bush is 0.3-1.5 m of leaf, always seen against something else, so it keeps photo colour with a per-season grade (spring fresh, summer full, autumn rust, winter dead with snow on the upward faces).'
};

export const outputs = [
  ...SEASONS.map((s) => ({
    file: `bush_${s}.webp`,
    size: [SLOTS * SLOT_PX, SLOT_PX],
    channels: 'RGB + A (cutout)',
    tiling_m: null,
    role: `bush atlas, ${s}`,
    layout,
    note: `four bush slots, ${s}`
  })),
  {
    file: 'bush.glb',
    size: null,
    channels: null,
    tiling_m: null,
    role: 'bush model',
    layout: {
      cards: 4,
      card_m: [1.6, 1.6],
      base_y_m: 0.0,
      top_y_m: 1.6,
      uv: 'u spans 0..0.25 (first atlas column), v spans 0..1; add variant * 0.25 to u',
      vertex_colors: null,
      note: 'low-poly crossed cards, 16 vertices, double-sided, alpha-tested; instance scale 0.5-1.5 gives a 0.8-2.4 m bush. One card is 1.6 x 1.6 m, the slot\'s own world size, so the sprite is never rescaled'
    },
    note: 'crossed-card bush mesh (8 triangles) with UVs for bush_<season>.webp'
  }
];

async function fetchModels() {
  for (const id of Object.keys(MODELS)) {
    await asset(id, { kind: 'gltf', res: '1k' });
    await extraTexture(id, 'Diffuse', { prefer: ['png'] });
    await extraTexture(id, 'Alpha', { prefer: ['png'] });
  }
}

export async function build({ force = false } = {}) {
  await ensureDirs();
  const final = path.join(OUTDIR, 'bush_summer.webp');
  if (!force && (await exists(final))) {
    console.log('  bush atlases already built (use --force)');
    return;
  }
  await fetchModels();
  const tmp = path.join(CACHE, 'plants-render');
  await mkdir(tmp, { recursive: true });
  const last = path.join(tmp, 'bush_winter_slot3.png');
  if (force || !(await exists(last))) {
    console.log('  Blender: 16 bush slots + bush.glb…');
    await run('/usr/bin/nice', ['-n', '15', BLENDER, '--background', '--factory-startup', '--python', path.join(LOOK, 'blender', 'plants.py'), '--', 'bush', tmp], {
      maxBuffer: 1 << 28
    });
  }
  for (const season of SEASONS) {
    const cells = Array.from({ length: SLOTS }, (_, i) => path.join(tmp, `bush_${season}_slot${i}.png`));
    for (const f of cells) if (!(await exists(f))) throw new Error(`missing render ${f}`);
    await sharp({ create: { width: SLOTS * SLOT_PX, height: SLOT_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(cells.map((input, i) => ({ input, left: i * SLOT_PX, top: 0 })))
      .webp({ quality: 86, alphaQuality: 92, effort: 6 })
      .toFile(path.join(OUTDIR, `bush_${season}.webp`));
    console.log(`  bush_${season}.webp written`);
  }
  await copyFile(path.join(tmp, 'bush.glb'), path.join(OUTDIR, 'bush.glb'));
  console.log('  bush.glb copied');
  if (hasFlag('keep')) return;
  await rm(tmp, { recursive: true, force: true });
}
