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
import { PartBuilder, lerp, table, type Caps, type KitSlot, type Outline, type Vec3 } from './builder';
import { addBuilt, addMirrorFace, mirrorFrame, pivotGroup, type KitContext } from './context';
import { skinX, tubColumns, type BodyFrame, type KitHole } from './body';
import { driverEyeAt } from './interior';
import type { CornerLampPoint, FaceAnchor, FaceItem, FaceLook, FaceX, FaceY, Finish, LampRole, Span } from './spec';
import type { KitControl } from './rig';

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
 * A sweep's section point: outward fraction 0..1 of the path's depth, height, and metres
 * added outward (a strip that must stand a set distance off the surface it rides on).
 */
type SectionPoint = readonly [number, number, number?];

function sweepPoint(p: SweepPoint, [o, y, a = 0]: SectionPoint): Vec3 {
  return [p.x + p.nx * (o * p.depth + a), y, p.z + p.nz * (o * p.depth + a)];
}

/**
 * Sweeps a section along a path in plan, capping both ends: a bumper that turns round the
 * corners in one piece. `omit` lists section edges (k is from point k to the next) to
 * leave out: a bumper's back, which faces the body, or where two parts of it meet.
 */
function sweep(b: PartBuilder, slot: KitSlot, path: readonly SweepPoint[], section: readonly SectionPoint[], omit: readonly number[] = []): void {
  const rings: Vec3[][] = path.map((p) => section.map((q) => sweepPoint(p, q)));
  const n = section.length;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < n; k++) if (!omit.includes(k)) b.quad(slot, rings[i]![k]!, rings[i]![(k + 1) % n]!, rings[i + 1]![(k + 1) % n]!, rings[i + 1]![k]!);
  }
  b.poly(slot, rings[0]!);
  b.poly(slot, [...rings[rings.length - 1]!].reverse());
}

/**
 * What a swept part covers: for each step of the path, the quad its section's edge from
 * `a` to `b` sweeps, as the cut under it (`PartBuilder.cut`) reaching `reach` either side.
 */
function sweptOutlines(path: readonly SweepPoint[], a: SectionPoint, b: SectionPoint, reach: number): Outline[] {
  const out: Outline[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    out.push({ poly: [sweepPoint(path[i]!, a), sweepPoint(path[i + 1]!, a), sweepPoint(path[i + 1]!, b), sweepPoint(path[i]!, b)], reach });
  }
  return out;
}

/**
 * Plan path of a bumper across one end of the car: back along each flank by `wrap`,
 * round the corner (radius `r`) and across the face, standing `standoff` off the face.
 * `flank`: a long wrap hugging the wings (a blade's `wrap`): the side's half width at a z,
 * and the z of every station it passes, from its end towards the corner.
 */
function bumperPath(
  half: number,
  zFace: number,
  end: 1 | -1,
  depth: number,
  standoff: number,
  wrap: number,
  r = 0.09,
  flank?: { readonly half: (z: number) => number; readonly zs: readonly number[] },
): SweepPoint[] {
  const z = zFace + end * standoff;
  const side = (sx: number): SweepPoint[] => [
    ...(flank
      ? [z - end * wrap, ...flank.zs].map((zp): SweepPoint => ({ x: sx * flank.half(zp), z: zp, nx: sx, nz: 0, depth: depth * 0.3 }))
      : [{ x: sx * half, z: z - end * wrap, nx: sx, nz: 0, depth: depth * 0.3 }]),
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
/** The points of a flank bumper's side that run along the flank (facing straight out). */
const flankPoints = (path: readonly SweepPoint[]): number => path.filter((p) => Math.abs(p.nx) === 1).length / 2;
/** A flank bumper's corner up to this radius is one flat chamfer; a larger one turns in two. */
const BUMPER_CHAMFER = 0.15;
/** A moulded bumper's hole in the end face stops this short of the corner on each side. */
const BUMPER_HOLE_END = 0.015;

/**
 * Plan path of a moulded bumper whose sides follow the flanks back to `wrapTo` (spec.ts
 * `wrapTo`): across the face and round a corner of radius `r` as `bumperPath`, then along
 * each flank just outside the body at the bumper's top height, so its side lies flush on
 * the wing and runs on to the wheel arch. `grow` and `depth` as in `bumperPath`. A small
 * corner is one chamfer from the flank, level with the end face, to the face: a mid
 * point there only bent it into facets, and a chamfer starting further along the flank
 * would let the body's corner poke through it.
 */
function flankBumperPath(frame: BodyFrame, sEnd: number, end: 1 | -1, top: number, depth: number, grow: number, wrapTo: number, r: number): SweepPoint[] {
  const z = frame.z(sEnd) - end * 0.01;
  const sideDepth = depth * 0.3;
  const round = r > BUMPER_CHAMFER;
  // The path stands `sideDepth` inside the flank so the section's outer face is just outside it.
  const base = (s: number): number => frame.sideX(s, top) + BUMPER_FLANK_OUT + grow - sideDepth;
  const sCorner = round ? sEnd + end * (0.01 + r * 0.4) : sEnd;
  const halfCorner = base(sCorner);
  // Along the flank: a point at each end and at every station between, where the side
  // bends in plan; between them the side is straight and so is the bumper.
  const inner = frame.spec.stations.map((st) => st.s).filter((s) => s > Math.min(wrapTo, sCorner) + 0.01 && s < Math.max(wrapTo, sCorner) - 0.01);
  const along = [wrapTo, ...(wrapTo < sCorner ? inner : inner.reverse()), sCorner];
  const side = (sx: number): SweepPoint[] => [
    ...along.map((s): SweepPoint => ({ x: sx * base(s), z: frame.z(s), nx: sx, nz: 0, depth: sideDepth })),
    ...(round ? [{ x: sx * (halfCorner - r * 0.3), z: z - end * r * 0.1, nx: sx * 0.7071, nz: end * 0.7071, depth: depth * 0.75 }] : []),
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
 * How deep every part on an end face roots into it: past the census's coplanar band
 * (tools/kit-zfight.ts, 6 mm), so no part's back lies close under the face's skin.
 */
const FACE_ROOT = 0.007;

/** A part's outline on an end face, (x, y), and how far it reaches out of the face (negative: into the body). */
interface Footprint {
  readonly poly: readonly P2[];
  readonly z0: number;
  readonly z1: number;
}

/**
 * One end face, resolved: its plane, half width and lines, and how a description's
 * positions land on it. `facing` is +1 at the nose and -1 at the tail. `owner` is the
 * shell part the face's items stand on, cut away under them (`KitHole`).
 */
class EndFace {
  readonly z: number;
  readonly half: number;
  /**
   * A moulded bumper's band on this face and how far its front stands out of the face (to
   * the car's tip), or undefined for a blade bumper.
   */
  readonly moulded?: { readonly y0: number; readonly y1: number; readonly front: number };
  private readonly lines: Readonly<Record<FaceAnchor, number>>;

  constructor(frame: BodyFrame, readonly facing: 1 | -1, private readonly owner: string, private readonly holes: KitHole[]) {
    const { front, tail } = ends(frame);
    const s = facing > 0 ? front : tail;
    const sec = frame.section(s);
    const bumper = bumperBand(frame, facing);
    const deck = frame.deckY(s, sec.r4[0]);
    this.z = frame.z(s);
    this.half = sec.r2[0];
    this.lines = { bumperTop: bumper.y1, bumperBottom: bumper.y0, belt: sec.r3[1], deck, mid: (bumper.y1 + deck) / 2 };
    if ((facing > 0 ? frame.spec.look.front : frame.spec.look.rear).bumper.kind === 'moulded') {
      this.moulded = { ...bumper, front: facing > 0 ? s : frame.spec.length - s };
    }
  }

  /** The plane `d` out of the face (negative: into the body). */
  out(d: number): number {
    return this.z + this.facing * d;
  }

  /** The cap a prism rooted in the face keeps: its front only. Its back would lie hidden in the body a few millimetres under other parts' backs. */
  get frontCap(): Caps {
    return this.facing > 0 ? 'z1' : 'z0';
  }

  /** `PartBuilder.box` faces of a box rooted in the face: all but its back. */
  get noBack(): number {
    return 0b111111 & ~(this.facing > 0 ? 32 : 16);
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

  /** Volumes of the parts placed on this face so far. */
  readonly placed: Outline[] = [];

  /**
   * Adds a part to `b`, built in `part` with its footprints, as a union: whatever `b`
   * already holds inside the part's volume (a grille's back under a lamp, a bumper's face
   * under a fog-lamp blank, a neighbour's wall) is cut away, and so is whatever of the
   * part lies inside a part placed before it (a panel's edge under a frame's bar), and the
   * shell's skin under a part rooted in the face. Where a wall of each lies flush in one
   * plane facing the same way (a post's foot on a slot back's floor), the earlier one's
   * gives way and the part's stays (`Outline.keepOutside`). Every cut runs along a part's
   * walls: no slit can open.
   */
  place(b: PartBuilder, part: PartBuilder, prints: readonly Footprint[]): void {
    const volumes = prints.map((f) => this.volume(f));
    part.cut(this.placed.map((v) => ({ ...v, keepOutside: true })));
    b.cut(volumes).append(part);
    this.placed.push(...volumes);
    for (const f of prints) if (f.z0 < 0) this.holes.push({ owner: this.owner, outline: { poly: f.poly.map(([x, y]): Vec3 => [x, y, this.z]) } });
  }

  /** A footprint's prism, as a cut (`PartBuilder.cut`). */
  volume(f: Footprint): Outline {
    return { poly: f.poly.map(([x, y]): Vec3 => [x, y, this.out((f.z0 + f.z1) / 2)]), reach: (f.z1 - f.z0) / 2, solid: true };
  }
}

function centreHalf(a: number, b: number): [number, number] {
  return [(a + b) / 2, Math.abs(b - a) / 2];
}

type P2 = [number, number];

/** `PartBuilder.bevelBox`'s section about (cx, cy): the outline a lens or cell stands on. */
function octagon(cx: number, cy: number, hx: number, hy: number, bevel: number): P2[] {
  const b = Math.min(bevel, hx * 0.9, hy * 0.9);
  return ([[hx - b, -hy], [hx, -hy + b], [hx, hy - b], [hx - b, hy], [-hx + b, hy], [-hx, hy - b], [-hx, -hy + b], [-hx + b, -hy]] as P2[]).map(([x, y]): P2 => [cx + x, cy + y]);
}

function rect(x0: number, y0: number, x1: number, y1: number): P2[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** A moulded bumper's ridge or band, which goes on among the face's items (`buildFace`). */
interface Ridge {
  readonly part: PartBuilder;
  readonly volume: readonly Outline[];
  readonly y0: number;
  readonly y1: number;
  /** How far its front stands out of the end face at the centre line. */
  readonly front: number;
}

/**
 * Builds one end face's items, each over what is there before it. Items off the centre
 * line go on both sides. On a moulded bumper its ridge goes on after the items it passes
 * in front of and before those standing in front of it (an intake), so each cuts what is
 * hidden inside it.
 */
function buildFace(face: EndFace, items: readonly FaceItem[], b: PartBuilder, ridge?: Ridge): void {
  const built = items.map((item) => {
    const part = new PartBuilder();
    const prints = buildFaceItem(face, item, part);
    const ahead = ridge !== undefined && prints.some((f) => f.z1 > ridge.front && Math.min(...f.poly.map(([, y]) => y)) < ridge.y1 && Math.max(...f.poly.map(([, y]) => y)) > ridge.y0);
    return { part, prints, ahead };
  });
  for (const { part, prints } of built.filter((i) => !i.ahead)) face.place(b, part, prints);
  if (ridge) b.cut(ridge.volume).append(ridge.part.cut(face.placed));
  for (const { part, prints } of built.filter((i) => i.ahead)) face.place(b, part, prints);
}

function buildFaceItem(face: EndFace, item: FaceItem, b: PartBuilder): Footprint[] {
  switch (item.kind) {
    case 'panel': {
      const [y, hy] = face.spanY(item.y);
      const { slot, color } = finishSlot(item.finish);
      b.color(color);
      const spans: [number, number][] = 'centre' in item.x || 'inset' in item.x ? [[-face.x(item.x), face.x(item.x)]] : (() => {
        // A block on each side.
        const [x, hx] = face.spanX(item.x);
        return [[x - hx, x + hx], [-x - hx, -x + hx]];
      })();
      return spans.map(([x0, x1]) => {
        b.boxFrom(slot, [x0, y - hy, face.out(-FACE_ROOT)], [x1, y + hy, face.out(item.proud)], face.noBack);
        return { poly: rect(x0, y - hy, x1, y + hy), z0: -FACE_ROOT, z1: item.proud };
      });
    }
    case 'round': {
      const x = face.x(item.x);
      const y = face.y(item.y);
      const r = item.radius * 1.18;
      return [1, -1].map((side) => {
        // A chrome ring rooted in the face, 26 mm out of it (clear of a grille's front 24 mm
        // out: the 2103's lamps stand on its grille), and the lens standing in it.
        b.color(CHROME_TRIM).cylinderZ('chrome', [side * x, y, face.out((0.026 - FACE_ROOT) / 2)], r, (0.026 + FACE_ROOT) / 2, 12, face.frontCap);
        b.cylinderZ(lampSlot(item.role, side), [side * x, y, face.out(0.024)], item.radius, 0.01, 12);
        const ring = Array.from({ length: 12 }, (_, i): P2 => [side * x + Math.cos((i / 12) * Math.PI * 2) * r, y + Math.sin((i / 12) * Math.PI * 2) * r]);
        return { poly: ring, z0: -FACE_ROOT, z1: 0.034 };
      });
    }
    case 'lens': {
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      const z0 = Math.min(item.proud - item.depth, -FACE_ROOT);
      const z1 = item.proud + item.depth;
      // A lens centred on the centre line is one lens across it (the 2110's lid reflector).
      return (x === 0 ? [1] : [1, -1]).map((side) => {
        const slot = lampSlot(item.role, side);
        if (!item.slant) {
          const bevel = Math.min(hx, hy) * 0.35;
          b.bevelBox(slot, [side * x, y, face.out((z0 + z1) / 2)], [hx, hy, (z1 - z0) / 2], bevel, face.frontCap);
          return { poly: octagon(side * x, y, hx, hy, bevel), z0, z1 };
        }
        // A slab on the face whose top edge's ends stand `slant` inboard of the bottom's:
        // outline in (x, y) counter-clockwise from the inner bottom corner, extruded out.
        const slant = item.slant;
        const outline = ([[x - hx, y - hy], [x + hx, y - hy], [x + hx - slant.outer, y + hy], [x - hx - slant.inner, y + hy]] as P2[]).map(([px, py]): P2 => [side * px, py]);
        // Counter-clockwise seen from outside the face, whichever side and end.
        if (side * face.facing < 0) outline.reverse();
        b.extrude(slot, outline, Math.min(face.out(z0), face.out(z1)), Math.max(face.out(z0), face.out(z1)), 0, 0, face.frontCap);
        return { poly: outline, z0, z1 };
      });
    }
    case 'grille': {
      const gw = face.x(item.x);
      const [y, hy] = face.spanY(item.y);
      // A grille standing out of a moulded bumper (an intake) stands with its front 10 mm
      // ahead of the bumper's (4 mm ahead of its 6 mm ridge), however `standOut` reads, so
      // neither the bumper's face nor its ridge lies within millimetres of it.
      const m = face.moulded;
      const inBumper = item.standOut !== undefined && m !== undefined && y + hy > m.y0 && y - hy < m.y1;
      const so = inBumper ? Math.max(item.standOut!, m.front + 0.01 - 0.024) : item.standOut ?? 0;
      // The dark back reaches 2 mm past the slot every way, so bars that span the slot end
      // on its walls. It roots in the face, through a bumper the grille stands out of.
      const [px, py] = [gw + 0.002, hy + 0.002];
      const z0 = -FACE_ROOT;
      const prints: Footprint[] = [];
      if (item.frame) {
        // A ring round the back, so no frame lies under it.
        const [fx, fy] = [gw + item.frame.margin, hy + item.frame.margin];
        const { slot, color } = finishSlot(item.frame.finish);
        const [a, c] = [face.out(-FACE_ROOT), face.out(so + 0.02)];
        b.color(color);
        // No faces where the ring's pieces meet each other or the back: they would lie in one plane.
        const inner = item.back ? 0b111111 : 0;
        b.boxFrom(slot, [-fx, y + py, a], [fx, y + fy, c], face.noBack & ~(8 & inner));
        b.boxFrom(slot, [-fx, y - fy, a], [fx, y - py, c], face.noBack & ~(4 & inner));
        b.boxFrom(slot, [-fx, y - py, a], [-px, y + py, c], face.noBack & ~12 & ~(1 & inner));
        b.boxFrom(slot, [px, y - py, a], [fx, y + py, c], face.noBack & ~12 & ~(2 & inner));
        if (item.back) prints.push({ poly: rect(-fx, y - fy, fx, y + fy), z0, z1: so + 0.024 });
        else for (const [x0, y0, x1, y1] of [[-fx, y + py, fx, y + fy], [-fx, y - fy, fx, y - py], [-fx, y - py, -px, y + py], [px, y - py, fx, y + py]] as const) prints.push({ poly: rect(x0, y0, x1, y1), z0, z1: so + 0.02 });
      } else if (item.back) {
        prints.push({ poly: rect(-px, y - py, px, y + py), z0, z1: so + 0.024 });
      }
      // The back, then the bars on it: the back's face under each bar is cut away.
      const back = new PartBuilder();
      if (item.back) back.color(GRILLE_DARK).boxFrom('trim', [-px, y - py, face.out(z0)], [px, y + py, face.out(so + 0.024)], face.noBack);
      const bars = item.bars;
      const { slot, color } = finishSlot(bars.finish);
      const [b0, b1] = [so + bars.proud - bars.depth, so + bars.proud];
      const w = bars.width / 2;
      // Bars whose front stays behind the back's are hidden in it: not built.
      const shown = !item.back || b1 > so + 0.024;
      for (let i = 0; shown && i < bars.count; i++) {
        const t = bars.count > 1 ? i / (bars.count - 1) : 0.5;
        const bar = new PartBuilder().color(color);
        // Bars span the slot to the back's walls (2 mm past the slot), with or without a
        // back, and a bar edge on the slot's edge goes out to them: a bar meets the walls,
        // which are cut inside it, instead of standing 2 mm in from them (the Samaras' bars
        // over their slot meet its back's walls too).
        const [ex, ey] = [px, py];
        const [x0, y0, x1, y1] = (bars.dir === 'vertical'
          ? [-gw + bars.margin + t * 2 * (gw - bars.margin) - w, y - ey, -gw + bars.margin + t * 2 * (gw - bars.margin) + w, y + ey]
          : [-ex, y - hy + bars.margin + t * 2 * (hy - bars.margin) - w, ex, y - hy + bars.margin + t * 2 * (hy - bars.margin) + w]
        ).map((v, k) => (k % 2 === 0 ? (Math.abs(Math.abs(v) - gw) < 0.004 ? Math.sign(v) * ex : v) : Math.abs(Math.abs(v - y) - hy) < 0.004 ? y + Math.sign(v - y) * ey : v));
        bar.boxFrom(slot, [x0!, y0!, face.out(b0)], [x1!, y1!, face.out(b1)]);
        const print = { poly: rect(x0!, y0!, x1!, y1!), z0: b0, z1: b1 };
        back.cut([face.volume(print)]).append(bar);
        prints.push(print);
      }
      b.append(back);
      return prints;
    }
    case 'cluster': {
      // One unit straight on the body, rooted in the face: its cells tile the span with no
      // seam, each drawing its front and only the walls on the unit's edge.
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      const outer = x + hx;
      const w = (2 * hx) / item.columns.length;
      const [z0, z1] = [face.out(-FACE_ROOT), face.out(0.019)];
      const front = face.facing > 0 ? 16 : 32;
      const last = item.columns.length - 1;
      for (const side of [1, -1]) {
        item.columns.forEach((roles, k) => {
          const cx = outer - (k + 0.5) * w;
          const rowH = (2 * hy) / roles.length;
          roles.forEach((role, r) => {
            const cy = y + hy - (r + 0.5) * rowH;
            const walls = (k === 0 ? (side > 0 ? 1 : 2) : 0) | (k === last ? (side > 0 ? 2 : 1) : 0) | (r === 0 ? 4 : 0) | (r === roles.length - 1 ? 8 : 0);
            b.boxFrom(lampSlot(role, side), [side * cx - w / 2, cy - rowH / 2, z0], [side * cx + w / 2, cy + rowH / 2, z1], front | walls);
          });
        });
      }
      return [1, -1].map((side) => ({ poly: rect(side * x - hx, y - hy, side * x + hx, y + hy), z0: -FACE_ROOT, z1: 0.019 }));
    }
    case 'frame': {
      const [x, hx] = face.spanX(item.x);
      const [y, hy] = face.spanY(item.y);
      const { slot, color } = finishSlot(item.finish);
      const t = item.width;
      b.color(color);
      const prints: Footprint[] = [];
      for (const side of Math.abs(x) < 1e-6 ? [1] : [1, -1]) {
        const cx = side * x;
        for (const [x0, y0, x1, y1] of [
          [cx - hx, y + hy - t, cx + hx, y + hy],
          [cx - hx, y - hy, cx + hx, y - hy + t],
          [cx - hx, y - hy + t, cx - hx + t, y + hy - t],
          [cx + hx - t, y - hy + t, cx + hx, y + hy - t],
        ] as const) {
          b.boxFrom(slot, [x0, y0, face.out(-FACE_ROOT)], [x1, y1, face.out(item.proud)], face.noBack);
          prints.push({ poly: rect(x0, y0, x1, y1), z0: -FACE_ROOT, z1: item.proud });
        }
      }
      return prints;
    }
  }
}

/** A path pulled in by `d` at both ends, so what rides on it stops short of the part's end faces. */
function shortened(path: readonly SweepPoint[], d: number): SweepPoint[] {
  const pull = (p: SweepPoint, q: SweepPoint): SweepPoint => {
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    return { ...p, x: p.x + ((q.x - p.x) * d) / l, z: p.z + ((q.z - p.z) * d) / l };
  };
  return [pull(path[0]!, path[1]!), ...path.slice(1, -1), pull(path[path.length - 1]!, path[path.length - 2]!)];
}

/**
 * Holes in the shell under a moulded bumper: on the end face along its straight run, and
 * along each flank where its sides follow them (`flankSteps` segments at each end of the
 * path), each between the heights where the shell's skin lies inside the bumper's section
 * with 3 mm to spare. Its corners keep the skin: the bumper rounds them in plan, the shell
 * does not.
 */
function bumperHoles(ctx: KitContext, path: readonly SweepPoint[], section: readonly (readonly [number, number])[], end: 1 | -1, flankSteps: number): void {
  const { frame } = ctx;
  const margin = 0.003;
  /** The heights where a skin point, `out` metres outward of the path point, is inside the section. */
  const covered = (p: SweepPoint, out: (y: number) => number): [number, number] | undefined => {
    let lo = Infinity;
    let hi = -Infinity;
    const ys = section.map(([, y]) => y);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.002) {
      const o = out(y);
      const ok = [o - margin, o + margin].every((oo) => [y - margin, y + margin].every((yy) => insideSection(section, oo / p.depth, yy)));
      if (ok) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    return lo < hi ? [lo, hi] : undefined;
  };
  const zFace = frame.z(end > 0 ? ends(frame).front : ends(frame).tail);
  const along = (a: SweepPoint, c: SweepPoint, range: (p: SweepPoint) => [number, number] | undefined, at: (p: SweepPoint, y: number) => Vec3): void => {
    const ra = range(a);
    const rc = range(c);
    if (!ra || !rc) return;
    const [y0, y1] = [Math.max(ra[0], rc[0]), Math.min(ra[1], rc[1])];
    if (y1 - y0 < 0.01) return;
    ctx.holes.push({ owner: 'body', outline: { poly: [at(a, y0), at(c, y0), at(c, y1), at(a, y1)] } });
  };
  // The straight run across the face: the points facing straight out, its two ends pulled
  // in by `BUMPER_HOLE_END` so the corner (a chamfer) covers them from every side.
  const face = path.filter((p) => Math.abs(p.nz) > 0.999).map((p) => ({ ...p, x: Math.sign(p.x) * Math.max(0, Math.abs(p.x) - BUMPER_HOLE_END) }));
  const onFace = (p: SweepPoint): [number, number] | undefined => covered(p, () => end * (zFace - p.z));
  for (let i = 0; i + 1 < face.length; i++) along(face[i]!, face[i + 1]!, onFace, (p, y) => [p.x, y, zFace]);
  if (flankSteps === 0) return;
  // Along the flanks: the skin at the path point's s, out from the path along x.
  const skin = (p: SweepPoint, y: number): number => frame.sideX(frame.zNose - p.z, y);
  const onFlank = (p: SweepPoint): [number, number] | undefined => covered(p, (y) => skin(p, y) - Math.abs(p.x));
  for (const run of [path.slice(0, flankSteps + 1), path.slice(-flankSteps - 1)]) {
    for (let i = 0; i + 1 < run.length; i++) along(run[i]!, run[i + 1]!, onFlank, (p, y) => [Math.sign(p.x) * skin(p, y), y, p.z]);
  }
}

/** Whether (o, y) lies inside a closed section polygon (even-odd). */
function insideSection(section: readonly (readonly [number, number])[], o: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = section.length - 1; i < section.length; j = i++) {
    const [oi, yi] = section[i]!;
    const [oj, yj] = section[j]!;
    if (yi > y !== yj > y && o < ((oj - oi) * (y - yi)) / (yj - yi) + oi) inside = !inside;
  }
  return inside;
}

/** Builds both bumpers into `b`; a moulded bumper's ridge or band is returned by end (+1 the nose) to go on among the face's items. */
function buildBumpers(ctx: KitContext, b: PartBuilder): Map<1 | -1, Ridge> {
  const ridges = new Map<1 | -1, Ridge>();
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
      // A bar on brackets, its ends turned back round the corners. Its back faces the body
      // a few millimetres off: no face there.
      const blade = bumper.depth;
      // Inside the published width even where the ends wrap round the corners.
      const half = Math.min(sec.r2[0] + 0.02, widest - blade * 0.35);
      const y = (y0 + y1) / 2;
      // A long `wrap` hugs the wings: its back 8 mm off the side over the bar's height at
      // every station it passes.
      const flank = (grow: number, wrap: number): Parameters<typeof bumperPath>[7] => {
        if (bumper.wrap === undefined) return undefined;
        const zCorner = zFace + end * (reach - blade) - end * 0.09 * 0.4;
        const zEnd = zFace + end * (reach - blade) - end * wrap;
        const zs = spec.stations.map((st) => frame.z(st.s)).filter((z) => (z - zEnd) * (zCorner - z) > 0);
        zs.sort((a, b) => end * (b - a));
        const at = (z: number): number => {
          const s = frame.zNose - z;
          return Math.max(half, frame.sideX(s, y0) + 0.008, frame.sideX(s, y1) + 0.008) + grow;
        };
        return { half: at, zs };
      };
      const wrap = bumper.wrap ?? 0.16;
      const path = bumperPath(half, zFace, end, blade, reach - blade, wrap, undefined, flank(0, wrap));
      const main = finishSlot(bumper.finish);
      const bar = new PartBuilder();
      if (bumper.lower) {
        // Two-tone: the lower share of the bar in its own finish, split on a flat line.
        const ym = y0 + bumper.lower.share * (y1 - y0);
        const low = finishSlot(bumper.lower.finish);
        bar.color(low.color);
        sweep(bar, low.slot, path, [[0, y0], [0.75, y0], [1, y0 + 0.025], [1, ym], [0, ym]], [3, 4]);
        bar.color(main.color);
        sweep(bar, main.slot, path, [[0, ym], [1, ym], [1, y1 - 0.025], [0.75, y1], [0, y1]], [0, 4]);
      } else {
        bar.color(main.color);
        sweep(bar, main.slot, path, [[0, y0], [0.75, y0], [1, y0 + 0.025], [1, y1 - 0.025], [0.75, y1], [0, y1]], [5]);
      }
      if (bumper.strip) {
        // A rubber strip 4 mm proud of the blade's face, rooted 7 mm in it; the face under it is cut.
        const strip = finishSlot(bumper.strip);
        const stripWrap = bumper.wrap === undefined ? 0.15 : wrap - 0.01;
        const along = bumperPath(half, zFace, end, blade, reach - blade, stripWrap, undefined, flank(0, stripWrap));
        const rubber = new PartBuilder().color(strip.color);
        sweep(rubber, strip.slot, along, [[1, y - 0.012, -0.007], [1, y - 0.012, 0.004], [1, y + 0.012, 0.004], [1, y + 0.012, -0.007]], [3]);
        bar.cut(sweptOutlines(along, [1, y - 0.012, 0.004], [1, y + 0.012, 0.004], 0.0075)).append(rubber);
      }
      if (bumper.ends) {
        // Caps over the wrapped ends: the path's first and last three points, a size up. What
        // of the bar lies inside a cap is cut away.
        const capWrap = bumper.wrap === undefined ? 0.17 : wrap + 0.01;
        const caps = bumperPath(half + 0.004, zFace, end, blade + 0.006, reach - blade, capWrap, undefined, flank(0.004, capWrap));
        const cap = finishSlot(bumper.ends);
        const section: SectionPoint[] = [[0, y0 - 0.006], [1, y0 - 0.006], [1, y1 + 0.006], [0, y1 + 0.006]];
        const covers = new PartBuilder().color(cap.color);
        for (const ends of [caps.slice(0, 3), caps.slice(-3)]) {
          sweep(covers, cap.slot, ends, section);
          bar.cut([
            ...sweptOutlines(ends, section[1]!, section[2]!, 0.012),
            ...sweptOutlines(ends, section[0]!, section[1]!, 0.012),
            ...sweptOutlines(ends, section[2]!, section[3]!, 0.012),
          ]);
        }
        bar.append(covers);
      }
      b.append(bar);
      for (const side of [1, -1]) {
        const o = bumper.overriders;
        if (o) {
          const finish = finishSlot(o.finish);
          b.color(finish.color).bevelBox(finish.slot, [side * (half - o.inset), y - o.drop, zFace + end * (reach - 0.02)], [o.half[0], o.half[1], 0.028], 0.012);
        }
        // Bracket from the body to the blade, without its face on the body (it would lie in
        // the end face's plane).
        const zOut = zFace + end * (reach - blade);
        b.color(BLACK).boxFrom('trim', [side * (half - 0.32) - 0.02, y - 0.02, Math.min(zFace, zOut)], [side * (half - 0.32) + 0.02, y + 0.02, Math.max(zFace, zOut)], end > 0 ? 0b011111 : 0b101111);
      }
    } else {
      // Moulded plastic bumper: deep, wrapping the corners, its face bevelled top and
      // bottom and its foot drawn in, with a moulding groove along it.
      const depth = reach + 0.01;
      // As wide as the face at its widest, which on a leaning nose is low down.
      const half = Math.min(Math.max(sec.r1[0], sec.r2[0]) + 0.03, widest - depth * 0.35);
      const wrapTo = bumper.wrapTo;
      const corner = bumper.corner ?? 0.09;
      const path = wrapTo === undefined
        ? bumperPath(half, zFace - end * 0.01, end, depth, 0, 0.2, bumper.corner)
        : flankBumperPath(frame, sEnd, end, y1, depth, 0, wrapTo, corner);
      const shell = bumper.finish ? finishSlot(bumper.finish) : { slot: 'trim' as const, color: 0x232427 };
      // A flush bumper's top starts inside the body's skin and rounds out to its face in
      // its top 60 mm, so it grows out of the end face and the flanks with no ledge.
      const top: [number, number][] = bumper.flush
        ? [[1, y1 - 0.06], [0.5, y1 - 0.015], [0, y1]]
        : [[1, y1 - 0.05], [0.9, y1 - 0.005], [0.55, y1], [0, y1]];
      const section: [number, number][] = [[0, y0 + 0.02], [0.7, y0], [0.92, y0 + 0.03], [1, y0 + 0.08], ...top];
      const moulded = new PartBuilder().color(shell.color);
      // No back: it lies against the end face and the flanks.
      sweep(moulded, shell.slot, path, section, [section.length - 1]);
      // The moulding band, or else the groove's ridge, 6 mm proud of the face and rooted 7 mm
      // in it, a centimetre short of the bumper's ends. It goes on among the face's items
      // (`buildFace`), cutting the bumper's face and whatever else lies inside it.
      const band = bumper.moulding
        ? { ...finishSlot(bumper.moulding.finish), y: bumper.moulding.y, h: bumper.moulding.height / 2 }
        : { ...(bumper.finish ? shell : { slot: 'trim' as const, color: 0x34363a }), y: y0 + 0.11, h: 0.012 };
      const along = shortened(path, 0.01);
      const ridge = new PartBuilder().color(band.color);
      sweep(ridge, band.slot, along, [[1, band.y - band.h, -0.007], [1, band.y - band.h, 0.006], [1, band.y + band.h, 0.006], [1, band.y + band.h, -0.007]], [3]);
      b.append(moulded);
      const volume = sweptOutlines(along, [1, band.y - band.h, -0.0005], [1, band.y + band.h, -0.0005], 0.0065).map((o) => ({ ...o, solid: true }));
      ridges.set(end, { part: ridge, volume, y0: band.y - band.h, y1: band.y + band.h, front: reach + 0.006 });
      bumperHoles(ctx, path, section, end, wrapTo === undefined ? 0 : flankPoints(path) - 1);
    }
  }
  return ridges;
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

/**
 * An amber repeater on each front wing (`KitLook.repeater`), in its side's blinker slot,
 * rooted `FACE_ROOT` in the wing and standing 10 mm out of it: what is inside it (a waist
 * moulding it sits on) and the skin under it are cut away.
 */
function buildRepeaters(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const r = frame.spec.look.repeater;
  if (!r) return;
  const s = (r.s0 + r.s1) / 2;
  const y = (r.y0 + r.y1) / 2;
  const [hy, hz] = [(r.y1 - r.y0) / 2, (r.s1 - r.s0) / 2];
  for (const side of [1, -1]) {
    const skin = frame.sideX(s, y);
    const x = side * (skin + (0.01 - FACE_ROOT) / 2);
    const at = (px: number): Vec3[] => [[px, y - hy, frame.z(s) - hz], [px, y - hy, frame.z(s) + hz], [px, y + hy, frame.z(s) + hz], [px, y + hy, frame.z(s) - hz]];
    body.cut([{ poly: at(x), reach: (0.01 + FACE_ROOT) / 2, solid: true }]);
    lens(body, lampSlot('blinker', side), [x, y, frame.z(s)], [(0.01 + FACE_ROOT) / 2, hy, hz]);
    ctx.holes.push({ owner: 'body', outline: { poly: at(side * skin) } });
  }
}

/** How far a corner lamp's lens stands off the body: flush, just clear of the paint. */
const CORNER_LAMP_OUT = 0.004;
/** A side row (crease or belt) inside a corner lamp by more than this bends the lens along it. */
const CORNER_LAMP_KINK = 0.005;

/**
 * Lamp units wrapping round the corners of an end face (`KitLook.cornerLamps`): a thin
 * lens lying on the face from its inner end to the corner and on along the flank, every
 * stretch between two points in its role's slot, with a rim rooted `FACE_ROOT` into the
 * body; the skin under each stretch is cut away. The lens is flat wherever the skin is:
 * on the flank it bends only at the tub's columns (between them the skin is flat faces)
 * and, across its height, only at a side row the skin bends at (the crease or the belt)
 * where one runs through it; elsewhere it is one flat piece from its bottom to its top.
 */
function buildCornerLamps(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const lamps = frame.spec.look.cornerLamps;
  if (!lamps) return;
  const stations = frame.spec.stations;
  const cols = tubColumns(frame);
  const diag = Math.SQRT1_2;
  for (const lamp of lamps) {
    // The face it starts on, and which way that face looks along the car.
    const facing = lamp.end === 'rear' ? -1 : 1;
    const sFace = (facing > 0 ? stations[0]! : stations[stations.length - 1]!).s;
    const zFace = frame.z(sFace);
    const points = lamp.points;
    // Off the face, a stretch breaks at every tub column it crosses.
    const stretches = points.slice(0, -1).map((a, i): CornerLampPoint[] => {
      const c = points[i + 1]!;
      if (a.x !== undefined || c.x !== undefined) return [a, c];
      const sa = a.s ?? sFace;
      const sc = c.s ?? sFace;
      const inner = cols.filter((s) => s > Math.min(sa, sc) + 1e-6 && s < Math.max(sa, sc) - 1e-6);
      if (sc < sa) inner.reverse();
      return [a, ...inner.map((s): CornerLampPoint => {
        const t = (s - sa) / (sc - sa);
        return { s, y: [lerp(a.y[0], c.y[0], t), lerp(a.y[1], c.y[1], t)] };
      }), c];
    });
    // The side's rows (crease, belt) that run through the lamp on the flank or at the
    // corner: the lens bends along them there; on the end face, which is flat, a row
    // only has to be where its neighbour's is.
    const flankS = (p: CornerLampPoint): number => p.s ?? sFace;
    const onFlank = stretches.flat().filter((p) => p.x === undefined);
    const kinks = (['crease', 'belt'] as const).filter((row) =>
      onFlank.some((p) => {
        const y = frame.station(flankS(p))[row];
        return y > p.y[0] + CORNER_LAMP_KINK && y < p.y[1] - CORNER_LAMP_KINK;
      }));
    const rowsAt = (p: CornerLampPoint): number[] => [
      p.y[0],
      ...kinks.map((row) => Math.min(p.y[1] - CORNER_LAMP_KINK, Math.max(p.y[0] + CORNER_LAMP_KINK, frame.station(flankS(p))[row]))).sort((u, v) => u - v),
      p.y[1],
    ];
    for (const side of [1, -1]) {
      // A column across the lamp at a point, one entry per row: [on the body, on the
      // lens, rooted in the body], `d` metres out along the body's normal there.
      const column = (p: CornerLampPoint): [Vec3, Vec3, Vec3][] =>
        rowsAt(p).map((y): [Vec3, Vec3, Vec3] => {
          let at: (d: number) => Vec3;
          if (p.x !== undefined) {
            const [xb, xt] = typeof p.x === 'number' ? [p.x, p.x] : p.x;
            const x = side * lerp(xb, xt, (y - p.y[0]) / (p.y[1] - p.y[0]));
            at = (d) => [x, y, zFace + facing * d];
          } else if (p.s !== undefined) {
            const x = skinX(frame, p.s, y);
            const z = frame.z(p.s);
            at = (d) => [side * (x + d), y, z];
          } else {
            const x = skinX(frame, sFace, y);
            at = (d) => [side * (x + d * diag), y, zFace + facing * d * diag];
          }
          return [at(0), at(CORNER_LAMP_OUT), at(-FACE_ROOT)];
        });
      for (const [i, stretch] of stretches.entries()) {
        const role = points[i]!.role;
        if (!role) throw new Error(`Kit car "${frame.spec.id}": a corner lamp's point before its last has no role`);
        const slot = lampSlot(role, side);
        const columns = stretch.map(column);
        const top = columns[0]!.length - 1;
        body.color(0xffffff);
        for (let k = 0; k + 1 < columns.length; k++) {
          const p = columns[k]!;
          const q = columns[k + 1]!;
          body.bridge(slot, p.map(([, o]) => o), q.map(([, o]) => o));
          // Its rim from inside the body along the bottom and top edges.
          for (const r of [0, top]) body.quad(slot, p[r]![2], q[r]![2], q[r]![1], p[r]![1]);
          for (let r = 0; r < top; r++) ctx.holes.push({ owner: 'body', outline: { poly: [p[r]![0], q[r]![0], q[r + 1]![0], p[r + 1]![0]] } });
        }
        // And across its two ends.
        const last = columns[columns.length - 1]!;
        if (i === 0) body.bridge(slot, columns[0]!.map(([, , s]) => s), columns[0]!.map(([, o]) => o));
        if (i + 1 === stretches.length) body.bridge(slot, last.map(([, , s]) => s), last.map(([, o]) => o));
      }
    }
  }
}

/**
 * A door mirror's head, aimed by hand from a front seat through the door's glass:
 * held, the mouse turns it (rig.ts `aim`), as the inside mirror (interior.ts
 * `MIRROR_CONTROL`). `channel` is `mirror_l` or `mirror_r`.
 */
function sideMirrorControl(channel: string, side: number): KitControl {
  return {
    id: channel,
    label: `Зеркало ${side > 0 ? 'левое' : 'правое'} (держите E и ведите мышью)`,
    action: { type: 'aim', channel: `${channel}_pitch`, yaw: `${channel}_yaw`, limit: 0.25 },
  };
}

/** Door hardware outside: handle, and a mirror on each front door, in `KitLook.brightwork`. */
function buildDoorHardware(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const spec = frame.spec;
  const chrome = spec.look.brightwork === 'chrome';
  const finish = finishSlot(spec.look.brightwork);
  const eye = driverEyeAt(frame);
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
    if (!front || (side < 0 && spec.look.mirrors === 'left')) continue;
    // Mirror: a stalk from the door's front top corner and a head on it, turned so the
    // driver sees straight back along the flank in it (`mirrorFrame`), the car's side a
    // sliver at its inner edge; the far one turns further than his own.
    const ms = spec.cabin.columns[1]!.s + 0.08;
    const my = frame.station(ms).belt + 0.06;
    const mx = frame.sideX(ms, frame.station(ms).belt);
    const m = new PartBuilder().color(finish.color);
    m.boxFrom(finish.slot, [side > 0 ? mx - 0.01 : -mx - 0.07, my - 0.04, frame.z(ms) - 0.03], [side > 0 ? mx + 0.07 : -mx + 0.01, my - 0.02, frame.z(ms) + 0.03]);
    const holder = new THREE.Group();
    holder.name = `${owner}_mirror`;
    addBuilt(holder, m, door.pivot, 'mirrors');
    // The head turns on a ball at its centre, by hand from a front seat (rig.ts `aim`), as
    // the inside mirror does: side to side about its own up, then up and down about its
    // own across, from the built aim.
    const h = new PartBuilder().color(finish.color);
    const head = h.push(mirrorFrame([side * (mx + 0.1), my + 0.02, frame.z(ms)], eye, [0, 0, -1])).matrix.clone();
    const e = head.elements;
    const centre: Vec3 = [e[12]!, e[13]!, e[14]!];
    const mirror = side > 0 ? 'left' : 'right';
    const channel = `mirror_${side > 0 ? 'l' : 'r'}`;
    const ball = pivotGroup(`${channel}_ball`, centre, { channel: `${channel}_yaw`, kind: 'rot', axis: [e[4]!, e[5]!, e[6]!], amount: 1 });
    const pane = pivotGroup(channel, centre, { channel: `${channel}_pitch`, kind: 'rot', axis: [e[0]!, e[1]!, e[2]!], amount: 1 }, sideMirrorControl(channel, side));
    ball.add(pane);
    holder.add(ball);
    ball.position.set(centre[0] - door.pivot[0], centre[1] - door.pivot[1], centre[2] - door.pivot[2]);
    pane.position.set(0, 0, 0);
    h.bevelBox(finish.slot, [0, 0, 0], [0.06, 0.045, 0.025], 0.015);
    // The glass 3 mm proud of the head's face, which is cut under it; no back, it lies in the head.
    h.cut([{ poly: ([[-0.05, -0.035], [0.05, -0.035], [0.05, 0.035], [-0.05, 0.035]] as const).map(([gx, gy]): Vec3 => {
      const p = new THREE.Vector3(gx, gy, -0.025).applyMatrix4(h.matrix);
      return [p.x, p.y, p.z];
    }), reach: 0.0005 }]);
    h.color(0x7a8a96).box('chrome', [0, 0, -0.026], [0.05, 0.035, 0.002], 0b101111);
    // The live face 1.5 mm proud of the glass.
    addMirrorFace(pane, h.matrix, centre, [0.05, 0.035], -0.0295, mirror);
    h.pop();
    addBuilt(pane, h, centre, 'mirrors');
    holder.traverse((node) => {
      if (node instanceof THREE.Mesh) node.name = 'mirrors';
    });
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
 * A parked arm lies at most this steep, low along the screen's foot: the longest arm that
 * parks so. Where a screen curved in plan lifts its foot towards the pillar too far for
 * that (the tens'), at most the second, and then the arm that parks lowest, shortened as
 * far as that takes: the longest one there stood up to 45° across the driver's view.
 */
const WIPER_PARKS = [(20 * Math.PI) / 180, (45 * Math.PI) / 180];
/** The blade keeps this far inside the pane's sides and top: the pillars and header stand proud. */
const WIPER_EDGE = 0.015;
/** And this far above its bottom edge: half the blade's width and a little. */
const WIPER_FOOT = 0.006;
/** The blade's rubber edge clears the glass by this much where the glass stands highest under it: 6 mm, so the two never fight in depth from the road. */
const WIPER_GAP = 0.006;
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
  const head = new THREE.Vector3(0, cabin.rail + cabin.crown - frame.roofDrop(cabin.columns[0]!.top), frame.z(cabin.columns[0]!.top));
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
     * between the pillars; failing that, of the arms that park within the steeper limit
     * and sweep 90°, the one parked lowest (the longest of those).
     */
    const fit = (): void => {
      let top = 0;
      for (let r = 0.05; r < 1.2; r += 0.005) {
        if (onPane(point(Math.PI / 2, r, q), n)) top = r;
        else if (top > 0) break;
      }
      for (const [pass, steepest] of WIPER_PARKS.entries()) {
        let low: [number, number, number] | null = null;
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
          if (sweep < WIPER_SWEEP_MIN) continue;
          if (pass === 0) return;
          if (!low || rest < low[1]) low = [arm, rest, sweep];
        }
        if (low) {
          [arm, rest, sweep] = low;
          return;
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

/**
 * A cup with a cap behind the fuel flap, so an open flap shows a filler, not a void. Its
 * rim follows the skin as built at each corner, 5 mm inside it: the flank tapers and
 * leans in over the flap, and a cup squared to the skin at the flap's middle stood out
 * through the closed flap at its rear top corner (a black wedge on the 2110 and 2112).
 */
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
  // 12 mm inside the opening each way, clear of the flap's edge returns and the jambs.
  const hz = (flap.s1 - flap.s0) / 2 - 0.012;
  const hy = (flap.y1 - flap.y0) / 2 - 0.012;
  const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([ds, dy]): [number, number] => [s + ds * hz, y + dy * hy]);
  const rim = corners.map(([cs, cy]): Vec3 => [side * (skinX(frame, cs, cy) - 0.005), cy, frame.z(cs)]);
  const back = corners.map(([cs, cy]): Vec3 => [side * (skin - 0.035), cy, frame.z(cs)]);
  for (let i = 0; i < 4; i++) b.quad('trim', back[i]!, back[(i + 1) % 4]!, rim[(i + 1) % 4]!, rim[i]!);
  b.quad('trim', back[3]!, back[2]!, back[1]!, back[0]!);
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
    const lid = facing > 0 ? 'bonnet' : ctx.nodes.has('boot') ? 'boot' : 'tailgate';
    const node = ctx.nodes.get(lid);
    if (!node) throw new Error(`Kit car "${ctx.frame.spec.id}" has ${facing > 0 ? 'nose items but no bonnet' : 'lid items but no boot lid or tailgate'}`);
    const b = new PartBuilder();
    buildFace(new EndFace(ctx.frame, facing, lid, ctx.holes), items, b);
    addBuilt(node.node, b, node.pivot, facing > 0 ? 'nose_face' : 'lid_face');
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
      : lerp(knee.y, cabin.rail + cabin.crown - frame.roofDrop(roofRear), (knee.s - s) / (knee.s - roofRear)) - cabin.crown * Math.min(1, (x / cabin.railHalf) ** 2);
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
  // The lamp in a black surround on the pedestal's back: the surround reaches 10 mm into the
  // pedestal, which is cut inside it, and the lens 2 mm into the surround, cut under it.
  const lamp = sp.lamp;
  const ly = (lamp.y0 + lamp.y1) / 2;
  const lh = (lamp.y1 - lamp.y0) / 2;
  const zb = frame.z(ped.s1);
  const across = (poly: readonly P2[], z: number, reach: number): Outline => ({ poly: poly.map(([x, y]): Vec3 => [x, y, z]), reach, solid: true });
  const surround = new PartBuilder().color(BLACK).boxFrom('trim', [-lamp.half - 0.008, ly - lh - 0.006, zb - 0.004], [lamp.half + 0.008, ly + lh + 0.006, zb + 0.01], 0b101111);
  const bevel = Math.min(lamp.half, lh) * 0.35;
  surround.cut([across(octagon(0, ly, lamp.half, lh, bevel), zb - 0.004, 0.006)]);
  surround.bevelBox('lamp_brake', [0, ly, zb - 0.004], [lamp.half, lh, 0.006], bevel, 'z0');
  b.cut([across(rect(-lamp.half - 0.008, ly - lh - 0.006, lamp.half + 0.008, ly + lh + 0.006), zb + 0.003, 0.007)]).append(surround);
  addBuilt(lid.node, b, lid.pivot, 'spoiler');
}

export function buildExterior(ctx: KitContext): void {
  const body = new PartBuilder();
  // Bumpers first: a face item standing on one (a fog-lamp blank, an intake) cuts it.
  const ridges = buildBumpers(ctx, body);
  buildFace(new EndFace(ctx.frame, 1, 'body', ctx.holes), ctx.frame.spec.look.front.items, body, ridges.get(1));
  buildFace(new EndFace(ctx.frame, -1, 'body', ctx.holes), ctx.frame.spec.look.rear.items, body, ridges.get(-1));
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
