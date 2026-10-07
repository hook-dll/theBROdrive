# Changelog

## Unreleased

### Added

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

### Changed

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
