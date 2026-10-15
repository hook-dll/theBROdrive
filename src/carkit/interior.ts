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
import { DOOR_THICKNESS as DOOR_CARD, LINING_DEPTH, type BodyFrame } from './body';
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
  readonly bench: { readonly from: 'rearBase' | 'hip'; readonly offset: number };
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
  /** Binnacle section (ds, dy) and half width about the column; the gauges sit on its face at `cluster`. */
  readonly binnacle: readonly P2[];
  readonly binnacleHalf: number;
  readonly cluster: number;
  readonly gauges: readonly GaugeLook[];
  /**
   * Steering wheel centre (ds, dy), column rake above horizontal, rim radius and tube,
   * spoke angles (0 = driver's left, 90 = up) and the horn: a round boss or a wide pad.
   */
  readonly wheel: {
    readonly ds: number;
    readonly dy: number;
    readonly rake: number;
    readonly radius: number;
    readonly rim: number;
    readonly spokes: readonly number[];
    readonly hub: 'round' | 'pad';
  };
  /** Pedal hinge (ds, dy) under the dash and pad centre (ds, height over the floor). */
  readonly pedals: { readonly pivot: P2; readonly pad: P2 };
  /** Gear lever: ds of its gaiter, height and how far its knob leans back. */
  readonly gear: { readonly ds: number; readonly height: number; readonly lean: number };
  /** Handbrake hinge behind the driver's hip, and its length forward. */
  readonly handbrake: { readonly rear: number; readonly length: number };
  /** Fascia fittings at [x, dy]; the light switch is placed off the column, to the driver's right by `right`. */
  readonly glovebox: { readonly x: number; readonly dy: number; readonly half: P2 };
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
   * Warning lamps on the cluster face: `show` laid row by row into a grid `cols` wide at
   * `pitch`, centred at (right, up).
   */
  readonly lamps?: { readonly right: number; readonly up: number; readonly cols: number; readonly pitch: number; readonly show: readonly Telltale[] };
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

const LAYOUTS: Readonly<Record<KitCarSpec['platform'], Layout>> = {
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

/** The rear bench's hip along the car, for a frame and its layout. */
function benchHip(frame: BodyFrame, lay: Layout): number {
  return lay.bench.from === 'rearBase' ? frame.rearBase + lay.bench.offset : frame.cowl + lay.hip + lay.bench.offset;
}

/**
 * Where a hatch's or an estate's load space starts: the back of the rear bench's base.
 * bay.ts lays the load floor from here, so the two never overlap or leave a gap.
 */
export function loadSpaceStart(frame: BodyFrame): number {
  return benchHip(frame, { ...LAYOUTS[frame.spec.platform], ...frame.spec.cabinLayout }) + BENCH_BACK;
}

/** The cabin's floor pan: the shell's flat underbody plus `FLOOR_RISE`. */
function cabinFloor(frame: BodyFrame): number {
  return frame.station(frame.cowl + 0.5).sill + FLOOR_RISE;
}

/** Underside of the headliner (the shell's roof lining) at half width x. */
function headlinerUnder(cab: KitCarSpec['cabin'], x: number): number {
  const xr = cab.railHalf - cab.railInset;
  return cab.rail + cab.railRise + cab.crown * (1 - (x / xr) ** 2) - LINING_DEPTH;
}

/**
 * The driver's eye in the kit frame, over his cushion and kept under the headliner: the
 * `KIT_DRIVER_EYE_NODE`, and what the mirrors are turned to (exterior.ts as well).
 */
export function driverEyeAt(frame: BodyFrame): Vec3 {
  const lay = { ...LAYOUTS[frame.spec.platform], ...frame.spec.cabinLayout };
  const y = Math.min(cabinFloor(frame) + lay.cushion + SEATED_EYE, headlinerUnder(frame.spec.cabin, lay.seatX) - EYE_HEADROOM);
  return [lay.seatX, y, frame.z(frame.cowl + lay.hip + EYE_BEHIND_HIP)];
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
  /** Firewall lining, floor height, the floor's rear end (the rear arch's front). */
  private readonly fw: number;
  private readonly floorY: number;
  private readonly floorEnd: number;
  private readonly rows: readonly FloorRow[];
  /** The belt at the cowl: the dash's datum. */
  private readonly belt: number;
  /** Driver's hip and the rear bench's hip. */
  private readonly hipS: number;
  private readonly benchS: number;
  /** Lining below the belt ends here: at the boot, or at a hatch's load floor. */
  private readonly lowerEnd: number;
  /** Steering column's x. */
  private readonly x0: number;

  constructor(ctx: KitContext) {
    this.ctx = ctx;
    this.frame = ctx.frame;
    this.spec = ctx.frame.spec;
    this.lay = { ...LAYOUTS[this.spec.platform], ...this.spec.cabinLayout };
    this.hatch = this.spec.bootEnd === undefined;
    const f = this.frame;
    const w = this.spec.wheels;
    this.fw = f.cowl + FIREWALL;
    this.floorY = cabinFloor(f);
    this.floorEnd = w.rear - w.radius * f.archFactor(w.rear) - 0.01;
    this.belt = f.station(f.cowl).belt;
    this.hipS = f.cowl + this.lay.hip;
    this.benchS = benchHip(f, this.lay);
    this.lowerEnd = this.hatch ? this.benchS + BENCH_BACK : f.rearBase - 0.005;
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
    this.humps();
    this.sills();
    this.lining();
    this.headliner();
    this.shelf();
    this.dash();
    this.steering();
    this.pedals();
    this.levers();
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
    const y = Math.min(this.floorY + this.lay.benchCushion + SEATED_EYE, this.dome(BENCH_SEAT_X) - EYE_HEADROOM);
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

  /** Underside of the headliner at half width x. */
  private dome(x: number): number {
    return headlinerUnder(this.spec.cabin, x);
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
      if ((c.lower ?? c.upper ?? 'body') !== 'body') continue;
      const s0 = Math.max(c.s, this.fw);
      const s1 = Math.min(cols[i + 1]!.s, this.lowerEnd);
      if (s1 - s0 < 0.005) continue;
      const samples = [s0, s1];
      for (let k = -1; k <= 1; k += 0.25) samples.push(w.rear + k * r);
      const ss = [...new Set(samples.filter((s) => s >= s0 && s <= s1))].sort((a, b) => a - b);
      for (const side of [1, -1]) {
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
      if (!c.foot) continue;
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
    // facet of the top stands parallel to the well's roof under it, HUMP_RISE above.
    const top = (s: number): number => this.frame.archY(Math.min(Math.max(s, w.rear - r), w.rear + r)) + HUMP_RISE;
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
      const yt = cab.rail + cab.crown * (1 - frac * frac);
      const s = kind === 'front' ? f.screenFoot(frac) : f.rearBase;
      const yb = f.deckY(s, frac * f.section(kind === 'front' ? f.cowl : s).r4[0]);
      if (kind === 'rear' && cab.rearKnee) {
        const cb = f.deckY(s, 0);
        const kt = (cab.rearKnee.y - cb) / (cab.rail + cab.crown - cb);
        return [[cab.rearKnee.s, lerp(yb, yt, kt)], [topN, yt]];
      }
      return [[s, yb], [kind === 'front' ? top0 : topN, yt]];
    };
    const frontTop = top0 + 0.03;
    const rearTop = topN - (this.hatch ? 0.06 : 0.03);

    // Courtesy lamp: the lens is its switch. Lit, it slides up into the headliner by
    // `GLOW_TRAVEL` and its lit face slides down out of the headliner into its place, so
    // the two never lie in one plane. The car the player sits in also lights the cabin
    // from here (`Vehicle.syncDomeLight`).
    const lampS = lerp(frontTop, rearTop, 0.45);
    const ly = this.dome(0) - 0.004;
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
    const my = cab.rail - 0.085;
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
    const root = this.P(0, cab.rail - 0.01, glassS(0, cab.rail - 0.01) + 0.03);
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
      const y = this.dome(Math.abs(x) + 0.16) - 0.014;
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
    this.prismX(b, 'trim', [this.x0 - L.binnacleHalf, this.x0 + L.binnacleHalf], () => L.binnacle.map(([ds, dy]): P2 => [cowl + ds, belt + dy]));
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
    if (L.clusterFace) {
      // The frame laid in the binnacle's face, the face laid in the frame: one plane.
      const { right, up, half: [hx, hy], colour, frame } = L.clusterFace;
      b.push(this.clusterAt(right, up).matrix).color(COLOURS.black);
      inlay(b, frame === 'chrome' ? 'chrome' : 'trim', rectCorners(0, 0, hx + 0.006, hy + 0.006, 0));
      inlay(b.color(colour), 'trim', rectCorners(0, 0, hx, hy, 0));
      b.pop();
    }
    if (L.lamps) {
      const { right, up, cols, pitch, show } = L.lamps;
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
      b.push(m.matrix).color(shade(this.spec.look.dash, 1.15));
      pad(b, 'trim', [0, 0, 0.007], [hx, hy, 0.007], 0.005);
      b.color(COLOURS.black).box('chrome', [0, hy - 0.018, 0.016], [0.03, 0.006, 0.003]);
      b.pop();
    }));
  }

  /** Radio: a dial with a needle drifting along the band, a power knob and a tuning knob. */
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
    fineDetail(this.hinge(this.group, ORIGIN, 'radio_knob', knobAt, { channel: 'radio', kind: 'rot', axis: m.n, amount: -0.6 }, { id: 'radio', label: 'Магнитола' }, (k) => {
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
    b.color(COLOURS.metal).cylinderY('trim', [0, -0.25, 0], 0.02, 0.15, 8, false);
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
      beam(wb, 'trim', [Math.cos(a) * 0.035, -0.04, Math.sin(a) * 0.035], [Math.cos(a) * (R - 0.006), -0.004, Math.sin(a) * (R - 0.006)], 0.016, 0.006);
    }
    addBuilt(wheel, wb, ORIGIN, 'steering_wheel', true);
    attach(this.group, ORIGIN, wheel);
    fineDetail(this.hinge(wheel, ORIGIN, 'horn', ORIGIN, { channel: 'horn', kind: 'pos', axis: [0, -1, 0], amount: 0.006 }, { id: 'horn', label: 'Гудок', action: { type: 'press', channel: 'horn' } }, (h) => {
      h.color(shade(COLOURS.black, 1.3));
      if (w.hub === 'round') {
        h.cylinderY('trim', [0, -0.02, 0], 0.055, 0.012, 10);
        h.color(COLOURS.black).cylinderY('chrome', [0, -0.006, 0], 0.016, 0.003, 6);
      } else {
        pad(h, 'trim', [0, -0.02, -0.005], [0.075, 0.014, 0.05], 0.012);
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
    for (const dx of [-0.17, 0.17]) beam(fixed, 'trim', this.P(x + dx, this.floorY + 0.012, hip - 0.45), this.P(x + dx, this.floorY + 0.012, hip + 0.1), 0.012, 0.012);

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
    const wall = this.frame.wellX(this.spec.wheels.rear) - 0.022;
    const half = wall - 0.013;
    const uph = this.spec.look.upholstery;
    const insert = shade(uph, 1.35);
    const skirtTop = top - 0.12;
    b.color(shade(uph, 0.85));
    pad(b, 'trim', this.P(0, (this.floorY + skirtTop) / 2, H + (BENCH_BACK - 0.36) / 2), [wall, (skirtTop - this.floorY) / 2, (BENCH_BACK + 0.36) / 2], 0.015);
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
