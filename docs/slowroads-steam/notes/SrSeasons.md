# SrSeasons.md

## Summary

slowroads has no weather simulation. A "style" is a lookup of season × time × weather into hand-tuned palettes: 4 seasons (spring/summer/autumn/winter, `seasonIndex` 0..3), 4 times (morning/day/evening/night) and 2 weathers (clear/overcast). There is no rain, no wet road and no puddles. The only precipitation is point-sprite snow, which appears only in winter overcast (morning, day, evening and night overcast). A season change is an instant texture and uniform swap with no crossfade. Seasons differ mainly in: a per-season texture set; road overlays for spring/autumn (moss or leaves), shown only under tree shade; four ground tint colours plus a field tint; about six `seasonIndex` branches in the ground and grass shaders; and a `hasSnow` flag that turns up-facing tree normals white. Scene config means: scene (Hills, Coast/Cali, OffWorld mars/moon/venus; Woods/Alps/Autobahn/Driftmas all reuse the Hills class), road style (Straight/Casual/Normal/Winding/Dev, each with its own heightmap, treemap and midline parameters), lane style (OffRoadWide/OffRoad/Single/SingleWide/Standard/Two/Three/Four), plus graphics tiers. Every palette value is listed in the report in decimal (as in the source) and hex.


## Architecture

A style is a plain object `te.style[season][time][weather]` shallow-merged over `te.style[season].common`. `Dl(settings)` (HillsHeightmap L5711) copies it into module globals: friction/slip/roughness, fog A/B/C, near/far as fractions of the view distance, haze, stars, snow, lights, surfaces, clouds and audio. It then calls `ls(season,cfg)` (L4815), which sets `seasonIndex`; swaps every texture (ground, forest, heather, gravel, sand, rock, detail, grass sprites, bushes, imposters, tree atlases, walls, bridge, clouds); swaps road base/paint/overlay; and sets ground tint uniforms, water, cloud and tree uniforms, `hasSnow` and `shadowFactor`. The scene class `onSceneSettingsChanged` then updates the sun (DirectionalLight), ambient and hemi lights, and the custom fog (colorA/B/C, near, far, density sqrt(5/far²), hazeHeight, hazeIntensity), toggles the stars and snow systems, and regenerates the vehicle env map from {sky: fog.colB, horizon: fog.colA, ground: grassColA, road}. LiveSettings defaults to summer/day/clear. `nextStyle` cycles weather→time→season. World config {scene, roadStyle, laneStyle, roadWidth, seed} selects `te.roads.style[roadStyle]` (midline + heightmap + treemap noise params) and lane geometry (`xl`). Graphics tiers (`viewDistance[i]`, `detail[j]`) set tile size, LOD horizons, cloud altitude and grass density.


## Files

- /tmp/slowroads/pretty/chunks/HillsHeightmap.b6172a83.js: Hills scene: per-season texture sets (L63-127 summer, 391-422 spring, 668-700 autumn, 947-993 winter), all season×time×weather palettes (summer bi L148-389, spring yi 428-666, autumn Vi 721-945, winter mo 1003-1270), styleMeta L1271-1311, road styles L1312-1480, laneWidth L1481, graphics tiers L1483-1620, cloud shader L1621-2000, ground VS/FS with seasonIndex branches L2034-2660, imposter snow L3220, grass-sprite winter crop L3619, road shader with overlay L4040-4175, applyStyle ls() L4815-4920, config reader Dl() L5711-5746, lane config xl() L5663-5700
- /tmp/slowroads/pretty/chunks/CaliMidlineGenerator.7dfc1747.js: Coast/Cali scene (summer only): dirt/grass/shrub/brush palette L141-158, time/weather palettes with water shallows/shore/surf L160-510, road styles L511+, config reader an() L6642-6679
- /tmp/slowroads/pretty/chunks/tree_04.6b3d8a5d.js: Tree shaders: world-noise leaf discolouration (L40, L591), snow on up-facing normals (L772-777)
- /tmp/slowroads/pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js: Snow particle system (class xi, material V) L49180-49421; scene settings default season/time/weather and style cycling L49546-49590; snow visibility wiring L49653-49752
- /tmp/slowroads/pretty/chunks/2.7f7e25dd.js: OffWorld mars/moon/venus palettes L2940-3160; snow_spray = offworld wheel-dust particles L4122-4345; Hills scene class onSceneSettingsChanged/updateSky/updateHDR/updateFog L7650-8210; road-picker icons L18180-18237; scene class table Or L8233
- /tmp/slowroads/pretty/chunks/normals.f63d4883.js: Enums roadStyle Gm / laneStyle Hm / lane counts f_ / lane lists L26324-26332; scenes Vs + default world config bb L35181-35201; surfaces Tarmac/Gravel/Ice L34646; env-map palette setter L24366; fog uniforms L10309/L16234; hasSnow disables off-road reset L36350
- /tmp/slowroads/pretty/chunks/DevMidlineGenerator.d99584e3.js: Custom fog chunks: cylindrical distance, haze/desaturate toward colC, noisy height haze, colA/colB vertical blend (L360-535)
- /tmp/slowroads/pretty/nodes/6.57438e8d.js: Dev palette editor: reads and writes every style field incl. snow density/col/speed and exports it as config text (L2199-2430)


## 1. What a season or weather change actually does (biggest visual impact)

**The model.** Style = `{...style[season].common, ...style[season][time][weather]}` (HillsHeightmap L5713). There is no interpolation. Changing a setting re-runs `Dl` → `ls` and assets and uniforms are swapped at once.
- Options: season ∈ spring|summer|autumn|winter (default summer), time ∈ morning|day|evening|night (default day), weather ∈ clear|overcast (default clear) (L1271-1311). There are no preset combos: `styleMeta.presets` is referenced but undefined.
- `seasonIndex` = `Bt.indexOf(season)` → spring 0, summer 1, autumn 2, winter 3 (L4821-4823).
- Coast/Cali has only `summer`. OffWorld uses location × time (mars|moon|venus × day|night).
- **Weather is overcast only. There is no rain, wet road, puddles or lightning** (grep: 0 hits). Overcast is entirely palette work: dimmer, cooler sun; fog near moved in; lower cloud shelves; negative `hazeHeight` giving a low cloud ceiling; a different ambience track.
- Snow falls only where the style has a `snow` block with density > 0. Those combos are winter morning overcast (0.5), day overcast (1), evening overcast (0.5) and night overcast (1). Winter day clear has density 0, which hides the system.

For us: build the same 3-axis palette table as data. Add a crossfade over about 2 s, which slowroads lacks. For the look, the fog/sky/sun palette plus the per-season ground tint and texture swap matter most, not simulation. Rain and wet roads would be our own addition.

## 2. Ground palette per season (Hills) — tints a greyscale grass texture

The ground fragment shader (L2360-2380) works like this:
- `grassBlend = saturate(((screen(fade1,fade0)+vDarkGrass)/2)² + variation(vWWv) + closeVariation(vWv))`.
- `lightGrassFactor = saturate(saturate(vLightGrass+var-closeVar)·2·texel.r)`.
- `grassCol = mix(mix(grassColA,grassColB,grassBlend), mix(peakColA,peakColB,grassBlend), lightGrassFactor)`, then `texel.rgb *= grassCol`.
- `vLightGrass = saturate((h-(30+fade1·40))/150)`, so peak colours take over from about 30 to 180 m altitude.
- Fields add `vField·fieldDiscolouration·fadeField` (additive, with mow stripes).
- `grass.webp` (1024², neutral grey blades) is shared by spring, summer and autumn. Winter uses `winter_grass` (1024², almost pure white).

| season | grassColA | grassColB | peakColA | peakColB | fieldDiscolouration | colours.road |
|---|---|---|---|---|---|---|
| spring | 5145922 #4E8542 | 9742683 #94A95B | 13095061 #C7D095 | 11632477 #B17F5D | 1575948 #180C0C | 6513248 #636260 |
| summer | 4680504 #476B38 | 10002017 #989E61 | 12300171 #BBAF8B | 14777671 #E17D47 | 3016965 #2E0905 | 5986132 #5B5754 |
| autumn | 4881741 #4A7D4D | 12496761 #BEAF79 | 14925472 #E3BEA0 | 10649893 #A28125 | 2301205 #231D15 | 6513248 #636260 |
| winter | 16777215 #FFFFFF | 14409185 #DBDDE1 | 14409185 #DBDDE1 | 12172742 #B9BDC6 | 6381921 #616161 | 9802899 #959493 |

`colours.clear` = 12316415 #BBEEFF in all seasons.

`common.effects` per season:
- summer: shadowFactor 0.9, treeDiscolouration 0.9
- spring: 0.8, 1.5
- autumn: 0.8, 1.2
- winter: 0.75, 0.2, plus `frozenWater:true, hasSnow:true`

Surfaces are road Tarmac / offroad Gravel; winter road = Ice. Foliage alphaTest is grass 0.5 / bush 0.2 / imposter 0.6; winter uses 0.2 / 0.3 / 0.5.

For us: author ground textures as greyscale and tint them with 4 colours (two low-land, two high-land) blended by low-frequency noise and altitude. This gives most of the seasonal shift.

## 3. Per-season texture swaps (`ls()` L4824-4903)

- **grass:** grass (spring/summer/autumn); winter_grass.
- **forest floor:** forest_spring / forest_01 / forest_autumn (1024², brown-orange leaf litter) / forest_winter.
- **heather:** summer_heather_05 (spring, summer) / autumn_heather / winter_heather.
- **bushes:** spring_bushes / summer_bushes / autumn_bushes / winter_bushes.
- **grassSprites:** summer_grasses for three seasons. Winter uses winter_grasses (1024×256, 4 cells; cells 0-1 empty, 2 = sparse dry stems, 3 = snow-dusted shrub).
- **rock:** spring_rock / summer_rock (summer and autumn) / winter_rock.
- **gravel/sand:** winter uses winter_gravel for both.
- **detailNear/detailFar:** winter uses winter_grass and ground_detail_far_winter.
- **offroadMap:** winter uses offroad_mask_winter (black with a white centre band = track).
- **imposters:** {season}_imposters_0_d/_1_d/_0_n, 4096×1024, 4 rows (species) × 16 view angles. Autumn rows are red-orange, yellow birch, brown and orange. Winter trees are bare grey/white.
- **trees:** {season}_trees_0 (+_n) and _1_m/_a. Winter_trees_0 is 4096×1024: 4 bare trees with bark strips.
- **walls:** spring_wall_barrier_wood/drystone, winter_wall_* (barrier, concrete, barrier_wood, drystone).
- **road:**
  - spring: road_base + paint + road_overlay_spring; single road road_single_base_spring + road_single_overlay_spring.
  - autumn: road_base + paint + road_overlay_autumn; road_single_overlay_autumn.
  - winter: winter_road / winter_road_single / road_single_wide_winter with no paint maps (`hasPaint` = false).
  - winter_road (1024²): pale grey snow with two dark packed-slush wheel-track bands.
  - Road colour is 0xFFFFFF in winter, 0xDDDDDD otherwise (L4851).
  - Anisotropy: road base 4 with paint, 16 without; paint 16; overlay 4.

## 4. Road overlays (spring moss, autumn leaves), only under tree shade

- VS (L4066): `vOverlayFactor = saturate(vShadow·3)`, where `vShadow` is tree cover.
- FS (L4168): `rgb = mix(rgb, overlay.rgb, vOverlayFactor·overlay.a)`, using the road UV with `y /= textureStretch` (single 2, wide 1).
- road_overlay_autumn (1024²): the alpha-masked parts are scattered leaves across the lanes, heavier at both edges (~10% width) and along the centre (~42-58%).
- road_overlay_spring (1024²): grass and moss fringes at the edges only.

For us: add a per-season road overlay weighted by our existing roadside tree-shade value. It costs one texture fetch.

## 5. `seasonIndex` and `hasSnow` shader branches

- **VS (L2119-2125):** near the road, heather is always suppressed. Light grass is suppressed only when `seasonIndex<3`, so winter stays white up to the road.
- **FS (L2339):** in winter, `blendValB *= 0.7` (flatter detail).
- **FS (L2462):** sand below `vHeight<4` only when `seasonIndex<3`, so snow meets frozen water.
- **FS (L2516):** roadside gravel only when `seasonIndex<3 || offroad`, so winter has no gravel shoulder. In summer only, pixels under the road get `roadCol` at any distance; other seasons only beyond `vCamDepth>100`.
- **FS (L2581):** when `seasonIndex != 1` and under shade, shoulder gravel blends to `forestCol·1.3` (leaf-litter shoulders).
- **FS (L2575):** winter applies the offroad track mask on greenlane too.
- **Grass sprites VS (L3619):** `seasonIndex<3` halves the height of variants 0, 1 and 3. Winter scales variants 0-1 to zero and halves the rest.
- **Imposters (L3221):** with `hasSnow`, leaf diffuse = mix(diffuse, 1, min(1, dotUp·8)), where dotUp = dot(normal, cameraUp).
- **3D trees (tree_04 L772):** `if dotUp>0.1: diffuse = mix(diffuse, vec3(min(1,0.5+dotUp)), min(1,(dotUp-0.1)·8))`.
- **Leaf discolouration (tree_04 L40):** `disc = 1+(noise(wPos.xz/256)-0.5)·treeDiscolouration`, multiplied into leaf g (or rg).

For us: snow on trees via normal·up is one line and very effective. Also take the 256 m leaf-noise tint, and in winter turn off sand, shoulders and tall grass.

## 6. Winter systems

**Snow particles** (SceneConfigCol L49180-49421):
- `THREE.Points` on a grid of (220+1)² = 48,841 points in a 30×30×30 m box. The half set (every 3rd row and column) has 74² = 5,476 points and is used when density ≤ 0.5.
- The box is centred 15 m ahead of the camera on the flattened forward vector.
- VS: `y = mod(mod(y-off,30)-time·speed,30)`; xz wrap modulo 30; wobble from noise at xz/50 + t/200.
- Point size `0.045·scale/-z`. Flakes within `minDist` are discarded (0.3 m, or `snowMinDist` in cockpit view).
- FS colour = `snowCol + headlight glow`. Glow within 100 m = `(1-(d-25)/75)·((cone dot-0.9)/0.1)·0.7`. `fog:false`, alphaTest 0.1.
- Config per combo: morning overcast 0.5 / 3692380 #38575C / speed 1.75; day overcast 1 / 11646409 #B1B5C9 / 1.75; evening overcast 0.5 / 7895160 #787878 / 1.8; night overcast 1 / 4210752 #404040 / 2. Flake colour is pre-darkened to match the ambient.
- Hidden underwater and when the weather cycle is disabled.

**Ice:**
- Winter friction road .85 / grass .7 / gravel .7; slip .9 / .5 / 1; roughness .05 / .6 / .3.
- Summer friction .98 / .7 / .8; slip 1 / .84 / .9; roughness .025 / .5 / .4.
- `hasSnow` stops off-road from triggering the reset timer.

**Frozen water:** `ANIMATE_WATER=false`, pale water palette.

**snow_spray.webp** (128² white puff) is actually OffWorld wheel dust (2.7f L4122-4345):
- 1,000-point ring buffer; one spawn every 0.15 m of wheel travel.
- Intensity = min(1, speed/30)·downforce, raised by slip or lock.
- Size `0.8+age·2.5·(1+2i)`; 3 s fade; sine hop; rotated sprite.
- Colour = style `dust`. Graphics option `wheelSpray`, detail > 1.

For us: a camera-box Points snowfall (about 5.5k / 49k points) with headlight-lit flakes. Reuse the spray design for slush, dust and rain spray.

## 7. Fog, haze, clouds, lights

Fog (DevMidlineGenerator L360-535):
- Cylindrical distance. near/far = fraction × U, where U = tileSize·2 (×0.75 if < 300). Density = sqrt(5/far²).
- `vHaze = (d/far)²`, `vDesat = d/far`, both scaled by `1+min(0,hazeIntensity)`.
- Final: `rgb = desat(rgb, vDesat)`, then `mix(rgb, colC, vHaze)`, then `mix(rgb, mix(colA, colB, fogBlend), fogDepth)`, with `fogBlend = max(2·(y-camY)/d, 0)·vFogBlend`.
- `hazeHeight > 0`: ground mist, `(1 - min(camY,y)/hazeHeight)·hazeIntensity` with pNoise variation.
- `hazeHeight < 0`: cloud ceiling, fog grows with height and `vFogBlend *= 1-hazeIntensity`.

Sky: a plane scaled 1e6 × 1e5 at `-viewDist`, renderOrder -10, coloured by the fog.

Clouds (L1621-2000):
- A plane at cloudAltitude 400-800 m.
- Two parallax shelves (shelfHeight0/1, skyScale0/1 × altitude) sample one clouds_01 texture, with dome curvature.
- Modes: 0 screen-blend lowlight→highlight; 1 dist² falloff; 2 sunset two-tone (highlight ×1.5); 3 alternative; 4 none.

Lights:
- Sun = DirectionalLight. AmbientLight. Hemi light with sky = sun colour, ground = ambient colour, at ambient intensity.
- `updateHDR`: when sun intensity > 3, ambient drops by up to 20% under the car shadow and lerps toward `shadowCol`.
- `radiance`: ground emissive = texel·radiance (a fake GI lift); trees use radiance/2.
- `fresnelFactor`: ground rim light.
- Env map colours = {colB, colA, grassColA, road} plus sun and ambient ×int/10.

## 8. All Hills palettes

Format: sun col@int; amb col@int; fog A, B, C (near, far, hazeH, hazeI); clouds hi / lo (shelf0/1, scale0/1, mode); water base, body, highlight, underwater; fresnel, radiance.

### SUMMER (bi L148-389)

- **morning clear:** sun 16776421 #FFFCE5 @0.7; amb 7442338 #718FA2 @0.5; fog 16705951 #FEE99F, 10205381 #9BB8C5, 16770698 #FFE68A (0, 1, 80, 0.5); clouds off 15971155 / 7294626 (1600/2000, 4/8, mode 4); water 1321277, 4541263, 11972230, 4539184; 1.15, 4.
- **morning overcast:** sun 8689843 #8498B3 @0.5; amb 9079434 #8A8A8A @1.1; fog 7243430 #6E86A6, 3033195 #2E486B, 856860 #0D131C (0, 1, -120, 0.9); clouds 6391976 / 12574973 (500/800, 14.5/35.5, 0); water 2238256, 3488837, 5727866, 2372679; 0.63, 1.6.
- **day clear:** sun 16776677 #FFFDE5 @6.2; amb 4545128 #455A68 @2.4, shadowCol 6191183 #5E784F; fog 10407935 #9ECFFF, 4292824 #4180D8, 7056383 #6BABFF (0.9, 1, 0, 0); clouds 16777215 / 14404812 (1600/2000, 5/24.5, 0); water 1781318, 5798311, 10079487, 5141666; 1.5, 4.
- **day overcast:** sun 15463423 #EBF3FF @2.3; amb 8224125 #7D7D7D @1.5, shadowCol 7304048; fog A=B 12243187 #BAD0F3, C 6919384 #6994D8 (0.8, 1, 0, 0); clouds 7572128 / 6189949 (1600/2000, 3/18.5); water 2106663, 6055280, 9674676, 4212042; 0.65, 2.
- **evening clear:** sun 16700340 #FED3B4 @1.1; amb 6368773 #612E05 @1.1; fog 16763043 #FFC8A3, 10196907 #9B97AB, 16099220 #F5A794 (0.9, 1, 0, 0); clouds 16755066 / 10706068 (1000/1200, 30.5/12, mode 2); water 2762034, 7165500, 13404774, 7165032; 1.4, 1.
- **evening overcast:** sun 12889819 #C4AEDB @0.7; amb 9857461 #9669B5 @0.7; fog 10062815 #998BDF, B=C 5522053 #544285 (0, 1, 0, 1); clouds 10714570 / 7486659 (500/600, 32.5/22.5, mode 1); water 2303279, 4274788, 8874660, 4669789; 1, 1.
- **night clear:** sun 12045793 @0; amb 4935272 #4B4E68 @0.6; fog 4866096 #4A4030, 1456474 #16395A, 2436146 #252C32 (0.85, 1, 0, 0); clouds off 0 / 6381921 (900/1100, 6/15.5); stars density 2, horizonScale 4; water 922133, 2567471, 4276281, 394758; 0.25, 1; headlights @250.
- **night overcast:** sun 15133426 @0; amb 0 @0.4; fog 855309 #0D0D0D, 1513239 #171717, 0 (0.72, 1, 0, 0); clouds 0 / 6710886 (800/1000, 6/24.5); water 0, 2697513, 2368548, 0; 0, 8; headlights @300.

### SPRING (yi L428-666)

- **morning clear:** sun 16764126 #FFCCDE @0.3; amb 5779826 #583172 @0.3; fog 15510719 #ECACBF, 7643367 #74A0E7, 7039851 #6B6B6B (-0.2, 1, 80, 0.25); clouds 13539268 / 10724259 (1700/2100, 6/24.5); water 4074802, 9461869, 12219272, 5730446; 1, 2.1.
- **morning overcast:** sun 16449520 #FAFFF0 @0.2; amb 5714056 #573088 @0.3; fog 7761778 #766F72, 6248797 #5F595D, 6249811 #5F5D53 (-0.2, 1, -160, 0.11); clouds 7039851 / 7039851; water 3026222, 6249053, 7895160, 2959914; 0.8, 1.
- **day clear:** sun 16710892 #FEFCEC @4; amb 7241810 #6E8052 @1.4; fog 12835822 #C3DBEE, 6202340 #5EA3E4, 11060198 #A8C3E6 (0.9, 1, 0, 0); clouds 16777215 / 14411775 (1900/2200, 7/31.5); water 2369837, 6322826, 9351122, 5730446; 1.6, 2.
- **day overcast:** sun 14668735 #DFD3BF @1.8; amb 0 @1.6; fog 16119285 #F5F5F5, B=C 11382189 #ADADAD (0, 1, -140, 0.11); clouds 15132390 / 14408667 (1900/2200, 6/22.5); water 3946809, 7698554, 14146526, 3751751; 1, 1.
- **evening clear:** sun 11963752 #B68D68 @1; amb 2383492 #245E84 @1; fog A=C 12750433 #C28E61, B 5331036 #51585C (0.6, 1, 100, 0.3); clouds 15505503 / 7495243 (3000/4500, 11/24.5); water 3814705, 9991517, 13146244, 6834743; 0.75, 1; headlights @100.
- **evening overcast:** sun 16769750 #FFE2D6 @0.25; amb 409414 #063F46 @0.6; fog A=B 8878451 #877973, C 4733491 #483A33 (0, 1, -140, 0.4); clouds 6710886 / 4342338; water 2763048, 5788240, 7826278, 2368291; 0.6, 1.
- **night clear:** sun 4088436 #3E6274 @1; amb 5251591 #502207 @1.5; fog 7162935 #6D4C37, 531510 #081C36, 5783085 #583E2D (0.8, 1, 0, 0); stars density 1, horizonOffset 1, horizonScale 8; water 1052689, 2106413, 4338734, 394758; 0.5, 1.
- **night overcast:** sun=amb 9737364 #949494 @0.2/0.3; fog 2368548 #242424, 1184274 #121212, 0 (-0.2, 1, 0, 0); clouds 8882055 / 9737364 (1200/1500, 37.5/20.5); water 855309, 2500134, 3026478, 394758; 0.25, 1.

### AUTUMN (Vi L721-945)

- **morning clear:** sun 15464447 #EBF7FF @1.2; amb 467510 #072236 @1; fog 14868181 #E2DED5, 9163518 #8BD2FE, 12773631 #C2E8FF (0, 1, 80, 0.5); clouds off 14132156 / 12546950 (1000/1100, 10/13, mode 5); water 3159350, 5469055, 12377308, 5730446; 1.5, 2.
- **morning overcast:** sun 16775152 #FFF7F0 @0.7; amb 866664 #0D3968 @0.3; fog 10592673 #A1A1A1, 3552822 #363636, 6184542 #5E5E5E (0, 1, -120, 0.4); clouds 13619151 / 8224125 (1600/1300, 3/23.5); water 2171169, 5395026, 8882055, 2368548; 0.5, 0.5.
- **day clear:** sun 16775141 #FFF7E5 @4.4; amb 994637 #0F2D4D @1.2; fog A=C 13230067 #C9DFF3, B 2651589 #2875C5 (0, 1, 60, 0.22); clouds 16777215 / 16777215 (1600/1300, 2/42); water 796455, 4811395, 10864353, 5730446; 0.9, 2.5.
- **day overcast:** sun 16775152 @1.9; amb 3682606 #38312E @1; fog 12763842 #C2C2C2, 6052956 #5C5C5C, 6184542 (0.25, 1, -380, 0.4); clouds 13619151 / 8224125; water 2171169, 7039851, 10723225, 2368548; 0.95, 0.5.
- **evening clear:** sun 11186363 #AAB0BB @1.4; amb 0 @2; fog 15185783 #E7B777, 9017254 #8997A6, 7234651 #6E645B (0.9, 1, 0, 0); clouds 7106933 / 6841956 (1100/1300, 4/16.5); water 2106151, 5986898, 13348228, 4215400; 1.25, 1.5.
- **evening overcast:** sun 9272992 #8D7EA0 @1; amb 3351113 #332249 @2; fog 9008547 #8975A3, 4797286 #493366, 3877457 #3B2A51 (0, 1, -140, 0.25); clouds 3813955 / 4788371 (1600/1300, 6/42); water 1973282, 5787237, 8811168, 2431793; 1, 0.1.
- **night clear:** sun 4541022 #454A5E @0.4; amb 5984360 #5B5068 @0.5; fog A=C 2564401 #272131, B 525833 #080609 (0.9, 1, 0, 0); stars 2; water 0, 2697003, 3289142, 2697003; 0, 0.
- **night overcast:** sun 4541022 @0.8; amb 4340299 #423A4B @0.8; fog 1381139 #151313, 2630949 #282525, 2564401 (0, far 0.5, -60, 1); clouds 5855577 / 5261641; water 0, 2959914, 2565413, 0.

### WINTER (mo L1003-1270)

- **morning clear:** sun 8295876 #7E95C4 @1.9; amb 4803147 #494A4B @1.9; fog 16634011 #FDD09B, 5666463 #56769F, 8882839 #878A97 (0, 1, 0, 0); clouds 16742190 / 11024058 (1000/1100, 10/15); water 4011839, 12359828, 12692106, 5730446; 1.25, 1.08.
- **morning overcast:** sun 2718601 #297B89 @0.5; amb 5073519 #4D6A6F @0.8; fog A=C 879229 #0D6A7D, B 541519 #08434F (0, 0.71, 240, 0.66); clouds 5086636 / 4563637 (1800/2200, 8/26.5); snow 0.5; water 1185303, 1913141, 4487811, 13750737; 1, 1.93.
- **day clear:** sun 14479358 #DCEFFE @1.5; amb 10656918 #A29C96 @1.5; fog 16186366 #F6FBFE, 3514851 #35A1E3, 12763842 #C2C2C2 (0, 1, 100, 0.3); clouds 16777215 / 14535884 (1000/1100, 10/5, mode 4); snow 0; water 2303012, 8755613, 10860741, 7039851; fresnel 3, radiance 1.
- **day overcast:** sun 12699622 #C1C7E6 @1.2; amb 8095379 #7B8693 @1; fog A=C 12567775 #BFC4DF, B 8948901 #888CA5 (-0.2, 0.8, 120, 0.42); clouds 11053491 / 12764108 (1000/1200, 12/24.5); snow 1; water 789517, 1973791, 8158595, 12567775; 0.5, 2.
- **evening clear:** sun 8296900 #7E99C4 @0.7; amb 6118257 #5D5B71 @0.5; fog 11561352 #B06988, 13680046 #D0BDAE, C 9371698 (unused) (-0.2, 1, 80, 0); clouds off, mode 5; water 2039583, 5919574, 10840443, 5730446; 0.75, 0.
- **evening overcast:** sun 10724259 #A3A3A3 @0.5; amb 7237230 #6E6E6E @0.7; fog 7634049 #747C81, 4079681 #3E4041, 8224125 (0, 1, -100, 0.73); clouds 7039851 / 16777215 (1800/2200, 4/37.5); snow 0.5; water 2433571, 7896189, 8424078, 5730446; 1, 2.5.
- **night clear:** sun and amb 16777215 @0.04/0.05; fog A=C 1779767 #1B2837, B 264208 #040810 (0.9, 1, 0, 0); stars 2, horizonScale 2; water 0, 2239285, 2699064, 1776669; 0.26, 4.
- **night overcast:** sun 14083839 #D6E6FF @0.06; amb 16777215 @0.05; fog A=C 1907739 #1D1C1B, B 6052956 (-0.2, 1, -60, 0.5); clouds 1907739 / 1907739; snow 1; water 0, 2368547, 2565670, 1907739.

For us, relationships to keep:
- day-clear sun 4–6 with ambient 1.2–2.4;
- clear fog near 0.9 vs 0–0.25 overcast;
- colB (zenith) more saturated blue than colA;
- warm-dark evening ambient against a pink/orange colC;
- winter day: near-white fog A #F6FBFE, crisp blue B #35A1E3, fresnel 3 (snow glare).

## 9. Coast/Cali scene palette (summer only)

Ground tints:
- dirtColA 12294278 #BB9886, dirtColB 8877416 #877568
- grassColA 13807517 #D2AF9D, grassColB 12167576 #B9A998
- shrubColA 11052214 #A8A4B6, shrubColB 11638145 #B19581
- brushColA/AD 8166543 #7C9C8F, brushColB/BD 10532716 #A0B76C, brushColC 16690561 #FEAD81

The shader mixes these by noise and `vDry`. Water adds shallows, shore and surf colours. Examples:
- day clear: sun 16707799 @8, amb 3956082 @3.1, fog 12841726 / 684287 / 684287 (near 0.2), fresnel 2.5, radiance 6.
- morning clear: sun 16768977 @2.2, fog 14611191 / 8237514 / 11714242, sceneBrightness 1.3.
- evening clear: sun 14470337 @1.4, fog 16234381 / 8222610 / 16745830, mode 2, sceneBrightness 1.6.

For us: a better template for dry late-summer fields than the Hills 4-colour model.

## 10. OffWorld

- **Mars:** groundA 14327404 #DA9E6C, groundB 7684890, groundC 10453871, cliff 9005650, rubble 16369306, road 9992279.
  - day: sun 16770503 @5.6, amb 8021330 @5.3, fog 15845006 / 10129524 (0.8, 1, 400, 0.2), dust 9923145.
  - night: dust 1446930.
- **Moon:** groundA white, groundC 12434877, road 11382189; sun 16316663 @4.5; fog black with hazeIntensity -0.75; sceneBrightness 1.4; earthrise.
- **Venus:** groundA 7368816, road 4539717; fog and clouds all 12628518; fresnel -0.5.
- Gravel surfaces only; no traffic; off-road-only.

## 11. Scene config options

- **Scenes** Vs: Hills 0, Coast 1, Woods 2, Alps 3, Autobahn 4, OffWorld 5, Driftmas 6. Class table Or = [Wo, pM, Wo, Wo, Wo, Oc, Wo]: only Hills, Coast (Cali) and OffWorld are distinct. This edition offers [0, 1, 5].
- **Road style** Gm: Straight, Casual, Normal (default), Winding, Dev. Parameters per style:
  - Straight: maxGrad 0.2; heightmap scale 80 / offset 90, layers [3,21,17,31]; treemap 3 / 1.7.
  - Casual: maxGrad 0.16, feelDist 30; heightmap 110 / 110, [3,9,17]; treemap 0.6 / 2.2.
  - Normal: maxGrad 0.12, maxTurnDelta 0.2; heightmap 75 / 105, [3,11,5,27], temperMin 0.7; treemap 0.5 / 2.6.
  - Winding: roadSink 0.4, smoothFactor 0.75; heightmap 60 / 100, [3,9,13,27,31]; treemap 0.75 / 2.75.
  - Dev: flat (scale 0).
- **Lane style** Hm: OffRoadWide, OffRoad, Single, SingleWide, Standard (default), TwoLane, ThreeLane, FourLane.
  - Lanes per direction [0,0,0,0,1,2,3,4].
  - Widths: single 3.6 / wide 7.2; compound 3.4 / wide 4.
  - OffRoad sets greenlane (a grass strip in the middle); OffRoad* sets the offroad mask.
  - Icons `road_{paved|paved_narrow|dirt|dirt_narrow}_{straight|casual|normal|winding}.svg`.
- **Graphics viewDistance tiers:** tileSize 240 / 480 / 840 / 1500 / 2000 / 2500; lod0 50–160; lod1 13–28; cloud altitude 400–800; imposter instances 400–16000.
- **Detail tiers:** shadowRes 256–2048; grass density 0–0.85.
- **Defaults:** Hills / Normal / Standard, summer / day / clear.

## 12. Takeaways for renderer v2, by look impact

1. 3-colour distance fog with (d/far)² haze and desaturation, and per-style near/far/haze values.
2. Greyscale ground tinted by 4 season colours through noise and altitude; winter swaps in white and turns off sand, gravel and tall grass.
3. Per-season imposter and tree atlases, plus the 256 m leaf-noise tint.
4. Snow on trees via normal·up; a winter road with wheel tracks and no paint.
5. Road overlays (autumn leaves, spring moss) weighted by tree shade.
6. Camera-box snowfall with headlight-lit flakes, and wheel spray.
7. A crossfade between styles, which slowroads lacks.
8. Rain, wet roads and puddles are absent in slowroads; they would be our own design.