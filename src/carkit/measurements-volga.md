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

### 3.5 Owner's review, 2026-10-16 evening: the A pillar

"The A pillar too heavy, the front door's glass squeezed by it" (the same on the AZLK-2141, `measurements-2141.md` §1). The kit's pillar line is the screen's side edge (columns `1.36 / 1.75`, the 31029's `1.50 / 1.89`: the screen's foot and the roof's front on the centre line, kept so the screen and the roof do not move). Behind it the body ran to the door's frame and the frame on to the glass at their drawn lines, which stand far behind the drawn pillar at the belt: a painted wedge.

| Reading | GAZ-24 | GAZ-31029 |
|---|---|---|
| Drawing, at mid height | [D `gaz_24.jpg`, zoom `/tmp/kit2141/g24d_a.png`] y 100 (1.193): the pillar's outer line x 828 (1.628), the quarter light's glass from x 842 (1.700): **0.072 of s**, 14 px; the pillar leaning 0.91 m of s per m, so 5.3 cm across. At y 70 (1.346): 856 → 870, 1.770 → 1.842 | [D the-blueprints.com, zoom `/tmp/kit2141/g31d_a.png`] y 125 (1.214): the pillar's outer line x 316 (1.786), the glass from x 330 (1.867): **0.081 of s**, 14 px |
| Photo | [P "GAZ-24 (1st generation) Volga (side view)", 5.458 mm/px by the hubs x 252 / 765; zoom `/tmp/kit2141/g24p_a.png`] y 250 (≈ 1.21): outer chrome x 413, glass from x 435: 22 px, 0.12 of s with the chrome frames; the quarter light is a triangle whose front edge runs parallel to the pillar right behind it, its foot rounded (x 416 at the sill, 1.651) | — (the police profile is too small to read) |
| Kit before, from the pillar's line to the glass | 0.24 of s at the belt (body 1.36 → 1.46, frame → 1.60), 0.165 at the rail (1.75 → 1.81 → 1.915) | 0.20 at the belt (1.50 → 1.60 → 1.70), 0.15 at the rail (1.89 → 1.95 → 2.04) |
| Kit after: door frame 0.04 behind the pillar's line, glass 0.035 behind that, parallel | frame `1.40 / 1.79` (`lower: 'body'`: the wing still reaches the shut line 1.459 below the belt), quarter light from `1.435 / 1.825` to its post 1.92 (a column at the shut line `1.46 / 1.85` inside it): **0.075 of s**, 5.6 cm across | frame `1.54 / 1.93` (`lower: 'body'`), glass from `1.575 / 1.965` (a column at the shut line `1.60 / 1.99`): **0.075 of s** |

The glass now runs down the pillar to the belt: on the 24 the quarter light is a long four-sided pane (its foot 0.19 ahead of the drawn one, whose rounded corner stands behind a chrome frame the kit does not have); on the 31029 the drop pane starts 0.12 further forward at the belt than drawn. Lab before / after: `/tmp/kit2141/apillar_before_after_gaz24.png`, `apillar_before_after_gaz31029.png` (side, s/y grid), `before_gaz*_*.png` / `after_gaz*_*.png` (side, 3/4 front), `after_gaz*_window.png`, `after_gaz*_dooropen.png`. `tools/kit-zfight.ts` PASS; triangles: 24 13 156 → 13 366, 31029 11 692 → 11 888; fit rows unchanged (0 mm stale).

## 4. Dashboards (`CABIN_GAZ24`, `CABIN_GAZ31029` in interior.ts), 2026-10-17 draft

Before this both Volgas drew the `classic` platform's VAZ-2106 dash. Each now has its own `cabinLayout`. Three generator additions, all absent on the other cars (geometry hashes of the 18 other cars identical to HEAD 2c5601f): `Layout.band` (a coloured band laid into the fascia's face across the dash, left out behind the binnacle), `Layout.clock` (a static clock on the cluster face, coarse geometry, no channel), `glovebox.colour`, and `wheel.chrome` (spokes and the round boss in chrome).

### 4.1 Sources [P] (Wikimedia Commons, saved under `build/carshape/_refs/bp/img/`)

| Saved as | Commons title | Licence | What it shows | Used for |
|---|---|---|---|---|
| `gaz24_GAZ-24_1st_generation_Volga_interior_.jpg` (already there) | GAZ-24 (1st generation) "Volga" (interior).jpg | public domain | the whole dash square through the screen from the back seat, 1920 × 1440 | every GAZ-24 position (scale below) |
| `gaz24_GAZ_24_Volga_interior.jpg` | GAZ 24 Volga interior.jpg | CC BY-SA 4.0, User:CLI | an early car through the open driver's door: the cluster panel close | the cluster's windows, lamps, clock |
| `gaz24_24-interior-early-1974.jpg` | 24-interior-early-1974.jpg | public domain, Алексеев С.С. (DL24) | a 1974 car through the open driver's door | the cluster, the knobs under the band, the vent |
| `gaz24_Gaz-24-ii-series-int.jpg` | Gaz-24-ii-series-int.jpg | public domain, DL24 | a second-series car from the driver's seat: the same layout with a wood-look band, a single chrome bar across the wheel | check only (the kit draws the early car) |
| `gaz24_GAZ-24_Citydrive_salon.jpg` | ГАЗ-24 Ситидрайв на СРВ салон.jpg | CC BY-SA 4.0, User:ATI1999 | a restored late car | check only (modern radio) |
| `gaz31029_31029-int-2.jpg` | 31029-int-2.jpg | public domain, DL24 | the only 31029 interior on Commons, 1152 × 768, from behind the driver's seat | every GAZ-31029 position |
| `gaz3102_GAZ-3102_Citydrive_salon.jpg` | ГАЗ-3102 Ситидрайв на СРВ салон.jpg | CC BY-SA 4.0, User:ATI1999 | a late (post-2004) GAZ-3102's moulded dash | **not** the 31029's: the 31029 kept the 1982 3102-style panel (wood band, two big dials under a hood, as on `31029-int-2.jpg`); the moulded one came with the 3102's 2004 facelift. Not used. |

Factory figures: none found for either dash. The wheels' diameters are owners' measurements [E]: GAZ-24 420 mm (drive2.ru "Оплётка руля Волга Газ 24 (1977 года)", https://www.drive2.ru/l/8007726/ ; drive2.ru 551722566385927182 "у заводского 42 см"), GAZ-31029 400–410 mm (forum.allgaz.ru t-11498: 41 cm, 40 cm by tape; "на 31029 и 2410 одинаковые рули").

### 4.2 Scales

- **GAZ-24**, frontal photo: the fascia band runs across the cabin, ~1700 px; the kit's dash is 1.512 wide (half 0.756, from the shell), so **0.885 mm/px** across, centre line x 970 (defroster grille, radio, ashtray in line). Heights hung from the band's top (y 656) at **0.073 over the belt [E]**: the top roll stands over the band and meets the scuttle about 0.1 over the belt; no photo shows the belt. The panel stands nearly in the fascia's plane, so the one scale serves it (the wheel is nearer the camera and not scaled from this photo).
- **GAZ-31029**: the column (wheel's hub, cluster's centre, x 465) to the centre line (x 735, vents, heater, band) is 270 px for the kit's seatX 0.40: **1.48 mm/px**. Heights hung from the centre band's top (y 283) at **0.055 over the belt [E]**.
- **seatX 0.40** for both (classic 0.37): the GAZ-24's panel centre (x 508) stands 462 px = 0.41 off the centre line [P]; the column is centred on the panel in both photos.

### 4.3 GAZ-24: readings → spec (photo px on the 1920 × 1440 frontal photo unless named)

| Feature | Reading | Value | Spec |
|---|---|---|---|
| Fascia band (aluminium) | y 656–815 | 0.141 tall [P] | `band: { dy: [-0.066, 0.073], colour: 0xa7aaa9 }` |
| Black panel under it | y 815–897 | to −0.14 [P] | `fascia` to −0.14; `dash` face upright at 0.338 |
| Top roll | overhangs the band ~2 cm, level to the scuttle [P] | [P/E] | `dash` points to dy 0.1 |
| Instrument panel window | x 205–812, y 680–798 | 0.537 × 0.104, centre 0.41 off centre [P] | `binnacle` flat, 8 mm proud; `binnacleHalf` 0.268; `clusterFace` half [0.257, 0.05], blue-grey 0x6c8496, chrome frame |
| Speedometer scale | numerals 20 at x 422, 180 at x 622, y 720 (zoom of the frontal photo) | 0–180 over ~0.20 [P] | ribbon `speed` half [0.111, 0.0177], up 0.014 |
| Small windows | CLI photo: two at the panel's left end one over the other (ammeter "А", fuel "БЕНЗИН"), one under the scale's start (temperature 80–120, "ВОДА"), one under its end (oil 0–6, "МАСЛО") | [P] | ribbons `volts` (12–16 V: no current channel; the ammeter's zero taken at 14 V [E]), `fuel`, `temp`, `oil` 0–6 kgf/cm², each half [0.024, 0.009] |
| Warning lamps | two red lenses between the left windows and the scale (CLI photo) | [P]; which functions not legible | `lamps` 2 × 2: turn, beam, oil, brake [E] |
| Clock | right end of the panel, x 745–800 (frontal), square face (CLI) | [P] | `clock` right 0.226, r 0.02 (round in the kit) |
| Radio | x 880–1105, y 695–750, centred | [P] | `radio` [0, 0.017] (the kit's standard radio) |
| Glovebox lid | x 1174–1710, y 659–799 | centre −0.418, half 0.237 × 0.062 [P] | `glovebox` x −0.417, half [0.236, 0.057] |
| End vents | round, chrome rims, x 146 / 1763, y ~732, r ~37 px | ±0.70, r 0.033 [P] | `eyeballs` r 0.03 at ±0.715, dy 0.018 [E: clear of the panel] |
| Ashtray | chrome pull in the black panel, centre, y 854 | dy −0.10 [P] | `ashtray` [0, −0.106] |
| Knobs left of the column | x 244, 323, 390; y 866 | [P] | lights knob = the middle one (x 0.573, dy −0.111) [E which] |
| Knob right of the column | x 799, y 866 | x 0.151 [P] | the kit's `hazard` button there (the early car had none) [E] |
| Steering wheel | thin black rim, two spokes nearly level dipping to the hub, a chrome bar with the "Волга" script across [P]; 420 across [E owners] | | `wheel` radius 0.2005, rim 0.0095, spokes [−8, 188], round boss, `chrome: true`; dy 0 (hub at the belt) [E] |

### 4.4 GAZ-31029: readings → spec (px on `31029-int-2.jpg`, 1152 × 768)

| Feature | Reading | Value | Spec |
|---|---|---|---|
| Wood band across the dash | y 283–335 | 0.077 tall [P] | `band: { dy: [-0.022, 0.055], colour: wood }` |
| Dash face, black, to | y 480 | −0.24 [P] | `dash` face at 0.35 to −0.2, console below [E] |
| Instrument panel (wood) | x 326–605, y 237–355, in a black surround under a hood | half 0.206 × 0.087, centre up 0.036 [P] | `binnacle` (hood lip over it, face 2 cm proud), `binnacleHalf` 0.222, `clusterFace` half [0.205, 0.0875] wood, black frame |
| Left dial (combined gauge) | centre x 383, face r ~40 px; only the fuel arc (upper right, red) legible | right −0.121, r 0.059 [P] | `fuel` over its top, `temp` (bare) over its bottom, r 0.055 [E: the other scales not legible] |
| Speedometer | centre x 548, 0–180 km/h, r ~40 px | right +0.123 [P] | `speed` r 0.055, BIG |
| Clock | small dial between them, numerals 9 / 12 / 3, x 455, y 280 | [P] | `clock` right 0, up 0.059, r 0.026 |
| Warning lamps | in the speedometer's face [P] | | `lamps` row under the speedometer (turn, beam, side, brake), `lenses` under the left dial (fuel, oil, charge) [E] |
| Hazard button | red, on the band, x 630, y 307 | x 0.155, dy 0.019 [P] | `hazard` [0.155, 0.019] |
| Radio slot | x 656–803 on the band (empty on the photo) | centred [P] | `radio` [0, 0.017] |
| Centre vents | x 645–717 and 744–823, y 366–418 | ±0.075, half 0.05 × 0.038, dy −0.106 [P] | two `vents` |
| Heater sliders | x 656–829, y 427–473 | half 0.128 × 0.034, dy −0.192 [P] | `heater` half [0.12, 0.032], two knobs [P: sliders drawn as knobs] |
| Console | x 660–830 down to the tunnel | half ~0.13 [P] | `stack` half 0.14 |
| End vents | driver's x 263–315, y 286–320 (slatted) | x 0.66, dy 0.025, half 0.038 × 0.025 [P]; passenger's by symmetry [E] | `vents` ±0.67 |
| Buttons under the cluster | round, x 544 and 583, y 395 | right 0.117, dy −0.111 [P] | the light switch (knob) on the first [E which] |
| Glovebox lid | wood, in the band right of the radio, black pull at its top right; from x 866 out | [P]; outer end past the frame [E] | `glovebox` x −0.407, half [0.21, 0.04], `colour` wood |
| Ashtray | not seen | [E] | low on the console, dy −0.33 |
| Steering wheel | a large padded centre reaching the rim at nine and six o'clock, a thin rim [P]; 400–410 across [E owners] | | `wheel` radius 0.193, rim 0.0095, spokes [−10, 190, 270], `hub: 'pad'` |

### 4.5 Result

Lab captures in `/tmp/kit-review/volga-dash/` (not committed): `gaz*-seat.png` (driver's eye, 80 km/h etc.), `gaz*-door.png` (through the open driver's door), `gaz*-controls.png` (wheel turned, glovebox open, light switch clicked, indicator on, 120 km/h), `gaz*-seat-night.png` (22:00, lights 1: panel lit), `gaz*-lod-pair.png` (5.6 m | 6.4 m, the fine detail going at `KIT_FINE_M`), `gaz*-exterior-34.png`, and `gaz*-vs-photo.png` (Commons photo | kit). `tools/kit-zfight.ts kit_gaz24 kit_gaz31029`: PASS. Triangles (`buildKitCar`, README method): GAZ-24 13 366 → **13 286** (cabin 4 209 → 4 129, of it fine 1 747 → 1 529); GAZ-31029 11 888 → **12 125** (cabin 4 247 → 4 484, fine 1 747 → 1 481). Body, bay, boot, underbody, far unchanged.

### 4.6 Gaps

- No dash drawing and no photo with a scale: everything hangs on the shell's dash width (24) or seatX (31029), heights on one estimated anchor each [E].
- GAZ-24: the panel's lamps' functions, the knobs' functions, the ammeter (drawn on the voltmeter's channel); the clock is round (square on the car); the kit's standard radio and hazard button stand in for the period ones; the "Волга" script on the horn bar is not drawn. The early car's aluminium band is drawn (the II series has a wood-look band, the photo kept for reference).
- GAZ-31029: only one interior photo; the combined gauge's scales other than fuel, the passenger's end of the dash, the ashtray and the warning lamps' places are estimates. The pad wheel is the kit's pad on three spokes, not the moulded one-piece centre.
- Both Volgas' seats are still the classic's; seatX moved them 3 cm outboard with the column.
