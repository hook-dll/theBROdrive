# Mercedes-Benz W124 saloon: sources, figures, feature inventory

Status: **first draft 2026-10-27, reworked the same day after the owner's first review (§8),
awaiting his next look** (README "Workflow" step 2). The owner reviewed §4 and §5; the
missing fields he asked for were built first (§7), then the car (`mercedes.ts`, §7). Review
sheet `build/kitcheck/w124/review.png`, drawing overlays
`build/kitcheck/w124/drawing-side.png`, `drawing-front.png`.

Tags: **[D]** drawing, **[P]** photo, **[F]** factory/catalogue, **[E]** estimate.

## 1. The version built

**230 E saloon (W 124 E 23, type 124.023), first facelift, 09.1989–10.1992**, petrol M 102,
five-speed manual (the optional box; see below). Why:

- The first facelift (09.1989) is the W124 most seen on Russian roads around 2000: the cars
  came in as used imports 8–12 years old, so built 1988–1992. The second facelift
  (08.1993, the E-Class with the grille pressed into the bonnet and clear indicators) was
  built for two years only and would have been 5–7 years old then, expensive. The
  pre-1989 car lacks the side cladding the owner's "W124" picture has in it [E: no
  registration statistics found; reasoning from build years and import age].
- The 230 E is the volume petrol four of that span: **374 422 built** 09.1989–10.1992
  (W124 guide, sites.google.com/view/mercedesbenzw124, "230E (1989-1992)").
- What the 1989 facelift changed on the outside (en.wikipedia "Mercedes-Benz W124", "1989:
  First facelift"): **plastic side panels ("Sacco boards") along the lower flanks, their top
  edge a bright strip that continues across the front and rear bumpers**, bright door
  handles and hub caps, body-colour mirrors. These are the features §4 is built round.
- Gearbox: the four-speed manual is standard and the five-speed and the automatic are options
  (MB archive). The five-speed is proposed for the game [E: the drive the brief's other
  cars have; no Russian-market figure found]. All three are recorded below.

## 2. Factory figures

| Figure | Value | Source |
|---|---|---|
| L × W × H | **4740 × 1740 × 1428** | MB archive (mercedes-benz-publicarchive.com marsClassic, "230 E" oid 5294, 1989–1992); W124 guide; auto-data.net "W124 (facelift 1989) 230 E (132 Hp)". Height 1430 avtomarket.ru, 1431 njcar.ru / carspecsdata. The drawing's dimension lines: 4755 / 1430 |
| Wheelbase | **2800** | MB archive, auto-data; drawing 2799 |
| Tracks | **1501 / 1491** (Sportline 1518 / 1509) | MB archive, auto-data |
| Clearance | **150** | drom.ru catalogue "230 E AT Base (09.1989–10.1992)"; njcar.ru prints 163 |
| Tyre, rim | **195/65 R15 91H** on 6½J × 15 steel with hub caps (Sportline 205/60 R15 on 7J alloy) | MB archive. Free radius 0.317 m [computed: 190.5 + 126.75 mm] |
| Kerb / gross mass | **1360 / 1880 kg** (gross 1930 from 02.1992) | MB archive, W124 guide |
| Engine | **M 102 E 23 (102.982)**, 2298 cm³, 95.5 × 80.2, SOHC 8v, KE-Jetronic, catalyst: **97 kW (132 hp) at 5100, 198 Nm at 3500**, CR 9.0 | MB archive |
| Gearbox, 5-speed manual (option) | 3.91 / 2.17 / 1.37 / 1.00 / 0.81, R 4.27; final drive **3.46**; 200 km/h, **0–100 11.1 s** | MB archive |
| Gearbox, 4-speed manual (standard) | 3.91 / 2.17 / 1.37 / 1.00, R 3.78; final drive 3.27; 200 km/h, 11.3 s | MB archive |
| Automatic (option) | 4.25 / 2.41 / 1.49 / 1.00, R 5.67; final drive 3.27; 195 km/h, 11.2 s | MB archive |
| Top speed | **200 km/h** (manual) | MB archive |
| Turning circle | **11.2 m** | encycarpedia "230 E (1985–1989)", avtomarket.ru (1989–1993), carspecsdata; drom.ru "radius 5.6" |
| Tank | **70 l**, above the rear axle | MB archive |
| Cd | **0.29** [E for the 230 E] | en.wikipedia gives **0.28 for the 200 / 200 D on 185/65 R15** (European market); no 230 E figure found; autoevolution prints 0.30 for the 1993 300 D |
| Drive, suspension | rear drive, divided prop shaft; front A-arm and strut, rear multilink; discs all round, front ventilated, ABS; **foot-operated parking brake**; recirculating-ball power steering | MB archive |

## 3. Sources

### Drawings (build/carshape/_refs/bp/img/)

| File | Source | Use |
|---|---|---|
| `w124_tbp_3490.jpg` [D] | the-blueprints.com vector drawing 3490 "Mercedes-Benz E-Class W124", watermarked preview `https://www.the-blueprints.com/modules/vectordrawings/preview-wm/1990_mercedes-benz_e-class_w124.jpg` (1280 × 905; titled "Model 124 (1992)") | **Main drawing.** Side view facing left (cladding line on the doors: a 1989–93 car) and plan. No front or rear view. Dimension lines 2799, 4755, 1430 |
| `w124_tbp_6190.gif` [D2] | the-blueprints.com raster blueprint 6190 "Mercedes-Benz E-Class W124" (`.../blueprints-depot/cars/mercedes/mercedes-benz-e-class-w124.gif`, 711 × 347) | Four views incl. **front and rear**, interior dimensions (975 / 958 headroom, 1440 / 1420 / 1416 shoulder and elbow widths). Coarse: about **10.0 mm/px** (side view x 9–483 = 474 px for 4740 [E]) |

Licence: the-blueprints.com previews, reference use only (as the Vectra's).

**Scale of `w124_tbp_3490.jpg`** (pixel rows read by script):

| Basis | Pixels | Scale |
|---|---|---|
| Wheelbase dimension line (2799) | x 169–649 = 480 | 5.831 mm/px |
| Overall length line (4755) | x 24–843 = 819 | 5.806 mm/px |
| Height line (1430) | y 85–330 = 245 | 5.837 mm/px |
| Drawn hubs (tyre chords' centres at y 315 / 325) | x 163.5 / 649 = 485.5 | 5.767 mm/px for 2800 |

The drawn hubs stand 485.5 px apart, 5.5 px more than the wheelbase line's ticks (the front
tick is 5.5 px behind the front hub). Proposed: **5.806 mm/px** along (the overall length),
`s = (x − 24) × 0.005806`, giving hubs at s 0.81 / 3.63 (2.82 apart, 20 mm long [E]); up
5.837 mm/px from the ground y 330. To be settled at the measuring step against the photos.

### Photos (build/carshape/_refs/photos/w124/, Wikimedia Commons; also in `SOURCES.txt` there)

| Tag | File | Commons title | Licence, author | Version, what it shows |
|---|---|---|---|---|
| **F34** | `front34.jpg` | 1990-1993 Mercedes-Benz 230 E (W124) sedan 01.jpg | Public domain, OSX | **1989–93**, white, front right 3/4: grille shell, lamps, two-tone bumper with its strip, cladding strip, mirror, handles |
| **R34** | `rear34.jpg` | 1990-1993 Mercedes-Benz 230 E (W124) sedan 03.jpg | Public domain, OSX | **1989–93**, white, rear right 3/4: tail lamps, lid between them, plate, badges, flap (right), rear door's quarter glass |
| **F34r** | `front34_red.jpg` | 1991 Mercedes-Benz 230E Automatic 2.3 Front.jpg | CC BY-SA 4.0, Vauxford | **1991**, red, front left 3/4: the same face; cladding in body colour with its strip |
| **R34r** | `rear34_red.jpg` | 1991 Mercedes-Benz 230E Automatic 2.3 Rear.jpg | CC BY-SA 4.0, Vauxford | **1991**, red, rear left 3/4: tail, cladding along the left flank |
| **S** | `side.jpg` | Mercedes Benz E 260 (side).jpg | CC BY-SA 4.0, Fiver, der Hellseher | near-orthographic left side, **pre-1989** car (no cladding): greenhouse, shut lines, pillars, tail-lamp wrap |
| **S2** | `side2.jpg` | Mercedes Benz E 260 (side) (2).jpg | CC BY-SA 4.0, Fiver, der Hellseher | the same car, right side, slight 3/4 |
| **F** | `front.jpg` | Mercedes Benz E 260 (front).jpg | CC BY-SA 4.0, Fiver, der Hellseher | the same car, front, oblique (no fully straight free photo found) |
| **R** | `rear.jpg` | Mercedes Benz E 260 (rear).jpg | CC BY-SA 4.0, Fiver, der Hellseher | the same car, **near-straight rear**: lamps, lid, plate, bumper |
| **DASH** | `dash.jpg` | Mercedes 200E (W124) cockpit.jpg | CC BY-SA 3.0, Christian "VisualBeo" Horvat (de.wikipedia) | dashboard from behind the driver's seat, manual box |
| **INT** | `interior.jpg` | Mercedes-benz-230E-Interieur.JPG | CC BY-SA 4.0, VonNortheim | both doors open: door cards, seats, head restraints, dash from the side |

The E 260 set (S, S2, F, R) is a pre-1989 car: shell, greenhouse, lamps, grille and the lid
are the same stampings as the 1989–93 car; it has no cladding and its handles differ. It is
used for the shapes only, the 1989–93 trim from F34 / R34 / F34r / R34r.

## 4. Feature inventory

"Field" is the spec.ts field that draws the feature today (with how), or **NO FIELD** with the
simplest addition that would. Colour: body = paint.

### 4.1 Body shape and greenhouse

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 1 | Long low bonnet, nearly flat, slightly wedged down to the nose; the nose face upright with a small rake | S, F34, D | body | `stations` (`deck`), `bonnetFront`; rake `frontLean` if wanted |
| 2 | Bonnet shut lines along the wings' tops (not at the pillar row), bonnet cut round the grille shell | F34, F34r | body | `bonnet: { inset }` (the 2110's) for the side cuts; the cut round the shell comes from the grille item standing in the face (see #20) |
| 3 | Square three-box saloon: boot deck high and level, short tail, a slight kick (ducktail lip) at the lid's trailing edge | S, R34, D | body | `stations` (`deck`) for the deck; the lip: a station step in `deck` at the tail |
| 4 | Body side flat with one soft crease at about the lamps' height, tumble-home above the belt | F, R, D2 | body | `stations` (`crease`, `wCrease`, `belt`, `wBelt`), `shoulder` |
| 5 | Wheel arches round, cut close to the tyre, front and rear alike | S, D | body | `wheels.arch`, `rearArch` |
| 6 | Sill line straight, low; the door bottoms just over it | S, D | body (black under the cladding on 1989–93) | `stations.sill`, `doorBottom` |
| 7 | Windscreen strongly raked, curved in plan, thin A pillars | S, F34 | body pillars, black screen seal | `columns[0]` (s / top), `screenFoot`, `screenBottom`, `screenHeader`, `pillar` |
| 8 | Roof long and flat, its rail with a thin rain channel; the roof's front and rear rounding into the screens | S, R34 | body | `rail`, `railHalf`, `crown`, `railInset/Rise`, `railBend`, `roofDrop` |
| 9 | Back light raked, curved, its foot on the deck | S, R | black seal | last column, `rearBottom`, `rearHeader` |
| 10 | Four doors, front door frame with its glass running right up to the A pillar (no quarter light) | S, F34 | body frames | `columns` with `upper/lower: 'door1'`, `glass: 'drop'` |
| 11 | **B pillar body colour** (painted, slim), the glass framed by thin dark seals | S, F34, R34 | body | `columns` (B pillar strip owner `'body'`, no `finish`) |
| 12 | Rear door carries a **fixed quarter glass** behind a thin vertical division bar; the door's frame runs round it to the C pillar | S, R34 | dark division bar, body frame | `columns`: a `drop` strip, a narrow column for the bar, a `fixed` strip, all `upper: 'door2'` (the Vectra's quarter on its door). The bar dark: `finish: 'black'` on that one narrow column |
| 13 | **C pillar body colour**, wide, parallel to the back light | S, R34 | body | last columns, `upper: 'body'` |
| 14 | Rear door's shut line running down and forward round the rear arch | S, D | body | `CabinColumn.foot` (`y`, `s`, `round`) |
| 15 | Window seals / glass surrounds: thin black rubber round every glass, no chrome | F34, R34, S | black (rubber) | NO FIELD as such; the glass edge reads dark already [E]. Not needed |
| 16 | Boot lid from the back light's foot down between the tail lamps to the bumper's top, the plate on it | R, R34 | body | `bootEnd`, tail station `notch` (the lid comes down between the lamp corners, as the 2141 / 2115), plate items on `FaceLook.lid` |
| 17 | The lid's sides between the lamps **lean**: the lamps' inner edges run down and in, the lid wider at its top than at the bumper | R | body | NO FIELD (the notch cut is upright; the Nexia note "the lamps' inner edges lean"). Simplest: upright cut, accepted on the Nexia; or `notch` given as `[bottom, top]` half widths |
| 18 | Fuel flap: rectangular with a rounded corner on the **right** rear wing, behind the rear door, at the belt | R34 | body | `flap` (`side` absent = right) |
| 19 | Underbody plastic undertray (the low Cd) | – | black | not seen; not needed |

### 4.2 Front

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 20 | **Grille: a chrome shell standing proud of the face** (about its own depth out of the face, the bonnet's lip cut round it), upright, nearly square (a little narrower than tall), slightly rounded top corners | F34, F34r, F, D2 | chrome frame | `grille` with `standOut` (the 2107's, ~0.03) and `frame: { finish: 'chrome', margin }` |
| 21 | Grille infill: **horizontal chrome slats** (about 7–8) and **one vertical chrome bar** down the middle | F34, F34r | chrome on black back | `grille.bars` `dir: 'horizontal'`, `back: true`; the centre bar: a centred chrome `panel` (`x: { centre: 0.008 }`, `proud`) drawn after the grille |
| 22 | **Three-pointed star standing on the bonnet's front edge**, over the grille shell | F34, F34r, F | chrome | NO FIELD. Simplest: a centred upright chrome ring-and-star as one flat plate (a thin disc, 0.06 across) on a short stem at the bonnet's front, riding on the bonnet. A `FaceLook.lid` item does not reach (it is on the face, not on top) |
| 23 | Flat chrome star badge on the grille's top bar | F34 | chrome | not needed (the standing star reads it) |
| 24 | **Head lamps: wide rectangular units with one flat glass**, from the grille shell's side out to the corner; inside, a big main reflector and a smaller round dipped / fog reflector, the **amber indicator the outer quarter of the same glass**, wrapping a little round the corner onto the wing | F34, F34r, F | glass, amber | Main lamp: `lens` (`role: 'head'`) or a `cornerLamps` unit: `head` from the grille's side, `blinker` from about ±0.69 round the corner to s ≈ 0.1 (the Espero's). The inner reflector split not drawn [E: not needed] |
| 25 | Head lamp's foot level with the bumper's top, its top under the bonnet's lip | F34 | – | heights in `FaceY` (`bumperTop`, `deck`) |
| 26 | Thin body-colour face between lamp tops and bonnet lip (the bonnet's leading edge overhangs a little) | F34 | body | `stations` / `deck` |
| 27 | **Front bumper, two-tone**: upper part body colour, **lower part dark grey / black** (about half its height), the **bright strip on the line between** | F34, F34r | body over black, chrome line | `moulded` `finish: 'paint'` with `moulding: { y, height, finish: 'black' }` for the black half. The bright strip: **NO FIELD** (see §5 #1) |
| 28 | Bumper's sides wrap round to the front wheel arch, flush with the cladding behind it | F34, F34r | as #27 | `moulded` `wrapTo` (to the arch), `corner` |
| 29 | Front plate on the bumper's upper part under the grille | F34, F34r | – | NO FIELD (plates not modelled on any kit car; the owner: not needed on the Espero) |
| 30 | Fog lamps: none on the base car; a towing-eye cover in the bumper | F34 | – | not needed |
| 31 | No side repeater on the wing (1989–93; the indicator wraps instead) | F34, F34r | – | `repeater: null` |
| 32 | Headlamp washers / wipers: optional, not on the photographed cars | – | – | not needed |

### 4.3 Side

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 33 | **Side cladding ("Sacco boards")**: plastic panels on the lower flanks from the front arch to the rear arch (on the wings and both doors), standing a few mm proud, body colour on most cars (contrasting grey on some) | F34, F34r, R34, R34r, D | body (or grey) | NO FIELD for the panel itself. The `waist` is one thin strip. Simplest: a `cladding?: { top: number; finish: Finish; proud?: number }` flank band from the sill up to `top`, broken at shut lines and arches as the waist is. On body-colour cars the step alone reads; the panel can be skipped there and only #34 drawn |
| 34 | **Bright strip along the cladding's top edge**, one line nose to tail at bumper-strip height, continuing the bumpers' strip (#27, #45) | F34, F34r, R34 | chrome | `waist: { y, height ≈ 0.008, finish: 'chrome' }` nose to tail (broken at shut lines and arches). Its continuation across the bumpers: NO FIELD (§5 #1) |
| 35 | Door handles: horizontal pull handles, **black with a bright key cylinder / insert** on this car (chrome on others, per Wikipedia's facelift note), just under the belt | F34, R34, S | black (or chrome) | `brightwork` (one finish for handles and mirrors), `handles: { front, rear, y, half }` |
| 36 | **Door mirrors body colour** (1989 facelift), on a **black triangular base** at the front door glass's foot | F34, F34r, R34 | body head, black base | Head finish: **NO FIELD** — `brightwork` gives handles and mirrors one finish (here black handles, painted mirrors). Simplest: `mirrorFinish?: Finish`. The black base: a sail is against the working rules (thin A pillar, glass right behind it); the mirror sits on the door at the glass's front foot (`mirrorS`) without one |
| 37 | Black B-pillar trim: none (painted, #11) | S | – | – |
| 38 | Wheels: 15" steel with full **plastic hub caps** (flat, 8 cut-outs / the star in the middle), or the 15-hole "Gullideckel" alloys | F34, R34, S | silver | wheel sets (carmodels.ts; STATUS "gw_alloy_8hole … W124") |
| 39 | Rubbing strip: none separate (the cladding's strip is it) | F34 | – | – |
| 40 | Antenna: manual or electric mast on the right rear wing (not on these cars) | – | – | not needed |
| 41 | Mud flaps: none | – | – | – |
| 42 | Single **wiper**: one long arm on an eccentric (lifting) mechanism, parked along the screen's foot | F34, F34r | black | NO FIELD: `buildWipers` builds a pair (the Oka has the same gap, STATUS). Simplest: `wipers?: 1` builds one blade of `wiperBlade` on the centre line's left-hand spindle; the lifting sweep not needed |
| 43 | Windscreen washer jets on the bonnet, two black nubs | F34 | black | not needed |

### 4.4 Rear

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 44 | **Tail lamps: wide units at the corners**, the full height of the band from the lid's shoulder to the bumper's top, the inner edge leaning (lamp wider at its foot), wrapping round onto the wing about 0.1 | R, R34, S | – | `cornerLamps` (`end: 'rear'`), `x: [bottom, top]` for the leaning inner edge, `s` for the wrap |
| 45 | Lamp layout: **top band: white reversing cell inside, amber indicator outside**; under it the big **red tail / brake** (and a red rear fog cell inside on one side) | R, R34 | white, amber, red | stacked `cornerLamps` units (one per band: `reverse` then `blinker`; `tail` below) |
| 46 | **Ribbed lenses**: deep horizontal ribs across the red and amber (self-cleaning ribs, the Mercedes trademark) | R, R34 (closeup) | – | NO FIELD. Simplest: `ribs?: number` on a lens / corner-lamp unit: that many thin dark horizontal grooves across it (a darker strip every 1/n of its height, no relief) |
| 47 | **Black housing frame** round each tail lamp (a thin dark surround, thicker along the lid's cut) | R, R34 | black | `frame` (face) for the straight part; the wrapped part of the corner unit: NO FIELD (the frame item is flat on the face). Simplest: skip the frame round the corner |
| 48 | Lid between the lamps: body colour, with the **plate** in it, a **dark shut line** over the lamps' tops across the tail | R, R34 | body, dark line | `notch`, `FaceLook.lid`; the plate NO FIELD (as #29) |
| 49 | Badges: chrome star on the lid, "230 E" script left | R, R34 | chrome | NO FIELD (badges not modelled on any car); not needed |
| 50 | **Rear bumper two-tone** as the front: body colour over black, bright strip between, wrapping forward to the rear arch flush with the cladding | R34, R34r, R | body / black / chrome | `moulded` `finish: 'paint'`, `moulding` black, `wrapTo`; strip NO FIELD (§5 #1) |
| 51 | Exhaust: single (230 E) tail pipe under the right bumper end | R34 | – | bay.ts exhaust (generic) |
| 52 | No high brake lamp, no spoiler (base car) | R34 | – | `spoiler` absent |

### 4.5 Cabin and dash (DASH, INT)

| # | Feature | Seen | Finish | Field today |
|---|---|---|---|---|
| 53 | Dash: a broad padded top, square-edged; a **wood band** across the fascia from the driver's door to the glovebox under the vents | DASH | dark blue / grey plastic, wood | `dash`, `fascia`, `wood` band, `KitLook.dash` colour |
| 54 | Cluster: a rectangular **hood** over **three round dials**: left a combination dial (fuel, oil pressure, coolant: three small scales in one dial), centre the big speedometer (to 240) with odometer, right the clock or the tachometer | DASH | black faces | `binnacle`, `binnacleHalf`, `gauges` (round). The combination dial with three needles: **NO FIELD**; simplest: one round gauge there on `fuel` (the others ignored), as the Espero's fuel dial carries the temperature scale on its face |
| 55 | A strip of **telltales** along the cluster's foot under the dials | DASH | – | `lamps` (`cols`, `show`) |
| 56 | Vents: a wide slatted vent at the driver's door end; **two wide vents side by side** at the top of the centre stack, the passenger's end vent | DASH | black | `vents` (with `half`) |
| 57 | Light switch: a **rotary knob** on the fascia left of the column, with the instrument dimmer beside it | DASH | black | `lights: { kind: 'knob' }` |
| 58 | Centre stack in wood: the **red hazard button** at its top, then **two big rotary heater knobs** (left / right temperature) with the blower thumbwheel between, the radio under them, the ashtray (wood lid) under the radio | DASH | wood, black knobs | `stack`, `hazard`, `heater: { knobs: [two], radius }`, `radio`, `ashtray` |
| 59 | Console: a wooden tray down to the gear lever, short lever in a leather gaiter | DASH | wood | `console`, `gear` |
| 60 | Steering wheel: **four spokes**, a big square-ish padded hub with the star, thick rim | DASH | black | `wheel: { spokes: [four angles], hub: 'pad' }` |
| 61 | **Foot-operated parking brake** (a pedal far left, the "P" release handle under the light switch); no lever between the seats | DASH; MB archive | – | NO FIELD: `handbrake` is required (a lever). Simplest: `handbrake?: 'foot'`, no lever on the tunnel (optionally the small release handle as a block under the dash) |
| 62 | Glovebox: lid on the passenger's side, its lock at its top right | DASH | dash colour | `glovebox` |
| 63 | Seats: separate front seats with **head restraints**; rear bench with head restraints on some | INT | cloth / leather | `headrests: true`, `upholstery` |
| 64 | Door cards: a wood capping strip, armrest pull, chrome inner handle | INT | wood | `frontDoor` (handle, crank); the wood capping: not modelled [E: not needed] |

## 5. NO FIELD, ordered by how much they matter to reading the car as a W124

1. **Bumpers' and cladding's continuous bright strip** (#27, #34, #50). The single line
   running round the whole car at bumper height, on top of the black lower half of the bumpers
   and the cladding, is the 1989–93 car's signature. Simplest: an optional `edge?: Finish`
   (and thickness) on the moulded bumper's `moulding`: a thin strip along the band's top,
   following the bumper round its corners and along `wrapTo` as the band does. With the
   `waist` (chrome, 8 mm) at the same height on the flanks, the line runs unbroken.
2. **Standing star on the bonnet** (#22). The one object everyone reads as "Mercedes". Simplest:
   `KitLook.star?: { height, radius }`: a flat chrome ring with three spokes (one plate, both
   faces) upright on a short stem on the centre line at the bonnet's front edge, riding on the
   bonnet as it opens.
3. **Ribbed tail lenses** (#46). The second Mercedes signature, seen from every car behind.
   Simplest: `ribs?: number` on a `cornerLamps` unit (and `lens`): dark horizontal lines across
   the lens at equal steps, drawn in the lens's own slot darker (no relief).
4. **Single wiper** (#42). Seen from the cabin all the time; the pair reads wrong from the
   driver's seat. Simplest: `CabinSpec.wipers?: 1`: one arm on the left spindle,
   `wiperBlade` long, parked along the screen's foot (the Oka would take it too).
5. **Mirror finish apart from the handles** (#36). Body-colour mirrors with black handles.
   Simplest: `KitLook.mirrorFinish?: Finish`; absent, `brightwork` as now.
6. **Side cladding panel** (#33). On body-colour cars the bright strip (1) already draws the
   line; the panel only matters for the contrasting-grey cars. Simplest: `cladding?: { top,
   finish, proud }`: a band on the flanks from the sill to `top`, broken at the shut lines and
   arches like the waist, the shell cut under it.
7. **Foot parking brake** (#61). Only in the cabin; a lever between the seats where the car
   has none. Simplest: `handbrake` optional (`'foot'`: no lever).
8. **Combination dial** (#54). Three needles in one dial; one gauge on `fuel` reads close
   enough. Simplest: none (use one round gauge).
9. **Leaning lid sides between the tail lamps** (#17) and **the tail lamp frame round the
   corner** (#47). Small; the Nexia was accepted with an upright cut. Simplest: none.
10. **Plates and badges** (#29, #48, #49). Not modelled on any kit car; the owner did not want
    them on the Espero. Simplest: none.

## 6. Cabin

### Dash (CABIN_W124)

On the classic's furniture (interior.ts `CABIN_W124`). Pixels on DASH's 1800 × 1200. Scale:
the column (hub x 712) to the stack's centre line (between the heater knobs, x 1196),
484 px, taken as the classic's 0.37 seat line [E], so 0.76 mm/px at the stack; heights from
the fascia's top (the centre vents' top, y 327) at the classic's dy 0.008 [E]. [P] read off
the photo, [E] estimated.

| Value | Photo reading | Tag |
|---|---|---|
| Fascia face to dy −0.215 (dash section deepened) | glovebox lid's foot y 608 | P |
| `wood` −0.095 … −0.062 | wood band y 419–460 at the stack | P |
| `binnacle` face down to −0.012, `binnacleHalf` 0.2 | square hood x 270–918, face down to the telltale strip y 430 | P shape, E size |
| `clusterFace` up 0.049, half 0.185 × 0.057 | black face behind the three dials | E |
| Speedometer r 0.046, full 240, right 0, up 0.062 | pivot x 594 y 329, scale 98 px in radius, to 240 | P place and scale, E radius |
| Fuel gauge r 0.03, right −0.088 | left dial x 425 y 344, 63 px: a combination dial (fuel, oil, coolant) drawn as one fuel gauge (owner) | P ratio 0.64, E; spacing 1.72 × 0.046 = 0.079 opened to 0.088 so the bezels clear [E] |
| `clock` r 0.03, right 0.088 | right dial x 762: numerals 1, 2, 3 with minute marks between | P (a clock, not the tachometer) |
| `lamps` 7 at 0.018, right −0.045, up 0.003 | telltale strip x 327–534, y 430 | P place, E which |
| Centre vents x ±0.055, dy −0.024, half 0.05 × 0.028 | x 1050–1333 split at 1150, y 333–408 | P |
| End vents x ±0.63, half 0.055 × 0.028 | driver's x 17–230 outboard of the hood; passenger's out of frame | P driver, E passenger (symmetry) |
| `stack` half 0.125 | wood stack x 1010–1349 | P |
| `hazard` [0.012, −0.147] | red button x 1180, y 530 | P |
| `heater` knobs ±0.048, dy −0.22, r 0.025 | two big knobs x 1137, 1263, y 626, about 0.05 across | P; the blower wheel between not drawn |
| `radio` dy −0.29, `ashtray` −0.355 | radio y 770 (−0.33), ashtray's wood lid y 872 (−0.41) | P order, E raised to stay above the tray |
| `console` ds 0.34–0.72, height 0.2 | wood tray from the stack to the lever | P presence, E size |
| `gear` height 0.22, lean 0.04 | short lever in a gaiter | P short, E figures |
| `glovebox` x −0.38, dy −0.152, half 0.23 × 0.055 | lid seam x 1366, under the band to y 608 (its handle and lock over the band, at x 1355–1460, not drawn) | P near end and height, E far end |
| `lights` knob right −0.24, dy −0.13 | rotary knob x 109, y 591, under the end vent | P place, E distance |
| `wheel` spokes 30, 150, 210, 330, `hub: 'pad'`, size the classic's | four spokes in two pairs about 60° apart (gaps 59, 154, 61, 86° on the turned wheel, in perspective), big square pad | P pairs, E laid square |
| `handbrake` the classic's lever | the car has a foot brake (release handle y 680 under the knob) | owner: keep the lever |

## 7. The first draft (2026-10-27)

### New spec fields (the owner's list from §5; every other car `identical` in `tools/kit-fingerprint.ts`)

| §5 | Field | What it draws |
|---|---|---|
| 1 | `moulded.moulding.edge: { finish, height }` | a chrome strip along the bumper band's top, round the corners and along `wrapTo` |
| 1, 6 | `KitLook.cladding: { top, finish, proud?, span?, edge? }` | the side cladding from the sill's bottom row to `top`, broken at the shut lines and arches as the waist; `edge` its chrome top |
| 6 | `Finish 'tone'` + `KitLook.tone` | a new `tone` slot, paint share 1, its vertex colour the grey `tone`; the kit shader multiplies the paint by the vertex colour (render/materials.ts `KIT_BODY_COLOR`; the paint's is white) |
| 3 | `CornerLamp.ribs` | darker horizontal lines at equal steps in the lens's own slot, flat; the ribbed unit's meshes marked `kitTinted` |
| 4 | `CabinSpec.wipers: 1` | one wiper on the driver's spindle |
| 5 | `KitLook.mirrorFinish` | mirrors apart from the handles |

Not built (owner): the star (§5 #2), the foot brake (#7), the combination dial (#8), plates
and badges (#10). Not built (small, §5 #9): the lid's leaning sides between the tail lamps
(the lid cut upright at ±0.42, a body-colour wedge up to the lamps' leaning inner edges) and
the tail lamps' housing frames.

### What was built, with the readings

Every number is in `mercedes.ts` with its source; the drawing's registration in
`refs/w124.json` `overlay`. Main readings: tips x 24 / 843, hubs x 163.5 / 649 (wheels on
2800 centred, s 0.82 / 3.62); cowl (1.341, 0.986); A pillar top (1.893, 1.37); roof 1.43
from 2.47 to 3.17, its rear end over the back light (3.56, 1.354); back light foot (3.96,
1.015); belt 0.922 → 0.946; side glass top 1.343; front door 1.42–2.53, rear 2.53–3.555 at
the belt with its edge raked round the arch to 3.21; the rear door's drop glass to the bar
at 3.11, the fixed quarter 3.15–3.53; tail face s 4.70, lamps 0.665–0.855 (D2 rear: ±0.43 →
0.77 at the foot, ±0.60 → 0.74 at the top); head lamps 0.57–0.755, ±0.37 → corner, amber
from ±0.68 (D2 front). Face rake `frontLean` 0.2 above 0.56 [D side: 0.05 back over 0.21].
The chrome line at 0.47–0.48 nose to tail [P: front bumper 0.48 (F34: 21 % down the
bumper), rear 0.50 (R: a quarter down), doors 0.44–0.46 (F34, R34: 37 % and 33 % up the
door)]; black bands front 0.35–0.47, rear 0.335–0.47. Tone 0.78 [E: the red car's cladding
~0.6 of the door's red, the white car's no darker in the photo]. Mirrors body colour, the
head at s 1.66, 4 cm off the skin [D2: ±0.77–0.91]. Blade 0.5 [E: the photos' ≈ 0.6 does not
sweep 90° without the real arm's lift]. Interior blue cloth and dash from DASH.

### Deviations accepted for the draft (refs `accepted`)

- **Sill and doors' bottom** 0.255 / 0.275 (built door bottom 0.291) over the drawn 0.19 /
  0.21: the shell's floor is the sill, and the classic platform's exhaust (resonator top
  0.245) stood through a floor at 0.19 (kit-zfight), as on the Vectra. The cladding runs
  0.29–0.47. (Resolved in §8: the sill is at the drawing.)
- **Front side glass** from 1.448 at the belt, not the drawing's frame line 1.533: the
  glass right behind the thin A pillar (working rules).
- **Silhouette advice** (kit-drawing, not judged): side IoU 0.705 (the drawing's door
  interiors fail its fill); s 0.10–0.25 the drawn bonnet star (not wanted); s 1.52–1.61 the
  drawing's thick A pillar; s 3.59–4.16 a faint second line from the roof to the boot at
  s 4.1 (the glass's drawn line and the built one agree, backLightFoot passes). Front IoU
  0.967: x ±0.5–0.72 3–4 cm low at the roof's edge.
- **Triangles** 13 621, over the 13 000 warning (cladding, ribs, wrapped bumpers); 12 444
  after §8, 12 363 after §9.
- **0–100** 12.4 s against the catalogue's 11.1 (`CATALOGUE_OPTIMISTIC`, as the other
  foreign cars), top 204 km/h, turn 4.11 m (W124Gear's bench, tools/reality.ts).

### Checks (`npm run kit-check -- w124`, 2026-10-27)

zfight pass, proportions pass, reality pass, mirrors L100 R100, dents 0, drawing 18/18,
dash 9/9, frozen: recorded with `tools/kit-fingerprint.ts --write w124` after the draft.

## 8. The owner's first review (2026-10-27)

His words on the draft: «форма колёсных арок, вздутый багажник»; «а разве спереди не
ребристые фонари?»; the sill «нужно делать по чертежу» (the exhaust made flatter instead,
bay.ts, the Exhaust change); «треугольники - ну явно же есть, где сэкономить»; and, on a
Mercedes 190 (W201) side photo, «как видишь передний свес у 190e довольно короткий».

**Sources added.** [P S] `side.jpg` (an E 260, pre-1989, no cladding; the shapes are the
same) registered on its hubs, (425, 930) and (1352, 947): 331 px/m along, heights from the
tyres' ground line (y 1025 front, 1048 rear). Its top outline reads 2–3 cm low near the roof
(1.40 against 1.43) and the centre-line back glass stands ahead of where it is (perspective,
the camera ~8 m off): the boot's and the back light's centre line are read on [D], the arches
on [P S] (their lips lie on the side's plane, with the tyres). [A] angurten.de's W124
saloon table: 4740 = 815 + 2800 + 1125. The owner's own photo (saved as
`photos/w124/side_drivedata.jpg`) is a Mercedes 190 (W201, 2665 wheelbase), not a W124: used
only for the family trait he names, a short front overhang; nothing is measured on it.

**Front overhang** (the 190E remark). The W124's is 0.815 [A; D the drawn hubs 0.81], 0.290
of the wheelbase (the 190's ~0.28 by eye on his photo: the same trait). Ours was 0.82 from
the hubs (FACTORY_GEOMETRY `kit_w124` sets no `frontOverhang`, so the loader keeps the
kit's hubs): 5 mm long, now 0.815 / 3.615 (rear overhang 1.125 [A]). What read as a long
nose was the front arch's black ring ahead of the tyre (below).

**Arches.** Measured as the opening's outline over the hub, s from the hub (± ahead/behind):

| | top over the hub | at 0.10 | at 0.20 | at 0.30 | at the hub's height |
|---|---|---|---|---|---|
| Front [P S], near (rear) edge | 0.371 | +0.32 | +0.29 | +0.21 | +0.35 (−0.34 ahead, the bumper's end) |
| Front [D] | 0.366 | | ±0.31 at 0.21 | | ±0.37–0.38 (a circle) |
| Front, the draft | 0.374 (circle `arch` 1.18) | ±0.36 | ±0.32 | ±0.24 | ±0.374 |
| Rear [P S], near (front) edge | 0.39–0.40 | −0.36 | −0.315 | −0.26 | −0.39 |
| Rear [D] | 0.383 | | | | +0.40 |
| Rear, the draft | 0.387 (circle `rearArch` 1.22) | ±0.37 | ±0.33 | ±0.245 | ±0.387 |

The tops were right; the front arch is narrower than a circle low down: on the photo it
hugs the tyre's sides (3 cm of black at the hub's height against the draft's 5.7) and stays
clear over its top. Built: a half ellipse 0.343 wide and 0.371 high, new `frontArchRise`
1.17 over `arch` 1.08 (the front counterpart of `rearArchRise`). The rear arch measures as
the draft's circle (not lower than the front: higher, 0.39 against 0.37), so it is kept.
The front bumper now wraps back to the arch's edge (`wrapTo` 0.47). kit-drawing measures
the openings now (`archFront`, `archRear`: [top, ahead, behind]): built [0.372, 0.342,
0.342] and [0.388, 0.378, 0.386] against [0.371, 0.34, 0.35] and [0.39, 0.39, 0.40].

**Boot** («вздутый»). The draft's deck rose from the back light's foot (1.015 at 3.96) to
1.05 at s 4.35 and fell to 1.0 at the tail: a hump in the boot's middle. [D side, the
centre-line outline]: 1.016 at 3.98 (the glass's foot), 1.056 at 4.10–4.13 (the lid's front
edge), 1.051 at 4.19–4.27, 1.045 at 4.30, 1.033 at 4.45, 1.016 at 4.59, 1.004 at 4.68, then
the upright tail face; [P S]: level, 1.066 at 4.10 to 1.038 at 4.67. Built: the deck up to
1.055 at the lid's front edge (station 4.08, replacing 4.35) and straight to 1.02 at 4.68,
the corner over the tail face crisp (4.68 → 4.70); the wing's top edge rises with the lid
(belt 1.02 at 4.08, 0.985 at 4.68) so the deck keeps one 1.5 cm crown across (kit-surface
found a dent at the back light's foot while the crown changed from 1 to 4 cm there).

**Head lamps fluted.** The head lamp's glass and the indicator are fluted [P F]; drawn as
the tail lamps' dark lines (`ribs: 3` on the front unit; the owner: dark lines are fine).

**Triangles.** 13 621 → 12 444 (kit-surface). Where they went (`installProvenance`, by
emitter): the shell's skin 2330, its jambs and inner skins ~1600, the placeholder wheels
1344 (the pack's replace them in the game), the cabin's lining 535. Cut, without changing
how the car reads:

| Cut | Triangles |
|---|---|
| `archSegments` 8 (12 by default; a 7 mm chord on the 0.34 arch), and no station at s 3.3: the belt straight 0.925 → 0.946 from the B pillar to the rear door's edge (station 3.555, on its column); measured together with the boot's and arches' changes | 461 |
| the rear door's rear edge bent at the flap's two rows (0.92, 0.80: `foot.knee`) instead of a 4-segment round (5 extra side rows along the whole car); within 12 mm of the drawn line | 437 |
| the rear door's foot sharp (its 3 cm round was 4 more rows) | 112 |
| `roofDrop` three points each end instead of six (within 4 mm of the drawn roof) | 371 |
| added: the front lamps' ribs (+84); the boot's even crown (+10); the sill at the drawing (+110) | −204 |

**Sill to the drawing.** With the exhaust flattened for every car (bay.ts: the pipe 10 mm
under the shell's floor, flat cans), the sill is the drawn 0.19 from the front arch to the
rear (stations 0.96–3.555, was 0.255) and the doors' bottom 0.21 (was 0.275): built door
bottom 0.226 against 0.21 ± 0.025, the `accepted` deviation in `refs/w124.json` removed.
kit-zfight passes.

### Checks (`npm run kit-check -- w124`, 2026-10-27, after the review)

zfight pass, proportions pass, reality pass, mirrors L100 R100, dents 0, triangles 12 444,
drawing 20/20 (with `archFront`, `archRear`), dash 9/9; frozen: re-recorded with
`tools/kit-fingerprint.ts --write w124`. Silhouette advice unchanged in kind: side IoU
0.706 (s 0.10–0.25 the drawn star, s 1.52–1.61 the drawing's thick A pillar, s 3.59–4.08
the drawing's second line from the roof to the boot), front 0.968.

## 9. The owner's second review (2026-10-27)

His words, on lab screenshots: «сравни расположение колеса с фото» (the near front: the
bumper's corner well ahead of the tyre, a dark gap over and ahead of it), and «багажник
выравнял откровенно плохо. что это за конструкция?».

**Front wheel: what the game draws.** Measured on a lab capture side-on through a 3° lens
from 40 m (391 px/m at the hub): the bumper's tip 0.795 ahead of the hub, the arch's top
0.368 over it, the tyre 0.317 (its 0.634 across in 248 px). The loader is not the cause:
the kit body is natively 4.752 × 1.762 × 1.430 with its lowest point 0.143, so it is
shrunk 0.3 % along, 1.2 % across and 0.7 % in height and set 7 mm higher; the front hub
moves 4 mm in its arch (kit-proportions); the fit row's front hub stands 0.815 behind the
bumper's tip (2.37 − 1.5546). The radius is the factory 0.317 (195/65 R15).

**The photos.** `side.jpg` reads the bumper's tip 0.355 ahead of the tyre's front (the
drawing 0.49) because the car stands about 10° off square with its front away: its front
tyre is 163 px across against the rear's 173 (6 % further), and 0.815 cos 10° − 0.75
sin 10° (the hub on the near side) = 0.67 against the photo's 0.672 from the tip to the
hub; the rear overhang reads long by the same turn. The 190E photo he compared with is
taken a little from the front as well. The arch on `side.jpg`, read along rays from the
hub (331 px/m, the lit body's edge): 0.344 ahead at the hub's height, 0.36 at 45°, 0.38
at the top, 0.36 at 135° behind, 0.338 at 150°; over the hub the black well from 0.316 to
0.372, the tyre's tread (luminance ~33) plainly lighter than the well (~8). So the built
0.343 × 0.371 opening was the photo's; what differs in the game is the tyre as black as
the well, so the 2.6 cm at the sides and 5.4 cm on top read as one dark hole round a small
wheel.

**Built.** The front arch closed round the tyre: `arch` 1.08 → 1.04 (0.33 at the hub's
height, 1.3 cm off the tyre), `frontArchRise` 1.17 → 1.10 (0.349 over the hub, 3.2 cm
over the tyre); kit-drawing `archFront` built [0.35, 0.33, 0.33] against the photo's
[0.371, 0.34, 0.35], within its 0.03. The bumper's wrap to 0.47 [D side x 105] now ends
1.5 cm ahead of the arch's edge (0.485). The overhangs stay 0.815 / 1.125.

**Boot.** §8's deck had a station at the lid's front edge (4.08, 1.055, the wings' top
1.02): up 4 cm in 12 cm from the back light's foot across the whole width, the wings' top
humped with it, then down to the tail: a ridge behind the glass, the boot a box laid on
the car. The sources: [D] centre line 1.016 at 3.98, 1.056 at 4.10, 1.004 at 4.68; [P S]
the side outline 1.031 at 4.00, 1.066 at 4.09–4.27 (the C pillar's flank, then the wall
behind it whitens the outline); [D2] side view (10.0 mm/px, tips x 9 / 481, ground y
149): the outline 1.076 at 4.14, 1.066 at 4.37, 1.056 at 4.52, 1.046 at 4.64, the corner
1.026 at 4.70, no rise from the glass's foot; [P R, R34, R34r] a flat lid from the glass
to one edge over the lamps, its sides rolling into the wings. Built: one plane from the
back light's foot (3.96, 1.035: 2 cm over [D]'s 1.015, kit-drawing `backLightFoot`
reads 1.015 at the glass's edge) to the edge over the tail (4.68, 1.015), no station
between; the wings' top edge 0.985 → 0.98 under it, the crown across 3 cm at the glass and
1.5 at the tail (3 cm at the tail folded one triangle of the tail's top at the lid's cut,
x −0.50: kit-surface `flip`). The tail face, the notch and the lamps unchanged.

### Checks (`npm run kit-check -- w124`, 2026-10-27, after the second review)

zfight pass, proportions pass, reality pass, mirrors L100 R100, dents 0, triangles 12 363,
drawing 20/20, dash 9/9; frozen: re-recorded with `tools/kit-fingerprint.ts --write
w124` after every other car's exhaust was re-recorded (all 26 identical). Silhouette
advice: side IoU 0.705, s 3.59–4.30 low (the drawing's lid rise and its second line from
the roof); front 0.966. Lab captures: `build/kitcheck/w124/lab-side.png`,
`lab-front-wheel.png` (his angle), `lab-rear34.png`, `lab-rear-side.png`.

## 10. The owner's third review (2026-10-27)

His words: «посмотри, какой чудесный сайт ... здесь есть фото и размеры. я не верю в твоё
объяснение про передний свес ... передний свес на самом деле короткий, а у нас нет. ...
сравни, как сделаны ручки дверей. посмотри, какие из фар ребристые. посмотри на линии
остекления заднего окна. посмотри на формы кормы и передка. нужны исправления.» His links
were a 190 (W201); he then said he mixed the cars up and the W124 references stand. Later,
on lab screenshots: «у w124 сейчас ручка передней двери посреди двери», «решетка у
мерседеса не должна выступать за капот», «линия остекления заднего стекла явно не должна
быть такой ... вокруг стекла металл зажевало, переход в крышу с щелями».

**Sources added** (`build/carshape/_refs/photos/carsized/`, carsized.com
`/en/cars/mercedes-benz-e-1984-sedan/`, a late saloon, black): [C S] `w124_side.png`
(1503 × 712): the rims' bright discs give the hubs (240.5, 596) and (1174.5, 594.5), 933 px
apart → 333 px/m on the 2800 wheelbase; ground y 704; tips x 2 / 1500. [C F]
`w124_front.png` (622 × 780) and [C R] `w124_rear.png` (596 × 780): across from the body's
width at the bumper (x 3–620 for 1.74: 354.6 px/m front; x 2–594: 340 px/m rear), the
centre x 311.5 / 298, ground y 754 / 747. Method: the built car traced orthographically
(tools/kitlib.ts `trace`) on the side photo by both hubs, and from the front and rear at
the photos' scales, the silhouettes compared row by row (`/tmp/w124/side.ts`, `ends.ts`,
throwaway).

**Overhangs.** On its hubs the photo's tips stand 0.708 ahead of the front hub and 0.993
behind the rear: 4.50 overall against the factory 4.74, both overhangs 13 % short and in
the factory's ratio (0.708 / 0.993 = 0.71; 815 / 1125 = 0.72). A perspective trace of our
car from 3–16 m (its hubs registered the same way) shortens the ends by at most 5 cm, so
the rest is the image itself (its wheels or its scale), not a shorter car: the overhangs
stay 0.815 / 1.125 [A, D]. What did differ is the nose over the bumper, measured from the
bumper's front (the same at either scale):

| Height | Photo [C S] | Before | Built |
|---|---|---|---|
| 0.40–0.46 (bumper band) | 0 | 0 | 0 |
| 0.61 | 0.10 | 0.02 | 0.096 |
| 0.70 | 0.14 | 0.04 | 0.129 |
| 0.79 (the lip) | 0.19 | 0.12 | 0.21 |
| 0.85 | 0.25 | 0.27 | 0.33 |
| 0.31 (apron) | 0.075 | 0.03 | 0.03 |

The drawing [D] has the face upright 0.06 behind the bumper to 0.57 and the lip at 0.093:
its nose is the long one. Built: the face station at s 0.12 (was 0.06), `frontLean` 0.35 m
per m (was 0.20) from 0.56, `full` 0.26, `bonnetFront` 0.12, the station behind at s 0.25
deck 0.87 (at 0.882 the bonnet dented at s 0.5, kit-surface). The ref `bonnet` is now the
photo's lip, [0.19, 1.341] (built 0.202). The aprons under the bumpers' black band draw
back to their foot (moulded `foot`, new: front from 0.35 back 0.08, rear from 0.335 back
0.04; [C S]: the front 0.07 back at 0.35, 0.10 at 0.30; the rear 0.09 at 0.35).

**Door handles.** [C S] (and [S], [F34]): long chrome pull bars, the front s 2.29–2.51 and
the rear 3.23–3.46 (the doors' rear edges 2.53 and 3.555), 0.81–0.83 high; under each, the
pull lever's bright lip (front 2.33–2.45, rear 3.28–3.38) 4.7 cm lower over a black recess.
Ours: 13 cm bars at s 2.12 (the front door's middle) and 3.35. Built: `handles` front 2.40,
rear 3.345, y 0.82, half 0.112, and `grip` (new: `{ half, drop }`): a bar 1.6 cm tall, a
black recess 3 mm proud of the skin under it, the lever's lip at `drop` 0.046, half 0.055.

**Fluted lamps.** [C F, F34, F]: the head lamps' and indicators' glass is smooth; [C R,
R34]: the tail lamps are fluted, about 3 cm apart, the top band (smoked: reversing inside,
indicator outside from ±0.69) 44 % of the lamp's height and the red band 56 %. The head
lamps' `ribs: 3` (review 1) removed; the tail lamps 0.665–0.768 red (3 ribs) and
0.774–0.855 smoked (2 ribs), was 0.665–0.794 / 0.80–0.855 with 5 and 2.

**Back light and C pillar.** [C S]: the quarter glass's rear edge 3.19 at 1.24, 3.34 at
1.11, 3.45 at 0.99 (photo heights ×1.034: its roof reads 1.384); the bar before it chrome,
upright at 3.105–3.14. [D]: 3.246 / 3.365 / 3.527. Built: the quarter's rear column 3.50
(was 3.53; kit-drawing `sideGlassBelt` 3.48 against the accepted 3.508), the bar at
3.105–3.14 in chrome (column `finish: 'chrome'`, new; was a black bar 3.11–3.15). [C R]:
the glass ±0.50 at its top under the roof's ±0.53, ±0.65 at its foot, its top corners
rounded. A first pass curved the glass's top back in plan (a `rearTop` field) so the side
showed glass behind the C pillar: the owner's screenshot showed its corners jutting and the
roof chewed round it, with slits; removed (HISTORY.md, failed approaches). Built: the roof
ends square over the glass at 3.56 as before, its corners cut in one chamfer
(`cornerDrop` 0.035 on the last column), the seal round the glass thinner (`rearHeader`
0.045 → 0.025, `rearBottom` 0.025 → 0.02).

**Front.** [C F]: the chrome shell x 182–443 (±0.365 with its frame), y 488–597, under the
bonnet's lip which runs over its top; the lamps y 513–580. Ours was ±0.33. Built: grille
`x` 0.34 (frame ±0.365), its slot from 3.5 cm over the bumper's top to 3.5 cm under the
lip (the frame 1 cm under it), `standOut` 0 (its front 2.4 cm out of the raked face, the
bar 4.6). A tall top bar standing over the lip (photo: the shell's broad top) was tried
and removed on the owner's word.

**Tail.** [C R]: the lamps' inner edges lean from ±0.472 at their foot to ±0.582 at their
top, the lid's foot ±0.456 at 0.655; ours cut the lid upright at ±0.42 with the lamps' inner
edge leaning only in the lamp. Built: `notch` 0.572 with `notchWall` 0.112 (new, on the
tail station: the deck's wall that width, so the lid's cut runs from ±0.572 at the
corners' top to ±0.46 at its foot), the lamps 8–11 mm outside it (brake from ±0.474–0.531,
reversing ±0.535–0.58).

### Checks (`npm run kit-check -- w124`, 2026-10-27, after the third review)

zfight pass (no slit), proportions pass, reality pass, mirrors L100 R100, dents 0,
triangles 12 194, drawing 20/20, dash 9/9; frozen: re-recorded (`--write w124`) after the
arches' shelf change; every other car `identical`. No lab captures (the owner looks in the
car lab himself).

## 11. The tail in plan (2026-10-27)

His words, on a lab shot from above: «вряд ли корма мерседеса должна иметь такие углы -
смотри вид сверху». The tail was a box: ±0.87 to s 4.10, ±0.83 at 4.68, square corners.

**Plan** [D plan, 5.806 mm/px, centre y 629; the outline's top and bottom rows per column,
bumper included]: ±0.868 at s 3.93 (x 700), ±0.851 at 4.04 (720), ±0.813 at 4.27 (760),
±0.793 at 4.45 (790), ±0.769 at 4.62 (820), ±0.752 at 4.68 (830), ±0.717 at 4.71 (835);
the widest ±0.877 at 3.58–3.69 (the drawing's scale reads 1 % wide there against the
factory's 1740). A straight line from ±0.87 at 3.96 to ±0.755 at 4.68 passes within 1 cm of
every one. Built: tail station (4.68) `wSill` / `wCrease` / `wBelt` 0.74 / 0.755 / 0.72, the
face (4.70) 0.70 / 0.715 / 0.68; the amber indicator's split ±0.64 (was ±0.69, off the
narrower face). Measured from above on the built car: ±0.855 / 0.825 / 0.79 / 0.775 / 0.765
/ 0.725 at 4.10 / 4.30 / 4.50 / 4.60 / 4.68 / 4.70. Judged by `planHalfWidth` in
refs/w124.json (new in kit-drawing.ts, ±0.02).

### Checks (`npm run kit-check -- w124`, 2026-10-27, the tail in plan)

zfight pass, proportions pass, reality pass, mirrors L100 R100, dents 0, triangles 12 209,
drawing 21/21, dash 9/9; frozen: re-recorded (`--write w124`).
