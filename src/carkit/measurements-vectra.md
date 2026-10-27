# Opel Vectra A: measurements

The Vectra A shares no stampings with another kit car, so it gets its own spec:
`BODY_VECTRA_A` / `LOOK_VECTRA_A` in `opel.ts`, `platform: 'samara'` (transverse engine in
front, front drive, struts and a twist beam), and dash `CABIN_VECTRA_A` in interior.ts.

**The car built** is the saloon, facelift of 09.1992–1995, 2.0i GL (C20NE, the F16 five-
speed on the 3.55 final drive). No registration statistics for the Vectra A in the CIS were
found. drom.ru's and drive2.ru's owners' reviews split between the 1.8 (C18NZ) and the 2.0
(C20NE); the saloon is by far the common body in them. The 2.0 was picked because it is the
better documented one: the Russian Vectra club gives its gearbox and final drive
(vectra-club.ru "Вопросик по КПП F18": "МКПП F16 на всех, ГП 2-3,55").

Its running gear is its own (`GEAR_OPEL_VECTRA_A: KitOwnGear` in vehicle/carmodels.ts, §4).

Tags: **[D]** drawing, **[P]** photo, **[F]** factory/catalogue, **[E]** estimate.

## 1. Factory figures

| Figure | Value | Source |
|---|---|---|
| L × W × H | **4432 × 1706 × 1400** | auto-data.net "Opel Vectra A (facelift 1992) 2.0i (115 Hp)"; the drawing's dimension lines are 4430 / 1700 / 1400 |
| Wheelbase | **2600** | auto-data, the drawing |
| Tracks | **1437 / 1432** | auto-data (a single source) |
| Clearance | **150** [E] | not found |
| Tyres | **195/60 R14** (0.295 m free radius) | auto-data |
| Overhangs | not found | the drawn hubs centred on the factory wheelbase give **850 / 982** [E] |
| Kerb / gross mass | **1130 / 1645 kg** | auto-data |
| Top speed, 0–100 | **198 km/h, 10.5 s** | auto-data and autodata1 for the 2.0i (115 hp). auto-data's facelift page prints 210 km/h, taken as the 16V's figure [E] |
| Turning circle | **12 m** between walls | autodata1 (`turn` 6.0 in reality.ts) |
| Cd | **0.29** | the saloon's well-known figure (Opel) |
| Tank | **61 l** | auto-data |
| Engine | **C20NE**, 1998 cm³, 86 × 86, SOHC 8v, multipoint injection, catalyst: **85 kW (115 hp) at 5200, 170 Nm at 2600** | auto-data, carsart.net |
| Gearbox | **F16 WR**: 3.545 / 1.952 / 1.276 / 0.892 / 0.707, R 3.333, final drive **3.55** | gears: the Nexia's F16 WR (the cavweb table via MIG Web prints them rounded, 3.55 / 1.95 / 1.28 / 0.89 / 0.71); final drive: vectra-club.ru (above), forum.opel-club.ru "КПП на Астре" (C20NE with the F16/5 WR on 3.55 or 3.72) |

`FACTORY_GEOMETRY.kit_vectraa` = 4.432 × 1.706 × 1.40, clearance 0.15, wheelbase 2.60,
tracks 1.437 / 1.432, wheel radius 0.295, tyre 0.195.

The C20NE is a new `engine_opel_c20ne`. The Espero's C20LE is the same block on another
tune (77 kW, 169 Nm), so it can't be reused. The gearbox is a new `gearbox_opel_f16_wr_355`:
the Nexia box's gears on another axle.

## 2. Drawing

the-blueprints.com, vector drawing 9730, "Opel Vectra A (1989)": the watermarked preview
`https://www.the-blueprints.com/modules/vectordrawings/preview-wm/1990_opel_vectra_a.jpg`
(1280 × 905). Side view facing left, front view top right, rear view bottom right, no plan.
Dimension lines 4430, 2600, 1700, 1400. Working crops are in `/tmp/vectra/` and not kept.

| View | Basis | Scale |
|---|---|---|
| Side, along | the drawn tips x 80 / 841 | **5.821 mm/px**, `s = (x − 80) × 0.005821` |
| Side, up | the 1400 line y 89–328 | **5.858 mm/px**, `y = (328 − py) × 0.005858` |
| Front / rear, across | the body ±146 px (x 910–1202) for 1700 | 5.82 mm/px, centre x 1056 |
| Rear view, up | ground y 748 to the roof y 508 | 5.83 mm/px |

The drawn hubs (tyre chords' centres x 225 / 673.5) stand 2611 apart against the factory
2600. The wheels sit on the factory wheelbase centred on the drawn pair: **front 0.85, rear
3.45** [E].

| Feature | Drawn | Value | Spec |
|---|---|---|---|
| Bonnet centre line | top of the body colour at x 100–280 | 0.72 at s 0.116, 0.791 at 0.233, 0.826 at 0.349, 0.849 at 0.466, 0.861 at 0.582, 0.885 at 0.699, 0.902 at 0.815, 0.92 at 0.931, 0.931 at 1.048 | stations' `deck` (the face raised for the facelift's lamps, §3) |
| Cowl, A pillar | (290, 168) → (400, 96) | s 1.222 / 0.937 → 1.863 / 1.36 | first column 1.222 / 1.863 |
| Roof | top line | 1.371 at s 1.92, 1.394 at 2.07, 1.412 from 2.27 to 2.68, 1.40 at 3.0, 1.394 at 3.11 | `rail` 1.31 + 0.02 + `crown` 0.08; `roofDrop` |
| Back light | the top line from s 3.11 (1.394) down to 3.9 (1.049) | its foot s 3.88, 1.04 | rearBase 3.88; last column `top` 3.12 |
| Boot | y 152–155 from x 740 | 1.03–1.013 to s 4.34 | stations 4.25, 4.34 |
| Side glass | the glass's top y 104–105; its foot | 1.306–1.312; 0.89 at s 1.7–2.15, 0.908 at 2.5, 0.92 at 2.8, 0.931 at 3.03 | `rail` 1.31; belts 0.875 → 0.915 |
| Front door | shut line x 298; the glass's foot from x 370 | s 1.27; the sail to 1.62 | columns 1.26 / 1.29 / 1.62 |
| B pillar | x 480–505 | s 2.33–2.48 | columns 2.33–2.48 |
| Rear door, quarter glass | the glass to x 585; post x 585–600; the quarter glass x 600–635, its foot 0.93 | 2.94; 2.94–3.03; 3.03–3.22 | columns 2.94, 3.03 (with `foot`), 3.045 `fixed`, 3.22 |
| Arches | the front liner's top y 213, the rear y 216 | 0.674 / 0.656 | `arch` 1.28, `rearArch` 1.22 |
| Sill, door bottoms | y 293 | 0.205 | `sill` 0.22 (§5), `doorBottom` 0.25 |
| Rubbing strip | y 262 | 0.39 | `waist` 0.42 (the photos'), `span` [1.25, 3.02] |

Front view: rail ±0.594 at 1.31, ±0.565 at 1.36; the glass's foot ±0.79 at 0.89; the body
±0.85 at 0.6–0.75. Head lamps ±0.33–0.70, 0.615–0.703, and the grille ±0.32 at its top, on
the 1989 car. Bumper top 0.515, foot 0.17; intake ±0.43; fog lamps ±0.52–0.64.

Rear view: tail lamps ±0.545–0.742, 0.659–0.845; plate recess ±0.37. Body ±0.79 at 0.886,
±0.82 at 0.84. Bumper 0.28–0.63.

## 3. Photos (Wikimedia Commons)

| Photo | Seen |
|---|---|
| Opel Vectra A (front) | Facelift face, near straight: wide lamps filling the band from the bumper's top to the bonnet's lip, about 0.16 tall (85 px on a 735 px span of ±0.70); a black slatted grille with the badge between them; a dark bumper with a black band and the plate |
| Opel Vectra front 20080102 | Front 3/4: the same; a body-colour bumper with a black band along its top and a thin bright strip under it, fog lamps low at its ends; black door frames, B pillar and mirror sail; a rubbing strip along the flank with a bright line |
| Opel Vectra A (rear), Opel Vectra rear 20080102 | Rear 3/4: corner tail lamps, a red band at the top, then the reversing lamp inside and the amber indicator outside, the stop and tail lamp below (about 1 : 1 : 2); a black panel across the lid between them, their height, with the plate in it; a body-colour bumper with a black band |
| Opel Vectra I front / rear 20080328, 2.0i GLS 1994, 1.8i GL 1994 | Other facelift cars: the same face and tail |
| Opel Vectra taxi dashboard (GT 8445 R) | The dash (§5) |

Lamp shapes, checked against two photos per end (front straight and 3/4, rear straight and
3/4) in lab shots taken from the photos' angles:

| Lamp | Drawing (1989) | Photos (facelift) | Spec |
|---|---|---|---|
| Head | 0.615–0.703, ±0.33–0.70 | taller, filling the band between the bumper's black top and the bonnet's lip; the inner end along the grille's side; the clear indicator the outer sixth | 0.605–0.736; inner end ±0.312 → ±0.342; indicator from ±0.60, round the corner to s 0.15; the face's lip raised to 0.75 |
| Grille | ±0.32 at its top | black slats, narrowing to the foot | ±0.29, `slant` −0.03, frameless (§5) |
| Tail | 0.659–0.845, ±0.545–0.742 | 0.22–0.25 tall, three bands about 1 : 1 : 2 | 0.648–0.865; top red 0.818–0.865, the reversing / indicator band 0.764–0.812, the stop and tail lamp 0.648–0.758, 6 mm of body between; wrap to s 4.28–4.30 |
| Lid panel | body colour with a plate recess | black, across between the lamps, their height | `lid` panel ±0.50, 0.656–0.864 |

## 4. Running gear (`GEAR_OPEL_VECTRA_A`)

| Field | Value | Source |
|---|---|---|
| `mass` | 1130 | §1 |
| `engineId` | `engine_opel_c20ne` (new): 85 kW at 5200, 170 Nm at 2600, red line 6000 [E], 135 kg [E] | parts/registry.ts `FOREIGN_ENGINE_VARIANTS`; partmesh `buildInline` 1.05; reality.ts `FACTORY_ENGINES` |
| `gearboxId` | `gearbox_opel_f16_wr_355` (new): the F16 WR gears on 3.55, efficiency 0.92, 45 kg [E] | `FOREIGN_GEARBOX_VARIANTS` |
| `tyre`, `wheelGrip` | `ROAD_TYRE`, `ROAD_TYRE_GRIP` (every road car's; KAMA-217 0.53 until 2026-10-27) | |
| `tankLitres` | 61 | auto-data |
| `brakeDecelG` | servo | ventilated front discs, rear drums |
| `suspension` | `SUSP_SAMARA` | struts and a twist beam |
| `steerLock` | 0.525: 4.74 m on the bench against the 4.69 the 6.0 m radius gives | reality.ts |
| `frontWeightShare` | 0.62 [E] | |
| `dragArea` | 0.62 (198 km/h on the bench; Cd 0.29 × 1.96 m² = 0.57) | reality.ts |
| `aero` | `AERO_OPEL_VECTRA_A`: frontal area 1.96, the Nexia's lift and crosswind figures | |

Bench (`tools/reality.ts kit_vectraa`): top 200 against 198 (+1.1 %). 0–100 is 12.2 s against
10.5 (+15.9 %), accepted as `CATALOGUE_OPTIMISTIC` as the other GM cars' are. The turn is
4.74 against 4.69 (+1.1 %); geometry 0.0 %.

## 5. Dash, eye and visors (`CABIN_VECTRA_A`, interior.ts)

Read from Commons "Opel Vectra taxi dashboard (GT 8445 R) (14961906968).jpg", taken from
behind the driver's seat. Scale [E]: the wheel's hub (x 718 at 1333 px) to the stack's centre
line (x 1065) is the Samara's 0.36 seat line, 1.04 mm/px.

| Feature | Photo | Spec |
|---|---|---|
| Hood and dials | an angular hood; the tachometer, a big speedometer, the temperature and fuel dials stacked on the right | tachometer −0.10 (r 0.036, to 7000), speedometer 0 (r 0.044, to 220), temperature / fuel +0.095 (r 0.016) |
| Vents | a slatted vent at the driver's end of the dash (x 295–445); two side by side at the stack's top with the hazard switch between | ±0.6 at −0.05 (the passenger's mirrored [E]); ±0.065 at −0.08; hazard [0, −0.08] |
| Switches | a rotary light switch and two switches on a panel left of the column, under the end vent | knob right −0.25, dy −0.13; rockers at 0.49 / 0.53 |
| Stack | the heater's panel, the radio, a cubby | heater −0.17, radio −0.25, ashtray −0.32, `stack` half 0.12 |
| Wheel | three spokes, left, right and down, round a small pad | spokes −15 / 195 / 270° |
| Glovebox | not in the photo | the Astra's [E] |

- **Eye**: the new rule (header ≥ 10° over level, at most 3.5 cm lower) leaves the eye
  where it was, 1.176. The header stands 10.5° over level and the road shows from 6.5 m
  ahead.
- **Visors**: 0.092 deep, so that lowered they end 5 mm over the eye's height.
- **Bench**: 3 cm off the wheel-house covers.

## 6. Fixes found by the checks

- The silencer met the shell's floor between the arches at the drawn 0.205 sill. The sill
  is 0.22 there (the Astra's), and 0.25 at the back light's foot (the Espero's fix).
- The slanted grille's slats and back fought at a distance under a leaning face
  (`frontLean`), with or without the frame. The face stands upright (the drawn rake is
  small) and the grille is frameless.
- The lid's black panel ended 8 mm over the lid's foot and its bottom fought the lid's edge.
  It now ends 0.016 over it, inside the notch (±0.50).

## Gaps

- The face and tail are the facelift's from photos over a 1989 drawing; the lip raised to
  0.75 for the facelift's taller lamps is an estimate from the photos' proportions.
- The bumpers' thin bright strip under the black band, the rubbing strip's bright line,
  plates and badges are not modelled.
- The fog lamps are unlit grey panels.
- The grille has no frame (a thin black surround on the car).
- The dash's heights hang from the Samara's cluster [E]; the glovebox and the passenger's
  end vent are not in the photo.
- Overhangs, clearance, axle split, red line, engine and gearbox masses are estimates.
- Triangles: 13 509.

## Review 2 (owner, 2026-10-18): door lengths, pillars, mouldings, mirrors

Re-read on the-blueprints.com vector 9730 preview (`1990_opel_vectra_a.jpg`, the scales in
opel.ts), pixel rows by script, against the Commons GLS side photos ("1995 Opel Vectra 1.8i
GLS", the white GLS). Factory figures cross-checked: vehiclesizes.com and encycarpedia
(4432 / 1706 / 1400, wheelbase 2600). No free dimensioned drawing with door outlines was
found (Outlines' 1988 sheet is paid).

| Feature | Drawing | Model before | Model now |
|---|---|---|---|
| A pillar, at the belt → rail | 1.222 → 1.863 | same | unchanged |
| Front door shut line | x 298: 1.29 (1.28 at 0.66) | 1.29 | unchanged |
| Front glass front edge | 1.61 at the belt | 1.62 | 1.55 |
| Mirror head | x 335–366: s 1.48–1.66 | 1.34: **hidden behind the sail** | `mirrorS` 1.60, seen in the cabin view |
| B pillar above the belt | front glass ends 2.33, pillar lines 2.37 / 2.43, rear glass from 2.47 | 2.33–2.48 | 2.33–2.47 |
| Shut line between the doors | one line, 2.34 at 0.75 to 2.358 at 0.33 | 2.385 / 2.40 | 2.345 |
| Rear door's rear edge | the frame **includes** the small quarter glass: 3.26 at 0.96 leaning to 3.05 at the rail; shut line 3.30 down to 0.80, then forward (3.21 at 0.66, 3.13 at 0.52, 3.07 at 0.38) to 3.04 | 3.03 at the belt, the quarter glass in the body: **0.27 short** | 3.29 at the belt, `foot` y 0.80 → 2.98, the quarter glass on the door (`quarter_*`) |
| Door lengths at the belt | front 1.29–2.34 (1.05), rear 2.34–3.30 (0.96) | 1.10 / 0.63 | 1.055 / 0.945 |
| C pillar | 3.30 → back light foot 3.88 | 3.045 → 3.88 | 3.29 → 3.88 |
| Rubbing strip | y 262: 0.39 (photos 0.42), wing behind the arch to the rear wing in front of the arch | 1.25–3.02 | 1.20–3.30, a piece per panel |

The narrow rear door was the 1989 preview read with the quarter glass as body (the post at
2.95 taken as the door's end). On the drawing and the GLS photos the door's frame runs
round the quarter glass to the C pillar.

