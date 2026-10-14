/**
 * The "tens" family: VAZ-2110 (saloon) and VAZ-2112 (hatchback). Numbers and sources in
 * measurements-2110.md.
 *
 * Measured on 3dcar.ru's `vaz_2110.jpg` (side view 4.092 mm/px from the drawn 2492
 * wheelbase: hubs x 819.5 / 1428.5, ground y 408; its tips give 4268 against the
 * factory 4265) and Wikimedia Commons photos for what the drawing leaves out or gets
 * wrong: the fixed rear quarter glass in the body behind the rear door, the rear arch
 * hugging the tyre, the fuel flap on the right (the drawing is mirrored), the lamps.
 *
 * Not a Samara: a longer wheelbase, a wedge waist rising 60 mm from the A to the C
 * pillar, a greenhouse narrowing more to the roof, the rear door's shut line raked back
 * along the C pillar with a fixed quarter glass in the body behind it, and a boot lid
 * that comes down between the corner lamps carrying the lamp bar (the 2115 took this
 * tail from the 2110). The 2112 hatch derives from `BODY_2110` as the 2109 does from the
 * 2108: the same nose, doors and heights, its own tail.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * VAZ-2110: overhangs 825 / 940 over a 2492 wheelbase. The face raked from the bumper's
 * top (0.575) at s 0.04 to the bonnet's lip (0.708) at s 0.115; the bonnet climbs to 0.99
 * at the screen; the A pillar from 1.31 at the belt to the roof's front at 1.768; roof
 * 1.424, its rail 1.379 to 3.14; the back light down to its foot at 3.556, 1.025 high;
 * the boot 1.03 falling to 0.99 at its trailing edge and down the tail face to the lid's
 * foot (0.655) between the corner lamps. Sill 0.258, door bottoms 0.30, belt 0.94 at the
 * A pillar rising to 1.0 at the rear door's shut line. Front door 1.325 to 2.33, rear
 * door 2.33 to 3.249 at the belt (3.001 at the rail).
 */
export const BODY_2110: KitBody = {
  length: 4.265,
  platform: 'samara',
  stations: [
    // The face: lamps between the bumper's top and the bonnet's lip, standing at the
    // bumper's top (s 0.04) and raked back by `frontLean`. The nose rounds in plan [D top
    // view]: at lamp height 0.585 at the face, 0.597 at s 0.13, 0.70 by s 0.25; lower down
    // it is as wide as the bumper's corners (0.634 at s 0.09), which hide it.
    { s: 0.04, sill: 0.3, crease: 0.58, belt: 0.7, deck: 0.715, wSill: 0.655, wCrease: 0.665, wBelt: 0.585 },
    { s: 0.17, sill: 0.29, crease: 0.59, belt: 0.745, deck: 0.77, wSill: 0.685, wCrease: 0.705, wBelt: 0.655 },
    { s: 0.25, sill: 0.285, crease: 0.595, belt: 0.77, deck: 0.8, wSill: 0.71, wCrease: 0.735, wBelt: 0.69 },
    // The lamp's wrap ends; the wing's top (the bonnet's shut line) rises to the cowl. The
    // floor under the engine (hidden by the bumper and the arch) stands 0.275 high, so the
    // sump clears the ground by the factory clearance.
    { s: 0.34, sill: 0.28, crease: 0.6, belt: 0.79, deck: 0.83, wSill: 0.735, wCrease: 0.76, wBelt: 0.715 },
    // The bonnet and the wings' top one straight slope from here to the cowl (the drawn
    // 0.89 / 0.85 at s 0.6 lie 15–20 mm over that line; straight reads cleaner).
    { s: 0.6, sill: 0.275, crease: 0.62, belt: 0.83, deck: 0.873, wSill: 0.775, wCrease: 0.8, wBelt: 0.755 },
    { s: 1.31, sill: 0.258, crease: 0.63, belt: 0.94, deck: 0.99, wSill: 0.795, wCrease: 0.82, wBelt: 0.775 },
    { s: 2.4, sill: 0.258, crease: 0.64, belt: 0.955, deck: 0.99, wSill: 0.8, wCrease: 0.825, wBelt: 0.78 },
    { s: 3.249, sill: 0.262, crease: 0.645, belt: 1.0, deck: 1.02, wSill: 0.788, wCrease: 0.81, wBelt: 0.765 },
    // Back light's foot 1.025 at the side; the boot 1.03 on the centre line.
    { s: 3.556, sill: 0.27, crease: 0.65, belt: 1.01, deck: 1.03, wSill: 0.77, wCrease: 0.792, wBelt: 0.75 },
    { s: 3.95, sill: 0.3, crease: 0.66, belt: 1.0, deck: 1.02, wSill: 0.725, wCrease: 0.745, wBelt: 0.705 },
    // The lid's trailing edge, then the tail face: the lid's foot 0.655 between corner
    // lamps topped at 0.83, cut at ±0.52.
    { s: 4.13, sill: 0.33, crease: 0.66, belt: 0.975, deck: 0.995, wSill: 0.7, wCrease: 0.715, wBelt: 0.68 },
    { s: 4.2, sill: 0.33, crease: 0.66, belt: 0.815, deck: 0.655, notch: 0.52, wSill: 0.675, wCrease: 0.69, wBelt: 0.66 },
  ],
  shoulder: { inset: 0.04, rise: 0.015 },
  cabin: {
    columns: [
      // The A pillar [D: 1.32 at the belt to 1.338 high at 1.768], its top chamfered into
      // the rail as the drawn line rounds into the roof (1.342 at 1.77 → the rail's 1.379 at
      // 1.85); the front door's frame and glass run up behind it to that rounded corner.
      { s: 1.31, top: 1.77, upper: 'body', drop: 0.037 },
      { s: 1.325, top: 1.85, upper: 'door1' },
      { s: 1.385, top: 1.89, upper: 'door1', glass: 'drop' },
      // The B pillar: the two doors' frames meet on it; the doors share one shut line
      // below the belt at 2.33.
      { s: 2.269, top: 2.324, upper: 'door1' },
      { s: 2.32, top: 2.375, upper: 'body', lower: 'door1' },
      { s: 2.33, top: 2.385, upper: 'body', lower: 'door2' },
      { s: 2.34, top: 2.395, upper: 'door2' },
      { s: 2.398, top: 2.44, upper: 'door2', glass: 'drop' },
      // The rear door's drop glass ends on its frame, whose rear edge is the shut line,
      // raked back along the C pillar from the belt to the rail. Below the belt it runs
      // upright to 0.805, then straight forward to 2.90 at the doors' bottom [D: (1413.75,
      // 210) → (1326.9, 335), 0.696 px/px], in front of the rear arch; its upper turn
      // rounded at 0.17, its lower one at 0.03 [P s1, 1.088 mm/px].
      { s: 3.205, top: 2.96, upper: 'door2' },
      { s: 3.249, top: 3.001, upper: 'body', foot: { y: 0.805, s: 2.9, round: [0.17, 0.03] } },
      // The fixed quarter glass in the body [P], its rear edge the C pillar's front.
      { s: 3.27, top: 3.015, upper: 'body', glass: 'fixed' },
      // The C pillar, 0.10 wide, parallel to the back light.
      { s: 3.456, top: 3.041, upper: 'body' },
      { s: 3.556, top: 3.141 },
    ],
    rail: 1.379,
    railHalf: 0.53,
    crown: 0.03,
    railInset: 0.035,
    railRise: 0.015,
    glassBottom: 0.012,
    glassTop: 0.035,
    screenBottom: 0.03,
    screenHeader: 0.045,
    // The screen's foot on the centre line at s 1.154 on the bonnet [D side view].
    screenFoot: 0.156,
    rearBottom: 0.025,
    rearHeader: 0.05,
    pillar: 0.07,
  },
  wheels: {
    front: 0.825,
    rear: 3.317,
    radius: 0.288,
    width: 0.175,
    frontHalfTrack: 0.7,
    rearHalfTrack: 0.685,
    // The front arch stands clear of the tyre; the rear one is as wide as the tyre and
    // covers its top [P s1: top 0.81 R over the hub, 1.0 R wide at the hub's height].
    arch: 1.2,
    rearArch: 1.0,
    rearArchRise: 0.81,
  },
  doorBottom: 0.3,
  bonnetFront: 0.04,
  // The face rakes back from the crease under the lamps (0.58, s 0.04) to the bonnet's lip
  // (0.708, s 0.115) [D side view], in full back to the indicators' end (0.2) so the lamps
  // lean with the faces they lie on, faded out over 0.6 behind that so the bonnet's top
  // stays one plain surface.
  frontLean: { base: 0.58, lean: 0.586, blend: 0.6, full: 0.2 },
  // The bonnet covers the whole top: its side shut lines run along the wings' top edge
  // from the lamps' outer ends to the A pillar's foot [P f2, f3; D top view: the line
  // 0.035 in from the outline]. Its nose comes down the face between the head lamps to
  // their bottom [D front view: ±0.279 at 0.60 to the lamps' inner ends at the lip].
  bonnet: { inset: 0.01, nose: { y: 0.6, half: [0.278, 0.298] } },
  // The lid comes down the tail face between the corner lamps.
  bootEnd: 4.2,
  flap: { s0: 3.71, s1: 3.905, y0: 0.7, y1: 0.81 },
};

/**
 * The early (1996–2003) 2110's look, the base "21100 / 21102" without spoiler or door
 * mouldings (front view of the drawing, photos "1998 Lada 21100 blue front", "2003 Lada
 * 21102 black rear", "2004 Lada 21102 silver rear"): narrow head lamps whose inner ends
 * lean out to the top, the indicator wrapping round the wing, a dark slot between them
 * under the bonnet's lip; deep body-colour bumpers, the front one rounded in plan with a
 * dark intake and fog-lamp recesses; a feature line along the flank under the windows;
 * corner lamps on the body (the indicator over the tail and stop lamp) and a lamp bar on
 * the boot lid between them: a smoked reversing lamp at each end and one red reflector
 * across the middle.
 */
export const LOOK_2110: KitLook = {
  label: 'VAZ-2110',
  upholstery: 0x3a3c41,
  dash: 0x1f2123,
  headrests: true,
  brightwork: 'black',
  sill: null,
  waist: null,
  repeater: { s0: 1.14, s1: 1.215, y0: 0.696, y1: 0.728 },
  // The lamp units, flush with the body and wrapping round its corners.
  cornerLamps: [
    // Front: the head lamp from its leaning inner end [D front view: 0.283 / 0.303] across
    // the face to the corner; the indicator, solid amber, round the corner and a short way
    // back along the flank, narrowing [P: a small corner cell].
    {
      points: [
        { x: [0.283, 0.303], y: [0.606, 0.7], role: 'head' },
        { y: [0.606, 0.7], role: 'blinker' },
        { s: 0.2, y: [0.62, 0.7] },
      ],
    },
    // Tail, from the lid's slanted edge (0.495 at its foot to 0.52 at the lamps' top, 10 mm
    // clear of it) round the corner and 0.14 forward along the wing [P s1: 123 px at 1.085
    // mm/px, its front edge leaning 16 mm back at the foot], up to the tail's belt (0.815)
    // so the lens stays on the flat side and face and the corner's shoulder above it is a
    // straight cut; the indicator over the top 45 %, the stop and tail lamps below it [P
    // s1: smoked 76 px over red 62 px; r4].
    {
      end: 'rear',
      points: [
        { x: [0.518, 0.528], y: [0.743, 0.815], role: 'blinker' },
        { y: [0.743, 0.815], role: 'blinker' },
        { s: 4.06, y: [0.743, 0.815] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.505, 0.518], y: [0.655, 0.743], role: 'brake' },
        { x: 0.6, y: [0.655, 0.743], role: 'tail' },
        { y: [0.655, 0.743], role: 'tail' },
        { s: 4.075, y: [0.655, 0.743] },
      ],
    },
  ],
  // The feature line under the windows, rising from the lamp to the tail lamps' top
  // [D side view, readings every 40 px].
  featureLine: {
    points: [
      [0.34, 0.735],
      [0.745, 0.763],
      [1.07, 0.78],
      [2.05, 0.8],
      [3.2, 0.829],
      [4.02, 0.845],
      [4.16, 0.85],
    ],
    height: 0.012,
  },
  front: {
    // Rounded in plan, its sides lying on the wings back to the front wheel arch (0.479)
    // [D side view: the bumper wraps back to s 0.50], its foot in line with the sill; flush
    // with the body, its top growing out of the face below the lamps (0.565 [D]), never
    // over them.
    bumper: { kind: 'moulded', drop: 0.08, height: 0.345, finish: 'paint', corner: 0.28, wrapTo: 0.47, flush: true },
    items: [
      // Fog-lamp recesses (blanks on most cars) in the bumper's lower band.
      { kind: 'panel', x: { from: { centre: 0.3 }, to: { centre: 0.475 } }, y: { from: ['bumperBottom', 0.037], to: ['bumperBottom', 0.118] }, finish: 'black', proud: 0.045 },
      // The dark intake between them, out at the bumper's face: 2 mm ahead of the groove's
      // ridge (6 mm proud on the centre line), so the groove stops at it instead of
      // crossing its face in one plane.
      {
        kind: 'grille',
        x: { centre: 0.287 },
        y: { from: ['bumperBottom', 0.055], to: ['bumperBottom', 0.135] },
        standOut: 0.024,
        back: true,
        bars: { dir: 'vertical', count: 2, finish: 'paint', margin: 0, width: 0.02, depth: 0.01, proud: 0.005 },
      },
    ],
    // The dark slot on the bonnet's nose, under its lip between the lamps' inner ends.
    lid: [
      {
        kind: 'grille',
        x: { centre: 0.27 },
        y: { from: ['deck', -0.075], to: ['deck', -0.015] },
        back: true,
        bars: { dir: 'horizontal', count: 2, finish: 'black', margin: 0, width: 0.01, depth: 0.01, proud: 0.012 },
      },
    ],
  },
  rear: {
    // Flush with the body, its sides on the wings forward to the rear arch (3.605).
    bumper: { kind: 'moulded', drop: 0.055, height: 0.34, finish: 'paint', wrapTo: 3.63, flush: true },
    // The corner lamps are `cornerLamps`, wrapping onto the wings.
    items: [],
    lid: [
      // On the lid: a smoked reversing lamp at each end, inside the lid's edge (0.495 at
      // its foot), and one red reflector across the middle between them [P r4, r2].
      {
        kind: 'cluster',
        x: { from: { centre: 0.49 }, to: { centre: 0.4 } },
        y: { from: ['bumperTop', 0.008], to: ['deck', -0.008] },
        columns: [['reverse']],
      },
      { kind: 'lens', role: 'inert', x: { at: { centre: 0 }, half: 0.395 }, y: { from: ['bumperTop', 0.012], to: ['deck', -0.012] }, depth: 0.008, proud: 0.01 },
    ],
  },
};

/**
 * VAZ-2112: the 2110 to the rear door, then a hatch [D `vaz_2112.jpg`, 3.98 mm/px from the
 * drawn 2492 wheelbase: hubs x 815 / 1441, ground y 410; photos "LADA 112 in Togliatti
 * rear", "2008 Lada 211240 dark purple rear"]. Behind the rear door a quarter glass in the
 * body to 3.71 at the belt and a wide D pillar; the roof ends at 3.285 and the tailgate's
 * glass falls to the knee over the lamps; the tailgate comes down to the bumper's top
 * between corner lamps topped at 0.865 (a flat sill, like the estates'), its lower panel
 * raked back 0.2 m per m. 4170 long, 95 mm shorter than the saloon.
 */
export const BODY_2112: KitBody = {
  ...BODY_2110,
  length: 4.17,
  stations: [
    ...BODY_2110.stations.slice(0, 9),
    // The D pillar's foot: the side's top under the tailgate's edge.
    { s: 3.95, sill: 0.3, crease: 0.66, belt: 0.99, deck: 1.0, wSill: 0.725, wCrease: 0.745, wBelt: 0.7 },
    // The tail face, the tailgate's bottom (rearBase) in it: the lamps 0.71–0.865 [D side
    // view: y 232.5–192.5] on the corners, the tailgate between them cut at ±0.545 (photo:
    // ±0.50), its foot on the bumper's top, flush with the lamps.
    { s: 4.1, sill: 0.33, crease: 0.7, belt: 0.865, deck: 0.71, wSill: 0.675, wCrease: 0.685, wBelt: 0.655, flat: 1 },
  ],
  cabin: {
    ...BODY_2110.cabin,
    columns: [
      ...BODY_2110.cabin.columns.slice(0, 11),
      // The quarter glass's rear corner on the belt [D: x 1540, y 148] and the D pillar.
      { s: 3.71, top: 3.26, upper: 'body' },
      // The roof's rear end [D: x 1433, 1.333 on the outline] over the tailgate's foot.
      { s: 4.1, top: 3.285 },
    ],
    // The tailgate folds over the lamps: glass above to the roof, the lower panel upright
    // below, raked by `rearLean`.
    rearKnee: { s: 4.095, y: 1.0 },
  },
  bootEnd: undefined,
  rearLean: { base: 0.71, lean: 0.2, blend: 0.3 },
  // Over the rear arch's back, ahead of the lamps [D: x 1473–1520, y 200–232].
  flap: { s0: 3.45, s1: 3.64, y0: 0.71, y1: 0.83 },
};

/**
 * The 2112's look: the 2110's front and flanks; at the back the corner lamps (indicator
 * over the tail and stop lamp) wrap 0.18 forward onto the wings, and the tailgate carries
 * a smoked reversing lamp at each end and one red bar across the middle [P "LADA 112 in
 * Togliatti rear": the lamps ±0.50..0.68, the reversing cells ±0.32..0.50, the bar ±0.32].
 */
export const LOOK_2112: KitLook = {
  ...LOOK_2110,
  label: 'VAZ-2112',
  // The wing across the tailgate's glass at its foot, the high brake lamp under its middle
  // [D side view: leading edge on the glass at s 3.858, 1.095; top 1.07 to the tip 0.05
  // behind the lower panel's top; P "LADA 112 in Togliatti rear"]. Given before `rearLean`,
  // which carries it back with the tailgate.
  spoiler: {
    half: 0.56,
    plate: 0.04,
    s0: 3.915,
    s1: 4.155,
    top0: 1.095,
    top1: 1.075,
    thickness: 0.04,
    foot: 3.915,
    pedestal: { half: 0.12, s0: 4.0, s1: 4.09 },
    lamp: { half: 0.1, y0: 1.008, y1: 1.032 },
  },
  cornerLamps: [
    LOOK_2110.cornerLamps![0]!,
    {
      end: 'rear',
      points: [
        { x: 0.555, y: [0.79, 0.86], role: 'blinker' },
        { y: [0.79, 0.86], role: 'blinker' },
        { s: 3.92, y: [0.79, 0.86] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: 0.555, y: [0.715, 0.79], role: 'brake' },
        { y: [0.715, 0.79], role: 'tail' },
        { s: 3.92, y: [0.715, 0.79] },
      ],
    },
  ],
  // The 2110's line, running into the lamps' front end at their top [D: y 191].
  featureLine: {
    points: [
      [0.34, 0.735],
      [0.745, 0.763],
      [1.07, 0.78],
      [2.05, 0.8],
      [3.2, 0.829],
      [3.9, 0.862],
    ],
    height: 0.012,
  },
  rear: {
    bumper: { kind: 'moulded', drop: 0.055, height: 0.39, finish: 'paint', wrapTo: 3.63, flush: true },
    items: [],
    // At the corner lamps' height (0.715–0.86), on the tailgate's foot.
    lid: [
      {
        kind: 'cluster',
        x: { from: { centre: 0.535 }, to: { centre: 0.36 } },
        y: { from: ['belt', -0.15], to: ['belt', -0.005] },
        columns: [['reverse']],
      },
      { kind: 'lens', role: 'inert', x: { at: { centre: 0 }, half: 0.355 }, y: { from: ['belt', -0.146], to: ['belt', -0.009] }, depth: 0.008, proud: 0.01 },
    ],
  },
};
