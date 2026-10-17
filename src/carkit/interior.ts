/**
 * The kit car's cabin: lining, furniture and door trim, built from the body frame's
 * cowl, belt, sill, rail and wheels and dressed per platform.
 *
 *  - LINING (carpet and tunnel, firewall, headliner, pillar and quarter trims, sills,
 *    arch humps, parcel shelf) closes the shell from inside, so neither the inner skin
 *    nor the void under the decks shows through the glass. Above the belt it is the
 *    shell's own (`KitContext.lining`: the greenhouse and roof offset inward), so it ends
 *    at the panes and openings exactly. It keeps clear of what moves or turns: a door's
 *    inner skin stands DOOR_CARD in from its outer skin, above the belt as well (the
 *    window frame), and the tyres turn outboard of `wellX`.
 *  - FURNITURE (dash, column and wheel, pedals, levers, seats) is fixed geometry in one
 *    builder, so the whole cabin is one mesh per slot. Each moving part is its own
 *    pivot group, tagged for the rig (rig.ts) with the shared channel names. The small
 *    ones are the cabin's fine detail (`fineDetail`), drawn only near (rig.ts
 *    `KIT_FINE_M`); every window and dial face they fill keeps a stand-in in the fixed
 *    geometry (`WINDOW_FILL`), so the cabin seen from further shows no hole.
 *  - DOOR TRIM (armrest, handle, lock knob, window crank, the capping over the door's
 *    window sill) hangs inside each door node and swings with it; the handle's lever, the
 *    lock knob and the crank are fine detail.
 *
 * Positions come from the frame. The platform table holds only the furniture's own
 * proportions, and its heights are offsets from the floor or from the belt at the
 * cowl. A body drawn a few percent low (the loader scales it to the passport height
 * afterwards) therefore keeps its cabin in proportion.
 *
 * Neighbours: the bay's firewall stands at the cowl, so everything here starts behind
 * cowl + FIREWALL. A saloon's boot starts at the rear base. A hatch's load floor and
 * luggage-side trims (bay.ts) start at the rear bench's back, `benchS + BENCH_BACK`.
 */

import * as THREE from 'three';
import { DOOR_THICKNESS as DOOR_CARD, LINING_DEPTH, stripOwner, type BodyFrame } from './body';
import { PartBuilder, lerp, table, type KitSlot, type Vec3 } from './builder';
import { addBuilt, addMirrorFace, attach, fineDetail, mirrorFrame, pivotGroup, type KitContext } from './context';
import type { KitControl, KitMotion } from './rig';
import type { KitCarSpec } from './spec';

type P2 = readonly [number, number];

/** Lining in from the outer skin below the belt, and in from the greenhouse above it. */
const SIDE_CLEAR = 0.08;
const GLASS_CLEAR = 0.075;
/** Firewall lining behind the cowl. */
const FIREWALL = 0.02;
/** Floor pan above the sill's underside (the shell's flat underbody). */
const FLOOR_RISE = 0.03;
/** Arch humps stand this far over the arch. */
const HUMP_RISE = 0.03;
/** The rear bench's closed base reaches this far behind its hip. */
const BENCH_BACK = 0.12;
/** The van's lining below the belt stops this far ahead of the rear doors' opening. */
const VAN_TRIM_CLEAR = 0.06;
/** The van's floor runs to this far ahead of the rear doors' opening. */
const VAN_FLOOR_CLEAR = 0.03;
/** The van's furniture stands this far into its floor (`Cabin.standY`). */
const VAN_FOOT_SINK = 0.01;
const ORIGIN: Vec3 = [0, 0, 0];

const COLOURS = {
  black: 0x131313,
  rubber: 0x0e0e0f,
  metal: 0x3b3d40,
  face: 0x0b0c0d,
  tick: 0xe6e4da,
  needle: 0xff6a1a,
  dial: 0xc9b47a,
  dialNeedle: 0xd0281a,
  hazard: 0xc4241c,
  white: 0xeeeeea,
  green: 0x3fae4a,
  wood: 0x5e3b20,
  lamp: 0xe8e4d2,
  cluster: 0x2a2c2f,
} as const;

/**
 * What a cluster's warning lamp tells, and its colour lit. Each lights on its rig
 * channel `tell_<name>` (0 or 1, fed by `Vehicle.driveKit`): indicators (blinking),
 * main beam, side lights, fuel reserve, low oil pressure, no charge, handbrake and
 * check engine. Off, the lens reads a dark shade of the same colour.
 */
type Telltale = 'turn' | 'beam' | 'side' | 'fuel' | 'oil' | 'charge' | 'brake' | 'check';
const TELLTALES: Readonly<Record<Telltale, number>> = {
  turn: 0x4dff5e,
  side: 0x4dff5e,
  beam: 0x3d8bff,
  fuel: 0xffa21f,
  check: 0xffa21f,
  oil: 0xff3523,
  charge: 0xff3523,
  brake: 0xff3523,
};
/**
 * How far a lit face slides: a lamp's or a dial's dark face slides back this far as its
 * lit face slides out into its place (or the lit face alone slides out over a dark lens
 * set into the face behind it), so in either pose the two stand 8 mm apart and never
 * fight in depth.
 */
const GLOW_TRAVEL = 0.008;
/**
 * A needle's swap travel, like `GLOW_TRAVEL`: far enough that the one put away lies
 * behind the cluster's face and 4 mm or more from every other face put away there.
 */
const NEEDLE_TRAVEL = 0.02;
/**
 * A window cut in the cluster's face (a warning lamp's, a ribbon dial's, a bare dial's
 * ticks) has a stand-in this far behind it, in the colour of what fills it dark: past
 * rig.ts `KIT_FINE_M` the faces that fill it do not draw, and the window then shows the
 * stand-in, not the binnacle's inside. 8 mm behind the deepest face put away in one (a
 * ribbon's needle, `NEEDLE_TRAVEL` behind its 4 mm), so near it fights none of them.
 */
const WINDOW_FILL = 0.024;
/** The courtesy lamp's lens lit: a warm filament behind milky plastic. */
const DOME_LIT = 0xfff0c8;
/**
 * The instrument lighting, on with the side lights (rig channel `panel`, derived from
 * the light switch `lights` in rig.ts): a dial's face faintly lit, its ticks and its needle glowing.
 * Lit faces like the warning lamps', slid out over the dial's own, so the cluster
 * needs no light and no new program. Kept dim: it is read at night, from the seat.
 */
const PANEL_FACE = 0x0c1610;
const PANEL_TICK = shade(0xb4ecbc, 0.62);
const PANEL_NEEDLE = shade(COLOURS.needle, 0.72);
/** The rig channel the instrument lighting's lit faces slide out on, by `GLOW_TRAVEL`. */
const PANEL_MOTION_CHANNEL = 'panel';
/**
 * The inside mirror, aimed by hand from the seat: held, the mouse turns it (rig.ts
 * `aim`), up to 0.2 rad each way on each axis, which swings the view twice that.
 */
const MIRROR_CONTROL: KitControl = {
  id: 'mirror',
  label: 'Зеркало заднего вида (держите E и ведите мышью)',
  action: { type: 'aim', channel: 'mirror_pitch', yaw: 'mirror_yaw', limit: 0.2 },
};

/** Which seat or door a control belongs to, for its hover label. */
const WHERE: Readonly<Record<string, string>> = {
  fl: 'водителя',
  fr: 'пассажира',
  rl: 'задний левый',
  rr: 'задний правый',
  l: 'водителя',
  r: 'пассажира',
};

/**
 * The rig channel a needle reads: km/h, rpm, fuel and temperature as fractions, oil
 * pressure in kgf/cm², the voltmeter in volts and the economy meter's manifold vacuum
 * as a fraction (closed throttle 1).
 */
type GaugeChannel = 'speed' | 'rpm' | 'fuel' | 'temp' | 'oil' | 'volts' | 'vacuum';

interface GaugeBase {
  readonly channel: GaugeChannel;
  /** Centre on the cluster face: towards the driver's right of the column, and above the cowl's belt. */
  readonly right: number;
  readonly up: number;
  /** Channel value at the scale's start (default 0) and at full scale: the needle's pins. */
  readonly min?: number;
  readonly full: number;
  readonly ticks: number;
}

interface RoundGauge extends GaugeBase {
  readonly kind?: 'round';
  readonly radius: number;
  /** Sweep clockwise (negative runs anticlockwise) and the rest angle (rad, 0 = driver's right). */
  readonly sweep: number;
  readonly rest: number;
  /** Only ticks and a needle: a second scale on the face of the gauge listed before it. */
  readonly bare?: boolean;
}

/** A horizontal window with a marker sliding left to right across it (the 2101's speedometer). */
interface RibbonGauge extends GaugeBase {
  readonly kind: 'ribbon';
  /** Window half width and half height. */
  readonly half: P2;
}

type GaugeLook = RoundGauge | RibbonGauge;

/**
 * One platform's furniture. `ds` is metres behind the cowl; heights named `dy` are
 * offsets from the belt at the cowl, the rest offsets from the floor.
 */
interface Layout {
  /** Driver's hip behind the cowl; the rear bench's hip from the rear base or the driver's hip. */
  readonly hip: number;
  /**
   * `clear`: the bench's base this far inside the rear wells (default 0.022, 2 mm off the
   * wheel-house covers' walls). A bench standing between the covers along its length (the
   * Niva's) keeps more, as 2 mm of air there fights at a distance.
   */
  readonly bench: { readonly from: 'rearBase' | 'hip'; readonly offset: number; readonly clear?: number };
  /** Cushion tops over the floor, front seats and rear bench. */
  readonly cushion: number;
  readonly benchCushion: number;
  /** Backrest recline from upright (rad), front and rear. */
  readonly recline: number;
  readonly benchRecline: number;
  /** Sculpted side bolsters on the front backrests. */
  readonly bolsters: boolean;
  /** Seat centre lines off the car's centre; the driver sits on +x. */
  readonly seatX: number;
  /** Toe board: its top over the floor at the firewall and its run back to the floor. */
  readonly toeTop: number;
  readonly toeRun: number;
  /** Tunnel heights over the floor (at the toe board's top, its foot and the rear) and half widths (base, top; front and rear). */
  readonly tunnel: {
    readonly heights: readonly [number, number, number];
    readonly base: readonly [number, number];
    readonly top: readonly [number, number];
  };
  /** Centre console over the tunnel (ds range and top over the floor). */
  readonly console?: { readonly ds0: number; readonly ds1: number; readonly height: number };
  /** Dash section (ds, dy) from the top's run round to the firewall; its front point follows the deck. */
  readonly dash: readonly P2[];
  /**
   * The dash's section across the car, where one section cannot serve the whole width:
   * `[x, section]` pairs from the passenger's end (-1) to the driver's (+1), `x` a fraction
   * of the dash's half width, each section with as many points as `dash`, lofted
   * between. Absent: `dash` at -1, -0.55, 0, 0.55 and 1. The fascia's line and every
   * fitting on it stay where `fascia` puts them, so a section that ends higher or
   * further forward must not reach under one.
   */
  readonly dashLoft?: readonly (readonly [number, readonly P2[]])[];
  /** Fascia face, top and bottom (ds, dy): lids and switches mount on it. */
  readonly fascia: readonly [P2, P2];
  /** Wood-look band on the fascia (dy bottom, top). */
  readonly wood?: P2;
  /**
   * A band laid into the fascia's face across its width (dy bottom, top) in its own
   * colour: the GAZ-24's aluminium panel, the GAZ-31029's wood grain. Part of the face,
   * not a strip on it, so a glovebox opening or a vent cut later goes through it; left out
   * behind the binnacle.
   */
  readonly band?: { readonly dy: P2; readonly colour: number };
  /**
   * Binnacle section (ds, dy) and half width about the column, or about the point
   * `binnacleRight` to the column's right (the UAZ-469's panel in the dash's middle); the
   * gauges sit on its face at `cluster`.
   */
  readonly binnacle: readonly P2[];
  readonly binnacleHalf: number;
  readonly binnacleRight?: number;
  readonly cluster: number;
  readonly gauges: readonly GaugeLook[];
  /**
   * Steering wheel centre (ds, dy), column rake above horizontal, rim radius and tube,
   * spoke angles (0 = driver's left, 90 = up) and the horn: a round boss or a wide pad.
   * `chrome`: spokes and horn bright (the GAZ-24's chrome horn bar across the wheel).
   * `toFloor`: the column runs on down its own line to the floor or toe board (a van's
   * column, which passes under a shallow dash), instead of stopping 0.4 m below the hub.
   */
  readonly wheel: {
    readonly ds: number;
    readonly dy: number;
    readonly rake: number;
    readonly radius: number;
    readonly rim: number;
    readonly spokes: readonly number[];
    readonly hub: 'round' | 'pad';
    readonly chrome?: boolean;
    readonly toFloor?: boolean;
  };
  /** Pedal hinge (ds, dy) under the dash and pad centre (ds, height over the floor). */
  readonly pedals: { readonly pivot: P2; readonly pad: P2 };
  /** Gear lever: ds of its gaiter, height and how far its knob leans back. */
  readonly gear: { readonly ds: number; readonly height: number; readonly lean: number };
  /**
   * The Niva's transfer-box levers on the tunnel behind the gear lever, fixed parts: their
   * gaiters' ds, and each lever's x, height over the tunnel, knob radius and the knob's
   * lean (back along the car, then across in +x).
   */
  readonly transfer?: { readonly ds: number; readonly levers: readonly { readonly x: number; readonly height: number; readonly knob: number; readonly lean: P2 }[] };
  /** Handbrake hinge behind the driver's hip, and its length forward. */
  readonly handbrake: { readonly rear: number; readonly length: number };
  /**
   * Fascia fittings at [x, dy]; the light switch is placed off the column, to the driver's
   * right by `right`. The glovebox lid in `colour` (default the dash's, a shade lighter).
   */
  readonly glovebox: { readonly x: number; readonly dy: number; readonly half: P2; readonly colour?: number };
  readonly radio: P2;
  readonly ashtray: P2;
  readonly hazard: P2;
  /**
   * The front doors' inner handle and window crank: metres behind the card's front edge
   * and `dy` from the door's belt. Absent: the handle 0.13 behind the front at -0.085, the
   * crank 0.35 behind it at -0.35.
   */
  readonly frontDoor?: { readonly handle: P2; readonly crank: P2 };
  /** The light switch; on the cluster face its `dy` is a height like a gauge's `up`. */
  readonly lights: { readonly right: number; readonly dy: number; readonly kind: 'knob' | 'rocker'; readonly on?: 'fascia' | 'cluster' };
  /**
   * Slatted face vents on the fascia at [x, dy]; without `x`, a pair at the dash's ends.
   * `half` is the opening's half size (default 0.035 x 0.024); slats fill it 0.012 apart.
   */
  readonly vents?: readonly { readonly dy: number; readonly x?: number; readonly half?: P2 }[];
  /** Round eyeball vents on the fascia at [x, dy]. */
  readonly eyeballs?: { readonly radius: number; readonly at: readonly P2[] };
  /** A framed panel on the cluster face behind the gauges: centre (right, up), half size, colour and frame. */
  readonly clusterFace?: { readonly right: number; readonly up: number; readonly half: P2; readonly colour: number; readonly frame: 'chrome' | 'black' };
  /**
   * A clock on the cluster face (right, up as a gauge's), its hands standing at ten past
   * ten: it has no channel. Bezel, face, hour marks and hands are coarse.
   */
  readonly clock?: { readonly right: number; readonly up: number; readonly radius: number };
  /**
   * Warning lamps on the cluster face: `show` laid row by row into a grid `cols` wide at
   * `pitch`, centred at (right, up).
   */
  readonly lamps?: { readonly right: number; readonly up: number; readonly cols: number; readonly pitch: number; readonly show: readonly Telltale[] };
  /** A second group of warning lamps laid as `lamps` (the Niva's two big lenses under its temperature gauge). */
  readonly lenses?: Layout['lamps'];
  /** Switches with no channel: [x, dy] on the fascia, or [right, up] on the cluster face as the gauges. */
  readonly rockers?: { readonly on: 'fascia' | 'cluster'; readonly at: readonly P2[] };
  /**
   * Heater controls: a dark panel centred on the car's centre line at `dy` (on the stack
   * below the fascia's foot), half size `half`, with round knobs of `radius` at each `knobs` x.
   */
  readonly heater?: { readonly dy: number; readonly half: P2; readonly knobs: readonly number[]; readonly radius: number };
  /**
   * Centre stack from the fascia's foot down to the tunnel, its face continuing the
   * fascia's line: fittings placed below the fascia's foot stand on it.
   */
  readonly stack?: { readonly half: number };
  readonly carpet: number;
  readonly headliner: number;
  /** The cabin floor over the sill's underside under the front seats; default `FLOOR_RISE` (the van's stands high). */
  readonly floorRise?: number;
  /** A padded engine cover on the centre line between the front seats (the van's): ds range, half width, height over the floor; in the dash's colour. */
  readonly engineCover?: { readonly ds0: number; readonly ds1: number; readonly half: number; readonly height: number };
}

/** A car's changes to its platform's layout (`KitCarSpec.cabinLayout`). */
export type CabinLayoutOverride = Partial<Layout>;

/** Scales of the stock dials: a big one sweeping 240 degrees, a small one 90 (full scale 1). */
const BIG = { sweep: 240 * (Math.PI / 180), rest: 210 * (Math.PI / 180), ticks: 9 } as const;
const SMALL = { full: 1, sweep: Math.PI / 2, rest: 225 * (Math.PI / 180), ticks: 3 } as const;
/** The Zhiguli's small oil pressure dial, 0-8 kgf/cm², and voltmeter, 8-16 V. */
const OIL_DIAL = { ...SMALL, full: 8, ticks: 5 } as const;
const VOLT_DIAL = { ...SMALL, min: 8, full: 16, ticks: 5 } as const;

/** Big round dials over the wheel's hub: speedometer and tachometer, then the small pair. */
function dials(big: number, small: number, spread: number, smallSpread: number, up: number, smallUp: number): GaugeLook[] {
  return [
    { channel: 'speed', right: -spread, up, radius: big, full: 180, ...BIG },
    { channel: 'rpm', right: spread, up, radius: big, full: 8000, ...BIG },
    { channel: 'fuel', right: -smallSpread, up: smallUp, radius: small, ...SMALL },
    { channel: 'temp', right: smallSpread, up: smallUp, radius: small, ...SMALL },
  ];
}

/** The classic's and the Samara's layouts; the Niva's (`LAYOUTS.niva`) is the classic's with its own dash. */
const BASE_LAYOUTS: Readonly<Record<'classic' | 'samara', Layout>> = {
  // Zhiguli: a flat fascia with a wood band, a deep hood over round dials, a thin
  // two-spoke wheel on a steep column, pedals hung from the scuttle, a tall tunnel for
  // the gearbox and prop shaft and a long lever straight out of the box.
  classic: {
    hip: 0.95,
    bench: { from: 'rearBase', offset: -0.45 },
    cushion: 0.235,
    benchCushion: 0.21,
    recline: 0.24,
    benchRecline: 0.36,
    bolsters: false,
    seatX: 0.37,
    toeTop: 0.215,
    toeRun: 0.24,
    tunnel: { heights: [0.08, 0.17, 0.11], base: [0.19, 0.14], top: [0.11, 0.08] },
    dash: [
      [0.16, 0.045], [0.29, 0.055], [0.325, 0.04], [0.338, 0.008], [0.338, -0.155],
      [0.315, -0.2], [0.12, -0.22], [0.045, -0.195], [0.045, -0.06],
    ],
    fascia: [[0.338, 0.008], [0.338, -0.155]],
    wood: [-0.02, 0.002],
    binnacle: [[0.235, 0.05], [0.26, 0.135], [0.4, 0.148], [0.44, 0.136], [0.44, 0.12], [0.352, 0.11], [0.352, 0.013], [0.3, 0.013]],
    binnacleHalf: 0.215,
    cluster: 0.352,
    gauges: dials(0.048, 0.029, 0.066, 0.165, 0.06, 0.052),
    // Warning lamps in a column in the gap between the big dials.
    lamps: { right: 0, up: 0.06, cols: 1, pitch: 0.012, show: ['turn', 'side', 'beam', 'fuel', 'oil', 'charge', 'brake'] },
    // Hub 0.03 over the belt: the rim's top stands about 5 cm over the hood, as the 2108's
    // stands at its cowl, instead of reaching up into the screen.
    wheel: { ds: 0.55, dy: 0.03, rake: 28 * (Math.PI / 180), radius: 0.19, rim: 0.0145, spokes: [-15, 195], hub: 'round' },
    pedals: { pivot: [0.1, -0.16], pad: [0.21, 0.135] },
    gear: { ds: 0.62, height: 0.32, lean: 0.1 },
    handbrake: { rear: 0.08, length: 0.26 },
    glovebox: { x: -0.4, dy: -0.09, half: [0.165, 0.052] },
    radio: [0, -0.072],
    ashtray: [0, -0.132],
    hazard: [0.17, -0.066],
    lights: { right: -0.18, dy: -0.066, kind: 'knob' },
    carpet: 0x2b2420,
    headliner: 0xc9c0a8,
  },
  // Samara: a chunky moulded dash leaning towards the knees, a rectangular binnacle,
  // a three-spoke wheel on a flatter column, a low tunnel under a short console.
  samara: {
    hip: 0.95,
    bench: { from: 'hip', offset: 0.78 },
    cushion: 0.19,
    benchCushion: 0.21,
    recline: 0.26,
    benchRecline: 0.36,
    bolsters: true,
    seatX: 0.36,
    toeTop: 0.2,
    toeRun: 0.24,
    tunnel: { heights: [0.03, 0.09, 0.06], base: [0.14, 0.11], top: [0.08, 0.07] },
    console: { ds0: 0.36, ds1: 0.8, height: 0.17 },
    dash: [
      [0.24, -0.028], [0.42, -0.014], [0.468, -0.028], [0.482, -0.06], [0.44, -0.235],
      [0.385, -0.312], [0.13, -0.335], [0.045, -0.3], [0.045, -0.12],
    ],
    fascia: [[0.482, -0.06], [0.44, -0.235]],
    binnacle: [[0.25, -0.025], [0.275, 0.085], [0.45, 0.098], [0.5, 0.085], [0.5, 0.068], [0.472, 0.062], [0.472, -0.035], [0.4, -0.03]],
    binnacleHalf: 0.21,
    cluster: 0.472,
    gauges: dials(0.044, 0.025, 0.062, 0.16, 0.015, 0.005),
    lamps: { right: 0, up: 0.015, cols: 1, pitch: 0.012, show: ['turn', 'side', 'beam', 'fuel', 'oil', 'charge', 'brake'] },
    wheel: { ds: 0.58, dy: -0.02, rake: 22 * (Math.PI / 180), radius: 0.185, rim: 0.0145, spokes: [-25, 205, 270], hub: 'pad' },
    pedals: { pivot: [0.1, -0.29], pad: [0.22, 0.115] },
    gear: { ds: 0.72, height: 0.22, lean: 0.04 },
    handbrake: { rear: 0.12, length: 0.24 },
    glovebox: { x: -0.4, dy: -0.15, half: [0.16, 0.05] },
    radio: [0, -0.15],
    ashtray: [0, -0.212],
    hazard: [0, -0.085],
    lights: { right: -0.2, dy: -0.1, kind: 'rocker' },
    vents: [{ dy: -0.1 }],
    carpet: 0x26272a,
    headliner: 0x9a9ca0,
  },
};

// The VAZ-2121 Niva of 1977-1993 on the classic's furniture (its seats and instruments
// are the 2106's: "шестерочные", ZR below), read off these sources. Pixels (x, y) below
// are on the ZR cluster photo, y up from the big dials' centre.
//  - Za Rulyom, "К юбилею Нивы: ретротест ВАЗ-2121" (a 1983 car, photos ©zr.ru, read for
//    measurement only), https://www.zr.ru/content/articles/906566-k-yubileyu-nivy-retro-test-vaz/:
//    the cluster shot square through the wheel (1280 x 800), the cabin from the driver's
//    door, the lenses and rockers close up.
//  - Wikimedia Commons: "VAZ-2121 (first generation) "Niva" (interior view).jpg" (public
//    domain; a pre-1994 car), "Interior 1980.jpg" (CC BY-SA 4.0, User:Niva80; the stack
//    and the tunnel's levers), "1990 Lada Niva Truck interior (2654354756).jpg" (CC BY-SA
//    2.0; cluster, stack, wheel).
//  - The factory four-view build/carshape/_refs/bp/img/niva.jpg, scaled by its 2200 mm
//    wheelbase (597 px, 3.685 mm/px): the seats and the rear bench drawn dashed.
// Scale on the cluster photo: its speedometer and tachometer are the 2106's, whose bezel
// the classic draws 0.106 across (radius 0.048 + 0.005); there 265 px, 0.4 mm/px. The
// column stands between the two big dials (the trip knob, x 635, and the rim's
// symmetry, x 640), as on the 2106. Heights are hung from the big dials' centre, 0.06
// over the belt as the classic's [E]: no photo shows the belt and the dials together.

const LAYOUTS: Readonly<Record<KitCarSpec['platform'], Layout>> = {
  ...BASE_LAYOUTS,
  /**
   * VAZ-2121: a black padded dash, a wide flat instrument panel over the driver's half
   * (2106 instruments in their own wells: fuel over oil pressure, tachometer,
   * speedometer, temperature, two big chrome-ringed lenses under it), three rockers under
   * the lenses, a console under the dash's middle (face vent, heater knobs and hazard,
   * radio), the gear lever well forward and the transfer box's two short levers behind it.
   */
  niva: {
    ...BASE_LAYOUTS.classic,
    // Front seat: drawn at 0.65 behind the cowl in both views (the backrest's foot at x
    // 1225 side, the headrest 50 px ahead of the B-pillar in plan), the cowl at x 1052;
    // that leaves 0.47 m from hip to pedal, so the drawing has it at its rails' front.
    // 0.85 [E] keeps the classic's seat-to-pedal reach within 0.1 while the backrest stays
    // ahead of the B-pillar (door 1055-1330 px: 1.02 m behind the cowl).
    hip: 0.85,
    // Rear bench: its back's foot drawn at x 1465, 1.52 behind the cowl and 0.06 ahead of
    // the rear axle [D].
    // It stands between the rear wheel-house covers [P], its base 2 cm off them.
    bench: { from: 'hip', offset: 0.67, clear: 0.04 },
    // Seat centres 112 and 98 px either side of the plan's centre line: 0.39 [D]; 0.38, so
    // the panel's end (seatX + binnacleHalf) stays where the 2107's stands in a body 35 mm
    // narrower a side.
    seatX: 0.38,
    // A flat tray on the tunnel round the transfer levers, about 0.25 across [P, ZR].
    tunnel: { heights: [0.08, 0.17, 0.11], base: [0.2, 0.16], top: [0.12, 0.11] },
    // A face standing upright to the console's top, its top roll over the panel's [E].
    dash: [
      [0.15, 0.07], [0.29, 0.085], [0.33, 0.07], [0.345, 0.03], [0.345, -0.17],
      [0.32, -0.215], [0.12, -0.235], [0.045, -0.205], [0.045, -0.06],
    ],
    fascia: [[0.345, 0.03], [0.345, -0.17]],
    wood: undefined,
    // The instrument panel: 1220 px wide (x 30-1250), almost centred on the column: half
    // 0.244 [P], here 0.23 so its end stays inside the dash. Its face from 0.077 over the
    // dials (frame top, y 140) down past the rockers (y 545, 0.085 under them) [P]; it
    // stands 3.5 cm proud of the dash's face under a short lip [E], so the windows cut in it
    // (`WINDOW_FILL`) keep 1.1 cm in front of the dash's face inside it.
    binnacle: [[0.24, 0.08], [0.27, 0.145], [0.375, 0.155], [0.415, 0.147], [0.415, 0.137], [0.38, 0.135], [0.38, -0.06], [0.33, -0.06]],
    binnacleHalf: 0.23,
    cluster: 0.38,
    clusterFace: { right: 0, up: 0.0375, half: [0.218, 0.09], colour: COLOURS.cluster, frame: 'black' },
    gauges: [
      // Centres (px, y up from the big dials' 333) and bezels on the cluster photo: the
      // tachometer 0-80 x100 at x 464, the speedometer 0-180 at x 810.
      { channel: 'rpm', right: -0.07, up: 0.06, radius: 0.048, full: 8000, ...BIG },
      { channel: 'speed', right: 0.068, up: 0.06, radius: 0.048, full: 180, ...BIG },
      // Fuel (0, 1/2, 1) at x 178, y +53 and temperature (50, 90, 130) at x 1092, y +49,
      // bezels 145 px across; oil pressure (0-8) at x 225, y -129, 125 px across.
      { channel: 'fuel', right: -0.185, up: 0.081, radius: 0.024, ...SMALL },
      { channel: 'temp', right: 0.181, up: 0.08, radius: 0.024, ...SMALL },
      { channel: 'oil', right: -0.166, up: 0.008, radius: 0.02, ...OIL_DIAL },
    ],
    // The real lamps sit in the big dials' faces (parking brake, charge and choke in the
    // tachometer's, side lights, indicators and main beam in the speedometer's), which a
    // dial's face covers here; they stand in a column between the dials, as the 2106's.
    lamps: { right: 0, up: 0.06, cols: 1, pitch: 0.012, show: ['turn', 'side', 'beam', 'oil', 'charge'] },
    // The two big lenses, 60 px (24 mm) across at x 1040 and 1142, y -98: amber (the
    // centre differential's lock, which has no channel: here the fuel reserve, the
    // 2121's other amber lamp, in the fuel dial on the car) and red (brake fluid; here
    // the brake lamp).
    lenses: { right: 0.18, up: 0.021, cols: 2, pitch: 0.041, show: ['fuel', 'brake'] },
    // Three rockers on the panel under the lenses, 95 px apart at y -212 (x 965, 1060,
    // 1155): the first the lights (a lamp on its key) [P, ZR close-up].
    lights: { right: 0.128, dy: -0.025, kind: 'rocker', on: 'cluster' },
    rockers: { on: 'cluster', at: [[0.165, -0.025], [0.202, -0.025]] },
    // Console under the dash's middle (Commons "Interior 1980", 280 px wide, the radio
    // filling it): a slatted face vent on top, two knobs on the driver's side with the
    // hazard switch beside them, the radio under them [P]; the ashtray at its foot [E].
    stack: { half: 0.1 },
    vents: [{ x: 0, dy: -0.135, half: [0.07, 0.024] }],
    heater: { dy: -0.215, half: [0.09, 0.028], knobs: [0.06, 0.005], radius: 0.016 },
    hazard: [-0.055, -0.215],
    radio: [0, -0.275],
    ashtray: [0, -0.335],
    // The lid in the passenger's half of the face, under the top roll [P, Commons
    // interior view]; on the car it opens upwards (ZR).
    glovebox: { x: -0.37, dy: -0.06, half: [0.17, 0.05] },
    // Two spokes nearly level under a wide bar across the hub [P, ZR]; the 2106's size and
    // place [E]: the stalks' tips then stand 5 cm clear of the rockers, the rim of the lip.
    wheel: { ...BASE_LAYOUTS.classic.wheel, spokes: [-5, 185], hub: 'pad' },
    // Gear lever out of the tunnel by the console's foot, long and cranked back; the
    // transfer box's two short levers side by side behind it on the tray, over the box
    // (bay.ts, 0.57-0.83 behind the cowl): the centre differential's lock on the left,
    // taller, the range lever (high, neutral, low) on the right with a ball knob leaning
    // outboard [P, ZR, Commons; which is which: avtovaz.com.ua "Раздатка Нива 2121"] [E sizes].
    gear: { ds: 0.48, height: 0.34, lean: 0.12 },
    transfer: {
      ds: 0.66,
      levers: [
        { x: 0.045, height: 0.2, knob: 0.016, lean: [0.02, 0] },
        { x: -0.045, height: 0.15, knob: 0.02, lean: [0.03, -0.03] },
      ],
    },
    handbrake: { rear: 0.1, length: 0.2 },
    // Black ribbed rubber mats, a pale perforated headliner [P].
    carpet: 0x1c1c1d,
    headliner: 0xcfcabd,
  },
  /**
   * A forward-control van (the UAZ-452 family): the cab over the front axle, the front
   * seats on the wheel boxes either side of the engine's padded cover, a high flat floor
   * from the front wall to the rear doors, a large thin wheel on a steep column, pedals
   * hung under the dash; the gear lever and the transfer levers out of the floor behind
   * the cover; one transverse bench at the back. The classic's furniture otherwise; the
   * dash is the car's (`CABIN_UAZ2206`). Figures [E] unless marked: no section of the cab.
   */
  van: {
    ...BASE_LAYOUTS.classic,
    // The cushion over the front wheel: the hip 0.8 behind the cowl, over the axle's rear
    // half (the seat's base reaches 0.45 ahead of it).
    hip: 0.8,
    bench: { from: 'rearBase', offset: -0.55 },
    // A flat floor: the cab's under the seats over the arches' tops (0.73), the saloon's
    // ~0.72 (the roof lining ~2.03 less the drawn 1315 inside height, measurements-uaz.md
    // §3.8): 0.25 over the sill 0.50 at the cowl + 0.5.
    floorRise: 0.25,
    toeTop: 0.12,
    toeRun: 0.2,
    tunnel: { heights: [0, 0, 0], base: [0.2, 0.2], top: [0.17, 0.17] },
    engineCover: { ds0: 0.3, ds1: 0.8, half: 0.2, height: 0.32 },
    gear: { ds: 0.88, height: 0.45, lean: -0.05 },
    transfer: {
      ds: 0.94,
      levers: [
        { x: -0.08, height: 0.3, knob: 0.02, lean: [-0.08, 0] },
        { x: -0.14, height: 0.3, knob: 0.02, lean: [-0.08, -0.01] },
      ],
    },
    handbrake: { rear: 0.35, length: 0.18 },
    carpet: 0x2c2d26,
    headliner: 0xcfcabd,
  },
};

/**
 * VAZ-2131: the 2121's cabin with the rear bench 0.33 further back, its hip at s 3.0 over
 * the rear door's rear half (glass 2.36–3.11), 0.39 ahead of the rear axle [E: the 500
 * mm the body grew goes to the rear legroom and the load space; no drawing of the cabin].
 */
export const CABIN_2131: CabinLayoutOverride = { bench: { from: 'hip', offset: 1.0, clear: 0.04 } };

// Per-model dashboards on the classic platform. Sizes are ratios read off interior
// photos and the 2105/2107 cluster schematics, scaled to absolutes from a 1.36 m cabin
// width (no dashboard photo carries a scale). The 2106 is the platform's own layout.

/**
 * VAZ-2101: a flat dash without wood, a shallow chrome-bezelled hood (about 0.30 x
 * 0.10 m) over a ribbon speedometer 0-180, temperature and fuel dials at its ends and a
 * row of six warning lamps; two eyeball vents right of the hood; a thin-rimmed wheel.
 */
export const CABIN_2101: CabinLayoutOverride = {
  wood: undefined,
  binnacle: [[0.26, 0.05], [0.28, 0.125], [0.38, 0.136], [0.41, 0.126], [0.41, 0.114], [0.352, 0.11], [0.352, 0.013], [0.3, 0.013]],
  binnacleHalf: 0.17,
  clusterFace: { right: 0, up: 0.062, half: [0.15, 0.045], colour: COLOURS.cluster, frame: 'chrome' },
  gauges: [
    { kind: 'ribbon', channel: 'speed', right: 0, up: 0.074, half: [0.1, 0.016], full: 180, ticks: 10 },
    { channel: 'temp', right: -0.128, up: 0.062, radius: 0.018, ...SMALL },
    { channel: 'fuel', right: 0.128, up: 0.062, radius: 0.018, ...SMALL },
  ],
  lamps: { right: 0, up: 0.04, cols: 6, pitch: 0.02, show: ['turn', 'side', 'beam', 'oil', 'charge', 'brake'] },
  eyeballs: { radius: 0.026, at: [[0.115, -0.014], [0.045, -0.014]] },
  radio: [0, -0.08],
  wheel: { ...LAYOUTS.classic.wheel, rim: 0.012 },
};

/**
 * VAZ-2103: the 2106's hood and wood band, a wood panel behind five dials in one row
 * (fuel, temperature, oil pressure, then tachometer and speedometer at twice their
 * size) and three rockers under the small dials, the first switching the lights.
 */
export const CABIN_2103: CabinLayoutOverride = {
  clusterFace: { right: 0, up: 0.062, half: [0.21, 0.05], colour: COLOURS.wood, frame: 'black' },
  gauges: [
    { channel: 'fuel', right: -0.18, up: 0.062, radius: 0.024, ...SMALL },
    { channel: 'temp', right: -0.12, up: 0.062, radius: 0.024, ...SMALL },
    { channel: 'oil', right: -0.06, up: 0.062, radius: 0.024, ...OIL_DIAL },
    { channel: 'rpm', right: 0.03, up: 0.062, radius: 0.044, full: 8000, ...BIG },
    { channel: 'speed', right: 0.138, up: 0.062, radius: 0.044, full: 180, ...BIG },
  ],
  // Warning lamps in a row on the wood under the three small dials.
  lamps: { right: -0.12, up: 0.022, cols: 7, pitch: 0.016, show: ['turn', 'side', 'beam', 'fuel', 'oil', 'charge', 'brake'] },
  lights: { right: -0.18, dy: -0.05, kind: 'rocker' },
  rockers: { on: 'fascia', at: [[LAYOUTS.classic.seatX + 0.12, -0.05], [LAYOUTS.classic.seatX + 0.06, -0.05]] },
  wheel: { ...LAYOUTS.classic.wheel, rim: 0.012 },
};

/**
 * VAZ-2105: a padded black dash without wood and its own rectangular cluster pod
 * (about 0.37 x 0.115 m): a combined fuel and temperature dial on the left, the
 * speedometer on the right, a small voltmeter between under a block of six warning
 * lamps, and two rockers at each end, the top left one for the lights.
 */
export const CABIN_2105: CabinLayoutOverride = {
  wood: undefined,
  dash: [
    [0.16, 0.05], [0.28, 0.065], [0.33, 0.05], [0.35, 0.015], [0.345, -0.15],
    [0.32, -0.2], [0.12, -0.22], [0.045, -0.195], [0.045, -0.06],
  ],
  fascia: [[0.35, 0.015], [0.345, -0.15]],
  binnacle: [[0.25, 0.055], [0.27, 0.135], [0.385, 0.14], [0.395, 0.128], [0.39, 0.12], [0.39, 0.003], [0.33, 0.003]],
  binnacleHalf: 0.205,
  cluster: 0.39,
  clusterFace: { right: 0, up: 0.0615, half: [0.185, 0.0575], colour: COLOURS.cluster, frame: 'black' },
  gauges: [
    // Fuel across the top of the left dial, temperature across its bottom.
    { channel: 'fuel', right: -0.085, up: 0.0615, radius: 0.048, full: 1, sweep: 140 * (Math.PI / 180), rest: 160 * (Math.PI / 180), ticks: 3 },
    { channel: 'temp', right: -0.085, up: 0.0615, radius: 0.048, full: 1, sweep: -140 * (Math.PI / 180), rest: 200 * (Math.PI / 180), ticks: 3, bare: true },
    { channel: 'speed', right: 0.085, up: 0.0615, radius: 0.048, full: 180, ...BIG },
    { channel: 'volts', right: 0, up: 0.03, radius: 0.02, ...VOLT_DIAL },
  ],
  lamps: { right: 0, up: 0.088, cols: 3, pitch: 0.014, show: ['turn', 'beam', 'fuel', 'brake', 'oil', 'charge'] },
  lights: { right: -0.163, dy: 0.0885, kind: 'rocker', on: 'cluster' },
  rockers: { on: 'cluster', at: [[-0.163, 0.0335], [0.163, 0.0885], [0.163, 0.0335]] },
  wheel: { ...LAYOUTS.classic.wheel, hub: 'pad' },
};

/**
 * VAZ-2107: the big one-piece padded "euro" dash with a deep hood over a wide cluster
 * (about 0.40 x 0.14 m): tachometer and speedometer, a column of seven warning lamps
 * between them and two small dials at each end (economy meter and temperature,
 * fuel and voltmeter). A centre stack under twin vents carries four rockers (the
 * first for the lights), the radio and the ashtray; a large glovebox.
 */
export const CABIN_2107: CabinLayoutOverride = {
  wood: undefined,
  dash: [
    [0.15, 0.065], [0.3, 0.08], [0.355, 0.065], [0.372, 0.025], [0.36, -0.17],
    [0.33, -0.23], [0.12, -0.25], [0.045, -0.22], [0.045, -0.06],
  ],
  fascia: [[0.372, 0.025], [0.36, -0.17]],
  binnacle: [[0.24, 0.075], [0.27, 0.165], [0.42, 0.175], [0.455, 0.163], [0.455, 0.148], [0.385, 0.143], [0.385, -0.008], [0.33, -0.008]],
  binnacleHalf: 0.222,
  cluster: 0.385,
  clusterFace: { right: 0, up: 0.0675, half: [0.2, 0.07], colour: COLOURS.cluster, frame: 'black' },
  gauges: [
    { channel: 'rpm', right: -0.085, up: 0.0675, radius: 0.054, full: 8000, ...BIG },
    { channel: 'speed', right: 0.085, up: 0.0675, radius: 0.054, full: 180, ...BIG },
    { channel: 'vacuum', right: -0.172, up: 0.1, radius: 0.022, ...SMALL },
    { channel: 'temp', right: -0.172, up: 0.035, radius: 0.022, ...SMALL },
    { channel: 'fuel', right: 0.172, up: 0.1, radius: 0.022, ...SMALL },
    { channel: 'volts', right: 0.172, up: 0.035, radius: 0.022, ...VOLT_DIAL },
  ],
  lamps: { right: 0, up: 0.0675, cols: 1, pitch: 0.016, show: ['turn', 'side', 'beam', 'fuel', 'brake', 'oil', 'charge'] },
  stack: { half: 0.1 },
  vents: [{ dy: -0.04 }, { x: 0.06, dy: -0.1 }, { x: -0.06, dy: -0.1 }],
  glovebox: { x: -0.34, dy: -0.1, half: [0.19, 0.068] },
  hazard: [0, -0.1],
  lights: { right: LAYOUTS.classic.seatX - 0.075, dy: -0.2, kind: 'rocker' },
  rockers: { on: 'fascia', at: [[0.025, -0.2], [-0.025, -0.2], [-0.075, -0.2]] },
  radio: [0, -0.26],
  ashtray: [0, -0.33],
  wheel: { ...LAYOUTS.classic.wheel, hub: 'pad' },
};

// The VAZ-2110 on the Samara platform, read off two Wikimedia Commons photos (no
// drawing of the dash was found): "Sporty Lada - Flickr - SergeyRod (3).jpg" (CC BY-SA
// 2.0, a 2004 Lada 112 Cup car: the whole dash from behind the driver's seat, radio
// out) and "2005Lada111Interior.JPG" (CC BY-SA 3.0, a 2005 Lada 111: cluster hood,
// vents, heater and stack close up). Scale: the stack's radio bays are 1-DIN (ISO 7736,
// 182 mm wide = 215 px in the first photo), 0.85 mm/px across and 0.9 mm/px up the
// stack; the dash's planes stand at about the same distance from that camera, so the
// same scale is used for the cluster (about ±15%). Heights are hung from the Samara
// cluster's height (dials 0.015 over the belt, the wheel is the Samara's), photo y px
// below the dials' centres (y 215) at 0.9 mm/px. Pixels (x, y) are on the first photo's
// 1600 x 1200 original; the readings are in measurements-2110.md ("Dashboard").

/** The 2110's dash section over the stack and the glovebox (`CABIN_2110.dash`). */
const DASH_2110: readonly P2[] = [
  [0.22, -0.005], [0.33, 0.008], [0.365, 0.002], [0.378, -0.02], [0.455, -0.34],
  [0.42, -0.37], [0.15, -0.38], [0.045, -0.33], [0.045, -0.12],
];
/** Before the driver: the same face down to the knee panel's foot, -0.29. */
const DASH_2110_DRIVER: readonly P2[] = [
  [0.22, -0.005], [0.33, 0.008], [0.365, 0.002], [0.378, -0.02], [0.443, -0.29],
  [0.415, -0.315], [0.15, -0.33], [0.045, -0.3], [0.045, -0.12],
];
/** At the doors: an end cap 0.11-0.12 m shallower, its foot at -0.14, its underside down to the firewall. */
const DASH_2110_END: readonly P2[] = [
  [0.17, -0.005], [0.235, 0.004], [0.255, 0], [0.262, -0.02], [0.275, -0.14],
  [0.255, -0.165], [0.1, -0.33], [0.045, -0.33], [0.045, -0.12],
];

/**
 * VAZ-2110: a tall fascia leaning back to a long sloping top, a deep hood over the
 * cluster (tachometer left, speedometer right, a small dial outboard of each) with two
 * big rockers on its right flank, two large vents side by side over the heater panel's
 * two knobs and the hazard button, the radio low in a stack running down to the
 * tunnel, a big glovebox lid and a two-spoke wheel with a wide pad.
 */
export const CABIN_2110: CabinLayoutOverride = {
  // A tall face leaning back 13.5 degrees as the stack does, from under the top's rounded
  // edge down to -0.34 over the stack and the glovebox (its lid's foot is lower still,
  // y 690, -0.41). The top falls to it from the screen, as the large top seen past the
  // stack does.
  dash: DASH_2110,
  // The driver's half stops at the knee panel's foot (y 555, -0.29) on the same face, its
  // underside 5 cm higher, and both ends are shallow end caps: on the photo the door
  // shows past the end vent's pod, its inner handle level with the vent and the door's
  // panel open below it to the floor, and the manual's pictures of the dash's removal
  // (vaz-rukovodstvo.ru 8-15) show its lower ends forward at the kick panels. Over the
  // last 5 cm the face runs forward to an end at ds 0.26-0.275 down to -0.14, its
  // underside then down to the firewall: the door card's handle and crank show past it.
  dashLoft: [
    [-1, DASH_2110_END], [-0.93, DASH_2110], [-0.55, DASH_2110], [0, DASH_2110],
    [0.2, DASH_2110], [0.55, DASH_2110_DRIVER], [0.93, DASH_2110_DRIVER], [1, DASH_2110_END],
  ],
  fascia: [[0.378, -0.02], [0.455, -0.34]],
  // Hood over the cluster, standing proud of the face. Half width: the cluster's centre
  // (x 802) to the switch pod's outer edge (x 1010), 208 px. Its lip 0.11 over the dials
  // (hood top y 92); the cluster face from 0.05 under them (y 270) up to 0.08 over (y 130),
  // here 0.095 to take the kit's taller rockers.
  binnacle: [[0.25, -0.01], [0.275, 0.115], [0.43, 0.14], [0.5, 0.13], [0.505, 0.115], [0.472, 0.11], [0.472, -0.035], [0.4, -0.03]],
  binnacleHalf: 0.175,
  clusterFace: { right: 0, up: 0.035, half: [0.125, 0.065], colour: COLOURS.cluster, frame: 'black' },
  gauges: [
    // Dial centres 105 px apart (x 750, 855), numerals' ring 45 px in radius.
    { channel: 'rpm', right: -0.044, up: 0.015, radius: 0.037, full: 8000, ...BIG },
    { channel: 'speed', right: 0.044, up: 0.015, radius: 0.037, full: 180, ...BIG },
    // Right small dial 82 px outboard of the speedometer and 25 px lower (x 937, y 242),
    // about 22 px in radius. Its left twin is hidden by the wheel in both photos and is
    // placed by symmetry; which dial reads fuel and which temperature is not legible.
    { channel: 'temp', right: -0.11, up: -0.01, radius: 0.0185, ...SMALL },
    { channel: 'fuel', right: 0.11, up: -0.01, radius: 0.0185, ...SMALL },
  ],
  // Warning lamps: neither photo makes them out under the hood, so the 2110's set lies in
  // one row across the face's top, between the dials' bezels and the hood's lip.
  lamps: { right: 0, up: 0.08, cols: 8, pitch: 0.0145, show: ['turn', 'side', 'beam', 'fuel', 'check', 'oil', 'charge', 'brake'] },
  // Two square rockers on the hood's right flank, 170 px right of the cluster's centre,
  // 60 and 18 px over the dials (fog lamps and rear screen heater in the 2005 photo);
  // set 0.056 apart, not 0.038, since the kit's rocker is taller than the 40 mm square one.
  // The light switch mirrors the top one on the left flank: no photo shows that flank.
  rockers: { on: 'cluster', at: [[0.15, 0.078], [0.15, 0.022]] },
  lights: { right: -0.15, dy: 0.078, kind: 'rocker', on: 'cluster' },
  // End vents: the driver's (x 500, y 300) about 0.08 square, 302 px (0.257) outboard of
  // the column (x 0.617), lowered 8 mm to clear the hood; set at ±0.58 so they stay on
  // the face inside the end caps. The centre pair 0.1 x 0.075 each, 130 px apart (x 1126,
  // 1255; y 311).
  vents: [
    { x: 0.58, dy: -0.07, half: [0.04, 0.04] },
    { x: -0.58, dy: -0.07, half: [0.04, 0.04] },
    { x: 0.056, dy: -0.07, half: [0.05, 0.038] },
    { x: -0.056, dy: -0.07, half: [0.05, 0.038] },
  ],
  // Heater panel 250 x 102 px (x 1015-1265, y 418-520), knobs 83 px apart at y 472,
  // their rings 30 px in radius; the hazard button at its top right (x 1243, y 457).
  heater: { dy: -0.215, half: [0.105, 0.046], knobs: [0.035, -0.035], radius: 0.025 },
  hazard: [-0.085, -0.2],
  // Stack 275 px wide (x 1000-1275); the radio in the lower of its two bays (y 620, the
  // 2005 photo); a pocket at its foot (y 700) is taken as the ashtray.
  stack: { half: 0.115 },
  radio: [0, -0.35],
  ashtray: [0, -0.42],
  // Lid from 258 px right of the stack's centre (x 1400) outwards, its top at y 440 just
  // under the heater panel's. It reaches lower in the photo (y 690) than the face may go
  // (above); its outer end is out of the photo.
  glovebox: { x: -0.41, dy: -0.26, half: [0.17, 0.075] },
  // Spokes 100 degrees apart either side of six o'clock (the 2004 wheel stands turned a
  // quarter); the rim's tube 30 px across on a 250 px radius. Size is the Samara's: no
  // photo scales the wheel.
  wheel: { ...LAYOUTS.samara.wheel, rim: 0.011, spokes: [-40, 220] },
  // Front door card (vaz-rukovodstvo.ru 8-10, the card with its armrest grip off): the
  // inner handle's lever stands at the grip's top, 29% of the card's length behind its
  // front edge and 19% of its height under the belt; the crank's shaft 21% behind the
  // front and 54% down. On a 1.0 m card 0.64 m tall (belt 0.94, door bottom 0.30), read
  // on a door seen at a slant, so a little further back than drawn: 0.30 / -0.12 and
  // 0.22 / -0.35.
  frontDoor: { handle: [0.3, -0.12], crank: [0.22, -0.35] },
};

// The VAZ-1111 «Ока» of 1988-1996 on the Samara's furniture, read off these sources:
//  - Wikimedia Commons "Oka-Innenraum.jpg" (CC BY 4.0; an early car, 4288 x 2848): the
//    dash from the driver's door, cluster, switches, heater sliders, wheel, lever.
//  - The factory four-view https://3dcar.ru/media/blueprints/full/vaz/vaz_1111_oka.jpg
//    (2200 x 1500, 3200 mm over 1176 px): the seats and the rear bench drawn dashed.
// Scale on the photo: the column (hub x 1563) to the heater panel's centre line (x 3430),
// 1867 px, is the driver's seat line 0.31 off the centre [E: the classic's 0.37 scaled
// by the cabin, 1.2 / 1.36], so 0.17 mm/px at the fascia; on the cluster its window's
// 1000 px read 0.19 m [E: the same scale, the window a little nearer]. Heights hang
// from the Samara's cluster (window 0.03 over the belt) [E].

/**
 * VAZ-1111: a plain black dash, a shallow box hood over a long window holding a wide
 * flat speedometer scale 0-160 with the fuel dial at its left end, warning lamps in a
 * row under it, three rockers left of the column and two right of it, two round face
 * vents over the heater's sliders in the middle, an open shelf before the passenger,
 * a thick two-spoke wheel (one spoke up-left, one down), a short lever, no console.
 */
export const CABIN_1111: CabinLayoutOverride = {
  // Hip and bench from the drawing: driver's hip 0.92 behind the screen's foot [D], the
  // bench's hip 0.75 behind it [D], the cabin being 0.2 m shorter than the Samara's.
  hip: 0.92,
  // It stands between the rear wheel-house covers, its base 2 cm off them.
  bench: { from: 'hip', offset: 0.75, clear: 0.04 },
  seatX: 0.31,
  bolsters: false,
  console: undefined,
  // Hood 0.27 across (photo x 1120-2520 at the cluster's scale) [P], widened to 0.33 so
  // its face reaches the flank rockers' line [E].
  binnacleHalf: 0.165,
  clusterFace: { right: 0, up: 0.013, half: [0.15, 0.045], colour: COLOURS.cluster, frame: 'black' },
  gauges: [
    // The scale's 0 to 160 marks over 0.133 m, its centre 0.017 right of the window's [P];
    // drawn as a ribbon (the needle really pivots low, sweeping a flat arc).
    { kind: 'ribbon', channel: 'speed', right: 0.017, up: 0.032, half: [0.066, 0.014], full: 160, ticks: 9 },
    // Fuel dial (0, 1/2, 1) inside the window's left end [P]; the right end is behind
    // the rim in every photo: the temperature dial there, as far right of the scale's
    // centre as the fuel dial is left of it, clear of the ribbon [E].
    { channel: 'fuel', right: -0.079, up: 0.026, radius: 0.013, ...SMALL },
    { channel: 'temp', right: 0.113, up: 0.026, radius: 0.013, ...SMALL },
  ],
  // Square lamps under the window, about 0.03 apart [P]: brake, oil, charge on the left,
  // turn on the right; the rest behind the pad and rim [E].
  lamps: { right: 0, up: -0.008, cols: 6, pitch: 0.03, show: ['brake', 'oil', 'charge', 'beam', 'turn', 'side'] },
  // Rockers under the hood's left flank 0.08-0.14 left of the column (the outer one the
  // lights [E]) and two right of the column 0.10/0.13 off the centre line [P].
  lights: { right: -0.14, dy: -0.1, kind: 'rocker' },
  rockers: { on: 'fascia', at: [[0.43, -0.1], [0.4, -0.1], [0.13, -0.16], [0.1, -0.16]] },
  // Round vents (about 0.075 across) 0.06 either side of the centre line [P].
  vents: [
    { x: 0.058, dy: -0.075, half: [0.036, 0.03] },
    { x: -0.058, dy: -0.075, half: [0.036, 0.03] },
  ],
  // Two horizontal sliders in a panel 0.11 x 0.04 [P], drawn as two small knobs.
  heater: { dy: -0.17, half: [0.055, 0.02], knobs: [0.025, -0.025], radius: 0.009 },
  hazard: [0, -0.125],
  // The round blank right of the heater (photo x 4040) taken as the ashtray [P]; no radio
  // in the early car: its slot stays under the heater [E].
  ashtray: [-0.11, -0.19],
  radio: [0, -0.215],
  // An open shelf, not a lid: its face where the lid would be [E].
  glovebox: { x: -0.38, dy: -0.15, half: [0.13, 0.045] },
  // Rim 0.36 across with a thick tube (22 px on 458 in the photo's thumbnail) [P/E].
  wheel: { ...LAYOUTS.samara.wheel, ds: 0.56, radius: 0.18, rim: 0.016, spokes: [34, 270] },
  gear: { ds: 0.62, height: 0.24, lean: 0.04 },
};

// The Volgas on the classic's furniture, read off Wikimedia Commons photos (readings in
// measurements-volga.md §4). Both share the 24's doors and cowl, so the dash's half width
// is the same 0.756. The column stands at seatX 0.40: the GAZ-24's instrument panel,
// centred on the column, stands 0.41 off the centre line [P]; the classic's 0.37 would
// leave the wide Volga's driver hard by the tunnel.
//  - GAZ-24: "GAZ-24 (1st generation) "Volga" (interior).jpg" (public domain, 1920 x 1440,
//    square through the screen from the back seat): the fascia band's ~1700 px are the
//    dash's 1.512 m, 0.885 mm/px; centre line x 970 (defroster grille, radio, ashtray);
//    heights hung from the band's top (y 656) at 0.073 over the belt [E: just under the
//    top roll, which meets the scuttle 0.1 over the belt]. The cluster's layout from
//    "GAZ 24 Volga interior.jpg" (CC BY-SA 4.0, User:CLI) and
//    "24-interior-early-1974.jpg" (public domain). The wheel: 420 across (owners' tape
//    measurements, drive2.ru) [E], a thin grip [P].
//  - GAZ-31029: "31029-int-2.jpg" (public domain, User:DL24, 1152 x 768, from behind the
//    driver's seat), the only 31029 interior on Commons: the column (wheel's hub over the
//    cluster's centre, x 465) to the centre line (vents, heater, band: x 735) is seatX's
//    0.40, 1.48 mm/px; heights hung from the centre band's top (y 283) at 0.055 [E]. The
//    wheel about 400-410 across (owners, forum.allgaz.ru) [E], its grip thin [P].

/**
 * GAZ-24: a long padded top roll over a flat aluminium band across the whole car (the
 * early cars'): before the driver a long chrome-framed blue-grey panel with the ribbon
 * speedometer across its top, small window gauges under it (ammeter over fuel at its left
 * end, temperature, oil pressure) and the clock at its right end; the radio in the middle,
 * a long glovebox lid, round vents at both ends; knobs on the black panel under the band;
 * a big thin wheel with a chrome horn bar across it.
 */
export const CABIN_GAZ24: CabinLayoutOverride = {
  seatX: 0.4,
  wood: undefined,
  // The top roll level from the scuttle, its lip overhanging the band by 2 cm [P], the
  // band and the black panel under it in one upright face (band y 656-815, panel to y 897)
  // [P].
  dash: [
    [0.12, 0.1], [0.3, 0.098], [0.352, 0.092], [0.36, 0.08], [0.338, 0.075], [0.338, -0.14],
    [0.315, -0.18], [0.12, -0.2], [0.045, -0.18], [0.045, -0.06],
  ],
  fascia: [[0.338, 0.075], [0.338, -0.14]],
  band: { dy: [-0.066, 0.073], colour: 0xa7aaa9 },
  // The instrument panel: its window x 205-812, y 680-798 [P], nearly centred on the
  // column, its outer end short of the end vent; a flat panel 8 mm proud of the band.
  binnacle: [[0.3, 0.058], [0.346, 0.058], [0.346, -0.058], [0.3, -0.058]],
  binnacleHalf: 0.268,
  cluster: 0.346,
  clusterFace: { right: 0, up: 0, half: [0.257, 0.05], colour: 0x6c8496, frame: 'chrome' },
  gauges: [
    // Numerals 20 at x 425, 180 at x 630: 0-180 over 0.204 m, centred on the column, at
    // y 727 [P].
    { kind: 'ribbon', channel: 'speed', right: 0, up: 0.014, half: [0.111, 0.0177], full: 180, ticks: 10 },
    // Small windows [P, CLI: fractions of the panel]: the ammeter over the fuel gauge at the
    // left end, temperature (80-120) under the scale's start, oil pressure (0-6) under its
    // end. No current channel: the ammeter reads the voltmeter's, its zero at 14 V [E].
    { kind: 'ribbon', channel: 'volts', right: -0.225, up: 0.016, half: [0.024, 0.009], min: 12, full: 16, ticks: 3 },
    { kind: 'ribbon', channel: 'fuel', right: -0.225, up: -0.022, half: [0.024, 0.009], full: 1, ticks: 3 },
    { kind: 'ribbon', channel: 'temp', right: -0.079, up: -0.025, half: [0.024, 0.009], full: 1, ticks: 3 },
    { kind: 'ribbon', channel: 'oil', right: 0.115, up: -0.025, half: [0.024, 0.009], full: 6, ticks: 4 },
  ],
  // Two red lamps between the small windows and the scale's start [P]; which four the
  // car has there is not legible [E].
  lamps: { right: -0.155, up: -0.005, cols: 2, pitch: 0.03, show: ['turn', 'beam', 'oil', 'brake'] },
  // The clock at the panel's right end, x 745-800 [P]: square on the car, round here.
  clock: { right: 0.226, up: 0, radius: 0.02 },
  // Round vents with chrome rims at the band's ends (x 146 and 1763, 37 px in radius) [P],
  // drawn 0.03 so the driver's clears the panel.
  eyeballs: { radius: 0.03, at: [[0.715, 0.018], [-0.715, 0.018]] },
  // The radio in the middle of the band (x 878-1104, y 695-750) [P]; the lid x 1174-1708,
  // y 659-793, dark in a bright frame [P].
  radio: [0, 0.017],
  glovebox: { x: -0.417, dy: 0.013, half: [0.236, 0.057] },
  // On the black panel: the ashtray's chrome pull in the middle (y 860) [P]; three knobs
  // left of the column (x 244, 323, 390; y 866), the middle one taken for the lights, and a
  // knob right of it (x 799) where the kit's hazard button stands: the early car had none [E].
  ashtray: [0, -0.106],
  lights: { right: -0.173, dy: -0.111, kind: 'knob' },
  hazard: [0.151, -0.111],
  // 0.2005 to the grip's centre, a 19 mm grip; the bar across the hub dips a little in the
  // middle (spokes 8 degrees under the level) [P], chrome; its middle drawn as a round boss.
  wheel: { ...LAYOUTS.classic.wheel, dy: 0, radius: 0.2005, rim: 0.0095, spokes: [-8, 188], hub: 'round', chrome: true },
};

/**
 * GAZ-31029: a black padded dash with a wood-grain band across it; before the driver a
 * raised wood panel under a hood with two big dials (a combined gauge left, the
 * speedometer right) and the clock between them; the hazard button and the radio's slot
 * on the band in the middle, two big vents over the heater's sliders and a console down to
 * the tunnel, a wood glovebox lid, slatted vents at the ends; a wheel with a big pad and
 * three spokes.
 */
export const CABIN_GAZ31029: CabinLayoutOverride = {
  seatX: 0.4,
  wood: undefined,
  // Top level from the scuttle, rounding down to an upright face (band y 283-335) and the
  // black panel under the lid (to y 480: -0.24); the face stops at -0.2 and the console
  // carries the heater on down [P/E].
  dash: [
    [0.12, 0.1], [0.3, 0.095], [0.34, 0.085], [0.35, 0.06], [0.35, -0.2],
    [0.325, -0.235], [0.12, -0.25], [0.045, -0.22], [0.045, -0.06],
  ],
  fascia: [[0.35, 0.06], [0.35, -0.2]],
  band: { dy: [-0.022, 0.055], colour: COLOURS.wood },
  // The wood panel x 326-605, y 237-355 [P] in a black surround under a hood whose lip
  // stands over it [P], 2 cm proud of the face.
  binnacle: [[0.25, 0.1], [0.28, 0.142], [0.37, 0.148], [0.392, 0.14], [0.392, 0.134], [0.37, 0.132], [0.37, -0.06], [0.33, -0.06]],
  binnacleHalf: 0.222,
  cluster: 0.37,
  clusterFace: { right: 0, up: 0.0355, half: [0.205, 0.0875], colour: COLOURS.wood, frame: 'black' },
  gauges: [
    // Left pod centre x 383, speedometer x 548, faces about 40 px in radius [P]. The left
    // dial is a combined gauge whose other scales are not legible: fuel across its top
    // (red marks on the right [P]) and temperature across its bottom, as the 2105's [E].
    { channel: 'fuel', right: -0.12, up: 0.043, radius: 0.055, full: 1, sweep: 140 * (Math.PI / 180), rest: 160 * (Math.PI / 180), ticks: 3 },
    { channel: 'temp', right: -0.12, up: 0.043, radius: 0.055, full: 1, sweep: -140 * (Math.PI / 180), rest: 200 * (Math.PI / 180), ticks: 3, bare: true },
    // 0-180 km/h [P].
    { channel: 'speed', right: 0.123, up: 0.043, radius: 0.055, full: 180, ...BIG },
  ],
  // The small dial between them, its numerals 9, 12, 3: a clock (x 455, y 280) [P].
  clock: { right: 0, up: 0.059, radius: 0.026 },
  // The lamps are in the speedometer's face on the car [P]; here in a row under each dial.
  lamps: { right: 0.123, up: -0.035, cols: 4, pitch: 0.016, show: ['turn', 'beam', 'side', 'brake'] },
  lenses: { right: -0.12, up: -0.035, cols: 3, pitch: 0.016, show: ['fuel', 'oil', 'charge'] },
  // Two big vents side by side under the band (x 645-717 and 744-823, y 366-418), the
  // heater's sliders under them (x 656-829, y 427-473, drawn as two knobs), a console
  // down to the tunnel [P]; slatted end vents (driver's x 263-315, y 286-320) [P], the
  // passenger's by symmetry [E].
  stack: { half: 0.14 },
  vents: [
    { x: 0.075, dy: -0.106, half: [0.05, 0.036] },
    { x: -0.075, dy: -0.106, half: [0.05, 0.036] },
    { x: 0.67, dy: 0.025, half: [0.035, 0.022] },
    { x: -0.67, dy: 0.025, half: [0.035, 0.022] },
  ],
  heater: { dy: -0.192, half: [0.12, 0.032], knobs: [0.04, -0.04], radius: 0.012 },
  // On the band: the red hazard button (x 630, y 307) and the radio's slot in the middle
  // (x 656-803, empty on the photo) [P]; the lid x 866 to past the frame, in wood with a
  // black pull [P], its outer end by symmetry with the cluster [E].
  hazard: [0.155, 0.019],
  radio: [0, 0.017],
  glovebox: { x: -0.407, dy: 0.0145, half: [0.21, 0.04], colour: COLOURS.wood },
  // Two round buttons under the cluster right of the column (x 544, 583; y 395) [P], the
  // first taken for the lights [E]; the ashtray low on the console [E].
  lights: { right: 0.117, dy: -0.111, kind: 'knob' },
  ashtray: [0, -0.33],
  // 0.193 to the grip's centre, an 18 mm grip; the pad reaches the rim at nine o'clock,
  // a little under the level, and at six [P]; the right spoke by symmetry [E].
  wheel: { ...LAYOUTS.classic.wheel, dy: 0, radius: 0.193, rim: 0.0095, spokes: [-10, 190, 270], hub: 'pad' },
};

// The UAZ-469 on the Niva's furniture (its four-wheel drive and transfer levers), read off
// Wikimedia Commons "UAZ-early-interior-floor-pedals.jpg" (CC BY 2.0, 1920 x 1440, from
// the driver's seat over the wheel) and the 3151 four-view uaz2.jpg (seats dashed;
// measurements-uaz.md §1.6). On the photo the windscreen's middle post (x 900) is the
// car's centre line and the column's hub stands at x 340: 560 px for seatX 0.40 [E],
// 0.71 mm/px at the dash. Heights are hung from the dials' centre (y 395), 0.04 over the
// belt [E]: no photo shows the belt and the dials together.

/**
 * UAZ-469: a flat steel dash in the body's colour across the car under a short top lip;
 * the speedometer alone right of the column, then in the dash's middle a chrome-framed
 * panel of four small dials (ammeter, oil pressure, temperature, fuel) with four warning
 * lamps over it and a row of knobs and switches under it; a small lid right of the panel,
 * a grab handle before the passenger; a big thin three-spoke wheel; the gear lever and the
 * transfer box's two levers on the tunnel.
 */
export const CABIN_UAZ469: CabinLayoutOverride = {
  seatX: 0.4,
  // The front seat's cushion x 400-510 and its back at the B pillar on the 3151 drawing:
  // hip 0.70 behind the cowl; the rear bench's back at x 700-740, its hip 0.83 behind the
  // front's, standing between the wheel-house covers [D].
  hip: 0.7,
  bench: { from: 'hip', offset: 0.83, clear: 0.04 },
  bolsters: false,
  // An upright steel face (top lip y 230, foot y 500: 0.19 tall) under a lip reaching back
  // 3 cm, its top level from the scuttle [P].
  dash: [
    [0.1, 0.13], [0.31, 0.13], [0.345, 0.115], [0.345, -0.07],
    [0.32, -0.09], [0.12, -0.11], [0.045, -0.1], [0.045, -0.06],
  ],
  fascia: [[0.345, 0.115], [0.345, -0.07]],
  wood: undefined,
  stack: undefined,
  vents: undefined,
  heater: undefined,
  // A flat plate 7 mm proud of the face from the speedometer to the panel's right end
  // (x 560-1075: 0.16-0.52 right of the column) [P].
  binnacle: [[0.3, 0.075], [0.352, 0.075], [0.352, 0.0], [0.3, 0.0]],
  binnacleHalf: 0.185,
  binnacleRight: 0.34,
  cluster: 0.352,
  // The panel x 710-1075, y 345-440 in a chrome frame, black [P].
  clusterFace: { right: 0.39, up: 0.04, half: [0.13, 0.032], colour: COLOURS.cluster, frame: 'chrome' },
  gauges: [
    // Speedometer 0-120 at x 620, 115 px across [P].
    { channel: 'speed', right: 0.2, up: 0.04, radius: 0.038, full: 120, ...BIG },
    // x 755, 850, 935, 1030, 75 px across [P]: the ammeter (-30..30; the voltmeter's
    // channel, its zero at 14 V [E]), oil pressure 0-6 kgf/cm², temperature, fuel.
    { channel: 'volts', right: 0.295, up: 0.04, radius: 0.024, ...SMALL, min: 12, full: 16 },
    { channel: 'oil', right: 0.362, up: 0.04, radius: 0.024, ...SMALL, full: 6, ticks: 4 },
    { channel: 'temp', right: 0.422, up: 0.04, radius: 0.024, ...SMALL },
    { channel: 'fuel', right: 0.49, up: 0.04, radius: 0.024, ...SMALL },
  ],
  // Four round lamps over the panel (x 755-930, y 320): two dark, two red [P].
  lamps: { right: 0.356, up: 0.093, cols: 4, pitch: 0.042, show: ['turn', 'beam', 'oil', 'charge'] },
  // The row under the panel at y 515 (x 765-1010) [P]: the first knob the lights [E], the
  // rest switches; the hazard button (none on the car) at the row's end [E].
  lights: { right: 0.3, dy: -0.045, kind: 'knob' },
  rockers: { on: 'fascia', at: [[0.065, -0.045], [0.03, -0.045], [-0.01, -0.045]] },
  hazard: [-0.075, -0.045],
  // The small lid right of the panel (x 1130-1200, y 345-440) [P]; the radio (none on the
  // car, kept for the game's radio) and the ashtray on the passenger's half [E].
  glovebox: { x: -0.19, dy: 0.04, half: [0.035, 0.032] },
  radio: [-0.45, 0.04],
  ashtray: [-0.45, -0.04],
  // Rim x 50-630 [P]: 0.42 across, a thin grip; three spokes up and a little right, left
  // and a little down, down-right [P]; a steep column [E].
  wheel: { ds: 0.5, dy: 0.0, rake: 35 * (Math.PI / 180), radius: 0.21, rim: 0.011, spokes: [102, -18, 222], hub: 'round' },
  // Gear lever out of the tunnel's front, the two transfer levers beside it (a ball each)
  // [P].
  gear: { ds: 0.5, height: 0.36, lean: 0.08 },
  transfer: {
    ds: 0.56,
    levers: [
      { x: -0.05, height: 0.24, knob: 0.02, lean: [0.03, 0] },
      { x: -0.1, height: 0.24, knob: 0.02, lean: [0.03, -0.01] },
    ],
  },
  // Bare painted floor, the canvas' grey-green inside [E].
  carpet: 0x2c2d26,
  headliner: 0x6f6d58,
};

// The UAZ-2206 on the van's furniture, read off Wikimedia Commons "Uljanowski Awtomobilny
// Sawod 452 (steering wheel).jpg" (CC BY-SA 4.0, Fiver, der Hellseher; 1920 x 1440, from
// the driver's door over the wheel; measurements-uaz.md §1, §3.8). No dimension of the cab
// is known: the wheel's centre (x 0.515, 1.52 high) is the factory front view's
// (measurements-uaz.md §3.6), its rim 0.40 across [D 0.19-0.21 r]; everything else is
// hung off it by the photo's proportions [E].

/**
 * UAZ-2206: a flat painted steel dash under the screen, a deep level shelf on top, the
 * face upright; low on the face right of the column (towards the middle, clear of the
 * wheel's rim), a grey-blue panel of four chrome-ringed dials (the speedometer 0-120 the
 * largest, oil, fuel, temperature) with a row of round warning lamps over them, a knob
 * under them; a large thin two-spoke wheel on a steep column down to the floor; the gear
 * lever and the transfer box's levers out of the floor behind the engine's cover.
 */
export const CABIN_UAZ2206: CabinLayoutOverride = {
  seatX: 0.515, // the wheel's centre [D front view]
  bolsters: false,
  // A deep level shelf from the screen's foot to an upright face, its foot low over the
  // driver's knees [P]; 0.32 deep [E]. The face 0.22 tall, lip to foot [E: the photo's face
  // runs about 1.9 panel heights from the shelf's lip to its foot].
  dash: [
    [0.05, 0.055], [0.3, 0.055], [0.32, 0.04], [0.32, -0.18],
    [0.29, -0.21], [0.1, -0.23], [0.045, -0.2], [0.045, -0.06],
  ],
  fascia: [[0.32, 0.04], [0.32, -0.18]],
  wood: undefined,
  stack: undefined,
  vents: undefined,
  heater: undefined,
  // The instrument panel: a flat plate 6 cm proud of the face, low on it, right of the
  // column towards the dash's middle (its centre 0.045 off the centre line), so from the
  // driver's eye every needle and lamp clears the wheel's rim [owner's review; checked by
  // rays from `kit_driver_eye`]. A narrow strip, the four dials nearly touching: 0.23 x
  // 0.094 inside its frame, 2.5 times as wide as tall [P: about 400 x 160 px].
  binnacle: [[0.3, -0.045], [0.36, -0.045], [0.36, -0.152], [0.3, -0.152]],
  binnacleHalf: 0.125,
  binnacleRight: 0.47,
  cluster: 0.36,
  clusterFace: { right: 0.47, up: -0.096, half: [0.115, 0.047], colour: 0x4a5560, frame: 'chrome' },
  gauges: [
    // From the door's side: oil (0-6), the speedometer 0-120 [P "80 … 120"], fuel [P the
    // pump], temperature; the speedometer about 1.45 times the others [P], the bezels
    // nearly touching [P].
    { channel: 'oil', right: 0.38, up: -0.105, radius: 0.02, ...SMALL, full: 6, ticks: 4 },
    { channel: 'speed', right: 0.44, up: -0.1, radius: 0.029, full: 120, ...BIG },
    { channel: 'fuel', right: 0.505, up: -0.105, radius: 0.02, ...SMALL },
    { channel: 'temp', right: 0.56, up: -0.105, radius: 0.02, ...SMALL },
  ],
  // The round lamps over the dials: red, white, amber [P].
  lamps: { right: 0.44, up: -0.06, cols: 4, pitch: 0.025, show: ['charge', 'side', 'turn', 'beam'] },
  // The lights' knob and the hazard button (none on the car, kept for the game) on the
  // face past the panel's right end, above its lip so the plate does not hide them [E].
  lights: { right: 0.66, dy: -0.1, kind: 'knob' },
  rockers: { on: 'fascia', at: [[0.75, -0.15]] },
  hazard: [-0.2, -0.1],
  // The ashtray left of the panel, behind the wheel's rim [E]. The radio (none on the
  // car, kept for the game's radio) hung under the face's foot, its top tucked into it,
  // between the driver's knee and the engine's cover [E]; a small lid before the
  // passenger [E].
  radio: [0.29, -0.205],
  ashtray: [0.24, -0.11],
  glovebox: { x: -0.45, dy: -0.08, half: [0.14, 0.06] },
  // Rim 0.40 across, a thin grip; two spokes, up-left and down-right, and a round boss
  // [P]; the column steep, down into the dash's face and on under it to the floor [P].
  // Rake 52: the hub's axis meets the face (ds 0.32) at dy -0.08, mid face; at 65 it ran
  // 3 cm under the face's foot, so the column hung clear of the dash with nothing round it.
  wheel: { ds: 0.53, dy: 0.19, rake: 52 * (Math.PI / 180), radius: 0.2, rim: 0.012, spokes: [40, 220], hub: 'round', toFloor: true },
  pedals: { pivot: [0.15, -0.22], pad: [0.3, 0.13] },
};

/**
 * Name of an empty node at the driver's eye, in the kit frame. render/carmodel.ts reads
 * it after the body fit as the default cabin camera (`CarModelMeasure.cabinEye`) and
 * takes it out of the template.
 */
export const KIT_DRIVER_EYE_NODE = 'kit_driver_eye';
/** The same over the rear bench's left seat; the right one is its mirror. */
export const KIT_REAR_EYE_NODE = 'kit_rear_eye';
/**
 * Name of the group holding the rear bench's meshes, inside `kit_cabin`: the bench is
 * one piece with no channel, and getting in (player/interaction.ts) has to know it.
 */
export const KIT_BENCH_NODE = 'kit_bench';
/**
 * Name of the courtesy lamp's group (its lens, the `dome` switch), in the car frame and
 * unturned: the Vehicle hangs the cabin's light from it (`Vehicle.syncDomeLight`).
 */
export const KIT_DOME_LAMP_NODE = 'kit_dome_lamp';
/** The rear bench's two seats' centre lines off the car's centre, where its inserts are. */
const BENCH_SEAT_X = 0.25;
/** Seated eye over the driver's cushion top, metres: a mid-size adult sitting upright. */
const SEATED_EYE = 0.74;
/** The eye's run behind the hip: the torso leans back with the backrest. */
const EYE_BEHIND_HIP = 0.1;
/** Least room between the eye and the headliner over it. */
const EYE_HEADROOM = 0.13;

export function buildInterior(ctx: KitContext): void {
  new Cabin(ctx).build();
}

/** A car's cabin layout: its platform's, with its own `cabinLayout` over it. */
function layoutOf(frame: BodyFrame): Layout {
  return { ...LAYOUTS[frame.spec.platform], ...frame.spec.cabinLayout };
}

/** The rear bench's hip along the car, for a frame and its layout. */
function benchHip(frame: BodyFrame, lay: Layout): number {
  return lay.bench.from === 'rearBase' ? frame.rearBase + lay.bench.offset : frame.cowl + lay.hip + lay.bench.offset;
}

/**
 * Where a hatch's or an estate's load space starts: the back of the rear bench's base.
 * bay.ts lays the load floor from here, so the two never overlap or leave a gap.
 */
export function loadSpaceStart(frame: BodyFrame): number {
  return benchHip(frame, layoutOf(frame)) + BENCH_BACK;
}

/**
 * Where a van's engine cover ends behind the cowl (`Layout.engineCover`): bay.ts starts
 * the gearbox there, under the floor behind the engine. The cowl without a cover.
 */
export function engineCoverEnd(frame: BodyFrame): number {
  return frame.cowl + (layoutOf(frame).engineCover?.ds1 ?? 0);
}

/** The cabin's floor pan: the shell's flat underbody plus `floorRise` (`FLOOR_RISE`). */
function cabinFloor(frame: BodyFrame): number {
  return frame.station(frame.cowl + 0.5).sill + (layoutOf(frame).floorRise ?? FLOOR_RISE);
}

/** Underside of the headliner (the shell's roof lining) at half width x and position s. */
function headlinerUnder(frame: BodyFrame, x: number, s: number): number {
  const cab = frame.spec.cabin;
  const xr = cab.railHalf - cab.railInset;
  return cab.rail + cab.railRise + frame.crownAt(x / xr) - LINING_DEPTH - frame.roofDrop(s);
}

/**
 * The driver's eye in the kit frame, over his cushion and kept under the headliner: the
 * `KIT_DRIVER_EYE_NODE`, and what the mirrors are turned to (exterior.ts as well).
 */
export function driverEyeAt(frame: BodyFrame): Vec3 {
  const lay = layoutOf(frame);
  const s = frame.cowl + lay.hip + EYE_BEHIND_HIP;
  const y = Math.min(cabinFloor(frame) + lay.cushion + SEATED_EYE, headlinerUnder(frame, lay.seatX, s) - EYE_HEADROOM);
  return [lay.seatX, y, frame.z(s)];
}

// ---- small geometry ----

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** `v` turned about X by `a`. */
function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A colour lightened (k > 1) or darkened (k < 1). */
function shade(hex: number, k: number): number {
  const ch = (shift: number): number => clamp(Math.round(((hex >> shift) & 0xff) * k), 0, 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Box with all twelve edges chamfered by `c`, in the builder's current frame; the +Y
 * face's X half width is scaled by `taper`. Reads as a moulded cushion, not a slab.
 */
function pad(b: PartBuilder, slot: KitSlot, centre: Vec3, half: Vec3, c: number, taper = 1): void {
  const [cx, cy, cz] = centre;
  const [hx, hy, hz] = half;
  // A corner's three points, each flush with one face (`axis`) and chamfered back on the other two.
  const pt = (sx: number, sy: number, sz: number, axis: 0 | 1 | 2): Vec3 => {
    const wx = sy > 0 ? hx * taper : hx;
    return [
      cx + sx * (axis === 0 ? wx : wx - c),
      cy + sy * (axis === 1 ? hy : hy - c),
      cz + sz * (axis === 2 ? hz : hz - c),
    ];
  };
  for (const s of [-1, 1]) {
    b.quad(slot, pt(s, -1, -1, 0), pt(s, 1, -1, 0), pt(s, 1, 1, 0), pt(s, -1, 1, 0));
    b.quad(slot, pt(-1, s, -1, 1), pt(1, s, -1, 1), pt(1, s, 1, 1), pt(-1, s, 1, 1));
    b.quad(slot, pt(-1, -1, s, 2), pt(1, -1, s, 2), pt(1, 1, s, 2), pt(-1, 1, s, 2));
  }
  for (const a of [-1, 1]) {
    for (const d of [-1, 1]) {
      b.quad(slot, pt(a, d, -1, 0), pt(a, d, 1, 0), pt(a, d, 1, 1), pt(a, d, -1, 1));
      b.quad(slot, pt(-1, a, d, 1), pt(1, a, d, 1), pt(1, a, d, 2), pt(-1, a, d, 2));
      b.quad(slot, pt(a, -1, d, 0), pt(a, 1, d, 0), pt(a, 1, d, 2), pt(a, -1, d, 2));
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.tri(slot, pt(sx, sy, sz, 0), pt(sx, sy, sz, 1), pt(sx, sy, sz, 2));
}

/** Square-section bar from p0 to p1; `up` picks which way its `halfH` faces. */
function beam(b: PartBuilder, slot: KitSlot, p0: Vec3, p1: Vec3, halfW: number, halfH: number, up: Vec3 = [0, 1, 0]): void {
  const d = norm(sub(p1, p0));
  let side = cross(d, up);
  if (Math.hypot(...side) < 1e-6) side = cross(d, [0, 0, 1]);
  side = norm(side);
  const u = cross(side, d);
  const ring = (p: Vec3): Vec3[] =>
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => add(p, add(scale(side, sx! * halfW), scale(u, sy! * halfH))));
  const r0 = ring(p0);
  const r1 = ring(p1);
  b.bridge(slot, r0, r1, true);
  b.poly(slot, r0);
  b.poly(slot, r1);
}

/** Truncated cone along Y from (y0, r0) through each later (y, r): a gaiter. */
function gaiter(b: PartBuilder, slot: KitSlot, centre: Vec3, rings: readonly P2[], segments: number): void {
  const loops = rings.map(([y, r]) => {
    const loop: Vec3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      loop.push([centre[0] + Math.cos(a) * r, centre[1] + y, centre[2] + Math.sin(a) * r]);
    }
    return loop;
  });
  for (let i = 0; i + 1 < loops.length; i++) b.bridge(slot, loops[i]!, loops[i + 1]!, true);
}

/** A closed outline of points in a plane of constant X, filled (it may be concave). */
function fillX(b: PartBuilder, slot: KitSlot, ring: readonly Vec3[]): void {
  const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[2], p[1])), []);
  for (const [i, j, k] of tris) b.tri(slot, ring[i!]!, ring[j!]!, ring[k!]!);
}

/** A face to mount fittings on: local X is the driver's right, Y up the face, Z out towards the cabin. */
interface Mount {
  readonly matrix: THREE.Matrix4;
  readonly u: Vec3;
  readonly n: Vec3;
  at(x: number, y: number, z: number): Vec3;
}

/** A face at `origin` looking rearward, its top leaning back by `recline` (rad). */
function mount(origin: Vec3, recline: number): Mount {
  const u: Vec3 = [-1, 0, 0];
  const v: Vec3 = [0, Math.cos(recline), Math.sin(recline)];
  const n: Vec3 = [0, Math.sin(recline), -Math.cos(recline)];
  const matrix = new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n))
    .setPosition(...origin);
  return { matrix, u, n, at: (x, y, z) => add(origin, add(scale(u, x), add(scale(v, y), scale(n, z)))) };
}

const _inlay = new THREE.Vector3();

/**
 * Cuts away what `b` holds under a flat outline within `depth` of its plane: the hole a
 * decal or a sliding lamp face fills. Corners in `b`'s current frame.
 */
function cutLocal(b: PartBuilder, corners: readonly Vec3[], depth = 0.0005): void {
  const poly = corners.map((p): Vec3 => {
    _inlay.set(p[0], p[1], p[2]).applyMatrix4(b.matrix);
    return [_inlay.x, _inlay.y, _inlay.z];
  });
  b.cut([{ poly, reach: depth }]);
}

/**
 * A flat decal (a dial, an insert, a lens, a badge) laid in the surface it sits on: the
 * surface under it is cut away first (`cutLocal`), so the decal is the only face there
 * and nothing fights it in depth. Corners in `b`'s current frame, in the surface's plane.
 */
function inlay(b: PartBuilder, slot: KitSlot, corners: readonly Vec3[], depth = 0.0005): void {
  cutLocal(b, corners, depth);
  b.poly(slot, corners);
}

/** A flat rectangle's corners on a mount's face (its matrix pushed), centred at (cx, cy), `z` off the face. */
function rectCorners(cx: number, cy: number, hx: number, hy: number, z: number): Vec3[] {
  return [[cx - hx, cy - hy, z], [cx + hx, cy - hy, z], [cx + hx, cy + hy, z], [cx - hx, cy + hy, z]];
}

/**
 * A dial's needle on mount `m`'s face, pointing at `angle` (rad, 0 = driver's right), `z`
 * off the face, from `k0` of the dial's radius `r` out to 0.85 of it.
 */
function needle(b: PartBuilder, m: Mount, r: number, angle: number, z: number, k0: number, slot: KitSlot): void {
  const d: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
  const p: Vec3 = [-d[1], d[0], 0];
  const pt = (k: number, w: number): Vec3 => [d[0] * r * k + p[0] * w, d[1] * r * k + p[1] * w, z];
  b.push(m.matrix).quad(slot, pt(k0, -0.002 + (k0 + 0.15) * 0.001), pt(0.85, -0.001), pt(0.85, 0.001), pt(k0, 0.002 - (k0 + 0.15) * 0.001));
  b.pop();
}

interface FloorRow {
  readonly s: number;
  /** Floor height beside the tunnel, the tunnel's top, its base and top half widths. */
  readonly side: number;
  readonly top: number;
  readonly base: number;
  readonly topHalf: number;
}

class Cabin {
  private readonly ctx: KitContext;
  private readonly frame: BodyFrame;
  private readonly spec: KitCarSpec;
  private readonly lay: Layout;
  private readonly group = new THREE.Group();
  /** Every fixed part of the cabin. */
  private readonly fixed = new PartBuilder();
  private readonly hatch: boolean;
  /** A forward-control van (`platform: 'van'`): its floor runs over both axles to the rear doors. */
  private readonly van: boolean;
  /** Firewall lining, floor height, the floor's rear end (the rear arch's front). */
  private readonly fw: number;
  private readonly floorY: number;
  /**
   * Where furniture standing on the floor puts its foot: the floor, or on the van 10 mm
   * under it, since its floor shows through the saloon's windows and a foot in its plane
   * fights it there.
   */
  private readonly standY: number;
  private readonly floorEnd: number;
  private readonly rows: readonly FloorRow[];
  /** The belt at the cowl: the dash's datum. */
  private readonly belt: number;
  /** Driver's hip and the rear bench's hip. */
  private readonly hipS: number;
  private readonly benchS: number;
  /** Lining below the belt ends here: at the boot, at a hatch's load floor, or short of a van's rear doors. */
  private readonly lowerEnd: number;
  /** Steering column's x. */
  private readonly x0: number;

  constructor(ctx: KitContext) {
    this.ctx = ctx;
    this.frame = ctx.frame;
    this.spec = ctx.frame.spec;
    this.lay = layoutOf(ctx.frame);
    this.hatch = this.spec.bootEnd === undefined;
    this.van = this.spec.platform === 'van';
    const f = this.frame;
    const w = this.spec.wheels;
    this.fw = f.cowl + FIREWALL;
    this.floorY = cabinFloor(f);
    this.standY = this.van ? this.floorY - VAN_FOOT_SINK : this.floorY;
    this.floorEnd = this.van ? f.rearBase - VAN_FLOOR_CLEAR : w.rear - w.radius * f.archFactor(w.rear) - 0.01;
    this.belt = f.station(f.cowl).belt;
    this.hipS = f.cowl + this.lay.hip;
    this.benchS = benchHip(f, this.lay);
    this.lowerEnd = this.van ? f.rearBase - VAN_TRIM_CLEAR : this.hatch ? this.benchS + BENCH_BACK : f.rearBase - 0.005;
    this.x0 = this.lay.seatX;
    const t = this.lay.tunnel;
    const y = this.floorY;
    this.rows = [
      { s: this.fw, side: y + this.lay.toeTop, top: y + this.lay.toeTop + t.heights[0], base: t.base[0], topHalf: t.top[0] },
      { s: this.fw + this.lay.toeRun, side: y, top: y + t.heights[1], base: t.base[0], topHalf: t.top[0] },
      { s: this.floorEnd, side: y, top: y + t.heights[2], base: t.base[1], topHalf: t.top[1] },
    ];
  }

  build(): void {
    this.group.name = 'kit_cabin';
    this.floor();
    this.sidePanels();
    // A van's floor stands over its wheel arches: no covers inside.
    if (!this.van) this.humps();
    this.sills();
    this.lining();
    this.headliner();
    if (!this.van) this.shelf();
    this.dash();
    this.steering();
    this.pedals();
    this.levers();
    this.engineCover();
    for (const side of [1, -1]) this.frontSeat(side);
    this.bench();
    this.driverEye();
    this.rearEye();
    addBuilt(this.group, this.fixed, ORIGIN, 'cabin', true);
    this.ctx.root.add(this.group);
    this.doors();
  }

  /** The empty `KIT_DRIVER_EYE_NODE`. */
  private driverEye(): void {
    const eye = new THREE.Object3D();
    eye.name = KIT_DRIVER_EYE_NODE;
    eye.position.set(...driverEyeAt(this.frame));
    this.ctx.root.add(eye);
  }

  /** The empty `KIT_REAR_EYE_NODE`, seated on the bench as the driver's is on his cushion. */
  private rearEye(): void {
    const eye = new THREE.Object3D();
    eye.name = KIT_REAR_EYE_NODE;
    const y = Math.min(this.floorY + this.lay.benchCushion + SEATED_EYE, this.dome(BENCH_SEAT_X, this.benchS + EYE_BEHIND_HIP) - EYE_HEADROOM);
    eye.position.set(...this.P(BENCH_SEAT_X, y, this.benchS + EYE_BEHIND_HIP));
    this.ctx.root.add(eye);
  }

  // ---- lookups ----

  private P(x: number, y: number, s: number): Vec3 {
    return [x, y, this.frame.z(s)];
  }

  private floorAt(s: number): number {
    return table(this.rows.map((r) => [r.s, r.side] as const), s);
  }

  private tunnelTop(s: number): number {
    return table(this.rows.map((r) => [r.s, r.top] as const), s);
  }

  /** Greenhouse half width at height y above the belt (shoulder, then glass to rail). */
  private glassX(s: number, y: number): number {
    const sec = this.frame.section(s);
    const [x3, y3] = sec.r3;
    const [x4, y4] = sec.r4;
    if (y <= y4) return lerp(x3, x4, clamp((y - y3) / (y4 - y3 || 1), 0, 1));
    const cab = this.spec.cabin;
    return lerp(x4, cab.railHalf, (y - y4) / (cab.rail - y4));
  }

  /** How far lining may reach out at (s, y), clear of door skins and the greenhouse. */
  private inner(s: number, y: number): number {
    return y <= this.frame.station(s).belt ? this.frame.sideX(s, y) - SIDE_CLEAR : this.glassX(s, y) - GLASS_CLEAR;
  }

  /** Underside of the headliner at half width x and position s. */
  private dome(x: number, s: number): number {
    return headlinerUnder(this.frame, x, s);
  }

  /**
   * A pivot group with its own geometry, hung under `parent` (standing at `parentAt`).
   */
  private hinge(
    parent: THREE.Object3D,
    parentAt: Vec3,
    name: string,
    at: Vec3,
    motion: KitMotion | undefined,
    control: KitControl | undefined,
    draw: (b: PartBuilder) => void,
  ): THREE.Group {
    const g = pivotGroup(name, at, motion, control);
    const b = new PartBuilder();
    draw(b);
    if (!b.empty) addBuilt(g, b, at, name, true);
    attach(parent, parentAt, g);
    return g;
  }

  // ---- lining ----

  /** Floor cross-section, outer edge to outer edge over the tunnel. */
  private floorSection(r: FloorRow): Vec3[] {
    const e = this.frame.sideX(r.s, r.side) - SIDE_CLEAR - 0.005;
    const ch = 0.03;
    const pts: P2[] = [
      [e, r.side], [r.base, r.side], [r.topHalf + ch, r.top - ch], [r.topHalf, r.top],
      [-r.topHalf, r.top], [-r.topHalf - ch, r.top - ch], [-r.base, r.side], [-e, r.side],
    ];
    return pts.map(([x, y]) => this.P(x, y, r.s));
  }

  /** Carpet over toe board, floor and tunnel; the firewall lining up to the scuttle. */
  private floor(): void {
    const b = this.fixed.color(this.lay.carpet);
    const sections = this.rows.map((r) => this.floorSection(r));
    for (let i = 0; i + 1 < sections.length; i++) b.bridge('trim', sections[i]!, sections[i + 1]!);
    const top = this.frame.deckY(this.fw, this.frame.section(this.fw).r4[0]) - 0.015;
    b.color(shade(this.lay.carpet, 0.85)).bridge('trim', sections[0]!, sections[0]!.map((p) => [p[0], top, p[2]] as Vec3));
  }

  /**
   * Trim on the body's own sides below the belt, where no door is: the kick panels by
   * the footwells and the rear quarters. Over a rear wheel it starts on the arch hump.
   */
  private sidePanels(): void {
    const cols = this.spec.cabin.columns;
    const w = this.spec.wheels;
    const r = w.radius * this.frame.archFactor(w.rear);
    for (let i = 0; i + 1 < cols.length; i++) {
      const c = cols[i]!;
      // A door on one side only (`CabinColumn.only`) leaves the other side the body's.
      const sides = [1, -1].filter((side) => stripOwner(c, 'lower', side) === 'body');
      if (sides.length === 0) continue;
      const s0 = Math.max(c.s, this.fw);
      const s1 = Math.min(cols[i + 1]!.s, this.lowerEnd);
      if (s1 - s0 < 0.005) continue;
      const samples = [s0, s1];
      for (let k = -1; k <= 1; k += 0.25) samples.push(this.frame.archCentre(w.rear) + k * r);
      const ss = [...new Set(samples.filter((s) => s >= s0 && s <= s1))].sort((a, b) => a - b);
      for (const side of sides) {
        const columns = ss.map((s) => {
          const sec = this.frame.section(s);
          const arch = this.frame.archY(s);
          const yb = Math.max(this.floorAt(s) - 0.005, arch + HUMP_RISE);
          const belt = sec.r3[1];
          const yc = clamp(sec.r2[1], yb, belt);
          const x = (y: number): number => side * (this.frame.sideX(s, y) - SIDE_CLEAR);
          // The top meets the lining's foot, LINING_DEPTH in from the deck's edge.
          return [this.P(x(yb), yb, s), this.P(x(yc), yc, s), this.P(x(belt), belt, s), this.P(side * (sec.r4[0] - LINING_DEPTH), sec.r4[1], s)];
        });
        this.fixed.color(this.spec.look.upholstery);
        for (let k = 0; k + 1 < columns.length; k++) this.fixed.bridge('trim', columns[k]!, columns[k + 1]!);
      }
    }
    this.rakeTrim();
  }

  /**
   * Trim on the body's piece behind a raked shut line (`CabinColumn.foot`), between the
   * line and its column, from the floor or the arch hump up to the line: the door opening
   * shows it.
   */
  private rakeTrim(): void {
    for (const c of this.spec.cabin.columns) {
      // The first column's line rakes a door forward of the cowl: no body behind it.
      if (!c.foot || c === this.spec.cabin.columns[0]) continue;
      // The line below where it leaves its column, by s (it falls as s does).
      const byS = this.frame.shutLine(c).slice(1).reverse();
      const bottom = (s: number): number => Math.max(this.floorAt(s) - 0.005, this.frame.archY(s) + HUMP_RISE);
      const ss = byS.map(([s]) => s).filter((s) => s < c.s && table(byS, s) > bottom(s) + 0.005);
      if (ss.length === 0) continue;
      ss.push(c.s);
      for (const side of [1, -1]) {
        const x = (s: number, y: number): number => side * (this.frame.sideX(s, y) - SIDE_CLEAR);
        const columns = ss.map((s) => {
          const yb = bottom(s);
          const yt = Math.max(yb, table(byS, s));
          return [this.P(x(s, yb), yb, s), this.P(x(s, yt), yt, s)];
        });
        this.fixed.color(this.spec.look.upholstery);
        for (let k = 0; k + 1 < columns.length; k++) this.fixed.bridge('trim', columns[k]!, columns[k + 1]!);
      }
    }
  }

  /**
   * Rear wheel-house covers: a wall just inside the well and a top over the arch. No
   * bottom or outer face, because the tyre turns in the space outboard of the wall.
   */
  private humps(): void {
    const w = this.spec.wheels;
    const r = w.radius * this.frame.archFactor(w.rear);
    const s0 = w.rear - r - 0.005;
    const full = w.rear + r + 0.005;
    const s1 = Math.min(full, this.lowerEnd);
    // Over the shell's arch (`archY`) at the shell's own cosine-spaced facets, so each
    // facet of the top stands parallel to the well's roof under it, HUMP_RISE above. At the
    // arch's very ends `axle − r` taken back off the axle can land a hair outside it, where
    // `archY` has no arch: the arch's foot there, the hub's height.
    const top = (s: number): number => {
      const y = this.frame.archY(Math.min(Math.max(s, w.rear - r), w.rear + r));
      return (Number.isFinite(y) ? y : w.radius) + HUMP_RISE;
    };
    const ss = [s0];
    for (let i = 0; i <= 12; i++) {
      const s = w.rear - r + 2 * r * ((1 - Math.cos((i / 12) * Math.PI)) / 2);
      if (s > s0 + 0.004 && s < s1 - 0.004) ss.push(s);
    }
    ss.push(s1);
    const b = this.fixed.color(shade(this.spec.look.upholstery, 0.8));
    for (const side of [1, -1]) {
      const xi = side * (this.frame.wellX(w.rear) - 0.02);
      const xo = (s: number): number => side * (this.frame.sideX(s, top(s)) - SIDE_CLEAR);
      const wall = [this.P(xi, this.floorY, s0), ...ss.map((s) => this.P(xi, top(s), s)), this.P(xi, this.floorY, s1)];
      fillX(b, 'trim', wall);
      b.bridge('trim', ss.map((s) => this.P(xi, top(s), s)), ss.map((s) => this.P(xo(s), top(s), s)));
      const end = (s: number): void => {
        b.quad('trim', this.P(xi, this.floorY, s), this.P(xo(s), this.floorY, s), this.P(xo(s), top(s), s), this.P(xi, top(s), s));
      };
      end(s0);
      if (s1 === full) end(s1);
    }
  }

  /** Sill trims along the door openings, inside the door's inner skin. */
  private sills(): void {
    const s0 = this.fw;
    const s1 = this.floorEnd;
    let out = Infinity;
    for (let i = 0; i <= 4; i++) out = Math.min(out, this.frame.sideX(lerp(s0, s1, i / 4), this.spec.doorBottom) - DOOR_CARD - 0.01);
    const y0 = this.floorY - 0.01;
    const y1 = Math.max(this.spec.doorBottom - 0.006, this.floorY + 0.04);
    const z0 = this.frame.z(s0);
    const z1 = this.frame.z(s1);
    this.fixed.color(COLOURS.black);
    for (const side of [1, -1]) {
      this.fixed.bevelBox('trim', [side * (out - 0.045), (y0 + y1) / 2, (z0 + z1) / 2], [0.045, (y1 - y0) / 2, Math.abs(z0 - z1) / 2], 0.015);
    }
  }

  /**
   * The van's padded engine cover on the centre line between the front seats
   * (`Layout.engineCover`), hinged at its front top edge and lifting at the back, over the
   * engine's block (its rocker cover and air filter on it) standing on the floor.
   */
  private engineCover(): void {
    const c = this.lay.engineCover;
    if (!c) return;
    const cowl = this.frame.cowl;
    const y1 = this.floorY + c.height;
    const s0 = cowl + c.ds0;
    const s1 = cowl + c.ds1;
    const b = this.fixed;
    // The block 3 cm inside the cover all round.
    const top = y1 - 0.06;
    b.color(COLOURS.metal);
    b.box('trim', this.P(0, (this.standY + top - 0.05) / 2, (s0 + s1) / 2), [c.half - 0.06, (top - 0.05 - this.standY) / 2, (s1 - s0) / 2 - 0.04]);
    b.color(COLOURS.black);
    b.box('trim', this.P(0, top - 0.025, (s0 + s1) / 2 + 0.03), [0.05, 0.025, (s1 - s0) / 2 - 0.1]);
    b.cylinderY('trim', this.P(0, top - 0.02, s1 - 0.12), 0.08, 0.02, 10);
    const at = this.P(0, y1, s0);
    this.hinge(this.group, ORIGIN, 'engine_cover', at, { channel: 'engine_cover', kind: 'rot', axis: [1, 0, 0], amount: 1.1 }, { id: 'engine_cover', label: 'Кожух двигателя' }, (h) => {
      h.color(shade(this.spec.look.dash, 0.9));
      pad(h, 'trim', this.P(0, (this.standY + y1) / 2, (s0 + s1) / 2), [c.half, (y1 - this.standY) / 2, (s1 - s0) / 2], 0.05, 0.85);
    });
  }

  /**
   * The shell's lining over its own greenhouse and roof (`KitContext.lining`): pillar
   * trims, headers, the rail and the headliner as one skin in the headliner's colour.
   */
  private lining(): void {
    const b = this.fixed.color(this.lay.headliner);
    for (const poly of this.ctx.lining) b.poly('trim', poly);
  }

  /**
   * The headliner's fittings, which hang from the shell's lining: the courtesy lamp, sun
   * visors and the mirror.
   */
  private headliner(): void {
    const f = this.frame;
    const cab = this.spec.cabin;
    const top0 = cab.columns[0]!.top;
    const topN = cab.columns[cab.columns.length - 1]!.top;
    // Glass line at half width x: base (s, y) and top (s, y) for the screen or back light.
    const glass = (x: number, kind: 'front' | 'rear'): [P2, P2] => {
      const frac = Math.abs(x) / cab.railHalf;
      const st = f.screenTopS(frac);
      const yt = cab.rail + f.crownAt(frac) - f.roofDrop(kind === 'front' ? st : topN);
      const s = kind === 'front' ? f.screenFoot(frac) : f.rearBase;
      const yb = f.deckY(s, frac * f.section(kind === 'front' ? f.cowl : s).r4[0]);
      if (kind === 'rear' && cab.rearKnee) {
        const cb = f.deckY(s, 0);
        const kt = (cab.rearKnee.y - cb) / (cab.rail + cab.crown - cb);
        return [[cab.rearKnee.s, lerp(yb, yt, kt)], [topN, yt]];
      }
      return [[s, yb], [kind === 'front' ? st : topN, yt]];
    };
    const frontTop = top0 + 0.03;
    const rearTop = topN - (this.hatch ? 0.06 : 0.03);

    // Courtesy lamp: the lens is its switch. Lit, it slides up into the headliner by
    // `GLOW_TRAVEL` and its lit face slides down out of the headliner into its place, so
    // the two never lie in one plane. The car the player sits in also lights the cabin
    // from here (`Vehicle.syncDomeLight`).
    const lampS = lerp(frontTop, rearTop, 0.45);
    const ly = this.dome(0, lampS) - 0.004;
    const lens = (n: PartBuilder, slot: KitSlot, y: number): void => {
      n.quad(slot, this.P(0.05, y, lampS - 0.03), this.P(-0.05, y, lampS - 0.03), this.P(-0.05, y, lampS + 0.03), this.P(0.05, y, lampS + 0.03));
    };
    const at = this.P(0, ly, lampS);
    const lamp = fineDetail(this.hinge(this.group, ORIGIN, KIT_DOME_LAMP_NODE, at, undefined, { id: 'dome', label: 'Плафон' }, () => {}));
    this.hinge(lamp, at, 'dome_dim', at, { channel: 'dome', kind: 'pos', axis: [0, 1, 0], amount: GLOW_TRAVEL }, undefined, (n) => {
      lens(n.color(COLOURS.lamp), 'trim', ly);
    });
    this.hinge(lamp, at, 'dome_glow', at, { channel: 'dome', kind: 'pos', axis: [0, -1, 0], amount: GLOW_TRAVEL }, undefined, (n) => {
      lens(n.color(DOME_LIT), 'lamp_glow', ly + GLOW_TRAVEL);
    });

    // Mirror: hung from the header on a stem, behind the screen. Placed from the glass at
    // the pad's corners, not at its centre: on the Samaras' and tens' raked screens the glass
    // at the pad's top edge stands 5 cm further back than at its middle, and a fixed 7 cm
    // from the middle put the top 15-23 mm through the screen.
    const glassS = (x: number, y: number): number => {
      const [[sb, yb], [st, yt]] = glass(x, 'front');
      return lerp(sb, st, (y - yb) / (yt - yb));
    };
    // The header the mirror hangs from: the rail at the screen's top, or on a screen curved
    // at its top (`screenTop`) the glass's own top on the centre line.
    const header = cab.screenTop === undefined ? cab.rail - f.roofDrop(top0) : glass(0, 'front')[1][1] + 0.01;
    const my = header - 0.085;
    // The pad (half size 0.105 x 0.03 x 0.014) is turned so the driver sees straight back
    // through the back light's middle in it (`mirrorFrame`); the turn swings its far end
    // towards the glass. 4 cm is added in front of its corner nearest the glass: the
    // screen bows ahead of this straight foot-to-top line, so the air left is 2-3 cm
    // (tools measured: Samaras 22 mm, classics 30 mm, ahead of the mirror).
    const nearest = Math.max(...[-0.105, 0.105].flatMap((x) => [my - 0.03, my + 0.03].map((y) => glassS(x, y))));
    const eye = driverEyeAt(f);
    const [[rearB, rearYb], [rearT, rearYt]] = glass(0, 'rear');
    const backLight = this.P(0, (rearYb + rearYt) / 2, (rearB + rearT) / 2);
    const aim = (s: number): THREE.Matrix4 => mirrorFrame(this.P(0, my, s), eye, sub(backLight, this.P(0, my, s)));
    // How far the turned pad reaches ahead of its centre (+z is forward), placed near
    // where it will hang: the turn hardly changes over the last few centimetres.
    const turn = new THREE.Matrix3().setFromMatrix4(aim(nearest + 0.07));
    const corner = new THREE.Vector3();
    let reach = 0;
    for (const x of [-0.105, 0.105]) for (const y of [-0.03, 0.03]) for (const z of [-0.014, 0.014]) reach = Math.max(reach, corner.set(x, y, z).applyMatrix3(turn).z);
    const ms = nearest + reach + 0.04;
    const root = this.P(0, header - 0.01, glassS(0, header - 0.01) + 0.03);
    const b = this.fixed.color(COLOURS.black);
    beam(b, 'trim', root, this.P(0, my + 0.02, ms), 0.008, 0.008, [1, 0, 0]);
    // The pad turns on a ball at the stem's end, by hand (rig.ts `aim`): side to side
    // about its own up, then up and down about its own across, from the pose above.
    const frame = b.push(aim(ms)).matrix.clone();
    b.pop();
    const e = frame.elements;
    const centre: Vec3 = [e[12]!, e[13]!, e[14]!];
    // The mirror stays coarse (rig.ts `KIT_FINE_M`): its pad stands black against the screen
    // and the sky, and seen from 8 m ahead it vanished at the fine detail's line.
    const ball = pivotGroup('mirror_ball', centre, { channel: 'mirror_yaw', kind: 'rot', axis: [e[4]!, e[5]!, e[6]!], amount: 1 });
    attach(this.group, ORIGIN, ball);
    const pane = this.hinge(ball, centre, 'mirror', centre, { channel: 'mirror_pitch', kind: 'rot', axis: [e[0]!, e[1]!, e[2]!], amount: 1 }, MIRROR_CONTROL, (m) => {
      m.push(frame).color(COLOURS.black);
      pad(m, 'trim', ORIGIN, [0.105, 0.03, 0.014], 0.008);
      inlay(m, 'chrome', [[0.095, -0.022, -0.014], [-0.095, -0.022, -0.014], [-0.095, 0.022, -0.014], [0.095, 0.022, -0.014]]);
      m.pop();
    });
    // The live face 2 mm proud of the glass.
    addMirrorFace(pane, frame, centre, [0.095, 0.022], -0.016, 'inner');

    // Sun visors lie flat under the headliner and swing down about their front edge.
    for (const side of [1, -1]) {
      const name = side > 0 ? 'visor_l' : 'visor_r';
      const x = side * 0.34;
      const y = this.dome(Math.abs(x) + 0.16, frontTop + 0.005) - 0.014;
      const at = this.P(x, y, frontTop + 0.005);
      fineDetail(this.hinge(this.group, ORIGIN, name, at, { channel: name, kind: 'rot', axis: [1, 0, 0], amount: -1.35 }, { id: name, label: `Козырёк ${WHERE[name.slice(-1)]}` }, (v) => {
        v.color(shade(this.lay.headliner, 0.92));
        v.pushAt(at);
        pad(v, 'trim', [0, -0.008, -0.08], [0.16, 0.008, 0.075], 0.006);
        v.pop();
      }));
    }
  }

  /** Parcel shelf from the bench's top back to the back light's foot (saloon) or the tailgate's knee (hatch). */
  private shelf(): void {
    const f = this.frame;
    const cab = this.spec.cabin;
    const benchTop = this.floorY + this.lay.benchCushion;
    const y = this.hatch && cab.rearKnee
      ? Math.min(benchTop + 0.4, cab.rearKnee.y - 0.03)
      : Math.min(benchTop + 0.4, f.section(f.rearBase).r4[1] - 0.012);
    const s0 = this.benchS + 0.25;
    const s1 = this.hatch && cab.rearKnee ? cab.rearKnee.s - 0.05 : f.rearBase - 0.015;
    // A saloon's shelf reaches out to the quarter trim (`sidePanels`) along its length, so
    // no slot shows the boot past its edge; a hatch's stays inside the greenhouse.
    const edge = (s: number): number => {
      const sec = f.section(s);
      if (this.hatch || y >= sec.r4[1]) return this.inner(s, y) - 0.01;
      if (y <= sec.r3[1]) return f.sideX(s, y) - SIDE_CLEAR - 0.005;
      const t = (y - sec.r3[1]) / (sec.r4[1] - sec.r3[1]);
      return lerp(f.sideX(s, sec.r3[1]) - SIDE_CLEAR, sec.r4[0] - LINING_DEPTH, t) - 0.005;
    };
    const ss = [0, 0.25, 0.5, 0.75, 1].map((k) => lerp(s0, s1, k));
    const row = (side: number): Vec3[] => ss.map((s) => this.P(side * edge(s), y, s));
    const b = this.fixed.color(shade(this.spec.look.dash, 1.1)).bridge('trim', row(1), row(-1));
    if (this.hatch) return;
    // A saloon's boot stands behind the shelf: a wall at its rear edge from the cushion's
    // height up to the back light's foot (where the lining starts) shuts it off, above the
    // shelf and beside the bench's back.
    const e = edge(s1);
    const xs = [1, 0.5, 0, -0.5, -1].map((k) => k * e);
    b.bridge('trim', xs.map((x) => this.P(x, benchTop, s1)), xs.map((x) => this.P(x, Math.max(y, f.deckY(f.rearBase, Math.abs(x)) - 0.005), s1)));
  }

  // ---- dash ----

  /** Where the fascia's face (extended past its ends: the stack) stands at height y. */
  private fasciaS(y: number): number {
    const [[dt, yt], [db, yb]] = this.lay.fascia;
    return this.frame.cowl + lerp(db, dt, (y - this.belt - yb) / (yt - yb));
  }

  private fascia(x: number, y: number): Mount {
    const [[dt, yt], [db, yb]] = this.lay.fascia;
    return mount(this.P(x, y, this.fasciaS(y)), Math.atan2(-(dt - db), yt - yb));
  }

  /** A point on the cluster face, `right` of the column and `up` over the cowl's belt. */
  private clusterAt(right: number, up: number): Mount {
    return mount(this.P(this.x0 - right, this.belt + up, this.frame.cowl + this.lay.cluster), 0);
  }

  /** Prism along X between `xs`; `profile(x)` is a closed (s, y) section, capped at both ends. */
  private prismX(b: PartBuilder, slot: KitSlot, xs: readonly number[], profile: (x: number) => readonly P2[]): void {
    const rings = xs.map((x) => profile(x).map(([s, y]) => this.P(x, y, s)));
    for (let i = 0; i + 1 < rings.length; i++) b.bridge(slot, rings[i]!, rings[i + 1]!, true);
    fillX(b, slot, rings[0]!);
    fillX(b, slot, rings[rings.length - 1]!);
  }

  private dash(): void {
    const L = this.lay;
    const f = this.frame;
    const cowl = f.cowl;
    const belt = this.belt;
    const b = this.fixed;
    const look = this.spec.look;

    // Body: lofted across so its front edge follows the deck's crown under the screen.
    const depth = Math.max(...L.dash.map((p) => p[0]));
    const top = belt + Math.max(...L.dash.map((p) => p[1]));
    let half = Infinity;
    for (const ds of [0.012, depth / 2, depth]) {
      half = Math.min(half, this.glassX(cowl + ds, top) - 0.085, f.sideX(cowl + ds, belt - 0.15) - 0.085);
    }
    b.color(look.dash);
    const loft = new Map((L.dashLoft ?? [-1, -0.55, 0, 0.55, 1].map((k) => [k, L.dash] as const)).map(([k, section]) => [k * half, section]));
    this.prismX(b, 'trim', [...loft.keys()], (x) => [
      [cowl + 0.012, f.deckY(cowl + 0.012, x) - 0.012],
      ...loft.get(x)!.map(([ds, dy]): P2 => [cowl + ds, belt + dy]),
    ]);
    const bx = this.x0 - (L.binnacleRight ?? 0);
    this.prismX(b, 'trim', [bx - L.binnacleHalf, bx + L.binnacleHalf], () => L.binnacle.map(([ds, dy]): P2 => [cowl + ds, belt + dy]));
    if (L.stack) {
      // Down the fascia's line from its foot to the tunnel; the back corners hide in
      // the dash and the toe board.
      const foot = belt + L.fascia[1][1];
      const floor = this.tunnelTop(this.fasciaS(foot)) - 0.005;
      const back = cowl + 0.06;
      this.prismX(b, 'trim', [-L.stack.half, L.stack.half], () => [
        [back, foot], [this.fasciaS(foot), foot], [this.fasciaS(floor), floor], [back, this.tunnelTop(back) - 0.005],
      ]);
    }
    if (L.wood) {
      const [y0, y1] = L.wood;
      const m = this.fascia(0, belt + (y0 + y1) / 2);
      b.color(COLOURS.wood).push(m.matrix).box('trim', [0, 0, 0.002], [half - 0.01, (y1 - y0) / 2, 0.002]).pop();
    }
    if (L.band) {
      // Left out where the binnacle stands (its width, its section's height): seen at a
      // slant through a window cut in the cluster's face, it would show past the window's
      // stand-in.
      const [y0, y1] = L.band.dy;
      const mid = (y0 + y1) / 2;
      const e = half - 0.01;
      const ys = L.binnacle.map((p) => p[1]);
      const [lo, hi] = [Math.max(y0, Math.min(...ys)), Math.min(y1, Math.max(...ys))];
      const [bx0, bx1] = [Math.max(-e, bx - L.binnacleHalf), Math.min(e, bx + L.binnacleHalf)];
      // [x from, x to, dy from, dy to], x in the car frame.
      const pieces: readonly (readonly [number, number, number, number])[] = [
        [-e, bx0, y0, y1], [bx1, e, y0, y1], [bx0, bx1, y0, lo], [bx0, bx1, hi, y1],
      ];
      b.color(L.band.colour).push(this.fascia(0, belt + mid).matrix);
      for (const [xa, xb, ya, yb] of pieces) {
        // The mount's local X is the car's -x.
        if (xb - xa > 1e-4 && yb - ya > 1e-4) inlay(b, 'trim', rectCorners(-(xa + xb) / 2, (ya + yb) / 2 - mid, (xb - xa) / 2, (yb - ya) / 2, 0));
      }
      b.pop();
    }
    if (L.clusterFace) {
      // The frame laid in the binnacle's face, the face laid in the frame: one plane.
      const { right, up, half: [hx, hy], colour, frame } = L.clusterFace;
      b.push(this.clusterAt(right, up).matrix).color(COLOURS.black);
      inlay(b, frame === 'chrome' ? 'chrome' : 'trim', rectCorners(0, 0, hx + 0.006, hy + 0.006, 0));
      inlay(b.color(colour), 'trim', rectCorners(0, 0, hx, hy, 0));
      b.pop();
    }
    for (const lamps of [L.lamps, L.lenses]) {
      if (!lamps) continue;
      const { right, up, cols, pitch, show } = lamps;
      const rows = Math.ceil(show.length / cols);
      const m = this.clusterAt(right, up);
      const h = pitch * 0.3;
      show.forEach((tell, i) => {
        const x = ((i % cols) - (cols - 1) / 2) * pitch;
        const y = ((rows - 1) / 2 - Math.floor(i / cols)) * pitch;
        // Its window cut in the cluster's face: the dark lens fills it, and lit, slides back
        // by `GLOW_TRAVEL` as the lit face slides out into it from as far behind.
        cutLocal(b.push(m.matrix), rectCorners(x, y, h, h, 0));
        b.color(shade(TELLTALES[tell], 0.3)).poly('trim', rectCorners(x, y, h, h, -WINDOW_FILL));
        b.pop();
        const at = m.at(x, y, 0);
        fineDetail(this.hinge(this.group, ORIGIN, `telltale_dim_${tell}`, at, { channel: `tell_${tell}`, kind: 'pos', axis: m.n, amount: -GLOW_TRAVEL }, undefined, (n) => {
          n.push(m.matrix).color(shade(TELLTALES[tell], 0.3)).poly('trim', rectCorners(x, y, h, h, 0));
          n.pop();
        }));
        fineDetail(this.hinge(this.group, ORIGIN, `telltale_${tell}`, at, { channel: `tell_${tell}`, kind: 'pos', axis: m.n, amount: GLOW_TRAVEL }, undefined, (n) => {
          n.push(m.matrix).color(TELLTALES[tell]).poly('lamp_glow', rectCorners(x, y, h, h, -GLOW_TRAVEL));
          n.pop();
        }));
      });
    }

    for (const g of L.gauges) {
      if (g.kind === 'ribbon') this.ribbon(g);
      else this.gauge(g);
    }
    if (L.clock) {
      // A round dial's bezel and face; the hour marks and the hands laid into the face.
      const { right, up, radius: r } = L.clock;
      const c = this.fixed.push(this.clusterAt(right, up).matrix).color(COLOURS.black);
      c.cylinderZ('chrome', [0, 0, 0.006], r + 0.005, 0.006, 12, false);
      const ray = (a: number, k0: number, k1: number, w: number): Vec3[] => {
        const d: P2 = [Math.cos(a), Math.sin(a)];
        const p: P2 = [-d[1] * w, d[0] * w];
        return [
          [d[0] * r * k0 - p[0], d[1] * r * k0 - p[1], 0.004], [d[0] * r * k1 - p[0], d[1] * r * k1 - p[1], 0.004],
          [d[0] * r * k1 + p[0], d[1] * r * k1 + p[1], 0.004], [d[0] * r * k0 + p[0], d[1] * r * k0 + p[1], 0.004],
        ];
      };
      const disc: Vec3[] = [];
      for (let i = 0; i < 12; i++) disc.push([Math.cos((i / 12) * Math.PI * 2) * r, Math.sin((i / 12) * Math.PI * 2) * r, 0.004]);
      c.color(COLOURS.face).poly('trim', disc);
      c.color(COLOURS.tick);
      for (let i = 0; i < 12; i++) inlay(c, 'trim', ray((i / 12) * Math.PI * 2, 0.74, 0.92, 0.0012));
      // Ten past ten: the hour hand at 150 degrees from three o'clock, the minute hand at 30.
      inlay(c, 'trim', ray((150 * Math.PI) / 180, -0.1, 0.5, 0.0015));
      inlay(c, 'trim', ray((30 * Math.PI) / 180, -0.1, 0.8, 0.0012));
      c.pop();
    }
    this.glovebox();
    this.radio();
    this.ashtray();
    this.switches();
    for (const v of L.vents ?? []) {
      for (const x of v.x === undefined ? [half - 0.07, -(half - 0.07)] : [v.x]) {
        const m = this.fascia(x, belt + v.dy);
        const [hx, hy] = v.half ?? [0.035, 0.024];
        b.push(m.matrix).color(COLOURS.black);
        inlay(b, 'trim', rectCorners(0, 0, hx, hy, 0));
        b.color(look.dash);
        const n = Math.round(hy / 0.012) - 1;
        // Louvres 6 mm deep from 4.5 mm off the backing laid in the face: apart in depth from the road.
        for (let i = -n; i <= n; i++) beam(b, 'trim', [-(hx - 0.003), i * 0.012, 0.0075], [hx - 0.003, i * 0.012, 0.0075], 0.003, 0.004);
        b.pop();
      }
    }
    if (L.eyeballs) {
      const r = L.eyeballs.radius;
      for (const [x, dy] of L.eyeballs.at) {
        b.push(this.fascia(x, belt + dy).matrix).color(COLOURS.black);
        b.cylinderZ('chrome', [0, 0, 0.005], r, 0.005, 10, false);
        b.cylinderZ('trim', [0, 0, 0.007], r * 0.72, 0.007, 8);
        b.pop();
      }
    }
    if (L.rockers) {
      const { on, at } = L.rockers;
      for (const [a, dy] of at) {
        b.push((on === 'cluster' ? this.clusterAt(a, dy) : this.fascia(a, belt + dy)).matrix);
        // No back faces: each sits on the face it is mounted on.
        b.color(COLOURS.black).box('trim', [0, 0, 0.003], [0.017, 0.027, 0.003], 0b011111);
        b.color(shade(look.dash, 1.4)).box('trim', [0, 0.003, 0.009], [0.012, 0.02, 0.003], 0b011111);
        b.pop();
      }
    }
    if (L.heater) {
      const { dy, half: [hx, hy], knobs, radius } = L.heater;
      b.push(this.fascia(0, belt + dy).matrix).color(COLOURS.black);
      inlay(b, 'trim', rectCorners(0, 0, hx, hy, 0));
      b.pop();
      for (const x of knobs) {
        // A bright ring round a black knob with a grip bar across it and a white pointer up the bar.
        b.push(this.fascia(x, belt + dy).matrix).color(COLOURS.black);
        b.cylinderZ('chrome', [0, 0, 0.004], radius, 0.003, 12, false);
        b.cylinderZ('trim', [0, 0, 0.009], radius * 0.78, 0.007, 10);
        b.box('trim', [0, 0, 0.019], [radius * 0.22, radius * 0.72, 0.004]);
        b.color(COLOURS.white);
        inlay(b, 'trim', rectCorners(0, radius * 0.45, 0.0012, radius * 0.22, 0.023));
        b.pop();
      }
    }
  }

  /**
   * A round dial on the cluster face: bezel, face, ticks and a needle on its channel.
   * The painted face and needle and their lit twins swap places on the panel lights
   * (`GLOW_TRAVEL`, `NEEDLE_TRAVEL`); the ticks are laid in the face. A bare dial's ticks
   * are laid in the cluster's face, in windows cut for them.
   */
  private gauge(g: RoundGauge): void {
    const m = this.clusterAt(g.right, g.up);
    const r = g.radius;
    const z = g.bare ? 0 : 0.004;
    const ticks: Vec3[][] = [];
    for (let i = 0; i < g.ticks; i++) {
      const a = g.rest - (g.sweep * i) / (g.ticks - 1);
      const d: Vec3 = [Math.cos(a), Math.sin(a), 0];
      const p: Vec3 = [-d[1] * 0.0018, d[0] * 0.0018, 0];
      const at = (k: number, sgn: number): Vec3 => [d[0] * r * k + sgn * p[0], d[1] * r * k + sgn * p[1], z];
      ticks.push([at(0.74, -1), at(0.92, -1), at(0.92, 1), at(0.74, 1)]);
    }
    const disc: Vec3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      disc.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    const b = this.fixed.push(m.matrix);
    if (g.bare) {
      for (const t of ticks) {
        cutLocal(b, t);
        b.color(COLOURS.tick).poly('trim', t.map(([x, y]): Vec3 => [x, y, -WINDOW_FILL]));
      }
    } else {
      b.color(COLOURS.black).cylinderZ('chrome', [0, 0, 0.006], r + 0.005, 0.006, 12, false);
      // The painted face's stand-in, laid in the cluster's face 4 mm under it: past
      // `KIT_FINE_M` the face does not draw, and the bezel would ring the cluster's colour.
      // An octagon inside the face's 12-gon: fewer cuts in the face, and none of it shows
      // past the face near.
      const k = r * Math.cos(Math.PI / 12);
      const octagon: Vec3[] = [];
      for (let i = 0; i < 8; i++) octagon.push([Math.cos((i / 8) * Math.PI * 2) * k, Math.sin((i / 8) * Math.PI * 2) * k, 0]);
      inlay(b.color(COLOURS.face), 'trim', octagon);
    }
    b.pop();
    const face = (n: PartBuilder, lit: boolean): void => {
      const dz = lit ? -GLOW_TRAVEL : 0;
      const at = (pts: readonly Vec3[]): Vec3[] => pts.map(([x, y, pz]): Vec3 => [x, y, pz + dz]);
      const slot: KitSlot = lit ? 'lamp_glow' : 'trim';
      n.push(m.matrix);
      if (!g.bare) n.color(lit ? PANEL_FACE : COLOURS.face).poly(slot, at(disc));
      n.color(lit ? PANEL_TICK : COLOURS.tick);
      for (const t of ticks) {
        if (g.bare) n.poly(slot, at(t));
        else inlay(n, slot, at(t));
      }
      n.pop();
    };
    const faceAt = m.at(0, 0, z);
    fineDetail(this.hinge(this.group, ORIGIN, `panel_dim_${g.channel}`, faceAt, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: -GLOW_TRAVEL }, undefined, (n) => face(n, false)));
    fineDetail(this.hinge(this.group, ORIGIN, `panel_glow_${g.channel}`, faceAt, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: GLOW_TRAVEL }, undefined, (n) => face(n, true)));
    const min = g.min ?? 0;
    const at = m.at(0, 0, 0.008);
    const motion: KitMotion = { channel: g.channel, kind: 'rot', axis: m.n, amount: -g.sweep / (g.full - min), stops: [min, g.full] };
    const hand = fineDetail(this.hinge(this.group, ORIGIN, `needle_${g.channel}`, at, motion, undefined, (n) => {
      n.push(m.matrix).color(COLOURS.black).cylinderZ('trim', [0, 0, 0.009], r * 0.12, 0.002, 6);
      n.pop();
    }));
    // The painted needle and its glow ride on the hand and swap places with the lights.
    this.hinge(hand, at, `needle_dim_${g.channel}`, at, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: -NEEDLE_TRAVEL }, undefined, (n) => {
      needle(n.color(COLOURS.needle), m, r, g.rest, 0.008, -0.15, 'trim');
    });
    this.hinge(hand, at, `needle_glow_${g.channel}`, at, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: NEEDLE_TRAVEL }, undefined, (n) => {
      needle(n.color(PANEL_NEEDLE), m, r, g.rest, 0.008 - NEEDLE_TRAVEL, 0.12, 'lamp_glow');
    });
  }

  /**
   * A ribbon window on the cluster face, its ticks and a marker sliding along it with the
   * channel. Face and marker swap with their lit twins like a round dial's.
   */
  private ribbon(g: RibbonGauge): void {
    const m = this.clusterAt(g.right, g.up);
    const [hw, hh] = g.half;
    const run = hw * 0.92;
    const b = this.fixed.push(m.matrix).color(COLOURS.black);
    inlay(b, 'chrome', rectCorners(0, 0, hw + 0.004, hh + 0.004, 0));
    cutLocal(b, rectCorners(0, 0, hw, hh, 0));
    b.color(COLOURS.face).poly('trim', rectCorners(0, 0, hw, hh, -WINDOW_FILL));
    b.pop();
    const face = (n: PartBuilder, lit: boolean): void => {
      const z = lit ? -GLOW_TRAVEL : 0;
      const slot: KitSlot = lit ? 'lamp_glow' : 'trim';
      n.push(m.matrix).color(lit ? PANEL_FACE : COLOURS.face).poly(slot, rectCorners(0, 0, hw, hh, z));
      n.color(lit ? PANEL_TICK : COLOURS.tick);
      for (let i = 0; i < g.ticks; i++) inlay(n, slot, rectCorners(lerp(-run, run, i / (g.ticks - 1)), -hh * 0.45, 0.0012, hh * 0.4, z));
      n.pop();
    };
    const faceAt = m.at(0, 0, 0);
    fineDetail(this.hinge(this.group, ORIGIN, `panel_dim_${g.channel}`, faceAt, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: -GLOW_TRAVEL }, undefined, (n) => face(n, false)));
    fineDetail(this.hinge(this.group, ORIGIN, `panel_glow_${g.channel}`, faceAt, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: GLOW_TRAVEL }, undefined, (n) => face(n, true)));
    const at = m.at(-run, 0, 0.004);
    const min = g.min ?? 0;
    const motion: KitMotion = { channel: g.channel, kind: 'pos', axis: m.u, amount: (2 * run) / (g.full - min), stops: [min, g.full] };
    const hand = fineDetail(this.hinge(this.group, ORIGIN, `needle_${g.channel}`, at, motion, undefined, () => {}));
    this.hinge(hand, at, `needle_dim_${g.channel}`, at, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: -NEEDLE_TRAVEL }, undefined, (n) => {
      n.push(m.matrix).color(COLOURS.needle).poly('trim', rectCorners(-run, 0, 0.0018, hh * 0.9, 0.004));
      n.pop();
    });
    this.hinge(hand, at, `needle_glow_${g.channel}`, at, { channel: PANEL_MOTION_CHANNEL, kind: 'pos', axis: m.n, amount: NEEDLE_TRAVEL }, undefined, (n) => {
      n.push(m.matrix).color(PANEL_NEEDLE).poly('lamp_glow', rectCorners(-run, 0, 0.0014, hh * 0.86, 0.004 - NEEDLE_TRAVEL));
      n.pop();
    });
  }

  /** Lid hinged at its foot, falling open towards the passenger, over a dark opening. */
  private glovebox(): void {
    const { x, dy, half } = this.lay.glovebox;
    const m = this.fascia(x, this.belt + dy);
    const [hx, hy] = half;
    // The dark opening behind the lid: the fascia is cut under it and it stands 5 mm in,
    // clear of the closed lid's back, which lies in the fascia's plane.
    const [ox, oy] = [hx - 0.008, hy - 0.006];
    this.fixed.push(m.matrix);
    cutLocal(this.fixed, rectCorners(0, 0, ox, oy, 0), 0.002);
    this.fixed.color(COLOURS.black).poly('trim', rectCorners(0, 0, ox, oy, -0.005));
    this.fixed.pop();
    const at = m.at(0, -hy, 0.007);
    fineDetail(this.hinge(this.group, ORIGIN, 'glovebox', at, { channel: 'glovebox', kind: 'rot', axis: [1, 0, 0], amount: -1.2 }, { id: 'glovebox', label: 'Бардачок' }, (b) => {
      b.push(m.matrix).color(this.lay.glovebox.colour ?? shade(this.spec.look.dash, 1.15));
      pad(b, 'trim', [0, 0, 0.007], [hx, hy, 0.007], 0.005);
      b.color(COLOURS.black).box('chrome', [0, hy - 0.018, 0.016], [0.03, 0.006, 0.003]);
      b.pop();
    }));
  }

  /** Radio: a dial with a needle standing on the picked preset, a power knob and a tuning knob. */
  private radio(): void {
    const [x, dy] = this.lay.radio;
    const m = this.fascia(x, this.belt + dy);
    const b = this.fixed.push(m.matrix);
    b.color(COLOURS.black);
    pad(b, 'trim', [0, 0, 0.006], [0.09, 0.028, 0.006], 0.004);
    inlay(b.color(COLOURS.dial), 'trim', [[-0.05, 0.002, 0.012], [0.05, 0.002, 0.012], [0.05, 0.02, 0.012], [-0.05, 0.02, 0.012]]);
    b.color(COLOURS.black).cylinderZ('chrome', [0.07, -0.008, 0.017], 0.01, 0.005, 8);
    b.pop();
    // The needle 3.5 mm off the dial, so the two do not fight in depth from outside.
    const needleAt = m.at(-0.045, 0.011, 0.0155);
    fineDetail(this.hinge(this.group, ORIGIN, 'radio_needle', needleAt, { channel: 'radio_tune', kind: 'pos', axis: m.u, amount: 0.09 }, undefined, (n) => {
      n.push(m.matrix).color(COLOURS.dialNeedle);
      n.quad('trim', [-0.0458, 0.003, 0.0155], [-0.0442, 0.003, 0.0155], [-0.0442, 0.019, 0.0155], [-0.0458, 0.019, 0.0155]);
      n.pop();
    }));
    const knobAt = m.at(-0.07, -0.008, 0.012);
    fineDetail(this.hinge(this.group, ORIGIN, 'radio_knob', knobAt, { channel: 'radio', kind: 'rot', axis: m.n, amount: -0.45 }, { id: 'radio', label: 'Магнитола', action: { type: 'cycle', channel: 'radio', values: [0, 1, 2] } }, (k) => {
      k.push(m.matrix).color(COLOURS.black).cylinderZ('trim', [-0.07, -0.008, 0.017], 0.011, 0.005, 8);
      inlay(k.color(COLOURS.white), 'trim', [[-0.071, -0.006, 0.022], [-0.069, -0.006, 0.022], [-0.069, 0.001, 0.022], [-0.071, 0.001, 0.022]]);
      k.pop();
    }));
  }

  /** Ashtray drawer sliding out of the fascia. */
  private ashtray(): void {
    const [x, dy] = this.lay.ashtray;
    const m = this.fascia(x, this.belt + dy);
    fineDetail(this.hinge(this.group, ORIGIN, 'ashtray', m.at(0, 0, 0), { channel: 'ashtray', kind: 'pos', axis: m.n, amount: 0.08 }, { id: 'ashtray', label: 'Пепельница' }, (b) => {
      b.push(m.matrix).color(shade(this.spec.look.dash, 1.2));
      pad(b, 'trim', [0, 0, 0.005], [0.065, 0.02, 0.005], 0.003);
      b.color(COLOURS.black).box('chrome', [0, 0.012, 0.0105], [0.03, 0.003, 0.0008]);
      b.color(COLOURS.metal).box('trim', [0, -0.002, -0.04], [0.058, 0.016, 0.04]);
      b.pop();
    }));
  }

  /** Light switch (knob or rocker) and the hazard button. */
  private switches(): void {
    const L = this.lay;
    const lightCtl: KitControl = { id: 'lights', label: 'Фары', action: { type: 'cycle', channel: 'lights', values: [0, 1, 2] } };
    const { right, dy, on } = L.lights;
    const lm = on === 'cluster' ? this.clusterAt(right, dy) : this.fascia(this.x0 - right, this.belt + dy);
    if (L.lights.kind === 'knob') {
      fineDetail(this.hinge(this.group, ORIGIN, 'light_switch', lm.at(0, 0, 0), { channel: 'lights', kind: 'rot', axis: lm.n, amount: -0.55 }, lightCtl, (b) => {
        b.push(lm.matrix).color(COLOURS.black).cylinderZ('trim', [0, 0, 0.01], 0.017, 0.01, 8);
        b.color(COLOURS.white).quad('trim', [-0.002, 0.002, 0.0205], [0.002, 0.002, 0.0205], [0.002, 0.014, 0.0205], [-0.002, 0.014, 0.0205]);
        b.pop();
      }));
    } else {
      this.fixed.push(lm.matrix).color(COLOURS.black);
      pad(this.fixed, 'trim', [0, 0, 0.003], [0.017, 0.027, 0.003], 0.002);
      this.fixed.pop();
      fineDetail(this.hinge(this.group, ORIGIN, 'light_switch', lm.at(0, 0, 0.006), { channel: 'lights', kind: 'rot', axis: lm.u, amount: 0.16 }, lightCtl, (b) => {
        b.push(lm.matrix).color(shade(this.spec.look.dash, 1.4));
        pad(b, 'trim', [0, 0, 0.011], [0.012, 0.022, 0.005], 0.003);
        b.color(COLOURS.green).quad('trim', [-0.005, 0.006, 0.0162], [0.005, 0.006, 0.0162], [0.005, 0.014, 0.0162], [-0.005, 0.014, 0.0162]);
        b.pop();
      }));
    }
    const [hx, hdy] = L.hazard;
    const hm = this.fascia(hx, this.belt + hdy);
    fineDetail(this.hinge(this.group, ORIGIN, 'hazard_button', hm.at(0, 0, 0), { channel: 'hazard', kind: 'pos', axis: scale(hm.n, -1), amount: 0.005 }, { id: 'hazard', label: 'Аварийка' }, (b) => {
      b.push(hm.matrix).color(COLOURS.hazard);
      pad(b, 'trim', [0, 0, 0.007], [0.015, 0.013, 0.007], 0.003);
      b.color(COLOURS.white).tri('trim', [-0.007, -0.005, 0.0145], [0.007, -0.005, 0.0145], [0, 0.007, 0.0145]);
      b.pop();
    }));
  }

  // ---- driving controls ----

  /** Column, shroud, stalks and the steering wheel with its horn pad. */
  private steering(): void {
    const w = this.lay.wheel;
    const centre = this.P(this.x0, this.belt + w.dy, this.frame.cowl + w.ds);
    // Local +Y runs up the column towards the driver; local +Z is the wheel's twelve o'clock.
    const tilt = -(Math.PI / 2 - w.rake);
    const toDriver = rotX([0, 1, 0], tilt);
    const local = (p: Vec3): Vec3 => add(centre, rotX(p, tilt));

    const b = this.fixed.pushAt(centre, [tilt, 0, 0]);
    // The column, from inside the shroud down its own line: 0.4 below the hub, or with
    // `toFloor` on to where it meets the floor or toe board (sampled every centimetre).
    let end = 0.4;
    if (w.toFloor) {
      const down = Math.sin(w.rake);
      const ahead = Math.cos(w.rake);
      while (end < 1.5 && this.belt + w.dy - end * down > this.floorAt(this.frame.cowl + w.ds - end * ahead)) end += 0.01;
    }
    b.color(COLOURS.metal).cylinderY('trim', [0, -(end + 0.1) / 2, 0], 0.02, (end - 0.1) / 2, 8, false);
    b.color(COLOURS.black);
    pad(b, 'trim', [0, -0.165, -0.008], [0.045, 0.095, 0.04], 0.014);
    b.pop();

    const stalks: [number, string, string, KitControl['action'], number][] = [
      [1, 'stalk_blinker', 'Поворотники', { type: 'cycle', channel: 'blinker', values: [0, -1, 1] }, -0.2],
      [-1, 'stalk_wipers', 'Дворники', { type: 'cycle', channel: 'wipers', values: [0, 1, 2] }, -0.13],
    ];
    for (const [side, name, label, action, amount] of stalks) {
      const at = local([side * 0.045, -0.11, 0.005]);
      const channel = action!.channel;
      fineDetail(this.hinge(this.group, ORIGIN, name, at, { channel, kind: 'rot', axis: toDriver, amount }, { id: channel, label, action }, (s) => {
        s.pushAt(centre, [tilt, 0, 0]).color(COLOURS.black);
        beam(s, 'trim', [side * 0.04, -0.11, 0.005], [side * 0.16, -0.122, -0.015], 0.0055, 0.0055);
        pad(s, 'trim', [side * 0.172, -0.124, -0.017], [0.016, 0.009, 0.009], 0.004);
        s.pop();
      }));
    }

    const wheel = pivotGroup('steering_wheel', centre, { channel: 'steer', kind: 'rot', axis: [0, 1, 0], amount: (485 * Math.PI) / 180 });
    wheel.rotation.x = tilt;
    const wb = new PartBuilder().color(COLOURS.black);
    const R = w.radius;
    wb.torusY('trim', R, w.rim, 16, 5);
    wb.cylinderY('trim', [0, -0.045, 0], 0.04, 0.02, 8);
    for (const deg of w.spokes) {
      const a = (deg * Math.PI) / 180;
      beam(wb, w.chrome ? 'chrome' : 'trim', [Math.cos(a) * 0.035, -0.04, Math.sin(a) * 0.035], [Math.cos(a) * (R - 0.006), -0.004, Math.sin(a) * (R - 0.006)], 0.016, 0.006);
    }
    addBuilt(wheel, wb, ORIGIN, 'steering_wheel', true);
    attach(this.group, ORIGIN, wheel);
    fineDetail(this.hinge(wheel, ORIGIN, 'horn', ORIGIN, { channel: 'horn', kind: 'pos', axis: [0, -1, 0], amount: 0.006 }, { id: 'horn', label: 'Гудок', action: { type: 'press', channel: 'horn' } }, (h) => {
      h.color(shade(COLOURS.black, 1.3));
      if (w.hub === 'round') {
        h.cylinderY(w.chrome ? 'chrome' : 'trim', [0, -0.02, 0], 0.055, 0.012, 10);
        h.color(COLOURS.black).cylinderY('chrome', [0, -0.006, 0], 0.016, 0.003, 6);
      } else {
        pad(h, w.chrome ? 'chrome' : 'trim', [0, -0.02, -0.005], [0.075, 0.014, 0.05], 0.012);
      }
    }));
  }

  /** Clutch, brake and throttle hung from the scuttle; a press swings the pad forward. */
  private pedals(): void {
    const L = this.lay;
    const toe = Math.atan2(L.toeTop, L.toeRun) * 0.8;
    const pedals: [string, number, number, number, number][] = [
      ['clutch', 0.13, 0.03, 0.035, -0.18],
      ['brake', -0.01, 0.032, 0.035, -0.18],
      ['throttle', -0.13, 0.02, 0.05, -0.15],
    ];
    for (const [name, dx, hw, hh, amount] of pedals) {
      const x = this.x0 + dx;
      const pivot = this.P(x, this.belt + L.pedals.pivot[1], this.frame.cowl + L.pedals.pivot[0]);
      const padAt = this.P(x, this.floorY + L.pedals.pad[1], this.frame.cowl + L.pedals.pad[0]);
      fineDetail(this.hinge(this.group, ORIGIN, `pedal_${name}`, pivot, { channel: name, kind: 'rot', axis: [1, 0, 0], amount }, undefined, (b) => {
        b.color(COLOURS.metal);
        beam(b, 'trim', pivot, add(padAt, [0, 0, -0.01]), 0.008, 0.005, [0, 0, 1]);
        b.color(COLOURS.rubber).pushAt(padAt, [toe, 0, 0]);
        pad(b, 'trim', ORIGIN, [hw, hh, 0.009], 0.004);
        b.pop();
      }));
    }
  }

  /** Gear lever in its gaiter (two nested pivots for the H gate) and the handbrake. */
  private levers(): void {
    const L = this.lay;
    const b = this.fixed;
    const cowl = this.frame.cowl;
    if (L.console) {
      const { ds0, ds1, height } = L.console;
      const y1 = this.floorY + height;
      b.color(shade(this.spec.look.dash, 1.05));
      pad(b, 'trim', this.P(0, (this.floorY + y1) / 2, cowl + (ds0 + ds1) / 2), [0.1, (y1 - this.floorY) / 2, (ds1 - ds0) / 2], 0.02);
    }
    const gs = cowl + L.gear.ds;
    const base = L.console ? this.floorY + L.console.height : this.tunnelTop(gs);
    b.color(COLOURS.rubber);
    gaiter(b, 'trim', this.P(0, base, gs), [[0, 0.07], [0.05, 0.05], [0.1, 0.026]], 8);
    const pivot = this.P(0, base + 0.04, gs);
    const fb = fineDetail(this.hinge(this.group, ORIGIN, 'gear_fb', pivot, { channel: 'gear_fb', kind: 'rot', axis: [1, 0, 0], amount: 0.2 }, undefined, () => {}));
    this.hinge(fb, pivot, 'gear_lr', pivot, { channel: 'gear_lr', kind: 'rot', axis: [0, 0, 1], amount: 0.14 }, undefined, (g) => {
      const knob = this.P(0, base + L.gear.height, gs + L.gear.lean);
      g.color(COLOURS.black);
      beam(g, 'trim', pivot, knob, 0.0065, 0.0065, [1, 0, 0]);
      pad(g, 'trim', knob, [0.02, 0.023, 0.022], 0.009);
    });

    const hs = this.hipS + L.handbrake.rear;
    const hy = this.tunnelTop(hs) + 0.03;
    b.color(COLOURS.black);
    pad(b, 'trim', this.P(0, hy - 0.012, hs - 0.06), [0.035, 0.026, 0.09], 0.012);
    const hp = this.P(0, hy, hs);
    const tip = this.P(0, hy + 0.05, hs - L.handbrake.length);
    fineDetail(this.hinge(this.group, ORIGIN, 'handbrake', hp, { channel: 'handbrake', kind: 'rot', axis: [1, 0, 0], amount: -0.4 }, { id: 'handbrake', label: 'Ручник' }, (h) => {
      h.color(COLOURS.metal);
      // The lever stops just inside the grip, so its end is not in the grip's end.
      beam(h, 'trim', hp, add(hp, scale(sub(tip, hp), 0.98)), 0.011, 0.014);
      h.color(COLOURS.black);
      beam(h, 'trim', add(hp, scale(sub(tip, hp), 0.5)), tip, 0.016, 0.02);
      h.cylinderZ('chrome', add(tip, [0, 0, 0.006]), 0.007, 0.007, 6);
    }));

    // The Niva's transfer-box levers: fixed, each a metal stem out of its own small gaiter
    // with a black knob on it.
    if (L.transfer) {
      const ts = cowl + L.transfer.ds;
      const top = this.tunnelTop(ts);
      for (const t of L.transfer.levers) {
        b.color(COLOURS.rubber);
        gaiter(b, 'trim', this.P(t.x, top, ts), [[0, 0.035], [0.03, 0.026], [0.06, 0.012]], 8);
        const knob = this.P(t.x + t.lean[1], top + t.height, ts + t.lean[0]);
        b.color(COLOURS.metal);
        beam(b, 'trim', this.P(t.x, top + 0.03, ts), knob, 0.005, 0.005, [1, 0, 0]);
        b.color(COLOURS.black);
        pad(b, 'trim', knob, [t.knob, t.knob, t.knob], t.knob * 0.45);
      }
    }
  }

  // ---- seats ----

  /** Front seat: base sliding on rails, backrest reclining, headrest rising along it. */
  private frontSeat(side: number): void {
    const L = this.lay;
    const pos = side > 0 ? 'fl' : 'fr';
    const x = side * this.x0;
    const hip = this.hipS;
    const top = this.floorY + L.cushion;
    const uph = this.spec.look.upholstery;
    const insert = shade(uph, 1.35);
    const fixed = this.fixed.color(COLOURS.metal);
    for (const dx of [-0.17, 0.17]) beam(fixed, 'trim', this.P(x + dx, this.standY + 0.012, hip - 0.45), this.P(x + dx, this.standY + 0.012, hip + 0.1), 0.012, 0.012);

    const baseAt = this.P(x, this.floorY, hip - 0.15);
    const seat = this.hinge(this.group, ORIGIN, `seat_${pos}`, baseAt, { channel: `seat_${pos}`, kind: 'pos', axis: [0, 0, 1], amount: 0.15 }, { id: `seat_${pos}`, label: `Сиденье ${WHERE[pos]}` }, (b) => {
      const frameTop = top - 0.12;
      const frameBottom = this.floorY + 0.025;
      b.color(COLOURS.black);
      pad(b, 'trim', this.P(x, (frameBottom + frameTop) / 2, hip - 0.17), [0.2, (frameTop - frameBottom) / 2, 0.2], 0.02);
      b.pushAt(this.P(x, top - 0.065, hip - 0.17), [-0.07, 0, 0]).color(uph);
      pad(b, 'trim', ORIGIN, [0.25, 0.065, 0.26], 0.04);
      inlay(b.color(insert), 'trim', [[-0.11, 0.065, -0.19], [0.11, 0.065, -0.19], [0.11, 0.065, 0.19], [-0.11, 0.065, 0.19]]);
      b.pop();
    });

    const t = L.recline;
    const backAt = this.P(x, top - 0.035, hip + 0.07);
    const back = this.hinge(seat, baseAt, `seatback_${pos}`, backAt, { channel: `seatback_${pos}`, kind: 'rot', axis: [1, 0, 0], amount: -0.6 }, { id: `seatback_${pos}`, label: `Спинка сиденья ${WHERE[pos]}` }, (b) => {
      b.pushAt(backAt, [-t, 0, 0]).color(uph);
      pad(b, 'trim', [0, 0.27, -0.05], [0.245, 0.27, 0.065], 0.04, 0.88);
      if (L.bolsters) for (const sx of [-1, 1]) pad(b, 'trim', [sx * 0.2, 0.24, -0.005], [0.045, 0.22, 0.05], 0.03);
      inlay(b.color(insert), 'trim', [[-0.1, 0.07, 0.015], [0.1, 0.07, 0.015], [0.1, 0.48, 0.015], [-0.1, 0.48, 0.015]]);
      b.pop();
    });

    if (!this.spec.look.headrests) return;
    const headAt = add(backAt, rotX([0, 0.58, -0.05], -t));
    this.hinge(back, backAt, `headrest_${pos}`, headAt, { channel: `headrest_${pos}`, kind: 'pos', axis: rotX([0, 1, 0], -t), amount: 0.08 }, { id: `headrest_${pos}`, label: `Подголовник ${WHERE[pos]}` }, (b) => {
      b.pushAt(headAt, [-t, 0, 0]);
      b.color(COLOURS.black);
      for (const sx of [-0.07, 0.07]) beam(b, 'chrome', [sx, -0.045, 0], [sx, 0.015, 0], 0.005, 0.005);
      b.color(uph);
      pad(b, 'trim', [0, 0.065, 0], [0.13, 0.065, 0.05], 0.028);
      b.pop();
    });
  }

  /**
   * Rear bench on a closed base. A saloon also gets a riser behind it over the rear
   * axle, up to the shelf. A hatch's load floor (bay.ts) meets the base's back.
   */
  private bench(): void {
    const L = this.lay;
    const b = new PartBuilder();
    const H = this.benchS;
    const top = this.floorY + L.benchCushion;
    const wall = this.frame.wellX(this.spec.wheels.rear) - (L.bench.clear ?? 0.022);
    const half = wall - 0.013;
    const uph = this.spec.look.upholstery;
    const insert = shade(uph, 1.35);
    const skirtTop = top - 0.12;
    b.color(shade(uph, 0.85));
    pad(b, 'trim', this.P(0, (this.standY + skirtTop) / 2, H + (BENCH_BACK - 0.36) / 2), [wall, (skirtTop - this.standY) / 2, (BENCH_BACK + 0.36) / 2], 0.015);
    if (!this.hatch) {
      const s0 = H + 0.1;
      const s1 = this.frame.rearBase - 0.015;
      const y1 = top + 0.025;
      b.box('trim', this.P(0, (this.floorY + y1) / 2, (s0 + s1) / 2), [wall, (y1 - this.floorY) / 2, (s1 - s0) / 2]);
    }
    b.pushAt(this.P(0, top - 0.07, H - 0.13), [-0.06, 0, 0]).color(uph);
    pad(b, 'trim', ORIGIN, [half, 0.07, 0.25], 0.04);
    b.color(insert);
    for (const sx of [-BENCH_SEAT_X, BENCH_SEAT_X]) inlay(b, 'trim', [[sx - 0.12, 0.07, -0.18], [sx + 0.12, 0.07, -0.18], [sx + 0.12, 0.07, 0.18], [sx - 0.12, 0.07, 0.18]]);
    b.pop();
    b.pushAt(this.P(0, top - 0.035, H), [-L.benchRecline, 0, 0]).color(uph);
    pad(b, 'trim', [0, 0.25, -0.05], [half, 0.25, 0.065], 0.04, 0.97);
    b.color(insert);
    for (const sx of [-BENCH_SEAT_X, BENCH_SEAT_X]) inlay(b, 'trim', [[sx - 0.11, 0.06, 0.015], [sx + 0.11, 0.06, 0.015], [sx + 0.11, 0.42, 0.015], [sx - 0.11, 0.42, 0.015]]);
    b.pop();
    const group = new THREE.Group();
    group.name = KIT_BENCH_NODE;
    addBuilt(group, b, ORIGIN, 'bench', true);
    this.group.add(group);
  }

  // ---- doors ----

  /** s range of a door owner's strips, above (`upper`) or below the belt. */
  private doorRange(owner: string, band: 'upper' | 'lower'): P2 | null {
    const cols = this.spec.cabin.columns;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i + 1 < cols.length; i++) {
      const c = cols[i]!;
      const o = band === 'upper' ? c.upper ?? 'body' : c.lower ?? c.upper ?? 'body';
      if (o !== owner) continue;
      lo = Math.min(lo, c.s);
      hi = Math.max(hi, cols[i + 1]!.s);
    }
    return lo < hi ? [lo, hi] : null;
  }

  /** Trim on each door card, hung in the door's node. */
  private doors(): void {
    const f = this.frame;
    const cab = this.spec.cabin;
    for (const [owner, door] of this.ctx.nodes) {
      const m = /^door_([fr])([lr])$/.exec(owner);
      if (!m) continue;
      const pos = `${m[1]}${m[2]}`;
      const side = m[2] === 'l' ? 1 : -1;
      const front = m[1] === 'f';
      const lower = this.doorRange(front ? 'door1' : 'door2', 'lower');
      const upper = this.doorRange(front ? 'door1' : 'door2', 'upper');
      if (!lower || !upper) continue;
      const [s0, s1] = lower;
      const len = s1 - s0;
      const belt = f.station((s0 + s1) / 2).belt;
      // A point standing `d` in from the door card.
      const card = (s: number, y: number, d: number): Vec3 => this.P(side * (f.sideX(s, y) - DOOR_CARD - d), y, s);

      const group = new THREE.Group();
      group.name = 'kit_cabin';
      door.node.add(group);
      const b = new PartBuilder();

      // Armrest with a pull cup in its top.
      const ay = belt - 0.23;
      const as = s0 + (front ? 0.58 : 0.5) * len;
      const ah = front ? 0.15 : 0.12;
      b.color(shade(this.spec.look.upholstery, 0.75));
      b.bevelBox('trim', card(as, ay, 0.03), [0.03, 0.025, ah], 0.012);
      b.color(COLOURS.black);
      const cup = (s: number, k: number): Vec3 => card(s, ay + 0.025, 0.03 + k * 0.016);
      inlay(b, 'trim', [cup(as - 0.06, -1), cup(as + 0.04, -1), cup(as + 0.04, 1), cup(as - 0.06, 1)]);

      // Inner handle: a chrome lever in a dark recess at the card's front top. The recess
      // stands 7.5 mm off the card line: the door's inner skin, offset along its own
      // normals, wanders a millimetre or so either side of that line, and the two stay
      // apart in depth from the road. The lever and the lock knob are the door's fine
      // detail (`fineDetail`), built apart from the card; the recess stays with it.
      const fd = front ? this.lay.frontDoor : undefined;
      const hs = s0 + (fd ? fd.handle[0] : front ? 0.13 : 0.1);
      const hy = belt + (fd ? fd.handle[1] : -0.085);
      b.quad('trim', card(hs - 0.05, hy - 0.022, 0.0075), card(hs + 0.05, hy - 0.022, 0.0075), card(hs + 0.05, hy + 0.022, 0.0075), card(hs - 0.05, hy + 0.022, 0.0075));
      const fit = new PartBuilder().color(COLOURS.black);
      beam(fit, 'chrome', card(hs + 0.035, hy, 0.008), card(hs - 0.03, hy, 0.012), 0.006, 0.007);

      // Capping over the door's top between the card and the glass, and the lock knob through it.
      const [u0, u1] = upper;
      const ky = (s: number): number => f.section(s).r4[1] + cab.glassBottom - 0.004;
      const cap = (s: number, d: number): Vec3 => this.P(side * (this.glassX(s, ky(s)) - d), ky(s), s);
      b.color(this.spec.look.dash).quad('trim', cap(u0 + 0.01, 0.02), cap(u1 - 0.01, 0.02), cap(u1 - 0.01, DOOR_CARD + 0.002), cap(u0 + 0.01, DOOR_CARD + 0.002));
      const knob = cap(u1 - 0.07, 0.05);
      fit.cylinderY('chrome', add(knob, [0, 0.014, 0]), 0.0065, 0.016, 6);

      addBuilt(group, b, door.pivot, `trim_${pos}`, true);
      const fittings = fineDetail(new THREE.Group());
      fittings.name = `fittings_${pos}`;
      group.add(fittings);
      addBuilt(fittings, fit, door.pivot, `fittings_${pos}`, true);

      // Window crank: four turns over the window's travel.
      const window = `window_${pos}`;
      if (!this.ctx.nodes.has(window)) continue;
      const cs = s0 + (fd ? fd.crank[0] : front ? 0.35 : 0.28);
      const cy = belt + (fd ? fd.crank[1] : -0.35);
      const at = card(cs, cy, 0.006);
      const control: KitControl = { id: `crank_${pos}`, label: `Стеклоподъёмник, ${pos.startsWith('f') ? 'передняя' : 'задняя'} ${pos.endsWith('l') ? 'левая' : 'правая'} дверь`, action: { type: 'toggle', channel: window } };
      fineDetail(this.hinge(group, door.pivot, `crank_${pos}`, at, { channel: window, kind: 'rot', axis: [1, 0, 0], amount: side * 8 * Math.PI }, control, (c) => {
        const inward = (d: number): Vec3 => [-side * d, 0, 0];
        const end = add(at, [0, 0.06, -0.045]);
        c.color(COLOURS.metal).cylinderX('chrome', add(at, inward(0.006)), 0.02, 0.006, 8);
        beam(c, 'chrome', add(at, inward(0.014)), add(end, inward(0.014)), 0.008, 0.004, [1, 0, 0]);
        c.color(COLOURS.black).cylinderX('trim', add(end, inward(0.032)), 0.011, 0.016, 6);
      }));
    }
  }
}
