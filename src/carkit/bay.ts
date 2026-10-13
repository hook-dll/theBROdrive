/**
 * Under the lids and under the car: the engine bay, the boot and the underbody.
 *
 * All three are seen only with a lid open or the car on its side, so they are built to
 * read, not to engineer: panels that close each space so no void or road shows through,
 * and the big recognisable parts in their true places — an inline four along the
 * classic's bay or across the Samara's, the radiator in front of it, the battery and
 * reservoirs on the inner wings; the spare and the fuel tank on the saloon boot's right
 * side; the exhaust, the driveline and the suspension underneath.
 *
 * Everything is placed off the frame (axles, cowl, deck, sills), so another body on the
 * same platform gets the same layout fitted to its own shell. The shell sets the limits:
 *
 *  - a closed bonnet's or boot lid's inner skin (LID_ROOM under the deck) caps
 *    everything below it;
 *  - inner panels stand WELL_GAP inside the wheel wells' walls, which keeps them clear
 *    of the tyres;
 *  - the shell's dark floor at sill height closes every space from below, so what is
 *    meant to be seen from under the car hangs below it, and the lowest of it (the
 *    classic's differential, both cars' silencer) stands at exactly CLEARANCE.
 */

import * as THREE from 'three';
import type { BodyFrame } from './body';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { addBuilt, type KitContext } from './context';
import { loadSpaceStart } from './interior';

/** Ground clearance of the lowest part under the car: the factory figure the body was fitted to. */
const CLEARANCE = 0.17;
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
/** The classic's front beam stands this far ahead of the axle; the sump's deep part clears it. */
const CROSSMEMBER_AHEAD = 0.08;

const COLOURS = {
  iron: 0x56595d,
  sump: 0x26282a,
  alloy: 0x8d9093,
  camClassic: 0x8a281f,
  camSamara: 0x3e4144,
  rib: 0xa9acaf,
  black: 0x19191a,
  manifold: 0x5c3c2b,
  exhaust: 0x4b4541,
  radiator: 0x222527,
  radiatorTank: 0x6b5835,
  battery: 0x2b2d30,
  terminal: 0x9a2a20,
  plastic: 0xd5d1c2,
  capBlue: 0x2b4f8a,
  oilFilter: 0xb5561e,
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
  const classic = frame.spec.platform === 'classic';

  const b = new PartBuilder();
  const route = buildEngineBay(frame, b, classic);
  addBuilt(bay, b, [0, 0, 0], 'bay', true);

  const lb = new PartBuilder();
  if (frame.spec.bootEnd !== undefined) buildSaloonBoot(frame, lb, classic);
  else buildHatchBoot(frame, lb);
  addBuilt(boot, lb, [0, 0, 0], 'boot', true);

  const ub = new PartBuilder();
  buildUnderbody(frame, ub, classic, route);
  addBuilt(under, ub, [0, 0, 0], 'under', true);
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

/** Half width of a lid's edge at s: the deck row the bonnet or boot lid is cut along. */
function lidEdge(frame: BodyFrame, s: number): number {
  return frame.section(s).r4[0] - frame.spec.cabin.pillar;
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

/** Prism across the car: a section in (s, y) extruded along x from x0 to x1. */
function across(b: PartBuilder, frame: BodyFrame, slot: KitSlot, section: readonly Pt[], x0: number, x1: number): void {
  b.push(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, frame.zNose, 0, 0, 0, 1));
  b.extrude(slot, section, x0, x1);
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
 * Inner wing (or boot side) half-section at s: from under the lid's edge down to a shelf
 * over the wheel arch, in to `inner` and down to the floor, with a chassis rail along
 * its foot when `rail`.
 */
function wingWall(frame: BodyFrame, s: number, inner: number, shelf: number, floor: number, rail: boolean): Pt[] {
  const x = lidEdge(frame, s) + JAMB_STEP;
  const top = Math.max(frame.deckY(s, x) - LID_ROOM, shelf + 0.02);
  const pts: Pt[] = [[x, top], [x, shelf], [inner, shelf]];
  if (rail) pts.push([inner, floor + RAIL_H], [inner - RAIL_W, floor + RAIL_H], [inner - RAIL_W, floor]);
  else pts.push([inner, floor]);
  return pts;
}

/** A painted wall across the car at s, filling the wing walls' section up to the lid. */
function bulkhead(b: PartBuilder, frame: BodyFrame, s: number, inner: number, shelf: number, floor: number): void {
  const z = frame.z(s);
  const edge = lidEdge(frame, s) + JAMB_STEP;
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

/** What the bay hands the underbody: where the exhaust leaves the engine, and the crank. */
interface BayRoute {
  /** Exhaust manifold's outlet, car frame. */
  readonly outlet: Vec3;
  /** Crank axis height and the engine's offset across the car: where the driveline leaves it. */
  readonly crankY: number;
  readonly engineX: number;
}

interface Inline4 {
  /** Block length along the crank and half width across it. */
  readonly length: number;
  readonly half: number;
  readonly pan: number;
  readonly block: number;
  readonly head: number;
  readonly cover: number;
  readonly coverColour: number;
  /** Intake on the engine's left (+x local), across the head from the exhaust. */
  readonly crossflow: boolean;
  /** Engine-driven fan on the water pump (the classic); the Samara's is electric. */
  readonly fan: boolean;
  /** Local z range of the deep part of the sump; the rest is a shallow tray. */
  readonly sumpZ: readonly [number, number];
  /** Local height of the shallow tray's bottom. */
  readonly trayY: number;
}

/**
 * An inline four about its own origin: the sump's bottom under the middle of the block,
 * +z towards the timing end, +x the engine's left. The exhaust is on its right; the
 * intake joins it there (the classic) or sits across the head (crossflow). Every size
 * across the engine is a fraction of the block's half width, so one drawing serves a
 * big or a small four. Returns the exhaust outlet and the top of the carburettor, local.
 */
function inline4(b: PartBuilder, e: Inline4): { outlet: Vec3; carb: Vec3 } {
  const L = e.length;
  const h = e.half;
  const yBlock = e.pan;
  const yHead = yBlock + e.block;
  const yCover = yHead + e.head;
  const top = yCover + e.cover;
  // Sump: a deep pan where the crossmember leaves room, a shallow tray elsewhere.
  b.color(COLOURS.sump);
  if (e.sumpZ[1] - e.sumpZ[0] > 0.08) {
    const zc = (e.sumpZ[0] + e.sumpZ[1]) / 2;
    b.bevelBox('trim', [0, (e.pan + 0.004) / 2, zc], [h * 0.85, (e.pan + 0.004) / 2, (e.sumpZ[1] - e.sumpZ[0]) / 2], 0.025);
  }
  b.box('trim', [0, (e.trayY + e.pan + 0.004) / 2, 0], [h * 0.9, (e.pan + 0.004 - e.trayY) / 2, L / 2 - 0.03]);
  // Block, head and cam cover: each chamfered, each narrower than the one below.
  b.color(COLOURS.iron).bevelBox('trim', [0, yBlock + e.block / 2, 0], [h, e.block / 2, L / 2], h * 0.25);
  b.color(COLOURS.alloy).bevelBox('trim', [0, yHead + e.head / 2, 0], [h * 0.88, e.head / 2, L / 2 - 0.01], h * 0.15);
  const c = e.cover;
  const cover: Pt[] = [[h * 0.78, 0], [h * 0.78, c * 0.45], [h * 0.5, c], [-h * 0.5, c], [-h * 0.78, c * 0.45], [-h * 0.78, 0]];
  b.color(e.coverColour).extrude('trim', cover, -(L / 2 - 0.025), L / 2 - 0.025, 0, yCover);
  b.color(COLOURS.rib);
  for (const x of [-0.27, 0, 0.27]) b.box('trim', [x * h, top + 0.006, 0], [0.008, 0.008, L / 2 - 0.09], UPPER_FACES);
  b.color(COLOURS.black).box('trim', [h * 0.35, top + 0.014, L / 2 - 0.1], [0.024, 0.014, 0.024], UPPER_FACES);
  // Timing end: cover, pulleys and the belt between them.
  const front = L / 2;
  b.color(COLOURS.alloy).box('trim', [0, (yBlock + yCover) / 2, front + 0.018], [h * 0.77, (yCover - yBlock) / 2, 0.018]);
  const crank: Vec3 = [0, yBlock + 0.05, front + 0.05];
  const pump: Vec3 = [0, yBlock + e.block * 0.82, front + 0.05];
  b.color(COLOURS.black);
  b.cylinderZ('trim', crank, h * 0.5, 0.014, 6);
  b.cylinderZ('trim', pump, h * 0.38, 0.012, 6);
  for (const x of [-0.42, 0.42]) b.box('trim', [x * h, (crank[1] + pump[1]) / 2, front + 0.05], [0.006, (pump[1] - crank[1]) / 2, 0.008]);
  if (e.fan) {
    // Four pitched blades on the water pump's hub.
    const fz = front + 0.1;
    b.cylinderZ('trim', [0, pump[1], fz], 0.04, 0.02, 6);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = (r: number, w: number, dz: number): Vec3 => [ca * r - sa * w, pump[1] + sa * r + ca * w, fz + dz];
      b.poly('trim', [p(0.035, -0.04, -0.015), p(0.2, -0.045, -0.02), p(0.2, 0.045, 0.02), p(0.035, 0.04, 0.015)]);
    }
  }
  // Right side: alternator low at the front, exhaust manifold along the head.
  b.color(COLOURS.alloy).cylinderZ('trim', [-h * 1.3, yBlock + e.block * 0.55, front - 0.05], h * 0.5, 0.06, 8);
  b.color(COLOURS.manifold);
  const runnerY = yHead + e.head * 0.35;
  for (let i = 0; i < 4; i++) {
    const z = ((i - 1.5) / 4) * (L - 0.06);
    b.box('trim', [-h * 1.15, runnerY, z], [h * 0.27, 0.022, 0.026]);
  }
  const collector = -h * 1.46;
  b.box('trim', [collector, runnerY - 0.04, 0], [h * 0.23, 0.035, L / 2 - 0.06]);
  const outlet: Vec3 = [collector, runnerY - 0.075, -(L / 2 - 0.1)];
  // Intake and carburettor: over the exhaust, or across the head.
  const ix = (e.crossflow ? 1.15 : -1.15) * h;
  b.color(COLOURS.alloy);
  b.box('trim', [ix, yHead + e.head * 0.85, 0], [h * 0.27, 0.028, L / 2 - 0.1]);
  const carbX = (e.crossflow ? 0.85 : -1.0) * h;
  const carbY0 = yHead + e.head;
  b.box('trim', [carbX, (carbY0 + top) / 2, 0], [0.05, (top - carbY0) / 2, 0.05]);
  // Left side: oil filter low, distributor high with its four leads to the plugs.
  b.color(COLOURS.oilFilter).cylinderX('trim', [h * 1.3, yBlock + e.block * 0.3, 0.06], 0.045, 0.04, 6);
  const dist: Vec3 = [h * 1.23, yHead + 0.04, -0.06];
  b.color(COLOURS.black).cylinderY('trim', dist, 0.045, 0.035, 6);
  for (let i = 0; i < 4; i++) {
    const z = ((i - 1.5) / 4) * (L - 0.06);
    rod(b, 'trim', [dist[0], dist[1] + 0.035, dist[2]], [h * 0.8, yHead + e.head * 0.6, z], 0.005, 3);
  }
  return { outlet, carb: [carbX, top, 0] };
}

function buildEngineBay(frame: BodyFrame, b: PartBuilder, classic: boolean): BayRoute {
  const spec = frame.spec;
  const w = spec.wheels;
  const inner = frame.wellX(w.front) - WELL_GAP;
  const shelf = w.radius * (1 + w.arch) + WELL_GAP;
  const support = spec.bonnetFront + SUPPORT_BACK;
  const cowl = frame.cowl;

  // ---- inner wings with the chassis rails along their feet, firewall, scuttle ----
  const ss = stationsBetween(frame, support - 0.04, cowl);
  for (const side of [1, -1]) loft(b, 'paint', frame, ss, side, (s) => wingWall(frame, s, inner, shelf, floorY(frame, s), true));
  bulkhead(b, frame, cowl, inner, shelf, floorY(frame, cowl));
  // Scuttle: the plenum under the screen's foot, a black grille on top.
  const scuttleTop = ceiling(frame, cowl - 0.1, cowl, lidEdge(frame, cowl));
  const scuttle: Pt[] = [[cowl, scuttleTop - 0.09], [cowl, scuttleTop], [cowl - 0.1, scuttleTop - 0.005], [cowl - 0.1, scuttleTop - 0.05]];
  b.color(COLOURS.black);
  across(b, frame, 'trim', scuttle, -lidEdge(frame, cowl), lidEdge(frame, cowl));

  // ---- radiator support: slam panel, posts and lower member framing the radiator ----
  const radHalf = 0.29;
  const fl = floorY(frame, support);
  const slamTop = ceiling(frame, support - 0.06, support + 0.02, inner);
  across(b, frame, 'paint', [[support - 0.06, slamTop - 0.012], [support - 0.06, slamTop], [support + 0.02, slamTop], [support + 0.02, slamTop - 0.05], [support - 0.03, slamTop - 0.05]], -inner, inner);
  for (const side of [1, -1]) {
    const [x0, x1] = side > 0 ? [radHalf + 0.01, inner] : [-inner, -radHalf - 0.01];
    boxS(b, frame, 'paint', [x0, fl, support - 0.03], [x1, slamTop - 0.05, support]);
  }
  boxS(b, frame, 'paint', [-inner, fl, support - 0.03], [inner, fl + 0.07, support]);
  const rs0 = support + 0.005;
  const rs1 = support + 0.045;
  const radBottom = fl + 0.08;
  const radTop = slamTop - 0.06;
  b.color(COLOURS.radiator);
  boxS(b, frame, 'trim', [-radHalf, radBottom, rs0], [radHalf, radTop, rs1]);
  b.color(COLOURS.radiatorTank);
  boxS(b, frame, 'trim', [-radHalf - 0.01, radTop - 0.05, rs0 - 0.005], [radHalf + 0.01, radTop, rs1 + 0.01]);
  boxS(b, frame, 'chrome', [radHalf - 0.08, radTop, rs0 + 0.002], [radHalf - 0.04, radTop + 0.02, rs1 - 0.002], UPPER_FACES);

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
  const boosterY = Math.min(scuttleTop - 0.22, floorY(frame, cowl) + 0.36);
  b.color(COLOURS.black).cylinderZ('trim', [boosterX, boosterY, frame.z(cowl - 0.045)], 0.1, 0.04, 10);
  b.color(COLOURS.alloy).cylinderZ('trim', [boosterX, boosterY, frame.z(cowl - 0.16)], 0.03, 0.075, 6);
  reservoir(b, frame, boosterX - 0.04, boosterX + 0.04, cowl - 0.22, cowl - 0.12, boosterY + 0.03, boosterY + 0.1, COLOURS.black);

  return classic ? classicEngine(frame, b, inner, support, rs1) : samaraEngine(frame, b, inner, support, rs1);
}

/**
 * The classic: a longitudinal four a touch left of centre, its fan just behind the
 * radiator and its gearbox running on under the tunnel; the battery on the right in
 * front of the tower, the expansion tank on the right behind it, the washer bottle on
 * the left.
 */
function classicEngine(frame: BodyFrame, b: PartBuilder, inner: number, support: number, radiatorBack: number): BayRoute {
  const w = frame.spec.wheels;
  const cowl = frame.cowl;
  const L = 0.54;
  const half = 0.16;
  const engineX = 0.02;
  const sFront = radiatorBack + 0.17;
  const sMid = sFront + L / 2;
  // The crank sits just above the floor at the firewall, so the gearbox and the
  // propshaft behind it hang half below the floor, as they do in the tunnel.
  const crankY = floorY(frame, cowl) + 0.025;
  const pan = 0.08;
  const base = crankY - pan;
  const room = ceiling(frame, sFront - 0.1, sFront + L, 0.32) - base;
  const stack = room - pan - 0.1;
  const crossmemberS = w.front - CROSSMEMBER_AHEAD;
  const sumpFront = crossmemberS + 0.06;
  const e: Inline4 = {
    length: L,
    half,
    pan,
    block: stack * 0.52,
    head: stack * 0.2,
    cover: stack * 0.17,
    coverColour: COLOURS.camClassic,
    crossflow: false,
    fan: true,
    sumpZ: [-(L / 2 - 0.04), Math.min(L / 2 - 0.04, sMid - sumpFront)],
    trayY: floorY(frame, crossmemberS) + 0.005 - base,
  };
  b.pushAt([engineX, base, frame.z(sMid)]);
  const { outlet, carb } = inline4(b, e);
  // Round air filter on the carburettor: a big flat drum, black with a chrome lid and
  // its snorkel to the front.
  const filterTop = ceiling(frame, sMid - 0.18, sMid + 0.18, 0.32) - base - 0.01;
  const filterH = Math.max(0.05, filterTop - carb[1] - 0.012);
  const fy = carb[1] + 0.006 + filterH / 2;
  b.color(COLOURS.black).cylinderY('trim', [carb[0], fy, 0], 0.17, filterH / 2, 12);
  b.poly('chrome', Array.from({ length: 12 }, (_, i): Vec3 => [carb[0] + Math.cos((i / 12) * Math.PI * 2) * 0.15, fy + filterH / 2 + 0.003, Math.sin((i / 12) * Math.PI * 2) * 0.15]));
  b.box('trim', [carb[0] - 0.02, fy - filterH * 0.1, 0.22], [0.045, filterH * 0.3, 0.07]);
  const outletCar = new THREE.Vector3(...outlet).applyMatrix4(b.matrix);
  b.pop();

  // Bellhousing to the firewall; the gearbox carries on in the underbody.
  const sBack = sFront + L;
  taper(b, frame, 'trim', COLOURS.alloy, engineX, crankY, sBack, half, crankY - CLEARANCE - 0.012, cowl + 0.02, 0.12, crankY - CLEARANCE - 0.012, 8);

  // Battery in front of the right tower, expansion tank behind it, washer bottle left.
  const batteryEnd = w.front - TOWER_R - 0.03;
  const batteryStart = Math.max(support + 0.08, batteryEnd - 0.25);
  battery(b, frame, -1, inner, batteryStart, batteryEnd, ceiling(frame, batteryStart, batteryEnd, inner) - 0.02);
  const tankTop = ceiling(frame, cowl - 0.38, cowl - 0.2, inner) - 0.03;
  reservoir(b, frame, -inner + 0.01, -inner + 0.13, cowl - 0.38, cowl - 0.2, tankTop - 0.15, tankTop, COLOURS.black);
  const washerTop = ceiling(frame, support + 0.08, support + 0.24, inner) - 0.03;
  reservoir(b, frame, inner - 0.14, inner - 0.01, support + 0.08, support + 0.24, washerTop - 0.17, washerTop, COLOURS.capBlue);
  // Top hose from the radiator's tank to the thermostat on the head's nose.
  hose(b, frame, [[-0.2, 0, radiatorBack], [-0.12, -0.02, radiatorBack + 0.08], [engineX - 0.04, -0.04, sFront - 0.02]], ceiling(frame, support, sFront, 0.3) - 0.03);

  return { outlet: [outletCar.x, outletCar.y, outletCar.z], crankY, engineX };
}

/**
 * The Samara: a transverse four on the right, leaning back, with the gearbox on the
 * left and the driveshafts out to the wheels; an electric fan on the radiator, a
 * box air filter on the carburettor, the battery on the left in front of its tower.
 */
function samaraEngine(frame: BodyFrame, b: PartBuilder, inner: number, support: number, radiatorBack: number): BayRoute {
  const w = frame.spec.wheels;
  const cowl = frame.cowl;
  const L = 0.39;
  const engineX = -0.14;
  const sMid = w.front - 0.15;
  const tilt = 0.15;
  const pan = 0.075;
  const base = floorY(frame, sMid) - 0.045;
  const room = ceiling(frame, sMid - 0.26, sMid + 0.22, Math.abs(engineX) + 0.22) - base - 0.03;
  const stack = room - pan - 0.11;
  const e: Inline4 = {
    length: L,
    half: 0.14,
    pan,
    block: stack * 0.52,
    head: stack * 0.2,
    cover: stack * 0.17,
    coverColour: COLOURS.camSamara,
    crossflow: true,
    fan: false,
    sumpZ: [-(L / 2 - 0.04), L / 2 - 0.04],
    trayY: 0.045,
  };
  // Crank across the car, timing end to the right, leaning its top towards the firewall.
  b.pushAt([engineX, base, frame.z(sMid)], [0, -Math.PI / 2, tilt]);
  const { outlet, carb } = inline4(b, e);
  // Box air filter on the carburettor.
  const fh = Math.max(0.05, room - carb[1] - 0.015);
  b.color(COLOURS.black).bevelBox('trim', [carb[0] - 0.03, carb[1] + 0.006 + fh / 2, 0], [0.12, fh / 2, 0.17], 0.02);
  b.color(COLOURS.alloy).bevelBox('trim', [carb[0] - 0.03, carb[1] + 0.008 + fh, 0], [0.1, 0.006, 0.14], 0.004);
  const outletCar = new THREE.Vector3(...outlet).applyMatrix4(b.matrix);
  const crank = new THREE.Vector3(0, pan, 0).applyMatrix4(b.matrix);
  b.pop();

  // Gearbox on the left: bellhousing on the block's end, the case and the final drive
  // over the axle line.
  const xb = engineX + L / 2;
  const sCrank = frame.zNose - crank.z;
  b.color(COLOURS.alloy);
  b.cylinderX('trim', [xb + 0.035, crank.y, crank.z], 0.13, 0.035, 8);
  const gearTop = crank.y + 0.14;
  const gearOut = inner - 0.17;
  bevelS(b, frame, 'trim', [xb + 0.07, floorY(frame, w.front) - 0.05, sCrank - 0.1], [gearOut, gearTop, w.front + 0.07], 0.04);
  // Driveshafts from the case's faces at the hubs' height, with their joints' boots.
  const y = w.radius;
  const hub = w.frontHalfTrack - 0.07;
  b.color(COLOURS.driveline);
  for (const [x0, x1] of [[gearOut, hub], [xb + 0.07, -hub]] as const) {
    rod(b, 'trim', at(frame, x0, y, w.front), at(frame, x1, y, w.front), 0.018, 6);
    const dir = Math.sign(x1 - x0);
    b.color(COLOURS.black);
    b.cylinderX('trim', at(frame, x0 + dir * 0.06, y, w.front), 0.04, 0.05, 6);
    b.cylinderX('trim', at(frame, x1 - dir * 0.07, y, w.front), 0.04, 0.05, 6);
    b.color(COLOURS.driveline);
  }

  // Electric fan in its shroud behind the radiator.
  const fl = floorY(frame, support);
  const fanY = (fl + ceiling(frame, support, support + 0.1, 0.3)) / 2 - 0.02;
  const fanS = radiatorBack + 0.035;
  b.color(COLOURS.black);
  b.cylinderZ('trim', at(frame, -0.08, fanY, fanS), 0.15, 0.03, 12, false);
  b.cylinderZ('trim', at(frame, -0.08, fanY, fanS + 0.02), 0.05, 0.035, 8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const p = (r: number, wd: number): Vec3 => at(frame, -0.08 + Math.cos(a) * r - Math.sin(a) * wd, fanY + Math.sin(a) * r + Math.cos(a) * wd, fanS - 0.005);
    b.poly('trim', [p(0.05, -0.035), p(0.14, -0.04), p(0.14, 0.04), p(0.05, 0.035)]);
  }

  // Battery on the left in front of its tower; expansion tank and washer bottle right.
  const batteryEnd = w.front - TOWER_R - 0.03;
  const batteryStart = Math.max(support + 0.08, batteryEnd - 0.26);
  battery(b, frame, 1, inner, batteryStart, batteryEnd, ceiling(frame, batteryStart, batteryEnd, inner) - 0.02);
  const tankTop = ceiling(frame, cowl - 0.32, cowl - 0.14, inner) - 0.03;
  reservoir(b, frame, -inner + 0.01, -inner + 0.15, cowl - 0.32, cowl - 0.14, tankTop - 0.14, tankTop, COLOURS.black);
  const washerTop = ceiling(frame, support + 0.08, support + 0.22, inner) - 0.03;
  reservoir(b, frame, -inner + 0.01, -inner + 0.14, support + 0.08, support + 0.22, washerTop - 0.15, washerTop, COLOURS.capBlue);
  hose(b, frame, [[-0.2, 0, radiatorBack], [-0.25, -0.03, radiatorBack + 0.1], [engineX - L / 2 + 0.04, -0.08, sMid - 0.1]], ceiling(frame, support, sMid, 0.3) - 0.03);

  return { outlet: [outletCar.x, outletCar.y, outletCar.z], crankY: crank.y, engineX };
}

/** A radiator hose: points as (x, drop below `topY`, s). */
function hose(b: PartBuilder, frame: BodyFrame, points: readonly Vec3[], topY: number): void {
  b.color(COLOURS.black);
  tube(b, 'trim', points.map(([x, dy, s]) => at(frame, x, topY + dy, s)), 0.02, 5);
}

/**
 * A casing round an axis along the car, tapering from (rx0, ry0) at s0 to (rx1, ry1)
 * at s1; its bottom radius is kept above the clearance by the callers.
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
  b.color(colour).bridge(slot, ring(s0, rx0, ry0), ring(s1, rx1, ry1), true);
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
  const s1 = spec.bootEnd! + 0.008;
  const inner = frame.wellX(w.rear) - WELL_GAP;
  const shelf = w.radius * (1 + w.arch) + WELL_GAP;
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

  // Spare: upright against the right side, as far forward as the bulkhead allows.
  const R = w.radius;
  const half = w.width / 2;
  const spareX = -(inner - half - 0.012);
  const spareS = s0 + 0.02 + R;
  const spareTop = ceiling(frame, spareS - R, spareS + R, inner) - 0.01;
  const spareY = Math.max(CLEARANCE + 0.008 + R, spareTop - R);
  b.push(new THREE.Matrix4().makeTranslation(spareX, spareY, frame.z(spareS)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  b.push(new THREE.Matrix4().makeScale(1, half / 0.07, 1));
  b.color(COLOURS.black).torusY('tyre', R - 0.068, 0.068, 12, 6);
  b.pop();
  b.color(COLOURS.spareRim).cylinderY('trim', [0, 0, 0], R * 0.62, half * 0.7, 10);
  b.cylinderY('chrome', [0, half * 0.7, 0], 0.05, 0.012, 6);
  b.pop();
  // Its well: open at the floor, closed below it.
  const wellIn = spareX + half + 0.012;
  const well0 = spareS - R - 0.01;
  const well1 = spareS + R + 0.01;
  boxS(b, frame, 'paint', [-inner, spareY - R - 0.006, well0], [wellIn, floor, well1], 0b111011);
  floorQuad(wellIn, inner, s0, s1);
  floorQuad(-inner, wellIn, s0, well0);
  floorQuad(-inner, wellIn, well1, s1);
  // A rubber mat over the empty middle, where the luggage stands.
  b.color(COLOURS.black);
  b.quad('trim', at(frame, wellIn + 0.03, floor + 0.004, s0 + 0.03), at(frame, inner - 0.03, floor + 0.004, s0 + 0.03), at(frame, inner - 0.03, floor + 0.004, s1 - 0.03), at(frame, wellIn + 0.03, floor + 0.004, s1 - 0.03));

  // Fuel tank on the right wing's shelf over the arch, its neck out to the filler.
  const t0 = s0 + 0.03;
  const t1 = Math.min(s1 - 0.05, s0 + 0.45);
  let edge = Infinity;
  for (const s of stationsBetween(frame, t0, t1)) edge = Math.min(edge, lidEdge(frame, s));
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
 * and trimmed sides up to the belt. The spare lives under the floor, out of sight, so
 * the space is left empty.
 */
function buildHatchBoot(frame: BodyFrame, b: PartBuilder): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const st = spec.stations;
  const s0 = loadSpaceStart(frame);
  const s1 = st[st.length - 1]!.s - 0.008;
  const inner = frame.wellX(w.rear) - WELL_GAP;
  // Under the tailgate's sill, but never under the floor pan: an estate's sill is low.
  const floor = Math.max(frame.deckY(frame.rearBase, 0) - HATCH_SILL_DROP, frame.station(frame.rearBase).sill + LOAD_FLOOR_RISE);
  const shelf = Math.max(w.radius * (1 + w.arch) + WELL_GAP, floor + 0.05);
  b.color(COLOURS.bootTrim);
  b.quad('trim', at(frame, -inner, floor, s0), at(frame, inner, floor, s0), at(frame, inner, floor, s1), at(frame, -inner, floor, s1));
  for (const side of [1, -1]) {
    loft(b, 'trim', frame, stationsBetween(frame, s0, s1), side, (s) => {
      const belt = frame.station(s).belt - 0.02;
      return [[inner, floor], [inner, shelf], [frame.sideX(s, shelf) - 0.08, shelf], [frame.sideX(s, belt) - 0.08, belt]];
    });
  }
}

// ---------------------------------------------------------------------------------
// Underbody
// ---------------------------------------------------------------------------------

/** Floor rails and the seat crossmembers: half spacing and section. */
const RAIL_X = 0.42;
const RAIL_HALF = 0.035;

function buildUnderbody(frame: BodyFrame, b: PartBuilder, classic: boolean, route: BayRoute): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const cowl = frame.cowl;

  // ---- floor rails and crossmembers (the tunnel's width left free between halves) ----
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

  if (classic) classicChassis(frame, b, route);
  else samaraChassis(frame, b, route);
}

/** Exhaust from the manifold's outlet: down-pipe, resonator, silencer at CLEARANCE, tail pipe out at the right rear. */
function exhaust(frame: BodyFrame, b: PartBuilder, down: readonly Vec3[], x: number, y: number, resonator: readonly [number, number], silencer: readonly [number, number], silencerX: number): void {
  const spec = frame.spec;
  b.color(COLOURS.exhaust);
  tube(b, 'trim', [...down, at(frame, x, y, resonator[0])], 0.022, 6);
  bevelS(b, frame, 'trim', [x - 0.075, CLEARANCE + 0.006, resonator[0]], [x + 0.075, y + 0.04, resonator[1]], 0.025);
  tube(b, 'trim', [at(frame, x, y, resonator[1]), at(frame, x, y, silencer[0] - 0.25), at(frame, silencerX, y, silencer[0])], 0.022, 6);
  bevelS(b, frame, 'trim', [silencerX - 0.13, CLEARANCE, silencer[0]], [silencerX + 0.13, CLEARANCE + 0.085, silencer[1]], 0.035);
  const tail = spec.stations[spec.stations.length - 1]!.s;
  tube(b, 'trim', [at(frame, silencerX - 0.03, y + 0.007, silencer[1]), at(frame, silencerX - 0.08, y + 0.03, tail - 0.05), at(frame, -0.45, y + 0.045, spec.length - 0.03)], 0.022, 6);
}

/**
 * The classic's underside: the front beam and wishbones with the anti-roll bar, the
 * gearbox and propshaft in the tunnel, and the live rear axle on four trailing links and
 * a Panhard rod, its differential hanging lowest at CLEARANCE.
 */
function classicChassis(frame: BodyFrame, b: PartBuilder, route: BayRoute): void {
  const spec = frame.spec;
  const w = spec.wheels;
  const cowl = frame.cowl;
  const R = w.radius;

  // Front beam under the engine, between the wishbones' inner pivots.
  const cs = w.front - CROSSMEMBER_AHEAD;
  const cf = floorY(frame, cs);
  b.color(COLOURS.underseal);
  across(b, frame, 'trim', [[cs - 0.045, cf], [cs - 0.035, cf - 0.05], [cs + 0.035, cf - 0.05], [cs + 0.045, cf]], -0.47, 0.47);
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

  // Gearbox on from the bellhousing, propshaft to the pinion.
  const x = route.engineX;
  const cy = route.crankY;
  const gearEnd = cowl + 0.45;
  taper(b, frame, 'trim', COLOURS.alloy, x, cy, cowl + 0.02, 0.11, cy - CLEARANCE - 0.012, gearEnd, 0.07, 0.065, 8);
  const pinionY = R - 0.035;
  const pinionS = w.rear - 0.16;
  b.color(COLOURS.driveline);
  b.cylinderZ('trim', at(frame, x, cy, gearEnd + 0.02), 0.06, 0.02, 8);
  rod(b, 'trim', at(frame, x, cy, gearEnd + 0.04), at(frame, 0, pinionY, pinionS), 0.032, 6);
  const mid = (gearEnd + pinionS) / 2;
  boxS(b, frame, 'trim', [-0.06, (cy + pinionY) / 2 - 0.03, mid - 0.03], [0.06, floorY(frame, mid), mid + 0.03]);

  // Live axle: tubes, the differential (its bottom at CLEARANCE), the pinion nose.
  b.color(COLOURS.driveline);
  b.cylinderX('trim', at(frame, 0, R, w.rear), 0.035, w.rearHalfTrack - 0.06, 6);
  const diff = R - CLEARANCE;
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

  // Exhaust along the right of the tunnel, under the axle, out at the right rear.
  const ex = -0.17;
  const ey = CLEARANCE + 0.035;
  const o = route.outlet;
  const os = frame.zNose - o[2];
  exhaust(
    frame,
    b,
    [o, at(frame, o[0] - 0.01, (o[1] + floorY(frame, cowl)) / 2, os + 0.06), at(frame, ex, ey + 0.02, cowl + 0.05), at(frame, ex, ey, cowl + 0.25)],
    ex,
    ey,
    [cowl + 0.55, cowl + 1.0],
    // Short of the tail panel: the boot lid's end on a saloon, the body's last station on an estate.
    [w.rear + 0.21, Math.min(w.rear + 0.78, (spec.bootEnd ?? spec.stations[spec.stations.length - 1]!.s) - 0.2)],
    ex,
  );
}

/**
 * The Samara's underside: MacPherson lower arms with their braces and the anti-roll
 * bar, the fuel tank under the rear seat, and the twist beam on its trailing arms with
 * the springs over them; the silencer hangs lowest at CLEARANCE.
 */
function samaraChassis(frame: BodyFrame, b: PartBuilder, route: BayRoute): void {
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
  bevelS(b, frame, 'trim', [-0.45, CLEARANCE + 0.03, t0], [-0.04, tf - 0.002, t1], 0.03);
  b.color(COLOURS.underseal);
  for (const s of [t0 + 0.07, t1 - 0.07]) boxS(b, frame, 'trim', [-0.47, CLEARANCE + 0.024, s - 0.015], [-0.02, CLEARANCE + 0.03, s + 0.015]);

  // Twist beam: trailing arms from their pivots to the hubs, the beam across them, a
  // spring and damper on each arm.
  const pivotS = w.rear - 0.45;
  const beamS = w.rear - 0.2;
  const hub = w.rearHalfTrack - 0.08;
  const bf = floorY(frame, beamS);
  for (const side of [1, -1]) {
    const pf = floorY(frame, pivotS);
    boxS(b, frame, 'trim', [side * 0.53, pf - 0.05, pivotS - 0.03], [side * 0.59, pf, pivotS + 0.03]);
    rod(b, 'trim', at(frame, side * 0.56, pf - 0.03, pivotS), at(frame, side * hub, R - 0.01, w.rear), 0.025, 6);
    const springX = side * (frame.wellX(w.rear) - 0.07);
    boxS(b, frame, 'trim', [Math.min(springX, side * hub), R - 0.02, w.rear - 0.07], [Math.max(springX, side * hub), R + 0.005, w.rear + 0.03]);
    coil(b, at(frame, springX, R + 0.005, w.rear - 0.02), 0.17, 0.05, 3);
    b.color(COLOURS.black);
    rod(b, 'trim', at(frame, springX, R, w.rear - 0.02), at(frame, springX, R + 0.2, w.rear - 0.02), 0.02, 5);
    b.color(COLOURS.underseal);
  }
  across(b, frame, 'trim', [[beamS - 0.04, bf - 0.005], [beamS - 0.03, bf - 0.055], [beamS + 0.03, bf - 0.055], [beamS + 0.04, bf - 0.005]], -0.575, 0.575);

  // Exhaust: down behind the engine, along the left of centre past the tank, under the
  // beam, then across to the silencer on the right.
  const ex = 0.06;
  const ey = CLEARANCE + 0.022;
  const o = route.outlet;
  const os = frame.zNose - o[2];
  const tail = spec.stations[spec.stations.length - 1]!.s;
  exhaust(
    frame,
    b,
    [o, at(frame, o[0] + 0.02, (o[1] + ey) / 2 + 0.05, os + 0.12), at(frame, ex, ey + 0.015, os + 0.35), at(frame, ex, ey, cowl + 0.2)],
    ex,
    ey,
    [cowl + 0.5, cowl + 0.9],
    [w.rear + 0.12, Math.min(w.rear + 0.5, tail - 0.2)],
    -0.3,
  );
}
