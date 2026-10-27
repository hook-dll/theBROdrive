# VAZ-1111 Oka: measured numbers

Crops, gridded readings and photos are in `/tmp/oka/`, local only.

Frame and tags as in `measurements-classics.md`:
- **Body:** `s` rearward from the tip of the front bumper, `y` above the ground; mm in the tables, metres in the spec.
- **Faces:** `x` is a half width from the centre line.
- **Tags:** **[D]** drawing, **[P]** photo, **[F]** factory figure, **[E]** estimate (reason given).

The Oka shares no stampings with any other kit car, so it is its own family: `BODY_1111` / `LOOK_1111` in `oka.ts`, `platform: 'samara'` (transverse engine in front, front drive), its dash `CABIN_1111` in interior.ts. The car measured is the base 1111 (1988–1996): a symmetric slotted grille, black plastic bumpers.

## 0. Sources and scales

### Factory figures [F]

| Figure | Value | Sources |
|---|---|---|
| Length × width × height | **3200 × 1420 × 1400** | catalog-vaz.ru (https://www.catalog-vaz.ru/cars/vaz-1111-oka/), avto-russia.ru (https://avto-russia.ru/autos/lada/lada_1111_oka.html) |
| Wheelbase | **2180** | auto.ru (https://auto.ru/catalog/cars/vaz/1111/6268019/6268026/specifications/6268026__20400346/); the drawing's dimension |
| Tracks front / rear | **1210 / 1200** | drivernotes.net (https://drivernotes.net/tehnicheskie_harakteristiki/vaz_(lada)/1111_oka/0.65_MT_(29_%D0%BB._%D1%81.)-44203); the drawing's front dimension 1210. The `cf_vaz1111` row (the 1111 manual) has 1214 / 1204: 4 mm, not resolved |
| Clearance | **150** | catalog-vaz.ru |
| Tyres | **135/80 R12** (145/80 R12 also listed) | catalog-vaz.ru, auto.ru; 135/80 R12 = 0.260 m free radius |

### Drawing (`build/carshape/_refs/bp/img/vaz_1111_oka.jpg`)

`https://3dcar.ru/media/blueprints/full/vaz/vaz_1111_oka.jpg` (named by `tools/carforge/examples/sheet_vaz1111.json`); `file`: JPEG, 2200×1500 (`vaz_1111.jpg`, `vaz_oka.jpg`, `vaz_11113.jpg` are HTML 404s). A dimensioned four-view: front view top left, side view top right (car facing left: its left side), rear view bottom left, plan bottom right (nose left).

| View | Scale | Registration |
|---|---|---|
| Side | **2.696 mm/px** from the 3200 dimension: tick lines x 899.5 / 2086.5 (1187 px) | s = (x − 899.5)·0.002696, y = (618 − y_px)·0.002696 (ground line top y 615–620). The 544 dimension's tick x 1100.5 reads **542**; the hub lines x 1100.5 / 1912.5 read **2189** against 2180 (0.4 %, kept as drawn: arches and doors are drawn round them). Roof y 125 → 1.329. |
| Front | same scale: the 1350 height dimension (y 119–616, 497 px) gives 2.716; the 520 plate (x 302.5–492.5) reads 518 at 2.70 | x from the centre line x 397.5, y = (620 − y_px)·0.0027. Roof 1.343. The width dimensions' extension lines do not land on the body (1420 reads 1327); the body's flanks read ±0.709. |
| Rear | 2.70 | centre x 397.5, y = (1308 − y_px)·0.0027; roof 1.365, plate ±0.26. |
| Plan | side view's x scale | tips x ~903 / 2087; half widths from the outermost line per column: 0.70–0.72 along the flank (1434 against 1420 [F]). |

### Photos (Wikimedia Commons, in `/tmp/oka/`)

| Commons title | Licence | Used for |
|---|---|---|
| VAZ-1111 2024-05 1716668772.jpg | CC BY 4.0 | A later yellow car, front: the bonnet's edge on the lamps' top, the dark face panel round the lamps, amber indicators in the black bumper. |
| VAZ-1111 2024-05 1716668922.jpg | CC BY 4.0 | The same car, left rear 3/4: the left flank has no filler; the sail at the door's front corner, black mirror and handle, the tail lamp units, the bumper wrapping round to the rear arch. |
| VAZ-1111 2024-05 1716668961.jpg | CC BY 4.0 | The same car, rear: the tailgate down to the bumper's top between the lamps; lamp cells clear / amber / red about 1 : 1 : 2; a head restraint on the front seat. |
| 1994 VAZ 1111 red rear.jpg | CC BY 4.0 | Right rear 3/4: **the round filler cap on the right rear quarter**, half way down the panel just ahead of the arch; a red fog lamp at the left end of the rear bumper. |
| 2000 VAZ 1111 (11113021) rear.jpg | CC0 | Left rear 3/4: the red fog lamp in the bumper's left end, the bumper wrapping to the arch, the tail lamps. |
| ВАЗ-1111 «Ока», Molėtų technikos muziejus 3.jpg | CC BY-SA 4.0 | Right side of an early car: the amber repeater on the wing, the long door, the fixed quarter glass. |
| Oka-Innenraum.jpg | CC BY 4.0 | Black dash, black door card (upholstery and dash colours); the dash (`CABIN_1111`): no glovebox lid, an open shelf before the passenger (`glovebox.lid` false since kit-check 2026-10-19: the lid the kit drew there is not on the car). |

---

## 1. Side (drawing side view unless marked)

| Feature | Reading (px) | s, y (m) | Spec |
|---|---|---|---|
| Front / rear bumper tip | x 899.5 / 2086.5 | 0 / 3.200 | `length` **3.2** |
| Front / rear hub | x 1100.5 / 1912.5, y 529 | 0.542 / 2.731, 0.240 | `wheels.front` **0.542**, `rear` **2.731** |
| Tyre | hub 89 px over the ground (loaded) | 0.240 | `radius` **0.25** (between the drawn 0.240 and 0.260 free [F]) |
| Front arch | liner top y 394, lip y 368.5 | 0.604 / 0.673 over the ground: 0.364 / 0.433 round the hub | superseded by the owner's photo (§1.3): `arch` **1.245**, `frontArchRise` **1.34** |
| Rear arch | top y 420–425, flattened under the flank line | 0.534–0.52 → ~0.29 round the hub | superseded by the owner's photo (§1.3): `rearArch` **1.2**, `rearArchRise` **1.22**, `rearArchSquare` **2.7** |
| Front bumper | top y 423.5 (front view 0.527), bottom y 505 (spoiler lip to 0.29); its side's end along the arch, x 1035 at its top band, x 993–1003 low down | 0.524 / 0.305; end s 0.36 → 0.25 | moulded **0.30–0.525** (`drop` 0.035 under face sill 0.30 + 0.035; `height` 0.225); `wrapTo` **'arch'** (§1.3) |
| Face | below the lamps x 920 | s 0.055 | first station **0.055** (the bumper reaches 0.055 out of it) |
| Bonnet's lip / wings' top at the face | (950, 338.5) / (960, 355) | 0.136, 0.753 / 0.163, 0.709 | face deck **0.755**, belt **0.71**; `frontLean` base 0.5, lean (0.136 − 0.055) / (0.755 − 0.5) = **0.32** |
| Bonnet centre (top line) | (950, 338.5) (1100, 297.5) (1195, 281) | 0.136 / 0.541 / 0.797 → 0.753 / 0.864 / 0.909 | deck 0.78 / 0.80 / 0.864 / 0.89 at s 0.16 / 0.27 / 0.54 / 0.89 |
| Wings' top (the clamshell's side shut line) | (960, 355) → (1200, 320) | 0.709 → 0.803 at s 0.81 | belt 0.72 / 0.73 / 0.765 / 0.805 at s 0.16 / 0.27 / 0.54 / 0.89; `bonnet.inset` 0.01 |
| Flank line | double pressed line y 415–430, nose to tail | 0.547–0.507 | `crease` **0.53** |
| Repeater | x 1202.5–1232.5, y 387.5–400 | 0.817–0.898, 0.621–0.588 | `repeater` **0.817–0.898, 0.588–0.621** [P museum 3: amber] |
| Screen | foot (1230, 288), roof's front (1405, 135); the line 1.146 m of s per m of height | 0.891, 0.890 → 1.363, 1.302; at the rail 1.349 | first column **0.89 / 1.35** (the pillar's outer line reaches the belt at 0.79: the kit's screen stands on the cowl station, so its foot is the screen's, not the pillar's) |
| Door front shut line | x 1260, from the belt up to y 300 | 0.972 | below the belt from **0.972** |
| Sail and glass front edge | inner line (1300, 312) … (1425, 160); the sail x 1290–1305 at the belt | glass front 1.08 at 0.82 → 1.417 at 1.235; at the rail 1.46 | columns **0.92 / 1.385** (frame, wing below), **0.972 / 1.415** (sail), **1.08 / 1.46** (drop glass) |
| Door glass rear edge / door rear | x 1665 / 1680, upright | 2.064 / 2.104 | columns **2.064**, **2.104**: door **0.972–2.104 = 1.132 m** below the belt |
| Door handle | x 1650–1675, y 335–350 | 2.02–2.09, 0.76–0.72 | (the generator places the handle) |
| Quarter glass | front frame x 1690–1700; rear edge foot (1965, 296), top corner (1915, 147), top y 147.5 | front 2.13–2.16; 2.873, 0.868; 2.738, 1.270 | fixed from **2.14**; column **2.875 / 2.73** (the edge straightened to the rail) |
| Window sill | y 312.5 / 309 / 304 / 296 at x 1300 / 1400 / 1680 / 1965 | 0.824 / 0.833 / 0.846 / 0.868 | belt 0.81 / 0.845 / 0.855 at s 0.95 / 2.4 / 2.95 (+ `glassBottom` 0.012) |
| Glass top | door y 160, quarter y 147.5 | 1.235 / 1.268 | `glassTop` **0.04** under the rail |
| Door frame top (rail) | y 140 | 1.289 | `rail` **1.29** (front view 1.31) |
| Roof | y 125 (front 1.343, rear 1.365, dimension 1350) | 1.329 | rail + 0.015 + 0.035 = **1.34** |
| Roof's rear / tailgate line | outer line (1959, 139.5) … (2054, 300) (2065, 335) (2072.5, 400) | 2.855, 1.29 / 3.112, 0.857 / 3.142, 0.763 / 3.162, 0.588 | last column top **2.855**; tailgate glass raked 0.6 m/m to the knee, the lower panel near upright |
| Tailgate glass foot | rear view y 987.5 | 0.865, on the line at s 3.11 | `rearKnee` **(3.11, 0.86)** |
| Tail lamp on the flank | x 2022.5–2065 (front edge 2022.5 top, 2030 foot), y 337.5–412.5 | 3.027–3.142, 0.756–0.554 | corner lamps forward to **3.04** |
| Rear bumper | top y 435, bottom y 500, valance to y 530; reaches x 2087.5; its side's front end along the arch, x 1980 at its top, 2013 at its foot | 0.493 / 0.318 / 0.24; end s 2.91 → 3.00 | moulded **0.30–0.495** (`height` 0.195); `wrapTo` **'arch'** (§1.3) |
| Sill | black rocker y 542–557 between the arches | 0.205–0.164 | `sill` **0.17** from s 0.95 to 2.4; 0.30 at the ends (the bumpers' foot) |
| Door bottom | y 512–520 | 0.286–0.264 | `doorBottom` **0.28** |
| Fuel flap | not on the drawing (its left side) | — | **2.42–2.52, 0.57–0.67**, `side: 'right'` [P "1994 VAZ 1111 red rear": a round cap ~0.1 across half way down the right quarter, just ahead of the arch; position E from a 3/4 view] |

### 1.1 Tail (hatch)

The real belt runs at 0.857 along the D pillar to the tailgate's line at s 3.11 and the corner lamps stand below it from 0.771 down to 0.568, beside a tailgate that comes down between them to 0.562. The kit's tailgate cuts at the tail station's deck and its lamps live on the tail face below the tub's belt, so:
- the tailgate's foot (`rearBase`, column and station **3.125**) is put at the lamps' top: belt **0.78**, deck **0.79**;
- the tub's belt is kept under the knee (0.86) at every tail station: **0.85** at s 3.04, where it turns down, and 0.78 at 3.125 and 3.16 (measurements-niva.md §1.3; BODY_2108's D pillar comes down the raked line flush with the tailgate the same way);
- s 3.04 is a cabin column (top 2.845), so the last greenhouse strip (3.04–3.125) has no station bending the tub's top inside it (nivas.ts column 3.58).

### 1.2 Half widths (plan, front and rear views)

| s | Plan outermost | Spec wSill / wCrease / wBelt |
|---|---|---|
| 0.055 | 0.640 (bumper corner); the lamp panel's ends ±0.614 [D front] | 0.62 / 0.64 / 0.63 |
| 0.163 | 0.675 | 0.66 / 0.675 / 0.665 |
| 0.271 | 0.697; the wings' top under the clamshell's edge ±0.653–0.668 at 0.72–0.81 [D front: the line inside the flank] | 0.685 / 0.70 / **0.667** |
| 0.54–2.97 | 0.704–0.720; front view flank ±0.70–0.709, glass foot ±0.669 at 0.877 | 0.69 / 0.705–0.71 / **0.667** to 2.4 (the wings' top and the glass's foot one line, no s-bend at 0.54 / 0.89), 0.69 at 2.95; `shoulder` 0.02 / 0.012 |
| 3.075 | 0.681 | 0.675 / 0.695 / 0.68 at 3.04 |
| 3.129 | 0.659 | 0.65 / 0.67 / 0.66 at 3.125 |
| 3.16 | 0.577 at 3.156 (rounding); lamps' outer edge ±0.661 [D rear] | 0.63 / 0.655 / 0.645 |

Rail ±0.493 at the side glass's top corners [D front] → `railHalf` **0.49**: the side glass leans in 0.18 m over its 0.45 height.

### 1.3 Arches and the bumpers' ends (the owner's side photo, 2026-10-27)

The owner: «пластиковые бамперы там доходят прямо до арок, а у нас нет. и в реале арки поаккуратнее и задняя арка не такая круглая, как у нас». His photo `build/carshape/_refs/photos/oka/owner_side.jpg` **[P]** (853×360, a red base car, its left side, square on): hubs (172, 283.5) and (698, 286.5) from the rims' caps, **241.3 px/m** from the 2180 wheelbase; tyre radius 0.257 (62 px). Its body sits higher on its wheels than the drawing's: over the hub its crease reads 0.317 (kit 0.28), door bottom 0.081 (0.03), front bumper top 0.309 (0.275), roof 1.40 over the ground (D 1.35): **0.035** taken off every height below to put it on the kit's hub (0.25). Edges read per 4 px row: the red skin's edge, and where the bumper's dark grey (~35) meets the well's black (~3).

| Feature | Photo, over the photo's hub (m): half width ahead / behind | On the kit's hub | Spec (built, kit-drawing) |
|---|---|---|---|
| Front arch | h 0.05: 0.298 / 0.319; 0.133: 0.282 / 0.303; 0.215: 0.253 / 0.269; 0.282: 0.207 / 0.224; 0.332: 0.137 / 0.157; 0.365: 0.033 / 0.07; top **0.37** | top **0.335**, **0.30** ahead (the bumper), **0.323** behind at the hub; a half ellipse (0.253 ahead at 0.54 of the top, 0.191 at 0.785, 0.104 at 0.93: power 2) | `arch` **1.245** (0.311), `frontArchRise` **1.34**, `archShift` 0.0125: built **0.336 / 0.298 / 0.324** (stood 0.364 / 0.362 / 0.36 to the drawing's liner) |
| Rear arch | h 0.066: 0.307 ahead; 0.099: 0.298 / 0.286; 0.199: 0.261 / 0.249; 0.282: 0.203 / 0.203; 0.315: 0.157 / 0.166; 0.332: 0.12 / 0.145; 0.348: 0.041 / 0.128; top **0.355**, level from 0.12 ahead to the bumper's corner 0.13–0.2 behind | top **0.305** (0.32 by the hubs, 0.305 by the crease and door bottom; D 0.29–0.30), **0.31** ahead, **0.29** behind (the bumper); flatter than an ellipse near its top: at 0.92 of the top 0.16 against an ellipse's 0.118, at 0.97 0.13 against 0.073 (power ≈ 2.7) | `rearArch` **1.2** (0.30), `rearArchRise` **1.22**, `rearArchSquare` **2.7** (new), `archShift` rear **−0.01**: built **0.306 / 0.31 / 0.29** (stood a circle 0.294 / 0.292 / 0.292) |
| Front bumper's side end | the bumper's dark grey to the well, top y 212 → foot y 277: 0.207 ahead of the hub at h 0.29, 0.24 at 0.248, 0.273 at 0.186, 0.29 at 0.124, 0.298 at 0.062 | s **0.335** at its top → **0.244** at its foot: the arch's front edge | `wrapTo: 'arch'` (new): the end on the arch's edge at every height, built s **0.247** at its foot (0.30), 0.324 at 0.475, **0.377** at its top (0.525) |
| Rear bumper's side end | top y 206 → foot y 265: 0.128 behind the hub at h 0.348 (its rounded corner), 0.182 at 0.306, 0.215 at 0.265, 0.244 at 0.203, 0.265 at 0.141 | s **2.86** at its top → **2.996** at its foot: the arch's back edge | `wrapTo: 'arch'`: built s **3.02** at its foot (0.30), 2.963 at 0.475, **2.944** at its top (0.495) |

The drawing agrees where it shows them: its front bumper's top band ends at x 1030–1040 (s 0.35–0.38) and its lower part at x 993–1003 (s 0.25–0.28), its rear bumper's end runs from (1980, 430) to (2013, 513) (s 2.91 → 3.00); its rear arch's top is flat under the flank line. Its rear opening reads 3 cm smaller than the photo's (two lines ahead, 0.345 and 0.253 at the hub's height); the photo is kept. The photo's bumpers are deeper (rear 0.24 against the drawing's 0.175 over the valance): not changed, outside the complaint.

## 2. Front (drawing front view; photos for colour)

| Item | Reading (px) | x (half), y (m) | Spec |
|---|---|---|---|
| Bonnet's front edge | y 345 across | 0.743 | the face's deck (lip 0.755 in the side view) |
| Black panel round the lamps | y 357.5–417.5, to the lamps' outer ends x 170 | 0.709–0.547, ±0.614 | `panel` **±0.615**, bumperTop + 0.022 … + 0.184 [P: dark plastic] |
| Head lamp lens | x 185–257.5, y 365–412.5 | ±0.378–0.574, 0.689–0.560 | `lens` head, bumperTop + 0.035 … + 0.164 |
| Grille slot | x 280–515, y 382.5–415 (two rows of slots; a black band y 370–380 over it) | ±0.317, 0.641–0.554 | `grille` ±0.317, bumperTop + 0.029 … + 0.116, one horizontal divider |
| Bumper | y 425–495, lip to 515 | 0.527–0.338, 0.284 | moulded 0.30–0.525; a line near its top y 432.5 (0.506) → `moulding` **0.5**, black |
| Indicators | x 205–242.5, y 452.5–472.5 | ±0.418–0.52, 0.452–0.398 | `lens` blinker, bumperBottom + 0.098 … + 0.152, proud **0.059** (4 mm before the bumper's face, 0.055 out of the end face) [P: amber] |
| Plate | x 302.5–492.5, y 457.5–515 | ±0.256, 0.439–0.284 | not modelled |
| Windscreen foot | (165, 292.5) corner; centre y 297.5 | ±0.628, 0.884; 0.871 | cowl deck 0.89 |

## 3. Rear (drawing rear view; photos for colour)

| Item | Reading (px) | x (half), y (m) | Spec |
|---|---|---|---|
| Tailgate glass | top y 835, foot y 987.5; ±0.466 top, ±0.594 foot | 1.277 / 0.865 | `rearKnee.y` 0.86 |
| Tailgate's foot | band y 1100 | 0.562 | not modelled: see §1.1 |
| Lamp units | x 152.5–212.5 (inner edge leaning: x 185 at the top, 212.5 at the foot), y 1022.5–1097.5 | outer ±0.661, inner ±0.574 top / ±0.50 foot, 0.771–0.568 | three `cornerLamps` bands: reverse 0.72–0.77, blinker 0.67–0.72, brake / tail 0.568–0.67 [P …961, "1994 … red rear": clear, amber, red ≈ 1 : 1 : 2] |
| Bumper | top y 1125, bottom y 1197.5 | 0.494 / 0.298 | moulded 0.30–0.495; `moulding` **0.47** [E: just under its top, clear of the lamps below] |
| Bumper lamps | x 182.5–237.5, y 1150–1180, both ends | ±0.432–0.58, 0.427–0.346 | `lens` inert ±0.432–0.58, raised to 0.37–0.427 (bumperBottom + 0.07 … + 0.127) onto the bumper's flat face; proud **0.044** [P: red fog lamp] |
| Plate | x 297.5–492.5, y 1142.5–1195 | ±0.26, 0.447–0.305 | not modelled |

## 4. Gaps

- **Tailgate between the lamps** (§1.1): the real tailgate comes down to 0.562 between the corner lamps; the kit's ends at 0.79 (the lamps' top), so 0.23 m of it is fixed tail face. A tailgate whose lower panel comes down between two lamp corners (the boot lid's `notch` / `lidFace`, for a tailgate) is not in the spec language.
- **The D pillar's belt**: real 0.857 to s 3.11, kit 0.85 at 3.04 falling to 0.78 at 3.125 (≤ 0.07 low over the last 0.085 m).
- **One wiper**: the car has a single central wiper [D front, top; P]; the kit builds a pair. `wiperBlade` 0.5 is an estimate.
- **Screen's foot vs the A pillar**: the pillar's outer line reaches the belt at s 0.79; the kit's first column stands at the screen's foot (0.89), so the pillar is 0.10 shorter at its foot.
- **Rear fog lamp**: one, at the bumper's left end [P]; face items are built on both sides, so both ends carry a red unlit lens (the drawing shows a rectangle at each end).
- **Filler cap**: round on the car; the flap is a rectangle 0.1 × 0.1. Its position is read off a 3/4 photo, not measured.
- **Rear arch**: a superellipse (`rearArchSquare` 2.7) from the owner's photo; its back edge on the car is the bumper's end, whose top corner is squarer still (0.13 behind the hub at 0.98 of the top against the kit's 0.10).
- **Arch lips**: the car's arches have a flared lip round the opening [P]; the kit's opening is the plain cut.
- **Ride height**: the owner's photo sits 3.5 cm higher on its wheels than the drawing; the kit keeps the drawing's.
- **Tracks**: 1210 / 1200 [F web, D] against 1214 / 1204 in the `cf_vaz1111` row.
- Not modelled: number plates and their recesses in both bumpers, the sail's black finish (painted here), the roof's rear lip, the badge.

## Arches to the drawings (2026-10-27)

Arch openings `[top, ahead, behind]` over the hub (m), refs → built before → after (kit-drawing; STATUS.md table, HISTORY):

- **vaz1111**: front 0.36 / 0.295 / 0.32: 0.364 / 0.362 / 0.36 → 0.36 / 0.294 / 0.32; rear 0.29 / 0.28 / 0.27: 0.294 / 0.292 / 0.292 → 0.294 / 0.292 / 0.292. `arch` 1.45 → 1.23, `frontArchRise` 1.44, `archShift` [0.0125, 0]; refs re-read on the drawn hub crosshair (1103, 529).
- **vaz1111, the owner's photo (2026-10-27, §1.3)**: refs front → 0.335 / 0.30 / 0.323, rear → 0.305 / 0.31 / 0.29; built 0.36 / 0.294 / 0.32 → 0.336 / 0.298 / 0.324 and 0.294 / 0.292 / 0.292 → 0.306 / 0.31 / 0.29. `arch` 1.23 → 1.245, `frontArchRise` 1.44 → 1.34, `archShift` [0.0125, 0] → [0.0125, −0.01], `rearArch` 1.17 → 1.2, `rearArchRise` 1.22, `rearArchSquare` 2.7.
