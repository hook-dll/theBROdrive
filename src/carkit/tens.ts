/**
 * The "tens" family: VAZ-2110 (saloon), VAZ-2112 (hatchback) and VAZ-2111 (estate).
 * Numbers and sources in measurements-2110.md.
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
 * tail from the 2110). The 2112 hatch and the 2111 estate derive from `BODY_2110` as the
 * 2109 does from the 2108: the same nose, front doors and heights, their own tails.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * The tens' roof in profile from the windscreen's top [D `vaz_2110.jpg` side view, the
 * outline: 1.33 at s 1.75, 1.359 at 1.80, 1.375 at 1.85, 1.387 at 1.90, 1.399 at 1.95, 1.404
 * at 2.0, 1.412 at 2.1, 1.416 at 2.2, 1.42 at 2.3, 1.424 from 2.4; the 2112's and 2111's
 * drawings within 5 mm]: the roof rounding up from the screen over 0.6 m. The screen's top
 * on the centre line comes down only 0.02 (1.389, against the outline's 1.345): lower, the
 * tens' 500 mm blades no longer sweep 90° on the glass (`buildWipers`, from 0.03). From
 * there the roof rises ever less steeply (0.09, 0.08, 0.06, 0.017, 0.004 m per m), so the
 * header, the A pillar's top and the door frames' tops round into it with no fold. Its
 * points stand on the columns' tops (the frames' 1.85 … 2.0, the B pillar's 2.324, the rear
 * glass's 2.44): a point between two tops adds a ring row to the whole greenhouse.
 */
const ROOF_FRONT_TENS: readonly (readonly [number, number])[] = [
  [1.77, 0.02],
  [1.805, 0.02],
  [1.85, 0.016],
  [1.9, 0.012],
  [2.0, 0.006],
  [2.324, 0.0005],
  [2.44, 0],
];

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
    { s: 0.34, sill: 0.28, crease: 0.6, belt: 0.79, deck: 0.83, wSill: 0.735, wCrease: 0.76, wBelt: 0.718 },
    // The bonnet and the wings' top one straight slope from here to the cowl (the drawn
    // 0.89 / 0.85 at s 0.6 lie 15–20 mm over that line; straight reads cleaner).
    // The side between the crease and the belt leans ever more from the nose to the cabin
    // (12.5° at s 0.34, 12.9° at 0.6, 16° along the doors): no station is a crease [D top
    // view: one smooth outline; front view: the side from ±0.831 at the crease (0.63) to
    // ±0.741 at the belt (0.94), 16°, so the doors' belt ±0.73–0.735 under the side glass's
    // foot ±0.73].
    { s: 0.6, sill: 0.275, crease: 0.62, belt: 0.83, deck: 0.873, wSill: 0.775, wCrease: 0.8, wBelt: 0.752 },
    { s: 1.31, sill: 0.258, crease: 0.63, belt: 0.94, deck: 0.99, wSill: 0.795, wCrease: 0.82, wBelt: 0.73 },
    { s: 2.4, sill: 0.258, crease: 0.64, belt: 0.955, deck: 0.99, wSill: 0.8, wCrease: 0.825, wBelt: 0.735 },
    { s: 3.249, sill: 0.262, crease: 0.645, belt: 1.0, deck: 1.02, wSill: 0.788, wCrease: 0.81, wBelt: 0.765 },
    // Back light's foot 1.025 at the side; the boot 1.03 on the centre line.
    { s: 3.7, sill: 0.27, crease: 0.65, belt: 1.01, deck: 1.03, wSill: 0.77, wCrease: 0.792, wBelt: 0.75 },
    { s: 3.95, sill: 0.3, crease: 0.66, belt: 1.0, deck: 1.02, wSill: 0.725, wCrease: 0.745, wBelt: 0.705 },
    // The lid's trailing edge, then the tail face: the lid's foot 0.655 between corner
    // lamps topped at 0.83, cut at ±0.52.
    { s: 4.13, sill: 0.33, crease: 0.66, belt: 0.975, deck: 0.995, wSill: 0.7, wCrease: 0.715, wBelt: 0.68 },
    { s: 4.2, sill: 0.33, crease: 0.66, belt: 0.815, deck: 0.655, notch: 0.52, wSill: 0.675, wCrease: 0.69, wBelt: 0.66 },
  ],
  shoulder: { inset: 0.04, rise: 0.015 },
  cabin: {
    columns: [
      // The A pillar [D: 1.32 at the belt to 1.338 high at 1.768]. Its top rounds into the
      // roof with the roof's profile alone (`roofDrop`): the step drop of the corner
      // (`cornerDrop` 0.037, 1.342) left a fold along the screen's header behind it. Its top
      // at the rail 1.805, so the screen's side edge, raked by the foot ahead of the cowl
      // (`screenFoot`), passes the drawn corner (1.768, 1.338). The columns' tops in front of
      // the B pillar stand on `ROOF_FRONT_TENS` points (1.805, 1.85, 1.9, 2.0): a point
      // between two tops adds a ring row to the whole greenhouse (`buildShell`).
      { s: 1.31, top: 1.805, upper: 'body' },
      { s: 1.325, top: 1.85, upper: 'door1' },
      // The drop glass's front edge [D: 1.385 at the belt], its top front corner cut by a
      // small chamfer inside the frame as the photos' rounded corner (`glassDrop` 0.01), the
      // glass's top back to the frame's width at the next column. The drawn edge rakes back
      // to 1.99 at 1.305 [D, the glass's outline]; the glass is held 0.1 forward of that so
      // at the door's middle it stands to 1.32, near the window's 1.346 top: tops at 2.0 /
      // 2.06, or the 0.05 chamfer, left 1.28–1.30 there.
      { s: 1.385, top: 1.9, upper: 'door1', glass: 'drop', glassDrop: 0.01 },
      { s: 1.45, top: 2.0, upper: 'door1', glass: 'drop' },
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
      { s: 3.7, top: 3.141 },
    ],
    rail: 1.379,
    railHalf: 0.53,
    crown: 0.03,
    railInset: 0.035,
    // The roof's edge rounds into the side glass [D front view: the outline's corners turn
    // over ~15 px, 0.06].
    railBend: [0.3, 0.6],
    railRise: 0.015,
    // The roof rounding into the screen, then down to the back light [D: 1.42 at 2.75, 1.416
    // at 2.85, 1.408 at 2.95, 1.399 at 3.0, 1.395 at 3.05, 1.387 at 3.1, 1.371 at 3.15].
    roofDrop: [...ROOF_FRONT_TENS, [2.6, 0], [2.85, 0.008], [3.0, 0.025], [3.106, 0.036], [3.141, 0.036]],
    glassBottom: 0.012,
    glassTop: 0.035,
    screenBottom: 0.03,
    screenHeader: 0.045,
    // Both blades 500 mm (factory part 2110-5205070; parts catalogues list 500 / 500).
    wiperBlade: 0.5,
    // The screen's foot on the centre line at s 1.154 on the bonnet [D side view].
    screenFoot: 0.222,
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
    // The front arch 0.34 wide and 0.355 high, 0.015 ahead of the hub [D10, D11, D12:
    // 0.345-0.35 ahead, 0.31-0.33 behind]; the rear covers the tyre's top, 0.305 wide and
    // 0.274 high [P s1: 0.93 R over the hub, 1.03-1.08 R at the hub's height; D11 0.265;
    // the D10's flat top at 0.185 is stylised] (refs archFront / archRear).
    arch: 1.18,
    frontArchRise: 1.235,
    rearArch: 1.06,
    rearArchRise: 0.95,
    archShift: [-0.015, 0],
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
  mirrorS: 1.488,
  mirrorHeightOffset: -0.04,
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
  // The hatchback's rear arch reaches 2 cm further forward [D12: 0.35 ahead, 0.31 behind].
  wheels: { ...BODY_2110.wheels, rearArch: 1.1, archShift: [-0.015, -0.02] },
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
      ...BODY_2110.cabin.columns.slice(0, 12),
      // The quarter glass's rear corner on the belt [D: x 1540, y 148] and the D pillar.
      { s: 3.71, top: 3.26, upper: 'body' },
      // The roof's rear end [D: x 1433, 1.333 on the outline] over the tailgate's foot.
      { s: 4.1, top: 3.285 },
    ],
    // The tailgate folds over the lamps: glass above to the roof, the lower panel upright
    // below, raked by `rearLean`.
    rearKnee: { s: 4.095, y: 1.0 },
    // The roof falling to the tailgate's top [D `vaz_2112.jpg`, the outline: 1.413 at 2.75,
    // 1.409 at 2.85, 1.401 at 2.95, 1.389 at 3.05, 1.373 at 3.15, 1.361 at 3.2, 1.349 at 3.25,
    // 1.337 at 3.3].
    roofDrop: [...ROOF_FRONT_TENS, [2.6, 0], [2.85, 0.01], [3.05, 0.03], [3.2, 0.058], [3.25, 0.072], [3.285, 0.072]],
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

/**
 * VAZ-2111: the 2110 to the rear door's belt, then an estate [D `vaz_2111.jpg`, 4.185 mm/px
 * from the drawn 2492 wheelbase: hubs x 798 / 1393.5, ground y 416, tip x 600; its tips
 * give 4285, the factory length]. The rear door's frame runs further back at the rail
 * (3.12, the saloon's 3.001); behind it a pillar, a long quarter glass in the body to 3.9
 * at the belt (3.78 at the rail) and a D pillar; the roof runs on at the rail to 3.97; the
 * tailgate's glass falls to the knee (1.04 at 4.138) and its lower panel comes down to the
 * bumper (0.52) between corner lamps topped at 0.89, the plate on it, the whole back raked
 * 0.1 m per m (`rearLean`) [P Commons "2011 Lada 211120-82 grey rear", "Lada 111 arriere"].
 */
export const BODY_2111: KitBody = {
  ...BODY_2110,
  length: 4.285,
  stations: [
    ...BODY_2110.stations.slice(0, 9),
    // The D pillar's foot under the quarter glass's rear corner [D: glass bottom y 167,
    // 1.042, at x 1535].
    { s: 3.95, sill: 0.3, crease: 0.68, belt: 1.03, deck: 1.04, wSill: 0.725, wCrease: 0.745, wBelt: 0.705 },
    // The tail face, the tailgate's foot (rearBase) in it at 0.52 [D rear view: 0.19 under
    // the lamps; side view: the tailgate's line to y 293]; the corner lamps 0.735–0.89 [D
    // side view: the feature line meets the tail at y 203.5] on the corners beside it. Below
    // the lamps the tail stands out over the bumper [D side view, the outline: 4.274 at
    // 0.569, 4.282 at 0.485 (the bumper's top), 4.24 at 0.695, 4.215 at 0.74–0.78].
    { s: 4.265, sill: 0.3, crease: 0.7, belt: 0.89, deck: 0.52, wSill: 0.675, wCrease: 0.69, wBelt: 0.66, flat: 1 },
  ],
  cabin: {
    ...BODY_2110.cabin,
    columns: [
      ...BODY_2110.cabin.columns.slice(0, 9).map((column, index) =>
        index === 1 ? { ...column, s: 1.273 } : index === 2 ? { ...column, s: 1.333 } : column),
      // The rear door's frame: its glass's rear edge [D: x 1363 at the belt, 1340 high] and
      // the shut line [D: x 1378 at the belt, 1350 at the rail]; below the belt the 2110's
      // raked foot [D: upright to y 215, 0.84, then forward to the sill].
      { s: 3.205, top: 3.08, upper: 'door2' },
      { s: 3.249, top: 3.12, upper: 'body', foot: { y: 0.805, s: 2.9, round: [0.17, 0.03] } },
      // The pillar behind it, then the quarter glass in the body [D: x 1383 / 1353 front,
      // 1535 / 1503 rear, at the belt / under the rail].
      { s: 3.275, top: 3.15, upper: 'body', glass: 'fixed' },
      // The D pillar.
      { s: 3.9, top: 3.78, upper: 'body' },
      // The roof's rear end [D: the outline's corner at x 1550, 3.976; the line at x 1520 is
      // the glass's top edge inside it] over the tailgate's foot.
      { s: 4.265, top: 3.97 },
    ],
    // The tailgate folds at the glass's foot [D: the outline at y 167–170, x 1586–1588:
    // 1.03–1.04 at 4.123–4.131 once raked]: glass above to the roof, the lower panel below.
    rearKnee: { s: 4.265, y: 1.04 },
    // Level under the rails to the D pillar, then rounding down to the tailgate's top [D:
    // 1.423 at 3.9, 1.394 at 3.95, 1.335 at 4.0].
    roofDrop: [...ROOF_FRONT_TENS, [3.8, 0], [3.935, 0.024], [3.97, 0.04]],
  },
  bootEnd: undefined,
  // The back above the tailgate's foot leans forward 0.2 m per m [D side view, the outline:
  // 4.24 at 0.695, 4.215 at 0.78, 4.181 at 0.904, 4.123 at 1.03; built: 4.21 at 0.8, 4.16
  // at the knee]. Based on the foot's row (0.52): a base between rows (0.6) folded the
  // lower panel's faces across it.
  rearLean: { base: 0.52, lean: 0.2, blend: 0.3 },
  // Over the rear arch's back [D: x 1435–1485, y 213–243; the drawing shows the left side,
  // the flap is on the right as on the 2110].
  flap: { s0: 3.494, s1: 3.704, y0: 0.724, y1: 0.85 },
};

/**
 * The 2111's look: the 2110's front and flanks, no spoiler; at the back the 2112's
 * arrangement at the estate's heights: corner lamps (indicator over the tail and stop lamp)
 * wrapping onto the wings, a smoked reversing lamp at each end of the tailgate and one red
 * bar between them [D rear view: the cells ±0.374..±0.556, the bar ±0.374; P "2011 Lada
 * 211120-82 grey rear"], the plate on the tailgate's lower panel under them.
 */
export const LOOK_2111: KitLook = {
  ...LOOK_2110,
  label: 'VAZ-2111',
  cornerLamps: [
    LOOK_2110.cornerLamps![0]!,
    {
      end: 'rear',
      points: [
        { x: 0.555, y: [0.815, 0.885], role: 'blinker' },
        { y: [0.815, 0.885], role: 'blinker' },
        { s: 4.06, y: [0.815, 0.885] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: 0.555, y: [0.735, 0.815], role: 'brake' },
        { y: [0.735, 0.815], role: 'tail' },
        { s: 4.06, y: [0.735, 0.815] },
      ],
    },
  ],
  // The 2110's line, then rising to the lamps' top at the tail [D: y 208 at x 1520, 203.5
  // at x 1600].
  featureLine: {
    points: [
      [0.34, 0.735],
      [0.745, 0.763],
      [1.07, 0.78],
      [2.05, 0.8],
      [3.2, 0.829],
      [3.85, 0.87],
      [4.05, 0.886],
    ],
    height: 0.012,
  },
  rear: {
    // Its top at the tailgate's foot [D rear view: y 777, 0.49].
    bumper: { kind: 'moulded', drop: 0.055, height: 0.21, finish: 'paint', wrapTo: 3.63, flush: true },
    items: [],
    lid: [
      {
        kind: 'cluster',
        x: { from: { centre: 0.535 }, to: { centre: 0.374 } },
        y: { from: ['belt', -0.155], to: ['belt', -0.005] },
        columns: [['reverse']],
      },
      { kind: 'lens', role: 'inert', x: { at: { centre: 0 }, half: 0.369 }, y: { from: ['belt', -0.151], to: ['belt', -0.009] }, depth: 0.008, proud: 0.01 },
    ],
  },
};
