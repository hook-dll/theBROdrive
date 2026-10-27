# VAZ Samara family: measured numbers for 2109 / 21099 / 2115

Crops, gridded readings, photos, overlays and lab captures are in `/tmp/samara/` (the 2115 details of §3.3–3.6: photos in `/tmp/samara/ph2/`, crops and lab captures in `/tmp/k2115/`). Only this file, the code and the drawings in `build/carshape/_refs/bp/img/` were written.

Frame and tags as in `measurements-classics.md`:
- **Body:** `s` rearward from the tip of the front bumper, `y` above the ground; mm in the tables, metres in the spec.
- **Faces:** `x` is a half width from the centre line.
- **Tags:** **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate (reason given).

All three are measured **in the 2108's frame** (`BODY_2108`, the 2108 drawing at 3.826 mm/px): the front, the floor, the greenhouse heights and the tailgate are the same stampings. Only what differs is new:
- 2109: the doors, the B pillar and the quarter light;
- 21099: the doors, the C pillar, the back light, the boot and the tail;
- 2115: the 21099's body with its own boot lid, tail, bumpers and face. Its longer front bumper moves the whole body 45 mm back from the tip, so `BODY_2115` is written in the 2108 frame and placed with `onBody(BODY_2115, 0.045, 4.33)`. 2115 figures below are in the **2115's own frame** unless marked "body frame" (= 2115 frame − 0.045).

## 0. Sources and scales

### Factory figures

| Car | Length × width × height | Wheelbase | Tracks | Clearance | Source |
|---|---|---|---|---|---|
| 2109 | 4006 × 1650 × 1402 | 2460 | 1400 / 1370 | 160 | `sv_vaz2109` row (unchanged) |
| 21099 | 4205 × 1650 × 1402 | 2460 | 1400 / 1370 | 160 | `sv_vaz21099` row (unchanged) |
| 2115 | 4330 × **1650** × 1402 | 2460 | 1400 / 1370 | 170 | vaz.ru/v2115.htm (4330 × 1650, height 1415), drom.ru catalogue (4330, 2460, 1400/1370, clearance 170), autoiwc.ru (height 1402) [F] |

The brief said 1680 for the 2115's width. No source gives it; every factory source gives **1650**. The two published heights are 1415 and 1402; 1402 (the 21099's) is used.

### Drawings (`https://3dcar.ru/media/blueprints/full/vaz/<name>.jpg`, saved to `build/carshape/_refs/bp/img/`)

| File | Size | Scale | Notes |
|---|---|---|---|
| `vaz_2109.jpg` | 2400×1300 | **side 2.7313 mm/px**, registered by least squares on seven features the 2109 shares with `BODY_2108`: bumper tips x 866 / 2336 → 0 / 4006, front door's front edge 1332 → 1278, cowl 1305 → 1232, roof front 1490 → 1760, tailgate hinge 2030 → 3190, knee 2290 → 3930. s = 2.7313·x − 2345.9 mm; residuals −36…+28 mm. | Undimensioned, no wheels drawn. Heights not used (2108's). Its door lines in the middle stand **≈ 0.1 m behind** both the photo `p1` and the 21099 drawing (§1), so only the shapes of the rear door's frame, glass and quarter light were taken from it, shifted −0.093. |
| `vaz_21099.jpg` | 1700×1000 | **side 4.036 mm/px** from the drawn wheelbase: hubs x 756.5 / 1366 (hub circles 741–773 / 1350–1383), tyre bottoms y 412. The tips x 565 / 1603 give overhangs 773 / 957 and 4189 overall (−0.4 % on 4205). s = 0.785 + (x − 756.5)·0.004036, front hub on the 2108's 0.785. **Heights by the 2108 shell's belt and sill**: window-sill line y 192 → 0.911, sill y 350 → 0.264, 4.095 mm/px; y = 0.911 − (y_px − 192)·0.004095. Rear view 4.25 mm/px from the 1650 width (body x 70–458, centre x 264); top view across 4.27 mm/px. | By its belt/sill scale its roof is 1.402, the passport height; the 2108 drawing's roof is 1.335 (see §5). |
| `vaz_2115.jpg` | – | – | Does not exist (404). The site's VAZ list has no 2115. The 2115 is measured on photos. |

### Photos (Wikimedia Commons, 1600 px renditions, in `/tmp/samara/ph/`)

| Local | Commons title | Licence | Used for |
|---|---|---|---|
| `p1` | Lada Samara 2109 in Kraków (5).jpg | CC BY 3.0 | **2109 right side**, near-orthographic. Hubs x 1554 / 383 → **2.10 mm/px**; s = 0.785 + (1554 − x)·0.0021. Door lines. |
| `p7` | VAZ-21099.jpg | CC BY-SA 3.0 | 21099 left 3/4: the rear door's drop glass ends at a raked channel with a fixed glass behind it. |
| `p19` | 2005 Lada 21150 purple side.jpg | CC0 | **2115 left side**, near-orthographic. Hubs x 371 / 1456, y 541 → **2.267 mm/px** on the side plane, ground y 665. s = 3.29 + (x − 1456)·0.002267, y = (665 − y_px)·0.002267. |
| `p12` | 2008 Lada Samara 211540 rear.jpg | CC0 | 2115 rear: lamp layout, lid shut line, plate scale (520 mm = 346 px). |
| `p13` | 2010 Lada Samara 211540 dark green rear view.jpg | CC0 | 2115 rear 3/4: lamp height against the bumper's. |
| `p15`, `p20` | 2010 Lada Samara 211540 dark green front view.jpg, VAZ-2115.jpg | CC0, PD | 2115 face; `p20` (front left 3/4, plate 520 mm) also the fog lamps. |
| `f1`–`f5` (`ph2/`) | 2010 Lada 211540 blue front.jpg, 2004 Lada Samara 21150 blue front.jpg, 2005 Lada 21150 silver front.jpg, 2004 Lada 21150 dark green front.jpg, 2010 Lada 211540 silver front.jpg | Commons (licences not checked; used for reading only) | 2115 front 3/4s. `f5` is the nearest to frontal: the head lamp's outline. `f2`–`f4` and `p19`: grey mouldings on the doors and a grey band round both bumpers; `f1`: the same in body colour. |
| `p17`, `p18` | 1999 VAZ 21099 white rear.jpg, 2003 VAZ 21099 blue rear.jpg | CC0 | 21099 lamp cells; `p18` (left rear 3/4) also the rear door's channel, fixed glass and the C pillar, about as wide as the fixed glass and even along its length. |
| `p11` | VAZ-2115 "Pyatnashka" (4936805781).jpg | CC BY-SA 2.0 | 2115 right side: the fuel flap is on the **right** rear wing. |

---

## 1. Doors (2109 and 21099; s in the 2108 frame)

| Feature | 2109 drawing (registered) | 21099 drawing | Photo `p1` (2109) | Spec |
|---|---|---|---|---|
| Front door, front edge at the belt | 1292 | 1251 | 1239 | **1.278**, the 2108's A pillar, kept so the shared front is unchanged |
| Front door glass, rear edge | 2330 | 2191 | – | **2.19** |
| Front/rear door shut line at the belt | 2363 | 2240 | **2230** | **2.225 / 2.235** (front door ends, rear door starts) |
| Rear door glass, front edge | 2393 | 2313 | – | **2.29** (frame strip from 2.265) |
| Rear door shut line at the belt / at the rail | 3218 / 2967 | **3120 / 2849** | **3129 / 2881** | 2109: **3.125 / 2.875** (drawing shape −0.093, onto the photo); 21099: **3.12 / 2.85**, one line from sill to rail (§1.1) |
| Rear door glass, rear edge foot / head | 3109 / 2931 | 3015 / 2833 | – | 2109: **3.016 / 2.838**; 21099: **3.095 / 2.825** |
| Quarter light, front edge foot / head | 3231 / 3008 | 3168 / 2902 | 3116 / 2893 | 2109: **3.145 / 2.915**; 21099: **3.14 / 2.87** (both in the body) |
| Quarter light, rear edge foot / head | 3513 / 3144 | 3414 / 2993 | – | 2109: the 2108's **3.57 / 3.12** (same panel); 21099: **3.385 / 2.945**, the C pillar's front edge |
| Handles (centre) | 2.05 / 3.08 | – | 2.08 / 2.99 | the generator's rule, 0.13 ahead of each door's rear frame: 2.095; rear 2.886 (2109), 2.965 (21099) |

- The B pillar above the belt is body between the two door frames: 2.225–2.265, with 30 / 25 mm frame strips on the doors. Below the belt the doors meet on one shut line.
- The rear door reaches over the rear arch (front of the arch 2.885); the generator cuts it round the arch's lip.
- The rear door's glass is a drop glass; its rear edge rakes with the frame and turns vertical in the last 30 px of the 2109 drawing (a channel). It is modelled as one raked pane; lowered, it stays inside the door (checked in the lab).
- Overlay checks (`/tmp/samara/ov_2109ps.png`, `ov_2109s.png`): the model's B and rear shut lines fall on the photo's within a few mm at its scale; on the 2109 drawing they stand ~0.1 m ahead of its lines, as the table says.

### 1.1 The 21099's rear door, quarter light and C pillar

The rear door's frame ends at its drop glass's channel. Its rear edge is the door's shut line carried on up, so the shut line is one raked line from the sill to the rail. Behind the door the body carries a small fixed quarter light, and behind that a C pillar of even width, parallel to the back light [P p18, a 2115's rear 3/4 (silver, supplied by the owner), D].

Readings: each line of the 21099 drawing is carried to the belt (y 187) and to the rail (y 89), the heights a cabin column's `s` and `top` stand at.

| Line | Drawing (px) | At the belt / at the rail | Spec column (s / top) |
|---|---|---|---|
| Drop glass, rear edge | (1270, 99) → (1309, 165), then vertical | 3.015 / 2.833 | **3.095 / 2.825** |
| Door shut line (and the door frame's rear edge above the belt) | double line (1274, 95) → (1340, 210), vertical at x 1340 below the belt | 3.088–3.14 / 2.857 | **3.12 / 2.85** |
| Quarter light, front edge | (1290, 102) → (1340, 176) | 3.168 / 2.902 | **3.14 / 2.87** |
| Quarter light, rear edge = C pillar's front | (1316, 102) → (1390, 170) | 3.414 / 2.993 | **3.385 / 2.945** |
| Back light's edge (C pillar's rear) | (1340, 82) → (1445, 170) | 3.645 / 3.172 | the last column, **3.58 / 3.14** |
| C pillar, horizontal width | quarter light to back light: 0.19 at its top, 0.22 at its foot | – | **0.195**, the same at the belt and the rail (parallel) |
| Quarter light width, foot / top | 0.20 / 0.105 | – | 0.245 / 0.075 |

- The drop glass's rear edge stands 80 mm further back at the belt than drawn. The drawing's channel and frame strip are 0.15 m wide at the belt; this way the drop glass stays a full pane and the door's frame a 25 mm strip on the shut line, as on the photos.
- The quarter light's rear edge is made exactly parallel to the generated back-light edge (Δs 0.44 from the belt to the rail) instead of the drawing's slightly steeper line, so the C pillar is of even width.
- Lab: closed from the owner's rear 3/4 angle and straight from the side; the rear door opens with its frame and drop glass only, the quarter light and the C pillar stay on the body; it closes flush; the lowered drop glass stays inside the door.

## 2. VAZ-21099 tail (2108 frame; 21099 drawing)

| Feature | Reading (x, y px → s, y) | Spec |
|---|---|---|
| Roof's rear end at the rail | x 1340 → 3.14 | last column `top` **3.14** |
| Back light's foot (side / centre) | x 1445–1450, y 172 → 3.564–3.584, 0.993 | last column `s` **3.58** (`rearBase`); deck **0.995** at 3.6 |
| Boot lid top on the centre line | 3.786 / 0.993, 3.988 / 0.956, 4.068 / 0.94, 4.109 / 0.903 | stations 3.95 deck **0.97**, 4.10 deck **0.925** |
| Boot shoulder along the side | y 181–191 → 0.956–0.915 | belt **0.92 / 0.93 / 0.905** |
| Lid's rear face down to the lamps' top | x 1580–1588, y 194 → 226: 4.11–4.14, 0.903 → 0.772 | `bootEnd` **4.14** (the lid ends 0.81 high, 30 mm over the lamps) |
| Tail face | x 1590–1595 → 4.15–4.17 | last station **4.15**, belt **0.765** (deck edge 0.78) |
| Lamps on the side | y 226–268 → 0.772–0.600 | – |
| Rear bumper | y 268–322 → 0.600–0.379; tip x 1603 → 4.201 | moulded, drop 0.03, height **0.23** → 0.365–0.595 |
| Plan at the tail (top view) | half 0.825 at s 2.98 → 0.752 at the corner, s 4.13 | wCrease 0.815 → 0.80 → **0.785** |
| Fuel flap | x 1450–1500, y 237–268 → s 3.584–3.786, y 0.727–0.600; drawn on the **left** (the drawing is mirrored: Samaras fill on the right, `p11`) | s **3.60–3.78**, y **0.61–0.725**, right side |
| Rear lamps (rear view) | x ±(0.302..0.714), y 694–728 rear-view px; bumper 735–785 | cluster from `centre 0.30` to `inset 0.06`, bumper top + 0.012 to deck − 0.018 |

Lamp cells, outside in [P p18]: amber; red; red over the white reversing lamp; red. Roles: `blinker`, `tail`/`brake`, `tail`/`reverse`, `inert` (the inner red is the fog lamp) — the split of red cells into tail and stop is [INFERENCE].

The 21099's face is the 2108/2109's (the drawing's front view: lamps and a slotted panel). The late 21099's "high bonnet" face is not modelled.

Overlay check (`/tmp/samara/ov_21099.png`): below the belt the model lies on the drawing's outline from bumper to bumper, wheels and arches included. The greenhouse is the 2108 shell's, ~60 mm lower than this drawing's (§5).

## 3. VAZ-2115 (2115 frame; photo `p19` unless marked)

### 3.1 Length

- `p19` tips x 41 / 1872 give raw overhangs 748 / 943 (sum 4151 against 4330). The bumper tips lie on the centre line, ~0.8 m further from the camera than the side plane the scale is taken on.
- Proportioned to the factory 1870: **827 / 1043**. Corrected for that depth with the camera at ~17 m (the distance at which the rear tip lands on 4.33): front 848.
- Spec: front overhang **0.830** (the 2108's 0.785 + 0.045), rear **1.040**. Every 2115 s below is the body frame + 0.045.

### 3.2 Tail

| Feature | Reading | Spec (2115 frame / body frame) |
|---|---|---|
| Back light's foot at the side | x 1600 → 3.616 (21099 3.584 + 0.045 = 3.629) | the 21099's, 3.625 / 3.58 |
| Lid's side edge turns down to the lamps | x 1822 → 4.120 | – |
| Lid's trailing edge (corner) | x 1837, y 254 → 4.154, 0.932 | station **4.15 / 4.105**, deck **0.94**, belt 0.915 |
| Lamps | bottom y 397 → 0.608 (bumper top 0.601); height 0.16 [P p13: lamp 98 px, face above it 110 px, bumper 185 px = 0.306 m] → top 0.765 | corners topped at **0.765** (belt 0.75 + rise) |
| Tail face | ≈ 4.19 | last station **4.195 / 4.15**, `bootEnd` = the same: the lid comes down the face |
| Lid's foot between the lamps | 0.61 [P p12, p13] | deck **0.61** on the last station |
| Lid's side edge between lid and corner lamp | slants from ±0.58 at the lamps' top to ±0.54 at the foot [P p12] | `notch` **0.575**, wall 25 mm (`NOTCH_WALL`) |
| Rear bumper | y 400–535 → 0.601–0.295; body colour | moulded, finish paint, drop **0.04**, height **0.306**, tail sill 0.30 |
| Spoiler | tip 4.177–4.183, 1.026–1.03 high | §3.5 |

Lamps across the back [P p12, plate scale 1.5 mm/px; p13]:
- corner units on the body, from ±0.56–0.58 out to the corner: amber outer cell (~0.09), red; the amber wraps round the corner and 0.11 along the wing [P p19: 40 px at 2.78 mm/px from the hubs]. Spec (since the fourth review): rear `cornerLamps` (body frame) blinker from x 0.69 round the corner to s 4.085, tail over brake from 0.585 to 0.69, split at 0.68; from the bumper's top + 0.01 (0.611) up to the tail's belt **0.75** (not the corners' top, 0.765), so the lens stays on the flat face and side and the corner's shoulder above it is a straight cut. Before, a face cluster `centre 0.585` → `inset 0.01`;
- on the lid, ±(0.38..0.56): red with a white square in its middle. Spec: lid cluster `centre 0.4` → `0.565`, columns `tail`, `reverse`, `tail`;
- between them, the dark red bar ±0.38 (reflector). Spec: lid lens `inert`, `centre 0` → `0.39`.

### 3.3 Face [P f5, p20, p15, p19]

No drawing of the 2113–2115 face exists on 3dcar.ru (the 2114 / 2113 / 2115 names return 404), so the face is read off front 3/4 photos. Across the face, a 1-D projective map (u = (pX + q)/(rX + 1)) was fitted per photo to symmetric pairs of edges, with the outer end of the unit on the wing's ±0.69 (the 2108's, the same stamping):

| Feature | `f5` | `p20` | Spec (half width) |
|---|---|---|---|
| Head lamp, inner end | 0.312 | 0.294 | **0.30** |
| Head lamp / indicator joint (mean of bottom 0.549 and top 0.58, `f5` close-up at 0.283 mm/px) | 0.580 | 0.585 | bottom **0.549**, top **0.58** (the joint leans out 31 mm at the top) |
| Unit's outer end | 0.69 (fixed) | 0.69 (fixed) | **0.69** |
| Slot ends | – | ±0.272 / 0.267 | **±0.285**, reaching the lamps' inner ends |

Heights (`p19` side, 2.267 mm/px; `f5` close-up 0.284 mm/px vertically):
- the unit 0.655–0.76 (105 mm): `bumperTop` + 0.03 to `deck` − 0.03 (face lines 0.625 / 0.79);
- the head lamp's top is level from the joint to 0.068 short of its inner end, then slopes **45 mm down** to the inner end, where it meets the bonnet's lip (`f5`: the lip runs into the lamp 46 % down its height). The inner end is upright below that, its bottom corner cut 20 × 14 mm;
- the indicator rounds off the outer end: top corner cut 25 × 24 mm, bottom corner 31 × 35 mm; it wraps round the wing's corner and shows from the side back to s **0.205** (`p19`: x 60–107 at 2.78 mm/px from the hubs, 0.60–0.71 high on that photo's perspective);
- spec (since the third review, the unit flush with the body and wrapping): `cornerLamps` points (2115 frame) head at x 0.30 (0.669–0.715), x 0.32 (0.655–0.728), x 0.368 (0.655–0.76), the joint [0.549, 0.58]; blinker from there to the corner and along the flank to s 0.19 (0.665–0.75), ending rounded at s 0.205 (0.68–0.735). Before, two face `lens` items with `chamfer` and negative `slant`, standing 22 mm proud of the face and stopping at its edge;
- the slot lies under the bonnet's lip at mid-height of the lamps: 0.70–0.72 [`p20`: 0.702–0.733; `f5` lip 0.714]. Spec: `deck` − 0.095 to − 0.07, dark back, one bright bar. Below it the face is body colour down to the bumper.

Body-colour front bumper, deeper than the 2108's: drop 0.07, height 0.30 (0.325–0.625); a dark lower intake ±0.30 at bumper bottom + 0.085..0.15 [P p20: 0.425–0.47 under the plate].

### 3.4 Fog lamps [P p20, f2–f5]

Rectangular, in black housings in the bumper's face outboard of the intake (some cars have blanks; the photos with lamps are used). On `p20`, the same projective fit on the plate's edges (±0.26) and the lamps' edges: lens **±0.41..0.54**, housing **±0.37..0.58** (residuals up to 30 px: ±20 mm). Heights by the bumper's band (0.325–0.625 ≈ 300 px at the lamp, 1 mm/px): lens 0.37–0.45, housing 0.36–0.46. Spec: `panel` pairs (a span `x`), housing black at bumper bottom + 0.035..0.135, lens + 0.045..0.125; standing 153 / 157 mm out of the face, at most a few mm proud of the bumper and inside its tip (the car's length is unchanged). There is no fog-lamp channel in `vehiclelamps.ts` / the rig, and the `inert` slot is the red rear reflector colour, so the lens is an unlit bright finish (`chrome`) rather than a lamp role.

### 3.5 Boot-lid spoiler and high brake lamp [P p19, p12]

Side `p19` (2.267 mm/px, s = 3.29 + (x − 1456)·0.002267, y = (665 − y_px)·0.002267):

| Feature | Reading (px) | s, y | Spec |
|---|---|---|---|
| End plate's foot on the lid | (1712, 236) | 3.871, 0.973 | `foot` **3.87** |
| Wing's trailing top | (1847, 212) | 4.177, 1.026 | `s1` **4.177**, `top1` **1.026** |
| Under the trailing edge, on the lid's edge | (1837, 249) | 4.155, 0.944 | the plates and pedestal end at **4.145**, just ahead of the lid's trailing edge (station 4.15) |
| Top line, foot → tip | – | 0.973 → 1.026 | `s0` **4.015** at `top0` **0.998**, on that line |

Rear `p12` (projective fit on the lid's trailing corners ±0.69, the lamp's ends and the wing's ends; residuals ≤ 16 px): wing **±0.62**; the lamp **±0.105**. Thicknesses at the middle against the plate scale (1.5 mm/px at the plate, ~0.77 px per crop px): the wing's back ~35 mm, under it a ~50 mm gap to the lid filled in the middle by a pedestal carrying the red lamp (~38 mm tall). Spec: `thickness` **0.035**; pedestal ±0.13 from s 4.06 to 4.145; lamp 0.947–0.982, on the pedestal's back in a black surround.

The wing's ends come down to the lid as end plates 50 mm wide, running forward to the foot; the plates' and pedestal's lower edges follow the lid through its stations and sink 8 mm into it. The whole spoiler is built in the boot lid's node, so it lifts with the lid (lab: lid open, no poke-through), and is body colour (`paint` slot). The lamp's lens is in the `lamp_brake` slot, so its mesh is one more `kit_brake` and it lights with the brake lamps (lab: night, `brake` 1 with lights off, it lights with the corner stop cells; both off, dark).

### 3.6 Mouldings [P p19, f2–f4]

`p19` columns through the doors (the grey band is bluer than the paint): top **0.528–0.537**, bottom 0.435–0.44 (front door 0.542 / 0.435 by eye; rear door 0.533 / 0.442). Spec: `waist` y **0.4875**, height **0.095**, finish **`grey`** (unpainted grey plastic, a trim vertex colour; `f1` shows body-colour ones). It runs from nose to tail, broken at the shut lines and stopping 30 mm short of each wheel arch (the band passes below the arches' tops at 0.64); under the bumpers' wraps it is hidden. The bumpers carry the same band in place of their groove (moulded bumper `moulding`): front 0.483–0.558 (`p19` front crop) → y **0.52**, height **0.075**; rear 0.438–0.519 (`p19` x 1800) → y **0.478**, height **0.08**.

### 3.7 Bumpers after the 2026-10-15 review ("the rear bumper too massive against the front")

| Feature | Reading | Spec |
|---|---|---|
| Rear bumper's side | [P p19 right side: the bumper and its grey band run on along the wing to the rear arch's back; P p13 rear 3/4: the bumper's side lies in the wing's line, no step] | rear moulded bumper `flush`, `wrapTo` **3.675** (the rear arch's back at 3.65 = 3.29 + 0.281 · 1.28); height **0.306** and drop 0.04 kept (§3.2) |
| Corners | – | both bumpers' corners (radius 0.09) are one flat chamfer from the flank, level with the end face, to the face (generator, `BUMPER_CHAMFER` 0.15): the front face is flat to ±0.676, the rear to ±0.656 |
| Front fog lamps | kept on the bumper's flat face, 15 mm inboard of where it turns into the chamfer | housing **±0.505..0.675** (was 0.52..0.69), lens **±0.535..0.645** (was 0.55..0.66); heights unchanged |

## 4. Generator changes

1. **`TubStation.notch`** (body.ts `BodyFrame.lidX`, `deckY`, `deckFracs`). On a notched station the deck lies level at `deck` out to `notch − NOTCH_WALL`, rises in a 25 mm wall to the deck edge's height and stays level to the side. The lid is cut along `notch` instead of the pillar row (`lidX`), linearly between stations. This is the flat-bottomed lid between lamp corners that `measurements-estates.md` §3.1 asked for; the 2115 is the first car to use it. bay.ts's boot walls and bulkheads follow `lidX`.
2. **`FaceLook.lid`** (exterior.ts `buildLidFace`): face items built on the end face but hung on the boot lid or tailgate node, so the 2115's lamp bar lifts with the lid. Their lens meshes keep the lamp names, so the rig and `VehicleLamps` light them as any other.
3. **Moulded bumper `finish`** (exterior.ts): absent keeps the dark plastic colours as they were; `paint` makes a body-colour bumper whose groove is a ridge in the same paint.
4. **Saloon boot end** (bay.ts `buildSaloonBoot`): the boot's rear bulkhead stays 5 mm inside the tail face when the lid comes down to it (`bootEnd` = the last station).
5. **Lens `chamfer`** (removed at the third review, when the 2115's lamps became a `cornerLamps` unit; no other car used it): each corner of a lens could be cut by [along the top or bottom edge, along the end edge].
6. **`panel` with a span `x`** (exterior.ts): a block on each side instead of one across the centre line (the fog lamps and their housings).
7. **`Finish 'grey'`**: unpainted grey plastic, the trim slot with a vertex colour (no new material).
8. **Moulded bumper `moulding`** `{ y, height, finish }`: a band round the bumper in place of the groove.
9. **`waist` stops at the wheel arches**: a strip low enough to meet an arch (grown by 30 mm) is cut there. The classics' waists run above their arches, so they get no new cut.
10. **`KitLook.spoiler`** (spec.ts `SpoilerLook`, exterior.ts `buildSpoiler`): wing, end plates and pedestal in the paint slot and the lamp in `lamp_brake`, built into the boot lid's node.

**Proof that nothing else moved.** Every existing kit car (2101–2108) was built from the committed code in a `git worktree` and from the working tree; all triangles in the car frame were sorted and hashed. All eight hashes, triangle counts and bounds are identical. The 2108: 10 226 triangles, bounds ±0.970 × 0…1.335 × ±2.009 m, before and after. After the 21099 rear-door rework (§1.1) the same check against commit d85752e: 2101–2109 identical; only the 21099 (11 707 triangles) and the 2115 (11 738) changed. After the 2115 details (§3.3–3.6, changes 5–10) the same check against commit c86627d: 2101–21099 identical (hash, count, bounds); only the 2115 changed, 11 738 → **12 092** triangles, bounds unchanged (±0.970 × 0…1.335 × −2.171…2.171 m), so its fit row comes out the same.

**After the third owner review (with the 2110).** 11. The boot lid where it comes down the tail (`BodyFrame.lidFace`): its top turns down to a line across at the corner lamps' top (0.765, 2115 frame) and its rear panel lies in the tail face between the lamps; the shut line runs from the trailing corner (±0.69, 4.15) diagonally to the lamps' top (±0.575) and down the notch wall, as on `p12`. 12. The head-lamp unit is a `cornerLamps` unit (§3.3). Proved: 2101–21099 identical against cfff462; the 2115 12 092 → **12 136** triangles, bounds unchanged.

**After the fourth owner review.** 13. The tail lamps are rear `cornerLamps` units (§3.2). 14. **The face rakes back** (`KitCarSpec.frontLean` on `BODY_2108`, so the 2108, 2109, 21099 and 2115): the 2108 drawing's side view has the bumper's top at s 0.10, 0.625 high, and the bonnet's lip at s 0.164, 0.803 high [D]; the 2115's photos (`ph2/f1`–`f5`, `p19`, `p20`) show the same face leaning back above its bumper. Spec: base **0.625**, lean **0.36** m per m (0.064 over 0.178), blend 0.15 behind the bonnet's front edge (0.17). Everything above the bumper ahead of the bonnet's edge (face, lamps, slot or panel) shears back in one plane; the bumper stays upright. Before, the face was upright and the bonnet's lip overhung the lamps' bottom. Proved: 2101–2107 identical against cfff462 (the estates' `rearLean` now runs through the same `leanEnd`); the Samaras' triangle counts and bounds unchanged (2108 10 226, 2109 11 350, 21099 11 707, 2115 **12 112**).

**The 2112 round (owner's reviews).** 15. **Screen and A pillar** [D 2108 side view, silhouette read every 5 px]: the screen's centre line comes up from the bonnet (0.92) at s ≈ 1.08 at 0.6 m per m to the roof; `screenFoot` **0.15** ahead of the cowl (1.232), the bonnet's rear edge with it. The drawn A pillar rounds into the roof over 1.70–1.77: the pillar column's top point `drop` **0.03** below the rail (at 1.76), the door frame's and glass's tops moved back to **1.84 / 1.865** to meet the chamfer; the 2109, 21099 and 2115 share these columns. 16. **Rear-quarter seam** (2108, 2109): the greenhouse's foot gets a point at the stations 3.6 and 3.86 between its columns (the tub's edge bends there by 14 / 6 mm). 17. **The 2115's own nose** [P owner's front photo, 3.59 mm/px from the plate; 3/4 photo]: lamps from 0.41 to 0.97 of the half width, 0.122 tall; bumper top 3 cm under the lamps, 0.27 deep, the grey band 0.065–0.136 under its top, a dark recessed strip 0.18–0.22 under it, a short apron. Spec (body frame): face station at **s 0** (0.77 wide at the lamps, belt 0.775, deck 0.79), s 0.17 0.785, s 0.5 0.79; `bonnetFront` **0.1**; the lamp unit 0.30 → joint 0.65 / 0.68 → corner → s 0.11 / 0.125 (car frame), **0.645–0.772**; bumper `flush`, drop **0**, height **0.27**, `wrapTo` 0.45, band and door mouldings **y 0.505, height 0.09** (within the doors' measured 0.435–0.537); intake ±0.5 at bumper bottom + 0.045..0.09; fog lamps ±0.52..0.69 at + 0.02..0.10. 12 309 triangles. The 2108, 2109 and 21099 keep the 2108 nose (lamps ≈ 0.85 of the half width on the 2108 drawing, as modelled).

**Kit-check (2026-10-19), the bonnet's lip.** The built bonnet started at 0.232 against the drawn lip at s 0.164 [D]: `bonnetFront` 0.17 left the deck strip from the face's top to the wing's corner on the body. `bonnetFront` is now **0.11** (the face station, as the Nexia's) with `frontLean.full` **0.17**, so the shear is the one above (in full to the corner, faded over 0.15 behind it) and the bonnet's centre line starts at 0.173. A try at 0.102 put a tub column ahead of the face: a level 8 mm strip, then the 32° climb to the corner, a 32° dent at s 0.17 (kit-surface). The 2115 keeps its own `bonnetFront` 0.1 and the lean in full ahead of it. With the bay open behind the face, the head lamp's and indicator's facing walls (5 mm apart) fought at range: the head lamp now ends at ±0.618 (indicator 0.625–0.69 as measured). The first two stations need no `corner` mark: kit-surface takes the nose's first turn as drawn.

## 5. Gaps

- **Greenhouse heights.** All four share the 2108 drawing's greenhouse (roof 1.335). The 21099 drawing, scaled on the 2108's belt and sill, has its roof at 1.402. The loader fits every body to the passport height (1402), so the shell grows 5 % as a whole; the glass stays ~60 mm shallower relative to the body than on the 21099 drawing.
- **2109 drawing.** It is undimensioned, and its door lines disagree with the photo and the 21099 drawing by 0.1 m; the photo was used. Its quarter light's rear edge (3.513 / 3.144) disagrees with the 2108's panel (3.57 / 3.12) by 57 mm; the 2108's is kept.
- **Front door's front edge.** The photo (1.239) and the 21099 drawing (1.251) put it 27–39 mm ahead of the 2108's 1.278, which is kept so the shared front stays identical.
- **2115 not modelled:** the plate recess in the rear bumper, the side repeaters (`p19`: s 1.14–1.21, y 0.676–0.703 on the front wing), the bonnet's lip as a separate part (it is the painted face). The fog lamps never light (no fog-lamp channel). The high brake lamp is in the brake slot, so like every kit brake cell it also glows at tail level when the lights are on; a real one lights with the brake only. Above the flush rear bumper's side a thin dark line shows where the body tucks under its crease, and a dot where the body's corner meets the bumper's flush top.
- **Rear door handles** come from the generator's rule (0.13 ahead of the door's rear frame): 2.886 on the 2109 against its photo's 2.99.
- **21099 drawing vs the rear door.** The drop glass's rear edge is moved off the drawn line for the reasons in §1.1.
- **Tail-lamp roles.** Colours are measured; which red cell is tail and which is stop is [INFERENCE] on the 21099 and the 2115.
- **2115 overhang split** rests on one near-orthographic photo corrected for depth (±20 mm); the factory gives only the 4330 total.
- **Front wing vs door (§6).** The wing's shoulder line is on the drawn 0.705, but the doors' crease row stays at 0.63–0.64 (the drawings put the line at 0.71 on the doors too), so behind the arch the line comes down 75 mm to the door. The 2115's own nose stations keep the old wing (crease 0.6 under the arch's lip).

## 6. Front wing (2108, 2109, 21099; 2108 frame)

Owner (2026-10-16): the front wing in front of and above the front arch is over-complicated, too many breaks and facets.

**Registration.** 2108 side view: front hub x 829.3, ground y 431, 3.826 mm/px, so s = (x − 623.8) / 261.37 and y = (431 − y_px) / 261.37 (the bumper tips 622 / 1669 land on 0 / 4.006). Top view: the same s; centre line y 811.5, across 3.88 mm/px (1620 = 417.5 px at s 1.8); half widths below are scaled by 0.825 / 0.81 onto the model's cabin. Photos and the other drawings as in §0 (the 2109 drawing's heights registered on the belt 0.911 at y 250, isotropic, for this comparison only).

| Feature | Reading | Spec |
|---|---|---|
| Shoulder line (the side's crease) | 2108 [D]: y_px 250 at x 695, 248.5 at 700, 247 at 710–750, 246–246.5 at 780–800, 245.5 at 930–945, 245 along the door → **0.69** at s 0.27, **0.698–0.710** from s 0.29 to 1.23, 0.71 on the door. 2109 [D]: 0.697 / 0.708 / 0.71 / 0.717 / 0.721 at s 0.35 / 0.5 / 0.6 / 0.785 / 1.0. 21099 [D, heights 5 % high, §5]: 0.716 → 0.737 over the same s. Photo `p1`: 0.675 at s 0.31, 0.69 over the hub, 0.708 at the door [P] | `crease` **0.705** at s 0.425, 0.5 and 0.878 (was 0.6 → 0.63) |
| Arch, radial from the hub (829.3, 357.6) every 10° [D] | opening 93–94 px = **0.359**; the flare's crest 101–102 px = 0.388; its outer edge 105–108 px = **0.40–0.41** from 50° to 130°, broken at the top, where it comes within 20 mm of the shoulder line (0.685 against 0.705); the tyre 71 px | arch 0.281 × 1.28 = 0.360 and `ARCH_LIP` 0.045 → lip 0.686 at the top: unchanged, now 19 mm under the crease |
| Widest line in plan [D top] | half 0.757 / 0.765 / 0.775 / 0.776 / 0.788 / 0.80 / 0.81 / 0.807 / 0.812 at s 0.14 / 0.215 / 0.29 / 0.37 / 0.52 / 0.67 / 0.865 / 1.06 / 1.25 | `wCrease` **0.77 / 0.775 / 0.801** at s 0.425 / 0.5 / 0.878 (was 0.81 / 0.815 / 0.82), the door's 0.825 at 1.232 |
| Lean of the face above the shoulder line (the widest line against the wing's top, `wBelt`) | 0.28 / 0.25 / 0.18 / 0.06 m per m at s 0.52 / 0.67 / 0.865 / 1.06 | **0.244 / 0.2 / 0.124** at s 0.425 / 0.5 / 0.878, the door's 0.056 at the cowl; the corner's 0.45 at s 0.17 kept |

**What made the facets.** The crease row (0.6 at s 0.5, 0.63 at the cowl) ran under the arch's top (0.641) and its lip (0.686). Every side row below the lip is lifted onto it (body.ts `sideColumn`), so from s ≈ 0.55 to 1.0 the crease lay on the lip in some arch columns and at its own height in the next, and the faces between cut diagonally across its 15° kink: fans of thin triangles up to 22° apart. Above it, the face's lean turned from 0.283 (16°) at s 0.5 to the door's 0.056 (3°) across the twelve arch facet columns, which the 0.73 / 0.83 flap rows cut into thin strips.

**Spec** (samaras.ts `WING_FRONT`, `WING_MID`, `COWL`, `onRun`). Two stations on existing arch facet columns, s 0.42532 and 0.878092 (0.785 − 0.35968 cos(i · 15°), i = 0, 7), so no tub column, bonnet face or sill moves: their belt, deck, sill and widths other than `wCrease` are the old ones interpolated (`onRun`). The arch and its lip now always lie under the crease, the face above it is cut by no arch row, and the turn of its lean from the corner's 0.45 to 0.244 happens in the one wide strip in front of the arch (s 0.17–0.42), where it is one fold. The crease comes down behind the arch to the door's 0.63 (§5).

**Check** (left wing, s 0.17–1.235, y 0.45–0.95, faces of the body's paint; dihedral between neighbouring faces across their upright edges, i.e. columns and strip diagonals, not the rows):

| Car | Largest angle | Edges over 2° | Σ length × angle |
|---|---|---|---|
| 2108, 2109 | 22.4° → **6.9°** | 4.13 → **1.34** m | 21.4 → **11.5** m° |
| 21099 | 22.4° → **7.5°** | 6.94 → **1.81** m | 25.3 → **15.2** m° |

Proof against the tree before the change (`/tmp/cf/base.json`, triangles in the car frame at 1e-5 m, sorted, hashed): every other car identical in hash, count and bounds (the 2115 included: its stations take only the cowl and door from `SALOON_FRONT`), apart from the GAZ-24, GAZ-31029 and 2111, which a concurrent greenhouse change was moving. On the three, bounds unchanged; triangles 2108 / 2109 10 229 / 11 394 → 10 301 / 11 466, 21099 11 757 → 11 879; the triangles that differ lie in s 0.17–1.232, y 0.264–0.90, |x| 0.48–0.825, in three meshes only on each: the body's paint (the wing), its trim (the front arch's liner, whose edge follows the skin) and the engine bay's paint (its inner wings loft through the two new stations, within 1.7 mm of their old surface). `tools/kit-zfight.ts vaz2108 vaz2109 vaz21099`: PASS, 0 visible and 0 slits. Close-ups before and after over the drawings: `build/k/compare2/samara_<car>_wing_{before,after}_{side,side_lines,side_overlay,top_overlay,top_lines,q34,front}.png`.

## Arches to the drawings (2026-10-27)

Arch openings `[top, ahead, behind]` over the hub (m), refs → built before → after (kit-drawing; STATUS.md table, HISTORY):

- **vaz2108**: front 0.335 / 0.35 / 0.32: 0.36 / 0.36 / 0.358 → 0.352 / 0.358 / 0.326; rear 0.32 / 0.34 / 0.33: 0.36 / 0.36 / 0.36 → 0.32 / 0.34 / 0.35. BODY_2108: `arch` 1.28 → 1.22, `frontArchRise` 1.25, `rearArch` 1.228, `rearArchRise` 1.14, `archShift` [-0.015, 0.005]; the wing stations moved onto the new arch columns (0.42718, 0.858728).
- **vaz2109**: front 0.345 / 0.35 / 0.34: 0.36 / 0.36 / 0.358 → 0.352 / 0.358 / 0.326; rear 0.32 / 0.32 / 0.38: 0.36 / 0.36 / 0.36 → 0.32 / 0.34 / 0.35. BODY_2108 (as the 2108).
- **vaz21099**: front 0.375 / 0.365 / 0.33: 0.36 / 0.36 / 0.358 → 0.352 / 0.358 / 0.326; rear 0.33 / 0.345 / 0.33: 0.36 / 0.36 / 0.36 → 0.32 / 0.34 / 0.35. BODY_2108 (as the 2108).
- **vaz2115**: front 0.33 / 0.36 / 0.31: 0.36 / 0.36 / 0.36 → 0.352 / 0.358 / 0.328; rear 0.3 / 0.34 / 0.32: 0.36 / 0.36 / 0.36 → 0.322 / 0.346 / 0.346. BODY_2108, its own `archShift` [-0.015, 0] (the rear on its hub, P19).
