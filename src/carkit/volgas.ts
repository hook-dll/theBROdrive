/**
 * The Volgas: GAZ-24 and GAZ-31029, on the `classic` platform (front engine, rear drive).
 * Numbers and sources in measurements-volga.md.
 *
 * GAZ-24: 3dcar.ru's `gaz_24.jpg`, the factory four-view with its dimension lines (4735,
 * 2800, front overhang 756, height 1490, width 1800, tracks 1476 / 1420). Side view 5.10
 * mm/px from the drawn wheelbase (hubs x 657 / 1206, ground y 334); its tips (x 512 /
 * 1433) give 4697, so the bumpers stand 16 mm (front) and 21 mm (rear) further out than
 * drawn: s = 0.016 + (x − 512) × 0.0051. The axles land on the dimension lines (0.756,
 * 3.556).
 *
 * GAZ-31029: the 24's doors, roof and greenhouse (the GAZ-3102's body) with the square
 * 3102-style nose and its own tail. Measured on the-blueprints.com GAZ-31029 drawing
 * (dimension lines 4885, 2800, 1476): side view 5.761 mm/px from the drawn wheelbase (hubs
 * x 161.5 / 647.5, ground y 330), heights × 1.028 to the 24 drawing's roof (1.469 → 1.51,
 * the two drawings' roofs are one stamping) so the shared greenhouse meets the new ends;
 * the 24's middle sits 0.14 further back (front overhang 0.896 against 0.756).
 */

import type { KitLook, TubStation } from './spec';
import type { KitBody } from './specs';

/**
 * GAZ-24: overhangs 756 / 1179 over a 2800 wheelbase. The bonnet's lip 0.95 at s 0.09,
 * the bonnet rising to 1.07 at the cowl (1.357); the windscreen to the roof's front at
 * 1.75, roof 1.51 (rail 1.40) to 3.32; the back light down to the boot at 3.688, 1.04
 * high; the boot falling to the tail's top (0.865 at 4.606). Sill 0.262 (drawn 0.24–0.26;
 * level, so the chrome sill strip lies on it), door bottoms 0.29, belt 0.955, the widest
 * line 0.80. Front door 1.459 to 2.362 with a quarter light
 * to 1.915; rear door 2.40 to 3.203 at the belt, its glass to 2.938 and a blind sail
 * behind it.
 */
export const BODY_GAZ24: KitBody = {
  length: 4.735,
  platform: 'classic',
  stations: [
    // The face, grille and lamps between the bumper and the bonnet's lip [D side view: x
    // 522, the lip y 148]; the nose 1.70 wide [D top view]. Its top arched across: the
    // bonnet's lip 0.95 on the centre line, the wings' corners 0.91 [D front view: y 155 at
    // ±0.83].
    { s: 0.067, sill: 0.4, crease: 0.78, belt: 0.895, deck: 0.945, wSill: 0.83, wCrease: 0.86, wBelt: 0.85 },
    { s: 0.25, sill: 0.3, crease: 0.79, belt: 0.92, deck: 0.995, wSill: 0.87, wCrease: 0.895, wBelt: 0.885 },
    // The cowl: the screen's foot [D: x 775, y 120].
    { s: 1.357, sill: 0.262, crease: 0.8, belt: 0.955, deck: 1.07, wSill: 0.875, wCrease: 0.9, wBelt: 0.885 },
    { s: 2.4, sill: 0.262, crease: 0.8, belt: 0.96, deck: 1.0, wSill: 0.875, wCrease: 0.9, wBelt: 0.885 },
    // The back light's foot [D: x 1232, y 130]; the boot falls quickly behind it, then
    // gently [D side view, its top line: 1.015 at s 3.75, 0.995 at 3.8, 0.984 at 3.9, 0.979
    // at 4.0, 0.964 at 4.1].
    { s: 3.688, sill: 0.262, crease: 0.8, belt: 0.955, deck: 1.04, wSill: 0.875, wCrease: 0.9, wBelt: 0.885 },
    { s: 3.8, sill: 0.273, crease: 0.797, belt: 0.954, deck: 0.997, wSill: 0.874, wCrease: 0.899, wBelt: 0.884 },
    { s: 4.086, sill: 0.3, crease: 0.79, belt: 0.95, deck: 0.972, wSill: 0.87, wCrease: 0.895, wBelt: 0.88 },
    // The boot lid's trailing edge [D: x 1400, y 161], then the tail face [D: x 1418].
    { s: 4.55, sill: 0.4, crease: 0.78, belt: 0.89, deck: 0.89, wSill: 0.845, wCrease: 0.87, wBelt: 0.86 },
    { s: 4.637, sill: 0.42, crease: 0.77, belt: 0.865, deck: 0.865, wSill: 0.83, wCrease: 0.855, wBelt: 0.845 },
  ],
  shoulder: { inset: 0.03, rise: 0.015 },
  cabin: {
    columns: [
      // The A pillar from the screen's foot to the roof's front [D: x 775 → 852].
      { s: 1.36, top: 1.75, upper: 'body' },
      // A slim pillar with the quarter light close behind it (owner, 2026-10-16: the door's
      // frame from 1.46 and the quarter light's glass from 1.60 at the belt left a broad
      // painted wedge). Drawn [D: (806, 125) → (856, 70)], the pillar's outer line and the
      // quarter light's front edge stand 14 px (0.072 of s) apart at mid height, 5.3 cm
      // across [P "GAZ-24 (1st generation) Volga (side view)": 22 px at 5.46 mm/px, chrome
      // included]: here the door's frame 0.04 behind the pillar's line and the glass 0.035
      // behind that, parallel to it. Below the belt the wing still reaches back to the door's
      // shut line at 1.459 [D: x 795].
      { s: 1.4, top: 1.79, upper: 'door1', lower: 'body' },
      // The quarter light from here to its post [D: x 884–890, upright, 1.913–1.944].
      { s: 1.435, top: 1.825, upper: 'door1', glass: 'vent', lower: 'body' },
      { s: 1.46, top: 1.85, upper: 'door1', glass: 'vent' },
      { s: 1.92, top: 1.92, upper: 'door1' },
      { s: 1.94, top: 1.94, upper: 'door1', glass: 'drop' },
      // The B pillar [D: x 965 / 972 / 980 / 985], upright.
      { s: 2.326, top: 2.326, upper: 'door1' },
      { s: 2.362, top: 2.362, upper: 'body', lower: 'door1' },
      { s: 2.4, top: 2.4, upper: 'body', lower: 'door2' },
      { s: 2.428, top: 2.428, upper: 'door2' },
      // The rear door's glass: level to 2.80, then its top-rear corner turns down to the
      // post [D: (1055, 64) → (1090, 82): 2.785 / 1.377 → 2.964 / 1.285; the post x
      // 1088–1095, 2.954–2.99]; behind the post a fixed pane to the raked rear edge [D:
      // (1092, 80) → (1127, 137): 2.974 / 1.295 → 3.153 / 1.005].
      { s: 2.454, top: 2.454, upper: 'door2', glass: 'drop' },
      { s: 2.8, top: 2.8, upper: 'door2', glass: 'drop' },
      { s: 2.89, top: 2.89, upper: 'door2', glass: 'drop', glassDrop: 0.012 },
      { s: 2.95, top: 2.95, upper: 'door2', glassDrop: 0.063 },
      { s: 2.975, top: 2.975, upper: 'door2', glass: 'fixed', glassDrop: 0.063 },
      { s: 3.175, top: 2.975, upper: 'door2', glassDrop: 0.111 },
      // The door's shut line, raked along the C pillar from the belt (x 1137) to the rail
      // (x 1080); below the belt the edge runs forward to the sill ahead of the arch [D:
      // upright to y 212, to x 1118 at the door's bottom].
      { s: 3.203, top: 2.94, upper: 'body', foot: { y: 0.62, s: 3.107 } },
      // The C pillar to the back light's foot; the roof's rear end [D: x 1160].
      { s: 3.688, top: 3.32 },
    ],
    // Gutter y 58 [D], roof 1.51 [D: dimension 1490 at the drawing's 5.07 mm/px]; the roof
    // 1.40 wide at the rail [D front view].
    rail: 1.4,
    railHalf: 0.7,
    crown: 0.08,
    railInset: 0.06,
    // The roof's edge rounds into the side glass [D front and rear views: the outline turns
    // from the pillars' lean to the roof over 0.11 across, (0.712, 1.391) → (0.598, 1.457)].
    railBend: [0.3, 0.6],
    railRise: 0.03,
    // The roof's long arch [D side view, the roof's top line: 1.474 at s 1.765, 1.505 at
    // 1.918, 1.52 from 2.12 to 2.38, 1.505 at 2.734, 1.494 at 2.887, 1.479 at 3.04, 1.454
    // at 3.193, 1.403 at 3.295; the back light's top 1.387 at 3.336].
    roofDrop: [[1.75, 0.02], [1.81, 0.02], [1.9, 0.01], [2.05, 0], [2.65, 0], [2.85, 0.02], [3.05, 0.035], [3.2, 0.065], [3.32, 0.09]],
    // Window sill 1.0, tops 1.346–1.38 [D side view].
    glassBottom: 0.045,
    glassTop: 0.03,
    screenBottom: 0.03,
    screenHeader: 0.05,
    // [E] No catalogue length was found: the 2101's 0.33 scaled by the screens' widths.
    wiperBlade: 0.38,
    // The screen's foot on the centre line 0.13 ahead of its corners [D top view].
    screenFoot: 0.12,
    rearBottom: 0.03,
    rearHeader: 0.05,
    pillar: 0.08,
  },
  wheels: {
    front: 0.756,
    rear: 3.556,
    radius: 0.354,
    width: 0.187,
    frontHalfTrack: 0.735,
    rearHalfTrack: 0.71,
    // The front arch clear of the tyre [D: top 81 px over the hub, 0.413]; the rear one as
    // wide as the tyre and covering its top [D: 66 px, 0.337].
    arch: 1.17,
    rearArch: 1.0,
    rearArchRise: 0.95,
  },
  // [D: 0.275 (front) – 0.316 (rear)]; 0.31 keeps the doors' skin off the chrome sill
  // strip (at 0.29 the new door columns left a 4.7 mm far-range z-fight on the right side).
  doorBottom: 0.31,
  bonnetFront: 0.09,
  bootEnd: 4.55,
  // An oval flap high on the left rear wing [D: x 1345–1390, y 190–217; P "GAZ-24 (1st
  // generation) Volga (side view)": s 4.45, 0.63].
  flap: { s0: 4.264, s1: 4.494, y0: 0.597, y1: 0.734, side: 'left' },
};

/**
 * The early GAZ-24 (1970–1977) [D front and rear views; P "GAZ-24 (1st generation) Volga"
 * front, side, tail light; "GAZ-24 orange colored" front and rear]: a full-width grille of
 * upright chrome bars between two round lamps in chrome rings, small indicators under the
 * lamps, a chrome blade with two fangs; at the back tall lamps on the tail's corners (red
 * over amber over the white reversing cell) in chrome rims, a ribbed chrome band across the
 * panel between them; chrome sill strips, chrome handles, no head restraints.
 */
export const LOOK_GAZ24: KitLook = {
  label: 'GAZ-24 Volga',
  upholstery: 0x5a3b2e,
  dash: 0x1d1c1b,
  headrests: false,
  brightwork: 'chrome',
  sill: 'chrome',
  waist: null,
  repeater: null,
  front: {
    // [D front view: blade 0.47–0.545, fangs at ±0.28 hanging to 0.34; side view: its end
    // back along the wing to x 580, s 0.363, 0.33 behind the bar's back]
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.07,
      height: 0.075,
      depth: 0.035,
      wrap: 0.33,
      strip: null,
      overriders: { inset: 0.58, half: [0.025, 0.085], drop: 0.085, finish: 'chrome' },
    },
    items: [
      // [D front view: ±0.587, 0.61 – 0.89]
      {
        kind: 'grille',
        x: { centre: 0.587 },
        y: { from: ['bumperTop', 0.068], to: ['deck', -0.055] },
        frame: { finish: 'chrome', margin: 0.012 },
        back: true,
        bars: { dir: 'vertical', count: 24, finish: 'chrome', margin: 0.015, width: 0.012, depth: 0.01, proud: 0.025 },
      },
      // [D front view: centres ±0.70 at 0.763, the lens 0.155 across in a 0.22 ring]
      { kind: 'round', role: 'head', x: { centre: 0.7 }, y: ['mid', 0.019], radius: 0.09 },
      // [D front view: ±0.62..0.74, 0.56–0.60]
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.62 }, to: { centre: 0.74 } }, y: { from: ['bumperTop', 0.018], to: ['bumperTop', 0.058] }, depth: 0.0135, proud: 0.0065 },
    ],
  },
  rear: {
    // [D rear view: blade 0.455–0.545; P: the early car's two fangs; D side view: its end
    // forward along the wing to x 1342, s 4.249, 0.436 ahead of the bar's back]
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.045,
      height: 0.08,
      depth: 0.05,
      wrap: 0.43,
      strip: null,
      overriders: { inset: 0.58, half: [0.025, 0.075], drop: 0.06, finish: 'chrome' },
    },
    items: [
      // The ribbed band between the lamps [D rear view: ±0.64, 0.74–0.81].
      {
        kind: 'grille',
        x: { centre: 0.64 },
        y: { from: ['deck', -0.125], to: ['deck', -0.055] },
        frame: { finish: 'chrome', margin: 0.008 },
        back: false,
        bars: { dir: 'horizontal', count: 3, finish: 'chrome', margin: 0.01, width: 0.008, depth: 0.006, proud: 0.012 },
      },
      // The tall lamps on the corners [D rear view: ±0.72..0.82, 0.607–0.837; P tail
      // light: red over amber over the white reversing cell, the red half its height: here
      // the tail and stop lamps one over the other], in chrome rims.
      { kind: 'frame', x: { from: { centre: 0.712 }, to: { centre: 0.828 } }, y: { from: ['bumperTop', 0.058], to: ['deck', -0.02] }, width: 0.01, finish: 'chrome', proud: 0.012 },
      { kind: 'cluster', x: { from: { centre: 0.72 }, to: { centre: 0.82 } }, y: { from: ['bumperTop', 0.066], to: ['deck', -0.028] }, columns: [['tail', 'brake', 'blinker', 'reverse']] },
    ],
  },
};

/** GAZ-31029 frame = GAZ-24 frame + 0.14 for the shared middle. */
const DS_31029 = 0.14;

function shift<T extends { readonly s: number }>(items: readonly T[], ds: number): T[] {
  return items.map((it) => ({ ...it, s: it.s + ds }));
}

/** The 24's cowl and middle stations, in the 31029's frame. */
const MIDDLE_24_IN_31029: TubStation[] = shift(BODY_GAZ24.stations.slice(2, 4), DS_31029);

/**
 * GAZ-31029: overhangs 896 / 1189 over a 2800 wheelbase [D]. A square nose: the face
 * upright at s 0.07 under a flat bonnet (lip 0.86, 0.95 at s 0.54, 1.07 at the cowl);
 * the 24's doors, pillars and roof 0.14 further back; the back light down to a lower,
 * flatter boot at 3.92 (0.98); the lid falling to 0.93 at its trailing edge (4.73) and
 * coming down the tail face to 0.778 between the wings, the lamps under it.
 */
export const BODY_GAZ31029: KitBody = {
  ...BODY_GAZ24,
  length: 4.885,
  stations: [
    // The face [D side view: x 15–25; front view: lamps 0.577–0.77, the lip 0.86].
    // The bonnet's centre line is the drawing's (lip 0.86, 0.947 at s 0.54, 1.07 at the
    // cowl); its crown over the wings' top grows evenly along it, 0.02 at the lip to the
    // 24's 0.10 at the cowl (`belt` = deck − shoulder rise − crown). The drawn wings' top
    // put the crown at −0.005 (a dish) to s 0.25, then 0.022, then 0.10: a crown that
    // jumps twists the bonnet into slivers, as on the Oka (owner, 2026-10-16).
    { s: 0.07, sill: 0.34, crease: 0.72, belt: 0.825, deck: 0.86, wSill: 0.85, wCrease: 0.875, wBelt: 0.87 },
    // The lamps' wrap ends; the wing's top and the bonnet rise to the cowl [D: bonnet 0.947
    // at x 100, 1.007 at x 200].
    { s: 0.25, sill: 0.3, crease: 0.75, belt: 0.855, deck: 0.9, wSill: 0.875, wCrease: 0.9, wBelt: 0.885 },
    { s: 0.542, sill: 0.28, crease: 0.77, belt: 0.871, deck: 0.947, wSill: 0.875, wCrease: 0.9, wBelt: 0.885 },
    ...MIDDLE_24_IN_31029,
    // The back light's foot on the new boot [D: x 686.7, y 166.7].
    { s: 3.92, sill: 0.27, crease: 0.79, belt: 0.945, deck: 0.98, wSill: 0.875, wCrease: 0.9, wBelt: 0.885 },
    { s: 4.42, sill: 0.33, crease: 0.78, belt: 0.93, deck: 0.967, wSill: 0.87, wCrease: 0.895, wBelt: 0.88 },
    // The lid's trailing edge [D: x 826.7, y 173.3], then the tail face: the lid's foot
    // 0.778 between the wings, cut at ±0.677 [D rear view]; the tail lamps under it. The
    // wings' top falls round the tail's corners [D side view, the outline: 0.906 at s 4.75,
    // 0.805 at 4.80].
    { s: 4.73, sill: 0.4, crease: 0.77, belt: 0.915, deck: 0.93, wSill: 0.855, wCrease: 0.88, wBelt: 0.865 },
    { s: 4.805, sill: 0.4, crease: 0.76, belt: 0.84, deck: 0.778, notch: 0.677, wSill: 0.845, wCrease: 0.87, wBelt: 0.855 },
  ],
  cabin: {
    ...BODY_GAZ24.cabin,
    // The 24's pillars, shut lines and door frames 0.14 further back; the glass as the
    // 31029 drawing has it (no quarter light, no post in the rear door).
    columns: [
      { s: 1.5, top: 1.89, upper: 'body' },
      // The 24's slim pillar 0.14 further back: the door's frame 0.04 behind the pillar's
      // line, the glass 0.035 behind that, parallel to it, the wing below the belt to the
      // door's shut line (1.60). Drawn [D: at y 125 the pillar's outer line x 316 (1.786),
      // the glass x 330 (1.867), 0.081 of s apart; the glass's front edge (310, 155) →
      // (355, 100), 1.698 at the belt]; the door's frame from 1.60 and the glass from 1.70
      // at the belt left a broad painted wedge (owner, 2026-10-16).
      { s: 1.54, top: 1.93, upper: 'door1', lower: 'body' },
      { s: 1.575, top: 1.965, upper: 'door1', glass: 'drop', lower: 'body' },
      { s: 1.6, top: 1.99, upper: 'door1', glass: 'drop' },
      { s: 2.466, top: 2.466, upper: 'door1' },
      { s: 2.502, top: 2.502, upper: 'body', lower: 'door1' },
      { s: 2.54, top: 2.54, upper: 'body', lower: 'door2' },
      { s: 2.568, top: 2.568, upper: 'door2' },
      // The rear glass: level to 2.94, its top-rear corner turning down [D: 1.38 at x 500,
      // 1.327 at x 530 (3.019), 1.273 at x 540 (3.077)] into the raked rear edge [D:
      // (540, 115) → (578, 162): 3.077 / 1.273 → 3.295 / 0.995, 3.315 at the belt].
      { s: 2.594, top: 2.594, upper: 'door2', glass: 'drop' },
      { s: 2.94, top: 2.94, upper: 'door2', glass: 'drop' },
      { s: 3.02, top: 3.02, upper: 'door2', glass: 'drop', glassDrop: 0.025 },
      { s: 3.315, top: 3.053, upper: 'door2', glassDrop: 0.077 },
      // The shut line [D: x 589 below the belt, 3.36; the frame's outer line raked to the
      // rail at 3.08], forward to the sill ahead of the arch as on the 24.
      { s: 3.36, top: 3.08, upper: 'body', foot: { y: 0.62, s: 3.247 } },
      // The C pillar to the back light's foot; the roof's rear end [D: x 606.7, 3.46].
      { s: 3.92, top: 3.46 },
    ],
    // [D side view, the roof's top line: 1.445 at s 1.867, 1.481 at 1.982, 1.498 from 2.155
    // to 2.731, 1.486 at 2.846–2.961, 1.475 at 3.077, 1.457 at 3.249, 1.427 at 3.365, 1.398
    // at 3.422, 1.368 at 3.48]
    roofDrop: [[1.89, 0.025], [1.95, 0.025], [2.05, 0.011], [2.16, 0], [2.75, 0], [3.08, 0.023], [3.3, 0.05], [3.46, 0.094]],
  },
  wheels: {
    front: 0.896,
    rear: 3.696,
    radius: 0.321,
    width: 0.205,
    frontHalfTrack: 0.7475,
    rearHalfTrack: 0.7125,
    // [D: the front arch's top 0.393 over the hub; the rear one covers the tyre's top, 0.30
    // over the hub]
    arch: 1.22,
    rearArch: 1.08,
    rearArchRise: 0.93,
  },
  bonnetFront: 0.075,
  // The lid comes down the tail face between the wings.
  bootEnd: 4.805,
  // [D: x 776.7–805, y 211.7–230, drawn on the left side as on the 24]
  flap: { s0: 4.44, s1: 4.6, y0: 0.59, y1: 0.70, side: 'left' },
};

/**
 * GAZ-31029 [D front and rear views; P Commons "GAZ-31029 Volga (front view)", "(rear
 * view)", "Wolga 31029 1993 im Museum Wilkau-Haßlau"]: rectangular head lamps with the
 * indicators wrapping round the corners, a black grille in a chrome frame between them, a
 * black bumper; at the back horizontal lamps under the lid wrapping round the wings (amber
 * outside, red, the white reversing cell, red inside), a black bumper; head restraints.
 */
export const LOOK_GAZ31029: KitLook = {
  ...LOOK_GAZ24,
  label: 'GAZ-31029 Volga',
  upholstery: 0x3b3a3d,
  headrests: true,
  brightwork: 'black',
  sill: null,
  // The amber side marker on the front wing [D: x 205–218, y 183–188].
  repeater: { s0: 1.146, s1: 1.22, y0: 0.82, y1: 0.85 },
  cornerLamps: [
    // Head lamp [D front view: ±0.446..0.734, 0.577–0.77], the indicator round the corner
    // and back along the wing [D side view: to s 0.225].
    {
      points: [
        { x: 0.446, y: [0.577, 0.77], role: 'head' },
        { x: 0.734, y: [0.577, 0.77], role: 'blinker' },
        { y: [0.577, 0.77], role: 'blinker' },
        { s: 0.215, y: [0.58, 0.755] },
      ],
    },
    // Tail [D rear view: red ±0.274..0.389, white to 0.49, red to 0.749, amber to the
    // corner, 0.557–0.743; side view: the amber cell back to s 4.64].
    {
      end: 'rear',
      points: [
        { x: 0.274, y: [0.557, 0.743], role: 'brake' },
        { x: 0.389, y: [0.557, 0.743], role: 'reverse' },
        { x: 0.49, y: [0.557, 0.743], role: 'tail' },
        { x: 0.749, y: [0.557, 0.743], role: 'blinker' },
        { y: [0.557, 0.743], role: 'blinker' },
        { s: 4.65, y: [0.557, 0.743] },
      ],
    },
  ],
  front: {
    // [D side view: 0.415–0.525, back along the wing to x 85, s 0.455, 0.415 behind the
    // bar's back; front view: across the face, black]
    bumper: { kind: 'blade', finish: 'black', lift: 0.095, height: 0.11, depth: 0.04, wrap: 0.415, strip: null, overriders: null },
    items: [
      // [D front view: ±0.432 over its frame, 0.553–0.779]; 0.42 so the frame stops short of
      // the head lamps' inner ends (0.446).
      {
        kind: 'grille',
        x: { centre: 0.42 },
        y: { from: ['bumperTop', 0.028], to: ['deck', -0.08] },
        frame: { finish: 'chrome', margin: 0.01 },
        back: true,
        bars: { dir: 'horizontal', count: 4, finish: 'black', margin: 0.012, width: 0.012, depth: 0.01, proud: 0.015 },
      },
    ],
  },
  rear: {
    // [D side view: 0.373–0.491, forward along the wing to x 803, s 4.59, 0.25 ahead of
    // the bar's back]
    bumper: { kind: 'blade', finish: 'black', lift: -0.003, height: 0.118, depth: 0.045, wrap: 0.25, strip: null, overriders: null },
    items: [],
  },
};
