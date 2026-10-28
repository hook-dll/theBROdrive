/**
 * The first GAZelles (platform `truck`, the early face of 1994-2003): the GAZ-3302 flatbed
 * with a tent on hoops, and the GAZ-3221 minibus on the same cab. Numbers and sources in
 * measurements-gazelle.md.
 *
 * One cab for both, written once (`cab`): a short sloping bonnet ahead of a steep wide
 * screen, the front wheel under the door's front (its arch cut into the cab's side), the
 * engine under the bonnet and a cover between the front seats (no tilting cab). Measured
 * on getoutlines.com's GAZ-3302 (2006) side and front views, 10.915 mm/px from the drawn
 * 2900 wheelbase (hubs x 106 / 371.7), ground y 240.5, front view 10.69 mm/px from the 1700
 * front track; the 2006 drawings carry the 2003 face, so the face, bumper and bonnet nose
 * are the early car's from the 1996 GAZ-3221 four-view (22.7 mm/px from its 2200 height)
 * and the photos. `s` from the early bumper's face, the front hub at 1.0 (overhang 990
 * [F 3302] and 1030 [F 3221]). The 3221's body behind the cab on its own drawing (10.10
 * mm/px, hubs x 104.3 / 391.3) and the 1996 four-view's right side (the sliding door).
 */

import type { KitLook, TruckSpec, TubStation } from './spec';
import type { KitBody } from './specs';

/** The front wheel's hub [F: 990-1030 overhang; the cab's own origin]. */
const FRONT = 1.0;
/** Rear hub: wheelbase 2900 [F]. */
const REAR = FRONT + 2.9;

/**
 * The cab's stations to the B pillar: the nose at the bumper's back, rounding in plan to
 * the full width by 0.14; the bonnet's deck rising from 0.88 at the nose [D96 front: the
 * lid's edge 0.86] to the screen's foot 1.28, its slope easing evenly from 45° to 27° [D
 * side: 33° on the late nose; an even ease, kit-surface]; the belt rising with it to the
 * side glass's foot 1.27 at the A pillar [D 1.272]; half widths 0.96 at the belt, 0.99 at
 * the crease, 0.97 at the sill [D front: 0.96 at 1.26, 0.993 at 0.9].
 */
const CAB_STATIONS: readonly TubStation[] = [
  { s: 0.03, sill: 0.4, crease: 0.62, belt: 0.86, deck: 0.88, wSill: 0.84, wCrease: 0.88, wBelt: 0.84 },
  { s: 0.14, sill: 0.4, crease: 0.64, belt: 0.93, deck: 0.99, wSill: 0.95, wCrease: 0.98, wBelt: 0.94 },
  { s: 0.35, sill: 0.4, crease: 0.66, belt: 1.08, deck: 1.15, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
  { s: 0.56, sill: 0.4, crease: 0.68, belt: 1.2, deck: 1.28, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
  // The cowl (the A pillar's foot) and behind the arch the cab's bottom 0.43 [D 0.42-0.44],
  // clear of the kingpins' tops (0.42).
  { s: 0.86, sill: 0.43, crease: 0.68, belt: 1.27, deck: 1.43, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
  { s: 1.45, sill: 0.43, crease: 0.68, belt: 1.27, deck: 1.43, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
];

/** The cab's greenhouse columns to the door's rear edge [D side]. */
const CAB_COLUMNS = [
  // The A pillar: its foot at the belt 0.86, its top 1.33 at the rail [D side: the black
  // band's front edge, raked 38°]; thin.
  { s: 0.86, top: 1.33, upper: 'body' as const },
  // The door's front edge 0.935 below the belt [D x 100], up the pillar's back to 1.40.
  { s: 0.935, top: 1.4, upper: 'door1' as const },
  // The vent glass ahead of its post, the post raked 1.43 at the belt to 1.49 [D x 146-152],
  // the drop glass to 1.885 [D x 188], the door's rear frame to 1.955 [D x 195].
  { s: 0.965, top: 1.43, upper: 'door1' as const, glass: 'vent' as const },
  { s: 1.425, top: 1.49, upper: 'door1' as const },
  { s: 1.455, top: 1.52, upper: 'door1' as const, glass: 'drop' as const },
  { s: 1.885, top: 1.885, upper: 'door1' as const },
  { s: 1.955, top: 1.955, upper: 'body' as const },
];

/** The cab's roof and glass [D side and front]. */
const CAB_GREENHOUSE = {
  // The drip rail 1.92 [D front; side 1.894 at the door's top]; ±0.84 [D front]; the
  // roof's top 2.05 [D side 2.053, front 2.03].
  rail: 1.92,
  railHalf: 0.84,
  crown: 0.09,
  crownPower: 3,
  railInset: 0.06,
  railRise: 0.04,
  railBend: [0.3, 0.6] as const,
  glassBottom: 0.0, // the door glass from the belt 1.27 [D]
  glassTop: 0.03, // to 1.89 [D side y 67]
  screenBottom: 0.04, // the glass from 1.325 [D front]
  screenHeader: 0.05, // to 1.87 [D front]
  // The screen curved in plan: its middle's foot 0.30 ahead of the corner's [D side: the
  // centre line's profile through (0.53, 1.325)], its top 0.05.
  screenFoot: 0.3,
  screenTop: 0.05,
  wiperBlade: 0.5, // [E]
  pillar: 0.05,
} as const;

/** The chassis both share [E unless marked; measurements-gazelle.md §4]. */
const CHASSIS: Pick<TruckSpec, 'frame' | 'springs' | 'step' | 'exhaust' | 'driveline' | 'bay'> = {
  frame: {
    // Behind the bumper to the tail; the rails' top 0.60 at the front rising to 0.79 under
    // the platform [D side y 168]; 150 deep [D 0.64-0.79]; 880 over the rails [E].
    s0: 0.2,
    s1: 5.3,
    half: 0.44,
    depth: 0.15,
    flange: 0.06,
    top: [0.5, 0.79],
    cross: [0.3, 1.25, 2.3, 3.2, 4.45, 5.2],
  },
  // Leaf springs at both axles [F: "на двух продольных полуэллиптических рессорах"]; their
  // lengths [E].
  springs: { front: [0.5, 1.5], rear: [3.3, 4.5] },
  // Inside the right rail under the floor [E].
  exhaust: { x: -0.25, y: 0.3, top: 0.58, silencer: [2.4, 3.1], tail: 3.45 },
  driveline: { y: 0.47 },
  // The engine under the cover between the seats, its front under the bonnet [F:
  // ZMZ-4026, longitudinal]; the radiator behind the grille, the air filter and the
  // turbine's cell under the bonnet either side of the engine's front [E].
  bay: {
    engine: { x: [-0.15, 0.15], s: [0.98, 1.4], floor: 0.62, top: 0.98 },
    radiator: { x: [-0.36, 0.36], s: [0.14, 0.22], floor: 0.46, top: 0.86 },
    air_filter: { x: [0.12, 0.4], s: [0.3, 0.52], floor: 0.74, top: 1.06 },
    turbine: { x: [-0.4, -0.12], s: [0.3, 0.52], floor: 0.74, top: 1.06 },
  },
};

/** The wheels both share: 175R16C [F] on 16-inch discs, 1700/1560 tracks [F]. */
const WHEELS = {
  front: FRONT,
  rear: REAR,
  radius: 0.34, // [D 0.337 loaded]
  width: 0.175,
  frontHalfTrack: 0.85,
  rearHalfTrack: 0.78,
  // The front arch: 0.43 ahead of the hub, 0.38 behind, 0.45 over it [D side, both
  // drawings]: 0.405 wide about a centre 0.025 ahead of the hub, a half ellipse 0.45 high.
  arch: 1.19,
  frontArchRise: 1.32,
  archShift: [-0.025, 0.015] as const,
  rimRadius: 0.203,
};

/**
 * GAZ-3302: the cab to its back wall at 2.17 [D side x 214], on the frame; a steel
 * platform with drop boards and a tent on hoops.
 */
export const BODY_GAZ3302: KitBody = {
  length: 5.48, // [F]; the tail board's back
  platform: 'truck',
  stations: [
    ...CAB_STATIONS,
    { s: 2.17, sill: 0.43, crease: 0.68, belt: 1.27, deck: 1.31, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 },
  cabin: {
    ...CAB_GREENHOUSE,
    columns: [
      ...CAB_COLUMNS,
      // Behind the door the cab's side and its back corner, the roof's corner rounding to
      // 2.135 at the top [D side x 211.7].
      { s: 2.17, top: 2.135 },
    ],
    rearBottom: 0.1,
    rearHeader: 0.12,
    // The back wall's window [E: no rear photo of the cab; the late cab's 1.0 x 0.3 pane].
    rearPanes: { x0: -0.1, x1: 0.5, y0: 1.45, y1: 1.75, r: 0.05, top: 2.3 },
  },
  wheels: { ...WHEELS, outside: 'rear' },
  doorBottom: 0.47, // [D 0.467-0.49]
  bonnetFront: 0.05,
  // The back wall's glass is a saloon's back light.
  bootEnd: 2.17,
  truck: {
    ...CHASSIS,
    // On the left rail behind the cab, its filler on top at the front outer corner [D side
    // s 2.32-3.07, y 0.35-0.66; F 70 l; E the cap's place].
    tank: { s: [2.35, 3.05], y: [0.35, 0.66], out: 0.78, cap: [2.48, 0.68] },
    platform: {
      // From 0.15 behind the cab to the tail [D: 0.10 on the late car]; 2.066 over the
      // boards [F width], 1.943 inside [F]; boards 0.38 over the floor [F]; two pressed
      // ribs [P drom press photos]; the floor 0.88 [D side y 160], its beam 0.1 deep [D].
      s0: 2.32,
      s1: 5.48,
      floor: 0.88,
      beam: 0.1,
      half: 1.033,
      inside: 0.9715,
      side: 0.38,
      ribs: 2,
    },
    // The tent to 2.55 [D: the dotted outline], lapping 12 cm over the boards, its roof's
    // edges rolled on 0.12; four hoops; dark olive-grey canvas [P drom press photos 1, 8].
    tent: { top: 2.55, out: 0.015, lap: 0.12, round: 0.12, hoops: [2.6, 3.5, 4.4, 5.25], colour: 0x4b5043 },
    // Under the platform's rear corners on brackets [D side s 4.98, y 0.57; P 1995 rear]:
    // indicator, brake, tail and the reversing lamp on the left unit [E the cells].
    rearLamps: { at: [5.32, 0.8, 0.6], half: [0.12, 0.045], cells: [['blinker', 0.06], ['brake', 0.06], ['tail', 0.05], ['reverse', 0.05]], reverse: 'left' },
  },
};

/**
 * GAZ-3221: the cab and the all-metal saloon to the tail at 5.37 [D 2006: 5.34], the rear
 * arch in the body, three windows a side behind the cab, the sliding door on the right,
 * two rear doors; the roof over the saloon a little higher than the cab's [F 2200].
 */
export const BODY_GAZ3221: KitBody = {
  length: 5.47, // [F]; the rear bumper's back
  platform: 'truck',
  stations: [
    ...CAB_STATIONS,
    { s: 3.5, sill: 0.43, crease: 0.68, belt: 1.27, deck: 1.31, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
    // The sill up behind the rear arch [D side y 186: 0.42-0.46].
    { s: 4.4, sill: 0.46, crease: 0.68, belt: 1.27, deck: 1.31, wSill: 0.97, wCrease: 0.99, wBelt: 0.96 },
    // rearBase: the rear doors' top at the deck's edge.
    { s: 5.35, sill: 0.46, crease: 0.68, belt: 1.27, deck: 1.31, wSill: 0.95, wCrease: 0.97, wBelt: 0.94 },
    // The tail face: the rear doors come down to the bumper's top 0.62 between the lamps'
    // pillars at ±0.80 [E; D the lamps ±0.82-0.95].
    { s: 5.37, sill: 0.46, crease: 0.68, belt: 1.27, deck: 0.62, notch: 0.8, wSill: 0.93, wCrease: 0.95, wBelt: 0.92 },
  ],
  shoulder: { inset: 0.03, rise: 0.02 },
  cabin: {
    ...CAB_GREENHOUSE,
    // The saloon's roof 2.20 [F; D 2.24]: the rail as the cab's, the crown higher.
    crown: 0.22,
    columns: [
      ...CAB_COLUMNS,
      // The B pillar to the sliding door's front 2.25 [D96 right side x 252]; on the left
      // the same strips are the body's with their glass [D 2006 left: 2.23-3.19].
      { s: 2.25, top: 2.25, upper: 'door2', only: 'right' },
      { s: 2.3, top: 2.3, upper: 'door2', glass: 'fixed', only: 'right' },
      { s: 3.25, top: 3.25, upper: 'door2', only: 'right' },
      // The door's rear edge 3.40 [D96 x 201: 3.44]; the saloon's windows 3.48-4.42 and
      // 4.60-5.12 [D 2006 left: 3.46-4.41, 4.61-5.11].
      { s: 3.4, top: 3.4, upper: 'body' },
      { s: 3.48, top: 3.48, upper: 'body', glass: 'fixed' },
      { s: 4.42, top: 4.42, upper: 'body' },
      { s: 4.6, top: 4.6, upper: 'body', glass: 'fixed' },
      { s: 5.12, top: 5.12, upper: 'body' },
      // rearBase; the tail upright [D].
      { s: 5.35, top: 5.33 },
    ],
    rearBottom: 0.06,
    rearHeader: 0.1,
    // One pane in each rear door ±0.06-0.68, 1.32-1.82, corners r 0.06, clear of the
    // hinges outboard of it; the doors' top straight across at 1.93 under the roof's rear
    // [E: no rear view of the 3221 sourced].
    rearPanes: { x0: 0.06, x1: 0.68, y0: 1.32, y1: 1.82, r: 0.06, top: 1.93 },
  },
  wheels: {
    ...WHEELS,
    // The rear arch 0.34 ahead of the hub, 0.37 behind, 0.445 over it [D 2006].
    rearArch: 1.05,
    rearArchRise: 1.31,
  },
  doorBottom: 0.47,
  bonnetFront: 0.05,
  // The filler's flap on the left behind the front door [D 2006: s 2.25-2.45, 0.68-0.84].
  flap: { s0: 2.27, s1: 2.43, y0: 0.69, y1: 0.83, side: 'left' },
  tailgateHinge: 'split',
  // The side door slides back on its rails, out 6 cm, back 1.1 m [E: its opening 1.15 long].
  slidingDoor: { out: 0.06, travel: 1.1 },
  truck: {
    ...CHASSIS,
    // On the left rail under the floor behind the sliding door's step [E: 70 l F].
    tank: { s: [2.6, 3.25], y: [0.2, 0.41], out: 0.76 },
    // The rails level under the saloon's floor (0.65), their bottom 1.5 cm under the
    // body's at the nose, clear of it [E].
    frame: { ...CHASSIS.frame, top: [0.535, 0.535] },
  },
};

/** What both GAZelles wear: the early face, the side, the mirrors, the cab's trim. */
const LOOK_GAZELLE_BASE = {
  upholstery: 0x3a3b3d, // dark grey vinyl [E]
  dash: 0x262728, // black plastic [P DASH: the cluster's housing]
  headrests: false, // [E]
  brightwork: 'black',
  mirrorFinish: 'black',
  // Big black heads on short arms from the door's front corner [P 1995 front, museum,
  // marshrutka]: 0.16 x 0.24 [E from the photos' proportion to the door glass].
  mirrorHead: [0.08, 0.12],
  mirrorReach: 0.15,
  // Long black pull handles under the glass's rear half [D side: s 1.59-1.81, on the
  // crease at 1.04]; here just over the crease, clear of its ridge.
  handles: { front: 1.7, rear: 2.36, y: 1.09, half: 0.1 },
  sill: null,
  waist: null,
  // A small amber repeater on the wing above the arch [P museum; D 3302 s 0.75-0.80].
  repeater: { s0: 0.75, s1: 0.8, y0: 1.0, y1: 1.035 },
  front: {
    // A deep black plastic bumper, its top 0.62 at the lamps' foot [D96 front 0.61],
    // its foot 0.37 [E], wrapping round to the arches [P 1995 front, museum].
    bumper: { kind: 'moulded', drop: 0.03, height: 0.25, corner: 0.12, wrapTo: 'arch' },
    items: [
      // The grille ±0.40 between the lamps, 0.65-0.85 [D96 front], a grey frame round two
      // rows of square cells [P 1995 front: 2 x 6] as bars, the deer badge over its middle.
      {
        kind: 'grille',
        x: { centre: 0.4 },
        y: { from: ['bumperTop', 0.03], to: ['bumperTop', 0.23] },
        frame: { finish: 'grey', margin: 0.02 },
        back: true,
        bars: { dir: 'vertical', count: 5, finish: 'grey', margin: 0.13, width: 0.012, depth: 0.012, proud: 0.015 },
      },
      // Rectangular head lamps ±0.43-0.73, 0.65-0.84 [D96 front; P museum].
      { kind: 'lens', role: 'head', x: { from: { centre: 0.43 }, to: { centre: 0.73 } }, y: { from: ['bumperTop', 0.03], to: ['bumperTop', 0.22] }, depth: 0.03, proud: 0.012 },
      // The amber indicators outboard of them, out to the corner [D96; P museum].
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.745 }, to: { inset: 0.03 } }, y: { from: ['bumperTop', 0.03], to: ['bumperTop', 0.22] }, depth: 0.03, proud: 0.012 },
    ],
  },
  // The pressed crease along the side at the door handles [D side 1.02-1.04].
  featureLine: { points: [[0.25, 1.02], [5.3, 1.04]], height: 0.025 },
} as const satisfies Partial<KitLook>;

/** GAZ-3302: the cab's back wall bare; the lamps are the chassis'. */
export const LOOK_GAZ3302: KitLook = {
  ...LOOK_GAZELLE_BASE,
  label: 'GAZ-3302',
  featureLine: { points: [[0.25, 1.02], [2.15, 1.04]], height: 0.025 },
  rear: { bumper: null, items: [] },
};

/**
 * GAZ-3221: tall lamp clusters on the rear pillars beside the two rear doors, a black
 * rear bumper; the rear doors' hinges and handle.
 */
export const LOOK_GAZ3221: KitLook = {
  ...LOOK_GAZELLE_BASE,
  label: 'GAZ-3221',
  // The leaves' outside hinges across the outer shut line, the handle on the right leaf by
  // its inner edge [E: no rear view sourced].
  rearLeaves: {
    hinges: { x0: 0.62, x1: 0.79, bands: [[0.8, 0.87], [1.62, 1.69]] },
    handle: { leaf: 'right', x0: 0.05, x1: 0.15, y: 1.05 },
  },
  rear: {
    // 0.44-0.60, black [D 2006 side: the bumper's band; E].
    bumper: { kind: 'moulded', drop: 0.02, height: 0.16, corner: 0.1 },
    items: [
      // Upright clusters on the pillars ±0.81-0.94, 0.82-1.24 [D 2006 side y 107-147]:
      // indicator, tail, brake and the reversing cell at the foot [E the cells].
      {
        kind: 'cluster',
        x: { from: { centre: 0.81 }, to: { centre: 0.93 } },
        y: { from: ['bumperTop', 0.22], to: ['bumperTop', 0.64] },
        columns: [['blinker', 'tail', 'brake', 'reverse']],
      },
    ],
  },
};
