/**
 * tools/kitlib.ts
 *
 * What the kit-car checks share (tools/kit-zfight.ts, kit-mirrors.ts, kit-surface.ts,
 * kit-drawing.ts): a car built headless as the game builds it, its triangles in the kit
 * frame with each mesh's slot, owner and zone, a uniform-grid ray caster over them, and a
 * small ray-traced renderer whose images the checks save as evidence.
 *
 * The kit frame (src/carkit/README.md "Frame of reference"): +x the car's left, +y up, +z
 * forward, `s = length / 2 − z` from the tip of the front bumper. A tool must call
 * `installAssetShim()` (tools/assetshim.ts) before it builds a car.
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import sharp from 'sharp';
import { PartBuilder, cutUnder, type KitSlot, type Outline, type Vec3 } from '../src/carkit/builder';
import { buildKitCar } from '../src/carkit/kit';
import { KIT_SPECS } from '../src/carkit/specs';
import { BodyFrame } from '../src/carkit/body';
import type { KitCarSpec } from '../src/carkit/spec';

export type V3 = [number, number, number];

// ---------------------------------------------------------------- provenance

/**
 * Emitters, interned: `sites[i]` is the two innermost src/carkit lines outside builder.ts
 * (`interior.ts:2490 < interior.ts:2394`), `siteParts[i]` the innermost named function
 * outside the generic helpers (`interior.ts gauge`): the part a triangle was built for.
 */
export const sites: string[] = [];
export const siteParts: string[] = [];
const siteIndex = new Map<string, number>();
export function intern(at: string, part = at): number {
  const key = `${at}|${part}`;
  let i = siteIndex.get(key);
  if (i === undefined) {
    i = sites.length;
    sites.push(at);
    siteParts.push(part);
    siteIndex.set(key, i);
  }
  return i;
}
const FRAME = /at (?:([\w$.<>]+) )?\(?.*\/src\/carkit\/([a-z]+\.ts):(\d+):\d+/;
/** Shared helpers that build for whichever part calls them: the part is their caller. */
const HELPERS = new Set(['pad', 'beam', 'gaiter', 'fillX', 'cutLocal', 'inlay', 'rectCorners', 'needle', 'prismX', 'hinge', 'fineDetail', 'mount', 'push', 'pop', 'color', 'place', 'map', 'forEach', 'flatMap']);
function callSite(): number {
  const stack = new Error().stack ?? '';
  const at: string[] = [];
  let part = '';
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (!m || m[2] === 'builder.ts') continue;
    if (at.length < 2) at.push(`${m[2]}:${m[3]}`);
    const fn = m[1]?.split('.').pop();
    if (!part && fn && !HELPERS.has(fn)) part = `${m[2]} ${fn}`;
    if (at.length === 2 && part) break;
  }
  return intern(at.join(' < ') || '?', part || at[0] || '?');
}
/** PartBuilder's private slot buffers plus the provenance hung on it (runtime patch). */
interface BuilderInternals {
  slots: Map<KitSlot, { positions: number[]; colors: number[] }>;
  prov?: Map<KitSlot, number[]>;
}
let provenance = false;
/**
 * Wraps `PartBuilder` (at run time, in this process only) so every built geometry carries
 * `userData.prov`: the `sites` index of each triangle's emitter. Call before building.
 */
export function installProvenance(): void {
  if (provenance) return;
  provenance = true;
  Error.stackTraceLimit = 14;
  const origTri = PartBuilder.prototype.tri;
  const origBuild = PartBuilder.prototype.build;
  const origAppend = PartBuilder.prototype.append;
  PartBuilder.prototype.tri = function (this: PartBuilder, slot: KitSlot, a: Vec3, b: Vec3, c: Vec3) {
    // Private fields are read at run time; this only observes them.
    const self = this as unknown as BuilderInternals;
    const before = self.slots.get(slot)?.positions.length ?? 0;
    origTri.call(this, slot, a, b, c);
    const after = self.slots.get(slot)?.positions.length ?? 0;
    if (after > before) {
      self.prov ??= new Map();
      let list = self.prov.get(slot);
      if (!list) self.prov.set(slot, (list = []));
      list.push(callSite());
    }
    return this;
  };
  PartBuilder.prototype.build = function (this: PartBuilder) {
    const self = this as unknown as BuilderInternals;
    const out = origBuild.call(this);
    for (const [slot, g] of out) g.userData.prov = self.prov?.get(slot) ?? [];
    return out;
  };
  // A cut keeps each piece's emitter; an append brings the other builder's along.
  PartBuilder.prototype.cut = function (this: PartBuilder, outlines: readonly Outline[]) {
    const self = this as unknown as BuilderInternals;
    if (outlines.length === 0) return this;
    for (const [slot, buffer] of self.slots) {
      const r = cutUnder(buffer.positions, buffer.colors, outlines);
      const prov = self.prov?.get(slot) ?? [];
      self.slots.set(slot, { positions: r.positions, colors: r.colors });
      self.prov ??= new Map();
      self.prov.set(slot, r.from.map((i) => prov[i]!));
    }
    return this;
  };
  PartBuilder.prototype.append = function (this: PartBuilder, other: PartBuilder) {
    const self = this as unknown as BuilderInternals;
    const them = other as unknown as BuilderInternals;
    // Provenance first: append takes the slots' lengths as they stand.
    for (const [slot, buffer] of them.slots) {
      const mine = self.slots.get(slot)?.positions.length ?? 0;
      self.prov ??= new Map();
      const list = self.prov.get(slot) ?? new Array(mine / 9).fill(intern('?'));
      self.prov.set(slot, list.concat(them.prov?.get(slot) ?? new Array(buffer.positions.length / 9).fill(intern('?'))));
    }
    return origAppend.call(this, other);
  };
}
// ---------------------------------------------------------------- the car

export interface KitCar {
  readonly id: string;
  readonly spec: KitCarSpec;
  readonly frame: BodyFrame;
  readonly root: THREE.Group;
  /** s of a kit-frame z. */
  s(z: number): number;
  /** Kit-frame z of an s. */
  z(s: number): number;
}

export function buildCar(id: string): KitCar {
  const key = id.replace(/^kit_/, '');
  const spec = KIT_SPECS[key];
  if (!spec) throw new Error(`unknown kit car ${id}`);
  const root = buildKitCar(key);
  root.updateMatrixWorld(true);
  const half = spec.length / 2;
  return { id: key, spec, frame: new BodyFrame(spec), root, s: (z) => half - z, z: (s) => half - s };
}

/** Every kit car id, in the registry's order. */
export function kitIds(args: readonly string[]): string[] {
  const named = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/^kit_/, ''));
  for (const id of named) if (!KIT_SPECS[id]) throw new Error(`unknown kit car ${id}`);
  return named.length > 0 ? named : Object.keys(KIT_SPECS);
}

/** World position of a named node (the driver's eye, a wheel), or undefined. */
export function nodeAt(root: THREE.Object3D, name: string): V3 | undefined {
  const node = root.getObjectByName(name);
  if (!node) return undefined;
  const p = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
  return [p.x, p.y, p.z];
}

// ---------------------------------------------------------------- triangle soup

/** Shell parts that open, and the panes riding in them: the owner of every mesh under one. */
const OWNER = /^(door_[fr][lr]|bonnet|boot|tailgate(_[lr])?|flap|window_[a-z0-9]+|vent_[a-z0-9]+|quarter_[a-z0-9]+)$/;

export interface MeshInfo {
  readonly node: THREE.Mesh;
  readonly name: string;
  /** Ancestor names below the root, '/'-joined, the mesh's last. */
  readonly path: string;
  /** The kit slot (`paint`, `trim`, `glass`, `chrome`, a lamp role…). */
  readonly slot: string;
  /** `exterior`, `kit_cabin`, `kit_bay`, `kit_boot`, `kit_under` or `wheel`. */
  readonly zone: string;
  /** The shell part it belongs to: `body`, `door_fl`, `bonnet`, … (a root-level mesh: `body` or its own name). */
  readonly owner: string;
  readonly glass: boolean;
  /** Hidden as built (a mirror's live face, a lit twin): drawn by no camera unless shown. */
  readonly hidden: boolean;
  /** `left`, `right` or `inner` on a mirror's live face (`userData.kitMirror`). */
  readonly mirror?: string;
}

export interface Soup {
  readonly n: number;
  /** 9 per triangle: three vertices in the kit frame. */
  readonly v: Float64Array;
  /** Unit normal per triangle (as wound). */
  readonly nrm: Float64Array;
  readonly area: Float64Array;
  readonly mesh: Int32Array;
  /** Colour per triangle (the vertex colour `finishKitSurfaces` wrote), 0..1. */
  readonly rgb: Float32Array;
  readonly meshes: MeshInfo[];
}

export function soupOf(root: THREE.Object3D): Soup {
  root.updateMatrixWorld(true);
  const list: MeshInfo[] = [];
  let total = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const names: string[] = [];
    let zone = 'exterior';
    let owner = '';
    let hidden = false;
    for (let p: THREE.Object3D | null = node; p && p !== root; p = p.parent) {
      names.unshift(p.name || '?');
      if (!p.visible) hidden = true;
      if (/^kit_(cabin|bay|boot|under)$/.test(p.name)) zone = p.name;
      if (/^kit_wheel_/.test(p.name)) zone = 'wheel';
      if (!owner && p !== node && OWNER.test(p.name)) owner = p.name;
    }
    const m = node.material as THREE.Material;
    const slot = (node.userData.kitSlot as string | undefined) ?? m.name;
    if (!owner) owner = node.parent === root && /^body_/.test(node.name) ? 'body' : node.name.replace(/_(paint|trim|glass|chrome)$/, '');
    list.push({
      node,
      name: node.name,
      path: names.join('/'),
      slot,
      zone,
      owner,
      glass: slot === 'glass' || !!m.transparent,
      hidden,
      mirror: node.userData.kitMirror as string | undefined,
    });
    const g = node.geometry;
    total += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  const v = new Float64Array(total * 9);
  const nrm = new Float64Array(total * 3);
  const area = new Float64Array(total);
  const mesh = new Int32Array(total);
  const rgb = new Float32Array(total * 3);
  const p = new THREE.Vector3();
  let t = 0;
  list.forEach((info, mi) => {
    const g = info.node.geometry;
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const index = g.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const o = t * 9;
      for (let j = 0; j < 3; j++) {
        const vi = index ? index.getX(i + j) : i + j;
        p.fromBufferAttribute(pos, vi).applyMatrix4(info.node.matrixWorld);
        v[o + j * 3] = p.x;
        v[o + j * 3 + 1] = p.y;
        v[o + j * 3 + 2] = p.z;
      }
      const ux = v[o + 3]! - v[o]!, uy = v[o + 4]! - v[o + 1]!, uz = v[o + 5]! - v[o + 2]!;
      const wx = v[o + 6]! - v[o]!, wy = v[o + 7]! - v[o + 1]!, wz = v[o + 8]! - v[o + 2]!;
      let cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      const len = Math.hypot(cx, cy, cz);
      area[t] = len / 2;
      if (len > 0) { cx /= len; cy /= len; cz /= len; }
      nrm[t * 3] = cx; nrm[t * 3 + 1] = cy; nrm[t * 3 + 2] = cz;
      mesh[t] = mi;
      if (col) {
        const ci = index ? index.getX(i) : i;
        rgb[t * 3] = col.getX(ci); rgb[t * 3 + 1] = col.getY(ci); rgb[t * 3 + 2] = col.getZ(ci);
      } else {
        rgb[t * 3] = 0.6; rgb[t * 3 + 1] = 0.6; rgb[t * 3 + 2] = 0.6;
      }
      t++;
    }
  });
  return { n: total, v, nrm, area, mesh, rgb, meshes: list };
}

/** The triangle's centroid. */
export function centroid(s: { v: Float64Array }, t: number): V3 {
  const o = t * 9;
  return [(s.v[o]! + s.v[o + 3]! + s.v[o + 6]!) / 3, (s.v[o + 1]! + s.v[o + 4]! + s.v[o + 7]!) / 3, (s.v[o + 2]! + s.v[o + 5]! + s.v[o + 8]!) / 3];
}

// ---------------------------------------------------------------- ray grid

const RAY_CELL = 0.04; // m

/** The triangles a grid is built over: three vertices each, and their areas (zero-area ones are skipped). */
export interface TriList {
  readonly n: number;
  readonly v: Float64Array;
  readonly area: Float64Array;
}

export interface RayHit {
  readonly t: number;
  readonly tri: number;
}

/** A uniform grid over the triangles `occluder` keeps; rays walk it cell by cell. */
export class RayGrid {
  readonly min: [number, number, number];
  readonly dims: [number, number, number];
  readonly start: Int32Array;
  readonly items: Int32Array;
  readonly stamp: Int32Array;
  private ray = 0;
  constructor(readonly s: TriList, occluder: (t: number) => boolean) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < s.n * 3; i++) {
      const x = s.v[i * 3]!, y = s.v[i * 3 + 1]!, z = s.v[i * 3 + 2]!;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
    }
    this.min = [x0 - 0.01, y0 - 0.01, z0 - 0.01];
    this.dims = [Math.ceil((x1 - x0 + 0.02) / RAY_CELL), Math.ceil((y1 - y0 + 0.02) / RAY_CELL), Math.ceil((z1 - z0 + 0.02) / RAY_CELL)];
    const [X, Y, Z] = this.dims;
    const counts = new Int32Array(X * Y * Z + 1);
    const ranges: number[][] = [];
    const span = (t: number) => {
      let a0 = Infinity, b0 = Infinity, c0 = Infinity, a1 = -Infinity, b1 = -Infinity, c1 = -Infinity;
      for (let j = 0; j < 3; j++) {
        const x = s.v[t * 9 + j * 3]!, y = s.v[t * 9 + j * 3 + 1]!, z = s.v[t * 9 + j * 3 + 2]!;
        a0 = Math.min(a0, x); b0 = Math.min(b0, y); c0 = Math.min(c0, z);
        a1 = Math.max(a1, x); b1 = Math.max(b1, y); c1 = Math.max(c1, z);
      }
      const f = (val: number, ax: 0 | 1 | 2) => Math.max(0, Math.min(this.dims[ax] - 1, Math.floor((val - this.min[ax]) / RAY_CELL)));
      return [f(a0, 0), f(a1, 0), f(b0, 1), f(b1, 1), f(c0, 2), f(c1, 2)];
    };
    for (let t = 0; t < s.n; t++) {
      if (!occluder(t) || s.area[t]! < 1e-10) { ranges.push([]); continue; }
      const r = span(t);
      ranges.push(r);
      for (let i = r[0]!; i <= r[1]!; i++) for (let j = r[2]!; j <= r[3]!; j++) for (let k = r[4]!; k <= r[5]!; k++) counts[(i * Y + j) * Z + k]!++;
    }
    this.start = new Int32Array(X * Y * Z + 1);
    for (let c = 0; c < X * Y * Z; c++) this.start[c + 1] = this.start[c]! + counts[c]!;
    this.items = new Int32Array(this.start[X * Y * Z]!);
    const fill = this.start.slice(0, X * Y * Z);
    for (let t = 0; t < s.n; t++) {
      const r = ranges[t]!;
      if (r.length === 0) continue;
      for (let i = r[0]!; i <= r[1]!; i++) for (let j = r[2]!; j <= r[3]!; j++) for (let k = r[4]!; k <= r[5]!; k++) this.items[fill[(i * Y + j) * Z + k]!++] = t;
    }
    this.stamp = new Int32Array(s.n);
  }

  /** Distance along the unit `d` from `o` to triangle t, or -1 (no hit, or not within (1e-6, tmax)). */
  private hitTri(t: number, o: readonly number[], d: readonly number[], tmax: number): number {
    const v = this.s.v, b = t * 9;
    const e1x = v[b + 3]! - v[b]!, e1y = v[b + 4]! - v[b + 1]!, e1z = v[b + 5]! - v[b + 2]!;
    const e2x = v[b + 6]! - v[b]!, e2y = v[b + 7]! - v[b + 1]!, e2z = v[b + 8]! - v[b + 2]!;
    const px = d[1]! * e2z - d[2]! * e2y, py = d[2]! * e2x - d[0]! * e2z, pz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return -1;
    const inv = 1 / det;
    const tx = o[0]! - v[b]!, ty = o[1]! - v[b + 1]!, tz = o[2]! - v[b + 2]!;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (d[0]! * qx + d[1]! * qy + d[2]! * qz) * inv;
    if (w < 0 || u + w > 1) return -1;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return tt > 1e-6 && tt < tmax ? tt : -1;
  }

  /**
   * Walks the ray from `o` along the unit `d` up to `len`; `visit(t, dist)` gets every
   * triangle it meets inside the cell being walked, cells in order along the ray, and
   * returns true to stop once that cell is done (so a nearest hit found there is final).
   */
  private walk(o: readonly number[], d: readonly number[], len: number, skip: (t: number) => boolean, visit: (t: number, dist: number) => boolean): void {
    let t0 = 0, t1 = len;
    for (let ax = 0; ax < 3; ax++) {
      const lo = this.min[ax]!, hi = lo + this.dims[ax]! * RAY_CELL;
      if (Math.abs(d[ax]!) < 1e-12) { if (o[ax]! < lo || o[ax]! > hi) return; continue; }
      let a = (lo - o[ax]!) / d[ax]!, b = (hi - o[ax]!) / d[ax]!;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return;
    }
    const stamp = ++this.ray;
    const [, Y, Z] = this.dims;
    const pos = [o[0]! + d[0]! * t0, o[1]! + d[1]! * t0, o[2]! + d[2]! * t0];
    const cell = [0, 1, 2].map((ax) => Math.max(0, Math.min(this.dims[ax]! - 1, Math.floor((pos[ax]! - this.min[ax]!) / RAY_CELL))));
    const step = d.map((x) => (x > 0 ? 1 : x < 0 ? -1 : 0));
    const tMaxA = [0, 1, 2].map((ax) => {
      if (step[ax] === 0) return Infinity;
      const edge = this.min[ax]! + (cell[ax]! + (step[ax]! > 0 ? 1 : 0)) * RAY_CELL;
      return t0 + (edge - pos[ax]!) / d[ax]!;
    });
    const tDelta = d.map((x) => (x === 0 ? Infinity : RAY_CELL / Math.abs(x)));
    const tmax = len - 1e-4;
    for (;;) {
      const c = (cell[0]! * Y + cell[1]!) * Z + cell[2]!;
      const cellEnd = Math.min(tMaxA[0]!, tMaxA[1]!, tMaxA[2]!);
      let stop = false;
      for (let q = this.start[c]!; q < this.start[c + 1]!; q++) {
        const t = this.items[q]!;
        if (this.stamp[t] === stamp || skip(t)) continue;
        const dist = this.hitTri(t, o, d, tmax);
        if (dist < 0) { this.stamp[t] = stamp; continue; }
        // A triangle hit beyond this cell is met again in a later cell: not stamped.
        if (dist > cellEnd + 1e-9) continue;
        this.stamp[t] = stamp;
        if (visit(t, dist)) stop = true;
      }
      if (stop) return;
      const ax = tMaxA[0]! < tMaxA[1]! ? (tMaxA[0]! < tMaxA[2]! ? 0 : 2) : tMaxA[1]! < tMaxA[2]! ? 1 : 2;
      if (tMaxA[ax]! > t1) return;
      cell[ax] = cell[ax]! + step[ax]!;
      if (cell[ax]! < 0 || cell[ax]! >= this.dims[ax]!) return;
      tMaxA[ax] = tMaxA[ax]! + tDelta[ax]!;
    }
  }

  /** True if the segment o→p is blocked by a grid triangle other than `skipA`/`skipB`. */
  blocked(o: readonly number[], p: readonly number[], skipA = -1, skipB = -1): boolean {
    const dx = p[0]! - o[0]!, dy = p[1]! - o[1]!, dz = p[2]! - o[2]!;
    const len = Math.hypot(dx, dy, dz);
    let hit = false;
    this.walk(o, [dx / len, dy / len, dz / len], len, (t) => t === skipA || t === skipB, () => (hit = true));
    return hit;
  }

  /** The nearest grid triangle along the unit `d` from `o` within `len` that `skip` does not drop. */
  nearest(o: readonly number[], d: readonly number[], len = 100, skip: (t: number) => boolean = () => false): RayHit | null {
    let best: RayHit | null = null;
    this.walk(o, d, len, skip, (t, dist) => {
      if (!best || dist < best.t) best = { t: dist, tri: t };
      return true;
    });
    return best;
  }
}

// ---------------------------------------------------------------- slices

/**
 * Where the plane `axis = value` cuts the chosen triangles: the segments' end points, as
 * [x, y, z] pairs. A slice at a height gives a panel's outline along the car there.
 */
export function slice(s: Soup, keep: (t: number) => boolean, axis: 0 | 1 | 2, value: number): [V3, V3][] {
  const out: [V3, V3][] = [];
  for (let t = 0; t < s.n; t++) {
    if (!keep(t)) continue;
    const o = t * 9;
    const pts: V3[] = [];
    for (let j = 0; j < 3; j++) {
      const a = o + j * 3, b = o + ((j + 1) % 3) * 3;
      const da = s.v[a + axis]! - value, db = s.v[b + axis]! - value;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const k = da / (da - db);
        pts.push([s.v[a]! + (s.v[b]! - s.v[a]!) * k, s.v[a + 1]! + (s.v[b + 1]! - s.v[a + 1]!) * k, s.v[a + 2]! + (s.v[b + 2]! - s.v[a + 2]!) * k]);
      }
    }
    if (pts.length === 2) out.push([pts[0]!, pts[1]!]);
  }
  return out;
}

// ---------------------------------------------------------------- images

export interface Image {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8ClampedArray; // RGBA
}

export function image(w: number, h: number, fill: [number, number, number, number] = [0, 0, 0, 0]): Image {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(fill, i * 4);
  return { w, h, px };
}

export async function savePng(img: Image, path: string): Promise<void> {
  await sharp(Buffer.from(img.px.buffer, img.px.byteOffset, img.px.byteLength), { raw: { width: img.w, height: img.h, channels: 4 } }).png().toFile(path);
}

/** An image as RGBA, cropped to [x0, y0, x1, y1] and/or scaled to `height` px (aspect kept). */
export async function loadImage(path: string, crop?: readonly [number, number, number, number], height?: number): Promise<Image> {
  let pipe = sharp(path).ensureAlpha();
  if (crop) pipe = pipe.extract({ left: crop[0], top: crop[1], width: crop[2] - crop[0], height: crop[3] - crop[1] });
  if (height) pipe = pipe.resize({ height });
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

/** Images side by side (top-aligned) on a white sheet, `gap` px apart. */
export function sideBySide(imgs: readonly Image[], gap = 8): Image {
  const w = imgs.reduce((a, i) => a + i.w, 0) + gap * (imgs.length - 1);
  const h = Math.max(...imgs.map((i) => i.h));
  const out = image(w, h, [255, 255, 255, 255]);
  let x0 = 0;
  for (const img of imgs) {
    for (let y = 0; y < img.h; y++) out.px.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), (y * w + x0) * 4);
    x0 += img.w + gap;
  }
  return out;
}

/** Draws `top` over `base` (same size) with its alpha. */
export function over(base: Image, top: Image): Image {
  const out = image(base.w, base.h);
  for (let i = 0; i < base.w * base.h; i++) {
    const a = top.px[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) out.px[i * 4 + c] = base.px[i * 4 + c]! * (1 - a) + top.px[i * 4 + c]! * a;
    out.px[i * 4 + 3] = 255;
  }
  return out;
}

export function dot(img: Image, x: number, y: number, rgba: readonly number[], r = 1): void {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const px = Math.round(x) + dx, py = Math.round(y) + dy;
    if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
    img.px.set(rgba, (py * img.w + px) * 4);
  }
}

export function line(img: Image, x0: number, y0: number, x1: number, y1: number, rgba: readonly number[], r = 0): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) dot(img, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, rgba, r);
}

export function box(img: Image, x0: number, y0: number, x1: number, y1: number, rgba: readonly number[], r = 1): void {
  line(img, x0, y0, x1, y0, rgba, r);
  line(img, x1, y0, x1, y1, rgba, r);
  line(img, x1, y1, x0, y1, rgba, r);
  line(img, x0, y1, x0, y0, rgba, r);
}

// ---------------------------------------------------------------- ray-traced views

/** A pixel's ray: origin and unit direction in the kit frame, or null for no ray. */
export type PixelRay = (px: number, py: number) => { o: V3; d: V3 } | null;

export interface Camera {
  readonly ray: PixelRay;
  /** Pixel of a kit-frame point, or null behind the camera. */
  project(p: readonly number[]): [number, number] | null;
}

/** A perspective camera at `eye` looking along yaw/pitch (radians; yaw + turns left, towards +x), vertical FOV in degrees. */
export function perspective(eye: V3, yaw: number, pitch: number, fovDeg: number, w: number, h: number): Camera {
  const f: V3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  // Right on screen is the car's -x when looking forward.
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const k = Math.tan((fovDeg * Math.PI) / 360);
  return {
    ray: (px, py) => {
      const sx = ((2 * (px + 0.5)) / w - 1) * k * (w / h);
      const sy = (1 - (2 * (py + 0.5)) / h) * k;
      return { o: eye, d: norm([f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy]) };
    },
    project: (p) => {
      const d = sub(p, eye);
      const z = dot3(d, f);
      if (z <= 1e-6) return null;
      const sx = dot3(d, r) / z / (k * (w / h));
      const sy = dot3(d, u) / z / k;
      return [((sx + 1) * w) / 2 - 0.5, ((1 - sy) * h) / 2 - 0.5];
    },
  };
}

/** A perspective camera at `from` aimed at `at`. */
export function lookAt(from: V3, at: readonly number[], fovDeg: number, w: number, h: number): Camera {
  const d = sub(at, from);
  return perspective(from, Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2])), fovDeg, w, h);
}

/** Pixel → kit-frame point on the view's plane, and the ray's direction (orthographic). */
export function orthographic(toPoint: (px: number, py: number) => V3, d: V3): PixelRay {
  const back: V3 = [-d[0] * 20, -d[1] * 20, -d[2] * 20];
  return (px, py) => {
    const p = toPoint(px, py);
    return { o: [p[0] + back[0], p[1] + back[1], p[2] + back[2]], d };
  };
}

export interface Trace {
  readonly img: Image;
  /** Per pixel: the first opaque triangle hit, or -1. */
  readonly ids: Int32Array;
}

const LIGHT = norm([0.4, 0.8, 0.45]);

/**
 * Ray-traces a view: flat Lambert shading of each triangle's own colour (paint drawn a
 * neutral blue-grey), glass a 30 % blue film, `tint(t)` overriding a triangle's colour.
 */
export function trace(s: Soup, grid: RayGrid, w: number, h: number, ray: PixelRay, tint?: (t: number) => readonly number[] | undefined, background: readonly number[] = [255, 255, 255, 0]): Trace {
  const img = image(w, h);
  const ids = new Int32Array(w * h).fill(-1);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const r = ray(px, py);
    const i = py * w + px;
    if (!r) { img.px.set(background, i * 4); continue; }
    let o = r.o;
    let film = 0;
    let colour: number[] | null = null;
    for (let k = 0; k < 6; k++) {
      const hit = grid.nearest(o, r.d, 60);
      if (!hit) break;
      const info = s.meshes[s.mesh[hit.tri]!]!;
      const p: V3 = [o[0] + r.d[0] * hit.t, o[1] + r.d[1] * hit.t, o[2] + r.d[2] * hit.t];
      if (info.glass) {
        film = 1 - (1 - film) * 0.7;
        o = [p[0] + r.d[0] * 1e-4, p[1] + r.d[1] * 1e-4, p[2] + r.d[2] * 1e-4];
        continue;
      }
      ids[i] = hit.tri;
      const n: V3 = [s.nrm[hit.tri * 3]!, s.nrm[hit.tri * 3 + 1]!, s.nrm[hit.tri * 3 + 2]!];
      const facing = n[0] * r.d[0] + n[1] * r.d[1] + n[2] * r.d[2] > 0 ? -1 : 1;
      const lambert = 0.35 + 0.65 * Math.max(0, facing * (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]));
      // Paint in a stand-in blue; its tone darker by the tone's grey (the vertex colour).
      const paint = info.slot === 'paint' || info.slot === 'tone';
      const base = tint?.(hit.tri) ?? (paint ? [0.55 * s.rgb[hit.tri * 3]!, 0.6 * s.rgb[hit.tri * 3 + 1]!, 0.68 * s.rgb[hit.tri * 3 + 2]!] : [s.rgb[hit.tri * 3]!, s.rgb[hit.tri * 3 + 1]!, s.rgb[hit.tri * 3 + 2]!]);
      colour = [base[0]! * lambert * 255, base[1]! * lambert * 255, base[2]! * lambert * 255];
      break;
    }
    const c = colour ?? [background[0]!, background[1]!, background[2]!];
    const a = colour ? 255 : film > 0 ? 255 * film : background[3]!;
    img.px[i * 4] = c[0]! * (1 - film) + 120 * film;
    img.px[i * 4 + 1] = c[1]! * (1 - film) + 170 * film;
    img.px[i * 4 + 2] = c[2]! * (1 - film) + 220 * film;
    img.px[i * 4 + 3] = a;
  }
  return { img, ids };
}

/** Outline of a traced view: pixels whose neighbour shows another mesh, or nothing. */
export function outline(s: Soup, tr: Trace, rgba: readonly number[]): Image {
  const { w, h } = tr.img;
  const out = image(w, h);
  const key = (i: number): number => (tr.ids[i]! < 0 ? -1 : s.mesh[tr.ids[i]!]!);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const k = key(i);
    const edge = (x + 1 < w && key(i + 1) !== k) || (y + 1 < h && key(i + w) !== k);
    if (edge) out.px.set(rgba, i * 4);
  }
  return out;
}

// ---------------------------------------------------------------- vectors

export function sub(a: readonly number[], b: readonly number[]): V3 {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
export function cross(a: readonly number[], b: readonly number[]): V3 {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
export function norm(a: readonly number[]): V3 {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
}
export function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

// ---------------------------------------------------------------- reports

/** One line a check reports about one car. */
export interface Finding {
  readonly car: string;
  /** `fail` breaks the gate; `warn` is listed. */
  readonly level: 'fail' | 'warn';
  readonly what: string;
}

/** Where a check writes its evidence for a car: build/kitcheck/<car>/ (gitignored). */
export async function outDir(car: string): Promise<string> {
  const dir = new URL(`../build/kitcheck/${car}/`, import.meta.url).pathname;
  await Bun.$`mkdir -p ${dir}`.quiet();
  return dir;
}
