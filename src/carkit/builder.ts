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
   * extruded along Z. Reads as moulded rather than stacked.
   */
  bevelBox(slot: KitSlot, centre: Vec3, half: Vec3, bevel: number): this {
    const [cx, cy, cz] = centre;
    const [hx, hy, hz] = half;
    const b = Math.min(bevel, hx * 0.9, hy * 0.9);
    const section: [number, number][] = [
      [hx - b, -hy], [hx, -hy + b], [hx, hy - b], [hx - b, hy],
      [-hx + b, hy], [-hx, hy - b], [-hx, -hy + b], [-hx + b, -hy],
    ];
    return this.extrude(slot, section, cz - hz, cz + hz, cx, cy);
  }

  /**
   * Prism: a convex or star-shaped XY section (counter-clockwise) extruded along Z
   * from `z0` to `z1`, offset by (ox, oy). Caps are fans from the centroid. `closed =
   * false` leaves out the wall along the section's closing edge (last point to first):
   * the face of a prism whose side lies on another part.
   */
  extrude(slot: KitSlot, section: readonly (readonly [number, number])[], z0: number, z1: number, ox = 0, oy = 0, caps = true, closed = true): this {
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
        this.tri(slot, [mx, my, z1], front[i]!, front[j]!);
        this.tri(slot, [mx, my, z0], back[j]!, back[i]!);
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
  cylinderZ(slot: KitSlot, centre: Vec3, radius: number, halfLength: number, segments: number, caps = true): this {
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
