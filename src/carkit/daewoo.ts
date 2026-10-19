/**
 * The Daewoo Nexia (N100, 1995–2008, UzDaewoo and Korea), the four-door saloon on the Opel
 * Kadett E's platform with its own nose and tail; the car built is the early base GL of
 * 1995–2002: dark grey plastic bumpers with a thin bright strip, no lid garnish, no fog
 * lamps. A transverse engine in front driving the front wheels. Numbers and sources in
 * measurements-nexia.md.
 *
 * Measured on 3dcar.ru's dimensioned four-view `daewoo_nexia.jpg` (1500 × 1100; dimension
 * lines 4474 / 2520 / 1663 / 1362 / 1400 / 1406): side view 4.851 mm/px from the drawn
 * hubs (x 717.5 / 1237, 2520), `s = 0.915 + (x − 717.5) × 0.004851`; heights
 * `y = (384.4 − py) × 0.004851`, the drawn ground line (py 373.5) lowered 53 mm, since the
 * drawing stands the body on tyres drawn 0.252 in radius with their hubs at 0.235 while the
 * car runs 175/70 R13 (0.288): the body is hung from the hubs, not from the drawn ground
 * (the roof comes out 1.411 against the passport's 1393, the loader fits the 1 %). The
 * drawn tips read 4.529 at the hub scale against the factory 4482; the 47 mm come off the
 * bumpers as the overhangs split it (21 front, 26 rear). The front and rear views are
 * squashed across (4.52 / 4.636 mm/px from the drawn tracks, 4.76 up from the height line)
 * and read at their own scales. Wikimedia Commons photos for colours, lamps, the strips,
 * the flap side and the dash.
 *
 * A low rectangular face: head lamps flush under the bonnet's lip, the amber indicators at
 * their outer ends wrapping round the corners, a black slatted grille between them, a deep
 * plastic bumper with a bright strip and four intakes; a long bonnet rising evenly to the
 * screen; the wing's crease from the lamps' top to the door, on the doors the belt itself;
 * four doors under a slim A pillar, a small fixed quarter glass and a wide C pillar under
 * a long raked back light; a short boot whose lid comes down between corner tail lamps
 * (amber and white over red) to the bumper's top.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * Daewoo Nexia: overhangs 915 / 1047 over a 2520 wheelbase. The face at s 0.11 (lamps
 * 0.615–0.70 under the bonnet's lip at 0.73); the bonnet rising to 0.93 at the cowl (s
 * 1.315); the A pillar raked 1.52 m of s per m to the rail (1.348) at 1.92; roof 1.411,
 * falling from s 2.9 to the back light's top at 3.33; the back light down to its foot at
 * 3.96, 1.03 on the centre line; the boot 1.0 at its trailing edge (4.30) and down the tail
 * face between the lamps to the bumper's top. Sill 0.235, door bottoms 0.303, belt 0.866 at
 * the A pillar rising to 0.878 at the C pillar. Front door 1.46 to 2.44 below the belt,
 * rear door 2.44 to 3.35 reaching over the rear arch; quarter glass 3.375 to 3.69.
 */
export const BODY_NEXIA: KitBody = {
  length: 4.482, // [F drom.ru, ru.wikipedia]; drawn tips 4.529 at the hub scale
  platform: 'samara',
  stations: [
    // The face [D side x 550–553, the lamps' foot on the bumper's top]: its corners round in
    // plan (±0.648 at s 0.12, ±0.694 at 0.17, ±0.73 at 0.27, ±0.754 at 0.37, ±0.771 at 0.47,
    // ±0.788 at 0.56, ±0.80 at 0.66, ±0.822 at 0.86 [D plan]). The bonnet's centre line [D
    // side, the outline: 0.729 at s 0.15, 0.782 at 0.25, 0.812 at 0.35, 0.841 at 0.44, 0.87 at
    // 0.59, 0.89 at 0.73, 0.904 at 0.83, 0.924 at 1.02, the cowl 0.943 at 1.315 under the
    // wipers]; the wings' top line 0.02–0.04 under it. Its crown over the wings' top grows
    // evenly from 0.01 at the lip to 0.047 at the cowl (HISTORY: a crown that grows and
    // shrinks twists the bonnet): `belt` = deck − shoulder rise − crown.
    { s: 0.11, sill: 0.3, crease: 0.6, belt: 0.705, deck: 0.73, wSill: 0.62, wCrease: 0.645, wBelt: 0.625 },
    { s: 0.2, sill: 0.3, crease: 0.6, belt: 0.737, deck: 0.765, wSill: 0.68, wCrease: 0.705, wBelt: 0.685 },
    // The indicator's end on the wing [D side x 612].
    { s: 0.3, sill: 0.3, crease: 0.6, belt: 0.768, deck: 0.8, wSill: 0.715, wCrease: 0.738, wBelt: 0.72 },
    { s: 0.45, sill: 0.29, crease: 0.6, belt: 0.806, deck: 0.843, wSill: 0.745, wCrease: 0.768, wBelt: 0.75 },
    { s: 0.6, sill: 0.27, crease: 0.6, belt: 0.832, deck: 0.872, wSill: 0.77, wCrease: 0.79, wBelt: 0.772 },
    { s: 0.915, sill: 0.25, crease: 0.6, belt: 0.857, deck: 0.905, wSill: 0.8, wCrease: 0.825, wBelt: 0.765 },
    // The cowl: the screen's outer line meets the bonnet here [D side (800, 190)]. The flank
    // ±0.834 at 0.59, ±0.809 at 0.78, ±0.796 at 0.82, ±0.766 at 0.87 [D front].
    { s: 1.315, sill: 0.235, crease: 0.6, belt: 0.868, deck: 0.93, wSill: 0.805, wCrease: 0.832, wBelt: 0.765 },
    // The belt under the side glass [D side: the glass's foot 0.875 at s 1.8, 0.88 at 2.28,
    // 0.894 at 2.77, 0.899 at 3.16, less the shoulder]; sill 0.235 between the arches [D
    // side y 336].
    { s: 2.44, sill: 0.235, crease: 0.6, belt: 0.872, deck: 0.89, wSill: 0.805, wCrease: 0.832, wBelt: 0.765 },
    { s: 3.36, sill: 0.235, crease: 0.6, belt: 0.878, deck: 0.9, wSill: 0.805, wCrease: 0.832, wBelt: 0.765 },
    // The quarter glass's rear corner; behind it the C pillar's foot rises to the deck's edge.
    { s: 3.69, sill: 0.27, crease: 0.6, belt: 0.895, deck: 0.92, wSill: 0.805, wCrease: 0.83, wBelt: 0.765 },
    // rearBase: the back light's foot, 1.03 on the centre line [D side 3.95–4.0]; the boot's
    // edge 0.99 at s 4.03, 0.982 at 4.18, 0.958 at 4.32, its centre 1.025 / 1.016 / 0.996 [D
    // side]; the tail rounding in, ±0.81 at 3.91, ±0.791 at 4.10, ±0.783 at 4.20, ±0.769 at
    // 4.30 [D plan]. Not 3.95: the rear bench's riser would end in the silencer's rear face's
    // plane (both at 3.935, interior.ts `bench`, bay.ts `samaraChassis`).
    // The belt from the C pillar's foot back: ±0.748 at 0.93–0.954, ±0.743 at 0.978 [D rear,
    // the pillar's outer line onto the shoulder], so it runs in from the cabin's ±0.765,
    // never out: 0.765 / 0.755 / 0.745 at 3.96 / 4.15 / 4.30 (was 0.78 / 0.77 / 0.755: out
    // past the cabin's belt and back, an s-bend at 3.69–3.96). Held at the cabin's 0.765 at
    // rearBase, 2 cm over the rear view: narrower, the rear shelf's trim (sized to the side
    // there) leaves a sight line from the driver's eye into the boot and the tail lamps' rims
    // (kit-zfight).
    { s: 3.96, sill: 0.32, crease: 0.61, belt: 0.975, deck: 1.03, wSill: 0.785, wCrease: 0.808, wBelt: 0.765 },
    { s: 4.15, sill: 0.33, crease: 0.62, belt: 0.967, deck: 1.018, wSill: 0.77, wCrease: 0.79, wBelt: 0.755 },
    // The lid's trailing edge, then the tail face [D side x 1428]: the lid comes down between
    // the corner lamps (topped at 0.905) to the bumper's top, cut at ±0.39 (the lamps' inner
    // edges lean from ±0.367 at their foot to ±0.475 at their top [D rear]).
    { s: 4.3, sill: 0.33, crease: 0.62, belt: 0.945, deck: 0.998, wSill: 0.75, wCrease: 0.77, wBelt: 0.745 },
    { s: 4.36, sill: 0.33, crease: 0.62, belt: 0.905, deck: 0.645, notch: 0.39, wSill: 0.735, wCrease: 0.755, wBelt: 0.74 },
  ],
  // Side glass foot ±0.765 at the belt: the A pillar's outer line in the front view, ±0.731
  // at 0.967 leaning in 0.42 m per m, over a flank at ±0.795 there.
  shoulder: { inset: 0.03, rise: 0.015 },
  cabin: {
    columns: [
      // The screen's outer line from the cowl (1.315, 0.943) to the roof (1.948, 1.355) [D
      // side, rows: 1.383 at 0.992, 1.597 at 1.137, 1.861 at 1.307]: 1.92 at the rail.
      { s: 1.315, top: 1.92, upper: 'body' },
      // A slim pillar (HISTORY: the AZLK's and Volgas' A pillars): the door's frame 0.045
      // behind the pillar's line and the glass 0.035 behind that, all parallel; the drawn
      // pillar's face is 0.12 of s and the frame another 0.09, with the mirror's black sail
      // under it. Below the belt the wing reaches back to the door's shut line at 1.46 [D
      // side x 826–833].
      { s: 1.36, top: 1.965, upper: 'door1', lower: 'body' },
      { s: 1.395, top: 2.0, upper: 'door1', glass: 'drop', lower: 'body' },
      { s: 1.46, top: 2.065, upper: 'door1', glass: 'drop' },
      // The B pillar [D: the front glass ends at 2.397 at the belt, 2.462 at the top; the
      // shut line 2.433–2.44 below the belt; the rear glass from 2.511 / 2.564].
      { s: 2.4, top: 2.465, upper: 'door1' },
      { s: 2.425, top: 2.49, upper: 'body', lower: 'door1' },
      { s: 2.44, top: 2.505, upper: 'body', lower: 'door2' },
      { s: 2.485, top: 2.54, upper: 'door2' },
      { s: 2.51, top: 2.565, upper: 'door2', glass: 'drop' },
      // The rear glass's rear edge leaning forward to the top [D: 3.316 at 0.919, 3.231 at
      // 1.137, 3.2 at 1.307]: 3.33 at the belt, 3.17 at the rail; the frame behind it to the
      // shut line, 3.345–3.36 below the belt down to the arch [D].
      { s: 3.33, top: 3.17, upper: 'door2' },
      { s: 3.35, top: 3.19, upper: 'body', lower: 'door2' },
      { s: 3.36, top: 3.2, upper: 'body' },
      // The fixed quarter glass in the body, nearly a triangle: its front edge along the
      // door's frame, its apex under the rail at 3.24, its foot to 3.69 [D].
      { s: 3.375, top: 3.215, upper: 'body', glass: 'fixed' },
      // The wide C pillar to the back light.
      { s: 3.69, top: 3.25, upper: 'body' },
      // rearBase; the back light's top at the rail [D side: the roof's line meets it at s
      // 3.30–3.35, 1.33–1.35].
      { s: 3.96, top: 3.33 },
    ],
    rail: 1.348, // the door frames' top 1.348 [D side y 106.5]
    railHalf: 0.56, // the A pillar's outer line at the rail [D front]
    crown: 0.043, // roof 1.411 [D side y 93.5] = rail + rise + crown
    railInset: 0.04, // the roof's edge ±0.52 at 1.396 [D front]
    railRise: 0.02,
    // The roof rounding up from the screen [D side, the outline: 1.36 at s 1.95, 1.38 at
    // 2.04, 1.404 at 2.28, 1.411 from 2.5], then falling ever more steeply into the back
    // light [1.399 at 3.01, 1.386 at 3.16, 1.361 at 3.26].
    roofDrop: [[1.92, 0.015], [2.05, 0.009], [2.25, 0.003], [2.45, 0], [2.9, 0], [3.05, 0.008], [3.2, 0.02], [3.33, 0.035]],
    glassBottom: 0.01, // glass foot 0.875–0.899 [D side]
    glassTop: 0.03, // glass top 1.317 [D side y 113]
    screenBottom: 0.03, // [E as the Samaras]
    screenHeader: 0.045, // [E as the Samaras]
    wiperBlade: 0.48, // [E: the pair's 500 / 450 mm blades (parts catalogues), one length here]
    rearBottom: 0.025, // [E as the Samaras]
    rearHeader: 0.04, // [E]
    pillar: 0.07, // [E as the Samaras]
  },
  wheels: {
    front: 0.915, // [E: the factory overhangs not found; the drawn 936 / 1072 cut to 4482 in proportion]
    rear: 3.435, // wheelbase 2520 [F]
    radius: 0.288, // 175/70 R13 [F manual]
    width: 0.175, // [F]
    frontHalfTrack: 0.7, // 1400 [F drom.ru; D front]
    rearHalfTrack: 0.703, // 1406 [F drom.ru; D rear]
    // Front: the lip's top 0.667 over the ground, 0.379 over the hub; ±0.356 at the hub's
    // height [D side] → 1.28.
    arch: 1.28,
    // Rear: wider than tall, ±0.361 at the hub's height, its top 0.594, 0.306 over the hub
    // [D side]: 1.25 wide, 1.06 high.
    rearArch: 1.25,
    rearArchRise: 1.06,
  },
  // [D side y 322: 0.303], over the hub, so the rear door's foot meets its arch cut-out
  // above the arch's front point.
  doorBottom: 0.303,
  bonnetFront: 0.11,
  // The lid comes down the tail face between the corner lamps.
  bootEnd: 4.36,
  // On the right rear wing behind the rear door [P "1997 Daewoo Nexia dark green rear"];
  // round on the car.
  flap: { s0: 3.55, s1: 3.67, y0: 0.7, y1: 0.79, side: 'right' },
};

/**
 * The early base Nexia GL (the drawing's front and rear views; Commons photos "2000 Daewoo
 * Nexia dark blue front", "2000 Daewoo Nexia light green front", "1997 Daewoo Nexia dark
 * green rear", "2003 Daewoo Nexia golden yellow rear", "Daewoo Nexia 01", "Daewoo Nexia
 * interior"): head lamps with the amber indicator at their outer ends wrapping round the
 * corners, a black slatted grille between them; dark grey plastic bumpers with a thin
 * bright strip in line with the strip along the doors; tail lamps on the corners, amber
 * and white over red, wrapping a little onto the wings; black handles and mirrors; an
 * amber repeater on each front wing.
 */
export const LOOK_NEXIA: KitLook = {
  label: 'Daewoo Nexia',
  upholstery: 0x56595f, // grey cloth [P "Astra F (MK3) dashboard in Daewoo Nexia"]
  dash: 0x2a2b2e, // dark grey plastic [P "Daewoo Nexia interior"]
  headrests: true, // [P]
  brightwork: 'black', // [P handles, mirrors]
  sill: null, // painted [P]
  // The thin bright strip along both doors in line with the bumpers' [D side y 273: 0.54;
  // P dark blue front, light green front].
  waist: { y: 0.54, height: 0.015, finish: 'chrome' },
  // Amber, on the wing over the arch's back, under the crease [P dark blue front, light
  // green front; E: not on the drawing].
  repeater: { s0: 1.22, s1: 1.27, y0: 0.745, y1: 0.77 },
  // The wing's crease from the lamps' top to the front door [D side: 0.715 at s 0.35, 0.764
  // at 0.59, 0.793 at 0.83, 0.818 at 1.22]; on the doors it is the belt itself.
  featureLine: { points: [[0.33, 0.718], [0.6, 0.764], [0.9, 0.795], [1.2, 0.818], [1.44, 0.825]], height: 0.012 },
  cornerLamps: [
    // Head lamp and indicator as one unit [D front, zoomed: the top under the bonnet's lip,
    // py 228 at the outer end sagging to 231 at the inner; the foot py 253; the inner end
    // leaning out to the top, ±0.28 to ±0.325, along the grille's slanted side; the indicator
    // from ±0.615 (x 97) round the corner. D side: the indicator a dome on the wing, its foot
    // to s 0.40 (x 612), its top 0.72 at s 0.30 (x 595) curving down to the foot. P "2000
    // Daewoo Nexia dark blue front", "Daewoo Nexia 1996 on dirtroad": the top line one gentle
    // arch over the head lamp, rounding down over the indicator into the wing; the foot
    // sweeping up towards the corner as the face rounds back in plan]. The kit's face is
    // flat to the corner, so that sweep is drawn in the foot: 0.615 at the inner end, 0.63 at
    // the corner, 0.645 at the dome's end. The inner end leans out along the trapezoid
    // grille's side, 13–15 mm off its frame (±0.27 at the foot to ±0.325 at the top), and
    // the top falls a little towards it (0.70), so the lamp narrows to an acute inner top
    // corner: the car's "squint". The top kept inside the face's outline (0.705 at the inner
    // end, the shoulder at the outer) and under the wing's crease; the foot clear of the
    // bumper's top (0.60).
    // Owner's review 2 (2026-10-18, photo of the real car's lamp): the indicator is a short
    // amber end of the same lens (from ±0.56), wrapping only to s 0.215 and rounding down
    // there, not a long dome along the wing to 0.40; it is the unit's tallest part, the top
    // rising gradually to it from the head lamp's inner corner.
    {
      points: [
        { x: [0.27, 0.325], y: [0.615, 0.688], role: 'head' },
        { x: 0.45, y: [0.616, 0.699], role: 'head' },
        { x: 0.56, y: [0.619, 0.707], role: 'blinker' },
        { y: [0.626, 0.714], role: 'blinker' },
        { s: 0.15, y: [0.63, 0.72], role: 'blinker' },
        { s: 0.19, y: [0.636, 0.714], role: 'blinker' },
        { s: 0.215, y: [0.652, 0.692] },
      ],
    },
    // Tail, two bands split level at 0.811 [D rear, zoomed: top py 720 (0.906), split py 740,
    // foot py 768 (0.677), outer ±0.769; the inner side one convex line from the foot's inner
    // corner (±0.384) leaning out up to the split (±0.458) and rounding over into the top
    // (±0.481 at 0.859, ±0.514 at 0.892, ±0.546 at the top); D side: forward on the wing to s
    // 4.21–4.23; P "1997 Daewoo Nexia dark green rear": the same rounded inner top corner, a
    // light band over red]. The inner line moved 0.016 out so its foot clears the lid's
    // upright side (±0.39); the top kept at the tail's belt (0.90). Upper band: the reversing
    // lamp inside (the drawn cell ±0.48–0.58), the indicator outside; lower: stop and tail.
    {
      end: 'rear',
      points: [
        { x: [0.468, 0.497], y: [0.811, 0.859], role: 'reverse' },
        { x: 0.53, y: [0.811, 0.89], role: 'reverse' },
        { x: 0.562, y: [0.811, 0.9], role: 'reverse' },
        { x: 0.6, y: [0.811, 0.9], role: 'blinker' },
        { y: [0.811, 0.9], role: 'blinker' },
        { s: 4.24, y: [0.811, 0.895] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.4, 0.428], y: [0.68, 0.739], role: 'brake' },
        { x: [0.44, 0.468], y: [0.68, 0.811], role: 'brake' },
        { x: 0.58, y: [0.68, 0.811], role: 'tail' },
        { y: [0.68, 0.811], role: 'tail' },
        { s: 4.24, y: [0.69, 0.811] },
      ],
    },
  ],
  front: {
    // Dark grey plastic 0.24–0.60 [D side: top 0.599, foot 0.24; the lower part drawn in
    // from 0.385], its top under the lamps' foot: the band hangs `drop` under the face's sill
    // bevel (sill 0.30 + 0.035). The bright strip at 0.545 [D side y 269–275; D front], its
    // sides back along the wings to the front arch [D side x 643–650].
    bumper: { kind: 'moulded', drop: 0.095, height: 0.36, moulding: { y: 0.545, height: 0.015, finish: 'chrome' }, wrapTo: 0.53 },
    items: [
      // Black horizontal slats in a black frame between the lamps, a trapezoid narrowing to
      // its foot, from the bumper's top to under the lip (0.705) [D front y 235–255: the
      // frame's sides from x 178 (±0.253) at the foot to x 165 (±0.312) at the top; P: the
      // black surround]: the opening ±0.245 at the foot, ±0.30 at the top, the frame 0.01
      // round it.
      {
        kind: 'grille',
        x: { centre: 0.245 },
        y: { from: ['bumperTop', 0.012], to: ['deck', -0.025] },
        slant: -0.055,
        frame: { finish: 'black', margin: 0.01 },
        back: true,
        bars: { dir: 'horizontal', count: 4, finish: 'black', margin: 0.008, width: 0.008, depth: 0.01, proud: 0.015 },
      },
      // The four intakes in the bumper's lower part [D front: the outer ovals ±0.35–0.60, the
      // two middle slots ±0.33, 0.30–0.39]: the outer pair as black recesses, the middle pair
      // one intake split on the centre line.
      { kind: 'panel', x: { from: { centre: 0.37 }, to: { centre: 0.58 } }, y: { from: ['bumperBottom', 0.085], to: ['bumperBottom', 0.145] }, finish: 'black', proud: 0.115 },
      {
        kind: 'grille',
        x: { centre: 0.32 },
        y: { from: ['bumperBottom', 0.085], to: ['bumperBottom', 0.145] },
        standOut: 0.024,
        back: true,
        bars: { dir: 'vertical', count: 1, finish: 'black', margin: 0, width: 0.03, depth: 0.01, proud: 0.005 },
      },
    ],
  },
  rear: {
    // Dark grey plastic 0.30–0.61 [D side 0.584–0.608 at the top, 0.30 at the foot; D rear
    // 0.61–0.63], under the lamps' foot (0.68): 0.365 (sill 0.33 + 0.035) − 0.065. The strip
    // at 0.545 [D rear y 790–795]. Its sides forward along the wings to the rear arch [D side
    // x 1310, s 3.79; the arch's back 3.795].
    bumper: { kind: 'moulded', drop: 0.065, height: 0.31, moulding: { y: 0.545, height: 0.015, finish: 'chrome' }, wrapTo: 3.81 },
    items: [],
  },
};

/**
 * The Daewoo Espero (KLEJ, 1990–1999, Korea): Bertone's four-door wedge on the GM J-car's
 * floor (the Opel Ascona C's) with Opel running gear; the car built is the 2.0 CD of
 * 1995–1999 that drom.ru catalogues for Russia (C20LE, five-speed): body-colour bumpers with
 * a broad black band, flush head lamps either side of a plain panel with the badge, a
 * black slot and fog lamps low in the front bumper, a black rubbing strip along the doors,
 * and at the tail a red reflector band across the boot lid between the corner lamps.
 * Numbers and sources in measurements-espero.md.
 *
 * Measured on the-blueprints.com's dimensioned vector preview `daewoo_espero_1995.jpg`
 * (1280 × 905; dimension lines 4615 / 2620 / 1718 / 1388), side view facing left: lengths
 * 5.812 mm/px from the drawn tips (x 28 / 822, 4615), `s = (x − 28) × 0.005812`; heights
 * 5.486 mm/px from the drawn ground (the tyres' foot, y 332) to the roof (y 79, 1388),
 * `y = (332 − py) × 0.005486`. The drawn hubs (x 186.5 / 643.25) stand 2655 apart at the
 * length scale against the factory 2620: the wheels are put on the factory wheelbase
 * centred on the drawn pair. Front and rear views 5.67 mm/px across from the body's drawn
 * width (303 px, 1718), the plan 5.955 along and 5.614 across. Wikimedia Commons photos
 * for colours, lamps, bumpers and the strips.
 */

/**
 * Daewoo Espero: overhangs 0.935 / 1.06 over a 2620 wheelbase [E: the drawn hubs centred on
 * the factory base]. The face raked from the bumper's top (0.576) to the bonnet's lip (0.74
 * at s 0.12); the bonnet rising to 0.914 at the cowl (s 1.267); the A pillar to the rail
 * (1.306) at 2.03; roof 1.388, falling from s 2.95 to the back light's top at 3.342; the
 * back light down to its foot at 4.04, 1.004 on the centre line; the boot falling to 0.944
 * at its trailing edge and the lid down the tail face between the corner lamps to 0.64.
 * Sill 0.24, belt 0.905 at the A pillar rising to 0.977 at the C pillar (the wedge).
 */
export const BODY_ESPERO: KitBody = {
  length: 4.615, // [F drom.ru, carfolio, the drawing's dimension line]
  platform: 'samara',
  stations: [
    // The face [D side x 30–50: the lamps 0.614–0.702 raked back to the lip; D plan: ±0.47
    // at s 0.036, ±0.545 at 0.054, ±0.615 at 0.089, rounding hard in plan], raked by
    // `frontLean`. The bonnet's centre line [D side: 0.763 at s 0.19, 0.795 at 0.30, 0.823
    // at 0.42, 0.85 at 0.535, 0.872 at 0.65, 0.883 at 0.77, 0.905 at 0.94, 0.914 from 1.0].
    { s: 0.05, sill: 0.3, crease: 0.59, belt: 0.705, deck: 0.72, wSill: 0.62, wCrease: 0.64, wBelt: 0.6 },
    // [D plan ±0.705 at s 0.167, ±0.775 at 0.286, ±0.83 at 0.6] Kit-check (2026-10-19): the
    // plan's slope fell 0.52 → 0.17 per metre at s 0.30 (the crease turning −18° there
    // between −3° and −7°, the Astra F's old dent), and the flank's lean in over the crease
    // went 0.28, 0.26, 0.21, 0.26 per metre station by station. Now one curve through the
    // drawn plan, wCrease = 0.859 − 0.219 (1 − (s − 0.05) / 1.217)⁴ (0.714 at 0.17, 0.772
    // at 0.3, 0.839 at 0.6; D 0.705, 0.775 at 0.286, 0.83), a station added at 0.45 on it,
    // the belt leaning in 0.257 per metre of rise everywhere (the cowl's) and the sill
    // 0.059 per metre of its drop.
    { s: 0.17, sill: 0.29, crease: 0.6, belt: 0.745, deck: 0.762, wSill: 0.696, wCrease: 0.714, wBelt: 0.677 },
    { s: 0.3, sill: 0.285, crease: 0.61, belt: 0.775, deck: 0.797, wSill: 0.753, wCrease: 0.772, wBelt: 0.73 },
    { s: 0.45, sill: 0.28, crease: 0.6175, belt: 0.8025, deck: 0.834, wSill: 0.7945, wCrease: 0.8145, wBelt: 0.767 },
    { s: 0.6, sill: 0.275, crease: 0.625, belt: 0.83, deck: 0.862, wSill: 0.818, wCrease: 0.839, wBelt: 0.786 },
    // The cowl [D side (246, 167)]; the flank ±0.859 from here [D plan, front view], the
    // shoulder ±0.79 at the belt [D front y 166].
    { s: 1.267, sill: 0.245, crease: 0.65, belt: 0.88, deck: 0.914, wSill: 0.835, wCrease: 0.859, wBelt: 0.8 },
    // The belt under the side glass rising to the tail [D side: the glass's foot 0.905 at s
    // 1.78, 0.977 at 3.34; lowered 0.04 on the photos' side glass, "Daewoo Espero h": the
    // glass deeper against the doors than the preview draws it]; sill 0.24 [D side y 288].
    { s: 2.5, sill: 0.24, crease: 0.655, belt: 0.895, deck: 0.915, wSill: 0.835, wCrease: 0.859, wBelt: 0.8 },
    { s: 3.354, sill: 0.245, crease: 0.66, belt: 0.93, deck: 0.95, wSill: 0.83, wCrease: 0.855, wBelt: 0.795 },
    // rearBase: the back light's foot, 1.004 on the centre line [D side (723, 149)]; ±0.814
    // The sill kept at 0.25 to here: the shell's foot under the rear bench (to 4.025) stays
    // clear of the cabin floor's plane (0.27), which it crossed at 0.28 (kit-zfight).
    // [D plan s 4.04; D rear ±0.811 at 0.92].
    { s: 4.04, sill: 0.25, crease: 0.665, belt: 0.96, deck: 1.004, wSill: 0.79, wCrease: 0.814, wBelt: 0.77 },
    // The boot [D side: 0.993 at s 4.196, 0.971 at 4.37, 0.944 at 4.487; D plan ±0.792 at
    // 4.18, ±0.769 at 4.32, ±0.705 at 4.47].
    { s: 4.3, sill: 0.31, crease: 0.665, belt: 0.955, deck: 0.978, wSill: 0.755, wCrease: 0.775, wBelt: 0.735 },
    { s: 4.5, sill: 0.33, crease: 0.665, belt: 0.925, deck: 0.944, wSill: 0.69, wCrease: 0.71, wBelt: 0.675 },
    // The tail face: the lid comes down between the corner lamps (topped at 0.925: `belt`
    // 0.91 + the shoulder's 0.015 rise; at belt 0.925 the corners stood at 0.94, level with
    // the boot's edge at 4.5, and the lid's top folded in 7–8° across s 4.5, kit-surface) to
    // the bumper's band [P "1996 Daewoo Espero orange red rear"], cut at ±0.49 (lamp review:
    // on the near-square "Maroon Daewoo Espero-003-rear" the corner unit is 0.265 of the
    // lid's band, 200 / 755 px; ±0.52 gave 0.18).
    { s: 4.55, sill: 0.33, crease: 0.665, belt: 0.91, deck: 0.64, notch: 0.49, wSill: 0.665, wCrease: 0.685, wBelt: 0.655 },
  ],
  shoulder: { inset: 0.04, rise: 0.015 },
  cabin: {
    // Owner's review 1 (2026-10-18): the door frames, the B pillar, the post between the
    // rear door's glass and the quarter glass, the quarter glass's frame and the mirror's
    // sail black, as on the car [P "Daewoo Espero beige front", "Daewoo Espero h"]; the A
    // pillar and the wide C pillar painted.
    columns: [
      // The screen's outer line from the cowl (1.267, 0.914) to the rail at 2.03 [D side
      // (246, 167) to (377, 91)].
      { s: 1.267, top: 2.03, upper: 'body' },
      // Owner's review 3 (2026-10-19): the A pillar too thick, and the open door's frame a
      // huge dark wedge from the pillar's foot. The door's black frame and sail ran from
      // 1.30 to the glass's edge at 1.62 at the belt and 2.06–2.11 at the rail: a band 0.03
      // wide at the top and 0.35 at the belt. On the drawing [D side, dark runs by pixel row,
      // y 104–136] the pillar and the door's frame are one band of even width, 16 px = 0.093
      // of s (the frame's line 2/3 of the way back: paint 0.055, frame 0.04), parallel to
      // the screen's line from the roof down to 1.064 high; under it the black sail, a
      // triangle from the band's rear edge along the belt to s 1.78, its rear edge upright
      // up to the band (apex (1.79, 1.064)), the mirror on it. Now as the Nexia's: the
      // painted pillar 0.058, the door's black frame 0.042 and the glass behind them, all
      // three parallel to the screen's line; the glass's foot raised on its first column
      // (`glassRise` 0.14, 1.046 high) so the frame under it is the sail, 0.29 along the
      // belt and 0.14 high as drawn. The door's hinge line at its front edge (the frame's
      // foot, 1.325), as on the Nexia; below the belt the wing reaches back to the door's
      // shut line at 1.447 [D side x 277].
      { s: 1.325, top: 2.088, upper: 'door1', lower: 'body', finish: 'black' },
      { s: 1.367, top: 2.13, upper: 'door1', glass: 'drop', lower: 'body', finish: 'black', glassRise: 0.14 },
      // The shut line's column: its glass foot on the sail's edge.
      { s: 1.447, top: 2.21, upper: 'door1', glass: 'drop', finish: 'black', glassRise: 0.102 },
      // The sail's rear end at the belt [D: 1.78 on the car, whose pillar foot stands 0.13
      // further back over the wing].
      { s: 1.66, top: 2.25, upper: 'door1', glass: 'drop', finish: 'black' },
      // The B pillar [D side, dark runs y 100–160: the front glass's rear edge 2.449 at the
      // belt leaning to 2.561 at the rail, the rear glass's front edge 2.597 to 2.65; the
      // shut line below the belt x 458, s 2.50]. Review 3: the front door's frame stepped
      // back over the rear door at the belt (f3d0135: the front frame to 2.545, the rear door
      // forward under it to 2.50), which no door opens past. Now the Nexia's arrangement:
      // the front door's frame ends at the glass, the black pillar (body) stands over both
      // doors' edges, the front door below it to the shut line 2.50, the rear door from
      // there, its frame and glass starting behind the pillar.
      { s: 2.45, top: 2.56, upper: 'door1', finish: 'black' },
      { s: 2.47, top: 2.58, upper: 'body', lower: 'door1', finish: 'black' },
      { s: 2.5, top: 2.605, upper: 'body', lower: 'door2', finish: 'black' },
      { s: 2.565, top: 2.625, upper: 'door2', finish: 'black' },
      { s: 2.597, top: 2.65, upper: 'door2', glass: 'drop', finish: 'black' },
      // The rear glass's rear edge leaning forward to the top [D side: 3.354 at the belt,
      // 3.295 at the rail]; the frame behind it, the door's shut line running down and
      // forward round the rear arch to the doors' bottom [D side x 587 at the arch].
      { s: 3.33, top: 3.27, upper: 'door2', finish: 'black' },
      { s: 3.36, top: 3.3, upper: 'body', finish: 'black', foot: { y: 0.72, s: 3.15, round: [0.15, 0.03] } },
      // The fixed quarter glass in the body behind the rear door [P "Daewoo Espero h"; the
      // drawing's preview greys it], its rear edge the slim C pillar's front, then the C
      // pillar to the back light [D side: its top at the rail at 3.342].
      { s: 3.375, top: 3.31, upper: 'body', glass: 'fixed', finish: 'black' },
      { s: 3.76, top: 3.325, upper: 'body' },
      { s: 4.04, top: 3.342 },
    ],
    rail: 1.306, // the door frames' top [D side y 94]
    railHalf: 0.55, // [D front ±0.544 at y 94]
    crown: 0.062, // roof 1.388 [F] = rail + rise + crown
    railInset: 0.04,
    railRise: 0.02,
    // The roof rounding up from the screen [D side: 1.328 at s 2.05, 1.355 at 2.16, 1.366 at
    // 2.28, 1.377 at 2.39, 1.388 at 2.69], then falling into the back light [1.377 at 2.98,
    // 1.366 at 3.09, 1.36 at 3.21, 1.339 at 3.33]; the drop a share of that, the crown's
    // own fall at the screen doing the rest (as the Nexia).
    roofDrop: [[2.03, 0.025], [2.16, 0.013], [2.3, 0.006], [2.45, 0], [2.95, 0], [3.1, 0.008], [3.25, 0.02], [3.342, 0.03]],
    glassBottom: 0.01,
    glassTop: 0.02,
    screenBottom: 0.03, // [E as the Samaras]
    screenHeader: 0.045, // [E as the Samaras]
    wiperBlade: 0.5, // [E: no parts-catalogue length found; the tens' 500]
    rearBottom: 0.025, // [E]
    rearHeader: 0.045, // [E]
    pillar: 0.07, // [E]
  },
  wheels: {
    front: 0.935, // [E: the drawn hubs 0.921 / 3.576 at the length scale, centred on 2620]
    rear: 3.555, // wheelbase 2620 [F]
    radius: 0.298, // 185/65 R14 [F drom.ru]
    width: 0.185, // [F]
    frontHalfTrack: 0.713, // 1426 [F drom.ru]
    rearHalfTrack: 0.703, // 1406 [F drom.ru]
    // Front: the lip's top 0.614, 0.316 over the hub; ±0.384 at the hub's height [D side x
    // 122–254] → 1.18; a little more so the steered tyre clears it.
    arch: 1.24,
    // Rear: ±0.375 at the hub's height, its top 0.631, 0.333 over the hub [D side x 584–713].
    rearArch: 1.26,
    rearArchRise: 1.12,
  },
  doorBottom: 0.285, // [D side y 280]
  bonnetFront: 0.05,
  // The face rakes back from under the lamps (0.59) to the bonnet's lip (0.74, s 0.12) [D
  // side], in full back to the indicators' end so the lamps lean with the face.
  frontLean: { base: 0.59, lean: 0.5, blend: 0.6, full: 0.17 },
  // The lid comes down the tail face between the corner lamps.
  bootEnd: 4.55,
  // [E: on neither the drawing's left side nor the left-side photos, so on the right]
  flap: { s0: 3.76, s1: 3.88, y0: 0.8, y1: 0.89 },
};

/**
 * The Espero 2.0 CD (photos "Daewoo Espero beige front", "1999 Daewoo Espero dark green
 * front", "1996 Daewoo Espero orange red rear", "Daewoo Espero h"): flush head lamps with
 * the amber indicator at their outer ends wrapping round the corners, a plain body-colour
 * panel between them; body-colour bumpers with a broad black band along their top, a black
 * slot and two fog lamps low in the front one; a black rubbing strip along the doors; at
 * the tail corner lamps (red over red and amber) joined by a red reflector band across the
 * lid; black handles and mirrors.
 */
export const LOOK_ESPERO: KitLook = {
  label: 'Daewoo Espero',
  upholstery: 0x6a6c70, // grey cloth [P SelfBase "door panel front": #77787a in its bright light]
  dash: 0x6e7175, // mid-grey plastic, the stack black [P SelfBase "instrument panel front", "side"]
  headrests: true,
  brightwork: 'black', // [P]
  sill: null,
  // On the sail at the glass's front foot (owner's review 2: see the columns) [D side: the
  // head s 1.78–1.90 against the glass from 1.79; here the glass from 1.62].
  mirrorS: 1.74,
  // The black rubbing strip along both doors [D side y 243: 0.488; P beige front, h].
  waist: { y: 0.49, height: 0.035, finish: 'black' },
  // Amber, on the wing behind the front arch [P dark green front].
  repeater: { s0: 1.36, s1: 1.4, y0: 0.7, y1: 0.722 },
  // The pressed line along the flank [D side y 212: 0.658].
  featureLine: { points: [[0.6, 0.64], [1.3, 0.652], [2.5, 0.658], [3.5, 0.662], [4.3, 0.665]], height: 0.012 },
  cornerLamps: [
    // Head lamp and indicator as one flush unit (lamp review, 2026-10-18) [P "Daewoo Espero
    // front 20071227", "Maroon Daewoo Espero-002-front", "1994-1995 Daewoo Espero 2000i
    // Sedan 04", beige front, dark green front]. Review 2 (captain on the maroon photo): the
    // lens fills the whole band between the bumper's black top (0.576) and the bonnet's
    // edge (the face's belt, 0.705): its foot one straight line 6 mm over the bumper, its
    // top along the bonnet's shut line. The inner end one slanted edge from the foot at
    // ±0.2 up and out to ±0.27, along the badge panel's side; the amber indicator the outer
    // 22 % of the same unit (from ±0.56), the same height, its end square at the corner
    // with only a short return onto the wing.
    {
      points: [
        { x: [0.2, 0.27], y: [0.582, 0.695], role: 'head' },
        { x: 0.4, y: [0.582, 0.698], role: 'head' },
        { x: [0.56, 0.56], y: [0.582, 0.701], role: 'blinker' },
        { y: [0.582, 0.703], role: 'blinker' },
        { s: 0.1, y: [0.585, 0.7] },
      ],
    },
    // Tail (lamp review) [P "Maroon Daewoo Espero-003-rear" (near square: the lid's band
    // 755 px over its 1.04 m, 1.38 mm/px), "Daewoo Espero rear 20071227", "Daewoo Espero h",
    // "1996 Daewoo Espero orange red rear"]: one band across the whole tail, 0.15 tall, 0.10
    // of painted face over it (the badges' strip) and its foot 0.03 over the lid's: 0.67–
    // 0.82. The corner units red over amber, split at 0.725 (64 / 36 %), their inner edge
    // upright along the lid's cut (±0.49); round the corner onto the wing, the foot further
    // forward than the top [P h, orange red; D plan: red to s 4.39 at the top]. Review 2
    // (captain): the amber the unit's whole width under the red, and only a short return
    // onto the wing (to s 4.47 at the top, 4.44 at the foot).
    {
      end: 'rear',
      points: [
        { x: [0.5, 0.5], y: [0.725, 0.82], role: 'brake' },
        { x: 0.6, y: [0.725, 0.82], role: 'tail' },
        { y: [0.725, 0.82], role: 'tail' },
        { s: 4.47, y: [0.73, 0.815] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.5, 0.5], y: [0.67, 0.725], role: 'blinker' },
        { y: [0.67, 0.725], role: 'blinker' },
        { s: 4.44, y: [0.675, 0.725] },
      ],
    },
  ],
  front: {
    // Body colour 0.23–0.576 [D side y 227–290], its top band black from the top to under
    // the plate [P beige front]; its sides back along the wings to the front arch.
    bumper: { kind: 'moulded', drop: 0.105, height: 0.346, finish: 'paint', moulding: { y: 0.525, height: 0.09, finish: 'black' }, corner: 0.2, wrapTo: 0.55 },
    items: [
      // The fog lamps at the ends of the lower band, the black slot between them [P].
      // Clear glass, unlit (no fog-lamp channel): a grey panel, not a red `inert` lens; its
      // face 2 mm inside the bumper's (0.075 stood 25 mm proud of it and lengthened the car).
      { kind: 'panel', x: { from: { centre: 0.36 }, to: { centre: 0.5 } }, y: { from: ['bumperBottom', 0.05], to: ['bumperBottom', 0.1] }, finish: 'grey', proud: 0.05 },
      {
        kind: 'grille',
        x: { centre: 0.3 },
        y: { from: ['bumperBottom', 0.05], to: ['bumperBottom', 0.1] },
        standOut: 0.024,
        back: true,
        bars: { dir: 'vertical', count: 1, finish: 'black', margin: 0, width: 0.02, depth: 0.01, proud: 0.005 },
      },
    ],
  },
  rear: {
    // Body colour 0.313–0.603 [D side y 222–275], a black band along its top [P orange red
    // rear]; its sides forward along the wings to the rear arch (3.93).
    bumper: { kind: 'moulded', drop: 0.052, height: 0.29, finish: 'paint', moulding: { y: 0.56, height: 0.07, finish: 'black' }, wrapTo: 3.95 },
    items: [
      // The small reversing lamps in the bumper's lower corners [P orange red rear].
      { kind: 'lens', role: 'reverse', x: { from: { centre: 0.5 }, to: { centre: 0.6 } }, y: { from: ['bumperBottom', 0.04], to: ['bumperBottom', 0.075] }, depth: 0.008, proud: 0.057 },
    ],
    // The red band across the lid between the corner lamps, in line with them (lamp review)
    // [P maroon rear, rear 20071227, h, orange red]: full height (0.67–0.82, `belt` 0.91
    // here) at its ends, from the lid's cut in to ±0.27 (the step at 45–55 % of its half [P]); between those only its red top down
    // to the corner lamps' split (0.725), the lid's dark strip under it; review 2: the ends'
    // inner edge a slant running down and out (±0.27 at the split to ±0.33 at the foot),
    // the band out to ±0.483, 7 mm from the lid's cut, so lid end and corner unit read as one
    // deeper outer unit, not a staple. The red top across
    // the lid, and under each end a lower lens 4 mm further back whose top runs 5 mm in
    // behind it (a lens's corners are chamfered: two lenses meeting edge to edge left
    // notches between them). Owner, 2026-10-18: the band stood 10 mm out of the lid and read
    // as a bulge beside the flush corner lamps; it lies nearly flush now (4 mm, its lower
    // lens 2 mm), in the corner lamps' style.
    lid: [
      { kind: 'lens', role: 'inert', x: { at: { centre: 0 }, half: 0.483 }, y: { from: ['belt', -0.185], to: ['belt', -0.09] }, depth: 0.008, proud: 0.004 },
      { kind: 'lens', role: 'inert', x: { from: { centre: 0.33 }, to: { centre: 0.483 } }, y: { from: ['belt', -0.24], to: ['belt', -0.18] }, depth: 0.008, proud: 0.002, slant: { outer: 0, inner: 0.06 } },
    ],
  },
};
