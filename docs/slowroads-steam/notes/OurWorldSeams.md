# Our world render pipeline: seams (2026-09-26)

## Summary

I mapped the current world render pipeline in theBROdrive, file:line throughout. Some items rest on reading only and are marked [INFERENCE]. The seams:

- **Generation is shared by main thread and workers.** The tile worker, forest worker and vista worker each rebuild `Terrain` from seed + spine and call the same pure functions: `sampleGroundHeight`, `plantTrees`, `LandCover.sample`, `vistaGroundAt`.
- **Two modules mix generation and rendering and must be split.** `deserttiledata.ts` produces heights, trees and water but also bakes colours, canopy, ground weights and normals. `deserttiles.ts` owns the Rapier heightfield and trunk colliders but also builds the tile mesh and owns `ForestRenderer`.
- **Physics depends on render-side modules for trunk colliders.** It uses `treeShape` from `forest.ts` and `treeVariantCount`/`trunkColliderRadius` from `props/trees.ts` (habit tables).
- **Everything else hangs off shared material patches.** Ground and foliage materials chain `onBeforeCompile` patches: comic → groundpaint → cloudshadow → season → wetness. Three.js shader chunks are patched globally by `lightshader.ts`. The sky drives fog, sun and hemi lights and the environment map. One post pass reads depth for the aerial veil, ink outlines and sun shafts.
- **Several systems are desert leftovers.** Heat haze is never fed from `main.ts`. `TerrainMeshProvider` is not registered in `main.ts` (only the labs and tools use it). Tile desert props are always rejected. There are also vista mesas, lake palms, tumbleweeds and `desertPaletteAt` users.


## Architecture

Seed + RoadSpine → Terrain (Landscape, streams, lakes, bogs, ravines) + LandCover → the pure functions sampleGroundHeight, plantTrees, LandCover.sample and vistaGroundAt. Three workers (tile, forest, vista) each rebuild Terrain and call them.

What each layer gets:
- **Near ground.** Tiles are a uniform 3 m lattice, 240 m each; 5x5 are drawn and 3x3 collided, with a Rapier heightfield and trunk cylinders. Attributes: position, normal, color, aGround, aCanopy, aTerrainDetail, plus stream/bog water sheets.
- **Far ground.** A camera-centred polar disc from 200 m out to the far plane, coloured on the CPU for the season.
- **Trees.** The near tiles' trees feed world-wide instanced model buckets (LOD 0/1/2 at 60/110/150 m). The forest worker plants tiles out to 6 km for impostors (to 2 km in woods, 6 km in the open, far keepers to 4.5 km). Past about 4.2 km woods become a canopy blanket.
- **Grass.** A 70 m ring of cards from a 1 m texel cache.

Look: materials are MeshStandard with chained onBeforeCompile patches (comic → groundpaint → cloudshadow → season/wetness/snow). Global chunk patches (lightshader) add the shadow fade and height haze. The Sky sets FogExp2, the sun and hemi lights and the PMREM environment. main.ts scales fog density by the tier's fogScale. A single post pass reads depth for the veil, sun shafts and ink.


## Files

- src/world/deserttiledata.ts: MIXED. Tile constants :16-19 (240 m tile, 80 cells, 81² vertices, 3 m step). DesertTileData :157. sampleGroundHeight :309 (exact drawn/collided height; also used by lakewater). generateDesertTileData :397 (heights, positions, normals, colours, aCanopy, aGround, water sheets, trees). TreeKind :195, TREE_STRIDE=7 :267, plantTrees :698, tileSurfaceSampler :1058 (used by shoulder and tracks).
- src/world/deserttiles.ts: MIXED. DesertTileStreamer :229: 5x5 visual / 3x3 physics tiles, worker streaming, mesh attach :500-560 (attributes :508-513, DESERT_TILE_MATERIAL :518, stream water mesh :530-544). Physics: promote :1044 (addHeightfield), addTreeColliders :1082-1119. groundHeightAt :297, heightAt :453, forest ownership :276, refreshTrees :280, rebase :403.
- src/world/deserttileworker.ts: KEEP (generation). Worker protocol :13-46; rebuilds Terrain and RoadDistance from seed + spine.
- src/world/terrainmesh.ts: MIXED/legacy. createTerrainMaterial :261-320 (comic + groundpaint + cloudshadow + wetness + tile patch for aTerrainDetail fade 300-480 m and aCanopy ramp). TERRAIN_MATERIAL :321 (also used by the vista's outer band), DESERT_TILE_MATERIAL :323. TERRAIN_COLLIDER_SURFACE :121 (physics/wheel spray: KEEP, move out). drawnGroundY :487 (delineators, sidetrack). TerrainMeshProvider :540 is legacy: not registered in main.ts; used by road-lab and tools.
- src/world/landcover.ts: KEEP (data, plus palettes to move out). CoverKind :34, Crop :41, CoverSample :51, LandCover :216. Point queries: sample :392, forestAt :361, birchAt :384, pineAt :304, broadleafAt :296, beltAt :313, copseAt :283, clumpAt :291, farmlandAt :256. Colour: canopyColour :483, PALETTES :108-140, MUD :142. writeGroundWeights :533.
- src/world/terrain.ts: KEEP. Terrain :427, cover :507, basins :505. Queries: heightAt :916, bogAt :584, ravineAt :620, waterLevelAt :1060, wetnessAt :1111, surfaceAt :1144 / surfaceFromFrame :1023 / openSurfaceAt :1139, horizonHeight :998, explorationDetailAt :764, corridorShapeAt :792, openBase :829, baseFromFrame :935. PEAT :145.
- src/world/vistaground.ts: RENDER helper called from generation. canopyHeight :31 (called by the tile builder), CANOPY_FROM_M/FULL_M :20-21, vistaGroundAt :44 (CPU colour with season + peat + canopy).
- src/render/vista.ts: RENDER. VistaMesh :~300. Polar disc: inner 200 m :34, 160 sectors :66, ring ratio 1.1 capped at 360 m :47-48, outer = farPlaneForViewDistance. Sample cell 250 m :80, rebuilt every 3 m :36, road underlay :54-59. Overlap band uses VISTA_OVERLAP_MATERIAL with far-plane depth :209, outer band uses TERRAIN_MATERIAL :410, renderOrder 1. Mesas :101-140 and :182 (desert leftover). Public: season :~305, setViewDistance :556, update :578.
- src/render/vistaworker.ts: RENDER (samples generation). Worker for horizonHeight + colour per disc vertex; SECTORS must equal the value in vista.ts (:82).
- src/world/forest.ts: MIXED. ForestRenderer :179. LOD constants :44-69. treeShape :95 (used by physics). clearTrees :157 and Clearing/ClearingSource :144-151 (used by physics tiles and main.ts POI clearings). addTile/removeTile :408/:413, update :422, rebucket :471, impostor tile write :347-373.
- src/world/forestworker.ts: RENDER-side planting worker. Calls plantTrees without undergrowth for far tiles; flags open trees and far keepers (open byte → tint sign / +10).
- src/world/impostors.ts: RENDER. bakeImpostorAtlas :187 (6 views, 21 columns), applyModelDissolve :343, ImpostorField :449 (add/remove/cull).
- src/world/farwoods.ts: Small shared piece: FAR_WOODS_TO_M=4500 :16, FAR_KEEP_SHARE 0.2, isFarKeeper :19 (pure hash).
- src/world/props/trees.ts: MIXED. Tree geometry, materials and habits (render), but trunkColliderRadius :2151 and treeVariantCount :2140 (with TREE_TRUNK_RADIUS :60 and the habit girth) are physics inputs. UNDERGROWTH_FADE 50-110 m :2114. Material :1934 (comic + season + leaf atlas).
- src/world/grass.ts: RENDER. GrassField :92. 256² 1 m texel cache, radius 70 m :62-65. Constructor takes a groundHeightAt callback :126. trample :390 (wheels via app/wheeleffects.ts:91 at r=0.75; feet via main.ts:2000 at r=0.45), recovers over 25 s. sampleTexel :626 reads cover, road projection, shoulderWidthAt, trackAt, wetnessAt, streams, bogAt, basins.
- src/render/groundpaint.ts: RENDER. applyGroundPaint :263 (aGround weights: meadow/crop/forest/earth, procedural paint, FOREST_SHADE 0.34 :42, season hook SEASON_GROUND_MARK :256). groundVary :251 is used by grass.
- src/render/comic.ts: RENDER. applyComicShading :289 (defines vComicWorld, which groundpaint needs), applyGroundSpotlightNormals :312 (road, marking and road-bed materials). Imports lightshader.
- src/render/lightshader.ts: RENDER, global ShaderChunk patches. Point-light zero guard :9. Shadow stabiliser + fade 78-100 m :26-75. Height haze on FogExp2, scale height 70 m :81-124. Imported by core/renderer.ts:3 and comic.ts:4.
- src/render/season.ts: RENDER. SEASON_UNIFORMS :27 (turn, dry, bare, snow, fresh, canopy, uWeatherWet), setSeasonUniforms :39, SEASON_GLSL :72, injectSeason :196, setWeatherWet :220, applyWetness :228, applySnowCover :251.
- src/world/season.ts: KEEP channels (SeasonState :35, seasonAt :101, seasonOfDay :83, SEASON_OVERRIDE :98). Mixed with CPU colour functions seasonGround :226 and seasonCanopy :258, plus the AUTUMN/CANOPY palettes :130-196.
- src/world/weather.ts: KEEP. WeatherState :23 (overcast, precip, snowing, fog, wet), weatherAt :145, WEATHER_OVERRIDE :161.
- src/render/sky.ts: RENDER. Sky :727: dome, stars, planets, moon, clouds, sun DirectionalLight with shadow :941-960, HemisphereLight :963, PMREM env :1294. update :980 (astronomy; fog colour and density :1070-1073; light intensities :1153-1180; shadow fade :1247-1266). Getters: sunDirection/sunColor/dayFactor/lampFactor/artificialLightFactor/sunRayStrength/isNight :1317-1376. setWeather :803, updateClouds :791, setQuality :1308.
- src/render/cloudshadow.ts: RENDER. applyCloudShadow :502 (module-level shared uniforms), advanceCloudShadows :535 (detail octave only when the tier has shadows), CPU twin cloudShadowFactorAt :282.
- src/core/renderer.ts: RENDER core. Renderer :334: FogExp2, ACES :449, PCF shadows by tier :444. Post pass (haze target with depth texture :490, uniforms :506-526). setViewDistance :1176, setQuality :1102, setInkStrength :1162, setDaylight :852, setSunRays :900, setHeatHaze :867 (not called from main.ts).
- src/render/hazeshader.ts: RENDER post fragment :392. Depth-driven: aerial veil :700, sun shafts sample depth=far :745-761, ink gated on depth<far :773. Also toe lift, grade, green/teal hue fix.
- src/game/settings.ts: KEEP (edit the tiers). GraphicsQuality :46, GraphicsTier :53, GRAPHICS_TIERS :154 (pixels, shadows, msaa, horizonM 1500/8000/25000, fogScale 1/0.42/0.16, light slots, stars). Readers: viewDistanceFor :245, viewDistanceFogScaleFor :250, shadowsFor :285.
- src/core/adaptivequality.ts: KEEP. AdaptiveResolutionController :119, minimum scale and slow-GPU ms per tier :3-14.
- src/main.ts: Composition. Construction :362 sky, :419 vista, :427 lakeWater, :443 desert, :454-472 forest renderer + clearings, :474 grass, :492-520 chunk providers. Frame order :1702-1707 streaming, :1863-2045 sky → lights → glints → season/weather → vista → forest → grass → fog → cloud shadows → precipitation → lakes. Settings apply :2309-2324.
- src/app/devtools.ts: Dev hooks: window.__bro :463 exposes vista, sky, desert, lakeWater, terrain; seasonDay :506, weather :511, jumpToLake :490/:365 (lakeWater.sites/ready/viewpoint/phaseName).
- src/app/bootwarmup.ts: Uses desert.update/readiness :112-119 and the tier ladder :233-247 (renderer.setQuality, sky.setQuality, setViewDistance on renderer and vista).
- src/app/wheeleffects.ts: Imports TERRAIN_COLLIDER_SURFACE from terrainmesh :14; trample callback :56/:91.
- src/world/roadmesh.ts: MIXED (road generation + look). Materials: roadMaterial :345, roadBed :355, shoulder :376, marking :428. Shoulder strip is built with tileSurfaceSampler :605-712 and has a Gravel collider :945. Also streamcrossings.
- src/world/trackmesh.ts: RENDER over tracks.ts data. TrackProvider :60 lays dirt tracks on tileSurfaceSampler; comic + cloudshadow + snow material :33.
- src/render/lakewater.ts: RENDER (reader). LakeWater :404 runs a priority flood over sampleGroundHeight; baked-shore sheets plus desert-leftover grass/palm/tree fringe cards (mirage-tableau); dev getters :1300-1349.
- src/render/streamwater.ts: RENDER. STREAM_WATER :22 (watermaterial), advanceStreamWater :46, driven by DesertTileStreamer.update.
- src/world/landmarks.ts: RENDER. Far churches, towers and pylons; comic material + thinFog :217; update :249.


# Integration map: current world render pipeline

All paths are under `src/`. `[INFERENCE]` means read from code but not run.

## 1. Terrain

### Near tiles

**Generation**
- `world/deserttiledata.ts:397 generateDesertTileData(context, tx, tz, farFromRoad, into?)`. It runs in the worker (`world/deserttileworker.ts`, protocol :13-46) or synchronously as a fallback (`deserttiles.ts:470 buildSynchronously`).
- `DesertTileGenerationContext` :145 = {seed, road, terrain, roadDistance}.
- Tile geometry (:16-19):
  - 240 m tile, 80 cells, 81×81 vertices, 3 m step.
  - One uniform lattice with no geometric LOD.
  - Streamer VISUAL_RADIUS 2 (5x5 tiles) and PHYSICS_RADIUS 1 (3x3), `deserttiles.ts:66-67`.
  - `farFromRoad` mode switches off road queries past 900 m (:69).

**Per-vertex outputs** (`DesertTileData` :157), with where each comes from:

| Field | Contents | Source / consumer |
|---|---|---|
| `heights` | drawn = collided height | `sampleGroundHeight` :309 |
| `positions` | tile-centre-relative x/z plus y | tile builder |
| `detailOffsets` → attr `aTerrainDetail` | fine relief the shader removes between `DESERT_TILE_FADE_FULL=300` and `GONE=480` (terrainmesh.ts:259-260) | shader |
| `normals` | central differences, :528-546 | shader |
| `colors` | linear rgb from `cover.sample`, then lerped toward MUD (wetness), SILT (basin shore band), PEAT (bog), :446-488 | shader |
| `canopy` → `aCanopy` vec4 | canopy rgb (`cover.canopyColour`) + height (`vistaground.canopyHeight`), masked by bog and basin | tile shader ramps it over CANOPY_FROM 4185 → FULL 4860 m [INFERENCE: tiles reach at most ~850 m from the camera, so the ramp never engages on tiles; it matters on the vista] |
| `ground` → `aGround` vec4 | meadow / crop / forest floor / bare earth from `landcover.writeGroundWeights` :533 | groundpaint and the season shader |
| `water`, `waterIndices` | stream/bog sheet quads wherever `terrain.waterLevelAt` > ground + 3 cm; stride 9 = xyz, rgba (baked shallow/deep tint, shore alpha), wave uv in absolute metres / 14 m (:38, :569-649) | tile water mesh |
| `trees` | see §3 | forest renderer + colliders |
| `propSurfaces` | always 0: the desert props are gone (:651-666) | — |

**Mesh assembly** (`deserttiles.ts:500-560 attach`)
- Attributes are set at :508-513.
- The mesh uses `DESERT_TILE_MATERIAL`: receiveShadow on, castShadow off.
- The water mesh uses `STREAM_WATER.material` with renderOrder 1 (:538-544).
- The group sits at tile centre minus origin; `freezeStaticSubtree`.
- Tile buffers are recycled, up to 12 spare sets (:76).

**Physics coupling** (`deserttiles.ts:1044 promote`)
- `physics.addHeightfield(80, 80, heights, size 240, centre − origin, TERRAIN_COLLIDER_SURFACE)`.
- Then `addTreeColliders` (§3).

**Height queries used by others**
- `groundHeightAt(x, z)` :297: the tile lattice, bilinear. Used by grass (main.ts:474).
- `heightAt` :453 and `hasPhysicsAt` :465: diagnostics.
- `tileSurfaceSampler` (deserttiledata.ts:1058): the exact tile triangles, lazily for any point. Used by the road shoulder (roadmesh.ts:632) and tracks (trackmesh.ts:68).
- `sampleGroundHeight`: also used by lakewater.

**Materials** (`world/terrainmesh.ts:261 createTerrainMaterial`)
- Chain: `applyCloudShadow(applyGroundPaint(applyComicShading(MeshStandard{vertexColors, roughness 0.93}, {lightingStrength 0, reliefShade 0.28, stipple 0, spotlightNormals 'smooth'}), {season: detailFade}))`.
- Tiles only: `applyWetness(0.22)` plus a vertex patch for the detail fade and the canopy ramp/raise :288-316.
- `TERRAIN_MATERIAL` (no season, no fade) :321 is used by the vista's outer band.
- `DESERT_TILE_MATERIAL` :323.
- `TERRAIN_COLLIDER_SURFACE = SurfaceType.Grass` :121 is imported by physics (deserttiles) and wheel spray (app/wheeleffects.ts:14). It must survive: move it out of the render file.

**Legacy terrain path**
- `TerrainMeshProvider` :540 and `fieldRings` :365 (the road-relative fan) are NOT registered in main.ts. They are used by road-lab.ts:194 and by tools/*.
- `drawnGroundY` :487 is still used by `props/delineators.ts:294` and `sidetrack.ts:322`. It reproduces the legacy fan, not the tiles [INFERENCE: reflector posts are therefore footed on a surface that is no longer drawn].

### Far ground (vista)

**`render/vista.ts` VistaMesh**
- Ring geometry:
  - Polar disc from INNER_RADIUS 200 m (:34) to `farPlaneForViewDistance(horizonM)`.
  - 160 sectors (:66).
  - Ring spacing grows by ×1.1, capped at 360 m (:47-48, `ringRadii` :1475).
- Sampling:
  - Terrain samples are taken at the 4 corners of a 250 m cell (:80) and interpolated.
  - Rebuilt when the camera moves ≥3 m (:36), with double-buffered geometry.
  - Samples come from the worker `render/vistaworker.ts` (terrain.horizonHeight + `vistaGroundAt`).
  - Relief fades over 2500-7000 m (:72-73).
  - A road underlay pushes the disc under the road within 1600 m (:54-59).
- Attributes: position, color, normal (:966-971).
- Draw groups:
  - Group 0: VISTA_OVERLAP_MATERIAL, which writes depth at the far plane (`farDepthOnly` :233) so the tiles win out to NON_OCCLUDING_RADIUS 480 m.
  - Group 1: TERRAIN_MATERIAL.
  - renderOrder 1, after the tiles (0) and before the sky (5).
- Mesas (:101-140, MESA_MATERIAL :182) are desert leftovers.
- Public API:
  - `season: SeasonState` (main.ts uses it as THE season state object).
  - `setViewDistance(m)` :556.
  - `update(camX, camZ, s, dt)` :578.
  - `vertexCount`, `dispose`.

**`world/vistaground.ts:44 vistaGroundAt`**
- Height: `terrain.horizonHeight` (terrain.ts:998: landscape + relief + mountains by camera distance).
- Colour: `cover.sample(roadDist=1e6)`, then `seasonGround` (CPU), peat for bogs, canopy colour + height ramp past CANOPY_FROM_M.
- No water.

### Road meets terrain

- The tile height under the road is `terrain.baseFromFrame − 0.1·(1 − smoothstep)` inside CORRIDOR_OUTER = 30 m (deserttiledata.ts:344-363). The road ribbon owns the contact surface.
- `roadmesh.ts` materials: `roadMaterial` :345 (markAsphalt stencil for wet glints, wetness, cloud shadow, spotlight normals), `roadBedMaterial` :355, `markingMaterial` :428.
- Shoulder strip `buildShoulder` :605-712:
  - Laid from the asphalt edge down onto `tileSurfaceSampler` ground.
  - Width from `shoulder.ts shoulderWidthAt`.
  - Gravel texture; comic + cloudshadow + snow + wetness (:376).
  - Has a Gravel trimesh collider (:945).
- Stream crossings: `streamcrossings.ts` (STREAM_CROSSING_MATERIAL :378).

### Streams, lakes, bogs

- **Streams and bog pools.** `terrain.waterLevelAt` (terrain.ts:1060) is baked into the tile water sheets and drawn with STREAM_WATER (`render/streamwater.ts:22`). `advanceStreamWater` is called from `DesertTileStreamer.update`.
- **Lakes.** `render/lakewater.ts:404 LakeWater`:
  - A reader: priority flood over `sampleGroundHeight`, baked-shore RGBA sheets.
  - It also draws desert fringe cards (grass/palm/tree via `mirage-tableau`).
  - Updated in main.ts:2029.
  - Dev tools read `sites`, `ready`, `viewpoint()` and `phaseName`.
- **Bogs.** `terrain.bogAt` drives PEAT paint on tiles and vista, masks the canopy, keeps grass off where bog > 0.45 and changes the tree kinds.

**A replacement must keep:** heights identical to the collider (the heightfield takes `data.heights`); `groundHeightAt`; `tileSurfaceSampler`; `sampleGroundHeight`; seam-identical edges; origin-relative placement plus `rebase()`; `readiness`/`prime`/`update` for boot; the water sheets or an equivalent.

## 2. Land-cover data available per point

From `LandCover.sample(x, z, roadDist, out)` (landcover.ts:392), fields of `CoverSample` :51:
- `kind`: Meadow, Field or Forest.
- `forest` (0..1, includes regrowth on abandoned plots).
- `birch` (0..1, suppressed in pine woods).
- `crop`: -1, or Wheat, Rye, Stubble, Ploughed, GreenCrop, Fallow, Hay.
- `plot`: inside-plot 0..1, i.e. the margin distance.
- `lush` (0..1).
- `r, g, b`: palette colour, which should become render-side.

Separate LandCover queries:
- `forestAt` :361 (used for tree placement).
- `farmlandAt` :256, `copseAt` :283, `clumpAt` :291, `broadleafAt` :296.
- `pineAt` :304 (pine-wood share; the "bor" share is `smoothstep(pineAt)`).
- `beltAt` :313 (shelter belts).
- `birchAt` :384.
- `canopyColour` :483.

No field id is exposed: `plotFrame` and `plotAt` are private (:343, :495) and hold region rx/rz, cell iu/iv, fu/fv, age.

From Terrain (terrain.ts):
- `wetnessAt` :1111, `bogAt` :584, `ravineAt` :620.
- `waterLevelAt` :1060.
- `basins.placementsNear(...)`, which gives the shore margin.
- `surfaceAt` / `surfaceFromFrame` / `openSurfaceAt`: SurfaceType for the wheels.
- `road.landscape.streams.at(x, z)` → {bed, bowl, flood, d}.

Road-related:
- `roadDistance.distAt(x, z, lattice)` and `ownerAt` (arclength).
- `road.project(x, z, hint)` → {s, lateral}.
- `road.halfWidthAt(s)`, `shoulderWidthAt(s, side)`.
- `tracks.trackAt(seed, s, lateral, edge, out)` → {dist, fade}, and `trackPossibleNear`.
- `terminusWeight(x, z)`.

`writeGroundWeights(cover, wet, out, at)` :533 folds these into the four aGround weights.

Colour constants now live in data modules and should move to render: PALETTES (landcover.ts:108), MUD :142, PEAT (terrain.ts:145), SILT and WATER_* (deserttiledata.ts:44-45, :111), CANOPY and AUTUMN_* (world/season.ts:130-196).

## 3. Trees

### Placement

`plantTrees(context, tx, tz, heightAt, out, cover, undergrowth = true)` (deserttiledata.ts:698)
- A pure function of the seed and the tile.
- Candidates on a 6.5 m cell grid (36²), plus an undergrowth grid twice as fine.
- MAX_TILE_TREES = 36²·3 (:272).
- Output record, TREE_STRIDE 7 (:267): [localX, groundY, localZ, scale, yaw, kind, tint 0.84-1.16], x/z relative to the tile centre.
- Kinds (TreeKind :195): Birch 0, Spruce 1, Bush 2, Lime 3, Pine 4, Aspen 5, Oak 6, Maple 7, Alder 8, Willow 9, Rowan 10, Fern 11, Juniper 12, Stump 13, Log 14, FieldPine 15. Undergrowth is 11..14 (:245); `isImpostorKind` :258.
- Exclusions: road verge (9.5 m, or edge + 5.5 m), tracks, stream beds, basin bowls, terminus.
- Rules in order: shore willows → bog flora → woods (forestAt/pineAt/birchAt/wetness) → stream banks → ravines → belts → ditch scrub → field pines → copses → fallow birch → lone trees; then the undergrowth pass.

### Consumers

**Near tiles** (deserttiles.ts)
- `clearTrees(forest.clearings, …)` removes trees in POI yards. The ClearingSource is set in main.ts:457-472.
- `forest.addTile(key, cx, cz, trees, count)` :554; `removeTile` :1193.

**Tree colliders** (`addTreeColliders` :1082-1119)
- One fixed body per tile.
- For each tree with scale ≥ 0.45:
  - `treeShape(wx, wz, treeVariantCount(kind), out)` (forest.ts:95, a pure hash of position and HABIT_REGION 260 m).
  - radius = `trunkColliderRadius(kind, variant)` (props/trees.ts:2151 = TREE_TRUNK_RADIUS[kind] :60 × habit girth) × scale × sx.
  - Cylinder, half-height 2.5 m, at y + 2.5 − 0.3, registered as SurfaceType.Rock.
- **The collider depends on `treeShape`, `treeVariantCount`, the per-kind habit list order and girths.** Any new tree renderer must keep those functions, and the variant indexing, byte-compatible, or move them into a non-render module and share them.

**`ForestRenderer`** (forest.ts:179, owned by DesertTileStreamer :276)
- Model LOD by camera distance:
  - NEAR < 60 m (full model, casts shadow).
  - MID < 110 m (far model, casts).
  - FAR < 150 m (far model, no shadow).
- Dissolve to impostors over IMPOSTOR_BLEND 30 m (`applyModelDissolve`, impostors.ts:343).
- Buckets are world-wide InstancedMeshes per [kind][variant][lod][part], refilled every REBUCKET 14 m (:471). Instance matrix = pos(y − 0.15), yaw, scale (s·sx, s·sy, s·sx); instanceColor = tint.
- Undergrowth is skipped past UNDERGROWTH_FADE_TO 110 m (props/trees.ts:2114).
- `attachRenderer(webgl)` :235 bakes the impostor atlas.

**Impostors**
- `forestworker.ts` plants tiles out to IMPOSTOR_TILE_RADIUS = ceil(6000/240) + 1 tiles, with `undergrowth = false`.
- Full woods within FULL_TILE_RADIUS 12; open trees only beyond; far keepers (`farwoods.isFarKeeper`, 20%) within 20 tiles.
- The open flag is encoded in the tint: negative = open (drawn to 6000 m), +10 = keeper (to 4500 m), otherwise drawn to 2000 m (forest.ts:300-305).
- `ImpostorField` (impostors.ts:449): camera-facing quads, 6-view atlas, attribute pair a0/a1 (:347-373), anchor rebased every 20 km.
- `refreshImpostors` :400 is called when the POI spacing changes.

**Canopy blanket.** Past about 4.2 km woods are the raised vista ground (`vistaground.canopyHeight`, CANOPY_HEIGHT_M 17).

**Tree material** (props/trees.ts:1934)
- Comic, with contour and stipple off.
- Leaf atlas (render/leafpaint.ts), injectSeason (autumn/bare/snow via SEASON_TREE_RANDOM_GLSL), a custom depth material :1947, and the aWood/aKind attributes.

## 4. Grass

`world/grass.ts:92 GrassField(scene, origin, terrain, road, roadDistance, groundHeightAt)` (main.ts:474)
- Crossed-card tufts on a single ring out to RADIUS 70 m, 0.6 m cell, sprouting in over the outer 30 m (:62-71).
- Camera-centred toroidal texel cache, 256² at 1 m:
  - heightTex (float): from `groundHeightAt`, which is the tiles (`null` = not loaded yet, retried).
  - colourTex (rgba8): root colour from `cover.sample` + mottling; alpha = upright, 255 when fresh.
  - paramTex: height, wheat, flowers, density.
- Inputs to `sampleTexel` :626: road projection → toEdge / `shoulderWidthAt` (none on the shoulder) and `trackAt` (ruts); `cover.sample` (kind/crop → wheat and rye cards, lush → density); `wetnessAt`; streams bed/bowl → none; `bogAt` > 0.45 → none; basins via `placementsNear` :487.
- `trample(x, z, r)` :390 zeroes the upright alpha, which recovers over RECOVER_S 25 s. Callers: wheels (`app/wheeleffects.ts:91`, r = 0.75, terrain contacts only, wired in main.ts:1771) and feet (main.ts:2000, r = 0.45, when not driving).
- `update(x, z, fx, fz, dt)` :429: absolute camera position and view direction.
- Material :171: comic (all effects off) + cloudshadow + injectSeason + groundVary + tuft atlas (render/tuftpaint.ts); depthWrite off (no ink), alpha-to-coverage.

## 5. Sky, light, fog, look

**`render/sky.ts` Sky(scene, fog, webgl, starField)** (main.ts:362)
- `update(epoch, timeOfDay, dayIndex, s, camX, camY, camZ, viewDirX, viewDirZ)` :980:
  - AstronomySystem for the sun and moon.
  - `skyGradientAt(s)` (world/gradient.ts) for haze, dust and hue.
  - Twilight moods.
  - Weather (overcast/fog/precip) greys the sky.
- It writes `fog.color = horizon` and `fog.density = BASE × haze × weather` (:1070-1073), then main.ts multiplies the density by the tier's `viewDistanceFogScaleFor` (main.ts:1949, :2009).
- Lights:
  - `sunLight` DirectionalLight: casts shadow; GRAPHICS_CONFIG map size, frustum and bias (config.ts:51-58).
  - Target stabilised and led 0.42 × half-size along the view.
  - Shadow intensity fades with elevation and key share; `autoUpdate` is frozen at 0 (:1247-1266).
  - `hemiLight` with a night fill floor (:963, :1164-1180).
  - `scene.environment` from PMREM of the dome (`refreshEnvironment` :1294), which lights cars.
  - `scene.environmentIntensity`.
- Getters used elsewhere: `sunDirection`, `sunColor`, `sunRayStrength` (→ renderer.setSunRays); `dayFactor` (→ cloud shadows, traffic, autopilot, precipitation, renderer.setDaylight, loose parts); `lampFactor` (street lamps); `artificialLightFactor` (headlights); `isNight`; `didBakeEnvironmentThisFrame` (adaptive resolution).
- `setWeather` :803, `updateClouds(absX, absZ)` :791 (render/clouds.ts), `setQuality` (star depth) :1308.

**`render/lightshader.ts`** — global patches, imported by renderer.ts:3 and comic.ts:4
- Point-light zero guard :9.
- Shadow stabiliser plus view-distance fade 78→100 m and a shadow-map edge fade (:26-75).
- Height haze :81-124: FogExp2 scaled by the mean density along the ray, scale height 70 m, clamped 0.35-2.2. It applies to every fogged material.

**`render/comic.ts`**
- `applyComicShading(mat, opts)` :289. Options :37: bands, lightingStrength, shadowWarmth, reliefShadeStrength, spotlightNormals, contour*, stipple*. It provides `vComicWorld`, which groundpaint needs.
- Users: terrain tiles and vista (terrainmesh.ts:266, vista.ts:183/:210), grass (grass.ts:176), trees (props/trees.ts:1934), impostors (impostors.ts:523), landmarks (landmarks.ts:217), shoulder (roadmesh.ts:378), tracks (trackmesh.ts:34), `makeFlatMaterial` (render/materials.ts:741, used by the POI kit), partmesh.
- `applyGroundSpotlightNormals` :312 is used by the road, road bed and markings.

**`render/groundpaint.ts:263 applyGroundPaint`**
- aGround weights select one of four procedural stroke patterns at 4 m and 12.5 m.
- FOREST_SHADE 0.34 darkens forest floor (a baked forest shadow).
- Vary texture on a 125 m period.
- The season hook runs `seasonGround` / `seasonSnowAt` in the vertex shader when `season: true` (tiles only).
- Periods must divide the 1000 m origin rebase step (:30-33).

**Season**
- `world/season.ts` holds the channels: `SeasonState {day, turn, dry, bare, snow, fresh}` :35; `seasonAt(s, startDay)` :101 (a year = 1200 km of road); `SEASON_OVERRIDE` :98.
- `render/season.ts` holds the uniforms: `SEASON_UNIFORMS` :27 (turn, dry, bare, snow, fresh, canopy, uWeatherWet), set once per frame by `setSeasonUniforms(vista.season)` (main.ts:1982) and `setWeatherWet(weather.wet)` (:1986).
- `injectSeason(shader)` :196 is used by groundpaint (tiles), grass, trees and their depth material, impostors, applyWetness and applySnowCover.
- `applyWetness(mat, darken, gloss)` :228: tiles (0.22), road, shoulder.
- `applySnowCover` :251: shoulder, tracks.
- The vista is recoloured on the CPU (`seasonGround` :226, `seasonCanopy` :258).

**Weather** (`world/weather.ts`)
- `WeatherState {overcast, precip, snowing, fog, wet}` :23.
- `weatherAt(seed, s, startDay, season, out)` :145; `WEATHER_OVERRIDE` :161.
- Consumers: `sky.setWeather`, `setWeatherWet`, `precipitation.update`, `wetGlints.endFrame`.

**Cloud shadow** (`render/cloudshadow.ts`)
- `applyCloudShadow(mat)` :502 uses module-level shared uniforms.
- Applied to: tiles and vista, mesa, grass, road/bed/marking, shoulder, tracks.
- `advanceCloudShadows(seed, dt, dayFactor, originX, originZ, quality, mobile)` :535 (main.ts:2015). The detail octave is on only when `shadowsFor(tier)`.
- CPU twin `cloudShadowFactorAt` :282, used by tools.

**Post pass** (`core/renderer.ts` + `render/hazeshader.ts:392`)
- The scene renders into `hazeTarget`, which has a depth texture (renderer.ts:490), then one fullscreen pass.
- Order: heat warp and mirage (depth; strength only via `setHeatHaze`, which main.ts never calls, so it is effectively 0) → toe lift → aerial veil `1 − exp(−d·0.00035)` × 0.8 × daylight toward (0.70, 0.77, 0.84) for depth < far (:700) → grade → green/teal hue shift → sun shafts (12 taps counting depth = far plane toward the sun, :745-761) → ink edges only where depth < far (:773) → shades tint, binoculars, viewfinder.
- **Depth dependencies:** the sky, stars and planets must stay at far depth (depthWrite off). Grass writes no depth. The vista overlap writes 0.99999·w; ink and shafts rely on this.
- `setDaylight`, `setSunRays`, `setInkStrength` (setting), `setMsaa`, `setViewDistance` (camera far = `farPlaneForViewDistance`).
- Tone mapping ACES, exposure 1 (:449).

## 6. Per-frame order (main.ts render callback)

1. Streaming :1701-1707: `streamer.update` and `desert.update(desertX, desertZ, desertLateral, frameId)`, alternating order by frame parity.
2. `birds.update` :1710; `debris.update` / `tumbleweeds.update` :1736-1748.
3. `camera.update` :1848.
4. `sky.update(...)` :1863; `renderer.setSunRays` :1875; `sky.updateClouds` :1876; `loose.syncVisuals`; headlight environment factor.
5. Vehicle projected lights :1904-1910; wet glints begin, glints offered, end with `fogDensity` :1915-1951 (needs `terrain.heightAt` under the eye); contact patches.
6. 'vista' section :1973-2003:
   - season (`seasonAt` → `vista.season`) → `setSeasonUniforms`
   - `weatherAt` (+ override) → `setWeatherWet` → `sky.setWeather`
   - `vista.update(cam.x, cam.z, activeS, dt)` [origin-relative camera]
   - `desert.forest.update(absX, absZ, viewDirX, viewDirZ, halfHorizontalFov)`
   - `grass.update(absX, absZ, dirX, dirZ, dt)`, `grass.trample` (feet)
   - `landmarks.update(absX, absZ)`
7. `renderer.fog.density = fogDensity` :2009.
8. `advanceCloudShadows` :2015; `precipitation.update` :2025; `lakeWater.update` :2029; `devTools.updateLakeSeek`.
9. Lights :2046-2060: `streamer.setLamps(sky.lampFactor, abs)`, `lightBudget.update`.
10. :2217-2251: `renderer.adaptResolution`, `setDaylight(sky.dayFactor)`, `setItemViewEffects`, `renderer.render()`.

Origin rebase: `streamer.rebase(); desert.rebase()` at :1439-1440. The forest, grass, vista, lake and impostors read `origin.x/z` themselves.

Seasonal and weather state is read one frame late by the sky in step 4, because `setWeather` runs in step 6.

**Dev hooks** (`app/devtools.ts`)
- `window.__bro` :463 includes renderer, vista, sky, terrain, road, desert, lakeWater, streamer, traffic, `state()` and `view()`.
- `seasonDay(day | null)` :506 → SEASON_OVERRIDE.
- `weather(partial | null)` :511 → WEATHER_OVERRIDE.
- `jumpToLake(i)` :490/:365 with lake seeking :441-459, using lakeWater.sites / ready / viewpoint / phaseName.
- main.ts also sets `window.__landmarks` in dev.

## 7. Graphics quality

**Tiers** (`game/settings.ts`)
- `GraphicsQuality = 'acceptable' | 'standard' | 'blessing'` :46.
- `GRAPHICS_TIERS` :154:

| | acceptable | standard | blessing |
|---|---|---|---|
| Pixel budget (max, desktop) | 1600×900 | 2560×1440 | 4800×2700 |
| Supersample | 1 | 1 | 1.25 |
| Shadows (desktop; phones always off) | off | on | on |
| MSAA default | off | on | on |
| horizonM | 1500 | 8000 | 25000 |
| fogScale | 1 | 0.42 | 0.16 |
| Vehicle / street light slots | 2 / 2 | 6 / 6 | 8 / 6 |
| Star magnitude | 7 | 8 | 8.5 |
| Headlight distance scale | 1 | 1 | 3 |

- Min pixel floors and mobile variants are in the same table; `mobileVista` makes phones use the standard horizon at most.
- Readers: `viewDistanceFor` :245, `viewDistanceFogScaleFor` :250, `shadowsFor` :285, `vehicleLightSlotsFor` :258, `streetLightSlotsFor` :267, `starMagnitudeFor` :276.

**`core/adaptivequality.ts`**: `AdaptiveResolutionController`, with per-tier minimum scale and slow-GPU ms :3-14.

**`core/renderer.ts`**
- `renderScaleFor` / `minimumScaleFor` :109/:129.
- `setQuality` :1102 changes the shadow map, pixel ratio and adaptive floor.
- Heat warp is off on acceptable (:868).

**What the tier changes in world rendering:** the vista radius (`vista.setViewDistance`) and camera far plane; fog density scale; the shadow pass (and with it the cloud-shadow detail octave); star count; light slots (shader array sizes); MSAA (which grass alpha-to-coverage relies on).

Not tiered today: tile radius, grass radius, forest LOD ranges and impostor reach.

Where a tier is applied: main.ts:432-438 (boot), :2309-2324 (settings change), app/bootwarmup.ts:233-270 (launch auto-tier ladder). Fixed constants live in `config.ts` GRAPHICS_CONFIG :51.

## 8. Other world drawing that must match the new look

- **Poles** (props/poles.ts): plain MeshStandard materials :137-182, with no comic, cloud shadow or season. Street lamps drive LightBudget and wet glints via `streamer.setLamps` / `offerGlints`.
- **Delineators** (props/delineators.ts:118): plain materials; footed on legacy `drawnGroundY`.
- **Scatter** (props/scatter.ts) and **forms** (props/forms.ts:42-66): cactus, scrub and rock materials, desert-era, breakable through DebrisField.
- **Houses, villages, POIs**: world/house.ts:390 (plain MeshStandard); world/poi.ts with village.ts (houses, fences, power drop :978); world/poi/kit.ts (`makeFlatMaterial` → comic without contour or stipple; bulbs emissive); world/poi/{gas,towers,wrecks,houses,starter}.ts.
- **Landmarks** (world/landmarks.ts:202): far churches, towers, pylons and wires; comic + thinFog.
- **Road markings**: roadmesh.ts:428 markingMaterial (markAsphalt stencil, `ASPHALT_STENCIL`, used by wetglints.ts:44).
- **Dirt tracks**: trackmesh.ts (comic + cloudshadow + snow).
- **Water**: lakewater.ts (also desert palm fringe); streamwater.ts / watermaterial.ts (MeshStandard + scrolled normal map, WAVE_TILE 14 m).
- **Ground marks and effects**: render/tyretracks.ts (ShaderMaterial, pooled); render/wheelspray.ts (colour from desertPaletteAt); render/contactpatches.ts; render/wetglints.ts; render/precipitation.ts (with rainocclusion shelter map).
- **Sky extras**: clouds.ts (ShaderMaterial, from Sky); weatherfx.ts, whose provider is not registered.
- **Agents**: birds, tumbleweeds (desert).
- **Traffic and vehicles**: lit by the sun, hemi and `scene.environment` from the Sky, projected lamps (vehiclelights.ts), `traffic.setDaylightFactor(sky.dayFactor)`, `weatherStaticCarPaint`. They depend only on Sky and lights, not on ground materials.
- **Colour/sky tables** (world/gradient.ts): `desertPaletteAt` is used by vista, wheelspray, lakewater, roadmesh, sidetrack and weatherfx; `skyGradientAt` by the sky. `roadConditionAt` is gameplay (road surface, autopilot, traffic): KEEP.

## What a replacement must keep providing

- **Physics:** `data.heights` identical to the drawn ground (heightfield); `TERRAIN_COLLIDER_SURFACE`; tree records plus `treeShape`, `treeVariantCount`, `trunkColliderRadius` for trunk cylinders; the shoulder collider on the drawn ground (`tileSurfaceSampler`); `terrain.heightAt` / `surfaceAt` for wheels, rescue and glints.
- **Placement:** `plantTrees` (a pure function of the seed; feeds both near and far), `clearTrees` and `ClearingSource` for POI yards, and `forestAt` / `cover.sample` / `bogAt` / `wetnessAt` / streams / basins.
- **Grass:** `groundHeightAt`; cover and track data; the trample API (wheel effects and feet).
- **Lakes:** `sampleGroundHeight`.
- **Season and weather:** a per-frame `SeasonState` and `WeatherState` (today `vista.season` is the carrier) and the uniforms consumed by every material.
- **Sky contract for the rest of the game:** `sunDirection`, `dayFactor`, `lampFactor`, `artificialLightFactor`, `sunRayStrength`, `sunColor`, `didBakeEnvironmentThisFrame`, `setWeather`, `setQuality`, `updateClouds`, `scene.environment`, and fog on `renderer.fog`, whose density main.ts scales.
- **Boot and dev:** `desert.prime` / `update` / `readiness` / `rebase` / `dispose`; `vista.setViewDistance` (bootwarmup, settings); the dev handles.

## File classification

**Pure rendering (replaceable)**
- render/: vista.ts, vistaworker.ts, groundpaint.ts, comic.ts, lightshader.ts, cloudshadow.ts (keep the CPU twin if tools need it), render/season.ts, sky.ts, clouds.ts, astronomy.ts, starcatalog.ts, planetfield.ts, hazeshader.ts, heathaze.ts, leafpaint.ts, tuftpaint.ts, gravelpaint.ts, trackpaint.ts, roadtexture.ts, streamwater.ts, watermaterial.ts, lakewater.ts (a reader of ground data), mirage.ts, mirage-tableau.ts, precipitation.ts, rainocclusion.ts, wetglints.ts, tyretracks.ts, wheelspray.ts, contactpatches.ts.
- world/: grass.ts, impostors.ts, farwoods.ts (only `isFarKeeper` is shared by the forest worker), forestworker.ts (planting reuse only), landmarks.ts (render; placement lives inside it), trackmesh.ts (render over tracks.ts), weatherfx.ts (unused).

**Mixed (must be split)**
- world/deserttiledata.ts: heights, water levels and trees are generation; colours, canopy, aGround, normals and water tint are render.
- world/deserttiles.ts: streaming, heightfield, tree and prop colliders vs mesh/material attach and ForestRenderer ownership.
- world/terrainmesh.ts: TERRAIN_COLLIDER_SURFACE and drawnGroundY vs materials; legacy TerrainMeshProvider for labs and tools.
- world/forest.ts: `treeShape`, `clearTrees` and Clearing are shared with physics; the rest is the renderer.
- world/props/trees.ts: `trunkColliderRadius`, `treeVariantCount` and the habit tables vs geometry, mater