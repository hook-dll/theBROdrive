# VAZ-2121 and VAZ-2131 Niva: measured numbers

Crops, gridded readings, photos and lab captures are in `/tmp/niva/` (photos in `ph/`, captures in `shots/`), local only.

Frame and tags as in `measurements-classics.md`:
- **Body:** `s` rearward from the tip of the front bumper, `y` above the ground; mm in the tables, metres in the spec.
- **Faces:** `x` is a half width from the centre line.
- **Tags:** **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate (reason given).

The Niva shares no stampings with the classics or the Samaras, so it is its own family: `BODY_2121` / `LOOK_2121` in `nivas.ts`, `platform: 'niva'` (the classic's longitudinal engine and cabin with permanent four-wheel drive and its own dash). The car measured is the early 2121 (1977–1993): round head lamps, aluminium bumpers, vent wings in the doors.

## 0. Sources and scales

### Factory figures [F]

| Figure | Value | Sources |
|---|---|---|
| Length × width × height | **3720 × 1680 × 1640** | infocar.ua (https://vaz-2121.infocar.ua/price_niva-2121_id316.html); ru.wikipedia (via wp.wiki-wiki.ru/wp/index.php/ВАЗ-2121) and catalog-vaz.ru (https://www.catalog-vaz.ru/cars/vaz-2121-niva/tth/) give a length of 3740 |
| Wheelbase | **2200** | infocar.ua; ru.wikipedia |
| Tracks front / rear | **1430 / 1400** | infocar.ua; ru.wikipedia (21214: 1440 / 1420, which catalog-vaz.ru gives for the 2121) |
| Clearance | **220** | infocar.ua; ru.wikipedia; catalog-vaz.ru gives 205 |
| Tyres, rims | **6.95-16 (bias) or 175/80 R16 (radial)**, 5J-16 | niva-faq.msk.ru (https://www.niva-faq.msk.ru/tehnika/obsch/tehdann/213_312.htm, the factory data sheet); 175/80 R16 = 0.343 m free radius |

The existing `FACTORY_GEOMETRY.sv_niva` row (3.720 × 1.680 × 1.640, clearance 0.220, wheelbase 2.200, tracks 1.430 / 1.400, radius 0.343, tyre 0.175) agrees with these figures; a `kit_vaz2121` row can copy it.

### Drawing (`build/carshape/_refs/bp/img/niva.jpg`)

`file`: JPEG, 1800×1200. A factory four-view under a 3dcar.ru watermark, undimensioned: side view top right (car facing left, the left side), front view top left, rear view bottom left, plan bottom right (nose left).

| View | Scale | Registration |
|---|---|---|
| Side | **3.632 mm/px** from the drawn wheelbase: hub centre lines x 880.5 / 1486.3 (dash-dot lines; hub rings symmetric about y 431.5), ground y 522 (top of the ground line). | s = (x − 691)·0.003632, y = (522 − y_px)·0.003632. Tips x 691 / 1719 → **3733** overall (3720 / 3740 [F]); roof y 87 → **1.580** (passport 1640: the drawing stands 3.7 % low, as the classics' drawings do, and its tyre 0.329 against 0.343 free is the same 4 %; the loader fits the height). |
| Front | same scale: tyres x 141–187 / 535–581 → track 394 px = **1431** (1430 [F]); centre x 361.5; ground y 522.5 | Heights by the side view's formula. Bumper 369–401, matching the side view's 370–402. Its roof (y 80, 1.605) reads 7 px higher than the side view's: windscreen header from the side view instead. |
| Rear | same scale: tyre centres 167.5 / 550 → **1389** (1400 [F]); centre x 360; ground y 1047.5 | y = (1047.5 − y_px)·0.003632; roof 1.589 against the side's 1.580. |
| Plan | tips x 690 / 1724 (1034 px): s = (x − 690)·0.003610; half widths by 0.003632 from the centre y 876.5 | Agrees with the side view within 5 px at the ends. |

### Photos (Wikimedia Commons, 1600 px renditions, in `/tmp/niva/ph/`)

| Local | Commons title | Licence | Used for |
|---|---|---|---|
| `p13` | Moscow car meet 2025-07-12 VAZ-2121 02.jpg | CC0 | A 1982 car, front right 3/4: the face (black grille panel with ten bars in a thin chrome outline, round lamps in it, corner units amber outer / clear inner in black surrounds), the bonnet's edge between the corner units, the bumpers (bare aluminium over black, black end caps), the vent wing post in the door, the amber repeater on the wing, chrome handle and mirror, head restraints, the tan rear seat. |
| `p14` | Moscow car meet 2025-07-12 VAZ-2121 July 2025 01.jpg | CC0 | The same car, rear right 3/4: **the fuel flap on the right rear wing just behind the door**, the tailgate ending at the lamps' top, the tail lamp cells (amber outer; red over white over red; red; a black inner block), the rear bumper. |
| `p00` | 1983 Lada Niva in Orange, front left (Brooklyn).jpg | CC BY-SA 3.0 | Corner unit (clear inner, amber outer), repeater, black dash; a neighbouring Niva's cream head restraint; the left door mirror on its rod (§1.5). |
| `p15` | 1990 Lada Niva 1.6.jpg | CC BY-SA 4.0 (User:Vauxford) | A 1990 car, front right 3/4: the right door mirror on its rod (§1.5). 1280 px renditions of `p00`, `p13`, `p15` in `build/carshape/_refs/photos/niva/web/`. |
| `p10` | 2025 LADA 4Х4 side.jpg | CC0 | A near-side shot of the current car (same body): door 0.99 m (335 px over 742 px for the wheelbase), the arch taller than it is wide (opening ±0.40 at the hub, top ~0.48 over it), the flank crease, the repeater at the front corner. |

---

## 1. Side (drawing side view unless marked)

| Feature | Reading (px) | s, y (m) | Spec |
|---|---|---|---|
| Front / rear bumper tip | x 691 / 1719 | 0 / 3.733 | `length` **3.733** |
| Front / rear hub | x 880.5 / 1486.3, y 431.5 | 0.688 / 2.888, 0.329 | `wheels.front` **0.688**, `rear` **2.888** |
| Tyre | radius 90.5 px (hub to ground) | 0.329 | `radius` **0.33** (175/80 R16 free 0.343 × the drawing's 0.963) |
| Front bumper | y 370–402; front x 691, wraps back to x ~770 | 0.556–0.439 | blade **height 0.117**, centre 0.4975 |
| Face | upright at x 723–735 (grille panel 723, lamp units 733–745) | 0.116–0.16 | face station **s 0.15** |
| Bonnet's lip, wings' top at the face | (745, 252) top; (735, 260) / (735, 280) | 0.196, 0.981; 0.16, 0.946 / 0.879 | face deck 0.965, belt 0.93 |
| Bonnet centre (top line) | x 760 / 780 / 800 / 830 / 860 / 900 / 940–980 / 1000–1020 → y 248.5 / 244.5 / 242.5 / 239.5 / 237.5 / 235.5 / 234.5 / 231.5 | s 0.25 / 0.32 / 0.40 / 0.51 / 0.61 / 0.76 / 0.90–1.05 / 1.12–1.20 → 0.993 / 1.008 / 1.015 / 1.026 / 1.033 / 1.040 / 1.044 / 1.055 | deck 1.0 / 1.033 / 1.05 at s 0.28 / 0.6 / 1.152 |
| Wings' top (bonnet's side shut line) | x 760 / 780 / 830 / 860 / 900 / 940–1030 → y 260 / 254.5 / 250 / 248.5 / 246.5 / 245.5 | 0.951 / 0.971 / 0.988 / 0.993 / 1.000 / 1.004 | belt 0.96 / 0.993 / 1.005 at s 0.28 / 0.6 / 1.152 |
| Flank lines | y 277–280 and 290–292, nose to tail | 0.879–0.888 and 0.839 | `crease` **0.87** (the upper, sharp line) |
| A pillar's front edge | (1118, 120) (1098, 140) (1079, 160) (1062, 180) (1047, 200): slope −0.8875 px/px; at the belt (y 244) x 1008, at the rail (y 110) x 1127 | 1.152 / 1.583 | cowl column **1.152 / 1.583** |
| Door frame up the pillar (thick seal line) | (1133, 120) … (1053, 220), at the belt ~1034 | 1.246 at the belt | column **1.236 / 1.65** (kept near parallel to the pillar: the drawn lines converge into the roof's rounded corner) |
| Vent wing front edge | (1126, 140) (1109, 160) (1094, 180) (1079, 200) (1065, 220) | 1.58 at 1.387, 1.41 at 1.17 | vent from **1.266 / 1.68** (the spec's line gives 1.587 at 1.387) |
| Vent wing rear post | upright x 1156–1162, y 120–233 | 1.689–1.711 | post **1.685–1.705** |
| Front door, front shut line below the belt | upright x 1055, y 245–395, rounded into the bottom | 1.322 | column **1.322** (body ahead of it below the belt) |
| Door glass rear edge, frame, B shut line | x 1312 / 1316 / 1323 | 2.255 / 2.270 / 2.295 | **2.255** (glass), **2.295** (frame / B pillar) |
| Door's rear shut line below the belt | upright x 1329, y 242–380, then rounded (r ≈ 20 px) forward into the bottom at (1310, 402) | 2.317; corner r ≈ 0.07 | column **2.317**, upright (the corner's rounding left out) |
| Door bottom | y 403–405 | 0.428 | `doorBottom` **0.428** |
| Sill | dark band y 409–417 (0.41–0.38), bottom lines 440–451 | underside 0.258 | `sill` **0.258** under the doors |
| Belt, side glass | window sill y 232–237, door skin's top 242–246; glass top y 123; gutter y 110 | 1.053–1.035, 1.017–1.004; 1.449; 1.496 | belt **1.01**, `glassBottom` **0.04**, `glassTop` **0.047**, `rail` **1.496** |
| Roof | y 87 | 1.580 | `crown` **0.06** + `railRise` 0.025 |
| Fixed side glass | front frame x 1333, glass from 1340; rear edge near upright x 1563–1567 low, top-rear corner rounded (r ≈ 25 px) to the top line at x ~1530 | 2.353; 3.17 low, 3.05 at the top | columns **2.35** (glass), **3.175 / 3.10** (D pillar) |
| Tailgate's outer line | rows y 115 / 125 / 155 / 205 / 255 / 275 → x 1599 / 1605 / 1623 / 1654 / 1685 / 1693; upright x 1700 from y 285 to 305 | (3.30, 1.478) → (3.64, 0.897), lean **0.586 m/m** (30°); upright 3.668 to 0.79 | last column **3.655 / 3.29** (`rearBase`), knee below |
| Tailgate's foot (load sill) | y 304 (x 1672–1700); handle lip x 1700–1708 at y 285–302 | 0.792 | rear deck **0.79** |
| Tail face, rear lamps | face x 1700; lamp x 1683–1700, y 312–352 | 3.668; 0.762–0.617 | tail station **3.668** |
| Rear bumper | y 355–389; rear face x 1718, wraps forward to x 1622 | 0.606–0.483; 3.729; 3.385 | blade **height 0.123**, centre 0.545 |
| Repeater (front wing) | rectangle x 775–807, y 280–293 | 0.305–0.421, 0.879–0.832; amber, over the arch's front behind the bumper's wrap [P p13] | `repeater` **s 0.305–0.42, y 0.83–0.865** (under the crease) |
| Rear side reflector | rectangle x 1608–1640, y 280–293 | 3.330–3.447, 0.879–0.832 | not expressible (Gaps) |
| C pillar extractor slots | dark slot x 1562–1600, y 145–205, raked parallel to the tailgate | 3.16–3.30, 1.37–1.15 | not expressible (Gaps) |
| Fuel flap | dashed (far side) x 1347–1396, y 298–328 | 2.382–2.560, 0.813–0.704 | **2.385–2.555, 0.71–0.81**, `side: 'right'` [P p14: on the right rear wing just behind the door] |

### 1.1 Plan (top view) and sections (front and rear views)

Outer half widths along the plan (bumpers included where they reach): 0.83 at the front bumper's wrapped ends (s 0.25–0.29), **0.837** over the front arch (s 0.6–0.94), **0.815** along the doors, **0.837–0.844** over the rear arch (s 2.74–2.92), 0.80 behind it (s 3.21–3.36), the rear bumper's ends 0.837 at s 3.43. Front view: the flank ±0.808–0.812 from 0.66 to 1.0 high, ±0.80 at the belt (1.02–1.06), the arch flares ±0.837 at 0.80; rear view the same (flank ±0.806–0.81, flares ±0.83).

| | Reading | Spec |
|---|---|---|
| Face in plan | flat to ±0.714 at s 0.15 (row y 680: x 731–734); ±0.732 at s 0.166, ±0.75 at s 0.188, ±0.786 at s 0.27 [D top] | `wCrease` 0.73 / 0.76 / 0.80 at s 0.15 / 0.2 / 0.28 |
| Flank | ±0.815 [D top], ±0.808–0.812 [D front] | `wCrease` **0.815**, `wBelt` 0.805, `wSill` 0.795 [E: the sill tucked 20 mm] |
| Side glass | foot ±0.739–0.761 at 1.06, ±0.648–0.666 at 1.46 [D front] | `shoulder.inset` **0.05** (0.805 → 0.755), `rise` 0.02 |
| Roof rail | ±0.641 [D top line y 700], ±0.626–0.655 [D front] | `railHalf` **0.64**, `railInset` 0.05 |
| Bonnet's side shut lines | ±0.735 at s 0.33, ±0.763 at 0.58, ±0.781–0.784 at 0.94–1.12 [D top] | `bonnet.inset` **0.01** (the cut just inside the deck's edge) |
| Tail face | flat to ±0.719 (rear view line x 162 from 0.79 down to 0.61); corners round to the flank's ±0.81 | `wCrease` 0.785 / 0.745 / 0.725 at s 3.58 / 3.655 / 3.668 |
| Tailgate | ±0.635–0.643 from its top (1.462) to its foot (0.799); glass ±0.58, 1.044–1.434 [D rear] | the pillar row of the `flat` tail; `rearHeader` **0.06** |

### 1.2 Wheel arches [D, P p10]

| | Front | Rear |
|---|---|---|
| Lip's outer edge: top over the hub | y 298: 133.5 px = **0.485** (1.47 R) | y 302: 129.5 px = **0.470** |
| Lip's outer edge at hub height | x 773 / 1005: centre 889 (8 px behind the hub), half 116 px = **0.421** | x 1370 / 1591: centre 1480.5, half 110.5 px = **0.401** |
| Opening (dark wheel house) top | y 305–308: **0.46** | y 317–322: **0.41–0.43** |
| Flare | stands ~22 mm out of the flank (plan 0.837 against 0.815) and ~6 px (22 mm) wide in the side view | the same (plan 0.844) |

The opening is taller than it is wide (~1.2 R wide at the hub, 1.4 R high), and the photo `p10` shows the same. One circle on the hub cannot be both; the spec takes **`arch` 1.35** (0.445): 14 mm low at the top, 40 mm long at the hub. See Gaps.

### 1.3 Tailgate and load sill [D side, rear; P p14]

The tailgate is hinged at the roof's rear edge (hinges at ±0.11–0.155 on the drawn roof), raked 30° (0.586 m/m) down to 0.897, then upright to its foot at 0.79–0.80; the glass ends at 1.044 (rear view) on the raked part. Below the tailgate the body's rear panel carries the tail lamps (0.62–0.77) and stands upright to the bumper. The photo `p14` shows the tailgate's bottom edge just over the lamps.

Spec: last column **3.655 / 3.29** (the roof's end at the rail; the drawn line gives 3.30 at 1.478); `rearKnee` **{ s 3.555, y 1.044 }** (the glass's foot on the drawn line); the panel below the knee runs straight to the load sill at 3.655, 0.79 (the real one keeps the rake to 0.9 then drops upright: straightened). The belt runs at 1.0 to s 3.58, where the raked line crosses it, and the two tail stations stand at belt **0.775**, deck **0.79**, so the D pillar comes down the raked line to the sill's height, flush with the tailgate, as on the Samara (lab, 2026-10-15: with `flat` tail stations at belt 1.0 the corners stood 0.1 behind the tailgate's lower panel and the wedge between showed the lining). No `rearLean`: the lamp panel is upright.

### 1.4 Door [D, P p13, p10]

One door per side, **1.322 to 2.317** below the belt (0.995 m; `p10` gives 0.99 m), its frame up the A pillar and a vent wing in front of a post at 1.685–1.705 (the 1982 car `p13` shows the post); the drop glass 1.705 to 2.255, frame to 2.295. The B pillar 2.295–2.35, the fixed side glass 2.35–3.175 in the body, the D pillar 0.48 wide at the belt.

### 1.5 Door mirrors [P p00, p13, p15]

Both doors carry a chrome mirror from the start of series production (5koleso.ru, "Как создавалась легенда: история «Нивы»": "Появилось второе наружное зеркало заднего вида" before the first batch; https://5koleso.ru/articles/obzory/kak-sozdavalas-legenda-istoriya-nivy/). The head is on a rod from a small bracket on the door's skin under the belt, rising and leaning back to the head over the belt, the head across the vent wing's rear post. Readings by a projective fit along the belt (door front shut line 1.322, vent post 1.685, rear shut line 2.295):

| Photo | Side | Rod's foot (px → s) | Head (px → s) |
|---|---|---|---|
| `p00` (1983, 1280 px) | left | x 798 → **1.47** | 802–853 → 1.49–1.74 |
| `p13` (1982, 1280 px) | right | x 436 → **1.49** | 390–445 → 1.44–1.71 |
| `p15` (1990, 1280 px) | right | x 477 → **1.48** | 422–475 → 1.48–1.71 |

The rod's foot lies on the skin, so it reads true; the head stands 0.1–0.15 out towards the camera ahead of the car and reads too far back. Spec: `mirrorStalk` **0** (the rod), `mirrorS` **1.50** (bracket 1.47, head centre 1.535). kit-mirrors (2026-10-19): left 84 %, right 85 % seen; the sweep 1.47–1.52 passes both, the earlier 1.585 hid the right one's front half behind the right vent post (44 %), the short arm at the default 1.316 the left one behind the left post (17 %).

## 2. Face (drawing front view; photos `p13`, `p00`)

Bumper top 0.556 (`bumperTop`), deck at the face 0.965.

| Feature | Reading | Spec |
|---|---|---|
| Bumper | y 369–401 → 0.556–0.439; ±0.85 with its end boxes from ±0.69 [D]; 0.076 thick, its back 0.058 off the face [D top]; aluminium over a black lower half, black end caps [P] | blade `alloy`, `lower` black 0.5, `ends` black, lift **0.0125**, height **0.117**, depth **0.08**, no overriders |
| Grille panel | ±0.714 (x 165), y 300 → 0.806 down to the bumper; black, thin chrome outline [P] | `panel` black ±0.714, +0.004..+0.25; `frame` chrome 8 mm |
| Grille bars | ±0.441–0.448, 0.588–0.797; drawn 6 bars and two posts at ±0.214, photo ten fine bars | `grille` ±0.445, +0.032..+0.241, 10 black horizontal bars |
| Head lamps | ring centre x 204.5 → ±0.570, y 334.5 → 0.681; ring outer 28.5 px = 0.1035, inner 22.5 px = 0.082 | `round` ±0.57, +0.125, radius **0.086** (ring 1.18× = 0.101) |
| Corner units | surround ±0.463–0.69, 0.83–0.91; lens ±0.494–0.648 divided at ±0.556, 0.845–0.895; amber outer, clear inner [P p13, p00] | black `panel` span; `lens` blinker ±0.556–0.648 and `lens` head (the side lamp) ±0.494–0.556, +0.289..+0.339 |
| Bonnet's front edge | across ±0.72 at 0.951 (its lip); between the corner units down to 0.879, ±0.44 [D y 280]; the photo shows the bonnet's edge dipping between the units | `bonnet.nose` **{ y 0.879, half [0.44, 0.45] }**, `bonnetFront` 0.15 |

## 3. Tail (drawing rear view; photo `p14`)

Rear bumper top 0.6065 (`bumperTop`).

| Feature | Reading | Spec |
|---|---|---|
| Bumper | y 880–912.5 → 0.608–0.490 [D rear], 0.606–0.483 [D side]; 0.06 thick [D top]; finish as the front [P] | blade `alloy`, `lower` black 0.5, `ends` black, lift **0.06**, height **0.123**, depth **0.065** |
| Lamps | x 180–282.5 → ±0.654–0.281, y 835–872.5 → 0.772–0.636; drawn cells at ±0.545 / 0.427 / 0.354 / 0.305 | `cluster` ±0.36–0.654, +0.03..+0.165 |
| Lamp cells | amber outer (~25 % of the lens); red top strip, white middle, red bottom; red inner part; a black block at the inner end [P p14] | columns `[blinker]`, `[tail, reverse, brake]`, `[tail, brake]`; black `panel` ±0.281–0.36 |
| Plate | between the lamps in a recess ±0.263, 0.636–0.772 [D] | not modelled (no plate on the kit cars) |

## 4. Interior colours [P]

`upholstery` **0x6b5a48** (tan-brown vinyl: `p13`'s rear seat, `p00`'s neighbour's cream head restraint); `dash` **0x1b1b1b** (`p00`'s black dash); `headrests` **true** (`p13`'s front seat). `brightwork` chrome (handle, mirror), `sill` and `waist` none.

## Gaps

- **Arches taller than wide** (not expressible): opening ±0.40 (front) / ±0.40 (rear) at the hub, top 0.46 (front) / 0.41–0.43 (rear) over it; lip outer edge ±0.42 / 0.485 front, ±0.40 / 0.47 rear; the front arch's centre 30 mm behind the hub. `rearArchRise` is rear-only and documented for arches lower than a circle. A per-axle half-ellipse (front width 1.22 R, rise 1.40 R; rear width 1.2 R, rise 1.3 R) would say it.
- **Arch flares** (not expressible): a lip standing ~22 mm out of the flank (plan ±0.837 over the front wheel, ±0.844 over the rear, against ±0.815) and ~22 mm wide round each arch.
- **Bumper wrap.** The early bumpers reach ±0.835–0.85 and wrap round the corners onto the wings; the generator caps a blade at the end face's width + 0.02 (±0.75 front, ±0.745 rear) and wraps it back 0.16, where the wings are already ±0.79–0.80, so the ends run into the corners.
- **Rear side reflector** (not expressible): red, s 3.33–3.447, y 0.832–0.879 on each rear wing. A rear `repeater` with a role would say it.
- **C pillar extractor slots** (not expressible): one dark slot each side, s 3.16–3.30, y 1.15–1.37, raked parallel to the tailgate.
- **Fixed side glass's rounded top-rear corner** (r ≈ 0.09) and **the door's rounded rear-bottom corner** (r ≈ 0.07): straightened.
- **Tailgate below the glass:** raked to 0.897 then upright to 0.79; the spec runs straight from the knee (3.555, 1.044) to the sill (3.655, 0.79).
- **Bonnet louvres** at its rear edge (`p13`), the grille's two posts and badge, the tailgate's handle and badge, the plate recess: left out.
- **Face's foot and the valances** behind the bumpers: hidden on the drawing; 0.45 [E].
- **Corners at the tail** stand at 0.775 instead of turning upright at 0.897 (see §1.3).
- Lab, 2026-10-15: side overlay on the drawing (`/tmp/niva/shots/d3_overlay.png`), lamps at night, all opening parts; z-fight gate passes for both Nivas. The corner units' black surround stands 16 mm proud (not the read 10), so the lens holes in it are covered from every viewpoint the gate tries.

## 5. VAZ-2131 (five doors)

No drawing of the 2131 exists on 3dcar.ru (twelve names tried, all 404). Its own lines are read off Commons photos registered on parts it shares with the 2121, so its `s` values are good to about ±4 cm and its heights to ±3 cm.

**Registration [F].** vaz.ru (`https://www.vaz.ru/v2131.htm`, via its search snippet: the page timed out): 4220 × 1680 × 1640, wheelbase 2700, tracks 1430 / 1400, against the 2121's 3720 and 2200. The car grew by exactly its wheelbase, so both overhangs are the 2121's: everything behind the rear axle is the 2121's `s` + 0.500. autoopt.ru and catalog-vaz.ru print 4240 and 1440 / 1420 (the pack row `sv_niva_long`); 4220 is kept for the +500 relation (4240 [INFERENCE] later bumpers). Clearance 220 (autoopt.ru, catalog-vaz.ru), 175/80 R16 (niva-lada4x4.ru).

**Photos.**
- `P1` "2017 Lada 4X4 Urban 213100 brown side.jpg" (CC0, Throwawayacc222): right side, near-orthographic but with barrel distortion (ends ~7% short), roll 2.5° corrected. Positions interpolated between the B shut line (2.33, the 2121's door [D]) and the rear axle; heights at 2.14 mm/px about the hubs.
- `P2` "VAZ-2131 in Horlivka, January 2013.jpg" (CC BY 4.0, FingerWiki): base car, strong yaw; cross-check only.
- Rear and rear 3/4: "2001 VAZ 21310 beige rear.jpg" (CC0), "2006 VAZ 21310 Lada 4Х4 blue.jpg" (CC0), "Lada Niva 2131 (36120186942).jpg" (CC BY 2.0, Dennis Elzinga); front 3/4 "Lada Niva VAZ-2131 Policija.jpg" (CC BY-SA 4.0, Kos93).

The photo readings are on a 3.654 mm/px reading of `niva.jpg`; the spec brings them to this file's 3.632 (×0.994).

| Feature | Reading [P P1 unless marked] | Spec (`BODY_2131`, nivas.ts) |
|---|---|---|
| Front to the B shut line | the 2121's, front door included (kolesa.ru: "длина дверей осталась той же"; owners swap them, drive2.ru, niva-clyb.ru) [F, D] | the 2121's stations and columns to 2.3 |
| B pillar | glass gap 2.29–2.37, belt 1.11 → rail 1.53 | body 2.295–2.335 (the front door below to 2.317) |
| Rear door | front edge 2.31 / 2.33; glass 2.37–3.13; rear edge upright at 3.20 from the rail to 0.85, then along the arch to the sill at ~2.98 | `door2` 2.317–3.18, drop glass 2.36–3.11; the arch cuts its lower rear corner |
| C pillar | glass gap 3.13–3.21 | body 3.18–3.2 |
| Quarter glass | 3.21 → 3.69, 1.15–1.53, top corners rounded; its rear edge the 2121 side glass's + 0.5 [D] | fixed glass 3.2 → 3.675 (3.6 at the rail) |
| Roof, tailgate, tail | roof to ~3.81; tailgate, lamps and bumper the 2121's in the rear photos | the 2121's last column, knee and tail stations + 0.5; `LOOK_2131` = `LOOK_2121` |
| Sill under the rear door | down to the rear arch's front | a station at 2.8 equal to the 2121's at 2.3 |
| Fuel flap | right, behind the rear door over the arch: s 3.21–3.40, y 0.955–1.077 (0.06–0.18 under the belt); not the 2121's + 0.5, which lands on the rear door | 3.21–3.39, 0.825–0.945 |
| Rear bench | not measured | hip at s 3.0 (`CABIN_2131`, offset 1.0 from the driver's hip) [E] |

Not modelled: three slanted vent slots on the D pillar (s 3.70–3.80, y 1.25–1.45, each ~0.08 × 0.02), the roof rack or rails many carry.

## 6. Cabin (`LAYOUTS.niva`, interior.ts)

Sources: Za Rulyom's retrotest of a 1983 VAZ-2121 (https://www.zr.ru/content/articles/906566-k-yubileyu-nivy-retro-test-vaz/, photos © zr.ru, read for measurement only: the cluster square through the wheel, the cabin from the driver's door, the lenses and rockers; text: the instruments are the 2106's in individual wells, amber lens = centre diff lock, red = brake fluid, the glovebox lid opens upwards); Commons "VAZ-2121 (first generation) "Niva" (interior view).jpg" (public domain), "Interior 1980.jpg" (CC BY-SA 4.0, User:Niva80: the stack, the tunnel's levers), "1990 Lada Niva Truck interior (2654354756).jpg" (CC BY-SA 2.0); avtovaz.com.ua "Раздатка Нива 2121" for which lever is which; `niva.jpg` for the seats (dashed).

Cluster scale: the speedometer's bezel is the 2106's (0.106 m) = 265 px on the ZR photo, 0.4 mm/px; the column between the big dials. Positions (right, up) from the big dials' centre:

| Item | Photo px (x, y) | Size px | Spec |
|---|---|---|---|
| Tachometer 0–8000 | 464, 333 | 266 | −0.070, 0.06, r 0.048 |
| Speedometer 0–180 | 810, 335 | 265 | 0.068, 0.06, r 0.048 |
| Fuel | 178, 280 | 145 | −0.185, 0.081, r 0.024 |
| Oil pressure 0–8 | 225, 462 | 125 | −0.166, 0.008, r 0.020 |
| Temperature 50–130 | 1092, 284 | 145 | 0.181, 0.080, r 0.024 |
| Amber lens (diff lock), red lens (brake fluid) | 1040 / 1142, 431 | 60 | 0.16 / 0.20, 0.021 (`lenses`) |
| Rockers | 965 / 1060 / 1155, 545 | 95 pitch | 0.128 / 0.165 / 0.202, −0.025 |
| Panel | x 30–1250, y 140–545 | | half 0.244 → 0.23, face −0.06..0.135 |

The big dials' height over the belt is the classic's [E]. Seats from the drawing: centres ±0.39 → `seatX` 0.38; the front seat drawn at its rails' front (0.47 m hip to pedal), so `hip` 0.85 [E]; the rear bench's back at 1.52 behind the cowl → `bench` offset 0.67, its base 2 cm off the wheel-house covers it stands between (`clear` 0.04). Gear lever at 0.48 behind the cowl, the transfer box's two levers at 0.66 (diff lock left and longer, range right and shorter) [E positions, P which is which].

Not modelled: the glovebox opens upwards on the car (the kit's falls open); two round vents on the dash top; a diff-lock lamp channel (the amber lens shows `tell_fuel`); front backrests folding forward on the 3-door; the instruments' deep wells; the transfer levers are static.
