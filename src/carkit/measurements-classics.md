# VAZ classics: measured numbers for 2101 / 2103 / 2105 / 2106 / 2107

All files are in `/tmp/classics/`. The repo was not changed.

Frame used throughout:
- **Body (side view):** `s` is measured rearward from the tip of the front bumper and `y` is height above the ground line, both in mm. The spec block is in metres, as `specs.ts` uses.
- **Faces (front and rear views):** `x` is measured from the car's centre line, and the range is given as ±(inner..outer). `y` is height above the ground under the tyres.

Every number is tagged:
- **[D]** measured on a gridded crop of a drawing;
- **[P]** measured on a photo;
- **[E]** estimate. The reason is given next to each [E] value.

## 0. Sources and scales

### Drawings (3dcar.ru, `https://3dcar.ru/media/blueprints/full/vaz/<name>.jpg`)

| File | Size | View | Scale (dimension used, extension-line px) | Ground row |
|---|---|---|---|---|
| `vaz_2107_1982.jpg` (by olegoft) | 4200×2800 | side | 1.6684 mm/px (4136, x 1383→3862) | 1067 |
| | | front | 1.679 mm/px (track 1365, x 202→1015, centre 608.5) | 1067 |
| | | rear | 1.691 mm/px (track 1321, x 216→997, centre 606.5) | 2401 |
| | | top | 1.637 mm/px (width 1620, rows 1551.5→2541, centre row 2046) | – |
| `vaz_2105.jpg` (Lindemann, **no dimensions**) | 1500×1000 | side | 4.742 mm/px (passport length 4130 over bumper tips x 545→1416) | 393 |
| | | front | 4.576 mm/px (width 1620 over widest body x 82→436, centre 259) | 392 |
| | | rear | 4.60 mm/px (width 1620, x 84→436, centre 260) | 856 |
| `vaz_2103.jpg` | 2200×1400 | side | 3.449 mm/px (4116, x 779.5→1973) | 538 |
| | | front | 3.527 mm/px (1365, x 173→560, centre 366.5) | 534 |
| | | rear | 3.523 mm/px (1321, x 181.5→556.5, centre 369) | 1170 |
| `vaz_2106.jpg` | 1600×1000 | side | 4.546 mm/px (4166, x 557→1473.5) | 374 |
| | | front | 4.627 mm/px (1365, x 109→404, centre 256.5) | 374 |
| | | rear | 4.587 mm/px (1321, x 111.5→399.5, centre 255.5) | 878 |
| `vaz_2101.jpg` (identical to `build/carshape/_refs/bp/img/vaz2101.jpg`) | 1500×900 | side | 4.703 mm/px (4073) | 336 |
| | | front | 4.786 mm/px (1345, x 111→392, centre 251.5) | 335 |
| | | rear | 4.716 mm/px (1304, x 114→390.5, centre 252.25) | 796 |
| `vaz_2107.jpg` | 900×600 | four views; dimensions 664 / 2424 / 1057 / **4145**, height 1435, width 1620, tracks 1365/1321 | too coarse, used only for the 4145 length | – |
| `vaz_2102.jpg`, `vaz_2104.jpg` | – | also exist | not used | – |

Several file names do not exist (HTTP 404): `vaz_2105_zhiguli`, `lada_2105`, `lada_2107`, `lada_riva`, `vaz_210x_zhiguli`.

**Why the 2105 body comes from the 2107 drawing.** `vaz_2105.jpg` is a degraded tracing of the same factory drawing as `vaz_2107_1982.jpg`: the lines are identical, but it carries no dimensions. Scaled to 4130, it reads a wheelbase of 2466, 1.7% long, and heights about 1.5% high. The 2105 and 2107 share the body shell, so the 2105 spec is measured on `vaz_2107_1982.jpg`, which is dimensioned, at 1.67 mm/px against 4.7. The 2105 drawing is used only for what is 2105-specific: the flat bonnet front, the face and the tail. That drawing's own length dimension is **4136**, not 4130 or 4145; the `s` values below are not rescaled, a 0.15% difference.

**A discrepancy inside the 2107 drawing.** Its dimension lines say 655 / 2424 / 1057. The hub centres as drawn sit at s = 635 and 3048, a drawn wheelbase of 2413. I used the drawn hubs, because the arches and doors are drawn around them. The 2106 spec did the same: its 648 is the drawing's 603 plus 45.

### Photos, Wikimedia Commons (`https://commons.wikimedia.org/wiki/File:<title>`)

Downloaded through the API as 1280–2400 px renditions; the 1980 2105 set is at its original 3840 px.

| Local | Commons title | Licence | Used for |
|---|---|---|---|
| `p_2101_f/r.jpg` | VAZ-2101 beige colored (front view).jpg / (rear view).jpg | CC BY-SA 4.0 | 2101 lamps, repeater, mirror, bumper |
| `p_2103_f.jpg` | VAZ-2103 green-white colored (front view).jpg | CC BY-SA 4.0 | 2103 chrome fangs, repeater |
| `p_2103_f2/r2.jpg` | VAZ-2103 in Crimea (front view).JPG / (backside view).JPG | CC BY-SA 3.0 | 2103 face, rubber overriders, tail cells, chrome rear surround |
| `p03side.jpg` | VAZ-2103 on a parking lot in Kraków (3).jpg | – | **near-orthographic 2103 front**, scaled by the 520 mm plate (1.209 mm per crop px) |
| `p03rr.jpg` | 1982 VAZ-21033, rear right, Greenwich 2018.jpg | – | 2103 side moulding, arch chrome |
| `p_2105_f.jpg` / `p_2105_r.jpg` | 2008 Lada 210540 white front.jpg / rear.jpg | CC BY 4.0 | late 2105: black plastic bumpers, repeater |
| `p_2105_r2.jpg` / `p_2105_f2.jpg` | Łada-2105 yellow Jasło (1).JPG (a front view) / (2).JPG (a rear view) | CC BY-SA 3.0 | early 2105 face and tail, aluminium bumpers |
| `h_2105_03.jpg` | 1980 Lada 2105 - 03.jpg | – | **near-orthographic 2105 side**: A-pillar, mouldings, tail wrap |
| `h_2105_05.jpg` | 1980 Lada 2105 - 05.jpg | – | **near-orthographic 2105 rear**, scaled by the 520 mm plate (1.135 mm/px) |
| `p_2106_f2.jpg` | Lada 2106.JPG | CC BY-SA 3.0 | 2106 face |
| `p_2106_r.jpg` / `p_2106_r2.jpg` | VAZ-21061-37 green colored (rear view).jpg / 1998 VAZ 21060 brown rear.jpg | CC0 | 2106 tail cells, black rear panel |
| `r4big.jpg` | Lada 1600 (VAZ 2106) at Ostblocktreffen Pütnitz 2023.jpg | – | 2106 side moulding, arches |
| `p_2107_f.jpg` / `p_2107_f2.jpg` | 2012 VAZ 210740 silver front.jpg / Lada 2107 (front) (1).jpg | CC0 / CC BY-SA 4.0 | 2107 grille, lamps, repeater |
| `p_2107_r.jpg` / `p_2107_r2.jpg` | Lada 2107 (rear).jpg / 2010 Lada 210740 black rear.jpg | CC BY-SA 4.0 / CC0 | 2107 tail cells, bumper strip, **fuel flap (right side)** |
| `i_2101.jpg` | Lada-2101 interior.jpg | – | 2101 dashboard |
| `i_2103.jpg` | VAZ-2103-interior.jpg | – | 2103 dashboard |
| `r_3.jpg` | Budapest, Hungexpo, AMTS 2017, 90.jpg | – | 2106 dashboard; used on uk.wikipedia's ВАЗ-2106 page |

### Dashboards: Commons has none for 2105, 2106 or 2107

These come from avtozam.com (`/wp-content/uploads/...`):
- `SHHitok-priborov-VAZ-2105.jpg`: 2105 cluster schematic;
- `SHHitok-pyaterki-s-tahometrom.jpg`: 2105 cluster with a tachometer;
- `Shema-paneli-priborov-VAZ-2107.jpg`;
- `Klavishi-priborki-VAZ-2107.jpg`;
- `Demontazh-priborki-VAZ-2107.jpg`;
- `Pribornaya-panel-VAZ-2106.jpg`: manual illustration, near-frontal;
- `Krasnyj-avtomobil-VAZ-2105-1.jpg`: factory press photo.

Their licences were not checked; use them for reference only.

---

## 1. VAZ-2105 body: the full spec (paste-ready)

Measured on `vaz_2107_1982.jpg` (2105/2107 shell). Values tagged [E] are estimates; the reasons are in the comments and in §1.1.

```ts
/**
 * VAZ-2105, the squared "05" shell (shared with the 2107), read off the dimensioned
 * 3dcar.ru drawing vaz_2107_1982.jpg (olegoft, 4200 px): side 1.668 mm/px from its 4136
 * overall length, top view 1.637 mm/px from the 1620 width, front/rear views from the
 * 1365/1321 tracks. s from the front bumper tip, heights from the drawn ground line.
 * Hubs as drawn at 635 / 3048 (the dimension line says 655 / 2424). Bumper 0..50 ahead
 * of a flat face (bonnet to the lamp top, no grille bulge: vaz_2105.jpg); face top 820.
 * Bonnet rises 906 (s 300) → 968 (s 900); screen base on the centre line at s≈985,
 * 1000 high, raked ~45° to the roof's front at s 1410, 1400 high; door frame foot 1170.
 * Sharp character crease 760–767 nose to tail (dropping to 735 at s 3300, 700 at the
 * tail); shoulder line 868 (wing) / 885 (doors) / 872 → 760 (rear wing); window sill 955;
 * glass top 1335; gutter 1375; roof 1448. Front door 1165 to 2090 (one shut line under
 * the belt), rear door 2090 to 2955, round the arch; no vent windows (a black mirror
 * sail at the glass's front corner), fixed quarter glass behind a channel at 2690 in
 * the rear door. Back light 2950 (roof) → 3330 (deck, 935). Tail at 4070–4090, deck
 * 854 at 3900, 795 at the tail. Sill underside 270 → 258; doors end at 365, a black
 * sill strip 300–360 below them. Fuel flap right rear wing from an oblique photo.
 */
const VAZ2105: KitCarSpec = {
  id: 'vaz2105',
  length: 4.13, // passport; the drawing's own dimension reads 4.136 [D]
  platform: 'classic',
  stations: [
    // face; sill = bottom of the front apron behind the bumper (front view 355) [D]; belt [E]
    { s: 0.05, sill: 0.36, crease: 0.76, belt: 0.795, deck: 0.82, wSill: 0.74, wCrease: 0.755, wBelt: 0.745 },
    // front wing; sill hidden behind the bumper end cap/arch [E]
    { s: 0.35, sill: 0.36, crease: 0.763, belt: 0.868, deck: 0.913, wSill: 0.77, wCrease: 0.79, wBelt: 0.77 },
    // bonnet rear edge [D]
    { s: 0.9, sill: 0.265, crease: 0.766, belt: 0.878, deck: 0.968, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // cowl: windscreen base on the centre line, 1000 high [D]
    { s: 1.0, sill: 0.268, crease: 0.766, belt: 0.88, deck: 1.0, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // doors; deck unused under the cabin [D] (deck value [E])
    { s: 2.1, sill: 0.258, crease: 0.767, belt: 0.885, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // back light base [D]
    { s: 3.33, sill: 0.262, crease: 0.735, belt: 0.874, deck: 0.935, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // boot; rear apron bottom 370–380 [D]; widths [E] (top view outline sits on the dimension line)
    { s: 3.9, sill: 0.37, crease: 0.708, belt: 0.815, deck: 0.854, wSill: 0.77, wCrease: 0.805, wBelt: 0.775 },
    // tail face 4.07–4.09 [D]; sill and widths [E] (rounded corners, photo h_2105_05)
    { s: 4.075, sill: 0.4, crease: 0.7, belt: 0.76, deck: 0.795, wSill: 0.75, wCrease: 0.785, wBelt: 0.76 },
  ],
  // front view: 0.783 at y 0.875, 0.77 at 0.90, greenhouse 0.73 at 0.925 [D]
  shoulder: { inset: 0.03, rise: 0.02 },
  cabin: {
    columns: [
      // windscreen corner: centre-line screen base 0.985/1.0, roof front 1.41/1.40 [D]
      { s: 1.0, top: 1.41, upper: 'body' },
      // front door shut line at the belt 1.165–1.19; frame meets the gutter at ~1.44 [D].
      // Door frame plus the black mirror sail (to s 1.33, up to y 1.07): no vent glass.
      { s: 1.17, top: 1.44, upper: 'door1' },
      // glass front edge: 1.225 at y 1.0, 1.30 at 1.1, 1.46 at 1.3 [D]
      { s: 1.22, top: 1.48, upper: 'door1', glass: 'drop' },
      // front glass rear edge 2.055 at the belt, 2.062 at the top [D]
      { s: 2.055, top: 2.062, upper: 'door1' },
      // B pillar: black band 2.05–2.127 above the belt, one shut line at 2.09 below [D]
      { s: 2.075, top: 2.08, upper: 'body', lower: 'door1' },
      { s: 2.09, top: 2.095, upper: 'body', lower: 'door2' },
      { s: 2.11, top: 2.112, upper: 'door2' },
      { s: 2.127, top: 2.127, upper: 'door2', glass: 'drop' },
      // vertical channel 2.679–2.698 from the belt to the top; fixed quarter behind it [D]
      { s: 2.68, top: 2.68, upper: 'door2' },
      { s: 2.70, top: 2.70, upper: 'door2', glass: 'fixed' },
      // rear door frame, slanted: 2.94–2.975 at the belt, 2.80 at y 1.2, top corner ~2.71 [D]
      { s: 2.955, top: 2.71, upper: 'door2' },
      // door rear shut line → C pillar (black louvred vent s 2.93–3.15, y 0.98–1.03) [D]
      { s: 2.975, top: 2.73, upper: 'body' },
      // back light base corner 3.31–3.33 at deck 0.935–0.946; roof rear 2.94–2.96 at 1.40 [D]
      { s: 3.33, top: 2.95 },
    ],
    rail: 1.375, // thin gutter line above the door frame [D]
    railHalf: 0.62, // front view: 0.61–0.63 at y 1.375 [D]
    crown: 0.048, // rail + crown + railRise = roof 1.448 [D]; the split between the two [E]
    railInset: 0.05, // [E] as 2106
    railRise: 0.025, // [E]
    glassBottom: 0.05, // glass bottom 0.955 − (belt 0.885 + rise 0.02) [D]
    glassTop: 0.04, // glass top 1.335 [D]
    screenBottom: 0.025, // [E] as 2106
    screenHeader: 0.045, // [E] as 2106
    rearBottom: 0.025, // [E] as 2106
    rearHeader: 0.045, // [E] as 2106
    pillar: 0.07, // [E] as 2106
  },
  wheels: {
    front: 0.635, // hub as drawn (dimension line 0.655) [D]
    rear: 3.048, // hub as drawn (dimension 3.079) [D]
    radius: 0.288, // drawn tyre r ≈ 0.293 (352 px across) [D]; 0.288 kept as the 2106
    width: 0.165, // [E] as 2106 (the 2105's 175/70R13 would be 0.175)
    frontHalfTrack: 0.6825, // 1365 / 2, drawing dimension [D]
    rearHalfTrack: 0.6605, // 1321 / 2, drawing dimension [D]
    // arch lip 0.64–0.646 at the top (hub 0.30): r 0.34; at hub height ±0.32 → mean 0.33 / 0.288 [D]
    arch: 1.15,
  },
  doorBottom: 0.365, // [D]
  bonnetFront: 0.06, // 2105: flat bonnet to the face top (vaz_2105.jpg face at s 0.052–0.062) [D]
  bootEnd: 4.06, // lid runs to the top-rear edge; it drops to y 0.72–0.74 on the tail face [D]
  // right rear wing, above the front half of the arch, centre ~0.2 m behind the axle [E]:
  // from an oblique photo (p_2107_r2), not a drawing
  flap: { s0: 3.19, s1: 3.31, y0: 0.69, y1: 0.81 },
  look: {
    label: 'VAZ-2105',
    // [E] the enum has no "aluminium + black plastic" (see §4)
    bumpers: 'plastic',
    // grey vinyl, 1980 2105 (h_2105_03) [P, colour E]
    upholstery: 0x6e6a64,
    dash: 0x1d1c1b,
    headlamps: 'rect',
    taillamps: 'classic',
    ventWindows: false,
    headrests: true,
  },
};
```

### 1.1 What is measured and what is not (2105 body)

**Side-view raw readings** (s, y in mm; `vaz_2107_1982.jpg`):
- **Top outline (deck):**

  | s | 40 | 100 | 200 | 300 | 500 | 700 | 900 | 950 |
  |---|---|---|---|---|---|---|---|---|
  | y | 813 | 851 | 883 | 906 | 934 | 954 | 968 | 971 |

  Behind the cabin:

  | s | 3350 | 3400 | 3500 | 3600 | 3700 | 3800 | 3900 | 4000 | 4060 | 4080 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | y | 924 | 914 | 908 | 898 | 886 | 871 | 854 | 828 | 799 | 789 |

  The 2105 tracing reads about 20 mm lower at the front: 820 at s 60, 910 at s 500, 953 at s 900.
- **Lines below the deck:**

  | | Front wing | Doors | Rear wing |
  |---|---|---|---|
  | Bonnet or lid edge, about 18 mm below the top | ~888 | – | 872 at s 3400 → 794 at 4000 |
  | Shoulder crease | 866–878 | 881–884 | – |
  | Window sill and seal | – | 931–956 | – |

- **Character crease:** 749–769 at the front, 761–769 on the doors, 732–736 at s 3300, 706–714 at 3900 and 699–702 at 4040. The photo `h_2105_03` puts it at about 790 above the door bottom line. Its scale is wheelbase-based and its wide-angle lens adds about ±3%.
- **Lower door swages:** 440–455 and 489–492, both stampings. The photo shows two creases at about 450 and 490.
- **Sill strip:** a band at 300–360 with ribs, black in `h_2105_03`. The black underside is 255–305.
- **A pillar:**
  - The drawing's centre-line screen line runs from (985, 1005) to (1410, 1400), 47° from vertical.
  - The door-frame line runs from (1190, 920) to (1430, 1370), about 30–34°.
  - The photo `h_2105_03` agrees: the outer pillar is at 44° and the frame at 34.5°, and the screen corner sits about 70–85 mm ahead of the door shut line at the belt.
  - The spec's cowl column (1.0 → 1.41) gives the screen 44° on the centre line. Its side edge in the photo starts nearer s 1.10. One column cannot hold both.
- **Arches:**
  - Front: the opening runs from s 320 to 963 at hub height, and the lip top is at 646–675.
  - Rear: 2720 to 3370 at y 300; the lip top is at 636–641.
- **Bumpers:**
  - Front: s 0 to about 50 ahead of the face. The end cap runs back to s 240–255, at y 380–510.
  - Rear: from 4060–4090 to 4136. The end cap runs forward to s 3870, at y 340–500.
- **Door handles:** flush, black with a chrome rim. Front s 1890–2050, rear s 2760–2900, both y 800–845.
- **Side repeater:** amber, on the front wing behind the lamp, s 190–260, y 690–720. The silver 210740 photo agrees.
- **Mirror:** black rectangular, on the door's sail. In the front view it sits at x 730–850, y 955–1055.

**Widths:**
- **Front view:**
  - sill 765–771 at y 250–300;
  - widest 813–817 at y 625–675;
  - 805 at 750;
  - 795 at 800;
  - 783 at 875;
  - 773 at 900;
  - greenhouse 731–736 at 925–950;
  - 700 at 1100;
  - 660 at 1325;
  - 620 at 1375.
- **Rear view:** widest 814 at y 675, 801 at 775, 779 at 875 and 743 at 900.
- **Top view:** 745 at s 50, 755 at s 100, 787 at s 400, 809 at s 650, 812–833 at s 900 (front arch flare), 818 at s 2000. At the rear the body side lies on the 1620 extension line, so it is unreadable; I set it to 0.805 there.

**Not measurable:**
- The wheel width is passport data, not a drawing.
- The upholstery colour is only seen at a distance.
- The split between `crown` and `railRise` is a guess.
- The screen and back-light strip widths are copied from the 2106.
- The rear tail corners' plan-view radius: the top view's outline coincides with the dimension line.
- The fuel flap comes from an oblique 3/4 photo; I found no right-hand side view.

### 1.2 VAZ-2107 against the 2105 body

Same shell and the same numbers as §1, except:
- **Length 4.145.** That is the `vaz_2107.jpg` dimension: 664 / 2424 / 1057. Its front bumper sits about 10–15 mm further forward. The olegoft drawing itself says 4136 (655 / 2424 / 1057).
- **Front:** a tall chrome grille stands proud of the face. In the side silhouette it reaches s 42–45, against s 52–57 for the 2105's face. The bonnet's centre carries a notch and bulge up to the grille top at y 840; the 2105's bonnet front is at 820.
- **Station 1:** use deck 0.84 at s 0.045 over |x| < 0.35 [E]. Everything else is as the 2105.

---

## 2. Faces: front and rear, per model

All values are in mm. `x` is a half-width from the centre line, given as ±(inner..outer); `y` is above the ground.

### 2.1 VAZ-2101

Front from `vaz_2101.jpg` front view; photos `p_2101_f`, `c_2101_fb`.

| Element | Numbers | Finish / notes |
|---|---|---|
| Headlamps | 2 round: centre x ±575, y 630; bezel r 120 (chrome ring), lens r 88 | single lamp each side [D]; chrome bezel [P] |
| Grille | x ±500, y 490..715; chrome; ~7 horizontal bars + vertical ribs every ~110 | wide chrome grille between the lamps [D][P] |
| Indicators / sidelights | rectangles on the face under the headlamps: x ±(535..655), y 430..490 | chrome-framed clear/amber lens [P] |
| Bumper | thin blade y 356..423, spans ±770; wraps back to s ≈ 270 | chrome [P] |
| Overriders ("fangs") | x ±390, 50 wide, y 295..475; tips at s 0 (bumper blade front at s ≈ 35) | chrome [D][P] |
| Plate | under the bumper: x ±225, y 248..353 | – |

Rear from `vaz_2101.jpg` rear view; photo `c_2101_r`.

| Element | Numbers | Finish / notes |
|---|---|---|
| Tail lamp | horizontal unit x ±(380..690), y 550..660; no wrap round the corner | chrome rim [D][P] |
| Cells | side by side: inner red, about 55%, tail/stop; outer amber, about 45%, indicator | [P] |
| Reversing lamp | separate small unit below each tail lamp: x ±(472..594), y 488..531 | white [D][P] |
| Plate | on the panel between the lamps: x ±153, y 500..680 | [D][P] |
| Plate lamp | chrome housing on the bumper's centre, y 401..437 | [D] |
| Bumper | blade y 351..423, ±760 | chrome [D] |
| Overriders | x ±510, y 266..464 | chrome [D] |

### 2.2 VAZ-2103

Front: drawing `vaz_2103.jpg`; the straight-on photo `p03side` is scaled by the plate.

| Element | Drawing [D] | Photo [P] | Notes |
|---|---|---|---|
| Headlamps | 4 round. Outer centre ±600, inner ±425, all at y 660. Bezel r about 72–80. | Outer ±568, inner ±408; bezel r 78, lens r 67. About 4% small from perspective, so outer ≈ ±590, inner ≈ ±424. | The lamps sit inside the grille, centred on it vertically. |
| Grille | Chrome, full width (lamps included): ±740, y 540..800. | ±690, 209 tall. | About 13 horizontal slats and about 12 vertical per half; chrome frame, split at the centre by the badge. |
| Indicators | On the face below the outer lamps, under the grille: x ±(545..655), y 490..530. | x ±(500..654), 54 tall. | Amber outer, about 60%, and white sidelight inner. |
| Bumper | Chrome blade y 378..458, about 100 tall; wraps back to s ≈ 260. | Blade about 103 tall. | Chrome. |
| Overriders | x ±430, about 65 wide, y 314..539. | ±415, 60 wide, 193 tall. | Chrome. On the yellow car they carry black rubber blocks (`c_2103_f`). |
| Rubber strip | not seen | not seen in either photo | The README's "rubber strip" is not confirmed. |
| Plate | on the bumper, between the fangs: ±240, y 360..490 | – | – |

Rear: drawing `vaz_2103.jpg`; photo `c_2103_r`.

| Element | Numbers | Notes |
|---|---|---|
| Chrome surround | One rectangle round the whole rear panel, enclosing both lamps and the plate: ±680, y 490..755. | [D][P] |
| Tail lamp | chrome rim x ±(370..625), y 525..705; no wrap | [D] |
| Top row | red tail/stop, y 626..690 | [D][P] |
| Bottom row | amber indicator, y 538..626 | [D][P] |
| Chrome divider | between the two rows | [P] |
| Reversing lamp | small clear square, about 40×35, at the inner end of the red row | [P]; the drawing puts it in the lower row. Role is [INFERENCE] from its pale lens. |
| Plate | inside the surround, on the panel: ±152, y 538..714 | [D] |
| Bumper | chrome blade y 378..458 | [D] |
| Overriders | x ±510, y 282..506; rubber-capped on the photo car | [D][P] |
| Plate lamp | on the bumper's centre, y 426..466 | [D] |

### 2.3 VAZ-2106

Front: drawing `vaz_2106.jpg`; photo `c_2106_f`.

| Element | Numbers | Notes |
|---|---|---|
| Headlamps | 4 round: outer ±600, inner ±428, y 694; lens r ≈ 70 | [D] |
| Black surrounds | one panel per side round each lamp pair: x ±(311..735), y 555..817 | [D][P] |
| Chrome frame | runs round the whole lamp/grille band: ±770, y 563..825 | [D][P] |
| Grille | between the panels: ±315, y 579..810; plastic with a silver finish; fine grid of about 12 horizontal × 16 vertical | badge at the centre [D][P] |
| Indicators | on the face under the outer lamps: x ±(540..650), y 500..550 | amber outer and white inner [P] |
| Bumper | y 362..501, chrome; black plastic end caps wrap round to s ≈ 240 | bumper front about 50 ahead of the body sheet [D][P] |
| Overriders | black rubber blocks, taller than the bumper: x ±430, about 85 wide, y 362..509 | [D][P] |
| Plate | on the bumper: ±235, y 378..501 | [D] |

Rear: drawing `vaz_2106.jpg`; photos `c_2106_r`, `c_2106_lamp`.

| Element | Numbers | Notes |
|---|---|---|
| Rear panel | black between and round the clusters, with a chrome outline: ±660, y 512..780 | [D][P] |
| Cluster lens | x ±(380..640), y 589..726 | [D] |
| Plate-lamp housing | black, at the cluster's inner end, facing the plate: x ±(280..380) | [D][P] |
| Wrap | the lens's outer end returns about 20–30 mm round the corner | [E] from the 3/4 photo |
| Cell grid | 3 columns × 3 rows. Columns: outer ±(554..638), middle ±(440..554), inner ±(378..440). Rows: 680..726, 635..680, 589..635. | [D] |
| Cell roles (faded lenses) | top row: amber indicator over outer + middle, red tail inner; middle row: white reverse in the middle cell, red/amber either side; bottom row: red stop, full width | [P]; partly [E] |
| Bumper | chrome, y about 350..500; black end caps | [D][P] |
| Overriders | black rubber blocks at x ±510, y 352..489 | [D][P] |
| Plate | on the black panel between the clusters | [P] |

### 2.4 VAZ-2105

Front: drawing `vaz_2105.jpg` scaled to 1620; photos `c_2105_f2` (early) and `c_2105_f` (late).

| Element | Numbers | Notes |
|---|---|---|
| Headlamps | rectangular units x ±(343..669), y 599..725 (W 326 × H 126, 2.6:1) | [D] |
| Indicator | built into the lamp unit as an amber outer cell, about 60–70 wide | [P]. No separate indicator on the face. |
| Grille | black plastic, flush with the lamps (no protrusion): ±318, y 586..716; about 6 horizontal slats, short verticals, small vertical badge at the centre | [D][P] |
| Surround | none: the face round the lamps is body colour | [P]. The drawing frames lamps and grille in one band ±690, y 570..755. |
| Front face | at s ≈ 0.055 | [D] |
| Bumper | band y 378..507 (≈130), ±770; about 50 ahead of the face; wraps back to s ≈ 250 | [D] |
| Bumper finish, early | unpainted aluminium face and top, black plastic lower edge, black plastic end caps | [P] |
| Bumper finish, late (210540) | all black/grey plastic with a thin bright top strip | [P] |
| Overriders | none | [D][P] |
| Plate | on or below the bumper's centre | – |

Rear: drawing `vaz_2105.jpg`, plus the near-orthographic photo `h_2105_05` (plate scale, x only).

| Element | Numbers | Notes |
|---|---|---|
| Tail lamp | drawing x ±(298..676), y 557..721. Photo: left −692..−312, right +318..+684, about 168 tall, so x ±(315..688). | rectangular [D][P] |
| Wrap | none visible in the pure side view (`c_h03_tail`). The lamp stops about 40–50 short of the body edge in the rear view; rounded corner. | [P]. The README's "wraps round the corner" is not supported. |
| Cell grid | 2 rows × 3 columns. Columns: inner ±(315..415), middle ±(415..520), outer ±(520..688). Rows: top about 47% of the height, bottom 53%. | [P] |
| Top row roles | red tail across the full width, with a brighter red square (stop) over the middle column | [P] |
| Bottom row roles | inner red (reflector/tail), middle white reverse, outer amber indicator | [P] |
| Surround | thin dark frame on the lens; no chrome | [P] |
| Plate | 520 plate, flat on the panel between the lamps, inside the lamp band in height | [P] |
| Boot lid | lower edge on the rear face at y ≈ 735–750 | [D] |
| Bumper | y 334..495, ±800 | [D] |
| Bumper finish, early | aluminium upper face (about 55% of the height), black rubber strip about 40 tall along the middle, aluminium lower lip, black plastic end caps that wrap forward to s ≈ 3870 | [P][D] |
| Bumper finish, late | plastic | [P] |

### 2.5 VAZ-2107

Front: drawing `vaz_2107_1982.jpg` front view at 1.679 mm/px; photos `c_2107_f`, `c_2107_f2`.

| Element | Numbers | Notes |
|---|---|---|
| Headlamps | rectangular: frame x ±(363..704), y 605..779; lens ±(372..695), 617..773 (≈ 335 × 165, 2.0:1, taller than the 2105's) | [D] |
| Indicator | amber outer cell of the lamp unit: x ±(603..695) | [D][P] |
| Black surround | round each lamp: x ±(363..719), y 593..800 | [D][P] |
| Grille | tall chrome frame ±350, y 582..840 (taller than the lamps; the bonnet is notched for it); black field ±330, y 600..815 | [D] |
| Grille bars | 7 horizontal chrome bars, centres y 763→620 about every 24; the photo also shows about 4 vertical bars per side making a grid | [D][P] |
| Grille protrusion | ≈ 10–15 ahead of the 2105's face in the side silhouette (s 42–45 against 52–57) | [D]. The photo shows the frame's side face about 30–40 deep [E]. |
| Side repeater | amber rectangle on the wing behind the lamp: s 190–260, y 690–745; front view x ≈ ±(755..775) | [D][P] |
| Bumper | band y 390..520 | [D] |
| Bumper finish | chrome upper blade (y ~470..520) and black plastic lower face (390..470); black plastic end caps x ±(700..750) that wrap back to s ≈ 250 | [D][P] |
| Overriders | none | [D][P] |
| Plate | set into the bumper's centre: ±285, y 372..462 | [D] |

Rear: drawing at 1.691 mm/px; photos `c_2107_r2`, `c_2107_r`.

| Element | Numbers | Notes |
|---|---|---|
| Lamp frame | x ±(325..700), y 534..710; lens ±(336..678), 558..695 | [D] |
| Top row | y 622..695: red tail/stop across the full width, with an inner "box" ±(469..553) | [D][P] |
| Bottom row | y 558..622: inner white reverse ±(336..505), outer amber indicator ±(505..678) | [D][P]; colours [P] |
| Wrap | none visible | [P] |
| Plate | in a recessed niche between the lamps: ±318, y 532..707 | [D] |
| Badge | "LADA 2107" on the right, y ≈ 765 | [D][P] |
| Boot lid | lower edge at y ≈ 720 | [D] |
| Bumper | y 340..477 | [D] |
| Bumper finish | upper face 417..471 with a chrome/bright insert strip; lower face 362..413 black plastic; black plastic end caps ±(680..746), wrapping forward to s ≈ 3870 | [D][P] |

---

## 3. Side trim per model

Values are in mm, in each drawing's own `s` frame. For the 2106 kit spec, add 45 to `s` read on the 2101 drawing.

| | 2101 | 2103 | 2106 | 2105 | 2107 |
|---|---|---|---|---|---|
| Waist moulding | none [D][P] | chrome strip about 25 tall at y 740..765, s 130 → 3950, broken at the shut lines [D][P] | strip about 27 tall at y 760..786, chrome edges with a black insert [D][P] | none (early 2105: a black line at the lower door crease about 450–490 appears in the factory press photo [P, low resolution]) | none [P] |
| Arch trim | lip drawn as a double line [D]; painted in the photo [P] | chrome arch lips [P] | none [P] | painted [P] | painted [P] |
| Sill | chrome strip at y 260..320 [D][P] | chrome strip at y 270..330 [D] | strip at 280..345 [D] | black ribbed rubber/plastic strip y 300..360 under the doors, s ≈ 1.0–2.95 [D][P] | painted on late cars [P] |
| Door handles | chrome pull handles with a push button: s 1870–2050 and 2750–2930, y 700–750 [D][P] | chrome pull handles [D] | chrome pull handles [D] | flush recessed, black with a chrome rim: s 1890–2050 and 2760–2900, y 800–845 [D][P] | as the 2105 [P] |
| Side repeater | round, amber, r ≈ 22, on the front wing: s 233, y 689 [D][P] | amber, at the moulding's front end: s 133–221, y 738–771 [D][P] | amber, at the moulding's front end: s 153–243, y 717–754 [D][P] | amber rectangle on the wing behind the headlamp: s 190–260, y 690–720 [D][P] | as the 2105 [P] |
| Quarter lights | yes | yes | yes | **no**: black triangular mirror sail, s 1235→1330 at the belt, up to y 1070 | **no**, as the 2105 |
| Rear-door fixed quarter | – | – | – | yes, behind a channel at s 2680–2700 [D][P] | yes |
| C-pillar vent | – | chrome grille at s ≈ 3.0–3.15, y ≈ 1.05 [D] | chrome grille, same place [D][P] | black louvres s 2930–3150, y 980–1030 [D][P] | black louvres [P] |
| Mirror | drawing: round head r ≈ 50 on a stalk on the front wing, centre x 765, y 955; photo car: chrome mirror on the door [P] | not drawn | chrome rectangle on the door: x 770–890, y 980–1050 [D] | black plastic rectangle on the door sail: x 730–850, y 955–1055 [D][P] | as the 2105 [P] |
| Fuel flap | right rear wing [P] | – | right rear wing (spec 3.2–3.31) | right rear wing, s 3.19–3.31, y 0.69–0.81 [E] | same [P] |

---

## 4. Dashboards

There is no frontal photo with a known scale, so sizes are ratios measured on the photos. The absolute figures [E] take the cabin width as 1.36 m, from the front drawings' greenhouse 2 × 0.73 less the doors. The large dials then come out about 100 mm, which matches the 2106 manual illustration: 38 px in a 510 px dash.

| | Panel | Gauges (sizes) | Switches / other | Steering wheel |
|---|---|---|---|---|
| **2101** (`i_2101`) | Flat dash. Rectangular hooded binnacle (ratio 2.8:1; ≈ 0.30 × 0.10 m [E]) with a chrome bezel. | **Horizontal ribbon speedometer** 0–180 km/h across the whole window; temp and fuel ends inside it; 6 small warning lamps in a row below. | Two round eyeball vents on top, right of the binnacle (each ≈ 0.25 of the binnacle's width). Chrome strip with toggles below the dash. | 2 spokes, thin black rim, black hub cover, chrome strip with a red "ВАЗ" badge [P]. |
| **2103** (`i_2103`) | Wood-look panel with all the dials in one row. | 5 round dials: 3 small (fuel, water temp, oil pressure, ≈ 50–55 mm [E]) then 2 large (tachometer 0–8, speedometer 0–180, ≈ 100–110 mm [E]); ratio large/small ≈ 2.0 [P]. | 3 rocker switches under the small dials; clock elsewhere on the panel. | 2 spokes, large thin rim [P, `r_3`]. |
| **2106** (`r_3`, manual illustration) | As the 2103: wood strip across the dash, here continuing over the passenger side. | 2 large (≈ 100 mm) and 3 small (≈ 60 mm) round dials behind the wheel; clock (≈ 65 mm) at the top of the centre console [P, illustration ratios]. | Rockers below the dials; centre console with heater levers. | 2 spokes with a wide padded horizontal hub (illustration) [P]. |
| **2105** (`SHHitok-priborov-VAZ-2105`, `SHHitok-pyaterki-s-tahometrom`) | Own rectangular cluster, black/grey (ratio 3.25:1, ≈ 0.37 × 0.115 m [E]); padded black dash, no wood. | Two large round dials, each 0.27 of the cluster's width (≈ 100 mm [E]). Left: combined temp + fuel (tachometer on later versions). Right: speedometer 0–160/180. Between them a 2×3 warning-lamp block on top and a small voltmeter (≈ 0.12 of the width) below. | Two rocker switches at each end of the cluster: lights and rear fog on the left, heated rear window and fan on the right. | Not seen in any photo; 2 spokes [INFERENCE]. |
| **2107** (`Shema-paneli-priborov-VAZ-2107`, `Klavishi`, `Demontazh`) | Large one-piece "euro" padded black dash with a big glovebox ("ЖИГУЛИ" badge) and a centre console with vents. Wide cluster, ratio ≈ 2.8:1 (≈ 0.40 × 0.14 m [E]). | Tachometer 0–8 (left) and speedometer 0–180 (right), each ≈ 0.30 of the cluster's width; between them a vertical column of 7 warning lamps; 4 small dials (≈ 0.12 of the width) at the ends: economy meter and temp on the left, fuel and voltmeter on the right. | 4 rocker switches in a row on the console below (lights, heated rear window, rear fog, fan). | Not seen; 2 spokes [INFERENCE]. |

---

## 5. Gaps and what I could not measure

- **Wheel position:** the 2105/2107 spec uses drawn hubs at 0.635 and 3.048 rather than the dimension line's 0.655 and 3.079. If the running gear must match passport overhangs, shift `wheels.front`/`rear` and accept the 20–30 mm offset against the drawn arches.
- **Wraps:** no 2105 or 2107 photo shows the tail lamp wrapping onto the side. The README table entry should change.
- **2103 bumper:** neither 2103 photo shows a continuous rubber strip. One car has bare chrome fangs, the other has rubber blocks on them.
- **Interior sizes:** I found no dashboard photo with a scale reference, so the dashboard sizes are ratios plus [E] absolutes.
- **Missing photos:** I found no 2105/2107 steering wheel photo, and no right-hand orthographic side view for the fuel flap.
- **No measurement taken for:** headlamp depth and protrusion beyond the side silhouette, bumper depth in plan view, and the plan-view radii of the corners.

## Arches to the drawings (2026-10-27)

Arch openings `[top, ahead, behind]` over the hub (m), refs → built before → after (kit-drawing; STATUS.md table, HISTORY):

- **vaz2101**: front 0.34 / 0.325 / 0.355: — → 0.35 / 0.326 / 0.326; rear 0.24 / 0.33 / 0.33: — → 0.268 / 0.316 / 0.36. BODY_124: `frontArchRise` 1.215, `rearArch` 1.18, `rearArchRise` 0.93, `archShift` [0, 0.02] (refs new, its own drawing).
- **vaz2103**: front 0.34 / 0.31 / 0.33: 0.326 / 0.326 / 0.326 → 0.35 / 0.326 / 0.326; rear 0.26 / 0.31 / 0.33: 0.326 / 0.326 / 0.326 → 0.268 / 0.316 / 0.36. BODY_124 (as the 2101).
- **vaz2105**: front 0.345 / 0.3 / 0.355: 0.332 / open / 0.332 → 0.332 / 0.33 / 0.332; rear 0.285 / 0.36 / 0.37: 0.332 / 0.332 / 0.332 → 0.286 / 0.364 / 0.362. BODY_05: `rearArch` 1.265, `rearArchRise` 0.99.
- **vaz2106**: front 0.36 / 0.32 / 0.35: 0.326 / 0.326 / 0.326 → 0.35 / 0.326 / 0.326; rear 0.29 / 0.32 / 0.385: 0.326 / 0.326 / 0.326 → 0.268 / 0.316 / 0.36. BODY_124 (as the 2101).
- **vaz2107**: front 0.345 / 0.3 / 0.355: 0.332 / open / 0.332 → 0.332 / 0.33 / 0.332; rear 0.285 / 0.36 / 0.37: 0.332 / 0.332 / 0.332 → 0.286 / 0.364 / 0.362. BODY_05 (as the 2105).

## Nose and tail in profile (owner, 2026-10-27)

The owner: the classics' nose and tail faces stood upright in the kit; on the 2106 drawing
the face leans forward about 6 cm over the 0.3 m above the bumper and the tail leans out
about 3 cm at the top. Read on each side view's outline (the darkest pixel nearest the end,
per row; scales and ground rows in §0) and on near-orthographic Commons side photos
(heights from the ground under the tyres, the wheelbase as scale; the photos' heights read
3–7 % high, so their leans are the check, the drawings' the numbers). `s` in each drawing's
own frame (from its front bumper's tip), heights as drawn. Lean in m per m, negative =
outwards (`EndLean`).

| Car | Nose: the face's foot over the bumper | Foremost point | Lip | Tail: foot over the bumper | Rearmost | Deck edge |
|---|---|---|---|---|---|---|
| 2101 [D `vaz_2101.jpg`, x 516 = s 0] | s 0.132 at 0.522 (0.146 at 0.508, the bracket) | 0.094–0.099 at 0.62–0.75 (the lamp's rim 0.113 at 0.69) | rounds back from 0.76 (0.132 at 0.776) | 3.983 at 0.49–0.52 | 4.016–4.021 at 0.55–0.73 | 4.016 at 0.734, 3.97 at 0.762 |
| 2101 [P `photos/vaz2101/side.jpg`, 261 px/m] | 3.4 cm behind the tip at 0.48, 2.3 at 0.50 | the tip at 0.64 | 1.5 cm back at 0.69, 4.2 at 0.71 | 3.1 cm in at 0.48, 2.7 at 0.50 | out at 0.64–0.69 (the lamp 2.7 further) | rounds in from 0.73 |
| 2103 [D `vaz_2103.jpg`, x 779.5] | 0.071 at 0.521 | 0.005 at 0.714 | 0.016–0.022 at 0.74–0.77, 0.06 at 0.84 | 4.006–4.013 at 0.51–0.535 | the lamp's side 4.061 at 0.62–0.68 | 4.047–4.054 at 0.73–0.75 |
| 2103 [P Commons "VAZ-2103 on a parking lot in Kraków (2).jpg", 464 px/m] | 6.0 cm behind the tip at 0.53 | the tip at 0.65–0.72 | 1.9 cm back at 0.74, 4.9 at 0.77 | 6.9 cm in at 0.55 | the tip at 0.81 | rounds in above 0.84 |
| 2106 [D `vaz_2106.jpg`, x 557] | 0.086 at 0.505–0.52, 0.077 at 0.55, 0.064 at 0.63 | 0.018 at 0.72–0.75 | 0.023 at 0.80, 0.05 at 0.85, 0.164 at 0.90 | 4.055–4.06 at 0.505–0.53 | the lamp's side 4.119 at 0.67–0.71 | 4.105 at 0.79–0.82 |
| 2106 [P Commons "Lada 2106 1500 1990 (15324610756).jpg", front 3/4 nearly side-on] | the wing's front corner x 90 at the bumper | x 63 under the lip, 110 px higher (≈ 515 px/m both ways at the nose: −0.25) | | | | |
| 2105 [D `vaz_2105.jpg`, x 545] | 0.128 at 0.526, 0.08 at 0.57–0.63 | 0.047–0.057 at 0.64–0.80 | 0.047 at 0.80 | 4.035–4.054 at 0.50–0.51 | 4.092–4.102 at 0.60–0.80 | 4.092 at 0.80 |
| 2105 [P `h_2105_03` = Commons "1980 Lada 2105 - 03.jpg", 832 px/m] | 4.2 cm behind the face at 0.50 | upright 0.64–0.74 | | 2.5 cm in at 0.52 | upright 0.62–0.72 | 0.9 cm in at 0.74 |
| 2107 [D `vaz_2107_1982.jpg`, x 1383] | 0.122 at 0.539 (the lamp unit's chin), 0.093 at 0.58 | 0.040–0.048 at 0.70–0.81 | 0.045 at 0.81, 0.088 at 0.85 | 4.028 at 0.496, 4.044 at 0.52 | 4.084–4.094 at 0.60–0.78 | 4.089 at 0.776, 4.053 at 0.80 |
| 2107 [P Commons "Lada 2107 on Józefa Ignacego Kraszewskiego street in Kraków (4).jpg", 472 px/m] | (the lamp band is dark against the wall) | the wing's corner upright 0.70–0.73 | rounds back above 0.76 | 1.3 cm in at 0.61 | upright 0.64–0.76 | rounds in above 0.79 |

Leans above the bumper's top: **2101** −0.16 [D] / −0.2 low down [P]; **2103** −0.35 to the
foremost point, −0.26 to the lip [D] / −0.37 [P]; **2106** −0.30 to the foremost point [D] /
−0.25 [P] (the owner's ~6 cm over 0.3 m: −0.2); the **124 tail** −0.14 (2101) / −0.16 (2103)
/ −0.17 (2106) [D], −0.14 (2101) / −0.28 (2103) [P]. The **05 shell** (2105, 2107 and the
2104's nose) stands upright above 0.60–0.65 at both ends; only a chin 4–7 cm deep over the
0.1–0.15 m above each bumper runs in to it [D, P]. Not a lean: kept upright (the chin would
need the face stations moved, not `EndLean`).

Spec (specs.ts):
- `BODY_124.rearLean` { base 0.52 (over the 2106's rear fangs, 0.51, the highest of the
  three), lean −0.16, blend 0.1 }: the 2106's deck row 4.075 → 4.113 at 0.76 (drawn 4.105).
- `frontLean` per car (each face its own; `full` 0.067 behind the face so the lamps, grille
  and indicators rooted in it lean whole; blend 0.12, short of the arch):
  `NOSE_2101` (2101, 2102) { base 0.48 (over the fangs' 0.475, under the grille frame's
  foot 0.483), lean −0.16, full 0.17 }: 0.103 → 0.060 at the deck row (drawn 0.132 → 0.094);
  `NOSE_2103` { base 0.516 (over the fangs' 0.515), lean −0.26, full 0.195 }: 0.128 → 0.066;
  `NOSE_2106` { base 0.49 (over the fangs' 0.486), lean −0.25, full 0.215 }: 0.148 → 0.081.
- The 2101's grille bars proud 0.028 → 0.031: the 4 mm step to the dark back, tilted with
  the face, was a far-band z-fight.
- Kept: the 2103 and 2106 faces' feet stand 5–6 cm behind their drawings' (the shell's face
  station is the 2101's), so their tops stay that far behind too; the 2103/2106 drawings'
  bonnet lip also stands 6–8 cm higher than the 124 shell's. Not part of this complaint.
- The estates' tails were measured with their tailgates (`measurements-estates.md`,
  `rearLean` 0.25 on the 2102, 0.31 on the 2104) and are kept.
