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

/**
 * The Opel Vectra A saloon (J89), facelift of 09.1992–1995; the car built is the 2.0i GL
 * (C20NE, the F16 five-speed on 3.55): the facelift's face (wide head lamps either side of a
 * black slatted grille narrowing to its foot, the clear indicator at their outer ends), body-
 * colour bumpers with a black band along their top, a black rubbing strip along the flanks,
 * black door frames, B pillar and mirror sail, corner tail lamps with a black panel across
 * the boot lid between them. Numbers and sources in measurements-vectra.md.
 *
 * Measured on the-blueprints.com's dimensioned vector preview `1990_opel_vectra_a.jpg`
 * (drawing 9730, "Opel Vectra A (1989)", 1280 × 905; dimension lines 4430 / 2600 / 1700 /
 * 1400), side view facing left: lengths 5.821 mm/px from the drawn tips (x 80 / 841),
 * `s = (x − 80) × 0.005821`; heights 5.858 mm/px from the 1400 line (y 89–328), `y = (328 −
 * py) × 0.005858`. The drawn hubs (x 225 / 673.5) stand 2611 apart against the factory 2600:
 * the wheels are put on the factory wheelbase centred on the drawn pair. Front and rear
 * views 5.82 mm/px across (the body ±146 px for 1700). The drawing is of the 1989 car: the
 * face and tail are the facelift's from Commons photos.
 */

/**
 * Opel Vectra A saloon: overhangs 0.85 / 0.98 over a 2600 wheelbase [E: the drawn hubs
 * centred on the factory base]. The face at s 0.06 (lamps 0.61–0.705 under the bonnet's lip
 * 0.72); the bonnet rising to 0.937 at the cowl (s 1.222); the A pillar to the rail (1.31)
 * at 1.863; roof 1.41 from 2.27 to 2.9, falling into a long back light from 3.12 to its
 * foot at 3.88 (1.04); the boot level at 1.03 to 4.34 and the lid down the tail face
 * between the corner lamps. Sill 0.205, door bottoms 0.25, belt 0.875 at the cowl rising to
 * 0.92 under the quarter glass.
 */
export const BODY_VECTRA_A: KitBody = {
  length: 4.432, // [F auto-data 4432; the drawing's 4430]
  platform: 'samara',
  stations: [
    // The face [D side x 90–110: the lamps 0.62–0.72, the lip 0.72 at s 0.116; D front: the
    // lamps out to ±0.70 at the face, the body ±0.85]. The facelift's lamps are taller than
    // the 1989 drawing's [P "Opel Vectra A (front)": 85 px over a 735 px span of ±0.70, 0.16;
    // "Opel Vectra front 20080102": 0.13 against the wheel], so the lip at 0.75. The bonnet's centre line [D side:
    // 0.72 at s 0.116, 0.791 at 0.233, 0.826 at 0.349, 0.849 at 0.466, 0.861 at 0.582, 0.885
    // at 0.699, 0.902 at 0.815, 0.92 at 0.931, 0.931 at 1.048, 0.937 at the cowl].
    { s: 0.06, sill: 0.3, crease: 0.6, belt: 0.74, deck: 0.75, wSill: 0.68, wCrease: 0.7, wBelt: 0.68 },
    { s: 0.17, sill: 0.3, crease: 0.61, belt: 0.775, deck: 0.795, wSill: 0.77, wCrease: 0.79, wBelt: 0.77 },
    { s: 0.35, sill: 0.29, crease: 0.62, belt: 0.8, deck: 0.826, wSill: 0.81, wCrease: 0.83, wBelt: 0.8 },
    { s: 0.6, sill: 0.28, crease: 0.63, belt: 0.835, deck: 0.862, wSill: 0.83, wCrease: 0.848, wBelt: 0.81 },
    // The cowl [D side (290, 168)]; the flank ±0.853 [F 1706], the shoulder ±0.80 under the
    // glass's foot (±0.79 at 0.89 [D front]).
    { s: 1.222, sill: 0.22, crease: 0.64, belt: 0.875, deck: 0.937, wSill: 0.83, wCrease: 0.853, wBelt: 0.8 },
    // The belt under the side glass rising to the tail [D side: the glass's foot 0.89 at s
    // 1.7–2.15, 0.908 at 2.5, 0.92 at 2.8, 0.931 at 3.03]; sill 0.22 (the drawn 0.205 met the
    // exhaust under the floor, kit-zfight) [D side y 293].
    { s: 2.4, sill: 0.22, crease: 0.64, belt: 0.885, deck: 0.905, wSill: 0.83, wCrease: 0.853, wBelt: 0.8 },
    { s: 3.03, sill: 0.225, crease: 0.64, belt: 0.915, deck: 0.935, wSill: 0.83, wCrease: 0.853, wBelt: 0.8 },
    // rearBase: the back light's foot, 1.04 [D side: the top line 1.049 at s 3.9, the deck
    // 1.03 behind it]; the corners rounding in [D rear ±0.79 at 0.886, ±0.82 at 0.84]. The
    // sill kept at 0.25 to here: at 0.30 the shell's foot met the silencer (kit-zfight, as
    // the Espero's).
    { s: 3.88, sill: 0.25, crease: 0.64, belt: 0.995, deck: 1.04, wSill: 0.81, wCrease: 0.83, wBelt: 0.78 },
    { s: 4.25, sill: 0.33, crease: 0.64, belt: 0.99, deck: 1.03, wSill: 0.79, wCrease: 0.81, wBelt: 0.765 },
    { s: 4.34, sill: 0.33, crease: 0.64, belt: 0.975, deck: 1.015, wSill: 0.775, wCrease: 0.795, wBelt: 0.755 },
    // The tail face [D side x 838]: the lid comes down between the corner lamps (inner edges
    // ±0.545 [D rear]) to the bumper's top, cut at ±0.53; the lamps topped at 0.865 (the
    // drawing's 0.845; the photos' lamps are 0.22–0.25 tall, the drawing's 0.19).
    { s: 4.4, sill: 0.33, crease: 0.64, belt: 0.87, deck: 0.64, notch: 0.53, wSill: 0.76, wCrease: 0.775, wBelt: 0.745 },
  ],
  shoulder: { inset: 0.04, rise: 0.015 },
  cabin: {
    // The door frames, the B pillar, the post behind the rear door's glass and the mirror's
    // sail black [P "Opel Vectra front 20080102", "Opel Vectra A (front)", "(rear)"]; the A
    // and C pillars painted.
    columns: [
      // The screen's outer line from the cowl (1.222, 0.937) to the rail (1.863, 1.31) [D side
      // (290, 168) → (400, 96)].
      { s: 1.222, top: 1.863, upper: 'body' },
      { s: 1.26, top: 1.9, upper: 'door1', lower: 'body', finish: 'black' },
      // The front door's shut line below the belt [D side x 298]; the mirror's sail from it to
      // the glass's front edge [D side: the glass's foot from x 370, 1.61]. Owner's review 2
      // (2026-10-18): the edge from 1.55 (1.66 at 1.0), so the driver's lines to both mirror
      // heads (`mirrorS` 1.60) cross the side glass.
      { s: 1.29, top: 1.925, upper: 'door1', finish: 'black' },
      { s: 1.55, top: 1.95, upper: 'door1', glass: 'drop', finish: 'black' },
      // The B pillar, black (owner's review 2, 2026-10-18, re-read on the drawing by pixel
      // rows) [D side: the front glass ends 2.33, the pillar's lines 2.37 / 2.43 above the
      // belt, the shut line between the doors one line at 2.34 (0.75) to 2.358 (0.33), the
      // rear glass from 2.47].
      { s: 2.33, top: 2.36, upper: 'door1', finish: 'black' },
      { s: 2.345, top: 2.375, upper: 'body', lower: 'door2', finish: 'black' },
      { s: 2.44, top: 2.47, upper: 'door2', finish: 'black' },
      { s: 2.47, top: 2.5, upper: 'door2', glass: 'drop', finish: 'black' },
      // The rear door carries the small fixed quarter glass behind its post (review 2: it
      // was in the body and the door ended at 3.03, 0.27 short) [D side: the post 2.95 at
      // 1.03 to 2.99 at the rail; the frame's rear edge 3.26 at 0.96 leaning forward to 3.05
      // at the rail; P "1995 Opel Vectra 1.8i GLS", the white GLS side]. The shut line under
      // it [D side: 3.30 from the belt to 0.80, then slanting forward, 3.21 at 0.656, 3.13
      // at 0.516, 3.07 at 0.375, 3.04 at the doors' bottom], kept 2–3 cm ahead of the rear
      // arch (3.11 at 0.42, rearArch 1.22).
      { s: 2.95, top: 2.98, upper: 'door2', finish: 'black' },
      { s: 2.99, top: 3.02, upper: 'door2', glass: 'fixed', finish: 'black' },
      { s: 3.25, top: 3.04, upper: 'door2', finish: 'black' },
      { s: 3.29, top: 3.07, upper: 'body', foot: { y: 0.8, s: 2.98, round: [0.1, 0.03] } },
      // The C pillar, painted, to the back light's foot.
      // rearBase; the roof's rear end at the rail 3.12 [D side: 1.394 at s 3.11].
      { s: 3.88, top: 3.12 },
    ],
    rail: 1.31, // the side glass's top 1.306–1.312 [D side]
    railHalf: 0.57, // [D front ±0.594 at 1.31, ±0.565 at 1.36]
    crown: 0.08, // roof 1.41 [F 1400 + D 1.412] = rail + rise + crown
    railInset: 0.04,
    railRise: 0.02,
    // The roof rounding up from the screen [D side: 1.371 at s 1.92, 1.394 at 2.07, 1.40 at
    // 2.15, 1.412 from 2.27 to 2.68, 1.40 at 3.0, 1.394 at 3.11].
    roofDrop: [[1.863, 0.025], [2.0, 0.012], [2.2, 0.003], [2.3, 0], [2.9, 0], [3.0, 0.006], [3.12, 0.015]],
    glassBottom: 0.01,
    glassTop: 0.02,
    screenBottom: 0.03, // [E]
    screenHeader: 0.045, // [E]
    wiperBlade: 0.5, // [E]
    rearBottom: 0.025, // [E]
    rearHeader: 0.045, // [E]
    pillar: 0.07, // [E]
  },
  wheels: {
    front: 0.85, // [E: the drawn hubs 0.844 / 3.455 at the length scale, centred on 2600]
    rear: 3.45, // wheelbase 2600 [F]
    radius: 0.295, // 195/60 R14 [F auto-data]
    width: 0.195, // [F]
    frontHalfTrack: 0.7185, // 1437 [F auto-data]
    rearHalfTrack: 0.716, // 1432 [F]
    // Front: the liner's top 0.674, 0.379 over the hub [D side x 220].
    arch: 1.28,
    // Rear: its top 0.656, 0.361 over the hub [D side x 670].
    rearArch: 1.22,
    rearArchRise: 1.1,
  },
  doorBottom: 0.25, // [D side]
  bonnetFront: 0.06,
  // The bonnet covers the whole top, its side shut lines along the wings' top [P "Opel Vectra
  // front 20080102"].
  bonnet: { inset: 0.01 },
  // [E: on the right rear wing, as the Astra's; not seen on the left-side photos]
  flap: { s0: 3.62, s1: 3.74, y0: 0.76, y1: 0.86, side: 'right' },
  bootEnd: 4.4,
};

/**
 * The facelift Vectra A 2.0i GL [P "Opel Vectra A (front)", "Opel Vectra A (rear)", "Opel
 * Vectra front 20080102", "Opel Vectra rear 20080102", "Opel Vectra I front / rear
 * 20080328"]: wide head lamps with a small clear indicator at their outer ends, a black slatted
 * grille between them narrowing to its foot; body-colour bumpers with a black band along their
 * top, an intake and fog lamps low in the front one; a black rubbing strip along the flanks;
 * corner tail lamps (a red band, the reversing lamp and the indicator, the stop and tail
 * lamp below) with a black panel across the lid between them; black handles and mirrors.
 */
export const LOOK_VECTRA_A: KitLook = {
  label: 'Opel Vectra A',
  upholstery: 0x3c3e44, // dark grey cloth [P "Opel Vectra taxi dashboard"]
  dash: 0x2a2c30, // black-grey plastic [P]
  headrests: true,
  brightwork: 'black',
  sill: null,
  // On the sail at the glass's front foot (owner's review 2: at the default 1.34 the
  // driver's lines to the heads, eye s 2.28, met the sail) [D side: the head x 335–366,
  // s 1.48–1.66]; the right one's line crosses the glass 4 cm behind its edge.
  mirrorS: 1.6,
  // The black rubbing strip on the doors and the front wing behind the arch [D side y 262:
  // 0.39; P "Opel Vectra front 20080102": about the bumpers' top band's height, a little
  // lower; the white GLS side: arch to arch, each piece ending at its panel's seam].
  waist: { y: 0.42, height: 0.035, finish: 'black', span: [1.2, 3.3] },
  repeater: null,
  cornerLamps: [
    // Head lamp and indicator as one unit, 0.605–0.736 [D front: the lamps ±0.33–0.70; P
    // "Opel Vectra A (front)": the lens fills the band from the bumper's top to the bonnet's
    // lip, its inner end along the grille's slanted side, the clear indicator its outer
    // sixth, round the corner a little].
    {
      points: [
        { x: [0.312, 0.342], y: [0.605, 0.733], role: 'head' },
        { x: 0.6, y: [0.605, 0.736], role: 'blinker' },
        { y: [0.608, 0.736], role: 'blinker' },
        { s: 0.15, y: [0.618, 0.73] },
      ],
    },
    // Tail: three bands, 0.648–0.865 [D rear ±0.545–0.742, 0.659–0.845; D side round the corner to s 4.28;
    // P "Opel Vectra A (rear)": a red band at the top, then the reversing lamp inside and the
    // amber indicator outside, the stop and tail lamp below, about 1 : 1 : 2]. 6 mm of body
    // between the bands.
    {
      end: 'rear',
      points: [
        { x: [0.545, 0.545], y: [0.818, 0.865], role: 'tail' },
        { y: [0.818, 0.865], role: 'tail' },
        { s: 4.3, y: [0.82, 0.86] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.545, 0.545], y: [0.764, 0.812], role: 'reverse' },
        { x: 0.62, y: [0.764, 0.812], role: 'blinker' },
        { y: [0.764, 0.812], role: 'blinker' },
        { s: 4.29, y: [0.767, 0.812] },
      ],
    },
    {
      end: 'rear',
      points: [
        { x: [0.545, 0.545], y: [0.648, 0.758], role: 'brake' },
        { x: 0.62, y: [0.648, 0.758], role: 'tail' },
        { y: [0.648, 0.758], role: 'tail' },
        { s: 4.28, y: [0.656, 0.758] },
      ],
    },
  ],
  front: {
    // Body colour 0.17–0.60 [D front 0.17–0.515 on the 1989 car; P: the facelift's top up to
    // the lamps' foot], a black band along its top [P]; its sides back along the wings to the
    // front arch.
    bumper: { kind: 'moulded', drop: 0.165, height: 0.43, finish: 'paint', moulding: { y: 0.56, height: 0.07, finish: 'black' }, corner: 0.2, wrapTo: 0.47 },
    items: [
      // The grille between the lamps: black slats narrowing to its foot, from the bumper's top
      // to under the bonnet's lip [P; D front ±0.32 at the top].
      {
        kind: 'grille',
        x: { centre: 0.29 },
        y: { from: ['bumperTop', 0.012], to: ['deck', -0.02] },
        slant: -0.03,
        // No frame: its inner walls fought the slats' ends under the leaning face (kit-zfight).
        back: true,
        bars: { dir: 'horizontal', count: 4, finish: 'black', margin: 0.008, width: 0.008, depth: 0.01, proud: 0.015 },
      },
      // The intake low in the bumper [D front ±0.43, 0.20–0.26; P].
      {
        kind: 'grille',
        x: { centre: 0.43 },
        y: { from: ['bumperBottom', 0.04], to: ['bumperBottom', 0.1] },
        standOut: 0.024,
        back: true,
        bars: { dir: 'vertical', count: 3, finish: 'black', margin: 0, width: 0.015, depth: 0.01, proud: 0.005 },
      },
      // The fog lamps at the bumper's outer ends [D front ±0.52–0.64; P]: unlit grey panels.
      { kind: 'panel', x: { from: { centre: 0.5 }, to: { centre: 0.62 } }, y: { from: ['bumperBottom', 0.045], to: ['bumperBottom', 0.095] }, finish: 'grey', proud: 0.05 },
    ],
  },
  rear: {
    // Body colour 0.28–0.63 [D rear], a black band along its top [P]; its sides forward along
    // the wings to the rear arch (3.81).
    bumper: { kind: 'moulded', drop: 0.055, height: 0.35, finish: 'paint', moulding: { y: 0.59, height: 0.07, finish: 'black' }, wrapTo: 3.85 },
    items: [],
    // The black panel across the lid between the lamps, their height, the plate in it [P
    // "Opel Vectra A (rear)"].
    lid: [{ kind: 'panel', x: { centre: 0.5 }, y: { from: ['belt', -0.214], to: ['belt', -0.006] }, finish: 'black', proud: 0.006 }],
  },
};
