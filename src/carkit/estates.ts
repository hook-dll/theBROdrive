/**
 * VAZ-2102 and VAZ-2104, the estates: numbers and sources in measurements-estates.md.
 */

import type { FaceLook } from './spec';
import type { KitBody } from './specs';

export const BODY_2102: KitBody = {
  length: 4.104, // 4059 + 0.045 [D dimension; drawn tip 4.103–4.110]
  platform: 'classic',
  stations: [
    { s: 0.148, sill: 0.33, crease: 0.6, belt: 0.73, deck: 0.765, wSill: 0.745, wCrease: 0.775, wBelt: 0.765 }, // BODY_124
    { s: 0.35, sill: 0.28, crease: 0.62, belt: 0.775, deck: 0.81, wSill: 0.77, wCrease: 0.8, wBelt: 0.79 }, // BODY_124
    { s: 1.2, sill: 0.262, crease: 0.63, belt: 0.856, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 }, // BODY_124
    { s: 2.15, sill: 0.255, crease: 0.63, belt: 0.862, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 }, // BODY_124
    // C pillar foot: belt −8 [D Δ]; sill [D]; crease, widths, deck (unused) as BODY_124 [E]
    { s: 3.0, sill: 0.26, crease: 0.63, belt: 0.854, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    // behind the rear arch: belt −24 [D Δ]; rear body bottom 0.27 [D]; crease [E]
    { s: 3.45, sill: 0.27, crease: 0.625, belt: 0.838, deck: 0.89, wSill: 0.775, wCrease: 0.8055, wBelt: 0.795 },
    // D-pillar foot: belt −32 [D Δ]; full width to 3.82 in plan, a touch in [D top]
    { s: 3.8, sill: 0.27, crease: 0.62, belt: 0.83, deck: 0.89, wSill: 0.77, wCrease: 0.8, wBelt: 0.79 },
    // rearBase: deck = tailgate bottom on the centre line 0.49 [P, 32–37 mm over the blade top];
    // corner rounding onto a ±0.75 face [D top]; sill [D/P]; crease [E]
    { s: 4.005, sill: 0.285, crease: 0.61, belt: 0.825, deck: 0.49, wSill: 0.735, wCrease: 0.765, wBelt: 0.755, flat: 1 },
    // tail face 4.02 [D side 4.02–4.03]; valance bottom 0.29 [P]; face half 0.745–0.75 [D top]
    { s: 4.02, sill: 0.29, crease: 0.61, belt: 0.82, deck: 0.49, wSill: 0.725, wCrease: 0.755, wBelt: 0.745, flat: 1 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 }, // BODY_124
  cabin: {
    columns: [
      { s: 1.2, top: 1.445, upper: 'body' }, // BODY_124 from here to 2.19
      { s: 1.235, top: 1.475, upper: 'door1' },
      { s: 1.26, top: 1.5, upper: 'door1', glass: 'vent' },
      { s: 1.55, top: 1.6, upper: 'door1', glass: 'drop' },
      { s: 2.095, top: 2.095, upper: 'door1' },
      { s: 2.125, top: 2.125, upper: 'body', lower: 'door1' },
      { s: 2.145, top: 2.145, upper: 'body', lower: 'door2' },
      { s: 2.165, top: 2.165, upper: 'door2' },
      { s: 2.19, top: 2.19, upper: 'door2', glass: 'drop' },
      // vertical channel x 802–806 (+~0.03), photo 2.700 [D][P]
      { s: 2.7, top: 2.7, upper: 'door2' },
      { s: 2.725, top: 2.725, upper: 'door2', glass: 'fixed' },
      // fixed pane's rear edge / door frame, raked [D +0.037; P 2.982 / 2.863]
      { s: 2.987, top: 2.849, upper: 'door2' },
      // door shut line, vertical below the belt at 3.017 [P 3.020, BODY_124 3.017]; top [D +0.037]
      { s: 3.017, top: 2.878, upper: 'body' },
      // quarter glass front edge [D +0.037; P 3.091 / ~2.94]
      { s: 3.083, top: 2.941, upper: 'body', glass: 'fixed' },
      // quarter glass rear edge → D pillar [D 3.672 / 3.413, P 3.732 / 3.471: mean]
      { s: 3.7, top: 3.44, upper: 'body' },
      // tailgate base (rearBase) / roof's rear end at the rail [D 3.519, P 3.527]
      { s: 4.005, top: 3.52 },
    ],
    rail: 1.275, // BODY_124
    railHalf: 0.62, // BODY_124
    crown: 0.04, // BODY_124
    railInset: 0.05, // BODY_124
    railRise: 0.022, // BODY_124
    glassBottom: 0.012, // BODY_124
    glassTop: 0.038, // BODY_124
    screenBottom: 0.025, // BODY_124
    screenHeader: 0.045, // BODY_124
    wiperBlade: 0.33, // BODY_124
    rearBottom: 0.025, // unused with a knee
    // tailgate glass top 1.233 raw (rear view) → 1.218; centre top rail + crown 1.315 [D]
    rearHeader: 0.1,
    // fold at the belt strip, glass base on the outline 3.833–3.84 / 0.845–0.85 raw [D];
    // the glass ends ~0.05 higher [P]; the lower panel's top stands 85 mm further back [D]
    // Kept upright over the sill so the tailgate lies flush with the lamp corners beside
    // it (the drawn panel leans ~12° under a ledge; flush corners read truer at this scale).
    rearKnee: { s: 4.0, y: 0.86 },
    pillar: 0.07, // BODY_124
  },
  wheels: { front: 0.648, rear: 3.072, radius: 0.288, width: 0.165, frontHalfTrack: 0.6825, rearHalfTrack: 0.6605, arch: 1.13 }, // BODY_124; tracks 1365/1321 [D]
  doorBottom: 0.29, // BODY_124
  bonnetFront: 0.17, // BODY_124
  // no bootEnd: the rear ring is a tailgate hinged at the roof
  // REAL FLAP IS ON THE LEFT: s 3.517–3.695, y 0.659–0.771 raw → 0.67–0.785 [D]
  flap: { s0: 3.517, s1: 3.695, y0: 0.67, y1: 0.785, side: 'left' },
  // The back leans as one plane over the bumper, lamps and all [P: rear 3/4 photos].
  rearLean: { base: 0.46, lean: 0.25, blend: 0.3 },
};

/** VAZ-2102's back: vertical tail lamps on the corners, the 2101's rear bumper. */
export const REAR_2102: FaceLook = {
    // the 2101's rear bumper [D][P]: blade 0.383–0.457 → centre 0.42 = tail sill 0.29 + 0.035 + 0.095;
    // overriders at x ±0.51 (half 0.78 − 0.27), 46 × 191, centre 20 mm below the blade's [P]
    bumper: {
      kind: 'blade',
      finish: 'chrome',
      lift: 0.095,
      height: 0.074,
      depth: 0.038, // as LOOK_2101 [E]
      strip: null,
      overriders: { inset: 0.27, half: [0.023, 0.095], drop: 0.02, finish: 'chrome' },
    },
    items: [
      // chrome rim round each vertical lamp: x ±(0.610..0.707), blade top +0.118..+0.362 [P]
      { kind: 'frame', x: { from: { centre: 0.61 }, to: { centre: 0.707 } }, y: { from: ['bumperTop', 0.118], to: ['bumperTop', 0.362] }, width: 0.008, finish: 'chrome', proud: 0.012 },
      // lens ±(0.618..0.699): amber / pale / red, red = tail + stop [P]; middle cell's role [INFERENCE]
      { kind: 'cluster', x: { from: { centre: 0.618 }, to: { centre: 0.699 } }, y: { from: ['bumperTop', 0.126], to: ['bumperTop', 0.354] }, columns: [['blinker', 'reverse', 'tail', 'brake']] },
    ],
};

export const BODY_2104: KitBody = {
  length: 4.12, // [D 4.124; passport 4.115]
  platform: 'classic',
  stations: [
    { s: 0.05, sill: 0.36, crease: 0.76, belt: 0.84, deck: 0.875, wSill: 0.74, wCrease: 0.755, wBelt: 0.745 }, // BODY_05
    { s: 0.35, sill: 0.36, crease: 0.763, belt: 0.87, deck: 0.925, wSill: 0.77, wCrease: 0.79, wBelt: 0.77 }, // BODY_05
    { s: 0.9, sill: 0.265, crease: 0.766, belt: 0.878, deck: 0.968, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 }, // BODY_05
    { s: 1.0, sill: 0.268, crease: 0.766, belt: 0.88, deck: 1.0, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 }, // BODY_05
    { s: 2.1, sill: 0.258, crease: 0.767, belt: 0.885, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 }, // BODY_05
    // C pillar foot: crease [D]; belt level [P]; deck unused
    { s: 2.975, sill: 0.26, crease: 0.765, belt: 0.884, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // over the rear arch's back: crease 0.751 [D]
    { s: 3.38, sill: 0.262, crease: 0.75, belt: 0.882, deck: 0.92, wSill: 0.77, wCrease: 0.81, wBelt: 0.775 },
    // behind the arch: body bottom 0.34 [D]; crease 0.730 [D]; plan width ~99 % [D top];
    // wBelt 0.765 (1 cm in): the side's lean over the crease even into the lower tail corner
    // (14.9° → 15.4° → 15.9°; at 0.775 it went in and out, 11.7° here, kit-surface).
    { s: 3.8, sill: 0.34, crease: 0.73, belt: 0.875, deck: 0.92, wSill: 0.77, wCrease: 0.805, wBelt: 0.765 },
    // rearBase: deck = tailgate bottom 0.52 on the centre line [P][D]; crease 0.705 [D];
    // tail sill hidden by the bumper [E]; widths [D top, corners E as 2105]. The corners'
    // top (belt + the shoulder's rise) 0.845, just over the lamps (0.842): the drawn side
    // outline runs down the glass to the knee (3.80, 0.85) with nothing behind it there
    // [D] (§2.1); at belt 0.87 the corners stood 0.06 over the knee, 0.07 behind it.
    { s: 3.995, sill: 0.33, crease: 0.705, belt: 0.81, deck: 0.52, wSill: 0.76, wCrease: 0.795, wBelt: 0.765, flat: 1 },
    // tail face [D 3.993–3.997 at the lower panel]
    { s: 4.005, sill: 0.33, crease: 0.7, belt: 0.81, deck: 0.52, wSill: 0.755, wCrease: 0.79, wBelt: 0.76, flat: 1 },
  ],
  shoulder: { inset: 0.03, rise: 0.035 }, // BODY_05
  cabin: {
    columns: [
      { s: 1.0, top: 1.41, upper: 'body' }, // BODY_05 from here to 2.975
      { s: 1.035, top: 1.445, upper: 'door1', lower: 'body' },
      { s: 1.06, top: 1.47, upper: 'door1', finish: 'black', lower: 'body' },
      { s: 1.17, top: 1.495, upper: 'door1', finish: 'black' },
      { s: 1.19, top: 1.5, upper: 'door1', glass: 'drop' },
      { s: 2.055, top: 2.062, upper: 'door1' },
      { s: 2.075, top: 2.08, upper: 'body', lower: 'door1' },
      { s: 2.09, top: 2.095, upper: 'body', lower: 'door2' },
      { s: 2.11, top: 2.112, upper: 'door2' },
      { s: 2.127, top: 2.127, upper: 'door2', glass: 'drop' },
      { s: 2.68, top: 2.68, upper: 'door2' },
      { s: 2.7, top: 2.7, upper: 'door2', glass: 'fixed' },
      { s: 2.955, top: 2.71, upper: 'door2' }, // [D 2.933–2.959 / 2.729–2.755]
      { s: 2.975, top: 2.73, upper: 'body' },
      // quarter glass front edge (L4) [D]
      { s: 3.075, top: 2.835, upper: 'body', glass: 'fixed' },
      // quarter glass rear edge → D pillar [D 3.604 / 3.317, P 3.640]
      { s: 3.63, top: 3.33, upper: 'body' },
      // tailgate base (rearBase) / roof's rear end at the rail [D 3.40, P 3.407]
      { s: 3.995, top: 3.4 },
    ],
    rail: 1.375, // BODY_05
    railHalf: 0.62, // BODY_05
    crown: 0.048, // BODY_05
    railInset: 0.05, // BODY_05
    railRise: 0.025, // BODY_05
    glassBottom: 0.035, // BODY_05
    glassTop: 0.04, // BODY_05
    screenBottom: 0.025, // BODY_05
    screenHeader: 0.045, // BODY_05
    wiperBlade: 0.33, // BODY_05
    rearBottom: 0.025, // unused with a knee
    // tailgate glass top 1.30–1.33 (rear view) against rail + crown 1.423 [D]
    rearHeader: 0.11,
    // The fold at the lip under the glass, drawn at (3.80–3.835, 0.84–0.86) [D] (§2.1): the
    // knee at 3.912 before the lean below (0.31 × 0.36 = 0.112 forward at 0.85); the glass
    // itself ends at 0.89–0.93 [D rear][P]. The lower panel and the lamp corners stand
    // back from it, as the drawn lip does (3.91 at 0.783).
    rearKnee: { s: 3.912, y: 0.85 },
    pillar: 0.07, // BODY_05
  },
  wheels: { front: 0.635, rear: 3.048, radius: 0.288, width: 0.165, frontHalfTrack: 0.6825, rearHalfTrack: 0.6605, arch: 1.15 }, // BODY_05
  doorBottom: 0.365, // BODY_05
  bonnetFront: 0.06, // BODY_05 (2105 face)
  bonnet: { inset: 0.07, rear: 0.9 }, // BODY_05: the drawn rear edge, the scuttle behind it
  // no bootEnd: the rear ring is a tailgate hinged at the roof
  // REAL FLAP IS ON THE LEFT [P p04_side_l]
  flap: { s0: 3.51, s1: 3.69, y0: 0.745, y1: 0.85, side: 'left' },
  // The back leans as one plane over the bumper, lamps and all [P: rear 3/4 photos]: 0.31
  // m per m, the drawn lamp side's line (3.91 / 0.783 → 3.993 / 0.513, ~17°) [D] (§2.1),
  // faded in from the roof's end (3.40) so the glass is one straight line from 3.42 at
  // 1.364 to the knee (3.80, 0.85) [D] (a 0.3 blend left its top 5 cm back).
  rearLean: { base: 0.49, lean: 0.31, blend: 0.6 },
};

/** VAZ-2104's back: vertical corner lamps, the 21043's plastic rear bumper. */
export const REAR_2104: FaceLook = {
    // 0.35–0.485 [D][P] → centre 0.4175 = tail sill 0.33 + 0.035 + 0.0525; grey face with a
    // 48 mm black band (the generator's strip is 24 mm) and black end caps [P]
    bumper: { kind: 'blade', finish: 'alloy', lift: 0.0525, height: 0.135, depth: 0.05, strip: 'rubber', ends: 'black', overriders: null },
    items: [
      // lens ±(0.507..0.700), bumper top +0.088..+0.357 [P]; outer: stop / amber / white, inner: stop / red / red
      // [P colours, roles INFERENCE]; equal thirds against 27/43/30 %
      {
        kind: 'cluster',
        x: { from: { centre: 0.507 }, to: { centre: 0.7 } },
        y: { from: ['bumperTop', 0.088], to: ['bumperTop', 0.357] },
        columns: [['brake', 'blinker', 'reverse'], ['brake', 'tail', 'tail']],
      },
    ],
};

