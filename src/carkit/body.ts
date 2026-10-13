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
 *  - sets every pane back from its frame on a dark rubber return.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, table, type Vec3 } from './builder';
import type { CabinColumn, KitCarSpec, TubStation } from './spec';

/** Bevel under the sill: how far the side's bottom edge turns under. */
const SILL_BEVEL = 0.035;
/** Painted lip of wing between a wheel arch and a panel cut above it. */
const ARCH_LIP = 0.045;
/** Shut gap between a moving panel and the body. */
const SHUT_GAP = 0.006;
/** Depth of the jamb flange inside a gap. */
const JAMB_DEPTH = 0.045;
/** Thickness of a door (its card stands this far in from the skin); lids are thinner. */
export const DOOR_THICKNESS = 0.075;
const LID_THICKNESS = 0.035;
/** How far a pane sits behind its frame. */
const GLASS_INSET = 0.012;
/** Width of the wall a notched deck (`TubStation.notch`) rises in, just inside the notch. */
const NOTCH_WALL = 0.025;

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
    if (!this.notched) return [0, 0.5, (edge - this.spec.cabin.pillar) / edge, 1];
    // On a notched station the half row moves out to the wall's foot.
    const lid = this.lidX(s);
    return [0, lerp(0.5, (lid - NOTCH_WALL) / edge, this.notchWeight(s)), lid / edge, 1];
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

  /** Arch top at s for either axle, or -Infinity outside both arches. */
  archY(s: number): number {
    const w = this.spec.wheels;
    let best = -Infinity;
    for (const axle of [w.front, w.rear]) {
      const r = w.radius * w.arch;
      const d = s - axle;
      if (Math.abs(d) <= r) best = Math.max(best, w.radius + Math.sqrt(r * r - d * d));
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

  face(points: readonly Vec3[], owner: string, mat: Mat, fixed = false): void {
    const v: number[] = [];
    for (const p of points) {
      const i = this.vertex(p);
      if (!v.includes(i)) v.push(i);
    }
    if (v.length < 3) return;
    if (area(v.map((i) => this.positions[i]!)) < 1e-7) return;
    this.faces.push({ v, owner, mat, fixed });
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

/** Newell normal times area of a planar-ish polygon. */
function newell(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x / 2, y / 2, z / 2];
}

function area(points: readonly Vec3[]): number {
  const n = newell(points);
  return Math.hypot(n[0], n[1], n[2]);
}

function centroid(points: readonly Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const p of points) c = add(c, p);
  return scale(c, 1 / points.length);
}

/** Tub columns: stations, cabin columns, arch subdivisions and every cut line. */
function tubColumns(frame: BodyFrame): number[] {
  const spec = frame.spec;
  const s = new Set<number>();
  for (const st of spec.stations) s.add(st.s);
  for (const c of spec.cabin.columns) s.add(c.s);
  s.add(spec.bonnetFront);
  if (spec.bootEnd !== undefined) s.add(spec.bootEnd);
  s.add(spec.flap.s0);
  s.add(spec.flap.s1);
  const w = spec.wheels;
  const r = w.radius * w.arch;
  for (const axle of [w.front, w.rear]) {
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
  const { below, above } = sideCutRows(spec);
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

/** The side's cut lines, split by which side of the crease they fall on. */
function sideCutRows(spec: KitCarSpec): { below: number[]; above: number[] } {
  const meanCrease = spec.stations.reduce((sum, st) => sum + st.crease, 0) / spec.stations.length;
  const cuts = [spec.doorBottom, spec.flap.y0, spec.flap.y1].sort((a, b) => a - b);
  return { below: cuts.filter((y) => y < meanCrease), above: cuts.filter((y) => y >= meanCrease) };
}

/** Index of the side row a cut line becomes (see `sideColumn`). */
function sideRowIndex(spec: KitCarSpec, y: number): number {
  const { below, above } = sideCutRows(spec);
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
}

export function buildShell(frame: BodyFrame): ShellResult {
  const spec = frame.spec;
  const cabin = spec.cabin;
  const shell = new Shell();
  const P = (x: number, y: number, s: number): Vec3 => [x, y, frame.z(s)];
  const cols = tubColumns(frame);
  const hatch = spec.bootEnd === undefined;

  for (const side of [1, -1]) {
    // ---- tub sides, shoulder and deck ----
    const columns = cols.map((s) => {
      const sec = frame.section(s);
      const sideRows = sideColumn(frame, s);
      const fr = frame.deckFracs(s);
      const deck = fr.slice(1).reverse().concat([0]).map((f) => {
        const x = f * sec.r4[0];
        return [x, frame.deckY(s, x)] as [number, number];
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
      const doorRow = sideRowIndex(spec, spec.doorBottom);
      const flapRows = [sideRowIndex(spec, spec.flap.y0), sideRowIndex(spec, spec.flap.y1)];
      for (let i = 0; i + 1 < aSide.length; i++) {
        const pa0 = aSide[i]!;
        const pa1 = aSide[i + 1]!;
        const pb0 = bSide[i]!;
        const pb1 = bSide[i + 1]!;
        let owner = 'body';
        if (lower !== 'body' && i >= doorRow) owner = doorName(lower, side);
        if (side === (spec.flap.side === 'left' ? 1 : -1) && sMid > spec.flap.s0 && sMid < spec.flap.s1 && i >= flapRows[0]! && i < flapRows[1]!) {
          owner = 'flap';
        }
        shell.face(
          [P(side * pa0[0], pa0[1], a.s), P(side * pb0[0], pb0[1], b.s), P(side * pb1[0], pb1[1], b.s), P(side * pa1[0], pa1[1], a.s)],
          owner,
          'paint',
        );
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
          if (sMid > spec.bonnetFront && sMid < frame.cowl) owner = 'bonnet';
          if (spec.bootEnd !== undefined && sMid > frame.rearBase && sMid < spec.bootEnd) owner = 'boot';
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
      const r = w.radius * w.arch;
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
    for (const [x, y] of half) ring.push(P(x, y, s));
    ring.push(P(0, sec.st.deck, s));
    for (let i = half.length - 1; i >= 0; i--) ring.push(P(-half[i]![0], half[i]![1], s));
    // An end face is concave where an estate's deck dips to its tailgate sill: a fan would
    // span the notch, so the face is cut into triangles that keep to its outline.
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, c] of tris) shell.face([ring[a]!, ring[b]!, ring[c]!], 'body', 'paint');
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
        const b: Vec3 = P(side * x, frame.deckY(s, x), s);
        const crownY = cabin.rail + cabin.crown * (1 - frac * frac);
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
    cabin.columns.forEach((column, i) => {
      const sec = frame.section(column.s);
      const b: Vec3 = P(side * sec.r4[0], sec.r4[1], column.s);
      const t: Vec3 = P(side * cabin.railHalf, cabin.rail, column.top);
      const last = i === cabin.columns.length - 1;
      let k = along(b, t, b[1] + cabin.glassBottom);
      let q = along(b, t, t[1] - cabin.glassTop);
      if (last && cabin.rearKnee) {
        // The rear corner folds where the tailgate does, so the D pillar lies flush with
        // the tailgate's glass instead of standing out behind it.
        const kt = Math.max(0, (cabin.rearKnee.y - b[1]) / (t[1] - b[1]));
        k = [lerp(b[0], t[0], kt), lerp(b[1], t[1], kt), frame.z(cabin.rearKnee.s)];
        q = along(k, t, t[1] - cabin.glassTop);
      }
      const inset = i === 0 ? cabin.railInset : last ? -cabin.railInset : 0;
      const u: Vec3 = P(side * (cabin.railHalf - cabin.railInset), cabin.rail + cabin.railRise, column.top + inset);
      ring.push({ b, k, q, t, u, kind: 'side', frac: 1, column });
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
          shell.face([p0, p1, p2, p3], 'body', 'paint');
        } else if (band === 1 && glass !== null) {
          shell.face([p0, p1, p2, p3], glass, 'glass');
        } else {
          shell.face([p0, p1, p2, p3], upper, 'paint');
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
        shell.face([roofPoint(u0, fracs[k]!), roofPoint(u1, fracs[k]!), roofPoint(u1, fracs[k + 1]!), roofPoint(u0, fracs[k + 1]!)], 'body', 'paint');
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

  const beltAt = (z: number): number => frame.station(frame.zNose - z).belt;
  for (const { a, b, faces: pair } of edges.values()) {
    if (pair.length !== 2) continue;
    const [f0, f1] = pair as [Face, Face];
    const g0 = f0.mat === 'glass';
    const g1 = f1.mat === 'glass';
    if (g0 && g1) continue;
    if (g0 || g1) {
      // Rubber return from the frame's edge back to the pane.
      const pane = g0 ? f0 : f1;
      const frameFace = g0 ? f1 : f0;
      const fa = placed(frameFace.owner, a, false);
      const fb = placed(frameFace.owner, b, false);
      const ga = placed(pane.owner, a, true);
      const gb = placed(pane.owner, b, true);
      builderOf(frameFace.owner).color(SHELL_COLOURS.rubber).poly('trim', [fa, fb, gb, ga]);
      continue;
    }
    if (f0.owner === f1.owner) continue;
    if (!MOVING.test(f0.owner) && !MOVING.test(f1.owner)) continue;
    for (const f of [f0, f1]) {
      const pa = placed(f.owner, a, false);
      const pb = placed(f.owner, b, false);
      const na = norm(normals.get(key(f.owner, a))!);
      const nb = norm(normals.get(key(f.owner, b))!);
      const moving = MOVING.test(f.owner);
      const depth = moving ? (f.owner.startsWith('door') ? DOOR_THICKNESS : LID_THICKNESS) : JAMB_DEPTH;
      builderOf(f.owner).poly('paint', [pa, pb, add(pb, scale(nb, -depth)), add(pa, scale(na, -depth))]);
    }
  }

  // Inner skins of the moving panels: a door card below the belt, painted steel above.
  for (const f of faces) {
    if (!MOVING.test(f.owner) || f.mat === 'glass') continue;
    const door = f.owner.startsWith('door');
    const depth = door ? DOOR_THICKNESS : LID_THICKNESS;
    const pts = f.v.map((v) => add(placed(f.owner, v, false), scale(norm(normals.get(key(f.owner, v))!), -depth))).reverse();
    const c = centroid(pts);
    const card = door && c[1] < beltAt(c[2]) + 0.02;
    const b = builderOf(f.owner);
    if (card) b.color(frame.spec.look.upholstery).poly('trim', pts);
    else b.poly('paint', pts);
  }

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
  return { parts, triangles };
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
