/**
 * A bonneted truck's front (`TruckSpec.front`, the ZIL-130's), round its cab: the black
 * channel bumper with its tow hooks, the face panel between the wings (a rounded nose
 * with the grille block and its slots between two cheeks, each with its lamps in a sunken
 * pocket), the wings with their round arches, the bonnet hinged at its rear edge
 * (kit.ts `shellMotion`'s bonnet motion), and the cab roof's marker lamps. Every size is
 * the spec's (zil.ts); truck.ts builds the chassis and load body behind and under it.
 *
 * Everything is plain lofts, grids and prisms: "a schematic parody" (README). Shapes
 * stand clear of one another or meet edge to edge, never in one plane.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, type KitSlot, type Vec3 } from './builder';
import type { BodyFrame } from './body';
import { LID_ROOM } from './bay';
import { addBuilt, pivotGroup, type KitContext } from './context';
import type { KitMotion } from './rig';
import type { TruckFront } from './spec';
import { BLACK, DARK, bar, stops, steps, tableAt } from './truckparts';

/**
 * The front's parts that stand still go into `b` (the truck's `front` builder); the
 * bonnet hangs from its own pivot under the root.
 */
export function buildTruckFront(ctx: KitContext, front: TruckFront, b: PartBuilder): void {
  const f = new Front(ctx.frame, front);
  f.bumper(b);
  f.facePanel(b);
  for (const side of [1, -1]) f.wing(b, side);
  f.markers(b);
  f.bonnet(ctx.root);
}

/** The highest a part may stand over s0..s1 under the closed bonnet: its lowest top there, less its crown and `LID_ROOM`. */
export function underTruckBonnet(front: TruckFront, s0: number, s1: number): number {
  const bn = front.bonnet;
  let y = Math.min(tableAt(bn.top, s0), tableAt(bn.top, s1));
  for (const [s, top] of bn.top) if (s > s0 && s < s1) y = Math.min(y, top);
  return y - bn.crown - LID_ROOM;
}

class Front {
  constructor(private readonly frame: BodyFrame, private readonly t: TruckFront) {}

  private P(x: number, y: number, s: number): Vec3 {
    return [x, y, this.frame.z(s)];
  }

  /**
   * The bonnet's half width at s: its sides lean in towards the nose in plan, and its front
   * corners turn in on a quarter round `noseRound` [P F34, F34w: no square corner].
   */
  private bonnetHalf(s: number): number {
    const b = this.t.bonnet;
    const R = b.noseRound;
    const d = Math.min(R, Math.max(0, s - b.s0));
    const round = R - Math.sqrt(R * R - (R - d) ** 2);
    return lerp(b.half[0], b.half[1], Math.min(1, Math.max(0, (s - b.s0) / (b.s1 - b.s0)))) - round;
  }

  /** The bonnet's top on the centre line at s. */
  private bonnetTop(s: number): number {
    return tableAt(this.t.bonnet.top, s);
  }

  /**
   * The black channel bumper, its front corners rounded in plan (`bumper.corner`) and its
   * front edges rolled (`bumper.roll`) [P F34, owner's refs: no sharp corner], lofted
   * from plan outlines at heights up it; the two tow hooks on its top.
   */
  bumper(builder: PartBuilder): void {
    const k = this.t.bumper;
    const N = this.t.steps.round;
    const b = builder.color(BLACK);
    const [y0, y1] = k.y;
    const rr = Math.min(k.roll, (y1 - y0) / 2);
    /** The plan outline `e` in from the front and the ends, its back straight across at `depth`. */
    const plan = (e: number, y: number): Vec3[] => {
      const hx = k.half - e;
      const rc = k.corner - e;
      const arc = (side: number): [number, number][] =>
        Array.from({ length: N + 1 }, (_, i): [number, number] => {
          const a = (i / N) * (Math.PI / 2);
          // From the end's side round to the front, or back the other way.
          const t = side < 0 ? a : Math.PI / 2 - a;
          return [side * (k.half - k.corner + Math.cos(t) * rc), k.corner - Math.sin(t) * rc];
        });
      const pts: [number, number][] = [[-hx, k.depth], ...arc(-1), ...arc(1), [hx, k.depth]];
      return pts.map(([x, s]) => this.P(x, y, s));
    };
    // Heights: quarter rounds at the bottom and the top, the inset following each.
    const quarter = Array.from({ length: N + 1 }, (_, i) => (i / N) * (Math.PI / 2));
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
  facePanel(b: PartBuilder): void {
    const p = this.t.face;
    const n = p.nose;
    const g = p.grille;
    const pk = p.pocket;
    const N = this.t.steps.round;
    const L = this.t.steps.lamp;
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
      ...steps(-n.half, n.half, p.noseStep),
      ...[g.half, -g.half].flatMap((e) => roundStops(e, Math.sign(e) * g.proud)),
      ...slots.flatMap(([a, c]) => [a, c]),
    ], -n.half, n.half);
    const ys = stops([
      ...steps(y0, y1, p.noseStep),
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
      Array.from({ length: L }, (_, i) => {
        const a = (i / L) * Math.PI * 2;
        return [x + Math.cos(a) * r, y + Math.sin(a) * r] as [number, number];
      });
    const c = p.corner;
    const mirror = (pts: [number, number][], side: number): [number, number][] => (side > 0 ? pts : pts.map(([x, y]): [number, number] => [-x, y]).reverse());
    // The pocket fills the cheek inside a rim (`pocket.rim` round the nose, top and
    // bottom, `pocket.rimOut` at the outer edge), its top outer corner concentric with the
    // cheek's; its floor `pocket.slope` further in all round [P F34, F34w; owner's refs].
    const pocket = (inset: number): [number, number][] =>
      roundRect4(n.half + pk.rim + inset, h - pk.rimOut - inset, y0 + pk.rim + inset, y1 - pk.rim - inset, [pk.corner - inset, pk.corner - inset, c - pk.rimOut - inset, pk.corner - inset], N);
    for (const side of [1, -1]) {
      const corner = Array.from({ length: N + 1 }, (_, i): [number, number] => {
        const a = (i / N) * (Math.PI / 2);
        return [h - c + Math.cos(a) * c, y1 - c + Math.sin(a) * c];
      });
      const outline = mirror([[n.half, y0], [h, y0], ...corner, [n.half, y1]], side);
      const [hx, hy, hr] = [side * p.head[0], p.head[1], p.head[2]];
      const [kx, ky, kr] = [side * p.blinker[0], p.blinker[1], p.blinker[2]];
      const rim = mirror(pocket(0), side);
      const floor = mirror(pocket(pk.slope), side);
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
      const zFloor = this.frame.z(p.s + pk.depth);
      b.bridge('trim', at(rim, z), at(floor, zFloor), true);
      flatFace(b, floor, [ring(hx, hy, hr + p.ring), ring(kx, ky, kr + p.ring)], zFloor);
      // Lamps: a black ring from behind the floor to `lampProud` out of the cheek, its
      // front a flat annulus, the lens 6 mm behind it; the ring's throat in the dark.
      for (const [x, y, r, slot] of [[hx, hy, hr, 'lamp_head'], [kx, ky, kr, side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r']] as const) {
        const outer = ring(x, y, r + p.ring);
        const inner = ring(x, y, r);
        const zf = this.frame.z(p.s - p.lampProud);
        const zl = this.frame.z(p.s - p.lampProud + 0.006);
        b.color(BLACK);
        b.bridge('trim', at(outer, this.frame.z(p.s + pk.depth + 0.01)), at(outer, zf), true);
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
  wing(b: PartBuilder, side: number): void {
    const wg = this.t.wings;
    const bn = this.t.bonnet;
    const w = this.frame.spec.wheels;
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
    for (let i = 0; i <= this.t.steps.arch; i++) {
      const th = lerp(t0, t1, i / this.t.steps.arch);
      arch.push([centre + a * Math.cos(th), r + rise * Math.sin(th)]);
    }
    // arch runs rear foot -> front foot. Columns along s for the top and inner wall.
    const sT = wg.s0 + wg.taper;
    const nose = [0.2, 0.4, 0.6, 0.8].map((f) => lerp(wg.s0, sT, f));
    const cols = [wg.s0, ...nose, ...bn.roundCols.map((f) => bn.s0 + f * bn.noseRound), sT, ...[0.35, 0.65].map((f) => lerp(sT, bn.s1, f)), bn.s1, Math.min(wg.s1, bn.s1 + 0.1), wg.s1]
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
    const lipIn = wg.outer - wg.lip.out;
    b.color(DARK);
    for (let i = 0; i + 1 < arch.length; i++) {
      const [sa, ya] = arch[i]!;
      const [sb, yb] = arch[i + 1]!;
      b.quad('trim', this.P(X(lipIn), ya, sa), this.P(X(apron), ya, sa), this.P(X(apron), yb, sb), this.P(X(lipIn), yb, sb));
      if (Math.min(ya, yb) > apronFoot) b.quad('trim', this.P(X(apron), ya, sa), this.P(X(apron), apronFoot, sa), this.P(X(apron), apronFoot, sb), this.P(X(apron), yb, sb));
    }
    // The lip round the arch [D side: the arch's double line; P]: from the flank, `lip.wide`
    // out of the opening, it rolls out to its edge `lip.out` proud over the opening's line,
    // and turns in along it to the liner.
    b.color(0xffffff);
    const lip = arch.map(([sa, ya]): { q: Vec3; e: Vec3; i: Vec3 } => {
      const n = new THREE.Vector2((sa - centre) / (a * a), (ya - r) / (rise * rise)).normalize();
      const qs = sa + n.x * wg.lip.wide;
      const qy = Math.max(ya + n.y * wg.lip.wide, bottom(qs));
      return { q: this.P(X(wg.outer), qy, qs), e: this.P(X(wg.outer + wg.lip.out), ya, sa), i: this.P(X(lipIn), ya, sa) };
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

  /** Three marker lamps on the roof's front, each on a dark base rooted in the roof. */
  markers(b: PartBuilder): void {
    const [s, x] = this.t.markers.at;
    const cab = this.frame.spec.cabin;
    for (const mx of [-x, 0, x]) {
      const y = cab.rail + cab.railRise + this.frame.crownAt(Math.abs(mx) / (cab.railHalf - cab.railInset));
      b.color(DARK).box('trim', this.P(mx, y + 0.008, s), [0.035, 0.016, 0.025]);
      b.color(this.t.markers.colour).bevelBox('trim', this.P(mx, y + 0.036, s), [0.03, 0.014, 0.02], 0.008);
    }
  }

  /** The bonnet: a loft of its sections from the nose to its rear edge, the nose capped, louvres on its sides. */
  bonnet(root: THREE.Object3D): void {
    const bn = this.t.bonnet;
    const b = new PartBuilder();
    // The profile's stations and more over the nose's rounded corners.
    const ss = [...bn.top.map(([s]) => s), ...bn.roundCols.map((f) => bn.s0 + f * bn.noseRound)]
      .sort((p, q) => p - q)
      .filter((s, i, all) => i === 0 || s > all[i - 1]! + 1e-4);
    const section = (s: number): Vec3[] => {
      const h = this.bonnetHalf(s);
      const top = this.bonnetTop(s);
      const shoulder = Math.max(bn.edge + 0.01, top - bn.roll[1]);
      const along = Math.min(1, Math.max(0, (s - bn.s0) / (bn.s1 - bn.s0)));
      const rise = bn.ridge.rise * Math.min(1, (s - bn.s0) / bn.ridge.fade);
      const rw = lerp(bn.ridge.half[0], bn.ridge.half[1], along);
      // The lower edge rolls down over the face panel's top at the nose (quarter round).
      const run = Math.min(1, (s - bn.s0) / bn.noseDrop.run);
      const edge = bn.edge - bn.noseDrop.drop * (1 - Math.sqrt(1 - (1 - run) ** 2));
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
    root.add(node);
  }
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

/** Grid lines across a quarter round of radius |r| ending at `edge`, `r` pointing out of the round. */
function roundStops(edge: number, r: number): number[] {
  return [1, 0.6, 0.3, 0.1, 0].map((f) => edge - r * f);
}

/**
 * A rectangle x0..x1, y0..y1 counter-clockwise from its bottom left, each corner rounded
 * (radii bottom left, bottom right, top right, top left) in `n` segments: two with the
 * same corner count line up point for point.
 */
function roundRect4(x0: number, x1: number, y0: number, y1: number, r: readonly [number, number, number, number], n: number): [number, number][] {
  const corners: [number, number, number, number][] = [
    [x0 + r[0], y0 + r[0], r[0], Math.PI],
    [x1 - r[1], y0 + r[1], r[1], -Math.PI / 2],
    [x1 - r[2], y1 - r[2], r[2], 0],
    [x0 + r[3], y1 - r[3], r[3], Math.PI / 2],
  ];
  return corners.flatMap(([cx, cy, cr, from]) =>
    Array.from({ length: n + 1 }, (_, i): [number, number] => {
      const a = from + (i / n) * (Math.PI / 2);
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
