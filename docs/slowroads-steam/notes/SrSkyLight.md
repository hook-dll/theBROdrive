# SrSkyLight.md

## Summary

slowroads (Steam build, three r155) has no physical sky and no post-processing. Its whole atmosphere comes from one custom 3-colour fog model applied to every material: a camera-attached sky plane is simply 100% fogged. Clouds are one flat, curved plane per scene (two parallax UV layers over one alpha-noise texture) blended into that fog gradient. There is no sun disc and no moon in the earth scenes. Time of day is 4 discrete presets (morning/day/evening/night) × 2 weathers (clear/overcast) × 4 seasons, not a sun path. The DirectionalLight always sits straight overhead (offset 0,10,0), and its real shadow map covers only a ±vehicle-size frustum. Terrain and tree shadows are baked vertex attributes. Terrain is MeshLambert with heavy onBeforeCompile patches: a grazing-angle 'fresnel' sheen, a 'radiance' boost of direct sun, and haze/desaturation. Tone mapping is CineonToneMapping (id 3) at exposure 1. The only anti-aliasing is native MSAA (antialias:true), plus an adjustable render scale.


## Architecture

Per frame: one renderer.render(scene, camera) into the default MSAA framebuffer. Output is sRGB, CineonToneMapping, exposure 1. Opaque draw order is forced with renderOrder: sky plane (-10, camera child at z=-(far-0.1), 1e6×1e5, MeshBasic white + fog) → cloud plane (-9, MeshBasic + fog, depthTest off, DoubleSide, follows camera xz at y=cloudAltitude) → stars (-5 meshes / -2 container, THREE.Points, depthTest off) → world. Mirror render targets are drawn after the main pass in interior view only. Every world material shares one patched fog chunk: colour = mix(desat+hazeTint(base), mix(colA,colB,elevationBlend), fogDepth + hazeTerm). The sky therefore IS the fog colour at full depth, and clouds overlay the same gradient. Lighting: 1 DirectionalLight (always 10 m straight above the car; shadow map covers car-sized ortho box only) + AmbientLight + HemisphereLight (sky = sun colour, ground = black in Hills). Terrain and foliage are MeshLambert with a baked per-vertex 'shadow' attribute that scales direct light (1-s) and ambient (0.75..1). A 64px greyscale env cube is remapped through a sky/horizon/ground gradient for car reflections. Presets (season × time × weather) swap every colour and intensity instantly; nothing interpolates continuously.


## Files

- /tmp/slowroads/pretty/chunks/DevMidlineGenerator.d99584e3.js: L310-536: the fog chunks (pars_vertex / vertex / pars_fragment / fragment) used by every world material: cylindrical distance, EXP2 near-remap, pNoise haze height, positive/negative hazeHeight, desaturation, 3-colour mix.
- /tmp/slowroads/pretty/chunks/HillsHeightmap.b6172a83.js: Seasonal countryside scene data. bi=summer L164-398, yi=spring L441-660, Vi=autumn L722-945, mo=winter L1005-1242: lights/fog/clouds/stars/snow per time×weather. graphics.viewDistance/detail tiers L1484-1640. Cloud shader L1650-2005. Ground Lambert fresnel L2680-2705, radiance L2660. Custom Lambert RE_Direct L4330-4365. Style→uniform hookup L4880-4917, view-distance→fog L5610-5641, style→fog vars L5711-5745. Sky material hills_sky L5054, cloud material L5056+.
- /tmp/slowroads/pretty/chunks/SceneConfigCol.svelte_svelte_type_style_lang.0ec95a19.js: Hills scene class: updateSky L49650-49680 (sun/ambient/hemi, fog class choice), initialise L49700-49750 (sky plane 1e6×1e5 renderOrder -10, cloud plane -9, stars 4000/2), sun shadow setup L49800-49812, haze-follow-camera L50095-50113, updateHDR L50135. Stars shader + class L45235-45360.
- /tmp/slowroads/pretty/chunks/CaliMidlineGenerator.7dfc1747.js: Coastal 'Cali' scene presets L145-440 (summer only; clouds modes 0/1/2). Cloud shader text L884-1180 (all 5 modes). Sky/cloud materials L6003-6040. View/fog variables L6544-6679 (fog near/far = viewDist×preset, density sqrt(5)/far).
- /tmp/slowroads/pretty/chunks/2.7f7e25dd.js: Main page. Renderer creation L8636-8670 (antialias, high-performance, toneMapping=Cineon, shadowMap on). renderLive L8821 (single render() + mirrors, no composer). Cali scene class pM L7527-8210: updateSky, updateHDR (green ambient under trees), sunOffset (0,10,0), shadow ±4/near .5/far 50/radius 5. Offworld (moon/mars/venus) scene data L2934-3170, earthrise plane L4559, stars 1e5/3.
- /tmp/slowroads/pretty/chunks/normals.f63d4883.js: three r155 core. Tone-mapping constants L51-58 (lg=3=Cineon). Custom Fog/FogExp2 classes with colorA/B/C + haze L17628-17685. Fog uniforms L10309-10314. Env gradient cube + IBL override L24329-24530. Baked-shadow lights_fragment_begin_shadow L24700-25136. Graphics settings (render scale [0.5,.75,1,1.5,2], shadow sizes [256,512,1024,2048], defaults) L34450-34500. Additive glow sprites L38407-38530. Mirror RT config L38200-38260.
- /tmp/slowroads/app/build/_app/immutable/assets/clouds_01.700a3fdb.webp: Earth cloud texture, 512×512, tileable. RGB is near-white with faint mottling. The shader reads only .a, so the cloud density lives in alpha (the image viewer flattens alpha).
- /tmp/slowroads/app/build/_app/immutable/assets/moon_earthrise.83efb4ea.webp: About 270px photo of Earth (Apollo-style, lower-left in shadow) on transparent background. Used only as a 10×10 billboard in the offworld Moon scene.
- /tmp/slowroads/app/build/_app/immutable/assets/moon.82740ed8.svg: 24px Material crescent icon (#FFF). A UI icon for the world picker, not a sky object. mars.svg and venus.svg are the same kind of icon.


# slowroads: sky, clouds, stars, lighting, fog/haze, tone mapping, post (Steam build, three r155)

The main scene for us is **Hills**, the seasonal countryside (spring, summer, autumn, winter), in `chunks/HillsHeightmap*.js` plus the class in `SceneConfigCol*.js`. **Cali** (coastal, summer only, in `CaliMidlineGenerator*.js` plus class `pM` in `2*.js`) is nearly identical. Colours below are converted from the decimal hex in the source.

---

## 1. The atmosphere is one fog model; the sky is just fully fogged geometry (largest visual impact)

**Fog classes** (`normals*.js` L17628-17685). `Fog` and `FogExp2` are replaced with versions that carry `colorA` (horizon), `colorB` (zenith), `colorC` (haze tint), `near`, `far`, `density`, `hazeHeight` and `hazeIntensity`. The uniforms are `fogColorA/B/C`, `fogNear`, `fogFar`, `fogDensity`, `hazeHeight` and `hazeIntensity` (L10309-10314, refreshed at L16234).

**Fog vertex chunk** (`DevMidlineGenerator*.js` L372-474), per vertex:
- **Cylindrical distance.** `d = distance(worldPos, cameraPosition)`, not view-space z. The world position has the floating origin offset subtracted.
- **Haze and desaturation.** `vDesat = min(1, d/fogFar)` and `vHaze = vDesat²`. Both are scaled by `1+min(0,hazeIntensity)`, so a negative hazeIntensity weakens them.
- **Fog amount.**
  - EXP2 path: `d' = max(0,(d-near))·far/(far-near)`, then `fog = 1-exp(-(density·d')²)`, with `density = sqrt(5)/far`. At d=far the fog is 1-e⁻⁵ ≈ 0.993.
  - Linear path: `smoothstep(near, far, d)`.
- **Noise on the haze height** (EXP2 path only). `fogHeight = y + pNoise(xz/2, 3 octaves)⁴ · hazeHeight`, scaled by d/1000 inside 1 km. pNoise is value noise with cosine interpolation, base frequency 4 (cell size 1024/4 m), and the result raised to the 4th power.
- **Positive hazeHeight = valley or ground haze.** If `min(camY, fogHeight) < hazeHeight`, add `(1 - h/hazeHeight)·hazeIntensity` to the fog amount. This is faded out within 50 m of the camera: `×(1-(1-d/50)²)`.
- **Negative hazeHeight = low cloud on the hills** (overcast). Add `min(1, max(camY, fogHeight)/-hazeHeight)·hazeIntensity`, faded within `haze·100` m of the camera.
- **vFogBlend.** Normally 1. If `(near+far)/2 < 500` it becomes `(avg-50)/450` (0 below 50 m), so a short fog kills the sky gradient. It is multiplied by `(1-hazeIntensity)` when hazeHeight < 0.
- The fog amount is clamped to 1.

**Fog fragment chunk** (L517-534). Three steps, in order:
1. Desaturate the lit colour by `vDesat` (luma 0.299/0.587/0.114).
2. `mix(→ colC, vHaze)`: distant things tint toward the haze colour quadratically.
3. `mix(→ mix(colA, colB, fogBlend), fogAmount)`, where `fogBlend = max(2·(y-camY)/d, 0)·vFogBlend`. This is 2·sin(elevation): 0 at the horizon, 1 at 30° up, and **unclamped** above that, so `mix` extrapolates past colB and the zenith gets deeper than colB before output clamping.

**Sky** (`SceneConfigCol*.js` L49720-49726; Cali `2*.js` L7760-7766). A 1×1 PlaneGeometry scaled to 1e6×1e5, parented to the camera at z = -(far-0.1), with renderOrder -10 and frustumCulled off. Its material is `MeshBasicMaterial` (white, fog:true, toneMapped:true, cache key `hills_sky`, L5054). Because it sits at the far distance, its fog amount is about 1, so the pixel is exactly `mix(colA, colB, 2·sinElev)` after full desaturation and colC tint. **No sun disc, no Mie halo, no scattering math.** A grep for sunDir/sunPos in any shader finds nothing.

**How near/far are set** (`HillsHeightmap*.js` L5610-5620 and L5711-5730):
- `viewDist = tileSize·2` (×0.75 if tileSize < 300).
- `fog.near = viewDist·preset.near` and `fog.far = viewDist·preset.far`. preset.far is always 1; preset.near ranges from -0.2 to 0.9.
- `density = sqrt(5/far²)`.
- The fog class depends on graphics detail: detail > 2 (VeryHigh/Ultra) uses **FogExp2 plus noisy haze**; lower detail uses linear smoothstep and **no haze noise**.
- Haze follows the camera (`SceneConfigCol*.js` L50095-50113): if camY < hazeHeight+10, hazeHeight is temporarily scaled ×(1+2l²) so the camera never sees the layer's edge.
- A small-view-distance correction (`fr()` L5705): if hazeIntensity ≤ 0 and viewDist < 2000, it is rescaled toward -1.

**Example fog presets (Hills, summer)**. near is a fraction of the view distance.

| preset | colA horizon | colB zenith | colC haze | near | hazeH / hazeI |
|---|---|---|---|---|---|
| morning clear | #FEE99F | #9BB8C5 | #FFE68A | 0 | 80 / 0.5 |
| morning overcast | #6E86A6 | #2E486B | #0D131C | 0 | -120 / 0.9 |
| day clear | #9ECFFF | #4180D8 | #6BABFF | 0.9 | 0 / 0 |
| day overcast | #BAD0F3 | #BAD0F3 | #6995D8 | 0.8 | 0 / 0 |
| evening clear | #FFC8A3 | #9B97AB | #F5A794 | 0.9 | 0 / 0 |
| evening overcast | #998BDF | #544385 | #544385 | 0 | 0 / 1 |
| night clear | #4A4030 | #16395A | #252C32 | 0.85 | 0 / 0 |

Other seasons use the same structure. Spring morning clear: #ECABBF → #74A0E7, near -0.2, haze 80/0.25. Spring evening clear: #C28E61 / #51585C, haze 100/0.3. Autumn and winter overcast use negative haze of -140 to -380.

**For us:**
- Adopt the 3-colour fog as the single source of atmosphere and let the sky be a fogged far plane (or a dome with the same formula).
- The look depends mainly on four things:
  1. **Aerial perspective in three stages**: desaturate linearly with d/far, tint to colC with (d/far)², then fog to the elevation gradient.
  2. **Cylindrical distance.**
  3. **Clear days have no fog until 80-90% of view distance, then a hard EXP2 ramp.** This gives a crisp mid-ground and a hazy horizon band.
  4. **Horizon colour ≠ zenith colour, reaching zenith by 30° elevation.**
- Add ground haze with noisy height (valley mist for central-Russia mornings) and negative-height "hilltops in cloud" for overcast.
- Our seasons × time × weather table should carry colA/colB/colC/near/hazeHeight/hazeIntensity per cell.
- Unlike slowroads, interpolate between cells for continuous time of day. They snap presets.

---

## 2. Clouds: one curved plane, two parallax shelves, one alpha-noise texture

**Texture.** `clouds_01.700a3fdb.webp`, 512×512, tileable. The RGB is near-white with faint mottling; density is in alpha (the shader reads only `.a`). It is loaded with anisotropy 4 in linear/no colour space (`HillsHeightmap*.js` L4887). The offworld copy `clouds_01.ab586e6c.webp` is similar.

**Mesh** (`SceneConfigCol*.js` L49727-49733):
- `PlaneGeometry(1,1,N,N)` scaled to `cloudScale`, rotated x = π/2, renderOrder -9, frustumCulled off.
- Each frame it is positioned at camera xz, y = cloudAltitude, and `time += dt·2` (`2*.js` L8097-8102).
- Hidden when graphics detail = 0 or preset `hasClouds:false`.
- Material: MeshBasic white, fog:true, **depthTest:false**, DoubleSide, toneMapped (L5056).

**Vertex** (L1680-1730):
- `dist = max(0, 1 - radialUV)` (Cali ×2, so the fade ends halfway).
- Edges are bent down by `(1-dist)²·altitude·0.5`, forming a dome that meets the horizon.
- Layer A: `uvA = (worldXZ + time)/(skyScale0·altitude)`.
- Layer B imitates a higher shelf:
  - `h0 = shelfHeight0-camY` and `h1 = shelfHeight1-camY`.
  - `uvB = (worldXZ + camXZ·(h1-h0)/h0) / (skyScale1·altitude·h1/h0) + time/scale1`. This is true parallax between the two heights.
  - Layer C = uvB + (0.001, -0.001), an offset copy used as fake self-shadow/highlight.
- The fog chunk is swapped: `vFogDepth = fogFar`, so the plane itself is always 100% fog colour and is invisible except where clouds are drawn.

**Fragment, mode 0** (used by almost all presets):
- `ic = screen(aA, aB)·aC`
- `col = mix(lowlight, highlight, aC·ic)`
- `out = mix(skyFogColour, col, ic·min(1, fogBlend)·dist)`

The `fogBlend` factor makes clouds fade in over 0-30° elevation and vanish at the horizon.

Other modes:
- Mode 1 (evening overcast): screen alpha with dist².
- Mode 2 (evening clear): "two-tone". aB is remapped to 0.25..1, aC to 0..0.5, and `highlight·1.5·aC·2dist` ("more pink above").
- Mode 3: max-based.
- Mode 4: empty (morning clear has clouds off).

**Sunset lighting** is entirely preset colours, not the sun direction. Summer evening clear: highlight #FFA97A, lowlight #A35C94, mode 2, shelves 1000/1200 m, skyScale 30.5/12. Day clear: highlight #FFFFFF, lowlight #DBCCCC, shelves 1600/2000, skyScale 5/24.5. With altitude 600 that gives layer periods of about 3 km and about 18 km. Overcast morning uses a low 500/800 m shelf.

**Tiers** (`graphics.viewDistance`, Low → UltraPlus):

| tier | cloudAltitude (m) | cloudScale (m) | segments = max(20, scale/400) |
|---|---|---|---|
| Low | 400 | 1200 | 20 |
| Medium | 500 | 3600 | 20 |
| High | 600 | 7000 | 20 |
| VeryHigh | 600 | 11000 | 27.5 |
| Ultra | 700 | 15000 | 37.5 |
| UltraPlus | 800 | 22000 | 55 |

Camera far = max(viewDist, cloudScale).

**For us:**
- A cheap, convincing cloud deck: one curved plane following the camera, blended into the fog gradient.
- Two noise layers at different virtual heights with real camera parallax, plus an offset third sample for fake shading.
- Radial fade and elevation fade so clouds never meet the terrain horizon.
- Wind drift of about 2 m/s.
- Drive colours from the time-of-day table (highlight/lowlight). The pink/orange underside at dusk comes from a pink lowlight plus a warm highlight, not from lighting.
- We can improve on it with a sun-direction term in the highlight, but keep the fog-overlay principle.

---

## 3. Time of day and lighting values

**Discrete presets only.** `season ∈ {spring, summer, autumn, winter}` × `time ∈ {morning, day, evening, night}` × `weather ∈ {clear, overcast}` (`HillsHeightmap*.js` L1243-1286). `updateSky()` sets everything instantly. **There is no sun path:** `sunOffset = (0,10,0)` in both earth scenes (`SceneConfigCol*.js` L49704; `2*.js` L7746). The DirectionalLight always sits 10 m above the car, so terrain shading is pure N·up. Offworld presets use offsets such as (-4,10,-4).

**Lights** (L49656-49664):
- `DirectionalLight(col = sun.col, I = sun.intensity)`.
- `AmbientLight(ambient.col, ambient.intensity)`.
- `HemisphereLight(sky = sun.col, ground = 0x000000, I = ambient.intensity)`. Cali uses ground = ambient colour.
- Renderer `useLegacyLights = false` (r155 physical units), so the diffuse contribution is roughly I/π relative to legacy.

**Summer (Hills) values:**

| preset | sun col / I | ambient col / I | fresnel | radiance |
|---|---|---|---|---|
| morning clear | #FFFCE5 / 0.7 | #718FA2 / 0.5 | 1.15 | 4 |
| morning overcast | #8497B3 / 0.5 | #8A8A8A / 1.1 | 0.63 | 1.6 |
| day clear | #FFFDE5 / 6.2 | #455A68 / 2.4 (shadowCol #5E784F) | 1.5 | 4 |
| day overcast | #EBF1FF / 2.3 | #7D7D7D / 1.5 | 0.65 | 2 |
| evening clear | #FED3B4 / 1.1 | #612E05 / 1.1 | 1.4 | 1 |
| evening overcast | #C4ADDB / 0.7 | #9669B5 / 0.7 | 1 | 1 |
| night clear | #B7CDE1 / 0 | #4B4E68 / 0.6 | 0.25 | 1 |
| night overcast | #E6EAF2 / 0 | #000000 / 0.4 | 0 | 8 |

Headlights at night: 250-300 (10-100 by day). Winter day clear: sun #DCEFFE 1.5, ambient #A29C96 1.5, fresnel 3. Winter night: sun 0.04, ambient 0.05.

**updateHDR** (L50135):
- When sun I > 3, ambient is reduced by up to 20% as the car enters tree shade (`curVehicleShadow`).
- If the preset has `shadowCol`, the ambient colour is lerped toward green #537E30 under the canopy.

**Terrain lighting tricks** (these matter a lot for the look):
- **Baked shadow** (`normals*.js` L24730, L24783; `lights_fragment_begin_shadow`). A per-vertex `shadow` attribute (trees and road-side, computed on the CPU):
  - direct light × (1 - min(1, s))
  - ambient × (1.75 - clamp(s, 0.75, 1)), i.e. 1.0 when lit and 0.75 when fully shaded
  - `shadowFactor` preset: 0.8-0.9
- **Grazing-angle sheen** (`HillsHeightmap*.js` L2685-2702). `f = 1 - N·V`.
  - `light = (max(0, f-0.75)·4)²·(1-s)·fresnelFactor`
  - `dark = 0.25 + min(0.25, max(0, (1-min(1, f·1.333))·fresnelFactor - 0.25)·0.5)`
  - `diffuse ×= 1 + light - dark`
  - Effect: slopes facing the camera are darkened by 25-50% and grazing slopes glow. This produces the soft "velvet hills" look.
- **"radiance".** The emissive is set to `albedo·radiance`, and the output line is patched to `direct + indirect + direct·emissive`. Direct sun is effectively multiplied by (1 + radiance·albedo), which raises sunlit-vs-shade contrast without touching shadows. Trees use radiance/2.
- **Spot-light (headlight) variant.** `N·L` is replaced by `0.1 + 0.1·(1-|N·L|)` so headlights light terrain flatly.

**For us:**
- Keep the parameter set per preset (sun col/I, ambient col/I, hemi = sun colour over black, fresnel, radiance, shadowFactor).
- Use a real sun direction and interpolate.
- The most look-defining pieces to copy as techniques:
  1. The grazing-angle sheen/darkening on terrain.
  2. The direct-only "radiance" boost.
  3. Baked soft forest shadows that cut direct light fully and ambient by only 25%.
  4. A green ambient tint under canopy.

---

## 4. Shadows and renderer settings

**Renderer** (`2*.js` L8636-8670):
- `WebGLRenderer({antialias:true, powerPreference:'high-performance', stencil:false, logarithmicDepthBuffer:false})`. The log-depth flag comes from `L8 = false` in `SceneConfigCol*.js` L265.
- `toneMapping = 3` (**CineonToneMapping**; constants at `normals*.js` L51-58: 0 None, 1 Linear, 2 Reinhard, 3 Cineon, 4 ACES).
- `toneMappingExposure` left at 1. `outputColorSpace` sRGB. `shadowMap.enabled = true`, type left at the default PCFShadowMap.
- Clear colour #444444, hidden behind the sky plane.
- The render loop is a single `renderer.render(scene, camera)`, plus three mirror render targets in interior view (L8821-8829).

**Pixel ratio.** `devicePixelRatio × [0.5, 0.75, 1, 1.5, 2][renderScale]`, default index 2 (= 1×DPR), or a native-DPR toggle (`normals*.js` L34451, `2*.js` L8577).

**Sun shadow** (`SceneConfigCol*.js` L49800-49812):
- castShadow, `radius = 5`, ortho ±4 m (then ±`vehicle.shadowMapSize`), near 0.5, far 50.
- The target is the car, so **only the car casts a real-time shadow**, straight down.
- `mapSize = [256, 512, 1024, 2048][shadowDetail]`, where shadowDetail is Low/Medium/High, default Medium = 512.
- The detail tiers also list `shadowRes` 256/512/1024/2048/2048, stored but not applied to the sun as far as I traced.

**Mirrors.** Render targets of 256×128 (Medium), 512×256 (High), with fov 16, far 200/500/1000 m, at half framerate.

**Camera.** Vertical FOV default 68 (40-80), far = max(viewDist, cloudScale).

**Graphics defaults.** viewDistance High, detail High (Medium on touch devices). Six view tiers:

| tier | tileSize | view distance (m) | lod0Horizon |
|---|---|---|---|
| Low | 240 | 360 | 50 |
| Medium | 480 | 960 | 80 |
| High | 840 | 1680 | 100 |
| VeryHigh | 1500 | 3000 | 120 |
| Ultra | 2000 | 4000 | 140 |
| UltraPlus | 2500 | 5000 | 160 |

Five detail tiers set grass density 0 / 0.5 / 0.65 / 0.75 / 0.85 and turn on EXP2 fog plus haze noise above High.

**For us:**
- MSAA on the default framebuffer, no composer, render scale as the main performance knob.
- Their shadows are a baked-attribute design. If we want real sun shadows (we have a sun path), use a cascaded or single short-range map, but keep baked forest AO/shadow for distance.
- Log depth is not needed at a 5 km far plane.

---

## 5. Tone mapping, exposure, colour grading, post

- **Operator:** three's OptimizedCineon: `x = max(0, e·c - 0.004)`, `((x(6.2x+0.5))/(x(6.2x+1.7)+0.06))^2.2`, with exposure e = 1, never changed.
  - It is a punchy, contrasty filmic curve that rolls off highlights early; linear 1.0 maps to about 0.68 before sRGB encoding.
  - That is why sun intensities are high (4-8) and preset hexes look saturated in code but read softer on screen.
  - The sky, clouds and stars are tone-mapped too.
- **Colour grading:** none as a pass. All grading is baked into preset colours plus the fog desaturation.
- **Post:** none. No EffectComposer, bloom, SSAO, vignette or FXAA/SMAA in JS; grep finds no ShaderPass or RenderPass. The CSS was not checked for vignettes.
- **Fake bloom:** instanced additive (`blending = 2`) camera-facing glow quads for lamps and car lights (`normals*.js` L38407-38530).
  - Alpha = `smoothstep(0.5, 0, r)²` × incidence × distance fade (fadeIn 150 m).
  - Offset toward the camera.
  - `brightness = 1 - clamp(sceneBrightness - 0.25)`, so glows disappear by day. sceneBrightness is a crude scalar: sun.col/0xFFFFFF·I + amb.col/0xFFFFFF·I, or a preset override of 1.3-1.6.

**For us:**
- If we tune presets by eye, pick one operator early and tune every colour against it. slowroads colours are tuned for Cineon, so reuse them only as relative guidance or keep Cineon.
- We can get their look with no post. Add cheap additive glow sprites for lamps and headlights at dusk and night instead of bloom.

---

## 6. Stars, moon, planets

**Stars** (`SceneConfigCol*.js` L45235-45360):
- `THREE.Points` with PointsMaterial, size 0.01, sizeAttenuation on, depthTest off, fog on.
- Points at random directions on a radius-10 sphere, with y mirrored to the upper hemisphere. The whole set follows the camera position.
- 4000 points split into 2 layers; `density` 1-2 picks how many layers are visible. The offworld scene uses 1e5 in 3 layers.
- Per-point `glow = r²`, with bright ones (r > 0.75) halved 80% of the time.
- **Colour = min(1, fogColorB + glow)**, i.e. additive over the zenith colour.
- Horizon fade: `mix(fogColorA, star, clamp((y - horizonOffset)/horizonScale, horizonOpacity, 1))`. Night presets use offset 0-1 and scale 2-8 (in radius units of 10), so stars fade over roughly the lowest 12-50°.
- renderOrder -5 (container -2).
- Visible when the preset has `stars` (clear nights only).
- About 1 px on screen.

**Moon/sun:** none drawn in earth scenes. `moon.svg`, `mars.svg` and `venus.svg` are 24px white Material-style UI icons for the planet selector.

**Earthrise:** `moon_earthrise.webp` (about 270px photo of Earth, half in shadow, transparent background). It is a 10×10 plane with MeshBasic, depthTest off, fog off, alphaTest 0.5, placed at camera + (50, 25, -100) in the Moon scene and rotated π for the night variant (`2*.js` L2760, L3389, L4559).

**For us:**
- Stars as tiny additive points tinted from the zenith colour with a horizon fade is enough.
- We need a real moon disc and a sun disc/halo (central Russia at dusk). slowroads offers nothing to copy here; its sunsets are sold purely by the horizon colour, cloud colours and a warm haze colC.

---

## 7. Environment / reflections

`scene.environment` is a CubeTexture of six 64px canvases (`normals*.js` L24329-24420):
- Top: radial white → #e0e0e0.
- Sides: vertical gradient #e0e0e0 → #404040.
- Bottom: radial black → #404040.

The patched `envmap_physical_pars_fragment` samples only `.r` and uses it as the v coordinate into a 64px **gradient texture** painted per preset (`a_()` L24372):

| stop | colour | brightness multiplier |
|---|---|---|
| 0 | sky = fog colB | ×(0.75+0.25e) |
| 0.5 | horizon = fog colA | ×(0.5+0.5e) |
| 0.6 | ground | ×(0.25+0.75e) |
| 0.8 | road | ×e |
| 1 | black | — |

Ground and road are multiplied by (sun+amb)/10, and `e = min(1, sunI)·min(2, sunI/ambI)/2`. Terrain uses `envMapIntensity 0`. Car paint dims its env map under trees: `envMapIntensity = 1 - shadow·0.75`.

**For us:** a cheap sky-matched reflection model for cars and water. Remap a fixed greyscale cube through a per-preset 1D gradient, and regenerate only on preset or time change.

---

## 8. Materials: Lambert vs Standard

- **MeshLambertMaterial** (`ks`): terrain `hills_ground`/`cali_ground`, road, grass/bush sprites, walls, barriers. All are patched via onBeforeCompile with custom RE_Direct, the baked-shadow light loop, the fog chunk, fresnel and radiance.
  - Why [INFERENCE]: Lambert is per-fragment and cheap in r155, and every look element is custom anyway, so no specular or PBR is needed.
- **MeshBasicMaterial:** sky, clouds, stars (Points), glows, earthrise, water base (`cali_water`, with custom shading).
- **MeshStandardMaterial:** offworld ground (roughness 1, envMapIntensity 0) and vehicles (env gradient reflections).

**For us:** use Lambert (or an equivalent custom cheap diffuse) for all world geometry, with one shared fog/haze chunk (their comment: "changes here must be reflected in cloud shader"), and keep PBR for vehicles only.

---

## 9. Priorities for our renderer v2 (by visual impact)

1. **The 3-colour fog/haze chunk on every material, and a sky derived from the same formula.** It is shared, so terrain always melts into the sky.
2. **Per-cell presets** (season × time × weather) for colA/colB/colC/near/haze, sun/ambient, fresnel, radiance and cloud colours. Interpolate them along a real sun path, which slowroads does not do.
3. **Terrain sheen/darkening fresnel, the radiance boost and baked soft forest shadows.**
4. **A curved two-shelf parallax cloud plane** blended by alpha × elevation × radial fade, with pink/orange preset colours at dusk.
5. **Tone mapping:** Cineon at