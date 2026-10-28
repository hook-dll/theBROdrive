/**
 * The ZIL-130 flatbed (platform `truck`), the late 130-76/-80 look: its white face panel,
 * an open steel platform with drop boards. Numbers and sources in measurements-zil130.md
 * (§2 the factory figures, §7 the drawing's readings).
 *
 * Measured on the 3dcar.ru four-view `zil_130.jpg` (a ZIL-130V1 tractor: the cab, bonnet,
 * wings, front, frame and front axle are the flatbed's). Side view 4.165 mm/px (its 5280
 * dimension line 1269 px and the V1's 3300 wheelbase 791 px agree within 0.3 %), the view
 * turned 0.7° (the ground line and the hubs fall 10 px to the rear), heights taken from the
 * ground under each point; s from the bumper's face (x 1044 on the sheet). Front view 4.031
 * mm/px from its 1800 front track (tyre centres x 203.5 / 650), ground y 682.5, centre x
 * 426.75; the rear view at the front view's scale (its tyres the same width). Behind the
 * cab the V1's tractor chassis is not the flatbed's: the 3800 wheelbase, 6675 length,
 * 1790 rear track and the platform (inside 3752 × 2326 × 575) are the factory's [F]; the
 * platform's height, its beam and the toolbox from the owner's side photo [O], the rest
 * behind the cab from the photos [P] or estimated [E].
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/** The front wheel's hub, s [D side x 1304: (1304 - 1044) × 4.165]. */
const FRONT = 1.083;

export const BODY_ZIL130: KitBody = {
  length: 6.675, // [F]; the tail board's back
  platform: 'truck',
  // The cab alone, standing behind the bonnet: its front wall under the bonnet's rear edge
  // (s 1.36), its back wall at 2.732 [D side x 700]. The wings cover its lower front, and
  // ahead of the door it stands over the front wheel's sweep: its floor there 1.0 high
  // to s 1.55 (the tyre at 1.0 reaches s 1.21 [D]), dropping to the sill behind it.
  stations: [
    // Its sides 1.80 at the belt, 1.86 at the widest [D front: 0.88 at 1.68, 0.894 at
    // 1.54; plan 0.89]; 0.90 at the sill [D rear: the back's foot flares to 0.94, E].
    { s: 1.36, sill: 1.0, crease: 1.25, belt: 1.66, deck: 1.7, wSill: 0.9, wCrease: 0.93, wBelt: 0.88 },
    { s: 1.55, sill: 1.0, crease: 1.25, belt: 1.66, deck: 1.7, wSill: 0.9, wCrease: 0.93, wBelt: 0.88 },
    // The cab's sill 0.74, its bevel to the doors' bottom 0.775 [D side y 410-418: the
    // cab's bottom line 0.79, the doors' 0.77].
    { s: 1.62, sill: 0.74, crease: 1.25, belt: 1.66, deck: 1.7, wSill: 0.9, wCrease: 0.93, wBelt: 0.88 },
    { s: 2.732, sill: 0.74, crease: 1.25, belt: 1.66, deck: 1.7, wSill: 0.9, wCrease: 0.93, wBelt: 0.88 },
  ],
  // The belt turns in 4 cm to the glass's foot 1.68 [D side y 198: 1.677].
  shoulder: { inset: 0.04, rise: 0.02 },
  cabin: {
    columns: [
      // The windscreen's foremost line, its middle, from 1.474, 1.681 high [D side (398,
      // 195)] raked to its top at 1.70 [D (452, 85)]; curved in plan (`screenFoot`,
      // `screenTop`), its corners 8 and 6 cm further back, where the corner pillar rakes
      // to the rail. It wraps round its corners into the side back to 1.837 [D x 485]: one
      // pane from the screen round the corner to the door's frame, no post (`screenWrap`;
      // owner, 2026-10-28: the door's frame is the only post) [P F34].
      { s: 1.554, top: 1.76, upper: 'body', glass: 'fixed' },
      // The door's front edge under the belt 1.774 [D x 470, its hinges].
      { s: 1.774, top: 1.8, upper: 'body', lower: 'door1', glass: 'fixed' },
      // Above the belt the door's frame from 1.837, the vent 1.878-2.099, a post, the drop
      // glass 2.132-2.507, the frame to the door's rear edge 2.545 [D x 485-655].
      { s: 1.837, top: 1.837, upper: 'door1' },
      { s: 1.878, top: 1.878, upper: 'door1', glass: 'vent' },
      { s: 2.099, top: 2.099, upper: 'door1' },
      { s: 2.132, top: 2.132, upper: 'door1', glass: 'drop' },
      { s: 2.507, top: 2.507, upper: 'door1' },
      // Behind the door the cab's side and its back corner, upright [D].
      { s: 2.545, top: 2.545, upper: 'body' },
      { s: 2.732, top: 2.732 },
    ],
    // The drip rail over the doors 2.11 [D side y 95; front 2.126]; the roof's edge
    // rolls over 0.1 in and up to its nearly flat top, 2.26 [D front y 122: 2.258; side
    // 2.28]; 0.82 off the centre line (front 0.826 under the visor, rear 0.75) [D].
    rail: 2.11,
    railHalf: 0.82,
    crown: 0.04,
    crownPower: 3,
    railInset: 0.1,
    railRise: 0.11,
    railBend: [0.3, 0.7],
    glassBottom: 0.02, // the glass from 1.70 [D side y 192]
    glassTop: 0.05, // to 2.06 [D side y 108]
    screenBottom: 0.03,
    screenHeader: 0.06,
    // The screen curved in plan, its middle 8 cm ahead of its corners at the foot, 6 at
    // the top [D plan: the roof's front edge, x 1385 against 1420, 0.146; side: the wrap].
    screenFoot: 0.08,
    screenTop: 0.06,
    screenWrap: true,
    wiperBlade: 0.4, // [E]
    rearBottom: 0.06,
    // The back wall's header thin, so the glass reaches nearly to the roof's roll and the
    // rail's chamfer no longer folds across the wall above it (owner, 2026-10-29).
    rearHeader: 0.03,
    pillar: 0.04,
    // The back window ±0.55, 1.73-2.12, its corners round: drawn ±0.485, 1.76-2.00 [D
    // rear x 305-545, y 825-887], made a little wider and taller, its top 2 cm under the
    // roof's roll (2.14), so the inside mirror sees out (owner, 2026-10-29).
    rearPanes: { x0: -0.1, x1: 0.55, y0: 1.73, y1: 2.12, r: 0.07, top: 2.4 },
  },
  wheels: {
    front: FRONT,
    rear: FRONT + 3.8, // wheelbase 3800 [F]
    // Drawn 0.508 over the hub to 0.527 under it [D side, the hubs y 471 / 482]; a
    // 260-508 (9.00-20) tyre stands 1018-1030 [F, E free diameter]: 0.51 here.
    radius: 0.51,
    width: 0.24, // [D front: 0.222 drawn, 260 section F]
    frontHalfTrack: 0.9, // 1800 [F; D]
    rearHalfTrack: 0.895, // 1790 [F; D rear: the twins' centres 0.742 and 1.054]
    // The wings' arch: a half ellipse 0.59 wide each side of its centre and 0.78 over
    // the hub, its top lip 1.289 high, its feet at s 0.546 / 1.670 on the wing's bottom
    // [D side]; centred 0.025 behind the hub.
    arch: 1.157,
    frontArchRise: 1.53,
    archShift: [0.025, 0],
    outside: true,
    twinRear: 0.312, // [D rear: 0.742 / 1.054]
    rimRadius: 0.254, // 20-inch rims [F]
  },
  doorBottom: 0.775,
  // No bonnet or boot in the shell: the bonnet is the truck's own (`truck.front.bonnet`);
  // the back wall's glass is a saloon's back light.
  bonnetFront: 1.554,
  bootEnd: 2.732,
  truck: {
    frame: {
      // From inside the bumper to 0.2 short of the tail board [P R34]; the rails' top
      // 0.86 at the front [D side y 400 behind the bumper: 0.854], rising to 0.92 at the
      // rear (the V1's rises 4 cm over its 2.3 m behind the cab, D; the flatbed's longer
      // overhang E); 200 deep [D 0.18-0.20], 865 over the rails [E: the Soviet trucks'
      // frame width], flanges 75 [E].
      s0: 0.12,
      s1: 6.45,
      half: 0.4325,
      depth: 0.2,
      flange: 0.075,
      top: [0.86, 0.92],
      cross: [0.22, 0.45, 1.7, 2.75, 3.65, 4.4, 5.4],
    },
    springs: { front: [0.4, 1.76], rear: [4.1, 5.66] }, // [E: about 1.4 and 1.55 long]
    // The bonneted front (zilfront.ts): bonnet, wings, face, bumper and the roof's markers.
    front: {
      bonnet: {
        // The nose's tip 0.233 [D side x 100], the rear edge 1.358 [D x 370]; the top on the
        // centre line 1.47 at the tip rounding up to 1.592 at 0.317, 1.659 at 1.07, 1.688 at
        // the rear [D side]; the lower edge on the wings' top 1.435-1.45 [D side y 250];
        // 0.70 off the centre line at the nose [D front 0.692], 0.865 at the rear [D plan].
        s0: 0.235,
        s1: 1.355,
        top: [[0.235, 1.47], [0.25, 1.53], [0.29, 1.575], [0.35, 1.598], [0.7, 1.632], [1.07, 1.659], [1.355, 1.688]],
        edge: 1.44,
        half: [0.7, 0.865],
        roll: [0.07, 0.06],
        // Five slats at the side's rear top [D side x 270-330, y 210-230; P F34].
        louvres: { s: [0.94, 1.19], y: [1.5, 1.58], count: 5 },
        // Its front corners a quarter round 0.2 in plan [P F34, F34w; E], lofted at five
        // extra stations over it; the top falling 14 mm from the centre line to the roll.
        noseRound: 0.2,
        roundCols: [0.04, 0.12, 0.25, 0.45, 0.7],
        crown: 0.014,
        // The lower edge rolls 5 cm down onto the face panel at the nose, back to `edge`
        // over 0.2 [P F34w].
        noseDrop: { drop: 0.05, run: 0.2 },
        // The raised middle [P F34w, F34r; E]: its top breaking 0.17 (front) to 0.30 (rear)
        // either side of the centre line, 15 mm over the crown, fading out over 0.2 at the
        // nose. No crease under it: the surface stays convex (kit-surface counts a concave
        // fold a dent).
        ridge: { half: [0.17, 0.3], rise: 0.015, fade: 0.2 },
      },
      wings: {
        // From behind the face's cheeks and their lamp pockets (`face.s` + 3.4 cm) to the
        // door's front edge [D side x 103-470]; 1.08 off the centre line [D front 1.095, plan
        // 1.077], rounding in to the cheeks' edge 1.04 at the face; the brow over the arch
        // 1.34-1.38 [D side y 265]; the bottom 0.74 ahead of the arch, 0.78 behind it [D side y 420].
        s0: 0.28,
        s1: 1.77,
        outer: 1.08,
        nose: 1.04, // the cheeks' edge: their white runs on round the nose from there (`face`)
        taper: 0.19,
        brow: 1.34,
        bottom: [0.74, 0.78],
        cab: 0.89,
        repeater: [1.56, 1.22, 0.025], // a small round lamp on the flank behind the arch [P F34w]
        // The arch's lip 3 cm proud, rolling 6 cm back onto the flank [D side: the arch's double line; P].
        lip: { out: 0.03, wide: 0.06 },
      },
      face: {
        // The cheeks at 0.246 [D side x 103: the face's silhouette is the cheeks'], from the
        // bumper's top up under the bonnet's nose, the nose 8 cm ahead of them; ±1.04 [D
        // front: the lamp pods' outer edge 1.08, the wings' front 0.98]; white [owner, §6 F1;
        // P F34w]. Moved forward from 0.326 (owner, 2026-10-28: the face sat in, the bonnet
        // hanging over it like a peak and the bumper standing out).
        s: 0.246,
        half: 1.04,
        y: [0.84, 1.42],
        corner: 0.17, // the top corners round down past the indicators, the painted wings over them [P F34w; owner 2026-10-28]
        colour: 0xe2dfd4,
        // A long slot under the top, two rows of five, two wide intakes over the bumper [P
        // F34w; D front's rows y 352-365, 385-395, 415-445].
        slots: [
          { y: [1.285, 1.33], half: 0.44, count: 1, gap: 0 },
          { y: [1.19, 1.225], half: 0.54, count: 5, gap: 0.025 },
          { y: [1.12, 1.155], half: 0.54, count: 5, gap: 0.025 },
          { y: [0.96, 1.05], half: 0.44, count: 2, gap: 0.04 },
        ],
        // The nose ±0.66 between the cheeks, one arc in plan from cheek to cheek 6 cm out at
        // its middle, its top and bottom rolling back on 5 cm rounds; the two rows of five on
        // a block swelling 2 cm more [owner's refs 2026-10-28; P F34w, F34r; E]: 8 cm at the
        // middle, its front at 0.166. Its grid lines at most 0.15 apart.
        nose: { half: 0.66, proud: 0.06, round: 0.05 },
        noseStep: 0.15,
        grille: { y: [1.085, 1.26], half: 0.58, proud: 0.02 },
        // Head lamps 7-inch, the amber indicators over them [D front: rings x 170-245, y
        // 365-435 read ±0.884, 1.139; P F34w]: the pair centred in the cheek's pocket (owner,
        // 2026-10-28: not near the edges), ±0.858, 1.09 and 1.26; black rings 18 mm wide
        // standing 2 cm out of the cheek.
        head: [0.858, 1.09, 0.09],
        blinker: [0.858, 1.26, 0.035],
        ring: 0.018,
        lampProud: 0.02,
        // The lamps' sunken pocket filling each cheek [P F34, F34w; owner's refs]: inside a
        // rim 3.5 cm round the nose, top and bottom and 2 cm at the outer edge, its other
        // corners rounded 6 cm, its wall sloping in 1 cm to a floor 22 mm deep.
        pocket: { rim: 0.035, rimOut: 0.02, corner: 0.06, slope: 0.01, depth: 0.022 },
      },
      // 0.68-0.84 [D side y 398-433: 0.671-0.817; front 0.693-0.855], ±1.055 [D front],
      // reaching back to just ahead of the face [D side x 44-95: 0.21; P F34: a deep
      // channel]; hooks ±0.43 [D front]. Slimmed to 0.72-0.83 (owner, 2026-10-28: too heavy
      // from the front). Its front corners 0.14 round in plan, its front edges rolled 3 cm
      // [P F34; owner's refs; E].
      bumper: { depth: 0.21, half: 1.055, y: [0.72, 0.83], hooks: 0.43, corner: 0.14, roll: 0.03 },
      markers: { at: [1.86, 0.25], colour: 0xd4891e }, // [P F34: three amber lamps over the screen]
      // Six segments round every rounded corner, twelve round the arches, sixteen round a lamp.
      steps: { round: 6, arch: 12, lamp: 16 },
    },
    step: { s: [1.86, 2.46], y: 0.58, out: 0.98 }, // [D side y 415-455 under the door]
    // On the left rail behind the cab step, under the toolbox [P S, O; F34 shows the right
    // side bare behind its step]; ~170 l [F], its size [E; O s 2.98-3.93, 0.60-0.96]. The
    // filler on its top at the front outer corner, ahead of the toolbox and under the
    // platform's beam [E]: reached crouching, under the side board.
    tank: { s: [2.95, 3.75], y: [0.5, 0.9], out: 0.95, cap: [3.05, 0.85] },
    // Under the platform's front on the left, its face standing out of the beam [O x
    // 430-505, y 156-190: s 3.12-3.67, 1.03-1.28]; its top 2.5 cm up in the floor plate.
    toolbox: { s: [3.12, 3.67], y: [1.03, 1.285], inner: 0.9 },
    // Inside the right rail at 0.55, from the engine's rear down from 0.8 [E].
    exhaust: { x: -0.24, y: 0.55, top: 0.8, silencer: [3.0, 3.8], tail: 4.15 }, // [E]
    driveline: { y: 0.76 }, // the gearbox under the cab's floor [E]
    platform: {
      // From 0.07 behind the cab to the truck's tail (6675 [F]); 2.50 over the boards [F
      // width], 2.326 inside [F]; boards 575 over the floor [F: the late cars', one plank
      // lower than the 685 before 1971]; two pressed ribs along them [owner §6 P1; E]. The
      // floor's top 1.30 at the boards' foot on the owner's side photo, registered on the
      // hubs (the passport's 1450 loading height stood 15 cm higher); under it a dark
      // steel beam round the edge, 0.25 deep from the floor's top [O: 1.30-1.05]
      // (measurements-zil130.md §7).
      s0: 2.8,
      s1: 6.675,
      floor: 1.3,
      beam: 0.25,
      half: 1.25,
      inside: 1.163,
      side: 0.575,
      ribs: 2,
    },
    // Under the platform's tail, near its sides [P R34]: each a black housing ±0.13 x
    // ±0.05, the lenses from the outer end indicator 7 cm, brake and tail 6, and the
    // reversing lamp 5 on the left unit only [P R34].
    rearLamps: {
      at: [6.42, 0.78, 1.0],
      half: [0.13, 0.05],
      cells: [['blinker', 0.07], ['brake', 0.06], ['tail', 0.06], ['reverse', 0.05]],
      reverse: 'left',
    },
    // [P R34]; hanging from a bar under the platform's beam [O]. Shorter than the wheel's
    // hub height off the ground, leaning out at the foot, one behind the wheel and its
    // mirror ahead of it about the axle (s 4.883) [owner's photo, 2026-10-29].
    flaps: { s: [4.3, 5.466], x: [0.62, 1.2], y: [0.5, 1.04], lean: 0.16 },
    // The four bonnet cells, as a car's [E]. The engine's between the rails' flanges
    // (±0.3575) over the front axle's beam, where the V8 stood (s 0.62-1.25, 0.58 up); the
    // radiator's behind the face, standing on the cross member at s 0.45 (its top 0.83);
    // the air filter's on the left rail and the turbine's on the right, inside the wheel
    // wells' aprons (±0.58), the turbine's by the exhaust's down-pipe at the engine's rear
    // and short of the cab's front wall (s 1.36).
    bay: {
      engine: { x: [-0.345, 0.345], s: [0.62, 1.25], floor: 0.58 },
      turbine: { x: [-0.56, -0.36], s: [0.98, 1.33], floor: 0.87 },
      radiator: { x: [-0.42, 0.42], s: [0.365, 0.505], floor: 0.84 },
      air_filter: { x: [0.36, 0.56], s: [0.72, 1.02], floor: 0.87 },
    },
  },
};

/**
 * ZIL-130 (late, 130-76/-80): the white face panel with its slots and round lamps, a black
 * channel bumper with two hooks; mirrors on tubular arms from the cab's front corners;
 * chrome door handles; a painted steel dash.
 */
export const LOOK_ZIL130: KitLook = {
  label: 'ZIL-130',
  upholstery: 0x37302a, // dark brown vinyl [E]
  dash: 0x4a4d48,
  dashPainted: true, // [owner §6 I1: a flat painted dash]
  headrests: false,
  brightwork: 'chrome',
  mirrorFinish: 'black',
  // The arms' feet on the cab's corner over the wing, 1.44-1.50 high at s 1.46-1.52 [D
  // side x 395-410, y 245-255; front (210, 325)], the heads 1.31 off the centre line at
  // 1.81, s 1.50 [D front (98, 233); side x 400]; tall heads [D front 22 x 53 px, P].
  mirrorArm: { root: [1.52, 1.5], brace: [1.66, 1.46], head: [1.5, 1.81, 1.31], half: [0.075, 0.11] },
  // The handle under the glass's rear end [D side x 615-640, y 200].
  handles: { front: 2.43, rear: 2.43, y: 1.62, half: 0.06 },
  sill: null,
  waist: null,
  repeater: null,
  front: { bumper: null, items: [] },
  rear: { bumper: null, items: [] },
};
