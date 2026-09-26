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
node tools/look/build.mjs --only ground   # one group: noise ground road grass bush trees stumps
node tools/look/build.mjs --manifest      # rewrite manifest.json + LICENSES.md only
node tools/look/build.mjs --force         # ignore what is already on disk

# the tree group is the long one (>20 min): rebuild only the species being worked on
node tools/look/build.mjs --only trees --species spruce,pine --force
node tools/look/cmp.mjs conifer           # comparison sheets, /tmp/omp-shots/veg2-*.jpg
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
each; the tree group is ~35 minutes (about 300 Cycles renders plus the decimated
stump and log models) — a deciduous species-season is about a minute, a conifer
one 1.5-3 minutes, since one impostor row is sixteen copies of a 0.6-2.6 M vertex
model in a single 4096 x 256 pass.

## Layout

```
tools/look/
  build.mjs            the one command: group builds, then manifest + LICENSES
  cmp.mjs              comparison sheets against slowroads (/tmp/omp-shots), dev only
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
  trees.mjs            tree atlases, impostor atlases, GLBs
  stumps.mjs           stump and log models + their shared texture
  blender/lib.py       shared Blender helpers (scene, ortho cells, node maths, meshes)
  blender/plants.py    grass cells, bush cells, generated umbel heads, the bush model
  trees/trees.py       tree growth, sprites, impostor bakes, stump decimation, GLB export
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
  cells each have their own frame (0.28–1.30 m), bushes share 1.6 m, tree clump
  cells are 3.2 m, the whole-tree cell is 8.0 × 12.0 m, impostor cells are 12.4 m
  with the base on the cell's bottom edge.
* **A pack's parts keep their own textures, per material slot.** `plants.kit()`
  picks the base-colour image of every material *slot* of every object: the conifer
  meshes carry bark, trunk and twig as separate slots, and one image for the whole
  pack painted every needle with whichever sheet was scanned last (an orange-brown
  bark), which is what made the first conifer impostors look dead; one image per
  object still painted the trunk with the twig sheet. It also disables the
  black-background `gate` for geometry: keying on luminance eats dark needles.
* **A conifer is rendered at the species' own height, and the slice is where the
  tree is as wide as the cell.** The three top-down conifer cells used to be sliced
  at fixed fractions of the height, which for a spruce landed in the gaps between
  whorl tiers and produced nearly empty stars; the slice is now chosen from the
  tree's own radius profile, taking the widest tier for the biggest cell and
  progressively higher — narrower — ones for the two small cells, and scaled so the
  star fills its frame. Two metres of the tree pass the clip planes (`_WHORL_SLAB`),
  not one tier, so the star is a needle mass rather than a ring of spokes; the star
  is centred on the **trunk axis at that height**, not on the bounding box, because
  a scanned fir leans and the fan it is mapped onto does not. Every conifer render
  also carries `species height / pack height` on the object transform: the CC0 fir
  is 14.5 m and the game's spruce is 11.6 m, and a 14.5 m tree in a 12.4 m impostor
  cell would hand a size change over to the model.
* **The conifer pack is chosen for its crown, not its detail count.** `fir_tree_01`
  is a *forest* fir: its crown starts at 7 m of its 14.5 m, so at the species'
  height its impostor was a bare pole with a tuft, while the game model is a cone
  with whorls from 1.4 m. The spruce uses `fir_sapling` instead — a fir with its
  branches to the ground — and the 9× blow-up puts its needles four texels across
  the impostor cell, where a scan of real 2 cm needles at 20.6 px/m is sub-texel
  speckle. The pine keeps `pine_sapling_medium`, which is already 229 vertices per
  metre.
* **The bark strip is the trunk unrolled, and its pattern lives in uv metres.** The
  strip used to be a photograph of a vertical cylinder, which put the visible 0.6 m
  of trunk in the middle 30 % of a 2 m cell and mapped the circumference through an
  arccos — a pale square with one smeared blob, on the model as well as in the
  atlas. It is now a flat sheet in the X–Z plane: u along the trunk (2.0 m per
  repeat) and v one wrap around it (0.5 m), 512 px/m on both axes, so a lenticel
  drawn 1 px thick lands 1 px thick on the trunk. Every bark pattern is written in
  that uv frame because the strip render and the trunk of the model have different
  object axes (x/0/z against x/y/height) and uv is the one frame they share.
  Neither provider publishes a CC0 birch bark, so birch is synthesised (cream,
  flaking grey from the luminance of a pale ambientCG bark, black lenticels and
  scabs hashed onto a grid that wraps around the trunk); aspen is the grey-green
  ambientCG sheet with dark diamond leaf scars. "Darker toward the base" cannot be
  baked into a tiling strip, so it lives where the trunk's height is known: the
  `_bark_ao` term in the wood's `Col` attribute, which darkens the root collar of
  the model *and* of the sprite.
* **Sprites come from full-detail geometry, never from the game model.** A tree
  sprite is a render of the *grown* tree — trunk, four branch orders, and every
  leaf as its own quad — not a photograph of the ~170-vertex model the game swaps
  in. Tree leaves are 15–19 cm because a sprite leaf is a *cluster*, not one blade:
  at 64 px/m a true 4 cm birch leaf is 2.7 px, which reads as speckle. The crown is
  sized so it fills its cell — the deciduous crown bounding box is 82–95 % of the
  whole-tree cell's width (aspen the narrowest, birch and lime the fullest) and
  52–61 % of the 12.4 m impostor cell's, against slowroads' 61–65 % — and its leaf
  cloud reaches down to a fifth of the tree's height, so no bare trunk with a tuft
  on top.
* **A tree's shading is baked as per-leaf occlusion, not simulated.** A
  ray-traced sun would double-light against the game's Lambert pass, so each leaf
  carries the part Lambert cannot know — how boxed-in it is — in the `Col`
  vertex attribute (R the autumn turn, G the brightness, B the occlusion), and
  the wood gets the same treatment by height inside the crown.
* **Normals are per vertex for deciduous trees.** The crown capsule (and the
  conifer cone) is evaluated per leaf, rotated by the impostor view's azimuth and
  stored in the `Col` attribute of that view's pass, so one impostor row bakes
  sixteen view-space normal cells without a normal-map node graph. A bark normal is
  the trunk's outward direction unrolled — read from the strip's uv, so the strip
  render and the trunk of the model get the same normals — with a small outward
  component rather than a full hemisphere: a trunk is shaded as a rounded column,
  not as a dome.
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

`trees.py` grows a tree deterministically from (species, seed) — a recursive
skeleton of four branch orders with species habits, then leaves scattered along
the terminal twigs — and renders every deciduous sprite from it: the six crown
modules are subtrees of that same tree, the whole-tree sprite is the whole tree,
and the impostor row is sixteen copies of it in one render, one material per view.
Conifers are drawn from the Poly Haven models directly, with the top-down whorl
slices the game's fan model samples. Normals are baked analytically (crown
capsule for deciduous, cone for conifers, flattened outward for bark) because that
is what the game shader reconstructs, and the two have to agree or the
model→impostor swap shows.

`plants.py` builds each grass and bush cell as a *scene* of many CC0 plants sized
and scattered to fill its own frame. Poly Haven has no CC0 umbellifer, so the
"зонтичные" bush slot generates its white umbel heads (`umbel_head_texture`) and
hangs them on thin procedural stems over real CC0 foliage.

A *separate* opacity map is read as a greyscale mask unless the file really carries
an alpha channel (`lib.py`'s `_opacity_is_grey`, from the PNG's own colour type).
Blender reports `channels == 4` for a greyscale PNG too — it converts the file on
load — so the old `channels == 1` test never fired for a Poly Haven `Alpha.png`, the
material read the image's own alpha (1 everywhere) and cut nothing. A black-background
sheet survived that because the luminance gate still cut it; a sheet whose background
is foliage (`fern_02`, `nettle_plant`, `weed_plant_02`) came out as a **green
rectangle** — the bracken cell's "green mass".

A bush cell is a scene, never a disc: no radial or elliptical feather is applied to
it, because a soft cut round the cell gave every slot a bowl-shaped bottom and took
the plants' contact with the ground away with it. The plants stand on the frame's
bottom edge (z = 0 in the render, which is the slot's v = 0), so a bush instance
meets the terrain along its base. The bracken slot is a *rosette*: `radial` places
its seven fronds on their own angles round the cell instead of scattering them
through it, which is the difference between bracken and a green mass.

## Adding an asset

1. Add the source to the module's `sources` array (id, provider, URL, licence,
   what it becomes).
2. Add the output to `outputs` with its size, channels, `tiling_m` and layout.
3. Write it with `saveWebp`/`saveWebpTo` (or a Blender render plus a composite).
4. `node tools/look/build.mjs --only <group>` and check the file at 1:1 next to
   the slowroads counterpart in
   `/tmp/slowroads/app/build/_app/immutable/assets/`.

## Checking a rebuild

Sprites are judged against slowroads by flattening both onto `rgb(90,130,190)` and
stacking ours over theirs at the same width. Every group rebuild in this pipeline
was signed off that way, and `node tools/look/cmp.mjs` regenerates the whole set
into `/tmp/omp-shots/veg2-*.jpg` (one sheet per group and season, `cmp.mjs conifer`
for a single one) from `public/look` and the read-only slowroads build at
`/tmp/slowroads`; the numbers below are in `docs/renderer-v2-log.md`.

Density is measured, not eyeballed: the mean alpha over the cell, the alpha
coverage inside the sprite's own bounding box, and the bounding box in metres
against the cell size the manifest claims. The figures the 2026-09-26 rework was
signed off with:

| | ours | slowroads |
|---|---|---|
| deciduous impostor, crown width | 61 % of the cell (birch) | 61–65 % |
| deciduous impostor, cell height | 88–93 % | 91–96 % |
| deciduous impostor, mean alpha of the cell | 0.19–0.24 | 0.29–0.39 |
| conifer impostor, mean alpha of the cell | 0.10 (pine) | 0.14–0.23 |
| whole-tree sprite, crown width | 90–95 % of the 8 m cell | — |

A tree sprite must clear three bars, because those are the three ways the first
set failed:

* coverage inside the crown bounding box of at least ~30 % (the first set was 23 %
  with the whole crown made of flat cards);
* the crown bounding box filling at least ~80 % of the cell width;
* no bare bar of wood outside the leaf mass — a limb drawn to its tip and left
  uncovered is the most obvious "this is a game asset" tell.

For a conifer there is a fourth: the sprite must be the *same tree* as the model
it hands over to. Both the height (species height / pack height on the object
transform) and the crown's extent — branches to the ground — have to agree, or the
hand-over is a change of size and shape as well as of drawing.
