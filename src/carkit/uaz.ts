/**
 * The UAZ family: the UAZ-469 under its canvas top and the UAZ-2206 «буханка» bus.
 * Numbers and sources in measurements-uaz.md (`## UAZ-469`, `## UAZ-452`).
 *
 * Measured on the factory four-view `uaz2.jpg` (the UAZ-3151, the 469's 1985 renaming:
 * the same body, a hard top; side view 4.359 mm/px from the drawn 2380 wheelbase, hubs x
 * 192 / 738, ground y 475 and the front tip x 36 on the 2000 x 1400 sheet's side-view crop
 * at (780, 60); the front view 4.33 mm/px from its 1785 width) and Wikimedia Commons
 * photos of 469s for what the drawing cannot say: the canvas top over the doors and the
 * back, the doors' framed glass, the face, the tail and its door, the dash.
 * (`uaz469.jpg` is not a 469: its 2000 wheelbase and 3730 length are a short two-door
 * derivative's.)
 *
 * The car: a box body on a frame with flat panels, a bonnet whose rear edge stops ahead of
 * the scuttle, an upright face with round head lamps over two mesh grilles and a row of
 * slots, steel channel bumpers; four doors with framed fixed glass (sliding panes on the
 * car), the rear door's edge raked forward round the arch; a canvas top over the doors and
 * down the sides and back behind them, a window in the back; a rear door in the tail,
 * hinged on its right, carrying the spare wheel.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/** The canvas: a dark khaki tarpaulin [P: the Commons photos range from olive to black]. */
const CANVAS = 0x55573f;

/**
 * UAZ-469: overhangs 680 / ~1100 (tail; the spare stands 0.28 further out) over a 2380
 * wheelbase. An upright face (s 0.148) from the bumper (0.545-0.64) to the bonnet's lip
 * (1.15), the bonnet over the wings' top (its side skirt's foot 1.04) to 1.064, the scuttle
 * to the windscreen's foot (1.28, 1.27); the screen raked 0.5 m per m to the canvas. Belt
 * (the doors' top) 1.2, door bottom 0.44; the front door 1.347-2.115 at the belt, its rear
 * edge raked forward to 1.74 at the bottom; the rear door 2.13-2.894, its rear edge raked
 * forward round the arch to 2.50; the body's top behind it level to the tail (3.779).
 */
export const BODY_UAZ469: KitBody = {
  // To the rear bumper's back; the spare on the rear door reaches 4.06 [D: drawn tip x 36 to
  // the spare's back x 971 at 4.359 mm/px; 4025 F the UAZ manual, over the spare].
  length: 3.87,
  platform: 'niva',
  stations: [
    // The face [D side x 70]: flat across to ±0.80 [D front x 62-408], the wings rounding
    // out to ±0.89 behind it [D top]; its foot behind the bumper [E 0.58]; the wings' top
    // (the bonnet skirt's foot) 1.037 [D side y 237], the bonnet's lip 1.15-1.18 [D front y
    // 210, side y 205]. The bonnet's top is one flat panel (`flat`) from its lip up to its
    // rear edge, level across to the pillar line and rolling down to its skirts there [P]:
    // the deck at 0.26 on the straight line from 1.15 to 1.25.
    { s: 0.148, sill: 0.58, crease: 0.85, belt: 1.04, deck: 1.15, wSill: 0.8, wCrease: 0.83, wBelt: 0.8, flat: 1 },
    // The sill tucked to the cabin's ±0.86 (below) from the wing's front corner on: tucking
    // it between the bonnet's rear edge and the cowl turned the sill's plan in and out by
    // 6.6° (kit-surface); the side's lean under the crease now grows evenly from the nose
    // (7.3° → 6.1° → 4.6° → 4.3°).
    { s: 0.26, sill: 0.55, crease: 0.86, belt: 1.04, deck: 1.1622, wSill: 0.86, wCrease: 0.893, wBelt: 0.885, flat: 1 },
    // The bonnet's rear edge [D side x 280], its centre 1.25 [D side y 188].
    { s: 1.064, sill: 0.45, crease: 0.86, belt: 1.04, deck: 1.25, wSill: 0.86, wCrease: 0.893, wBelt: 0.885, flat: 1 },
    // Cowl: the windscreen's foot (1.28, 1.27) [D side x 330, y 184]; the body's side 1785
    // over all [F; D front 1.786]; the doors' top 1.2 [D side y 200] = belt + shoulder. The
    // sides tuck in 3 cm to the sill [E: D front, the doors' foot behind the tyres]: a flank
    // flat to the sill put the fuel flap's inside in the filler cup's back plane. The
    // scuttle level across as the bonnet ahead of it, the flat screen's foot straight [P].
    { s: 1.28, sill: 0.42, crease: 0.86, belt: 1.11, deck: 1.27, wSill: 0.86, wCrease: 0.893, wBelt: 0.885, flat: 1 },
    { s: 2.9, sill: 0.42, crease: 0.86, belt: 1.11, deck: 1.2, wSill: 0.86, wCrease: 0.893, wBelt: 0.885 },
    // Behind the rear arch the body's bottom 0.56 [D side y 347].
    { s: 3.6, sill: 0.56, crease: 0.86, belt: 1.11, deck: 1.2, wSill: 0.885, wCrease: 0.893, wBelt: 0.885 },
    // rearBase: the canvas back's foot on the body's top, level [P], 8 cm before the tail;
    // the rear door's top runs back to the tail between ±0.32.
    { s: 3.7, sill: 0.56, crease: 0.86, belt: 1.11, deck: 1.2, notch: 0.32, wSill: 0.88, wCrease: 0.888, wBelt: 0.88 },
    // Tail face [D side x 903]: the rear door between ±0.32 from the body's top down to
    // 0.70, over the bumper [P "UAZ-469 FI H86018 07"; E width].
    { s: 3.779, sill: 0.56, crease: 0.86, belt: 1.11, deck: 0.7, notch: 0.32, wSill: 0.87, wCrease: 0.875, wBelt: 0.87 },
  ],
  // The bonnet's skirt and the body's top rim: the deck's edge 0.09 over the side's top,
  // 2 cm in [D side, front].
  shoulder: { inset: 0.02, rise: 0.09 },
  cabin: {
    columns: [
      // The windscreen's frame from its foot (1.28) up its 0.5 m/m rake to the rail [D side
      // line (330, 215) → (397, 50)].
      { s: 1.28, top: 1.49, upper: 'body' },
      // The front door's frame runs up the pillar; below the belt the scuttle's side
      // reaches back to the shut line at 1.36 [D side x 345, the hinges: 1.347].
      { s: 1.335, top: 1.545, upper: 'door1', lower: 'body' },
      { s: 1.36, top: 1.575, upper: 'door1', glass: 'fixed' },
      // Glass's rear edge 2.085, the frame to the B pillar [D side x 515 / 520].
      { s: 2.085, top: 2.085, upper: 'door1' },
      // The front door's rear edge rakes forward from under the belt to 1.74 at its
      // bottom [D side line (520, 205) → (435, 375); P "UAZ-469 FI H86018 05"]; the body's
      // triangle behind it carries the filler flap.
      { s: 2.115, top: 2.115, upper: 'body', foot: { y: 1.08, s: 1.74 } },
      // The rear door from 2.13, upright [D side x 525, the hinges].
      { s: 2.13, top: 2.13, upper: 'body', lower: 'door2' },
      { s: 2.15, top: 2.15, upper: 'door2' },
      { s: 2.175, top: 2.175, upper: 'door2', glass: 'fixed' },
      // Glass's rear edge raked (x 670 at the foot, 650 at the top) [D side].
      { s: 2.76, top: 2.68, upper: 'door2' },
      // The rear door's rear edge: raked from the belt (x 700) forward round the arch to
      // 2.50 at the bottom [D side line (700, 195) → (610, 375)]. Behind it the canvas down
      // to the body's top, no window [P "UAZ-469 (side)", "UAZ 469.JPG"].
      { s: 2.894, top: 2.76, upper: 'body', foot: { y: 1.08, s: 2.5 } },
      // rearBase; the canvas back raked 7 cm forward to the roof [P].
      { s: 3.7, top: 3.63 },
    ],
    // The doors' frames' top [D side y 105: 1.61; P: the canvas comes down onto them].
    rail: 1.68,
    railHalf: 0.8, // the frames ±0.77, the canvas over them ±0.80 [D front]
    // The canvas only clears the door frames by a small amount: on the real soft top the
    // visible rise is concentrated at the B-pillar, not a tall hard-top-like crown.
    // Keep the roof edge close to the frame and let the shallow crown finish the cover.
    // [P Wikimedia Commons UAZ-469 canvas-top side views]
    // The canvas' sides rise 0.06 over the frames to its roof's edge and crown to 1.78.
    // The top is flat across, not arched: the rolled corners remain in the high-power
    // crown profile.
    // The screen header follows the shallow canvas edge rather than a high hard-top ridge.
    // Door and rear canvas panels retain their measured longitudinal stations.
    crown: 0.04,
    crownPower: 20,
    railInset: 0.05,
    railRise: 0.06,
    railBend: [0.3, 0.75],
    glassBottom: 0.03, // the frames' glass from 1.23 [D side]
    glassTop: 0.045,
    screenBottom: 0.04, // [E as the Niva]
    screenHeader: 0.05,
    // The old 469's top-mounted wipers: spindles in the header, 280 mm blades (СЛ236Е-5205100,
    // СЛ236Е-5205900), parked along the header and out of the driver's view.
    wiperBlade: 0.28,
    wiperMount: 'top',
    // The canvas back's window: its middle from 1.5 to the roof less 0.12 [P "UAZ 469
    // (1970) … pic3"].
    rearBottom: 0.3,
    rearHeader: 0.12,
    pillar: 0.07, // the windscreen frame's sides [D front]
    softTop: { colour: CANVAS, from: 2.85 },
  },
  wheels: {
    front: 0.68, // hub x 192 [D]; 680 [F manual]
    rear: 3.06, // hub x 738 [D]; wheelbase 2380 [F]
    radius: 0.37, // drawn 0.366 (loaded); 215/90-15C rolling 0.372 [F manual]
    width: 0.215, // [F]
    frontHalfTrack: 0.7225, // 1445 [F manual; D front]
    rearHalfTrack: 0.7225,
    // Square-cut arches round the tyre: top 0.50 over the hub front and rear [D side y 270
    // / 280]. One circle: 1.35 R.
    arch: 1.35,
  },
  doorBottom: 0.44, // [D side y 374]
  bonnetFront: 0.148,
  // The bonnet over the whole top to its skirts, ending at 1.064 [D side x 280], the
  // scuttle with its vent between it and the screen [P].
  bonnet: { inset: 0.01, rear: 1.064 },
  // Oval flap on the body's triangle between the doors, low [P "UAZ-469 FI H86018 05",
  // "UAZ-469 (side)"]; both sides on the car (two tanks), the left one here.
  flap: { s0: 1.95, s1: 2.08, y0: 0.56, y1: 0.76, side: 'left' },
  // The rear door hinged on its right edge, its lock (a hasp) on the left [P "… 07"].
  tailgateHinge: 'right',
  // The silencer behind the rear axle and the tail pipe on hangers 3 cm under the floor
  // (0.42-0.56 here, 0.2+ over the 0.22 clearance) [E].
  exhaustTuck: 0.03,
};

/**
 * UAZ-469 (uaz2.jpg's front and rear views; Commons photos "UAZ-469 (front)", "UAZ 469B",
 * "Uaz-469-1", "UAZ-469 FI H86018 05/06/07"): round head lamps at the face's corners, two
 * mesh grilles one over the other between them and a row of three slots under them, round
 * amber indicators under the lamps; black steel channel bumpers; at the tail vertical
 * lamps (amber over red) at the corners, a reversing lamp under each, the spare in its
 * cover on the rear door.
 */
export const LOOK_UAZ469: KitLook = {
  label: 'UAZ-469',
  upholstery: 0x3d2f27, // brown vinyl [P "UAZ-early-interior-floor-pedals"]
  dash: 0x4c5233, // painted steel, olive [P]: now only its knobs' shade
  dashPainted: true, // in the body's colour (owner, 2026-10-18)
  headrests: false, // [P]
  brightwork: 'chrome', // handles [P "UAZ-469 (side)"]
  // The door mirrors on upright stalks from a bracket at the door's front edge under the
  // belt, the head behind the stalk beside the glass's front lower corner: drawn at s
  // 1.39-1.49, y 1.24-1.45 (centre 1.345) [D side x 355-378, y 143-190]; photos 1.34-1.39
  // [P "UAZ 469.JPG", "UAZ-469 (side)"]. Centre 1.36 here, 0.17 over the short arm's 1.19.
  mirrorStalk: 0.17,
  sill: null,
  waist: null,
  // The round amber lamp on the scuttle's side [D side (295, 210); P], here on the wing
  // just under it [E].
  repeater: { s0: 1.1, s1: 1.16, y0: 0.98, y1: 1.02 },
  front: {
    // 0.545-0.64 [D side, front: dimensions 545 / 635]: centre 0.5925 = face sill 0.58 +
    // 0.0125; full width [D front], 0.08 deep [E]; black [P].
    bumper: { kind: 'blade', finish: 'black', lift: 0.0125, height: 0.095, depth: 0.08, strip: null, overriders: null },
    items: [
      // Mesh grilles ±0.33, 0.974-1.08 and ±0.35, 0.82-0.93 [D front]: a dark back with
      // fine bars [P].
      {
        kind: 'grille',
        x: { centre: 0.33 },
        y: { from: ['bumperTop', 0.334], to: ['bumperTop', 0.44] },
        back: true,
        bars: { dir: 'horizontal', count: 5, finish: 'black', margin: 0.01, width: 0.005, depth: 0.006, proud: 0.028 },
      },
      {
        kind: 'grille',
        x: { centre: 0.35 },
        y: { from: ['bumperTop', 0.18], to: ['bumperTop', 0.29] },
        back: true,
        bars: { dir: 'horizontal', count: 5, finish: 'black', margin: 0.01, width: 0.005, depth: 0.006, proud: 0.028 },
      },
      // Three slots ±0.26, 0.76-0.80 [D front; P].
      {
        kind: 'grille',
        x: { centre: 0.26 },
        y: { from: ['bumperTop', 0.12], to: ['bumperTop', 0.16] },
        back: true,
        bars: { dir: 'vertical', count: 2, finish: 'paint', margin: 0.17, width: 0.03, depth: 0.012, proud: 0.03 },
      },
      // Head lamps ±0.595 at 0.974, rims 0.1 [D front]: 7-inch lenses.
      { kind: 'round', role: 'head', x: { centre: 0.595 }, y: ['bumperTop', 0.334], radius: 0.085 },
      // Amber indicators under them, ±0.595 at 0.78 [D front; P].
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.555 }, to: { centre: 0.635 } }, y: { from: ['bumperTop', 0.1], to: ['bumperTop', 0.18] }, depth: 0.012, proud: 0.02 },
    ],
  },
  rear: {
    // The rear crossmember 0.565-0.685 [D rear y 330-360]: centre 0.625 = tail sill 0.56 +
    // 0.065; black [P].
    bumper: { kind: 'blade', finish: 'black', lift: 0.065, height: 0.12, depth: 0.08, strip: null, overriders: null },
    items: [
      // Lamps at the corners ±0.62-0.76, 0.805-1.015: amber over red over red [P "… 07";
      // D rear].
      {
        kind: 'cluster',
        x: { from: { centre: 0.62 }, to: { centre: 0.76 } },
        y: { from: ['bumperTop', 0.12], to: ['bumperTop', 0.33] },
        columns: [['blinker', 'tail', 'brake']],
      },
      // A small white lamp under each [E: on the car a round red reflector there].
      { kind: 'lens', role: 'reverse', x: { from: { centre: 0.64 }, to: { centre: 0.72 } }, y: { from: ['bumperTop', 0.04], to: ['bumperTop', 0.09] }, depth: 0.01, proud: 0.012 },
    ],
    // The spare in its black cover on the rear door, centred, its hub 1.10 high, 7 cm off
    // the door [P "… 06", "… 07"; D rear: the 3151's spare 1.10 high].
    lid: [{ kind: 'wheel', x: 0, y: ['deck', -0.1], radius: 0.37, width: 0.21, standoff: 0.07, finish: 'black' }],
  },
};

/**
 * UAZ-2206: the windowed UAZ-452 bus, forward control. Measured on the factory four-view
 * `uaz452_dwg-2206-manual.png` (РЭ 05808600.059-96; side view 4.656 mm/px from the drawn
 * 2300 wheelbase, hubs x 356 / 850, front tip x 142; heights at 4.77 mm/px, ground y 469:
 * the sheet is drawn 2.4 % tall) and, aft of the rear axle where the drawing is 100 mm
 * short, the near-orthographic right side "UAZ-452 Medical (EMS) 2006 G1.jpg" (2.653
 * mm/px from the wheelbase). measurements-uaz.md §3, §5.
 *
 * A rounded nose ahead of the screen over the front axle (no bonnet: the engine is under a
 * cover inside), the belt 1.32 the whole length, glass all round 1.40-1.835, the gutter
 * 1.88 and a round roof to 2.08; the front doors over the front wheels, one side door on
 * the right only (1.874-2.805), the saloon's windows to the rear corner, and two rear
 * doors split on the centre line, each hinged at its outer edge, down to 0.70 between the
 * lamps.
 */
export const BODY_UAZ2206: KitBody = {
  // Bumper to bumper [D 993 + 2300 + 1087]; the photo's rear bumper stands 26 mm shorter.
  length: 4.38,
  platform: 'van',
  stations: [
    // The face [D side 0.04-0.06 from 0.81 to 1.16]; round in plan to the full width by
    // ~0.25 [D plan; E the station widths].
    { s: 0.05, sill: 0.57, crease: 0.95, belt: 1.16, deck: 1.22, wSill: 0.7, wCrease: 0.76, wBelt: 0.7 },
    // The nose's top curving back: (0.154, 1.331), (0.223, 1.369) [D side].
    { s: 0.15, sill: 0.56, crease: 1.0, belt: 1.3, deck: 1.34, wSill: 0.86, wCrease: 0.92, wBelt: 0.87 },
    // wBelt 0.922 (was 0.93): the face's lean over the crease eases from the nose to the
    // flank, 9.5° → 7.4° → 7.2°; at 0.93 it went 9.5° → 5.7° → 7.2°, in and out (kit-surface).
    // The belt's half width here is not read off the drawing [E].
    { s: 0.3, sill: 0.55, crease: 1.05, belt: 1.32, deck: 1.38, wSill: 0.92, wCrease: 0.957, wBelt: 0.922 },
    // Ahead of the front arch: the front door's bottom on the 0.55 band, its step 0.588 [D].
    { s: 0.62, sill: 0.55, crease: 1.05, belt: 1.32, deck: 1.38, wSill: 0.92, wCrease: 0.964, wBelt: 0.93 },
    // Behind the arch, the body's side down to 0.42 [P]; widest ±0.964 [D front].
    { s: 1.36, sill: 0.42, crease: 1.05, belt: 1.32, deck: 1.38, wSill: 0.905, wCrease: 0.964, wBelt: 0.93 },
    { s: 3.62, sill: 0.42, crease: 1.05, belt: 1.32, deck: 1.38, wSill: 0.905, wCrease: 0.957, wBelt: 0.93 },
    // The tail's rounding in plan starts [D plan]; the sill up behind the arch [P 0.48-0.52].
    { s: 4.04, sill: 0.5, crease: 1.05, belt: 1.32, deck: 1.38, wSill: 0.9, wCrease: 0.955, wBelt: 0.93 },
    // rearBase: the rear doors' top edge at the deck's edge.
    { s: 4.24, sill: 0.52, crease: 1.05, belt: 1.32, deck: 1.36, wSill: 0.86, wCrease: 0.92, wBelt: 0.9 },
    // The tail face, 0.971 behind the rear hub [P]: the rear doors come down to 0.70
    // between the lamp corners, ±0.72 [D rear].
    { s: 4.264, sill: 0.52, crease: 1.05, belt: 1.32, deck: 0.7, notch: 0.72, wSill: 0.84, wCrease: 0.9, wBelt: 0.88 },
  ],
  // The deck's edge ±0.89 at 1.36 [D front].
  shoulder: { inset: 0.04, rise: 0.04 },
  cabin: {
    columns: [
      // The cowl and the A pillar: drawn (0.456, 1.33) → (0.689, 1.88); the door's front
      // edge below the belt at the cowl (drawn 0.36-0.39: the kit has no door ahead of the
      // first column).
      { s: 0.4, top: 0.6, upper: 'body', lower: 'door1' },
      // The A pillar 5 cm along the car at the belt: narrower, its lining folds into the jamb.
      { s: 0.45, top: 0.65, upper: 'door1' },
      // The glass's front edge parallel to the pillar [D (0.526, 1.33) → (0.735, 1.83)],
      // its rear edge 1.21 [P]; a two-pane slider on the car.
      { s: 0.49, top: 0.69, upper: 'door1', glass: 'drop' },
      { s: 1.21, top: 1.21, upper: 'door1' },
      // The front door's rear edge 1.29 [P 1.290; D 1.30-1.32]; the B post to the panel's
      // window (glazed on the 2206) 1.364-1.807 [P].
      { s: 1.29, top: 1.29, upper: 'body' },
      { s: 1.364, top: 1.364, upper: 'body', glass: 'fixed' },
      { s: 1.807, top: 1.807, upper: 'body' },
      // The side door on the right only, 1.874-2.805, hinged at its front edge; its window
      // 1.935-2.736 [P]. On the left a body pane in the same place [P "Aŭto UAZ-3962 04"].
      { s: 1.874, top: 1.874, upper: 'door2', only: 'right' },
      { s: 1.935, top: 1.935, upper: 'door2', glass: 'fixed', only: 'right' },
      { s: 2.736, top: 2.736, upper: 'door2', only: 'right' },
      // The saloon's window 2.877-3.757 [P].
      { s: 2.805, top: 2.805, upper: 'body' },
      { s: 2.877, top: 2.877, upper: 'body', glass: 'fixed' },
      { s: 3.757, top: 3.757, upper: 'body' },
      // The rear corner 3.81 to the tail, blank: a pressed panel on the 1995 2206, the 3962,
      // "UAZ-452 back" and the owner's rear view [P] (glazed on the drawing [D]).
      // The rear face leans forward above the belt: 4.18 at 1.67 [P].
      { s: 4.18, top: 4.12, upper: 'body' },
      // rearBase; the gutter's end 4.14 [P].
      { s: 4.24, top: 4.14 },
    ],
    rail: 1.88, // the gutter 1.91 [P 1.912; D front 1.908] less its lip
    railHalf: 0.88, // the roof's edge ±0.88-0.86 at 1.88-1.90 [D front, rear]
    crown: 0.13, // the roof's centre 2.07-2.08 [D front, rear]
    // The roof is flat in the middle and rolls down into the gutters [D front, 4.76 mm/px:
    // 13 mm down at ±0.40, 37 at ±0.57, 65 at ±0.69, 108 at ±0.80], a cube, not a
    // parabola (owner, 2026-10-17: "too round").
    crownPower: 3,
    railInset: 0.07,
    railRise: 0.07,
    railBend: [0.3, 0.6],
    glassBottom: 0.04, // [P 1.40]
    glassTop: 0.04, // [P 1.835]
    screenBottom: 0.04, // [D front: glass 1.42-1.81]
    screenHeader: 0.07,
    screenFoot: 0.14, // the foot 0.256 on the centre line [D]
    wiperBlade: 0.33, // [E the classics'; unmeasured]
    // The rear doors' bands (their glass is `rearPanes`).
    rearBottom: 0.085,
    rearHeader: 0.1,
    // One pane in each leaf, ±0.072-0.60, 1.45-1.77, corners r 0.06; the leaves' top
    // straight across at 1.85 under the roof's rear panel [D rear view, ×4.74; the owner's
    // rear view: ±0.076-0.63].
    rearPanes: { x0: 0.072, x1: 0.6, y0: 1.45, y1: 1.77, r: 0.06, top: 1.85 },
    // The windscreen glass's edge ±0.77 (drawn ±0.78); the rear doors' cut at rearBase
    // ±0.72 (drawn ±0.725).
    pillar: 0.12,
  },
  wheels: {
    front: 0.993, // [D 993]
    rear: 3.293, // wheelbase 2300 [D, F]
    radius: 0.364, // static [D 364]
    width: 0.215, // 215/90-15C
    frontHalfTrack: 0.7225, // 1445 [D]
    rearHalfTrack: 0.7225,
    // Tight arches: the front's top 0.714 [P] (here the circle's 0.728); the rear's flat
    // top 0.639 [P], below the tyre's top: 0.76 of the radius over the hub.
    arch: 1.0,
    rearArch: 1.0,
    rearArchRise: 0.76,
  },
  doorBottom: 0.45, // [P 0.449]; ahead of the front arch it clamps to the 0.55 band
  // At the cowl: no deck lies ahead of the screen to make a bonnet.
  bonnetFront: 0.4,
  // The filler's recess on the right panel [P]; one each side on the car.
  flap: { s0: 1.44, s1: 1.56, y0: 0.72, y1: 0.9 },
  tailgateHinge: 'split',
  // The silencer and tail pipe 3 cm under the floor (0.42-0.52 behind the rear axle) [E].
  exhaustTuck: 0.03,
};

/**
 * UAZ-2206 (the drawing's front and rear views; Commons photos "1995 UAZ 2206 beige
 * front/rear", "2013 UAZ 396255 front", "Aŭto UAZ-3962 01"): round head lamps in chrome
 * bezels either side of a trapezoid grille under the radiator's hatch, round amber
 * indicators under the lamps, black channel bumpers; at the tail tall lamp clusters at
 * the corners beside the two rear doors.
 */
export const LOOK_UAZ2206: KitLook = {
  label: 'UAZ-2206',
  upholstery: 0x2a2a28, // black vinyl [P "… 452 (steering wheel)"]
  dash: 0x5e5d3c, // painted steel, olive [P]: now only its knobs' shade
  dashPainted: true, // in the body's colour (owner, 2026-10-18)
  headrests: false, // [P]
  brightwork: 'black', // handles, mirrors [P]
  // Outside handles at 1.242: the front doors' at s 1.19-1.25, the side door's at
  // 2.60-2.68 [P, measurements-uaz.md §3.5].
  handles: { front: 1.22, rear: 2.64, y: 1.242, half: 0.035 },
  // The rear leaves: two outside hinges each across the outer shut line, ±0.62-0.75 at
  // 0.93-1.005 and 1.71-1.77 [D rear; P "2206-1995-rear34"]; the handle at 1.24 by the
  // right leaf's inner edge [D], here 0.05-0.13 from the centre line [E].
  rearLeaves: {
    hinges: { x0: 0.62, x1: 0.75, bands: [[0.93, 1.005], [1.71, 1.77]] },
    handle: { leaf: 'right', x0: 0.05, x1: 0.13, y: 1.24 },
  },
  sill: null,
  waist: null,
  // No repeater on the flank; the amber marker at the roof's corner (s 1.32-1.39, y
  // 1.815-1.88 [P]) stands above the belt, where the repeater cannot go: here on the B
  // post just under the belt [E].
  repeater: { s0: 1.305, s1: 1.355, y0: 1.24, y1: 1.29 },
  front: {
    // ±0.883, 0.580-0.699, black channel [D; P]; wrapping round the nose's corners [D]; its
    // brackets 1 cm long from the face (at s 0.05) to the bar's back.
    bumper: { kind: 'blade', finish: 'black', lift: 0.07, height: 0.12, depth: 0.04, strip: null, overriders: null, wrap: 0.2 },
    items: [
      // The grille: a trapezoid ±0.453 at 0.699 to ±0.32 at 0.937 [D], here its mean
      // width; a diamond mesh in a raised frame [P] as bars.
      {
        kind: 'grille',
        x: { centre: 0.39 },
        y: { from: ['bumperTop', 0.01], to: ['bumperTop', 0.237] },
        frame: { finish: 'paint', margin: 0.02 },
        back: true,
        bars: { dir: 'horizontal', count: 7, finish: 'paint', margin: 0.03, width: 0.008, depth: 0.008, proud: 0.02 },
      },
      // The radiator's hatch above it: its shut line, ±0.227, 0.973-1.097 [D].
      { kind: 'frame', x: { at: { centre: 0 }, half: 0.227 }, y: { from: ['bumperTop', 0.274], to: ['bumperTop', 0.398] }, width: 0.006, finish: 'black', proud: 0.003 },
      // Head lamps ±0.522 at 1.021, 7-inch lenses [D].
      { kind: 'round', role: 'head', x: { centre: 0.522 }, y: ['bumperTop', 0.321], radius: 0.095 },
      // Amber indicators under them ±0.642 at 0.806, r 0.072 [D; P amber].
      { kind: 'round', role: 'blinker', x: { centre: 0.642 }, y: ['bumperTop', 0.106], radius: 0.06 },
    ],
  },
  rear: {
    // 0.58-0.70, near the full width, black [D; P].
    bumper: { kind: 'blade', finish: 'black', lift: 0.12, height: 0.12, depth: 0.09, strip: null, overriders: null },
    items: [
      // The clusters ±0.775-0.895 (here to 0.855, inside the tail face), 0.76-1.12: amber,
      // red, the reflector [D; P "Aŭto UAZ-3962 01"]; the lowest cell lights for reversing
      // [E: the kit needs a reversing lamp].
      {
        kind: 'cluster',
        x: { from: { centre: 0.775 }, to: { centre: 0.855 } },
        y: { from: ['bumperTop', 0.06], to: ['bumperTop', 0.42] },
        columns: [['blinker', 'tail', 'brake', 'reverse']],
      },
    ],
  },
};
