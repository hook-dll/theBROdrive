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

import { lerp } from './builder';
import type { CabinColumn, FaceLook, KitLook, TubStation } from './spec';
import type { KitBody } from './specs';

/** The Samara's deep moulded bumpers, the front one taller. */
const SAMARA_FRONT_BUMPER = { kind: 'moulded', drop: 0.03, height: 0.26 } as const;
const SAMARA_REAR_BUMPER = { kind: 'moulded', drop: 0.03, height: 0.22 } as const;

/**
 * A station at `s` on the straight run between stations `a` and `b`, every field
 * interpolated as the generator interpolates them: until a field is overridden it
 * changes nothing, so a new station keeps the belt, the deck and the sill where they were.
 */
function onRun(a: TubStation, b: TubStation, s: number): TubStation {
  const t = (s - a.s) / (b.s - a.s);
  const at = (key: 'sill' | 'crease' | 'belt' | 'deck' | 'wSill' | 'wCrease' | 'wBelt'): number => lerp(a[key], b[key], t);
  return { s, sill: at('sill'), crease: at('crease'), belt: at('belt'), deck: at('deck'), wSill: at('wSill'), wCrease: at('wCrease'), wBelt: at('wBelt') };
}

/**
 * The front wing (measurements-samara.md §6). Its top leans in more and more from the
 * door to the lamps, whose outer edges it meets at the nose. Its widest line is the
 * shoulder line the 2108 drawing has at 0.70–0.71 from s 0.29 to the door [D side y
 * 247–245.5 px], 20 mm over the arch's lip (0.685 [D]): `crease` 0.705 from the arch's
 * front (s 0.425) to past the hub, so the arch and its lip stay under it and no row of the
 * side crosses it. The face above it leans in 0.244 m per m at the arch's front and 0.2 at
 * s 0.5, turning gradually upright to the door's 0.056 at the cowl; the shoulder line runs
 * straight in plan, half 0.77 → 0.801 [D top view: 0.776 → 0.81, scaled to the cabin's
 * 0.825], and comes down to the door's crease (0.63) behind the arch.
 */
const WING_FRONT: TubStation = { s: 0.17, sill: 0.33, crease: 0.6, belt: 0.8, deck: 0.815, wSill: 0.785, wCrease: 0.8, wBelt: 0.71 };
const WING_MID: TubStation = { s: 0.5, sill: 0.285, crease: 0.705, belt: 0.83, deck: 0.85, wSill: 0.795, wCrease: 0.775, wBelt: 0.75 };
const COWL: TubStation = { s: 1.232, sill: 0.264, crease: 0.63, belt: 0.9, deck: 0.92, wSill: 0.8, wCrease: 0.825, wBelt: 0.81 };

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
    // The face; the front wing's corner behind it, leaning in at the top to the lamps' ends.
    { s: 0.11, sill: 0.36, crease: 0.6, belt: 0.775, deck: 0.79, wSill: 0.775, wCrease: 0.785, wBelt: 0.69 },
    WING_FRONT,
    // On the arch's facet columns s = 0.77 − 0.34282 cos(i · 15°), i = 0 and 7, so they
    // add no tub column.
    { ...onRun(WING_FRONT, WING_MID, 0.42718), crease: 0.705, wCrease: 0.77 },
    WING_MID,
    { ...onRun(WING_MID, COWL, 0.858728), crease: 0.705, wCrease: 0.801 },
    COWL,
    { s: 2.55, sill: 0.264, crease: 0.64, belt: 0.911, deck: 0.93, wSill: 0.8, wCrease: 0.825, wBelt: 0.81 },
    { s: 3.6, sill: 0.28, crease: 0.64, belt: 0.92, deck: 0.94, wSill: 0.795, wCrease: 0.82, wBelt: 0.805 },
    { s: 3.86, sill: 0.33, crease: 0.63, belt: 0.79, deck: 0.81, wSill: 0.78, wCrease: 0.81, wBelt: 0.79 },
    { s: 3.95, sill: 0.36, crease: 0.62, belt: 0.75, deck: 0.77, wSill: 0.765, wCrease: 0.795, wBelt: 0.775 },
  ],
  shoulder: { inset: 0.025, rise: 0.015 },
  cabin: {
    columns: [
      // The A pillar, its top chamfered into the rail as the drawn line rounds into the
      // roof [D: 1.27 at 1.71 to the roof's 1.32 at 1.77]; the door's frame and glass run up
      // behind it to that rounded corner.
      { s: 1.232, top: 1.76, upper: 'body', drop: 0.03 },
      { s: 1.278, top: 1.84, upper: 'door1' },
      { s: 1.303, top: 1.865, upper: 'door1', glass: 'drop' },
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
    wiperBlade: 0.51,
    // The screen's foot on the centre line at s 1.08 on the bonnet [D side view].
    screenFoot: 0.15,
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
    // The arches to the 2108, 2109 and 21099 drawings (refs archFront / archRear): the
    // front 0.343 wide and 0.35 high, 0.015 ahead of the hub (0.35 ahead, 0.32-0.34
    // behind, as drawn); the rear 0.345 wide, 0.32 high (it stood a circle 0.36 high).
    arch: 1.22,
    frontArchRise: 1.25,
    rearArch: 1.228,
    rearArchRise: 1.14,
    archShift: [-0.015, 0.005],
  },
  doorBottom: 0.302,
  bonnetFront: 0.11,
  // The face rakes back from the bumper's top (s 0.10, 0.625) to the bonnet's lip (s 0.164,
  // 0.803) [D]: 0.36 m per m above the bumper, in full to the wing's corner (s 0.17), faded
  // out over 0.15 behind it.
  frontLean: { base: 0.625, lean: 0.36, blend: 0.15, full: 0.17 },
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
      // to ±0.69 with the indicator its outer 70 mm; the outer edge leans in at the top. The
      // head lamp stops 7 mm short of the indicator: their facing walls stand behind the face
      // under the open bonnet, and 5 mm apart they fought at range (kit-zfight).
      { kind: 'lens', role: 'head', x: { from: { centre: 0.36 }, to: { centre: 0.618 } }, y: { from: ['bumperTop', 0.015], to: ['deck', -0.025] }, depth: 0.01, proud: 0.012, slant: { outer: 0.035, inner: 0 } },
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
const FRONT_COLUMNS_2109: readonly CabinColumn[] = FRONT_COLUMNS.map((column, index) =>
  index === 1 ? { ...column, s: 1.239 } : index === 2 ? { ...column, s: 1.264 } : column,
);

export const BODY_2109: KitBody = {
  ...BODY_2108,
  cabin: {
    ...BODY_2108.cabin,
    columns: [
      ...FRONT_COLUMNS_2109,
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
const SALOON_FRONT: readonly TubStation[] = BODY_2108.stations.filter((st) => st.s < BODY_2108.wheels.rear);

/** The saloons' boot side from the back light's foot to the start of their tails. */
const SALOON_BOOT: readonly TubStation[] = [
  // Back light's foot 0.995 on the centre line; the boot's shoulder at 0.92–0.93 [21099 D].
  { s: 3.6, sill: 0.28, crease: 0.64, belt: 0.92, deck: 0.995, wSill: 0.795, wCrease: 0.82, wBelt: 0.805 },
  { s: 3.95, sill: 0.3, crease: 0.64, belt: 0.93, deck: 0.97, wSill: 0.79, wCrease: 0.815, wBelt: 0.8 },
];

/**
 * VAZ-21099 (vaz_21099.jpg, 4.036 mm/px from the drawn 2460 wheelbase; heights by the
 * 2108's belt and sill; photo "2003 VAZ 21099 blue rear" and a 2115's rear 3/4): the
 * 2109's front door and B pillar; a rear door whose frame ends at its drop glass's
 * raked channel, its shut line one line from the sill to the rail (3.12 at the belt);
 * behind it a small fixed quarter light in the body, then a C pillar of even width
 * parallel to the back light. A raked back light from the roof's end at 3.14 to its
 * foot at 3.58, 0.995 high, and a boot lid falling to 0.935 at its trailing edge (4.10)
 * and down its short rear face to the lamps' top. Bumper tip 4.205.
 */
export const BODY_21099: KitBody = {
  ...BODY_2108,
  length: 4.205,
  stations: [
    ...SALOON_FRONT,
    // SALOON_BOOT's heights with the 21099's narrower shoulder: on the drawing's rear view
    // the body's outline at the boot's shoulder is half 0.76–0.78 against 0.825 at the
    // crease, the lid tumbling in over it; the 2115's fuller boot keeps SALOON_BOOT's.
    ...SALOON_BOOT.map((station, i) => ({ ...station, wBelt: [0.785, 0.77][i]! })),
    // The lid's trailing edge on the drawn line (4.068 / 0.94, 4.109 / 0.903) [D].
    { s: 4.1, sill: 0.33, crease: 0.63, belt: 0.89, deck: 0.91, wSill: 0.775, wCrease: 0.8, wBelt: 0.755 },
    // The tail face: lamps up to 0.77 [D], 0.755 / 0.785 half widths [D top view].
    { s: 4.15, sill: 0.36, crease: 0.62, belt: 0.765, deck: 0.785, wSill: 0.755, wCrease: 0.785, wBelt: 0.75 },
  ],
  cabin: {
    ...BODY_2108.cabin,
    columns: [
      ...FRONT_COLUMNS,
      ...B_PILLAR,
      // The drop glass's raked rear edge, then the door frame's channel.
      { s: 3.095, top: 2.825, upper: 'door2' },
      // The door's shut line, the same line below and above the belt.
      { s: 3.12, top: 2.85, upper: 'body' },
      // The quarter light in the body, its rear edge on the C pillar's front.
      { s: 3.14, top: 2.87, upper: 'body', glass: 'fixed' },
      // The C pillar, parallel to the back light 0.195 ahead of it.
      { s: 3.385, top: 2.945, upper: 'body' },
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
 *
 * Its own nose: the late face is nearly the body's full width at the lamps (the units
 * reach the wings' edge [P owner's front photo: lamps from 0.41 to 0.97 of the half
 * width]) and stands forward over the bumper's top, so the bumper is a shallow band under
 * it, not a shelf.
 */
export const BODY_2115: KitBody = {
  ...BODY_21099,
  length: 4.285,
  // The rear arch on its hub, as the purple 2115 photo shows it (refs archRear [P19]: 0.34
  // ahead, 0.32 behind); the drawings' 2109 put it 5 mm back.
  wheels: { ...BODY_21099.wheels, archShift: [-0.015, 0] },
  stations: [
    { s: 0.0, sill: 0.36, crease: 0.6, belt: 0.775, deck: 0.79, wSill: 0.77, wCrease: 0.78, wBelt: 0.77 },
    { s: 0.17, sill: 0.33, crease: 0.6, belt: 0.8, deck: 0.815, wSill: 0.785, wCrease: 0.8, wBelt: 0.785 },
    // wBelt 0.796 (was 0.79): the wing's top in plan one convex curve from the lamps to the
    // cowl (0.785 → 0.796 → 0.81; 0.79 bent it the other way), and the face's lean over the
    // shoulder near even, 4.3° → 4.7° → 3.2° at the corner, here and the cowl (it went
    // 4.3° → 6.2° → 3.2°, in and out: kit-surface).
    { s: 0.5, sill: 0.285, crease: 0.6, belt: 0.83, deck: 0.85, wSill: 0.795, wCrease: 0.815, wBelt: 0.796 },
    ...SALOON_FRONT.filter((st) => st.s >= COWL.s),
    ...SALOON_BOOT,
    { s: 4.105, sill: 0.3, crease: 0.63, belt: 0.915, deck: 0.94, wSill: 0.775, wCrease: 0.8, wBelt: 0.785 },
    // The tail face: the lid's foot 0.61 between corners topped at 0.765, cut at ±0.575.
    { s: 4.15, sill: 0.3, crease: 0.62, belt: 0.75, deck: 0.61, notch: 0.575, wSill: 0.76, wCrease: 0.785, wBelt: 0.77 },
  ],
  // The bonnet's lip 0.1 behind the face; the face and lamps lean back from 0.625 as on
  // the 2108, in full ahead of it (not to the 2108's wing corner).
  bonnetFront: 0.1,
  frontLean: { base: 0.625, lean: 0.36, blend: 0.15 },
  bootEnd: 4.15,
};

/**
 * The 2115's look (photos "2010 Lada 211540 dark green rear view", "VAZ-2115",
 * "2008 Lada Samara 211540 rear", "2010 Lada 211540 silver front", "2005 Lada 21150
 * purple side"; measurements-samara.md §3): the late face — head lamps narrower than the
 * 2108's, their top sloping down at the inner end to the bonnet's lip, which comes down
 * between them over a narrow slot, the amber indicator rounding off their outer ends —
 * and rectangular fog lamps in a body-colour front bumper; grey mouldings along the doors
 * in line with a grey band round both bumpers; corner lamps (amber outside, red) on the
 * body and a lamp bar across the lid between them, a white reversing lamp in each end of
 * it; a wing on the boot lid with the high brake lamp under its middle.
 */
export const LOOK_2115: KitLook = {
  ...LOOK_2108,
  label: 'VAZ-2115',
  upholstery: 0x34363b,
  // At the front bumper's band height (owner's front photo: the band level with the
  // plate's top half), within the doors' measured 0.435–0.537 [P p19].
  waist: { y: 0.505, height: 0.09, finish: 'grey' },
  spoiler: {
    half: 0.62,
    plate: 0.05,
    s0: 4.015,
    s1: 4.177,
    top0: 0.998,
    top1: 1.026,
    thickness: 0.035,
    foot: 3.87,
    pedestal: { half: 0.13, s0: 4.06, s1: 4.145 },
    lamp: { half: 0.105, y0: 0.947, y1: 0.982 },
  },
  // The head-lamp unit, flush with the body, wrapping round the corner (measurements §3.3):
  // the head lamp from its inner end (0.30, its top 45 mm lower, sloping up over 68 mm;
  // its bottom corner cut 20 × 14 mm) out to the joint, then the amber indicator, the
  // unit's outer quarter, to the corner at the wing's edge and a little round it [P
  // owner's front photo: lamps from 0.41 to 0.97 of the half width, the indicator the
  // outer 25 %].
  cornerLamps: [
    {
      points: [
        { x: 0.3, y: [0.66, 0.72], role: 'head' },
        { x: 0.32, y: [0.645, 0.735], role: 'head' },
        { x: 0.368, y: [0.645, 0.772], role: 'head' },
        { x: [0.65, 0.68], y: [0.645, 0.772], role: 'blinker' },
        { y: [0.645, 0.772], role: 'blinker' },
        { s: 0.11, y: [0.655, 0.76], role: 'blinker' },
        { s: 0.125, y: [0.67, 0.745] },
      ],
    },
    // Tail lamps on the body's corners, from just outside the lid's edge (0.575) out and
    // round onto the wing, 0.11 forward along it [P p19: 40 px at 2.78 mm/px from the
    // hubs]: the amber indicator the outer cell (0.09 on the face, then the wrap); inside
    // it the tail lamp over the stop lamp [P p12, p13]. Heights: the bumper's top + 0.01 up
    // to the tail's belt (0.611–0.75), so the lens stays on the flat side and face and the
    // corner's shoulder above it is a straight cut.
    {
      end: 'rear',
      points: [
        { x: 0.69, y: [0.611, 0.75], role: 'blinker' },
        { y: [0.611, 0.75], role: 'blinker' },
        { s: 4.085, y: [0.611, 0.75] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: 0.585, y: [0.68, 0.75], role: 'tail' },
        { x: 0.69, y: [0.68, 0.75] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: 0.585, y: [0.611, 0.68], role: 'brake' },
        { x: 0.69, y: [0.611, 0.68] },
      ],
    },
  ],
  front: {
    // A band under the lamps, flush with the body, 0.27 deep from just below them [owner's
    // front photo: 75 px at 3.59 mm/px from the plate]: its top grows out of the face, its
    // sides lie on the wings back to the front arch (0.47), its grey band runs on as the
    // door mouldings, and below it a dark intake strip over a short apron.
    bumper: { kind: 'moulded', drop: 0, height: 0.27, finish: 'paint', moulding: { y: 0.505, height: 0.09, finish: 'grey' }, wrapTo: 0.45, flush: true },
    items: [
      // The slot under the bonnet's lip, between the lamps' inner ends, with a bright bar.
      {
        kind: 'grille',
        x: { centre: 0.285 },
        y: { from: ['deck', -0.095], to: ['deck', -0.07] },
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'alloy', margin: 0, width: 0.008, depth: 0.01, proud: 0.022 },
      },
      // Rectangular fog lamps in black housings low at the bumper's corners [P owner's 3/4
      // photo]; never lit (no fog-lamp channel), so the lens is a bright unlit finish. Moved
      // 15 mm inboard to stay on the bumper's flat face, which turns into its corner chamfer at 0.676.
      { kind: 'panel', x: { from: { centre: 0.505 }, to: { centre: 0.675 } }, y: { from: ['bumperBottom', 0.02], to: ['bumperBottom', 0.1] }, finish: 'black', proud: 0.047 },
      { kind: 'panel', x: { from: { centre: 0.535 }, to: { centre: 0.645 } }, y: { from: ['bumperBottom', 0.03], to: ['bumperBottom', 0.09] }, finish: 'chrome', proud: 0.05 },
      // The dark recessed intake strip between them, under the band [owner's front photo:
      // 0.18–0.22 below the bumper's top]. It stands 2 mm ahead of the band's front, which
      // reaches it on the centre line, so the two are not in one plane.
      {
        kind: 'grille',
        x: { centre: 0.5 },
        y: { from: ['bumperBottom', 0.045], to: ['bumperBottom', 0.09] },
        standOut: 0.029,
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'black', margin: 0, width: 0.012, depth: 0.01, proud: 0.004 },
      },
    ],
  },
  rear: {
    // Flush with the body and its sides on the wings forward to the rear arch (3.65), as
    // the front one runs to its arch [P p19 right side, p13 rear 3/4: the band and the
    // bumper's side run on to the arch's back in the wing's line].
    bumper: { kind: 'moulded', drop: 0.04, height: 0.306, finish: 'paint', moulding: { y: 0.478, height: 0.08, finish: 'grey' }, wrapTo: 3.675, flush: true },
    // The corner lamps are `cornerLamps`, wrapping onto the wings.
    items: [],
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
