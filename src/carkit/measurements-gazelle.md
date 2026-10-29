# GAZelle GAZ-3302 / GAZ-32213 (first generation, early face): measurements

Spec: `src/carkit/gazelle.ts` (`BODY_GAZ3302`, `BODY_GAZ3221`, `LOOK_GAZ3302`,
`LOOK_GAZ3221`), cabins `CABIN_GAZELLE` / `CABIN_GAZ3221` in interior.ts, platform `truck`
(truck.ts, generic chassis, platform and tent). Refs: `refs/gaz3302.json`, `refs/gaz3221.json`.
Tags: **[D]** drawing, **[D96]** the 1996 four-view, **[P]** photo, **[F]** factory, **[E]** estimate.
Draft stage: built and checked, not yet seen by the owner.

## 1. What the car is

The first GAZelle (1994-2002/03 before the "GAZelle-2003" face): a semi-forward-control
cab (a short sloping bonnet over the radiator and the engine's front, the engine's rear
under a cover between the front seats; the cab does not tilt) on a ladder frame with beam
axles on leaf springs at both ends. GAZ-3302: the dropside flatbed (series from 13.07.1994),
a steel platform with drop side and tail boards, hoops and a tent. GAZ-3221: the all-metal
minibus on the same cab (series from 03.1996 [F ru.wikipedia]), a sliding door on the
right, two rear doors, eight passenger seats. The kit's minibus (id `gaz3221`, label
GAZ-32213, owner 2026-10-29) is the GAZ-32213: the 13-seat route minibus on the 3221's
body (from 03.1996 [F 5koleso.ru]), two passengers beside the driver and eleven in the
saloon (§9).

## 2. Factory figures [F]

| | GAZ-3302 | GAZ-3221 | source |
|---|---|---|---|
| Length × width × height | 5480 × 2066 × 2120 (cab) | 5470 × 2075 × 2200 | drom.ru catalog/lcv/gaz/gazelle/272196, 272273 |
| Wheelbase, tracks | 2900, 1700 / 1560 | the same | drom.ru; autoopt.ru |
| Overhangs front / rear | 990 / 1580 | 1030 / 1540 | drom.ru |
| Clearance | 170 | 170 | drom.ru |
| Platform inside | 3056 × 1943 × 380 | — | autoopt.ru; drom.ru |
| Kerb / gross | 1850 (1050 front) / 3500 (1200 front) | 2000 (1050 front; drom.ru 2500) / 3500 | autoopt.ru |
| Engine | ZMZ-4026.10: 2445 cc, 100 hp at 4500, 18.6 kgf·m at 2500 (ZMZ-4025.10: 90 hp, A-76) | the same | autoopt.ru |
| Gearbox | five-speed, fully synchronised: 4.05 / 2.34 / 1.395 / 1.0 / 0.849, R 3.51 | the same | autoopt.ru (2004 catalogue too); drom.ru |
| Final drive | hypoid 5.125 | the same | autoopt.ru |
| Tyres, rims | 175R16C (or 185R16C), 5.5J × 16H2 | the same | autoopt.ru; drom.ru |
| Tank, top speed, turning | 70 l, 115 km/h, 5.5 m at the outer wheel | the same | drom.ru; autoopt.ru |
| Brakes, springs | hydraulic, vacuum servo, discs front, drums rear; leaf springs front and rear | the same | autoopt.ru |

The brief asked whether 1994 cars had a four-speed box: every source found (autoopt.ru,
drom.ru, the 3302-1700010 parts listings "5-ти ступенчатая ... с дв. ЗМЗ-4026") gives the
five-speed; a four-speed is only hinted at by a shop's "saves 0.7-1.0 l against a
four-speed" and has no index or ratios in any source. The kit uses the five-speed
(`gearbox_gaz3302_5`). The ZMZ-4026.10's rating equals the registry's ZMZ-402.10
(`engine_zmz_402`: 100 hp at 4500, 182 Nm at 2500), so that engine is reused.

## 3. Sources

- **D** (3302): getoutlines.com 13571 "2006 GAZ-3302 heavy truck", side and front views,
  797 × 244 (`build/carshape/_refs/bp/img/outlines_gaz-3302-2006.png`). Side 10.915 mm/px
  from the 2900 wheelbase between the drawn hubs (x 106 / 371.7, y 209.6); ground y 240.5;
  `s = 1.0 + (x − 106) · 0.010915`. Front 10.69 mm/px from the 1700 front track (tyre
  centres x 605.4 / 764.4), centre x 684.9, ground y 240. The 2003 face.
- **D** (3221): getoutlines.com 13570 "2006 GAZ-3221 bus", the left side, 815 × 233
  (`outlines_gaz-3221-2006.png`): 10.10 mm/px from the wheelbase (hubs x 104.3 / 391.3),
  ground y 228.2, `s = 1.0 + (x − 104.3) · 0.0101`. The 2003 face.
- **D96**: getoutlines.com 13593 "1996 GAZ-3221 Gazelle bus" four-view, 356 × 205
  (`outlines_gaz-gazelle.png`): the early face. Front 22.7 mm/px from the 2200 height
  (roof y 5, ground y 102), centre x 58; right side 23.2 mm/px (hubs x 181 / 306).
  3dcar.ru has no GAZelle (gaz_3302, gaz_3221, gazel, … all 404).
- **P** (Wikimedia Commons, `build/carshape/_refs/photos/gazelle/`): "1995 GAZ 330210
  front.jpg" and "… rear.jpg" (CC0), "GAZ-3302 GAZ museum.jpg" (CC0), "GAZ-3302 (1994 -
  2003) Moscow Н860КО33 20260527 201702.JPG" (CC BY 4.0), "GAZ 3221 Sheki.png" (CC BY 4.0),
  "Маршрутная ГАЗель.JPG" (CC BY-SA 3.0, the right side with the sliding door), "Gazel na
  m10.JPG" (CC BY-SA 3.0), "Kolpashevsky minibus.jpg" (CC BY-SA 3.0); drom.ru's catalogue
  press photos of both (`9384*.jpg`, `9385*.jpg`): steel drop boards, tents grey, olive
  and blue.
- **DASH**: drive2.ru logbook 5107007 (GAZelle 1999), the first cars' instrument
  combination 384.3801 out of its dash (`25107007_418f39cs-960.jpg`, `…705739cs-960.jpg`).

## 4. Readings → spec

Cab (both, `CAB_STATIONS`, `CAB_COLUMNS`, `CAB_GREENHOUSE`):

| Item | Reading | Spec |
|---|---|---|
| Front hub | [F] 990 / 1030 | s 1.0 (one cab for both) |
| Nose: the lid's front edge | [D96 front] 0.86; side 0.905 at s 0.09 | deck 0.88 at s 0.03 |
| Bonnet to the screen | [D] 33° on the late nose, the centre-line screen foot (0.53, 1.325) | deck 0.99 / 1.15 / 1.28 at 0.14 / 0.35 / 0.56, easing 45°→27° [E: kit-surface wants an even ease] |
| A pillar | [D] the black band's front edge at the belt s 0.86, at the rail 1.33; raked 38° | column 0.86 / 1.33 |
| Screen | [D front] glass 1.325-1.87, ±0.76 | screenFoot 0.30, screenTop 0.05, screenBottom 0.04, header 0.05 |
| Door | [D] front edge 0.935, rear 1.955, bottom 0.467-0.49; vent post 1.43 / 1.49; drop glass to 1.885 | columns 0.935-1.955, doorBottom 0.47 |
| Belt, glass top, rail | [D] 1.272, 1.894; [D front] rail 1.92, ±0.84; roof 2.03-2.053 | belt 1.27, glassTop 0.03, rail 1.92, crown 0.09 |
| Widths | [D front] ±0.96 at the belt, ±0.993 at 0.9 | wBelt 0.96, wCrease 0.99, wSill 0.97 |
| Cab bottom | [D] 0.42-0.44 | 0.43 behind the arch (clear of the kingpins' tops) |
| Front arch | [D] 0.45 over the hub, 0.43 ahead, 0.38 behind | arch 1.19, frontArchRise 1.32, shift −0.025 |
| Crease | [D] 1.02-1.04 | featureLine 1.02→1.04 |
| Door handle | [D] s 1.59-1.81 on the crease | 1.60-1.80 at 1.09 [E: over the crease's ridge] |
| Repeater | [D 3302] s 0.75-0.80, 1.0-1.04; [P museum] | repeater |
| Face | [D96] bumper top 0.61; lamps 0.64-0.86; head lamps ±0.43-0.73; grille ±0.40; indicators outboard to the corner [P museum, 1995 front] | moulded black bumper 0.37-0.62 (foot [E]), rectangular lenses, grille with five grey bars |
| Mirrors | [P] big black heads on the door's front corner | mirrorHead 0.08 × 0.12, reach 0.15 [E] |

GAZ-3302 behind the cab: back wall s 2.17 [D x 214]; platform s 2.32-5.48 (outside 3.16
for the 3056 inside [F]; the late drawing's gap to the cab 0.10 [D]), floor 0.88 [D y 160],
boards 0.38 [F], 2.066 over the boards / 1.943 inside [F], beam 0.1 [D]; tent to 2.55 [D:
the dotted outline], lap 0.12 [E], roof edges r 0.12 [E], hoops at 2.6 / 3.5 / 4.4 / 5.25
[E], canvas dark olive-grey 0x4b5043 [P press photos]; tank s 2.35-3.05, 0.35-0.66 on the
left [D], its cap on top [E]; rear lamps on brackets at s 5.32, ±0.8, 0.6 [D s 4.98 y 0.57;
P rear]. Frame rails 0.5 → 0.79 high (top), 150 deep [D y 168; 0.64-0.79], ±0.44 [E].

GAZ-3221 behind the cab: sliding door 2.25-3.40 on the right [D96 right side x 252 / 201],
its window 2.30-3.25; windows 3.48-4.42 and 4.60-5.12 [D: 3.46-4.41, 4.61-5.11] and on
the left 2.30-3.25 [D 2.23-3.19]; tail face 5.37 [D 5.34], rear bumper to 5.47 [F];
rear arch 0.445 over the hub, 0.34 ahead, 0.37 behind [D] (rearArch 1.05, rise 1.31);
the sill 0.46 behind it [D y 186]; roof 2.20 [F; D 2.24] (crown 0.22 over the cab's
rail); filler flap s 2.27-2.43, 0.69-0.83 on the left [D]; tail clusters ±0.81-0.93,
0.84-1.26 [D y 107-147]; rails level at 0.535 under the saloon's floor [E].

## 5. Cabin

The instrument combination [DASH]: tachometer (left) and speedometer (right) side by
side, a column of warning lamps between them, oil pressure over coolant temperature at
the left end, fuel over the voltmeter at the right → six gauges in rows [2, 2, 2], in the
hood before the driver. Everything else [E]: a deep black dash, a two-spoke 0.42 wheel,
the driver's seat and a double passenger seat (both cars since §10; the 3302 had a single
one either side of an engine cover in the cab, ds 0.05-0.60, ±0.22, 0.42 high, with the
engine's cell under it) on a flat floor 0.65; the four service cells under the bonnet.
GAZ-3221: five single seats and a rear bench for three (eight [F]).

## 6. Checks (2026-10-29)

`npm run kit-check -- gaz3302 gaz3221`: both pass (zfight, proportions, reality, mirrors
L100 % R80 %, surface 0 dents, drawing 7/7 and 8/8, dash 3/3). Triangles 10 582 / 11 749.
Lab captures: build/kitcheck/gaz3302/lab-*.png, build/kitcheck/gaz3221/lab-*.png.

## 7. Gaps

- The drawings carry the 2003 face: the early face comes from D96 (23 mm/px) and photos.
- No rear view of the 3302's cab: its back window and the 3302's lamps' cells are
  estimates (the minibus's rear is sourced since §9).
- No step under the doors (the drawn step's plate stood 4 mm under the cab's bottom, a
  far-band z-fight in the generic step; left out rather than moving the ZIL's step code).
- Dash: only the combination is sourced; the dash's shape, wheel and seats are estimates.
- archFront/archRear reaches are not judged in the refs: the body's bottom stands above
  the hub.

## 8. The owner's review of the GAZ-3221 (2026-10-29)

Photos **[O]** of a real early 3221, `build/carshape/_refs/gazelle/`:

| File | What it shows |
|---|---|
| owner-66b01cc7_medium.jpg | front 3/4: the early face (rectangular head lamps, the amber indicator wrapping round the corner, the chrome-framed grille), the big raked screen in a wide black frame, the short sloping bonnet, the high roof rounding over its long edges, three big saloon windows with rounded corners |
| owner-6acc0810_medium.jpg | rear 3/4: the roof's long rounded edges, upright sides with the belt crease, the two rear doors with their windows, the tail lamps upright on the rear pillars |
| owner-6730fa4d.jpg | the saloon from the sliding door: individual high-back seats in blue vinyl on black pedestal frames; nearest the cab a row of three facing rearward; across the door's opening seats facing forward toward them; a black grab pole from floor to roof at the aisle; a black grab rail at the door |
| owner-6abb1fad.jpg | the saloon from the rear doors looking forward: the rearward row of three behind the cab (no partition: the driver's seat seen over it), the next row facing forward (black plastic seat backs: one on the left, two on the right), the rear row of three across the back, the pole at the aisle, the grab rail under the roof over the sliding door |
| owner-6647b199.jpg | the dash and the front row from above: a flat floor between the seats with the gear lever out of it (no engine cover in the cab), the driver's seat (grey cloth) and a double passenger seat (two blue cushions right of the lever); a grey moulded dash with the hooded cluster, a two-spoke wheel |

Built from them (`BODY_GAZ3221`, `LOOK_GAZELLE_BASE`, `CABIN_GAZ3221`):

- Engine access only under the bonnet: no `engine_cover` in the 3221's cab
  (`engineCover: undefined`); its four cells under the bonnet (radiator s 0.10-0.18,
  engine 0.24-0.54 ±0.24, air filter and turbine either side) [E their sizes]. The 3302
  kept its cover (until §10: now both cars' bay, `CHASSIS.bay`).
- Front row: the driver's seat and a double passenger seat (`passengerDouble`: one
  cushion and back 1.6 times as wide, two inlays, its middle at x −0.47). No partition.
- Saloon (`saloon.seats`, ds behind the cowl 0.86): a rearward row of three at s 2.15
  (x 0.6, 0, −0.6); a forward row at s 3.25: one on the left (0.6), two on the right
  (−0.22, −0.64) across the door's opening; the rear row of three at s 4.45; the knee gap
  between the first two rows 0.34 m, the door's opening over it [E the distances, O the
  order and facing]. High backs (0.66 tall) in the upholstery with black plastic rears,
  on black pedestals. Grab pole at s 2.70, x 0.27; grab rail under the roof over the
  sliding door, s 2.36-3.16 [O].
- Sitting: every saloon seat was a `KIT_BENCH_NODE`, so getting in by any seat on the left
  seated the player as rear-left, on the right as rear-right, with one eye over the second
  row's left seat and its mirror (until §10: now every seat its own, with its own eye).
- Shape: the A pillar strip black (the screen's black frame) [O]; the high roof's sides
  rising 0.24 over the drip rail and rounding over (railInset 0.12, railBend) into a
  near-flat top (crown 0.05, power 4) [O, F 2200].
- Front lamps (both GAZelles, owner 2026-10-29): the head lamp and indicator one flush
  `cornerLamps` unit, head from ±0.43, amber from ±0.745 round the corner onto the wing to
  s 0.09, 0.65-0.84 [O, D96]; they stood out as boxes before. The 3302 changed only there.

Checks: `npm run kit-check -- gaz3221` passes (12 470 triangles). Comparison sheets
(owner's photo | lab): build/kitcheck/gaz3221/compare-{front34,rear34,interior-door,
interior-rear,driver}.png; lamps: build/kitcheck/{gaz3221,gaz3302}/lab-lamps.png.

Gaps (closed in §9): the side windows' rounded corners; the roof's step over the screen
was the rail chamfer's rise; the lab captures were framed far. The saloon of this round
(nine seats) was superseded by the 13-seat GAZ-32213 in §9.

## 9. Third round: the 1996 GAZ-32213 (2026-10-29)

The owner: the car is the GAZ-32213, the first-series 13-seat route minibus (1996), not
the 8-seat 3221; label GAZ-32213 (the id stays `gaz3221`: saves, fit rows, refs).

### 9.1 Sources found (all in `build/carshape/_refs/gazelle/`, gitignored)

| File | URL | Licence / owner | What it shows |
|---|---|---|---|
| owner-seat-plan-322132.png | the owner (factory plan) | the owner | **the 13-seat plan from above** (ГАЗ-322132): the seat layout of §9.3 |
| src-bp-theblueprints-3221.png (782 × 939) | the-blueprints.com/blueprints/cars/gaz/83479/view/gaz-3221_gazelle/ | the-blueprints.com (Dr Dan Saranga), a factory-manual scan | **[DM]** early-face side elevation and plan, dimensioned: 5500, 2900, 990 / 1610 overhangs, 2200 high, 2075 wide, 1336 between seat rows, 22° / 18°; hand-drawn (its 990 / 2900 / 1610 spans disagree by up to 15 %) |
| src-bp-theblueprints-32213-preview.jpg (1280 × 890) | the-blueprints.com/vectordrawings/show/30705/gaz_-_32213_gazelle/ | the-blueprints.com watermarked preview (the vector is paid) | **[D32]** the 32213's four-view: side (6.64 mm/px from the drawn 2900 hubs x 175 / 612, `s = 1.0 + (x − 175) · 0.006636`), top, front, rear |
| src-mtmuseum-32213-0…4.jpg | mtmuseum.ru/exhibits/gaz-32213-gazel/ | Moscow Transport Museum (GAZ brochure scans) | the factory brochure: four saloon plans (8, 10, 11, 13 seats), a side elevation; the museum's white 1999 32213; press shots |
| src-drom-g1996-938520…938526.jpg | drom.ru/catalog/lcv/gaz/gazelle/g_1996_10804/ | drom.ru (GAZ press photos) | factory press shots of the early-face minibuses, front 3/4 |
| src-dromad-267151758-00…08.jpg | auto.drom.ru/…/gaz/32213/bus/micro/267151758.html | drom.ru sale ad (seller) | **a 1998 GAZ-32213, early face**: straight front, near-straight right side, rear 3/4 with the rear doors, the saloon (seats out), the cab's double seat, the 1998 dash |
| src-dromad-941182264-00…04.jpg | auto.drom.ru/…/gaz/32213/bus/micro/941182264.html | drom.ru sale ad (seller) | a late-face 32213 on the same body: **straight rear** (the rear doors, their panes, hinges, handle), straight left side, saloon looking rearward |
| src-dromad-434630052-00…06.jpg | auto.drom.ru/…/gaz/32213/bus/micro/434630052.html | drom.ru sale ad (seller) | late face, same body: rear 3/4 (the rear doors), the saloon's seats and rails |
| src-drive2-1036288-*.jpg | drive2.ru/l/1036288/ | drive2 owner | the early "old-type" dash out of the car and in place (1998) |
| src-drive2-1265725-00.jpg, src-drive2-288230376151983608-00.jpg | drive2.ru | drive2 owners | 1996 white minibuses, front 3/4 and rear 3/4 |
| src-commons-moscowbus16515…358 / …359.jpg | commons.wikimedia.org File:Moscow_bus_16515_2010-03_… | CC BY 4.0, Artyom Svetlov | early-face route bus, the right side near side-on (the sliding door) |
| src-commons-mytischimoscowregionpanoramio2-38.jpg | commons File:Mytischi_Moscow_Region_-_panoramio_(2).jpg | CC BY 3.0, Alexey Seleznev | early face, the left side near straight, a rear door open |
| src-commons-gazellevanfromthebackdniproukr-458.jpg | commons File:Gazelle_van_from_the_back;_Dnipro… | CC BY-SA 4.0, VKras | the rear doors, 3/4 |
| src-commons-moscowbus16521…, -3221jpg-273, -gaz32211jpg, -gazelnam11jpg, -marshrutkajpg, -jpg-476, -funnybusjpg-830, -vaninasinorussiajpg, -gazgazeltaxi…-371, -moscowbus2026…, -gaz22171sobol…, -gazel3221jpg, -rainbowzelenograd, -pnautobuspresent2000{1,2}, -gazelleinmedvezhyegorsk | commons (each file's page) | CC BY 4.0 / CC BY-SA 3.0–4.0 / CC BY 2.0 / public domain (per file, local://gazelle-sources.md of this round) | early-face minibuses, mostly front 3/4; colour, trim, the face |

Factory figures found: 5470 × 2075 × 2200, 2900 [F drom.ru 272259, the 1999-2002 32213];
[DM] 5500, 990 / 1610; glass (fkrit.ru/stekla-na-gazel, "ГАЗ 3221"): windscreen 1655 ×
910 (avtomaxi.pro), saloon side panes 1258 / 1245 × 675 (front, left / right), 1245 × 675
(the sliding door's), 1194 × 675 (middle), 1265 × 675 (rear), **the rear doors' panes 821
× 660**; no corner radii anywhere. The 13 seats: two beside the driver and eleven in the
saloon [F truck.ironhorse.ru, autort.ru, mtmuseum.ru]; series from 03.1996 [F 5koleso.ru].
Nothing found: a larger getoutlines rendition, any free 32213 vector, Commons interior or
dash photos of the early cars, side-glass corner radii.

### 9.2 Readings → spec

| Item | Reading | Spec (before → now) |
|---|---|---|
| Roof over the cab | [DM] the header 1.97 at s 1.39, 2.11 at 1.57, 2.17 at 1.72; [D32] 1.97 at 1.46, 2.13 at 1.72, 2.19 at 1.85: one long rise from the screen's top to the saloon's roof | the rail's chamfer rising 0.24 over 0.12 right at the screen's top → over 0.555 (`railRun.front`, to the front door glass's end 1.885): 1.97 at 1.33 → 2.21 at 1.885, the headliner following |
| Roof height, edge | 2200 [F]; the long edges rounded [O] | unchanged: 2.21, railInset 0.12, railRise 0.24, railBend [0.12, 0.75] |
| Windscreen | [F] glass 1655 × 910; [D] 1.325-1.87, ±0.76; the black frame [O] | unchanged (the kit's glass ±0.76 × 0.95 along the centre line, 0.67 at the corners) |
| Side windows | [D32 left] 2.32-3.32 (split by the slider), 3.455-4.46, 4.60-5.15; [DM] 2.18-3.24, 3.42-4.43, 4.55-5.07, glass 1.32-1.90; [D 2006] 2.23-3.19, 3.46-4.41, 4.61-5.11; corners rounded about a sixth of the height [O] | runs unchanged (within 3-7 cm of the three drawings' mean); the panes' corners rounded r 0.08 (`glassRound`), the sliding door's too |
| Rear doors | [P 941182264-01, 3.3 mm/px from the tail lamps' 0.42]: the doors' top 2.12 (the roof 2.25 there), each pane ±0.09-0.72, 1.37-1.95, corners r ≈ 0.1; [F] the pane's glass 821 × 660 | the doors' top 1.93 → 2.12 into the roof's rounding (`railRun.rear` 0.03, the tail upright), panes ±0.06-0.68 × 1.32-1.82 r 0.06 → ±0.09-0.71 × 1.37-1.95 r 0.09 |
| Rear hinges, handle | [P 941182264-01] hinges ±0.74-0.86 at 0.74-0.81 and 1.67-1.75; the handle on the right leaf by its inner edge at 1.22 | hinges ±0.62-0.79 at 0.80-0.87 / 1.62-1.69 → ±0.72-0.81 at 0.74-0.81 / 1.67-1.75 (to the kit's shut line ±0.80); handle 1.05 → 1.22 |
| Sides, belt, crease, bonnet, face | [D32], [DM], [P] | unchanged: they agree with §4 within the drawings' accuracy |

### 9.3 The saloon: 13 seats [owner-seat-plan-322132, the brochure's 13-seat plan, O]

The plan scaled 6.0 mm/px between the rearward row's backs (y 458, the kit's s 2.03) and
the rear doors' inside (y 1004, s 5.30); across, its inner walls (x 122, 436) are 1.88 m
apart at that scale, the kit's ±0.90 [the plan's own body outline gives 5.36 mm/px along
and 5.6 across: it is not to one scale]. Seat hips (ds behind the cowl 0.86; the plan's
seat centres, less the kit seat's 0.125 between its hip and its middle):

| Seats | Plan (px) | s, x (kit) | Facing |
|---|---|---|---|
| Driver, double passenger | — | unchanged (§8) | forward |
| Row 1: three across, left of the door's entry | y 458-572, x 122-196 / 200-275 / 280-355 | s 2.15; x 0.62, 0.15, −0.32 (was 0.6, 0, −0.6) | rearward, backs to the cab |
| One on the left wall, opposite the door | y 605-680, back x 115-145 | s 3.13; x 0.56 | sideways, facing the aisle |
| Row 2: one left, a pair right | y 708-835 | s 4.05; x 0.63 / −0.21, −0.66 (was s 3.25) | forward |
| Two on each wall at the back | y 845-920, 922-1000 | s 4.57, 5.04; x ±0.56 | sideways, facing the aisle |

2 + 3 + 1 + 3 + 4 = 13 passengers. The sideways seats are `facing: 0` (new): the seat
turned a quarter, its back to its wall. Their hips stand at ±0.56, not the plan's ±0.64,
so the reclined backs' tops stay inside the greenhouse's tumblehome: at ±0.64 they stood
3 cm out through the glass. The grab pole moved to the forward left seat's
front-right corner, s 3.62, x 0.30 [O owner-6730fa4d]; the grab rail over the door
unchanged. The rear passengers' eye over row 2's left seat. Getting in: every left seat →
rear-left, every right seat → rear-right (unchanged). No partition: the factory plan has
none (the brochure's other 13-seat variant has a low one) and the owner's photos show the
driver's seat over the rearward row.

### 9.4 Also changed

The grille (the 32213 only): a chrome frame and five chrome dividers 3 cm proud, i.e.
two rows of six cells [O]. The shared grille's 15 mm bars sit inside its dark back and are
never built; the GAZ-3302 keeps that grille.

### 9.5 Checks and captures

`npm run kit-check -- gaz3221`: pass (zfight, proportions, reality, mirrors L100 % R80 %,
0 dents, 13 111 triangles, drawing 8/8, dash 3/3). Fingerprints: the other 30 cars read
identical (zil130 and gaz3302 against temporary records taken before this round).
Close-ups: build/kitcheck/gaz3221/close-{front34,rear34,side,side-left,front,rear,
windows,interior-door,interior-rear,driver}.png. Sheets (source | lab): compare-{front34,
rear34,side,side-left,side-drawing,front,rear,windows,interior-door,interior-rear,driver,
seatplan}.png.

What still differs on the sheets: the real roof's long edges and rear corners are
rounder (the kit's two chamfer facets); the grille's dividers hardly show at 3/4 in
daylight; the bumpers are black, as on the 1996 press cars (the owner's car has grey
ones); the rear doors stop at the kit's shut line ±0.80 (the real one is ±0.83), so the
hinges are narrower; the slider's divider in the left front saloon window, the screen's
wide black rubber, the low cab partition of the brochure's other 13-seat variant and the
blue vinyl and floor tread are not drawn; the first saloon window's front edge stands 6 cm
behind the drawings' mean.

## 10. Engine under the bonnet, the driver's eye, every seat sat in (2026-10-29)

The owner: the flatbed shows no engine in its open bonnet (the minibus does); the
driver's eye sits too high in both; of the many seats only a few can be sat in.

### 10.1 The flatbed's engine

Cause: the 3302 kept the first draft's bay, its engine cell at s 0.98-1.40 behind the
cowl (0.86), 0.62-0.98 high, inside the cab's engine cover. The open bonnet showed the
radiator, the filter and the turbine's cells; the engine was drawn inside the shut cover
in the cab, seen only with the cover lifted from an open door. Fix: the minibus's
under-bonnet cells are the chassis' (`CHASSIS.bay`: radiator s 0.10-0.18, engine
0.24-0.54 ±0.24 0.50-0.98, filter and turbine either side 0.26-0.50, all under the shut
bonnet's skin), and the cover left the cab (`CABIN_GAZELLE`: the owner's photo of the
same cab, owner-6647b199, shows a flat floor between the seats). The 3302 takes the
minibus's double passenger seat with it (`passengerDouble`), the real cab's [§7 had it as
a gap]. The gearbox and exhaust follow the engine's rear (truck.ts), as on the minibus.

### 10.2 The driver's eye

| | Reading | Source |
|---|---|---|
| Belt (side glass's foot) | 1.27 | [D side 1.272] |
| Cab floor | 0.65 | [E, unchanged; DM: the saloon's sill at the sliding door 0.55] |
| Driver's cushion pad | 0.18 thick (0.56 × 0.52) | [F parts: gazelist52.ru, progress-nn.ru «подушка сиденья водителя 3302»] |
| Cushion top | 0.27-0.30 under the belt, 0.97-1.05 over the ground | [P dromad-267151758-06, the cab from the sliding door: the driver's door 1.27 → its floor over ~270 px; the nearer cushion projected low, corrected up] |
| Seated eye over the cushion | 0.74 (`SEATED_EYE`, every kit car; built 0.62-0.755) | [E anthropometry, unchanged] |

Built before: cushion 0.36 over the floor (the truck layout's, the ZIL's bench), top 1.01;
eye 1.75 over the ground at the hip (s 1.66), 0.48 over the belt. Against every other kit
car the GAZelle's eye stood highest over its belt (cars 0.25-0.35, ZIL 0.345, UAZ-2206
0.40) and highest over its wheel: 0.40 over the hub and only 0.30 behind it, the hub 53°
under the eye and the speedometer 48° (the cars' 27-44° and 18-34°): both under the
straight-ahead 85° view's lower edge (42.5°). The rim stood 0.15 m before the hip; the
eye looked over the wheel at the dash's top.

Now (`CABIN_GAZELLE`): the cushion 0.30 over the floor (the 0.18 pad on a 0.12 frame
[E]), its top 0.95, 0.32 under the belt (the photo's 0.27-0.30 within its error); the eye
0.74 over it and over the backrest's lean (`eyeForward: 0`, the eye 0.10 behind the hip:
not 10 cm forward as on the cars, `DRIVER_EYE_FORWARD`, whose wheels stand 0.35-0.49
before the hip): 1.69 over the ground at s 1.76, 0.42 over the belt, 0.40 behind and 0.34
over the hub (40° down; the ZIL 0.41 / 0.28, the classics 0.40 / 0.32), the speedometer
39° under the eye, through the wheel. The headliner 0.30 over it (the minibus's raised
roof 0.44), the header and visors as before (kit-mirrors from the eye: L100 % R85 %, was
R80 %). The passenger's and the middle's eyes at the same height and distance over their
places (x −0.66, −0.28).

### 10.3 Every seat sat in

The seats are the cabin's own (interior.ts `seatPlan`, specs.ts `kitSeats`): the driver,
the double seat's two places (passenger x −0.66, middle −0.28), and on the minibus all
eleven saloon seats, each with its own eye at the saloon's cushion (0.45 over the floor)
plus `SEATED_EYE`, 0.10 back from the hip with its backrest (towards the wall on the wall
seats) and facing the seat's way: the rearward row looks back (π), the wall seats across
the aisle (±π/2). Ids: seat 4 (forward left) is the car's `rear-left`, seat 6 (forward
right by the wall, nearest its mirror) `rear-right`, the rest `rear-left:<i>` /
`rear-right:<i>` by side. Through the sliding door the player sits in the seat looked at,
or the saloon seat nearest the door; the saloon is left by the sliding door.
