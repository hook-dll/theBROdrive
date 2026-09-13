# Changelog

## Unreleased

### Added

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

### Changed

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
