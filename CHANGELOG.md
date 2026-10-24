# Changelog

## Unreleased

### Added

- THE DESERT'S REGIONS ARE PLACES, NOT ONLY COLOURS (`world/regions.ts`, new: the ring
  `DESERTS` moved here from `gradient.ts` with `desertAt`, `PALETTE_CYCLE_M`,
  `desertSpanAt`; `regionAt`, `RegionMix`, `CULTURES`, `calibrateRoadWeights`). Every
  system used to roll its own independent dice, so ten kilometres anywhere were a fair
  sample of everything: an izba beside a trulli beside a pueblo, the same mesa count and
  cactus density in every desert. Now each of the 28 deserts' sign emblem is its LAND
  and it has a PEOPLE, and the existing draws read them; nothing new is built.
  - Land (`RegionProfile`): mesa occupancy (`mesas.ts`, read at the road branch nearest
    the cell), sand and rock form density and the forms' weights (`props/scatter.ts`,
    `deserttiledata.ts`, `deserttiles.ts` through `pickDesertForm`'s new `bias`), lone
    houses and desert buildings (`poislots.ts`, `poi.ts`), relay masts, and the road
    character draw (`roadcharacter.ts`). Table country has 2.9x the mesas, the erg 0.2x;
    cactus country 2.3x the cacti; palm country shows dragon trees x6 and baobabs x7;
    the moon and the lava have no saguaro, but rock and dead wood; the lava climbs in
    switchbacks (31% of its road, 13% overall) and almost never runs pan (1.5%), the
    sun's road is 26% pan, the powerline country 35% highway with 4x the masts; lone
    houses run from 2.2 per 100 km on the moon to 9.5 in the powerline country.
  - People: nine cultures (frontier, mexico, sahara, veld, mediterranean, north, soviet,
    asia, modern); 72% of a region's buildings are its own (`CULTURE_SHARE`), the rest
    from the whole catalogue; a settlement falls back to its culture's lived-in houses.
    `rollStructure` takes the arclength.
  - THE RING KEEPS ITS TOTALS. Each density is divided by its distance-weighted ring
    mean (`tools/region-census.ts`: every mean 1.00), so the owner's scarcity is only
    redistributed. Road kinds are matrix-scaled so each keeps its share of the road:
    over 8 seeds x 3000 km, pan 14.8% before and 15.3% after, every other kind within a
    point. A plain per-kind mean had pushed the pan to 16%.
  - Mesa field, scatter and tile props blend across a boundary on the same
    smootherstep as the sand. Tile props: up to 12 per tile (`MAX_TILE_PROPS`, was 5).
  - Measured: `mesa-clearance` PASS (9 seeds, 0 intrusions, 0.05-0.09 ms per cell);
    `spine-verify`, `road-selfcross`, `road-condition`, `poi-placement` pass; a jump
    settles in 7.2-8.6 s, against 7.1-8.8 s on main in the same tab.
  - Old saves and cached spines are invalid: `SPINE_FORMAT` 13, and the houses, mesas
    and props under a saved position move.
- LONE HOUSES' BARRELS CLEAR THE SIGNPOST AND THE WALL (`world/settlement.ts`
  `SIGNPOST_ALONG_M`, `SIGNPOST_OUT_M`, now read by `signposts.ts`; `LONE_BARRELS_GAP_M`
  1.5 to 2.5). Towards the pad's start only if they clear the board: the butterfly
  roof's 25 m put them on it. The gap was exactly the bench's 1.5 m house margin. Both
  showed once regions put more of those houses on the road (`poi-placement`: 0 overlaps).

- A LOST GRAPHICS CONTEXT STOPS THE DRIVE INSTEAD OF A WHITE SCREEN (`main.ts`,
  `webglcontextlost` on the game canvas). A driver reset (Windows TDR,
  `DXGI_ERROR_DEVICE_HUNG`) or the browser reclaiming the GPU used to leave the canvas
  white while the simulation, the autopilot and the sound carried on blind. Now the loop
  and the sound stop, the drive is saved and marked for resume, and a full-screen notice
  offers Reload, which lands back in the car. Nothing is rebuilt in place. An autopilot
  soak beforehand (23 min of driving plus jumps across 300 km, WebGL
  allocations counted) found no GPU leak: buffers plateau near 178 MB and textures near
  239 MB, with programs and the JS heap flat.

- RESOLUTION IS A MULTIPLE OF THE SCREEN (`game/settings.ts` `FRAME_SCALES`,
  `Settings.frameScale`, `GraphicsTier.screenLines`, `screenLinesFor`; `core/renderer.ts`
  `sceneFrameSize`, `setFrameScale`). The row is now x0.5, x0.75, Screen, x1.5, x2 of the
  canvas's own device pixels (read from a `device-pixel-content-box` observer, rounded
  `clientWidth x DPR` where the browser has none), replacing 540p/720p/1080p/1440p and
  the short-lived `screen` height. A maximised window on a 1080-line monitor is about
  1920x990, so none of the fixed heights ever landed on it: 1440p there was 2793x1440,
  the "4.02 Mpx". The rung's old height is now a CEILING on the base (`screenLines`: Low
  720, Medium 1080, High 1440; phones 540/720), so Low on a 4K television still draws
  720 lines and every multiple is of that. Presets set x1. Saves with `renderHeight`
  (or the older `renderScale`) land on Screen. Above 1.4x the screen FXAA is left off
  whatever the setting: the supersample smooths the edges and FXAA only softened the
  distance. Measured on the M2 Pro in that window, Medium, GPU median, alternating runs:
  Screen 7.3-7.5 ms, x1.5 11.4-12.8, x2 14.4-14.7; no program linked by any change.
- DEV: ROADSIDE PROP SHADOWS A/B (pause menu "Roadside prop shadows";
  `InstanceBatches.setPropShadows`, `BatchKind.propShadows`, `ChunkStreamer.setPropShadows`).
  The scatter's rocks and cacti along the road neither cast nor receive sun shadows
  (only a contact disc under them), while the same forms in the desert tiles do both.
  The switch gives the roadside ones the tiles' behaviour, or takes it away again, for
  the session; ground cover is not touched. No program is built by it (95 before and
  after: the tiles already linked both variants); on at km 30 it added 54 draws a frame,
  all in the shadow passes.

### Changed

- NIGHT GLITTER ON THE SAND IS AN EIGHTH AS BRIGHT (`world/terrainmesh.ts`
  `GLITTER_PEAK` 0.8 to 0.1). Tuned by the owner by eye in the game: the same grains and
  the same weather dimming, each glint fainter.
- DISTANT TRAFFIC SKIPS THE TREAD CAST WHERE IT CANNOT MATTER (`vehicle/tyrecontact.ts`
  THE TREAD CAST CAN BE GATED, `TyreContacts.setTreadCastGate`,
  `Vehicle.setTreadCastGate`; `world/traffic.ts` `treadCastGate`, `TREAD_GATE_NEAR_M`
  60, `TREAD_GATE_EDGE_M` 0.3; `SurfaceRegistry.isRoadDeck`). A driven traffic car more
  than 60 m from the player, with its span 0.3 m inside the deck's edge, keeps the hub
  ray's answer and skips the tyre's shape cast while the ray stays on the same road-deck
  slab, its face turned under 1° and moved under 2 m since the last step, the wheel was
  and is on the ground, and the last cast agreed with the ray to 0.1 mm; every wheel
  still casts one step in eight (staggered). The player's car always casts. Measured in
  the dev build at high density on seed 1967315180, hurried autopilot at km 3: the
  traffic tick went from 1.92 ms (14.4 physical cars) and 2.69 ms (19.4) to 1.45 ms
  (15.9) and 1.76 ms (17.1), 0.136 to 0.097 ms a physical car; 56-67% of traffic tread
  casts skipped, `castShape` 93 to 41 ms/s. Shadow-run against the full answer on the
  bench: worst 0.011 mm of travel and 0.5° of normal over 80 750 skipped contacts.
  `Road` keeps each node's heading sine and cosine (`project`, `offsetPoint`, `sampleAt`
  bit-identical, `project` 17% faster) and the slip-angle relaxation blend is taken once
  a step rather than per wheel substep (bit-identical).
- THE PLAYER'S CARS RUN THE WHEEL LOOP AT 480 HZ (`vehicle/vehicletuning.ts`
  `WHEEL_SUBSTEPS` 8, `TRAFFIC_WHEEL_SUBSTEPS` 4; `Vehicle.setWheelSubsteps`;
  `world/traffic.ts`). Wheels, carcasses and the driveline take eight substeps per 60 Hz
  step instead of four. The physics suite moved by a tenth here and there (VAZ-2101 US
  gradient 1.58 to 1.57, UAZ-469 DLC 85.0 to 82.5, every 0-100 and stop within 0.1-0.3).
  The traffic stays at 240 Hz: doubling it for every AI car took the simulation tick on
  the high-traffic road from about 2.5 ms to 3.5-4.0 ms.
- F IS THE ONE INTERACTION KEY; E IS FREE (`core/input.ts` `InputFrame.interact`,
  `interactDown`, `stickerMirror`; `player/interaction.ts` `fixedUpdate`,
  `InteractionResult.useHeld`; `main.ts`; `core/touch.ts`). The bindable "Use held item"
  (E) and "Pick up / mount" (F) are merged into "Interact" (F, the pad's X); a saved
  override for either old id is dropped on load, and E and the pad's B are bound to
  nothing in play. One press means one thing. On foot it belongs to the aim when the aim
  shows something (a named world target, a prompt, a lit crosshair or a kit car's body
  within reach, so binoculars in hand never toggle at a parked car), first match
  wins: a sticker stuck on, the world target's action, a kit seat got into through an
  open side door (the seat looked at, or the one the doorway serves when the eye looks
  through it at the dash or the far door: an open door in the ray, near or far, no longer
  wins over getting in), a kit car's door, lid or flap, boarding the plane, getting in
  otherwise; an aim that shows nothing gives it to the held item
  (binoculars, torch, camera, medicine, pocket watch, sun shades), on the same tick, so a
  press that picked something up never also toggles the torch. Seated: the part in the
  aim (a door, the hazard button, the radio knob, a stalk), then another seat in the aim,
  then out of the car; a held item is not used from a seat. Held, F still works a
  barrel's tap and turns the mirrors. A sticker being tried on is mirrored with the
  middle button, the pad's B or the touch strip's new MIRROR; the touch overlay's E
  button is gone. Prompts, the dev item list and CONTROLS.md say F.
- ON FOOT A SIDE DOOR'S WINDOW IS THAT DOOR (`player/interaction.ts` `aimKit`): the aim
  stopped at no glass, so a ray through the near shut window picked the FAR door across
  the cabin, and F (E before) worked it, while the near door aimed at its window did
  nothing. Now the near window is the near door, and nothing is worked through glass on
  foot. Checked on the VAZ-1111 start car: F at the near window opens the door, F again
  through the doorway seats the player in the cabin view, F at the open door's edge shuts
  it, and the far door no longer answers through the glass.
- GETTING IN FROM FOOT SITS IN THE CABIN VIEW (`main.ts`, `InteractionResult.boarded`,
  `CameraRig.setMode`). F at a seat or a car's body now switches to the cabin view,
  facing down the car; `C` still goes back to the chase. Moving between seats, loads and
  dev jumps into a seat keep the view as it was.
- THE CABIN CAMERA EDITOR IS GONE (`vehicle/cabincamera.ts`; `config/cabin-cameras.json`,
  the `bro.cabinCameras` browser store and `vite.config.ts`'s `/__dev/cabin-camera` writer
  removed). O and J are bound to nothing. The driver's eye is the kit seat's again
  (`CarModelMeasure.cabinEye`, else the bonnet mount): the VAZ-1111's had been moved by
  accident and saved to the config file. A stored override in a browser is no longer
  read.
- HEAT HAZE IS GONE (`render/hazeshader.ts`, `core/renderer.ts` `setEyeAboveGround`;
  `render/heathaze.ts`, `tools/haze-probe.ts` and the dev "Heat haze" A/B removed). The
  finishing pass no longer displaces the picture by a moving refraction field, draws the
  hot-ground mirage or lays the daylight sand veil over the horizon band. Middle-distance
  geometry (45 m and out) was being resampled through a warped UV and then FXAA'd, which
  read as blur and shimmer at the screen's own resolution. Weather fog, the dust wall and
  the dust inside a storm stay; the wall now takes its eye height from the ground under
  the camera. A frozen world redrawn 0.7 s apart is now bit-identical (it was not: the
  haze phase ran on the wall clock).
- FADES THAT DO NOT CRAWL (`render/groundfade.ts`, `render/comic.ts` `comicStipple`
  `comicStretch`, `world/terrainmesh.ts` shoulder grit and tile pebbles). The dissolve at
  the edge of the tile window is a hashed alpha test on the prop's own position instead of
  a screen-pixel dither, so half-dissolved props no longer swim as the car moves. Ground
  stipple fades by each dot's own width on screen (full at 2 px, gone at 1 px) instead of
  by distance, so sub-pixel dots no longer crawl between about 28 and 80 m; on flat ground
  from the chase camera at 1080p the dots now end some 10-15 m out.
- FRAME CAP LOCKED TO THE REFRESH (`core/loop.ts` `GameLoop.presentation`,
  `PresentationMode`). The loop measures the display's callback rate and meets a cap by
  drawing every refresh (`display`), every n-th (`divisor`, e.g. 60 on 120 Hz) or at the
  refresh nearest each deadline (`deadline`, e.g. 60 on 144 Hz), never twice in one
  refresh. 144 on a 144.1 Hz panel no longer drops a frame every few seconds. The frame
  report prints the mode and the rate actually scheduled, and `Renderer.presentedSize`
  says whether the frame is `native`, `stretched` (a deliberately smaller frame the
  browser scales up), `shrunk` or `pixelated`, with the display's own pixels.
- BACK ON THE ROAD WITHOUT A ONE-FRAME REBUILD (`world/chunks.ts` `ChunkPromotion`,
  `ChunkStreamer.prime`; `world/workqueue.ts` `WORLD_JOB_SLICE_MS`; `world/terrainmesh.ts`
  `TerrainMeshProvider.buildSteps`; `world/deserttiles.ts`). Returning to the road from the
  open desert used to rebuild every visual-only chunk of the physics band synchronously,
  35-50 ms each in one frame; those chunks are now PROMOTED one provider per scheduler job,
  each old contribution drawn until its physical replacement is attached, nearest chunk
  first. A rebase cancels only the build in flight; nothing drawn or solid is taken away.
  Only `prime` settles a chunk synchronously: at boot, and now for the fall rescue. Every
  scheduler job gets a deadline (1 ms, never past the frame budget) and must stop at it or
  be one bounded stage; the DEV `[perf] streaming` line names any job that overruns. The
  road-fan terrain (labs and tools; not registered in the game) builds row by row, its
  collider in slabs of at most ~540 triangles like the road's. Desert tiles stage their
  heightfield and prop colliders disabled and switch them on together; far-from-road
  generation is entered at 1100 m and left at 900 m instead of
  flipping at 900 m; and a mode switch no longer tears the window down: each tile of the
  old mode stays drawn and solid until its replacement is ready. `refreshProvider` (unused
  since the POI spacing setting went) is gone.
- A FRAME TALLER THAN THE SCREEN IS SHRUNK BY THE GAME, NOT THE BROWSER
  (`core/renderer.ts` `resize`, `frameTarget`, `presentMaterial`;
  `render/presentshader.ts`; `render/hazeshader.ts` `uEncodeOutput`). The canvas used to
  be the frame, so 1440p in a 990-line window was scaled by the compositor with one
  bilinear tap per screen pixel, which at 1.45x weights some texels fully and their
  neighbours hardly at all: much of the supersample was thrown away. The canvas now stays
  at the screen's device pixels; the finishing pass draws into an 8-bit frame target and
  a present pass area-averages it onto the canvas in linear light (at most 3x3
  `texelFetch`). Both finishing variants and the present pass compile at boot. GPU cost
  on the M2 Pro at 2793x1440 onto 1920x990: 9.65 ms against 9.34-9.62 for the old path,
  whose compositor scale was outside the timer. `Renderer.drawingBufferSize` is now
  `frameSize` (plus `frameHeight`, `presentedSize`); the frame report says when the frame
  is shrunk.
- POLE-LINE WIRES NEVER DRAW THINNER THAN A PIXEL (`world/props/poles.ts`
  `wireMaterial`, `WireBuilder`; `render/cleanstyle.ts` `sceneFrameHeight`). A 1 cm wire
  is under a pixel from about 12 m at 1440 lines, and beyond 30-50 m it rasterised as a
  broken, crawling dotted line that FXAA cannot rebuild. The vertex shader now widens
  each wire about its axis to at least one scene pixel and fades it by true radius over
  drawn radius, so a far span is a continuous faint line; up close nothing changes. The
  wires are one indexed geometry per chunk with a per-vertex true radius (about 2 KB a
  wire, from 8), transparent with depth writes on, and their program has a boot anchor
  in `poleProgramAnchor`.
- THE CINEMA LENS DRAWS THE SCENE AT THE FRAME'S OWN SIZE (`core/renderer.ts`
  `resizeHazeTarget`; `render/hazeshader.ts`, `uSceneResolution` gone). Under the Panini
  lens the scene target was 1.25x per axis, 1.56x the pixels, about 80% of the lens's
  cost; Catmull-Rom (`sceneSample`) now upscales the magnified centre from the 1x
  target instead. Measured on the M2 Pro (frame drawn six times over, wall clock,
  2126x1080): the lens added 0.76 ms in the chase view and 1.46 ms in the cabin view
  before, 0.10 and 0.40 ms after. The centre of the frame is a little softer.
- ONE MATERIAL FOR THE SOLID PROPS, THE POLE FITTINGS ON THE POLE'S (`world/props/forms.ts`
  `matProp`, `paintAsMaterial`; `world/props/poles.ts` `poleFitting`;
  `world/props/monuments.ts`). Saguaro, boulders and slab, dead stick, fallen trunk and
  both trees draw in one vertex-coloured material instead of four (cactus, rock, dead
  wood, plant), each form's colour painted into its vertices the way `material.color`
  decoded it, the saguaro's flat shading moved from `flatShading` into its normals. The
  tarp, rope, nest, transformer can, loudspeaker and the monuments' sign posts are
  painted onto the pole's own plain material instead of four materials of their own, and
  now cast and receive sun shadows as the pole does (they did neither); their metal
  sheen is gone. The unused `matTimber`, `matChrome` and `matRust` are deleted. The barrel
  and the scrub keep their own material: their Clean-style cull size is in its program.
  Programs at boot 95 → 92, none built over a minute of driving. The prop gallery shows
  the forms as the game draws them (it had tinted them with the palette's gravel).
- LESS SCRIPT PER TICK IN THE CHASE VIEW (`player/interaction.ts` `seatedKitPart`,
  `rayMeetsKitDoor`). Seated in a kit car, the aim ray was cast against every triangle of
  the car every tick, although from the chase only a side door answers. It is now first
  tried against the boxes of the door parts' meshes in their own frames, the box three
  tests before a mesh's triangles: a ray that misses them all cannot pick a door, and
  the walk is skipped. Same answers (20 000 random rays round the car: 1324 door hits,
  none lost, 79% skipped); 0.374 → 0.002 ms a tick from the chase eye, 29 → 1.1 ms of
  script a second on autopilot. On foot and from the cabin view nothing changes.
- FEWER PROGRAM RE-RESOLVES A FRAME (`world/deserttiles.ts`, `renderOrder` 0.5). The
  desert tiles' props receive shadows, the scatter's batch pages of the same forms and
  materials do not, and three sorts opaque draws by material, then distance: the two
  interleaved, and each change made three resolve the material's program again and
  upload all its uniforms. The tiles' props now draw as their own group, between the
  ground and the contact shadows: the picture is the same, the main pass's re-resolves
  went 16.4 → 10 a frame (the rest is one switch each way per two-variant material)
  and `setProgram` 38.7 → 27.7 ms a second on autopilot; no new programs (95 before
  and after).

- NO HITCH AS THE LOADING COVER LIFTS, NO DUPLICATE DEPTH PROGRAMS (`core/renderer.ts`
  `primeLightState`, `drawHiddenOnce`; `app/bootwarmup.ts`). Program anchors are hidden,
  so the boot compile linked their programs but no covered frame drew them: the first
  real draw of each (Three's first use, `getProgramInfoLog` and every uniform's location,
  plus the driver's pipeline) landed just after the cover, 7 programs in the first 0.6 s
  of a resumed drive and a 58-175 ms frame. The cover now draws the scene pass once with
  every hidden drawable shown and none culled, lights left as they are. And Three draws
  the shadow pass before it sets up the frame's lights, so the first boot frame linked
  its casters' depth programs keyed to no lights and the next frame linked them again:
  the light state is now loaded before that frame. Measured (dev build, seed flick):
  resumed in the car 100 programs before, 95 after; new drive 96 to 95; no program
  linked or first drawn after the cover, no frame over 25 ms in the first 10 s.

### Fixed

- THE AUTOPILOT DRIVES OFF FROM NEUTRAL AND OFF THE HANDBRAKE (`core/input.ts`
  `InputFrame.autoShift`, `releaseHandbrake`; `vehicle/autopilot.ts` `drive`;
  `vehicle/vehicle.ts`). With the gearbox on Manual the autopilot never worked the lever:
  engaged in N it held its throttle down and the car stood still, and in a gear it never
  shifted. Its frame now asks the gearbox to shift itself, whatever the setting, so it
  pulls away in first and changes up as on Automatic. Engaging it also puts the
  handbrake latch down: the autopilot works its own handbrake, and a latch left on came
  back the moment it was switched off, pulling the rear wheels at speed (measured: on at
  78 km/h before, off after).

## 0.23.0 — 2026-10-22

Kit cars built here from drawings (VAZ classics, Samaras, tens, Nivas, Oka, Moskvich, Volgas, UAZs, Nexia, Espero, Astra, Vectra) with working cabins and mirrors, roadside settlements with the ПОЧТА and МАГАЗИН card machines and money in rubles and kopecks, petrol by the litre, a small always-on driving panel, the pedal lever and mouse driving, one physics for every car, a rolling road with mesas back beside it, two cloud decks, Shadows / Grass / Resolution / Style settings, and the police and the dream layer removed.

- A SMALLER DRIVING PANEL, ALWAYS ON. The on-screen dashboard's dials and lamps are
  gone (speedometer, tachometer, fuel and temperature, telltales, inclinometer, wind
  gauge, tyre dots, gear cell, steering strip): the car's own instruments are in the
  car. What is left is one low panel, shown while driving in the chase and the cabin
  view alike, built round the segment display (faults and radio) at its centre: under
  it the mini-map at the display's width — the race or delivery bead line, or, with no
  contract, the line to the next post drawn grey and faint — and its words a line
  lower; the money to its left, rubles over kopecks; the G-force widget (now always
  there) and the pedal lever to its right. On foot the money sits above the pack's
  slots. The Virtual dashboard
  setting is removed; Dashboard Size still scales the panel. The autopilot's mode now
  colours the panel's frame instead of the dial faces.
- THE COIN PURSE IS GONE. The 3D coin holder that the post, the shop and a lot car's
  key box took into a slot on their face is removed, with its slot and the purse image
  on the HUD. The money stays: a machine being worked debits or pays the player's
  balance directly, and a short balance still rattles and gives nothing, as before.
- THE PEDAL LEVER: THE KEYBOARD'S AND THE MOUSE BUTTONS' THROTTLE HOLDS A PEDAL. W and
  S (left and right mouse button while mouse driving) work a lever with notches
  (core/pedallever.ts): throttle 20/40/60/80 %, neutral, and the brake. Taps set a
  cruise: a W tap under 0.11 s moves the lever one notch up, the pedal easing there, and
  it stays. A hold is the plain pedal: held longer, the throttle heads for the floor for
  as long as it is held, and let go it is off and the lever in neutral. An S
  press on a throttle notch steps it down (lifting off); in neutral, or held past 0.11 s,
  S is the brake for as long as it is held — down to the car's threshold pedal in 0.1 s,
  as the keyboard brake always went — and let go the lever is in neutral with no
  throttle until W is pressed again. Held at rest it is the automatic's reverse, as
  before; a tap never reverses. The lever is drawn as a six-cell scale on the driving
  panel. Pads keep their triggers; the touch pedals keep the old ramps.
- FRONT-DRIVERS UNDERSTEER, AND NO LONGER LOSE THE TAIL ON A LIGHT TURN. The tyres'
  load sensitivity (μ(Fz)) and peak slip angle were referenced at each wheel's OWN static
  load, which normalised the weight split away: every car was exactly neutral to the
  limit, and a 0.35 s key at 80 km/h spun the VAZ-2111, 2108 and Vectra, lifted or not.
  They are now referenced at the car's mean corner load (`tyreReferenceLoadN`), one tyre
  all round. Ramp steer at 80 km/h: the front-drivers understeer ~1.3–2.2°/g, the front
  axle reaching its peak at 0.71–0.74 g with the rear short of it; the same key now
  ploughs the nose. The VAZ-2101 (51% front) is unchanged, neutral at ~0.9 g. Skidpad
  (tools/reality.ts): VAZ-2108 0.72 → 0.68 g (Car and Driver's Samara: 0.71), the
  classics unchanged; turning circles and braking within 1%; autopilot lap checks pass.
- KEYBOARD STEERING: A TAP IS A SMALL CORRECTION AND A HOLD IS A QUICK TURN, AT ANY
  SPEED. A held key's rim now gathers speed like a hand, 120°/s at the press up to
  720°/s 0.3 s in, all of it falling as 45 km/h over the speed above 45; let go, it
  eases back to centre (time constant 0.25 s) instead of snapping back at 990°/s. The
  road wheels follow the rim one to one, and nothing else steps in: no speed gearing, no
  stop at the grip angle, no BeamNG understeer/oversteer rate shares. Measured with
  tools/tap-response.ts on the VAZ-2101: an 80 ms tap 0.1–0.2 g at 60–150 km/h (it was
  0.5 g at 90); a key held 0.45 s at 90 km/h or 0.3 s at 120 asks for more than the
  tyres have, and the car slides or spins (the VAZ-2108 at 150 from 0.22 s).
- NO STEERING FREE PLAY. The backlash window (`steerPlay`, 0.003–0.012 rad by profile)
  is removed: it was a dead zone every keyboard correction had to cross. The rack and
  the tyres are one angle (`steerCommand` is gone), and every `steerLock` came down by
  its profile's play so the factory turning circles stay where tools/reality.ts had them.
- Title room: New game sweeps the camera down onto the play mat and the toy car on its
  painted road (spot `mat`, ui/titleroom.ts), not to the desk.
- THE CHASE CAMERA IS WHERE YOU LEFT IT AFTER THE CABIN VIEW. C into the seat and back
  used to bring the arm back from the seat's heading, level, springing out of the cabin.
  Now `showCabin` keeps the arm's angle round the car (as an offset from the car's
  heading, so a car that turned meanwhile keeps it), its pitch and the look-idle timer
  of its automatic return, and `showChase` puts them back with the eye placed on the arm
  at once. The zoom was already kept.
- CLOUDS DRAWN ONLY WHERE THE CAMERA LOOKS. The sky's two cloud draws held every cloud
  round the eye, the whole 26 km ring, and every render of the scene drew them all: the
  frame and each live mirror, whose view is a few degrees of sky. Before each render
  (`Scene.onBeforeRender`) the lists are cut to the clouds inside that camera's side
  planes (`CloudLayer.cullFor`; near and far untested, the clouds keep their own depth).
  Cabin at km 3, seed `flick`: 2.46 M → 1.72 M triangles a frame, the mirrors' passes
  1.40 M → 0.80 M; the picture the same within the heat shimmer's own frame-to-frame
  change.
- THE FIRST NEST ON A TELEGRAPH POLE NO LONGER LINKS A PROGRAM MID-DRIVE. A pole
  with an anomaly is a plain mesh, and its fittings (tarp and rope, nest, transformer
  can, loudspeaker) are drawn on materials nothing else draws plain; the first nest in
  view linked the plain `matDeadStick` program in the frame (17 ms on the Mac, hundreds
  on ANGLE/D3D11; seed `flick`, km 3, hurried, 160 s in). `poleProgramAnchor` now holds
  the plain pole and every fitting from boot: the same drive links nothing.
- Performance overlay: where the browser has Long Animation Frames (Chromium), every
  frame that held a long task is logged as `[perf] long frame` with the scripts that ran
  in it, longest first (invoker, function, source position, forced layout), and the
  time no script accounts for (garbage collection, a shader link, style and layout).
  The red tick says a long task happened; this line says whose it was.
- NO MORE PROGRAM LOOKUPS EVERY FRAME. Three looked a material's program up again
  (about 8 µs each) whenever one material switched between kinds of mesh in a pass, and
  twice per draw for a transparent double-sided material, which it draws as two passes
  flipping `side` with `needsUpdate`: 36 lookups a frame in the cabin at km 3 (seed
  `flick`), the mirrors' passes included. The plain pole meshes (an anomaly's pole, the
  wires) get their own `plainPoleMaterial`; the lake water, the mirage cards and the
  clear car glass draw both sides in one pass (`forceSinglePass`; a sheet or a card has
  one face under each pixel, and two panes of one tint differ only in blend order: 88
  pixels over the noise floor of 3 Mpx). 36 → 0 lookups; `renderer.render()` 2.75 →
  2.35 ms, the two mirror passes 0.50 → 0.38 ms; no program linked mid-drive.
- NO FILM GRAIN. The finishing pass no longer adds its 12 Hz grain over the picture
  (render/hazeshader.ts), in either style; the retro rung keeps its ordered dither. The
  pass's clock (`uTime`) and the Clean style's `uGrainOff` existed only for it and are gone.

- The autopilot and its benches on the new physics. FRANTIC'S GRIP RESERVE 0.72 → 0.68,
  its own margin measured on the playground lap (rally 2105, the 25% downhill 320 m
  sweeper at 165-177 km/h): 0.72 spun 14 m off the road, 0.70 ran 0.36 m wide, 0.68 and
  below 0.15-0.19 m. The planner reads `estimatedLateralAccel` less the aerodynamic lift
  on the axle that loses most of its load, and asks for it at the bend's own speed. The
  own-lane probe sees at least the obstacle stopping distance (a frantic car at 166 km/h
  found a queue at 138 m that needed 294 m); a racer's pass is re-measured whenever its
  body is over the crown, not when last step's plan said so; a committed pass may exceed
  the speed cap by its kickdown; a car on rails wakes for a driven car coming down its
  lane at the closing speed (`oncomingInLane`). NO SPAWN IN FRONT OF A COMMITTED PASS:
  `roadGapClear` reads the manoeuvre (`pass-oncoming`), not the telemetry that says
  "pass" only once the body is over the crown (a car placed 74 m ahead of a pull-out
  launched at 160 km/h into it). RECOVERY ON A GRADE THE BRAKES CANNOT HOLD: a car
  nosed into a boulder on a 23% climb creeps back at 0.27 m/s on its brakes, over the
  selector's 0.25 m/s, so R never engaged, the reverse pedal (a service brake until R
  is in) held the creep, and the pull-out waited for a roll that never stopped — fifty
  seconds. Until R is in, the reverse leg lets the car roll back and brakes only past the
  rung's pace; a pull-out with first already in arrests the roll on the launch pedal; one
  still in R asks for first while it brakes, which the selector needs at rest (the
  shoulder face-off: 28.9 → 1.4 s stopped). Bench checks corrected: the traffic driver
  mix checks the opener rule (cautious only if a direction's first car drew a sleeper,
  which a 2110 or Volga never does), not a live cautious car; playground "racing line
  across the road" measures the line out to its own half's crown-side limit — the far
  half was met only by spins since the speed-scaled edge margin (016fe82b); frantic in
  traffic is checked to pass without signalling, the racer contract since 045be201.

- Paved roads lose the endless bump wave; their bumps are discrete, rare and grouped
  (owner). The 3.33 m first-difference roughness ran under every surface, so a sealed
  deck crested every ~8 m from one end of the drive to the other. It now runs only on
  loose ground (`LOOSE_BUMP_AMP`: gravel, sand, rock, the shoulder, unchanged). Sealed
  decks get BUMP SITES instead (`world/roadsurface.ts`): heave (one 3-6 m hump), sag (one
  5-10 m dip), washboard (3-4 waves of 3-4 m) and broken patch (2-4 lumps and dips of
  2.7-4 m, road events inside it raised by 90/km), one candidate per 20 m slot, per km
  0.3→6 on asphalt, 2→10 cracked, 0.3→4 concrete from new to MAX_WEAR, each segment held
  to half the event swing cap. A ROUGHNESS ENVELOPE (400 m value noise, positive half
  scaled to mean 1 over a 0.15 floor) now spreads sites, sealed-deck road events and
  (0.6 of it) potholes, so half the road is quiet and the rest comes in rough stretches;
  it replaces the 120 m event cluster noise (loose events follow it at 0.2). Fresh sealed
  decks carry half of their sub-collider `microRelief`/`hummock`/`texture`, rising to all
  of it at MAX_WEAR (`subColliderShare`; road slabs register their wear with the
  collider). Census (4 seeds × 120 km, wheel paths, 80 km/h; `>1 cm` excursions per km of
  one path, before → after): asphalt new 113 → 2.4, worn 116 → 8.8; cracked 143-149 →
  9-29; concrete 82-95 → 4-8; 2-8 Hz RMS on asphalt 5.8 → 0.7-1.7 mm; longest run of
  bumps under 8 m apart 26 → 2-5 on asphalt; 100 m windows with no bump 0% → 60%,
  dispersion 0.99 → 4.15 (grouped). ride-bench 80 km/h asphalt 3-10 m band 5.8 → 1.1 mm,
  kick and step maxima unchanged at 2.22 m/s. surface-feel 60 km/h heave g: asphalt 0.084
  → 0.031, cracked 0.123 → 0.064, concrete 0.095 → 0.067, gravel 0.187 → 0.188.

- One physics for every car, and each part of it a mechanism (owner). INERTIA
  (`applyChassisMass`): the body's tensor is the sum of its parts — unsprung masses at
  each wheel centre, engine and gearbox from the registries at their bay position
  (longitudinal behind the front axle on rear-drive and 4×4, transverse ahead of it on
  front-drive), a full tank, the body shell as a thin shell (0.27 of kerb mass, the
  factory "масса агрегатов" tables) and the fittings between the axle lines — placed so
  the centre of mass stays on the measured weight split. Yaw dynamic index 0.88-0.93
  across the kit cars (published saloons 0.85-1.0); the box × gain it replaced gave 2.3-2.9
  to the autopilot and 0.9-1.15 to the player (`INERTIA_*_GAIN`,
  `PLAYER_YAW_INERTIA_GAIN` removed). RACK: one speed for every driver, the player's
  (classic 90°/s at the road wheel, road 117, sport 150, utility 105;
  `PLAYER_RACK_SPEED_SCALE` removed). TYRE CONTACT (`src/vehicle/tyrecontact.ts`,
  replacing Rapier's `DynamicRayCastVehicleController` in the car and the trailer): each
  tyre is a disc of its radius rounded by half its tread, swept along the strut and read
  back onto the face it touches, so a kerb lip or the next triangle is met by the tyre's
  profile instead of one ray under the hub; the spring and damper keep Rapier's law
  (rest force within 0.2%, a 10 cm drop's peak identical), the damper reading the strut's
  rate against the face under the hub. The tyre-load low-pass is gone
  (`WHEEL_LOAD_TAU`, `PLAYER_WHEEL_LOAD_TAU`): the load is this step's spring, bump
  stop, bleed, bar and links. Cost: about 20-30 µs a car a step. `setPlayerDriven` now
  only gates the driver aids. Benches: handling-cli all ok (its sand ramp lengthened to
  150 m: the car now outran the old 30 m one), reality.ts kit cars within tolerance (its
  factory sprint now shifts on the engine's real revs), roll-balance ζroll consistent
  with the analytic roll damping.

- Tyres slide at the rubber's sliding friction, not at an authored plateau (owner;
  vehicletuning.ts SLIDING FRICTION, core/surfaces.ts `SurfaceSlide`). On paved surfaces
  the brush tyre holds its bristles at the peak μ_p and slides the rest of the patch at
  μ(V_s) = μ_k + (μ_p − μ_k)·exp(−V_s / 5 m/s), V_s the patch's combined sliding speed:
  F/(μ_p Fz) = 3z(1−z)² + r(3z² − 2z³), r once the whole patch slides, both ways, with
  μ_p/μ_k 1.13 dry and 1.30 wet (ABS over a locked wheel, MDPI Sustainability 2023,
  15(8) 6945; PennDOT Little Book of Tire Pavement Friction), blended by wetness. The
  longitudinal brush keeps the old slip stiffness (unit 1.85 · optimalSlip). Removed:
  the side force's fade by slip angle to 0.7-0.88 of peak and the 0.75 locked share on
  paved ground (`SLIP_FULL_*`, `SLIP_PLATEAU_*`, `SLIDING_GRIP_FRACTION`,
  `PLAYER_REAR_PLATEAU`, `LONGITUDINAL_PEAK_FORCE`), and the side-force curve A/B
  (`?tyre=curve`, `__bro.brushTyres`, `TYRE_MODEL`, tools/tyre-ab.ts). Loose ground
  (gravel, sand, shoulder, rock) keeps the old curves as a documented placeholder
  (`LOOSE_GROUND_SLIDE`). reality.ts: skidpad kit_vaz2106 0.55 → 0.62 g (real 0.72),
  kit_vaz2108 0.66 → 0.72 (0.78); 80 km/h laden stop 36.1 → 33.4 m and 34.7 → 33.0 m.

- Keyboard steering after BeamNG's keyboard filter (owner; the idea and figures of its
  `lua/vehicle/input.lua` "Key" filter, not its code). The steering wheel is a position
  a held key moves at a constant 720°/s with no ramp-up; winding further into a turn
  the car is already making it slows by 0.7 × the lateral acceleration in g; a key
  against the turn quickens it by up to 0.7 × the recent peak (decaying 3 g/s); let go,
  it returns to centre at 990°/s at any speed. Removed: HANDS ON WHEEL (the 420°/s
  ramped hands, the 1400°/s hands toward the caster's angle, the release toward that
  angle that took a second at 25 km/h and steered a slide by itself, `HANDS_*`), and the
  countersteer assist setting it needed. Pedals, ABS and traction control unchanged.

- Keyboard pedals in two stages, quicker hands in a slide, and three driver aids
  (owner). PEDALS (`KEY_PEDAL_RAMPS`): a held throttle key goes to 0.5 in 0.12 s and to
  the floor by 0.72 s (was 1.0 in 0.25 s); a held brake key goes to the car's own
  threshold pedal (`Vehicle.thresholdBrakePedal`, fed through `InputReader.setBrakeKnee`)
  in 0.1 s and to the floor by 0.6 s (was 1.0 in 0.15 s), so a held brake stops at the
  edge of a lock before it goes past it. Releases unchanged; `tools/pedal-dose.ts`
  passes. STEERING: a key toward the countersteer turns the rim at 1400°/s reached in
  0.03 s (was 900°/s in 0.05 s), and a released wheel in a slide comes back at a 0.13 s
  time constant, capped at 1200°/s, at any speed over 10 km/h, blended in by how far the
  rear axle is past its peak (`HANDS_SLIDE_RETURN_*`): the return was scaled by road
  speed alone, so a slide at 50 km/h let go came back at half the rate of one at 100.
  AIDS (Settings → Controls, all off by default, the player's car only): ABS scales the
  brake down while a wheel locks above 8 km/h and gives it back over 0.4 s; traction
  control scales the throttle down while the driven wheels run 15% past the car's speed
  and gives it back over 0.3 s; countersteer assist puts the rim exactly where the
  caster takes it while the key is held the countersteer way with the tail out.

- The title room stops lagging and costs a fraction of what it did (ui/titleroom.ts,
  ui/roomscene.ts, ui/diecast.ts). Measured on the M2 Pro, a still title screen held the
  GPU at ~42% and froze the main thread 29 times in its first seven seconds (5.3 s in
  all, up to 325 ms each); it now sits at ~26% (~11% with no tab) with one 145 ms task
  under the launch cover. THE DIE-CAST MODELS are built in a worker
  (ui/diecastworker.ts), one kit car per message, handed back as transferred arrays;
  a model the Carcyclopedia asks for jumps the queue, and a worker that cannot start
  leaves the orders to the main thread as before. THE SHADOWS are drawn once, and again
  only when a model joins the case (`shadowMap.autoUpdate` off): the lights and the
  furniture never move, and the two shadow passes were three quarters of the frame's
  draws (349 → 76). THE FRAME is drawn only as often as it changes: full rate while the
  camera sweeps, leans (now easing after the pointer) or opens its exposure, 30 a second
  while only the dust, the lamp and the camera's breath live, and not at all behind a
  dimmed panel (settings, drives); the room's own clock advances only with drawn frames,
  so a rest never jumps. THE CANVAS has an absolute budget of 1920 × 1080 (1280 × 720 at
  low detail), so a 4K television asks for 2 megapixels instead of 8.3. EVERY PROGRAM is
  linked off the main thread before the cover lifts (`TitleRoom.ready`, `compileAsync`):
  the die-cast material through a zero-area anchor, the calendar photograph's material
  already carrying a blank map so the photograph only swaps the texture, and the
  photograph's studio compiled into its own target before it is shot. The shadow type is
  PCF: three r185 draws PCFSoft as PCF and switches the type on the first pass, so every
  program compiled ahead under PCFSoft went unused. THE WORDMARK's heat haze is stepped
  at 24 frames a second instead of animated by SMIL, which redrew the whole filter on
  every display frame.

- Mouse driving replaces precise control (owner). `M` while driving switches it on and
  off (toast "Mouse driving: on/off"; Settings → Controls → Mouse driving; saved like
  every setting and kept after leaving the car; on foot `M` does nothing). Horizontal
  mouse motion turns the steering wheel directly, 0.5° of rim per pixel up to the 485°
  stop, and the wheel stays exactly where the mouse put it: it is sent `direct`, so no
  assist, no self-centring and no caster return touch it; the road wheels go to rim /
  steering ratio at the rack's speed. Left button is the throttle, right the brake; hold
  Shift or the middle button to look around while the wheel holds. W/S, gears and the
  rest of the keyboard work beside it, and A/D nudge the held wheel. Removed: the
  Standard/Precise steering choice, `preciseSteering`, the precise wheel read through
  the pad's steering assist, and the pad's RS toggle. A saved `preciseSteering` (or
  older `mouseSteering`) on loads as mouse driving on, and a rebound `mouseSteer` key
  carries over to the new action.

- The police are gone (owner). No posts on the shoulder or the lay-bys, no UAZ-469 in the
  militia's livery, no radar, chase, siren, stop, fine or heat. Removed with them:
  `src/world/police.ts`, `src/audio/sirenvoice.ts`, `src/carkit/police.ts`,
  `tools/police-bench.ts`; the traffic stream's police duty (`spawnPolice` and the rest,
  the police car's grip share in the autopilot, the player-impact count that told the
  police of a collision), the shoulder pull-off (world/layby.ts), the `[F]` papers prompt,
  `__bro.police`, the `police_heat` delta and `PlayerState.police`. The police UAZ's
  catalogue, factory, price and fit rows went too, with the kit machinery only it used:
  livery paint (slot `livery`, `CAR_LAMP_LIVERY`; the kit shader's role is a `vec2`
  again) and the light bar's beacon channels. A save from the police days loads with its
  heat dropped, and a car saved on `kit_uaz469_police` loads on the plain `kit_uaz469`.

- A handbrake slide that touches another car carries on. The parking hold, which pins
  a stopped car where it stands, latched on the speed along the nose alone, and a car
  sliding broadside has almost none: the moment a glancing contact swung its heading
  square to its path, the hold took and zeroed its motion every step, so the car
  stopped dead against the traffic car it had brushed. The hold now latches only when
  the whole ground speed, and the yaw at the axles, are both down to a creep (0.12 m/s).

- An engine goes back into the bay again. The boot's 0.8 m length limit (which sends a
  rolled carpet to the back seat) was also checked on the bonnet's cells, and nearly
  every engine is longer than that (a 1.6 four is 0.88 m), so [F] install was offered
  and then refused.
  The limit now applies to the boot only; a bonnet cell takes what its slot kind takes.

- The car the player drives is a real car now, not a safe one. The steering keys are
  hands on the steering wheel (vehicletuning.ts HANDS ON WHEEL), and the wheel goes
  where the caster takes it: the angle at which the front wheels roll along the front
  axle's own travel, straight ahead running straight and the countersteer in a slide
  (faded to straight under 10 km/h and backwards, smoothed over 50 ms). A held key
  turns the rim toward that angle at 900°/s (ramp 0.05 s), the self-aligning torque
  helping the hands, and away from it at 420°/s (ramp 0.1 s); both keys together hold
  it where it is, and the road wheels follow through the car's own ratio (970° lock to
  lock over its lock: 12.8:1 to 18.6:1) up to the lock. Let go, the caster spins the
  rim to that angle at |offset| / 0.25 s scaled by speed up to 100 km/h (at most
  720°/s, never past it, hardly at all at a crawl), so a rear-drive car let go of in a
  slide catches itself and a quick key can catch it too. Nothing in it knows where the
  tyres' grip is: hold a key too long and the front ploughs or the tail goes. It
  replaces the keyboard assist that wound a hold toward the front tyres' peak slip
  angle (`KEY_STEER_*`, its wind-up, return, release delay and past-peak wind-up, all
  removed). The pad and the precise-control wheel keep their own steering, assist
  included. The car also reads four figures of
  its own (`PLAYER_*`): rack speed ×1.5, the rear axle's past-peak plateau at most 0.7
  (a dry tyre's low end; the front keeps its own), yaw inertia on the plain box (gain
  1.0 for 2.55; pitch unchanged) and an 8 ms tyre-load filter for 25 ms, so bumps
  mid-corner reach the grip (the 16 cm contact patch is unchanged). They apply only
  while the player drives with their own hands (`Vehicle.setPlayerDriven`, rebuilding
  the yaw inertia on a change of driver): traffic, rivals and the autopilot keep
  the catalogue's figures they were tuned on. `tools/steer-feel.ts` and
  `tools/tap-response.ts` now drive the player's car with the hands.

- Money is rubles and kopecks, held in a purse instead of coin items
  (`src/economy/economy.ts`, `src/render/purse.ts`, `src/ui/purse.ts`). Every amount is
  integer kopecks (`PlayerState.money`, the `money` delta) and reads `3р 50коп` on cards,
  plates and boards. The purse (монетница) is the Vyborg pocket coin holder with six
  tubes, 1, 5, 10 kopecks and 1, 2, 5 rubles, each showing the coins the balance comes to.
  It shows in the top-right corner on foot within 10 m of a POST, a SHOP or a lot car's
  key box; working one of them seats the 3D purse in the machine's slot, and the machine
  debits it there (short: nothing given, the SHOP card says so) or pays a delivery into
  it. The key box is now worked up close too: its lever takes the whole price at once.
  Police fines come straight out of the purse. New prices: petrol cans 50коп + 40коп a
  litre, gum 15коп, spray 1р 20коп, shades 3р, stickers 50коп, filter 2р 50коп, radiator
  9р, gearbox 18р, turbine 30р, engine 35р; deliveries 3р to 11р; cars 25р to 150р
  (Oka 30р); start 4р 50коп; fines and race wins a ruble per old coin.
- Whatever a machine gives — cargo, haul papers, goods, sticker envelopes — lies in its
  tray, never in the hand, and the camera steps back from the machine as it drops. The
  POST's tray is painted `▼ HAND CARGO IN HERE ▼`, and worked with cargo for here the
  window shows a HAND-IN card first (`PUT THE PARCEL IN THE TRAY` and its pay, or why the
  tray will not take it).
- Saves are version 3: coin items anywhere (pack, ground, boots, cabins, post stock) turn
  into purse money at a ruble a coin, and lot cars take the new prices.

- Every lay-by's signpost is painted like a licence plate of its region
  (`src/world/signplates.ts`): a dark header strip spelling the desert's name, a pale
  field with the desert's emblem (mesa, dunes, rising sun, power line, saguaros, palms,
  crescent moon and stars, volcano), a ground band and a frame. The tones are the
  desert's own sand hue at fixed lightnesses, so every stop in one desert wears the same
  plate and the next desert's differs; a dark desert gets the plate turned over, pale
  letters on a dark field. Letters carry a halo of the field's tone to read over the
  emblem. Each of the 28 deserts in `src/world/gradient.ts` has a `name` and an
  `emblem`, and `desertAt(s)` answers the desert a stretch of road belongs to (the
  nearer one across a blend). Behind the first stop the board no longer says "Home": it
  paints the turning circle as a ring, `← ◯ 0.5 km` (`RING_GLYPH`), a heavy doughnut
  drawn on the canvas rather than a letter O. The board, its backing and its posts no
  longer z-fight: the board stands 2.5 cm before the backing and the posts 2 cm behind
  it, where their fronts used to be flush with its face (`BOARD_STANDOFF`, `POST_GAP` in
  `src/world/signposts.ts`). The backing wears the plate's frame colour. Every board
  still shares the market sign's one program.

- The start settlement's lay-by is always on the right of the road, the power poles'
  side (`roadsideSlot` in `src/world/poislots.ts`, slot 1); every other stop still rolls
  its side.

- The asphalt is a quiet dark mat with single pale stones in it instead of a speckle
  over the whole surface: the chip-seal detail keeps only the stones that stand well
  proud (`DETAIL_CHIP_FROM`/`TO` in `src/render/roadtexture.ts`, binder flat), the macro
  tile keeps a third of its own chip grain (`COURSE_CHIP_TONE`) and less contrast
  (`ROAD_TEXTURE_CONTRAST` 2 to 1.5), and the stones fade into the mat's tone between 8
  and 30 m (`CHIP_FADE_*` in `src/render/roadlook.ts`), the way the desert's specks are
  only seen near. Pours, bleaching, patches, seals, wheel tracks and the oil strip are
  unchanged. Gravel lanes take the same detail. Compared in the road lab
  (`/?road-lab&pick=paint|gravel|worst`) at noon.

- The start is an ordinary settlement: post stop 0 stands at `START_POST_S` = 500 m
  (`src/world/poststops.ts`), half a kilometre up from the turning circle, with its
  houses, lay-by, POST and SHOP like every other stop, so the first contract is at the
  start. A new game parks the Oka on the lay-by's parking line at the stop, between the
  machines and clear of the places traffic parks, puts the player on foot beside it
  facing the post, and lays the 2-4 keepsakes on the pad (`src/story/site.ts`). The
  next stops follow at 2.5-4 km. The story house, its yard junk, the airfield and the
  parked plane are gone from the world, and with them `storyKeepsClear`. The runway and
  plane are kept, unplaced: `src/story/airfield.ts` (`AIRFIELD = null`, `airfieldAt`,
  `runwaySurfaceY`) and `AirfieldProvider` (`src/story/sitebuild.ts`); main streams it
  and wires boarding to the takeoff and the ending only when one is placed, so the
  ending is unreachable for now. An old save keeps its car and position, but every
  settlement has moved 0.5-1 km nearer the start. `tools/poi-placement.ts`
  checks the new start over seeds 1-12 (and builds `PoiProvider` with its current
  arguments again).

- A new game is clear: no haze, wind, dust or storm until the player has first driven
  15 km past the start, post stop 0 (`CLEAR_START_M`, `weatherBeginS` in
  `src/world/weather.ts`). The weather schedule's clock starts at that moment
  (`WorldState.weatherFromS`, the played second it began, set once by the `weather_begin`
  delta), so the first episode ramps in from its start instead of being joined halfway.
  From then on it rotates as before: ten-minute slots, one in four clear, the rest an
  episode filling 50-80% of its slot (heat 21% of slots, haze and wind 15% each, storm 13%,
  haboob 11%). An old save without the field keeps its schedule from zero if its furthest
  point is already past the gate, and starts clear otherwise. `__bro.weather.force` works
  before the gate too. The aero and autopilot benches stay on the schedule from zero.

- The road looks the same on every kilometre: gravel lanes, dust on worn asphalt, hole
  floors, the graded windrow and ghost lines on gravel use one fixed gravel colour
  (`ROAD_GRAVEL_LINEAR` in `src/world/roadmesh.ts`, the opening palette's `#9c7652`)
  instead of the regional desert palette, which ran from near-black on basalt to pink.
  Lay-bys follow (`roadLaneVertexColor` lost its `s`).

- The postcard from home is gone: a new game starts with the coins only. The item, its
  two painted faces, the read/flip view and the dev spawn entry are removed, and with
  them `src/i18n/` (its note was the only translated string, so `?lang=` is gone too).
  An old save's postcard, or the `letter` before it, is dropped on load
  (`isRemovedLegacyItem`).

- POI spacing: the first settlement (post, shop, sometimes a car for sale) stands 1-1.5 km
  from the house, the next three 2.5-4 km apart, every later one 2.5-8 km
  (`src/world/poststops.ts`). Roadside slots now follow the post network
  (`src/world/poislots.ts`): slot 2k+1 is post k, slot 2k+2 a lone house in a gap of 5 km or
  more, never within 2.5 km of a settlement. Desert POIs keep their own lattice
  (`desertPoiSpacingMetres`). Roadside `Poi.index` moved to a new base, so an old save's
  looted flags no longer name the wrong stop.
- POST and SHOP are one card machine (`src/world/cardmachine.ts`), bigger and deeper, with
  English labels. F frames it in the camera and frees the cursor
  (`src/player/machinefocus.ts`); nothing is written on screen while it is worked. The
  side crank is dragged round with the mouse, without a stop: each quarter turn drops the
  next card in a split-flap window (the wheel turns it too). One button gives into one
  tray; the post's tray also takes cargo in. The post gives any of its four offers at any
  time, with no licence and no "free your hands first", and replaces a taken offer with
  the slot's next round (`nextOffer`), so it never runs dry. The shop shows the carded
  ware in a showcase and takes its price from the pack. Licences (`licenceFor`) removed.
- A car for sale is locked until bought: no door, bonnet, boot, flap or compartment
  answers the aim.
- Fixtures' moving parts (key box lever, drawer, coin and key; barrel tap) write their
  matrices: the chunk froze them, so they never moved on screen.
- Dev pause menu: "Get 100 coins".

- The start site's runway strip no longer links a shader program mid-drive
  (`src/story/sitebuild.ts`). Each build of chunk 0 cloned the road material for the strip
  and disposed the clone with the chunk; the strip's vertex colours and UVs make a program
  no other mesh uses, so the dispose freed it and the next build linked it again (seen as
  program 43 freed, then 121 linked, after a jump away from the start). The strip now
  shares one material for the session that is never disposed. Checked on New game, a jump
  to km 14.6, a drive, a jump back to the start and away again: 0 programs freed or linked.

- Soviet wheel sets are drawn in the Standard atlas material (`makeUnifiedAtlasMaterial`,
  until now only behind the DEV `?carstyle=unified`), not in the FBX pack's Phong: the
  atlas cells make the tyre rubber and the rim painted steel, lit like the rest of the car
  (`shareWheelMaterials`, `src/render/carmodel.ts`). Phong is gone from the game: its two
  programs became two Standard ones, 105 programs at boot as before, none linked over a
  minute's drive.

- The «ПОЧТА» machine replaces the couriers (game-design2.md §7, §6.6; `src/world/post.ts`,
  `src/world/poststops.ts`, `src/contracts/offers.ts`, `src/world/poi.ts`).
  - The courier stop network stays as the POST network (`world/couriers.ts` →
    `world/poststops.ts`: `postStop`, `postStopsBetween`, `nextPostIndex`, `isPostPoiSlot`,
    `postId`; same seed draws, so saved `sourceCourierIndex`, contract ids, pay and race legs
    are unchanged). Every settlement's `post` spot gets a blue cabinet under a «ПОЧТА» board
    with a lit display, a SELECTOR WHEEL (F: one animated click to the next offer still in
    stock; the display shows name, destination place name and km, coins, cargo kind, tier),
    a RELEASE LEVER on its flank (F: the offer drops into the TRAY behind a little hinged
    door — a teddy party one teddy each; a haul's papers go straight into the hand and its
    trailer or car waits on the lay-by; without the licence, or with full hands for papers,
    the lever jams and rattles back and the prompt names why), the TRAY DOOR (F opens and
    shuts it) and a DROP-OFF HATCH with a hinged flap (F posts the cargo in hand: coins into
    the pack, the signed sticker envelope into the tray; a haul is handed in with its
    trailer or car on the lay-by and its papers in hand, in the pack or in any boot; teddies
    one by one, the last completes the party). All parts animate; new foley event `click`.
  - Registered parcels: 15% of parcel offers (never the drive's first job) carry a
    six-digit `registeredPin` printed on the label; the hatch opens the rotary dial
    (ui/dial.ts, game held still) and posts once it is dialled right. Offers also carry
    `destination` (the target post's place name) on the label: `easy run: parcel → Tinderly`.
  - Stock persists in `WorldState.courierStorage` (saved key kept) as the four offers by
    slot (null once released), `courier_storage` delta as before (now autosaved). A courier-era
    save's boot reads the same way (`postStock`): an offer is in stock while its item is in
    any cell, and whatever else was left in the boot comes back through the tray when its
    door is first opened. `ContractPlace` 'courier' is 'post'; `DeliveryProbe` is
    `targetPostIndex`/`postX`/`postZ`, the post's haul place on the lay-by
    (`contracts/world.ts postHaulPlace`, `layby.ts laybyHaulLateral`), which is also where a
    haul's trailer or car now spawns. The race is keyed by `contractIdOf`; rivals hand in
    at the post's lay-by as before. HUD route line: `POST · Tinderly 9.2 km`.
  - Settlements now build the post, the barrel stand at `barrels` (settlements and lone
    houses that roll one) and a key box 0.65 m beside every lot car's price board while the
    car is for sale. All of kit boxes/cylinders and sign boards: `marketProgramAnchor`
    links them at boot; the display is one sign-shaped material per machine, repainted.
  - Removed: the parked courier car (`COURIER_MODELS`, `buildCourier`, `CourierField`,
    `createCourierCarModel` and its rim shader variant), the cactus air dancer
    (`world/props/airdancer.ts`, `DancerField`, `audio/dancervoice.ts`,
    `GameAudio.updateDancer`), the courier boot grid and its delivery path in `Interaction`,
    the roadside-shell code (`WreckTrunkField`, wreck lids, `wreckStorage`/`wreckBonnet` and
    the `wreck_*` deltas — ignored in old saves), `render/staticlids.ts` and static-shell lids
    (`kitRestSkeleton`/`kitRestMesh`, `STATIC_SHELL_DOORS`), `StorageOwnerKind` (a storage
    grid is a car's), `layby.courier`, tools/wreck-lids.ts. Dev: `__bro.standAtPost(i)`,
    `__bro.postAt(i)` (was `courierAt`), `__bro.fixtures`. tools/trunk-grid.ts checks a
    courier-era save loads.
- Teddy-bear passengers (game-design2.md §10, §11; `src/contracts/kinds/teddyPassengers.ts`,
  `src/vehicle/cabin.ts`, `src/trip/ride.ts`, `src/economy/economy.ts`).
  - A new contract kind, `teddy_passengers` (non-haul, weight 2). Each offer rolls its party
    from its seed, 1–3 teddies, fixed. The offer item carries `party { id, size }` (its own
    id) and `shape: 'teddy'`; the post machine releases the party as that many physical
    teddies (`contractRelease`), ids `<offer>:teddy:<k>`, 0.6 kg each, all sharing the
    party. Labels read `… teddy passenger · party of 3`.
  - A party is ONE contract: `contractIdOf(item)` is the party's id, and the car's contract
    slots (interaction `contractSlotsRefusal`) and the police waybill (`contractsAmong`)
    count contracts, not items. A second teddy of a party already aboard takes no slot.
  - Teddies sit only on a passenger seat of their own: the front passenger's or a half of
    the rear bench (`layPlace(…, passenger)`, `SIT_ON`), upright and facing forward, never
    the whole bench, the floor, the boot, the bonnet or the driver's seat ("passengers ride
    on a seat"). Every kit car (all 27 in `KIT_SPECS`, the Oka included) has all three
    places with room for a teddy unturned. Nothing makes them leave the seat.
  - While the party rides in the car the player drives, `trackPassengerRide` accounts it in
    the `RideMeter` under the party id (`track(key, comfort, harsh)` now takes the ride
    already had) and writes comfort and harsh moments onto each teddy's saved progress,
    so a reload mid-trip keeps the ride; the G widget shows (`rideSensitive`).
  - Delivery is one teddy at a time through the destination post's slot
    (`contractPosting`): each posted teddy is recorded by its own id, and the last of the
    party completes the contract, pays and is counted once in the ledger. Pay is 4 coins
    base, +50% per passenger past the first, × km index × ride quality (comfort less 10%
    per harsh moment, never under 40%). The toast reads `Passengers delivered — smooth ride
    · 9 coins` or `… 2 harsh moments · 6 coins` (`contractDeliveredText`).
  - Dev: `__bro.teddies(size?)` drops a party in front of the player.
- Roadside settlements; wreck fields and the fallen tower are gone (game-design2.md §6;
  `src/world/settlement.ts`, `src/world/poi.ts`, `src/world/layby.ts`, `src/world/poislots.ts`).
  - Every courier/post stop is a SETTLEMENT: 4–7 houses of ONE dwelling type (the slot's
    roll; a mast or a ruin re-rolls among the lived-in dwellings), on both sides of the
    road, each facing it with its own setback (10–22 m verge) and a 5–10 m gap to the next,
    within 75 m of the stop. On the lay-by's side the houses stand at both ends of a
    service strip; the far side gets one row, dropping houses from its end until it fits,
    so big buildings make smaller settlements. Every other roadside slot is one house as
    before; desert stops are one house and nothing else.
  - `settlementLayout(seed, poi)` (pure, memoised) gives the houses and the service spots
    in the road frame (`{ s, lateral, yaw }`, yaw relative to the road heading;
    `spotPose` makes them absolute): `post` and `shop` at every settlement, `barrels` at
    half of them and a fifth of lone houses, `lot` (car for sale) at 30%, `trailer` at
    10%. Houses are packed by their MEASURED size, written down in
    `src/world/dwellings/bounds.ts` so the layout stays worker-safe.
  - A settlement's lay-by is longer (60 m pad, always 8.5 m wide; slips unchanged) and its
    levelled site covers the strip and the houses on its side; the far side's houses sit
    on their own fitted plane like a desert house. Traffic, the courier and the signpost
    use it unchanged. Scatter, ground cover, poles and delineators keep out of every
    stop's houses and out of the service strip (`laybyKeepsClear`).
  - Built: the houses (`standingHouses` drops one on a landform, mesa, lake basin, another
    pass of the road, or curved into an earlier one), the vending machine at `shop`, the
    lot car (`lot-car` id) with its price board at `lot`, a trailer at `trailer`. The
    post, barrels and the lot's key box are left to their own builders at those spots.
    No vending machine at lone or desert houses any more.
  - Removed: wreck fields and buried shells (`buildWrecks`, `layOutWreckField`,
    `salvageKeepOut`, `WreckKeepOut`, `poiAt`, tools/wreck-spacing.ts), the per-stop
    `PoiStock` roll (nothing read it any more), `courierParkingLateral`,
    `DANCER_ALONG_M`/`DANCER_OUT_M`, and `fallen-tower` from `MAST_IDS` (it stays in the
    POI gallery). The `WreckTrunkField` registry and wreck storage state remain but
    nothing registers into them.
  - tools/poi-placement.ts checks seeds 1–20 × 300 km: no house in a house, on any pass
    of the road, on the lay-by's asphalt or on a service spot; no service on the asphalt
    or in another; the bounds table against the built houses.
- One МАГАЗИН machine, barrels, empty cans (game-design2.md §8, §9; `src/world/vending.ts`,
  `src/world/barrels.ts`, `src/items/items.ts`, `src/economy/economy.ts`).
  - The FUEL/PARTS/GOODS assortments and their colours are gone: every machine is the same
    blue cabinet under a «МАГАЗИН» board. Its 12 slots hold, by the stop's seed, 1–2 spray
    cans (their paint in the window), sun shades (lens tint in the window), an air filter,
    a turbine, 1–3 empty cans of 5/10/20 L, 1–2 packs of gum and 4–5 sticker envelopes of
    random kinds, each kind present by its own roll; slots past the last ware stay empty.
    Oil and water bottles, medicine, radiators, engines and sponges are no longer sold.
    Machines still never restock; a slot sold in an older save stays sold.
  - The FUEL machine's nozzle, hose and PETROL price board are removed, with `PUMP_SLOT`,
    `pumpFuel`, `pumpPrompt`, `VendingMachine.pump`/`title`, `vendingAssortment` and
    `fuelPricePerLitre`. `PRICE_TABLE` drops fluids by the litre, sponge, medicine and ammo;
    an empty can is 1 coin + 0.1 per litre of capacity, sun shades 4 (× km index as before).
  - A can holds no fluid until one is poured in: `FluidCanItem.fluid` is `FluidKind | null`,
    null exactly when it is empty (`fillCan`/`drainCan`/`canTakes`). Pouring out the last
    of it empties it for any fluid; an empty can lying on the ground takes whatever is
    poured into it (`loose_item_fluid` carries the fluid). Labels read `empty 10 L can`.
    Every can is one khaki jerrycan, since its colour can no longer say what is in it.
    Saves: a can saved with 0 L forgets its fluid on load.
  - `buildBarrelStand(ctx, poi, x, z, yaw, group, bodies, colliders, fixtures, registered)`:
    three immovable drums on a timber rack, red PETROL, amber OIL, blue WATER, stencilled,
    static colliders, kit/sign materials only. Each drum is a world fixture with two parts:
    its tap (hold F with a can in hand: the handle turns open a quarter round, a stream
    runs and the can fills at up to 0.25 L/s until it is full or the drum is dry; a can of
    another fluid is refused) and its body (F knocks: "sounds hollow" / "something sloshes
    inside"). The tap prompt shows the can's litres and only "barrel low" (< 1 L) or
    "barrel empty". Contents are drawn from the world seed and the barrel: ~25% dry,
    ~20% 0.3–1.2 L, else 1.5–3.5 L. What the taps leave is saved in
    `WorldState.barrelLitres` (`barrel_litres` delta; absent in older saves = untouched).
    The stand places nothing by itself: the settlement builder calls it at its `barrels` spot.
- The title room is a Carcyclopedia, not a hub (game-design2.md §3). Its list is
  Continue (the window; only with a save, loads the latest), New game (the desk), Drives
  (the keys), Carcyclopedia (the wall case) and Settings (the toolbox). Daydream, the
  Adventures map, the Shelf of dream toys and its price cards are gone, and with them
  `adventuresMap`, the dive into the mat and every dreams import in `ui/`. A wall case of
  four tiers over the desk holds a 1:43 die-cast of every car in `CAR_MODELS` in its
  factory colour; the Carcyclopedia panel lists them and turns the camera to the model
  chosen, beside a card of what the catalogue knows (engine power and torque, gearbox,
  driven wheels, kerb mass, tank, dimensions, clearance). The room hints instead of
  telling: textbooks, an exercise book open on ballpoint cars drawn over the sums, a
  printed textbook, pencils, a pen, erasers, a ruler and a pencil cup on the desk, and
  four crayon drawings of cars and roads pinned to the walls; the calendar moved over the
  bed. The toy car on the play mat stays as decoration. `PauseHooks.saveDrive` is no
  longer nullable.
- One world: the dream layer is gone. `src/dreams/` (dream definitions, the run, its
  view and closing card, progress, parcel terminals, bay markers) is deleted, and with it
  `NO_COURIER`, the dream resume target (`dreamResumeTarget`/`resumedDreamId`),
  `PoiProvider`'s courier-free stops, `MirageSchedule`'s stretch, `PolicePatrol.postsEnabled`,
  `RoadTraffic.share` and the old `InteractionFixture` list in `Interaction` (world
  fixtures stay). The title's choice is `load | new`: Continue loads the last drive, New
  game starts a fresh saved world on the Oka; every drive autosaves and the pause sheet
  always has «Save drive». The rotary dial moved to `src/ui/dial.ts` for the post machine.
- Nothing falls off a seat any more: `CabinRide`, `slipAt`, `FALLS_TO`, the cabin's fall
  animation, `ContractRuntime.fell` and the «slid off the seat» / «knocked about» toasts
  are removed. A thing stays where it was laid however hard the car is driven.
- Ride quality (`src/trip/ride.ts`, `RideMeter`): each fixed step of the car the player
  drives, its world velocity is differenced and turned into the car's frame, smoothed
  over 0.25 s: `longitudinal`, `lateral`, `magnitude` (m/s²). Comfort drains above
  2.5 m/s² and a harsh moment begins above 3.5 (the old trip record's thresholds).
  Contracts can `track(key)` / `comfort(key)` / `harsh(key)` / `forget(key)`; records grow
  only while the player drives. `rideSensitive(item)` names what minds the ride (the
  fragile radio, a lamp, a teddy bear).
- G-force widget on the HUD (`Hud.setRide`): a small round instrument in the bottom-right
  corner (top-right on touch), up while the player drives a car carrying something
  ride-sensitive, cabin view included. The dot is the push on the load (up the face when
  braking, right in a left bend) over calm / uncomfortable / harsh rings; it turns amber
  and red with them, and the outer ring flashes on each harsh moment.

- Car lots: a car for sale is bought by hand at a key box on a post beside its price board
  (`src/world/keybox.ts`, `buildKeyBox`). Hold F at the coin slot to feed coins one by one
  (a clink per coin, faster as the hold goes on; a window on the box fills as they stack);
  the prompt shows paid/price and the coins left in the pack. F on the lever pulls it: short
  of the price it jams and springs back and the prompt says how many coins are missing;
  paid, it goes down, a key on its tag drops inside and the drawer slides out with it. F on
  the drawer takes the key: the car is bought (`car_buy`), its board comes down and the
  drawer slides shut. Coins already fed are kept in `CarState.lotPaid` (new `lot_pay` delta,
  read by the save), so a reload never eats them. F on the lot car itself no longer pays: it
  refuses, and its prompt points to the key box. `lotOffer` is now `lotModel`: whether a stop
  has a lot is its settlement layout's call. New foley event `coin`.

- Dreams, the first mission layer (`src/dreams/dream.ts`, `view.ts`): the title screen leads
  with «First delivery»; it starts at km 12 of its own seed with a VAZ-2106 on the verge and
  ends 8 km on, when the car stops at the goal. The road between is free to drive both ways;
  70 m off the road, 400 m behind the start or 600 m past the goal, the picture blurs and
  pales and after 8 s the dream ends on a «Wake up» card that returns to the title. Dreams
  are never saved. «New drive» is now «Free drive» and is unchanged.
  A green sign 40 m ahead of the car names the goal and its distance; a gate over the road
  marks the goal itself («STATION / STOP HERE», `src/dreams/markers.ts`). Both are built from
  the market sign kit, so no shader program links on the way (101 programs at the start
  and at the gate).
  The dream asks for its parcel: a «medical parcel» (`contract_cargo`, `NO_COURIER`) waits
  on the verge behind the boot, the goal counts only with it in the driven car or in hand,
  and no courier will sign it. The goal line says where it is when it is not aboard.
  A dream sets its sky and its police: the first one starts at 10:00 under a
  clear sky held for the whole run (`forceWeather`), with no police posts on the road
  (`PolicePatrol.postsEnabled`).
  Start and goal are parking bays on roadside lay-bys, deep on the pad where the stop's
  courier would stand (no courier parks on a dream's two stops): a dashed white frame,
  the car in it at the start. The run begins when the car has wholly left the start bay
  and ends when it stands in the goal bay; the gate and the start sign are gone. The
  first dream runs from the stop at km 7.7 to the one at km 15.4.
  The parcel waits in a parcel terminal standing at the front of the start bay (one
  window, a screen with its six-digit PIN, also printed on the parcel's label); [F]
  takes it. At the goal bay, with the car parked there, [F] on the other terminal opens
  a rotary dial (`src/dreams/dial.ts`): drag each hole round to the finger stop, or
  type the digits; a wrong digit clears the number, Esc hangs up. Six right digits
  open the window, the parcel goes in and the dream ends (`src/dreams/terminal.ts`,
  through the new `InteractionFixture` hook).
- Place names and signposts, in the free drive too: every roadside stop is named from a
  hand-written list of 240 (`src/world/placenames.ts`, shuffled per seed, neighbours never
  alike), and every lay-by has a green board facing the road with the stop's name and the
  stops either way, arrows as the driver reads them and road distances
  (`src/world/signposts.ts`). A dream names its goal from it: the first one runs from
  Hollow Spoon to Tinderly, and the parcel's label and the start terminal say so.
- The dream's closing card says how the drive went (`TripRecord`, dreams/dream.ts): the
  time and petrol from bay to bay, the parcel's condition (knocks to the car while it is
  aboard wear it), the ride (smoothed horizontal acceleration: comfort falls above
  2.5 m/s², a harsh moment above 3.5) and the car's new scratches.
- Dream progress (`src/dreams/progress.ts`): finished dreams are recorded in browser
  storage apart from the drive saves, each with its best time, ride and cargo condition;
  the title shows them and opens the dreams in order. The second dream, «Handle with
  care», carries a glass lamp (`fragility` 3: knocks wear it three times harder, a harsh
  moment 6%) in a Niva at 17:00 in the heat, Fumble to Inchworm, 15.4 km.
- A dream sets its traffic, its mirages and its clock (`DreamDef.traffic`, `mirages`,
  `deadline`). Traffic is a share of the machine's ceiling (`RoadTraffic.share`); mirages
  stand only between the two bays, at most one per 3 km (`MirageStretch` in
  render/mirage-schedule.ts; the free drive's schedule is unchanged), none in the first
  dream. A deadline is an average speed plus a minute for the terminal, counted from the
  start bay: the goal line shows the time left or how late, a soft one still delivers
  («Late by 0:40» on the card), a hard one ends the dream «Too late». Two new dreams:
  «A car to Grandad» (a Volga at sunset, nothing to carry, light traffic) and «Before
  the lunch break» (spare parts in a 2108 at noon, busy road, police, soft deadline).
- A graphics change that reloads the page (Very Low and back, grass on or off) inside a
  dream brings back the same dream from its start bay instead of the free drive
  (`dreamResumeTarget`, save/resume.ts); the pause sheet in a dream has no «Save drive».
- Cargo in the cabin (`src/vehicle/cabin.ts`, `CarState.cabin`): the front passenger's
  seat, either half of the rear bench or the whole of it, and the floor in front of
  them. Every kit car marks them (`kit_place:<place>`, carkit/interior.ts), each room
  cut clear of the finished car (carkit/places.ts; `tools/cabin-places.ts` checks all 27
  cars), and a thing lies there only if it fits, so nothing stands in a seat. Through
  an open side door F lays a contract's cargo on the seat looked at, or takes what lies
  there; nobody sits on a taken seat. Things ride with the car and are drawn through
  the glass (vehicle/cabincargo.ts); a hard stop (about 0.4 g) or a hard turn slides
  them off onto the floor (`CabinRide`), which costs a dream's cargo 5% per unit of
  fragility and a courier's radio a drop. A rolled carpet is too long for the boot and
  for the front seat: it goes across the whole rear bench. Fifth dream, «Grandma's
  carpet», carries one at night in a 2107, Forsook to Ashcan.
- A dream's cargo has a look of its own (`ContractCargoItem.shape`: carpet, teddy, lamp):
  «Handle with care» now carries a real table lamp with a milk-glass shade, and a sixth
  dream, «A bear for a birthday», a teddy bear in a Moskvich-2141 in a light wind,
  Clatter to Dimwell. Flat materials only: no new shader programs.
- The title screen is the boy's room at night in 3D, after the first Mafia's menu
  (`src/ui/titleroom.ts`, `roomscene.ts`): a plain list on the left, and the camera
  sweeping low across the room to each item's thing. Daydream (the play mat and the next
  dream's die-cast car on it; choosing it takes the camera down to the toy's road and
  fades into the dream), Dreams (the map under the desk lamp), Shelf (a 1:43 die-cast
  of each dream dreamt, built from the kit), Drives (the car keys by the door), Free
  drive (the window, the moonlit desert road), Settings (the toolbox). Moonlight through
  the window, the desk lamp, a night-light, dust in the beam, a ticking clock. Its own
  WebGL context, released before the drive builds its renderer.
- The title room, second pass (owner's notes): adventures, not dreams, in every word the
  player reads; the play mat painted as the opening desert (its sand, crests, poles,
  cacti, a mesa) with only the toy car standing on it; an articulated desk lamp aimed at
  the map, casting no shadow of itself; the shelf clear of the curtain and a Lada 1600
  calendar (1986) whose photograph is the kit's 2106 rendered at load; a deep double-
  glazed window onto a real night outside — a road passing the house, poles and wires,
  cacti, mesas, the moon; a proper bedside table and a «Маяк» alarm clock at 10:08. No
  coplanar overlapping faces left in the room (checked by a scan of every triangle).

- Door mirrors on short arms (owner): an arm now runs from the foot on the door's skin
  (2 cm under the belt) into the head's centre, so no head hangs in the air; the UAZ-2206's
  mirrors, whose foot met no skin at all, sit on the door (`src/carkit/exterior.ts`).

- Opel Astra F / Vectra A (owner): no black triangle at the A pillar (the mirror's sail in
  body colour); the front bumper's foot at the sill line, not under the body; a narrow dark
  strip between the tail lamps instead of the full-height black panel (`src/carkit/opel.ts`).

### Added

- Samaras, Oka and Nexia to their drawings without `corner` exemptions (`src/carkit/samaras.ts`,
  `oka.ts`, `daewoo.ts`). 2108/2109/21099: the bonnet starts at the face (`bonnetFront` 0.11,
  `frontLean.full` 0.17) so its lip is at 0.173 (drawn 0.164) with no level strip and dent
  at s 0.17; head lamp to ±0.618 (its wall 5 mm off the indicator's fought under the open
  bonnet). Oka: the wings' top under the clamshell at the front view's ±0.667 from s 0.27,
  in line with the glass's foot (the s-bend at 0.54 / 0.89). Nexia: the belt runs in from the
  cabin's ±0.765 to the tail (0.765 / 0.755 / 0.745 at 3.96 / 4.15 / 4.30), not out and back.

- VAZ classics owner fixes (`src/carkit/specs.ts`, `estates.ts`, `body.ts`): 2105/2107 boot
  and tail back on the drawn deck (0.854 / 0.795, not 0.90 / 0.87) with the rear wing's
  edge low to the bumper (sill 0.31 at s 3.9); no black A-pillar insert on 2102/2104/2105/2107
  (the strips ahead of the door's drawn front are body-owned, so no frame rubber edge or
  belt slot shows); 2102/2104 tailgate glass foot at 0.91 over a painted band (knee at the
  glass's foot); 2104 tailgate cut between the lamps (`notch` 0.50), the painted stopgap
  panel removed, and the estates' D-pillar knee bands folded outward (`flat`-tail hatches only).
- VAZ 2102/2104 tail corners and 2105/2107 tail (owner): leaning tails are cut at the lean's
  base before the warp, so no slit opens down the estates' tail corners (`kit.ts` `leanEnd`);
  the estates' D-pillar bands under the knee fold outward unlined and the load space's side
  wall ends at the knee, so no beige sliver shows over the 2104's lamps (`body.ts`, `bay.ts`;
  2111/2112 share the code); the 2105/2107 boot turns down in its last 4 cm to an upright,
  taller tail face instead of a 45° chamfer (`specs.ts` `BODY_05`).

- KIT CAR OWNER REVIEW 2: removed the rejected black A-pillar wedge from the shared
  2104/2105/2107 body, made every mirror support enter the body skin (with a shell-overlap
  gate in `tools/kit-mirrors.ts`), and raised the UAZ-469/UAZ-2206 front overhang above the
  bumper. Existing dashboards stay accepted; future kit cars require a sourced dashboard
  photo and `dash` reference block.

- UAZ-2206 to its drawing (`src/carkit/uaz.ts`): the windscreen curved in plan at its top
  too (`screenTop` 0.223: 0.466 on the centre line, 0.689 at the pillar), the roof's front
  panel rounding up from it (`roofDrop`), `screenFoot` 0.17, the A pillar's columns to the
  drawn 0.689 / 0.725 / 0.76. `tools/kit-drawing.ts` scans the screen's front edge from
  the tip when the cowl stands under 0.6 (the van's 0.40: it measured nothing). Refs
  `screenTop` → the centre line's (0.466, 1.856) and `doorBottomY` → the front door's 0.588:
  the silhouette and the front door the checker measures, not the pillar's top and the
  side door's bottom.

- UAZ-469 and UAZ-2206: no skirt under the front bumper (owner's review, 2026-10-19). New
  `WheelSpec.archToSill` (body.ts `archEdgeY`): the arches' ends and the wells' walls stop
  at the sill instead of hanging to the hub's height beside the tyre; absent on every
  other car. The 2206's body bottom ahead of the front wheel at the bumper's 0.58 (nose,
  step to the arch's corner), its front bumper down to the drawn 0.58–0.70 (the face's
  lamps and grille with it, to their drawn heights); `doorBottomY` accepted at 0.621.

- Volgas to their drawings (`src/carkit/volgas.ts`). GAZ-24: the quarter light's foot now
  rounds up into the front edge, as in the drawing and the side photo, so the drop glass
  is read at the rail (railY 1.26 → 1.364); side glass tops back to 1.365 (`glassTop` 0.03).
  GAZ-31029: the sedan tail is back (no fastback C pillar to 4.42, the tail station at 4.805
  again), and below the belt the doors meet at the drawn B shut line 2.50. The boot lid's
  drawn extent [3.92, 4.805] is recorded as `accepted` in `refs/gaz31029.json`.
- VIRTUAL DASHBOARD ON / OFF (Settings → Camera & View, `Settings.virtualDashboard`). The
  on-screen driving dashboard is off by default, older saves included; the slider below it
  is now Virtual Dashboard Size.
- THE COURIER'S AIR DANCER stands on the shoulder 3 m short of its lay-by's entry slip,
  where the road starts widening into the pad (`world/poi.ts` `buildCourier`), not
  between the building and the courier car. A courier without a lay-by keeps the old place.

- THE POLICE: POSTS, RADAR, CHASE, STOP, FINES (`src/world/police.ts`, `RoadTraffic`
  `spawnPolice`…`releasePolice`, `src/audio/sirenvoice.ts`).
  - The speed limit is 90 km/h everywhere. Police stand at posts placed from the seed, one
    every 5–10 km of road (each gap its own roll; the first 7–12 km from the house): on
    the roadside lay-by on the player's side when one is within 300 m (angled on the pad,
    nose to the road), otherwise on a shoulder pull-off (`shoulderPullOff` in
    `world/layby.ts`, a lay-by shape the stop machinery drives but nothing builds). Posts
    are read a full traffic reach ahead, so each is known before its spawn band.
    A post faces the way the player travels, on that side. Its car, the black-and-white
    UAZ-469, is put down parked in the stream's unseen band (500–760 m ahead) and leaves
    at the support edge like a rival; nothing of it is saved.
  - The radar reads the player's speed within 150 m of a posted car in its direction.
    Once he is past it pulls out after him for: speeding (> 90 km/h), a collision with a
    traffic car in the last 5 minutes (`RoadTraffic.playerImpacts`, a traffic car's own
    impact with his car in reach), any wanted level, or a 12 % document check.
  - The chase: light bar flashing (rig channels, drawn in full meanwhile) and a siren. Off
    its post at 4 m/s², on the frantic engine, its ceiling 16 m/s over the player's speed
    (≤ 170 km/h) until 70 m behind, then matched to his and eased to 25 m; within 60 m it
    neither passes nor goes round him, and its driver spends 1.25× a frantic driver's
    share of the tyres in bends (`Autopilot.setGripShare`, police only). Measured in
    `tools/police-bench.ts` on seeds 42, 7 and 1337: a player at 104–105 km/h average
    through the bends is caught to 26–34 m.
  - When he stops it pulls over 10 m behind him on his line (on the shoulder if he is), a
    lay-by course of its own, and the prompt asks `[F] hand over your papers` (F goes to
    the officer before anything else; after 45 s he checks unasked). Fines in coins:
    speeding 2 + 1 per 10 km/h over, a collision 6, a car whose papers are not his 6,
    each contract cargo item not on the waybill (in the pack, or past the body's contract
    slots in the boot) 4, a flight 5; all × (1 + wanted level). The coins leave the pack
    at once; behind the wheel that is no save trigger, so the exit saves it. A stop paid
    in full clears the wanted level; an unpaid rest adds one. The car waits for him to
    drive off first, then rejoins the stream.
  - A flight (driving off from the stop, 35 s of ignoring the lights within 150 m, or a
    400 m lead) meets the chase's own roll, taken when it began: give up after 1.5–4 km,
    or escalate — one wanted level (up to 3) for 20 minutes of play, stopping him at every
    post and multiplying the next fine — and keep after him for 6 km or until lost.
  - `PlayerState.police` (`heat`, `heatUntil`) is saved through the `police_heat` delta,
    not a save trigger; older saves load with none. Dev: `__bro.police.devPost`,
    `devChase`, `devFlight`, `devHeat`, `snapshot`. `tools/autosave.ts` checks the heat
    rides with the exit and that old saves load; `tools/police-bench.ts` runs post →
    chase → stop → fine, a give-up flight and an escalating one.

- THE POLICE UAZ-469 (`src/carkit/police.ts`, model `kit_uaz469_police`).
  - The kit UAZ-469 in the militia's livery: white doors with «МИЛИЦИЯ» in dark blue on
    the front ones, a light bar across the roof with a dark blue lamp each side. The game
    gives it its black paint and flashes the lamps on the rig channels `beacon_l` and
    `beacon_r` (0 dark, 1 lit; a pose, never a new shader program).
  - The doors are livery paint (a new kit slot `livery`, render/materials.ts
    `CAR_LAMP_LIVERY`): white whatever the car's colour, but dust, scratches and stickers
    take them as any paint; the lettering is painted into their skin, so nothing fights.
    The kit program's key moved to `-kit-v3`: still one program for every kit car.
  - Resolvable by id (`carModel`, `loadCarModel`, `createCarModel`, `carModelMeasure`),
    in no list traffic, rivals, lots, the spawn menu or the car lab draw from; a save
    naming it keeps it; priced as the 469.

- PETROL BY THE LITRE, A MACHINE AT EVERY STOP (`src/world/vending.ts`, `src/world/poi.ts`
  `machineSpot`, `src/player/interaction.ts` `pumpFuel`).
  - Petrol is no longer sold in filled cans. A FUEL machine has a nozzle in a grey holster
    under its coin panel and a PETROL board over it with the price of a litre here
    (`fuelPricePerLitre`: 1.2 coins × km index, unrounded). Hold F (or LMB) at the nozzle
    with a petrol can in hand: it pours 1.5 L/s, taking one coin each time the litres the
    last coin bought run out, and stops when the can is full or the pack has no coin for
    the next drop. The prompt counts up the litres and coins of the hold (`can 3.0/10.0 L ·
    +3.0 L for 4 coins`); a press that pours nothing, or a fill that runs out of coins, is
    refused. What a last coin bought and the can had no room for stays in the machine for
    the next fill (in memory only). The pump never runs dry; any petrol can of any size is
    filled up to its capacity, and an oil or water can is refused.
  - The FUEL window now sells EMPTY petrol cans (5, 10 and 20 L, one coin each × km index)
    next to oil and water in 5 L bottles; a GOODS machine sells an empty 5 L can among its
    wares. Oil and water stay bottles, and the window's goods are still finite. A can in
    the window names its size (`[F] buy 20.0 L petrol can, empty — 1 coin`).
  - Every stop with a building has one machine (masts have none), its kind from the stop
    and the seed: a forecourt 85% FUEL, a home 60% FUEL / GOODS, a scrapyard FUEL or PARTS,
    a wreck FUEL, PARTS or GOODS, a store PARTS, GOODS or FUEL. A roadside machine stands
    by the front wall toward the end away from the trailer, far enough along that a
    courier parked in front does not hide it; a desert building's stands by whichever of
    its four walls faces the road. A desert car field keeps clear of all four walls.
    Over seeds 1–20, first 500 km: 11.4 machines per 100 km at the roadside and up to
    8.7 more out in the desert (counted before the landform and neighbour checks), 20.2
    in all (was about 8.7); 11.0 FUEL, 3.9 PARTS, 5.2 GOODS per 100 km.
  - A can is drawn by its size: a 20 L can at 0.85 of the old shape, smaller cans by the
    cube root of their volume. The tray's mouth is 0.3 m tall, so a 20 L can fits in it.
  - `InputFrame.mountDown`: F held, as `useHeldDown` is for E.
  - No program links on first sight: the nozzle, hose and price board are kit boxes and a
    sign board, the shapes `marketProgramAnchor` links at boot (checked on seed 11 over
    jumps to FUEL, PARTS and GOODS machines at km 7.7, 23.1, 30.8, 36.1, 42.4, 49.6, 53.9
    and 61.6).

- OPEL VECTRA A kit car (`src/carkit/opel.ts` `BODY_VECTRA_A`, `LOOK_VECTRA_A`;
  `interior.ts` `CABIN_VECTRA_A`; measured in `measurements-vectra.md`). It is the saloon
  2.0i GL with the 1992 facelift's face and tail, built from the-blueprints.com's
  dimensioned vector preview (4430 / 2600 / 1700 / 1400) and Commons photos. It has wide
  head lamps with a small clear indicator either side of a black slatted grille,
  body-colour bumpers with black bands, black door frames, B pillar and mirror sail, a
  small quarter glass, and corner tail lamps (three bands) with a black panel across the
  lid. Its dash comes from a photo. It runs on its own running gear
  (`GEAR_OPEL_VECTRA_A`): 1130 kg, 195/60 R14, a new `engine_opel_c20ne` (85 kW, 170 Nm)
  and a new `gearbox_opel_f16_wr_355` (the Nexia's F16 gears on 3.55).
  `tools/reality.ts kit_vectraa` gives 200 km/h against 198 and the turn within 1.1 %;
  the 0-100 of 12.2 s against 10.5 s is accepted as catalogue-optimistic. `kit-zfight`
  and `kit-proportions` pass. 13 509 triangles.
- THE ECONOMY, FIRST SLICE: COINS FOR DELIVERIES, LICENCES, CONTRACT SLOTS, NOTHING FREE
  (`src/economy/economy.ts`, economy plan draft 3).
  - Every new drive starts in the VAZ-1111 Oka (was a seed-random car), its papers the
    player's, 8–12 L in the tank and 5 coins in the pack. The yard by the house holds
    two to four keepsakes (camera, watch, football, binoculars, torch, shades), no cans
    or consumables.
  - A delivery pays coins into the pack: base by kind (parcel 4, heavy crate 6, fragile
    radio 7, hauls 10–12) × the source courier's km index (1 + 2·(1 − e^(−km/150)),
    ×3 at most) × quality. A race won adds its prize to the same pile. The offer's
    prompt and the deliver prompt show the sum.
  - The fragile radio has a condition again, the delivery's quality: it loses one for
    one with the scratches the car it rides in takes, and 12% per drop to the ground.
    Its label shows the percentage once knocked.
  - Licences from a saved ledger (`WorldState.deliveriesByKind`, counted with the
    completed id): a heavy crate is signed out after three parcels, a haul (trailer,
    oversize, tow, car transfer) after a heavy crate and a fragile radio. Checked when
    the cargo is taken from the courier's boot, with the refusal on the prompt (`no
    heavy-cargo licence — deliver 3 more parcels first`). Older saves rebuild the
    ledger from their completed offer ids. The first courier's easy offer is always a
    parcel.
  - Contracts per car by body: estates (2102, 2104, 2111, 2131) carry two, the UAZ-2206
    three, everything else one (was one for every car).
  - Nothing lies about the world for the taking: stops no longer leave cans, gum,
    tools, medicine, spray cans or parts by the front wall, a wreck's bonnet and boot
    are empty, and a courier's boot holds only its four offers. Fuel stops still have
    their trailers. Items already in an older save stay where they are.
  - Prices for what vending machines and car lots sell are in `PRICE_TABLE`; machine
    prices × km index, car prices flat. `Inventory.spendCoins` takes from the pile.

- VENDING MACHINES AND CAR LOTS: EVERYTHING IS BOUGHT (`src/world/vending.ts`,
  `src/world/carlot.ts`, `src/world/market.ts`, economy plan draft 3).
  - Every fuel and store stop has a vending machine by its front wall: a low-poly cabinet
    in the stop's colour (red FUEL, blue PARTS, green GOODS) with a painted head sign, a
    window of four rows of up to three units, a coin panel and a tray. A fuel stop's is
    mostly a FUEL machine (petrol in 5, 10 and 20 L cans, oil, water, gum), a store's a
    PARTS machine (air filters, oil, water, sponges, spray cans; radiators from 25 km,
    turbochargers from 75 km, an imported engine past 150 km) or a GOODS machine (a bit
    of everything a driver runs out of). Each row holds one ware, drawn from the seed,
    the stop and its 25 km band.
  - Look at a unit in the window: the prompt names it and its price (`itemPrice`: base
    × km index of where the machine stands). F pays from the coin pile and the thing
    drops into the tray as a real loose item; short of coins, the prompt says how many
    are in the pack. A sold slot stays empty for good (`WorldState.vendingSold`, saved;
    absent in older saves = nothing sold). Machines never restock.
  - Cars are bought, never found: the working car that used to stand in some car fields
    for the taking is now a car for sale at some stops (55% of salvage yards, fewer
    elsewhere), upright among the shells with a FOR SALE board at its road-side flank
    naming the model and the price. Prices are flat (`carPrice`); the dearest model a
    lot offers rises 25 coins per 50 km band, and the Daewoos and the Opels stand on
    lots only past 300 km. The Oka is never on a lot.
  - The lot car is a real car in the world (`CarState.lotPrice`): its doors and lids
    work, but F on it offers `[F] buy VAZ-2104 — 65 coins` instead of a seat. Paying gives
    the player its papers (`CarState.papers`, the `car_buy` delta), the board comes down
    and the car is his to drive. The first two stops no longer guarantee a car
    (`Poi.guaranteedCar` is gone).
  - A purchase (`vend_sold`, `car_buy`) books an autosave, as a stowed item does.
  - Machines and lot boards draw with two programs, linked at boot by the hidden
    `marketProgramAnchor`: no program links on first sight (checked on seed 11 over
    jumps to km 7.7, 15.4 and 30.8).

- OPEL ASTRA F kit car (`src/carkit/opel.ts` `BODY_ASTRA_F`, `LOOK_ASTRA_F`;
  `interior.ts` `CABIN_ASTRA_F`; measured in `measurements-astra.md`). It is the five-door
  hatchback 1.6i GL with the 1994 facelift's face and tail, sold in Russia 1994–1998. It
  is built from the-blueprints.com's dimensioned vector preview (4050 / 2517 / 1696 /
  1410) and Commons photos: black slatted grille between rectangular head lamps, dark grey
  bumpers, black door frames, B pillar and mirror sail, a fixed quarter glass, and a black
  panel across the tailgate between the corner lamps. Its dash comes from a cockpit
  panorama. It runs on its own running gear (`GEAR_OPEL_ASTRA_F`): 1010 kg, 175/70 R13,
  a new `engine_opel_c16nz` (55 kW, 125 Nm) and a new `gearbox_opel_f13_wr` (3.55 …
  0.71 on 3.94). `tools/reality.ts kit_astraf` gives 170 km/h against 170 and the turn
  within 0.5 %; the 0-100 of 15.5 s against 14.0 s is accepted as catalogue-optimistic.
  `kit-zfight` and `kit-proportions` pass. 13 578 triangles. A waist moulding may now
  run over part of the flank (`KitLook.waist.span`; absent, nose to tail as before).
- DAEWOO ESPERO kit car (`src/carkit/daewoo.ts` `BODY_ESPERO`, `LOOK_ESPERO`;
  `interior.ts` `CABIN_ESPERO`; measured in `measurements-espero.md`).
  The 2.0 CD saloon of 1995–1999 that drom.ru catalogues for Russia, from the-blueprints.com's
  dimensioned vector preview (4615 / 2620 / 1718 / 1388) and Commons photos. It has slanted
  flush head lamps with the indicator at their outer ends, a plain panel between them,
  body-colour bumpers with black bands, a black rubbing strip, a quarter glass behind the
  rear door, and a red reflector band across the lid between the corner lamps. It runs on
  its own running gear (`GEAR_DAEWOO_ESPERO`): 1128 kg, 185/65 R14, a new
  `engine_daewoo_c20le` (77 kW, 169 Nm) and the Nexia's F16 box on the same 3.944 axle.
  `tools/reality.ts kit_espero` gives 185 km/h against 185 and the turn within 1.4 %; the
  0-100 of 12.8 s against 10.8 s is accepted as catalogue-optimistic.
  `kit-zfight` and `kit-proportions` pass. 14 389 triangles. Its sun visors are 0.10 deep,
  a third of its low screen's visible height (a new optional `Layout.visor`; the stock
  0.15 hung to the horizon when lowered). The Nexia's are 0.105 deep the same way. After the owner's first
  review it has its own dash, from SelfBase.de's instrument-panel photos and an owner's
  cluster photo on drive2.ru. The dash has an angular hood over three dials of one size
  (tachometer, speedometer, and a fuel dial with the temperature scale on it) with switch
  pods either side, and two vents over three heater knobs on a black stack. The door
  frames, B pillar, quarter-glass frame and mirror sail are black: a new
  `CabinColumn.finish: 'black'` paints a greenhouse strip as black trim, and no other car
  sets it. The lamps' outlines are now measured on eight photos. The head lamps have a
  slanted inner end from a pointed tip and a nearly level top. At the tail, one band
  0.67–0.82 runs across the whole car: corner units red over amber, and a lid band that is
  full height at its ends and only its top in the middle. The lid's cut moved in to
  ±0.49 to match.
- THE FIRST FOREIGN KIT CAR: DAEWOO NEXIA (`src/carkit/daewoo.ts` `BODY_NEXIA`,
  `LOOK_NEXIA`; `interior.ts` `CABIN_NEXIA`; measured in `measurements-nexia.md`). The
  early base N100 saloon (1995–2002, the G15MF 1.5 and the five-speed) from 3dcar.ru's
  dimensioned four-view (4.851 mm/px from the drawn hubs) and Commons photos: a low face
  of flush head lamps with the amber indicators wrapping round the corners and a black
  slatted grille, dark grey bumpers with a bright strip in line with the doors', a slim A
  pillar, a small quarter glass and a wide C pillar under a long back light, a boot lid
  down between corner tail lamps; its own dash (a rounded hood over the speedometer with
  the tachometer left and two small dials right, end vents, two centre vents over three
  heater knobs). It is the first kit car with no catalogue sibling: a `KIT_CARS` row may
  now name its whole running gear (`vehicle/carmodels.ts` `KitOwnGear`, `kitBase`), and
  the parts registry gains the foreign cars' driveline (`parts/registry.ts`
  `FOREIGN_ENGINE_VARIANTS`, `FOREIGN_GEARBOX_VARIANTS`: `engine_daewoo_g15mf`, 55 kW,
  123 Nm; `gearbox_opel_f16_nexia`, 3.545 … 0.707 on 3.944), which the Espero, Astra F and
  Vectra A will reuse. From the Nexia repair manual: 969 kg, 50 l, 175/70 R13, 4.9 m;
  `tools/reality.ts kit_nexia` 164 km/h against 163, the turn within 0.5 %, the 0-100
  15.3 s against drom.ru's 12.5 accepted as catalogue-optimistic. 13 258 triangles;
  `tools/kit-zfight.ts` PASS, `tools/kit-proportions.ts` hard gates pass, the 22 earlier
  kit cars identical by geometry hash. After the owner's first review the lamps carry the
  car's gentle curves: the head lamp's arched top and rising foot with the indicator
  closing as a dome on the wing, the tail lamps' inner side one convex line rounding into
  the top over a level split (`cornerLamps` points with their own heights), and the grille
  is a trapezoid narrowing to its foot with the head lamps' inner ends leaning along it
  (`grille` `slant`, whose bars no longer stand sunk in the dark back and fight its walls
  in the far band; no other car uses it). 13 472 triangles.

- A ROADSIDE UAZ-2206'S MIDDLE SIDE DOOR OPENS, AND ITS BAY IS REACHED THROUGH IT
  (render/carmodel.ts `STATIC_SHELL_DOORS`, `kitStaticParts`; render/staticlids.ts;
  player/interaction.ts `wreckDoors`, `aimWreckLid`, `workWreckLid`; tools/wreck-lids.ts).
  The van's engine bay lies in the cabin under the engine cover, and a wreck of it had no
  way in. Its shell alone now hangs `door_rr` on the driven van's hinge beside its lids;
  E opens it and lifts the cover with it, and the bay's grid opens. The cells are picked
  through the door opening with `BOOT_RANGE` counted from the opening, as on the driven
  van (all four taken from beside the door, 1.28–1.86 m from the eye); shut, the door
  drops the cover and the bay is not reached, and the cover is no longer worked through
  the shell's walls. Every other wreck's doors stay shut.

- CROUCH ON FOOT. C toggles a crouch (rebindable as "Crouch / stand up"; the pad's Y and
  a C button on the touch overlay on foot): the eye eases down from 1.62 m to 0.95 m in a
  quarter second, the capsule shortens to 1.1 m with the feet left where they are, and
  the player crouch-walks at 1.5 m/s whatever Shift says. Picking and reach come from the
  camera's eye, so they follow the lowered head. C again or Space stands up, but only
  with headroom over the head; under something low the player stays down and rises once
  out from under it. A crouch ends on getting into a car or a rescue. C keeps the camera
  switch in a car (shared default, like F). player/player.ts, core/input.ts,
  core/touch.ts, render/cameras.ts `CameraTarget.eyeDrop`; CONTROLS.md.

- KIT CAR DUST FLOW. Each kit car's paint and window dust now follows its own body's
  airflow: a blunt nose (Niva, UAZ) takes a crust on the bumper and grille, a squareback's
  base wake holds more dust on the tail, slab flanks catch crosswind dust between sill and
  belt, a tall body throws more into its arches and a low one sprays its sills, and a
  roof keeps or sheds its settled film. Six coefficients per kit row in
  `vehicle/model-fits.json` (`dustFlow`, `CarDustFlow`), authored offline from the car's
  existing `AeroSpec` and ground clearance by `tools/dust-flow.ts` (an approximation, not
  CFD; `bun tools/dust-flow.ts` checks the rows and the shader path). They scale the
  existing dust placement through chassis-space masks and face normals
  (render/materials.ts `CAR_DUST_FLOW`); every other body gets the neutral flow and dusts
  exactly as before. Uniforms only: no new program variant, no physics change.

- JAPANESE TOILET POIS, FIRST FIVE (docs/toilet-poi-design.md, world/toilets). Low-poly
  readings of THE TOKYO TOILET (Ban, Kuma, NIGO®, Newson, Wonderwall), each with a source
  card, drawn from one parametric cabin shell (flat, gable or pyramid roof; battens,
  privacy walls or house dressing) registered as POI kit variants, so they merge and
  cache like the masts. Over the merged shell a `ToiletRig` carries the stateful fixtures
  (door, washlet lid, flush, valve, plunger, floor dirt), one central ceiling lamp lit by
  intensity only, an optional eyes-and-brows face with seven emotions, and a live mirror
  through one bounded camera (`ToiletMirror`; the car mirrors' off-axis projection is now
  shared in render/mirrorview.ts). Progress has a save projection (state.ts) that the
  gallery round-trips; the world does not place toilets yet and the game save does not
  hold them. `?poi-gallery&type=toilet` lists them (`type=world` the world's buildings),
  with state, reset, complete and fixture controls, N for night, and
  `window.__poiGallery` for automation. Gates: `bun tools/toilet-check.ts`.
- CABIN CONTROLS AT ANY SPEED. Seated in a kit car, every fitting works standing or
  driving: seat change (F on another seat), wipers, radio, doors, windows, glovebox,
  ashtray, light switch, visors, dome lamp, hazard button. Before, `seatedKitPart`
  (player/interaction.ts) cast no ray at all from outside the car's box and refused the
  doors at 5 km/h and above, and F into another seat needed the same standstill;
  stepping out still needs it.
- The dash RADIO knob steps the car's radio as R does: station 1 → station 2 → off. Its
  needle stands on a fixed frequency for each preset and rests at the band's start when
  off (carkit/rig.ts `RADIO_TUNE_*`), where it used to drift along the band while on. The
  knob was a dead visual toggle; the rig's `radio` channel is now 0/1/2 and follows the
  car's real radio (`GameAudio.radioDial`).
- The HAZARD button, from the driver's seat, steps hazards with the autopilot: hazards +
  sleeper → hazards + hurried → hazards + frantic → both off. The autopilot keeps the
  hazards on while it drives (`Autopilot.setHazards`, which beats its own lane-change
  blinkers); P to off or stepping out of the car puts them out with it. From another
  seat the button only switches the hazards (and tells a driving autopilot, which keeps
  them as set). `Autopilot.setEngaged(false)` only clears the lamps on a real
  disengagement.
- THE AUTOPILOT KEEPS DRIVING WHEN YOU MOVE SEATS (main.ts). Changing to any other seat
  used to drop it on the next step and the car rolled on undriven; now it drives on from a
  blank control frame, so the occupant's own keys never reach the car, and taking the
  driver's seat again finds it still driving. Only stepping out of the car drops it.
- THE CROSSHAIR FOLLOWS THE LOOK (ui/hud.ts `noteLook`, hud.css). It shows while the view
  is turned (mouse, stick, touch), on foot and seated alike, and dissolves over 1.2 s once
  the view has been left alone for 4 s (`CROSSHAIR_IDLE_MS`). On something a car works
  it fills, and the fill pulses about once a second. It used to stay up on foot for good
  and, seated, show only on a fitting.
- THE CABIN VIEW WAITS LONGER, AND NOT AT ALL ON AUTOPILOT (render/cameras.ts). It turned
  back to the road one second after the last look, before a glance was over; now two
  (`CABIN_RECENTER_IDLE_SECONDS`), and never while the autopilot drives
  (`CameraTarget.autopilot`): the head stays where it was left. The chase view is
  unchanged.
- BOTH DOOR MIRRORS are adjustable (hold E on the head, move the mouse), from either
  front seat only, through the closed door glass or vent window; from the rear they are
  not offered. Their heads turn on new `mirror_l_*`/`mirror_r_*` channels, the live
  mirror views follow, and the aims are kept per car (`leftMirror`/`rightMirror` beside
  `innerMirror`, `car_mirror` now names the mirror) and saved.
- A NEW KIT CAR: AZLK-2141 Moskvich (`src/carkit/azlk.ts` `BODY_2141`, `LOOK_2141`). The
  1986–1998 base liftback from the-blueprints.com's dimensioned four-view (5.714 mm/px from
  the drawn hubs) and Commons photos: a near-upright face of rectangular head lamps and a
  black slatted grille with the amber indicators wrapping round the corners, deep black
  plastic bumpers, a bonnet whose crown grows evenly from the lip to the cowl, a shoulder
  line along the flank, four doors under a slim A pillar with the front door's glass close
  behind it, a quarter glass under the falling roof (`roofDrop`) and a wide D pillar, and
  the long tailgate from the roof to the bumper, nearly all glass, coming down between the
  tail lamps (amber, red, white reversing cell, red) with its plate panel. On the `samara`
  platform's cabin as is.
  In the lab and in the world (`KIT_CARS`, the running gear of `sa_azlk2141`, the 2141-01;
  a save on the pack body loads on it). Numbers in `measurements-2141.md`. After the
  owner's first review both bumpers sit under the lamps (their tops 0.605 → 0.565 at the
  front, 0.585 → 0.545 at the back), and the A pillar is slim on the 2141 and on the GAZ-24
  and GAZ-31029 too: the door's frame and glass stand 0.075–0.08 of s behind the pillar's
  line, parallel to it, where 0.20–0.38 of paint stood at the belt (`volgas.ts`,
  `measurements-volga.md` §3.5). No generator change: every other kit car is untouched.

- THE GROUND'S OWN LIGHT (`render/groundlight.ts`). Sand, mesas, the road, its bed and
  markings no longer run Three's physical GGX lobe for the sun and every spotlight slot:
  Lambert plus a backscatter term (light behind the eye brightens grainy ground, up to
  +20 %), the environment as irradiance only, and on the road and markings a Blinn-Phong
  glint for the wet. The Clean style's light bands now step spotlights as well as the
  sun (`render/lightshader.ts` `cleanLightBand`). Other cars' headlamps are one beam per
  lamp, no longer one merged beam per pair. Not yet measured against the 2026-10-16
  slot-cliff baseline (M2 Pro, 1440 lines: 14.5 ms at 11 slots, 16.3 at 13, 35.0 at 14).

- THREE NEW KIT CARS: VAZ-2111, GAZ-24, GAZ-31029 (`src/carkit/tens.ts` `BODY_2111`,
  `src/carkit/volgas.ts`). The tens' estate on the 2110's nose and doors with its own rear
  door frame, long quarter glass and tailgate (3dcar.ru `vaz_2111.jpg`); the GAZ-24 from its
  dimensioned factory four-view (`gaz_24.jpg`) on the classic platform; the GAZ-31029 as the
  24's doors and greenhouse with its square nose and own tail (the-blueprints.com drawing).
  In the lab and in the world (`KIT_CARS`, running gear of `sv_vaz21099` with the 2111's
  1040 kg / `sv_gaz24` / `cf_gaz31029`; saved Volgas now load on their kit twins). Numbers in
  `measurements-2110.md` §9 and `measurements-volga.md`. The rear wheel-house covers no longer
  emit NaN vertices when the arch's end lands a float hair outside it (all earlier cars
  identical by geometry hash). After the owner's first review: the Volgas' greenhouse is
  measured anew (the 24's quarter light behind a frame, the rear door's glass turning down
  into a post and a fixed pane under the raked C pillar; the 31029's single front pane and
  raked rear glass), both roofs arch in profile, the 24's nose is crowned across and its
  boot falls behind the back light, the 31029's tail corners are rounded, and both cars'
  bumpers run back along the wings as drawn (blade `wrap`); the 2111's lower tail stands
  out over its bumper (the bumper no longer sticks out 85 mm behind it). The tens (2110,
  2112, 2111) get the same profile arch of the roof. New spec fields, absent on every other
  car: `CabinSpec.roofDrop` (the roof's line in profile), `CabinSpec.railBend` (a second
  facet rounding the roof's edge into the side glass), blade bumper `wrap`. Also the
  Samaras' (2108, 2109, 21099) front wing simplified to one clean surface over the arch
  (crease 0.705 on the drawn shoulder line). All other cars identical by geometry hash.

- THE DESERT IS NOT A SECOND CARRIAGEWAY (`core/surfaces.ts` `sinkage`, `world/terrain.ts`
  lane washboard). Sand gets a speed-grown soft-ground drag, `sinkage · v²/(v² + 15²)` of
  the car's weight on top of its flat rolling resistance (0.11 at saturation; 0.045 at
  45 km/h, a thousandth at a walk, lifted by the dig), so full throttle on open sand is a
  labouring engine rather than a cruise. Beside the road the 10 m corrugation is
  re-phased on the road's arclength — crests square to the road, 0.14 m, growing in
  from 10 to 20 m out and gone by 66 m (inside the tile lattice's exact-projection gate),
  faded where a bend would squeeze them under 7.5 m — so driving alongside crosses every
  crest and driving away runs along them. On `tools/offroad-feel.ts` (rally VAZ-2105,
  seed 42, `DIAG=1 SEAMS=10 ALONG_M=5000`): alongside at 20-60 m held 71-79 → 39-44 km/h
  of 90 asked (56-60 → 43-47 of 60), jolt99 0.81-1.06 g (lane 0.28-0.35), load p99
  1.96-2.93x static, airborne 0, flips 0, body contacts 0, wave lift-off 74-92 km/h; away
  from the road (new `ONLY=open` runs: square to it, 45°, and 300 m out) 70-89 → 56-70.
  Softer cars alongside (2500 m, 90 asked): VAZ-2101 83-89 → 48-51, Oka 78-81 → 52-58, on
  wheel load p99 2.4-4.8x static (2.2-4.5x before, at their old speeds), no flips. Road runs
  in `surface-feel.ts` and the lane control are byte-identical; seam crossings match the
  old figures; escape census 0% stranded and the sand climb sweep unchanged. The bench
  also gains `MODEL=`, `GEOMETRY_S=`/`GEOMETRY_LATERALS=`, a collider-vs-`heightAt`
  deviation column, and counts a car stopped dead (usually on a rock prop) as `stuck`
  and puts it back on its line instead of ending the run.
- DESERT WAVES STAY UNDER THE WHEELS (`world/terrain.ts` fine band). The 10 m
  corrugation drops from 0.36 to 0.09, the 20 m chop from 0.3 to 0.12 and the scoops
  from 0.32 to 0.16 m deep, each held to the lift-off limit A ≤ g·L²/(4π²v²) for a car
  with 9 cm of bump travel; the desert's discomfort stays in the long dune swell. On
  `tools/offroad-feel.ts` (seed 42, 20/40/60 m alongside, 60 and 90 km/h asked): wave p99
  0.25-0.29 → 0.08-0.12 m, lift-off speed 50-58 → 104-116 km/h, jolt99 1.4-2.2 →
  0.82-0.99 g (lane 0.28-0.35), wheel load peak 5.0-8.0 → 1.7-2.1x static, airborne
  0.3-1.7% → 0, flips 1 → 0, body contacts 10-33 → 0 per km. Still slower and rougher
  than the road: heave 0.31-0.37 g against 0.10-0.13, and 71-79 km/h held of 90 asked.
- OFF-ROAD FEEL ON THE GAME'S OWN GROUND (`tools/offroad-feel.ts`). `surface-feel.ts` drives
  its desert on `TerrainMeshProvider`, which only road-lab streams. This bench drives a
  real Zhiguli over the colliders the game actually builds there: the road chunk's
  shoulder strip, its verge skirt and the `DesertTileStreamer` heightfield. Runs: lane to
  desert crossings at 6° and 30°, 40 and 80 km/h, at ten sites; the desert at 20, 40 and
  60 m alongside, 60 and 90 km/h asked, 5 km each, with the lane itself as the control;
  and the wave geometry along the same lines. Per run it reports jolt99 and maxg, the
  wheel load peak over static, airborne share, roll and pitch rates, flips, body
  contacts, and seam collider and surface switching. DIAG=1 splits every 1 g jolt by
  source and attributes every launch and tip to what preceded it. Seed 42 today: lane
  jolt99 0.28-0.35 g, load peak 2.0-2.2x; desert jolt99 1.0-2.7 g, load peak 7.9-17x,
  bump stop engaged on 61-86% of 1 g jolts, ~23 body-box contacts/km, mostly at the
  tail. The seam does not flip surfaces (≤0.1 surface reversals per wheel per crossing).
  The waves (0.24-0.26 m p99 about a 30 m swell, crest curvature 0.036-0.045 /m) lift a
  car off at 53-60 km/h whatever the suspension does. A yielding-sand contact model was
  tried against this bench and dropped: it halved the load peaks and cut jolt99 by
  15-25%, but body contacts rose from 19 to 29 per km and flips from 1 to 4-10 per 37 km.
- CLEAN SURFACES ARE FLAT AT EVERY DISTANCE (`render/cleanstyle.ts` `applyCleanSurface`,
  `world/roadmesh.ts`, `world/poi/kit.ts`, `render/comic.ts`). Clean read the road's
  albedo with a mip bias of 6, and right behind the car the computed level is at or below
  zero, so the painted aggregate still showed there as a blurred mush. It now reads the
  map's last mip, its mean colour, on the road in every surface it is laid in and on the
  sites' plaster, brick, block, board, metal and tile patterns (whose texture now builds
  the mipmaps its filter asked for), without their normal maps; the desert drops its ink
  stipple. Vertex colours, markings and strata stay. Same branch on the shared uniform:
  programs 100 before and after switching.
- STYLE: STANDARD OR CLEAN (`game/settings.ts` `VisualStyle`, `render/cleanstyle.ts`,
  `render/lightshader.ts` `installCleanStyle`, `render/hazeshader.ts`, `core/renderer.ts`
  `setStyle`, `world/props/instancebatch.ts` `syncLod`, `ui/menu.ts`, `main.ts`). A row in
  Quality beside Shadows and Grass, Standard on every rung and kept by every preset;
  Clean is a calm, temporally stable low-poly picture for tired eyes. In Clean the
  asphalt is read from a deep mip with no normal map, so only its metre-scale patches,
  the vertex colour and the markings remain; the finishing pass draws no film grain;
  ground cover, barrel cacti and scrub shrink away below 6-8 px of projected height and
  their batch pages go undrawn once every instance in them would; lit surfaces take
  their triangle's face normal (fading back to smooth by 600 m; the terrain and the
  road keep their own) and the sun's light in four bands; and the near shadow cascade
  is one hardware compare, a crisp silhouette, instead of its soft nine. All of it is
  branches on shared uniforms in GLSL both styles compile, so switching applies in
  place with no program linked and Standard draws as before. The frame report's header
  names the style.
- RESOLUTION IS A FRAME HEIGHT: 540p, 720p, 1080p OR 1440p (`game/settings.ts`
  `RENDER_HEIGHTS` `renderHeightDefault`, `core/renderer.ts` `renderPixelRatio`
  `setRenderHeight`, `app/bootwarmup.ts`, `ui/menu.ts`, `main.ts`). The Render scale row
  (Auto, 50-150%) is now Resolution with four line counts: the frame is drawn at exactly
  that many lines, width from the window, and shown full-window as before. A percentage
  needed a base the player could not see — 150% on a 4K display promised 4953x2616.
  Each rung's preset sets its own height (Low 720, Medium 1080, High 1440; a phone 540,
  720, 720); Very Low keeps its 360/540 lines. The hints quote the real pixels and how
  the frame meets the screen (1440p on a 4K panel is scaled up 1.5x). Stored percentages
  and Auto become the rung's own height. Dynamic resolution is gone with Auto
  (`core/adaptivequality.ts` and the rungs' pixel ceilings, floors and supersampling,
  `tools/adaptive-quality.ts`, `tools/adaptive-resolution.ts`): the GPU running average
  now lives in the renderer, and the first launch's rung measurement judges each rung by
  its measured GPU time against the rung's budget instead of by how far the controller
  had walked the resolution down. `tools/graphics-tiers.ts` checks that every height draws
  exactly its lines on every canvas.
- SHADOWS AND GRASS SETTINGS (`game/settings.ts` `ShadowMode` `shadowModeFor`,
  `render/retro.ts` `buildProfileFor`, `render/sky.ts` `setShadowMode`, `core/renderer.ts`
  `setShadowMode`, `ui/menu.ts`). Two rows beside Antialiasing, independent of the
  quality preset, so Low with heavy traffic can still have shadows under the cars and
  grass can be judged on its own. Shadows: Off, Near (only the 32 m cascade around the
  camera; the sun's wide map sits at zero intensity and is not redrawn) or Full. Grass
  On/Off picks the build profile (`full` or `light`) that the rung alone used to pick;
  changing it saves and reloads the drive. Each preset sets both from its rung, so Low
  is still no grass and Medium still full shadows, and a save without them gets its
  rung's defaults. Off against Near/Full toggles the shadow map and recompiles as a rung
  change always has; Near against Full changes only intensities and map updates. Phones
  stay without sun shadows on every rung whose tier says so.
- GRASS HAS THREE STATES: FULL, LIGHT, OFF (`game/settings.ts` `GrassMode`,
  `render/retro.ts` `bare` profile `groundCoverActive`, `world/props/scatter.ts`,
  `ui/menu.ts`). Grass Off kept Low's light ground cover, which still read as grass.
  Full and Light are the two builds the rungs always had; Off is Light without any
  ground cover. Measured at the drive's start on Low (seed flick, high traffic and
  distance): 4463 instanced props with Full, 1882 with Light, 743 with Off. A stored
  on/off reads as Full/Light.
- LESS SCRIPT PER FRAME (`vehicle/vehicle.ts` `HiddenStillGroup`, `render/vista.ts`
  `GROUND_REFRESH_S`, `world/traffic.ts` control phases). The owner's Windows profile is
  80% scripting, and the frame's cost barely followed draws or triangles (190 draws at
  116 FPS, 900 at 90). Profiled on the M2 Pro: three's world-matrix walk visited every
  part of every hidden far traffic car, ~260 objects each, most of the scene's 6000; a
  hidden car root now keeps only its own matrix (walk 0.6 → 0.1 ms median). The vista
  disc rewrote and uploaded all its vertices every frame; it now follows the camera at
  most 75 times a second (half the cost at 144 FPS). Traffic drivers deciding at 12 Hz
  were put on two of every five 60 Hz ticks; their phases are now spread over all five.
- THE SUN'S NEAR SHADOW CASCADE (`render/sky.ts` `sunNearLight`, `render/lightshader.ts`
  `installSunShadowCascade`, `config/graphics.json` `shadowCascade*`). The ugly car shadows
  were never the far mesh: A/B in the car lab, a 2106 casting its near meshes and its far
  mesh gave the same staircase, because the sun's map is 7 cm a texel (13 cm on the sand
  under a 30-degree sun). A second black directional light now casts a 2048 map over a
  32 m box round the eye (8 m behind, leaning ahead as the sun's box does), 1.6 cm a
  texel. Inside it the sun's shadow is read from that map with a nine-tap 1-2-1 filter,
  outside from the wide map as before, blended over the box's last 8%; the cascade's own
  light pass is compiled out. Every program changes alike at boot: no variant. Near
  traffic within 16 m of the eye casts its own meshes again (steered wheels, open gaps),
  the far-mesh stand-in from 18 m on. Measured on the M2 Pro (Standard, chase camera,
  autopilot): the near pass is 26 draws a frame beside the sun's 34, of 266 in all; the
  program count did not grow over a 3 s sample in the car.
- KIT NIVAS AND OKA: `kit_vaz2121`, `kit_vaz2131` and `kit_vaz1111` (`src/carkit/nivas.ts`,
  `oka.ts`; measured in `measurements-niva.md`, `measurements-oka.md`) join the world's
  cars, which completes the VAZ roadmap. The 2121 is read off the factory four-view
  `niva.jpg`, the 2131 is its shell 0.5 m longer behind the B pillar with rear doors (photos
  only: no drawing exists), the 1111 the dimensioned 3dcar.ru four-view. New platform
  `niva` (`carkit/bay.ts` `nivaTransfer`: transfer box, front propshaft, front
  differential and driveshafts under the classic's driveline, 220 mm clearance;
  `carkit/interior.ts` `LAYOUTS.niva`: the 2106 instruments in a wide panel, static
  transfer levers). The Nivas ride on `sv_niva` / `sv_niva_long`; the Oka on the carforge
  Oka's running gear from its manual (`vehicle/carmodels.ts` `KIT_CARS` siblings may now
  be any catalogue entry). A tailgate may come down the tail face between notched lamp
  corners like a boot lid (`BodyFrame.lidFace`), `KitLook.mirrors: 'left'`,
  `bench.clear`. Saves on the pack Nivas and the carforge Oka load on these
  (`save/save.ts`); traffic odds: Nivas calm, Oka sleeper. `tools/kit-zfight.ts` passes
  on all three, `tools/reality.ts` within tolerance (0-100 deviations as their siblings'),
  `tools/kit-proportions.ts` hard gates pass; the 13 earlier cars identical by geometry.
  10.6–13.0k triangles.
- THE ROAD STANDS ON A LOW EMBANKMENT WITH A REAL SHOULDER (`world/roadprofile.ts`
  `SHOULDER_WIDTH_M`, `shoulderFallAt`, `embankmentDropAt`, `shoulderFringeM`;
  `world/terrain.ts` `gradedBase`; `world/roadmesh.ts` shoulder strip, `SKIRT_ACROSS_M`).
  Past the asphalt edge: a guaranteed 2.5 m shoulder of `LooseShoulder` on every row,
  falling 6% at the lip steepening to 15%; a ragged, wandering fringe of the same stone
  only beyond it; then a 1 m batter to the desert 0.45 m below the asphalt. The terrain
  is lowered by the same profile, and the strip's collider is its own drawn triangles.
  Measured by the new `tools/verge-profile.ts` (rays against the real road chunk, lay-by
  pads included) over 135 chunks, seeds 1337 and 42: drivable past the edge min
  0.95 / p50 1.75 m before, 2.55 / 2.85 m after on every row (straights and lay-bys);
  fall 7.9/11.7/14.4% at 0.5/1.5/2.3 m; desert 5 m out 0.48 m below the asphalt (p5
  0.24, p95 0.69; was 0.09); drawn ground above the strip on 0.3% of rows by at most
  4 cm (was 98% of rows, up to 11.7 cm). Lay-bys keep their level pad (the strip lies on
  it). Reflector posts moved from 1.2 m to 3.2 m past the paint (`world/props/delineators.ts`
  `DELINEATOR_SETBACK_M`, now standing on the tiles' drawn ground via `tileGroundSampler`)
  and the pole line from 3.1 m to 4.5 m (`world/props/poles.ts` `POLE_SETBACK_M`), so
  neither stands on the shoulder a verge pass uses. Pole feet p50 7.7 cm over the drawn
  ground (HEAD 9.5 cm); sidetrack ruts unchanged (they ride `drawnGroundY`, the dev
  terrain mesh, and float ~10 cm over the tiles as on HEAD). Lakes (520 m+ out)
  untouched: `tools/water.ts` passes; `tools/corridor-shape.ts` gives the same result as
  HEAD.
- FRANTIC DRIVERS PASS A WHOLE QUEUE ON THE VERGE (`vehicle/autopilot.ts`
  `sizeQueuePass`, `vergeStretchFits`, `vergeCeiling`, `VERGE_CROSS_FALL`;
  `vehicle/lateral.ts` `stepShoulder`; `vehicle/corridor.ts` `shoulderPassSooner`). The
  pass is sized to the first real gap in the queue, committed once more than half past,
  and given up only when it cannot be finished. Its speed is the car beside plus 6 m/s,
  capped by what the verge allows (the bend on the shoulder's grip less its fall, the
  road's limit, 130 km/h). The outer tyre stays 0.4 m inside the guaranteed shoulder,
  and the verge budget uses the profile's fall at that depth (13.6%, was a flat 10%).
  `tools/frantic-pass.ts` (seeds 1337/42/7, M30 and stock): passed 26 of 48 → 48 of 48,
  wheels in the desert 128 → 0, slides 0 → 0, contacts 0 → 0, verge give-ups 0 → 0.
  `tools/autopilot-bench.ts`: the same 8 FAILs as HEAD. `tools/traffic-bench.ts`: one
  lay-by hand-in FAIL as on HEAD, with 2 stream impacts in both; on HEAD they fall in the
  far-side window, here in the own-side one.
  CONTACTS ARE UNRESOLVED. `tools/traffic-road.ts` (`--cap 48 --frantic-share 0.5`, seeds
  1337 2024 42 7 99, three runs per build, per frantic car-minute, mean [min-max]):
  HEAD 0.34 [0.30-0.42]; embankment with the old pass logic 0.38 [0.32-0.45]; the queue
  pass letting the car open up to the verge's ceiling 0.49 [0.42-0.59] (normal cars
  0.15 against HEAD's 0.09). With the speed held to the car beside plus 6 m/s (the code
  now) 0.33 [0.17-0.42], normal cars 0.07, left the road 0.19 against HEAD's 6.5 — but
  that is one variant built without the `vergeCeiling` cap, and the final build's own
  stream runs were stopped. The contact counter itself has not been validated: a two-car
  impact is reported by both cars, and the run-to-run spread is not yet known.
  `tools/traffic-road.ts` gains `left the road`: a wheel on sand or rock, or the body's
  centre past the 2.5 m shoulder (`CONTROL_SHOULDER_M`); `departure` still means 0.3 m
  past the paint. `tools/frantic-pass.ts`, `tools/traffic-road.ts` (`--frantic-share`,
  `--events`) and `tools/verge-profile.ts` are kept as the benches for this.

- **COLOUR PIPELINE DONE PROPERLY: LINEAR HDR SCENE, ONE DISPLAY TRANSFORM.** The scene
  pass drew into an 8-bit sRGB target, where Three applies no tone mapping, and the post
  pass wrote those linear values to the canvas unencoded: the whole game ran about a gamma
  dark and the configured ACES was never applied. The scene now renders linear radiance
  into a half-float target (`sceneTargetType`, core/renderer.ts; 8-bit sRGB fallback
  without float render targets). The post pass (render/hazeshader.ts `toDisplay`) maps it
  to the display once, after the heat haze, mirage, dust wall and veils and before the
  grade, ink and grain. The curve is the PBR Neutral shoulder without its toe
  (render/displaytransform.ts), picked from noon/dusk/night sheets against ACES (sunlit
  sand goes yellow-white), AgX (greys the desert) and full Neutral (its toe turns dusk
  roads saturated blue). FXAA and the ink measure edges on a square-root approximation of
  the displayed values.
  - Colours authored as screen values are decoded, so they show as authored: the sky dome
    and the environment probe (one shader now; the "linear twin" is gone), fog and air-fog
    colours, the dust-wall, storm and veil colours, stars and planets, every
    MeshBasicMaterial colour and emissive (`installScreenAuthoredUnlit`,
    render/lightshader.ts; mirror faces opt out with `SCENE_RADIANCE`), and the wheel-spray,
    weather-particle and artifact shaders.
  - Removed the compensations for the dark display: the post pass's sqrt toe lift and the
    daylight sky-fill boost.
  - Retuned (sky.ts unless noted):
    - `EXPOSURE_TARGET` 5 → 3.
    - New `DAY_FILL_SHARE` 0.6 (sky fill only; the sand bounce keeps its energy).
    - New `ENVIRONMENT_SHARE` 0.5.
    - `ADAPTATION_FLOOR` 0.1 → 0.05 (dusk ground readable).
    - Night fill 2.8 → 0.35.
    - Vehicle beams ×0.35 (`LAMP_EXPOSURE`, render/vehiclelights.ts); torch 150 → 52.
    - Tail and brake ground pool 6/24 → 3/12 (vehicle/vehiclelamps.ts).
    - Asphalt albedo contrast ×2 about its mean, overall ×0.85 (render/roadtexture.ts).
    - Grade saturation 1.055 → 1.5, plus a display-space S-curve at 0.45 (`DISPLAY_CONTRAST`).
  - Mirrors render into the scene target's type, so they go through the same exposure and
    curve as the main view.
  - Car-lab ground is segmented: on a 2-triangle 4 km plane the per-vertex fog depth hazed
    it sky-blue up close.

  Measured on the M2 Pro, same frozen frames HEAD vs new (seed `flick`, 30 km, Standard,
  traffic cleared), luma p5/p50/p95 of 255:

  | Frame | HEAD | New |
  |---|---|---|
  | Noon | 97/127/219 | 94/123/229 |
  | Golden hour | 61/85/180 | 60/85/187 |
  | Dusk | 4/5/149 | 6/9/151 |
  | Night with lamps | 1/7/13 | 1/6/15 |
  | Haboob | 84/109/139 | 80/105/134 |

  Programs held at 98 → 98 over an autopilot drive through cabin view, blinkers, hazards,
  dusk, night, low and high beams and a haboob. GPU ms, interleaved, median over 12 s:

  | Tier | HEAD | New |
  |---|---|---|
  | Standard, 1.44 Mpx | 8.17 / 8.33 | 7.98 / 8.64 |
  | Blessing, 1.44 Mpx | 8.46 / 8.58 | 8.61 / 8.26 |
  | Blessing at 1.5×, 3.24 Mpx | 10.45 / 10.70 | 10.68 / 11.01 |

  That is +0.2–0.3 ms at 3 Mpx. The exact display transform inside FXAA's taps had cost
  +1 ms there.

- A PANINI LENS IN CINEMA MODE ONLY (`render/hazeshader.ts` `paniniSource`, `sceneTap`;
  `core/renderer.ts` `setCinema`, `panini`; `main.ts` `toggleCinema`). `-` now gives the
  letterbox and the lens together and takes both away; the death letterbox gets them too.
  Panini d defaults to 0.3 and is tuned live in a dev console with
  `__bro.renderer.panini = 0.5` (read back with `__bro.renderer.panini`; 0 is the plain
  frame; outside cinema the value is kept and the frame stays rectilinear). Strength is a
  uniform: 100 programs before, at Panini 0, 0.3 and 0.6, and after two cinema toggles in
  chase and cabin. FXAA, the ink, the haze rays, the dust wall, the mirage and the sand
  veil all read the scene through the lens; the binocular and viewfinder masks stay on
  the screen. While the lens is on the scene target is 1.25x per axis (1.56x the scene
  pixels) and sampled Catmull-Rom: at 0.3 the centre crop's 99.5th-percentile neighbour
  step is 55 with it, 51 at 1x, 53 for the rectilinear frame. Normal play is untouched:
  the new pass rendered against the old one from the same frame, FXAA on and off, differs
  in 0 of 10.9 M bytes.
- SHAKE KICKS REMOVED (`render/cameras.ts`, `main.ts`, `ui/menu.ts`, `mirage-lab.ts`):
  the dev-only event jolts of the driving view (throttle/brake onset, shift, landing,
  bump) are gone with their Pause › Shake kicks row, the `bro.shakeKicks` key and the
  `CameraTarget.velocityY`/`gearLabel` fields only they read. The speed sway
  (`setShake`, Camera shake setting) is unchanged.
- TRAFFIC KNOBS IN THE CONSOLE (`world/traffic.ts` `RoadTraffic.controlHz`, `cap`):
  `__bro.traffic.controlHz = 10` sets how many decisions a second the traffic drivers
  make (forces stay at 60 Hz), `__bro.traffic.cap = 30` overrides the menu's traffic
  ceiling (clamped 0-48), `= null` hands it back.
- TRAFFIC: ONE CEILING, A BIGGER STREAM, HUMAN-PACED DRIVERS (`game/settings.ts`
  `TRAFFIC_CAPS`, `world/traffic.ts` `TRAFFIC_CONTROL_HZ`, `DENSITY_FLOOR`). The ceiling
  no longer follows the carriageway's width: High 48 cars, Medium 24, Low 12, Very Low 6,
  two lanes or four. The stream's target is drawn in 35-100% of it (was 70-100%), so a
  drive swings between quiet and busy. Traffic drivers decide 12 times a second (was 45),
  chosen by the owner after trying 45, 10 and 5 live; an obstacle is answered within
  83 ms. A target above 24 cars still spawns faster and packs its lanes tighter.

- KIT CARS IN THE FEWEST FLAT FACES (`carkit/simplify.ts` `simplifyFlats`, run by
  `carkit/kit.ts` on every car after the leans). In each builder mesh a vertex whose
  triangles lie in one plane (0.1 mm, 1.5°) in one colour is taken out and the hole
  refilled with the fattest ears, no fans; zero-area triangles are dropped; a vertex on an
  open edge goes only where the edge runs straight on and no other mesh has a corner
  there. Every kit car 8-18% fewer triangles (2101 12 393 → 11 229, 2109 12 593 → 11 394,
  2115 14 070 → 12 224, 2110 16 584 → 13 723, 2112 16 553 → 13 634), all 13 bounds
  unchanged; the 2112's body paint 3 035 → 2 105 triangles, slivers 272 → 212, zero-area
  116 → 15. With it, at the owner's review of the 2112's rear corner: the wrap-round
  lamps are flat pieces bent only where the skin bends (`carkit/exterior.ts`
  `buildCornerLamps`, `carkit/body.ts` `tubColumns`; the 2112's tail lens 152 → 28
  triangles, no mosaic), a moulded bumper's small corner is one chamfer and its flank
  side has a point at each station (`flankBumperPath`, `BUMPER_CHAMFER`), the filler cup
  no longer shows through the closed flap of the 2110 and 2112 (`buildFiller`), a raked
  shut line's point within 5 mm of the flap's edge takes its height (`BodyFrame.shutLine`
  `ROW_SNAP`), and the 2115's rear bumper lies flush along the wings to the rear arch as
  its front one does (`carkit/samaras.ts`, `wrapTo` 3.675; fog lamps 15 mm inboard).
  `tools/kit-zfight.ts` passes on all 13; fit rows identical but the tens' `hoodPoint`,
  17 mm lower (sampled by vertex; the bonnet did not move); the car lab links the same
  programs as before, none from lamps or opened parts. ~35 ms per car at build.

- NEAR TRAFFIC CASTS ITS SHADOWS AS ITS FAR MESH (`vehicle/vehicle.ts` `castNearShadows`,
  `addStandIn`; `world/traffic.ts` `syncVisuals`; `core/renderer.ts` `SHADOW_ONLY_LAYER`).
  A shut near traffic car's casters (shell, glass, wheels) are exactly its model's far
  mesh, so its ~40 casting meshes stop casting and a shadow-only far field (`shadow-cars`)
  casts for it: one draw per model and shadow pass. The field's meshes are on a layer the
  viewing camera has only during three's shadow pass, so no picture draws them. A car
  with a door, lid or pane off its stop, or crashed, casts itself. Measured on the M2 Pro
  (Blessing, High traffic, cabin view): one near car 140 shadow draws a frame before; three
  near cars 2-4 after (the whole shadow pass 230 → 81). A/B screenshots of a near 2102 in
  the sun: no visible difference. Programs 95 → 94 over 45 s of driving.
- THE MIRRORS SHOW OTHER CARS AS THEIR FAR MESH (`render/carmirrors.ts` `standInCars`).
  While a mirror draws, every car but the player's own (traffic and parked) is hidden and
  drawn as its model's far mesh, its paint, dust and lamps per instance; a car with
  something open keeps its body. A near kit car was ~60 of a mirror render's ~200 draws;
  after, all near cars together are 2. A shorter mirror draw distance was measured and
  rejected: 300 m instead of the scene's cut a mirror's draws 202 → 193 (the world's
  batches span hundreds of metres) and would clip the 3 km sky dome.

- FXAA REPLACES MSAA (`render/hazeshader.ts` `fxaaSample`, `Settings.fxaa`, menu
  Antialiasing: FXAA / Off). The scene target is no longer multisampled: it carries a
  depth texture the post pass reads, so four samples meant resolving colour and depth
  every frame, on Blessing at up to 4800x2700. FXAA runs inside the existing post pass
  on the shaded picture, behind a uniform branch (no program change), before the ink;
  the row is hidden on Very Low. Defaults follow the rung as MSAA's did (Standard and
  Blessing on). A stored `msaa` is not migrated. Measured on the M2 Pro, Blessing at
  1936x1089: 1% of the pixels change, +0.4-1.0 ms of GPU. `tools/look/gpucost.mjs` A/Bs
  FXAA instead of MSAA; the no-timer attribution hint in the dev frame report now uses
  the render scale.

- KIT WIPER STALK WORKS AGAIN, 2110/2112 DASH AND WIPERS (`player/interaction.ts`
  `KIT_WIPER_ARM`; `carkit/interior.ts`, `exterior.ts`, `tens.ts`). The pick refused every
  part with control id `wipers` to keep the arms on the glass inert, and the stalk carries
  the same id: no kit car's stalk could be pressed. The arms are now told by node name.
  The tens' dash ends shallow at the doors and sits 5 cm higher in front of the driver
  (`dashLoft`), the front door handle and winder stand where the repair manual shows them
  (`frontDoor`), so the handle, winder and knees are no longer hidden. On a curved
  windscreen the wiper fit now parks the lowest arm (500 mm blades): the driver's tip
  0.084 m above its spindle instead of 0.19. Sources in `carkit/measurements-2110.md` §4.1.

- KIT Z-FIGHT GATE (`tools/kit-zfight.ts`, `carkit/README.md` "Check"). The scanner exits
  1 on any visible z-fight cluster in any band or any open shell hole, naming car, band,
  both emitters and the gap; its self-test now covers a slit. Required before a kit spec
  is accepted; README gains a section on writing specs without z-fighting.

- CLEAR GLASS FROM INSIDE (`carkit/rig.ts` `GLASS_INSIDE_OPACITY`, `setDetail(…, inside)`;
  `vehicle/vehicle.ts` `driveKit`). With the eye inside a kit car's measured body (its
  cabin view, any seat) that car's panes draw at opacity 0.05 instead of 0.28: the world
  through them as if they were hardly there, a glint and the dust still on them. Seen
  from outside, the chase camera and other cars, the glass is as before. An opacity
  write only, per car (each car has its own glass copy).

- THE CABIN VIEW TURNS BACK TO THE ROAD AFTER 1 S, NOT 3 (`render/cameras.ts`
  `CABIN_RECENTER_IDLE_SECONDS`), and not at all while E is held on the inside mirror
  (`CameraRig.setCabinLookHeld`): the head stayed on the mirror through 2.5 s of aiming,
  then eased back to the road a second after E was let go. The chase view keeps its 6 s.

- MOVE BETWEEN SEATS WITH F (`player/interaction.ts`). Seated, in the cabin view and
  with the car below the exit speed, look at another seat (a front seat, either half of
  the rear bench) and press F: the occupant moves into it. F at anything else gets out
  as before. The ray from a seat passes its own seat's back and head restraint, so the
  bench is reachable by looking back between the seats. Checked round all four seats
  of a 2104.

- THE INSIDE MIRROR IS AIMED BY HAND (`carkit/interior.ts` `MIRROR_CONTROL`, rig.ts `aim`,
  `player/interaction.ts` `aimingKit`, `main.ts` `MIRROR_HAND_*`). From the seat, hold E on
  the mirror and move the mouse: the head stays still and the mirror turns on its ball,
  up to 0.2 rad each way side to side and up and down (the view in it swings twice
  that). Let go and it stays; the aim is saved with the car (`CarState.innerMirror`,
  delta `car_mirror`). A load or a heavier engine settles the body and the view with it,
  as in a real car; this is how the driver puts it right. E held is a new input field,
  `InputFrame.useHeldDown` (keyboard and pad).

- THE DRIVEN CAR LAYS TWO HEADLAMP POOLS, NOT ONE (`vehicle/vehiclelamps.ts`
  `syncProjectedLights`, `beamCount`; `main.ts`). Where the tier draws shadows (Standard,
  Blessing) both headlamps went into the one shadow-casting spotlight as a single beam
  from between them, so the car lit the road with one pool and one glint. Now the
  driver's side lamp keeps the shadowed spotlight and the other lamp takes a pinned pool
  slot, at the same total light. The slot budget is unchanged: the pool gives that slot
  up from traffic beams (Standard: five other cars' merged beams instead of six; one
  fewer with the courtesy lamp on). Shadows come from one lamp, the other fills them a
  little, as a second real lamp does. Traffic headlamps stay one merged beam per car.
- INSTRUMENT LIGHTING (`carkit/interior.ts` `PANEL_*`, rig channel `panel`). With the
  side lights on, dipped or main beam, every dial's face is faintly lit and its ticks and
  needle glow (green ticks, orange needles); the ribbon gauge likewise. Lit faces like the
  warning lamps', slid out over the dial: no light, no new program (90 before and after
  switching the lights through every mode while driving in the cabin view).

- THE GROUND COVER HAS A RANGE (`world/props/instancebatch.ts` `BatchLod`, `syncLod`;
  `world/props/forms.ts` `COVER_BUSH_FAR_M`). The cover's batch pages are kept per
  160 m patch of ground, and once a frame each page takes its range from the camera:
  past the cover's 290 m fade it is not drawn at all (the cover is built 800 m along the
  road either side, and the vertex shader had been shrinking most of it to nothing every
  frame), and past 60 m the 946-triangle bush draws a 220-triangle one, the same clumps
  as plain icosahedra without the twigs. Same attributes, same program: none linked
  over a kilometre of driving. Measured at Standard, 1920x1080, LOD off against on
  over the same frozen frame: 2.28 → 1.35 million triangles and 0.9 ms of GPU at km 30,
  2.19 → 1.20 million and 1.0 ms on a crest at km 55; the frames differ in 232 of 1.44
  million pixels. Rocks, cacti and the trees stay as they were: 36-650 triangles each,
  and the dragon tree's 3808 come to about 80 thousand in a frame.

- MID-RANGE TRAFFIC IS A FEW DRAWS PER CAR (`render/farcars.ts` `MID_CAR_ENTER_M`,
  `render/carmodel.ts` `buildMidModel`, `vehicle/vehicle.ts` `drawMid`). Between 55 m
  (back near inside 50 m) and the far swap a traffic car draws its paint as one merged
  mesh with its OWN paint material (its dust and scratches stay), everything else as a
  shared per-model mesh and its wheel set as shared wheel meshes: one draw of its own plus
  shared ones, against about 28. A car with a door, lid or window off its stop, crashed
  or not upright stays near. Built at boot (boot 6.5 s on the M2 Pro); no program
  linked during 90 s of driving. Wheels do not turn at mid range, stickers drop.
  `__bro.midCars` (`enabled`, `stats`).

- NO HITCHES IN THE FIRST MINUTES OF A DRIVE (`app/bootwarmup.ts`,
  `world/props/delineators.ts` `delineatorProgramAnchor`). Every car model is built
  behind the loading cover now (body, template, program anchor, far mesh) instead of the
  first time traffic brings one: each was a 36-70 ms kit build on the M2 Pro, a dozen
  hitches in the first minute. And the roadside delineator runs' instanced program had
  no boot anchor (only the broken-post plain variant had), so the first run of posts,
  minutes in, linked it mid-drive. Measured from a fresh profile, 150 s of driving
  after New drive on seed `flick`: before, 12 frames over 25 ms (to 75 ms), 7 long tasks
  and one program link at 111 s; after, none of the three; boot 6-8 s.
- FAR TRAFFIC SWAPS AT 90-110 M, WITH ITS REAL WHEELS. The swap moved from 50-60 m,
  where it was seen, to beyond 110 m (back near inside 90 m). The far mesh wears the
  model's first Soviet wheel set, its colours sampled from the palette texture into the
  vertex colours (`FarCarSurface.map`); the Phong wheels had been dropped from the bake,
  so far cars had no wheels at all. Draw calls with the far LOD at the new distance:
  517-788 against 1091-1559 without, render CPU 2.7-3.3 ms against 5.0-6.0 ms.

- FAR TRAFFIC CARS ARE ONE DRAW PER MODEL (`render/farcars.ts`, `render/carmodel.ts`
  `carModelFarGeometry`, `vehicle/vehicle.ts` `syncVisuals`, `world/traffic.ts`). Each
  kit model gets one merged, shut far mesh at load (no cabin, bay, boot or underbody,
  opaque tinted glass); a traffic car beyond 60 m (back near inside 50 m) hides its full
  model and becomes an instance of its model's mesh, its paint and dust per instance,
  its lenses lit from its own lamps (beams, tails, brakes, reverse, blinkers), casting a
  sun shadow. Player-owned and parked cars, and a car just hit or on its side, stay full.
  Measured on the M2 Pro (High, 16-19 far cars, alternating 5 s windows):
  `__bro.farCars.enabled` on 517-618 draw calls and 2.4-2.9 ms render CPU, off
  1124-1129 and 4.9-5.0 ms; no program linked after boot, no shader errors.

- THE CABIN OPENS TO THE OUTSIDE BY ITS WINDOWS AND DOORS (`audio/cabinopenness.ts`,
  `AudioMixer.setCabinShell`, `audio/vehicleaudio.ts`, `audio/ambience.ts`). Every outside
  sound — the air, rain, animals, the other traffic, crashes and the open country's
  reverb — now reaches the ears through one cabin shell per ear on the world bus (the
  traffic and crashes were not muffled in the cabin at all before). Shut, it is the old
  1.5 kHz corner at -2.5 dB; each door, window, quarter vent and the tailgate opens its
  side of the car, a window steeply from its first centimetres, the listener's own row
  fully and the other row less, each ear hearing its side and some of the far one, turned
  with the head. The car's own tyres, wind and body open the same way, and an open window
  at speed drums harder. Measured in a 2107's cabin view (left / right ear corner): all
  shut 1.5 / 1.5 kHz; driver's window 15% down 3.9 / 2.3; fully down 11.2 / 3.7; every
  window down 14.5 / 14.5; the passenger's window 3.7 / 11.2; the chase view 16 / 16.

- KIT PANELS SOUND THEMSELVES (`player/interaction.ts` `KIT_PANEL_SOUND`,
  `listenForShut`; `audio/foley.ts`; new `bonnet-open`, `bonnet-shut`, `boot-open`,
  `boot-shut` recordings, CC0 from Freesound, in `tools/sound/manifest.json`). Any side
  door sounds its latch as it opens and its slam as it lands shut (`KitRig.position`, at
  2% of its travel); the bonnet and the boot or tailgate have their own pair. Getting in
  and out no longer plays a door: it is the doors themselves now. Checked on a 2107 by
  E on foot: door shut → `door-close` as it landed, open → `door-open`, bonnet open →
  `bonnet-open`, shut → `bonnet-shut`; reopening a door before it lands drops its slam.
- MIRROR FRAME RATE (Settings › Quality › Advanced › Mirrors: 10, 15, 20, 30, 60, Max;
  `Settings.mirrorFrameRate`, default 20). How many times a second each live mirror is
  redrawn, independent of the frame rate cap; Max is every mirror every frame. The
  renders are spread over frames by a clock (`CarMirrors.draw`). Measured in the cabin
  view: 10 → 10.0, 15 → 15.0, 20 → 20.0, 30 → 30.0, 60 → 59 redraws a second per mirror.
- THE CABIN VIEW FACES THE ROAD AGAIN 3 S AFTER THE MOUSE STOPS (`render/cameras.ts`
  `CABIN_RECENTER_IDLE_SECONDS`): the head eases back to straight ahead and level at
  the chase view's automatic rate; any look input stops it. Checked: turned 0.9 rad,
  held there for 2 s, back to 0.18 at 3.5 s and 0 by 6 s.

- KIT MIRRORS WORK (`render/carmirrors.ts`, `core/renderer.ts`, `carkit/interior.ts`,
  `carkit/exterior.ts`, `game/settings.ts` `mirrorScale`). In the cabin view of the car the
  player sits in, the interior mirror and both door mirrors show the world behind: each is
  drawn from the viewing eye reflected through its glass, through the glass's own corners
  (an off-axis projection, near plane on the glass), so the image is a true mirror's for
  any seat. The mirrors are aimed at the driver's eye. One mirror is drawn per frame in
  turn, into a small sRGB target like the scene pass's (so no program is new), with no
  shadow-map redraw and no post pass; off on 'retro', half size on 'acceptable'. Measured
  on the M2 Pro (blessing, 2107 on autopilot, four alternating 5 s windows): mirrors on cost
  +1.0 to +1.5 ms of render CPU and +350-500 draw calls a frame, 60 fps held throughout;
  programs 88 before and after entering the cabin view. `__bro.mirrors.enabled` toggles
  them, `__bro.mirrors.stats` counts their renders.

- KIT CARS: SIT IN ANY SEAT (`player/interaction.ts`, `game/state.ts` `player.seat`,
  `vehicle/cabincamera.ts`, `main.ts`). F gets in only while the eye looks through an open
  side door at a seat, and the player sits in that one: driver's, front passenger's or
  either half of the rear bench (`kit_bench` group). Only the driver's seat drives: from
  another the car holds where it stands and pedals, steering, gears, lamps and the
  autopilot refuse ("only the driver can do that"). The cabin view is from the seat (the
  passenger's is the driver's eye mirrored, the rear ones from `CarModelMeasure.rearEye`).
  F gets out through the open door on the seat's side and names it when shut. Saves keep
  the seat; older ones load in the driver's. Checked in a dev build on a 2107: through the
  open right front door the prompt read `[F] sit in the front passenger seat`, F sat there,
  W left the car at 0 km/h, F with that door shut refused, with it open stepped out on the
  right.
- KIT CLUSTERS READ EVERYTHING (`carkit/interior.ts`, `carkit/rig.ts`,
  `vehicle/vehicle.ts` `driveKit`). The dials that stood at mid-scale now have channels:
  the 2103's oil pressure (`oil`, 0 engine off, about 2 at idle, 4.5 from 3000 rpm, falling
  with a low sump), the 2105's and 2107's voltmeter (`volts`, 12.4 ignition on, 13.5 idle
  to 14.2 by 1500 rpm, less with the headlamps) and the 2107's economy meter (`vacuum`).
  Every cluster has working warning lamps (`tell_turn` blinking, `tell_side`, `tell_beam`,
  `tell_fuel` at `FUEL_RESERVE_FRACTION`, `tell_oil`, `tell_charge`, `tell_brake`,
  `tell_check` from the new `Vehicle.checkEngine`); a lit face on one shared unlit material
  slides in front of the dark lens, so a lamp changes no program. Cars that had none (2103,
  2106, the Samaras) got them. In the cabin view the on-screen cluster stands down
  (`Hud.setCabinInstruments`). Checked on a 2107: idle 850 rpm read oil 2, 13.5 V, vacuum
  0.75; at 3400 rpm under full throttle oil 4.5, 14.1 V, vacuum 0; the turn lamp blinked
  with the indicator and the high-beam lamp lit blue.
- KIT COURTESY LAMP (`carkit/interior.ts` `dome`, `vehicle/vehicle.ts` `syncDomeLight`,
  `main.ts`). E on the lamp in the headliner switches it; the lens glows on any car, and in
  the car the player sits in it also takes one light from the existing vehicle light pool
  (a warm spot straight down, 2.2 m, no shadow), asked for right after that car's
  headlamps. No new lights. On the 4-slot tiers with dipped beams on, it bumps the car's
  own tail-lamp light on the road while it is lit. Checked at 23:00: the pool spot appeared
  at intensity 8 over the driver; toggling linked no program.

- KIT CARS IN THE WORLD: the kit bodies (`src/carkit`, `kit_vaz2101` … `kit_vaz2112`, 13
  cars) are now the game's only cars. `CAR_MODELS` is `KIT_CARS`, so traffic (driver odds
  per kit model in `DRIVER_ODDS`), race rivals, contract cars, the story's start car,
  couriers, POI wrecks and the dev spawn menu are kit cars; the new-drive default is
  `kit_vaz2101`. The pack, GTA and carforge bodies stay in the car lab (`LAB_CAR_MODELS`).
  A save naming one loads on its kit twin (`sv_vaz2101` → `kit_vaz2101`, `sa_vaz2109` →
  `kit_vaz2109`, `gt_vaz2110` → `kit_vaz2110`, `sv_vaz2105r` → `kit_vaz2105`), one with no
  twin (Volgas, Nivas, UAZs, the Oka) on `kit_vaz2101`; the saved-drive list shows the body
  it will load on. Every world `Vehicle` of a kit model has a live rig, `vehicle.kit`
  (doors, bonnet, boot or tailgate, flap and cabin fittings as channels), fed every frame
  with the wheel, pedals, gear, handbrake, speed, revs, fuel, temperature, light switch,
  stalk and hazard button from the car, and drawing its cabin only within 25 m of the
  camera (`Vehicle.viewFrom`). Wrecks and couriers come shut and in the far pose. Checked
  in a dev build on the M2 Pro (seed 1337): a new drive starts at a kit 2108, the traffic
  was ten different kit models, `vehicle.kit.set('door_fl', 1)` swung the door; driving at
  55-70 km/h among 9-12 kit cars for 80 s, then with the driven car's doors, bonnet, boot,
  flap and a window open, linked no shader program (90 throughout), frames held 16.7 ms
  (p99 16.8, worst 25 ms) with no long task; a far kit car draws 6-9.5k triangles, a near
  one 14-15.5k. A save with an `sv_vaz21099` car and two `sv_gaz24` cars reloaded as
  `kit_vaz21099` and `kit_vaz2101`. A kit body is generated on a frame of its own when
  first needed (15-50 ms, measured headless).
- KIT CARS' RUNNING GEAR AND PROPORTIONS (`vehicle/carmodels.ts`, `parts/`): the kit 2110,
  2112 and 2115 have their own running gear instead of the 21099's: VAZ-21102 / 21122 /
  2115 1.5i on a new engine `engine_vaz_2111` (57.2 kW, 115.7 Nm) and
  `gearbox_samara_5_tall` (final drive 3.706), masses 1020 / 1020 / 985 kg. The kit 2101
  stands at its passport height 1.440 m (was 1.382) and the kit 2107 at 1.446 (was 1.435),
  fit rows regenerated. `sv_vaz2105`'s front weight share 0.51 → 0.548 (autoopt.ru kerb
  split 545/450 kg), which the kit 2105 inherits. `tools/reality.ts` has targets for every
  `kit_*` car (all 13 pass, per KitSpecs' run); new `tools/kit-proportions.ts`.
- KIT CARS (`src/carkit`, lab only): low-poly VAZ bodies built at load from a spec instead of
  read from a file, with a cabin you can see through clear glass and work. `kit_vaz2106` and
  `kit_vaz2108` (`LAB_CAR_MODELS`, `?car-lab&pack=Kit`) take their proportions from the factory
  drawings in `build/carshape/_refs/bp/img` and their running gear from `sv_vaz2106` /
  `sv_vaz2108`. The shell is a lofted tub plus a greenhouse of slanted pillar columns; doors at
  full size (a rear door reaches over its wheel with the arch cut out), bonnet, boot or
  tailgate and the fuel flap are cut out of it with shut gaps, jambs and inner skins and
  swing on hinges. Inside: dash with live gauges, wheel, stalks, pedals, gear lever, handbrake,
  sliding and reclining seats, glovebox, ashtray, radio, visors, window cranks and vent windows;
  an engine bay per platform, the boot and the underbody. They go through `buildTemplate` like
  any model, so paint, dirt, scratches, glass dust and lamps work as on every car;
  `CarModelDef.clearGlass` gives them see-through panes whose dust turns opaque. In the lab a
  click works a part (`KitRig`), a panel drives the cabin's inputs, and beyond 25 m a kit car
  drops its cabin, bay, boot and underbody and its glass goes back to a tinted mirror.
- KIT CARS, the classics: `kit_vaz2101`, `kit_vaz2103`, `kit_vaz2105`, `kit_vaz2107` join
  the lab's kit row, measured on the 3dcar.ru drawings and Commons photos
  (`src/carkit/measurements-classics.md`). A car's looks are now descriptions, not enums:
  each end face is a list of parts (`panel`, `round`, `lens`, `grille`, `cluster`, `frame`)
  placed against the face's own lines, bumpers are blades (two-tone, strips, plastic end
  caps, overriders from rubber blocks to chrome fangs) or moulded, and side trim is a sill
  strip, a waist moulding that breaks at the shut lines and rides on the doors, and wing
  repeaters. The 2101/2103/2106 share one shell and the 2105/2107 another (`onBody`); each
  has its own dash (`cabinLayout`: the 2101's ribbon speedometer, the 2103's five dials on
  wood, the 2105's pod, the 2107's one-piece panel). The 2105/2107 rear door carries its
  fixed quarter pane. The refactor was checked on geometry against the committed code: the
  2108 is identical, the 2106 differed by 0.29 mm in its grille bars before its trim was
  corrected to the measurements (black-insert waist moulding, repeaters, black rear panel
  in a chrome outline, 3×3 tail cells, end caps).
- Kit cars wear the Soviet pack's wheel sets (`DISTINCT_SOVIET_WHEEL_SETS`: the pack's six
  designs once each, so every design is equally likely; the shared pool repeats some), one
  set on all four wheels per car instance, picked by its appearance key and
  rescaled to the kit's tyre by `cloneWheels`. The kit's own wheel is a plain steel disc
  that only sets the wheels' places and size; the five generated styles and
  `Template.wheelStyles` are gone. The lab's `Экземпляр` slider and `?variant=` step
  through instances (paint and wheels together).
- Kit estates `kit_vaz2102` and `kit_vaz2104` (`src/carkit/estates.ts`, measured in
  `measurements-estates.md`): their saloons' fronts on a roof run to the tail, quarter glass,
  a roof-hinged tailgate with a flat sill (`TubStation.flat`) between corner lamps, the
  filler on the left (`flap.side`), and a load floor from the rear bench back
  (`loadSpaceStart`).
- Kit Samaras `kit_vaz2109`, `kit_vaz21099` and `kit_vaz2115` (`src/carkit/samaras.ts`,
  measured in `measurements-samara.md`): the 2108's shell from the nose to the B pillar
  with their own doors; the 21099's saloon tail with a boot lid; the 2115 (on the 21099's
  running gear) with body-colour bumpers and a boot lid that comes down between the corner
  lamps carrying the lamp bar. The 21099/2115 rear door's shut line runs unbroken from sill
  to roof rail, with a fixed quarter glass in the body behind it and a C pillar of even width
  parallel to the back light. New spec language: `TubStation.notch`, `FaceLook.lid` (face
  items riding on the lid), a moulded bumper `finish`. The other kit cars were proved
  unchanged by per-triangle hashes.
- Kit cars after the owner's review (`src/carkit/HISTORY.md` has cause and code for each):
  the estates' tailgate closes flush with nothing through the opening (end faces earcut, D
  pillar folded at the knee) and their back leans as one plane, lamps and all
  (`KitCarSpec.rearLean`), with the pillar trim stopping short of the opening; no
  spare-wheel box under the classic saloons and silencers tucked up; the 2108's face is a
  slotted body-colour panel (`'paint'` finish) between narrower trapezoid headlamps
  (`slant`), its wing tapering to the lamps; the 05 shell's bonnet nose is flatter and its A
  pillar slim, the door frame running up it (2104/2105/2107); the 2104/2105 share the 2107's
  headlamp units and black surround.
- Kit 2115 details (`src/carkit/samaras.ts`, measured on photos in
  `measurements-samara.md`): the late face's head lamps and indicators with cut corners
  (lens `chamfer`, negative `slant`), the slot under the bonnet's lip, rectangular fog lamps
  in black housings (a `panel` whose `x` is a span builds one block each side), grey door
  mouldings in line with a grey band round both bumpers (finish `'grey'`, moulded bumper
  `moulding`; a waist moulding now stops 30 mm short of a wheel arch), and a boot-lid
  spoiler with the high brake lamp that lifts with the lid (`KitLook.spoiler`). 12 092
  triangles; the other kit cars were proved unchanged by per-triangle hashes. The high brake
  lamp shares the brake slot, so it also glows with the tail lamps, and the fog lamps never
  light: the lamps have no role for either.
- Kit VAZ-2110 `kit_vaz2110` (`src/carkit/tens.ts`, measured in `measurements-2110.md` on
  3dcar.ru's `vaz_2110.jpg`, Commons photos and the published 4265 × 1680 × 1420, 2492
  wheelbase), on the 21099's running gear like the 2115: its own shell on the Samara
  platform with a waist rising to the C pillar, the rear door's shut line raked back along
  it and a fixed quarter glass in the body behind, a boot lid coming down between the
  corner lamps with the lamp bar on it, body-colour bumpers, narrow head lamps with a dark
  slot between. New `WheelSpec.rearArch` lets the rear arch hug the tyre while the front
  stands clear. The base early car (slot grille, no spoiler or mouldings) with its own
  dashboard (`CABIN_2110`, read off two Commons interior photos: a hood over swapped big
  dials, two big centre vents, a two-knob heater panel, the radio low in the stack); its
  rear door's edge rakes forward to the sill in front of a low elliptic rear arch, its
  turns rounded and the body behind it lined inside (`CabinColumn.foot` with `round`,
  `rearArchRise`), a bonnet over the whole top whose nose comes down between the head
  lamps carrying the slot (`KitCarSpec.bonnet`, front `FaceLook.lid`), a feature line
  under the windows (`featureLine`), a nose rounded in plan and a front bumper whose sides
  lie on the wings back to the wheel arch, its foot in line with the sill (moulded
  `corner`, `wrapTo`), one lid reflector across the centre line. 14 775 triangles; the
  other kit cars were proved unchanged by per-triangle hashes.
- Kit VAZ-2112 `kit_vaz2112` (`src/carkit/tens.ts`, `measurements-2110.md` §8, on
  3dcar.ru's `vaz_2112.jpg`, Commons photos and autoopt.ru's 4170 × 1676 × 1430): the
  2110's hatch on the same running gear, its own tail from the rear door — a quarter glass
  and wide D pillar, a tailgate folding at the knee over the lamps and coming down to the
  bumper between corner lamps that wrap onto the wings, reversing lamps and a red bar on
  the tailgate, a wing with the high brake lamp on the tailgate's glass (the spoiler now
  fits a tailgate as well as a boot lid). 14 705 triangles.
- Kit 2115 and 2110: the boot lid's rear corners meet the wings on a clean shut line with
  flat faces (the lid's top turns down to a line across at the lamps' top and its rear
  panel lies in the tail face between the lamps, `BodyFrame.lidFace`), and the head-lamp
  units lie flush on the body and wrap round its corners onto the flanks
  (`KitLook.cornerLamps`, laid on the skin as built, `skinX`); lens `chamfer` and
  `flankLamps` are gone. The 2110's front indicators are solid amber, and both cars' tail
  lamps now wrap round the rear corners onto the wings too (`CornerLamp.end`), ending at
  the tail's belt so the corner's shoulder above them is a straight cut with no body
  showing through the lens.
- Kit Samaras (2108, 2109, 21099, 2115): the face and head lamps rake back from the
  bumper's top to the bonnet's lip as on the cars, instead of the bonnet overhanging the
  lamps (`KitCarSpec.frontLean`, the estates' tail lean at the nose).
- Kit 2110/2112, the owner's review round: bumpers sit in the body's lines (moulded
  `flush`, the rear ones on the wings to the arch), the face leans back from the crease to
  the bonnet's lip over a bumper whose top stays below the lamps (`frontLean` gains
  `full`; the nose face is cut along the lean's base so lamps and faces lean as one
  plane), shorter indicators, one straight bonnet slope.
- Kit Samaras and tens: the windscreen is curved in plan and more raked
  (`CabinSpec.screenFoot`, the bonnet ending at its foot) and the A pillar rounds into the
  roof with one chamfer (`CabinColumn.drop`), the door frames meeting it.
- Kit 2115: its own late nose — the face nearly the body's full width at the lamps, tall
  head lamps, a shallow flush bumper with its grey band at plate height continuing as the
  door mouldings, a dark intake strip under it and fog lamps low at the corners.
- Kit hatchbacks and estates (2108, 2109, 2112, 2102, 2104): no more slits along the rear
  quarter between the greenhouse and the wing (the greenhouse's foot now bends with the
  tub's edge at the stations between its columns). The classic saloons are unchanged.
- Kit documentation for agents: `src/carkit/README.md` (working rules, spec reference,
  adding a car end to end, proving refactors), `STATUS.md` (goal, roadmap, per-car status,
  gaps) and `HISTORY.md` (fix log and approaches not to retry).

- THE VAZ-1111 OKA IN THE PACK'S STYLE (`cf_vaz1111`) REPLACES the GTA SA Oka (`sa_oka` is
  gone from the catalogue, its `oka.glb`, `tools/oka-author.py` and the trim-plate rear screen
  cut `glassOverTailOpening` / `rearScreenMaterial` with it; a save holding an `sa_oka` loads
  it as `cf_vaz1111`). `public/models/carforge/vaz1111.fbx` is built by `carforge.py` from
  `examples/vaz1111.json`, a clean parametric rebuild from the VAZ-1111 blueprint proportions;
  GTA geometry is used only as a comparison reference, not as the generated surface source.
  carforge cars are: the pack's atlas, glass in its (3, 1) cell, one node per lamp role.
  The current build is checked by `holes.py` and the pack's fit/reality tools. Its rules from
  the owner's reviews are in the carforge README (one wing edge, an A pillar of constant width,
  windscreen stopping at the cowl). The front follows the reference: a painted panel round the
  lamps (it was black across), the offset grille's three slots between painted bars, its badge,
  the bumper's blinkers lower, vent slots and plate area.
  The rear too: the back light a trapezoid wider at its foot, set lower, as the reference's,
  and the bumper's plate area. The front panel leans back 13° as the reference's (it stood
  upright), lamps, frames and grille with it; the bonnet's front shut line runs straight
  across. The tail lamps sit in the rear face, flush and leaning with the tail, instead of
  wrapping the corner 12 mm proud as upright blocks; the tail runs out square behind them and
  the rear corner no longer folds where the shoulder met the C pillar; the lower tailgate is
  recessed. carforge: `recesses[].top` (a trapezoid outline), `nose.rake` / `tail.rake` (a
  raked end face; flat lenses and frames on it lean with it), `lean` on flat items. The GAZ
  builds vertex-identical.
  The generator now has reusable `edge_roll` end bands for a clean bonnet corner, explicit
  per-corner `outline` radii and conforming lamps: the Oka's rear lenses follow the rounded
  tail surface in three bands instead of floating blocks; `lean` lays flat lenses into a
  sloping face. Its front/rear plastic panel and grille now use the bumper's dark trim cell,
  and the rear glass outline follows the tailgate's tapered roof contour.
  The shell now supports explicit `join_bands`: the Oka keeps stable cross-section rows through
  the front and rear corner transitions, so side-to-face seams are broad transition surfaces
  instead of folded-ring diagonals. The existing generated UAZ/GAZ rules remain unchanged.
  The Oka shell was then rebuilt from simplified blueprint curves: the bonnet, roof, sill and
  rear corner no longer inherit the dense GTA trace, and the body joins are generated from the
  same explicit surface bands used for the Soviet VAZ wire references.
  - The GTA model reduced by `reduce.py` (`examples/reduce_vaz1111.json`) was shipped for a
    while and taken out: its shape was closer, but a reduced game mesh keeps that mesh's stray
    triangles (dirty creases, a chewed rear bumper, glass unlike the pack's) and slits between
    its panels. An inner skin under its panels (`skin`, `tools/carforge/solid.py`) closed the
    slits but not the dirt. The route stays as a tool, not as the way to build a pack car.
  - `tools/carforge/holes.py`: the watertightness check (the body without wheels on magenta,
    backface-culled as the game draws it, background pixels inside the silhouette counted per
    view). `render.py` culls back faces like the game, and takes `--bg` and `--hide`.
  - Running gear, masses, passport and driver odds are the GTA Oka's, unchanged
    (`reality.ts`, `handling-cli.ts` read the same as before). Tool defaults that named
    `sa_oka` (aero, cargo-load-bench, climb-sweep, roll-balance) name `cf_vaz1111`.
  - reduce.py: `panel`, `drop` (loose pieces by size or box), `flat`, outward-facing pieces and
    glass, pane edges dropped. carforge: a `single` side item with `right: true` stands on the
    right side; plates are probed onto the body with its bumpers; a grille bar set may keep to
    part of its recess (`bars[].x`); `bumpers[].wrap.profile` (a measured section); `cells`
    (shell quads in a box take a cell). The UAZ's and GAZ's bodies are unchanged.
    `refgrid.py` normalises a glTF reference to the spec frame and measures it with rays.

- THE GAZ-31029 VOLGA (`cf_gaz31029`), the second car built here, loaded as the UAZ is
  (`public/models/carforge/gaz31029.fbx`). Its watertight body, floor, glass, panel gaps,
  grille, bumpers, mirrors, handles and lamps are generated by `carforge.py` from
  `tools/carforge/examples/gaz31029.json`; no reference mesh is shipped.
  The body profile starts with `trace.py` on the watermarked the-blueprints.com preview
  (`examples/sheet_gaz31029.json` → `build/carforge/gaz31029/blueprint.json`) and is then
  refined against AKROM's GTA V model for the Volga's hood, roof, glass, arches and tail.
  `tools/carforge/reduce.py` and `reduce_gaz31029.json` are comparison experiments only.
  Checked again against the drawing's four views, the photographs and AKROM (scaled to the
  2800 wheelbase, level): the nose was 180 mm short (face now at y = −835, the hood's front
  gap across it), the front arch narrower and taller as drawn, the tail's upper panel leans
  back and rolls over convexly, the body behind the rear arch no longer hangs below the drawn
  line. Rectangular headlamps and the amber indicators turning the corners, wing repeaters, a
  chrome-framed grille grid; at the rear two units per side, the boot lid's (red, reverse,
  red) and the wing's (red, amber round the corner), with the lid's gap coming down between
  them to its bottom edge over the bumper. Black plastic bumpers wrap round to the arches;
  mirrors sit on the door top by the A pillar on a short base; door handles, the C-pillar
  vent and the fuel flap on the left rear wing (a closed panel gap). The windscreen and back
  light glass now end where the side glass does.
  - carforge: the windscreen and back light glass span the slope between the side glass's
    lowest and highest edges (`screen_glass`, replacing the fixed 60 mm frame); `bumpers[].wrap`
    sweeps one section round the corners and back along the sides; `lamps[].wrap` turns a
    front or rear lens round the corner as one piece, `wrap: [bottom, top]` slanting its edge on the side (the GAZ's indicators lean as on a side photo); `recesses[].frame` (a chrome surround),
    `bars` as a list (a grid) and `housing` (a lamp cluster's dark body that lamps may sit
    in, for `check_layout`).
  - No z-fighting in the grille: carforge's recess `frame` no longer runs its inner wall on into
    the opening, where it lay on the pocket's own wall.
  - The UAZ-31512's spare hangs on a carrier: a black cross bar and upright on the tail door
    and a steel hub boss into the wheel's centre (`chassis` boxes in `sheet_uaz3151.json`).
    The body, the spare's position and the fit are unchanged (owner: a cosmetic part never
    moves the body).
  - Figures: 4885 × 1800 × 1476 mm, 2800 wheelbase, 1495/1425 tracks, 205/70R14 radials,
    kerb 1400 kg, 55 L, 5.6 m turn (drom.ru catalogue, ru.wikipedia). The body's floor stands
    at 220 mm (`clearance`; the GAZ-3102 factory sheet's sill, 3dcar.ru; the passport's 156 is
    under the rear axle, which the body has no part for). New engine `engine_zmz_402` (100 hp
    at 4500, 182 Nm at 2500; the Volga block's mesh) and gearbox `gearbox_gaz_4_31029` (the
    24's four-speed on the 3.9 axle: the 4.1 tops out at 141 km/h). Chassis, suspension and
    aero are the GAZ-24's. In traffic it is never a sleeper: half hurried, half frantic.
  - `tools/reality.ts`: 143 km/h against the passport's 145-150 (the cut in fourth), the
    5.6 m turn within 0.7%, 35.7 m laden from 80 under the 43.2 ceiling.
  - Kept from the tracing attempt, as general fixes: `tools/carforge/lines.py` (a filled,
    watermarked colour preview made a line drawing); `trace.py` finds a tyre whose top is lost
    in a dark wheel well, keeps a rim and its tyre apart, traces a raked windscreen and back
    light from the roof line, drops a triangular "window" past the C pillar, closes
    `plan.high` notches from pillar lines, tapers the greenhouse from past a saloon's wing step
    up to the roof rail, ignores the sheet's mirrors in the front view, takes hand arch
    outlines in mm and skips the detail rules on `details: false`; carforge no longer paints
    the rail chamfer beside a windscreen or back light as glass. The UAZ's blueprint and body
    are unchanged.

- THE UAZ-31512, THE FIRST CAR BUILT HERE (`cf_uaz31512`). The civilian 469 after 1985
  with the factory hard top, generated by `tools/carforge` from the UAZ-3151 factory
  drawing and loaded the way the Soviet pack is: FBX, the pack's atlas, glass in its
  (3, 1) cell, one node per lamp role (`public/models/carforge/uaz31512.fbx`).
  - Figures from the UAZ manual RE 05808600.072-2000: 4025 × 1785 × 2020 mm, 2380
    wheelbase, 1445 tracks, 220 mm under the axles, 215/90-15C cross-ply, kerb 1750 kg
    at 950/800 (the 31514 hard-top column), two 39 L tanks, drums with a booster, leaf
    springs at both ends and no anti-roll bar. New engine `engine_umz_4178` (2.445 L,
    55.9 kW at 4000, 159.8 Nm at 2200-2500, GOST net; the Volga block's mesh and
    friction); the gearbox is `gearbox_uaz_4`, the same 3.78/2.60/1.55/1.00 on 4.625.
  - `tools/reality.ts`: 110 km/h against the manual's 110 (Cd·A 2.2 holds it), 42.9 m
    laden from 80 against the 43.2 ceiling, the 6.3 m turn (lock 0.455; the 27° the
    manual prints for the inner wheel turned it 4% tighter). Always a sleeper in traffic.
  - The body got what the game needs and the drawing does not show: the rear door
    outline with its hinges and the number plate, and frame rails, axle beams and
    differentials under it (`chassis` in the carforge spec): the loader fits the body
    box between the factory clearance and height, so the lowest part has to be the
    differentials at 220 mm, not the bumper at 406.
  - The trace no longer dents the wing over each arch: `plan.low` under an arch stops at
    the body line bridged across it instead of taking the whole wall in by the lip's
    full flare. `fairness.py` on the UAZ: 26 → 18 ripples, none over the arches.
  - `tools/hood-mount.ts` installs the DOM shim: a driven copy's sticker atlas needs a
    canvas, and the check stopped at `document is not defined`.

- EVERY ROADSIDE DWELLING HAS A PAVED LAY-BY (`world/layby.ts`, `world/laybymesh.ts`,
  `world/terrain.ts`). In front of each petrol station, shop, house, salvage yard and
  scrap stop (not the masts) the asphalt leaves the road edge, eases out over a 36 m
  slip to a pad 44 m long and at most 8.5 m wide past the road edge, stopping 2 m short
  of the building's front wall, and eases back over a mirror-image 36 m slip: 116 m of
  real asphalt on the building's side. It is attached to the existing stops, so
  `Poi.index`, loot and saves are untouched.
  - The roll is shared: the roadside slot roll moved out of `world/poi.ts` into
    `world/poislots.ts` (with `POI_SPACING`, `PoiStock`, `rollStructure`, `MAST_IDS`),
    and the dwelling catalogue's data into `world/dwellings/list.ts`, so the lay-by can
    be computed in the desert tile and vista workers without three.js.
  - The terrain levels the whole site, pad and building alike, to the road's own edge
    height carried out with a 1% crossfall (`laybyFlattenWeight`, `laybyLevel`, in
    `Terrain.baseFromFrame`, so `heightAt`, the tiles and `drawnGroundY` all see it),
    easing back to the desert over 12 m; the detail layers are faded by the same
    weight. Measured on seed 1337's first seven lay-bys: the ground across the road
    edge steps at most 1.3 mm, `heightAt` on the pad matches the pad's level to
    0.0000 m, and the building's fitted plane has 0.015-0.028 m of residual.
  - The pad is drawn with the road's own material object and attribute set (no new
    shader program) on the road's own rows, so it shares the ribbon's edge vertex for
    vertex; its collider is Asphalt trimesh slabs, and `Terrain.surfaceAt` reads
    Asphalt on it. The desert tiles sink the ground 0.1 m under and round it, and the
    pad's outer lip goes down into the sand. In the game (seed 'flick', 7.7 km): the
    collider steps at most 1.2 mm across the road-edge joint (448 raycast pairs), a
    car driven in, parked on the pad and out had all four wheels on Asphalt on the pad,
    its vertical-velocity jolt crossing the entry slip was 0.028 m/s per 16 ms against
    0.027 on the plain road before it, and the lay-by mesh drew with the road ribbon's
    own program (0 new programs while it streamed in and was driven).
  - The verge makes room: the shoulder strip folds under the edge along a lay-by, and
    rocks, ground cover, reflector posts and sidetracks keep off it; a pole that would
    stand on it is left out and the line spans the pad. A stop's wreck field lays out
    clear of the asphalt (`tools/wreck-spacing.ts` checks it: 0 bodies on a lay-by in
    396 fields), and a courier parks on the pad's building side.
- TRAFFIC STOPS AT THE LAY-BYS (`world/traffic.ts`, `vehicle/autopilot.ts`). A driven
  car coming up to a lay-by on its own side of the road (forward traffic the right-hand
  ones, the other stream the left) rolls once, from its id and the stop, while the
  entry is 140-280 m ahead: a quarter of them signal right, ease down to 30 km/h for
  the slip, drive up it and along the pad at 15 km/h, and park on the pad's parking
  line for 20-90 s with the handbrake on. Then they signal left, pull up to the end of
  the pad, wait until nothing in the lane they join would reach the end of the exit
  slip within 7 s (plus 40 m, the player included), and rejoin; racers never stop.
  - The driver follows the stop on its own branch (`Autopilot.setLaybyCourse`,
    activity `layby`): the road controller's pursuit, lane hold and yaw damping on the
    course's line, the hold-line braking curve to its place, the road's bends, and a
    stop behind any dynamic body, prop or pedestrian on the line — the car parked in
    front, or the player's own car left on the pad. Handing the road back is a fresh
    engagement, as after the rails.
  - Two places per pad, 10 m apart; a car only takes the place behind every car
    already there and only one car is on its way in at a time, so nobody drives through
    a parked car. A pad with a courier too near its parking line, or with no collider
    under it yet, is not stopped at.
  - A car on a stop is out of the deadlock, bottleneck, reverse-room and passing rules,
    never goes on the rails, and is not recycled as stuck while it waits; one that
    stands still for 30 s on its way in or out gives the stop up to the road's driver.
  - A lay-by coming into the spawn band ahead sometimes (35%, rolled per stop) has a
    car already parked at it when the player arrives.
  - `tools/traffic-bench.ts` paves the road and pad round seed 42's lay-by at 23.1 km
    and watches it for 600 s with the player standing there: 4 cars parked and 4 back
    in the lane, 0 impacts, the parked cars within 0.10 m of the parking line over
    14 364 samples. The right-hand lay-by at 30.8 km (forward traffic): 3 parked, 2
    back out in 600 s, 0 impacts. Cars commit 190-270 m before the slip at 54-72 km/h,
    are parked 25-30 s later, and are back in the lane at 40-44 km/h about 10 s after
    leaving the pad.

### Changed

- THE ROAD ROLLS AGAIN: SHORT RISES, LONG DESCENTS, CRESTS YOU CANNOT SEE OVER
  (`world/roadswells.ts`, new; `world/landscape.ts`, `world/roadcharacter.ts`,
  `world/road.ts`). The felt landscape bands made climbs of 4-14 km that the owner drove
  as a flat plateau. They are now lower: hills ±175/±60 m → ±25/±25 m, rolls ±30/±8 m →
  ±5/±3 m, and the long altitude bands ±700/±350 m → ±400/±120 m. What a driver feels
  now are the road's own SWELLS. A swell is a ridge laid across the road from the spine:
  a climb of 110-450 m, a crest curve, then a descent 2.4-4 times longer. It is 90-200 m
  wide at full height and fades out over 320-480 m either side, so the desert rises with
  the road and the road does not sit on a dyke. Each swell sits inside its own 950 m slot.
  It is added to `Landscape.heightAt` as a position-pure overlay
  (`LandscapeOverlay`, `baseHeightAt` for the bare bands), so the road, the terrain, the
  tiles, the vista and every worker read the same field, and net elevation cannot drift.
  The district sets the chance, height, climb length and crest length
  (`RoadCharacter.swell*`). A swell is paired with a corner in its slot where one fits:
  a bend over a blind brow, a bend on the rise, or a bend out of the dip.
  - THE CLIMB BUDGET IS A SPEED. Every swell is driven before it is built, by `WEAK_CAR`:
    the VAZ-1111 Oka, 710 kg with its driver, 16 kW at the wheels (the least its torque
    curve and gearing give from 60 to 90 km/h). It starts at 90 km/h on gravel's rolling
    resistance, with the bands underneath. A swell is lowered until the car loses at most
    11 km/h (`CLIMB_LOSS_KMH`), or it is dropped. A swell is also dropped if the road
    through it would be steeper than 13%. Where the bands are already lifting, the descent
    is made to fall 1.2% steeper than the lift, so it still reads as a descent.
  - A swell is dropped if the road doubles back across it. If another pass of the road
    is within reach, the swell is narrowed or dropped. `RoadHeading`'s crest probes read
    the bare bands.
  - MORE CORNERS. `cornerSpacing` changes: pan 1400 → 1000 m, highway 1300 → 950, rolling
    750 → 560, esses 500 → 440, derelict 1000 → 750. Radius ranges are wider: pan 450-1400,
    highway 260-900, rolling 130-420, esses 140-300, derelict 80-200. The pan's banking share
    goes 0.2 → 0.5. `SPINE_FORMAT` is now 11.
  - Measured by `tools/road-rhythm.ts` (new), over km 0-300 on seeds 1, 7, 42, 1337 and
    90210, before → after:
    - Corners per km: 1.27-1.55 → 1.53-1.73. Median radius 187-218 → 198-252 m; p10
      125-137 → 126-138 m.
    - Grade |p50| 1.8-2.4% → 1.3-1.6%, p90 5.6-6.8% → 4.3-4.8%, max 11.9-12.8% → 11.8-12.7%.
    - Crests per km: 0.65-0.83 → 0.94-0.99. Blind crests per km: 0.50-0.75 → 0.81-0.90.
      Crests with a corner within 150 m: 35-54% → 52-63%.
    - Mean climb 585-802 m → 339-494 m. Mean descent 565-815 m → 550-707 m.
    - Longest climb 8.6-14.6 km (up to 512 m tall) → 2.5-4.3 km (at most 63 m, at ≤1.5%).
    - The Oka's worst loss anywhere: 9.2-10.9 km/h → 7.1-10.5 km/h.
    - Net change over 300 km: -836…+1312 m → -625…+719 m.
    - Banking stays at a cap of 8%, now on 15-18% of the road (was 14-16%).
  - `tools/road-rhythm.ts` fails if the worst loss is over 15 km/h. It also fails if
    `WEAK_CAR` is ever stronger than the catalogue's weakest car really is.
  - A cold 10 km road block now takes 2.2-2.4 ms to build, up from 1.2. A block builds
    the swells under it from its own walk (`RoadSwells.adoptBlock`), and only replays
    the slots that straddle its ends. Heights read the last query cell without a map
    lookup. The whole-road index the swells use (8 ms) is built when the spine arrives.
  - THE POLICE FLIGHT CLOCK on rolling road (`world/police.ts`). The clock now counts
    while the police car is within 300 m of the player (`LIGHTS_SEEN_M`, was 150 m).
    On seed 42 a pursuer slowing at every blind crest had sat 150-310 m behind a
    110 km/h runner for three minutes, and the clock never started. Braking for a bend
    pauses the clock instead of restarting it: `paceKmh` eases down by 1 km/h each
    second, and only dropping under half that pace restarts it.
    `tools/police-bench.ts` passes on seeds 42, 7 and 1337.
- MESAS ARE BACK BESIDE THE ROAD, AND THEY STAY (`world/mesas.ts`, `world/mesacolliders.ts`,
  `render/vista.ts`).
  - One seed-pure module now places the mesas, and the vista, the colliders, the scatter
    and the check tool all read it.
  - A site is rejected if its footprint comes within 220 m (`MESA_ROAD_CLEARANCE_M`) of
    any pass of the road. It is also rejected within 40 m of a roadside landform or lake
    basin. A rejected cell tries up to three other spots inside itself.
  - The vista's dissolve is deleted outright. Within 720 m a mesa stands on the exact
    ground, and it becomes a static Rock trimesh within 1.5 km.
  - Scatter, ground cover, tile props and desert buildings are kept out of mesa footprints.
  - `tools/mesa-clearance.ts` (new) checks 9 seeds × 250 km on the final road. It finds 0
    intrusions; the old placement had 131, with 91 across the road. It also finds 9.6
    mesas per 100 km within 1 km of the road, and a nearest clearance of 227 m.
- Kit cars: the driver's eye is lowered, by at most 3.5 cm, until the windscreen's header
  stands 10° over level (`driverEyeAt`). On the low roofs the header had stood at eye level
  and hidden the sky. The classics gain 5.5→8°, the Samaras 7.25→10.5°, the 2110s
  8→10.5°, the GAZs to 10–10.5°, the Espero 8.25→10.75°. Road visibility over the bonnet
  stays within 7–11 m ahead.
- Kit cars' sun visors are sized per car so that, lowered, they end at the driver's eye
  height. Classics 0.13, 2104/05/07 0.128, Samaras 0.134, 2110s 0.137, Oka 0.119, Espero
  0.078, Astra F 0.108; the stock 0.15 elsewhere.
- THE COURIER'S BOOT OPENS ON ITS LID (world/couriers.ts, render/carmodel.ts
  `createCourierCarModel`, player/interaction.ts). The quest-giver's trunk grid used to
  open on F straight through the shut boot lid. The courier's car now hangs its boot lid
  or tailgate (both leaves of the UAZ-2206's) on the driven car's hinge, as a roadside
  shell's are (`StaticCarLids`, the `'boot'` lid set of `kitStaticParts`), and E opens it:
  the lid swings, the boot shows under it and the grid opens with it; E again shuts the
  lid and the grid goes. F takes and stows in the open cells as before, and at the shut lid
  does nothing. Its bonnet and doors stay part of the shell: no prompt, E does nothing. A
  contract is delivered into the open boot. One draw more per courier, programs anchored
  with the wreck's. `bun tools/wreck-lids.ts` checks the hinge, the cut, E, F and every
  cell on four bodies.
- TWO CLOUD DECKS, EACH ON ITS OWN WIND (render/cloudfield.ts, render/clouds.ts,
  render/cloudshadow.ts). Over the cumulus now stands an altocumulus deck: flat rafts
  1.5-4 km long, a tenth as thick, 4.3-5.5 km up, in districts of their own and casting
  half a shadow. The low deck's wind is 9 m/s (was 6), the high deck's 18 m/s veered 32°,
  so the decks slide across each other (`cloudDeckWind`, `cloudDeckShift`). A cloud is
  overhead 24.5% of the time (the cumulus alone 12.2%, as before), so looking up from the
  road meets sky with something in it rather than only the band near the horizon. The
  layer places each deck by its own drift; the shadow map and its CPU twin
  (`cloudCoverAlong`, `cloudShadeAlong`, which now take the decks' shift) follow both.
  Same draws, same programs. `bun tools/sky-variety.ts` checks the deck's height,
  thinness, the shear and the overhead share.
- UAZ-469 AND UAZ-2206: THE DASH IN THE BODY'S COLOUR (carkit `KitLook.dashPainted`).
  The dash, its instrument plate and the glovebox lid are drawn in the paint slot, so they
  take the car's paint, dust and scratches; the knobs keep the old olive shade.

- CLOUDS FROM BELOW (render/cloudfield.ts, render/clouds.ts). Every big lobe used to be
  centred at or under the base, so the flat cut was each lobe's widest section: from
  under a cloud the whole outline was one flat face with one normal and one blue-grey
  colour, a slab under a white top. Body and crown lobes now stand over the base
  (`BASE_LIFT_MIN`/`BASE_LIFT_SPAN`, centre 0.55-0.78 of the vertical radius up), so the
  cut is a core of 69% of the outline (median; was 100%) with rounded flanks turning
  under to it, and every lobe's lowest rings still clamp into the base plane, so
  overlapping cuts stay coplanar. The underside's ambient is the horizon's paler sky with
  three times the sand bounce (noon base 0.13 → 0.20 of the lit top, blue/red 1.96 →
  1.16), and sunlight scattered through the body lights the sunward flanks (1.3× the
  core at noon), fading out at sunset. A cloud's length is eased under twice its
  district's base (`LENGTH_PER_BASE`, `fitUnder`): seen from right under it none spans
  over 105° (was 139°, a 6.9 km raft on a 1.3 km base). `CLOUDS_PER_CELL` 0.045 → 0.05
  holds the cover at 12% (14.5% before, 11% with the shorter clouds alone).
  tools/sky-variety.ts checks the cut share, the clamped bottoms and the overhead span.
- LIVE BEAM AXLES (`SuspensionTuning.frontAxle`/`rearAxle` in parts/registry.ts;
  `Vehicle.updateBeamLean` and `stepBeamAxleHop` in vehicle/vehicle.ts;
  `BEAM_AXLE_GYRATION_SQ` in vehicle/vehicletuning.ts). Every axle now says whether it is
  `independent` or `beam`. Beams: the rear of the Zhigulis (2101-2107), Nivas (2121,
  2131), Volgas (GAZ-24, 31029) and the IZh-2715, and both axles of the UAZ-469 and
  UAZ-2206. The Samara family, 2110 family, Oka and 2141 rears are twist beams and stay
  independent.
  - Rapier's ray springs are unchanged. For vertical force a massless beam with its
    springs `s` apart on a track `t` is exactly two independent corners plus a bar of
    `(s/t)² − 1`, which the leaf cars' negative bars already are.
  - The wheel-hop layer under the collider is one rigid axle per beam: heave and roll, a
    mass matrix with roll inertia `0.6 · m · (t/2)²` (the 2101's 52 kg axle and its
    wheels: final drive in the middle, drums and wheels at the ends), and seat springs
    with `(s/t)² = 1 + bar`. Driven alike on both wheels it matches the old quarter-cars
    to 1e-10 m (2101) and 1e-7 m (UAZ-469). Driven on one side, the other wheel now
    moves: a 15 mm ripple under the left wheels, which used to leave the right ones at
    exactly 0, moves the 2101's right rear −0.27..+0.49 mm (UAZ-469 front and rear
    about −0.3..+0.25 mm).
  - A beam wheel's camber is the axle's own tilt against the contact normal under it,
    or against the line between the two patches for sub-collider relief, clamped to
    `AXLE_ROLL_LIMIT_RAD`. It used to be the static figure always (roll camber 0). On a
    flat road it is 0 whatever the body does; with one wheel on a 6 cm step both wheels
    lean (peak camber steer 0 → 4.6 mrad on the 2101 rear, 3.5 → 11.9 on the UAZ-469
    front's far wheel).
  - Unchanged: static stance (body height and all four compressions on every probed car,
    the UAZ-469 front 0.1 mm), the independent cars (2108, 2110 physics-suite and probe
    output bit-identical), and the 2101 and Niva suite rows, which are identical too.
    `tools/physics-suite.ts` (+150 kg, flat asphalt, `build/physics-suite/beam-before`
    → `beam-after`): GAZ-24 80-0 +0.01 m; UAZ-469 100-0 58.50 → 58.39 m, understeer
    2.32 → 2.28 °/g; UAZ-2206 100-0 54.42 → 54.50 m, understeer 2.12 → 2.13 °/g; yaw
    and drift in the brake stops within 0.3° and 0.04 m. A repeat run is bit-identical.
    On a random ±0.06/±0.12 m heightfield (1 m cells, sand and gravel, 30 km/h, 25 s),
    against the same cars with the pairing removed in-process (the old path): no car
    flipped, distance within 1 m, body roll RMS within 0.5° (UAZ-469 on ±0.12 m sand
    3.00 → 3.48°, peak 7.7 → 13.2°), wheel-load peaks within 0.4 of static.
    `tools/suspension-probe.ts`: sag, weight split and drop settle times unchanged, brake
    dive within 0.01°, texture jolt within 0.001 g, tyre deflection within 0.21 mm (2108
    unchanged). `tools/surface-feel.ts` (2105 rally) road
    rows: heave within 0.002 g, hits/km −1 to +2. Its desert row tumbles from its spawn
    in either build (166 g) and lands differently: 46 km/h over 1080 m before, upside
    down at 32 m after; not a measure of this change.
  - `tools/suspension-probe.ts` installs the document shim; it crashed on `document` in
    the car's sticker atlas before reaching any car.
- THE REAR BRAKE REGULATOR ("регулятор давления задних тормозов", `CarModelDef.rearBrakeValve`
  and `RearBrakeValve` in vehicle/carmodels.ts; vehicle/vehicle.ts). The Zhiguli
  (2101-2107), Samara (2108, 2109, 21099 and the 2110/2115 on its running gear) and
  AZLK-2141 now pass their rear brakes the master-cylinder pressure only up to a knee, and
  a share of every further rise past it. The knee rides on the rear springs' compression,
  as the real lever does: it climbs with a loaded boot, drops as braking lifts the tail,
  and is gone with the axle hanging. It reads nothing else (no tyre, no slip, no wheel
  speed), so it is not an ABS: the rears still lock on gravel at a hard pedal. The fixed
  0.42 rear split, the handbrake and `brakeDecelG` are unchanged.
  - Zhiguli (`idealKnee`): no valve figure was found, so the knee is where the 0.42 split
    meets the kerb car's ideal distribution, z = (r0 − 0.42)/χ ≈ 0.33 g (r0 the static
    rear share, χ = CoM height/wheelbase), set at the kerb so the tail rising by that much
    brings it there; the slope puts a floored pedal back on the ideal curve. 2101: knee
    0.365 of the pedal, slope 0.483.
  - Samara: the 2109 manual's bench check, 3.0 MPa cut-in and 3.7-4.5 MPa out of 8 MPa in,
    so a slope of 0.22; the knee 0.30 of the pedal ASSUMES a floored pedal is 10 MPa (the
    top of the manual's 3-10 MPa check range; nothing here ties line pressure to
    `brakeDecelG`). A Samara's rear carries 0.38 standing, under the 0.42 split, so no knee
    can be derived for it as for the Zhiguli.
  - AZLK-2141: its manual's ratio 2 ("передаточное число регулятора без пружины"), slope
    0.5, with the Samara's assumed knee.
  - Estimates follow it: `estimatedBrakeDecel` solves the threshold with the knee on the
    springs (`thresholdBrakeG`, replacing `axleBrakeLimitG`), and the threshold pedal and
    `measuredBrakeDecel` invert the valve.
  - Measured, flat asphalt, 100-0 km/h, regulator off → on in the same build (+0/85/170 kg):
    with the pedal ramped from 0 to 1, the 2108/2109 locked their rears first at pedal
    0.53-0.64 and now lock the fronts first at 0.89-0.97 with the rears never locking; a
    floored stop is 49.1-52.8 → 51.4-54.1 m, yaw ≤ 0.1°, fronts first; the autopilot's
    threshold stop 61.2-62.2 → 48.0-51.4 m (MFDD 0.63-0.65 → 0.77-0.81 g). The 2101
    floored 50.5-53.3 → 53.4-54.9 m and threshold 51.2-53.0 → 51.5-53.8 m, the rears no
    longer locking ahead of the fronts on the ramp (0.88 → never). The 2141 floored
    51.6-54.5 → 51.4-54.4 m (max yaw 0.6-0.9°), threshold 61.4-62.2 → 51.6-53.0 m; its
    rears still lock on the ramp, after the fronts (0.77-0.89 vs 0.88-0.91). On gravel the
    2108/2109 rears still lock at pedal 0.91-1.0, the 2141's at 0.53-0.65 (at kerb before
    the fronts), and the 2101's threshold stop is 67.6 → 71.2 m. Suite +150 kg
    (`build/physics-suite/brake-valve-150.md`): every car locks its fronts first; yaw100
    2109 0.1°, 2141 1.0°.
  - Left as found: the Niva, Oka, Volgas and UAZ have no regulator (no source read), and
    `estimatedBrakeDecel` loads the tyres with the full χ transfer while the step's wheel
    loads are the springs', which `applyAntiPitch` relieves of ANTI_DIVE_FRACTION (26%) of
    the braking pitch couple. With the valve the front limits, and the estimate is 4-5%
    above the measured threshold MFDD (2101, 2108, 2109; the autopilot plans on 0.82-0.9
    of it).
- ONE ROAD TYRE: A TYPICAL 2000s KAMA (`KAMA_217`, `KAMA_217_GRIP` in
  vehicle/carmodels.ts). Every road car now runs KAMA-217 (Nizhnekamskshina, 175/70 R13
  82H): radial, the 70-aspect `tyreCurve`, `wheelGrip` 0.53. That covers the Zhigulis,
  Samaras, 2110 family, Oka, AZLK-2141, both Volgas and the IZh-2715. It replaces the
  ladder of period Soviet tyres (cross-ply Volgas 0.52-0.60, Zhiguli radials 0.55-0.58,
  Samaras and 2110s 0.65-0.66) and the `road` profile's 1.0824 cornering multiplier,
  now 1.0 (`HandlingTuning.tyreLateralScale`). KAMA's own card (td-kama.com) publishes
  the size, load, speed, 576 mm diameter, 261 mm static radius and EU label (wet grip
  E, rolling F, 72 dB), but no grip, stiffness or relaxation, so the curve and the 0.53
  are marked DERIVED in the source. The 0.53 is set on the two VAZs measured on budget
  13-inch radials: Car and Driver's Samara at 0.71 g and Za Rulem's 21102 at 55.0 m
  from 100. Each car keeps its factory wheel radius and width. The Niva's 175/80 R16, the
  UAZ-469's 215/90-15C cross-ply, the UAZ-2206's 225/75 R16 and the `utility` and
  `sport` scales are unchanged, and so is the rally 2105's competition tyre. Isolated A/B
  on a snapshot without the brake-regulator work, `tools/physics-suite.ts`, +150 kg
  (`build/physics-suite/kama-before-1.json` → `kama-final-1.json`, compared in
  `compare-kama.md`; two runs per side are identical apart from wall time):
  - VAZ-2101: skidpad 0.72 → 0.70 g, 100-0 50.3 → 52.9 m (PM74 derived 49), 80-0
    32.3 → 34.0 m, understeer 1.73 → 1.75 deg/g.
  - VAZ-2108: skidpad 0.88 → 0.73 g (C&D sibling 0.71), 100-0 41.1 → 52.3 m (sibling
    derived 55.5), 80-0 29.2 → 34.8 m, MFDD 0.95 → 0.74 g, first lock rear → front,
    understeer 0.89 → 1.17 deg/g.
  - GAZ-24 (cross-ply to radial): skidpad 0.70 → 0.62 g, 100-0 51.5 → 58.0 m, 80-0
    34.2 → 38.3 m (ceiling 43.2), understeer 2.79 → 2.31 deg/g.
  - UAZ-469 and UAZ-2206: unchanged to the digit.
  - Top speed within 0.1 km/h everywhere (142, 147, 144, 110, 104); 0-100 is 0.2 s
    slower on the 2108 and GAZ-24, unchanged on the 2101.
  On the same snapshot the 2110 stops from 100 in 53.6 m (Za Rulem 55.0) and pulls
  0.71 g on the skidpad.
- THE WHEELS RUN AT 240 HZ (`vehicle/vehicle.ts` `updateWheelDynamics`, `substepWheel`;
  `WHEEL_SUBSTEPS` in vehicle/vehicletuning.ts). Each wheel's spin, its carcass slip
  (longitudinal and lateral relaxation), the driveline lag and the drivetrain with its
  clutch now step four times per 60 Hz physics step. The contact is read once, the Rapier
  body is held through the substeps, and each tyre's force is averaged into one impulse.
  A wheel against its carcass has a mode of 18-27 Hz, which the 60 Hz step could not
  follow: a braked front wheel could sit on the falling side of its curve. On the
  VAZ-2108's 100-0 stop one front wheel stayed at 37-60% slip for 1.5 s while the other
  ran at 10%, and the car turned 12 degrees. It now turns 0.5. Two more step faults are
  gone with it. Every wheel's contact velocity used to be read after the wheels listed
  before it had pushed the body, so the listing order picked the side: reversed, the
  2108's stop turned 0.2 degrees and its understeer gradient doubled. And the slip
  angle was read off the previous step's velocity, before the solver had moved the
  car, so every tyre answered yaw and sideslip one step late. Now every wheel reads the
  same step's contact before any tyre pushes. Suite (`build/physics-suite/substep.json`
  against `baseline.json`): 100-0 is 1-3.5% shorter on the RWD cars and 4-9% shorter on
  the FWD cars (MFDD 0.86-0.94 → 0.90-0.96 g); the understeer gradient rises 0.23-0.33
  deg/g everywhere; 0-100, top speed and skidpad g are within 1%. The VAZ-2109 now stops
  with 10.3 degrees of yaw (was 0.9) and the AZLK-2141 with 6.3 (was 8.4). Neither is a
  step or order effect: reversing the wheel list changes nothing to the bit, and 8 or 16
  substeps give 10.4/10.6 and 6.7/7.2. It is a knife edge in the brakes. Every FWD car
  locks its rears first (one rear bias, `FOOT_BRAKE_REAR_BIAS`, for every car), so the
  car has no rear side grip. A floored pedal asks 1.05-1.13 of the fronts' peak before
  the load has come forward and 1.15-1.3 of their sliding force for the rest of the
  stop, so a front that tips over stays locked. Which front tips is decided by the road
  texture's ±120 N left-right load noise at the instant the pedal goes down. The 2109
  gives 0.5, 1.7, 10.3, 2.3 and 6.3 degrees at 130-170 kg of load. The same sweep at
  60 Hz has 8 of 24 stops (2108, 2109, 2141, 21099) over 3 degrees; 240 Hz has 4.
  The cost is about 4 µs more per car per step (fixedUpdate 15-20 → 19-21 µs).
  A 120 Hz chassis moves no figure by more than 1% beyond this and costs twice the
  physics. The road-deck crawl concession (`LOW_RANGE_MU`) is not a step artefact and
  stays: with it off, the standing-start gravel ceiling is 12.1 degrees for the 2101 and
  GAZ-24 both before and after.
- CHEAPER LAMPS ON THE PLAYER'S OWN CAR (`render/lightshader.ts`, `render/vehiclelights.ts`,
  `render/materials.ts`, `render/carsurface.ts`, `vehicle/vehicle.ts`, `main.ts`). Measured
  from the cabin at noon (Blessing, 1440 lines, M2 Pro), the driven car cost 13.7 ms of a
  21.9 ms frame; 8.4 ms of its body's 8.65 ms was the spot-light loop, every slot dormant.
  Three changes, none a new program variant (the kit body and glass keys are bumped, and
  every kit model's program anchor compiles them at boot as before):
  - DORMANT SPOT SLOTS ARE SKIPPED, in every lit material: the spot loop branches on the
    slot's own colour uniform (`SPOT_LIGHT_LIVE_MIN`, 1e-6, a hundred times the rig's
    dormant 1e-8). The slots, the shadowed slot, the program and the nonzero dormant
    intensity are all unchanged; what is new is a uniform branch that stays shut until a
    lamp lights, so the first headlamp of a session is the moment to watch on Windows.
  - THE OCCUPIED CAR SKIPS BEAMS THAT CANNOT REACH IT: once a frame the rig tests each
    lit slot's range and outer cone against the car's sphere (measured body, doors and
    lids swung out, 0.5 m slack; `VehicleLightRig.spotReachMask`) and the car's kit body
    and glass skip the rest (`uKitSpotReach`). Conservative: its own lamps, the courtesy
    lamp and the shadowed headlamp always pass, and any other visible spotlight (the hand
    torch) turns the mask off. Every other car keeps every slot.
  - MATT CABIN TRIM IS LIT LAMBERT-ONLY BY THE LAMPS: the kit's detail parts (cabin, door
    trim, bay, boot, underbody) in an unpainted, non-metal slot rougher than 0.7 drop the
    GGX lobe in the spot loop and keep exactly the diffuse term. The sun and sky still
    light them physically; chrome, paint, lenses, glass and the exterior trim are as
    before. The lamps' faint sheen on the dash and seats is the one visible difference.
  Expected, NOT yet measured: at noon the body's spot loop from ~8.4 ms to well under
  1 ms and the glass's share of its 4.5 ms with it; at night the saving depends on how
  many lit beams reach the car. The window grime (1.3 ms) is unchanged: it already sits
  behind a uniform test and is visible.

- THE SUN'S WIDE AUREOLE IS WEATHER, NOT EVERY NOON (`render/sky.ts` `uSunAureole`). The
  glow's broad lobe (`pow(sd, 12)`, still 47% at 20 degrees from the disc) was lit on every
  clear day, a pale disc 40-60 degrees across that read as a permanent halo. In clean air
  it now falls off within 10-15 degrees (exponent 60); haze, dust, the cirrostratus veil
  before a front and a low sun widen it back to the old lobe. The core round the disc and
  the 22-degree halo (storm and haboob harbingers only) are unchanged.

- LOW-POLY CUMULUS, AND SHADOWS THAT ARE THEIRS (`render/cloudfield.ts`, `render/clouds.ts`,
  `render/cloudshadow.ts`, `render/sky.ts`). The owner rejected the raymarched volume and
  every noise-field sky before it ("all one height", "still visibly a grid / a function"),
  so the clouds are now objects in the game's own faceted style. `cloudfield.ts` builds a
  list per seed (about 490 fair-weather clouds in a 61 km period, more storm candidates):
  Poisson-scattered in 2 km cells round a per-cell group centre drawn out along the wind
  into loose streets, under a district cover that leaves about a third of 3 km stretches
  near-clear. SHAPES FROM PHOTOGRAPHS, third pass (the first read as "flying cakes", the
  second as rocks and crumbs with pointed tents): FEW, WIDE CLOUDS, no confetti and no
  fractus shreds: humilis 0.5-1.5 km long and a quarter as tall, mediocris 1.5-3.5 km and
  0.4 as tall (medians by the tool, against the length), congestus towers under 2% and
  only in cloudy districts; the smallest cloud is 600 m, the median 1.5 km. ONE
  CONTINUOUS BODY: a row of 3-4 body lobes the full length, cut flat at one straight base
  per district (median spread 66-100 m in a 2 km cell), their tops on an envelope that
  peaks off-centre and thins to the ends; 1-2 crown lobes over the peak with their
  bottoms inside the body; every big lobe overlaps a neighbour by over half a radius.
  6-12 small lobes a quarter to two fifths of their parent are SUNK into its upper
  surface (centre inside, 30-50% of their radius standing out), only where that surface
  shows. NO POINTS: no lobe is taller than wide (ry at most 0.85 of its narrower
  horizontal radius), big lobes are detail-2 icospheres and small ones detail 1, corners
  jostled ±8%. In fair weather a cloud is whole or absent (`cloudGrow`): the partly grown
  storm candidates no longer sit in a fair sky as shrunken crumbs. Bases 0.99-3.5 km by
  district; stretched 1.25-1.7 times along the drift. All of them draw in TWO instanced
  draws (a compact 1760-face mesh for humilis, a 2880-face one for the rest; about 280
  clouds in the ring, so roughly the faces the many small ones cost before; the lobes live
  in a float texture, so every cloud is its own shape), placed every frame round the
  eye out to 26 km (16 km on phones and the two lower rungs), world-anchored by the same
  reduced pan and wind as before. Lit per facet: Lambert from the sun (banded in Clean),
  sky ambient on top, a grey-blue under side, the lower half dimmed and the crown lit
  under a low sun; toward the sun the silhouette facets light up as a silver edge round a
  grey body (it was a pale wash over the whole cloud); the land's aerial perspective along
  the slant path (the volume's law, kept). They draw right after the dome in the opaque
  pass with their own depth range, then a depth-only triangle puts the far plane back so
  the land draws over them; the stars and planets moved into the opaque pass before them.
  THE BODIES ARE OPAQUE: they hide the sun's disc and glow and the stars. They had been
  faded by alpha in haze and dust, at the ring's edge and at the horizon, and a
  part-transparent cloud showed its back and inner facets through its front (the
  "interpenetrating lobes flicker" the owner saw toward the sun on a hazy noon: not depth
  precision, which is about 5 mm at 2 km in the clouds' own range) and the sun through
  both. Haze and dust now veil them through the aerial perspective, the ring's edge and the
  horizon band mix them into the air's colour, and only the night fade is alpha, with a
  depth prepass while it runs so a fading cloud stays one surface deep. A storm brings
  more clouds, growing from nothing rather than popping in, swollen and darker; the dome
  keeps a simple grey storm deck that only closes in once a storm is heavy.

  THE SHADOWS ARE THE CLOUDS'. Each frame the clouds whose shadow can reach the eye's
  16 km are drawn once more, slid along the sun's ray onto a 512² map (32 m texels),
  blurred twice (a 52 m Gaussian: a 110 m penumbra), and every ground material reads it
  with one texture tap per VERTEX (`cloudShade`), the fragment stage still one multiply.
  The noise field, its CPU twin and its warp/coverage/detail terms are gone; the CPU
  twin is now `cloudShadeAlong` (ray against the clouds' ellipsoids, same blur). The
  pass is drawn inside the frame's GPU timing via `Renderer.setCloudShadowPass`, which
  replaces `setSkyPass`. `tools/sky-variety.ts` now checks: same seed same sky; the three
  kinds with congestus under 5%; no crumbs (smallest over 500 m, median 0.9-3 km); height
  against length per kind; stretched along the wind; no lobe taller than wide; one
  continuous body (lobe overlap, small lobes sunk); bases 1-3.5 km on one line per
  district; cover 16.1% mean (10-20%, 11-19% by seed), clumped (count variance/mean 1.8,
  lower than with many small clouds), with near-clear and >25% stretches;
  every sampled cloud shades the ground up the sun's ray at noon and mid-afternoon;
  penumbra; storm more and bigger; rebase stability at 386 km; the per-vertex splice.
  Removed: `render/cloudvolume.ts`, the 2D cumulus and high decks in the dome,
  `CLOUD_FIELD_GLSL`, `cloudFieldUniforms`, `uCloudSalt`, `uCloudDetail`.
  Measured with the first shapes, before the shape reworks (not re-measured since),
  on the M2 Pro (1600x900 at 1.25 DPR, standard, noon drive): GPU frame
  13.8 ms with the clouds off against 13.9-14.5 ms on, in the same tab (noisy; about
  0.1-0.7 ms for both draws and the map), against the volume's 1.15-1.55 ms pass;
  no program links during a 35 s drive with a time sweep and a storm (105 before and
  after).
- GRASS IS THE PLAYER'S, AND OFF (`Settings.groundCover`, `game/settings.ts`). Ground cover
  starts Off on every rung and no preset, launch measurement or phone default changes it;
  only the Grass row does. Stored under the new key `groundCover`, so every value the
  presets wrote as `grass` is dropped and starts Off (a player who had picked one by hand
  picks it again). `grassDefault` is gone.
- QUALITY ROWS RUN CHEAPEST TO DEAREST, LEFT TO RIGHT: Antialiasing Off / FXAA, Grass
  Off / Light / Full, Style Clean / Standard (`ui/menu.ts`).
- NOTHING ON THE ROAD REFLECTS (owner: desert asphalt is matt and dries in minutes). Gone:
  the road's and markings' Blinn-Phong glint (`groundlight.ts` `specular`), the wet road's
  gloss and its Fresnel mirror of the horizon (`cloudshadow.ts` `WET_SHEEN`,
  `WET_ROUGHNESS_HOOK`), and every headlamp streak laid on the road, wet or dry
  (`WET_GLARE_MAX`, `addWetGlare`, the glare pool in `main.ts`, `Vehicle.offerWetGlare`).
  Wet ground still darkens by a third in patches as it did.

- THE ROAD READS AGAINST THE DESERT (owner, 2026-10-16, against the old title screen:
  near-black asphalt, black tar snakes, a dark gravel shoulder, orange sand). Five parts:
  - VALUE. The asphalt was a flat 0.27 linear albedo, concrete's. It is now an aged mat at
    0.14 (`Asphalt` 0x757475, `CrackedAsphalt` 0x7e7a78 at 0.16, display scale included;
    concrete keeps its 0.25), and WEARING COURSES (`world/gradient.ts` `roadCourseAt`)
    alternate along it: 135-765 m stretches, fresh at 0.06-0.08 or bleached at 0.12-0.16,
    fresh about half the time on a kept road and rarely on an abandoned one, meeting at a
    crisp transverse seam with a thin dark joint.
  - WHEEL TRACKS. Per lane, two polished wheel paths (up to +60% on an aged course, none
    on a fresh one) and a dark oil strip between them (up to −40%), 15 cm soft edges, on
    every lane of a widened road. They replace the vertex-colour wheel paths, which could
    only be as sharp as the 0.4 m section columns.
  - TEXTURE. A chip-seal DETAIL map (`roadtexture.ts` `paintDetail`): pale and grey stone
    chips in binder on a 4 m tile, 7.8 mm a texel, a multiplier with a mean of exactly 1 so
    its mips fade to the macro tile's value; one extra sample, on the road surface only,
    and not in the Clean style. The 24 m tile's cracks are black TAR SNAKES now, three a
    tile, forked, with their relief flattened out of the normal map; its own grain is
    calmer (`COURSE_RANGE` 42 → 26), the chips carry it.
  - EDGE. The shoulder is a dark crushed-stone band over the embankment's formation
    (stone 0.13, a warm grey of its own, not the palette's), with pale stones in its grit.
    (As first shipped it also laid sand tongues on the asphalt's edge and buried the band
    on any sanded stretch; both are gone, see Fixed: THE ROAD'S VERGE IS DARK GRAVEL.)
  - GROUND COVER (`world/props/scatter.ts`). The open desert is thinned to 0.02 a 3 m cell;
    the verge 2.5-12 m from the asphalt gets CLUMPS of two to six plants with bare sand
    between, 5-6 times the open density on average, more where the ground lies below the
    road and on the side its camber sheds water to (`vergeRunoff`).

  The courses and tracks are drawn per pixel (`render/roadlook.ts`) from two vertex
  attributes, so they keep crisp edges the 0.4 m × 1.33 m collider vertices could
  not carry, and they show in the Clean style. One program under a constant key
  (`road-look-v3-surface`; the markings' `-paint` part is gone); lay-bys, the terminus pad and site aprons read the
  neutral defaults. Measured on seed `flick` from km 29.6: 99 programs before and after a
  1.2 km autopilot drive across two seams and a switch to Clean.

- A KIT CAR IS THREE DRAWS (`carkit/materials.ts`, `render/kitdraw.ts`,
  `render/materials.ts` `patchKitBodyShader`, `render/carmodel.ts`, `carkit/rig.ts`). Every
  kit slot but the glass is one material, its slot (colour, roughness, metalness, paint
  share, lamp role, unlit flag, shadow casting and receiving) in the vertices, the far
  traffic mesh's convention (`CAR_SURFACE_ATTRIBUTE`). Each car's copy is its paint: its
  colour, dust, scratches and sticker highlight apply where the paint share is 1, the
  lenses glow by role from the car's own lamp levels (`carLensGlows`) under its lens dust.
  The car's ~150 meshes are merged into one skinned mesh per material, every vertex
  weighted 1 to the node it moves or hides with (~90-100 bones: doors, lids, panes,
  needles, pedals, levers, stalks, the wheel, wipers, mirrors, the detail and fine
  tiers); `KitRig` still drives the same nodes and `KitSkeleton` reads them into the bone
  texture once a frame. A drop pane slides as its bone and the glass drops what is below
  the door's top. The four wheels are one mesh on the wheel nodes. The meshes the car was
  built of stay as pick proxies on a layer no camera draws (`KIT_PICK_LAYER`), so doors,
  controls, seats and stickers pick as before; wrecks and couriers are the mid shell, its
  glass and its wheels (3 draws). Measured on the M2 Pro (Blessing, seed `flick`, km 3, the
  start 2104 and four parked kit cars, traffic hidden, frozen frame): own car in the cabin
  view 87 → 6 scene draws (body, glass back and front, wheels, two mirror faces), chase
  142 → 4; a near parked car 72-150 → 4; the sun's pass 37-44 → 3 per car; the inside
  mirror's view of the own car 34 → 4; `renderer.render()` (the profiler's `draw`) 2.9 →
  1.5 ms in the cabin view, 3.0 → 1.4 ms in the chase. No program linked over a 90 s drive (cabin and
  chase, night, head and main beam, blinkers, hazards, doors, bonnet, boot, panes, wipers,
  courtesy lamp) nor on jumps to km 4-20 (wrecks and couriers). Car-lab A/B against HEAD
  (2112, 2101, 2109, 2104: 3/4 views, cabin, parts open, dust and scratches, night lamps,
  mid at 57 m): at most a few hundred pixels of 1.44 million differ, blink phase aside;
  every car's triangles identical by geometry hash; `tools/kit-zfight.ts` PASS on all 13.
- KIT CABIN FINE DETAIL ONLY NEAR (`carkit/rig.ts` `KIT_FINE_M`, `carkit/interior.ts`,
  `vehicle/vehicle.ts` `viewFrom`): needles, dial faces, warning lamps, switches, stalks,
  pedals, levers, cranks, door handles, visors and the like draw within 6 m, with the eye
  inside, or for the car the player sits in; a parked 2101 at 10 m draws 61 meshes, not 121.
- THE BONNET CAMERA IS GONE (`render/cameras.ts`): C switches chase ↔ cabin. `CameraMode`
  has no `hood`, `CameraTarget` no `hoodOffset`; the bonnet mount `hoodPoint` stays as
  the cabin eye of a body without a seat. The engine's swapped voicing
  (`audio/vehicleaudio.ts` `engineHeardAs`) was tuned with that camera and is unchanged.
- KIT SEATS ARE NOT WORKED (`player/interaction.ts` `KIT_SEAT_PART`): no sliding,
  reclining or headrest in the game; a seat is only where F sits the player. The car lab
  still moves them.
- THE FUEL FLAP SHOWS THE TANK WHEN OPEN: aimed at the open flap, `petrol 12.3/39.0 L`,
  and with a can in hand the pour line; shut, nothing, and it takes nothing. The open
  flap is a target without a can too.

- KIT CARS NAME NOTHING (`player/interaction.ts`, `ui/hud.ts`). No prompt for a kit
  car's doors, lids, flap or seats, on foot or seated, and no refusal text on getting out:
  the crosshair lights on whatever E or F works there (`InteractionResult.actionable`,
  which replaces `cabinAim`), and a door that stays shut is the refusal. The bonnet and
  boot cells keep their lines, and a seat the player cannot take with his load says why.
  The name and verb tables behind the prompts are gone.
- KIT GLASS FADES TO A TINTED MIRROR BETWEEN 30 AND 50 M (`carkit/rig.ts` `setDetail`,
  `KIT_DETAIL_M`). At one 25 m step a passing car's panes went from mirror to clear in one
  frame a few car lengths away; now they fade, and the cabin behind them draws to 50 m.
  `setDetail` takes the distance; the car lab uses the same rule. Checked on the road:
  traffic at 3-24 m clear (0.28), 35.5 m half-way (0.47), 57 m and beyond tinted (0.9)
  with the cabin hidden.

- FUEL TANK IS NO LONGER A PART; PETROL GOES IN THROUGH THE FLAP (`parts/registry.ts`,
  `vehicle/bonnet.ts`, `player/interaction.ts`, `save/save.ts`). The tank is the model's
  own (`tankLitres`); the bonnet holds four typed cells: engine, turbine, radiator, air
  filter. With a petrol can in hand the open fuel flap takes petrol (`[LMB] pour petrol`);
  shut, the prompt says to open it. Saves get `saveVersion` 2: a version-1 bonnet drops its
  tank cell (the air filter moves up), fuel is kept up to the model's tank, tank items
  elsewhere are removed. Checked on a 2107: flap shut, LMB poured nothing; open, 2.5 s
  took 10 → 13 L from a 20 L can.
- THE BONNET GRID LIES IN THE BAY AND THE GRIDS FOLLOW THEIR LIDS (`vehicle/trunk.ts`,
  `render/trunkview.ts`, `carkit/bay.ts`, `render/carmodel.ts` `bonnetCells`). The engine,
  its filter and fans, the radiator and their hoses are no longer drawn in the kit bay
  (battery, reservoirs and the bay's panels stay): the parts are what stands in the grid,
  each cell at its part's real place, the engine's large cell in the middle. A kit car's
  bonnet grid opens with the bonnet and closes with it, the boot's with the boot or
  tailgate; no aim and F to open. Checked on a 2107: bonnet open → the grid showed with the
  engine centred, shut → hidden, open again → shown.
- KIT WIPERS WORK AND SIT ON THE GLASS (`carkit/rig.ts`, `carkit/exterior.ts`, new
  `CabinSpec.wiperBlade`). The sweep phase lived in a channel that eased back to 0 faster
  than it advanced, so the arms never moved; it is a plain field now. Both arms park to the
  left, each turns about its own axis fitted to the glass, its blade bent over it. Blade gap
  over the sweep, measured on all 13 bodies: classics 3.0-5.8 mm (sank 2.5 mm into the
  paint before), 2104/05/07 up to 11 mm, the Samaras up to 16 mm, the tens up to 21 mm at
  the ends of the stroke: a rigid blade cannot follow those screens' curve.
- KIT CARS FROM OUTSIDE: PANELS ONLY (`player/interaction.ts`). On foot E works the side
  doors, bonnet, boot or tailgate and the fuel flap, never a window or a cabin fitting; in
  the chase and hood views a seated player works only the side doors.

- KIT CABIN FROM THE SEAT: NO LABELS, THE CROSSHAIR INSTEAD (`player/interaction.ts`,
  `ui/hud.ts`). Seated, a door or fitting in the aim is no longer named by a prompt
  (`[E] fold down left sun visor` sat over the dash and the road): the round crosshair,
  hidden while driving, appears while it is on something E works
  (`InteractionResult.cabinAim`). A refused exit still prints its line. On foot nothing
  changed. Checked in a dev build: a 2106's cabin view at pitch 0.15 on the left visor
  showed the crosshair with no prompt, off it nothing.
- CLASSIC ZHIGULI STEERING WHEEL LOWER AND THE 2101/2102/2103 ONE SMALLER
  (`carkit/interior.ts`). The classic platform's hub stands 0.03 m over the belt (was
  0.094): the rim's top now crosses the hood as the 2108's crosses its cowl, instead of
  reaching into the screen, and the dials show inside the rim. The 2101/2102/2103 rim is
  the platform's 0.19 m radius (was 0.2). Seen in the cabin view of the 2101, 2106 and 2107.

- CONTRACTS SCORE NOTHING ON THE WAY (`contracts/`). Carry it to a later courier and it
  pays: every kind with a signature sticker always pays it, parcel its seed-random one.
  Gone: the fragile radio's condition, the trailer and oversize hit/tip checks, the tow
  bar latch and rollover check, the transfer/tow scratch limit, the "bonus lost"
  toasts and the status after the cargo name. With them went the car telemetry the
  composition root built for the kinds (`ContractCarTelemetry`, `ContractCarSnapshot`)
  and `DeliveryContext`. `ContractProgress` is just `started` (the race reads it);
  older saves load with the rest dropped. Delivery rules stay: distance to the
  courier, parked, boot empty.
- THE SPONGE POLISHES SCRATCHES OFF COMPLETELY (`player/interaction.ts`). It used to stop
  at 8%, so "body clean and polished" was shown over visible scratches.

- A TURN ACROSS THE ONCOMING LANES IS LET THROUGH, NOT WAITED OUT (`world/traffic.ts`).
  Reported from play: the car letting a rival across to a courier crept to a stop 65 m
  short of the turn, after the rival had stood three seconds before even asking. Now
  the rival asks as soon as it is within 40 m of the turn (out: once its own lane is
  clear), and each oncoming car is held only to the speed that gets it to 3 m short
  of the turn no sooner than the rival is across (its remaining turn at 16 km/h, plus
  1 s from a standstill and 1 s margin). A car already slower than that is not touched,
  and one stops only if the rival stalls in the turn. The gap check counts a car so
  held as clear, so the rival goes at once. The free-road gap is 4 s plus 10 m (was
  6 s plus 40 m, so a car standing anywhere within 40 m blocked the turn).
  `traffic-bench` far side: nearest oncoming car while a rival crosses 10.2 m
  bumper to bumper (was 35.2), no impacts. Its crossing check now flags only a car
  that could not stop short at 4 m/s², not any moving car within 60 m.

- `tools/traffic-bench.ts` POPULATES ITS FIRST PHASE. A spawn waits on its model's load,
  and the simulated 30 s pass in a fifth of a real second, so the first spawn was still
  pending when the phase ended: six populate checks read an empty road. Every catalogue
  model is loaded before the phase now. The density-rotation check follows
  `DENSITY_FLOOR` (0.7, now exported) instead of asking for 0.6 of the cap.
- A CAR IS NOT SPAWNED IN FRONT OF AN OPPOSING CAR WHOSE BODY IS IN ITS LANE
  (`world/traffic.ts`, `roadGapClear`). The 300 m exclusion asked only whether the
  opposing car's centre was over the crown; a frantic car left 0.45 m over it after a
  pass reached the oncoming lane's centre, and a car was spawned 38 m in front of it at
  75 km/h (head-on in the bench).

- `tools/traffic-seeds.ts`: the traffic bench over several seeds (42, 7, 1337, 2024,
  99 by default, or any given), with the impact checks summed. One seed is one random
  stream and any driving change reshuffles it: the same build gives 0-5 impacts in the
  mixed queue depending on the seed, so a driving change is judged on these totals.
  Baseline at this commit: 9 queue, 4 turnaround, 2 lay-by, 0 + 2 hand-in impacts; the
  rock check over 22 s on seed 99.
- `traffic-bench` far-side hand-in check counts only ONCOMING cars. It counted any car
  ahead with a positive lateral, and on seed 99 flagged a same-direction car 37-54 m
  ahead and pulling away (58 false samples).

- THE UAZ-31512, SECOND PASS FROM THE OWNER'S REVIEW (`tools/carforge`,
  `public/models/carforge/uaz31512.fbx`, `render/carmodel.ts`).
  - The spare on the tail is a wheel of the set the car is shod with: carforge exports it
    as its own node (`<id>.spare`), and the loader measures it with the body (it is in the
    factory length), takes it out and mounts the left rear wheel `cloneWheels` made for
    this car there, rim out of the tail (`CarModelDef.spareNode`, `addSpareWheel`).
  - The front bumper stands on two brackets off the frame rails; the rails run into the
    rear bumper (they stopped 9 mm short of it).
  - The bonnet is flat, and its front edge rolls over on a ~150 mm radius into the grille
    panel, as on the drawing: the traced bonnet rose 80 mm to the cowl with a step across
    it. A new spec key, `redraw`, replaces a stretch of a side line with given points (a
    null height keeps the traced one, so two nulls make a straight chord); its points are
    never faired away by `fair_tol`, which had cut the roll to two facets.
  - Lamps have flat lenses, proud of the highest point under them: the crease under the
    wing blinker showed through its folded lens. The tail, rear blinker and reverse lamps
    stand 22 mm proud; the reverse lamp moved up off the bumper end, where its corners
    hit the bumper's top and laid it down like a card.
  - Headlamps: the lens is the pack's grey (the white cell looked lit when off), and the
    chrome rim is part of the body, so lighting the lamp lights the lens alone.
  - Door gaps along the tops of both doors, along their bottoms, and up the A pillar on
    the front door.
  - No number plate on the tail.
  - The arch lip's turn into the well lay in the plane of the well wall the cut leaves
    (z-fighting inside every arch); it stands 2 mm in front of it (`ARCH_LIP_OFFSET`).
  - No notch in the sill ahead of the rear arch: the trace's 30-40 mm bumps in the
    bottom line by the arches are chorded out (`redraw.bottom`).
  - Both UAZs take only the VAZ-2121's wheels: the 2131's rim is the pack's dark trim
    cell and read as a black disc.
  - Panel gaps are 10 mm wide and 8 mm deep, in the paint (they read coarse at 18 and
    14 mm). Side gaps keep to the side surface, between the sill chamfer and the rail;
    they used to run up over the rail chamfer. The A pillar lost its 55 mm rail chamfer
    (a third plane between the side and the screen frame; new spec key `rail`), so the
    whole front door is outlined: its front edge runs on unbroken from the sill up the
    pillar, 40 mm behind the screen's edge, and along the top. The bonnet is a panel of
    its own as on the factory drawing: full width, wrapping down the sides, its gaps along
    both sides above the shoulder, across the front face over the grille and across the
    top at the cowl.

- BOTH UAZS RUN ON THE NIVAS' WHEELS (`OFFROAD_WHEEL_SET_POOL` in `vehicle/carmodels.ts`).
  The UAZ-330364's own wheel from the SAAS pack is 18-20 segments to the circle against
  the Soviet pack's 30-32 and showed its edges; the UAZ-31512 had its own set too. Each
  now takes the VAZ-2121 or 2131 set by its appearance key, scaled to its own tyre
  (0.744 m, 225 and 215 mm), and its own wheel mesh is no longer drawn.

- A RACE RIVAL HANDS IN AT THE COURIER'S LAY-BY, IN TWO SECONDS (`contracts/race.ts`,
  `world/traffic.ts`). Instead of standing 20 s in its lane beside the courier, a live
  rival asks the stream for a hand-in (`RoadTraffic.rivalHandIn`) while the entry slip
  is 70-450 m ahead: it pulls in, stops on the parking line beside the courier car (a
  car's width inside it) for `HAND_IN_S` = 2 s, and pulls out by the exit slip; the
  hand-in counts when that stop ends. A courier lay-by on the far side is reached
  across the oncoming lane: the rival holds in its own lane until nothing coming the
  other way would reach the crossing within 11 s, and waits for the same gap (and the
  ordinary one in its own lane) to cross back. A ghost rival, a courier with no
  lay-by, or a rival that comes into the physical window too late to pull in stands at
  the old in-lane mark for 2 s. Rivals never reverse.
  - While a race finishes at a stop its lay-by is reserved (`reserveHandIn`): ordinary
    traffic does not pull in or get seeded there, and a car already parked leaves
    within 3 s, so the place beside the courier and the pad out to the exit are free.
    A rival held up on the pad short of its place (the player's car left on the line)
    hands in from where it stands after 3 s and waits behind that car to leave.
  - Rivals finish their run after the race is decided — by the player's hand-in, all
    three rivals', or the player driving past. The decided race is kept apart from
    `RivalRace.race`, so a new offer can be taken meanwhile; each later hand-in is
    announced with its place ("VAZ-2104 estate handed in — 2nd") and pays nothing, and
    a rival goes back to the stream only once it is back in its lane. The run ends when
    its last rival has handed in; a ghost of it more than 2 km behind the player is
    dropped unseen, and after 600 s whatever is left is released as it is.
  - `tools/traffic-bench.ts` races to seed 42's courier lay-bys at 30.8 km (own side,
    player wins at once) and 23.1 km (far side), with the courier car as a fixed body:
    every live rival (2 each) stood 2.02 s within 1.6 m along and 0.06 m across of its
    place beside the courier, was back in its lane before release (0 released early),
    0 impacts and 0 samples crossing ahead of oncoming traffic; after the win both
    handed in, placed 2nd and 3rd.

### Fixed

- TENS (2110 / 2111 / 2112): THE FRONT DOOR GLASS STANDS TO 1.32 AT THE DOOR'S MIDDLE AGAIN
  (carkit tens.ts). The glass's front edge had been raked to tops 2.0 / 2.06 (and `glassTop`
  −0.03, the pane above the rail), so at the door's middle the frame met the glass at 1.28;
  the columns are back near the pillar (1.805 / 1.85 / 1.9 / 2.0, a 0.01 chamfer, `glassTop`
  0.035). The `corner` flags at s 0.6 / 1.31 / 2.4 are gone (D10 shows no crease there):
  the side's lean rises evenly to the front view's 16° (wCrease 0.82 at 1.31, wBelt 0.718 /
  0.752 / 0.73 / 0.735 at 0.34 / 0.6 / 1.31 / 2.4). The roof profile's points sit on the
  column tops (2.324, 2.44): 14 689 / 14 571 / 14 709 triangles (were 15 075 / 14 963 /
  15 078). sideGlassRail accepted in refs/vaz2110.json and vaz2111.json (the drawn window
  top against the check's band under it).

- ESPERO: THE TAIL-LAMP BAND ON THE BOOT LID LIES FLUSH, LIKE THE CORNER LAMPS (carkit
  daewoo.ts `LOOK_ESPERO.rear.lid`). Owner: it read as a bulge beside the flush lamps on the
  wings. Its lenses stood 10 mm (and 6 mm) out of the lid; now 4 mm and 2 mm. `kit-zfight`
  passes for the Espero.

- NO SPECKLED "DIRT" UNDER THE CLOUDS AT DUSK (render/clouds.ts `blobPoint`,
  `BASE_SLOT_STEP_M`). Reported from play: a flickering, dirty-looking pattern on every
  cloud's underside at sunset. It was depth fighting. While the bodies fade at dusk a depth
  prepass lays down the nearest surface and the part-transparent colour pass blends every
  fragment at that depth (LessEqual); the flat cuts of a cloud's overlapping lobes all lay in
  one plane, so where they overlapped each pixel was blended once or twice depending on which
  triangle rounded nearer. Each lobe's cut now stands 0.1 m over the previous slot's
  (about 14 depth steps), so the prepass keeps one cut and the colour pass draws only it; a
  cloud's lobes spread their bases over about a metre, invisible from the ground. Checked in
  the dev build at 18:03 looking toward the set sun: the speckle is gone.

- THE ROAD HAS NO ROCKS ON IT, AND NOTHING THAT EXISTED ONLY FOR THEM IS LEFT (owner,
  2026-10-18). The one obstacle on the road is a car — stalled, overturned or simply
  standing. Deleted: `world/hazards.ts` (`HazardIndex`, `ReversedHazardIndex`, `RoadHazard`,
  `HazardField`), the road-hazard stream in `ScatterProvider` (it was switched off already)
  and its `hazards` argument; `Autopilot`'s hazard field and everything fed from it — the
  prop scan, prop obstacles in the corridor, the crossing's clear-of-props proof, the
  racing line's prop horizon, the verge-pass prop check, the prop-aware recovery side and
  line, the one-second contact wedge; in the planner (vehicle/corridor.ts) the
  movable/immovable distinction, `feasible` (it is `admissible` now), `stopRoom`, the
  `LEFT_PASS_COST` "pass scenery on the right" price and the rock branch of the standing
  escape; in `RoadTraffic` the hazard argument, bottleneck turns (`assignBottleneckTurns`,
  `headWait`, `holdS`), the rails' prop survey and the spawn prop check. `setHoldDistance`
  stays for lay-bys. Benches lost their rock scenarios (`autopilot-bench`, `traffic-bench`,
  `corridor-bench`, `scatter-census`).
- A CAR STANDING IN THE LANE IS GONE ROUND ON THE DRIVER'S OWN SHOULDER (vehicle/autopilot.ts
  `planStandingBypass`, vehicle/corridor.ts `standingBypass`). Reported from play at the top
  traffic setting: a monstrous jam behind a stopped car that nobody went round.
  `tools/traffic-blocker.ts` (the player's car held still on the real road, 48 cars,
  density pinned) shows the head of the queue swapping between the opposing lane and the
  sand, rolling up to the bumper with its body still in the lane, and the stall rule
  reversing it two metres at a time. Now a driver that finds a car standing in its lane
  with nothing in front of it latches a line on its own shoulder just past that car's flank
  (no further than the graded strip), opens it early enough to finish the move short of
  the car (its shift at 0.09 m per metre plus a second of travel), never crosses the crown
  for it, approaches so it can stop 6 m short until clear, and passes at 25 km/h. One that
  stopped close behind anyway pulls out at walking pace — on lock to 30° off the road,
  then straight — or, with no room ahead for that, backs up no more than 0.5 m at a time
  with its rear clear; neither runs the stall rule. The deadlock grant no longer counts a
  queue behind the player as facing the oncoming queue beyond him. The move's speed round
  a standing car is priced on the line's real rate cap (`CorridorRequest.lineRate`).

  Measured on `tools/traffic-blocker.ts`, 3 × 5 min, before → after: seed 1337 6.3 → 7.1
  cars past a minute against 8.7 arriving, standing queue 4.9 → 4.2, head in recovery 27% →
  14%, reverses per car past 8.9 → 4.9 at 2.3 → 1.8 m each, contacts 12.7 → 8.7; seed 7
  8.3 → 6.3 past against 8.9 arriving, queue 2.6 → 4.6, recovery 24% → 13%, contacts 1.7 →
  5. NOT YET WHAT WAS ASKED FOR: the queue still grows, cars still leave the strip (body
  centre up to 15 m past the asphalt, the head off-road 14-36% of the time), and the
  two-lanes-a-side stretch got worse (11 → 7.6 past a minute).

- A CAR STANDING IN THE LANE IS GONE ROUND ON A ROUTE THE TRAFFIC BUILDS, LIKE A LAY-BY'S
  (world/traffic.ts `Bypass`, `assignBypasses`, `serviceBypass`; vehicle/autopilot.ts
  `LaybyCourse.backTo`, activity `bypass`). Owner's design, 2026-10-18. Anywhere on the road:
  a traffic car still for 3 s on the carriageway with nothing standing just in front of it
  (else it is queueing), a wreck, or the player's car. Every car of a direction whose lane it
  meets, from 150 m back, gets its own line: lead-in over 25 m, along its own shoulder beside
  the car with 0.7 m between flanks and 1.5 m past each end, back into the lane over 20 m.
  It drives it as a lay-by line (`driveLayby`: pursuit, stop behind anything on the line),
  braking to 25 km/h for the move. A car across the road is gone round by each direction on
  its own side. One standing closer than 6 m short of the move backs 0.5 m straight first;
  stood 3 s on the route with nothing ahead of it on the line, it backs another 0.5 m (at
  most four times, each with 1 m clear behind), then gives that car up. The route is handed
  back once the car is in its lane again past the rejoin. No route if the line would take
  the body more than 1 m past the graded strip. `status.bypassing` counts the cars on one.

  `tools/traffic-blocker.ts`, 48 cars, the player's car held in its lane: seed 1337, 5 min,
  16.8 cars past a minute against 16.6 arriving, standing queue mean 0.0 (max 2), longest
  head standstill 0 s, every one on the shoulder, body centre at most 1.35 m past the asphalt
  (strip 2.5 m); seed 7 12.8 past against 13.4 arriving, queue max 1, no contacts; two lanes a
  side 13.8 against 13.4. Was, with the driver's own bypass: 7.1 against 8.7, queue 4.9,
  centre up to 15 m off the asphalt. One 3-minute repeat of seed 1337 still showed 13 reverses
  near the queue (up to 11.9 m) and 11 contacts, from the driver's own recovery rather than
  the route; queue max 4, no standstill.

- THE QUEUE BEHIND A STANDING VAN NO LONGER STOPS BESIDE IT (world/traffic.ts
  `setPlayerVehicle`, `roadHalfSpan`; vehicle/autopilot.ts `LAYBY_PASS_CLEARANCE_M`). Reported
  from play: behind the player's UAZ van half the stream went round and the rest stood still
  on the shoulder. The route's line was built 1.5 m off the flank of a body taken as a saloon
  (the player's car was never measured), while the driver counts anything nearer than its
  own 1.45 m clearance to the collider's flank as on its line: beside the van the head saw it
  1.4 m inside its bumper and stood, and nothing let it go. Now the player's car is measured
  every step like any traffic car (yaw included), and the line keeps the driver's own
  clearance plus 0.3 m. `tools/traffic-blocker.ts --ego kit_uaz2206`, seed 1337, 3 min: before
  0 cars past against 7 a minute arriving, 24 standing; after 17.0 against 17.3, none standing,
  body centre at most 1.52 m past the asphalt.

- UAZ-2206: THE ENGINE BAY UNDER THE CABIN COVER, ITS GRID ON IT AND REACHED FROM THE SIDE
  DOOR (carkit bay.ts `BayRoom`, interior.ts `engineCover`; player/interaction.ts
  `cabinLidOpen`). The lifted cover showed a dark block, and the bonnet grid hung 0.36 m
  ahead of it, out under the seats and 0.28 m under the cabin floor. Under the cover now
  stands the bay an ordinary kit car has under its bonnet (radiator support, battery,
  bottles, brake booster, and the engine, radiator, turbine and air filter cells drawn by
  the grid), the four cells on it. The cover is a hollow pad behind the seats and the
  handbrake that lifts sideways towards the side door; through that open door the grid
  is reached from the doorway, so all four cells are picked standing at it. No other
  car moved (geometry hashes).

- UAZ-469: THE WIPERS NO LONGER PARK ACROSS THE VIEW (carkit `CabinSpec.wiperMount`). On
  its 0.41 m-tall screen a foot-mounted 0.33 m blade could not lie flatter than 18° and
  stood in the driver's sight line. The old 469's wipers hang from the frame's header
  (motor СЛ236Е, 280 mm blades): now so, parked 12° under the header and sweeping 100° down.
  No other car's wipers moved (geometry hashes).

- A ROADSIDE WRECK'S BONNET AND BOOT OPEN, AND ITS GRIDS ARE REACHED ONLY THROUGH THEM
  (render/carmodel.ts `kitStaticParts`, `hangStaticLids`; render/staticlids.ts
  `StaticCarLids`; world/wrecktrunks.ts; player/interaction.ts). A shell sunk at a POI was
  one merged mesh with no lid control, so its lids never moved while F opened the bonnet
  grid (laid on the shut lid) and the trunk grid straight through them. Every shell now
  hangs the driven car's bonnet and boot lid or tailgate (both rear doors on the UAZ-2206)
  on the same hinges, cut from the mid shell, and a hidden cabin, bay and boot (the driven
  car's merged buffer over a fixed skeleton, its programs) shows while a lid is open. E on a
  lid works it as on a car; F at a shut compartment lifts its lid and opens the grid with
  it, never a cell; the grid shuts with the lid. The bonnet grid stands in the bay, as on a
  car (`bonnetGridOnLid` and the `onLid` plumbing are gone). Lids shut again when the chunk
  is rebuilt; contents persist as before. Couriers keep their F trunk. Gate:
  `bun tools/wreck-lids.ts`.
- UAZ-469 DOOR MIRRORS STAND WHERE THE CAR'S DO (`carkit/uaz.ts` `LOOK_UAZ469`, new
  `KitLook.mirrorStalk`, `carkit/exterior.ts` `buildDoorHardware`). The heads sat on the
  generic short arm at the door's top, centre 1.19 m, under the glass's foot (1.23): from
  the seat the door trim hid a third of the left glass and the cabin trim 72 % of the right.
  They now stand on upright stalks from a bracket at the door's front edge under the belt,
  the head behind the stalk beside the glass's front lower corner, centre 1.36 m (drawn
  1.345, photos 1.34-1.39), s 1.415 → 1.45; both glasses are seen whole through the door
  glass, the left one 4° under the eye in the straight-ahead view. Aim controls and live
  faces as before; every other kit car's geometry identical.

- THE NIGHT GLITTER IS POINTS, NOT LITTLE RECTANGLES (`GROUND_GLITTER_HOOK`,
  `world/terrainmesh.ts`). Each fragment asked only its own 0.35 m lattice cell for a
  grain, and from about 12 m a cell is only a few pixels tall, so a grain near its cell's
  edge had its disc cut there: flat-topped bars mid-field, whole cell parallelograms, one-row
  dashes far off. A fragment now searches the cells its pixel disc spans along the disc's
  long axis (up to `GLITTER_REACH_COLUMNS` columns, two or three cells each) and adds
  every grain that reaches it, tested for occupancy at the grain's cell, so each grain is
  the same round 2-3 pixel point at any distance and heading. The screen-to-ground
  Jacobian is taken from the eye-relative position, not the kilometres-large lattice
  coordinate. Grains, beat and colours are unchanged; past the column budget (a 1080p
  cabin view beyond about 70 m) the disc shrinks, still round.

- THE LOG CABIN NO LONGER FLICKERS AS IT RECEDES (`world/dwellings/americas.ts` `logCabin`,
  `world/dwellings/builder.ts` `Facade.door` `Facade.shape`). Two skin layers lay a
  centimetre apart on the one polygon offset all facade skin shares, so the offset
  could not part them and the 24-bit depth lost them: the gable's battens ran 6 mm behind
  the loft window's glass (sky mirror against dark wood from ~63 m), and the door's
  raised panels lay 1.5 cm on the leaf (from ~100 m). The battens now stop at the
  window's sill rail, and a panelled door's leaf has holes its panels fill from the wall
  out, as on every dwelling with a panelled door. Same looks, same casters, no new
  material. New `tools/dwelling-skin.ts` lists, per dwelling, skin buried under shell
  and skin stacked on skin, with the range each fight starts at and whether it is wider
  than a pixel there; log cabin: 11 337 cm² of visible fight → 0
  (`npx tsx tools/dwelling-skin.ts --strict log-cabin` exits 0). Visible stacked area
  fell on 21 other dwellings with a panelled door (victorian-ghost +0.5 %, a
  re-triangulation); their other findings are listed by the tool and not touched here.
- A CAR'S SHADOW IS ONE SOLID SILHOUETTE (`render/carshadowhull.ts`, `render/carmodel.ts`
  `shadowHullOf` `carModelShadowHull`, `render/farcars.ts` `FarCarField.addCaster`,
  `vehicle/vehicle.ts` `castHull`). Owner's report, 2026-10-16: a GAZ-31029 parked on the
  sand under a low sun cast a cut-out with a wedge of sunlit sand between the rear wheel
  and the bumper and light lines through it. Every body is zero-thickness panels casting
  from their back faces, with the floor, bay and cabin casting nothing, so light that came
  in through a panel facing the sun went out wherever no panel faced away from it: under
  the tail behind the rear arch, through the door and lid shut lines, under the scuttle.
  Rendering the car's casters from the sun showed exactly those holes (the earlier fix,
  42811af, re-wound the arch ceiling only and its "no arch-shaped holes" did not close
  them). Every model now also casts a closed SHADOW HULL on the shadow-only layer: its
  cross-sections every 5 cm (the convex hull of each plane cut of the casting panels and
  panes, read at 12 fixed directions), lofted and capped, stations a straight loft carries
  within 2 cm dropped; wheels and mirrors cast as themselves, and under the sills between
  the wheels the sand stays lit. Back faces cast, as on every car part, so the cabin seen
  through the glass is lit as before. 650-1030 triangles a model, baked once as it loads
  in a frame of its own; a driven, parked, near or static car carries it as a mesh, a car
  the far, mid or stand-in meshes draw casts it from the shadow-only field (one draw per
  model a pass: 12 for 19 far cars measured). Its depth program is the plain one
  `waitForFrameShaders` links at boot: programs 101 before and after a 30 s autopilot
  drive with traffic (seed flick, km 53). The car's own headlamp beam is unchanged with
  the hull on and off.
- SOFT NEAR SHADOWS IN BOTH STYLES (`render/lightshader.ts` `installSunShadowCascade`,
  `render/cleanstyle.ts`). The near cascade's nine taps stand 1.5 texels apart (an 8 cm
  kernel, about the penumbra of a car roof 3-5 m from the sand under a low sun), and Clean
  reads them too instead of its one hardware compare, whose 1.6 cm steps read as a hard,
  stair-stepped car shadow. `cleanStyle.y` is no longer used.
- THE ROAD'S VERGE IS DARK GRAVEL BY THE ASPHALT, AND THE SAND MEETS IT IN ONE WAVY LINE
  (`world/roadmesh.ts` WHERE THE SAND MEETS THE BAND `SHOULDER_SAND_*`, `render/roadlook.ts`).
  Owner reports on the road look above, 2026-10-16 and -17. On a decaying stretch the
  crushed-stone band did not show at all: any district sand buried the whole verge a third
  and its first 45% outright. Where it did show, the drift's tongues lay on the asphalt's
  edge with clean gravel beside them, and the band's own edge took a per-row hash (1.33 m)
  that read as a comb. A per-pixel drift of sand fans across the band, tried in between,
  read as "an endless comb" too, and sand reaching the band's top would have to lie on the
  road as well, which he does not want. Now there is NO SAND ON ANY ASPHALT:
  - The per-pixel drift on the mat's edge and over the edge line's paint is gone; the
    markings no longer take the road look at all (one program fewer; road look key
    `road-look-v3-surface`).
  - A decaying district's `sandCover` no longer draws a sand wedge in from both edges
    (`sandFactor` is gone). The number stays: the autopilot's pace and the verge's wear
    read it. A worn road reads worn by its decay tint, ravelled edge, cracks, patches
    and holes.
  - The director's `sandTongue` kind is gone (`world/director.ts`, `roadmesh.ts`'s
    tongue cells and the verge it buried, `tools/surface-paint.ts`'s tongue section).
    The Surface channel draws from three kinds now, so its schedule changed: over 20 000
    windows on seeds 1337, 7 and flick about 62% of the old patch, skid and marking
    windows keep their kind and span, the rest (and every old tongue window) draw anew.
    `tools/variety-timeline.ts` passes (worst gap 2025 m against 2100 m).
  - Lay-by pads (`world/laybymesh.ts`) take their dust towards a light warm grey of
    their own (14% over the pad, 25% on the outer column) instead of the palette's sand
    (14%, 40%).

  On the verge: clean gravel for at least 0.8 m from the asphalt on every surface and
  condition, and the desert's sand meeting the band in ONE soft (0.6 m) line along each
  verge whose middle lies 1.6 m out, swung ±0.5 m on 53, 29 and 17 m waves, each verge its
  own phase; whole sand by 2.4 m, inside the 2.5 m formation. Programs 101 before and
  after a 30 s autopilot drive and a switch to Clean (seed flick, km 53; measured before
  the district wedge, tongues and lay-by sand were removed, which change vertex colours
  only). `tools/surface-paint.ts` (seeds 1337 and 7): layout, NaN, floor and ceiling
  (now bounded by the brightest lane colour, not the palette's sand), rubber and paint
  checks pass; three failures were there before this change (the off-feature golden,
  stale since the road-look commit; a cut-and-fill patch at 78.6 km on 1337 and two on 7
  that do not darken their lane; one ghost marking on 7 whose edge steps only 32%), and
  the on-feature golden now fails too, on its row count alone, because the Surface
  channel's windows moved.
- SHADOW EDGES NO LONGER SHIMMER (`render/sky.ts` `SHADOW_DIR_STEP`, `render/lightshader.ts`
  `installStableShadowFilter`). The sun's shadow took its direction fresh every frame, and the
  sun turns 0.25 degrees a second, so the shadow map's texel lattice turned a little each
  frame and every edge (a building's on the sand, a car's, the roof's on a seat) re-stepped
  along its length at different moments. The shadow's direction is now held until the sun
  has moved 0.004 rad (about a second of the day): with the camera still, the lattice
  changed 5 times in 300 frames instead of 299. Three's PCF also turned its five taps per
  pixel by screen-space noise, a dither that crawled as the camera moved; it is four taps
  on a fixed half-texel cross, a two-texel tent anchored to the map, one tap fewer. A car
  turning still moves its own shadows across the lattice; the tent keeps those steps soft.

- THE FIRST DOOR, LID, STEP OR CRASH OF A SESSION IS HEARD (`audio/samples.ts`
  `EVENT_SAMPLES`). Recordings were fetched on first use, and a one-shot cannot wait, so
  the first door, bonnet or boot of a session was silent and only the second played. Every
  event one-shot (about 85 s of audio, 300 KB) now loads with the audio; checked in game:
  `door-open` and `bonnet-open` decoded before any door was touched (were not). Beds stay
  lazy, and thunder (370 KB) loads once rain starts, before lightning can strike.

- A KIT CAR CAUGHT UP WITH FROM BEHIND NO LONGER GROWS ITS EXHAUST, SEATS AND WINDOW DUST AT
  50 M (`carkit/bay.ts`, `carkit/rig.ts`, `render/carmodel.ts`, `render/farcars.ts`,
  `vehicle/vehicle.ts`). The exhaust is out of the underbody's detail group, so it draws at
  every distance and the mid and far meshes bake it; the glass is an opaque mirror from 45 m
  (was 0.9 at 50 m), fading to 0.28 at 30 m, so the cabin comes and goes unseen behind it;
  mid traffic draws its panes in the car's own glass, so their dust is the near panes'
  (the far mesh's flat tint showed a clean pane). Behind a 2107 and a 2109, mid at 55 m
  against full at 45 m: glass and tail panel differ by 1.0–1.6 of 255 (was 5.2–14.4).
  A mid car costs one draw more and one more per shadow pass (its glass); a near one one
  more (the exhaust). The car lab gains `__carLab.mid`, `only` and a `look` FOV for the A/B.

- NO Z-FIGHTING ON KIT CARS AT ANY DISTANCE (`carkit/*`, `tools/kit-zfight.ts`): items on
  the body skin sit in holes cut in the shell instead of on its hidden face, cabin decals
  are laid into their surfaces, lit faces swap places with their dark faces, and the
  underbody's and scuttle's hidden faces are gone. Visible clusters at 10–25 m 16–28 → 0
  and beyond 25 m 22–57 → 0 per car; the scanner also proves every hole covered from
  outside by what mid and far traffic draws, and no longer counts sub-pixel fights, fights
  behind tinted glass or with placeholder wheels.

- NO Z-FIGHTING ON THE CLASSICS' NOSE AND UNDERBODY (`carkit/bay.ts`, `exterior.ts`,
  `specs.ts`): the front beam's top, the bumper brackets' backs and the 2101/2102
  indicator lenses' backs no longer lie in the body's faces; `tools/kit-zfight.ts`
  31 → 0 visible close-range clusters.

- NO CRAWLING SHADOW BANDS ON CABINS AND BUILDINGS (`render/lightshader.ts`
  `installSunShadowSlopeBias`, `config/graphics.json` `shadowNormalBias` 0.02 → 0.08,
  `render/carmodel.ts` `prepareMaterials`). The sun's normal bias is now turned to the
  light's side of a double-sided panel and scaled by the sine of its angle to the sun:
  a texel on a wall or seat the sun grazes, nothing on sand it faces square, so the
  car's contact shadow keeps its margin (tools/shadow-bias.ts: 3.0x). Kit detail parts
  (cabin, bay, boot, underbody) cast no sun shadow; they receive the shell's.

- FEWER DRAWS PER NEAR KIT CAR: those casters were 55 of a near kit car's ~200 draws
  (346 → 291 at the seed-7 start with one car), part of the frame rate lost at POIs
  with several parked kit cars.

- KIT CABIN LINING FOLLOWS THE SHELL (`carkit/body.ts`, `interior.ts`, `bay.ts`): the
  headliner and upper trim are the shell's own greenhouse faces set 28 mm in, so they
  stop at every glass edge; no paint shows round the windows from inside.

- KIT TAIL LAMPS SIT ON THE BODY (`carkit/exterior.ts`, `specs.ts`): no black backing
  plate, no black 2106 rear panel and its distant z-fight; chrome surrounds kept.

- NO MORE FLASH OF THE BODY IN THE CABIN VIEW (`render/cameras.ts` `rebase`). On every
  floating-origin shift (each kilometre or so) the rendered camera was left a kilometre
  behind for one frame, so the car the player sat in was past its cabin's detail range
  and drew without its cabin: the painted shell's inside flashed past the eyes. The rebase
  now moves the rendered camera with the eye. A/B across a real rebase at speed: with the
  old rebase the cabin was hidden for 1 frame, with the fix 0.
- THE BONNET GRID IS SEEN AND PICKED (`player/interaction.ts`, `render/trunkview.ts`). The
  bay's cells stand inside the chassis box, and the box's hit always stood nearer, so no
  cell was ever under the aim; an open compartment now wins over the box it sits in. Each
  cell's outline rides round its top instead of lying under its part on the bay's dark
  floor. Checked on a 2107 from the bumper: all four cells picked, the engine cell lit
  pink with `[F] take 1.5 inline-four — oil full — 4.0 L`.

- KIT REAR-VIEW MIRROR NO LONGER THROUGH THE SCREEN (`carkit/interior.ts` `headliner`).
  It stood a fixed 7 cm behind the glass at its own centre; on the Samaras' and tens'
  raked screens the glass at the pad's top edge is 5 cm further back, and the mirror came
  through by 23 mm (2108/09/099/2115) and 14.5 mm (2110/2112). It is now placed from the
  glass at the pad's corners: measured on all 13 bodies (throwaway raycast against the
  screen glass), nothing through, 22-30 mm of air ahead of it.

- KIT GAUGES: THE SPEEDOMETER AND TACHOMETER FOLLOW THE CAR (`carkit/rig.ts`). Both are fed
  in km/h and rpm but eased at 2.5 units a second, so 0-100 km/h took 40 s on the dial and
  idle-to-4000 rpm about 20 min; they now follow at once like the HUD's dials. Checked: a
  freshly spawned 2106's `kit.get('rpm')` read the engine's 850 at once.
- NO ACNE ON THE KIT SUN VISORS (`carkit/interior.ts`, `carkit/context.ts`,
  `render/carmodel.ts`). A visor is a closed pad 1.6 cm thick, under a 7 cm sun-shadow
  texel, and its back faces put its own depth into the map: diagonal bands crawled over
  its lit face (the house-siding fault of 0.20). It casts nothing now
  (`addBuilt(..., casts = false)` → `userData.kitCastsNone`); it still receives the
  roof's shadow. Checked on a 2106 with both visors down at 10:00 and 12:00: bands before,
  none after.

- KIT CARS' Z-FIGHTING: faces built in another part's face flickered at any distance:
  - the 2103's chrome headlamp rings against its black grille;
  - grille bars against the dark slot behind them, on every grille;
  - the 2110/2112/2115 lower intake against the bumper's groove or moulding band;
  - the radiator top, scuttle and radiator support in the engine bay;
  - the handbrake grip, vent louvres, door handle recess and a 2104 headliner corner.
  Each is now a millimetre, a dropped hidden face or a spec value apart
  (`carkit/bay.ts`, `exterior.ts`, `interior.ts`, `specs.ts`, `tens.ts`, `samaras.ts`;
  the full list with file and line is in `src/carkit/HISTORY.md` "Rendering").
  The new `tools/kit-zfight.ts` builds every kit car shut and open and lists the faces
  that share a plane, banded by the distance the 24-bit depth buffer loses them at and
  kept only where a line of sight reaches them. It went from 133 visible close-range
  clusters to 0 on all 13 cars. Every changed mesh is one of the fixes, and each car has
  8 fewer triangles. The 2110/2112/2115 noses reach up to 2 mm further (the intake), so
  their `model-fits.json` rows were refreshed.
- KIT DROP GLASS INTO THE CABIN: a lowered door window on a kit car came down inside the
  door card, into the cabin. The pane leans in with the greenhouse (12.7 cm over its
  height on the classics, the door is 7.5 cm thick) and used to drop straight down. It now
  slides in its own plane and nothing below its bottom edge is drawn
  (`carkit/rig.ts` `SinkingPane`: the showing part is cut on the CPU while the channel
  moves, into a copy of the pane the car makes on its first move, same attributes and
  program); a pane wound fully down is not drawn, and a sticker on it is folded away
  until it comes up. Checked headless on every pane of all 13 cars at 0, ½ and 1 (nothing
  below the edge, off its plane ≤ 4 mm, the shut pane's own) and in the car lab.
- STICKERS ON OPENING PARTS: a sticker on a kit car's door, bonnet, boot lid, flap or drop
  glass stayed where the shut part was when it opened (all of a car's decals were one mesh
  under the body). Decals cut from a moving part now hang under that part in its shut
  frame (`render/stickerdecals.ts` `StickerDecalCarrier`), so they swing with it, and a
  sticker aimed at an open door is placed from the chassis stamp under the aim, so it
  lands on the door. Checked on a kit 2108 with 30 stickers: its decals split into layers
  under the bonnet, both doors, both front windows, the tailgate and the body, the door's
  decal moved 0.7 m with the door, and no program was linked. A sticker placed through
  `pickBody` on the front-left door, open and then shut, went into the door's decal layer
  with its centre 3 mm from the aimed point on the panel both times.

- A LAY-BY IS LAID IN WHAT THE ROAD IS LAID IN (`world/layby.ts`, `world/laybymesh.ts`,
  `world/terrain.ts`, `world/roadmesh.ts`). Reported from play: the pull-in at every
  roadside stop was asphalt on a gravel, concrete or cracked-asphalt road. `Layby.surface`
  is the road's own surface at the stop (`roadConditionAt` at `Layby.s`), one value for
  the whole lay-by, and the pad uses it everywhere: its colour (`roadLaneVertexColor`, the
  ribbon's undecorated lane colour, the regional gravel on a gravel road), its collider's
  registered surface (grip, rumble) and the terrain's `surfaceFromFrame` (`onLaybyAsphalt`
  renamed `onLaybyPad`). On seeds 1337, 7, 42, 2024 and 31337, the 163 lay-bys of the first
  300 km (54 asphalt, 47 cracked asphalt, 50 gravel, 12 concrete) all match the road at
  their stop in mesh colour, collider and terrain.
- KEYBOARD STEERING NO LONGER FIGHTS A HELD KEY ON SAND (`src/vehicle/vehicle.ts`,
  `src/vehicle/vehicletuning.ts`). The assist still winds a short tap and the first part of a
  hold to the tyre's usable reach, preserving precise asphalt corrections; once a key is held
  past that reach it continues toward the car's physical lock instead of giving the steering
  back to the travel direction. On the headless Zhiguli probe at 80 km/h, asphalt and sand
  both reached 29.9° of a 30.4° lock (98%); sand front slip rose to 52.5° while the wheel
  stayed at lock, so the car ploughs/slides instead of refusing the input.

- A RIVAL QUEUED BEHIND ANOTHER AT THE TURN NO LONGER DRIVES ROUND IT AND ON PAST THE
  COURIER (`world/traffic.ts`). Reported from play. Standing behind the rival still
  waiting at the turn, the second had already decided to cross, so its stop's 30 s
  "going nowhere" clock ran; it was handed back to the road, whose driver overtook the
  car in front. A car standing within 15 m of another on its way in to the same lay-by
  is queued, not stalled (`LAYBY_QUEUE_M`).
  - Oncoming cars giving way stop 15 m short of the gap check's 40 m buffer
    (`LAYBY_YIELD_MARGIN_M`). Held to the buffer itself they crept up to it, stood
    there, and kept the crossing they were yielding for shut: on the bench two rivals
    stood at the turn behind a row of stopped oncoming cars.

- RIVALS NO LONGER STAND FOR MINUTES WAITING TO CROSS TO A COURIER ACROSS THE ROAD
  (`world/traffic.ts`, `vehicle/autopilot.ts`, `contracts/race.ts`). Reported from play:
  three rivals stood in their lane with the left indicator on for 3-4 minutes, a queue
  behind them, with light oncoming traffic.
  - The crossing was a 30 m drift from the edge lane to the slip. From a standstill the
    slowest car (VAZ-1111 Oka) needed 8.6 s, and the gap asked for was 11 s: half a
    kilometre of empty road at 150 km/h. Now the car keeps to its lane nearest the crown
    up to where the pad reaches full width, waits there, and turns across on two 5 m arcs
    and a straight (`CrossTurn`), straight onto the parking line. Out, it waits at the
    pad's far end, which leaves its place to the next rival, and turns back the same way.
    Measured from a standstill on the Oka: clear in 4.0 s in and 5.1 s out over one
    oncoming lane, 4.6 and 5.4 s over two, 0.9-1.7 s of it on the oncoming lanes. The gap
    is 6 s.
  - The pursuit on a lay-by course aims along the line, not along the road, and the
    course can cap its preview (`LaybyCourse.lookahead`): a car waiting short of the turn
    no longer stands with its nose 1.1-1.5 m over the crown.
  - A car that has waited 3 s asks the oncoming traffic to give way
    (`assignCrossYields`). Cars that could not slow at 2 m/s² drive on; every one
    further out, in every oncoming lane, is held to the pace that keeps it the gap out
    until the crossing is done. Several cars at one lay-by are served in turn.
  - The stream, not the race, decides when a rival is too near to pull in: 70 m before it
    leaves its lane (`LAYBY_HANDIN_ROOM_M`), the slip or the turn.

- A LAY-BY'S SLIPS GROW OUT OF THE ROAD EDGE CLEANLY (`world/roadmesh.ts`,
  `world/laybymesh.ts`). At every entry and exit the verge showed a black slit, a grey
  wedge, a hard edge of sand and a flickering sliver. Three causes. The shoulder strip
  folded away on the whole lay-by span at once, while the slip there is centimetres wide
  (its smoothstep reaches 0.7 m only 6 m in), so for several metres nothing covered the
  verge and the road bed's dark skirt stood above the sunk sand. The strip's fold from a
  full row to a collapsed one in one 1.33 m step was the wedge, and its edge against the
  sand the hard step. And the lay-by's own 0.35 m lip, dropping into the sand, began full
  size at the slip's very tip and crossed the strip's folded triangles at grazing depth.
  - The shoulder strip now hangs off the lay-by's OUTER edge wherever the asphalt has
    widened (`laybyOuterAt`, at `Terrain.laybySurfaceY`, the lay-by's own vertex), so one
    strip runs along the road, out round the slip and pad and back, sharing the
    asphalt's edge vertex for vertex. Its LooseShoulder collider and verge skirt follow
    it.
  - The lay-by mesh has no lip (the strip takes it into the sand as it does the road)
    and is drawn from the last row with no width, so the slip starts from a point on the
    road edge; its Asphalt collider still skips rows under 2 cm. Same material object,
    same attributes: no new program.
  - Measured at seed 'flick' 7.7 km (right side) and 30.8 km (left side): the drawn
    ground lies at least 0.099 m under every point of the lay-by asphalt, the collider
    steps at most 1.24 mm across the road-edge joint (442 raycast pairs), and screenshots
    from the same viewpoints at both slips before and after, with the camera nudged
    between frames, show the strip continuous and no slit, wedge or flicker.

### Removed

- STORAGE CELL READOUTS IN THE PROMPT (player/interaction.ts). Aiming into an open boot,
  bonnet or courier trunk no longer says "bonnet 2/4", "empty trunk cell 8", "empty
  engine slot" or "— cell 3": the grid already shows which cells hold what. The prompt
  names only what F does there ("[F] take …", "[F] stow …", "[F] install …", a pour, a
  refusal such as "engine slot — wrong part").

- PUSHING CARS ON FOOT. Walking into a car no longer shoulders it along: walking up to
  a door to get in kept sliding the car away. A live car's chassis is `IMMOVABLE` to the
  player's capsule (player/player.ts, main.ts); `Vehicle.shove`, `tryShoveFromSphere`,
  `Player.setNearbyShove` and the `SHOVE_*` tuning are gone. The parking hold still stays
  off for 0.2 s after a flip (`FLIP_HOLD_RELEASE_SECONDS`). Loose parts, jerry cans and
  the football are nudged as before.

## 0.22.0 — 2026-10-10

Brakes that reach the tyres and lock them, a road that hits instead of floating (humps, potholes, cracks, patches and joints), one keyboard steering scheme, a rear-only handbrake, calmer and smarter traffic, more corners and a twisty road from the first kilometre, the Panini lens removed, and settings regrouped with a Settings button on the title screen.

### Removed

- THE PANINI AND CYLINDER LENSES. Both made the owner motion-sick. The finishing pass
  samples the scene 1:1 again (no lens uniforms, no Catmull-Rom sampling, no 1.25x
  scene target), and the dev menu's Lens button and its `bro.lens` storage are gone.
- THE GRAPHICS ROW ON THE TITLE SCREEN. The title has a Settings button instead, which
  opens the same settings screen as the pause menu (writing to the stored preferences
  the drive then loads).

### Changed
- A FLOORED BRAKE PEDAL REACHES THE TYRES, AND LOCKS THEM (`vehicle/vehicle.ts`,
  `vehicle/carmodels.ts`, `vehicle/vehicletuning.ts`, `vehicle/autopilot.ts`). Held flat,
  the pedal stopped a VAZ-2101 from 100 km/h in 74 m at 0.52 g with no wheel locking.
  Two causes. `brakeDecelG` was a stopping-distance target dressed as the brakes (0.42-
  0.6 g, sized to unsourced "period 100-0" figures in tools/reality.ts) and capped the
  whole pedal below the tyres; at it every road car failed its own factory figure (43.2 m
  from 80 km/h at gross mass, GOST 22895-77, or 38 m in the later VAZ manuals). And the
  pedal asked `min(brakes, 0.99 × summed tyre capacity)`, an anti-lock brake on any
  surface where the tyres gave out first; on gravel both limits met at 0.5 g, which is
  why gravel stopped as short as asphalt (the failing handling-cli check).
  - `brakeDecelG` is now the brake hardware at a floored pedal: 1.0 g unassisted
    (GAZ-21, VAZ-2101/2102), 1.2 g with a servo, 1.4 g for the rally 2105 — above every
    tyre, so the pedal locks and the tyre sets the stop. The demand has no grip cap.
  - Measured, floored pedal from 100 km/h: Zhigulis 46-50 m (was 74), Samaras and the
    2110 42-43 m (66), GAZ-21 57 m (86), GAZ-24 49 m (78), Nivas 48-50 m (76-78), UAZ 53 m
    (73). Laden from 80 km/h every car is under its factory ceiling. Gravel 62.9 m
    against asphalt 47.5 m for the VAZ-2106 (the check passes).
  - `Vehicle.thresholdBrakePedal`: the pedal share at which the first axle reaches its
    tyres' peak, per axle (fixed bias, load sensitivity, the engine's overrun drag on the
    driven axle). The autopilot scales its pedal by it, so its 1.0 is a threshold stop
    that does not lock; `measuredBrakeDecel` is that stop's deceleration.
    `estimatedBrakeDecel` solves the same per-axle limit with steady load transfer
    (it used to sum four tyres and promise a Samara 1.1 g where the rear-limited
    threshold is 0.7). VAZ-2110 threshold stop from 100 km/h with a passenger: 54.8 m
    against Za Rulem's 55.0 m for the 21102.
  - The autopilot's bend brake share now leaves the mode's `gripReserve` free: the old
    brakes left that margin by being weak.
  - tools/reality.ts judges braking on the sourced figures: the factory 80-0 at gross mass
    as a ceiling, and a threshold 100-0 against a measured road test. Every model's
    passport figures and their sources are in its carmodels.ts comment.
- THE ROAD STOPS FLOATING AND STARTS HITTING (`world/roadsurface.ts`, `world/roadmesh.ts`,
  `core/surfaces.ts`). Measured (tools/ride-bench.ts, wheel path, asphalt): 15.6 mm RMS
  of 10-40 m swell against 6.1 mm at 3-10 m and 0.7 mm under 3 m — the band a body on
  1.1-1.3 Hz springs is driven at resonance by between 60 and 100 km/h, and almost
  nothing a wheel could strike. Causes: the bump layer's 6.7 m value-noise octave (value
  noise is white below its lattice, so most of its energy was 13-20 m waves), the
  undulation's second octave (25-30 m), and the sealed decks' 3 cm sub-collider hummock.
  - Bump layer: one 3.33 m octave as a first difference over 1 m, in the road frame
    (`ROUGH_COMB`, `BUMP_AMP` asphalt 0.03, cracked 0.038, gravel 0.05, concrete
    0.025). Undulation: one 30 m octave (`UND_AMP` 0.05). `hummock`: asphalt 0.012,
    cracked 0.016, concrete 0.01, gravel 0.035.
  - ROAD EVENTS: humps, rimmed potholes, transverse cracks, sealed ridges, patches
    (proud or sunk, with a seam step at each end), frost heaves, and a concrete joint
    every 5.33 m. A pure function of (seed, gap, column); each sits inside one gap
    between base rows, 0.25-1.25 m long, mostly in the wheel tracks, with rates per km
    from new to worn by surface (`EVENT_MIX`: asphalt 3-30, cracked 30-90, gravel
    50-130, concrete 3-20 plus joints), clustered. Height is clamped so the steepest
    climb minus the steepest descent is at most 0.1 (`EVENT_MAX_SWING`, 2.5 m/s at
    90 km/h, under the 2.75 m/s pothole cap); no event in reach of an old pothole.
  - The collider carries them: the gap gets extra rows at the event's knots, appended
    after the base rows in the mesh and in each collider slab (`gapQuads`). Base rows,
    colours, shoulder, terrain edge and chunk seams are unchanged; probed with
    raycasts, the collider matches base-interpolation-plus-event to 0.45 mm. Holes
    tint towards broken base course, patches to repair bitumen, cracks and joints
    dark, all in vertex colour (no new material or program). Markings follow the
    event rows.
  - Before → after (tools/surface-feel.ts, 2105r, right lane, 60 / 100 km/h): body
    float (heave over the road, 0.3-2.5 Hz) asphalt 16.2 → 8.2 / 18.2 → 11.9 mm,
    cracked 17.5 → 6.9 / 16.5 → 10.0, gravel 22.0 → 10.6 / 24.8 → 14.3, concrete
    17.7 → 7.3 / 19.0 → 10.5; pitch at 60 km/h 0.26-0.40° → 0.10-0.19°. Hits
    (compression over 0.5 m/s) per km at 60: cracked 12 → 20, gravel 30 → 48, worst wheel load ≤ 2.2x
    static, all four wheels on the ground throughout. 0-100 on the road 11.3 → 11.1 s.
    Traffic pace on one stretch (traffic-road seed 42, s 40 km) unchanged: normal 70 →
    71, hurried 89 → 87, frantic 118 → 115 km/h, ego 79 → 79. Profile (ride-bench,
    all bands averaged, 10-40 m mm RMS): asphalt 15.6 → 4.7, cracked 17.1 → 5.7, gravel
    20.4 → 7.1, concrete 14.5 → 4.2; events per km of one wheel path 3.4 / 17.6 / 16.4
    / 190 (joints); worst damper step at 90 km/h 2.50 m/s sealed, 2.75 gravel.
  - Benches: ride-bench reports RMS per wavelength band, 60 Hz-sampled damper steps,
    a quarter car and events/km; surface-feel drives the real road chunks
    (`RoadMeshProvider`) per district surface and reports float, pitch, wheel load and
    hits. surface-paint and road-lanes read the base rows and allow whole extra rows.
- THE HANDBRAKE LOCKS THE REAR WHEELS ONLY (`cableLocked` in `vehicle/vehicle.ts`). It
  locked all four, which stopped the car straight; every car in the catalogue has its
  cable on the rear drums (the UAZ's transmission brake holds the rear propshaft). At
  60 km/h with a quarter of lock: rear lock 1.0, front 0.0, peak yaw 60°/s (2106), 70°/s
  (2108), 44°/s (UAZ). A stopped car is still held by the parking hold.
- ONE KEYBOARD STEERING: HOW LONG YOU HOLD THE KEY IS HOW MUCH WHEEL. The Keyboard
  steering assist and Steering key release settings are gone (old saved values are
  ignored), and with them `SteerMode` 'keysFull', `KeySteerRelease`, `keySteerStep`, the
  input setters and `steerInputExponent`. A key (or the touch wheel) is now a direction;
  the vehicle winds its own hold toward it (`Vehicle.updateSteering`, constants
  `KEY_STEER_*` in vehicletuning.ts):
  - Walking pace to 20 km/h (blended to 40 km/h): the hold turns the wheels about the
    CAR'S AXIS to full lock, whatever the slide; release gives it back over 2.5 s, so
    taps add up. Owner's report: sliding sideways down a sand dune, the key to turn
    back uphill did nothing. Measured in game on a 23° sand slope at 8 km/h: the old
    assist steered relative to the travel angle and its tail-out give-way held the
    wheels at 18-27° DOWNHILL with the uphill key held; the hold now puts them at full
    uphill lock (29.5 of 30.4°) in 1.0 s and the nose turns 27° back uphill in 5 s.
  - At speed: the hold winds in (time constant 0.35 s) to the old assist cap, the
    front tyres' peak on top of the travel angle, and returns at a rate proportional
    to the hold plus a floor, starting 0.25 s after the key comes up: a row of taps
    holds a bend with no snap to centre (100 km/h, 55 ms taps every 200 ms: hold
    0.24-0.37, never zero; 40/55/70 ms taps hold 0.9/1.6/1.9° of steer), and a whole
    hold is back in about 0.6 s, against Ease off's 0.9 s.
  - The opposite key unwinds the hold 2.5x faster and stops at straight; past it, the
    ordinary rate, so one short tap after a few too many is a small correction (in
    game: 0.86° right to 0.88° left and back). In a slide (`tailOut`) the countersteer
    side winds up to 2.5x faster and a released hold comes back at once.
  - The tail-out give-way now needs the body to be rotating (yaw rate against the
    a/v the grip holds), so a car pushed sideways by a slope is not handed to its
    travel angle. The chase camera's look into a corner reads the steering rim
    (`CameraTarget.steering`) instead of the input. `tools/tap-response.ts` and
    `tools/steer-feel.ts` drive the new frames.
- TRAFFIC BRAKES FOR WHAT IS ACROSS THE CROWN, DOES NOT HOLD A LINE INTO IT, AND WAKES LEVEL.
  Frantic contacts on the ten-stretch bench, classified from the new partner detail in
  `--events`: the commonest and fastest (15-25 m/s) was a detour, middle thread or pass
  return held 0.3-0.7 m past the crown while a car came the other way in its own lane,
  often slow (recovering, detouring at 7-11 km/h, or just woken and braking); then passes
  into a slow or detouring car in the far lane; then verge passes and detours braking at
  0.35-0.5 of the pedal; the rest were pile-ups behind a first crash.
  - Bodies past the crown that are stopped, crawling or slower than `CROWN_SLOW_MPS`
    (18 km/h toward us, any speed our way) are corridor obstacles at their real lateral
    for every line on a two-lane road, not only through the middle; faster oncoming
    traffic stays the crossing gate's. A corridor block coming toward the car is braked
    for on the car's share of the gap, `v / (v + u)`.
  - A committed line whose own evaluation is `crossingAbandoned` (straddle or crossing
    permission withdrawn) or has something coming down it is released when the search has
    a line that is neither; the middle line is no longer forced over the search when it is
    abandoned or has an oncoming block. On the wrong side with a head-on probe hit, the
    rear-entry veto is lifted for the way home and the drop-back applies.
  - The middle-pass gate looks for stopped and crawling bodies past the queue too, and
    the crossing gate counts a slow body going our way in the far lane as standing. The
    gate reads the field's oncoming speed out to `ONCOMING_FIELD_LOOK_M` (1000 m) instead
    of assuming 20 m/s past the 220 m corridor horizon.
  - The pedal is `min(decision cap, ceiling × friction share)`, not their product, and the
    obstacle cap grows as `OBSTACLE_BRAKE_MAX · (v / limit)²` when the car is above its
    obstacle limit (woken at 150 km/h with something in the lane, put out on the verge at
    145): a car behind its plan gets the brake the plan needs.
  - For `WAKE_CAUTION_S` (3 s) after an engagement (a rails wake, mostly) no discretionary
    pass or crossing, and a new lateral move starts only at its own planned speed (verge
    moves at the verge's) plus 1 m/s: slow first, then move.
  - Rails rolled the body the wrong way on banked decks (`Vehicle.railStep`: +x is the
    car's left), so one side rode 6-15 cm inside the road and the other as far above it;
    46 of 823 wakes in one ten-stretch run loaded the springs past 1.8× in the first half
    second. A wake now also sets the body at its resting clearance over the ground probed
    under it. The bench tallies wake landings (`hard`/`light`) and prints each bad one with
    per-wheel ground gaps; `--trace-car <id>` prints one car's plan every 0.1 s.
  Ten stretches, frantic share 0.5, per driven car-minute, three runs before → two after:
  frantic contacts 0.21/0.40/0.44 → 0.13/0.18, airborne 0.07/0.05/0.06 → 0.02/0.01,
  departures 0.29/0.35/0.35 → 0.16/0.20, slides 0.09/0.18/0.18 → 0.08/0.13, planned verge
  passes 0.37/0.36/0.41 → 0.42/0.40; open road 112/111/107 → 116/116 km/h. Normal contacts
  0.15/0.10/0.09 → 0.03/0.05; hurried 0/0/0.16 → 0/0.18 (7 contacts in 39 car-min, noisy).
  Hard wake landings: normal 17 → 0/2, frantic 28 → 24/20; what remains is frantic only,
  at 70-150 km/h with the wheels within 5 cm of the ground, cause not found. Still
  present: head-ons with a line over the crown (fewer, not gone), verge pass returns into
  the car passed, and pile-ups. Not checked in the game.
- LOOSE ITEMS NO LONGER LINK SHADER PROGRAMS MID-DRIVE. Seed 1337 at km 44 linked two
  programs a minute into the drive: the medicine bottle lying on a home's step, whose amber
  glass (`glass()` in render/partmesh.ts: transparent and double-sided, so three draws it
  back face then front with a program for each) existed nowhere at boot. Items lie in the
  world only where a POI, a story site or a wreck put them, and nothing held their programs
  before the first one came into view. It predates today's traffic work: at 6c47c58 the same
  drive linked the same two, and also the condition program for a spray tin, since that
  boot held no part. `itemProgramAnchor()` (render/partmesh.ts) is a hidden group in the
  scene from boot with every material shape a world item uses: the bottle itself (flat and
  glass, unshadowed as a loose item is), a condition material and the football (mapped,
  bumped leather and seam lines). The postcard and photographs are left out, since only the
  player drops them. With the anchor in place, 0 programs were linked after the first
  settled frame on seed 1337 km 44 (3.5 min) and km 105 (3 min) and on seed 42 km 6
  (3 min), all driven by the hurried autopilot. The POI kit materials (the known one-off)
  were not the cause.
- TRAFFIC DRIVES THE VERGE ON THE VERGE'S GRIP, AND THE BENCH DRIVES ON THE GAME'S GROUND.
  - The real-road bench (tools/traffic-road.ts) built no shoulder strip and laid
    `TerrainMeshProvider`'s heightfield a few centimetres above where the strip goes, so
    every wheel past the paint stood on sand. It now builds the road mesh with the
    road-distance field and keeps `DesertTileStreamer`'s physical square round the ego, as
    `main.ts` does. Events now print the commanded line, what each wheel stands on, what
    the chassis touches and the 2 s trail with both; departures say how far outside their
    own line they are (`[N on its line]`).
  - Lines onto, along and off the verge move at the verge's own lateral budget
    (`estimatedLateralAccel(LooseShoulder)` less a 10% cross fall, `SHOULDER_CROSS_FALL`,
    at the mode's reserve; the line takes `MANOEUVRE_LATERAL_SHARE` of it), in the corridor
    planner (`CorridorRequest.vergeLineAccel`) and in the line slew alike, and the verge's
    bend speed is what is left (`vergeBendSpeed`, was a constant 2.5 m/s²). A pass on the
    verge is held to leader + 6 m/s as a ceiling as well as a floor (it asked for the
    road's 121 km/h at full throttle on the stone), and its body edge stays on the graded
    strip (the 0.9 m of wheel-in-sand `SHOULDER_PASS_EDGE_MARGIN_M` is gone).
  - Racing cars ride bends on rails at half their cornering budget
    (`RAILS_WAKE_GRIP_SHARE`): a car woken in a fast bend has to build the corner's side
    force from nothing, and 15 of 231 frantic slides and departures began within 3 s of
    such a wake.
  Ten-stretch bench on the game's ground, frantic share 0.5, two runs each, per driven
  frantic car-minute, before → after: airborne 0.06/0.05 → 0.04/0.03, departures
  0.53/0.44 → 0.22/0.33 (off their own line 26/25 → 11/17), planned verge passes
  0.84/0.71 → 0.46/0.44, slides 0.53/0.48 → 0.15/0.23, contacts 0.39/0.42 → 0.27/0.26;
  open-road pace 112/109 → 111/112 km/h. Hurried and normal unchanged within noise.
  What airborne remains on the bench is crash aftermath and cars already in the desert.
- TRAFFIC NO LONGER WEAVES OFF THE ROAD AT SPEED. The autopilot's yaw-rate damping was one
  figure (0.8) for every speed, and what a wheel angle buys in yaw falls as speed rises:
  above about 130 km/h a frantic car in 230-250 m S-bends swung its yaw rate ±0.3 rad/s on
  ±0.05 of steering, the swing grew every half period, and the car left the road. Zeroing
  the worn front ends' bump steer and free play did not change it, so the cars keep their
  wear. The damping now ramps from 0.8 below 54 km/h to 3 above 108 km/h
  (`YAW_RATE_DAMPING_FAST`). Solo frantic runs on seed 42's and 1337's esses, six bodies:
  8-31% of the run off the road on ten of twelve runs → 0% on all twelve, and 10-40 km/h
  faster. Ten-stretch stream bench, per driven car-minute, before → after: frantic
  departures 0.63 → 0.52, slides 1.26 → 0.77, airborne 0.18 → 0.08, contacts 0.45 → 0.36;
  open-road pace 107 → 111 km/h; hurried and normal no worse. What remains of frantic
  departures and slides is detours and passes on the verge, not the weave.
- TRAFFIC NO LONGER PLANS BRAKING THE TYRES CANNOT GIVE, OR WAKES UP IN THE AIR. Measured
  with the real-road bench's new loss-of-control tally (tools/traffic-road.ts `--frantic-share
  0.5 --events`, ten stretches on seeds 1337/7/42), two causes, both fixed:
  - The speed plan braked toward a bend at full capacity right up to its limit point,
    while the pedal is held to the friction ellipse (`BEND_BRAKE_SHARE_FLOOR`) once the bend
    builds: frantic cars arrived 30-40 km/h over a corner, braked at 0.8 of the pedal at
    0.65 of their grip on a descent, and spun. The profile is now carried back segment by
    segment on what the tyres have left after that segment's bend, the lookahead covers the
    whole braking distance at `brakingDistanceShare`, and crests unload both grip and
    braking (`g - v²·kv`), never more than `CREST_UNLOAD_MAX` (0.5) of the weight.
  - Cars on rails rode at the ride height they happened to have when put on rails
    (0.76-1.15 m on one model), level on banked decks and not turning in bends, so a car
    woken near the player threw itself off its springs: 34 of 769 wakes went airborne
    within a second. Rails now ride at the car's resting clearance, rolled to the deck's
    banking, and a wake hands back the bend's yaw rate and the steering that holds it:
    0 of 769.
  Per driven car-minute, before → after: frantic airborne 0.52 → 0.18, contacts 0.55 →
  0.45; normal airborne 0.11 → 0.04; frantic open-road pace 107 → 107 km/h. The weave
  that remained above ~135 km/h is the entry above.
- MORE CORNERS, AND A NEW GAME OPENS ON A TWISTY ROAD. Corner spacing: pan 1.4 km (was
  2.2), highway 1.3 km (2.2), rolling 750 m (1.1 km), derelict 1 km (1.6); angles and
  radii unchanged, so the no-crossing budget is untouched. The district after the 4 km
  homestead stretch is always rolling or esses. First 40 km over six seeds: 6-12 corners
  tighter than 1 km radius per 5 km once past the homestead (was 2-6 on rolling/highway
  openings). 2500 km on seed 1337: tightest p1 radius 133 m. `SPINE_FORMAT` 10.
- TRAFFIC HOLDS 70-100% OF ITS CAP (`DENSITY_FLOOR` 0.7, was 0.5). On medium a two-lane
  road keeps 8-12 cars, a four-lane one 17-24; the target is still re-rolled every
  36-72 s.
- TRAFFIC DRIVERS COME FROM THEIR CARS (`DRIVER_ODDS` in `world/traffic.ts`). GAZ-21,
  UAZ, Oka, IZh and VAZ-2101..2104 are always sleepers; 2105-2109, 21099, GAZ-24 and both
  Nivas are 25% sleeper, 25% hurried, 50% frantic; 2105 rally, Svyatogor and 2110 are
  half hurried, half frantic. With the bodies drawn evenly the stream comes out about
  50% sleeper, 19% hurried, 31% frantic (was a flat 30/30/40). The first car in a
  direction is still the cautious one if it drew a sleeper; the forced hurried second
  car is gone. Frantic drivers keep the BMW M30 engine and its gearbox.
- A NEW GAME NO LONGER OPENS ON 30 KM OF STRAIGHT. The calm home district is 4 km
  (`HOME_DISTRICT_LENGTH_M`), and the pan road is rarer (weight 0.12 from 0.22) with a
  kink every 2.2 km instead of 4. Seed 1337, first 300 km: pan 9% of the drive (was 22%),
  first districts pan 5 km, rolling 12 km, derelict 12 km. `SPINE_FORMAT` 9.
- THE DESERT SOMETIMES OPENS A VIEW BESIDE THE ROAD (`world/landforms.ts`). About three
  times per 100 km (one candidate slot per 22 km from 32 km, three tries each) the ground
  beside the road does something big: a RIM, where one side falls 10-18 m into a hollow
  that climbs back out by 344 m, so the road runs along the lip; a RIDGE, both sides
  8-14 m down; a GAP, both sides 8-14 m up within 144 m. 300-1 800 m at full height (the
  gap 200-700 m), with 250 m smoothstep ramps in and out. Nothing changes inside 64 m of
  the centreline (`EDGE_M`): road elevation, verge, graded corridor, director cuts and
  embankments, poles, delineators and sidetracks keep their ground. Steepest face 25%;
  falling kinds take 40-50% of the dune relief out of the hollow so a dune does not fill
  it. The shape is a function of world position (nearest point on the event's own
  centreline polyline), in the base field like a lake basin, so tiles, the vista,
  `Terrain.heightAt` and the scatter agree and nothing steps at a join; the caller's
  arclength is only the lookup hint, and the vista now passes the camera's
  (`horizonHeight(x, z, reliefWeight, hintS)`). A candidate is refused if a bend whose
  inside faces a shaped side is tighter than 424 m, if another pass of the road comes
  within 200 m of the footprint, or if a lake is within reach; desert POIs are not built
  on one. Not driven or measured: no bench was run.
- THE KIND OF ROAD BIASES ITS SURFACE (`SURFACE_BIAS` in `world/gradient.ts`). Each 5-7 km
  surface district weighs its material deck by the road character its middle falls in:
  a highway is mostly asphalt and concrete (gravel 4%), a pan asphalt or long gravel, a
  switchback or derelict road mostly cracked and gravel, rolling and esses mixed. A pan
  may keep its material (and a highway its asphalt) across one road district; nothing
  repeats across a change of road. Boundaries and the 40 m join feathering are
  unchanged. Estimated overall shares (Markov model, not the census): asphalt 37%,
  cracked 28%, gravel 26%, concrete 8.6% (was 35/31/26/8.4). `roadConditionAt` and
  `surfaceJoinAt` take the world seed first; `ROAD_START_SURFACE` names district 0.
- CORNERS COME IN PHRASES, AND SOME START JUST PAST A CREST. A district no longer lays
  one corner per `cornerSpacing`, evenly. It is cut into phrases of `phraseMin`-
  `phraseMax` corners joined by `linkMin`-`linkMax` m of straight, then a breather (the
  rest of the phrase, which owns one `cornerSpacing` per corner, so density is
  unchanged). Esses run 3-4 corners 0-60 m apart, switchbacks 2-4 at 0-40 m, rolling
  country 2-3 at 40-220 m, highways 1-3 at 150-500 m, pans 1-2 at 300-900 m, derelict
  1-4 at 20-600 m. Each phrase tightens or opens: radii drift by 60% of the district's
  range across it, and an even-count phrase holds one same-side step (a corner that
  turns further, or unwinds). Phrases alternate side, so every phrase join is a full
  turn. A phrase's start can also be delayed, by at most 240 m and half its breather,
  so its first corner turns in 25 m past the biggest brow in reach (a high point
  followed by at least 1.5 m of fall in 96 m), read from the landscape along the
  road's own held bearing. Every phrase in rolling, esses and derelict country tries,
  switchbacks 40%, highways 35%, pans never; phrases that find no brow stay put. The
  decision is made by scouting the 10 km checkpoint interval from its checkpoint, so it
  is the same in the spine worker, a block replay and a tool's walk; a phrase whose
  possible span crosses a checkpoint is never moved. Bearings, radii and the heading
  budget are untouched, so the no-crossing bound holds as before. `CHECKPOINT_SPACING`
  now lives in `world/roadcurve.ts`; `SPINE_FORMAT` 8. Not measured: no bench was run.
- NO LONG STEEP CLIMBS. The felt relief bands in `world/landscape.ts` are lower (hills
  +-175 / +-60 m, rolls +-30 / +-8 m, from +-290 / +-90 and +-90 / +-14), wavelengths
  unchanged, so long climbs stay but are gentle. Over 1000 km on seeds 1337 and 90210:
  |grade| p90 12% -> 6%, p99 17% -> 10%, max 22% -> 14%; a run at 10% or more lasted up
  to 2 km and now at most 160 m; 500 m stretches averaging 6% or more went from 32-35
  to 2-3 per 100 km. The 225 km and 50 km altitude bands and the mountains are untouched.
- FRANTIC VERGE PASSES. A frantic car can use the shoulder up to 130 km/h, so the
  previous 100 km/h cap no longer rejects most 95-115 km/h leaders. The pass target is
  now a speed floor above the corridor's follow/squeeze target, so a frantic car must
  actually gain on the leader after moving onto the shoulder. Road hazards remain
  disabled: only a stuck or overturned traffic car can obstruct the clean carriageway.
- AMBIENT TRAFFIC MIX. After the first two stream positions, both directions use 40%
  frantic, 30% sleeper, and 30% hurried drivers.
- ROAD DISTRICTS ARE 10-15 KM (`DISTRICT_NOMINAL_M` 12 500, `DISTRICT_JITTER_M`
  2 500 in `world/roadcharacter.ts`), down from 38-62 km, so the kind of road changes
  every eight to twelve minutes at 80 km/h and every kind turns up within about 220 km
  on average (p90 about 370 km), against some 800 km before.
  The calm 30 km home district and the 1.2 km crossfade at every join are unchanged.
- FRANTIC DRIVERS SLOW FOR TIGHT BENDS. A bend whose road speed is under 110 km/h is
  planned on the road's own curvature rather than the racing line's, on a share of the
  tyres that falls to 0.82 by 70 km/h (`tightBendShare`, `bendSpeed` in
  `vehicle/autopilot.ts`), so the line's width is kept as margin for the exit instead
  of being spent on speed. Faster sweepers, sleeper and hurried drivers are unchanged.
  A frantic car on rails takes bends at that same speed (`railCruise` in
  `world/traffic.ts`) instead of its unbounded 14 m/s² ceiling, so one woken in sight
  is not handed a bend it cannot hold.
- THE DESERT RING HAS TWENTY-EIGHT DESERTS AND TURNS IN 1 000 KM (`DESERTS`,
  `PALETTE_CYCLE_M` in `world/gradient.ts`), down from fourteen over 2 000 km. The
  fourteen new ones sit between the old neighbours so each blend has less to cross:
  saffron, peach blush, apricot, madder rose, plum cinder, indigo slate, lilac pumice,
  lichen sage, pistachio, seafoam, periwinkle, orchid, dusty rose and salmon apricot,
  each with its own accent. Holds are 16-25 km (were about 65-100) and blends 7-28 km
  (were about 50-100), sized to the colour distance they cross. The opening ochre is
  unchanged at s = 0; every channel, the accent included, still moves at most one
  8-bit step per 200 m chunk, and sand stays at least 45.7 RGB from rock. The cyclic
  sky channels (dust, haze, sky tint) follow the shorter period.

- DEFAULT VIEW 65°, MAXIMUM 85° (`config/gameplay.json`), the rectilinear range the
  frame stays sane in (`FIELD_OF_VIEW_MAX` in `game/settings.ts`). A save keeps the FOV
  it stored: a 0.21.0 save that was left at that release's 85° default still has 85°
  and is moved back with the Field of View slider; one above 85° is clamped to 85°.
- THE VIEW WIDENS WITH ACCELERATION, NOT SPEED. The driving views add 2.5° per m/s²
  of the smoothed surge (at most +10°) and return to the resting FOV once the speed
  holds, so a cruise at any speed rests at the player's own view; braking narrows it
  as before (2/3° per m/s², at most -2°). The old five degrees at 160 km/h is gone
  (`FOV_ACCEL_DEG_PER_MPS2` in `render/cameras.ts`).
- SETTINGS REGROUPED BY MEANING: Quality, Camera & view, Gameplay, Controls,
  Controller, Audio. Display and Compute are one QUALITY section with ONE preset (Very
  Low / Low / Medium / High) that sets the detail level, the view distance and the
  traffic at once, plus what picking a level always brought (its own antialiasing,
  automatic render scale, no frame cap) — `withQualityPreset` in `game/settings.ts`.
  The preset is not stored: it is read back off those values (`qualityPresetOf`), so
  saved preferences load unchanged and any Advanced change shows `Custom`. Advanced
  (folded) holds Detail, View distance, Traffic, Render scale (was Sharpness), Frame
  rate and Antialiasing (was Smooth Edges). Field of view, camera style, camera shake
  and dashboard size are under Camera & view; Steering moved to Controls; Gearbox and
  Yaris mode to Gameplay; Sound is Audio.
- THE LAUNCH MEASUREMENT FEEDS THE PRESET. When the settings are on a preset (a first
  launch is: the defaults are Medium) each rung it walks to brings that preset's view
  distance and traffic with it; settings already off a preset only have their rung moved.
  `Let the game pick` from Very Low restarts it from the Low preset (`withRemeasure`).

### Added

- SHAKE KICKS (dev builds, on by default; Pause › Shake kicks, remembered as
  `bro.shakeKicks`). A short damped jolt of the driving view on a hard throttle or
  brake onset, a gear change, a landing or a hard bump: 0.4–1.2° of pitch (and roll on
  landings and bumps), plus a 2.5–4 cm drop of the eye on hard braking and 2.5–6 cm on
  landings. The onset kick is sized by the strongest acceleration in its first 0.12 s,
  not by the threshold crossing, so a hard stop reads harder than a gentle one.
  Rings out in about a quarter of a second, on top of the speed sway; off with Camera
  Shake.

## 0.21.0 — 2026-10-09

A wide view through a Panini lens, a dense haboob you can barely see out of, fewer draw calls (shared prop batches, instanced poles, merged lamps), smoothly turning wheels, the game starting from a phone over the LAN, and the first commit of carforge, a low-poly car generator built like the Soviet pack.

### Added

- THE GAME STARTS OVER A PLAIN-HTTP ADDRESS. A phone opening the game by the computer's
  LAN address (http://192.168.…) has no `AudioWorklet` (it exists only on https and
  localhost), and New drive failed with "Cannot read properties of undefined (reading
  'addModule')". The mixer now treats a missing worklet as a failed load
  (`Mixer.loadWorklet`): the game runs, the mix goes out unlimited and the engines are
  silent. Full sound on a phone: `npm run dev:https` (`vite --mode https`, a self-signed
  certificate from `@vitejs/plugin-basic-ssl`; accept the warning once on the phone).
- THE SVYATOGOR AND THE VAZ-2110 KEEP THEIR TRIM. The lamp-and-trim merge
  (`mergeStaticBodyMeshes`) baked each piece's transform into its geometry in place, and
  the meshopt-packed GLBs store positions quantized (normalized Int16), so every
  coordinate past ±1 was clamped: the Svyatogor's bumpers and underbody shrank into a
  2 m box over the bonnet and the 2110's blinkers left its corners. The pieces are
  copied to Float32 first (`floatGeometry`); both cars render as before the merge.
- A WIDE VIEW THROUGH A PANINI LENS, AND A BIGGER DASHBOARD. The field of view starts at
  85° (was 58°) and goes up to 120° (was 85°; `config/gameplay.json`), seen through a
  light Panini lens (`DEFAULT_PANINI` 0.3, `paniniSource` in `render/hazeshader.ts`):
  the wide coverage keeps the sense of speed, the lens keeps the edges from stretching
  and brings the middle of the frame up. Dev menu: Panini lens off/0.1/0.3/0.5/0.7/1.
  The dashboard's old 140% is the new 100% default on desktop
  (`Settings.dashboardSize`, range 55-120%); a save's old `dashboardScale` is carried
  over by dividing by 1.4, so nobody's dashboard changes size. The phone cluster is
  unchanged.
- WHEELS TURN SMOOTHLY ABOVE 60 FPS. A wheel's spin, suspension travel and steer are
  interpolated between the last two physics steps like the chassis (`spinPrev`/`spinStep`
  in `vehicle/vehicle.ts`). Drawn raw over the 60 Hz step at about 100 fps, a wheel
  turned one step on one frame, two on the next and none on the third: a stutter on
  every car alongside, read in play as the traffic moving in micro-jerks.
- INSIDE A HABOOB THE WORLD IS THE WALL SEEN UP CLOSE. The short sight inside the storm
  is applied in the finishing pass (`uDustInside` in `render/hazeshader.ts`,
  `FOG_DUST_SIGHT` in `render/sky.ts`, k = 0.056 from the camera: half gone at 15 m,
  94% at 30 m), in the colour of the wall's foot, and it covers the sky and the far
  ridges too: as scene fog it reached the land only, so the moment the front passed
  the sky and the horizon stood out bright. It ramps with the square of the dust and is
  full when the wall reaches the car, so the sight opens back out to hundreds of metres
  and the sky returns as the storm thins. The wall seen from outside is unchanged.
- VERY LOW HAS A SHARPNESS ROW: 360 OR 540 LINES (`Settings.retroLines`,
  `retroPixelRatio`). Still whole display pixels per frame pixel — two instead of three on
  a 1080-line screen — so the squares stay crisp, only finer. 360 stays the default.
  Measured on an M2 Pro on the heaviest scenes: +0.7-0.9 ms of GPU on 2.4-3.6 ms; the
  rung's frame is mostly geometry, not fill.
- `tools/look/gpucost.mjs`: where the GPU's time goes in the real game. Drives into a
  scene with the traffic at its densest (an ordinary stretch, a courier ahead, a mirage, a
  crest over the longest drop), noon, night or storm, freezes the world there
  (`__bro.loop.stop()`), and measures interleaved against the frozen frame: the noise
  floor, the shadow passes, MSAA, the render scale, and every part of the world hidden in
  turn, in GPU and in CPU submission time. Dev hooks `__bro.loop`, `mirageSchedule`,
  `courierAt(index)`.
- OTHER CARS' CRASHES ARE HEARD (`GameAudio.trafficCrash`, `playCrash` in
  `audio/vehicleaudio.ts`). A traffic car's impact detector already measured every hit;
  its voice threw the number away. Now every traffic car within earshot (380 m), not only
  the six nearest that have an engine voice, plays the driven car's own crash where it
  happened: a panner of its own, the air dulling it with distance, on the world bus.
  Above 1.2 m/s of unexplained velocity change, once per 0.35 s per car. Checked in the
  real stream: a pile-up 6-10 m away fired at 3-14 m/s.
- `tools/look/franticstats.mjs`: the ambient frantic drivers in the real game, sampled
  every frame — top speed, worst sideslip, slides past 6°, yaw weaves, seconds off the
  road. `tools/look/hitch.mjs` takes `DAY` (the day cycle in minutes), `HOUR` and
  `HEADED=1` (a visible window, `boot.mjs`), and prints frame pacing (p50/p99/worst,
  frames past 25 and 50 ms), the resolution scale, which shadow maps were drawn and the
  programs linked mid-draw for every 30 s of driving.
- DELIVERY ROUTE LINE (`Hud.setRouteProgress`, `world/couriers.ts` `nextCourierIndex`).
  With contract cargo in hand or in the driven car and no race on, the top bead line
  shows the player alone, from the last courier behind to the nearest one ahead that
  will sign for it (amber pin), with the distance beside it. The line is now a dark
  pill with edged marks so it reads on sky, night and storm; a race ends in a
  chequered flag.
- DASHBOARD: the tachometer and speedometer are larger (134 px boxes). The panel is
  opaque (the scene no longer tints it unevenly), rounded, and laid out on one margin:
  ~10 px from the main faces to the top, side and bottom edges, the half-moons level
  with the main faces' tops and the steering strip's foot on their chord line. The indicator
  arrows and beam lamps moved from under the steering strip into the gaps between the
  big dials and the half-moon gauges (left arrow and dipped beam by the tachometer,
  right arrow and main beam by the speedometer). The wind gauge is now a windsock: it
  streams the way the wind blows, the car's nose marked at the top of the ring, and
  fills one of five orange-and-white bands per fifth of 10 m/s.
- THE DRIVEN CAR'S HEADLAMPS CAST SHADOWS (`render/vehiclelights.ts`,
  `VehicleLightRig.addShadowBeam`, `HEADLAMP_SHADOW_RANGE_M`). On every rung that
  draws the sun's shadow, one spotlight of the rig is created casting a shadow and
  taken out of the pool budget, so the count of spots compiled into every lit program
  is unchanged and nothing recompiles at dusk or when the lamps come on (checked: 65
  programs by day, 65 at night with main beam). The driven car's headlamp pair goes to
  it as one beam from between the lamps (traffic already merges its pairs); a second
  shadowed spot measured ten times dearer. The shadow reaches 160 m, not the beam's
  432-780 m cutoff, on a 2048 map; the map stops re-rendering whenever the lamps are
  off or the day hides them, as the sun's does at night. Measured on an M2 Pro: 16-17
  depth draws a frame with the lamps on, no GPU change beyond noise. A car stopped in
  the beam now throws its shadow down the road ahead.
- PERFORMANCE OVERLAY (dev builds, `ui/perfoverlay.ts`). Pause › Performance overlay
  toggles a translucent graph across the top of the screen, remembered between
  reloads: one column per presented frame (~8 s), main-thread CPU stacked by physics,
  traffic, world streaming, the rest of the tick, draw submission and the rest of the
  render; the remainder of the interval in grey; the GPU's own time per frame as a
  line where the browser has a timer query; the budget line; long tasks in red. The
  header names the limit over the last second (GPU, CPU main with its biggest
  section, the frame cap, or vsync) beside draws, triangles, pixels, programs, JS heap,
  three.js textures/geometries and physics bodies. Fed by `FrameProfiler.last` and
  `Renderer.latestGpuMs`.
- STUCK CARS START SMALL (`vehicle/autopilot.ts`, `RECOVERY_RUNG_*`). The escape ladder
  goes from gentle to decisive instead of starting decisive: rung 0 backs 1.8 m at
  1.1 m/s and 0.55 lock, then 3.2/5/7.5 m up to full lock; the reverse is measured in
  metres, speed-capped, and a pull-out crawls at 2.5-4.5 m/s. The escape turns away
  from an indexed prop within 6 m, but swings toward the opposing lane only with
  160 m of it clear (`oncomingGap`). A car whose tail is boxed in waits up to 2.5 s
  for room, and the cars behind give at most 2.5 m each at 0.8 m/s. Measured on the
  real road at 150 km with a rock in one lane: 23 escapes in 2 min, rungs 10/8/3/2,
  yielders gave at most 3.0 m (was 6.6 m).
- SAVED OBJECTS ONLY LIVE ON GROUND. Parked and working cars, standing trailers, loose
  parts and items get a body only with fixed ground under them
  (`PhysicsWorld.hasFixedGroundBelow`, `STATE_*` in world/ranges.ts), and go back into
  state where they stand when it is taken away. A car left 80 m off the road while
  the player walked 700 m off went dormant at its parked height (340.52 m) and came
  back to it; its desert tile had been demoted under it, which used to drop it out of
  the world.
- GAMEPAD RUMBLE ON COLLISIONS ONLY. Road texture, bumps, landings, slides and the
  steering going light no longer drive the motors (`RUMBLE_IMPACT_FULL_MPS`, main.ts).
- HEAT SHIMMER ON THE GROUND BOILS IN PLACE (`render/hazeshader.ts`, `strataLayer`).
  The strata used to climb in elevation everywhere, and on flat ground a band of
  constant elevation is a circle round the camera: a strong one read as a wide thin
  ring running out to the horizon and vanishing. Rays meeting the ground steeper than
  4 mrad now crossfade time slices in place; the horizon and sky keep the climb.
- DASHBOARD TELLTALES AND INSETS (`ui/hud.ts`). A row under the steering strip carries
  the green indicator arrows (blinking in phase with the car's own lamps), the green
  dipped-beam and blue main-beam lamps; the headlight toasts are gone, the dash is the
  only report. The parking brake's P is red, and with the brake on the gear cell reads
  P. The tachometer's lower wedge holds an inclinometer (side-view car, grade from the
  wheels' contact normals, ×3, ticks at ±10%); the speedometer's holds a wind gauge (the
  wind at the car in its own frame, gusts included, alarm-coloured from 10 m/s).
- HIGH TRAFFIC is 24/48 cars (two-lane/four-lane), was 20/40.
- HEAVY CRATE weighs 80-200 kg, was 300-700 kg: the old range sat a 2106 on its rear
  bump stops. A crate already taken keeps the mass it was offered with.
- NO PARCELS OR ENGINES IN THE CABIN. A contract parcel in the pack, or any single
  item over 40 kg, refuses entering a car with a prompt: the pack rode in the cabin,
  so a second parcel travelled past the boot's one-parcel rule.
- TOW BAR is worked only within 2 m of the join between the two cars. It was offered
  from anywhere the coupled pair were the nearest cars and won the F key, so neither
  car could be entered once hitched.
- THE RACE ENDS when the player drives 600 m past the receiving courier ("race lost —
  you drove past the courier") or once all three rivals have handed in. It used to
  run on with the bead line pinned at the finish and no rivals in sight. The cargo is
  untouched and any later courier still takes it.
- COURIER OFFERS BY TIER, titled in the cargo name: "easy run" (a sticker), "race · 1
  stop" and "race · 2 stops" (a sticker always, plus 1 or 2 coins to the winner, left
  in the courier's boot), "big haul" (trailer, oversize, tow or transfer; a sticker).
  A two-stop race is signed only at its finish. COINS are a new item that stacks: one
  meeting another in the pack becomes one coin with the sum. Offers already in an
  opened courier boot or in hand keep their old kind and do not race.
- EVERYONE STOPS IN A HABOOB (`vehicle/weatherpace.ts`). When the dust of a full
  haboob reaches the road, every AI driver alike — sleeper to frantic, live traffic and
  the race's ghost rivals — pulls to the edge of the asphalt on its own side, stops,
  pulls the handbrake and runs the hazards (a new `hazard` indicator state, shown on
  the dash too) until the dust thins. Nothing short of that changes a driver's pace.
  `tools/autopilot-bench.ts --weather` checks it.
- GHOST RIVALS WANDER: each has its own slow ±8% pace swell along the road and
  spells held up at 75% behind traffic, instead of closing on the finish metre for
  metre at one speed.
- TRAFFIC STAYS ON THE GROUND. Every visual desert tile is solid now (5×5, was 3×3):
  beyond ~400 m a car that touched the verge fell out of the world for good. A car
  30 m below the road is removed. Measured at seed 1337, 100.5 km, 8 min on High:
  flips 5 → 1, impacts 64 → 26.
- GROUND BESIDE THE ROAD BELONGS TO THE ROAD. Each road chunk adds a collider-only
  skirt 20 m past the shoulder on the tiles' own drawn ground (`SKIRT_ACROSS_M`,
  world/roadmesh.ts), so the verge is solid as far as road physics reaches (800 m)
  whatever the desert tiles keep (480-720 m). Before, a car that left the asphalt in
  that gap hung nose-down on the shoulder's edge and was later found on end with the
  desert built through it. Measured with road chunks only, seed 1337 at 30.6 and 80
  km: verge rays 2-18 m past the shoulder hit 0/626 before, 626/626 after; collider
  within 0.03 m of the drawn ground on average, 0.18 m at worst. A wreck (up-axis
  under 0.5) still for 18 s is recycled past 300 m, not only past 500 m.
  `tools/traffic-bench.ts` loads its cars again (document shim).
- WORLD RANGES IN ONE PLACE (`world/ranges.ts`). Road chunks, desert tiles, traffic
  reach, spawn bands and the rails' wake/sleep distances are authored or derived there
  (traffic reach = min(road physics, verge ground)), and `worldRangeFailures` checks
  their relations when the module loads: a figure that breaks one fails the first boot
  or bench. `CHUNK_LENGTH` moved there; `PHYSICS_REACH_M` is `ROAD_PHYSICS_REACH_M`.
- AI DRIVING: verge speed set by the bend ahead (2.5 m/s² on loose stone) and 60 km/h
  past anything standing; threshold braking instead of locked wheels; the racing
  line's edge margin grows with speed; rolling spawns launch at a speed they can stop
  from behind the queue ahead; a car turned more than 35° from the road crawls.
- BOTTLENECKS TAKE TURNS: a car blocked at a stone for 4 s gets the turn and the
  traffic in the lane it needs is held at a line; held cars earn the next turn.
- KEYBOARD STEERING ASSIST is a setting (Settings › Controls, on by default). Off, a
  held key winds the wheel toward full lock at any speed (`SteerMode` 'keysFull')
  instead of the front tyres' peak.
- STEERING KEY RELEASE is a setting (Settings › Controls, Let go by default). Let go
  is the hands-off release: the wheel snaps to the car's line of travel within a
  physics step. Ease off decays the key over 0.25 s with the hand still on and lets go
  near the centre (`KeySteerRelease` in core/input.ts). Measured on the Zhiguli at 80
  km/h, half the wheel angle returns in 0-17 ms on Let go and 117-250 ms on Ease off
  (133-150 ms before the driving overhaul). `tools/tap-response.ts` and
  `tools/steer-feel.ts` report both; tap-response now drives forward on the flat 8 km
  ground (it was reversing off a 30 m ramp).
- XBOX CONTROLLER (`core/gamepad.ts`, see `CONTROLS.md`). Left stick steers as a
  position, RT/LT are analog throttle and brake, every driving and on-foot action has a
  button, the right stick looks. Menus, pause and settings work from the pad. The last
  device touched owns each axis. Rumble: strong motor from bumps, landings and impacts;
  weak motor from road texture, slides, lock-ups and the front tyres going light;
  trigger rumble where Chrome supports it. Settings › Controller: vibration (70%),
  stick dead-zone, steering sensitivity, steering assist.
- CAMERA STYLE in Settings › Drive: Steady (as before, bit-identical) or Dynamic — the
  chase camera follows the slip angle (40%, cap ~10°), leans out of the corner from
  measured lateral acceleration (cap 0.35 m), the bonnet view rolls with the body and
  looks into the corner at low speed.
- DRIVING MODEL, all in `vehicle/` (details in `tools/vehicle-pipeline.md`):
  - Real centre of mass: boot cargo, fuel, engine fluids and the pack are point masses
    at their own places, so a boot load sits on the rear axle and a dry tank shifts
    weight forward. A stock car is numerically the car it was.
  - Honest roll: side forces act at each axle's roll-centre height, geometric and
    elastic load transfer replace the calibrated roll torque (`applyRollCouple` and
    `ROLL_COUPLE_GAIN` removed); per-axle bars, a damper low-speed bleed.
  - Geometry: Ackermann, static camber and camber thrust, roll camber, toe, roll steer,
    caster. Steer locks recut to the true turning-circle geometry.
  - Combined slip both ways: drive and brake slip eat side grip and slip angle eats
    traction; locked-wheel side grip is emergent. Longitudinal carcass relaxation.
  - Engine braking goes through the gearbox and differentials to the tyres (lift-off
    tuck-in, driven wheels can slide on sand); a four-state automatic clutch (open,
    launch, sync, locked) in both gearbox modes, rev-matched auto downshifts, no stall.
  - Steering: a held key asks for the front tyres' peak slip angle instead of a fixed
    speed table, countersteer keeps full reach; self-aligning torque returns the wheel
    when released; keyboard pedals ramp (throttle 0.25 s, brake 0.15 s).
  - Aero: per-body lift at each axle, crosswind side force with a centre of pressure
    (the nose goes downwind), the 0.18 g cap removed, deterministic gusts in the
    weather wind.
  - Trailers: the car's tyre law on trailer wheels, cargo position and tongue load,
    emergent sway (a tail-heavy heavy rig snakes past ~128 km/h), trailer brakes sized
    to the tow car. The yaw damping fake is gone.

- CACTUS AIR DANCERS BESIDE EVERY COURIER (`world/props/airdancer.ts`). Each parked
  contract car advertises itself with a ~5.7 m inflatable on a blower box: a ribbed
  green cactus tube with white spines, a flower on top, two long open arms and a
  puzzled printed face, a couple of metres off the car's flank and turned to the road.
  It is a SIMULATED FABRIC TUBE, not a rig: the centreline and both arms are chains of
  inextensible segments (position-based, 120 Hz), stood up by air pressure (lift plus
  a straightening pull, both scaled by inflation) and whipped by turbulence that grows
  toward the open top. Every few seconds the blower chokes: the pressure goes, the tube
  crumples to the ground wherever it gives, then shoots back up. The weather's wind
  leans it the way the storm's dust flies. A car that reaches it (the blower is not
  solid) shoves the tube points it overlaps along with it and chokes the flow, so the
  tube goes over the car and re-inflates behind it. The mesh is swept along the chains
  every animated frame into preallocated buffers (one draw, one shared texture and
  material); a hidden anchor dancer compiles the program during the boot warm-up
  (measured: no new program when the first dancer comes into view). One animated
  dancer costs ~0.09 ms a frame including the sweep; past 350 m it is not simulated.

- STICKERS ARE DECAL GEOMETRY NOW, AND A CAR CAN CARRY HUNDREDS. They used to be
  printed inside the paint and glass shaders out of a fixed 24-slot uniform array, so a
  car with more kept the extras in its save and never drew them. Each sticker is
  projected once, in chassis metres, onto the surfaces that carry it (paint slots and
  window glass, the same ones placement accepts), trimmed by its own plane and outline,
  and every decal of a car is merged into ONE BufferGeometry with the atlas for a
  texture: one draw call for any number of them. The geometry is rebuilt only when the
  stickers change, and in 3 ms slices across frames — one sticker costs about 0.3 ms on
  the densest body in the fleet, so two hundred in one go would be four frames of hitch
  — while the try-on preview stays a small second mesh re-projected only when the aimed
  pose moves. Wear, dust and scratches still fall over the print, and the decal program
  is compiled with the model's anchor before its first draw. See `stickers.md`.
- THE OKA'S REAR WINDOW IS A WINDOW. The pack drew it as a `car_trim` plate filling the
  tailgate's opening instead of glass, so it neither mirrored nor took stickers —
  placement only accepts paint and glass. `buildTemplate` now cuts the plate that closes
  the opening out of the trim mesh and hands it to `car_glass`
  (`CarModelDef.rearScreenMaterial`, `glassOverTailOpening`).

- THE ROAD IS LESS GLASSY, on every surface, and the sealed ones now ride nearly as
  gravel does. The long 15-30 m swell is `UND_AMP` 0.07 with a floor of 0.55, so new
  asphalt keeps 3.9 cm where it used to keep 1.4. `BUMP_AMP`, the short bumps, is now
  asphalt 6 cm, cracked 6.6, gravel 8, concrete 5.5 and the shoulder 8. The sealed
  surfaces also gain gravel's sub-collider bands, set a step below gravel's (`microRelief`
  10-16 mm, `hummock` 2.8-3.6 cm); gravel itself rises to 29 mm and 5 cm. `texture` is
  asphalt 9 mm, cracked 14, gravel 12, concrete 7, shoulder 8. Potholes and the
  roughness that drives audio and camera shake are unchanged. `tools/ride-bench.ts`
  runs again (it now passes `halfWidth`) and adds a table per surface.
- CONTRACT KINDS (`src/contracts/`). All twenty catalogue kinds are offered by
  couriers, each with its own condition and signature sticker: heavy crate, fragile
  radio, urgent film, medical thermo box, trailer equipment, oversize load, one tank,
  don't overheat, clean delivery, bald tyres, sand route and desert slalom gates,
  long haul, night courier, convoy escort, towing (new car-to-car tow bar), car
  transfer, part order and photo errand (photographs now carry subject evidence).
  See `contracts.md`.
- HANDBRAKE SOUND: the lever's ratchet on a pull and the button-and-drop on release,
  a CC0 recording (Freesound 818295), heard from the lever between the seats.
- Touch sticker try-on strip (turn, size, reset) shown while a sticker is previewed.
- Dev menu "Spawn item" offers a signed envelope of every sticker design (30).
- In-game radio settings now provide two editable station URLs, with recommended NTS 1,
  NTS 2, Underground 80s and Left Coast 70s streams.
- LOCALISATION (`src/i18n/`). `t(key)` looks a message up in the player's language: the
  first of the browser's languages with a table, English otherwise, `?lang=xx` to force
  one. Twelve tables: en, ru, es, pt, fr, de, it, pl, tr, zh, ja, ko. The postcard's note
  is the first message (`postcard.message`), wrapped to its column by measurement, with a
  brush or pen face first for Chinese, Japanese and Korean. The Russian now opens with a
  capital, and so does its second sentence.
- THE POSTCARD'S PICTURE IS A SUNSET OVER THE SEA: the sun half down into the water, its
  path across it, evening clouds lit from below, the white house with its lamps on. The
  mesas are gone, and the palms are the ending grove's own date palms, painted from the
  same card (`drawPalmCard`, shared with `palmGeometry`). The stamp shows the same sunset.
- THE ARTEFACTS AT THE 20 KM MARKS (`world/props/artifacts.ts`). The cairn, the chrome
  shrine and the snapped sign are gone; a 20 km mark is now a distance sign (two in five)
  or one of four things nobody on this road made, each slowly moving: an obsidian
  MONOLITH hanging over a disc of fused glass, bobbing and turning, glyph seams breathing
  teal and pebbles floating under it; a violet crystal spinning over a scorched ring with
  seven stones ORBITING it on a tilted path; a BLOOM of hexagonal crystals with a pulse of
  light climbing through them and a shard floating above; a half-sunk ring GATE whose lamps
  chase round it, with a shimmering membrane in the hole. Animation runs in each mesh's
  `onBeforeRender` from absolute time, so nothing off screen costs anything. They stand
  4 m further from the asphalt than a sign.
- THE SPONGE DOES EVERYTHING, AND WEARS OUT. A sponge takes off dirt, rust and scratches
  together, and cleans between 45% and 65% (`ToolItem.capacity`, a sum of what it removes)
  over its life; the HUD shows what is left. Spent, it turns the colour of what it took
  off, can no longer be used, and drops from the hand at the player's feet. It is a
  car-wash sponge now: the big bone-shaped block (21 x 12 x 7 cm) of coarse open-cell
  foam, pinched at the waist, pitted all over, and with no scouring layer.
- EVERY COURIER'S BOOT HOLDS A PACK OF GUM in one of the bottom row's cells, and about one
  in three a sponge beside it.
- `tools/look/plane.mjs` and the `?plane-lab` page (dev builds) for judging the plane;
  `tools/look/night.mjs`, a night drive photographed whenever a car is ahead; `left` and
  `right` looks in `tools/look/far.mjs`.

- A STORY START. The homestead is gone: a new drive opens beside a house drawn from the
  roadside dwellings (any one that is not an abandoned ruin, chosen by the seed, like the
  car), on the right of the road at 116 m, with the car parked beside it and four to six
  random finds on the yard (`src/story/site.ts`, `src/story/sitebuild.ts`). Across the road
  is a small airfield: a 225 m strip in the road's own asphalt, level across and smoothed
  along so the sand never shows through, with markings, a windsock and a light plane parked
  at its start, windows black like the cars'.
- THE POSTCARD FROM HOME (`postcard` item). The paper card that used to open over the
  held letter IS the item now: one thin 148 x 105 mm card, drawn once per session into
  two 2048-px faces. The message side is the old card's own look — the same handwriting
  font stack, the words verbatim, the address an illegible scrawl — with stamp, postmark,
  address rules and dividing line around it; the other side is a painted photograph of
  the beach the ending lands on (white house, palms, turquoise shallows, flat-topped
  mesas). E raises it to the eyes; E again turns it over to the picture; E again puts it
  away. It is an ordinary item: Q drops it, F picks it up, it saves like any other. A save
  that still holds a letter loads it as the postcard, under the same id.
- THE PLANE IS A WAY TO END THE GAME. F aimed at the parked plane (`[F] board the plane`)
  starts a letterboxed takeoff (engine start, roll, lift-off, climb away; synthesised
  propeller), then a separate beach scene: the plane comes in low over flat-topped mesas,
  lands on a strip on the beach and rolls toward the sea, stopping by a small white house
  among the mirages' palms; the propeller dies away into surf, placeholder credits roll,
  the screen fades to black and the game returns to the title. The sea is its own shader
  (`story/seashader.ts`): summed swells and ripples, sky reflection, sun glitter, turquoise
  shallows to deep blue, breakers and swash running up the sand. The plane is a lofted
  Cessna 172 (tapered fuselage, flush black windows, spring-steel gear into the wheel
  pants, nav lights). Nothing points the player at the plane; driving off is just as
  valid. Boarding clears the resume marker, so a reload mid-flight lands on the title.
- CAMERA SWAY AT SPEED (`Settings.cameraShake`, Settings › Drive, on by default). The
  driving view floats slowly (0.5-2 Hz) from 60 km/h, with the square of speed up to
  300 (above any car, swapped engines included), by rotation only (the aim used for interaction
  stays steady); mostly roll and yaw, a little pitch. Scaled by the surface's roughness
  and by wheels on the ground. At 130 km/h on a gain-1 surface: 0.031° pitch, 0.076°
  yaw, 0.081° roll. A 3-13 Hz tremble was tried first and dropped: at any size the eye
  could see, it read as judder.
- THE CHASE CAMERA SURGES. The arm stretches with the smoothed rate of change of speed
  (6% of the arm per m/s², up to +20%; braking pulls it in, up to -10%; tau 0.4 s) and
  settles once the speed holds. A 2.5 m/s² launch to 130 km/h runs about 0.8 m further
  back than the cruise distance it relaxes to.

### Removed

- THE BRUSH. The sponge does its work; an old save's brush loads as a sponge with the
  same life left.
- THE STARTER HOMESTEAD (`world/house.ts`, `world/poi/starter.ts`, the `starter-homestead`
  POI variant) and its garage-shelf items. Saves from before keep their car where the old
  garage stood.
- THIRTEEN CONTRACT KINDS: urgent film, medical thermo box, one tank, don't overheat,
  clean delivery, long haul, night courier, part order, convoy, bald tyres, sand route,
  desert slalom and photo errand. The courier race covers the "deliver it well and
  fast" angle; what is left is parcel, heavy crate, fragile radio, equipment trailer,
  oversize load, car transfer and towing (parcel, crate and radio are raceable). With
  them went their machinery: the gate field (`world/gates.ts`, `contracts/gates.ts`),
  photo subject recognition (`contracts/photosubjects.ts`, `PhotographItem.evidence`),
  the convoy escort autopilot, enforced tyre compounds, the film-can and thermo-box
  cargo meshes, and every progress/telemetry/probe field only they read. A saved cargo
  of a removed kind loads as a parcel with its name and reward sticker. The towing
  bench is now `tools/tow-bench.ts`.
- TYRE COMPOUNDS. Every car runs the standard tyre (both multipliers were 1.0, so
  nothing is baked in); the O key ("Cycle tyre compound") and its toast are gone. An
  old save's `tyres` key binding is ignored.

### Changed

- FEWER DRAW CALLS FROM THE CHUNK PROPS. Scatter forms, ground cover, contact shadows and
  delineator posts no longer each own an `InstancedMesh` per chunk. They take slots in
  shared batches (`world/props/instancebatch.ts`), one per geometry and material pair and
  per band of four chunks, in pages of 256 instances. A chunk's slots are released when
  the chunk tears down, and a released slot draws nothing. Pages move with the floating
  origin, so a rebase moves pages and never rewrites instances. Every prop keeps its
  shader, shadow flags and render order, so the look is unchanged. Measured on seed
  `flick`, instanced prop draws per frame: 136 → 62 at 69.3 km, 144 → 63 at 40 km,
  91 → 60 at 12 km; pole draws 43 → 18 at 69.3 km; shader programs constant through the
  drive.

- FEWER DRAW CALLS FROM THE CARS AND THE POLES. A car model's lamp lenses that share a
  parent, material and lamp role (the headlight, tail, reverse and indicator clusters) are
  merged into one mesh at template load, and so are the `car_trim` panels under one
  parent (`mergeStaticBodyMeshes` in `render/carmodel.ts`). Paint, glass, wheels, the
  steering wheel and anything carrying stickers stay separate. Every merged mesh keeps its
  first member's name, so the lamp bindings, the lamp bounds and the wheel and paint
  lookups resolve as before. Telegraph pole bodies are one `InstancedMesh` per design
  geometry per chunk (`PoleProvider.build` in `world/props/poles.ts`), with shadows and
  vertex colour unchanged. The instanced variant is linked at boot by `poleProgramAnchor`,
  so no pole program is compiled mid-drive. Wires and anomaly fittings (wrapped tarp,
  nest, gear) are unchanged. Measured, meshes per car: IZh-2715 55 → 12, VAZ-2109 (SA)
  51 → 40, Oka 19 → 15; Soviet pack unchanged (11). Lamp states (headlights, tail,
  brake, reverse, indicators) read identical before and after on the IZh.

- THE LATERAL MANOEUVRE HAS ONE OWNER (`vehicle/lateral.ts`, `LateralCommitment`). The
  detour/crossing latch (`commitLane`), the crossing barrier and the verge pass's state
  (passing, gain clock, giving up, barrier) were a dozen fields written from four places;
  they are now one state with a kind (`detour`, `crossing`, `shoulder`, `middle`),
  entered and left in one function. Checked against the old latch on 1.6 million random
  steps: the same line and the same barrier on every one. The `?apdebug` panel shows the
  commitment.
- THE TRAFFIC DRIVER SAYS WHAT IT IS DOING AND WHAT HOLDS IT BACK (`vehicle/manoeuvre.ts`).
  One manoeuvre a step — recover, make-room, offroad, shelter, yield, pass-oncoming,
  pass-shoulder, pass-middle, bypass, follow, cruise — is decided from the committed plan,
  and pedal rules read it instead of re-deriving it from their own signal. Every cap on
  the target speed and on the throttle goes through one arbiter that records the binding
  rule: `Autopilot.manoeuvre`, `bindingSpeedLimit`, `bindingThrottleLimit`. Behaviour is
  unchanged apart from the verge-pass fix under Fixed.
- HURRIED DRIVERS SIZE THE OVERTAKE ON THEIR OWN CAR (`sizePass`, `LEGAL_*`). The legal
  pass was a constant-speed sum with no acceleration in it and a 1.3 guess on top; it is
  now the racer's simulation of the real car against the real queue, with a driver's
  manners: back in 8 m ahead of the car passed, into a gap 8 m plus a second long, 2.5 s
  of closing to spare. A pass that stops fitting while out there is abandoned the same way
  a racer's is. Sight of the road for the crossing is still required.
- EVERY DRIVER LEANS ON THE WHEEL AGAINST WIND AND CAMBER (`laneTrim`, `LANE_TRIM_*`). The
  lane hold was proportional only, so a steady side push left a steady offset downwind;
  an integral of the cross-track error, learned only while the line is still and bounded
  to 3 m/s² of lateral authority, now takes it out in about a second and a half.
- `Autopilot.setTrafficRecoveryPolicy` is gone: it was written by every caller and read
  by nothing.

- FRANTIC DRIVERS LIFT FOR A PASS AND FEED THE POWER BACK (`RACER_LIFT_SLEW_FREE`,
  `RACER_SLIP_*`, `RACER_FEED_PER_S` in `vehicle/autopilot.ts`). The friction-circle
  cap answered a steady bend; through a lane change the yaw rate crosses zero and it
  opened to full power as the rear was swinging back. A racing-line driver now lifts
  while its line moves across the road (0.3-1.5 m/s, down to 15% pedal) and while the
  body slips past 1.5-4°, and the pedal comes back at most 1.2 a second. Speeds are
  unchanged (ambient frantic cap 125-160 km/h). Real stream, 6 min each, same seed and
  start, `franticstats.mjs`: slides 1.74 → 0.43 a minute, weaves 1.07 → 0.60, worst
  sideslip 30.7° → 16.5°; off-road 29 s → 50 s (different cars each run, one run
  apiece; an earlier figure of 0 s was measured on a stale preview server).
- LOW BUILDS VERY LOW'S LIGHT GEOMETRY (`BuildProfile` in `render/retro.ts`,
  `lightGeometryActive`). Measured in the real game with `tools/look/gpucost.mjs` (a
  crest with ~30 live cars, 1080p), Low drew exactly Medium's triangles and draw calls
  — 2.1 million and 400-800 — and saved only pixels, the sun's shadow and lamp slots;
  the ground cover was 1.7 million of those triangles. Low now builds the light ground
  cover (140 m out instead of 320), the lighter trees and bushes and the coarse open
  desert: 2.1 → 0.8-0.9 million triangles, and the scatter's own interleaved cost on an
  M2 Pro 2.4 → 0.2 ms at noon, 1.2 → 0 in a storm. The build is a profile — full
  (Medium, High), light (Low), retro (Very Low) — and switching across profiles saves and
  reloads the drive, as Very Low did; Medium ↔ High still applies in place. A rung the
  launch measurement picks takes its profile on the next load.
- SUN SHADOWS REACH TWO TO FOUR TIMES FURTHER AHEAD (`render/sky.ts`,
  `SHADOW_BEHIND_M`, `applyShadowBox`; `GraphicsTier.sunShadowMapSize`). The shadow
  box was centred on the camera, so half of it covered road already driven and the
  shadows ahead ended 62-80 m out: a pole, a car or a house further on stood on bare
  ground. The box now leans the way the camera looks and keeps 16 m behind it, and the
  top rung's map is 4096 with the box grown to match, so the texel is still 7 cm.
  Measured from the chase camera at a 21-degree sun: 154 m ahead on `standard`
  (2048), 302 m on `blessing` (4096). The larger box draws more casters: 18-36 sun
  depth draws a frame at 2048 against 24-67 at 4096 on the same stretch, and no GPU
  difference measured on an M2 Pro.
- CAR LAMP LENSES CAST NO SHADOW, AND WHEELS SHARE ONE MATERIAL (`render/carmodel.ts`,
  `prepareMaterials`, `lensNames`, `shareWheelMaterials`). A lens is a skin on the
  bodywork, so its shadow fell inside the body's own, yet each one was a draw of its
  own in the sun's depth pass: 10.4 of 27.8 shadow draws a frame, over a third. Every
  lens named by `CarModelDef.lights`, plus the unswitched `rear_passive` and
  `front_auxiliary`, now stays out of it; a multi-slot mesh that also carries paint
  keeps casting. Wheels came with a material per wheel node, four identical copies per
  set, and the Soviet sets all paint from one palette: they now share one material
  per distinct finish (36 copies on 16 cars became 1). Measured with 19 cars in view:
  100 of 340 car meshes cast (was 357 of 430 with 21), 13.8 materials per car (was 16),
  no lens in the depth pass.
- TRUNK CELLS COUNT LEFT TO RIGHT. Seen from behind the car, cell 1 used to be the
  top-right one; it is now top-left, 1–4 across the top row and 5–8 across the bottom
  (`columnSign` in `vehicle/trunk.ts`, shared by the drawn grid and the aim ray). Cell
  indices and saves are unchanged, so an existing trunk shows its contents mirrored.
  The bonnet already read left to right from the front. `tools/trunk-grid.ts` checks
  the order.

- TRAFFIC IS BACK TO ITS OLD SIZE ON THE 800 M ROAD. `TRAFFIC_CAPS` halved to
  low 4/8, medium 8/16, high 12/24 cars (two-lane/four-lane). The doubling that came
  with the 800 m reach assumed the cars spread over the whole window, but receding
  cars behind are recycled, so the budget lives on the road ahead and read as twice
  the traffic.
- CLOUD SHADOWS ON EVERY DAY, NOT ONLY AFTER RAIN. The shade band is 0.26..0.66
  (`CLOUD_EDGE_*`), the band a clearing storm used to lower it to: about 55% of the
  ground in patches, against 31% before. `uCloudBias` is gone, so the desert no longer
  goes uniformly bright within a minute as the last storm cloud clears, and the CPU
  twin (`cloudShadowShadeAt`, read by the heat haze) now agrees with the shader in all
  weather.
- DISTANT TRAFFIC RIDES ON RAILS. A traffic car more than 360 m of road from the
  player that is simply cruising or following in its lane is moved along that lane by
  a car-following law (Intelligent Driver Model, the driver's own headway, its pace
  under the surface and bend ceiling) instead of being driven: no autopilot, no ray-cast
  suspension, no tyre model. The body stays dynamic with gravity off and is tracked by
  velocity, so every sensor still finds it. It is handed back to its springs and driver,
  at the speed it is doing, nearer than 300 m, or anywhere when its lane ends, a prop or
  any body not itself on rails is in the lane ahead, it slows to a crawl, or it has been
  held up behind a slower car for 3 s and wants past (then it stays driven for 12 s).
  Measured on a 28-car stream: traffic step 1.87 -> 0.97 ms. On the real-road bench over
  four seeds: stream contacts 91 (was 133), bodies thrown out of the geometry 1 (was 10),
  passes 308 (was 241). `RoadTraffic.status.onRails` counts them.
- `Road.sampleAt` no longer pays for the curvature where nobody reads it. `offsetPoint`,
  `project`, `sightDistanceAt` and `hillinessAt` take the node block's position, height
  and heading only (`centreInto`), and `DriveRoad.headingAt` answers the heading alone;
  the drivers' lane model and the traffic snapshot use it. Same numbers, 12% off the
  traffic step: two fifths of it had gone on curvatures that were thrown away.
- THE MOUNTAINS STAND ON THE MAP, NOT AROUND THE CAMERA. `Terrain.horizonHeight` ramped
  the mountain field in by distance from the camera, so in every direction the ground
  climbed to a crest at 7-10 km: one sand-coloured rim around the player, receding as he
  drove at it, with the mesas usually below it. The ramp now reads distance from the
  nearest pass of the road (`RoadDistance`, 800 m lattice; still 2.5 km start, 7 km
  ramp), and `MOUNTAIN_THRESHOLD` rises from 0.15 to 0.5 (mountain cover 70% to 57% of
  the world). Skyline over 200 km of road, 32 bearings, 25 km horizon: median 6.2° to
  3.8°, bearings under 3° from 23% to 41%. Vista cell load 23 to 25 ms in its worker.

- THE ROAD NO LONGER GETS WORSE THE FURTHER YOU DRIVE. Wear is no longer a 300 km
  regional envelope with a maintained opening: the road is cut into 3-5 km wear bands
  that alternate fresh, lightly worn, middling, worn and abandoned (22/24/24/18/12%),
  never the same twice running, blended over 350 m, with a small patch noise on top. The
  first band is fresh. Poles and their wires alternate the same way on bands of their own
  (7-11 km) instead of decaying through each 300 km era. Surface districts draw from one
  fixed mix everywhere rather than a regional one.
- THE SHOULDER IS BACK. With the new desert palettes the verge, drawn at the sand's own
  luminance, had vanished. It is 1.6-2.3 m wide now (was 1.05-1.6), clearly paler and
  greyer than the sand (compacted fines), and fades into the ground only in its outer
  quarter; wear narrows and softens it far less.
- POIS HAVE CARS. Every roadside stop has a small field of shells to strip for parts
  (1-2; a scrapyard still 1-3), and the first two stops of a drive always have a car you
  can take among them. After that one stop in five has one (a scrapyard one in three):
  8 of the first 47 stops on seed `flick`.
- OTHER CARS' HEADLAMPS LIGHT THE ROAD FROM FAR OFF. The projection pool is filled with
  every car's headlamps before anyone's tail lamps, so a tail lamp's 6 m glow no longer
  costs an oncoming car its beam; ambient beams are at half strength (was a third) out to
  110 m and fade out by 170 m (was 60-130 m); and the band of light a headlamp lays on the
  asphalt towards the eye (`render/cloudshadow.ts`) shows on a DRY road too, broader and
  a little softer than on a wet one.
- NO MORE FLICKERING COLOURED WALLS ON DISTANT HOUSES. Everything a facade lays a few
  centimetres proud of its wall — a wall in a second colour, frames, sills, hoods — is
  drawn as a second group of the house's geometry with a polygon offset, and so is the
  glass; at 1-3 cm the depth buffer could not separate them from the wall from a couple of
  hundred metres, and the red wall of the Bauhaus house blinked in and out.
- THE PLANE IS REBUILT as a Cessna 172 to its real dimensions (8.28 m long, 11.0 m span,
  2.72 m high; 1.63 m wing chord tapering to 1.12 m past 2.55 m with 1°44′ of dihedral and
  a NACA 2412 section; 3.43 m tailplane; 2.53 m track and 1.63 m wheelbase; 1.91 m
  propeller). The fuselage is one smooth loft through a table of real sections; windows,
  door and cowl seams, the cheat line, fin stripes, hinge lines, nose inlets and the
  registration are painted by the material's own shader in the aeroplane's frame instead
  of being laid on as plates, which is what tore the old skin. Swept fin with a dorsal
  fillet, streamlined struts, spring-steel legs into proper speed fairings, an oleo nose
  leg with torque links, a twisted two-blade propeller with painted tips, nav lights and a
  beacon.
- THE POSTCARD'S WORDS: "вот адрес" is gone; after the invitation it now reads
  "приезжай или прилетай - главное, береги себя. Любим тебя и ждём в любое время!" The
  printed POST CARD legend is gone and the postmark carries a date, so ПОЧТА appears once,
  on the stamp.
- THE FOV WIDENING IS FULL AT 160 km/h, not 130, so the top of most cars' range still
  widens the view. Still +5 degrees in total.
- TYRE ROAR KEEPS GROWING PAST 108 km/h, up to +3 dB (hiss +4.5 dB) at 151 km/h
  (`tyreTopMps` in `config/audio.json`). Nothing below 108 km/h changes.
- THE MENU IGNORES THE SYSTEM'S REDUCED-MOTION SETTING. Windows' "animation effects"
  switch was freezing the title screen for players who never asked for that.
- SAVE DRIVE KEEPS THE PAUSE SHEET OPEN. The row turns green and reads `Saved` for
  1.6 s (`Save failed` in red if the write is refused), then reads `Save drive` again;
  the game no longer resumes on a save. Saving is the `PauseHooks.saveDrive` hook now,
  and `PauseAction` is only `resume` or `quit`.
- THE HEAT HAZE ON `Voyage` RISES. The title's shimmer used to breathe in place; it is
  now a stitched 160 px noise tile climbing through the word every 2.4 s, so hot-air
  bands travel up the letters.
- THE TITLE SCREEN'S MAIN BUTTON CATCHES THE LIGHT: a pale sheen crosses it every
  4.5 s. It moves by transform only.
- NO `loading <car>` TOAST. A car model streaming in no longer announces itself; the
  `could not load <car>` toast on a failed load stays.

- THE HELD ITEM'S USE ACTIONS ALL TURN THE WAY A HAND DOES. The fluid can tipped its spout
  *up* at the player's face while pouring, and the medicine bottle walked its neck up past
  the right eye; both actions were signed for the generic carry pose's 45-degree frame
  rather than for the item — the pour's pitch and the bottle's tip both inverted — and the
  bottle was never squared to the view the way the torch, camera, watch and photograph are.
  The can now tips away over the reservoir (the stream lands at the centre of the view,
  0.63 m out), the bottle is squared before it tips so the neck comes down to mouth height
  with the capsules leaving it at the mouth and the uncorked cap going across the hand's
  side, and the postcard rests picture-square to the player instead of presenting its edge,
  its turn-over to the message and back reading as one card being turned in the hand
  (`src/render/held.ts`).

### Fixed

- FRANTIC VERGE PASSES WORK ON GRAVEL ROADS, AND ARE NOT STARTED WHEN THEY CANNOT BE WON.
  The loose-road departure brake (`edgeStability`) fired on any body past 1.6 m moving
  outward at 0.4 m/s — inside the lane, whose centre is 1.75 m — so on gravel, which is
  much of the road, every planned move outward was braked to walking pace as it began:
  the verge pass went out, dithered and came back, and crossings and racing lines easing
  out were braked the same way. A departure is now the body outside its own commanded
  line by `EDGE_STABILITY_OVERSHOOT_M`, never nearer than the old 1.6 m. And the verge is
  granted only for a pass the car can win (`vergePassWinnable`): the verge's bend speed
  and its cap clear the leader by the least gain, and the engine still pulls 0.6 m/s² at
  the leader's speed on this grade; otherwise the stall clock gave it up after three
  seconds out there.
- TRAFFIC PULLS AWAY UP A HILL. At walking pace the pedal was the speed error over the
  mode's band with a 0.2 floor, and through the engine model's part-throttle losses that
  is a few percent of the torque: on the 2110, 0.2 holds a 2.7% grade and 0.33 a 6.6%
  one. Reported from play as two cars at a mound on a climb rolling back, caught by the
  rollback brake, lurching, rolling back — until the stall rule had them reverse, and
  every failed escape a rung further back. Below 6 m/s the pedal is now at least the one
  that holds the grade and rolling resistance plus a pull of up to 1.2 m/s² toward the
  target, on the signed speed, through the car's own engine and gearing
  (`Vehicle.throttleForDriveForce`, `Drivetrain.throttleForWheelForce`); the recovery's
  reverse and pull-out use the same. And a car whose gears cannot pull yet — coming out
  of reverse, 0.36 s of shift on the Samara box — is held on the brake instead of
  released to roll back for it (`Vehicle.forwardDriveInterrupted`).
- AN ESCAPE ROUND A KNOWN PROP TAKES THE LINE THAT CLEARS IT, UNTIL IT IS PASSED. The
  escape held a line 3.2 m off the lane for 50 m whatever it had hit: on a narrow road a
  line past the asphalt, crawled along at walking pace by the departure rule, for fifty
  metres after a mound a few metres long. With the prop indexed the line is its radius,
  the body and the planner's margins away from it (`RECOVERY_CLEAR_MARGIN_M`), a rung
  wider per failed attempt, and it ends when the body is past the prop's far edge.
- A CROSSING GIVEN UP NEXT TO SOMETHING STOPPED IS NO LONGER BARRED FOR GOOD. The barrier
  after an abandoned crossing ran out only on road covered, and a car that gave way and
  pulled up behind a parked lorry covered none: the opposing lane stayed shut to it until
  the stall rule had it reverse out. It now lifts on road or seconds, whichever comes
  first (`CROSSING_RETRY_S` 3 s, racer 1.5 s); at road speed the distance still decides.
- A VERGE PASS IS NOT REVOKED BY SOMETHING BEYOND ITS END. The grant asked for five
  seconds of straight, prop-free verge on every step, so a bend or a prop coming into view
  at the far end revoked it with the car out beside the leader, where every line back is
  vetoed by the car alongside. Continuing now asks only for the road the pass still needs
  — what is left to pass at the current gain, plus the return (`SHOULDER_PASS_RETURN_M`)
  — never more than the entry figure.
- A CAR WITH ITS BUMPER ON A BOULDER NO LONGER STANDS ON THE THROTTLE INTO IT. At walking
  pace the planner judged a line round a still obstacle by its destination alone ("the
  wheels turn before the car rolls"), so a fat rock square in front read as a feasible
  line beside it: full pedal into the rock, the stall rule's gentle first rung backed
  the car under two metres — still inside that reach — and it went again until the
  ladder ran out. The escape now needs the turn to be possible: the body only grazing the
  obstacle's band (`STANDING_SHIFT_M`) plus what full lock buys over the road left
  (`s²/2R`, `STANDING_TURN_RADIUS_M`). Otherwise the corridor is infeasible, the car is
  held, and the recovery ladder backs it far enough to go round. Stopped cars keep the
  old answer. The `?apdebug` panel shows the manoeuvre and the rules holding speed and
  pedal.
- FRANTIC PASSES ON THE VERGE AGAIN. The racer's lift for a lane change (keyed on the
  line moving across the road) took the power away through the move out onto the verge,
  while the pass's gain clock (`SHOULDER_PASS_MIN_GAIN_MPS`, 3 s) was already running
  from the grant, with the car still tucked in at the leader's speed: the pass gave
  itself up every time and was barred for 200 m. A pass now keeps the slip lift only,
  and the gain clock starts once the car is out on its line or beside the car it passes
  (`SHOULDER_PASS_OUT_M`). Opposing-lane passes by frantic drivers get their power back
  the same way.
- The frantic stream share is back to 0.14 / 0.03 from a test value of 0.5 / 0.25.
- AN OPPOSING-QUEUE STANDOFF IS BROKEN AT ONCE, NOT AFTER THIRTY SECONDS. The
  coordinator's deadlock grant was inert while the head was "yielding" to the very car
  it was facing, so every standoff waited out `YIELD_PATIENCE_S` first. On a road with
  two lanes each way the grant now also needs the two heads to actually meet across the
  road (`DEADLOCK_WIDE_LATERAL_M`): two queues stopped in their own carriageways are not
  a standoff, and one of them was being sent reversing out of its queue.
- THE CROSSING GATE PRICES THE CAR IT CAN SEE. The oncoming gap was the nearest of the
  field, the lane probe and the caller's figure, but its closing speed always came from
  the field — another car's speed for a probe hit such as a parked trailer. The speed
  now comes from the same body as the gap.
- A middle pass keeps its line while it threads (`MIDDLE_PASS_KEEP_M`) instead of
  swapping with the search's choice when both are clear to the horizon.

- NO MID-DRIVE SHADER LINKS AT THE 20 KM MARKS, SIDETRACKS OR KNOCKED-DOWN PROPS. A
  headed 10-minute drive through a day found a 283 ms and a 237 ms frame before dawn,
  both programs linked in the draw: the artefacts' materials at the 40 km mark (262 ms
  on an M2 Pro), a sidetrack's decal (12 ms), a delineator's piece program, and a
  mapped double-sided caster's depth program. On ANGLE each is several times that.
  The artefacts, the distance sign and the sidetrack now have hidden boot anchors
  (`monumentProgramAnchor`, `sidetrackProgramAnchor`); the debris piece anchors receive
  shadows as the pieces do (the anchor compiled a variant no piece drew); and
  `waitForFrameShaders` compiles every plain shadow-depth shape (three sides, mesh and
  instanced, no map / map / alpha-tested), into the scene target — the depth samples
  were first compiled for the canvas, which no shadow pass uses. Depth materials now
  carry the source's map whether or not it tests alpha, as three's own do.
- `tools/look` TIER runs drive again: the stored preferences they wrote had no
  `gearboxMode`, which reads as manual, and the player's autopilot sat in neutral.
- NO FREEZES AT NIGHT FROM THE HEADLAMP SHADOW (`Renderer.compileForScenePass`,
  `compileShadowDepth`). Three links a shadow caster's depth program the first time a
  shadow pass draws it, and `compile` never touches those. A drive resumed at night has
  no sun pass, so the headlamp shadow linked each depth variant as it first came into
  the beam: on ANGLE a freeze of seconds (reported as 1.9-2.7 s keyboard input delays).
  Every caster's depth program is now compiled with its lit ones, under the loading
  cover and with every car model's anchors, the way the shadow pass will draw it: no
  fog (fog is in a depth program's key), the source's shadow side, alpha test and maps.
  Long-lived holder materials keep the programs linked. Checked on a night resume:
  two depth programs linked mid-drive in the first 40 s before, none in 90 s after.
- CAR WINDOWS CAST SHADOWS (`prepareMaterials`). The headlamps are low and level, and
  with the glass left out of the shadow pass they shone through the cars ahead, which
  lay on the road with see-through windows. A car's shadow is its silhouette now under
  the headlamps as under the sun.
- A LOADED CAR SITS LOWER INSTEAD OF GOING SOFT. `Vehicle.reloadSprings` re-derived
  each spring's free length and travel from the load, which cancelled the sag exactly
  (Rapier's force is rate × compression × live mass), so a 700 kg crate in the Oka left
  the ride height at 779 mm and only dropped the ride frequency (1.30 → 0.90 Hz) and
  damping (0.28 → 0.155). Roll in a fixed step steer grew 2.3×. The same edit moved
  the bump stop's knee into a frame its compression never reached, so loaded cars hit
  Rapier's rigid travel clamp instead of the rubber. Free length, travel, the stop's
  knee and its crush force now come from the kerb design once in `rebuild()`; only the
  rates and the sag follow the load. Oka +700 kg now sits 65 mm lower and rests on the
  stop, rolls -3.2° where it rolled -11.4°, and an empty car is bit-identical.
  `tools/cargo-load-bench.ts` checks sag = load / rate within the travel and no
  airborne time over two humps; `--legacy` reproduces the old failure. The bench shim
  (`tools/domshim.ts`) now paints enough canvas for the sticker atlas, so headless
  `new Vehicle` works again (`tools/tow-bench.ts` runs).

- THE COURIER'S FINISH STAYS ON THE COURIER. Under `?carstyle=unified` the turquoise rim
  shader turned up on the wheels of the Izh, the Oka and every car on the Soviet wheel
  pool. The courier finish walked the whole static model and recoloured in place every
  Standard material that counted as paint. On a solid-paint body that includes the
  pool wheels, whose atlas material (`__DEFAULT`) every car of that template shares,
  and the unified style is what made it Standard. Each model's program anchor builds
  a courier at load, so the wheels changed even when no courier was in sight.
  `applyCourierAppearance` now takes the instance's own paint clones.
- TRAFFIC NO LONGER VANISHES IN SIGHT BEHIND THE PLAYER. A density trim, a recycled
  receding car and a stuck car are all taken out no nearer than `UNSEEN_M` (500 m,
  the nearest a car is created). They used to go at 90 m, 200 m and 70 m whenever the
  player was moving. Measured over 150 s on autopilot: 63 removals, the nearest 500 m.
- THE WHEELS NO LONGER DROP FOR A FRAME EVERY KILOMETRE. The floating origin moved
  between the physics step and the next one, and Rapier rebuilds its scene-query tree
  only inside a step, so for one tick every suspension ray searched the tree in the old
  origin and found no road: every car drew its wheels at full droop and its springs
  pushed nothing. That was also what the old "invisible bump" was; skipping one tyre
  pass hid the impulse, not the cause, and is gone. The origin now moves after the
  controllers and immediately before `physics.step()`; `PhysicsWorld.rebase` carries a
  kinematic body's pending target across, so the player on foot does not stall a tick.
  `tools/long-drive-soak.ts` follows the same order.
- POLES STAND IN THE SAND, NOT ON IT. A pole's base was set on `Terrain.heightAt`, which
  the drawn tiles only chord, so 183 of 565 poles over the first 80 km showed more than
  5 cm of daylight under the footing (worst 24 cm). Poles now stand on `drawnGroundY`,
  10 cm under it (`POLE_SINK_M`), and every part a design draws down to y = 0 continues
  `POLE_ROOT_M` = 0.6 m into the ground, so a lean cannot lift a footing's edge clear.
  The rail pole's footing is a proper block (0.36 m tall, was 0.14), and the tubular
  monopole's base plate stands on a 0.3 m concrete plinth instead of on the sand.
  `PoleProvider` now takes the `RoadDistance`.
- THE SHOULDER NO LONGER STAYS GREY BESIDE SAND ON THE ROAD. Sand reaching the asphalt
  edge now carries over the shoulder's lip (`SHOULDER_LIP_SAND`), and a drift's reach
  into the lane buries the whole strip and its grit (full at 1 m, `SHOULDER_BURY_M`).
  This covers both the district's sand wedge and the director's tongues, on their own side.
- OTHER CARS' LIGHT ON THE ROAD NO LONGER SWITCHES ON AND OFF, AND THE TAIL GLOW IS BACK.
  The few car spotlights and road headlamp streaks went to the nearest lamps again every
  frame. When two cars changed order, one lost its light and the other got it at full
  strength in the same frame. On a night drive with standard traffic, pools of light
  switched at 20-120 m and streaks at 70-170 m. The driven car's own tail glow came after
  every other car's headlamps in the queue and never got a slot (0 of 5860 frames). A
  `FadingSlotPool` (`render/slotpool.ts`) now keeps each slot with its lamp. When a nearer
  car deserves the slot, the old lamp fades out over 0.75 s and the new one fades in. The
  driven car's lamps are pinned, tail glow included. Other cars, and the driven car's
  tail and reversing glow, project one merged beam per lamp pair. The driven car takes
  three of the standard rung's six slots and three other cars keep their headlamps lit.
  A streak only goes to a car whose lamps face the eye, so cars driving away no longer
  hold streaks while oncoming cars wait. Measured after the change: the tail glow is on
  in every frame, and other cars' beam gain moves at most 0.018 per frame. The one step
  left is a streak dropping when an oncoming car is beside the camera; the shader's aim
  term already draws it as nothing at that moment.
- NO FREEZE WHEN A NEW CAR MODEL FIRST APPEARS. A model's paint, glass and lamp lenses
  each linked their shader program on the car's first drawn frame, on the main thread —
  on Windows' ANGLE/D3D11 hundreds of milliseconds per program, reported as 400-840 ms
  of input delay from the first seconds of a drive while traffic brought models in. The
  warm-up meant to prevent it compiled against the canvas instead of the scene pass's
  render target (a different program, never drawn), never saw the lens materials a
  Vehicle makes for itself, and re-cloned every model met so far for each new one. Now
  `loadCarModel` resolves only once the model's PROGRAM ANCHOR — a never-drawn driven
  body with its wheels and every pool wheel set, its lenses, a wreck shell and a courier
  shell — is compiled for the live pass (`Renderer.compileForScenePass`); the boot
  compiles the anchors of models loaded before it. The anchors are kept, so a variant
  only traffic used no longer dies with the last despawned car and links again with the
  next. Measured in the dev build by counting programs linked inside `render()` while
  spawning seven models: GAZ-21 and Oka linked 2 and 3 before, none now (the Oka's 4 are
  compiled while it loads).
- NO FREEZE AT THE FIRST BROKEN PROP, LAKE, MIRAGE OR TRAILER. Each first drew a program
  variant the boot never compiled: a broken prop's piece is a plain mesh with the
  scatter's instanced material (`DebrisField` now holds one hidden piece per material);
  lake fringe, distant-mirage rings and tableau meshes gained instance colours on their
  first `setColorAt` (now created with the mesh); the mirage novelties' material and the
  trailer body existed nowhere at boot (each now keeps one hidden instance in the scene).
- NO MORE POCKED, CRAWLING SHADOWS ON SUNLIT HOUSE WALLS. Facade skin — siding boards,
  frames, panels, stonework — is closed boxes whose back face lies in the wall, and the
  sun's shadow pass draws back faces, so the shadow map held the wall's own depth
  wherever skin covered it: acne a 7 cm texel deep beside every board and under every
  panel, jittered per screen pixel by the PCF and stepped into hard blotches by the comic
  banding. Skin no deeper than 8 cm (`CASTING_SKIN_DEPTH`) is now its own mesh that
  casts nothing — its real shadow is under a texel wide — while hoods, sills, lintels and
  balconies still cast. Same light, same banding; checked on the starting house's siding.

## 0.20.0 — 2026-09-29

Two-wheel drive cars finally leave first gear on sand, a swapped engine brings its own gearing, rotting cars give up parts and cans, frantic drivers thread the traffic instead of parting it, and the desert night gets a little light, a little glitter and headlamps in the wet road.

### Added

- DASHBOARD SIZE in Settings › Gameplay: 75% to 140% of the authored dashboard, in 5%
  steps, 100% by default (`Settings.dashboardScale`). It multiplies the presentation's
  own scale, so it means the same on desktop and on a phone, and applies while you drag.
- ROTTING CARS CAN BE LOOTED. Every shell in a salvage field (`buildWrecks`,
  `world/poi.ts`) now carries salvage of its own, laid out once per POI and kept in
  `WorldState.wreckBonnet` / `wreckStorage`. A random subset of the five bonnet cells
  holds parts that fit the body class — an engine (rarely an import), a radiator, a
  different tank, an air filter, occasionally a turbocharger — all worn dusty/rusty
  (and the filter clogged) like every other salvage find. The boot holds cans, tools,
  a spray can, medicine and gum, and never a sticker or a courier envelope. Both ends
  open through the same F-mount interaction driven cars use, with the bonnet's cells
  validated by `bonnetAccepts`.

- THE DESERT IS NO LONGER ONE FLAT COLOUR. Every desert ground material (tiles, vista,
  its overlap ring, the shoulder) shares `applyDesertGround` in `world/terrainmesh.ts`:
  broad 288/96 m patches between a redder and a paler sand, pale dry crusts, crests of
  the wind relief a shade lighter and their troughs warmer, pebble fields where the
  ink stipple thickens and clean sand where it thins, and wind ripples 0.55 m apart
  near the eye, gone by 42 m and wherever they would alias. All noise is per vertex
  (the fragment stage gets one multiply and, close in, one sine), periodic in the cloud
  field's rebase pan so a rebase moves nothing, and fades to its mean past 700-1600 m.
- CONTACT SHADOWS UNDER EVERY PROP (`world/props/contactshadow.ts`): a soft warm-dark
  disc under cacti, rocks, trees and bushes, one instanced draw per chunk or tile, fading
  with the tile props.
- GROUND COVER: dry grass tufts, twiggy sage-green shrubs and spiky yucca-like
  rosettes (`groundCoverForms`), a decoration stream of its own (no existing
  prop moves), spread over the desert to 320 m from the road — a little thicker on the
  verge, not a hedge along it — and built only inside the physics radius. The car
  bursts through any of it in a puff of dust, like a tumbleweed, with a 12 N·s brush
  against its travel and no Rapier collider at all: `GroundCoverField`
  (`world/props/groundcover.ts`) keeps each chunk's props in a flat grid over its
  bounds and tests the car's footprint against the few cells under it once per fixed
  step. A burst prop stays gone for the session.
- THE SAND GLITTERS AT NIGHT. When the mirages are gone, a few grains in every square
  metre of desert near the eye wink cool white, pale gold or faint violet, each on its
  own slow beat and shifting as the camera moves, like mica (`GROUND_GLITTER_HOOK`,
  `advanceDesertGlitter` in `world/terrainmesh.ts`). It rises as the day goes, is gone
  by 45 m, and dims on wet sand, in dust and under cloud.
- ONCOMING HEADLAMPS SHINE IN THE WET ROAD FROM AFAR. Each lit headlamp of another car
  (up to six, nearest first) lays a band of light on the wet deck, from the ground under
  the lamp towards the eye, narrow at the lamp and widening in the road's own
  perspective (`addWetGlare`, `render/cloudshadow.ts`), seen as far as the lamp is. The
  glint used to be only the spotlights' own gloss, which fades out 60-130 m away for
  every car but the driven one and sat round the mirror point like a blob under the
  surface.

- THE ROAD HAS SHOULDERS, SO IT LIES IN THE DESERT RATHER THAN ON IT. A strip of verge
  either side (`RoadMeshProvider.buildShoulderSteps`, `SHOULDER_STYLE` in
  `world/roadmesh.ts`) runs from the asphalt's edge down onto the sand, laid on the
  tiles' own triangles (`tileGroundSampler`, `world/deserttiledata.ts`) and drawn in the
  desert's material, ending in the sand's exact colour with its last column tucked under
  it, so there is no seam. Its only texture is grit in the ground's ink
  (`DESERT_SHOULDER_MATERIAL`), thinning out into the plain sand. Each road type has its
  own: a pale dusty 1.35 m verge on asphalt, a narrower sandier one on cracked asphalt, a
  wide pale one on concrete, the grader's darker spoil on gravel; worn and sanded roads
  get less of it. It is never a dark band (the old painted verge read as shadow), and it
  has a LooseShoulder collider, so a wheel off the edge rolls onto the verge instead of
  sinking through it. About 3.4 ms more per 200 m chunk build, spread over its yields.

### Changed

- THE DESERT IS A RING OF FOURTEEN DESERTS, NOT A HUE SWEEP (`DESERTS`,
  `desertPaletteAt` in `world/gradient.ts`). The old cycle spent 400-1 000 km at an
  OKLab chroma of 2-3, one grey-mint moving under 1.5 ΔE per 100 km. Now, over the same
  2 000 km: the opening ochre `#d29459` (unchanged at s = 0), golden erg, gypsum,
  coral pink, Namib red, Mars rust, black lava, weathered basalt, lunar regolith,
  olivine, mint, pale sky, lavender and rose brick. Each holds for 60-100 km, then
  blends into the next along a quintic smootherstep mixed in OKLab. Every channel still
  moves at most one 8-bit step per 200 m chunk, and sand stays at least 45.7 RGB from
  rock. The palette is computed unquantised and packed once, so rock, gravel and spray
  no longer round twice. On the dark deserts the rock drop is capped at half the sand's
  lightness, so boulders on the black lava are blacker than the sand, not clamped to 0.
- EACH DESERT HAS A SECOND SAND (`DesertPalette.accent`), and the ground shader's
  broad 288/96 m patches now run between it and its reciprocal
  (`setDesertGroundArclength`, `uGroundAccent` in `world/terrainmesh.ts`) instead of a
  fixed redder/paler axis: ash drifts on the lava, butterscotch dust on Mars, mare dust
  on the Moon. On the ochre the new axis matches the old one within a few per cent, and
  the patch's luminance swing is held to ±10%.
- LAKES ON DARK GROUND ARE LIGHTER THAN THEIR SHORE (`waterPaletteAt`,
  `render/lakewater.ts`): wherever the sand leaves no room for water 0.21 darker, the
  water sits 0.21 lighter instead. Near-grey sands no longer push the water's hue.

- AUTOMATIC DRIVERS SEE TRAFFIC IN THE ROAD'S FRAME, NOT DOWN RAYS. Once a step one
  broad-phase query collects every dynamic body near the car — other cars, the
  player's, a parked car, a trailer, a standing piece of a broken prop — and places it
  on the road: at the foot of its perpendicular on the stretch the driver is about to
  drive, with its real collider's span along and across the road and its speed there
  (`Autopilot.collectRoadBodies`). "Is my lane occupied" is an interval test on that
  lateral (`laneProbe`). The chord rays it replaces cut across tight bends and read a car
  in the opposing lane as a stopped car in their own (20/54, 23/60 and 8/39 placements on
  seeds 1337, 545124 and 7), and stopped at the road surface over a blind crest, so a car
  behind it did not exist (55/60, 36/51, 51/60 missed); both are now 0, pinned by the new
  `tools/lane-sensor.ts`. The racer's own-lane field lookup and `probeReach` went with
  them. Over 24 four-minute runs on the real road: ego contacts 45 → 29, stream contacts
  211 → 177, summed longest stops 198 → 109 s, ego pace +5%, overtakes 200 → 188.
- THE GAME IS CALLED VOYAGE MIRAGE. Everything a player reads says so: the title screen,
  the page title, the rotate-your-device hint, the local launcher (`Start Voyage
  Mirage.bat`, `release/voyage-mirage.zip`). Storage keys keep their old names
  (`thebrodrive-saves`, `thebrodrive.resume`, the settings key), so every existing save
  and preference survives the rename.
- THE MENUS ARE REDRAWN AS ONE SYSTEM (`ui/menu.css`, split out of `hud.css`). One bundled
  type family — Barlow, drawn from highway-sign lettering, the condensed cut for titles,
  actions and figures and the regular cut for sentences — replaces the three system
  faces the old menu mixed, on a five-size scale. Every screen is one sheet docked right
  over the scene. The title puts the name top-left in the sky, where `Voyage` shimmers in
  a heat haze with a faint inverted copy above it and `Mirage` stands perfectly still;
  the front is at most three rows (Continue, New drive, Saved drives) and a first launch
  sees only New drive. Up/Down walk the rows, Escape steps back.
- SAVED DRIVES CAN BE TOLD APART. Each card leads with a kilometre post carrying the
  distance, then the car in its own paint colour, the in-game day and hour with a sun or
  moon glyph, the time played, and when it was saved (Today / Yesterday / 12 Sep). The
  summary is read from the stored snapshot (`summarizeDrive`, `SaveBackend.list()` now
  returns `SaveListing`), so saves written before this change show it too. Delete asks
  once, inside the card. The pause sheet shows the same card for the drive in progress.

- A HUNDRED ROADSIDE POLES. The pole line was three hand-made silhouettes, one per era,
  each with a lamp and one wire strung top to top. It is now a catalogue of one hundred
  plain line poles (`world/props/poledesigns.ts`) in fourteen families of real roadside
  construction: telegraph poles with glass on their arms, rural three-phase, bracket
  telephone poles, timber on a concrete stub, timber H-frames, rectangular, spun and
  octagonal concrete, concrete portals, double-circuit concrete, lattice masts, tubular
  steel, Oppenheimer telescoping steel and rail or I-beam poles. Variants step through
  arm counts, insulator layout and material (glass, porcelain, polymer, pins, posts,
  strings, spools), caps, braces and fittings, so no two designs of a family are the
  same pole. Every design is one vertex-coloured geometry in one comic-banded material
  (drawn with the dwellings' `DwellingBuilder`), casts a shadow, and carries its wires
  on its own insulators: every tie point is strung to the same one on the next pole, each
  wire surviving on its own `wireChance` roll, all of a chunk's wires one mesh. The era
  bands still set the material (timber, steel — was "lattice" — or concrete) every
  300 km; inside a band the line is rebuilt in SECTIONS of 8-25 km (`poleSections`,
  `world/props/poles.ts`), each of one design and never the one before it, so a 2 500 km
  drive meets about 150 sections. A worn pole leans as before and may have lost its arms
  and insulators (timber sooner than steel and concrete); anomalies read their placement
  off the design. `?prop-gallery` shows all hundred behind the desert forms.
- NO TWO-LEGGED POLES. The timber H-frame and the concrete portal are out of the pole
  catalogue (`FAMILIES`, `world/props/poledesigns.ts`), so neither is ever spawned: the
  line is ninety designs in twelve families, every one standing on a single support.
- FRANTIC KEEPS ITS SPEED INTO TRAFFIC. A racer now brakes onto a moving car on the
  CLOSING speed (`leader + sqrt(2·a·room)`) instead of planning the stop as if the car
  stood still, so it no longer starts braking twice as far back and rolls up the rest of
  the way; it reads the car in its own lane from the traffic field as well as its probe,
  so a slow car behind a crest is not lost and found again at 15 m; and a verge pass that
  ends with the body still on the verge is brought home at speed for
  `SHOULDER_PASS_RETURN_M` instead of being declared off the road and braked to walking
  pace (`vehicle/autopilot.ts`). On `tools/traffic-road.ts --ego frantic`, twelve seeds of
  five minutes in a VAZ-2105: 66 km/h mean against 61, a median 5 km/h given up before a
  pull-out against 8, 4.2 s behind a caught car against 5.5, 115 s following against 129;
  ego contacts 2.5 a run against 1.8, inside the spread one changed step makes on a seed.
- `tools/traffic-road.ts` loads every car model before it starts, so a seed gives the
  same run every time (spawns used to land on whichever step a file read finished), and
  prints a `catching:` line: how long the racer sat behind each car it caught and how
  much speed it gave up before it pulled out.
- EVERY STRETCH OF ROAD HAS POLES. The era band in four that had none is gone
  (`poleEraForBand`, `world/gradient.ts`), and a section is a whole number of its own
  spacings long, so the widest gap between two poles anywhere is 116 m — under the
  shortest 'poleAnomaly' span, which is why every such event now alters the line. Fallen
  and leaning poles stay: the 'down' anomaly and the lean of wear.
- EVERY AUTOMATIC DRIVER RUNS ON DIPPED BEAM, AND NOBODY TOUCHES YOUR MAIN BEAM. The
  autopilot used to dip a player's main beam for oncoming cars and put it back after
  (`syncPlayerHighBeam`), and switched its lamps off by day. Traffic and every autopilot
  now simply hold dipped beam day and night (`updateAutomaticHeadlights`), and what the
  player selects with the switch is what the car shows. `Autopilot.setLightingConditions`
  is `setOncomingGap` (the crossing gate still needs it), and the daylight plumbing that
  only fed the lamps — `RoadTraffic.setDaylightFactor`, `setLowBeamsAlwaysOn` — is gone.
- POIS ARE 7.7 KM APART, AND IT IS NO LONGER A SETTING. The POI Distance slider is gone
  from Settings › Gameplay, with its `Settings.poiSpacingMetres` field and its bounds;
  the spacing is `POI_SPACING` (`world/poi.ts`), read from `config/gameplay.json`, and
  the couriers slot onto the same spacing. A saved spacing is dropped on load.
- NIGHT IS VISIBLE. The moonlit fill floor (`NIGHT_FILL_INTENSITY`, `render/sky.ts`) is
  2.8. The 9-12 of 255 once recorded for 1.2 did not survive a re-measure: from the
  chase camera at midnight in clear weather the sand either side of the car renders 2.4
  at 1.2, 3.4 at 1.6 and 6.4 at 2.8, which is the owner's "barely see anything without
  the headlamps" in numbers. At 2.8 the ground reads as ground and the dunes as shapes
  against the stars; day and twilight fills are photometric and untouched.
- THE NIGHT GLITTER CAN BE SEEN. `GLITTER_PEAK` (`world/terrainmesh.ts`) is 0.8, against
  the 0.05 the "finer glitter" cut left: measured in the game, the brightest glint of a
  frame now reaches 130-140 of 255 over sand at 6, where 0.05 (and 0.3) left nothing over
  60-100. The disc is a full pixel per screen axis instead of half, so the fragment that
  owns a grain lights in full while the pixel grid slides under it, and the eye-motion
  term in the wink's beat is a tenth of its old rate: at 20 m/s a grain used to be
  through its wink in 30-80 ms, two frames of one pixel, which the eye integrated into
  the sand. The glint fades between 55 and 90 m instead of 40 and 80. Still points, one
  grain per half square metre near the eye.
- THE DESERT IS CLEARER AND HOTTER. A quarter of the ten-minute weather slots now hold
  no episode at all (was a tenth), an episode fills 50-80% of its slot (was 55-85%), and
  a heat wave is the commonest kind (`CLEAR_SHARE`, `EPISODE_*`, `WEIGHTS`,
  `world/weather.ts`): about half of a drive is plain clear sky, where weather used to
  be present for nearly 60% of it, and rain and haboob together hold about 16% of the
  clock against 26%.
- THE RADIO IS ONE KEY. R steps station 1 → station 2 → off (`Radio.cycle`); the
  separate on/off and station keys (R and T) are gone.
- FRANTIC DRIVERS FIND THEIR OWN WAY, AND EVERYBODY ELSE DRIVES AS USUAL. Ambient
  traffic no longer moves over toward its verge for a frantic driver behind it or coming
  at it: that rule, its offsets and the autopilot's `setYieldOffset`/`yieldOverhang`
  plumbing are gone, and the stream holds its lane and its pace whatever is approaching.
  The frantic driver's way through the traffic is now the room it MEASURES from the
  traffic field — the near flank of every car of the queue and the real lateral of every
  car coming the other way — re-taken every step, and whether the line is legal is the
  corridor's own question: a line that only reaches over the crown is priced against the
  oncoming cars it could meet, and one that crosses it is the ordinary crossing, allowed
  only with the measured oncoming gap behind it and never taken deeper than the middle of
  the borrowed lane.
- A FRANTIC DRIVER'S WAY PAST A QUEUE IS NOW THREE LINES, NOT ONE. The pass on the verge
  is sized on the road's own graded shoulder instead of a flat 2.1 m (`shoulderWidthM` in
  `world/roadprofile.ts`, the same number the mesh draws the strip from): a highway's
  1.35 m crush grants 2.25 m of body edge where it granted 2.1, cracked asphalt's 1.05 m
  exactly the 1.95 m the pass needs, a concrete road's 1.6 m grants 2.5, and a gravel
  road's own spoil lets the pass happen there at all — with the prop-free verge, the
  straight stretch and the corridor's own price (which keeps the crown cheaper whenever
  it is open) unchanged.
- A FRANTIC DRIVER GIVES THE BORROWED LANE BACK IN THE GAP. A measured pass is sized
  "past this car and into the slot in front of it", but the search kept pricing the
  crossing cheaper than the queue for as long as the opposing lane stayed clear, so one
  borrow carried a racer past car after car. Now, once the car it was taken for is no
  longer in the way, the lane home is admissible and the gap in front leaves
  `WEAVE_HOME_HOLD_S` seconds of closing to the next car of the queue — and that car a
  further `WEAVE_HOME_HOLD_M` past the distance this driver goes out again, so the gap
  has to be a gap and not a hair — the racer takes its lane back and measures the next
  car from inside it: in and out of the gaps, instead of a second lane.
- A FRANTIC DRIVER SPOTS THE QUEUE BY CLOSING TIME AS WELL AS BY HEADWAY. The distance
  at which a held-up driver starts looking for its line is the longer of two following
  distances and `PASS_APPROACH_CLOSING_S` seconds of closing speed, so a car arriving on
  something twenty metres a second slower starts planning 127 m out (6 s of closing)
  instead of 86 — while a leader it closes on at four metres a second still starts at
  86, where there is no rush. It decides when the line is LOOKED for; when the wheel is
  turned is still timed on the move's own length.
- A FRANTIC DRIVER CAN BE DRIVING ANYTHING. Its car is drawn from the same model pool as
  every other driver's — a man in a hurry is a man in a hurry in whatever he owns — with
  a BMW M30 (`engine_bmw_m30`) fitted in bonnet cell 0 to give it the pace for its
  habits, and the strongest engine that physically fits when the body cannot take the M30
  (a lorry or a van). The rally Five's special place in the draw is gone; it is still in
  the pool like any other car.
- A SWAPPED ENGINE COMES WITH ITS OWN GEARING, SILENTLY. `matchGearbox`
  (`vehicle/drivetrain.ts`) keeps the body's ratios, shift time, efficiency and
  automatic flag — those are its driveline — and re-gears the final drive so top gear
  meets the new engine's power peak at the speed its power can hold against this body's
  rolling and air drag, scaled against the factory pairing so a stock car is unchanged
  (a 2105: 4.3 stock, 3.2 with the BMW M30, 2.37 with the Chevrolet 350).
- THE CAR GETS DIRTY FIVE TIMES MORE SLOWLY: `BODY_DIRT_TYRE_METRES_TO_FULL` is 120 km
  of tyre track, so the first visible crust takes about 7.5 km of sand.
- NIGHT IS A SHADE LESS BLACK, as if the eye had been out in it a while: the moonlit
  fill floor (`NIGHT_FILL_INTENSITY`, `render/sky.ts`) is 0.12, from 0.09. The dome,
  the stars and the lamps are unchanged.
- The tumbleweed's brush on the car is against its travel; it used to push it forward.
- GROUND COVER NOW COMES AND GOES ALONG THE ROAD, INSTEAD OF CARPETING EVERY METRE OF IT.
  `groundCoverDensity` (`world/props/groundcover.ts`) cuts the road's arclength into stretches
  of `COVER_STRETCH_MIN` 300 m to `COVER_STRETCH_MAX` 5 km — a 2.65 km mean, drawn as
  complementary pairs so a cycle is exactly `COVER_CYCLE` long and any chunk finds its own
  stretch by arithmetic instead of by walking the road from kilometre zero — and gives each
  one a level: `COVER_FULL_SHARE` 0.4 of the road keeps exactly today's field,
  `COVER_SPARSE_SHARE` 0.35 drops to `COVER_SPARSE_MIN`-`COVER_SPARSE_MAX` 0.1-0.35 of it,
  and the remaining quarter is bare sand. Each stretch ramps in over `COVER_RAMP_M` 100 m
  from the level of the one before it, so no boundary is a hard line and no bare stretch has
  anything in it past its ramp. The roadside scatter (`ScatterProvider.buildSteps`,
  `world/props/scatter.ts`) tests its occupancy roll again against
  `density × groundCoverDensity(s, seed)`, so a prop that survives a sparse stretch is one
  that was already there, in the place it stood — thinning only ever removes — and the car's
  own bursts (`GroundCoverField`) see exactly what was built. Measured by sampling the
  multiplier every metre: 39% full / 38% thinned / 23% bare over 200 km on seed 1337 and
  47 / 20 / 33 on seed 24601, both settling at 39-41 / 35-37 / 24 over 2,000 km, longest
  bare run 14.3 km.

### Fixed

- THE HANDBRAKE LOCKS THE WHEELS AND LETS THE SPRINGS BE. Pulled at speed, it used to be a
  12 m/s² brake shared over four wheels that never locked any of them: every tyre sat at
  its peak slip, a perfect ABS stop with full steering. And the moment the car was below
  0.12 m/s the parking hold pinned its WHOLE pose, nose still down from the stop: 1.52°
  nose-down against a free rest of 0.24°, front springs carrying 5.8 kN to the rear's 3.8,
  for as long as the handbrake stayed on — the car frozen in time. Now the cable holds
  every wheel still (`cableLocked`), so the car slides on locked tyres and steers like
  it, and the hold pins only where the car stands and which way it faces; the body rocks
  back on its springs and settles at its own rest pose. A locked wheel's force is the
  tyre's at zero spin, no longer read out of a wheel that is not turning, so the
  handbrake now also stops a car rolling back down 8-20° grades, which it never could
  (creep under 2 cm, held within 1.1 s); a car stopped on its handbrake on 20° holds.
- TRAFFIC BREAKS REFLECTOR POSTS AND CACTI TOO. Only the player's car was ever an
  impactor for breakable scenery (`DebrisField`), so a post the player snapped at
  walking pace was a solid wall to a traffic car at road speed: it stopped dead a bumper
  short of it, at 20 and at 41 km/h alike. Every car now strikes with its own swept box
  (`DebrisField.strike`); the same car breaks the post and drives on at 21 and 46 km/h.
- NO MORE SHADOWS CRAWLING OVER POLES. The comic banding quantises lit colour into hard
  steps, which on a round, smooth-shaded pole lands the step edges along the light's
  gradient — including the view-dependent reflection and the weathered vertex colour —
  so ragged dark patches moved over the body whenever the viewer did, worst on pale
  concrete. Poles keep the comic material with the light unbanded (`poleMaterial`).
- NO MORE STROBING INDICATORS ON THE FOUR-LANE ROAD. A driver with something standing in
  its lane swapped every fixed step between its lane and the line round the obstacle,
  the indicator flashing left, right, off at 60 Hz with it. Two feedback loops did it.
  The full manoeuvre rate and the freedom to leave the lane, granted to a driver with
  no way through, were read off the PREVIOUS step's plan, and the plan they produced
  is what decided whether there was a way through; the corridor is now searched the
  ordinary way first and again with the full manoeuvre only when that search finds no
  way through, in the same step. And a lane handed to the search because it could not
  stop in time was taken back the step it read stoppable again by a few decimetres,
  while braking behind another car kept it on that edge; it is now taken back only
  with `DETOUR_RELEASE_MARGIN_M` of stopping room to spare. On the real-road bench (four
  seeds, three minutes each, starting on a four-lane stretch) indicator changes fell
  from 2173 to 1135 and left/right reversals from 923 to 281. In the game on seed
  1337's four-lane stretch: 28 reversals in 45 s before, 3-8 after.
- AUTOMATIC DRIVERS GO ROUND A ROCK AT SPEED INSTEAD OF CREEPING PAST IT. Anything
  cleared by less than 0.6 m beyond the planning margin used to be passed at walking
  pace, and the planner put almost every line exactly on that margin, so every prop on
  the road was crept past at 13 km/h. The gap asked for past something standing still
  now grows with speed (0.3 m plus 0.025 m per m/s), each prop is planned round with
  that gap, and the car slows only to the speed the gap the road actually has supports.
  A lane-centre rock and a dirt pile are now passed at about 58 km/h, a trunk at the
  verge at 68 km/h. The bench's "littered road" (25 props a km, against 0.8 on the
  real road) is gone.
- THE HEAD OF A QUEUE AT A ROCK STOPS SHORT OF IT INSTEAD OF ROLLING ONTO IT. A driver
  with no way round yet (the oncoming lane busy, the verge too narrow) held a 13 km/h
  crawl to within 1.5 m of the rock and only then asked for zero, which half a pedal
  cannot deliver in that room, so it touched the rock and the cars behind began pulling
  out round it. The approach to anything standing still in the chosen corridor is now
  capped so the car can always stop 3 m short (`STILL_BLOCK_STANDOFF_M`), with a
  taper the proportional brake can actually track, ending at the hold speed so a car
  facing a rock it cannot pass still reads as stuck and backs out. A driver that loses
  its last line round a rock at speed may now use its full brake for it, not half. The
  real-road bench counts every touch of a scatter prop, by face and arrival speed
  (`nobody drives into the scenery`); over six seeds and eight minutes touches fell
  from 45 to 36 and the longest stop from 55 s to 24 s.
- TRAFFIC NO LONGER LAUNCHES ITSELF OFF STEEP GRADES. A car joining the stream was put
  down level on a 7-16% grade, touched the slope with the end of its own collider, was
  pinned there by the settle, and was thrown out of the road at 20-90 m/s the moment it
  pulled away. It is now put down on its wheels, pitched and rolled to the ground under
  them (`poseOnGround`); the real-road bench's ego is placed the same way.
- JUMPING NO LONGER PULLS THE HANDBRAKE. The handbrake and the jump share Space and the
  handbrake is a toggle, and the toggle listened on foot too: every jump flipped the
  lever of the next car the player sat in, so after an odd number of jumps in the desert
  the car sat on its parking hold with first gear in, the engine revving and the driven
  wheels standing still. The lever now moves only from the driver's seat
  (`InputReader.setDriving`, `core/input.ts`).
- ROAD JOINTS NO LONGER THROW THE CAR. A section of the corner sequence could be left
  short of the bearing it was drawn for — its transition was longer than the straight
  share its character left it — and the next section then started at the FULL drawn
  bearing, so the heading stepped at every such join. Measured over 300 km: on seed 1337
  105 of 141 switchback sections and 3 of 13 pan sections stepped, the worst by 45.6
  degrees; on seed 1, 34 of 46 switchback sections and 4 of 20 pan sections, the worst
  38.4 degrees — and its first one only 3.4 degrees, which was still a 3.5 cm deck step
  at the wheel tracks. That step is a kink twice over: a crease in the plan view, and,
  once `curvatureAt`'s 4 m difference sees it, a curvature spike that switched curve
  widening (0.7 m a side) and superelevation (its 8% cap) on and off inside one node — up
  to 26 cm of deck step at the widened edge, which is what launched cars where the sand
  drift lay. A section now always reaches its own bearing, and its ramp takes whatever
  length that angle needs at the drawn radius, bounded by the section itself (`turnAt`,
  `world/roadcurve.ts`). The drawn radius still holds wherever the ramp fits in the
  section; where it does not — 69 of 141 switchback sections — the corner comes out
  tighter, and the tightest the tightest character now produces is 111 m against its own
  110 m floor. `straightShare` is gone from `RoadCharacter`
  (`world/roadcharacter.ts`): with the angle no longer cut, how much of a section is held
  straight is what its own corners leave of it.
- MATERIAL JOINS NO LONGER STEP EITHER. `BUMP_AMP` is a step of arclength, so the deck's
  short-scale roughness changed by up to 3 cm between one sample and the next at every
  surface-district boundary — 17.6% of local slope against a 5% threshold in the samples.
  The amplitude is now feathered over 40 m either side of a join (`SURFACE_JOIN_BLEND_M`,
  `world/gradient.ts`); the colour still changes at the boundary, because a new course of
  bitumen is a visible thing. The deliberate roughness is untouched: potholes and the
  bump layer measure exactly as before. Sampled over 400 km a seed, 0.25 m at the wheel
  tracks: heading steps 38 to 0 (seed 1) and 107 to 0 (seed 1337), join steps 0, deck
  grade jumps over 3% per 0.5 m with the deliberate pothole layer taken out 10 to 0,
  local-slope anomalies over 5% 9 to 0, and the centreline's own 4 m crease worst 8.41%
  to 1.60%. `SPINE_FORMAT` is 7: the heading field integrates to different positions, so
  the cached spine and the world built from it are regenerated.
- THE FIRST LOAD IS NO LONGER DARKER. The sky's reflection probe is baked once and only
  ever scaled down afterwards, and it used to be baked from whatever sky the session
  started under: a new drive starts at 08:38 under a low sun, a reload later in the day
  under a high one. Everything the probe lights kept that start for the whole session;
  measured in game on the same noon view, the garage wall read 0.058 with a noon bake
  and 0.040 with a dawn one. The probe is now always baked from the noon sky
  (`ENVIRONMENT_BAKE_TIME`, `render/sky.ts`); a dawn-started session reads 0.057.
  Render scale was ruled out on the way: 1, 0.7 and 0.5 gave the same frame within 2%.
- THE GAME STARTS ON A 44.1 KHZ AUDIO DEVICE. The AudioContext reported 48 kHz while
  running at the device's 44.1 kHz, the reverb impulses built at the reported rate were
  refused by their ConvolverNodes, and boot failed with "failed to start". The context
  now runs at a named 48 kHz and the browser resamples to the device.
- GROUND COVER NO LONGER HOVERS IN THE SKY. Past 300 m the tiles drop their wheel-scale
  relief while a tuft keeps the full-relief height, so distant tufts floated a metre up
  and read as a swarm of dots over the dunes. The cover now shrinks away between 230
  and 290 m from the camera, in the vertex shader, as the tiles' own props already do.
- CLOUDS NO LONGER BREAK INTO SQUARES ON PHONES. The sky's cloud noise hashed its
  lattice with `fract(sin(x) * 43758.5)`, which needs an accurate `sin` for arguments in
  the tens of thousands; mobile GPUs reduce that range in low precision, so the hash
  banded along the lattice and the deck came apart into blocks. It is now an
  arithmetic hash (multiply and fract only), the same on every GPU.
- A TWO-WHEEL-DRIVE CAR CAN LEAVE FIRST GEAR ON SAND. At sand's rolling resistance of
  0.16 the driven axle of a rear-drive saloon on period tyres (about 0.12 of the car's
  weight on sand's mu) could not out-push it once the dig had faded, so every such car
  hit a wall at about 29 km/h in first on the cut — just under the speed where the
  automatic may take second — whatever engine it had. Sand is now 0.07, and the
  automatic judges its downshift on the faster of road and driven-wheel speed (a
  spinning wheel is no reason to drop a gear) and upshifts only 15% clear of the
  downshift point (`UP_SHIFT_HOLD_MARGIN`), so the speed a shift costs on sand cannot
  hand it straight back to first.
- LOOSE GROUND NO LONGER SOUNDS LIKE A CONCERT HALL. The recorded gravel roll was 12 dB
  over everything else a tyre makes (-18.5 LUFS against -30.4 on asphalt at 80 km/h,
  offline render): a dense, wide low-mid wash heard as a big room. It is now high-passed
  at 650 Hz, nearly centred on the car, and plays only on loose stone (`stones` in
  `SURFACE_VOICES`): gravel is +3.7 dB over asphalt coasting and 0.1 dB with the engine
  running. Sand, which has no stones, no longer plays it at all.
- SAND NO LONGER DRUMS ON THE FLOOR PAN. A slide on loose ground used the recorded
  squeal's gain for a synthetic scrabble and measured -7.3 LUFS on sand, louder than the
  engine at 80% throttle. It has its own level now (`SCRABBLE_GAIN`), a smaller low roar,
  and a per-surface band: sand is a fine high hiss 3 dB over its rolling sound, gravel a
  crunch of stones.

### Removed

- THE SEED FIELD AND SAVE CODES FROM THE MENUS. A new drive's world is always random;
  `?seed=<word or number>` in the URL pins it (the look tools use it). Paste-a-code on
  the title screen, Export Save Code and the seed readout with Copy on the pause screen
  are gone. The codec itself (`encodeSaveCode`/`decodeSaveCode`) stays: the save tools
  round-trip states through it. The decorative "FORM 12-A" is gone with the old sheet.

- THE STREET LAMPS ON THE POLES. The lamp heads, the lamp arms, their emissive material
  and the light markers they gave `LightBudget` are gone: the desert night is light
  enough now and every car carries its own. `ChunkContent.setLamps` takes only the night
  factor (the reflector posts are all that use it), and the streamer's lamp revision now
  moves on content that holds light-budget markers (`holdsLightSources`,
  `world/chunks.ts`) rather than on content that implements `setLamps` — every chunk used
  to have lamp poles, which is the only reason a building's lights were ever found.
- THE DERELICT POLES OF THE EMPTY BANDS. With no band left without a line, the lone
  snapped mast and stump that stood in for an anomaly there (`poleDerelictAt`) have
  nothing left to stand in for.
- THE STORM CELLS ON THE HORIZON. The towers a storm used to raise on the skyline, and
  the `cells` weather channel behind them, are gone: a storm is the halo, the closing
  deck, the wind, the rain and the wet road, and the distant sunlit towers added nothing
  to that but a question.

## 0.19.0 — 2026-09-28

### Added

- FIFTY DWELLINGS IN THE POI GALLERY, AND ONLY THE TOWERS KEPT BESIDE THEM. `?poi-gallery`
  now shows the standing tower, the fallen tower and the relay station, then fifty
  exterior-only houses from Europe, the Americas, Africa, the Middle East and Asia:
  an izba and its sagging ruin, a Soviet dacha and an abandoned barrack, a Tudor
  cottage, trulli, a pueblo, a tipi, a Queen Anne and its haunted twin, a Dust Bowl farm,
  a Quonset hut, an Airstream, a Djenné mud house, a Sana'a tower house, a minka, a
  tongkonan, a Futuro and the rest. None is taller than two storeys and none can be
  entered: doors and passages are painted panels, windows are the car glass tint
  (`TINTED_GLASS`, now shared with `carGlassMaterial`) and nothing stands behind them.
  No textures: form and vertex colour only, with abandoned houses faded, patchy and
  splashed with sand in the colour itself. Each house is two draws (one comic-banded
  body, one glass). The catalogue is `world/dwellings/`.
- TWENTY ODD MIRAGES JOIN THE PALMS, TREES, CACTI, CITY AND FLEET. Bowling pins the height
  of a house, a chess game left on the sand, rubber ducks trailing ducklings, a tea set,
  beach parasols, ice-cream cones, lighthouses, Dutch windmills, dice, roadworks cones,
  snowmen, hot-air balloons, matryoshkas, rockets, toadstools, moai, pencils, a domino
  run toppling, flamingos and garden gnomes. They are unlit solids with one baked light
  direction, in the city's pale palette, one to six instanced draws per encounter, and
  they fade off the asphalt exactly like the rest. The schedule now deals all 25 forms
  from one shuffled deck, so each run of 25 encounters shows each once.
- SPRAY PAINT: ANY CAR CAN BE ANY FACTORY COLOUR. Twelve spray cans, one per colour in the
  car palette (`vehicle/carpaint.ts` `CAR_PAINTS`, which the factory colours now come from
  too). Hold LMB on a car's body: six seconds lay a full coat, and a can holds 7.5 s. A new
  colour starts over whatever is visible, so half a coat shows as a blend and stays one if
  the can runs out. The respray is `CarState.paint` (`base`, `coat`, `cover`), reported by
  the `car_paint` delta and saved; dirt and scratches sit on top of it as before. Cans turn
  up about yards in the slot the wrench used to take, 45-100% full, and the dev item
  spawner has a chip per colour.
- THE TURBOCHARGER WORKS, AND IT CAN BE FOUND. Bolted into the bonnet's turbo cell it
  boosts whatever engine it sits on: nothing below 30% of the rev range, full boost from
  60%, in proportion to the pedal, with about a second of lag winding up
  (`TURBO_TORQUE_GAIN` 0.35 in `vehicle/drivetrain.ts`). Power, fuel burned and heat into
  the water rise with it. Measured in the game, a Samara 21099 from rest with the autopilot
  flat out: 79 km/h after 12 s stock, 101 km/h with the turbo. Breaker's yards stock one
  at 15-20% of stops.
- SIX IMPORTED ENGINES TO SWAP IN: BMW M30 3.0 six (132 kW), Ford Cologne 2.8i V6
  (118 kW), Rover 3.5 V8 (115.6 kW), Chevrolet 350 V8 (149 kW), BMW M10 2.0 tii four
  (96 kW) and Cosworth BDA 1.6 twin-cam (88 kW), beside the Nissan L28E six that was
  already in the catalogue. Each is its maker's published figures (`tools/reality.ts`
  checks them). None is factory-fitted: they stand on pallets at breaker's yards (25-30%
  of salvage and scrap stops), dry of oil, and fit any car.
- THE AIR FILTER. A fifth bonnet cell. The element clogs with the kilometres the engine
  breathes through it: 1800 km of clear desert air wears one out, and a dust storm puts
  up to two and a half times as much sand through it per kilometre (`vehicle/airfilter.ts`).
  Half-worn is invisible; at 85% the check-engine lamp lights and the engine is 5% down;
  at 100% it makes 70% of its power and keeps falling. No engine starts without one.
  Filters come new from forecourts (30%), shops (45%) and breaker's yards; roadside
  finds arrive with their own filter anywhere from fresh to overdue. Saves from before
  the filter get a new one fitted.

### Changed

- ONE RADIATOR, AND THE WATER IN IT IS WHAT MATTERS. The four radiator sizes, the
  fitment rule and its warnings are gone. The one core (9 L) is rated against the engine
  it cools with a margin of 1.8 (`RADIATOR_MARGIN`), so a full radiator holds any engine
  at its thermostat, climbs included. As the level falls the core loses effect
  (`waterCoolingEffect`): 15% of it by 60% full, which is felt only on a hard climb; more
  than half of it by 30%, where no real load can be held. Saves map every old radiator
  onto the new one.
- ONE TYRE, ONE GRIP: THE CLASSICS NO LONGER SPIN THEIR WHEELS ON DRY ASPHALT. A tyre
  used to have two coefficients — 0.95 sideways and 0.55 forwards on a Zhiguli —
  because the forward one was also doing the brakes' job of holding the car to its
  period 100-0 stop. Every full-throttle start therefore broke the rear wheels loose
  at 5-14 km/h and spun them in first. `SurfaceProps` now carries one `mu` (the old
  lateral column) for drive, braking and cornering alike, and each car has its own
  brakes, `CarModelDef.brakeDecelG`, sized to the period stop. Stopping distances sit
  within 2.2% of the period tests (before: up to 17% off); on dry asphalt the drums,
  not the tyres, are the limit, so a floored pedal no longer locks the wheels there,
  while gravel, sand, the wet and bald tyres still can. `longitudinalGripScale` is
  gone: it was the rally car's way round the same problem. Tyre temperature now
  moves drive and braking grip too, not only cornering.
- THE ENGINE TURNS WITH THE DRIVEN WHEELS. The crank used to follow road speed, so a
  spinning wheel kept getting full torque and the tachometer never showed it. It now
  follows the driven wheels: a tyre breaking loose revs the engine to its cut, which
  bounds the spin, and the engine note says so. The automatic still downshifts on
  road speed (a locked wheel is not a reason to drop to first) and upshifts on
  whichever is faster, never into a gear it would take straight back.
- SMOKE AND DUST MEAN A SLIDING TYRE. Spray and dark sand tracks used to start at 6%
  slip, below where a tyre makes its best thrust, so every hard launch smoked like a
  burnout. They now start past the peak of that surface's own force curve
  (`LONGITUDINAL_PEAK_U` × `optimalSlip`).
- THE WORLD'S STOPS ARE THE GALLERY'S FIFTY-THREE BUILDINGS, BESIDE THE ROAD AND OUT IN
  THE DESERT. Every roadside stop is now one of the three masts or fifty dwellings
  (`world/poistructures.ts`), and a second, sparser scatter stands 70–650 m out in the
  sand at a random bearing, clear of every pass of the road and of each other; couriers
  still stop only at the roadside. What a stop stands as and what it gives out are
  separate rolls, so fuel, shop goods, home stores, salvage and scrap come from as many
  stops as before, and because no building can be entered they are left in a yard in
  front of it. A salvage stop's wrecks stand beside the house, never in it. Stops use
  fresh loot indices, so an old save finds them stocked. The starter homestead is
  unchanged.
- FIVE MIRAGES REDONE. The chess game is a Staunton set — pawn, rook with a crenellated
  parapet, knight, mitred bishop, coroneted queen, king with a cross — standing on a
  level walnut board in one of three real positions, with the taken pieces lined up
  beside it. The dice are rounded, with round pips, and come to rest on any of their six
  faces, in throws of two or three. The matryoshkas are one smooth turned outline with
  the face, hair, scarf and apron painted on it along clean ovals, a rose on the apron,
  and some sets opened, the eldest standing in two halves with the bare wood inside.
  The teapot's handle and spout and the cups' handles are single swept tubes sunk into
  the body, and the flamingo's neck is one tapering S from the breast to a head with a
  bent, black-tipped beak.
- THE MIRAGE FLEET IS SHIPS. The one stretched hull is replaced by three vessels built at
  their own size and scaled only uniformly (`render/mirage-ships.ts`): a 36 m side
  trawler with its wheelhouse, raked funnel, gallows and stern A-frame; a 64 m freighter
  with a black hull, three-deck white accommodation aft, bridge wings, hatches and
  derricks; and a 42 m barque with a gunport band, bowsprit, shrouds, square yards and
  ragged topsails. Each hull is a smooth loft with sheer, flare, a raked stem and an
  overhanging stern, painted in bottom, boot-top, topside and sheer-strake bands with
  rust runs under the rail. Wrecks now lie within 35° of the road so they are seen from
  the side, list about the keel instead of standing bow-up, sit a fifth or more deep in
  the sand, and are drawn at 0.95 of the tableau's alpha instead of 0.74.
- MIRAGES TAKE TURNS. The distant vessels and the roadside tableaus no longer keep two
  private cadences (a tableau every 3–8 km, a vessel once in ~36 km, free to land inside
  a fleet): both read one schedule (`render/mirage-schedule.ts`) that deals all 35
  apparitions — ten vessels, twenty-five tableaus — from one seeded, shuffled deck, 3–8 km
  apart, one at a time. Every round of 35 shows each once, the same one never comes twice
  running, and a vessel now turns up about every 19 km instead of 36, a tableau about
  every 7.5 km instead of 5.5.
- ITEMS IN A TRUNK OR UNDER A BONNET TURN TO FACE YOU. Each miniature keeps its display
  pose but now aims it at the eye every frame, so the contents read the same from
  behind the car, beside it or leaning over it.
- FRANTIC DRIVES LIKE A RACING DRIVER. It no longer has a personality speed cap: its pace
  is the car's and the road's. It plans a least-curvature racing line over the next six
  seconds of road (`vehicle/racingline.ts`) — outside, apex, outside — across the whole
  asphalt where it can see the far half is clear and nobody could arrive there in
  time, inside its own lane where it cannot; it plans its corner speeds on that line's
  radius, corners at 0.72 of the tyres, brakes late at 0.9 of them, balances the
  throttle against the cornering load and holds no more speed than it could stop in
  what it can see. Behind a car or in a pass it is the old driver with its lane and
  its indicators. On the playground circuit its laps went from 105.7/102.0 s to
  96.5/92.4 s, its mean from 95 to 104 km/h and its peak from 130 to 172 km/h, still
  on the asphalt and with no contact in traffic.
- FRANTIC RACES THROUGH TRAFFIC, NOT BY THE BOOK. It used to overtake by every rule of
  the road and size each pass on a dream: its crossing speed was `desired·(1 +
  0.25/passNerve)`, 276 km/h, so a pass it priced under a second took eleven and the
  oncoming car it had measured 107 m against arrived mid-pass. Now it sizes each pass
  on its own car (`sizePass`): power at the wheels less drag and grade, capped by grip,
  with the share of peak power measured on every full-throttle step, run forward
  against the whole queue from `TrafficField` until it is a car length ahead of the
  one it passes with a real slot in front. It goes the moment that fits, pulls out
  from where it would otherwise start braking, cuts back in close and re-measures the
  pass every step; a pass that stops fitting is abandoned (`crossingAbandoned`) — home
  at once, or dropped behind the car it was passing. The six-second sight and
  commitment rules, the 60 m retry and the indicators are gone for it; grip, brakes,
  the swept and abeam vetoes and the emergency reflex stay. For every mode, a body
  already over the centre line keeps a legal line there (a revoked permission used to
  leave the planner nothing and it stopped dead beside the car it was passing, head-on
  at 545124), and a return from the oncoming lane is a brisk swerve below 29 km/h,
  blending into the ordinary lane change by 58 km/h. On `traffic-road.ts --ego
  frantic` over six seeds: time under 2 s from a head-on 63 s → 12–26 s, ego contacts
  6 → 0–2, pace 35 → 41–48 km/h, overtakes 30 → 32–46.
- `tools/traffic-road.ts` takes `--ego sleeper|hurried|frantic` and `--ego-log`, and
  judges the ego as a racer: overtakes made and suffered, longest follow and why,
  time over the centre line, head-on time-to-contact, sideslip and excursions, with
  the ego's history up to the closest head-on, the furthest excursion and the worst
  slide under `--trace`.

### Fixed

- A TRACE OF HAZE NO LONGER TURNS THE SKYLINE INTO PAPER. Mgla, rain and a storm deck
  were the scene's `FogExp2`, 1 - exp(-(d·k)²): spotless near, total a little further
  on. The haze a windy or hot day carries (0.14-0.23) put 81 % fog on the land at 3 km
  and 99 % at 5 km, so under a blue sky every mesa came out one flat pale cut-out, the
  same pixel as the plain before it. They are now visibilities added to the clear air's
  exponential extinction (full haze 2.5 km, rain 4 km, storm deck 8 km), and the
  squared fog carries only a haboob, which is a wall. Measured on High at km 250 in
  `wind`: near ground Y 0.27, far plain 0.33, a mesa 0.37 — graded, not one flat step.
  The land's fog colour also climbs the dome's own gradient with the sight line's
  elevation (`airSky` in `render/airfog.ts`) instead of stopping at the h = 0 band, so
  fully fogged land now vanishes into the sky behind it rather than standing in front
  of it as a brighter silhouette: in `wind` a far mesa reads Y 0.34 under a sky of 0.37.
  At dawn and dusk it also takes the dome's anti-solar darkening (`airSun`): facing away
  from a setting sun, fully fogged land is 12,8,47 under a low sky of 51,36,106, and
  keeps the warmer 58,42,50 only off to the sides, where the dome's own pull is weak.

- NOTHING IN A MIRAGE STANDS IN ANYTHING ELSE. Each odd form is tested as an oriented
  box against everything already placed and moved or dropped when it would enter it, and
  a group — a board, a row of dolls, a domino snake — stands whole or not at all. Palms,
  trees and cacti now keep their measured reach apart as the wrecked fleet already did,
  and city blocks each take a lot of their own. A toppled pin, a die on its side or a
  lying lid no longer shows an open bottom.
- THE ADOBE RUIN, THE NUBIAN HOUSE, THE LEBANESE HOUSE AND THE IZBA RUIN NO LONGER
  FLICKER. Their walls, painted bands and re-roofed slabs shared planes with each other;
  each is now one solid or stands clear.
- NOTHING BEHIND THE WHEEL AUTOSAVES ANY MORE: THE SLOT KEEPS THE DRIVE AS IT WAS AT
  ENTRY. A dent booked its own save the moment it was recorded, so a fatal crash was
  written before the death sequence began and the reload put the player back into the
  wreck with nothing left to do about it. The headlights and the rest of what changes
  at the wheel now ride along with the next exit. The page-hide save is on foot
  only for the same reason: Quit and F5 both hide the page, and saving there would write
  a wrecked car over the drive the player reloads to get back. The cost is that a phone
  that sleeps mid-drive resumes at the point where the player got in.
- THE DRIVE NO LONGER HITCHES EVERY 200 M. Each road chunk was built twice on the main
  thread — once without colliders, then again synchronously when the car came within
  the physics radius — a 35–50 ms frame each time. Road chunks are now built with their
  colliders from the start and never rebuilt in place. The vista's ground and mesa
  normals are computed straight over typed arrays (4 → 1.1 ms and 2 → 0.4 ms), and a
  new traffic model compiles only its own materials, one clone per frame, instead of
  the whole scene (20 ms). Measured on one seed at hurried pace: main-thread tasks
  over 16 ms went from five to none, the worst left is a 10 ms vista rebuild.
- THE GAZ-21 HOLDS ITS LANE UNDER THE AUTOPILOT. Its body answers the wheel about twice
  as slowly as a Zhiguli's, and a lane hold that corrected only where the car was, not
  where it was heading, fed that lag back as a weave it never settled out of: sleeper
  crossed its line 32 times a kilometre with 0.37 m RMS. The hold now leads its error
  by 0.4 s of lateral velocity; the same drive is 0.9 crossings a kilometre and
  0.064 m, and every other car holds as well or better.

### Removed

- THE OLD KIT-BUILT STOPS. The gas station, the kit houses, the wreck yard and the
  container stops are gone from the world and from the code; the towers and the starter
  homestead are all that is still built from the kit.
- BODY DENTS ARE GONE. Damage the game cannot do well is worse than none: 20 of the 21
  catalogue bodies are 1,900–20,000 triangles with edges of 22–95 cm at the 90th
  percentile, so a vertex dent drew a wedge through a Zhiguli's grille or a rubbery bowl
  in a door, and repeated blows to one corner stopped deepening after the second and
  spread across the bonnet instead. The whole system goes — the dent record in car
  state, the `car_body_dent` delta, the time-sliced CPU deformation pass, the paint's
  dent marks and the car lab's dent buttons. Impacts still scratch the paint. A save
  that carries `dents` loads the car straight.
- THE WRENCH. It had no action of its own. A save that carries one loads without it.
- DIESEL. The fuel, its cans, the mis-fuelling mixture and both diesel engines (the OM615
  and the OM366, left over from removed bodies) are gone. There is one fuel. A save with
  diesel in a tank keeps the litres as petrol; diesel cans and diesel engines are dropped.

## 0.18.0 — 2026-09-15

### Added

- THE VARIETY DIRECTOR: THE VIEW'S CADENCE IS A THING NOW, NOT AN EMERGENT PROPERTY OF
  ELEVEN GENERATORS THAT NEVER MET. Measured end to end, the only thing that changed
  inside three kilometres of this road was a POI sign: surfaces turn over every 6.2 km,
  monuments ring at exactly 20, mirages average 43, and the horizon — the largest part of
  the screen — held still for fifty kilometres at a time. Adding more generators with more
  private cadences is how that was built, so the schedule is its own module.
  `src/world/director.ts` is three CHANNELS, one per depth the eye actually reads — the
  horizon, the verge rushing past, the surface under the wheels — each a lattice of fixed
  windows with one event per window, jittered inside it, never repeating the kind before
  it. The window guarantees the cadence and the jitter keeps the guarantee from sounding
  like the monument bell. The floor is arithmetic rather than hope: the surface channel
  alone fires every 1500 m with its centre inside the middle 40% of its window, so no two
  events can be further apart than 2100 m, and the other two channels only narrow it.
  `tools/variety-timeline.ts` measures the real distribution and fails on the bound —
  across four seeds and 400 km the median gap is 0.76 km, the 95th percentile 1.64 km and
  the worst 2.03 km. Every kind is a pure function of seed and arclength, so a chunk that
  unloads and rebuilds schedules itself identically.
- THE ROAD RUNS THROUGH CUTTINGS AND ALONG EMBANKMENTS NOW, AND THE HORIZON HAS A
  SILHOUETTE. Three of the director's horizon events — a prism cut, a bank, a belt of
  rock shelves — and the one thing they all avoid is the thing that made them hard: NOT
  ONE OF THEM MOVES THE ROAD. The spine's elevation is the reference that traffic, the
  autopilot, the poles, the POIs and the ribbon itself are all built from, so a cut is the
  GROUND BESIDE the road climbing to 3-7 m over 27-31 m of lateral and falling back into
  the open desert by 62 m, and an embankment is the mirror. The asphalt edge does not move
  by so much as a millimetre (measured: 0.0000 m) and the first four metres of shoulder
  keep their old ground exactly, so the 3.1 m poles, the 3.5 m verge and the birds sitting
  on it stand on what they stood on. The landform rides in the terrain's DETAIL layer
  rather than its base field, and that was decided by measurement, not taste: the field
  lattice's rings are 8.3 m apart at 25 m out and 12 m from 43 m, so a 7 m crest chorded
  across them misses its own surface by half a metre, while the detail layer is resampled
  at 2.67 m. An outcrop belt is the same mechanism pulled the other way — the rock
  threshold drops locally and the shelves crowd the roadside instead of sitting out in the
  open: 101 belts over 400 km across four seeds, every one of them standing rock at least
  1.8 m up.
- CLOUDS NOW CAST SHADOWS ON THE DESERT, AND SOMETHING IS ALWAYS HAPPENING ON THE SKYLINE.
  The largest surface on screen was lit identically for fifty kilometres at a time, and
  the fix is one shared shader injection on the ground materials — two octaves of wrapped
  value noise in world space, multiplying the outgoing light before fog and tone mapping.
  It chains onto whatever `onBeforeCompile` the material already carries (the comic stack
  on the terrain and the vista, the ground-spotlight stack on the road), is idempotent
  through a `WeakSet`, and costs nothing at night or on the cheap graphics tier, where the
  second octave is dropped. The lattice is exactly periodic and the uniform carries the
  origin reduced modulo that period, so a patch does not jump when the floating origin
  rebases — and it drifts on the render loop's own `frameDt` rather than wall-clock, so a
  paused game's clouds stop. Measured: 31% of the ground in shade, a mean shaded run of
  509 m, 85 s for a patch to pass, darkening up to 32%, and a 10-90% PENUMBRA of 170 m
  median against a floor of 100 m that the tool enforces. That last number is the one the
  first version got wrong: its edge crossed in 75 m, which on a 400 m patch reads as a
  painted grey blob rather than as weather, so the edge band was widened from 0.20 of the
  field to 0.40 about the same centre — coverage and the deep end unchanged, the
  transition a little over twice as long — and the detail octave slowed and quieted so
  the outline is irregular without being scalloped. THE FIELD IS EVALUATED PER VERTEX,
  and that is not an optimisation but the fix for the only real regression this release
  has: the first version hashed per fragment, and on a standard-tier desktop that cost
  34 ms of GPU a frame — 87 frames a second to 36, measured by turning it off with a
  temporary switch. Confirmed fixed on the same machine at the same spot: 51.64 ms and
  35.6 frames a second before, 5.76 ms and 120 after, which is the panel's own refresh
  rate and indistinguishable from the effect being absent. The arithmetic said one
  millisecond, and the arithmetic was not
  wrong about the noise; it was wrong about the shader, which already carries twelve
  light slots, the comic stack and eight shadow taps, and spilled its registers the
  moment a sampler's worth of temporaries were added to it. So the noise moved up a
  stage and the fragment keeps one multiply by an interpolated float — which is exact
  rather than approximate, because a patch is 420 m across, its penumbra is 170 m, and
  the meshes under it are metre-scale. At night the vertex stage skips the field
  entirely. `tools/sky-variety.ts` now fails if the hashing ever moves back down: the
  cost of this effect is a property of the picture, and it is worth a check that
  remembers why. And where the director schedules a `'weather'` event, something far off
  is doing something: a virga shaft that stops 300 m above the ground, a 1.6 km dust wall
  coloured from the region's own palette, or a leaning
  smoke column, 600-1800 m off the road on the event's side. The tool caught a real bug
  here rather than in the desert: the dissolve that keeps a phenomenon from being reached
  assumed something 600 m off the road at one arclength stays 600 m from the road, and the
  road turns back — the measured worst approach is 477 m, so phenomena were dissolving
  while the player drove past looking straight at them.
- THE SHOULDER HAS THINGS ON IT: REFLECTOR POSTS, DIRT TRACKS AND POLES THAT HAVE BEEN
  THROUGH SOMETHING. Reflector posts run in 0.4-1.2 km stretches, 1.2 m outside the paint,
  stations chained at 40-60 m gaps from the run's own start so the chunk holding the middle
  of a run agrees with the chunk that held its beginning; the chip is an emissive material
  driven on the same dusk ramp the lamps use, not a point light, because the light budget
  is finite. A post is also SOLID now, and comes apart: it carries a cuboid collider inside
  the physics window and only there, so a 40-60 m spacing puts eight to twenty-four of them
  in the world against the hundreds the scatter carries over the same kilometre — and it is
  registered with the debris field as breakable, so clipping one at ninety takes the post to
  pieces rather than stopping two tonnes dead. That is why the blade and its reflector are
  two material groups of ONE geometry: `BreakableProp` blanks one instance, and two meshes
  would have left a glowing chip hanging in the air at knee height, at night, which is
  exactly when the run matters. Measured in the running game: three posts down the shoulder
  in five seconds at 90 km/h, each costing about 5 km/h — a knock you feel, not a wall —
  and a post already down is not rebuilt from a save. A dirt track leaves the shoulder for
  60-150 m of desert with a graded strip and two ruts at a 1.6 m gauge, integrated in the
  road frame so that never returning to the asphalt is structural rather than measured,
  laid on `drawnGroundY` with a 3 cm lift and the decal recipe the tyre tracks already use.
  And the poles occasionally have something wrong: a mast down in the sand with its span
  gone slack, a tarp lashed round one, a nest on the crossarm, a transformer can bolted on
  — an override INSIDE the existing pole pipeline, so no pole moves and no index shifts. An
  era band with no poles
  at all (about one in four) has nothing to override, and the first version simply showed
  nothing there, which would have made a quarter of the verge channel's pole events
  invisible: it now leaves a derelict instead — a mast of the neighbouring era's pattern
  down in the sand with a snapped stump at its butt and a second stump 40 m on. Six
  thousand kilometres of census: 602 pole events, 602 of them visible.
- THE ASPHALT REMEMBERS THINGS: PATCHING, RUBBER, PAINT THAT CHANGES ITS MIND, AND SAND
  REACHING ACROSS A LANE. Bitumen repairs (irregular blobs, crack-following fills, squared
  cut-and-fill), rubber (a lock-up pair in a wheel path, a turn-around arc, a burnout
  scar — measured: 83-100% of the ink in wheel paths, none on the shoulder), markings that
  change over a stretch (double solid, no paint at all, an edge rumble line) and sand
  tongues that spike across a lane from the windward shoulder rather than creeping evenly
  in from the edge. All four are painted into the ribbon's existing per-vertex colour
  pipeline and strictly additive: across 31 917 rows of road outside every event the vertex
  colours are identical to the bit. The marking change moves a hard edge rather than
  fading opacity — paint ends, it does not dissolve — and the tool measures that the
  boundary happens inside 96 m, which a 40 m fade could not do. The ribbon's vertex count,
  column layout and index buffer are untouched, because the road collider is indexed from
  the same rows and that is the one regression here that would have been silent.

### Changed

- BIRDS SIT ON THE SHOULDER, NOT ON THE ROAD. Perching on the asphalt was a decision
  made when the road was one fixed narrow ribbon and the only surface whose height was
  known at an arbitrary point was the road's own — a flock scattered from the crown
  outwards, which is neither what a roadside bird does nor what a driver wants in his
  lane. The offset is measured OUTWARD FROM THE EDGE now, 0.7 to 2.4 m of clear verge at
  whatever width the road has at that arclength, so a flock strung across a widening
  keeps its clearance from the paint instead of drifting onto it; the band stops short of
  the 3.1 m poles and of the 6.1 m desert scatter, so nobody stands inside anything. The
  side is still the group's own coin, the take-off is unchanged — away from the car, and
  now that is away from the road as well. `tools/bird-perch.ts` checks the band it landed
  on rather than the asphalt it used to: across four seeds, 42 standing sightings, none
  off the verge and none hovering.

### Fixed

- WEATHER NO LONGER STANDS OVER THE ROAD. Reported from play as a yellow wall above the
  asphalt, and it was the side edge of a 1.6 km haboob front with the camera inside it.
  Three numbers met: the front is faced from the bearing it becomes clear on, so its span
  runs ACROSS the road — at the minimum 600 m lateral the across-component is 0.83, which
  on 800 m of half width reaches 664 m, past the carriageway and out the other side — the
  proximity dissolve measured the ANCHOR rather than the sheets, so a camera a few metres
  from a wall read 600 m of clearance and stayed at full opacity, and the census in
  `tools/sky-variety.ts` measured that same anchor, which is why the class was never
  caught. The dissolve now resolves the camera offset onto the span axis and measures the
  nearest point of the footprint; the facing is chosen on clearance measured along the
  road over the whole reach the fade keeps a phenomenon visible across, with the authored
  bearing kept only as a tie-break; and what still does not fit the room the road leaves
  is drawn smaller rather than drawn across the asphalt. Measured over 1600 km and four
  seeds: nearest footprint-to-road distance was 2 m, now 371 m against a 320 m floor. It
  is also cheaper — a full-screen transparent sheet at full opacity was pure overdraw.
- THE AUTOPILOT NOW STEERS, BRAKES AND PRICES THE SAME MANOEUVRE. Four separate
  disagreements between the line the car took and the numbers it reasoned with, each
  measured before it was touched. "May not cross the crown" was a price of Infinity
  rather than a permission, and a feasible corridor beats any price, so a forbidden
  crossing won and put the commanded line 8.75 m out on the far shoulder; the rear
  safety check removed the unsafe lane's exact centre from the candidates while the
  0.25 m lattice still offered every line beside it, so a driver at 17 m/s planned to
  move in front of a car closing at 35 m/s; a latched detour could keep a line with a
  static prop 25 m down it while the speed plan used the metrics of the clear line the
  search had just proposed instead; and the emergency reflex took its distance from
  the nearest of every probe and its closing rate from a tracker fed by all of them,
  so a leader 10 m ahead in the lane being left hid a body closing at 40 m/s in the
  lane actually occupied, and the pedal never went past half. Permission is now a hard
  constraint applied to every candidate and to the whole path toward it, admissibility
  is reported separately from feasibility, the executable line is evaluated by the same
  solver that searched, and each reflex pairs a gap with that same target's own speed.
- ONE SET OF TYRES CANNOT BRAKE AND CORNER AT ONCE, AND THE GRAVEL BOUND WAS THE PROOF.
  Frantic's loose-surface pace was held at 0.7 of the surface's grip ratio because that
  is the fraction it was measured running off the road at — while braking at full pedal
  INSIDE a gravel bend — so every straight metre of a loose district paid for a mistake
  that only happens in a corner, and the three characters became three fractions of one
  low number (frantic 63 km/h against sleeper 55). The pedal owes that debt now: the
  share of the cornering budget the car is already using, from its own yaw rate against
  the tyres' capacity rather than against the reserved plan, is share the ordinary brake
  does not get. Frantic spends the whole ratio again — 89 km/h against sleeper's 55 on
  the same district, with 1.62 m of worst lateral inside a 2.90 m half width — and the
  brakes that exist to prevent a departure keep their full pedal.
- A CAR THAT HAS BRAKED FOR A ROCK FROM 34 m NO LONGER ARRIVES AT IT DOING 5 m/s. The
  plan believed the 4.0 m/s² its capped pedal was supposed to deliver and the car
  delivered 2.46, because the estimate was nominal grip and nominal load; hazards were
  also only collected over a reach sized on that same optimistic figure, so the rock
  came into view 49 m out when stopping needed 51. Sensing reach, brake lead and the
  target curve now all size on `Vehicle.measuredBrakeDecel` — the authority a floored
  pedal actually had on the last step, over the low-passed wheel loads and each wheel's
  own surface. And a prop the bumper is already against stops being invisible: the nose
  scan counted only dynamic bodies, so the planner reported a clear road and applied
  throttle into a boulder it was touching. Measured on the boxed-in bench: was one
  contact at 4.14 m/s, now none, with 2.59 m of clearance to a 1.2 m rock.
- TRAFFIC KEEPS ITS OWN CLOCK, ITS OWN GROUND AND ITS OWN LANES. Ambient drivers decide
  at 45 Hz inside a 60 Hz simulation, and the scheduler handed each driver the whole
  accumulator while keeping part of it, so ten seconds of physics delivered 14.96 s of
  controller time and every timer, distance and closing rate derived from it ran fast:
  now 9700 calls with 4.4e-13 s of accumulated error. A car was kept alive 850 m ahead
  while road collision reaches 400-600 m, so support is checked every step against the
  body's own radius and one step of travel. The neighbour field turned a car 1 m behind
  into one 1.3 m ahead by subtracting a half length, which removed it from the rear
  safety query exactly when the bodies overlapped; overlap is now zero and visible to
  both queries. Reverse-yield and spawn separation both compared nominal lane indices,
  which go stale through a taper: a spawn landed 26.4 m in front of a live car doing
  21 m/s in the same physical lane, which then braked fully for 22 m and hit it. Both
  now use measured lateral overlap, and a spawn ahead must clear the follower's own
  stopping distance.
- Skip the forward point-light loop body only for an exactly black light uniform.
  All light slots, ranges, shadows, MSAA and resolution remain unchanged; the shared
  shader installation also covers comic ground, loaded vehicles and prop galleries.
  On a fixed 1.80 Mpx blessing scene on M2 Pro, paired browser measurements reduced
  median draw-and-GPU-completion time from 12.6-13.0 ms to 10.3 ms in daylight.
  Night timings overlapped; no universal FPS multiplier is claimed. Day, dusk and
  visibly lit night/torch comparisons changed at most 19 scene colour components
  out of 7.2 million by one byte; the final post-process differed by at most two.
- Road projection now evaluates only squared XZ distance during its search, leaving
  the final road frame and the search order/precision unchanged. In-browser 10,000
  hinted projections took 16.2-16.5 ms instead of 66.9-68.3 ms. `spine-verify` checks
  exact equivalence with the old full-sample search, including ties, candidate order,
  checkpoint boundaries and hintless queries: 2,102 probes per seed on 1337 and 42.
  Vista ground normalisation also avoids general-purpose `hypot` rescaling for its
  bounded interpolated unit normals; update frequency and geometry are unchanged.
- The frame report no longer charges zero-tick frames for a simulation tick. Every
  section includes absent frames in its mean and p95, including frames before that
  section first appears. A controlled 120 FPS / 60 Hz window now reports 1 ms of
  simulation per rendered frame for 2 ms ticks, rather than 2 ms. GPU duration and
  presentation interval are still shown, but their different averaging windows no
  longer produce an unsupported bottleneck or spare-time verdict.
- THE BLESSING RUNG SAT ON THE WRONG SIDE OF A MEASURED CLIFF, AND THAT IS WHY THE FASTEST
  MACHINE RAN SLOWEST. A machine that held 120 frames a second on `standard` fell to 22-26
  on `blessing`, with the profiler reporting idle CPU, an idle machine, and a frame that
  was simply waiting — and every theory that fit the settings (pixels, supersampling, MSAA,
  the horizon) died against the next measurement. The cost is the LIT-FRAGMENT shader, and
  it is not linear in the number of lights: hiding the light slots outright took the same
  scene from 78 ms of GPU to 4, and stepping the slot count one configuration at a time
  gave 11 slots 6.5 ms, 13 slots 7.5, 15 slots 10.0, 19 slots 17.9, 25-26 slots 53-78 — at
  2 megapixels, on an M2 Pro. The rung asked for 18 spots and 8 points and so sat past the
  edge, where each further light costs several milliseconds instead of a fifth of one;
  `standard`'s twelve sat just under it. Spots are also the dearer half — twelve spots
  alone cost 13.2 ms where twelve points cost 6.0 — so the cut came out of the spots:
  `blessing` is now 8 spots and 6 points, which keeps four cars' beams and every lamp pool
  the rung had, and measured 8.9 ms in the running game. Everything else the rung was
  chosen for — the supersampling, the 25 km horizon, the deep sky — is untouched. On a
  discrete desktop GPU the old figure was affordable and this is a small loss; on Apple
  silicon it was the difference between driving and not.

## 0.17.0 — 2026-09-15

### Added

- SHARPNESS IS A CONTROL NOW, AND IT IS SPELLED IN PIXELS. The ladder owns the pixel
  budget, which was the right fix for a display percentage that meant nothing — but a
  level is three points and a machine is not three machines: on a 4K television they are
  1.44, 3.69 and 12.96 megapixels, and the only thing between them was a GPU
  measurement the player could neither see nor overrule. Worse, that measurement is an
  `EXT_disjoint_timer_query_webgl2` query, so on a browser without it — Safari, most
  Android WebViews — the scale never moved at all and three levels were the whole of the
  choice. `Sharpness` is a fraction of the DISPLAY's own pixels, both directions, quoted
  as the resolution it costs ("2560x1440, 3.69 Mpx") rather than as a percentage of
  something unstated. Up is the case the ladder could not express: supersampling used to
  arrive only with a 25 km vista and eighteen headlamps attached. `Auto` is the old
  behaviour and stays the default; naming a number pins it, because a fixed resolution
  that still drifts is not a fixed resolution. The offered row is derived from the
  display — the bound is the top level's ceiling, the most this game ever draws on
  purpose, and on a 4K television it makes 125% and 150% the same picture, so the second
  button is not shown. `tools/graphics-tiers.ts` checks that: no offered choice may cost
  no more than the one before it.
- THE DETAIL LEVEL SAYS WHO PICKED IT, AND THE GAME CAN BE ASKED TO PICK AGAIN. A
  measured verdict and a chosen preference were the same bare string, and the only
  record of who set it was that stored preferences existed at all — so one unlucky
  measurement (a cold shader cache, a busy machine, a throttling battery) was permanent,
  with no way back but clearing browser storage. The source is stored, and the row's own
  head reads it out in the player's words: `not picked yet` is the one state a launch may
  measure over, `phone default` is a phone's authored level, `picked by the game` is this
  machine's own verdict, `picked by you` is never overruled. `Let the game pick` restarts
  the game, because the timing needs the loading screen — thirty discarded frames and up
  to twenty seconds of settling, with nobody driving. A phone is not offered it: its
  level is the floor and the only direction a measurement could move it is the heat that
  level exists to refuse.
- FIELD OF VIEW, 50 to 85 DEGREES. The projection is Hor+ — the vertical angle is fixed
  and the window decides the horizontal one — so the resting 65 was the only number the
  game ever chose about how wide the world looks, and an ultrawide window was already
  showing more of it. The bounds are the projection's: at 16:9 the frame edge is
  stretched 2.28x at the authored 65, 1.69x at 50 and 3.65x at 85, and past that the
  outer frame is a fisheye. The speed widening is five degrees RELATIVE to the resting
  view now rather than an absolute 70 — an absolute ceiling would have meant fourteen
  degrees of widening at 56 and none at all at 85 — and the ten-power binoculars and the
  chase arm's elevation coupling both follow the setting.
- THE INSTRUMENT FACES SAY WHO IS DRIVING. Black is the player's own car; the autopilot
  paints them its mode — `sleeper` cream, `hurried` chartreuse, `frantic` crimson. The
  mode is worth the whole face rather than a lamp because the modes differ by roughly
  half the cornering speed, and a driver about to take the wheel back needs to know
  which one he is interrupting before he goes looking for an indicator. The ink travels
  with the face: a near-white needle on cream is not a needle, so the tick, needle and
  track colours are custom properties the mode class rewrites together.

### Removed

- THE INK SLIDER. The drawn outline is part of the authored landscape look, not a
  preference with two defensible answers, and it sat in a pane that has enough to say.

### Changed

- THE DISPLAY CONTROLS ARE NAMED AFTER WHAT THEY DO. `Graphics: Phone / Desktop /
  Workstation` asked the player to classify his own computer and then guess which class
  he was in — reasonable when the level WAS "what can this machine afford", and wrong
  now that the launch measures that and `Sharpness` owns the pixels. It is `Detail: Low
  / Medium / High`, and what it still owns is how much WORLD there is: the horizon and
  its fog, the sun's shadow pass, the shaded light slots, the star depth. Its hint is
  still generated from the tier table and no longer quotes megapixels, because two rows
  naming one number is how the old menu came to promise a horizon change on resume while
  a light change silently waited for the next load. `MSAA` is `Smooth Edges` — the
  initialism explained nothing to anyone who did not already know it.

## 0.16.1 — 2026-09-15

### Fixed

- A CAR THAT DOES NOT GET ROUND AN OBSTACLE ON THE FIRST GO TRIES A BIGGER MANOEUVRE,
  NOT THE SAME ONE AGAIN. The escape from a wedge had exactly one shape — reverse 1.8 s
  at 0.85 lock, pull out at 0.85 the other way, hold a 3.2 m line — so a car that came
  back out still inside the blocked corridor drove into the same rock, backed out
  identically, and hit it again. The only state that grew across attempts was the
  give-up counter, and that decides WHEN TO STOP TRYING, never HOW TO TRY DIFFERENTLY —
  worse, it is reset to zero for exactly the blockages worth retrying (a prop the
  bumper touches, a wedge off the asphalt, a granted deadlock), which is the case that
  repeated one failed manoeuvre indefinitely. Attempts at the same place now climb
  three rungs: reverse 1.8 -> 5.4 s, lock 0.85 -> full, escape line 3.2 -> 5.9 m, and
  the clamp that held the line inside the asphalt — the same width the obstruction
  blocks — opens onto the shoulder by the same step. A longer reverse is watched while
  it runs rather than trusted to the one rear check it starts with: it ends where the
  room behind ends, and ends early if the car has selected reverse and is covering no
  ground, which is how scenery no ray reports — a fence, a bank, a pole — is found.
- THE MORNING AFTER A NIGHT OF DRIVING IS AS BRIGHT AS THE DAY BEFORE IT. Dynamic
  resolution could enter a state it could not leave, and at the bottom of its ladder
  the film grain is filtered away by the upscale, the ink outlines smear into a
  general darkening and the surfaces lose their texture — which reads as "not all the
  shaders applied" rather than as a lower resolution. The launch transient was fixed
  by settling the scale under the loading cover; the same trap was still open for
  every load change DURING a drive, and the day/night cycle is the largest one the
  game has. A night of lit lamps and beams walks the scale down, dawn switches the
  heat-mirage warp and its depth resolve back on, and recovery needed the frame to
  fall under 7 ms while a reduction only needed 11 — the band between the two is
  where a healthy frame on these machines lives, so the scale stayed where the night
  left it for the rest of the drive.
- THE CONTROLLER NOW MEASURES WHAT ITS OWN REDUCTIONS BUY. The ladder is geometric
  and climbs by the inverse of the step it descends by, so a rung it can afford is
  always reachable, and each rung change measures the frame at two pixel counts —
  which is the only honest way to know how much of a frame is fill and how much is
  not. That answers the other half: this game's frame is dominated by per-call work
  (cutting a phone's pixel budget by nearly three times moved the cost of submitting
  a frame by twenty per cent), so a stall, a driver compile or a burst of streamed
  variants used to be answered by halving the picture and arriving at the same
  duration. A reduction is now taken only where it is predicted to buy real time, and
  pixels measured to be free are handed back — a draw-call-bound frame holds full
  resolution instead of walking to the floor for nothing. `tools/adaptive-quality.ts`
  asks both questions against a modelled machine rather than against the constants.
- THE INK OUTLINES NO LONGER READ AN UNDEFINED DEPTH BUFFER AT NIGHT. The post pass
  samples scene depth in three places, not one: the heat-mirage warp, the sand veil,
  and the gate that decides which fragments may be outlined at all — the sky, stars
  and planets are excluded by sitting at the far plane. The multisampled depth
  resolve was switched off whenever the warp was off, on the assumption that nothing
  else read it, so every night on `standard` and `blessing` and the whole lifetime of
  `acceptable` handed that gate a texture three had just invalidated. The drawn look
  either vanished or spread into the sky, depending on what the driver left in
  memory. Depth is now resolved whenever anything in the pass reads it.

## 0.16.0 — 2026-09-15

### Added

- `tools/traffic-road.ts` MEASURES THE STREAM ON A REAL STRETCH OF THE REAL ROAD, WITH A
  CAR IN IT. It drives the shipped `RoadMeshProvider`, `TerrainMeshProvider` and
  `ScatterProvider` over a real seed's own districts, puts an EGO car — a real `Vehicle`
  under a real `Autopilot`, fed the same oncoming-distance the game feeds the player's —
  into the stream, and asks the questions a player asks: does a car hold its line, is the
  stream moving, is it more than one speed, does it hit things, does it jam, does it stay
  on the asphalt.
- IT REPLACES A BENCH WHOSE NUMBERS COULD NOT BE READ, and all three faults decided the
  answers. It laid its own asphalt — one flat ribbon tagged `Asphalt` edge to edge with
  nothing beyond it — so the sand shoulder had asphalt grip and going round a boulder was
  free, while cars that left the ribbon fell into the void and were thrown back out at
  315 km/h, scored as autopilot excursions. Its distance accumulated SIGNED arclength, so
  oncoming traffic subtracted from same-direction traffic and twenty minutes of stream
  came out as 14 car-km. And it counted direction reversals of the commanded line with a
  0.1 mm deadband, which answers "does this number ever go the other way" rather than
  "does the car wobble": measured against two controllers, one moved the line in 2.9 m
  lunges and scored 16 reversals/km while the other made 0.16 m corrections and scored
  226 — with LESS total line travel.
- WHAT IT MEASURES NOW. Weave is peak-to-peak excursion of the body against its own lane
  centre, counted only once the driver has been settled in that lane for 1.5 seconds, so
  the tail of a manoeuvre is not charged to lane keeping. Pace is each car's own mean over
  its life, so one stopped car cannot outvote a moving stream with sixty samples a second.
  A standstill under 2 km/h is reported separately from a queue crawl under 8, with the
  reason attached: what the driver was doing, what it saw, whether it had a corridor,
  whether it was allowed across the crown and how long it had been giving way. Contacts
  are logged individually with speed and lateral, which is what turns "the stream crashes"
  into "two opposing cars both left their lane and met". `--solo` runs the same stretch
  with no stream at all, so the difference between two runs is exactly what traffic adds.

- `/?road-lab`, A LABORATORY FOR THE ONE SURFACE YOU CANNOT GO AND LOOK AT. The road's
  detail lives at the 1-30 cm scale, its tile repeats every 24 m, and the stretch worth
  judging is usually minutes of driving away — so every question about how the asphalt
  reads was being answered from memory of a drive. The scene builds the REAL
  `RoadMeshProvider` and `TerrainMeshProvider`, the same two the chunk streamer drives,
  around any arclength, under the real `Renderer` and the real `Sky`, and gives the
  camera six presets: hood, chase, a close 7 m look, the kerb, a straight-down view with
  no grazing angle, and a landscape from the side. It is scriptable, so a capture can name
  the state it photographed: `&s=22800`, `&pick=worst|sand|paint|gravel|concrete`,
  `&view=top`, `&vc=0`, `&nm=0`, `&grid=1`, `&time=17.5`, and `window.__roadLab` exposes
  the same knobs plus `render(): dataURL`.
- THE THREE SWITCHES EXIST BECAUSE A SURFACE HAS THREE INDEPENDENT INPUTS, and an artefact
  can belong to any of them: the tiled map, the tangent-space normals baked from it, and
  the per-vertex weathering the mesh paints on top. Dropping the vertex colour leaves the
  flat lane albedo brightness-corrected exactly the way the mesh corrects it, so the switch
  is not also a brightness change and the comparison means something; dropping the normal
  map tells a map artefact from a shading one; and the 24 m grid draws the tile's real
  boundaries on the mat, which is the only way to see where the repeat falls — nobody can
  count 24 m of road off a still frame, and a repeat is the easiest artefact to mistake for
  wear.
- The five `pick` scans walk the real `roadConditionAt` over the whole road and answer with
  the strongest stretch for a property, which is what makes the lab useful without driving
  there: the worst asphalt, the most sand-covered, the most intact lane paint, gravel and
  concrete. Three bugs were found and fixed by using it before it was committed: the panel
  had no class and so no styles at all, the straight-down preset put the eye ahead of the
  target and looked along the road instead of down it, and handing `sky.update` an ABSOLUTE
  camera position put the eye 18 km outside the sky's own 3 km dome — the dome is
  re-centred on that point every frame and drawn `BackSide`, so the sky rendered as nothing.

### Changed

- A CAR IN THE NEXT LANE IS A BODY, NOT JUST A DIRECTION. The planner already refused to
  steer TOWARD a neighbour, but it judged the destination alone — and a line on the far
  side of that car is further from it than the lane the driver is in, so it read as
  moving away and was allowed. The result was the opposite of the rule: the search
  refused the occupied lane, walked outward, and settled on the sand BEYOND it, and the
  rate-limited line then dragged the body straight over the car it had just refused to
  touch. Measured on the side-by-side bench, a commanded line 7.0 m out with a
  neighbour at 4.35 m and 1.54 m between two bodies while level; now 2.68 m and the
  driver simply holds its lane. The test is the closest the body comes to that car
  anywhere on the way to the line, which is zero when it has to be driven through.
- IT APPLIES ONLY WHILE THE BODIES ACTUALLY OVERLAP ALONG THE ROAD. The abeam window
  reaches a car length or two either way on purpose, because "do not steer toward it"
  is right for a car in the next lane a few metres ahead as well as for one at the
  door; "do not steer THROUGH it" is not, and the wide version closed the shoulder at
  exactly the moment a queue needs it — the longest standstill on the real road went
  from 18 to 55 seconds and the crawl from 5% to 22%.
- A MANOEUVRE LATCH WHOSE THRESHOLDS BOTH FACE THE SAME WAY IS NOT HYSTERESIS. Leaving
  the lane took a blocker within 45 m; calling the manoeuvre finished took the lane
  clear for 40. A blocker between the two satisfies both at once, so the latch flipped
  on every single fixed step: measured on the overtake bench, eighty indicator changes
  in one manoeuvre and the commanded line buzzing between the lane and the crossing at
  60 Hz for 1.2 s, all of it while the car was still 45 m behind the one it meant to
  pass. Now six changes, and 26% less line travel per kilometre on the littered road.
- AN ESCAPE CHOOSES ITS SIDE WHEN IT STARTS, NOT WHEN IT ENDS. The recovery bias was
  set on the last tick of the pull-out, so for the whole reverse and the whole pull-out
  the commanded line was dragged back to the lane centre and the manoeuvre finished
  aimed at the prop it had just backed away from — with the entire offset still to
  cover at 0.5 m/s while already rolling towards it. Measured on the wedged-on-road
  bench: the first escape left the car 3.4 m short of a prop needing 2.8 m of line, it
  managed 2.1, wedged again, and only the second escape — which inherited the bias from
  the first — got round. Now one attempt, 157 m covered instead of 78.
- "MY BUMPER IS AGAINST IT" IS BODIES OVERLAPPING, NOT A DISTANCE ALONG THE ROAD. The
  one-second wedge confirmation read its distance from the scan that looks for props
  NEAR THE LINE, whose reach carries the avoidance margin — so a car easing round a rock
  on exactly the line that clears it was counted as leaning on it for the whole pass.
  Measured: a squeeze past with 6 cm of clearance at 1.0 m/s, sent into a second
  reversing manoeuvre one second later. Contact is now its own measurement, without the
  margin.
- WHAT THE FOUR ABOVE DID TO THE REAL ROAD, over six seeds, four minutes each: car-ticks
  spent closer than a safe gap fell from 17,854 to 1,201 and fell on every seed;
  contacts from 67 to 57; the worst standstill on seed 1337 from 129.8 s to 18.4 and its
  crawl from 27.9% to 4.3%, on 545124 from 44.9 s to 0.8 and 6.0% to 1.9%. Seeds 7 and
  20461 went the other way on jams (1.6 s to 15.9, 3.2 s to 18.2) while their contacts
  and near-misses improved; removing any ONE of the four makes seed 7's contacts worse,
  so that regression is an interaction and is written up in `autopilot_current.md` §15
  rather than tuned away.
- `tools/traffic-road.ts --trace` NOW PRINTS THE SIX SECONDS BEFORE EVERY CONTACT. A
  contact line says two cars touched; only the history says whether the driver tracked
  the other one all the way in and never lifted, never saw it at all, or was in a lane
  the other one then moved into — three different defects sharing no code. It is what
  identified the largest remaining one: `ln-1.4 -> ln-4.0` with `blk43 -> blk-` on a
  single step, a driver moving out to pass, and the car it was passing merging into the
  same lane five seconds later.
- THE OPPOSING LANE IS NOW THE LAST RESORT IT IS SUPPOSED TO BE, AND A BYPASS IS A
  CALCULATION RATHER THAN A CRAWL. Measured on the real road before this: 10.6% of all
  car-time was spent past the centreline, and every contact in the run was a pair of
  opposing cars that had each left their lane and met head-on, with the queues behind
  them standing for up to a minute. Six rules, each of which was a separate failure:
  - A second lane on the driver's own side makes the crown pointless, so it is refused
    outright: overtakes and detours both happen inside the driver's own carriageway when
    one exists. That second lane is now open to ANY driver whose own lane is blocked,
    not only to the one shopping for pace — and every lane that is a candidate is
    probed, because the first version of this change had drivers merging into traffic
    they had never looked at.
  - The crossing is timed at the speed it will really be driven. It used to be sized on
    the driver's INTENDED speed while the speed plan eased past the stopped thing at
    walking pace: a three-second commitment that took fifteen, with the oncoming car it
    had measured 150 m of room against arriving halfway through.
  - At an obstruction that blocks both lanes the room rule is symmetric and refused
    both drivers, so the road stopped. The tie is now broken by geometry both cars can
    measure alone — `oncomingGap - ownLaneBlock` is how far the other still has to come
    to the same thing — so the nearer one goes and the further one waits.
  - The rearward check on the opposing lane now asks whether anything is COMING, not
    merely whether anything is there. A stationary bumper twenty metres back is not a
    car overtaking into the gap, and while it counted as one two stopped queues locked
    each other out permanently: measured, 264 seconds of standstill with the way past
    open the whole time.
  - A manoeuvre on the wrong side of the road is no longer latched: it survives only
    while the gate still allows it, and once abandoned it is not retried for 60 m, or
    the gate's answer flickering turns into the indicator flickering.
  - Waiting for a gap is not being stuck. A driver held at an obstruction by oncoming
    traffic used to be read as wedged and started a two-point turn across the
    carriageway in front of the traffic it was waiting for — 8% of all car-time in
    recovery. The patience is bounded, so a wait that never ends still escalates.
- A CAR IN THE CORRIDOR IS A REASON TO SLOW DOWN, NEVER A REASON TO CONCLUDE THE ROAD IS
  CLOSED. Feasibility now counts only what cannot drive away (`CorridorObstacle.movable`).
  While a stopped car closed a corridor, every driver behind a stopped head found no way
  through, decided it was wedged, and began reversing — a queue turning itself into a
  pile of three-point turns.
- GOING ROUND A LOG IS SLOWING TO THE SPEED IT FITS AT, NOT CREEPING PAST AT 3.5 m/s.
  Shifting `Δ` metres sideways over `d` metres of road is two constant-lateral-acceleration
  arcs, so `v = d/2 · sqrt(a/Δ)` — enormous far out, closing smoothly as the car
  approaches, which is a driver lifting off. `a` is a SHARE of the cornering budget and
  the bend is planned on what is left, because one set of tyres cannot spend the whole
  budget twice: an obstruction on a downhill bend was otherwise gone round at exactly the
  speed that leaves the road. The braking for it uses the capped obstacle pedal, not the
  mode's full ceiling for a bend.
- EVERYBODY SEES THE LOG, NOT ONLY THE LANE IT IS LYING IN. Hazards are indexed in the
  road frame, so a driver in the clear lane already knows which car is going to have to
  come across; it now lifts off and lets it in. Only the clear lane yields, so two
  drivers cannot both wait for each other.
- AN ESCAPE MANOEUVRE STAYS ON THE ASPHALT. The recovery bias was clamped to 1.2 m past
  the paint, which on the real terrain is sand: the manoeuvre for getting unstuck drove
  cars into the thing that gets them stuck.
- A DRIVER'S CHARACTER IS A FRACTION OF THE ROAD'S OWN PACE, NOT A SPEED IN KM/H
  (`Autopilot.setPace`). On seed 1337 the surface holds the careful mode to 57 km/h and
  the hurried one to 75 whatever cap they are given, and the stream's three characters
  were capped at 58-70, 72-84 and 95-115 — so no cap ever bound, the cautious and the
  ordinary driver share a mode and drove at identical speeds, and the whole stream's
  pace spread was 10 km/h.
- MEASURED ON SEVEN SEEDS, four of them drawn at random after the work was done, against
  the same bench before the change. Contacts across the set fall from 101 between stream
  cars and 15 involving the ego to 58 and 7; the longest standstill improves on five of
  the seven, and the share of car-time below walking pace on five. Per seed, before to
  after: 1337 21+12 contacts, 59.9 s, 29.1% crawling to 12+2, 4.7 s, 4.6%; 7 6+1, 18.0 s,
  6.5% to 2+1, 1.7 s, 4.1%; 99 0+0, 6.5 s, 3.3% to 4+1, 4.5 s, 6.0%; 545124 53+0, 18.4 s,
  12.5% to 30+0, 21.0 s, 12.3%; 594920 7+0, 6.8 s, 5.2% to 8+2, 1.0 s, 2.2%; 759465 4+1,
  1.0 s, 1.9% to 2+1, 0.9 s, 3.6%; 247558 10+1, 15.9 s, 12.8% to 0+0, 1.0 s, 2.3%. Time
  spent past the centreline falls from 8.3/4.2/7.9% to 2.7/1.1/2.8% on the fixed seeds.
- Fixing the same three seeds over and over is how the first attempt at this work
  produced a change set that improved one seed and made two others worse; the seeds are
  drawn at random now.
- THE BENCH SPAWNED ITS OWN CAR INSIDE THE ROAD. It placed the ego at the height
  `Road.offsetPoint` returns — the spine — while the slab its wheels rest on is
  `roadSurfaceY`, which adds the crown, the camber and the surface's own bumps. Where
  that is higher, the car starts inside the mesh and Rapier pins it. On seed 545124 the
  ego sat on its own lane centre with a clear corridor and nothing in front of it for the
  whole four-minute run, and the stream piling up around a permanently stopped player was
  scored as thirty contacts and a jam. With the car spawned on the collider it drives:
  38 km/h over 2.5 km, 23 contacts, 6.0% of car-time crawling instead of 12.3%, and 23
  cars past the arclength instead of none. The ego's start is also moved off any indexed
  hazard, the way the stream validates its own spawns.
- WHAT IS LEFT, MEASURED: same-direction rear-ends while FOLLOWING. On seeds with no
  overtakes at all the stream still logs 20-30 contacts in four minutes, every one a pair
  four to five metres apart, both drivers in `follow`, at 27-40 km/h. It is pre-existing
  and seed-dependent — seed 790944 goes 34+5 contacts to 21+2 with this work, seed 559316
  goes 16+5 to 30+2 — and it is a different investigation from this one: the follow rule,
  the lead-speed estimate and the half-pedal cap on braking for something in the way.
  Across every seed measured the ego's own contacts fall from 27 to 14.
- KNOWN REGRESSIONS, all in `autopilot-bench.ts`'s synthetic multi-lane scenarios and all
  without contacts: an overtake now toggles its indicator 80 times where it toggled 6, and
  a driver passing a car in the next lane keeps 1.54 m of lateral gap where it kept 2.90.
  Both follow from the crown being closed on a wide road, which is the intended change;
  the clearance while level is the thing to fix next. `a car wedged against a prop on the
  road gets itself out` was already failing before this work.

- THE LOOSE-SURFACE SPEED LIMIT IS NOW A PROPERTY OF THE DRIVER, NOT OF THE ROAD. The
  table read 0.50 for gravel and 0.45 for rock, against longitudinal grip coefficients of
  0.72 and 0.89 — rock is BETTER than the cracked asphalt beside it (0.84), yet every
  driver was held at half its pace, and gravel districts are a quarter of this road. The
  stream's own measured pace was a median of 41 km/h with the speed caps allowing 58-115,
  which is the "traffic is slow" a player sees, and the factors were where it lived.
- Those two numbers were not wrong, they were MISFILED: 0.50 is the bound a FRANTIC driver
  was measured needing, arriving at a bend at 70 km/h, standing on the brake inside it,
  losing the front on the loose surface and running 1.2 m past the asphalt. That is a limit
  on one character's controller, and charging it to every character made the careful ones
  pay for the reckless one's tyres. It is now `ModeConfig.looseSurfacePace`: 1 for sleeper
  and hurried, which spend the surface's whole grip ratio, and 0.7 for frantic, which
  reproduces the measured 0.50 (0.72 x 0.7) and keeps the bound it earned.
- Ambient traffic has no frantic drivers in it at all — it draws sleeper and hurried only —
  so this is what sets the stream's pace on loose ground. Measured by
  `tools/autopilot-bench.ts`, which holds the property directly: "sleeper: respects
  loose-surface pace" goes from a mean/peak of 33/35 km/h to 46/49 km/h, with the same
  bench reporting no new failure anywhere and the one pre-existing failure unmoved.
- Sand and the loose verge are deliberately NOT part of that correction. Their grip ratio
  is 0.44 of asphalt's, but the cost of being wrong there is bogging rather than running
  wide, which is a stop and not a scare, so they stay below what their friction would
  allow (0.20 -> 0.30 for sand, 0.45 unchanged for the verge).
- Measured on the real road over 30 minutes of the stream driving itself: the median speed
  goes 41 -> 47 km/h, the 25th percentile 28 -> 36, commanded-line reversals in `follow`
  22.0 -> 18.9 per km, passes 58 -> 48 and impacts 8 -> 4. `tools/traffic-bench.ts` passes
  every check, including the two-lane/four-lane caps, the rotation and the rock deadlock.


- THE STREAM'S SIZE IS THE ROAD'S ANSWER NOW, NOT THE PLAYER'S. A two-lane road carries
  twelve cars and a four-lane one twenty-four, interpolated across the taper so nothing
  steps at a profile boundary, and the `Traffic` slider is gone from the pause menu with
  its `trafficCount` setting, its four `gameplay.json` keys and its `config.ts` fields. It
  used to be a player setting defaulting to OFF that only ever RAISED: a narrow road ran at
  the setting and a widened one ran up to a fixed ceiling of thirty. That asked the player
  a question they had no way to judge — how many cars a carriageway they have not seen yet
  should hold — and the honest answer is a property of the road, which already knows it.
- THE DENSITY ROTATES OVER THE WHOLE RANGE, A THIRD TO ALL OF IT. The live count is one
  draw in `[0.35 x cap, cap]`, re-rolled every 36-72 s, and the retained FRACTION is held
  between re-rolls so a widening fills smoothly rather than stepping. The floor used to be
  two thirds, which with a cap derived from the road left the stream within a couple of
  cars of the same number for hours, so the stream read as a conveyor. A fifth was tried
  next and measured too far the other way: on a narrow road that is two or three cars, and
  the player drove alone on it for minutes at a time. Measured at a third: 5-12 against a
  cap of 12, and 8-24 against 24.
- `tools/traffic-bench.ts` now holds the cap itself — twelve on two lanes, twenty-four on
  four, a target between a fifth of the cap and the cap, and a rotation that reaches both
  ends over a drive — instead of holding a slider's value. Its three checks that asserted
  against the old thirty-car ceiling are expressed against the cap, since a fixed nine-car
  floor was asserting the width of the road rather than where the stream sits on it.

- THE AUTOPILOT NO LONGER STANDS ON THE BRAKE FOR SOMETHING IN ITS WAY. Braking for an
  obstacle is capped at half pedal, whatever the mode's own ceiling is, because that
  ceiling is a personality — sleeper 0.55, hurried 0.8, frantic 1.0 — and spending it on a
  rock in the lane is what puts a car on the loose half of this road with locked fronts and
  no steering left. The brakes that exist to PREVENT a departure are deliberately not
  capped: the verge brake, the edge-stability brake, and the hold that keeps a waiting car
  from rolling backwards down a grade.
- THE PLAN IS PRICED AT WHAT THE CAPPED PEDAL CAN DELIVER, and that is not a refinement —
  without it the change is a regression. Measured: capping the pedal alone left a sleeper
  unchanged (its 4.0 m/s² plan is what half pedal gives anyway) and took a frantic driver
  from 16.9 to 108.4 commanded-line reversals per kilometre on a littered road, one
  direction change every 9 m, because its 7.2 m/s² plan was no longer a stop it could make.
  Obstacles are now priced with `min(the mode's plan, half the surface's braking + grade)`,
  so the plan asks to slow earlier and the car still stops where it planned to; frantic is
  back at 16.9 reversals/km. `tools/autopilot-bench.ts` asserts the cap directly: the worst
  pedal requested while avoiding something is 0.500 of 1.000 in both modes.
- KNOWN, AND CARRIED RATHER THAN HIDDEN: `tools/playground-lap.ts`'s "frantic at a parked
  car with the oncoming lane free" fails before and after this change, and the failure
  changed character — it was 2 impacts and 34.6 s stopped, it is now 0 impacts, 774 m of
  real progress, and a 1.6 m crossing of the centre line where the check allows 0.4 m. Both
  are failures; neither is a pass. It is left for play rather than tuned blind, since that
  scenario has been failing independently of this work and a third consecutive change to
  the same behaviour is likelier to be chasing the measurement than fixing the car.

- THE ROAD'S SURFACE WAS PIXEL ART, AND THE PIXELS WERE 7 CM SQUARES. `roadTextures` drew
  its wearing course by quantising the tile into 3-pixel cells and giving each cell one flat
  tone, with independent white noise added per pixel on top. At 2.3 cm a texel that stamps an
  axis-aligned 7 cm square on every stone, so the grain the eye reads is not aggregate at all:
  it is the 3x3 texel grid, and no filter can remove it because the squares ARE the signal.
  Measured by rendering one real `RoadMeshProvider` chunk with the real shared material
  and looking at it (now the permanent `/?road-lab`, since the shipped road is minutes of
  driving away and the whole question is what a surface looks like): "very conspicuous
  square/rectangular pixel blocks cover the asphalt, roughly 1/50 to 1/100 of a lane
  width near the camera… it looks strongly like procedural pixel noise, not natural
  asphalt".
- THE GRAIN IS NOW WRAPPING GRADIENT NOISE, TERRACED INTO THREE PLATEAUS. Four octaves
  (64/128/256/512 lattice cells, i.e. 37/18/9/4.6 cm) sum into one chip field; alternate
  octaves are transposed, which is a 90-degree rotation of the lattice and costs nothing, and
  four octaves sharing one axis is what puts a rectangle on a surface that has none. The field
  is then cut into binder / chip / pale quartz plateaus with narrow risers: the plateaus carry
  the tones, so the relief and the colour agree by construction, and their boundaries are
  iso-contours of smooth noise, so they are irregular and round where the old ones were square.
  The first replacement tried value noise alone, which is smooth but puts its features on
  lattice points, and that came back from the same render as "weakly rectangular blotches of
  plaster" — hence gradient noise.
- THE NORMAL MAP REPLACES THE BUMP MAP, and it is baked from the same height field the albedo
  is drawn from rather than from a second, unrelated one. `bumpMap` shades from screen-space
  derivatives of its own texture, which amplifies exactly what a tiled noise field should not
  advertise; the map is low-passed once before the normals are differenced, which turns stone
  risers into the rounded edges a stone actually has and drops the lattice out of the
  derivative.
- MOST OF THE TILE'S ENERGY MOVED TO ITS HIGH OCTAVES and its macro variation came down, in
  the other direction from the first pass: a real asphalt mat is a fairly uniform grey, and
  what varies across a road is the wheel tracks and the dust, which are geometry and vertex
  colour, not the tile. The first replacement weighted the low frequencies and produced
  half-metre blotches — the surface was less uniform than the thing it was imitating. Bleach
  swing 15 -> 8 tone units, polished/ravelled tone swing 7 -> 4, and the coarse octave keeps
  0.3 of its weight in the relief instead of 0.55.
- CRACKS CAME DOWN FROM SIX PER TILE TO TWO, AND PATCHES FROM THREE TO TWO. A crack every
  four metres of a 24 m tile is a pattern before it is damage, and long meandering loops are
  the most memorable thing a repeating tile can carry, so they are the first thing the eye
  locks onto once the grain stops being the obvious artefact. The road's real damage budget is
  spent on potholes and ravelled edges, which are placed in world space and never repeat.
- BUILDING THE TILE IS FAST AGAIN. Gradient noise costs more per sample than the value noise
  it replaced, and the straightforward version measured 578 ms against the old 250 ms. The
  waste was that a gradient-noise sample reads four lattice corners and each corner is shared
  by every texel in its cell — 256 texels at the 64-cell octave, about 29 000 at the 6-cell
  bleaching field — so the corners are hashed once into a table and the inner loop only reads
  it. Measured in the browser, first build of the cached pair: 227 ms, with the albedo
  numerically identical to the precomputed-free version (mean linear luminance 0.53333 both
  ways). `tools/road-lanes.ts`, which builds real chunks through the canvas shim, still
  reports the ribbon, the taper and the lane dividers unchanged.

- THE WORLD NEVER SHOWS WEAR PAST 60%. Distance-aging drove two dials to full ruin: the
  road's `decay` (which is sand cover, markings, bump amplitude, pothole density, wheel-path
  polish, edge ravel and mottle) and the poles' `dilapidation` (which leaned a mast until it
  tipped right over and lay in the sand). Those are wrecks rather than a long road, and a
  player who meets one reads the world as broken. Both are now clamped to `MAX_WEAR = 0.6`,
  exported from `world/gradient.ts` so the benches and the prop gallery can construct the
  worst case that actually exists.
- Measured over the whole road (`tools/road-condition.ts`, 200 000 samples): raw decay runs
  0.00..1.00 with a mean of 0.475 and a median of 0.488, and 31.9% of the road is above the
  ceiling. After it: max 0.600, mean 0.434, nothing above. Sand cover therefore stops at 0.24
  instead of 0.85, and the bench's own properties are unmoved — first half 0.437 against
  second half 0.430 (must be within 0.05), decay drift -0.0045 per 10 000 km (must be under
  0.02), concrete share 7.6% against its 8% target, largest palette jump 1.00/255.
- THE COST OF THE CEILING IS NAMED RATHER THAN HIDDEN: it is a clamp, not a rescale, so every
  stretch that was already inside 0..0.6 keeps exactly the condition it had and the third of
  the road that was worse now reads as the same deeply-worn road. Rescaling the whole axis by
  0.6 would keep the variation instead, at the price of making the median stretch a third less
  worn than it is today (median 0.29, and lane paint back on 45% of the road). The clamp was
  chosen because it changes only the states the ceiling was aimed at.
- A POLE LIES IN THE SAND NOWHERE, and the code that could have built one is gone rather than
  left unreachable: `collapsed` needed `dilapidation > 0.72`, which the ceiling makes
  impossible, so the field, its pose branches, the 0.12 m sink and the "flat poles are not
  colliders" and "no wire to a fallen pole" skips are all removed. The lean remains and still
  carries the era's silhouette: 0..0.378 rad (21.7 degrees) against the old 32.
- WIRES AND LAMPS ARE NOT PART OF THAT CEILING, deliberately. A span that has come down and a
  lamp that has failed are things that happened to a pole, not how worn the pole is; they are
  survival probabilities for attached equipment, already binary and already tuned so most of
  the fleet is stripped long before the poles lean. Measured over the road, 76.1% of sampled
  pole positions still have some chance of a wire and 45.0% some chance of a working lamp.
  Capping them as well would have meant re-rating both curves for every pole on the road, not
  just the most worn ones, which is a larger change than the ceiling asked for.

- A CAR THAT CANNOT LEAVE A HILL IS GIVEN A CRAWL. The road and the fleet were supposed to
  agree — the road is what the cars were designed around — and they did not. Measured: the
  starter VAZ-2101 escapes 10.9 degrees of honest asphalt from a parked start, while seed
  1's road reaches 21.0% (11.9 degrees) and six seeds measured reach 17.0-21.0%. On those
  pitches the stock car sat still at full throttle: 0 km/h with the driven wheels at
  7.2 rad/s and a slip ratio of 7 against a peak-slip of 0.12. No coefficient fixes it —
  the 2101's worn tyres work the driven axle at 0.551 of mu, and 18.7 degrees asks 0.63 —
  so the tyre model now lies once on PURPOSE, in the same shape as the existing sand dig:
  a road-deck surface grants the driven axle a mu floor at a CRAWL (below 1 m/s fully in,
  gone by 4), which is what a driver gets from slipping the clutch and taking the gear that
  pulls. Measured on a 12-degree ramp, the engine now gets the car up it at 9.2 km/h
  instead of not at all, and the equilibrium is a crawl because a faster car gets less of
  the floor. Above 14 km/h the honest model is back in full: braking from 100 km/h measures
  72.1 m both with the concession and without, and top speed, cornering, slides and factory
  0-100 figures are unmoved (the 2101 is 22.02 s against its real 22 s).
- THE CONCESSION COVERS THE ROAD, NOT ROCK. It applies to the four surfaces the generator
  draws a road district from — asphalt, cracked asphalt, gravel and concrete — and
  deliberately not to bedrock, where "this slope is too steep for this car" is a legitimate
  answer. It is applied after the dig and below its figure, so sand and the loose verge are
  unchanged to the digit.
- `tools/climb-sweep.ts` now holds the road's own promise, which nothing checked before: a
  road-deck surface that cannot be left from a standstill is a dead end, not a challenge.
  Asphalt used to be excluded from the sweep on purpose — "the honest reference, printed so
  every other surface can be read against it" — and that stance was wrong for exactly one
  reason: the reference was not good enough. Every surface the deck is made of is now swept,
  the weakest rear-drive car must clear the world's 18.7 degrees on each of them with
  margin, and the whole 20-body catalogue passes. One body legitimately cannot: the
  UAZ-330364's first gear tops out at 15.1 degrees, so it is held to its own honest asphalt
  ceiling rather than to the world's maximum — a gearbox limit, not a grip one.
- THE GRAVEL CHECK MOVED DOMAIN. It asserted that gravel is a worse road than asphalt by
  comparing standing-start ceilings, and the crawl concession deliberately flattens those
  ceilings for all four deck surfaces into one number. The relation still has to hold, so it
  is now asserted where it still means something — a braking distance from 100 km/h, which
  the concession never touches: measured 72.1 m on asphalt against 90.3 m on gravel.

- EVERY ROADSIDE STOP IS ONE OF THE GALLERY'S 26 BUILDINGS. The world used to have four
  hand-built kinds — a wreck field, a petrol station, a workshop and a camp — and the
  twenty-six buildings in the POI gallery existed only in that gallery. Now the four are
  gone and every slot draws one of the twenty-six, from one hash of the slot: having seen
  a petrol station tells a player nothing about the next one, which is the whole point.
- The setback is measured from the ROAD EDGE and scaled by the building. It used to be a
  flat 12-40 m from the crown, which cannot serve a 5.8 m kiosk and a 30 m parts warehouse
  at once: the same offset puts the warehouse in the lane or the kiosk in the middle of
  nowhere. It is now `halfWidthAt(s) + verge + the building's own half-extent`, so every
  building clears the asphalt by 10-22 m of verge whichever way the road has widened.
- Rewards are granted BY CATEGORY rather than by kind, because "what is this place" and
  "what does it give me" stopped being the same question. Forecourts carry fuel cans, the
  gum pack and a trailer; shops carry tools and gum; houses carry medicine and a tool; and
  the salvageable car field — the 1-3 wrecks, their trunks and the 34% chance of a working
  car — moved to the container category, where a scrapyard's worth of cars belongs. The
  supply of each resource is close to what it was.
- The buildings' 65 authored lights would have recompiled the world's shaders the moment a
  chunk streamed in, because Three compiles the light count into every material. They are
  replaced by invisible marker lights that the existing `LightBudget` already budgets,
  exactly as the streamed street lamps are. Their emissive fixtures stay, so a window
  still glows.
- A building is collided by ONE trimesh of its merged walls, floors and bulky props. The
  catalogue's shells are built with real openings — `wallWithOpenings` leaves a hole and
  trims it — so a trimesh is both solid and walkable and needs no hand-authored proxy.
  Roofs are excluded, or the trimesh would enclose the interior from above.
- THE STARTER HOMESTEAD IS THE GALLERY'S, 100 M FURTHER ALONG THE ROAD. It was a
  hand-built 705-line compound; it is now the catalogue's `starter-homestead` — house and
  garage, furnished, with its own room lights — and the file keeps only what the catalogue
  does not bring: the concrete pad, the gravel drive from the asphalt to the garage door,
  the yard, the oil drums and tyre stack, the water tank, the fence, the lamps, the spawn,
  the starter car and the starter items.
  IT STAYS AT THE ROAD, and that is a measurement rather than a preference. The terrain is
  fitted to the road only inside the 30 m corridor; past that the landscape's long bands
  return and keep their slope, which the origin-centred flattening does not touch because
  it suppresses the SHORT bands. Placing the compound 50 m out put its pad on ground that
  varies 1.62 m and stands 1.5-3.1 m higher, against 0.60 m at the road — and a concrete
  pad cannot pay for that, so the house ended up on a hill with the edge of its slab in the
  air. It is back where the hand-built house's garage door always was, 8.3 m from the
  centreline, and `tools/poi-placement.ts` holds it there.
- THE HOMESTEAD PAD NOW SIZES ITSELF TO THE GROUND. Its top is poured above the highest
  ground under the footprint and its underside was a fixed 0.45 m below that — which was
  already not enough, because this compound's pad is 39 m along the road against the
  hand-built house's 9 m, so it spans four times the relief: measured 0.63 m of range
  against the 0.33 m a 0.45 m slab can bridge. The underside is now derived from the
  lowest ground under the pad, so the slab always reaches it, and the bench holds the
  RESULT — a pad deep enough to reach the ground everywhere is a plinth, and a plinth is a
  worse artefact than the gap it replaced. Measured: 0.82 m deep, under the 1.2 m limit.
- BUILDING A POI IS CACHED, and that is not an optimisation but a correctness fix. Merging
  a variant costs 3.74 ms on a 5950X and 11.4 ms at worst, against a streaming budget of
  3 ms per frame with one job per frame — so rebuilding per placement would have hitched
  on every POI, one every 1.2 km. The merged result is position-independent (merging bakes
  each mesh's transform into its geometry at the local origin), so it is built once per
  session and shared, and placing a building is only wrapping it in fresh Object3Ds:
  measured, 0.063 ms mean and 0.47 ms worst. All 26 are warmed behind the loading cover
  (157 ms once), because a first use otherwise happens while the player is driving past.
  It also stops the leak the old path had, where every streamed chunk built fresh geometry
  that nothing disposed.
- `tools/poi-placement.ts` holds the three properties nothing else checked: no building
  stands inside the road's verge, every one of the 26 variants is actually reachable over
  a long enough drive, and the homestead holds together — the compound is 63.3 m from the
  centreline, the spawn stands 1.31 m above the sand on the pad, the car 0.86 m above the
  player's feet inside the garage, and placing a building stays under the streaming budget.
- `tools/poi-grounding.ts` and `tools/wreck-spacing.ts` follow the change: the grounding
  bench groups by category rather than by the four dead kinds, and the wreck bench reads
  the container category, which is where the car field is built now.

- LIGHT SWITCHES ARE HALF SIZE AND WORK WITH E. Every variant's switch is built through
  one `roomLights` call and was a full-size plate on a stub. It is now scaled to half, and
  the scaling is done so the plate's BACK FACE STAYS ON THE WALL: scaling about the group
  origin would pull the back 0.014 m off its own mounting, so the scaled body is offset by
  `(depth / 2) * (1 - scale)`, which is arithmetic rather than the one value that happens
  to be right today. E is `useHeld`, which is what the player reads as "interact"; an aimed
  switch now wins over the held item, or carrying a torchlight would switch the lights off
  while walking past every wall.
- FURNITURE IS TWO THIRDS SIZE, ONE CONSTANT APPLIED AS A GROUP SCALE. Tables, chairs,
  beds, sofas, shelves, counters and the cash register shrink together, so a piece stays in
  proportion and whatever stands on it stays on it — the register on a counter is the case
  that would have drifted under per-part numbers. Measured: the table's top lands at
  0.587 m, which is 0.88 x 2/3 exactly. The rug scales its footprint and not its thickness,
  which is how a rug behaves. Crates and barrels are outdoor props and are untouched.

- THE CHASE VIEW'S COMPOSITION IS NOW HELD BY A BENCH. Two constants set what the player
  actually sees behind the car, and neither produced a number anyone could check: the arm's
  elevation IS the view's depression angle, so the frame's horizon lands at
  `(1 - tan(armPitch) / tan(fov / 2)) / 2` of the frame height from the top, and the FOV
  ceiling decides how much of the outer frame is stretched. Measured with the real rig on the
  real road at 0/60/130 km/h across the catalogue's shortest, middle and tallest bodies: the
  horizon sat at 32.4% from the top at rest — higher up the frame than the 35-40% that leads
  the eye down the road — so `ARM_PITCH_BASE` goes 0.22 to 0.189 and it now sits at 35.0%,
  rising to 35.8-39.2% at 60 km/h and 36.5-42.0% at 130 (the ground-clearance probe lifting
  the eye over rises is the spread's dominant term, not the FOV).
- THE SPEED WIDENING IS CAPPED AT 70 DEGREES, not `BASE_FOV + 14` (79). At 16:9 that is 100
  horizontal against 111, and a rectilinear projection stretches the picture along the
  frame's radius by `1 / cos²(angle)`: 2.4x at the corners against the resting 65's 2.3x,
  where 79 stretched them 3.1x. Five degrees of widening still carry the speed cue. Measured:
  the car reads at 16-28% of the frame height at rest and 10-18% at 130 km/h, bounded by the
  bench so it can never become a speck.
- THE ARM'S ELEVATION IS COUPLED TO THE LIVE FOV, so the widening is spent on the periphery
  instead of tilting the frame: a FIXED elevation drops the horizon from 35.0% to 36.3% over
  65 to 70 degrees. Below the resting FOV it is left alone, which keeps the binoculars'
  ten-power view exactly as it was.
- `tools/chase-framing.ts` is new and holds five properties nothing else checked: the horizon
  stays in the upper third, the car reads without filling the frame, it does not shrink away
  at speed, the projection never steps or reverses, and the road ahead stays framed while the
  road bends (mean 2.8 degrees of aim trail over a 30 km drive). It builds a real Rapier
  heightfield under each measured stretch — verified against `Terrain.heightAt` to within
  0.09 m — because the rig's ground probe is a raycast, and a bench with an empty physics
  world measures a camera that is never lifted or occluded.
- LANE CHOICE BELONGS TO THE DRIVER, AND THE PLAYER'S AUTOPILOT NEVER HAD ANY. The lane
  arrived through `Autopilot.requestLane`, which was the traffic coordinator's channel —
  and nobody called it for the player, so his autopilot fell back to the lane beside the
  crown, the PASSING lane, at all three of its characters on every four-lane stretch,
  while the stream around him was placed by a rule he was not subject to. The method and
  `RoadTraffic.assignRequestedLanes` are gone; the discipline lives in `drive` and reads
  the same for the player's three autopilots and for the thirty ambient drivers.
- A FOUR-LANE ROAD IS SORTED BY PACE, AND THEN STAYS SORTED. A driver's home lane is a
  property of its own intended speed — 25 m/s, which lands between the stream's ordinary
  driver (72-84 km/h) and its hurried one (95-115), and between the player's sleeper and
  his hurried — so the arrangement maintains itself with nobody weaving to keep it.
  "Keep right and overtake" was built first and is exactly the chaos it was meant to
  remove: every driver with a slower car ahead had a reason to move, and the stream spent
  its life changing lanes. Discretionary lane changes are frantic's alone again, and the
  ambient stream contains no frantic drivers; the lane beside you as a way past something
  STOPPED is still everybody's. A lane that ENDS is left under steering, read 110 m ahead
  — a merge that used to be the coordinator's and therefore never happened to the player.
- `lanePasses` HAD NEVER FORBIDDEN ANYTHING. `laneCentres` decides which lane centres are
  priced exactly and which lanes are probed; the cost search walks every quarter metre
  between the verges regardless, so the next lane was a candidate for every driver on
  every tick whatever its character — and at 6 cost per m/s of lost pace against 2.9 for
  a lane, any car a metre per second slower bought a lane change outright. Reported from
  play as an inner-lane car undertaking on the right and the car it had just passed
  pulling out into the lane being vacated, neither of which anybody had asked for.
  `CorridorRequest.lateralFreedom` now states the entitlement: the whole road for a
  driver allowed to pass, one whose lane is blocked by something stopped, one already
  mid-manoeuvre or with no feasible corridor; otherwise its own lane and wherever the
  body already is, so a car out of position can hold or come home but never go further
  out.
- THE COMMANDED LINE HAS AN ACCELERATION BUDGET INSTEAD OF A SLOPE. It moved a fixed
  0.09 m per metre of road, and a slope is a lateral SPEED once the car is rolling: 0.7
  m/s at 30 km/h and 2.7 m/s at 108, held at full value right up to the target line and
  then stopped dead. Both ends of that profile are steps in lateral velocity — a demand
  for unbounded lateral acceleration — which pure pursuit turned into a step in commanded
  curvature, and the yaw-damping term multiplied the first by about 2.25. Reported from
  play as an overtaking car cranking the wheel hard enough to nearly throw itself off the
  road. The line is now driven like a car: the rate ramps in at `a` and the target rate is
  `sqrt(2·a·e)`, the fastest it can still be brought to rest ON the line, so the peak
  lateral acceleration is `a` by construction. The same `a` goes to the planner, whose
  `transitionDistance` is `speed · 2·sqrt(shift/a)` — the honest road a move consumes,
  where a flat 32 m used to stand for every speed.
- AND THE BUDGET IS AS GENTLE AS THE ROOM ALLOWS. Inverting the arc gives the
  acceleration a move needs to fit the room it has, `4·shift·v²/room²`, clamped between a
  comfortable 0.6 m/s² and the grip share. An obstruction is first seen at the corridor
  horizon, three seconds of travel, so the rate it asks for on the step it is decided is
  1.29 m/s² at EVERY speed — an eighth of a g, the same manoeuvre for the sleeper and for
  frantic — while an ordinary lane change, which has no deadline at all, is made at 0.6.
- A MANOEUVRE BEGINS WHILE THERE IS STILL ROAD FOR IT. Leaving the lane took a blocker
  within a constant 45 m, and a lateral move needs `v · 2·sqrt(d/a)` metres: seventy-odd
  at 20 m/s and over a hundred at 30. The trigger fired with less road left than the
  manoeuvre takes, by construction, at every road speed — so the line the planner had
  already proposed was thrown away until it was too late to reach, the swept test
  correctly reported that no line was reachable, and the driver braked at the obstruction
  as though it were a wall, crept into it, and only found the way round once it was slow
  enough for the sums to close. Reported from play as cars laying siege to obstacles. The
  trigger and the release now share one distance, the road the move itself needs plus a
  body length, with the old constants surviving as its floor and its margin.
- THE SPEED A WAY ROUND IS TAKEN AT IS PRICED ON WHAT THE LINE ACTUALLY CLEARS, and on
  closing distance rather than distance. The old sum took the nearest own-lane block or
  indexed prop whatever line had been chosen, so a driver already out in the opposing
  lane still lifted off for a rock in the lane it had left — the one obstacle it was
  demonstrably clearing — and a lane change thirty metres behind a moving leader was
  priced as if the leader were a rock, asking for 11 m/s, so every overtake began with
  the driver braking from its cruise. Both reported from play, the second as "the
  kickdown does not accelerate, it slows down".
- AN OVERTAKE CLOSES UP FIRST AND THEN USES THE ENGINE. Tucking in was gated on a flag
  that only comes on once a crossing has been refused or taken, so on a clear road it
  never happened at all and the driver went out from a full comfort headway; the kickdown
  was unreachable by construction on a four-lane road, where both of its conditions are
  about the crown and a lane change never crosses it. The two are now separate decisions:
  the gap closes on having caught something slower, the engine is spent only once the
  other lane is actually being used.
- AND THE THROTTLE STAYS SHUT DURING A CROSSING NO LONGER. A tenth of lock meant "the
  tyres are working laterally", which is the right proxy for a corner and a double-charge
  for a deliberate lateral move: the speed plan has already reserved that share of the
  grip before asking for the speed. A lane change sits well past the threshold and
  `speed >= 0.9 · target` is true the moment a driver at its cruise decides to pass, so
  the pedal was closed for the whole manoeuvre. The line's own rate distinguishes the
  two — a car holding a bend is not moving its line.
- THE COORDINATOR'S PAIRWISE RULES RUN AT 10 Hz, NOT 60. Deadlock right-of-way, reverse
  room and pass permission are each O(cars²) and were answered sixty times a second, as
  was a linear oncoming scan per car that exists to dip a headlight; on a widened stretch
  the stream is `WIDE_TRAFFIC` rather than `NARROW_TRAFFIC`, so the pair count more than
  quadruples exactly where the road opens out. What they produce are permissions, latched
  until re-evaluated and read by drivers that decide at 45 Hz about manoeuvres measured in
  hundreds of metres: a tenth of a second is 4 m of closure against exclusion windows of
  120 and 260 m.
- `FrameProfiler` HAS A `traffic` SECTION. The simulation is the floor no frame-rate cap
  can go below, and only `physics` and `streaming` were named inside it — three quarters
  of the tick was unattributed, which is not something a report of "the simulation is
  growing" can be acted on.

### Fixed

- AN OVERTAKING CAR NO LONGER BRAKES BESIDE EVERY CAR IT PASSES. The imminent-contact
  reflex — time-to-contact on the tracked lead, the last word over every other pedal
  decision — was reading a gap the driver was not driving into. The tracker is fed the
  minimum of every probe, including the keep-alive one down the driver's OWN lane, which
  exists to hold the speed estimate of the car being overtaken while the line is
  elsewhere; its distance goes to nothing as the bumpers draw level, the closing rate is
  the overtaking speed, and the reflex stood on the brake. Reported from play on an empty
  road with an empty opposing lane: the car pulls out, brakes as it comes level, waits a
  second, accelerates, and does it again at the next car. It now reads the two probes
  cast down lines the driver is actually using — which also finally excludes the nose
  scan the comment above it has always said must not feed it.
- AND THE HEADWAY IT KEEPS WHILE CROSSING FADES WITH THE CLEARANCE. A full following
  headway was held for as long as the body was within a car's width of its own lane
  centre, which is reached at about seventy per cent of the way across, so the last
  second of every crossing told the driver to match the speed of the car it was drawing
  level with. The constraint is now the one the rest of the controller uses — the move
  has a duration and the gap has to outlast it — so closing is held to walking pace
  mid-crossing with a few metres in hand, and opens up exactly as the clearance arrives.
- AN OVERTAKE IS TIMED ON CLOSING SPEED, NOT ON THE SPEEDOMETER, so it no longer begins
  a lifetime behind the car it is passing. A rock arrives at the speed the car is doing
  and a slower car arrives at the DIFFERENCE, which behind a leader four metres a second
  slower is a sixth of it — so both the lateral rate a move asks for and the distance at
  which the move starts were sized six times too large. Measured: a forty-metre gap to a
  moving leader asked for 4.5 m/s², the whole grip share, and the trigger sized on that
  rate fired sixty-odd metres back. Reported from play: on the two-lane road the pass
  starts a long way behind the leader and the closing-up never happens. The trigger's
  floor comes down from 45 m to fourteen with it — forty-five metres of gap to a slower
  car is a comfortable following distance, not "close enough to act on", and a floor
  that large simply reinstated the defect for every moving leader.
- THE WIDE-ROAD PACE IS TAKEN AND GIVEN BACK OVER SECONDS, AND THE NARROWING IS READ
  BEFORE IT ARRIVES. `lanesPerSideAt` is a step function, so a flat twelve per cent on it
  was a step in the speed every driver wants, at one arclength, reached by each car at a
  slightly different metre — and a step down is a brake, arriving exactly while they are
  also being asked to merge. The bonus now fades as soon as the taper is visible, the
  same 110 m the home lane already reads, and slews over five seconds either way.
- AND SOMEBODY LETS THE MERGING CAR IN. A lane that ends is the same situation as a lane
  blocked by a wreck, and it was the one case nothing yielded for: a taper is not an
  obstacle, so the merge-yield rule could not see it, and the drivers whose lane survives
  — the quick ones, sorted into the lane beside the crown — held their pace while the
  outer lane emptied itself into them. Reported from play as the four-to-two transition
  being untidy. The same rule also now checks which side of the crown the neighbour is
  on, or an oncoming car in its own outer lane reads as one about to merge into us.
- A DRIVE THAT WAS INTERRUPTED BY A PAGE RELOAD NOW COMES BACK TO THE CAR. Playing on a
  phone, the screen sleeps, the player wakes it, and the game is at the title screen with
  the drive apparently gone. It was not the sleep: it was the reload. The development
  server injects `@vite/client` into every page it serves, and its socket handler reloads
  the document when the connection comes back after being lost — and a sleeping tab is a
  frozen tab whose socket dies. Measured three ways with the same stop-and-restart
  sequence: the game from the dev server came back as a NEW document
  (`navigation.type: reload`, new `timeOrigin`), a TRIVIAL HTML page from the same server
  do too, and the built game did not (`pagehide` never fired, `timeOrigin` unchanged).
  So the reload was never the game's.
- WHY THE SCREEN SLEEPS AT ALL, recorded here so it is not re-investigated: the Wake Lock
  API needs a secure context, and a phone is being served the game over plain HTTP on the
  LAN. Measured in the same browser, same machine: `http://192.168.88.115:5173` gives
  `isSecureContext: false` and no `navigator.wakeLock` at all, while `http://localhost`
  gives both. `installScreenWakeLock` therefore warns and returns, and nothing on a phone
  can see that warning. Serving over HTTPS — `tailscale serve --bg 4173`, on a machine
  whose tailnet and Funnel are already up — is the way to actually keep the display on; the
  auto-resume above is what makes the sleep survivable either way.
- THE RELOAD IS ONLY HALF THE FIX, because it can arrive from anywhere: a discarded tab
  Chrome restores, a crash, or the dev server above. Nothing in a save said the player was
  mid-drive, and the title screen cannot tell a deliberate quit from an interrupted one,
  so `save/resume.ts` holds the one bit that makes the distinction — in SESSION STORAGE,
  whose lifetime is exactly the question being asked: a marker that outlived the tab would
  resume a drive the player deliberately ended. It is written from the one place an
  autosave is booked (`installVehicleAutosave`'s `onSaved`), so the marker can never name
  a slot the autosave does not write, and it is cleared by the two reloads that are
  deliberate: death and Quit.
- THE ATTEMPT BUDGET IS THE POINT OF THAT POLICY, not a safety afterthought. Resuming
  deliberately skips the only screen with a way out, so a reload that resumes into a world
  that immediately reloads again would be an unbreakable loop. Each resume spends one of
  two attempts, and a session that runs for twenty seconds proves itself and hands them
  all back. A later autosave deliberately does NOT refill the budget — a reload arriving
  seconds after each save is exactly the loop being bounded — and a slot that no longer
  loads clears the marker instead of spending budget on every later reload.
- Verified end to end on the built game, not only in the bench: a reload with a resume
  booked came back to the world with the title screen never drawn; three reloads inside
  the healthy window gave world, world, then the title screen, with the drive listed there
  and loadable in one click, so a spent budget strands nobody; and the attempt count was
  back to zero after that first resumed session had run past twenty seconds. The organic
  write path was confirmed too — entering a car in the running game booked
  `slot-<seed>` and the next reload resumed into the driving HUD.
- `tools/resume.ts` holds the policy: an empty session resumes nothing, an autosave books
  the slot it wrote, exactly two consecutive resumes are allowed and the third is handed
  the menu, a healthy session hands the budget back, a cleared marker resumes nothing, a
  later autosave does not refill the budget, and storage that throws degrades to the title
  screen instead of propagating. Its first version failed two of its own checks and both
  failures were the BENCH's fault — one check spent budget that the next one depended on —
  which is why each scenario now starts from an empty marker.

- THE CAR FIELD AT A SCRAPYARD NO LONGER STANDS INSIDE THE BUILDING. Both are placed
  from the POI's own anchor — the building centred on it, the 1-3 wrecks strung ±13 m
  along the road and ±6 m across it around it — and the field's rejection loop knew about
  the bodies already placed and nothing else, so it laid them through the walls. Measured
  by `tools/wreck-spacing.ts` over 219 container stops: 62.1% put a body inside the
  building's measured footprint, the deepest 2.53 m in, and where the stop rolls the
  roadworthy find that is the car, created inside a static trimesh.
  `layOutWreckField` now takes the building as `WreckKeepOut` — where it stands, which way
  it faces, and its measured half extents — and clears it by the same margin it clears
  another body. The test is in WORLD XZ rather than in the field's flat (arclength,
  lateral) frame, because the flat frame left a body 0.28 m inside a wall on a curve.
- WHEN NOTHING CLEARS, A LATTICE FINISHES THE FIELD. Accepting the roomiest draw however
  deep it sat was survivable in an empty field and is not one with a 12 m building on its
  anchor. A slot the hash stream cannot place now takes the first position on a 1 m
  lattice over the same field that clears everything, so a field still always lays out,
  never loops, and an impossible one — three lorries in one field — is as far from every
  neighbour as the ground allows. Body-to-body placement is unchanged, and
  `tools/poi-placement.ts`'s placement cost is unmoved: 0.116 ms mean, 0.68 ms worst
  against its 3 ms budget.
- `tools/wreck-spacing.ts` holds both properties: no body overlaps another, every pair
  keeps a walking gap, the blind layout ran a body through the building in 62.1% of its
  fields, and the shipped one does it nowhere. It places the building with the real
  `faceRoadYaw`, which is exported for exactly that reason.

- EVERY BUILDING WAS MISSING ITS ROOF, and every un-merged mesh with it. The variant
  cache stored each mesh as geometry and material only, then rebuilt it at the
  origin — but `mergePoiStatics` bakes the transform into the geometry of only the
  meshes it MERGES, and deliberately leaves others alone (roof panels, light switches,
  unique-material trims). So every un-merged mesh collapsed into the ground: the
  starter homestead lost all twelve of its roof panels and `long-house` came out 2.8 m
  tall instead of 5.5 m. The cache now keeps the full WORLD matrix, with every
  ancestor composed in, because a variant's parts are nested — a tilted container's
  shell lives inside its own rotated group, and restoring only the mesh's own
  transform left `buried-container` 0.46 m too tall. `userData` is kept with it, so
  `poiRoof` and the light-toggle closure survive.

- `tools/poi-placement.ts` now states the property it was missing, which is what would
  have caught that immediately: an instance must have the same meshes, the same roof
  panels and the same extent as the merged catalogue form the gallery displays.
  Measured across all 26: agreement to 0.000 m. It is not redundant with any code
  check, because the failure looked plausible in a screenshot — most of a building IS
  merged, so the walls were all there and only the roof was gone.

- A LIGHT SWITCH CONTROLLED LIGHTS THAT WERE NOT THERE. The catalogue's toggle closure
  drove spot lights created inside the variant, and the world replaces every authored light
  with an invisible light-budget marker before anything streams in — so pressing a switch
  flipped a boolean nobody could see. Measured over 20 km of road: pressing every switch
  took 22 lit sources to 22.
  A switch's lights now belong to the PLACEMENT, not to the build, because a variant is
  built once and placed many times and two houses of one variant must not share a light.
  The catalogue records where the lights hang and which bulbs glow; `createVariantInstance`
  makes them, so each building gets its own markers, its own bulb materials and its own
  closure. Measured again: 22 lit sources to 4.
  `tools/poi-placement.ts` states the consequences rather than the wiring, because the
  wiring is what looked correct while it did nothing. Each switch is pressed ON ITS OWN and
  required to change the lit count, so one working switch cannot carry the rest. Every
  switch must match the transform of the building it is screwed to. And the registry is in
  ABSOLUTE coordinates while a chunk builds relative to its floating origin, so the road is
  built twice, once at the origin and once 48 km from it, and the switches must land in the
  same place both times — registered from the chunk-local matrix instead, they land a whole
  origin away, which measured 41 km.
  THE KEY AND THE PROMPT AGREE. `pickedSwitch` is found by a proximity test before the
  targets are ranked, so on its own it means "a switch is in front of you" rather than "you
  are looking at it" — and the failure is a mismatch, not an absence: standing at a car
  with a switch on the wall beside it gave a prompt saying "open the door" and an E that
  turned the lights off. `Interaction` is now driven directly in the bench, with a switch
  aimed, a switch behind the player, a switch out of reach, and a loose part that wins the
  ranking against a switch further away; E works the switch in the first case and does
  nothing in the other three.
  AND THE AIM IS IN THE SAME FRAME AS THE REGISTRY. The eye arrives relative to the floating
  origin while the registry is absolute, which the trunk and courier loops already answer by
  subtracting the origin — the switch pick did not, so switches were reachable only while the
  origin sat at zero, which is the first few metres of a drive. Measured: a plate two metres
  away stops being aimable the moment the world rebases. The aim ray's own first hit is also
  used as an occlusion bound now, so a switch cannot be worked or even offered through the
  wall the player is standing against.
  THE HOMESTEAD'S OWN SWITCHES ARE REGISTERED. It places the same catalogue building as the
  road does but through its own provider, and it was registering nothing — so the first
  building a player ever stands in was the one whose lights could not be worked. Both
  providers now go through one `registerPlacedSwitches`, which also removes a hand-written
  quaternion product that was wrong.

### Removed

- THE CONCRETE APRON UNDER EVERY POI, and with it the plinth. The slab's top was the
  fitted ground plane, so on uneven ground it either floated at its low corner or showed
  its own thickness as a grey box around the building: measured, 0.82 m deep on the
  homestead, which is a plinth, and a plinth is worse than the gap it replaced. A building
  now sits on the fitted plane, tilted onto it, and is sunk by the plane's own `residual`
  plus a hand's width — which is by definition the most any ground under it can rise above
  the plane, so no wall can stand on air. `tools/poi-placement.ts` measures the ground
  densely under every footprint rather than comparing one point: worst gap under a wall
  0.001 m. Placing a building also got 38x cheaper, because the apron's geometry was most
  of what a placement built: 0.115 ms mean, 0.665 ms worst against the 3 ms budget.
  THE STARTER HOMESTEAD KEEPS ITS SLAB but no longer shows it. Its pad is the garage floor
  and has to be LEVEL — the car parks on it and the sand would rise inside the garage
  otherwise — while the ground under it varies 0.63 m, so the pad has to stand proud
  somewhere: measured, 0.77 m of grey concrete along the building, which is a plinth and
  the one thing a player sees from the drive. Its edges are now banked into the ground with
  the ground's own colour at the ground's own slope, so the concrete meets the sand through
  a graded bank instead of a wall. The run is exactly the 2.6 m of verge between the pad's
  near edge and the asphalt, so the bank reaches the road edge and no further, and the
  steepest it gets is 13 degrees — a bank a person walks up rather than a cliff.
  `tools/poi-placement.ts` holds both numbers, and the bank is a walkable surface with its
  own collider rather than a picture, so the player's feet follow it rather than the sand
  under it.

- THE STARTER WORKBENCH, and the starting items moved onto the garage shelf. The bench
  stood just inside the garage door — which is where the car drives through and where the
  player walks — for the sake of holding a camera, a pocket watch and two doses that a
  shelf already standing in the garage holds just as well. A shelf's plank tops are now
  exported by the catalogue that builds the shelf and the shelf's place is resolved through
  the building's own transform, so the items stand on the shelf that exists rather than on
  a remembered height: `tools/poi-placement.ts` holds all four within the planks and just
  above one of them.

- THE FOUR HAND-BUILT POI KINDS: `roadside_wrecks`, `gas_stop`, `workshop` and `camp`,
  with their builders, their forecourt/canopy/workshop-slab/camp constants and their
  window helpers. `PoiKind` is gone with them; a slot names a variant index and the
  variant's category is what the rewards read.

- THE FULL-SCREEN SCENE BLUR. It was a `backdrop-filter` over the whole viewport, so the
  compositor had to read back the frame the 3D pass had just drawn and filter it before
  anything else could land on top — every frame, for as long as it existed, because the
  scene beneath it is never still. That is a full-frame read and write per frame, and on a
  phone it is a real one.
  The radius was 0.08 px, and it turns out to have been doing nothing at all. Measured:
  with the loop stopped and CSS animations frozen so the composited frame was provably
  static — the same state captured twice gave a byte-identical PNG — a probe element with
  `blur(0.08px)` produced a PNG byte-identical to the frame with no element at all, same
  SHA-256. The same probe at 6 px changed the output substantially, so the test could see a
  blur and the null result is real rather than a blind test. An invisible effect bought
  with a per-frame compositor pass is the worst trade in the file, and it is gone.
  The title screen's background blur is a different thing and is untouched: that is a
  `filter` on a static image behind the menu, not a `backdrop-filter` over the live scene,
  and it costs nothing while driving.

## 0.15.0 — 2026-09-13

### Added

- THE FRAME RATE IS THE PLAYER'S ON EVERY DEVICE: 30, 60, 75, 120, 144, or no cap. It
  was a phone-only choice of 30 or 60, and that was the wrong shape twice over.
  It is the one lever that works everywhere, for opposite reasons. On a phone it is a
  THERMAL control and has to be the player's, because no browser reports thermal state,
  battery temperature or clock speed — the device cannot say it is hot, only the person
  holding it can. On a desktop it is noise and power, which the game cannot see either. And
  it is the largest lever there is: half the frames is half the render work and half the
  presenting, while the simulation keeps its fixed 60 Hz so the car handles identically.
  The rates offered are not taste. 30 and 60 are the thermal steps; 75, 120 and 144 exist
  because panels have them and a cap that does not match the panel wastes what is being
  paid for; no cap is offered because a desktop whose GPU is already the constraint gains
  nothing from one — measured on a 4090 at 144 Hz, the GPU set the frame time at 6.94 ms
  against a 6.81 ms interval, so a cap there would only cost smoothness. And there is a
  HARD FLOOR under the ladder: the loop simulates whole fixed steps, at most
  MAX_STEPS_PER_FRAME of them per frame, so a rate below `simulationHz / MAX_STEPS_PER_FRAME`
  would make the simulation fall behind the clock rather than run slow. `tools/graphics-tiers.ts`
  holds every offered rate to that, and adding a 10 FPS option makes it say why not.
  A phone still starts at 30; a desktop starts uncapped. The old phone-only
  `mobileFrameRate` is read once when sanitizing, so a save made before this keeps the cap
  its player chose instead of silently becoming uncapped and hot.

- A FRAME COST REPORT, readable on the device whose heat is in question. The pause menu
  grows a development-only `Frame Report` screen showing presented frame rate, GPU
  milliseconds where the device can measure them, busy CPU milliseconds per SECOND, and
  the simulated and drawn halves of the frame broken down and ranked by what they cost
  per second. On a phone that is the difference between knowing and guessing: it was built
  because the phone's heat was first attributed to resolution, and resolution is demonstrably
  not it — a phone presenting a third of a megapixel at 30 FPS asks its GPU for roughly
  15 megapixels per second, which is nothing, so the cost is elsewhere and only a reading
  taken on the phone can say where. `tools/frame-report.ts` holds the arithmetic, and
  caught a real defect in it: the sections NEST (the simulation contains the physics, the
  render call contains the drawn sections), so the headline total has to be the two outer
  measurements rather than a sum of every section, which was counting the same work twice.

- `tools/spray-pool.ts` holds the wheel-spray pool to both halves of its new idle gate: a
  pool with nothing in flight must flag no uploads, and a pool that has motes in it must
  still fly. Breaking the gate either way is caught — leaving it open reports "an empty
  pool still flagged its buffers", and closing it permanently reports "live motes did not
  move between frames", which is the failure that matters, because those motes would hang
  in the air for the rest of their life.

- `tools/graphics-tiers.ts` holds the rendering ladder to two properties that were both
  false. The ladder must CLIMB, so that every rung is a purchase rather than a relabelling
  — the star depth was limiting magnitude 8 on two of the three rungs, so choosing between
  them changed nothing. And no display may talk a rung past its own pixel budget, which
  `renderScaleFor` is now a pure exported function for, because a policy reachable only
  through a live WebGL context is a policy nobody checks. The bench also catches the
  specific failure it was written for: restoring the old unbounded middle rung makes it
  report "standard costs 5.8x acceptable — a rung is missing between them".

- `tools/contact-patches.ts` checks that the tyres are actually on the ground, by
  reading back the geometry that will be drawn: one quad per grounded wheel, centred on
  that wheel's own contact point, lying in the ground plane the wheel reported, with an
  opacity that follows its load. It also asserts the ordering the whole feature exists
  for — the darkest patch belongs to the most heavily loaded wheel.

- `tools/pedal-dose.ts` measures what a keyboard press actually delivers to a pedal.
  A keyboard pedal is a switch, so the ONLY thing that turns a press into a dose is the
  shaping the input layer applies, and two properties are asserted: the dose is
  monotonic in press length, and the release is a release. The second is measured as an
  equivalent hold — the impulse delivered AFTER the key comes up, expressed as seconds
  of the pedal the press reached — which is the quantity that decides whether a driver
  can ask for a light touch.

- A STEERING-POSITION STRIP on the dashboard, under the segment display: a track with
  its two ends bracketed, a notch at straight ahead, and a marker at the rim's present
  position. It exists because the keyboard is how most players steer this game, and a
  keyboard has no force on the hands to say where the wheel is pointing and no way to
  glance down at it — with `preciseSteering` in particular, which holds the angle the
  driver built, there was nothing anywhere in the game that reported what that angle
  was. The marker reads `steerCommand`, the RIM's position, not `steerAngle`, the road
  wheels': the wheels lag the input by the steering box's backlash and by the rack rate,
  so a needle reading them would move in two steps per correction and would wander while
  the driver held the wheel still. A real rim is rigidly connected to the driver's hands,
  and that is exactly why a driver can feel where the wheels are without looking.
  It costs the dashboard no height: the gauge row is already 124 px tall because of the
  two main dials, and the centre column reaches 84, so the strip sits in space that was
  already empty. One `<svg>` and four `<line>`s, created once; the marker writes two
  attributes only when its position moves by a tenth of a unit, so a held wheel costs
  nothing per frame.

- `tools/climb-sweep.ts` asks the question the desert actually poses, of every body in
  the catalogue: how steep a grade can this car still escape on? A real car, real
  Rapier, released from a parked start on a real incline and driven at full throttle,
  with the answer bisected rather than sampled. It prints every surface for information
  and asserts on the two that form open slopes a car can be stranded on — sand and the
  verge — in the only form the requirement has ever had: NO DIGGING SURFACE MAY BE A
  PENALTY. Whatever a body climbs on sealed Tarmac it must also climb on sand, which is
  the whole point of the concession, and it is measured per body because a truck whose
  first gear tops out at 13 degrees on asphalt is limited by its gearbox and not by the
  ground. The absolute requirement is kept on its own line so it cannot be averaged
  away: the weakest front-engined rear-drive car in the catalogue — the GAZ-21 Volga,
  which `tools/climb-limit.ts` names independently — clears the world's own steepest
  grade of 18.7 degrees with margin. Measured over the whole fleet, every body digs as
  well as it grips and most do far better: 18.1 to 30.7 degrees on sand against 10.5 to
  21.9 on asphalt.
- `tools/tap-response.ts` measures what one tap of a steering key does, because most
  players steer this game with the keyboard and the mapping from TAP LENGTH to
  ROAD-WHEEL ANGLE is then the whole of the control system that matters. It sweeps tap
  durations from 40 ms to 700 ms and asserts three properties: a fine tap produces a
  real correction, a longer tap always produces more than a shorter one, and no single
  step of the sweep multiplies the response by more than three. All three were broken —
  see the steering entry under Changed.

- The driving view now carries a permanent, tunable soft-focus pass. Collision damage
  no longer adds more blur: it briefly drains colour, hardens contrast and closes a
  stronger black-red vignette around the frame.

- Distant vessel mirages no longer use independent occupancy rolls that could leave a
  valid seed empty for hundreds of kilometres. Each three-slot block now contains one
  seeded encounter, retaining irregular spacing while bounding the spatial drought at
  68 km.

- A turning circle where the road starts. The road is generated from s = 0 upward and
  simply stopped there: the asphalt ended mid-stride against a dune, and ambient traffic
  driving toward the start ran out of road, sat against the clamp its reversed road view
  collapses to, and was recycled out of sight. There is now a 34 m paved bulb behind that
  end, and oncoming cars slow down, swing round it and drive back out the other way.
  IT IS NOT PART OF THE ROAD RIBBON, and could not be. `Road` is one arclength with a
  half-width at each s, so a bulb expressed as a bulge in `halfWidthAt` would come with
  the mesh, collider, corridor grading and scatter setback for free — but it is 17 m
  either side of the crown, and the homestead's pad starts 8.3 m off it at s = 12. The
  bulb would have eaten the garage. So it lives BEHIND the start, in the apron the
  terrain already draws there, where the only thing it can take is empty desert.
  The ground under it is LEVELLED, as a deterministic term in `Terrain` — the contract
  the lake basins already have: pure in world position, so the tile worker reproduces it
  without being told, and what is drawn is what is collided. Measured, the pad is level
  to 4.8 cm across its whole 34 m and eases back into the dunes over 14 m of rim at no
  more than 32 cm of rise per metre, which is a slope a car drives off. Desert tiles no
  longer scatter rocks or cacti onto it.
  The line the cars drive is `world/turnaround.ts`, a `DriveRoad` like `ReversedRoad` and
  the only geometry in the game that is not a function of the road's arclength: the
  oncoming lane, a 6 m hook that swings the car wide, 308 degrees round an 11 m loop, the
  mirror of the hook, and out along the outgoing lane. Every piece is tangent to the next,
  so heading is continuous the whole way and the controller only ever meets a step in
  curvature. The radii are measured rather than chosen: driven round analytic circles the
  autopilot holds 30 m to 0.88 m of lateral error, 12 m to 0.93 m, 10 m to 1.12 m and 8 m
  to 1.39 m, and falls apart at 6 m — so the loop is 11 m and the 6 m parts are 64 degrees
  long. A car takes 29.5 s to go round, holds the line to 1.50 m, and never has less than
  1.74 m of paving under it.
  `Autopilot.retarget` is what hands a driver a different road mid-drive, resetting
  exactly what a fresh engagement resets, and `RoadTraffic` does the stream's half:
  direction is no longer fixed for a car's life, and a turning car is excluded from lane
  merges, passing, the deadlock coordinator and reverse-room, all of which reason about
  who is ahead of whom in ONE direction. In the bench, 11 cars used the circle in three
  minutes, 10 drove back out past the 150 m mark, none was left standing on the paving
  and the turn cost no collisions. `tools/turning-circle.ts` measures the ground, the
  line and one car driving it; `tools/traffic-bench.ts` measures the handover.

- Lakes. Once every 200-300 km the desert is searched beside the road for a closed
  hollow, and where it finds one deep and wide enough, that hollow is full of water,
  ringed with dense grass and fringed with palms. It offers one about every 875 km on
  seed 1337 — roughly a third of the attempts — and the rest of the time there is
  nothing there, which is the correct answer rather than a shortfall.
  NOTHING IS DUG. `Terrain` is byte-for-byte the road-only world, physics is untouched
  and the tile worker never hears about any of it: the water is a reader. The window is
  sampled through the tiles' own ground function, every depression in it is filled to
  its own lip by a priority flood from the window's edge, and the largest pool becomes
  the lake. A closed basin fills; an open slope fills to nothing.
  It costs one transparent draw for the water, three instanced draws for the fringe and
  a texture-offset update per frame while it is visible, and nothing at all when it is
  not. The search is sliced through the same streaming budget the terrain tiles use, at
  under 3 ms a frame. The surface is a stock `MeshStandardMaterial` — fog, the sky's
  PMREM reflection and the sun's specular come free with it — and the whole shoreline is
  BAKED: every vertex carries the water's depth over the ground as an RGBA vertex
  colour, so the soft edge, the foam strip and the depth tint cost no shader, no depth
  read and no second pass. Knowing the boundary exactly is also what lets the grass ring
  the water rather than the site.
  It vanishes as you reach it. Not on leaving the road, like the tableaus — driving to a
  lake IS the encounter — but by APPROACH, over the TABLEAUS' OWN BAND: the ten metres a
  mirage town takes to evaporate after you leave the asphalt is imported from
  `mirage-tableau.ts` rather than tuned again, so both apparitions thin out at one rate.
  You drive the whole way to the shore with the water fully drawn and it goes in the last
  ten metres: measured on the walk in, 1.00 at 12 m from the waterline, 0.90 at 10 m,
  0.65 at 8 m, 0.35 at 6 m, 0.10 at 4 m, 0.00 at 2 m — gone before a wheel could be in
  it, and back when you pull away. The distance field it reads is now interpolated
  rather than sampled: the lattice is 8 m, the band is 10, and nearest-sample turned the
  fade into a staircase with two treads — which is the two-step vanish this fade exists
  to avoid. The fade is a function of where you stand, so it is reversible by
  construction and nobody has to write hydrolock, buoyancy or a walk home. A second,
  narrow fade over the water's own level handles the eye dropping UNDER the sheet, where
  a transparent plane becomes a colour filter over the screen.
  The water's colour is taken from the sand's. `desertPaletteAt` walks the ground's hue
  right around the wheel over the length of the road, so the lake is pinned blue and
  slides off the sand only where the sand itself goes blue.
  `tools/water.ts` measures all of it, and the pause menu grows a dev-only
  "Jump to Lake" that walks forward to the next site that actually holds water.
- Distant mirages are vessels now. The gate, the arches, the colonnade and the
  balanced sign were four arrangements of one box in one colour, and a grammar of
  boxes reads as scaffolding; a second attempt built six assembled objects and only
  one of them worked. The one that worked was the amphora, and not because it had
  more detail — because it was the single form whose whole identity is one silhouette
  curve. Anything assembled from parts has proportions to get wrong, and at a
  kilometre a chair with the wrong members is a ladder and a ribcage is a fence.
  So there are ten vessels and nothing else: amphora, pithos, jug, oil flask, krater,
  hydria, kylix, decanter, lidded urn and bottle. Each is a hand-placed outline turned
  on a lathe — sixteen pairs of numbers that cannot be out of proportion with each
  other because there are no parts. A new vessel costs one array. Handles are not
  placed by hand either: the distance from the axis is read off the profile at the
  handle's own height, so a loop leans on the clay instead of floating beside it or
  sinking into it, and it stays there when the seed restretches the jar.
  The seed picks the shape and varies its height and stoutness by about a fifth — no
  more, because past that a jar stops being the jar it was drawn as.
- The road is not one width any more. Most of it is the two-lane road it always was,
  5.8 m of asphalt; roughly a third of its 5 km cells open out to TWO LANES EACH WAY
  over a 260 m wedge, hold, and close again, and adjacent wide cells merge into
  longer runs. Measured over 400 km of seed 1337: 77.5% one lane each way, 20.7%
  two, 1.8% in a taper, fourteen widened stretches of 4.6-9.6 km.
  `world/roadprofile.ts` owns it and owns nothing else. It is a pure function of
  (seed, s), so the spine, its IndexedDB cache and the worker payload — all of which
  carry the centreline and nothing else — are untouched, and a save restores the same
  carriageway because it restores the same seed. `DriveRoad` grew three questions:
  `halfWidthAt(s)`, `lanesPerSideAt(s)` and `laneCentreAt(s, lane)`.
  THE INNER LANE NEVER MOVES. Lane 0 is centred 1.45 m from the crown whatever the
  road is doing, so widening adds a lane on the OUTSIDE and narrowing takes that one
  away: nothing holding the inner lane has to react to a taper at all, and only a car
  in the outer lane has to merge — with at least 209 m of closing wedge to do it in,
  because the outer lane stops counting as driveable while it is still 2.6 m wide.
  Everything downstream reads the local edge rather than a constant: the ribbon's
  cross-section and its collider (the same vertices, still a fixed column count per
  row so the quad strips cannot tear), the painted edge lines, the wheel-polish and
  edge ravel, the terrain corridor and its gravel verge, the road-edge surface
  breakup, pothole lines, and the hazards scattered across the asphalt. Lane dividers
  are dashed paint at ±2.9 m and exist only where the road genuinely offers two lanes
  — which, on a road this decayed, is wherever paint survives at all.
  TRAFFIC SPREADS OUT AND THINS BACK. The traffic setting is the number for the
  ORDINARY road; a widened stretch scales it toward the configured maximum of thirty
  and stops there, so a player who asked for twelve meets twelve on the narrow road
  and up to thirty on a highway section. Cars pick a lane at spawn — slower drivers
  beside the crown, hurried ones outside — keep their headway per lane rather than
  across the whole carriageway, and are told to merge 110 m before their lane closes.
  AND THE AUTOPILOT PASSES WITHOUT MEETING ANYBODY. The corridor planner now receives
  an explicit oncoming boundary and the set of driveable lane centres on the driver's
  own side, and neighbouring cars reach it as obstacles carrying their real speed, so
  a slower car on a wide stretch is passed by moving OUTWARD and coming back: proved
  in `tools/autopilot-bench.ts`, which measures the manoeuvre completed with the body
  never once past the crown. The oncoming-lane gate, its rear-gap requirement and the
  sleeper's refusal to cross are all unchanged and now key off that boundary rather
  than off the sign of a fixed offset.
  Two new proofs: `tools/road-width.ts` walks the profile (continuity to 8.4 mm per
  half metre, no lane ever offered off the asphalt, the homestead always narrow), and
  `tools/road-lanes.ts` builds real chunks and measures the emitted ribbon, its paint
  and its taper. The traffic and autopilot benches are otherwise unchanged against
  their pre-widening baselines, to the digit.
- Cars know what is BESIDE them. Every lane probe starts four metres past the bumper,
  so a car level with the door was invisible to the planner: on a widened stretch a
  driver indicated, moved into the next lane and drove into the car already in it,
  after which the two travelled locked together. One broad-phase proximity query per
  tick now reports every dynamic body within a body length either way, in the ROAD's
  frame, and the planner is handed them as ABEAM obstacles — priced nowhere, blocking
  no line the driver is already on, and vetoing only lines that CLOSE on them. Holding
  the present gap or widening it always stays available, so a car pinned between two
  others is never trapped; and because a neighbour is beside the corridor rather than
  in it, it does not slow anybody down either. Measured in `tools/autopilot-bench.ts`:
  the gap kept while two cars are level rises from 1.11 m — bodies overlapping — to
  2.80 m, and thirty cars on a four-lane stretch ran 75 s in the real game with zero
  contacts.
- Nothing drives into a prop it cannot get round any more. Something STILL in the
  chosen corridor used to be approached at a walking-pace floor with nothing to stop
  the car: the nose scan that was supposed to catch it sees dynamic bodies only, so an
  indexed rock was met at 2.9 m/s. Where the planner still has a way through, the
  crawl is unchanged and a littered road is driven at the same pace as before; where
  it has none, the car now stops a bumper short and waits for a line. The recovery's
  own "something in front" gate was measuring centre to centre, a body length and a
  radius short of the truth, so it read four metres of room while the bumper was
  already touching; it measures bumper to near edge now, like the planner does.
- Only a driver in a hurry shops for lanes. A widened stretch offers a free lane with
  no oncoming traffic in it, so every car took it the moment anything ahead was a
  little slower and a dual carriageway of ordinary traffic became a road where
  everybody was changing lanes all the time. `lanePasses` is now a mode policy and
  only `frantic` has it: everyone else drives the lane it was given — its own or the
  one a traffic merge names — and a car that will not use the next lane no longer
  pays for probing it either. Ambient traffic contains no frantic drivers at all, so
  the stream keeps its place and only spreads across the lanes because it SPAWNS
  spread across them.
- Going round a parked thing is not an overtake. `overtakes` is an appetite for
  passing moving traffic, and pricing the opposing lane out of reach for everybody
  else left a cautious driver facing a rock in its lane with nothing but the shoulder
  — and when the shoulder was taken, with nothing at all. A STILL blocker now opens
  the crown to any driver at a dearer price, with the oncoming-clearance gate and the
  rear check unchanged, so it still only goes when that lane is genuinely empty.
- AND A JAM CAN NO LONGER BE PERMANENT. Reported from play: a prop in one lane, a
  queue behind it, an opposing queue level with its head, five minutes of nobody
  moving. Three things were wrong. The coordinator that hands one head right of way
  required the opposing head to be strictly AHEAD, and a standoff that has crept into
  an overlap — which is how they always end up — matched nothing, so nobody was ever
  granted it; level counts now. It also required the candidate's own sensors to
  report something, which a car held up by an indexed prop with a car level beside it
  cannot do; the standoff is its own evidence. And last, ambient traffic is transient
  scenery, already recycled by distance and trimmed by density: a car that has stood
  still for eighteen seconds and is more than 70 m from the player is now recycled
  too, whatever it got itself into. Near the player nothing vanishes — it keeps
  trying — because a car disappearing in front of him would be worse than the wait.
  `tools/traffic-bench.ts` grows the scenario: a rock in the lane, traffic both ways,
  150 s. Nothing stands for more than 18.4 s of it, against 41 s before, and cars
  still get past the block.
- THE LAKES ARE DUG NOW, and there is one at the house. Reading the dune field for a
  closed depression and filling whatever it found was the old design, and what it
  found was broad and shallow: the smallest lake on seed 1337 was 12,000 m² and 2.2 m
  deep, which filled reads as painted sand rather than as water in a bowl. The dune
  band is kilometre-long ridges; it does not make bowls, so waiting for one is either
  no lakes or flat ones.
  `world/lakes.ts` owns the hollow: a deterministic term in the terrain — collided, in
  the mesh, in the tile worker — cut only where a lake is scheduled, 520-940 m off the
  road where nothing it does can reach the maintained corridor. Its LIP IS SET BY THE
  LOWEST GROUND AROUND IT, dropped 0.4 m below that, which is the one number that
  matters: a bowl cut relative to the height at its own centre built a water tower on
  a dune slope, with the surface standing above the sand the player walked in on.
  Below the lowest surrounding point instead, the surface can never be seen from
  underneath and the basin is CLOSED, so the flood fills it to that lip and stops.
  Each site rolls its own radius (±30%) and depth (±28%) so no two are the same stamp.
  The first lake is authored rather than rolled: 1.5 km along the road, 620 m out, so
  the opening drive has one. The rest keep their 200-300 km rarity — and now every one
  of them holds water instead of one in three. Measured on seed 1337: 14 of 14 sites,
  smallest 82,560 m² and 4.0 m deep, 5.5 m from floor to lip, and the fringe planting
  is split across two streaming slices because a 500 m shoreline no longer fits in one.
  `tools/water.ts` swapped its "the terrain is untouched" check for the opposite one —
  the ground under a lake is a bowl, and the same bowl in two independently built
  terrains, which is what the worker needs.

- Everything beside the road keeps its distance from the ROAD, not from the crown. The
  pole line stood at a fixed 6 m lateral, which was the asphalt edge plus 3.1 m while
  every road was 5.8 m wide; on a widened stretch it was 0.2 m off the paint with the
  lamp arms over the outer lane. Poles are authored as a SETBACK now and the lateral is
  derived, so the whole line sweeps out and back through a taper exactly as the
  carriageway does. Scattered rocks and cacti keep 6.1 m from the local edge rather
  than 9 m from the crown, and the distance monuments carry a side and a setback
  instead of a lateral. The lamp arm's reach is unchanged and did not need changing:
  the setback is constant, so the head keeps its 0.7 m past the paint at any width.
  `tools/roadside-setback.ts` measures what the real providers emit against the local
  edge on a narrow chunk and a fully widened one.

- Ambient cars are lit from the first frame they are visible. Dipped beam is applied by
  the driver, and a car does not drive during the 0.8 s settle after its drop, so every
  ambient car spent the start of its life dark - which the traffic bench had been
  reporting, correctly, as "18 of 19 cars lit".

### Removed

- TRACTION CONTROL, and its lamp on the dashboard. It was built to answer a friction
  table that mixed a Rapier cone budget with a plain ratio, and once that table became
  one honest coefficient per axis the aid had nothing left to do but subtract. It was
  holding driven wheels at asphalt's 12 per cent slip on surfaces whose own peak is 30
  per cent, which is the exact band a digging tyre needs, and on a front-driven
  microcar on an 18.7 degree sand slope it was cutting a third to a half of the drive
  away — 2185 N of thrust against the 2205 N the grade asked for. The tyre model
  already refuses to make force past its peak and decays it to a sliding plateau, so a
  wheel that spins simply makes less force, which is the honest penalty and the one the
  player can feel. Gone with it: `WheelVisual.tcsCut`, the per-wheel cut smoothing,
  `Vehicle.tcsActive`, the HUD readout field, the `hud-tcs` element and its stylesheet
  rules, and the bench's TCS duty-cycle column.

- ANCHOR GIZMOS, and the eleven part kinds that existed only to hang on them. Bolting
  a spare door to a car's roof was a mechanic with no gameplay behind it: nothing
  spawns it — POI loot is tools and fuel cans, and `world/poi.ts` says in as many words
  not to re-add part spawns there — so the only way to reach an anchor was the
  pause-menu dev dispenser. Gone with it: the anchor table and its resolved positions
  in `model-fits.json` (5 entries × 20 bodies), `render/slotghosts.ts`, the
  `gizmo_attach`/`gizmo_detach` deltas, `CarState.gizmos`, and the save migration that
  read them.
  `wheel`, `door`, `hood`, `trunk`, `battery`, `seat`, `mirror`, `bumper`, `headlight`,
  `exhaust` and `dashboard` are all deleted from the registry and the mesh builder:
  eleven kinds and thirty-nine variants whose coordinates were read by nothing but the
  mesh that drew them. What a car can actually be serviced with is unchanged — engine,
  turbine, radiator and fuel tank in the four typed bonnet cells, plus the fourteen
  gearbox variants that carry the catalogue's own ratios.
  A save written before this keeps its cars, its fluids, its stickers and its boot;
  the anchored parts are dropped rather than invented into the world as loose scrap.
- `tools/anchor-parts.ts` and `tools/service.ts`. The first tested the mounting rule
  that no longer exists. The second had not run since the abstract freight system was
  removed in 0.14.0 — its `src/world/freight` import stopped resolving — and what it
  covered lives in `cooling.ts`, `cooling-drive.ts` and `road-scale.ts`.
- `tools/trunk-grid.ts` was calling `intersectTrunkGrid` and `trunkCellLocal`, which
  had been renamed to `intersectStorageGrid` and `storageCellLocal` when the bonnet
  grid landed; the bench had been failing to load ever since. Repaired rather than
  retired, because it is the check that the aim ray still reaches all eight cells of a
  grid nobody can see.
- `SUSP_FASTBACK` had no users and described a body from the dropped Stylized pack.

### Changed

- THE FRAME BUDGET NO LONGER OVERCLAIMS. It said its remainder was "the CPU blocked, most
  often on the GPU", and the first machine able to check it disproved that: measured on a
  4090 at 144 Hz, the remainder was 1.63 ms while the GPU was busy 6.94 ms. Submission is
  pipelined, so the CPU is already assembling the next frame while this one is drawn, and
  the remainder bounds the CPU and nothing else. Reading it as "the GPU is the constraint"
  was wrong, and the line says `not CPU` now. Where a GPU timer exists the report gives the
  verdict outright, comparing the measured GPU time against the interval — `GPU 6.94 ms
  against a 6.81 ms interval: the GPU sets the frame time`; where it does not, it says
  plainly that the budget cannot answer the question.
- `simulation ticks per frame` was a CONSTANT. It was computed as `simulationHz /
  simulationHz`, so it read `1.0` at every frame rate and told the reader nothing. It is
  measured now, in the profiler, where the real presented rate is known.
- The "halving the frame rate would cost" line is printed only where a cap exists; on an
  uncapped desktop it was advice about a setting the player had not made.

- THE FRAME REPORT WAS UNREADABLE ON THE DEVICE IT WAS BUILT FOR. `white-space: pre`
  with `overflow-x: auto` meant a long line ran past the panel and scrolled silently away
  in landscape on a phone — the frame budget line was written, rendered, and never seen,
  which is the worst possible outcome for a readout that exists to be read there. It is
  `pre-wrap` now; the aligned summary table stays aligned and the prose lines reach the eye.
  Verified: the readout reports nothing to scroll (`scrollW 596` against `clientW 596`).
- The report prints DRAW CALLS AND TRIANGLES per frame, because that is what separates a
  frame which is slow because it FILLS a lot of pixels from one which is slow because it
  ISSUES a lot of work — and the two want opposite fixes. Three resets its counters at the
  start of every `render` call, so with two passes the counters described only the second,
  which is a single fullscreen triangle: worse than no reading at all, because it looks
  like an answer. Auto-reset is off and the frame resets them explicitly. Measured on a
  desktop at the top rung: 121 calls, 217k triangles.

- THE FRAME REPORT SAYS WHAT THE FRAME IS WAITING FOR, which is the question a phone
  without a GPU timer otherwise cannot answer at all. A new line gives the budget: the
  presented interval, the CPU work inside it, and the difference. The difference is not
  idle — it is the CPU blocked, most often on the GPU, and its SIZE is what decides whether
  to go after pixels or after the simulation. It is exact rather than estimated, and it
  needs no timer, so it works on the devices that have none.
- `GPU not measurable` was reported for two different situations, and only one of them is
  about the device. `gpuFrameMs` is also null immediately after any resolution change,
  because the controller discards its evidence, so a machine that measures its GPU perfectly
  well was being told its GPU could not be measured — which sends somebody hunting a browser
  limitation they do not have. The report now distinguishes no-timer from no-sample-yet, and
  where there is no timer it says how to attribute the waiting by hand: toggle MSAA and
  re-read, because a waiting that shrinks with it is the scene pass and one that does not is
  elsewhere.
- The window opened at the first presented frame rather than at the first work of any kind,
  and a frame's simulation runs BEFORE its `beginFrame`. The elapsed time the report divides
  by was therefore shorter than the work it contained: measured, 13.00 ms of work against a
  12.79 ms interval, which clamped the waiting to zero and hid the very figure the report
  exists to show. Opening on the first sample of either kind makes the span exact by
  construction.

- A PHONE IS NEVER ASKED FOR A DESKTOP'S LIGHT LOOP, which is the largest per-pixel cost
  in the game and the one that explains the heat. Three compiles the light count into every
  lit material as an unrolled loop bound, so every lit fragment evaluates every slot —
  dark ones included, which is why unused lamps are held at an intensity of 1e-8 rather
  than switched off. The bill is PIXELS x SLOTS on every frame, and it does not care that
  most of those lights are dormant. The top rung's desktop budget is 18 spotlights plus 8
  point lights; a phone presenting 1.44 megapixels at 50 FPS was therefore evaluating 26
  lights on every lit fragment — 37 million light evaluations per frame and 1.9 BILLION per
  second. Measured on the device, that frame had 11 ms of CPU work in a 19.7 ms interval,
  so the CPU was not the constraint; the fill was. A phone now gets its own budget, capped
  at the desktop STANDARD counts: 2/2, 4/4, 6/6 against the desktop's 2/2, 6/6, 18/8. The
  top rung's phone cost falls from 2.25 G light evaluations per second to 1.04, and the
  bench prints that figure for every rung so the ceiling has a reason attached to it rather
  than being a number somebody liked.
- The same treatment for the star field, which is the other place where a phone was being
  handed more than its screen can show: the top rung draws to magnitude 8.5 — the WHOLE
  catalogue, 77,667 additive points — against 45,617 at 8 and 15,447 at 7. A phone now
  caps at 8, which past a phone's pixel density is not a visible difference and is a real
  blend-rate saving.
- Both are threaded as REQUIRED parameters rather than defaults, so a call site that forgets
  to say which presentation it is building for fails to compile instead of silently costing
  a phone a desktop's fill rate. That is what caught `mirage-lab`, and it is why the
  readers now ask `vehicleLightSlotsFor(quality, mobilePresentation)` instead of indexing a
  per-tier record that could not tell the two apart.
- The frame report prints the light budget in its header — `light slots 6 spot + 6 point =
  12 per lit fragment` — because it is invisible everywhere else: the lamps are dormant in
  daylight and nothing on screen suggests that every lit fragment is still paying for all
  of them. Pixels x slots is the number that explains a warm phone, so it is printed rather
  than left to be inferred. The menu's tier hints say the same thing, and describe the
  budget the presentation actually gets.

- THE FRAME REPORT COPIES ITSELF. The readout is read on a phone, held in a hand, by
  somebody who then has to get the numbers somewhere else — retyping eight lines of
  monospace off a screen is not a realistic way to move a measurement, so the report moves
  itself. Verified end to end in a browser: the button reports `Copied` and the clipboard
  holds the exact text on screen, which is captured rather than re-read so that what was
  copied can never disagree with what was being looked at.
- THE REPORT SAYS WHAT A FRAME RATE CAN AND CANNOT REACH, because that is the lever that
  was found to work. The simulation runs at a fixed 60 Hz whatever the display does, so
  its cost per second is identical at every presentation rate — a slower frame rate does
  not make the car cheaper to step. The render half is the opposite: it is paid once per
  PRESENTED frame, so it scales exactly with frame rate, and the report now shows the two
  split apart along with what halving the rate would cost and the floor below which no
  frame-rate cap can go. `tools/frame-report.ts` proves the claim by construction: the
  same work presented at 30 and at 60 FPS gives 30 ms/s of simulation both times and
  exactly double the render at 60.
- Sections are grouped by the half of the frame they belong to, and each is given its
  share of THAT half rather than of the whole. A share of the whole was a lie while the
  sections nest: measured on a real machine, the shares added up to 120%. The outer
  measurement gets no share of itself.
- The GPU-is-unmeasurable case no longer costs a loading screen. `detectGraphicsTier`
  walks rungs and re-settles after each one, and a settle that cannot reach a verdict
  burns its full twenty-second deadline — so a machine whose driver reports no usable GPU
  timing would have paid twenty extra seconds to learn nothing. It now refuses to run
  without a verdict from the launch settle, which is the only thing that makes the
  measurement mean anything. Observed happening while instrumenting.
- The simulation rate in the report comes from `FIXED_DT` rather than being written as
  literal 60s in the header and the split, so the two cannot drift from the loop they
  describe.

- A PHONE'S RUNG NOW BUYS SHARPNESS; ITS HEAT IS THE PLAYER'S. The rung owned both, and
  the coupling was the whole problem: a phone drawing a 1440p screen at the weakest rung's
  960x540 is visibly soft, and the only way off that picture was the next rung, which
  brought 60 FPS, a sun shadow pass, and — on the top rung — a 25 km vista with it. How
  sharp the picture is and how warm the device gets are different questions.
  THE FRAME RATE IS A SETTING, not a property of the rung, because nothing else can answer
  it: a browser exposes no thermal state, no battery temperature and no clock speed, so the
  game cannot know a phone is hot, only the person holding it can. It is also the largest
  lever there is — half the frames is half the GPU work, half the render-side CPU and half
  the presenting, while the simulation keeps its fixed 60 Hz so the car handles
  identically. It appears on the Display tab only where it means something, and defaults
  to 30 FPS: a phone that is too slow can be made faster by moving up the ladder, and a
  phone that is too hot has no such lever.
  A PHONE NEVER GETS A SHADOW PASS. The shadow pass renders the world a second time from
  the light, which is the largest sustained GPU cost a phone can be handed, and a phone's
  screen is small enough that what it buys is small. Off on every rung; the desktop column
  keeps the choice. This also exposed a live defect: `setQuality` re-derived the rule as
  `quality !== 'acceptable'` instead of reading the table the constructor used, so the two
  disagreed the moment the table stopped matching that expression.
  A PHONE NEVER GETS THE 25 KM VISTA. The pixel cap does nothing for the vista, which is
  CPU terrain sampling set by RADIUS: measured on the vista, a cell rebuild costs 13.0 ms
  at 4 km, 17.3 ms at 8 km and 32.8 ms at 25 km on a 5950X, and a phone core is slower
  than that. A rung now NAMES an authored vista pair rather than inventing a horizon, so
  the fog stays the tuned one, and the top rung's phone vista drops from 25 km to the
  standard 8 km. Every other phone configuration is unchanged.
  AND IT IS NOT ASKED FOR MAXIMUM CLOCKS. `powerPreference: 'high-performance'` picks the
  discrete GPU on a desktop, which is what it is for; on a phone there is one GPU, and
  asking for maximum performance is asking the driver for clocks the game does not need
  and the device cannot shed.
- THE WHEEL SPRAY POOL SLEEPS. It scanned all 400 slots and flagged three dynamic
  attributes on every frame whatever it held — 400 pointless tests and 8,000 bytes of
  attribute flags for a draw of 400 discarded points, on every frame a wheel was not
  slipping, which is most of them. Motes in flight are now counted, so an empty pool costs
  one comparison.
- `tools/adaptive-quality.ts` now asserts contracts instead of tuned numbers. It pinned
  the settle window ("the 8th slow sample steps down") and the per-tier floor constants,
  and had been failing since the settle window was raised from 7 samples to 8 + 30 for the
  launch settle — reporting a change of opinion rather than a defect, which is why nobody
  was reading it. It now drives the controller until it acts rather than counting samples,
  and asks whether a machine in trouble is protected at all: brief slowness does not move
  the resolution, sustained overload does and stops at a floor, an installed floor is
  honoured, and recovery is earned. It passes for the first time in a while, and reports
  what it measured.

- GRAPHICS IS ONE LADDER THAT OWNS EVERYTHING, and the pixel budget is absolute on every
  rung. There were three defects, and the first one is why this game ran badly on a
  mini-PC.
  THE TIERS WERE A DISPLAY PERCENTAGE. Resolution resolved as `min(DPR x multiplier, DPR
  cap)`, which on any screen whose device-pixel-ratio is 1 — every 4K television, every
  monitor at 100% scaling — comes out at exactly 1.0 on EVERY rung. Measured across the
  four machines this is played on: `standard` on an Intel N100 on a 4K television and
  `standard` on an RTX 4090 on the same television both resolved to 8.29 megapixels. The
  only rung with an absolute budget was `acceptable`, at 1.44 — so the sole choice a slow
  machine had was to fall 5.8x, from 8.29 megapixels to 1.44, with nothing in between. It
  now resolves as `min(DPR x supersample, 2, sqrt(ceiling / cssPixels))`, and each rung
  carries its own absolute ceiling: 1600x900, 2560x1440, 4800x2700. The N100 on a 4K
  television now gets 3.69 megapixels on `standard` — 2.2x less than before — and the
  workstation keeps 12.96 on the top rung because supersampling is a rung's own business.
  THE DISTANCE SETTING WAS NOT A SECOND AXIS. It never changed what the world STREAMS —
  the desert tiles (±2 of 240 m) and road chunks (±6 of 200 m) are identical at every
  tier. What it changed was the far plane, the vista's ring tessellation, how many mesas
  are built and the fog, and measured on the vista that is 13.0 ms per cell load at
  1.5 km against 32.8 ms at 25 km, with the mesa vertex count going from 897 to 16 419.
  That is the same question the quality tier already answers, so as a free control it
  only offered a player the chance to pick 25 km on a machine that cannot rebuild a cell
  inside a frame. The horizon is on the rung now, an old save's `viewDistance` is
  deliberately dropped rather than guessed at, and the menu's Horizon segment is gone.
  HALF OF IT DID NOT APPLY. The two local-light pools are compiled into every lit
  material as an array size, so they were built once at boot and a tier change left them
  — while the menu implied the whole setting took effect on resume. They still wait for
  the next load, because recompiling the world's shaders mid-session is worse, but the
  menu now says so in the tier's own words, and the hint is GENERATED FROM THE TIER TABLE
  so a label cannot describe a rung the player is not getting. That drift is exactly how
  the old menu promised a horizon change on resume while the light change silently waited.
  Two smaller ones went with it: choosing the weakest rung force-wrote the independent
  MSAA preference to off, so the two controls contradicted each other, and the comment
  claiming a tier change updated the sky's "probe resolution" described something
  `Sky.setQuality` has never done.
- THE FIRST LAUNCH MEASURES THE MACHINE. Nothing auto-detected the GPU, and the comment
  defending that said guessing wrong either robs a capable machine or leaves a weak one
  stuttering — true of guessing, and not true of measuring, which the launch already
  does: it settles the drawing-buffer scale under the loading cover against real GPU
  timer queries. So the rung is walked against that verdict, in both directions and
  asymmetrically, because being wrong is not. DOWN while the machine is giving away more
  than a fifth of the resolution it was promised — that is a stutter the player cannot
  diagnose. UP while it is comfortable, and PUT BACK with its own settle if it does not
  fit, so that a player who never opens the menu is not pushed into stutter by the
  courtesy. The result is stored, so the next launch respects the answer instead of
  measuring again.

- CONTACT PATCHES UNDER EVERY CAR. A car is told apart from a car-shaped object by one
  thing: where its weight is. A tyre is a rigid mesh pinned to a ray and it does not
  squash, so nothing on screen reported whether a wheel was carrying anything — until
  now four soft dark ellipses, sized to the footprint and DARKENED IN PROPORTION TO THE
  LOAD, which report it twice: the car sits on its wheels rather than hovering over them,
  and in a corner the inner tyres visibly lighten while the outer ones darken. That
  transfer is the most useful thing a driver can be shown and nothing showed it.
  NOT A SHADOW MAP, deliberately. The one that exists has 7 cm texels and stretches about
  16:1 along the light at a low sun, so a wheel's shadow is a metre-wide smear that has
  detached from the tyre; the cheapest graphics tier switches shadow maps off entirely.
  A patch is affected by none of that and still works at midnight, which is also when it
  matters most. One draw call for the whole frame, filled in nearest-first order so a
  full pool refuses the patches nobody can see, and the quad is built from the contact
  normal and the wheel plane's own forward PROJECTED into the ground, so a patch lies
  flat on a banked or rutted surface instead of standing up through it.
- CONTACT OCCLUSION in the fullscreen pass, from the depth the scene pass already wrote.
  What it adds is the one thing a desert has none of and every object in one needs: the
  darkening where something meets the ground. Rocks, poles, car bodies and tyres all sat
  ON the sand with nothing under them. Six taps on a disc whose radius is a WORLD
  distance, so an object is darkened by the same amount at any range, counting a sample
  as an occluder when it is nearer the eye than the fragment's own plane and within a
  depth band of it — the band being what stops a distant hillside darkening the road it
  stands behind. Driven with a synthetic depth buffer against real GL: a 20-degree ramp
  — the steepest face this world generates — darkens by nothing at all; a 0.4 m step at
  its foot darkens by 32 of 255 levels; a 2 m cliff does not register, because a cliff is
  the shadow map's job and this is for contact. Off on the cheapest tier, where the six
  extra depth reads are exactly the kind of cost that tier exists to avoid.
  The textbook slope correction — fitting a local plane from four extra taps — was built,
  measured and REMOVED: a 0.35 m disc steps only 0.13 m along a face as shallow as this
  world's, which the band already ignores, so it bought nothing and cost the contacts it
  exists to find (a 0.4 m step's darkening fell from 32 levels to 22, and a 0.15 m one
  vanished). The shader keeps the note so it is not re-added on principle.

- KEYBOARD TAPS STEER THE CAR NOW. Two soft-centre terms sit in series — the input
  layer's smoothing of a binary key, and the vehicle's own shaping exponent — and the
  second was squaring the first until the bottom of the range did nothing at all.
  Measured, one tap at 60 km/h, road-wheel angle at the peak of the response: a 40 ms
  tap produced 0.00 degrees, 80 ms produced 0.03, and 120 ms produced 1.29. That is not
  a steep curve, it is a cliff, and it is the one shape a discrete input cannot be
  asked to steer with: the player's finest available correction landed on the wrong
  side of it, and the car did not deviate until the tap was long enough to deviate far
  too much. The free play was the larger half of the cause — a backlash window is dead
  travel crossed TWICE per correction, and a player tapping a key makes a correction
  out of reversals by definition, so it was subtracted from every input rather than
  from the rare one. `STEER_PLAY_RAD` comes down from 0.024 to 0.008 rad (0.46 degrees
  at the tyre, the tight end of what a worn box honestly has) and `STEER_INPUT_EXPONENT`
  from 1.55 to 1.25. The same sweep now runs 0.89, 1.43, 1.98, 3.64 and 4.73 degrees at
  40, 60, 80, 120 and 160 ms — smooth across the whole range, still well short of the
  rim, and a light tap is a light correction. What is worth keeping is kept: the centre
  is still softer than the rim, and the play still fades out entirely during a slide.
- SURFACE GRIP IS ONE HONEST COEFFICIENT PER AXIS. The old table mixed a Rapier cone
  budget (`frictionSlip`, 2.6 on asphalt) with a plain ratio (`sideFriction`, 1.0 on
  asphalt and 0.1 on sand), so the two numbers did not mean the same thing and could
  not be compared — which is exactly how sand ended up braking BETTER than Tarmac.
  `SurfaceProps` now carries `longitudinalMu` and `lateralMu` as real peak coefficients
  against a grip-1.0 reference tyre, plus the surface's own `optimalSlip`, with the
  sourcing cited in the file. Asphalt is pinned to the old ladder exactly — 0.988 and
  1.7 — so every existing bench and the whole handling calibration are untouched to the
  digit; only the other six surfaces moved. Sand is now what sand is: longitudinal down
  to 0.44, lateral UP to 0.51 because a tyre digging into a loose material resists
  sliding across it more than it resists rolling through it, rolling resistance up to
  0.16, and its force peak at 0.30 of slip against asphalt's 0.12. Cracked asphalt
  0.84/1.43, gravel 0.72/1.2, rock 0.89/1.5, concrete 0.96/1.65.
  `HandlingTuning.lateralMu` became `tyreLateralScale` — each profile's old ratio
  against 1.7 — so a sporty car keeps exactly the lateral grip it had.
- THE VERGE IS ITS OWN SURFACE. The 3.5 m outside the paint was gravel, which is what a
  maintained district is; a verge is the grader's spoil lying on the road's own
  compacted base, and it does not carry a wheel the same way.
  `SurfaceType.LooseShoulder` is 0.44 longitudinal, 0.8 lateral, 0.06 rolling
  resistance — markedly worse than the road it borders, which is what makes a mistake on
  this deliberately narrow road cost something without being the desert. It is reachable
  only from outside the paint, and the autopilot and the road mesh both know it.
- THE DIG, and it is the one place this simulation lies to the player on purpose. Honest
  sand gives a two-wheel-drive car about 0.13 of mu on its driven axle against the 0.62
  the terrain's own maximum slope asks for: modelled honestly a VAZ-2101 is immobile on
  any sand slope and on most flat sand, which would be correct and would make most of
  this world unplayable. So a driven wheel on sand is granted more grip — it excavates,
  throws material back, and stands on the firmer sand beneath the dry crust.
  IT GATES ON THE CAR'S SPEED, NOT THE WHEEL'S SLIP, and that was the hard half. A grip
  floor keyed to slip is positive feedback against its own input: the dig grips, the
  slip falls, the dig switches off, the slip rises. Traced every step on an 18.7 degree
  slope it settled into a limit cycle of period two — capacity alternating 860, 7879,
  862 and 7815 N with the wheel's surface speed swinging 0.15 to 0.90 m/s on alternate
  ticks — and the thrust averaged to exactly the force needed to hold the car still:
  full throttle, 12 kN of instantaneous thrust, no motion at all. Speed cannot follow
  the slip inside a step, so the loop has nowhere to close; it is also the better story,
  since a wheel excavates in proportion to how long it has been turning without getting
  anywhere. Full below 3 m/s, gone by 10, on sand and the verge and never on the road.
  AND IT HAS TWO HALVES, because grip alone was no use. Raised until the tyre had more
  than twice the capacity the grade asked for, the car still would not move: the driven
  axle was already delivering everything the ENGINE had, 5924 N of thrust against the
  6738 N needed, of which 2163 N was rolling resistance — and no amount of grip moves a
  number the engine cannot reach. The mechanism does not merely grip better, it also
  CARRIES the wheel instead of sinking under it, so the firm ground's rolling resistance
  switches with the friction. Both constants are named, calibrated and argued in the
  file. The concession is deliberately identical for every car, because its purpose is
  to guarantee that the weakest machine in the catalogue can leave the desert, and it is
  a floor granted to two surfaces rather than a blanket grip multiplier. Measured across
  the fleet: no digging surface is a penalty against asphalt, and the strongest vehicles
  on sand reach 30 degrees.

- A CAR NOW WEIGHS WHAT IT IS CARRYING. Mass was the model's kerb figure plus
  whatever hung on the cosmetic anchors, and nothing else: the engine in the bonnet,
  the fuel in the tank, the water in the radiator, the oil in the sump and everything
  in the boot and in the driver's hands weighed nothing at all. Swapping a 1.2 for the
  6.6 diesel changed the torque and left the springs where they were; a full 60-litre
  Volga tank weighed what an empty one did.
  `Vehicle.computeStats` now builds the total as a DELTA from the kerb figure, because
  a factory mass already includes a complete car with its stock parts and every
  reservoir full. Fitted service parts are measured against the ones the model left
  the factory with (`stockBonnetVariants`), the three fluids against full capacity,
  and the boot and the driver's pack are added outright. A stock car therefore still
  weighs exactly what the catalogue says — and a dry one is 45 kg lighter.
  The pack follows the DRIVER, not the car: `main` hands the driven vehicle its
  carried mass each step and tells the last holder it no longer has it, so changing
  cars or stepping out cannot leave a phantom load behind. Re-derived every step
  rather than wired to the four deltas that can move it — `refreshLoad` publishes the
  total always and re-solves the springs only past a 0.1 kg dead band, so a tank
  draining a few grams a second does not rewrite the chassis inertia every tick.
- THE SPRINGS ARE ABSOLUTE NOW, and that is what makes load felt at all. Rapier's
  ray-cast suspension multiplies the rate it is given by the chassis mass, so a
  per-kilogram figure — which is what a ride frequency converts to — gives a car that
  sags to exactly the same ride height empty and loaded. The catalogue's frequencies
  are now converted to newtons per metre at the KERB mass and stored that way; the
  same spring then carries whatever arrives, so a heavy engine drops the nose, a full
  boot drops the tail, and each corner's ride frequency is read from the load rather
  than assumed. `Vehicle.reloadSprings` applies a new load by re-sizing the four
  springs, dampers, travel, rest length and bump stop in place — a full `rebuild`
  would work too and would also free and rebuild the controller, the drivetrain
  binding and every mesh.
- TYRES HAVE A TEMPERATURE, and it is what the lateral grip is read against. The
  speed falloff it replaces — up to 26% of the cornering grip shed between 50 and
  144 km/h, more of it at the rear — carried a real mechanism (a bias-ply carcass
  squirms and heats) on an implementation that could not be one: written as a
  function of speed it charged a cruising car the same 26% as one scrubbing a
  roundabout, and it had no state, so a tyre abused into overheating recovered on the
  instant grip was asked for again.
  Each wheel now integrates an energy balance. Heat in is the power at the contact
  patch — force times true slip speed, longitudinal and lateral — plus the share of
  the ROLLING-RESISTANCE power that lands in the tyre, which is hysteresis and is the
  only reason a tyre warms on a straight road at all. Heat out is Newton's law against
  the air with the film coefficient rising with airflow. The grip factor is exactly 1
  at ambient, so nothing about the calibrated straight-line figures moved; it rises to
  +8% at 60 C and falls to -22% at 120 C, so a tyre comes IN as it is worked and goes
  OFF if it is abused. Measured through the live game: a car cruising this road climbs
  from 29 C to 55 C over two minutes and gains 7.6% of cornering grip on the way, with
  the front and rear axles reading different temperatures; a stopped car cools.
  The heat capacity integrated is the TREAD's, not the whole wheel's — 4 kJ/K rather
  than the wheel's real 22, which would give an hour-long time constant and a state
  that never arrives.
- The dead half of the tyre model is gone with it. `SLIDE_SIDE_GRIP` was a hard floor
  under the friction ellipse's lateral term — a sliding tyre kept 60% of its grip
  whatever it was doing — and the speed falloff above is deleted rather than tuned.
  The ellipse itself is now the real one, read against the force the SAME tick's
  longitudinal pass computed; the wheel field that stored it for "the next step" was
  read by nobody, and the comment claiming the ellipse used it was simply wrong.

- Medicine is now consumed with E from the selected hand slot. The two-second action
  uncorks the bottle, tips both modelled pills into the mouth, and releases the empty
  container; its cap and bottle continue as separate physical debris and remain where
  they settle nearby. The label now wraps the bottle and carries no dose text, while
  primary fire no longer consumes medicine.
- Ambient traffic keeps its 60 Hz vehicle physics but now replans its expensive
  multi-ray driving corridor at 45 Hz. At 23 live cars this cut controller calls by
  24%, physics raycasts by 28%, and traffic-update CPU time by 26% in the live game.
  Queue arbitration also reuses its two sorting buffers instead of allocating them
  every physics step.
- Dry asphalt now starts from `#9e9c9d` instead of near-black bitumen, while cracked
  districts remain a distinct, slightly darker warm grey. The existing aggregate,
  bleaching, wheel paths, repairs and coarse mottling still break up the surface, with
  an added subtle warm/cool chip variation so the lighter road does not become flat.
- Nothing beside the road stands on air any more. The desert is dunes, and measured
  through the real generators the ground under a 14 m footprint carries 1.5 m of
  height range at a 9-10% tilt — so a structure placed from ONE centre sample stood
  on one corner and floated on the other three. It is a slope, not a bumpy field:
  fitting a single plane through that footprint leaves only 0.39 m, which is why the
  fix is a plane rather than a finer sample.
  `world/footprint.ts` fits it: nine samples, one least-squares plane, and the three
  answers a builder needs from it — `yAt` for a vertical member's own footing,
  `seatAt` for a plumb box that should be buried at its high corner rather than
  hanging at its low one, and `roll`/`pitch` for anything that lies ALONG the ground.
  Gas stops and workshops now pour a concrete apron whose TOP IS THAT PLANE, so they
  follow the grade instead of cutting a level terrace into a dune, and the step a car
  meets is the ground's own deviation from the plane rather than the metre and a half
  a horizontal pad would need. Everything above it is placed on the plane
  analytically, with no sampling at all: the canopy roof is level and set to clear the
  HIGHEST post base, and each post is then cut to reach its own footing — on a 25%
  site the old posts stood a metre proud of the roof they were supposed to hold up.
  Bench legs are cut the same way. Camps take the tilt instead of a slab: the tent
  and every crate lie along the slope. Parked courier cars and wreck shells lie along
  it too, with the derelict lean added to the ground's own rather than used instead of
  it. Mirage city blocks are seated on the lowest corner of their own footprint, and
  stranded hulls take the keel angle of the dune they are on.
  The homestead's slab keeps its behaviour and now asks the shared fitter for the
  highest ground under its pad. `tools/poi-grounding.ts` walks 60 km of stops and
  proves every piece is either on the ground or on something that is, and that no post
  or leg stops short of what stands on it.
- Open-desert corrugation is more pronounced: its ten-metre wave amplitude rises from
  0.24 m to 0.36 m. The shipped heightfield bench measures 0.40-0.44 m/s RMS kick
  along the open-desert samples at 60 km/h, while the standstill escape census remains
  at 0% blocked and 0% stranded across 501,696 position/heading pairs.
- New saves start with ink strength at 20% instead of 50%; existing saved preferences
  remain unchanged.
- Ambient traffic now keeps dipped headlights on throughout the day and night so
  approaching and receding cars remain legible against the desert.

### Fixed

- A SHIPWRECK IS A SOLID NOW, and the fleet no longer draws itself as Xs. The wrecks
  were flat cards, and a card is the wrong instrument for a seventy-metre hull: they were
  TWO PERPENDICULAR copies of one hand-drawn profile, the trick that keeps a palm from
  vanishing when you look down its edge. On a ship that second copy is a whole second
  vessel at right angles, which is why the graveyard read as "/" and "\" crossing. It was
  never a placement fault — across a whole fleet the closest two hulls sit 1.4 m clear,
  and the report was of one hull crossing ITSELF.
  Measured on the old geometry: of its 109 edges, 83 were open boundary, it had TWO
  distinct normals between all 45 triangles, half its vertices had a perpendicular twin,
  and its extent was the full length along both axes. Two shells, no volume.
  The hull is now lofted as a closed body: a station list from stern to bow, each station
  carrying its own half-beam and its own keel and deck heights, consecutive stations joined
  into rings. The sheer line rising to the bow, the plan narrowing forward and the bilge
  turning all fall out of two one-dimensional tables instead of being drawn face by face.
  Deckhouse, funnel, mast and boom are solid boxes on top of it. Measured: 276 triangles,
  120 distinct normals, ZERO open edges, positive signed volume, and a body 0.78 long by
  0.08 in beam where the old one was 0.90 by 0.90.
  The winding is settled by the geometry rather than by hand — a closed surface encloses a
  positive signed volume, so the sign is measured and the triangles flipped when it comes
  back negative — and the material drops to single-sided, because a solid does not need its
  own inside drawn. That DoubleSide setting was the other half of why these read as planes.
  Because a solid has a beam of its own, the wrecks no longer have to lie broadside to the
  road to be legible, so they keep the angle the sea left them at.
- `tools/wreck-hulls.ts` keeps all of it honest: that the hull is genuinely closed (every
  edge shared by two triangles), that it has volume and more than two normals, that its
  beam is a beam rather than a second length, and that no two hulls in a fleet intersect.
  The bounds are the failure it was written against, so it reports the old geometry as
  "NOT a solid (open 83, normals 2)".

- A mesa dissolves in 18 seconds instead of 36. It starts fading with a kilometre of
  clearance, which a car at a cruising 80 km/h takes 45 seconds to cross — so the old
  fade occupied four fifths of the whole approach and the driver watched it for most of
  the way in. At 18 it is over in the first 40 per cent and the rest of the approach is
  spent with the thing simply gone, which is what makes it read as an event that happened
  rather than as a long fade that ran alongside the drive. `tools/vista-check.ts` now
  measures the duration rather than trusting the constant: it steps the animation in
  fixed increments and reads off the times it takes to pass half and to finish, which
  reported 9 s and 18 s.
- The vista bench's sparkle-pool assertions are gone with the pool. They outlived the
  animation they tested — `vista.ts` has no sparkle pool at all — so the bench failed at
  every run on an invariant about apparatus that no longer exists, before reaching the
  dissolve checks behind it.

- THE SCREEN CAME BACK. The contact occlusion added in this release darkened FLAT OPEN
  GROUND under the driving camera — measured, empty desert went to 219 of 255 in a band
  three to six metres from the eye, a soft blob that followed the car because the camera
  follows the car. That is the whole of what a player reported as ghosting around the
  vehicle and pale bubbles drifting over the desert: one artifact, not two. Nothing was
  occluding anything. The ground's own depth changes fast with screen position at close
  range, so the far side of the sample disc is genuinely further from the eye than its
  centre, which is exactly what an occluder looks like to a test that compares depths and
  nothing else. Three attempts at cancelling that gradient each traded one artifact for
  another, and the pass is REMOVED rather than patched a fourth time: it was worth a
  grounding cue, not a rewrite of the shader's depth handling, and the contact patches
  below do the same job from data the vehicle already knows. The shader now compiles and
  renders under a real GL context, which was checked directly after the removal.
- Contact patches stopped being stripes. Their length was taken from the wheel radius at
  0.95 of it, which on a Zhiguli drew 0.56 by 0.21 m — three to four times too long, and a
  stripe reads as a smeared shadow or a tyre mark rather than as a wheel standing on
  something. A real footprint is about as long as it is wide, because its length is set
  by load and pressure rather than by radius; 0.35 of the radius is a real patch's
  half-length, and the patch is square at 0.21 by 0.21 m on the same car.

- LETTING GO OF A PEDAL NOW MEANS SOMETHING. A keyboard pedal is a switch, so the input
  layer's ramp is the only thing that turns a press into a dose — and the release was
  the half that was wrong. At a 0.3 s decay, releasing a key did not release the pedal:
  measured as an equivalent hold, the tail delivered 0.28 SECONDS of pedal at every
  press length, so a 40 ms tap put down EIGHT times its own press after the key came up.
  That is the brake reported from play as an anchor — a tap was not a light touch, it
  was an unmodulated heavy one, because the driver's release kept pushing the pedal in.
  On the throttle it was the mirror image: the pedal took a third of a second to come
  off, so lifting off did not lift, and the car kept pulling. Feathering, which is how a
  keyboard driver modulates, could not reach below an AVERAGE of 0.26 pedal at any duty
  cycle; it now reaches 0.08, and the whole band between is available.
  The rise went the other way, 0.18 s to 0.3 s, and for the opposite reason: eleven
  frames to cross the entire travel is less time than a human can time a release in, so
  there was nowhere in the middle to stop and every press landed at 1.0. Measured with
  the foot brake from 60 km/h, speed shed over two seconds — against 3.6 km/h of plain
  coasting — a 30 ms press now takes 3.8, a 250 ms press 6.3 and a one-second press
  18.6, where the old shaping gave 4.5, 10.0 and 23.8 with a 0.28 s tail on all three.
  The rise is deliberately not made slower than 0.3 s: pedal travel has to stay
  available quickly, because holding 1.0 rather than 0.8 is worth 33% of this car's
  acceleration (0-100 in 22.4 s against 29.7 s) and 16 km/h of top speed. A keyboard
  pedal is dosed by TIMING the press, not by capping the top of it.

- The handbrake no longer launches the car. Reported from play: letting the handbrake
  off made the car jump. The parking hold works by teleporting the chassis back to the
  pose it latched, every step, and nothing checked that the car was standing on its
  wheels when it latched — so a handbrake pulled during the drop after a spawn, or on
  any car whose suspension had not settled, pinned the body IN THE AIR at whatever
  height it happened to occupy. It then hung there for as long as the brake was on, and
  on release it fell the whole distance and bounced. Measured on a hatchback held from
  the first step: pinned 0.748 m above its resting height with every wheel unloaded,
  then a 2.45 m/s impact, a rebound to 0.265 m and three more oscillations. The latch
  now requires the springs to be carrying at least 45 per cent of the car's weight — a
  car genuinely parked sits within a few per cent of its own weight, so the threshold
  only has to separate "on its wheels" from "in the air". Release now drops 0.011 m
  with no rebound. The same guard corrected every bench that measures a car on a slope:
  they had been releasing a suspended body too, and reporting the fall.
- Gravel no longer out-climbs asphalt. On the old table the fleet's standing-start
  ceilings were 10 degrees on Tarmac and 21 to 25 on gravel — a loose unsealed surface
  with roughly twice the thrust of sealed Tarmac, which is the same class of error that
  had sand braking better than asphalt, and it is what the old "pulls away on an 18.7
  degree gravel incline" regression check was pinning in place. That check asserted a
  grade on a surface that forms none of the world's slopes: the only gravel that exists
  is the homestead yard, which is flat. It now asserts the relation instead, both ways
  round — gravel is worse than asphalt, and it is not a bog — measured with a new
  bisection helper on the real car.
- The desert escape benches were reporting NaN, and had been computing their answer from
  a friction constant that no longer existed. `desert-ride.ts` and
  `desert-washboard.ts` duplicate the vehicle's tuning on purpose — importing it would
  mean exporting private constants for a tool — so they kept a `LOOSE_CRAWL_MU_FLOOR`
  and a `frictionSlip` that the surface rewrite deleted. Updated to the model that
  exists: a stopped car on sand is ALWAYS digging, so the dig's coefficient and the
  dig's rolling friction both apply. Measured over 3.0 million (spot, heading) pairs
  inside 560 m of real desert, ZERO are stranded — no car can be parked anywhere in this
  desert that it cannot also drive out of.

- The bonnet camera no longer sits inside the car. The mount is measured at load time
  by sweeping the bodywork over the front third of the model, and the sweep multiplied
  each sample by the pack's scale a second time — `matrixWorld` already carries it. On
  every centimetre-scale body, which is the whole Soviet pack, the window then contained
  no geometry at all: the highest sample stayed at its seed value, the box floor, and
  the camera looked at the road from inside the cabin through the dashboard and bonnet.
  Measured before the fix on a VAZ-2103: 0.71 m of bodywork directly ahead of the mount,
  0.08 m below it. It is now 0.19 m above the chassis centre on that car — 0.11 m of
  bonnet under it and nothing in front — and the mount lands between 0.19 m and 0.45 m
  above chassis centre on the cars, with the cab-forward UAZ truck capped at roof height
  rather than floating above its cab. `tools/hood-mount.ts` casts against the real body
  geometry of all twenty models and fails on a mount that looks through its own car or
  that stands on nothing.
- `tools/service.ts` is gone. It had not run since the abstract freight system was
  removed in 0.14.0 — its import of `src/world/freight` no longer resolved. The service
  rules it covered are not lost: `tools/cooling.ts` and `tools/cooling-drive.ts` hold
  the thermal model and its wiring, `tools/road-scale.ts` the destroyed-engine path.
- `engine_i4_2445` finally fits the body that runs it. The UAZ-330364 is a `truck`, so
  the fit list excluded the van's own engine from any picker filtered by body class.
  Installation never checked it — `bonnetAccepts` reads the part kind — so this was a
  rule that only ever hid the right answer.
- Diesel is still stocked, and the comment that justified it is not lying any more. The
  gas-stop split claimed 8 of 46 bodies ran on diesel and named the Land-Rover-shaped
  utilities and the vans; none of those bodies has existed since the Stylized pack was
  dropped, and no catalogue entry runs on diesel at all. The 15% share stays, for the
  two diesel engines a player can fit, but the note now says that instead.

- Autopilot cars no longer treat a breakable dirt pile as an invitation to hit it:
  every indexed road prop is planned as a solid obstacle. A car already pressed
  against one recognises the contact in 1.6 s, reverses on one lock, keeps that lock
  until its backward roll has stopped, and then pulls forward on the opposite lock.
  The forward arc now gets its own 1.6 s instead of spending that time braking in the
  wrong steering direction. In the real-physics bench the wedged car clears the prop
  in one recovery attempt and drives 99 m in the 30-second scenario; the permanent
  checks also cover a non-disappearing breakable pile, steering polarity, traffic
  beside a blocked lane, ordinary road holding, and repeated attempts at a true wall.

- Cars no longer flicker at the road's start. Reported from play: bodies blinking on and
  off at the beginning of the road while no car ever arrived there. A `Vehicle` joins the
  scene at construction, but the pose it is DRAWN at came only from its interpolation
  snapshots, and those were primed by the first `postStep`. The loop runs a fixed step
  only once its accumulator has filled, so above 60 fps there are frames with no step in
  them at all — and an ambient car is created from a model-load callback, between frames.
  That frame drew the car at the floating origin, which while the player is parked at the
  homestead is thirty metres away on the road. The snapshots and the drawn group are now
  set from the body the moment it exists, and again on every teleport — where the same
  hole drew a car at its OLD position for a frame. `tools/runtime-lifecycle.ts` checks it
  by drawing a car that has never been stepped; before the fix it drew at 0, 0 for a car
  created 3 km away. The spawner itself was measured at the same time and is not at
  fault: parked at the homestead, the stream fills to its target, oncoming cars arrive,
  turn in the bulb and drive back out.
  That bench had also been failing its own model preload since it only installed blank
  textures, and the model pipeline reads `self` and a viewport size off `window`.

- Traffic no longer crawls. A driver's speed is scaled by the surface under it, and
  this road is 46% graded gravel, 50% cracked asphalt and 4% clean — so gravel's
  0.45 factor was not an occasional loose district but the pace of half the drive.
  With the old caps an ordinary car was given a 26-31 km/h target there and the
  pedal law held it to 20-24. The factor was also charging for grip twice: corner
  speed, braking and grade limits are all computed from the real per-surface physics
  separately. Measured on the real road (seed 42, an 11% gravel climb at 12500 m,
  then cracked asphalt at 10000 m), achieved speed per driver: cautious 24/56 km/h,
  ordinary 31/68, hurried 41/92, against 20/49 for the ordinary car before. A
  careful driver's own cruise went from 70 to 80 km/h and a hurried one's from 95 to
  105; frantic keeps its 130 because the car runs out first — a catalogue saloon
  measures 108 km/h flat out on this road's asphalt.
- The ink outline no longer stops at the horizon. It was gated on screen height,
  which kept the Sobel pass off the sky and every star point but also left every
  silhouette that rises above the horizon undrawn: a tree got a line round its trunk
  and none round its crown. The sky, the stars and the planets all render without
  writing depth, so the gate is now the scene depth the same shader already samples
  for the sand veil. Canopies, roofs, masts and the mountain skyline keep their line;
  the night sky stays clean.
- Wrecks no longer stand inside each other. Two hand-picked footprint radii in a row
  were too small, so hulls at right angles cleared the spacing test and crossed into
  an X. The radius is now MEASURED off the geometry — the furthest vertex from the
  hull's origin in the ground plane — which is exact for a card that is not centred
  on its origin and reaches its full length along both axes.
  The fleet also stands sixty metres off the asphalt instead of thirty-four — a
  seventy-metre hull at the verge is a wall the road runs along — spreads over 1.5 km
  instead of 700 m, and carries half the hulls, which over the longer span reads as a
  stranded fleet rather than a breaker's yard.
- Canopies no longer boil. The acacia's seven foliage clumps were separated by
  thousandths of the tree's height and two pairs shared an offset exactly, which is
  far below the depth buffer's resolution at the range a tableau is seen from: the
  shadow and the lit cap swapped places pixel by pixel as the camera moved. The crown
  is now spread through real depth, interleaved so the clumps that overlap most on
  screen are the ones furthest apart in z — and in the card's perpendicular copy that
  same spread reads as canopy width.
- Palms are three forms instead of one, and a frond is an arc with a lit upper half
  and a shaded underside rather than a flat triangle of one green — the old crown was
  a starfish. A palm encounter now stands ten times thinner at three times the height:
  a sparse stand of giants is an oasis you could walk into, where three hundred
  ordinary ones were a hedge along the road.
- The city has a sunny side. Its blocks are unlit boxes, so two walls meeting at a
  corner were the same number and every building read as a sticker; the box and the
  roof cone now carry a baked light direction in their vertex colours, which costs
  nothing and gives the skyline its third dimension back.

- An overtake is now a pass rather than a detour. Ordinary and hurried traffic differ
  by 24 km/h on cracked asphalt and 10 on a steep gravel climb, where both are near
  full throttle; the two used to be separated by 12-21 km/h from a 26-31 km/h base,
  which is two cars crawling abreast.
- Gravel pace stops at half the clean-road figure, not higher, because that is where
  the controller runs out: a frantic driver given 70 km/h there stood on the brake
  inside a bend, lost the front on the loose surface and ran 1.2 m past the asphalt.
  Modulating the brake against per-surface grip is what would buy the rest.
- The autopilot bench was reporting five failures that were its own: it placed the
  test car 1.2 m above the road, which is past the suspension's travel, so the
  chassis met the road mesh itself and Rapier resolved that penetration by throwing
  the car off the road at up to 200 km/h — at road positions that moved whenever the
  ribbon was retessellated. It now places the car exactly as the world places a
  spawned one. The gravel-district checks that were failing from this pass.
- The drive no longer starts at a resolution the launch transient chose. Dynamic
  resolution is measured from GPU time, and the frames straddling the reveal — the
  last shader variants, the first uploads, the boot GC — are the most expensive of
  the session, so the controller read them as a machine that could not cope and
  walked the drawing buffer down step by step. Measured on a cold profile at
  1384x805: the first entry into the world ran at 761x442, the second at 1176x684,
  identical world and settings. At 55% the film grain is filtered away by the
  upscale, the ink outlines smear into a general darkening and the asphalt loses its
  aggregate, which is why the first launch looked unfinished and a second one looked
  right. The launch now renders the real frame path under the loading cover,
  discards the transient, and lifts the cover only once the controller has actually
  measured the resolution it is holding — verified as an unchanged drawing buffer
  over the 30 s after the reveal, on the same machine that used to drift through
  four resolutions in that time.
- A resolution drop is no longer permanent. Coming back up needed 240 CONSECUTIVE
  samples under the fast threshold, and any single sample in the band between the
  two thresholds reset the count — and that band is where a healthy frame on an
  integrated GPU actually lives, so nothing ever climbed out. Both directions now
  read a running average of GPU cost, which a brief stall cannot fake: one second of
  40 ms frames costs at most one step and is repaid, and thirty seconds of real
  headroom restores full resolution.
- Driving down into a deep basin no longer pins the car and then the player to the
  middle of the road. The fall-out-of-world rescue treated a fixed altitude
  (-400 m) as "below the world", but the landscape carries ±1430 m of relief, so
  whole basins sit under that line — 56% of seed 1337's road and 76% of seed 2024's,
  in continuous stretches over 100 km. The boundary is now measured against the
  ground at the body's own position, so solid asphalt at any altitude is never a fall.
- A rescue that does fire places the car along the road's grade instead of level on
  it: at 14% that is 2.8 cm of bumper inside the asphalt rather than 30 cm, which is
  the sunk-rear, raised-nose pose the repeating rescue left behind.
- Overtaking no longer stalls on the centre line: the car being passed is located by a
  probe cast down a fixed lane centre rather than down the driver's own moving line,
  so it can no longer appear to jump into the lane being used to pass it. Measured
  before the fix, with the opposing lane empty: 22 seconds of 30 straddling the
  centre, 1204 indicator changes, and the leader nudged along in front.
- A car being overtaken keeps its measured speed while the driver's line is out in the
  opposing lane, so it is no longer treated as a stationary obstacle to be squeezed
  past at walking pace — which held every pass at the leader's own speed, alongside it,
  indefinitely.
- The planner's switching hysteresis is measured against the line it last chose rather
  than the rate-limited line the car is still slewing along, so a decision cannot flip
  free of its own switch cost mid-manoeuvre.
- Autonomous indicators follow the car's remaining lateral travel, so they stay on for
  the whole lane change instead of going dark as soon as the commanded line arrives.
- The traffic setting now puts its cars where they can be seen. At thirty, a cruising
  player had 6.7 cars ahead of him and 12.9 piled up behind, because the stream was
  spawned only ahead and collected 850 m behind, and he overtakes nearly all of it.
  The rear tail is now bounded by the collision window, and a driver whose speed cap
  beats the player's actual pace is spawned behind him so it closes and arrives in
  view. Measured at 90 km/h: 10.6-11.1 cars ahead of 22.4-23.1 live, against 6.7 of
  19.7 before.
- Traffic spawn sites are no longer drawn past the streamed collision window. A site
  with no ground under it still passed selection, held the one pending spawn through
  a model load, and was discarded on arrival — 207 of 300 attempts, a refill rate of
  0.38 cars/s against the 2/s the cooldown allows, which is why the stream sagged to
  half its setting after every density change.
- An oncoming car is only treated as out in the opposing lane — and so as a 300 m
  spawn blackout — once it is half a body past the crown. The old test left 0.35 m
  of slack over the lane centre, so ordinary lane-keeping error on a bend read as an
  overtake in progress: 419 of 1540 candidate sites rejected on one seed, none on
  another.

## 0.14.3 — 2026-09-11

### Fixed

- The launch cover now waits for the shader variants the live frame actually uses:
  the scene pass is compiled with the offscreen haze target bound, so its
  tone-mapping/colour-space program is the one that was warmed.
- Launch also waits on a GPU fence after the final covered draw, so first-run texture
  uploads, shadow maps, the environment bake and the fullscreen pass are finished
  before the player sees anything.
- The lunar texture is awaited during loading instead of popping in after the drive
  has started.

## 0.14.2 — 2026-09-11

### Changed

- Phone-sized touch devices now start on Acceptable/near/MSAA-off unless that browser
  already has an explicit graphics preference.
- Mobile rendering uses absolute 540p/720p/900p pixel ceilings for
  Acceptable/Standard/Blessing and never renders duplicate frames above 60 FPS.

### Fixed

- High-DPR 90/120 Hz phones no longer multiply the scene, post-process, and MSAA fill
  cost from desktop-oriented pixel ratios and uncapped presentation.

## 0.14.1 — 2026-09-11

### Fixed

- Courier cars now park at the road-facing edge of their POI instead of receiving
  an unrelated lateral offset that could hide later couriers behind the site.

## 0.14.0 — 2026-09-11

### Added

- Physical courier cars placed deterministically at roadside POIs every 6–12 km, with a distinct shader finish and persistent eight-cell trunks.
- Four permanent physical parcel contracts per courier, transferable through hands, loose-item storage, and vehicle trunks.
- Signed sticker envelopes that replace delivered parcels atomically and can be stored, dropped, transferred, and applied to any normal car.
- Modal sticker placement preview with wheel rotation, confirm/cancel controls, painted-panel filtering, and full-footprint validation.
- Persistent courier storage, completed-contract IDs, physical reward migration, and save-code round trips for contracts and stickers.
- Recurring roadside mirage tableaus, expanded sandstone cities, shipwreck silhouettes, moon/grade/climb lab tooling, and boot warm-up diagnostics.
- Source vehicle-import archives and visual proof/reference files used by the current vehicle and sticker work.

### Removed

- The abstract freight job, destination-sign, pallet, `WorldState.job`, `stickersUnplaced`, and delivered-POI progression path.
- Immediate counter-driven sticker placement without a physical envelope or preview.
- Fixed full-cap traffic density and the old dense-traffic overtaking gate.

### Changed

- Traffic count is now a natural varying population below the configured cap, with per-driver following distances and overtaking at every supported density.
- Ambient traffic headlights fade with distance while the driven car keeps its authored beam strength.
- Headlights use warmer period-correct colour, softer edges, and less clipping; midnight receives readable moonlit terrain fill.
- Autopilot yields headlight ownership after a manual switch until it is re-engaged.
- Mirage cities now use varied wall colours, windows, balconies, roof caps, and street strips while retaining instanced rendering.
- World boot waits for the requested road-chunk and desert-tile windows instead of treating an empty scheduler as complete.
- Traffic engine voices use a broader, quieter combustion spectrum with stronger distance falloff.

### Fixed

- Resumed drives no longer begin before support colliders and nearby terrain are ready.
- Traffic density reductions remove safe behind-player cars instead of visibly popping arbitrary vehicles.
- Ambient headlight pools no longer appear at full brightness when distant traffic spawns or enters the light budget.
- Manual headlight changes are no longer overwritten on the next autopilot step.
- Autopilot obstacle passing, recovery, lane holding, and following remain stable across curves, grades, hazards, parked vehicles, and opposing traffic.
- Mirage placement, wreck spacing, sandstone-city readability, sky fill, and distant transition behaviour were corrected.
- Delivered cargo cannot mint a second reward, and cancelled or invalid sticker placement cannot consume its envelope.
