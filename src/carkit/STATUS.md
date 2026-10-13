# carkit: status and roadmap

What the owner wants, what is done, what is left. How to work: [`README.md`](README.md).
Why things are the way they are: [`HISTORY.md`](HISTORY.md). Keep this file current with
every change (update the car's row and the gaps).

Last updated: 2026-10-14, the 2112 added; the owner's review round on the tens and Samaras (flush bumpers, A pillars rounding into the roof, the 2110 nose, the 2115's wide face, rear-quarter slits closed).

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
- **Driving in the world**: today the kit cars exist only in the lab
  (`/?car-lab&pack=Kit`, `LAB_CAR_MODELS`). Driving them on the playground with the running
  gear of their `sv_*` siblings (already wired in `KIT_CARS`), catalogue entries for 2110,
  2112 and 2115. Before that: the sticker-on-door gap and the shader check below. Not started.
- **Owner's call, later**: replace the old pack models in the world, rearrange the bonnet
  item grid, transfer stickers to doors.

## Per-car status

All cars: lab only; interior, opening parts, lamps, LOD, dust/scratches/stickers on the
body work; wheels from `DISTINCT_SOVIET_WHEEL_SETS`. Triangle counts in README.

| Car | Spec | Measured on | Status | Left / known gaps |
|---|---|---|---|---|
| 2101 | `BODY_124` + `LOOK_2101`, `CABIN_2101` | `vaz2101.jpg` factory drawing; 3dcar.ru `vaz_2101.jpg`; Commons photos (`measurements-classics.md`) | done | C-pillar vents not modelled |
| 2102 | `BODY_2102` + `REAR_2102` (estates.ts) | 3dcar.ru `vaz_2102.jpg` (+0.037 m C-pillar correction from photo); Commons (`measurements-estates.md`) | done | no rear wiper; the tailgate's chrome handle and plate not placed (`FaceLook.lid` can carry them now) |
| 2103 | `BODY_124` + `LOOK_2103`, `CABIN_2103` | 3dcar.ru `vaz_2103.jpg`; Commons | done | arch chrome, C-pillar vents |
| 2104 | `BODY_2104` + `REAR_2104` (estates.ts) | 3dcar.ru `vaz_2104.jpg` (undimensioned, registered on `BODY_05`); Commons | done | no rear wiper; tailgate badge/handle and plate not placed |
| 2105 | `BODY_05` + `LOOK_2105`, `CABIN_2105` | 3dcar.ru `vaz_2107_1982.jpg` (body), `vaz_2105.jpg` (face, tail); Commons | done | mirror sail; hubs 20–30 mm off the dimension line (drawn hubs kept). A pillar slimmed in c86627d (also 2104, 2107) |
| 2106 | `BODY_124` + `LOOK_2106` | `vaz2101.jpg` + 0.045; 3dcar.ru `vaz_2106.jpg`; Commons | done | C-pillar vents |
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
- **Stickers on doors**: `stampCarBodyPositions` stamps vertices in the closed pose and the
  decal is attached to the body, so a sticker on a door stays where the closed door was
  when the door opens. Fix before going into the world.
- **Shaders**: a kit car's program warm-up anchor comes from the general loader. Clear glass
  (`car-glass-clear`) is a new variant: when the cars go into the world, check
  `info.programs` stays flat during play (`.omp/rules/shader-variants.md`).
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
