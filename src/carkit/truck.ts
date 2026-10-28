/**
 * A truck round its shell (`platform: 'truck'`, `KitCarSpec.truck`): the shell (body.ts)
 * is the cab alone, or a van's whole body, standing on the ladder frame; this module
 * builds everything else from `TruckSpec`, the same pieces for every truck, sized by it:
 *
 *  - chassis, on the root, drawn at every distance (a truck's frame is half its side
 *    view): the two channel rails and their cross members, the front beam axle and the
 *    rear axle's housing, leaf springs, the steps, the fuel tank with its filler neck, the
 *    exhaust's silencer and tail pipe, mud flaps, the rear lamps on brackets at the frame's end;
 *  - the tank's cap, hinged at its outer edge (`flap`, the car's fuel flap channel), and
 *    the `KIT_FILLER_NODE` box over the neck a can pours into;
 *  - a bonneted truck's front (`TruckSpec.front`: bumper, face, wings, bonnet, roof
 *    markers), from its own module (zilfront.ts, the ZIL-130's); a cab-over truck's nose
 *    is its shell's;
 *  - the platform: the floor on two sills over the rails, a dark steel beam round its
 *    edge under it, a toolbox under its front on the left, the fixed front board and three
 *    drop boards hinged at their bottom edges (`board_l`, `board_r`, `board_tail`);
 *  - a canvas tent over it on hoops, its tail flap rolling up (`tent_flap`);
 *  - the four `KIT_BONNET_CELL_NODE` cells (bay.ts), as a car's: the bonnet's grid (or the
 *    engine cover's, in a cab-over's cabin) draws the fitted engine, turbine, radiator and
 *    air filter in them; `kit_under` (gearbox and propeller shaft), drawn near only
 *    (rig.ts `KIT_DETAIL_GROUPS`).
 *
 * Everything is plain boxes, prisms and lofts: "a schematic parody" (README). Shapes stand
 * clear of one another or meet edge to edge, never in one plane.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, type KitSlot, type Vec3 } from './builder';
import { CELL_KINDS, cellMarker } from './bay';
import { addBuilt, pivotGroup, type KitContext } from './context';
import { KIT_FILLER_NODE } from './exterior';
import type { KitMotion } from './rig';
import type { TruckSpec } from './spec';
import { BLACK, RUBBER, STEEL, bar, cap, sweep } from './truckparts';
import { buildTruckFront, underTruckBonnet } from './zilfront';

const ORIGIN: Vec3 = [0, 0, 0];

/** The tank's filler: the neck's radius and height over the tank, the cap's radius and half thickness. */
const NECK_R = 0.035;
const NECK_H = 0.035;
const CAP_R = 0.045;
const CAP_HALF = 0.012;
/** How far the cap swings up and out about its hinge, radians. */
const CAP_OPEN = 1.9;
/** The filler's aim box over the neck: half width and height. */
const FILLER_HALF = 0.06;
const FILLER_H = 0.08;

/** Channel rails: web and flange thickness. */
const WEB = 0.007;
const FLANGE_T = 0.008;
/** The sills under the platform, along the rails: dark, oiled wood [P R34; E]. */
const SILL = 0x3a2f26;
/** The toolbox's face, a shade lighter than the beam it stands out of [O]. */
const TOOLBOX = 0x2c2e30;
/**
 * The platform's steel, whatever the cab's paint (owner, 2026-10-28: like a trailer's):
 * the drop boards bare grey steel, the floor dark worn plate.
 */
const BOARD_STEEL = 0x6c706e;
const FLOOR_DARK = 0x2a2b2a;
/** A drop board's thickness, inner face to the ribs' tops; the hinge line 2 cm under the floor's top. */
const BOARD = 0.06;
const HINGE_DROP = 0.02;
/** Gap round a moving board. */
const GAP = 0.003;
/** How far the boards turn down: about 166°, hanging outside the platform's beams. */
const BOARD_DROP = 2.9;
/** The platform's floor plate; its beam's width, standing in 2 cm from the platform's edge. */
const FLOOR_T = 0.04;
const BEAM_W = 0.08;
const BEAM_IN = 0.02;
/** The tent's canvas: its thickness, the hoops' half section, the segments round each roof edge. */
const CANVAS = 0.008;
const HOOP = 0.012;
const TENT_ROUND_STEPS = 4;
/** How far the tent's tail flap swings up and back about the roof's rear edge, radians. */
const FLAP_OPEN = 1.45;
/** The hoops' colour: painted steel, darker than the canvas. */
const HOOP_STEEL = 0x3c3f3d;

const LABELS: Readonly<Record<string, string>> = {
  board_l: 'Левый борт',
  board_r: 'Правый борт',
  board_tail: 'Задний борт',
  tent_flap: 'Задний полог тента',
};

export function buildTruck(ctx: KitContext): void {
  const t = ctx.frame.spec.truck;
  if (!t) throw new Error(`Kit car "${ctx.frame.spec.id}": platform 'truck' needs a truck spec`);
  new Truck(ctx, t).build();
}

class Truck {
  private readonly frame;
  private readonly chassis = new PartBuilder();
  private readonly front = new PartBuilder();
  private readonly deck = new PartBuilder();

  constructor(private readonly ctx: KitContext, private readonly t: TruckSpec) {
    this.frame = ctx.frame;
  }

  private P(x: number, y: number, s: number): Vec3 {
    return [x, y, this.frame.z(s)];
  }

  build(): void {
    const t = this.t;
    this.rails();
    this.axles();
    this.springs();
    if (t.step) this.steps(t.step);
    this.tank();
    this.exhaust();
    if (t.flaps) this.flaps(t.flaps);
    if (t.rearLamps) this.rearLamps(t.rearLamps);
    if (t.platform) this.platform(t.platform);
    const root = this.ctx.root;
    addBuilt(root, this.chassis, ORIGIN, 'chassis');
    if (t.front) {
      buildTruckFront(this.ctx, t.front, this.front);
      addBuilt(root, this.front, ORIGIN, 'front');
    }
    if (t.platform) {
      addBuilt(root, this.deck, ORIGIN, 'platform');
      this.boards(t.platform);
      if (t.tent) this.tent(t.platform, t.tent);
    }
    this.bay();
  }

  // ---- lookups ----

  /** The rails' top at s. */
  private railTop(s: number): number {
    const f = this.t.frame;
    return lerp(f.top[0], f.top[1], (s - f.s0) / (f.s1 - f.s0));
  }

  // ---- chassis ----

  /** Two channel rails, their open sides facing in, and the cross members between them. */
  private rails(): void {
    const f = this.t.frame;
    const b = this.chassis.color(BLACK);
    for (const side of [1, -1]) {
      const section = (s: number): Vec3[] => {
        const yt = this.railTop(s);
        const yb = yt - f.depth;
        const x = (d: number): number => side * (f.half - d);
        return [
          [x(0), yb], [x(0), yt], [x(f.flange), yt], [x(f.flange), yt - FLANGE_T],
          [x(WEB), yt - FLANGE_T], [x(WEB), yb + FLANGE_T], [x(f.flange), yb + FLANGE_T], [x(f.flange), yb],
        ].map(([px, py]) => this.P(px!, py!, s));
      };
      const a = section(f.s0);
      const c = section(f.s1);
      b.bridge('trim', a, c, true);
      cap(b, 'trim', a);
      cap(b, 'trim', c);
    }
    for (const s of f.cross) {
      const yt = this.railTop(s) - 0.03;
      // Its ends sunk into the rails' webs: no face in the web's plane.
      const x = f.half - WEB / 2;
      b.boxFrom('trim', this.P(-x, yt - 0.13, s + 0.035), this.P(x, yt, s - 0.035));
    }
  }

  /** The front beam axle (dropped in the middle) and the rear axle's housing with its differential. */
  private axles(): void {
    const w = this.frame.spec.wheels;
    const b = this.chassis.color(BLACK);
    const r = w.radius;
    const fx = w.frontHalfTrack - w.width / 2 - 0.04;
    const pts: Vec3[] = [this.P(fx, r, w.front), this.P(0.45, r - 0.07, w.front), this.P(-0.45, r - 0.07, w.front), this.P(-fx, r, w.front)];
    for (let i = 0; i + 1 < pts.length; i++) bar(b, 'trim', pts[i]!, pts[i + 1]!, 0.04, 0.05);
    // Kingpins and stub axles into the hubs.
    for (const side of [1, -1]) {
      b.cylinderY('trim', this.P(side * fx, r, w.front), 0.035, 0.08, 8);
      b.cylinderX('trim', this.P(side * (fx + 0.06), r, w.front), 0.045, 0.06, 8);
    }
    const rx = w.rearHalfTrack - 0.05;
    b.cylinderX('trim', this.P(0, r, w.rear), 0.065, rx, 8);
    b.bevelBox('trim', this.P(0, r - 0.01, w.rear - 0.05), [0.19, 0.17, 0.17], 0.06);
    // Gearbox behind the engine under the cab's floor, the propeller shaft to the axle (`kit_under`).
    const under = new PartBuilder().color(BLACK);
    const engine = this.t.bay.engine;
    const gy = this.t.driveline.y;
    under.bevelBox('trim', this.P(0, gy, engine.s[1] + 0.27), [0.16, 0.13, 0.25], 0.04);
    under.color(STEEL);
    bar(under, 'trim', this.P(0, gy - 0.04, engine.s[1] + 0.5), this.P(0, r + 0.02, w.rear - 0.22), 0.035, 0.035);
    const group = new THREE.Group();
    group.name = 'kit_under';
    addBuilt(group, under, ORIGIN, 'under', true);
    this.ctx.root.add(group);
  }

  /** Leaf springs under the rails, bowed down onto the axles, with their hangers. */
  private springs(): void {
    const f = this.t.frame;
    const w = this.frame.spec.wheels;
    const b = this.chassis.color(BLACK);
    const x = f.half - f.flange / 2;
    for (const [[s0, s1], axle, onAxle] of [
      [this.t.springs.front, w.front, w.radius - 0.02],
      [this.t.springs.rear, w.rear, w.radius + 0.07],
    ] as const) {
      for (const side of [1, -1]) {
        const end = (s: number): Vec3 => this.P(side * x, this.railTop(s) - f.depth - 0.05, s);
        const mid = this.P(side * x, onAxle + 0.04, axle);
        bar(b, 'trim', end(s0), mid, 0.04, 0.03);
        bar(b, 'trim', mid, end(s1), 0.04, 0.03);
        // The hangers from the rail's bottom flange to the eyes.
        for (const s of [s0, s1]) b.box('trim', this.P(side * x, this.railTop(s) - f.depth - 0.025, s), [0.025, 0.03, 0.025]);
        // The U-bolts' pad on the axle.
        b.box('trim', this.P(side * x, onAxle + 0.005, axle), [0.05, 0.03, 0.08]);
      }
    }
  }

  /** A step under each door: a tread and the plate it hangs from. */
  private steps(st: NonNullable<TruckSpec['step']>): void {
    const f = this.t.frame;
    const b = this.chassis.color(BLACK);
    const sill = this.frame.station((st.s[0] + st.s[1]) / 2).sill;
    for (const side of [1, -1]) {
      const x0 = f.half + 0.01;
      b.boxFrom('trim', this.P(side * x0, st.y, st.s[1]), this.P(side * st.out, st.y + 0.03, st.s[0]));
      b.boxFrom('trim', this.P(side * (st.out - 0.012), st.y + 0.03, st.s[1] - 0.04), this.P(side * st.out, sill - 0.004, st.s[0] + 0.04));
      // Its hangers up into the rail's bottom flange.
      for (const s of [st.s[0] + 0.06, st.s[1] - 0.06]) b.boxFrom('trim', this.P(side * (f.half - 0.03), st.y + 0.03, s + 0.02), this.P(side * (st.out - 0.012), this.railTop(s) - f.depth + 0.005, s - 0.02));
    }
  }

  /**
   * The fuel tank outside the left rail on two straps; on its top the filler neck, its
   * cap hinged at its outer edge (`flap`), and the filler's aim box over the neck, unless
   * the shell's own flap fills it.
   */
  private tank(): void {
    const k = this.t.tank;
    const f = this.t.frame;
    const b = this.chassis.color(BLACK);
    const x0 = f.half + 0.03;
    const cx = (x0 + k.out) / 2;
    const hx = (k.out - x0) / 2;
    const cy = (k.y[0] + k.y[1]) / 2;
    const hy = (k.y[1] - k.y[0]) / 2;
    const s = (k.s[0] + k.s[1]) / 2;
    b.bevelBox('trim', this.P(cx, cy, s), [hx, hy, (k.s[1] - k.s[0]) / 2], 0.06);
    for (const sx of [k.s[0] + 0.15, k.s[1] - 0.15]) {
      // No face against the rail's web.
      b.boxFrom('trim', this.P(f.half, k.y[0] - 0.006, sx + 0.02), this.P(k.out + 0.006, k.y[1] + 0.006, sx - 0.02), 0b111101);
    }
    if (!k.cap) return;
    // The neck 5 mm down in the tank's top; the cap on it, its hinge at its outer edge.
    const [capS, capX] = k.cap;
    const neckTop = k.y[1] + NECK_H;
    b.cylinderY('trim', this.P(capX, (k.y[1] - 0.005 + neckTop) / 2, capS), NECK_R, (NECK_H + 0.005) / 2, 8);
    const hinge = this.P(capX + CAP_R, neckTop, capS);
    const cap = new PartBuilder().color(BLACK);
    cap.cylinderY('trim', this.P(capX, neckTop + 0.002 + CAP_HALF, capS), CAP_R, CAP_HALF, 10);
    const motion: KitMotion = { channel: 'flap', kind: 'rot', axis: [0, 0, 1], amount: -CAP_OPEN };
    const node = pivotGroup('flap', hinge, motion, { id: 'flap', label: 'Крышка бензобака' });
    addBuilt(node, cap, hinge, 'flap');
    this.ctx.root.add(node);
    const marker = new THREE.Object3D();
    marker.name = KIT_FILLER_NODE;
    marker.position.set(capX, neckTop + FILLER_H / 2, this.frame.z(capS));
    marker.scale.set(2 * FILLER_HALF, FILLER_H, 2 * FILLER_HALF);
    this.ctx.root.add(marker);
  }

  /** The down pipe from the engine's rear, the silencer on the run along the frame and the tail pipe turned out ahead of the rear wheels. */
  private exhaust(): void {
    const e = this.t.exhaust;
    const w = this.frame.spec.wheels;
    const b = this.chassis.color(STEEL);
    const { x, y } = e;
    const engine = this.t.bay.engine;
    bar(b, 'trim', this.P(x - 0.06, e.top, engine.s[1] - 0.1), this.P(x, y, engine.s[1] + 0.35), 0.03, 0.03);
    bar(b, 'trim', this.P(x, y, engine.s[1] + 0.35), this.P(x, y, e.silencer[0]), 0.03, 0.03);
    b.cylinderZ('trim', this.P(x, y, (e.silencer[0] + e.silencer[1]) / 2), 0.11, (e.silencer[1] - e.silencer[0]) / 2, 10);
    bar(b, 'trim', this.P(x, y, e.silencer[1]), this.P(x, y, e.tail), 0.025, 0.025);
    const out = -(w.rearHalfTrack - w.width - 0.02);
    bar(b, 'trim', this.P(x, y, e.tail), this.P(out, y - 0.08, e.tail + 0.06), 0.025, 0.025);
  }

  /**
   * Rubber mud flaps either side of each rear wheel, hung from a bar under the platform's
   * beam, each leaning away from the wheel at its foot (`flaps.lean`) [owner's photo of
   * the 130, 2026-10-29].
   */
  private flaps(m: NonNullable<TruckSpec['flaps']>): void {
    const b = this.chassis;
    const mid = (m.x[0] + m.x[1]) / 2;
    const hw = (m.x[1] - m.x[0]) / 2;
    for (const side of [1, -1]) {
      for (const [s, away] of [[m.s[0], -1], [m.s[1], 1]] as const) {
        const top = this.P(side * mid, m.y[1], s);
        const foot = this.P(side * mid, m.y[0], s + away * m.lean);
        bar(b.color(RUBBER), 'tyre', top, foot, hw, 0.006, [0, 0, 1]);
        b.color(BLACK).boxFrom('trim', this.P(side * m.x[0], m.y[1], s + 0.02), this.P(side * m.x[1], m.y[1] + 0.03, s - 0.02));
      }
    }
  }

  /**
   * The rear lamp units on brackets at the frame's end, and its rear cross member with the
   * hitch: each a black housing, its back to the rear, the lenses on it from the outer
   * end (`rearLamps.cells`), the reversing lamp on the units of `rearLamps.reverse`.
   */
  private rearLamps(lamps: NonNullable<TruckSpec['rearLamps']>): void {
    const [s, x, y] = lamps.at;
    const [hx, hy] = lamps.half;
    const f = this.t.frame;
    const b = this.chassis;
    const top = this.railTop(f.s1);
    b.color(BLACK);
    b.boxFrom('trim', this.P(-(f.half + 0.03), top - f.depth, f.s1 + 0.06), this.P(f.half + 0.03, top, f.s1 - 0.01));
    b.cylinderZ('trim', this.P(0, top - f.depth / 2, f.s1 + 0.1), 0.04, 0.05, 8);
    for (const side of [1, -1]) {
      // Black on both sides: the left unit's lenses leave the builder white.
      bar(b.color(BLACK), 'trim', this.P(side * f.half, top - f.depth / 2, f.s1 + 0.03), this.P(side * (x - (hx - 0.03)), y, s + 0.02), 0.015, 0.02);
      const hz = 0.035;
      b.color(BLACK).box('trim', this.P(side * x, y, s), [hx, hy, hz]);
      const reverse = lamps.reverse === 'both' || side > 0;
      const cells = lamps.cells.filter(([role]) => role !== 'reverse' || reverse);
      let edge = side * (x + hx - 0.01);
      for (const [role, width] of cells) {
        const slot: KitSlot = role === 'blinker' ? (side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r') : `lamp_${role}`;
        const c = edge - (side * width) / 2;
        b.color(0xffffff).box(slot, this.P(c, y, s + hz + 0.004), [width / 2 - 0.004, hy - 0.015, 0.006]);
        edge -= side * width;
      }
    }
  }

  // ---- the platform ----

  /**
   * The floor on two sills over the rails, a dark beam round its edge, the toolbox, the
   * fixed front board. From the side the beam is one dark band under the boards along the
   * whole platform [O]; the sills and the frame show under it. Each part reaches a little
   * into what it carries, or stops short of it: no two faces in one plane.
   */
  private platform(pl: NonNullable<TruckSpec['platform']>): void {
    const f = this.t.frame;
    const b = this.deck;
    const y = pl.floor;
    const under = y - FLOOR_T;
    const low = y - pl.beam;
    const bx0 = pl.half - BEAM_IN - BEAM_W;
    const bx1 = pl.half - BEAM_IN;
    // The floor plate reaches to 3 cm inside the beam's face and 2 cm inside its ends; its
    // long sides are left open, closed by the beam's lip.
    const fx = bx1 - 0.03;
    b.color(FLOOR_DARK);
    sweep(b, 'trim', [[-fx, under], [fx, under], [fx, y], [-fx, y]], (s, [x, py]) => this.P(x, py, s), pl.s0 + 0.02, pl.s1 - 0.02, true, [1, 3]);
    b.color(BLACK);
    for (const side of [1, -1]) {
      // Its body 1 cm up into the plate; outside the plate a lip up to 4 mm under the
      // floor's top, so from the side the beam runs dark right up under the boards.
      const section: [number, number][] = [[bx0, low], [bx1, low], [bx1, y - 0.004], [fx, y - 0.004], [fx, under + 0.01], [bx0, under + 0.01]];
      sweep(b, 'trim', section.map(([x, py]) => [side * x, py]), (s, [x, py]) => this.P(x, py, s), pl.s0 + 0.01, pl.s1 - 0.01);
    }
    // Across the ends between the side beams, 1 cm into them (their ends hidden there).
    // Every face parallel to another stands 1 cm or more off it (kit-zfight's far band).
    for (const [s0, s1] of [[pl.s0 + 0.03, pl.s0 + 0.03 + BEAM_W], [pl.s1 - 0.03 - BEAM_W, pl.s1 - 0.03]] as const) {
      sweep(b, 'trim', [[s0, low + 0.01], [s1, low + 0.01], [s1, under + 0.025], [s0, under + 0.025]], (x, [s, py]) => this.P(x, py, s), -(bx0 + 0.01), bx0 + 0.01, false);
    }
    // The sills along the rails, 2 mm over the rails' tops up into the floor plate, inset
    // 8 mm from the flanges' edges; between the end beams, short of the frame's rear member.
    b.color(SILL);
    const xo = f.half - 0.008;
    const xi = f.half - f.flange + 0.008;
    for (const side of [1, -1]) {
      sweep(b, 'trim', [[side * xi, 0], [side * xo, 0], [side * xo, 1], [side * xi, 1]], (s, [x, k]) => this.P(x, lerp(this.railTop(s) + 0.002, under + 0.01, k), s), pl.s0 + 0.12, Math.min(pl.s1 - 0.12, f.s1 - 0.03));
    }
    // The toolbox under the front on the left, its face 1.5 cm out of the beam's.
    const tb = this.t.toolbox;
    if (tb) b.color(TOOLBOX).boxFrom('trim', this.P(tb.inner, tb.y[0], tb.s[1]), this.P(pl.half - 0.005, tb.y[1], tb.s[0]));
    b.color(BLACK);
    // Hinge knuckles on the beams' outer edge, under each drop board.
    for (const side of [1, -1]) {
      for (const s of [pl.s0 + 0.5, (pl.s0 + pl.s1) / 2, pl.s1 - 0.5]) {
        b.cylinderZ('trim', this.P(side * (pl.half - 0.012), y - HINGE_DROP, s), 0.014, 0.04, 6);
      }
    }
    for (const x of [-(pl.half * 0.5), pl.half * 0.5]) b.cylinderX('trim', this.P(x, y - HINGE_DROP, pl.s1 - 0.012), 0.014, 0.04, 6);
    // The fixed front board, its ribs facing the cab.
    b.color(BOARD_STEEL);
    board(b, (u, v, w) => this.P(u, y + GAP + v * (pl.side - GAP), pl.s0 + BOARD - w * BOARD), -pl.half, pl.half, pl.ribs);
  }

  /** The two side boards and the tail board, each hinged at its bottom edge. */
  private boards(pl: NonNullable<TruckSpec['platform']>): void {
    const y = pl.floor;
    const hy = y - HINGE_DROP;
    const tailIn = pl.s1 - BOARD;
    for (const side of [1, -1]) {
      const name = side > 0 ? 'board_l' : 'board_r';
      const pivot = this.P(side * pl.half, hy, (pl.s0 + pl.s1) / 2);
      const node = pivotGroup(name, pivot, { channel: name, kind: 'rot', axis: [0, 0, 1], amount: -side * BOARD_DROP }, { id: name, label: LABELS[name]! });
      const b = new PartBuilder().color(BOARD_STEEL);
      // Along the board u runs s, w out from its inner face.
      board(b, (u, v, w) => this.P(side * (pl.inside + w * (pl.half - pl.inside - GAP)), y + GAP + v * (pl.side - GAP), u), pl.s0 + BOARD + GAP, tailIn - GAP, pl.ribs);
      addBuilt(node, b, pivot, name);
      this.ctx.root.add(node);
    }
    const pivot = this.P(0, hy, pl.s1);
    const node = pivotGroup('board_tail', pivot, { channel: 'board_tail', kind: 'rot', axis: [1, 0, 0], amount: -BOARD_DROP }, { id: 'board_tail', label: LABELS.board_tail! });
    const b = new PartBuilder().color(BOARD_STEEL);
    board(b, (u, v, w) => this.P(u, y + GAP + v * (pl.side - GAP), tailIn + w * (BOARD - GAP)), -(pl.half - GAP), pl.half - GAP, pl.ribs);
    addBuilt(node, b, pivot, 'board_tail');
    this.ctx.root.add(node);
  }

  /**
   * The tent over the platform (`TruckSpec.tent`): a canvas `CANVAS` thick swept along the
   * platform, its walls lapping down outside the boards and its roof's edges rolled, closed
   * at the front by a canvas wall in the middle of the band's thickness; steel hoops
   * inside it; the tail a canvas sheet hung from the roof's rear edge, rolling up and back
   * (`tent_flap`). The kit material is two-sided, so the wall and the flap are one sheet.
   * On the root, so the walls stay as a board drops (the real canvas is tied to the
   * hoops, not the boards).
   */
  private tent(pl: NonNullable<TruckSpec['platform']>, t: NonNullable<TruckSpec['tent']>): void {
    const X = pl.half + t.out;
    const y0 = pl.floor + pl.side - t.lap;
    const s0 = pl.s0 - t.out;
    const s1 = pl.s1 + t.out;
    /** The section's outline `inset` in from the canvas's outer face, from the left wall's foot over the roof to the right's. */
    const outline = (inset: number): [number, number][] => {
      const x = X - inset;
      const r = t.round - inset;
      const top = t.top - inset;
      const arc = Array.from({ length: TENT_ROUND_STEPS + 1 }, (_, i): [number, number] => {
        const a = (i / TENT_ROUND_STEPS) * (Math.PI / 2);
        return [x - r + Math.cos(a) * r, top - r + Math.sin(a) * r];
      });
      const right = arc.map(([px, py]): [number, number] => [-px, py]).reverse();
      return [[x, y0], ...arc, ...right, [-x, y0]];
    };
    const outer = outline(0);
    const inner = outline(CANVAS);
    // The canvas: one band, its outer face out and its inner face in, open at both ends.
    const b = new PartBuilder().color(t.colour);
    sweep(b, 'trim', [...outer, ...inner.slice().reverse()], (s, [x, py]) => this.P(x, py, s), s0, s1, false);
    sheet(b, outline(CANVAS / 2), (x, py) => this.P(x, py, s0 + CANVAS / 2));
    // The hoops inside it, from the boards' top over the roof.
    b.color(HOOP_STEEL);
    const hoop = outline(CANVAS + HOOP + 0.004).map(([x, py]): [number, number] => [x, Math.max(py, pl.floor + pl.side + 0.004)]);
    for (const s of t.hoops) {
      for (let i = 0; i + 1 < hoop.length; i++) bar(b, 'trim', this.P(hoop[i]![0], hoop[i]![1], s), this.P(hoop[i + 1]![0], hoop[i + 1]![1], s), HOOP, HOOP, [0, 0, 1]);
    }
    addBuilt(this.ctx.root, b, ORIGIN, 'tent');
    // The tail flap: one sheet over the whole outline, just behind the band's open end.
    const fs = s1 + 0.004;
    const pivot = this.P(0, t.top, fs);
    const node = pivotGroup('tent_flap', pivot, { channel: 'tent_flap', kind: 'rot', axis: [1, 0, 0], amount: FLAP_OPEN }, { id: 'tent_flap', label: LABELS.tent_flap! });
    const fb = new PartBuilder().color(t.colour);
    sheet(fb, outer, (x, py) => this.P(x, py, fs));
    addBuilt(node, fb, pivot, 'tent_flap');
    this.ctx.root.add(node);
  }

  // ---- the service cells ----

  /** The four service cells (`TruckSpec.bay`), each up to its own top or the closed bonnet over it. */
  private bay(): void {
    for (const kind of CELL_KINDS) {
      const c = this.t.bay[kind];
      const [s0, s1] = c.s;
      const top = c.top ?? (this.t.front ? underTruckBonnet(this.t.front, s0, s1) : undefined);
      if (top === undefined) throw new Error(`Kit car "${this.frame.spec.id}": truck cell ${kind} needs a top without a bonneted front`);
      this.ctx.root.add(cellMarker(this.frame, kind, { x0: c.x[0], x1: c.x[1], s0, s1, floor: c.floor, top }));
    }
  }
}

/**
 * A pressed steel board in bare grey steel (`BOARD_STEEL`, not the cab's paint), one section swept along it (`sweep`): the inner face (w
 * 0) up to a top rail the board's full thickness, the outer skin at w 0.6 with `ribs`
 * pressed ribs standing out to w 1. `at(u, v, w)`: u along the board (u0..u1), v up its
 * height (0 the bottom, 1 the top), w through it.
 */
function board(b: PartBuilder, at: (u: number, v: number, w: number) => Vec3, u0: number, u1: number, ribs: number): void {
  const rail = 0.07;
  const skin = 0.6;
  const section: [number, number][] = [[0, 0], [1, 0], [1, 1], [1 - rail, 1], [1 - rail, skin]];
  for (let i = ribs - 1; i >= 0; i--) {
    const v = ((i + 1) / (ribs + 1)) * (1 - rail);
    section.push([v + 0.035, skin], [v + 0.035, 1], [v - 0.035, 1], [v - 0.035, skin]);
  }
  section.push([0, skin]);
  sweep(b, 'trim', section, (u, [v, w]) => at(u, v, w), u0, u1);
}

/** One flat sheet over the closed outline `pts` (it may be concave), placed by `at`: seen from both sides (the kit material is two-sided). */
function sheet(b: PartBuilder, pts: readonly [number, number][], at: (x: number, y: number) => Vec3): void {
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
  for (const [i, j, k] of tris) b.tri('trim', at(...pts[i!]!), at(...pts[j!]!), at(...pts[k!]!));
}
