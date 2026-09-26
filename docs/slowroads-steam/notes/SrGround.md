# SrGround.md

## Summary

I traced slowroads' terrain end to end in the Hills scene (UK/temperate, the closest match to central Russia), with the relevant parts of the Cali and OffWorld scenes. This covers the heightmap generator, mesh tiles and near-road cells with their two LODs and the overlap sink, the vertex attributes, and the ground shader. The shader is layered colour tinting, multiplicative multi-scale detail, height-based blending, baked tree shadow and a view-angle sheen. I also read the seasonal palettes, water and textures (sizes and content). The main result is that the look comes mostly from these procedural shader stages, not from texture richness: the grass texture is greyscale, colour comes from four uniforms, and light and shade are faked with a view-angle term and baked tree density. There is no triplanar mapping and no terrain shadow map. The full report, with a "For us:" line on every finding, is in `report`.


## Architecture

Heightmap: a CPU sum of radial smootherstep bumps on per-layer grids in 3000 m tiles, with a temper term that smooths low ground. It feeds two mesh systems that share one MeshLambert+onBeforeCompile ground material:
(a) Far tiles: tileSize 240–2500 m, 20 m vertex spacing at LOD0 and 10 m at LOD1 (LOD1 within max(1400 m, 1.5×tile)). renderOrder 2.
(b) Near-road 10 m cells: 1.0/0.63/0.5 m spacing at LOD1. renderOrder 1. They carry roadProximity, treeMask and roadUv.
Far vertices under the near cells sink 20 m via the per-vertex 'overlap' attribute.
Fragment: greyscale grass × 4-colour tint → field stripes → heather height-blend → multiplicative multi-scale detail → forest floor by tree mask → sand below 4 m → verge gravel/offroad mask → slope rock → emissive 'radiance'.
Lighting: a patched lights chunk applies the baked tree shade (direct ×(1−vShadow), ambient down to ×0.75), plus a view-angle (fresnel) darken/brighten term.
Water: a flat per-tile plane at y=0 with a depth attribute, a view-angle two-tone colour, scrolling sparkle noise and a highlight at grazing angles.


## Files

- /tmp/slowroads/pretty/chunks/HillsHeightmap.b6172a83.js: Hills/UK scene. Season configs with ground colours (L169-175, 446-452, 727-733, 1010-1017). Road styles with heightmap/treemap params (L1285-1470). Graphics presets (L1474-1640). Ground vertex shader bo/Mo (L2008-2240) and fragment shader Lo/yo (L2242-2648). Fresnel Co (~L2689) and water Io/Ro/Eo/To (L2713-2935). Grass-sprite colour match Vo/Xo (L3657-3740). Uniform binding ls() (L4817-4900), ground material i (L4919-4990), water fs() (L5114-5150), settings _l (L5605-5660), heightmap class Pl (L6202-6420).
- /tmp/slowroads/pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js: Shared terrain engine. Tile geometry f0 (L40932). Near-road chunk v2 with roadProximity/curvature (L41140-41600). LOD radii constants (L41975-42010). Far tile Mt: LOD switch, heights, normals (L42498-42800). Tree density Ya (L43610-43640). Far tile s7: sea, treeMask, fieldCol (L44759-44990). Near chunk s0: treeMask, roadUv, road-edge shadow (L45894-45990). initTerrain (L49826).
- /tmp/slowroads/pretty/chunks/normals.f63d4883.js: Custom lights_fragment_begin_shadow (ox, L24565-24800): direct light *= 1 - vShadow (L24730), ambient scaled down under shadow (L24783). smootherLerp (L44609).
- /tmp/slowroads/pretty/chunks/DevMidlineGenerator.d99584e3.js: Heightmap base class oe: 3000 m tiles, tile cache, lerp kernels (L25-122).
- /tmp/slowroads/pretty/chunks/CaliMidlineGenerator.7dfc1747.js: Cali scene ground variant: dirt/grass/shrub by vDry, shale on curvature, smoothstep cliffs (L1245-2060).
- /tmp/slowroads/pretty/chunks/2.7f7e25dd.js: OffWorld terrain textures (cliff, shale, rego, rubble; L2920-2931). Not relevant to our look.
- /tmp/slowroads/app/build/_app/immutable/assets: Terrain textures viewed and described in the report.


# slowroads terrain & ground surface: reverse-engineering report (Hills/UK scene unless noted)

Most shader line refs point to `pretty/chunks/HillsHeightmap.b6172a83.js`, shortened to **HH**. Engine refs point to `pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js`, shortened to **SC**.

---

## 1. Ground colour model: greyscale texture × procedural 4-colour tint (biggest impact)

**Technique (HH yo ~L2345-2395)**
- `grass.15f2422c.webp` is a **1024² greyscale photo of grass**, mid-grey with bright blades and tileable. It carries luminance only.
- Colour comes from four uniforms: `grassColA`/`grassColB` (low ground, two tones) and `peakColA`/`peakColB` (high ground).

```
grassBlend       = saturate( (screen(fade1,fade0)+vDarkGrass)/2 )^2 + variationVal + closeVariation )
lightGrassFactor = saturate( saturate(vLightGrass + variationVal - closeVariation) * 2 * grassTex.r )
grassCol         = mix( mix(A,B,grassBlend), mix(peakA,peakB,grassBlend), lightGrassFactor );  texel.rgb *= grassCol
```

**Where the terms come from**
- `fade0/1/2` = `noise_fine` at the 7 m, 100 m and 500 m UV scales.
- `variationVal` = grass_variation@2000 m − 0.5.
- `closeVariation` = (1 − grass_variation@500 m) − 0.5.
- The `×2×tex.r` term means **bright blade tips take the peak colour while dark bases stay green**. This per-texel two-tone is the core of the look.

**Vertex-side zones (HH Mo L2090-2130)**
- `vLightGrass`:
  - `hv = clamp((h − (30 + fade1@4000m·40)) / 150)`
  - `vLightGrass = min(1, hv·(fade0@500m + hv·0.5))`
  - Effect: above ~30–70 m the ground drifts pale over ~150 m of altitude.
  - Within `0.5+fade0` m of the road edge it is scaled down (except in winter).
- `vDarkGrass = clamp((fade1 − 0.25)·2)`.

**Grass sprites use the same maths (HH Xo L3700-3738)**
- Same tint function plus `detailNoise = 1 − (1 − detailFar@500m)·0.7`.
- Result: tufts match the ground exactly, with no seam.

**Seasonal palettes (hex; `le()` converts them to linear)**

| season | grassColA | grassColB | peakColA | peakColB | fieldDiscolouration | shadowFactor | treeDiscolouration |
|---|---|---|---|---|---|---|---|
| spring (L447) | #4E8542 | #94A95B | #C7D095 | #B17F5D | #180C0C | 0.8 | 1.5 |
| summer (L170) | #476B38 | #989E61 | #BBAF8B | #E17D47 | #2E0905 | 0.9 | 0.9 |
| autumn (L728) | #4A7D4D | #BEAF79 | #E3BEA0 | #A28125 | #231D15 | 0.8 | 1.2 |
| winter (L1011) | #FFFFFF | #DBDDE1 | #DBDDE1 | #B9BDC6 | #616161 | 0.75 | 0.2 (hasSnow, frozenWater) |

Other colours:
- Summer far-road colour = #5B5754.
- Hemisphere light ground colour = `grassColA` (HH L4818).

For us: use a luminance-only tileable grass photo (1024², ~7 m repeat) tinted by 4 season colours:
- A/B split by noise at 100 m and 4000 m plus a 500/2000 m variation map.
- Peak colours by altitude.
- Tips/bases split by texture luminance.

Share the tint function between ground and grass instances. This stage is about half of the look.

---

## 2. Multi-scale multiplicative detail (anti-tiling + macro variation)

**UV scales (HH Mo L2055-2085)**

| UV | scale |
|---|---|
| `vUv` | wPos/10×1.4 → **7.14 m** |
| `vUUv` | **100 m** |
| `vWv` | **500 m** |
| `vWWv` | **2000 m** in the fragment shader (4000 m in the vertex fades) |

All are world-planar XZ. **No triplanar.**

**Blend (HH yo L2328-2365)**
```
blendVal  = (1−detailFar@2000m)·(0.6+0.4·vLightGrass)·2
blendValB = screen(1−dF@100m, 1−dF@500m)·min(1, blendVal·10)        (×0.7 in winter)
blendVal  = mix(blendValB, blendVal, saturate(camDepth/800))
blendVal *= saturate(0.4 + 0.6·camDepth/300)
blendVal += (1−detailNear@100m)·(0.7+0.3·vLightGrass)
texel    *= 1 − blendVal
```

**Textures**
- `ground_detail_far` (512²): white with grey mottled rock/lichen blotches.
- `ground_detail_far_winter`: whiter, with crack streaks.
- `ground_detail_near` (512²): near-white speckle with thin dark squiggles.
- `grass_variation` (512²): mid-grey with scattered light and dark patches.
- In winter `detailNear` = `winter_grass` (almost pure white).

For us: use 3–4 octaves of a darkening mask at 100/500/2000 m.
- Cross-fade mid→macro over 0–800 m.
- Weaker near the camera (×0.4 at 0 m, full at 300 m).
- Add a 100 m speckle.

This is what makes distant hills read as varied fields and scrub.

---

## 3. Lighting tricks (fresnel sheen, baked tree shade, radiance)

**a) Fresnel (HH Co ~L2689)**
```
f     = 1 − N·V
light = (max(0, f−0.75)·4)^2 ·(1−0.5·blendVal)·(1−vShadow)·fI
dark  = 0.25 + min(0.25, max(0, (1−min(1,1.333f))·fI − 0.25)·0.5)
diffuse *= 1 + light − dark
```
- `fI` = `fresnelFactor`: 0.6 common, 1.15 morning.
- Face-on ground ×~0.58; grazing far slopes up to ×~1.35.
- This is the silvery sheen on far hills. It is key to the look.

**b) Baked tree shade**
- Vertex (HH Mo L2140-2160, 2238): `vShadow = min(1, treeMask·clamp(h/4))·shadowFactor`.
- Patched lighting chunk (normals.js L24730, L24783): `direct *= 1−vShadow`; `ambient *= 1.75 − clamp(vShadow, 0.75, 1)`.
- `treeMask` comes from the tree density map (SC L43629):
  - `d = (1 − clamp(map + 1 − density))·density`
  - `mask = d > 0.05 ? min(1, 1.5d + 0.3) : 0`
  - Written per far-tile vertex (SC L44815-44931), bilinear on near cells.
  - Within 8 m of the road it blends to per-node roadside shadowLeft/Right (SC L45940-45977).
- The real shadow map is only ±4 m around the car (near 0.5, far 50, radius 5; SC ~L49805). Terrain `receiveShadow` is on only near.

**c) Radiance**
- `outgoing = direct + indirect + direct·texel·radiance` (HH L4987). Morning clear radiance = 4, otherwise 0.
- Sunlit ground gets a warm boost at low sun; shade does not.

For us: bake forest shade per vertex from our tree density (direct ×(1 − 0.9·mask), ambient ×0.75), add the fresnel term with these numbers, and keep shadow maps only near the car.

---

## 4. Ground under forests

HH yo L2398-2420:
- `forestCol = forestMap(vUv/1.25)` → ~8.9 m repeat.
- `forestCol.a = r·2·fade2`.
- Mask `m = vTreeMask` (0 below 0.1, at least 0.2 otherwise; near the road × clamp(roadProx/2)).
- `terrainBlend(texel, 1−m, forest, m, 0.1 + (1−m)·fade0·0.9)` → ragged, noisy edges.
- The baked shade (§3b) then darkens it.

Textures (1024² tileable photos, dark exposure):
- `forest_01`: brown soil with pine needles and twigs.
- `forest_spring`: same plus moss and clover.
- `forest_autumn`: dense red-brown and orange leaf litter.
- `forest_winter`: grey soil with frosted needles.

For us: add a per-season forest-floor layer from the same density field that places trees, height-blended with 7 m noise.

---

## 5. Height-based blending (`terrainBlend`, HH Lo L2300-2312)

```
ma = max(a1+w1, a2+w2) − depth;  b_i = max(a_i+w_i−ma, 0);  out = Σ t_i·b_i / Σ b_i
```
- Height comes from a colour channel:
  - grass `g` (heather blend) or `r` (sand blend)
  - heather, sand `r`
  - forest `r·2·fade2`
  - rock `bump@7m·bump@100m`
- Depths: 0.05 sand, 0.08 rock, 0.1 heather/forest.

For us: one heightBlend helper using albedo luminance as height, depth 0.05–0.1.

---

## 6. Slopes / cliffs

- Steepness: `clamp((0.98 − N.y)·1.4)`; 0 under the road.
- Fragment, only when steep > 0.1:
  - `rock = mix(rock@7m, rock@100m, saturate((depth−20)/130))`
  - `rock.a = bump·bump`; `texel.a = 0.2 + 0.2·fade2`
  - `terrainBlend(…, 0.08)`
- Cali variant: `steepBlend = 1 − smoothstep(0.1, 0.7, steep)`.
- Near-road vertex displacement: `N·(bump@100m − 0.4)·min(1, 3·steep)·clamp((16−roadProx)/6)·0.8`.

Textures:
- `summer_rock` (1024²): layered brown-grey fractured rock with moss.
- `rock_bump.8f8c68ad`: high-contrast white/black crack map.
- `winter_rock`: dark rock with snow in the cracks.

For us: rock where N.y < ~0.88, height-blended via bump, near/far scales 7 m and 100 m, optional displacement on road cuttings.

---

## 7. Heather / upland zone

HH Mo L2095-2100 and yo L2380-2396:
- `vHeather = smoothstep(0.3, 0.6, smoothstep(0.4, 1, (h + 350·fade1 − 60)/500)·screen(fade1, fade0))`
- Removed near and under the road.
- Fragment: mix of heather @7 m and @500 m by `0.25 + 0.75·min(1, depth/400)`, then terrainBlend with depth 0.1.

Textures: purple-brown (summer), plum (autumn), frosted grey (winter) 1024² photos.

For us: in flat Russia, recast as a noise-driven dry-meadow / fallow layer rather than an altitude one.

---

## 8. Road-adjacent ground

**roadProximity** = midline distance − half width, in metres (SC L41520). Negative on the road; 0 = no info.

**Verge** (HH yo L2465-2615):
- If `roadProx + 0.1·fade2 < 0.5·fade0` → a gravel strip of ≤0.5 m.
- `rp = saturate(1 − (roadProx + 0.1·fade2)/(0.5·fade0))`.
- `mix(gravel·(0.75 + 0.75rp²), texel, smoothstep(0, rp, texel.g/rp))`.
- Under trees the gravel mixes toward `forest·1.3` (not in summer).
- Beyond 100 m (or in summer), terrain with `roadProx < −0.2` is painted `roadCol`.

**Off-road mode**
- `offroad_mask` (1024²: vertical band, dark edges, bright streaky centre) sampled with roadUv.
- `texel *= 1 − 0.5·mask.r`.

**Gravel**
- `gravel.0c64b1c3`: brown fine-gravel photo.
- `winter_gravel`: flat light grey.

For us: keep a signed road distance per near vertex, add a noisy gravel verge blended by grass luminance, paint the under-road terrain beyond 100 m, and use a rut mask for dirt roads.

---

## 9. Fields

- `fieldCol` = one random value per field (likely ±0.9 [INFERENCE]) on the far-tile vertex grid (SC L44313, 44920).
- `fadeField = fadeFine(vWv·2)` with one axis zeroed by sign → stripes.
- `texel.rgb += vField·fieldDiscolouration·fadeField`.
- Enabled at detail ≥ 2.

For us: essential for Russia. Use a per-field signed brown/ochre tint with oriented 1-D stripe noise.

---

## 10. Sand, shore, water

**Sand** (not winter):
- `vH = h + min(1, h+0.5)·(2·fade2 + 0.5·(fade0+fade2))`.
- vH < 0 → sand×0.75.
- 0–4 m → height-blend (`sand` 512², ochre photo), `lerp = (vH−1)/3`, depth 0.05, with darkening bands.

**Water mesh** (SC L44787, 44939):
- A plane per tile that contains negative heights.
- y = 0.
- Resolution `max(1, floor(sea.res·tile/20))`, with sea.res 0.2–0.5.
- `depth` attribute = terrain height.

**Water shader** (HH L2713-2935):
- Discard if depth > 10.
- `seaDot = V·up`.
- `sea_waves` (512², black with white sparkles) sampled at `(t+P)/200`, `(P−t)/800`, `(P−t)/300` and a difference UV.
  - Add dark ripples, subtract light ones.
- `mix(base, body, (1−seaDot)^2)`.
- Depth darken ×(1 − 0.3·min(1, −d/15)).
- If seaDot < 0.125 → highlight weight `(1 − 8·seaDot)^2`.
- Time += 2·dt per frame.
- Morning colours: base #14293D, body #454B4F, highlight #B6AE86.
- `noise_water` / `noise_surf_b` are used only in Cali.

For us: cheap view-angle water for lakes/rivers with scrolling sparkle noise and a 0–4 m shore band. There is no reflection render.

---

## 11. Heightmap generation

Class `Pl` (HH L6202-6420) on top of the tile cache `oe` (DevMidline L25-122).

**Structure**
- 3000 m tiles, alea seeded.
- Layer k is an m_k × m_k grid of bumps at cell centres, radius 1/m_k tile.
- `h = rand·2−1`; if squared: `h *= h(1−h)·4`.
- Amplitude `C_k = (5/m_k)·dhf^(k+1)·scale·(1 ± tileScaleRandom/2)`.
- Value = Σ over 4 neighbours of `smootherLerp(d²/r²)·y`, where smootherLerp = 1 − smootherstep.

**Temper**
- Detail layers × `clamp((h + offset + temperBase)/temperBelow, temperMin, 1)` → flat valley floors.
- The result is + offset.

**Road styles**
- Style 0: scale 80, offset 90, layers [3,21,17,31], dhf 0.7, temperBelow 400. Gives ~93 m macro + 9/8/3 m detail.
- Style 1: 110/110, [3,9,17], dhf 0.8.
- Others: 60/100, [3,9,13,27,31], dhf 1.25; and a flat style.
- Treemaps use the same generator (e.g. scale 3, offset 1.7, [21,9,31]).

**Other**
- Curvature = (avg of ±5 m samples − h)·0.005.

For us: smooth radial-bump octaves plus lowland temper. For Russia: macro 40–60 m, detail 3–8 m at 100–180 m spacing.

---

## 12. Mesh / LOD / streaming / horizon

**Far tiles** (f0, SC L40932):
- (2·tile/20 + 1)² verts.
- index0 = 20 m, index1 = 10 m, switched with setDrawRange.
- LOD1 within max(1400, 1.5·tile) m.
- tileSize by preset: 240/480/840/1500/2000/2500 m.
- Initial load is 5×5 tiles.
- Fog `U = 2·tileSize`. No skirts or horizon mesh.

**Near cells** (SC L41140-41600):
- 10 m cells with (cellRes+1)² verts, cellRes 10/16/20 → 1.0/0.63/0.5 m at LOD1, double at LOD0.
- ≤ min(100, 20 + tile/10) cells per chunk.
- Lifecycle in road-node units: stage 1.25·lod0H ahead, display lod0H (50–160), upgrade lod1H (13–28), downgrade behind at max(6, 0.4·lod1), retire at max(12, 0.4·lod0).

**Overlap sink** (HH Mo L2180-2230):
- Far vertices under near cells drop 20 m within sinkDist = lod0H nodes ahead (ramp over the last 25%), half as far behind.
- Near cells: renderOrder 1. Far tiles: renderOrder 2.

**Other**
- `originOffset` uniform for precision.
- Generation is time-sliced by row.

For us: a two-resolution ground (road corridor at 0.5–1 m, far at 10/20 m). Sink the far tiles 20 m under the corridor, draw near first, and end fog at ~2× tile size.

---

## 13. Sampling and asset notes

- Plain world-planar `texture2D`.
- Anisotropy likely 4 for most maps and 16 for offroad [INFERENCE].
- No ground normal maps.
- The final texel is clamped to [0,1].
- `noise_fine` (512², soft cloud noise) is the only mask noise. `noise_finer` (hatch noise) is used elsewhere.

**Unused or non-terrain assets**
- `geomorphology` is a 256×64 text badge and is unused.
- `aomap` (128², vertical gradient) and `marl_diffuse` are vehicle-interior maps.
- `cliff`, `shale`, `surface_*` and `rubble` are OffWorld.
- `shale_03`, `brush_01` and `noise_brush/scuffs/water/surf_b` are Cali. There, shale is placed by convex curvature near the road, and ground layers are chosen by `vDry`/`vGrass`.

For us: a curvature → exposed-soil rule on crests is a cheap extra.

---

## 14. Seasons

**Spring**
- mossy forest floor
- green palette
- gravel under trees mixed with the forest floor

**Summer** (index 1)
- forest_01
- far-road paint also applies near

**Autumn**
- leaf-litter forest floor
- paler grassColB #BEAF79

**Winter** (index 3)
- white palette
- winter_grass as grass and detailNear
- detail_far_winter, macro ×0.7
- winter_gravel as gravel and sand; no sand band or verge
- winter_rock, offroad_mask_winter
- shadowFactor 0.75
- frozen water

For us: a season is a swap of about 10 textures, 5 colours and 3 small shader branches. Build our season system as uniforms and texture sets, not separate shaders.