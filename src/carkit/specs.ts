/**
 * The kit's cars, read off the factory four-view drawings in build/carshape/_refs/bp/img
 * (vaz2101.jpg, vaz2108.jpg) and the 3dcar.ru drawings and Wikimedia Commons photos the
 * classics were measured on (vaz_2103.jpg, vaz_2106.jpg, vaz_2105.jpg, vaz_2107_1982.jpg;
 * every figure with its source and scale in measurements-classics.md).
 *
 * Every number below was measured on a gridded crop of the side view: the scale is the
 * drawing's own overall length dimension, `s` is taken from the front bumper's tip and
 * heights from the drawn ground line. The drawings stand a little lower than the
 * passport heights (1382 against 1440 for the 2101, 1335 against 1402 for the 2108);
 * the loader fits the body to the passport (render/carmodel.ts `buildTemplate`), so
 * the shapes are kept as drawn and grow those few percent together.
 *
 * A body family shares one shell (`KitBody`); each car is that shell moved to its own
 * bumper tip (`onBody`) and its own face, tail and trim. Face heights measured on a
 * drawing of a taller car are brought to the shell's drawing by the ratio of the two
 * cars' heights.
 */

import { BODY_2102, BODY_2104, REAR_2102, REAR_2104 } from './estates';
import { CABIN_2101, CABIN_2103, CABIN_2105, CABIN_2107 } from './interior';
import type { KitCarSpec, KitLook } from './spec';

/** The shape of a car: everything a spec holds but its id, its looks and its cabin. */
export type KitBody = Omit<KitCarSpec, 'id' | 'look' | 'cabinLayout'>;

/**
 * A family's shell for one car: every `s` moved by `ds` (a bumper standing further out
 * moves the whole body back from the tip) and the overall length the car's own.
 */
function onBody(body: KitBody, ds: number, length: number): KitBody {
  const cabin = body.cabin;
  return {
    ...body,
    length,
    stations: body.stations.map((st) => ({ ...st, s: st.s + ds })),
    cabin: {
      ...cabin,
      columns: cabin.columns.map((c) => ({ ...c, s: c.s + ds, top: c.top + ds })),
      rearKnee: cabin.rearKnee && { ...cabin.rearKnee, s: cabin.rearKnee.s + ds },
    },
    wheels: { ...body.wheels, front: body.wheels.front + ds, rear: body.wheels.rear + ds },
    bonnetFront: body.bonnetFront + ds,
    bootEnd: body.bootEnd === undefined ? undefined : body.bootEnd + ds,
    flap: { ...body.flap, s0: body.flap.s0 + ds, s1: body.flap.s1 + ds },
  };
}

/** The Samara's deep moulded bumpers, the front one taller. */
const SAMARA_FRONT_BUMPER = { kind: 'moulded', drop: 0.03, height: 0.26 } as const;
const SAMARA_REAR_BUMPER = { kind: 'moulded', drop: 0.03, height: 0.22 } as const;

/**
 * The Fiat 124 shell of the 2101, 2103 and 2106, in the 2106's frame (its bumpers stand
 * 45 mm further out than the 2101's, so every `s` here is the 2101 drawing's plus 0.045).
 *
 * 2101 drawing, 4.703 mm/px: overhangs 603 / 1046 over a 2424 wheelbase; the body sheet
 * starts 103 mm behind the bumper; bonnet lip 748 high rising to 884 at the cowl
 * (s 1160); an upright screen to the roof's front at s 1416; roof to s 2996; back
 * light down to the boot at s 3254, 842 high; tail top 762 at s 3970. Sill 263, door
 * bottoms 287, belt 856, glass 865 to 1237, roof gutter 1275, roof 1337. Front door
 * 1171 to 2079, B pillar to 2121, rear door to 2972 over the rear arch.
 */
const BODY_124: KitBody = {
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
};

/**
 * The squared "05" shell of the 2105 and 2107, read off the dimensioned
 * vaz_2107_1982.jpg (1.668 mm/px from its 4136 overall length; top view 1.637 mm/px
 * from the 1620 width). Hubs as drawn at 635 / 3048 (its dimension line says 655 / 3079;
 * the arches and doors are drawn round the hubs). Bonnet 906 at s 300 rising to 968 at
 * s 900; screen base 1000 high at s 985, raked about 45° to the roof's front at s 1410;
 * a sharp character crease 760-767 nose to tail, dropping to 700 at the tail; window
 * sill 955, glass top 1335, gutter 1375, roof 1448. Front door 1165 to 2090, rear door
 * 2090 to 2955 round the arch with a fixed quarter pane behind a channel at 2690; no
 * vent windows. Back light 2950 (roof) to 3330 (deck, 935). Estimated: the rear corners'
 * widths (the top view's outline lies on its dimension line), the crown/rail split,
 * the screen and back-light strips (as the 2106's), the fuel flap (from a photo).
 */
const BODY_05: KitBody = {
  length: 4.13,
  platform: 'classic',
  stations: [
    { s: 0.05, sill: 0.36, crease: 0.76, belt: 0.795, deck: 0.82, wSill: 0.74, wCrease: 0.755, wBelt: 0.745 },
    { s: 0.35, sill: 0.36, crease: 0.763, belt: 0.868, deck: 0.913, wSill: 0.77, wCrease: 0.79, wBelt: 0.77 },
    { s: 0.9, sill: 0.265, crease: 0.766, belt: 0.878, deck: 0.968, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    { s: 1.0, sill: 0.268, crease: 0.766, belt: 0.88, deck: 1.0, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    { s: 2.1, sill: 0.258, crease: 0.767, belt: 0.885, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    { s: 3.33, sill: 0.262, crease: 0.735, belt: 0.874, deck: 0.935, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    { s: 3.9, sill: 0.37, crease: 0.708, belt: 0.815, deck: 0.854, wSill: 0.77, wCrease: 0.805, wBelt: 0.775 },
    { s: 4.075, sill: 0.4, crease: 0.7, belt: 0.76, deck: 0.795, wSill: 0.75, wCrease: 0.785, wBelt: 0.76 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 },
  cabin: {
    columns: [
      { s: 1.0, top: 1.41, upper: 'body' },
      { s: 1.17, top: 1.44, upper: 'door1' },
      { s: 1.22, top: 1.48, upper: 'door1', glass: 'drop' },
      { s: 2.055, top: 2.062, upper: 'door1' },
      { s: 2.075, top: 2.08, upper: 'body', lower: 'door1' },
      { s: 2.09, top: 2.095, upper: 'body', lower: 'door2' },
      { s: 2.11, top: 2.112, upper: 'door2' },
      { s: 2.127, top: 2.127, upper: 'door2', glass: 'drop' },
      { s: 2.68, top: 2.68, upper: 'door2' },
      { s: 2.7, top: 2.7, upper: 'door2', glass: 'fixed' },
      { s: 2.955, top: 2.71, upper: 'door2' },
      { s: 2.975, top: 2.73, upper: 'body' },
      { s: 3.33, top: 2.95 },
    ],
    rail: 1.375,
    railHalf: 0.62,
    crown: 0.048,
    railInset: 0.05,
    railRise: 0.025,
    glassBottom: 0.05,
    glassTop: 0.04,
    screenBottom: 0.025,
    screenHeader: 0.045,
    rearBottom: 0.025,
    rearHeader: 0.045,
    pillar: 0.07,
  },
  wheels: {
    front: 0.635,
    rear: 3.048,
    radius: 0.288,
    width: 0.165,
    frontHalfTrack: 0.6825,
    rearHalfTrack: 0.6605,
    arch: 1.15,
  },
  doorBottom: 0.365,
  bonnetFront: 0.06,
  bootEnd: 4.06,
  flap: { s0: 3.19, s1: 3.31, y0: 0.69, y1: 0.81 },
};

/**
 * VAZ-2101 (vaz2101.jpg and Commons photos): two big round lamps either side of a wide
 * chrome grille, the indicators under them on the face, a thin chrome blade with tall
 * chrome fangs; small horizontal tail lamps in chrome rims with the reversing lamps
 * apart under them; chrome sill, a round repeater on the wing, no headrests.
 */
const LOOK_2101: KitLook = {
  label: 'VAZ-2101',
  upholstery: 0x7a2f22,
  dash: 0x1d1c1b,
  headrests: false,
  brightwork: 'chrome',
  sill: 'chrome',
  waist: null,
  repeater: { s0: 0.21, s1: 0.255, y0: 0.67, y1: 0.71 },
  front: {
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.025,
      height: 0.07,
      depth: 0.06,
      strip: null,
      overriders: { inset: 0.405, half: [0.025, 0.09], drop: 0.005, finish: 'chrome' },
    },
    items: [
      {
        kind: 'grille',
        x: { centre: 0.45 },
        y: { from: ['mid', -0.1], to: ['mid', 0.125] },
        frame: { finish: 'chrome', margin: 0.012 },
        back: true,
        bars: { dir: 'horizontal', count: 7, finish: 'chrome', margin: 0.015, width: 0.01, depth: 0.01, proud: 0.028 },
      },
      { kind: 'round', role: 'head', x: { centre: 0.575 }, y: ['mid', 0.04], radius: 0.095 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.535 }, to: { centre: 0.655 } }, y: { from: ['bumperTop', 0.005], to: ['bumperTop', 0.065] }, depth: 0.01, proud: 0.01 },
    ],
  },
  rear: {
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: -0.018,
      height: 0.072,
      depth: 0.038,
      strip: null,
      overriders: { inset: 0.28, half: [0.025, 0.1], drop: 0.022, finish: 'chrome' },
    },
    items: [
      { kind: 'frame', x: { from: { centre: 0.37 }, to: { centre: 0.7 } }, y: { from: ['bumperTop', 0.115], to: ['bumperTop', 0.245] }, width: 0.012, finish: 'chrome', proud: 0.012 },
      { kind: 'cluster', x: { from: { centre: 0.38 }, to: { centre: 0.69 } }, y: { from: ['bumperTop', 0.127], to: ['bumperTop', 0.235] }, columns: [['blinker'], ['tail', 'brake']] },
      { kind: 'lens', role: 'reverse', x: { from: { centre: 0.472 }, to: { centre: 0.594 } }, y: { from: ['bumperTop', 0.065], to: ['bumperTop', 0.108] }, depth: 0.01, proud: 0.012 },
    ],
  },
};

/**
 * VAZ-2103 (vaz_2103.jpg, heights brought to the 124 drawing by 1382/1446, and a
 * straight-on photo scaled by its plate): four round lamps inside one full-width chrome
 * grille, chrome fangs, a chrome waist moulding and sill; at the rear one chrome
 * surround round both lamps and the plate, lamps red over amber with the reversing lamp
 * at the inner end. No headrests.
 */
const LOOK_2103: KitLook = {
  label: 'VAZ-2103',
  upholstery: 0x4a3a2c,
  dash: 0x1d1c1b,
  headrests: false,
  brightwork: 'chrome',
  sill: 'chrome',
  waist: { y: 0.719, height: 0.025, finish: 'chrome' },
  repeater: { s0: 0.14, s1: 0.22, y0: 0.706, y1: 0.737 },
  front: {
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.035,
      height: 0.077,
      depth: 0.06,
      strip: null,
      overriders: { inset: 0.365, half: [0.032, 0.107], drop: -0.008, finish: 'chrome' },
    },
    items: [
      {
        kind: 'grille',
        x: { centre: 0.74 },
        y: { from: ['deck', -0.235], to: ['deck', -0.005] },
        frame: { finish: 'chrome', margin: 0.012 },
        back: true,
        bars: { dir: 'horizontal', count: 11, finish: 'chrome', margin: 0.014, width: 0.012, depth: 0.01, proud: 0.022 },
      },
      { kind: 'round', role: 'head', x: { centre: 0.59 }, y: ['deck', -0.119], radius: 0.064 },
      { kind: 'round', role: 'head', x: { centre: 0.424 }, y: ['deck', -0.119], radius: 0.064 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.545 }, to: { centre: 0.655 } }, y: { from: ['deck', -0.282], to: ['deck', -0.243] }, depth: 0.01, proud: 0.01 },
    ],
  },
  rear: {
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: -0.005,
      height: 0.077,
      depth: 0.055,
      strip: null,
      overriders: { inset: 0.28, half: [0.03, 0.107], drop: 0.023, finish: 'chrome' },
    },
    items: [
      { kind: 'frame', x: { from: { centre: -0.68 }, to: { centre: 0.68 } }, y: { from: ['belt', -0.287], to: ['belt', -0.033] }, width: 0.014, finish: 'chrome', proud: 0.008 },
      { kind: 'cluster', x: { from: { centre: 0.37 }, to: { centre: 0.625 } }, y: { from: ['belt', -0.253], to: ['belt', -0.081] }, columns: [['tail', 'blinker'], ['brake', 'blinker'], ['reverse', 'blinker']] },
    ],
  },
};

/**
 * VAZ-2106 (vaz_2106.jpg, heights by 1382/1446, and Commons photos): four round lamps in
 * black surrounds inside a chrome frame round the whole lamp band, a chrome-framed grille,
 * the indicators on the face under the outer lamps; chrome blades with black plastic end
 * caps and rubber overriders; at the rear a black panel in a chrome outline carrying a
 * 3×3 cell cluster each side; a waist moulding with a black insert.
 */
const LOOK_2106: KitLook = {
  label: 'VAZ-2106',
  upholstery: 0x5b3a2a,
  dash: 0x1d1c1b,
  headrests: true,
  brightwork: 'chrome',
  sill: 'chrome',
  waist: { y: 0.739, height: 0.025, finish: 'black' },
  repeater: { s0: 0.153, s1: 0.243, y0: 0.686, y1: 0.721 },
  front: {
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.045,
      height: 0.09,
      depth: 0.07,
      strip: 'rubber',
      ends: 'black',
      overriders: { inset: 0.365, half: [0.042, 0.07], drop: -0.006, finish: 'rubber' },
    },
    items: [
      { kind: 'frame', x: { from: { centre: -0.765 }, to: { centre: 0.765 } }, y: { from: ['mid', -0.1], to: ['mid', 0.135] }, width: 0.012, finish: 'chrome', proud: 0.01 },
      { kind: 'panel', x: { inset: 0.06 }, y: { at: ['mid', 0.01], half: 0.1 }, finish: 'black', proud: 0.008 },
      { kind: 'round', role: 'head', x: { inset: 0.15 }, y: ['mid', 0.01], radius: 0.068 },
      { kind: 'round', role: 'head', x: { inset: 0.32 }, y: ['mid', 0.01], radius: 0.068 * 0.92 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.54 }, to: { centre: 0.65 } }, y: { from: ['bumperTop', 0.025], to: ['bumperTop', 0.07] }, depth: 0.01, proud: 0.012 },
      {
        kind: 'grille',
        x: { inset: 0.43 },
        y: { at: ['mid', 0.01], half: 0.07 },
        frame: { finish: 'chrome', margin: 0.015 },
        back: true,
        bars: { dir: 'vertical', count: 7, finish: 'chrome', margin: 0.049, width: 0.012, depth: 0.014, proud: 0.03 },
      },
    ],
  },
  rear: {
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.045,
      height: 0.09,
      depth: 0.07,
      strip: 'rubber',
      ends: 'black',
      overriders: { inset: 0.28, half: [0.04, 0.07], drop: 0.01, finish: 'rubber' },
    },
    items: [
      { kind: 'panel', x: { centre: 0.66 }, y: { from: ['belt', -0.265], to: ['belt', -0.01] }, finish: 'black', proud: 0.003 },
      { kind: 'frame', x: { from: { centre: -0.665 }, to: { centre: 0.665 } }, y: { from: ['belt', -0.27], to: ['belt', -0.005] }, width: 0.01, finish: 'chrome', proud: 0.007 },
      {
        kind: 'cluster',
        x: { from: { centre: 0.38 }, to: { centre: 0.64 } },
        y: { from: ['belt', -0.192], to: ['belt', -0.061] },
        columns: [['blinker', 'tail', 'brake'], ['blinker', 'reverse', 'brake'], ['tail', 'tail', 'brake']],
      },
    ],
  },
};

/**
 * VAZ-2105 (vaz_2105.jpg's face and tail, a near-orthographic rear photo scaled by its
 * plate): rectangular lamp units with the amber indicator as their outer cell, a flush
 * black grille, no surround; aluminium bumpers with a black lower lip and black plastic
 * end caps, no overriders; wide rectangular tail lamps, 2×3 cells; a black ribbed sill
 * strip, a rectangular repeater on the wing, black flush handles.
 */
const LOOK_2105: KitLook = {
  label: 'VAZ-2105',
  upholstery: 0x6e6a64,
  dash: 0x1b1b1b,
  headrests: true,
  brightwork: 'black',
  sill: 'black',
  waist: null,
  repeater: { s0: 0.19, s1: 0.26, y0: 0.69, y1: 0.72 },
  front: {
    bumper: { kind: 'blade', finish: 'alloy', lift: 0.0475, height: 0.129, depth: 0.045, lower: { finish: 'black', share: 0.3 }, strip: null, ends: 'black', overriders: null },
    items: [
      {
        kind: 'grille',
        x: { centre: 0.318 },
        y: { from: ['bumperTop', 0.079], to: ['bumperTop', 0.209] },
        back: true,
        bars: { dir: 'horizontal', count: 6, finish: 'black', margin: 0.012, width: 0.01, depth: 0.01, proud: 0.026 },
      },
      { kind: 'lens', role: 'head', x: { from: { centre: 0.343 }, to: { centre: 0.604 } }, y: { from: ['bumperTop', 0.092], to: ['bumperTop', 0.218] }, depth: 0.01, proud: 0.012 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.604 }, to: { centre: 0.669 } }, y: { from: ['bumperTop', 0.092], to: ['bumperTop', 0.218] }, depth: 0.01, proud: 0.012 },
    ],
  },
  rear: {
    bumper: { kind: 'blade', finish: 'alloy', lift: -0.0205, height: 0.161, depth: 0.05, strip: 'rubber', ends: 'black', overriders: null },
    items: [
      {
        kind: 'cluster',
        x: { from: { centre: 0.315 }, to: { centre: 0.688 } },
        y: { from: ['bumperTop', 0.062], to: ['bumperTop', 0.226] },
        columns: [['tail', 'blinker'], ['brake', 'reverse'], ['tail', 'inert']],
      },
    ],
  },
};

/**
 * VAZ-2107 (vaz_2107_1982.jpg's front and rear views, Commons photos): taller
 * rectangular lamps in a black band, a tall chrome grille standing out of the face and
 * above the bonnet's lip; bumpers chrome above and black below with black end caps; tail
 * lamps of two rows, red over reversing and amber.
 */
const LOOK_2107: KitLook = {
  label: 'VAZ-2107',
  upholstery: 0x5a4433,
  dash: 0x1b1b1b,
  headrests: true,
  brightwork: 'black',
  sill: null,
  waist: null,
  repeater: { s0: 0.19, s1: 0.26, y0: 0.69, y1: 0.745 },
  front: {
    bumper: { kind: 'blade', finish: 'chrome', lift: 0.06, height: 0.13, depth: 0.05, lower: { finish: 'black', share: 0.62 }, strip: null, ends: 'black', overriders: null },
    items: [
      { kind: 'panel', x: { centre: 0.719 }, y: { from: ['bumperTop', 0.073], to: ['bumperTop', 0.28] }, finish: 'black', proud: 0.006 },
      { kind: 'lens', role: 'head', x: { from: { centre: 0.372 }, to: { centre: 0.603 } }, y: { from: ['bumperTop', 0.097], to: ['bumperTop', 0.253] }, depth: 0.01, proud: 0.014 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.603 }, to: { centre: 0.695 } }, y: { from: ['bumperTop', 0.097], to: ['bumperTop', 0.253] }, depth: 0.01, proud: 0.014 },
      {
        kind: 'grille',
        x: { centre: 0.33 },
        y: { from: ['bumperTop', 0.08], to: ['bumperTop', 0.295] },
        standOut: 0.03,
        frame: { finish: 'chrome', margin: 0.02 },
        back: true,
        bars: { dir: 'horizontal', count: 7, finish: 'chrome', margin: 0.015, width: 0.008, depth: 0.008, proud: 0.026 },
      },
    ],
  },
  rear: {
    bumper: { kind: 'blade', finish: 'black', lift: -0.0265, height: 0.137, depth: 0.05, strip: 'chrome', ends: 'black', overriders: null },
    items: [
      {
        kind: 'cluster',
        x: { from: { centre: 0.336 }, to: { centre: 0.678 } },
        y: { from: ['bumperTop', 0.081], to: ['bumperTop', 0.218] },
        columns: [['tail', 'blinker'], ['brake', 'reverse']],
      },
    ],
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
    upholstery: 0x3d3f44,
    dash: 0x202224,
    headrests: true,
    brightwork: 'black',
    sill: null,
    waist: null,
    repeater: null,
    // Tall rectangular lamps standing on the bumper, indicators at their outer ends, a
    // black panel with three slots between them under the bonnet's lip.
    front: {
      bumper: SAMARA_FRONT_BUMPER,
      items: [
        { kind: 'panel', x: { inset: 0.03 }, y: { from: ['bumperTop', 0.003], to: ['deck', -0.013] }, finish: 'black', proud: 0.006 },
        // Front view (4.63 mm/px from the 1750 width): the grille panel runs to ±0.34, the unit
        // to ±0.69 with the indicator its outer 70 mm; the outer edge leans in at the top.
        { kind: 'lens', role: 'head', x: { from: { centre: 0.36 }, to: { centre: 0.62 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.035, inner: 0 } },
        { kind: 'lens', role: 'blinker', x: { from: { centre: 0.625 }, to: { centre: 0.69 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.04, inner: 0.035 } },
        {
          kind: 'grille',
          x: { centre: 0.3 },
          y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] },
          back: false,
          bars: { dir: 'horizontal', count: 3, finish: 'dark', margin: 0.02, width: 0.014, depth: 0.01, proud: 0.016 },
        },
      ],
    },
    // Tall units standing on the bumper.
    rear: {
      bumper: SAMARA_REAR_BUMPER,
      items: [
        {
          kind: 'cluster',
          x: { from: { inset: 0.035 }, to: { inset: 0.42 } },
          y: { from: ['bumperTop', 0.015], to: ['belt', -0.02] },
          columns: [['blinker'], ['tail', 'brake'], ['reverse', 'inert']],
        },
      ],
    },
  },
};

export const KIT_SPECS: Readonly<Record<string, KitCarSpec>> = {
  vaz2101: { id: 'vaz2101', ...onBody(BODY_124, -0.045, 4.073), look: LOOK_2101, cabinLayout: CABIN_2101 },
  // The estates' rear bench stands where the saloons' does, not off their longer tail.
  vaz2102: {
    id: 'vaz2102',
    ...onBody(BODY_2102, -0.045, 4.059),
    look: { ...LOOK_2101, label: 'VAZ-2102', rear: REAR_2102 },
    cabinLayout: { ...CABIN_2101, bench: { from: 'rearBase', offset: -1.155 } },
  },
  vaz2103: { id: 'vaz2103', ...onBody(BODY_124, -0.02, 4.116), look: LOOK_2103, cabinLayout: CABIN_2103 },
  vaz2104: {
    id: 'vaz2104',
    ...BODY_2104,
    look: { ...LOOK_2105, label: 'VAZ-2104', rear: REAR_2104 },
    cabinLayout: { ...CABIN_2105, bench: { from: 'rearBase', offset: -1.115 } },
  },
  vaz2105: { id: 'vaz2105', ...BODY_05, look: LOOK_2105, cabinLayout: CABIN_2105 },
  vaz2106: { id: 'vaz2106', ...BODY_124, look: LOOK_2106 },
  vaz2107: { id: 'vaz2107', ...onBody(BODY_05, 0.012, 4.145), look: LOOK_2107, cabinLayout: CABIN_2107 },
  vaz2108: VAZ2108,
};
