# SrTrees.md

## Summary

slowroads trees work like this. Near the camera each tree is a very low-poly OBJ. Deciduous trees are about 135–180 verts: a trunk plus about 20 large planar card polygons cut from whole-tree and clump sprites. Conifers are about 150–260 verts: a 5-sided trunk plus about 20 stacked radial 'whorl' fans that use top-down branch sprites. All trees in a season share two 4096×1024 atlases: deciduous RGBA with a tangent-space normal map, and conifer colour with a separate alpha map. Past roughly 150–250 m, 16-view × 4-variant impostor atlases (256² per view) take over. The swap is a complementary noise-threshold dissolve, and neighbouring views are blended with a noise-dithered step. Crown volume is faked entirely in the vertex shader: an analytic capsule (deciduous) or cone (conifer) 'centre normal' masks the sun, radial interior darkening does the rest. The bright sunlit canopy comes from an emissive term multiplied by directDiffuse: direct × (rg·8, 0.5) × radiance. Trees do not sway in the wind and never cast or receive real shadows. Tree shadow on the ground comes from a per-vertex treeMask that darkens sun on the terrain and blends in a forest-floor texture. Seasons swap whole atlases. Winter snow on deciduous trees is a shader blend on up-facing normals; conifer snow is painted into the winter atlas.


## Architecture

Per tile (heightmap tiles of 240–2500 m), the treemap noise (Ya) is sampled every 20 m cell in a 2×2 pattern with a 10 m step. Each sample gives an 'arrangement' of 0–3 trees at fixed offsets inside a 10×10 m square. The trees become impostor instances in pooled InstancedMeshes (n4, capacity imposterInstanceSize 400–16000, renderOrder 20, material p, visible for the whole loaded tile range). When a near cell reaches LOD1 (lod1Horizon cells), loadTrees() sets the impostor's per-instance `dissolve` flag to 1 and adds the same tree to NearTreeManager (w7). w7 keeps 8 InstancedMeshes (2 types × 4 variants, capacity treeInstanceSize 400–600, renderOrder 10, no shadows) with materials ke[0] (deciduous) and ke[1] (conifer). Both LODs are opaque alpha-tested and DoubleSide. The crossfade runs on complementary noise-texture thresholds in the shaders, so no sorting or blending is needed. Seasons swap the textures on these three materials. The ground shader reads the per-vertex `treeMask` (shadow density) to darken sun and blend a forest-floor texture under canopies.


## Files

- /tmp/slowroads/pretty/chunks/tree_04.6b3d8a5d.js: All 3D tree shader chunks: conifer (lines 3-150 vertex, 157-201 fragment, 203-420 lights, 520-551 Lambert) and deciduous (522-760 vertex, 762-808 fragment/snow/alphatest, 810-1060 lights, 1135-1180 Lambert). Also imports summer_trees_0/_n and tree_01..04.obj
- /tmp/slowroads/pretty/chunks/HillsHeightmap.b6172a83.js: Season style tables (maps.trees, imposterMap/B, effects.shadowFactor/treeDiscolouration/hasSnow, lights.radiance), graphics viewDistance/detail tables (1470-1650), impostor shaders No/Uo/Fo/Oo/Ho/Po/zo/Go/ko (2934-3405), tree materials Vt()/ke and impostor material p (5155-5305), ds() dissolve distances (4905-4915), season swap (4864-4877), ground treeMask/forest floor (2151-2170, 2439-2455), exported constants (Os=11 quad size, Hs=4 rows, Ps=2, zs=1.8, Gs=0.7, Ta/Fa instance sizes)
- /tmp/slowroads/pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js: Placement tables k9/m9/w9/Fa/Ua (43290-43590), treemap class Ya (getDensityAt/getShadowDensityAt/getTreesAt 43590-43680), impostor InstancedMesh class n4 + LOD manager A2 (44500-44720), tile tree placement customGenNormals0 (44818-44880), NearTreeManager w7 (45397-45590), cell loadTrees/customUpgrade 3D swap (45945-46070), sun shadow frustum ±4 m (49801-49810)
- /tmp/slowroads/pretty/nodes/4.e801d142.js: /dev/imposters baker: 16 rotations × 4 variants at 256², camera fov 68 zoom 12.3 at (0,5.35,100); unlit albedo pass plus view-space normal pass with a crown normal bend (lines 38-260)
- /tmp/slowroads/pretty/chunks/normals.f63d4883.js: normal_fragment_begin override cD (45649, tbn uses -normal), shadowFactor default rx=0.5 (24540), lights_fragment_begin_shadow (ground sun *= 1-vShadow, 24730)
- /tmp/slowroads/app/build/_app/immutable/assets/summer_trees_0.d5cc9742.webp: 4096×1024 deciduous RGBA atlas: 4 species columns of 1024 px (ash, sycamore, birch, beech); top 3/4 holds a whole-tree sprite plus 3 clump sprites, bottom 1/4 is a tiling bark strip. Matching _n is a tangent-space normal map with per-leaf-clump sphere curvature
- /tmp/slowroads/app/build/_app/immutable/assets/summer_trees_1_m.866c5db4.webp: 4096×1024 conifer colour atlas: bark u<0.125, fir whorl top-down star, hemlock hanging branch, pine branch, larch (u 0.59-0.77), cypress top-down disc (u>0.77) on dilated green background; _1_a is its grayscale alpha
- /tmp/slowroads/app/build/_app/immutable/assets/summer_imposters_0_d.6a3261f4.webp: 4096×1024 impostor albedo: 16 view columns × 4 variant rows, 256² cells, variant 0 at the bottom; _0_n holds baked view-space normals on a flat 0x7E83FF background
- /tmp/slowroads/app/build/_app/immutable/assets/tree_01.49d91079.obj: 01_ash: 135 verts, ~70 faces (trunk/branches + ~20 planar crown ngons mapped to sprite regions); tree_02 sycamore, tree_03 birch (~182 v), tree_04 beech are similar
- /tmp/slowroads/app/build/_app/immutable/assets/tree_05.d68751e5.obj: conifer_01_pine: ~205 verts, 5-sided trunk y=-2.5..10, ~25 whorl fans (centre vertex on axis + 4-8 tips, tips 0.4-1.1 m above centre; radius 3.2 m at the bottom tapering to 0.7 m at 10.6 m). tree_06 hemlock, tree_07 larch (~260 v), tree_08 cypress (~154 v)


# slowroads trees & forests: reverse-engineering report

The pretty-printed paths below are under `/tmp/slowroads/pretty/`. "Hills" = `chunks/HillsHeightmap.b6172a83.js`, "SCC" = `chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js`, "T04" = `chunks/tree_04.6b3d8a5d.js`.

---

## 1. Crown shading math (the look)

There are three separate programs: the 3D deciduous tree, the 3D conifer, and the impostor. All three are patched `MeshLambertMaterial`s.

### 1a. Deciduous 3D
Source: T04 — vertex pars `_` 522, project_vertex `v` ~580-700, centre normal `r` 553-578, map `S` 721-735, alphatest `p` 737, snow `w` 739-750, lights `N` 810-1060, Lambert `I` 1135-1180. Wired up in Hills 5207-5251.

**The "centre normal" (the crown volume proxy)** is computed per vertex in object space:
- Leaves (`uv.y > 0.25`): `Nc = normalize(position - vec3(0, min(position.y, 5.0), 0))`. This is a **capsule**: radial and horizontal below 5 m, spherical around (0, 5, 0) above it.
- Trunk and bark: `normalize(position - vec3(0, 7, 0))`. This points down and outward, so trunks mostly face the ground and render dark under the canopy.

**Fake interior self-shadow** (`vShadow`, per vertex):
- `d2 = |position - (0, min(y, 5 + density·shadowFactor), 0)|²`.
- If `d2 < 8` (r < 2.83 m), `vShadow = 1`.
- Else if `d2 < 36` (r < 6 m), `vShadow = 1 - (d2 - 8)/28`. Otherwise it is 0.
- `vShadow = max(vShadow, 1 - saturate(y/8))`, so the lower crown is always darker.
- Finally `vShadow *= shadowFactor`. shadowFactor per season: summer 0.9, spring 0.8, autumn 0.8, winter 0.75 (Hills 177/453/734/1017).

**Direct sun** (per directional light):
1. On leaves, `L.color *= 1 - vShadow·0.5` (interior leaves get at most 50% sun).
2. `L.color *= clamp(dot(L.dir, Nc)·2, 0.25, 1)`. This is the crown-sphere terminator: the side facing away from the sun keeps 25%, and the ramp is 2× steep.
3. Standard Lambert `dotNL = saturate(dot(N_mapped, L))`. N_mapped is the **normal-mapped card normal** (tangent space; the tbn uses `-normal`, see normals.js 45649 "MAGIC NORMAL FIX"). Leaf clumps therefore keep per-clump relief *inside* the macro sphere shading.

**Ambient**: if `vShadow > 0.5`, `irradiance *= 1.5 - vShadow`, down to ×0.5 in the core.

**"Radiance" (the bright sunlit canopy)**:
- `leafEffect = step(b·1.5, g) · vLeafBrightness`. This keys on "is this texel green leaf, not bark".
- `vLeafBrightness = 1 - density·shadowFactor·saturate((10 - y)/3)`. Dense-forest trees lose the glow below 7–10 m.
- `totalEmissiveRadiance = vec3(diffuse.rg·8, 0.5) · radiance · leafEffect · vRadianceBlend`.
- The final line is patched to `outgoing = directDiffuse + indirectDiffuse + directDiffuse * totalEmissive` (Hills 5249).
- So the emissive term is a **multiplier on sunlit diffuse only**. Sunlit leaves get roughly ×(1 + 8·rg·radiance) in R and G and ×(1 + 0.5·radiance) in B, which is a saturated yellow-green blow-out. The shaded side (25%) stays dark. The contrast between them is the bright rim / dark interior look.
- Tree `radiance = lights.radiance / 2`. Per time and weather it ranges from 0 to 8, e.g. summer clear morning 4 → trees 2, overcast about 1 (Hills 4864).

**Distance darkening**: `vRadianceBlend = 1 - saturate((z - 50)/200)·0.33`, and `diffuse *= vRadianceBlend`. Trees lose up to 33% brightness between 50 and 250 m. This also fades the glow.

**Per-tree tint**:
- `discolouration = 1 + (noise_fine(wPos.xz/256).r - 0.5)·treeDiscolouration`, with treeDiscolouration = summer 0.9, spring 1.5, autumn 1.2, winter 0.2.
- Applied to **R and G only** on leaf texels: `rg *= 1 - (1 - disc)·leafEffect`.
- Result: patches of forest about 256 m across shift between blue-dark green and yellow-bright green (in autumn, between orange and brown).

**Dynamic alpha test**: `vAlphaTest = max(0.3, 0.5·(1 - z/(dissolveFar + interval)))`. The cutoff falls from 0.5 near to 0.3 far, so mip-mapped crowns don't erode.

**Headlights** (spot): `dotNL = max(0.1, saturate(dot(N, L) - 0.5))`, a squashed ramp that keeps leaf texture visible, then `color *= vShadow`.

**For us:** this is the single most important thing to adopt:
- Analytic capsule centre-normal masking: `clamp(2·dot(L, Nc), 0.25, 1)`.
- Radial interior `vShadow`.
- Card normal map for detail on top.
- Emissive-as-multiplier-of-direct `(rg·8, 0.5)·radiance` for the sunlit glow.
- Tie `radiance` to the time/weather preset (clear sun ≈ 2 for trees, overcast ≈ 0.5).
- Keep the 50→250 m 33% darkening and the dynamic alpha test 0.5→0.3.

No SSS, no real AO, no wrap lighting is needed. The look is three cheap multiplicative masks.

### 1b. Conifer 3D
Source: T04 — `d` 3-37, `l` 70-155 with shadow cone `i` 47-68 and tint `e` 38-45; fragment `c`/`t`/`h` 157-200; lights `f` 203-420; Lambert `g` 520-551.

**The normal is fully replaced** by an analytic cone normal. `normal_fragment_begin` → `normal = normalize(Nc)`, and there is no normal map; the material uses map + alphaMap.
- Crown verts: `Nc = normalize(x, max(0.5, heightLerp·1.5)·centerDist, z)` with `heightLerp = y/12`. Normals tilt more upward toward the top.
- Below y = 0 the normal is horizontal. The trunk gets (x, 1, z).

**Shadow cone**:
- `shadowRadius = (2.5 + 1.0·larch + density) · max(0.1, 1 - heightLerp)`.
- `vShadow = shadowRadius - centerDist`.
- ×0.75 for larch and cypress. Species are picked by atlas u: larch 0.59–0.77, cypress > 0.77.
- Bark (u < 0.125): `vShadow = 0.7 + 0.3·density`.
- Finally ×shadowFactor.
- Fragment: `fShadow = sqrt(saturate(vShadow))·0.65` and `diffuse *= 1 - fShadow`. Inner needles are up to 65% darker.
- Ambient: `irradiance *= 1 - max(0, fShadow - 0.6)`. Headlights: `*= 1 + fShadow`.

**Sun**: `L.color *= max(0, dot(L, Nc))`, then Lambert again with the same normal. That is effectively dot², and the source comments it as "bit severe". The result is a strong sun side / shade side split on the cone.

**Tint**: `diffuse.g *= discolouration` for u > 0.125. Cypress uses `disc/2 + 0.5`. Conifers get no radiance glow.

**For us:** spruce and pine should use a cone normal plus a sqrt shadow cone with 65% max darkening and a squared sun term. This gives dark cores with lit tips. Birch and other deciduous trees should use 1a.

### 1c. Impostors
Source: Hills — vertex `No`/`Uo`/`Fo`/`Oo`/`Ho` 2934-3077, fragment `Po`/`zo`/`Go`/`ko` 3079-3405, material `p` 5261-5305.

- **Normals.** The baked view-space normal is read through the tangent frame. `textureGrad` uses the *unshifted* uv derivatives, so view switches don't cause mip seams.
- **Lighting** is plain Lambert with no crown term; it is already baked into the normals. `directSpecular = directDiffuse`, and `outgoing += directSpecular·totalEmissive`, so impostors get the same radiance glow.
- **Deciduous rows**: `rg *= discolouration`, `emissive = vec3(rg·8, 0.5)·radiance·vRadianceBlend·vLeafBrightness`.
- **Base darkening**: `vLeafBrightness = 1 - 0.25·shadowFactor·saturate((0.25 - uv.y)/0.08)`. Everything except the top ~third is darkened by up to 22.5%, and `vRadianceBlend *= max(0.5, vLeafBrightness)`.
- **Headlights** on impostors are scaled ×0.2.

**For us:** impostors must share the 3D tree's tint noise, radiance glow and distance darkening, or the LOD seam shows. Bake the crown normal bend into the impostor normals.

---

## 2. Leaf and crown textures

All tree atlases are 4096×1024 WebP, one set per season.

**`*_trees_0.webp`** (deciduous albedo; alpha carries the cutout):
- 4 species columns of 1024 px: ash, sycamore, birch, beech (tree_01..04).
- In each column the top 768 px hold:
  - one **whole-tree sprite**, about 500×750 px;
  - one side clump, about 300 px;
  - two round clumps, about 200–250 px.
- The bottom 256 px is a tiling **bark strip**: rough grey-brown, brown, white birch with black lenticels, and banded beech.
- Background RGB is dilated to avoid dark fringes.

**How the leaves look**: dense small leaves, clearly **rendered from 3D leaf geometry with photo leaf textures**, not hand-painted. There are small gaps and some baked AO. Leaf density is about 60–75 px per metre of crown on the 3D card. Spring is lighter yellow-green with more branch showing. Autumn has orange/brown ash, sycamore and beech, and yellow birch. Winter is **bare branch sprites** (not snow-painted).

**`*_trees_0_n.webp`**: tangent-space normals. Each leaf clump is a rounded blob: top green (+Y), bottom pink (−Y), edges cyan/magenta. Bark is a fine-relief normal.

**`*_trees_1_m` + `*_trees_1_a`** (conifer colour and a separate grayscale alpha; alphaTest 0.4), laid out by u:
- 0–0.125 (512 px): bark strip.
- 0.14–0.36: fir/spruce **whorl seen from above**, a 6–7-armed star, about 900 px across.
- 0.38–0.49: hemlock hanging branch.
- 0.47–0.59: pine branch with trunk segment.
- 0.59–0.77: **larch** side sprite. Autumn larch is orange-yellow; winter larch is bare twigs with snow lines.
- 0.77–1.0: **cypress** top-down round needle disc.
- Background is dilated dark green.
- The winter version has **snow painted into the needle tips**.

**`tree_conifer_n.webp`**: flat 128/128/255 and unreferenced in Hills; a dead asset.

**`trees_dev_d/_n`**: used only by the Cali dev map with the glb models (oak/pine/palm). Contents: oak bark, 4 large oak branch cards with soft halos, pine bark and needle clumps, palm bark and fronds.

**For us:**
- One 4096×1024 atlas per season per group; a 1024-px column per species.
- Crown = one whole-tree sprite + 2–3 clump sprites, plus a bark strip in the bottom quarter.
- A tangent normal map with per-clump sphere normals is REQUIRED for the look.
- Render the sprites offline from real 3D leaf models (Blender) and dilate the RGB.
- Species for central Russia: birch, aspen, oak/linden, pine, spruce, larch.

---

## 3. Tree models

Blender OBJ files, tree_01..08 (Hills 5446-5449; `Bs` 5531 = `[01-04 deciduous], [05-08 conifer]`).

**Deciduous** (01_ash, 02_sycamore, 03_birch, 04_beech):
- **135–182 verts, about 70–90 faces.**
- Trunk: a 10-sided tapered prism from y ≈ −0.8 to about 2.8 m, plus a few branch prisms.
- The crown is about **20 large flat ngons**, each a planar slice mapped to a region of the whole-tree or clump sprite, e.g. uv (0.0005, 0.993)–(0.209, 0.749)–(0.183, 0.993). The slices face many directions around the crown (about 4.6 m radius, top at 10.3 m).
- Face normals are flat per card; shading ignores them and uses the analytic capsule.

**Conifer** (pine, hemlock, larch, cypress):
- **150–260 verts.** 5-sided trunk from y = −0.55 (−2.5 for pine) to 10 m.
- About 20–25 **whorl fans**: a centre vertex on the axis plus 4–8 tips, with tips 0.4–1.1 m above the centre (shallow bowls). All fans map the top-down star/disc sprite.
- Radius tapers from 3.2 m to 0.7 m at 10.6 m. The larch uses side-view branch cards.

**Instance scale**: `p[1]·tm.s`, with p[1] ∈ 1.09–1.80 and `tm.s = type·0.5 + 1.08` (+0.08 when 3 trees share a spot). Deciduous trees are about 12–20 m tall and conifers about 18–30 m. Rotation is `p[0]` ∈ 0–2π.

**For us:** about 150-vert models with about 20 big crown cards cut from a whole-tree sprite are enough, because the shading does the volume. Conifers are stacked radial fans. 4 variants per type, deterministic random scale 1.1–1.8 and rotation.

---

## 4. Impostors

**Atlases `*_imposters_0_d/_n`** (deciduous) and **`*_imposters_1_d`** (conifer):
- 4096×1024 = **16 views × 4 variants, 256² per cell.** Variant 0 is the bottom row.
- The conifer normal atlas is shared across all seasons (`autumn_imposters_1_n`).
- `_d` is albedo with alpha and dilated RGB. `_n` holds view-space normals on a flat 0x7E83FF background.

**Bake** (nodes/4.e801d142.js 150-260):
- PerspectiveCamera fov 68, **zoom 12.3** (near-orthographic), at (0, 5.35, 100) looking horizontally.
- The tree is rotated `-(2π·n/16 + 1/32)` for n = 0..15.
- Diffuse pass: unlit `map`, alphaTest 0.4.
- Normal pass: MeshNormalMaterial with a crown bend:
  - `centerUpDot = dot(-Nc, up)`;
  - for leaves, `normal += -Nc·clamp(-centerUpDot + 0.2)`, then `normal.y -= 0.05` and normalize;
  - for the trunk, if `n.y > 0`, `n.y /= 8`.

**Runtime vertex**:
- The quad is 1×1 m scaled by **11** × instance scale, pivot at the base, **Y-axis billboarded** via `atan(wPos.x - cam.x, wPos.z - cam.z)`.
- **Crop**: width × (0.8 deciduous, 0.7 conifer); conifers are also tapered to a trapezoid, `×(1 - v·4·0.6)`.
- View index: `tile = floor((angle - orientation + π)/(2π/16))`, `vAngleBlend = fract(tile)`. The blend is off beyond 500 m.
- **Distance growth**: `k = saturate((z - 200)/800)`; the quad is scaled ×(1 + 0.3k) and sunk 4k m.

**Runtime fragment**:
- `blendNoise = noise_fine(uv·(21.32, 4))`.
- Next-view colour: `mix(cur, next, step(blendNoise, vAngleBlend))`, a **dithered view crossfade**, not an alpha blend. The normal map uses the same selection.
- Approach dissolve: `a *= step(vDissolve, blendNoise)`. Early discard when `vDissolve > 0.999`, and the quad is collapsed in the vertex shader.
- alphaTest 0.6.

**For us:**
- 16 views × 256² per variant, cylindrical impostors.
- Dithered view switching, crop/taper, and 30% growth + 4 m sink past 200–1000 m.
- Bake albedo unlit and view-space normals with the crown bend.

---

## 5. LOD scheme and distances

`ds()` in Hills 4905-4911, with lod1Horizon from `graphics.viewDistance` = 13/16/19/22/25/28 (low→ultra).

**3D tree dissolve**:
- `dissolveFar = lod1·10`, `interval = floor(0.3·far)`, `dissolveNear = far - interval`.
- Values: far 130/160/190/220/250/280 m; near 91/112/133/154/175/196 m.
- `vDissolve = (z - near)/interval`; discard when `noise_fine(vMapUv).r < vDissolve`.

**Impostor dissolve**:
- `impFar = near3D + 0.6·interval`, `impNear = impFar - interval`. At the "25" level that is 145→220 m.
- `vDissolve = (1 - saturate((z - impNear)/interval)) · dissolveAttr`.
- The per-instance `dissolve` attribute is 1 only for trees that currently have a 3D twin (`prepCellInstance`, SCC 44572).

**The swap is a noise-dithered crossfade** over about 145–250 m, with no alpha blending and no sorting.

**Where 3D trees exist**: only in LOD1 cells. On `customUpgrade` each tree goes to NearTreeManager; on downgrade it is removed (SCC 46015-46032). Capacity is 400–600 per type/variant mesh; when full, the oldest chunks are evicted.

**Impostor range**: all loaded heightmap tiles. View distance `U = tileSize·2` = 480 m (low) to 5000 m (ultra). `imposterInstanceSize` is 400/1600/4000/7500/16000/16000 per chunk. `imposterDissolveStart` exists in the config but no shader uses it.

**Draw order**: near trees renderOrder 10, impostors 20, both opaque alpha-tested, DoubleSide.

**For us:**
- 3D out to about 175–250 m, noise crossfade band of about 75 m, impostors out to the view distance (2–5 km).
- A per-instance "has 3D twin" flag.
- The same noise texture in both shaders, with complementary thresholds.

---

## 6. Forest placement

**Density field** (SCC 43590-43680):
- `map` is the multi-layer heightmap noise with the `treemap` settings (`offset 2.75, layerResolutions [2, 7, 17, 29], depthHeightFactor 1.8`).
- `getDensityAt = (1 - clamp(map + (1 - dF), 0, 1))·dF`, where `dF = (0.5 + min(0.5, detail/5))·0.8` (auto).
- `getShadowDensityAt`: 0 below 0.05, else `min(1, d·1.5 + 0.3)`. This feeds `treeMask` on the ground.

**Sampling**: every other heightmap vertex, at a 2×2 pattern with a 10 m step (SCC 44818-44880):
- `count = floor((d - 0.001)·3)`, plus one more with probability equal to the fractional part. That gives **0–3 trees per 10×10 m** (up to about 300/ha).
- Positions come from 12 fixed 4-point jitter tables (`k9`, 1–9 m offsets), with scale/rotation from `m9`.
- Conifer spots always get ≥ 2 trees.

**Type map**: `typeMap` noise (resolution 11, depth 4, offset 0.45) rounded to 0 = deciduous or 1 = conifer. This gives **large patches of pure broadleaf or pure conifer**.

**Species palettes**: a 4×4 noise at 1 km (deciduous) or 2 km (conifer) scale, thresholds 0.46/0.58/0.70, picks one of 4 variant tables (`Fa`/`Ua`), each dominated by one species. The result is regional dominance.

**Rejections**:
- Ground height < 2 m.
- Ground normal.y < 0.7 (steep slopes).
- Road proximity < 1.8 m. Conifers other than larch need ≥ 1.8 + 2·scale m.

**Height offsets**:
- Impostors sit at ground − 2 m. At detail ≥ 3 they sink a further `(1 - neighbourDensity)·3` m, so edge trees look smaller.
- 3D trees: when road distance > 4 m, `h -= (r - 4)/6`.

**For us:**
- A continuous density noise, quantised to 0–3 trees per 10 m square with fixed jitter tables.
- A low-frequency type noise for pure stands.
- A km-scale palette noise for species dominance (birch groves, pine forests, spruce stands).
- Sink sparse edge trees.
- Reject on slope and water, keep a 1.8 m road clearance.

---

## 7. Shadows and the ground under trees

**Real shadows**: the sun shadow camera is ±4 m, near 0.5, far 50 (SCC 49801-49810), so it covers **the car only**. Tree meshes use `receiveShadow = false`, and no tree casts a shadow.

**Fake canopy shadow on terrain**:
- Per-vertex `treeMask` = shadow density, blended toward road-edge densities in `customCellLoad`.
- Ground vertex (Hills 2151): `vShadow = min(1, treeMask·clamp(height/4, 0, 1))·shadowFactor`.
- `lights_fragment_begin_shadow`: `sun *= 1 - vShadow`. Ground Fresnel is also ×(1 − vShadow).
- Texture (Hills 2439): the `forest_*.webp` floor texture (1024², dark brown needles and twigs; per season: forest_01, forest_spring, forest_autumn, forest_winter) is blended in by `max(0.2, vShadow)` above 0.1, gated near the road by `clamp(roadProx/2)`.

**For us:** skip real tree shadows. A tree-density attribute on the terrain that darkens sun by up to 100%, plus a forest-floor texture blend, gives the grounded look at every distance.

---

## 8. Far forest

Impostors run out to the view distance (up to 5 km on ultra), with 30% growth and a 4 m sink past 200–1000 m. The ground beneath them is darkened and textured by `treeMask`. Distance darkening (−33%) plus fog/haze does the rest.

There is no separate forest-mass mesh or far-forest texture.

**For us:** far forest = impostor instances (about 16k per chunk) + the terrain canopy mask + growth/sink to close gaps.

---

## 9. Seasons

The season preset sets:
- `maps.trees[0] = {d: *_trees_0, n: *_trees_0_n}` and `maps.trees[1] = {d: *_trees_1_m, n: *_trees_1_a}` (conifer n = alphaMap);
- `imposterMap` / `imposterMapB` / normals;
- `effects.{shadowFactor, treeDiscolouration, hasSnow}`.

`ls()` (Hills 4864-4877) swaps the textures outright; there is no blending between seasons.

**Winter** (`hasSnow`):
- Deciduous 3D: `dotUp = dot(N_mapped, viewUp)`; if > 0.1, mix toward `vec3(min(1, 0.5 + dotUp))` by `min(1, (dotUp - 0.1)·8)`. Up-facing branch relief turns white.
- Deciduous impostors: if `dotUp > 0`, mix to white by `dotUp·8`.
- Conifers: snow is painted into the winter atlases.
- treeDiscolouration drops to 0.2.

**Autumn**: orange/brown/yellow deciduous atlases and an orange larch. Spring uses lighter, sparser atlases.

**For us:**
- Per-season atlases; swap on season change.
- Snow = normal-up blend on deciduous branches, pre-painted on conifers.
- Tint strength per season: autumn 1.2, spring 1.5, winter 0.2.

---

## 10. Wind

There is **no wind animation**. Only a commented-out "ANIMATION TESTING" block exists (T04 ~673-683), and `time` is commented out in all tree shaders.

**For us:** static trees are acceptable at slowroads quality. Wind is optional polish.

---

## 11. Numbers cheat-sheet
- Atlases: 4096×1024. Impostor cell 256², 16 views × 4 variants. Quad base size 11 m.
- alphaTest: deciduous 0.5→0.3 dynamic, conifer 0.4, impostor 0.6.
- Radiance: `vec3(rg·8, 0.5)·radiance` as a multiplier of directDiffuse; tree radiance = preset / 2.
- Crown sun mask: `clamp(2·dot(L, Nc), 0.25, 1)`. Leaf interior sun ×(1 − 0.5·vShadow). Ambient ×(1.5 − vShadow) when vShadow > 0.5.
- Conifer: `fShadow = sqrt(vShadow)·0.65`; sun × max(0, dot(L, Nc)) on top of Lambert.
- Distance darkening 50→250 m: −33%.
- Tint noise period 256 m.
- 3D ↔ impostor band about 145–250 m. View blending off beyond 500 m. Impostor growth +30% and sink −4 m over 200–1000 m.
- Trees per 10×10 m: 0–3. Clearances: road 1.8 m, slope normal.y ≥ 0.7, height > 2 m.
- Instance caps: near trees 400–600 per mesh (8 meshes); impostors 400–16000 per chunk.
