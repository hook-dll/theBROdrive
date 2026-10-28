/**
 * A bonneted truck round its cab (`platform: 'truck'`, `KitCarSpec.truck`): the shell
 * (body.ts) is the cab alone, standing on the ladder frame between the axles; this module
 * builds everything else from `TruckSpec`.
 *
 *  - chassis, on the root, drawn at every distance (a truck's frame is half its side
 *    view): the two channel rails and their cross members, the front beam axle and the
 *    rear axle's housing, leaf springs, the steps, the fuel tank with its filler neck, the
 *    exhaust's silencer and tail pipe, mud flaps, the rear lamps on brackets at the frame's end;
 *  - the tank's cap, hinged at its outer edge (`flap`, the car's fuel flap channel), and
 *    the `KIT_FILLER_NODE` box over the neck a can pours into;
 *  - the front: a black channel bumper with two tow hooks, the face panel between the
 *    wings with its slots and round lamps, the wings with their round arches;
 *  - `bonnet`, hinged at its rear edge (kit.ts `shellMotion`'s bonnet motion);
 *  - the platform: the floor on two sills over the rails, a dark steel beam round its
 *    edge under it, a toolbox under its front on the left, the fixed front board and three
 *    drop boards hinged at their bottom edges (`board_l`, `board_r`, `board_tail`);
 *  - under the bonnet the four `KIT_BONNET_CELL_NODE` cells (bay.ts), as a car's: the
 *    bonnet's grid draws the fitted engine, turbine, radiator and air filter in them;
 *    `kit_under` (gearbox and propeller shaft), drawn near only (rig.ts `KIT_DETAIL_GROUPS`);
 *  - three amber marker lamps on the cab's roof.
 *
 * Everything is plain boxes, prisms and lofts: "a schematic parody" (README). Shapes stand
 * clear of one another or meet edge to edge, never in one plane.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, newell, type KitSlot, type Vec3 } from './builder';
import { CELL_KINDS, LID_ROOM, cellMarker } from './bay';
import { addBuilt, pivotGroup, type KitContext } from './context';
import { KIT_FILLER_NODE } from './exterior';
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
/** The bonnet's top falls this much from the centre line out to its roll (`bonnet`'s section). */
const BONNET_CROWN = 0.014;
/** The bonnet's front corners in plan: a quarter round this big [P F34, F34w; E]. */
const BONNET_NOSE_R = 0.2;
/** Extra loft stations over that round, as fractions of it. */
const BONNET_ROUND_COLS = [0.04, 0.12, 0.25, 0.45, 0.7];
/** Segments round each rounded corner of the face panel and its grille block. */
const CORNER_STEPS = 6;
/** The front bumper's front corners in plan, and the roll of its front edges [P F34; owner's refs; E]. */
const BUMPER_CORNER = 0.14;
const BUMPER_ROLL = 0.03;
/**
 * The lamps' sunken pocket in each cheek [P F34, F34w; owner's refs]: it fills the cheek
 * inside a rim this wide (round the nose, top and bottom; at the outer edge), its other
 * corners rounded this much, its wall sloping in this much to a floor this deep; the
 * lamps' rings stand `LAMP_PROUD` out of the cheek.
 */
const POCKET_RIM = 0.035;
const POCKET_RIM_OUT = 0.02;
const POCKET_CORNER = 0.06;
const POCKET_SLOPE = 0.01;
const POCKET_DEPTH = 0.022;
const LAMP_PROUD = 0.02;
/** The nose's grid lines at most this far apart, between those its rounds and slots add. */
const NOSE_STEP = 0.15;
/**
 * The bonnet's lower edge drops this much at the nose, over the face panel's top, and
 * rises back to `edge` over `NOSE_DROP_RUN` [P F34w: the nose rolls down onto the panel].
 */
const NOSE_DROP = 0.05;
const NOSE_DROP_RUN = 0.2;
/**
 * The bonnet's raised middle [P F34w, F34r; E]: its top breaks `RIDGE_HALF` either side of
 * the centre line (narrowing to the front), the middle standing `RIDGE_RISE` over the
 * crown, the sides falling away from the break; it fades out over `RIDGE_FADE` at the nose.
 * No crease under it: the surface stays convex (kit-surface counts a concave fold a dent).
 */
const RIDGE_HALF: readonly [front: number, rear: number] = [0.17, 0.3];
const RIDGE_RISE = 0.015;
const RIDGE_FADE = 0.2;

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
/** The roof's marker lenses, amber, never lit [P F34]. */
const MARKER = 0xd4891e;

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

  /**
   * The bonnet's half width at s: its sides lean in towards the nose in plan, and its front
   * corners turn in on a quarter round `BONNET_NOSE_R` [P F34, F34w: no square corner].
   */
  private bonnetHalf(s: number): number {
    const b = this.t.bonnet;
    const d = Math.min(BONNET_NOSE_R, Math.max(0, s - b.s0));
    const round = BONNET_NOSE_R - Math.sqrt(BONNET_NOSE_R * BONNET_NOSE_R - (BONNET_NOSE_R - d) ** 2);
    return lerp(b.half[0], b.half[1], Math.min(1, Math.max(0, (s - b.s0) / (b.s1 - b.s0)))) - round;
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

  /**
   * The fuel tank outside the left rail on two straps; on its top the filler neck, its
   * cap hinged at its outer edge (`flap`), and the filler's aim box over the neck.
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

  /**
   * Rubber mud flaps either side of each rear wheel, hung from a bar under the platform's
   * beam, each leaning away from the wheel at its foot (`flaps.lean`) [owner's photo of
   * the 130, 2026-10-29].
   */
  private flaps(): void {
    const m = this.t.flaps;
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
      // Black on both sides: the left unit's lenses leave the builder white.
      bar(b.color(BLACK), 'trim', this.P(side * f.half, top - f.depth / 2, f.s1 + 0.03), this.P(side * (x - 0.1), y, s + 0.02), 0.015, 0.02);
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

  /**
   * The black channel bumper, its front corners rounded in plan (`BUMPER_CORNER`) and its
   * front edges rolled (`BUMPER_ROLL`) [P F34, owner's refs: no sharp corner], lofted
   * from plan outlines at heights up it; the two tow hooks on its top.
   */
  private bumper(): void {
    const k = this.t.bumper;
    const b = this.front.color(BLACK);
    const [y0, y1] = k.y;
    const rr = Math.min(BUMPER_ROLL, (y1 - y0) / 2);
    /** The plan outline `e` in from the front and the ends, its back straight across at `depth`. */
    const plan = (e: number, y: number): Vec3[] => {
      const hx = k.half - e;
      const rc = BUMPER_CORNER - e;
      const arc = (side: number): [number, number][] =>
        Array.from({ length: CORNER_STEPS + 1 }, (_, i): [number, number] => {
          const a = (i / CORNER_STEPS) * (Math.PI / 2);
          // From the end's side round to the front, or back the other way.
          const t = side < 0 ? a : Math.PI / 2 - a;
          return [side * (k.half - BUMPER_CORNER + Math.cos(t) * rc), BUMPER_CORNER - Math.sin(t) * rc];
        });
      const pts: [number, number][] = [[-hx, k.depth], ...arc(-1), ...arc(1), [hx, k.depth]];
      return pts.map(([x, s]) => this.P(x, y, s));
    };
    // Heights: quarter rounds at the bottom and the top, the inset following each.
    const quarter = Array.from({ length: CORNER_STEPS + 1 }, (_, i) => (i / CORNER_STEPS) * (Math.PI / 2));
    const levels: [number, number][] = [
      ...quarter.map((a): [number, number] => [y0 + rr * (1 - Math.sin(a)), rr * (1 - Math.cos(a))]).reverse(),
      ...quarter.map((a): [number, number] => [y1 - rr * (1 - Math.sin(a)), rr * (1 - Math.cos(a))]),
    ];
    const rings = levels.map(([y, e]) => plan(e, y));
    for (let i = 0; i + 1 < rings.length; i++) b.bridge('trim', rings[i]!, rings[i + 1]!, true);
    for (const [ring, up] of [[rings[0]!, false], [rings[rings.length - 1]!, true]] as const) {
      const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[2])), []);
      for (const [i, j, l] of tris) {
        if (up) b.tri('trim', ring[i!]!, ring[l!]!, ring[j!]!);
        else b.tri('trim', ring[i!]!, ring[j!]!, ring[l!]!);
      }
    }
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
   * The face [P F34, F34w, F34r; owner's refs 2026-10-28]: a rounded nose between two
   * cheeks. The nose (`face.nose`) carries the grille: in plan one arc from cheek to cheek,
   * like the bonnet's nose over it, its top and bottom rolling back into the cheeks' plane
   * on quarter rounds; on it the grille block swells as a rounded box (`face.grille`), and
   * the slots are recesses following the surface. Each cheek is flat at `face.s`, its top
   * outer corner rounded down past the indicator (the painted wing over it), its outer
   * edge running on round the wing's nose (`wing`); a sunken pocket fills it inside a
   * narrow rim, the head lamp and the indicator over it standing in its floor.
   */
  private facePanel(): void {
    const p = this.t.face;
    const n = p.nose;
    const g = p.grille;
    const b = this.front;
    const [y0, y1] = p.y;
    const h = p.half;
    const z = this.frame.z(p.s);
    const zBack = this.frame.z(p.s + 0.03);
    const at = (pts: readonly (readonly [number, number])[], zz: number): Vec3[] => pts.map(([px, py]): Vec3 => [px, py, zz]);

    // ---- the nose: a height field over a grid that runs along every slot's edges ----
    // In plan one arc from cheek to cheek, `proud` at the middle; its top and bottom roll
    // back into the cheeks' plane on quarter rounds `round`; the grille block swells on it.
    const arcR = (n.half * n.half + n.proud * n.proud) / (2 * n.proud);
    const offset = (x: number, y: number): number => {
      if (Math.abs(x) >= n.half || y <= y0 || y >= y1) return 0;
      const arc = Math.sqrt(arcR * arcR - x * x) - (arcR - n.proud);
      const d = Math.min(1, Math.min(y - y0, y1 - y) / n.round);
      return arc * Math.sqrt(1 - (1 - d) ** 2) + roundBox(x, y, g.half, g.y[0], g.y[1], g.proud);
    };
    const surf = (x: number, y: number): Vec3 => this.P(x, y, p.s - offset(x, y));
    const slots: [number, number, number, number][] = [];
    for (const row of p.slots) {
      const width = (2 * row.half - (row.count - 1) * row.gap) / row.count;
      for (let i = 0; i < row.count; i++) {
        const x0 = -row.half + i * (width + row.gap);
        slots.push([x0, x0 + width, row.y[0], row.y[1]]);
      }
    }
    const xs = stops([
      ...steps(-n.half, n.half, NOSE_STEP),
      ...[g.half, -g.half].flatMap((e) => roundStops(e, Math.sign(e) * g.proud)),
      ...slots.flatMap(([a, c]) => [a, c]),
    ], -n.half, n.half);
    const ys = stops([
      ...steps(y0, y1, NOSE_STEP),
      ...roundStops(y0, -n.round), ...roundStops(y1, n.round),
      ...roundStops(g.y[0], -g.proud), ...roundStops(g.y[1], g.proud),
      ...slots.flatMap(([, , a, c]) => [a, c]),
    ], y0, y1);
    const inSlot = (x: number, y: number): boolean => slots.some(([a, c, d, e]) => x > a && x < c && y > d && y < e);
    b.color(p.colour);
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < ys.length; j++) {
        const [xa, xb, ya, yb] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
        if (inSlot((xa + xb) / 2, (ya + yb) / 2)) continue;
        b.quad('trim', surf(xa, ya), surf(xb, ya), surf(xb, yb), surf(xa, yb));
      }
    }
    // Its top and bottom edges (in the cheeks' plane there) back under the bonnet and the bumper.
    for (const [ya, dir] of [[y0, 1], [y1, -1]] as const) {
      for (let i = 0; i + 1 < xs.length; i++) {
        const [xa, xb] = dir > 0 ? [xs[i]!, xs[i + 1]!] : [xs[i + 1]!, xs[i]!];
        b.quad('trim', [xa, ya, z], [xb, ya, z], [xb, ya, zBack], [xa, ya, zBack]);
      }
    }
    // Each slot a recess round its edge, following the surface, to a dark back 3.5 cm
    // behind its deepest edge.
    for (const [sx0, sx1, sy0, sy1] of slots) {
      const along = (v: readonly number[], lo: number, hi: number): number[] => v.filter((u) => u >= lo - 1e-9 && u <= hi + 1e-9);
      const bx = along(xs, sx0, sx1);
      const by = along(ys, sy0, sy1);
      const edge: [number, number][] = [
        ...bx.map((x): [number, number] => [x, sy0]),
        ...by.slice(1).map((y): [number, number] => [sx1, y]),
        ...bx.slice().reverse().slice(1).map((x): [number, number] => [x, sy1]),
        ...by.slice().reverse().slice(1, -1).map((y): [number, number] => [sx0, y]),
      ];
      const back = this.frame.z(p.s - Math.min(...edge.map(([x, y]) => offset(x, y))) + 0.035);
      b.color(p.colour);
      for (let i = 0; i < edge.length; i++) {
        const [ax, ay] = edge[i]!;
        const [cx, cy] = edge[(i + 1) % edge.length]!;
        b.quad('trim', surf(ax, ay), surf(cx, cy), [cx, cy, back], [ax, ay, back]);
      }
      b.color(DARK).poly('trim', at([[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]], back));
    }

    // ---- the cheeks, each with its lamps' pocket ----
    const ring = (x: number, y: number, r: number): [number, number][] =>
      Array.from({ length: LAMP_STEPS }, (_, i) => {
        const a = (i / LAMP_STEPS) * Math.PI * 2;
        return [x + Math.cos(a) * r, y + Math.sin(a) * r] as [number, number];
      });
    const c = p.corner;
    const mirror = (pts: [number, number][], side: number): [number, number][] => (side > 0 ? pts : pts.map(([x, y]): [number, number] => [-x, y]).reverse());
    // The pocket fills the cheek inside a rim (`POCKET_RIM` round the nose, top and
    // bottom, `POCKET_RIM_OUT` at the outer edge), its top outer corner concentric with
    // the cheek's; its floor `POCKET_SLOPE` further in all round [P F34, F34w; owner's refs].
    const pocket = (inset: number): [number, number][] =>
      roundRect4(n.half + POCKET_RIM + inset, h - POCKET_RIM_OUT - inset, y0 + POCKET_RIM + inset, y1 - POCKET_RIM - inset, [POCKET_CORNER - inset, POCKET_CORNER - inset, c - POCKET_RIM_OUT - inset, POCKET_CORNER - inset]);
    for (const side of [1, -1]) {
      const corner = Array.from({ length: CORNER_STEPS + 1 }, (_, i): [number, number] => {
        const a = (i / CORNER_STEPS) * (Math.PI / 2);
        return [h - c + Math.cos(a) * c, y1 - c + Math.sin(a) * c];
      });
      const outline = mirror([[n.half, y0], [h, y0], ...corner, [n.half, y1]], side);
      const [hx, hy, hr] = [side * p.head[0], p.head[1], p.head[2]];
      const [kx, ky, kr] = [side * p.blinker[0], p.blinker[1], p.blinker[2]];
      const rim = mirror(pocket(0), side);
      const floor = mirror(pocket(POCKET_SLOPE), side);
      b.color(p.colour);
      flatFace(b, outline, [rim], z);
      for (let i = 0; i < outline.length; i++) {
        const [ax, ay] = outline[i]!;
        const [bx2, by2] = outline[(i + 1) % outline.length]!;
        // No edge at the nose (it meets the nose there) nor at the outer side (the wrap runs on).
        if (Math.abs(ax - bx2) < 1e-9 && (Math.abs(Math.abs(ax) - h) < 1e-9 || Math.abs(Math.abs(ax) - n.half) < 1e-9)) continue;
        b.quad('trim', [ax, ay, z], [bx2, by2, z], [bx2, by2, zBack], [ax, ay, zBack]);
      }
      // The pocket: its wall sloping in from the rim to its floor, the floor with the lamps' holes.
      const zFloor = this.frame.z(p.s + POCKET_DEPTH);
      b.bridge('trim', at(rim, z), at(floor, zFloor), true);
      flatFace(b, floor, [ring(hx, hy, hr + RING), ring(kx, ky, kr + RING)], zFloor);
      // Lamps: a black ring from behind the floor to `LAMP_PROUD` out of the cheek, its
      // front a flat annulus, the lens 6 mm behind it; the ring's throat in the dark.
      for (const [x, y, r, slot] of [[hx, hy, hr, 'lamp_head'], [kx, ky, kr, side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r']] as const) {
        const outer = ring(x, y, r + RING);
        const inner = ring(x, y, r);
        const zf = this.frame.z(p.s - LAMP_PROUD);
        const zl = this.frame.z(p.s - LAMP_PROUD + 0.006);
        b.color(BLACK);
        b.bridge('trim', at(outer, this.frame.z(p.s + POCKET_DEPTH + 0.01)), at(outer, zf), true);
        b.bridge('trim', at(outer, zf), at(inner, zf), true);
        b.color(DARK).bridge('trim', at(inner, zf), at(inner, zl), true);
        b.color(0xffffff).poly(slot as KitSlot, at(inner, zl));
      }
    }
  }

  /**
   * One front wing (+1 left, -1 right): its top from the bonnet's lower edge out and
   * rolling down at the brow, the flank down to its bottom with the arch cut out of it, the
   * arch's dark liner, an inner wall under the bonnet's edge, and its ends; the amber
   * repeater on its flank. Its nose turns out to the flank on a quarter round in plan, and
   * the face panel's white runs round that turn back to the flank (`wrap`) [P F34w, F34r].
   */
  private wing(side: number): void {
    const wg = this.t.wings;
    const bn = this.t.bonnet;
    const w = this.frame.spec.wheels;
    const b = this.front;
    const edge = bn.edge - 0.005;
    const xIn = (s: number): number => (s <= bn.s1 ? this.bonnetHalf(s) - 0.012 : lerp(this.bonnetHalf(bn.s1) - 0.012, wg.cab, Math.min(1, (s - bn.s1) / 0.1)));
    // A quarter round in plan from the nose out to the flank over `taper`.
    const xOut = (s: number): number => lerp(wg.nose, wg.outer, Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, (s - wg.s0) / wg.taper))));
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
    const nose = [0.2, 0.4, 0.6, 0.8].map((f) => lerp(wg.s0, sT, f));
    const cols = [wg.s0, ...nose, ...BONNET_ROUND_COLS.map((f) => bn.s0 + f * BONNET_NOSE_R), sT, ...[0.35, 0.65].map((f) => lerp(sT, bn.s1, f)), bn.s1, Math.min(wg.s1, bn.s1 + 0.1), wg.s1]
      .sort((p, q) => p - q)
      .filter((s, i, all) => s >= wg.s0 && (i === 0 || s > all[i - 1]! + 1e-4));
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
    // The flank's rounded nose, then the flat flank behind it with the arch cut out. Over
    // the nose the face panel's white is the skin itself, from the panel's foot up to where
    // its top corner starts to round (its edge, where the nose stands, back to where the
    // flank runs straight); the paint under it, behind the bumper, and over it to the brow.
    const face = this.t.face;
    const wrapTop = face.y[1] - face.corner;
    const turn = [wg.s0, ...nose, sT];
    for (let i = 0; i + 1 < turn.length; i++) {
      const [s0, s1] = [turn[i]!, turn[i + 1]!];
      for (const [ya, yb] of [[bottom(s0), face.y[0]], [wrapTop, wg.brow]] as const) {
        b.quad('paint', this.P(X(xOut(s0)), ya, s0), this.P(X(xOut(s1)), ya, s1), this.P(X(xOut(s1)), yb, s1), this.P(X(xOut(s0)), yb, s0));
      }
    }
    b.color(face.colour);
    const wrap = [face.s, ...turn.filter((s) => s > face.s)];
    for (let i = 0; i + 1 < wrap.length; i++) {
      const [s0, s1] = [wrap[i]!, wrap[i + 1]!];
      const [x0, x1] = [s0 <= wg.s0 ? face.half : xOut(s0), xOut(s1)];
      b.quad('trim', this.P(X(x0), face.y[0], s0), this.P(X(x1), face.y[0], s1), this.P(X(x1), wrapTop, s1), this.P(X(x0), wrapTop, s0));
    }
    b.color(0xffffff);
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
    const under = [...turn, front];
    for (let i = 0; i + 1 < under.length; i++) {
      const [s0, s1] = [under[i]!, under[i + 1]!];
      b.quad('paint', this.P(X(xIn(s0)), bottom(s0), s0), this.P(X(xIn(s1)), bottom(s1), s1), this.P(X(xOut(s1)), bottom(s1), s1), this.P(X(xOut(s0)), bottom(s0), s0));
    }
    b.quad('paint', this.P(X(xIn(rear)), bottom(rear), rear), this.P(X(xIn(wg.s1)), bottom(wg.s1), wg.s1), this.P(X(xOut(wg.s1)), bottom(wg.s1), wg.s1), this.P(X(xOut(rear)), bottom(rear), rear));
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
    // The profile's stations and more over the nose's rounded corners.
    const ss = [...bn.top.map(([s]) => s), ...BONNET_ROUND_COLS.map((f) => bn.s0 + f * BONNET_NOSE_R)]
      .sort((p, q) => p - q)
      .filter((s, i, all) => i === 0 || s > all[i - 1]! + 1e-4);
    const section = (s: number): Vec3[] => {
      const h = this.bonnetHalf(s);
      const top = this.bonnetTop(s);
      const shoulder = Math.max(bn.edge + 0.01, top - bn.roll[1]);
      const along = Math.min(1, Math.max(0, (s - bn.s0) / (bn.s1 - bn.s0)));
      const rise = RIDGE_RISE * Math.min(1, (s - bn.s0) / RIDGE_FADE);
      const rw = lerp(RIDGE_HALF[0], RIDGE_HALF[1], along);
      // The lower edge rolls down over the face panel's top at the nose (quarter round).
      const run = Math.min(1, (s - bn.s0) / NOSE_DROP_RUN);
      const edge = bn.edge - NOSE_DROP * (1 - Math.sqrt(1 - (1 - run) ** 2));
      const half: [number, number][] = [[h, edge], [h, Math.max(edge + 0.01, shoulder)], [h - bn.roll[0], Math.max(shoulder, top - 0.014)], [rw, top + rise * 0.8]];
      const pts = [...half, [0, top + rise] as [number, number], ...half.slice().reverse().map(([x, y]) => [-x, y] as [number, number])];
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
    b.color(BOARD_STEEL);
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

  // ---- under the bonnet ----

  /** The bonnet's four service cells (`TruckSpec.bay`), each up to the closed bonnet over it. */
  private bay(): void {
    for (const kind of CELL_KINDS) {
      const c = this.t.bay[kind];
      const [s0, s1] = c.s;
      this.ctx.root.add(cellMarker(this.frame, kind, { x0: c.x[0], x1: c.x[1], s0, s1, floor: c.floor, top: this.underBonnet(s0, s1) }));
    }
  }

  /** The highest a part may stand over s0..s1 under the closed bonnet: its lowest top there, less its crown and `LID_ROOM`. */
  private underBonnet(s0: number, s1: number): number {
    let y = Math.min(this.bonnetTop(s0), this.bonnetTop(s1));
    for (const [s, top] of this.t.bonnet.top) if (s > s0 && s < s1) y = Math.min(y, top);
    return y - BONNET_CROWN - LID_ROOM;
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

/**
 * How far a rounded box stands out at (x, y): `proud` over its middle, rolling back to 0
 * on quarter rounds of radius `proud` at its sides (±`half`) and at `y0`, `y1`; 0 outside.
 */
function roundBox(x: number, y: number, half: number, y0: number, y1: number, proud: number): number {
  if (Math.abs(x) >= half || y <= y0 || y >= y1) return 0;
  const ex = Math.max(0, Math.abs(x) - (half - proud));
  const ey = Math.max(0, y0 + proud - y, y - (y1 - proud));
  const e2 = ex * ex + ey * ey;
  return e2 >= proud * proud ? 0 : Math.sqrt(proud * proud - e2);
}

/** `from`, `to` and every `step` between. */
function steps(from: number, to: number, step: number): number[] {
  const count = Math.max(1, Math.round((to - from) / step));
  return Array.from({ length: count + 1 }, (_, i) => lerp(from, to, i / count));
}

/** Grid lines across a quarter round of radius |r| ending at `edge`, `r` pointing out of the round. */
function roundStops(edge: number, r: number): number[] {
  return [1, 0.6, 0.3, 0.1, 0].map((f) => edge - r * f);
}

/** Grid lines sorted, within lo..hi, none closer than 1 mm. */
function stops(values: readonly number[], lo: number, hi: number): number[] {
  return values
    .filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9)
    .sort((a, c) => a - c)
    .filter((v, i, all) => i === 0 || v > all[i - 1]! + 1e-3);
}

/**
 * A rectangle x0..x1, y0..y1 counter-clockwise from its bottom left, each corner rounded
 * (radii bottom left, bottom right, top right, top left) in `CORNER_STEPS` segments: two
 * with the same corner count line up point for point.
 */
function roundRect4(x0: number, x1: number, y0: number, y1: number, r: readonly [number, number, number, number]): [number, number][] {
  const corners: [number, number, number, number][] = [
    [x0 + r[0], y0 + r[0], r[0], Math.PI],
    [x1 - r[1], y0 + r[1], r[1], -Math.PI / 2],
    [x1 - r[2], y1 - r[2], r[2], 0],
    [x0 + r[3], y1 - r[3], r[3], Math.PI / 2],
  ];
  return corners.flatMap(([cx, cy, cr, from]) =>
    Array.from({ length: CORNER_STEPS + 1 }, (_, i): [number, number] => {
      const a = from + (i / CORNER_STEPS) * (Math.PI / 2);
      return [cx + Math.cos(a) * cr, cy + Math.sin(a) * cr];
    }),
  );
}

/** A flat face across the car at z: `outline` with `holes` cut out of it. */
function flatFace(b: PartBuilder, outline: readonly [number, number][], holes: readonly (readonly [number, number][])[], z: number): void {
  const v2 = (pts: readonly [number, number][]): THREE.Vector2[] => pts.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(v2(outline), holes.map(v2));
  const all = [...outline, ...holes.flat()];
  for (const [i, j, k] of tris) b.tri('trim', [all[i!]![0], all[i!]![1], z], [all[j!]![0], all[j!]![1], z], [all[k!]![0], all[k!]![1], z]);
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
