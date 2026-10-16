/**
 * The AZLK-2141 «Москвич» (1986–1998 base car): a five-door liftback, a transverse engine
 * in front driving the front wheels. Numbers and sources in measurements-2141.md.
 *
 * Measured on the-blueprints.com's watermarked preview of its "Moskvich 2141 (1986-2001)"
 * vector four-view (1280 × 905, dimension lines 4350 / 2580 / 1690 / 1400): side view
 * 5.714 mm/px from the drawn hubs (x 180.5 / 632, 2580; the 1400 height line reads 1400 at
 * the same scale), ground y 331, `s = 0.910 + (x − 180.5) × 0.005714`, the 910 front
 * overhang drom.ru's (the drawn tips are 64 mm short of 4350: 21 of it put on the front
 * bumper, 43 on the rear one, as drom.ru's 910 / 860 overhangs split it); the front, rear
 * and plan views at the same scale. Wikimedia Commons photos for colours, the lamps' cells,
 * the tailgate down between the tail lamps, and what the drawing leaves out.
 *
 * A near-upright face of rectangular head lamps and a black slatted grille, the amber
 * indicators wrapping round the corners, over a deep black plastic bumper; a long bonnet
 * rising evenly to a raked screen; a sharp shoulder line along the flank under the windows;
 * four doors under a slim A pillar, the front door's glass close behind it; a quarter
 * glass under the falling roof and a wide D pillar; a long tailgate from the roof's rear
 * to the bumper, nearly all glass, its short lower panel and the plate between the tail
 * lamps.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * AZLK-2141: overhangs 910 / 860 over a 2580 wheelbase. The face from the bumper's top (s
 * 0.107, 0.57) to the bonnet's lip (0.78, carried back to s 0.155); the bonnet rising to 0.955
 * at the cowl (s 1.336); the screen raked to the rail at 1.85; roof 1.40, falling from s 2.85
 * to the tailgate's top at 3.38; the tailgate's glass down to its knee (4.22, 0.913) and a
 * short panel down the tail face between the lamps to the bumper's top (0.56). Sill 0.20,
 * door bottom 0.33, belt 0.905. Front door 1.387 to 2.41 below the belt, rear door 2.41 to
 * 3.23 reaching over the rear arch; quarter glass 3.245 to 3.80 at its foot.
 */
export const BODY_2141: KitBody = {
  length: 4.35, // [F 4350: drom.ru, ru.wikipedia, njcar.ru]; drawn tips 4.286 at the hub scale
  platform: 'samara',
  stations: [
    // The face [D side: the lamps' foot x 40, s 0.107, on the bumper's top 0.563–0.577]: its
    // corners round in plan (±0.62 at s 0.107, ±0.654 at 0.136, ±0.71 at 0.22, ±0.737 at
    // 0.336, ±0.785 at 0.55, ±0.843 at the hub [D plan]). The bonnet's centre line [D side,
    // the top line: 0.806 at s 0.19, 0.834 at 0.31, 0.88 at 0.54, 0.914 at 0.88, 0.937 at 1.14,
    // 0.955 at the cowl], its crown over the wings' top growing evenly from 0.01 at the lip
    // to 0.03 at the cowl (HISTORY: a crown that grows and shrinks twists the bonnet into
    // slivers): `belt` = deck − shoulder rise − crown. The wings' top line [D side: 0.806 at
    // the lip's corner → 0.945 at the cowl] is within 2 cm of it.
    { s: 0.107, sill: 0.25, crease: 0.62, belt: 0.755, deck: 0.78, wSill: 0.64, wCrease: 0.66, wBelt: 0.645 },
    { s: 0.22, sill: 0.25, crease: 0.62, belt: 0.785, deck: 0.812, wSill: 0.69, wCrease: 0.71, wBelt: 0.695 },
    // The indicator's end on the flank [D side x 80].
    { s: 0.336, sill: 0.25, crease: 0.62, belt: 0.811, deck: 0.84, wSill: 0.72, wCrease: 0.74, wBelt: 0.725 },
    { s: 0.55, sill: 0.25, crease: 0.62, belt: 0.848, deck: 0.88, wSill: 0.77, wCrease: 0.79, wBelt: 0.775 },
    // Over the front hub the flank reaches its full ±0.843 [D plan; front view ±0.857 at
    // 0.6, ±0.836 at 0.89].
    { s: 0.91, sill: 0.22, crease: 0.62, belt: 0.879, deck: 0.917, wSill: 0.81, wCrease: 0.845, wBelt: 0.83 },
    // The cowl: the A pillar's outer line meets the bonnet here [D side (255, 163)].
    { s: 1.336, sill: 0.2, crease: 0.62, belt: 0.91, deck: 0.955, wSill: 0.81, wCrease: 0.845, wBelt: 0.83 },
    // Window sill 0.897–0.909 along both doors [D side y 172–174]; sill 0.19–0.21 between the
    // arches [D side, the bottom line].
    { s: 2.41, sill: 0.2, crease: 0.62, belt: 0.905, deck: 0.925, wSill: 0.81, wCrease: 0.845, wBelt: 0.83 },
    { s: 3.24, sill: 0.2, crease: 0.62, belt: 0.915, deck: 0.935, wSill: 0.81, wCrease: 0.845, wBelt: 0.83 },
    // Behind the rear arch the body's foot meets the bumper's (0.28) [D side]; the quarter's
    // sill 0.93 at the black triangle [D side y 164–168]. The tail rounds in: ±0.79 at 3.88,
    // ±0.769 at 4.11, ±0.749 at 4.22, ±0.734 at 4.25 [D plan].
    { s: 3.88, sill: 0.32, crease: 0.62, belt: 0.925, deck: 0.945, wSill: 0.77, wCrease: 0.8, wBelt: 0.785 },
    // The belt is kept under the tailgate's knee (0.913) and turns down at this station, a
    // cabin column of its own (measurements-niva.md §1.3, HISTORY 2131).
    { s: 4.12, sill: 0.32, crease: 0.62, belt: 0.905, deck: 0.92, wSill: 0.75, wCrease: 0.78, wBelt: 0.765 },
    // rearBase: the tailgate's foot at the lamps' top, its lower panel coming on down the tail
    // face between them (`lidFace`); the D pillar comes down the raked line flush with it.
    { s: 4.245, sill: 0.32, crease: 0.62, belt: 0.72, deck: 0.73, wSill: 0.73, wCrease: 0.755, wBelt: 0.745 },
    // The tail face [D side x 769–770]; the lamps 0.556–0.713 [D rear]. The tailgate comes
    // down between them (the shut gaps at ±0.30–0.36, the plate on it) to the bumper's top
    // [D rear; P "AZLK-2141 green colored (rear view)", "Red Moskvich 2141 (rear)"].
    { s: 4.27, sill: 0.32, crease: 0.62, belt: 0.72, deck: 0.56, notch: 0.355, wSill: 0.72, wCrease: 0.74, wBelt: 0.73 },
  ],
  // Side glass foot ±0.80 at the belt (the A pillar's outer line in the front view, ±0.757
  // at 0.99 leaning in 0.48 m per m) over a flank at ±0.83 [D front].
  shoulder: { inset: 0.03, rise: 0.015 },
  cabin: {
    columns: [
      // The A pillar's outer line from the cowl (1.336, 0.96) to the roof (1.89, 1.366) [D side
      // (255, 163) → (352, 92)]: 1.85 at the rail.
      { s: 1.336, top: 1.85, upper: 'body' },
      // A slim pillar with the door's glass close behind it (owner, 2026-10-16: the drawn
      // 0.18 of body and 0.2 of sail between the screen and the glass read as a heavy
      // pillar). On the car [P "Moskwitsch 2141 (side)", 2.243 mm/px by the hubs] the
      // pillar's painted face and the door's black frame are 0.056 of s together (11 + 12
      // px), 3.3 cm across: here the door's frame from its shut line (1.387 below the belt
      // [D side x 264; P 1.394]) 0.05 behind the pillar's line, the glass 0.03 behind that,
      // all three parallel. The real glass's front edge is more upright (1.634 at the belt
      // behind the mirror's black sail, 1.917 at its top [P]); the kit has no black sail, so
      // the glass runs down the pillar instead.
      { s: 1.387, top: 1.9, upper: 'door1' },
      { s: 1.417, top: 1.93, upper: 'door1', glass: 'drop' },
      // The B pillar [D: the front glass ends x 438.6 (2.385), the doors meet at x 443 (2.41)
      // below the belt, the rear glass starts at x 458.6 (2.499); 0.04 further back at the
      // rail]. The front frame ends 1 cm before the door's lower shut line (HISTORY Oka).
      { s: 2.385, top: 2.425, upper: 'door1' },
      { s: 2.4, top: 2.44, upper: 'body', lower: 'door1' },
      { s: 2.41, top: 2.45, upper: 'body', lower: 'door2' },
      { s: 2.475, top: 2.505, upper: 'door2' },
      { s: 2.499, top: 2.524, upper: 'door2', glass: 'drop' },
      // The rear glass's rear edge leaning back towards its foot [D: (561, 104) → (577, 164):
      // 3.074 at the rail, 3.189 at the belt]; the frame behind it to the shut line, upright
      // at 3.21–3.24 below the belt [D x 584–588.6].
      { s: 3.189, top: 3.074, upper: 'door2' },
      { s: 3.21, top: 3.1, upper: 'body', lower: 'door2' },
      { s: 3.23, top: 3.12, upper: 'body' },
      // The quarter glass from x 588.6 (3.245), its top under the falling roof and its rear
      // corner raked to the black triangle's point [D: (666, 151), (686, 167): 3.684 / 1.03,
      // 3.80 / 0.937]: one raked edge from 3.30 at the rail to 3.80 at the belt.
      { s: 3.245, top: 3.245, upper: 'body', glass: 'fixed' },
      { s: 3.8, top: 3.3, upper: 'body' },
      // The belt turns down to the tailgate's foot from here (station 4.12).
      { s: 4.12, top: 3.355, upper: 'body' },
      // rearBase; the tailgate's top at the rail [D side: the roof's line crosses 1.335 at s
      // 3.38, then falls 0.52 m per m to the tail's top corner (4.25, 0.89)].
      { s: 4.245, top: 3.38 },
    ],
    rail: 1.325, // the door frames' top 1.32 [D side]; the screen's top corners 1.327 [D front]
    railHalf: 0.59, // the A pillar's outer line at the rail [D front]; the D pillar's ±0.589 at 1.349 [D rear]
    crown: 0.045, // roof 1.40 [D side, front 1.406, rear 1.398; F 1400] = rail + rise + crown
    railInset: 0.03, // the roof's edge ±0.578 at 1.363 [D front]
    railRise: 0.03,
    // [D side, the roof's top line: 1.400 from s 2.39 to 2.85, 1.394 at 2.964, 1.383 at
    // 3.078, 1.371 at 3.193, 1.36 at 3.307]: falling ever more steeply into the tailgate.
    roofDrop: [[2.85, 0], [3.08, 0.015], [3.31, 0.04], [3.38, 0.05]],
    glassBottom: 0.03, // glass foot 0.944 over the belt 0.905, a black band between [D side]
    glassTop: 0.035, // glass top 1.29 [D side y 105]
    screenBottom: 0.025, // [E as the classics]
    screenHeader: 0.045, // [E as the Samaras]
    wiperBlade: 0.45, // [E: a pair across a screen ±0.68 at its foot, D front]
    rearBottom: 0.025, // unused with a knee
    rearHeader: 0.03, // the tailgate glass's top 1.249 [D rear] under the rail's 1.275 there
    // The tailgate glass's foot 0.913 on the centre line [D rear y 586], on the raked line at
    // s 4.22 [D side: 0.903 at x 760]; the short painted panel under it.
    rearKnee: { s: 4.22, y: 0.913 },
    pillar: 0.07, // [E as the Samaras]
  },
  wheels: {
    front: 0.91, // [F drom.ru front overhang 910]; drawn hub x 180.5
    rear: 3.49, // hub x 632 [D]; wheelbase 2580 [F]
    radius: 0.31, // 165/80 R14 free 0.310 [F drom.ru; sa_azlk2141 row]; drawn 0.29 loaded
    width: 0.165, // [F]
    frontHalfTrack: 0.72, // 1440 [F wiki.zr.ru, ru.wikipedia]
    rearHalfTrack: 0.71, // 1420 [F]
    // Front: the lip's top 0.724, the liner's 0.668 over the ground [D side]: 0.40 round the
    // hub between the two → 1.3.
    arch: 1.3,
    // Rear: the lip's top 0.674 [D side]: 0.372 → 1.2.
    rearArch: 1.2,
  },
  // [D side 0.324 at the doors' foot; P "Moskwitsch 2141 (side)" 0.30]; 0.33, over the hub,
  // so the rear door's foot meets its arch cut-out above the arch's front point.
  doorBottom: 0.33,
  bonnetFront: 0.107,
  // The face leans back from the bumper's top (s 0.107, 0.573) to the bonnet's lip (0.164,
  // 0.791) [D side]: 0.22 m per m above 0.57, faded out over 0.15 behind the lip.
  frontLean: { base: 0.57, lean: 0.22, blend: 0.15 },
  // Neither the drawing (its left side) nor the left-side photos show a filler; put on the
  // right rear wing over the arch [E: position and side, not seen on a photo].
  flap: { s0: 3.44, s1: 3.55, y0: 0.7, y1: 0.785, side: 'right' },
};

/**
 * AZLK-2141 (the drawing's front and rear views; Commons photos "AZLK-2141 green colored
 * (front view)", "(rear view)", "AZLK-2141 red colored (rear view)", "Red Moskvich 2141
 * (rear)", "Moskwitsch 2141 (side)", "Moscow car meet 2025-07-12 M-2141 02", "Салон
 * Москвич-2141"): rectangular head lamps, the amber indicators wrapping round the corners,
 * a black slatted grille between them, a deep black bumper; tail lamps amber outside, red,
 * the white reversing cell, red inside, wrapping a little onto the wings; a black sill
 * strip; black handles and mirrors; an amber repeater on each front wing.
 */
export const LOOK_2141: KitLook = {
  label: 'AZLK-2141',
  upholstery: 0x4a4b4f, // grey cloth [P "Салон Москвич-2141"]
  dash: 0x2b2c2f, // dark grey plastic [P "Салон Москвич-2141"]
  headrests: true, // [P "Moskwitsch 2141 (rear) (1)": through the tailgate glass]
  brightwork: 'black', // [P handles, mirrors]
  sill: 'black', // [P "Moskwitsch 2141 (front)", D side: dark between the arches]
  waist: null,
  // Amber, on the wing ahead of the door [D side x 235.7–250, y 214.3–220; P green front].
  repeater: { s0: 1.225, s1: 1.305, y0: 0.634, y1: 0.667 },
  // The shoulder line under the windows from the head lamps' top corner to the tail lamps'
  // [D side y 190–193: 0.79–0.806; P "Moskwitsch 2141 (side)"], started where the wing's
  // top rises over it.
  featureLine: { points: [[0.4, 0.8], [4.15, 0.8]], height: 0.012 },
  cornerLamps: [
    // Head lamp ±0.343..0.621, the indicator to the corner (±0.744 seen from the front),
    // 0.584–0.741 [D front]; back along the wing to s 0.336 [D side x 80], ended at 0.30
    // where the wing has rounded out to the flank.
    {
      points: [
        { x: 0.343, y: [0.584, 0.741], role: 'head' },
        { x: 0.621, y: [0.584, 0.741], role: 'blinker' },
        { y: [0.584, 0.741], role: 'blinker' },
        { s: 0.3, y: [0.59, 0.74] },
      ],
    },
    // Tail [D rear: from ±0.36 (the tailgate's shut gap inside it) red, the white reversing
    // cell 0.425–0.546, red to 0.66, amber to the corner, 0.556–0.713; D side: the amber
    // forward on the wing to x 752.5, s 4.18]. The reversing cell is the lower half of its
    // column on the car [P]; full height here.
    {
      end: 'rear',
      points: [
        { x: 0.36, y: [0.556, 0.713], role: 'brake' },
        { x: 0.425, y: [0.556, 0.713], role: 'reverse' },
        { x: 0.546, y: [0.556, 0.713], role: 'tail' },
        { x: 0.66, y: [0.556, 0.713], role: 'blinker' },
        { y: [0.556, 0.713], role: 'blinker' },
        { s: 4.18, y: [0.556, 0.713] },
      ],
    },
  ],
  front: {
    // Black plastic 0.20–0.565 [D side: top 0.563, its lip to 0.194; front 0.577–0.18], its
    // top under the lamps' foot (0.584): the band hangs `drop` under the face's sill bevel
    // (sill 0.25 + 0.035), 0.285 − 0.085. Its sides back along the wings to the front arch
    // [D side x 115, s 0.535; the arch's front 0.513 at the hub's height].
    bumper: { kind: 'moulded', drop: 0.085, height: 0.365, wrapTo: 0.5 },
    items: [
      // Black horizontal slats between the lamps, ±0.343, from the bumper's top to under the
      // lip (0.749) [D front; P].
      {
        kind: 'grille',
        x: { centre: 0.335 },
        y: { from: ['bumperTop', 0.012], to: ['deck', -0.03] },
        back: true,
        bars: { dir: 'horizontal', count: 5, finish: 'black', margin: 0.008, width: 0.008, depth: 0.01, proud: 0.015 },
      },
    ],
  },
  rear: {
    // Black plastic 0.28–0.545 [D side 0.277–0.558, rear 0.277–0.549], its top under the
    // lamps' foot (0.556): 0.355 (sill 0.32 + 0.035) − 0.075. Its sides forward along the
    // wings to the rear arch [D side x 690, s 3.82; the arch's back 3.862].
    bumper: { kind: 'moulded', drop: 0.075, height: 0.265, wrapTo: 3.87 },
    items: [],
  },
};
