# GAZelle GAZ-3302 / GAZ-3221 (first generation, early face): measurements

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
right, two rear doors, eight passenger seats.

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
two front seats ±0.52 (the real passenger seat is a double: see Gaps) either side of the
engine cover (ds 0.05-0.60, ±0.22, 0.42 high) with the four service cells under it and
under the bonnet; floor 0.65. GAZ-3221: five single seats and a rear bench for three
(eight [F]).

## 6. Checks (2026-10-29)

`npm run kit-check -- gaz3302 gaz3221`: both pass (zfight, proportions, reality, mirrors
L100 % R80 %, surface 0 dents, drawing 7/7 and 8/8, dash 3/3). Triangles 10 582 / 11 749.
Lab captures: build/kitcheck/gaz3302/lab-*.png, build/kitcheck/gaz3221/lab-*.png.

## 7. Gaps

- The drawings carry the 2003 face: the early face comes from D96 (23 mm/px) and photos.
- No rear view of the 3221 or of the 3302's cab: the rear doors' glass, hinges, handle,
  the tail clusters' cells and the cab's back window are estimates.
- The front passenger seat is a double on the real cab (three places): the kit draws one
  seat (the generator's front seat is single).
- No step under the doors (the drawn step's plate stood 4 mm under the cab's bottom, a
  far-band z-fight in the generic step; left out rather than moving the ZIL's step code).
- The 3221's roof over the screen rounds up at the screen's top instead of the long rise
  of the drawing over the cab.
- Dash: only the combination is sourced; the dash's shape, wheel and seats are estimates.
- archFront/archRear reaches are not judged in the refs: the body's bottom stands above
  the hub.
