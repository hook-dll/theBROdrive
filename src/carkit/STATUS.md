# carkit: status and roadmap

What the owner wants, what is done, what is left. How to work: [`README.md`](README.md).
Why things are the way they are: [`HISTORY.md`](HISTORY.md). Keep this file current with
every change (update the car's row and the gaps).

Last updated: 2026-10-15, the cabin lining is the shell's own (headliner and upper trim end at the glass), the tail lamps sit on the body without a black backing, and the kit's detail parts cast no sun shadow.

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
  glovebox, sun visors, ashtray, radio, seats (slide, recline, head restraints).
- The boot shows **empty**: items stay on the existing trunk grid. Later the bonnet grid
  gets rearranged: engine large and central, other parts at the sides.
- Later: a cockpit view.

**Must keep working**: stickers, dust/dirt and scratches on the paint; head, tail, brake,
indicator and reversing lamps.

**Budget**: ≈ 8–13k triangles per car; LOD at 25 m (cabin, bay, boot and underbody not
drawn, glass opaque).

**Wheels**: the Soviet pack's wheel sets, each of the six designs equally likely, rescaled
to the kit tyre. The kit's five generated wheel styles were removed at the owner's request.

## Roadmap (agreed order)

1. ✅ **Generator core**: 2106 and 2108 in the car lab, hover and click.
2. **VAZ cars** from specs: 2101, 2102, 2103, 2104, 2105, 2106, 2107, 2108, 2109, 21099,
   2110, 2112, 2115, 2121, 2131, 1111.
   Done: 2101–2109, 21099, 2110, 2112, 2115. **Left: 2121, 2131, 1111.**
3. **GAZ and UAZ-469**, then the **UAZ «буханка»** (UAZ-452).
4. **Trucks**, starting with the **ZIL-130**.

Pending stages that run alongside (the old numbering in commit messages: stage 2 = cockpit,
stage 4 = driving):
- **Cockpit view ("Сесть" / "Get in")**: a button in the car lab puts the camera in the
  driver's seat; keys turn the wheel and press the pedals (`KitRig` channels `steer`,
  `throttle`, `brake`, `clutch`, `gear`, …); fittings clickable from inside. Not started.
- **Driving in the world**: done (2026-10-13). `CAR_MODELS` is `KIT_CARS`: traffic, rivals,
  contract cars, the start car, couriers, wrecks and the dev spawn menu are kit cars on the
  running gear of their `sv_*` siblings; the pack bodies are lab-only (`LAB_CAR_MODELS`)
  and a save naming one loads on its kit twin. Every world `Vehicle` of a kit model has a
  live rig (`vehicle.kit`): doors, lids and flap open in the world, and the wheel, pedals,
  lever, handbrake, needles, light switch, stalk and hazard button follow the car.
- **Owner's call, later**: rearrange the bonnet item grid.

## Per-car status

All cars: in the world and the lab; interior, opening parts, lamps, LOD, dust/scratches/
stickers on the body and on the opening parts work; wheels from `DISTINCT_SOVIET_WHEEL_SETS`.
Triangle counts in README.

| Car | Spec | Measured on | Status | Left / known gaps |
|---|---|---|---|---|
| 2101 | `BODY_124` + `LOOK_2101`, `CABIN_2101` | `vaz2101.jpg` factory drawing; 3dcar.ru `vaz_2101.jpg`; Commons photos (`measurements-classics.md`) | done | C-pillar vents not modelled |
| 2102 | `BODY_2102` + `REAR_2102` (estates.ts) | 3dcar.ru `vaz_2102.jpg` (+0.037 m C-pillar correction from photo); Commons (`measurements-estates.md`) | done | no rear wiper; the tailgate's chrome handle and plate not placed (`FaceLook.lid` can carry them now) |
| 2103 | `BODY_124` + `LOOK_2103`, `CABIN_2103` | 3dcar.ru `vaz_2103.jpg`; Commons | done | arch chrome, C-pillar vents |
| 2104 | `BODY_2104` + `REAR_2104` (estates.ts) | 3dcar.ru `vaz_2104.jpg` (undimensioned, registered on `BODY_05`); Commons | done | no rear wiper; tailgate badge/handle and plate not placed |
| 2105 | `BODY_05` + `LOOK_2105`, `CABIN_2105` | 3dcar.ru `vaz_2107_1982.jpg` (body), `vaz_2105.jpg` (face, tail); Commons | done | mirror sail; hubs 20–30 mm off the dimension line (drawn hubs kept). A pillar slimmed in c86627d (also 2104, 2107) |
| 2106 | `BODY_124` + `LOOK_2106` | `vaz2101.jpg` + 0.045; 3dcar.ru `vaz_2106.jpg`; Commons | done | C-pillar vents; the rear panel between the lamps is body colour in its chrome outline (the owner's call; the real one is black) |
| 2107 | `BODY_05` + `LOOK_2107`, `CABIN_2107` | 3dcar.ru `vaz_2107_1982.jpg`; Commons | done | mirror sail; bonnet not notched round the grille |
| 2108 | `BODY_2108` + `LOOK_2108` (samaras.ts) | `vaz2108.jpg` factory drawing; front view for the face | done | the plastic bumper looks heavy |
| 2109 | `BODY_2109` + `LOOK_2109` | 3dcar.ru `vaz_2109.jpg` (registered; door lines from Commons photo `p1`) (`measurements-samara.md`) | done | rear door handle from the generator's rule (2.886 vs 2.99 on the photo) |
| 21099 | `BODY_21099` + `LOOK_21099` | 3dcar.ru `vaz_21099.jpg`; Commons | done | early face only (the late "high bonnet" face not modelled) |
| 2115 | `BODY_2115` + `LOOK_2115` | Commons photos only (no drawing exists); factory figures vaz.ru / drom.ru | done | see below |
| 2110 | `BODY_2110` + `LOOK_2110` (tens.ts), `CABIN_2110` | 3dcar.ru `vaz_2110.jpg` (4.092 mm/px from the drawn wheelbase); Commons photos for the quarter glass, arches, flap side, lamps, dash; factory figures infocar.ua / autoopt.ru / cartechnic.ru (`measurements-2110.md`) | done (base early car), owner's review fixes in | see below |
| 2112 | `BODY_2112` + `LOOK_2112` (tens.ts), `CABIN_2110` | 3dcar.ru `vaz_2112.jpg` (3.98 mm/px from the drawn wheelbase, hubs x 815 / 1441, ground y 410); Commons photos for the tail, lamps, spoiler; factory figures autoopt.ru (`measurements-2110.md` §8) | done | see below |
| 2121 | – | `niva.jpg` factory four-view present | **not started** | sibling `sv_niva` (off-road wheel pool kept automatically); 4×4 bay/underbody and its own dash needed |
| 2131 | – | – | **not started** | sibling `sv_niva_long`; derive from the 2121 shell |
| 1111 | – | – | **not started** | no `sv_` sibling (`KIT_CARS` requires one from `SOVIET_CARS`): a decision for the owner. The owner's own carforge Oka (`cf_vaz1111`, uncommitted files) is separate work; don't touch it |

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
  at the corners; 12 309 triangles.

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
with the label "VAZ-2112"; 14 705 triangles; dash `CABIN_2110`.

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

- **2111** (the tens' estate, not on the roadmap). Drawing `vaz_2111.jpg` is saved; it
  would derive from `BODY_2110` as the 2112 does.
- **2121 / 2131.** `niva.jpg` in `build/carshape/_refs/bp/img/`. Needs a new platform (4×4
  transfer box and axles in bay.ts, the Niva dash), spare wheel in the bay [INFERENCE from
  the real car], tailgate down to the bumper.
- **1111.** A small front-drive two-cylinder car; no pack sibling. Ask the owner which
  running gear it borrows.

## Later families: what they need

- **GAZ (Volga 21/24)**: drawings `gaz21.jpg` present; siblings `sv_gaz21`, `sv_gaz24`.
  Classic-like layout (`'classic'` platform probably reusable [INFERENCE]).
- **UAZ-469**: `uaz469.jpg` and `uaz2.jpg` (a 3151 hardtop four-view, dimensioned) present.
  Body-on-frame with a separate soft/hard top, flat panels, external hinges; no pack
  sibling (check `SOVIET_CARS`).
- **UAZ-452 «буханка»**: no drawing yet. Forward-control van: the cab sits over the front
  axle, so `bonnetFront`/cowl assumptions in the generator do not hold.
- **ZIL-130**: needs a **new cab + chassis generator**: a separate cab and bonnet on a
  ladder frame, a load bed, **dual rear wheels**, **3+ axles** for later trucks, and **new
  truck physics** (the vehicle model is car-only today). Much of `body.ts` (one lofted tub)
  does not apply.

## Known gaps

**Global**
- **Stickers on doors**: fixed (2026-10-13). A decal on a moving part hangs under it in its
  shut frame (`render/stickerdecals.ts` `StickerDecalCarrier`), and placement reads the
  chassis stamp under the aim, so a sticker on a door, lid, flap or drop glass moves with
  it and one aimed at an open door lands on the door.
- **Shaders**: checked in the world (2026-10-13), see the CHANGELOG entry for the counts.
  A kit car's anchor (`buildProgramAnchor`) holds its driving clone, a wreck and a
  courier; LOD, opening parts and a door's sticker layer change only visibility, uniforms
  and transforms.
- **Z-fighting** (`tools/kit-zfight.ts`, 2026-10-15): 0 visible close-range clusters on
  all 13 cars (HISTORY.md "Rendering" and "Cabin lining and tail lamps"). Left: the
  10–25 m rows (gaps of 0.15–0.93 mm, flickering between 10 m and the 25 m cabin LOD):
  the cabin's 0.5–0.6 mm layer steps (mirror glass on its pad, armrest cup, radio dial,
  gauge ticks and cluster bezels) and the rear hump tops crossing the arch liners
  (`interior.ts` `humps`, `HUMP_RISE` lifted straight up). Rerun the scanner after any
  generator change: no close-range visible row may appear.
- **Cabin lining** (2026-10-15): above the belt the lining is the shell's greenhouse and
  roof set `LINING_DEPTH` in (`ShellResult.lining`), so it ends at every pane and opening;
  rubber runs from each pane to the frame's inner side. Left: thin slivers of paint in the
  door shut gaps just below the belt (the door-card area).
- **Shadows** (2026-10-15): the kit's detail parts (`kitShadowed`: cabin, bay, boot,
  underbody) cast no sun shadow and receive the shell's; only the mirror face carries
  `kitCastsNone`, and `addBuilt`/`Cabin.hinge` have no `casts` parameter any more.
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

Loaded wheelbase, front track and rolling radius equal the factory figures on all 13
(0.0%). Threshold 100-0 against a road test: 2110 54.6 m against Za Rulem's 55.0 m for a
21102 (judged, −0.7%); the 2112 55.0 m, the 2104 51.5 m against Autoreview's 49.4 m and the
2109 53.2 m against 44.7 m are printed only (second-hand figures, or another body's).

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
