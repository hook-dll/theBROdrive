# `tools/look` — the CC0 look-asset pipeline

Everything the world renderer draws on top of terrain geometry comes from here:
tileable ground and road textures, grass, bush and tree sprite atlases, tree
models and impostor bakes. Sources are **CC0 only** (ambientCG and Poly Haven)
plus our own Blender 5.2 renders. `public/look/LICENSES.md` records every source
and what it became; `public/look/manifest.json` describes every output
(size, channels, layout, tiling period, what each cell holds).

## Rebuild

```bash
node tools/look/build.mjs                 # everything (downloads + Blender renders)
node tools/look/build.mjs --only ground   # one group: noise ground road grass bush trees
node tools/look/build.mjs --manifest      # rewrite manifest.json + LICENSES.md only
node tools/look/build.mjs --force         # ignore what is already on disk
```

`--only` still writes the metadata for **all** groups, so a partial rebuild never
drops another group's entries from the manifest.

A cold cache rebuild needs network (about 1.4 GB of source downloads, mostly the
two Poly Haven tree packs) and Blender at
`/Applications/Blender.app/Contents/MacOS/Blender`. Blender runs go through
`nice -n 15` and use 6 threads, so a rebuild beside a running game is possible.
The cache lives in `tools/look/.cache` and is gitignored; **the outputs are
committed**, so the game does not need the cache or Blender.

Typical times on an M2 Pro: `--only noise,ground,road grass bush` under a minute
each; the tree group is ~20 minutes (about 130 Cycles renders).

## Layout

```
tools/look/
  build.mjs            the one command: group builds, then manifest + LICENSES
  lib/util.mjs         paths, cached downloads (fetchTo/obtain/unzipInto), CLI flags
  lib/image.mjs        float RGBA image toolkit: highpass, equalise, dilateRGB,
                       normalFromHeight, webp/png encode, srgb<->linear
  lib/polyhaven.mjs    Poly Haven API: list/info/files, bundle + extra textures
  lib/ambientcg.mjs    ambientCG API: search, 1K archive download and unpack
  noise.mjs            noise_* / detail_* masks (code-generated, seamless)
  ground.mjs           ground tiles
  road.mjs             road tiles
  grass.mjs            grass sprite atlas + flower mask (drives blender/plants.py)
  bush.mjs             bush atlases + bush.glb (drives blender/plants.py)
  trees.mjs            tree atlases, impostor atlases and GLBs (drives trees/trees.py)
  blender/lib.py       shared Blender helpers (scene, ortho cells, node maths, meshes)
  blender/plants.py    grass cells, bush cells, the crossed-card bush model
  trees/trees.py       branch modules, whole-tree sprite, impostor bakes, GLB export
  .cache/              gitignored: downloads and raw renders
```

Each builder module exports `name`, `order`, `sources`, `outputs` and
`build({force})`. `outputs` is metadata (it is what the manifest is generated
from), so a file is described in exactly one place. `sources` entries carry the
provider, id, exact URL and the outputs they became.

## Conventions

* **Ground tiles** are `RGB = albedo, A = height` (0 = base, 1 = crest) so the
  two height-blend cases in `docs/slowroads-steam/notes/SrGround.md` §5 work from
  one fetch. Greyscale tiles (grass, grass_snow, the detail masks) are `R=G=B`:
  the world shader tints them, so carrying colour would fight it.
* **Sprites** are `RGB = colour (or luminance), A = cutout`, alpha-tested at
  runtime. Grass is luminance-only for the same reason; bushes and trees keep
  photo colour with a per-season grade.
* **Normal maps** are OpenGL tangent space: +X right, +Y up, +Z out of the sprite
  toward the viewer — what three.js `normalMap` expects. `blender/lib.py`
  pre-compensates the sRGB transfer so the stored bytes are the encoded normal
  itself (`encode_normal`), otherwise a neutral channel lands on 187 instead of
  128 and every normal is tilted.
* **Atlas cell layout** is expressed in pixels with y from the top of the image
  in the Python side and converted to UV with v from the bottom in
  `manifest.json`, because that is what a shader author sees with three.js'
  default `flipY = true`. GLB UVs follow glTF (v from the top) and land in the
  same place through `GLTFLoader`'s `flipY = false`.
* **Cells have world sizes.** A sprite cell is documented in metres so the
  consumer makes a quad of that size and needs no vertex-side cropping. Grass
  cells each have their own frame (0.30–1.25 m), bushes share 1.6 m, tree clump
  cells are 3.2 m, the whole-tree cell is 8.667 × 13.0 m, impostor cells are 14 m
  with the base on the cell's bottom edge.
* **No black fringes.** Sprite atlases with alpha are dilated (`dilateRGB`) so
  bilinear and mip filtering never mixes the transparent background into an edge;
  the normal atlases sit on a flat `(128,128,255)` background for the same reason.
* **Seamlessness is claimed only where it is true** and is verified numerically
  (the wrap difference must be within ~1.5× of the interior difference). The
  ground and road builders report those numbers when they run.

## Blender side

Unlit by design: the game fakes lighting (Lambert plus the crown tricks in
`docs/slowroads-steam/notes/SrTrees.md`), so a bake only has to produce albedo,
cutout alpha and an analytic normal. Cycles at 4–32 samples, CPU, no denoising —
deterministic and reproducible.

Materials are built from `Math`/`Vector Math` nodes only (`lib.py`'s `Num`/`Vec`
expression layer) rather than Blender's `Mix` node, whose sockets are duplicated
per data type and rename between versions.

`trees.py` renders each species-season in passes: six branch modules (the clump
cells), the whole-tree sprite, sixteen-view impostor rows, and one bark strip per
species. Normals are baked analytically (crown capsule for deciduous, cone for
conifers, flattened outward for bark) because that is what the game shader
reconstructs, and the two have to agree or the model→impostor swap shows.

## Adding an asset

1. Add the source to the module's `sources` array (id, provider, URL, licence,
   what it becomes).
2. Add the output to `outputs` with its size, channels, `tiling_m` and layout.
3. Write it with `saveWebp`/`saveWebpTo` (or a Blender render plus a composite).
4. `node tools/look/build.mjs --only <group>` and check the file at 1:1 next to
   the slowroads counterpart in
   `/tmp/slowroads/app/build/_app/immutable/assets/`.
