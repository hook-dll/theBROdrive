/**
 * The BMW 5 Series E34 saloon (1988–96); the car built is the 520i 24V of 1990–95 (M50B20,
 * five-speed manual): twin kidneys with chrome surrounds between four round head lamps in
 * black rings on a black band, the face leaning forward to the bonnet's lip (the "shark
 * nose"); body-colour bumpers with a broad black rubbing band, in line with the black strip
 * along the doors; black window frames, B pillar and the bar before the rear door's fixed
 * quarter glass, whose rear edge hooks forward at its foot (the Hofmeister kink); tail
 * lamps split between the wings and the boot lid. Numbers and sources in
 * measurements-e34.md.
 *
 * Measured on the-blueprints.com's vector preview `e34_tbp_620.jpg` (drawing 620, "BMW
 * 5-series sedan E34 (1993)", 1280 × 906; dimension lines 4720 / 2760 / 1750 / 1420), side
 * view facing left: lengths 5.80 mm/px from the drawn tips (x 28 / 842), `s = (x − 28) ×
 * 0.0058`; heights 5.91 mm/px from the ground (y 331), the scale of the front view's 1750
 * line (x 908–1204), which puts the drawn roof (y 92) at the factory 1412. The drawn hubs (x
 * 172.5 / 652) stand 2782 apart against the factory 2761: the wheels go on the factory
 * wheelbase centred on the drawn pair. Front and rear views from the same drawing, centre x
 * 1055.5, grounds y 331 / 749. The nose's lean, the doors' handles, the flap and the side
 * marker on the Commons side photo `side.jpg` (registered on its hubs, 2.58 mm/px).
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * BMW 520i (E34) saloon: overhangs 0.848 / 1.111 over a 2761 wheelbase [F; D the drawn
 * hubs]. The face 0.07 behind the bumper's front, leaning forward to the bonnet's lip
 * (0.755); the bonnet rising to 0.925 at the screen's foot on the centre line (s 1.33); the
 * A pillar from its foot at 1.53 to the rail at 2.0; the roof 1.412 from 2.5 to 3.1, falling
 * into the back light from 3.45 to its foot on the deck at 4.05 (1.0); the deck to its edge
 * over the tail (0.975 at 4.64); the lid down the tail face between the wing lamps to 0.60.
 * Sill 0.19, door bottoms 0.245, the side glass's foot one straight line from 0.90 at the A
 * pillar to 0.957 at the quarter's hook (review 2026-10-27, measurements-e34.md §8).
 */
export const BODY_E34: KitBody = {
  length: 4.72, // [F 4720; D dimension line 4720]
  platform: 'classic', // rear drive, the engine lengthwise
  stations: [
    // The face behind the bumper [D side: the lamps' band at s 0.07–0.09 over 0.55–0.735; D
    // front: the band to ±0.73, the body ±0.80 at the corner]; the bonnet's lip 0.755.
    { s: 0.07, sill: 0.3, crease: 0.55, belt: 0.735, deck: 0.755, wSill: 0.79, wCrease: 0.8, wBelt: 0.78 },
    // The bonnet's line [D side: 0.80 at s 0.2, 0.84 at 0.4, 0.865 at 0.6, 0.885 at 0.9,
    // 0.905 at 1.1, 0.925 at the cowl]; the wing's top just under it; the flank ±0.875 [F
    // 1751; D front: ±0.875 at 0.6].
    { s: 0.2, sill: 0.29, crease: 0.58, belt: 0.775, deck: 0.8, wSill: 0.85, wCrease: 0.865, wBelt: 0.84 },
    { s: 0.5, sill: 0.28, crease: 0.62, belt: 0.83, deck: 0.857, wSill: 0.86, wCrease: 0.875, wBelt: 0.85 },
    // The wing's top (the bonnet's shut line) rising straight back into the side glass's foot
    // [P S, on the hubs: the shut line 0.86 at s 1.29, 0.905 at the A pillar's foot]; the
    // bonnet on the centre line [D side: 0.905 at 1.1, 0.925 at the screen's foot].
    { s: 1.2, sill: 0.19, crease: 0.7, belt: 0.855, deck: 0.912, wSill: 0.86, wCrease: 0.875, wBelt: 0.857 },
    // The screen's foot on the centre line [D side (258, 175)]; the cowl at the A pillar's
    // foot behind it (`screenFoot`).
    { s: 1.33, sill: 0.19, crease: 0.72, belt: 0.86, deck: 0.925, wSill: 0.86, wCrease: 0.875, wBelt: 0.857 },
    // The cowl: the A pillar's foot [D side: the front glass's foot x 305, y 180; P S: 1.61,
    // 0.90]. The side glass's foot (belt + 0.03) one straight line from here to the quarter's
    // hook, rising 0.03 a metre [D side: 0.913 at s 1.93, 0.925 at 2.33, 0.943 at 2.85, 0.954
    // at 3.35, 0.96 at 3.43; P S on the hubs: 0.904 at 1.96, 0.914 at 2.32, 0.935 at 2.88, 0.951
    // at 3.30, 0.959 at 3.45]. The flank ±0.86 at the belt [D front: the outline 0.85–0.9];
    // the side over the crease leaning in a little more as it rises towards the tail (6.6° at
    // 1.2 to 15° at 4.05: one lean in and out failed kit-surface).
    { s: 1.53, sill: 0.19, crease: 0.76, belt: 0.868, deck: 0.935, wSill: 0.86, wCrease: 0.875, wBelt: 0.857 },
    { s: 2.5, sill: 0.19, crease: 0.78, belt: 0.895, deck: 1.0, wSill: 0.86, wCrease: 0.875, wBelt: 0.855 },
    // The rear door's shut line at the belt.
    { s: 3.519, sill: 0.19, crease: 0.78, belt: 0.927, deck: 1.01, wSill: 0.86, wCrease: 0.875, wBelt: 0.849 },
    // rearBase: the back light's foot on the deck [D side (726, 162): s 4.05, 1.0]; the sill
    // behind the rear arch up to the bumper's foot. The wing's top on the line from the side
    // glass's foot; the shoulder line rising to the tail lamps' top [P S: 0.78 at the
    // handles, 0.845 over the lamps].
    { s: 4.05, sill: 0.26, crease: 0.81, belt: 0.955, deck: 1.0, wSill: 0.855, wCrease: 0.87, wBelt: 0.83 },
    // The deck's edge over the tail [D side: 0.99 at 4.5, 0.98 at 4.62, the corner 0.96 at
    // 4.65]; in plan the tail narrowing to rounded corners [D rear: ±0.83 at the lamps].
    { s: 4.64, sill: 0.33, crease: 0.845, belt: 0.95, deck: 0.975, wSill: 0.8, wCrease: 0.83, wBelt: 0.79 },
    // The tail face [D side x 830–834]: the wing lamps' top (0.85) across, the lid down
    // between them to its foot under the lamps (0.60) [D rear: the lid's sides at ±0.60,
    // its foot at 0.60 under the lamps' 0.63]. The shoulder line at the lamps' top, so the
    // whole lamp lies on the upright face (at 0.78 the amber band stood on the turn in).
    { s: 4.665, sill: 0.34, crease: 0.845, belt: 0.85, deck: 0.6, notch: 0.605, notchWall: 0.012, wSill: 0.79, wCrease: 0.82, wBelt: 0.78 },
  ],
  // The side glass's foot ±0.765 over the skin's ±0.835 [D front: the glass ±0.76 at 1.0,
  // ±0.62 at the rail].
  shoulder: { inset: 0.07, rise: 0.02 },
  // The shark nose: above the bumper the face leans forward to its crease under the lip,
  // the lip rounding back over it [P side.jpg on the hubs: the wing's front edge 2.6 cm
  // ahead at 0.73 of where it stands at 0.57, the lip rounding back above; D side: the lamps'
  // band 0.07 behind the bumper's front at 0.58, 0.09 at the lip].
  frontLean: { base: 0.55, lean: -0.17, blend: 0.3, full: 0.2, peak: { y: 0.735, lean: 0.5 } },
  cabin: {
    // Door frames, the B pillar and the bar before the rear door's quarter glass black; A
    // and C pillars body colour [P S, F34, R34].
    columns: [
      // The screen's side from the cowl, the A pillar's foot (1.53 at the belt), to the rail
      // at 2.0; on the centre line the screen's foot stands at 1.33 and its top at 1.95
      // (`screenFoot`, `screenTop`) [D side: the screen's line (258, 175) → (364, 104); the A
      // pillar's band (300, 180) → (380, 105), 4 cm wide; P S on the hubs: the pillar's light
      // band 1.73–1.75 at 1.0, its glass edge 1.86 at 1.11, 2.01 at 1.24].
      { s: 1.53, top: 2.0, upper: 'body' },
      // The front door's black frame up the thin A pillar, its glass right behind it; the
      // door's front shut line below the belt [D side 10 cm under the glass's foot: x 293,
      // 1.54; P S: 1.55].
      { s: 1.553, top: 2.03, upper: 'door1', finish: 'black' },
      // The glass's front edge [D side: (305, 180) → (380, 112), 1.61 at its foot, 2.04 at
      // 1.29; P S: 1.61 at 0.90, 1.86 at 1.11].
      { s: 1.575, top: 2.06, upper: 'door1', glass: 'drop' },
      // The B pillar, black, wider at its foot [D side: the front glass to 2.51 at the belt,
      // the rear from 2.68, 2.59–2.67 at the rail; P S: the front glass's edge 2.495 at the
      // belt to 2.595 at the rail, the rear glass's 2.645 to 2.675]; the shut line between
      // the doors at 2.50–2.53 below it.
      { s: 2.475, top: 2.585, upper: 'door1', finish: 'black' },
      { s: 2.505, top: 2.605, upper: 'body', lower: 'door2', finish: 'black' },
      { s: 2.53, top: 2.625, upper: 'body', lower: 'door2', finish: 'black' },
      { s: 2.6, top: 2.655, upper: 'door2', finish: 'black' },
      { s: 2.645, top: 2.675, upper: 'door2', glass: 'drop' },
      // The black bar between the drop glass and the fixed quarter, upright [D side x
      // 575–580: 3.17–3.2; P S: 3.15–3.17 at the rail, 3.19–3.21 at the belt].
      { s: 3.165, top: 3.165, upper: 'door2', finish: 'black' },
      { s: 3.195, top: 3.195, upper: 'door2', glass: 'fixed' },
      // The quarter's rear edge, the Hofmeister kink: from the bar's top it sweeps down and
      // back in a long curve, falls nearly upright to just over the belt and hooks forward
      // to its foot [D side: 3.32 at 1.22, 3.43 at 1.14, 3.49 at 1.10, 3.52 at 1.03, 3.50 at
      // 0.99, the foot 3.48 at 0.96; P S on the hubs: 3.29 at 1.28, 3.40 at 1.21, 3.50 at
      // 1.125, 3.545 at 1.03, the foot 3.52 at 0.96]. Drawn as the glass's top chamfered
      // inside the door's painted frame (`glassDrop`) in two straight runs, 1.305 at the bar
      // to 1.165 at 3.41 to 1.09 at 3.48, its edge down the door's rear edge to 1.0 at 3.50
      // and its foot cut forward to the belt at 3.44 (`glassRise`). The frame above the curve
      // is the door's, body colour [P S, R34]. The door's frame meets the rail at 3.405–3.41,
      // no further back than the roof's edge over the back light (its top 3.45 less
      // `railInset`, 3.41): at 3.443 / 3.447 the roof's last row ran forward from them to 3.41
      // and the roof and the rail's chamfer folded back over themselves at both rear corners,
      // the headliner showing through (owner, 2026-10-28: «сзади над задним стеклом артефакты
      // крыши»). The glass's rear edge 4 mm further back at the belt for it (3.51).
      { s: 3.44, top: 3.4, upper: 'door2', glass: 'fixed', glassDrop: 0.105 },
      { s: 3.51, top: 3.405, upper: 'door2', glassRise: 0.045, glassDrop: 0.17 },
      // The rear door's rear edge, the door's frame 1 cm wide behind the glass [D side: 3.49
      // at the belt, 3.48 at 0.857, 3.474 at 0.816, 3.457 at 0.774, forward round the rear
      // arch's front to the sill at 3.22; P S: 3.51 at the belt]. (The glass on the shut line
      // itself put the jamb's seal in the cabin lining's plane: kit-zfight.)
      { s: 3.519, top: 3.41, upper: 'body', foot: { y: 0.85, s: 3.22, knee: [3.38, 0.6] } },
      // The C pillar, body colour, to the back light's foot; the roof over the back light's
      // top at 3.45 [D side x 622, y 103]. Its corners square: a step `cornerDrop` with the
      // roof's profile (`roofDrop`) folds the roof in behind the header (README).
      { s: 4.05, top: 3.45 },
    ],
    // The side glass's top along both doors [D side y 108: 1.317] under its 2 cm rubber.
    rail: 1.335,
    railHalf: 0.6, // [D rear: the outline ±0.62–0.63 at 1.31–1.35]
    crown: 0.057, // roof 1.412 [F] = rail + rise + crown
    crownPower: 4,
    railInset: 0.04,
    railRise: 0.02,
    // The roof's line [D side: 1.37 at s 2.0, 1.395 at 2.2, 1.41 from 2.5 to 3.1, 1.39 at
    // 3.3, 1.355 at 3.45].
    roofDrop: [[2.0, 0.042], [2.2, 0.017], [2.5, 0], [3.1, 0], [3.3, 0.022], [3.45, 0.057]],
    glassBottom: 0.01,
    glassTop: 0.02,
    screenBottom: 0.03, // [E]
    screenHeader: 0.045, // [E]
    // The screen curved in plan: its foot on the centre line at 1.33 on the bonnet [D side
    // (258, 175)], its top at 1.95 [D side (364, 104)], against 1.53 / 2.0 at the pillars.
    screenFoot: 0.2,
    screenTop: 0.05,
    wiperBlade: 0.5, // [E] a pair parked along the screen's foot [P F34]
    rearBottom: 0.02,
    rearHeader: 0.025,
    pillar: 0.07, // [E]
  },
  wheels: {
    // The drawn hubs s 0.838 / 3.62 [D side x 172.5 / 652], the factory 2761 centred on them.
    front: 0.848,
    rear: 3.609, // wheelbase 2761 [F]
    radius: 0.317, // 195/65 R15 [F]
    width: 0.195, // [F]
    frontHalfTrack: 0.735, // 1470 [F]
    rearHalfTrack: 0.7475, // 1495 [F]
    // Front: the opening's top 0.36 over the hub [D side: 0.68 over the ground], round.
    arch: 1.13,
    // Rear: lower and flatter over the tyre, reaching further behind the hub than ahead
    // [D side: the top 0.64 over the ground; the edges 0.315 ahead and 0.385 behind].
    rearArch: 1.105,
    rearArchRise: 1.02,
    archShift: [0, 0.035],
    archSegments: 8,
  },
  doorBottom: 0.245, // [D side: the doors' blue ends y 290: 0.243; the black sill strip under it]
  bonnetFront: 0.07,
  // The bonnet covers the whole top, its side shut lines along the wings' top, round the
  // nose over the lamps and kidneys [P F34].
  bonnet: { inset: 0.01 },
  // On the right rear wing behind the rear door, over the arch's back [P S on the hubs:
  // 0.40–0.54 behind the rear hub, 0.61–0.72 high].
  flap: { s0: 3.99, s1: 4.13, y0: 0.61, y1: 0.72, side: 'right' },
  bootEnd: 4.665,
  // The tank lies under the rear seat and the boot floor, its pump reached through the
  // boot floor or from under the seat (go-parts.com E34/E32 fuel pump guide; bimmerfest):
  // none on the boot's shelf.
  bootTank: false,
};

/**
 * The BMW 520i (E34), 1990–95 [P F34, R34, S, F, R; inventory measurements-e34.md §4]. The
 * bumpers body colour with a broad black rubbing band, 0.43–0.50, in line with the black strip
 * along the flanks, 0.475–0.505 [D side; P S, F34]; a black valance under each bumper.
 */
export const LOOK_E34: KitLook = {
  label: 'BMW 520i (E34)',
  // Blue leather and a dark blue dash, as the dash photo the cabin is measured on [P DASH;
  // INT shows a light car].
  upholstery: 0x3d5480,
  dash: 0x2c3b5c,
  headrests: true,
  brightwork: 'black', // the pull handles [P F34, R34, S]
  // Body colour on the PL car, the base black [P F34, R34]; black on the S car.
  mirrorFinish: 'paint',
  // The sill under the doors black between the arches [P S, R34; D side 0.18–0.24]: a
  // cladding band on the body's sill up to the doors' bottom.
  sill: null,
  cladding: { top: 0.245, finish: 'black', span: [1.2, 3.25] },
  // At the front door glass's foot [D side: the head s 1.72–1.86, 0.93–1.07; P S on the hubs:
  // 1.75–1.88, 0.90–1.06; D front: ±0.73–0.91, 1.0–1.1]: a big head straight out of a black
  // base on the door, no arm (owner, 2026-10-27: «зеркала у bmw не так крепятся») [P F34,
  // R34]; its centre 0.985, 11 cm over the belt there (0.875).
  mirrorS: 1.79,
  mirrorMount: 'base',
  mirrorHead: [0.085, 0.052],
  mirrorHeightOffset: 0.04,
  mirrorReach: 0.05,
  // Black pull handles under the shoulder line [D side: the front s 2.27–2.44, the rear
  // 3.17–3.35, y 0.77–0.80; P S].
  handles: { front: 2.355, rear: 3.26, y: 0.785, half: 0.085 },
  // The black rubbing strip along the flanks between the bumpers' wraps, their band
  // continued [D side 0.475–0.505; P S, F34].
  waist: { y: 0.49, height: 0.03, finish: 'black', span: [0.5, 3.97] },
  // A small dark side marker on the front wing ahead of the door [P S on the hubs: 0.36–0.48
  // behind the front hub, 0.51–0.535 high].
  repeater: { s0: 1.21, s1: 1.33, y0: 0.51, y1: 0.535 },
  cornerLamps: [
    // The amber indicators at the corners of the lamps' band, wrapping round onto the wings
    // [P F34, F34r; D front: from ±0.73; D side: to s 0.15].
    {
      points: [
        { x: 0.745, y: [0.56, 0.72], role: 'blinker' },
        { y: [0.565, 0.715], role: 'blinker' },
        { s: 0.15, y: [0.575, 0.705] },
      ],
    },
    // The wing's tail lamps outside the lid: the amber indicator band over the red tail and
    // brake lamp, wrapping round onto the flank [D rear: ±0.62–0.80, amber 0.785–0.845, red
    // 0.63–0.78; D side: to s 4.53; P R, R34]; the red in two rows, one seam across [P R].
    // Their inner edge 6 mm outside the lid's cut (±0.594 at 0.63, ±0.605 at the top), so
    // the band runs on across the lid's lamps with only the cut between [P R: the units meet
    // at the cut].
    {
      end: 'rear',
      points: [
        { x: 0.611, y: [0.785, 0.845], role: 'blinker' },
        { y: [0.785, 0.845], role: 'blinker' },
        { s: 4.54, y: [0.79, 0.84] },
      ],
    },
    {
      end: 'rear',
      ribs: 1,
      points: [
        { x: [0.6, 0.607], y: [0.63, 0.778], role: 'brake' },
        { y: [0.63, 0.778], role: 'brake' },
        { s: 4.53, y: [0.635, 0.775] },
      ],
    },
  ],
  front: {
    // Body colour 0.19–0.53 [D side x 28–40], the black band 0.43–0.50 [D side; P F34], a
    // black valance under it from the foot to 0.30 [P S, F34]; its sides back along the
    // wings to the front arch [D side x 115: s 0.50], the corners rounded [E].
    // The valance's inlay to ±0.78, short of the corner's turn (to ±0.84 it opened a slit at
    // the nose's corner, kit-zfight).
    bumper: { kind: 'moulded', drop: 0.11, height: 0.34, finish: 'paint', moulding: { y: 0.465, height: 0.07, finish: 'black' }, corner: 0.15, wrapTo: 0.5, inlays: [{ x: [0, 0.78], y: [0, 0.11], finish: 'black' }] },
    items: [
      // The black band the lamps stand in, from the kidneys to the indicators [D front:
      // ±0.18–0.73, 0.55–0.735 on the side view's heights].
      { kind: 'panel', x: { from: { centre: 0.18 }, to: { centre: 0.735 } }, y: { from: ['bumperTop', 0.02], to: ['deck', -0.02] }, finish: 'black', proud: 0.004 },
      // Four round head lamps in black rings [D front: centres ±0.40 and ±0.59 at 0.64, the
      // rings 0.08 in radius; P F34].
      { kind: 'round', role: 'head', x: { centre: 0.4 }, y: ['bumperTop', 0.112], radius: 0.066, ring: 'black' },
      { kind: 'round', role: 'head', x: { centre: 0.59 }, y: ['bumperTop', 0.112], radius: 0.066, ring: 'black' },
      // The twin kidneys: one framed grille ±0.17 with black slats [D front: the kidneys
      // ±0.015–0.165, 0.55–0.71; P F34] ...
      {
        kind: 'grille',
        x: { centre: 0.17 },
        // The frame's foot 1 cm over the bumper's top (at 6 mm they fought from afar).
        y: { from: ['bumperTop', 0.035], to: ['deck', -0.03] },
        standOut: 0.01,
        frame: { finish: 'chrome', margin: 0.014 },
        back: true,
        bars: { dir: 'vertical', count: 10, finish: 'dark', margin: 0.02, width: 0.007, depth: 0.012, proud: 0.03 },
      },
      // ... split in two by a body-colour bridge between them [P F34].
      { kind: 'panel', x: { centre: 0.01 }, y: { from: ['bumperTop', 0.035], to: ['deck', -0.03] }, finish: 'paint', proud: 0.046 },
    ],
  },
  rear: {
    // Body colour 0.20–0.53 [D side x 790–842], the black band 0.445–0.50 [D side, D rear], a
    // black valance from the foot to 0.33 [D rear; P R]; forward along the wings to the rear
    // arch [D side x 718: s 3.97].
    bumper: { kind: 'moulded', drop: 0.14, height: 0.33, finish: 'paint', moulding: { y: 0.4725, height: 0.055, finish: 'black' }, corner: 0.15, wrapTo: 3.97, inlays: [{ x: [0, 0.8], y: [0, 0.13], finish: 'black' }] },
    items: [],
    // The lid's part of the band, from the wing units in to the plate, one band with the wing
    // units' red [D rear: the lamps ±0.355–0.59, 0.63–0.78; P R, scaled on the lid's cut at
    // ±0.60: the lamp ±0.36–0.60 in two rows split by a dark seam, the upper row red, the
    // lighter reversing cell ±0.41–0.53, red; inboard a panel ±0.27–0.36 in two rows (the
    // lock in it, right), and next to the plate a single tall red reflector ±0.175–0.265; P
    // R34: the same band to the plate]. Owner, 2026-10-27 («выпуклые фары на крышке
    // багажника»): bevelled lenses 1.5 cm out of the lid read as a proud panel beside the
    // flush wing units. Now as the wing units: flat cells 4 mm out of the lid (`slant` 0:
    // square, unbevelled), on a black housing 2 mm out that shows as the seams, the row seam
    // where the wing units' rib is (0.693–0.715); the outer edge 7 mm inside the lid's cut
    // (as the Espero's band).
    lid: [
      { kind: 'panel', x: { from: { centre: 0.172 }, to: { centre: 0.587 } }, y: { from: ['bumperTop', 0.102], to: ['bumperTop', 0.246] }, finish: 'black', proud: 0.002 },
      { kind: 'lens', role: 'inert', x: { from: { centre: 0.17 }, to: { centre: 0.264 } }, y: { from: ['bumperTop', 0.1], to: ['bumperTop', 0.248] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
      { kind: 'lens', role: 'inert', x: { from: { centre: 0.27 }, to: { centre: 0.354 } }, y: { from: ['bumperTop', 0.1], to: ['bumperTop', 0.163] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
      { kind: 'lens', role: 'inert', x: { from: { centre: 0.27 }, to: { centre: 0.354 } }, y: { from: ['bumperTop', 0.185], to: ['bumperTop', 0.248] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
      { kind: 'lens', role: 'tail', x: { from: { centre: 0.36 }, to: { centre: 0.589 } }, y: { from: ['bumperTop', 0.1], to: ['bumperTop', 0.163] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
      { kind: 'lens', role: 'tail', x: { from: { centre: 0.36 }, to: { centre: 0.405 } }, y: { from: ['bumperTop', 0.185], to: ['bumperTop', 0.248] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
      { kind: 'lens', role: 'reverse', x: { from: { centre: 0.411 }, to: { centre: 0.529 } }, y: { from: ['bumperTop', 0.185], to: ['bumperTop', 0.248] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
      { kind: 'lens', role: 'tail', x: { from: { centre: 0.535 }, to: { centre: 0.589 } }, y: { from: ['bumperTop', 0.185], to: ['bumperTop', 0.248] }, depth: 0.002, proud: 0.002, slant: { outer: 0, inner: 0 } },
    ],
  },
};
