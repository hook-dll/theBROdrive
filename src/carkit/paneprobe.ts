/**
 * The surface of one mesh under a point, found as `THREE.Raycaster.intersectObject(mesh,
 * false)[0]` finds it — the same bounds tests, the same `Ray.intersectTriangle` on the same
 * triangles, the same nearest hit (the first in the mesh's order among equal distances) —
 * but only over the triangles near the ray. The wipers (exterior.ts `buildWipers`) cast
 * some ten thousand short rays at the windscreen to fit each arm, nearly along the
 * screen's normal; three tries every triangle of the car's glass for each, and that was a
 * quarter of a car's build.
 *
 * The triangles are binned on a grid across `axis` (the rays' rough direction). A hit
 * lies on the ray within `far`, inside its triangle, so its triangle overlaps the ray's
 * segment's box: every other triangle is skipped, and the answer is the one three gives.
 */

import * as THREE from 'three';

/** Grid cell across the axis, m. */
const CELL = 0.03;
/** Slack on every box: a hit point computed in floats may sit a hair outside its triangle. */
const SLACK = 1e-3;

const _sphere = new THREE.Sphere();
const _local = new THREE.Ray();
const _inverse = new THREE.Matrix4();
const _sphereHit = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _point = new THREE.Vector3();
const _world = new THREE.Vector3();
const _end = new THREE.Vector3();

export class PaneProbe {
  private readonly ray = new THREE.Ray();
  private readonly layers = new THREE.Layers();
  /** Each triangle's three vertex indices, in the order three walks them. */
  private readonly corners: Uint32Array;
  /** Each triangle's box in (u, v, w): min u, max u, min v, max v, min w, max w. */
  private readonly boxes: Float64Array;
  private readonly u: THREE.Vector3;
  private readonly v: THREE.Vector3;
  private readonly w: THREE.Vector3;
  private readonly u0: number;
  private readonly v0: number;
  private readonly cols: number;
  private readonly rows: number;
  /** Triangles per cell: `cellStart[k]..cellStart[k + 1]` in `cellTris`, ascending. */
  private readonly cellStart: Uint32Array;
  private readonly cellTris: Uint32Array;
  /** Last query that took each triangle, so a triangle in several cells is tried once. */
  private readonly stamp: Uint32Array;
  private query = 0;
  private readonly found: number[] = [];

  /**
   * `mesh` as it stands (its world matrix is read as three's raycast reads it, not
   * updated); `axis` the rays' rough direction, in the world.
   */
  constructor(private readonly mesh: THREE.Mesh, axis: THREE.Vector3) {
    if (Array.isArray(mesh.material)) throw new Error(`PaneProbe: mesh "${mesh.name}" has a material per group`);
    const geometry = mesh.geometry;
    if (geometry.morphAttributes.position) throw new Error(`PaneProbe: mesh "${mesh.name}" has morph targets`);
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const range = geometry.drawRange;
    const start = Math.max(0, range.start);
    const end = Math.min(index ? index.count : position.count, range.start + range.count);
    const count = Math.max(0, Math.floor((end - start + 2) / 3));
    this.corners = new Uint32Array(count * 3);
    for (let t = 0, i = start; i < end; i += 3, t++) {
      for (let k = 0; k < 3; k++) this.corners[t * 3 + k] = index ? index.getX(i + k) : i + k;
    }
    // A frame across the axis, in the mesh's own space (the rays are tested there).
    _inverse.copy(mesh.matrixWorld).invert();
    this.w = axis.clone().transformDirection(_inverse);
    this.u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(this.w.x) > 0.9) this.u.set(0, 1, 0);
    this.u.addScaledVector(this.w, -this.u.dot(this.w)).normalize();
    this.v = new THREE.Vector3().crossVectors(this.w, this.u);
    this.boxes = new Float64Array(count * 6);
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let t = 0; t < count; t++) {
      const box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        _a.fromBufferAttribute(position, this.corners[t * 3 + k]!);
        const p = [_a.dot(this.u), _a.dot(this.v), _a.dot(this.w)];
        for (let d = 0; d < 3; d++) {
          box[d * 2] = Math.min(box[d * 2]!, p[d]!);
          box[d * 2 + 1] = Math.max(box[d * 2 + 1]!, p[d]!);
        }
      }
      for (let d = 0; d < 6; d++) this.boxes[t * 6 + d] = box[d]! + (d % 2 === 0 ? -SLACK : SLACK);
      uMin = Math.min(uMin, this.boxes[t * 6]!);
      uMax = Math.max(uMax, this.boxes[t * 6 + 1]!);
      vMin = Math.min(vMin, this.boxes[t * 6 + 2]!);
      vMax = Math.max(vMax, this.boxes[t * 6 + 3]!);
    }
    if (count === 0) uMin = uMax = vMin = vMax = 0;
    this.u0 = uMin;
    this.v0 = vMin;
    this.cols = Math.max(1, Math.ceil((uMax - uMin) / CELL));
    this.rows = Math.max(1, Math.ceil((vMax - vMin) / CELL));
    // Bin each triangle into every cell its box touches; triangles go in ascending order.
    const cells = this.cols * this.rows;
    const counts = new Uint32Array(cells + 1);
    const each = (t: number, visit: (cell: number) => void): void => {
      const [c0, c1, r0, r1] = this.span(this.boxes[t * 6]!, this.boxes[t * 6 + 1]!, this.boxes[t * 6 + 2]!, this.boxes[t * 6 + 3]!);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) visit(r * this.cols + c);
    };
    for (let t = 0; t < count; t++) each(t, (cell) => counts[cell + 1]!++);
    for (let k = 0; k < cells; k++) counts[k + 1]! += counts[k]!;
    this.cellStart = counts.slice();
    this.cellTris = new Uint32Array(counts[cells]!);
    for (let t = 0; t < count; t++) each(t, (cell) => (this.cellTris[counts[cell]!++] = t));
    this.stamp = new Uint32Array(count);
  }

  /** The grid cells (columns c0..c1, rows r0..r1) a (u, v) box touches, clamped to the grid. */
  private span(uLo: number, uHi: number, vLo: number, vHi: number): [number, number, number, number] {
    const clampC = (x: number): number => Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.u0) / CELL)));
    const clampR = (x: number): number => Math.min(this.rows - 1, Math.max(0, Math.floor((x - this.v0) / CELL)));
    return [clampC(uLo), clampC(uHi), clampR(vLo), clampR(vHi)];
  }

  /**
   * The nearest point of the mesh on the ray from `origin` along `direction` (a unit
   * vector) within `far`, as `Raycaster.set(origin, direction)` with `near` 0 and `far`
   * finds it; a new vector, or undefined.
   */
  hit(origin: THREE.Vector3, direction: THREE.Vector3, far: number): THREE.Vector3 | undefined {
    const mesh = this.mesh;
    const geometry = mesh.geometry;
    const material = mesh.material as THREE.Material;
    if (!mesh.layers.test(this.layers) || material === undefined) return undefined;
    const ray = this.ray.set(origin, direction);
    // Mesh.raycast's bounds tests, as three makes them.
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    _sphere.copy(geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    _local.copy(ray).recast(0);
    if (!_sphere.containsPoint(_local.origin)) {
      if (_local.intersectSphere(_sphere, _sphereHit) === null) return undefined;
      if (_local.origin.distanceToSquared(_sphereHit) > far ** 2) return undefined;
    }
    _inverse.copy(mesh.matrixWorld).invert();
    _local.copy(ray).applyMatrix4(_inverse);
    if (geometry.boundingBox !== null && !_local.intersectsBox(geometry.boundingBox)) return undefined;

    // The triangles whose boxes meet the box of the ray's segment out to `far`.
    _end.copy(_local.origin).addScaledVector(_local.direction, far);
    const pu0 = _local.origin.dot(this.u);
    const pu1 = _end.dot(this.u);
    const pv0 = _local.origin.dot(this.v);
    const pv1 = _end.dot(this.v);
    const pw0 = _local.origin.dot(this.w);
    const pw1 = _end.dot(this.w);
    const uLo = Math.min(pu0, pu1);
    const uHi = Math.max(pu0, pu1);
    const vLo = Math.min(pv0, pv1);
    const vHi = Math.max(pv0, pv1);
    const wLo = Math.min(pw0, pw1);
    const wHi = Math.max(pw0, pw1);
    const [c0, c1, r0, r1] = this.span(uLo, uHi, vLo, vHi);
    const found = this.found;
    found.length = 0;
    const query = ++this.query;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
          const t = this.cellTris[k]!;
          if (this.stamp[t] === query) continue;
          this.stamp[t] = query;
          const o = t * 6;
          const box = this.boxes;
          if (box[o]! > uHi || box[o + 1]! < uLo || box[o + 2]! > vHi || box[o + 3]! < vLo || box[o + 4]! > wHi || box[o + 5]! < wLo) continue;
          found.push(t);
        }
      }
    }
    found.sort((a, b) => a - b);

    // Mesh._computeIntersections and checkIntersection, triangle by triangle in order.
    let best: THREE.Vector3 | undefined;
    let bestDistance = Infinity;
    for (const t of found) {
      mesh.getVertexPosition(this.corners[t * 3]!, _a);
      mesh.getVertexPosition(this.corners[t * 3 + 1]!, _b);
      mesh.getVertexPosition(this.corners[t * 3 + 2]!, _c);
      const hit = material.side === THREE.BackSide
        ? _local.intersectTriangle(_c, _b, _a, true, _point)
        : _local.intersectTriangle(_a, _b, _c, material.side === THREE.FrontSide, _point);
      if (hit === null) continue;
      _world.copy(_point).applyMatrix4(mesh.matrixWorld);
      const distance = ray.origin.distanceTo(_world);
      if (distance < 0 || distance > far) continue;
      // Three sorts its hits by distance, stably: the first of equals stays first.
      if (distance < bestDistance) {
        bestDistance = distance;
        best = _world.clone();
      }
    }
    return best;
  }
}
