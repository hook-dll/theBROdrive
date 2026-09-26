# SrRoad.md

## Summary

I read slowroads' road and roadside code across the Hills, Cali, Dev and SceneConfigCol chunks, the terrain chunk and normals.js. I also looked at the relevant textures: road base, single-track, overlay, mask, winter, wall, bridge, sign, reflector and headlight maps. What makes the look: the road is a flat 2-vertex strip. The asphalt texture has a ragged alpha edge (alphaTest 0.75) and sits on a terrain bench. Below that bench the terrain is flattened to road height and painted gravel, then blends into the landscape over 6–16 m. A fresnel term darkens the road near the camera and brightens it at grazing angles. Seasonal leaf or grass overlays appear only where trees line the road. Solid centre lines come from sight-distance logic (turns, tree cover, hills blocking the view, crests). Walls and fences are procedural cross-section strips along the midline, with sloped end ramps and a verge post where each one starts. At night the only light source is one SpotLight with a projected low/high-beam texture.


## Architecture

Road pipeline: the midline generator lays one node every 10 m by steering toward flatter terrain with a feeler. It smooths node heights over a 7–9-node window, sinks the road 0.2–0.4 m into the terrain and detects bridges. Each node gets 1–10 fine sub-nodes on a Catmull-Rom curve; vertical curvature counts 5× when choosing how many. The midline then annotates every node with canopy density on each side (shadowLeft/Right), shoulder-blend noise, bank, paint weights (solid left/right, merge), wall distances and drystone flags. Consumers read these annotations: the road strip mesh (2 verts per node; coarse LOD far, fine LOD near), the road-corridor terrain chunks (height pulled toward the road via getRoadBlendedHeight, plus a roadProximity attribute), the tile terrain (sinks 20 m under the corridor via the overlap attribute), the wall controller (generators → pooled segment meshes for BridgeWall, SeaWall, Barrier, Fence and Drystone), sign generators, cat's-eye Points, the bridge builder, and verge-marker objects at wall starts. Shading: road and terrain are Lambert-style materials patched with onBeforeCompile. A shared custom light chunk applies baked canopy shadow from a vertex attribute, and headlights are one three.js SpotLight with a projected .map texture.


## Files

- /tmp/slowroads/pretty/chunks/DevMidlineGenerator.d99584e3.js: Base road-strip class D (lines 540-770): 2 verts per node, 10 m nodes, uvStep = 10/(2*halfWidth), LOD0 coarse / LOD1 fine index ranges. Midline defaults P (lines 783-822): nodeSpacing 10, feelAng 0.463, maxGrad 0.18, roadSink 0.2, smoothWindow 7. Catmull-Rom fine subdivision extendFine (lines 1290-1340). Feeler steering step (lines 1720-1760).
- /tmp/slowroads/pretty/chunks/HillsHeightmap.b6172a83.js: UK Hills scene. Roads config and laneWidth (lines 1287-1482). View-distance configs with roadNodes, lod horizons and maxWallLength (lines 1487-1590). Terrain vertex shader road factors and overlap sink (lines 2150-2240). Terrain fragment roadside gravel, roadCol and offroad mask (lines 2500-2600). Road shader ue: paint, merge, overlay (lines 4040-4177). Material setup ls() (lines 4820-4900) and hills_road material c (alphaTest 0.75, color 0xDDDDDD, line 4999). Named constant exports (lines 5850-6190) and the constant values they point at (lines 5450-5560). Road width xl() (lines 5660-5705). getRoadBlendedHeight Ll (lines 5773-5840).
- /tmp/slowroads/pretty/chunks/CaliMidlineGenerator.7dfc1747.js: California scene. Asset list (lines 54-130). laneWidth (lines 715-719). Road shader Ae with side/isNarrow and merge disabled (lines 4974-5125). Road strip Ds with paint-weight lerp constraints (lines 5126-5270). cali_road material (line 5947). Width setup tn()/Xr() (lines 6595-6640): barrier thresholds for narrow and standard roads. Object library with RailTerminal and Reflector glb (lines 6519-6522).
- /tmp/slowroads/pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js: Newest main scene. Road-corridor terrain chunk class U, where roadProximity = distance - roadWidth (lines 41120-41600). Overlap bookkeeping (lines 41956-42140). Drystone flags from field walls (lines 44150-44300). Cat's-eyes shader and controller l7 (lines 45000-45230). Sign controller L9 and generators P7/F7/U7 (lines 46340-46800). Midline G7: blend noise, canopy shadowLeft/Right, solid-line logic, banking (lines 46800-47010). Wall controller j7 (line 47011+). Barrier r5 (lines 47330-47700). BridgeWall/SeaWall S2 and generators V7/$7/K7/Q7 (lines 47700-48000). Drystone k2 (lines 48017-48280). Wood fence K4 (lines 48290-48700). Bridge controller Q9/si (lines 48700-48960). Wall config (lines 49856-49870).
- /tmp/slowroads/pretty/chunks/normals.f63d4883.js: Custom light chunk lights_fragment_begin_shadow ox (lines 24565-24790): spot-light map sampling, vShadow canopy override on directional and ambient light. Shadow attribute chunks nx/sx (lines 24529-24560). Headlight SpotLight constants (lines 43719-43725), construction (lines 43806-43812) and setHeadlightIntensity (lines 43860-43880). Headlight layout per vehicle (lines 39446-39449, 41551-41553). Map URLs (lines 36652-36654).
- /tmp/slowroads/pretty/chunks/2.7f7e25dd.js: Moon/regolith scene: road_mask use on terrain (lines 2529-2531), noentry texture (line 8459), RailTerminal/Reflector placement at wall starts (lines 6575-6591), per-scene headlight intensities (lines 3016-3150).
- /tmp/slowroads/app/build/_app/immutable/assets: Textures I looked at: road_base.b33f12ed (1600², Cali, baked edge lines), road_base.f6473539 (1024², Hills, plain asphalt), road_single_base.* (1024×2048), road_single_wide (1024²), road_overlay_autumn/spring (1024²), road_single_overlay_autumn (1024×2048), road_mask / offroad_mask (1024² grayscale), winter_road / winter_road_single (1024²), gravel (1024²), wall_barrier (512×256), wall_barrier_wood (1024×512 atlas), wall_concrete (1024×256), wall_drystone (1024×512), bridge (512²), signs.12f716c4 (960×160 US), signs.c90afd62 (768×256 EU), reflector (64×128), map_headlights_low/high (256²).


# slowroads: road and roadside, reverse-engineered

This is ordered by how much each part contributes to the look. Pretty-printed paths are under `/tmp/slowroads/pretty/`, abbreviated as:
- **SCC** = `chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js` (newest main scene)
- **HH** = `chunks/HillsHeightmap.b6172a83.js` (UK hills)
- **CALI** = `chunks/CaliMidlineGenerator.7dfc1747.js`
- **DEV** = `chunks/DevMidlineGenerator.d99584e3.js` (base classes)
- **NRM** = `chunks/normals.f63d4883.js` (renderer and vehicle)

**About the paint textures:** the read tool flattens alpha onto white. So Hills `road_paint_*` (white paint on transparency) and `noentry.webp` show as blank white; I could not see what they contain.

---

## 1. Road surface: shader and textures (biggest visual impact)

### 1.1 Road mesh and material

**Material** (HH:4999 `hills_road`, CALI:5947 `cali_road`):
- A Lambert-style material patched with onBeforeCompile.
- `alphaTest: 0.75`.
- `color 0xDDDDDD`, or `0xFFFFFF` in winter (HH:4847). The diffuse is deliberately pulled down to 87%.
- `map` is the road base texture, with anisotropy 16 when there is no paint and 4 when there is paint (`s(r.base, o?4:16)`).

**What the alphaTest does:** the base texture's own alpha gives a ragged asphalt edge. Where alpha < 0.75 the fragment is discarded and the terrain underneath shows through. That terrain is gravel-textured (§2.3), which produces the crumbling edge.
- `vBridge` forces alpha to 1 on bridges, so the deck edge is clean.

**Geometry (DEV:540-770):**
- Exactly 2 vertices per fine node: `p ± n·halfWidth`, both at the same height `p.y + G`.
- **No crown and no banking on paved roads.** Bank is only used for off-road tracks, where the road is part of the terrain (HH:5820).
- Normals: cross product of the forward vector and the lateral normal.
- Material is shared, not cloned. One mesh per chunk of `roadNodes` nodes: 25/25/30/35/42/50 by view-distance preset, i.e. 250–500 m (HH:1488-1578).
- Two index ranges in one buffer:
  - LOD0 = one quad per 10 m node.
  - LOD1 = one quad per fine sub-node.
  - `upgrade()` switches the draw range when `vehicleIndex >= headIndex - roadNodes/2`.

**UV mapping:**
- U = 0 at one edge, 1 at the other.
- V advances `uvStep = 10 / (2·halfWidth)` per 10 m node, so the texture covers a square patch: road width × road width.
- Single-track roads set `textureStretch = 2`, so V is halved and a 1024×2048 texture covers width × 2·width (CALI:5023, HH:4076).
- Paint uses the unstretched `vMapUv`.

### 1.2 Fragment pipeline (HH:4103-4175, CALI:5066-5125)

In order:

1. `texel = map(vRoadUv)`. Emissive = `texel.rgb · radiance` (a per-scene night glow; road radiance = scene radiance / 2).
2. **Paint**, if `hasPaint`:
   - Start with `paint = dashedMap(vMapUv, bias -0.3)`.
   - Weights `wX = smoothstep(0.49, 0.51, vX)` for solid, solidLeft, solidRight (and mergeLeft/mergeRight in Hills).
   - Mix in order: merge → solidRight → solidLeft → solid.
   - Then `rgb = mix(rgb, paint.rgb, paint.a)`.
   - The **−0.3 mip bias** keeps lines crisp at distance.
   - Each marking state is a *whole texture* (dashed, solid, solid_left, solid_right, merge_*), not a procedural line.
3. **Seasonal overlay**, if present: `rgb = mix(rgb, overlay.rgb, vOverlayFactor · overlay.a)` with `vOverlayFactor = saturate(vShadow · 3)`. `vShadow` is the canopy density attribute, so leaf litter or moss appears **only where trees line the road**.
4. **Fresnel grade**, the same function as on the terrain (HH:4028-4043):
   - `f = 1 − max(0, dot(V, N))`
   - `light = (max(0, f − 0.75)·4)² · (1 − shadow) · fresnelIntensity`
   - `dark = 0.25 + min(0.25, max(0, (1 − min(1, 1.333f))·I − 0.25)·0.5)`
   - `diffuse *= 1 + light − dark`
   - Result: road seen face-on is darkened by 25–50%; road seen at grazing angles, i.e. far ahead, brightens by up to about 2×.
   - `fresnelFactor` per scene: 1, 1.5, 2.5, 0.5, −0.5, 1 (HH/CALI/2.js light configs).
   - This gives the characteristic bright, hazy road toward the horizon.
5. **Lighting:** the `lights_fragment_begin_shadow` chunk (NRM:24565+):
   - Directional light × `(1 − min(1, vShadow))`.
   - Ambient irradiance × `(1.75 − clamp(vShadow, 0.75, 1))`: ×1.0 in the open, ×0.75 under full canopy.
   - Plus real shadow maps.

**Per-vertex attributes on the road** (CALI:5145-5163): `bridge`, `shadow` (canopy, left/right), `side` (−1/+1), `paintSolid`, `paintSolidLeft`, `paintSolidRight`, plus `paintMergeL/R` in Hills. All are Float32 with DynamicDraw usage.

### 1.3 Textures (viewed)

| file | px | content |
|---|---|---|
| `road_base.b33f12ed` (Cali) | 1600² | Mid-grey fine-aggregate asphalt, two faint darker wheel-path bands and a lighter centre. **White edge lines baked in** at u≈0.083 and 0.917. Brown dusty shoulder strip outside them (0–0.08, 0.92–1). |
| `road_base.f6473539` (Hills) | 1024² | Warmer brown-grey chip-seal asphalt, uniform, very subtle wheel-path shading. Thin crumbly brown edge (about 1.5% each side) that becomes the alpha cutoff. No lines; paint comes from the paint maps. |
| `road_single_base.d5dbc374` (Hills) | 1024×2048 | Darker plain asphalt for single track, alpha-notched edges. |
| `road_single_base.78ac6e87` / `road_single_wide.*` (Cali) | 1024×2048 / 1024² | Grey asphalt with baked white edge lines at about 7% and 93%, tan shoulder outside. |
| `road_overlay_autumn` | 1024² | Scattered colourful leaves plus a dense leaf-litter band at both edges (about 10%) and a leaf strip down the centre. The flat brown fill is transparent. |
| `road_single_overlay_autumn` | 1024×2048 | Heavy leaf carpet on the verges, dark wet gutters, sparse leaves in the wheel paths. |
| `road_overlay_spring` | 1024² | Grass/moss creeping in about 10% from each edge; the olive fill is transparent. |
| `road_paint_dashed.37d80abe` (Cali) | 1600² | Yellow centre dash about 1.7% of width wide (~16 cm on a 9.4 m road), dashes in V 0.25–0.5 and 0.75–1.0: 50% duty, period = half the road width. |
| `road_paint_*` (Hills: dashed, dashed_long, solid, solid_left, solid_right, merge_left/right) | 1024² | White paint on alpha; not viewable (blank). |
| `winter_road` | 1024² | Snow-covered two-lane road. Per lane, a wide dark compacted-slush band with a lighter streak inside (wheel tracks), a clean snow ridge on the centreline, snowy ragged edges. **No paint maps in winter** (HH:991 `road: {base}` only). |
| `winter_road_single` | 1024² | Two dark rutted tyre tracks in bright snow, snow hump in the middle. |
| `road_mask`, `offroad_mask` | 1024² grayscale | Vertical streaky tyre-track mask: bright centre band fading to black. Used on the **terrain**, not the road (§2.3). |
| `gravel` | 1024² | Brown compacted gravel/dirt with small stones. |

**For us:**
- Build the road as a flat 2-vertex strip. Give the base texture a real **alpha-ragged edge and alphaTest ≈ 0.75** over a gravel-textured terrain bench. That one trick makes the asphalt edge crumble instead of ending on a clean polygon edge.
- Map the texture square across the width (`uvStep = segLen / width`).
- For Russian 2-lane roads (6–7 m), bake **faint wheel-path wear** into the base.
- Keep paint as separate white-on-alpha textures (dashed, solid, solid-left/right) selected per vertex with a smoothstep switch, sampled with **mip bias −0.3** and anisotropy 16.
- **Add the fresnel grade:** dark near the camera, bright at grazing angles. It is the cheapest single change that most looks like slowroads.
- Use the canopy-gated seasonal overlay: autumn leaves or spring grass only under trees.
- Winter: a separate snow-rut base with no paint.

---

## 2. How the road sits in the terrain

### 2.1 Height: getRoadBlendedHeight (HH:5773-5840)

The terrain-corridor mesh calls this for every vertex, given the nearest midline sample (distance `d`, road height `y`, node blend).

**Sink and width:**
- The midline is already sunk `roadSink` (0.2 default, 0.4 in most styles; DEV:808/1744) below the raw heightmap and smoothed over a window.
- Terrain directly under the road: `y − 0.01 − 0.01·|longGrad|`, i.e. 1–2 cm below the asphalt.
- If `d < halfWidth/2` (inner half), return exactly the road height.
- Effective road width `w = halfWidth + ROAD_SIDING 0.4 + 0.25 + ga`, where `ga = max(0, |lateral grad| − 1)/3` widens the bench on the downhill side.

**Shoulder blend zone:**
- `rm = ROAD_MARGIN · (0.4 + 0.6·blend)`, with `ROAD_MARGIN = 20 − halfWidth` (≈16.3 m on Hills 2-lane).
- `blend` is per-node low-frequency noise (SCC:46808 `B7`, tileSize 400; ×0.1 on bridges; smoothed 50/50 with the previous node). So the shoulder width wanders between about 6.5 and 16 m.
- `lt = roadLerp(clamp((d − w)/rm))`, where roadLerp is linear ×1.5 up to t = 1/3, then ease-out `1 − 0.5(1 − (t − ⅓)/⅔)²`.
- `h = terrain·lt + roadY·(1 − lt)`.

**Micro relief near the road:** noise `bl` (scale 5, tile 200) times `(1 − (d − w)/16)²`. Where the lateral gradient is high, extra noise `Ml` (scale 8, tile 100) is added, so **cut banks look rough, not planar**.

**Bridges** get a 4 m special fall-off so the ground drops away under the deck.

**Off-road/greenlane variant:** terrain is the road. It adds a 0.2 m cosine berm over 5 m, bank tilt, and a 0.1–0.2 m ridge in the centre.

### 2.2 Two terrain layers and the `overlap` attribute

- The **road-corridor chunk mesh** (SCC:41120-41600, `renderOrder 1`) covers only cells near the midline. Normal sampling stride grows with distance from the road: 1 cell inside 12 m, up to full stride beyond 36 m (`getNormalStride`). It stores `roadProximity = d − halfWidth` (negative under the road) and `curvature`.
- The **tile terrain** (the big LOD tiles) has an Int8 `overlap` attribute. Each vertex holds the node index of the road that passes over it (SCC:40958, 42096-42137).
- In the vertex shader (HH:2193-2230) the tile terrain **sinks 20 m** where `overlap − vehicleIndex` is inside `(−sinkDist/2, sinkDist)`, with linear ramps: full sink up to 0.75·sinkDist ahead and 0.25·sinkDist behind. `sinkDist = lod0Horizon` (50–160 nodes).
- So the coarse tiles hide under the corridor mesh while it exists and come back once it retires. **No z-fighting and no holes.**

### 2.3 Terrain shading by road proximity (HH:2119-2600)

**Grass and trees near the road:**
- Heather and light grass are suppressed within `0.5 + fade0` m of the road.
- `vTreeMask *= clamp(roadProx/2)`: no canopy darkening on the asphalt.
- Grass sprites sink toward the road: `y -= v·0.2·roadProx`, so grass is shorter at the edge (HH:3542).
- Under the road (`roadProx < 0`), steepness and heather are zeroed, so there are no rocks under bridges.

**Rock displacement:** only within 10–16 m of the road: `intensity = clamp((16 − prox)/6)·0.8`, times `min(1, steepness·3)`, using `rockBump`. Cut faces next to the road get real relief.

**Far road trick:** if `roadProx < −0.2` and `camDepth > 100` (or summer), the terrain fragment is painted `roadCol`. Terrain under a distant road already looks like road, which hides LOD gaps and alpha holes.

**Roadside gravel band:**
- For `roadProx + fade2·0.1 < 0.5·fade0`: `rp = 1 − (prox + …)/(0.5·fade0)`.
- Mix `gravelMap` with `forestCol · 1.3`, weighted by canopy (`min(1, vShadow·2)`).
- Composite over grass with `smoothstep(0, rp, grass.g / rp)`. **The grass green channel sets the edge**, so the gravel-to-grass boundary is noisy and organic.

**Off-road / greenlane:**
- `offroadMap` (the streaky mask) is sampled with `roadUv` (the terrain carries the road's UV) and multiplies `1 − mask·0.5` (HH:2576) or `(1.2 − 0.2·prox) − mask·0.65` (CALI:2129). This paints tyre tracks into the terrain.
- Greenlane leaves a grass strip in the centre (`roadProx` between −0.7 and −1.1).

**For us:**
- **Raise or lower the terrain to the road**, not the other way round. Flatten exactly under the inner half, then blend with an ease-out over a noisy 6–16 m shoulder, with extra noise on cut banks.
- Give terrain vertices a `roadProximity` attribute (signed distance − halfWidth). Drive from it: a gravel verge (обочина) band with a green-channel-noised edge, suppressed tall grass and canopy, and road colour under the road beyond 100 m.
- Use the two-layer scheme: a dense corridor mesh plus coarse tiles that sink 20 m under it, keyed by node index. That is how slowroads avoids seams.
- For Russian dirt or greenlane roads, reuse the mask-on-terrain approach: tyre-track mask × terrain colour, a berm, and grass down the middle.

---

## 3. Markings logic: realistic no-passing lines (SCC:46840-46995, CALI:5126-5260)

**Per-node inputs, averaged over `markingsMargin` nodes** (6 default; per style 12/8/6/5):
- turn `da`
- canopy (`min(shadowL, shadowR)`)
- lateral gradient (a hill on the inside of the curve blocks the view)
- crest detection: a sign flip of longitudinal gradient `gf`, weighted toward symmetric crests and smoothed 0.3/0.7

**Computation:**
- `A = max(trees, latGrad, crest)`.
- Threshold `solidLineThreshold` (0.08–0.18 per style) × `(1 − 0.5A)`.
- The threshold is skewed by turn direction, so the solid line appears **on the inside side first**: solid-left vs solid-right. Both sides together give a double solid.
- Hysteresis: a line stays solid until the turn falls below 0.6× the threshold, plus N extension nodes.
- Merge-warning marks (`paintMergeLeft/Right`) are placed 3 nodes before a solid segment starts and after it ends (Hills only; commented out in Cali).

**Crisp switches without cut dashes:** `getPaintWeight` (CALI:5205-5233) interpolates the 0/1 weight across a fine segment so the 0.5 crossing lands exactly on an **integer UV**, i.e. a texture-period boundary. With `smoothstep(0.49, 0.51)` a dash is never cut in half at a transition.

**For us:** copy this rule set with Russian markings: 1.5 dashed centre, 1.1 solid, 1.6 approach-warning dashes instead of merge arrows, 1.2 edge lines. It turns a procedural road into a believable, legible one. Put switch points on dash-period boundaries.

---

## 4. Road geometry: midline, widths, cross-section, LOD

### 4.1 Midline

**Stepping** (DEV:783-822, 1720-1760):
- One node every 10 m (`nodeSpacing`).
- Heading chosen by feelers at ±`feelAng` 0.463 rad, `feelDist` 10–30 m (longer near water). The road steers toward the side with lower height/gradient, clamped by `maxTurnDelta` (0.1–0.7 per style) and `smoothFactor`.
- Straight styles set `isStraight`.
- Node records: `a` heading, `da` turn, `g` lateral gradient (normalised by `maxGrad`), `gf` longitudinal gradient, `h` height offset, `n` lateral normal.

**Height:**
- `max(heightmap, minElev 2) − roadSink`.
- Smoothed over `smoothWindow` 7–9 nodes, with `maxGrad` 0.12–0.2 per style.
- If the road gets stuck it reverts and regrows. Bridges are found by a landing search, 3–35 nodes long.

**Fine sub-nodes** (DEV:1290-1340):
- Catmull-Rom through prev/cur/next/next2.
- Count = `floor(sqrt((1 − max(minDot, 0.99))·100)·10)`, clamped between `minFineSegs` (1–4) and 10.
- `minDot` uses direction vectors scaled by (1, **5**, 1), so vertical curvature (crests, dips) also forces subdivision.
- The fine horizon is 200–600 m ahead (`midlineFineHorizon`).

**Bank** (SCC:47001-47008): `bank = Δheading(prev→next) · 0.8`, smoothed 50/50, zero near bridges. Only used for off-road terrain tilt.

### 4.2 Widths and cross-section

From `xl()` (HH:5660-5705) and `tn()` (CALI:6595-6640). For multi-lane roads: `halfWidth = 0.1 (centre gap) + nLanes·laneWidth + outer margin` (0.2 in Hills, 0.6 in Cali). Single-track roads: `halfWidth = laneWidth/2`.

| Scene | Style | Lane width | halfWidth | Total width |
|---|---|---|---|---|
| Hills | 2-lane | 3.4 | 0.1 + 3.4 + 0.2 = 3.7 | 7.4 m |
| Hills | wide | 4.0 | 4.3 | 8.6 m |
| Hills | single track | 3.6 (wide 7.2) | 1.8 | 3.6 m |
| Cali | 2-lane | 4.0 | 0.1 + 4 + 0.6 = 4.7 | 9.4 m |
| Cali | single | 5.2 (off-road 4) | 2.6 | 5.2 m |

- Lane centres: Hills 1.8 m from the centreline, Cali 2.1 m.
- `ROAD_BUMP_MARGIN 12`, `ROAD_BUMP_SIDING 2.5` are physics values.

**For us:**
- Central-Russia 2-lane road: lanes 3.0–3.5 m plus paved margin 0.25–0.5 m, i.e. halfWidth ≈ 3.5–4.0.
- Put the unpaved shoulder in the terrain gravel band, not in the mesh.
- Keep a 10 m node grid with curvature-adaptive fine sub-nodes (vertical curvature weighted 5×).
- Road chunks of about 25–50 nodes with coarse/fine index ranges.

---

## 5. Barriers and walls

Source: SCC:47011-48700, config at SCC:49856-49870.

**Controller j7:** a pool of segment meshes per class. The per-class geometry template is cloned; draw range grows node by node (`drawNextNode` staged one node per frame).
- Generated up to `vehicleIndex + (horizon + MAX_WALL_LENGTH + BACKFILL + 2)` nodes ahead.
- Drawn when the vehicle is within `horizon` nodes of the segment start.
- Retired `horizon·0.25` nodes behind.

**Segments** are `{startNode, endNode, type, distance}`. A new segment that starts at the previous one's end with the same type is marked `contiguous` and inherits its distance.

**Every non-contiguous wall start and end:** the first and last cross-sections are lowered by the full wall height, giving a **sloped end ramp into the ground**. A `VergeMarker` object is placed at the start: a black/white verge post (obj inlined at HH:5445) with materials white (emissive 0.2), black, and red reflector `0xFF2222` with emissive 0.2. Cali places `RailTerminal` + `Reflector` glb instead (2.js:6575-6591).

**All walls:** a per-vertex `shadow` attribute from node canopy density (×2 barrier, ×2.5 fence, √·1.25 drystone) darkens walls in forest. Heights come from `getRoadsideHeight`, so the base follows the terrain.

### 5.1 Placement rules

The `V7` barrier generator. Hills/SCC constants: standard / narrow.
- **Start:** `!bridge && y > SEAWALL_ELEV 4`, and one of:
  - `|g| > BARRIER_GRADIENT_THRESHOLD` (2 / 4) on the downhill side (g < 0 → left)
  - a same-sign turn `|da| > BARRIER_TURN_THRESHOLD` (0.3 / 1.0) with `h < 0.6`
- **Continue** while `|g| > MAINT` (1.5 / 2.5), or turn > 0.15 / 0.5 with g past ±0.1, and `y > 3`.
- **Extent:** back-filled up to `WALL_LENGTH_BACKFILL = maxWallLength/2 − 4` nodes. Forward up to `MAX_WALL_LENGTH` (20–30 nodes by preset). Segments shorter than `MIN_WALL_LENGTH` 3 are dropped. Gaps under `MIN_WALL_GAP` 4 are closed.
- **Offset:** `halfWidth + BARRIER_DIST` (0.4 / 0.8 m; Cali 2 / 1 m).
- **Type:** on even start-node indices, or when continuing a fence, the barrier becomes a **wooden post-and-rail fence**. So about half the guarded stretches are fences.

**Sea wall `$7`:** `y < 4` and (`|g| > 0.3` or `h < −2`), at `halfWidth + SEAWALL_DIST` (0.8 / 1.2).

**Bridge wall `K7`:** on bridge nodes, at `halfWidth`, extending 1 node past each end. `BRIDGE_WALL_HEIGHT 0.75`.

**Drystone `Q7`:** nodes flagged `dswl`/`dswr` by the **field system**. When a field polygon meets the road, its boundary wall is placed along the road at `DRYSTONE_DIST = halfWidth + 2 m` (SCC:44230-44300). Hedgerow trees are planted just behind it, with density from the tree map.

### 5.2 Cross-sections and textures

**Barrier `r5`** (SCC:47330-47700), a W-beam guardrail:
- Height 0.78 m, mesh sunk 0.15.
- Profile rows (the number of rows depends on detail setting, 2–5):

| Row height | Fraction of 0.78 m | Lateral offset |
|---|---|---|
| 0 | — | +0.1 m out |
| 0.43 m | 0.55 | +0.1 m out |
| 0.53 m | 0.68 | on the line |
| 0.69 m | 0.88 | on the line |
| 0.78 m | 1.0 | +0.1 m out |

- The beam corrugation bulges 10 cm toward the road.
- V = 0, .55, .68, .88, .98. U = 6 per 10 m node, so the texture repeats every 1.67 m (post spacing).
- `wall_barrier` 512×256: upper ~45% is the galvanised beam with bolt heads and a slot. Below it is transparent except dark posts at both U edges, so posts are alpha-cut from the same quad strip.
- Material `barrier`, normal map inline (512×256 data-URI), anisotropy 8.

**Wood fence `K4`** (SCC:48290-48700):
- 1 m tall, sunk 0.15.
- Rails: lower 0.52–0.56 m, upper 0.8–1.0 m (profile heights 0, .56, .56 + 0.08 out, .8, 1, 1 + 0.08 out). V = height·0.4.
- Posts every 5 m (2 per node): 12 × 13 cm boxes, 1.03 m tall, with a pyramid cap.
- Random ±3 cm height jitter per rail vertex, so rails wobble.
- `wall_barrier_wood` 1024×512 atlas: three weathered grey-brown plank post faces at the top, two long mossy rail boards, the rest transparent.

**Concrete bridge/sea wall `S2`** (SCC:47700-47900):
- Trapezoid 1 m tall, top 0.25 m wide, base flared 0.15 m each side, sunk 0.2.
- U 2.5 per node (4 m repeat).
- `wall_concrete` 1024×256: board-formed concrete panels with vertical joints every ~20%, dirty damp base.

**Drystone `k2`** (SCC:48017-48280):
- 6-vertex profile. Height ~1.12 m (`DRYSTONE_HEIGHT`) plus per-node noise. Width 0.38, base flare. Sunk 0.12.
- The crest has two random ridge vertices 0.06–0.11 m off the centre at +0.1 ± 0.03 m: an irregular capstone top.
- V = 0, .44, .48, .52, .56, 1. U 2 per node (5 m repeat).
- `wall_drystone` 1024×512: coursed flat stones top and bottom, and a middle band (~0.40–0.60) of **vertical coping stones**. The UV mapping puts that band exactly on the crest.

**Winter/spring variants:** `winter_wall_*` and `spring_wall_*` textures.

**For us:**
- Generate roadside objects **from midline annotations**. A guardrail (барьерное ограждение) goes where the terrain drops away (lateral gradient > ~2) or on sharp curves; use 20–30-node maximum runs, backfill, gap closing, and **sloped ground ramps plus a verge post at the start**.
- The Russian сигнальный столбик (white post, black band, reflector) is a direct analogue of VergeMarker. Also scatter them along curves.
- Use an alpha-tested texture strip for the W-beam and posts: cheap and convincing.
- Swap drystone for field-edge wooden fences or tree lines (лесополоса) fed from the field system, set about 2 m beyond the road edge.
- Use a baked canopy shadow attribute on all roadside meshes.

---

## 6. Canopy shadow along the road

SCC:46862-46895.

**Per fine node:** `shadowLeft/Right = max(existing, treeShadowDensity at p ± n·halfWidth)`.
- Reduced when the road rides high above the terrain (`th = y − h < 5` → × th/5) or when the terrain falls away laterally (g past ±2).
- Zeroed on bridges.
- Interpolated across fine sub-nodes.

**Consumers:**
- road `shadow` attribute: dims direct light, reduces ambient, gates the seasonal overlay
- wall shadows
- the markings tree factor

**For us:** bake tree-density-at-road-edge into a per-vertex road attribute. It gives forest-road darkness without shadow-map cost at distance, and it is what makes the autumn overlay appear only in forests.

---

## 7. Headlights, cat's eyes, reflectors

### 7.1 Headlights: projected textures (NRM:43719-43880)

**One `SpotLight` per player car** (`lights.left`; no right light):
- Colour `0xFFF0E0`, distance 150, `bE = 0` (no shadow).
- **High beam:** angle 0.48 rad, penumbra 0.25, intensity I.
- **Low beam:** angle 0.45, penumbra 0.1, intensity I·0.5, decay × 0.8, and the target y is lowered (`headlightTargetLow`).
- `decay = 1.2 · (4 − 3·min(1, I/300))`: stronger light gets less decay.
- `light.map = map_headlights_low/high`. This is three.js r155+ `SpotLight.map` (projected cookie), sampled in the patched light chunk (NRM:24688).
- Layout (typical car): position (x 2.1 forward, y 0.68), target 1.5 m forward and 0.05–0.15 m lower. Light and target move with suspension travel.
- Scene intensity: day 10–100 (off); night 200; alternative nights 300–400 with coloured headlights `0x86F0FE`, `0x9CE5FF`.

**The maps (256², grayscale):**
- `map_headlights_low`: a wide, flat, bright horizontal band in the lower-middle, with a **sharp top cutoff** at about v 0.42 and a slight dip in the centre (two merged lobes). Soft falloff sideways and down, black above.
- `map_headlights_high`: a taller, brighter oval from two merged lobes reaching higher, with a softer top.

**Other headlight-lit effects:** snow particles get a headlight-cone brightness term (SCC:49210-49270). The road spot term on trees is modified (`RE_Direct_Lambert_Spot`: `dotNL = 0.1 + (1 − |N·L|)·0.1`, CALI:5290), which flattens the lighting on foliage.

### 7.2 Cat's eyes (SCC:45000-45230)

- `THREE.Points`, size 0.06, white, `transparent`, `fog:false`, `renderOrder −10`.
- Pairs at ±0.04 m around the centreline, 3 cm above the road.
- Spacing = full road width (`initialise($·2)`), about 7.4 m in Hills.
- Brightness in the vertex shader:
  - distance fade `1 − (d − 75)/75` (0 beyond 150 m)
  - `max(0, dot(normal, headlightDir))`
  - cone `(dot(dir, toCar) − 0.9)/0.1`
- Visible only when headlights are on and `SHOW_CATS_EYES` (paved, not single track).
- Ring of 2 instances, 40 nodes of points each.

### 7.3 Reflector texture

`reflector.webp` 64×128: left half brushed grey metal (post), top-right orange diagonal-hatched retroreflective band, white body with bolt dots. Used by the `Reflector` glb (a delineator on a guardrail end) in Cali.

**For us:**
- Use **one SpotLight with a projected low/high-beam texture**. Make our own 256² gobo with a flat band and hard top cutoff for low beam, a taller oval for high beam. Numbers to start from: angle ≈ 0.45–0.48 rad, distance 150, decay 1.2–3.6 by intensity, low beam at half intensity.
- Make the night look with retroreflection instead of more lights: cat's-eye-style Points on the centreline (Russia rarely has them; better to use the same shader on сигнальные столбики reflectors and sign faces), plus a headlight-cone term on snow and rain.

---

## 8. Signs

SCC:46340-46800.

**Geometry:** one proto mesh.
- 0.7 m square double-sided panel, bottom edge at 1.8 m.
- Triangular-prism post 8 cm wide, from −0.2 to 2.15 m.
- UV-selected atlas tile. The atlas's first column is the grey back of the panel and the post texture.

**Placement:** at `halfWidth + 0.6 m` from the midline, on terrain height, facing the road.

**Turn signs:**
- Accumulated `da` over 5 lookahead nodes > 1.2 rad (style 1: 0.5 over 10; style 3: 1.6).
- At least 10 nodes apart; placed 3 nodes before the bend.
- If the next bend reverses direction within the spacing, the sign becomes a **double-bend** variant.

**Gradient signs:** 100 m lookahead grade > 15% or > 20% (uphill/downhill variants), at least 20 nodes apart, upgraded while on the hill.

**Chevrons:**
- Trigger: prior turn sum < 0.5, then a sharp turn (`|da| > 0.28` and next > 0.12, same sign).
- **3 chevrons** at fine-node offsets 0, 4, 8, on the outside of the bend, 1 m further out and **1 m lower** (panel at ~0.8–1.5 m).
- Signs within 3 nodes of each other are stacked 0.7 m below the previous one.

**Material:** `alphaTest 0.75`, flatShading, emissive white with `emissiveMap` = the atlas, `emissiveIntensity = min(sun/20, 0.5)`, custom `lights_pars` (HH:5432-5440).

**Atlases:**
- `signs.12f716c4` 960×160 (US): grey back, yellow diamond turn, reverse-turn, sharp-turn and winding arrows, yellow chevron.
- `signs.c90afd62` 768×256 (EU): grey triangle back, grey square back, red-bordered triangles for bend left/right, double bend, 15%/20% up and down, black/white chevron boards with yellow frames.

**For us:** reuse this rule-driven placement with GOST signs: 1.11.1/2 bend, 1.12 double bend, 1.13/1.14 steep grade, and 1.34.1/2 red-white chevrons (3 on the outside of tight bends, lower mounting). Use a 0.7 m panel at 1.5–2 m on a thin post, and a slight emissive term so signs pop at night.

---

## 9. Bridges

SCC:48700-48960; generator in DEV.

- Deck, pylons and arches built from the node run where `bridge = true` (3–35 nodes).
- Arch spacing `ceil(len/10)` nodes; one arch if shorter than 4.
- LOD by node index:
  - display at head − lookahead
  - upgrade (arches plus a transparent black shadow quad, `opacity 0.4`) at head − 0.4·lookahead
  - downgrade at tail + 0.1·lookahead, retire 0.2·lookahead later
  - `bridgeLookahead` 50–300 nodes
- Material `color 0xBBBBBB`, flatShading, `bridge.webp` 512²: weathered beige concrete with a horizontal form seam at mid-height and rust/algae stains.
- The road strip over a bridge uses solid alpha. Terrain drops away under the deck (§2.1). Walls sit at `halfWidth`.

**For us:** a simple procedural deck, pylons and optional arches, with a node-index LOD schedule and a fake contact-shadow quad, is enough. Russian rural bridges are plain concrete-beam spans with low parapets.

---

## 10. Priority list for renderer v2

1. **Terrain bench plus alpha-ragged road.** Flatten under the road, ease-out 6–16 m noisy shoulder, gravel verge band keyed on `roadProximity` with a green-channel-noised edge, road texture with alphaTest 0.75 edges, road colour on terrain under the road beyond 100 m.
2. **Fresnel grade and canopy shadow attribute** on road, terrain and walls: face-on ×0.5–0.75, grazing up to ×2; direct light × (1 − shadow), ambient × (1.75 − clamp(shadow, .75, 1)).
3. **Paint as whole-texture states** per vertex, with sight-distance-driven solid lines (turn, trees, lateral hill, crests), switches on dash boundaries, mip bias −0.3.
4. **Seasonal overlay** gated by canopy; winter snow-rut base with no paint.
5. **Guardrail and fence strips** from midline gradient and turn rules: sloped ends, verge post at the start, alpha-cut posts, UV repeat 1.67 m.
6. **Two-layer terrain** with the index-keyed 20 m sink of coarse tiles under the corridor.
7. **Night:** a single projected-cookie SpotLight (low/high maps) plus headlight-cone brightness on retroreflective props and snow.
8. **Signs and chevrons** by curvature and grade rules.