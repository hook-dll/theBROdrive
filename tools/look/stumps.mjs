// Stump and fallen-log models, decimated in Blender from CC0 Poly Haven scans,
// plus the small texture atlas they share. See tools/look/README.md.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LOOK, CACHE, OUTDIR, ensureDirs, exists, flags } from './lib/util.mjs';
import { asset as phAsset } from './lib/polyhaven.mjs';

const run = promisify(execFile);
const sharp = createRequire(import.meta.url)('sharp');
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
const PY = path.join(LOOK, 'trees', 'trees.py');
const STUMPCACHE = path.join(CACHE, 'stumps');

export const name = 'stumps';
export const order = 6;

/**
 * One entry per model. `tile` is the quarter of stump.webp its UVs are remapped
 * into, `tris` the target after decimation — a Poly Haven scan is 22k-53k
 * vertices and the game draws a stump beside a road it also has to draw a whole
 * wood through.
 */
export const STUMPS = [
  { model: 'tree_stump_01', file: 'tree_stump_0', tile: 0, tris: 520, kind: 'stump' },
  { model: 'tree_stump_02', file: 'tree_stump_1', tile: 1, tris: 520, kind: 'stump' },
  { model: 'dead_tree_trunk', file: 'tree_log_0', tile: 2, tris: 420, kind: 'log' },
  { model: 'dead_tree_trunk_02', file: 'tree_log_1', tile: 3, tris: 420, kind: 'log' }
];

const TILE_PX = 256;

export const sources = [
  ...STUMPS.map((s) => ({
    id: s.model,
    provider: 'Poly Haven',
    url: `https://polyhaven.com/a/${s.model}`,
    license: 'CC0 1.0',
    usedFor: [`${s.file}.glb`, 'stump.webp'],
    note: `photoscanned ${s.kind}; decimated from the published scan to ${s.tris} triangles in Blender, its diffuse into the shared 2x2 atlas`
  })),
  {
    id: 'trees/trees.py decimation',
    provider: 'Blender render',
    url: 'tools/look/trees/trees.py — job stumps: re-centre, remap UVs into the atlas tile, Decimate',
    license: 'CC0 1.0',
    usedFor: STUMPS.map((s) => `${s.file}.glb`).concat(['stump.webp'])
  }
];

export const outputs = [
  {
    file: 'stump.webp',
    size: [2 * TILE_PX, 2 * TILE_PX],
    channels: 'RGB',
    tiling_m: null,
    role: 'stump and log texture',
    layout: {
      tiles: 2,
      tile_px: TILE_PX,
      tile_order: 'row 0 on top: tile 0 tree_stump_01, tile 1 tree_stump_02, tile 2 dead_tree_trunk, tile 3 dead_tree_trunk_02',
      uv: 'each model UVs straight into its tile: u = (tile_x + u_model) / 2, v = 1 - (tile_y + 1 - v_model) / 2'
    },
    note: 'one texture for all four models, so a stump and a log cost one material between them'
  },
  ...STUMPS.map((s) => ({
    file: `${s.file}.glb`,
    size: null,
    channels: null,
    tiling_m: null,
    role: s.kind === 'stump' ? 'stump model' : 'fallen log model',
    layout: {
      triangles: s.tris,
      texture_tile: s.tile,
      base: 'the model stands on z = 0 with its footprint centred on the origin',
      scale: 'metres, 1:1'
    },
    note: `${s.kind} from the Poly Haven scan ${s.model}, decimated in Blender`
  }))
];

async function fetchModels() {
  for (const s of STUMPS) {
    await phAsset(s.model, { kind: 'gltf', res: '1k' });
    const dir = path.join(CACHE, 'ph-files', s.model, 'textures');
    const diff = path.join(dir, `${s.model}_diff_1k.jpg`);
    if (!(await exists(diff))) throw new Error(`stumps: ${diff} missing from the ${s.model} bundle`);
  }
}

/** stump.webp: the four diffuse maps in a 2x2 grid, row 0 on top. */
async function stumpTexture(force) {
  const file = path.join(OUTDIR, 'stump.webp');
  if (!force && (await exists(file))) return;
  const parts = [];
  for (const s of STUMPS) {
    const src = path.join(CACHE, 'ph-files', s.model, 'textures', `${s.model}_diff_1k.jpg`);
    parts.push({
      input: await sharp(src).resize(TILE_PX, TILE_PX, { fit: 'cover' }).removeAlpha().png().toBuffer(),
      left: (s.tile % 2) * TILE_PX,
      top: Math.floor(s.tile / 2) * TILE_PX
    });
  }
  await sharp({ create: { width: 2 * TILE_PX, height: 2 * TILE_PX, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(parts)
    .webp({ quality: 88, effort: 6 })
    .toFile(file);
  console.log('    stump.webp');
}

async function blender(args, label) {
  const t0 = Date.now();
  const { stdout, stderr } = await run(
    '/usr/bin/nice',
    ['-n', '15', BLENDER, '--background', '--factory-startup', '--python', PY, '--', ...args],
    { maxBuffer: 1 << 28 }
  );
  const out = `${stdout}\n${stderr}`;
  if (/Traceback \(most recent call last\)|Error: [A-Z]/.test(out)) {
    const line = out.split('\n').filter((l) => /Error|Traceback|line \d+/.test(l)).slice(-6).join('\n');
    throw new Error(`Blender failed (${args.join(' ')}):\n${line}`);
  }
  console.log(`  ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

/** fs.copyFile hits ENOTSUP on this filesystem, so copy through read+write. */
async function copyIfAny(from, to) {
  if (!(await exists(from))) return false;
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
  return true;
}

export async function build({ force = false } = {}) {
  await ensureDirs();
  if (!force && (await exists(path.join(OUTDIR, 'tree_log_1.glb')))) {
    console.log('  stumps already built (use --force)');
    return;
  }
  await fetchModels();
  await mkdir(STUMPCACHE, { recursive: true });
  if (force || !(await exists(path.join(STUMPCACHE, 'tree_log_1.glb')))) {
    await blender(['stumps', STUMPCACHE], 'stumps and logs');
  }
  for (const s of STUMPS) {
    if (!(await copyIfAny(path.join(STUMPCACHE, `${s.file}.glb`), path.join(OUTDIR, `${s.file}.glb`)))) {
      throw new Error(`stumps: ${s.file}.glb was not produced — check the Blender log`);
    }
  }
  await stumpTexture(force);
}

export { flags };
