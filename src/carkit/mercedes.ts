/**
 * The Mercedes-Benz W124 saloon, first facelift (09.1989–10.1992); the car built is the 230 E
 * (M 102 E 23, the five-speed manual): the chrome grille shell standing out of the face
 * between wide head lamps with the amber indicator their outer quarter, round the corner;
 * tone-of-body bumpers with a black band and a chrome line along its top, continued along
 * the flanks by the side cladding's chrome top edge ("Sacco boards", in the same tone); body-
 * colour door frames, B and C pillars; a fixed quarter glass in the rear door behind a dark
 * bar; ribbed corner tail lamps with the boot lid down between them; body-colour mirrors,
 * chrome handles; one windscreen wiper. Numbers and sources in measurements-w124.md.
 *
 * Measured on the-blueprints.com's vector preview `w124_tbp_3490.jpg` (drawing 3490,
 * "Mercedes-Benz E-Class (Model 124) (1992)", 1280 × 905; dimension lines 4755 / 2799 /
 * 1430), side view facing left and plan: lengths 5.806 mm/px from the drawn tips (x 24 /
 * 843), `s = (x − 24) × 0.005806`; heights 5.837 mm/px from the ground (y 330) up the 1430
 * line (y 85), `y = (330 − py) × 0.005837`. The drawn hubs (x 163.5 / 649) stand 2820 apart
 * against the factory 2800: the wheels go on the factory wheelbase centred on the drawn
 * pair. Front and rear views from the-blueprints.com raster `w124_tbp_6190.gif` [D2],
 * 10.0 mm/px across (the body x 520–694 for 1740, centre x 607), 10.1 up (ground y 149, roof
 * y 8 for 1428). The face, the bumpers' bands and the cladding's line are read on the
 * Commons photos (measurements-w124.md §3).
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * Mercedes-Benz W124 230 E saloon: overhangs 0.815 / 1.125 over a 2800 wheelbase [F; D the
 * drawn hubs]. The face at s 0.06 behind the bumper (reach 0.06 [D x 21 / 31]); the
 * bonnet rising from its lip 0.78 to 0.986 at the cowl (s 1.341); the A pillar to the rail
 * at 1.893; the roof 1.43 from 2.47 to 3.17, falling into the back light from 3.48 to its
 * foot at 3.96 (1.015); the boot deck up to 1.055 at the lid's front edge and nearly level
 * to the tail (1.02), the lid down the tail face between the corner lamps. Sill 0.19, door
 * bottoms 0.22, belt 0.922 along the doors rising to 0.95 at the C pillar.
 */
export const BODY_W124: KitBody = {
  length: 4.74, // [F MB archive 4740; the drawing's 4755]
  platform: 'classic', // rear drive, the engine lengthwise (MB archive)
  stations: [
    // The face [D side x 31–40: upright to 0.57, the lip at 0.78; D2 front: the lamps
    // 0.555–0.75 out to ±0.77, the body ±0.80 at their height]; the plan's corners rounded
    // (r ≈ 0.2 [D plan]) by the next station's width.
    { s: 0.06, sill: 0.3, crease: 0.56, belt: 0.765, deck: 0.785, wSill: 0.79, wCrease: 0.8, wBelt: 0.785 },
    // The bonnet's line [D side: 0.846 at s 0.15, 0.876 at 0.33, 0.899 at 0.5, 0.916 at
    // 0.615, 0.928 at 0.76, 0.951 at 0.96, 0.975 at 1.14, 0.986 at the cowl]; the wing's top
    // just under it; the flank ±0.87 [F 1740], ±0.835 just under the belt [D2 front: the
    // outline at 0.85–0.87].
    { s: 0.22, sill: 0.29, crease: 0.565, belt: 0.83, deck: 0.855, wSill: 0.84, wCrease: 0.86, wBelt: 0.825 },
    { s: 0.5, sill: 0.28, crease: 0.58, belt: 0.875, deck: 0.9, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    { s: 0.96, sill: 0.19, crease: 0.59, belt: 0.915, deck: 0.951, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    // The cowl [D side (255, 161)].
    { s: 1.341, sill: 0.19, crease: 0.6, belt: 0.922, deck: 0.986, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    // The belt under the side glass [D side y 172: 0.922 along the doors; 0.946 at the rear
    // door's rear edge (x 636)]: straight from the B pillar to the rear door's edge, so no
    // station between. The sill 0.19 [D side y 297], arch to arch.
    { s: 2.5, sill: 0.19, crease: 0.6, belt: 0.925, deck: 0.94, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    { s: 3.555, sill: 0.19, crease: 0.6, belt: 0.946, deck: 0.971, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    // rearBase: the back light's foot (x 706, 1.015) [D side]; the sill behind the rear arch
    // up to the bumper's foot.
    { s: 3.96, sill: 0.26, crease: 0.6, belt: 0.985, deck: 1.015, wSill: 0.85, wCrease: 0.87, wBelt: 0.83 },
    // The boot deck: up from the back light's foot to the lid's front edge, then nearly
    // level, falling 3.5 cm straight to a crisp corner over the tail [D side: 1.016 at s
    // 3.98, 1.056 at 4.10–4.13, 1.045 at 4.30, 1.033 at 4.45, 1.016 at 4.59, 1.004 at 4.68;
    // P S: 1.066 at 4.10 to 1.038 at 4.67, level]; no hump (owner, 2026-10-27). The
    // tail's corners rounding in [D2 rear: ±0.86 at the bumper, ±0.84 at the belt]. The
    // wing's top edge (the belt row) rises with the lid, so the deck keeps one crown across
    // (1.5 cm) from the lid's front edge to the tail.
    { s: 4.08, sill: 0.27, crease: 0.6, belt: 1.02, deck: 1.055, wSill: 0.85, wCrease: 0.87, wBelt: 0.83 },
    { s: 4.68, sill: 0.34, crease: 0.6, belt: 0.985, deck: 1.02, wSill: 0.805, wCrease: 0.82, wBelt: 0.782 },
    // The tail face [D side x 828–835: upright from the deck's edge 0.99 at s 4.70]: the
    // lid's rear panel above the lamps (0.858 [D side y 183]) across, and down between them
    // to their foot (0.655 [P R: the lid's foot just under the lamps']), cut at ±0.42 (the
    // lamps' inner edges ±0.43 at their foot [D2 rear]).
    { s: 4.7, sill: 0.35, crease: 0.6, belt: 0.86, deck: 0.655, notch: 0.42, wSill: 0.79, wCrease: 0.8, wBelt: 0.775 },
  ],
  // The side glass's foot ±0.765 over the skin's ±0.835 [D2 front: the glass ±0.735 at 1.05,
  // ±0.61 at the rail].
  shoulder: { inset: 0.07, rise: 0.02 },
  // The face rakes back above the bumper, the lamps and grille with it [D side: the face x 31
  // at 0.57, the lip x 40 at 0.78: 0.05 back over 0.21].
  frontLean: { base: 0.56, lean: 0.2, blend: 0.3, full: 0.24 },
  cabin: {
    // Door frames, B and C pillars body colour, the glass in thin black seals [P F34, R34,
    // INT]; the bar before the rear door's quarter glass dark.
    columns: [
      // The screen's side from the cowl (1.341, 0.986) to the rail at 1.893 [D side (255, 158)
      // → (350, 95)].
      { s: 1.341, top: 1.893, upper: 'body' },
      // The front door's frame up the thin A pillar, its glass right behind it.
      { s: 1.4, top: 1.925, upper: 'door1', lower: 'body' },
      { s: 1.42, top: 1.94, upper: 'door1', lower: 'body', glass: 'drop' },
      // Its shut line below the belt [D side x 267–281: 1.42 at the belt to 1.49 at 0.35].
      { s: 1.45, top: 1.96, upper: 'door1', glass: 'drop' },
      // The B pillar [D side: the front glass's dark rear channel 2.44–2.51, the rear glass
      // from 2.616; the shut line between the doors x 457–464, 2.51–2.55].
      { s: 2.45, top: 2.5, upper: 'door1' },
      { s: 2.5, top: 2.54, upper: 'body', lower: 'door1' },
      { s: 2.53, top: 2.56, upper: 'body', lower: 'door2' },
      { s: 2.58, top: 2.6, upper: 'door2' },
      { s: 2.615, top: 2.62, upper: 'door2', glass: 'drop' },
      // The bar between the drop glass and the fixed quarter [D side x 560–573: 3.12–3.19].
      { s: 3.11, top: 3.12, upper: 'door2', finish: 'black' },
      { s: 3.15, top: 3.17, upper: 'door2', glass: 'fixed' },
      // The quarter's rear edge slanting down to the belt [D side: 3.246 at 1.226, 3.365 at
      // 1.109, 3.527 at 0.99], the door's frame behind it.
      { s: 3.53, top: 3.19, upper: 'door2' },
      // The rear door's rear edge [D side x 636 from the belt down to 0.85, then forward round
      // the rear arch's front to the sill], kept 2 cm ahead of the arch (3.228). Bent at the
      // fuel flap's two rows (0.92, 0.80) instead of rounded, and sharp at its foot: within
      // 12 mm of the drawn line, and every point of it is a side row along the whole car (a
      // 4-segment round cost 356 triangles, the foot's 3 cm one 112).
      { s: 3.555, top: 3.21, upper: 'body', foot: { y: 0.92, s: 3.21, knee: [3.535, 0.8] } },
      // The C pillar, body colour, to the back light's foot; the roof runs back over the back
      // light's top to 3.56 at 1.354 [D side x 635], where it ends in a small lip.
      { s: 3.96, top: 3.56 },
    ],
    // The side glass's top level along both doors [D side y 100: 1.343] under its 2 cm rubber.
    rail: 1.36,
    railHalf: 0.6, // [D2 front: the outline ±0.61–0.62 at 1.33–1.37]
    crown: 0.05, // roof 1.43 [F 1428; D 1.43] = rail + rise + crown
    // Level across, rounded down at its edges [D2 front: 1.414 at ±0.54, 1.374 at ±0.61].
    crownPower: 4,
    railInset: 0.04,
    railRise: 0.02,
    // The roof's line [D side: 1.378 at s 1.92, 1.395 at 2.01, 1.407 at 2.1, 1.418 at 2.21,
    // 1.424 at 2.33, 1.43 from 2.47 to 3.17, 1.418 at 3.26, 1.407 at 3.34, 1.389 at 3.43,
    // 1.372 at 3.49, 1.354 at 3.55]; at the front less, the side glass's top staying level
    // under it. Three points each end: within 4 mm of the drawn line (every point is a bend
    // in the roof and the side strips).
    roofDrop: [[1.893, 0.03], [2.15, 0.0085], [2.47, 0], [3.17, 0], [3.35, 0.024], [3.56, 0.078]],
    glassBottom: 0.01,
    glassTop: 0.02,
    screenBottom: 0.03, // [E]
    screenHeader: 0.045, // [E]
    // One long blade on the driver's spindle [P F34, F34r: parked along the screen's foot
    // over about half its width, ≈ 0.6], at the longest whose upright sweep stays on the
    // glass without the real one's lifting arm (`buildWipers`) [E].
    wiperBlade: 0.5,
    wipers: 1,
    rearBottom: 0.025, // [E]
    rearHeader: 0.045, // [E]
    pillar: 0.07, // [E]
  },
  wheels: {
    // Overhangs 0.815 / 1.125 [angurten.de 'Baureihe 124 Limousine': 815 + 2800 + 1125 =
    // 4740; D the drawn hubs 0.81 / 1.125].
    front: 0.815,
    rear: 3.615, // wheelbase 2800 [F]
    radius: 0.317, // 195/65 R15 [F]: 190.5 + 126.75
    width: 0.195, // [F]
    frontHalfTrack: 0.7505, // 1501 [F]
    rearHalfTrack: 0.7455, // 1491 [F]
    // Front: close round the tyre's sides, clear over its top: a half ellipse 0.343 wide at
    // the hub's height and 0.371 high [P S, the near (rear) edge: ±0.35 at the hub,
    // 0.33 at 0.10 over it, 0.29 at 0.20, 0.21 at 0.30, top 0.371; D side: top 0.366].
    arch: 1.08,
    frontArchRise: 1.17,
    // Rear: a circle, top 0.387 over the hub [D side: 0.383; P S: 0.39–0.40, the near
    // (front) edge 0.39 at the hub, 0.36 at 0.10, 0.315 at 0.20, 0.26 at 0.30].
    rearArch: 1.22,
    // 8 segments round each arch (12 by default): the triangle budget (owner, 2026-10-27).
    archSegments: 8,
  },
  doorBottom: 0.21, // [D side y 292–295: 0.204–0.222]
  bonnetFront: 0.06,
  // The bonnet covers the whole top, its side shut lines along the wings' top, cut round the
  // grille shell [P F34, F34r].
  bonnet: { inset: 0.01 },
  // On the right rear wing behind the rear door, under the belt [P R34].
  flap: { s0: 3.64, s1: 3.8, y0: 0.8, y1: 0.92, side: 'right' },
  bootEnd: 4.7,
};

/**
 * The W124 230 E, 1989–92 [P F34, F34r, R34, R34r, R; inventory measurements-w124.md §4]. The
 * bumpers and the cladding in a tone of the body colour (`tone`), their black band and the
 * cladding's top edged in chrome at one height, 0.47–0.48, nose to tail [P: the front bumper's
 * line 0.48, the rear's 0.50, the doors' 0.44–0.46].
 */
export const LOOK_W124: KitLook = {
  label: 'Mercedes-Benz W124',
  // Blue cloth and a dark blue dash, as the dash photo the cabin is measured on [P DASH; INT
  // shows a beige car: the W124 came in several trims].
  upholstery: 0x435b7e,
  dash: 0x2f3a52,
  headrests: true,
  brightwork: 'chrome', // the handles [P F34, R34]
  // Body colour on the 1989 facelift (Wikipedia "1989: First facelift") [P F34, F34r, R34].
  mirrorFinish: 'paint',
  // The cladding's and bumpers' tone [P F34r: the red car's cladding about 0.6 of the door's
  // red; F34: the white car's no darker under the sky's reflection on the door]: 0.78 [E].
  tone: 0.78,
  sill: null,
  // At the front door glass's foot [D side: the head x 300–320, s 1.60–1.72, y 0.93–1.03],
  // close in over the shoulder [D2 front: the head ±0.77–0.91, 0.89–1.01].
  mirrorS: 1.66,
  mirrorReach: 0.04,
  mirrorHeightOffset: -0.02,
  // [D side: front x 380–400 at y 190, rear x 580–620 at y 186–190]
  handles: { front: 2.12, rear: 3.35, y: 0.82, half: 0.065 },
  waist: null,
  // Axle to axle (the arches cut it): the front wing behind its arch, both doors [P].
  cladding: { top: 0.47, finish: 'tone', span: [0.815, 3.615], edge: { finish: 'chrome', height: 0.01 } },
  repeater: null, // the indicator wraps round instead (1989–93) [P]
  cornerLamps: [
    // Head lamp and indicator, one flat glass 0.57–0.76 [D side y 200–233; D2 front
    // 0.555–0.75 from ±0.36 out to ±0.77]: the amber indicator its outer quarter from ±0.68,
    // wrapping round the corner onto the wing [P F34, F34r; D side: the unit to x 82]. Fluted
    // glass [P F: fine flutes on the head lamp and the indicator] as dark lines (owner,
    // 2026-10-27: "тёмные полосы в качестве ребристости это ок").
    {
      ribs: 3,
      points: [
        { x: 0.37, y: [0.57, 0.755], role: 'head' },
        { x: 0.68, y: [0.57, 0.755], role: 'blinker' },
        { y: [0.575, 0.755], role: 'blinker' },
        { s: 0.2, y: [0.59, 0.75] },
      ],
    },
    // Tail lamps 0.665–0.855 [D side y 183–216; D2 rear 0.64–0.83], their inner edges leaning
    // (±0.43 at the foot, ±0.60 at the top [D2 rear]), wrapping round onto the wings to s
    // 4.52 [D side x 800]. Top band the reversing lamp inside and the amber indicator
    // outside, the red tail and brake lamp below [P R, R34], all ribbed [P R34].
    {
      end: 'rear',
      ribs: 2,
      points: [
        { x: [0.545, 0.595], y: [0.8, 0.855], role: 'reverse' },
        { x: 0.645, y: [0.8, 0.855], role: 'blinker' },
        { y: [0.8, 0.855], role: 'blinker' },
        { s: 4.53, y: [0.805, 0.85] },
      ],
    },
    {
      end: 'rear',
      ribs: 5,
      points: [
        { x: [0.435, 0.54], y: [0.665, 0.794], role: 'brake' },
        { x: 0.62, y: [0.665, 0.794], role: 'tail' },
        { y: [0.665, 0.794], role: 'tail' },
        { s: 4.52, y: [0.67, 0.794] },
      ],
    },
  ],
  front: {
    // Tone of body colour 0.222–0.537 [D side x 21: the bar's face 0.40–0.537, the apron to
    // 0.222], a black band 0.35–0.47 with the chrome line over it [P F34 bumper: the line
    // 21 % down the bumper, the band's foot 62 %]; its sides back along the wings to the
    // front arch [D side x 105], the corners rounded [D plan r ≈ 0.2].
    bumper: { kind: 'moulded', drop: 0.113, height: 0.315, finish: 'tone', moulding: { y: 0.41, height: 0.12, finish: 'black', edge: { finish: 'chrome', height: 0.01 } }, corner: 0.2, wrapTo: 0.47 },
    items: [
      // The chrome shell standing out of the face between the lamps, 0.52–0.79 at ±0.33 with
      // its frame [D2 front], horizontal chrome slats on a dark back [P F34, F34r].
      {
        kind: 'grille',
        x: { centre: 0.305 },
        // Its frame's top 1 cm under the bonnet's lip and its foot 2 cm over the bumper's top
        // (at 3 and 5 mm they fought from afar).
        y: { from: ['bumperTop', 0.045], to: ['deck', -0.035] },
        // Its back's front 3.4 cm out of the face, the slats' 4.6 [D side: the shell x 31–38
        // ahead of the lamps' face at the bumper].
        standOut: 0.01,
        frame: { finish: 'chrome', margin: 0.025 },
        back: true,
        // The slats 12 mm proud of the back's front (so + 0.024; at the 2107's 2 mm, and at
        // 6 mm, they fought it from afar), rooted 2 mm in it.
        bars: { dir: 'horizontal', count: 7, finish: 'chrome', margin: 0.015, width: 0.008, depth: 0.014, proud: 0.036 },
      },
      // And its one vertical chrome bar down the middle [P F34], its front 1 cm ahead of the
      // slats' (standOut 0.01 + 0.036).
      { kind: 'panel', x: { centre: 0.008 }, y: { from: ['bumperTop', 0.06], to: ['deck', -0.05] }, finish: 'chrome', proud: 0.056 },
    ],
  },
  rear: {
    // Tone of body colour 0.25–0.584 [D side x 790–843], the black band 0.335–0.47 under the
    // chrome line [P R: the line a quarter down the bumper, the band below to its foot];
    // forward along the wings to the rear arch [D side x 715].
    bumper: { kind: 'moulded', drop: 0.135, height: 0.334, finish: 'tone', moulding: { y: 0.4025, height: 0.135, finish: 'black', edge: { finish: 'chrome', height: 0.01 } }, corner: 0.15, wrapTo: 4.02 },
    items: [],
  },
};
