import * as THREE from 'three';

/**
 * What already stands in a mirage field, so the next thing laid out can be refused
 * instead of pushed into it. A tableau is scattered by hash, and a hash does not know
 * where the last palm or teapot went: without this, two of them standing in each
 * other is a matter of when, not whether.
 *
 * Two shapes, because the fields hold two kinds of thing. A crossed-card plant or
 * hull reaches the same distance under any yaw, so a ground circle is exact for it
 * (`CircleOccupancy`). A solid form or a city block does not, and a circle round a
 * domino or a board square would refuse its own neighbours; those are boxes, oriented
 * and in three dimensions (`BoxOccupancy`), so a piece may stand ON a square and a
 * balloon may float over a mushroom.
 *
 * Touching is allowed, entering is not: two boxes overlap only when they interpenetrate
 * by more than `TOUCH_M` on every axis, which is what lets a board's squares abut and a
 * piece rest on its square without either being refused.
 */
const TOUCH_M = 0.02;

/** Ground circles: centre x, z and a radius, tested by the sum of radii. */
export class CircleOccupancy {
  private x = new Float64Array(256);
  private z = new Float64Array(256);
  private r = new Float64Array(256);
  private count = 0;

  clear(): void {
    this.count = 0;
  }

  fits(x: number, z: number, radius: number): boolean {
    for (let i = 0; i < this.count; i++) {
      const dx = x - this.x[i]!;
      const dz = z - this.z[i]!;
      const clearance = radius + this.r[i]!;
      if (dx * dx + dz * dz < clearance * clearance) return false;
    }
    return true;
  }

  add(x: number, z: number, radius: number): void {
    if (this.count === this.x.length) {
      this.x = grow(this.x);
      this.z = grow(this.z);
      this.r = grow(this.r);
    }
    this.x[this.count] = x;
    this.z[this.count] = z;
    this.r[this.count] = radius;
    this.count++;
  }
}

/** Floats per box: centre (3), three unit axes (9), three half extents (3), bounding radius (1). */
const STRIDE = 16;

const _axis = new THREE.Vector3();

/**
 * Oriented boxes, tested by separating axes (the fifteen of Gottschalk's OBB test), after
 * a bounding-sphere check that dismisses almost every pair.
 */
export class BoxOccupancy {
  private data = new Float64Array(STRIDE * 128);
  /** Boxes placed; setting it back is how a group that did not fit is undone. */
  count = 0;

  clear(): void {
    this.count = 0;
  }

  /**
   * Adds the box `matrix` makes of a local box (`centre`, `half`) when it clears
   * everything placed, and reports whether it did. `matrix` may scale unevenly but
   * must not shear, which a translation-rotation-scale compose never does.
   */
  tryAdd(matrix: THREE.Matrix4, centre: THREE.Vector3, half: THREE.Vector3): boolean {
    if ((this.count + 1) * STRIDE > this.data.length) this.data = grow(this.data);
    const d = this.data;
    const o = this.count * STRIDE;
    const e = matrix.elements;
    d[o] = e[0]! * centre.x + e[4]! * centre.y + e[8]! * centre.z + e[12]!;
    d[o + 1] = e[1]! * centre.x + e[5]! * centre.y + e[9]! * centre.z + e[13]!;
    d[o + 2] = e[2]! * centre.x + e[6]! * centre.y + e[10]! * centre.z + e[14]!;
    const halves = [half.x, half.y, half.z];
    for (let k = 0; k < 3; k++) {
      _axis.set(e[k * 4]!, e[k * 4 + 1]!, e[k * 4 + 2]!);
      const length = _axis.length();
      d[o + 3 + k * 3] = _axis.x / length;
      d[o + 4 + k * 3] = _axis.y / length;
      d[o + 5 + k * 3] = _axis.z / length;
      d[o + 12 + k] = halves[k]! * length;
    }
    d[o + 15] = Math.hypot(d[o + 12]!, d[o + 13]!, d[o + 14]!);
    for (let other = 0; other < this.count; other++) {
      if (overlaps(d, o, other * STRIDE)) return false;
    }
    this.count++;
    return true;
  }
}

const _r = new Float64Array(9);
const _abs = new Float64Array(9);

/** Whether boxes at offsets `a` and `b` of `d` interpenetrate by more than `TOUCH_M`. */
function overlaps(d: Float64Array, a: number, b: number): boolean {
  const tx = d[b]! - d[a]!;
  const ty = d[b + 1]! - d[a + 1]!;
  const tz = d[b + 2]! - d[a + 2]!;
  const reach = d[a + 15]! + d[b + 15]! - TOUCH_M;
  if (tx * tx + ty * ty + tz * tz >= reach * reach) return false;
  // R[i][j] = Ai . Bj, and T in A's frame.
  const t = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const ai = a + 3 + i * 3;
    t[i] = tx * d[ai]! + ty * d[ai + 1]! + tz * d[ai + 2]!;
    for (let j = 0; j < 3; j++) {
      const bj = b + 3 + j * 3;
      const value = d[ai]! * d[bj]! + d[ai + 1]! * d[bj + 1]! + d[ai + 2]! * d[bj + 2]!;
      _r[i * 3 + j] = value;
      _abs[i * 3 + j] = Math.abs(value) + 1e-9;
    }
  }
  const ea = [d[a + 12]!, d[a + 13]!, d[a + 14]!];
  const eb = [d[b + 12]!, d[b + 13]!, d[b + 14]!];
  for (let i = 0; i < 3; i++) {
    const rb = eb[0]! * _abs[i * 3]! + eb[1]! * _abs[i * 3 + 1]! + eb[2]! * _abs[i * 3 + 2]!;
    if (Math.abs(t[i]!) >= ea[i]! + rb - TOUCH_M) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = ea[0]! * _abs[j]! + ea[1]! * _abs[3 + j]! + ea[2]! * _abs[6 + j]!;
    const projected = Math.abs(t[0]! * _r[j]! + t[1]! * _r[3 + j]! + t[2]! * _r[6 + j]!);
    if (projected >= ra + eb[j]! - TOUCH_M) return false;
  }
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;
      const ra = ea[i1]! * _abs[i2 * 3 + j]! + ea[i2]! * _abs[i1 * 3 + j]!;
      const rb = eb[j1]! * _abs[i * 3 + j2]! + eb[j2]! * _abs[i * 3 + j1]!;
      const projected = Math.abs(t[i2]! * _r[i1 * 3 + j]! - t[i1]! * _r[i2 * 3 + j]!);
      // The cross axis Ai x Bj is not unit length; the tolerance is scaled to it.
      const length = Math.sqrt(Math.max(0, 1 - _r[i * 3 + j]! * _r[i * 3 + j]!));
      if (length > 1e-6 && projected >= ra + rb - TOUCH_M * length) return false;
    }
  }
  return true;
}

function grow(array: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> {
  const bigger = new Float64Array(array.length * 2);
  bigger.set(array);
  return bigger;
}
