// Grass sprite atlas (and its flower mask), built from Blender renders of CC0
// Poly Haven plants. See tools/look/README.md.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LOOK, CACHE, OUTDIR, ensureDirs, exists, hasFlag } from './lib/util.mjs';
import { asset, extraTexture } from './lib/polyhaven.mjs';

const run = promisify(execFile);
const sharp = createRequire(import.meta.url)('sharp');
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
const CELLS = 8;
const CELL_PX = 256;

/** Models the recipes in blender/plants.py use, with what each becomes. */
const MODELS = {
  grass_bermuda_01: ['grass_atlas.webp'],
  grass_medium_01: ['grass_atlas.webp'],
  grass_medium_02: ['grass_atlas.webp'],
  celandine_01: ['grass_atlas.webp', 'grass_flora.webp'],
  dandelion_01: ['grass_atlas.webp', 'grass_flora.webp']
};

export const name = 'grass';
export const order = 3;

export const cellNames = [
  'short verge tuft, 0.34 m',
  'medium tuft, 0.90 m',
  'tall ditch grass, 1.30 m',
  'flowering meadow, 1.15 m (flora mask in cell 3)',
  'wheat / rye ears, 1.20 m',
  'dry winter stalks, 1.20 m',
  'low verge turf, 0.28 m',
  'deep shade grass, 1.30 m'
];

export const sources = [
  ...Object.entries(MODELS).map(([id, usedFor]) => ({
    id,
    provider: 'Poly Haven',
    url: `https://polyhaven.com/a/${id}`,
    license: 'CC0 1.0',
    usedFor,
    note: 'real 3D plant (gltf 1k) rendered into the sprite cells'
  })),
  {
    id: 'grass_medium_01 dry diffuse',
    provider: 'Poly Haven',
    url: 'https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/grass_medium_01/grass_medium_01_dry_diff_1k.jpg',
    license: 'CC0 1.0',
    usedFor: ['grass_atlas.webp'],
    note: "the asset's published dry-season diffuse, used for the winter stalks cell"
  },
  {
    id: 'plants.py cell renders',
    provider: 'Blender render',
    url: 'tools/look/blender/plants.py — 8 orthographic cells, 256 px, unlit luminance, no alpha cards; each cell is a scene of many CC0 plants sized and scattered to fill its own frame',
    license: 'CC0 1.0',
    usedFor: ['grass_atlas.webp', 'grass_flora.webp']
  }
];

export const outputs = [
  {
    file: 'grass_atlas.webp',
    size: [CELLS * CELL_PX, CELL_PX],
    channels: 'RGB + A (cutout)',
    tiling_m: null,
    role: 'grass sprite atlas',
    layout: {
      cells: CELLS,
      cell_px: CELL_PX,
      cell_world_m: [0.34, 0.90, 1.30, 1.15, 1.20, 1.20, 0.28, 1.30],
      cell_contents: cellNames,
      uv_per_cell: 'u = (cell + i) / 8, v = 0 at the cell bottom (base of the plants)',
      content_height_v: 0.93,
      note: 'greyscale: the game tints each tuft with the same ground colour function it tints the terrain with. Cell world size = the frame the cell was rendered in; render a card of that size (x scale) with the base at v=0.'
    },
    note: 'eight crossed-card tufts, unlit luminance of real 3D plants, cutout in alpha'
  },
  {
    file: 'grass_flora.webp',
    size: [CELLS * CELL_PX, CELL_PX],
    channels: 'RGB (greyscale mask)',
    tiling_m: null,
    role: 'grass flower mask',
    layout: {
      cells: CELLS,
      cell_px: CELL_PX,
      used_cells: [3],
      note: 'white = flower head (tint with the flower colour of your choice), black elsewhere; same cell layout as grass_atlas.webp'
    },
    note: 'mask for the white/yellow flower heads in the flowering-meadow cell'
  }
];

async function fetchModels() {
  for (const id of Object.keys(MODELS)) {
    await asset(id, { kind: 'gltf', res: '1k' });
    // The gltf bundle's JPEGs carry no alpha, and every plant's cutout lives in
    // the asset's PNG diffuse / separate Alpha map.
    await extraTexture(id, 'Diffuse', { prefer: ['png'] });
    await extraTexture(id, 'Alpha', { prefer: ['png'] });
    await extraTexture(id, 'dry_diff', { prefer: ['png'] });
  }
}

export async function build({ force = false } = {}) {
  await ensureDirs();
  const atlas = path.join(OUTDIR, 'grass_atlas.webp');
  if (!force && (await exists(atlas))) {
    console.log('  grass_atlas.webp already built (use --force)');
    return;
  }
  await fetchModels();
  const tmp = path.join(CACHE, 'plants-render');
  await mkdir(tmp, { recursive: true });
  const cells = Array.from({ length: CELLS }, (_, i) => path.join(tmp, `grass_cell${i}.png`));
  const needRender = force || !(await exists(cells[CELLS - 1]));
  if (needRender) {
    console.log('  Blender: 8 grass cells + flora mask…');
    const env = { ...process.env, NICE: '15' };
    await run('/usr/bin/nice', ['-n', '15', BLENDER, '--background', '--factory-startup', '--python', path.join(LOOK, 'blender', 'plants.py'), '--', 'grass', tmp], {
      env,
      maxBuffer: 1 << 28
    });
  }
  for (const f of cells) if (!(await exists(f))) throw new Error(`missing render ${f}`);

  // One row of square cells; blit byte-for-byte so the renders are not re-graded.
  const base = sharp({ create: { width: CELLS * CELL_PX, height: CELL_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  await base
    .composite(cells.map((input, i) => ({ input, left: i * CELL_PX, top: 0 })))
    .webp({ quality: 88, alphaQuality: 92, effort: 6 })
    .toFile(atlas);
  console.log(`  grass_atlas.webp written (${CELLS} cells)`);

  const floraSrc = path.join(tmp, 'grass_flora_cell3.png');
  if (await exists(floraSrc)) {
    // Cell 3 only: the flower key would also light up bleached straw, so the
    // other cells stay black. Flattened over black, so the mask is straight RGB.
    const cell = await sharp(floraSrc).flatten({ background: '#000000' }).greyscale().png().toBuffer();
    await sharp({ create: { width: CELLS * CELL_PX, height: CELL_PX, channels: 3, background: '#000000' } })
      .composite([{ input: cell, left: 3 * CELL_PX, top: 0 }])
      .webp({ quality: 90, effort: 6 })
      .toFile(path.join(OUTDIR, 'grass_flora.webp'));
    console.log('  grass_flora.webp written (cell 3)');
  }
  if (hasFlag('keep')) return;
  await rm(tmp, { recursive: true, force: true });
}
