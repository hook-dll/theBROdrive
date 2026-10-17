# UAZ measurements

Working report for the UAZ family. Each car has its own section. Tags: **[D]** drawing,
**[P]** photo, **[F]** factory figure, **[E]** estimate with its reason.

## UAZ-469

Draft stage: spec `BODY_UAZ469` / `LOOK_UAZ469` in `uaz.ts`, dash `CABIN_UAZ469` in
interior.ts, catalogue row `kit_uaz469` (sibling `cf_uaz31512`). Awaiting the owner's review.

### 1. Sources

All files in `build/carshape/_refs/bp/img/` (gitignored); `file` run on each: real JPEGs.

**Drawings**

| File | What | Use |
|---|---|---|
| `uaz2.jpg`, 2000 × 1400 | UAZ-3151 factory four-view (the 469 after its 1985 renaming; the same body), hard top, with dimension lines 4025 / 680* / 2380* (база) / 965* / 2020 / 1255 / 1085 / 1290 / 760 / 580 / 540* / 475 / 675* / 635 / 545 / 364 / 220* / 1785 / 1445* / 1230 / 4670 / 3200 / 2010 max / 1698 / 1135. | **Main reference.** Side view cropped at (780, 60): hubs x 192 / 738 (546 px = 2380 → **4.359 mm/px**), ground y 475, front tip x 36, spare's back x 971 (4.076 m; the 4025 dimension line runs x 36–960). Front view cropped at (140, 60), 4.33 mm/px from its 1785 width (x 30–443). |
| `uaz469.jpg`, 900 × 700 | A short two-door 469 derivative with a roll bar (2000 wheelbase, 3730 / 4360 long). | **Not used**: not the 469 (wheelbase 2000 against 2380). |

**Photos** (Wikimedia Commons, via the API; 1600–1920 px renditions)

| Saved as | Commons title | Licence | Used for |
|---|---|---|---|
| `uaz469_side.jpg` | "UAZ-469 (side).jpg" (User:Fiver, der Hellseher) | CC BY-SA 4.0 | canvas over the doors, no side window behind them; door frames; flap; scuttle lamp |
| `uaz469_front.jpg` | "UAZ-469 (front).jpg" (same) | CC BY-SA 4.0 | face: lamps, two mesh grilles, slots, indicators, black bumper |
| `uaz469_b.jpg` | "UAZ 469B.JPG" (LutzBruno) | CC BY-SA 3.0 | face, door frames, canvas |
| `uaz469_1.jpg` | "Uaz-469-1.jpg" | GFDL 1.2 | face 3/4, scuttle lamp, canvas |
| `uaz469_riga.jpg` | "Militians UAZ-469AP after reconstruction, Riga 2021.jpg" (User:АнИгМа) | CC BY-SA 4.0 | metal-top variant (not modelled), indicators |
| `uaz469_pd.jpg` | "UAZ 469.JPG" (Bajuvar) | public domain | side: canvas down to the body's top, door lines, flap |
| `uaz469_fi*.jpg` | "UAZ-469 FI H86018 02/04/05/06/07/08/11.JPG" (Piergiuliano Chesi) | CC BY 3.0 | profile (05), the tail and its door, hinges on the right, spare on the door, lamps (06, 07), dash (08, 11) |
| `uaz469_1970rear.jpg` | "UAZ 469 (1970) (owner David Richardson) pic3.JPG" | CC0 | canvas back with its window, spare on the rear door |
| `uaz469_pedals.jpg` | "UAZ-early-interior-floor-pedals.jpg" (Flickr) | CC BY 2.0 | the dash (§1.6) |

**Factory figures**

- UAZ manual RE 05808600.072-2000 (cited at `cf_uaz31512` in carmodels.ts): 4025 over the
  spare, 1785 wide, 2020 high (hard top), 2380 wheelbase, 1445 tracks, 220 under the
  single-reduction axles, 215/90-15C (0.372 rolling radius). **[F]**
- ru.wikipedia "УАЗ-469" infobox (after "Краткий автомобильный справочник", 1983): 4025 ×
  1805 × 2015 (canvas top), 2380, 1442 tracks, clearance 300 (military 469, portal axles) /
  220 (469B). **[F]**

### 1.1 Which car

The 469 / 469B under its **canvas top** (the photos; `uaz2.jpg`'s hard top is the 3151's
factory option): the canvas comes down over the doors' frames and down the sides and the
back behind them, with one window in the back; the doors are framed with fixed (on the car,
sliding) glass. Modelled on the civilian 469B's figures (220 clearance, the 31512's running
gear).

### 1.2 Side view (`uaz2.jpg`, 4.359 mm/px; s = (x − 36) × 4.359 mm, y = (475 − y) × 4.359 mm)

| Feature | px | m | Tag | Spec |
|---|---|---|---|---|
| Front tip (bull bar) | x 36 | 0 | D | s 0 |
| Face | x 70 | 0.148 | D | first station 0.148 |
| Front hub | x 192, y 391 | 0.68, 0.366 | D (680 F) | `wheels.front` 0.68 |
| Rear hub | x 738 | 3.06 | D (2380 F) | `wheels.rear` 3.06 |
| Tyre | | 0.366 loaded | D (0.372 F) | `radius` 0.37 |
| Bonnet lip / centre | y 205 / 188 | 1.18 / 1.25 | D | deck 1.15 → 1.25 |
| Bonnet's rear edge | x 280 | 1.064 | D | `bonnet.rear` 1.064 |
| Wings' top (bonnet skirt's foot) | y 237 | 1.037 | D | belt 1.04 forward of the cowl |
| Windscreen foot | x 330, y 184 | 1.28, 1.27 | D | cowl 1.28, deck 1.27 |
| Screen top (frame) | x 397, y 50 | 1.57, 1.85 | D (hard top) | column top 1.49 at the rail 1.68 (the canvas' frame) [E] |
| Doors' top (belt) | y 200 | 1.20 | D | belt 1.11 + shoulder rise 0.09 |
| Door bottom | y 374 | 0.44 | D | `doorBottom` 0.44 |
| Sill under the doors | y 383 | 0.40 | D | sill 0.42 |
| Front door's front shut line (hinges) | x 345 | 1.347 | D | 1.36 (column 1.335 / 1.36) [E: 13 mm back so the door's frame is not a sliver] |
| B shut line (belt) | x 520 | 2.11 | D | 2.115 / 2.13 |
| Front door's rear edge, raked | (520, 205) → (435, 375) | 2.11, 1.18 → 1.74, 0.44 | D, P fi05 | `foot: { y 1.08, s 1.74 }` |
| Front door glass | x 355–515, y 135–200 | 1.39–2.09, 1.23–1.48 | D | glass 1.36–2.085 |
| Door mirror | side view: head x 355–378, y 143–190; stalk down the door's front edge (x 345–360) to a bracket at y 205–225. Front view: head x 12–52 (its heights do not register). Photos: "UAZ 469.JPG" side zoom (1.337 mm/px from the hubs) head 230–400 crop px over the glass foot 395 and the belt crease 485; "UAZ-469 (side)" 3/4 head 218–350 over the belt 420 | s 1.39–1.49, y 1.24–1.45, centre **1.44 / 1.345**; bracket 1.09–1.18; front view ±0.80–0.97. Photos: centre 1.34 and 1.36–1.39, head beside the glass's front lower corner, 6–9 cm behind the stalk | D, P | `mirrorStalk` 0.17: head centre s 1.45, y 1.36, ±0.985 (the generic mx + 0.1, 0.1 further out than drawn: the flank stays a sliver in the glass); rod at s 1.385 from a bracket under the belt (1.06–1.11). The head stays the kit's 0.12 × 0.09 in brightwork; the car's is upright, ~0.10 × 0.2, black |
| Rear door glass rear edge | x 670 → 650 | 2.76 → 2.68 | D | column 2.76 / top 2.68 |
| Rear door's rear edge, raked round the arch | (700, 195) → (610, 375) | 2.894, 1.22 → 2.50, 0.44 | D | `foot: { y 1.08, s 2.5 }` |
| Body behind the doors (hard top: quarter glass; canvas car: none) | | | P side, pd | canvas behind 2.85 (`softTop.from`) |
| Body's bottom behind the rear arch | y 347 | 0.56 | D | sill 0.56 from 3.6 |
| Tail face | x 903 | 3.779 | D | last station 3.779 |
| Spare's back | x 971 | 4.076 | D | `wheel` item, standoff 0.07 + width 0.21 |
| Arch tops (front / rear) | y 270 / 280 | 0.50 / 0.48 over the hubs | D | `arch` 1.35 (0.50) |
| Hard top's roof | y 28 | 1.95 (2020 dimension line incl. the gutter) | D, F | canvas crown 1.93 (rail 1.68 + rise 0.14 + crown 0.11) [E: the canvas the hard top's height, P] |
| Doors' frames' top | y 105 | 1.61 | D | `rail` 1.68 [E: the canvas comes down onto the frames] |

### 1.3 Front view (`uaz2.jpg`, 4.33 mm/px, centre x 237, ground y 586)

| Feature | px (crop) | m | Tag | Spec |
|---|---|---|---|---|
| Body width | x 30–443 | ±0.894 | D, F 1785 | `wCrease` 0.893 |
| Face flat across | x 62–408 | ±0.75–0.80 | D | first station ±0.80 |
| Bumper | y 328–350 | 0.545–0.64 | D (545 / 635 dimension lines) | blade 0.545–0.64 |
| Head lamps | centres x 100 / 375, y 245; rim radius 23 px | ±0.595 at 0.974, rim 0.10 | D | `round` ±0.595, 0.085 lens |
| Upper mesh grille | x 160–315, y 218–245 | ±0.335, 0.974–1.08 (scaled to the side view's heights) | D, P | grille ±0.33 |
| Lower mesh grille | x 155–320, y 262–288 | ±0.35, 0.82–0.93 | D, P | grille ±0.35 |
| Three slots | x 172–302, y 292–302 | ±0.26, 0.76–0.80 | D, P | slot grille ±0.26 |
| Indicators (round, amber) | x 100 / 375, y 290 | ±0.595 at 0.78 | D, P | lens ±0.555–0.635 |
| Glass foot / canvas sides | | ±0.77 / ±0.80 | D | `railHalf` 0.80 |
| Tracks | | 1445 | F | half track 0.7225 |

### 1.4 Rear view (`uaz2.jpg`, rear-view crop at (140, 690), 4.33 mm/px)

| Feature | m | Tag | Spec |
|---|---|---|---|
| Tail lamps (vertical units, amber over red) | ±0.62–0.76, 0.805–1.015 | D, P fi07 | cluster `['blinker','tail','brake']` |
| Round reflector under each | ±0.68 at 0.72 | D, P | a reversing lens there [E: the 469's reversing lamp hangs under the bumper; the kit needs a lit reversing cell] |
| Rear crossmember (bumper) | 0.565–0.685 | D | blade, lift 0.065, 0.12 high |
| Rear door | ±0.32 (opening), body's top to 0.70 | P fi07; E width | last two stations `notch` 0.32, deck 0.70 |
| Spare | hub 1.10, ⌀ 0.74 | D, P | `wheel` y deck − 0.10 (1.10), radius 0.37 |
| Canvas back window | middle, 1.5 to roof − 0.12 | P 1970rear | `rearBottom` 0.3, `rearHeader` 0.12; glass only between the centre line and the half row (`softTop`) |

### 1.5 Plan

Front corners round from ±0.80 at the face to ±0.89 by s 0.26 [D top]; body sides ±0.885–0.893
nose to tail [D top, front]; tucked in to ±0.86 at the sill along the cabin [E: front
view, the doors' foot; also keeps the flap's inside clear of the filler cup].

### 1.6 Dash (`uaz469_pedals.jpg`, CC BY 2.0; `uaz469_fi08/11.jpg`)

Scale: the screen's middle post (x 900) is the centre line, the wheel's hub at x 340: 560 px
for seatX 0.40 [E], 0.71 mm/px; heights from the dials' centre (y 395) at 0.04 over the belt
[E].

| Feature | px | m | Tag | Spec |
|---|---|---|---|---|
| Dash face (top lip to foot) | y 230–500 | 0.19 tall | P | `dash` 0.115 → −0.07 over the belt, flat steel in olive |
| Dash depth: a shallow shelf under the screen (owner's photo ex-roadmedia.ru `20_uaz/21.jpg`) | | face 0.20 behind the screen's foot (was 0.345), shelf 0.10 deep | P/E | `dash`, `fascia`, `binnacle`, `cluster` 0.207 |
| Speedometer, alone right of the column | x 620, 115 px | 0.2 right, ⌀ 0.08 | P | `speed` 0–120, r 0.038 |
| Four-dial panel, chrome frame | x 710–1075, y 345–440 | 0.39 right, 0.26 × 0.065 | P | `clusterFace`, `binnacleRight` 0.34 |
| Dials (ammeter, oil, temperature, fuel) | x 755 / 850 / 935 / 1030, 75 px | r 0.024 | P | volts / oil 0–6 / temp / fuel |
| Four lamps over the panel | x 755–930, y 320 | 0.093 up | P | `lamps` turn, beam, oil, charge |
| Knob row under the panel | x 765–1010, y 515 | −0.045 | P | lights knob, three switches, hazard [E: none on the car] |
| Small lid right of the panel | x 1130–1200 | | P | `glovebox` 0.07 × 0.064 |
| Wheel, three thin spokes | rim x 50–630 | ⌀ 0.42 | P | radius 0.21, spokes 102 / −18 / 222° |
| Gear lever + two transfer levers | | | P | `gear`, `transfer` |
| Seats (hip / bench) | 3151 plan, dashed | hip 0.70 behind the cowl, bench +0.83 | D | `hip` 0.7, `bench` 0.83 |

### 1.7 Generator fields added (absent = every existing car identical)

- `CabinSpec.softTop { colour, from }`: the roof, the rail chamfer and the body's or
  tailgate's greenhouse strips behind `from` drawn as canvas (unpainted trim in its colour,
  `Mat 'canvas'` in body.ts); the back's glass only in the middle; the back is the body's.
- `KitCarSpec.bonnet.rear`: the bonnet ends at that s, a scuttle deck between it and the screen.
- `KitCarSpec.tailgateHinge 'left' | 'right'`: the tailgate hinged upright at its side edge
  (pivot at that edge, rotating about Y, 1.2 rad).
- `FaceItem` kind `wheel`: a spare in its cover on a bracket, one at `x`; as a rear `lid`
  item it rides on the rear door.
- `Layout.binnacleRight` (interior.ts): the binnacle centred that far right of the column.
- `onBody` moves `softTop.from` and `bonnet.rear`. `KIT_CARS` entries drop the sibling's
  `spareNode` (a kit car builds its own spare).

Proof: geometry hashes (README "Proving a refactor") of all 20 earlier cars identical
against a HEAD generator carrying the same in-progress Volga cabins (2026-10-17).

`KitLook.mirrorStalk` (2026-10-17, the owner: the mirrors too low, hard to see from the
seat): the door mirror's head that much higher (and 3.5 cm further back) on an upright
stalk; 0.17 here. Proof: geometry hashes of the 21 other kit cars identical before and
after; `tools/kit-zfight.ts` PASS on all 22.

### 1.8 Gaps

- Heights: built roof 1.93, fitted to the 2015 passport: the car grows 4 % in height; the
  drawn hard top is 1.95.
- The wings are one flat face with straight corners; the real front wings are rounded
  and flare over the arches; the arch is one circle (real ones square-cut).
- Canvas: one smooth skin (no folds, straps, side curtain windows on the doors' upper half;
  the doors' upper frames are painted steel with fixed glass, sliding on the car).
- Rear door: the tail face between ±0.32 from the body's top to 0.70; the real door is
  wider (about ±0.40 [P]) and its hinges stand proud. Only the left fuel flap is built (the
  car has one each side).
- No bull bar, door hinges proud of the skin, door check straps, scuttle side lamps as their
  own parts (the repeater stands in), reversing lamp under the bumper (a lens under each tail
  lamp instead), plate, mud flaps.
- Dash: olive whatever the paint (the real one is body colour); the hazard button and the
  radio are kept for the game though the 469 has neither; the ammeter reads the volts
  channel.
- Running gear `cf_uaz31512`'s (the 469B's successor, the same chassis, hard-top kerb 1750
  kg; the canvas car is ~100 kg lighter [E]).

## UAZ-452

Draft stage: spec `BODY_UAZ2206` / `LOOK_UAZ2206` in `uaz.ts` (not `uazvans.ts`: one
family file), dash `CABIN_UAZ2206` and platform `LAYOUTS.van` in interior.ts, catalogue
row `kit_uaz2206` on `sa_uaz330364` with `GEAR_UAZ_2206`. Awaiting the owner's review.
10 733 triangles (body + trim 4 411, cabin 3 988, underbody 838, exhaust 152, wheels
1 344; no bay or boot). Lab shots in `/tmp/kit-review/uaz2206/`.

Where the build departs from §5–§6 below:

- The face station stands at 0.05 with a 0.04 deep bumper (a bumper as deep as the face's
  s left its brackets zero long, in the face's plane: a z-fight).
- The A pillar strip runs 0.40–0.45 and the door glass starts at 0.49 (top 0.69): a 3 cm
  pillar folded its lining into the door's jamb (z-fight at s 0.55, y 1.67).
- The floor stands 0.25 over the sill at the cowl + 0.5 (0.50), so 0.75: above the front
  arch's 0.728, no wheel boxes inside (`frontHumps` dropped; the rear covers are skipped on
  the van, under the floor). Seats, bench and cover stand 10 mm into the floor
  (`Cabin.standY`): the floor shows through the saloon glass and feet in its plane fought.
- The engine cover is a control (`engine_cover`, hinged at its front top edge) over a
  schematic block; the gearbox starts at the cover's rear end (`BayRoute.gearFrom`), the
  transfer box behind it, not at the cowl.
- The lowest tail cell is the reversing lamp (drawn: a reflector); the clusters stop at
  ±0.855 inside the tail face (drawn ±0.895). The roof-corner marker stands in as the
  repeater on the B post under the belt [E].
- The rear doors (owner's review, 2026-10-17): one rounded pane in each leaf in a painted
  frame, ±0.072–0.60 at 1.45–1.77, r 0.06, and the leaves' top straight across at 1.85
  under the roof's rear panel (`CabinSpec.rearPanes`, §3.7). Before, one pane each from
  the centre line to the pillar row, from 1.445 up to the roof's arch (~1.91 on the centre
  line), the leaves' top on the roof's edge. The rear corner is blank (§8).
- The rear leaves' fittings (`KitLook.rearLeaves`, 2026-10-17): two outside hinges per
  leaf, ±0.62–0.75 at 0.93–1.005 and 1.71–1.77 (§3.7), a body-colour strap and knuckle
  each, square to the leaf's skin and hung on the leaf so they swing with it; the handle
  on the right leaf at 1.24, 0.05–0.13 from the centre line [E: §3.7 gives only "the inner
  edge"]. Not built: the plate lamp. The outside door handles stand where measured
  (`KitLook.handles`: s 1.22 and 2.64 at 1.242, 7 cm long, §3.5); before, the front
  doors' stood at s 0.27, ahead of the door on the cowl.
- The leaves' outer edge leans from ±0.72 at the belt to ±0.76 at the top (the pillar
  row; drawn upright at ±0.725); their bottom at 0.70 (drawn 0.73, on the bumper's top).

### 0. Which car

**The UAZ-2206 bus**, the 452V's index from 1985: the windowed «буханка», with glass all
round, a single side door on the right and two rear doors. Why this one:

- It is the iconic shape. The loaf reads by its windows and round roof, and the cabin
  shows through clear glass, which is the kit's own purpose.
- The only fully dimensioned factory drawing found is the 2206's (§1).
- The other bodies are the same stampings and come later as a column swap, with no new
  generator work. The **3741** panel van has blank panels with louvres instead of the
  saloon glass (`glass: 'none'`). The **3962** ambulance has the 2206's glass, blank
  in places. The **3909** is the van with a crew partition.

### 1. Sources

All files are in `build/carshape/_refs/bp/img/` (gitignored). `file` was run on each:
all are real images, none is an HTML 404.

**Drawings**

| File | What | Use |
|---|---|---|
| `uaz452_dwg-2206-manual.gif` (+ `.png` conversion), 1826 × 1209 | UAZ-2206 factory four-view: the operating manual's figure, РЭ 05808600.059-96 for 3741/3962/3909/2206/3303. Downloaded from getoutlines.com `blueprints/car/uaz/uaz-2206-2005.gif` (page "1965 UAZ 452 2206 Van blueprints"). drawingdatabase.com `uaz-452-02.gif` and getoutlines `uaz-452-02.gif` are the same drawing (31 pixels differ). | **Main reference.** Dimension lines 4440⁺¹⁰₋₁₅ / 993* / 2300* (база) / 1087* / 1147* / 1940 / 2101 / 1445* / 1230 / 1324* / 1302 / 712 / 598 / 514* / 588 / 477 / 364 / 534 / 551* / 644 / 782 / 220* / 1235 / 1315 (inside height) / 2733 / 900 / 1818. |
| `uaz452_dwg-3741-manual.gif`, 1801 × 1206 | 3741 panel van, the same manual figure; adds 2603 / 1093 / 1138. | Cross-check and the van variant. |
| `uaz452_dwg-3909-manual.gif`, `uaz452_dwg-3303-manual.gif` | 3909 crew van; 3303 flatbed (4535 / 2550 / 1054 / 931 / 1940 / 2355 / 1974 / 205*). | The 3303 is the `sa_uaz330364` body (§4). |
| `uaz452_bp-452-vector-full.jpg`, `uaz452_bp-452d-vector-full.jpg` | the-blueprints.com watermarked previews: "UAZ 452 (1965-present)" (4450 / 2300 / 1940 / 2030) and "UAZ 452D" (1940 / 2090). Pages `vectordrawings/show/20312/uaz_452/` and `/21062/uaz_452d/`, previews `modules/vectordrawings/preview-wm/uaz_452_1965.jpg` and `uaz_452d_1965.jpg`. | Colour reading only: it draws the side door on the left (mirrored) and is low resolution. |

3dcar.ru could not be reached (every request timed out, the site root too).
`https://archive.org/wayback/available` returned nothing usable for `.../full/uaz/uaz_452…`,
`uaz_2206`, `uaz_3741`, `uaz_3962`, `uaz_3909`.

**Photos.** Wikimedia Commons, via the API, 1800–1920 px renditions:

| File | Commons title | Licence, author | Use |
|---|---|---|---|
| `uaz452_photo-side-right-ems-G1.jpg` | UAZ-452 Medical (EMS) 2006 G1.jpg | CC BY-SA 3.0, George Chernilevsky | **Near-orthographic right side.** Hubs x 565 / 1432, ground y 1041 → **2.653 mm/px** from the 2300 wheelbase (the rear tyre's static radius comes out at 359 mm against the drawn 364). `s = 0.993 + (1432 − x) × 0.002653`, `y = (1041 − py) × 0.002653`. |
| `uaz452_photo-side-right-ems-G3.jpg` | UAZ-452 Medical (EMS) 2006 G3.jpg | CC BY-SA 3.0, George Chernilevsky | Right side; the same layout. |
| `uaz452_photo-side-right-militsia.jpg` | УАЗ 452 Милиция.JPG | Public domain, Georg Pik | Right side, the 3741-type louvred rear panel. |
| `uaz452_photo-side-right-rear34-back.jpg` | UAZ-452 back.JPG | CC BY-SA 3.0, Druschba 4 | Right side and rear doors. |
| `uaz452_photo-2206-1995-right-front34.jpg` | 1995 UAZ 2206 beige front.jpg | CC0, Throwawayacc222 | 2206 right side: the glazed panel window, louvre, fuel recess, side door. |
| `uaz452_photo-2206-1995-rear34.jpg` | 1995 UAZ 2206 beige rear.jpg | CC0, Throwawayacc222 | Rear doors, lamps. |
| `uaz452_photo-3962-left.jpg` | Aŭto UAZ-3962 04.jpg | CC BY-SA 4.0, RG72 | **Left side**: the same window places as the right, no side door. |
| `uaz452_photo-3962-left-rear34.jpg` | Aŭto UAZ-3962 01.jpg | CC BY-SA 4.0, RG72 | Rear doors, lamp cluster, rear bumper. |
| `uaz452_photo-3741-left-rear34.jpg` | UAZ-452 150730.jpg | CC0, Trop86 | 3741 left side and rear doors. |
| `uaz452_photo-2206-2018-left-front34.jpg` | UAZ-452 2206 (2018) (53365637730).jpg | CC BY 2.0, Charles from Port Chester, New York | Face, two-tone paint. |
| `uaz452_photo-396255-front34.jpg` | 2013 UAZ 396255 front.jpg | CC0, Throwawayacc222 | Face, lamps, grille. |
| `uaz452_photo-rear34-20090822.jpg` | UAZ 452 rear 20090822.jpg | CC0, Debat634643642362 | Rear. |
| `uaz452_photo-dash-steering.jpg` | Uljanowski Awtomobilny Sawod 452 (steering wheel).jpg | CC BY-SA 4.0, Fiver, der Hellseher | Dash: a flat steel panel with round dials, a large thin wheel on a near-vertical column. |

Commons has no other interior photos ("UAZ-452 interior/cabin/dashboard", "УАЗ-452
кабина" return nothing).

**Factory figures**

| Figure | Value | Source |
|---|---|---|
| Length | **4440** incl. the tow hitch (993 + 2300 + 1147); **4380** to the rear bumper (993 + 2300 + 1087) | [D] the manual drawing's dimension lines. Modern 2206: 4363 [F ru.wikipedia "УАЗ-452" infobox] |
| Width | **1940** | [D]; [F] ru.wikipedia, carexpert.ru (models/uaz/2206/tech/uaz2206v29.htm). "2100 max" on the plan is over the mirrors [D] |
| Height | **2101** (over the roof vent) | [D]; [F] 2100 at carexpert.ru; modern 2064 [F ru.wikipedia] |
| Wheelbase | **2300** | [D]; [F] all sources |
| Track front / rear | **1445 / 1445** | [D]. Modern, on 225/75 R16: 1442 / 1465 [F ru.wikipedia] |
| Ground clearance | **220** | [D 220*]; [F] carexpert.ru. Modern: 205 |
| Tyre | 215/90-15C (Я-245): static radius 364 | [D 364 at the rear hub]; [F] carexpert.ru lists "215/90 R15; 225/75 R16" |
| Kerb mass | **1850** (1020 front / 830 rear); 1855 | [F] autoopt.ru encyclopedia "УАЗ-2206"; [F] infoaboutauto.narod.ru/models/uaz/2206t.html, carexpert.ru |
| Gross mass | 2780 | [F] infoaboutauto.narod.ru |
| Tanks | 56 + 30 l; fillers on both sides | [F] infoaboutauto.narod.ru; [P] a recess on each flank |
| Inside height (saloon) | 1315 | [D] |

### 2. Scales and the drawing's faults

- **Side view.** Ground y 469. Hubs x 356 / 850 → **4.656 mm/px** from the drawn
  wheelbase. The front bumper tip at x 142 matches the 993 dimension exactly (214 px).
  `s = (x − 142) × 0.004656`.
- **The drawn rear end is 100 mm short.** The 1087 line meets the drawn bumper at x 1062,
  which is 987 behind the hub. The 1147 line meets the hitch at 1073, which is 1038. The
  photo gives the rear body face 0.971 behind the hub and the bumper 1.061 behind it, so
  everything aft of the rear axle comes **from the photo**.
- **Heights.** The side view's horizontal scale makes the gutter 1.86. The front view's
  scale (2101 ↔ 441 px = **4.77 mm/px**; 1940 ↔ 404 px = 4.80; 1445 ↔ 305 px = 4.74) gives
  1.908, and the photo gives 1.912. So the drawing is drawn about 2.4 % tall: side-view
  heights use 4.77, `y = (469 − py) × 0.00477`.
- **The height dimension lines on the side view are schematic.** Their extension lines do
  not land at the scale, so 534 / 551 / 644 / 782 / 1302 are taken as labels only.
- **Front view**: centre x 1517, ground y 469, 4.77 mm/px. **Rear view**: centre x 1517,
  ground y 1097, 4.74 mm/px (1235 ↔ 261 px).

### 3. Measurements

The kit frame: `s` rearward from the front bumper's tip, `y` above the ground, `x` the
half width. Front hub s **0.993**, rear hub s **3.293**.

**3.1 Overall and wheels**

| Item | Value | Tag |
|---|---|---|
| Bumper to bumper | 4.380 | [D 993 + 2300 + 1087]; photo 4.354 |
| Front overhang to the bumper / the body face | 0.993 / 0.95 (face at s 0.04–0.06) | [D] |
| Rear body face behind the rear hub | 0.971 (s 4.264) at 0.5–1.3 m; leans forward above the belt: 4.18 at 1.67, the gutter's end at 4.14 | [P] |
| Rear bumper behind the rear hub | 1.061 [P] / 1.087 [D dimension] → **s 4.380** | [D] |
| Tyre radius | 0.364 static | [D]; [P] 0.359 |
| Half track | 0.7225 | [D 1445] |
| Front arch | top 0.714 (0.96 r over the hub), s 0.627–1.290; trapezoidal with round corners | [P] |
| Rear arch | flat top 0.639, **below the tyre's top**: the body hides it. s 2.89–3.60 | [P] |

**3.2 Heights of the side**

| Item | Value | Tag |
|---|---|---|
| Body side's bottom between the arches | 0.42 (dark lower flange to 0.415, door bottoms 0.449) | [P]; drawing 0.44–0.46 (the 477 dimension is under the floor) |
| Front door's bottom ahead of the arch (the step) | **0.588** | [D 588] |
| Tail sill | 0.48–0.52 | [P]; [D 534] |
| Widest line (crease) | ~1.0–1.1; ±0.957–0.964 at 0.6–1.25 m | [D front and rear views] |
| Belt (pressed line at the windows' foot) | **1.32** | [P 1.319]; [D 1.313] |
| Side glass | foot 1.395–1.41, top 1.83–1.84 | [P] |
| Gutter (drip rail) | **1.91** | [P 1.912]; [D front 1.908] |
| Roof | centre 2.07–2.09 (2.101 over the vent hatch) | [D front 2.07, rear 2.071] |
| Side's top at the photo's silhouette | 2.024 | [P]: the roof's near shoulder, not the centre |

**3.3 Half widths**

From the front and rear views at 4.77 / 4.74 mm/px, the mirrors excluded.

| y | Front view | Rear view | Note |
|---|---|---|---|
| 0.50 | – (tyres) | 0.903 | rounded lower corner |
| 0.60–1.25 | 0.964 | 0.95–0.957 | widest |
| 1.31–1.38 | 0.913–0.923 | 0.931–0.98 (belt crease) | belt |
| 1.45–1.60 | – (mirrors) | 0.967–0.893 | |
| 1.64–1.81 | 0.894–0.873 | 0.893–0.870 | greenhouse: nearly upright |
| 1.83–1.86 | 0.909–0.904 | 0.903–0.898 | gutter |
| 1.88–1.90 | 0.88–0.86 | 0.875–0.844 | roof edge |
| 1.95 | 0.809 | 0.78 | |
| 2.00 | 0.684 | 0.647 | |
| 2.02 | 0.603 | 0.552 | |
| 2.046 | 0.489 | 0.401 | |

Plan view: the nose is round in plan, its corners about r 0.25, the face at s 0.04–0.06
on the centre line and the full width by s ~0.25 [D plan]. The tail corners are about
r 0.2 [D plan, ×4.656].

**3.4 Nose and windscreen (side view)**

| Item | s, y | Tag |
|---|---|---|
| Bumper | s 0–0.25 (it wraps round the corners), y 0.582–0.701 | [D; 598 / 712 dimensions] |
| Face | s 0.04–0.06 from 0.81 to 1.16 | [D] |
| Nose top curving back | (0.084, 1.259), (0.154, 1.331), (0.223, 1.369) | [D] |
| Screen's foot on the centre line | (0.256, 1.436) | [D] |
| Screen's top on the centre line | (0.466, 1.856) | [D]. Front view: glass 1.42–1.81, ±0.78; frame 1.39–1.85, ±0.80 |
| A pillar outer line | (0.456, 1.33) → (0.689, 1.88) | [D]; [P] the door's front edge 0.415 at the belt, 0.68 at the roof |
| Roof's front | the gutter visor's tip at (0.456, 1.90); the roof rounds up to 2.05–2.08 by s 0.71 | [D] |

**3.5 Doors and windows (right side)**

| Item | s at the belt | Tag |
|---|---|---|
| Front door | front edge 0.36–0.39 below ~1.2 m [D x 220–225] / 0.32–0.35 [P]; along the A pillar above (0.419, 1.28) → (0.689, 1.89) [D]. Rear edge **1.29** [P 1.290; D 1.30–1.32]. Hinged at the front | [D], [P] |
| Front door glass | front edge parallel to the pillar, (0.526, 1.33) → (0.735, 1.83) [D]; rear edge 1.21 [P]; 1.41–1.815 [P]. On the car it is a two-pane slider | [D], [P] |
| Panel with louvre and filler | 1.29–1.874; window 1.364–1.807, 1.39–1.84 (glazed on the 2206, blank on the 3962) | [P] |
| **Side door, right only** | **1.874–2.805**, hinged at its front edge; window 1.935–2.736 (a two-pane slider, split at 2.439), 1.40–1.83 | [P] |
| Saloon panel | 2.805–3.810; window 2.877–3.757 (slider split at 3.474) | [P] |
| Rear corner | 3.810 to the rear face. Window 3.845–4.177, wrapping the corner: glazed on the drawing [D]; blank (a pressed panel) on the 1995 2206, the 3962, the photo `-back` and the owner's modern 2206 rear view [P] | [D] / [P] |
| Left side | the same window places, no side door | [P `3962-left`] |
| Door handles | y 1.242; front door's at s 1.19–1.25, side door's at 2.60–2.68 | [P] |
| Louvre | s 1.494–1.616, y 1.130–1.289 | [P] |
| Fuel filler recess | s 1.44–1.56, y 0.72–0.90 (one on each flank) | [P] |
| Amber marker lamp at the roof's corner | s 1.32–1.39, y 1.815–1.88 | [P] |

**3.6 Face (front view, ×4.77, centre x 1517)**

| Item | Value | Tag |
|---|---|---|
| Head lamps, round | centres ±0.522, y 1.021; lens r 0.095 (a 7" lamp), chrome bezel r 0.138 | [D] |
| Small round lamps under them (amber indicators) | ±0.642, y 0.806, r 0.072 | [D]; [P] amber |
| Grille | a trapezoid: ±0.453 at 0.699, ±0.32 at 0.937; a diamond mesh in a raised frame | [D] |
| Radiator hatch above the grille | ±0.227, 0.973–1.097, shut line only | [D] |
| Emblem | y 1.27 | [D] |
| Bumper | ±0.883, 0.580–0.699; black channel | [D]; [P] black |
| Driver | steering wheel centre x +0.515, y 1.52, r ≈ 0.19–0.21 | [D front view; LHD] |

**3.7 Tail (rear view, ×4.74)**

| Item | Value | Tag |
|---|---|---|
| Rear doors | two leaves split on the centre line, each hinged at its outer edge; ±0.725; bottom **0.73** (on the bumper's 0.70 top), top **1.85**, straight across under the roof's rear panel | [D ×4.74: x 1365 / 1671, y 944 / 707] |
| Rear door glass | x from ±0.071 to ±0.597, y 1.450–1.770, corners r ≈ 0.06 (one pane per leaf, 0.14 of painted frame between them) | [D: x 1391–1502, y 724–792]; the owner's modern 2206 rear view (by the ±0.725 leaves): ±0.076–0.63 |
| Rear door hinges | outside, two per leaf across the outer shut line: x 0.62–0.75, y 1.71–1.77 and 0.93–1.005 | [D]; [P the owner's rear view, `2206-1995-rear34`] |
| Belt line across the doors | 1.334 | [D] |
| Rear door handle | y 1.24, at the right leaf's inner edge | [D] |
| Lamp clusters | ±0.775–0.895, y 0.76–1.12. Top to bottom: amber 0.99–1.12, red tail/stop 0.89–0.99, round reflector 0.76–0.86 | [D]; [P `3962-left-rear34`] |
| Rear bumper | 0.58–0.70, near the full width; black | [D]; [P] |
| Rear corner windows wrapping | x 0.78–0.88 at 1.38–1.77 (drawn; blank on the photographed cars) | [D x 1331–1354, y 725–808] |

**3.8 Interior (thin: one dash photo, no dimensions)**

| Item | Value | Tag |
|---|---|---|
| Saloon floor | ~0.72 | [E] the roof lining ~2.03 minus the 1315 inside height [D] |
| Driver's seat centre line | x 0.515 | [D] the wheel's centre |
| Wheel | large and thin, the column close to vertical | [P `dash-steering`] |
| Dash | a flat painted steel panel; round dials before the driver; toggle switches | [P] |
| Dash face | 0.22 tall, shelf lip +0.04 to foot −0.18 over the belt (was −0.20) | [E] about 1.9 panel heights in `dash-steering` |
| Instrument panel | 0.23 × 0.094 inside the chrome frame (was 0.31 × 0.12), centre 0.035 outboard of the column (was 0.06), up −0.096; plate `binnacleHalf` 0.125 | [P] a strip ~2.5:1 under the lamps' row, inner end at the column; size [E] |
| Dials | speedometer r 0.029, oil / fuel / temperature r 0.02, bezels nearly touching; lamps at pitch 0.025 over them | [P] ratio ~1.45; sizes [E] |
| Radio (none on the car, kept for the game) | hung under the face's foot, x 0.29, its top tucked into the face | [E] |
| Engine | under a padded cover between the front seats, from the dash back about 0.9 m | [E] the general layout; no measured figure |
| Front seats | on the front wheel boxes | [E] |

### 4. The catalogue sibling `sa_uaz330364`

`vehicle/carmodels.ts`: `sa_uaz330364` is a cab-over flatbed on the 452-family chassis
with the long 2550 base.

| | `sa_uaz330364` (row + entry) | UAZ-2206 |
|---|---|---|
| L × W × H | 4.535 × 1.974 × 2.355 (tilt) | 4.380 (bumpers) × 1.940 × 2.101 |
| Wheelbase, front overhang | 2.550, 1.054 | **2.300**, 0.993 |
| Tracks | 1.445 / 1.445 | 1.445 / 1.445 |
| Clearance | 0.205 | 0.220 (modern 0.205) |
| Tyre | 225/75 R16, rolling 0.372, width 0.225 | 215/90-15C (radius about the same: 0.364 static) |
| Kerb mass, front share | 1845, 1180 / 1845 = 0.64 | **1850, 1020 / 1850 = 0.551** [F autoopt.ru] |
| Engine, gearbox | UMZ-4213, `gearbox_uaz_4` | UMZ-4218 / ZMZ-402 by year; the same four-speed box and transfer box |
| Tank | 56 | 56 + 30 |
| Cd·A, aero | 3.45 from 105 km/h, `AERO_UAZ_330364` | no source; the van's frontal area is about the same (1.94 × 2.10) |

It is a good running-gear sibling. The kit row takes the 2300 wheelbase and the
1.940 / 2.101 body. A `GEAR_UAZ_2206: KitRunningGear` carries `mass: 1850`,
`frontWeightShare: 1020 / 1850` and `tankLitres: 86`, and keeps the sibling's engine,
box, tyre, lock (already set on the 2206's 6.3 m), grip, brakes and aero. Its
`bodyClass: 'truck'` and `OFFROAD_WHEEL_SET_POOL` are inherited through `KIT_CARS`.

### 5. The spec (numbers ready to type)

The family goes in its own file, `src/carkit/uazvans.ts`, with `BODY_UAZ2206` and
`LOOK_UAZ2206`. `length: 4.38`, `platform: 'van'` (§6.4).

**Stations**:

| s | sill | crease | belt | deck | wSill | wCrease | wBelt | Note |
|---|---|---|---|---|---|---|---|---|
| 0.05 | 0.57 | 0.95 | 1.16 | 1.22 | 0.70 | 0.76 | 0.70 | face [D]; plan rounding [E] |
| 0.15 | 0.56 | 1.00 | 1.30 | 1.34 | 0.86 | 0.92 | 0.87 | nose curve [D] |
| 0.30 | 0.55 | 1.05 | 1.32 | 1.38 | 0.92 | 0.957 | 0.93 | nose top 1.37–1.39 [D] |
| 0.62 | 0.55 | 1.05 | 1.32 | 1.38 | 0.92 | 0.964 | 0.93 | ahead of the front arch: front door bottom = sill + bevel 0.585 [D 588] |
| 1.36 | 0.42 | 1.05 | 1.32 | 1.38 | 0.905 | 0.964 | 0.93 | behind the arch [P] |
| 3.62 | 0.42 | 1.05 | 1.32 | 1.38 | 0.905 | 0.957 | 0.93 | |
| 4.04 | 0.50 | 1.05 | 1.32 | 1.38 | 0.90 | 0.955 | 0.93 | the tail's rounding starts [D plan] |
| 4.24 | 0.52 | 1.05 | 1.32 | 1.36 | 0.86 | 0.92 | 0.90 | rearBase: the rear doors' top edge at the deck edge |
| 4.264 | 0.52 | 1.05 | 1.32 | 0.70 | 0.84 | 0.90 | 0.88 | tail face; `notch: 0.72`: the rear doors come down to 0.70 between the lamp corners [D] |

**Other body fields**

- `shoulder: { inset: 0.04, rise: 0.04 }`: the deck's edge ±0.89 at 1.36 [D].
- `doorBottom: 0.45` [P]. Ahead of the front arch it clamps to the 0.55 sill band
  (body.ts `sideColumn`), which gives the 0.585 step.
- **`bonnetFront: 0.40`, equal to the cowl**. No deck strip lies between it and
  `bonnetRear`, so no bonnet is cut (§6.1).
- `flap: { s0: 1.44, s1: 1.56, y0: 0.72, y1: 0.90 }` on the right [P].
- `wheels: { front: 0.993, rear: 3.293, radius: 0.364, width: 0.215, frontHalfTrack: 0.7225, rearHalfTrack: 0.7225, arch: 1.0, rearArch: 1.0, rearArchRise: 0.76 }`.
  The rear arch's top at 0.639 is (0.639 − 0.364) / 0.364 = 0.76 r [P]. The front's
  circle tops at 0.728 against a measured 0.714.

**Cabin**

- `rail: 1.88`, `railHalf: 0.88`, `railInset: 0.07`, `railRise: 0.07`,
  `railBend: [0.3, 0.6]`, `crown: 0.13` (roof centre 2.08) [D §3.3].
- `glassBottom: 0.04`, `glassTop: 0.04` [P 1.40 / 1.835].
- `screenBottom: 0.04`, `screenHeader: 0.07`, `screenFoot: 0.14` [D: the foot 0.256 on
  the centre line].
- `rearBottom: 0.085`, `rearHeader: 0.10` [D rear 1.446 / 1.777].
- `pillar: 0.12`: the windscreen glass's edge ±0.77 (drawn 0.78); the rear doors' cut at
  rearBase ±0.74 (drawn 0.72).
- `wiperBlade: 0.33` [E, the classics'; unmeasured].

**Columns**. `only` is the new field of §6.3.

| s | top | upper | lower | glass | Note |
|---|---|---|---|---|---|
| 0.40 | 0.60 | body | door1 | – | cowl; A pillar strip. Drawn: the door's edge 0.36–0.39 below, the pillar 0.456→0.689; the screen's top 0.466 on the centre line |
| 0.43 | 0.63 | door1 | | – | door frame |
| 0.47 | 0.67 | door1 | | drop | glass parallel to the pillar [D 0.526→0.735] |
| 1.21 | 1.21 | door1 | | – | frame strip [P] |
| 1.29 | 1.29 | body | | – | B post [P] |
| 1.364 | 1.364 | body | | fixed | [P] |
| 1.807 | 1.807 | body | | – | |
| 1.874 | 1.874 | door2 | | – | `only: 'right'` [P] |
| 1.935 | 1.935 | door2 | | fixed | `only: 'right'`; on the left a body pane in the same place [P] |
| 2.736 | 2.736 | door2 | | – | `only: 'right'` |
| 2.805 | 2.805 | body | | – | |
| 2.877 | 2.877 | body | | fixed | |
| 3.757 | 3.757 | body | | – | |
| (3.845) | | | | | the rear corner window [D] is not built: blank on every photographed car (§8) |
| 4.18 | 4.12 | body | | – | the rear face's lean [P] |
| 4.24 | 4.14 | | | | rearBase [P: the gutter's end 4.14] |

The roof's front edge (`top + railInset`) lands at s 0.67. The drawn roof is level from
0.71, so no `roofDrop` is needed.

**Look**

- `front.bumper`: a blade, `finish: 'black'`, height 0.12, depth 0.06, `wrap` 0.2 [D].
- `front.items`:
  - head lamps: `round`, x `{ centre: 0.522 }`, y `['bumperTop', 0.32]`, radius 0.095
    (chrome ring);
  - indicators: `round`, `blinker`, x `{ centre: 0.642 }`, y `['bumperTop', 0.107]`,
    radius 0.072;
  - grille: x 0.39 (the trapezoid's mean), y from `['bumperTop', 0]` to
    `['bumperTop', 0.24]`, crossed bars, a body-colour frame (§6.6 for the trapezoid);
  - hatch: `frame` ±0.227 × `['bumperTop', 0.274..0.398]`, black, width 0.005.
- `rear.bumper`: a blade, black, 0.58–0.70.
- `rear.items`: a `cluster`, x from `{ centre: 0.775 }` to `{ centre: 0.895 }`, y
  `['bumperTop', 0.06..0.42]`, columns `[['blinker', 'tail', 'brake', 'inert']]`, or the
  three cells of §3.7.
- `repeater`: the amber roof-corner marker, s 1.32–1.39, y 1.815–1.88. It needs a check:
  the repeater builder lays it on the flank below the belt.
- `brightwork: 'black'`, `sill: null`, `waist: null`, `headrests: false`.

### 6. Generator plan: what breaks for a forward-control van

Every change below is an optional field, or a branch on the new platform `'van'`. An
existing car never sets the field and never has that platform, so it takes exactly the
code path it takes today. Prove it as README "Proving a refactor" describes: all 20 cars
identical against HEAD (or HEAD plus the 469's commit), by sorted-triangle hashes.

**6.1 No bonnet: no change.** The cab sits over the front axle, and the short nose ahead
of the windscreen is fixed body.
- In `buildShell` the deck owner is `'bonnet'` only for
  `sMid > bonnetFront && sMid < frame.bonnetRear`. With `bonnetFront` at the cowl,
  `bonnetRear` is either the cowl (no `screenFoot`, no `bonnet`) or ahead of it (with
  `screenFoot`), so no face becomes a bonnet and no `bonnet` node exists.
- The tub column it adds is already a column. `screenFoot` adds `bonnetRear`, which is
  harmless.
- Things that must not be used on the van:
  - `bonnet` / `nose` and `front.lid` items: exterior.ts `buildLidFace` throws without a
    bonnet node;
  - `frontLean`: its default `full` is `bonnetFront`.
- bay.ts `buildEngineBay` assumes the bay: `support = bonnetFront + 0.1`, inner wings
  from it to the cowl, scuttle. It is skipped on the van (6.5).
- Rejected: making `bonnetFront` optional. That touches four files for what the
  equal-to-cowl value already gives.

**6.2 Two rear doors split on the centre line, each hinged at its outer edge.** Uaz469 is
adding `KitCarSpec.tailgateHinge?: 'left' | 'right'` (a single side-hinged rear door)
in spec.ts, body.ts `pivotOf` and kit.ts `shellMotion`. Extend it with a third value,
`'split'`:

1. spec.ts: `tailgateHinge?: 'left' | 'right' | 'split'`, documented as two leaves cut on
   the centre line.
2. body.ts: add a `BodyFrame` helper `tailgateOwner(side: number): string`. It returns
   `'tailgate'` unless the hinge is `'split'`, and then `side > 0 ? 'tailgate_l' : 'tailgate_r'`.
   Use it at the three places that name the tailgate. Every one of them is already built
   per side, with a vertex on x = 0:
   - the deck owner (`buildShell`, `owner = 'tailgate'` behind the rear base, ~l. 652);
   - the greenhouse `upper = hatch && !cabin.softTop ? 'tailgate' : 'body'` (~l. 925),
     whose glass takes `upper`; the soft-top `strip` test next to it (`upper === 'tailgate'`)
     becomes `upper.startsWith('tailgate')`;
   - the `lidFace` panel's `frame.lidOwner` (~l. 747).

   `lidOwner` stays `'tailgate'`, for the callers that ask what kind of part it is.
3. body.ts `MOVING` (`/^(door_|bonnet|boot|tailgate|flap)/`) already matches
   `tailgate_l/_r`. `cutShell` already handles an edge between two parts: front and rear
   doors meet below the belt on every four-door car. Its inner-skin colour test
   (`f.owner === 'tailgate'`, ~l. 1149) becomes `f.owner.startsWith('tailgate')`, so the
   leaves' inner skins are trim, not paint.
4. body.ts `pivotOf` (~l. 1198, Uaz469's side hinge): for `tailgate_l` the hinge is the
   leaf's outermost (max x) vertical edge, for `tailgate_r` the min x edge. This is the
   same rule as `'left'` / `'right'`.
5. kit.ts `shellMotion`: `owner.startsWith('tailgate_')` gives
   `{ kind: 'rot', axis: [0, 1, 0], amount: owner.endsWith('l') ? -1.5 : 1.5 }`.
6. kit.ts `PART_LABELS`: `tailgate_l: 'Левая задняя дверь'`,
   `tailgate_r: 'Правая задняя дверь'`.
7. audio/cabinopenness.ts: rows for `tailgate_l` / `tailgate_r`, each half of
   `'tailgate'`'s 0.6. player/interaction.ts ~l. 307 (whether the boot is open:
   `rig.get('tailgate') > LID_OPEN`) also accepts either leaf.
8. exterior.ts: `buildLidFace` and `buildSpoiler` look up `'tailgate'`. The van sets
   neither `rear.lid` nor `spoiler`.

The rear doors' panes: `CabinSpec.rearPanes` (built after the owner's review, §0).

**6.3 A door on one side only (the side door).** Add
`CabinColumn.only?: 'left' | 'right'`: the strip's door owner exists only on that side,
and on the other side the strip is `'body'` with the same glass. On a left-hand-drive car
the right side is side −1 (x < 0).

- body.ts: add `stripOwner(column, band: 'upper' | 'lower', side): CabinOwner`, which
  returns `'body'` when `column.only` is set and names the other side. Use it in
  `buildShell` at:
  - the tub strip's `lower`;
  - the rake's `nearLower` / `farLower`;
  - the greenhouse's `owner = column.upper`.
- interior.ts `sidePanels` tests `lower !== 'body'` side-agnostically. Move its side loop
  outward and use `stripOwner` per side, or the doorless side loses its trim there.
  `doorRange` and `doors()` work per door node, so `door_rr` alone gets its card.
- Glass: a `'fixed'` strip becomes a body pane on the doorless side
  (`upper === 'body' ? 'body'`) and the door's `quarter_rr` on the door side, which rides
  with it. That is what the car has.
- Optional label: `door_rr` as 'Боковая дверь' through a per-spec label map. Skip it in
  the draft.

**6.4 Platform `'van'`**:

1. spec.ts: `platform: 'classic' | 'samara' | 'niva' | 'van'`, documented as a forward
   control: the cab over the front axle, the engine under a cover between the front
   seats, a high flat floor to the rear doors, four-wheel drive.
2. interior.ts `LAYOUTS` (`Record<platform, Layout>`, so the compiler demands it):
   `van: Layout`. Seats over the wheel boxes, a large flat wheel, a near-vertical column,
   a flat steel dash with round dials (copy the classic's and set the dash section
   upright and shallow), no console, `tunnel.heights: [0, 0, 0]` (zero-area faces;
   `simplifyFlats` drops them) and `bench: { from: 'rearBase', offset: -0.55 }`.
3. New optional `Layout` fields. Absent means today's behaviour.
   - `floorRise?: number`. `cabinFloor(frame)` uses `lay.floorRise ?? FLOOR_RISE`. To
     get there, add one helper, `layoutOf(frame)`, for the
     `{ ...LAYOUTS[platform], ...cabinLayout }` merge now repeated in `loadSpaceStart`,
     `driverEyeAt` and the `Cabin` constructor. Van: 0.30, so the floor stands at 0.72
     [E §3.8].
   - `frontHumps?: boolean`. `humps()` runs per axle; the front wheel boxes stand from
     the firewall side, and the seat bases sit on them.
   - `engineCover?: { ds0: number; ds1: number; half: number; height: number }`: a padded
     box (`pad()`) on the centre line between the seats, in the dash colour.
   - `noShelf?: boolean`, or skip `shelf()` when `platform === 'van'`. A hatch would
     otherwise grow a parcel shelf from the bench to the knee.
4. `Cabin` constructor: on the van `lowerEnd` is `rearBase − 0.06`, not the bench. That
   is the old `HATCH_TRIM_CLEAR` value; the constant is gone, so the number goes in as a
   new named constant. The saloon is lined to the rear doors. `floorEnd` and the floor
   rows run to the rear doors (`rearBase − 0.03`): the saloon floor is the load floor.
5. The draft has one transverse bench at the back. The 2206's longitudinal seats are left
   out (a gap).

**6.5 bay.ts on the van.** `buildBay` branches on `frame.spec.platform === 'van'`:

1. No `buildEngineBay` (there is nothing ahead of the cowl to open).
2. A `van` engine side: the block (the classic's box shapes, reused) under the cover,
   between the seats at the cover's ds range, in `kit_bay`. It returns the `BayRoute`:
   the down-pipe under the cover, the crank at the floor.
3. Bonnet cells: none in the draft. carmodel.ts takes all four or none, and with none the
   car behaves like the `sa_uaz330364` pack body. Later, cells under the cover would make
   it the engine's service hatch, if the owner wants the bonnet grid there.
4. No boot: skip `buildHatchBoot`, since the floor is the cabin's.
5. Underbody: the `classicChassis` with `nivaTransfer` (live axles front and rear,
   transfer box, front propshaft). `clearance(frame)` returns 0.22 for `'van'` [D 220].
   The exhaust starts from the van's route.
6. Every bay.ts constant stays the same for the other platforms.

**6.6 Optional, after the owner's first look:**
- the grille as a trapezoid: a `slant?: { outer, inner }` on the `grille` FaceItem,
  meaning what the lens's means;
- the gutter visor over the windscreen (the drawn tip 0.2 ahead of the screen's top);
- rounded window corners;
- the 0.14 rear mullion (6.2).

Each is cosmetic; leave them until the owner asks.

### 7. Step-by-step for the implementing agent

1. Re-read README "Working rules" and this section. Wait for Uaz469's `tailgateHinge`
   to land (body.ts, kit.ts, spec.ts are shared), then build on it.
2. Take a hash baseline of all cars at HEAD (README "Proving a refactor").
3. Make the generator changes:
   - 6.2 `'split'` (spec.ts, body.ts `tailgateOwner`, `pivotOf`, kit.ts `shellMotion` /
     `PART_LABELS`, audio/cabinopenness.ts);
   - 6.3 `CabinColumn.only` (spec.ts, body.ts `stripOwner`, interior.ts `sidePanels`);
   - 6.4 platform `'van'` and `LAYOUTS.van`, with `floorRise`, `frontHumps`,
     `engineCover` and the shelf skip (interior.ts `layoutOf`, `cabinFloor`, `humps`,
     `Cabin` constructor, `build`);
   - 6.5 bay.ts `buildBay` van branch and `clearance`.

   Typecheck with `nice -n 10 npx tsc --noEmit -p .`. Hashes must match for every
   existing car.
4. Write `src/carkit/uazvans.ts` with `BODY_UAZ2206` / `LOOK_UAZ2206` from §5 and its
   tags as comments. Register `uaz2206` in `KIT_SPECS` (specs.ts).
5. In vehicle/carmodels.ts:
   - `FACTORY_GEOMETRY.kit_uaz2206 = { length: 4.380, width: 1.940, height: 2.101, clearance: 0.220, wheelbase: 2.300, frontTrack: 1.445, rearTrack: 1.445, wheelRadius: 0.372, tyreWidth: 0.225, frontOverhang: 0.993 }`,
     with the source comment (§1). The roof built to 2.08 is scaled 1 % to the
     passport's figure over the vent.
   - `GEAR_UAZ_2206` (§4) and
     `['kit_uaz2206', 'sa_uaz330364', 'uaz2206', 'UAZ-2206', GEAR_UAZ_2206]` in
     `KIT_CARS`.
6. Fit row: copy `kit_gaz24`'s row with the bun one-liner (README step 5), then run
   `nice -n 15 ~/.bun/bin/bun tools/fit-models.ts kit_uaz2206`.
7. Lab (Vite on 5199, one tab):
   - overlay the side on `uaz452_dwg-2206-manual.png` (the drawing ×4.656 horizontal,
     ×4.77 vertical; aft of the rear axle check against the EMS photo);
   - both rear leaves, the side door on the right only, the front doors over the arch;
   - draft screenshots to Main. No docs or commit until the owner accepts.
8. On acceptance:
   - the z-fight gate `nice -n 15 npx tsx tools/kit-zfight.ts`;
   - shader programs;
   - triangles (the 2206 should land at about 12–14k: a long greenhouse of many strips);
   - README, STATUS, HISTORY, CHANGELOG.

### 8. Gaps

- The front door's lower front edge is put at the cowl, 0.40. Drawn it is 0.36–0.39 and
  the pillar line 0.456 → 0.689: the kit cannot put a door below the belt ahead of the
  first column. The windscreen's top is straight across in plan at the column's top
  (0.60), where the drawing has 0.466 on the centre line and 0.689 at the pillar: the
  kit has no plan curve at the screen's top.
- The front door glass is a horizontal two-pane slider on the car; `drop` keeps the
  kit's pane and crank. The side windows are sliders too (`fixed`).
- The rear corner window is glazed on the drawing and blank on four photographed cars
  (the owner's rear view among them). The photos are followed.
- The rear hinges are all on the leaves (straps and knuckles); the body's half of each
  hinge beyond the shut line is not built.
- The rear arch is a half ellipse at 0.76 r. The real one has a flat top and steep sides,
  0.40 ahead of the hub and 0.31 behind it.
- Interior heights are [E] (one dash photo, no section).
- The two-tone paint (white roof and greenhouse) of many 2206s is not modelled: one paint
  slot.
- Only one fuel flap (the right). The car has one each side.
