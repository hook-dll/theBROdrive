/**
 * The kit's cars, read off the factory four-view drawings in
 * build/carshape/_refs/bp/img (vaz2101.jpg, vaz2108.jpg; 3dcar.ru scans).
 *
 * Every number below was measured on a gridded crop of the side view: the scale is the
 * drawing's own overall length dimension, `s` is taken from the front bumper's tip and
 * heights from the drawn ground line. The drawings stand a little lower than the
 * passport heights (1382 against 1440 for the 2101, 1335 against 1402 for the 2108);
 * the loader fits the body to the passport (render/carmodel.ts `buildTemplate`), so
 * the shapes are kept as drawn and grow those few percent together.
 */

import type { KitCarSpec } from './spec';

/**
 * VAZ-2106 on the 2101 shell (the 2106 shares its body sheet; its bumpers add 45 mm in
 * front, so every `s` here is the 2101 drawing's plus 0.045).
 *
 * 2101 drawing, 4.703 mm/px: overhangs 603 / 1046 over a 2424 wheelbase; the body sheet
 * starts 103 mm behind the bumper; bonnet lip 748 high rising to 884 at the cowl
 * (s 1160); an upright screen to the roof's front at s 1416; roof to s 2996; back
 * light down to the boot at s 3254, 842 high; tail top 762 at s 3970. Sill 263, door
 * bottoms 287, belt 856, glass 865 to 1237, roof gutter 1275, roof 1337. Front door
 * 1171 to 2079, B pillar to 2121, rear door to 2972 over the rear arch.
 */
const VAZ2106: KitCarSpec = {
  id: 'vaz2106',
  length: 4.166,
  platform: 'classic',
  stations: [
    { s: 0.148, sill: 0.33, crease: 0.6, belt: 0.73, deck: 0.765, wSill: 0.745, wCrease: 0.775, wBelt: 0.765 },
    { s: 0.35, sill: 0.28, crease: 0.62, belt: 0.775, deck: 0.81, wSill: 0.77, wCrease: 0.8, wBelt: 0.79 },
    { s: 1.2, sill: 0.262, crease: 0.63, belt: 0.856, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    { s: 2.15, sill: 0.255, crease: 0.63, belt: 0.862, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    { s: 3.3, sill: 0.262, crease: 0.63, belt: 0.83, deck: 0.862, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    { s: 3.9, sill: 0.31, crease: 0.62, belt: 0.785, deck: 0.815, wSill: 0.765, wCrease: 0.795, wBelt: 0.785 },
    { s: 4.075, sill: 0.37, crease: 0.61, belt: 0.755, deck: 0.785, wSill: 0.745, wCrease: 0.775, wBelt: 0.765 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 },
  // Doors at full size, as drawn: the front 0.92 m, the rear 0.88 m reaching over the
  // rear wheel with the arch cut out of it.
  cabin: {
    columns: [
      { s: 1.2, top: 1.445, upper: 'body' },
      { s: 1.235, top: 1.475, upper: 'door1' },
      { s: 1.26, top: 1.5, upper: 'door1', glass: 'vent' },
      { s: 1.55, top: 1.6, upper: 'door1', glass: 'drop' },
      { s: 2.095, top: 2.095, upper: 'door1' },
      { s: 2.125, top: 2.125, upper: 'body', lower: 'door1' },
      { s: 2.145, top: 2.145, upper: 'body', lower: 'door2' },
      { s: 2.165, top: 2.165, upper: 'door2' },
      { s: 2.19, top: 2.19, upper: 'door2', glass: 'drop' },
      { s: 2.985, top: 2.7, upper: 'door2' },
      { s: 3.017, top: 2.735, upper: 'body' },
      { s: 3.3, top: 3.04 },
    ],
    rail: 1.275,
    railHalf: 0.62,
    crown: 0.04,
    railInset: 0.05,
    railRise: 0.022,
    glassBottom: 0.012,
    glassTop: 0.038,
    screenBottom: 0.025,
    screenHeader: 0.045,
    rearBottom: 0.025,
    rearHeader: 0.045,
    pillar: 0.07,
  },
  wheels: {
    front: 0.648,
    rear: 3.072,
    radius: 0.288,
    width: 0.165,
    frontHalfTrack: 0.6825,
    rearHalfTrack: 0.6605,
    arch: 1.13,
  },
  doorBottom: 0.29,
  bonnetFront: 0.17,
  bootEnd: 4.03,
  flap: { s0: 3.2, s1: 3.31, y0: 0.66, y1: 0.76 },
  look: {
    label: 'VAZ-2106',
    bumpers: 'chrome',
    upholstery: 0x5b3a2a,
    dash: 0x1d1c1b,
    headlamps: 'twin-round',
    taillamps: 'classic',
    ventWindows: true,
    headrests: true,
  },
};

/**
 * VAZ-2108, 3.826 mm/px: overhangs 785 / 761 over a 2460 wheelbase. A plastic bumper to
 * s 100, the face raked back to the bonnet's lip at s 164, 803 high; the bonnet climbs
 * to 937 at the cowl (s 1232); a raked screen to the roof's front at s 1760; roof
 * 1335 to s 3190; the tailgate's glass down to its knee at s 3930, 884 high, and a
 * short upright panel over the lamps. Sill 264, door bottom 302, belt 911 rising to
 * 922 over the quarter; door 1278 to 2552, its glass ending at 2460; quarter glass 2605
 * to 3570 at its foot and 3120 at its head.
 */
const VAZ2108: KitCarSpec = {
  id: 'vaz2108',
  length: 4.006,
  platform: 'samara',
  stations: [
    { s: 0.11, sill: 0.36, crease: 0.56, belt: 0.775, deck: 0.79, wSill: 0.76, wCrease: 0.79, wBelt: 0.775 },
    { s: 0.17, sill: 0.33, crease: 0.58, belt: 0.8, deck: 0.815, wSill: 0.78, wCrease: 0.805, wBelt: 0.79 },
    { s: 0.5, sill: 0.285, crease: 0.6, belt: 0.83, deck: 0.85, wSill: 0.795, wCrease: 0.82, wBelt: 0.805 },
    { s: 1.232, sill: 0.264, crease: 0.63, belt: 0.9, deck: 0.92, wSill: 0.8, wCrease: 0.825, wBelt: 0.81 },
    { s: 2.55, sill: 0.264, crease: 0.64, belt: 0.911, deck: 0.93, wSill: 0.8, wCrease: 0.825, wBelt: 0.81 },
    { s: 3.6, sill: 0.28, crease: 0.64, belt: 0.92, deck: 0.94, wSill: 0.795, wCrease: 0.82, wBelt: 0.805 },
    { s: 3.86, sill: 0.33, crease: 0.63, belt: 0.79, deck: 0.81, wSill: 0.78, wCrease: 0.81, wBelt: 0.79 },
    { s: 3.95, sill: 0.36, crease: 0.62, belt: 0.75, deck: 0.77, wSill: 0.765, wCrease: 0.795, wBelt: 0.775 },
  ],
  shoulder: { inset: 0.025, rise: 0.015 },
  cabin: {
    columns: [
      { s: 1.232, top: 1.76, upper: 'body' },
      { s: 1.278, top: 1.8, upper: 'door1' },
      { s: 1.303, top: 1.825, upper: 'door1', glass: 'drop' },
      { s: 2.46, top: 2.46, upper: 'door1' },
      { s: 2.552, top: 2.552, upper: 'body', lower: 'body' },
      { s: 2.605, top: 2.605, upper: 'body', glass: 'fixed' },
      { s: 3.57, top: 3.12, upper: 'body' },
      { s: 3.93, top: 3.19 },
    ],
    rail: 1.295,
    railHalf: 0.64,
    crown: 0.025,
    railInset: 0.035,
    railRise: 0.015,
    glassBottom: 0.012,
    glassTop: 0.04,
    screenBottom: 0.025,
    screenHeader: 0.045,
    rearBottom: 0.025,
    rearHeader: 0.05,
    rearKnee: { s: 3.9, y: 0.884 },
    pillar: 0.07,
  },
  wheels: {
    front: 0.785,
    rear: 3.245,
    radius: 0.281,
    width: 0.165,
    frontHalfTrack: 0.7,
    rearHalfTrack: 0.685,
    arch: 1.28,
  },
  doorBottom: 0.302,
  bonnetFront: 0.17,
  flap: { s0: 3.62, s1: 3.73, y0: 0.73, y1: 0.83 },
  look: {
    label: 'VAZ-2108',
    bumpers: 'plastic',
    upholstery: 0x3d3f44,
    dash: 0x202224,
    headlamps: 'rect',
    taillamps: 'samara',
    ventWindows: false,
    headrests: true,
  },
};

export const KIT_SPECS: Readonly<Record<string, KitCarSpec>> = {
  vaz2106: VAZ2106,
  vaz2108: VAZ2108,
};
