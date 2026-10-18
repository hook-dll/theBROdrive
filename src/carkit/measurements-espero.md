# Daewoo Espero: measurements

The Espero shares no stampings with another kit car, so it gets its own spec: `BODY_ESPERO` /
`LOOK_ESPERO` in `daewoo.ts`, `platform: 'samara'` (transverse engine in front, front drive,
struts and a twist beam), and dash `CABIN_ESPERO` in interior.ts, its own since review 1 (§5).
The car built is the **2.0 CD (KLEJ, 09.1995–12.1999)**. drom.ru catalogues this version for
Russia (C20LE, five-speed manual), and it is the Espero most often seen in the CIS: drom.ru
sells far more 2.0 cars than 1.5 or 1.8 ones, and the owners' threads on drive2.ru are
mostly about the 2.0. The 1.5 16V (90 hp) and the 1.8 (95 hp) are not modelled.

Its running gear is its own (`GEAR_DAEWOO_ESPERO: KitOwnGear` in vehicle/carmodels.ts, §4),
like the Nexia's.

Tags: **[D]** drawing, **[P]** photo, **[F]** factory/catalogue, **[E]** estimate.

## 1. Factory figures

| Figure | Value | Source |
|---|---|---|
| L × W × H | **4615 × 1718 × 1388** | drom.ru catalog/daewoo/espero/70454 (2.0 MT CD); carfolio and carsguide give the same length; the drawing's dimension lines are 4615 / 1718 / 1388 |
| Wheelbase | **2620** | drom.ru; drawing |
| Tracks | **1426 / 1406** | drom.ru and carfolio. Other sources print 1426/1423 (auto-data), 1427/1410 (avto-russia) and 1420/1405 (carexpert) |
| Clearance | **150** | drom.ru |
| Tyres | **185/65 R14** (0.298 m free radius) | drom.ru |
| Overhangs | not found | the drawn hubs centred on the factory wheelbase give **935 / 1060** [E] |
| Kerb / gross mass | **1128 / 1630 kg** | drom.ru and carfolio (1128). auto-data and avto-russia print 1130, ru.wikipedia 1108, carexpert 1195 |
| Top speed, 0–100 | **185 km/h, 10.8 s** | drom.ru and carfolio. A drive2 review prints 10.0 s; auto-data gives 12.8 s for the automatic |
| Turning radius | **5.2 m** | drom.ru |
| Tank | **50 l** | drom.ru |
| Engine | **C20LE**, 1998 cm³, 86 × 86, SOHC 8v, MPI: **77 kW (105 hp) at 5000, 169 Nm at 2800** | drom.ru. Another catalogue text prints 164 Nm at 3000 |
| Gearbox | five-speed F16, the Nexia's ratios on the **3.944** axle | drive2.ru/l/5036075, an owners' thread: "on the 2.0 Espero as on the 8-valve Nexia, 3.941; every other Espero and the 16-valve Nexia 4.188"; a box marked "W 3.94" is "identical to the Espero's". vnx.su's Espero manual names the F-16 five-speed. No ratio table was found in a manual, and automobile-catalog is behind 403 |
| Steering, brakes | power steering; ventilated front discs, rear drums; vacuum servo | drom.ru |
| Cd | not found | Cd·A was set on the bench to the 185 km/h (§4) |

`FACTORY_GEOMETRY.kit_espero` = 4.615 × 1.718 × 1.388, clearance 0.150, wheelbase 2.620,
tracks 1.426 / 1.406, wheel radius 0.298, tyre 0.185.

## 2. Drawing

the-blueprints.com, vector drawing 5466, "Daewoo Espero": the watermarked preview
`https://www.the-blueprints.com/modules/vectordrawings/preview-wm/daewoo_espero_1995.jpg`
(1280 × 905). The side view faces left (it shows the car's left side), with the front view
top right, the plan bottom left and the rear view bottom right. Its dimension lines are
4615, 2620, 1718 and 1388. The raster blueprints 212 and 26741 on the same site
(`daewoo-espero.gif`, 1000 × 528, undimensioned line art) were used only to cross-check.
The working crops are in `/tmp/espero/` and are not kept.

Scales (pixel columns and rows read by script, dark/grey threshold < 170):

| View | Basis | Scale |
|---|---|---|
| Side, along | the drawn tips x 28 / 822 = 4615 | **5.812 mm/px**, `s = (x − 28) × 0.005812` |
| Side, up | the tyres' foot y 332 to the roof y 79 = 1388 | **5.486 mm/px**, `y = (332 − py) × 0.005486` |
| Front / rear, across | the body's drawn width 902–1205 = 1718 (the drawn 1718 arrows span only 924–1183) | 5.67 mm/px, centre x 1053.5 |
| Plan | tips x 42 / 817, width 474–780 | 5.955 along, 5.614 across |

The drawing is not orthographically exact. Its hubs (the tyre chords' centres x 186.5 /
643.25) stand 2655 apart at the length scale, against the factory 2620, and at the hub
scale (5.736) the roof would be 1451 high. Lengths and heights are therefore scaled
separately to the factory figures, and the wheels sit on the factory wheelbase, centred on
the drawn pair (**front 0.935, rear 3.555**) [E].

Readings (side view; `s` from the front tip, heights over the ground):

| Feature | Drawn | Value | Spec |
|---|---|---|---|
| Bonnet centre line | y 197 / 190 / 184 / 179 / 175 / 172 / 169 / 166 at x 50 … 200 | 0.741 at s 0.13, 0.779 at 0.24, 0.812 at 0.36, 0.839 at 0.48, 0.861 at 0.59, 0.878 at 0.71, 0.894 at 0.83, 0.911 at 1.0 | stations' `deck` |
| Cowl | (246, 167) | s 1.267, 0.905–0.914 | station 1.267 |
| A pillar to the rail | (377, 91) | s 2.03, 1.322 | first column `top` 2.03 |
| Roof | y 79 at x 490 | 1.388 at s 2.69 [F] | `rail` 1.306 + `railRise` 0.02 + `crown` 0.062 |
| Back light | (603, 91) → (723, 149) | top s 3.342 at the rail; foot s 4.04, 1.004 | rearBase station 4.04, last column `top` 3.342 |
| Boot | y 151 / 155 / 160 at x 750 / 780 / 800 | 0.993 at 4.20, 0.971 at 4.37, 0.944 at 4.49 | stations 4.3, 4.5 |
| Head lamps | y 204–220 at the face | 0.614–0.702 | `cornerLamps` |
| Front bumper | y 227–290 | 0.23–0.576 | moulded, `drop` 0.105, `height` 0.346 |
| Rear bumper | y 222–275 | 0.313–0.603 | moulded, `drop` 0.052, `height` 0.29 |
| Tail lamps | x 773–805, y 159–217 | s 4.33–4.52, 0.63–0.95 (the wrap onto the wing) | `cornerLamps` rear |
| Sill | y 288 | 0.24 | `sill` 0.24 |
| Door bottoms | y 280 | 0.285 | `doorBottom` |
| Front door | shut line x 277 | s 1.447 | column 1.447 |
| B pillar | x 466–482 at belt and rail; shut line x 458 | s 2.50–2.64 | columns 2.51–2.635 |
| Rear door glass, rear edge | belt x 605, rail x 595 | 3.354 / 3.295 | columns 3.33 / 3.36 |
| Belt (glass foot) | (335, 167) → (603, 154) | 0.905 at s 1.78 → 0.977 at 3.34 | lowered 0.04 on the photos (§3) |
| Front arch | x 122–254, top y 220 | ±0.384 at the hub's height, 0.316 over it | `arch` 1.24 |
| Rear arch | x 584–713, top y 217 | ±0.375, 0.333 over the hub | `rearArch` 1.26, `rearArchRise` 1.12 |
| Feature line | y 212 | 0.658 | `featureLine` |
| Rubbing strip | y 243 | 0.488 | `waist` 0.49 |

Front view half widths: ±0.544 at y 94 (the rail, `railHalf` 0.55), ±0.672 at 1.14, ±0.791
at 0.905 (the shoulder at the belt, `wBelt` 0.80), ±0.836 at 0.81, and ±0.859 from 0.71 down
(`wCrease`). Rear view: ±0.547 at 1.35, ±0.697 at 1.09, ±0.811 at 0.92, ±0.859 from 0.82 down.
Plan: ±0.371 at s 0.018, ±0.47 at 0.036, ±0.545 at 0.054, ±0.615 at 0.089, ±0.705 at 0.167,
±0.775 at 0.286, ±0.808 at 0.464, ±0.834 at 0.643, ±0.859 from 1.2; at the tail ±0.839 at
3.80, ±0.814 at 4.04, ±0.792 at 4.18, ±0.769 at 4.32, ±0.705 at 4.47, ±0.648 at 4.51, ±0.528
at 4.56.

## 3. Photos (Wikimedia Commons)

- "Daewoo Espero beige front": a flush head lamp with the amber third at its outer end. A
  plain body-colour panel with the badge between the lamps (no grille). A body-colour
  bumper with a broad black band over its upper part, which holds the plate, and a black
  slot and two clear fog lamps low down.
- "1999 Daewoo Espero dark green front": the head lamps are slanted. The top falls towards
  the badge, so each unit narrows to a short inner end (`cornerLamps`: 0.033 tall inside
  against 0.085 at the corner, the foot level). The mirror sits on a black sail at the
  front glass's foot, and an amber repeater stands on the wing behind the front arch.
- "1996 Daewoo Espero orange red rear", "Daewoo Espero h": corner tail lamps, red over a
  lower band that is amber at the outer end. A red reflector band runs across the lid
  between them. Body-colour rear bumper with a black band along its top. Small lamps sit
  in the bumper's lower corners. A **fixed quarter glass** sits behind the rear door,
  which the drawing's preview greys over. The side glass is deeper against the doors than
  the preview draws it (the belt lowered 0.04).

## 4. Running gear (`GEAR_DAEWOO_ESPERO`)

| Field | Value | Source |
|---|---|---|
| `mass` | 1128 | drom.ru, carfolio |
| `engineId` | `engine_daewoo_c20le` (new): 77 kW at 5000, 169 Nm at 2800, red line 5800 [E: the Nexia's rule], 135 kg [E] | parts/registry.ts `FOREIGN_ENGINE_VARIANTS`. partmesh `buildInline` 1.05. reality.ts `FACTORY_ENGINES` |
| `gearboxId` | `gearbox_opel_f16_nexia` (reused): 3.545 / 1.952 / 1.276 / 0.892 / 0.707, 3.944 | §1 gearbox |
| `tyre`, `wheelGrip` | `KAMA_217`, 0.53 (every road car's) | |
| `tankLitres` | 50 | drom.ru |
| `brakeDecelG` | servo | drom.ru |
| `suspension` | `SUSP_SAMARA` | struts and twist beam (drom.ru) |
| `steerLock` | 0.634: 3.83 m on the bench against the 3.78 the 5.2 m radius gives | reality.ts |
| `frontWeightShare` | 0.62 [E, as the Nexia] | |
| `dragArea` | 0.72: 185 km/h on the bench (Cd ≈ 0.37 on 1.96 m², estimate) | reality.ts |
| `aero` | `AERO_DAEWOO_ESPERO`, frontal area 1.96: 1.718 × (1.388 − 0.15) × 0.92; lift and crosswind as the Nexia | |

Bench (`tools/reality.ts kit_espero`): top 185 against 185, 0–100 12.8 s against the
catalogue's 10.8 (+18%, accepted as `CATALOGUE_OPTIMISTIC`, as the Nexia's +22% on the same
box and axle), turn 3.83 against 3.78 (+1.4%), geometry 0.0%.

## 5. Review 1 (owner, 2026-10-18): own dash, black frames, lamp shapes

### Dash (`CABIN_ESPERO`, interior.ts)

No Espero interior is on Commons. Sources:

- SelfBase.de interior database, Espero 1995–1997
  (`en.selfbase.de/automobile_interior_database/daewoo_espero_sid1800501101`): "instrument
  panel front" (500 × 332, taken from the car's centre line), "instrument panel side"
  (500 × 380, from the passenger's door) and "door panel front".
- drive2.ru/l/506952651926143865, an Espero 2.0 owner's post with the cluster's glass off:
  the tachometer (numbered 0–7, red from 6000) sits left of the speedometer (numbered to
  220, the scale running on), both the same size. To their right is a round dial with the
  fuel scale over its top and a second needle under it (the temperature).

Scale on the front photo [E]: the wheel's hub (x 146) to the stack's centre line (x 260) is
114 px for the Samara's 0.36 seat line, so 3.2 mm/px, used across and up with perspective
ignored. Heights hang from the cluster's centre (y 62), 0.012 over the belt as on the Nexia.

| Feature | Photo | Spec |
|---|---|---|
| Dials | three of one size about 25 px (0.08) apart, the speedometer on the column | tachometer −0.088, speedometer 0 (full 240), fuel +0.088 with the temperature scale `bare` on its face; radius 0.04 |
| Hood | long, low, angular, a pod either side with switches (three stacked on the right pod) | `binnacle` flat-topped, half 0.215, its face in the cluster's plane (0.472); the lights rocker and one more on the right pod (+0.18), two on the left |
| Centre stack | black, 76 px wide; two slatted vents side by side (each 26 × 12 px at y 103), three heater knobs (y 127), the radio (y 150), the ashtray (y 172) | `stack` half 0.122; vents ±0.048 at −0.11, half 0.04 × 0.02; heater −0.19; radio −0.255; ashtray −0.315 |
| Glovebox | big, high before the passenger, x 318–430, y 103–133 | x −0.37, dy −0.135, half 0.17 × 0.06 |
| Wheel | four spokes round a wide pad | spokes 20 / 160 / −60 / 240°, radius 0.19 |
| End vents | in the doors' tops, not the dash | not modelled |
| Hazard switch | not legible | on the fascia between the column and the stack [E] |
| Colours | mid-grey dash, grey cloth (`#77787a` in the photo's bright light) | `dash` 0x6e7175, `upholstery` 0x6a6c70 |

### Black frames and the mirror sail

On the photos ("beige front", "dark green front", "h") the door frames, the B pillar, the
post between the rear door's glass and the quarter glass, the quarter glass's frame and
the mirror's sail are black. The A pillar and the wide C pillar are body colour. The new
`CabinColumn.finish: 'black'` (body.ts: the strip's faces above the belt in the dark trim
colour, the rail's chamfer still painted) is set on the columns 1.30–3.375. No other car
sets it, so their strips are unchanged; all 24 kit bodies pass `kit-proportions`.

### Lamp shapes (lamp review, shapes only; materials and colours unchanged)

Photos compared: front "Daewoo Espero front 20071227", "Maroon Daewoo Espero-002-front",
"1994-1995 Daewoo Espero 2000i Sedan (12-08-2017) 04", beige front, dark green front; rear
"Maroon Daewoo Espero-003-rear" (near square), "Daewoo Espero rear 20071227", "Daewoo
Espero h", "1996 Daewoo Espero orange red rear". The drawing's lamps are coarse (its front
has a grille and its lid a plate recess, another market's car) and are used for the plan
wrap only.

| Lamp | Before | Photos | After |
|---|---|---|---|
| Head, inner end | upright edge at ±0.22–0.235, 0.033 tall | a pointed tip low on the bumper's top; the inner edge slants up and out to the top's inner corner | edge from (±0.215, 0.626) to (±0.27, 0.69) |
| Head, top | falling 0.05 from the corner (0.705) to the inner end (0.655): a wedge | nearly level, 7 of 90 px (8 %) lower inside | 0.708 at the corner → 0.69 at the inner corner |
| Head, foot | level 0.617–0.622 | rising 9 px (≈0.008) inwards | 0.617 → 0.626 |
| Head / indicator split | upright at ±0.53 | at 70 % of the unit's projected length, leaning out to the top (17 px) | ±0.545 at the foot, ±0.56 at the top |
| Tail band height | corner units 0.785–0.925; lid band 0.845–0.919 | one band 0.15 tall with 0.10 of painted face over it (the badges' strip); maroon rear: 110 px at 1.38 mm/px; ratios from three photos | 0.67–0.82 |
| Corner unit split | 0.845 (upper 0.08 / lower 0.06) | red over amber, 64 / 36 % | 0.725 |
| Lid band shape | one 0.074 strip at the top | full height at its ends from the lid's cut to about ±0.27, only the red top (to the corner units' split) between, the lid's dark strip under it | top lens ±0.475 × 0.725–0.82; under each end a lens 0.67–0.73 from ±0.27, 4 mm further back, running behind the top one |
| Lid cut | ±0.52 | corner unit 200 px against the lid band's 755 (0.265); ±0.52 gave 0.18 | `notch` ±0.49, corner units from ±0.50 |
| Wrap onto the wing | top to s 4.36, foot to 4.38 (the top further forward) | the foot reaches further forward than the top; plan red to s 4.39 at the top | top to 4.42, foot to 4.37 |

Review 2 (the captain on the maroon photos, 2026-10-18), shapes only:

| Lamp | Review 1 | Photo | Now |
|---|---|---|---|
| Head, height | 0.617–0.708, about 60 % of the band between the bumper's black top and the bonnet's edge | the lens fills that band: its foot on the bumper's top line, its top along the bonnet's shut line | 0.582 (6 mm over the bumper's 0.576) to 0.695–0.703 under the face's belt (0.705) |
| Head, foot | rising 0.009 inwards | one straight line | level 0.582 |
| Head, inner end | (±0.215, 0.626) → (±0.27, 0.69) | slanted along the badge panel's side, nearly touching it | (±0.20, 0.582) → (±0.27, 0.695) |
| Indicator | from ±0.545 / 0.56, wrapping to s 0.17 | outer ~22 % of the same unit, same height, end square at the corner | from ±0.56 at the unit's height, a short return to s 0.10 |
| Lid band's ends | upright inner end at ±0.27 (a "staple" with tabs) | inner lower edge a slant running down and out | slant ±0.27 at the split to ±0.33 at the foot; band out to ±0.483 |
| Corner units' amber | outer part only (inner cell red) | the whole unit's width under the red | full width |
| Wrap onto the wing | to s 4.42 / 4.37 | a little | to s 4.47 at the top, 4.44 at the foot |

Shape differences that remain:

- The lid band's ends are amber below on the car; here they are the band's red `inert` lens
  (no colour change was wanted). The lid's cut shows as a 7 mm gap between band and corner
  unit (a shut line on the car).
- The dark strip under the band's middle is painted.
- The head lamp's outline is a polyline, and the inner tip is a corner, not a curve.

## 6. Review 2 (owner, 2026-10-18): mouldings, A pillar, mirrors

Re-read on the same drawing (the-blueprints.com vector 5466 preview, pixel rows by script,
the scales of §2) and the Commons photos of §3/§5. No other dimensioned Espero drawing is
free: the-blueprints raster 212 (undimensioned) and the paid Outlines sheet are all there is,
and wikipedia, auto-data, cararac and carsguide confirm 4615 / 2620 / 1718 / 1388 only.

| Feature | Drawing | Model before | Model now |
|---|---|---|---|
| A pillar, at the belt → rail | s 1.267 (cowl) → 2.03, about 70 mm across in side view (x 300–312 at y 150) | 1.267 → 2.03, pillar 0.07 | unchanged |
| Front door shut line | x 277: s 1.447 | 1.447 | unchanged |
| Front glass front edge | kinked: up the sail to (1.84, 1.11), the sail's foot along the belt to 1.79 | 1.55 at the belt | 1.62 at the belt, one straight edge (1.74 at 1.0, 1.85 at 1.11) |
| Mirror head | s 1.78–1.90 on the sail | 1.38 (8 cm behind the A-pillar column): **hidden from the driver behind the sail** | `mirrorS` 1.74, both seen through the side glass from the in-game cabin camera |
| B pillar | 2.50–2.64, the shut line x 458 (2.50) | 2.51–2.635, shut line 2.545 / 2.56 | unchanged |
| Rear glass rear edge | 3.354 belt / 3.295 rail | 3.33 / 3.27 | unchanged |
| Rear door shut line | upright to about 0.72, then forward round the arch to the sill | `foot` y 0.72 → 3.15 | unchanged |
| Door lengths at the belt | front 1.447–2.50 (1.05), rear 2.50–3.36 (0.86) | 1.10 / 0.80 | unchanged |
| Rubbing strip | y 243: 0.488, door to door, a piece on each panel | 0.49; pieces cut at the doors' bounding boxes | 0.49; cut at every shut line, owned by the panel under it |
| Plan/front: rail, belt, flank half widths | ±0.544 / ±0.791 / ±0.859 | 0.55 / 0.80 / 0.859 | unchanged |

The moulding fault: `buildFlankStrip` split the strip at each door node's bounding box, and
the front door's box reaches forward to the A pillar's foot over the wing, the rear door's
back to its frame's top (3.33) above the raked shut line (3.2 at the strip's height). So
the front door took a length of the wing's strip and the rear door a length of the C
pillar's. Each piece now takes the owner of the skin it lies on (`BodyFrame.flankOwner`,
the owners `buildShell` gives the side faces) and ends 5 mm short of the panel's seam,
following a raked line at its slant. Tumblehome and glasshouse narrowing match the front
and rear views and are unchanged. The A pillar matches the drawing; it hid the mirrors
only because the mirrors stood 35 cm too far forward.

## Gaps

- The dash's heights come from one photo scale with perspective ignored [E]. The door-top
  face vents and the stack's wood trim are not modelled.
- Plates and badges are not modelled (the owner: not needed).
- The fog lamps are grey panels with no light (no fog-lamp channel). There is one
  reversing lamp at each bumper corner (on the car one is a rear fog lamp).
- Overhangs, the axle split and the Cd are estimates. The flap is on the right [E: not seen
  on the left-side views].
- The roof's front: the drawn centre line falls 0.06 to the screen's top. `roofDrop` takes
  0.025 of it and the crown the rest, as on the Nexia.
- Triangles 14 389, over the ≈ 13k budget, like the tens and the Nexia (accepted by the
  owner).
