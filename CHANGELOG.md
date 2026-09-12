# Changelog

## Unreleased

### Added

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
  lake IS the encounter — but by APPROACH: full water until the last few dozen metres,
  gone within 10 m of the waterline, and back when you pull away. The fade is a function
  of where you stand, so it is reversible by construction and nobody has to write
  hydrolock, buoyancy or a walk home. It is also gone if the eye drops to the water's
  level, because a transparent sheet seen from under is a colour filter over the screen.
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

### Fixed

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
