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
 * cars' heights. The estates live in estates.ts, the Samara family (2108, 2109, 21099,
 * 2115) in samaras.ts and the 2110 in tens.ts, each with its measurement report.
 */

import { BODY_2141, LOOK_2141 } from './azlk';
import { BODY_ESPERO, BODY_NEXIA, LOOK_ESPERO, LOOK_NEXIA } from './daewoo';
import { BODY_2102, BODY_2104, REAR_2102, REAR_2104 } from './estates';
import { CABIN_1111, CABIN_2101, CABIN_2103, CABIN_2105, CABIN_2106, CABIN_2107, CABIN_2110, CABIN_2131, CABIN_2141, CABIN_ASTRA_F, CABIN_E34, CABIN_GAZ24, CABIN_GAZ31029, CABIN_ESPERO, CABIN_NEXIA, CABIN_UAZ2206, CABIN_UAZ469, CABIN_VECTRA_A, CABIN_W124 } from './interior';
import { BODY_W124, LOOK_W124 } from './mercedes';
import { BODY_E34, LOOK_E34 } from './bmw';
import { BODY_1111, LOOK_1111 } from './oka';
import { BODY_ASTRA_F, BODY_VECTRA_A, LOOK_ASTRA_F, LOOK_VECTRA_A } from './opel';
import { BODY_2108, BODY_2109, BODY_21099, BODY_2115, LOOK_2108, LOOK_2109, LOOK_21099, LOOK_2115 } from './samaras';
import type { EndLean, KitCarSpec, KitLook } from './spec';
import { BODY_2110, BODY_2111, BODY_2112, LOOK_2110, LOOK_2111, LOOK_2112 } from './tens';
import { BODY_2121, BODY_2131, LOOK_2121, LOOK_2131 } from './nivas';
import { BODY_GAZ24, BODY_GAZ31029, LOOK_GAZ24, LOOK_GAZ31029 } from './volgas';
import { BODY_UAZ2206, BODY_UAZ469, LOOK_UAZ2206, LOOK_UAZ469 } from './uaz';

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
      softTop: cabin.softTop && { ...cabin.softTop, from: cabin.softTop.from + ds },
    },
    wheels: { ...body.wheels, front: body.wheels.front + ds, rear: body.wheels.rear + ds },
    bonnetFront: body.bonnetFront + ds,
    bonnet: body.bonnet && { ...body.bonnet, rear: body.bonnet.rear === undefined ? undefined : body.bonnet.rear + ds },
    bootEnd: body.bootEnd === undefined ? undefined : body.bootEnd + ds,
    flap: { ...body.flap, s0: body.flap.s0 + ds, s1: body.flap.s1 + ds },
  };
}

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
    wiperBlade: 0.33,
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
    // The arches to the 2101, 2103 and 2106 drawings (refs archFront / archRear, the same
    // shell): the front 0.35 high over 0.326 wide; the rear covers the tyre's top (0.268,
    // the drawings 0.24 / 0.26 / 0.29) and runs further behind the hub than ahead
    // (0.32 / 0.36).
    frontArchRise: 1.215,
    rearArch: 1.18,
    rearArchRise: 0.93,
    archShift: [0, 0.02],
  },
  doorBottom: 0.29,
  bonnetFront: 0.17,
  bootEnd: 4.03,
  // The tail panel leans out above the bumper (owner, 2026-10-27; measurements-classics.md
  // "Nose and tail in profile"): the 2106 drawing's outline 4.055 at 0.505 → 4.105 at 0.79, the 2101's 3.983 at
  // 0.51 → 4.016 at 0.73, the 2103's 4.013 at 0.51 → 4.05 at 0.75 [D: −0.14 to −0.17 m
  // per m]; the 2101 and 2103 side photos −0.14 / −0.28 [P]. Above the rear fangs' top
  // (0.51 on the 2106, the highest), the deck row 0.785 out 0.043.
  rearLean: { base: 0.52, lean: -0.16, blend: 0.1 },
  flap: { s0: 3.2, s1: 3.31, y0: 0.66, y1: 0.76 },
};

// The 124 noses lean forward from the bumper's top (owner, 2026-10-27; measurements-
// classics.md "Nose and tail in profile"), each face its own: the bonnet's lip ahead of the face's
// foot. `base` between the front fangs' top and the grille's foot, in full to 0.067 behind
// the face (the car's own frame), so the lamps, grille and indicators rooted in it lean
// whole with it; faded out over 0.12 behind that, short of the front arch.
/** 2101 (and 2102): the face 0.132 at 0.52 → 0.094 at 0.75 [D], −0.2 low down [P]: 4.5 cm at the deck row. */
const NOSE_2101: EndLean = { base: 0.48, lean: -0.16, blend: 0.12, full: 0.17 };
/** 2103: 0.071 at 0.52 → 0.005 at 0.71, the lip 0.016–0.022 [D]; −0.37 [P]: 6.5 cm at the deck row. */
const NOSE_2103: EndLean = { base: 0.516, lean: -0.26, blend: 0.12, full: 0.195 };
/** 2106: 0.086 at 0.505 → 0.018 at 0.72–0.75 [D]; −0.25 [P]: 6.9 cm at the deck row. */
const NOSE_2106: EndLean = { base: 0.49, lean: -0.25, blend: 0.12, full: 0.215 };

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
    // The drawn bonnet rolls down 90 mm over its first 0.3 m; at this resolution that read
    // as a bent nose, so the lip is lifted to keep the bonnet near flat, as on the 124.
    { s: 0.05, sill: 0.36, crease: 0.76, belt: 0.84, deck: 0.875, wSill: 0.74, wCrease: 0.755, wBelt: 0.745 },
    { s: 0.35, sill: 0.36, crease: 0.763, belt: 0.87, deck: 0.925, wSill: 0.77, wCrease: 0.79, wBelt: 0.77 },
    { s: 0.9, sill: 0.265, crease: 0.766, belt: 0.878, deck: 0.968, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    { s: 1.0, sill: 0.268, crease: 0.766, belt: 0.88, deck: 1.0, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    { s: 2.1, sill: 0.258, crease: 0.767, belt: 0.885, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // wBelt 0.771, not 0.775: the crease drops 32 mm here [D] and at 0.775 the side's lean
    // under the belt went 16.5° → 14.1° → 15.7° (in and out, kit-surface); now 16.5° →
    // 15.7° → 15.7°. 4 mm is under the top view's reading (1.637 mm/px).
    { s: 3.33, sill: 0.262, crease: 0.735, belt: 0.874, deck: 0.935, wSill: 0.77, wCrease: 0.81, wBelt: 0.771 },
    // Boot and tail as drawn (§1.1 deck 854 at s 3900, 789–799 at 4060–4080; rear-wing
    // shoulder 872 → 760) [D]: a raised deck (0.90 / 0.87) stood the tail 5–8 cm over the
    // drawing's rounded boot. The rear wing's painted edge stays at 296–304 from the arch
    // to the bumper's end cap at s 3870 [D, re-read]; sill 0.37 here ran it up to 0.35 at
    // the cap and left a 5 cm wedge of daylight under the overhang. Widths are §1's estimate
    // 0.805 / 0.775 (the top view's outline lies on its dimension line); the crease–belt
    // lean runs 15.7° → 15.7° → 22.6°.
    { s: 3.9, sill: 0.31, crease: 0.708, belt: 0.815, deck: 0.854, wSill: 0.77, wCrease: 0.805, wBelt: 0.775 },
    // The tail upright with a small top corner (owner, 2026-10-19: "too slanted"): the drawn
    // boot rolls down only in its last 5–8 cm (828 at s 4000, 799 at 4060 [D]) to a near-
    // upright face. With the rounding spread from 3.9, the corner was one long 45° chamfer
    // over a short face; it now turns in over the last 4 cm, the face standing to 0.80.
    { s: 4.035, sill: 0.34, crease: 0.704, belt: 0.79, deck: 0.825, wSill: 0.768, wCrease: 0.802, wBelt: 0.773 },
    { s: 4.075, sill: 0.4, crease: 0.7, belt: 0.765, deck: 0.8, wSill: 0.75, wCrease: 0.785, wBelt: 0.76 },
  ],
  // The shoulder turns in to the greenhouse's foot over 3.5 cm: front view ±0.773 at 0.90,
  // ±0.731–0.736 at 0.925–0.95 [D] (a 2 cm rise put its edge at 0.905, ±0.745 there); the
  // glass's foot stays at the drawn window sill 0.955 (`glassBottom` 0.035 over the edge).
  shoulder: { inset: 0.03, rise: 0.035 },
  cabin: {
    columns: [
      // A slim painted A pillar, as on the 124; below the belt the wing reaches back to the
      // door's drawn front at 1.17. No black sail or insert (owner, 2026-10-19): the strips
      // from the pillar's line to 1.17 are the body's, so the door starts at its drawn front
      // above the belt too. As the door's frame they showed its 3 cm rubber edge up the
      // pillar and a shut slot along the belt into the black cabin (a black wedge at the
      // pillar's foot). Same paint, same lines: the pillar is not wider. The glass starts at
      // its drawn front edge, 1.225 at 1.0, 1.30 at 1.1 and 1.46 at 1.3 [D].
      { s: 1.0, top: 1.41, upper: 'body' },
      { s: 1.035, top: 1.445, upper: 'body' },
      { s: 1.06, top: 1.47, upper: 'body' },
      { s: 1.17, top: 1.495, upper: 'door1' },
      { s: 1.19, top: 1.5, upper: 'door1', glass: 'drop' },
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
    glassBottom: 0.035,
    glassTop: 0.04,
    screenBottom: 0.025,
    screenHeader: 0.045,
    wiperBlade: 0.33,
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
    // The rear arch to the 2107 drawing (refs archRear): ±0.36-0.37 at the hub's height,
    // its top 0.285 over the hub, low over the tyre.
    rearArch: 1.265,
    rearArchRise: 0.99,
  },
  doorBottom: 0.365,
  bonnetFront: 0.06,
  // The bonnet's rear edge is drawn at s 0.9 (deck 0.968), ahead of the screen's foot at
  // the cowl (1.0, 1000 high): the scuttle with its intake grille between rises to the
  // glass. Cut at the pillar row as before (`inset` = `cabin.pillar`); a bonnet run on to
  // the cowl folded in along s 0.9 (kit-surface: 9–14°).
  bonnet: { inset: 0.07, rear: 0.9 },
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
        // Proud 0.031, 7 mm ahead of the dark back's front: at 0.028 the 4 mm step, tilted
        // with the leaning face (`NOSE_2101`), fought the back's front far off (kit-zfight).
        bars: { dir: 'horizontal', count: 7, finish: 'chrome', margin: 0.015, width: 0.01, depth: 0.01, proud: 0.031 },
      },
      { kind: 'round', role: 'head', x: { centre: 0.575 }, y: ['mid', 0.04], radius: 0.095 },
      // Half depth 0.0135 at proud 0.0065: the front stands 20 mm out as drawn and the back
      // 7 mm inside the face, not in its plane.
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.535 }, to: { centre: 0.655 } }, y: { from: ['bumperTop', 0.005], to: ['bumperTop', 0.065] }, depth: 0.0135, proud: 0.0065 },
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
      // From +0.129, not the drawing's +0.127: the cells stand 2 mm clear of the rim's
      // bottom bar and reach 2 mm into its top bar.
      { kind: 'cluster', x: { from: { centre: 0.38 }, to: { centre: 0.69 } }, y: { from: ['bumperTop', 0.129], to: ['bumperTop', 0.235] }, columns: [['blinker'], ['tail', 'brake']] },
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
  waist: { y: 0.753, height: 0.025, finish: 'chrome' },
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
      // Its top tucks under the grille's frame: 2 mm behind the frame's front (proud 0.008), not in it.
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.545 }, to: { centre: 0.655 } }, y: { from: ['deck', -0.282], to: ['deck', -0.243] }, depth: 0.01, proud: 0.008 },
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
 * caps and rubber overriders; at the rear a chrome outline round the panel between the
 * lamps, with a 3×3 cell cluster each side; a waist moulding with a black insert.
 */
const LOOK_2106: KitLook = {
  label: 'VAZ-2106',
  upholstery: 0x5b3a2a,
  dash: 0x1d1c1b,
  headrests: true,
  brightwork: 'chrome',
  sill: 'chrome',
  waist: { y: 0.773, height: 0.025, finish: 'black' },
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
  // On the black sail, drawn at s 1.235–1.33 [D, measurements-classics.md §3; P]: both
  // heads seen whole through the side glass from the driver's eye (kit-mirrors 100 / 100;
  // the default 1.115 hid the right one's front half behind the sail).
  mirrorS: 1.28,
  front: {
    bumper: { kind: 'blade', finish: 'alloy', lift: 0.0475, height: 0.129, depth: 0.045, lower: { finish: 'black', share: 0.3 }, strip: null, ends: 'black', overriders: null },
    items: [
      // The same lamp units as the 2107's on the same black surround; only the grille
      // between them is the 2105's own, flush and with horizontal bars.
      { kind: 'panel', x: { centre: 0.719 }, y: { from: ['bumperTop', 0.073], to: ['bumperTop', 0.28] }, finish: 'black', proud: 0.006 },
      {
        kind: 'grille',
        x: { centre: 0.345 },
        y: { from: ['bumperTop', 0.097], to: ['bumperTop', 0.253] },
        back: true,
        bars: { dir: 'horizontal', count: 7, finish: 'black', margin: 0.012, width: 0.01, depth: 0.01, proud: 0.026 },
      },
      { kind: 'lens', role: 'head', x: { from: { centre: 0.372 }, to: { centre: 0.603 } }, y: { from: ['bumperTop', 0.097], to: ['bumperTop', 0.253] }, depth: 0.01, proud: 0.014 },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.603 }, to: { centre: 0.695 } }, y: { from: ['bumperTop', 0.097], to: ['bumperTop', 0.253] }, depth: 0.01, proud: 0.014 },
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
  // On the black sail, as the 2105's [D] (in the 2107's frame +0.012).
  mirrorS: 1.292,
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
 * Sun visors sized so that, lowered, they end at the driver's eye height (2026-10-18): the
 * Samaras' (the platform's layout as is).
 */
const VISOR_SAMARA = { half: 0.16, depth: 0.134 } as const;

export const KIT_SPECS: Readonly<Record<string, KitCarSpec>> = {
  vaz2101: { id: 'vaz2101', ...onBody(BODY_124, -0.045, 4.073), frontLean: NOSE_2101, look: LOOK_2101, cabinLayout: CABIN_2101 },
  // The estates' rear bench stands where the saloons' does, not off their longer tail.
  vaz2102: {
    id: 'vaz2102',
    ...onBody(BODY_2102, -0.045, 4.059),
    frontLean: NOSE_2101,
    look: { ...LOOK_2101, label: 'VAZ-2102', rear: REAR_2102 },
    cabinLayout: { ...CABIN_2101, bench: { from: 'rearBase', offset: -1.155 } },
  },
  vaz2103: { id: 'vaz2103', ...onBody(BODY_124, -0.02, 4.116), frontLean: NOSE_2103, look: LOOK_2103, cabinLayout: CABIN_2103 },
  vaz2104: {
    id: 'vaz2104',
    ...BODY_2104,
    look: { ...LOOK_2105, label: 'VAZ-2104', rear: REAR_2104 },
    cabinLayout: { ...CABIN_2105, bench: { from: 'rearBase', offset: -1.115 } },
  },
  vaz2105: { id: 'vaz2105', ...BODY_05, look: LOOK_2105, cabinLayout: CABIN_2105 },
  vaz2106: { id: 'vaz2106', ...BODY_124, frontLean: NOSE_2106, look: LOOK_2106, cabinLayout: CABIN_2106 },
  vaz2107: { id: 'vaz2107', ...onBody(BODY_05, 0.012, 4.145), look: LOOK_2107, cabinLayout: CABIN_2107 },
  vaz2108: { id: 'vaz2108', ...BODY_2108, look: LOOK_2108, cabinLayout: { visor: VISOR_SAMARA } },
  vaz2109: { id: 'vaz2109', ...BODY_2109, look: LOOK_2109, cabinLayout: { visor: VISOR_SAMARA } },
  vaz21099: { id: 'vaz21099', ...BODY_21099, look: LOOK_21099, cabinLayout: { visor: VISOR_SAMARA } },
  // The 2115's longer front bumper moves the 21099-frame body 45 mm back from its tip.
  vaz2115: { id: 'vaz2115', ...onBody(BODY_2115, 0.045, 4.33), look: LOOK_2115, cabinLayout: { visor: VISOR_SAMARA } },
  vaz2110: { id: 'vaz2110', ...BODY_2110, look: LOOK_2110, cabinLayout: CABIN_2110 },
  vaz2112: { id: 'vaz2112', ...BODY_2112, look: LOOK_2112, cabinLayout: CABIN_2110 },
  vaz2111: { id: 'vaz2111', ...BODY_2111, look: LOOK_2111, cabinLayout: CABIN_2110 },
  vaz2121: { id: 'vaz2121', ...BODY_2121, look: LOOK_2121 },
  vaz2131: { id: 'vaz2131', ...BODY_2131, look: LOOK_2131, cabinLayout: CABIN_2131 },
  vaz1111: { id: 'vaz1111', ...BODY_1111, look: LOOK_1111, cabinLayout: CABIN_1111 },
  gaz24: { id: 'gaz24', ...BODY_GAZ24, look: LOOK_GAZ24, cabinLayout: CABIN_GAZ24 },
  gaz31029: { id: 'gaz31029', ...BODY_GAZ31029, look: LOOK_GAZ31029, cabinLayout: CABIN_GAZ31029 },
  azlk2141: { id: 'azlk2141', ...BODY_2141, look: LOOK_2141, cabinLayout: CABIN_2141 },
  uaz469: { id: 'uaz469', ...BODY_UAZ469, look: LOOK_UAZ469, cabinLayout: CABIN_UAZ469 },
  uaz2206: { id: 'uaz2206', ...BODY_UAZ2206, look: LOOK_UAZ2206, cabinLayout: CABIN_UAZ2206 },
  nexia: { id: 'nexia', ...BODY_NEXIA, look: LOOK_NEXIA, cabinLayout: CABIN_NEXIA },
  espero: { id: 'espero', ...BODY_ESPERO, look: LOOK_ESPERO, cabinLayout: CABIN_ESPERO },
  astraf: { id: 'astraf', ...BODY_ASTRA_F, look: LOOK_ASTRA_F, cabinLayout: CABIN_ASTRA_F },
  vectraa: { id: 'vectraa', ...BODY_VECTRA_A, look: LOOK_VECTRA_A, cabinLayout: CABIN_VECTRA_A },
  w124: { id: 'w124', ...BODY_W124, look: LOOK_W124, cabinLayout: CABIN_W124 },
  e34: { id: 'e34', ...BODY_E34, look: LOOK_E34, cabinLayout: CABIN_E34 },
};
