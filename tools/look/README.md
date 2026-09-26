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

A cold cache rebuild needs network (about 1.3 GB of source downloads: the Poly
Haven grass and bush packs, the ambientCG bark, leaf and ground sheets) and Blender at
`/Applications/Blender.app/Contents/MacOS/Blender`. Blender runs go through
`nice -n 15` and use 6 threads, so a rebuild beside a running game is possible.
The cache lives in `tools/look/.cache` and is gitignored; **the outputs are
committed**, so the game does not need the cache or Blender.

Typical times on an M2 Pro: `--only noise,ground,road grass bush` under a minute
each; the tree group is ~25 minutes (about 300 Cycles renders plus the decimated
stump and log models) — a deciduous species-season is about a minute, a conifer one
half a minute to a minute, since one impostor row is sixteen copies of a 0.4-1.2 M
vertex tree in a single 4096 x 256 pass, and a conifer's normal row is baked once
and shared by the four seasons.

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
* **Every model UV comes from the layout constants that write the manifest.** A
  GLB is the one asset the manifest cannot describe after the fact, so its UVs are
  derived from the same cell rects (`cell_uv`) and shifted into the species' column
  by the exporter. Two things follow and both have been got wrong here: a repeating
  bark strip is put on a trunk as *pieces* of one repeat each (`bark_chunks`,
  `_model_trunk`), never as one long quad — a `%` inside a quad sweeps backwards
  across the seam — and the strip's `v` is its own band (`cell_uv(BARK)`), not the
  whole column. Checked by sampling: `glbcheck` reads each GLB's triangle centres,
  maps them through the manifest's cells and requires the atlas' cutout to be
  opaque there — the 16 deciduous models at 100 %, the pine at 89 %, the spruce at
  68–74 % (its remaining centres land in the needle gaps of the star cell itself).
* **Cells have world sizes.** A sprite cell is documented in metres so the
  consumer makes a quad of that size and needs no vertex-side cropping. Grass
  cells each have their own frame (0.28–1.30 m), bushes share 1.6 m, tree clump
  cells are 3.2 m, the whole-tree cell is 8.0 × 12.0 m, impostor cells are 12.4 m
  with the base on the cell's bottom edge.
* **A pack's parts keep their own textures, per material slot.** `plants.kit()`
  picks the base-colour image of every material *slot* of every object. (This is a
  grass-and-bush rule now: the conifers are no longer cut out of Poly Haven packs at
  all — see the next two bullets — but a kit pack still ships bark, trunk and twig
  as separate slots, and one image for the whole pack painted every part with
  whichever sheet was scanned last.) It also disables the black-background `gate`
  for geometry: keying on luminance eats dark needles.
* **A conifer is grown, not sliced.** A spruce and a pine are the *same* machinery a
  deciduous tree uses: a deterministic skeleton grown from (species, seed) — a
  straight trunk and regular whorls, each whorl branch as long as the crown's own
  cone radius at its height, ascending near the leader and drooping with hanging
  branchlets lower down — then a needle card per drawable shoot, the same per-card
  occlusion bake, the same quad, and the same render passes. The game model is grown
  from that tree as well (a spruce's fans are its own whorls; a pine's crossed crown
  cards sit where its own crown is), so the model→sprite hand-over is a change of
  drawing and not a change of tree. Everything before this pass cut a CC0 fir and a
  pine out of their packs with camera clip planes, and the two were different trees:
  flat olive silhouettes, whorl cells aimed at the gaps between tiers, a hexagon of
  trunk through the middle of a star and a bare pole where the crown should have
  been. The three top-down cells are now **one** star per species, a real view from
  directly above the tree's own widest whorl and the two tiers either side of it —
  whole whorls, so it cannot land between tiers — centred on the trunk axis (where a
  fan's centre vertex is, not where a leaning scan's bounding box is) and scaled so
  it fills 94 % of the cell.
* **A needle card carries a *drawn* shoot.** A photograph cannot fill one: a spruce
  needle is 1.5–2 cm, which is one texel at the whole-tree cell's 64 px/m and a third
  of a texel at an impostor cell's 20.6 px/m, so a scan of real needles is speckle —
  which is what "flat olive silhouette" was. `trees.py`'s `needle_sheet()` draws four
  shoots per species on transparent instead, at the scale the card is *seen* at (a
  twig with ~30 strands raked off it, 2–4 px wide on a 256 px cell, dark at the twig
  and lighter at the tips): the same reasoning that makes `plants.py` draw its umbel
  heads, and the same rule as a deciduous leaf card, which carries a *cluster* and
  not one blade. Card sizes follow from it — 20–30 cm of spruce shoot, 28–40 cm of
  pine tuft — and a card is never one flat colour: its tip end is brighter than its
  base, and its `Col` carries the per-card brightness and occlusion.
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
  the model *and* of the sprite. A **conifer's** two cells differ, and for a reason:
  a spruce's repeats every 2 m at 512 px/m both ways (a thin grey-brown scale mosaic
  off the ambientCG scan, with synthesised cracks and a trace of lichen); a pine's
  cell is its *whole trunk*, 11.6 m along u by 2.9 m around v, so the cell's 4:1
  pixels come out at 88 px/m on both axes. That is the only way one sheet can hold
  the two zones a Scots pine is known by — grey-brown furrowed bark to 40 % of the
  height, orange-red flaky plates above — since a 2 m tile cannot have an upper and
  a lower half. Both species' trunks are sampled by *height* (u = z/height), their
  limbs stay in the flaky zone by distance along the branch, and their dead stubs
  sit in the grey, so the model wears the bark its sprite shows. Wood that a crown
  surrounds is darkened by a second term beside `_bark_ao`: `_wood_ao` knows the
  crown's radius at that height, so a whorl branch is bright at its tip and dark
  where it leaves the trunk, and a spruce — which carries its crown to the ground —
  has no bright trunk through its needles.
* **Winter deciduous is the same tree with the leaves off.** `is_bare()` drops the
  leaf quads for a deciduous species in winter, builds the wood to its last order
  untrimmed and fattened (`WINTER_TWIGS`: a limb keeps its size, the last order is
  drawn 3.4x, because a 5 mm twiglet is a third of a pixel at 64 px/m and at its true
  width a bare crown is an invisible tracery — 0.018 cell alpha against the
  reference's 0.102), and renders the pass through the species' bark
  material. A grey-green
  grade over the summer geometry was the first attempt and it reads as a leafy tree
  at any distance; the leaves have to be *absent* — the twigs are what a bare crown
  is, and a few thousand sub-pixel twiglets are the soft brown haze one has.
* **Sprites come from full-detail geometry, never from the game model.** A tree
  sprite is a render of the *grown* tree — trunk, four branch orders, and every
  leaf as its own quad — not a photograph of the ~170-vertex model the game swaps
  in. Tree leaves are 15–19 cm because a sprite leaf is a *cluster*, not one blade:
  at 64 px/m a true 4 cm birch leaf is 2.7 px, which reads as speckle. The crown is
  sized so it fills its cell — the deciduous crown bounding box is 82–95 % of the
  whole-tree cell's width (aspen the narrowest, birch and lime the fullest) and
  52–61 % of the 12.4 m impostor cell's, against slowroads' 61–65 % — and its leaf
  cloud reaches down to a fifth of the tree's height, so no bare trunk with a tuft
  on top. The conifers are held to the same three bars and a fourth of their own:
  the spruce's crown runs to the ground in its 8 m cell (84 % of the width, 94 % of
  the height) and the pine's starts at two thirds of its height with its plates
  spread to 91 % of the cell.
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
skeleton of four branch orders with species habits, then leaves scattered along the
terminal twigs — and renders every sprite from it: the six crown modules are
subtrees of that same tree, the whole-tree sprite is the whole tree, and the
impostor row is sixteen copies of it in one render, one material per view. A
conifer is grown by the same recursion with a whorled habit — trunk, whorls, then
needle cards along the shoots, `sprig_out()` where a deciduous tree has
`leaf_out()` — and its four cells are four views of that one tree: the whole-tree
sprite, the top-down star (its own widest whorl and the tiers either side, seen from
directly above, `sel`-ed by whorl rather than clipped), the side cell (one whole
branch, `sel`-ed by its subtree) and the impostor row. Normals are baked
analytically (crown capsule for deciduous, cone for conifers — the outward direction
tilted 0.30 up at the skirt and 0.75 at the leader — flattened outward for bark)
because that is what the game shader reconstructs, and the two have to agree or the
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
| conifer impostor, cell height | 91 % (spruce), 95 % (pine) | 99 % (spruce), 95 % (pine) |
| conifer impostor, coverage inside the bbox | 0.50 (spruce), 0.29 (pine) | 0.33 (spruce), 0.38 (pine) |
| conifer impostor, bbox width of the cell | 54 % (spruce), 57 % (pine) | 54 % (spruce), 49 % (pine) |
| conifer star cell, mean alpha | 0.27 | 0.29 |
| whole-tree sprite, crown width | 90–95 % of the 8 m cell (deciduous), 84 % (spruce), 91 % (pine) | — |
| whole-tree sprite, coverage inside the bbox | 0.50 (spruce), 0.29 (pine) | — |

(The conifer impostor cells are 256 x 256 px in our atlas and 256 x 512 px in
slowroads' — a 12.4 m cell against 24.8 m — so the mean alpha of the two cells is
not comparable and the coverage inside the sprite's own bounding box is what the
comparison rests on.)

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
