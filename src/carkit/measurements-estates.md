# VAZ estates: measured numbers for 2102 / 2104

Crops, gridded readings and downloaded photos are in `/tmp/estates/`. Only this file was written in the repo.

The frame and tags are the same as in `measurements-classics.md`:
- **Body:** `s` is measured rearward from the tip of the front bumper and `y` is height above the ground, both in mm in the tables. The spec literals are in metres.
- **Faces:** `x` is a half width from the centre line, written ±(inner..outer).
- **Tags:** **[D]** drawing, **[P]** photo, **[E]** estimate (the reason is given with it).

Each estate is measured **in its family's s-frame**:
- the 2102 in `BODY_124`'s frame, which is the 2101 drawing plus 0.045;
- the 2104 in `BODY_05`'s frame, which is the 2105 frame of `vaz_2107_1982.jpg`.

Only what differs from the family is new. Everything ahead of the rear door's glass (2102) or the rear door's rear edge (2104) is the family's own numbers.

## 0. Sources and scales

### Drawings (`https://3dcar.ru/media/blueprints/full/vaz/<name>.jpg`)

| File | Size | View | Scale | Ground row | Notes |
|---|---|---|---|---|---|
| `vaz_2102.jpg` | 1100×700 | side | **6.589 mm/px**. The 4059 dimension's extension lines are at x 404.5 → 1020.5. Its 603 / 2424 / 1032 dimensions agree to ±1.5 px. | 257 | Height dimension 1400 (1458*). The roof is drawn at 1403. |
| | | rear | x **6.70 mm/px** (body 1611 over 240 px; overriders ±510 as the 2101's, which checks it). y **6.44 mm/px** (roof 1403 = the side view's). | 621.5 | The 1321 track dimension gives 6.90; the drawing is not isotropic. |
| | | top | along 6.665 mm/px (bumper tips 409 → 1018); across 6.25 mm/px (1611 over 258 px) | – | Used only for the rear corners' plan. |
| `vaz_2104.jpg` (webp, **no dimensions**, a stylised vector illustration) | 1700×1000 | side | **4.090 mm/px**. The drawn hubs (x 780 / 1370) are registered onto `BODY_05`'s drawn hubs 0.635 / 3.048 (wheelbase 2413 as drawn there). | 437.5 (tyre bottom) | See the checks below. |
| | | rear | x 3.99 mm/px (1620 over 406 px), y 4.09 mm/px | 917.5 | Centre x 302.75. |
| | | top | along = side; across 4.32 mm/px (1620 over 375 px) | – | Used only for the tail's plan width ratio. |

**Checks of the 2104 registration** (drawing → `BODY_05`):
- B-pillar shut line: 2090 against 2.09.
- Rear-door rear shut line at the belt: 2959 against 2.955–2.975.
- Roof: 1454 against 1.448.
- Gutter/rail: 1380–1388 against 1.375.
- Glass top: 1327 against 1.335.
- Rear bumper tip: **4124**. The passport length is 4115 and the 2105's is 4130.

**Registration of the 2102 drawing** (6.589 mm/px, isotropic in the side view):
- s = 3072 + (x − 862.5) × 6.589, so the drawn rear hub sits on `BODY_124`'s 3.072.
- The drawn front hub then lands at 0.645, against 0.648.
- The rear bumper tip lands at **4.103–4.110**, against 4059 + 45 = **4.104**.
- **One correction:** the drawing's rear door and C pillar sit 37 mm too far forward. Its shut line below the belt reads 2.980. The near-orthographic photo `p02_side_r` reads **3.020** at the rear hub, where its scale is good, and `BODY_124` has 3.017. Every C-pillar line is therefore taken from the drawing **+0.037**.
- The D pillar, the roof's end and the tail match the photo and the 1032 overhang without any correction.

**Heights, 2102.** The 2102 drawing's greenhouse is taller than the 2101 drawing's. The glass top is +25, the rail +20 and the roof +66, although the front doors and windscreen are the same parts.
- `BODY_124`'s greenhouse heights are kept: rail 1.275, roof 1.337.
- The estate's own heights are read **relative to its front door**. The belt delta along s is applied to `BODY_124`'s 0.862.
- Points between belt and rail map linearly: 843 → 0.859 and 1295 → 1.275.
- Points above the rail map 1295 → 1.275 and 1403 → 1.337.
- Below the belt, raw × 1.019.

### Photos (Wikimedia Commons, 3840 px renditions)

| Local | Commons title | Licence | Used for |
|---|---|---|---|
| `p02_side_r.jpg` | Lada 2102 en Tjumeno 02.jpg | CC BY-SA 4.0 | **2102 right side**, near-orthographic, yawed: rim widths are 325 px rear and 356 px front. A linear-scale model calibrated on the 2424 wheelbase is accurate near the rear hub (±10 mm) and ~50 mm short at the centre-line ends. Gives the C-pillar lines, rear door channel, quarter glass and D-pillar outline. Shows no fuel flap. |
| `p02_rear.jpg` | Moscow car show 2025-08-03 VAZ-2102 beige 01.jpg | CC0 | **2102 straight rear** (telephoto). x scale 0.988 mm/px from the overriders' ±510 (the 2101 bumper, [D] on both drawings). Heights relative to the blade top, × 0.935 so that the blade-top-to-belt-strip span equals the drawing's 0.40 m. |
| `p02_rq.jpg` | Lada 2102 en Tjumeno 03.jpg | CC BY-SA 4.0 | 2102 rear 3/4, right side: tailgate break, lamp colours |
| `p02_rear_esc.jpg` | 1979 Lada 1200 Airport Escort Service rear.jpg | CC BY 4.0 | 2102 lamp colours; a white lamp hung under the bumper's centre |
| `p02_fq.jpg` | Lada 2102 en Tjumeno 01.jpg | CC BY-SA 4.0 | context only |
| `p04_rear.jpg` | BRFK 140, Lada 2104, Heckansicht, 2021 Buda Burgviertel.jpg | CC BY-SA 3.0 | **2104 straight rear.** 0.871 mm/px from the 520 mm plate. The bumper reads 135 mm here and 135 on the drawing. |
| `p04_side_l.jpg` | ВАЗ 21043 1992 год левая сторона.JPG | CC0 | **2104 left side**, near-orthographic (rims 190 / 193 px). Gives the **fuel flap**, the window line, the D-pillar outline and the rail end. |
| `p04_side_r.jpg` | ВАЗ 21043 1992 год правая сторона.JPG | CC0 | 2104 right side: no flap |
| `p04_rq.jpg` | ВАЗ 21043 1992 год задняя сторона.JPG | CC0 | 2104 rear 3/4: lamp wrap, tailgate break |

Not used: `p02_side_red`, `p04_rear2` (Lada 2104 Kombi.jpg), `p04_rear_silver` (2011 VAZ 21041-30 silver rear.jpg), `p04_weiss`.

---

## 1. VAZ-2102 (124 shell, 2101 front)

### 1.1 Raw readings, side view (`vaz_2102.jpg`; s in `BODY_124`'s frame; y as drawn)

**Rear door and C pillar**

| Feature | Drawing, at r4 / at rail | Photo `p02_side_r` | Spec (s at belt / top) |
|---|---|---|---|
| Rear door drop glass from | as `BODY_124` 2.19 | – | 2.19 / 2.19 (`BODY_124`) |
| Vertical channel | 2673–2699 (x 802–806) +~30 | **2700** | 2.70 / 2.70 and 2.725 / 2.725 [D][P] |
| Fixed pane's rear edge (L1) | 2971 / 2812, +37 | 2982 (y 0.88) / 2863 (gutter) | 2.987 / 2.849 [D+P] |
| Door shut line (L2); vertical below the belt | 2980 below belt; line 3001 / 2841, +37 | **3020** below belt | 3.017 / 2.878 [P][D] |
| Quarter-glass front edge (L4) | 3067 / 2904, +37 | 3091 / ~2940 | 3.083 / 2.941 [D][P] |
| Quarter-glass rear edge | 3672 (glass bottom) / 3413 | 3732 / 3471 | **3.70 / 3.44** [D/P mean]. The drawing's D pillar is 2–3× the photo's (40–55 mm at the belt). |
| Body outline at the belt corner | 3793–3807 at y 903–876 | 3785–3800 | – |

Slopes of the pillar lines:
- **C pillar:** Δs/Δy = 0.365. The rear door's frame leans about 130 mm over the glass height. The 2101 sedan's leans 285 mm.
- **D pillar outline:** 0.67, which is 34°.

**Roof and tailgate**

| Feature | Readings | Spec |
|---|---|---|
| Roof top | 1403 (rows 45–47) flat to s 3.29, then rounding: 3.44 / 1.351, 3.52 / 1.298, 3.56 / 1.245 | roof ends where the outline crosses the rail height |
| **Rail end (last column's `top`)** | the outline crosses the rail height (raw 1.295) at **3.519**. Photo: 3.527 | **3.52** [D][P] |
| Tailgate glass (outline) | 3.596 / 1193 → 3.807 / 876 → 3.833 / 850. That is 35° from vertical (37.6° in the spec's heights). | – |
| **Knee** (fold where the glass meets the lower panel; the chrome belt strip runs across the tailgate there) | 3.84 / 845 raw. The glass itself ends ~50 mm higher [P]. | `rearKnee` { s: 3.84, y: 0.86 } [D] |
| Ledge | The lower panel's top stands **85 mm behind the glass base**: 3.925 / 824 against 3.840 / 850. One knee point cannot carry it. | [D] |
| Lower panel | 3.925 / 824 → 3.952 / 560 → 3.991 / 534 → 4.011 / 507. Raked ~12°. | – |
| **Tailgate bottom** (rear photo: 32–37 mm above the blade top) | y **0.49**, s ≈ 4.015 | `rearBase` 4.005, deck 0.49 [P][D] |
| Tail face plane | side 4.02–4.03 at y 0.43–0.48; plan 3.985–3.99 | last station 4.02 [D] |
| Bumper | blade 376–448 raw (0.383–0.457), tip 4.103–4.110 | – |
| Tail sill (valance bottom) | thick line 0.244–0.27 under the rear, s 3.39 → 4.02; rear photo 0.29–0.30 | 0.27 → 0.29 [D][P] |

**Belt and glass bottom along s** (raw delta from the front door's belt line, 843 at s 1.66):

| s | 2.5–2.9 | 3.05 | 3.12 | 3.25 | 3.45 | 3.65 | 3.78 |
|---|---|---|---|---|---|---|---|
| belt Δ (mm) | −6 | −9 | −16 | −19 | −24 | −30 | −32 |

The glass bottom runs parallel: 909 → 876 at the quarter.

**Widths at the tail:**
- Top view: full width (sides at rows 407 / 662) back to s ≈ 3.82.
- The corner rounds onto a face of half width **0.745–0.75** at s 3.99.
- Rear view: widest ±0.807 at y 0.51–0.54.

**Fuel flap: LEFT rear wing.**
- The drawing's left side: s 3.517–3.695, y 0.659–0.771 raw, which is 0.67–0.785.
- The right-side photos show none (`p02_side_r`, `p02_rq`).
- The generator cuts the flap on the right only (`body.ts`: `side < 0`).

### 1.2 Rear face (`p02_rear`, x at 0.988 mm/px; y from the blade top, 0.457 [D])

| Element | Numbers | Notes |
|---|---|---|
| Tail lamp | vertical, gothic-arched top, rounded bottom, chrome rim. Rim x ±(610..707); lens ±(618..699). Rim y = blade top **+0.118 .. +0.362** (0.575–0.82). | [P]; drawing ±(600..687), y 0.563–0.808 [D]. Wraps round the corner (side view: a band about 50 mm deep) [D][P]. |
| Cells, top → bottom | amber ~30 % (indicator); pale/clear ~38 %; deep red ~32 % (tail + stop) | [P] beige car. On the yellow and escort cars the middle cell is red and there is a separate white lamp under the bumper's centre [P]. The role of the middle cell is **[INFERENCE]** from its pale lens. |
| Tailgate outline | sides x ±(0.585..0.60), raked in slightly to the bottom; bottom edge 32–37 mm over the blade top | [P] |
| Belt strip | chrome strip across the whole tail at the knee, continuing the side's window line | [P] |
| Handle + plate lamp | chrome bar ±0.14, blade top +0.294 .. +0.363 (on the tailgate) | [P] |
| Plate | on the tailgate below the handle: ±0.14, y 0.57–0.74 (USSR 290×170) | [D] |
| Badge | "Жигули" script on the right, y ≈ 0.62 | [P] |
| Bumper | chrome blade 0.383–0.457 (74 mm); overriders at ±510, 46 wide, 191 tall, centre 20 mm below the blade's; the 2101's rear bumper | [D][P] |

### 1.3 Side trim

As the 2101 [P `p02_side_r`]:
- chrome sill strip between the arches;
- round amber repeater on the front wing;
- chrome pull handles;
- no waist moulding;
- chrome window frames.

What differs:
- the chrome belt strip continues across the tailgate (see §3);
- **fuel flap on the left** rear wing behind the rear door;
- no C-pillar vent grille.

### 1.4 Paste-ready

```ts
/**
 * VAZ-2102, the estate on the 124 shell (2101 front), in BODY_124's frame (2101
 * drawing + 0.045). vaz_2102.jpg side 6.589 mm/px from its 4059 dimension, registered
 * on the rear hub (3.072); its rear door/C pillar read 37 mm forward of the photo
 * p02_side_r and BODY_124 and are corrected by +0.037. Greenhouse heights are
 * BODY_124's; the estate's belt and tailgate are read relative to its front door.
 * Rear door: drop glass, vertical channel at 2.70, fixed pane, frame raked 2.987 → 2.849;
 * quarter glass 3.083 → 3.70; roof to 3.52 at the rail; tailgate glass raked 37° to a
 * knee at the belt strip (3.84, 0.86), lower panel to its bottom at 0.49.
 * Fuel flap on the LEFT rear wing (the generator cuts the right one).
 */
const BODY_2102: KitBody = {
  length: 4.104, // 4059 + 0.045 [D dimension; drawn tip 4.103–4.110]
  platform: 'classic',
  stations: [
    { s: 0.148, sill: 0.33, crease: 0.6, belt: 0.73, deck: 0.765, wSill: 0.745, wCrease: 0.775, wBelt: 0.765 }, // BODY_124
    { s: 0.35, sill: 0.28, crease: 0.62, belt: 0.775, deck: 0.81, wSill: 0.77, wCrease: 0.8, wBelt: 0.79 }, // BODY_124
    { s: 1.2, sill: 0.262, crease: 0.63, belt: 0.856, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 }, // BODY_124
    { s: 2.15, sill: 0.255, crease: 0.63, belt: 0.862, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 }, // BODY_124
    // C pillar foot: belt −8 [D Δ]; sill [D]; crease, widths, deck (unused) as BODY_124 [E]
    { s: 3.0, sill: 0.26, crease: 0.63, belt: 0.854, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    // behind the rear arch: belt −24 [D Δ]; rear body bottom 0.27 [D]; crease [E]
    { s: 3.45, sill: 0.27, crease: 0.625, belt: 0.838, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    // D-pillar foot: belt −32 [D Δ]; full width to 3.82 in plan, a touch in [D top]
    { s: 3.8, sill: 0.27, crease: 0.62, belt: 0.83, deck: 0.89, wSill: 0.77, wCrease: 0.8, wBelt: 0.79 },
    // rearBase: deck = tailgate bottom on the centre line 0.49 [P, 32–37 mm over the blade top];
    // corner rounding onto a ±0.75 face [D top]; sill [D/P]; crease [E]
    { s: 4.005, sill: 0.285, crease: 0.61, belt: 0.825, deck: 0.49, wSill: 0.735, wCrease: 0.765, wBelt: 0.755 },
    // tail face 4.02 [D side 4.02–4.03]; valance bottom 0.29 [P]; face half 0.745–0.75 [D top]
    { s: 4.02, sill: 0.29, crease: 0.61, belt: 0.82, deck: 0.49, wSill: 0.725, wCrease: 0.755, wBelt: 0.745 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 }, // BODY_124
  cabin: {
    columns: [
      { s: 1.2, top: 1.445, upper: 'body' }, // BODY_124 from here to 2.19
      { s: 1.235, top: 1.475, upper: 'door1' },
      { s: 1.26, top: 1.5, upper: 'door1', glass: 'vent' },
      { s: 1.55, top: 1.6, upper: 'door1', glass: 'drop' },
      { s: 2.095, top: 2.095, upper: 'door1' },
      { s: 2.125, top: 2.125, upper: 'body', lower: 'door1' },
      { s: 2.145, top: 2.145, upper: 'body', lower: 'door2' },
      { s: 2.165, top: 2.165, upper: 'door2' },
      { s: 2.19, top: 2.19, upper: 'door2', glass: 'drop' },
      // vertical channel x 802–806 (+~0.03), photo 2.700 [D][P]
      { s: 2.7, top: 2.7, upper: 'door2' },
      { s: 2.725, top: 2.725, upper: 'door2', glass: 'fixed' },
      // fixed pane's rear edge / door frame, raked [D +0.037; P 2.982 / 2.863]
      { s: 2.987, top: 2.849, upper: 'door2' },
      // door shut line, vertical below the belt at 3.017 [P 3.020, BODY_124 3.017]; top [D +0.037]
      { s: 3.017, top: 2.878, upper: 'body' },
      // quarter glass front edge [D +0.037; P 3.091 / ~2.94]
      { s: 3.083, top: 2.941, upper: 'body', glass: 'fixed' },
      // quarter glass rear edge → D pillar [D 3.672 / 3.413, P 3.732 / 3.471: mean]
      { s: 3.7, top: 3.44, upper: 'body' },
      // tailgate base (rearBase) / roof's rear end at the rail [D 3.519, P 3.527]
      { s: 4.005, top: 3.52 },
    ],
    rail: 1.275, // BODY_124
    railHalf: 0.62, // BODY_124
    crown: 0.04, // BODY_124
    railInset: 0.05, // BODY_124
    railRise: 0.022, // BODY_124
    glassBottom: 0.012, // BODY_124
    glassTop: 0.038, // BODY_124
    screenBottom: 0.025, // BODY_124
    screenHeader: 0.045, // BODY_124
    rearBottom: 0.025, // unused with a knee
    // tailgate glass top 1.233 raw (rear view) → 1.218; centre top rail + crown 1.315 [D]
    rearHeader: 0.1,
    // fold at the belt strip, glass base on the outline 3.833–3.84 / 0.845–0.85 raw [D];
    // the glass ends ~0.05 higher [P]; the lower panel's top stands 85 mm further back [D]
    rearKnee: { s: 3.84, y: 0.86 },
    pillar: 0.07, // BODY_124
  },
  wheels: { front: 0.648, rear: 3.072, radius: 0.288, width: 0.165, frontHalfTrack: 0.6825, rearHalfTrack: 0.6605, arch: 1.13 }, // BODY_124; tracks 1365/1321 [D]
  doorBottom: 0.29, // BODY_124
  bonnetFront: 0.17, // BODY_124
  // no bootEnd: the rear ring is a tailgate hinged at the roof
  // REAL FLAP IS ON THE LEFT: s 3.517–3.695, y 0.659–0.771 raw → 0.67–0.785 [D]
  flap: { s0: 3.517, s1: 3.695, y0: 0.67, y1: 0.785 },
};
// KIT_SPECS: vaz2102: { id: 'vaz2102', ...onBody(BODY_2102, -0.045, 4.059), look: LOOK_2102, cabinLayout: { ...CABIN_2101, bench: { from: 'rearBase', offset: -1.155 } } }

/** VAZ-2102: the 2101's face and side; vertical tail lamps on the corners, the 2101's rear bumper. */
const LOOK_2102: KitLook = {
  ...LOOK_2101,
  label: 'VAZ-2102',
  rear: {
    // the 2101's rear bumper [D][P]: blade 0.383–0.457 → centre 0.42 = tail sill 0.29 + 0.035 + 0.095;
    // overriders at x ±0.51 (half 0.78 − 0.27), 46 × 191, centre 20 mm below the blade's [P]
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.095,
      height: 0.074,
      depth: 0.038, // as LOOK_2101 [E]
      strip: null,
      overriders: { inset: 0.27, half: [0.023, 0.095], drop: 0.02, finish: 'chrome' },
    },
    items: [
      // chrome rim round each vertical lamp: x ±(0.610..0.707), blade top +0.118..+0.362 [P]
      { kind: 'frame', x: { from: { centre: 0.61 }, to: { centre: 0.707 } }, y: { from: ['bumperTop', 0.118], to: ['bumperTop', 0.362] }, width: 0.008, finish: 'chrome', proud: 0.012 },
      // lens ±(0.618..0.699): amber / pale / red, red = tail + stop [P]; middle cell's role [INFERENCE]
      { kind: 'cluster', x: { from: { centre: 0.618 }, to: { centre: 0.699 } }, y: { from: ['bumperTop', 0.126], to: ['bumperTop', 0.354] }, columns: [['blinker', 'reverse', 'tail', 'brake']] },
    ],
  },
};
```

---

## 2. VAZ-2104 ("05" shell, 2105/2107 front)

### 2.1 Raw readings, side view (`vaz_2104.jpg`, s = 3048 + (x − 1370) × 4.090; y as drawn)

**C pillar.** The rear door is the 2105's: its channel, fixed quarter pane and frame read within 15–45 mm of `BODY_05`.

| Feature | Drawing, at r4 0.905 / at rail 1.375 | Photo `p04_side_l` | Spec |
|---|---|---|---|
| Channel | 2664–2697 | – | `BODY_05` 2.68 / 2.70 |
| Fixed pane's rear edge (L1) | 2933 / 2729 | – | `BODY_05` 2.955 / 2.71 |
| Door shut line (L2) | 2959 / 2755 | shut below belt 2962 | `BODY_05` 2.975 / 2.73 |
| Quarter glass front edge (L4, from its top corner at row 118) | **3077 / 2837** | – | 3.075 / 2.835 [D] |
| Quarter glass rear edge | 3604 / 3317 (visible-glass line) | 3640 at the glass bottom | **3.63 / 3.33** [D/P] |
| Body outline at glass bottom | 3713 | 3733 | – |

**Roof and tailgate**

| Feature | Readings | Spec |
|---|---|---|
| Roof top | 1454 at the front door, 1430 over the quarter: the drawing drops it ~20 mm rearward. Rounding from s 3.32 (1.397) through 3.39 / 1.38 and 3.45 / 1.348 | the spec roof is flat |
| **Rail end (`top`)** | outline at rail height (row 101.3): **3.40**; photo row 790 (y 1.39): 3.407 | 3.40 [D][P] |
| Tailgate glass (outline) | 3.42 / 1.364 → 3.69 / 0.98 → 3.80 / 0.85, about 37° (31° on the inner thick line) | – |
| **Knee** (fold at the lip under the glass; the rear wiper's motor sits there) | 3.80–3.835 / 0.84–0.86 | `rearKnee` { s: 3.80, y: 0.85 } [D] |
| Glass bottom on the centre line | rear photo 0.928; rear drawing 0.89–0.91 | 6–8 cm of painted frame above the fold [P][D]; not representable |
| Lower panel / lamp side | 3.91 / 0.783 → 3.944 / 0.685 → 3.981 / 0.611 → 3.993 / 0.513, ~19° | – |
| **Tailgate bottom** | rear photo: 35 mm over the bumper top, **0.52**; rear drawing row 790 → 0.521 | `rearBase` 3.995, deck 0.52 [P][D] |
| Bumper | side 0.35–0.485, end cap from s 3.776, tip **4.124**; rear photo 135 mm tall | [D][P] |
| Tail sill | under the bumper, hidden; rear body bottom behind the arch 0.34 [D]; tail 0.33 | [D/E] |

**Belt.**
- The drawing's three belt lines descend 25–60 mm towards the tail.
- The photo `p04_side_l` shows the window line level. Allowing for the 1° camera roll it rises ~20 mm; read as ±20 mm.
- I take the photo: belt 0.885 → 0.87 at the tail corner [P]. The drawing's drop is listed but not used.

**Crease [D]:**

| s | 2.15 | 2.56 | 3.17 | 3.38 | 3.58 | 3.78 | 3.85 |
|---|---|---|---|---|---|---|---|
| y | 0.771 | 0.771 | 0.755 | 0.751 | 0.742 | 0.730 | 0.701 |

**Plan.** The top view keeps 98–100 % of the full width to the tail (375 → 371 px at s 4.03): a boxy tail.

**Fuel flap: LEFT rear wing** (`p04_side_l`, wheelbase scale, heights × 0.95 to fit the glass bottom 0.955):
- s 3.506–3.692, y 0.745–0.85 [P];
- no flap on the right-side photo;
- the drawing (left side) shows none.

### 2.2 Rear face (`p04_rear`, 0.871 mm/px from the plate, centre from the lamps; y from the bumper top 0.485 [D])

| Element | Numbers | Notes |
|---|---|---|
| Tail lamp | vertical, at the corners, wrapping round onto the side (`p04_rq`). Lens x ±(0.507..0.700), bumper top **+0.088 .. +0.357** (0.573–0.842). Frame ±(0.499..0.708), +0.083 .. +0.370. | [P]. Drawing: frame ±(0.470..0.697), y 0.554–0.820 [D]. |
| Cells | Top row across the full width: red, 27 % of the height. Below, two columns. **Outer** (~47 % of the width): amber 43 % over white 30 %. **Inner:** red down to the bottom. | colours [P]; roles: top = stop, inner lower = tail, white = reverse **[INFERENCE]** |
| Tailgate lower panel | sides at ±0.515–0.523, hugging the lamps' inner edges; bottom edge 35 mm over the bumper top (0.52) | [P]; drawing ±0.467 [D] |
| Plate | EU plate on the tailgate: x −8 mm off centre, y +0.172 .. +0.281 (0.657–0.766); drawing: a recessed plate panel | [P][D] |
| Badge / handle | black "LADA 2104" bar ±0.165, +0.349 .. +0.389 (0.834–0.874), just below the glass | [P] |
| Rear wiper | on the glass, parked across the lower left | [P][D] |
| Bumper (21043) | 0.35–0.485, 135 mm. Grey upper face 48 mm, black band 48 mm, grey lower lip 22 mm. Black end caps wrapping to s 3.776. | [D][P]. Early 2104s had the 2105's aluminium bumper. |

### 2.3 Side trim

As the 2105:
- black flush handles [P];
- rectangular amber repeater on the front wing [P];
- no waist moulding [P];
- black sill strip [E as 2105; not seen on the black car].

Estate-specific:
- **fuel flap on the left** rear wing;
- no C-pillar louvres (the sedan's vent is gone; quarter glass instead) [D][P];
- the window line continues level across the quarter glass to the D pillar.

### 2.4 Paste-ready

```ts
/**
 * VAZ-2104, the estate on the "05" shell (2105/2107 front), in BODY_05's frame.
 * vaz_2104.jpg (undimensioned illustration), side 4.090 mm/px with its drawn hubs on
 * BODY_05's 0.635 / 3.048: B pillar 2.090, rear door 2.959, roof 1.454, rail 1.38, tip
 * 4.124 (passport 4115). The rear door is the 2105's. Quarter glass 3.075 → 3.63, roof
 * to 3.40 at the rail, tailgate glass raked ~37° to a fold at (3.80, 0.85), lower panel
 * to its bottom at 0.52 between the corner lamps (p04_rear, 0.871 mm/px from the plate).
 * Fuel flap on the LEFT rear wing (the generator cuts the right one).
 */
const BODY_2104: KitBody = {
  length: 4.12, // [D 4.124; passport 4.115]
  platform: 'classic',
  stations: [
    { s: 0.05, sill: 0.36, crease: 0.76, belt: 0.795, deck: 0.82, wSill: 0.74, wCrease: 0.755, wBelt: 0.745 }, // BODY_05
    { s: 0.35, sill: 0.36, crease: 0.763, belt: 0.868, deck: 0.913, wSill: 0.77, wCrease: 0.79, wBelt: 0.77 }, // BODY_05
    { s: 0.9, sill: 0.265, crease: 0.766, belt: 0.878, deck: 0.968, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 }, // BODY_05
    { s: 1.0, sill: 0.268, crease: 0.766, belt: 0.88, deck: 1.0, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 }, // BODY_05
    { s: 2.1, sill: 0.258, crease: 0.767, belt: 0.885, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 }, // BODY_05
    // C pillar foot: crease [D]; belt level [P]; deck unused
    { s: 2.975, sill: 0.26, crease: 0.765, belt: 0.884, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // over the rear arch's back: crease 0.751 [D]
    { s: 3.38, sill: 0.262, crease: 0.75, belt: 0.882, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // behind the arch: body bottom 0.34 [D]; crease 0.730 [D]; plan width ~99 % [D top]
    { s: 3.8, sill: 0.34, crease: 0.73, belt: 0.875, deck: 0.92, wSill: 0.77, wCrease: 0.805, wBelt: 0.775 },
    // rearBase: deck = tailgate bottom 0.52 on the centre line [P][D]; crease 0.705 [D];
    // tail sill hidden by the bumper [E]; widths [D top, corners E as 2105]
    { s: 3.995, sill: 0.33, crease: 0.705, belt: 0.87, deck: 0.52, wSill: 0.76, wCrease: 0.795, wBelt: 0.765 },
    // tail face [D 3.993–3.997 at the lower panel]
    { s: 4.005, sill: 0.33, crease: 0.7, belt: 0.87, deck: 0.52, wSill: 0.755, wCrease: 0.79, wBelt: 0.76 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 }, // BODY_05
  cabin: {
    columns: [
      { s: 1.0, top: 1.41, upper: 'body' }, // BODY_05 from here to 2.975
      { s: 1.17, top: 1.44, upper: 'door1' },
      { s: 1.22, top: 1.48, upper: 'door1', glass: 'drop' },
      { s: 2.055, top: 2.062, upper: 'door1' },
      { s: 2.075, top: 2.08, upper: 'body', lower: 'door1' },
      { s: 2.09, top: 2.095, upper: 'body', lower: 'door2' },
      { s: 2.11, top: 2.112, upper: 'door2' },
      { s: 2.127, top: 2.127, upper: 'door2', glass: 'drop' },
      { s: 2.68, top: 2.68, upper: 'door2' },
      { s: 2.7, top: 2.7, upper: 'door2', glass: 'fixed' },
      { s: 2.955, top: 2.71, upper: 'door2' }, // [D 2.933–2.959 / 2.729–2.755]
      { s: 2.975, top: 2.73, upper: 'body' },
      // quarter glass front edge (L4) [D]
      { s: 3.075, top: 2.835, upper: 'body', glass: 'fixed' },
      // quarter glass rear edge → D pillar [D 3.604 / 3.317, P 3.640]
      { s: 3.63, top: 3.33, upper: 'body' },
      // tailgate base (rearBase) / roof's rear end at the rail [D 3.40, P 3.407]
      { s: 3.995, top: 3.4 },
    ],
    rail: 1.375, // BODY_05
    railHalf: 0.62, // BODY_05
    crown: 0.048, // BODY_05
    railInset: 0.05, // BODY_05
    railRise: 0.025, // BODY_05
    glassBottom: 0.05, // BODY_05
    glassTop: 0.04, // BODY_05
    screenBottom: 0.025, // BODY_05
    screenHeader: 0.045, // BODY_05
    rearBottom: 0.025, // unused with a knee
    // tailgate glass top 1.30–1.33 (rear view) against rail + crown 1.423 [D]
    rearHeader: 0.11,
    // fold at the lip under the glass [D]; the glass itself ends at 0.89–0.93 [D rear][P]
    rearKnee: { s: 3.8, y: 0.85 },
    pillar: 0.07, // BODY_05
  },
  wheels: { front: 0.635, rear: 3.048, radius: 0.288, width: 0.165, frontHalfTrack: 0.6825, rearHalfTrack: 0.6605, arch: 1.15 }, // BODY_05
  doorBottom: 0.365, // BODY_05
  bonnetFront: 0.06, // BODY_05 (2105 face)
  // no bootEnd: the rear ring is a tailgate hinged at the roof
  // REAL FLAP IS ON THE LEFT [P p04_side_l]
  flap: { s0: 3.51, s1: 3.69, y0: 0.745, y1: 0.85 },
};
// KIT_SPECS: vaz2104: { id: 'vaz2104', ...BODY_2104, look: LOOK_2104, cabinLayout: { ...CABIN_2105, bench: { from: 'rearBase', offset: -1.115 } } }

/** VAZ-2104: the 2105's face and side; vertical corner lamps, the 21043's plastic rear bumper. */
const LOOK_2104: KitLook = {
  ...LOOK_2105,
  label: 'VAZ-2104',
  rear: {
    // 0.35–0.485 [D][P] → centre 0.4175 = tail sill 0.33 + 0.035 + 0.0525; grey face with a
    // 48 mm black band (the generator's strip is 24 mm) and black end caps [P]
    bumper: { kind: 'blade', finish: 'alloy', lift: 0.0525, height: 0.135, depth: 0.05, strip: 'rubber', ends: 'black', overriders: null },
    items: [
      // lens ±(0.507..0.700), bumper top +0.088..+0.357 [P]; outer: stop / amber / white, inner: stop / red / red
      // [P colours, roles INFERENCE]; equal thirds against 27/43/30 %
      {
        kind: 'cluster',
        x: { from: { centre: 0.507 }, to: { centre: 0.7 } },
        y: { from: ['bumperTop', 0.088], to: ['bumperTop', 0.357] },
        columns: [['brake', 'blinker', 'reverse'], ['brake', 'tail', 'tail']],
      },
    ],
  },
};
```

---

## 3. What the generator cannot take as it stands

These are measured facts. Each one bends the literals above; nothing in the code was changed.

1. **The tailgate's lower edge.** Without `bootEnd` the rear ring's bottom is `deckY(rearBase, x)`, a parabola from the centre deck up to the shoulder edge `r4`.
   - The real tailgates have a **flat bottom** (2102: 0.49; 2104: 0.52) with **vertical sides** at ±0.59 (2102) and ±0.515 (2104), between body-side corners that carry the lamps.
   - With the literals, the bottom edge reaches about 0.74 at x 0.6 (2102) and 0.70 at x 0.507 (2104), so the lamps' upper inner corners overlap the tailgate's corners.
   - A flat-bottomed tailgate of half width `h` would need a generator change.
2. **The D pillar's side line.** The last column runs straight from (`rearBase`, belt) to (`top`, rail). The real outline runs from the roof down the raked glass to the **knee** (2102: 3.84; 2104: 3.80), then down the near-vertical lower panel.
   - With `rearBase` at the tailgate's bottom (4.005 / 3.995), the side's D-pillar line passes **≈ 0.10–0.15 m behind** the real outline at mid height. The D-pillar strip is 0.30–0.37 m long at the belt.
   - **Alternative:** put `rearBase` at the knee (2102: 3.84 with deck 0.86; 2104: 3.80 with deck 0.85) and drop `rearKnee`. The side then matches, but the lower panel becomes body and no longer opens with the tailgate.
3. **The 2102's ledge.** The lower panel's top stands 85 mm behind the glass base. One `rearKnee` point turns it into a 25° raked panel. The real panel is ~12° under a ledge.
4. **Painted band above the fold.** On both cars the glass ends 5–8 cm above the fold (the 2102's chrome belt strip; the 2104's lip and wiper motor). The knee makes the glass reach down to the fold.
5. **Items on the tailgate.** The face items are laid on the tail station's plane. The tailgate's lower panel is raked back from it by up to 0.15–0.2 m at belt height. These are left out of the paste-ready looks:
   - 2102: chrome handle ±0.14 at bumper top +0.294..+0.363, plate, and the belt strip across the tail at the knee;
   - 2104: black badge/handle ±0.165 at +0.349..+0.389, plate.

   They would need an item placed on the tailgate.
6. **Fuel flap side.** Both estates have the filler on the **left** rear wing. `buildShell` cuts it on the right (`side < 0`), and `buildSaloonBoot`'s tank neck also assumes the right.
7. **Interior and boot (hatch path).**
   - `LAYOUTS.classic` puts the rear bench at `rearBase − 0.45`, which is 3.55 on the estates. The sedans' 2.85 / 2.88 is kept by `bench: { from: 'rearBase', offset: -1.155 }` (2102) and `-1.115` (2104), as written in the `KIT_SPECS` lines.
   - `buildHatchBoot` puts the load floor at `deck(rearBase) − HATCH_SILL_DROP (0.28)`. That gives 0.21 / 0.24, below the sills. The real load floor is at about the tailgate sill (0.49 / 0.52, minus a few cm).
8. **`FACTORY_GEOMETRY`.** The loader fits the kit body to the passport size:
   - 2102: 4059 × 1611 × 1458 (1400 laden, as on the drawing);
   - 2104: 4115 × 1620 × 1443.

   The drawn heights above (the families' greenhouses) stay as drawn and grow with that fit, as for the sedans.

## 4. Gaps

- **2102 drawing.** At 6.6 mm/px it is coarse, and its views have different scales (side 6.59, rear 6.70 × 6.44, top 6.67 × 6.25).
  - Its C pillar is 37 mm forward, corrected from the photo.
  - Its D pillar is 2–3× as wide as the photo's; the mean of the two is used.
- **2104 drawing.** It is an undimensioned illustration. Its registration rests on the drawn hubs and was checked on five shared features. Its belt drop is contradicted by the side photo and was not used.
- **Tail-lamp roles.** The cells' colours are measured. Which red cell is tail and which is stop is [INFERENCE] on both cars, as is the 2102's pale middle cell.
- **Not measured:**
  - the corners' plan radii beyond the top views' 2102 face ±0.745 and the 2104's boxy 98 %;
  - the lamps' wrap depth onto the sides (2102 ≈ 50 mm [D]; 2104 visible in `p04_rq`, not measured);
  - the tailgate hinge line;
  - the rear wiper's size.

## Arches to the drawings (2026-10-27)

Arch openings `[top, ahead, behind]` over the hub (m), refs → built before → after (kit-drawing; STATUS.md table, HISTORY):

- **vaz2102**: front 0.34 / 0.3 / 0.34: 0.326 / 0.326 / 0.326 → 0.326 / 0.326 / 0.326; rear 0.25 / 0.32 / 0.31: 0.326 / 0.326 / 0.326 → 0.256 / 0.326 / 0.326. BODY_2102: `rearArchRise` 0.885.
- **vaz2104**: front 0.335 / 0.33 / 0.35: 0.332 / open / 0.332 → 0.332 / 0.33 / 0.332; rear 0.28 / 0.36 / 0.36: 0.332 / 0.332 / 0.332 → 0.28 / 0.36 / 0.358. BODY_2104: `rearArch` 1.25, `rearArchRise` 0.97.
