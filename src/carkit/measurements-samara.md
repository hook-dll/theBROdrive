# VAZ Samara family: measured numbers for 2109 / 21099 / 2115

Crops, gridded readings, photos, overlays and lab captures are in `/tmp/samara/`. Only this file, the code and the drawings in `build/carshape/_refs/bp/img/` were written.

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
| `p7` | VAZ-21099.jpg | CC BY-SA 3.0 | 21099 left 3/4: the rear door's raked frame with the fixed quarter light **in the body** behind its shut line. |
| `p19` | 2005 Lada 21150 purple side.jpg | CC0 | **2115 left side**, near-orthographic. Hubs x 371 / 1456, y 541 → **2.267 mm/px** on the side plane, ground y 665. s = 3.29 + (x − 1456)·0.002267, y = (665 − y_px)·0.002267. |
| `p12` | 2008 Lada Samara 211540 rear.jpg | CC0 | 2115 rear: lamp layout, lid shut line, plate scale (520 mm = 346 px). |
| `p13` | 2010 Lada Samara 211540 dark green rear view.jpg | CC0 | 2115 rear 3/4: lamp height against the bumper's. |
| `p15`, `p20` | 2010 Lada Samara 211540 dark green front view.jpg, VAZ-2115.jpg | CC0, PD | 2115 face. |
| `p17`, `p18` | 1999 VAZ 21099 white rear.jpg, 2003 VAZ 21099 blue rear.jpg | CC0 | 21099 lamp cells. |
| `p11` | VAZ-2115 "Pyatnashka" (4936805781).jpg | CC BY-SA 2.0 | 2115 right side: the fuel flap is on the **right** rear wing. |

---

## 1. Doors (2109 and 21099; s in the 2108 frame)

| Feature | 2109 drawing (registered) | 21099 drawing | Photo `p1` (2109) | Spec |
|---|---|---|---|---|
| Front door, front edge at the belt | 1292 | 1251 | 1239 | **1.278**, the 2108's A pillar, kept so the shared front is unchanged |
| Front door glass, rear edge | 2330 | 2191 | – | **2.19** |
| Front/rear door shut line at the belt | 2363 | 2240 | **2230** | **2.225 / 2.235** (front door ends, rear door starts) |
| Rear door glass, front edge | 2393 | 2313 | – | **2.29** (frame strip from 2.265) |
| Rear door shut line at the belt / at the rail | 3218 / 2967 | **3120 / 2849** | **3129 / 2881** | 2109: **3.125 / 2.875** (drawing shape −0.093, onto the photo); 21099: **3.12 / 2.849** [D] |
| Rear door glass, rear edge foot / head | 3109 / 2931 | 3011 / 2757 | – | 2109: **3.016 / 2.838**; 21099: **3.011 / 2.757** |
| Quarter light, front edge foot / head | 3231 / 3008 | 3140 / 2946 | 3116 / 2893 | 2109: **3.145 / 2.915**; 21099: **3.14 / 2.946** |
| Quarter light, rear edge foot / head | 3513 / 3144 | 3334 / 3072 | – | 2109: the 2108's **3.57 / 3.12** (same panel); 21099: **3.334 / 3.072** |
| Handles (centre) | 2.05 / 3.08 | – | 2.08 / 2.99 | the generator's rule, 0.13 ahead of each door's rear frame: 2.095 / 2.886 |

- The B pillar above the belt is body between the two door frames: 2.225–2.265, with 30 / 25 mm frame strips on the doors. Below the belt the doors meet on one shut line.
- The rear door reaches over the rear arch (front of the arch 2.885); the generator cuts it round the arch's lip.
- The rear door's glass is a drop glass; its rear edge rakes with the frame and turns vertical in the last 30 px of the 2109 drawing (a channel). It is modelled as one raked pane; lowered, it stays inside the door (checked in the lab).
- Overlay checks (`/tmp/samara/ov_2109ps.png`, `ov_2109s.png`): the model's B and rear shut lines fall on the photo's within a few mm at its scale; on the 2109 drawing they stand ~0.1 m ahead of its lines, as the table says.

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
| Spoiler | tip 4.183, 1.03 high | not modelled (§5) |

Lamps across the back [P p12, plate scale 1.5 mm/px; p13]:
- corner units on the body, from ±0.56–0.58 out to the corner: amber outer cell (~0.09), red. Spec: cluster `centre 0.585` → `inset 0.01`, columns `blinker`, `tail`/`brake`;
- on the lid, ±(0.38..0.56): red with a white square in its middle. Spec: lid cluster `centre 0.4` → `0.565`, columns `tail`, `reverse`, `tail`;
- between them, the dark red bar ±0.38 (reflector). Spec: lid lens `inert`, `centre 0` → `0.39`.

### 3.3 Face [P p15, p20]

- Head lamps on the 2108's footprint (±0.33..0.60) with the amber indicator at their outer end (±0.605..0.69).
- A narrow slot under the bonnet's lip between them: ±0.27, bumper top + 0.03..0.08, one bright bar.
- Body-colour front bumper, deeper than the 2108's: drop 0.07, height 0.30 (0.325–0.625); a dark lower intake ±0.30 at bumper bottom + 0.085..0.15.

## 4. Generator changes

1. **`TubStation.notch`** (body.ts `BodyFrame.lidX`, `deckY`, `deckFracs`). On a notched station the deck lies level at `deck` out to `notch − NOTCH_WALL`, rises in a 25 mm wall to the deck edge's height and stays level to the side. The lid is cut along `notch` instead of the pillar row (`lidX`), linearly between stations. This is the flat-bottomed lid between lamp corners that `measurements-estates.md` §3.1 asked for; the 2115 is the first car to use it. bay.ts's boot walls and bulkheads follow `lidX`.
2. **`FaceLook.lid`** (exterior.ts `buildLidFace`): face items built on the end face but hung on the boot lid or tailgate node, so the 2115's lamp bar lifts with the lid. Their lens meshes keep the lamp names, so the rig and `VehicleLamps` light them as any other.
3. **Moulded bumper `finish`** (exterior.ts): absent keeps the dark plastic colours as they were; `paint` makes a body-colour bumper whose groove is a ridge in the same paint.
4. **Saloon boot end** (bay.ts `buildSaloonBoot`): the boot's rear bulkhead stays 5 mm inside the tail face when the lid comes down to it (`bootEnd` = the last station).

**Proof that nothing else moved.** Every existing kit car (2101–2108) was built from the committed code in a `git worktree` and from the working tree; all triangles in the car frame were sorted and hashed. All eight hashes, triangle counts and bounds are identical. The 2108: 10 226 triangles, bounds ±0.970 × 0…1.335 × ±2.009 m, before and after.

## 5. Gaps

- **Greenhouse heights.** All four share the 2108 drawing's greenhouse (roof 1.335). The 21099 drawing, scaled on the 2108's belt and sill, has its roof at 1.402. The loader fits every body to the passport height (1402), so the shell grows 5 % as a whole; the glass stays ~60 mm shallower relative to the body than on the 21099 drawing.
- **2109 drawing.** It is undimensioned, and its door lines disagree with the photo and the 21099 drawing by 0.1 m; the photo was used. Its quarter light's rear edge (3.513 / 3.144) disagrees with the 2108's panel (3.57 / 3.12) by 57 mm; the 2108's is kept.
- **Front door's front edge.** The photo (1.239) and the 21099 drawing (1.251) put it 27–39 mm ahead of the 2108's 1.278, which is kept so the shared front stays identical.
- **2115 not modelled:** the boot-lid spoiler with its high-mounted brake lamp, the plate recess in the rear bumper, the front fog lamps, the grey door mouldings (`p19`), the side repeaters. The head lamps keep the 2108's trapezoids rather than the 2115's rounded "eyes".
- **Rear door handles** come from the generator's rule (0.13 ahead of the door's rear frame): 2.886 against the photo's 2.99 on the rear door.
- **Tail-lamp roles.** Colours are measured; which red cell is tail and which is stop is [INFERENCE] on the 21099 and the 2115.
- **2115 overhang split** rests on one near-orthographic photo corrected for depth (±20 mm); the factory gives only the 4330 total.
