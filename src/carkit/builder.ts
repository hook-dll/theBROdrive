/**
 * Triangle soup builder for the car kit.
 *
 * Every kit surface is flat shaded, as the low-poly packs are: each triangle owns its
 * three vertices and the face normal, so a part is a non-indexed buffer per material
 * slot. Shapes are written in the builder's current frame (`push`/`pop`), which is how
 * a seat or a pedal is modelled about its own origin and then placed.
 */

import * as THREE from 'three';

export type Vec3 = readonly [number, number, number];

/** Material slots a kit part draws with; see `kitMaterial` in kit.ts. */
export type KitSlot =
  | 'paint'
  | 'glass'
  | 'trim'
  | 'chrome'
  | 'tyre'
  | 'rim'
  | 'alloy'
  | 'lamp_head'
  | 'lamp_tail'
  | 'lamp_brake'
  | 'lamp_reverse'
  | 'lamp_blinker_l'
  | 'lamp_blinker_r'
  | 'lamp_inert'
  | 'lamp_glow';

interface SlotBuffer {
  positions: number[];
  colors: number[];
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

export function colour(hex: number): Vec3 {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/** Which caps a prism gets (`PartBuilder.extrude`): both, none, or only the one at z0 or z1. */
export type Caps = boolean | 'z0' | 'z1';

export class PartBuilder {
  private readonly slots = new Map<KitSlot, SlotBuffer>();
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private ink: Vec3 = [1, 1, 1];

  get matrix(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1]!;
  }

  /** Composes `m` onto the current frame until the matching `pop`. */
  push(m: THREE.Matrix4): this {
    this.stack.push(this.matrix.clone().multiply(m));
    return this;
  }

  /** Translation, then rotation by Euler XYZ (radians), then uniform scale. */
  pushAt(position: Vec3, rotation: Vec3 = [0, 0, 0], scale = 1): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(scale, scale, scale),
    );
    return this.push(m);
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Vertex colour for the following faces (only vertex-coloured slots read it). */
  color(hex: number | Vec3): this {
    this.ink = typeof hex === 'number' ? colour(hex) : hex;
    return this;
  }

  get empty(): boolean {
    for (const buffer of this.slots.values()) if (buffer.positions.length > 0) return false;
    return true;
  }

  private buffer(slot: KitSlot): SlotBuffer {
    let buffer = this.slots.get(slot);
    if (!buffer) {
      buffer = { positions: [], colors: [] };
      this.slots.set(slot, buffer);
    }
    return buffer;
  }

  tri(slot: KitSlot, a: Vec3, b: Vec3, c: Vec3): this {
    const m = this.matrix;
    _a.set(a[0], a[1], a[2]).applyMatrix4(m);
    _b.set(b[0], b[1], b[2]).applyMatrix4(m);
    _c.set(c[0], c[1], c[2]).applyMatrix4(m);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    if (_ab.cross(_ac).lengthSq() < 1e-14) return this;
    const buffer = this.buffer(slot);
    buffer.positions.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
    const [r, g, bl] = this.ink;
    buffer.colors.push(r, g, bl, r, g, bl, r, g, bl);
    return this;
  }

  /** Planar polygon as a fan; for a quad pass a, b, c, d in order round the edge. */
  poly(slot: KitSlot, points: readonly Vec3[]): this {
    for (let i = 1; i + 1 < points.length; i++) this.tri(slot, points[0]!, points[i]!, points[i + 1]!);
    return this;
  }

  quad(slot: KitSlot, a: Vec3, b: Vec3, c: Vec3, d: Vec3): this {
    // Split along the shorter diagonal: a bent quad folds where it bends least.
    const ac = dist2(a, c);
    const bd = dist2(b, d);
    if (ac <= bd) {
      this.tri(slot, a, b, c).tri(slot, a, c, d);
    } else {
      this.tri(slot, a, b, d).tri(slot, b, c, d);
    }
    return this;
  }

  /**
   * Connects two rings of equal length with quads; `closed` joins last to first.
   */
  bridge(slot: KitSlot, lower: readonly Vec3[], upper: readonly Vec3[], closed = false): this {
    const n = lower.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      this.quad(slot, lower[i]!, lower[j]!, upper[j]!, upper[i]!);
    }
    return this;
  }

  /** Axis-aligned box (in the current frame) from its centre and half sizes. */
  box(slot: KitSlot, centre: Vec3, half: Vec3, faces = 0b111111): this {
    const [cx, cy, cz] = centre;
    const [hx, hy, hz] = half;
    const p = (sx: number, sy: number, sz: number): Vec3 => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
    if (faces & 1) this.quad(slot, p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1));
    if (faces & 2) this.quad(slot, p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1));
    if (faces & 4) this.quad(slot, p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1));
    if (faces & 8) this.quad(slot, p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1));
    if (faces & 16) this.quad(slot, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
    if (faces & 32) this.quad(slot, p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1));
    return this;
  }

  /** Box between two corners. */
  boxFrom(slot: KitSlot, min: Vec3, max: Vec3, faces = 0b111111): this {
    return this.box(
      slot,
      [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      [Math.abs(max[0] - min[0]) / 2, Math.abs(max[1] - min[1]) / 2, Math.abs(max[2] - min[2]) / 2],
      faces,
    );
  }

  /**
   * Box with its top and bottom edges chamfered by `bevel`: an eight-sided section
   * extruded along Z. Reads as moulded rather than stacked. `caps` as `extrude`'s;
   * `closed = false` leaves out the bottom face: a box standing on another part.
   */
  bevelBox(slot: KitSlot, centre: Vec3, half: Vec3, bevel: number, caps: Caps = true, closed = true): this {
    const [cx, cy, cz] = centre;
    const [hx, hy, hz] = half;
    const b = Math.min(bevel, hx * 0.9, hy * 0.9);
    // The bottom face is the section's closing edge (last point to first).
    const section: [number, number][] = [
      [hx - b, -hy], [hx, -hy + b], [hx, hy - b], [hx - b, hy],
      [-hx + b, hy], [-hx, hy - b], [-hx, -hy + b], [-hx + b, -hy],
    ];
    return this.extrude(slot, section, cz - hz, cz + hz, cx, cy, caps, closed);
  }

  /**
   * Prism: a convex or star-shaped XY section (counter-clockwise) extruded along Z
   * from `z0` to `z1`, offset by (ox, oy). Caps are fans from the centroid, at both ends,
   * neither, or only the one at `z0` or `z1` (a part rooted in a face has no back).
   * `closed = false` leaves out the wall along the section's closing edge (last point to
   * first): the face of a prism whose side lies on another part.
   */
  extrude(slot: KitSlot, section: readonly (readonly [number, number])[], z0: number, z1: number, ox = 0, oy = 0, caps: Caps = true, closed = true): this {
    const front: Vec3[] = section.map(([x, y]) => [x + ox, y + oy, z1]);
    const back: Vec3[] = section.map(([x, y]) => [x + ox, y + oy, z0]);
    this.bridge(slot, back, front, closed);
    if (caps) {
      let mx = 0;
      let my = 0;
      for (const [x, y] of section) {
        mx += x;
        my += y;
      }
      mx = mx / section.length + ox;
      my = my / section.length + oy;
      const n = section.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (caps !== 'z0') this.tri(slot, [mx, my, z1], front[i]!, front[j]!);
        if (caps !== 'z1') this.tri(slot, [mx, my, z0], back[j]!, back[i]!);
      }
    }
    return this;
  }

  /** Cylinder along local X, centred on `centre`. */
  cylinderX(slot: KitSlot, centre: Vec3, radius: number, halfLength: number, segments: number, caps = true): this {
    const section: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      section.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    this.push(new THREE.Matrix4().makeTranslation(centre[0], centre[1], centre[2]).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
    this.extrude(slot, section, -halfLength, halfLength, 0, 0, caps);
    return this.pop();
  }

  /** Cylinder along local Y. */
  cylinderY(slot: KitSlot, centre: Vec3, radius: number, halfLength: number, segments: number, caps = true): this {
    const section: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      section.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    this.push(new THREE.Matrix4().makeTranslation(centre[0], centre[1], centre[2]).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
    this.extrude(slot, section, -halfLength, halfLength, 0, 0, caps);
    return this.pop();
  }

  /** Cylinder along local Z. */
  cylinderZ(slot: KitSlot, centre: Vec3, radius: number, halfLength: number, segments: number, caps: Caps = true): this {
    const section: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      section.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    return this.extrude(slot, section, centre[2] - halfLength, centre[2] + halfLength, centre[0], centre[1], caps);
  }

  /** Polygonal torus in the local XZ plane round the Y axis (a steering-wheel rim). */
  torusY(slot: KitSlot, radius: number, tube: number, segments: number, sides: number): this {
    const rings: Vec3[][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const ring: Vec3[] = [];
      for (let j = 0; j < sides; j++) {
        const b = (j / sides) * Math.PI * 2;
        const r = radius + Math.cos(b) * tube;
        ring.push([Math.cos(a) * r, Math.sin(b) * tube, Math.sin(a) * r]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < segments; i++) this.bridge(slot, rings[i]!, rings[(i + 1) % segments]!, true);
    return this;
  }

  /** One mesh per slot; non-indexed, flat normals. */
  build(): Map<KitSlot, THREE.BufferGeometry> {
    const out = new Map<KitSlot, THREE.BufferGeometry>();
    for (const [slot, buffer] of this.slots) {
      if (buffer.positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      out.set(slot, geometry);
    }
    return out;
  }

  triangleCount(): number {
    let n = 0;
    for (const buffer of this.slots.values()) n += buffer.positions.length / 9;
    return n;
  }

  /** Cuts every slot's faces away under the outlines (`cutUnder`), in this builder's frame. */
  cut(outlines: readonly Outline[]): this {
    if (outlines.length === 0) return this;
    for (const [slot, buffer] of this.slots) {
      const { positions, colors } = cutUnder(buffer.positions, buffer.colors, outlines);
      this.slots.set(slot, { positions, colors });
    }
    return this;
  }

  /** Takes `other`'s faces into this builder's slots (both built in the same frame). */
  append(other: PartBuilder): this {
    for (const [slot, buffer] of other.slots) {
      const mine = this.buffer(slot);
      mine.positions = mine.positions.concat(buffer.positions);
      mine.colors = mine.colors.concat(buffer.colors);
    }
    return this;
  }
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Newell normal times area of a planar-ish polygon. */
export function newell(points: readonly Vec3[]): Vec3 {
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

export function polygonArea(points: readonly Vec3[]): number {
  const n = newell(points);
  return Math.hypot(n[0], n[1], n[2]);
}

/**
 * The part of a convex polygon where `sign × g` is not negative, cut where g crosses 0.
 * A crossing is interpolated from its edge's ends in one fixed order, so two polygons
 * sharing an edge get the very same point there and leave no crack between them.
 */
export function clipPolygon(points: readonly Vec3[], g: (p: Vec3) => number, sign: 1 | -1): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const gp = sign * g(p);
    const gq = sign * g(q);
    if (gp >= 0) out.push(p);
    if ((gp > 0 && gq < 0) || (gp < 0 && gq > 0)) {
      const pFirst = p[0] !== q[0] ? p[0] < q[0] : p[1] !== q[1] ? p[1] < q[1] : p[2] < q[2];
      const [a, b, ga, gb] = pFirst ? [p, q, gp, gq] : [q, p, gq, gp];
      const t = ga / (ga - gb);
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
    }
  }
  return out;
}

/**
 * Where a part stands on a surface it is built on (`cutUnder`): a convex outline, a little
 * inside the part's edge, and how far either side of its plane the part reaches. The
 * part's walls must stand all round it through the surface, so the cut is never seen.
 */
export interface Outline {
  readonly poly: readonly Vec3[];
  /** Faces under the outline within this of its plane are cut (default `CUT_REACH`). */
  readonly reach?: number;
  /**
   * Cut every face within the prism (outline × reach), whatever way it faces: the volume
   * of a part, inside which another part's walls are hidden. Otherwise only faces turned
   * less than 40° from the outline are cut: a surface the part stands on.
   */
  readonly solid?: boolean;
  /**
   * Keep a face lying flush on one of the prism's sides and facing out of it: the wall of
   * a part placed against this one's volume, where this one's own wall has given way
   * (`EndFace.place`). Otherwise a face flush with a side counts as inside.
   */
  readonly keepOutside?: boolean;
}

/** A surface the part stands on lies within this of its outline's plane… */
const CUT_REACH = 0.015;
/** …and is turned less than 40° from it. */
const CUT_TURN = Math.cos((40 * Math.PI) / 180);
/** Pieces smaller than this (m²) are dropped: far below a pixel at any distance. */
const CUT_SLIVER = 1e-12;

/**
 * Flat triangles (9 numbers each, one colour per triangle repeated) less what lies under
 * the outlines. An outline's sides are planes square to it through its edges, so the cut
 * follows it across every facet it covers, and two facets sharing an edge are cut at the
 * same point on it (`clipPolygon`). A part's surface under it is hidden but lies within
 * millimetres of it, so at a distance the depth buffer cannot tell them apart.
 */
export function cutUnder(positions: readonly number[], colors: readonly number[], outlines: readonly Outline[]): { positions: number[]; colors: number[]; from: number[] } {
  const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cutters = outlines.map(({ poly, reach = CUT_REACH, solid = false, keepOutside = false }) => {
    const n = unit(newell(poly));
    // Inward side planes: the outline runs counter-clockwise about its Newell normal. Two
    // more bound the slab `reach` either side of its plane, so a face crossing the slab is
    // cut only within it: inside the part, whose front and back stand at its faces.
    const d = dot(n, poly[0]!);
    const walls = poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      const e: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const m = unit([n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]]);
      return { m, at: dot(m, p) };
    });
    // The same micrometre's grace as the slab's below: a wall flush with a side is inside.
    const sides = walls.map(({ m, at }) => (x: Vec3): number => dot(m, x) - at + 1e-6);
    // A micrometre's grace, so a face flush with the slab's edge (a part's back on another's) is inside it.
    sides.push((x) => reach + 1e-6 - (dot(n, x) - d), (x) => reach + 1e-6 + (dot(n, x) - d));
    // Its box, grown by the reach: a triangle clear of it is not touched.
    const lo = [0, 1, 2].map((a) => Math.min(...poly.map((p) => p[a]!)) - reach - 1e-5);
    const hi = [0, 1, 2].map((a) => Math.max(...poly.map((p) => p[a]!)) + reach + 1e-5);
    // A triangle flush on a side or the slab's front or back, facing out of the prism.
    const bounds = [...walls, { m: [-n[0], -n[1], -n[2]] as Vec3, at: -d - reach }, { m: n, at: d - reach }];
    const outside = (tri: readonly Vec3[], facing: Vec3): boolean =>
      keepOutside && bounds.some(({ m, at }) => dot(facing, m) < -0.5 && tri.every((x) => Math.abs(dot(m, x) - at) < 2e-6));
    return { n, sides, lo, hi, solid, outside };
  });
  const outPositions: number[] = [];
  const outColors: number[] = [];
  /** Each output triangle's input triangle, for tags kept per triangle elsewhere. */
  const from: number[] = [];
  for (let t = 0; t < positions.length; t += 9) {
    const tri: Vec3[] = [0, 3, 6].map((k): Vec3 => [positions[t + k]!, positions[t + k + 1]!, positions[t + k + 2]!]);
    const facing = unit(newell(tri));
    let pieces: Vec3[][] = [tri];
    for (const c of cutters) {
      if (!c.solid && !(Math.abs(dot(facing, c.n)) >= CUT_TURN)) continue;
      if (c.outside(tri, facing)) continue;
      if ([0, 1, 2].some((a) => Math.max(tri[0]![a]!, tri[1]![a]!, tri[2]![a]!) < c.lo[a]! || Math.min(tri[0]![a]!, tri[1]![a]!, tri[2]![a]!) > c.hi[a]!)) continue;
      const next: Vec3[][] = [];
      for (const piece of pieces) {
        let inside: Vec3[] = piece;
        for (const side of c.sides) inside = clipPolygon(inside, side, 1);
        if (inside.length < 3 || polygonArea(inside) <= CUT_SLIVER) {
          next.push(piece);
          continue;
        }
        // The piece less the outline: what lies outside each side in turn.
        let rest: Vec3[] = piece;
        for (const side of c.sides) {
          const out = clipPolygon(rest, side, -1);
          if (out.length >= 3 && polygonArea(out) > CUT_SLIVER) next.push(out);
          rest = clipPolygon(rest, side, 1);
          if (rest.length < 3) break;
        }
      }
      pieces = next;
    }
    for (const piece of pieces) {
      for (let i = 1; i + 1 < piece.length; i++) {
        for (const p of [piece[0]!, piece[i]!, piece[i + 1]!]) outPositions.push(p[0], p[1], p[2]);
        for (let k = 0; k < 3; k++) outColors.push(colors[t]!, colors[t + 1]!, colors[t + 2]!);
        from.push(t / 9);
      }
    }
  }
  return { positions: outPositions, colors: outColors, from };
}

/** Piecewise-linear lookup in a table of [key, value] sorted by key, clamped. */
export function table(points: readonly (readonly [number, number])[], key: number): number {
  if (key <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [k1, v1] = points[i]!;
    if (key <= k1) {
      const [k0, v0] = points[i - 1]!;
      return lerp(v0, v1, (key - k0) / (k1 - k0 || 1));
    }
  }
  return points[points.length - 1]![1];
}
