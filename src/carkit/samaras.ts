/**
 * The Samara family: VAZ-2108 (three-door hatch), 2109 (five-door hatch), 21099 (saloon)
 * and 2115 (the facelifted saloon). Numbers and sources in measurements-samara.md.
 *
 * One shell from the nose to the B pillar and one set of heights: the four share the
 * 2108's stampings there, so the 2109 and 21099 are written in the 2108's frame and the
 * 2115, whose bumpers stand further out, is placed with `onBody` from that frame. The
 * 2109 differs in its doors only (a shorter front door, a full-size rear door, a smaller
 * quarter light); the 21099 in its doors and its tail (a boot, own lamps); the 2115 in its
 * boot lid, which comes down between the corner lamps carrying a lamp bar, its body-colour
 * bumpers and its face.
 */

import type { CabinColumn, FaceLook, KitLook, TubStation } from './spec';
import type { KitBody } from './specs';

/** The Samara's deep moulded bumpers, the front one taller. */
const SAMARA_FRONT_BUMPER = { kind: 'moulded', drop: 0.03, height: 0.26 } as const;
const SAMARA_REAR_BUMPER = { kind: 'moulded', drop: 0.03, height: 0.22 } as const;

/**
 * VAZ-2108, 3.826 mm/px: overhangs 785 / 761 over a 2460 wheelbase. A plastic bumper to
 * s 100, the face raked back to the bonnet's lip at s 164, 803 high; the bonnet climbs
 * to 937 at the cowl (s 1232); a raked screen to the roof's front at s 1760; roof
 * 1335 to s 3190; the tailgate's glass down to its knee at s 3930, 884 high, and a
 * short upright panel over the lamps. Sill 264, door bottom 302, belt 911 rising to
 * 922 over the quarter; door 1278 to 2552, its glass ending at 2460; quarter glass 2605
 * to 3570 at its foot and 3120 at its head.
 */
export const BODY_2108: KitBody = {
  length: 4.006,
  platform: 'samara',
  stations: [
    // The wing's top leans in more and more from the door to the lamps, whose outer edges
    // it meets at the nose; the crease below it stays nearly full width all the way.
    { s: 0.11, sill: 0.36, crease: 0.6, belt: 0.775, deck: 0.79, wSill: 0.775, wCrease: 0.785, wBelt: 0.69 },
    { s: 0.17, sill: 0.33, crease: 0.6, belt: 0.8, deck: 0.815, wSill: 0.785, wCrease: 0.8, wBelt: 0.71 },
    { s: 0.5, sill: 0.285, crease: 0.6, belt: 0.83, deck: 0.85, wSill: 0.795, wCrease: 0.815, wBelt: 0.75 },
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
};

/**
 * The 2108's look, and the 2109's and the 21099's face: rectangular lamps leaning in at
 * their outer edges, standing on the bumper, the indicators their outer cells; no
 * grille: a body-colour panel between the lamps with two rows of three dark slots.
 */
export const LOOK_2108: KitLook = {
  label: 'VAZ-2108',
  upholstery: 0x3d3f44,
  dash: 0x202224,
  headrests: true,
  brightwork: 'black',
  sill: null,
  waist: null,
  repeater: null,
  front: {
    bumper: SAMARA_FRONT_BUMPER,
    items: [
      // Front view (4.63 mm/px from the 1750 width): the slotted panel runs to ±0.34, the unit
      // to ±0.69 with the indicator its outer 70 mm; the outer edge leans in at the top.
      { kind: 'lens', role: 'head', x: { from: { centre: 0.36 }, to: { centre: 0.62 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.035, inner: 0 } },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.625 }, to: { centre: 0.69 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.04, inner: 0.035 } },
      // Dark slots with a body-colour bar across their middle...
      {
        kind: 'grille',
        x: { centre: 0.32 },
        y: { from: ['bumperTop', 0.025], to: ['deck', -0.035] },
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'paint', margin: 0, width: 0.045, depth: 0.03, proud: 0.03 },
      },
      // ...and two body-colour posts splitting each row in three, edges included.
      {
        kind: 'grille',
        x: { centre: 0.32 },
        y: { from: ['bumperTop', 0.025], to: ['deck', -0.035] },
        back: false,
        bars: { dir: 'vertical', count: 4, finish: 'paint', margin: 0.012, width: 0.024, depth: 0.03, proud: 0.03 },
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
};

/**
 * The 2108's greenhouse columns up to the front door's front frame: the A pillar, the
 * windscreen corner and the front door's leading edge are the same parts on all four.
 */
const FRONT_COLUMNS: readonly CabinColumn[] = BODY_2108.cabin.columns.slice(0, 3);

/**
 * The five-door B pillar (21099 drawing and 2109 photo, see measurements-samara.md
 * §2): the front door's glass ends at 2.19, the doors meet at 2.235 below the belt,
 * the rear door's glass starts at 2.29; the pillar between is body above the belt.
 */
const B_PILLAR: readonly CabinColumn[] = [
  { s: 2.19, top: 2.19, upper: 'door1' },
  { s: 2.225, top: 2.225, upper: 'body', lower: 'door1' },
  { s: 2.235, top: 2.235, upper: 'body', lower: 'door2' },
  { s: 2.265, top: 2.265, upper: 'door2' },
  { s: 2.29, top: 2.29, upper: 'door2', glass: 'drop' },
];

/**
 * VAZ-2109: the 2108 with a shorter front door, a full-size rear door reaching over the
 * rear arch, its frame raked along the C pillar (2109 drawing, brought onto the 21099
 * drawing's door lines), and a smaller fixed quarter light behind it, whose rear edge
 * and the tailgate are the 2108's.
 */
export const BODY_2109: KitBody = {
  ...BODY_2108,
  cabin: {
    ...BODY_2108.cabin,
    columns: [
      ...FRONT_COLUMNS,
      ...B_PILLAR,
      { s: 3.016, top: 2.838, upper: 'door2' },
      { s: 3.125, top: 2.875, upper: 'body', lower: 'body' },
      { s: 3.145, top: 2.915, upper: 'body', glass: 'fixed' },
      { s: 3.57, top: 3.12, upper: 'body' },
      { s: 3.93, top: 3.19 },
    ],
  },
};

/** The 2109's look: the 2108's. */
export const LOOK_2109: KitLook = { ...LOOK_2108, label: 'VAZ-2109' };

/** The 2108's stations ahead of the rear wheel, which the saloons share. */
const SALOON_FRONT: readonly TubStation[] = BODY_2108.stations.slice(0, 5);

/** The saloons' boot side from the back light's foot to the start of their tails. */
const SALOON_BOOT: readonly TubStation[] = [
  // Back light's foot 0.995 on the centre line; the boot's shoulder at 0.92–0.93 [21099 D].
  { s: 3.6, sill: 0.28, crease: 0.64, belt: 0.92, deck: 0.995, wSill: 0.795, wCrease: 0.82, wBelt: 0.805 },
  { s: 3.95, sill: 0.3, crease: 0.64, belt: 0.93, deck: 0.97, wSill: 0.79, wCrease: 0.815, wBelt: 0.8 },
];

/**
 * VAZ-21099 (vaz_21099.jpg, 4.036 mm/px from the drawn 2460 wheelbase; heights by the
 * 2108's belt and sill): the 2109's front door and B pillar, a rear door whose frame
 * rakes back further, a small quarter light, a raked back light from the roof's end at
 * 3.14 to its foot at 3.58, 0.995 high, and a boot lid falling to 0.935 at its trailing
 * edge (4.10) and down its short rear face to the lamps' top. Bumper tip 4.205.
 */
export const BODY_21099: KitBody = {
  ...BODY_2108,
  length: 4.205,
  stations: [
    ...SALOON_FRONT,
    ...SALOON_BOOT,
    { s: 4.1, sill: 0.33, crease: 0.63, belt: 0.905, deck: 0.925, wSill: 0.775, wCrease: 0.8, wBelt: 0.785 },
    // The tail face: lamps up to 0.77 [D], 0.755 / 0.785 half widths [D top view].
    { s: 4.15, sill: 0.36, crease: 0.62, belt: 0.765, deck: 0.785, wSill: 0.755, wCrease: 0.785, wBelt: 0.77 },
  ],
  cabin: {
    ...BODY_2108.cabin,
    columns: [
      ...FRONT_COLUMNS,
      ...B_PILLAR,
      { s: 3.011, top: 2.757, upper: 'door2' },
      { s: 3.12, top: 2.849, upper: 'body', lower: 'body' },
      { s: 3.14, top: 2.946, upper: 'body', glass: 'fixed' },
      { s: 3.334, top: 3.072, upper: 'body' },
      { s: 3.58, top: 3.14 },
    ],
    rearKnee: undefined,
  },
  bootEnd: 4.14,
  flap: { s0: 3.6, s1: 3.78, y0: 0.61, y1: 0.725 },
};

/**
 * The 21099's tail lamps (rear view at 4.25 mm/px, photo "2003 VAZ 21099 blue rear"):
 * wide units from 0.30 out to 0.06 short of the corner, amber outside, then the red
 * tail and brake lamp, red over the white reversing lamp, and the red fog lamp inside.
 */
const REAR_21099: FaceLook = {
  bumper: { kind: 'moulded', drop: 0.03, height: 0.23 },
  items: [
    {
      kind: 'cluster',
      x: { from: { inset: 0.06 }, to: { centre: 0.3 } },
      y: { from: ['bumperTop', 0.012], to: ['deck', -0.018] },
      columns: [['blinker'], ['tail', 'brake'], ['tail', 'reverse'], ['inert']],
    },
  ],
};

export const LOOK_21099: KitLook = { ...LOOK_2108, label: 'VAZ-21099', rear: REAR_21099 };

/**
 * VAZ-2115, in the 21099's frame (the car is that frame moved 0.045 back by its longer
 * front bumper, 4.33 long; photo "2005 Lada 21150 purple side", 2.267 mm/px from the
 * wheelbase): the 21099's cabin and boot side, a boot lid with its trailing edge at
 * 4.105 and 0.94 high whose rear face comes down to 0.61 between the corner lamps, and
 * deep body-colour bumpers.
 */
export const BODY_2115: KitBody = {
  ...BODY_21099,
  length: 4.285,
  stations: [
    ...SALOON_FRONT,
    ...SALOON_BOOT,
    { s: 4.105, sill: 0.3, crease: 0.63, belt: 0.915, deck: 0.94, wSill: 0.775, wCrease: 0.8, wBelt: 0.785 },
    // The tail face: the lid's foot 0.61 between corners topped at 0.765, cut at ±0.575.
    { s: 4.15, sill: 0.3, crease: 0.62, belt: 0.75, deck: 0.61, notch: 0.575, wSill: 0.76, wCrease: 0.785, wBelt: 0.77 },
  ],
  bootEnd: 4.15,
};

/**
 * The 2115's look (photos "2010 Lada 211540 dark green rear view", "VAZ-2115",
 * "2008 Lada Samara 211540 rear"): eye-shaped head lamps with the amber indicator at
 * their outer ends and a narrow slot under the bonnet's lip between them; corner lamps
 * (amber outside, red) on the body and a lamp bar across the lid between them, a white
 * reversing lamp in each end of it; body-colour bumpers, the rear one deep.
 */
export const LOOK_2115: KitLook = {
  ...LOOK_2108,
  label: 'VAZ-2115',
  upholstery: 0x34363b,
  front: {
    bumper: { kind: 'moulded', drop: 0.07, height: 0.3, finish: 'paint' },
    items: [
      { kind: 'lens', role: 'head', x: { from: { centre: 0.33 }, to: { centre: 0.6 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.03, inner: 0.02 } },
      { kind: 'lens', role: 'blinker', x: { from: { centre: 0.605 }, to: { centre: 0.69 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.04, inner: 0.03 } },
      {
        kind: 'grille',
        x: { centre: 0.27 },
        y: { from: ['bumperTop', 0.03], to: ['bumperTop', 0.08] },
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'alloy', margin: 0, width: 0.01, depth: 0.01, proud: 0.022 },
      },
      // The bumper's dark lower intake, standing out of the face to the bumper's front.
      {
        kind: 'grille',
        x: { centre: 0.3 },
        y: { from: ['bumperBottom', 0.085], to: ['bumperBottom', 0.15] },
        standOut: 0.13,
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'black', margin: 0, width: 0.012, depth: 0.01, proud: 0.03 },
      },
    ],
  },
  rear: {
    bumper: { kind: 'moulded', drop: 0.04, height: 0.306, finish: 'paint' },
    items: [
      {
        kind: 'cluster',
        x: { from: { inset: 0.01 }, to: { centre: 0.585 } },
        y: { from: ['bumperTop', 0.01], to: ['deck', -0.008] },
        columns: [['blinker'], ['tail', 'brake']],
      },
    ],
    lid: [
      {
        kind: 'cluster',
        x: { from: { centre: 0.565 }, to: { centre: 0.4 } },
        y: { from: ['bumperTop', 0.02], to: ['deck', -0.008] },
        columns: [['tail'], ['reverse'], ['tail']],
      },
      { kind: 'lens', role: 'inert', x: { from: { centre: 0 }, to: { centre: 0.39 } }, y: { from: ['bumperTop', 0.03], to: ['deck', -0.018] }, depth: 0.008, proud: 0.01 },
    ],
  },
};
