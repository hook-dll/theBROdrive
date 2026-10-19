# AZLK-2141 Moskvich: measured numbers

Crops, gridded readings, overlays and photos are in `/tmp/kit2141/`, local only.

Frame and tags as in `measurements-classics.md`:
- **Body:** `s` rearward from the tip of the front bumper, `y` above the ground; mm in the tables, metres in the spec.
- **Faces:** `x` is a half width from the centre line.
- **Tags:** **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate (reason given).

The 2141 shares no stampings with any other kit car, so it is its own family: `BODY_2141` / `LOOK_2141` in `azlk.ts`, `platform: 'samara'` (transverse engine in front, front drive). The car measured is the base 2141 (1986–1998): black plastic bumpers, the plain slatted grille, no spoiler. Its cabin is the `samara` platform's (a moulded dash, a hooded binnacle, a centre stack, a low tunnel, five seats: the 2141's arrangement too [P "Салон Москвич-2141"]) with the fittings rearranged after that photo in `CABIN_2141` (§6); its cowl-to-B-pillar run (1.07 m) is within 7 cm of the 2109's (1.0 m), and its rear bench (`hip` + 0.78) stands ahead of the rear wheel-houses (arch front 3.118, bench 3.07).

## 0. Sources and scales

### Factory figures [F]

| Figure | Value | Sources |
|---|---|---|
| Length × width × height | **4350 × 1690 × 1400** | drom.ru (https://www.drom.ru/catalog/moskvitch/2141/201007/), ru.wikipedia (Москвич-2141), njcar.ru (https://www.njcar.ru/dimensions/moskvich/2141/); the drawing's dimension lines |
| Wheelbase | **2580** | the same; the drawing's dimension |
| Overhangs front / rear | **910 / 860** | drom.ru (2141 1.6 MT, 02.1986–01.1995); 910 + 2580 + 860 = 4350 |
| Tracks front / rear | **1440 / 1420** | wiki.zr.ru (Москвич-2141), ru.wikipedia; the `sa_azlk2141` row |
| Clearance | **140** | wiki.zr.ru, njcar.ru (163 and 171 are printed for later cars) |
| Tyres | **165/80 R14** (0.310 m free radius) | drom.ru; the `sa_azlk2141` row's 0.310 / 0.165 |

`FACTORY_GEOMETRY.kit_azlk2141` takes the `sa_azlk2141` row's figures, which are these.

### Drawing (`/tmp/kit2141/tbp_1990.jpg`)

The-blueprints.com's watermarked preview of its "Moskvich 2141 (1986-2001)" vector drawing (https://www.the-blueprints.com/vectordrawings/show/23721/moskvich_2141/, preview `modules/vectordrawings/preview-wm/1990_moskvich_2141.jpg`), JPEG 1280 × 905: side view (car facing left: its left side), front view top right, plan below the side view, rear view bottom right; dimension lines 4350, 2580, 1690, 1400. The 3dcar.ru drawing (`/media/blueprints/full/moskvitch/moskvitch_2141.jpg`) is an undimensioned 800 × 400 four-view: saved, not used (half the resolution).

| View | Scale | Registration |
|---|---|---|
| Side | **5.714 mm/px** from the drawn hubs: the tyres' contact patches centred at x 180.5 / 632 (451.5 px = 2580; the 2580 dimension's arrow tips read 181.4 / 632.9) | `s = 0.910 + (x − 180.5) × 0.005714`, `y = (331 − py) × 0.005714` (tyre bottoms y 330–330.5). The drawn tips x 25 / 775 read 4.286 m, 64 mm short of 4350; the 4350 dimension's arrows (x 24 / 778) give 5.77 mm/px, which would make the wheelbase 2614. The hubs win (arches and doors are drawn round them, README); the front overhang is drom.ru's 910 (drawn 889), and the missing 64 mm go on the bumpers: front tip at s 0.021 drawn → 0, rear tip at 4.307 → 4.35 [E: split as drom.ru's overhangs exceed the drawn ones, 21 / 43]. Roof 1.400 at this scale, the 1400 dimension's 245 px reads 1400. |
| Front | 5.714 (the 1400 arrow, y 85–330) | centre x 1056.25, `y = (331 − py) × 0.005714`. The 1690 arrow spans the mirrors (x 899–1215 → 5.35, wrong); the flanks read ±0.857 at 0.6. |
| Rear | 5.714 | centre x 1055.6, `y = (746 − py) × 0.005714`; roof 1.398. |
| Plan | the side view's x registration (tips x 28 / 776) | half widths from the outermost body pixels per column (§1.2). |

### Photos (Wikimedia Commons, in `/tmp/kit2141/`)

| Commons title | Licence | Used for |
|---|---|---|
| AZLK-2141 green colored (front view).jpg | CC BY-SA 4.0 | Left front 3/4: black slatted grille between the head lamps, amber indicators wrapping round the corners, the deep black bumper, amber repeater on the wing, the bonnet's shut line on the wings' top. |
| AZLK-2141 green colored (rear view).jpg | CC BY-SA 4.0 | Left rear 3/4: tail lamps amber / red / white reversing cell, the plate between them, the tailgate's lower panel, the wide D pillar behind the quarter glass and its black triangle; no filler on the left side. |
| AZLK-2141 red colored (rear view).jpg | CC BY-SA 4.0 | The same arrangement on another car. |
| Red Moskvich 2141 (rear).jpg | CC BY-SA 4.0 | Near-square rear: the shut gaps of the tailgate running down beside the plate between the lamps, to the bumper; the lamps' cells; lamp height about the plate's (≈ 0.12–0.16 m). |
| Moskwitsch 2141 (side).jpg | CC BY-SA 4.0 | Left side: door lines (B pillar 2.37–2.42, rear door's rear edge 3.25 by the hubs), belt 0.907, door bottom 0.30, the shoulder line under the windows, the black sill; no filler on the left. |
| Moskwitsch 2141 (front).jpg, (rear) (1).jpg | CC BY-SA 4.0 | Black handles and mirrors, head restraints, the black sill strip. |
| Moscow car meet 2025-07-12 M-2141 01/02/03.jpg, Образцовый экземпляр АЗЛК-2141 в Москве – вид сзади, 12 июля 2025 г.jpg | CC0 | Front and rear of a base car: the face and tail as above. |
| Салон Москвич-2141.jpg | CC BY-SA 4.0 | Dark grey dash, round dials in a hood, grey cloth (`upholstery`, `dash`); the dash's fittings (§6). |
| Moskvich 2141 in Magdeburg.jpg, Moskvich 2141.jpg, Москвич-2141.jpg | CC BY 2.0 / CC BY 4.0 / CC BY-SA 4.0 | Cross-checks of the face (every one shows the left side). |

---

## 1. Side (drawing side view unless marked)

| Feature | Reading (px) | s, y (m) | Spec |
|---|---|---|---|
| Front / rear bumper tip | x 25 / 775 | 0.021 / 4.307 (drawn) | `length` **4.35**, tips at 0 / 4.35 [F; §0] |
| Front / rear hub | x 180.5 / 632 | 0.910 / 3.490 | `wheels.front` **0.91**, `rear` **3.49** |
| Tyre | chord 68 px 13 px over the ground → r 51 px | 0.29 (loaded) | `radius` **0.31** [F 165/80 R14] |
| Front arch | lip top y 204.3, liner y 214 | 0.724 / 0.668: 0.43 / 0.38 round the hub | `arch` **1.3** (0.403) |
| Rear arch | lip top y 213 | 0.674: 0.372 round the hub | `rearArch` **1.2** |
| Front bumper | top y 232.5 (front view 0.577), face y 243–273, lip to y 297; back along the flank to x 115 at y 250–293 | 0.563, lip 0.194; flank 0.46–0.22 to s 0.535 | moulded **0.20–0.565**: the band starts `drop` under the face's sill bevel (sill 0.25 + 0.035 = 0.285), `drop` **0.085**, `height` **0.365**, its top under the lamps' foot (0.584); `wrapTo` **0.5** (the arch's front, 0.513 at hub height). Review 1: was `drop` 0.04 / `height` 0.36, i.e. 0.245–0.605, its top 2 cm over the lamps' foot (owner: the bumper covered the lamps' lower edge; the draft took the band from the sill, not its bevel) |
| Face (the lamps' foot) | x 40, y 231 | 0.107, 0.573 | first station **0.107**; `bonnetFront` 0.107 |
| Lamp's top front / bonnet's lip | (44, 195) / (50, 192.5) | 0.130, 0.777 / 0.164, 0.791 | face deck **0.78**; `frontLean` base 0.57, lean (0.164 − 0.107) / (0.791 − 0.57) ≈ **0.22**, blend 0.15 |
| Bonnet centre (top line) | x 55 / 75 / 115 / 155 / 175 / 220 / 240 | 0.193 / 0.307 / 0.536 / 0.764 / 0.879 / 1.136 / 1.25 → 0.806 / 0.834 / 0.880 / 0.909 / 0.914 / 0.937 / 0.949 | deck 0.78 / 0.812 / 0.84 / 0.88 / 0.917 / 0.955 at s 0.107 / 0.22 / 0.336 / 0.55 / 0.91 / 1.336 |
| Wings' top (bonnet's side shut line) | (50, 190) → (250, 165.7) | 0.806 → 0.945 at the cowl | belt = deck − 0.015 − crown, the crown growing evenly 0.01 → 0.03 (0.755 / 0.785 / 0.811 / 0.848 / 0.879 / 0.91) |
| Shoulder line | y 190–193, from the lamps' top corner to the tail lamps' | 0.79–0.806 | `featureLine` **0.80** from s 0.4 (where the wing's top has risen over it) to 4.15, height 0.012 |
| Repeater | x 235.7–250, y 214.3–220 | 1.225–1.307, 0.667–0.634 | `repeater` [P green front: amber] |
| Screen / A pillar outer line | (255, 163) → (352, 92) | 1.336 / 0.960 → 1.890 / 1.366; 1.364 m of s per m | first column **1.336 / 1.85** (at the rail 1.325) |
| Front door's front shut line | x 263–264 below the belt | 1.387 [P "(side)": 1.394] | column **1.387 / 1.90**: the door from here below the belt, its frame above |
| A pillar and door glass [P "Moskwitsch 2141 (side)": 2.243 mm/px by the hubs (x 354 / 1502), its zoom `/tmp/kit2141/p5_apillar.png`] | at y 1020 (mid height): the pillar's outer line x 672, its painted face to x 683, the door's black frame to x 695, glass from x 697; the glass's front edge (677, 1130) at the belt → (803, 960) at its top; the mirror and its black sail x 655–700 under it | pillar face 0.025 + frame 0.027 = **0.056 of s** (3.3 cm across, the pillar leaning 1.40 m of s per m); the glass's front edge 1.634 at the belt → 1.917 at its top, more upright than the pillar | review 1 (owner: the pillar too heavy, the glass squeezed): frame column **1.387 / 1.90** (0.051 / 0.05 behind the pillar's line), glass column **1.417 / 1.93** (0.081 / 0.08), parallel to the pillar: 0.08 of s from the pillar's line to the glass, 5 cm across. Was: body to 1.387 / 1.895 and on to 1.515 / 2.0 above the belt (the drawn dark line (294, 166) → (368, 101)), a painted sail to the glass at 1.719 / 2.025 (the drawn edge (326, 163) → (372, 105)): 0.38 of s of paint at the belt, 0.175 at the rail. The real glass's foot (1.634) stands behind the mirror's black sail; the kit has no black sail, so its glass runs down the pillar |
| Mirror | x 309–331, y 143–166 | 1.64–1.77 | (the generator places it) |
| B pillar | front glass ends x 438.6, shut line x 443, rear glass starts x 458.6 (top x 445.7–462.9) | 2.385 / 2.41 / 2.499 (2.425–2.524 at the top) | columns 2.385 / 2.40 / 2.41 / 2.475 / 2.499 |
| Rear glass's rear edge | (561, 104) → (577, 164) | 3.084 / 1.297 → 3.176 / 0.954 | column **3.189 / 3.074** |
| Rear door's rear shut line | x 584–588.6 below the belt | 3.217–3.242 | columns 3.21 / 3.23; the door reaches over the rear arch (front 3.118) |
| Quarter glass | front x 588.6; rear point with the black triangle (666, 151), (686, 167) | 3.245; 3.684 / 1.03; 3.80 / 0.937 | `fixed` from **3.245** to the column **3.80 / 3.30** (one raked rear edge) |
| Window sill (belt) | y 172–174 along both doors; y 164–168 at the quarter | 0.897–0.909; 0.93–0.95 | belt 0.905–0.915, 0.925 at 3.88 |
| Side glass foot / top | y 165.7 / y 105 | 0.944 / 1.29 | `glassBottom` **0.03**, `glassTop` **0.035** |
| Door frame top (rail) | y 100 | 1.32 (front view: the screen's top corners 1.327) | `rail` **1.325** |
| Roof | y 86 from x 440 to 520 | 1.400 | rail + 0.03 + 0.045 = **1.40** |
| Roof's fall to the tailgate | top line 1.394 / 1.383 / 1.371 / 1.36 / 1.32 at s 2.964 / 3.078 / 3.193 / 3.307 / 3.42 | crosses 1.335 at s 3.38 | `roofDrop` [[2.85, 0], [3.08, 0.015], [3.31, 0.04], [3.38, 0.05]]; last column top **3.38** |
| Tailgate line | (590, 90) → (765, 175): 0.52 m of height per m | 3.25 / 1.377 → 4.25 / 0.891 | glass to the knee, then the panel |
| Tailgate glass foot | rear view y 586.25 | 0.913, on the line at s 4.22 | `rearKnee` **(4.22, 0.913)** |
| Tail face | x 769–770, the tail's top corner (765, 175) | 4.273–4.278; 4.25 / 0.891 | tail station **4.27** (§1.1) |
| Tail lamp on the flank | x 752.5–769, y 196.7–233 | 4.178–4.273, 0.767–0.560 | corner lamps forward to **4.18** |
| Rear bumper | top y 233.3 at the tail, y 251.7 on the flank from x 690; bottom y 282.5; tip x 775 | 0.558 / 0.453 from s 3.82; 0.277; 4.307 | moulded **0.28–0.545** (tail sill bevel 0.32 + 0.035, `drop` **0.075**, `height` **0.265**), its top under the tail lamps' foot (0.556); `wrapTo` **3.87** (the arch's back 3.862). Review 1: was `drop` 0.04 / `height` 0.27, i.e. 0.315–0.585, 3 cm over the lamps' foot |
| Sill | the bottom line y 292–298 between the arches | 0.19–0.22 | `sill` **0.20**; 0.25 under the nose, 0.32 behind the rear arch (the bumpers' foot) |
| Door bottom | y 274 | 0.324 [P "(side)": 0.30] | `doorBottom` **0.33**: over the hub (0.31), so the rear door's foot meets its arch cut-out above the arch's front point (at 0.30 the door's foot and the arch liner fought in the far band, kit-zfight) |
| Fuel flap | not on the drawing (its left side) | — | **3.44–3.55, 0.70–0.785**, `side: 'right'` [E: every photo found shows the left side, none has a flap; side and place estimated] |

### 1.1 Tail (liftback)

The tailgate runs from the roof's rear (3.38 at the rail) nearly all glass to the knee at 0.913, then a short panel to the tail's top corner (0.89) and on down the tail face between the lamps to the bumper's top. The kit's tailgate cuts at the tail station's deck and its lamps live on the tail face below the tub's belt (the Oka's arrangement, measurements-oka.md §1.1), so:
- the tailgate's foot (`rearBase`, column and station **4.245**) is put at the lamps' top: belt **0.72**, deck **0.73**;
- the tub's belt is kept under the knee (0.913) at every tail station: **0.905** at s 4.12, a cabin column of its own, where it turns down;
- the tail station **4.27** carries `notch` **0.355** (the shut gaps at ±0.30–0.36 beside the plate [D rear, P]) and deck **0.56**, so the tailgate comes down between the lamps to the bumper's top (`lidFace`).

### 1.2 Half widths (plan, front and rear views)

| s | Plan outermost | Spec wSill / wCrease / wBelt |
|---|---|---|
| 0.107 | 0.620 (the bumper's corner); 0.654 at 0.136 | 0.64 / 0.66 / 0.645 |
| 0.22 | 0.711 | 0.69 / 0.71 / 0.695 |
| 0.336 | 0.737 | 0.72 / 0.74 / 0.725 |
| 0.55 | 0.783–0.800 | 0.77 / 0.79 / 0.775 |
| 0.91–3.24 | 0.831–0.849 (0.854 over the rear arch's lip); front view ±0.857 at 0.6, ±0.836 at 0.89 | 0.81 / 0.845 / 0.83 |
| 3.88 | 0.791 | 0.77 / 0.80 / 0.785 |
| 4.12 | 0.769 | 0.75 / 0.78 / 0.765 |
| 4.245 | 0.749 | 0.73 / 0.755 / 0.745 |
| 4.27 | 0.734; the lamps' outer edge ±0.761 seen from behind [D rear] | 0.72 / 0.74 / 0.73 |

`crease` **0.62** everywhere: the flank is widest between 0.54 and 0.75 [D front, rear]. Side glass: the A pillar's outer line runs from ±0.757 at 0.99 to ±0.578 at 1.363 [D front], 0.48 m in per m up: its foot ±0.80 at the belt (`shoulder` inset **0.03**, rise 0.015) and ±0.59 at the rail (`railHalf` **0.59**; the D pillar's ±0.589 at 1.349 [D rear]); the roof's edge ±0.56 (`railInset` 0.03).

## 2. Front (drawing front view; photos for colour)

| Item | Reading (px) | x (half), y (m) | Spec |
|---|---|---|---|
| Bonnet's front edge | y 197.5 across | 0.763 (the side view's lip 0.791 is its rounded top) | face deck 0.78 |
| Head lamp lens | x 947.5–996.25, y 201.25–228.75 | ±0.343–0.621, 0.741–0.584 | `cornerLamps` head ±0.343..0.621 [P: clear] |
| Indicator | x 926–947.5, same heights | ±0.621–0.744 (round the corner) | `cornerLamps` blinker from ±0.621 round the corner, back to s 0.30 on the wing (drawn 0.336) [P: amber] |
| Grille | x 996.25–1116.25, y 200–230 | ±0.343, 0.749–0.577 | `grille` ±0.335, bumperTop + 0.012 … deck − 0.03, five black horizontal bars [P: slats] |
| Bumper | y 230–300, wrapping back to the arches | 0.577–0.18 | moulded 0.20–0.565 (§1) |
| Lower intakes, plate | x 947.5–995 / 1117–1165, y 261–275; plate x 1009–1102 | ±0.35–0.62, 0.40–0.32; ±0.27 | not modelled (black on the black bumper) |
| Windscreen's foot / top corners | y 161 at the centre; x 937.5 / x 962.5 at y 98.75 | ±0.679, 0.971; ±0.536, 1.327 | cowl deck 0.955, `rail` 1.325 |
| Mirrors | x 896–925, y 139–161 | ±0.75–0.92 | (the generator's) |

## 3. Rear (drawing rear view; photos for colour)

| Item | Reading (px) | x (half), y (m) | Spec |
|---|---|---|---|
| Tailgate glass | top y 527.5, foot y 586.25; ±0.496 top, ±0.582 foot | 1.249 / 0.913 | `rearKnee.y` 0.913, `rearHeader` 0.03 under the rail's 1.275 there |
| Tailgate between the lamps | the shut gaps x 992.5–1002.5 (black) beside the plate | ±0.304–0.360 | `notch` **0.355**, down to the bumper (deck 0.56) |
| Lamp units | x 922.5–992.5, y 621.25–648.75 | ±0.36–0.761, 0.713–0.556 | `cornerLamps` (rear): brake ±0.36–0.425, reverse 0.425–0.546, tail 0.546–0.66, blinker 0.66 to the corner and on to s 4.18 [P: red, white, red, amber]; the reversing cell is the lower half of its column on the car, full height here |
| Bumper | top y 650, bottom y 697.5 (the valance to y 715) | 0.549 / 0.277 | moulded 0.28–0.545 (§1) |
| Plate | x 1002.5–1107.5, y 626–648 | ±0.30, 0.685–0.56 | not modelled |

## 4. Check in the lab (2026-10-16)

The lab's near-orthographic captures (60 m, 5° / 2.6° lens) with the drawing's dark pixels laid over them at the scales above (`/tmp/kit2141/ov_side.png`, `ov_front.png`, `ov_rear.png`): hubs, tyres, sill, window frames, B and C pillars, quarter glass, bumpers, lamps, grille and the back light's foot land on the drawn lines (judged by eye on the overlays). Review screenshots: `/tmp/kit2141/lab_side.png`, `lab_front.png`, `lab_rear.png`, `lab_34front.png`, `lab_34rear.png`, `lab_top.png`, opened parts `open_*.png`, lamps at night `night_*.png`, the cabin `cabin_*.png`, mid traffic `mid_34front.png`.

Review 1 (2026-10-16): before / after the slim A pillar and the lowered bumpers, `/tmp/kit2141/apillar_before_after_2141.png` (side, s/y grid), `ba_2141_34front.png`, `before_2141_*.png` / `after_2141_*.png` (side, 3/4 front, 3/4 rear, the face low), `after_2141_window.png` (front glass down), `after_2141_dooropen.png`.

## 5. Gaps

- **Black window frames**: the car's door frames, B and C pillars are black [D, P]; the kit's are painted (no finish for a frame).
- **Reversing cell**: the lower half of its column on the car; a full-height band here.
- **Bumpers' flank wrap**: the real bumpers are lower along the flanks (0.46 at the front, 0.45 at the back) than across the ends; a moulded bumper is one height all round.
- **The 64 mm** the drawing is short of 4350 are put on the bumpers (21 front, 43 rear) [E].
- **Fuel flap**: side and place estimated (§1); every photo found shows the car's left side.
- **The A pillar** (review 1): the glass's front edge runs parallel to the pillar 0.08 of s behind its line down to the belt; on the car it is more upright and its foot (1.634) stands behind the mirror's black sail. The pillar's line itself is the screen's (the drawn outer line, 1.336 / 1.85).
- **Wipers** 0.45 [E]; `screenBottom`, `screenHeader`, `pillar` as the Samaras [E].
- Not modelled: number plates and their recesses, the bumpers' intake slots, the rubbing strip line along the doors at 0.45, the badge, the quarter glass's black triangle (glass there).

## 6. Dash (`CABIN_2141`, interior.ts; kit-check 2026-10-19)

Read off "Салон Москвич-2141.jpg" (1920 × 1079, from the driver's door). Scale: the radio's 1-DIN face (182 mm, x 1071–1267) gives 0.93 mm/px at the stack, its centre line x 1176. The dials keep the Samara's 0.044 radius; the cluster's spacings are ratios to it (it stands nearer the camera than the stack). Heights hang from the Samara's fascia top (the vents' and the glovebox lid's tops, y 306–349).

| Item | Reading (px) | Spec |
|---|---|---|
| Tachometer, speedometer | centres x 557 / 747, y 282 / 276: tachometer left | `rpm` / `speed` at right ∓0.052 (bezels clear), up 0.015 |
| Quarter dials | x 851 / 876, y 220 / 321, r 43; the fuel pump symbol at the lower | `temp` over `fuel` at right 0.128, up 0.035 / −0.011, r 0.019 (inside the binnacle's face) |
| Warning lamps | a row at the window's lower left, x 380–440, y 361 | a block two wide at right −0.125 [E which] |
| Wheel | two wide spokes from a pad, left and right, dipping a little | `spokes` [−15, 195] (was the Samara's three) |
| Face vents | slatted at each end (x 50–300, 1660–1765); the centre pair x 1041–1322, y 349–441 | the end pair at dy −0.1; the centre pair x ±0.065, dy −0.11, 0.11 × 0.08 each |
| Heater | sliders in a panel under the vents, x 1110–1270, y 504 | `heater` dy −0.19, two small knobs |
| Hazard | x 1298, y 471, right of the heater | [−0.11, −0.19] |
| Stack, radio | the stack down to the tunnel; the radio y 624–710 | `stack` half 0.1, `radio` dy −0.30, ashtray −0.37 [E] |
| Glovebox | lid x 1365–1647, y 306–422, its top at the fascia's | x −0.31, dy −0.11, half 0.13 × 0.045 |
