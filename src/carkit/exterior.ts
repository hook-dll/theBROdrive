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
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { addBuilt, pivotGroup, type KitContext } from './context';
import type { BodyFrame } from './body';
import type { FaceAnchor, FaceItem, FaceLook, FaceX, FaceY, Finish, LampRole, Span } from './spec';

const CHROME_TRIM = 0xb8bec3;
const BLACK = 0x161718;
const GRILLE_DARK = 0x0d0e0f;
const RUBBER = 0x202122;

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
 * round the corner and across the face, standing `standoff` off the face.
 */
function bumperPath(half: number, zFace: number, end: 1 | -1, depth: number, standoff: number, wrap: number): SweepPoint[] {
  const z = zFace + end * standoff;
  const r = 0.09;
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

/** Builds one end face's items, in order. Items off the centre line go on both sides. */
function buildFace(frame: BodyFrame, look: FaceLook, facing: 1 | -1, b: PartBuilder): void {
  const face = new EndFace(frame, facing);
  for (const item of look.items) buildFaceItem(face, item, b);
}

function buildFaceItem(face: EndFace, item: FaceItem, b: PartBuilder): void {
  switch (item.kind) {
    case 'panel': {
      const x = face.x(item.x);
      const [y, hy] = face.spanY(item.y);
      const { slot, color } = finishSlot(item.finish);
      b.color(color).boxFrom(slot, [-x, y - hy, face.out(-0.01)], [x, y + hy, face.out(item.proud)]);
      return;
    }
    case 'round': {
      const x = face.x(item.x);
      const y = face.y(item.y);
      for (const side of [1, -1]) {
        // A chrome ring on the face and the lens standing on it.
        b.color(CHROME_TRIM).cylinderZ('chrome', [side * x, y, face.out(0.012)], item.radius * 1.18, 0.012, 12);
        b.cylinderZ(lampSlot(item.role, side), [side * x, y, face.out(0.024)], item.radius, 0.01, 12);
      }
      return;
    }
    case 'lens': {
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      for (const side of [1, -1]) {
        const slot = lampSlot(item.role, side);
        if (!item.slant) {
          lens(b, slot, [side * x, y, face.out(item.proud)], [hx, hy, item.depth]);
          continue;
        }
        // A slab on the face whose top edge stands inboard: outline in (x, y), extruded out.
        const o = x + hx;
        const i = x - hx;
        const outline: [number, number][] = [
          [side * i, y - hy],
          [side * o, y - hy],
          [side * (o - item.slant.outer), y + hy],
          [side * (i - item.slant.inner), y + hy],
        ];
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
        const m = item.frame.margin;
        const { slot, color } = finishSlot(item.frame.finish);
        b.color(color).boxFrom(slot, [-gw - m, y - hy - m, face.out(0)], [gw + m, y + hy + m, face.out(so + 0.02)]);
      }
      if (item.back) b.color(GRILLE_DARK).boxFrom('trim', [-gw, y - hy, face.out(so + 0.006)], [gw, y + hy, face.out(so + 0.024)]);
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
      const shell = bumper.finish ? finishSlot(bumper.finish) : { slot: 'trim' as const, color: 0x232427 };
      b.color(shell.color);
      sweep(b, shell.slot, bumperPath(half, zFace - end * 0.01, end, depth, 0, 0.2), [
        [0, y0 + 0.02],
        [0.7, y0],
        [0.92, y0 + 0.03],
        [1, y0 + 0.08],
        [1, y1 - 0.05],
        [0.9, y1 - 0.005],
        [0.55, y1],
        [0, y1],
      ]);
      const g = y0 + 0.11;
      // A painted bumper's groove is a ridge in its own colour.
      const groove = bumper.finish ? shell : { slot: 'trim' as const, color: 0x34363a };
      b.color(groove.color);
      sweep(b, groove.slot, bumperPath(half + 0.003, zFace - end * 0.01, end, depth + 0.006, 0, 0.19), [[0.97, g - 0.012], [1, g - 0.012], [1, g + 0.012], [0.97, g + 0.012]]);
    }
  }
}

/** The sill strip between the arches, in `KitLook.sill`'s finish. */
function buildSill(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  if (!spec.look.sill) return;
  const { slot, color } = finishSlot(spec.look.sill);
  const s0 = spec.wheels.front + spec.wheels.radius * spec.wheels.arch + 0.02;
  const s1 = spec.wheels.rear - spec.wheels.radius * spec.wheels.arch - 0.02;
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

/**
 * The waist moulding (`KitLook.waist`): a strip along each flank from nose to tail,
 * following the side's plan, broken where it crosses a door's shut lines so each door
 * carries its own piece and swings with it.
 */
function buildWaist(ctx: KitContext, body: PartBuilder): void {
  const { frame, nodes, root } = ctx;
  const spec = frame.spec;
  const waist = spec.look.waist;
  if (!waist) return;
  const { slot, color } = finishSlot(waist.finish);
  root.updateMatrixWorld(true);
  // Each door's s range at rest: the car frame's z is `zNose - s`.
  const doors = [...nodes].filter(([owner]) => owner.startsWith('door_')).map(([owner, door]) => {
    const box = new THREE.Box3().setFromObject(door.node);
    return { owner, door, side: owner.endsWith('l') ? 1 : -1, s0: frame.zNose - box.max.z, s1: frame.zNose - box.min.z };
  });
  const st = spec.stations;
  const first = st[0]!.s + 0.02;
  const last = st[st.length - 1]!.s - 0.02;
  const builders = new Map<string, PartBuilder>();
  for (const side of [1, -1]) {
    const mine = doors.filter((d) => d.side === side);
    const cuts = [first, last, ...mine.flatMap((d) => [d.s0, d.s1])].filter((s) => s >= first && s <= last).sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]! + MOULDING_GAP;
      const c = cuts[i + 1]! - MOULDING_GAP;
      if (c - a < 0.02) continue;
      const mid = (a + c) / 2;
      const door = mine.find((d) => mid > d.s0 && mid < d.s1);
      const key = door?.owner ?? 'body';
      let b = builders.get(key);
      if (!b) builders.set(key, (b = key === 'body' ? body : new PartBuilder()));
      b.color(color);
      const pieces = Math.max(1, Math.ceil((c - a) / MOULDING_RUN));
      const point = (s: number, dy: number, out: number): Vec3 => [side * (frame.sideX(s, waist.y + dy) + out), waist.y + dy, frame.z(s)];
      const h = waist.height / 2;
      for (let k = 0; k < pieces; k++) {
        const s0 = a + ((c - a) * k) / pieces;
        const s1 = a + ((c - a) * (k + 1)) / pieces;
        b.quad(slot, point(s0, -h, 0.008), point(s1, -h, 0.008), point(s1, h, 0.008), point(s0, h, 0.008));
        b.quad(slot, point(s0, h, 0.008), point(s1, h, 0.008), point(s1, h, 0), point(s0, h, 0));
        b.quad(slot, point(s0, -h, 0), point(s1, -h, 0), point(s1, -h, 0.008), point(s0, -h, 0.008));
      }
      b.quad(slot, point(a, -h, 0), point(a, -h, 0.008), point(a, h, 0.008), point(a, h, 0));
      b.quad(slot, point(c, -h, 0.008), point(c, -h, 0), point(c, h, 0), point(c, h, 0.008));
    }
  }
  for (const { owner, door } of doors) {
    const b = builders.get(owner);
    if (b) addBuilt(door.node, b, door.pivot, `${owner}_waist`);
  }
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

/** Two wiper arms parked along the screen's foot, sweeping on `wiper_sweep`. */
function buildWipers(ctx: KitContext): void {
  const { frame, root } = ctx;
  const spec = frame.spec;
  const cabin = spec.cabin;
  const base: Vec3 = [0, frame.deckY(frame.cowl, 0), frame.z(frame.cowl)];
  const head: Vec3 = [0, cabin.rail + cabin.crown, frame.z(cabin.columns[0]!.top)];
  const up = new THREE.Vector3(head[0] - base[0], head[1] - base[1], head[2] - base[2]).normalize();
  const across = new THREE.Vector3(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(across, up).normalize();
  const basis = new THREE.Matrix4().makeBasis(across, up, normal);
  const length = Math.min(0.5, spec.cabin.railHalf * 0.75);
  for (const [i, px] of [0.42, -0.08].entries()) {
    const at: Vec3 = [px, base[1] + 0.035, base[2] - 0.03];
    const g = pivotGroup(`wiper_${i}`, at, { channel: 'wiper_sweep', kind: 'rot', axis: [normal.x, normal.y, normal.z], amount: -1.75 }, { id: 'wipers', label: 'Дворники', action: { type: 'cycle', channel: 'wipers', values: [0, 1, 2] } });
    const b = new PartBuilder().color(BLACK);
    b.push(new THREE.Matrix4().makeTranslation(...at).multiply(basis));
    b.cylinderZ('trim', [0, 0, 0.01], 0.014, 0.012, 6);
    // Arm and blade, lying parked toward the passenger side (-x).
    b.boxFrom('trim', [-length, -0.006, 0.012], [0, 0.006, 0.022]);
    b.boxFrom('trim', [-length - 0.02, 0.004, 0.006], [-0.04, 0.012, 0.014]);
    b.pop();
    addBuilt(g, b, at, `wiper_${i}`);
    root.add(g);
  }
}

/** A cup with a cap behind the fuel flap, so an open flap shows a filler, not a void. */
function buildFiller(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const flap = frame.spec.flap;
  if (!nodes.has('flap')) return;
  const s = (flap.s0 + flap.s1) / 2;
  const y = (flap.y0 + flap.y1) / 2;
  const side = flap.side === 'left' ? 1 : -1;
  const x = side * (frame.sideX(s, y) - 0.035);
  const b = new PartBuilder().color(0x1a1b1c);
  const hz = (flap.s1 - flap.s0) / 2 - 0.006;
  const hy = (flap.y1 - flap.y0) / 2 - 0.006;
  b.boxFrom('trim', [x - 0.015 - side * 0.015, y - hy, frame.z(s) - hz], [x - 0.015 + side * 0.015, y + hy, frame.z(s) + hz], 0b111111 & ~(side > 0 ? 1 : 2));
  b.color(0x2e3032).cylinderX('trim', [x + side * 0.002, y, frame.z(s)], 0.026, 0.01, 8);
  addBuilt(ctx.root, b, [0, 0, 0], 'filler');
}

/**
 * The rear face's `lid` items (spec.ts `FaceLook.lid`), built on the end face like the
 * rest but hung on the boot lid or tailgate, so they lift with it.
 */
function buildLidFace(ctx: KitContext): void {
  const items = ctx.frame.spec.look.rear.lid;
  if (!items) return;
  const lid = ctx.nodes.get('boot') ?? ctx.nodes.get('tailgate');
  if (!lid) throw new Error(`Kit car "${ctx.frame.spec.id}" has lid items but no boot lid or tailgate`);
  const b = new PartBuilder();
  const face = new EndFace(ctx.frame, -1);
  for (const item of items) buildFaceItem(face, item, b);
  addBuilt(lid.node, b, lid.pivot, 'lid_face');
}

export function buildExterior(ctx: KitContext): void {
  const body = new PartBuilder();
  buildFace(ctx.frame, ctx.frame.spec.look.front, 1, body);
  buildFace(ctx.frame, ctx.frame.spec.look.rear, -1, body);
  buildBumpers(ctx, body);
  buildSill(ctx, body);
  buildWaist(ctx, body);
  buildRepeaters(ctx, body);
  addBuilt(ctx.root, body, [0, 0, 0], 'exterior');
  buildLidFace(ctx);
  buildDoorHardware(ctx);
  buildWipers(ctx);
  buildFiller(ctx);
}
