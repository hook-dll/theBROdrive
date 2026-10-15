/**
 * The painted shell: tub, greenhouse and roof as one face list, then cut into the
 * parts that open (see spec.ts for the two surfaces and their frame).
 *
 * Every face is made from grid vertices shared through a position-keyed table, so the
 * tub's deck edge IS the greenhouse's bottom ring and a door's edge IS the body's
 * aperture edge until the cut separates them. The cut then:
 *
 *  - pulls each part's boundary in by half a shut gap and the body's out by the other
 *    half, so a closed door shows a real gap and an ink line;
 *  - turns a flange in on the body side of every gap (the jamb an open door shows)
 *    and a return plus an inner skin on the part (a door card, a bonnet's underside);
 *  - sets every pane back from its frame on a dark rubber return;
 *  - offsets the body's own greenhouse and roof inward into the cabin's lining (pillar
 *    trims and headliner, `ShellResult.lining`), so the trim follows the openings exactly.
 */

import * as THREE from 'three';
import { PartBuilder, clipPolygon, cutUnder, lerp, newell, polygonArea, table, type Outline, type Vec3 } from './builder';
import type { CabinColumn, KitCarSpec, TubStation } from './spec';

/** Bevel under the sill: how far the side's bottom edge turns under. */
const SILL_BEVEL = 0.035;
/** Painted lip of wing between a wheel arch and a panel cut above it. */
const ARCH_LIP = 0.045;
/** Shut gap between a moving panel and the body. */
const SHUT_GAP = 0.006;
/** A raked shut line's point this close to the fuel flap's top or bottom row takes its height (`BodyFrame.shutLine`). */
const ROW_SNAP = 0.005;
/** Depth of the jamb flange inside a gap. */
const JAMB_DEPTH = 0.045;
/** Thickness of a door (its card stands this far in from the skin); lids are thinner. */
export const DOOR_THICKNESS = 0.075;
const LID_THICKNESS = 0.035;
/** How far a pane sits behind its frame. */
const GLASS_INSET = 0.012;
/**
 * The cabin lining stands this far in from the body's greenhouse and roof. Every pane's
 * edge gets a rubber return back to it, and to a door's or tailgate's inner skin.
 */
export const LINING_DEPTH = 0.028;
/** Width of the wall a notched deck (`TubStation.notch`) rises in, just inside the notch. */
const NOTCH_WALL = 0.025;
/** Deck left between a `KitCarSpec.bonnet`'s rear edge and the cowl (the scuttle). */
const SCUTTLE = 0.012;
/** Segments per rounded corner of a raked shut line (`CabinColumn.foot.round`). */
const CORNER_STEPS = 4;

export const SHELL_COLOURS = {
  dark: 0x18191a,
  rubber: 0x0e0e0f,
  wheelWell: 0x141515,
} as const;

type Mat = 'paint' | 'glass' | 'dark';

interface Face {
  v: number[];
  owner: string;
  mat: Mat;
  /** Winding already outward; skips the centre-line heuristic (wheel wells). */
  fixed?: boolean;
  /** The body's greenhouse or roof: lined inside (`ShellResult.lining`). */
  lined?: boolean;
}

/** A moving part of the shell, ready to be hung at its pivot. */
export interface ShellPart {
  readonly owner: string;
  readonly builder: PartBuilder;
  /** Pivot in the car frame; the builder's geometry is relative to it. */
  readonly pivot: Vec3;
}

export interface Section {
  readonly st: TubStation;
  /** Half-section points r0..r6 as [x, y]. */
  readonly r0: [number, number];
  readonly r1: [number, number];
  readonly r2: [number, number];
  readonly r3: [number, number];
  readonly r4: [number, number];
}

/** Lookups the interior, trim and bay builders share with the shell. */
export class BodyFrame {
  readonly spec: KitCarSpec;
  readonly zNose: number;
  readonly cowl: number;
  readonly rearBase: number;
  /** Some station carries a `notch`: the lid's cut line and the deck's rows follow it. */
  private readonly notched: boolean;

  constructor(spec: KitCarSpec) {
    this.spec = spec;
    this.zNose = spec.length / 2;
    const cols = spec.cabin.columns;
    this.cowl = cols[0]!.s;
    this.rearBase = cols[cols.length - 1]!.s;
    this.notched = spec.stations.some((st) => st.notch !== undefined);
  }

  /** Car-frame Z of a position along the car. */
  z(s: number): number {
    return this.zNose - s;
  }

  station(s: number): TubStation {
    const st = this.spec.stations;
    const pick = (key: Exclude<keyof TubStation, 'flat' | 'notch'>): number => table(st.map((x) => [x.s, x[key]] as const), s);
    return {
      s,
      sill: pick('sill'),
      crease: pick('crease'),
      belt: pick('belt'),
      deck: pick('deck'),
      wSill: pick('wSill'),
      wCrease: pick('wCrease'),
      wBelt: pick('wBelt'),
      flat: table(st.map((x) => [x.s, x.flat ?? 0] as const), s),
    };
  }

  section(s: number): Section {
    const st = this.station(s);
    const sh = this.spec.shoulder;
    return {
      st,
      r0: [st.wSill - SILL_BEVEL, st.sill],
      r1: [st.wSill, st.sill + SILL_BEVEL],
      r2: [st.wCrease, st.crease],
      r3: [st.wBelt, st.belt],
      r4: [st.wBelt - sh.inset, st.belt + sh.rise],
    };
  }

  /** Outer half width of the side at height y (between the sill and the belt). */
  sideX(s: number, y: number): number {
    const sec = this.section(s);
    const line: [number, number][] = [sec.r1, sec.r2, sec.r3];
    if (y <= line[0]![1]) return line[0]![0];
    for (let i = 1; i < line.length; i++) {
      const [x1, y1] = line[i]!;
      if (y <= y1) {
        const [x0, y0] = line[i - 1]!;
        return lerp(x0, x1, (y - y0) / (y1 - y0 || 1));
      }
    }
    return line[line.length - 1]![0];
  }

  /**
   * Deck height at half-width x: a parabolic crown from the edge to the centre line, or,
   * where the station is `flat`, level out to the pillar row and straight up to the edge
   * from there (an estate's tailgate sill with its upright sides), or, where it has a
   * `notch`, level out to the notch's wall and at the edge's height beyond it (a boot lid
   * coming down between lamp corners).
   */
  deckY(s: number, x: number): number {
    const sec = this.section(s);
    const edge = sec.r4;
    const t = Math.min(1, Math.abs(x) / edge[0]);
    const crowned = lerp(sec.st.deck, edge[1], t * t);
    const flat = sec.st.flat ?? 0;
    let level = crowned;
    if (flat > 0) {
      const pillarX = edge[0] - this.spec.cabin.pillar;
      const u = Math.min(1, Math.max(0, (Math.abs(x) - pillarX) / (edge[0] - pillarX)));
      level = lerp(crowned, lerp(sec.st.deck, edge[1], u), flat);
    }
    const n = this.notchWeight(s);
    if (n <= 0) return level;
    // Level out to the wall, up it to the corners' top, level again out to the edge.
    const notch = this.lidX(s);
    const u = Math.min(1, Math.max(0, (Math.abs(x) - (notch - NOTCH_WALL)) / NOTCH_WALL));
    return lerp(level, lerp(sec.st.deck, edge[1], u), n);
  }

  /** The tub's deck rows at s: fractions of the deck edge's half width. */
  deckFracs(s: number): number[] {
    const edge = this.section(s).r4[0];
    const bonnet = this.bonnetX(s);
    if (bonnet !== undefined) {
      // The bonnet's cut is the pillar row; on the nose face the half row is where the
      // bonnet's nose comes down, elsewhere it halves the bonnet.
      const nose = this.spec.bonnet?.nose;
      const half = nose && s <= this.spec.stations[0]!.s ? nose.half[1] : bonnet / 2;
      return [0, half / edge, bonnet / edge, 1];
    }
    if (!this.notched) return [0, 0.5, (edge - this.spec.cabin.pillar) / edge, 1];
    // On a notched station the half row moves out to the wall's foot.
    const lid = this.lidX(s);
    return [0, lerp(0.5, (lid - NOTCH_WALL) / edge, this.notchWeight(s)), lid / edge, 1];
  }

  /**
   * The tail station a boot lid or tailgate comes down (`bootEnd` on the last station, or
   * no `bootEnd` at all: a hatch; the last station carries a `notch`), or undefined. There
   * the lid's top turns down to a line across at the corner lamps' top, and below that line
   * its rear panel lies in the tail face between the lamps (the 2115's boot lid, the Oka's
   * tailgate).
   */
  get lidFace(): number | undefined {
    const last = this.spec.stations[this.spec.stations.length - 1]!;
    return last.notch !== undefined && (this.spec.bootEnd === undefined || this.spec.bootEnd === last.s) ? last.s : undefined;
  }

  /** The part that comes down the tail face (`lidFace`): the boot lid or the tailgate. */
  get lidOwner(): 'boot' | 'tailgate' {
    return this.spec.bootEnd === undefined ? 'tailgate' : 'boot';
  }

  /**
   * Half width a `KitCarSpec.bonnet` is cut along at s, `inset` in from the deck's edge,
   * from the bonnet's front to just short of the cowl; undefined elsewhere or without one.
   */
  bonnetX(s: number): number | undefined {
    const b = this.spec.bonnet;
    if (!b || s < this.spec.bonnetFront || s > this.bonnetRear) return undefined;
    return this.section(s).r4[0] - b.inset;
  }

  /**
   * Where the bonnet ends: the cowl, or with a `KitCarSpec.bonnet` or a curved screen
   * (`CabinSpec.screenFoot`) `SCUTTLE` short of the screen's foot on the centre line, the
   * deck between narrowing to the windscreen's base.
   */
  get bonnetRear(): number {
    const foot = this.spec.cabin.screenFoot;
    if (foot !== undefined) return this.cowl - foot - SCUTTLE;
    return this.spec.bonnet ? this.cowl - SCUTTLE : this.cowl;
  }

  /** s of the windscreen's foot at a fraction across the roof (0 centre line, 1 rail). */
  screenFoot(frac: number): number {
    const foot = this.spec.cabin.screenFoot;
    return foot === undefined ? this.cowl : this.cowl - foot * (1 - frac * frac);
  }

  /**
   * A raked shut line below the belt (`CabinColumn.foot`) as [s, y] points from the belt
   * down to the doors' bottom: upright on the column, straight to the foot, its two
   * corners rounded by `foot.round`. Heights fall monotonically along it. Every point is
   * a side row on every tub column (`sideCutRows`), so a point within `ROW_SNAP` of the
   * fuel flap's top or bottom takes that row's height: two rows a few millimetres apart
   * only cut the whole flank into slivers and bent the flap's opening out of line.
   */
  shutLine(column: CabinColumn): [number, number][] {
    const foot = column.foot!;
    const bottom = this.spec.doorBottom;
    const [upper, lower] = foot.round ?? [0, 0];
    const top: [number, number] = [column.s, this.station(column.s).belt];
    const corner: [number, number] = [column.s, foot.y];
    const base: [number, number] = [foot.s, bottom];
    const rows = [this.spec.flap.y0, this.spec.flap.y1];
    const snap = (y: number): number => rows.find((r) => Math.abs(r - y) < ROW_SNAP) ?? y;
    return [top, ...fillet(top, corner, base, upper), ...fillet(corner, base, [foot.s - 1, bottom], lower)].map(([s, y]) => [s, snap(y)]);
  }

  /** Half width the boot lid or tailgate is cut along at s: the pillar row, or the stations' `notch`. */
  lidX(s: number): number {
    const pillar = this.spec.cabin.pillar;
    if (!this.notched) return this.section(s).r4[0] - pillar;
    return table(this.spec.stations.map((st) => [st.s, st.notch ?? st.wBelt - this.spec.shoulder.inset - pillar] as const), s);
  }

  /** 0 away from notched stations, 1 on one, linear between. */
  private notchWeight(s: number): number {
    if (!this.notched) return 0;
    return table(this.spec.stations.map((st) => [st.s, st.notch === undefined ? 0 : 1] as const), s);
  }

  /** Arch radius over the tyre radius at an axle: the rear's `rearArch` if set, else `arch`. */
  archFactor(axle: number): number {
    const w = this.spec.wheels;
    return axle === w.rear ? (w.rearArch ?? w.arch) : w.arch;
  }

  /** Arch top at s for either axle, or -Infinity outside both arches. */
  archY(s: number): number {
    const w = this.spec.wheels;
    let best = -Infinity;
    for (const axle of [w.front, w.rear]) {
      const r = w.radius * this.archFactor(axle);
      const d = s - axle;
      if (Math.abs(d) > r) continue;
      // A low rear arch is a half ellipse; every other arch a circle on the hub.
      const rise = axle === w.rear ? w.rearArchRise : undefined;
      const y = rise === undefined ? w.radius + Math.sqrt(r * r - d * d) : w.radius + w.radius * rise * Math.sqrt(Math.max(0, 1 - (d / r) ** 2));
      best = Math.max(best, y);
    }
    return best;
  }

  /** Inner face of the wheel wells. */
  wellX(s: number): number {
    const w = this.spec.wheels;
    const half = Math.abs(s - w.front) < Math.abs(s - w.rear) ? w.frontHalfTrack : w.rearHalfTrack;
    return half - w.width / 2 - 0.045;
  }

  /** Cabin column whose strip contains s (index into cabin.columns), or -1. */
  cabinStrip(s: number): number {
    const cols = this.spec.cabin.columns;
    for (let i = 0; i + 1 < cols.length; i++) {
      if (s >= cols[i]!.s && s < cols[i + 1]!.s) return i;
    }
    return -1;
  }
}

/** Owner name of a cabin strip's door on one side. */
function doorName(owner: string, side: number): string {
  const l = side > 0 ? 'l' : 'r';
  return owner === 'door1' ? `door_f${l}` : `door_r${l}`;
}

class Shell {
  readonly positions: Vec3[] = [];
  readonly faces: Face[] = [];
  private readonly keys = new Map<string, number>();

  vertex(p: Vec3): number {
    const key = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    let index = this.keys.get(key);
    if (index === undefined) {
      index = this.positions.length;
      this.positions.push(p);
      this.keys.set(key, index);
    }
    return index;
  }

  face(points: readonly Vec3[], owner: string, mat: Mat, fixed = false, lined = false): void {
    const v: number[] = [];
    for (const p of points) {
      const i = this.vertex(p);
      if (!v.includes(i)) v.push(i);
    }
    if (v.length < 3) return;
    if (polygonArea(v.map((i) => this.positions[i]!)) < 1e-7) return;
    this.faces.push({ v, owner, mat, fixed, lined });
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

function centroid(points: readonly Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const p of points) c = add(c, p);
  return scale(c, 1 / points.length);
}

/**
 * The corner at `corner` of the path prev → corner → next, rounded with radius r: points
 * along the arc from the first straight to the second; just the corner when r is 0.
 */
function fillet(prev: readonly [number, number], corner: readonly [number, number], next: readonly [number, number], r: number): [number, number][] {
  if (r <= 0) return [[corner[0], corner[1]]];
  const unit = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const d1 = unit(prev, corner);
  const d2 = unit(corner, next);
  const along = d1[0] * d2[0] + d1[1] * d2[1];
  const t = r * Math.tan(Math.acos(Math.min(1, along)) / 2);
  const p1: [number, number] = [corner[0] - d1[0] * t, corner[1] - d1[1] * t];
  const p2: [number, number] = [corner[0] + d2[0] * t, corner[1] + d2[1] * t];
  // The centre lies off the first straight, toward the side the path turns to.
  const n = unit([0, 0], [d2[0] - along * d1[0], d2[1] - along * d1[1]]);
  const c: [number, number] = [p1[0] + n[0] * r, p1[1] + n[1] * r];
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  let da = Math.atan2(p2[1] - c[1], p2[0] - c[0]) - a1;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  const out: [number, number][] = [];
  for (let k = 0; k <= CORNER_STEPS; k++) {
    const a = a1 + (da * k) / CORNER_STEPS;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Tub columns: stations, cabin columns, arch subdivisions and every cut line. */
export function tubColumns(frame: BodyFrame): number[] {
  const spec = frame.spec;
  const s = new Set<number>();
  for (const st of spec.stations) s.add(st.s);
  for (const c of spec.cabin.columns) s.add(c.s);
  s.add(spec.bonnetFront);
  if (spec.bonnet || spec.cabin.screenFoot !== undefined) s.add(frame.bonnetRear);
  if (spec.bootEnd !== undefined) s.add(spec.bootEnd);
  s.add(spec.flap.s0);
  s.add(spec.flap.s1);
  const w = spec.wheels;
  for (const axle of [w.front, w.rear]) {
    const r = w.radius * frame.archFactor(axle);
    const n = 12;
    for (let i = 0; i <= n; i++) {
      // Cosine spacing: short facets where the arch turns down.
      const t = (1 - Math.cos((i / n) * Math.PI)) / 2;
      s.add(axle - r + 2 * r * t);
    }
    s.add(axle - r - 0.004);
    s.add(axle + r + 0.004);
  }
  const sorted = [...s].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length > 0 && v - out[out.length - 1]! < 0.004) continue;
    out.push(v);
  }
  return out;
}

/**
 * Side points of one tub column, sill to belt. Every column has the same rows in the
 * same order — r0, r1, the cut lines under the crease, r2, the cut lines over it, r3 —
 * so neighbouring columns pair row by row. A cut line outside a column's own band is
 * clamped onto the band's edge (a degenerate face, dropped).
 *
 * Over a wheel, r0 sits on the arch and every row that would fall below the arch's
 * lip is lifted onto it: the band between is the wing's lip round the arch, and a
 * door that reaches over the wheel (every rear door does) gets its cut-out for free,
 * its bottom edge following the lip.
 */
function sideColumn(frame: BodyFrame, s: number): [number, number][] {
  const spec = frame.spec;
  const sec = frame.section(s);
  const { below, above } = sideCutRows(frame);
  const at = (y: number, lo: number, hi: number): [number, number] => {
    const c = Math.min(hi, Math.max(lo, y));
    return [frame.sideX(s, c), c];
  };
  const rows: [number, number][] = [
    [...sec.r0],
    [...sec.r1],
    ...below.map((y) => at(y, sec.r1[1], sec.r2[1])),
    [...sec.r2],
    ...above.map((y) => at(y, sec.r2[1], sec.r3[1])),
    [...sec.r3],
  ];
  const arch = frame.archY(s);
  if (arch > -Infinity) {
    const lip = Math.min(arch + ARCH_LIP, sec.r3[1] - 0.02);
    const lipX = frame.sideX(s, lip);
    rows[0] = [frame.sideX(s, arch), arch];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]![1] < lip) rows[i] = [lipX, lip];
    }
  }
  return rows;
}

/**
 * Outer half width of the side as built at (s, y): on the flat faces the shell lays
 * between neighbouring tub columns and side rows (up to the shoulder), where `sideX`
 * interpolates the sections smoothly. A face between two columns is split along one of
 * its diagonals; this takes the outer of the two, so trim laid on it never sinks in.
 */
export function skinX(frame: BodyFrame, s: number, y: number): number {
  const cols = tubColumns(frame);
  const next = cols.findIndex((c) => c > s);
  const j = next < 0 ? cols.length - 2 : Math.max(0, next - 1);
  const sa = cols[j]!;
  const sb = cols[j + 1]!;
  const t = Math.min(1, Math.max(0, (s - sa) / (sb - sa)));
  const rowsAt = (sc: number): [number, number][] => [...sideColumn(frame, sc), frame.section(sc).r4];
  const a = rowsAt(sa);
  const b = rowsAt(sb);
  // The band whose rows, interpolated to s, hold y.
  let i = 0;
  while (i + 2 < a.length && lerp(a[i + 1]![1], b[i + 1]![1], t) < y) i++;
  // Corners as (t, y, x): a0, b0 below, a1, b1 above.
  const corners = [a[i]!, b[i]!, a[i + 1]!, b[i + 1]!].map(([x, cy], k): Vec3 => [k % 2, cy, x]);
  const [a0, b0, a1, b1] = corners as [Vec3, Vec3, Vec3, Vec3];
  // x on the plane of a triangle at (t, y), or undefined outside it.
  const onTriangle = (p: Vec3, q: Vec3, r: Vec3): number | undefined => {
    const det = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
    if (Math.abs(det) < 1e-12) return undefined;
    const u = ((t - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (y - p[1])) / det;
    const v = ((q[0] - p[0]) * (y - p[1]) - (t - p[0]) * (q[1] - p[1])) / det;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) return undefined;
    return p[2] + u * (q[2] - p[2]) + v * (r[2] - p[2]);
  };
  const xs = [onTriangle(a0, b0, b1) ?? onTriangle(a0, b1, a1), onTriangle(a0, b0, a1) ?? onTriangle(b0, b1, a1)].filter((x): x is number => x !== undefined);
  return xs.length > 0 ? Math.max(...xs) : frame.sideX(s, y);
}

/** The side's cut lines (door bottoms, the flap, the turns of a raked shut line), split by which side of the crease they fall on. */
function sideCutRows(frame: BodyFrame): { below: number[]; above: number[] } {
  const spec = frame.spec;
  const meanCrease = spec.stations.reduce((sum, st) => sum + st.crease, 0) / spec.stations.length;
  // Every point of a raked shut line between the belt and the doors' bottom is a row, so
  // each band it crosses is cut along a straight piece of it.
  const feet = spec.cabin.columns.flatMap((c) => (c.foot ? frame.shutLine(c).slice(1).map(([, y]) => y).filter((y) => y > spec.doorBottom + 1e-6) : []));
  const cuts = [spec.doorBottom, spec.flap.y0, spec.flap.y1, ...feet].sort((a, b) => a - b);
  return { below: cuts.filter((y) => y < meanCrease), above: cuts.filter((y) => y >= meanCrease) };
}

/** Index of the side row a cut line becomes (see `sideColumn`). */
function sideRowIndex(frame: BodyFrame, y: number): number {
  const { below, above } = sideCutRows(frame);
  const b = below.indexOf(y);
  return b >= 0 ? 2 + b : 3 + below.length + above.indexOf(y);
}

interface Ring {
  /** Bottom (on the tub), knee, glass bottom, glass top, rail, roof edge. */
  b: Vec3;
  k: Vec3;
  q: Vec3;
  t: Vec3;
  u: Vec3;
  kind: 'front' | 'side' | 'rear';
  frac: number;
  column?: CabinColumn;
}

export interface ShellResult {
  readonly parts: ShellPart[];
  readonly triangles: number;
  /**
   * The cabin lining in the car frame: the body's own greenhouse faces (pillars, headers,
   * rail) and the roof, offset `LINING_DEPTH` inward. Ends at every pane's and every
   * opening's edge, as the shell does.
   */
  readonly lining: readonly Vec3[][];
}

export function buildShell(frame: BodyFrame): ShellResult {
  const spec = frame.spec;
  const cabin = spec.cabin;
  const shell = new Shell();
  const P = (x: number, y: number, s: number): Vec3 => [x, y, frame.z(s)];
  const cols = tubColumns(frame);
  const hatch = spec.bootEnd === undefined;
  // Raked shut lines (`CabinColumn.foot`): s along the line at height y (clamped: the
  // column above it, the foot's end below it), down from where its upper turn begins.
  const rakes = cabin.columns.flatMap((c, index) => {
    if (!c.foot) return [];
    const line = frame.shutLine(c);
    const bySY = line.map(([s, y]) => [y, s] as const).reverse();
    const lineS = (y: number): number => table(bySY, y);
    const prev = cabin.columns[index - 1]!;
    return [{ top: line[1]![1], at: c.s, lineS, from: line[line.length - 1]![0], reach: c.s, nearLower: prev.lower ?? prev.upper ?? 'body', farLower: c.lower ?? c.upper ?? 'body' }];
  });

  for (const side of [1, -1]) {
    // ---- tub sides, shoulder and deck ----
    const columns = cols.map((s) => {
      const sec = frame.section(s);
      const sideRows = sideColumn(frame, s);
      const fr = frame.deckFracs(s);
      // Where the boot lid comes down the tail, the lid's top meets its rear panel along a
      // line across at the corners' top (the rear panel is the tail face's, below).
      const lidTop = s === frame.lidFace ? sec.r4[1] : undefined;
      const deck = fr.slice(1).reverse().concat([0]).map((f) => {
        const x = f * sec.r4[0];
        return [x, lidTop ?? frame.deckY(s, x)] as [number, number];
      });
      // deck: r4 (edge), pillar row, half, centre
      return { s, rows: [...sideRows, ...deck] };
    });
    const sideCount = (j: number): number => columns[j]!.rows.length - 5;
    for (let j = 0; j + 1 < columns.length; j++) {
      const a = columns[j]!;
      const b = columns[j + 1]!;
      const sMid = (a.s + b.s) / 2;
      const inCabin = sMid > frame.cowl && sMid < frame.rearBase;
      const strip = frame.cabinStrip(sMid);
      const lower = strip >= 0 ? cabin.columns[strip]!.lower ?? cabin.columns[strip]!.upper ?? 'body' : 'body';
      // Every column carries the same rows (cut rows clamp, arch rows collapse), so
      // bands pair by index and every side face is a quad or a collapsed triangle.
      const aSide = a.rows.slice(0, sideCount(j) + 1);
      const bSide = b.rows.slice(0, sideCount(j + 1) + 1);
      const doorRow = sideRowIndex(frame, spec.doorBottom);
      const flapRows = [sideRowIndex(frame, spec.flap.y0), sideRowIndex(frame, spec.flap.y1)];
      const sideOwner = (stripLower: string, i: number, sm: number): string => {
        if (side === (spec.flap.side === 'left' ? 1 : -1) && sm > spec.flap.s0 && sm < spec.flap.s1 && i >= flapRows[0]! && i < flapRows[1]!) return 'flap';
        return stripLower !== 'body' && i >= doorRow ? doorName(stripLower, side) : 'body';
      };
      for (let i = 0; i + 1 < aSide.length; i++) {
        const pa0 = aSide[i]!;
        const pa1 = aSide[i + 1]!;
        const pb0 = bSide[i]!;
        const pb1 = bSide[i + 1]!;
        const quad = [P(side * pa0[0], pa0[1], a.s), P(side * pb0[0], pb0[1], b.s), P(side * pb1[0], pb1[1], b.s), P(side * pa1[0], pa1[1], a.s)];
        const rake = rakes.find((r) => i >= doorRow && Math.max(pa1[1], pb1[1]) <= r.top + 1e-9 && Math.min(a.s, b.s) < r.reach && Math.max(a.s, b.s) > r.from);
        if (!rake) {
          shell.face(quad, sideOwner(lower, i, sMid), 'paint');
          continue;
        }
        // A raked shut line crosses the band: each side of it takes the owner of the strip
        // on that side of its column.
        const g = (p: Vec3): number => frame.zNose - p[2] - rake.lineS(p[1]);
        const before = sMid < rake.at ? lower : rake.nearLower;
        const after = sMid >= rake.at ? lower : rake.farLower;
        for (const [piece, stripLower] of [[clipPolygon(quad, g, -1), before], [clipPolygon(quad, g, 1), after]] as const) {
          if (piece.length < 3) continue;
          shell.face(piece, sideOwner(stripLower, i, frame.zNose - centroid(piece)[2]), 'paint');
        }
      }
      // The shoulder (belt -> deck edge) belongs to the door along the cabin.
      const aBelt = a.rows[sideCount(j)]!;
      const bBelt = b.rows[sideCount(j + 1)]!;
      const aEdge = a.rows[sideCount(j) + 1]!;
      const bEdge = b.rows[sideCount(j + 1) + 1]!;
      shell.face(
        [P(side * aBelt[0], aBelt[1], a.s), P(side * bBelt[0], bBelt[1], b.s), P(side * bEdge[0], bEdge[1], b.s), P(side * aEdge[0], aEdge[1], a.s)],
        inCabin && lower !== 'body' ? doorName(lower, side) : 'body',
        'paint',
      );
      if (inCabin) continue;
      const aDeck = a.rows.slice(sideCount(j) + 1);
      const bDeck = b.rows.slice(sideCount(j + 1) + 1);
      for (let i = 0; i + 1 < aDeck.length; i++) {
        let owner = 'body';
        if (i >= 1) {
          if (sMid > spec.bonnetFront && sMid < frame.bonnetRear) owner = 'bonnet';
          if (spec.bootEnd !== undefined && sMid > frame.rearBase && sMid < spec.bootEnd) owner = 'boot';
          // A tailgate coming down the tail face also takes the deck behind its foot.
          if (spec.bootEnd === undefined && frame.lidFace !== undefined && sMid > frame.rearBase) owner = 'tailgate';
        }
        shell.face(
          [
            P(side * aDeck[i]![0], aDeck[i]![1], a.s),
            P(side * bDeck[i]![0], bDeck[i]![1], b.s),
            P(side * bDeck[i + 1]![0], bDeck[i + 1]![1], b.s),
            P(side * aDeck[i + 1]![0], aDeck[i + 1]![1], a.s),
          ],
          owner,
          'paint',
        );
      }
    }

    // ---- wheel wells ----
    const w = spec.wheels;
    for (const axle of [w.front, w.rear]) {
      const r = w.radius * frame.archFactor(axle);
      const archCols = cols.filter((s) => Math.abs(s - axle) <= r);
      const inner = (s: number): number => side * frame.wellX(s);
      const edge = archCols.map((s) => {
        const y = frame.archY(s);
        return { s, y, x: side * frame.sideX(s, y) };
      });
      for (let i = 0; i + 1 < edge.length; i++) {
        const e0 = edge[i]!;
        const e1 = edge[i + 1]!;
        const quad: Vec3[] = [P(e0.x, e0.y, e0.s), P(e1.x, e1.y, e1.s), P(inner(e1.s), e1.y, e1.s), P(inner(e0.s), e0.y, e0.s)];
        shell.face(side > 0 ? quad : [...quad].reverse(), 'body', 'dark', true);
      }
      const sill = frame.station(axle).sill;
      const centre = P(inner(axle), Math.min(sill, w.radius), axle);
      const wall: Vec3[] = [
        P(inner(axle - r), sill, axle - r),
        ...edge.map((e) => P(inner(e.s), e.y, e.s)),
        P(inner(axle + r), sill, axle + r),
      ];
      for (let i = 0; i + 1 < wall.length; i++) {
        const tri: Vec3[] = [centre, wall[i]!, wall[i + 1]!];
        shell.face(side > 0 ? [...tri].reverse() : tri, 'body', 'dark', true);
      }
    }
  }

  // ---- nose and tail faces ----
  for (const s of [cols[0]!, cols[cols.length - 1]!]) {
    const ring: Vec3[] = [];
    const sideRows = sideColumn(frame, s);
    const sec = frame.section(s);
    const deck = frame.deckFracs(s).slice(1).reverse().map((f) => {
      const x = f * sec.r4[0];
      return [x, frame.deckY(s, x)] as [number, number];
    });
    const half = [...sideRows, ...deck];
    // A bonnet's nose comes down the front face between the lamps: the body's face goes
    // round it, from its top corners down to its bottom, and the nose is the bonnet's.
    const nose = s === cols[0] ? spec.bonnet?.nose : undefined;
    const top = half[half.length - 1]!;
    for (const [x, y] of half) ring.push(P(x, y, s));
    ring.push(...(nose ? [P(nose.half[0], nose.y, s), P(-nose.half[0], nose.y, s)] : [P(0, sec.st.deck, s)]));
    for (let i = half.length - 1; i >= 0; i--) ring.push(P(-half[i]![0], half[i]![1], s));
    // An end face is concave where an estate's deck dips to its tailgate sill: a fan would
    // span the notch, so the face is cut into triangles that keep to its outline.
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    // A leaning nose (`frontLean`) is cut along its base, so above it every face has its
    // corners there or higher and leans as one plane, the lamps on it included.
    const cut = s === cols[0] ? spec.frontLean?.base : undefined;
    for (const [a, b, c] of tris) {
      const tri = [ring[a]!, ring[b]!, ring[c]!];
      if (cut === undefined) {
        shell.face(tri, 'body', 'paint');
        continue;
      }
      for (const sign of [1, -1] as const) {
        const piece = clipPolygon(tri, (p) => p[1] - cut, sign);
        if (piece.length >= 3) shell.face(piece, 'body', 'paint');
      }
    }
    if (nose) {
      shell.face([P(nose.half[0], nose.y, s), P(top[0], top[1], s), P(0, sec.st.deck, s), P(-top[0], top[1], s), P(-nose.half[0], nose.y, s)], 'bonnet', 'paint');
    }
    if (s === frame.lidFace) {
      // The lid's rear panel in the tail face: from the line across at the corners' top
      // down the notch wall to its foot, flat, every point shared with the tail face or
      // the lid's top, so the shut line round it is clean.
      const [, foot, cut] = frame.deckFracs(s).map((f) => f * sec.r4[0]);
      const yTop = sec.r4[1];
      const yFoot = sec.st.deck;
      for (const side of [1, -1]) {
        shell.face([P(side * cut!, yTop, s), P(side * foot!, yTop, s), P(side * foot!, yFoot, s)], frame.lidOwner, 'paint');
        shell.face([P(side * foot!, yTop, s), P(0, yTop, s), P(0, yFoot, s), P(side * foot!, yFoot, s)], frame.lidOwner, 'paint');
      }
    }
  }

  // ---- underbody ----
  for (let j = 0; j + 1 < cols.length; j++) {
    const edgeX = (s: number): number => {
      if (frame.archY(s) > -Infinity) return frame.wellX(s);
      return frame.section(s).r0[0];
    };
    const s0 = cols[j]!;
    const s1 = cols[j + 1]!;
    const y0 = frame.station(s0).sill;
    const y1 = frame.station(s1).sill;
    shell.face([P(edgeX(s0), y0, s0), P(edgeX(s1), y1, s1), P(-edgeX(s1), y1, s1), P(-edgeX(s0), y0, s0)], 'body', 'dark');
  }

  // ---- greenhouse ----
  const roofFront = cabin.columns[0]!.top;
  const roofRear = cabin.columns[cabin.columns.length - 1]!.top;
  const along = (a: Vec3, b: Vec3, y: number): Vec3 => {
    const t = (y - a[1]) / (b[1] - a[1] || 1);
    return [lerp(a[0], b[0], t), y, lerp(a[2], b[2], t)];
  };
  for (const side of [1, -1]) {
    const ring: Ring[] = [];
    // One set of fractions across the roof for both ends, so the roof's grid meets the
    // windscreen's and the back light's top edges; the bottoms follow each end's deck.
    const cowlFracs = frame.deckFracs(frame.cowl);
    const end = (kind: 'front' | 'rear'): Ring[] => {
      const s = kind === 'front' ? frame.cowl : frame.rearBase;
      const top = kind === 'front' ? roofFront : roofRear;
      const sec = frame.section(s);
      const local = frame.deckFracs(s);
      return [0, 1, 2].map((index) => {
        const x = local[index]! * sec.r4[0];
        const frac = cowlFracs[index]!;
        const crownY = cabin.rail + cabin.crown * (1 - frac * frac);
        // A curved screen's foot stands ahead of the cowl towards the centre line.
        const sb = kind === 'front' ? frame.screenFoot(frac) : s;
        const b: Vec3 = P(side * x, frame.deckY(sb, x), sb);
        const t: Vec3 = P(side * frac * cabin.railHalf, crownY, top);
        let k: Vec3;
        let q: Vec3;
        if (kind === 'front') {
          k = along(b, t, b[1] + cabin.screenBottom);
          q = along(b, t, t[1] - cabin.screenHeader);
        } else if (cabin.rearKnee) {
          const centreB = frame.deckY(s, 0);
          const centreT = cabin.rail + cabin.crown;
          const kt = (cabin.rearKnee.y - centreB) / (centreT - centreB);
          k = [lerp(b[0], t[0], kt), lerp(b[1], t[1], kt), frame.z(cabin.rearKnee.s)];
          q = along(k, t, t[1] - cabin.rearHeader);
        } else {
          k = along(b, t, b[1] + cabin.rearBottom);
          q = along(b, t, t[1] - cabin.rearHeader);
        }
        const inset = kind === 'front' ? cabin.railInset : -cabin.railInset;
        const u: Vec3 = P(side * frac * (cabin.railHalf - cabin.railInset), crownY + cabin.railRise, top + inset);
        return { b, k, q, t, u, kind, frac };
      });
    };
    ring.push(...end('front'));
    const sideRing: Ring[] = cabin.columns.map((column, i) => {
      const sec = frame.section(column.s);
      const b: Vec3 = P(side * sec.r4[0], sec.r4[1], column.s);
      // A column's `drop` chamfers the rail's corner: its top point stands below the rail.
      const t: Vec3 = P(side * cabin.railHalf, cabin.rail - (column.drop ?? 0), column.top);
      const last = i === cabin.columns.length - 1;
      let k = along(b, t, b[1] + cabin.glassBottom);
      let q = along(b, t, t[1] - cabin.glassTop - (column.glassDrop ?? 0));
      if (last && cabin.rearKnee) {
        // The rear corner folds where the tailgate does, so the D pillar lies flush with
        // the tailgate's glass instead of standing out behind it.
        const kt = Math.max(0, (cabin.rearKnee.y - b[1]) / (t[1] - b[1]));
        k = [lerp(b[0], t[0], kt), lerp(b[1], t[1], kt), frame.z(cabin.rearKnee.s)];
        q = along(k, t, t[1] - cabin.glassTop);
      }
      const inset = i === 0 ? cabin.railInset : last ? -cabin.railInset : 0;
      const u: Vec3 = P(side * (cabin.railHalf - cabin.railInset), cabin.rail + cabin.railRise, column.top + inset);
      return { b, k, q, t, u, kind: 'side', frac: 1, column };
    });
    sideRing.forEach((a, i) => {
      ring.push(a);
      const next = sideRing[i + 1];
      if (!next) return;
      // Where a station between two columns bends the tub's top edge (a hatch's D pillar
      // over the lamp corners), the strip's foot bends with it, so the two meet there.
      const s0 = a.column!.s;
      const s1 = next.column!.s;
      for (const st of spec.stations) {
        if (st.s <= s0 || st.s >= s1) continue;
        const f = (st.s - s0) / (s1 - s0);
        const at = (p: Vec3, q: Vec3): Vec3 => [lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f)];
        const sec = frame.section(st.s);
        const b: Vec3 = P(side * sec.r4[0], sec.r4[1], st.s);
        const straight = at(a.b, next.b);
        if (Math.hypot(b[0] - straight[0], b[1] - straight[1]) <= 0.001) continue;
        const kl = at(a.k, next.k);
        const k: Vec3 = [kl[0] + b[0] - straight[0], kl[1] + b[1] - straight[1], kl[2] + b[2] - straight[2]];
        ring.push({ b, k, q: at(a.q, next.q), t: at(a.t, next.t), u: at(a.u, next.u), kind: 'side', frac: 1, column: a.column });
      }
    });
    ring.push(...end('rear').reverse());

    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      // Owner and glass of the band pair; `band` 0..3 is b-k, k-q, q-t, t-u.
      let upper = 'body';
      let glass: string | null = null;
      if (a.kind === 'front' && b.kind === 'front') {
        glass = 'body';
      } else if (a.kind === 'rear' || b.kind === 'rear') {
        upper = hatch ? 'tailgate' : 'body';
        if (a.kind === 'rear' && b.kind === 'rear') glass = upper;
        else upper = 'body';
      } else if (a.kind === 'side' && b.kind === 'side') {
        const column = a.column!;
        const owner = column.upper ?? 'body';
        upper = owner === 'body' ? 'body' : doorName(owner, side);
        const kind = column.glass ?? 'none';
        // A fixed pane in a door (the 2105's rear quarter) rides with the door.
        if (kind === 'fixed') glass = upper === 'body' ? 'body' : upper.replace('door', 'quarter');
        else if (kind === 'drop') glass = upper === 'body' ? 'body' : upper.replace('door', 'window');
        else if (kind === 'vent') glass = upper === 'body' ? 'body' : upper.replace('door', 'vent');
      }
      const bands: [Vec3, Vec3, Vec3, Vec3, number][] = [
        [a.b, b.b, b.k, a.k, 0],
        [a.k, b.k, b.q, a.q, 1],
        [a.q, b.q, b.t, a.t, 2],
        [a.t, b.t, b.u, a.u, 3],
      ];
      for (const [p0, p1, p2, p3, band] of bands) {
        if (band === 3) {
          shell.face([p0, p1, p2, p3], 'body', 'paint', false, true);
        } else if (band === 1 && glass !== null) {
          shell.face([p0, p1, p2, p3], glass, 'glass');
        } else {
          shell.face([p0, p1, p2, p3], upper, 'paint', false, upper === 'body');
        }
      }
    }

    // ---- roof: rows at the side columns, across at the deck's fractions ----
    const fracs = [1, cowlFracs[2]!, cowlFracs[1]!, 0];
    const sides = ring.filter((r) => r.kind === 'side');
    const roofPoint = (u: Vec3, f: number): Vec3 => [u[0] * f, cabin.rail + cabin.railRise + cabin.crown * (1 - f * f), u[2]];
    for (let i = 0; i + 1 < sides.length; i++) {
      const u0 = sides[i]!.u;
      const u1 = sides[i + 1]!.u;
      for (let k = 0; k + 1 < fracs.length; k++) {
        shell.face([roofPoint(u0, fracs[k]!), roofPoint(u1, fracs[k]!), roofPoint(u1, fracs[k + 1]!), roofPoint(u0, fracs[k + 1]!)], 'body', 'paint', false, true);
      }
    }
  }

  return cutShell(frame, shell);
}


const MOVING = /^(door_|bonnet|boot|tailgate|flap)/;

function cutShell(frame: BodyFrame, shell: Shell): ShellResult {
  const { positions, faces } = shell;
  // Outward winding: away from a line along the car at mid height.
  const ref = (p: Vec3): Vec3 => [0, 0.62, p[2]];
  for (const f of faces) {
    if (f.fixed) continue;
    const pts = f.v.map((i) => positions[i]!);
    const n = newell(pts);
    const c = centroid(pts);
    let out = sub(c, ref(c));
    // Nose and tail plates face along the car.
    if (Math.abs(n[2]) > Math.abs(n[0]) + Math.abs(n[1])) out = [0, 0, c[2]];
    if (dot(n, out) < 0) f.v.reverse();
  }

  // Per owner, per vertex: outward normal sum and the faces' centroid pull.
  const key = (owner: string, v: number): string => `${owner}|${v}`;
  const normals = new Map<string, Vec3>();
  const pulls = new Map<string, Vec3>();
  const ownersAt = new Map<number, Set<string>>();
  for (const f of faces) {
    const pts = f.v.map((i) => positions[i]!);
    const n = newell(pts);
    const c = centroid(pts);
    for (const v of f.v) {
      const k = key(f.owner, v);
      normals.set(k, add(normals.get(k) ?? [0, 0, 0], n));
      pulls.set(k, add(pulls.get(k) ?? [0, 0, 0], norm(sub(c, positions[v]!))));
      let set = ownersAt.get(v);
      if (!set) ownersAt.set(v, (set = new Set()));
      set.add(f.owner);
    }
  }
  const isGlass = (owner: string): boolean => /^(window|vent|quarter)_/.test(owner);

  /** Where `owner` draws vertex v after the cut. */
  const placed = (owner: string, v: number, glassOwner: boolean): Vec3 => {
    const p = positions[v]!;
    const n = norm(normals.get(key(owner, v)) ?? [0, 0, 0]);
    if (glassOwner) return add(p, scale(n, -GLASS_INSET));
    const others = ownersAt.get(v)!;
    let shared = false;
    for (const o of others) {
      if (o === owner || isGlass(o)) continue;
      // Body glass (windscreen, fixed panes) shares the body owner: no gap there.
      if (MOVING.test(o) || MOVING.test(owner)) shared = true;
    }
    if (!shared) return p;
    const pull = pulls.get(key(owner, v)) ?? [0, 0, 0];
    // In the surface: take the pull's part along the normal out.
    const tangent = norm(sub(pull, scale(n, dot(pull, n))));
    return add(p, scale(tangent, SHUT_GAP / 2));
  };

  const builders = new Map<string, PartBuilder>();
  const builderOf = (owner: string): PartBuilder => {
    let b = builders.get(owner);
    if (!b) builders.set(owner, (b = new PartBuilder()));
    return b;
  };

  const glassFaceOwners = new Set<string>();
  for (const f of faces) {
    const glassFace = f.mat === 'glass';
    if (glassFace) glassFaceOwners.add(f.owner);
    const pts = f.v.map((v) => placed(f.owner, v, glassFace));
    const b = builderOf(f.owner);
    if (f.mat === 'dark') b.color(SHELL_COLOURS.wheelWell).poly('trim', pts);
    else b.poly(glassFace ? 'glass' : 'paint', pts);
  }

  // Edges, with the faces on each side.
  const edges = new Map<string, { a: number; b: number; faces: Face[] }>();
  for (const f of faces) {
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i]!;
      const b = f.v[(i + 1) % f.v.length]!;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = edges.get(k);
      if (!e) edges.set(k, (e = { a, b, faces: [] }));
      e.faces.push(f);
    }
  }

  // The lining: lined faces offset inward along normals of the lined faces alone, so it is
  // one closed skin over pillars, headers, rail and roof.
  const liningNormals = new Map<number, Vec3>();
  for (const f of faces) {
    if (!f.lined) continue;
    const n = newell(f.v.map((i) => positions[i]!));
    for (const v of f.v) liningNormals.set(v, add(liningNormals.get(v) ?? [0, 0, 0], n));
  }
  const lined = (v: number): Vec3 => add(placed('body', v, false), scale(norm(liningNormals.get(v)!), -LINING_DEPTH));
  /** Where a frame's inner side is at vertex v: the lining, or a moving part's inner skin. */
  const innerOf = (f: Face, v: number): Vec3 | undefined => {
    if (f.lined) return lined(v);
    if (!MOVING.test(f.owner)) return undefined;
    const depth = f.owner.startsWith('door') ? DOOR_THICKNESS : LID_THICKNESS;
    return add(placed(f.owner, v, false), scale(norm(normals.get(key(f.owner, v))!), -depth));
  };

  for (const { a, b, faces: pair } of edges.values()) {
    if (pair.length !== 2) continue;
    const [f0, f1] = pair as [Face, Face];
    const g0 = f0.mat === 'glass';
    const g1 = f1.mat === 'glass';
    if (g0 && g1) continue;
    if (g0 || g1) {
      // Rubber return from the frame's edge back to the pane, and on from the pane to the
      // frame's inner side, so no painted inside shows round a pane from the cabin.
      const pane = g0 ? f0 : f1;
      const frameFace = g0 ? f1 : f0;
      const fa = placed(frameFace.owner, a, false);
      const fb = placed(frameFace.owner, b, false);
      const ga = placed(pane.owner, a, true);
      const gb = placed(pane.owner, b, true);
      const rubber = builderOf(frameFace.owner).color(SHELL_COLOURS.rubber);
      rubber.poly('trim', [fa, fb, gb, ga]);
      const ia = innerOf(frameFace, a);
      const ib = innerOf(frameFace, b);
      if (ia && ib) rubber.poly('trim', [ga, gb, ib, ia]);
      continue;
    }
    if (f0.owner === f1.owner) continue;
    if (!MOVING.test(f0.owner) && !MOVING.test(f1.owner)) continue;
    // Round the greenhouse the jamb and the part's edge are the seal's: rubber.
    const seal = f0.lined || f1.lined;
    for (const f of [f0, f1]) {
      const pa = placed(f.owner, a, false);
      const pb = placed(f.owner, b, false);
      const na = norm(normals.get(key(f.owner, a))!);
      const nb = norm(normals.get(key(f.owner, b))!);
      const moving = MOVING.test(f.owner);
      const depth = moving ? (f.owner.startsWith('door') ? DOOR_THICKNESS : LID_THICKNESS) : JAMB_DEPTH;
      const edge = [pa, pb, add(pb, scale(nb, -depth)), add(pa, scale(na, -depth))];
      if (seal) builderOf(f.owner).color(SHELL_COLOURS.rubber).poly('trim', edge);
      else builderOf(f.owner).poly('paint', edge);
    }
  }

  // Inner skins of the moving panels: a door's and a tailgate's are trim in the
  // upholstery's colour (a door card below the belt, the frame's lining above it); a
  // bonnet's, a boot lid's and the flap's are painted steel.
  for (const f of faces) {
    if (!MOVING.test(f.owner) || f.mat === 'glass') continue;
    const pts = f.v.map((v) => innerOf(f, v)!).reverse();
    const b = builderOf(f.owner);
    if (f.owner.startsWith('door') || f.owner === 'tailgate') b.color(frame.spec.look.upholstery).poly('trim', pts);
    else b.poly('paint', pts);
  }

  const lining: Vec3[][] = [];
  for (const f of faces) if (f.lined) lining.push(f.v.map(lined).reverse());

  // Pivots: hinges at the leading edge (doors, flap), rear edge (bonnet), front edge
  // (boot) and top edge (tailgate); panes slide or swing about their own frame.
  const parts: ShellPart[] = [];
  let triangles = 0;
  for (const [owner, builder] of builders) {
    const verts: Vec3[] = [];
    for (const f of faces) if (f.owner === owner) for (const v of f.v) verts.push(positions[v]!);
    const pivot = pivotOf(owner, verts);
    triangles += builder.triangleCount();
    parts.push({ owner, builder, pivot });
  }
  return { parts, triangles, lining };
}

function pivotOf(owner: string, verts: readonly Vec3[]): Vec3 {
  if (owner === 'body' || verts.length === 0) return [0, 0, 0];
  let maxZ = -Infinity;
  let minZ = Infinity;
  let maxY = -Infinity;
  let minY = Infinity;
  for (const p of verts) {
    maxZ = Math.max(maxZ, p[2]);
    minZ = Math.min(minZ, p[2]);
    maxY = Math.max(maxY, p[1]);
    minY = Math.min(minY, p[1]);
  }
  const near = (z: number): Vec3[] => verts.filter((p) => Math.abs(p[2] - z) < 0.02);
  const widest = (ps: readonly Vec3[]): number => ps.reduce((m, p) => (Math.abs(p[0]) > Math.abs(m) ? p[0] : m), 0);
  if (owner.startsWith('door_') || owner === 'flap') {
    // Hinge line at the door's front edge, on its outer skin.
    const front = near(maxZ);
    return [widest(front), (minY + maxY) / 2, maxZ];
  }
  if (owner === 'bonnet') {
    const rear = near(minZ);
    return [0, Math.max(...rear.map((p) => p[1])), minZ];
  }
  if (owner === 'boot') {
    const front = near(maxZ);
    return [0, Math.max(...front.map((p) => p[1])), maxZ];
  }
  if (owner === 'tailgate') {
    const top = verts.reduce((m, p) => (p[1] > m[1] ? p : m), verts[0]!);
    return [0, top[1], top[2]];
  }
  if (owner.startsWith('vent_')) {
    // Swings about its rear post.
    const rear = near(minZ);
    const low = rear.reduce((m, p) => (p[1] < m[1] ? p : m), rear[0]!);
    return low;
  }
  // Drop glass slides straight down: pivot at its own bottom.
  return [0, minY, (minZ + maxZ) / 2];
}

/**
 * Where a part bolted to the outside (an end face's lamp, panel or grille, a corner lamp,
 * a moulding) stands on the shell: an outline on the skin (`Outline`), whose part's walls
 * reach into the body round it. The skin under it is cut away (`cutShellHoles`): a face
 * hidden under a part but within millimetres of it fights the part in the depth buffer at
 * a distance, and the shell is drawn out to the far traffic's reach.
 */
export interface KitHole {
  /** The shell part it stands on: `body`, `door_fl`, `boot`, `bonnet`, `tailgate`, `flap`, … */
  readonly owner: string;
  readonly outline: Outline;
}

/**
 * Cuts the skin of each shell part (its `paint` mesh) away under the holes standing on it
 * (`cutUnder`). Run once every part is built, before the ends lean.
 */
export function cutShellHoles(root: THREE.Object3D, holes: readonly KitHole[]): void {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  for (const owner of new Set(holes.map((h) => h.owner))) {
    const node = owner === 'body' ? root : root.getObjectByName(owner);
    const mesh = node?.children.find((c) => c.name === `${owner}_paint`) as THREE.Mesh | undefined;
    if (!mesh) throw new Error(`Kit shell has no "${owner}_paint" to cut holes in`);
    const toCar = rootInverse.clone().multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const car = position.clone().applyMatrix4(toCar);
    const cut = cutUnder(Array.from(car.array), Array.from(color.array), holes.filter((h) => h.owner === owner).map((h) => h.outline));
    // Tags a tool hangs on the geometry per triangle (tools/kit-zfight.ts `prov`) follow the cut.
    const tags = mesh.geometry.userData.prov as unknown[] | undefined;
    if (tags) mesh.geometry.userData.prov = cut.from.map((i) => tags[i]);
    const local = new THREE.Float32BufferAttribute(cut.positions, 3).applyMatrix4(toCar.clone().invert());
    mesh.geometry.setAttribute('position', local);
    mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cut.colors, 3));
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
}
