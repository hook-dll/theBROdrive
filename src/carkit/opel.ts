/**
 * The Opel cars of the 1990s (the foreign kit cars on GM running gear).
 *
 * The Opel Astra F five-door hatchback (T92), facelift of 09.1994–1998, sold in Russia from
 * 08.1994 (drom.ru catalogue); the car built is the 1.6i GL (C16NZ, the F13 five-speed):
 * dark grey plastic bumpers, a black slatted grille in a body-colour surround between the
 * head lamps, the clear indicators at their outer ends, a black panel across the tailgate
 * between the corner lamps. Numbers and sources in measurements-astra.md.
 *
 * Measured on the-blueprints.com's dimensioned vector preview `2001_opel_astra_f_5-door.jpg`
 * (drawing 9603, 1280 × 905; dimension lines 4050 / 2517 / 1696 / 1410), side view facing
 * left: lengths 5.827 mm/px from the drawn tips (x 103 / 798, 4050 on the line 105–801),
 * `s = (x − 103) × 0.005827`; heights 5.887 mm/px from the drawn ground (y 330) to the roof
 * (y 90.5, 1410), `y = (330 − py) × 0.005887`. The drawn hubs (x 236.5 / 675) stand 2555
 * apart at the length scale against the factory 2517: the wheels are put on the factory
 * wheelbase centred on the drawn pair. Front and rear views 5.97 mm/px across from the
 * 1696 dimension (x 913–1197), centre x 1055. The drawing is of the 1991 car: its face (a
 * slim grille slot) and tail (body-colour tailgate panel) are replaced by the facelift's
 * from Commons photos.
 */

import type { KitLook } from './spec';
import type { KitBody } from './specs';

/**
 * Opel Astra F five-door: overhangs 0.797 / 0.736 over a 2517 wheelbase [E: the drawn hubs
 * centred on the factory base]. The face at s 0.10, the bonnet's lip 0.69 rising to 0.93 at
 * the cowl (s 1.13); the A pillar to the rail (1.33) at 1.79; roof 1.41 to s 3.0, falling
 * to the tailgate's top at 3.48; the tailgate's glass down to its knee (s 3.96, 1.02), its
 * panel down between the corner lamps to the bumper. Sill 0.22, door bottoms 0.255, belt
 * 0.895 at the cowl rising to 0.975 under the quarter glass's foot.
 */
export const BODY_ASTRA_F: KitBody = {
  length: 4.05, // [F auto-data 4051; the drawing's 4050]
  platform: 'samara',
  stations: [
    // The face [D plan: the nose rounds hard, ±0.59 at s 0.10, ±0.70 at 0.17, ±0.744 at
    // 0.22, ±0.78 at 0.31, ±0.82 at 0.45, ±0.846 from 0.6: the bumper's outline; the wings
    // over it rounder at the corners and straighter behind, so the rubbing strip's straight
    // runs stay outside them]; the bonnet's lip 0.69 over lamps
    // 0.55–0.665 [D front y 213, 217–235]. The bonnet's centre line [D side: 0.70 at s 0.07,
    // 0.73 at 0.15, 0.77 at 0.27, 0.836 at 0.54, 0.883 at 0.83, 0.924 at 1.12].
    { s: 0.1, sill: 0.3, crease: 0.55, belt: 0.675, deck: 0.69, wSill: 0.6, wCrease: 0.62, wBelt: 0.6 },
    { s: 0.2, sill: 0.3, crease: 0.56, belt: 0.71, deck: 0.735, wSill: 0.675, wCrease: 0.69, wBelt: 0.675 },
    { s: 0.3, sill: 0.29, crease: 0.57, belt: 0.74, deck: 0.767, wSill: 0.74, wCrease: 0.755, wBelt: 0.735 },
    { s: 0.45, sill: 0.28, crease: 0.58, belt: 0.78, deck: 0.81, wSill: 0.78, wCrease: 0.795, wBelt: 0.775 },
    { s: 0.65, sill: 0.27, crease: 0.59, belt: 0.82, deck: 0.855, wSill: 0.815, wCrease: 0.832, wBelt: 0.795 },
    // The cowl [D side (297, 172)]; the flank ±0.836 (the drawing's ±0.848 less the 1.3 %
    // the body came out over the factory 1688 with its arches and bumpers), the shoulder
    // ±0.795 under the glass's foot (±0.79 at 0.93 [D front]).
    { s: 1.13, sill: 0.22, crease: 0.6, belt: 0.895, deck: 0.93, wSill: 0.82, wCrease: 0.836, wBelt: 0.795 },
    // The belt under the side glass rising to the tail [D side: the glass's foot 0.912 at s
    // 1.5, 0.924 at 1.96, 0.955 at 3.1, 0.989 at 3.65]; sill 0.22 between the arches [D side
    // y 293–298].
    { s: 2.3, sill: 0.22, crease: 0.6, belt: 0.913, deck: 0.933, wSill: 0.82, wCrease: 0.836, wBelt: 0.795 },
    { s: 3.215, sill: 0.23, crease: 0.6, belt: 0.945, deck: 0.965, wSill: 0.82, wCrease: 0.836, wBelt: 0.795 },
    { s: 3.653, sill: 0.27, crease: 0.6, belt: 0.975, deck: 0.995, wSill: 0.82, wCrease: 0.834, wBelt: 0.79 },
    // The D pillar's foot: the belt turns down here to the tailgate's foot at the corners'
    // top (as BODY_1111's); the tail rounding in [D plan ±0.83 at 3.85, ±0.79 at 3.92].
    { s: 3.9, sill: 0.31, crease: 0.61, belt: 0.97, deck: 0.99, wSill: 0.8, wCrease: 0.815, wBelt: 0.77 },
    // rearBase: the corner lamps' top (0.905) [D side y 177, rear view 0.927 at its own
    // scale], the corners ±0.79 [D rear: the lamps' outer edge ±0.794].
    { s: 3.985, sill: 0.33, crease: 0.62, belt: 0.905, deck: 0.915, wSill: 0.785, wCrease: 0.795, wBelt: 0.77 },
    // The tail face [D side x 790]: the tailgate comes down between the corner lamps (inner
    // edges ±0.555 [D rear]) to just over the bumper's top (0.65).
    { s: 4.02, sill: 0.33, crease: 0.62, belt: 0.905, deck: 0.665, notch: 0.555, wSill: 0.77, wCrease: 0.78, wBelt: 0.755 },
  ],
  shoulder: { inset: 0.04, rise: 0.015 },
  cabin: {
    // The door frames, the B pillar, the post behind the rear door's glass and the sail
    // under the mirror black [P "Opel Astra (F) GL 5-door, rear right", "Opel Astra F Hatch
    // HL", "1996 Opel Astra 1.6i"]; the A and D pillars painted.
    columns: [
      // The screen's outer line from the cowl (1.13, 0.93) to the rail (1.79, 1.342) [D side
      // (297, 172) → (410, 102)].
      { s: 1.13, top: 1.79, upper: 'body' },
      { s: 1.165, top: 1.825, upper: 'door1', lower: 'body', finish: 'black' },
      // The front door's shut line below the belt [D side x 320]; the mirror's sail from it
      // to the glass's front edge (1.52 at the belt [D side: the mirror x 345–372]).
      { s: 1.264, top: 1.86, upper: 'door1', finish: 'black' },
      { s: 1.52, top: 1.88, upper: 'door1', glass: 'drop', finish: 'black' },
      // The B pillar, black [D side x 490–520: the front glass ends 2.255 at the belt, 2.342
      // at the rail; the shut line 2.284; the rear glass from 2.383 / 2.43].
      { s: 2.255, top: 2.34, upper: 'door1', finish: 'black' },
      { s: 2.27, top: 2.355, upper: 'body', lower: 'door1', finish: 'black' },
      { s: 2.284, top: 2.37, upper: 'body', lower: 'door2', finish: 'black' },
      { s: 2.33, top: 2.4, upper: 'door2', finish: 'black' },
      { s: 2.383, top: 2.43, upper: 'door2', glass: 'drop', finish: 'black' },
      // The rear glass's rear edge [D side: 3.10 at the belt, 3.053 at the rail], the black
      // post behind it to the shut line (3.215), which runs down and forward round the rear
      // arch [D side: upright to 0.69, the arch's top at s 3.05].
      { s: 3.1, top: 3.053, upper: 'door2', finish: 'black' },
      { s: 3.215, top: 3.135, upper: 'body', finish: 'black', foot: { y: 0.69, s: 2.95, round: [0.12, 0.03] } },
      // The fixed quarter glass in the body, nearly a triangle: its front edge the post, its
      // rear edge along the tailgate's line from its foot (3.653) up to the rail [D side].
      { s: 3.228, top: 3.147, upper: 'body', glass: 'fixed', finish: 'black' },
      { s: 3.653, top: 3.17, upper: 'body' },
      // The D pillar to the tailgate.
      { s: 3.9, top: 3.46, upper: 'body' },
      // rearBase; the roof's rear end at the rail 3.48 [D side x 700, the spoiler's foot].
      { s: 3.985, top: 3.48 },
    ],
    rail: 1.33, // the side glass's top 1.325 [D side y 105]
    railHalf: 0.56, // [D front ±0.567 at 1.354]
    crown: 0.06, // roof 1.41 [F] = rail + rise + crown
    railInset: 0.04,
    railRise: 0.02,
    // The roof rounding up from the screen [D side: 1.395 at s 1.84, 1.41 from 2.2], then
    // falling to the tailgate's top [1.40 at 2.9, 1.385 at 3.13, 1.355 at 3.48].
    roofDrop: [[1.79, 0.02], [1.95, 0.008], [2.2, 0], [3.0, 0], [3.2, 0.01], [3.48, 0.03]],
    glassBottom: 0.01,
    glassTop: 0.02,
    screenBottom: 0.03, // [E as the Samaras]
    screenHeader: 0.045, // [E]
    wiperBlade: 0.5, // [E: the tens' 500]
    rearBottom: 0.025, // unused with a knee
    rearHeader: 0.05, // [E]
    // The tailgate's glass ends at 1.02 on the raked line at s 3.96 [D side (785, 157); D
    // rear: its foot ±0.64 at 1.044]; the painted panel below it.
    rearKnee: { s: 3.96, y: 1.02 },
    pillar: 0.07, // [E]
  },
  wheels: {
    front: 0.797, // [E: the drawn hubs 0.778 / 3.333 at the length scale, centred on 2517]
    rear: 3.314, // wheelbase 2517 [F]
    radius: 0.288, // 175/70 R13 [F auto-data]
    width: 0.175, // [F]
    frontHalfTrack: 0.715, // 1430 [F auto-data]
    rearHalfTrack: 0.7145, // 1429 [F]
    // Front: the liner's top 0.659, 0.371 over the hub; ±0.34 at the hub's height [D side].
    arch: 1.25,
    // Rear: ±0.34 at the hub's height, its top 0.606, 0.318 over the hub [D side].
    rearArch: 1.2,
    rearArchRise: 1.1,
  },
  doorBottom: 0.255, // [D side y 287]
  bonnetFront: 0.1,
  // The bonnet covers the whole top, its side shut lines along the wings' top from the lamps
  // to the A pillar [P "1996 Opel Astra 1.6i", "1998 Opel Astra 1.6"].
  bonnet: { inset: 0.01 },
  // The face leans back a little from the bumper's top to the bonnet's lip [D side].
  frontLean: { base: 0.54, lean: 0.25, blend: 0.4, full: 0.22 },
  // On the right rear wing behind the rear door [P "Opel Astra F 20090424 rear"].
  flap: { s0: 3.6, s1: 3.72, y0: 0.76, y1: 0.86, side: 'right' },
};

/**
 * The facelift Astra F 1.6i GL [P "1996 Opel Astra 1.6i (53295982115)", "1998 Opel Astra
 * 1.6 (53484789145)", "Opel Astra F 20090424 rear", "Opel Astra F Hatch HL", "Opel Astra
 * (F) GL 5-door, rear right"]: rectangular head lamps with the indicators at their outer
 * ends wrapping round the corners; a black slatted grille with the badge in a body-colour
 * surround between them; dark grey plastic bumpers, two small fog lamps low in the front
 * one; a black rubbing strip along the doors; corner tail lamps (a reversing cell and the
 * indicator over the stop and tail lamp) and a black panel across the tailgate between
 * them; black handles and mirrors.
 */
export const LOOK_ASTRA_F: KitLook = {
  label: 'Opel Astra F',
  upholstery: 0x4a4c54, // dark grey cloth with coloured flecks [P "Opel Astra F innenraum"]
  dash: 0x3a3d42, // dark grey plastic [P "Opel Astra F cockpit"]
  headrests: true,
  brightwork: 'black',
  sill: null,
  // The black rubbing strip along the doors only [D side y 232–237: 0.55–0.58, from the front
  // door's shut line x 290 to the rear door's; P "1998 Opel Astra 1.6": none on the wing].
  waist: { y: 0.565, height: 0.03, finish: 'black', span: [1.25, 3.2] },
  // Amber, on the wing behind the front arch [P "1998 Opel Astra 1.6"].
  repeater: { s0: 1.12, s1: 1.16, y0: 0.7, y1: 0.722 },
  // The pressed line along the flank from the front arch to the tail [D side y 220: 0.648].
  featureLine: { points: [[0.65, 0.63], [1.3, 0.645], [3.2, 0.65], [3.9, 0.655]], height: 0.012 },
  cornerLamps: [
    // Head lamp and indicator as one flush unit [D front ±0.358–0.61, 0.56–0.665; D side to s
    // 0.285; P: the unit on the bumper's top under the bonnet's lip, its inner end against
    // the grille's surround, the clear indicator the outer quarter, round the corner a little
    // (lab against "1998 Opel Astra 1.6": its top up to the bonnet's lip, the indicator from
    // ±0.60, about a sixth of the unit across, wrapping to s 0.17)].
    {
      points: [
        { x: [0.365, 0.37], y: [0.55, 0.668], role: 'head' },
        { x: 0.6, y: [0.552, 0.672], role: 'blinker' },
        { y: [0.555, 0.672], role: 'blinker' },
        { s: 0.17, y: [0.565, 0.662] },
      ],
    },
    // Tail, two bands [D rear ±0.555–0.794, 0.73–0.927; D side forward to s 3.80; P "Opel
    // Astra F 20090424 rear": the upper 40 % a grey reversing cell inside and the amber
    // indicator, the lower red; the outer top corner rounded onto the wing].
    {
      end: 'rear',
      points: [
        { x: [0.565, 0.565], y: [0.838, 0.905], role: 'reverse' },
        { x: 0.63, y: [0.838, 0.905], role: 'blinker' },
        { y: [0.838, 0.9], role: 'blinker' },
        { s: 3.83, y: [0.838, 0.88] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.565, 0.565], y: [0.73, 0.832], role: 'brake' },
        { x: 0.63, y: [0.73, 0.832], role: 'tail' },
        { y: [0.73, 0.832], role: 'tail' },
        { s: 3.8, y: [0.735, 0.832] },
      ],
    },
  ],
  front: {
    // Dark grey plastic 0.19–0.535 [D side 0.19–0.49, front 0.18–0.51; P: its top under the
    // lamps' foot]: the band hangs `drop` under the face's sill bevel (0.30 + 0.035). Its
    // sides back along the wings to the front arch.
    bumper: { kind: 'moulded', drop: 0.145, height: 0.345, corner: 0.2, wrapTo: 0.45 },
    items: [
      // The grille between the lamps: black horizontal slats in a body-colour surround, from
      // the bumper's top to under the bonnet's lip [P; D front ±0.33].
      {
        kind: 'grille',
        x: { centre: 0.345 },
        y: { from: ['bumperTop', 0.012], to: ['deck', -0.025] },
        frame: { finish: 'paint', margin: 0.012 },
        back: true,
        bars: { dir: 'horizontal', count: 4, finish: 'black', margin: 0.01, width: 0.01, depth: 0.01, proud: 0.015 },
      },
      // The black intake across the bumper's lower part [D front ±0.585, 0.28–0.38; P].
      {
        kind: 'grille',
        x: { centre: 0.5 },
        y: { from: ['bumperBottom', 0.09], to: ['bumperBottom', 0.18] },
        standOut: 0.024,
        back: true,
        bars: { dir: 'horizontal', count: 1, finish: 'black', margin: 0, width: 0.015, depth: 0.01, proud: 0.005 },
      },
      // The small fog lamps at the intake's ends [P "1996 Opel Astra 1.6i"]: unlit grey
      // panels, their faces inside the bumper's.
      { kind: 'panel', x: { from: { centre: 0.52 }, to: { centre: 0.62 } }, y: { from: ['bumperBottom', 0.1], to: ['bumperBottom', 0.15] }, finish: 'grey', proud: 0.05 },
    ],
  },
  rear: {
    // Dark grey plastic 0.28–0.60 [D side 0.27–0.63, rear 0.30–0.657; P "Opel Astra F
    // 20090424 rear", "Hatch HL": a band of body colour 0.1 tall between the lamps' foot and
    // its top, the "ASTRA 16" badge on it]; its sides forward along the wings to the rear
    // arch (3.65).
    bumper: { kind: 'moulded', drop: 0.085, height: 0.32, wrapTo: 3.68 },
    items: [],
    // The black panel across the tailgate between the lamps, their height, the plate in its
    // lower part [P "Opel Astra F 20090424 rear"].
    lid: [{ kind: 'panel', x: { centre: 0.54 }, y: { from: ['belt', -0.175], to: ['belt', -0.003] }, finish: 'black', proud: 0.006 }],
  },
};
