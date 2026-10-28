/**
 * The finished car's flat runs merged (kit.ts, after the leans): every triangle the
 * generators emit stays where it is, but a vertex inside a flat stretch of one mesh, whose
 * triangles all lie in one plane in one colour, is taken out and its hole filled again
 * with the fewest, fattest triangles; zero-area triangles are dropped. Rows and columns
 * that only cut a flat panel into strips (the side rows a raked shut line puts on every
 * tub column, a bumper's flank stations, a strip's steps on a flat side) then vanish, and
 * with them the slivers and fans they left; where the surface bends, nothing moves.
 *
 * A vertex on a mesh's open edge goes only where that edge runs straight through it and
 * no other triangle of the car (any mesh, any part) has a corner there, so no seam
 * between two meshes gets a T-junction.
 */

import * as THREE from 'three';

/** Vertices closer than this (m) are one: the generators' shared corners agree far better. */
const WELD = 1e-5;
/** A fan is flat when its corners lie this close (m) to one plane. */
const PLANE = 0.001;
/** And no two of its triangles' normals part by more than this (cos of 1.5°). */
const NORMALS = Math.cos((5 * Math.PI) / 180);
/** A vertex on an open edge lies this close (m) to the straight line through its neighbours. */
const LINE = 5e-5;
/** Triangles with twice their area under this (m²) are dropped. */
const ZERO = 1e-8;

type V3 = [number, number, number];

/** A coordinate's weld cell: points in one cell (per axis) are one corner. */
function cell(c: number): number {
  const k = Math.round(c / WELD);
  // Int32 below holds the cells of any car (21 km); a NaN or a stray point would not fit.
  if (!(Math.abs(k) < 2 ** 31)) throw new Error(`simplifyFlats: coordinate ${c} is no weld cell`);
  return k;
}

/** Missing from a `WeldMap`. */
const NONE = -(2 ** 31);

/**
 * Integers by weld cell (x, y, z): an open-addressed table of the cells' integer triples,
 * for the millions of lookups a car's merge makes (string keys were a fifth of a build).
 * Values are int32s other than `NONE`.
 */
class WeldMap {
  private keys = new Int32Array(0);
  private values = new Int32Array(0);
  private mask = -1;
  private size = 0;

  constructor(expected: number) {
    let capacity = 16;
    while (capacity < expected * 2) capacity *= 2;
    this.allocate(capacity);
  }

  private allocate(capacity: number): void {
    this.keys = new Int32Array(capacity * 3);
    this.values = new Int32Array(capacity).fill(NONE);
    this.mask = capacity - 1;
  }

  private slot(x: number, y: number, z: number): number {
    let i = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask;
    for (;;) {
      if (this.values[i] === NONE) return i;
      const k = i * 3;
      if (this.keys[k] === x && this.keys[k + 1] === y && this.keys[k + 2] === z) return i;
      i = (i + 1) & this.mask;
    }
  }

  /** The value at cell (x, y, z), or `NONE`. */
  get(x: number, y: number, z: number): number {
    return this.values[this.slot(x, y, z)]!;
  }

  set(x: number, y: number, z: number, value: number): void {
    let i = this.slot(x, y, z);
    if (this.values[i] === NONE) {
      if ((this.size + 1) * 2 > this.mask + 1) {
        const { keys, values } = this;
        this.allocate((this.mask + 1) * 2);
        for (let j = 0; j < values.length; j++) {
          if (values[j] === NONE) continue;
          const at = this.slot(keys[j * 3]!, keys[j * 3 + 1]!, keys[j * 3 + 2]!);
          this.keys.set(keys.subarray(j * 3, j * 3 + 3), at * 3);
          this.values[at] = values[j]!;
        }
        i = this.slot(x, y, z);
      }
      this.size++;
      this.keys[i * 3] = x;
      this.keys[i * 3 + 1] = y;
      this.keys[i * 3 + 2] = z;
    }
    this.values[i] = value;
  }
}

/** Every cell within one weld step of a point: two corners a hair apart may round apart. */
function near(p: V3, visit: (x: number, y: number, z: number) => boolean): boolean {
  const x = cell(p[0]);
  const y = cell(p[1]);
  const z = cell(p[2]);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if (visit(x + i, y + j, z + k)) return true;
  return false;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));

/** Merges the flat runs of every builder mesh under `root` (non-indexed, position and colour only). */
export function simplifyFlats(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || seen.has(mesh.geometry)) return;
    seen.add(mesh.geometry);
    const g = mesh.geometry;
    const names = Object.keys(g.attributes).sort().join(',');
    if (g.index || (names !== 'color,normal,position' && names !== 'color,position')) return;
    meshes.push(mesh);
  });
  // Which mesh has a corner at each place in the car frame (-1: more than one).
  let corners = 0;
  for (const mesh of meshes) corners += mesh.geometry.getAttribute('position').count;
  const owners = new WeldMap(corners / 4);
  const v = new THREE.Vector3();
  meshes.forEach((mesh, m) => {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      const [x, y, z] = [cell(v.x), cell(v.y), cell(v.z)];
      const o = owners.get(x, y, z);
      if (o === NONE) owners.set(x, y, z, m);
      else if (o !== m) owners.set(x, y, z, -1);
    }
  });
  meshes.forEach((mesh, m) => {
    const world = (p: V3): V3 => v.set(...p).applyMatrix4(mesh.matrixWorld).toArray() as V3;
    simplifyMesh(mesh.geometry, (p) => near(world(p), (x, y, z) => {
      const o = owners.get(x, y, z);
      return o !== NONE && o !== m;
    }));
  });
}

/**
 * One mesh. `shared(p)`: another mesh has a corner at local point `p`.
 * Tags a tool hangs on the geometry per triangle (tools/kit-zfight.ts `prov`) follow
 * the triangles: a new one takes the tag of a triangle it replaced.
 */
function simplifyMesh(geometry: THREE.BufferGeometry, shared: (p: V3) => boolean): void {
  const pos = geometry.getAttribute('position');
  const col = geometry.getAttribute('color');
  const tags = geometry.userData.prov as unknown[] | undefined;
  // Weld.
  const pts: V3[] = [];
  const ids = new WeldMap(pos.count / 4);
  const corner = (i: number): number => {
    const p: V3 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const [x, y, z] = [cell(p[0]), cell(p[1]), cell(p[2])];
    let id = ids.get(x, y, z);
    if (id === NONE) {
      id = pts.length;
      pts.push(p);
      ids.set(x, y, z, id);
    }
    return id;
  };
  const tris: [number, number, number][] = [];
  const colour: number[] = [];
  const from: number[] = [];
  const alive: boolean[] = [];
  /** The live triangles at each corner, in the order they came. */
  const at: (Set<number> | undefined)[] = [];
  const add = (t: [number, number, number], c: number, f: number): void => {
    const n = tris.length;
    tris.push(t);
    colour.push(c);
    from.push(f);
    alive.push(true);
    for (const q of t) (at[q] ??= new Set()).add(n);
  };
  const normal = (t: readonly number[]): V3 => cross(sub(pts[t[1]!]!, pts[t[0]!]!), sub(pts[t[2]!]!, pts[t[0]!]!));
  for (let i = 0; i < pos.count; i += 3) {
    const t: [number, number, number] = [corner(i), corner(i + 1), corner(i + 2)];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2] || len(normal(t)) < ZERO) continue;
    const c = Math.round(col.getX(i) * 255) * 65536 + Math.round(col.getY(i) * 255) * 256 + Math.round(col.getZ(i) * 255);
    add(t, c, i / 3);
  }
  const dropped = tris.length < pos.count / 3;
  let changed = false;

  const kill = (n: number): void => {
    alive[n] = false;
    for (const q of tris[n]!) at[q]!.delete(n);
  };

  /** Takes out vertex `c` if its fan is flat: the fan's triangles it took out, or null. */
  const remove = (c: number): number[] | null => {
    const fan = [...(at[c] ?? [])];
    if (fan.length < 2) return null;
    const tint = colour[fan[0]!]!;
    if (fan.some((n) => colour[n] !== tint)) return null;
    // The plane: area-weighted normal through the vertex.
    const sum: V3 = [0, 0, 0];
    const normals = fan.map((n) => normal(tris[n]!));
    for (const nn of normals) for (let k = 0; k < 3; k++) sum[k] += nn[k]!;
    const ln = len(sum);
    if (ln < ZERO) return null;
    const n: V3 = [sum[0] / ln, sum[1] / ln, sum[2] / ln];
    if (normals.some((nn) => dot(nn, n) < NORMALS * len(nn))) return null;
    // The ring: each triangle turned to start at the vertex, (c, p, q) counter-clockwise.
    const next = new Map<number, number>();
    const prev = new Map<number, number>();
    for (const t of fan.map((k) => tris[k]!)) {
      const r = t.indexOf(c);
      const p = t[(r + 1) % 3]!;
      const q = t[(r + 2) % 3]!;
      if (next.has(p) || prev.has(q)) return null;
      next.set(p, q);
      prev.set(q, p);
    }
    const starts = [...next.keys()].filter((p) => !prev.has(p));
    if (starts.length > 1) return null;
    const ring: number[] = [];
    let p = starts[0] ?? fan.map((k) => tris[k]!).map((t) => t[(t.indexOf(c) + 1) % 3]!)[0]!;
    const first = p;
    for (;;) {
      ring.push(p);
      const q = next.get(p);
      if (q === undefined || q === first) break;
      if (ring.length > fan.length) return null;
      p = q;
    }
    const open = starts.length === 1;
    if (ring.length !== fan.length + (open ? 1 : 0)) return null;
    const o = pts[c]!;
    if (ring.some((r) => Math.abs(dot(sub(pts[r]!, o), n)) > PLANE)) return null;
    if (open) {
      // On an open edge: only where the edge runs straight on and nothing else meets it.
      const a = pts[ring[0]!]!;
      const b = pts[ring[ring.length - 1]!]!;
      const ab = sub(b, a);
      const t = dot(sub(o, a), ab) / dot(ab, ab);
      if (t <= 0 || t >= 1 || len(cross(sub(o, a), ab)) / len(ab) > LINE) return null;
      if (shared(o) || near(o, (x, y, z) => {
        const id = ids.get(x, y, z);
        return id !== NONE && id !== c;
      })) return null;
    }
    const filled = fill(ring.map((r) => pts[r]!), n);
    if (!filled) return null;
    const tag = from[fan[0]!]!;
    for (const k of fan) kill(k);
    for (const [i, j, k] of filled) add([ring[i]!, ring[j]!, ring[k]!], tint, tag);
    return fan;
  };

  // Every vertex once, then again around whatever moved, until nothing does.
  const queue = pts.map((_, i) => i);
  const queued = new Uint8Array(pts.length).fill(1);
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    queued[c] = 0;
    const fan = remove(c);
    if (!fan) continue;
    changed = true;
    // The corners round the vertex taken out, each once, in index order.
    const ring = new Set<number>();
    for (const n of fan) for (const q of tris[n]!) if (q !== c) ring.add(q);
    for (const q of [...ring].sort((a, b) => a - b)) {
      if (!queued[q]) {
        queued[q] = 1;
        queue.push(q);
      }
    }
  }
  if (!changed && !dropped) return;

  // Each triangle keeps the colour of the one it came from (flat runs share theirs).
  const original = col.array;
  const live = tris.map((_, n) => n).filter((n) => alive[n]);
  const positions = new Float32Array(live.length * 9);
  const colors = new Float32Array(live.length * 9);
  live.forEach((n, i) => {
    const f = from[n]! * 9;
    tris[n]!.forEach((q, k) => {
      positions.set(pts[q]!, i * 9 + k * 3);
      colors.set([original[f]!, original[f + 1]!, original[f + 2]!], i * 9 + k * 3);
    });
  });
  if (tags) geometry.userData.prov = live.map((n) => tags[from[n]!]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * Triangles filling a flat polygon (its corners counter-clockwise about `n`), as corner
 * indices: each time the ear whose smallest angle is largest, so long runs of corners on
 * one line are not fanned from one point. Null where no ear can be cut (not simple).
 */
function fill(poly: readonly V3[], n: V3): [number, number, number][] | null {
  const u = Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
  const lu = len(u);
  const e1: V3 = [u[0] / lu, u[1] / lu, u[2] / lu];
  const e2 = cross(n, e1);
  const flat = poly.map((p) => [dot(p, e1), dot(p, e2)] as const);
  const idx = flat.map((_, i) => i);
  const out: [number, number, number][] = [];
  const area = (a: number, b: number, c: number): number => {
    const [ax, ay] = flat[a]!;
    const [bx, by] = flat[b]!;
    const [cx, cy] = flat[c]!;
    return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  };
  const angle = (a: number, b: number, c: number): number => {
    const [ax, ay] = flat[a]!;
    const [bx, by] = flat[b]!;
    const [cx, cy] = flat[c]!;
    const t = Math.atan2(Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)), (bx - ax) * (cx - ax) + (by - ay) * (cy - ay));
    return t;
  };
  while (idx.length > 3) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!;
      const b = idx[i]!;
      const c = idx[(i + 1) % idx.length]!;
      const s = area(a, b, c);
      if (s <= 1e-12) continue;
      let inside = false;
      for (const d of idx) {
        if (d === a || d === b || d === c) continue;
        if (area(a, b, d) >= -1e-12 && area(b, c, d) >= -1e-12 && area(c, a, d) >= -1e-12) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      const score = Math.min(angle(a, b, c), angle(b, c, a), angle(c, a, b));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    const a = idx[(best + idx.length - 1) % idx.length]!;
    const b = idx[best]!;
    const c = idx[(best + 1) % idx.length]!;
    out.push([a, b, c]);
    idx.splice(best, 1);
  }
  if (area(idx[0]!, idx[1]!, idx[2]!) <= 1e-12) return null;
  out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}
