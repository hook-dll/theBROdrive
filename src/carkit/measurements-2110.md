# VAZ-2110 and VAZ-2112: measured numbers

Crops, gridded readings, photos, overlays and lab captures are in `/tmp/vaz2110/` (photos in `ph/`, lab captures in `lab/`). Only this file, the code and the drawing in `build/carshape/_refs/bp/img/` were written.

Frame and tags as in `measurements-classics.md`:
- **Body:** `s` rearward from the tip of the front bumper, `y` above the ground; mm in the tables, metres in the spec.
- **Faces:** `x` is a half width from the centre line.
- **Tags:** **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate (reason given).

The 2110 shares no stampings with the Samaras, so it is its own family: `BODY_2110` / `LOOK_2110` in `tens.ts`, `platform: 'samara'` (front drive, the Samara's layout and dash as they are).

## 0. Sources and scales

### Factory figures [F]

| Figure | Value | Sources |
|---|---|---|
| Length × width × height | **4265 × 1680 × 1420** | infocar.ua (vaz-2110.infocar.ua, infocar.com.ua print 4815), whobycar.com, cartechnic.ru/vaz/vaz_2110, uncle-vova.com; autoopt.ru gives 4263 × 1676 × 1430 |
| Wheelbase | **2492** | infocar.ua, uncle-vova.com, inkam-auto.ru; autoopt.ru and vazclub.com give 2490 |
| Tracks front / rear | **1400 / 1370** | autoopt.ru, cartechnic.ru, infocar.ua; uncle-vova.com gives 1410 / 1380 |
| Clearance | **165** | catalog-vaz.ru, infocar.ua (vazclub.com 160, uncle-vova.com 170) |
| Tyres | **175/70 R13** (175/65 R14 option) | autoopt.ru; 175/70 R13 = 0.288 m free radius |

`FACTORY_GEOMETRY.kit_vaz2110` = 4.265 × 1.680 × 1.420, clearance 0.165, wheelbase 2.492, tracks 1.400 / 1.370, wheel radius 0.288, tyre 0.175.

### Drawing (`https://3dcar.ru/media/blueprints/full/vaz/vaz_2110.jpg`, saved to `build/carshape/_refs/bp/img/`)

`file`: JPEG, 1700×1000 (a real drawing; `vaz_2111.jpg` and `vaz_2112.jpg` exist there too and were saved; `vaz_2110_1995.jpg` is a 404 page and was deleted). Four views, undimensioned.

| View | Scale | Registration |
|---|---|---|
| Side (car facing left) | **4.092 mm/px** from the drawn wheelbase: hubs x 819.5 / 1428.5 (tyre rings 748–891 / 1357–1500), tyre bottoms y 408 (the ground). | s = (x − 618)·0.004092, y = (408 − y_px)·0.004092. Tips x 618 / 1661 → **4268** overall (−0.07 % on 4265); roof y 60 → **1.424** (1420); tyre outer radius 71.5 px → 0.293 (175/70 R13: 0.288). The drawing is self-consistent. |
| Top | 4.092 mm/px (same x as the side view) | Centre y 709; widest 403 px → 1.649 (the passport's 1680 includes the mouldings' flare [E]; the loader fits the width). |
| Front, rear | ~4.10 mm/px: both 346 px from the ground (y 408 / 883) to the roof, as the side view; centres x 290 / 289 | Heights by the side view's scale; half widths x·0.004092. The drawn plates (142 px) are not to scale and were not used. |

### Photos (Wikimedia Commons, full-size originals, in `/tmp/vaz2110/ph/`)

| Local | Commons title | Licence | Used for |
|---|---|---|---|
| `s1` | 2004 Lada 21102 silver side.jpg | CC0 | Left side, near-orthographic: arches against the tyres; no flap on the left; the rear door's shut line. |
| `s2` | Łada 110 (bok), WAW.jpg | CC BY-SA 4.0 | Right side 3/4: **fuel flap on the right rear wing**. |
| `s3` | Lada 110 saloon Turkey.jpg | CC BY-SA 3.0 | Front left 3/4: face, repeater on the front wing. |
| `f1` | 1998 Lada 21100 blue front.jpg | CC0 | Face: dark slot between the lamps, indicator outer cell, bumper intake. |
| `f2` | 2012 Lada 2110 white front.jpg | CC0 | Face (late grille with bars, not modelled); the bonnet's shut lines on top of the wings. |
| `r1` | 2011 Lada 2110 grey rear.jpg | CC0 | Rear left 3/4: quarter glass behind the rear door's shut line, C pillar. |
| `r2` | 2004 Lada 21102 silver rear.jpg | CC0 | Rear left 3/4 close-up: **the fixed quarter glass is in the body**, framed in body colour, the C pillar wide and parallel to the back light. |
| `r3` | Lada 110 saloon rear.jpg | CC BY-SA 3.0 | Rear left 3/4: lamps, plate on the bumper. |
| `r4` | 2003 Lada 21102 black rear.jpg | CC0 | Rear right 3/4: corner lamps (smoked indicator over red), the lid's lamp bar (smoked cell at each end, red bar between), flap on the right. |

---

## 1. Side (drawing side view unless marked)

| Feature | Reading (px) | s, y (m) | Spec |
|---|---|---|---|
| Front bumper tip / rear bumper tip | x 618 / 1661 | 0 / 4.268 | `length` **4.265** |
| Front / rear hub | x 819.5 / 1428.5, y 336.5 | 0.825 / 3.317, 0.293 | `wheels.front` **0.825**, `rear` **3.317** |
| Bumper top at the face; bonnet's lip over the lamps | (628, 268); (646, 235) | 0.04, 0.575; 0.115, 0.708 | face station **s 0.09**, deck 0.715 |
| Front bumper | y 267.5–346 | 0.575–0.254; wraps back to x 740 (s 0.50) | moulded, sill 0.30, drop **0.08**, height **0.32** |
| Bonnet on the centre line | x 650 / 700 / 800 / 870 → y 222 / 205.5 / 182.5 / 169.5 | 0.13 / 0.34 / 0.75 / 1.03 → 0.76 / 0.83 / 0.92 / 0.98 | deck 0.77 / 0.83 / 0.89 / 0.99 at s 0.17 / 0.34 / 0.6 / 1.31 |
| Wing's top (bonnet shut line) | x 700 / 800 → y 215 / 190 | 0.34 / 0.75 → 0.79 / 0.89 | belt 0.79 / 0.85 at 0.34 / 0.6 |
| Windscreen on the centre line | (900, 166) → (1050, 80) | 1.154, 0.99 → 1.768, 1.342 | – (the flat screen stands on the side corners) |
| A pillar | (951, 169) → (1050, 81); at the belt (y 178) x 941 | 1.363 → 1.768; **1.32** at the belt | cowl column **1.31 / 1.768** |
| Front door, front shut line | x 941 at the belt, 930–935 below | 1.32; 1.277–1.297 | door frame column **1.325 / 1.785** (one vertical line) |
| Front door glass, front edge | (980, 159) → (1080, 82.5); at the belt x 956 | 1.385 at the belt | **1.385 / 1.83** (kept parallel to the pillar; the drawing's top 1.91 is the sail's line) |
| Belt (window sill) | x 951 / 1100 / 1290 / 1405 → y 178 / 177.5 / 171 / 163.75 | 1.36 / 1.97 / 2.75 / 3.22 → 0.941 / 0.943 / 0.970 / 0.999 | belt **0.94** (1.31), **0.955** (2.4), **1.0** (3.249), 1.01 (3.556) |
| Window tops / rail line / roof | y 79 / 71 / 60 | 1.346 / 1.379 / 1.424 | `rail` **1.379**, `glassTop` 0.035, `crown` **0.03** (+ rise 0.015 = 1.424) |
| Front door glass, rear edge | (1172.5, 173.75) → (1186, 79) | 2.269 → 2.324 | **2.269 / 2.324** |
| B shut line | (1187.5, 174) → (1201, 71); below the belt x 1183 | 2.330 → 2.386; 2.312 | body strip **2.32–2.34** above the belt, doors meet at **2.33** |
| Rear door glass, front edge | (1204, 174) → (1214, 79) | 2.398 → 2.439 | **2.398 / 2.44** |
| Rear door glass, rear edge | (1341, 80) → (1402, 164) | 2.959 → 3.208 | **3.205 / 2.96** |
| Rear door shut line (frame's rear edge) | (1355, 84) → (1412, 162.5); at the rail 1351 | 3.001 → 3.249 | **3.249 / 3.001** |
| Rear door below the belt [D crop at 4× and 12×; P s1 at 1.088 mm/px from the hubs] | upright at x 1413.75 down to y 210.2, then straight to (1326.9, 335) (dx/dy −0.696; points (1400, 230), (1375, 267.5), (1351.25, 300)). Upper turn: the drawing's bends from y ≈ 206 to 222 (r ≈ 0.12); the photo's from y ≈ 620 to 700 at x 3008 → 2980 (an 87 mm drop over a 31–35° turn: **r ≈ 0.17**). Lower turn into the door's bottom edge: the photo's spans ~12 px (**r ≈ 0.03**), the drawing's ~2 px | 3.256 to 0.809, then to **2.901, 0.299** | column 3.249 `foot` **{ y 0.805, s 2.90, round [0.17, 0.03] }** (the photo's radii): upright, a 0.17 turn from 0.858 down to 0.761, straight to a 0.03 turn into the door's bottom edge at 0.30, in front of the rear arch (3.029) |
| Back light at the side (C pillar's rear edge) | (1390, 82.5) → (1487, 157.5); at the rail 1385.5 | 3.141 → 3.556, 1.025 | last column **3.556 / 3.141** (`rearBase`) |
| Back light on the centre line | foot (1520, 156) | 3.691, 1.031 | – |
| Boot top | (1530, 158) → (1620, 162.5), corner to (1640, 175) | 3.73, 1.02 → 4.10, 1.005 → 4.18, 0.953 | deck **1.03 / 1.02 / 0.995** at 3.556 / 3.95 / 4.13 |
| Lid's rear face, lamps | face x 1640–1645; lamp y 200–241 | 4.18–4.20; 0.851–0.683 | tail station **4.20**, `bootEnd` **4.20** |
| Rear bumper | front edge x 1590; groove y 300–305; bottom y ~330 | 3.977; 0.42–0.44; 0.32 | moulded, sill 0.33, drop **0.055**, height **0.34** → 0.31–0.65 |
| Sill / door bottom / sill line | y 345 / 335 / 306–312 | 0.258 / 0.299 / 0.39–0.42 | sill **0.258**, `doorBottom` **0.30** |
| Front repeater | x 897–915, y 230–238 | 1.142–1.215, 0.696–0.728 | `repeater` **1.14–1.215, 0.696–0.728** [P s3: on the wing ahead of the door] |
| Front door handle | x 1130–1167, y 190–205 | 2.095–2.246, 0.83–0.89 | the generator's rule (2.14) |
| Mirror | x 975–1003, y 152–183 | 1.46–1.575, 0.92–1.05 | the generator's rule (1.405) |
| Fuel flap | x 1525–1573, y 210–238, drawn on the left | 3.711–3.908, 0.696–0.810 | **3.71–3.905, 0.70–0.81**, on the **right** [P s2, r4: the drawing is mirrored] |
| Feature line under the windows | every 40 px: x 680 / 720 / 760 / 800 / 840 / 880 / 960 / 1120 / 1280 / 1400 / 1480 / 1600 / 1640 → y 231 / 227.5 / 224 / 221.5 / 219.5 / 217.5 / 215.5 / 212.5 / 207.5 / 205.5 / 203.5 / 201.5 / 200 | s 0.25–4.18 → 0.724 / 0.741 / 0.753 / 0.763 / 0.771 / 0.78 / 0.788 / 0.80 / 0.82 / 0.829 / 0.837 / 0.845 / 0.851 | `featureLine` through [0.34, 0.735], [0.745, 0.763], [1.07, 0.78], [2.05, 0.80], [3.2, 0.829], [4.02, 0.845], [4.16, 0.85], 12 mm high, a 5 mm painted ridge |
| Head-lamp unit on the side | rear edge x 705 at its top, 692 at its foot; top y 232, foot on the bumper's top y 268 | s 0.356 / 0.303; 0.72 / 0.573 | `cornerLamps`: the unit round the corner and along the flank to **s 0.33, 0.59–0.72** |
| Front bumper on the side | wraps back to x 740 (s 0.50), the wheel arch; its foot the line the sill continues behind the arch | 0.254 at its foot | moulded `wrapTo` **0.47** (just ahead of the arch at 0.479), foot 0.255 against the sill's 0.258 |

### 1.1 Plan (top view)

Half widths of the widest outline (= `wCrease`):

| s | 0.09 | 0.17 | 0.34 | 0.6 | 1.0 | 1.4 | 1.8–2.8 | 3.2 | 3.53 | 3.86 | 4.02 | 4.10 | 4.18 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| half | 0.634 (bumper corner) | 0.702 | 0.759 | 0.802 | 0.808 | 0.820 | 0.825 | 0.810 | 0.792 | 0.755 | 0.730 | 0.714 | 0.673 |

Spec `wCrease`: 0.665 (face), 0.705, 0.735 (s 0.25), 0.76, 0.80, 0.82, 0.825, 0.81, 0.792, 0.745, 0.715, 0.69. At the lamps' height the nose is narrower and rounder than the widest outline (which is the bumper's corner there): the top view's line along the lamps' top is at ±0.597 at s 0.13 and the face's lamps end at ±0.60 (front view), so `wBelt` is **0.585 / 0.655 / 0.69 / 0.715** at s 0.09 / 0.17 / 0.25 / 0.34. Side glass at its foot ±0.73 (top-view line, constant along the cabin) → `wBelt` ≈ `wCrease` − 0.045 along the cabin, shoulder `inset` **0.04**. Roof: lines at ±0.50 / ±0.54 → `railHalf` **0.53**, `railInset` 0.035. Front view: widest at y 0.626 → `crease` 0.62–0.66.

The front bumper in plan [D top view]: ±0.336 at s 0.008, ±0.634 at s 0.09, so it is flat across about ±0.33 and turns round a large corner: moulded `corner` **0.28** (the other cars' 0.09).

### 1.1a Bonnet [P f2, f3, f1; D top and front views]

The 2110's bonnet covers the whole top: on the photos (`f2` white, `f3` green, front 3/4s) its side shut lines run along the wings' top edge from the head lamps' outer ends back to the A pillar's foot, its front edge lies over the lamps, and its nose comes down the face between the head lamps to their bottom. The drawing's top view agrees: a line 0.035 in from the outline from s 0.5 to the screen (±0.747–0.767 at s 0.50–0.91 against the outline's ±0.79–0.80), at the shoulder. The other pair of lines on top, ±0.29–0.34 from s 0.2 to 0.925, run down the face in the front view to ±0.28 at 0.60 between the lamps' inner ends: they are the bonnet's raised centre and its nose, not shut lines (the previous build read them as a narrow bonnet; corrected here).

Spec `bonnet` **{ inset 0.01, nose { y 0.60, half [0.278, 0.298] } }**, `bonnetFront` **0.09** (the face): the cut runs 10 mm in from the deck's edge from the face to 12 mm short of the cowl (`SCUTTLE`); the nose is the face between ±0.278 at 0.60 (front view: ±0.279 at y 261.7 → 0.599) and ±0.298 at the bonnet's lip (the lamps' inner ends 0.283 / 0.303 stay on the body), and the slot rides on it (`front.lid`). The engine bay's inner wings follow the cut.

### 1.2 Wheel arches [D, P s1]

| | Drawing | Photo `s1` | Spec |
|---|---|---|---|
| Front arch top | 0.663 (1.26 R above the hub) | 320 px over the hub, tyre ≈ 277 px: 1.15 R | `arch` **1.2** |
| Rear arch | flat-topped at 0.479 from s 3.16 to 3.53 (0.65 R over the hub), down to 0.34 at ±0.32 | top 215 px over the hub, tyre ≈ 265 px: **0.81 R**; at the hub's height the arch is 1.0 R wide | `rearArch` **1.0** (half width), `rearArchRise` **0.81** (top 0.521): a half ellipse |

The drawing's rear arch is stylised (flat top); the photo's is round, tighter than the front and covering the tyre's top. A circle on the hub cannot be both 1.0 R wide at the hub and 0.81 R high, so the rear arch's skin and liner are a half ellipse 1.0 R wide and 0.81 R high (`WheelSpec.rearArchRise`); the wheel-house walls, humps and boot shelves inside keep the 1.0 R circle so they clear the tyre.

### 1.3 Rear quarter glass and C pillar [P r1, r2, r4]

The drawing fills the C pillar in body colour with no glass. Every rear photo shows behind the rear door's shut line (which runs unbroken from the sill to the rail) a body-colour frame, a fixed quarter glass narrowing to a point at the top, and a wide C pillar parallel to the back light. On `r2` at the belt: frame ~2 %, glass 64 %, pillar 35 % of the shut line → back light span; at the rail the glass is almost nothing.

Spec on the drawing's lines (shut line 3.249 / 3.001, back light 3.556 / 3.141): body frame **3.249–3.27** (top 3.001–3.015), fixed glass to **3.456 / 3.041** (0.186 at the belt, 0.026 at the rail), C pillar **0.10** wide, the same at the belt and the rail (parallel to the back light).

## 2. Face (drawing front view; photos `f1`, `s3`)

| Feature | Reading | Spec |
|---|---|---|
| Head lamp, inner end | x 220 bottom / 216.7 top → 0.283 / 0.303 | first `cornerLamps` point `x` **[0.283, 0.303]** (leans out at the top) |
| Head / indicator joint | 0.604 bottom / 0.596 top: the face's edge at lamp height (the nose rounds there) | the head lamp runs to the corner |
| Unit's outer end | 0.738 / 0.724, wrapping round the wing back to s 0.30–0.36 [D side]. On the photos the indicator is a clear lens over a reflector with the amber bulb behind [P f1, f3]; the owner's reference shows it solid amber, which is what is drawn | `cornerLamps` points: head from 0.283 / 0.303 to the corner (y 0.606–0.70); amber (`blinker`) from the corner to its end at s 0.33 (y 0.59–0.72) |
| Lamp heights | y 260 → 0.606; top 230–237 → 0.70–0.72 | 0.606–0.70 on the face (the top kept under the belt, 0.70), 0.59–0.72 at the flank end |
| Between the lamps | body colour; a dark slot under the bonnet's lip [P f1] (the late cars' barred grille [P f2] not modelled) | on the bonnet's nose (`front.lid`): grille ±0.27, `deck` − 0.075 to − 0.015, two black bars |
| Bumper top / bottom | y 270 / 345 → 0.565 / 0.258 | 0.575 / 0.255 (side view) |
| Lower intake cells | x ±0.287, y 313–333 → 0.39–0.31 | grille ±0.287, `bumperBottom` + 0.055..0.135, `standOut` 0.07 |
| Fog-lamp recesses | x ±0.303..0.476, y 316.7–336.7 → 0.373–0.292 | black `panel` pair, `bumperBottom` + 0.037..0.118 (most cars have blanks [P f1, f2, s3]) |
| Bumper finish | body colour [P f1, f2, s3] | `finish: 'paint'` |

## 3. Tail (drawing rear view; photos `r4`, `r2`, `r3`)

| Feature | Reading | Spec |
|---|---|---|
| Back light | bottom 1.008, half 0.569; top 1.314, half 0.487 | the generator's, between the C pillars |
| Boot lid's side edge at the tail | ±0.569 at the lamps' top, ±0.487 at its foot | `notch` **0.52** (the mean): the lid's cut on the tail face at the lamps' top, its foot 25 mm in (`NOTCH_WALL`); on top the cut runs from ±0.57 at the trailing edge (4.13) in to ±0.52 |
| Lid's foot between the lamps | y 723 → 0.655 | tail station `deck` **0.655** |
| Lamps | y 680–723 → 0.831–0.655; corner units from the lid's edge out round the corner and 0.14 forward along the wing [P s1: 123 px at 1.085 mm/px] | tail `belt` 0.815; rear `cornerLamps` (`end: 'rear'`) from x 0.505–0.53 (the lid's slanted edge, 10 mm clear) round the corner to s 4.06–4.075, their top at the belt **0.815** (not the drawing's 0.831) so the lens stays on the flat face and side; the shoulder above is a straight cut |
| Corner lamp cells [P r4, s1: smoked 76 px over red 62 px] | smoked (indicator) over red | blinker 0.743–0.815 round the corner; below it brake from the lid's edge to x 0.518, tail from there round the corner, 0.655–0.743 (tail/stop split [INFERENCE]) |
| Lid's lamp bar [P r4, r2] | a smoked cell at each end, one red bar across the middle (one piece across the centre line) | lid cluster `centre 0.51 → 0.40` `['reverse']`; lid lens `inert` `{ at: centre 0, half 0.395 }`, built once across the centre line |
| Rear bumper | top just under the lamps; groove at 0.41–0.43; bottom 0.307; plate on it [P r3, r4] | moulded, body colour, 0.31–0.65 |
| Widest | y 720 → 0.667, 408 px | tail `crease` 0.66 |

## 4. Dashboard (`CABIN_2110`, interior.ts)

Commons was searched through the API and every file in the VAZ-2110/2111/2112, Lada 110/111/112 (and 21106/21108/21109, 110 in competition) categories was looked at (363 files); two show the 2110 family's early (1996–2007) dash, none is a drawing:

| Photo | Licence | Shows |
|---|---|---|
| Sporty Lada - Flickr - SergeyRod (3).jpg (Sergey Rodovnichenko, 2004) | CC BY-SA 2.0 | a Lada 112 Cup car's stock dash from behind the driver's seat; **main source**, 1600 × 1200 |
| 2005Lada111Interior.JPG (Qashqai, 2009) | CC BY-SA 3.0 / GFDL | a 2005 Lada 111: cluster hood with two rockers, centre vents, heater panel (two knobs, hazard top right), clock panel, 1-DIN radio in the lower bay |

**Scale:** the stack's bays are 1-DIN (182 mm) = 215 px across → 0.85 mm/px; 0.9 mm/px up the stack (the face leans back). Cluster at about the stack's distance from the camera, so the same scale (±15 %). Heights hang from the Samara cluster's height (dials 0.015 over the belt): no photo shows the belt [E].

| Feature | Photo (px) | Layout |
|---|---|---|
| Tachometer / speedometer centres | (750, 215) / (855, 217), numeral ring r ≈ 45 px | big dials swapped (tacho left) at ∓0.044, radius 0.037 |
| Small dials | right (937, 242), r ≈ 22 px; left hidden (mirrored) | ±0.11, up −0.01, radius 0.0185 |
| Hood | lip top y 92, half 208 px | `binnacle` half 0.175, lip 0.115–0.13, top 0.14 |
| Rockers on the hood's flanks | x 972, y 155 / 197 (fog lamps, rear screen heater) | two rockers right; the light switch mirrored left |
| Centre vents | openings x 1057–1195 / 1197–1312, y 267–355 | two vents ±0.056, half [0.05, 0.038]; end vents half [0.04, 0.04] |
| Heater panel and knobs | x 1015–1265, y 418–520; knobs (1092, 472), (1175, 472), r ≈ 30 px | new `heater` field: dy −0.215, half [0.105, 0.046], knobs ±0.035, radius 0.025; hazard [−0.085, −0.2] |
| Stack | x 1000–1275 | half 0.115; radio −0.35 (lower bay), ashtray −0.42 |
| Glovebox lid | left edge x 1400, y 440–690 | x −0.24..−0.58, dy −0.185..−0.335 |
| Fascia | the face leans back 13.5° | [0.378, −0.02] → [0.455, −0.34] |
| Wheel | pad frame meets the rim 41.5° over / 59° under the driver's left | two spokes at −40° / 220°, rim 0.011; size and position the Samara's |

New optional `Layout` fields (absent on every other dash, proved by hashes): `vents[].half` (the opening's size; the default reproduces the old slats exactly) and `heater` (a black panel with chrome-ringed knobs, `trim` and `chrome` slots only).

### 4.1 Dash massing, door card, stalk (owner's review with the 2112, 2026-10-15)

The owner, sitting in the 2112: the dash covers the closed doors' handles and winders and the knees; the wiper stalk cannot be worked.

| Source | Shows |
|---|---|
| SergeyRod (3) above, crop x 150-850, y 100-800 (`/tmp/cabin2110/ph/sp3_left.jpg`) | The driver's door past the end vent's pod: its inner handle level with the vent, and the door's panel open below the pod down to the floor; the knee panel under the column only. |
| vaz-rukovodstvo.ru 8-10 "Снятие обшивки передней и задней двери" (repair manual photos `15-obivdvaz.jpg`, `23-obivdvaz.jpg`) | Front door card with the armrest grip off: the inner handle's lever through the grip's top (step 5: "выведя ручку замка из отверстия ручки подлокотника"), the crank's shaft below it, the pocket and speaker at the bottom. |
| vaz-rukovodstvo.ru 8-15 "Снятие приборной панели" (`0snpanel-13vaz.jpg`, `0snpanel-20vaz.jpg`) | The dash's lower ends stand forward at the kick panels (the fuse block's housing over the bonnet release on the left). |
| Parts catalogues: oximo.com.ua, 2dvornika.com.ua, akb.ru, avtoskazka.com (part 2110-5205070) | Wiper blades 500 mm driver's and passenger's [F]. |

Door card [P manual 15, read on a door seen at a slant, so a little further back than drawn]: the card spans x 165-1050 at the belt (front edge at 1050), the belt at y 225, the door's bottom at y 790. Inner handle (x 735-845, y 330): **29%** of the length behind the front, **19%** of the height under the belt; crank shaft (865, 530): **21%** behind, **54%** down. On the 2110's 1.0 m card, 0.64 m tall: `frontDoor` handle **[0.30, -0.12]**, crank **[0.22, -0.35]** (was 0.13 / -0.085 and 0.35 / -0.35, the generator's rule).

Dash (`dashLoft`, sections ds, dy as `dash`):

| | Before | After | Source |
|---|---|---|---|
| Over the glovebox and the stack (x -0.93 to 0.2 of the half width, + = driver's side) | face to -0.34 at ds 0.455, underside -0.37 / -0.38 | unchanged (`DASH_2110`) | glovebox lid's foot -0.41 [P] |
| Before the driver (x 0.55-0.93) | the same | face to **-0.29** at ds **0.443** (on the same 13.5° face), lip -0.315, underside **-0.33**, firewall -0.30 (`DASH_2110_DRIVER`) | knee panel's foot y 555 → -0.29 [P] |
| Ends (x ±1, the last 4.7 cm of the ±0.669 half width) | the full section, 0.378-0.455 deep | top to ds 0.255, face 0.262-**0.275** down to **-0.14**, underside to (0.10, -0.33) (`DASH_2110_END`) | door past the pod, open below it [P]; lower ends forward at the kick panels [P manual]; depth [E]: the handle at 0.30 must show past it |
| End vents | ±0.599 (half width - 0.07) | **±0.58** | read 0.617 (302 px outboard of the column at 0.85 mm/px, ±15%), kept on the full face inside the caps |

From the driver's eye (headless rays at the part's vertices, first hit): inner handle levers 0/36 → 24/36 (driver's), 0/36 → 14/36 (passenger's); cranks 135/204 → 199/204 (driver's), 36/204 → 0/204 (passenger's: now 0.13 further forward, behind the glovebox's end); wiper stalk 128/168 before and after (the 2107's 121): its geometry was never the problem (the pick refused its control id, HISTORY.md).

Wipers [F, generator]: blades **0.50** (was 0.51). No arm parks within 20° on the screen curved in plan, so the fit falls back to 45°; there the arm that parks lowest is now taken. Driver's arm reach 0.619 → **0.583**, its parked tip 0.191 → **0.084** over the spindle (passenger's 0.071); sweep 100° / 96°.

## 5. Generator changes

All optional; absent, a car builds exactly as before.

1. **`WheelSpec.rearArch`** (`BodyFrame.archFactor(axle)`): the rear arch's own half width over the tyre radius. Every user of the arch radius goes through it: `archY`, the tub's arch columns and wheel wells (body.ts), the wing and boot shelves (bay.ts), the sill strip's ends and the flank strips' arch cuts (exterior.ts), the floor's end, the side panels and the rear wheel-house covers (interior.ts).
2. **`WheelSpec.rearArchRise`**: the rear arch's skin and liner are a half ellipse `rearArch` wide and this high (`archY`); the wells, shelves and humps inside keep the circle and clear the tyre.
3. **`CabinColumn.foot`** `{ y, s, round? }`: below the belt the shut line on the column runs upright to `y`, then straight to `s` at the doors' bottom; `round` rounds its two turns (`BodyFrame.shutLine`, four segments each). Every point of the line is a side cut row (`sideCutRows`), and every side face above the doors' bottom row that the line crosses is clipped into two along it (`clipPolygon`); each piece takes the owner of the strip on its side of the column. The cut then gives the gap, the jamb, the door's return and its card along the line as along any other; inside, the body's piece behind the line gets upholstery trim (interior.ts `rakeTrim`).
4. **`KitCarSpec.bonnet`** `{ inset, nose? }`: between `bonnetFront` and `bonnetRear` (the cowl less a 12 mm scuttle) the deck's pillar row becomes the bonnet's cut, `inset` in from the deck's edge (`BodyFrame.bonnetX`, `deckFracs`); a tub column is added at `bonnetRear`; the bay's inner wings stand under the cut. `nose`: on the front face the deck's half row is the nose's top corner, the face goes round the nose and the nose is a bonnet face; `FaceLook.lid` items on the front face ride on the bonnet (exterior.ts `buildLidFace`).
5. **`KitLook.cornerLamps`** (`CornerLamp`, exterior.ts `buildCornerLamps`): a lamp unit from its inner end on an end face (`end`: front by default, or rear), round the corner and along the flank, a thin lens 4 mm off the body with a rim down to it, every stretch between points in its role's slot, stepping every 20 mm along the flank on the skin as built (body.ts `skinX`: the outer of a face's two diagonal splits between tub columns and side rows, so the lens never sinks in). Replaces the earlier `flankLamps`, the face `lens` items of the 2110 and 2115 head lamps and their rear corner clusters.
6. **`KitLook.featureLine`**: a 5 mm painted ridge through its points, on the waist moulding's strip builder (`buildFlankStrip`, which the waist now also uses), broken at the shut lines and riding on the doors.
7. **Moulded bumper `corner`**: the plan radius where the bumper turns round to the flanks (`bumperPath`'s `r`, 0.09 by default). **`wrapTo`**: its sides follow the flanks to this s, 6 mm outside the body at the bumper's top height (`flankBumperPath`, five points a side), so the side lies on the wing and its foot runs on as the sill's line.
8. **A lens centred on the centre line** (`x: { at: { centre: 0 }, half }`) is built once across it, not as two halves. No existing lens is centred on 0.
9. **Lid face on a notched tail** (`BodyFrame.lidFace`; a fix for the 2115 as well, HISTORY.md): where the boot lid comes down the tail (`bootEnd` on the last station, which carries a `notch`) the tub's deck rows on that station all stand at the corners' top, so the lid's top turns down to a straight line across at the lamps' top in flat faces; below that line the lid's rear panel is laid in the tail face between the lamps (a triangle down the notch wall and a quad to the foot each side), sharing every edge with the tail face. Before, the lid's rear face bridged straight to the stepped notch outline and folded.

**Proof.** Every kit car was built from cfff462 in a `git worktree` and from the working tree; all triangles in the car frame rounded to 1e-5 m, sorted and hashed. 2101–21099 (ten cars) are identical in hash, triangle count and bounds after every change listed here. The 2115 changed by changes 5 and 9 only (its lid and its head lamps: 12 092 → 12 136 triangles, bounds unchanged).

## 6. Result

`kit_vaz2110`: **14 775 triangles** (body + trim 7 509, cabin 3 927, bay 1 307, boot 56, underbody 632, wheels 1 344; 8 853 beyond 25 m); the rounded shut line's points are side rows on every tub column (nine in place of one). The owner set the triangle budget aside for this car. Bounds ±0.935 (mirrors) × 0.170…1.424 × ±2.138 m. Lowest point 0.170 (the fuel tank); the front floor under the engine is 0.275 so the sump clears it.

Lab after the third review (`/tmp/vaz2110/lab4/`): the lid corners from the owner's angles (`lid_2110_left_c.png`, `lid_2115_right_c.png`), the boot open (`boot_open_2110_c.png`, `boot_open_2115_c.png`), the lamps flush and wrapping (`corner_close_c.png`, `corner_close_2115_c.png`, `front34_2110_c.png`, `front34_2115_c.png`, `front_2110_left_c.png`), the side on the drawing (`ov_side.png`, `ov_front.png`: the bumper's side runs to the arch on the drawn line), lamps at night with the hazards (`night_kit_vaz2110.png`, `night_kit_vaz2115.png`); 15 WebGL programs linked after boot and still 15 after showing, opening and lighting both cars.

Lab after the fourth review (`/tmp/vaz2110/lab6/`): rear corners of the 2110 and 2115 (`rear_kit_vaz2110.png`, `rear_kit_vaz2115.png`, `after_rear.png` against `before_rear.png`), the Samaras' raked faces (`after_front.png`), lamps at night with hazards, brake and reverse on the 2108, 2110 and 2115 (`night.png`); 15 programs after boot and still 15 after opening every part and lighting the three cars.

Lab (`/tmp/vaz2110/lab2/`, and `/tmp/vaz2110/lab3/` for the bonnet and the rounded door edge): the side capture overlaid on the drawing (`lab3/ov_side.png`, `lab3/rdoor_vs_drawing.png`) lies on its lines from bumper to bumper, the rear door's rounded raked edge and the lowered rear arch included; front 3/4 (`lab3/f34_c.png`, `lab3/f34_right_c.png`), rear 3/4 (`lab2/r34_c.png`); the bonnet whole-width, its nose with the slot lifting with it and the bay under it (`lab3/bonnet_open_c.png`, `lab3/bonnet_open_front_c.png`, `lab3/bonnet_closed_front_c.png`); the rear door closed and open with the trim behind its edge (`lab3/rdoor_closed_c.png`, `lab3/rdoor_open_c.png`); every door, boot and flap open and close (`lab2/open_*`); the dash (`lab2/dash.png`); lamps at night (`lab2/night_hz.png`); the 2115/2110 lid before and after (`lab2/lid_compare_*.png`). No WebGL program linked when the 2110 is focused, opened, lit and dirtied after boot (15 links before and after).

Owner's review round with the 2112 (`/tmp/vaz2112/draft2/` … `draft4/`):
- **Screen and A pillar [D side view].** The screen's foot on the centre line at (1154, 0.994): `screenFoot` **0.156** ahead of the cowl (1.31). The drawn pillar runs from 1.32 at the belt to 1.338 high at 1.768 and rounds into the roof by 1.85 at the rail's 1.379: the A pillar column top **1.77** with `drop` **0.037** (its top point 1.342), the door frame's and glass's tops moved back to **1.85 / 1.89** to meet the chamfer (overlay `draft3/ov_apillar.png`).
- **Nose.** The face at the bumper's top: first station **s 0.04** (was 0.09), `bonnetFront` 0.04, `frontLean` base **0.58** (the crease row) lean **0.586** (to the drawn lip 0.708 at s 0.115) blend **0.6** full **0.2** (the indicator's end). The bumper's top at the drawn **0.565** (height 0.345), below the lamps' 0.606; `flush`. The indicator ends at s **0.2**, 0.62–0.70 there. Fog recesses `proud` 0.045 and intake `standOut` 0.02 so they stay inside the tip.
- **Bonnet.** Deck and wing top at s 0.6 put on the straight line from s 0.34 to the cowl: **0.873 / 0.83** (drawn 0.89 / 0.85); the bonnet reads as one slope.
- **Rear bumper** `flush`, `wrapTo` **3.63** (the rear arch's front 3.605).

## 7. Gaps

- **Variant:** the base early 2110 (1996–2003 "21100 / 21102"): slot grille, no boot spoiler, no door mouldings [P f1, s1 without; s2, s3, r1, r2 show both on other trims]. The late barred grille (2007+) is not modelled.
- **Lamps:** where the nose's skin twists between the face station and the next (the lamp top's corner leans in from 0.648 to 0.585), the lens follows a small twist. The smoked rear cells are drawn amber (indicators); the rear fog lamp is not modelled. The lid's side edge on the tail face is the generator's 25 mm wall, not the drawing's 82 mm slant.
- **Bonnet:** the cut follows the deck's edge 10 mm in, but the model's shoulder (40 mm) stays on the body, so a narrow strip of wing top shows beside the bonnet that the car does not have; the nose's sides are straight.
- **Rear door:** the trim behind the raked edge is a flat lining, no pocket or speaker.
- **Dash:** heights hung from the Samara's cluster (no side view of the dash), the left of the cluster placed by symmetry, the wheel's size unmeasured; the end caps' depth is an estimate (the handle must show past it), and the passenger's lower half keeps the -0.34 face (the glovebox lid's foot is lower, -0.41); not drawn: the vent pod's frame and slider, the clock panel, the ignition-lock boss, the armrest grip around the inner handle.
- **Triangles:** 14 775, above the 8–13k of the other cars (set aside by the owner).
- Licences of the photos are as listed; the CC BY-SA ones were used for reading only.

## 8. VAZ-2112 (`BODY_2112`, `LOOK_2112`)

### Sources

| Source | Use |
|---|---|
| autoopt.ru (encyclopedia, VAZ-2112) [F] | 4170 × 1676 × 1430, base 2490, tracks 1400 / 1370, 175/70 R13 – 175/65 R14. Spec row `kit_vaz2112` = 4.170 × 1.680 × 1.430 with the 2110's width, wheelbase (2.492), clearance and tyre (same stampings and running gear). |
| 3dcar.ru `vaz_2112.jpg` (1700 × 1000, saved) [D] | Side view, **3.98 mm/px** from the drawn wheelbase: hubs x 815 / 1441, ground y 410. Its nose and doors lie on the 2110 drawing's when overlaid on the wheels. |
| Commons "LADA 112 in Togliatti rear" (CC0) [P] | Straight rear view: lamps ±0.50..0.68, reversing cells ±0.32..0.50, red bar ±0.32 (plate 520 mm). |
| Commons "2008 Lada 211240 dark purple rear" (CC0) [P] | Rear 3/4: the D pillar, the lamps wrapping onto the wing, the wing on the tailgate's glass. |
| Commons, other 2112 rears (CC0 / CC BY) [P] | `2005 Lada 21121 dark blue rear`, `2005 VAZ 21124 purple rear`, `2006 Lada 21124 grey rear`, `2007 Lada 21124 blue rear`, `2007 VAZ 21124 beige rear`: the spoiler on most, the same lamp layout. |

### Tail [D side view; P rear]

| Feature | Reading | Spec |
|---|---|---|
| Body to the rear door | the 2110's | `BODY_2110.stations.slice(0, 9)`, columns `slice(0, 11)` |
| Quarter glass's rear corner on the belt | x 1540, y 148 | column **3.71** (top 3.26) |
| Roof's rear end | x 1433, 1.333 on the outline | last column top **3.285** |
| D pillar's foot | – | station **3.95**: belt 0.99, deck 1.0 |
| Tail face / tailgate's foot | lamps y 232.5–192.5 → 0.71–0.865 | station **4.1** `flat`: belt 0.865, deck 0.71; tailgate cut ±0.545 (photo ±0.50) |
| Knee | over the lamps | `rearKnee` **{ s 4.095, y 1.0 }**; `rearLean` base 0.71, lean 0.2, blend 0.3 |
| Corner lamps | 0.715–0.86 | blinker 0.79–0.86 over tail/brake 0.715–0.79, from x 0.555 round to s 3.92 |
| Tailgate lamps | reversing ±0.36..0.535, red bar ±0.355 | `rear.lid` at the belt − 0.15 … − 0.005 |
| Spoiler | leading edge on the glass at s 3.858, 1.095; top 1.07 | `spoiler` half 0.56, s 3.915–4.155, top 1.095 → 1.075, lamp 1.008–1.032 |
| Rear bumper | tall, body colour | moulded drop 0.055, height 0.39, `flush`, `wrapTo` 3.63 |
| Flap | x 1473–1520, y 200–232 | s **3.45–3.64**, y 0.71–0.83 |

### Result

`kit_vaz2112`: **14 705 triangles** (body + trim 7 539, cabin 3 833, bay 1 307, boot 50, underbody 632, wheels 1 344; 8 883 beyond 25 m), bounds ±0.935 × 0.170…1.424 × ±2.091. Lab (`/tmp/vaz2112/draft*/`, `final/`): the side overlay on the drawing, front and rear 3/4, the tailgate and spoiler open and closed, lamps at night (`final/night.png`), 15 programs after boot and after exercising.

### Gaps

- The tailgate's opening between the lamps is ±0.545 (photo ±0.50): the narrowest the flat tail cut gives without a new field.
- The flap stands where the drawing has it; not checked on a right-side photo.
- The reversing cells are white, not smoked; the high brake lamp shares the brake slot.
