/**
 * The VAZ-1111 «Ока» (1988–1996 base car): a three-door hatch, one long door a side, a
 * transverse twin in front. Numbers and sources in measurements-oka.md.
 *
 * Measured on the dimensioned 3dcar.ru four-view `vaz_1111_oka.jpg` (side view 2.696
 * mm/px from its 3200 overall length: tips x 899.5 / 2086.5, ground y 618; its 544
 * overhang and hubs x 1100.5 / 1912.5 read 542 and 2189 against the dimensions' 544 /
 * 2180; the front and rear views at 2.70 mm/px from their 1350 height, the 520 plate
 * reading 518) and Wikimedia Commons photos for what the drawing cannot say: the fuel
 * filler on the right rear quarter (the drawing shows the left side), the lamps' colours,
 * the bumpers' black plastic.
 *
 * A short upright nose leaning back 0.32 m per m from the bumper's top to a clamshell
 * bonnet that covers the wings' tops; rectangular head lamps in a black face panel with a
 * slotted grille between them; deep black plastic bumpers wrapping round to the arches,
 * the amber indicators in the front one; a raked screen, a roof barely 1.34 high, a long
 * door with a sail at its front corner, a large fixed quarter glass and a wide D pillar;
 * a near-upright tailgate down between tall corner lamp units.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * VAZ-1111: overhangs 542 / 469 over a 2189 drawn wheelbase. The face from the bumper's top
 * (0.525) to the bonnet's lip (s 0.136, 0.755), the bonnet climbing to 0.89 at the screen's
 * foot (s 0.89); the screen raked to the roof's front at 1.35; rail 1.29, roof 1.34; the
 * tailgate from the roof's rear (2.855) to its glass's foot (3.11, 0.86). Sill 0.17, door
 * bottom 0.28, a pressed line along the flank at 0.53, belt 0.805 rising to 0.855. One
 * door 0.972 to 2.104 below the belt, its glass behind a sail from 1.08 to 2.064; B pillar
 * to 2.14; the fixed quarter glass to 2.875 (2.73 at the rail); the D pillar behind it.
 */
export const BODY_1111: KitBody = {
  length: 3.2, // drawn tips x 899.5 / 2086.5 at 2.696 mm/px [D]; 3200 [F catalog-vaz.ru]
  platform: 'samara',
  stations: [
    // The face [D side x 920: below the lamps, behind the bumper's 55 mm]: flat across to the
    // lamp panel's ends ±0.614 [D front], ±0.64 with the bumper's corner [D top]. Its foot
    // hides in the bumper (0.30–0.525) [D side, front]; the wings' top 0.709 and the bonnet's
    // lip 0.755 [D side (960, 355), (950, 338)], both carried back 0.08 by `frontLean`.
    // The bonnet's crown is held at 0.07 over the wings' top all along (drawn 0.045 at the
    // lip to 0.099 at s 0.54): a crown that grows and shrinks twists the bonnet into long
    // slivers (owner, 2026-10-16); its centre line stays within 3 cm of the drawing's.
    { s: 0.055, sill: 0.3, crease: 0.53, belt: 0.71, deck: 0.78, wSill: 0.62, wCrease: 0.64, wBelt: 0.63 },
    // The corners round out to ±0.675 by s 0.16 and ±0.70 by s 0.27 [D top]; the wings' top
    // climbs 0.145 per m and the bonnet's centre from 0.755 to 0.864 at s 0.54 [D side]. The
    // wings' top under the clamshell's edge ±0.653–0.668 at 0.72–0.81 [D front: the line
    // inside the flank's ±0.69–0.705], on into the glass's foot ±0.669: `wBelt` 0.667 from s
    // 0.27 back, in line with the cabin's (was 0.69 to 0.54: out and back in, an s-bend).
    { s: 0.16, sill: 0.3, crease: 0.53, belt: 0.72, deck: 0.79, wSill: 0.66, wCrease: 0.675, wBelt: 0.665 },
    { s: 0.27, sill: 0.3, crease: 0.53, belt: 0.73, deck: 0.8, wSill: 0.685, wCrease: 0.7, wBelt: 0.667 },
    { s: 0.54, sill: 0.3, crease: 0.53, belt: 0.765, deck: 0.835, wSill: 0.69, wCrease: 0.705, wBelt: 0.667 },
    // The screen's foot on the bonnet (0.891, 0.890) [D side (1230, 288); front view 0.871
    // on the centre line]; the wings' top 0.803 at the cowl [D side (1200, 320)]. Flank
    // ±0.704–0.718 from here to s 2.97 [D top]; the glass's foot ±0.669 [D front].
    { s: 0.89, sill: 0.25, crease: 0.53, belt: 0.805, deck: 0.875, wSill: 0.69, wCrease: 0.71, wBelt: 0.667 },
    // Sill 0.164–0.205 between the arches [D side y 542–557: the black rocker] → 0.17.
    { s: 0.95, sill: 0.17, crease: 0.53, belt: 0.81, deck: 0.83, wSill: 0.69, wCrease: 0.71, wBelt: 0.667 },
    // The window sill 0.824 at s 1.08, 0.833 at 1.35, 0.846 at 2.1 [D side], 12 mm over the belt.
    { s: 2.4, sill: 0.17, crease: 0.53, belt: 0.845, deck: 0.865, wSill: 0.69, wCrease: 0.71, wBelt: 0.667 },
    // Behind the rear wheel the body's bottom meets the bumper's foot (0.30) [D side].
    { s: 2.95, sill: 0.3, crease: 0.53, belt: 0.855, deck: 0.875, wSill: 0.69, wCrease: 0.71, wBelt: 0.69 },
    // The real belt runs on at 0.857 to the tailgate's line (3.11); here it is kept under the
    // tailgate's knee (0.86) and turns down at this station, a cabin column of its own
    // (measurements-niva.md §1.3). Corners rounding in: ±0.681 at 3.075 [D top].
    { s: 3.04, sill: 0.3, crease: 0.53, belt: 0.85, deck: 0.87, wSill: 0.675, wCrease: 0.695, wBelt: 0.68 },
    // rearBase: the tailgate's foot at the corners' top, its lower panel coming on down the
    // tail face between the corner lamps (`lidFace`). The D pillar comes down the raked line
    // to it, flush with the tailgate (as BODY_2108's). ±0.659 at 3.129 [D top].
    { s: 3.125, sill: 0.3, crease: 0.53, belt: 0.78, deck: 0.79, wSill: 0.65, wCrease: 0.67, wBelt: 0.66 },
    // Tail face [D side x 2072.5 at 0.59: s 3.162]; lamps' outer edge ±0.661 [D rear]. The
    // tailgate comes down between the lamps (inner edges ±0.50 at their foot) to 0.562 [D
    // rear; P "1994 VAZ 1111 red rear"].
    { s: 3.16, sill: 0.3, crease: 0.53, belt: 0.78, deck: 0.562, notch: 0.495, wSill: 0.63, wCrease: 0.655, wBelt: 0.645 },
  ],
  // Glass foot ±0.669 over a flank at ±0.69–0.71 [D front]; the clamshell's edge a little
  // over the wings' side [E].
  shoulder: { inset: 0.02, rise: 0.012 },
  cabin: {
    columns: [
      // The screen from its foot (0.891, 0.890) to the roof's front at the rail (1.349, 1.29)
      // [D side line (1230, 288) → (1405, 135)].
      { s: 0.89, top: 1.35, upper: 'body' },
      // The door's frame runs up the pillar; below the belt the wing reaches back to the
      // door's front shut line at 0.972 [D side x 1260].
      { s: 0.92, top: 1.385, upper: 'door1', lower: 'body' },
      // A sail (the mirror's mount) in the door's front corner up to the glass's front edge,
      // raked from (1.08, 0.82) to (1.417, 1.235) [D side; P "VAZ-1111 2024-05 …922"].
      { s: 0.972, top: 1.415, upper: 'door1' },
      { s: 1.08, top: 1.46, upper: 'door1', glass: 'drop' },
      // Glass's rear edge 2.064, the door's rear shut line 2.104 below the belt, upright
      // [D side x 1665 / 1680]; above the belt the frame ends 2 cm sooner, the pillar's
      // foot over the door's tail (the 2121's B pillar): a door ending on the same column
      // above and below the belt had its seal and its painted edge cross there.
      { s: 2.064, top: 2.064, upper: 'door1' },
      { s: 2.084, top: 2.084, upper: 'body', lower: 'door1' },
      { s: 2.104, top: 2.104, upper: 'body' },
      // Fixed quarter glass from 2.14 [D side x 1693] to its rear edge, raked from its foot
      // (2.873, 0.868) to its top corner (2.738, 1.27), straightened to the rail [D].
      { s: 2.14, top: 2.14, upper: 'body', glass: 'fixed' },
      { s: 2.875, top: 2.73, upper: 'body' },
      // The belt turns down to the tailgate's foot from here (station 3.04).
      { s: 3.04, top: 2.845, upper: 'body' },
      // rearBase; the roof's rear end at the rail 2.855 [D side (1959, 139.5)].
      { s: 3.125, top: 2.855 },
    ],
    rail: 1.29, // the door frame's top y 140 [D side]; 1.31 [D front]
    railHalf: 0.49, // ±0.493 at the glass's top corners [D front]
    crown: 0.035, // roof 1.34 [D side 1.329, front 1.343, rear 1.365; dimension 1350] = rail + rise + crown
    railInset: 0.03, // [E: the roof's edge rounds in ±0.48 at the top, D front]
    railRise: 0.015, // [E as the Samaras]
    glassBottom: 0.012, // window sill 0.824–0.846 [D side]
    glassTop: 0.04, // door glass top 1.235, quarter glass top 1.268 [D side]
    screenBottom: 0.025, // [E as the classics]
    screenHeader: 0.04, // [E]
    // One wiper on the real car (arm and blade ~0.57 on the top view [D]); the kit builds
    // a pair, which fits the small screen only with the classics' short blades.
    wiperBlade: 0.33, // [E]
    rearBottom: 0.025, // unused with a knee
    rearHeader: 0.04, // tailgate glass top 1.277 [D rear] under a rail at 1.29 [E]
    // The tailgate's glass ends at 0.865 [D rear y 987.5], on the raked line at s 3.112 [D side
    // (2054, 300)]; the painted panel below it.
    rearKnee: { s: 3.11, y: 0.86 },
    pillar: 0.06, // [E: a small car's slim pillars]
  },
  wheels: {
    front: 0.542, // hub x 1100.5 [D]
    rear: 2.731, // hub x 1912.5 [D]; wheelbase 2180 [F auto.ru]
    radius: 0.25, // drawn 0.240 (loaded, hub y 529); 135/80 R12 free 0.260 [F catalog-vaz.ru]
    width: 0.135, // [F]
    frontHalfTrack: 0.605, // 1210 [F drivernotes.net; D front dimension 1210]
    rearHalfTrack: 0.6, // 1200 [F drivernotes.net]
    // The owner's side photo (measurements-oka.md §1.3), its body 0.035 higher on its hubs
    // than the drawing's taken off. Front: 0.30 ahead and 0.323 behind at the hub's height,
    // its top 0.335 [P], a half ellipse 0.311 wide (it stood 0.3075 × 0.36 to the drawing's
    // liner, 2.5 cm over the photo's opening).
    arch: 1.245,
    frontArchRise: 1.34,
    archShift: [0.0125, -0.01],
    // Rear: 0.31 ahead and 0.29 behind (the bumper's end), its top 0.305 and flat: a
    // superellipse of power 2.7, wider than a circle near the top where the flat top runs
    // back into the bumper's corner [P; D top 0.29–0.30 "flattened under the flank line"]
    // (it stood a circle of 0.293).
    rearArch: 1.2,
    rearArchRise: 1.22,
    rearArchSquare: 2.7,
  },
  doorBottom: 0.28, // [D side y 514]
  bonnetFront: 0.055,
  // A clamshell: its side shut lines on the wings' top from the lip to the A pillars [D
  // side, front; P "VAZ-1111 2024-05 …772"].
  bonnet: { inset: 0.01 },
  // The face leans back from the bumper's top (s 0.055, 0.525) to the bonnet's lip (s 0.136,
  // 0.755) [D side]: 0.32 m per m above 0.5, faded out over 0.15 behind the lip.
  frontLean: { base: 0.5, lean: 0.32, blend: 0.15 },
  // A round filler cap ~0.1 across on the right rear quarter, half way down the panel just
  // ahead of the arch [P "1994 VAZ 1111 red rear": its right side; E position]. The left side
  // (the drawing, P "…922") has none.
  flap: { s0: 2.42, s1: 2.52, y0: 0.57, y1: 0.67, side: 'right' },
};

/**
 * VAZ-1111 (vaz_1111_oka.jpg's front and rear views; Commons photos "VAZ-1111 2024-05 …772,
 * …884, …922, …961", "1994 VAZ 1111 red rear", "2000 VAZ 1111 (11113021) rear", "ВАЗ-1111
 * «Ока», Molėtų technikos muziejus 3", "Oka-Innenraum"): rectangular head lamps at the ends
 * of a black face panel with a slotted grille between them; deep black plastic bumpers,
 * the amber indicators in the front one, a red fog lamp in the rear one; tall corner lamp
 * units beside the tailgate, clear over amber over red; an amber repeater on the front
 * wing; black handles and mirrors.
 */
export const LOOK_1111: KitLook = {
  label: 'VAZ-1111',
  upholstery: 0x3a3b3e, // dark grey cloth and black vinyl [P "Oka-Innenraum" door card, …961 seat]
  dash: 0x232325, // black plastic [P "Oka-Innenraum"]
  headrests: true, // [P …961: the front seat's restraint through the tailgate glass]
  brightwork: 'black', // [P handles, mirrors]
  mirrors: 'left', // the base car's only door mirror [owner]
  sill: null, // painted [P]
  waist: null, // none [P]
  // Amber, on the wing ahead of the door: x 1202.5–1232.5, y 387.5–400 [D side; P museum 3].
  repeater: { s0: 0.817, s1: 0.898, y0: 0.588, y1: 0.621 },
  front: {
    // Black plastic 0.30–0.525 [D side 0.305–0.524, front 0.29–0.527]: face sill 0.30 + 0.035
    // − drop; its sides back along the wings to the front arch, the end the arch's front
    // edge at every height (s 0.25 at its foot, 0.38 at its top) [P owner side: 0.244 →
    // 0.335; D side x 993–1035]. Its moulding line near the top [D front y 432.5: 0.506].
    bumper: { kind: 'moulded', drop: 0.035, height: 0.225, wrapTo: 'arch', moulding: { y: 0.5, height: 0.012, finish: 'black' } },
    items: [
      // The black panel across the face round the lamps, 0.547–0.709 [D front y 417.5–357.5].
      { kind: 'panel', x: { centre: 0.615 }, y: { from: ['bumperTop', 0.022], to: ['bumperTop', 0.184] }, finish: 'black', proud: 0.012 },
      // Slotted grille ±0.317, 0.554–0.641, two rows of slots [D front; P].
      {
        kind: 'grille',
        x: { centre: 0.317 },
        y: { from: ['bumperTop', 0.029], to: ['bumperTop', 0.116] },
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'black', margin: 0.008, width: 0.01, depth: 0.01, proud: 0.02 },
      },
      // Lenses ±0.378–0.574, 0.560–0.689 [D front].
      { kind: 'lens', role: 'head', x: { from: { centre: 0.378 }, to: { centre: 0.574 } }, y: { from: ['bumperTop', 0.035], to: ['bumperTop', 0.164] }, depth: 0.01, proud: 0.016 },
      // Amber indicators in the bumper ±0.418–0.52, 0.398–0.452 [D front; P …772], 4 mm before
      // the bumper's face at the tip (0.055 out of the end face).
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.418 }, to: { centre: 0.52 } }, y: { from: ['bumperBottom', 0.098], to: ['bumperBottom', 0.152] }, depth: 0.01, proud: 0.059 },
    ],
  },
  rear: {
    // Black plastic 0.30–0.495 [D side 0.318–0.493, rear 0.298–0.494]; its sides forward
    // along the wings to the rear arch, the end its back edge at every height (s 3.02 at its
    // foot, 2.94 at its top) [P owner side: 2.996 → 2.86 over its taller band; D side x
    // 1980–2013]. Its moulding line under the top [E], clear of the fog lamps.
    bumper: { kind: 'moulded', drop: 0.035, height: 0.195, wrapTo: 'arch', moulding: { y: 0.47, height: 0.012, finish: 'black' } },
    items: [
      // Rectangles ±0.432–0.58, 0.346–0.427 [D rear], raised to 0.37 to stay on the bumper's
      // flat face; red, never lit (the fog lamp) [P "1994 VAZ 1111 red rear", "2000 … rear"],
      // 4 mm before the bumper's face (0.04 out of the tail face).
      { kind: 'lens', role: 'inert', x: { from: { centre: 0.432 }, to: { centre: 0.58 } }, y: { from: ['bumperBottom', 0.07], to: ['bumperBottom', 0.127] }, depth: 0.01, proud: 0.044 },
    ],
  },
  // Tail lamp units from their leaning inner edge (±0.50 at the foot, ±0.574 at the top,
  // 0.568–0.771 [D rear]) round the corner and forward on the flank to 3.04 (the drawn front
  // edge 3.027–3.048 [D side]); clear over amber over red in about 1 : 1 : 2 [P …961, "1994
  // VAZ 1111 red rear"]. 6 mm of body between the bands: their rims inside the body, seen
  // from the cabin through the load space, fight where two bands share an edge.
  cornerLamps: [
    {
      end: 'rear',
      points: [
        { x: [0.556, 0.574], y: [0.723, 0.77], role: 'reverse' },
        { y: [0.723, 0.77], role: 'reverse' },
        { s: 3.04, y: [0.723, 0.77] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.539, 0.554], y: [0.673, 0.717], role: 'blinker' },
        { y: [0.673, 0.717], role: 'blinker' },
        { s: 3.04, y: [0.673, 0.717] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.5, 0.536], y: [0.568, 0.667], role: 'brake' },
        { y: [0.568, 0.667], role: 'tail' },
        { s: 3.04, y: [0.568, 0.667] },
      ],
    },
  ],
};
