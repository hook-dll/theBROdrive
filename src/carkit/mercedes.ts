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
 * foot at 3.96 (1.035); the boot deck one plane from there to its rear edge chamfered down
 * to an upright face from 0.92, the lid down the tail face between the corner lamps, the
 * wings' tops rounding over into it. Sill 0.19, door bottoms 0.22, belt 0.922 along the
 * doors rising to 0.95 at the C pillar.
 */
export const BODY_W124: KitBody = {
  length: 4.74, // [F MB archive 4740; the drawing's 4755]
  platform: 'classic', // rear drive, the engine lengthwise (MB archive)
  stations: [
    // The face: its foot 0.12 behind the bumper's front, raking back over the lamps to the
    // lip, the grille 4.6 cm ahead of it [P carsized side, registered on the hubs: the nose's
    // outline 0.09 behind the bumper's front at 0.60, 0.14 at 0.70, 0.18 at 0.80; D side x
    // 31–40 has the face upright to 0.57 0.06 behind, the lip at 0.78; D2 front: the lamps
    // 0.555–0.75 out to ±0.77, the body ±0.80 at their height]. The owner, 2026-10-27: the
    // nose over the bumper read long. The plan's corners rounded by the next station's width.
    { s: 0.12, sill: 0.3, crease: 0.56, belt: 0.765, deck: 0.785, wSill: 0.79, wCrease: 0.8, wBelt: 0.785 },
    // The bonnet's line [D side: 0.846 at s 0.15, 0.876 at 0.33, 0.899 at 0.5, 0.916 at
    // 0.615, 0.928 at 0.76, 0.951 at 0.96, 0.975 at 1.14, 0.986 at the cowl]; the wing's top
    // just under it; the flank ±0.87 [F 1740], ±0.835 just under the belt [D2 front: the
    // outline at 0.85–0.87]. The lean (`frontLean`) takes this station's deck back to s
    // 0.36, just under the drawn line (0.876 at 0.33: at 0.882 the bonnet dented at s 0.5).
    { s: 0.25, sill: 0.29, crease: 0.565, belt: 0.83, deck: 0.87, wSill: 0.84, wCrease: 0.86, wBelt: 0.825 },
    { s: 0.5, sill: 0.28, crease: 0.58, belt: 0.875, deck: 0.9, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    { s: 0.96, sill: 0.19, crease: 0.59, belt: 0.915, deck: 0.951, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    // The cowl [D side (255, 161)].
    { s: 1.341, sill: 0.19, crease: 0.6, belt: 0.922, deck: 0.986, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    // The belt under the side glass [D side y 172: 0.922 along the doors; 0.946 at the rear
    // door's rear edge (x 636)]: straight from the B pillar to the rear door's edge, so no
    // station between. The sill 0.19 [D side y 297], arch to arch.
    { s: 2.5, sill: 0.19, crease: 0.6, belt: 0.925, deck: 0.94, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    { s: 3.555, sill: 0.19, crease: 0.6, belt: 0.946, deck: 0.971, wSill: 0.85, wCrease: 0.87, wBelt: 0.835 },
    // rearBase: the back light's foot [D side (706, 156): 1.015; built 1.035, so the deck runs
    // straight from it without a ridge]; the sill behind the rear arch up to the bumper's foot.
    // From here back the wing's top rounds over into the boot lid instead of a sharp belt
    // under a flat ledge: the belt lower and further in, the shoulder (`shoulder`) a steep
    // turn up to the deck's edge, which stays where the cabin's was (the C pillar's foot,
    // ±0.755 at 1.005). The rear view's outline [P carsized rear, 340 px/m across, heights on
    // the lamps (D): ±0.82 at 0.874, ±0.815 at 0.906, ±0.809 at 0.937, ±0.80 at 0.968, ±0.785
    // at 1.0, ±0.765 at 1.031]; it was ±0.83–0.84 up to 0.985, then in by 7.5 cm in 2 cm: a
    // square shoulder (owner, 2026-10-28: «слишком угловатый очень тяжелый зад»).
    { s: 3.96, sill: 0.26, crease: 0.6, belt: 0.93, deck: 1.035, wSill: 0.85, wCrease: 0.87, wBelt: 0.835, shoulder: { inset: 0.08, rise: 0.075 } },
    // The boot deck: one plane from the back light's foot to the lid's rear edge, falling 2
    // cm [D side: 1.056 at 4.10 to 1.004 at 4.68; P S: 1.066 at 4.10 to 1.038 at 4.67; D2
    // side: level]: the stations between lie on it, so no ridge across at the lid's front
    // edge and no hump (owner, 2026-10-27: «что это за конструкция?»). In plan the tail
    // narrows straight from the back light's foot [D plan, 5.806 mm/px: ±0.868 at s 3.93,
    // ±0.851 at 4.04, ±0.813 at 4.27, ±0.793 at 4.45, ±0.769 at 4.62, ±0.752 at 4.68, ±0.717
    // at 4.71]: the sill and crease rows on the line from ±0.87 here to ±0.755 at 4.68 (owner,
    // 2026-10-27: «вряд ли корма мерседеса должна иметь такие углы»).
    // The wing's rounded top falls 6 cm to the tail and comes in over the lamps: from behind
    // the tail's top corners a quarter round from the lamps' outer top to the lid, not a
    // square ear [P owner_rear, at the tail, 260 px/m on the lamps' height: the outline ±0.75
    // at 0.885, ±0.73 at 0.925, ±0.69 at 0.965, ±0.645 at 0.995; P carsized side: the wing's
    // top down round the corner to the lamp]. The lid's rear edge in one chamfer, 4.64 → 4.70
    // [D side: rounded from s 4.656 at 1.012 to the upright face at 4.697, 0.922].
    { s: 4.45, sill: 0.314, crease: 0.6, belt: 0.905, deck: 1.0214, wSill: 0.775, wCrease: 0.792, wBelt: 0.76, shoulder: { inset: 0.06, rise: 0.08 } },
    { s: 4.64, sill: 0.336, crease: 0.6, belt: 0.9, deck: 1.0162, wSill: 0.746, wCrease: 0.761, wBelt: 0.73, shoulder: { inset: 0.07, rise: 0.075 } },
    { s: 4.68, sill: 0.34, crease: 0.6, belt: 0.9, deck: 0.99, wSill: 0.74, wCrease: 0.755, wBelt: 0.725, shoulder: { inset: 0.085, rise: 0.06 } },
    // The tail face [D side x 828–835: upright from 0.922 at s 4.697]: the lid's rear panel
    // from there (the corners' top: belt + the shoulder's rise) down past the lamps' top
    // (0.846 [D side y 185]) across, and down between them to their foot (0.655 [P R: the
    // lid's foot just under the lamps']), its sides along the lamps' leaning inner edges [P
    // carsized rear, 340 px/m across: the lamps ±0.472 at their foot to ±0.582 at their top,
    // the lid's foot ±0.456]: cut at ±0.572 at the top, in by 0.112 to ±0.46 at the foot
    // (`notchWall`).
    { s: 4.7, sill: 0.35, crease: 0.6, belt: 0.9, deck: 0.655, notch: 0.572, notchWall: 0.112, wSill: 0.7, wCrease: 0.715, wBelt: 0.68 },
  ],
  // The side glass's foot ±0.765 over the skin's ±0.835 [D2 front: the glass ±0.735 at 1.05,
  // ±0.61 at the rail].
  shoulder: { inset: 0.07, rise: 0.02 },
  // The face rakes back above the bumper, the lamps and grille with it [P carsized side: 0.09
  // back over the 0.2 from 0.60 to 0.80; D side: 0.05 over 0.21].
  frontLean: { base: 0.56, lean: 0.35, blend: 0.3, full: 0.26 },
  cabin: {
    // Door frames, B and C pillars body colour, the glass in thin black seals [P F34, R34,
    // INT]; the bar before the rear door's quarter glass bright.
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
      // The bright bar between the drop glass and the fixed quarter, upright [P carsized side:
      // chrome 3.105–3.14 from the belt to the rail; D side x 560–573: 3.12–3.19].
      { s: 3.105, top: 3.105, upper: 'door2', finish: 'chrome' },
      { s: 3.14, top: 3.14, upper: 'door2', glass: 'fixed' },
      // The quarter's rear edge slanting down to the belt, the door's frame behind it [P
      // carsized side: the glass's rear edge 3.19 at 1.24, 3.34 at 1.11, 3.45 at 0.99 (heights
      // ×1.034, the photo's roof 1.384); D side: 3.246 at 1.226, 3.365 at 1.109, 3.527 at 0.99]:
      // between the two, 3 cm ahead of the drawing at the belt.
      { s: 3.5, top: 3.17, upper: 'door2' },
      // The rear door's rear edge [D side x 636 from the belt down to 0.85, then forward round
      // the rear arch's front to the sill], kept 2 cm ahead of the arch (3.228). Bent at the
      // fuel flap's two rows (0.92, 0.80) instead of rounded, and sharp at its foot: within
      // 12 mm of the drawn line, and every point of it is a side row along the whole car (a
      // 4-segment round cost 356 triangles, the foot's 3 cm one 112).
      { s: 3.555, top: 3.21, upper: 'body', foot: { y: 0.92, s: 3.21, knee: [3.535, 0.8] } },
      // The C pillar, body colour, to the back light's foot; the roof runs back over the back
      // light's top to 3.56 at 1.354 [D side x 635]. The glass's top corners rounded [P
      // carsized rear, R34: r ≈ 0.08 at the roof's corners]: the corner cut in one convex
      // chamfer (`cornerDrop`) (owner, 2026-10-27: «линии остекления заднего окна»).
      { s: 3.96, top: 3.56, cornerDrop: 0.035 },
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
    // The back light in a thin seal, the C pillars beside it 3–5 cm from behind [P carsized
    // rear: the glass ±0.50 at its top under the roof's ±0.53, ±0.65 at its foot].
    rearBottom: 0.02,
    rearHeader: 0.025,
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
    // Front: close round the tyre's sides and top: a half ellipse 0.33 wide at the hub's
    // height and 0.349 high, 1.3 cm off the tyre at its sides and 3.2 over it (owner,
    // 2026-10-27, on the lab: «сравни расположение колеса с фото»: the black of the 0.343 ×
    // 0.371 opening read as a small tyre set back in a big hole). [P S, the near (rear)
    // edge: ±0.34–0.35 at the hub, 0.36 at 45°, 0.37–0.38 at the top: the lip's lit edge;
    // D side: top 0.366].
    arch: 1.04,
    frontArchRise: 1.1,
    // Rear: a circle, top 0.387 over the hub [D side: 0.383; P S: 0.39–0.40, the near
    // (front) edge 0.39 at the hub, 0.36 at 0.10, 0.315 at 0.20, 0.26 at 0.30].
    rearArch: 1.22,
    // 8 segments round each arch (12 by default): the triangle budget (owner, 2026-10-27).
    archSegments: 8,
  },
  doorBottom: 0.21, // [D side y 292–295: 0.204–0.222]
  bonnetFront: 0.12,
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
  // Long chrome pull bars at each door's rear edge under the belt, the pull lever's bright
  // lip under them over a black recess [P carsized side, on the hubs: the front bar s
  // 2.29–2.51, its lever 2.33–2.45, 4.7 cm under the bar; the rear bar 3.23–3.46, its lever
  // 3.28–3.38; the bars 0.78–0.80 high (0.81–0.83 with the photo's heights ×1.034); F34,
  // side.jpg]. The owner, 2026-10-27: the front one stood in the door's middle (s 2.12).
  handles: { front: 2.4, rear: 3.345, y: 0.82, half: 0.112, grip: { half: 0.055, drop: 0.046 } },
  waist: null,
  // Axle to axle (the arches cut it): the front wing behind its arch, both doors [P].
  cladding: { top: 0.47, finish: 'tone', span: [0.815, 3.615], edge: { finish: 'chrome', height: 0.01 } },
  repeater: null, // the indicator wraps round instead (1989–93) [P]
  cornerLamps: [
    // Head lamp and indicator, one flat glass 0.57–0.76 [D side y 200–233; D2 front
    // 0.555–0.75 from ±0.36 out to ±0.77]: the amber indicator its outer quarter from ±0.68,
    // wrapping round the corner onto the wing [P F34, F34r; D side: the unit to x 82].
    // Smooth glass [P carsized front, F34]: only the tail lamps are fluted (owner,
    // 2026-10-27: «посмотри, какие из фар ребристые»).
    {
      points: [
        { x: 0.37, y: [0.57, 0.755], role: 'head' },
        { x: 0.68, y: [0.57, 0.755], role: 'blinker' },
        { y: [0.575, 0.755], role: 'blinker' },
        { s: 0.2, y: [0.59, 0.75] },
      ],
    },
    // Tail lamps 0.665–0.855 [D side y 183–216; D2 rear 0.64–0.83], their inner edges leaning
    // along the lid's cut, 8–11 mm clear of it [P carsized rear: ±0.472 at the foot to ±0.582
    // at the top], wrapping round onto the wings to s 4.52 [D side x 800]. Top band the
    // reversing lamp inside and the amber indicator outside from ±0.64 (±0.69 on the rear
    // view, where the corner's rounding starts: the tail face now ends at ±0.68), the red
    // tail and brake lamp below split at ±0.62 [P R, R34, carsized rear: the bands 44 % / 56 %
    // of the lamp's height]; fluted at about 3 cm [P carsized rear, R34].
    {
      end: 'rear',
      ribs: 2,
      points: [
        { x: [0.535, 0.58], y: [0.774, 0.855], role: 'reverse' },
        { x: 0.64, y: [0.774, 0.855], role: 'blinker' },
        { y: [0.774, 0.855], role: 'blinker' },
        { s: 4.53, y: [0.779, 0.85] },
      ],
    },
    {
      end: 'rear',
      ribs: 3,
      points: [
        { x: [0.474, 0.531], y: [0.665, 0.768], role: 'brake' },
        { x: 0.62, y: [0.665, 0.768], role: 'tail' },
        { y: [0.665, 0.768], role: 'tail' },
        { s: 4.52, y: [0.67, 0.768] },
      ],
    },
  ],
  front: {
    // Tone of body colour 0.222–0.537 [D side x 21: the bar's face 0.40–0.537, the apron to
    // 0.222], a black band 0.35–0.47 with the chrome line over it [P F34 bumper: the line
    // 21 % down the bumper, the band's foot 62 %]; under the band the apron drawn back 8 cm
    // to its foot [P carsized side: 0.03 back at 0.40, 0.07 at 0.35, 0.10 at 0.30; D side x
    // 27–35 under the bar]; its sides back along the wings to the front arch [D side x 105],
    // the corners rounded [D plan r ≈ 0.2].
    bumper: { kind: 'moulded', drop: 0.113, height: 0.315, finish: 'tone', moulding: { y: 0.41, height: 0.12, finish: 'black', edge: { finish: 'chrome', height: 0.01 } }, corner: 0.2, wrapTo: 0.47, foot: { y: 0.35, back: 0.08 } },
    items: [
      // The chrome shell between the lamps, ±0.365 with its frame, from the bumper's top to
      // just under the bonnet's lip, which runs over it [P carsized front, 354.6 px/m across:
      // the shell x 182–443; F34; the owner, 2026-10-27: «решетка не должна выступать за
      // капот»], horizontal chrome slats on a dark back [P F34, F34r].
      {
        kind: 'grille',
        x: { centre: 0.34 },
        // The slot from 3.5 cm over the bumper's top to 3.5 cm under the lip, so the frame's
        // top stays 1 cm under it and its foot 1 cm over the bumper's top (at 3 and 5 mm they
        // fought from afar).
        y: { from: ['bumperTop', 0.035], to: ['deck', -0.035] },
        // Its back's front 2.4 cm out of the face, the slats' 3.6 [D side: the shell x 31–38
        // ahead of the lamps' face at the bumper].
        standOut: 0,
        frame: { finish: 'chrome', margin: 0.025 },
        back: true,
        // The slats 12 mm proud of the back's front (so + 0.024; at the 2107's 2 mm, and at
        // 6 mm, they fought it from afar), rooted 2 mm in it.
        bars: { dir: 'horizontal', count: 7, finish: 'chrome', margin: 0.015, width: 0.008, depth: 0.014, proud: 0.036 },
      },
      // And its one vertical chrome bar down the middle [P F34], its front 1 cm ahead of the
      // slats' (0.036).
      { kind: 'panel', x: { centre: 0.008 }, y: { from: ['bumperTop', 0.05], to: ['deck', -0.035] }, finish: 'chrome', proud: 0.046 },
    ],
  },
  rear: {
    // Tone of body colour, its top 0.584 [D side x 790–843: 0.578–0.584, the face upright to
    // 0.339]; the chrome line 3 cm under its top and the black band from there to the face's
    // foot, 0.35–0.54 [P R: the line 10 % down the bumper's face, the band's top 25 %; P
    // owner_rear: the dark band as tall as the lamps; R34, R34r]; under the band turned
    // back to the tail face (as far as the generator draws it back, 4.6 cm) and up to 0.29,
    // so from behind no tone shows under the band [D side: the bottom line 0.25 runs forward
    // under the face; P owner_rear, R: the band is the bumper's foot]; forward along the
    // wings to the rear arch [D side x 715]. Owner, 2026-10-28: the chrome at 0.47 under 10
    // cm of tone, and 8 cm of tone under the band, read as one tall slab («тяжелый зад»).
    bumper: { kind: 'moulded', drop: 0.095, height: 0.294, finish: 'tone', moulding: { y: 0.445, height: 0.19, finish: 'black', edge: { finish: 'chrome', height: 0.01 } }, corner: 0.15, wrapTo: 4.02, foot: { y: 0.34, back: 0.08 } },
    items: [],
    // The boot lid's lip: the upper lid stands over the plate panel, a dark line across the
    // lid at the lamps' top from one lamp's inner corner to the other [P owner_rear, R,
    // carsized rear: the shadow line over the plate from lamp to lamp, at their top].
    lid: [{ kind: 'panel', x: { centre: 0.565 }, y: { from: ['belt', -0.051], to: ['belt', -0.043] }, finish: 'black', proud: 0.003 }],
  },
};
