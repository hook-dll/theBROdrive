/**
 * Everything bolted to the outside of the shell: bumpers, grille and lamps on the nose
 * and the tail, mirrors, door handles, the wipers and the filler behind the flap.
 *
 * The ends are data: `KitLook.front` / `.rear` list the parts on each end face (see
 * `FaceItem` in spec.ts), placed against the face's own lines — the bumper's band, the
 * belt and the deck edge — so a face carries over to another body of the same family.
 *
 * Lamp lenses go in their lamp slots (materials.ts), which is what names their meshes
 * for the def's `lights`: a lens is one mesh per role, so the vehicle (or the lab's rig)
 * lights the whole role at once. The wipers are pivots on `wiper_sweep`.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, table, type KitSlot, type Vec3 } from './builder';
import { addBuilt, pivotGroup, type KitContext } from './context';
import { skinX, type BodyFrame } from './body';
import type { CornerLampPoint, FaceAnchor, FaceItem, FaceLook, FaceX, FaceY, Finish, LampRole, Span } from './spec';

const CHROME_TRIM = 0xb8bec3;
const BLACK = 0x161718;
const GRILLE_DARK = 0x0d0e0f;
const RUBBER = 0x202122;
const GREY_PLASTIC = 0x4e5358;

/** A lamp lens: a shallow bevelled block on a face, in the given slot. */
function lens(b: PartBuilder, slot: KitSlot, centre: Vec3, half: Vec3): void {
  b.bevelBox(slot, centre, half, Math.min(half[0], half[1]) * 0.35);
}

/** Front and rear faces of the tub: the first and last stations. */
function ends(frame: BodyFrame): { front: number; tail: number } {
  const st = frame.spec.stations;
  return { front: st[0]!.s, tail: st[st.length - 1]!.s };
}

/**
 * Height band of a bumper: a blade is a slim bar centred `lift` over the sill's bevel, a
 * moulded bumper a deep band from `drop` under it.
 */
function bumperBand(frame: BodyFrame, end: 1 | -1): { y0: number; y1: number } {
  const { front, tail } = ends(frame);
  const sec = frame.section(end > 0 ? front : tail);
  const bumper = (end > 0 ? frame.spec.look.front : frame.spec.look.rear).bumper;
  if (bumper.kind === 'blade') {
    const y = sec.r1[1] + bumper.lift;
    return { y0: y - bumper.height / 2, y1: y + bumper.height / 2 };
  }
  const y0 = sec.r1[1] - bumper.drop;
  return { y0, y1: y0 + bumper.height };
}

interface SweepPoint {
  readonly x: number;
  readonly z: number;
  /** Outward direction in plan. */
  readonly nx: number;
  readonly nz: number;
  /** How far the section reaches outward here, metres. */
  readonly depth: number;
}

/**
 * Sweeps a section — (outward fraction 0..1, height) pairs — along a path in plan,
 * capping both ends: a bumper that turns round the corners in one piece.
 */
function sweep(b: PartBuilder, slot: KitSlot, path: readonly SweepPoint[], section: readonly (readonly [number, number])[]): void {
  const rings: Vec3[][] = path.map((p) => section.map(([o, y]) => [p.x + p.nx * o * p.depth, y, p.z + p.nz * o * p.depth] as Vec3));
  for (let i = 0; i + 1 < rings.length; i++) b.bridge(slot, rings[i]!, rings[i + 1]!, true);
  b.poly(slot, rings[0]!);
  b.poly(slot, [...rings[rings.length - 1]!].reverse());
}

/**
 * Plan path of a bumper across one end of the car: back along each flank by `wrap`,
 * round the corner (radius `r`) and across the face, standing `standoff` off the face.
 */
function bumperPath(half: number, zFace: number, end: 1 | -1, depth: number, standoff: number, wrap: number, r = 0.09): SweepPoint[] {
  const z = zFace + end * standoff;
  const side = (sx: number): SweepPoint[] => [
    { x: sx * half, z: z - end * wrap, nx: sx, nz: 0, depth: depth * 0.3 },
    { x: sx * half, z: z - end * r * 0.4, nx: sx, nz: 0, depth: depth * 0.4 },
    { x: sx * (half - r * 0.3), z: z - end * r * 0.1, nx: sx * 0.7071, nz: end * 0.7071, depth: depth * 0.75 },
    { x: sx * (half - r), z, nx: 0, nz: end, depth: depth * 0.95 },
  ];
  const left = side(1);
  const right = side(-1).reverse();
  // Wound so the swept faces face out at both ends of the car.
  const path = [...left, { x: 0, z, nx: 0, nz: end, depth }, ...right];
  return end > 0 ? path.reverse() : path;
}

/** How far a bumper that follows the flanks (`wrapTo`) stands off the side. */
const BUMPER_FLANK_OUT = 0.006;
/** Points along each flank of such a bumper. */
const BUMPER_FLANK_STEPS = 5;

/**
 * Plan path of a moulded bumper whose sides follow the flanks back to `wrapTo` (spec.ts
 * `wrapTo`): across the face and round a corner of radius `r` as `bumperPath`, then along
 * each flank just outside the body at the bumper's top height, so its side lies flush on
 * the wing and runs on to the wheel arch. `grow` and `depth` as in `bumperPath`.
 */
function flankBumperPath(frame: BodyFrame, sEnd: number, end: 1 | -1, top: number, depth: number, grow: number, wrapTo: number, r: number): SweepPoint[] {
  const z = frame.z(sEnd) - end * 0.01;
  const sideDepth = depth * 0.3;
  // The path stands `sideDepth` inside the flank so the section's outer face is just outside it.
  const base = (s: number): number => frame.sideX(s, top) + BUMPER_FLANK_OUT + grow - sideDepth;
  const sCorner = sEnd + end * (0.01 + r * 0.4);
  const halfCorner = base(sCorner);
  const side = (sx: number): SweepPoint[] => [
    ...Array.from({ length: BUMPER_FLANK_STEPS }, (_, k): SweepPoint => {
      const s = lerp(wrapTo, sCorner, k / (BUMPER_FLANK_STEPS - 1));
      return { x: sx * base(s), z: frame.z(s), nx: sx, nz: 0, depth: sideDepth };
    }),
    { x: sx * (halfCorner - r * 0.3), z: z - end * r * 0.1, nx: sx * 0.7071, nz: end * 0.7071, depth: depth * 0.75 },
    { x: sx * (halfCorner - r), z, nx: 0, nz: end, depth: depth * 0.95 },
  ];
  const path = [...side(1), { x: 0, z, nx: 0, nz: end, depth }, ...side(-1).reverse()];
  return end > 0 ? path.reverse() : path;
}

/** The lamp slot a role draws in; a blinker takes its side's. */
function lampSlot(role: LampRole, side: number): KitSlot {
  switch (role) {
    case 'head':
      return 'lamp_head';
    case 'tail':
      return 'lamp_tail';
    case 'brake':
      return 'lamp_brake';
    case 'reverse':
      return 'lamp_reverse';
    case 'inert':
      return 'lamp_inert';
    case 'blinker':
      return side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r';
  }
}

function finishSlot(finish: Finish | 'dark'): { slot: KitSlot; color: number } {
  switch (finish) {
    case 'chrome':
      return { slot: 'chrome', color: CHROME_TRIM };
    case 'alloy':
      // Bare aluminium: the duller steel of the wheel rims.
      return { slot: 'rim', color: CHROME_TRIM };
    case 'rubber':
      return { slot: 'trim', color: RUBBER };
    case 'grey':
      return { slot: 'trim', color: GREY_PLASTIC };
    case 'black':
      return { slot: 'trim', color: BLACK };
    case 'paint':
      // Body colour: drawn in the paint slot, so it takes the car's colour, dust and scratches.
      return { slot: 'paint', color: 0xffffff };
    case 'dark':
      return { slot: 'trim', color: GRILLE_DARK };
  }
}

/**
 * One end face, resolved: its plane, half width and lines, and how a description's
 * positions land on it. `facing` is +1 at the nose and -1 at the tail.
 */
class EndFace {
  readonly z: number;
  readonly half: number;
  private readonly lines: Readonly<Record<FaceAnchor, number>>;

  constructor(frame: BodyFrame, readonly facing: 1 | -1) {
    const { front, tail } = ends(frame);
    const s = facing > 0 ? front : tail;
    const sec = frame.section(s);
    const bumper = bumperBand(frame, facing);
    const deck = frame.deckY(s, sec.r4[0]);
    this.z = frame.z(s);
    this.half = sec.r2[0];
    this.lines = { bumperTop: bumper.y1, bumperBottom: bumper.y0, belt: sec.r3[1], deck, mid: (bumper.y1 + deck) / 2 };
  }

  /** The plane `d` out of the face (negative: into the body). */
  out(d: number): number {
    return this.z + this.facing * d;
  }

  x(at: FaceX): number {
    return 'centre' in at ? at.centre : this.half - at.inset;
  }

  y(at: FaceY): number {
    return this.lines[at[0]] + at[1];
  }

  /** Centre and half size of a span. */
  spanX(span: Span<FaceX>): [number, number] {
    return 'at' in span ? [this.x(span.at), span.half] : centreHalf(this.x(span.from), this.x(span.to));
  }

  spanY(span: Span<FaceY>): [number, number] {
    return 'at' in span ? [this.y(span.at), span.half] : centreHalf(this.y(span.from), this.y(span.to));
  }
}

function centreHalf(a: number, b: number): [number, number] {
  return [(a + b) / 2, Math.abs(b - a) / 2];
}

type P2 = [number, number];

/** Builds one end face's items, in order. Items off the centre line go on both sides. */
function buildFace(frame: BodyFrame, look: FaceLook, facing: 1 | -1, b: PartBuilder): void {
  const face = new EndFace(frame, facing);
  for (const item of look.items) buildFaceItem(face, item, b);
}

function buildFaceItem(face: EndFace, item: FaceItem, b: PartBuilder): void {
  switch (item.kind) {
    case 'panel': {
      const [y, hy] = face.spanY(item.y);
      const { slot, color } = finishSlot(item.finish);
      if ('centre' in item.x || 'inset' in item.x) {
        const x = face.x(item.x);
        b.color(color).boxFrom(slot, [-x, y - hy, face.out(-0.01)], [x, y + hy, face.out(item.proud)]);
        return;
      }
      // A block on each side.
      const [x, hx] = face.spanX(item.x);
      b.color(color);
      for (const side of [1, -1]) b.boxFrom(slot, [side * x - hx, y - hy, face.out(-0.01)], [side * x + hx, y + hy, face.out(item.proud)]);
      return;
    }
    case 'round': {
      const x = face.x(item.x);
      const y = face.y(item.y);
      for (const side of [1, -1]) {
        // A chrome ring on the face and the lens standing on it. The ring reaches 1 mm into
        // the face and 26 mm out of it, so neither cap lies in the face or in a grille's
        // front 24 mm out (the 2103's lamps stand on its grille).
        b.color(CHROME_TRIM).cylinderZ('chrome', [side * x, y, face.out(0.0125)], item.radius * 1.18, 0.0135, 12);
        b.cylinderZ(lampSlot(item.role, side), [side * x, y, face.out(0.024)], item.radius, 0.01, 12);
      }
      return;
    }
    case 'lens': {
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      // A lens centred on the centre line is one lens across it (the 2110's lid reflector).
      for (const side of x === 0 ? [1] : [1, -1]) {
        const slot = lampSlot(item.role, side);
        if (!item.slant) {
          lens(b, slot, [side * x, y, face.out(item.proud)], [hx, hy, item.depth]);
          continue;
        }
        // A slab on the face whose top edge's ends stand `slant` inboard of the bottom's:
        // outline in (x, y) counter-clockwise from the inner bottom corner, extruded out.
        const slant = item.slant;
        const outline = ([[x - hx, y - hy], [x + hx, y - hy], [x + hx - slant.outer, y + hy], [x - hx - slant.inner, y + hy]] as P2[]).map(([px, py]): P2 => [side * px, py]);
        // Counter-clockwise seen from outside the face, whichever side and end.
        if (side * face.facing < 0) outline.reverse();
        const z0 = face.out(item.proud - item.depth);
        const z1 = face.out(item.proud + item.depth);
        b.extrude(slot, outline, Math.min(z0, z1), Math.max(z0, z1));
      }
      return;
    }
    case 'grille': {
      const gw = face.x(item.x);
      const [y, hy] = face.spanY(item.y);
      // A grille standing out of the face is a box from the face to its front.
      const so = item.standOut ?? 0;
      if (item.frame) {
        // Sunk 4 mm into the face, as a `frame` item: its back is not in the face's plane.
        const m = item.frame.margin;
        const { slot, color } = finishSlot(item.frame.finish);
        b.color(color).boxFrom(slot, [-gw - m, y - hy - m, face.out(-0.004)], [gw + m, y + hy + m, face.out(so + 0.02)]);
      }
      // The dark back reaches 2 mm past the slot every way, so bars that span the slot end
      // inside it rather than on its faces.
      if (item.back) b.color(GRILLE_DARK).boxFrom('trim', [-gw - 0.002, y - hy - 0.002, face.out(so + 0.006)], [gw + 0.002, y + hy + 0.002, face.out(so + 0.024)]);
      const bars = item.bars;
      const { slot, color } = finishSlot(bars.finish);
      b.color(color);
      const z0 = face.out(so + bars.proud - bars.depth);
      const z1 = face.out(so + bars.proud);
      const w = bars.width / 2;
      for (let i = 0; i < bars.count; i++) {
        const t = bars.count > 1 ? i / (bars.count - 1) : 0.5;
        if (bars.dir === 'vertical') {
          const x = -gw + bars.margin + t * 2 * (gw - bars.margin);
          b.boxFrom(slot, [x - w, y - hy, z0], [x + w, y + hy, z1]);
        } else {
          const by = y - hy + bars.margin + t * 2 * (hy - bars.margin);
          b.boxFrom(slot, [-gw, by - w, z0], [gw, by + w, z1]);
        }
      }
      return;
    }
    case 'cluster': {
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      const outer = x + hx;
      const inner = x - hx;
      const w = (outer - inner) / item.columns.length;
      for (const side of [1, -1]) {
        b.color(BLACK).boxFrom('trim', [side > 0 ? inner - 0.012 : -outer - 0.012, y - hy - 0.012, face.out(0.006)], [side > 0 ? outer + 0.012 : -inner + 0.012, y + hy + 0.012, face.out(-0.002)]);
        item.columns.forEach((roles, k) => {
          const cx = outer - (k + 0.5) * w;
          const rowH = (2 * hy) / roles.length;
          roles.forEach((role, r) => {
            const cy = y + hy - (r + 0.5) * rowH;
            lens(b, lampSlot(role, side), [side * cx, cy, face.out(0.01)], [w / 2 - 0.004, rowH / 2 - 0.004, 0.01]);
          });
        });
      }
      return;
    }
    case 'frame': {
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      const { slot, color } = finishSlot(item.finish);
      const t = item.width;
      const z0 = face.out(-0.004);
      const z1 = face.out(item.proud);
      b.color(color);
      for (const side of Math.abs(x) < 1e-6 ? [1] : [1, -1]) {
        const cx = side * x;
        b.boxFrom(slot, [cx - hx, y + hy - t, z0], [cx + hx, y + hy, z1]);
        b.boxFrom(slot, [cx - hx, y - hy, z0], [cx + hx, y - hy + t, z1]);
        b.boxFrom(slot, [cx - hx, y - hy + t, z0], [cx - hx + t, y + hy - t, z1]);
        b.boxFrom(slot, [cx + hx - t, y - hy + t, z0], [cx + hx, y + hy - t, z1]);
      }
      return;
    }
  }
}

function buildBumpers(ctx: KitContext, b: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  const { front, tail } = ends(frame);
  const widest = spec.stations.reduce((m, st) => Math.max(m, st.wCrease), 0);
  for (const end of [1, -1] as const) {
    const sEnd = end > 0 ? front : tail;
    const reach = end > 0 ? sEnd : spec.length - sEnd;
    const sec = frame.section(sEnd);
    const zFace = frame.z(sEnd);
    const { y0, y1 } = bumperBand(frame, end);
    const bumper = (end > 0 ? spec.look.front : spec.look.rear).bumper;
    if (bumper.kind === 'blade') {
      // A bar on brackets, its ends turned back round the corners.
      const blade = bumper.depth;
      // Inside the published width even where the ends wrap round the corners.
      const half = Math.min(sec.r2[0] + 0.02, widest - blade * 0.35);
      const y = (y0 + y1) / 2;
      const path = bumperPath(half, zFace, end, blade, reach - blade, 0.16);
      const main = finishSlot(bumper.finish);
      if (bumper.lower) {
        // Two-tone: the lower share of the bar in its own finish, split on a flat line.
        const ym = y0 + bumper.lower.share * (y1 - y0);
        const low = finishSlot(bumper.lower.finish);
        b.color(low.color);
        sweep(b, low.slot, path, [[0, y0], [0.75, y0], [1, y0 + 0.025], [1, ym], [0, ym]]);
        b.color(main.color);
        sweep(b, main.slot, path, [[0, ym], [1, ym], [1, y1 - 0.025], [0.75, y1], [0, y1]]);
      } else {
        b.color(main.color);
        sweep(b, main.slot, path, [[0, y0], [0.75, y0], [1, y0 + 0.025], [1, y1 - 0.025], [0.75, y1], [0, y1]]);
      }
      if (bumper.strip) {
        const strip = finishSlot(bumper.strip);
        b.color(strip.color);
        sweep(b, strip.slot, bumperPath(half, zFace, end, blade + 0.004, reach - blade, 0.15), [[0.9, y - 0.012], [1, y - 0.012], [1, y + 0.012], [0.9, y + 0.012]]);
      }
      if (bumper.ends) {
        // Caps over the wrapped ends: the path's first and last three points, a size up.
        const caps = bumperPath(half + 0.004, zFace, end, blade + 0.006, reach - blade, 0.17);
        const cap = finishSlot(bumper.ends);
        b.color(cap.color);
        const section: [number, number][] = [[0, y0 - 0.006], [1, y0 - 0.006], [1, y1 + 0.006], [0, y1 + 0.006]];
        sweep(b, cap.slot, caps.slice(0, 3), section);
        sweep(b, cap.slot, caps.slice(-3), section);
      }
      for (const side of [1, -1]) {
        const o = bumper.overriders;
        if (o) {
          const finish = finishSlot(o.finish);
          b.color(finish.color).bevelBox(finish.slot, [side * (half - o.inset), y - o.drop, zFace + end * (reach - 0.02)], [o.half[0], o.half[1], 0.028], 0.012);
        }
        // Bracket from the body to the blade.
        b.color(BLACK).boxFrom('trim', [side * (half - 0.32) - 0.02, y - 0.02, Math.min(zFace, zFace + end * (reach - blade))], [side * (half - 0.32) + 0.02, y + 0.02, Math.max(zFace, zFace + end * (reach - blade))]);
      }
    } else {
      // Moulded plastic bumper: deep, wrapping the corners, its face bevelled top and
      // bottom and its foot drawn in, with a moulding groove along it.
      const depth = reach + 0.01;
      // As wide as the face at its widest, which on a leaning nose is low down.
      const half = Math.min(Math.max(sec.r1[0], sec.r2[0]) + 0.03, widest - depth * 0.35);
      const wrapTo = bumper.wrapTo;
      const pathOf = (grow: number, d: number, wrap: number): SweepPoint[] =>
        wrapTo === undefined
          ? bumperPath(half + grow, zFace - end * 0.01, end, d, 0, wrap, bumper.corner)
          : flankBumperPath(frame, sEnd, end, y1, d, grow, wrapTo, bumper.corner ?? 0.09);
      const shell = bumper.finish ? finishSlot(bumper.finish) : { slot: 'trim' as const, color: 0x232427 };
      b.color(shell.color);
      // A flush bumper's top starts inside the body's skin and rounds out to its face in
      // its top 60 mm, so it grows out of the end face and the flanks with no ledge.
      const top: [number, number][] = bumper.flush
        ? [[1, y1 - 0.06], [0.5, y1 - 0.015], [0, y1]]
        : [[1, y1 - 0.05], [0.9, y1 - 0.005], [0.55, y1], [0, y1]];
      sweep(b, shell.slot, pathOf(0, depth, 0.2), [[0, y0 + 0.02], [0.7, y0], [0.92, y0 + 0.03], [1, y0 + 0.08], ...top]);
      const path = pathOf(0.003, depth + 0.006, 0.19);
      if (bumper.moulding) {
        // A moulding band round the bumper in its own finish, in place of the groove.
        const band = finishSlot(bumper.moulding.finish);
        const h = bumper.moulding.height / 2;
        const y = bumper.moulding.y;
        b.color(band.color);
        sweep(b, band.slot, path, [[0.97, y - h], [1, y - h], [1, y + h], [0.97, y + h]]);
        continue;
      }
      const g = y0 + 0.11;
      // A painted bumper's groove is a ridge in its own colour.
      const groove = bumper.finish ? shell : { slot: 'trim' as const, color: 0x34363a };
      b.color(groove.color);
      sweep(b, groove.slot, path, [[0.97, g - 0.012], [1, g - 0.012], [1, g + 0.012], [0.97, g + 0.012]]);
    }
  }
}

/** The sill strip between the arches, in `KitLook.sill`'s finish. */
function buildSill(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  if (!spec.look.sill) return;
  const { slot, color } = finishSlot(spec.look.sill);
  const s0 = spec.wheels.front + spec.wheels.radius * frame.archFactor(spec.wheels.front) + 0.02;
  const s1 = spec.wheels.rear - spec.wheels.radius * frame.archFactor(spec.wheels.rear) - 0.02;
  body.color(color);
  for (const side of [1, -1]) {
    const y = frame.station((s0 + s1) / 2).sill + 0.045;
    const x = frame.sideX((s0 + s1) / 2, y) + 0.004;
    body.boxFrom(slot, [side > 0 ? x - 0.01 : -x - 0.004, y - 0.012, frame.z(s1)], [side > 0 ? x + 0.004 : -x + 0.01, y + 0.012, frame.z(s0)]);
  }
}

/** Gap left at each shut line where a waist moulding is broken. */
const MOULDING_GAP = 0.005;
/** Longest straight run of a moulding before it bends with the flank. */
const MOULDING_RUN = 0.3;
/** How far short of a wheel arch's edge a moulding low enough to meet it stops. */
const MOULDING_ARCH_GAP = 0.03;

/** A strip along each flank: the waist moulding, or a pressed feature line. */
interface FlankStrip {
  /** Centre height at s. */
  readonly yAt: (s: number) => number;
  readonly height: number;
  readonly slot: KitSlot;
  readonly color: number;
  /** How far it stands off the side. */
  readonly out: number;
  readonly first: number;
  readonly last: number;
  /** Node name suffix for the pieces riding on doors. */
  readonly name: string;
}

/**
 * A strip along each flank from `first` to `last`, following the side's plan, broken
 * where it crosses a door's shut lines so each door carries its own piece and swings with
 * it, and stopping short of a wheel arch it would run into (the 2115's door mouldings run
 * low, past the arches' tops).
 */
function buildFlankStrip(ctx: KitContext, body: PartBuilder, strip: FlankStrip): void {
  const { frame, nodes, root } = ctx;
  const spec = frame.spec;
  const { slot, color, first, last, out } = strip;
  root.updateMatrixWorld(true);
  // Each door's s range at rest: the car frame's z is `zNose - s`.
  const doors = [...nodes].filter(([owner]) => owner.startsWith('door_')).map(([owner, door]) => {
    const box = new THREE.Box3().setFromObject(door.node);
    return { owner, door, side: owner.endsWith('l') ? 1 : -1, s0: frame.zNose - box.max.z, s1: frame.zNose - box.min.z };
  });
  // The s ranges where an arch, grown by the gap, reaches up to the strip's bottom edge.
  const w = spec.wheels;
  const arches = [w.front, w.rear].flatMap((axle) => {
    const lift = strip.yAt(axle) - strip.height / 2 - w.radius;
    const reach = w.radius * frame.archFactor(axle) + MOULDING_ARCH_GAP;
    if (lift >= reach) return [];
    const d = lift > 0 ? Math.sqrt(reach * reach - lift * lift) : reach;
    return [[axle - d, axle + d] as const];
  });
  const builders = new Map<string, PartBuilder>();
  for (const side of [1, -1]) {
    const mine = doors.filter((d) => d.side === side);
    const cuts = [first, last, ...mine.flatMap((d) => [d.s0, d.s1]), ...arches.flat()].filter((s) => s >= first && s <= last).sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]! + MOULDING_GAP;
      const c = cuts[i + 1]! - MOULDING_GAP;
      if (c - a < 0.02) continue;
      const mid = (a + c) / 2;
      if (arches.some(([s0, s1]) => mid > s0 && mid < s1)) continue;
      const door = mine.find((d) => mid > d.s0 && mid < d.s1);
      const key = door?.owner ?? 'body';
      let b = builders.get(key);
      if (!b) builders.set(key, (b = key === 'body' ? body : new PartBuilder()));
      b.color(color);
      const pieces = Math.max(1, Math.ceil((c - a) / MOULDING_RUN));
      const point = (s: number, dy: number, o: number): Vec3 => [side * (frame.sideX(s, strip.yAt(s) + dy) + o), strip.yAt(s) + dy, frame.z(s)];
      const h = strip.height / 2;
      for (let k = 0; k < pieces; k++) {
        const s0 = a + ((c - a) * k) / pieces;
        const s1 = a + ((c - a) * (k + 1)) / pieces;
        b.quad(slot, point(s0, -h, out), point(s1, -h, out), point(s1, h, out), point(s0, h, out));
        b.quad(slot, point(s0, h, out), point(s1, h, out), point(s1, h, 0), point(s0, h, 0));
        b.quad(slot, point(s0, -h, 0), point(s1, -h, 0), point(s1, -h, out), point(s0, -h, out));
      }
      b.quad(slot, point(a, -h, 0), point(a, -h, out), point(a, h, out), point(a, h, 0));
      b.quad(slot, point(c, -h, out), point(c, -h, 0), point(c, h, 0), point(c, h, out));
    }
  }
  for (const { owner, door } of doors) {
    const b = builders.get(owner);
    if (b) addBuilt(door.node, b, door.pivot, `${owner}_${strip.name}`);
  }
}

/** The waist moulding (`KitLook.waist`), nose to tail at one height. */
function buildWaist(ctx: KitContext, body: PartBuilder): void {
  const spec = ctx.frame.spec;
  const waist = spec.look.waist;
  if (!waist) return;
  const st = spec.stations;
  buildFlankStrip(ctx, body, { yAt: () => waist.y, height: waist.height, ...finishSlot(waist.finish), out: 0.008, first: st[0]!.s + 0.02, last: st[st.length - 1]!.s - 0.02, name: 'waist' });
}

/** How far a feature line's ridge stands off the side. */
const FEATURE_LINE_OUT = 0.005;

/** The pressed feature line (`KitLook.featureLine`): a narrow ridge in the paint through its points. */
function buildFeatureLine(ctx: KitContext, body: PartBuilder): void {
  const line = ctx.frame.spec.look.featureLine;
  if (!line) return;
  const pts = line.points;
  buildFlankStrip(ctx, body, {
    yAt: (s) => table(pts, s),
    height: line.height,
    ...finishSlot('paint'),
    out: FEATURE_LINE_OUT,
    first: pts[0]![0],
    last: pts[pts.length - 1]![0],
    name: 'line',
  });
}

/** An amber repeater on each front wing (`KitLook.repeater`), in its side's blinker slot. */
function buildRepeaters(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const r = frame.spec.look.repeater;
  if (!r) return;
  const s = (r.s0 + r.s1) / 2;
  const y = (r.y0 + r.y1) / 2;
  for (const side of [1, -1]) {
    const x = side * (frame.sideX(s, y) + 0.004);
    lens(body, lampSlot('blinker', side), [x, y, frame.z(s)], [0.006, (r.y1 - r.y0) / 2, (r.s1 - r.s0) / 2]);
  }
}

/** How far a corner lamp's lens stands off the body: flush, just clear of the paint. */
const CORNER_LAMP_OUT = 0.004;
/** Longest step of a corner lamp along the flank, so it keeps to the curving side. */
const CORNER_LAMP_STEP = 0.02;

/**
 * Lamp units wrapping round the corners of an end face (`KitLook.cornerLamps`): a thin
 * lens lying on the face from its inner end to the corner and on along the flank, every
 * stretch between two points in its role's slot, with a rim down to the body.
 */
function buildCornerLamps(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const lamps = frame.spec.look.cornerLamps;
  if (!lamps) return;
  const stations = frame.spec.stations;
  const diag = CORNER_LAMP_OUT * Math.SQRT1_2;
  for (const lamp of lamps) {
    // The face it starts on, and which way that face looks along the car.
    const facing = lamp.end === 'rear' ? -1 : 1;
    const sFace = (facing > 0 ? stations[0]! : stations[stations.length - 1]!).s;
    const zFace = frame.z(sFace);
    for (const side of [1, -1]) {
      // A column across the lamp at a point, bottom, middle and top: [on the body, on the lens].
      const column = (p: CornerLampPoint): [Vec3, Vec3][] =>
        [p.y[0], (p.y[0] + p.y[1]) / 2, p.y[1]].map((y): [Vec3, Vec3] => {
          if (p.x !== undefined) {
            const [xb, xt] = typeof p.x === 'number' ? [p.x, p.x] : p.x;
            const x = side * lerp(xb, xt, (y - p.y[0]) / (p.y[1] - p.y[0]));
            return [[x, y, zFace], [x, y, zFace + facing * CORNER_LAMP_OUT]];
          }
          if (p.s !== undefined) {
            const x = skinX(frame, p.s, y);
            return [[side * x, y, frame.z(p.s)], [side * (x + CORNER_LAMP_OUT), y, frame.z(p.s)]];
          }
          const x = skinX(frame, sFace, y);
          return [[side * x, y, zFace], [side * (x + diag), y, zFace + facing * diag]];
        });
      const points = lamp.points;
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i]!;
        const c = points[i + 1]!;
        if (!a.role) throw new Error(`Kit car "${frame.spec.id}": a corner lamp's point before its last has no role`);
        const slot = lampSlot(a.role, side);
        // Off the face, the stretch steps along the flank so it keeps to the curving side.
        const sa = a.s ?? sFace;
        const sc = c.s ?? sFace;
        const steps = a.x === undefined && c.x === undefined ? Math.max(1, Math.ceil(Math.abs(sc - sa) / CORNER_LAMP_STEP)) : 1;
        const columns = Array.from({ length: steps + 1 }, (_, k) => {
          if (k === 0) return column(a);
          if (k === steps) return column(c);
          const t = k / steps;
          return column({ s: lerp(sa, sc, t), y: [lerp(a.y[0], c.y[0], t), lerp(a.y[1], c.y[1], t)] });
        });
        body.color(0xffffff);
        for (let k = 0; k < steps; k++) {
          const p = columns[k]!;
          const q = columns[k + 1]!;
          body.bridge(slot, p.map(([, o]) => o), q.map(([, o]) => o));
          // Its rim down to the body along the bottom and top edges.
          for (const r of [0, 2]) body.quad(slot, p[r]![0], q[r]![0], q[r]![1], p[r]![1]);
        }
        // And across its two ends.
        if (i === 0) body.bridge(slot, columns[0]!.map(([s]) => s), columns[0]!.map(([, o]) => o));
        if (i + 2 === points.length) body.bridge(slot, columns[steps]!.map(([s]) => s), columns[steps]!.map(([, o]) => o));
      }
    }
  }
}

/** Door hardware outside: handle, and a mirror on each front door, in `KitLook.brightwork`. */
function buildDoorHardware(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const spec = frame.spec;
  const chrome = spec.look.brightwork === 'chrome';
  const finish = finishSlot(spec.look.brightwork);
  for (const [owner, door] of nodes) {
    if (!owner.startsWith('door_')) continue;
    const side = owner.endsWith('l') ? 1 : -1;
    const front = owner.startsWith('door_f');
    const b = new PartBuilder();
    // The door's rear edge at the belt, from its pivot (front edge) and the cabin columns.
    const cols = spec.cabin.columns;
    const rearS = front
      ? cols.find((c) => c.lower === 'door1' && c.upper === 'body')?.s ?? cols.filter((c) => c.upper === 'door1').at(-1)!.s
      : cols.filter((c) => c.upper === 'door2').at(-1)!.s;
    const handleS = rearS - 0.13;
    const beltY = frame.station(handleS).belt;
    const y = beltY - (chrome ? 0.07 : 0.09);
    const x = side * (frame.sideX(handleS, y) + 0.006);
    b.color(finish.color).bevelBox(finish.slot, [x, y, frame.z(handleS)], chrome ? [0.012, 0.016, 0.075] : [0.012, 0.018, 0.07], 0.006);
    addBuilt(door.node, b, door.pivot, `${owner}_handle`);
    if (!front) continue;
    // Mirror: a stalk from the door's front top corner and a head on it.
    const ms = spec.cabin.columns[1]!.s + 0.08;
    const my = frame.station(ms).belt + 0.06;
    const mx = frame.sideX(ms, frame.station(ms).belt);
    const m = new PartBuilder().color(finish.color);
    m.boxFrom(finish.slot, [side > 0 ? mx - 0.01 : -mx - 0.07, my - 0.04, frame.z(ms) - 0.03], [side > 0 ? mx + 0.07 : -mx + 0.01, my - 0.02, frame.z(ms) + 0.03]);
    m.bevelBox(finish.slot, [side * (mx + 0.1), my + 0.02, frame.z(ms)], [0.06, 0.045, 0.025], 0.015);
    m.color(0x7a8a96).box('chrome', [side * (mx + 0.1), my + 0.02, frame.z(ms) - 0.026], [0.05, 0.035, 0.002]);
    const holder = new THREE.Group();
    holder.name = `${owner}_mirror`;
    addBuilt(holder, m, door.pivot, 'mirrors');
    for (const mesh of holder.children) mesh.name = 'mirrors';
    door.node.add(holder);
  }
}

/**
 * Wiper spindles across the car (+x is the left): the driver's just left of centre, the
 * passenger's towards the right corner. Both arms park lying to the left, the classic
 * Zhiguli's and the Samara's tandem on a left-hand-drive car.
 */
const WIPER_PIVOTS = [0.06, -0.34];
/** The spindles stand this far below the glass's bottom edge, in the screen's frame strip. */
const WIPER_PIVOT_BELOW = 0.015;
/** The most an arm sweeps from its park, about 100°, the Zhiguli's and the Samara's; and the least, 90°. */
const WIPER_SWEEP = 1.75;
const WIPER_SWEEP_MIN = Math.PI / 2;
/**
 * A parked arm lies at most this steep, low along the screen's foot; where a screen
 * curved in plan lifts its foot towards the pillar too far for that, at most the second.
 */
const WIPER_PARKS = [(20 * Math.PI) / 180, (45 * Math.PI) / 180];
/** The blade keeps this far inside the pane's sides and top: the pillars and header stand proud. */
const WIPER_EDGE = 0.015;
/** And this far above its bottom edge: half the blade's width and a little. */
const WIPER_FOOT = 0.006;
/** The blade's rubber edge clears the glass by this much where the glass stands highest under it. */
const WIPER_GAP = 0.003;
/** Blade stations along its length: it is bent to the screen between them. */
const WIPER_STATIONS = 16;
const WIPER_STEP = Math.PI / 90;

/**
 * Two wiper arms parked along the screen's foot, both lying to the left, sweeping up on
 * `wiper_sweep`. Each arm is the longest whose blade, upright, stays on the pane and
 * that parks low and still sweeps 90-100° between the pillars. The screen is faceted
 * and curved, so each arm turns about its own axis: the one that keeps the glass under
 * every point of its blade the most level over its sweep (one plane normal for both
 * left a blade 2-7 cm off the glass). The blade is then bent as a frame blade is, at each
 * station just clear of the highest glass it passes over. A rigid blade cannot follow a
 * screen curved in plan: over the sweep it lifts off by up to 6 mm on the 2101's screen,
 * 11 on the 2107's, 16 on the Samaras' and 21 on the tens'.
 */
function buildWipers(ctx: KitContext): void {
  const { frame, root } = ctx;
  const spec = frame.spec;
  const cabin = spec.cabin;
  const pane = root.getObjectByName('body_glass');
  const panel = root.getObjectByName('body_paint');
  if (!pane || !panel) throw new Error(`Kit car "${spec.id}": wipers need the shell's glass and paint`);
  const foot = frame.screenFoot(0);
  const base = new THREE.Vector3(0, frame.deckY(foot, 0), frame.z(foot));
  const head = new THREE.Vector3(0, cabin.rail + cabin.crown, frame.z(cabin.columns[0]!.top));
  const up = head.sub(base).normalize();
  const across = new THREE.Vector3(1, 0, 0);
  const screenNormal = new THREE.Vector3().crossVectors(across, up).normalize();
  const ray = new THREE.Raycaster();
  ray.far = 0.6;
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3();
  /** The surface of `target` under `q`, along `n`. */
  const under = (target: THREE.Object3D, q: THREE.Vector3, n: THREE.Vector3): THREE.Intersection | undefined => {
    ray.set(origin.copy(q).addScaledVector(n, 0.3), down.copy(n).negate());
    return ray.intersectObject(target, false)[0];
  };
  const blade = cabin.wiperBlade;
  const q = new THREE.Vector3();
  const m = new THREE.Vector3();
  const onPane = (point: THREE.Vector3, n: THREE.Vector3): boolean =>
    !!under(pane, m.copy(point).addScaledVector(up, WIPER_EDGE), n)
    && !!under(pane, m.copy(point).addScaledVector(up, -WIPER_FOOT), n)
    && !!under(pane, m.copy(point).addScaledVector(across, WIPER_EDGE), n)
    && !!under(pane, m.copy(point).addScaledVector(across, -WIPER_EDGE), n);

  for (const [i, px] of WIPER_PIVOTS.entries()) {
    // The glass's bottom edge above the spindle.
    const start = new THREE.Vector3(px, base.y, base.z).addScaledVector(up, -0.1);
    let edge: THREE.Vector3 | undefined;
    for (let t = 0; t < 0.4 && !edge; t += 0.002) edge = under(pane, q.copy(start).addScaledVector(up, t), screenNormal)?.point;
    if (!edge) throw new Error(`Kit car "${spec.id}": no windscreen above wiper ${i}`);
    const at = edge.addScaledVector(up, -WIPER_PIVOT_BELOW);

    // The arm's plane: `n` its axis, `park` lying to the left, `rise` up the glass.
    const n = new THREE.Vector3();
    const park = new THREE.Vector3();
    const rise = new THREE.Vector3();
    const turnAbout = (axis: THREE.Vector3): void => {
      n.copy(axis).normalize();
      park.copy(across).addScaledVector(n, -n.x).normalize();
      rise.crossVectors(n, park);
    };
    const point = (phi: number, r: number, out: THREE.Vector3): THREE.Vector3 =>
      out.copy(at).addScaledVector(park, r * Math.cos(phi)).addScaledVector(rise, r * Math.sin(phi));
    /** The glass's height over the arm's plane at angle `phi`, radius `r`. */
    const glassAt = (phi: number, r: number): number | undefined => {
      const hit = under(pane, point(phi, r, q), n);
      return hit ? hit.point.sub(at).dot(n) : undefined;
    };
    const radii = (arm: number, count: number): number[] =>
      Array.from({ length: count + 1 }, (_, k) => arm - blade / 2 + (blade * k) / count);
    const bladeOn = (phi: number, arm: number): boolean => radii(arm, 4).every((r) => onPane(point(phi, r, q), n));

    let arm = 0;
    let rest = 0;
    let sweep = 0;
    /**
     * Arm length, park and sweep about the present axis: the longest arm whose blade,
     * upright, stays on the pane, that parks low along the foot and still sweeps 90°
     * between the pillars.
     */
    const fit = (): void => {
      let top = 0;
      for (let r = 0.05; r < 1.2; r += 0.005) {
        if (onPane(point(Math.PI / 2, r, q), n)) top = r;
        else if (top > 0) break;
      }
      for (const steepest of WIPER_PARKS) {
        for (arm = top - blade / 2; arm > blade / 2; arm -= 0.01) {
          rest = Number.NaN;
          for (let phi = 0; phi <= steepest; phi += WIPER_STEP) {
            if (bladeOn(phi, arm)) {
              rest = phi;
              break;
            }
          }
          if (Number.isNaN(rest)) continue;
          sweep = 0;
          while (sweep + WIPER_STEP <= WIPER_SWEEP && bladeOn(rest + sweep + WIPER_STEP, arm)) sweep += WIPER_STEP;
          if (sweep >= WIPER_SWEEP_MIN) return;
        }
      }
      throw new Error(`Kit car "${spec.id}": wiper ${i} cannot sweep 90° on the glass`);
    };
    /** How far the glass under the blade rises and falls over the sweep, worst station. */
    const unevenness = (): number => {
      let worst = 0;
      for (const r of radii(arm, 6)) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k <= 10; k++) {
          const h = glassAt(rest + (sweep * k) / 10, r) ?? Infinity;
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        worst = Math.max(worst, hi - lo);
      }
      return worst;
    };

    turnAbout(screenNormal);
    fit();
    // Tilt the axis towards the most level sweep: the best of a coarse grid of two tilts
    // (the score has several dips), refined by a pattern search.
    const centre = n.clone();
    const tiltA = across.clone();
    const tiltB = new THREE.Vector3().crossVectors(centre, across);
    const axis = new THREE.Vector3();
    let best = Infinity;
    let ta = 0;
    let tb = 0;
    const tryTilt = (a: number, c: number): boolean => {
      turnAbout(axis.copy(centre).addScaledVector(tiltA, a).addScaledVector(tiltB, c));
      const score = unevenness();
      if (score >= best) return false;
      [best, ta, tb] = [score, a, c];
      return true;
    };
    for (let a = -0.16; a <= 0.161; a += 0.04) for (let c = -0.16; c <= 0.161; c += 0.04) tryTilt(a, c);
    for (let step = 0.02; step > 0.004; step /= 2) {
      for (let moved = true; moved; ) {
        moved = false;
        for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) moved = tryTilt(ta + da, tb + db) || moved;
      }
    }
    turnAbout(axis.copy(centre).addScaledVector(tiltA, ta).addScaledVector(tiltB, tb));
    fit();

    // Blade: at each station, clear of the highest glass it passes over, between stations too.
    const stations = radii(arm, WIPER_STATIONS);
    const fine = radii(arm, WIPER_STATIONS * 2);
    const high = fine.map((r) => {
      let top = -Infinity;
      for (let k = 0; k <= 24; k++) top = Math.max(top, glassAt(rest + (sweep * k) / 24, r) ?? -Infinity);
      return top;
    });
    const lift = stations.map((_, k) => Math.max(high[2 * k]!, high[2 * k - 1] ?? -Infinity, high[2 * k + 1] ?? -Infinity) + WIPER_GAP);
    // The spindle stands out of the frame strip.
    const strip = under(panel, at, n);
    if (!strip) throw new Error(`Kit car "${spec.id}": wiper ${i}'s spindle is off the body`);
    const seat = strip.point.sub(at).dot(n);

    // A turn about `n` takes `park` towards `n × park`, which is `rise`.
    const g = pivotGroup(`wiper_${i}`, [at.x, at.y, at.z], { channel: 'wiper_sweep', kind: 'rot', axis: [n.x, n.y, n.z], amount: sweep }, { id: 'wipers', label: 'Дворники', action: { type: 'cycle', channel: 'wipers', values: [0, 1, 2] } });
    const b = new PartBuilder().color(BLACK);
    // Built parked: x along the arm, z out of the glass.
    const along = point(rest, 1, new THREE.Vector3()).sub(at);
    b.push(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeBasis(along, new THREE.Vector3().crossVectors(n, along), n)));
    const hubTop = seat + 0.022;
    b.cylinderZ('trim', [0, 0, seat + 0.008], 0.014, 0.014, 6);
    const bar = (points: readonly (readonly [number, number])[], half: number, depth: number): void => {
      const rings = points.map(([x, z]): Vec3[] => [[x, -half, z], [x, half, z], [x, half, z + depth], [x, -half, z + depth]]);
      for (let k = 0; k + 1 < rings.length; k++) b.bridge('trim', rings[k]!, rings[k + 1]!, true);
      b.poly('trim', [...rings[0]!].reverse());
      b.poly('trim', rings[rings.length - 1]!);
    };
    // Arm: from the spindle's top down onto the blade's middle.
    bar([[0, hubTop - 0.01], [arm + 0.02, lift[WIPER_STATIONS / 2]! + 0.01]], 0.006, 0.01);
    bar(stations.map((r, k) => [r, lift[k]!]), 0.004, 0.01);
    b.pop();
    addBuilt(g, b, [at.x, at.y, at.z], `wiper_${i}`);
    root.add(g);
  }
}

/**
 * Name of an empty node over the fuel flap's opening, in the kit frame: its position the
 * opening's centre on the skin, its scale the opening's box (out from the cup to just
 * proud of the skin). render/carmodel.ts measures it after the body fit
 * (`CarModelMeasure.filler`), where a held can pours into the tank, and takes it out of
 * the template.
 */
export const KIT_FILLER_NODE = 'kit_filler';
/** How far the filler's aim box stands proud of the skin: a can's spout goes in from outside. */
const FILLER_PROUD = 0.04;

/** A cup with a cap behind the fuel flap, so an open flap shows a filler, not a void. */
function buildFiller(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const flap = frame.spec.flap;
  if (!nodes.has('flap')) return;
  const s = (flap.s0 + flap.s1) / 2;
  const y = (flap.y0 + flap.y1) / 2;
  const side = flap.side === 'left' ? 1 : -1;
  const skin = frame.sideX(s, y);
  const x = side * (skin - 0.035);
  const b = new PartBuilder().color(0x1a1b1c);
  const hz = (flap.s1 - flap.s0) / 2 - 0.006;
  const hy = (flap.y1 - flap.y0) / 2 - 0.006;
  b.boxFrom('trim', [x - 0.015 - side * 0.015, y - hy, frame.z(s) - hz], [x - 0.015 + side * 0.015, y + hy, frame.z(s) + hz], 0b111111 & ~(side > 0 ? 1 : 2));
  b.color(0x2e3032).cylinderX('trim', [x + side * 0.002, y, frame.z(s)], 0.026, 0.01, 8);
  addBuilt(ctx.root, b, [0, 0, 0], 'filler');
  // From the cup's back (0.05 inside the skin) to FILLER_PROUD outside it.
  const inner = skin - 0.05;
  const outer = skin + FILLER_PROUD;
  const marker = new THREE.Object3D();
  marker.name = KIT_FILLER_NODE;
  marker.position.set(side * (inner + outer) * 0.5, y, frame.z(s));
  marker.scale.set(outer - inner, flap.y1 - flap.y0, flap.s1 - flap.s0);
  ctx.root.add(marker);
}

/**
 * Each end face's `lid` items (spec.ts `FaceLook.lid`), built on the end face like the
 * rest but hung on the part that comes down to it, so they lift with it: the boot lid or
 * tailgate at the tail, the bonnet's nose at the front.
 */
function buildLidFace(ctx: KitContext): void {
  for (const facing of [-1, 1] as const) {
    const items = (facing > 0 ? ctx.frame.spec.look.front : ctx.frame.spec.look.rear).lid;
    if (!items) continue;
    const lid = facing > 0 ? ctx.nodes.get('bonnet') : ctx.nodes.get('boot') ?? ctx.nodes.get('tailgate');
    if (!lid) throw new Error(`Kit car "${ctx.frame.spec.id}" has ${facing > 0 ? 'nose items but no bonnet' : 'lid items but no boot lid or tailgate'}`);
    const b = new PartBuilder();
    const face = new EndFace(ctx.frame, facing);
    for (const item of items) buildFaceItem(face, item, b);
    addBuilt(lid.node, b, lid.pivot, facing > 0 ? 'nose_face' : 'lid_face');
  }
}

/** How far a spoiler's feet sink into the lid, so no seam shows where they stand on it. */
const SPOILER_SINK = 0.008;

/**
 * The spoiler (`KitLook.spoiler`), hung on the boot lid or tailgate so it lifts with it: a
 * wing between two end plates that run forward down to the lid, and a pedestal under the
 * wing's middle with the high brake lamp on its back, in the brake lamps' slot (so it is
 * one more `kit_brake` lens and lights with the others). On a tailgate the plates and the
 * pedestal stand on its glass, straight from the knee to the roof's rear end (the 2112's).
 */
function buildSpoiler(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const sp = frame.spec.look.spoiler;
  if (!sp) return;
  const lid = nodes.get('boot') ?? nodes.get('tailgate');
  if (!lid) throw new Error(`Kit car "${frame.spec.id}" has a spoiler but no boot lid or tailgate`);
  const cabin = frame.spec.cabin;
  const knee = cabin.rearKnee;
  const roofRear = cabin.columns[cabin.columns.length - 1]!.top;
  // The tailgate's glass: the centre line from the knee to the roof, lower by the roof's
  // crown towards the rails.
  const lidY = (s: number, x: number): number =>
    frame.spec.bootEnd !== undefined || !knee
      ? frame.deckY(s, x)
      : lerp(knee.y, cabin.rail + cabin.crown, (knee.s - s) / (knee.s - roofRear)) - cabin.crown * Math.min(1, (x / cabin.railHalf) ** 2);
  const P = (x: number, y: number, s: number): Vec3 => [x, y, frame.z(s)];
  const onLid = (s: number, x: number): Vec3 => P(x, lidY(s, x) - SPOILER_SINK, s);
  const top = (s: number): number => lerp(sp.top0, sp.top1, (s - sp.s0) / (sp.s1 - sp.s0));
  const t = sp.thickness;
  const nose = sp.s0 + 0.04;
  const b = new PartBuilder().color(0xffffff);
  // The wing, round its section from the leading edge: underside, trailing face, top. It
  // runs between the plates' middles, so its ends are inside them.
  const wing: [number, number][] = [
    [sp.s0, sp.top0 - t * 0.5],
    [nose, top(nose) - t],
    [sp.s1, sp.top1 - t],
    [sp.s1, sp.top1],
    [nose, top(nose)],
  ];
  const span = sp.half - sp.plate / 2;
  b.bridge('paint', wing.map(([s, y]) => P(-span, y, s)), wing.map(([s, y]) => P(span, y, s)), true);
  // End plates: from their foot on the lid up the leading edge to the wing's top, down its
  // trailing face and back along the lid (through every station, so they keep to it).
  const back = sp.pedestal.s1;
  const between = frame.spec.stations.map((st) => st.s).filter((s) => s > sp.foot && s < back).sort((a, c) => c - a);
  const plate = (x: number): Vec3[] => [
    onLid(sp.foot, x),
    P(x, sp.top0, sp.s0),
    P(x, sp.top1, sp.s1),
    P(x, sp.top1 - t, sp.s1),
    ...[back, ...between].map((s) => onLid(s, x)),
  ];
  for (const side of [1, -1]) {
    const inner = plate(side * (sp.half - sp.plate));
    const outer = plate(side * sp.half);
    b.bridge('paint', inner, outer, true);
    b.poly('paint', inner);
    b.poly('paint', [...outer].reverse());
  }
  // The pedestal from the lid up into the wing's underside.
  const ped = sp.pedestal;
  const corners: [number, number][] = [[ped.s0, -ped.half], [ped.s0, ped.half], [ped.s1, ped.half], [ped.s1, -ped.half]];
  b.bridge('paint', corners.map(([s, x]) => onLid(s, x)), corners.map(([s, x]) => P(x, top(s) - t + 0.004, s)), true);
  // The lamp in a black surround on the pedestal's back.
  const lamp = sp.lamp;
  const ly = (lamp.y0 + lamp.y1) / 2;
  const lh = (lamp.y1 - lamp.y0) / 2;
  const zb = frame.z(ped.s1);
  b.color(BLACK).boxFrom('trim', [-lamp.half - 0.008, ly - lh - 0.006, zb - 0.004], [lamp.half + 0.008, ly + lh + 0.006, zb + 0.01]);
  lens(b, 'lamp_brake', [0, ly, zb - 0.006], [lamp.half, lh, 0.004]);
  addBuilt(lid.node, b, lid.pivot, 'spoiler');
}

export function buildExterior(ctx: KitContext): void {
  const body = new PartBuilder();
  buildFace(ctx.frame, ctx.frame.spec.look.front, 1, body);
  buildFace(ctx.frame, ctx.frame.spec.look.rear, -1, body);
  buildBumpers(ctx, body);
  buildSill(ctx, body);
  buildWaist(ctx, body);
  buildRepeaters(ctx, body);
  buildCornerLamps(ctx, body);
  buildFeatureLine(ctx, body);
  addBuilt(ctx.root, body, [0, 0, 0], 'exterior');
  buildLidFace(ctx);
  buildSpoiler(ctx);
  buildDoorHardware(ctx);
  buildWipers(ctx);
  buildFiller(ctx);
}
