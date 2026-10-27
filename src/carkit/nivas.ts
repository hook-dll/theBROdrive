/**
 * The Niva family: VAZ-2121 (three doors) and the VAZ-2131 (five doors, 500 longer) on
 * its shell. Numbers and sources in measurements-niva.md.
 *
 * Measured on the factory four-view `niva.jpg` (undimensioned; side view 3.632 mm/px from
 * the drawn 2200 wheelbase: hubs x 880.5 / 1486.3, ground y 522; its tips give 3733
 * against the factory 3720–3740; the front and rear views share the scale, their tracks
 * read 1431 / 1389 against 1430 / 1400) and Wikimedia Commons photos of early cars for
 * what the drawing cannot say: the fuel flap on the right rear wing just behind the door
 * (dashed on the drawing: the far side), the lamps' colours, the bumpers' finish.
 *
 * The early car (1977–1993): round head lamps at the ends of a black grille panel in a
 * thin chrome outline, the indicator and side lamp units on the wings' top corners under
 * the bonnet's lip, bare aluminium bumpers with a black lower half and black end caps,
 * a vent wing in the long door, a big fixed side glass, a tailgate hinged at the roof
 * down to a high load sill over the tail lamps, large arches.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * VAZ-2121: overhangs 688 / 845 over a 2200 wheelbase. An upright face (s 0.15) from the
 * bumper's top (0.556) to the bonnet's lip (0.965), the bonnet climbing to 1.05 at the
 * cowl; the A pillar from 1.152 at the belt (1.01) to the roof's front at 1.583; rail
 * 1.496, roof 1.58; the tailgate raked 0.586 m/m from the roof (3.29) to its glass's foot
 * (3.555, 1.044) and down to the load sill (0.79) over the tail lamps. Sill 0.258, door
 * bottom 0.428, a pressed crease along the flank at 0.87. One door 1.322 to 2.317 below
 * the belt, its vent wing to a post at 1.685; B pillar 2.295–2.35; the fixed side glass
 * to 3.175 (3.10 at the rail); a wide D pillar.
 */
export const BODY_2121: KitBody = {
  length: 3.733, // drawn tips x 691 / 1719 [D]; factory 3720 (infocar.ua) / 3740 (ru.wikipedia)
  platform: 'niva',
  stations: [
    // The face, upright [D side x 723–735]: flat across to ±0.714 [D front, top views], the
    // corners turning to ±0.75 by s 0.19 and ±0.79 by s 0.27 [D top]. Its foot hides behind
    // the bumper (0.439–0.556) [E 0.45]; the wings' top 0.946 at the corner, the bonnet's
    // lip 0.965–0.981 [D side].
    { s: 0.15, sill: 0.45, crease: 0.86, belt: 0.93, deck: 0.965, wSill: 0.72, wCrease: 0.73, wBelt: 0.72 },
    { s: 0.2, sill: 0.43, crease: 0.865, belt: 0.945, deck: 0.985, wSill: 0.75, wCrease: 0.76, wBelt: 0.75 },
    // Wing's top (the bonnet's shut line) and the bonnet's centre [D side lines 0.951 / 0.993
    // at s 0.25, 0.993 / 1.033 at s 0.61, 1.004 / 1.044 from s 0.9].
    // The corner in plan one curve onto the flank through the drawn ±0.786 at s 0.27 [D top]
    // (0.79 here; it was 0.80, and the side turned 24° at this one station between 4.4° and
    // 2.7°: kit-surface) and a station at 0.4 at ±0.808, nearly the flank's 0.815 [D top,
    // front]: the rows turn 12° / 6.5° / 2° at s 0.28 / 0.4 / 0.6; its heights on the line.
    { s: 0.28, sill: 0.42, crease: 0.87, belt: 0.96, deck: 1.0, wSill: 0.78, wCrease: 0.79, wBelt: 0.78 },
    { s: 0.4, sill: 0.4125, crease: 0.87, belt: 0.9724, deck: 1.0124, wSill: 0.79, wCrease: 0.808, wBelt: 0.798 },
    { s: 0.6, sill: 0.4, crease: 0.87, belt: 0.993, deck: 1.033, wSill: 0.795, wCrease: 0.815, wBelt: 0.805 },
    // Cowl. Flank 0.808–0.815 from 0.6 to 1.0 high [D front, top views], the crease the
    // upper of two pressed lines (0.879 / 0.839) [D side]; sill 0.258 [D side y 451].
    { s: 1.152, sill: 0.26, crease: 0.87, belt: 1.005, deck: 1.05, wSill: 0.795, wCrease: 0.815, wBelt: 0.828 },
    { s: 2.3, sill: 0.258, crease: 0.87, belt: 1.01, deck: 1.05, wSill: 0.795, wCrease: 0.815, wBelt: 0.828 },
    // Over and behind the rear arch: the body's bottom 0.44–0.46 behind it [D side].
    { s: 3.2, sill: 0.4, crease: 0.87, belt: 1.005, deck: 1.05, wSill: 0.795, wCrease: 0.815, wBelt: 0.805 },
    { s: 3.45, sill: 0.44, crease: 0.865, belt: 1.0, deck: 1.05, wSill: 0.785, wCrease: 0.805, wBelt: 0.795 },
    // The rear corners rounding onto a tail face flat to ±0.72 [D rear view line x 162].
    // The belt ends here on the tailgate's raked line (s 3.58 at 1.0) [D side].
    { s: 3.58, sill: 0.45, crease: 0.86, belt: 1.0, deck: 1.05, wSill: 0.77, wCrease: 0.785, wBelt: 0.775 },
    // rearBase: the tailgate's foot, the load sill 0.79 on the centre line [D side 0.792,
    // rear view 0.799]; the lamp panel below it. The real corners turn upright at 0.897
    // [D side (3.64, 0.897)]; here the D pillar runs down the raked line to the sill's
    // height, flush with the tailgate (as the Samara's does), straightened by 0.1.
    { s: 3.655, sill: 0.45, crease: 0.72, belt: 0.775, deck: 0.79, wSill: 0.73, wCrease: 0.745, wBelt: 0.735 },
    // Tail face [D side x 1700]; valance behind the bumper [E 0.45].
    { s: 3.668, sill: 0.45, crease: 0.72, belt: 0.775, deck: 0.79, wSill: 0.71, wCrease: 0.725, wBelt: 0.715 },
  ],
  // Glass foot ±0.74–0.76 over a flank at ±0.805 [D front view]; the bonnet's edge 0.02
  // over the wings' top [D side].
  shoulder: { inset: 0.05, rise: 0.02 },
  cabin: {
    columns: [
      // A pillar's front edge: x 1008 at the belt → 1127 at the rail [D side line fit].
      { s: 1.152, top: 1.583, upper: 'body' },
      // The door's frame runs up the pillar; below the belt the wing reaches back to the
      // door's front shut line at 1.322 [D side x 1055].
      { s: 1.236, top: 1.65, upper: 'door1', lower: 'body' },
      { s: 1.266, top: 1.68, upper: 'door1', glass: 'vent', lower: 'body' },
      { s: 1.322, top: 1.683, upper: 'door1', glass: 'vent' },
      // Vent wing's rear post, upright [D side x 1156–1162; P the 1982 car's door].
      { s: 1.685, top: 1.685, upper: 'door1' },
      { s: 1.705, top: 1.705, upper: 'door1', glass: 'drop' },
      // Glass's rear edge 2.255, frame to the B shut line 2.295 [D side x 1312 / 1323].
      { s: 2.255, top: 2.255, upper: 'door1' },
      // Below the belt the door runs on to 2.317 [D side x 1329].
      { s: 2.295, top: 2.295, upper: 'body', lower: 'door1' },
      { s: 2.317, top: 2.317, upper: 'body' },
      // Big fixed side glass from 2.35 [D side x 1340] to its rear edge, near upright
      // (x 1565 low, 1535 at the top: its rounded top corner straightened) [D].
      { s: 2.35, top: 2.35, upper: 'body', glass: 'fixed' },
      { s: 3.175, top: 3.1, upper: 'body' },
      // The belt turns down the raked line here (station 3.58): a column of its own, so the
      // D pillar's last strip does not fold across a bend of the tub inside it (lab: the
      // fold twisted the pillar's skin and the lining showed through a sliver).
      { s: 3.58, top: 3.27, upper: 'body' },
      // rearBase; the roof's rear end at the rail 3.29 [D side: the tailgate's line
      // (3.30, 1.478) → (3.64, 0.897)].
      { s: 3.655, top: 3.29 },
    ],
    rail: 1.496, // gutter line y 110 [D side]
    railHalf: 0.64, // ±0.641 [D top], ±0.626–0.655 [D front]
    crown: 0.06, // roof 1.58 [D side y 87] = rail + rise + crown
    railInset: 0.05, // [E as the classics]
    railRise: 0.025, // [E as the 05 shell]
    glassBottom: 0.04, // window sill 1.05 [D side y 232]
    glassTop: 0.047, // glass top 1.449 [D side y 123]
    screenBottom: 0.035, // screen's foot 1.06 [D side, front]
    screenHeader: 0.045, // [E as the classics; the front view reads 0.01–0.03 high]
    wiperBlade: 0.33, // drawn 0.318 / 0.336 [D front]
    screenFoot: -0.05,
    rearBottom: 0.025, // unused with a knee
    rearHeader: 0.06, // tailgate glass top 1.434 [D rear]
    // The tailgate's glass ends at 1.044 [D rear y 760], on the raked line at s 3.555 [D side];
    // the painted panel below runs to the load sill.
    rearKnee: { s: 3.555, y: 1.044 },
    pillar: 0.07, // [E as the classics]
  },
  wheels: {
    front: 0.688, // hub x 880.5 [D]
    rear: 2.888, // hub x 1486.3 [D]; wheelbase 2200 [F]
    radius: 0.33, // drawn 0.329 (loaded); 175/80 R16 free 0.343 [F niva-faq]
    width: 0.175, // [F]
    frontHalfTrack: 0.715, // 1430 [F]; drawn 1431
    rearHalfTrack: 0.7, // 1400 [F]; drawn 1389
    // The real arches are taller than wide (refs archFront / archRear, the black well
    // band's outer edge [D side]): the front ±0.37-0.385 at the hub, top 0.455 over it,
    // 8 mm behind the hub; the rear a circle of 0.39. The flared lip outside them
    // (±0.42 / 0.485) is not modelled. They stood one circle of 0.445 (1.35 R).
    arch: 1.145,
    frontArchRise: 1.38,
    rearArch: 1.18,
    archShift: [0.008, 0],
  },
  doorBottom: 0.428, // [D side y 404]
  bonnetFront: 0.15,
  // The bonnet covers the top, its side shut lines on the wings' top ±0.765–0.785 [D top];
  // its front edge comes down the face between the corner lamp units to 0.879, ±0.44
  // [D front y 280; P the 1982 car's face].
  bonnet: { inset: 0.01, nose: { y: 0.879, half: [0.44, 0.45] } },
  // Right rear wing, just behind the door: dashed (far side) x 1347–1396, y 298–328 [D];
  // on the right [P rear right 3/4 of the 1982 car].
  flap: { s0: 2.385, s1: 2.555, y0: 0.71, y1: 0.81, side: 'right' },
};

/**
 * VAZ-2121 (niva.jpg's front and rear views; Commons photos of a 1982 car): round head
 * lamps in chrome rings at the ends of a black panel with horizontal grille bars in a
 * thin chrome outline; indicator units (amber outer, clear side lamp inner) in black
 * surrounds on the wings' top corners; bare aluminium blades with a black lower half and
 * black end caps; tail lamps of amber, red-white-red and red cells with a black inner
 * end; an amber repeater on the front wing; chrome handles and mirrors.
 */
export const LOOK_2121: KitLook = {
  label: 'VAZ-2121',
  upholstery: 0x6b5a48, // tan-brown vinyl [P 1982 car's rear seat, a neighbour's headrest]
  dash: 0x1b1b1b, // black [P 1983 car's dash]
  headrests: true, // [P 1982 car's front seat]
  brightwork: 'chrome', // [P handle, mirror]
  // A chrome head on a rod from a bracket on the skin under the belt, up and back to over
  // the belt (`mirrorStalk` 0: the rod's bracket at `mirrorS` − 0.03, the head's centre at
  // `mirrorS` + 0.035). s from a projective fit to the door's front shut line 1.322, the
  // vent's rear post 1.685 and the rear shut line 2.295 at the belt, on three photos: the
  // rod's foot on the skin at 1.47 (`p00`, the 1983 car, left), 1.49 (`p13`, the 1982
  // car, right) and 1.48 (`p15`, a 1990 car, right); the heads read 1.44–1.74, too far
  // back as they stand out towards the camera ahead (measurements-niva.md §1.5). Its
  // bracket at 1.47.
  mirrorStalk: 0,
  mirrorS: 1.5,
  sill: null, // painted [P]
  waist: null, // none on the early car [P]
  // Amber, below the crease over the arch's front: x 775–807, y 280–293 [D side; P].
  repeater: { s0: 0.305, s1: 0.42, y0: 0.83, y1: 0.865 },
  front: {
    // Blade 0.439–0.556 [D side, front]: centre 0.4975 = face sill 0.45 + 0.035 + 0.0125;
    // its front at the tip, 0.076 thick [D top]; aluminium over black, black ends [P].
    bumper: { kind: 'blade', finish: 'alloy', lift: 0.0125, height: 0.117, depth: 0.08, lower: { finish: 'black', share: 0.5 }, strip: null, ends: 'black', overriders: null },
    items: [
      // The black panel ±0.714 from the bumper's top to 0.806 [D front], its chrome outline [P].
      { kind: 'panel', x: { centre: 0.714 }, y: { from: ['bumperTop', 0.004], to: ['bumperTop', 0.25] }, finish: 'black', proud: 0.012 },
      { kind: 'frame', x: { from: { centre: -0.714 }, to: { centre: 0.714 } }, y: { from: ['bumperTop', 0.004], to: ['bumperTop', 0.25] }, width: 0.008, finish: 'chrome', proud: 0.016 },
      // Bars ±0.445, 0.588–0.797 [D front]; ten black bars [P].
      {
        kind: 'grille',
        x: { centre: 0.445 },
        y: { from: ['bumperTop', 0.032], to: ['bumperTop', 0.241] },
        back: true,
        bars: { dir: 'horizontal', count: 10, finish: 'black', margin: 0.012, width: 0.008, depth: 0.01, proud: 0.03 },
      },
      // Ring centre ±0.570 at 0.681, ring 0.1035, lens 0.082 [D front] → lens 0.086 (ring 1.18×).
      { kind: 'round', role: 'head', x: { centre: 0.57 }, y: ['bumperTop', 0.125], radius: 0.086 },
      // Corner units: surround ±0.463–0.69, 0.83–0.91; lens ±0.494–0.648 split at 0.556,
      // 0.845–0.895 [D front]; amber outer, clear inner [P].
      { kind: 'panel', x: { from: { centre: 0.463 }, to: { centre: 0.69 } }, y: { from: ['bumperTop', 0.274], to: ['bumperTop', 0.354] }, finish: 'black', proud: 0.016 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.556 }, to: { centre: 0.648 } }, y: { from: ['bumperTop', 0.289], to: ['bumperTop', 0.339] }, depth: 0.01, proud: 0.014 },
      { kind: 'lens', role: 'head', x: { from: { centre: 0.494 }, to: { centre: 0.556 } }, y: { from: ['bumperTop', 0.289], to: ['bumperTop', 0.339] }, depth: 0.01, proud: 0.014 },
    ],
  },
  rear: {
    // Blade 0.483–0.606 [D side, rear]: centre 0.545 = tail sill 0.45 + 0.035 + 0.06;
    // 0.065 thick [D top]; aluminium over black, black ends [P].
    bumper: { kind: 'blade', finish: 'alloy', lift: 0.06, height: 0.123, depth: 0.065, lower: { finish: 'black', share: 0.5 }, strip: null, ends: 'black', overriders: null },
    items: [
      // Lamps ±0.36–0.654, 0.636–0.772 [D rear]: amber outer, red over white over red,
      // red [P]; a black block at the inner end to ±0.281 [D rear; P].
      {
        kind: 'cluster',
        x: { from: { centre: 0.36 }, to: { centre: 0.654 } },
        y: { from: ['bumperTop', 0.03], to: ['bumperTop', 0.165] },
        columns: [['blinker'], ['tail', 'reverse', 'brake'], ['tail', 'brake']],
      },
      { kind: 'panel', x: { from: { centre: 0.281 }, to: { centre: 0.36 } }, y: { from: ['bumperTop', 0.03], to: ['bumperTop', 0.165] }, finish: 'black', proud: 0.012 },
    ],
  },
};

/** The 2121's figures from the B pillar back, moved by the 2131's longer wheelbase. */
const LONG = 0.5;

/**
 * VAZ-2131: the 2121 to its B pillar, then 500 longer (4220 against 3720, wheelbase 2700
 * against 2200 [F vaz.ru]: both overhangs the 2121's). No drawing of it exists; its own
 * lines are read off Commons photos registered on the B shut line and the rear axle
 * (measurements-niva.md §2131, ±4 cm), brought to this frame (×0.994, the 2121 drawing's
 * scale against the photos'). A narrow B pillar, a rear door with its drop glass from
 * 2.36 to 3.11 and its rear edge upright at 3.18, cut round the rear arch below; a fixed
 * quarter glass from 3.2 to the 2121 side glass's rear edge + 0.5; the 2121's tail + 0.5.
 */
export const BODY_2131: KitBody = {
  ...BODY_2121,
  length: BODY_2121.length + LONG,
  stations: [
    ...BODY_2121.stations.filter((st) => st.s <= 2.3),
    // The sill stays down under the rear door to the rear arch's front [P].
    { ...BODY_2121.stations.find((st) => st.s === 2.3)!, s: 2.8 },
    ...BODY_2121.stations.filter((st) => st.s > 2.3).map((st) => ({ ...st, s: st.s + LONG })),
  ],
  cabin: {
    ...BODY_2121.cabin,
    columns: [
      // The 2121's to the front door's rear frame.
      ...BODY_2121.cabin.columns.filter((c) => c.s <= 2.255),
      // B pillar: the glass gap 2.29–2.37 [P], the front door below it to 2.317 (the
      // 2121's door), the rear door from there.
      { s: 2.295, top: 2.295, upper: 'body', lower: 'door1' },
      { s: 2.317, top: 2.317, upper: 'body', lower: 'door2' },
      { s: 2.335, top: 2.335, upper: 'door2' },
      // Rear door glass 2.37–3.13 [P] → 2.36–3.11.
      { s: 2.36, top: 2.36, upper: 'door2', glass: 'drop' },
      { s: 3.11, top: 3.11, upper: 'door2' },
      // Rear shut line upright at 3.20 [P] → 3.18; below the belt the arch cuts the door's
      // lower rear corner (the arch's front edge 2.94).
      { s: 3.18, top: 3.18, upper: 'body' },
      // Quarter glass 3.21 [P] → 3.2, to the 2121's side glass's rear edge + 0.5 [D, P].
      { s: 3.2, top: 3.2, upper: 'body', glass: 'fixed' },
      ...BODY_2121.cabin.columns.filter((c) => c.s > 3).map((c) => ({ ...c, s: c.s + LONG, top: c.top + LONG })),
    ],
    rearKnee: { ...BODY_2121.cabin.rearKnee!, s: BODY_2121.cabin.rearKnee!.s + LONG },
  },
  wheels: { ...BODY_2121.wheels, rear: BODY_2121.wheels.rear + LONG },
  // Right rear wing behind the rear door, over the arch: s 3.21–3.40, 0.06–0.18 under
  // the belt [P right side] → 3.21–3.39 (clear of the shut line), 0.825–0.945.
  flap: { s0: 3.21, s1: 3.39, y0: 0.825, y1: 0.945, side: 'right' },
};

/**
 * VAZ-2131: the 2121's face and tail (the base car's steel bumpers, the same lamps [P]).
 * The vent slots on the D pillar and the roof rack many carry are not modelled.
 */
export const LOOK_2131: KitLook = { ...LOOK_2121, label: 'VAZ-2131' };
