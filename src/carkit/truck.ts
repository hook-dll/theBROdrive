/**
 * A bonneted truck round its cab (`platform: 'truck'`, `KitCarSpec.truck`): the shell
 * (body.ts) is the cab alone, standing on the ladder frame between the axles; this module
 * builds everything else from `TruckSpec`.
 *
 *  - chassis, on the root, drawn at every distance (a truck's frame is half its side
 *    view): the two channel rails and their cross members, the front beam axle and the
 *    rear axle's housing, leaf springs, the steps, the fuel tank, the exhaust's silencer
 *    and tail pipe, mud flaps, the rear lamps on brackets at the frame's end;
 *  - the front: a black channel bumper with two tow hooks, the face panel between the
 *    wings with its slots and round lamps, the wings with their round arches;
 *  - `bonnet`, hinged at its rear edge (kit.ts `shellMotion`'s bonnet motion);
 *  - the platform: the floor on two sills over the rails, a dark steel beam round its
 *    edge under it, a toolbox under its front on the left, the fixed front board and three
 *    drop boards hinged at their bottom edges (`board_l`, `board_r`, `board_tail`);
 *  - `kit_bay` under the bonnet (the V8, the radiator) and `kit_under` (gearbox and
 *    propeller shaft), drawn near only (rig.ts `KIT_DETAIL_GROUPS`);
 *  - three amber marker lamps on the cab's roof.
 *
 * Everything is plain boxes, prisms and lofts: "a schematic parody" (README). Shapes stand
 * clear of one another or meet edge to edge, never in one plane.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, newell, type KitSlot, type Vec3 } from './builder';
import { addBuilt, pivotGroup, type KitContext } from './context';
import type { KitMotion } from './rig';
import type { TruckSpec } from './spec';

const ORIGIN: Vec3 = [0, 0, 0];
/** Chassis black: frame, axles, springs, bumper, steps, tank. */
const BLACK = 0x1d1e1f;
/** Wheel wells, slot backs, the inside of the lamps' rings. */
const DARK = 0x0d0e0f;
const RUBBER = 0x19191a;
/** Bare steel: the exhaust, the propeller shaft. */
const STEEL = 0x5a5c5e;
/** The engine's paint, a grey-green [E]. */
const ENGINE = 0x4a564b;
const RADIATOR = 0x2a2c2e;
/** The roof's marker lenses, amber, never lit [P F34]. */
const MARKER = 0xd4891e;

/** Channel rails: web and flange thickness. */
const WEB = 0.007;
const FLANGE_T = 0.008;
/** The sills under the platform, along the rails: dark, oiled wood [P R34; E]. */
const SILL = 0x3a2f26;
/** The toolbox's face, a shade lighter than the beam it stands out of [O]. */
const TOOLBOX = 0x2c2e30;
/** The wings' lip round the arch: how far it stands off the flank and how wide it rolls back onto it. */
const LIP_OUT = 0.03;
const LIP_WIDE = 0.06;
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
/**
 * The sharpest triangle a swept part's long faces may split into (`sweep`), clear of
 * kit-surface's 1° slivers: a board's rib 2-3 cm deep and 3.7 m long is cut in three.
 */
const SWEEP_ANGLE = (1.5 * Math.PI) / 180;
/** Segments round the wheel arches and round lamps. */
const ARCH_STEPS = 12;
const LAMP_STEPS = 16;

const LABELS: Readonly<Record<string, string>> = {
  board_l: 'Левый борт',
  board_r: 'Правый борт',
  board_tail: 'Задний борт',
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
    this.rails();
    this.axles();
    this.springs();
    this.steps();
    this.tank();
    this.exhaust();
    this.flaps();
    this.rearLamps();
    this.bumper();
    this.facePanel();
    for (const side of [1, -1]) this.wing(side);
    this.markers();
    this.platform();
    const root = this.ctx.root;
    addBuilt(root, this.chassis, ORIGIN, 'chassis');
    addBuilt(root, this.front, ORIGIN, 'front');
    addBuilt(root, this.deck, ORIGIN, 'platform');
    this.bonnet();
    this.boards();
    this.bay();
  }

  // ---- lookups ----

  /** The rails' top at s. */
  private railTop(s: number): number {
    const f = this.t.frame;
    return lerp(f.top[0], f.top[1], (s - f.s0) / (f.s1 - f.s0));
  }

  /** The bonnet's half width at s (its sides lean in towards the nose in plan). */
  private bonnetHalf(s: number): number {
    const b = this.t.bonnet;
    return lerp(b.half[0], b.half[1], Math.min(1, Math.max(0, (s - b.s0) / (b.s1 - b.s0))));
  }

  /** The bonnet's top on the centre line at s. */
  private bonnetTop(s: number): number {
    return tableAt(this.t.bonnet.top, s);
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
    under.bevelBox('trim', this.P(0, 0.76, engine.s[1] + 0.27), [0.16, 0.13, 0.25], 0.04);
    under.color(STEEL);
    bar(under, 'trim', this.P(0, 0.72, engine.s[1] + 0.5), this.P(0, r + 0.02, w.rear - 0.22), 0.035, 0.035);
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
  private steps(): void {
    const st = this.t.cab.step;
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

  /** The fuel tank outside the left rail on two straps, its filler cap on top. */
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
    b.cylinderY('trim', this.P(cx + hx * 0.4, k.y[1] + 0.02, k.s[0] + 0.2), 0.045, 0.025, 8);
  }

  /** The silencer inside the right rail and the tail pipe turned out ahead of the rear wheels. */
  private exhaust(): void {
    const e = this.t.exhaust;
    const w = this.frame.spec.wheels;
    const b = this.chassis.color(STEEL);
    const x = -0.24;
    const y = 0.55;
    const engine = this.t.bay.engine;
    bar(b, 'trim', this.P(-0.3, 0.8, engine.s[1] - 0.1), this.P(x, y, engine.s[1] + 0.35), 0.03, 0.03);
    bar(b, 'trim', this.P(x, y, engine.s[1] + 0.35), this.P(x, y, e.silencer[0]), 0.03, 0.03);
    b.cylinderZ('trim', this.P(x, y, (e.silencer[0] + e.silencer[1]) / 2), 0.11, (e.silencer[1] - e.silencer[0]) / 2, 10);
    bar(b, 'trim', this.P(x, y, e.silencer[1]), this.P(x, y, e.tail), 0.025, 0.025);
    const out = -(w.rearHalfTrack - w.width - 0.02);
    bar(b, 'trim', this.P(x, y, e.tail), this.P(out, y - 0.08, e.tail + 0.06), 0.025, 0.025);
  }

  /** Rubber mud flaps behind the rear wheels, on a bar from the platform's beam. */
  private flaps(): void {
    const m = this.t.flaps;
    const b = this.chassis;
    for (const side of [1, -1]) {
      b.color(RUBBER).boxFrom('tyre', this.P(side * m.x[0], m.y[0], m.s + 0.006), this.P(side * m.x[1], m.y[1], m.s - 0.006));
      b.color(BLACK).boxFrom('trim', this.P(side * m.x[0], m.y[1], m.s + 0.02), this.P(side * m.x[1], m.y[1] + 0.03, m.s - 0.02));
    }
  }

  /** The rear lamp units on brackets at the frame's end, and its rear cross member with the hitch. */
  private rearLamps(): void {
    const [s, x, y] = this.t.rearLamps;
    const f = this.t.frame;
    const b = this.chassis;
    const top = this.railTop(f.s1);
    b.color(BLACK);
    b.boxFrom('trim', this.P(-(f.half + 0.03), top - f.depth, f.s1 + 0.06), this.P(f.half + 0.03, top, f.s1 - 0.01));
    b.cylinderZ('trim', this.P(0, top - f.depth / 2, f.s1 + 0.1), 0.04, 0.05, 8);
    for (const side of [1, -1]) {
      bar(b, 'trim', this.P(side * f.half, top - f.depth / 2, f.s1 + 0.03), this.P(side * (x - 0.1), y, s + 0.02), 0.015, 0.02);
      // Housing, its back to the rear; lenses on it from the outer end: indicator, brake,
      // tail, and a reversing lamp on the left unit only [P R34].
      const hz = 0.035;
      b.color(BLACK).box('trim', this.P(side * x, y, s), [0.13, 0.05, hz]);
      const cells: [KitSlot, number][] = [
        [side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r', 0.07],
        ['lamp_brake', 0.06],
        ['lamp_tail', 0.06],
        ...(side > 0 ? [['lamp_reverse', 0.05] as [KitSlot, number]] : []),
      ];
      let edge = side * (x + 0.12);
      for (const [slot, width] of cells) {
        const c = edge - (side * width) / 2;
        b.color(0xffffff).box(slot, this.P(c, y, s + hz + 0.004), [width / 2 - 0.004, 0.035, 0.006]);
        edge -= side * width;
      }
    }
  }

  // ---- the front ----

  /** The black channel bumper and the two tow hooks on its top. */
  private bumper(): void {
    const k = this.t.bumper;
    const b = this.front.color(BLACK);
    const [y0, y1] = k.y;
    b.bevelBox('trim', this.P(0, (y0 + y1) / 2, k.depth / 2), [k.half, (y1 - y0) / 2, k.depth / 2], 0.012);
    for (const side of [1, -1]) {
      const x = side * k.hooks;
      const path: Vec3[] = [
        this.P(x, y1 - 0.01, 0.1),
        this.P(x, y1 + 0.06, 0.1),
        this.P(x, y1 + 0.1, 0.07),
        this.P(x, y1 + 0.1, 0.03),
        this.P(x, y1 + 0.06, 0.012),
        this.P(x, y1 + 0.035, 0.02),
      ];
      for (let i = 0; i + 1 < path.length; i++) bar(b, 'trim', path[i]!, path[i + 1]!, 0.014, 0.014, [1, 0, 0]);
    }
  }

  /**
   * The face panel: a plate across between the wings, its slots cut through it (each a
   * dark-backed recess) and round holes for the lamps, which stand in black rings.
   */
  private facePanel(): void {
    const p = this.t.face;
    const b = this.front;
    const z = this.frame.z(p.s);
    const zBack = this.frame.z(p.s + 0.03);
    const [y0, y1] = p.y;
    const h = p.half;
    const c = p.corner;
    const outline: [number, number][] = [[-h, y0], [h, y0], [h, y1 - c], [h - c, y1], [-(h - c), y1], [-h, y1 - c]];
    const holes: [number, number][][] = [];
    const recess = (x0: number, x1: number, ya: number, yb: number): void => {
      holes.push([[x0, ya], [x1, ya], [x1, yb], [x0, yb]]);
    };
    for (const row of p.slots) {
      const width = (2 * row.half - (row.count - 1) * row.gap) / row.count;
      for (let i = 0; i < row.count; i++) {
        const x0 = -row.half + i * (width + row.gap);
        recess(x0, x0 + width, row.y[0], row.y[1]);
      }
    }
    const lamps: [number, number, number, KitSlot][] = [];
    for (const side of [1, -1]) {
      lamps.push([side * p.head[0], p.head[1], p.head[2], 'lamp_head']);
      lamps.push([side * p.blinker[0], p.blinker[1], p.blinker[2], side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r']);
    }
    const ring = (x: number, y: number, r: number): [number, number][] =>
      Array.from({ length: LAMP_STEPS }, (_, i) => {
        const a = (i / LAMP_STEPS) * Math.PI * 2;
        return [x + Math.cos(a) * r, y + Math.sin(a) * r] as [number, number];
      });
    for (const [x, y, r] of lamps) holes.push(ring(x, y, r + RING));
    // The panel's face with its holes, and its edges back to its depth.
    b.color(p.colour);
    const v2 = (pts: readonly [number, number][]): THREE.Vector2[] => pts.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(v2(outline), holes.map(v2));
    const all = [...outline, ...holes.flat()];
    for (const [i, j, k] of tris) b.tri('trim', [all[i!]![0], all[i!]![1], z], [all[j!]![0], all[j!]![1], z], [all[k!]![0], all[k!]![1], z]);
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i]!;
      const [bx, by] = outline[(i + 1) % outline.length]!;
      b.quad('trim', [ax, ay, z], [bx, by, z], [bx, by, zBack], [ax, ay, zBack]);
    }
    // Each slot a recess: its walls in the panel's colour, a dark back 4 cm in.
    const depth = this.frame.z(p.s + 0.04);
    for (const hole of holes.slice(0, holes.length - lamps.length)) {
      b.color(p.colour);
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = hole[i]!;
        const [bx, by] = hole[(i + 1) % 4]!;
        b.quad('trim', [ax, ay, z], [bx, by, z], [bx, by, depth], [ax, ay, depth]);
      }
      b.color(DARK).poly('trim', hole.map(([x, y]): Vec3 => [x, y, depth]));
    }
    // Lamps: a black ring from inside the panel to 3 cm out, its front a flat annulus,
    // the lens 6 mm behind the ring's front; the ring's throat in the dark.
    for (const [x, y, r, slot] of lamps) {
      const outer = ring(x, y, r + RING);
      const inner = ring(x, y, r);
      const zf = this.frame.z(p.s - 0.03);
      const zl = this.frame.z(p.s - 0.024);
      const at = (pts: [number, number][], zz: number): Vec3[] => pts.map(([px, py]): Vec3 => [px, py, zz]);
      b.color(BLACK);
      b.bridge('trim', at(outer, this.frame.z(p.s + 0.01)), at(outer, zf), true);
      b.bridge('trim', at(outer, zf), at(inner, zf), true);
      b.color(DARK).bridge('trim', at(inner, zf), at(inner, zl), true);
      b.color(0xffffff).poly(slot, at(inner, zl));
    }
  }

  /**
   * One front wing (+1 left, -1 right): its top from the bonnet's lower edge out and
   * rolling down at the brow, the flank down to its bottom with the arch cut out of it, the
   * arch's dark liner, an inner wall under the bonnet's edge, and its ends; the amber
   * repeater on its flank.
   */
  private wing(side: number): void {
    const wg = this.t.wings;
    const bn = this.t.bonnet;
    const w = this.frame.spec.wheels;
    const b = this.front;
    const edge = bn.edge - 0.005;
    const xIn = (s: number): number => (s <= bn.s1 ? this.bonnetHalf(s) - 0.012 : lerp(this.bonnetHalf(bn.s1) - 0.012, wg.cab, Math.min(1, (s - bn.s1) / 0.1)));
    const xOut = (s: number): number => lerp(wg.nose, wg.outer, Math.min(1, (s - wg.s0) / wg.taper));
    const bottom = (s: number): number => lerp(wg.bottom[0], wg.bottom[1], (s - wg.s0) / (wg.s1 - wg.s0));
    /** The top's line across at s, inner edge to the brow: [x, y]. */
    const top = (s: number): [number, number][] => {
      const o = xOut(s);
      return [[xIn(s), edge], [o - 0.1, edge - 0.025], [o - 0.03, wg.brow + 0.04], [o, wg.brow]];
    };
    // The arch: a half ellipse `arch` wide and `frontArchRise` high over the hub, on its
    // shifted centre, down to the flank's bottom line.
    const r = w.radius;
    const a = r * w.arch;
    const rise = r * (w.frontArchRise ?? w.arch);
    const centre = w.front + (w.archShift?.[0] ?? 0);
    const footAngle = (s: number): number => Math.asin(Math.min(1, Math.max(-1, (bottom(s) - r) / rise)));
    const t0 = footAngle(centre + a);
    const t1 = Math.PI - footAngle(centre - a);
    const arch: [number, number][] = [];
    for (let i = 0; i <= ARCH_STEPS; i++) {
      const th = lerp(t0, t1, i / ARCH_STEPS);
      arch.push([centre + a * Math.cos(th), r + rise * Math.sin(th)]);
    }
    // arch runs rear foot -> front foot. Columns along s for the top and inner wall.
    const sT = wg.s0 + wg.taper;
    const cols = [wg.s0, sT, ...[0.35, 0.65].map((f) => lerp(sT, bn.s1, f)), bn.s1, Math.min(wg.s1, bn.s1 + 0.1), wg.s1]
      .filter((s, i, all) => i === 0 || s > all[i - 1]! + 1e-4);
    const X = (x: number): number => side * x;
    // Top: three strips along the columns.
    b.color(0xffffff);
    for (let i = 0; i + 1 < cols.length; i++) {
      const p = top(cols[i]!);
      const q = top(cols[i + 1]!);
      for (let k = 0; k + 1 < p.length; k++) {
        b.quad('paint', this.P(X(p[k]![0]), p[k]![1], cols[i]!), this.P(X(q[k]![0]), q[k]![1], cols[i + 1]!), this.P(X(q[k + 1]![0]), q[k + 1]![1], cols[i + 1]!), this.P(X(p[k + 1]![0]), p[k + 1]![1], cols[i]!));
      }
    }
    // The flank's tapered nose, then the flat flank behind it with the arch cut out.
    b.quad('paint', this.P(X(xOut(wg.s0)), bottom(wg.s0), wg.s0), this.P(X(xOut(sT)), bottom(sT), sT), this.P(X(xOut(sT)), wg.brow, sT), this.P(X(xOut(wg.s0)), wg.brow, wg.s0));
    // Round the arch from its front foot to its rear one.
    const flank: [number, number][] = [[sT, bottom(sT)], ...arch.slice().reverse(), [wg.s1, bottom(wg.s1)], [wg.s1, wg.brow], [sT, wg.brow]];
    const flankTris = THREE.ShapeUtils.triangulateShape(flank.map(([s, y]) => new THREE.Vector2(s, y)), []);
    for (const [i, j, k] of flankTris) {
      const pt = (n: number): Vec3 => this.P(X(wg.outer), flank[n]![1], flank[n]![0]);
      b.tri('paint', pt(i!), pt(j!), pt(k!));
    }
    // The ends: the nose behind the face panel, the rear against the door.
    for (const s of [wg.s0, wg.s1]) {
      const p = top(s);
      const ring: Vec3[] = [...p.map(([x, y]) => this.P(X(x), y, s)), this.P(X(xOut(s)), bottom(s), s), this.P(X(xIn(s)), bottom(s), s)];
      b.poly('paint', ring);
    }
    // Under the wing: the bottom ahead of and behind the arch, the inner wall under the
    // bonnet's edge, the arch's liner (dark, facing down at the wheel).
    const front = arch[arch.length - 1]![0];
    const rear = arch[0]![0];
    for (const [s0, s1] of [[wg.s0, front], [rear, wg.s1]] as const) {
      b.quad('paint', this.P(X(xIn(s0)), bottom(s0), s0), this.P(X(xIn(s1)), bottom(s1), s1), this.P(X(xOut(s1)), bottom(s1), s1), this.P(X(xOut(s0)), bottom(s0), s0));
    }
    const archY = (s: number): number => {
      const d = (s - centre) / a;
      return Math.abs(d) >= 1 ? -Infinity : r + rise * Math.sqrt(1 - d * d);
    };
    const wall = [...new Set([...cols, ...arch.map(([s]) => s)])].sort((p, q) => p - q);
    for (let i = 0; i + 1 < wall.length; i++) {
      const [s0, s1] = [wall[i]!, wall[i + 1]!];
      const foot = (s: number): number => Math.max(bottom(s), archY(s));
      b.quad('paint', this.P(X(xIn(s0)), foot(s0), s0), this.P(X(xIn(s1)), foot(s1), s1), this.P(X(xIn(s1)), edge, s1), this.P(X(xIn(s0)), edge, s0));
    }
    // The liner runs in past the wall to an apron inside the tyre, which closes the well
    // down to the hub's height plus a little: no seeing through the truck over the tyre.
    // It starts under the lip's return (below), not in its surface.
    const apron = w.frontHalfTrack - w.width / 2 - 0.2;
    const apronFoot = r + 0.35;
    const lipIn = wg.outer - LIP_OUT;
    b.color(DARK);
    for (let i = 0; i + 1 < arch.length; i++) {
      const [sa, ya] = arch[i]!;
      const [sb, yb] = arch[i + 1]!;
      b.quad('trim', this.P(X(lipIn), ya, sa), this.P(X(apron), ya, sa), this.P(X(apron), yb, sb), this.P(X(lipIn), yb, sb));
      if (Math.min(ya, yb) > apronFoot) b.quad('trim', this.P(X(apron), ya, sa), this.P(X(apron), apronFoot, sa), this.P(X(apron), apronFoot, sb), this.P(X(apron), yb, sb));
    }
    // The lip round the arch [D side: the arch's double line; P]: from the flank, `LIP_WIDE`
    // out of the opening, it rolls out to its edge `LIP_OUT` proud over the opening's line,
    // and turns in along it to the liner.
    b.color(0xffffff);
    const lip = arch.map(([sa, ya]): { q: Vec3; e: Vec3; i: Vec3 } => {
      const n = new THREE.Vector2((sa - centre) / (a * a), (ya - r) / (rise * rise)).normalize();
      const qs = sa + n.x * LIP_WIDE;
      const qy = Math.max(ya + n.y * LIP_WIDE, bottom(qs));
      return { q: this.P(X(wg.outer), qy, qs), e: this.P(X(wg.outer + LIP_OUT), ya, sa), i: this.P(X(lipIn), ya, sa) };
    });
    for (let k = 0; k + 1 < lip.length; k++) {
      const [p, q] = [lip[k]!, lip[k + 1]!];
      b.quad('paint', p.q, q.q, q.e, p.e);
      b.quad('paint', p.e, q.e, q.i, p.i);
    }
    // The repeater: a short amber cylinder rooted in the flank.
    const [rs, ry, rr] = wg.repeater;
    b.color(0xffffff).cylinderX(side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r', this.P(X(wg.outer + 0.004), ry, rs), rr, 0.009, 10);
  }

  /** Three amber marker lamps on the roof's front, each on a dark base rooted in the roof. */
  private markers(): void {
    const [s, x] = this.t.cab.markers;
    const cab = this.frame.spec.cabin;
    const b = this.front;
    for (const mx of [-x, 0, x]) {
      const y = cab.rail + cab.railRise + this.frame.crownAt(Math.abs(mx) / (cab.railHalf - cab.railInset));
      b.color(DARK).box('trim', this.P(mx, y + 0.008, s), [0.035, 0.016, 0.025]);
      b.color(MARKER).bevelBox('trim', this.P(mx, y + 0.036, s), [0.03, 0.014, 0.02], 0.008);
    }
  }

  /** The bonnet: a loft of its sections from the nose to its rear edge, the nose capped, louvres on its sides. */
  private bonnet(): void {
    const bn = this.t.bonnet;
    const b = new PartBuilder();
    const ss = bn.top.map(([s]) => s);
    const section = (s: number): Vec3[] => {
      const h = this.bonnetHalf(s);
      const top = this.bonnetTop(s);
      const shoulder = Math.max(bn.edge + 0.01, top - bn.roll[1]);
      const half: [number, number][] = [[h, bn.edge], [h, shoulder], [h - bn.roll[0], Math.max(shoulder, top - 0.014)], [(h - bn.roll[0]) * 0.5, top - 0.004]];
      const pts = [...half, [0, top] as [number, number], ...half.slice().reverse().map(([x, y]) => [-x, y] as [number, number])];
      return pts.map(([x, y]) => this.P(x, y, s));
    };
    b.color(0xffffff);
    const rings = ss.map(section);
    // Rear to front, so the skin winds outward (its normals up and out: dust and wear).
    for (let i = 0; i + 1 < rings.length; i++) b.bridge('paint', rings[i + 1]!, rings[i]!);
    b.poly('paint', rings[0]!);
    // Louvres: horizontal slats standing 7 mm out of each side, open against it (no face
    // in or under the side's plane).
    const lv = bn.louvres;
    b.color(DARK);
    const pitch = (lv.y[1] - lv.y[0]) / lv.count;
    const hy = pitch * 0.22;
    for (const side of [1, -1]) {
      for (let i = 0; i < lv.count; i++) {
        const y = lv.y[0] + (i + 0.5) * pitch;
        const ring = (s: number): Vec3[] => [[0, -hy], [0.007, -hy], [0.007, hy], [0, hy]].map(([d, dy]) => this.P(side * (this.bonnetHalf(s) + d!), y + dy!, s));
        const a = ring(lv.s[0]);
        const c = ring(lv.s[1]);
        b.bridge('trim', a, c);
        b.poly('trim', a);
        b.poly('trim', c);
      }
    }
    const pivot = this.P(0, this.bonnetTop(bn.s1), bn.s1);
    const motion: KitMotion = { channel: 'bonnet', kind: 'rot', axis: [1, 0, 0], amount: -0.95 };
    const node = pivotGroup('bonnet', pivot, motion, { id: 'bonnet', label: 'Капот' });
    addBuilt(node, b, pivot, 'bonnet');
    this.ctx.root.add(node);
  }

  // ---- the platform ----

  /**
   * The floor on two sills over the rails, a dark beam round its edge, the toolbox, the
   * fixed front board. From the side the beam is one dark band under the boards along the
   * whole platform [O]; the sills and the frame show under it. Each part reaches a little
   * into what it carries, or stops short of it: no two faces in one plane.
   */
  private platform(): void {
    const pl = this.t.platform;
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
    b.color(0xffffff);
    sweep(b, 'paint', [[-fx, under], [fx, under], [fx, y], [-fx, y]], (s, [x, py]) => this.P(x, py, s), pl.s0 + 0.02, pl.s1 - 0.02, true, [1, 3]);
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
    b.color(TOOLBOX).boxFrom('trim', this.P(tb.inner, tb.y[0], tb.s[1]), this.P(pl.half - 0.005, tb.y[1], tb.s[0]));
    b.color(BLACK);
    // Hinge knuckles on the beams' outer edge, under each drop board.
    for (const side of [1, -1]) {
      for (const s of [pl.s0 + 0.5, (pl.s0 + pl.s1) / 2, pl.s1 - 0.5]) {
        b.cylinderZ('trim', this.P(side * (pl.half - 0.012), y - HINGE_DROP, s), 0.014, 0.04, 6);
      }
    }
    for (const x of [-(pl.half * 0.5), pl.half * 0.5]) b.cylinderX('trim', this.P(x, y - HINGE_DROP, pl.s1 - 0.012), 0.014, 0.04, 6);
    // The fixed front board, its ribs facing the cab.
    b.color(0xffffff);
    board(b, (u, v, w) => this.P(u, y + GAP + v * (pl.side - GAP), pl.s0 + BOARD - w * BOARD), -pl.half, pl.half, pl.ribs);
  }

  /** The two side boards and the tail board, each hinged at its bottom edge. */
  private boards(): void {
    const pl = this.t.platform;
    const y = pl.floor;
    const hy = y - HINGE_DROP;
    const tailIn = pl.s1 - BOARD;
    for (const side of [1, -1]) {
      const name = side > 0 ? 'board_l' : 'board_r';
      const pivot = this.P(side * pl.half, hy, (pl.s0 + pl.s1) / 2);
      const node = pivotGroup(name, pivot, { channel: name, kind: 'rot', axis: [0, 0, 1], amount: -side * BOARD_DROP }, { id: name, label: LABELS[name]! });
      const b = new PartBuilder().color(0xffffff);
      // Along the board u runs s, w out from its inner face.
      board(b, (u, v, w) => this.P(side * (pl.inside + w * (pl.half - pl.inside - GAP)), y + GAP + v * (pl.side - GAP), u), pl.s0 + BOARD + GAP, tailIn - GAP, pl.ribs);
      addBuilt(node, b, pivot, name);
      this.ctx.root.add(node);
    }
    const pivot = this.P(0, hy, pl.s1);
    const node = pivotGroup('board_tail', pivot, { channel: 'board_tail', kind: 'rot', axis: [1, 0, 0], amount: -BOARD_DROP }, { id: 'board_tail', label: LABELS.board_tail! });
    const b = new PartBuilder().color(0xffffff);
    board(b, (u, v, w) => this.P(u, y + GAP + v * (pl.side - GAP), tailIn + w * (BOARD - GAP)), -(pl.half - GAP), pl.half - GAP, pl.ribs);
    addBuilt(node, b, pivot, 'board_tail');
    this.ctx.root.add(node);
  }

  // ---- under the bonnet ----

  /** The V8 (block, two banks, the intake and the air filter), the fan and the radiator (`kit_bay`). */
  private bay(): void {
    const { engine: e, radiator: rd } = this.t.bay;
    const b = new PartBuilder();
    const [s0, s1] = e.s;
    const sm = (s0 + s1) / 2;
    const half = (s1 - s0) / 2;
    b.color(ENGINE);
    b.bevelBox('trim', this.P(0, (e.y[0] + e.y[1] - 0.1) / 2, sm), [e.half, (e.y[1] - 0.1 - e.y[0]) / 2, half], 0.04);
    for (const side of [1, -1]) {
      // Each bank leans out 45° from the vee, its head at the top.
      const bank: [number, number][] = [[0.04, e.y[1] - 0.12], [0.22, e.y[1] - 0.12], [0.36, e.y[1] + 0.08], [0.16, e.y[1] + 0.16]];
      const ring = (s: number): Vec3[] => bank.map(([x, y]) => this.P(side * x, y, s));
      const a = ring(s0 + 0.03);
      const c = ring(s1 - 0.03);
      b.bridge('trim', a, c, true);
      b.poly('trim', a);
      b.poly('trim', c);
    }
    b.box('trim', this.P(0, e.y[1] + 0.06, sm), [0.1, 0.1, half - 0.08]);
    b.color(BLACK).cylinderY('trim', this.P(0, e.y[1] + 0.24, sm - 0.05), 0.16, 0.05, 12);
    b.color(RADIATOR);
    b.boxFrom('trim', this.P(-rd.half, rd.y[0], rd.s + 0.07), this.P(rd.half, rd.y[1], rd.s));
    b.color(BLACK).cylinderZ('trim', this.P(0, (rd.y[0] + rd.y[1]) / 2 - 0.02, rd.s + 0.12), 0.24, 0.01, 12);
    const group = new THREE.Group();
    group.name = 'kit_bay';
    addBuilt(group, b, ORIGIN, 'bay', true);
    this.ctx.root.add(group);
  }
}

/** A lamp ring's width round its lens. */
const RING = 0.018;

/** Piecewise-linear lookup in [s, value] points, held beyond the ends. */
function tableAt(points: readonly (readonly [number, number])[], s: number): number {
  if (s <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [s1, v1] = points[i]!;
    if (s <= s1) {
      const [s0, v0] = points[i - 1]!;
      return lerp(v0, v1, (s - s0) / (s1 - s0));
    }
  }
  return points[points.length - 1]![1];
}

/** A closed ring's cap, cut into triangles that keep to its outline (it may be concave). */
function cap(b: PartBuilder, slot: KitSlot, ring: readonly Vec3[]): void {
  // The ring lies in a plane of constant z (a section across the car).
  const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of tris) b.tri(slot, ring[i!]!, ring[j!]!, ring[k!]!);
}

/** A square bar `hw` × `hh` from `a` to `c`, its ends closed; `up` picks which way `hh` faces. */
function bar(b: PartBuilder, slot: KitSlot, a: Vec3, c: Vec3, hw: number, hh: number, up: Vec3 = [0, 1, 0]): void {
  const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
  let side = d.clone().cross(new THREE.Vector3(...up));
  if (side.lengthSq() < 1e-10) side = d.clone().cross(new THREE.Vector3(0, 0, 1));
  side.normalize();
  const u = side.clone().cross(d);
  const ring = (p: Vec3): Vec3[] =>
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]): Vec3 => [
      p[0] + side.x * sx! * hw + u.x * sy! * hh,
      p[1] + side.y * sx! * hw + u.y * sy! * hh,
      p[2] + side.z * sx! * hw + u.z * sy! * hh,
    ]);
  const r0 = ring(a);
  const r1 = ring(c);
  b.bridge(slot, r0, r1, true);
  b.poly(slot, r0);
  b.poly(slot, r1);
}

/**
 * A closed 2D section swept straight from u0 to u1, `at(u, p)` placing its point p at u
 * (linear in p). Cut across into as many runs as keep every long face's triangles at
 * `SWEEP_ANGLE` or wider at their sharpest, however narrow the section's faces; `caps`
 * closes the ends; the section's edges in `open` (edge j from point j to j + 1) are left
 * out. Every face is wound outward.
 */
function sweep(b: PartBuilder, slot: KitSlot, section: readonly (readonly [number, number])[], at: (u: number, p: readonly [number, number]) => Vec3, u0: number, u1: number, caps = true, open: readonly number[] = []): void {
  const n = section.length;
  const ring0 = section.map((p) => at(u0, p));
  const length = Math.hypot(...sub3(at(u1, section[0]!), ring0[0]!));
  let narrow = Infinity;
  for (let j = 0; j < n; j++) if (!open.includes(j)) narrow = Math.min(narrow, Math.hypot(...sub3(ring0[(j + 1) % n]!, ring0[j]!)));
  const runs = Math.max(1, Math.ceil((length * Math.tan(SWEEP_ANGLE)) / narrow));
  // The section's winding, so each edge's outward side is known in 2D, then placed.
  let area = 0;
  for (let j = 0; j < n; j++) {
    const [p, q] = [section[j]!, section[(j + 1) % n]!];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const turn = Math.sign(area);
  const rings = Array.from({ length: runs + 1 }, (_, i) => section.map((p) => at(lerp(u0, u1, i / runs), p)));
  const face = (pts: Vec3[], out: Vec3): void => {
    const n3 = newell(pts);
    if (n3[0] * out[0] + n3[1] * out[1] + n3[2] * out[2] < 0) pts.reverse();
    b.poly(slot, pts);
  };
  for (let j = 0; j < n; j++) {
    if (open.includes(j)) continue;
    const [p, q] = [section[j]!, section[(j + 1) % n]!];
    const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const outward: [number, number] = [mid[0] + turn * (q[1] - p[1]), mid[1] - turn * (q[0] - p[0])];
    const out = sub3(at(u0, outward), at(u0, mid));
    for (let i = 0; i < runs; i++) face([rings[i]![j]!, rings[i]![(j + 1) % n]!, rings[i + 1]![(j + 1) % n]!, rings[i + 1]![j]!], out);
  }
  if (!caps) return;
  const tris = THREE.ShapeUtils.triangulateShape(section.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const along = sub3(rings[runs]![0]!, ring0[0]!);
  for (const [ring, sign] of [[ring0, -1], [rings[runs]!, 1]] as const) {
    for (const [i, j, k] of tris) face([ring[i!]!, ring[j!]!, ring[k!]!], [along[0] * sign, along[1] * sign, along[2] * sign]);
  }
}

function sub3(a: Vec3, c: Vec3): Vec3 {
  return [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
}

/**
 * A pressed steel board in paint, one section swept along it (`sweep`): the inner face (w
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
  sweep(b, 'paint', section, (u, [v, w]) => at(u, v, w), u0, u1);
}
