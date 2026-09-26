# SrGrass.md

## Summary

slowroads' Hills (the seasonal countryside scene) grass is a road-verge band, not a field-wide carpet. It uses crossed-quad billboards from a 1024×256 four-cell greyscale atlas. Each tuft is tinted in the shader with the same noise fields and colours as the ground under it, and lit with the ground normal instead of the card normal, so it blends into the terrain. Tufts sink and vanish between lod1Horizon×6.25 m and ×12.5 m (about 120–310 m). Bushes are a small embedded OBJ clump with a 2048×512 four-column atlas per season (variants: generic/flowering shrub, fern, gorse). Both are placed on a jittered grid using road distance, a tree-density map, altitude, slope and Perlin noise, and neither has wind animation (the sway code is commented out). Heather is a ground texture plus a heather sprite in the grass atlas. Rocks in Hills are only a steep-slope terrain texture with a height map. rock.obj is used only in the off-world scenes. Low detail turns grass and bushes off completely. Medium and Ultra differ in grid spacing (0.625 m vs 0.5 m), accept rate (0.5 vs 0.85) and verge width (16 m vs 28 m); sprout distance follows the view-distance setting.


## Architecture

Placement runs on the CPU per terrain chunk. loadCustom1 walks each 20 m cell on a (10/cellRes) m grid; inner cells are full-rate, outer cells quarter-rate. Each sample reads road proximity (rp, metres from the road edge), height, normal and tree-density (tm). It then either adds one bush instance or one grass instance (never both) into a ring of at least 3 InstancedMeshes per type, each with maxCount = cellRes²·density·lod1Horizon·(1+margin/12) (bushes 0.2×). Per-instance attributes: groundNormal, shadow (= tm), roadProx (grass) or variant (bush). Instance matrices use random yaw plus a tilt to the ground normal; renderOrder 30; custom bounding spheres for culling. Grass is MeshLambert (DoubleSide, alphaTest 0.5) patched with onBeforeCompile. The vertex shader picks the atlas cell from noise, road distance, tree shade and heather zone; applies season crop, distance sink/collapse and cockpit flatten; sets vNormal = groundNormal. The fragment shader recomputes the ground's grass colour (shared noise and colour uniforms), applies the ground's fresnel, and scales direct light by (1 - tm·shadowFactor) plus a sun-radiance gain. Bushes use the same scheme with an OBJ clump, a distance-varying alpha test and fake AO. Seasons only swap textures and colour uniforms; winter changes the variant logic through seasonIndex==3.


## Files

- /tmp/slowroads/pretty/chunks/HillsHeightmap.b6172a83.js: Hills materials and shaders. Grass vertex prelude Bo (3419), grass vertex body Wo (3462), fragment Vo/Xo/Zo (3657-3788), bush Qo/Yo/Ko/Jo (3789-4007), Lambert override $t (~4330) and light loop ea (4373, with the 'directLight.color *= 1.0 - vShadow' line ~4512). Material setup: grass S at 5317, bush y at 5361, sprout uniforms at 4912-4915, per-season texture binding ls() at 4813-4880. Season configs: summer 122-178, spring 400-455, autumn 675-736, winter 966-1018. Quality tables 1485-1641, applied at 5608-5650. Ground heather 2410-2430, ground rock 2626-2648, terrainBlend 2295.
- /tmp/slowroads/pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js: Hills runtime. Instance ring Tt (45604) and Rt (45636). Grass InstancedMesh class K1 with its crossed-quad protoGeo (45716-45789). Bush class K0 with the embedded bush OBJ A7 (45796-45890). Chunk class s0: random tables (45909), bush and grass placement loop loadCustom1 (46090-46210). vehiclePos/flatten update at 50067.
- /tmp/slowroads/pretty/chunks/CaliMidlineGenerator.7dfc1747.js: Coast/desert scene variant: brush_sprites/bush_sprites maps (70-125), quality table (800-870), instance-count formula (6577-6584), sprout = lod1Horizon*13.5 (5862).
- /tmp/slowroads/pretty/chunks/2.7f7e25dd.js: Built-in scene grass/bush instancers (5299-5470) and placement (5700-5790). rock.obj used as off-world 'rubble' instancer (3759-3800).
- /tmp/slowroads/pretty/chunks/normals.f63d4883.js: Texture loader Et (24048: anisotropy default 4, wrap, sRGB, flipY, mips). Settings enums (34449-34458). Detail and foliage enum labels (26526-26559).
- /tmp/slowroads/pretty/chunks/DevMidlineGenerator.d99584e3.js: Global fog shader chunks (radial fogDepth, haze, desaturation) that replace three's fog_* for all materials, grass and bushes included (320-530).
- /tmp/slowroads/pretty/chunks/QuickRandInt.fc0599e9.js: Seeded random tables: value = rand*d - a (explains the scale/jitter ranges).
- /tmp/slowroads/app/build/_app/immutable/assets/summer_grasses.7ddf683f.webp: 1024x256 grass atlas, four 256 px cells: short tuft, medium tuft, tall grass (all greyscale), and a full-colour brown heather shrub.
- /tmp/slowroads/app/build/_app/immutable/assets/summer_bushes.943c4258.webp: 2048x512 bush atlas, four 512 px columns: berry shrub, leafy/white-flower shrub, bracken fern, yellow-flowered gorse. Spring, autumn and winter versions are seasonal repaints.


# slowroads ground cover: grass, bushes, heather, rocks

Scope: the Hills scene (the seasonal countryside scene; closest to central Russia). Unless noted, line refs are in `chunks/HillsHeightmap.b6172a83.js` (shaders and materials, "HH") and `chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js` (placement and instancing, "SC").

---

## 1. Grass colour comes from the ground under it (biggest visual effect)

**What they do** (fragment block `Xo`, HH 3699-3788):
- The sprite texture is **greyscale**. `texelColor.rgb *= grassCol * detailNoise`.
- `grassCol` is built with the same formula and the same uniforms as the ground shader (HH 2380-2390; the comment says "Shared with ground.glsl"):
  - fade0 = noise at world/10 m ×1.4; fade1 = noise at world/160 m.
  - `variationVal` = grassVariationMap at 1/2000 m, minus 0.5.
  - `closeVariation` = 0.5 − grassVariationMap at 1/500 m.
  - `grassBlend = saturate(((screen(fade0,fade1)+vDarkGrass)/2)² + variationVal + closeVariation)`.
  - `lightGrassFactor = saturate(saturate(vLightGrass + variationVal − closeVariation) · 2 · texel.r)`. Because it scales with texel brightness, the bright blade **tips get more of the "peak" colour** and the bases keep the base colour.
  - `grassCol = mix(mix(grassColA, grassColB, grassBlend), mix(peakColA, peakColB, grassBlend), lightGrassFactor)`.
  - `detailNoise = 1 − (1 − detailFar(world/500))·0.7`.
- Vertex side (`Wo`, HH 3462-3656):
  - `heightVal = clamp((y − (30 + fade1·40))/150)`.
  - `vLightGrass = min(1, heightVal·(fade0 + heightVal·0.5))`, so higher ground reads paler and yellower.
  - `vDarkGrass = clamp((fade1 − 0.25)·2)`.
  - Near the road: `vLightGrass *= max(0.5, rp/(0.5+fade1))`.
  - Everything is sampled at the **instance origin** (`iPos`), so a whole tuft gets one colour. It is not per-pixel world colour.
- Per-season colours (the `ground` block of each season's common config):

| season | grassColA | grassColB | peakColA | peakColB |
|---|---|---|---|---|
| summer (HH 170) | #476B38 | #989F61 | #BBAF8B | #E17D47 |
| spring (HH 447) | #4E8542 | #94A95B | #C7D095 | #B17F5D |
| autumn (HH 728) | #4A7D4D | #BEAF79 | #E3BEA0 | #A28125 |
| winter (HH 1011) | #FFFFFF | #DBDDE1 | #DBDDE1 | #B9BDC6 |

For us: keep the grass sprites greyscale and tint each tuft in the shader with **exactly the ground's colour function**: same noise textures, same world scales, same uniforms, evaluated at the instance origin. Tint the tips toward a "peak/dry" colour weighted by texel luminance. This is the single thing that stops grass looking pasted on. Put the colour logic in one shared GLSL chunk used by both the ground and the grass.

---

## 2. Lighting: ground normal, baked forest shade, fresnel rim

- **Normal.** The card normals are (0,1,0) and are ignored: `vNormal = normalMatrix * groundNormal` (HH 3512). Grass is lit exactly like the terrain it stands on, so crossed cards never flip bright or dark with orientation.
- **Lighting model.** Lambert through a custom `RE_Direct_Lambert` (`$t`, HH ~4330).
  - Headlights and spot lights use a soft constant response: `dotNL = 0.1 + (1 − |N·L|)·0.1`.
  - Spot light colour is multiplied by `0.75 + min(0.25, uv.y·4)`, which darkens the base.
- **Baked shade.** In the light loop (`ea`, HH ~4512): `directLight.color *= 1.0 − vShadow`.
  - `vShadow = min(1, shadowAttr·clamp(y/4))·shadowFactor`.
  - `shadowAttr` = the **tree-density map value tm** at that spot (the 9th argument of `addGrass`; SC 46195).
  - shadowFactor per season: summer 0.9, spring and autumn 0.8, winter 0.75.
  - Result: grass under or near forest is shaded with no shadow-map cost. Grass also has `receiveShadow = true` (SC 45737), so it still gets real sun shadows.
- **Radiance gain.** `outgoingLight = directDiffuse + indirectDiffuse + directDiffuse * totalEmissive`, with `totalEmissive = texel·radiance`. `radiance` is per time of day (e.g. summer morning 4, common 0). It amplifies the sunlit part only, giving a warm glow at low sun.
- **Fresnel** (`Zo`, HH 3740-3787, mirrors the ground's `es`). Terms:
  - `fresnel = 1 − max(0, dot(normalize(cam − groundPos), groundNormal))`
  - `light = (max(0, fresnel − 0.75)·4 · clamp(uv.y·3, 0.7, 0.9))² · (1 − vShadow) · min(1, dist²/100) · fresnelIntensity`
  - `dark = 0.25 + min(0.25, max(0, (1 − min(1, fresnel·1.333))·fresnelIntensity·0.5 − 0.25)·0.5)`
  - `diffuse *= 1 + light − dark`
  - Grazing views brighten the tips. The `dist²/100` term suppresses the brightening within 10 m. fresnelIntensity: 0.6 common, 1.15 summer morning.

For us:
- Pass a per-instance `groundNormal` and light grass with it.
- Add a per-instance "canopy shade" scalar from our forest-density field and multiply direct sun by `1 − shade·0.8`.
- Reuse the ground's fresnel and sun-gain terms so grass and ground react identically to time of day.

---

## 3. Card geometry, atlas and variant logic

**Card.** SC 45770-45781, `K1.makeProtoGeo`:
- Two crossed quads in an X: 8 vertices, 4 triangles, 1×1 each, base at y=0, scaled by `Vs = 0.8`.
- UV u runs 0.01-0.24 (a quarter of the atlas); v runs 0-0.99. The shader adds `variant·0.25` to u.
- Instance scale is `1.5·U[0.8,1.2]`, so cards are about 0.96-1.44 m. Cells 0, 1 and 3 are shown at half height (see Crop), about 0.5-0.7 m.
- Rotation (Euler XZY): y = random 0-2π; z = −asin(nx); x = asin(nz). The card tilts with the slope.
- Material: MeshLambert, `side: DoubleSide`, alphaTest 0.5 (winter 0.2). No alpha-to-coverage. Texture anisotropy 4, ClampToEdge, sRGB, mipmaps.

**Atlas `summer_grasses.webp`, 1024×256** (four 256 px cells, painted or rendered, soft blades, white background):
- cell 0: short sparse tuft
- cell 1: medium, wider tuft
- cell 2: tall grass (the only full-height cell)
- cell 3: **full-colour** brown heather or ling dome with dark twigs

Spring, summer and autumn all use this atlas. `winter_grasses.webp` (1024×256): cells 0-1 empty, cell 2 a few bare dry stalks, cell 3 a frosted heather dome.

**Variant selection** (vertex shader, HH 3530-3590). `v` = noise(world/160 m ×2); `fade0` and `fade1` = noise at world/500 m and world/4000 m. Rules are applied in order:
1. **Heather zone:** `heather = smoothstep(0.4, 1, ((y + fade1·350) − 60)/500) · screen(fade1, fade0)`. If `vShadow < 0.1` and `heather > 0.38 + v/6`, use cell 3 and sink by `v·0.2` (times rp near the road). This must match the ground heather mask.
2. If `roadProx < v·2 + 0.2`, use cell 0 (short grass along the verge, within about 0.2-2.2 m of the edge).
3. Otherwise, if (y > 100 and v + fade0 > 1.75 − (y − 50)/250) or `vShadow > v·2`, use cell 2 (**tall grass higher up and under trees**).
4. Otherwise cell 3 stays heather, scaled by `0.5 + fade0·1.5`.
5. `roadProx < −0.5` (the middle of an offroad track) forces cell 1.

Heather cells skip tinting. They discard at `alpha < 0.98` (hard edge, the "lazy fix for heather white pixels") and get dappled brightness `×(1 + noise − 0.6)`.

**Crop** (HH 3625-3648):
- Seasons 0-2: every cell except 2 has its y **and** uv.y halved, so the sprite is drawn in the bottom half of its cell with no stretching.
- Winter: cells 0 and 1 collapse to zero size. Cells 2 and 3 are shown at half height.

For us:
- Use one 4-cell (or 8-cell) greyscale atlas at 1024×256 with 256 px cells.
- Draw short sprites in the lower half of their cell and crop in the vertex shader, so half-height variants cost no extra overdraw.
- Pick the variant in the shader from world noise plus road distance plus shade: short tufts at the verge, tall grass in shade and on uplands, heather sprites where the ground shows heather.
- Winter: collapse most variants and leave sparse dry stalks.

---

## 4. Distance: sprout and sink instead of alpha fade

- Grass uniforms, compared with **squared** horizontal distance to the camera (HH 4912):
  - `sproutFar = (lod1Horizon·12.5)²`, `sproutNear = (lod1Horizon·6.25)²`.
  - Vertex: `y −= saturate((d² − near²)/(far² − near²))·0.5`. The grass sinks up to 0.5 m into the ground.
  - `transformed *= 1 − step(far², d²)`: the tuft collapses to zero size beyond far, so it costs no fragments.
- Bushes use squared values ×1.5 (distance ×1.22).
  - Between near and far: `transformed *= 1 − k·0.5` and `y −= k·0.5`, where k is the same normalised term.
  - Beyond far: `discard`.
  - Bush alpha test varies with view depth: 0.5 within 10 m, then `max(0.2, 0.5 − (z − 10)/110)`, reaching 0.2 at 120 m. This stops mip-blurred bushes from dissolving into nothing (HH 3947-3951).
- Sprout far distance by view-distance tier (lod1Horizon ×12.5; HH 1490-1580):

| view distance | lod1Horizon | grass far / near | bush far |
|---|---|---|---|
| Low | 13 | 162 / 81 m | 199 m |
| Medium | 16 | 200 / 100 m | 245 m |
| High | 19 | 237 / 119 m | 291 m |
| Very High | 22 | 275 / 137 m | 337 m |
| Ultra | 25 | 312 / 156 m | 383 m |
| Ultra+ | 28 | 350 / 175 m | 429 m |

For us: fade grass out by **sinking into the terrain** (0.5 m over the second half of its range) and then collapsing to zero size. Do not use alpha fade or dither. The ground's own grass texture takes over, so there is no visible edge. Bushes also shrink 50%. Use a distance-varying alpha test (0.5 down to 0.2 over 10-120 m) to keep canopy coverage at distance.

---

## 5. Placement: grass lives in the road verge (SC 46090-46210)

**Sampling grid:**
- Cells are 20 m (`ws = 20`, HH 5473). Spacing is `m0 = 10/cellRes`: **0.625 m at Medium (cellRes 16), 0.5 m at High and above (cellRes 20)**.
- Outer (non-inner) chunk cells sample only every other row and column, so 1/4 of the samples.
- Jitter: ±spacing/2 · min(rp + 0.3, 1). The grid is tighter right at the road edge.

**Rejection before either type:**
- on the road: rp < 0.1 (offroad modes use other thresholds)
- height < 1.5 m (sea)
- steep ground: `normal.y + U[−0.05, 0.05] < 0.7`

**Bush probability** (evaluated first; a placed bush suppresses grass at that sample):
- **Gorse:** tm < 0.1, rp > 1.5 and altitude > 100 m.
  - Compare Perlin(200 m) and 2·Perlin(1000 m) against `gorseFactor = min(0.5, (y − 100)/100)`. If both are below it, the sample is gorse (variant 3).
  - scale `1.25 + gorseFactor − perlin`; probability `(y > 200 ? 1 : 0.5 + (y − 100)/200)·0.8`; sink 0.1-0.5.
- **Hedgerow along walls:** rp 0.5-1.5 on the wall side gives `max(tm, 0.75)·Perlin(1000 m)`.
- **Woodland edge:** tm > 0.1 gives `tm·0.65`.
- **Open ground:** 0.4, ramped from 0 at sea level to 0.4 at 5 m, then down to 0.1 at 205 m. Only within 5 m of the road: ×(7 − rp)/5 for rp > 2, zero past 5 m. Then ×Perlin(1000 m).
- Bush scale `(U[0.3, 1.2] + tm/2 + variant/6)·1.25`.
- The probability is then **squared**. Road fade: 0 below rp 0.5, linear up to rp 1, and ×(1 − (rp − 2)/13) beyond 2 m (zero at 15 m).
- Accept if `rand < p · density²`.

**Grass:**
- Skip if rp > margin (**16-28 m by tier**). Otherwise accept with probability `density`.
- rp < 2: sink (2 − rp)·0.1 (lower at the verge).
- rp > 4: `rpl = (rp − 4)/(margin − 4)`.
  - scale += rpl·(1 − tm): taller further from the road.
  - sink rpl·scale·0.4.
  - skip with probability 0.2 + 0.8·rpl: density fades linearly to near zero at the margin.
- Also skip with probability `tm·min(1, (rp − 2)/5)`: sparser in woods.
- Final y −= sink·0.8 + U[−0.05, 0.1].

For us: this is the key structural lesson. **Real 3D grass only covers a 16-28 m band either side of the road**, densest and tallest at the verge, thinning outward, with short tufts right at the tarmac. Everything beyond is the ground texture (with grass and heather detail). Bushes cluster along walls and fences, at woodland edges and within 5 m of the road, with gorse on uplands. For us that maps to hedgerows along field boundaries, shrubs at forest edges and willow/alder scrub along verges. Use seeded pre-generated random tables so placement is deterministic.

---

## 6. Instancing and counts per quality tier

**Structure:**
- A ring of InstancedMeshes (`Tt`, SC 45604), at least 3 per type, filled sequentially as chunks generate.
- When one is full it is finalised and the oldest is recycled. A fresh one is allocated only if the oldest is still ahead of the car (`retireIndex > vehicleIndex`).
- Each mesh has a manually maintained bounding sphere for frustum culling. Container renderOrder = 30.
- Attributes are dynamic, uploaded at chunk-finalise time.

**Capacity per mesh:** `maxCount = cellRes² · density · lod1Horizon · (1 + margin/12)`; bushes get 0.2× that (HH 5645-5646).

**Environment-detail tiers** (HH 1597-1640; labels Low / Medium / High / Very High / Ultra; the default is High on desktop, Medium on mobile or low-power):

| detail | cellRes (spacing) | grass density | margin | shadowRes | notes |
|---|---|---|---|---|---|
| Low | 10 | 0 | 0 | 256 | **no grass and no bushes** (the `Oa` flag makes the placement pass return immediately) |
| Medium | 16 (0.625 m) | 0.5 | 16 m | 512 | ≈1.3 tufts/m² near the road |
| High | 20 (0.5 m) | 0.65 | 20 m | 1024 | |
| Very High | 20 | 0.75 | 24 m | 2048 | |
| Ultra | 20 | 0.85 | 28 m | 2048 | ≈3.4 tufts/m² near the road |

- The separate "Grass density" setting (Auto / Off / Low / Medium / High) overrides this: density = (setting − 1)/3, margin = 12 + density·16. High gives density 1.0 and margin 28 m.
- Example capacities:
  - Medium detail + Medium view: 256·0.5·16·2.33 ≈ **4.8k grass / 1k bushes per mesh**.
  - Ultra detail + Ultra view: 400·0.85·25·3.33 ≈ **28k grass / 5.7k bushes per mesh**.
  - Ultra+ view: ≈ 32k grass.
  - With at least 3 meshes, that is roughly 15k-95k tufts resident.
- Medium vs Ultra, visually: Ultra has about 2.7× the tufts per m² near the road, a 75% wider verge band (28 vs 16 m), sprout range 312 vs 200 m, and 4× the shadow-map resolution on the grass it receives. The shaders are identical.

For us: size the grass buffers from (spacing, accept rate, verge width, horizon) rather than a flat count. Tiers:

| our tier | spacing | accept rate | verge | sprout far |
|---|---|---|---|---|
| Low | none (ground texture only) | 0 | – | – |
| Medium | 0.625 m | 0.5 | 16 m | ~200 m |
| High | 0.5 m | 0.65 | 20 m | ~240 m |
| Ultra | 0.5 m | 0.85 | 28 m | ~310 m |

Grass is cheap per instance (8 vertices), so fill rate from the overlap of alpha-tested DoubleSide cards is the real cost. Collapsing tufts to zero size beyond far is what keeps it affordable.

---

## 7. Bushes: mesh, atlas, seasons

**Mesh:**
- A tiny low-poly OBJ embedded as base64 in the bundle (`A7`, SC 45797; "Blender 4.5, o Cube").
- Several intersecting planes, roughly y −0.29 to 1.13 (the base is sunk) and about ±0.55 m wide. Actual size is scale ×(0.3-1.2 + …)·1.25.
- The UVs map the cards into one 512 px column of the atlas; each column holds 2 diagonal sprite pieces.

**Material** (HH 5361): Lambert, DoubleSide, alphaTest 0.5 plus a varying alpha test in the shader, `forceSinglePass`. **No** `receiveShadow`; bushes use only the baked `1 − tm·shadowFactor`. Texture anisotropy 2, ClampToEdge.

**Variant attribute:** 3 (gorse) comes from the CPU. 0 means the shader picks from noise(world/512 m):
- in tree shade (vShadow > 0.1): fade0 > 0.52 gives col 2, 0.41-0.52 gives col 1
- in the open: 0.46-0.54 gives col 2, > 0.54 gives col 1
- otherwise col 0
- col 2 sinks by 0.1 m

The author's comments list rules: gorse higher up, soft plants along the road, ferns only near trees, and future nettles/brambles/cow parsley/dock.

**Fake AO:** `emissive = texel·radiance·vAO`, with `vAO = clamp(position.y, 0, 0.5)·2`. The bush base gets no sun gain, so it reads darker.

**Atlases** (all 2048×512, four 512 px columns; painted or photobashed sprites; spring uses a green dilated background):

| season | col 0 | col 1 | col 2 | col 3 |
|---|---|---|---|---|
| summer_bushes | dark shrub with red berries (rose/hawthorn) | leafy shrub + white flower heads (elder / cow parsley) | bracken fern | gorse with yellow flowers |
| spring_bushes | daffodils | white snowdrop-like clump | young fern fiddleheads | flowering gorse |
| autumn_bushes | bramble with purple berries | yellowing umbellifer | golden-brown bracken | dark gorse, no flowers |
| winter_bushes | tiny bare twig clump | bare stalks (mostly empty) | empty (ferns gone) | snow-dusted gorse |

For us:
- Adopt a **4-variant bush atlas per season** with the same semantic slots in every season, so placement never changes: generic shrub, flowering/umbellifer, fern, upland shrub.
- For central Russia: col 0 wild rose / hazel scrub, col 1 cow parsley / meadowsweet / willowherb, col 2 bracken, col 3 juniper or young birch/willow scrub.
- Repaint per season: spring snowdrops/coltsfoot; autumn yellowing, rust bracken; winter bare twigs and empty fern slot.
- A small crossed-plane clump mesh, a base AO term, and shrink-and-sink at distance.

---

## 8. Heather

- **Ground texture:** `summer_heather_05.webp`, `autumn_heather.webp`, `winter_heather.webp`, all 1024×1024 photo-derived tileables.
  - summer: brown with a pink-purple cast
  - autumn: mauve/purple (flowering)
  - winter: grey-white mottled with snow
  - Spring reuses the summer one.
- Ground shader (HH 2410-2430): the heather colour is a near/far UV mix (`depthLerp = 0.25 + 0.75·min(1, camDepth/400)`). It is height-blended into the grass with `terrainBlend(..., 0.1)`, using heather.r and grass.g as heights.
- The mask is the upland function in §3 (altitude above about 60 m plus 350·noise, over a 500 m span, times screened noise).
- The grass pass uses the same mask to swap tufts for **heather-dome sprites (atlas cell 3)**, scaled 0.5-2.0 and slightly sunk. The ground heather therefore gets 3D relief exactly where it appears.

For us: any ground cover zone (heath, fireweed clearing, stubble field) should have (a) a ground texture blended in by a mask and (b) the same mask evaluated in the grass vertex shader to switch the tuft variant. Coherence between the ground and the 3D layer is what sells it.

---

## 9. Rocks

- In Hills there are **no 3D rock props**. Rocks are a steep-slope terrain layer (HH 2626-2648). When `steepness > 0.1`:
  - `rockTex = mix(rock(uv), rock(uUv), saturate((camDepth − 20)/130))`, a near/far scale blend.
  - `rockTex.a = rockBump(uv).r · rockBump(uUv).r`.
  - `terrainBlend(ground, 1 − steepness, rock, steepness, 0.08)`. This height-based blend makes rock show first in its crevices and ridges.
  - `rock_bump` is also assigned as the ground material's `displacementMap` (HH 4841). The displacement vertex chunk is replaced with custom code; its use is [INFERENCE].
- Textures (all 1024², photo-derived tileable, same layered-cliff source regraded per season):
  - `summer_rock`: grey-brown layered rock with moss tufts
  - `spring_rock`: green mossy grade
  - autumn: reuses summer_rock
  - `winter_rock`: dark with white snow in the cracks
  - `rock_bump.8f8c68ad`: white = high, black cracks
  - `summer_rock_alpha`: pinkish desert grade, used in the coast/desert scene
- `rock.obj` (Blender 2.92 deformed icosphere, about 0.6 m, ~229 lines) and `rock.406b86d4` / `rock_bump.6b80e0a0` are used only by the **off-world "rubble" instancer** in `chunks/2.7f7e25dd.js` 3759-3800 (mars/venus barriers), not in the countryside.

For us: rock on steep slopes and cuttings as a height-blended triplanar-ish terrain layer (with a near/far dual scale), regraded per season. Winter should read as snow in the cracks. 3D boulders are optional and not part of slowroads' look.

---

## 10. Vehicle flatten, wind, fog, draw order

- **Flatten** (grass HH 3610-3616; bush HH 3935-3942):
  - Enabled only when the camera is **in the cockpit** (`flatten = isInterior`, SC 50068). vehiclePos = cockpit position.
  - Grass: `y *= 1 − (1 − saturate(d²/2))·(1 − saturate((vehY − 0.5) − iPos.y))`. This squashes tufts within about 1.4 m of the camera so they do not cover the view.
  - Bushes: the same idea within 2 m, at 2× strength.
  - It is a camera-clipping fix, not tyre trails.
- **Wind: none.** A noise-based sway of vertices with uv.y > 0.5 (offset `noise(world/160 + time·0.05)·0.2`) is commented out in both shaders ("ANIMATION TESTING"). Grass and bushes are static.
- **Fog:** grass and bushes use the global replaced fog chunks (DevMidlineGenerator 320-530): radial distance `smoothstep(near, far, dist)`, a height haze with noise, and desaturation with haze. No grass-specific fog. Because grass stays within about 300 m it mostly sees the near end of the fog.
- **Draw order and blending:** opaque, alpha-tested, depth-writing, DoubleSide. renderOrder 30 (after terrain). Grass is on a separate layer (`st`) shared with weather particles, probably so it can be excluded from mirror or reflection cameras [INFERENCE].
- **Cast shadows:** none for grass or bushes. Grass receives shadows; bushes do not.

For us:
- Flatten grass near the camera in first-person to avoid screen-filling cards.
- Wind is optional polish; slowroads ships without it. If we add it, keep it tiny (≤0.1-0.2 m at the tips, low-frequency world noise) so it does not break the ground-matched look.
- Do not cast grass shadows; have grass receive them.

---

## 11. The coast/desert scene variant (for reference)

`CaliMidlineGenerator` uses:
- `brush_sprites.webp` (1200×150, six 200 px cells, greyscale: two grass tufts and four coastal-scrub shapes)
- `bush_sprites.webp` (2048×400: olive-like shrub, dead branch, pampas plumes, yucca/agave, grey scrub, yellow-flower umbellifer)

Differences from Hills:
- sprout = lod1Horizon·13.5 (grass and bushes equal)
- grass margin 24-40 m, density 0.25-1.0; cellRes 10 at every tier
- grass orientation also uses a `curvature` attribute and steepness
- the instance-count formula is the same

For us: nothing needed beyond confirming that the same system is simply re-skinned per biome.

---

## Priority list for renderer v2 (visual impact)

1. Colour grass tufts from the **shared ground colour function**, with tips toward the peak/dry colour.
2. **Ground-normal lighting**, a baked canopy-shade attribute, and the same fresnel and sun gain as the ground.
3. **Verge band placement** (16-28 m), densest and tallest near the road, thinning outward; short tufts at the tarmac edge.
4. Distance **sink then collapse** (0.5 m sink from lod1·6.25 to lod1·12.5), no alpha fade.
5. A 4-cell greyscale grass atlas plus a heather/upland cell, with variant chosen by road distance, shade and altitude mask.
6. 4-slot seasonal bush atlases (shrub / flowering / fern / upland), placed along walls, forest edges and the road.
7. Ground-cover masks shared between the ground texture and the 3D layer (heather ↔ heather sprites).
8. Steep-slope rock layer with height-blend and seasonal regrade.
9. Tier scaling by spacing, accept rate, verge width and horizon; Low = grass off.