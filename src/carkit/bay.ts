/**
 * Under the lids and under the car: the engine bay, the boot and the underbody.
 *
 * All three are seen only with a lid open or the car on its side, so they are built to
 * read, not to engineer: panels that close each space so no void or road shows through,
 * and the big recognisable parts in their true places — the battery and reservoirs on
 * the inner wings, the brake booster on the firewall; the spare and the fuel tank on the
 * saloon boot's right side; the exhaust, the driveline and the suspension underneath.
 *
 * The engine, its turbine, the radiator and the air filter are the bonnet's service
 * cells (vehicle/bonnet.ts), drawn by the grid from what the car carries.  On a
 * forward-control van those same cells sit under the cabin engine cover; every kit
 * still exposes the same four `KIT_BONNET_CELL_NODE` anchors to the renderer.
 * The Niva is the classic underneath with its four-wheel drive added: a transfer box
 * behind the gearbox, a front propshaft to a front differential and driveshafts.
 * Everything is placed off the frame (axles, cowl, deck, sills), so another body on the
 * same platform gets the same layout fitted to its own shell. The shell sets the limits:
 *
 *  - a closed bonnet's or boot lid's inner skin (LID_ROOM under the deck) caps
 *    everything below it;
 *  - inner panels stand WELL_GAP inside the wheel wells' walls, which keeps them clear
 *    of the tyres;
 *  - the shell's dark floor at sill height closes every space from below, so what is
 *    meant to be seen from under the car hangs below it, and the lowest of it (the
 *    classic's and the Niva's differentials, the Samara's fuel tank) stands at exactly
 *    the factory clearance (`clearance`); the silencers are tucked up SILENCER_TUCK above it,
 *    or on a high body (`exhaustTuck`, the UAZs) hang just under the floor.
 */

import * as THREE from 'three';
import { LINING_DEPTH, type BodyFrame } from './body';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { addBuilt, type KitContext } from './context';
import { engineCoverEnd, loadSpaceStart } from './interior';

/** Ground clearance of the lowest part under the car: the factory figure the body was fitted to. */
const CLEARANCE = 0.17;
/** The Niva's and the UAZ-2206's: 220 mm (`FACTORY_GEOMETRY.sv_niva`, `kit_uaz2206`, vehicle/carmodels.ts). */
const NIVA_CLEARANCE = 0.22;

function clearance(frame: BodyFrame): number {
  return frame.spec.platform === 'niva' || frame.spec.platform === 'van' ? NIVA_CLEARANCE : CLEARANCE;
}
/** The silencer hangs this far above the lowest point, tucked up under the floor. */
const SILENCER_TUCK = 0.025;
/** Room under a lid's deck line: its 0.035 inner skin plus a hair, so nothing shows through. */
const LID_ROOM = 0.045;
/** Inner panels stand this far inside the wheel wells' walls. */
const WELL_GAP = 0.02;
/** Inner wings stand this far outboard of the lid's edge, under the body's jamb flange. */
const JAMB_STEP = 0.006;
/** Chassis rail along the foot of each inner wing: width and height. */
const RAIL_W = 0.07;
const RAIL_H = 0.09;
/** Radiator support: how far behind the bonnet's front edge it stands (the lamps fill the gap). */
const SUPPORT_BACK = 0.1;
/** The engine-bay tower over each front axle: radius and how far inside the inner wing. */
const TOWER_R = 0.075;
const TOWER_IN = 0.07;
/** Box faces without the bottom one, for parts standing on something. */
const UPPER_FACES = 0b110111;
/**
 * Two walls that would meet face to face stand this far apart instead: in one plane they
 * z-fight at any distance (tools/kit-zfight.ts), 2 mm apart only far beyond 25 m, where
 * the bay is no longer drawn.
 */
const PLANE_GAP = 0.002;
/** The classic's front beam stands this far ahead of the axle. */
const CROSSMEMBER_AHEAD = 0.08;

const COLOURS = {
  alloy: 0x8d9093,
  black: 0x19191a,
  exhaust: 0x4b4541,
  battery: 0x2b2d30,
  terminal: 0x9a2a20,
  plastic: 0xd5d1c2,
  capBlue: 0x2b4f8a,
  underseal: 0x212222,
  driveline: 0x2c2d2e,
  spring: 0x3b3e41,
  fuelTank: 0x2e302f,
  bootTrim: 0x2c2e31,
  spareRim: 0x8f9396,
} as const;

type Pt = [number, number];

export function buildBay(ctx: KitContext): void {
  const bay = detailGroup(ctx, 'kit_bay');
  const boot = detailGroup(ctx, 'kit_boot');
  const under = detailGroup(ctx, 'kit_under');
  const { frame } = ctx;
  // The Niva's and the van's engine and cabin floor are the classic's.
  const classic = frame.spec.platform !== 'samara';
  // A forward-control van has no exterior bonnet: its service bay is the large cabin
  // opening under `engine_cover`.  Keep the same four typed cells so the state and
  // renderer do not need a second storage layout.
  const van = frame.spec.platform === 'van';

  const b = new PartBuilder();
  let route: BayRoute;
  if (van) {
    route = vanRoute(frame);
    const cells = buildVanServiceCells(frame);
    for (const kind of CELL_KINDS) ctx.root.add(cellMarker(frame, kind, cells[kind]));
  } else {
    const bayLayout = buildEngineBay(frame, b, classic);
    route = bayLayout.route;
    for (const kind of CELL_KINDS) ctx.root.add(cellMarker(frame, kind, bayLayout.cells[kind]));
  }
  addBuilt(bay, b, [0, 0, 0], 'bay', true);

  const lb = new PartBuilder();
  if (frame.spec.bootEnd !== undefined) buildSaloonBoot(frame, lb, classic);
  else if (!van) buildHatchBoot(frame, lb);
  addBuilt(boot, lb, [0, 0, 0], 'boot', true);

  const ub = new PartBuilder();
  const eb = new PartBuilder();
  buildUnderbody(frame, ub, eb, classic, route);
  addBuilt(under, ub, [0, 0, 0], 'under', true);
  // The exhaust is outside the detail groups: its silencer and tail pipe hang under the
  // tail of every car met from behind, and drawn only within `KIT_DETAIL_M` they came in
  // at 50 m on a car caught up with slowly. So it draws at every distance and the mid and
  // far meshes bake it. It keeps the underbody's shadows (`kitShadowed`: receives the
  // shell's, casts none), a program every kit car already has.
  addBuilt(ctx.root, eb, [0, 0, 0], 'exhaust', true);
}

function detailGroup(ctx: KitContext, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  ctx.root.add(g);
  return g;
}

// ---------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------

/** Car-frame point from a position along the car. */
function at(frame: BodyFrame, x: number, y: number, s: number): Vec3 {
  return [x, y, frame.z(s)];
}

/** `s0`, `s1` and every tub station between: the deck and the sill are straight between them. */
function stationsBetween(frame: BodyFrame, s0: number, s1: number): number[] {
  const out = [s0];
  for (const st of frame.spec.stations) if (st.s > s0 + 0.01 && st.s < s1 - 0.01) out.push(st.s);
  out.push(s1);
  return out;
}

/** The shell's dark underbody runs along the sill: everything's floor. */
function floorY(frame: BodyFrame, s: number): number {
  return frame.station(s).sill;
}

/** Highest a part may reach under a closed lid over s0..s1 out to half width `x`. */
function ceiling(frame: BodyFrame, s0: number, s1: number, x: number): number {
  let y = Infinity;
  for (const s of stationsBetween(frame, s0, s1)) y = Math.min(y, frame.deckY(s, x));
  return y - LID_ROOM;
}

/** Half-section rings sampled along s, mirrored to `side`, joined by quads. */
function loft(b: PartBuilder, slot: KitSlot, frame: BodyFrame, ss: readonly number[], side: number, ring: (s: number) => Pt[]): void {
  let prev: Vec3[] | undefined;
  for (const s of ss) {
    const next = ring(s).map(([x, y]): Vec3 => [side * x, y, frame.z(s)]);
    if (prev) b.bridge(slot, prev, next);
    prev = next;
  }
}

/**
 * Prism across the car: a section in (s, y) extruded along x from x0 to x1. `closed =
 * false` leaves out the face along the section's closing edge (one lying on the floor).
 */
function across(b: PartBuilder, frame: BodyFrame, slot: KitSlot, section: readonly Pt[], x0: number, x1: number, closed = true): void {
  b.push(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, frame.zNose, 0, 0, 0, 1));
  b.extrude(slot, section, x0, x1, 0, 0, true, closed);
  b.pop();
}

/** Box from corner to corner given as (x, y, s). */
function boxS(b: PartBuilder, frame: BodyFrame, slot: KitSlot, min: Vec3, max: Vec3, faces?: number): void {
  b.boxFrom(slot, [min[0], min[1], frame.z(min[2])], [max[0], max[1], frame.z(max[2])], faces);
}

/** Chamfered box from corner to corner given as (x, y, s), its section across the car. */
function bevelS(b: PartBuilder, frame: BodyFrame, slot: KitSlot, min: Vec3, max: Vec3, bevel: number): void {
  b.bevelBox(
    slot,
    [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, frame.z((min[2] + max[2]) / 2)],
    [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
    bevel,
  );
}

const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** A round bar from a to c in the builder's current frame. */
function rod(b: PartBuilder, slot: KitSlot, a: Vec3, c: Vec3, radius: number, sides = 6, caps = false): void {
  _dir.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const length = _dir.length();
  _q.setFromUnitVectors(Z_AXIS, _dir.normalize());
  _from.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  b.push(new THREE.Matrix4().compose(_from, _q, _one));
  b.cylinderZ(slot, [0, 0, 0], radius, length / 2, sides, caps);
  b.pop();
}

/** A bent pipe through `path`; its rings are carried along without twisting. */
function tube(b: PartBuilder, slot: KitSlot, path: readonly Vec3[], radius: number, sides: number): void {
  const pts = path.map((p) => new THREE.Vector3(...p));
  const n = pts.length;
  const tangents = pts.map((_, i) => pts[Math.min(n - 1, i + 1)]!.clone().sub(pts[Math.max(0, i - 1)]!).normalize());
  const first = tangents[0]!;
  const normal = new THREE.Vector3().crossVectors(first, Math.abs(first.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const turn = new THREE.Quaternion();
  const binormal = new THREE.Vector3();
  let prev: Vec3[] | undefined;
  for (let i = 0; i < n; i++) {
    if (i > 0) normal.applyQuaternion(turn.setFromUnitVectors(tangents[i - 1]!, tangents[i]!));
    binormal.crossVectors(tangents[i]!, normal);
    const ring: Vec3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const c = Math.cos(a) * radius;
      const s = Math.sin(a) * radius;
      const p = pts[i]!;
      ring.push([p.x + normal.x * c + binormal.x * s, p.y + normal.y * c + binormal.y * s, p.z + normal.z * c + binormal.z * s]);
    }
    if (prev) b.bridge(slot, prev, ring, true);
    prev = ring;
  }
}

/** A coil spring standing on `base` (car frame), a three-sided wire round a helix. */
function coil(b: PartBuilder, base: Vec3, height: number, radius: number, turns: number): void {
  const perTurn = 5;
  const n = Math.round(turns * perTurn);
  const path: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / perTurn) * Math.PI * 2;
    path.push([base[0] + Math.cos(a) * radius, base[1] + (height * i) / n, base[2] + Math.sin(a) * radius]);
  }
  b.color(COLOURS.spring);
  tube(b, 'trim', path, 0.009, 3);
}

/**
 * Inner wing (or boot side) half-section at s: from under the lid's edge (or a
 * `KitCarSpec.bonnet`'s cut) down to a shelf over the wheel arch, in to `inner` and down
 * to the floor, with a chassis rail along its foot when `rail`.
 */
function wingWall(frame: BodyFrame, s: number, inner: number, shelf: number, floor: number, rail: boolean): Pt[] {
  const x = (frame.bonnetX(s) ?? frame.lidX(s)) + JAMB_STEP;
  const top = Math.max(frame.deckY(s, x) - LID_ROOM, shelf + 0.02);
  const pts: Pt[] = [[x, top], [x, shelf], [inner, shelf]];
  if (rail) pts.push([inner, floor + RAIL_H], [inner - RAIL_W, floor + RAIL_H], [inner - RAIL_W, floor]);
  else pts.push([inner, floor]);
  return pts;
}

/** A painted wall across the car at s, filling the wing walls' section up to the lid. */
function bulkhead(b: PartBuilder, frame: BodyFrame, s: number, inner: number, shelf: number, floor: number): void {
  const z = frame.z(s);
  const edge = frame.lidX(s) + JAMB_STEP;
  const top = (x: number): number => Math.max(frame.deckY(s, x) - LID_ROOM, shelf + 0.02);
  const xs = [inner, inner / 2, 0, -inner / 2, -inner];
  b.poly('paint', [[-inner, floor, z], [inner, floor, z], ...xs.map((x): Vec3 => [x, top(x), z])]);
  for (const side of [1, -1]) {
    b.poly('paint', [[side * inner, shelf, z], [side * edge, shelf, z], [side * edge, top(edge), z], [side * inner, top(inner), z]]);
  }
}

/** A plastic reservoir with its cap, standing on y0 (car frame, s along the car). */
function reservoir(b: PartBuilder, frame: BodyFrame, x0: number, x1: number, s0: number, s1: number, y0: number, y1: number, cap: number): void {
  b.color(COLOURS.plastic);
  bevelS(b, frame, 'trim', [x0, y0, s0], [x1, y1, s1], 0.02);
  const x = (x0 + x1) / 2;
  const s = (s0 + s1) / 2;
  b.color(cap);
  boxS(b, frame, 'trim', [x - 0.022, y1, s - 0.022], [x + 0.022, y1 + 0.022, s + 0.022], UPPER_FACES);
}

/** A battery on a bracket from the inner wing at x0..x1 (x0 nearer the wing). */
function battery(b: PartBuilder, frame: BodyFrame, side: number, inner: number, s0: number, s1: number, top: number): void {
  const h = 0.19;
  const x0 = side * (inner - 0.01);
  const x1 = side * (inner - 0.19);
  const [lo, hi] = x0 < x1 ? [x0, x1] : [x1, x0];
  b.color(COLOURS.battery);
  bevelS(b, frame, 'trim', [lo, top - h, s0], [hi, top - 0.012, s1], 0.012);
  b.color(COLOURS.black);
  boxS(b, frame, 'trim', [lo + 0.008, top - 0.014, s0 + 0.008], [hi - 0.008, top, s1 - 0.008], UPPER_FACES);
  // Tray bracket into the wing.
  boxS(b, frame, 'trim', [lo, top - h - 0.025, s0 + 0.02], [hi, top - h, s1 - 0.02]);
  for (const [dx, colour] of [[-0.05, COLOURS.terminal], [0.05, COLOURS.black]] as const) {
    const x = (lo + hi) / 2 + dx * side;
    b.color(colour);
    boxS(b, frame, 'trim', [x - 0.012, top, s0 + 0.028], [x + 0.012, top + 0.022, s0 + 0.052], UPPER_FACES);
  }
}

// ---------------------------------------------------------------------------------
// Engine bay
// ---------------------------------------------------------------------------------

/**
 * Name prefix of the empty nodes marking the bonnet's service cells, one per part kind
 * (`${KIT_BONNET_CELL_NODE}:${kind}`): position the centre of the cell's floor, scale
 * its width across the car, its height and its depth along the car. The grid draws each
 * cell there (render/carmodel.ts measures them and drops the nodes).
 */
export const KIT_BONNET_CELL_NODE = 'kit_bonnet_cell';

/** The bonnet's part kinds, as vehicle/bonnet.ts names its cells. */
const CELL_KINDS = ['engine', 'turbine', 'radiator', 'air_filter'] as const;
type CellKind = (typeof CELL_KINDS)[number];

/** A cell: its floor rectangle (x across, s along the car), the floor's height and the clear room's top. */
interface Cell {
  readonly x0: number;
  readonly x1: number;
  readonly s0: number;
  readonly s1: number;
  readonly floor: number;
  readonly top: number;
}

/** Cells keep this far clear of each other and of the bay's fixed parts. */
const CELL_GAP = 0.01;
/** The radiator's cell along the car: a core with its tanks, its fan mount and its pipes' necks (render/partmesh.ts). */
const RADIATOR_CELL_DEPTH = 0.14;
/** The classic's air filter cell along the car, about where its carburettor stood. */
const AIR_FILTER_CELL_LENGTH = 0.3;
/**
 * With no engine in the bay the exhaust's down-pipe starts this far under the shell's
 * floor (its centre, the pipe's radius plus a hair), so nothing of it shows in the bay.
 */
const DOWNPIPE_DROP = 0.03;

/** What the bay hands the underbody: where the exhaust starts, and the crank. */
interface BayRoute {
  /** The exhaust down-pipe's start under the floor, car frame. */
  readonly outlet: Vec3;
  /** Crank axis height and the engine's offset across the car: where the driveline leaves it. */
  readonly crankY: number;
  readonly engineX: number;
  /** Where the gearbox starts along the car (the engine's back); absent, the cowl's firewall. */
  readonly gearFrom?: number;
}

/**
 * The van's route: its engine under the cover between the front seats, over the front
 * axle, the gearbox from its back (the cover's rear end) hanging under the floor with the
 * transfer box behind it, the down-pipe from under the engine's rear end, right of centre.
 */
function vanRoute(frame: BodyFrame): BayRoute {
  const gearFrom = engineCoverEnd(frame);
  const sOut = gearFrom - 0.1;
  return { outlet: at(frame, -0.12, floorY(frame, sOut) - DOWNPIPE_DROP, sOut), crankY: floorY(frame, gearFrom) + 0.025, engineX: 0, gearFrom };
}

interface BayLayout {
  readonly route: BayRoute;
  readonly cells: Readonly<Record<CellKind, Cell>>;
}

/** The fixed parts of the bay that the engines' cells keep clear of. */
interface BayFixtures {
  readonly inner: number;
  readonly support: number;
  readonly radiator: Cell;
  /** The master cylinder's front end and the booster's inboard edge, left of the firewall. */
  readonly boosterS: number;
  readonly boosterX: number;
  /** Underside of the scuttle's plenum at the cowl. */
  readonly scuttleFloor: number;
}

/**
 * Highest point of the shell's floor over s0..s1, a hair up: a cell's floor is flat and
 * the shell's slopes, so standing on the highest point it never dips through it.
 */
function cellFloor(frame: BodyFrame, s0: number, s1: number): number {
  let y = -Infinity;
  for (const s of stationsBetween(frame, s0, s1)) y = Math.max(y, floorY(frame, s));
  return y + PLANE_GAP;
}

/** A cell over x0..x1, s0..s1 from `floor`, by default up to the closed lid. */
function cell(frame: BodyFrame, x0: number, x1: number, s0: number, s1: number, floor: number, top = ceiling(frame, s0, s1, Math.max(Math.abs(x0), Math.abs(x1)))): Cell {
  return { x0, x1, s0, s1, floor, top };
}

function cellMarker(frame: BodyFrame, kind: CellKind, c: Cell): THREE.Object3D {
  const node = new THREE.Object3D();
  node.name = `${KIT_BONNET_CELL_NODE}:${kind}`;
  node.position.set((c.x0 + c.x1) / 2, c.floor, frame.z((c.s0 + c.s1) / 2));
  node.scale.set(c.x1 - c.x0, c.top - c.floor, c.s1 - c.s0);
  return node;
}
/** Service cells under the UAZ-2206's large cabin engine cover. */
function buildVanServiceCells(frame: BodyFrame): Readonly<Record<CellKind, Cell>> {
  const floor = cellFloor(frame, 1.08, 2.45);
  const top = floor + 0.4;
  return {
    engine: cell(frame, -0.4, 0.4, 1.12, 1.85, floor, top),
    turbine: cell(frame, 0.41, 0.8, 1.12, 1.62, floor, top),
    radiator: cell(frame, -0.8, -0.41, 1.12, 1.62, floor, top),
    air_filter: cell(frame, 0.41, 0.8, 1.65, 2.35, floor, top),
  };
}

function buildEngineBay(frame: BodyFrame, b: PartBuilder, classic: boolean): BayLayout {
  const spec = frame.spec;
  const w = spec.wheels;
  const inner = frame.wellX(w.front) - WELL_GAP;
  const shelf = w.radius * (1 + frame.archFactor(w.front)) + WELL_GAP;
  const support = spec.bonnetFront + SUPPORT_BACK;
  const cowl = frame.cowl;

  // ---- inner wings with the chassis rails along their feet, firewall, scuttle ----
  const ss = stationsBetween(frame, support - 0.04, cowl);
  for (const side of [1, -1]) loft(b, 'paint', frame, ss, side, (s) => wingWall(frame, s, inner, shelf, floorY(frame, s), true));
  bulkhead(b, frame, cowl, inner, shelf, floorY(frame, cowl));
  // Scuttle: the plenum under the screen's foot, a black grille on top. It stands against
  // the bulkhead at the cowl with no back face of its own, so the two share no plane.
  const scuttleTop = ceiling(frame, cowl - 0.1, cowl, frame.lidX(cowl));
  const scuttle: Pt[] = [[cowl, scuttleTop], [cowl - 0.1, scuttleTop - 0.005], [cowl - 0.1, scuttleTop - 0.05], [cowl, scuttleTop - 0.09]];
  b.color(COLOURS.black);
  across(b, frame, 'trim', scuttle, -frame.lidX(cowl), frame.lidX(cowl), false);

  // ---- radiator support: slam panel, posts and lower member framing the radiator ----
  const radHalf = 0.29;
  const fl = floorY(frame, support);
  const slamTop = ceiling(frame, support - 0.06, support + 0.02, inner);
  across(b, frame, 'paint', [[support - 0.06, slamTop - 0.012], [support - 0.06, slamTop], [support + 0.02, slamTop], [support + 0.02, slamTop - 0.05], [support - 0.03, slamTop - 0.05]], -inner, inner);
  // Posts and lower member stand on the shell's underbody: no bottom faces in its plane.
  for (const side of [1, -1]) {
    const [x0, x1] = side > 0 ? [radHalf + 0.01, inner] : [-inner, -radHalf - 0.01];
    boxS(b, frame, 'paint', [x0, fl, support - 0.03], [x1, slamTop - 0.05, support], UPPER_FACES);
  }
  const memberTop = fl + 0.07;
  boxS(b, frame, 'paint', [-inner, fl, support - 0.03], [inner, memberTop, support], UPPER_FACES);
  // The radiator's cell: between the posts, on the lower member's height and up under
  // the slam panel's lip, as the core stood.
  const rs0 = support + 0.005;
  const rs1 = rs0 + RADIATOR_CELL_DEPTH;
  const radiator = cell(frame, -radHalf, radHalf, rs0, rs1, Math.max(memberTop, cellFloor(frame, rs0, rs1)), Math.min(slamTop - 0.05 - CELL_GAP, ceiling(frame, rs0, rs1, radHalf)));

  // ---- towers over the front axle ----
  const towerX = inner - TOWER_IN;
  const towerTop = classic ? shelf + 0.05 : ceiling(frame, w.front - TOWER_R, w.front + TOWER_R, towerX + TOWER_R) - 0.06;
  for (const side of [1, -1]) {
    const fl0 = floorY(frame, w.front);
    const x = side * towerX;
    b.cylinderY('paint', [x, (fl0 + towerTop) / 2, frame.z(w.front)], TOWER_R, (towerTop - fl0) / 2, 8, false);
    const ring = (r: number, y: number, n: number): Vec3[] =>
      Array.from({ length: n }, (_, i): Vec3 => at(frame, x + Math.cos((i / n) * Math.PI * 2) * r, y, w.front + Math.sin((i / n) * Math.PI * 2) * r));
    b.poly('paint', ring(TOWER_R, towerTop, 8));
    b.color(COLOURS.black).poly('trim', ring(0.045, towerTop + 0.004, 6));
  }

  // ---- brake booster and master cylinder on the driver's (left) side of the firewall ----
  // Under the brake pedal (interior.ts: column x 0.36-0.37, brake 0.01 inboard of it).
  const boosterX = 0.36;
  const boosterR = 0.1;
  const boosterY = Math.min(scuttleTop - 0.22, floorY(frame, cowl) + 0.36);
  const masterS = cowl - 0.16;
  const masterHalf = 0.075;
  b.color(COLOURS.black).cylinderZ('trim', [boosterX, boosterY, frame.z(cowl - 0.045)], boosterR, 0.04, 10);
  b.color(COLOURS.alloy).cylinderZ('trim', [boosterX, boosterY, frame.z(masterS)], 0.03, masterHalf, 6);
  reservoir(b, frame, boosterX - 0.04, boosterX + 0.04, cowl - 0.22, cowl - 0.12, boosterY + 0.03, boosterY + 0.1, COLOURS.black);

  const bay: BayFixtures = { inner, support, radiator, boosterS: masterS - masterHalf, boosterX: boosterX - boosterR, scuttleFloor: scuttleTop - 0.09 };
  const { route, cells } = classic ? classicEngine(frame, b, bay) : samaraEngine(frame, b, bay);
  return { route, cells: { ...cells, radiator } };
}

/** What a platform's engine side adds: the route and every cell but the radiator's. */
interface EngineSide {
  readonly route: BayRoute;
  readonly cells: Readonly<Record<Exclude<CellKind, 'radiator'>, Cell>>;
}

/**
 * The classic: a longitudinal four a touch left of centre with its gearbox running on
 * under the tunnel; the battery on the right in front of the tower, the expansion tank
 * on the right behind it, the washer bottle on the left. The turbine's cell is in the
 * right rear corner by the exhaust manifold's outlet, the air filter's on the left
 * beside where the carburettor stood.
 */
function classicEngine(frame: BodyFrame, b: PartBuilder, bay: BayFixtures): EngineSide {
  const w = frame.spec.wheels;
  const cowl = frame.cowl;
  const { inner, support } = bay;
  // The block's length and half width; its fan and pulleys stood between its timing
  // end and the radiator.
  const L = 0.54;
  const half = 0.16;
  const engineX = 0.02;
  const sFront = support + 0.215;
  const sBack = sFront + L;
  const sMid = sFront + L / 2;
  // The crank sits just above the floor at the firewall, so the gearbox and the
  // propshaft behind it hang half below the floor, as they do in the tunnel.
  const crankY = floorY(frame, cowl) + 0.025;

  // Battery in front of the right tower, expansion tank behind it, washer bottle left.
  const batteryEnd = w.front - TOWER_R - 0.03;
  const batteryStart = Math.max(support + 0.08, batteryEnd - 0.25);
  battery(b, frame, -1, inner, batteryStart, batteryEnd, ceiling(frame, batteryStart, batteryEnd, inner) - 0.02);
  const tankStart = cowl - 0.38;
  const tankEnd = cowl - 0.2;
  const tankTop = ceiling(frame, tankStart, tankEnd, inner) - 0.03;
  reservoir(b, frame, -inner + 0.01, -inner + 0.13, tankStart, tankEnd, tankTop - 0.15, tankTop, COLOURS.black);
  const washerTop = ceiling(frame, support + 0.08, support + 0.24, inner) - 0.03;
  reservoir(b, frame, inner - 0.14, inner - 0.01, support + 0.08, support + 0.24, washerTop - 0.17, washerTop, COLOURS.capBlue);

  // The engine's cell: the block with the alternator and the exhaust and intake
  // manifolds on its right, the distributor on its left.
  const engine = cell(frame, engineX - 1.8 * half, engineX + 1.2 * half, sFront, sBack, cellFloor(frame, sFront, sBack));
  // The turbine's: behind the expansion tank, by where the manifold's outlet was, inboard
  // of the rail and under the scuttle's plenum, which reaches over it at the firewall.
  const ts0 = tankEnd + CELL_GAP;
  const ts1 = cowl - CELL_GAP;
  const tx0 = -(inner - RAIL_W - CELL_GAP);
  const turbine = cell(frame, tx0, engine.x0 - CELL_GAP, ts0, ts1, cellFloor(frame, ts0, ts1), Math.min(bay.scuttleFloor - CELL_GAP, ceiling(frame, ts0, ts1, -tx0)));
  // The air filter's: beside the carburettor's place, inboard of the tower and the washer
  // bottle, between the radiator's cell and the master cylinder.
  const as0Min = bay.radiator.s1 + CELL_GAP;
  const as1Max = bay.boosterS - CELL_GAP;
  const as0 = Math.max(as0Min, Math.min(sMid - AIR_FILTER_CELL_LENGTH / 2, as1Max - AIR_FILTER_CELL_LENGTH));
  const as1 = Math.min(as1Max, as0 + AIR_FILTER_CELL_LENGTH);
  const airFilter = cell(frame, engine.x1 + CELL_GAP, inner - TOWER_IN - TOWER_R - CELL_GAP, as0, as1, cellFloor(frame, as0, as1));

  // The exhaust starts under the floor below where the manifold's outlet was, at the
  // engine's rear on its right.
  const sOut = sBack - 0.1;
  const outlet = at(frame, engineX - 1.46 * half, floorY(frame, sOut) - DOWNPIPE_DROP, sOut);
  return { route: { outlet, crankY, engineX }, cells: { engine, turbine, air_filter: airFilter } };
}

/**
 * The Samara: a transverse four on the right, leaning back, with the gearbox on the
 * left and the driveshafts out to the wheels; the battery on the left in front of its
 * tower. The turbine's cell is behind the engine along its exhaust side; the air
 * filter's stands on the gearbox, where the injection cars carry the filter's housing.
 */
function samaraEngine(frame: BodyFrame, b: PartBuilder, bay: BayFixtures): EngineSide {
  const w = frame.spec.wheels;
  const cowl = frame.cowl;
  const { inner, support } = bay;
  // The block's length along the crank and half width across it, and its place.
  const L = 0.39;
  const half = 0.14;
  const engineX = -0.14;
  const sMid = w.front - 0.15;
  // The crank: over the sump's `pan` with the block leant back by `tilt` about it. The
  // gearbox bolts on at its height.
  const tilt = 0.15;
  const pan = 0.075;
  const base = floorY(frame, sMid) - 0.045;
  const crankY = base + pan * Math.cos(tilt);
  const sCrank = sMid + pan * Math.sin(tilt);

  // Gearbox on the left: bellhousing on the block's end, the case and the final drive
  // over the axle line.
  const xb = engineX + L / 2;
  b.color(COLOURS.alloy);
  b.cylinderX('trim', [xb + 0.035, crankY, frame.z(sCrank)], 0.13, 0.035, 8);
  const gearTop = crankY + 0.14;
  const gearOut = inner - 0.17;
  const gearS0 = sCrank - 0.1;
  const gearS1 = w.front + 0.07;
  bevelS(b, frame, 'trim', [xb + 0.07, floorY(frame, w.front) - 0.05, gearS0], [gearOut, gearTop, gearS1], 0.04);
  // Driveshafts from the case's faces at the hubs' height, with their joints' boots.
  const y = w.radius;
  const bootR = 0.04;
  const hub = w.frontHalfTrack - 0.07;
  b.color(COLOURS.driveline);
  for (const [x0, x1] of [[gearOut, hub], [xb + 0.07, -hub]] as const) {
    rod(b, 'trim', at(frame, x0, y, w.front), at(frame, x1, y, w.front), 0.018, 6);
    const dir = Math.sign(x1 - x0);
    b.color(COLOURS.black);
    b.cylinderX('trim', at(frame, x0 + dir * 0.06, y, w.front), bootR, 0.05, 6);
    b.cylinderX('trim', at(frame, x1 - dir * 0.07, y, w.front), bootR, 0.05, 6);
    b.color(COLOURS.driveline);
  }

  // Battery on the left in front of its tower; expansion tank and washer bottle right.
  const batteryEnd = w.front - TOWER_R - 0.03;
  const batteryStart = Math.max(support + 0.08, batteryEnd - 0.26);
  battery(b, frame, 1, inner, batteryStart, batteryEnd, ceiling(frame, batteryStart, batteryEnd, inner) - 0.02);
  const tankTop = ceiling(frame, cowl - 0.32, cowl - 0.14, inner) - 0.03;
  reservoir(b, frame, -inner + 0.01, -inner + 0.15, cowl - 0.32, cowl - 0.14, tankTop - 0.14, tankTop, COLOURS.black);
  const washerTop = ceiling(frame, support + 0.08, support + 0.22, inner) - 0.03;
  reservoir(b, frame, -inner + 0.01, -inner + 0.14, support + 0.08, support + 0.22, washerTop - 0.15, washerTop, COLOURS.capBlue);

  // The engine's cell: from the timing end's pulleys on the right to the bellhousing;
  // ahead to the intake and the oil filter, back to the exhaust manifold with the head
  // leaning over it. The tower, the washer and the tank stand outboard of it. The right
  // driveshaft and its inner boot cross under it above the floor; the cell's floor clears them.
  const es0 = sMid - 1.45 * half;
  const es1 = sMid + 2 * half;
  const engineFloor = Math.max(cellFloor(frame, es0, es1), y + bootR + PLANE_GAP);
  const engine = cell(frame, Math.max(engineX - L / 2 - 0.06, -(inner - 0.15 - CELL_GAP)), xb - PLANE_GAP, es0, es1, engineFloor);
  // The turbine's: behind it along the manifold, up to the firewall under the scuttle.
  const ts0 = es1 + CELL_GAP;
  const ts1 = cowl - CELL_GAP;
  const tx0 = engineX - L / 2;
  const turbine = cell(frame, tx0, engine.x1, ts0, ts1, cellFloor(frame, ts0, ts1), Math.min(bay.scuttleFloor - CELL_GAP, ceiling(frame, ts0, ts1, -tx0)));
  // The air filter's: on the gearbox's case, inboard of the battery.
  const airFilter = cell(frame, xb + 0.07 + CELL_GAP, inner - 0.19 - CELL_GAP, gearS0, gearS1, gearTop + PLANE_GAP);

  // The exhaust starts under the floor below where the manifold's outlet was, behind
  // the engine near its gearbox end.
  const sOut = sMid + 1.46 * half;
  const outlet = at(frame, xb - 0.1, floorY(frame, sOut) - DOWNPIPE_DROP, sOut);
  return { route: { outlet, crankY, engineX }, cells: { engine, turbine, air_filter: airFilter } };
}

/**
 * A casing round an axis along the car, tapering from (rx0, ry0) at s0 to (rx1, ry1)
 * at s1, closed at s0, where nothing bolts to it any more; its bottom radius is kept
 * above the clearance by the caller.
 */
function taper(b: PartBuilder, frame: BodyFrame, slot: KitSlot, colour: number, x: number, y: number, s0: number, rx0: number, ry0: number, s1: number, rx1: number, ry1: number, sides: number): void {
  const ring = (s: number, rx: number, ry: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      out.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry, frame.z(s)]);
    }
    return out;
  };
  const front = ring(s0, rx0, ry0);
  b.color(colour).bridge(slot, front, ring(s1, rx1, ry1), true);
  b.poly(slot, front);
}

// ---------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------

/** A hatch's load floor below the tailgate's sill. */
const HATCH_SILL_DROP = 0.28;
/** ...and at least this far over the floor pan at the tail. */
const LOAD_FLOOR_RISE = 0.12;

/**
 * A saloon's boot: a painted tub from the rear seat's bulkhead to the panel under the
 * lid's rear edge, its sides stepping over the wheel arches. The classic keeps its fuel
 * tank on the right wing and its spare upright against the right side, standing in a
 * well below the floor because the boot is shallower than a wheel is tall; the middle
 * stays empty for the luggage.
 */
function buildSaloonBoot(frame: BodyFrame, b: PartBuilder, classic: boolean): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const s0 = frame.rearBase + 0.01;
  // Under the lid's rear edge, but 15 mm inside the tail face (or the lid's panel in it), so
  // the backs of the lamps rooted 7 mm in it stand clear of this wall (exterior.ts `FACE_ROOT`).
  const s1 = Math.min(spec.bootEnd! + 0.008, spec.stations[spec.stations.length - 1]!.s - 0.015);
  const inner = frame.wellX(w.rear) - WELL_GAP;
  const shelf = w.radius * (1 + frame.archFactor(w.rear)) + WELL_GAP;
  // Flat floor at the highest point of the shell's floor under it.
  let floor = 0;
  for (const s of stationsBetween(frame, s0, s1)) floor = Math.max(floor, floorY(frame, s) + 0.015);

  bulkhead(b, frame, s0, inner, shelf, floorY(frame, s0));
  bulkhead(b, frame, s1, inner, shelf, floorY(frame, s1));
  for (const side of [1, -1]) loft(b, 'paint', frame, stationsBetween(frame, s0, s1), side, (s) => wingWall(frame, s, inner, shelf, floor, false));

  const floorQuad = (x0: number, x1: number, a: number, c: number): void => {
    b.quad('paint', at(frame, x0, floor, a), at(frame, x1, floor, a), at(frame, x1, floor, c), at(frame, x0, floor, c));
  };
  if (!classic) {
    floorQuad(-inner, inner, s0, s1);
    return;
  }

  // Spare: lying flat in the right front corner of the floor. It is taller than the boot
  // is deep, so upright it needed a well that hung under the car as a painted box.
  const R = w.radius;
  const half = w.width / 2;
  const spareX = -(inner - R - 0.01);
  const spareS = s0 + 0.02 + R;
  b.push(new THREE.Matrix4().makeTranslation(spareX, floor + half + 0.004, frame.z(spareS)));
  b.push(new THREE.Matrix4().makeScale(1, half / 0.07, 1));
  b.color(COLOURS.black).torusY('tyre', R - 0.068, 0.068, 12, 6);
  b.pop();
  b.color(COLOURS.spareRim).cylinderY('trim', [0, 0, 0], R * 0.62, half * 0.7, 10);
  b.cylinderY('chrome', [0, half * 0.7, 0], 0.05, 0.012, 6);
  b.pop();
  floorQuad(-inner, inner, s0, s1);
  // A rubber mat over the empty rest, where the luggage stands.
  const matIn = spareX + R + 0.03;
  b.color(COLOURS.black);
  b.quad('trim', at(frame, matIn, floor + 0.004, s0 + 0.03), at(frame, inner - 0.03, floor + 0.004, s0 + 0.03), at(frame, inner - 0.03, floor + 0.004, s1 - 0.03), at(frame, matIn, floor + 0.004, s1 - 0.03));

  // Fuel tank on the right wing's shelf over the arch, its neck out to the filler.
  const t0 = s0 + 0.03;
  const t1 = Math.min(s1 - 0.05, s0 + 0.45);
  let edge = Infinity;
  for (const s of stationsBetween(frame, t0, t1)) edge = Math.min(edge, frame.lidX(s));
  const tankTop = Math.min(shelf + 0.2, ceiling(frame, t0, t1, edge) - 0.01);
  b.color(COLOURS.fuelTank);
  bevelS(b, frame, 'trim', [-edge, shelf, t0], [-(inner + 0.004), tankTop, t1], 0.03);
  const flap = spec.flap;
  const fs = (flap.s0 + flap.s1) / 2;
  const fy = (flap.y0 + flap.y1) / 2;
  rod(b, 'trim', at(frame, -(frame.sideX(fs, fy) - 0.065), fy, fs), at(frame, -(edge - 0.04), tankTop - 0.03, t0 + 0.06), 0.022, 6);
}

/**
 * A hatch's luggage space: a carpeted load floor from the rear bench's box to the tail
 * and trimmed sides up to the deck's edge, where the greenhouse's lining starts. The
 * spare lives under the floor, out of sight, so the space is left empty.
 */
function buildHatchBoot(frame: BodyFrame, b: PartBuilder): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const st = spec.stations;
  const s0 = loadSpaceStart(frame);
  // Inside the closed tailgate, which stands on the rear base, not out at the tail.
  const s1 = Math.min(st[st.length - 1]!.s - 0.008, frame.rearBase - 0.03);
  const inner = frame.wellX(w.rear) - WELL_GAP;
  // Under the tailgate's sill, but never under the floor pan: an estate's sill is low.
  const floor = Math.max(frame.deckY(frame.rearBase, 0) - HATCH_SILL_DROP, frame.station(frame.rearBase).sill + LOAD_FLOOR_RISE);
  const shelf = Math.max(w.radius * (1 + frame.archFactor(w.rear)) + WELL_GAP, floor + 0.05);
  b.color(COLOURS.bootTrim);
  b.quad('trim', at(frame, -inner, floor, s0), at(frame, inner, floor, s0), at(frame, inner, floor, s1), at(frame, -inner, floor, s1));
  for (const side of [1, -1]) {
    loft(b, 'trim', frame, stationsBetween(frame, s0, s1), side, (s) => {
      const belt = frame.station(s).belt - 0.02;
      const [edgeX, edgeY] = frame.section(s).r4;
      return [[inner, floor], [inner, shelf], [frame.sideX(s, shelf) - 0.08, shelf], [frame.sideX(s, belt) - 0.08, belt], [edgeX - LINING_DEPTH, edgeY]];
    });
  }
}

// ---------------------------------------------------------------------------------
// Underbody
// ---------------------------------------------------------------------------------

/** Floor rails and the seat crossmembers: half spacing and section. */
const RAIL_X = 0.42;
const RAIL_HALF = 0.035;

function buildUnderbody(frame: BodyFrame, b: PartBuilder, eb: PartBuilder, classic: boolean, route: BayRoute): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const cowl = frame.cowl;

  // The UAZ bodies have their own closed sill/arch envelope; the generic floor rails
  // otherwise show as a black shelf outside the front wheel arch.
  if (spec.id !== 'uaz469' && spec.id !== 'uaz2206') {
    b.color(COLOURS.underseal);
    const railEnd = w.rear - 0.85;
    for (const side of [1, -1]) {
      loft(b, 'trim', frame, stationsBetween(frame, cowl + 0.05, railEnd), side, (s) => {
        const f = floorY(frame, s);
        return [[RAIL_X - RAIL_HALF, f + 0.002], [RAIL_X - RAIL_HALF, f - RAIL_HALF], [RAIL_X + RAIL_HALF, f - RAIL_HALF], [RAIL_X + RAIL_HALF, f + 0.002]];
      });
      for (const s of [cowl + 0.62, w.rear - 0.95]) {
        const f = floorY(frame, s);
        const outer = frame.section(s).r0[0] - 0.06;
        const [x0, x1] = side > 0 ? [0.15, outer] : [-outer, -0.15];
        boxS(b, frame, 'trim', [x0, f - 0.028, s - 0.035], [x1, f + 0.002, s + 0.035], 0b111011);
      }
    }
  }

  if (classic) classicChassis(frame, b, eb, route);
  else samaraChassis(frame, b, eb, route);
}

/**
 * Exhaust from the down-pipe's start under the bay: resonator, silencer at the clearance, tail
 * pipe out at the right rear. With `exhaustTuck` the silencer and the tail pipe hang that far
 * under the floor over their run instead, the pipe climbing to them just short of the silencer.
 */
function exhaust(frame: BodyFrame, b: PartBuilder, down: readonly Vec3[], x: number, y: number, resonator: readonly [number, number], silencer: readonly [number, number], silencerX: number): void {
  const spec = frame.spec;
  const C = clearance(frame);
  b.color(COLOURS.exhaust);
  tube(b, 'trim', [...down, at(frame, x, y, resonator[0])], 0.022, 6);
  bevelS(b, frame, 'trim', [x - 0.075, C + 0.006, resonator[0]], [x + 0.075, y + 0.04, resonator[1]], 0.025);
  const tail = spec.stations[spec.stations.length - 1]!.s;
  const tuck = spec.exhaustTuck;
  if (tuck === undefined) {
    tube(b, 'trim', [at(frame, x, y, resonator[1]), at(frame, x, y, silencer[0] - 0.25), at(frame, silencerX, y, silencer[0])], 0.022, 6);
    bevelS(b, frame, 'trim', [silencerX - 0.13, C + SILENCER_TUCK, silencer[0]], [silencerX + 0.13, C + SILENCER_TUCK + 0.085, silencer[1]], 0.035);
    tube(b, 'trim', [at(frame, silencerX - 0.03, y + 0.007, silencer[1]), at(frame, silencerX - 0.08, y + 0.03, tail - 0.05), at(frame, -0.45, y + 0.045, spec.length - 0.03)], 0.022, 6);
    return;
  }
  // The floor is straight between stations, so its lowest over a run is at a station or an end.
  const under = (s0: number, s1: number): number => Math.min(...stationsBetween(frame, s0, s1).map((s) => floorY(frame, s))) - tuck;
  const top = under(silencer[0], silencer[1]);
  const mid = top - 0.0425;
  // Under the axle as before, then up into the silencer's front face, behind whatever
  // crosses the car ahead of it (the classic's Panhard rod at silencer[0] − 0.08).
  tube(b, 'trim', [at(frame, x, y, resonator[1]), at(frame, x, y, silencer[0] - 0.25), at(frame, silencerX, y, silencer[0] - 0.06), at(frame, silencerX, mid, silencer[0] + 0.01)], 0.022, 6);
  bevelS(b, frame, 'trim', [silencerX - 0.13, top - 0.085, silencer[0]], [silencerX + 0.13, top, silencer[1]], 0.035);
  // Out under the tail's floor, its top `tuck` under it.
  const ty = under(silencer[1], tail) - 0.022;
  tube(b, 'trim', [at(frame, silencerX - 0.03, mid, silencer[1] - 0.01), at(frame, silencerX - 0.08, ty, tail - 0.05), at(frame, -0.45, ty, spec.length - 0.03)], 0.022, 6);
}

/**
 * The classic's underside: the front beam and wishbones with the anti-roll bar, the
 * gearbox and propshaft in the tunnel, and the live rear axle on four trailing links and
 * a Panhard rod, its differential hanging lowest at the clearance. The Niva adds its
 * four-wheel drive (`nivaTransfer`).
 */
function classicChassis(frame: BodyFrame, b: PartBuilder, eb: PartBuilder, route: BayRoute): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const cowl = frame.cowl;
  const R = w.radius;
  const C = clearance(frame);
  const niva = spec.platform === 'niva' || spec.platform === 'van';

  if (spec.id !== 'uaz469' && spec.id !== 'uaz2206') {
    // Generic classic front linkage is not part of the UAZ visual underbody.
    const cs = w.front - CROSSMEMBER_AHEAD;
    const cf = floorY(frame, cs);
    b.color(COLOURS.underseal);
    across(b, frame, 'trim', [[cs - 0.045, cf], [cs - 0.035, cf - 0.05], [cs + 0.035, cf - 0.05], [cs + 0.045, cf]], -0.47, 0.47, false);
    const ff = floorY(frame, w.front);
    const ball = w.frontHalfTrack - 0.1;
    for (const side of [1, -1]) {
      const joint = at(frame, side * ball, R - 0.08, w.front);
      rod(b, 'trim', at(frame, side * 0.32, cf - 0.03, cs), joint, 0.016, 5);
      rod(b, 'trim', at(frame, side * 0.32, ff - 0.03, w.front + 0.14), joint, 0.016, 5);
    }
    const barS = w.front - 0.25;
    const by = floorY(frame, barS) - 0.025;
    b.color(COLOURS.black);
    tube(b, 'trim', [at(frame, 0.52, by, w.front - 0.02), at(frame, 0.45, by, barS), at(frame, -0.45, by, barS), at(frame, -0.52, by, w.front - 0.02)], 0.012, 4);
  }

  // Gearbox from the firewall, where the engine's bellhousing met it; propshaft to the
  // pinion, on the Niva from the transfer box behind the gearbox.
  const x = route.engineX;
  const cy = route.crankY;
  const firewall = route.gearFrom ?? cowl;
  const gearEnd = firewall + 0.45;
  taper(b, frame, 'trim', COLOURS.alloy, x, cy, firewall + 0.02, 0.11, cy - C - 0.012, gearEnd, 0.07, 0.065, 8);
  const pinionY = R - 0.035;
  const pinionS = w.rear - 0.16;
  b.color(COLOURS.driveline);
  b.cylinderZ('trim', at(frame, x, cy, gearEnd + 0.02), 0.06, 0.02, 8);
  const shaftFrom = niva ? nivaTransfer(frame, b, x, cy, gearEnd + 0.04) : at(frame, x, cy, gearEnd + 0.04);
  b.color(COLOURS.driveline);
  rod(b, 'trim', shaftFrom, at(frame, 0, pinionY, pinionS), 0.032, 6);
  if (!niva) {
    // The long propshaft's centre bearing. No top: it meets the floor.
    const mid = (gearEnd + pinionS) / 2;
    boxS(b, frame, 'trim', [-0.06, (cy + pinionY) / 2 - 0.03, mid - 0.03], [0.06, floorY(frame, mid), mid + 0.03], 0b111011);
  }

  // Live axle: tubes, the differential (its bottom at the clearance), the pinion nose.
  b.color(COLOURS.driveline);
  b.cylinderX('trim', at(frame, 0, R, w.rear), 0.035, w.rearHalfTrack - 0.06, 6);
  const diff = R - C;
  b.cylinderZ('trim', at(frame, 0, R, w.rear), diff, 0.065, 8);
  b.cylinderZ('trim', at(frame, 0, R, w.rear + 0.075), diff * 0.85, 0.012, 8);
  b.cylinderZ('trim', at(frame, 0, pinionY, w.rear - 0.11), 0.055, 0.05, 8);
  const rf = floorY(frame, w.rear);
  for (const side of [1, -1]) {
    coil(b, at(frame, side * 0.45, R + 0.035, w.rear), 0.16, 0.05, 3);
    b.color(COLOURS.black);
    rod(b, 'trim', at(frame, side * 0.55, R - 0.03, w.rear + 0.06), at(frame, side * 0.48, R + 0.2, w.rear + 0.16), 0.022, 5);
    b.color(COLOURS.underseal);
    rod(b, 'trim', at(frame, side * 0.52, R - 0.04, w.rear), at(frame, side * 0.5, floorY(frame, w.rear - 0.6) - 0.03, w.rear - 0.6), 0.018, 5);
    rod(b, 'trim', at(frame, side * 0.2, R - 0.02, w.rear - 0.04), at(frame, side * 0.26, floorY(frame, w.rear - 0.36) - 0.015, w.rear - 0.36), 0.016, 5);
  }
  rod(b, 'trim', at(frame, 0.5, R - 0.03, w.rear + 0.13), at(frame, -0.45, rf - 0.012, w.rear + 0.13), 0.014, 5);

  // Exhaust along the right of the tunnel, under the axle, out at the right rear. On the
  // Niva it keeps outboard of the transfer box and its resonator behind it.
  const ex = niva ? -0.22 : -0.17;
  const ey = C + 0.035;
  const o = route.outlet;
  const os = frame.zNose - o[2];
  exhaust(
    frame,
    eb,
    [o, at(frame, o[0] - 0.01, (o[1] + ey) / 2, os + 0.06), at(frame, ex, ey + 0.02, firewall + 0.05), at(frame, ex, ey, firewall + 0.25)],
    ex,
    ey,
    niva ? [firewall + 0.85, Math.min(firewall + 1.25, w.rear - 0.4)] : [firewall + 0.55, firewall + 1.0],
    // Short of the tail panel: the boot lid's end on a saloon, the body's last station on an estate.
    [w.rear + 0.21, Math.min(w.rear + 0.78, (spec.bootEnd ?? spec.stations[spec.stations.length - 1]!.s) - 0.2)],
    ex,
  );
}

/**
 * The Niva's four-wheel drive under the classic's driveline [E: schematic, from the real
 * car's layout]: a short shaft from the gearbox to the transfer box hanging under the
 * tunnel, a front propshaft from its right front to the front differential on the
 * right under the engine (its bottom at the clearance, as the rear one's), and
 * driveshafts with their joints' boots out to the front hubs. Returns the transfer box's
 * rear output, where the rear propshaft starts.
 */
function nivaTransfer(frame: BodyFrame, b: PartBuilder, x: number, cy: number, s: number): Vec3 {
  const w = frame.spec.wheels;
  const R = w.radius;
  const C = clearance(frame);
  // The box: 0.26 along, 0.28 across (more of it right, where the front output is). The
  // Niva's floor stands only a few cm over the clearance (its sill, 0.26), so the box rises
  // into the tunnel (interior.ts `tunnel`, 0.08 high and more over it) from 10 mm over the
  // clearance.
  const t0 = s + 0.08;
  const t1 = t0 + 0.26;
  const top = Math.min(floorY(frame, t0), floorY(frame, t1)) + 0.05;
  const bottom = C + 0.01;
  const ty = (top + bottom) / 2;
  b.color(COLOURS.driveline);
  rod(b, 'trim', at(frame, x, cy, s), at(frame, x, ty, t0), 0.028, 6);
  b.color(COLOURS.alloy);
  bevelS(b, frame, 'trim', [x - 0.18, bottom, t0], [x + 0.1, top, t1], 0.03);
  b.color(COLOURS.driveline);
  b.cylinderZ('trim', at(frame, x, ty, t1 + 0.015), 0.055, 0.015, 8);

  // Front differential: a housing round its pinion's axis, right of centre and just behind
  // the axle line, clear of the front beam ahead of it.
  const ff = floorY(frame, w.front);
  const rd = Math.min(0.1, (ff - 0.006 - C) / 2);
  const xd = -0.1;
  const yd = C + rd;
  const sd = w.front + 0.04;
  b.cylinderZ('trim', at(frame, xd, yd, sd), rd, 0.06, 8);
  b.cylinderZ('trim', at(frame, xd, yd, sd + 0.1), rd * 0.5, 0.04, 8);
  // Front propshaft along the right of the gearbox.
  const xf = x - 0.14;
  b.cylinderZ('trim', at(frame, xf, ty, t0 - 0.015), 0.05, 0.015, 8);
  rod(b, 'trim', at(frame, xf, ty, t0 - 0.03), at(frame, xd, yd, sd + 0.14), 0.026, 6);
  // Driveshafts to the hubs, a boot at each end.
  const hub = w.frontHalfTrack - 0.07;
  for (const side of [1, -1]) {
    const x0 = xd + side * rd;
    const x1 = side * hub;
    b.color(COLOURS.driveline);
    rod(b, 'trim', at(frame, x0, yd, sd), at(frame, x1, R, w.front), 0.018, 6);
    b.color(COLOURS.black);
    const along = (k: number): Vec3 => at(frame, x0 + (x1 - x0) * k, yd + (R - yd) * k, sd + (w.front - sd) * k);
    const span = Math.abs(x1 - x0);
    for (const k of [0.06 / span, 1 - 0.07 / span]) b.cylinderX('trim', along(k), 0.04, 0.05, 6);
  }
  return at(frame, x, ty, t1 + 0.03);
}

/**
 * The Samara's underside: MacPherson lower arms with their braces and the anti-roll
 * bar, the fuel tank under the rear seat, and the twist beam on its trailing arms with
 * the springs over them; the silencer hangs lowest at CLEARANCE.
 */
function samaraChassis(frame: BodyFrame, b: PartBuilder, eb: PartBuilder, route: BayRoute): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const cowl = frame.cowl;
  const R = w.radius;

  const ff = floorY(frame, w.front);
  const ball = w.frontHalfTrack - 0.1;
  b.color(COLOURS.underseal);
  for (const side of [1, -1]) {
    rod(b, 'trim', at(frame, side * 0.34, ff - 0.03, w.front + 0.02), at(frame, side * ball, R - 0.07, w.front), 0.018, 5);
    rod(b, 'trim', at(frame, side * 0.46, ff - 0.03, w.front + 0.01), at(frame, side * 0.32, floorY(frame, w.front + 0.42) - 0.02, w.front + 0.42), 0.012, 5);
  }
  const barS = w.front + 0.22;
  const by = floorY(frame, barS) - 0.02;
  b.color(COLOURS.black);
  tube(b, 'trim', [at(frame, 0.5, by, w.front + 0.02), at(frame, 0.42, by, barS), at(frame, -0.42, by, barS), at(frame, -0.5, by, w.front + 0.02)], 0.012, 4);

  // Fuel tank under the rear seat, on two straps.
  const t0 = w.rear - 0.78;
  const t1 = w.rear - 0.5;
  const tf = Math.min(floorY(frame, t0), floorY(frame, t1));
  b.color(COLOURS.fuelTank);
  // 6 mm under the floor: its rounded top cannot leave the floor's plane out, and nearer
  // the two would fight in depth from the road.
  bevelS(b, frame, 'trim', [-0.45, CLEARANCE, t0], [-0.04, tf - 0.006, t1], 0.03);
  b.color(COLOURS.underseal);
  for (const s of [t0 + 0.07, t1 - 0.07]) boxS(b, frame, 'trim', [-0.47, CLEARANCE, s - 0.015], [-0.02, CLEARANCE + 0.006, s + 0.015]);

  // Twist beam: trailing arms from their pivots to the hubs, the beam across them, a
  // spring and damper on each arm.
  const pivotS = w.rear - 0.45;
  const beamS = w.rear - 0.2;
  const hub = w.rearHalfTrack - 0.08;
  const bf = floorY(frame, beamS);
  for (const side of [1, -1]) {
    const pf = floorY(frame, pivotS);
    boxS(b, frame, 'trim', [side * 0.53, pf - 0.05, pivotS - 0.03], [side * 0.59, pf, pivotS + 0.03], 0b111011);
    rod(b, 'trim', at(frame, side * 0.56, pf - 0.03, pivotS), at(frame, side * hub, R - 0.01, w.rear), 0.025, 6);
    const springX = side * (frame.wellX(w.rear) - 0.07);
    boxS(b, frame, 'trim', [Math.min(springX, side * hub), R - 0.02, w.rear - 0.07], [Math.max(springX, side * hub), R + 0.005, w.rear + 0.03]);
    coil(b, at(frame, springX, R + 0.005, w.rear - 0.02), 0.17, 0.05, 3);
    b.color(COLOURS.black);
    rod(b, 'trim', at(frame, springX, R, w.rear - 0.02), at(frame, springX, R + 0.2, w.rear - 0.02), 0.02, 5);
    b.color(COLOURS.underseal);
  }
  across(b, frame, 'trim', [[beamS - 0.04, bf - 0.005], [beamS - 0.03, bf - 0.055], [beamS + 0.03, bf - 0.055], [beamS + 0.04, bf - 0.005]], -0.575, 0.575);

  // Exhaust: from behind the engine's place, along the left of centre past the tank, under the
  // beam, then across to the silencer on the right.
  const ex = 0.06;
  const ey = CLEARANCE + 0.022;
  const o = route.outlet;
  const os = frame.zNose - o[2];
  const tail = spec.stations[spec.stations.length - 1]!.s;
  exhaust(
    frame,
    eb,
    [o, at(frame, o[0] + 0.02, (o[1] + ey) / 2, os + 0.12), at(frame, ex, ey + 0.015, os + 0.35), at(frame, ex, ey, cowl + 0.2)],
    ex,
    ey,
    [cowl + 0.5, cowl + 0.9],
    [w.rear + 0.12, Math.min(w.rear + 0.5, tail - 0.2)],
    -0.3,
  );
}
