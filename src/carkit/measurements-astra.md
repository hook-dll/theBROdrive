# Opel Astra F: measurements

The Astra F shares no stampings with another kit car, so it gets its own spec:
`BODY_ASTRA_F` / `LOOK_ASTRA_F` in `opel.ts`, `platform: 'samara'` (transverse engine in
front, front drive, struts and a twist beam), and dash `CABIN_ASTRA_F` in interior.ts.

**The car built** is the five-door hatchback, facelift of 09.1994–1998, 1.6i GL (C16NZ, the
F13 five-speed). drom.ru catalogues the facelift for Russia from 08.1994 to 06.1998, as the
saloon and the three- and five-door hatches. No registration statistics were found. Owners'
reviews and listings show the hatchbacks to be the common body; a drive2.ru owner calls his
saloon "a rare saloon". The 1.6 eight-valve (C16NZ, from 1996 X16SZR, both 75 hp) is the
common engine in those reviews.

Its running gear is its own (`GEAR_OPEL_ASTRA_F: KitOwnGear` in vehicle/carmodels.ts, §4).

Tags: **[D]** drawing, **[P]** photo, **[F]** factory/catalogue, **[E]** estimate.

## 1. Factory figures

| Figure | Value | Source |
|---|---|---|
| L × W × H | **4051 × 1688 × 1410** | auto-data.net "Opel Astra F 1.6i (75 Hp)"; the drawing's dimension lines are 4050 / 1696 / 1410 |
| Wheelbase | **2517** | auto-data, avto-russia.ru, the drawing |
| Tracks | **1430 / 1429** | auto-data, cararac.com |
| Clearance | **135** | auto-data |
| Tyres | **175/70 R13** (0.288 m free radius) | auto-data (82T) |
| Overhangs | not found | the drawn hubs centred on the factory wheelbase give **797 / 736** [E] |
| Kerb / gross mass | **1010 / 1495 kg** | auto-data prints 990 / 1010 and gross 1495. Ultimatespecs gives 985. The five-door is taken as the heavier figure [E] |
| Top speed, 0–100 | **170 km/h, 14.0 s** | ultimatespecs, auto-data |
| Turning circle | **10.5 m** between walls | auto-data (`turn` 5.25 in reality.ts) |
| Cd | **0.32** | auto-data |
| Tank | **52 l** [E] | the Astra F's common figure; not on the pages above |
| Engine | **C16NZ**, 1598 cm³, 79 × 81.5, SOHC 8v, single-point Multec: **55 kW (75 hp) at 5200, 125 Nm at 2800** | auto-data, ultimatespecs (one source prints 128 Nm, the X16SZR's) |
| Gearbox | **F13 WR**: 3.55 / 1.96 / 1.30 / 0.89 / 0.71, R 3.31, final drive **3.94** | opel-motor.ru "Коробка передач на Опель F13" (the five-speed table); forum.opel-club.ru "КПП на Астре" (C16NZ with the F13/5 WR, final drives 4.18 / 3.94 / 3.74; from mid-1996 4th and 5th 0.95 / 0.761) |

`FACTORY_GEOMETRY.kit_astraf` = 4.051 × 1.688 × 1.41, clearance 0.135, wheelbase 2.517,
tracks 1.43 / 1.429, wheel radius 0.288, tyre 0.175.

The Nexia's F16 box (3.545 / 1.952 / 1.276 / 0.892 / 0.707, R 3.333) is a different set,
so the Astra gets its own `gearbox_opel_f13_wr`. The C16NZ is a new
`engine_opel_c16nz` (partmesh `buildInline` 0.98, a reality.ts `FACTORY_ENGINES` row).

## 2. Drawing

the-blueprints.com, vector drawing 9603, "Opel Astra F 5-Door (1991)": the watermarked
preview `https://www.the-blueprints.com/modules/vectordrawings/preview-wm/2001_opel_astra_f_5-door.jpg`
(1280 × 905). Side view facing left (the car's left side), front view top right, plan
bottom left, rear view bottom right. Dimension lines 4050, 2517, 1696, 1410. Drawing 3956
(the same title) has only side and plan. Working crops are in `/tmp/astra/` and not kept.

| View | Basis | Scale |
|---|---|---|
| Side, along | the drawn tips x 103 / 798 (the 4050 line 105–801) | **5.827 mm/px**, `s = (x − 103) × 0.005827` |
| Side, up | ground y 330 (the tyres' foot) to the roof y 90.5 = 1410 (the 1410 line 91–329) | **5.887 mm/px**, `y = (330 − py) × 0.005887` |
| Front / rear, across | the 1696 line x 913–1197 | 5.97 mm/px, centre x 1055 |
| Rear view, up | ground y 747.5 to the roof y 510 | 5.95 mm/px |
| Plan | tips x 103 / 800 | 6.06 mm/px across (one side read; the other is under the watermark) |

The drawn hubs (tyre centres x 236.5 / 675) are 2555 apart at the length scale against the
factory 2517. The wheels sit on the factory wheelbase centred on the drawn pair: **front
0.797, rear 3.314** [E].

| Feature | Drawn | Value | Spec |
|---|---|---|---|
| Bonnet centre line | y 210 / 199 / 188 / 180 / 173 at x 115 / 150 / 195 / 245 / 295 | 0.70 at s 0.07, 0.73 at 0.15, 0.77 at 0.27, 0.836 at 0.54, 0.883 at 0.83, 0.924 at 1.12 | stations' `deck` |
| Cowl / screen foot | (297, 172) | s 1.13, 0.93 | first column 1.13 |
| A pillar to the rail | (410, 102) | s 1.79, 1.342 | first column `top` 1.79 |
| Roof | y 90–95 | 1.41 at s 2.2–3.0, 1.385 at 3.13, 1.355 at 3.48 | `rail` 1.33 + 0.02 + `crown` 0.06; `roofDrop` |
| Side glass top | y 105 | 1.325 | `rail` 1.33 |
| Belt (glass foot) | y 175 / 173 / 168 / 162 | 0.912 at s 1.5, 0.924 at 1.96, 0.955 at 3.1, 0.989 at 3.65 | stations' `belt` 0.895 → 0.975 |
| Front door shut line | x 320 below the belt | s 1.264 | column 1.264 |
| Mirror and sail | x 345–372 | s 1.41–1.57 | the sail to the glass's front edge 1.52 |
| B pillar (black) | x 490–520: front glass ends x 490 / 505, rear glass from 512 / 520, shut line x 495 | 2.255 / 2.342; 2.383 / 2.43; 2.284 | columns 2.255–2.383 |
| Rear door glass's rear edge | x 635 belt / 627 top | 3.10 / 3.053 | column 3.10 |
| Black post, rear shut line | x 657 belt / 643 top; the shut line down to (648, 213), meeting the arch at (627, 233) | 3.228 / 3.147; 0.69; 3.05 / 0.57 | column 3.215 with `foot` { y 0.69, s 2.95 }; quarter from 3.228 |
| Quarter glass | a triangle: apex (643, 117), foot 657–730 | apex 3.147 / 1.254; foot 3.228–3.653 | `fixed` 3.228 → column 3.653 / 3.17 |
| Tailgate | the roof's end x 700 (s 3.48, 1.354) with a small spoiler; the glass down to (785, 157) | knee s 3.96, 1.02 | `rearKnee` |
| Tail lamps | x 755–790, y 177–208 | s 3.80–4.00, 0.72–0.90 | `cornerLamps` rear |
| Rear bumper | top y 223, foot y 285, face x 800 | 0.63 / 0.27, s 4.06 | moulded 0.28–0.60 (§3) |
| Front bumper | y 247–297 | 0.49 / 0.19 | moulded 0.19–0.535 (§3) |
| Head lamps | x 108–152, y 211–245 | s 0.03–0.285, 0.50–0.70 | §3 |
| Front arch | liner top y 218, front x 178 at y 290 | 0.371 over the hub, ±0.34 | `arch` 1.25 |
| Rear arch | top y 227, x 610–733 | 0.318 over the hub, ±0.34 | `rearArch` 1.2, `rearArchRise` 1.1 |
| Sill, door bottoms | y 293–298, y 287 | 0.19–0.22, 0.253 | `sill` 0.22, `doorBottom` 0.255 |
| Rubbing strip | y 232–237, from x 290 | 0.55–0.58, from s 1.09 | `waist` y 0.565, `span` [1.25, 3.2] |
| Lower feature line | y 220 | 0.648 | `featureLine` |

Front view (right side, the left under the watermark): the rail ±0.567 at 1.354; ±0.657 at
1.21; ±0.722 at 1.07; the glass's foot ±0.794 at 0.93; ±0.842 at 0.79; ±0.85–0.86 from
0.72 down to 0.61. Head lamps ±0.358–0.61, 0.56–0.665. The 1991 face has a slim slot ±0.33,
0.53–0.64. Bonnet lip 0.69. Bumper top 0.51, its lower intake ±0.585, 0.28–0.38.

Rear view: tail lamps ±0.555–0.794, 0.73–0.927. Tailgate glass from ±0.507 at 1.38 to its
foot ±0.64 at 1.044. Body ±0.81–0.82 at 0.68–0.88 and ±0.855 at 0.50–0.64. Bumper 0.30–0.657.

Plan (one side): ±0.31 at s 0.006, ±0.44 at 0.05, ±0.59 at 0.10, ±0.68 at 0.15, ±0.744 at
0.22, ±0.78 at 0.31, ±0.82 at 0.45, ±0.846 from 0.6. This is the bumper's outline: the
wings above it are drawn rounder at the corners and straighter behind (`wCrease` 0.62 /
0.69 / 0.755 / 0.795), so the rubbing strip's straight 0.3 m runs stay outside them. The tail
rounds from ±0.83 at 3.85 to ±0.74 at 3.97. The flank came out 1.3 % over 1688 at the
drawn ±0.848, so it is set at ±0.836.

## 3. Photos (Wikimedia Commons)

| Photo | Seen |
|---|---|
| 1996 Opel Astra 1.6i (53295982115) | Facelift face, near straight: rectangular head lamps with the clear indicator at the outer end; a black slatted grille with the badge in a light surround between them; a dark grey bumper with the plate, a black lower intake and two small fog lamps |
| 1998 Opel Astra 1.6 (53484789145) | The same, front 3/4: the lamps under the bonnet's lip and on the bumper's top; an amber repeater on the wing behind the arch; the rubbing strip on the doors only |
| Opel Astra F 20090424 rear | Facelift five-door, rear 3/4: corner lamps (a grey reversing cell inside and the amber indicator over the red); a black panel across the tailgate between them, the lamps' height, with the plate; body colour under it with the "ASTRA 16" badge; the filler flap on the right rear wing |
| Opel Astra F Hatch HL, Opel Astra (F) GL 5-door rear right | Five-door rear 3/4 and side: the black B pillar, door frames and post before the quarter glass; dark grey bumpers |
| 1996 Opel Astra 1.6i Automatic (52947796946), 1994 Opel Astra (1) / (2) | Side views: the belt rising to the tail, the quarter glass, the D pillar |
| Opel Astra F cockpit | The dash (§5) |
| Opel Astra F innenraum | Dark grey cloth with coloured flecks (`upholstery`) |

Lamp shapes, checked against "1996 Opel Astra 1.6i" (front), "1998 Opel Astra 1.6" (front
3/4), "Opel Astra F 20090424 rear" (rear 3/4) and "Opel Astra F Hatch HL" (the other rear
3/4):

| Lamp | Photo | Spec |
|---|---|---|
| Head | The unit runs from the grille's surround (±0.365) to the corner. Its foot sits on the bumper's top; its top runs up to the bonnet's lip | 0.55–0.668 / 0.672 (the face's belt 0.675) |
| Indicator | A small clear cell at the outer end, about a sixth of the unit across, rounding the corner a little | from ±0.60, round to s 0.17. The generator draws it amber |
| Tail | The upper ~40 %: a grey reversing cell inside (±0.565–0.63) and the indicator outside. The lower part is red. Wraps a little onto the wing | 0.838–0.905 over 0.73–0.832; wrap to s 3.83 / 3.80. 6 mm of body between the bands (as the Oka's: seen from the load space, their rims fight where two bands share an edge) |
| Tailgate panel | Black, across between the lamps, their height, the plate in it | `lid` panel ±0.54, 0.73–0.902 |
| Rear bumper | Its top about 0.1 under the lamps' foot, body colour between | 0.28–0.60 |

## 4. Running gear (`GEAR_OPEL_ASTRA_F`)

| Field | Value | Source |
|---|---|---|
| `mass` | 1010 | §1 |
| `engineId` | `engine_opel_c16nz` (new): 55 kW at 5200, 125 Nm at 2800, red line 5800 [E: the Nexia's rule], 120 kg [E] | parts/registry.ts `FOREIGN_ENGINE_VARIANTS` |
| `gearboxId` | `gearbox_opel_f13_wr` (new): 3.55 / 1.96 / 1.30 / 0.89 / 0.71, R 3.31, 3.94, efficiency 0.92, 45 kg [E] | `FOREIGN_GEARBOX_VARIANTS` |
| `tyre`, `wheelGrip` | `KAMA_217`, 0.53 (every road car's) | |
| `tankLitres` | 52 [E] | |
| `brakeDecelG` | servo | front discs, rear drums |
| `suspension` | `SUSP_SAMARA` | struts and a twist beam |
| `steerLock` | 0.60: 3.91 m on the bench against the 3.89 the 5.25 m radius gives | reality.ts |
| `frontWeightShare` | 0.62 [E] | |
| `dragArea` | 0.65 (170 km/h on the bench; Cd 0.32 × 1.98 m² = 0.63) | reality.ts |
| `aero` | `AERO_OPEL_ASTRA_F`: frontal area 1.98, the Samara hatches' lift and crosswind figures | |

Bench (`tools/reality.ts kit_astraf`): top 170 against 170. 0–100 is 15.5 s against 14.0
(+10.5 %), accepted as `CATALOGUE_OPTIMISTIC` (the Nexia +22 % and Espero +18 % on the same
GM driveline family). The turn is 3.91 against 3.89 (+0.5 %); geometry 0.0 %.

## 5. Dash (`CABIN_ASTRA_F`, interior.ts)

Read from Commons "Opel Astra F cockpit.jpg", a panorama from between the rear seats
(1920 × 599). Scale [E]: the wheel's hub (x 567) to the stack's centre line (x 1007) is the
Samara's 0.36 seat line, 0.82 mm/px; the panorama bends the dash's ends.

| Feature | Photo | Spec |
|---|---|---|
| Hood and dials | A rounded hood: the tachometer, then a big speedometer, then the temperature and fuel dials stacked on the right | tachometer −0.095 (r 0.034, to 7000), speedometer 0 (r 0.045, to 220), temperature / fuel +0.095 (r 0.016) |
| Vents | Slatted vents at the dash's ends; a pair side by side at the stack's top, the hazard switch between them | ±0.6 at −0.06; ±0.06 at −0.085; hazard [0, −0.085] |
| Stack | A storage slot, the radio, three heater knobs 78 px (0.064) apart at the foot | radio −0.2, heater −0.27, ashtray −0.33, `stack` half 0.11 |
| Light switch | A rotary switch on the fascia left of the column | knob, right −0.21, dy −0.11 |
| Glovebox | A wide lid before the passenger, level with the radio | x −0.39, dy −0.15, half 0.16 × 0.05 |
| Wheel | Four spokes round a wide pad (the airbag's) | spokes 20 / 160 / −60 / 240° |

## Gaps

- The face and tail are the facelift's from photos over a 1991 drawing. The grille's
  surround is painted (light grey or silver on some cars). The head lamps' inner and outer
  ends are square (rounded on the car).
- The roof spoiler (on some cars) is not modelled, nor are plates and badges.
- The fog lamps are unlit grey panels.
- The dash's heights are hung from the Samara's cluster [E]; its places come from a
  panorama.
- Overhangs, mass split, tank, red line, engine and gearbox masses are estimates.
- Triangles: 13 578.
