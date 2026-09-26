// Tree atlases, tree models and impostor bakes. See tools/look/README.md.
//
// Per species and season:
//   1. Blender renders six branch modules (clump cells, albedo + analytic normal)
//   2. the driver tiles them into a 512x768 composite the card lookups use
//   3. Blender renders the whole-tree sprite (albedo + normal), the impostor
//      atlas (16 views x 4 variants in one render, albedo + view-space normals)
//      and exports one GLB per variant with UVs shifted into the species column
//   4. the driver assembles the species column and the group atlases, dilating
//      RGB into transparent texels so filtering never pulls a black fringe in.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LOOK, CACHE, OUTDIR, ensureDirs, exists } from './lib/util.mjs';
import { asset as acgAsset, map as acgMap } from './lib/ambientcg.mjs';
import { asset as phAsset } from './lib/polyhaven.mjs';
import { loadImage, saveWebp, savePng, img, paste, dilateRGB } from './lib/image.mjs';

const run = promisify(execFile);
const sharp = createRequire(import.meta.url)('sharp');
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
const PY = path.join(LOOK, 'trees', 'trees.py');
const TREECACHE = path.join(CACHE, 'trees');

export const name = 'trees';
export const order = 5;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/**
 * One entry per species. `column` is the column it owns in its group's atlas,
 * `bark` the ambientCG bark id, `height_m` the model's height at instance scale 1
 * (the game scales it). A conifer has no `pack`: it is grown, not scanned.
 */
export const SPECIES = {
  birch: { group: 'deciduous', column: 0, height_m: 11.5, bark: 'Bark011', kind: 'deciduous', autumn: 'gold' },
  aspen: { group: 'deciduous', column: 1, height_m: 11.2, bark: 'Bark009', kind: 'deciduous', autumn: 'orange-red' },
  oak: { group: 'deciduous', column: 2, height_m: 10.9, bark: 'Bark014', kind: 'deciduous', autumn: 'ochre-brown' },
  lime: { group: 'deciduous', column: 3, height_m: 11.4, bark: 'Bark004', kind: 'deciduous', autumn: 'yellow' },
  // Norway spruce and Scots pine are grown by trees/trees.py like the deciduous
  // species — a whorled skeleton with a drawn needle card per shoot. The height is
  // what fits the cells: the whole-tree sprite is 8 x 12 m at 64 px/m, so a 12 m
  // tree would put its apex on the cell's top edge.
  spruce: { group: 'conifer', column: 0, height_m: 11.3, bark: 'Bark006', kind: 'conifer' },
  pine: { group: 'conifer', column: 1, height_m: 11.6, bark: 'Bark012', kind: 'conifer' }
};

const GROUPS = ['deciduous', 'conifer'];

export const sources = [
  {
    id: 'Leaf001',
    provider: 'ambientCG',
    url: 'https://ambientcg.com/a/Leaf001',
    license: 'CC0 1.0',
    usedFor: SPECIES.birch.group === 'deciduous' ? ['trees_deciduous_*.webp', 'imposters_deciduous_*.webp'] : [],
    note: 'photoscanned leaf with an opacity map; every deciduous leaf quad carries it, and the per-species silhouette (oak lobes, lime heart, aspen rounder) is an analytic alpha mask over it'
  },
  ...[
    ['Bark011', 'birch: the pale flaking sheet whose luminance carries the flakes and grey patches; the cream colour and every black lenticel are synthesised on top, because neither provider publishes a CC0 birch bark'],
    ['Bark009', 'aspen: grey-green and smooth, with synthesised dark diamond leaf scars'],
    ['Bark014', 'oak column'],
    ['Bark004', 'lime column']
  ].map(([id, note]) => ({
    id,
    provider: 'ambientCG',
    url: `https://ambientcg.com/a/${id}`,
    license: 'CC0 1.0',
    usedFor: ['trees_deciduous_*.webp'],
    note: `bark strip, ${note}`
  })),
  ...['Bark006', 'Bark012'].map((id) => ({
    id,
    provider: 'ambientCG',
    url: `https://ambientcg.com/a/${id}`,
    license: 'CC0 1.0',
    usedFor: ['trees_conifer_*_m.webp'],
    note: 'bark strip: spruce / pine columns'
  })),
  {
    id: 'needle shoots (drawn)',
    provider: 'Blender render',
    url: 'tools/look/trees/trees.py — needle_sheet(): four drawn shoots per species on transparent',
    license: 'CC0 1.0',
    usedFor: ['trees_conifer_*_m.webp', 'imposters_conifer_*_d.webp'],
    note: 'the needle texture itself, drawn rather than scanned: a shoot is 9-36 cm of twig with strands raked off it, ~30 strands a card, shaded dark at the twig and lighter at the tips. A photograph cannot fill a needle card — a real spruce needle is 1.5-2 cm, which is one texel at the sprite cell\'s 64 px/m and a third of one in an impostor cell — so the shoot is drawn at the scale the card is seen at, the same way plants.py draws its umbel heads because Poly Haven has no CC0 umbellifer. Colour is the species\': dark blue-green for the spruce, longer grey-green fascicles for the pine'
  },
  {
    id: 'trees.py renders and models',
    provider: 'Blender render',
    url: 'tools/look/trees/trees.py — grown trees, branch modules, whole-tree sprite, top-down star, impostor bakes, bark strip, GLB export',
    license: 'CC0 1.0',
    usedFor: [
      'trees_deciduous_*.webp',
      'trees_deciduous_*_n.webp',
      'trees_conifer_*_m.webp',
      'trees_conifer_*_a.webp',
      'imposters_deciduous_*.webp',
      'imposters_conifer_*.webp',
      'tree_*.glb'
    ]
  }
];

// --- atlas layout (mirrored from trees/trees.py; the manifest repeats it in uv)

const WHOLE = { x: 0, y: 0, w: 512, h: 768 };
const BARK = { x: 0, y: 768, w: 1024, h: 256 };
const CLUMPS = [];
for (const y of [0, 256, 512]) for (const x of [512, 768]) CLUMPS.push({ x, y, w: 256, h: 256 });
const STAR = { x: 512, y: 0, w: 512, h: 512, m: 5.6 };
const BRANCH = { x: 512, y: 512, w: 512, h: 256, m: [4.0, 2.0] };

const uvOf = (c) => ({ u: [c.x / 1024, (c.x + c.w) / 1024], v: [1 - (c.y + c.h) / 1024, 1 - c.y / 1024] });

const columnLayoutDeciduous = {
  whole_tree_sprite: { px: WHOLE, world_m: [8.0, 12.0], ...uvOf(WHOLE), note: 'the tree rendered from its full-detail model at instance scale 1, base on the cell bottom edge; 64 px/m, so a 10.9-11.5 m tree fills 88-96 % of the cell height and its crown 90-95 % of the cell width. The cell is 512 px of the 1024 px column by layout: the other 512 px hold the six crown modules, and the bark strip runs the full column width underneath' },
  clump_cells: CLUMPS.map((c, i) => ({ index: i, px: c, world_m: [3.2, 3.2], ...uvOf(c), note: '80 px/m; a crown module cut out of the full-detail tree' })),
  bark_strip: { px: BARK, world_m: [2.0, 0.5], ...uvOf(BARK), note: 'the trunk surface unrolled: u along the trunk (2.0 m per repeat), v one wrap around it (0.5 m, a 0.16 m trunk); the cell is 1024 x 256 px, so both directions are 512 px/m. v < 0.25 of a column is always bark' },
  card_uvs: 'the GLB crown cards sample the six clump cells; the trunk samples the bark strip. No radial mask is applied to a clump cell: the sprite carries the module\'s own ragged leaf silhouette, so a crown card never shows a cut arc'
};

const columnLayoutConifer = {
  whole_tree_sprite: { px: WHOLE, world_m: [8.0, 12.0], ...uvOf(WHOLE), note: 'the grown tree at instance scale 1, base on the cell bottom edge, 64 px/m, exactly as in a deciduous column: an 11.3-11.6 m conifer fills 94-97 % of the cell height and its crown 84-92 % of the width. It is the same tree the star, the side cell, the model and the impostors are all drawn from' },
  whorl_star: { px: STAR, world_m: [STAR.m, STAR.m], ...uvOf(STAR), note: 'the top-down star the model\'s whorl fans sample, 91 px/m: a real view from directly above the tree\'s own widest whorl plus the two tiers either side of it, centred on the trunk axis, scaled so the star fills 94 % of the cell. No clip planes and no slice height guessed from a radius profile, so it cannot land in the gap between two tiers and it cannot show a trunk section — the band is whole whorls. The fans scale it to their own radius, so an upper whorl samples the inner part of the star' },
  side_branch: { px: BRANCH, world_m: BRANCH.m, ...uvOf(BRANCH), note: 'one whole whorl branch of the same tree, turned to run across the cell and scaled to fill it: a spruce\'s hanging comb branch, a pine\'s foliage plate. The model\'s side cards carry a real branch of the tree the sprites show' },
  bark_strip: { px: BARK, world_m: { spruce: [2.0, 0.5], pine: [11.6, 2.9] }, ...uvOf(BARK), note: 'the trunk surface unrolled: u along the trunk, v around it. The spruce\'s cell repeats every 2 m (512 px/m on both axes) with its thin grey-brown scale mosaic; the pine\'s cell is its *whole trunk* — 11.6 m along u by 2.9 m around v, so the cell\'s 4:1 pixels come out at 88 px/m both ways — because that is the only way one sheet can hold the two zones a pine is known by: grey-brown furrowed bark to 40 % of the height, orange-red flaky plates above. Half of the round direction is a 0.5 m trunk\'s own wrap, and the model and the sprite both sample it by height, so the trunk keeps the two-tone and the limbs stay in the flaky zone' }
};

const IMPOSTOR_LAYOUT = {
  cells_x: 16,
  cell_px: 256,
  cell_world_m: 12.4,
  rows: 'one row per species, row 0 at the BOTTOM; deciduous rows are birch, aspen, oak, lime and conifer rows are spruce, pine',
  view_order: 'cell (view, row) at u [view/16, (view+1)/16], v [row/rows, (row+1)/rows]',
  view_angle: 'view v = the tree seen from azimuth 2*pi*v/16; v = 0 looks along the tree\'s local +Y, so its +X is to the right of the image',
  pivot: 'the tree base sits on the cell\'s bottom edge, horizontally centred in the cell',
  px_per_m: 20.6,
  tree_height_m: null,
  note: 'albedo is unlit with the RGB dilated into transparent texels; the normal atlas is view-space (+X right, +Y up, +Z toward the viewer) with the crown bend baked in, on a flat (128,128,255) background'
};

export const outputs = [];
for (const season of SEASONS) {
  outputs.push(
    {
      file: `trees_deciduous_${season}.webp`,
      size: [4096, 1024],
      channels: 'RGBA (RGB albedo, A cutout)',
      tiling_m: null,
      role: 'deciduous tree atlas',
      layout: {
        columns: 4,
        column_species: ['birch', 'aspen', 'oak', 'lime'],
        column_px: 1024,
        ...columnLayoutDeciduous,
        uv_per_column: 'u = (column + u_col) / 4',
        height_m: Object.fromEntries(Object.entries(SPECIES).filter(([, v]) => v.group === 'deciduous').map(([k, v]) => [k, v.height_m])),
        autumn_colour: Object.fromEntries(Object.entries(SPECIES).filter(([, v]) => v.group === 'deciduous').map(([k, v]) => [k, v.autumn]))
      },
      note: `birch, aspen, oak, lime: whole tree, six crown modules and a bark strip per column, ${season}. Every sprite is rendered from the same full-detail tree (bark, a few thousand leaves on the terminal twigs, each leaf 10-17 cm of leaf cluster); the 3D model is never used for a sprite.`
    },
    {
      file: `trees_deciduous_${season}_n.webp`,
      size: [4096, 1024],
      channels: 'RGB (tangent-space normal)',
      tiling_m: null,
      role: 'deciduous tree normal atlas',
      layout: {
        columns: 4,
        column_px: 1024,
        ...columnLayoutDeciduous,
        convention: 'OpenGL tangent space: +X right, +Y up, +Z out of the sprite toward the viewer. Each clump is a rounded dome, the whole-tree sprite a crown capsule, bark a flattened outward normal (vertical component / 8).'
      },
      note: `analytic crown normals for ${season}: per-leaf, from the crown capsule, with the per-leaf occlusion in the albedo's alpha`
    },
    {
      file: `trees_conifer_${season}_m.webp`,
      size: [2048, 1024],
      channels: 'RGB (albedo)',
      tiling_m: null,
      role: 'conifer tree atlas, colour',
      layout: {
        columns: 2,
        column_species: ['spruce', 'pine'],
        column_px: 1024,
        ...columnLayoutConifer,
        uv_per_column: 'u = (column + u_col) / 2',
        height_m: Object.fromEntries(Object.entries(SPECIES).filter(([, v]) => v.group === 'conifer').map(([k, v]) => [k, v.height_m]))
      },
      note: `spruce and pine needle sprites, ${season}: the whole tree, the top-down whorl star and the side branch of each species, all three rendered from the *same grown tree* the species' model and impostors are grown from. The needles are drawn shoots (see the needle-shoot source) and carry a baked per-card occlusion — lit outside, dark toward the trunk axis and toward the lower tiers`
    },
    {
      file: `trees_conifer_${season}_a.webp`,
      size: [2048, 1024],
      channels: 'R (greyscale cutout)',
      tiling_m: null,
      role: 'conifer tree atlas, alpha',
      layout: { note: 'same layout as trees_conifer_<season>_m.webp; alphaTest 0.4 at runtime' },
      note: `conifer cutout for ${season}`
    },
    {
      file: `imposters_deciduous_${season}_d.webp`,
      size: [4096, 1024],
      channels: 'RGB + A (dilated)',
      tiling_m: null,
      role: 'deciduous impostor atlas',
      layout: { ...IMPOSTOR_LAYOUT, rows: 4, row_species: ['birch', 'aspen', 'oak', 'lime'], tree_height_m: { birch: 11.5, aspen: 11.2, oak: 10.9, lime: 11.4 } },
      note: `16 views x 4 species rows from the full-detail trees, ${season}`
    },
    {
      file: `imposters_deciduous_${season}_n.webp`,
      size: [4096, 1024],
      channels: 'RGB (view-space normal)',
      tiling_m: null,
      role: 'deciduous impostor normals',
      layout: { ...IMPOSTOR_LAYOUT, rows: 4, row_species: ['birch', 'aspen', 'oak', 'lime'], tree_height_m: { birch: 11.5, aspen: 11.2, oak: 10.9, lime: 11.4 }, convention: 'view-space: +X right, +Y up, +Z toward the viewer; crown bend baked in, trunk vertical component / 8' },
      note: `impostor normals for ${season}`
    },
    {
      file: `imposters_conifer_${season}_d.webp`,
      size: [4096, 512],
      channels: 'RGB + A (dilated)',
      tiling_m: null,
      role: 'conifer impostor atlas',
      layout: { ...IMPOSTOR_LAYOUT, rows: 2, row_species: ['spruce', 'pine'], tree_height_m: { spruce: 11.3, pine: 11.6 } },
      note: `16 views x 2 species rows from the full-detail grown trees, ${season}`
    }
  );
  if (season === 'summer') {
    outputs.push({
      file: 'imposters_conifer_n.webp',
      size: [4096, 512],
      channels: 'RGB (view-space normal)',
      tiling_m: null,
      role: 'conifer impostor normals (all seasons)',
      layout: { ...IMPOSTOR_LAYOUT, rows: 2, row_species: ['spruce', 'pine'], tree_height_m: { spruce: 11.3, pine: 11.6 }, note: 'cone normal — the outward direction tilted 0.30 up at the skirt and 0.75 at the leader — with the crown bend; shared by every season' },
      note: 'conifer impostor normals, baked once'
    });
  }
}
for (const [id, spec] of Object.entries(SPECIES)) {
  for (let variant = 0; variant < 4; variant++) outputs.push({
    file: `tree_${id}_${variant}.glb`,
    size: null,
    channels: null,
    tiling_m: null,
    role: 'tree model',
    layout: {
      variant,
      variants: '4 files per species, variant 0..3; all four share the species\' sprites and differ in branch and card seeds, so a stand does not repeat one silhouette',
      height_m: spec.height_m,
      vertex_colors: 'Col (per-card brightness variation, multiply into the albedo)',
      uv_space: spec.group === 'deciduous'
        ? 'UVs point into column ' + spec.column + ' of trees_deciduous_<season>.webp (u in [column/4, (column+1)/4])'
        : 'UVs point into column ' + spec.column + ' of trees_conifer_<season>_m.webp (u in [column/2, (column+1)/2]), with the cutout in trees_conifer_<season>_a.webp',
      note: spec.kind === 'deciduous'
        ? 'trunk and main limbs plus 22 crown cards cut from the six clump sprites, 212-292 verts. The wood is built as pieces of one bark repeat each and every UV is derived from the cell rects above, so a trunk samples the bark band and a card its own clump cell; the crown volume comes from the game shader\'s capsule masking, not from the geometry'
        : (spec.spruce === undefined ? '' : '') + (id === 'spruce'
          ? '5-sided trunk plus 22 radial whorl fans cut from the top-down star: each fan is one of the grown tree\'s own whorls, scaled so its radius is the whorl\'s radius in the star cell, and raised or drooping by its height in the crown. The cone normal is applied in the shader'
          : '5-sided trunk — its bark cell is the whole trunk, so the lower third is grey-brown and the rest orange-red — plus 22 crossed crown cards cut from the side cell and 7 dead stubs on the clear trunk. The plates sit where the grown tree\'s own crown is, and the cone normal is applied in the shader')
    },
    note: `${id} model, variant ${variant}${spec.kind === 'conifer' ? ', grown from the same tree as its sprites' : ''}`
  });
}

// --- fetching

async function fetchSources() {
  const leaf = await acgAsset('Leaf001', { quiet: true });
  if (!leaf.maps.Color) throw new Error('Leaf001: no colour map');
  const barks = [...new Set(Object.values(SPECIES).map((s) => s.bark).filter(Boolean))];
  for (const id of barks) {
    const a = await acgAsset(id, { quiet: true });
    const src = acgMap(a, 'Color');
    const dest = path.join(CACHE, 'bark', `${id}.jpg`);
    await mkdir(path.dirname(dest), { recursive: true });
    await sharp(src).jpeg({ quality: 94 }).toFile(dest);
  }
}

// --- blender driving

async function blender(args, label) {
  const t0 = Date.now();
  // Blender exits 0 even when the script raised, so the output is checked too:
  // a silent no-op render once cost a whole build round.
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
  console.log(`    ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

/** Tile six 256^2 clump renders into the 512x768 composite the cards look up. */
async function clumpComposite(dir) {
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push(path.join(dir, `clump${i}.png`));
  for (const f of cells) if (!(await exists(f))) throw new Error(`missing ${f}`);
  await sharp({ create: { width: 512, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: (i % 2) * 256, top: Math.floor(i / 2) * 256 })))
    .png()
    .toFile(path.join(dir, 'clumps_raw.png'));
  // No radial mask: a clump sprite carries the module's own ragged leaf
  // silhouette. The circular feather that used to be here left flat arcs on the
  // cell border, which is exactly what a crown card must not show.
  await sharp(path.join(dir, 'clumps_raw.png')).png().toFile(path.join(dir, 'clumps.png'));

}

/** Assemble one species column (1024x1024) from its cell renders. */
async function column(dir, kind) {
  const comps = [];
  const put = (file, spec) => comps.push({ input: file, left: spec.x, top: spec.y });
  if (kind === 'deciduous') {
    put(path.join(dir, 'tree.png'), WHOLE);
    for (let i = 0; i < 6; i++) put(path.join(dir, `clump${i}.png`), CLUMPS[i]);
    put(path.join(dir, 'bark.png'), BARK);
  } else {
    put(path.join(dir, 'tree.png'), WHOLE);
    put(path.join(dir, 'star.png'), STAR);
    put(path.join(dir, 'branch.png'), BRANCH);
    put(path.join(dir, 'bark.png'), BARK);
  }
  for (const c of comps) if (!(await exists(c.input))) throw new Error(`missing ${c.input}`);
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

/** The normal column: same cells, analytic normals, flat background. */
async function columnNormal(dir, kind) {
  const comps = [];
  const put = (file, spec) => comps.push({ input: file, left: spec.x, top: spec.y });
  if (kind === 'deciduous') {
    put(path.join(dir, 'tree_n.png'), WHOLE);
    for (let i = 0; i < 6; i++) put(path.join(dir, `clump${i}_n.png`), CLUMPS[i]);
    put(path.join(dir, 'bark_n.png'), BARK);
  } else {
    return null;
  }
  for (const c of comps) if (!(await exists(c.input))) throw new Error(`missing ${c.input}`);
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 128, g: 128, b: 255 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

async function dilateToWebp(buffer, file, { quality }) {
  // Decode to floats, bleed RGB outward, then encode: this is what keeps a
  // mip-mapped sprite from pulling a black fringe into its alpha edge.
  const image = await loadImage(buffer, { ch: 4 });
  const out = dilateRGB(image, { iterations: 10 });
  await saveWebp(out, file, { quality, alphaQuality: 92 });
}

const COLUMNS = { deciduous: 4, conifer: 2 };
const IMPOSTOR_ROWS = { deciduous: 4, conifer: 2 };

/** Copy through read+write: fs.copyFile hits ENOTSUP on this filesystem. */
async function copyIfAny(from, to) {
  if (!(await exists(from))) return false;
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
  return true;
}

/** Blender renders for one species-season, skipping anything already on disk. */
async function renderSpeciesSeason(id, spec, season, { force }) {
  const dir = path.join(TREECACHE, `${id}_${season}`);
  const barkDir = path.join(TREECACHE, `${id}_bark`);
  await mkdir(dir, { recursive: true });
  if (spec.kind === 'deciduous') {
    if (force || !(await exists(path.join(dir, 'clump5_n.png')))) {
      await blender(['clumps', dir, id, season], `${id} ${season}: crown modules`);
    }
    await clumpComposite(dir);
  } else if (force || !(await exists(path.join(dir, 'impostor_albedo.png')))) {
    // one grown conifer per species-season: the whole-tree sprite, the top-down
    // star its fans sample, the side branch and the impostor row, all from it
    await blender(['conifer', dir, id, season], `${id} ${season}: sprite cells + impostors`);
  }
  for (const f of ['bark.png', 'bark_n.png']) await copyIfAny(path.join(barkDir, f), path.join(dir, f));
  if (force || !(await exists(path.join(dir, `tree_${id}_0.glb`)))) {
    await blender(['tree', dir, id, season, dir, String(spec.column), String(COLUMNS[spec.group])],
                  `${id} ${season}: sprites + impostors + models`);
  }
  return dir;
}

/** `--species=birch,oak` or `--species birch,oak` renders only those species' cell
 * renders and skips the atlas assembly: a group atlas is only correct when every
 * species column is present, so partial runs leave the atlas to the final full run.
 * The README documents the `--species spruce,pine` form, so both are read here:
 * only accepting `--species=a,b` silently rebuilt every species. */
function speciesFilter() {
  const argv = process.argv.slice(2);
  let list = '';
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f.startsWith('--species=')) list = f.slice('--species='.length);
    else if (f === '--species') list = argv[i + 1] ?? '';
  }
  const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

export async function build({ force = false } = {}) {
  await ensureDirs();
  if (!force && (await exists(path.join(OUTDIR, 'trees_deciduous_winter_n.webp')))) {
    console.log('  tree atlases already built (use --force)');
    return;
  }
  await fetchSources();

  const only = speciesFilter();
  const dirs = {};
for (const [id, spec] of Object.entries(SPECIES)) {
    if (only && !only.includes(id)) continue;
    const barkDir = path.join(TREECACHE, `${id}_bark`);
    await mkdir(barkDir, { recursive: true });
    if (force || !(await exists(path.join(barkDir, 'bark_n.png')))) await blender(['bark', barkDir, id], `${id} bark strip`);
    for (const season of SEASONS) dirs[`${id}_${season}`] = await renderSpeciesSeason(id, spec, season, { force });
  }

  for (const group of GROUPS) {
    const allOfGroup = Object.entries(SPECIES).filter(([, s]) => s.group === group);
    const speciesOfGroup = allOfGroup.filter(([id]) => !only || only.includes(id));
    // A group atlas is only correct when every species column is present: a
    // `--species` run that covers only part of a group used to write the atlas
    // from the columns it had, silently dropping the others.
    if (only && speciesOfGroup.length !== allOfGroup.length) {
      console.log(`  ${group}: ${speciesOfGroup.length}/${allOfGroup.length} species in this run, atlas left alone`);
      continue;
    }
    for (const season of SEASONS) {
      const albedo = [];
      const normals = [];
      for (const [id, spec] of speciesOfGroup) {
        const dir = dirs[`${id}_${season}`];
        if (!dir) continue;
        albedo.push(await sharp(await column(dir, spec.kind)).png().toBuffer());
        if (spec.kind === 'deciduous') normals.push(await sharp(await columnNormal(dir, spec.kind)).png().toBuffer());
      }
      if (!albedo.length) continue;
      await assembleTreeAtlas(group, season, albedo, normals);
      const rows = IMPOSTOR_ROWS[group];
      const imDir = path.join(TREECACHE, 'impostor', group);
      await mkdir(imDir, { recursive: true });
      const imAlbedo = [];
      const imNormal = [];
      for (const [id, spec] of speciesOfGroup) {
        const dir = dirs[`${id}_${season}`];
        if (!dir) continue;
        const a = path.join(imDir, `${season}_${spec.column}_d.png`);
        const n = path.join(imDir, `${season}_${spec.column}_n.png`);
        await copyIfAny(path.join(dir, 'impostor_albedo.png'), a);
        await copyIfAny(path.join(dir, 'impostor_normal.png'), n);
        if (await exists(a)) imAlbedo.push({ input: a, left: 0, top: spec.column * 256 });
        if (await exists(n)) imNormal.push({ input: n, left: 0, top: spec.column * 256 });
        for (const f of await readdir(dir)) {
          if (f.startsWith(`tree_${id}_`) && f.endsWith('.glb')) await copyIfAny(path.join(dir, f), path.join(OUTDIR, f));
        }
      }
      await writeImpostor(imAlbedo, 4096, rows * 256, `imposters_${group}_${season}_d.webp`, true);
      // The conifer needles keep their shape all year, so their normals are baked once.
      if (group === 'deciduous' || season === 'summer') {
        await writeImpostor(imNormal, 4096, rows * 256, group === 'deciduous' ? `imposters_${group}_${season}_n.webp` : 'imposters_conifer_n.webp', false);
      }
    }
  }
}

/** One group-season tree atlas from the species' 1024 px columns. */
async function assembleTreeAtlas(group, season, columns, normals) {
  const width = columns.length * 1024;
  const atlas = await sharp({ create: { width, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(columns.map((input, i) => ({ input, left: i * 1024, top: 0 })))
    .png()
    .toBuffer();
  if (group === 'deciduous') {
    await dilateToWebp(atlas, `trees_deciduous_${season}.webp`, { quality: 82 });
    if (normals.length) {
      const n = await sharp({ create: { width, height: 1024, channels: 3, background: { r: 128, g: 128, b: 255 } } })
        .composite(normals.map((input, i) => ({ input, left: i * 1024, top: 0 })))
        .png()
        .toBuffer();
      await sharp(n).webp({ quality: 88, effort: 6 }).toFile(path.join(OUTDIR, `trees_deciduous_${season}_n.webp`));
    }
    console.log(`    trees_deciduous_${season}.webp (+normals)`);
  } else {
    // Colour and alpha stay in separate maps: a consumer that alphaTests does not
    // need the alpha in the colour texture, and a greyscale map compresses better.
    // The RGB is dilated *before* the split, because bilinear filtering samples the
    // colour map at a cutout's edge whether or not the alpha map calls it cut: an
    // undilated transparent black is a black fringe, the same rule the deciduous
    // atlas has always followed and this one had not.
    const bleed = dilateRGB(await loadImage(atlas, { ch: 4 }), { iterations: 10 });
    const tmp = path.join(CACHE, 'trees', 'conifer_atlas_dilated.png');
    await savePng(bleed, tmp);
    await sharp(tmp).removeAlpha().webp({ quality: 84, effort: 6 })
      .toFile(path.join(OUTDIR, `trees_conifer_${season}_m.webp`));
    await sharp(tmp).extractChannel('alpha').webp({ quality: 88, effort: 6 })
      .toFile(path.join(OUTDIR, `trees_conifer_${season}_a.webp`));
    console.log(`    trees_conifer_${season}_m/_a.webp`);
  }
}

/** Albedo impostor rows get their RGB dilated; normal rows sit on a flat normal. */
async function writeImpostor(parts, width, height, file, dilate) {
  if (!parts.length) return;
  const base = sharp({ create: { width, height, channels: dilate ? 4 : 3, background: dilate ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 128, g: 128, b: 255 } } });
  const buf = await base.composite(parts).png().toBuffer();
  if (dilate) await dilateToWebp(buf, file, { quality: 80 });
  else await sharp(buf).webp({ quality: 88, effort: 6 }).toFile(path.join(OUTDIR, file));
  console.log(`    ${file}`);
}
