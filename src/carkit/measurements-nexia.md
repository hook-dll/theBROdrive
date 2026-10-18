# Daewoo Nexia N100: measured numbers

Crops, gridded readings, overlays and the headless renders are in `/tmp/kitnexia/`, local only. The drawing and photos are saved under `build/carshape/_refs/` (gitignored): `bp/img/daewoo_nexia.jpg`, `photos/nexia/*.jpg`.

Frame and tags as in `measurements-classics.md`:
- **Body:** `s` rearward from the tip of the front bumper, `y` above the ground; mm in the tables, metres in the spec.
- **Faces:** `x` is a half width from the centre line.
- **Tags:** **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate (reason given).

The Nexia shares no stampings with any other kit car, so it is its own family: `BODY_NEXIA` / `LOOK_NEXIA` in `daewoo.ts`, `platform: 'samara'` (transverse engine in front, front drive, struts and a twist beam), dash `CABIN_NEXIA` in interior.ts. The car built is the early base GL (1995–2002, UzDaewoo and Korea): dark grey plastic bumpers with a thin bright strip in line with the strip along the doors, no garnish on the boot lid, no fog lamps, the G15MF 1.5 eight-valve and the five-speed. The 2002 restyle (body-colour bumpers with a black band, the grey lid garnish, the 16-valve A15MF) and the 2008 N150 are not modelled.

It is the first kit car with no catalogue sibling: its whole running gear is its own (`GEAR_DAEWOO_NEXIA: KitOwnGear` in vehicle/carmodels.ts, §5).

## 0. Sources and scales

### Factory figures [F]

| Figure | Value | Sources |
|---|---|---|
| Length × width × height | **4482 × 1662 × 1393** | drom.ru catalogue, Nexia 1.5 MT SOHC GL (https://www.drom.ru/catalog/daewoo/nexia/161911/) and its generation page (g_2002_5370); the drawing's dimension lines read 4474 / 1663 / 1362 |
| Wheelbase | **2520** | drom.ru; the drawing's dimension |
| Tracks front / rear | **1400 / 1406** | drom.ru; the drawing's dimensions |
| Clearance | **160** | the Nexia repair manual's table (https://3ruk.ru/vehicles/jado/tezeab/lla); drom.ru prints 158 |
| Tyres | **175/70 R13** (0.288 m free radius) | the manual (155 SR13 / 175/70 R13 on the SOHC, 185/60 R14 on the DOHC); drom.ru GL 175/70 R13 |
| Overhangs | not found | the drawn 936 / 1072 at the hub scale cut to 4482 in proportion: **915 / 1047** [E] |
| Kerb / gross mass | **969 / 1404 kg** | the manual (remkomplekt.org/daewoo-nexia/tehnicheskie-harakteristiki.html, 3ruk.ru); drom.ru 969 / 1404 |
| Top speed | **163 km/h** | the manual (both texts); drom.ru prints 175 (the A15MF's figure in the manual) |
| 0-100 km/h | **12.5 s** | drom.ru (beside its 175 km/h; the manual prints none) |
| Turning radius | **4.9 m** | the manual, drom.ru |
| Tank | **50 l** | the manual, drom.ru's table (its prose says 60) |
| Engine G15MF | **55 kW (75 hp) at 5400, 123 Nm at 3200–3400**, 1.498 l, 76.5 × 81.5, SOHC 8V, MPI | the manual; drom.ru prints the torque at 3200 |
| Engine A15MF (not modelled) | 62.5 kW (85 hp) at 5600 (remkomplekt: 4800), 130 Nm at 4400, DOHC 16V; 1025 kg, 175 km/h, 11 s | the manual, drom.ru |
| Gearbox | **F16 five-speed, 3.545 / 1.952 / 1.276 / 0.892 / 0.707, R 3.333, final drive 3.944** (G15MF; 4.176 with the A15MF) | 3ruk.ru's manual table; remkomplekt.org prints the same ratios with "4,19 / 3,94" unassigned and a second, shorter column (2.158 / 1.478 / 1.129 / 0.886: the post-2008 box) |
| Cd | not printed by Daewoo | automobile-catalog.com estimates 0.35 (search result only; the site refused the read) |
| Brakes | ventilated front discs, rear drums, vacuum servo, diagonal circuits, fixed pressure regulators to the rear cylinders | the manual (3ruk.ru) |

### Drawing (`build/carshape/_refs/bp/img/daewoo_nexia.jpg`)

3dcar.ru `https://3dcar.ru/media/blueprints/full/daewoo/daewoo_nexia.jpg`, JPEG 1500 × 1100: front view top left, side view (car facing left: its left side) top right, rear view bottom left, plan bottom right; dimension lines 4474, 2520, 1663, 1362, 1400, 1406. The Espero, Kadett E, Astra F and Vectra A are not on 3dcar.ru under the obvious names.

| View | Scale | Registration |
|---|---|---|
| Side | **4.851 mm/px** from the drawn hubs (crosses at x 717.5 / 1237; the 2520 dimension's extension lines at the same x) | `s = 0.915 + (x − 717.5) × 0.004851`, `y = (384.4 − py) × 0.004851`. The drawn tips (extension lines x 524.5 / 1458) read 4.529 m at this scale, 47 mm over the factory 4482 (the 4474 dimension would make the scale 4.793 and the wheelbase 2490); the hubs win (README), and the 47 mm come off the bumpers in proportion to the overhangs: the drawn front tip (s −0.021) is the kit's 0, the rear tip 4.507 is the kit's 4.482 [E]. **Heights hung from the hubs**: the drawing stands the body on tyres drawn 0.252 in radius with their hubs 0.235 over the drawn ground line (py 373.5); the car runs 0.288. The ground is put 53 mm under the drawn one (py 384.4), so the kit's hubs (at its tyre radius) land on the drawn hubs and the body keeps its drawn place round them. Check: the roof comes out 1.411 (passport 1393: the loader fits −1.3 %); on the side photo "Daewoo Nexia 01" the sill and belt stand higher over the ground than on the drawing as drawn, as this puts them. |
| Front | across **4.52 mm/px** from the 1400 track (tyre centres x 79 / 389), up **4.762** from the 1362 line (py 86–372) | centre x 234; `x = (px − 234) × 0.00452`, `y = (372 − py) × 0.004762 + 0.053`. The view is squashed across: at the side view's scale the body would be 1.75 wide. |
| Rear | across **4.636** from the 1406 track (x 99.2 / 402.5), up **4.767** (roof py 613.3, ground py 899) | centre x 250.8; `y = (899 − py) × 0.004767 + 0.053`. |
| Plan | tips x 541 / 1462 laid on the side view's (×1.0136); half widths at the side scale | the outermost pixels per column (§1.2). |

### Photos (Wikimedia Commons, in `build/carshape/_refs/photos/nexia/`)

| Commons title | Licence | Used for |
|---|---|---|
| 2000 Daewoo Nexia dark blue front.jpg | CC0 | Left front 3/4: head lamps flush under the bonnet's lip with the amber indicator at their outer ends wrapping round the corner, the black slatted grille with the badge, the dark grey bumper with its bright strip, the thin bright strip along the doors, the amber repeater on the wing over the arch's back, black handles and mirrors, the mirror on a black sail. |
| 2000 Daewoo Nexia light green front.jpg | CC BY 4.0 | The same base car: grey bumpers, the strips, repeater; the front door's glass with the mirror's sail. |
| 1997 Daewoo Nexia dark green rear.jpg | CC BY 4.0 | Right rear 3/4 of a base car: grey bumpers, the plate on the bumper, tail lamps (a light band over red), the lid down between them, no garnish; **the filler flap on the right rear wing** behind the rear door. |
| 2003 Daewoo Nexia golden yellow rear.jpg | CC BY 4.0 | Left rear 3/4 of a restyled car (body-colour bumpers, black band, the grey lid garnish): the lid's shape between the lamps, the lamps' cells. |
| 1996 Daewoo Nexia 1.5i GLX sedan.jpg | CC BY 2.0 | A European car: the tail lamps wrapping a little onto the wings, the strips. |
| Daewoo Nexia 1.5 1996 (14007352903).jpg | CC BY-SA 2.0 | A hatch in Chile: the face, the bumper's strip in line with the doors'. |
| Daewoo Nexia 1996 on dirtroad.jpg | CC BY-SA 3.0 | Square front: lamps, grille, the lower bumper's openings. |
| Daewoo Nexia 01.jpg | public domain | Left side (rear 3/4): the arches close round the tyres, the black rubbing strip, the tail lamps' wrap, heights cross-checked (§0 Side). |
| Daewoo Nexia interior.jpg, Astra F (MK3) dashboard in Daewoo Nexia.jpg, Daewoo Nexia Tacho.jpg | CC BY-SA 3.0 | The dash, wheel, cluster, seats (§4). |

---

## 1. Side (drawing side view unless marked)

| Feature | Reading (px) | s, y (m) | Spec |
|---|---|---|---|
| Front / rear bumper tip | x 524.5 / 1458 | −0.021 / 4.507 (drawn) | `length` **4.482**, tips at 0 / 4.482 [F; §0] |
| Front / rear hub | x 717.5 / 1237, py 325 | 0.915 / 3.435; 0.288 | `wheels.front` **0.915**, `rear` **3.435**; `radius` **0.288** [F] |
| Front arch | lip top py 247; ±73 px at the hub's height | 0.667 (0.379 over the hub); ±0.356 | `arch` **1.28** |
| Rear arch | lip top py 262; x 1163 / 1312 at the hub's height | 0.594 (0.306 over the hub); ±0.361 | `rearArch` **1.25**, `rearArchRise` **1.06** |
| Front bumper | top py 261–265; strip py 269–275; the lower part drawn in from py 305; foot py 335; back along the flank to x 643–650 | 0.599; 0.53–0.56; 0.385; 0.24; s 0.555–0.59 | moulded **0.24–0.60** (sill 0.30 + 0.035, `drop` **0.095**, `height` **0.36**), strip `moulding` **0.545**, `wrapTo` **0.53** (the arch's front 0.546 at the hub's height) |
| Face (the lamps) | x 550–553 | 0.10–0.117 | first station **0.11**; `bonnetFront` 0.11 |
| Bonnet centre (the outline) | py 234 / 223 / 217 / 211 / 205 / 201 / 198 / 194 / 190 at x 560 … 800 | 0.729 at s 0.151, 0.782 / 0.248, 0.812 / 0.345, 0.841 / 0.442, 0.87 / 0.588, 0.89 / 0.733, 0.904 / 0.83, 0.924 / 1.024, 0.943 / 1.315 | deck 0.73 / 0.765 / 0.80 / 0.843 / 0.872 / 0.905 / 0.93 at s 0.11 / 0.2 / 0.3 / 0.45 / 0.6 / 0.915 / 1.315 |
| Wings' top (bonnet's side line) | 0.02–0.04 under the centre | 0.70 at 0.15 → 0.919 at the cowl | belt = deck − 0.015 − crown, the crown growing evenly 0.01 → 0.047 |
| Wing's crease | py 237 / 233 / 227 / 223 / 221 / 218 / 215 at x 600 … 800 | 0.715 at s 0.35, 0.734 / 0.44, 0.764 / 0.59, 0.783 / 0.73, 0.793 / 0.83, 0.807 / 1.02, 0.822 / 1.315 | `featureLine` from s 0.33 (0.718) to 1.44 (0.825), height 0.012; on the doors the crease is the belt itself (0.83–0.87, 1–2 cm under the glass's foot) |
| Screen / A pillar outer line | (1.383, 0.992), (1.597, 1.137), (1.861, 1.307), the roof at (1.948, 1.355) | 1.517 m of s per m | first column **1.315 / 1.92** |
| Front door's front shut line | x 826–833 below the belt | 1.44–1.478 | column **1.46** (the wing below the belt to here, `lower: 'body'`) |
| A pillar, frame, glass | at py 150: lines at s 1.597 / 1.72 / 1.749 / 1.81 | the pillar's face 0.12 of s, the frame 0.09; the mirror's black sail and the front quarter post (s 1.65–1.67, 0.83–1.09) under it | slim (HISTORY, the AZLK's and Volgas' pillars): frame column **1.36 / 1.965** (0.045 behind the pillar's line), glass **1.395 / 2.0** (0.035 behind that), the sail and post not modelled |
| B pillar | front glass ends 2.397 (belt) / 2.462 (top); shut line 2.433–2.44; rear glass from 2.511 / 2.564 | | columns 2.40 / 2.425 / 2.44 / 2.485 / 2.51 |
| Rear glass's rear edge | (3.316, 0.919), (3.231, 1.137), (3.20, 1.307) | 3.33 at the belt, 3.17 at the rail | column **3.33 / 3.17**; frame and shut line 3.35–3.36 (below the belt 3.345–3.36, down to the arch) |
| Quarter glass | a triangle: front edge along the door frame, apex (1197, 115) → 3.24 / 1.307, foot to x 1293 | 3.375–3.69 at its foot | `fixed` from **3.375 / 3.215** to the column **3.69 / 3.25** |
| Window sill (glass foot) | py 204 / 203 / 200 / 199 at x 950 / 1000 / 1100 / 1180 | 0.875 / 0.880 / 0.894 / 0.899 | belt **0.868** at the cowl, **0.872** at 2.44, **0.878** at 3.36; `glassBottom` 0.01 |
| Door frame top (rail) | py 106.5 | 1.348 | `rail` **1.348** |
| Glass top | py 113 | 1.317 | `glassTop` **0.03** |
| Roof | py 93.5 from x 1040 to 1130 | 1.411 | rail + 0.02 + 0.043 = **1.411** |
| Roof's profile | 1.36 at s 1.95, 1.38 / 2.04, 1.404 / 2.28; 1.399 / 3.01, 1.386 / 3.16, 1.361 / 3.26 | | `roofDrop` [[1.92, 0.015], [2.05, 0.009], [2.25, 0.003], [2.45, 0], [2.9, 0], [3.05, 0.008], [3.2, 0.02], [3.33, 0.035]] |
| Back light | outer line 3.707 at 1.137, 3.804 / 1.089, 3.898 / 1.04, the deck at ~4.0 | 1.94 m of s per m | top at the rail **3.33**, foot (`rearBase`) **3.96**, 1.03 on the centre line |
| Boot | centre 1.025 / 1.016 / 0.996 at s 4.03 / 4.18 / 4.32; edge 0.99 / 0.982 / 0.958 | | deck 1.03 / 1.018 / 0.998 at 3.96 / 4.15 / 4.30 |
| Tail face | x 1428 | 4.362 | tail station **4.36** |
| Tail lamp on the flank | x 1398–1428; division py 219–222, foot py 247–248 | s 4.21–4.36; 0.788 / 0.667 | corner lamps forward to **4.24** |
| Rear bumper | top py 259–264 at the tail; strip py 272; foot py 322; forward on the flank to x 1310 | 0.608–0.584; 0.545; 0.30; s 3.79 | moulded **0.30–0.61** (sill 0.33 + 0.035, `drop` **0.065**, `height` **0.31**), strip 0.545, `wrapTo` **3.81** (the arch's back 3.795) |
| Sill | py 336 between the arches | 0.235 | `sill` **0.235**; 0.30 under the nose, 0.32–0.33 behind the rear arch |
| Door bottom | py 322 | 0.303 | `doorBottom` **0.303** (over the hub) |
| Door strip | py 273 along both doors | 0.54 | `waist` **0.54**, 0.015, chrome [P] |
| Repeater | not on the drawing | — | **1.22–1.27, 0.745–0.77** [P dark blue / light green front: amber, over the arch's back under the crease; E: place] |
| Fuel flap | not on the drawing (its left side) | — | **3.55–3.67, 0.70–0.79**, `side: 'right'` [P 1997 dark green rear: on the right rear wing behind the rear door; round on the car] |

`rearBase` is 3.96, not the drawn 3.95: at 3.95 the rear bench's riser (interior.ts `bench`, to `rearBase − 0.015`) ends in the plane of the silencer's rear face (bay.ts `samaraChassis`, to `rear + 0.5`), both at 3.935, and `kit-zfight` failed on the pair.

### 1.1 Tail (saloon)

The boot lid comes down the tail face between the corner lamps to the bumper's top, as on the 2110 and 2115 (`bootEnd` = the tail station's `s`, `notch` there): the lid's trailing edge at 4.30 (belt 0.945, deck 0.998), the tail face at **4.36** with belt **0.905** (the lamps' top) and deck **0.645** (the lid's foot just over the bumper), `notch` **0.39**. The lamps' inner edges lean from ±0.367 at their foot to ±0.475 at their top [D rear]; the generator's lid has upright sides, so the lid is cut at ±0.39 and the lamps' inner edges lean from ±0.40 to ±0.47 beside it.

### 1.2 Half widths (plan; front view for heights)

| s | Plan outermost | Spec wSill / wCrease / wBelt |
|---|---|---|
| 0.11 | 0.648 at 0.12 (the bumper's corner) | 0.62 / 0.645 / 0.625 |
| 0.20 | 0.694 at 0.17, 0.716 at 0.22 | 0.68 / 0.705 / 0.685 |
| 0.30 | 0.730 at 0.27, 0.754 at 0.37 | 0.715 / 0.738 / 0.72 |
| 0.45 | 0.771 at 0.47 | 0.745 / 0.768 / 0.75 |
| 0.60 | 0.788 at 0.56, 0.80 at 0.66 | 0.77 / 0.79 / 0.772 |
| 0.915–3.69 | 0.815–0.832 (0.822 at 0.86); front view ±0.834 at 0.59, ±0.809 at 0.78, ±0.796 at 0.82, ±0.766 at 0.87 | 0.80–0.805 / 0.825–0.832 / 0.795 |
| 3.96 | 0.81 at 3.91 | 0.785 / 0.808 / 0.78 |
| 4.15 | 0.791 at 4.10 | 0.77 / 0.79 / 0.77 |
| 4.30 | 0.769 | 0.75 / 0.77 / 0.755 |
| 4.36 | 0.754 at 4.35; the lamps' outer edge ±0.761 seen from behind [D rear] | 0.735 / 0.755 / 0.74 |

`crease` **0.60** along the car (the flank widest between 0.54 and 0.63 [D front]). Side glass: the A pillar's outer line runs from ±0.731 at 0.967 to ±0.59 at 1.301 [D front], 0.42 m in per m up: its foot ±0.765 at the belt (`shoulder` inset **0.03**, rise 0.015) and ±0.56 at the rail (`railHalf` **0.56**); the roof's edge ±0.52 at 1.396 (`railInset` 0.04).

## 2. Front (drawing front view; photos for colour)

| Item | Reading (px) | x (half), y (m) | Spec |
|---|---|---|---|
| Bonnet's front edge / lamps' top | py 230 across | 0.729 | face deck 0.73; lamps under it |
| Head lamp | x 98–163, py 228–253; the top sagging from py 228 (outer) to 231 (inner); the inner end leaning from x 172 (foot) to 162 (top) | ±0.28–0.613, 0.62–0.734 | `cornerLamps` head from ±0.27 (foot) to ±0.325 (top), along the grille frame's side 13–15 mm off it; foot **0.615 → 0.616 → 0.621** sweeping up outward; top one arch **0.70 → 0.713 → 0.707**, falling to the acute inner top corner (inside the face's outline: 0.705 at the inner end, the shoulder at ±0.615) [P: clear; review 1, §8] |
| Indicator | x 73–98, same heights; side view a dome on the wing from the face to x 612, its top 0.72 at x 595 | ±0.613–0.726 (round the corner); s to 0.40 | `cornerLamps` blinker from ±0.615 round the corner (0.63–0.70) and along the wing, its top falling and its foot rising to close at s **0.40** (0.704 at s 0.2, 0.69 at 0.3, 0.672 at 0.36, 0.645–0.655 at the end) [D side; P: amber] |
| Grille | x 168–297, py 235–255; the frame's sides from x 178 at the foot to x 165 at the top | ±0.253 → ±0.312, 0.705–0.61 | `grille` opening ±0.245 at the foot to ±0.30 at the top (`slant` −0.055), bumperTop + 0.012 … deck − 0.025, a 0.01 black `frame`, four black horizontal bars [P: slats in a black surround, the badge not modelled; review 1 follow-up, §8] |
| Bumper | py 255–332; strip py 262–270 | 0.61–0.192; 0.525–0.56 | moulded 0.24–0.60, strip 0.545 (§1) |
| Lower openings | outer ovals x 100–148 / 323–373, middle slots x 160–232 / 240–308, py 300–317 | ±0.39–0.61 and ±0.01–0.33, 0.30–0.39 | outer recesses `panel` ±0.37..0.58, the middle pair one `grille` ±0.32 split by a bar, both bumperBottom + 0.085 … 0.145 |
| Slot under the grille | x 200–268, py 265–275 | ±0.15, 0.53–0.51 | not modelled (black on the dark bumper) |
| Windscreen's foot / top corners | py 185 at ±0.689 (the A pillar's foot) | 0.943 | cowl deck 0.93 |
| Mirrors | py 200–230, to ±0.927 | | (the generator's) |

## 3. Rear (drawing rear view; photos for colour)

| Item | Reading (px) | x (half), y (m) | Spec |
|---|---|---|---|
| Back light | top py 626 (inner edges), foot py 690 | ±0.47 / ±0.65; 1.354 / 1.05 | `rearHeader` 0.04 |
| Lid | top corners py 700 at ±0.63; down the lamps' inner edges to its foot py 771.7 at ±0.36 | 1.002; 0.66 | `notch` **0.39**, foot (deck) **0.645** |
| Lamp units | x 87–172 (outer to inner, at their foot), py 720–768; division py 740; the inner side x 168 (py 768), 162 (755), 156 (745), 152 (738), 147 (730), 140 (723), 133 (720) | ±0.384–0.769; 0.906–0.677; 0.811; inner side ±0.384 / 0.412 / 0.439 / 0.458 / 0.481 / 0.514 / 0.546 at 0.677 / 0.739 / 0.787 / 0.821 / 0.859 / 0.892 / 0.906 | `cornerLamps` (rear), two bands split level at **0.811**, the inner side the drawn convex line moved 0.016 out (clear of the lid's upright side, ±0.39): lower **0.68–0.811** from ±0.40 (foot) via ±0.428 at 0.739 to ±0.468 at the split, brake inside, tail outside; upper **0.811–0.90** from ±0.468 via ±0.497 at 0.859 and ±0.53 at 0.89 to ±0.562 at the top, reversing inside to ±0.60, indicator outside [P: a light band over red, the rounded inner top corner; review 1, §8] |
| Bumper | top py 778–782; strip py 790–795; foot py 845 (the exhaust's notch on the right) | 0.63–0.61; 0.573–0.549; 0.30 | moulded 0.30–0.61 (§1) |
| Plate recess | x 208–292, py 798–830 | ±0.19, 0.48–0.33 | not modelled |

## 4. Cabin (`CABIN_NEXIA`, interior.ts)

The Samara platform's furniture and dash section with the Nexia's fittings [P "Daewoo Nexia interior", "Astra F (MK3) dashboard in Daewoo Nexia", "Daewoo Nexia Tacho"]: a rounded hood over the cluster (half width 0.20); the speedometer (0–200, numerals ring ~200 px) on the column, the tachometer (0–8000, red from 6500 on the photographed DOHC car's cluster) 0.095 left of it, the temperature and fuel dials stacked 0.09–0.105 right; two telltales over the speedometer's shoulders on the photo, the Samara's set in a row across the face's top (the rest not legible); a slatted vent at each end of the dash and two vents side by side at the top of the stack; the heater's three knobs in a dark panel under them; the radio under that; the glovebox low before the passenger; a wide pad on a two-spoke wheel (spokes at four and eight o'clock), the Samara's size. Scale on the interior photo: the column to the stack's centre line, 670 px, taken as the driver's seat line 0.36 off the centre (0.54 mm/px) [E]; heights hung from the Samara's cluster [E]. `upholstery` 0x56595f (grey cloth), `dash` 0x2a2b2e (dark grey plastic), head restraints.

## 5. Running gear (`GEAR_DAEWOO_NEXIA`, vehicle/carmodels.ts)

No catalogue carries a Nexia, so the car names its whole running gear (`KitOwnGear`: `KitRunningGear` plus body class, drive bias, suspension preset and handling profile; the optional valve, bars, roll centres and diffs). The next GM cars (Espero, Astra F, Vectra A) take their own rows the same way, spreading this one where they share it.

| Field | Value | Source |
|---|---|---|
| `mass` | 969 kg | the manual [F] |
| `engineId` | `engine_daewoo_g15mf`: 55 kW at 5400, 123 Nm at 3300 (manual: 3200–3400), fuel cut 5800 (rated + 7 % [E]), idle 850 [E], 118 kg [E: the VAZ-2111's], `brakingCoeff` 0.0203 (10 % of peak torque at the cut, as the loose-part engines) | parts/registry.ts `FOREIGN_ENGINE_VARIANTS` |
| `gearboxId` | `gearbox_opel_f16_nexia`: 3.545 / 1.952 / 1.276 / 0.892 / 0.707, R 3.333, final drive 3.944, efficiency 0.92, shift 0.36 s, 45 kg [E: the Samara's] | parts/registry.ts `FOREIGN_GEARBOX_VARIANTS` |
| `tyre`, `wheelGrip` | `KAMA_217`, 0.53 (every road car's) | |
| `tankLitres` | 50 | the manual |
| `brakeDecelG` | servo 1.2 | the manual: vacuum servo |
| `rearBrakeValve` | none | the manual names fixed regulators but prints no figure; none is invented (carmodels.ts note) |
| `suspension` | `SUSP_SAMARA` | struts and a twist beam with an anti-roll bar (the manual) |
| `steerLock` | 0.656 | set on the 4.9 m radius by the outer wheel (bench 3.52 against 3.50) |
| `frontWeightShare` | 0.62 [E] | no axle split printed |
| `dragArea` | 0.74 m² | from the manual's 163 km/h on the bench (no maker's Cd; automobile-catalog's estimate 0.35 on ~1.9 m² is 0.67, which gives 169) |
| `aero` | `AERO_DAEWOO_NEXIA`: the 21099's lift and crosswind figures on 1.89 m² | [E] |

`tools/reality.ts kit_nexia`: top **164** against 163 (+0.7 %), 0-100 **15.3 s** against drom.ru's 12.5 (+22.1 %, accepted as `CATALOGUE_OPTIMISTIC`: 55 kW on 1119 kg is the 21099's power to weight, whose printed 13.5 s the bench misses by 24.7 %; drom.ru's 12.5 s stands beside its 175 km/h, not the manual's 163), turn 3.52 against 3.50 (+0.5 %), loaded wheelbase, track and radius 0.0 %; no braking ceiling found (none judged); lateral 0.62 g; ride printed 0.67 Hz against the preset's 1.30. The engine's figures equal the manual's (0.0 %).

## 6. Checks (2026-10-18)

- `tools/fit-models.ts kit_nexia`: box 1.662 × 1.233 × 4.482; `tools/dust-flow.ts --write`, then `tools/dust-flow.ts`: all checks passed; only the `kit_nexia` row changed in `model-fits.json`.
- `tools/kit-proportions.ts`: all 23 kit bodies within the hard gates; the Nexia's fit row equals the fresh measure (0 mm), factory box, wheelbase, tracks, radius 0.0 %; generated 4.498 × 1.671 × 1.411 (the loader −0.4 / −0.6 / −1.5 %), hubs 4 mm in their arches.
- `tools/kit-zfight.ts kit_nexia`: PASS (13 258 triangles, 0 visible clusters, 50 shell holes, 0 slits; after review 1: 13 472 triangles, 0 in every band, 0 slits).
- Geometry hashes (README "Proving a refactor", against HEAD 5d6d398 in `/tmp/kitbase`, removed after): all 22 other kit cars identical.
- `tools/part-mesh-coverage.ts`: 49/49; `tools/cooling.ts`: all ok; `tools/driveline.ts`: all invariants hold.
- Headless overlays of the built car on the drawing's three views (`/tmp/kitnexia/r/side.png`, `front.png`, `rear.png`): hubs on the drawn hubs, roof, glass, pillars, door lines, bumpers, lamps and the lid on the drawn lines (judged by eye). Not checked in the lab (no browser in this pass).

Triangles: **13 472** after review 1 (body + trim 6 072, cabin 4 909, of it fine 1 761, bay 639, boot 52, underbody 456, wheels 1 344; 7 416 beyond the detail range); 13 258 in the first draft.

## 7. Gaps

- **Not seen in the lab**: lamps at night, opened parts, LOD, the cabin through the glass, shader programs after boot. The face, the tail and the dash want the owner's eye.
- **Heights hung from the hubs** (§0): the drawing's own ground line is 53 mm higher; the passport's 1393 roof is met by the loader's −1.3 %.
- **Overhangs** 915 / 1047 [E], the drawing's 47 mm over 4482 cut from the bumpers in proportion.
- **A pillar**: slim, the glass close behind it (HISTORY); the car's mirror sail and the front door's small fixed pane are not modelled.
- **Lid**: upright sides at ±0.39; on the car its sides lean with the lamps' inner edges (±0.367 → ±0.475).
- **Tail lamps**: two flat bands with the drawn inner outline (§3); the car's reversing lens is a small round-cornered cell in the upper band and a ribbed reflector sits in the lower one. The curves are polylines of three to four straight pieces.
- **Head lamps**: the top stays 2–3 cm under the drawn bonnet lip (the face's outline); the inner end and the grille's side are straight lines, as drawn.
- **Bumpers**: one height all round; on the car the strip and the plastic run a little lower along the flanks. The slot under the grille, the plate recesses and the badge are not modelled; the intakes are black on dark plastic.
- **Wipers** 0.48 [E] (the car has 500 / 450 mm blades); `screenBottom`, `screenHeader`, `pillar`, `rearBottom`, `rearHeader` as the Samaras [E].
- **Running gear**: front axle share, engine mass, gearbox mass, red line and idle [E]; no braking ceiling; the 0-100 is drom.ru's (an accepted catalogue-optimistic deviation, §5).
- **Traffic**: `kit_nexia` is not in `DRIVER_ODDS` (world/traffic.ts), so its drivers draw the default odds (half hurried, half frantic).

## 8. Owner's review 1 (2026-10-18): the lamps' outlines

"Всё прекрасно", but the car's signature is the gentle curves of its head-lamp and tail-lamp lines; the draft had flat rectangles and a straight block. The outlines were re-read on the drawing's front and rear views zoomed ×6 and on the photos "2000 Daewoo Nexia dark blue front", "Daewoo Nexia 1996 on dirtroad", "1997 Daewoo Nexia dark green rear" (§2, §3 rows), and laid as `cornerLamps` points with their own height spans; lamp colours and materials untouched (the owner). Head lamp: an arched top, the foot rising towards the corner, the indicator round the corner and on along the wing as a dome closing at s 0.40. Tail lamps: two bands split level, their inner side one convex line rounding over into the top. Before / after, headless: `/tmp/kitnexia/cmp_drawing.png` (front and rear views over the drawing), `/tmp/kitnexia/zoom_front.png`, `zoom_rear.png`, `/tmp/kitnexia/cmp_photos.png` (3/4 front, front, 3/4 rear, rear, each beside a photo). `tools/kit-zfight.ts kit_nexia` PASS; the other 22 kit cars identical by geometry hash; `tools/kit-proportions.ts` hard gates pass (bounds and the fit row unchanged).

Follow-up (the owner, 2026-10-18): the grille a trapezoid narrowing to its foot and the head lamps the narrow "squinting" trapezoid along it. The generator's slanted grille (`exterior.ts` `slantedGrille`, used by no car before) sank its bars 4 mm into the dark back, so the top and bottom bars' walls ran parallel to the back's walls 4 mm off them (a far-band fight); the bars now stand on the back's face, which is cut under them, and every other kit car is identical by geometry hash. The Nexia: grille opening ±0.245 → ±0.30 (`slant` −0.055) in a 0.01 black frame (§2), head lamp's inner end ±0.27 → ±0.325 along it, its top falling to 0.70 at the inner end. `tools/kit-zfight.ts kit_nexia` PASS in every band (13 472 triangles); `tools/kit-proportions.ts` hard gates pass. Before (c0e38ef) / after / photo: `/tmp/kitnexia/cmp_photos.png` (with a close-up row of the lamps and grille), `cmp_drawing.png`, `zoom_front.png`, `zoom_rear.png`.
