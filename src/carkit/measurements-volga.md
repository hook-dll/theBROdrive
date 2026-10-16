# GAZ-24 and GAZ-31029: measured numbers

Working crops and grids were in `/tmp/k/`; the drawings and photos are saved under `build/carshape/_refs/bp/img/` (gitignored); lab captures and the side-by-side sheets are in `build/k/` (not committed). Tags: **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate with its reason.

## 0. Sources and scales

### Factory figures [F]

| Car | Figure | Value | Sources |
|---|---|---|---|
| GAZ-24 | L × W × H, wheelbase, overhang, tracks | 4735 × 1800 × 1490, 2800, front 756, 1476 / 1420 | the dimension lines on `gaz_24.jpg` (a factory drawing); the pack sibling `sv_gaz24` row (1470 front track, 0.354 radius, 0.187 tyre, 174 clearance). `kit_gaz24` takes the drawing's 1476, which `tools/reality.ts` already targets. |
| GAZ-31029 | L × W × H, wheelbase, tracks, clearance, tyre | 4885 × 1800 × 1476, 2800, 1495 / 1425, 156, 205/70 R14 (0.321 free radius) | drivernotes.net, auto-data.net, matador.tech, ru.wikipedia (4885 / 1800 / 1476 / 2800); the-blueprints.com drawing's dimension lines (4885, 2800, 1476; its 1820 is over the mirrors). Collected in `build/vehicles/gaz31029/00-references/factory.json` (conflicts: 1795 width, 1488 height on drom.ru). |

Running gear: the siblings' own (`sv_gaz24`: ZMZ-24D, four-speed, 1420 kg; `cf_gaz31029`: ZMZ-402, the 3.9 axle, 1400 kg), unchanged.

### Drawings [D]

| File | What | Scale and registration |
|---|---|---|
| `gaz_24.jpg` (3dcar.ru `https://3dcar.ru/media/blueprints/full/gaz/gaz_24.jpg`, JPEG 1500 × 900) | The factory four-view of the GAZ-24 with dimension lines (side view car facing left: its left side). | Side: hubs x 657 / 1206 (centre lines), ground y 334 (tyre bottom), tips x 512 / 1433, the 1490 line y 38 → 332. **5.10 mm/px** from the drawn wheelbase (the length dimension gives 5.141: the drawn tips are 37 mm short of 4735). `s = 0.016 + (x − 512) × 0.0051`, `y = (334 − py) × 0.0051`, so both axles land on the dimension lines (0.756 / 3.556) and the bumpers stand 16 / 21 mm further out than drawn. Front view: centre x 215, track 1476 = x 77 → 361 (5.20 mm/px across); heights hung on the bumper (0.505) and the roof (1.51): 5.06 mm/px. Rear view: centre x 218, track 1420 = x 96 → 369; heights on the bumper (0.50) and the roof: 4.88 mm/px. Top view: centre y 680, width 1800 = y 503 → 857. |
| `gaz31029_bp-31029-vector-full.jpg` (the-blueprints.com watermarked preview of its GAZ-31029 vector drawing, 1280 × 906; copied from `build/vehicles/gaz31029/00-references/`) | Side (left side), front, top, rear views with 4885 / 2800 / 1820 / 1476 dimension lines. | Side: hubs x 161.5 / 647.5 (the tyres' symmetric runs at y 310–325), ground y 330, tips x 9 / 850 (4845 at the hub scale: 40 mm short of 4885). **5.761 mm/px**; `s = 0.896 + (x − 161.5) × 0.005761`; the front overhang 0.896 is the drawn 879 plus the missing 40 mm split as the drawn overhangs (front 43 %). Heights `(330 − py) × 0.005761 × 1.028`: the drawing's roof (1.469) brought to the 24 drawing's (1.51), since the roof, doors and glass are one stamping. Front view: centre x 1055, ground y 332.5, the side scale across. Rear view: centre x 1050, the roof (y 499) as 1.469. |
| `gaz_3102.jpg` (3dcar.ru, in the repo root too) | GAZ-3102 four-view, 4960 long (958 front overhang). | Cross-check only: the 3102's nose is the 31029's, its bumpers longer. |
| `gaz_2402.jpg`, `gaz_3110.jpg` (3dcar.ru) | The 24 estate, the 3110. | Saved, not used. |

### Photos [P] (Wikimedia Commons)

| Saved as | Commons title | Licence | Used for |
|---|---|---|---|
| `gaz24_GAZ-24_1st_generation_Volga_side_view_.jpg` | GAZ-24 (1st generation) "Volga" (side view) | public domain | left side: the oval flap high on the rear wing (s 4.45, 0.63 at 5.45 mm/px from the hubs); chrome sill strip; no side repeater |
| `gaz24_GAZ-24_1st_generation_Volga_front_view_.jpg`, `gaz24_GAZ-24_orange_colored_front_view_.jpg` | GAZ-24 (1st generation) "Volga" (front view); GAZ-24 orange colored (front view) | public domain; CC BY-SA 4.0 | the face: upright chrome bars, round lamps in rings, indicators under them, the blade with two fangs |
| `gaz24_GAZ-24_1st_generation_Volga_tail_light_.jpg` | GAZ-24 (1st generation) "Volga" (tail light) | public domain | the tail lamp: red over amber over white in a chrome rim |
| `gaz24_GAZ-24_orange_colored_rear_view_.jpg`, `gaz24_GAZ_Volga_M-24_1970-1977_Rear.jpg`, `gaz24_GAZ-24_2nd_generation_Volga_rear_view_.jpg` | GAZ-24 orange colored (rear view); GAZ Volga M-24 (1970-1977) Rear; GAZ-24 (2nd generation) "Volga" (rear view) | CC BY-SA 4.0; CC BY-SA 4.0; public domain | the early rear bumper's fangs; the ribbed band |
| `gaz31029_photo-31029-front.jpg`, `gaz31029_photo-31029-rear.jpg` | GAZ-31029 "Volga" (front view) (cropped); (rear view) | CC BY-SA 4.0 | the face and tail arrangement |
| `gaz31029_photo-31029-side-profile-police.jpg`, `gaz31029_photo-31029-three-quarter-museum.jpg` | Volga 31029 politia 01; Wolga 31029 1993 im Museum Wilkau-Haßlau | public domain; CC BY-SA 3.0 de | profile, wrap of the corner lamps |

## 1. GAZ-24 (`BODY_GAZ24`, `LOOK_GAZ24`)

### 1.1 Side [D side view]

| Feature | Reading (px) | s, y (m) | Spec |
|---|---|---|---|
| Front bumper | tip x 512, blade y 225–245 | 0.016; 0.45–0.55 | blade, centre 0.505 (lift 0.07 over the sill's bevel at 0.435), height 0.075, 0.035 deep on its brackets |
| Face | x 522 from y 215 to the lip | 0.067 | first station |
| Bonnet's lip; bonnet top | (535, 148); (580, 137), (650, 132), (740, 127) | 0.949; 1.005 / 0.36, 1.03 / 0.72, 1.056 / 1.18 | deck 0.945 / 0.067, 0.995 / 0.25, 1.07 at the cowl; `bonnetFront` 0.09 |
| Screen's foot (cowl) | (775, 120) | 1.357, 1.091 | station and first column at 1.36 |
| Roof's front; roof | (852, 46–50); top y 36–38 | 1.75; 1.51 | column top 1.75; rail 1.40 + rise 0.03 + crown 0.08 |
| Gutter; window tops; window sill | y 58; y 65–70; y 138 | 1.41; 1.37–1.35; 1.0 | rail 1.40, `glassTop` 0.045, `glassBottom` 0.045 |
| Belt crease (door handles on it) | y 145–150 nose to tail | 0.94–0.96 | belt 0.925 (nose) → 0.955 → 0.96 → 0.955, falling to 0.865 at the tail |
| Lower crease | y 177 nose to tail | 0.80 | crease 0.80 (0.78 / 0.77 at the ends) |
| Door bottoms; sill | y 280 (front) – 272 (rear); y 283–287 | 0.275–0.316; 0.24–0.26 | `doorBottom` 0.29; sill **0.262** level (the chrome sill strip is one straight box, and the classic exhaust needs the floor there) |
| Front door | front edge x 795 (belt), rear x 965 | 1.459, 2.326 | columns 1.46 / 2.326 |
| Quarter light's rear post | x 887 at the belt, 880 high | 1.928 / 1.892 | column 1.915 / 1.89 (`vent`) |
| B pillar | x 972 / 980 / 985 | 2.362 / 2.403 / 2.428 | columns 2.362 / 2.40 / 2.428 |
| Rear door glass | x 990 – 1085 (upright rear edge), top y 75 | 2.454 – 2.938 | `drop` 2.454 → 2.938 |
| Rear door's shut line | belt x 1137; at the rail x 1080; below the belt upright to y 212, to x 1118 at the bottom | 3.203 / 2.913; 0.62; 3.107 | column 3.203 / 2.94, `foot` { y 0.62, s 3.107 }; the door's blind sail between |
| C pillar; roof's rear end | belt 3.203 → back light's foot | — | one strip to 3.688 |
| Back light's foot | (1232, 130) | 3.688, 1.04 | station and last column 3.688, top 3.32 (roof end x 1160) |
| Boot | (1310, 145), (1400, 161), tail top (1412, 162–165) | 0.964 / 4.086, 0.882 / 4.545, 0.865 / 4.606 | deck 0.975 / 4.086, 0.89 / 4.55, 0.865 / 4.637; `bootEnd` 4.55 |
| Tail face; rear bumper | x 1418; blade x 1342–1430, y 227–245 | 4.637; 0.45–0.55 | last station; blade centre 0.50 (lift 0.045 over 0.455), 0.08 high, 0.05 deep |
| Front arch | top y 185 over the hub at 266 | 0.413 over the hub | `arch` 1.17 (×0.354) |
| Rear arch | top y 200, sides x 1140 / 1272 | 0.337 over the hub, 0.337 wide | `rearArch` 1.0, `rearArchRise` 0.95 |
| Flap (left side) | oval x 1345–1390, y 190–217 | 4.264–4.494, 0.597–0.734 | `flap`, `side: 'left'`; the side photo puts it at s 4.45, 0.63 |

Plan [D top view]: the outline ±0.885 at the doors (1.77; the passport's 1.80 includes the mouldings), ±0.85 at the nose and tail with small corner radii; the roof ±0.70 at the rail [D front view]; the screen's foot 0.13 ahead of its corners on the centre line (`screenFoot` 0.12).

### 1.2 Face [D front view; P front views]

| Feature | Reading | Spec |
|---|---|---|
| Head lamps | centres x 77.5 (±0.70), y 185 (0.763); ring 22 px, lens 15 px | `round` head, ±0.70, `mid` + 0.019, radius 0.09 |
| Grille | x 100–330 (±0.587), y 160–215 (0.89–0.61); 28 bars drawn | grille ±0.587, from `bumperTop` + 0.068 to `deck` − 0.055, chrome frame, 24 upright chrome bars |
| Indicators | x 72–95 (±0.62..0.74), y 217–225 (0.60–0.56) | lens `blinker` |
| Bumper fangs | x 162 / 272 (±0.28), y 238–270 (0.505–0.34) | overriders inset 0.58, half [0.025, 0.085], drop 0.085 |

### 1.3 Tail [D rear view; P tail light, rear views]

| Feature | Reading | Spec |
|---|---|---|
| Tail lamps | x 60–80 (±0.82..0.72), y 655–702 (0.837–0.607) | chrome `frame` and a `cluster` ±0.72..0.82 of tail, brake, indicator, reversing (top to bottom: the red half split into tail over stop) |
| Ribbed band | x 120–640 zoom (±0.64), y 660–675 (0.81–0.74) | chrome `grille`, 3 horizontal bars |
| Plate | x 185–257, y 680–707 | not modelled |
| Bumper | blade y 712–735 (0.55–0.45); no fangs drawn | blade; fangs from the early photos (inset 0.58) |

### 1.4 Result

`kit_gaz24`: **11 938 triangles** (body + trim 5 460, cabin 3 889, of it fine 1 747, bay 401, boot 284, underbody 560, wheels 1 344; 6 804 beyond 25 m), the `classic` platform's cabin and bay as they are. `tools/kit-zfight.ts`: PASS (first run: the exhaust 0.6–1 mm under the floor where the sill was 0.245, the chrome sill strip off a varying sill, the blade's brackets 2 mm long against the face; fixed by a level 0.262 sill and shallower blades). `tools/reality.ts kit_gaz24`: 144 km/h (145), turning and brake within. Lab: `build/k/lab6/kit_gaz24-*.png`; side, front and rear beside the drawing in `build/k/compare/gaz24_{side,front,rear}.png`. 14 WebGL programs after boot and still 14 after opening every part, lighting the lamps and the cabin view.

### 1.5 Gaps

- The **C-pillar louvre** and the bonnet's raised centre are not modelled; the rear door's blind sail is the generator's flat strip.
- **Wiper blades** 0.38 [E]: no catalogue length found; the 2101's 0.33 scaled by the screen's width.
- The **rear fangs** follow the early photos; the drawing has none (a later bumper).
- No **plate** or its recess front or rear; the front plate's fold-down bracket not modelled.
- The **interior** is the `classic` platform's (VAZ dash and seats, scaled to the body): no Volga dash, no front bench.
- Upholstery colour [E].

## 2. GAZ-31029 (`BODY_GAZ31029`, `LOOK_GAZ31029`)

### 2.1 What is shared

The 24's cabin columns (A pillar to the C pillar's foot) and its cowl and mid stations (1.357, 2.4) are taken as they are and moved back **0.14** (front overhang 0.896 against 0.756). Checked on the 31029 drawing: front door's front edge x 282 → 1.590 (24: 1.459 + 0.14 = 1.599); B pillar x 440 → 2.50 (2.502); roof's rear end x 606.7 → 3.461 (3.32 + 0.14 = 3.46). The cowl reads 1.447 on the 31029 drawing against the 24's 1.497: the 24's is kept (one greenhouse).

### 2.2 Front [D side and front views]

| Feature | Reading | s, y (m) | Spec |
|---|---|---|---|
| Bumper | black, x 9–85, y 243–260 | 0.017–0.45; 0.415–0.513 | blade `black`, centre 0.47 (lift 0.095 over 0.375), 0.11 high, 0.04 deep |
| Face | x 15–25 | 0.052–0.110 | first station 0.07 |
| Bonnet's lip; bonnet | (25, 185); (100, 170), (200, 160); cowl (253, 150) | 0.859; 0.947 / 0.542, 1.007 / 1.118; 1.066 | deck 0.86 / 0.07, 0.9 / 0.25, 0.947 / 0.542, the 24's 1.07 at 1.497; `bonnetFront` 0.075 |
| Wing top | 0.888 at the nose → 0.965 at the A pillar | — | belt 0.85 / 0.89 / 0.91 → the 24's 0.955 |
| Head lamps | front view x 927.5–977.5, y 202.5–235 | ±0.446..0.734, 0.577–0.77 | `cornerLamps` head |
| Indicators | front view x 912.5–927.5; side view to x 45 | ±0.734..0.821; back to s 0.225 | `cornerLamps` blinker round the corner, to s 0.215 |
| Grille | x 980–1130, y 201–239 | ±0.432 (over its frame), 0.553–0.779 | grille ±0.42 (its frame stops short of the lamps), chrome frame, 4 black bars |
| Side marker | x 205–218, y 183–188 | 1.146–1.22, 0.82–0.85 | `repeater` |
| Front arch | top y 201.7 | 0.393 over the hub | `arch` 1.22 (×0.321) |

### 2.3 Rear [D side and rear views]

| Feature | Reading | s, y (m) | Spec |
|---|---|---|---|
| Back light's foot | (686.7, 166.7) | 3.922, 0.967 | station and last column 3.92 (top 3.46); deck 0.98 |
| Boot | (773, 166.7), lid's trailing edge (826.7, 173.3) | 0.967 / 4.42, 0.928 / 4.728 | deck 0.967 / 4.42, 0.93 / 4.73 |
| Tail face | (840, 200) to (841.7, 243) | 4.805; 0.77 → 0.515 | last station 4.805 |
| Lid on the tail face | rear view: foot y 622.5, sides x 932.5 / 1167.5 | 0.778, ±0.677 | `notch` 0.677, deck 0.778, `bootEnd` 4.805 |
| Tail lamps | rear view x 905–1002.5, y 628.5–660; cells amber / red / white / red split at x 920, 965, 982.5; side view the amber cell back to x 811.7 | ±0.274..0.835, 0.557–0.743; to s 4.64 | rear `cornerLamps`: brake ±0.274, reversing 0.389, tail 0.49, indicator 0.749 round the corner to s 4.65 |
| Bumper | side view x 803–848, y 247–267 | 0.373–0.491 | blade `black`, centre 0.432, 0.118 high, 0.045 deep |
| Rear arch | top y 218 | 0.30 over the hub | `rearArch` 1.08, `rearArchRise` 0.93 |
| Flap (left side, as drawn) | x 776.7–805, y 211.7–230 | 4.44–4.60, 0.59–0.70 | `flap`, `side: 'left'` |

### 2.4 Result

`kit_gaz31029`: **11 118 triangles** (body + trim 4 444, cabin 4 051, of it fine 1 747, bay 421, boot 294, underbody 564, wheels 1 344; 5 788 beyond 25 m). `tools/kit-zfight.ts`: PASS (first run: the grille's chrome frame 4 mm behind the head lamps' inner ends, fixed by the narrower grille; the exhaust as on the 24). `tools/reality.ts kit_gaz31029`: 143 km/h (145–150, the 4-speed's cut as with `cf_gaz31029`), turning and brake within. Lab: `build/k/lab5/kit_gaz31029-*.png`; `build/k/compare/gaz31029_{side,front,rear}.png`. No program linked by it after boot.

### 2.5 Gaps

- The **flap side** is the drawing's (left); not checked on a right-side photo.
- **Fog lamps** under the front bumper, the **plate** recesses, the chrome strip along the lid's lower edge and the GAZ badge are not modelled; the black bumpers are blades with no end caps.
- The cowl is the 24's (1.497), 50 mm behind the 31029 drawing's 1.447.
- Interior: the `classic` platform's, as on the 24 (the 31029's dash not modelled); head restraints on.

## 3. Owner's first review (2026-10-16)

Every reading below is in the drawings' own pixels, converted with §0's scales. The overlays put an orthographic render of the built car (closed, near detail) under each drawing at that drawing's scale and registration (`build/k/compare2/gaz24_*`, `gaz31029_*`: `*_side.png` / `_front` / `_rear` shaded under the drawing's lines in red, `*_lines.png` the model's edges in blue over the drawing, `*_q50.png` / `_q140.png` 3/4 views before and after, `lab_*_open.png` lab captures).

### 3.1 Greenhouse

| Feature | GAZ-24 [D `gaz_24.jpg`] | GAZ-31029 [D the-blueprints.com] | Before | After |
|---|---|---|---|---|
| Front door frame up the A pillar | outer line (800, 143) → (862, 62): 1.485 / 0.974 → 1.80 / 1.387 | (300, 150) → (352, 92): 1.61 → 1.99 at the rail | door frame from 1.40 at the belt, 30 mm wide | `door1` from its shut line 1.46 to 1.81 at the rail (31029: 1.60 → 1.95) |
| Front glass's front edge | (838, 128) → (870, 85): 1.68 / 1.05 → 1.84 / 1.27, slope 0.744, 1.62 at the belt | (310, 155) → (355, 100): 1.751 / 1.036 → 2.011 / 1.362, 1.698 at the belt | 1.43 → 1.795 (glass 0.17 too far forward) | 24: quarter light 1.60 → 1.915, post 1.92; 31029: one drop pane from 1.70 → 2.04 |
| Rear glass's top-rear corner | (1055, 64) → (1090, 82): 2.785 / 1.377 → 2.964 / 1.285; post x 1088–1095 | 1.38 at x 500, 1.327 at x 530 (3.019), 1.273 at x 540 (3.077) | level glass to 2.938, then a blind painted sail | 24: level to 2.80, `glassDrop` 0.012 at 2.89, post 2.95–2.975 at 1.28; 31029: level to 2.94, 0.025 at 3.02 |
| Rear glass's raked rear edge | fixed pane (1092, 80) → (1127, 137): 2.974 / 1.295 → 3.153 / 1.005, 3.175 at the belt | (540, 115) → (578, 162): 3.077 / 1.273 → 3.295 / 0.995, 3.315 at the belt | none (sail) | 24: fixed pane in the door to a raked column 3.175 → 2.975 (`drop` 0.111); 31029: the drop pane to 3.315 → 3.053 (`drop` 0.077) |
| Rear shut line | belt x 1137, rail x 1080: 3.203 → 2.913 | below the belt x 589: 3.36; rail 3.08 | 3.203 → 2.94 (31029: 24's + 0.14) | 24 unchanged; 31029 3.36 → 3.08 |
| Window tops | 1.346–1.367 (front), 1.37–1.38 (rear) | 1.36–1.38 | 1.355 (`glassTop` 0.045) | `glassTop` 0.03: 1.36–1.37 under the arched roof |

### 3.2 Roof in profile and across

The roof's top line, scanned column by column: GAZ-24 1.474 at s 1.765, 1.505 at 1.918, 1.52 from 2.12 to 2.38, 1.505 at 2.734, 1.494 at 2.887, 1.479 at 3.04, 1.454 at 3.193, 1.403 at 3.295, the back light's top 1.387 at 3.336; GAZ-31029 1.445 at 1.867, 1.481 at 1.982, 1.498 from 2.155 to 2.731, 1.486 at 2.85–2.96, 1.475 at 3.077, 1.457 at 3.249, 1.427 at 3.365, 1.398 at 3.422, 1.368 at 3.48. Before: level 1.51 from the screen's top to the back light's. After (`roofDrop`): 24 the screen's top 1.46 on the centre line, crest 1.51 from 2.05 to 2.65, 1.49 at 2.85, 1.475 at 3.05, 1.45 at 3.19, the back light's top 1.39; 31029 the screen's top 1.455, crest 2.16–2.75, the back light's top 1.386. Across [D front view: the outline turns from the pillars to the roof between (0.712, 1.391) and (0.598, 1.457)]: `railBend` [0.3, 0.6] splits the rail's one chamfer in two (breaks 23° and 29° instead of 41° and 14°).

### 3.3 Bonnet, boot, bumpers

| Feature | Drawing | Before | After |
|---|---|---|---|
| 24 nose across [D front view] | lip 0.95 on the centre line, the wings' corners 0.91 at ±0.83 (y 155) | flat: deck 0.945, corners 0.94 | face `belt` 0.895 (corners 0.91), 0.92 at s 0.25 |
| 24 boot [D side view, its top line] | 1.04 at 3.688, 1.015 at 3.75, 0.995 at 3.8, 0.984 at 3.9, 0.979 at 4.0, 0.964 at 4.1 | straight 1.04 → 0.975: 15–25 mm high at 3.75–3.9 | station at 3.8, deck 0.997; 0.972 at 4.086 |
| 24 bonnet | 0.969 at 0.2, 1.015 at 0.4, 1.051 at 0.8, 1.066 at 1.2 | within 15 mm (the drawn raised centre not modelled) | unchanged |
| 31029 tail corners [D side view] | wings' top 0.906 at 4.75, 0.805 at 4.80 | 0.906 at 4.80 (square) | tail `belt` 0.84 |
| 31029 bonnet, boot | within 12 mm (bonnet), 12–24 mm higher drawn (boot) | — | unchanged |
| Bumpers along the wings [D side views] | 24 front blade to x 580 (s 0.363), rear from x 1342 (4.249); 31029 front to x 85 (0.455), rear from x 803 (4.59) | every blade a 0.16 return | blade `wrap` 0.33 / 0.43 (24), 0.415 / 0.25 (31029), hugging the wings |
| 24 door bottoms | 0.275–0.316 | 0.29 | 0.31 (at 0.29 the new door columns left a 4.7 mm far-range z-fight with the chrome sill strip) |

Result: `kit_gaz24` 13 246 triangles (11 938 before), `kit_gaz31029` 11 824 (11 118); `tools/kit-zfight.ts` PASS for every kit car; 14 WebGL programs after boot, after framing every car and after opening, lighting and the cabin view of the changed ones (unchanged).

Left: the window corners are chamfers, not round; the bonnet's raised centre and the C-pillar louvre are still not modelled; the 31029 front and rear views of the drawing are registered loosely (no dimension line across), so those overlays are indicative only.

### 3.4 Owner's second look (2026-10-16): dents

Checked by a throwaway census of concave folds between neighbouring painted faces (angle × length per region; `build/k/compare3/` close-ups before/after). GAZ-31029 rear door top s 2.8–3.45: 44 folds, max 55°, Σ 83 m° → 2 folds, 4.4°, 1.5 m°; its C pillar 44 / 35° / 61 m° → 12 / 4.4° / 8.5 m°. GAZ-24 rear door top 36 / 70° / 77 m° → 0; C pillar 42 / 40° / 47 m° → 10 / 5.6° / 8.1 m°. Causes: the raked rear door column's `drop` tipped the rail strip in (now `glassDrop`, the rail untouched); four `roofDrop` points over the C pillar each cut it into twisted strips (now one); `railBend`'s first facet steeper than the raked back light folded the header in along the glass (now capped at 95 % of the glass's slope); greenhouse quads on a `railBend` roof are cut on their convex diagonal.
