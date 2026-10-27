# carkit: status and roadmap

What the owner wants, what is done, what is left. How to work: [`README.md`](README.md).
Why things are the way they are: [`HISTORY.md`](HISTORY.md). Keep this file current with
every change (update the car's row and the gaps).

Last updated: 2026-10-19, owner's second review: the 2104/2105/2107 black wedge is removed,
mirror feet now enter the shell, and both UAZ front overhangs are raised above their bumpers.
Existing dashboards remain accepted; future cars must supply a sourced dashboard photo.

## The owner's goal

Low-poly but realistically shaped Soviet cars generated at runtime from specs, with a
fully interactive interior, eventually replacing the pack bodies in the world.

**Visual**
- Flat faces, the game's current lighting and palette, no outlines (the reference video has
  an ink outline; leaving it out was agreed).
- Real factory proportions measured from drawings and photos, never from memory;
  simplified shape, no caricature; the body is **not stacked boxes** (a lofted tub plus a
  greenhouse with raked pillars; shut lines are real panel gaps).
- Doors at full real size: the rear door is the size it is on the real car, not shrunk the
  way the reference video does it.

**Interactive**
- Clear glass with the cabin visible through it.
- Doors, bonnet, boot/tailgate and fuel flap open.
- Live controls: wheel, pedals, gear lever, handbrake, needles, stalks, wipers.
- Clickable fittings: lights, indicators, hazards, horn, window cranks, quarter lights,
  glovebox, sun visors, ashtray, radio, seats (slide, recline, head restraints), the
  inside mirror and both door mirrors (aimed by hand; the door mirrors from a front seat,
  through the glass). In the game all of them work from the seat at any speed; the radio
  knob steps station 1 → 2 → off with the needle on fixed frequencies, and the hazard
  button steps hazards with the autopilot (sleeper → hurried → frantic → off).
- The boot shows **empty**: items stay on the existing trunk grid. Later the bonnet grid
  gets rearranged: engine large and central, other parts at the sides.
- Later: a cockpit view.

**Must keep working**: stickers, dust/dirt and scratches on the paint; head, tail, brake,
indicator and reversing lamps.

**Budget**: ≈ 8–13k triangles per car; LOD at 50 m (cabin, bay, boot and underbody not
drawn; the glass an opaque mirror from 45 m). Since 2026-10-15 every car's flat runs are
merged after it is built (`simplifyFlats`): 10.2–13.7k triangles, 8–18% fewer than before.

**Wheels**: the Soviet pack's six designs and eight generated sets (`rims.ts`, since
2026-10-26), drawn per instance from the car's kind of pool, rescaled to the kit tyre. See
"Wheels: designs and the roster" below.

## Roadmap (agreed order)

1. ✅ **Generator core**: 2106 and 2108 in the car lab, hover and click.
2. ✅ **VAZ cars** from specs: 2101, 2102, 2103, 2104, 2105, 2106, 2107, 2108, 2109, 21099,
   2110, 2112, 2115, 2121, 2131, 1111. All done (the last three accepted 2026-10-16). The
   2111 estate added 2026-10-16 (draft, awaiting the owner's review).
3. **GAZ and UAZ-469**, then the **UAZ «буханка»** (UAZ-452). GAZ-24 and GAZ-31029 drafted
   2026-10-16 (awaiting the owner's review); the GAZ-21 is not wanted.
4. **Trucks**, starting with the **ZIL-130**. The ZIL-150 is postponed (owner, 2026-10-18).
5. **Foreign cars of the 1990s** (owner's list, 2026-10-18; order within it not set yet):
   see "Foreign cars: the owner's list" below. First batch, the GM cars on Opel running
   gear: the **Daewoo Nexia** drafted 2026-10-18, and with it the foreign running-gear
   path; the **Daewoo Espero** (2.0 CD) drafted 2026-10-18 on it (awaiting the owner's
   review); the **Opel Astra F** (five-door 1.6i, facelift) drafted 2026-10-18 (awaiting
   the owner's review); the **Opel Vectra A** (saloon 2.0i, facelift) drafted 2026-10-18
   (awaiting the owner's review).
   Next: the **Mercedes W124** (230 E saloon, 1989–92 facelift): sources gathered and the
   feature inventory written 2026-10-27 (`measurements-w124.md` §4, the first car through
   the inventory step); the owner's missing fields built (`moulding.edge`, `cladding` with
   its `edge`, `cornerLamps[].ribs`, `wipers: 1`, `mirrorFinish`, the `tone` finish and
   `KitLook.tone`) and the first draft made 2026-10-27 (`mercedes.ts`, on its own running
   gear `GEAR_MERCEDES_W124`). The owner's first review the same day (arches, a bloated
   boot, fluted head lamps, the sill to the drawing, triangles) reworked
   (`measurements-w124.md` §8: the front arch a half ellipse `frontArchRise`, the boot deck
   level from the lid's front edge, `ribs` on the head lamps, sill 0.19 / doors 0.21 after
   the flatter exhaust, 13 621 → 12 444 triangles with `archSegments`). The second review
   (the front tyre set back in its arch, the boot a box) reworked (`measurements-w124.md`
   §9: the front arch closed round the tyre, the deck one plane to the tail; 12 363
   triangles). The third review (nose, handles, which lamps are fluted, the back light,
   the front and the tail; `measurements-w124.md` §10): the face set back and raked on the
   carsized side photo, the grille shell under the bonnet's lip, long chrome handles at
   the doors' rear edges (`handles.grip`), smooth head lamps, the lid between leaning lamp
   edges (`notchWall`), a bright quarter-glass bar (column `finish: 'chrome'`), aprons
   drawn back under the bumpers (bumper `foot`), the back light's top corners chamfered;
   12 194 triangles. After his look at the back light (2026-10-28): the glass a plain
   trapezoid, its top straight (`rearTopLevel`, no `cornerDrop`), and both tail corners
   over the indicators alike (`shoulder.convex`); 12 530 triangles: **draft, awaiting his
   next look**.
   Next after it (owner's pick, 2026-10-27): the **BMW E34** (520i 24V saloon, 1990–95):
   sources and the feature inventory (`measurements-e34.md` §4–5); the owner's answers
   (black lamp rings, the shark nose, the Hofmeister kink, the stack turned to the driver,
   alloys, no fog lamps) built and the first draft made 2026-10-27 (`bmw.ts`, `CABIN_E34`,
   its own running gear `GEAR_BMW_E34`); the mirrors on a black base without an arm after
   his first look at the front view; the roof's rear corners over the back light without
   their fold (2026-10-28). kit-check passes, 13 952 triangles: **draft, awaiting his
   next look**.

Off the roadmap: the **AZLK-2141** (Moskvich) drafted 2026-10-16 on the pack's `sa_azlk2141`
running gear (awaiting the owner's review).

Pending stages that run alongside (the old numbering in commit messages: stage 2 = cockpit,
stage 4 = driving):
- **Cockpit view ("Сесть" / "Get in")**: a button in the car lab puts the camera in the
  driver's seat; keys turn the wheel and press the pedals (`KitRig` channels `steer`,
  `throttle`, `brake`, `clutch`, `gear`, …); fittings clickable from inside. Not started.
- **Driving in the world**: done (2026-10-13). `CAR_MODELS` is `KIT_CARS`: traffic,
  contract cars, the start car, couriers, wrecks and the dev spawn menu are kit cars on the
  running gear of their `sv_*` siblings; the pack bodies are drawn nowhere, not even in the lab,
  and a save naming one loads on its kit twin. Every world `Vehicle` of a kit model has a
  live rig (`vehicle.kit`): doors, lids and flap open in the world, and the wheel, pedals,
  lever, handbrake, needles, light switch, stalk and hazard button follow the car.
- **Owner's call, later**: rearrange the bonnet item grid.

## Per-car status

All cars: in the world and the lab; interior, opening parts, lamps, LOD, dust/scratches/
stickers on the body and on the opening parts work; wheels from `DISTINCT_SOVIET_WHEEL_SETS`;
each car its own interior trim from a muted palette (`trims.ts`, README "Interior trims").
Triangle counts in README.

| Car | Spec | Measured on | Status | Left / known gaps |
|---|---|---|---|---|
| 2101 | `BODY_124` + `LOOK_2101`, `CABIN_2101` | `vaz2101.jpg` factory drawing; 3dcar.ru `vaz_2101.jpg`; Commons photos (`measurements-classics.md`) | done; the face leaning forward (`NOSE_2101`, −0.16) and the tail out (`BODY_124.rearLean`, −0.16), 2026-10-27, awaiting the owner's review | C-pillar vents not modelled |
| 2102 | `BODY_2102` + `REAR_2102` (estates.ts) | 3dcar.ru `vaz_2102.jpg` (+0.037 m C-pillar correction from photo); Commons (`measurements-estates.md`) | done; the 2101's leaning face (`NOSE_2101`), 2026-10-27, awaiting the owner's review | no rear wiper; the tailgate's chrome handle and plate not placed (`FaceLook.lid` can carry them now) |
| 2103 | `BODY_124` + `LOOK_2103`, `CABIN_2103` | 3dcar.ru `vaz_2103.jpg`; Commons | done; the face leaning forward (`NOSE_2103`, −0.26) and the tail out, 2026-10-27, awaiting the owner's review | arch chrome, C-pillar vents; the face's foot 5–6 cm behind the drawing's (the 124 shell's station) |
| 2104 | `BODY_2104` + `REAR_2104` (estates.ts) | 3dcar.ru `vaz_2104.jpg` (undimensioned, registered on `BODY_05`); Commons | done; nose upright as measured (2026-10-27) | no rear wiper; tailgate badge/handle and plate not placed |
| 2105 | `BODY_05` + `LOOK_2105`, `CABIN_2105` | 3dcar.ru `vaz_2107_1982.jpg` (body), `vaz_2105.jpg` (face, tail); Commons | done; both ends upright as measured (2026-10-27) | mirror sail; hubs 20–30 mm off the dimension line (drawn hubs kept). A pillar slimmed in c86627d (also 2104, 2107); the 4–7 cm chin under each end's face not modelled |
| 2106 | `BODY_124` + `LOOK_2106` | `vaz2101.jpg` + 0.045; 3dcar.ru `vaz_2106.jpg`; Commons | done; the face leaning forward (`NOSE_2106`, −0.25) and the tail out (−0.16), 2026-10-27, awaiting the owner's review | C-pillar vents; the rear panel between the lamps is body colour in its chrome outline (the owner's call; the real one is black); the face's foot 6 cm behind the drawing's (the 124 shell's station) |
| 2107 | `BODY_05` + `LOOK_2107`, `CABIN_2107` | 3dcar.ru `vaz_2107_1982.jpg`; Commons | done; both ends upright as measured (2026-10-27) | mirror sail; bonnet not notched round the grille; the chin under the lamp unit not modelled |
| 2108 | `BODY_2108` + `LOOK_2108` (samaras.ts) | `vaz2108.jpg` factory drawing; front view for the face | done | the plastic bumper looks heavy |
| 2109 | `BODY_2109` + `LOOK_2109` | 3dcar.ru `vaz_2109.jpg` (registered; door lines from Commons photo `p1`) (`measurements-samara.md`) | done | rear door handle from the generator's rule (2.886 vs 2.99 on the photo) |
| 21099 | `BODY_21099` + `LOOK_21099` | 3dcar.ru `vaz_21099.jpg`; Commons | done | early face only (the late "high bonnet" face not modelled) |
| 2115 | `BODY_2115` + `LOOK_2115` | Commons photos only (no drawing exists); factory figures vaz.ru / drom.ru | done | see below |
| 2110 | `BODY_2110` + `LOOK_2110` (tens.ts), `CABIN_2110` | 3dcar.ru `vaz_2110.jpg` (4.092 mm/px from the drawn wheelbase); Commons photos for the quarter glass, arches, flap side, lamps, dash; factory figures infocar.ua / autoopt.ru / cartechnic.ru (`measurements-2110.md`) | done (base early car), owner's review fixes in | see below |
| 2112 | `BODY_2112` + `LOOK_2112` (tens.ts), `CABIN_2110` | 3dcar.ru `vaz_2112.jpg` (3.98 mm/px from the drawn wheelbase, hubs x 815 / 1441, ground y 410); Commons photos for the tail, lamps, spoiler; factory figures autoopt.ru (`measurements-2110.md` §8) | done | see below |
| 2121 | `BODY_2121` + `LOOK_2121` (nivas.ts), platform `niva` (`LAYOUTS.niva`) | `niva.jpg` factory four-view (3.632 mm/px from the drawn wheelbase); Commons photos (`measurements-niva.md`) | done (owner accepted 2026-10-16) | arches one circle (real ones taller than wide), no arch flares, the bumper ends do not wrap round the wings, rear side reflectors and C-pillar slot not modelled, spare wheel not in the bay, transfer levers static |
| 2131 | `BODY_2131` (the 2121 + 0.5 behind the B pillar) + `LOOK_2131`, `CABIN_2131` | no drawing exists; Commons photos registered on the 2121's B shut line and rear axle, ±4 cm (`measurements-niva.md` §5) | done (owner accepted 2026-10-16) | as the 2121; D-pillar vent slots and roof rack not modelled |
| 1111 | `BODY_1111` + `LOOK_1111` (oka.ts), platform `samara`, `CABIN_1111` | 3dcar.ru `vaz_1111_oka.jpg` (dimensioned, 2.696 mm/px); Commons photos; the owner's side photo for the arches and bumpers (`measurements-oka.md` §1.3) | done (owner accepted 2026-10-16); 2026-10-27 the owner's review worked in (bumpers to the arches, `wrapTo: 'arch'`; front arch lower, rear flat-topped, `rearArchSquare`), awaiting his look | running gear `cf_vaz1111`'s (the 1111 manual; `KIT_CARS` siblings may be any catalogue entry); a pair of wipers (the car has one); a red fog lens at both rear ends (the car has one); the underbody hangs to 0.116 under a floor at its clearance (advisory); no flared arch lips; the drawing's ride height (the owner's photo sits 3.5 cm higher) |
| 2111 | `BODY_2111` + `LOOK_2111` (tens.ts), `CABIN_2110` | 3dcar.ru `vaz_2111.jpg` (4.185 mm/px from the drawn wheelbase, hubs x 798 / 1393.5, ground y 416); Commons rear photos; factory figures vaz.ru, the 2110 manual (`measurements-2110.md` §9, §9.1) | draft, review 1 worked in (the tail out over the bumper, `rearLean` 0.275 above 0.6; the roof's arch), awaiting the owner's review | no roof rails (the factory 1480 is over them; kit row 1430); tailgate cut ±0.545 (drawn ±0.565); the red bar a reflector; rear-wing rubbing strip, the doors' low double line (0.40–0.43), plate, rear wiper not modelled; the screen's top 24 mm over the drawn outline (wiper sweep); running gear the 21102's with the 2111's 1040 kg and a Cd·A for its 162 km/h (`GEAR_VAZ_2111`) |
| GAZ-24 | `BODY_GAZ24` + `LOOK_GAZ24` (volgas.ts), platform `classic` | 3dcar.ru `gaz_24.jpg` factory four-view (5.10 mm/px from the drawn wheelbase; dimension lines 4735 / 2800 / 756 / 1490 / 1800 / 1476 / 1420); Commons photos (`measurements-volga.md` §1, §3) | draft, review 1 worked in (greenhouse with quarter light, post and fixed pane; arched roof `roofDrop`, `railBend`; crowned nose, boot slope; blade `wrap` 0.33 / 0.43); review 2 (2026-10-16 evening): slim A pillar, the quarter light close behind it (`measurements-volga.md` §3.5); awaiting the owner's review | running gear `sv_gaz24`'s; the classic platform's VAZ dash and seats; C-pillar louvre, plates, the bonnet's raised centre (15 mm) not modelled; wiper length [E]; rear fangs from the early photos; window corners chamfered, not round; the quarter light runs down the pillar to the belt (four-sided, its foot 0.19 ahead of the drawn rounded corner) |
| GAZ-31029 | `BODY_GAZ31029` + `LOOK_GAZ31029` (volgas.ts): the 24's middle stations + 0.14, its own greenhouse columns, nose and tail | the-blueprints.com GAZ-31029 drawing (5.761 mm/px, heights × 1.028 to the 24's roof); `gaz_3102.jpg` cross-check; Commons photos (`measurements-volga.md` §2, §3) | draft, review 1 worked in (single front pane, raked rear glass, arched roof, rounded tail corners, blade `wrap` 0.415 / 0.25); review 2 (2026-10-16 evening): slim A pillar, the front glass close behind it (§3.5); awaiting the owner's review | running gear `cf_gaz31029`'s; flap side the drawing's (left), unchecked; fog lamps, plates, badge not modelled; the classic platform's dash; the front glass's foot 0.12 ahead of the drawn one |
| AZLK-2141 | `BODY_2141` + `LOOK_2141` (azlk.ts), platform `samara` (its layout as is) | the-blueprints.com "Moskvich 2141 (1986-2001)" drawing (5.714 mm/px from the drawn hubs x 180.5 / 632, ground y 331; dimension lines 4350 / 2580 / 1400; drawn tips 64 mm short, put on the bumpers); factory figures drom.ru / wiki.zr.ru / njcar.ru; Commons photos (`measurements-2141.md`) | draft, review 1 worked in (2026-10-16: slim A pillar with the door's glass close behind it; both bumpers' tops under the lamps), awaiting the owner's review | running gear `sa_azlk2141`'s (the 2141-01, VAZ 1.6); door frames, B and C pillars painted (black on the car); the front door's glass runs down the pillar (on the car its foot stands behind the mirror's black sail); the reversing cell full height (the lower half on the car); the bumpers one height all round (lower along the flanks on the car); fuel flap on the right rear wing [E: no right-side photo found]; plates, bumper intakes, the doors' rubbing line, the quarter's black triangle not modelled; traffic drivers the stream's mix (a third each, `DRIVER_MIX`) |
| Daewoo Nexia | `BODY_NEXIA` + `LOOK_NEXIA` (daewoo.ts), platform `samara`, `CABIN_NEXIA` | 3dcar.ru `daewoo_nexia.jpg` dimensioned four-view (4.851 mm/px from the drawn hubs x 717.5 / 1237; heights hung from the hubs, the drawn ground 53 mm high for its small tyres; drawn tips 47 mm over 4482, cut from the bumpers); factory figures the Nexia repair manual (3ruk.ru, remkomplekt.org) and drom.ru; Commons photos (`measurements-nexia.md`) | sun visors 0.105 deep (owner, 2026-10-18); owner's review 2 (2026-10-18: the head lamp's shape; the indicator a short, tallest end of the lens, the top rising to it) worked in; owner's review 1 (2026-10-18, c0e38ef: "всё прекрасно"; the lamps' curved outlines asked for) worked in: the head lamp's arched top and rising foot, the indicator closing as a dome on the wing, the tail lamps' convex inner side rounding into the top; then the trapezoid grille (`grille` `slant`, its far-band fight fixed) with the squinting head lamps along it (HISTORY.md "Daewoo Nexia"); awaiting the owner's look at them | the first car on its own running gear (`GEAR_DAEWOO_NEXIA: KitOwnGear`, `engine_daewoo_g15mf`, `gearbox_opel_f16_nexia`); early base GL only (grey bumpers, no lid garnish); the lid's sides upright (±0.39; the lamps' inner edges lean); lamp curves as polylines; mirror sail, front quarter post, plates, badge, grille slot not modelled; overhangs [E]; the dash's heights hung from the Samara's cluster; traffic drivers the stream's mix (`DRIVER_MIX`) |
| Daewoo Espero | `BODY_ESPERO` + `LOOK_ESPERO` (daewoo.ts), platform `samara`, `CABIN_ESPERO` (its own dash since review 1) | the-blueprints.com vector preview `daewoo_espero_1995.jpg`, dimensioned 4615 / 2620 / 1718 / 1388 (5.812 mm/px along from the drawn tips, 5.486 up from ground to roof; the drawn hubs 2655 apart, the wheels on the factory 2620 centred on them); factory figures drom.ru catalogue 2.0 MT CD; Commons photos (`measurements-espero.md`); dash from SelfBase.de's instrument-panel photos and a drive2.ru cluster photo | draft 2026-10-18; owner's review 1 (2026-10-18) worked in: its own dash, the door frames, B pillar, quarter-glass frame and mirror sail black (`CabinColumn.finish`), the head and tail lamps' outlines measured on photos (slanted inner end, tail band 0.67–0.82 across the whole tail, lid cut ±0.49); lamp review 2: head lamps fill the band between bumper and bonnet, indicator the outer 22 % at the same height, the lid band's ends slanted, amber across the corner units; sun visors 0.10 deep (owner: the stock 0.15 covered everything lowered); awaiting the owner's look | own running gear (`GEAR_DAEWOO_ESPERO`, new `engine_daewoo_c20le`, the Nexia's `gearbox_opel_f16_nexia` on the same 3.944); the lid band's ends red (amber on the car: colours kept), the dark strip under it painted; dash heights from one photo scale [E], door-top vents not modelled; fog lamps unlit grey panels; plates, badges not wanted; overhangs, axle split, Cd [E]; 14 389 triangles; traffic odds the default |
| Opel Astra F | `BODY_ASTRA_F` + `LOOK_ASTRA_F` (opel.ts), platform `samara`, `CABIN_ASTRA_F` (its own dash) | the-blueprints.com vector preview `2001_opel_astra_f_5-door.jpg` (drawing 9603), dimensioned 4050 / 2517 / 1696 / 1410 (5.827 mm/px along from the drawn tips, 5.887 up from ground to roof; the drawn hubs 2555 apart, the wheels on the factory 2517 centred on them); factory figures auto-data.net, ultimatespecs; gearbox opel-motor.ru, forum.opel-club.ru; Commons photos and the dash panorama (`measurements-astra.md`) | draft 2026-10-18: five-door hatch with the 1994 facelift's face and tail over the 1991 drawing; black door frames, B pillar, quarter post and mirror sail; lamp outlines checked against four photos (two per end) in the lab; awaiting the owner's review | own running gear (`GEAR_OPEL_ASTRA_F`, new `engine_opel_c16nz` and `gearbox_opel_f13_wr`); the grille surround painted (light grey on some cars); lamp ends square (rounded on the car); roof spoiler, plates, badges not modelled; fog lamps unlit grey panels; the dash from a panorama [E]; overhangs, mass, tank, red line [E]; 13 578 triangles; traffic odds the default |
| Opel Vectra A | `BODY_VECTRA_A` + `LOOK_VECTRA_A` (opel.ts), platform `samara`, `CABIN_VECTRA_A` (its own dash) | the-blueprints.com vector preview `1990_opel_vectra_a.jpg` (drawing 9730), dimensioned 4430 / 2600 / 1700 / 1400 (5.821 mm/px along from the drawn tips, 5.858 up from the height line; the drawn hubs 2611 apart, the wheels on the factory 2600 centred on them); factory figures auto-data.net, autodata1; gearbox vectra-club.ru, forum.opel-club.ru; Commons photos and the taxi dashboard photo (`measurements-vectra.md`) | draft 2026-10-18: saloon with the 1992 facelift's face and tail over the 1989 drawing (lamps taller than drawn, the lip raised to 0.75); black door frames, B pillar, quarter post and mirror sail; lamp outlines checked against two photos per end in the lab; awaiting the owner's review | own running gear (`GEAR_OPEL_VECTRA_A`, new `engine_opel_c20ne` and `gearbox_opel_f16_wr_355`); the face upright and the grille frameless (a leaning face made the slanted grille fight, §6); bumper and strip bright lines, plates, badges not modelled; fog lamps unlit grey panels; overhangs, clearance, mass split, red line [E]; 13 509 triangles; traffic odds the default |
| Mercedes-Benz W124 | `BODY_W124` + `LOOK_W124` (mercedes.ts), platform `classic` (rear drive), `CABIN_W124` (its own dash) | the-blueprints.com vector preview `w124_tbp_3490.jpg` (drawing 3490), dimensioned 4755 / 2799 / 1430 (5.806 mm/px along from the drawn tips, 5.837 up from the ground; the drawn hubs 2820 apart, the wheels on the factory 2800 centred on them), front and rear from the raster `w124_tbp_6190.gif` (10.0 mm/px); factory figures MB public archive, auto-data.net; Commons photos and the 200E cockpit photo (`measurements-w124.md`) | draft 2026-10-27, the first car through the feature inventory: tone-of-body bumpers and cladding with a black band and one chrome line nose to tail, chrome grille shell with slats and centre bar, ribbed corner tail lamps, one wiper, body-colour mirrors, chrome handles; **awaiting the owner's review** (`build/kitcheck/w124/review.png`) | own running gear (`GEAR_MERCEDES_W124`, new `engine_mercedes_m102_e23`, `gearbox_mercedes_5speed_346`, own wheel pool `gw_alloy_8hole` and the covers); sill and doors' bottom 6.5 cm over the drawing (the classic exhaust under the floor); the lid's leaning sides between the tail lamps upright; no lamp housing frames, star, plates, badges, foot brake, combination dial (owner); interior blue from the dash photo; tone 0.78, wiper 0.5 [E]; 13 621 triangles; traffic odds the default |

**2115 details — done** (commit 8620a22):
late-face head lamps and indicators (since the third review a `cornerLamps` unit, flush and wrapping round the corner; since the fourth the tail lamps too, and the Samaras' face rakes back, `frontLean`), the slot under the bonnet
lip, rectangular front fog lamps in black housings (`panel` spans), grey door mouldings
(`waist`, finish `grey`) in line with a grey band round both bumpers (moulded bumper
`moulding`), and a boot-lid `spoiler` with the high brake lamp that lifts with the lid. New
spec fields are in README's Spec reference; 12 092 triangles (README budget table). Proved:
2101–21099 hashes identical against c86627d. Measurements in `measurements-samara.md`
§3.3–3.6, §4 items 5–10.

2115 gaps left:
- **High brake lamp** shares the `brake` slot, so with the lights on it glows at tail-lamp
  level like every kit brake cell; the real one lights only on braking. Needs a separate
  lamp role (and a slot in `vehicle/vehiclelamps.ts`).
- **Fog lamps never light**: there is no fog channel/role in `vehicle/vehiclelamps.ts` or
  the rig; the lenses are an unlit chrome finish.
- Not modelled: side repeaters (measured: s 1.14–1.21, y 0.676–0.703), the plate recess in
  the rear bumper, the bonnet lip as its own part.
- The overhang split rests on one photo corrected for depth (±20 mm); licences of the five
  front photos used for the face were not checked (reading only).
- After the third review the boot lid's rear corners meet the wings on a clean shut line
  (`BodyFrame.lidFace`) and the head-lamp unit lies flush and wraps round the corner;
  12 136 triangles. After the 2112 round its own nose: the late face nearly the body's full
  width at the lamps (photo: lamps 0.41–0.97 of the half width), tall head lamps
  (0.645–0.772), a shallow flush bumper (0.27 deep) with its grey band at plate height in
  line with the door mouldings (0.505 / 0.09), a dark intake strip under it, fog lamps low
  at the corners; 12 309 triangles. Round of 2026-10-15: the rear bumper flush and wrapped
  along the wings to the rear arch as the front one is (it stood out as a box, "too
  massive against the front"), a one-chamfer corner on both, the fog lamps 15 mm inboard;
  12 224 triangles after the flat-run merge.

**2110 — done**: its own shell on the `samara` platform with its own dash
(`CABIN_2110`), sibling `sv_vaz21099` with the label "VAZ-2110" (the 2115 precedent), the
base early (1996–2003) car: slot grille, no spoiler, no door mouldings. 14 775 triangles.
After the owner's reviews: the rear door's edge rakes forward to the sill with rounded turns
(`CabinColumn.foot`, `round`) and the body behind it has cabin trim, the rear arch is a
low half ellipse covering the tyre (`rearArchRise`), the bonnet covers the whole top with
its shut lines along the wings' top edge and its nose comes down between the head lamps
carrying the slot (`bonnet`, front `lid`; the earlier narrow bonnet was a misreading of
the bonnet's raised centre, HISTORY.md), the head-lamp unit lies flush and wraps round the
corner, its indicator solid amber (`cornerLamps`), the tail lamps wrapping onto the wings
below the tail's belt (`cornerLamps` with `end: 'rear'`), one lid reflector
across the centre line, a feature line under the windows (`featureLine`), a nose rounded
in plan and a front bumper whose sides lie on the wings back to the arch, its foot in line
with the sill (bumper `corner`, `wrapTo`), the boot lid's rear corners on a clean shut line
(`BodyFrame.lidFace`). In the 2112 round: both bumpers `flush` (the rear one on the wings
to the arch), the face leaning back from the crease (`frontLean` with `full`) over a
bumper whose top stays below the lamps, shorter indicators, one straight bonnet slope, the
screen curved in plan (`screenFoot`) and the A pillar chamfered into the roof (column
`drop`). Proved: the classic saloons identical against cfff462. Lab: side overlay on the
drawing, all opening parts, lamps at night, no program linked after boot.

**2112 — done**: the 2110 to the rear door with its own hatch tail (`BODY_2112`): quarter
glass in the body to 3.71, a wide D pillar, the roof to 3.285, the tailgate's glass down to
the knee over the lamps and its lower panel to the bumper between corner lamps (`flat`
tail, `rearLean` 0.2), the lamps wrapping 0.18 onto the wings, a reversing lamp at each
end of the tailgate with a red bar between, a tall flush rear bumper, and a wing on the
tailgate's glass with the high brake lamp (`spoiler` on a tailgate). Sibling `sv_vaz21099`
with the label "VAZ-2112"; dash `CABIN_2110`. Round of 2026-10-15: the tail lamps flat
pieces bent once round the corner (no mosaic), the panel above them and the flank in
fewer, fatter triangles (the flat-run merge; slivers in the body paint 272 → 212, zero-area
116 → 15), no filler cup through the closed flap, a one-chamfer rear bumper corner; 13 634
triangles (2110: 13 723).

2112 gaps left (`measurements-2110.md` §8): the tailgate's opening between the lamps is
±0.545 (photo ±0.50); the flap's place is the drawing's, not checked on a right-side
photo; the reversing cells are white, not smoked; the high brake lamp shares the brake
slot (as on the 2115).

2110 gaps left (`measurements-2110.md` §7):
- The nose's skin twists slightly between the face station and the next; the rear fog
  lamp not modelled; the lid's side on the tail face is the generator's 25 mm wall, not the
  drawing's 82 mm slant.
- A 40 mm strip of wing top (the model's shoulder) shows beside the bonnet; the car has
  almost none. The nose's sides are straight.
- Dash: heights hung from the Samara's cluster (no side photo), one section across the
  width, the left of the cluster by symmetry, wheel size unmeasured.

## Next cars: what is known

- **2111**, **GAZ-24**, **GAZ-31029**: drafted 2026-10-16 (rows above); the owner's first
  review worked in the same day. With it the **2110** and **2112** got the roof's profile
  arch (`roofDrop`, `railBend`; nothing else on them moved), and the **2108 / 2109 / 21099**
  front wing was simplified to the drawing's shoulder line (crease 0.705 over the arch); the
  doors' crease stays 0.63 (drawn 0.71), so that line slopes down behind the arch
  (`measurements-samara.md` §6).

## Later families: what they need

- **GAZ**: the 24 and 31029 are drafted; the GAZ-21 is not wanted. No Volga dash
  (`CABIN_*`) yet: both use the classic platform's.
- **UAZ-469**: `uaz469.jpg` and `uaz2.jpg` (a 3151 hardtop four-view, dimensioned) present.
  Body-on-frame with a separate soft/hard top, flat panels, external hinges; no pack
  sibling (check `SOVIET_CARS`).
- **UAZ-452 «буханка»**: no drawing yet. Forward-control van: the cab sits over the front
  axle, so `bonnetFront`/cowl assumptions in the generator do not hold.
- **ZIL-130**: needs a **new cab + chassis generator**: a separate cab and bonnet on a
  ladder frame, a load bed, **dual rear wheels**, **3+ axles** for later trucks, and **new
  truck physics** (the vehicle model is car-only today). Much of `body.ts` (one lofted tub)
  does not apply.

## Foreign cars: the owner's list (2026-10-18)

Škoda Felicia; Volkswagen Passat B3; Jeep Grand Cherokee ZJ; Toyota Corolla (8th gen.,
E110); Daewoo Espero; Renault 19 Europa; Daewoo Nexia I; Mazda Xedos 6; Fiat Brava; SEAT
Córdoba; Volkswagen Golf III; Opel Astra F; Opel Vectra A; Audi 80 B3/B4; Ford Escort;
Ford Sierra; Mercedes-Benz W124; BMW E34; Toyota Carina E; Nissan Primera P10/P11;
Mitsubishi Galant; Mitsubishi Pajero II; Toyota Land Cruiser 80; Nissan Patrol Y60;
Toyota RAV4; Honda CR-V; Kia Sportage; Land Rover Discovery I; Opel Frontera A; Suzuki
Vitara; Saab 9000; Volvo 440 (both added 2026-10-18).

What every one of them needs, whatever the body: no catalogue has a foreign sibling
(`KIT_CARS` rides on `sv_*`/`sa_*`/`cf_*` running gear), so each needs its own running
gear and probably new engine/gearbox variants in the parts registry; a drawing (four-view)
and measurements file per car, as for the VAZes. The path exists since the Nexia
(2026-10-18): a `KIT_CARS` row names a `KitOwnGear` instead of a sibling id (every field a
catalogue entry drives on: mass, tyre, engine, gearbox, tank, grip, brakes, springs, lock,
drive bias, handling profile, front share, Cd·A, aero), and the engines and gearboxes go
in `parts/registry.ts` `FOREIGN_ENGINE_VARIANTS` / `FOREIGN_GEARBOX_VARIANTS`, each with a
`render/partmesh.ts` case and a `tools/reality.ts` `FACTORY_ENGINES` row. A GM sibling on
the same unit names the same variant; one with other ratios or another axle gets its own
gearbox entry. Traffic drivers are not per model: every body draws from `DRIVER_MIX` (world/traffic.ts).

Estimated effort by what the generator already has (one lofted tub, moulded body-colour
bumpers, corner lamps, `rearKnee` hatches, `rearLean` estates, spare on the rear door,
`screenFoot`/`screenTop` curved glass, flush integrated bumpers):

- **Easy (data only, like the 2110 family):** square-edged saloons and hatches of the late
  80s – early 90s: Daewoo Nexia I and Espero, Opel Astra F and Vectra A, Audi 80 B3/B4, VW
  Passat B3 and Golf III, Ford Escort (Mk5/6), Ford Sierra, Renault 19, Škoda Felicia,
  SEAT Córdoba, Mitsubishi Galant, Mercedes W124, BMW E34, Saab 9000 (five-door hatch,
  `rearKnee`), Volvo 440 (wedge hatch, `rearKnee`). Faces are lamp lenses, grilles
  and panels the item list already draws; the W124's grille shell and the E34's kidneys
  plus quad lamps are a `grille` with a frame and `round` lamps. Possibly a small field for
  a grille standing proud as a shell.
- **Medium (rounder bodies; the loft has to carry stronger plan and profile curves, the
  tens' generator work shows the way):** Toyota Corolla E110, Carina E, Nissan Primera
  P10/P11, Mazda Xedos 6, Fiat Brava (its tail lamps are a narrow wrap-around strip).
- **Off-roaders, a family of their own (body-on-frame, built like the Niva and the 469,
  but needing new pieces):** Pajero II, Land Cruiser 80, Patrol Y60, Discovery I, Frontera
  A, Vitara, Grand Cherokee ZJ, and the soft-roaders RAV4, CR-V, Sportage. New elements:
  wheel-arch flares (fender extensions) standing proud of the flank, side steps, roof rails,
  a spare on a side-hinged rear door with a cover (partly there on the 469), the Discovery's
  stepped roof with its alpine windows, two-tone bodies (a lower band in another colour), and
  large wheels/tyres on the running gear side. Once flares, steps and rails exist, the rest
  of the family is data.

Suggested start: one easy car to set up the foreign running-gear path (Nexia or Astra F),
then the off-road family starting with the Pajero II (it needs every new piece once).

## The toy box: the owner's second list (2026-10-27)

Not the street of the 1990s (the list above stays the world's traffic) but a boy's box of
toy cars: unexpected, rarely seen in other games, fun to drive, built before 2000. Every
one accepted, none struck out.

- The owner's: Peugeot 406 Coupé, Ferrari Mondial, Caterham 7, Mazda MX-5 (NA), Citroën
  Xantia, Volvo 850 (T-5R estate).
- Europe: Alfa Romeo 75, Fiat Coupé (1993), Matra Murena, Volvo 480, Lancia Thema 8.32,
  Maserati Biturbo, Ferrari 308 GT4, Porsche 914, Peugeot 306 GTi-6, Citroën AX GT,
  Renault Sport Spider, Lotus Elan M100, Reliant Robin.
- Eastern bloc: Tatra 613, Škoda 130 RS, LuAZ-969M, ZAZ-965.
- Japan: Daihatsu Charade GTti, Honda City Turbo II, Subaru SVX, Mazda MX-3, Isuzu VehiCROSS.
- Desert: Matra Rancho, VW Golf Country, Suzuki X-90, GMC Syclone, AMC Pacer.

First choice (owner and assistant, 2026-10-27): the owner's six, then Alfa 75, Fiat Coupé,
Matra Murena, Tatra 613, LuAZ-969M, Reliant Robin, Daihatsu Charade GTti, Golf Country,
Lancia Thema 8.32.

Prototypes tried and dropped (2026-10-27): a car's real running gear under a borrowed,
stretched kit body (Caterham 7, Matra Murena, Tatra 613) did not make driving one
interesting to the owner, so the code went (commit ee3d186e has it). The list stays on
hold: the 1990s street list above comes first. Still true for it: a car has exactly four
wheels (`render/carmodel.ts` `WHEEL_IDS`), so no Reliant Robin; open cars need an open
cabin from the generator; a mid or rear engine is placed at the front in
`Vehicle.applyChassisMass` (ee3d186e had a `rearEngine` field for it).

## Wheels: designs and the roster

Pools (carmodels.ts): Soviet cars `KIT_SOVIET_WHEEL_SETS` (the pack's six, `gw_vaz_steel16`,
both covers, `gw_alloy_split7`); the Oka `KIT_OKA_WHEEL_SETS` (its own 3x98 wheel half the
draws, else under a cover); foreign cars `KIT_FOREIGN_WHEEL_SETS` (steel, both covers, the
8-hole, the cross-spoke); the Nivas and UAZes `KIT_OFFROAD_WHEEL_SETS` (`sv_niva`, the fan).

| Design | Real wheel (`RimDesign.ref` names the photo; local copies in `build/carshape/_refs/bp/img/wheels`) | Meant for |
|---|---|---|
| `gw_oka` | VAZ-1111 stamped, 14 holes, 3 nuts | Oka |
| `gw_vaz_steel16` | VAZ-2110 stamped, 16 holes, 4 bolts | front-drive VAZes, any plain steel |
| `gw_cover_vents` | Audi 80 B4 cover, ring of 24 slots | any steel wheel: VW, Audi, Ford, Renault, Škoda, SEAT, Fiat |
| `gw_cover_turbine` | GM cover of the Astra F / Vectra A | Opel, Daewoo |
| `gw_alloy_split7` | VAZ-2112 alloy, 7 split spokes | the tens, Samaras |
| `gw_alloy_8hole` | Mercedes W124 8-hole | W124; flat aftermarket alloys on big saloons |
| `gw_alloy_cross` | BBS cross-spoke (BMW Style 5) | BMW E34; sporty saloons |
| `gw_alloy_fan` | Mitsubishi Pajero II fan | Pajero II; aftermarket on the Niva |

Still wanted for the foreign list (each needs a photo first): Golf III / Passat B3 black
steel (bare, no cover); a Japanese cover (Corolla E110, Carina E, Primera) with radial ribs;
Audi 80 / Saab / Volvo period alloys; the off-roaders' own (Land Cruiser 80 and Patrol Y60
6-stud steel and alloys, Discovery I "boost", Frontera, Vitara, RAV4, CR-V, Sportage, Grand
Cherokee ZJ), and the off-roaders' larger, chunkier tyre. When a foreign car is added, its
row may name its own pool instead of the foreign one (the W124 its 8-hole and covers).

## Arches against the drawings (2026-10-27)

Each car's `archFront` / `archRear` read off its `overlay.side` drawing (refs/<car>.json, the
pixels in each `src`): `[top over the hub, reach ahead, reach behind at the hub's height]` (m),
the skin's edge where the body begins (the dark well band's outer edge where a drawing shades
the well; the inner line of a doubled lip), on the drawn hub (gaz24, gaz31029, uaz469, uaz2206
and vaz2121 draw their hubs 0.03-0.07 over the registration's 0.30; read on the drawn wheel).
vaz2115 from its registered side photo P19 (it has no drawing); vaz2105 shares the 2107
drawing; vaz2109 draws no wheels. vaz2101 reads its own drawing (no overlay registration), vaz2131 the 2121's arches. The Oka is read on its drawn hub crosshair; the 2110's rear on photo s1 and the 2206's rear on photo P1 (their drawings stylise them, see each `src`). Judged at the default 0.03 by `nice -n 15 bun tools/kit-drawing.ts --no-images`; where the skin stops over the hub's height the reach is read at the edge's lower end (up to 0.3 over the hub, within 0.65), as the refs read the drawn edge. Built: before (the census; `open` the old reading at the hub's height) → after the fix (HISTORY "Arches to the drawings"). All 54 arches within; the W124's untouched.

| car | front ref | front built | front | rear ref | rear built | rear |
|---|---|---|---|---|---|---|
| vaz2101 | 0.34 / 0.325 / 0.355 | — → 0.35 / 0.326 / 0.326 | ok | 0.24 / 0.33 / 0.33 | — → 0.268 / 0.316 / 0.36 | ok |
| vaz2102 | 0.34 / 0.3 / 0.34 | 0.326 / 0.326 / 0.326 → 0.326 / 0.326 / 0.326 | ok | 0.25 / 0.32 / 0.31 | 0.326 / 0.326 / 0.326 → 0.256 / 0.326 / 0.326 | ok |
| vaz2103 | 0.34 / 0.31 / 0.33 | 0.326 / 0.326 / 0.326 → 0.35 / 0.326 / 0.326 | ok | 0.26 / 0.31 / 0.33 | 0.326 / 0.326 / 0.326 → 0.268 / 0.316 / 0.36 | ok |
| vaz2104 | 0.335 / 0.33 / 0.35 | 0.332 / open / 0.332 → 0.332 / 0.33 / 0.332 | ok | 0.28 / 0.36 / 0.36 | 0.332 / 0.332 / 0.332 → 0.28 / 0.36 / 0.358 | ok |
| vaz2105 | 0.345 / 0.3 / 0.355 | 0.332 / open / 0.332 → 0.332 / 0.33 / 0.332 | ok | 0.285 / 0.36 / 0.37 | 0.332 / 0.332 / 0.332 → 0.286 / 0.364 / 0.362 | ok |
| vaz2106 | 0.36 / 0.32 / 0.35 | 0.326 / 0.326 / 0.326 → 0.35 / 0.326 / 0.326 | ok | 0.29 / 0.32 / 0.385 | 0.326 / 0.326 / 0.326 → 0.268 / 0.316 / 0.36 | ok |
| vaz2107 | 0.345 / 0.3 / 0.355 | 0.332 / open / 0.332 → 0.332 / 0.33 / 0.332 | ok | 0.285 / 0.36 / 0.37 | 0.332 / 0.332 / 0.332 → 0.286 / 0.364 / 0.362 | ok |
| vaz2108 | 0.335 / 0.35 / 0.32 | 0.36 / 0.36 / 0.358 → 0.352 / 0.358 / 0.326 | ok | 0.32 / 0.34 / 0.33 | 0.36 / 0.36 / 0.36 → 0.32 / 0.34 / 0.35 | ok |
| vaz2109 | 0.345 / 0.35 / 0.34 | 0.36 / 0.36 / 0.358 → 0.352 / 0.358 / 0.326 | ok | 0.32 / 0.32 / 0.38 | 0.36 / 0.36 / 0.36 → 0.32 / 0.34 / 0.35 | ok |
| vaz21099 | 0.375 / 0.365 / 0.33 | 0.36 / 0.36 / 0.358 → 0.352 / 0.358 / 0.326 | ok | 0.33 / 0.345 / 0.33 | 0.36 / 0.36 / 0.36 → 0.32 / 0.34 / 0.35 | ok |
| vaz2115 | 0.33 / 0.36 / 0.31 | 0.36 / 0.36 / 0.36 → 0.352 / 0.358 / 0.328 | ok | 0.3 / 0.34 / 0.32 | 0.36 / 0.36 / 0.36 → 0.322 / 0.346 / 0.346 | ok |
| vaz2110 | 0.36 / 0.345 / 0.31 | 0.346 / 0.346 / 0.346 → 0.356 / 0.356 / 0.322 | ok | 0.27 / 0.31 / 0.295 | 0.234 / 0.288 / 0.286 → 0.274 / 0.306 / 0.304 | ok |
| vaz2112 | 0.35 / 0.35 / 0.33 | 0.346 / 0.346 / 0.346 → 0.356 / 0.356 / 0.322 | ok | 0.29 / 0.35 / 0.31 | 0.234 / 0.288 / 0.286 → 0.274 / 0.334 / 0.298 | ok |
| vaz2111 | 0.36 / 0.345 / 0.31 | 0.346 / 0.346 / 0.346 → 0.356 / 0.356 / 0.322 | ok | 0.265 / 0.29 / 0.33 | 0.234 / 0.288 / 0.286 → 0.274 / 0.306 / 0.304 | ok |
| vaz2121 | 0.455 / 0.37 / 0.385 | 0.446 / open / 0.446 → 0.456 / 0.37 / 0.386 | ok | 0.39 / 0.4 / 0.385 | 0.446 / 0.446 / open → 0.39 / 0.386 / 0.388 | ok |
| vaz2131 | 0.455 / 0.37 / 0.385 | — → 0.456 / 0.37 / 0.386 | ok | 0.39 / 0.4 / 0.385 | — → 0.39 / 0.386 / 0.388 | ok |
| vaz1111 | 0.335 / 0.30 / 0.323 (owner's photo) | 0.364 / 0.362 / 0.36 → 0.36 / 0.294 / 0.32 → 0.336 / 0.298 / 0.324 | ok | 0.305 / 0.31 / 0.29 (owner's photo) | 0.294 / 0.292 / 0.292 → 0.306 / 0.31 / 0.29 | ok |
| gaz24 | 0.38 / 0.35 / 0.47 | 0.416 / 0.414 / 0.408 → 0.38 / 0.37 / 0.47 | ok | 0.33 / 0.39 / 0.45 | 0.338 / 0.348 / 0.35 → 0.33 / 0.39 / 0.45 | ok |
| gaz31029 | 0.39 / 0.38 / 0.43 | 0.392 / 0.392 / 0.392 → 0.39 / 0.376 / 0.426 | ok | 0.28 / 0.41 / 0.43 | 0.3 / 0.342 / 0.346 → 0.28 / 0.404 / 0.43 | ok |
| azlk2141 | 0.355 / 0.34 / 0.38 | 0.404 / 0.404 / 0.396 → 0.356 / 0.336 / 0.38 | ok | 0.34 / 0.34 / 0.35 | 0.372 / 0.372 / 0.382 → 0.346 / 0.34 / 0.35 | ok |
| uaz469 | 0.46 / 0.46 / 0.56 | 0.5 / open / open → 0.46 / 0.442 / 0.566 | ok | 0.44 / 0.56 / 0.55 | 0.5 / open / open → 0.442 / 0.56 / 0.54 | ok |
| uaz2206 | 0.38 / 0.37 / 0.365 | 0.364 / open / open → 0.382 / 0.362 / 0.372 | ok | 0.29 / 0.39 / 0.38 | 0.278 / open / open → 0.292 / 0.364 / 0.364 | ok |
| nexia | 0.345 / 0.37 / 0.355 | 0.37 / 0.368 / 0.364 → 0.37 / 0.368 / 0.364 | ok | 0.29 / 0.37 / 0.355 | 0.306 / 0.36 / 0.36 → 0.306 / 0.36 / 0.36 | ok |
| espero | 0.36 / 0.39 / 0.35 | 0.37 / 0.37 / 0.366 → 0.37 / 0.37 / 0.366 | ok | 0.345 / 0.36 / 0.4 | 0.334 / 0.372 / 0.372 → 0.334 / 0.372 / 0.372 | ok |
| astraf | 0.31 / 0.34 / 0.32 | 0.36 / 0.348 / 0.36 → 0.31 / 0.34 / 0.316 | ok | 0.31 / 0.35 / 0.36 | 0.318 / 0.342 / 0.346 → 0.318 / 0.342 / 0.346 | ok |
| vectraa | 0.36 / 0.37 / 0.33 | 0.378 / 0.378 / 0.376 → 0.36 / 0.37 / 0.326 | ok | 0.35 / 0.37 / 0.34 | 0.326 / 0.356 / 0.36 → 0.326 / 0.356 / 0.36 | ok |
| w124 | 0.371 / 0.34 / 0.35 | 0.35 / 0.33 / 0.33 → 0.35 / 0.33 / 0.33 | ok | 0.39 / 0.39 / 0.4 | 0.388 / 0.374 / 0.386 → 0.388 / 0.374 / 0.386 | ok |

Read: the classics, the 2110 and the 2206 now cover the tyre's top at the rear (half ellipses lower than their circle); the Niva's, Oka's and eights' fronts are taller than wide; the Volgas' arches sweep back behind the hubs (`archShift`); the 2206's are flat-topped (`archSquare`). Every opening is the cut in the skin itself.

## Check results (`npm run kit-check`, 2026-10-19)

Every car through all eight checks (README "6. Check"); evidence in `build/kitcheck/`.
Mirrors: share of each glass seen from the cabin camera's eye. Dents: kit-surface findings
that fail. Drawing: built values within tolerance of `refs/<car>.json` (the overall box is
listed, not judged). Dash: the built cabin against the refs' interior photos.

| Car | zfight | proportions | reality | mirrors seen | dents | tris | drawing | dash |
|---|---|---|---|---|---|---|---|---|
| 2101 | pass | pass | pass | L100 R100 | 0 | 11 231 | 10/10 | 5/5 |
| 2102 | pass | pass | pass | L100 R100 | 0 | 11 217 | 11/11 | DASH UNVERIFIED (2101's dash, no 2102 photo) |
| 2103 | pass | pass | pass | L100 R100 | 0 | 11 818 | 10/11: waist strip 0.706–0.732 vs drawn 0.74–0.765 | 4/5: no clock (photo has one) |
| 2104 | pass | pass | pass | L100 R100 | 0 | 11 545 | 12/12 (sail ahead of the door glass, knee and lean to the drawing) | DASH UNVERIFIED (2105's) |
| 2105 | pass | pass | pass | L100 R100 | 0 | 11 773 | 16/16 | 2/2 |
| 2106 | pass | pass | pass | L100 R100 | 0 | 12 270 | 10/11: waist strip 0.726–0.752 vs 0.76–0.786 | 2/6: classic default dash (4 dials vs 5, no clock, no stack) |
| 2107 | pass | pass | ✗ 0-100 +8.4 % (pre-existing, untouched here) | L100 R100 | 0 | 12 454 (exterior chrome 31 % slivers) | 15/15 (overhang rear 1.089 accepted: drawn hubs) | 4/4 |
| 2108 / 2109 | pass | pass | pass | L100 R96 | 0 | 10 303 / 11 468 | 10/11: screen foot 1.13 vs drawn 1.08 at 0.92 | DASH UNVERIFIED (platform default) |
| 21099 | pass | pass | pass | L100 R96 | 0 | 11 881 | 10/10 | DASH UNVERIFIED |
| 2115 | pass | pass | pass | L100 R96 | 0 | 12 226 | 6/6 | DASH UNVERIFIED |
| 2110 / 2112 / 2111 | pass | pass | pass | L100 R99 | 0 | 14 642 / 14 666 / 14 366 (over budget, set aside by the owner) | 11/17, 10/12, 10/14: screen foot 1.22 vs 1.154, glass runs at the rail | 4/5 each |
| 2121 / 2131 | pass | pass | pass | ✗ L17 R100: the left glass hidden by the door's trim (frame) | 0 | 11 854 / 12 976 | 12/14, 13/15: screen foot, belt half width (roof and rail: the check fixed) | 5/5 |
| 1111 | pass | pass | pass | L100 (one mirror) | 0 | 10 597 | 14/15 | 4/5 |
| GAZ-24 | pass | pass | pass | ✗ L59 R82: door trim on the left | 0 | 13 288 | 9/12: screen foot, rail, front door (back-light foot accepted) | 6/6 |
| GAZ-31029 | pass | pass | pass | L100 R88 | 0 | 12 127 | 6/8: back light foot, boot lid | 6/6 |
| AZLK-2141 | pass | pass | pass | L100 R100 | 0 | 12 133 | 14/16: front glass edge, mirror s | 3/5: Samara dash (3 spokes vs 2) |
| UAZ-469 | pass | pass | no target | L100 R100 | 0 | 11 152 | 9/9 | 7/7 |
| UAZ-2206 | pass | pass | no target | L100 R94 | 0 | 10 979 | 6/11 | 1/3 |
| Nexia | pass | pass | pass | L100 R96 | 0 | 13 475 | 9/10: belt half width | 6/6 |
| Espero | pass | pass | pass | L100 R100 | 0 | 14 486 | 9/9 (B-pillar shut line at the drawn 2.50) | 8/8 |
| Astra F | pass | pass | pass | L100 R100 | 0 | 13 971 | 13/13 | 6/6 |
| Vectra A | pass | pass | pass | L100 R100 | 0 | 13 866 | 12/12 (door bottom 0.255 accepted: the silencer) | 4/4 |
| W124 (draft, review 3) | pass | pass | pass (0-100 12.4 vs 11.1 accepted, `CATALOGUE_OPTIMISTIC`) | L100 R100 | 0 | 12 194 | 20/20 (front glass from the A pillar accepted; sill and door bottom at the drawing; the bonnet's lip on the carsized photo, 0.19) | 9/9 |

Dents and drawing round (2026-10-19): kit-surface passes on all 27 (05 bonnet ends at the drawn 0.90, the scuttle behind it; 05 belt width at s 3.33; 2104 tail lean; 2115 wing belt; Niva corner plan through ±0.786 with a station at 0.4; GAZ-24 boot one convex curve; UAZ-469 sill tucked from the wing; deck and lid quads folded outward (body.ts); 2206 nose lean; Espero tail corners at 0.925; 2107 grille bars without hidden back faces). Drawing: roofHalfWidth is now read at the rail (it was 3 cm under a crowned top); the front door's glass run is its longest (vent wings, quarter lights); Nexia/AZLK roof refs corrected to the A pillar line at the rail; 05 shoulder rise 0.035 (front view ±0.773 at 0.90), a black sail ahead of the door glass (mirrorS on it). Still out of tolerance: 2103/2106 waist strip (the ref is read in the vaz_2103/2106.jpg frames, ~7 % taller than BODY_124: re-register it), 2108 bonnet lip, 2109 front door, the tens' screen foot, mirror, glass at the rail and boot, the Niva's screen foot and belt width, the Oka's belt width, the GAZ-24's screen foot, rail and door, the GAZ-31029's door and boot lid, the AZLK's front glass edge and mirror, the UAZ-2206's screen and glass runs, the Nexia's belt width. The 2107's 0-100 was not looked at.

Mirrors (kit-check
2026-10-19, every car passes):
- **2121/2131:** L84 R85 → after the frame-depth change L84 R100. A chrome head on a rod from
  the door's skin (`mirrorStalk` 0, `mirrorS` 1.50), its foot read at s 1.47–1.49 on three
  photos of 1982/1983/1990 cars with the vent wing (Commons, measurements-niva.md §1.5); both
  doors carry one from the start (5koleso.ru).
- **GAZ-24:** L64, one mirror (`mirrors: 'left'`: the factory four-view and owners, serial
  sedans had no right one). At the sourced place (mount hole 175.5 mm behind the door's edge,
  s 1.635; the drawing's head 1.61–1.72, 0.04 out, 0.12 over the belt: `mirrorStalk` 0.04,
  new `mirrorReach` 0.04) it shows through the quarter light. It was hidden by the post
  because every door's window frame stood as deep as its card (7.5 cm); the frame above the
  belt is now `DOOR_FRAME_DEPTH` 3 cm (body.ts, every car; the card's top closes the step).
  measurements-volga.md §1.4.

Owner review update (2026-10-19; supersedes the older mirror-sail note above):
- **2104/2105/2107:** the returned black wedge ahead of the door glass is removed. The
  shared `BODY_05` columns stay in place, but their finish is body colour; targeted
  drawing checks remain 12/12, 16/16 and 15/15.
- **Door mirrors:** short arms and upright stalk brackets are placed from `skinX` at their
  mounting height and sunk into the panel. `kit-mirrors` now fails a mirror whose housing
  has no shell overlap; all 27 cars pass, with visibility unchanged.
- **UAZ-469 and UAZ-2206:** the front sill before the front wheel is raised above the
  bumper's lower edge; the old hanging triangular skirt is gone. The UAZ-2206's unrelated
  screen/glass drawing mismatches remain open.
- **Dashboards:** finished cars are explicitly accepted in the dashboard gate. A future car
  is not added to `OWNER_ACCEPTED_EXISTING_DASH`; without a real interior photo and `dash`
  block it fails as `DASH UNVERIFIED`.

Sliver-heavy meshes (10–31 %, listed by kit-surface) are mostly exterior trim strips and
moulded bumpers.

## Known gaps

**Global**
- **Stickers on doors**: fixed (2026-10-13). A decal on a moving part hangs under it in its
  shut frame (`render/stickerdecals.ts` `StickerDecalCarrier`), and placement reads the
  chassis stamp under the aim, so a sticker on a door, lid, flap or drop glass moves with
  it and one aimed at an open door lands on the door.
- **Shaders**: checked in the world (2026-10-13), see the CHANGELOG entry for the counts.
  The car lab links 15 programs after boot; with the kit cars at night, lamps on and parts
  open the count is the same on HEAD and on the flat-run merge (2026-10-15).
  A kit car's anchor (`buildProgramAnchor`) holds its driving clone (skinned body, glass
  and wheels), its mid shell, a wreck and a courier; LOD, opening parts and a door's
  sticker layer change only visibility, bones, uniforms and transforms. Since the
  three-draw car (2026-10-15) no program links over a 90 s drive with every lamp, door and
  pane worked, nor on jumps along 20 km of wrecks and couriers.
- **Draw calls** (2026-10-15): a kit car is three draws (its one material, its glass, its
  wheels; README "Draw calls"), mirror faces and a sticker layer apart. Left: the glass is
  transparent and double sided, so it draws twice (back faces, then front), as before.
- **Z-fighting** (`tools/kit-zfight.ts`, 2026-10-16): 0 visible clusters in every band
  (close, 10–25 m, >25 m/far) on all 13 cars, and every shell hole under an item is
  covered from every exterior viewpoint by what a mid or far car still draws (0 slits).
  HISTORY.md "Z-fighting at every distance". The scanner is a gate (2026-10-15): it exits
  1 on any visible cluster or slit, so rerun it after any generator or spec change.
- **Flat runs** (2026-10-15): `simplifyFlats` merges every car's coplanar same-colour
  triangles and drops zero-area ones. Left: slivers where a surface genuinely bends in
  small steps (bumper sweeps, the rounded rear-door edge on the tens), and the 5° diagonal
  fold in each flank piece of the tens' tail-lamp lens (half the body's own twist there,
  half `rearLean`; the owner left it as is).
- **Cabin lining** (2026-10-15): above the belt the lining is the shell's greenhouse and
  roof set `LINING_DEPTH` in (`ShellResult.lining`), so it ends at every pane and opening;
  rubber runs from each pane to the frame's inner side. Left: thin slivers of paint in the
  door shut gaps just below the belt (the door-card area).
- **Shadows** (2026-10-15): the kit's detail parts (`kitShadowed`: cabin, bay, boot,
  underbody) cast no sun shadow and receive the shell's; only the mirror face carries
  `kitCastsNone`, and `addBuilt`/`Cabin.hinge` have no `casts` parameter any more.
- **Traffic seen from behind** (2026-10-15): the exhaust draws at every distance and is in
  the mid and far meshes; the glass is an opaque mirror from 45 m, so the cabin's 50 m line
  is unseen; mid traffic's panes are the car's own glass, dust and all. Behind a 2107 and a
  2109, mid at 55 m matches full at 45 m in exhaust, paint dust and the rear glass (renders
  in HISTORY.md "Traffic seen from behind"). Left: the rest of the underbody (classic axle
  and diff, Samara twist beam and tank) still comes in at 50 m as a dark band under the
  bumper; mid bumpers and wheels are a shade lighter than near (the far material).
- **Cabin fine detail** (2026-10-15): the cabin's small parts (needles, dial faces and
  their glow, warning lamps, switches, knobs, stalks, horn pad, pedals, levers, cranks,
  door handles and lock knobs, visors, courtesy lamp, glovebox, ashtray) draw only within
  `KIT_FINE_M` 6 m, with the eye inside, or for the car the player sits in; seats, bench,
  door cards, dash, wheel rim and the inside mirror stay to 50 m. A parked 2101 at 10 m
  draws 61 meshes instead of 121, a 2109 63 instead of 130. Windows and dial faces the
  fine faces fill keep stand-ins, so no hole shows. Left: a lit cluster's faint glow is not
  seen past 6 m at night (1–8 pixels at 8 m; HISTORY.md "Cabin fine detail").
- **No ink outline** (agreed).
- The bonnet item grid is not rearranged yet (engine central).
- **Lamp roles**: only head, tail, brake, reverse, blinkers (and never-lit `inert`). Every
  kit brake cell also glows at tail level with the lights on; there is no role for a
  brake-only lamp (the 2115's high brake lamp) or for fog lamps. Adding one means a role in
  `spec.ts`/`names.ts`/`KIT_LIGHTS`, a slot in `vehicle/vehiclelamps.ts` and the rig; mind
  the shader rules (no new material variant at run time).

**Classics**: 2103 arch chrome, C-pillar vents, 2105/2107 mirror sail, the 2107's bonnet
notch round its grille are not modelled. The 05 bonnet nose is deliberately flatter than
the drawing (HISTORY.md).

**Samaras** (`measurements-samara.md` §5): the greenhouse is the 2108 drawing's, about
60 mm shallower relative to the body than on the 21099 drawing; the front door's leading
edge is 27–39 mm behind the photo/21099 drawing (the 2108's kept so the shared front is
identical); tail-lamp tail/stop split is [INFERENCE].

## Running gear and performance

Audit of 2026-10-13 for the kit-only rollout (the kit cars are the game's only cars). Every
figure below is read from the source named with it; a figure that no source prints is
marked [E] and says where it comes from. Running gear lives in `vehicle/carmodels.ts`
(`KIT_CARS`, `GEAR_VAZ_*`, the `sv_*` siblings in `SOVIET_SPECS`), targets and sources in
`tools/reality.ts` (`TARGETS`, `kit_*`), engines in `parts/registry.ts`.

### What each car runs on

| Car | Version | Kerb kg | Engine (net) | Box, final drive | Tyre | Tank | Front share | Brakes | Lock rad | Cd·A m² | Springs, aero |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2101 | 2101 1.2 | 955 | `engine_lada_1200` 47 kW/5600, 87.3 Nm/3400 | 3.75/2.30/1.49/1.00, 4.3 | 165/80 R13 | 39 | 0.51 [E] | unassisted 1.0 g | 0.529 | 0.95 | `SUSP_ZHIGULI`, `AERO_ZHIGULI` |
| 2102 | 2102 1.2 | 1010 | `engine_lada_1200` | 2101 box, 4.44 | 165/80 R13 | 39 | 0.50 [E] | unassisted | 0.531 | 1.07 | `SUSP_ZHIGULI_ESTATE`, `AERO_ZHIGULI_ESTATE` |
| 2103 | 2103 1.5 | 1030 | `engine_lada_1500` 53.3 kW/5600, 104 Nm/3400 | 2101 box, 4.1 | 175/70 R13 (0.288) | 39 | 0.51 [E] | servo 1.2 g | 0.53 | 0.95 | Zhiguli |
| 2104 | 2104 1.3 | 1020 | `engine_lada_1300` 47 kW/5600, 92 Nm/3400 | 3.67/2.10/1.36/1.00, 4.3 | 175/70 R13 (0.288) | 39 | 0.50 [E] | servo | 0.53 | 1.07 | Zhiguli estate |
| 2105 | 2105 1.3 | 995 | `engine_lada_1300` | 2105 box, 4.3 | 175/70 R13 (0.288) | 39 | **0.548** | servo | 0.53 | 0.92 | Zhiguli |
| 2106 | 2106 1.6 | 1035 | `engine_lada_1600` 55.5 kW/5400, 116 Nm/3000 | 3.67/2.10/1.36/1.00, 3.9 | 175/70 R13 (0.288) | 39 | 0.51 [E] | servo | 0.53 | 0.95 | Zhiguli |
| 2107 | 2107 1.5 | 1030 | `engine_lada_1500` | five-speed …/0.82, 3.9 | 175/70 R13 (0.288) | 39 | 0.51 [E] | servo | 0.53 | 0.92 | Zhiguli |
| 2108 | 2108 1.3 | 900 | `engine_samara_1300` 47 kW/5600, 94 Nm/3400 | 3.636/1.95/1.357/0.941/0.784, 3.94 | 165/70 R13 | 43 | 0.62 [E] | servo | 0.59 | 0.88 | `SUSP_SAMARA`, `AERO_SAMARA_HATCH` |
| 2109 | 2109 1.3 | 915 | `engine_samara_1300` | Samara box, 3.94 | 165/70 R13 | 43 | 0.615 (AO kerb split 0.607) | servo | 0.59 | 0.88 | Samara hatch |
| 21099 | 21099 1.5 carb. | 970 | `engine_samara_1500` 51.5 kW/5600, 106.4 Nm/3400 | Samara box, 3.94 | 165/70 R13 | 43 | 0.60 [E] | servo | 0.589 | 0.84 | Samara, `AERO_SAMARA_SALOON` |
| **2115** | **2115 1.5i** | **985** | **`engine_vaz_2111` 57.2 kW/5400, 115.7 Nm/3000** | **Samara box, 3.706** (`gearbox_samara_5_tall`) | 165/70 R13 | 43 | 0.60 [E] | servo | 0.589 | 0.84 | Samara, saloon |
| **2110** | **21102** | **1020** | **`engine_vaz_2111`** | **Samara box, 3.706** | 175/70 R13 | 43 | 0.62 [E] | servo | 0.604 | **0.67** | Samara, `AERO_VAZ_2110` |
| **2112** | **21122** | **1020** | **`engine_vaz_2111`** | **Samara box, 3.706** | 175/70 R13 | 43 | 0.62 [E] | servo | 0.604 | **0.67** | Samara, `AERO_VAZ_2110` |
| Nexia (2026-10-18) | Nexia 1.5 GL (G15MF) | 969 | `engine_daewoo_g15mf` 55 kW/5400, 123 Nm/3200–3400 | `gearbox_opel_f16_nexia` 3.545/1.952/1.276/0.892/0.707, 3.944 | 175/70 R13 | 50 | 0.62 [E] | servo | 0.656 | 0.74 | Samara, `AERO_DAEWOO_NEXIA` |
| Espero (2026-10-18) | Espero 2.0 MT CD (C20LE) | 1128 | `engine_daewoo_c20le` 77 kW/5000, 169 Nm/2800 | `gearbox_opel_f16_nexia` (the Nexia's, same 3.944 axle) | 185/65 R14 | 50 | 0.62 [E] | servo | 0.634 | 0.72 | Samara, `AERO_DAEWOO_ESPERO` |
| Astra F (2026-10-18) | Astra F 1.6i GL five-door (C16NZ) | 1010 | `engine_opel_c16nz` 55 kW/5200, 125 Nm/2800 | `gearbox_opel_f13_wr` 3.55/1.96/1.30/0.89/0.71, 3.94 | 175/70 R13 | 52 [E] | 0.62 [E] | servo | 0.60 | 0.65 | Samara, `AERO_OPEL_ASTRA_F` |
| Vectra A (2026-10-18) | Vectra A 2.0i GL saloon (C20NE) | 1130 | `engine_opel_c20ne` 85 kW/5200, 170 Nm/2600 | `gearbox_opel_f16_wr_355` 3.545/1.952/1.276/0.892/0.707, 3.55 | 195/60 R14 | 61 | 0.62 [E] | servo | 0.525 | 0.62 | Samara, `AERO_OPEL_VECTRA_A` |

Bold: changed in this audit. Before it, the 2110, 2112 and 2115 drove the 21099 entire:
970 kg, the 1.5 carburettor, the 3.94 axle and the 21099's shape.

### Measured against the factory (`bun tools/reality.ts`, 2026-10-13, all 13 pass)

Test load: driver and passenger (+150 kg) for top and 0-100; the 80-0 at gross mass with
a floored pedal against the type-approval ceiling (pass = shorter); turning: the factory
outer-front-wheel radius, which the bench compares as the turn centre's offset
(`sqrt(R² − L²) − t/2`, the "bench" column). Tolerances: top ±5%, 0-100 ±8% (or an accepted
known deviation held within 3 points), turn ±3%, wheelbase/track/radius ±0.5%.

| Car | Mass kg | Wheelbase m | Tracks m | Top km/h target / measured | 0-100 s target / measured | 80-0 m ceiling / measured | Turn: factory R / bench target / measured |
|---|---|---|---|---|---|---|---|
| 2101 | 955 | 2.424 | 1.349 / 1.305 | 142 / 142 | 20 / 19.7 | 43.2 / 35.3 | 5.6 / 4.37 / 4.38 |
| 2102 | 1010 | 2.424 | 1.365 / 1.321 | 138 / 136 | 23 / 22.6 | 43.2 / 35.3 | 5.6 / 4.37 / 4.37 |
| 2103 | 1030 | 2.424 | 1.365 / 1.321 | 152 / 148 | 17 / 17.6 | 43.2 / 35.8 | 5.6 / 4.37 / 4.37 |
| 2104 | 1020 | 2.424 | 1.365 / 1.321 | 137 / 136 | 18.5 / 20.9 ~ | 38 / 35.8 | 5.6 / 4.37 / 4.37 |
| 2105 | 995 | 2.424 | 1.365 / 1.321 | 145 / 143 | 18 / 20.0 ~ | 38 / 34.8 | 5.6 / 4.37 / 4.38 |
| 2106 | 1035 | 2.424 | 1.365 / 1.321 | 150 / 150 | 16 / 17.0 | 43.2 / 34.7 | 5.6 / 4.37 / 4.37 |
| 2107 | 1030 | 2.424 | 1.365 / 1.321 | 150 / 150 | 17 / 18.3 | 38 / 34.4 | 5.6 / 4.37 / 4.37 |
| 2108 | 900 | 2.460 | 1.400 / 1.370 | 148 / 147 | 16 / 17.8 ~ | 38 / 32.5 | 5.2 / 3.88 / 3.90 |
| 2109 | 915 | 2.460 | 1.400 / 1.370 | 148 / 146 | 16 / 18.0 ~ | 38 / 32.5 | 5.2 / 3.88 / 3.90 |
| 21099 | 970 | 2.460 | 1.400 / 1.370 | 154 / 154 | 13.5 / 16.6 ~ | 38 / 33.2 | 5.2 / 3.88 / 3.90 |
| 2115 | 985 | 2.460 | 1.400 / 1.370 | 158 / 160 | 13.2 / 15.4 ~ | 38 / 33.2 | 5.2 / 3.88 / 3.91 |
| 2110 | 1020 | 2.492 | 1.400 / 1.370 | 167 / 171 | 14 / 15.5 ~ | 38 / 33.2 | 5.2 / 3.86 / 3.84 |
| 2112 | 1020 | 2.492 | 1.400 / 1.370 | 167 / 171 | 14 / 15.5 ~ | 38 / 33.3 | 5.2 / 3.86 / 3.84 |
| Nexia (2026-10-18) | 969 | 2.520 | 1.400 / 1.406 | 163 / 164 | 12.5 / 15.3 ~ | – / – (none found) | 4.9 / 3.50 / 3.52 |
| Espero (2026-10-18) | 1128 | 2.620 | 1.426 / 1.406 | 185 / 185 | 10.8 / 12.8 ~ | – / – (none found) | 5.2 / 3.78 / 3.83 |
| Astra F (2026-10-18) | 1010 | 2.517 | 1.430 / 1.429 | 170 / 170 | 14.0 / 15.5 ~ | – / – (none found) | 5.25 / 3.89 / 3.91 |
| Vectra A (2026-10-18) | 1130 | 2.600 | 1.437 / 1.432 | 198 / 200 | 10.5 / 12.2 ~ | – / – (none found) | 6.0 / 4.69 / 4.74 |

Loaded wheelbase, front track and rolling radius equal the factory figures on all 13
(0.0%). Threshold 100-0 against a road test: 2110 54.6 m against Za Rulem's 55.0 m for a
21102 (judged, −0.7%); the 2112 55.0 m, the 2104 51.5 m against Autoreview's 49.4 m and the
2109 53.2 m against 44.7 m are printed only (second-hand figures, or another body's). Since
the MXV road tyre (2026-10-27) the 2110 stops in 47.4 m (−13.8%) and Za Rulem's figure is
printed only too: it was measured on the 21102's budget tyres (`BUDGET_TYRE_STOP` in
`tools/reality.ts`, docs/physics-references.md "Braking on the MXV").

`~` = a known 0-100 deviation, accepted with its cause in `tools/reality.ts`:
- **Catalogue optimistic** (2108, 2109, 21099, 2115, 2110, 2112: +11 to +23%). A point-mass
  run from the engine's own net curve, ratios, efficiency, Cd·A and the stated load, with
  the crank's inertia geared to the wheels, is already slower than the printed time (21102
  15.1 s against 14, 2115 15.0 against 13.2, 21099 16.5 against 13.5); the bench is within
  ~3% of that bound. The model uses the GOST net figure as printed. The tens' other printed
  axle, 3.937, was tried: 8.9% on the 21102, still outside, so the 3.706 the sources name for
  the 2112 and 2115 stays.
- **Classic launch** (2104 +13%, 2105 +11%): the 1.3 rear-drive cars from rest; the cause is
  not identified (traction was ruled out, see `tools/reality.ts`). The 2106 and 2107 pass.

Top speed on the 2110/2112 is 171 against the manual's 167 (+2.7%, in tolerance) with the
Dmitrov tunnel's Cd·A 0.670 m² kept as measured; the repair manual prints 170 for the same
21102. The 2115 is 160 against 158 with the 21099's AvtoVAZ Cd·A (no 2115 figure exists).

### Proportions (`bun tools/kit-proportions.ts`)

Hard gates pass on all 13: the `model-fits.json` rows equal a fresh `carModelMeasure`
(0 mm) and the factory box, wheelbase, tracks, radius and clearance (0.0%); no hub moves
more than 8 mm in its arch when the loader lays the factory wheelbase over the generated
axles. Advisories (the generated body before the loader fits it):
- **Height.** The drawings stand lower than the passports, and the loader grows the bodies
  by: 2101 8.8%, 2102 10.4%, 2103 9.3%, 2106 9.2% (the `BODY_124` roof is 1.337), Samaras and
  2115 5.8–6.6% (roof 1.335); the 05 shell (2104/2105/2107) and the tens under 1%. The
  pipeline (`tools/vehicle-pipeline.md` §9) calls more than 2–3% a sign the source is wrong:
  the `BODY_124` and `BODY_2108` roofs are the first thing to re-measure against a photo.
- **Width.** Generated shells are 1.2–1.5% wider than the passport (the tens 1.8% narrower,
  the passport's 1680 including the mouldings); fitted out.
- **Tracks and tyre.** The 2101 is built on the `BODY_124` half tracks (1.365 / 1.321 against
  its 1.349 / 1.305) and a 0.288 tyre (165/80 R13 is 0.297); the 2102 the same tyre. The
  loader places and sizes the wheels to the factory, so this is inside the arches only.

### Changes in this audit, with sources

- **2110 / 2112 / 2115 own running gear** (`GEAR_VAZ_21102`, `GEAR_VAZ_21122`, `GEAR_VAZ_2115`)
  and a new engine **`engine_vaz_2111`** (57.2 kW at 5400, 115.7 Nm at 3000, GOST 14846-81
  net, idle 800): the VAZ-2110 manual's tables
  (autoprospect.ru/vaz/2110-zhiguli/1-obshhie-svedeniya.html): kerb 1010/1020/1020 kg for
  the 2110/21102/21122, 167 km/h and 14.0 s for the 21102 and 21122, ratios 3.636 / 1.950 /
  1.357 / 0.941 / 0.784, final drive "3,706 или 3,937", 175/70 R13, 5.2 m outer-wheel radius,
  38 m from 80 km/h at full mass. Dynamics "with driver and passenger", gross 1480 kg:
  vaz-rukovodstvo.ru/2110/1-110vaz.htm. Cx 0.347 on 1.931 m²: vaz-rukovodstvo.ru/2110/aerodinamika.html.
  Tank 43 l: drom.ru/catalog/lada/2110/specs/tank. The 2115 1.5i: 985 kg, 158 km/h, 13.2 s,
  final drive 3.7, 165/70 or 175/70 R13, 5.2 m, 38 m laden (ladaonline.ru catalogue,
  SECTION_ID=358 ELEMENT_ID=12598; carexpert.ru/models/vaz/2115/tech/vaz15s.htm, gross 1410).
- **2101 height 1382 → 1440** (`FACTORY_GEOMETRY.kit_vaz2101`): njcar.ru/dimensions/vaz/2101,
  wroom.ru; the 2106 on the same shell is 1440–1444 (carexpert.ru, drom.ru). Tyre width to
  0.165, the 165/80 R13 its radius already was (the 2101 manual,
  remkomplekt.org/vaz-2101/tehnicheskie-harakteristiki.html).
- **2107 height 1435 → 1446**: drom.ru/catalog/lada/frame/2107 (njcar.ru prints 1440; no
  source prints 1435); the 2105 on the same shell is 1446.
- **2105 front share 0.51 → 0.548** (`sv_vaz2105`, so also the pack car): kerb 995 kg "в том
  числе на переднюю ось 545, на заднюю 450" (autoopt.ru, vaz-2105). The pack 2105's 0-100
  moved from +12.1% to +11.1%, inside its accepted note.
- Fit rows of `kit_vaz2101` and `kit_vaz2107` regenerated (`tools/fit-models.ts`).

### Left open (known drift and conflicts)

- **Axle splits are [E]** for every car but the 2105 (and the 2109's 555/360 = 0.607, which
  the game's 0.615 is within a point of). The 2104/2107 share the 2105's shell and are
  probably nearer 0.55 than 0.51; the 2108's 0.62 is unsourced (autoopt prints only its
  laden split). Not changed without a source.
- **Final drives**: the 2108/2109 manual prints 3.9 against the game's 3.94 (autoopt.ru); the
  21099 manual prints "3,7 или 3,9" against 3.94. Kept: a 1% difference, and the 21099's
  shorter choice is the quicker one.
- **Source conflicts**, kept as stated: 2115 kerb 970 (drom.ru) / 985; 2115 0-100 14 s and
  155 km/h (drom.ru) / 13.2 s, 158; 21102 top 167 (manual) / 170 (repair manual); 2110
  wheelbase 2492 / 2490 (autoopt.ru); 2105 length 4130 / 4145 (drom.ru, most trims); 2106
  length 4166 / 4116 (njcar.ru, most trims); 2104 tank 42 l (drom.ru) / 39; 2101 80-0 ceiling
  43.2 m (autoprospect.ru) / 38 m (remkomplekt.org); 2106 top 150 (autoopt.ru) / 154
  (carexpert.ru). No primary factory text prints the classics' overall dimensions (the
  manuals carry them as drawings): those rest on catalogue aggregators.
- **Tyre profile on the 2103–2107**: the rolling radius is 175/70 R13's (0.288; the catalogues
  list 165/80 or 175/70 R13), but the tyre curve is the 80-series one (`tyre.aspect` 0.8, the
  comments say 165/80). One of the two should follow the other; left for a handling pass
  since either moves grip and the accepted launch figures.
- Not printed anywhere read: the 2111 engine's red line and mass (the Samara 1.5's kept),
  a 2112 or 2115 road-test 100-0, any 2115 Cd.
- The pack rows `sv_vaz2101` (1382) and `sv_vaz2107` (1435) carry the same heights the kit
  rows had; the pack cars are lab-only now and were left.

### What a car is checked on before it enters the game

`tools/vehicle-pipeline.md` is the full route; for a kit car the checks are:
1. **Sources**: one exact factory version; every figure below with its source (§2, §22).
2. **Geometry** (`FACTORY_GEOMETRY`): length, width, height, clearance, wheelbase, front and
   rear track, tyre radius and width; `tools/kit-proportions.ts` holds the fit row to the
   fresh measure and the factory, hub moves in the arches, and reports the loader's stretch.
3. **Running gear** (`CarModelDef`): kerb mass, front weight share, engine (net power and
   torque with their rpm, red line, idle; every engine held to its maker's figures within
   1% by `tools/reality.ts`), gearbox ratios, reverse, final drive, shift time, tank, tyre
   construction and profile, grip, brakes, steering lock, drive layout, handling profile,
   suspension preset (ride frequencies, damping, roll centres, bars, camber, toe, caster),
   Cd·A and the aero preset (lift, crosswind).
4. **Behaviour** (`tools/reality.ts`): loaded wheelbase, track and radius; top speed; 0-100
   through a manual box; turning radius by the outer wheel; 80-0 at gross mass against the
   type-approval ceiling; a measured 100-0 road test where one exists; lateral g and ride
   frequency printed beside their period figures.
5. **Driveline and cooling** for a new engine: `tools/driveline.ts`, `tools/cooling.ts`
   (every engine held in band by the one radiator), `tools/part-mesh-coverage.ts` (the loose
   engine has a mesh).
6. **World** (§16 gates 5–8): traffic, wrecks, trunk grid, save/load, shader programs
   flat during play, `npm run check` and `npm run build`; then by hand in the game.
