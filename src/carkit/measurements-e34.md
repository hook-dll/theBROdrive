# BMW 5 Series E34 saloon: sources, figures, feature inventory

Status: **first draft 2026-10-27, reworked after the owner's first review (§8), awaiting his
next look** (README "Workflow" step 2). The draft is `bmw.ts`, `CABIN_E34`. Review sheet
`build/kitcheck/e34/review.png`, the side against the photo `build/kitcheck/e34/side-compare.png`,
overlays `build/kitcheck/e34/drawing-side.png`, `drawing-front.png`; the inventory sheet
`build/kitcheck/e34/inventory.png`.

Tags: **[D]** drawing, **[P]** photo, **[F]** factory/catalogue, **[E]** estimate.

## 1. The version built

**520i 24V saloon (E34, 1990–1995)**, M50B20 straight six, five-speed manual. Why:

- The 520i is the E34 the Russian roads of around 2000 saw most: the cheapest six, imported
  used at 8–12 years old [E: no registration statistics found; reasoning from build years,
  import age and the 520i being the entry six].
- The M50 24-valve replaced the M20 in the 520i in 1990 (en.wikipedia "BMW M50"). The body
  is the same 1988–96 stamping; the 1994 change of the wide kidneys was for the V8 cars
  only [P: the 1990–95 six-cylinder photos all have the narrow kidneys].
- Photos: the Commons set of a 1988–89 520i (CC0, near-straight front, rear and side) for
  the shapes; the 520i in Poland (`front34`, `rear34`, CC BY-SA 4.0) for the trim of a
  plain European car. Neither differs from the 1990–95 car outside the engine bay.

## 2. Factory figures

| Figure | Value | Source |
|---|---|---|
| L × W × H | **4720 × 1751 × 1412** (the drawing: 4720 / 1750 / 1420) | the drawing's dimension lines; carfolio 1988 520i prints 4719. Height and width to be confirmed against a second catalogue at the measuring step |
| Wheelbase | **2761** (drawing 2760) | the drawing |
| Tracks | **1470 / 1495** | auto-data.net "5 Series (E34) 520i 24V (150 Hp)"; encycarpedia 1990 520i |
| Kerb mass | **1425–1445 kg** | ultimatespecs / encycarpedia 1425; auto-data 1445. FastestLaps 1533–1538 (another trim) |
| Engine | **M50B20**, 1991 cm³, DOHC 24v: **110 kW (150 PS) at 5900–6000, 190 Nm at 4200–4700** | en.wikipedia "BMW M50"; auto-data |
| Top speed, 0–100 | **211 km/h, 10.6 s** | auto-data; ultimatespecs |
| Final drive | **3.46** | carfolio "1990 BMW 520i 24v" (https://www.carfolio.com/bmw-520i-24v-55913); forum.bmw5.co.uk/topic/11395 (4.23 / 2.52 / 1.67 / 1.22 / 1.00 on 3.46). Carfolio's other page (…/bmw-520i-24v-31141) prints 0.81 top on 4.27: the same overall 3.46 |
| Gearbox | **ZF S5D 310Z five-speed: 4.21 / 2.49 / 1.67 / 1.24 / 1.00, R 3.85; 39 kg** | en.wikipedia "BMW 5 Series (E34)" (S5D 310 for European M50 cars, realoem cited); en.wikipedia "ZF S5-31 transmission" (ratios, mass). s14.de/en/models/e34 notes the parts catalogue's Getrag 260/5/50 against it |
| Tyre | **195/65 R15 91V on 6J × 15** (free radius 317 mm) | ultimatespecs https://www.ultimatespecs.com/car-specs/BMW/1657/BMW-E34-5-Series-520i.html; auto-data https://www.auto-data.net/en/bmw-5-series-e34-520i-24v-150hp-9669; carfolio 55913 |
| Tank | **80 l** | ultimatespecs; auto-data |
| Gross mass | **1955 kg** | auto-data |
| Turning circle | **11.0 m** | ultimatespecs |
| Clearance | **140 mm** (1987–90 saloon; 120 for the 1992–94 on 205/65) | https://www.drom.ru/catalog/bmw/5-series/192870/, …/193025/ |
| Cd | **0.31** (520i); 0.30 the basic saloon | ultimatespecs; en.wikipedia "BMW 5 Series (E34)", s14.de |
| Red line, idle, engine mass | **[E] 6500, 750, 175 kg** | no factory figure found: rated 5900 + 10 % for a short-stroke 24v six; mass against the M30B30's 186 |
| Axle split | **[E] 0.53 front** | none printed: the W124's 0.52 with an iron six ahead |

## 3. Sources

### Drawings (build/carshape/_refs/bp/img/)

| File | Source | Use |
|---|---|---|
| `e34_tbp_620.jpg` [D] | the-blueprints.com vector drawing 620 "BMW 5-series sedan E34 (1993)", watermarked preview `https://www.the-blueprints.com/modules/vectordrawings/preview-wm/1990_bmw_5-series_e34.jpg` (1280 × 906) | **Main drawing.** Side (facing left), front, rear and plan. Dimension lines 2760, 4720, 1750, 1420; scale 1:25 bar |
| `e34_tbp_76.gif` [D2] | the-blueprints.com raster blueprint 76 "BMW 5-Series Sedan (E34)" (`.../blueprints-depot/cars/bmwcars/bmw-5-sedan-e34.gif`, 1012 × 555, credited "Gert") | Cross-check of the main drawing |

Licence: the-blueprints.com previews, reference use only (as the W124's and the Vectra's).

### Photos (build/carshape/_refs/photos/e34/, Wikimedia Commons; also in `SOURCES.txt` there)

| Tag | File | Commons title | Licence, author | What it shows |
|---|---|---|---|---|
| **F34** | `front34.jpg` | Bmw-e34-520i-20141208-bb-ur-mk-a-crop.jpg | CC BY-SA 4.0, Abrim | white 520i, front right 3/4: kidneys, quad lamps, grille slats, indicators, two-tone bumper, fog lamp, mirror, handles, rubbing strip |
| **R34** | `rear34.jpg` | Bmw-e34-520i-20141208-da-ur-mk-a-crop.jpg | CC BY-SA 4.0, Abrim | the same car, rear left 3/4: tail lamps on wing and lid, bumper, B pillar, the rear door's quarter bar, the Hofmeister kink |
| **F** | `front.jpg` | 1988-1989 BMW 520i (E34) Sedan (13-06-2018) 03.jpg | CC0, Jirapat Chroenkeskij | silver 520i, near-straight front |
| **R** | `rear.jpg` | … 04.jpg | CC0, the same | near-straight rear: lamps, lid cut, bumper, twin tail pipe (this car) |
| **S** | `side.jpg` | … 05.jpg | CC0, the same | near-orthographic right side: greenhouse, shut lines, rubbing strip, flap, repeater |
| **F34l / R34l** | `front34_l.jpg`, `rear34_l.jpg` | … 01.jpg, 02.jpg | CC0, the same | left 3/4s |
| **F34r** | `front34_red.jpg` | BMW E34 520i.jpg | CC BY-SA 3.0, Frank88881 | red 520i, front left 3/4 |
| **R34g** | `rear34_grey.jpg` | 1988-1995 BMW 5 Series E34 rear.jpg | CC0, Carluver23 | grey 520i, rear left 3/4 |
| **DASH** | `dash.jpg` | 5-er e34 BMW PL.JPG | CC BY 3.0, Beemwej | dashboard from the driver's door, manual box, blue trim |
| **INT** | `interior.jpg` | 5-er e34 Interior BMW PL.JPG | CC BY-SA 3.0, Beemwej | dash and console from the passenger side, light trim |

## 4. Feature inventory

"Field" is the spec.ts field that draws the feature today, or **NO FIELD** with the
simplest addition that would. Colour: body = paint.

### 4.1 Body shape and greenhouse

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 1 | Long bonnet falling gently to a **"shark nose"**: the face **leans forward** above the bumper, its top (the bonnet's lip) ahead of the lamps' foot | S, F34, D | body | `frontLean` with a negative lean [unverified: no car leans forward yet; if the generator refuses it, the same field allowed to lean out] |
| 2 | Rear-hinged bonnet: shut lines along the wings' tops and **round the nose above the lamps**, so the kidneys' and lamps' tops sit under the bonnet's lip | F34, F | body | `bonnet: { inset }`; the lip line from `bonnetFront` |
| 3 | Three-box saloon, boot deck level and fairly long, its tail cut square | S, R34, D | body | `stations` (`deck`) |
| 4 | Flank flat with one **crisp shoulder line** at the lamps' top running nose to tail, tumble-home above the belt | S, F, R | body | `stations` (`crease`, `wCrease`), `shoulder`; or `featureLine` |
| 5 | Arches round, the rear one a little flattened at its top | S, D | body | `wheels.arch`, `rearArch`, `rearArchRise` |
| 6 | Sill straight; a **black lower sill strip** under the doors from arch to arch | S, R34 | black | `cladding` (`finish: 'black'`, low `top`) |
| 7 | Windscreen raked; A pillars thin and body colour, the glass seal black | S, F34 | body, black seal | `columns[0]`, `screenFoot`, `pillar` |
| 8 | Roof flat and long, a rain channel along it | S | body | `rail`, `railHalf`, `crown` |
| 9 | Back light raked, its foot on the deck | S, R | black seal | last column, `rearBottom`, `rearHeader` |
| 10 | Four doors; front door glass right behind the A pillar (no quarter light), the mirror at its front foot on a black triangle | S, F34 | black frames | `columns` `glass: 'drop'`, `mirrorS` (no sail, working rules) |
| 11 | **Window frames, B pillar and C-pillar division black** (blacked-out door frames round all side glass) | S, R34, F34 | black | column `finish: 'black'` (the Espero's, Opels') |
| 12 | Rear door: **fixed quarter glass** behind a black division bar, door frame running round it | S, R34 | black bar | `columns`: `drop`, narrow black column, `fixed` (the W124's) |
| 13 | **Hofmeister kink**: the rear side glass's back edge runs up the C pillar and turns forward at the top in a sharp hook | S, R34 | black frame | The quarter's rear edge from column tops: probably `columns` with a short top column (s at rail ahead of the foot) [to prove at draft]; else NO FIELD: a column `kink: [s, y]` |
| 14 | C pillar body colour, wide | S, R34 | body | last columns, `upper: 'body'` |
| 15 | Rear door's shut line straight down behind the quarter, round the arch | S, D | body | `CabinColumn.foot` |
| 16 | **Boot lid cut above the tail lamps across the whole tail**: the lid carries the lamps' inner parts and the plate recess and comes down to the bumper's top between the wing lamps | R, R34 | body | `bootEnd`, `notch` (the lid between the corner lamps), lid items on `FaceLook.lid` |
| 17 | Fuel flap: rectangular, rounded corners, **right** rear wing behind the rear door at the shoulder | S | body | `flap` |
| 18 | Small dark **side marker / repeater** on the front wing ahead of the door, at the rubbing-strip line | S | amber/dark | `repeater` |

### 4.2 Front

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 19 | **Twin kidney grille**: two upright kidneys with rounded tops and chrome surrounds, a body-colour gap between them, vertical dark slats inside; standing slightly proud in the face | F34, F | chrome frames, black slats | `grille` (one, centred) with `frame: chrome`, `bars: vertical`, `standOut`; the **split into two kidneys: NO FIELD**. Simplest: a body-colour `panel` (`x: { centre: 0.02 }`) over the grille's middle, chrome-edged by a second `frame` per kidney (`frame` items, pair). Rounded tops not drawn [E: a square top reads at 10 m] |
| 20 | **Quad round head lamps**, two each side, the inner smaller-looking (same size on the 520i), set in a **black** horizontal band from the kidneys to the corners | F34, F | glass in black rings | `round` (role `head`) ×2 per side; the **black ring: NO FIELD** (`round` is always chrome-ringed). Simplest: `round` `ring?: Finish` |
| 21 | Between kidneys and lamps, and between the lamps' outer pair and the indicator: **black horizontal-slat grilles** filling the band | F34, F | black | a full-width black `panel` behind, or `grille` per side: `grille` is centred only → the band as one black `panel` with horizontal-bar look not needed [E: flat black reads] |
| 22 | **Amber indicators at the corners**, rectangular, wrapping a little onto the wing | F34, F34r | amber | `cornerLamps` (`blinker` from the band's end round to s ≈ 0.08) |
| 23 | Roundel on the bonnet's lip over the kidneys | F34 | blue/white | not needed (badges not modelled) |
| 24 | **Front bumper**: body colour with a **broad black rubbing band** at its middle running round to the arch, a black lower lip; plate on the band | F34, F, S | body, black band | `moulded` `finish: 'paint'`, `moulding: { finish: 'black' }`, `wrapTo` the front arch, `foot` |
| 25 | Fog lamps: rectangular, low in the bumper's lower part (optional; on the PL car one side) | F34 | glass | bumper `inlays` (the Astra's) or `lens` `inert`; proposed: leave out [E: optional equipment] |
| 26 | Wipers: a pair, parked at the screen's foot | F34 | black | default pair |

### 4.3 Side

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 27 | **Black rubbing strip** along both doors and wings at the bumpers' band height, in line with the bumpers' black band (one line nose to tail) | S, F34, R34 | black | `waist: { finish: 'black' }` nose to tail (broken at arches, shut lines) |
| 28 | Door handles: black pull handles under the shoulder line | S, R34 | black | `brightwork: 'black'`, `handles` |
| 29 | **Door mirrors body colour** (PL car; black on others) on a black base | F34, R34 | body head | `mirrorFinish: 'paint'` (the W124's) |
| 30 | Wheels: 15" steel with full plastic covers (PL car) or cross-spoke alloys (S) | F34, S | silver | wheel sets; proposed the plain cover [E] |
| 31 | No side cladding, no chrome on the flanks | S | – | – |

### 4.4 Rear

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 32 | **Tail lamps in two parts**: a wing part at each corner (amber indicator band on top, red tail/brake below, wrapping onto the flank) and a **lid part** inboard of it (red, the white reversing cell at its inner top), one horizontal band across the tail broken only by the plate | R, R34, R34g | amber, red, white | wing: `cornerLamps` (`end: 'rear'`, stacked `blinker` over `tail`); lid: `lens` items on `FaceLook.lid` (`tail` / `reverse`), riding on the lid |
| 33 | Horizontal **ribbing** lines across the red lenses (thin dark seams between cells) | R | – | `ribs` on the corner units (the W124's), a few lines |
| 34 | Plate recess in the lid between the lamp halves | R, R34 | body | not modelled (plates) |
| 35 | **Rear bumper** two-tone as the front: body colour, broad black band, wrapping forward to the rear arch | R, R34 | body, black | `moulded`, `moulding` black, `wrapTo` |
| 36 | Exhaust: single (520i) under the left end of the bumper | R34 | – | bay.ts exhaust |
| 37 | No spoiler, no high brake lamp | R34 | – | – |

### 4.5 Cabin and dash (DASH, INT)

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 38 | Dash: broad padded top; the **centre stack and its upper vents turned toward the driver** (the BMW driver-oriented cockpit) | DASH, INT | dash colour | `stack`; the **turn toward the driver: NO FIELD**. Simplest: `stack.yaw?` (radians about the vertical) [or skip: reads only from inside] |
| 39 | Cluster under a hood: **two big dials** (speedometer left, tachometer with the econometer right), a small fuel dial far left and temperature far right; a telltale row under them | DASH | black faces | `binnacle`, `gauges` (four round), `lamps` |
| 40 | A **wood strip** across the fascia under the cluster from the door to the stack, and on the passenger's side | DASH | wood | `wood` band |
| 41 | Light switch: a rotary knob left of the column, in a switch panel | DASH | black | `lights: { kind: 'knob' }` |
| 42 | Stack: two vents side by side at its top, the radio, the heater's rotary knobs | DASH | black | `vents`, `radio`, `heater: { knobs }` |
| 43 | Steering wheel: **four spokes** (airbag hub on later cars) | DASH | black | `wheel: { spokes, hub: 'pad' }` |
| 44 | Gear lever in a gaiter on the console, a **handbrake lever** behind it | DASH, INT | black, wood knob | `gear`, `handbrake` |
| 45 | Separate front seats with head restraints; bench with restraints | DASH, INT | cloth / leather | `headrests: true`, `upholstery` |

## 5. NO FIELD, ordered by how much they matter to reading the car as an E34

1. **Two kidneys instead of one grille** (#19). The car's face. Simplest: a body-colour
   centre `panel` splitting one framed grille, plus a chrome `frame` round each half (all
   existing items) [to prove at draft; if the frames fight the grille's own, a
   `grille.split?: number` gap].
2. **Black rings round the quad lamps** (#20). Chrome rings would read as a Lada. Simplest:
   `round` `ring?: Finish`; absent, chrome as now.
3. **The face leaning forward (shark nose)** (#1). The E34's profile. Simplest: `frontLean`
   with a negative lean, if the generator takes it; else let `lean` be negative.
4. **Hofmeister kink** (#13). Seen on every side and 3/4 view. Simplest first: columns as
   they are; else `CabinColumn` kink point.
5. **Driver-turned stack** (#38). Cabin only. Simplest: `stack.yaw`; or skip.
6. **Kidneys' rounded tops, the band's slats, badges, plates** (#19, #21, #23, #34): skip.

Everything else (lamp halves on the lid, two-tone bumpers, black rubbing strip, black
frames, the quarter bar, body-colour mirrors, ribs) is drawn by existing fields.

## 6. Gaps

- Red line, idle, engine mass and axle split are estimates [E]; no factory figure found.
- Gearbox: the ZF S5D 310Z (Wikipedia) against the parts catalogue's Getrag 260/5/50
  (s14.de); the overall top gear (3.46) is the same on every source, so the top speed
  does not depend on it.
- Lock 0.618 kept and Cd·A set to 0.66 on the reality bench (§7).
- No straight front photo of the 1990–95 car; the 1988–89 CC0 set stands for it (same
  stamping).

## 7. The first draft (2026-10-27)

The owner's answers to §5: decide the lamp rings (black chosen: the lens alone on the black
band read as a hole), lean the nose, draw the Hofmeister kink, turn the stack to the driver,
alloys (`gw_alloy_cross`), no fog lamps. After his first look at the front view: «зеркала у
bmw не так крепятся» → the head on a black base, no arm.

New spec fields (every other car `identical` in `tools/kit-fingerprint.ts`): `round.ring`,
`mirrorMount: 'base'` and `mirrorHead`, `bootTank: false` (the E34's tank lies under the
floor; the classic's boot tank also sat flat on the shelf and fought it from an open boot),
`stack.yaw`. The lean's `peak` came with the GAZ-24 the same day.

Readings on the drawing (`e34_tbp_620.jpg`; `s = (x − 28) × 0.0058`, `y = (331 − py) ×
0.00591`) are in the comments of `bmw.ts` and in `refs/e34.json`: face 0.07 behind the
bumper, the lamps' band 0.55–0.735 with the lamps at ±0.40 / ±0.59, kidneys ±0.17; bonnet
0.80 → 0.925 at the cowl (1.33); A pillar to the rail at 1.95; glass 0.98–1.317; B pillar
black 2.475–2.645; the quarter's bar 3.165–3.195, its rear edge 3.24 at the rail hooking
forward 4.5 cm over the belt at 3.42–3.47; back light 3.45 → 4.05; tail 4.665, the lid
down to 0.60 between the wing lamps (±0.625–0.80, amber 0.785–0.845, red 0.63–0.78) with
its own lamps ±0.36–0.585. The shark nose on `side.jpg`: −0.17 m/m from 0.55 to the crease
at 0.735, the lip back over it.

Accepted (refs `accepted`): the front glass read at the belt 1.54 (the A pillar's foot
rises from the wing to the door; the glass starts right behind the thin pillar), the
quarter's rear edge at the belt 3.424 (its hook).

Checks (`npm run kit-check -- e34`): zfight pass, proportions pass, reality pass (top 213
against 211 with Cd·A 0.66; 0-100 11.9 against 10.6 accepted as `CATALOGUE_OPTIMISTIC`;
turn 4.04 against 4.02), mirrors L78 R74, dents 0, 14 006 triangles (over the 13k advisory,
under the 15k gate), drawing 21/21, dash 9/9; not frozen until the owner accepts it.

## 8. The owner's first review (2026-10-27)

His lab shots `build/carshape/_refs/photos/e34/owner_kit_side.png`, `owner_kit_tail.png`.
Readings: the drawing [D] `s = (x − 28) × 0.0058`, `y = (331 − py) × 0.00591`, glass found
as its white fill; the side photo [S] registered on its hubs (x 477.5 / 1553.5, the
factory 2761 between them: 2.566 mm/px, heights on the same scale from the ground at y
1002, the roof 1.412 at y 465), dark runs scanned per column; [D2] the raster drawing
`e34_tbp_76.gif` (6.85 mm/px on its hubs x 435 / 838). `build/kitcheck/e34/side-compare.png`:
the built car's right side in orthographic projection at the photo's scale, front hub on
the photo's front hub, over the photo and with its outline on it.

### 8.1 «ох уж эта линия остекления»

| Line | D | S | §7 draft | Now |
|---|---|---|---|---|
| Side glass's foot | 0.913 at 1.93, 0.925 at 2.33, 0.943 at 2.85, 0.954 at 3.35, 0.96 at 3.43 (y 176–167) | 0.904 at 1.96, 0.914 at 2.32, 0.935 at 2.88, 0.951 at 3.30, 0.959 at 3.45 | 0.98 (read at y 165, over the line), 1.0 at 3.5; the belt 0.90 at the cowl kinked up to 0.975 at 1.5 | one straight line: belt 0.868 at 1.53, 0.895 at 2.5, 0.927 at 3.519 (+ 0.03 shoulder and rubber: the glass's foot 0.898 → 0.957); built `beltY` 0.914 |
| Wing's top to the A pillar | — | the shut line 0.86 at 1.29 rising to 0.905 at the pillar's foot | level 0.857, then up 7.5 cm behind the pillar | straight from 0.855 at 1.2 into the belt |
| A pillar | the screen's line (258, 175) → (364, 104): 1.33 / 0.925 → 1.95 / 1.34 on the centre line; the pillar's band (300, 180) → (380, 105), 4 cm wide; the front glass's edge (305, 180) → (380, 112): 1.61 → 2.04 | light band 1.73–1.75 at 1.0; glass edge 1.61 at 0.90, 1.86 at 1.11, 2.01 at 1.24 | cowl 1.33 → 1.95; frame 1.38, glass 1.40–1.51 | cowl (pillar's foot) 1.53 → 2.0; black frame 1.553 → 2.03; glass from 1.575 → 2.06 (built 1.60 at the belt); `screenFoot` 0.2 / `screenTop` 0.05 keep the centre line at 1.33 / 1.95 |
| B pillar | the front glass to 2.49 at the belt, the rear from 2.63; 2.59–2.67 at the rail | front glass's edge 2.495 → 2.595 at the rail, rear glass's 2.645 → 2.675 | 2.475–2.645 → 2.56–2.67 | 2.475–2.645 → 2.585–2.675 |
| Quarter bar | x 573–581: 3.164–3.204 | 3.15–3.17 at the rail, 3.19–3.21 at the belt | 3.165–3.195 upright | unchanged |
| Quarter's rear edge (Hofmeister) | 3.32 at 1.22, 3.43 at 1.14, 3.49 at 1.10, 3.52 at 1.03, 3.50 at 0.99, the foot 3.48 at 0.96 | 3.29 at 1.28, 3.40 at 1.21, 3.50 at 1.125, 3.545 at 1.03, the foot 3.52 at 0.96 | straight 3.42 → 3.235 at the rail, the foot 3.42–3.47 | the glass's top chamfered inside the door's painted frame (`glassDrop` 0.105 at 3.44, 0.17 at 3.506): 1.305 at the bar → 1.165 at 3.41 → 1.09 at 3.48, down to 1.0 at 3.49, the foot hooked forward to the belt at 3.44 (`glassRise` 0.045); built 3.196–3.48 at the belt band |
| Rear door's rear edge | 3.49 at the belt, 3.48 at 0.857, 3.474 at 0.816, 3.457 at 0.774 | 3.50–3.51 at the belt | 3.5, upright to 0.8 | 3.519, upright to 0.85, the door's frame 1.3 cm behind the glass (on the shut line itself the jamb's seal lay in the lining's plane: kit-zfight) |
| Rail, roof | the glass's top 1.317; roof 1.37 at 2.0 … 1.355 at 3.45 | 1.32–1.35 along the doors | rail 1.335 | unchanged; the first `roofDrop` point at the pillar's new top, 2.0 |
| Back light | (622, 103) → (726, 162) | — | 3.45 → 4.05 | unchanged |
| Mirror head | s 1.72–1.86, 0.93–1.07 | 1.75–1.88, 0.90–1.06 | belt + 0.07 | belt + 0.11 (`mirrorHeightOffset` 0.04): centre 0.985 over the belt now 10 cm lower |

Also: the shoulder line (crease) rising to the tail lamps' top behind the rear door (0.78
→ 0.81 at 4.05, 0.845 at the tail) [S: 0.845 over the lamps]; the side's lean over the crease
kept rising evenly nose to tail (wBelt 0.855 at 2.5, 0.849 at 3.519; a dip at the rear door
was a kit-surface `lean` dent). refs/e34.json: `beltY` 0.98 → 0.916, `doorFront` [1.531,
2.523], `doorRear` [2.523, 3.474], `sideGlassBelt` [[1.61, 2.49], [2.63, 3.164], [3.204,
3.523]] all re-read on D (10 cm under the glass's foot, over the glass's foot); the
`accepted` override on `sideGlassBelt` is gone.

### 8.2 «сзади места как в лимузине»

`CABIN_E34` spread `CABIN_W124`, whose bench was the classic's rearBase − 0.45: 3.60 on the
E34, over the rear axle. D2 (the doors left off): the driver's hip (backrest meets cushion)
x 662, s 2.40, the cushion 1.97–2.53; the rear hip x 785, 3.25, its cushion from 2.88; the
wheel's centre x 572, 1.79. D: the rear arch's front at the hub's height 3.30. Built: `hip`
0.87 from the cowl 1.53 (2.40; was 0.95 from 1.33, 2.28), `bench` rearBase − 0.81 (3.24; the
W124 since moved its own to − 0.78, the E34 now sets its own). The cowl moved 1.33 → 1.53,
so the dash, the wheel (1.91), pedals (1.58 / 1.68), lever (1.98) and console (1.70–2.08)
were moved forward to stay where they stood; the dash 0.17 deep to its fascia (1.70); the
wheel's hub at its old 0.93 (`dy` 0.062: the belt at the cowl 3 cm lower). The drawn wheel
centre 1.79 is 12 cm ahead of the built one: kept 11 cm behind the hood, as the W124's, so
the rim clears it. Knee room: the front backrest's back ~2.6 to the bench's front ~2.9.
cabin-places passes.

### 8.3 «выпуклые фары на крышке багажника»

The Espero's fix (HISTORY "Espero lamp review 2", daewoo.ts `LOOK_ESPERO.rear.lid`): flat
lenses 2–4 mm out of the lid in the corner units' style. Here: the lid's cells `slant` 0
(square, no bevel), 2 mm deep, 2 mm out, on a black housing panel 2 mm out whose edges show
as the seams; the row seam where the wing units' one rib is (`ribs: 1`, 0.693–0.715).

The band on R (rear.jpg, the lid's cut taken as D's ±0.60): from the plate (±0.175) a single
tall red reflector to ±0.265; a two-row panel to ±0.36 (the lock in it, right); the lamp to
±0.60 in two rows, the upper red / lighter reversing cell ±0.41–0.53 / red; the wing unit
outside the cut, a pale (amber) top cell over two red rows. D's rear view draws only
±0.355–0.80; R34 (a 1990–95 car) shows the band to the plate too. Built: reflector
±0.17–0.264 and panel ±0.27–0.354 `inert`, lamp ±0.36–0.589 (`tail`, reversing ±0.411–0.529),
heights 0.63–0.778 with the wing units' red; the wing units' inner edge 6 mm outside the cut
(±0.60–0.611). The draft's corner bulge: the amber band (0.785–0.845) lay above the tail's
crease (0.78), on the shoulder's turn, so it bent at the corner; the crease now at 0.845.

### 8.4 Checks

`npm run kit-check -- e34`: zfight pass, proportions pass (fit row not stale), reality pass,
mirrors L90 % R88 %, dents 0, 13 979 triangles, drawing 21/21, dash 9/9; tsc clean;
cabin-places pass; kit-fingerprint: every other car identical (the W124 moved by its own
tail work in the tree).

## 9. The roof's rear corners (2026-10-28)

`owner_kit_roofrear.png`: «сзади над задним стеклом артефакты крыши». On the built mesh the
rear door's frame met the rail at 3.443 / 3.447, the roof's edge over the back light
(top 3.45 − `railInset` 0.04) at 3.41: the roof's last row and the rail's chamfer ran
forward and folded, the headliner showing through. Now the glass column 3.51 → top 3.405,
the door's rear edge 3.519 → top 3.41, the back light's column without `cornerDrop`.
Unchanged on the drawing rows: `sideGlassBelt` rear 3.484 (real 3.523, ±0.04), `doorRear`.
kit-check passes, 13 952 triangles, drawing 21/21.
