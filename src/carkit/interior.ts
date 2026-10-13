/**
 * The kit car's cabin: lining, furniture and door trim, built from the body frame's
 * cowl, belt, sill, rail and wheels and dressed per platform.
 *
 *  - LINING (carpet and tunnel, firewall, headliner, pillar and quarter trims, sills,
 *    arch humps, parcel shelf) closes the shell from inside, so neither the inner skin
 *    nor the void under the decks shows through the glass. It keeps clear of what moves
 *    or turns: a door's inner skin stands DOOR_CARD in from its outer skin, above the
 *    belt as well (the window frame), and the tyres turn outboard of `wellX`.
 *  - FURNITURE (dash, column and wheel, pedals, levers, seats) is fixed geometry in one
 *    builder, so the whole cabin is one mesh per slot. Each moving part is its own
 *    pivot group, tagged for the rig (rig.ts) with the shared channel names.
 *  - DOOR TRIM (armrest, handle, lock knob, window crank, the capping over the door's
 *    window sill) hangs inside each door node and swings with it.
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
import { DOOR_THICKNESS as DOOR_CARD, type BodyFrame } from './body';
import { PartBuilder, lerp, table, type KitSlot, type Vec3 } from './builder';
import { addBuilt, attach, pivotGroup, type KitContext } from './context';
import type { KitControl, KitMotion } from './rig';
import type { CabinColumn, KitCarSpec } from './spec';

type P2 = readonly [number, number];

/** Lining in from the outer skin below the belt, and in from the greenhouse above it. */
const SIDE_CLEAR = 0.08;
const GLASS_CLEAR = 0.075;
/** Pillar trims in from the greenhouse: about level with a door frame's inner skin. */
const PILLAR_IN = 0.065;
/** Side trim stops this far ahead of a tailgate's opening. */
const HATCH_TRIM_CLEAR = 0.06;
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

/** Warning lamps on a cluster face, in turn along the grid. */
const TELLTALES = [0x3fae4a, 0xd88a1c, 0xc4241c, 0x2e6fd0] as const;

/** Which seat or door a control belongs to, for its hover label. */
const WHERE: Readonly<Record<string, string>> = {
  fl: 'водителя',
  fr: 'пассажира',
  rl: 'задний левый',
  rr: 'задний правый',
  l: 'водителя',
  r: 'пассажира',
};

type GaugeChannel = 'speed' | 'rpm' | 'fuel' | 'temp';

interface GaugeBase {
  /**
   * What drives it. Absent: the needle stands fixed at mid-scale. Oil pressure, the
   * voltmeter and the economy meter have no channel in the rig, and a still needle
   * reads truer than one borrowed from another gauge.
   */
  readonly channel?: GaugeChannel;
  /** Centre on the cluster face: towards the driver's right of the column, and above the cowl's belt. */
  readonly right: number;
  readonly up: number;
  /** Channel value at full scale. */
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
  /** The light switch; on the cluster face its `dy` is a height like a gauge's `up`. */
  readonly lights: { readonly right: number; readonly dy: number; readonly kind: 'knob' | 'rocker'; readonly on?: 'fascia' | 'cluster' };
  /** Slatted face vents on the fascia at [x, dy]; without `x`, a pair at the dash's ends. */
  readonly vents?: readonly { readonly dy: number; readonly x?: number }[];
  /** Round eyeball vents on the fascia at [x, dy]. */
  readonly eyeballs?: { readonly radius: number; readonly at: readonly P2[] };
  /** A framed panel on the cluster face behind the gauges: centre (right, up), half size, colour and frame. */
  readonly clusterFace?: { readonly right: number; readonly up: number; readonly half: P2; readonly colour: number; readonly frame: 'chrome' | 'black' };
  /** Warning lamps on the cluster face: a grid of `cols` x `rows` at `pitch`, centred at (right, up). */
  readonly lamps?: { readonly right: number; readonly up: number; readonly cols: number; readonly rows: number; readonly pitch: number };
  /** Switches with no channel: [x, dy] on the fascia, or [right, up] on the cluster face as the gauges. */
  readonly rockers?: { readonly on: 'fascia' | 'cluster'; readonly at: readonly P2[] };
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
    wheel: { ds: 0.55, dy: 0.094, rake: 28 * (Math.PI / 180), radius: 0.19, rim: 0.0145, spokes: [-15, 195], hub: 'round' },
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
  lamps: { right: 0, up: 0.04, cols: 6, rows: 1, pitch: 0.02 },
  eyeballs: { radius: 0.026, at: [[0.115, -0.014], [0.045, -0.014]] },
  radio: [0, -0.08],
  wheel: { ...LAYOUTS.classic.wheel, radius: 0.2, rim: 0.012 },
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
    { right: -0.06, up: 0.062, radius: 0.024, ...SMALL },
    { channel: 'rpm', right: 0.03, up: 0.062, radius: 0.044, full: 8000, ...BIG },
    { channel: 'speed', right: 0.138, up: 0.062, radius: 0.044, full: 180, ...BIG },
  ],
  lights: { right: -0.18, dy: -0.05, kind: 'rocker' },
  rockers: { on: 'fascia', at: [[LAYOUTS.classic.seatX + 0.12, -0.05], [LAYOUTS.classic.seatX + 0.06, -0.05]] },
  wheel: { ...LAYOUTS.classic.wheel, radius: 0.2, rim: 0.012 },
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
    { right: 0, up: 0.03, radius: 0.02, ...SMALL },
  ],
  lamps: { right: 0, up: 0.088, cols: 3, rows: 2, pitch: 0.014 },
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
    { right: -0.172, up: 0.1, radius: 0.022, ...SMALL },
    { channel: 'temp', right: -0.172, up: 0.035, radius: 0.022, ...SMALL },
    { channel: 'fuel', right: 0.172, up: 0.1, radius: 0.022, ...SMALL },
    { right: 0.172, up: 0.035, radius: 0.022, ...SMALL },
  ],
  lamps: { right: 0, up: 0.0675, cols: 1, rows: 7, pitch: 0.016 },
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

/** Flat rectangle facing out of a mount's face (its matrix pushed), centred at (cx, cy), `z` off the face. */
function rect(b: PartBuilder, slot: KitSlot, cx: number, cy: number, hx: number, hy: number, z: number): void {
  b.quad(slot, [cx - hx, cy - hy, z], [cx + hx, cy - hy, z], [cx + hx, cy + hy, z], [cx - hx, cy + hy, z]);
}

/** A dial's needle and hub on mount `m`'s face, pointing at `angle` (rad, 0 = driver's right). */
function needle(b: PartBuilder, m: Mount, r: number, angle: number): void {
  const d: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
  const p: Vec3 = [-d[1], d[0], 0];
  const pt = (k: number, w: number): Vec3 => [d[0] * r * k + p[0] * w, d[1] * r * k + p[1] * w, 0.008];
  b.push(m.matrix).color(COLOURS.needle);
  b.quad('trim', pt(-0.15, -0.002), pt(0.85, -0.001), pt(0.85, 0.001), pt(-0.15, 0.002));
  b.color(COLOURS.black).cylinderZ('trim', [0, 0, 0.009], r * 0.12, 0.002, 6);
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

/** A point of the greenhouse ring seen from inside: belt, optional knee, rail. */
interface RingPoint {
  readonly b: Vec3;
  readonly k?: Vec3;
  readonly t: Vec3;
  readonly kind: 'front' | 'side' | 'rear';
  readonly column?: CabinColumn;
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
    this.floorY = f.station(f.cowl + 0.5).sill + FLOOR_RISE;
    this.floorEnd = w.rear - w.radius * w.arch - 0.01;
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
    this.pillars();
    this.headliner();
    this.shelf();
    this.dash();
    this.steering();
    this.pedals();
    this.levers();
    for (const side of [1, -1]) this.frontSeat(side);
    this.bench();
    addBuilt(this.group, this.fixed, ORIGIN, 'cabin', true);
    this.ctx.root.add(this.group);
    this.doors();
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
    const cab = this.spec.cabin;
    const xr = cab.railHalf - cab.railInset;
    return cab.rail + cab.railRise + cab.crown * (1 - (x / xr) ** 2) - 0.028;
  }

  /** Headliner's half width: inside the door frames' inner skins at the rail. */
  private get headHalf(): number {
    return this.spec.cabin.railHalf - 0.085;
  }

  /** A pivot group with its own geometry, hung under `parent` (standing at `parentAt`). */
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
    const r = w.radius * w.arch;
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
          return [this.P(x(yb), yb, s), this.P(x(yc), yc, s), this.P(x(belt), belt, s), this.P(side * (sec.r4[0] - PILLAR_IN), sec.r4[1], s)];
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
    const r = w.radius * w.arch;
    const s0 = w.rear - r - 0.005;
    const full = w.rear + r + 0.005;
    const s1 = Math.min(full, this.lowerEnd);
    const top = (s: number): number => w.radius + Math.sqrt(Math.max(0, r * r - (s - w.rear) ** 2)) + HUMP_RISE;
    const ss: number[] = [];
    for (let i = 0; i <= 8; i++) ss.push(lerp(s0, s1, i / 8));
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

  /** The greenhouse ring as the shell builds it, reduced to what the trims follow. */
  private ring(side: number): RingPoint[] {
    const f = this.frame;
    const cab = this.spec.cabin;
    const end = (kind: 'front' | 'rear'): RingPoint => {
      const s = kind === 'front' ? f.cowl : f.rearBase;
      const top = kind === 'front' ? cab.columns[0]!.top : cab.columns[cab.columns.length - 1]!.top;
      const x = f.deckFracs(s)[2]! * f.section(s).r4[0];
      const frac = f.deckFracs(f.cowl)[2]!;
      const b = this.P(side * x, f.deckY(s, x), s);
      const t = this.P(side * frac * cab.railHalf, cab.rail + cab.crown * (1 - frac * frac), top);
      if (kind === 'rear' && cab.rearKnee) {
        const cb = f.deckY(s, 0);
        const kt = (cab.rearKnee.y - cb) / (cab.rail + cab.crown - cb);
        return { b, k: [lerp(b[0], t[0], kt), lerp(b[1], t[1], kt), f.z(cab.rearKnee.s)], t, kind };
      }
      return { b, t, kind };
    };
    const sides = cab.columns.map((column): RingPoint => {
      const sec = f.section(column.s);
      return { b: this.P(side * sec.r4[0], sec.r4[1], column.s), t: this.P(side * cab.railHalf, cab.rail, column.top), kind: 'side', column };
    });
    return [end('front'), ...sides, end('rear')];
  }

  /**
   * Trim over the body's own greenhouse strips without glass: the screen and back-light
   * pillars, A, B and C pillars. Side strips stand in about as far as the door frames'
   * inner skins and turn in under the headliner's edge at the top.
   */
  private pillars(): void {
    const cab = this.spec.cabin;
    const rearIn = this.hatch ? 0.05 : 0.03;
    const b = this.fixed.color(this.lay.headliner);
    for (const side of [1, -1]) {
      // Side points come in; end points move along the car into the cabin. Nothing may
      // reach the cowl's plane, where the bay's scuttle stands.
      const front = this.frame.z(this.fw);
      // Behind a tailgate the jamb is deep and on an estate the back leans over it
      // (rearLean), so side trim keeps a hand's width ahead of the opening.
      const back = this.hatch ? this.frame.z(this.frame.rearBase) + HATCH_TRIM_CLEAR : -Infinity;
      const ring = this.ring(side).map((p) => {
        const move = (q: Vec3): Vec3 =>
          p.kind === 'side'
            ? [q[0] - side * PILLAR_IN, q[1], Math.max(back, Math.min(q[2], front))]
            : [q[0], q[1], q[2] + (p.kind === 'front' ? -0.03 : rearIn)];
        return { ...p, b: move(p.b), k: p.k && move(p.k), t: move(p.t) };
      });
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]!;
        const c = ring[i + 1]!;
        const both = a.kind === 'side' && c.kind === 'side';
        const trimmed =
          (a.kind === 'front' && c.kind === 'side') ||
          (a.kind === 'side' && c.kind === 'rear') ||
          (both && (a.column!.upper ?? 'body') === 'body' && (a.column!.glass ?? 'none') === 'none');
        if (!trimmed) continue;
        b.poly('trim', [a.b, c.b, ...(c.k ? [c.k] : []), c.t, a.t, ...(a.k ? [a.k] : [])]);
        if (both) {
          const lip = cab.rail - 0.004;
          b.quad('trim', a.t, c.t, [side * this.headHalf, lip, c.t[2]], [side * this.headHalf, lip, a.t[2]]);
        }
      }
    }
  }

  /**
   * Headliner under the roof, dropping down the screen's and back light's headers in
   * front and behind; plus the courtesy lamp, sun visors and the mirror.
   */
  private headliner(): void {
    const f = this.frame;
    const cab = this.spec.cabin;
    const top0 = cab.columns[0]!.top;
    const topN = cab.columns[cab.columns.length - 1]!.top;
    const half = this.headHalf;
    const xs = [1, 0.5, 0, -0.5, -1].map((k) => k * half);
    // Glass line at half width x: base (s, y) and top (s, y) for the screen or back light.
    const glass = (x: number, kind: 'front' | 'rear'): [P2, P2] => {
      const frac = Math.abs(x) / cab.railHalf;
      const yt = cab.rail + cab.crown * (1 - frac * frac);
      const s = kind === 'front' ? f.cowl : f.rearBase;
      const yb = f.deckY(s, frac * f.section(s).r4[0]);
      if (kind === 'rear' && cab.rearKnee) {
        const cb = f.deckY(s, 0);
        const kt = (cab.rearKnee.y - cb) / (cab.rail + cab.crown - cb);
        return [[cab.rearKnee.s, lerp(yb, yt, kt)], [topN, yt]];
      }
      return [[s, yb], [kind === 'front' ? top0 : topN, yt]];
    };
    const drop = (x: number, kind: 'front' | 'rear'): Vec3 => {
      const [[sb, yb], [st, yt]] = glass(x, kind);
      const y = this.dome(x) - (kind === 'front' ? cab.screenHeader : cab.rearHeader) - 0.01;
      const s = lerp(sb, st, (y - yb) / (yt - yb)) + (kind === 'front' ? 0.025 : this.hatch ? -0.05 : -0.025);
      return this.P(x, y, s);
    };
    const frontTop = top0 + 0.03;
    const rearTop = topN - (this.hatch ? 0.06 : 0.03);
    const rows = [
      xs.map((x) => drop(x, 'front')),
      xs.map((x) => this.P(x, this.dome(x), frontTop)),
      xs.map((x) => this.P(x, this.dome(x), rearTop)),
      xs.map((x) => drop(x, 'rear')),
    ];
    const b = this.fixed.color(this.lay.headliner);
    for (let i = 0; i + 1 < rows.length; i++) b.bridge('trim', rows[i]!, rows[i + 1]!);

    const lampS = lerp(frontTop, rearTop, 0.45);
    const ly = this.dome(0) - 0.004;
    b.color(COLOURS.lamp).quad('trim', this.P(0.05, ly, lampS - 0.03), this.P(-0.05, ly, lampS - 0.03), this.P(-0.05, ly, lampS + 0.03), this.P(0.05, ly, lampS + 0.03));

    // Mirror: hung from the header on a stem, well behind the screen.
    const [[sb, yb], [st, yt]] = glass(0, 'front');
    const atGlass = (y: number): number => lerp(sb, st, (y - yb) / (yt - yb));
    const my = cab.rail - 0.085;
    const ms = atGlass(my) + 0.07;
    const root = this.P(0, cab.rail - 0.01, atGlass(cab.rail - 0.01) + 0.03);
    b.color(COLOURS.black);
    beam(b, 'trim', root, this.P(0, my + 0.02, ms), 0.008, 0.008, [1, 0, 0]);
    b.pushAt(this.P(0, my, ms), [0.12, 0.1, 0]);
    pad(b, 'trim', ORIGIN, [0.105, 0.03, 0.014], 0.008);
    b.quad('chrome', [0.095, -0.022, -0.0145], [-0.095, -0.022, -0.0145], [-0.095, 0.022, -0.0145], [0.095, 0.022, -0.0145]);
    b.pop();

    // Sun visors lie flat under the headliner and swing down about their front edge.
    for (const side of [1, -1]) {
      const name = side > 0 ? 'visor_l' : 'visor_r';
      const x = side * 0.34;
      const y = this.dome(Math.abs(x) + 0.16) - 0.014;
      const at = this.P(x, y, frontTop + 0.005);
      this.hinge(this.group, ORIGIN, name, at, { channel: name, kind: 'rot', axis: [1, 0, 0], amount: -1.35 }, { id: name, label: `Козырёк ${WHERE[name.slice(-1)]}` }, (v) => {
        v.color(shade(this.lay.headliner, 0.92));
        v.pushAt(at);
        pad(v, 'trim', [0, -0.008, -0.08], [0.16, 0.008, 0.075], 0.006);
        v.pop();
      });
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
    let half = Infinity;
    for (let i = 0; i <= 4; i++) half = Math.min(half, this.inner(lerp(s0, s1, i / 4), y) - 0.01);
    this.fixed.color(shade(this.spec.look.dash, 1.1)).quad('trim', this.P(half, y, s0), this.P(-half, y, s0), this.P(-half, y, s1), this.P(half, y, s1));
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
    this.prismX(b, 'trim', [-half, -0.55 * half, 0, 0.55 * half, half], (x) => [
      [cowl + 0.012, f.deckY(cowl + 0.012, x) - 0.012],
      ...L.dash.map(([ds, dy]): P2 => [cowl + ds, belt + dy]),
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
      const { right, up, half: [hx, hy], colour, frame } = L.clusterFace;
      b.push(this.clusterAt(right, up).matrix).color(COLOURS.black);
      rect(b, frame === 'chrome' ? 'chrome' : 'trim', 0, 0, hx + 0.006, hy + 0.006, 0.0015);
      b.color(colour);
      rect(b, 'trim', 0, 0, hx, hy, 0.0025);
      b.pop();
    }
    if (L.lamps) {
      const { right, up, cols, rows, pitch } = L.lamps;
      b.push(this.clusterAt(right, up).matrix);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          b.color(TELLTALES[(r * cols + c) % TELLTALES.length]!);
          rect(b, 'trim', (c - (cols - 1) / 2) * pitch, ((rows - 1) / 2 - r) * pitch, pitch * 0.3, pitch * 0.3, 0.0035);
        }
      }
      b.pop();
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
        b.push(m.matrix).color(COLOURS.black);
        b.quad('trim', [-0.035, -0.024, 0.002], [0.035, -0.024, 0.002], [0.035, 0.024, 0.002], [-0.035, 0.024, 0.002]);
        b.color(look.dash);
        for (const y of [-0.012, 0, 0.012]) beam(b, 'trim', [-0.032, y, 0.005], [0.032, y, 0.005], 0.003, 0.004);
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
  }

  /** A round dial on the cluster face: bezel, face, ticks and a needle on its channel (fixed without one). */
  private gauge(g: RoundGauge): void {
    const m = this.clusterAt(g.right, g.up);
    const r = g.radius;
    const b = this.fixed.push(m.matrix);
    if (!g.bare) {
      b.color(COLOURS.black).cylinderZ('chrome', [0, 0, 0.006], r + 0.005, 0.006, 12, false);
      const disc: Vec3[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        disc.push([Math.cos(a) * r, Math.sin(a) * r, 0.004]);
      }
      b.color(COLOURS.face).poly('trim', disc);
    }
    b.color(COLOURS.tick);
    for (let i = 0; i < g.ticks; i++) {
      const a = g.rest - (g.sweep * i) / (g.ticks - 1);
      const d: Vec3 = [Math.cos(a), Math.sin(a), 0];
      const p: Vec3 = [-d[1] * 0.0018, d[0] * 0.0018, 0];
      const at = (k: number, sgn: number): Vec3 => [d[0] * r * k + sgn * p[0], d[1] * r * k + sgn * p[1], 0.0046];
      b.quad('trim', at(0.74, -1), at(0.92, -1), at(0.92, 1), at(0.74, 1));
    }
    b.pop();
    if (!g.channel) {
      needle(this.fixed, m, r, g.rest - g.sweep / 2);
      return;
    }
    const at = m.at(0, 0, 0.008);
    this.hinge(this.group, ORIGIN, `needle_${g.channel}`, at, { channel: g.channel, kind: 'rot', axis: m.n, amount: -g.sweep / g.full }, undefined, (n) => {
      needle(n, m, r, g.rest);
    });
  }

  /** A ribbon window on the cluster face, its ticks and a marker sliding along it with the channel. */
  private ribbon(g: RibbonGauge): void {
    const m = this.clusterAt(g.right, g.up);
    const [hw, hh] = g.half;
    const run = hw * 0.92;
    const b = this.fixed.push(m.matrix).color(COLOURS.black);
    rect(b, 'chrome', 0, 0, hw + 0.004, hh + 0.004, 0.003);
    b.color(COLOURS.face);
    rect(b, 'trim', 0, 0, hw, hh, 0.004);
    b.color(COLOURS.tick);
    for (let i = 0; i < g.ticks; i++) rect(b, 'trim', lerp(-run, run, i / (g.ticks - 1)), -hh * 0.45, 0.0012, hh * 0.4, 0.0046);
    b.pop();
    const at = m.at(-run, 0, 0.005);
    const motion: KitMotion | undefined = g.channel && { channel: g.channel, kind: 'pos', axis: m.u, amount: (2 * run) / g.full };
    const draw = (n: PartBuilder): void => {
      n.push(m.matrix).color(COLOURS.needle);
      rect(n, 'trim', motion ? -run : 0, 0, 0.0018, hh * 0.9, 0.005);
      n.pop();
    };
    if (motion) this.hinge(this.group, ORIGIN, `needle_${g.channel}`, at, motion, undefined, draw);
    else draw(this.fixed);
  }

  /** Lid hinged at its foot, falling open towards the passenger, over a dark opening. */
  private glovebox(): void {
    const { x, dy, half } = this.lay.glovebox;
    const m = this.fascia(x, this.belt + dy);
    const [hx, hy] = half;
    this.fixed.push(m.matrix).color(COLOURS.black);
    this.fixed.quad('trim', [-hx + 0.008, -hy + 0.006, 0.0015], [hx - 0.008, -hy + 0.006, 0.0015], [hx - 0.008, hy - 0.006, 0.0015], [-hx + 0.008, hy - 0.006, 0.0015]);
    this.fixed.pop();
    const at = m.at(0, -hy, 0.007);
    this.hinge(this.group, ORIGIN, 'glovebox', at, { channel: 'glovebox', kind: 'rot', axis: [1, 0, 0], amount: -1.2 }, { id: 'glovebox', label: 'Бардачок' }, (b) => {
      b.push(m.matrix).color(shade(this.spec.look.dash, 1.15));
      pad(b, 'trim', [0, 0, 0.007], [hx, hy, 0.007], 0.005);
      b.color(COLOURS.black).box('chrome', [0, hy - 0.018, 0.016], [0.03, 0.006, 0.003]);
      b.pop();
    });
  }

  /** Radio: a dial with a needle drifting along the band, a power knob and a tuning knob. */
  private radio(): void {
    const [x, dy] = this.lay.radio;
    const m = this.fascia(x, this.belt + dy);
    const b = this.fixed.push(m.matrix);
    b.color(COLOURS.black);
    pad(b, 'trim', [0, 0, 0.006], [0.09, 0.028, 0.006], 0.004);
    b.color(COLOURS.dial).quad('trim', [-0.05, 0.002, 0.0125], [0.05, 0.002, 0.0125], [0.05, 0.02, 0.0125], [-0.05, 0.02, 0.0125]);
    b.color(COLOURS.black).cylinderZ('chrome', [0.07, -0.008, 0.017], 0.01, 0.005, 8);
    b.pop();
    const needleAt = m.at(-0.045, 0.011, 0.013);
    this.hinge(this.group, ORIGIN, 'radio_needle', needleAt, { channel: 'radio_tune', kind: 'pos', axis: m.u, amount: 0.09 }, undefined, (n) => {
      n.push(m.matrix).color(COLOURS.dialNeedle);
      n.quad('trim', [-0.0458, 0.003, 0.0132], [-0.0442, 0.003, 0.0132], [-0.0442, 0.019, 0.0132], [-0.0458, 0.019, 0.0132]);
      n.pop();
    });
    const knobAt = m.at(-0.07, -0.008, 0.012);
    this.hinge(this.group, ORIGIN, 'radio_knob', knobAt, { channel: 'radio', kind: 'rot', axis: m.n, amount: -0.6 }, { id: 'radio', label: 'Магнитола' }, (k) => {
      k.push(m.matrix).color(COLOURS.black).cylinderZ('trim', [-0.07, -0.008, 0.017], 0.011, 0.005, 8);
      k.color(COLOURS.white).quad('trim', [-0.071, -0.006, 0.0225], [-0.069, -0.006, 0.0225], [-0.069, 0.001, 0.0225], [-0.071, 0.001, 0.0225]);
      k.pop();
    });
  }

  /** Ashtray drawer sliding out of the fascia. */
  private ashtray(): void {
    const [x, dy] = this.lay.ashtray;
    const m = this.fascia(x, this.belt + dy);
    this.hinge(this.group, ORIGIN, 'ashtray', m.at(0, 0, 0), { channel: 'ashtray', kind: 'pos', axis: m.n, amount: 0.08 }, { id: 'ashtray', label: 'Пепельница' }, (b) => {
      b.push(m.matrix).color(shade(this.spec.look.dash, 1.2));
      pad(b, 'trim', [0, 0, 0.005], [0.065, 0.02, 0.005], 0.003);
      b.color(COLOURS.black).box('chrome', [0, 0.012, 0.0105], [0.03, 0.003, 0.0008]);
      b.color(COLOURS.metal).box('trim', [0, -0.002, -0.04], [0.058, 0.016, 0.04]);
      b.pop();
    });
  }

  /** Light switch (knob or rocker) and the hazard button. */
  private switches(): void {
    const L = this.lay;
    const lightCtl: KitControl = { id: 'lights', label: 'Фары', action: { type: 'cycle', channel: 'lights', values: [0, 1, 2] } };
    const { right, dy, on } = L.lights;
    const lm = on === 'cluster' ? this.clusterAt(right, dy) : this.fascia(this.x0 - right, this.belt + dy);
    if (L.lights.kind === 'knob') {
      this.hinge(this.group, ORIGIN, 'light_switch', lm.at(0, 0, 0), { channel: 'lights', kind: 'rot', axis: lm.n, amount: -0.55 }, lightCtl, (b) => {
        b.push(lm.matrix).color(COLOURS.black).cylinderZ('trim', [0, 0, 0.01], 0.017, 0.01, 8);
        b.color(COLOURS.white).quad('trim', [-0.002, 0.002, 0.0205], [0.002, 0.002, 0.0205], [0.002, 0.014, 0.0205], [-0.002, 0.014, 0.0205]);
        b.pop();
      });
    } else {
      this.fixed.push(lm.matrix).color(COLOURS.black);
      pad(this.fixed, 'trim', [0, 0, 0.003], [0.017, 0.027, 0.003], 0.002);
      this.fixed.pop();
      this.hinge(this.group, ORIGIN, 'light_switch', lm.at(0, 0, 0.006), { channel: 'lights', kind: 'rot', axis: lm.u, amount: 0.16 }, lightCtl, (b) => {
        b.push(lm.matrix).color(shade(this.spec.look.dash, 1.4));
        pad(b, 'trim', [0, 0, 0.011], [0.012, 0.022, 0.005], 0.003);
        b.color(COLOURS.green).quad('trim', [-0.005, 0.006, 0.0162], [0.005, 0.006, 0.0162], [0.005, 0.014, 0.0162], [-0.005, 0.014, 0.0162]);
        b.pop();
      });
    }
    const [hx, hdy] = L.hazard;
    const hm = this.fascia(hx, this.belt + hdy);
    this.hinge(this.group, ORIGIN, 'hazard_button', hm.at(0, 0, 0), { channel: 'hazard', kind: 'pos', axis: scale(hm.n, -1), amount: 0.005 }, { id: 'hazard', label: 'Аварийка' }, (b) => {
      b.push(hm.matrix).color(COLOURS.hazard);
      pad(b, 'trim', [0, 0, 0.007], [0.015, 0.013, 0.007], 0.003);
      b.color(COLOURS.white).tri('trim', [-0.007, -0.005, 0.0145], [0.007, -0.005, 0.0145], [0, 0.007, 0.0145]);
      b.pop();
    });
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
      this.hinge(this.group, ORIGIN, name, at, { channel, kind: 'rot', axis: toDriver, amount }, { id: channel, label, action }, (s) => {
        s.pushAt(centre, [tilt, 0, 0]).color(COLOURS.black);
        beam(s, 'trim', [side * 0.04, -0.11, 0.005], [side * 0.16, -0.122, -0.015], 0.0055, 0.0055);
        pad(s, 'trim', [side * 0.172, -0.124, -0.017], [0.016, 0.009, 0.009], 0.004);
        s.pop();
      });
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
    this.hinge(wheel, ORIGIN, 'horn', ORIGIN, { channel: 'horn', kind: 'pos', axis: [0, -1, 0], amount: 0.006 }, { id: 'horn', label: 'Гудок', action: { type: 'press', channel: 'horn' } }, (h) => {
      h.color(shade(COLOURS.black, 1.3));
      if (w.hub === 'round') {
        h.cylinderY('trim', [0, -0.02, 0], 0.055, 0.012, 10);
        h.color(COLOURS.black).cylinderY('chrome', [0, -0.006, 0], 0.016, 0.003, 6);
      } else {
        pad(h, 'trim', [0, -0.02, -0.005], [0.075, 0.014, 0.05], 0.012);
      }
    });
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
      this.hinge(this.group, ORIGIN, `pedal_${name}`, pivot, { channel: name, kind: 'rot', axis: [1, 0, 0], amount }, undefined, (b) => {
        b.color(COLOURS.metal);
        beam(b, 'trim', pivot, add(padAt, [0, 0, -0.01]), 0.008, 0.005, [0, 0, 1]);
        b.color(COLOURS.rubber).pushAt(padAt, [toe, 0, 0]);
        pad(b, 'trim', ORIGIN, [hw, hh, 0.009], 0.004);
        b.pop();
      });
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
    const fb = this.hinge(this.group, ORIGIN, 'gear_fb', pivot, { channel: 'gear_fb', kind: 'rot', axis: [1, 0, 0], amount: 0.2 }, undefined, () => {});
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
    this.hinge(this.group, ORIGIN, 'handbrake', hp, { channel: 'handbrake', kind: 'rot', axis: [1, 0, 0], amount: -0.4 }, { id: 'handbrake', label: 'Ручник' }, (h) => {
      h.color(COLOURS.metal);
      beam(h, 'trim', hp, tip, 0.011, 0.014);
      h.color(COLOURS.black);
      beam(h, 'trim', add(hp, scale(sub(tip, hp), 0.5)), tip, 0.016, 0.02);
      h.cylinderZ('chrome', add(tip, [0, 0, 0.006]), 0.007, 0.007, 6);
    });
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
      b.color(insert).quad('trim', [-0.11, 0.067, -0.19], [0.11, 0.067, -0.19], [0.11, 0.067, 0.19], [-0.11, 0.067, 0.19]);
      b.pop();
    });

    const t = L.recline;
    const backAt = this.P(x, top - 0.035, hip + 0.07);
    const back = this.hinge(seat, baseAt, `seatback_${pos}`, backAt, { channel: `seatback_${pos}`, kind: 'rot', axis: [1, 0, 0], amount: -0.6 }, { id: `seatback_${pos}`, label: `Спинка сиденья ${WHERE[pos]}` }, (b) => {
      b.pushAt(backAt, [-t, 0, 0]).color(uph);
      pad(b, 'trim', [0, 0.27, -0.05], [0.245, 0.27, 0.065], 0.04, 0.88);
      if (L.bolsters) for (const sx of [-1, 1]) pad(b, 'trim', [sx * 0.2, 0.24, -0.005], [0.045, 0.22, 0.05], 0.03);
      b.color(insert).quad('trim', [-0.1, 0.07, 0.017], [0.1, 0.07, 0.017], [0.1, 0.48, 0.017], [-0.1, 0.48, 0.017]);
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
    const b = this.fixed;
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
    for (const sx of [-0.25, 0.25]) b.quad('trim', [sx - 0.12, 0.072, -0.18], [sx + 0.12, 0.072, -0.18], [sx + 0.12, 0.072, 0.18], [sx - 0.12, 0.072, 0.18]);
    b.pop();
    b.pushAt(this.P(0, top - 0.035, H), [-L.benchRecline, 0, 0]).color(uph);
    pad(b, 'trim', [0, 0.25, -0.05], [half, 0.25, 0.065], 0.04, 0.97);
    b.color(insert);
    for (const sx of [-0.25, 0.25]) b.quad('trim', [sx - 0.11, 0.06, 0.017], [sx + 0.11, 0.06, 0.017], [sx + 0.11, 0.42, 0.017], [sx - 0.11, 0.42, 0.017]);
    b.pop();
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
      const cup = (s: number, k: number): Vec3 => card(s, ay + 0.0255, 0.03 + k * 0.016);
      b.quad('trim', cup(as - 0.06, -1), cup(as + 0.04, -1), cup(as + 0.04, 1), cup(as - 0.06, 1));

      // Inner handle: a chrome lever in a dark recess at the card's front top.
      const hs = s0 + (front ? 0.13 : 0.1);
      const hy = belt - 0.085;
      b.quad('trim', card(hs - 0.05, hy - 0.022, 0.002), card(hs + 0.05, hy - 0.022, 0.002), card(hs + 0.05, hy + 0.022, 0.002), card(hs - 0.05, hy + 0.022, 0.002));
      beam(b, 'chrome', card(hs + 0.035, hy, 0.008), card(hs - 0.03, hy, 0.012), 0.006, 0.007);

      // Capping over the door's top between the card and the glass, and the lock knob through it.
      const [u0, u1] = upper;
      const ky = (s: number): number => f.section(s).r4[1] + cab.glassBottom - 0.004;
      const cap = (s: number, d: number): Vec3 => this.P(side * (this.glassX(s, ky(s)) - d), ky(s), s);
      b.color(this.spec.look.dash).quad('trim', cap(u0 + 0.01, 0.02), cap(u1 - 0.01, 0.02), cap(u1 - 0.01, DOOR_CARD + 0.002), cap(u0 + 0.01, DOOR_CARD + 0.002));
      const knob = cap(u1 - 0.07, 0.05);
      b.color(COLOURS.black).cylinderY('chrome', add(knob, [0, 0.014, 0]), 0.0065, 0.016, 6);

      addBuilt(group, b, door.pivot, `trim_${pos}`, true);

      // Window crank: four turns over the window's travel.
      const window = `window_${pos}`;
      if (!this.ctx.nodes.has(window)) continue;
      const cs = s0 + (front ? 0.35 : 0.28);
      const cy = belt - 0.35;
      const at = card(cs, cy, 0.006);
      const control: KitControl = { id: `crank_${pos}`, label: `Стеклоподъёмник, ${pos.startsWith('f') ? 'передняя' : 'задняя'} ${pos.endsWith('l') ? 'левая' : 'правая'} дверь`, action: { type: 'toggle', channel: window } };
      this.hinge(group, door.pivot, `crank_${pos}`, at, { channel: window, kind: 'rot', axis: [1, 0, 0], amount: side * 8 * Math.PI }, control, (c) => {
        const inward = (d: number): Vec3 => [-side * d, 0, 0];
        const end = add(at, [0, 0.06, -0.045]);
        c.color(COLOURS.metal).cylinderX('chrome', add(at, inward(0.006)), 0.02, 0.006, 8);
        beam(c, 'chrome', add(at, inward(0.014)), add(end, inward(0.014)), 0.008, 0.004, [1, 0, 0]);
        c.color(COLOURS.black).cylinderX('trim', add(end, inward(0.032)), 0.011, 0.016, 6);
      });
    }
  }
}
